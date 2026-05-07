# RAG and domain-knowledge context strategies (mid-2026)

A practical survey for designing an AI system whose output is tuned to a
specific domain by feeding it a rich corpus of text — typically workshop
transcripts plus written materials produced by domain experts.

This is the artifact. Notes and search log are in `notes.md`.

## TL;DR

- "Naive RAG" (chunk → embed → cosine search → stuff in prompt) is the
  wrong default in 2026. It fails ~40% of retrievals, and ~73% of those
  failures are at retrieval, not generation. Don't ship it as your end
  state.
- For a domain corpus that fits in **~200K tokens**, skip RAG. Put the
  whole corpus in a cached system prompt. Anthropic's official guidance.
  Costs collapse with prompt caching (cache reads at 0.1× input).
- For a corpus that doesn't fit, the 2026 default stack is **Contextual
  Retrieval + hybrid (dense + BM25) + cross-encoder reranker**. This
  reduces top-20 retrieval failures by 67% over a vanilla baseline.
- Retrieval is the bottleneck, not generation. Spend your budget on
  chunking, hybrid search, and reranking before you tune the prompt.
- For corpora rich in *cross-references and conceptual relationships*
  (most expert knowledge corpora), add a **graph layer** on top —
  LightRAG or HippoRAG over Microsoft GraphRAG for cost reasons.
- For **transcripts specifically**, the highest-leverage moves are:
  diarize, chunk on speaker turns, pair Q&A turns, do a topic-segmentation
  pass, and clean ASR errors against a domain glossary.
- Fine-tuning is for *behavior* (tone, format, refusals), not knowledge.
  60% of production systems use both: RAG for knowledge + light
  fine-tune for behavior. Domain-tuned **embeddings** (LoRA on a base
  encoder) are usually a bigger win than fine-tuning the generator.
- The unifying frame is **context engineering**: design a per-query
  context budget and decide what earns a slot.

## 1. The decision tree before you build anything

```
                    What's the corpus size?
                   /                       \
              < 200K tokens              > 200K tokens
                   |                        |
       Long context + prompt cache    How are queries shaped?
       (no retrieval)                 /                  \
                              span-extractive       conceptual /
                              ("find this fact")    multi-hop
                                    |                  |
                              Vector RAG +       Vector RAG +
                              hybrid + rerank    graph layer
                              (Contextual         (LightRAG /
                              Retrieval)         HippoRAG) +
                                                 agentic loop
```

Two qualifiers:
- "Conceptual / multi-hop" means a query like "How does the way Expert A
  frames topic X reconcile with Expert B's view in workshop Y?". It needs
  retrieval to traverse relationships, not just pull adjacent chunks.
- Even with > 200K tokens, you can do **RAG → long context**: retrieve a
  generous set (say 50K tokens) then let the model reason across all of
  it instead of forcing top-3 to be perfect.

## 2. The four levers (and what each is actually for)

| Lever | Solves | When to use | Cost shape |
|---|---|---|---|
| **Long context + prompt cache** | Knowledge access for small corpora | Corpus < ~200K tokens, low-mid query volume, want zero retrieval failures | Pay full input once per cache TTL (5min or 1hr), then 0.1× per query |
| **RAG** | Knowledge access at scale | Corpus is large or churns; need citations; high query volume | Per-query cost is small + fixed; infra to maintain |
| **Fine-tuning** | *Behavior*: tone, format, refusal patterns, classification consistency | Failure mode is "wrong shape", not "wrong facts" | One-time training cost; low marginal cost; locks knowledge to model |
| **Embedding fine-tuning** | Retrieval quality on domain jargon | Generic embeddings miss your terminology | Cheap (LoRA on a base encoder); usually highest ROI of any tuning |

These compose. Most production systems in 2026 use *some of each*. The
canonical staged sequence is **prompt → RAG → behavior fine-tune**, not
"fine-tune to teach the model facts" (a 2023-era anti-pattern that just
makes the model confidently wrong about stale data).

## 3. The 2026 default RAG stack

For a domain corpus that doesn't fit in context. Build in this order;
each step provides the largest remaining gain at that point.

### 3.1 Parse documents with a layout-aware VLM parser

Don't strip text. Preserve structure.

- Managed: **LlamaParse**, **Reducto**, **LandingAI ADE**, **Mistral OCR
  3**, **Gemini Document AI layout parser**.
- Open source: **Docling**, **PyMuPDF4LLM**, **Unstructured**.

A good parser preserves headings, reading order, table structure, page
boundaries, and figure references. This is the foundation for all
chunking decisions downstream. Cost: ~$0.01–0.03/page managed; free open
source. For a few-thousand-page corpus, the spend is trivial and the
downstream lift is large.

### 3.2 Chunk to preserve meaning, not token counts

Do **not** use fixed-size character chunking. Options, ranked by typical
quality:

1. **Anthropic's Contextual Retrieval** — for each chunk, an LLM emits a
   50–100 token "situating context" describing where this chunk sits in
   the parent document; that context is prepended before embedding *and*
   before BM25 indexing. Use prompt caching on the parent doc to keep
   cost ~$1/M tokens. Reduces top-20 retrieval failure by 35% alone, by
   49% combined with BM25, by 67% with a reranker on top.
2. **Late chunking** (Jina) — embed the entire doc with a long-context
   encoder, *then* split at the token-embedding level. Each chunk vector
   is implicitly contextualized through the encoder's full attention.
   Cheaper than (1) (no LLM passes) but the contextualization is
   implicit and weaker. Combine with BM25 separately.
3. **Semantic chunking** — split where embedding similarity between
   adjacent sentences drops. Cheap and decent.
4. **Structural chunking** — split on headings, sections, slide
   boundaries. Always do this first; it's free.

For most domain corpora, do **structural → semantic → contextual
retrieval** (i.e., layer 1 then 2 then add Anthropic's contextualization
on top). For transcripts specifically, see §5.

Chunk size: 200–800 tokens with 10–20% overlap is a good starting band.
Smaller chunks → more precise retrieval but more chunks needed; larger
chunks → fewer needed but more noise per chunk. Tune empirically against
your eval set.

### 3.3 Embed with a strong general or domain-tuned model

Top choices in 2026 (general-purpose retrieval):

- **Voyage 3 / 3-large** — strong retrieval-specific scores; ~$0.06/M
  tokens; offers domain-tuned variants (legal, code, finance).
- **Cohere embed-v4** — 65.2 MTEB; native text+image in one space (only
  major commercial option that does this).
- **Google Gemini Embedding** — 68.32 MTEB v2 (current leader); 3072-dim;
  truly multimodal (text+image+video+audio+PDF in one space).
- **OpenAI text-embedding-3-large** — solid baseline; not leading.
- **Open weights**: NV-Embed-v2 (72.31), Qwen3-Embedding-8B (70.58),
  NVIDIA Llama-Embed-Nemotron-8B (multilingual leader).

**Important caveat:** MTEB scores are on academic data. For a
domain-specific corpus, fine-tuning a smaller encoder with LoRA on
hard-negative pairs from your own corpus often beats a top-of-leaderboard
model. This is the single highest-ROI tuning activity for a domain RAG
system. Budget: a few hundred labeled (query, relevant_chunk) pairs and
a GPU afternoon.

### 3.4 Add BM25; use both (hybrid retrieval)

Run dense retrieval and BM25 in parallel. Fuse with **Reciprocal Rank
Fusion** (RRF). Hybrid is +5–15% recall almost universally. Dense
captures paraphrase and concept; BM25 catches exact terms (proper
nouns, acronyms, product names) that embeddings smear. This combination
is **the single most underrated upgrade** for vanilla RAG systems.

If you adopted Contextual Retrieval (§3.2.1), build a *contextualized*
BM25 index too — each BM25 document is the chunk *with* its situating
context.

### 3.5 Rerank the top-N with a cross-encoder

Retrieve broadly (e.g., top 50–100), rerank to top-K (e.g., 5–10) with
a cross-encoder. This is the #2 highest-leverage upgrade after hybrid.

- **Cohere Rerank 4 Pro** — strong, multilingual, 150–400ms.
- **Voyage rerank-2.5** — instruction-following, low latency, "sweet
  spot" for general RAG.
- **Open**: BGE-Reranker, FlashRank, RankLLM (LLM-as-judge).

Reported gains: +33–48% retrieval quality for ~+120ms. This is the
cheapest big jump in the stack.

### 3.6 Optional: query transformation

Cheap and cumulative with the above:

- **HyDE** — LLM generates a fake answer to the query, embed *that*
  instead of the raw query. Closes the query–document semantic gap.
- **Multi-query** — rephrase the query N ways, retrieve for each,
  fuse.
- **Decomposition** — break a complex query into sub-queries; retrieve
  for each; recompose. Best return for complex domain questions.
- **Step-back** — ask the more abstract version first, retrieve
  concepts, then resolve the specific.

### 3.7 Optional: late interaction (ColBERT / ColPali)

Per-token embeddings with late "MaxSim" interaction at query time.
Strong out-of-domain generalization; storage cost is N× more vectors,
but PLAID indexing and current vector DBs (Vespa, Qdrant, Weaviate,
LanceDB, Elasticsearch) handle it.

- **ColBERTv2 + PLAID** — text-only late interaction.
- **ColPali / ColQwen** — late interaction over *page images* (skips
  OCR/parsing entirely). Worth considering for **slides, infographics,
  diagram-heavy** written materials. Probably overkill for a
  transcript-heavy corpus.

### 3.8 Optional but high-leverage: agentic loop (Self-RAG / CRAG / Adaptive)

Make retrieval a tool the model can call multiple times. Patterns:

- **Self-RAG** — model decides whether to retrieve, judges retrieved
  doc relevance, judges its own output's support.
- **CRAG (Corrective RAG)** — relevance evaluator scores retrieved
  chunks; low → query rewrite; ambiguous → decompose+retrieve; missing
  → fall back to web or different index.
- **Adaptive RAG** — classifier picks the pipeline (no retrieval,
  single-hop, multi-hop) based on query complexity.

For a domain expert assistant, an Adaptive + CRAG-style loop captures
most of the win without going full multi-hop graph traversal.

## 4. When to add a graph (GraphRAG family)

Add graph retrieval when queries require **multi-hop reasoning across
entities or concepts** — i.e., the answer is not in any single chunk
but requires linking 2+ chunks via a relationship. For a domain expert
corpus, this is often the case: queries like "how does X relate to Y"
or "what does Expert A say about Expert B's framework".

Options, in cost order:

| System | Approach | Cost | When it wins |
|---|---|---|---|
| **HippoRAG** | Personalized PageRank over a knowledge graph (hippocampal-indexing inspired) | 10–30× cheaper than GraphRAG | Multi-hop with strong entity recall |
| **LightRAG** | Dual-level (entity + relation) retrieval over graph; no community summaries | ~6,000× cheaper than GraphRAG (claim) | Most cases — recommended starting point |
| **PathRAG** | Path-anchored retrieval | Mid | When relationships *are* the answer |
| **Microsoft GraphRAG** | Entity+relation extraction → Leiden communities → community summaries → local/global query | High; community summarization is token-expensive | Highest accuracy on complex enterprise corpora; willing to pay |

**Practical recipe:**

1. Get vector RAG dialed in first (it's cheaper and faster to iterate).
2. Identify queries the vector pipeline fails on. If they're consistently
   multi-hop relational, add a graph layer.
3. Start with LightRAG. Move to HippoRAG if you want stronger multi-hop,
   to GraphRAG if cost isn't a concern and your queries need
   community-level summaries ("themes across all the Q workshops").
4. Treat graph retrieval as a **second retriever in parallel with dense+BM25**,
   not a replacement.

## 5. Transcript-specific best practices

Transcripts are a different beast from written materials. The
high-leverage moves:

### 5.1 Diarize, then chunk on speaker turns

Use the diarization output of your ASR (Whisper-large-v3 with diarization
modules, Deepgram Nova, AssemblyAI). Each chunk = one speaker turn, or
a group of consecutive same-speaker turns on the same topic. **Never
chunk a turn in half** — context is destroyed.

### 5.2 Pair Q&A turns

For workshop transcripts, the highest-value retrieval pattern is "user
asked a question similar to mine, here's the expert's answer". Pair
the question turn with the immediately following answer turn(s) into a
single chunk. Embed the question; retrieve the answer.

### 5.3 Topic-segment before chunking

Run a topic-segmentation pass (TextTiling, BERTopic, or an LLM "where
does the topic change?" pass). Make topic boundaries hard chunk
boundaries. For long monologues by an expert, this is what keeps chunks
coherent.

### 5.4 Clean ASR errors with a domain glossary

ASR systems mangle proper nouns and domain jargon. The glossary fix:

1. Build a glossary of domain terms (manual or extracted from written
   materials in the corpus).
2. For each transcript, do an LLM pass: "Here's the glossary of expected
   terms. Here's the transcript. Fix any obvious mishearings."
3. Optionally: feed the glossary directly to the ASR via custom-vocab /
   biasing if the engine supports it (Deepgram, AssemblyAI both do).

This single step reliably moves retrieval quality 5–15% on
domain-jargon-heavy corpora.

### 5.5 Filter filler

Drop turns that are filler: host transitions, "yeah", "okay so", logistics
("can you hear me?"). A small classifier or a simple length+content
heuristic is fine.

### 5.6 Layer in metadata

Index per-chunk metadata: speaker, role (expert vs facilitator vs
audience), timestamp, source workshop, topic tag. Use it to filter at
query time ("only expert turns", "only from Workshop 3").

### 5.7 Apply Contextual Retrieval *after* the above

The "situating context" the LLM generates for a workshop chunk should
include: workshop title, topic of this segment, who's speaking, and the
question being addressed. With this, retrieval becomes much sharper.

## 6. The corpus-fit-in-context shortcut

If your full corpus fits in ~200K tokens (≈ 500 pages of dense text, or
~30 hours of transcribed workshop), Anthropic's official guidance is:
**don't build RAG, just put it all in a cached system prompt.**

Math on a Claude Sonnet-class model (illustrative):
- Corpus = 200K tokens.
- Cache write (1 hr TTL): 200K × 2× input price, paid once per hour.
- Cache read: 200K × 0.1× input price per query.
- Per-query cost is ~5% of what it would be without caching.

You eliminate retrieval entirely. No chunking decisions, no embedding
drift, no reranker tuning, no evaluation gold sets. You also don't lose
information — every query sees the entire corpus. The model handles
synthesis natively.

Fail conditions:
- Corpus exceeds the cache window even with selectivity → use RAG.
- "Lost in the middle" hurts — test with needle-in-haystack on your
  actual queries.
- TTFT scales superlinearly; multi-minute first tokens at >500K tokens
  are reported.

For the user's specific case (workshop transcripts + written domain
materials), if the total corpus is, say, 30 hours of transcripts (~300K
tokens) + ~100K tokens of written material, you're at ~400K tokens — too
big for full-corpus context. Use RAG. But if it's ~10 hours of workshops
+ light written material (~200K total), the long-context shortcut is
the right call.

## 7. Context engineering: the unifying frame

The 2025–2026 reframe is to stop calling this "prompt engineering" and
call it **context engineering**: designing what the model sees at
inference time. RAG is one input; system instructions, examples,
conversation history, and tool outputs are others. They share a budget.

Practical implications:

- Set a **context budget** per query type. Reserve slots for system
  instructions, retrieved chunks, recent conversation, tool outputs.
- **Compose** retrieval results with structure: not "here are 10 chunks"
  but a structured document — section headings, citations, source
  metadata. Models reason better over structured input.
- **Cache** the stable parts (system prompt, taxonomy, persona,
  glossary). Vary only the per-query parts.
- **Citations** are a context-engineering feature, not a UI feature.
  Force the model to ground every claim in a chunk by id or quote.
- **Cross-link** to memory. For a long-running assistant, retrieved
  corpus chunks + per-user memory belong in the same context, with
  clear separation. (See cross-links below.)

## 8. Evaluation

Don't ship a domain-knowledge system without a gold set. Recommended:

- **50–200 hand-curated (query, ideal_answer, relevant_chunk_ids)
  triples** to start. Domain experts must review.
- Run **RAGAS** metrics on every retrieval/chunking change:
  - **Faithfulness** > 0.9 (every claim grounded in retrieved context).
  - **Answer relevancy** > 0.85 (answer addresses the query).
  - **Context precision** > 0.8 (relevant chunks ranked high).
  - **Context recall** — relevant chunks present at all.
- Add **noise sensitivity** — does the model get distracted by
  off-topic chunks?
- LLM judges agree with human experts ~80–85%. They diverge on
  borderline cases. Spot-check borderline outputs by hand.
- Watch the **failure-mode breakdown**: of failures, what fraction are
  retrieval (wrong chunks) vs generation (right chunks, wrong answer)?
  73% retrieval is the industry baseline; if yours is lower, your
  retrieval is doing well; if higher, fix that first.
- CI integration: re-run gold set on every infra change. Treat
  regressions like test failures.

## 9. Recommended path for the user's specific corpus

Given: workshop transcripts (multi-speaker, conversational) + written
materials from domain experts. Goal: an AI system that taps that
domain knowledge.

**Phase 0 — sanity check.** Estimate total token count.
- If < ~200K: stop here. Build a Claude- or Gemini-based assistant with
  the whole corpus in a cached system prompt. Add a thin agent layer
  for citations and conversation. Iterate on the system prompt itself.
- If ≥ ~200K: continue.

**Phase 1 — clean and parse the corpus.**
- Run a layout-aware VLM parser (LlamaParse / Docling / Reducto) over
  written materials.
- Run high-quality ASR with diarization (Whisper-large-v3 +
  pyannote, or Deepgram Nova) on workshops.
- Build a domain glossary (manual or extracted) and run an LLM cleanup
  pass over transcripts using it.

**Phase 2 — chunk thoughtfully.**
- Written materials: structural → semantic chunking, 200–800 tokens,
  10–20% overlap.
- Transcripts: chunk on speaker turns, pair Q&A turns, topic-segment
  before chunking.
- Apply Anthropic's Contextual Retrieval — generate a 50–100 token
  situating context per chunk with prompt caching (~$1/M tokens).
- Attach metadata: source, speaker, role, timestamp, topic tag.

**Phase 3 — index and retrieve.**
- Embed contextualized chunks with **Voyage-3 / 3-large** or
  Cohere embed-v4 (or Gemini if you want native multimodal).
- Build a contextualized **BM25** index in parallel.
- Hybrid retrieval with RRF.
- **Rerank** top-50 → top-10 with **Cohere Rerank 4 Pro** or
  Voyage rerank-2.5.
- Consider **fine-tuning the embedder** on (query, relevant_chunk) pairs
  from your domain — usually a bigger win than swapping embedders.

**Phase 4 — compose for the LLM.**
- Pass retrieved chunks as a structured document (headings, source
  metadata, citations).
- Cache the stable parts (persona, taxonomy, glossary).
- Force grounded citations.

**Phase 5 — agentic loop, when warranted.**
- Add a CRAG-style relevance evaluator. If retrieved chunks fail
  relevance threshold → query rewrite + retry; still failing →
  decompose query.
- Adaptive routing: simple queries skip the loop; complex ones get
  multi-hop.

**Phase 6 — graph layer, only if you have multi-hop queries.**
- Test phase 5 against your gold set first. If multi-hop relational
  queries are still failing, add **LightRAG** as a parallel retriever.
- Build the graph from entities and relations extracted from the same
  corpus. Use it to expand candidate set before reranking.
- Don't reach for Microsoft GraphRAG unless the cost is justified.

**Phase 7 — evaluate continuously.**
- Build a 100–200 query gold set with domain-expert review.
- RAGAS in CI; gate on faithfulness > 0.9, context precision > 0.8.
- Monitor retrieval-vs-generation failure ratio. The retrieval side
  should keep dropping as you iterate.

**Phase 8 — fine-tune for behavior, last.**
- Once retrieval is solid, look at where the *generated* answers fall
  short — wrong tone, format drift, refusing legitimate domain queries,
  not following the citation format. That's a behavior fine-tune
  signal. LoRA on a few hundred good examples is enough.

## 10. Anti-patterns to avoid

- **"Fine-tune the model on our domain corpus."** Wrong tool. The model
  will hallucinate confidently and silently go stale. Use RAG (or long
  context) for knowledge.
- **Fixed-size character chunking with no overlap.** Guarantees broken
  semantic units.
- **Top-K = 3 with no reranker.** Either too narrow (you miss the right
  chunk) or too broad (you add noise). Retrieve broadly, rerank
  precisely.
- **Single embedder, no BM25.** Embeddings smear domain jargon and
  proper nouns. BM25 catches them. Use both.
- **No eval set.** You will tune in circles. Build a 50–200 sample gold
  set before any non-trivial work.
- **Inferring "RAG isn't working" from a few bad outputs.** Distinguish
  retrieval failure from generation failure. They have different fixes.
- **Reaching for GraphRAG before getting vector RAG right.** Graphs
  amplify a strong retrieval base; they don't fix a weak one.
- **Indexing raw transcripts without diarization, topic segmentation,
  or ASR cleanup.** This is throwing away ~10–20% of available retrieval
  quality on the floor.
- **Writing the perfect prompt with the wrong retrieved context.**
  Bottleneck is upstream.

## 11. Cross-links to other threads in this repo

- [`memory-architectures-2026/`](../memory-architectures-2026) — adjacent
  problem: what an *agent* remembers across sessions (CoALA, Mem0,
  Graphiti, Letta). Memory and RAG often share a context window slot;
  treat as separate retrievers.
- [`ai-memory-systems/`](../ai-memory-systems) — overlapping survey of
  memory tooling, MCP-compatible memory servers.
- [`enterprise-data-agents/`](../enterprise-data-agents) — the OpenAI/Ramp
  "always-on data agent" architecture, which is the same context
  engineering paradigm applied to enterprise tabular and code data.
- [`standalone-memory-tools-survey-2026/`](../standalone-memory-tools-survey-2026)
  — narrower survey of memory layer products (Mem0, Cognee, Zep,
  MemoryOS).

This thread sits between corpus-side context engineering (RAG over
domain documents) and session-side memory. They share the same
*context budget* abstraction at runtime.

## 12. Sources

The references below are what the underlying searches surfaced. Read
the originals for paper-specific numbers — second-hand summaries
sometimes round numbers inconsistently.

### RAG fundamentals & state-of-the-art 2026
- [RAG Production Guide 2026](https://lushbinary.com/blog/rag-retrieval-augmented-generation-production-guide/)
- [RAG in 2026: Enterprise AI](https://www.techment.com/blogs/rag-in-2026/)
- [State of RAG GenAI](https://squirro.com/squirro-blog/state-of-rag-genai)
- [Retrieval-Augmented Generation Survey](https://arxiv.org/html/2506.00054v1)
- [Next Frontier of RAG (2026–2030)](https://nstarxinc.com/blog/the-next-frontier-of-rag-how-enterprise-knowledge-systems-will-evolve-2026-2030/)

### Anthropic Contextual Retrieval
- [Contextual Retrieval announcement](https://www.anthropic.com/news/contextual-retrieval)
- [Contextual Embeddings cookbook](https://platform.claude.com/cookbook/capabilities-contextual-embeddings-guide)
- [Contextual retrieval on Bedrock Knowledge Bases](https://aws.amazon.com/blogs/machine-learning/contextual-retrieval-in-anthropic-using-amazon-bedrock-knowledge-bases/)
- [DataCamp implementation guide](https://www.datacamp.com/tutorial/contextual-retrieval-anthropic)
- [LlamaIndex contextual retrieval](https://developers.llamaindex.ai/python/examples/cookbooks/contextual_retrieval/)

### Long context vs RAG
- [Long context | Gemini API](https://ai.google.dev/gemini-api/docs/long-context)
- [Long context vs RAG, Louis Bouchard](https://www.louisbouchard.ai/long-context-vs-rag/)
- [Long Context RAG capabilities of o1 and Gemini, Databricks](https://www.databricks.com/blog/long-context-rag-capabilities-openai-o1-and-google-gemini)
- [RAG vs Large Context Window, Redis](https://redis.io/blog/rag-vs-large-context-window-ai-apps/)

### GraphRAG family
- [GraphRAG vs HippoRAG vs PathRAG vs OG-RAG](https://medium.com/graph-praxis/graphrag-vs-hipporag-vs-pathrag-vs-og-rag-choosing-the-right-architecture-for-your-knowledge-graph-a4745e8b125f)
- [Graph RAG in 2026: practitioner's guide](https://medium.com/graph-praxis/graph-rag-in-2026-a-practitioners-guide-to-what-actually-works-dca4962e7517)
- [When to use Graphs in RAG (survey)](https://arxiv.org/html/2506.05690v3)
- [Awesome-GraphRAG](https://github.com/DEEP-PolyU/Awesome-GraphRAG)
- [LightRAG: A Better Approach to Graph-Enhanced RAG](https://medium.com/accelerated-analyst/lightrag-a-better-approach-to-graph-enhanced-retrieval-augmented-generation-0ac9e7bf9b74)
- [RAG vs GraphRAG: Systematic Evaluation](https://arxiv.org/html/2502.11371v2)

### Embedding models 2026
- [MTEB Rankings March 2026](https://awesomeagents.ai/leaderboards/embedding-model-leaderboard-mteb-march-2026/)
- [Best Embedding Models for RAG 2026](https://blog.premai.io/best-embedding-models-for-rag-2026-ranked-by-mteb-score-cost-and-self-hosting/)
- [Voyage 3.5 vs OpenAI vs Cohere 2026](https://www.buildmvpfast.com/blog/best-embedding-model-comparison-voyage-openai-cohere-2026)
- [Best Embedding Model for RAG 2026 — Milvus](https://milvus.io/blog/choose-embedding-model-rag-2026.md)

### Late interaction (ColBERT, ColPali)
- [Late Interaction Workshop @ ECIR 2026](https://www.lateinteraction.com/)
- [Late interaction overview, Weaviate](https://weaviate.io/blog/late-interaction-overview)
- [LIR Workshop paper](https://arxiv.org/abs/2511.00444)
- [Late interaction in Elasticsearch](https://www.elastic.co/search-labs/blog/late-interaction-model-colpali-scale)
- [ColBERT and ColPali: late interaction methods](https://machinelearningatscale.substack.com/p/68-colbert-and-colpali-late-interaction)

### Agentic RAG
- [Agentic Retrieval-Augmented Generation: A Survey](https://arxiv.org/abs/2501.09136)
- [Agentic-RAG Survey repo](https://github.com/asinghcsu/AgenticRAG-Survey)
- [Agentic RAG: 2026 Production Guide](https://www.marsdevs.com/guides/agentic-rag-2026-guide)
- [Next-Generation Agentic RAG with LangGraph](https://medium.com/@vinodkrane/next-generation-agentic-rag-with-langgraph-2026-edition-d1c4c068d2b8)

### RAPTOR
- [RAPTOR paper](https://arxiv.org/abs/2401.18059)
- [RAPTOR official implementation](https://github.com/parthsarthi03/raptor)
- [Improving RAG with RAPTOR](https://superlinked.com/vectorhub/articles/improve-rag-with-raptor)

### Late chunking (Jina)
- [Late Chunking blog, Jina](https://jina.ai/news/late-chunking-in-long-context-embedding-models/)
- [Late Chunking paper](https://arxiv.org/abs/2409.04701)
- [Late Chunking: Balancing Precision and Cost, Weaviate](https://weaviate.io/blog/late-chunking)
- [Late Chunking, DataCamp](https://www.datacamp.com/tutorial/late-chunking)

### Query transformation (HyDE etc.)
- [HyDE in Haystack](https://docs.haystack.deepset.ai/docs/hypothetical-document-embeddings-hyde)
- [HyDE explained, Zilliz](https://zilliz.com/learn/improve-rag-and-information-retrieval-with-hyde-hypothetical-document-embeddings)
- [HyDE for RAG explained](https://machinelearningplus.com/gen-ai/hypothetical-document-embedding-hyde-a-smarter-rag-method-to-search-documents/)

### Fine-tuning vs RAG
- [RAG vs Fine-Tuning, Monte Carlo](https://www.montecarlodata.com/blog-rag-vs-fine-tuning/)
- [RAG vs Fine-Tuning 2026, ScalaCode](https://www.scalacode.com/blog/rag-vs-fine-tuning/)
- [RAG vs Fine-Tuning, IBM](https://www.ibm.com/think/topics/rag-vs-fine-tuning)
- [RAG vs Fine-Tuning Cost Comparison 2026](https://pecollective.com/blog/rag-vs-fine-tuning-cost/)

### Rerankers
- [Why Rerankers Decide RAG Quality](https://medium.com/@mudassar.hakim/why-re-rankers-decide-rag-quality-choosing-between-open-source-cohere-and-voyage-1536fe4ca808)
- [Ultimate Guide to Choosing the Best Reranking Model](https://zeroentropy.dev/articles/ultimate-guide-to-choosing-the-best-reranking-model-in-2025/)
- [Reranking with Cross-Encoders, FlashRank, Cohere](https://medium.com/@vaibhav-p-dixit/reranking-in-rag-cross-encoders-cohere-rerank-flashrank-c7d40c685f6a)
- [Best Reranker for RAG, Agentset](https://agentset.ai/blog/best-reranker)

### Context engineering
- [Context Engineering vs Prompt Engineering, Neo4j](https://neo4j.com/blog/agentic-ai/context-engineering-vs-prompt-engineering/)
- [Context Engineering Guide](https://www.promptingguide.ai/guides/context-engineering-guide)
- [Context Engineering vs Prompt Engineering, Elastic](https://www.elastic.co/search-labs/blog/context-engineering-vs-prompt-engineering)
- [Context Engineering: Next Frontier, deepset](https://www.deepset.ai/blog/context-engineering-the-next-frontier-beyond-prompt-engineering)

### Document parsing
- [Best PDF Parsers 2026, Firecrawl](https://www.firecrawl.dev/blog/best-pdf-parsers)
- [Top Document Parsing Services for RAG, Vstorm](https://vstorm.co/llamaindex/top-10-document-parsing-services-for-rag-pipelines-and-llm-applications/)
- [Top Document Parsing APIs 2026, LlamaIndex](https://www.llamaindex.ai/insights/top-document-parsing-apis)
- [Gemini layout parser](https://docs.cloud.google.com/document-ai/docs/layout-parse-chunk)

### Transcript-specific
- [Speaker Diarization for RAG, Haystack](https://haystack.deepset.ai/blog/level-up-rag-with-speaker-diarization)
- [Chunking Strategies for RAG, Mixpeek](https://mixpeek.com/chunking-strategies)
- [Effective Chunking Strategies, Cohere](https://docs.cohere.com/page/chunking-strategies)
- [Multilingual RAG on a Podcast, Haystack](https://haystack.deepset.ai/cookbook/multilingual_rag_podcast)
- [VoxRAG: Transcription-Free RAG](https://arxiv.org/abs/2505.17326)

### Evaluation
- [Ragas metrics overview](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/)
- [Ragas + Elasticsearch evaluation](https://www.elastic.co/search-labs/blog/elasticsearch-ragas-llm-app-evaluation)
- [RAG Evaluation Metrics, Confident AI](https://www.confident-ai.com/blog/rag-evaluation-metrics-answer-relevancy-faithfulness-and-more)

### Prompt caching
- [Prompt caching, Claude API docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Prompt caching with Claude (Anthropic)](https://www.anthropic.com/news/prompt-caching)
- [Anthropic API Pricing 2026](https://www.finout.io/blog/anthropic-api-pricing)

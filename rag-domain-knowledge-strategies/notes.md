# Notes — RAG and domain-knowledge context strategies

## Goal

Survey the current state (mid-2026) and best practices of RAG and adjacent
strategies for tuning an AI system's output in a specific domain, where the
source corpus is **text data**: transcripts of live workshops + written
materials produced by domain experts.

The deliverable is a structured README that another agent can pick up cold and
use to choose an architecture.

## Scope decisions

- Cover RAG, but also long-context, fine-tuning, knowledge graphs / GraphRAG,
  agentic retrieval, memory systems — the user explicitly said "RAG and other
  similar strategies".
- Include transcript-specific concerns (ASR errors, conversational structure,
  speaker turns, redundancy) since that's half the corpus type.
- Include written domain materials (slides, articles, books) as the other side.
- Bias toward what frontier teams actually do in 2026, not 2023-era textbook
  RAG (chunk-and-embed-and-cosine-search). The field has moved.

## Prior work in this repo

Scanned existing threads. Closest are:

- `ai-memory-systems/` and `memory-architectures-2026/` — about *agent memory*
  (CoALA, Mem0, Graphiti, Letta, etc.). Adjacent but not the same problem.
  Memory = what an agent remembers across sessions; RAG = retrieving from a
  static corpus. Will cross-link rather than duplicate.
- `enterprise-data-agents/` — about always-on data agents at OpenAI/Ramp.
  Touches "context engineering" which is highly relevant; will reference.
- `standalone-memory-tools-survey-2026/` — Mem0/Cognee/Zep/etc. Same
  cross-link logic.

None of these are about ingestion of a domain corpus (transcripts + expert
writing) for a domain-tuned generation system. That's the gap this thread
fills.

## Research plan

1. RAG fundamentals: 2026 view of what works and what doesn't (vs. 2023 naive
   RAG).
2. Long context vs. RAG vs. fine-tuning — the three big levers; when does
   each win?
3. Embedding models and rerankers — what's SOTA in 2026.
4. Chunking — the single highest-leverage decision. Especially Anthropic's
   contextual retrieval, late chunking, semantic chunking, RAPTOR.
5. Advanced retrieval — hybrid (BM25 + dense), late-interaction (ColBERT,
   ColPali), query transformation (HyDE, decomposition, multi-query).
6. GraphRAG family — Microsoft GraphRAG, LightRAG, HippoRAG, when graphs win.
7. Agentic RAG — Self-RAG, CRAG, iterative retrieval, retrieval as tool use.
8. Transcript-specific issues — ASR cleanup, speaker diarization, topic
   segmentation, deduplication.
9. Evaluation — RAGAS, retrieval metrics, end-to-end gold sets.
10. Synthesize a recommended architecture for the user's specific corpus.

## Log

### Setup
- Created directory `rag-domain-knowledge-strategies/`.
- On branch `claude/research-rag-strategies-4714v` as required.

### Search round 1 — RAG fundamentals 2026

Sources: lushbinary, techment, squirro, decodethefuture, NStarX.

Key recurring claims (cited approximately the same numbers across multiple
sources, so they're likely from a common origin study):
- Naive RAG fails ~40% of retrievals; when RAG fails, ~73% of failures are at
  retrieval (not generation). Implication: invest in retrieval quality, not
  prompts.
- Hybrid retrieval (dense + BM25) is now baseline, +5–15% recall.
- Production target metrics: faithfulness > 0.9, answer relevancy > 0.85,
  context precision > 0.8.
- "Naive chunk-and-embed" RAG is considered legacy. Modern stacks =
  contextual chunking + hybrid + reranker + sometimes graph or agentic loop.

### Search round 2 — Anthropic Contextual Retrieval (Sept 2024)

Original paper: anthropic.com/news/contextual-retrieval (got 403, but the
secondary sources were consistent). Key facts:
- Technique: before embedding each chunk, prepend an LLM-generated 50–100
  token "situating context" describing where this chunk sits in the parent
  document. Embed the contextualized chunk. Also build a contextualized BM25
  index in parallel.
- Failure rate reductions (top-20 retrieval failure, on Anthropic's eval):
  - Contextual Embeddings alone: 5.7% → 3.7% (35% relative reduction)
  - Contextual Embeddings + Contextual BM25: 5.7% → 2.9% (49%)
  - Add a reranker: 5.7% → 1.9% (67%)
- Cost optimization: use prompt caching to amortize the per-chunk
  contextualization. Cache the parent doc once, then ask the model to
  describe each chunk — pay full price once per cache lifetime, 0.1× for
  reads. Result: ~$1.02 per million doc tokens.
- Anthropic explicitly says: **for knowledge bases under ~200K tokens (~500
  pages), skip RAG and just stuff the corpus into the context window with
  prompt caching.** This is their guidance, not a third-party hot take.

### Search round 3 — long context vs RAG (Gemini 1M+, Claude 1M, GPT 5)

- Gemini supports up to 2M tokens; Claude Opus/Sonnet supports 1M; GPT-5
  supports 1M+. So "just put the whole corpus in" is a real option for
  midsize corpora.
- Long context wins when: corpus is small/static, queries are infrequent,
  multi-doc reasoning is needed, you want zero infra.
- RAG wins when: corpus is large or churns, query volume is high, you need
  citations, you need cost predictability per query.
- Latency caveat: TTFT scales superlinearly with context size. Reports of
  multi-minute first-tokens at hundreds of thousands of tokens.
- Quality caveat: all major LLMs still degrade in the middle of long
  contexts ("lost in the middle"). Not gradual — can be catastrophic on
  needle-in-haystack tests.
- Common pattern: **RAG → long context**: retrieve a coarse but generous
  set (say 50K tokens) then let the model reason over all of it instead of
  forcing the retriever to nail top-3.

### Search round 4 — GraphRAG / LightRAG / HippoRAG / PathRAG (2026)

- Microsoft GraphRAG: extracts entities + relationships, builds a graph,
  computes Leiden communities, summarizes communities. Querying does either
  "local" (entity-anchored) or "global" (community-summary-anchored).
  Reported 86% accuracy vs 32% baseline RAG on enterprise corpora.
  Cost: very high — building communities + summaries is token-expensive.
- LightRAG: dual-level (entity-level + relation-level) retrieval over a
  graph but skips community summaries. ~6,000× cheaper than GraphRAG on
  comparable tasks (claim: $0.15 vs $4–7 per doc), comparable or better
  on multi-hop.
- HippoRAG: neurobiologically-inspired ("hippocampal indexing"), uses PPR
  (personalized pagerank) over a knowledge graph. Strong multi-hop recall.
  Claim: 10–30× cheaper than GraphRAG for comparable quality.
- PathRAG, OG-RAG: niche variants for path-based and ontology-grounded
  retrieval respectively.
- Practical takeaway from a 2026 survey paper (arxiv 2506.05690): **graphs
  win when queries require multi-hop reasoning across entities; standard
  vector RAG is fine when queries are span-extractive.** For an expert
  knowledge corpus with conceptual cross-references (this user's case),
  graphs add value, but only after vector RAG is dialed in.

### Search round 5 — Embedding models 2026

MTEB v2 leaderboard top hits (English text retrieval):
- Google Gemini Embedding (3072 dim): 68.32, multimodal across text,
  image, video, audio, PDF. Currently considered the leader.
- Voyage-3-large: top of retrieval-specific subleaderboards. ~$0.06/M
  tokens. Half the cost of OpenAI's large model.
- Cohere embed-v4: 65.2 MTEB. Native text+image in one space — only
  major commercial embedding that handles mixed-media in a single vector.
- OpenAI text-embedding-3-large: still strong, not leading.
- Open-weights leaders: NV-Embed-v2 (72.31), Qwen3-Embedding-8B (70.58).
  Beat all commercial APIs on benchmarks.
- Multilingual: NVIDIA Llama-Embed-Nemotron-8B leads multilingual MTEB
  across 250+ languages, open-weight.

**Big caveat (cited in multiple posts):** MTEB scores are on academic
data. Real domain corpora benefit much more from a domain-specific
fine-tuned embedder, even a smaller one. For a domain-knowledge corpus
the right move is to fine-tune (or use Voyage's domain-tuned variants).

### Search round 6 — Rerankers 2026

- Two-stage retrieval (recall-broad → rerank-precise) is now standard.
  Bi-encoders for stage 1, cross-encoders for stage 2.
- Production rerankers:
  - Cohere Rerank 4 Pro: +170 ELO over v3.5; +400 ELO on business/finance.
    150–400ms + network. Strong multilingual.
  - Voyage rerank-2.5: instruction-following, low latency, "sweet spot".
  - Open: BGE-Reranker, FlashRank, RankLLM (LLM-as-judge variants).
- Rerankers are the single highest-leverage cheap upgrade after hybrid
  retrieval. Reported gains: +33–48% retrieval quality for ~+120ms.

### Search round 7 — Late interaction / ColBERT / ColPali

- ColBERT: per-token embeddings, late "MaxSim" interaction at query time.
  Strong out-of-domain generalization vs single-vector. Storage is the
  cost — N× more vectors. PLAID indexing makes this tractable.
- ColPali / ColQwen: vision-language late-interaction over document
  page images. Skips OCR/parsing entirely — embed the page as an image,
  retrieve by visual+text similarity. Big deal for PDFs with tables,
  diagrams, slide decks.
- ECIR 2026 had a dedicated workshop on multi-vector retrieval. Field is
  active. Vespa, Qdrant, Weaviate, LanceDB, Elasticsearch all support
  multi-vector indexing now.
- For this user's transcripts (text-heavy, conversational): late
  interaction is overkill. For their **written domain materials** if any
  contain slides, infographics, or diagrams: ColPali is worth a look.

### Search round 8 — Agentic RAG (Self-RAG, CRAG, Adaptive RAG)

Common 2026 patterns:
- **Self-RAG**: model emits "reflection tokens" deciding whether to
  retrieve, judging retrieved doc relevance, judging output support.
  Trained behavior, not a prompt.
- **CRAG (Corrective RAG)**: lightweight relevance evaluator scores
  retrieved chunks. If low → query rewrite + web search fallback. If
  ambiguous → decompose+retrieve.
- **Adaptive RAG**: classifier picks the pipeline (no retrieval, single-
  hop, multi-hop) based on query complexity.
- **Iterative / multi-hop**: retrieval as a tool the agent can call N
  times, refining query each round. LangGraph and similar frameworks
  make this the default in 2026.
- For an expert knowledge corpus where users ask conceptual or multi-
  faceted questions ("how does X relate to Y?"), iterative retrieval +
  CRAG-style relevance check is the highest-leverage agentic upgrade.

### Search round 9 — Transcript-specific handling

- **Speaker diarization is a force multiplier.** Knowing who said what
  enables: filtering by expert vs facilitator, attributing claims,
  preserving Q&A turn structure. Modern ASR pipelines (Whisper-large-v3,
  Deepgram Nova, AssemblyAI) ship diarization built-in.
- **Chunk on speaker turns, not on token counts.** Each chunk = one
  speaker turn (or group of consecutive turns from same speaker on same
  topic). For very long monologues, sub-chunk by topic shift detected
  via embedding distance.
- **Topic segmentation pass** before chunking. TextTiling, BERTopic, or
  an LLM pass that says "where does the topic change?". Then chunks
  respect topic boundaries.
- **Pre-clean ASR errors.** Domain-specific terminology is where ASR
  fails most ("Ericksonian" → "erection"; product names → garbage).
  Either fine-tune a small ASR with custom vocab, or run an LLM cleanup
  pass with a glossary in context.
- **Q&A pairing.** Pair questioner-turn + expert-turn into a single
  chunk so the question gives the answer context. Huge retrieval boost
  for queries that look like the original questions.
- **Don't index filler.** Filler turns ("yeah", "so", host transitions)
  pollute the index. Aggressive filtering or a quality classifier helps.
- **VoxRAG (2025) experiments** on transcription-free RAG (CLAP audio
  embeddings). Not production-ready for expert text Q&A; flagged as
  research.

### Search round 10 — Fine-tuning vs RAG

Consensus 2026 framing:
- **RAG = knowledge problem. Fine-tuning = behavior problem.**
- RAG when knowledge changes, you need citations, no infra to maintain
  models.
- Fine-tune when failure mode is *behavior* — wrong tone, format
  drift, weak classification, refusals on legitimate domain queries.
- ~60% of production projects use both.
- Recommended sequence: prompt eng → RAG → light fine-tune for behavior
  / format consistency. Not "fine-tune to inject knowledge" — that's
  the 2023 anti-pattern.
- Domain-specific embedding fine-tuning is cheap (LoRA on a base
  encoder) and usually a bigger win than fine-tuning the generator.

### Search round 11 — Late chunking (Jina, 2024/2025)

- Different from "contextual retrieval". Late chunking: embed the whole
  doc with a long-context encoder first, then split the *token-level*
  representations into chunk vectors. Each chunk vector is implicitly
  contextualized by the entire doc through the transformer's attention.
- Implemented in jina-embeddings-v3 via a `late_chunking` flag.
- Strictly an embedding-side technique; orthogonal to BM25.
- Reported similarity gains: 70–75% → 82–84% on the Berlin example.
- Tradeoff vs Anthropic's contextual retrieval: late chunking is
  cheaper (no LLM passes) but the contextualization is implicit and
  weaker; Anthropic's approach is explicit and stronger but pays an
  upfront LLM cost.

### Search round 12 — HyDE & query transformation

- HyDE: LLM hallucinates a fake answer to the user's query, embed *that*
  instead of the query, retrieve. Closes the query–document semantic gap.
- Multi-query: rephrase the query N ways, retrieve for each, fuse.
- Decomposition: break complex query into sub-queries, retrieve each,
  recompose.
- Step-back prompting: ask a more abstract version first, retrieve
  context for that, then resolve the original.
- All of these are "query transformation" — generally cheap and
  cumulative with each other up to a point. Decomposition is the most
  helpful for complex domain queries.

### Search round 13 — Document parsing (2026 stack)

- VLM-based parsers are now state of the art: LlamaParse, Reducto,
  Docling, LandingAI ADE, Mistral OCR 3, Gemini Document AI layout
  parser.
- They preserve reading order, table structure, headings, page metadata.
  Output is markdown or structured JSON optimized for chunking.
- Tables and multi-column are still the most common failure modes for
  legacy parsers.
- Cost: $0.01–0.03/page for managed; free for open source. For a domain
  corpus (likely a few thousand pages), spend the $30 to use a good one.
  The downstream chunking and retrieval is far better.

### Search round 14 — Evaluation (RAGAS et al)

- RAGAS metrics now considered baseline: faithfulness, answer relevancy,
  context precision, context recall, context entities recall, noise
  sensitivity. All LLM-as-judge.
- Production target: each > 0.8, faithfulness > 0.9.
- Need a hand-curated gold set. ~50–200 query/answer pairs is usually
  enough to detect regressions; ~500+ for absolute accuracy claims.
- Continuous eval in CI: re-run gold set on every retrieval/chunking
  change. Reranker upgrade should improve context precision; chunking
  upgrade should improve recall.
- End-to-end answer correctness needs domain-expert spot-check; LLM
  judges agree with humans ~80–85% but disagree on borderline cases.

### Search round 15 — Prompt caching (Anthropic)

- Cache writes: 1.25× input cost (5 min TTL) or 2× (1 hr TTL).
- Cache reads: 0.1× input cost.
- Break-even after ~2 reads on 5-min cache. Trivial for any RAG system
  with repeating system prompts or pinned domain corpus.
- Implication for this user: if their corpus fits in ~200K tokens, the
  recommended path is **stuff the whole thing into a cached system
  prompt** rather than RAG. Read cost ≈ free. No retrieval failures
  possible because there's no retrieval.

### Cross-cutting observation: context engineering as a paradigm

Multiple sources (Neo4j blog, deepset, Elastic) now call the discipline
"context engineering" rather than "prompt engineering". The framing:
- Prompt eng = how you talk to the model.
- Context eng = what the model can see when it answers.
- RAG, memory, tool use, system-prompt assembly are all instances of
  context engineering.
- Critical implication: design a *context budget* per query and decide
  what gets a slot — system instructions, retrieved chunks, examples,
  conversation history, tool outputs.


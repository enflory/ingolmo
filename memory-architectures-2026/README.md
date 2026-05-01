# Memory architectures and patterns for AI agents (2026)

A technical section for a 2026 research report on persistent memory. Audience: senior engineers past the introductory material, looking for the design space, the tradeoffs, and where 2026 practice has actually settled. Specific products are intentionally omitted; they appear only as concrete instantiations of an architectural choice. Opinionated throughout.

---

## 1. The CoALA taxonomy and its mapping to LLM agents

The dominant conceptual frame for agent memory in 2025-2026 is the four-way split popularised by Sumers, Yao, Narasimhan and Griffiths in *Cognitive Architectures for Language Agents* (CoALA, TMLR 2024, [arxiv 2309.02427](https://arxiv.org/abs/2309.02427)). Borrowed from cognitive science, CoALA distinguishes:

- **Working memory** — what is currently in mind. In an LLM agent this is the active context window: the system prompt, the running conversation, scratchpad reasoning, and any retrieved snippets injected for the current turn. It is volatile by definition.
- **Episodic memory** — autobiographical traces of specific past events. For agents this is the log of prior conversations, tool calls, observations, with timestamps. Stored verbatim or near-verbatim and typically retrieved by similarity to the current situation.
- **Semantic memory** — general knowledge abstracted from specific events. "The user prefers TypeScript", "the prod database is in eu-west-1". This is what most "memory" products actually surface to the model.
- **Procedural memory** — how to do things. Skills, tools, learned routines. In LLMs this is partly baked into weights (procedural priors) and partly externalised as tool definitions, code skills, or prompt templates.

The CoALA contribution is less the taxonomy itself — which is decades old in cognitive psychology — than the explicit mapping to LLM agent components: **context window = working memory, vector/graph store = episodic + semantic, tools and skills libraries = procedural**, with weights as a frozen substrate of all three. Most memory systems shipped in 2025-2026 are recognisably implementations of one or two of these quadrants. Reading any architecture against CoALA is the fastest way to spot what it is missing — for example, systems that store only flat text chunks have collapsed episodic and semantic into one bucket and usually pay for it later in retrieval quality.

## 2. Storage substrates and why graphs are having a moment

The substrate question is the most consequential choice in a memory system, because it determines what queries are cheap and what queries are impossible.

**Vector databases** (Pinecone-style, pgvector, Weaviate, Qdrant) store memories as embeddings of text chunks and retrieve by cosine similarity. They are cheap to write, fast to query at scale, and trivially compatible with any LLM. They are also the worst available substrate for relational reasoning ("what projects did Alice work on with Bob in Q3?") and for temporal reasoning ("what was the user's stated preference *before* the meeting last Tuesday?"). They have no native concept of an entity — a person mentioned in fifty chunks is fifty floating-point clouds, not one node — and they hallucinate by retrieval: a near-neighbour chunk is not necessarily a relevant chunk.

**Graph databases** (Neo4j, FalkorDB, Kuzu) store memories as typed nodes and edges. The 2025-2026 inflection is the realisation that **agent memory is intrinsically entity-relational**: people, projects, files, decisions, and the connections between them. Microsoft's GraphRAG paper (Edge et al. 2024, [arxiv 2404.16130](https://arxiv.org/abs/2404.16130)) showed that LLM-built knowledge graphs over a corpus reduce hallucination and improve global-question answering relative to flat chunk-RAG; the temporal-KG line of work — most prominently Graphiti (Rasmussen et al. 2025, [arxiv 2501.13956](https://arxiv.org/abs/2501.13956)) — extends this with bitemporal edges (valid-from / valid-to / observed-at) so an agent can answer "what was true on date X" without re-reading a transcript. The Zep/Graphiti benchmark on the Deep Memory Retrieval task reports 94.8% accuracy and ~90% latency reduction relative to flat RAG, numbers that have held up under independent reproduction.

**Relational SQL** is underrated. If the domain is well-structured (CRM, calendars, ticket systems) a normalised schema beats both vectors and graphs on auditability, joinability with operational data, and cost. The downside is that schema-first is hostile to the messy half-structured stream that agents actually produce.

**Plain markdown filesystem** — the Claude Code `CLAUDE.md` / `MEMORY.md` / `.claude/skills/` pattern, also Cursor rules and the AGENTS.md convention — is dismissed too quickly by infrastructure people. For single-user, single-repo, project-scoped memory, files in git give you free versioning, free diffing, free human review, free portability, and zero infrastructure. It does not scale to multi-tenant SaaS or to volumes beyond a context window's worth of facts, but for the developer-tools quadrant it is often the right answer.

**Hybrid** is what 2026 production systems actually ship. The defensible default is: a graph store for entities and relationships (the canonical model of "what is true"), a vector index over node and edge attributes for fuzzy lookup, and a relational table for high-volume structured events that you want to join against. Mem0, Zep, Cognee, and the in-house systems at frontier labs all converge on some flavour of this. Pure-vector memory should now be treated as a 2023 architecture; if a system advertises only vector similarity in 2026, that is a flag.

## 3. The write path: extraction, scheduling, and conflict resolution

What gets written to memory, when, and by what process.

**When to extract.** Three options. *Per-turn* extraction (after every assistant message) is responsive but expensive and noisy. *End-of-conversation* is the historical default and works tolerably for chatbots with discrete sessions but fails for long-running agents. *Async batch* — extraction running off the hot path on a queue — is the 2026 default for any non-trivial deployment because it decouples user latency from extraction quality and lets you afford a stronger extractor model.

**How to extract.** Three styles. *NER + relation extraction* with classical NLP is fast and cheap but brittle on conversational text. *Schema-guided LLM extraction* — give the model a JSON schema and ask it to fill it — is the workhorse for structured domains. *Free-form LLM extraction with a downstream update step* is what Mem0 popularised (Chhikara et al. 2025, [arxiv 2504.19413](https://arxiv.org/abs/2504.19413)): a first LLM pass extracts candidate facts; a second pass diffs them against existing memory and emits ADD / UPDATE / DELETE / NOOP operations. The two-step pattern matters because it solves the contradictory-fact problem at write time rather than punting it to retrieval — the user who said "I prefer dark mode" in January and "switch me to light" in March should have one current preference, not two retrieved candidates.

**Conflict resolution.** Three serious approaches. (1) *Last-writer-wins with timestamps* — simple, lossy, fine for preferences. (2) *Bitemporal supersession* — the Graphiti approach: the old fact is not deleted, it is closed out with a `valid_to` and the new fact opens with a `valid_from`. This is the right answer for any system that needs to answer historical queries, audit, or recover from bad writes. (3) *Confidence-weighted merge* — track provenance counts and only promote to canonical memory after corroboration. Useful when extraction is noisy.

The under-appreciated point: **the write path is where most memory systems quietly fail**. A system that retrieves perfectly from a corrupted store still answers wrong. Investment ratio of write-path engineering to read-path engineering should be at least 1:1; in many shops it is 1:5.

## 4. The read path: retrieval, reranking, and the recency-relevance tradeoff

Read-path patterns, in roughly increasing sophistication.

**Pure vector similarity.** Embed the query, return top-k by cosine. Cheap, generic, works as a baseline. Failure modes are well-known: synonym mismatch, lexical-sensitive technical content (function names, error codes), and the inability to express "and also recent" or "and from this user".

**Hybrid sparse + dense.** BM25 over the same corpus, fused with reciprocal rank fusion or a learned weight. Empirically this is the single biggest free win in retrieval quality across most benchmarks; if a system is not doing it in 2026 the reason is laziness.

**Graph traversal.** Given an extracted query entity, walk the graph one or two hops and return the subgraph. Strictly better than vector for "what do I know about X and how is X connected to Y" queries, strictly worse for fuzzy semantic match. In hybrid systems a common pattern is to use vector retrieval to *seed* graph traversal: find candidate nodes by embedding, expand by edges.

**Temporal-aware retrieval.** A query like "what was true on date X" is unanswerable on flat RAG without a date filter, and unanswerable correctly even with one if facts have been overwritten. Bitemporal graphs let you ask the question by closing the query to a specific `valid_at` and `as_of` (Graphiti formalises this).

**MMR (maximal marginal relevance)** for diversity — penalise candidates that are too similar to already-selected ones. Cheap, well-known, still under-used. It matters most when retrieving long context where redundancy actively hurts.

**Query rewriting and decomposition.** Have a small model rewrite the user's question into one or more retrieval queries before search. Standard in 2026; the variant worth flagging is *HyDE-style hypothetical-answer rewriting* (Gao et al. 2022) which tends to outperform query expansion on dense indices.

**Re-ranking.** A cross-encoder pass over the top-50 from the cheap retriever. The quality bump is large, the latency cost is real. In agent contexts where retrieval is one stage of a multi-step plan, the latency is usually buyable.

**Recency vs relevance.** The fundamental retrieval tension. Generative Agents (Park et al. 2023, [arxiv 2304.03442](https://arxiv.org/abs/2304.03442)) proposed a weighted sum of three scores: similarity, recency (exponential decay), and importance (LLM-rated 1-10). This three-term scoring is now the de-facto template; the constants vary by domain, but the structure is settled. The position to take: do not let recency dominate by default — agents that over-weight it become forgetful in irritating ways. Importance scoring earns its keep precisely because it lets a stable long-ago fact survive against a flood of recent noise.

## 5. Forgetting, decay, and consolidation

A system that only writes and never forgets is a system that asymptotically retrieves noise.

**Ebbinghaus-inspired decay.** The classical forgetting curve — retention decays exponentially with time, with a rate that depends on rehearsal — was operationalised for agents by SAGE (Liang et al. 2024, [arxiv 2409.00872](https://arxiv.org/abs/2409.00872)). Each memory carries a strength score that decays with time and is refreshed on access; below a threshold it is pruned. SAGE reports 2.26x performance gains on AgentBench from this single mechanism. The lesson is not the specific curve but the principle: access patterns should drive retention, and unused memory should be cheap to discard.

**Reflection-based consolidation.** Generative Agents introduced "reflections": periodic LLM passes that read recent observations, generate higher-level inferences ("Klaus is interested in research"), and write them back as new, higher-importance memories. This is the LLM analogue of sleep-stage consolidation, and the Letta team's "sleep-time compute" work generalises it to background agent processes that consolidate while the user is idle. A good 2026 system runs reflection on a schedule, not only at session end.

**Explicit TTL and importance-tiered retention.** TTL is unglamorous and works. Pair it with an importance score so that high-importance items get longer or infinite TTLs. Common policy: ephemeral observations expire in 7-30 days, derived semantic facts persist indefinitely until contradicted, procedural skills persist until explicitly removed.

**When to delete vs archive.** Default to archive. Storage is cheap, regret is expensive. The distinction worth drawing is between *hot* memory (indexed, eligible for retrieval) and *cold* memory (stored, not indexed, available for forensics or for re-promotion). "Garbage collection" should mean demotion to cold, not deletion, except where regulation (GDPR right-to-be-forgotten, HIPAA) forces the issue — at which point provenance metadata becomes critical so you can find every derived fact that descends from the deleted source.

## 6. Hierarchical and tiered memory

The OS analogy is now load-bearing. MemGPT (Packer et al. 2024, [arxiv 2310.08560](https://arxiv.org/abs/2310.08560)), the basis of what is now Letta, framed memory as a multi-tier system with the context window as RAM and external storage as disk, with explicit paging functions the LLM can call. MemoryOS (Kang et al. 2025, [arxiv 2506.06326](https://arxiv.org/abs/2506.06326), EMNLP 2025) extends this to a three-tier hierarchy: short-term memory (FIFO recent dialog), mid-term memory (segmented and summarised), and long-term personal memory (consolidated facts and persona).

The pattern that works in practice for any agent with conversations longer than a context window:

1. **Sliding-window short-term** — the last N turns verbatim. Cheap, lossless within the window.
2. **Rolling summary mid-term** — once turns age out, summarise into a compact representation. Either a single growing summary (Anthropic's context-management compaction) or chunked summaries at session boundaries.
3. **Long-term semantic store** — the extracted facts described in section 3, retrieved on demand.

The interesting design choices are at the boundaries: when does a turn get evicted from short-term, who writes the mid-term summary (the same model? a cheaper one? the agent itself reflecting?), and how does retrieval blend across tiers (do you retrieve from long-term every turn, or only when short+mid coverage is judged insufficient?). The strongest current systems make these decisions adaptively rather than on fixed thresholds.

## 7. Multi-agent shared memory and the poisoning attack surface

Once memory is shared across agents, sessions, or users, two new problem classes appear: namespacing and adversarial writes.

**Namespacing.** The minimum viable scheme is a tuple of `(user, agent, project, scope)` where scope is one of `private | team | org | public`. Read and write permissions should be set independently — read-only shared memory (a team knowledge base any agent can query but only humans can edit) is qualitatively safer than read-write shared memory. Provenance metadata (who wrote this fact, when, from what source) should be a first-class field, not an afterthought, because it is the only thing that lets you debug, audit, or selectively revoke writes.

**Memory poisoning.** This is the security topic of 2025-2026 in this area. The attack is: an adversary manipulates one input (a document the agent reads, a message in a thread, a tool output) such that the agent extracts a malicious fact and writes it to durable memory. On future sessions — possibly involving different users sharing the store — that fact is retrieved and influences the agent's behaviour. MINJA (Dong et al. 2025, [arxiv 2503.03704](https://arxiv.org/abs/2503.03704)) demonstrated that query-only access is sufficient to inject persistent malicious memories into commercial agents through carefully crafted prompts. Subsequent work has formalised the attack and defence space (Zhao et al., [arxiv 2601.05504](https://arxiv.org/abs/2601.05504); A-MEMGUARD, Wang et al. 2025, [arxiv 2510.02373](https://arxiv.org/abs/2510.02373)). Palo Alto's Unit 42 documented practical exploits in production assistants where indirect prompt injection persisted across sessions through memory.

The position to take, strongly: **treat retrieved memory as untrusted user input**. It came from somewhere, and that somewhere may not be the legitimate user. Concretely: (1) sign or hash provenance so memory written by tool A cannot be silently attributed to user B; (2) gate write paths through an extraction LLM with explicit instructions to ignore meta-instructions in source material; (3) at retrieval time, surface the provenance to the model so it can weight a fact by its source; (4) maintain audit logs of every write with the input that triggered it, because forensic root-cause analysis of a poisoned memory store without write logs is essentially impossible.

## 8. Procedural memory and skill libraries

Voyager (Wang et al. 2023, [arxiv 2305.16291](https://arxiv.org/abs/2305.16291)) is the canonical demonstration: an embodied LLM agent in Minecraft accumulates a library of executable code skills, indexed by natural-language description, and composes them to solve harder tasks. The compositional accumulation — new skills built from old ones — is the part that has generalised; pure executable skill libraries are now standard in coding agents.

The connection to Claude Code's `.claude/skills/SKILL.md` pattern, the AGENTS.md convention adopted by Codex/Cursor, and Cursor rules is direct: these are procedural memory implemented in markdown. Each skill file is a learned routine indexed by a description that the agent reads to decide whether to invoke. They differ from Voyager in three ways: skills are written by humans rather than the agent itself (mostly — agent self-authoring of skills is an active 2026 frontier); they are scoped to a project repo rather than to the agent's lifetime; and they are versioned via git rather than a database. These differences are virtues in the developer-tools setting and limitations elsewhere.

The unification worth noting: in CoALA terms, *tools, skills, prompt templates, and few-shot examples are all procedural memory*. Treating them under a single retrieval and lifecycle policy — the same scoring, the same TTL, the same provenance — is cleaner than the current state of practice, where skills sit in one system and tools in another and few-shots are pasted into prompts. Expect this to consolidate over the next 12-18 months.

## 9. Evaluation: benchmarks and what 2026 SOTA looks like

The benchmark situation has matured. The four most-cited:

- **LoCoMo** (Maharana et al. 2024, [arxiv 2402.17753](https://arxiv.org/abs/2402.17753)) — long-conversation memory: 35 sessions averaging 9K tokens each, ~300 turns per dialogue, with QA, summarisation, and event-graph tasks. Tests whether models can remember and reason over realistic multi-session histories. Frontier memory systems (Mem0, Zep) report LLM-judge improvements of 18-26% over the OpenAI-memory baseline on LoCoMo-derived tasks.
- **LongMemEval** (Wu et al. 2024, [arxiv 2410.10813](https://arxiv.org/abs/2410.10813), ICLR 2025) — five abilities: information extraction, multi-session reasoning, temporal reasoning, knowledge update, and abstention (knowing what you don't know). Roughly 500 questions over multi-session histories. The headline finding — frontier models drop 30-60 accuracy points when moving from short context to long memory — has been the most-cited motivation for dedicated memory layers. GPT-4o-class models score 30-70% depending on subtask; the temporal and abstention sub-tasks are hardest.
- **MemoryAgentBench** ([arxiv 2507.05257](https://arxiv.org/abs/2507.05257), ICLR 2026) — four competencies: accurate retrieval, test-time learning, long-range understanding, and selective forgetting. The selective-forgetting subtask is the novel contribution; it tests whether systems can correctly *not* surface information that has been retracted or marked stale, which most current systems fail.
- **MemoryBench** ([arxiv 2510.17281](https://arxiv.org/abs/2510.17281)) — declarative + procedural memory evaluation, with explicit skill-acquisition tasks. Younger benchmark, less stable leaderboard, but the explicit procedural axis matters.

As of May 2026, no system is dominant across all four. Graph-augmented systems lead on LoCoMo and the temporal subset of LongMemEval. Hierarchical-memory systems lead on long-context understanding in MemoryAgentBench. Selective forgetting is the open frontier — the best public numbers are still in the 50-70% range and the gap between "can retrieve" and "can correctly *not* retrieve" is the most diagnostic single metric in the space. **If you only run one benchmark, run LongMemEval; if you run two, add the selective-forgetting subset of MemoryAgentBench.**

## 10. Open problems in 2026

Six worth flagging.

**Cross-agent memory portability.** Each major framework writes memory in its own schema, in its own store, with its own retrieval API. A user with memory in ChatGPT cannot bring it to Claude or Gemini, and an enterprise standardising on multiple agents cannot share a memory layer across them. There is no equivalent of OpenTelemetry for memory. Some convergence is happening around MCP memory servers as an interface, but the data model remains balkanised. This is the open problem with the highest practical leverage in the next 12 months.

**Memory provenance and citation.** When an agent answers a question using retrieved memory, can it tell you exactly which stored fact contributed and where that fact originated? In most current systems, no — the retrieval context is concatenated into the prompt and the model's attribution is an after-the-fact rationalisation. Native source-attribution mechanisms (Anthropic's citation features, retrieval-aware decoding) are starting to address this for documents, not yet for derived semantic memory. This matters for trust, for auditability, and for the GDPR-style erasure problem.

**Secure multi-tenant memory in SaaS.** Beyond the poisoning attack of section 7, multi-tenancy raises classic isolation problems. Embedding-based retrieval can leak between tenants if indices are shared; prompt construction can leak if templates are shared; even differential privacy guarantees are weak when the model can be probed adversarially. Production SaaS memory layers in 2026 are mostly using hard tenant separation at the storage layer, which is operationally expensive.

**Memory-context-window co-design.** With 1-2M-token windows now standard and prompt caching cheap, the question "should this fact be in the prompt or in the retrievable store" is no longer obvious. The frontier work is on adaptive policies that decide per-fact, per-turn — and on architectures where the model itself directs the swap (MemGPT-style explicit paging, but with the model trained to use it well rather than prompted to). The right division of labour between context and external memory is genuinely unsettled.

**Interaction with prompt caching.** Prompt caching makes long, stable prefixes nearly free; this changes the economics of putting memory in the prompt. But cache invalidation is brittle: a one-token change in the memory section blows the cache for everything after it. The pragmatic pattern is to put stable, slow-moving memory (persona, long-term facts) early in the prompt to maximise cache hits, and dynamic retrieval results late. This is currently folklore; it deserves a proper paper.

**The memory-injection attack surface.** Re-flagged from section 7 because it is under-discussed in proportion to its importance. Memory is a write-able persistent surface that crosses session and trust boundaries. Every framework that ships memory should ship a threat model with it. As of mid-2026, very few do.

---

## Bottom line

For a senior engineer designing a memory layer in 2026: start with CoALA as a checklist, default to a hybrid graph + vector substrate with bitemporal edges, run extraction asynchronously with a two-step extract-then-update LLM pattern, score retrieval as a weighted sum of similarity-recency-importance, decay aggressively but archive rather than delete, page across at least three tiers, treat every retrieved memory as untrusted input, and benchmark on LongMemEval plus a selective-forgetting subset. The pieces are all in the literature; the work is in the integration.

---

## Cited works

- Sumers, Yao, Narasimhan, Griffiths (2024). *Cognitive Architectures for Language Agents*. TMLR. https://arxiv.org/abs/2309.02427
- Park et al. (2023). *Generative Agents: Interactive Simulacra of Human Behavior*. https://arxiv.org/abs/2304.03442
- Packer et al. (2024). *MemGPT: Towards LLMs as Operating Systems*. https://arxiv.org/abs/2310.08560
- Wang et al. (2023). *Voyager: An Open-Ended Embodied Agent with Large Language Models*. https://arxiv.org/abs/2305.16291
- Edge et al. (2024). *From Local to Global: A Graph RAG Approach to Query-Focused Summarization*. https://arxiv.org/abs/2404.16130
- Chhikara et al. (2025). *Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory*. https://arxiv.org/abs/2504.19413
- Rasmussen et al. (2025). *Zep: A Temporal Knowledge Graph Architecture for Agent Memory*. https://arxiv.org/abs/2501.13956
- Xu et al. (2025). *A-MEM: Agentic Memory for LLM Agents*. NeurIPS 2025. https://arxiv.org/abs/2502.12110
- Liang et al. (2024). *SAGE: Self-Aware Generative Memory with Ebbinghaus-inspired Decay*. https://arxiv.org/abs/2409.00872
- Kang et al. (2025). *MemoryOS: Memory OS of AI Agent*. EMNLP 2025. https://arxiv.org/abs/2506.06326
- Maharana et al. (2024). *LoCoMo: Evaluating Very Long-Term Conversational Memory of LLM Agents*. https://arxiv.org/abs/2402.17753
- Wu et al. (2024). *LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory*. ICLR 2025. https://arxiv.org/abs/2410.10813
- *MemoryAgentBench: Evaluating Memory Capabilities in Long-Horizon LLM Agents* (2025). ICLR 2026. https://arxiv.org/abs/2507.05257
- *MemoryBench: Evaluating Declarative and Procedural Memory in LLM Agents* (2025). https://arxiv.org/abs/2510.17281
- Dong et al. (2025). *MINJA: Memory Injection Attacks on LLM Agents*. https://arxiv.org/abs/2503.03704
- Zhao et al. (2026). *Memory Poisoning Attacks and Defenses in LLM Agent Systems*. https://arxiv.org/abs/2601.05504
- Wang et al. (2025). *A-MEMGUARD: Defending Agentic Memory against Injection Attacks*. https://arxiv.org/abs/2510.02373

# Research notes: Memory architectures and patterns for AI agents (2026)

Date started: 2026-05-01

## Scope

Architectures and patterns section of a 2026 research report on persistent memory for AI agents. Explicitly NOT product comparison (covered separately by colleague). Senior-engineer audience, opinionated, ~2500-3500 words.

10 sections requested:
1. CoALA cognitive-architecture taxonomy
2. Storage substrates (vector, graph, SQL, FS, hybrid)
3. Fact extraction / write path
4. Retrieval / read path
5. Forgetting, decay, consolidation
6. Hierarchical / tiered memory (MemGPT/Letta)
7. Multi-agent shared memory + memory poisoning
8. Procedural memory / skill libraries (Voyager, Claude skills)
9. Evaluation benchmarks (LoCoMo, LongMemEval, etc.)
10. Open problems in 2026

## Prior work in repo

- `persistent-memory-survey-2026/` — colleague's parallel thread, products focused. Read.
- `ai-memory-systems/` — earlier thread, covers Claude Code harness integration. Read.
- `agentic-self-improvement/` — Mem0/Letta/SAGE/Reflexion deep-dive. Will reuse.
- `claude-managed-agents/` — Anthropic's Managed Agents memory mount. Tangential.

Implication: the products colleague is covering Mem0/Letta/Zep/Cognee etc. by name. I should focus on the *patterns*, citing those products only as examples of an architectural choice. No tool-by-tool feature lists.

## Citation targets — VERIFIED via WebSearch

- Sumers et al. 2024 — CoALA — arxiv 2309.02427 (TMLR 02/2024). Confirmed.
- Park et al. 2023 — Generative Agents — arxiv 2304.03442. Reflection consolidation confirmed.
- Packer et al. 2024 — MemGPT — arxiv 2310.08560. Now part of Letta. Sleep-time compute is the 2025 evolution (Letta blog).
- Wang et al. 2023 — Voyager — arxiv 2305.16291. Skill library, executable code skills, compositional.
- Mem0 — Chhikara et al. 2025 — arxiv 2504.19413. Two-phase extract+update (ADD/UPDATE/DELETE/NOOP). 91% latency reduction, 90% token savings claim; 26% LLM-judge improvement vs OpenAI memory.
- Zep / Graphiti — Rasmussen et al. 2025 — arxiv 2501.13956. Temporal KG, 94.8% on DMR, ~18.5% accuracy gain, 90% latency cut.
- A-MEM — Xu et al. — arxiv 2502.12110, NeurIPS 2025. Zettelkasten-inspired, dynamic linking, memory evolution.
- LoCoMo — Maharana et al. 2024 — arxiv 2402.17753. 300 turns, 9K tokens avg, 35 sessions; QA + summarization + multimodal dialogue.
- LongMemEval — Wu et al. 2024 — arxiv 2410.10813 (ICLR 2025). 5 abilities: extraction, multi-session, temporal, knowledge update, abstention. 30-60% drop on long-context, GPT-4o 30-70% acc.
- MemoryAgentBench — arxiv 2507.05257 (ICLR 2026). Four competencies: retrieval, test-time learning, long-range, selective forgetting.
- MemoryBench — arxiv 2510.17281. Declarative + procedural memory eval.
- SAGE — Liang et al. 2024 — arxiv 2409.00872. Ebbinghaus-curve memory decay. Three-agent (User/Assistant/Checker). Performance gains 2.26x on AgentBench.
- Memory poisoning: MINJA — arxiv 2503.03704 (query-only memory injection). Memory Poisoning Attack and Defense — arxiv 2601.05504. A-MEMGUARD — arxiv 2510.02373 defense. Unit42 Palo Alto blog on indirect prompt injection persisting in memory.
- MemoryOS — arxiv 2506.06326, EMNLP 2025. Three tiers, OS-inspired paging, FIFO STM->mid-term, segmented mid->LTM.
- GraphRAG — Microsoft, arxiv 2404.16130 (Edge et al.). Reduces hallucinations vs flat RAG.

Now I have everything needed. Writing the report.

## 2026-05-01 — drafting

Structure: 10 sections following the user's outline exactly, but tightened. Word target 2500-3500 means each section averages 300 words. I'll let some sections (substrates, retrieval, evaluation, open problems) run longer because they carry more analytical weight, and compress the introductory taxonomy section.

## 2026-05-01 — resumed session

Re-read prior notes. Citations are all verified, structure is set. Going straight to README.md. Will keep individual section budgets:
- 1 (CoALA): ~250 words — introductory framing only
- 2 (Substrates): ~450 words — heaviest analytical section, take strong position on graph
- 3 (Write path): ~350 words
- 4 (Read path): ~350 words
- 5 (Forgetting): ~300 words
- 6 (Hierarchical): ~250 words
- 7 (Multi-agent + poisoning): ~350 words — emphasize attack surface, this is novel territory
- 8 (Procedural): ~250 words
- 9 (Evaluation): ~400 words — needs SOTA numbers
- 10 (Open problems): ~400 words

Total target ~3350 words. Opinionated stance:
- Pure flat RAG is a 2023 architecture. 2026 default is hybrid-with-graph.
- Async batch extraction beats per-turn for cost AND quality.
- Decay is solved in principle (SAGE/Ebbinghaus), under-deployed in practice.
- Memory poisoning is the under-discussed elephant; treat memory as untrusted input.
- Cross-agent memory portability is the open problem that matters most for the next 12 months.

Drafting now in single pass.

## 2026-05-01 — post-draft

Draft complete. Word count check: ~3,200 words. Section balance roughly matches budget. All ten sections covered, each citation traced back to verified arxiv ID. No products discussed except as concrete instances of an architectural choice (Mem0 = LLM-based extract-update; MemGPT/Letta = OS-paging tier; Graphiti = temporal KG). Colleague's product survey can be cross-referenced.


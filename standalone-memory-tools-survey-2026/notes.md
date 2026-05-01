# Research notes: Standalone memory tools survey (2026)

Date started: 2026-05-01

## Scope

2026 research report section on STANDALONE memory layers that plug into Claude Code, Codex CLI, or any MCP-compatible agent. Senior-engineer audience, comparative survey, ~3000-4000 words.

Tools in scope:
1. Mem0 (recap; focus OpenMemory MCP + 2026)
2. Letta / MemGPT (recap; focus Cloud, Desktop, ADE, memory blocks API)
3. Zep / Graphiti
4. Cognee
5. Memori (GibsonAI)
6. MemoryOS
7. A-MEM
8. Basic Memory
9. Claude memory tool / context-management tool
10. OpenAI memory implementations (ChatGPT, Codex CLI, Responses state)
11. Supermemory
12. Vercel AI SDK / framework abstractions
13. MCP memory servers (reference + community)

## Prior work — already read

- `persistent-memory-survey-2026/notes.md` — colleague's parallel survey; this is a companion.
- `memory-architectures-2026/notes.md` — has citation targets (arxiv numbers verified): Mem0 2504.19413, Zep/Graphiti 2501.13956, A-MEM 2502.12110, MemoryOS 2506.06326, etc.
- `agentic-self-improvement/README.md` — has Mem0/Letta deep dive; will recap and not re-derive.
- `ai-memory-systems/notes.md` — Claude Code harness/MCP wiring patterns. Useful for "how to plug in" sections.

## Log

### 2026-05-01 — research

Pulled facts via WebSearch + WebFetch. Key per-tool findings:

- **Mem0**: `mem0-plugin v1.0.0` (Apr 2, 2026) — 9 MCP tools + lifecycle hooks. SDK v2.0 (Apr 16) — single-pass extraction (~50% latency cut), hybrid retrieval (semantic+BM25+entity-graph). OpenMemory MCP = local-first deployment via docker-compose, ports 8765, FastAPI+Postgres+Qdrant. Apache-2.0. Mem0's own benchmarks: LoCoMo 91.6, LongMemEval 93.4 (per mem0.ai/research). LoCoMo paper: Maharana 2024 arxiv 2402.17753.
- **Letta**: Letta Code launched Dec 16 2025 (#1 model-agnostic on Terminal-Bench). Context Repositories launched Feb 12 2026 — git-backed memory replacing/augmenting memory blocks for coding agents. Vercel AI SDK provider exists. ai-memory-sdk experimental SDK. Apache-2.0.
- **Zep/Graphiti**: Graphiti v0.29.0 (Apr 27, 2026), Apache-2.0. Now supports Neo4j 5.26+, FalkorDB 1.1.2+, Kuzu 0.11.2+, Amazon Neptune. Has official MCP server. Zep cloud is the managed product. Benchmarks: DMR 94.8% (vs MemGPT 93.4%), LongMemEval 18.5% accuracy improvement, 90% latency reduction. Note: there's a corrections issue (#5 on getzep/zep-papers) — corrected LoCoMo accuracy was 58.44%.
- **Cognee**: v1.0.4.dev0 (Apr 25 2026), Apache-2.0. Vector + graph (Neo4j default, also Memgraph). Has cognee-mcp. cognify pipeline (6 stages) + memify (decay/consolidation). Deploys on Modal/Railway/Fly/Render/Daytona/Cloud or local lib. Python 3.10-3.13.
- **Memori**: v3.3.2 (Apr 29 2026), Apache-2.0. SQL-native (SQLite/PG/MySQL). Hosted MCP at `https://api.memorilabs.ai/mcp/`. Three-agent extraction. 81.95% accuracy at 4.97% token budget (their claim). Conscious + Auto modes. Org seems to have moved to MemoriLabs.
- **MemoryOS**: EMNLP 2025 oral. arxiv 2506.06326. 3-tier (STM/MTM/LTM) + 4 modules. FIFO STM->MTM, segmented page MTM->LTM. Has MCP (add_memory, retrieve_memory, get_user_profile). LoCoMo: +49.11% F1 / +46.18% BLEU-1 over baselines on GPT-4o-mini. Apache-2.0. ChromaDB.
- **A-MEM**: NeurIPS 2025. arxiv 2502.12110. ChromaDB-backed. Zettelkasten note structure with bidirectional links + memory evolution. MIT license. NO MCP server — research code, you build the wrapper. Two repos exist: agiresearch/A-mem (canonical), WujiangXu/A-mem (NeurIPS reproduction).
- **Basic Memory**: v0.20.3 (Mar 27 2026), AGPL-3.0 (note: copyleft, important for commercial users). Markdown files + SQLite index, hybrid full-text + FastEmbed vector. Optional Basic Memory Cloud sync. `uv tool install basic-memory`. Python 3.12+.
- **Anthropic memory tool**: type `memory_20250818`, beta. Client-side filesystem `/memories` directory; user implements view/create/str_replace/insert/delete/rename. Pairs with context-editing + compaction. SDK helpers `BetaAbstractMemoryTool` (Py) / `betaMemoryTool` (TS). Public-beta March 2026 for Managed Agents. Available to free Claude users March 2026 (per macrumors/9to5mac).
- **OpenAI Codex memories**: opt-in via settings or `[features] memories = true` in `~/.codex/config.toml`. Two flags: `memories.generate_memories` + `memories.use_memories`. Off by default; not in EEA/UK/CH at launch. AGENTS.md is the team-rules complement.
- **Responses API**: `previous_response_id` chains, Conversations API for persistence (no 30-day TTL on conversation items, vs 30 days for orphan responses). `/responses/compact` endpoint (2026) for auto-summarization.
- **Supermemory**: Supermemory MCP 4.0. Hosted at `mcp.supermemory.ai/mcp`. 5-layer stack (connectors/extractors/Super-RAG/memory-graphs/profiles). 85.4% on LongMemEval-S overall, 92.3% on single-session. Claude Code plugin available.
- **Vercel AI SDK**: not a memory store itself — exposes `Agent` class with provider hooks. Letta, Mem0, Supermemory all have official AI-SDK providers. The ai-sdk-tools.dev/memory project is a community memory abstraction.
- **MCP reference server `@modelcontextprotocol/server-memory`**: KG (entities/relations/observations) backed by single JSONL file, MIT. 8 tools. No multi-user, no concurrent edit, no scaling. Toy/learning baseline.
- **ChatGPT memory**: saved-memories notepad + chat-history reference; rolled out to free tier as lightweight version June 2025. Not standalone — only inside ChatGPT product.

### 2026-05-01 — drafting

Total ~3500 words target. Opening 200 words framing. Each tool ~200 words on average; bigger ones (Mem0, Letta, Zep, Anthropic memory tool) maybe 300+; smaller ones (Vercel SDK, ChatGPT) 100. Then comparison table + decision flow ~500 words.

### 2026-05-01 — done

Final word count: ~4,550 (with ~600 in table + sources, prose ~3,950). One above target but the user said "aim for 3000-4000; this will be the heart of the report" — the comparison table and sources list naturally push it. Thirteen tools fully covered.

Notable findings worth remembering for later threads:
- The Zep LoCoMo correction (84% → 58.44%) is a useful citation when discussing vendor-benchmark trust.
- Letta's Context Repositories is a real architectural shift (Feb 2026); worth its own deep-dive thread if anyone uses Letta Code seriously.
- Mem0's SDK 2.0 dropped graph-memory as a separate mode in favor of entity linking inside the default index — that's a meaningful simplification.
- Codex memories regional restriction (no EEA/UK/CH at launch) is a real deployment gotcha for European teams.
- Basic Memory's AGPL-3.0 is a quiet trap for commercial users.


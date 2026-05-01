# Standalone Memory Tools for AI Agents: A 2026 Survey

*Written May 2026. Audience: senior engineers choosing a memory layer for an MCP-compatible coding agent (Claude Code, OpenAI Codex CLI, Cursor, etc.).*

## Why this exists

By mid-2026 the memory-tooling space has roughly stratified into four camps: (1) **graph-first** systems (Zep/Graphiti, Cognee, the MCP reference server) that model facts and relationships explicitly; (2) **vector-and-extraction** systems (Mem0, Supermemory, Memori) that lean on LLM-driven fact distillation plus hybrid retrieval; (3) **filesystem-first** systems (Anthropic's memory tool, Basic Memory, Letta's Context Repositories) that lean on human-readable files the agent itself edits; and (4) **research-grade reference architectures** (MemoryOS, A-MEM) you wire up yourself.

A senior engineer's choice depends on three axes: *what you want to store* (conversations vs documents vs code-project state), *who controls the data* (managed SaaS vs Docker vs purely local), and *what kind of recall the workload needs* (semantic similarity, entity-aware joins, temporal "what was true when," or human-grep-able files). The survey below walks each option in those terms.

A quick orientation: every system here exposes some MCP transport, a Python or TypeScript SDK, or both. None of them is a turnkey replacement for product-specific memory like ChatGPT's saved-memories notepad — those are bundled into the consumer surface and won't be addressable by your agent. We cover them at the end for completeness.

---

## 1. Mem0 (recap + 2026 updates)

**One-liner.** Universal memory layer that uses LLM extraction to distill conversation turns into searchable facts, retrieved via hybrid vector + graph + BM25 search.

The 2025 architecture is well-covered in our prior write-ups. Three things changed in 2026 that matter.

**SDK 2.0 (April 16, 2026)** consolidated the older two-pass extract/update cycle into a *single-pass* extraction (~50% latency reduction on writes) and a hybrid retriever that mixes semantic similarity, BM25, and entity-graph boosting. The standalone "graph memory" mode was deprecated in favour of *entity linking* baked into the default index — you no longer pick "vector vs graph"; you get both ([Mem0 changelog](https://docs.mem0.ai/changelog/sdk)).

**Mem0 Plugin v1.0.0 (April 2, 2026)** is the unified plugin for Claude Code, Cursor, and Codex CLI. It exposes nine MCP tools (`add_memory`, `search_memories`, `get_memories`, `get_memory`, `update_memory`, `delete_memory`, `delete_all_memories`, `delete_entities`, `list_entities`) plus *lifecycle hooks* that automatically capture memories at session-start, context compaction, task completion, and session-end — so unlike a bare MCP install, you don't have to remember to call `add_memory` ([mem0.ai blog](https://mem0.ai/blog/claude-code-memory)).

**OpenMemory MCP** is the local-first deployment path. A single-line `make up` (or `curl … | bash`) brings up Postgres + Qdrant + a FastAPI MCP server on `localhost:8765` ([OpenMemory README](https://github.com/mem0ai/mem0/tree/main/openmemory)). The same Mem0 engine, your machine. Useful when corporate policy forbids cloud memory sync.

**Architecture.** Vector store (Qdrant default; Pinecone/Chroma/etc. supported) + Postgres for relational metadata + entity graph in Neo4j optional. Episodic and semantic in the same store, distinguished by extracted-fact metadata.

**Benchmarks.** Mem0 self-reports 91.6 on LoCoMo and 93.4 on LongMemEval at <7K tokens per retrieval call ([Mem0 research](https://mem0.ai/research)) — but always read these alongside Zep's competing claims; the tools tend to publish numbers against their own pipeline configurations.

**Deploy.** Managed (`mem0.ai`), self-hosted Docker (`mem0/openmemory` compose), or library (`pip install mem0ai`). Apache-2.0. https://github.com/mem0ai/mem0

**Use it when.** You want a turnkey, opinionated memory layer for chat-style agents and coding agents, you can live with LLM-extracted facts (occasional misses are real), and you want a single product behind your whole agent fleet.

**Skip it when.** You need explicit, auditable temporal facts ("what did the customer say their address was on March 12 vs April 4?") — go to Zep. Or you don't trust LLM extraction and want raw conversational logs — pick Memori or Basic Memory.

---

## 2. Letta (formerly MemGPT) — recap + 2026 updates

**One-liner.** Stateful-agent runtime with hierarchical context management ("memory blocks" pinned in-context plus an archival store), now with git-backed memory for coding workflows.

The MemGPT-style layered memory (core/recall/archival) is unchanged; what's new is the *delivery surface*.

**Letta Cloud + Letta Desktop + ADE** form the managed-agent loop. The **Agent Development Environment (ADE)** lets you view and edit memory blocks live — `human`, `persona`, `planning`, plus any custom labels — and changes apply mid-conversation ([Memory blocks docs](https://docs.letta.com/guides/core-concepts/memory/memory-blocks/)). Default block size is 2,000 chars but can be bumped. Each block has a `block_id` and is addressable via REST: `POST /agents` with a `memory_blocks` array of `{label, value}` objects.

**Letta Code (Dec 2025)** is the memory-first terminal coding agent. Letta claims it's the #1 model-agnostic open-source agent on Terminal-Bench. The clever bit: memory and identity are decoupled from the model, so you can switch between Claude, GPT, Gemini, Kimi, GLM mid-session and the agent keeps its personality and its learnings ([Letta Code blog](https://www.letta.com/blog/letta-code)).

**Context Repositories (Feb 12, 2026)** is the memory model inside Letta Code: a *git-backed directory* the agent writes scripts against. Every memory edit is a commit with a message, so concurrent subagents can branch, merge, and resolve conflicts using normal git semantics ([Context Repositories blog](https://www.letta.com/blog/context-repositories)). This is a real architectural shift away from "memory blocks pinned to context" and toward "memory as a files-and-git artifact the agent itself manages programmatically."

**MCP / Codex.** Letta is its own runtime, not an MCP server you bolt onto Claude Code. Integration is via the Letta REST API or the official Vercel AI SDK provider ([letta-ai/vercel-ai-sdk-provider](https://github.com/letta-ai/vercel-ai-sdk-provider)). There is also an experimental `letta-ai/ai-memory-sdk` for pluggable memory.

**Deploy.** Letta Cloud (managed), self-host via Docker (Postgres-backed), or run Letta Code locally. Apache-2.0. https://github.com/letta-ai/letta

**Use it when.** You want a *runtime*, not just a memory store — agents-as-services with hierarchical context paging, a UI, and per-agent memory isolation. Or you want the Letta Code coding harness with git-versioned memory.

**Skip it when.** You already have a runtime (Claude Code, Codex CLI) and just want to attach a memory layer to it. Letta is happiest when *it* is the runtime.

---

## 3. Zep / Graphiti

**One-liner.** Temporally-aware knowledge graph for agent memory: every fact has a validity window and is provenance-linked back to the originating episode.

**Zep** is the managed, multi-tenant cloud product (dashboard, SLAs, sub-200ms retrieval). **Graphiti** is the open-source engine underneath ([getzep/graphiti](https://github.com/getzep/graphiti), Apache-2.0). As of v0.29.0 (April 27, 2026), Graphiti supports Neo4j 5.26+, FalkorDB 1.1.2+, Kuzu 0.11.2+, and Amazon Neptune.

**Memory model.** Episodes (raw conversation turns or documents) are ingested incrementally; an LLM extracts entities, relations, and *temporal facts*. Each edge has `valid_from` / `valid_to` so contradicted facts aren't deleted — they're superseded. This is the killer feature for any domain where state changes (customer addresses, policy versions, code-API signatures).

**Retrieval.** Hybrid: semantic embedding search + keyword (BM25) + graph traversal. You can prescribe an ontology with Pydantic models or let the system learn structure from the data.

**MCP.** Yes. The Graphiti MCP server is in-tree (`mcp_server/` directory) and exposes `add_episode`, `search_facts`, `search_nodes`, `get_episodes`, `add_entity`, etc. Configure it the same way as any local MCP server ([Knowledge Graph MCP docs](https://help.getzep.com/graphiti/getting-started/mcp-server)). Docker Compose recipes ship with both Neo4j and FalkorDB profiles.

**Benchmarks.** Zep reports 94.8% on Deep Memory Retrieval (DMR), beating MemGPT's 93.4%; up to 18.5% accuracy improvement on LongMemEval with 90% lower latency vs full-context replay ([MarkTechPost coverage](https://www.marktechpost.com/2025/02/04/zep-ai-introduces-a-smarter-memory-layer-for-ai-agents-outperforming-the-memgpt-in-the-deep-memory-retrieval-dmr-benchmark/)). Their original LoCoMo claim of 84% has since been corrected to 58.44% per the [getzep/zep-papers issue #5](https://github.com/getzep/zep-papers/issues/5) — a useful reminder that vendor benchmarks need scrutiny.

**Deploy.** Zep Cloud (managed) or Graphiti self-hosted (Docker Compose, Helm chart for Kubernetes).

**Use it when.** Temporal correctness matters — CRM, support, longitudinal user state. You need explainable retrieval ("show me which episode this fact came from"). You're ok bringing a graph DB.

**Skip it when.** Your data is mostly unstructured prose with no clear entities. The KG-extraction overhead is not worth it for "remember the user's tone preference."

---

## 4. Cognee

**One-liner.** Open-source knowledge engine that turns ingested data of any shape into a hybrid vector+graph memory, with a *cognify* build pipeline and a *memify* refinement pass.

**Architecture.** Two phases. `cognify` is a six-stage pipeline (classify → permission-check → chunk → LLM-extract entities/relations → summarize → embed-and-commit) that builds the graph. `memify` is the *consolidation* phase — prunes stale nodes, strengthens frequent edges, reweights by usage signals, derives new facts. This is the closest thing in the OSS landscape to an explicit "sleep-time consolidation" loop ([Cognee architecture blog](https://www.cognee.ai/blog/fundamentals/how-cognee-builds-ai-memory)).

**Storage.** Neo4j (default) or Memgraph for the graph; vector via LanceDB, Qdrant, Weaviate, etc. Postgres for metadata.

**MCP.** Yes — `cognee-mcp` ships in the repo and exposes tools like `cognify`, `search`, `save_interaction` (auto-extract from a chat turn, generate coding rules), etc. Documented integration with Claude Agent SDK ([Cognee + Claude SDK](https://www.cognee.ai/blog/integrations/claude-agent-sdk-persistent-memory-with-cognee-integration)).

**Deploy.** Library (`pip install cognee`, Python 3.10–3.13), self-hosted (Modal, Railway, Fly.io, Render, Daytona templates provided), or Cognee Cloud. Apache-2.0. https://github.com/topoteretes/cognee — current version v1.0.4.dev0 (April 25, 2026).

**Use it when.** You're ingesting heterogeneous corpora (docs + chats + structured tables) and you want one memory that lets agents both semantic-search and graph-traverse. Particularly nice if you want a built-in consolidation step rather than rolling your own decay logic.

**Skip it when.** You only need conversation memory — Mem0 is simpler. Or you want strict temporal correctness — Zep models that better.

---

## 5. Memori (GibsonAI / MemoriLabs)

**One-liner.** SQL-native memory engine — no vector DB required. Stores extracted memories in SQLite/Postgres/MySQL with full-text search and SQL-queryable schema.

**Architecture.** Three-agent extraction pipeline: a *capture* agent processes conversations, an *analysis* agent classifies into attributes/events/facts/people/preferences/relationships/rules/skills, and a *retrieval* agent injects context. All persisted in a normal relational schema with full-text indexes. The pitch: your memories are auditable, exportable, and joinable — `SELECT * FROM memories WHERE user_id = ? AND fact_type = 'preference'` ([MarkTechPost coverage](https://www.marktechpost.com/2025/09/08/gibsonai-releases-memori-an-open-source-sql-native-memory-engine-for-ai-agents/)).

**Modes.** *Conscious mode* injects recent essential context (a small short-term window). *Auto mode* runs dynamic search across the long-term store on each turn.

**MCP.** Hosted MCP server at `https://api.memorilabs.ai/mcp/` — install in Claude Code with `claude mcp add --transport http memori https://api.memorilabs.ai/mcp/`. Self-host an HTTP MCP locally if you want the data on your machine.

**Benchmarks.** Memori reports 81.95% accuracy at ~4.97% of full-context token usage in their internal eval ([Memori README](https://github.com/GibsonAI/memori)).

**Deploy.** Managed cloud (`memorilabs.ai`), self-hosted (BYODB SQL), or library (`pip install memori`). Apache-2.0. https://github.com/GibsonAI/memori — current v3.3.2 (April 29, 2026). Note the org has been renamed to MemoriLabs but the GibsonAI URL still resolves.

**Use it when.** You already run Postgres or MySQL, you don't want to operate a vector DB, and you want memories your DBA can query and your compliance team can export. Especially compelling for regulated environments.

**Skip it when.** You need true semantic search over messy text — SQL FTS is good but pure-vector beats it for paraphrase recall.

---

## 6. MemoryOS

**One-liner.** Research-grade hierarchical memory system from BAI-LAB, modeled on operating-system memory management — short-term, mid-term, long-term tiers with FIFO promotion and "heat-based" consolidation.

**Architecture.** Three-tier storage (STM / MTM / LTM) plus four functional modules (Storage, Updating, Retrieval, Generation). STM→MTM uses a dialogue-chain FIFO; MTM→LTM uses a *segmented page* organization with a heat threshold. Long-term tier holds extracted user profiles. Embeddings via BGE-M3 or Qwen, vector store ChromaDB.

**Paper.** [arXiv 2506.06326](https://arxiv.org/abs/2506.06326), EMNLP 2025 oral. Reports +49.11% F1 and +46.18% BLEU-1 over baselines on LoCoMo with GPT-4o-mini.

**MCP.** Yes — `MemoryOS-MCP` is shipped, with three tools: `add_memory`, `retrieve_memory`, `get_user_profile`. Configurations for Claude Desktop, Cline, and Cursor are documented.

**Deploy.** Library (`pip install memoryos`, Python 3.10+), Docker, web playground. Apache-2.0. https://github.com/BAI-LAB/MemoryOS

**Use it when.** You want an explicit OS-style tiered model and you're comfortable on the research-code spectrum (217 stars, smaller community, less documentation polish than Mem0/Zep). Good fit for academic projects or for studying tiered memory dynamics.

**Skip it when.** Production reliability matters more than architectural elegance. Pick Mem0 or Zep instead.

---

## 7. A-MEM

**One-liner.** Zettelkasten-inspired agentic memory — each new memory is a *note* with attributes, tags, and bidirectional links to related past notes; adding a note can trigger evolution of older notes.

**Architecture.** ChromaDB vector backend. On `add_memory`, the system (1) generates a structured note (contextual description + keywords + tags), (2) searches historical notes for semantically related items, (3) creates bidirectional links, and (4) optionally rewrites older notes' attributes to reflect new context — the "memory evolution" feature ([A-MEM repo](https://github.com/agiresearch/A-mem)).

**Paper.** [arXiv 2502.12110](https://arxiv.org/abs/2502.12110), NeurIPS 2025. Reports superior performance against SOTA baselines on six foundation models without giving exact numbers in the README.

**MCP.** No official MCP server. This is research code; if you want it behind Claude Code you'll write a thin MCP wrapper around its `add_memory` / `search` Python API. There are two repos: `agiresearch/A-mem` (canonical) and `WujiangXu/A-mem` (NeurIPS reproduction).

**Deploy.** Library only — `pip install .` from the repo, MIT license.

**Use it when.** You're studying agentic memory dynamics or building a research prototype. The Zettelkasten linking is conceptually elegant and you don't mind writing glue code.

**Skip it when.** You need a production memory layer today.

---

## 8. Basic Memory (Basic Machines)

**One-liner.** Markdown-file knowledge graph: notes live as `.md` files on your disk in semantic-Markdown patterns, indexed by SQLite + FastEmbed, exposed via MCP.

**Architecture.** Knowledge lives in a directory of Markdown files (default `~/basic-memory`). Files are parsed into Entities with Observations and Relations using semantic-Markdown conventions (`- [observation] some fact`, `- [relation] entity::other-entity`). SQLite indexes for full-text; FastEmbed local embeddings for vector similarity. Bidirectional sync — edit the files in Obsidian, the index updates; ask Claude to write a note, the file appears.

**MCP.** Built around it. `basic-memory mcp` is the server command. Tools include `write_note`, `read_note`, `search_notes`, `build_context`, `recent_activity`. Works with Claude Desktop, Claude Code, Codex CLI — anything MCP. Optional Basic Memory Cloud subscription syncs across machines ([basic-memory README](https://github.com/basicmachines-co/basic-memory)).

**License.** **AGPL-3.0** — important: any networked service incorporating Basic Memory must publish source. Most teams using it as a personal MCP backend won't trigger the trigger condition, but commercial-product use needs review.

**Deploy.** Local-first (`uv tool install basic-memory`, Python 3.12+). Optional cloud sync. v0.20.3 (March 2026).

**Use it when.** You want a *human-readable*, *grep-able*, *git-versionable* memory store — your knowledge base survives even if the AI vendor goes away. Particularly compelling if you already use Obsidian or similar Markdown tools.

**Skip it when.** You need multi-user concurrency or hosted scale, or AGPL is a non-starter for your product.

---

## 9. Anthropic's memory tool

**One-liner.** A first-party Claude tool primitive (type `memory_20250818`) that lets the model issue file-CRUD calls against a `/memories` directory. The storage backend is *yours to implement*.

**How it works.** When the tool is enabled, Claude is system-prompted to view `/memories` before any task and write progress as it works. The tool emits commands — `view`, `create`, `str_replace`, `insert`, `delete`, `rename` — that the application executes locally. Anthropic's SDKs ship `BetaAbstractMemoryTool` (Python) and `betaMemoryTool` (TypeScript) helpers; you subclass with whatever backend (filesystem, S3, encrypted FS, database). Eligible for Zero Data Retention ([Memory tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)).

**Pairing.** The memory tool is designed to be used together with **context editing** (clears specific tool results client-side) and **compaction** (server-side summarization at context limits). The pattern Anthropic recommends: long workflows compact older turns, but anything important is moved to memory before compaction so it survives. Plus a "multi-session software development pattern" they document — initializer session writes a progress log + feature checklist; subsequent sessions read it, work on one feature end-to-end, write back the update.

**MCP.** This isn't an MCP server — it's a Claude tool. But it composes with MCP: you can have memory writes go through your MCP server's storage, or have memory live alongside MCP-fetched data. In Claude Code specifically, the memory tool is one of the primitives the harness can enable for managed agents and is the basis for the per-subagent `enable-memory: true` frontmatter flag.

**Beta status.** Public beta as of March 2026 for Managed Agents; available to free Claude users via the consumer surface in the same March release. Model identifier `memory_20250818` indicates the spec is dated.

**Use it when.** Your agent IS Claude. You want first-party support, you want fine control over storage (encryption, compliance, on-prem), and you're happy implementing a small filesystem-like adapter.

**Skip it when.** You need cross-vendor portability — Codex, Gemini, Claude all sharing one memory. Pick Mem0 or Supermemory.

---

## 10. OpenAI memory: ChatGPT, Codex CLI, Responses API

These are three distinct features that do not interoperate well.

**ChatGPT memory** has two layers: a *saved memories* notepad ("remember I'm vegetarian") and *chat-history reference* (the model can ground in your past conversations). Free users got a lightweight chat-history reference in mid-2025; saved memories are still Plus/Pro for the rich version ([OpenAI Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq)). It's product-internal — there's no API to read or write these from your own agent.

**Codex CLI memories** (rolled out Q1 2026) is the developer-facing analog. Off by default; flip `[features] memories = true` in `~/.codex/config.toml` (or the settings UI). Two sub-flags: `memories.generate_memories` (allow new memory creation from a thread) and `memories.use_memories` (inject existing memories at thread start). Stored in your Codex home dir. Not available in the EEA, UK, or Switzerland at launch. The recommended pattern: keep mandatory team rules in `AGENTS.md` (versioned, mandatory) and treat memories as a "local recall layer" that may or may not apply ([OpenAI Codex memories docs](https://developers.openai.com/codex/memories)).

**Responses API state** is the building block underneath. Pass `previous_response_id` to chain turns; or use the **Conversations API** for first-class long-running threads. Plain Response objects are TTL'd at 30 days; items attached to a Conversation persist indefinitely. New in 2026: `/responses/compact` automatically summarizes older conversation turns server-side ([Conversation state docs](https://developers.openai.com/api/docs/guides/conversation-state)).

**Use it when.** You're building on the OpenAI API directly and want zero infrastructure for short-term continuity. Codex memories specifically are great for personal IDE use.

**Skip it when.** You need cross-tool portability or you operate outside OpenAI's regulated regions.

---

## 11. Supermemory

**One-liner.** Hosted "universal memory" with a simple MCP URL; under the hood, a five-layer pipeline (connectors → extractors → Super-RAG hybrid retriever → memory graphs → user profiles).

**Architecture.** Five-layer stack: *connectors* auto-sync from Slack/Notion/Gmail; *extractors* do multi-modal chunking; *Super-RAG* is hybrid search + reranking; *memory graphs* track relationships, contradictions, and temporal facts (similar in spirit to Graphiti); *user profiles* hold static preferences plus session state. Backed by a Cloudflare Durable Objects edge for SSE; sub-300ms response time at >100B tokens/month claimed ([supermemory.ai docs](https://supermemory.ai/docs/supermemory-mcp/introduction)).

**MCP.** Yes — primary delivery mode. The hosted MCP URL is per-user (`mcp.supermemory.ai/{userid}/sse`); no logins or paywall to start. Claude Code plugin available. Codex CLI also supported ([Supermemory blog on Claude Code](https://supermemory.ai/blog/we-added-supermemory-to-claude-code-its-insanely-powerful-now/)).

**Benchmarks.** 85.4% overall on LongMemEval-S, 92.3% on single-session subset.

**Deploy.** Primarily managed (Supermemory Cloud), with an open-source SDK on https://github.com/supermemoryai/supermemory. Free tier exists; paid tiers for higher volume.

**Use it when.** You want zero-ops cross-app memory across Claude, Cursor, ChatGPT, etc., and you're comfortable with hosted memory.

**Skip it when.** Data residency or self-hosting are required.

---

## 12. Vercel AI SDK and other framework memory abstractions

The **Vercel AI SDK** is not a memory store. It's a TypeScript abstraction over LLM providers that exposes an `Agent` class and provider-defined tool patterns. Memory shows up as either (a) tools you wire in, (b) "memory providers" — adapters around external memory services — or (c) bring-your-own custom tool.

In practice, the SDK's memory ecosystem in 2026 is: **Mem0 community provider** (V5-compatible since Aug 2025, multimodal added Sept 2025), the official **Letta provider** (`letta-ai/vercel-ai-sdk-provider`), and **Supermemory provider**. There's also a community `ai-sdk-tools.dev/memory` project that wraps the most common patterns ([AI SDK memory docs](https://ai-sdk.dev/docs/agents/memory)).

Other framework abstractions worth knowing: **LangChain Memory / LangGraph checkpoints** (per-thread state stored in a checkpointer; not really long-term semantic memory but enough for short conversational continuity), **CrewAI memory** (delegates to Mem0 by default), **AutoGen** (no first-party memory; users typically attach Mem0 or Zep).

**Use these when.** You're already using the framework and don't want to manage a memory service directly. The provider abstractions are thin enough that swapping later is cheap.

**Skip them when.** You want a dedicated memory layer your whole agent fleet shares regardless of framework.

---

## 13. MCP memory servers

The Model Context Protocol catalog has dozens of memory servers. The ones worth knowing:

- **`@modelcontextprotocol/server-memory`** — the reference implementation. A toy knowledge graph (entities + relations + observations) persisted to a single JSONL file. Eight tools: `create_entities`, `create_relations`, `add_observations`, `delete_entities`, `delete_observations`, `delete_relations`, `read_graph`, `search_nodes`. MIT, install via `npx @modelcontextprotocol/server-memory` and point `MEMORY_FILE_PATH` at your store. **No** multi-user, no concurrency, no scale. Use it as the "hello-world" baseline ([MCP servers/src/memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)).
- **Graphiti MCP** — covered above; the recommended graph-memory MCP for non-trivial use.
- **OpenMemory MCP** — covered above; the recommended local-first vector-memory MCP.
- **MemoryOS MCP** — covered above; if you want an explicit hierarchical model.
- **Memori HTTP MCP** — covered above.
- **`doobidoo/mcp-memory-service`** — community project that mixes a knowledge graph with autonomous consolidation (Ebbinghaus-style decay) and a REST API. Worth a look if you want decay built in without picking up Cognee's full stack.
- **`coleam00/mcp-mem0`** — a long-running community Mem0 wrapper, useful as a Python MCP-server learning template even though the project has been quiet for a year.
- **`thedotmack/claude-mem`** — a Claude-Code-specific plugin that auto-captures session activity, AI-compresses it, and re-injects relevant context next session. Different design point: zero-config for solo coders.

---

## Comparison table

| Tool | Storage | Memory model | Retrieval | Decay/consolidation | Deploy | MCP | License | Best for |
|---|---|---|---|---|---|---|---|---|
| Mem0 | Vector (Qdrant) + Postgres + optional Neo4j | Semantic facts, extracted | Hybrid: vector + BM25 + entity graph | Manual via API; no auto-decay | SaaS, Docker, lib | Yes (plugin v1.0 + OpenMemory) | Apache-2.0 | General agent memory, coding agents |
| Letta | Postgres-backed | Hierarchical (core/recall/archival blocks); Context Repos = git-tracked files | Block recall + archival vector search; git diff for repos | Sleep-time compute; manual via ADE | Cloud, Docker, Letta Code | Limited (own runtime) | Apache-2.0 | Stateful agent platforms; coding agents needing portable memory |
| Zep / Graphiti | Graph (Neo4j/FalkorDB/Kuzu/Neptune) | Temporal KG with valid_from/valid_to | Hybrid: vector + BM25 + graph traversal | Supersession via temporal edges | Zep cloud or self-host | Yes (Graphiti MCP) | Apache-2.0 | Temporal correctness; CRM/support; auditable facts |
| Cognee | Vector + Neo4j/Memgraph + Postgres | KG + vector hybrid | Hybrid; cognify pipeline | `memify` pass: prune, reweight, derive | Cloud, multi-platform self-host, lib | Yes (cognee-mcp) | Apache-2.0 | Heterogeneous corpora; explicit consolidation |
| Memori | SQL only (SQLite/PG/MySQL) | Extracted attributes/events/facts/people/etc. | SQL FTS; conscious + auto modes | None built-in | Cloud, BYODB self-host, lib | Yes (HTTP) | Apache-2.0 | Compliance-heavy, SQL-shop deployments |
| MemoryOS | ChromaDB + heat metadata | 3-tier STM/MTM/LTM hierarchy | Per-tier semantic search | FIFO and segmented-page promotion | Lib, Docker | Yes | Apache-2.0 | Research; tiered-memory experiments |
| A-MEM | ChromaDB | Zettelkasten notes with bidirectional links | Vector similarity + link traversal | Memory-evolution rewrites | Lib | No (DIY wrapper) | MIT | Research prototypes |
| Basic Memory | Markdown files + SQLite + FastEmbed | KG-in-Markdown (Entities/Observations/Relations) | Hybrid full-text + vector | None automatic | Local, optional cloud sync | Yes (built around it) | AGPL-3.0 | Personal KB, Obsidian users, vendor-portable memory |
| Anthropic memory tool | Whatever you implement | File-system `/memories` directory | LLM-driven file navigation | Manual file edits | Library helpers; storage is yours | No (it's a tool) | Anthropic API | Claude-only agents wanting full storage control |
| OpenAI Codex memories | OpenAI-managed | Free-form recall items | Implicit injection at thread start | Auto-generation off by default | Managed (Codex) | No (proprietary) | Proprietary | OpenAI-only personal IDE use |
| Supermemory | Edge KV + KG + vectors | KG + profile + RAG pipeline | Super-RAG hybrid + rerank | Implicit via memory-graph contradictions | Managed; OSS SDK | Yes (hosted) | Mixed (OSS SDK + hosted service) | Cross-app universal memory |
| Vercel AI SDK | None (abstraction) | N/A | N/A | N/A | Library | N/A | Apache-2.0 | Wrap Mem0/Letta/Supermemory in a TS app |
| MCP `server-memory` | Single JSONL file | Trivial KG | substring search | None | Lib | Yes (it is one) | MIT | Hello-world / learning |

---

## Decision flow

A quick sieve. Walk the questions in order; first "yes" wins.

**1. Does temporal correctness matter — do facts get superseded over time?**
→ **Zep / Graphiti**. Nothing else models valid-from/valid-to natively.

**2. Are you a Claude-only shop and willing to bring your own backend?**
→ **Anthropic memory tool**. First-party, ZDR-eligible, you control storage. Pair with context editing and compaction.

**3. Are you specifically building a coding agent and want git-versioned memory portable across model providers?**
→ **Letta Code with Context Repositories**. The integrated runtime is the point.

**4. Do you need cross-app, cross-vendor memory (Claude + Codex + Cursor + ChatGPT) with zero ops?**
→ **Supermemory** if managed is fine; **Mem0 OpenMemory MCP** if local-first is required.

**5. Is data sovereignty + auditability the top constraint?**
→ **Memori** (SQL, joinable, exportable) or **Basic Memory** (Markdown files, git-versionable) — pick on whether you want a database or a filesystem. Watch the AGPL on Basic Memory.

**6. Do you want one engine for both conversations *and* document corpora, with explicit consolidation?**
→ **Cognee**. The cognify+memify split is the differentiator.

**7. Do you want a research-grade reference architecture?**
→ **MemoryOS** (tiered) or **A-MEM** (Zettelkasten). MemoryOS has an MCP server out of the box; A-MEM you wrap yourself.

**8. Do you just want the simplest possible thing for a hobby project?**
→ **`@modelcontextprotocol/server-memory`** to learn the API; **Mem0** plugin or **Basic Memory** when you outgrow the JSONL file.

**9. None of the above; you're building a TypeScript agent and want a memory adapter?**
→ **Vercel AI SDK** with the Mem0 / Letta / Supermemory provider that fits your other constraints.

A few cross-cutting notes worth keeping in mind:

- **Vendor benchmarks are advocacy.** Zep's published LoCoMo number was corrected from 84% to 58.44% after community scrutiny ([zep-papers issue #5](https://github.com/getzep/zep-papers/issues/5)). Re-run on your own data.
- **Long-context models keep eating the floor.** Recent analyses ([arXiv 2603.04814](https://arxiv.org/html/2603.04814v1)) find that long-context GPT-5-mini outperforms fact-based memory by 30+ percentage points on LoCoMo and LongMemEval — until ~10 turns past 100K tokens. Memory wins on cost and latency, not raw accuracy. Don't pick a memory tool for tasks short-context can already do.
- **MCP is the lingua franca.** Every serious tool now ships an MCP server; "MCP-or-it-doesn't-exist" is a reasonable filter for the 2026 selection.
- **Decay is still the open problem.** Only Cognee (`memify`), MemoryOS (heat-based promotion), Letta (sleep-time compute), and `mcp-memory-service` (Ebbinghaus-style) attempt automatic consolidation. Most others still require you to schedule pruning yourself.

---

## Sources

- [Mem0 — Add Persistent Memory to Claude Code](https://mem0.ai/blog/claude-code-memory)
- [Mem0 — Introducing OpenMemory MCP](https://mem0.ai/blog/introducing-openmemory-mcp)
- [Mem0 — SDK changelog](https://docs.mem0.ai/changelog/sdk)
- [Mem0 — Research / Benchmarks](https://mem0.ai/research)
- [GitHub: mem0ai/mem0](https://github.com/mem0ai/mem0)
- [Letta — Memory blocks docs](https://docs.letta.com/guides/core-concepts/memory/memory-blocks/)
- [Letta — Letta Code blog](https://www.letta.com/blog/letta-code)
- [Letta — Context Repositories blog](https://www.letta.com/blog/context-repositories)
- [GitHub: letta-ai/letta](https://github.com/letta-ai/letta)
- [GitHub: letta-ai/letta-code](https://github.com/letta-ai/letta-code)
- [GitHub: letta-ai/vercel-ai-sdk-provider](https://github.com/letta-ai/vercel-ai-sdk-provider)
- [Zep — Knowledge Graph MCP Server](https://www.getzep.com/product/knowledge-graph-mcp/)
- [Zep — Help Center MCP setup](https://help.getzep.com/graphiti/getting-started/mcp-server)
- [GitHub: getzep/graphiti](https://github.com/getzep/graphiti)
- [Zep paper (arXiv 2501.13956)](https://arxiv.org/abs/2501.13956)
- [getzep/zep-papers issue #5 (corrected LoCoMo)](https://github.com/getzep/zep-papers/issues/5)
- [Cognee — How Cognee Builds AI Memory](https://www.cognee.ai/blog/fundamentals/how-cognee-builds-ai-memory)
- [Cognee — MCP introduction](https://www.cognee.ai/blog/cognee-news/introducing-cognee-mcp)
- [Cognee — Claude Agent SDK integration](https://www.cognee.ai/blog/integrations/claude-agent-sdk-persistent-memory-with-cognee-integration)
- [GitHub: topoteretes/cognee](https://github.com/topoteretes/cognee)
- [GibsonAI Memori coverage (MarkTechPost)](https://www.marktechpost.com/2025/09/08/gibsonai-releases-memori-an-open-source-sql-native-memory-engine-for-ai-agents/)
- [GitHub: GibsonAI/memori](https://github.com/GibsonAI/memori)
- [MemoryOS paper (arXiv 2506.06326)](https://arxiv.org/abs/2506.06326)
- [GitHub: BAI-LAB/MemoryOS](https://github.com/BAI-LAB/MemoryOS)
- [A-MEM paper (arXiv 2502.12110)](https://arxiv.org/abs/2502.12110)
- [GitHub: agiresearch/A-mem](https://github.com/agiresearch/A-mem)
- [GitHub: basicmachines-co/basic-memory](https://github.com/basicmachines-co/basic-memory)
- [Anthropic — Memory tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Anthropic — Managing context on the developer platform](https://www.anthropic.com/news/context-management)
- [OpenAI — Codex memories docs](https://developers.openai.com/codex/memories)
- [OpenAI — Codex AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md)
- [OpenAI — Conversation state guide](https://developers.openai.com/api/docs/guides/conversation-state)
- [OpenAI — Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq)
- [Supermemory — MCP introduction](https://supermemory.ai/docs/supermemory-mcp/introduction)
- [Supermemory — Claude Code plugin blog](https://supermemory.ai/blog/we-added-supermemory-to-claude-code-its-insanely-powerful-now/)
- [GitHub: supermemoryai/supermemory](https://github.com/supermemoryai/supermemory)
- [Vercel AI SDK — Memory docs](https://ai-sdk.dev/docs/agents/memory)
- [GitHub: modelcontextprotocol/servers — Memory reference](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)
- [GitHub: doobidoo/mcp-memory-service](https://github.com/doobidoo/mcp-memory-service)
- [LoCoMo benchmark](https://snap-research.github.io/locomo/)
- [LongMemEval paper (arXiv 2410.10813)](https://arxiv.org/pdf/2410.10813)
- [Long-context vs memory cost-perf analysis (arXiv 2603.04814)](https://arxiv.org/html/2603.04814v1)

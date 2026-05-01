# AI memory systems and the markdown-as-agents pattern

*Synthesis report. Date: 2026-05-01. Audience: a senior engineer choosing how to extend a CLI coding agent (Claude Code, Codex, Cursor) and how to give it persistent memory.*

This thread is the index over four research artifacts in this repo. The synthesis below pulls together the practical recommendation; the deep material lives in the linked sub-reports.

## What's in this research bundle

- **`ai-memory-systems/`** *(this thread)* — synthesis, integration patterns, and recommendations.
- **`cli-agent-harness-survey/`** — comparative survey of file-based agent harnesses across Codex, Cursor, Cline/Roo, Aider, Continue, Goose, Sourcegraph Amp, Zed, plus the AGENTS.md / MCP / SKILL.md spec story.
- **`standalone-memory-tools-survey-2026/`** — 13-tool comparative catalog (Mem0, Letta, Zep/Graphiti, Cognee, Memori, MemoryOS, A-MEM, Basic Memory, Anthropic memory tool, OpenAI memory, Supermemory, Vercel AI SDK, MCP servers) with comparison table and decision flow.
- **`memory-architectures-2026/`** — opinionated technical synthesis of CoALA taxonomy, storage substrates, write/read paths, decay, hierarchical tiers, multi-agent shared memory, memory poisoning, procedural memory, evaluation benchmarks, and open problems.

Adjacent prior work in the repo: `claude-managed-agents/` (Anthropic's hosted-agent runtime including `/mnt/memory/`); `agentic-self-improvement/` (the meta-layer over memory + reflection + DSPy).

---

## TL;DR

By mid-2026 the agent-tooling ecosystem has converged on **three open standards** governed by the Linux Foundation's Agentic AI Foundation (founded Dec 2025 by Anthropic, OpenAI, and Block; 170+ members by April 2026):

| Layer | Standard | Status |
|---|---|---|
| Project context | **AGENTS.md** | 60K+ repos, read by ~all major agents including Claude Code (as fallback) |
| Tools / integrations | **MCP** | Universal — every serious agent ships an MCP client |
| Portable procedural knowledge | **SKILL.md** | Adopted by Claude Code, Codex, Cursor, VS Code, GitHub |

The **persistent memory** layer has not standardized. Tools cluster into four camps: graph-first (Zep/Graphiti, Cognee), vector-and-extraction (Mem0, Supermemory, Memori), filesystem-first (Anthropic memory tool, Basic Memory, Letta Context Repositories), and research-grade (MemoryOS, A-MEM). The most-copied open *pattern* is Cline's Memory Bank: a `memory-bank/` directory of structured markdown files the agent itself maintains.

The recommended portable stack for a 2026 team using one or more CLI coding agents:

1. **AGENTS.md** at repo root for project context (every agent reads it).
2. **MCP servers** for tool integrations and memory (every agent reads them).
3. **Skills** (`SKILL.md` folders) for reusable procedural knowledge.
4. A **`memory-bank/` directory** of markdown for tool-agnostic project memory, plus a dedicated MCP memory server (Mem0, Zep/Graphiti, or Supermemory) for cross-session/cross-user semantic recall.

The full reasoning, tradeoffs, and per-tool details are in the linked sub-reports. The rest of this synthesis is the integration playbook.

---

## 1. The "markdown-as-agents" pattern

The user's framing — "agentic AI setup similar to Claude Code's man[ual]-as-agents" — points at a deeper convergence. Across the major CLI coding agents in 2026, *behavior extension is markdown*. Project context, custom commands, sub-agents, skills, and even rules are all markdown files in conventional locations, sometimes with YAML frontmatter, almost always loaded hierarchically. The harness reads them at session start; the agent treats them as durable instructions.

Claude Code's specific implementation (full detail in the harness survey):

- **`.claude/agents/<name>.md`** — sub-agents with frontmatter (`name`, `description`, `model`, `tools`, `enable-memory`). Invoked by automatic delegation (description-driven), explicit `@agent-name`, or programmatically via the Task/Agent tool. Run in isolated context.
- **`.claude/skills/<name>/SKILL.md`** — skills with frontmatter (`description`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `paths` glob, optional `context: fork` to run in a subagent). Slash commands have been merged into Skills — `/foo` works whether it's `commands/foo.md` or `skills/foo/SKILL.md`.
- **Hooks** (settings.json) — event handlers for `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`. Five types: `command`, `http`, `mcp_tool`, `prompt`, `agent`. **The natural plug for persistent memory.**
- **MCP servers** (`.mcp.json` project / settings.json user) — externalize tool behavior including memory.
- **CLAUDE.md / AGENTS.md** — hierarchical loading walking up dir tree; `@import` syntax; `CLAUDE.local.md` (gitignored). Auto-Memory `MEMORY.md` file Claude itself writes (first 200 lines / 25KB loaded at startup) — this is a different thing from the persistent semantic memory discussed below.
- **Plugins** — bundles of skills/agents/hooks/MCP servers, namespaced as `plugin-name:skill-name`, installable from marketplaces.

The cross-tool picture (full detail and citations in `cli-agent-harness-survey/`):

- **OpenAI Codex CLI** — hierarchical AGENTS.md, `[mcp_servers.*]` in `~/.codex/config.toml`, custom prompts deprecated in favor of Skills, three-axis sandbox/approval matrix.
- **Cursor** — `.cursor/rules/*.mdc` (markdown + YAML frontmatter) in four rule types (Always / Auto Attached / Agent Requested / Manual). Cursor Memories sidecar.
- **Cline / Roo Code** — `.clinerules` + the Memory Bank methodology (markdown files in `memory-bank/`). Roo adds `.roomodes` + per-mode rule directories.
- **Aider** — `.aider.conf.yml` with `read:` key for CONVENTIONS.md; `/architect` mode (proposer + editor models). Aider predates AGENTS.md; community wrappers exist for MCP.
- **Continue.dev** — `config.yaml` with `rules:` array and `prompts:` directory, `mcpServers:` block. MCP only works in Agent mode.
- **Goose** — `.goosehints` + Memory Extension (LLM-managed long-term memory in `~/.config/goose/memory/`). Recipes (YAML playbooks). MCP-native.
- **Sourcegraph Amp / Zed** — both read AGENTS.md; Amp can *generate* it by scraping `.cursorrules` / `.clinerules` / `CLAUDE.md`; Zed has the broadest rule-file polyglot (`.rules` → `.cursorrules` → `.windsurfrules` → `.clinerules` → `.github/copilot-instructions.md` → `AGENT.md` → `AGENTS.md` → `CLAUDE.md` → `GEMINI.md`).

What's converged: **AGENTS.md, MCP, SKILL.md**. What's still per-tool: rule-file format, slash-commands, sandbox/approval, and most importantly *memory*. The Cline Memory Bank methodology travels best because it's just markdown — every agent can read a `memory-bank/` directory.

---

## 2. The standalone-memory-tool landscape

If you want to add cross-session semantic memory to Claude Code or Codex, you do it through MCP. Every serious tool in 2026 ships an MCP server (the only laggard is research code like A-MEM where you write the wrapper). Full per-tool detail and a 13-row comparison table are in `standalone-memory-tools-survey-2026/`. Highlights:

**Four camps:**

- **Graph-first**: Zep / Graphiti, Cognee, the MCP reference `server-memory`. Best for entity-relational reasoning, temporal correctness ("what was true on date X"), auditable provenance.
- **Vector-and-extraction**: Mem0, Supermemory, Memori. Best for general agent memory at scale; LLM extracts facts from conversation, hybrid vector + BM25 + (sometimes) graph retrieval.
- **Filesystem-first**: Anthropic's memory tool, Basic Memory, Letta Context Repositories. Best for human-readable, grep-able, vendor-portable memory; survives if the model vendor goes away.
- **Research-grade**: MemoryOS (tiered OS-style), A-MEM (Zettelkasten-with-evolution). Best for prototyping or studying memory dynamics.

**2026 updates worth flagging** (all in the survey, but the headline ones):

- **Mem0 SDK 2.0 (April 2026)** unified extract+update into a single pass (~50% write-latency cut), folded graph mode into entity-linked hybrid retrieval. **Mem0 Plugin v1.0.0** ships 9 MCP tools with lifecycle hooks (auto-capture at session-start, compaction, task completion, session-end) for Claude Code, Cursor, Codex.
- **Letta Code** (Dec 2025) is the model-agnostic open-source coding agent that decouples memory and identity from the model. **Context Repositories** (Feb 2026) makes memory a git-backed directory the agent writes scripts against — every edit is a commit, subagents can branch and merge.
- **Anthropic's memory tool** (`memory_20250818`, public beta March 2026) is a Claude tool primitive, not an MCP server. The model issues file-CRUD commands against `/memories`; you implement the storage backend (`BetaAbstractMemoryTool` in Python, `betaMemoryTool` in TS). ZDR-eligible. Pairs with context editing and compaction.
- **OpenAI Codex memories** (Q1 2026): off by default; enable in `~/.codex/config.toml`. **Not available in EEA, UK, or Switzerland at launch** — real European-deployment gotcha. Recommended pattern: AGENTS.md for mandatory team rules; memories for personal IDE recall.
- **Zep's LoCoMo number was corrected from 84% → 58.44%** after community scrutiny ([getzep/zep-papers#5](https://github.com/getzep/zep-papers/issues/5)). Vendor benchmarks are advocacy; re-run on your own data.
- **Long-context models keep eating the floor.** Recent analysis ([arXiv 2603.04814](https://arxiv.org/html/2603.04814v1)) finds long-context GPT-5-mini beats fact-based memory by 30+ points on LoCoMo / LongMemEval until ~10 turns past 100K tokens. **Memory wins on cost and latency, not raw quality.** Don't pick a memory tool for tasks that long context can already do.

**Quick picks** (full decision flow in the survey):

| If you need… | Pick |
|---|---|
| Temporal correctness / auditable facts | **Zep / Graphiti** (only one with native bitemporal edges) |
| Claude-native, BYO storage backend | **Anthropic memory tool** |
| Coding agent with git-versioned memory portable across models | **Letta Code + Context Repositories** |
| Cross-app universal memory, zero ops | **Supermemory** (managed) or **Mem0 OpenMemory MCP** (local) |
| SQL-shop / regulated environment | **Memori** (SQL-native) |
| Personal KB, Obsidian-style, vendor-portable | **Basic Memory** (mind the AGPL-3.0) |
| Heterogeneous corpora with explicit consolidation | **Cognee** |
| Hello-world / learning the API | **`@modelcontextprotocol/server-memory`** |

---

## 3. Architecture and patterns

The deeper question — *how* persistent memory should be designed — is in `memory-architectures-2026/`. The headline positions to carry into a system design:

- **CoALA taxonomy** (Sumers et al. 2024) is the conceptual frame. Working / episodic / semantic / procedural, mapped to context window / vector-or-graph store / structured knowledge / tools-and-skills. Most shipping memory systems are recognizable as implementations of one or two quadrants; reading any architecture against CoALA is the fastest way to spot what it's missing.
- **Default substrate is hybrid graph + vector with bitemporal edges.** Pure-vector memory should be treated as a 2023 architecture. Graphs (Microsoft GraphRAG, Graphiti) reduce hallucination on entity-relational queries; bitemporal edges (`valid_from` / `valid_to`) let you answer "what was true on date X" without re-reading transcripts.
- **Async batch extraction** beats per-turn or end-of-conversation. **Two-step extract-then-update** (Mem0 pattern) solves the contradictory-fact problem at write time.
- **Three-term retrieval scoring**: similarity + recency-decay + LLM-rated importance (Park et al. 2023 Generative Agents) is the de-facto template.
- **Decay matters and is still under-implemented.** Ebbinghaus-inspired (SAGE), reflection-based (Generative Agents), explicit TTL with importance tiers. Default to **archive, don't delete.**
- **Hierarchical / tiered memory** — short-term FIFO, mid-term summary, long-term semantic store. MemGPT/Letta's OS-style swap. The interesting design is at the boundaries (eviction policy, summary writer, cross-tier retrieval blending).
- **Treat retrieved memory as untrusted user input.** Memory poisoning (MINJA, Dong et al. 2025; A-MEMGUARD, Wang et al. 2025; Unit 42 reports) is a real attack class crossing session and trust boundaries. Sign provenance, gate writes through extraction with explicit instructions, surface provenance to the model at retrieval, audit-log every write.
- **Procedural memory unification** — tools, skills, prompt templates, few-shot examples are all the same kind of object (CoALA's procedural quadrant). Currently fragmented across systems; expect to consolidate.
- **Benchmarks**: LoCoMo (long-conversation QA), LongMemEval (five abilities including abstention), MemoryAgentBench (with novel selective-forgetting subset), MemoryBench (declarative + procedural). **If you only run one, run LongMemEval; if two, add MemoryAgentBench's selective-forgetting subset.** Selective forgetting is the open frontier — best public numbers are still 50–70%.

---

## 4. Putting it together — wiring memory into Claude Code or Codex

The answer to "how do I add persistent memory to my CLI coding agent in 2026" depends on three constraints: what agent, what data sovereignty, what kind of recall.

### Pattern A — Claude Code, single-user, local-first

Goal: a personal coding-assistant memory that survives session restarts, doesn't phone home, and is grep-able.

```jsonc
// .mcp.json
{
  "mcpServers": {
    "memory": {
      "command": "uvx",
      "args": ["basic-memory", "mcp"],
      "env": { "BASIC_MEMORY_HOME": "/home/me/notes" }
    }
  }
}
```

Plus a small `SessionStart` hook in `~/.claude/settings.json` that retrieves recent `memory-bank/` notes and injects them as `additionalContext`, and a `PostToolUse` hook on Edit/Write that asks the model to summarize what changed and append to `memory-bank/progress.md`. Add a one-line `@memory-bank/projectbrief.md` import in your project `CLAUDE.md`. License caveat: Basic Memory is AGPL-3.0 — fine for personal use, review before commercial.

If you want a richer engine without giving up local control, swap Basic Memory for **OpenMemory MCP** (Mem0 self-hosted) — Postgres + Qdrant + FastAPI on `localhost:8765`, single command bring-up.

### Pattern B — Claude Code, team / SaaS, cross-session and cross-user memory

Goal: a memory layer your fleet of agents shares, with audit and temporal correctness.

```jsonc
// .mcp.json — Graphiti MCP for entity/temporal memory
{
  "mcpServers": {
    "graphiti": {
      "command": "docker",
      "args": ["compose", "-f", "graphiti.yml", "up", "--abort-on-container-exit"],
      "env": { "OPENAI_API_KEY": "${OPENAI_API_KEY}", "NEO4J_URI": "bolt://neo4j:7687" }
    }
  }
}
```

Plus:
- A skill `.claude/skills/remember/SKILL.md` whose description tells Claude *when* to write to memory (build commands learned, error patterns, architecture insights). `disable-model-invocation: false`, `allowed-tools: mcp__graphiti__add_episode`.
- A `SessionStart` hook calling `mcp__graphiti__search_nodes` with the cwd as namespace, returning recent relevant episodes as `additionalContext`.
- A `PostToolUse` hook on tool errors — log the error + context as an episode so future sessions can avoid it.
- Per-user namespacing on the Graphiti side (the `(user, project, scope)` tuple from §7 of the architectures report). Read-only shared memory for team knowledge, read-write personal memory.
- A threat model. Memory is a write-able persistent surface that crosses trust boundaries; sign provenance, gate writes, audit-log everything. **Treat retrieved memory as untrusted input** in the agent's system prompt.

### Pattern C — OpenAI Codex CLI, cross-vendor portability

Goal: memory that works whether the user is in Codex today, Claude Code tomorrow, Cursor next week.

The right primitives are AGENTS.md + an MCP memory server + the Cline Memory Bank methodology. Specifically:

- A versioned `AGENTS.md` at repo root with project conventions and pointers (`See memory-bank/ for current state`).
- A `memory-bank/` directory with the Cline files (`projectbrief.md`, `productContext.md`, `activeContext.md`, `systemPatterns.md`, `techContext.md`, `progress.md`). The agent reads at start, writes at end. Every agent that can read markdown from disk participates.
- An MCP memory server for *cross-project* semantic recall — Mem0 plugin v1.0 if you want managed, OpenMemory MCP if local. Configured under `[mcp_servers.memory]` in `~/.codex/config.toml` (note the underscore — `mcp-servers` is silently ignored), and under `.claude/mcp.json` for Claude Code.
- **Don't enable Codex's built-in memories feature for team workflows** — it's per-user and not portable. Use it (if eligible regionally) only for personal IDE recall layered on top.

### Pattern D — Claude-native, full-control storage

Goal: Claude is the agent and you control storage end-to-end (encryption, on-prem, ZDR).

Use **Anthropic's memory tool** (`memory_20250818`). It's a tool primitive, not an MCP server: the model emits file-CRUD commands; your application executes them against your backend. Subclass `BetaAbstractMemoryTool` (Python) or `betaMemoryTool` (TS) and route storage to whatever fits compliance — encrypted FS, S3 with SSE, Postgres BLOB, an HSM. Compose with **context editing** (clear specific tool results client-side) and **compaction** (server-side summarization at context limits). The pattern Anthropic documents: long workflows compact older turns, but anything important is moved to memory before compaction so it survives.

This is the right answer if (a) you're committed to Claude, (b) you need control over storage for compliance, and (c) you're willing to write a small adapter. Skip if you need cross-vendor portability.

---

## 5. Recommendations by scenario

| Scenario | Stack |
|---|---|
| Solo developer, personal memory across projects | Claude Code + Basic Memory (or OpenMemory MCP) + AGENTS.md + memory-bank/ pattern |
| Coding agent for a small team, single repo | Claude Code or Codex + AGENTS.md + Mem0 plugin v1.0 + project-scoped MCP |
| Enterprise multi-agent fleet, audit + temporal | Graphiti / Zep with namespacing + read-only shared / read-write personal stores + provenance + audit logs |
| Claude-only product, full storage control | Anthropic memory tool + custom storage adapter + context editing + compaction |
| Coding agent with model portability | Letta Code + Context Repositories |
| Universal cross-app memory, zero ops | Supermemory hosted MCP |
| Building a stateful agent platform | Letta runtime (it wants to BE the runtime, not bolt onto one) |
| Heterogeneous corpora (docs + chats + tables) | Cognee with `cognify` + `memify` |
| Compliance-heavy SQL shop | Memori (SQL-native, joinable, exportable) |
| Hello-world / learning | `@modelcontextprotocol/server-memory` JSONL toy |

---

## 6. Open questions and things to watch

These are the open problems I expect to move significantly in the next 12–18 months. They're worth tracking because the whole topology may change.

- **Cross-agent memory portability.** No equivalent of OpenTelemetry for memory yet. Some convergence on MCP as the *interface*, but data models remain balkanized. The AAIF is the obvious place for an RFC; I'd watch their pipeline.
- **Memory provenance and citation.** When an agent answers using memory, can it tell you which fact contributed and where it came from? Mostly no, today. Anthropic citations point in the right direction for documents; nothing serious yet for derived semantic memory. Critical for trust, audit, and GDPR-style erasure.
- **Multi-tenant security.** Hard tenant separation at the storage layer is operationally expensive. The poisoning attack surface (MINJA et al.) is under-discussed in proportion to its blast radius.
- **Memory-context-window co-design.** With 1–2M-token windows and cheap prompt caching, the question "should this fact be in the prompt or in the retrievable store" is no longer obvious. Adaptive policies, MemGPT-style explicit paging trained into the model — the right division is unsettled.
- **Decay and consolidation in production.** Most products still require you to schedule pruning. Cognee's `memify`, MemoryOS heat-based promotion, Letta sleep-time compute, `mcp-memory-service` Ebbinghaus decay are early. This is the gap I'd build into if I were investing.
- **Procedural memory unification.** Skills, tools, prompt templates, and few-shots collapsing under one retrieval/lifecycle policy. SKILL.md is the consolidation candidate.
- **Selective forgetting.** Best public numbers on MemoryAgentBench's selective-forgetting subset are still 50–70%. Closing this gap is the most diagnostic single metric in the space.
- **Long context vs memory.** For tasks that fit in 1M tokens, fact-extraction memory may be a regression on quality (it loses signal during extraction). The decision rule will become formal: *memory is for cost and latency, not for quality, until your conversation exceeds the long-context regime*.

---

## Sources

Primary sources are in each sub-report. Cross-cutting:

- AGENTS.md spec — [agents.md](https://agents.md/) · [github.com/agentsmd/agents.md](https://github.com/agentsmd/agents.md)
- Agentic AI Foundation announcement — [openai.com/index/agentic-ai-foundation](https://openai.com/index/agentic-ai-foundation/)
- Model Context Protocol — [modelcontextprotocol.io](https://modelcontextprotocol.io/)
- Claude Code docs — [code.claude.com/docs](https://code.claude.com/docs/)
- Codex docs — [developers.openai.com/codex](https://developers.openai.com/codex)

Foundational papers:

- Sumers et al. (2024). *Cognitive Architectures for Language Agents*. [arXiv:2309.02427](https://arxiv.org/abs/2309.02427)
- Park et al. (2023). *Generative Agents*. [arXiv:2304.03442](https://arxiv.org/abs/2304.03442)
- Packer et al. (2024). *MemGPT: Towards LLMs as Operating Systems*. [arXiv:2310.08560](https://arxiv.org/abs/2310.08560)
- Edge et al. (2024). *GraphRAG*. [arXiv:2404.16130](https://arxiv.org/abs/2404.16130)
- Chhikara et al. (2025). *Mem0*. [arXiv:2504.19413](https://arxiv.org/abs/2504.19413)
- Rasmussen et al. (2025). *Zep / Graphiti*. [arXiv:2501.13956](https://arxiv.org/abs/2501.13956)
- Wu et al. (2024). *LongMemEval*. [arXiv:2410.10813](https://arxiv.org/abs/2410.10813)
- Dong et al. (2025). *MINJA: Memory Injection Attacks*. [arXiv:2503.03704](https://arxiv.org/abs/2503.03704)

## Related research in this repo

- `cli-agent-harness-survey/` — file-based agent harness reference (Codex, Cursor, Cline, Aider, Continue, Goose, Amp, Zed)
- `standalone-memory-tools-survey-2026/` — 13-tool memory-store catalog
- `memory-architectures-2026/` — architecture / theory / open problems
- `claude-managed-agents/` — Anthropic-hosted agent runtime including `/mnt/memory/`
- `agentic-self-improvement/` — meta-layer over memory (reflection, DSPy, eval loops)
- `cli-tools-for-ai-agents/` — adjacent: how to build CLI tools that agents call

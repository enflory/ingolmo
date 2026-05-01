# Research notes: AI memory systems

Date started: 2026-05-01

## Scope (from user)

- Agentic AI setup similar to Claude Code's "man-as-agents" — interpreting as **markdown-as-agents** / file-based agent definitions (Claude Code's `.claude/agents/*.md`, AGENTS.md, skills, hooks).
- Standalone memory solutions that work with Claude Code or Codex (CLI coding agents).
- Anything else relevant — focus on **persistent memory**.

## Prior work in this repo

- `claude-managed-agents/` (2026-04-29) — covers Anthropic's hosted Managed Agents API, including `/mnt/memory/` mount semantics, vaults, multi-agent. Read in full.
- `agentic-self-improvement/` (2026-05-01) — covers Mem0, MemGPT/Letta, DSPy, Reflexion/SAGE, EvoTest/EvoAgentX, deployment tiers. Read in full.

Implication: avoid re-deriving Mem0 / Letta / Managed Agents memory basics. Focus this thread on:
1. The **file-based agent harness pattern** (Claude Code's subagents, skills, hooks; Codex/Cursor/Cline equivalents). The prior threads don't cover this.
2. **Concrete integration paths** for each memory system into Claude Code and Codex (MCP servers, slash commands, hooks).
3. **2026 landscape additions** that postdate prior threads (Zep/Graphiti, Cognee, Memori, MemoryOS, A-MEM).
4. Memory-specific **architectural patterns** (graph vs vector, episodic/semantic split, decay, multi-agent shared memory).

## Plan

1. Pull together the canonical Claude Code agent/skills/hooks docs.
2. Survey AGENTS.md / Codex CLI / Cursor / Cline / Aider equivalents.
3. Survey standalone memory tools, with attention to MCP server availability.
4. Compare architectures and write up recommendations.

## Log

### 2026-05-01 — kickoff

Project setup. Branch `claude/research-ai-memory-systems-GEw0R` already created by harness. Working in `/home/user/ingolmo/ai-memory-systems/`.

Reading prior threads first to avoid duplication.

- `claude-managed-agents/README.md`: dense, well-organized. Memory section confirms `/mnt/memory/` is read/write filesystem mount with versioning, 100KB per memory, 8 stores per session, prompt-injection caveats. Memory is workspace-scoped not session-scoped.
- `agentic-self-improvement/README.md`: covers Mem0 in depth (Docker compose, 91% latency cut, 90% token savings), Letta brief mention, DSPy/MIPROv2, reflection patterns, decay (SAGE).

Both threads predate or skim what I'm being asked about now. Prior thread is the right starting point but I need to add: (1) Claude Code's local subagent system (totally different from Managed Agents), (2) the AGENTS.md spec adopted by OpenAI Codex and others, (3) MCP-based memory servers, (4) newer 2026 entrants like Zep/Graphiti, Cognee, Memori.

### 2026-05-01 — Claude Code agent harness (sub-agent research)

Delegated to claude-code-guide subagent. Key findings to incorporate:

**Subagents** (`.claude/agents/<name>/<name>.md`):
- Frontmatter: `name`, `description`, `model`, `tools` (space-separated list), `enable-memory` (boolean — gives the subagent its own auto-memory directory), `system-prompt-suffix`.
- Three invocation paths: automatic (description-driven delegation), explicit (`@agent-name`), programmatic (Agent/Task tool).
- Run in isolated context (worktree). Inherit CLAUDE.md but not main conversation.
- Sequential, not parallel within a session.
- Best practice: scope tools tightly; use Haiku for cheap exploration agents.

**Skills** (`.claude/skills/<name>/SKILL.md` + optional resources dir):
- Critical frontmatter: `description` (front-load use case, capped 1536 chars), `disable-model-invocation`, `user-invocable`, `allowed-tools`, `context: fork` (run in subagent), `agent` (which subagent), `paths` (glob, only loads when files match).
- Slash commands have been merged into Skills — `/foo` works whether it's `.claude/commands/foo.md` or `.claude/skills/foo/SKILL.md`. Skills are recommended for new work.
- Scope: project / user (`~/.claude/skills/`) / plugin / org-policy. Plugin skills namespaced as `plugin-name:skill-name`.
- Skills are reference/knowledge in the *current* context; subagents are isolated workers. Different tools.

**Hooks** (settings.json):
- Events: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `PreToolUse`, `PostToolUse`, `PermissionRequest`.
- Hook types: `command` (shell, JSON over stdin), `http` (POST), `mcp_tool` (call MCP), `prompt` (yes/no Claude judgment), `agent` (spawn subagent).
- Output schema: exit 0 + JSON `{hookSpecificOutput: {permissionDecision: allow|deny, additionalContext: ..., permissionDecisionReason: ...}}`.
- This is the natural place to wire in **persistent memory**: PostToolUse to capture observations, SessionStart to inject relevant memories, UserPromptSubmit to add retrieval context.

**MCP servers** (`.mcp.json` project-level / settings.json user-level):
- Standard for externalizing tool behavior including memory.
- Tools appear as callable in agentic loop, can be permissioned.
- Project > user > managed policy precedence.

**CLAUDE.md / AGENTS.md / memory files**:
- Hierarchical: walk up dir tree, lower dirs override upper.
- `CLAUDE.local.md` (gitignored, personal).
- `@import` syntax — `@README`, `@AGENTS.md`, etc., max 5 levels recursion.
- Auto Memory: `MEMORY.md` Claude writes itself, first 200 lines / 25KB loaded at startup. Distinct from CLAUDE.md (instructions, human-written).
- Pattern for AGENTS.md interop: `CLAUDE.md` containing `@AGENTS.md` + Claude-specific addendum.

**Plugins**:
- Package skills/agents/hooks/MCP/commands.
- Marketplace install: `/plugin install <repo-url>` or official marketplace.
- Always namespaced.

**Persistent-memory integration patterns surfaced by the subagent**:
1. `PostToolUse` hook → MCP memory server `log_observation` after every tool execution.
2. `SessionStart` hook → MCP memory server `retrieve_session_context` returning relevant prior learnings as `additionalContext`.
3. Dedicated "remember" skill that Claude invokes when something worth saving is discovered.
4. MCP memory server providing `store` / `retrieve_by_relevance` / `search_patterns` tools.

This is the right mental model for the report: memory lives outside Claude Code (MCP server), and the harness's hooks/skills/subagents are the *plumbing* that connects the agent to it.

### 2026-05-01 — three parallel subagent streams launched

Decided to delegate the heavy survey work to three subagents running in parallel:

1. **cli-agent-harness-survey/** — non-Claude-Code agent harnesses (Codex, Cursor, Cline, Aider, Continue, Goose, Amp, Zed) and the AGENTS.md / SKILL.md spec story.
2. **standalone-memory-tools-survey-2026/** — 13 memory tools surveyed comparatively, with focus on MCP integration and 2026 updates.
3. **memory-architectures-2026/** — opinionated technical synthesis of CoALA, storage substrates, write/read paths, decay, hierarchy, multi-agent, poisoning, evaluation.

Each subagent created its own thread directory per repo conventions. Their READMEs are the deliverables; this thread's README will be a synthesis that indexes them and adds the cross-cutting recommendations.

### 2026-05-01 — subagent thread #1 returned: cli-agent-harness-survey

Key takeaways to fold into synthesis:

- **AGENTS.md has won.** 60K+ repos by early 2026; OpenAI/Anthropic/Block put it under the Linux Foundation's Agentic AI Foundation in Dec 2025. Read by Codex, Cursor, Copilot, Gemini CLI, Devin, Sourcegraph Amp, Cline, Roo, VS Code, Windsurf, Aider (via `read:`), Zed, Warp; Claude Code reads it as fallback for missing CLAUDE.md.
- **MCP is universal** — Aider is the only laggard.
- **SKILL.md is consolidating** — Claude, Codex, Cursor, VS Code all read the same spec. Codex actively migrating users from `~/.codex/prompts/*.md` to Skills.
- **Cline Memory Bank** is the most-copied open memory pattern: just markdown files in a `memory-bank/` directory (`projectbrief.md`, `productContext.md`, `activeContext.md`, `systemPatterns.md`, `techContext.md`, `progress.md`). Tool-agnostic because it's plain markdown.
- **The portable 2026 stack**: AGENTS.md + MCP + Skills (SKILL.md) + memory-bank/ directory.
- Per-tool format details: Cursor `.cursor/rules/*.mdc` with frontmatter + 4 rule types (Always/Auto Attached/Agent Requested/Manual); Roo `.roomodes` + `.roo/rules-{slug}/`; Aider `.aider.conf.yml` with `read:` key; Continue `config.yaml` with `rules:` array; Goose two-layer (`.goosehints` + Memory Extension).
- Codex specifics: hierarchical AGENTS.md walked from git root → cwd, `~/.codex/` global. `[mcp_servers.*]` in `config.toml` (underscore matters — `mcp-servers` silently ignored). Sandbox modes (`read-only` / `workspace-write` / `danger-full-access`) × approval policies (`untrusted` / `on-request` / `never`).

### 2026-05-01 — subagent thread #2 returned: memory-architectures-2026

Highly opinionated, well-cited (CoALA, MemGPT, Voyager, Generative Agents, GraphRAG, Graphiti, SAGE, Mem0, MemoryOS, MINJA, A-MEMGUARD; LoCoMo, LongMemEval, MemoryAgentBench, MemoryBench).

Stances I want to carry into the synthesis:

- Pure-vector memory is a 2023 architecture; **2026 default is hybrid graph+vector with bitemporal edges**.
- Async batch extraction beats per-turn or end-of-conv.
- **Two-step extract-then-update** (Mem0 pattern) solves contradictory facts at write time.
- **Bitemporal supersession** (Graphiti) is the right answer for any system needing historical queries / audit / recovery.
- **Treat retrieved memory as untrusted user input.** Memory poisoning (MINJA, 2025) is real and under-discussed.
- **Three-term retrieval scoring**: similarity + recency-decay + LLM-rated importance (Park et al. 2023 Generative Agents) is the de-facto template.
- **Archive don't delete.** Hot vs cold memory tiers; only delete under regulatory requirement.
- **Procedural memory unification**: tools, skills, prompt templates, few-shots are all the same kind of object — currently fragmented across systems.
- **If you only run one benchmark, run LongMemEval; if two, add MemoryAgentBench's selective-forgetting subset.**
- Open problems: cross-agent memory portability, provenance/citation, multi-tenant security, memory-context co-design, prompt-caching interaction, the injection attack surface.

### 2026-05-01 — subagent thread #3 returned: standalone-memory-tools-survey-2026

Comprehensive — 13 tools + comparison table + 9-step decision flow + cross-cutting cautions.

Headline 2026 updates I didn't have:

- **Mem0 SDK 2.0 (April 16, 2026)**: single-pass extraction (~50% latency cut), entity-linked hybrid retrieval baked in (no more "vector vs graph" mode toggle). **Mem0 Plugin v1.0.0 (April 2, 2026)** for Claude Code/Cursor/Codex with 9 MCP tools + lifecycle hooks (auto-capture at session-start, compaction, task completion, session-end).
- **Letta Code (Dec 2025)** is now the #1 model-agnostic open-source coding agent on Terminal-Bench. **Context Repositories (Feb 12, 2026)** = git-backed memory directories, every edit a commit, subagents can branch/merge.
- **Anthropic memory tool** (`memory_20250818`) is a Claude *tool primitive*, not an MCP server. BYOI storage via `BetaAbstractMemoryTool` (Python) / `betaMemoryTool` (TS). Pairs with context editing + compaction. ZDR-eligible. Public beta as of March 2026.
- **OpenAI Codex memories** (Q1 2026 rollout): off by default, `[features] memories = true` in `~/.codex/config.toml`. Two sub-flags (`generate_memories`, `use_memories`). **Not available in EEA, UK, Switzerland at launch** — real European-deployment gotcha. Pattern: AGENTS.md for mandatory team rules (versioned), memories for personal IDE recall.
- **Zep's published 84% LoCoMo number was corrected to 58.44%** after community scrutiny ([zep-papers issue #5](https://github.com/getzep/zep-papers/issues/5)). Treat vendor benchmarks as advocacy.
- **Long-context models keep eating the floor** — recent analysis ([arXiv 2603.04814](https://arxiv.org/html/2603.04814v1)) finds long-context GPT-5-mini outperforms fact-based memory by 30+ points on LoCoMo/LongMemEval until ~10 turns past 100K tokens. **Memory wins on cost and latency, not raw accuracy.**
- **Supermemory** is the leading "universal memory" hosted product — five-layer pipeline, Cloudflare Durable Objects edge, sub-300ms at >100B tokens/month, hosted MCP URL per user.
- **Basic Memory's AGPL-3.0** is a license trap for commercial users.
- Decay is still the open problem — only Cognee (`memify`), MemoryOS (heat-based), Letta (sleep-time compute), and `mcp-memory-service` (Ebbinghaus) attempt automatic consolidation.

### 2026-05-01 — synthesis plan

The four research artifacts in order of generality:

1. `ai-memory-systems/README.md` — synthesis (this thread). The index that ties everything together with cross-cutting recommendations and the integration patterns into Claude Code / Codex specifically.
2. `cli-agent-harness-survey/README.md` — file-based agent harness reference.
3. `standalone-memory-tools-survey-2026/README.md` — memory tool catalog.
4. `memory-architectures-2026/README.md` — architecture/theory layer.

Synthesis sections planned:

1. Executive summary (the three convergences: AGENTS.md, MCP, SKILL.md; the four memory camps; bitemporal + hybrid + extraction)
2. The "markdown-as-agents" pattern — what it is, Claude Code's implementation, the cross-tool convergence, pointer to harness survey
3. The standalone memory tool landscape — four camps, picks by use case, pointer to tools survey
4. Architecture and patterns — CoALA, substrate choice, write/read/decay, multi-agent, pointer to architectures report
5. Putting it together: integration patterns into Claude Code and Codex with concrete config snippets
6. Single-user vs team/SaaS recommendations
7. Open questions
8. Sources / related work in this repo

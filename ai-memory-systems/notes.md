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

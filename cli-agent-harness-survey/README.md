# File-based agent harness patterns across CLI coding agents (2026)

*Research date: 2026-05-01. Scope: every major CLI/IDE coding agent except Claude Code itself, which a colleague is covering separately. Focus: how each agent loads project-level instructions, custom commands, memory, and tools from files on disk.*

## TL;DR

By mid-2026 the ecosystem has converged on three orthogonal open standards, two of which are now governed by the Linux Foundation's **Agentic AI Foundation** (AAIF), founded December 2025 by Anthropic, OpenAI, and Block and grown to 170+ member organizations by April 2026:

| Layer | Standard | Owner / origin | Status |
|---|---|---|---|
| Project instructions | **AGENTS.md** | OpenAI (Aug 2025), now AAIF | 60K+ repos, read by ~all major agents |
| Tools / integrations | **MCP** | Anthropic (Nov 2024), now AAIF | Universal among the agents below |
| Portable skills | **SKILL.md / Agent Skills** | Anthropic, now multi-vendor | Adopted by Claude, Codex, Cursor, VS Code, GitHub |

What is *not* yet standardized: rule-file format (each tool still has its own dialect — `.cursor/rules/*.mdc`, `.clinerules`, Aider's YAML+CONVENTIONS.md, Continue's `rules:` array, Goose's `.goosehints`), memory/persistence (every tool has a different model), and slash-command/prompt format (Codex `prompts/`, Continue `.continue/prompts/`, Cursor "modes", etc).

The following sections cover each system in detail.

---

## 1. AGENTS.md — the open spec

**URL:** [agents.md](https://agents.md/) · spec repo [github.com/agentsmd/agents.md](https://github.com/agentsmd/agents.md)

**Origin and backing.** AGENTS.md was introduced by OpenAI in August 2025 alongside Codex; by early 2026 it had been adopted by 60,000+ public repositories. In December 2025 it was placed under the **Agentic AI Foundation** (Linux Foundation) along with Anthropic's MCP and Block's Goose. ([OpenAI / AAIF announcement](https://openai.com/index/agentic-ai-foundation/), [InfoQ coverage](https://www.infoq.com/news/2025/08/agents-md/))

**Format.** A single markdown file at repo root (or in subdirectories of monorepos). It is just markdown — no frontmatter, no required schema. The spec recommends but does not enforce these sections:

- Project structure / overview
- Setup commands ("how to install dependencies and run the project")
- Build & test commands (the single highest-ROI section per [GitHub's analysis of 2,500 repos](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/))
- Code style / conventions
- Testing instructions
- Git workflow / commit conventions
- "Boundaries" — three-tier *Always do / Ask first / Never do*
- Security / deployment notes

The deliberate design choice is that semantic hinting comes from headings only, so any agent can parse it.

**Adoption list (verified in vendor docs).** Codex, Cursor, GitHub Copilot, Gemini CLI, Jules, Devin, Factory, Sourcegraph Amp, VS Code (Copilot agent), Windsurf, Aider, Zed, Warp, Roo Code, Cline. Claude Code reads AGENTS.md as a fallback when no `CLAUDE.md` is present in a directory ([anthropics/claude-code#34235](https://github.com/anthropics/claude-code/issues/34235), [AI Engineer Guide](https://aiengineerguide.com/til/how-to-use-agents-md-in-claude-code/)).

**Difference from CLAUDE.md.** Functionally identical content (same kind of project-context markdown). The differences are governance and resolution: CLAUDE.md is Anthropic-specific; AGENTS.md is vendor-neutral. Most teams now write AGENTS.md and keep CLAUDE.md as either a one-line `@AGENTS.md` include or remove it entirely.

---

## 2. OpenAI Codex CLI

**URL:** [github.com/openai/codex](https://github.com/openai/codex) · docs [developers.openai.com/codex](https://developers.openai.com/codex)

**Instruction loading.** Codex assembles an instruction chain at session start. ([OpenAI docs — AGENTS.md](https://developers.openai.com/codex/guides/agents-md))

1. **Global scope.** Read `$CODEX_HOME/AGENTS.override.md` if present, else `$CODEX_HOME/AGENTS.md`. Default home is `~/.codex`.
2. **Project scope.** Walk from the project root (git root) down to cwd. In each directory, check `AGENTS.override.md` → `AGENTS.md` → fallbacks (`TEAM_GUIDE.md`, `.agents.md`, plus anything in `project_doc_fallback_filenames`).
3. Per-file truncation: `project_doc_max_bytes` in `~/.codex/config.toml`.

**Custom prompts → Skills.** Markdown files at `~/.codex/prompts/*.md` are invokable as `/prompts:name`. Codex docs now mark these as **deprecated in favor of Agent Skills** ([Custom Prompts page](https://developers.openai.com/codex/custom-prompts), [Codex Skills](https://developers.openai.com/codex/skills)). Skills follow the SKILL.md spec — a folder with `SKILL.md` (YAML frontmatter: `name`, `description`, optional `license`/`compatibility`/`metadata`) plus optional `scripts/`, `references/`, `assets/`. Progressive disclosure: only the ~100-token name+description is loaded eagerly, full body only when invoked.

**MCP support.** Configured under `[mcp_servers.<name>]` in `~/.codex/config.toml` (project-scoped variant: `.codex/config.toml`, but only applied for trusted projects). Stdio command or streamable HTTP URL. Helper CLI: `codex mcp add <name> --env K=V -- <command>`. Note the section name is `mcp_servers` with an underscore — `mcp-servers` is silently ignored (an actual reported foot-gun, [openai/codex#3441](https://github.com/openai/codex/issues/3441)).

**Memory model.** Codex itself is per-session stateless on the LLM side; persistence is *file-based*: AGENTS.md is the canonical "memory", and skills are the canonical reusable procedural knowledge. There is no separate "memory" feature; writing memory means asking the agent to update AGENTS.md.

**Sandbox / approval.** Two orthogonal axes ([Sandbox docs](https://developers.openai.com/codex/concepts/sandboxing), [Approvals docs](https://developers.openai.com/codex/agent-approvals-security)):

- *Sandbox modes:* `read-only` / `workspace-write` / `danger-full-access`
- *Approval policies:* `untrusted` / `on-request` / `never`
- `--full-auto` is shorthand for `workspace-write` + `on-request`. `/permissions` switches at runtime.

---

## 3. Cursor — `.cursor/rules/*.mdc`

**URL:** [cursor.com/docs/context/rules](https://cursor.com/docs/context/rules) · [Memories](https://docs.cursor.com/en/context/memories)

**File format.** Cursor's modern format is **MDC** — markdown with YAML frontmatter — under `.cursor/rules/`. Frontmatter fields: `description`, `globs`, `alwaysApply`. Files have `.mdc` extension.

**Rule types** (UI-selectable, controls activation):

| Type | Activation |
|---|---|
| Always | Injected into every request |
| Auto Attached | Activated when current files match `globs` |
| Agent Requested | Loaded if the agent decides it's relevant given the task description |
| Manual | Inert until @-mentioned |

**Nested rules.** `.cursor/rules/` directories can live anywhere in the tree; rules in a subtree auto-attach when files under that subtree are referenced. This is how monorepos do per-package rules.

**Legacy.** `.cursorrules` (single root file, plain text) still loads in some modes but is silently ignored in Agent mode per multiple community reports — the migration target is `.cursor/rules/*.mdc` ([thepromptshelf.dev guide](https://thepromptshelf.dev/blog/cursorrules-vs-mdc-format-guide-2026/)).

**Cursor Memories.** Separate subsystem from rules: a sidecar model watches conversations and extracts candidate memories. User must approve before they're saved. The agent can also create memories explicitly via tool call. Project-scoped. Manage via *Settings → Rules*. Cursor's docs explicitly state that *rules are the only built-in mechanism for persistent memory* — Memories sit on top.

**MCP.** First-class via `.cursor/mcp.json` (project) or user settings (global), standard MCP server config schema.

**AGENTS.md.** Cursor reads AGENTS.md as a project-level instruction file, in addition to MDC rules.

---

## 4. Cline and Roo Code

**Cline:** [docs.cline.bot](https://docs.cline.bot/features/memory-bank) · **Roo Code (fork):** [docs.roocode.com](https://docs.roocode.com/features/custom-modes)

### Cline

**`.clinerules`** in the repo root: project-specific, plain markdown, version-controllable. User-level instructions live in VS Code settings.

**Memory Bank — a methodology, not a feature.** Cline's "Memory Bank" is the most influential community pattern in this space and worth treating as a separate object of study. It is not built into Cline; it is a convention encoded in `.clinerules` (or custom instructions) that tells Cline to maintain a `memory-bank/` directory of structured markdown:

- `projectbrief.md` — foundation document, requirements & goals
- `productContext.md` — why the project exists, UX goals
- `activeContext.md` — current focus, recent changes, next steps
- `systemPatterns.md` — architecture, design patterns, component relationships
- `techContext.md` — tech stack, setup, constraints
- `progress.md` — what works, what's left

The agent reads the entire memory bank at the start of each session (because the LLM is stateless). The pattern's killer feature is that *it is the agent's own job to update these files at the end of each task*. This is now widely copied into Cursor, Roo, and even Claude Code workflows ([Cline blog post](https://cline.bot/blog/memory-bank-how-to-make-cline-an-ai-agent-that-never-forgets), [forum discussion of Cursor adaptation](https://forum.cursor.com/t/how-to-add-cline-memory-bank-feature-to-your-cursor/67868)).

### Roo Code

Fork of Cline with a richer mode system.

- **`.roomodes`** at workspace root (YAML or JSON) defines project-scoped custom modes
- Global modes: `settings/custom_modes.yaml` in VS Code global storage
- Per-mode rule directories: `.roo/rules-{slug}/` (project) or `~/.roo/rules-{slug}/` (global)
- Mode schema: `slug`, `name`, `roleDefinition`, `customInstructions`, plus tool-access constraints

This gets used heavily for "SPARC orchestration"-style multi-agent setups inside one VS Code window.

**MCP.** Both Cline and Roo are first-class MCP clients with hot-reload of MCP servers from settings.

---

## 5. Aider

**URL:** [aider.chat/docs](https://aider.chat/docs/)

Aider is the longest-running tool in this list and its conventions predate AGENTS.md.

**Config.** `.aider.conf.yml` searched in `$HOME`, git repo root, and cwd; later files override earlier ones. ([config docs](https://aider.chat/docs/config/aider_conf.html))

**CONVENTIONS.md.** A *convention*, not a built-in. The `read:` key in `.aider.conf.yml` (or `--read CONVENTIONS.md` on CLI) loads any file as a read-only context with prompt caching enabled. This is the Aider-native equivalent of AGENTS.md, and most Aider users ship a `CONVENTIONS.md` plus a one-line config that always reads it. ([conventions docs](https://aider.chat/docs/usage/conventions.html))

**Repo map.** Aider's distinguishing feature: it builds an AST-based tree-sitter map of the repo's classes/functions/signatures and feeds a token-budgeted slice into context. `--map-tokens` controls budget (default 1k). ([repo map docs](https://aider.chat/docs/repomap.html))

**`/architect` mode.** Two-model workflow ([architect blog post](https://aider.chat/2024/09/26/architect.html)):

1. *Architect* model proposes a solution in natural language
2. *Editor* model converts the proposal into specific file edits

Originally motivated by the o1 family being strong at reasoning but weak at edit-format compliance. Aider claims SOTA on its edit benchmark with this split (e.g. o1-preview architect + DeepSeek editor at 85%).

**Memory.** Largely stateless per session. Persistence comes from `.aider.input.history`, `.aider.chat.history.md`, and any user-curated `CONVENTIONS.md`/memory file passed in via `read:`. No first-party memory feature.

**MCP.** No first-party MCP support as of mid-2026; community wrappers exist ([disler/aider-mcp-server](https://github.com/disler/aider-mcp-server)). Aider goes the other way — it is more often *exposed* as an MCP tool to other agents than it is a consumer of MCP.

---

## 6. Continue.dev

**URL:** [docs.continue.dev](https://docs.continue.dev/)

**Config evolution.** `config.json` is deprecated; canonical config is now `config.yaml` ([yaml-migration](https://docs.continue.dev/reference/yaml-migration)). `config.ts` at `~/.continue/config.ts` is supported for programmatic extension.

**Top-level keys** in `config.yaml`: `name`, `version`, `schema` (required), then `models`, `context`, `rules`, `prompts`, `docs`, `mcpServers`, `data`.

**Rules.** `rules:` is an array of strings (replaces the old `systemMessage`). For longer rules, store them as files in `.continue/rules/` and reference them.

**Prompts.** Replace deprecated `slashCommands`. Prompt files are markdown with frontmatter (`name`, `description`, `invokable`) under `.continue/prompts/`. Selected via `/` in chat.

**Context providers.** Pluggable: `@codebase`, `@docs`, `@file`, `@url`, custom providers. MCP servers also expose context items into this system.

**Agent mode.** Continue has Chat / Edit / Agent modes. **MCP only works in Agent mode** — this is a significant restriction. ([MCP docs](https://docs.continue.dev/customize/deep-dives/mcp))

**MCP config.** `mcpServers:` block in `config.yaml`, or standalone block files under `.continue/mcpServers/`.

**Continue Hub.** Cloud distribution layer for blocks (rules, prompts, mcpServers, models). Teams publish reusable blocks; users compose them into config.yaml via references. This is the closest thing to a "package manager for agent config" in the ecosystem.

---

## 7. Goose (Block)

**URL:** [block.github.io/goose](https://block.github.io/goose/) · part of AAIF since Dec 2025

**Config.** `~/.config/goose/config.yaml` (global). MCP-first design: every extension (filesystem, GitHub, memory, etc) is an MCP server.

**Two memory layers.** ([memory extension docs](https://block.github.io/goose/docs/tutorials/memory-mcp/), [.goosehints blog post](https://block.github.io/goose/blog/2025/06/05/whats-in-my-goosehints-file/))

- **`.goosehints`** — user-controlled instructions, lives in `~/.config/goose/` (global) or cwd (project), appended to system prompt at session start. The Goose-native equivalent of AGENTS.md; the team has signaled willingness to also read AGENTS.md given AAIF.
- **Memory Extension** — LLM-managed long-term memory. Stored as markdown on disk under `~/.config/goose/memory/` (global) and `.goose/memory/` (local), keyed by user-defined tags. The agent decides what to remember when prompted (`remember that...`); on session start all memories are loaded into the system prompt.

**Recipes.** YAML files bundling: instructions, required extensions, parameters, retry/recovery logic. A recipe is the Goose-native equivalent of a multi-step playbook — invoked by single command (e.g. `goose run --recipe fix-failing-tests.yaml`). ([recipe reference](https://block.github.io/goose/docs/guides/recipes/recipe-reference/))

**MCP.** Native and pervasive — Goose was an early MCP adopter and ships ~70 first-party extensions plus access to the 3,000+ community MCP server ecosystem.

---

## 8. Sourcegraph Amp and Zed

### Sourcegraph Amp

**URL:** [ampcode.com/manual](https://ampcode.com/manual)

Reads `AGENTS.md` (and historically `AGENT.md` singular) at project root for build/test conventions. ([Amp's AGENT.md announcement](https://ampcode.com/news/AGENT.md))

Notable migration ergonomic: Amp will offer to *generate* an AGENTS.md by scanning existing rule files from other tools — `.cursorrules`, `.cursor/rules/`, `.windsurfrules`, `.clinerules`, `CLAUDE.md`, `.github/copilot-instructions.md`. This is the cleanest in-the-wild example of cross-tool config migration.

MCP, slash commands, and skills are supported per the Owner's Manual.

### Zed agent panel

**URL:** [zed.dev/docs/ai/rules](https://zed.dev/docs/ai/rules)

Zed has the broadest rule-file polyglot in the ecosystem. Priority order:

```
.rules → .cursorrules → .windsurfrules → .clinerules
  → .github/copilot-instructions.md → AGENT.md → AGENTS.md
  → CLAUDE.md → GEMINI.md
```

Files at the top auto-include into every Agent Panel interaction. Zed also has a *Rules Library*: locally-stored snippets that can be auto-included or @-mentioned on demand. There is an active [discussion #36609](https://github.com/zed-industries/zed/discussions/36609) tracking explicit AGENTS.md-standard support.

Hooks/extensions: MCP via Zed's standard extension config; agent-panel "modes" similar to Cursor.

---

## 9. Convergence — the state of cross-agent portability in 2026

The 2026 picture is *partial convergence*:

**Project instructions: AGENTS.md has won.** Effectively every agent above either reads it natively or reads a superset that includes it. The remaining holdouts (Aider with `CONVENTIONS.md`, Goose with `.goosehints`) are likely to add it given AAIF participation; the AAIF mandate is explicitly to prevent format fragmentation. ([AAIF announcement](https://openai.com/index/agentic-ai-foundation/))

**Tools: MCP has won.** No serious agent in 2026 ships without an MCP client. The interesting questions have moved from "do we support MCP?" to "how do we keep MCP from blowing up the context window" (lazy loading, tool search, etc).

**Skills: SKILL.md is consolidating.** Anthropic's spec is now read by Claude Code, Codex, Cursor, VS Code, GitHub, OpenCode. Codex is actively pushing users away from "custom prompts" towards Skills. The progressive-disclosure model (~100 tokens to advertise, full body on demand) plus the folder-with-scripts/references pattern is the first serious answer to "how do you ship a 50-page playbook to an agent without burning the context".

**What is still per-tool:**

- **Per-tool rule formats.** Cursor `.mdc` (with YAML frontmatter and rule-types), Cline `.clinerules` (plain), Roo `.roomodes` + `.roo/rules-*/`, Continue `rules:` array, Aider `read:` config, Goose `.goosehints`. Tools tend to *read each other's files for migration* (Amp generating AGENTS.md from .cursorrules; Zed reading the polyglot list) but at runtime each uses its own format.
- **Memory / persistence.** Cursor Memories, Cline Memory Bank methodology, Goose Memory Extension, Roo per-mode rules, Aider chat history files, Continue's nascent `data:` block. Every one is different. There is no `MEMORIES.md` standard — yet. The closest convergent pattern is the Cline Memory Bank methodology because it is *just markdown files in a folder* and works with any agent.
- **Slash commands / prompts.** Codex `~/.codex/prompts/*.md` (deprecated for Skills), Continue `.continue/prompts/*.md`, Cursor mode-attached rules, Cline custom modes, Roo `.roomodes`. None portable.
- **Sandboxing / approval.** Codex's three-mode sandbox is the most explicit; others rely on IDE-level confirmations or YOLO toggles. No standard.

**The likely 2026-2027 trajectory.** Watch for AAIF to publish a "Memory" or "Persistence" RFC — that is the obvious next gap. Watch also for SKILL.md to subsume Codex prompts, Cursor manual-attached rules, and Continue prompt files. The sustainable cross-agent portability story for an end-user team in 2026 is:

1. Write **AGENTS.md** for project context (every agent reads it)
2. Use **MCP** for tool integrations (every agent reads it)
3. Ship **Skills** (SKILL.md folders) for reusable procedural knowledge
4. Maintain a **`memory-bank/` directory** (Cline-style) as a tool-agnostic persistence layer

That stack is read or readable by Codex, Claude Code, Cursor, Cline/Roo, Amp, Zed, Goose (with `.goosehints` pointing to it), and Continue (with rules referencing it). Aider participates by adding `read: [AGENTS.md, memory-bank/*.md]` to `.aider.conf.yml`. The remaining tool-specific files (`.mdc` rule packs, `.roomodes`, etc.) stay per-tool until/unless AAIF standardizes them.

**Caveat / things to flag.** A few items are moving fast and may have changed since 2026-04: (a) Claude Code's exact AGENTS.md fallback behavior — this was being tracked in [anthropics/claude-code#34235](https://github.com/anthropics/claude-code/issues/34235) and is reportedly live but the precedence rules vs. CLAUDE.md may have nuances we couldn't fully verify from secondary sources. (b) Codex Skills vs. Custom Prompts deprecation timeline — both still ship as of April 2026 but the docs explicitly recommend Skills. (c) The exact AAIF membership/governance setup is still maturing; the foundation is real but its RFC pipeline is light. (d) Continue's `slashCommands` removal — fully deprecated but some legacy configs still work; the YAML migration is the canonical path forward.

---

## Sources

**Standards bodies / specs**
- [agents.md — AGENTS.md spec](https://agents.md/) and [github.com/agentsmd/agents.md](https://github.com/agentsmd/agents.md)
- [InfoQ — AGENTS.md emerges as open standard](https://www.infoq.com/news/2025/08/agents-md/)
- [OpenAI — Agentic AI Foundation announcement](https://openai.com/index/agentic-ai-foundation/)
- [GitHub Blog — How to write a great agents.md (lessons from 2,500 repos)](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/)
- [Agent Skills spec (agentskills.io)](https://agentskills.io/home) and [github.com/agentskills/agentskills](https://github.com/agentskills/agentskills)

**OpenAI Codex CLI**
- [github.com/openai/codex](https://github.com/openai/codex) and [docs/agents_md.md](https://github.com/openai/codex/blob/main/docs/agents_md.md)
- [developers.openai.com/codex/guides/agents-md](https://developers.openai.com/codex/guides/agents-md)
- [Codex CLI reference](https://developers.openai.com/codex/cli/reference) · [Config basics](https://developers.openai.com/codex/config-basic) · [Advanced config](https://developers.openai.com/codex/config-advanced) · [Config reference](https://developers.openai.com/codex/config-reference)
- [Custom Prompts (deprecated)](https://developers.openai.com/codex/custom-prompts) · [Slash commands](https://developers.openai.com/codex/cli/slash-commands) · [Agent Skills](https://developers.openai.com/codex/skills)
- [Codex MCP](https://developers.openai.com/codex/mcp)
- [Sandbox concepts](https://developers.openai.com/codex/concepts/sandboxing) · [Approvals & security](https://developers.openai.com/codex/agent-approvals-security)

**Cursor**
- [Cursor Rules docs](https://cursor.com/docs/context/rules) and [docs.cursor.com/context/rules](https://docs.cursor.com/context/rules)
- [Cursor Memories docs](https://docs.cursor.com/en/context/memories)
- [thepromptshelf.dev — .cursorrules vs .mdc 2026 guide](https://thepromptshelf.dev/blog/cursorrules-vs-mdc-format-guide-2026/)
- [Lullabot — Cursor Rules + Memory Banks](https://www.lullabot.com/articles/supercharge-your-ai-coding-cursor-rules-and-memory-banks)

**Cline / Roo Code**
- [Cline Memory Bank docs](https://docs.cline.bot/features/memory-bank)
- [Cline blog — Memory Bank: AI agent that never forgets](https://cline.bot/blog/memory-bank-how-to-make-cline-an-ai-agent-that-never-forgets)
- [cline/prompts on GitHub — temporal-memory-bank.md](https://github.com/cline/prompts/blob/main/.clinerules/temporal-memory-bank.md)
- [Roo Code custom modes docs](https://docs.roocode.com/features/custom-modes) · [Using modes](https://docs.roocode.com/basic-usage/using-modes)

**Aider**
- [aider.chat/docs](https://aider.chat/docs/)
- [.aider.conf.yml docs](https://aider.chat/docs/config/aider_conf.html)
- [Conventions docs](https://aider.chat/docs/usage/conventions.html)
- [Chat modes](https://aider.chat/docs/usage/modes.html) · [Architect/editor blog post](https://aider.chat/2024/09/26/architect.html)
- [Repository map docs](https://aider.chat/docs/repomap.html)

**Continue.dev**
- [docs.continue.dev — config.yaml reference](https://docs.continue.dev/reference)
- [YAML migration guide](https://docs.continue.dev/reference/yaml-migration)
- [Slash commands](https://docs.continue.dev/customize/slash-commands)
- [MCP setup](https://docs.continue.dev/customize/deep-dives/mcp)
- [Configuring models, rules, tools](https://docs.continue.dev/guides/configuring-models-rules-tools)

**Goose**
- [block.github.io/goose](https://block.github.io/goose/)
- [Memory Extension tutorial](https://block.github.io/goose/docs/tutorials/memory-mcp/)
- [.goosehints blog post](https://block.github.io/goose/blog/2025/06/05/whats-in-my-goosehints-file/)
- [Recipe reference guide](https://block.github.io/goose/docs/guides/recipes/recipe-reference/)

**Sourcegraph Amp**
- [Amp Owner's Manual](https://ampcode.com/manual)
- [AGENT.md announcement](https://ampcode.com/news/AGENT.md)
- [amp-examples-and-guides — agent-file](https://github.com/sourcegraph/amp-examples-and-guides/blob/main/guides/agent-file/README.md)

**Zed**
- [Zed AI Rules](https://zed.dev/docs/ai/rules)
- [Zed Agent Panel](https://zed.dev/docs/ai/agent-panel)
- [Discussion #36609 — AGENTS.md standard support](https://github.com/zed-industries/zed/discussions/36609)

**Claude Code (AGENTS.md interop only — full coverage in colleague's report)**
- [anthropics/claude-code#6235 — AGENTS.md support](https://github.com/anthropics/claude-code/issues/6235)
- [anthropics/claude-code#34235 — AGENTS.md as native context file](https://github.com/anthropics/claude-code/issues/34235)
- [AI Engineer Guide — How to use AGENTS.md in Claude Code](https://aiengineerguide.com/til/how-to-use-agents-md-in-claude-code/)

## Related research in this repo

- `cli-tools-for-ai-agents/` — adjacent, covers how to build CLI tools that agents call (the *tool* side of the harness, not the *config* side)
- `claude-managed-agents/` — Anthropic-hosted agent deployment
- `ai-memory-systems/` — broader memory-architecture survey
- `agentic-self-improvement/` — the meta-layer over evals and memory

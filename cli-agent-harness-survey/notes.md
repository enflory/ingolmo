# Notes — CLI agent harness file-based config survey

Goal: comparative survey of "markdown-as-agents" / file-based agent harness pattern across CLI coding agents, EXCLUDING Claude Code itself (covered separately).

Targets:
1. AGENTS.md spec (agents.md)
2. OpenAI Codex CLI
3. Cursor rules (.cursor/rules/*.mdc, memories)
4. Cline / Roo Code (.clinerules, memory bank)
5. Aider (.aider.conf.yml, CONVENTIONS.md, /architect, repo map)
6. Continue.dev (config.json/ts, slash, context providers, agent mode, MCP)
7. Goose (goose.yaml, recipes, memory extension)
8. Sourcegraph Amp, Zed agent panel
9. Convergence: is AGENTS.md becoming THE spec?

## Prior work scan
- `cli-tools-for-ai-agents/` — closely related, focuses on CLI-tool-for-agent design, not on agent-config files. Not duplicative.
- `claude-managed-agents/`, `agentic-self-improvement/`, `ai-memory-systems/` — adjacent, mention briefly if relevant.

## Research log

### Round 1 — primary fetches
- Tried direct WebFetch on agents.md, github.com/openai/codex, developers.openai.com/codex, docs.cursor.com — all 403 or empty (likely UA / Cloudflare). Pivot to WebSearch to read snippets.

### Round 2 — search snippets
Key findings consolidated:

**AGENTS.md**
- Authored / launched by OpenAI in Aug 2025; now adopted by 60K+ open-source repos.
- December 2025: Anthropic, OpenAI, and Block co-found the Agentic AI Foundation under Linux Foundation, consolidating MCP (Anthropic) + Goose (Block) + AGENTS.md (OpenAI).
- AAIF reportedly grew to 170+ member orgs by April 2026.
- Cross-tool readers (per multiple secondary sources): Codex, Cursor, GitHub Copilot, Gemini CLI, Jules, Devin, Factory, Amp, VS Code, Windsurf, Aider, Zed, Warp, Roo Code. Claude Code reads AGENTS.md as a fallback when CLAUDE.md isn't present.
- Common sections: build/test commands, code style, testing instructions, git workflow, project structure, "Boundaries" (always do / ask first / never do).

**Codex CLI**
- Hierarchical AGENTS.md resolution: global (~/.codex/AGENTS.override.md → AGENTS.md), then walk from project root (git root) down to cwd, in each directory checking AGENTS.override.md → AGENTS.md → fallbacks (TEAM_GUIDE.md, .agents.md, configurable via project_doc_fallback_filenames).
- Knobs: project_doc_max_bytes, project_doc_fallback_filenames in ~/.codex/config.toml.
- Custom prompts: ~/.codex/prompts/*.md, invoked as `/prompts:name`. NOTE: deprecated in favor of Skills.
- Skills: SKILL.md folder format, progressive disclosure (Anthropic's open standard, also adopted by Codex).
- MCP: `[mcp_servers.<name>]` table in config.toml; stdio command or HTTP URL; `codex mcp add` CLI; `.codex/config.toml` for project scope (trusted projects).
- Sandbox modes: read-only / workspace-write / danger-full-access. Approval policy: untrusted / on-request / never. `--full-auto` = workspace-write + on-request.

**Cursor**
- New format: `.cursor/rules/*.mdc` (MDC = markdown + YAML frontmatter). Old `.cursorrules` legacy still works in some modes but silently ignored in Agent mode (per community).
- Frontmatter: description, globs, alwaysApply.
- Four rule types: Always / Auto Attached / Agent Requested / Manual.
- Nested rules: `.cursor/rules` directories anywhere in tree; auto-attach when files in their directory are referenced.
- Memories: separate from rules. Sidecar model observes conversations and extracts memories (with user approval, or via tool call). Project-scoped. Manage via Settings → Rules.

**Cline / Roo Code**
- `.clinerules` file in repo root (project-specific); user-level instructions in VS Code settings.
- Memory Bank is a *methodology*, not a built-in feature: convention of `memory-bank/` directory with projectbrief.md, productContext.md, activeContext.md, systemPatterns.md, techContext.md, progress.md.
- Roo Code (fork of Cline): `.roomodes` (YAML or JSON) for project-level custom modes; `settings/custom_modes.yaml` for global. Per-mode rules in `.roo/rules-{slug}/` (project) or `~/.roo/rules-{slug}/` (global).

**Aider**
- `.aider.conf.yml` searched in $HOME, git root, cwd; later overrides earlier.
- CONVENTIONS.md is convention not built-in: load via `--read CONVENTIONS.md` or `read:` key in config.
- `/architect` mode: two-model (architect proposes, editor produces edits). Model pair flag.
- Repo map: AST-based, --map-tokens controls budget (default 1k).
- Mostly stateless across sessions; persistence is the chat history file + user-managed conventions/memory files. MCP only via 3rd-party `aider-mcp-server` wrappers (no first-party MCP).

**Continue.dev**
- Config moved from JSON to YAML (config.yaml) — config.json is deprecated. config.ts also supported for programmatic extension at ~/.continue/config.ts.
- Top-level: name, version, schema, models, context, rules, prompts, docs, mcpServers, data.
- Rules: array of strings (replaced systemMessage).
- Prompts: replace deprecated slashCommands; .md files with frontmatter (name, description, invokable) under .continue/prompts/.
- MCP: only in agent mode; mcpServers block in config.yaml, or standalone block files under .continue/mcpServers/.
- Continue Hub: cloud distribution / sharing of blocks (rules, prompts, mcpServers).

**Goose (Block)**
- Two memory layers: `.goosehints` (user-controlled, lives in ~/.config/goose/ or cwd; appended to system prompt) and Memory Extension (LLM-managed, tag-keyed, persisted to disk).
- Recipes: YAML files bundling instructions, extensions, parameters, retry logic. Single-command execution.
- All extensions are MCP servers (Goose was an early MCP adopter; now part of AAIF).

**Sourcegraph Amp**
- Reads AGENTS.md (and AGENT.md historically) at project root.
- Will offer to generate AGENTS.md by reading existing rule files: .cursorrules, .cursor/rules, .windsurfrules, .clinerules, CLAUDE.md, .github/copilot-instructions.md.

**Zed**
- Rules priority order: .rules → .cursorrules → .windsurfrules → .clinerules → .github/copilot-instructions.md → AGENT.md → AGENTS.md → CLAUDE.md → GEMINI.md.
- Rules Library: stored locally, can be @-mentioned or auto-included.
- Active GitHub discussion #36609 explicitly tracks AGENTS.md standard support.

### Convergence note
- AGENTS.md is the dominant spec for the "project instructions" layer.
- MCP is the dominant spec for the "tool layer".
- Skills (SKILL.md, Anthropic-originated, now multi-vendor) is the emerging spec for the "portable procedural knowledge" layer.
- Memories / persistent state remain proprietary and per-tool, with no convergent standard yet.
- Cross-rule-file portability still messy: Cursor `.cursor/rules/*.mdc` (with frontmatter), Cline/Roo `.clinerules` (plain), Continue rules-as-strings in YAML, Aider conventions-via-config, Goose `.goosehints`. Tools tend to read each other's files for migration but not run-time.

### Sources captured
See README.md sources list.

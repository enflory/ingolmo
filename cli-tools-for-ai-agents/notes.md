# notes — building CLI tools that AI agents can use effectively

Research date: 2026-05-01.
Goal: understand what makes a CLI tool "agent-friendly" — i.e. usable by LLM-driven agents (Claude Code, Codex CLI, Cursor agents, OpenAI Agents, autonomous Devin-style runs) — and produce a reusable design guide.

## Prior work in this repo

- `claude-managed-agents/` — covers how to *deploy* agents on Anthropic infra. Mentions tools but not CLI design.
- `agentic-self-improvement/` — about evolving prompts/memory across runs. Tangential.
- Nothing in this repo directly covers CLI ergonomics for agents.

## Working hypotheses to validate

1. Agent-friendly CLIs differ from human-friendly CLIs in measurable ways: deterministic output, structured (parseable) output by default or behind a flag, no interactive prompts, good `--help` text, stable exit codes, idempotency.
2. The biggest wins come from *output discipline*: prefer structured text (JSON/NDJSON) over ANSI-decorated tables, and from flag/subcommand surfaces that are flat enough to reason about without 10 levels of nested help.
3. Agents are token-constrained, so verbosity and redundancy in output is a design defect. `--quiet`, paging, and pruning matter.
4. Trust and safety: agents need irreversible operations to be obvious. Dry-run/`--plan` modes and explicit destructive flags are highly valuable.
5. CLI tools designed for humans first that became agent-favorites (`rg`, `jq`, `fd`, `gh`, `git`) share certain properties — find them and codify.
6. MCP and "tool calling" are the new layer over CLIs — but a well-designed CLI is still the cheapest, most portable agent tool.

## Plan

Sources to fetch:
- Anthropic engineering blog on Claude Code / agent tool design
- OpenAI cookbook entries on tool design
- Heroku CLI style guide and clig.dev (foundational CLI design references)
- Posts from Simon Willison, Armin Ronacher, others on CLI + LLMs
- Real-world agent harnesses and what they prefer (Aider, Continue, Claude Code, Codex CLI)


---

## Findings — first pass

### Anthropic "Writing effective tools for AI agents" (Sep–Nov 2025 era)
URL: https://www.anthropic.com/engineering/writing-tools-for-agents

Five named principles:
1. **Choose the right tools to implement** — don't just wrap an existing API surface 1:1. More tools ≠ better outcomes; a common error is exposing every endpoint as a tool. Design tools for the *agent's* unit of work, not for the API's resource model.
2. **Namespace tools** — group with prefixes (`asana_search`, `asana_projects_search`). Helps the model pick the right tool when many exist.
3. **Return meaningful context** — eschew low-level technical IDs (uuid, mime_type, 256px_image_url). Prefer human-readable fields (name, image_url, file_type). Resolving UUIDs to semantic identifiers (or 0-indexed schemes) "significantly improves Claude's precision in retrieval tasks by reducing hallucinations." Offer `concise` vs `detailed` response modes.
4. **Optimize for token efficiency** — pagination, range selection, filtering, truncation by default. Claude Code's tool responses are restricted to 25,000 tokens by default. Format matters: XML/JSON/Markdown have different effects, no one-size-fits-all.
5. **Prompt-engineer tool descriptions** — describe like onboarding a new teammate. Include example usage, edge cases, input format, boundaries vs other tools. Use unambiguous parameter names (`user_id` not `user`). Lots of invalid-parameter errors → descriptions need work.

Evaluation methodology:
- Stand up prototype, test locally
- Then build a comprehensive eval (real-world tasks)
- Track: total runtime per call/task, total number of tool calls, total tokens, tool errors
- Read raw transcripts, not just summaries
- Use Claude itself to refine descriptions iteratively (the article's punch line: "writing tools for agents — using agents")

Key quote: "tools are a new kind of software which reflects a contract between deterministic systems and non-deterministic agents."

### Mei Park, "Rewrite your CLI for agents (or get replaced)"
URL: https://www.theundercurrent.dev/p/rewrite-your-cli-for-agents-or-get

Minimum viable checklist:
- `--json` flag everywhere
- Structured output to **stdout**, human messages to **stderr** (so pipes work)
- Meaningful exit codes — not just 0/1; agents need to branch on failure modes
- Idempotent operations (agents retry; tolerate that)
- Schema introspection: `mytool schema <command>` returns the input/output shape
- NDJSON pagination (one JSON object per line, streamable, no buffering)
- Noun-verb command structure (`mytool resource action`) — turns discovery into tree search
- TTY detection: pretty for humans, JSON for pipes, automatically

### InfoQ "Keep the terminal relevant"
URL: https://www.infoq.com/articles/ai-agent-cli/

- Treat output formats as **stable API contracts** (versioning matters)
- Machine-friendly escape hatches: flags + env vars + semantic exit codes
- Graceful shutdown on SIGTERM with state cleanup (agents kill long-running tools)
- Anti-interactive: explicit `--no-prompt` / `--no-interactive` / `--no-pager`. Disable stdin reads when set. Visible in `--help`.
- Suggests considering MCP adoption alongside the CLI

### slavakurilyak "Agent-Friendly CLI Tools"
URL: https://slavakurilyak.com/posts/agent-friendly-cli-tools/

- Default to text-first; offer `--json` (mirrors `git status` vs `git status --porcelain`)
- Wrap commands so output is JSON natively to avoid regex parsing
- `--dry-run` should produce **structured** output (e.g. JSON diff) not free text — diffs ARE the artifact agents act on
- `--yes`/`--no-confirm`/`--force` to bypass prompts
- Standard exit codes: 0 success, 1 generic error, 2 misuse, 127 not found

### "The shell is a better LLM endpoint than your protocol" (ikangai)
URL: https://www.ikangai.com/the-shell-is-a-better-llm-endpoint-than-your-protocol/

Argument: every "agent OS" reinvention reduces back to facilities Unix already has.
- Skills are CLIs
- Composition is shell
- State is filesystem
- Coordination is process trees
- Distribution is files
The model drives the loop, the shell executes the work, files persist state.

### MCP vs CLI tradeoffs (multiple 2026 sources)
- CLI is dramatically cheaper in tokens (4-32x reported by some benchmarks)
- MCP servers eagerly load schemas into context (e.g. full GitHub MCP server ≈ 55K tokens before any work)
- LLMs already know `git`/`docker`/`kubectl` from training data; CLI requires no new learning
- MCP wins for: stateful auth, per-user scopes, audit, tools that have no CLI
- 2026 consensus: hybrid. CLI for the well-known 80%, MCP for the 20% needing auth/state.
- Implication for tool authors: ship a CLI first. MCP is an add-on, not a replacement.

### CLI-first skill design (agentic-patterns.com)
- Skills designed as CLIs are dual-use: humans run them directly, agents shell out
- Resolves the API-first (programmable but undebuggable) vs GUI-first (debuggable but unautomatable) tension
- Anthropic's Skills format (SKILL.md + progressive disclosure) was adopted by OpenAI, Google, GitHub, Cursor in late 2025

### NO_COLOR / TTY / output-mode conventions
- Honor `NO_COLOR` env var (any non-empty value disables ANSI)
- Optional: `CLICOLOR` (0 disables), `CLICOLOR_FORCE` (non-0 forces)
- Detect TTY on stdout *and* stderr separately
- Provide `--color=always|never|auto` override
- Anti-pattern: ANSI escape codes baked into JSON output → poisons agent parsing

### GitHub CLI as exemplar
- `gh ... --json field1,field2 --jq '.[] | .field1'` — embed a built-in jq filter so the agent doesn't need a piped jq
- Internal jq library — no system dep
- Field-selection forces explicit projection; reduces accidental token blowups

### Claude Code Bash tool patterns
- Bash tool prefers CLIs (`gh`, `aws`, `gcloud`, `sentry-cli`) over equivalent MCP servers
- Tool responses capped at 25,000 tokens by default
- Output filtering hooks cut 40–60% of incidental noise from `npm install` / `pip install` / `terraform plan`
- Task budgets let the model see a running token countdown to self-regulate


## Findings — second pass

### keyboardsdown "Agent-first CLIs are about reducing turns, not JSON"
URL: https://keyboardsdown.com/posts/01-agent-first-clis/

Big idea: the JSON-everywhere advice misses the point. The ultimate optimization is **reducing the number of agent ↔ tool turns** to complete a task.

- Agents pay both latency and tokens per turn. Every "I got an error, let me try `--help`" is a wasted turn.
- Print the full command structure up-front in the top-level `--help` so the agent doesn't drill in.
- Errors should include the recovery in the same response: not just "missing flag --foo" but "missing --foo; valid values are A, B, C; example: `mytool x --foo A`".
- Mutating commands return a **receipt** with an `undo_command` field — so the agent has the undo before it knows it needs it.
- "Next actions" hints in success output ("run `myctl images list` to see available tags") give a concrete next step instead of free exploration.
- Separate transient (network blip → retry) from permanent (auth → re-auth) errors so the agent can pick a strategy without a turn.

### Propel "Agent-first CLI design: make coding agents reviewable"
URL: https://www.propelcode.ai/blog/agent-first-cli-design-coding-agents

- CLIs become the **review surface** when agents drive them. A human used to read color and infer intent; an agent and a reviewer both need that intent serialized.
- For high-leverage tools (anything that opens a PR, modifies files, hits an external system): emit a **plan** before executing, plus **review artifacts** (what changed, what permissions used, scope).
- Pattern: plan-then-execute. Output the plan as structured data → policy hooks can approve/deny → execute against the same plan id.

### Block engineering "3 principles for designing agent skills"
URL: https://engineering.block.xyz/blog/3-principles-for-designing-agent-skills

1. Lock down the deterministic parts: hardcode CLI invocations, exact flags, SQL templates. Don't let the model improvise things that need to be consistent.
2. Let the agent reason about what matters: if everything is locked down, the skill is just a CLI tool with extra steps.
3. Create a **conversation arc**: the script's output becomes the agent's input. After running it, the agent has full context (repo analyzed, what passed/failed, recommendations) — it can hold a coherent dialogue.

### Speakeasy "Making your CLI agent-friendly"
URL: https://www.speakeasy.com/blog/engineering-agent-friendly-cli

- `--non-interactive` / `--skip-interactive` to bypass prompts entirely. Sensible defaults or fail-fast.
- **Auto-detect agent environments** — known env signatures (Claude Code, Cursor, Codex, Aider, Cline, Windsurf, Copilot, Q, Gemini Code Assist, Cody) → switch on agent mode automatically.
- Per-operation commands generated from OpenAPI; pairs with built-in auth, multiple output formats, shell completions.

### "Conversation arc" implication
The CLI output is not just a return value — it primes the next turn. So:
- Include the metadata the agent will need to take a sensible follow-up action.
- Don't return so much that you bury the useful signal.

### Versioning / stability
- Treat CLI output schema as a versioned API contract.
- One source claims tool versioning causes ~60% of production agent failures (citation needed, but the direction is right).
- Include a schema/version field in machine output (`{"v": 1, ...}`) so consumers can detect breaking changes.

### Sandboxing / blast radius
- Don't rely on confirmation prompts as your safety: agents will accept everything to make progress, and humans rubber-stamp at 3am.
- Real safety = OS-level sandbox + scoped credentials + filesystem boundaries (workspace-only writes by default) + network isolation.
- CLI design implication: **default to read-only**. Make destructive intent explicit at the *flag* level (`--write`, `--delete`, `--apply`), not just at the *prompt* level.
- Receipts / structured plans give policy engines something to gate on.

### Reducing-turns checklist (synthesis from multiple sources)
- Top-level `--help` exposes the full command tree, not just the next level
- Error → suggested fix in the same payload
- Success → "next actions" hints when sensible
- Mutations → `undo_command`
- Transient vs permanent error distinction (different exit codes or an explicit field)
- Idempotency keys so retries don't double-fire

### What real agent-favored CLIs share (rg, fd, jq, gh, kubectl, docker, git)
- **Stable, narrow contract** — same flags work for years
- **Predictable text output** that LLMs already saw in training (huge: pretraining corpus has billions of examples of these tools)
- **Filtering at source**: `rg --json`, `gh ... --jq`, `kubectl -o json`, `git --porcelain`
- **Composable**: stdin/stdout pipes, no embedded UI assumptions
- **Fast**: an agent calling 50 times is still cheap
- Anti-pattern these tools all avoid: hidden interactive prompts mid-stream


---

## Synthesis — five orthogonal axes

After cross-comparing all sources, the design space collapses to five orthogonal axes. A tool can be evaluated against each:

1. **Discoverability** — can the agent figure out what your tool does and how to invoke it without burning turns?
   - Top-level `--help` shows the full tree, not just one level
   - Noun-verb structure
   - `tool schema <subcommand>` for input/output JSON Schema
   - Auto-detect agent env (Claude Code / Cursor / Codex) → switch defaults
2. **Output discipline** — does the output cost the right number of tokens for the right information?
   - `--json` (or NDJSON) everywhere; structured to stdout, human messages to stderr
   - Pagination/range/filter/truncate by default
   - Field projection (`--json field1,field2`) so the agent pays only for what it asked for
   - No ANSI in JSON output; honor `NO_COLOR` and TTY detection for human output
   - Concise vs detailed response modes
   - Stable, versioned schema (`"v": 1`) treated as an API contract
3. **Failure modes** — when something goes wrong, can the agent recover in zero or one extra turn?
   - Distinct, semantic exit codes (not just 0/1)
   - Errors include the fix: missing flag → list valid values + example invocation
   - Transient vs permanent classified explicitly
   - Idempotency keys so retries don't double-fire
   - SIGTERM cleanly with state preserved
4. **Side-effect honesty** — can the agent reason about what will happen, and undo it?
   - Default read-only; explicit `--write`/`--apply`/`--delete` flags
   - `--dry-run` produces structured (JSON) diff/plan, not prose
   - Mutating commands return a receipt with `undo_command`
   - `--non-interactive` / `--yes` / `--no-prompt` to bypass confirmations
   - Pre-execution plan output for high-leverage operations (PRs, file edits, external APIs)
5. **Composability** — does the tool fit Unix and the agent's existing skills?
   - Pipes work (stdin in, stdout out)
   - One job, one tool — don't roll up everything
   - Reuse known names (`-o json` not `--output-mode JSON`)
   - LLMs already know `git`/`gh`/`docker`/`kubectl`/`jq`/`rg`/`fd` — borrow that prior

## Sharpest contrarian takeaway

The most-cited advice (`--json` everywhere) is necessary but not sufficient. The deeper insight from keyboardsdown / Block / Propel:

**Agent-first CLI design is about minimizing turns, not just formatting output.** A tool that returns perfect JSON but forces the agent to make 7 calls to do one user task is worse than a tool that takes one call and returns slightly noisier JSON.

This reframes most other rules:
- Schema introspection isn't about elegance, it's so the agent doesn't need a turn to discover the API.
- Receipts with `undo_command` aren't a nicety, they're a way to skip a future turn ("how do I undo this?").
- Errors with suggestions aren't politeness, they're turn elimination.
- Plan-and-execute isn't safety theater, it's a single-call review surface.

## Anti-patterns roundup

1. Wrapping every API endpoint as a tool / subcommand 1:1 (Anthropic warns explicitly)
2. Returning raw UUIDs/MIME types when the agent really needs a name and a file_type
3. Mid-stream interactive prompts with no `--no-prompt` escape
4. ANSI escapes baked into machine output
5. Free-form prose error messages with no recovery path
6. Mixing structured output and human progress text on stdout (use stderr for the second)
7. Single `--success`/`--failure` exit codes — no way to branch on cause
8. No versioning on output schema — agents wedged when you ship a breaking change
9. Confirmation prompts as the safety boundary (agents say yes to everything; sandbox is the real boundary)
10. Loading 50K tokens of tool schema upfront when only one tool will be used (favor on-demand discovery, e.g. Anthropic's Tool Search Tool)
11. Wrapping the whole tool in an MCP server when a CLI is sufficient — pays a context tax, gains little when the model already knows the CLI


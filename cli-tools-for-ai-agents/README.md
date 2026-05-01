# Building CLI Tools That AI Agents Can Use Effectively

*Research date: 2026-05-01*

## Executive summary

CLIs have become the dominant tool layer for production AI agents in 2026. They are 4–32× cheaper in tokens than equivalent MCP servers for the well-known case, the model already knows them from pretraining, and they compose with the rest of Unix without a runtime. The 2026 consensus is **CLI for the 80% well-known case, MCP for the 20% that needs auth/state/audit**.

Designing a CLI for agents is not the same as designing one for humans. Five axes capture the entire problem: **discoverability, output discipline, failure modes, side-effect honesty, and composability**. The single deepest reframe — beyond "add a `--json` flag" — is that the goal is to **minimize the number of turns** the agent needs to complete a user task. Receipts, recovery hints, plan-then-execute, and schema introspection all serve that goal.

A tool that returns perfect JSON but forces 7 calls to do one user task is worse than a tool that takes 1 call and returns slightly noisier JSON.

## Why CLI tools matter for agents (in 2026)

| | CLI | MCP |
|---|---|---|
| Token cost per invocation | Low | High (eager schema load: GitHub MCP ≈ 55K tokens) |
| Knowledge baked into model | Yes (years of pretraining) | No (must fit in context) |
| Composability | Native (pipes) | Server-mediated |
| Auth / per-user scopes | Inherits user session | First-class |
| Auditability | Manual | First-class |
| Sandboxability | OS primitives | Server-side |

CLIs win on cost and prior knowledge. MCP wins on auth, audit, stateful sessions, and tools the model has never seen. Most product teams ship a CLI first and add MCP for the integration cases.

## The five axes

### 1. Discoverability

The agent should figure out what your tool does without spending turns drilling into nested help.

- **Surface the full command tree in top-level `--help`** instead of one level at a time
- **Noun-verb subcommands** (`mytool resource action`) — turns exploration into deterministic tree search
- **Schema introspection**: `mytool schema <subcommand>` → JSON Schema for inputs and outputs
- **Auto-detect agent environments** (Claude Code, Cursor, Codex, Aider, Cline, Windsurf, Copilot, Gemini CLI). Common pattern: known env vars or process tree → switch on agent mode automatically (non-interactive, structured output, no color)
- **Namespacing** when many related tools coexist: `asana_search`, `asana_projects_search` (Anthropic guidance)
- **Tool descriptions written like onboarding docs**, not API reference. Include example invocations, edge cases, and explicit boundaries vs adjacent tools. Use unambiguous parameter names: `user_id` not `user`

### 2. Output discipline

Output is the agent's input; treat every byte as a budget item.

- **`--json` (or `-o json`) on every command**. Structured output to **stdout**, human progress and warnings to **stderr**
- **Streamable NDJSON** for large result sets — the agent processes page by page rather than buffering a 200KB blob
- **Pagination, range selection, filtering, truncation** by default. Claude Code caps tool responses at 25,000 tokens; assume your output will be truncated and design for it
- **Field projection**: `--json id,title,state` so the agent only pays for fields it asked for. The GitHub CLI's combined `--json fields --jq '...'` (with an internal jq library, no system dep) is a strong reference
- **Concise vs detailed modes**. Default to concise (omit IDs not needed for follow-up actions); make detailed available when chaining
- **Prefer human-readable identifiers over UUIDs/MIME types/256px URLs**. Anthropic reports that resolving UUIDs to semantic identifiers significantly reduces hallucinations in retrieval tasks
- **Honor `NO_COLOR`**, support `--color=always|never|auto`, detect TTY on stdout *and* stderr separately. Never bake ANSI escapes into JSON
- **Versioned output schema**. Include `{"v": 1, ...}` and treat it as an API contract — breaking it wedges every agent in production

### 3. Failure modes

When the call fails, the agent should recover in zero or one extra turn.

- **Distinct, semantic exit codes**, not just 0/1. Common scheme: 0 success, 1 generic error, 2 misuse, 5 conflict/already-exists, 64–113 application-specific, 126/127 not-found/not-executable. Document them
- **Errors carry the fix**. Don't return "missing flag --foo"; return "missing --foo; valid values: A, B, C; example: `mytool x --foo A`"
- **Classify transient vs permanent**. Network blip → retry signal; auth failure → re-auth signal. Either via exit code or an explicit `"retryable": true` field
- **Idempotency keys** so retries don't double-fire. If you can't make a command idempotent, make the conflict detectable with a distinct exit code
- **Graceful SIGTERM**: agents kill long-running tools. Persist state cleanly so the next call can resume

### 4. Side-effect honesty

The agent must reason about what will happen and how to undo it.

- **Default read-only**. Make destructive intent explicit at the *flag* level (`--write`, `--apply`, `--delete`), not just at a runtime prompt
- **`--dry-run` returns structured plans**, not prose. A JSON diff is the artifact policy engines and reviewers act on
- **Receipts** for mutating commands: structured response with what changed, where, scope, and an `undo_command` field — so the agent has the undo before it knows it needs it
- **`--non-interactive` / `--yes` / `--no-prompt`** to bypass everything that reads from stdin. These should be obvious in `--help`
- **Plan-then-execute** for high-leverage operations (PRs, file edits, deploys, external APIs). Emit the plan, let policy hooks gate, execute against the same plan id
- **Confirmations are not your safety boundary**. Agents say yes to make progress; humans rubber-stamp at 3am. Real safety is OS sandbox + scoped credentials + workspace-only writes by default

### 5. Composability

Fit the existing Unix grammar and the agent's existing knowledge.

- **Pipes work**: read stdin, write stdout, errors to stderr
- **One job, one tool**. Don't roll up — let the agent compose
- **Reuse known names**: `-o json`, `-q/--quiet`, `-v/--verbose`, `-f/--file`, `--no-color`. Don't invent your own dialect
- **Borrow LLM priors**: imitate the surface of `git`, `gh`, `kubectl`, `docker`, `jq`, `rg`, `fd`. The model has seen billions of examples and will guess correctly

## Reducing turns: the unifying principle

Most other rules collapse into this. Each turn costs latency and tokens.

| Pattern | Turns saved |
|---|---|
| Full command tree in top-level `--help` | Avoids drill-in turns to find subcommand |
| Errors include the fix | Avoids "what went wrong → fix it" turn |
| Mutations return `undo_command` | Avoids "how do I undo this?" turn |
| Success returns "next actions" hints | Avoids exploration turn |
| Schema introspection | Avoids trial-and-error parameter turns |
| Plan-then-execute | One review surface instead of N validation calls |
| Idempotency keys | Avoids "did the previous call succeed?" turn |
| Field projection on output | Avoids re-fetching with a different filter |

## Anti-patterns

1. **1:1 API → tool wrapping**. More tools ≠ better. Design for the agent's unit of work, not the API's resource model
2. **Raw UUIDs / MIME types / file URLs in responses** when names and file types are what the agent will reason over
3. **Mid-stream interactive prompts** with no escape hatch — agents have no TTY
4. **ANSI escape codes in machine output** — silently poisons JSON parsing
5. **Free-form prose errors** with no recovery path
6. **Mixed stdout** (structured + human progress) — break either pipes or readability, often both
7. **Binary 0/1 exit codes** — agents need to branch on cause
8. **Unversioned output schema** — every breaking change wedges every consumer
9. **Confirmation prompts as the safety boundary** — agents accept everything to make progress
10. **Eagerly loading 50K tokens of tool schema upfront** when only one tool will be used. Favor on-demand discovery (Anthropic's Tool Search Tool, lazy MCP listing)
11. **Wrapping a known-to-LLM tool in an MCP server** — you pay context tax for no benefit; let the agent shell out

## Practical evaluation methodology (Anthropic-style)

1. Stand up a prototype and test it locally end-to-end
2. Build a comprehensive eval against real-world tasks the agent should solve
3. Run the eval and track:
   - Total runtime per call and per task
   - Total number of tool calls
   - Total token consumption
   - Tool-error rate (and which errors recur)
4. Read **raw transcripts**, not summaries — many failures only show up there
5. Use Claude (or another agent) to refine tool descriptions iteratively. The article's punchline: writing tools for agents — using agents

Lots of "invalid parameter" errors → descriptions need work. Lots of follow-up turns to interpret output → the response shape is wrong. Lots of giving up partway through → you're hitting the context window.

## Putting it together: a minimum viable agent-friendly CLI

A tool that ticks every box would have:

- Noun-verb subcommands, full tree visible in top-level `--help`
- `tool schema <subcommand>` returning JSON Schema
- `--json` and `--ndjson` on every read; structured output to stdout, human messages to stderr
- Field projection on outputs; concise default, `--detailed` available
- Stable, versioned output schema (`"v": 1`)
- Honors `NO_COLOR`, supports `--color`, no ANSI in machine output
- Distinct, documented, semantic exit codes
- Errors include valid values, examples, and a transient/permanent flag
- Default read-only; explicit `--write`/`--delete` flags
- `--dry-run` returns a structured JSON plan
- Mutations return a receipt with `undo_command`
- `--non-interactive` / `--yes` to bypass any prompts
- Idempotency keys accepted for write operations
- Auto-detects agent environments and switches non-interactive defaults
- Tool descriptions written like onboarding docs, with examples and boundaries
- For a related family of tools, namespace with shared prefix

That's the contract. Most of the rest is ergonomics.

## When to add MCP on top

Add MCP, alongside not instead of, when:

- The tool needs **per-user, scoped auth** (and you don't want the agent to handle tokens)
- You need **first-class audit** of every invocation across users/tenants
- The integration is **stateful** beyond what a single CLI invocation can hold
- The tool has **no CLI form** and you want one interface for many clients

Otherwise the CLI is enough, and adding MCP just costs context.

## Sources

Vendor / foundational:
- [Anthropic — Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic — Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Anthropic — Advanced tool use (Tool Search Tool, Programmatic Tool Calling)](https://www.anthropic.com/engineering/advanced-tool-use)
- [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- [Claude API — Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)
- [OpenAI — Codex CLI](https://developers.openai.com/codex/cli)
- [OpenAI — Codex Agent Skills](https://developers.openai.com/codex/skills)

Community / practitioner writing:
- [Mei Park — Rewrite your CLI for agents (or get replaced)](https://www.theundercurrent.dev/p/rewrite-your-cli-for-agents-or-get)
- [keyboardsdown — Agent-first CLIs are about reducing turns, not JSON](https://keyboardsdown.com/posts/01-agent-first-clis/)
- [InfoQ — Keep the terminal relevant: patterns for AI agent driven CLIs](https://www.infoq.com/articles/ai-agent-cli/)
- [Slava Kurilyak — Agent-friendly CLI tools: from flaky agents to reliable automation](https://slavakurilyak.com/posts/agent-friendly-cli-tools/)
- [ikangai — The shell is a better LLM endpoint than your protocol](https://www.ikangai.com/the-shell-is-a-better-llm-endpoint-than-your-protocol/)
- [openstatus — Building a CLI that works for humans and machines](https://www.openstatus.dev/blog/building-cli-for-human-and-agents)
- [Speakeasy — Making your CLI agent-friendly](https://www.speakeasy.com/blog/engineering-agent-friendly-cli)
- [Propel — Agent-first CLI design: make coding agents reviewable](https://www.propelcode.ai/blog/agent-first-cli-design-coding-agents)
- [Block engineering — 3 principles for designing agent skills](https://engineering.block.xyz/blog/3-principles-for-designing-agent-skills)
- [agentic-patterns.com — CLI-first skill design](https://www.agentic-patterns.com/patterns/cli-first-skill-design/)
- [Dev.to — Writing CLI tools that AI agents actually want to use](https://dev.to/uenyioha/writing-cli-tools-that-ai-agents-actually-want-to-use-39no)
- [Simon Willison — LLM 0.26: Large language models can run tools in your terminal](https://simonwillison.net/2025/May/27/llm-tools/)
- [12-Factor Agents (Dex Horthy / HumanLayer)](https://github.com/humanlayer/12-factor-agents)

CLI design foundations:
- [Command Line Interface Guidelines (clig.dev)](https://clig.dev/)
- [NO_COLOR standard](https://no-color.org/)
- [Heroku CLI Style Guide](https://devcenter.heroku.com/articles/cli-style-guide)

MCP vs CLI tradeoffs:
- [Jannik Reinhard — CLI tools vs MCP: better AI agents with less context](https://jannikreinhard.com/2026/02/22/why-cli-tools-are-beating-mcp-for-ai-agents/)
- [Firecrawl — MCP vs CLI for AI agents in 2026](https://www.firecrawl.dev/blog/mcp-vs-cli)
- [Scalekit — MCP vs CLI: benchmarking AI agent cost & reliability](https://www.scalekit.com/blog/mcp-vs-cli-use)
- [CircleCI — MCP vs CLI for AI-native development](https://circleci.com/blog/mcp-vs-cli/)

## Related research in this repo

- `claude-managed-agents/` — how to deploy agents on Anthropic infra (the layer above tool design)
- `agentic-self-improvement/` — evolving prompts/memory across runs (the meta-layer over evals)

This thread fills the gap between those two: how the *tools* the agent calls should be shaped.

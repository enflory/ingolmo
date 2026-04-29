# Claude Managed Agents research notes

Started: 2026-04-29

## Repo orientation

- Cloned `enflory/ingolmo` into the workspace after verifying `https://github.com/enflory/ingolmo.git` exists.
- Read `AGENTS.md`. Convention is one top-level kebab-case directory per research thread, with a continuously updated `notes.md` and final `README.md`.
- Existing related threads are mostly about OpenAI Realtime and README automation; no prior Claude Managed Agents thread found.

## Initial source pass

Starting point: <https://platform.claude.com/docs/en/managed-agents/overview>

Key first impressions:

- Claude Managed Agents is a beta API surface for running autonomous Claude sessions in Anthropic-managed infrastructure, not merely a prompt pattern.
- Core resources are `agent`, `environment`, `session`, and `events`.
- It is aimed at long-running, asynchronous work where the developer does not want to own the full agent loop, sandbox, tool execution layer, prompt caching, or compaction.
- All managed-agents endpoints require the `managed-agents-2026-04-01` beta header. Research-preview features additionally require `managed-agents-2026-04-01-research-preview`.
- Supported default tools include bash, file read/write/edit, glob, grep, web fetch, web search, plus MCP/custom tools depending on configuration.

## Deeper doc pass

Pages read:

- Overview: <https://platform.claude.com/docs/en/managed-agents/overview>
- Quickstart: <https://platform.claude.com/docs/en/managed-agents/quickstart>
- Agent setup: <https://platform.claude.com/docs/en/managed-agents/agent-setup>
- Environments: <https://platform.claude.com/docs/en/managed-agents/environments>
- Sessions: <https://platform.claude.com/docs/en/managed-agents/sessions>
- Events and streaming: <https://platform.claude.com/docs/en/managed-agents/events-and-streaming>
- Tools: <https://platform.claude.com/docs/en/managed-agents/tools>
- Files: <https://platform.claude.com/docs/en/managed-agents/files>
- Memory: <https://platform.claude.com/docs/en/managed-agents/memory>
- Vaults: <https://platform.claude.com/docs/en/managed-agents/vaults>
- Outcomes: <https://platform.claude.com/docs/en/managed-agents/define-outcomes>
- Multiagent: <https://platform.claude.com/docs/en/managed-agents/multi-agent>
- Migration: <https://platform.claude.com/docs/en/managed-agents/migration>
- Cookbook: failing test suite: <https://platform.claude.com/cookbook/managed-agents-cma-iterate-fix-failing-tests>
- Cookbook: data analyst: <https://platform.claude.com/cookbook/managed-agents-data-analyst-agent>
- Cookbook: SRE incident responder: <https://platform.claude.com/cookbook/managed-agents-sre-incident-responder>
- Cookbook: remembered user preferences: <https://platform.claude.com/cookbook/managed-agents-cma-remember-user-preferences>

Implementation-relevant findings:

- Agents are reusable and versioned; environments are reusable but not versioned; sessions are per-run and have isolated containers.
- Passing an agent ID string starts a session on the latest agent version; passing `{type, id, version}` pins the version and supports staged rollout/rollback.
- Environments can preinstall packages via apt/cargo/gem/go/npm/pip. Package installs are cached across sessions that share an environment.
- Production environments should usually use `networking: limited` with explicit HTTPS allowed hosts, plus explicit `allow_package_managers` / `allow_mcp_servers` when needed.
- The full built-in toolset is `agent_toolset_20260401`; it currently covers `bash`, `read`, `write`, `edit`, `glob`, `grep`, `web_fetch`, and `web_search`.
- Toolset config can disable individual tools or start with everything disabled and re-enable only specific tools.
- Permission policy matters. Cookbooks use `always_allow` for tutorial speed, but production integrations should gate dangerous or high-cost actions.
- Sessions start idle. Creating a session does not itself start work; a `user.message` event does.
- Stream before sending if you need to observe every event. Otherwise there is a race where early events may fire before the client starts listening.
- Exit conditions need care: `session.status_idle` can mean normal end turn or a paused run requiring action. Check `stop_reason.type`.
- Custom tools are not executed by Anthropic. The agent emits `agent.custom_tool_use`; the client runs the tool and replies with `user.custom_tool_result`.
- Files are uploaded via Files API and mounted as session `resources`. Mounted files are read-only; outputs must be written to `/mnt/session/outputs/` if the client should retrieve them later.
- Memory stores are research preview. They mount under `/mnt/memory/`, use normal file tools, can be read-only or read-write, and create immutable versions for audit/rollback. Prompt-injection risk is real for read-write stores.
- Vaults are for per-user MCP credentials. They are referenced at session creation, credentials are workspace-scoped, secret fields are write-only, and archived credentials purge secrets while retaining audit metadata.
- Multiagent is research preview. A coordinator can call configured `callable_agents`; each called agent has isolated context but shares the same container/filesystem. Only one delegation level is supported.
- Outcomes are research preview. They define a rubric, provision a grader in a separate context, and feed rubric gaps back to the agent for iteration.
- Migration from Messages API removes most hand-written loop responsibilities: server-side history, built-in tool execution, managed sandbox, and idle/status signaling.
- Migration from Claude Agent SDK is mostly moving runtime from your process to Anthropic infra; custom tools still run in your client process, but are driven via session events.

Working product interpretation:

- Treat Managed Agents as an async job runtime for high-variance work, not as a replacement for every low-latency chat interaction.
- The product control plane should store agent IDs/versions, environment IDs, session IDs, mounted resources, vault IDs, and any app-level task metadata.
- A robust first integration should include: create/reuse agent, create/reuse environment, upload/mount files, create session pinned to agent version, open stream, send task, persist events or summaries, handle custom tool requests, stop on the correct idle reason, retrieve outputs, archive resources intentionally.
- For user-facing products, expose progress through the event stream: messages, tool use, status, requires-action states, and terminal errors.
- For risky domains, wrap the built-in agent power in guardrails: limited networking, disabled web tools unless needed, read-only memory by default, per-user vaults, human confirmation for external writes, and independent verification.

## Final report pass

- Wrote `claude-managed-agents/README.md` as the reusable artifact.
- Included practical sections on the resource model, basic build flow, agent setup, tools, environments, sessions/events, files/outputs, memory, vaults, outcomes, multiagent, migration, architecture, guardrails, and when not to use Managed Agents.
- Did not create `_summary.md`, per repo instructions.

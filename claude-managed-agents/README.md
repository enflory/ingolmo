# Claude Managed Agents: research and build guide

Date researched: 2026-04-29

## Executive summary

[Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) is Anthropic's beta API for running Claude as an autonomous, tool-using agent in Anthropic-managed cloud infrastructure. It is best understood as an async agent runtime: you define reusable agents and environments, start stateful sessions, send user events, stream back progress, and retrieve outputs.

The main trade is clear: you give up some low-level control over the agent loop, sandbox, and built-in tool execution in exchange for managed containers, server-side session history, built-in file/bash/web tools, prompt caching, compaction, and long-running work orchestration. Use it for work that may take minutes or hours, touches files or tools, and benefits from streaming progress. Use the Messages API or Claude Agent SDK when you need full local loop control or low-latency direct prompting.

## Core model

Managed Agents revolves around four durable concepts:

| Concept | What it means | Build implication |
| --- | --- | --- |
| Agent | Reusable, versioned config: model, system prompt, tools, MCP servers, skills, metadata | Create once, update intentionally, pin versions in production |
| Environment | Reusable cloud container template: packages, runtimes, networking | Create per capability profile, log changes yourself because environments are not versioned |
| Session | A running agent instance in an environment with its own isolated container and history | Treat as an async job/run |
| Events | User input, agent messages, tool use, status, custom tool requests | Your app's integration surface is event-driven |

All Managed Agents endpoints require the `managed-agents-2026-04-01` beta header. The SDKs set it automatically. Research preview features such as [outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes), [multiagent sessions](https://platform.claude.com/docs/en/managed-agents/multi-agent), and memory require additional access/headers.

## Basic build flow

1. Create an agent with a model, system prompt, and tools.
2. Create an environment with package and network configuration.
3. Upload files or prepare resources the agent needs.
4. Create a session referencing the agent and environment.
5. Open the event stream, send a `user.message`, and process events until the session goes idle or terminates.
6. Handle custom tool calls by executing them in your app and sending `user.custom_tool_result`.
7. Download outputs from session-scoped files, especially files written under `/mnt/session/outputs/`.
8. Archive sessions, agents, and environments when they are no longer needed.

The [quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart) shows this in miniature. The [failing test suite cookbook](https://platform.claude.com/cookbook/managed-agents-cma-iterate-fix-failing-tests) is the best practical first read because it demonstrates the full loop: agent, environment, files, session, stream, verification, cleanup.

## Agent setup

An [agent](https://platform.claude.com/docs/en/managed-agents/agent-setup) is reusable and versioned. Important fields:

- `name`: human-readable name.
- `model`: any Claude 4.5+ model listed for Managed Agents. Docs examples use `claude-opus-4-7` and `claude-sonnet-4-6`.
- `system`: the persistent behavior/persona/instructions. Put durable operating rules here, not one-off work requests.
- `tools`: built-in toolset, custom tools, and tool config.
- `mcp_servers`: remote MCP servers.
- `skills`: domain-specific context with progressive disclosure.
- `callable_agents`: research preview multiagent orchestration.
- `metadata`: your tracking data.

Agents are versioned. Updating an agent increments `version`; omitted scalar fields are preserved, array fields are replaced, and metadata merges by key. In production, prefer session creation with an explicit version:

```python
session = client.beta.sessions.create(
    agent={"type": "agent", "id": agent.id, "version": agent.version},
    environment_id=environment.id,
)
```

That gives you staged rollout and rollback instead of "whatever latest means at runtime."

## Tooling

The built-in toolset is `agent_toolset_20260401`. The [tools docs](https://platform.claude.com/docs/en/managed-agents/tools) list the current tools:

- `bash`: run shell commands.
- `read`, `write`, `edit`: file operations.
- `glob`, `grep`: file discovery and search.
- `web_fetch`, `web_search`: web access.

You can enable the full toolset, disable individual tools, or start disabled and explicitly enable only what a task needs. Cookbooks use `permission_policy: {"type": "always_allow"}` for tutorial speed, but production should be more careful. Treat tool permissions as part of the product's security model.

Custom tools are different from built-in tools. Claude emits an `agent.custom_tool_use` event with the tool name and input. Your application runs the tool, then sends `user.custom_tool_result`. This is how you keep sensitive business actions in your own code while still letting the managed session decide when a tool is needed.

## Environments

[Environments](https://platform.claude.com/docs/en/managed-agents/environments) are cloud container templates. Each session gets its own isolated container instance, but multiple sessions can share one environment definition.

Key configuration points:

- `packages`: preinstall dependencies through apt, cargo, gem, go, npm, or pip. Package setup is cached across sessions that share the environment.
- `networking.unrestricted`: full outbound access except safety blocks. Useful for prototypes.
- `networking.limited`: explicit `allowed_hosts`, with separate booleans for package managers and MCP servers.

Production default: use `limited` networking and grant only the domains the agent truly needs. The data analyst cookbook uses unrestricted networking because Plotly is loaded from a CDN, but it explicitly notes that production should prefer a host allowlist.

Environments are not versioned. If you change them often, track environment config and IDs in your own database or deployment metadata.

## Sessions and events

A [session](https://platform.claude.com/docs/en/managed-agents/sessions) is the running unit of work. Creating a session provisions the environment and starts in `idle`; it does not begin work until you send an event.

Core statuses:

- `idle`: waiting for user input or tool confirmation.
- `running`: actively executing.
- `rescheduling`: transient error, retrying automatically.
- `terminated`: unrecoverable error.

The [events docs](https://platform.claude.com/docs/en/managed-agents/events-and-streaming) are the integration heart. User events go in; agent, session, and span events come out. Every event has a server-side `processed_at`; null means queued.

Important stream pattern:

```python
with client.beta.sessions.events.stream(session.id) as stream:
    client.beta.sessions.events.send(
        session.id,
        events=[
            {
                "type": "user.message",
                "content": [{"type": "text", "text": task}],
            }
        ],
    )

    for event in stream:
        if event.type == "agent.message":
            ...
        elif event.type == "agent.tool_use":
            ...
        elif event.type == "agent.custom_tool_use":
            result = call_tool(event.name, event.input)
            client.beta.sessions.events.send(
                session.id,
                events=[
                    {
                        "type": "user.custom_tool_result",
                        "custom_tool_use_id": event.id,
                        "content": [{"type": "text", "text": result}],
                    }
                ],
            )
        elif event.type == "session.status_idle":
            if event.stop_reason and event.stop_reason.type == "end_turn":
                break
            if event.stop_reason and event.stop_reason.type == "requires_action":
                ...
        elif event.type == "session.status_terminated":
            raise RuntimeError("Managed Agent session terminated")
```

Open the stream before sending if you need a complete trace. The cookbook calls out a race where early events can be missed if you send first.

## Files and outputs

The [files docs](https://platform.claude.com/docs/en/managed-agents/files) cover uploading files through the Files API and mounting them as session resources. Mounted files are read-only copies, and paths should be absolute. A session supports up to 100 mounted files.

For editable workflows, tell the agent to copy inputs into a writable location such as `/mnt/user` or `/tmp`. For retrievable artifacts, write outputs to `/mnt/session/outputs/`. Files written there are persisted and can be listed/downloaded with the Files API using `scope_id=<session_id>`.

This is important enough to put in task prompts. Example:

```text
Copy the mounted files into /mnt/user before editing. When done, write the final artifact to /mnt/session/outputs/report.html.
```

## Memory

[Agent memory](https://platform.claude.com/docs/en/managed-agents/memory) is research preview. A memory store is a workspace-scoped collection of text documents mounted under `/mnt/memory/` during a session. The agent uses ordinary file tools to read and write it, and writes are persisted across sessions. Every memory mutation creates an immutable version for audit and rollback.

Design guidance:

- Use read-only stores for reference material, policy, domain knowledge, and shared project context.
- Use read-write stores sparingly for per-user or per-project learnings.
- Split memories into small focused files; individual memories are capped at 100KB.
- Be cautious with read-write memory when the agent processes untrusted input. A prompt injection that writes bad memory can poison later sessions.
- A session can attach up to 8 memory stores.

Memory is a strong fit for products where users repeatedly ask an agent to work in the same domain, but it needs review/management UX if user trust or compliance matters.

## Vaults and MCP authentication

[Vaults](https://platform.claude.com/docs/en/managed-agents/vaults) let you register per-user credentials for third-party MCP servers and reference the vault at session creation. This keeps product-level agent config separate from user-specific authorization.

Important details:

- Vaults and credentials are workspace-scoped. Anyone with API key access may use them.
- A credential binds to one `mcp_server_url`.
- Secret fields are write-only and not returned by the API.
- Credentials are not validated until session runtime.
- Rotations/archives can propagate to running sessions because credentials are periodically re-resolved.
- Archive if you need an audit trail; delete for hard removal.

For a SaaS app, model this as: one shared agent, one or more shared environments, one vault per end-user or external account context, and sessions created with the relevant `vault_ids`.

## Outcomes and multiagent

[Outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes) are research preview. You provide a rubric for "done"; the harness provisions a grader in a separate context, evaluates the artifact, and feeds gaps back to the agent. This is useful for tasks with concrete quality criteria, such as financial models, code migrations, or report generation.

[Multiagent sessions](https://platform.claude.com/docs/en/managed-agents/multi-agent) are also research preview. A coordinator agent can invoke configured `callable_agents`. Called agents have their own isolated contexts and event threads, but share the same container and filesystem. Only one level of delegation is supported.

Use multiagent when work decomposes cleanly:

- Coordinator plus reviewer.
- Implementer plus test writer.
- Researcher plus synthesis agent.
- Incident responder plus runbook/log specialist.

Avoid it when tasks are tightly coupled or when a single agent with a better prompt and tools is sufficient.

## Migration notes

The [migration guide](https://platform.claude.com/docs/en/managed-agents/migration) is useful because it clarifies product boundaries.

From a hand-written Messages API loop, you stop managing:

- Conversation history on every request.
- Built-in tool execution and `tool_result` loopback.
- Your own sandbox for generated code.
- Deciding when the loop is finished.

You still control:

- Agent prompt and model.
- Custom tool definitions and execution.
- App context through prompt, files, resources, and skills.
- UX around progress, approvals, errors, retries, and outputs.

From Claude Agent SDK, the biggest shift is runtime location. SDK agents run in a process you operate; Managed Agents run in Anthropic infrastructure. Local paths become uploaded/mounted files, `CLAUDE.md`-style hierarchy becomes a single agent `system` string, MCP auth moves to vaults, and hooks become event-loop logic or tool permission policies.

## Product architecture sketch

A production integration should usually have:

- `agents` table: Anthropic agent ID, version, name, model, prompt hash, created/updated metadata.
- `environments` table: environment ID, config JSON, package/network profile, app version that created it.
- `agent_runs` table: session ID, agent version, environment ID, user/task IDs, status, timestamps, trace URL, output file IDs.
- `session_events` or event summaries: enough to audit progress, debug failures, and render user-facing status.
- `vault_mappings`: user/account ID to vault IDs, credential scopes, archived state.
- `file_resources`: uploaded file IDs, mount paths, resource IDs, output file IDs.

Event worker responsibilities:

1. Create the session with pinned agent version, environment, resources, memory stores, and vaults.
2. Open stream and send task event.
3. Persist progress events and surface user-facing status.
4. Execute custom tools and send results.
5. Pause for human confirmation when required.
6. Detect `end_turn`, `requires_action`, and `terminated`.
7. Retrieve outputs.
8. Archive or retain resources according to policy.

## Guardrails checklist

- Pin agent versions for production sessions.
- Prefer `networking: limited`.
- Disable web tools unless the task requires them.
- Use read-only memory for shared/reference context.
- Keep read-write memory per user/project and reviewable.
- Treat mounted input files as read-only; require outputs under `/mnt/session/outputs/`.
- Require human approval for external writes, deploys, messages, payments, destructive operations, and secrets access.
- Log every custom tool call and result.
- Independently verify important outputs. The failing-test cookbook explicitly re-runs assertions after the agent claims success.
- Archive sessions/environments/agents when done, but preserve records needed for audit.

## When not to use Managed Agents

Avoid Managed Agents when:

- The task is low-latency chat or a single model response.
- You need complete control over every loop step.
- You need the agent to operate directly on a local filesystem without upload/mount semantics.
- You cannot send task data into Anthropic-managed infrastructure.
- You need deterministic, short, schema-bound responses rather than open-ended tool work.

Use Managed Agents when:

- The task is long-running, file-heavy, or operational.
- You want an autonomous loop with built-in tool execution.
- You can expose progress asynchronously.
- You need cloud sandboxing and session persistence without building your own runtime.

## Open questions to validate before production

- Exact pricing behavior for long-running sessions and tool-heavy tasks.
- Practical limits beyond the documented rate limits, especially concurrent sessions and output file sizes.
- How strict built-in tool permission policies are in real event flows.
- Operational durability of SSE streams under network interruptions.
- Best approach for replaying or resuming streams in workers.
- How research-preview memory/outcomes/multiagent APIs change before GA.

## Sources

- [Claude Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview)
- [Quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart)
- [Agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup)
- [Environments](https://platform.claude.com/docs/en/managed-agents/environments)
- [Sessions](https://platform.claude.com/docs/en/managed-agents/sessions)
- [Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming)
- [Tools](https://platform.claude.com/docs/en/managed-agents/tools)
- [Files](https://platform.claude.com/docs/en/managed-agents/files)
- [Memory](https://platform.claude.com/docs/en/managed-agents/memory)
- [Vaults](https://platform.claude.com/docs/en/managed-agents/vaults)
- [Outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes)
- [Multiagent](https://platform.claude.com/docs/en/managed-agents/multi-agent)
- [Migration](https://platform.claude.com/docs/en/managed-agents/migration)
- [Cookbook: iterate on failing tests](https://platform.claude.com/cookbook/managed-agents-cma-iterate-fix-failing-tests)
- [Cookbook: data analyst agent](https://platform.claude.com/cookbook/managed-agents-data-analyst-agent)
- [Cookbook: SRE incident responder](https://platform.claude.com/cookbook/managed-agents-sre-incident-responder)
- [Cookbook: agents that remember users](https://platform.claude.com/cookbook/managed-agents-cma-remember-user-preferences)


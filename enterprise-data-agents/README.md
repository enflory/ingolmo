# Building agentic systems on top of enterprise data

*Researched May 2026. Anchored in two primary sources — OpenAI's "Inside our in-house data agent" (Jan 2026) and Ramp's "Meet Ramp Research" (Sept 2025) — triangulated against vendor work (Snowflake Cortex, Databricks Genie, dbt MCP), academic SOTA (BIRD, Spider 2.0, ReFoRCE), and adjacent prior threads in this repo.*

## TL;DR

By 2026, two independent shops at very different scales — OpenAI (3,500 internal users / 600 PB / 70k tables) and Ramp (~300 users / single Snowflake warehouse) — converged on the same architecture for an internal data-question agent. Both replaced a `#help-data` Slack queue with an always-on agent that answers in minutes instead of hours. Both report transformative cultural effects: Ramp documented a 10–20× increase in the *number* of questions asked, with the bulk coming from "questions that previously died in drafts."

The convergent architecture has four moving parts:

1. **A multi-layer context store** stitched from schema metadata, query history, hand-written domain docs, code-derived semantics, institutional knowledge (Slack/Docs/Notion), and learned memories from past corrections. This is the real product. The agent is downstream.
2. **A closed-loop reasoning agent** that inspects intermediate results, branches, backtracks, and self-corrects on execution feedback. It does not answer one-shot.
3. **An evaluation harness that asserts on intermediate steps**, not just final answers — golden SQL pairs plus expected tool calls, table references, and query shape. Run continuously as canaries.
4. **Pass-through security** that inherits the warehouse's existing access controls; the agent never widens permissions.

The model itself is the least differentiated piece. OpenAI runs GPT-5.2; Ramp doesn't disclose, but their architecture works regardless. The investment is in the *context layer*, the *eval suite*, and the *interface* (Slack thread state with in-line CSV previews and visible reasoning) — not prompt engineering. That fits the broader 2026 industry framing of "context engineering" (Atlan, Contextual AI, dbt) and matches the convergent thesis from this repo's prior thread on AI-BI ([`../ai-bi-json-render-pattern/`](../ai-bi-json-render-pattern/README.md)): governed primitives upstream, LLM as a composer over them.

If you build one of these, the playbook is in §7. The single-paragraph version: **invest 80% of the engineering effort in the context layer (especially code-derived enrichment and intermediate-step evals) and let modern frontier models do the reasoning over it.**

---

## How to read this report

§1–2 are the two case studies in detail. §3 is the architecture they converge on. §4 is the context layer (the central idea). §5 is the agent loop. §6 is evals. §7 is the build playbook. §8 is the vendor and OSS landscape. §9 is failure modes. §10 is what's still open. §11 is sources. The full investigation log is in [`notes.md`](./notes.md).

---

## 1. Case study: OpenAI's in-house data agent

> "Our agent lets employees go from question to insight in minutes, not days."
> — Bonnie Xu, Aravind Suresh, Emma Tang. [Inside OpenAI's in-house data agent](https://openai.com/index/inside-our-in-house-data-agent/), Jan 29 2026.

### Scale and motivation

OpenAI operates a data platform serving 3,500 internal users across Engineering, Product, and Research over 600 PB of data and 70k datasets. Two pain points motivated the build:

1. **Tables that look similar but differ subtly.** A quote from an internal user: "We have a lot of tables that are fairly similar… some include logged-out users, some don't. Some have overlapping fields; it's hard to tell what is what." Naïve text-to-SQL over a sea of similarly named tables produces confidently wrong answers.
2. **Silent SQL failure modes.** Many-to-many joins, filter pushdown errors, unhandled nulls. A 180-line SQL for a business question is not unusual. Analysts were spending most of their time debugging SQL semantics rather than defining metrics, validating assumptions, and making decisions.

### Architecture

The agent is powered by GPT-5.2 and built atop OpenAI's external products: Codex, Evals API, Embeddings API. It exposes itself through every channel where employees already work: a web UI, Slack agent, IDE via Codex CLI + MCP, and the internal ChatGPT app via an MCP connector.

```
                    ┌─── INTERNAL DATA KNOWLEDGE BASE ───┐
                    │   (Pre-processed offline, RAG)     │
                    └────────────────┬───────────────────┘
                                     │
                    ┌─── COMPANY CONTEXT ──┐
                    │   Slack / Docs /     │
                    │   Notion             │
                    └──────────┬───────────┘
                               │
  ┌───────────────┐            ▼            ┌────────────────┐
  │ AGENT-UI      │──┐                      │                │
  │ Slack agent   │──┼──▶ AGENT-API ◀──────▶│ MODEL: GPT-5.2 │
  │ Local MCP     │──┤   (Agent-MCP)        │                │
  │ Remote MCP    │──┘                      └────────────────┘
  └───────────────┘            │
                               │ (online sync)
                               ▼
              ┌────────────────────────────────┐
              │ Data Warehouse + Spark +       │
              │ Airflow + Metadata Service     │
              └────────────────────────────────┘
```

Critical detail: a daily offline pipeline aggregates the context layer, embeds it via the OpenAI Embeddings API, and stores it for hybrid retrieval at query time (semantic search + exact text retrieval). Live warehouse queries happen on-demand for fresh schema validation.

### The 6-layer context model

OpenAI's most reusable contribution is the explicit naming of six context layers, stacked from cheapest to richest:

| Layer | What it is | Source | Refresh |
|---|---|---|---|
| **1. Table Usage** | Schema metadata, lineage, inferred join patterns from historical queries | Warehouse + query log | Daily |
| **2. Human Annotations** | Domain expert intent, semantics, business meaning, caveats | Manually authored | Manual |
| **3. Codex Enrichment** | Codex crawls pipeline code to extract table purpose, exact grain, primary keys, downstream usage, freshness, when to use alternatives | Production codebase | Daily, automatic |
| **4. Institutional Knowledge** | Slack / Google Docs / Notion: launches, incidents, codenames, canonical metric definitions | Connectors with permissions | Continuous |
| **5. Memory** | Saved corrections and nuances. Global + personal scope. Agent prompts user to save learnings. | Agent + user | Per-interaction |
| **6. Runtime Context** | Live queries to warehouse / metadata service / Airflow / Spark when prior context is stale or missing | On-demand | At query time |

The single most differentiated layer is **#3, Codex Enrichment**. OpenAI's Lesson 3 — "Meaning Lives in Code" — is the punchiest sentence in the post:

> Schemas and query history describe a table's shape and usage, but its true meaning lives in the code that produces it. Pipeline logic captures assumptions, freshness guarantees, and business intent that never surface in SQL or metadata.

This is the inversion most semantic-layer products miss. They treat YAML / dbt models / LookML as the canonical source of truth. OpenAI treats the *pipeline code* — which, by construction, was the actual artifact that decided what's in the table — as a richer source. Codex extracts five things per popular table: purpose, exact grain & primary keys, downstream usage patterns, when to use alternate tables, and freshness/refresh cadence. This makes it possible to distinguish "looks similar but different" tables that schemas alone cannot.

### Closed-loop self-correction

OpenAI's framing: the agent is "built to think and work like a teammate."

- If an intermediate query returns zero rows because of a bad join, the agent diagnoses the problem, fixes the join, and retries — within the same turn, carrying learnings forward.
- It carries full conversational context across turns; users can interrupt mid-analysis to redirect.
- It asks clarifying questions when ambiguous, applies sensible defaults otherwise (e.g., "growth" → last 7 or 30 days).
- "Workflows" let teams package recurring analyses as reusable instruction sets — weekly reports, table validations.

### Evaluation discipline

OpenAI's evals are built on curated Q&A pairs, each paired with manually authored "golden" SQL. Critically, the grader does **not** rely on string matching. For each eval:

1. Send NL question to the query-generation endpoint.
2. Execute the generated SQL.
3. Compare both the generated SQL and the resulting DataFrame against the golden version. Extra columns are tolerated if the answer is semantically equivalent.
4. Grader emits a numeric score plus an explanation, capturing correctness *and* acceptable variation.

These run continuously during development as unit tests and as canaries in production. This is the same shape Snowflake describes for Cortex's [Evaluator agent](https://www.snowflake.com/en/engineering-blog/agentic-semantic-model-text-to-sql/) (column comparison + dataframe semantic comparison) and the academic ReFoRCE / Dynamic-SQL framing, suggesting this pattern has hardened into industry consensus.

### Security

> All of the agent's access is strictly pass-through, meaning users can only query tables they already have permission to access.

Three tactical points:

- The agent is an **interface layer**; it inherits the existing access-control model rather than bypassing it.
- When access is missing, the agent flags it explicitly or falls back to alternative authorized datasets.
- It exposes its reasoning and links each query result to the underlying data, so users can verify each step.

This is table stakes for an internal enterprise agent. As of 2026, vendors like Microsoft Fabric have publicly documented [edge cases where RLS isn't enforced under some Foundry access paths](https://learn.microsoft.com/en-us/answers/questions/5556598/), and Oracle has shipped a [Deep Data Security](https://blogs.oracle.com/cloud-infrastructure/google-cloud-next-2026) feature specifically for propagating end-user identity to the database at runtime — confirming that getting pass-through right is harder than it sounds at scale.

### Three lessons OpenAI calls out explicitly

1. **Less is More.** Initially exposed the full toolset to the agent. Overlapping functionality confused it. They restricted and consolidated tool calls. *(Same lesson as the [`cli-tools-for-ai-agents/`](../cli-tools-for-ai-agents/README.md) thread in this repo: minimize surface area, eliminate redundancy.)*
2. **Guide the Goal, Not the Path.** Highly prescriptive prompting degraded results. Higher-level guidance plus GPT-5's reasoning beat rigid scripts. Trust the model's planning; specify outcomes.
3. **Meaning Lives in Code.** Discussed above. The differentiated insight.

---

## 2. Case study: Ramp Research

> "Collapsing the cost of asking a question to near-zero changes who asks, when they ask, and what they ask. The result is a 10–20× increase in the number of questions people ask. Most of that growth comes from questions that previously died in drafts or never left someone's head."
> — Faiz Hilaly, Cesar Duran, Jay Sobel. [Meet Ramp Research](https://engineering.ramp.com/post/meet-ramp-research), Sept 18 2025.

Ramp's piece is the smaller, scrappier, more tactical counterpart to OpenAI's. It's also the more interesting case study because Ramp is not an AI lab — they're a corporate card company with a single Snowflake warehouse and a normal data team — and the architectural choices they made are largely the same.

### The bottleneck

Ramp's `#help-data` Slack channel was the single point of failure: every PM, designer, AE, marketer, and growth person funneled questions to one on-call analyst. Tabs sprawled across Looker, Snowflake, and dbt docs; answers landed "after the decision window has narrowed." The deeper, less-visible problem was that *most questions never got asked* — people hesitated to add to the queue.

### Scale (after ~6 weeks live)

- Launched early August 2025.
- By Sept 18 2025: **1,800 questions, 1,200 conversations, 300 distinct users.**
- 4 weeks before publication: **1,476 questions in `#ramp-research-beta` vs only 66 in `#help-data`** — the agent absorbed roughly 22× the human channel's volume.
- `#ramp-research-beta` channel: 500+ members.

### Architecture

Underlying data: Snowflake, dbt, Looker, Hex, Postgres. The agent retrieves from four sources at query time:

```
   Domain Docs ──┐
                 │
   Data Model ───┤
   Docs         ─┼──▶ Ramp Research ◀──▶ #ramp-research-beta (Slack)
                 │
   Jargon       ─┤
   Dictionary    │
                 │
   Analytics DB ─┘
```

Mapping to OpenAI's six layers:

| OpenAI layer | Ramp equivalent |
|---|---|
| Table Usage (1) | Indexed metadata from dbt, Looker, Snowflake |
| Human Annotations (2) | Domain Docs (written by domain owners) |
| Codex Enrichment (3) | *Implicit* in dbt model docs; not separately mentioned |
| Institutional Knowledge (4) | Jargon Dictionary + Domain Docs |
| Memory (5) | Multi-turn thread state; unclear if cross-thread persistence |
| Runtime Context (6) | Tools to inspect column values, branch, backtrack |

The most interesting technical claim — and the one that maps cleanly to the academic ReFoRCE pattern — is on retrieval:

> Rather than rely exclusively on generic compression methods, such as keyword or vector search, we gave the agent tools to inspect column values, branch, and backtrack — reasoning through data the way a human analyst would.

This is the inversion of the standard RAG-only design. RAG finds the right tables; agentic exploration figures out what's *in* them.

### Slack as the only interface

Ramp made Slack the deliberate single interface, and several UX choices follow from that:

- **In-thread CSV previews.** Users validate results without leaving Slack — especially helpful for non-SQL users.
- **Intermediate Steps button.** Surfaces the reasoning trace on demand without crowding the answer.
- **Multi-turn stateful threads.** Each thread keeps state. Users clarify, refine, redirect. Ramp explicitly notes: "the agent's performance also saw an end-to-end improvement as a result." Stateful threads beat stateless single-shots.
- **Per-answer SQL + Data Preview + thumbs up/down.**
- **Beyond the beta channel.** Embedded in alert channels (diagnose failed transactions) and project channels (scope new features). The agent is summoned where the conversation already happens.

### Evaluation evolution (the most actionable section)

Ramp tried three approaches; the third is the right one.

1. **Human-in-the-loop pings.** Pinged domain owners on every in-domain question. Didn't scale; just shifted the bottleneck.
2. **Per-domain end-to-end tests.** Listed high-priority concepts per domain with experts, wrote E2E tests. Exposed blind spots but didn't tell you *why* the agent passed or failed.
3. **Python mini-framework inside the dbt project.** Asserts on:
   - The final answer.
   - **Intermediate steps**: expected tool calls, table references, query shape.
   This closes the feedback loop: update context → run tests → confirm improvements.

Their summary line: **"Eval the context layer, not each question."** Combined with intermediate-step assertions, this is the most tractable enterprise-grade eval methodology I've found documented anywhere as of mid-2026.

### Cultural outcome

Ramp's "counting cards" framing is the clearest articulation I've seen of why these agents matter beyond productivity:

> A one- or two-point lift in decision quality doesn't show up in the margin, but spread across thousands of pricing tweaks, GTM filters, and feature rollouts, it becomes material. We haven't changed the stakes of any single hand, but we've raised the floor on all of them.

The 10–20× volume increase is not "the same questions, faster." It's a *different distribution* of questions — ones that used to die in drafts. This is also the throughline argument in [`../agentic-self-improvement/`](../agentic-self-improvement/README.md) §3 about why even small per-task lifts compound.

---

## 3. The convergent architecture

Cross-referencing the two cases against the rest of the 2026 literature surveyed in [`notes.md`](./notes.md), the same architecture appears in different vocabularies across OpenAI, Ramp, Snowflake Cortex Agents, Databricks Genie, Atlan's "context engineering" frame, and Contextual AI's "context layer" framing:

```
┌─────────────────────────────────────────────────────────────────────┐
│ INTERFACE                                                           │
│   Slack thread / IDE / web UI / MCP connector                       │
│   Multi-turn state, in-line previews, visible reasoning, feedback   │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│ AGENT LOOP                                                          │
│   Plan → Retrieve → Act (SQL) → Inspect intermediate → Branch /     │
│   Backtrack → Synthesize. Closed-loop self-correction on execution  │
│   feedback. Cap at N iterations.                                    │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌──────────────────┬─────────┼──────────┬──────────────────────────┐
│ TOOLS (small,    │  CONTEXT LAYER     │  EVAL HARNESS            │
│ deduped):        │  (the product)     │                          │
│  - search_tables │  - Schema +        │  - Golden Q+SQL pairs    │
│  - get_schema    │    lineage         │  - Compare SQL + DF      │
│  - run_sql       │  - Query history   │  - Assert intermediate   │
│  - read_doc      │  - Domain docs     │    steps (tool calls,    │
│  - inspect_col   │  - Code-derived    │    table refs, query     │
│  - save_memory   │    table semantics │    shape)                │
│                  │  - Slack/Docs/     │  - LLM-as-judge w/       │
│                  │    Notion          │    score + explanation   │
│                  │  - Memory (global  │  - Continuous in CI +    │
│                  │    + per-user)     │    canaries in prod      │
└──────────────────┴─────────┬──────────┴──────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│ DATA + GOVERNANCE                                                   │
│   Warehouse / lakehouse + semantic layer + RLS/CLS pass-through.    │
│   Agent inherits user identity; never widens access.                │
└─────────────────────────────────────────────────────────────────────┘
```

A few observations from the comparison:

- **Both companies use Slack as the primary entrypoint**, even with web UIs and IDE access. Slack is where the question already wants to be asked. OpenAI also surfaces in IDEs via MCP for engineers; Ramp does not.
- **Both build evaluation harnesses from golden SQL pairs**, and both compare SQL + result DataFrame rather than string-match. This pattern was independently formalized by Snowflake's Cortex agent loop and academic systems like ReFoRCE.
- **Both invest in code-as-source-of-truth.** OpenAI is explicit (Codex enrichment). Ramp is implicit (dbt model docs; the dbt project is the single source of truth for transformation logic).
- **Both built "less is more" tool surfaces.** OpenAI says it directly; Ramp's mini-framework asserts on a small set of expected tool calls — implying the surface is small enough to have *expected* tool calls per concept.
- **Neither is a fine-tuning play.** Both rely on frontier models with retrieval, scaffolding, and memory.

This converges on the design principles surfaced in [`../ai-bi-json-render-pattern/`](../ai-bi-json-render-pattern/README.md): **the LLM's role is composition over governed primitives**. There the primitives are dashboard components and metric definitions; here they are tables, semantic models, domain docs, and code-derived enrichments. Same shape, different layer.

---

## 4. The context layer is the actual product

If there's one durable insight to extract, it's this:

> Building an agent is a model + scaffolding problem. Building a *useful* enterprise data agent is a context-layer problem. The agent is downstream of the context. Most homegrown agent projects fail because they invert the priorities.

The OpenAI piece spends six of its thirteen pages on the context layer and three on the agent's behavior. The Ramp piece spends most of its discussion on "Defining the Search Space." Atlan's [Context Engineering Framework for Enterprise AI](https://atlan.com/know/context-engineering-framework/) and Contextual AI's [Semantic Layer vs Context Layer](https://contextual.ai/blog/semantic-layer-vs-context-layer) post both make this point as the headline:

> "Enterprise AI agents fail because of a trust gap, not a model gap. Semantic layers define metrics but cannot verify them at runtime."
> — Atlan, *Context Engineering Framework for Enterprise AI in 2026*

> "A semantic layer is to structured data what a context layer is to all enterprise data… 80–90% of organizational knowledge exists in unstructured formats — contracts, specifications, technical documents — that semantic layers cannot process."
> — Contextual AI, *Semantic Layer vs. Context Layer*

The semantic layer is necessary but not sufficient. dbt's own 2026 [benchmark](https://docs.getdbt.com/blog/semantic-layer-vs-text-to-sql-2026) confirms this with hard numbers: with a fully-modeled dbt Semantic Layer, GPT-5.3 Codex hits 100% accuracy on covered queries; Sonnet 4.6 hits 98.2%. Raw text-to-SQL on the same modeled data: GPT-5.3 84.1%, Sonnet 4.6 90%. The semantic layer is a deterministic guardrail for the question types it was modeled to answer. **For the long tail that wasn't pre-modeled — which is most real questions — you need the rest of the context layer.**

### The five "kinds of context" you actually need

Synthesizing the OpenAI 6-layer model, Ramp's 4-source model, and Atlan's 6-layer framework:

| Context kind | Form | Maintained by | Refresh cadence |
|---|---|---|---|
| **Schema** | Column names, types, lineage, FK relationships | DBA / data platform | Continuous (warehouse-driven) |
| **Usage** | Historical query patterns, common joins, popular tables | Query log | Daily aggregation |
| **Domain docs** | Hand-written prose: business meaning, caveats, when-to-use | Domain owners | Quarterly + on incident |
| **Code-derived semantics** | LLM-extracted purpose / grain / freshness from pipeline code | Auto (Codex / Claude) | Daily, automatic |
| **Memory** | Saved corrections, learned conventions, gate strings, alias mappings | Agent + user, scoped global / personal | Per interaction |

This list is what has to exist before a useful agent can be built. The agent itself is mostly model-default; the differentiation is here.

### "Meaning Lives in Code" — the underexploited primitive

OpenAI's Lesson 3 deserves its own subsection. Most semantic-layer products and most internal data agents treat YAML/dbt models/LookML as the canonical truth. OpenAI's claim is that the *pipeline code that materializes a table* is a richer source than the model definition, because:

- Pipeline code captures filters, aggregations, edge-case handling, and business intent that never make it into the metric definition.
- Pipeline code distinguishes "looks similar but different" tables — one excludes first-party traffic, another doesn't; one fills nulls with a specific sentinel, another rejects them.
- Pipeline code refreshes automatically when the data team ships changes; YAML docs go stale.

Practically, this means: an enterprise data agent should have a "code crawler" agent that reads dbt models, Spark notebooks, Airflow DAGs and extracts a structured per-table description (purpose / grain / PKs / downstream usage / freshness / when to use alternate tables) on a daily refresh. The OpenAI piece shows this pipeline explicitly:

```
Popular tables → Codex tasks → Per-table structured fields:
                                  - Purpose
                                  - Exact grain & primary keys
                                  - Downstream usage patterns
                                  - When to use alternate tables
                                  - Freshness / refresh cadence
```

This is the most concrete differentiator I've seen claimed in the literature, and the one I'd build first if starting fresh.

---

## 5. The agent loop

Both case studies describe an iterative, self-correcting loop. The academic SOTA (ReFoRCE on Spider 2.0, Dynamic-SQL, SQL-of-Thought) describes the same loop in formal terms. Here's the unified shape:

```
1. Understand intent
   - Parse the question. If ambiguous, ask. If not, default sensibly
     (e.g., last 30 days for "growth").

2. Plan
   - Decompose into sub-queries / CTEs.
   - Identify required tables, joins, filters.
   - Identify which context (memory, docs, schema) is relevant.

3. Retrieve context
   - Hybrid: semantic search + exact-match on the embedded context layer.
   - Pull relevant memory (global + personal).
   - Pull relevant institutional knowledge (Slack/Docs/Notion) gated by user permissions.

4. Generate SQL
   - Often as CTEs, so that intermediate results can be inspected.

5. Execute and inspect
   - Run the SQL. Inspect intermediate results.
   - Heuristic checks: zero rows, NaN explosions, dupe rows, suspicious aggregates.
   - If something looks wrong, investigate (column inspection, lineage walk).

6. Branch / backtrack
   - Adjust the plan. Rewrite the offending CTE.
   - Carry learnings forward inside the same turn.

7. Synthesize
   - Build the answer with reasoning trace + SQL + data preview.
   - Surface uncertainty explicitly. Flag missing permissions.

8. Save learnings
   - On corrections, prompt the user to save to memory (global / personal).
```

Two design choices worth highlighting:

- **CTE-level inspection.** Both Ramp ("inspect column values, branch, backtrack") and ReFoRCE explicitly verify *each CTE's* output independently. This localizes errors. Without it, a 180-line monolithic SQL is a black box.
- **Cap iterations.** Without a hard cap, the loop runs unbounded. [`../agentic-self-improvement/`](../agentic-self-improvement/README.md) §3 recommends max 3 iterations: most of the gain comes in the first revision; iterations beyond 3 multiply cost without quality. OpenAI doesn't disclose their cap; the design implication is to set one.

### Lesson 2 from OpenAI: "Guide the Goal, Not the Path"

The corollary of the loop being capable is that you should give it room to plan. OpenAI explicitly warns against highly prescriptive prompting:

> Highly prescriptive prompting degraded results. While many questions share a general analytical shape, the details vary enough that rigid instructions often pushed the agent down incorrect paths. By shifting to higher-level guidance and relying on GPT-5's reasoning to choose the appropriate execution path, the agent became more robust.

This is consistent with the broader 2026 shift away from chain-of-thought prompt engineering and toward trust-in-reasoning approaches with frontier models.

---

## 6. Evaluation: assert on intermediate steps

The single most-replicated best practice across the case studies and academic SOTA is this: **don't evaluate only the final answer.**

### What both cases do

| Component | OpenAI | Ramp |
|---|---|---|
| Golden Q+SQL pairs | ✓ Curated, manually authored | ✓ |
| SQL comparison | ✓ Logical structure | (implicit in query-shape assertion) |
| DataFrame comparison | ✓ Semantic equivalence | ✓ Final answer |
| **Intermediate-step assertions** | (not explicitly described) | ✓ Expected tool calls, table refs, query shape |
| LLM-as-judge | ✓ Score + explanation | ✓ |
| Continuous CI | ✓ Like unit tests | ✓ Closes feedback loop |
| Production canaries | ✓ | (probably; not explicit) |

Ramp's "Python mini-framework inside the dbt project" with intermediate-step assertions is the more practically useful model for a typical enterprise. It scales by **evaluating the context layer once per concept** rather than evaluating every question separately. The OpenAI eval pipeline is the more comprehensive model with explicit DataFrame comparison.

The Snowflake Cortex evaluator pipeline ([Agentic Semantic Model Improvement](https://www.snowflake.com/en/engineering-blog/agentic-semantic-model-text-to-sql/)) corroborates this with two-step validation: first compare columns, then compare data frames semantically. Same pattern.

### Why string matching fails

> Generated SQL can differ syntactically while still being correct, and result sets may include extra columns that don't materially affect the answer.
> — OpenAI

Concretely: `SELECT COUNT(*)` vs `SELECT COUNT(user_id)` over a non-null column gives the same answer. `SELECT a, b` vs `SELECT a, b, c` may both be correct if `c` is incidental. Evaluators that string-match SQL will produce false negatives at unsustainable rates.

The right evaluation pipeline:

1. Execute both golden and generated SQL.
2. Compare the resulting DataFrames *semantically* — same rows, same key columns, optional columns ignored.
3. Feed both SQL and DF deltas to an LLM-as-judge with a prompt asking for a numeric score and explanation.
4. Set a passing threshold; treat anything below as a regression.

For agents (vs single-shot text-to-SQL), additionally:

5. Assert that the agent called the *expected* tools (e.g., `get_schema('orders')` before writing SQL touching that table).
6. Assert that the agent referenced the *expected* tables.
7. Assert that the *query shape* matches (similar joins, similar filters).

This is what makes Ramp's framework "close the feedback loop": when the test fails, you know whether to fix the context (missing doc), the agent (wrong tool selection), or the prompt (bad framing).

### Why this matters: the production-success correlation

[Databricks](https://www.databricks.com/blog/enterprise-ai-agent-trends-top-use-cases-governance-evaluations-and-more) reports that organizations using systematic evaluation frameworks achieve **~6× higher production success rates** for agent deployments. This roughly matches the qualitative gap I see in the literature between teams that evaluate intermediate steps and teams that don't.

---

## 7. Build playbook

Combining the OpenAI and Ramp playbooks with prior threads in this repo, here's the recommended build order. Don't skip steps; the failure mode is bolting an agent onto an unprepared context layer.

### Phase 1 — Pre-conditions (weeks 1–4)

1. **Pick the data spine.** Snowflake / Databricks / BigQuery / Postgres. The agent has to talk to one warehouse fluently; multi-warehouse complicates everything else.
2. **Stand up a semantic layer if you don't have one.** dbt Semantic Layer + MetricFlow, Cube, AtScale, or Snowflake Semantic Views. This is the deterministic guardrail for high-stakes queries. If you don't have it, the agent will produce confidently wrong KPIs.
3. **Define a `domain_docs/` repo.** Per-domain markdown owned by domain experts. Use the AGENTS.md / SKILL.md conventions surveyed in [`../cli-agent-harness-survey/`](../cli-agent-harness-survey/README.md) and [`../ai-memory-systems/`](../ai-memory-systems/README.md). One folder per domain; jargon dictionary at the top.
4. **Enforce permissions at the warehouse layer.** RLS / CLS via the warehouse's native primitives. The agent never widens access; it inherits identity.

### Phase 2 — Context layer (weeks 4–8)

5. **Extract Layer 1 (Table Usage).** Aggregate query log, schema metadata, and lineage into a normalized representation. Daily batch is fine.
6. **Aggregate Layer 2 (Human Annotations).** Pull dbt model docs + your `domain_docs/` into the same store.
7. **Build Layer 3 (Code-derived).** This is the differentiated step. A daily Codex/Claude job that crawls your dbt project, Spark notebooks, and Airflow DAGs, and extracts per-table: *purpose / exact grain / primary keys / downstream usage patterns / when to use alternate tables / freshness*. Store as structured JSON, not prose. Refresh nightly.
8. **Wire Layer 4 (Institutional Knowledge).** Slack + Docs + Notion connectors with permission inheritance and caching. Use a retrieval service that enforces ACLs at query time, not at indexing time.
9. **Embed and index.** Embed the union of layers 1–4 into a vector index. Hybrid retrieval: semantic + exact-match. Store as your "knowledge base."
10. **Set up Layer 6 (Runtime tools).** Tool surface: `search_tables`, `get_schema`, `lineage_walk`, `inspect_column_values`, `run_sql`, `read_doc`. Resist adding more. Lesson 1: Less is More.

### Phase 3 — Agent + interface (weeks 8–12)

11. **Pick the runtime.** Options: Anthropic [Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) (lowest infra), [LangGraph](https://langchain-ai.github.io/langgraph/) (most flexibility), Cursor / Codex CLI / Cline as a wrapper. See [`../claude-managed-agents/`](../claude-managed-agents/README.md) for the Managed Agents detail.
12. **Wire MCP.** Expose your tool surface and your knowledge base as MCP servers. This makes the agent reachable from any MCP client (Claude Code, Codex CLI, Cursor, internal ChatGPT app).
13. **Build the Slack interface.** Channel-scoped, multi-turn stateful threads, in-line CSV preview, expandable reasoning, thumbs up/down feedback, "save to memory" affordance.
14. **Add memory (Layer 5).** Use Mem0 or the Anthropic memory tool (file-system semantic memory at `/mnt/memory/`) — see [`../standalone-memory-tools-survey-2026/`](../standalone-memory-tools-survey-2026/README.md). Scope to global and per-user. Prompt the user when learnings should be saved.
15. **Implement closed-loop self-correction.** Agent inspects intermediate CTE results, branches on suspicious results (zero rows, NaN explosions). Cap iterations at 3.

### Phase 4 — Evals (weeks 10–14, overlapping)

16. **Author golden Q+SQL pairs.** Aim for 50–100 covering core concepts per domain. Domain owners write them.
17. **Build the comparison harness.** Execute both golden and generated SQL → semantic DF comparison → LLM-as-judge with score + explanation.
18. **Add intermediate-step assertions.** For each concept, declare expected tool calls, table references, and query shape. Failures localize the bug to context, agent, or prompt.
19. **Run continuously.** CI on every context-layer change; canaries in production sampling 1% of queries.

### Phase 5 — Workflows + adoption (week 12+)

20. **Package recurring analyses as workflows.** Weekly business reviews, table-validation runs, customer case studies, fraud-pattern checks. Encode the context once.
21. **Embed where the conversation happens.** Slack alert channels (diagnose failures), project channels (scope features), IDE (engineering analysis). Avoid forcing users into a separate UI.
22. **Track the cultural metric, not the productivity metric.** *Total questions asked per week* is a better signal than *time saved per question*. Per Ramp, the floor effect dominates.

---

## 8. Vendor + OSS landscape (mid-2026)

The convergent architecture is now reflected in productized form across most major vendors. Comprehensive comparison:

| Tool | Shape | Strength | Weakness | Fit |
|---|---|---|---|---|
| **Snowflake Cortex Analyst + Cortex Agents** | Semantic-view-grounded text-to-SQL with multi-step reasoning | 90%+ on real-world BI; tight Snowflake integration; April 2026 update generates SQL directly in agent (was: delegated) | Snowflake-only | Snowflake shops with semantic views |
| **Databricks AI/BI Genie + Genie Code** | Multi-step "deep research" with hypothesis testing, parallel queries, streaming traces. PDF report export. | Single-agent architecture (post-Apr 2026) for tighter instruction following | Databricks-only | Databricks shops |
| **dbt MCP server** | Exposes dbt CLI + Discovery API + Semantic Layer over MCP | Near-100% accuracy on covered semantic-layer queries (dbt's 2026 benchmark) | Limited to whatever's modeled in dbt | Anyone with a dbt project; pair with another agent runtime |
| **Microsoft Fabric Data Agent** | RLS-aware data agent in Fabric ecosystem | Tight integration with Power BI / Foundry | Documented RLS edge cases under Foundry access paths | Microsoft-stack enterprises |
| **Hex Notebook Agent / Magic** | Agent embedded in notebooks | Notebook context is rich (prior cells, schema, vars). Best for SQL-comfortable users. | Notebook-shaped; not chat-shaped | Data teams already on Hex |
| **WrenAI** | Open-source GenBI platform with NL→SQL→charts→dashboards | Full stack, 12k GH stars, MCP-compatible context layer | Smaller ecosystem | OSS-first teams that want a full platform |
| **Vanna 2.0** | Open-source MIT text-to-SQL component library | Lifecycle hooks, middlewares, observability primitives | Component, not a platform | Teams embedding text-to-SQL into custom apps |
| **TextQL** | Vendor-built data analyst agent | Productized Slack-first agent with permission integration | Closed, vendor-managed | Enterprises that don't want to build |
| **Anthropic Managed Agents** | Cloud agent runtime with `/mnt/memory/` filesystem memory, sandboxed containers | Lowest-infra option for Claude users; prompt caching + compaction | Less control over loop | Claude-native teams (see [`../claude-managed-agents/`](../claude-managed-agents/README.md)) |
| **Atlan / DataHub / Acryl context layers** | "Context layer" products positioned upstream of agents | Catalog + lineage + policy for AI use | Newer category; varying maturity | Enterprises with messy metadata |

### Academic SOTA worth knowing

- **[ReFoRCE](https://arxiv.org/abs/2502.00675)** (Snowflake-Labs, ICLR 2026) — tops Spider 2.0. Self-refinement, format restriction, column exploration. CTE-level intermediate inspection. Open source.
- **[Dynamic-SQL](https://www.nature.com/articles/s41598-026-47693-2)** (Nature 2026) — multi-path CoT fusion + execution-feedback correction.
- **[SQL-of-Thought](https://arxiv.org/html/2509.00581v2)** — produces structured query plan before SQL.
- **[BIRD-Critic-SQLite + LiveSQLBench-Large-v1](https://github.com/bird-bench/BIRD-CRITIC-1)** (Mar 2026) — 480 long-context tasks, ~84K avg prompt tokens, 10× schema complexity over BIRD base. The current bar for enterprise text-to-SQL eval.
- **[VLDB 2026: Text-to-SQL Benchmarks are Broken](https://www.vldb.org/cidrdb/papers/2026/p5-jin.pdf)** — annotation-error analysis; methodological caution for benchmark interpretation.

### How to use these together

A pragmatic stack for an enterprise that doesn't want to build everything:

```
Slack ──▶ Custom thin agent shell (LangGraph or Managed Agents)
              │
              ├─▶ dbt MCP server (semantic-layer queries, deterministic)
              │
              ├─▶ Snowflake Cortex Analyst (open-ended Snowflake queries)
              │
              ├─▶ Custom retrieval over context-layer index
              │     (Atlan / DataHub / your own embeddings)
              │
              └─▶ Mem0 / Anthropic memory tool (cross-session)
```

The thin agent shell does routing: deterministic semantic-layer queries go to dbt MCP; open-ended exploration goes to Cortex Analyst; institutional knowledge goes through your own retrieval; memory writes / reads via the memory layer.

---

## 9. Failure modes (what bites you)

Cross-referencing the OpenAI lessons, Ramp's eval evolution, the [`../ai-bi-json-render-pattern/`](../ai-bi-json-render-pattern/README.md) §5 failure modes, and the broader literature:

1. **Context staleness.** Domain docs go stale. Codex enrichment must run nightly, automatically. If your context refresh requires manual work, it will rot. *Mitigation: automate every context layer except the human-authored one; force quarterly review on the human-authored one.*

2. **Confident wrong answers under bad context.** The agent will *always* return an answer. Without enforcement, it returns a believable wrong one. *Mitigation: require the agent to surface confidence + missing-context flags; eval intermediate steps to catch wrong tool selection.*

3. **Tool surface bloat.** OpenAI's Lesson 1 directly. Every overlapping tool call confuses the model. *Mitigation: <10 tools to start; consolidate before you add.*

4. **Highly prescriptive prompting.** OpenAI's Lesson 2. *Mitigation: state outcomes, not procedures; trust the frontier model's reasoning.*

5. **Memory poisoning / drift.** Saved corrections accumulate noise. A wrong correction saved to global memory propagates. *Mitigation: scope memory (global vs personal); curate periodically; see [`../ai-memory-systems/`](../ai-memory-systems/README.md) §4 for full treatment.*

6. **Permission bypass through hallucination.** Agent invents a table name or column it doesn't have access to. *Mitigation: pre-flight permission check before SQL execution; hard error on missing access, no fallback.*

7. **String-match evaluation.** Tempting to ship; produces unsustainable false-negative rates. *Mitigation: DF comparison + LLM-as-judge from day 1.*

8. **Single-evaluator gaming.** LLM-as-judge against a single prompt drifts toward the judge's biases. *Mitigation: rotate judge prompts; sample human review periodically; track multiple metrics.*

9. **Iterating without a cap.** Self-correction loops run unbounded. *Mitigation: hard cap (3 iterations works empirically per [`../agentic-self-improvement/`](../agentic-self-improvement/README.md) §2); cost monitor per session.*

10. **Slack-only adoption ceiling.** Slack works for routine queries; doesn't work for engineers who want the agent in their IDE, or analysts who want it in a notebook. *Mitigation: MCP makes multi-surface trivial — wire the same agent + context to multiple frontends.*

11. **Failure to instrument the cultural metric.** Most teams measure "time saved per query" and miss the floor effect. The 10–20× volume increase Ramp reports is invisible to per-query metrics. *Mitigation: track total questions per week per user, not just per-query latency.*

12. **Building before there's a context layer to build on.** The most common mode. The agent is bolted onto a warehouse with no semantic layer, sparse domain docs, and no eval suite. Pipeline-code-derived enrichment can paper over some of it but only some. *Mitigation: Phase 1 of the playbook is non-negotiable.*

---

## 10. What's still open

Even at frontier-shop scale (OpenAI), several questions are unsolved as of mid-2026:

- **Cross-session, cross-user memory governance.** OpenAI scopes memory to global + personal. What about team-scoped memory? What about memories that are correct for one team and wrong for another? See [`../ai-memory-systems/`](../ai-memory-systems/README.md) §4 for the current state of the art; it's not fully solved.
- **Drift detection on an evolving warehouse.** When the data team renames a column or changes a metric definition, how does the context layer notice? OpenAI's daily Codex refresh helps but doesn't catch all cases. The semantic-layer approach catches definition changes but not data-shape changes.
- **Long-context economics.** LiveSQLBench's ~84K-token prompts are now standard for hard enterprise queries. Even with Anthropic prompt caching, this is expensive at scale. Selective retrieval is necessary; OpenAI's hybrid (semantic + exact) is one answer but not the only one.
- **Multi-warehouse / federated agents.** Both case studies are single-warehouse. Real enterprises have Snowflake + Postgres + S3 + a couple of legacy systems. How does the context layer span these without exploding?
- **Trust calibration.** When should the agent express uncertainty? Both case studies say "expose reasoning" but neither describes how the agent decides when *not* to answer. This is a gap.
- **Evaluating non-deterministic queries.** "Top customer" depends on the day. "Recent" depends on now. How do you write golden SQL for a question whose correct answer changes? Ramp's intermediate-step assertions partially solve this; OpenAI doesn't address it directly.
- **Agentic self-improvement on the context layer itself.** Snowflake's [Agentic Semantic Model Improvement](https://www.snowflake.com/en/engineering-blog/agentic-semantic-model-text-to-sql/) paper takes the first step (auto-generate semantic models from schema + correct SQL). The full vision — an agent that reads its own eval failures, identifies missing context, and writes the doc — is not yet shipped.

---

## 11. Sources

### Primary (the basis of this report)

- [Bonnie Xu, Aravind Suresh, Emma Tang — *Inside OpenAI's in-house data agent*](https://openai.com/index/inside-our-in-house-data-agent/), OpenAI Engineering Blog, Jan 29 2026.
- [Faiz Hilaly, Cesar Duran, Jay Sobel — *Meet Ramp Research: Our Agentic Data Analyst*](https://engineering.ramp.com/post/meet-ramp-research), Ramp Builders Blog, Sept 18 2025.

### Vendor + practitioner

- [Snowflake — *Cortex Analyst*](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst) (docs)
- [Snowflake — *Cortex Agents*](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents) (docs)
- [Snowflake — *Improved SQL generation in Cortex Agents*](https://docs.snowflake.com/en/release-notes/2026/other/2026-04-13-cortex-agents-agentic-analyst), release notes Apr 13 2026.
- [Snowflake — *Agentic Semantic Model Improvement: Elevating Text-to-SQL Performance*](https://www.snowflake.com/en/engineering-blog/agentic-semantic-model-text-to-sql/)
- [Snowflake — *Cortex Analyst: Evaluating Text-to-SQL Accuracy for Real-World BI*](https://www.snowflake.com/en/engineering-blog/cortex-analyst-text-to-sql-accuracy-bi/)
- [Kaitlyn Wells — *Scaling Semantic Layer Rollout with Snowflake Cortex Code Agent SDK*](https://medium.com/snowflake/scaling-semantic-layer-rollout-with-snowflake-cortex-code-agent-sdk-40b21e5d8eda), Apr 2026.
- [Databricks — *AI/BI Genie is now Generally Available*](https://www.databricks.com/blog/aibi-genie-now-generally-available)
- [Databricks — *The next generation of Databricks Genie*](https://www.databricks.com/blog/next-generation-databricks-genie)
- [Databricks — *Introducing Genie Code*](https://www.databricks.com/blog/introducing-genie-code)
- [Databricks — *Enterprise AI Agent Trends*](https://www.databricks.com/blog/enterprise-ai-agent-trends-top-use-cases-governance-evaluations-and-more)
- [dbt — *About dbt Model Context Protocol (MCP) server*](https://docs.getdbt.com/docs/dbt-ai/about-mcp)
- [dbt — *Semantic Layer vs. Text-to-SQL: 2026 Benchmark Update*](https://docs.getdbt.com/blog/semantic-layer-vs-text-to-sql-2026)
- [dbt-labs/dbt-mcp (GitHub)](https://github.com/dbt-labs/dbt-mcp)
- [Hex — *Introducing the Notebook Agent*](https://hex.tech/blog/introducing-notebook-agent/)
- [Hex — *How to Work with Hex's Notebook Agent: A Prompting Guide*](https://hex.tech/blog/notebook-agent-prompting-guide-agentic-analytics/)
- [Canner/WrenAI (GitHub)](https://github.com/Canner/WrenAI)
- [vanna-ai/vanna (GitHub)](https://github.com/vanna-ai/vanna)
- [Microsoft — *Fabric data agent sharing and permission management*](https://learn.microsoft.com/en-us/fabric/data-science/data-agent-sharing)
- [Oracle — *Bringing Business Data Insights to Every User with Gemini Enterprise and Oracle AI Database*](https://blogs.oracle.com/cloud-infrastructure/google-cloud-next-2026)

### Context-layer framing

- [Atlan — *Context Engineering Framework for Enterprise AI in 2026*](https://atlan.com/know/context-engineering-framework/)
- [Atlan — *What OpenAI's Data Agent Reveals About Enterprise AI*](https://atlan.com/know/ai-readiness/openai-data-agent/)
- [Atlan — *Context Layer vs. Semantic Layer: Key Differences Explained*](https://atlan.com/know/context-layer-vs-semantic-layer/)
- [Contextual AI — *Semantic Layer vs. Context Layer: Why Enterprise AI Needs Both*](https://contextual.ai/blog/semantic-layer-vs-context-layer)
- [DataHub — *Semantic Backbone of Enterprise Analytics Agents*](https://datahub.com/blog/semantic-backbone-of-enterprise-data-analytics-agents/)
- [MotherDuck — *Your Data Model Is the Semantic Layer*](https://motherduck.com/blog/bird-bench-and-data-models/)

### Academic / benchmark

- [BIRD benchmark](https://bird-bench.github.io/)
- [bird-bench/BIRD-CRITIC-1 (NeurIPS 2025)](https://github.com/bird-bench/BIRD-CRITIC-1)
- [VLDB 2026 — *Text-to-SQL Benchmarks are Broken: An In-Depth Analysis of Annotation Errors*](https://www.vldb.org/cidrdb/papers/2026/p5-jin.pdf)
- [ReFoRCE: A Text-to-SQL Agent with Self-Refinement, Format Restriction, and Column Exploration](https://arxiv.org/abs/2502.00675) (Snowflake-Labs)
- [Snowflake-Labs/ReFoRCE (GitHub)](https://github.com/Snowflake-Labs/ReFoRCE)
- [Dynamic-SQL — Nature, 2026](https://www.nature.com/articles/s41598-026-47693-2)
- [SQL-of-Thought: Multi-agentic Text-to-SQL with Guided Error Correction](https://arxiv.org/html/2509.00581v2)
- [Adnan Masood — *Pushing Towards Human-Level Text-to-SQL: An Analysis of Top Systems on BIRD Benchmark*](https://medium.com/@adnanmasood/pushing-towards-human-level-text-to-sql-an-analysis-of-top-systems-on-bird-benchmark-666efd211a2d)

### Internal cross-links (this repo)

- [`../ai-bi-json-render-pattern/`](../ai-bi-json-render-pattern/README.md) — Abhi Sivasailam's two-route pattern for AI-BI; same "compose over governed primitives" thesis at the visualization layer.
- [`../agentic-self-improvement/`](../agentic-self-improvement/README.md) — memory + reflection + DSPy + experience-driven retrieval. The mechanisms behind OpenAI's Layer 5 and the closed-loop self-correction.
- [`../ai-memory-systems/`](../ai-memory-systems/README.md) and sub-reports — full taxonomy of memory architectures and the AGENTS.md / MCP / SKILL.md standards.
- [`../claude-managed-agents/`](../claude-managed-agents/README.md) — Anthropic Managed Agents runtime; the lowest-infra option for the agent layer.
- [`../cli-tools-for-ai-agents/`](../cli-tools-for-ai-agents/README.md) — CLI design principles for agent-callable tools (informs the tool surface in §7).
- [`../power-bi-migration-tools/`](../power-bi-migration-tools/README.md) §4b — AIS spec-driven migration; same "agent emits structured artifact, deterministic generator consumes" pattern.
- [`../cli-agent-harness-survey/`](../cli-agent-harness-survey/README.md) — file-based agent harness conventions for `domain_docs/` style context.
- [`../standalone-memory-tools-survey-2026/`](../standalone-memory-tools-survey-2026/README.md) — comparative catalog (Mem0, Letta, Zep/Graphiti, Anthropic memory tool, etc.).

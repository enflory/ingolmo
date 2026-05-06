# Notes — Enterprise Data Agents

Research thread on building agentic systems that operate on top of enterprise data, anchored in two primary sources (OpenAI in-house data agent + Ramp's research data agent), with supplementary literature.

## Plan / shape

- Read both primary PDFs fully (small — 15 and 10 pages).
- Cross-reference with prior threads in this repo: `ai-bi-json-render-pattern`, `agentic-self-improvement`, `claude-managed-agents`, `ai-memory-systems`.
- Pull in 2025–26 vendor and academic work for triangulation: Snowflake Cortex Analyst, Databricks Genie/AI-BI, dbt MCP, Cube semantic layer, BIRD/Spider 2.0 text-to-SQL benchmarks, Numbers Station, Sigma, Hex.
- Final write-up: README.md targeting an agent reader who has not seen the PDFs.

## Working log

### Source 1 — OpenAI: "Inside OpenAI's in-house data agent" (Jan 29, 2026)

Authors: Bonnie Xu, Aravind Suresh, Emma Tang. Internal-only tool, not an external offering.

**Scale of the problem (motivation)**
- 3.5k internal users across Engineering, Product, Research
- 600 PB of data, 70k datasets
- Quoted user pain: tables that look similar but differ subtly (logged-out vs logged-in users, overlapping fields). "It's hard to tell what is what."
- Common silent failure modes: many-to-many joins, filter pushdown errors, unhandled nulls, 180+ line SQL.
- Goal: shift analysts from debugging SQL semantics to defining metrics, validating assumptions, decisions.

**Architecture (high level)**
- Powered by **GPT-5.2** (their flagship). Built using the same external OpenAI tools: Codex, GPT-5, Evals API, Embeddings API.
- Entrypoints: Agent UI (web), Local Agent-MCP, Remote Agent-MCP, Slack agent, IDE via Codex CLI / MCP, internal ChatGPT via MCP connector.
- Central `AGENT-API` ↔ model (GPT-5.2) over `AGENT-MCP`.
- Pre-processed offline: Internal Data Knowledge Base + Company Context (Slack/Google Docs/Notion).
- Online sync: Data Warehouse + Data Platform Sources (Spark, Airflow, Metadata Service).

**The 6-layer context model (the key idea)**
1. **Table Usage** — schema metadata (col names/types), table lineage (upstream/downstream), and inference from historical queries about which tables are joined together.
2. **Human Annotations** — explicit domain expert input: intent, semantics, business meaning, caveats not inferable from schemas.
3. **Codex Enrichment** — Codex crawls the pipeline code that *produces* a table to derive: table's purpose, exact grain & primary keys, downstream usage patterns, when to use alternate tables, freshness/refresh cadence. Refreshed automatically. Lets the agent distinguish "looks similar but different" tables (e.g., excludes first-party traffic vs all traffic).
4. **Institutional Knowledge** — Slack, Google Docs, Notion ingested, embedded, stored with metadata + permissions. Retrieval service enforces access control + caches at runtime. Captures launches, incidents, codenames, canonical metric definitions.
5. **Memory** — saves corrections and learned nuances. Global + personal scope. Agent prompts user to save learnings; users can edit. Example given: an experiment had to be filtered by a specific gate string — memory ensured exact match instead of fuzzy.
6. **Runtime Context** — live queries to warehouse / metadata service / Airflow / Spark when prior context is stale or missing.

**Offline → online pipeline**
- Daily offline job aggregates layers 1–4 into a normalized representation, embeds via OpenAI Embeddings API, stores for retrieval.
- At query time: pull only most relevant embedded context via RAG.
- Live retrieval combines **semantic search** + **exact text retrieval** → agent → runtime context.
- Goal: keep latency predictable across 70k tables.

**Behavioral / interaction design**
- Closed-loop, self-correcting. If an intermediate query returns zero rows from a bad join, agent diagnoses, adjusts, retries — carries learnings across steps within a session.
- Conversational with full context across turns; user can interrupt mid-analysis.
- Asks clarifying questions when ambiguous; otherwise applies sensible defaults (e.g., default to last 7/30 days for "growth").
- "Workflows" = reusable instruction sets for recurring analyses (weekly business reports, table validations). Encodes context + best practices once.
- Equally usable for "tell me about this table" and exploratory drilldowns ("I see a dip, break it down by customer type").

**Evaluation discipline**
- Curated Q&A pairs, each paired with manually authored "golden" SQL.
- For each eval: send NL question to query-generation endpoint → execute generated SQL → compare to golden result.
- Doesn't rely on string matching. Compares both the *SQL* (logical structure) AND the *DataFrame result* (semantic correctness). Extra columns OK if semantically equivalent.
- Grader emits score + explanation. Captures correctness and "acceptable variation."
- Used as continuous unit tests during development; deployed as canaries in production to catch regressions.

**Security**
- Pure interface layer over existing access controls. **Strict pass-through** — users can only query tables they're already authorized to see.
- When access missing, agent flags it or falls back to authorized alternatives.
- Exposes reasoning + links to underlying results so users can verify each step.

**Lessons learned (their stated 3)**
1. **Less is More** — early on, exposed full toolset. Overlapping functionality confused the agent. Restricted/consolidated tool calls.
2. **Guide the Goal, Not the Path** — prescriptive prompting degraded results. Higher-level guidance + GPT-5 reasoning > rigid scripts. Trust the model's planning.
3. **Meaning Lives in Code** — schemas + query history give shape and usage, but *true meaning* is in the code that produces the table. Pipeline code captures assumptions, freshness guarantees, business intent that never surfaces in SQL or metadata. → Codex-crawled enrichment is the differentiated insight.

**Forward statement**
- Improvements ahead: better handling of ambiguous questions, stronger validations, deeper workflow integration. Want it to "blend naturally into how people work" — not a separate tool.

### Source 2 — Ramp: "Meet Ramp Research: Our Agentic Data Analyst" (Sep 18, 2025)

Authors: Faiz Hilaly, Cesar Duran, Jay Sobel. Engineering Builders Blog.
URL: https://engineering.ramp.com/post/meet-ramp-research

**Problem framing — identical to OpenAI's**
- Data questions don't crash the system; they "quietly slow every decision."
- Single bottleneck: `#help-data` Slack channel funnels every PM/Designer/AE/Marketing/Growth question to one on-call analyst.
- Tabs sprawl across Looker, Snowflake, dbt docs. Answers land "after the decision window has narrowed."
- Most questions never get asked because people hesitate to add to the queue.

**Scale (after ~6 weeks live)**
- Launched early August 2025. By Sept 18: **1,800 questions, 1,200 conversations, 300 distinct users.**
- `#ramp-research-beta` channel: 500+ members.
- 4 weeks before publication: **1,476 questions in `#ramp-research-beta` vs only 66 in `#help-data`** — i.e., the agent absorbed roughly 22× the human channel's volume.

**Stack**
- Underlying data: Snowflake, dbt, Looker, Hex, Postgres.
- Agent feeds 4 sources at retrieval time: **Domain Docs**, **Data Model Docs**, **Jargon Dictionary**, **Analytics DB**.
- Slack is the only UI. No PII access.

**Defining the Search Space (their core technical claim)**
- "Large-scale data, without the necessary context, is nearly impossible to use."
- Step 1: aggregate/index metadata from dbt, Looker, Snowflake → fetch right models, form precise queries.
- Step 2: even with metadata, the agent didn't connect data to *business* domains. That knowledge is tacit, lives with domain owners. **Domain owners wrote technical docs by area**, organized into a filesystem the agent can browse.
- Step 3: thousands of tables/views, many questions need row-level inspection. Solution: instead of relying on generic compression (keyword or vector search), give the agent **tools to inspect column values, branch, and backtrack** — "reasoning through data the way a human analyst would."

**Slack as interface (UX choices)**
- Default channel: `#ramp-research-beta`. Now embedded in alert channels (diagnose failed transactions) and project channels (scope new features).
- **Data Previews:** in-thread CSV previews so users can validate without leaving Slack — especially helpful for non-SQL users.
- **Intermediate Steps** button on each answer (visible reasoning).
- **Multi-turn:** each thread stateful → users clarify intent, refine, collaborate. Their note: "the agent's performance also saw an end-to-end improvement as a result." (Stateful threads > stateless single-shot.)
- Each answer surfaces SQL Query + Data Preview + thumbs up/down feedback.

**Evaluation evolution (3 stages)**
1. **Human-in-the-loop** — pinged domain owners on every in-domain question. Didn't scale; just shifted the bottleneck.
2. **Per-domain end-to-end tests** — listed high-priority concepts per domain with experts; wrote E2E tests. Exposed blind spots but **didn't tell you why** Ramp Research passed/failed.
3. **Python mini-framework inside the dbt project** — asserts on **final answer AND intermediate steps**: expected tool calls, expected table references, expected query shape. Closed the loop: update context → run tests → confirm. **Eval the context layer, not each question.**

**Cultural outcome (the most interesting framing)**
- "Collapsing the cost of asking a question to near-zero changes who asks, when they ask, and what they ask."
- 10–20× increase in questions asked. Most growth = questions that previously "died in drafts or never left someone's head."
- Counting-cards analogy: a 1–2 point lift in decision quality is invisible per decision but compounds across thousands of pricing tweaks, GTM filters, feature rollouts. Raises the floor on every hand.

**Forward**
- Headless API for teams to embed in their own workflows (customer case study generation, fraud pattern detection).
- Context layer is itself a "valuable technical asset" — want to expand beyond analytics DB.
- Vision: agents + humans collaborating.

### Cross-references — prior threads in this repo

These threads cover adjacent layers and provide concrete guidance to combine with the OpenAI/Ramp playbooks. Reuse rather than re-derive.

- **`ai-bi-json-render-pattern/`** — Abhi Sivasailam's two-route pattern (v0 for one-off apps; json-render for governed BI). The catalog/action/component governance model is the *visualization* counterpart to OpenAI/Ramp's *retrieval* layer. Concrete failure modes (catalog completeness, prompt budget, aggregation truthiness, structured-output guarantees) transfer. Calls out the same vendor neighbors I'll cover (Snowflake Cortex, Hex, Databricks AI/BI, ThoughtSpot Spotter).
- **`agentic-self-improvement/`** — the meta-mechanisms. OpenAI's Layer 5 (Memory) maps to Mem0/Letta-style cross-session memory. Their evals + closed-loop self-correction map to Reflexion/SAGE. Their per-table "learned correction" memories map to "experience-driven trajectory retrieval." Tier 1 of that thread (memory + reflection) is essentially what OpenAI deployed.
- **`ai-memory-systems/`** + sub-reports (`memory-architectures-2026/`, `standalone-memory-tools-survey-2026/`, `cli-agent-harness-survey/`) — full taxonomy of memory architectures and the AGENTS.md/MCP/SKILL.md standards. OpenAI uses MCP as the agent's external surface (Codex CLI via MCP; ChatGPT internal app via MCP connector). OpenAI's "global vs personal memory" matches the standalone-memory-tools survey distinction.
- **`claude-managed-agents/`** — Anthropic's hosted-agent runtime. Equivalent infra layer to OpenAI's `AGENT-API + AGENT-MCP` pattern but external. Memory tool (`/mnt/memory/`) is comparable to OpenAI's persistent memory.
- **`power-bi-migration-tools/`** §4b — AIS spec-driven migration pattern (agent emits NL spec → deterministic generator → human-reviewable checkpoint). Same "agent emits structured artifact, human/code consumes" architecture appears in OpenAI's Codex enrichment (codebase → structured table descriptions → embeddings).
- **`cli-tools-for-ai-agents/`** — agent-targeted CLI design principles (output discipline, schema introspection, side-effect honesty). Relevant to designing the *tools* an enterprise data agent calls (table search, query exec, schema fetch, lineage walk).

**Convergent insight from prior work**: agentic systems on enterprise data succeed when the human work moves *upstream* into governed primitives (semantic models, catalogs, action surfaces, domain docs) and the LLM handles only *composition* over those primitives. Both OpenAI and Ramp invest disproportionately in the context layer (Layers 1–4 / Domain Docs / Data Model Docs / Jargon Dictionary) rather than agent prompting. Same shape as Abhi's catalog-as-contract argument.

### Web research — supplementary sources

#### Atlan (Apr 2026) — "What OpenAI's Data Agent Reveals About Enterprise AI"
- Frames OpenAI's edge as foundational *infrastructure* before deployment, not model quality. "The bottleneck isn't model capability — it's the context layer underneath."
- Contrast: most enterprises lack documented business definitions, scattered metadata, no systematic eval before production.
- "Without making organizational knowledge machine-readable, even sophisticated AI confidently delivers incorrect answers."
- Reinforces same 6-layer model from the source PDF.
- URL: https://atlan.com/know/ai-readiness/openai-data-agent/

#### Atlan — "Context Engineering Framework for Enterprise AI in 2026"
- Defines context engineering (Tobi Lütke quote: "the art of providing all the context for the task to be plausibly solvable by the LLM").
- "Trust gap, not a model gap." Failure modes: attention-budget waste, metadata staleness, broken reuse.
- Six-layer model: system instructions, semantic context, operational memory, conversational history, retrieval systems, tool access.
- URL: https://atlan.com/know/context-engineering-framework/

#### Contextual AI — "Semantic Layer vs. Context Layer: Why Enterprise AI Needs Both"
- Semantic layer (dbt, LookML, Cube, Snowflake Semantic Views) governs *structured* data → BI tools. Translates schemas to business terms.
- Context layer governs *all* enterprise data, structured + unstructured (docs, contracts, threads). RAG, grounding, attribution.
- 80–90% of organizational knowledge sits in unstructured formats outside the semantic layer's reach.
- "A semantic layer is to structured data what a context layer is to all enterprise data."
- URL: https://contextual.ai/blog/semantic-layer-vs-context-layer

#### dbt — "Semantic Layer vs Text-to-SQL: 2026 Benchmark Update"
- Headline: with dbt Semantic Layer + a fully-modeled spec, **GPT-5.3 Codex 100%, Claude Sonnet 4.6 98.2%** accuracy. Raw text-to-SQL on modeled data: GPT-5.3 84.1%, Sonnet 4.6 90%.
- 2023 baseline text-to-SQL accuracy: 32.7%. Massive improvement.
- Methodology: ACME Insurance dataset, 11 questions × 20 runs each, 4 configurations (raw t2sql; minimal semantic; fully modeled semantic; t2sql with optimized data models).
- Recommendation: **Semantic layer for high-stakes (KPIs, board decks, audits); text-to-SQL for exploratory.** "Even minimal modeling improves both approaches."
- Why semantic wins: MetricFlow handles query generation deterministically. LLM only picks the right metric+dimensions; can't produce a bad join or aggregation.
- URL: https://docs.getdbt.com/blog/semantic-layer-vs-text-to-sql-2026

#### Snowflake — "Agentic Semantic Model Improvement: Elevating Text-to-SQL Performance"
- Solves the bottleneck of *manually authoring* semantic models — slow, error-prone, expert-only.
- Multi-agent loop:
  1. Model Creation — auto-generates baseline from schema + external knowledge.
  2. Relationships Agent — infers table connections from correct SQL + PKs.
  3. Semantic Model Editor — diffs current vs generated SQL; proposes edits.
  4. Custom Instruction Editor — writes domain SQL rules.
  5. Evaluator — two-step: column comparison, then dataframe semantic comparison. *Same shape as OpenAI's evals.*
  6. Orchestrator — coordinates iterative refinement.
- ~20% accuracy lift over baseline. BIRD-SQL improvements: debit card 31%, schools 17%, thrombosis 25%, toxicology 10%. Human is at 93%.
- URL: https://www.snowflake.com/en/engineering-blog/agentic-semantic-model-text-to-sql/

#### Snowflake Cortex Agents (Apr 13, 2026 release notes) + Cortex Code Agent SDK
- Cortex Agents using Cortex Analyst semantic views as tools now generate SQL **directly** rather than delegating to Cortex Analyst service. Lower latency, higher accuracy. Tool blocks of type `cortex_analyst_text_to_sql` replaced by `system_execute_sql` with a `sql` field.
- 90%+ SQL accuracy on real-world BI use cases (Snowflake claim).
- Cortex Code Agent SDK: scaling tooling for semantic-layer rollout.
- URLs: https://docs.snowflake.com/en/release-notes/2026/other/2026-04-13-cortex-agents-agentic-analyst , https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst , https://medium.com/snowflake/scaling-semantic-layer-rollout-with-snowflake-cortex-code-agent-sdk-40b21e5d8eda

#### Databricks Genie — "AI/BI Genie GA" + "Next generation of Genie" + "Genie Code"
- Genie Agent mode: multi-step reasoning + hypothesis testing for "why" questions. Streams thinking traces inline; runs queries in parallel.
- Genie Deep Research: research plans, multiple SQL queries to gather evidence, iterative reasoning, citations. Targets root-cause questions ("drivers behind a revenue spike", churn factors). PDF export for reports.
- Single-agent architecture (post-Apr 2026) > multi-agent: better instruction following, cleaner viz, lower latency, more focused output.
- Genie Code: agentic engineering for data work — extends agents into data engineering tasks.
- URLs: https://www.databricks.com/blog/aibi-genie-now-generally-available , https://www.databricks.com/blog/next-generation-databricks-genie , https://www.databricks.com/blog/introducing-genie-code

#### dbt MCP server
- MCP exposes dbt CLI, Discovery API, Semantic Layer (incl. text-to-SQL + SQL execution).
- Works with Claude / Cursor / any MCP client. Local MCP supports `dbt run/build/test`.
- "MetricFlow handles actual query generation deterministically — LLM can't produce an incorrect join or bad aggregation if it picks the right metric and dimensions." Mirrors Snowflake's claim.
- URLs: https://docs.getdbt.com/docs/dbt-ai/about-mcp , https://github.com/dbt-labs/dbt-mcp , https://docs.getdbt.com/blog/introducing-dbt-mcp-server

#### BIRD benchmark + LiveSQLBench (text-to-SQL eval state of the art, 2026)
- BIRD = "Big Bench for Large-scale Database Grounded Text-to-SQL Evaluation" (HKU + Alibaba).
- Mar 2026: BIRD-Critic-SQLite (500 user issues, real apps) + BIRD-Talon and BIRD-Zeno trained models released.
- Mar 2026: LiveSQLBench-Large-v1 — ~1000 columns / 54 tables per DB, 480 tasks, 10x schema complexity, ~84K avg prompt tokens for long-context tests.
- Top systems on dev: AskData + GPT-4o ~81.95%; human ~92.96%. Gap closed via multi-step pipelines, not raw model lift.
- VLDB 2026 paper "Text-to-SQL Benchmarks are Broken" — annotation-error analysis. Methodological caution.
- URLs: https://bird-bench.github.io/ , https://github.com/bird-bench/BIRD-CRITIC-1 , https://www.vldb.org/cidrdb/papers/2026/p5-jin.pdf

#### MotherDuck — "Your Data Model Is the Semantic Layer"
- Argues: a well-designed dimensional/star data model already encodes most semantic-layer value. The "true" semantic layer is the data model itself, not a YAML overlay.
- Implication for agents: invest in data model quality before you bolt on a semantic-layer product.
- URL: https://motherduck.com/blog/bird-bench-and-data-models/

#### Hex Magic / Notebook Agent
- Embedded in notebooks rather than chat. Generates SQL/Python cells. Designed for users *already* comfortable with SQL — accelerator, not replacement.
- Context = prior cells + variable names + DB schema → meaningfully more accurate than chatbot.
- URLs: https://hex.tech/blog/introducing-notebook-agent/ , https://hex.tech/blog/notebook-agent-prompting-guide-agentic-analytics/

#### WrenAI (open-source GenBI) and Vanna.ai 2.0
- WrenAI — open-source "context layer for MCP clients and AI agents." Full GenBI platform: NL → SQL + charts + dashboards, with governance. ~12k GH stars.
- Vanna 2.0 — open-source MIT lib. Lifecycle hooks, LLM middlewares, conversation storage, observability, context enrichers. Component library, not a platform. Local LLM via Ollama.
- URLs: https://github.com/Canner/WrenAI , https://github.com/vanna-ai/vanna

#### Databricks Enterprise AI Agent Trends (state of 2026)
- Top use cases, governance & evals trends from Databricks customer base. Stresses systematic evaluation framework, multi-agent architectures, model flexibility, real-time decisioning. Cites correlation between rigorous evals and ~6× higher production success rates.
- URL: https://www.databricks.com/blog/enterprise-ai-agent-trends-top-use-cases-governance-evaluations-and-more

#### Pass-through permissions / row-level security (the OpenAI claim, externally)
- Microsoft Fabric Data Agent honors RLS + CLS, but with edge-case bugs (RLS not enforced under some Foundry access paths). Identity / delegated tokens are how RLS gets propagated.
- Oracle's "Deep Data Security" — database-native, identity-aware access control specifically for agentic AI. Propagates end-user + agent identity to DB at runtime so policies are enforced centrally.
- "Governance-containment gap" — defining 2026 enterprise security challenge as agents gain access to internal systems. MintMCP and others propose unified MCP Gateway infrastructure with auth + audit.
- Implication for OpenAI/Ramp's "strict pass-through" claim: it's table-stakes, not innovation, but it's what most homegrown agent demos still botch.
- URLs: https://learn.microsoft.com/en-us/fabric/data-science/data-agent-sharing , https://blogs.oracle.com/cloud-infrastructure/google-cloud-next-2026 , https://www.mintmcp.com/blog/ai-agent-security

#### Self-correction in academic text-to-SQL (the OpenAI loop, formalized)
- **ReFoRCE** (Snowflake-Labs, ICLR 2026) — tops Spider 2.0 leaderboard. Generates SQL → parses into CTEs → executes each CTE independently → verifies each intermediate result → rewrites the offending CTE if a result looks wrong. Adds majority-vote consensus + iterative column exploration. Mirrors OpenAI's described loop almost exactly.
- **Dynamic-SQL** (Nature 2026) — multi-path CoT fusion + execution-feedback correction.
- **SQL-of-Thought** — produces structured query *plan* before SQL. Plan = intermediate reasoning step.
- General lesson: post-execution intermediate-result inspection is the single most-replicated technique. Both Ramp's "tools to inspect column values, branch, and backtrack" and OpenAI's "if zero rows, investigate and retry" are this pattern.
- URLs: https://arxiv.org/abs/2502.00675 , https://github.com/Snowflake-Labs/ReFoRCE , https://www.nature.com/articles/s41598-026-47693-2 , https://arxiv.org/html/2509.00581v2

### Synthesis hypotheses for the README

1. **OpenAI and Ramp converge on the same architectural shape**: 6 layers / 4 stores. Both prioritize the *context layer* over agent prompting. Both use Slack as the entry point for routine queries. Both eval intermediate steps, not just final answers. Both depend on closed-loop self-correction via execution feedback.
2. **The context layer is the actual product** — not the agent. Vendor pitch (Atlan, Contextual AI, dbt) confirms this is now the consensus framing.
3. **Semantic layer is necessary but not sufficient**. dbt benchmark says semantic layer = ~98–100% on covered queries. But OpenAI/Ramp serve open-ended questions. → Semantic layer for high-stakes; agent + context layer for the long tail.
4. **Code is the underexploited primary source.** OpenAI's Lesson 3 ("Meaning Lives in Code") is the most differentiated insight. Most semantic-layer products treat the data model as the source; OpenAI treats the *pipeline code* that builds the data model as a richer source.
5. **Evaluating the context layer beats evaluating the agent.** Ramp's pivot — from per-question evals to per-context-concept evals + intermediate-step assertions — is the most tractable enterprise eval methodology surfaced.
6. **Governance is upstream, agent is downstream.** Permissions, RLS, jargon dictionary, business definitions all sit upstream of the agent and constrain its action space.


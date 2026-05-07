# Lite databases as substrate for enterprise AI agents

*Researched May 2026. Audience: a senior practitioner choosing how to give an AI agent a place to compute against business data — for finance, marketing, ops, RevOps, HR, supply-chain workflows, not for software development.*

This thread is about the **analytical scratchpad layer** beneath the agent. The agent reasons in tokens, but the moment money or numbers are involved, you want the math to happen somewhere deterministic, auditable, and cheap. In 2026 that "somewhere" is overwhelmingly **DuckDB or SQLite, in-process, single file, embedded in the agent's tool surface** — with a small constellation of cousins (Polars, PGlite, sqlite-vec, LanceDB, KuzuDB, MotherDuck) for adjacent jobs.

Adjacent prior work in this repo, all worth reading alongside:

- [`enterprise-data-agents/`](../enterprise-data-agents/README.md) — the *warehouse* end of this same problem: OpenAI's and Ramp's in-house data agents over Snowflake / 600 PB. **Sets the contrast.** This thread is the lite end.
- [`ai-bi-json-render-pattern/`](../ai-bi-json-render-pattern/README.md) — the *output* end: agent emits a JSON spec, governed components render. Lite-DB compute composes naturally upstream of that.
- [`claude-code-excel-integration/`](../claude-code-excel-integration/README.md) — the *user-facing artifact* end for finance specifically. Excel as deliverable; DuckDB increasingly as the compute layer behind it.
- [`ai-memory-systems/`](../ai-memory-systems/README.md), [`memory-architectures-2026/`](../memory-architectures-2026/README.md), [`standalone-memory-tools-survey-2026/`](../standalone-memory-tools-survey-2026/README.md) — SQLite and friends also serve as the agent's *persistent memory*. Covered there; touched only briefly here.

---

## TL;DR

1. **A lite DB is the right substrate for an agent's analytical scratchpad.** Three forces converge: token economy (SQL aggregation collapses 10⁶ rows into 10), determinism (LLMs do arithmetic badly; SQL doesn't), and auditability (the SQL itself is the proof of work). Plus operational: privacy, speed, zero infrastructure, offline.
2. **Default stack for an agent doing non-dev enterprise analytics in 2026: DuckDB for OLAP scratchpads + SQLite (with `sqlite-vec` if needed) for persistent state, both reachable via MCP or via a sandboxed Python tool that ships with `duckdb` and `sqlite3` preinstalled.** This is what Anthropic's official `duckdb-skills` plugin, MotherDuck's MCP server, and Claude Code's analysis tool all converge on.
3. **The right mental model is *role*, not *vendor*.** Four roles: **ephemeral scratchpad** (DuckDB/Polars), **persistent semantic memory** (SQLite + sqlite-vec, PGlite), **read-only published artifact** (Datasette, MotherDuck Dives), and **bridge to governed data** (DuckDB attached to Iceberg/DuckLake). Most agent systems use 2–3 of these.
4. **Lite DBs belong at the *task* layer, not the *system of record* layer.** Use them when the data is exported, sampled, or scoped to a single decision. The minute multiple users or services need to see consistent state — back to a server. The minute the data already lives in a governed warehouse — query it where it lives, don't copy it to a laptop.
5. **The clearest enterprise wins are CSV-rich, multi-source, ad-hoc workflows that today live in a brittle Excel tab**: AP duplicate detection, cross-channel marketing rollup, pipeline hygiene, audit sampling, monthly variance commentary, supplier scorecards. The agent's value is *not* the SQL — it's that the agent reads six exports with mismatched schemas, normalises them, runs the SQL, and writes a deck. The lite DB is what makes the middle step trustworthy.

---

## How to read this report

§1 explains the three reasons agents are more effective with a lite DB underneath. §2 is the tool landscape, organised by role. §3 is the decision framework — when to use one and when not to. §4 walks through five concrete enterprise workflows end-to-end. §5 covers integration patterns (MCP servers, code-execution sandboxes, Skills). §6 is failure modes. §7 is sources.

The investigation log is in [`notes.md`](./notes.md).

---

## 1. Why a lite DB makes an agent more effective

A pure-LLM agent given a CSV does three things badly:

**Arithmetic.** LLMs are stochastic; arithmetic over 50,000 rows is not. Off-by-ones in summed columns, dropped null buckets, double-counted joins — all routine in raw-LLM analysis, all banned by an actual query engine. By 2026 every serious agent harness pushes math to a deterministic substrate. The Anthropic code-execution tool exists for exactly this; Claude Code's Bash/Python is the same pattern; OpenAI's Code Interpreter has been doing it since 2023. The substrate underneath that Python kernel is almost always `duckdb`, `pandas`, `polars`, or `sqlite3` — which is to say, a lite DB.

**Token economy.** A 200,000-row CSV is ~50 MB of tokens. Putting it in context — even with prompt caching — is wrong. Loading it into DuckDB and querying for the eleven numbers that answer the question is right. The token cost difference is two orders of magnitude. This is also why "send the table to the LLM and ask for the average" is an anti-pattern: you pay tokens and get a guess, where you could pay milliseconds and get a fact.

**Auditability.** When a finance team asks "where did this number come from", the answer should be *a SQL string they can read*, not "the model thought it was about $4.2M". A lite-DB agent's transcript naturally contains the queries it ran. That transcript is the audit trail. Reproducing the agent's number is `duckdb -c "<query>" data.parquet` — no model required.

A fourth, less-discussed reason: **lite DBs let agents safely fan out**. An agent investigating five hypotheses can spin up five DuckDB instances, run five different queries against the same Parquet, and compare results — all without infrastructure, without rate limits, without locking shared state. The cheap-isolation property of single-file engines is what makes plan-and-branch agent loops practical in non-dev contexts.

---

## 2. The tool landscape, by role

The taxonomy that matters is not vendor — it's *what role does the DB play in the agent's loop*. Four roles cover the field.

### Role 1 — Ephemeral analytical scratchpad

The agent receives a question and some data (CSVs, Parquet on S3, a NetSuite export), spins up a DB, queries, returns aggregated results, and discards the DB at task end.

| Tool | Strengths | Weaknesses |
|---|---|---|
| **DuckDB** | The category default. Single binary. Native CSV/JSON/Parquet/Excel/Avro/SQLite read. S3, GCS, Azure, HTTPS. Friendly SQL dialect. Zero install. v1.5.2 (Apr 2026) and DuckLake 1.0 (May 2026) cement it as a real lakehouse engine, not a toy. | Single-process; not for concurrent writers. Memory bound by the box. |
| **Polars** | Fastest in-memory dataframes; SQL frontend; tight Python ergonomics. Often used *with* DuckDB rather than instead of it. | No real persistence model — "save to Parquet" is the only durability. Smaller SQL surface than DuckDB. |
| **chDB** | Embedded ClickHouse. Stronger for very-wide OLAP, time-series, sketch functions. | Slower startup, larger binary, niche unless you're already a ClickHouse shop. |
| **Apache DataFusion** | Rust-native engine, building block inside LanceDB, InfluxDB 3, Comet. | Building block, not UX surface. Not what an agent talks to directly. |

In agent code, this role looks like:

```python
import duckdb
con = duckdb.connect(":memory:")
con.execute("CREATE TABLE invoices AS SELECT * FROM read_csv_auto('inbox/*.csv')")
con.execute("""
  SELECT vendor, COUNT(*) AS dupes
  FROM invoices
  GROUP BY vendor, amount, invoice_date
  HAVING dupes > 1
  ORDER BY dupes DESC
""").fetchall()
```

Three lines, deterministic, auditable. The agent emits the SQL, the runtime executes it, the agent reads back ~30 rows instead of the 250,000-row file.

### Role 2 — Persistent semantic memory

The agent has things it should remember between tasks: vendor master lists, customer aliases, GL account mappings, prior decisions, the marketer's list of competitor names. These are small, slow-changing, and need to be queryable across sessions.

| Tool | Strengths | Weaknesses |
|---|---|---|
| **SQLite** | Universal. Files, FTS5 full-text, JSON1, geopoly. Ten-line backup story (`cp memory.db memory.db.bak`). | OLTP-shaped; not great for ad-hoc analytics over many GB. |
| **SQLite + sqlite-vec** | Adds vector KNN to the same file as relational data. The cleanest pattern in 2026 for "memory that needs both facts and similarity search". Successor to sqlite-vss. | One-file means one writer; multi-process needs careful WAL discipline. |
| **libSQL / Turso** | SQLite fork with embedded replicas, server mode, native vector. The "SQLite that scales" play; useful when memory must sync across user devices. | Tied to a vendor's hosted product or self-hosted server. |
| **PGlite** | Real Postgres in WASM, ~3 MB gzipped. v0.4 (Mar 2026) ships PostGIS, pgvector, Apache AGE (graph), pg_uuidv7. Persistence to filesystem or IndexedDB. | Newer; smaller community. Native (non-WASM) bindings still maturing. |
| **KuzuDB** | Embedded property graph + Cypher. The right fit when the *relationships* between entities are what you want to query — "what other vendors share this address?". Used by Cognee. | Cypher is unfamiliar to most non-dev users; reasoning across graph schemas is harder for LLMs than SQL. |
| **LanceDB** | Embedded columnar vector DB (Lance format). Filters + vectors together; versioned. The 2026 default *pure* embedded vector store. | Less integrated with relational data than sqlite-vec. |

The pattern that has converged: **one SQLite file per agent or per user, holding both relational memory and vectors via sqlite-vec, attached via MCP**. This is what Anthropic's memory tool does, what Mem0's OpenMemory ships, what Basic Memory uses, what Cline's memory bank emulates with files.

### Role 3 — Read-only published artifact

The agent finishes a piece of analysis. The result needs to be a *thing* that a non-dev colleague can open, browse, share, and reason about — not a transcript and not a fragile re-run.

| Tool | Strengths | Weaknesses |
|---|---|---|
| **Datasette** | Read-only HTTP + web UI on any SQLite file. Plug-ins. Stable for ten years. The agent emits a SQLite file; Datasette becomes a ready-made BI surface. | Simple by design — limited dashboard composition. |
| **MotherDuck Dives** | React data apps over live MotherDuck queries; the agent generates one in seconds, anyone with the link sees real-time results, no login. Effectively *the v0/json-render pattern for warehouse data*. | Tied to MotherDuck (the cloud DuckDB product). |
| **Evidence.dev / Rill** | Markdown-driven BI over DuckDB. Agent-as-author writes Markdown + SQL, framework renders. Great for recurring reports. | Heavier setup than Datasette; presupposes Git workflow. |
| **Excel / xlsx via skill** | The artifact most non-dev enterprise users actually want. Claude Code's `xlsx` skill writes deterministic workbooks; DuckDB does the math, openpyxl writes the cells. Detailed in [`claude-code-excel-integration/`](../claude-code-excel-integration/README.md). | Excel is brittle for downstream re-use; treat as deliverable, not source. |
| **`json-render` JSON spec** | The Abhi/Vercel pattern. Agent emits a typed JSON spec; a fixed renderer produces shadcn dashboards. Detailed in [`ai-bi-json-render-pattern/`](../ai-bi-json-render-pattern/README.md). | Requires building a component catalog upfront. |

### Role 4 — Bridge to governed data

The most underused role. The data lives in Snowflake / BigQuery / Databricks / S3 Parquet / an Iceberg catalog, and you don't want to copy it. But you also don't want every agent task to round-trip to the warehouse for every aggregation.

| Pattern | What | When to use |
|---|---|---|
| **DuckDB attached to Iceberg / DuckLake** | DuckDB v1.5+ reads/writes Iceberg v2 tables, including the new DuckLake spec (May 2026) that gives you full lakehouse semantics with a SQL catalog. Agent queries the lake directly without Spark/Trino. | When data is too big to copy but governance lives in the table format, not a warehouse engine. |
| **DuckDB `httpfs` + Parquet on S3** | Direct query against `s3://bucket/data/*.parquet` with no prior load. | Ad-hoc analytics over warehouse exports or raw lake data. |
| **DuckDB UI + remote MotherDuck** | Local DuckDB attached to a MotherDuck cloud DB. Agent queries hybrid — local files + cloud tables in the same SQL. | When some data is local (this quarter's pull) and some is shared (the customer master). |
| **Anthropic `code_execution` + `sqlite3`/`duckdb` preinstalled** | Sandboxed Python kernel. No network state persistence, but you pass in a Parquet/SQLite file. | When the agent runs in API land, not in a CLI with shell access. |

This role is the bridge between the warehouse-agent architecture from [`enterprise-data-agents/`](../enterprise-data-agents/README.md) and the lite-DB picture here. Properly built, an enterprise agent uses both: it queries the warehouse for governed metrics, materialises the result as a Parquet, then runs ad-hoc lite-DB SQL against the materialised slice for whatever the user actually asked.

---

## 3. When does it make sense — and when doesn't it

A lite DB makes sense when *all four* of these are true:

1. **The data is bounded** — fits comfortably on one box (DuckDB scales smoothly to ~100 GB on a laptop, several TB on a beefy server, but the cliff exists).
2. **The work is task-scoped** — a single decision, a single report, a single question, not an ongoing concurrent operation.
3. **The audit trail is the SQL** — i.e. the human consumer would accept "here's the query" as the explanation.
4. **Either the data is already a flat file**, or **a one-time copy from the warehouse is acceptable** under whatever data-handling policy applies.

It *does not* make sense when:

| Condition | Why not | What instead |
|---|---|---|
| **Multiple agents/users need consistent state.** | Single-file SQLite/DuckDB has one writer. Last-writer-wins on shared files is a bug factory. | Postgres / a server DB. |
| **The data lives in a governed warehouse and bypassing it loses lineage.** | Copying to a local DuckDB strips the dbt model graph, the tag-based access controls, the metric definitions. The agent can produce confidently wrong numbers off a stale snapshot. | Query the warehouse via its native tooling; let the agent see the *semantic layer*, not the raw tables. ([`enterprise-data-agents/`](../enterprise-data-agents/README.md) covers this.) |
| **Live freshness matters.** | A CSV export is stale the moment it's written. Agents working on copies make decisions on yesterday's data. | A streaming or real-time path; a warehouse with frequent micro-batch loads; or accept staleness explicitly. |
| **Regulated data, locally sandboxed.** | PHI, PCI, MNPI, EU personal data — copying to a developer laptop is a leak even if the laptop is encrypted. | Query in place inside a controlled environment (warehouse with row-level security, or the agent runs in a SOC-2 sandbox with the data, not the laptop). |
| **Volumes don't fit.** | DuckDB will valiantly try and OOM around 5–10× its memory; chDB the same. | A real warehouse. |
| **The question isn't a SQL question.** | "Should we restructure the team?" is not answered by aggregation. | Don't reach for a DB at all. |
| **Cross-team workflow.** | A SQLite file emailed around is a fork bomb. | A shared system — Datasette, an internal Streamlit, a published Dive, a repo with a Parquet under DVC. |
| **High write contention.** | SQLite handles ~1 writer + many readers; DuckDB has improved concurrency but is still not built for hot-path OLTP. | Postgres. |

The single most common 2026 mistake: **using lite DBs to bypass warehouse governance "because the agent is faster that way"**. The agent *is* faster, and the answers are *worse* — different metric definitions, different filters, different snapshot times. The agent should be allowed to use lite DBs for *its own scratch work* and for *the last mile* of a task, but the canonical numbers should still come from where the canonical numbers live.

---

## 4. Concrete enterprise workflows

Five worked examples. Each has the same shape: messy multi-source input → lite DB normalisation → deterministic SQL → human-readable artifact. The agent does the orchestration; the DB does the math.

### 4.1 Finance / FP&A — duplicate-invoice detection in AP

**Problem.** AP team receives invoices from 1,200 vendors via email PDFs, EDI, supplier portals. Duplicates happen — same vendor invoices the same PO twice with slightly different references. Annual leakage is real (industry estimates: 0.05–0.5% of AP spend).

**Without an agent.** A controller writes a quarterly Excel formula across a CSV pull from NetSuite. Catches obvious cases, misses near-duplicates. Takes a half-day per quarter.

**With agent + DuckDB.** Agent receives "find duplicate invoices in the last 90 days". It:

1. Pulls the AP transactions Parquet from the warehouse via the warehouse MCP server (or runs the saved SQL).
2. Loads it into an in-process DuckDB.
3. Runs a layered detection query:
   ```sql
   SELECT vendor_id, amount, invoice_date,
          COUNT(*) AS hits,
          LIST(invoice_number) AS invoice_numbers
   FROM invoices
   WHERE invoice_date > current_date - INTERVAL 90 DAY
   GROUP BY vendor_id, amount, invoice_date
   HAVING hits > 1;
   ```
4. For near-duplicates, runs a second pass with `LEVENSHTEIN(invoice_number, ...)` and ±3 day windows.
5. Joins to the vendor master in the agent's persistent SQLite memory to filter known-duplicate-prone vendors (learned from past corrections).
6. Writes results to an Excel file via the `xlsx` skill, with three tabs: confirmed, suspected, near-misses.

**Why a lite DB.** The matching logic is plain SQL. The agent's value is the orchestration: pulling files, the human-language explanation per case, writing the deliverable. The math is trivially auditable. The vendor-master memory persists in SQLite so the agent learns from prior triage decisions.

**Why not the warehouse.** It can be done there too — but the audit trail of "agent X ran query Y at time T against export Z" is cleaner when the export is materialised and the SQL ran locally. NetSuite's own 2026.1 close agents are essentially this pattern, vertically integrated.

### 4.2 Marketing — cross-channel campaign rollup

**Problem.** A marketing manager runs paid ads across Meta, Google, TikTok, LinkedIn, plus organic email through HubSpot. Each platform exports a different CSV with different column names (`spend` vs `cost` vs `cost_usd`), different attribution windows, different campaign-naming conventions. Weekly question: "what's our blended CAC by channel?"

**Without an agent.** Analyst maintains a tab per source, a master tab joining them, a CAC formula. Breaks every time a platform changes export schema. Synter, Cometly, Improvado etc. all sell point solutions; not all teams have them.

**With agent + DuckDB.** Agent receives the six CSVs in a shared folder.

1. DuckDB reads each with `read_csv_auto`, returning the inferred schema.
2. Agent maps each schema to the canonical columns using a YAML map stored in its persistent memory (extended on each run as new platforms are added).
3. UNION ALL into a single `events` view.
4. Joins to a MQL / SQL / opportunity table from the CRM export to get attributable revenue.
5. Computes blended CAC, channel-split CAC, week-over-week deltas, anomaly callouts (column over column z-score).
6. Emits either a json-render JSON spec ([`ai-bi-json-render-pattern/`](../ai-bi-json-render-pattern/README.md)) or an Excel deliverable.

**Why a lite DB.** The schemas don't fit upstream. The data is genuinely flat-file. DuckDB's `read_csv_auto` plus the schema-mapping YAML is exactly the abstraction. Polars is a fine alternative; many marketing teams pair DuckDB for ingestion + Polars for transformation.

**Why not Excel.** Because the agent has to *normalise* before it can answer. Excel-only forces the analyst to babysit the schema-mapping every week. The lite DB makes the agent's job possible.

### 4.3 Sales / RevOps — pipeline hygiene audit

**Problem.** Salesforce data is messy: stages skipped, opportunities sitting in Discovery for 200 days, owners changed without history, close dates pushed silently. A weekly audit catches anomalies before forecast review.

**With agent + DuckDB.** Agent pulls the Salesforce opportunity table + opportunity history table.

```sql
WITH stage_transitions AS (
  SELECT opportunity_id,
         stage_to,
         stage_from,
         changed_at,
         LAG(changed_at) OVER w AS prev_changed_at
  FROM opportunity_history
  WINDOW w AS (PARTITION BY opportunity_id ORDER BY changed_at)
)
SELECT opportunity_id,
       stage_to,
       prev_changed_at,
       changed_at,
       changed_at - prev_changed_at AS days_in_stage
FROM stage_transitions
WHERE days_in_stage > INTERVAL '60 days'
   OR (stage_from = 'Discovery' AND stage_to = 'Closed Won');
```

Agent flags the suspicious cases, joins back to opportunity owner and rep tenure, and posts a Slack thread with one row per anomaly and a one-line explanation.

**Why a lite DB.** The window-function logic is tedious in Excel and slow over the wire to the CRM API. DuckDB does it in milliseconds against a flat export.

### 4.4 Internal audit — stratified sampling

**Problem.** Internal auditor needs a stratified sample of expense reports for a quarterly review: 50 reports, weighted by amount, stratified by department, with reproducibility (the auditor can re-run and get the same sample).

**With agent + DuckDB.**

```sql
WITH q1 AS (
  SELECT *
  FROM expense_reports
  WHERE submitted_at BETWEEN '2026-01-01' AND '2026-03-31'
)
SELECT *
FROM q1
USING SAMPLE 50 ROWS (reservoir, 42);  -- seed = 42 makes it reproducible
```

The CTE matters: in DuckDB `USING SAMPLE` runs before `WHERE`, so writing `FROM expense_reports USING SAMPLE 50 ROWS … WHERE submitted_at BETWEEN …` would sample 50 rows from the whole table and *then* filter, leaving fewer than 50 (and a biased fragment of) Q1 rows. Filter first, sample after.

For stratified, the agent generates one query per department with a per-stratum row count proportional to spend.

**Why a lite DB.** Reproducibility. The seed parameter and the query string together are the audit trail. Doing this in Python with `random.sample` works but loses the "the SQL is the documentation" property auditors care about.

### 4.5 Supplier scorecards — operations / supply chain

**Problem.** Procurement maintains scorecards for 400 suppliers: on-time delivery rate, defect rate, price variance, response SLA. Data lives in three systems (ERP, QMS, ticketing). Quarterly refresh.

**With agent + DuckDB.** Agent pulls quarterly exports as Parquet, loads them, runs a multi-source join into a `supplier_metrics` table, computes z-scores per metric, ranks suppliers, then for each supplier in the bottom decile *also* uses a vector search over recent QA ticket text (in `sqlite-vec`) to surface representative complaints. Output is a PowerPoint deck via the `pptx` skill, one slide per bottom-decile supplier.

**Why a lite DB plus vectors.** The numerical part is straight SQL across three sources. The qualitative part — "what are people actually complaining about" — needs vector search over the unstructured text. `sqlite-vec` lets the same SQLite file hold the supplier dimension table and the ticket embeddings, so the agent does both joins and similarity searches in one engine.

---

## 5. Integration patterns — how the agent actually talks to the DB

By 2026 there are three established surfaces. Pick based on how the agent runs.

### 5.1 Sandboxed code-execution tool (the dominant pattern)

The agent runs Python (and bash) in a sandbox with `duckdb`, `pandas`, `polars`, `sqlite3`, sometimes `lancedb` preinstalled. The agent writes code; the sandbox executes; results return as text.

- **Anthropic's `code_execution` tool** ([docs](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/code-execution-tool)) — the API-side path. No state between calls; pass files in.
- **Claude Code's Bash + Python** — local; persistent file system; agent can install more libs.
- **OpenAI Code Interpreter / GPT advanced data analysis** — same shape, different vendor.

This is the pattern most non-developer enterprise users encounter, because it ships inside the AI product they bought. The lite DB is invisible to them; they just see "the agent did the math".

### 5.2 MCP servers exposing a DB tool

The agent has a tool whose execution is "run this SQL against this database". Discoverable, schema-introspectable.

- **`mcp-server-sqlite`** (Anthropic reference) — read-only or read-write modes. Best for memory-store workflows.
- **`mcp-server-duckdb`** (community: `ktanaka101`, `mustafahasankhan`, others) — exposes a `query` tool against a duckdb file or ad-hoc files.
- **MotherDuck Remote MCP Server** (Dec 2025+) — `query` (read-only) and `query_rw` tools. >95% reported functional correctness on text-to-SQL when fed contextual schema. This is now the recommended path for cloud DuckDB.
- **DuckDB `acp` extension** — the inverse: DuckDB itself calls Claude Code or another ACP agent from inside SQL. Useful for "natural-language-as-UDF" patterns.

The downside of bare MCP is *context bloat*: dump the schema and you blow your context window before the agent has read the user's question. The empirical 2026 finding (Augment, Martin Fowler) is that **more context is not better** — agents do worse with bloated AGENTS.md / system prompts / dumped schemas. The fix is a curated *semantic layer* or *Skill* describing what the user actually cares about, not the raw `information_schema`.

### 5.3 Skills (procedural knowledge)

A Skill is a Markdown + scripts package the agent loads on demand. The Skill encodes *how* to use the DB for a specific class of task: "to compute blended CAC, here are the canonical column mappings; here is the SQL pattern; here is the seasonality adjustment; emit results as a json-render spec."

- **DuckDB Skills plugin** (`duckdb/duckdb-skills`) — official, in the Anthropic marketplace.
- **MotherDuck Agent Skills** — open-source catalog teaching agents schema exploration, DuckDB SQL, REST API, Dive building.
- **Custom company Skills** — every company that does this seriously builds its own. Skills hold the company's specific column conventions, fiscal calendar, vendor master, GL chart of accounts.

Skills + MCP + Code-Execution compose: a Skill explains the task, an MCP exposes the data, the code-execution sandbox runs the SQL. This is the convergent stack for non-dev enterprise workflows in 2026.

For background on the AGENTS.md / Skill / MCP ecosystem broadly, see [`ai-memory-systems/`](../ai-memory-systems/README.md) and [`cli-agent-harness-survey/`](../cli-agent-harness-survey/README.md).

---

## 6. Failure modes

Things that go wrong, in rough order of frequency.

**The agent produces a number that disagrees with the warehouse.** Almost always either (a) different filter (`WHERE deleted = false` missing), (b) different join cardinality (many-to-many that should be one-to-many), or (c) a stale export. Mitigation: always echo back the SQL and the row counts of the inputs; have the human spot-check; for recurring tasks, write an eval that compares lite-DB output to warehouse output for a known week.

**Schema bloat in context.** Agent dumps `DESCRIBE` for 200 tables and runs out of tokens before answering. Mitigation: a curated subset description in a Skill; or use the agent loop to *narrow* the schema by question first ("which tables are likely relevant?") before pulling full schemas.

**Single-writer corruption on shared SQLite.** Two agents running in parallel try to write to the same SQLite memory file; one truncates the other's work. Mitigation: WAL mode, fail-fast on write conflicts, or one-file-per-agent with periodic merge — the [`memory-architectures-2026/`](../memory-architectures-2026/README.md) write-path discussion is directly applicable.

**Silent CSV schema drift.** The marketing CSV from Meta gains a column; `read_csv_auto` shifts inferences; the join breaks silently. Mitigation: pin schemas (`columns={...}` argument); checksum the schema and alert on changes.

**The agent treats the lite DB as the system of record.** Three months later someone is making decisions off a SQLite file in someone's `~/Documents`. Mitigation: explicit lifecycle — ephemeral DBs deleted at task end; persistent memory DBs version-controlled (git) or backed up; *no* business-critical data is ever sole-sourced from a single agent's local file.

**Regulatory / data-handling violation.** Agent copies PHI to a developer laptop because that was the path of least resistance. Mitigation: data-classification gate before the agent is allowed to call the warehouse extract tool; sandboxed agents that never see local files for regulated data; SOC-2-style controls on whichever environment the agent runs in.

**Vector recall over a stale embedding.** Agent searches sqlite-vec for "supplier complaints" and gets last quarter's hits because the embedding store wasn't refreshed. Mitigation: tie vector writes to the source table's `updated_at`; periodic re-embedding on schedule.

**LLM-extracted facts contaminating the memory store.** The two-step extract-and-update pattern is helpful but not perfect; bad extractions get stored, then retrieved, then act as truth. Mitigation: provenance columns (where did this fact come from, when, with what model); confidence thresholds; human review of high-stakes memory ([`memory-architectures-2026/`](../memory-architectures-2026/README.md) covers this in depth).

---

## 7. Sources

### DuckDB ecosystem
- [DuckDB v1.5.2 release notes (Apr 2026)](https://duckdb.org/2026/04/13/announcing-duckdb-152)
- [DuckLake 1.0: Data Lake Format with SQL Catalog Metadata (InfoQ, May 2026)](https://www.infoq.com/news/2026/05/ducklake-sql-catalog/)
- [Iceberg in the Browser via DuckDB-Wasm (Dec 2025)](https://duckdb.org/2025/12/16/iceberg-in-the-browser)
- [Writes in DuckDB-Iceberg](https://duckdb.org/2025/11/28/iceberg-writes-in-duckdb)
- [DuckDB Skills plugin (`duckdb/duckdb-skills`)](https://github.com/duckdb/duckdb-skills)
- [DuckDB ACP community extension](https://duckdb.org/community_extensions/extensions/acp) and [`sidequery/duckdb-acp`](https://github.com/sidequery/duckdb-acp)
- [DuckDB Ecosystem Newsletter, March 2026](https://motherduck.com/blog/duckdb-ecosystem-newsletter-march-2026/)

### MotherDuck (cloud DuckDB) and analytics agents
- [Best Analytics Database for LLM & AI Agents — MotherDuck 2026 guide](https://motherduck.com/learn/best-analytics-db-llm-ai-agents/)
- [Custom AI Agent Builder's Guide — MotherDuck Docs](https://motherduck.com/docs/key-tasks/ai-and-motherduck/building-analytics-agents/)
- [Using the MotherDuck MCP Server](https://motherduck.com/docs/key-tasks/ai-and-motherduck/mcp-workflows/)
- [MCP + DuckDB: Connect AI Assistants to Your Data Pipelines](https://motherduck.com/blog/faster-data-pipelines-with-mcp-duckdb-ai/)
- [Shareable AI-Built Data Visualizations — Dives](https://motherduck.com/videos/ai-agent-shareable-visualizations/)
- [From MCP to Agent Skills — MotherDuck blog](https://motherduck.com/blog/motherduck-agent-skills/)
- [Build a LangChain SQL Agent with DuckDB and MotherDuck](https://motherduck.com/blog/langchain-sql-agent-duckdb-motherduck/)
- [`motherduckdb/analytics-agent-duckdb-workshop`](https://github.com/motherduckdb/analytics-agent-duckdb-workshop)

### MCP servers (community)
- [`ktanaka101/mcp-server-duckdb`](https://github.com/ktanaka101/mcp-server-duckdb)
- [`mustafahasankhan/duckdb-mcp-server`](https://github.com/mustafahasankhan/duckdb-mcp-server)
- [`boettiger-lab/mcp-server-duckdb`](https://github.com/boettiger-lab/mcp-server-duckdb)

### sqlite-vec and the embedded-vector neighbourhood
- [`asg017/sqlite-vec`](https://github.com/asg017/sqlite-vec) and [release history](https://github.com/asg017/sqlite-vec/releases)
- [SQLite-Vector by SQLiteAI](https://www.sqlite.ai/sqlite-vector) and [`sqliteai/sqlite-vector`](https://github.com/sqliteai/sqlite-vector)
- [LangChain SQLiteVec integration](https://docs.langchain.com/oss/python/integrations/vectorstores/sqlitevec)
- [Hybrid Local Memory in OpenClaw — BM25 + sqlite-vec example](https://www.clawsetup.co.uk/articles/hybrid-local-memory-openclaw-bm25-vectors-sqlite-vec-local-embeddings/)
- [Zvec — SQLite-style vector DB from Alibaba Tongyi (Feb 2026)](https://codemaker2016.medium.com/zvec-reimagining-vector-databases-with-sqlite-style-simplicity-e76b247b6555)

### PGlite
- [`electric-sql/pglite`](https://github.com/electric-sql/pglite) and [PGlite docs](https://pglite.dev/)
- [Announcing PGlite v0.4 (Mar 2026)](https://electric.ax/blog/2026/03/25/announcing-pglite-v04)

### Anthropic / Claude tooling
- [Code execution tool — Claude API Docs](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/code-execution-tool)
- [Claude Code Excel integration](../claude-code-excel-integration/README.md) (this repo)

### Industry adoption signals
- [NetSuite 2026.1 — AI Close, Cash Management, agents for EPM](https://www.netsuite.com/portal/resource/articles/financial-management/netsuite-2026-1-features-new-ai-close-and-cash-management-ai-agents-for-enterprise-performance-management-and-more.shtml)
- [Workday — AI Agents in Finance: Top Use Cases](https://blog.workday.com/en-us/ai-agents-finance-top-use-cases-and-examples.html)
- [ChatFin — Building AI Agents for Reconciliations](https://chatfin.ai/blog/step-by-step-guide-building-ai-agents-for-reconciliations/)
- [11 Best AI Agents for Finance Teams in 2026 — lunos.ai](https://www.lunos.ai/blog/ai-agents-for-finance-teams)
- [SAS Viya embeds DuckDB in governed workflows (Apr 2026)](https://www.sas.com/en_us/news/press-releases/2026/april/innovate-data-management-ai-agents.html)
- [Synter — cross-channel marketing automation 2026](https://syntermedia.ai/blog/cross-channel-marketing-automation)
- [Improvado — Cross-Channel Analytics Guide](https://improvado.io/blog/cross-channel-marketing-analytics)

### Context engineering and agent design
- [Martin Fowler — Context Engineering for Coding Agents](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html)
- [Augment — How to Build Your AGENTS.md (2026)](https://www.augmentcode.com/guides/how-to-build-agents-md)
- [Building a better data agent benchmark — dbt blog](https://docs.getdbt.com/blog/building-a-better-data-agent-benchmark)
- [Data Engineering in 2026 — Ben Lorica](https://gradientflow.substack.com/p/data-engineering-for-machine-users)
- [AgentDB — ephemeral agent DBs as a product](https://agentdb.dev/)

### Adjacent prior threads in this repo
- [`enterprise-data-agents/`](../enterprise-data-agents/README.md)
- [`ai-bi-json-render-pattern/`](../ai-bi-json-render-pattern/README.md)
- [`claude-code-excel-integration/`](../claude-code-excel-integration/README.md)
- [`ai-memory-systems/`](../ai-memory-systems/README.md)
- [`memory-architectures-2026/`](../memory-architectures-2026/README.md)
- [`standalone-memory-tools-survey-2026/`](../standalone-memory-tools-survey-2026/README.md)
- [`rag-domain-knowledge-strategies/`](../rag-domain-knowledge-strategies/README.md)
- [`cli-agent-harness-survey/`](../cli-agent-harness-survey/README.md)

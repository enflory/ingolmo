# Notes — lite-db-ai-agents

## Brief

Research lite database solutions tied to making AI agents more effective. SQLite, DuckDB, and similar. Focus: **non-software-development enterprise use cases** (finance, marketing, etc.). When do AI systems benefit from lightweight storage/query? When does it not make sense? Tool landscape. Real business workflow examples.

## Adjacent prior work in this repo

- `enterprise-data-agents/` — OpenAI/Ramp internal data agents. Warehouse-scale text-to-SQL + context layer. **Sets the contrast**: that's the heavy-warehouse pattern; this thread is the *lite* end.
- `ai-bi-json-render-pattern/` — Abhi Sivasailam pattern: agent emits JSON spec for governed BI. Same principle (governed primitives + LLM as composer) applies to lite-DB workflows.
- `claude-code-excel-integration/` — finance-specific. xlsx skill. Excel as artifact. Lite DBs are the natural compute substrate that Claude Code uses *inside* the analysis tool when an Excel sheet is too gnarly.
- `ai-memory-systems/`, `memory-architectures-2026/`, `standalone-memory-tools-survey-2026/` — adjacent: SQLite shows up here as a memory substrate (Anthropic memory tool, Basic Memory). I'll keep memory side-trip light and focus on analytical use.
- `rag-domain-knowledge-strategies/` — relevant for embedded vector DBs (LanceDB, sqlite-vec, Chroma) that share the "lite" niche.

So the new contribution: the **analytical lite-DB surface** specifically, **for non-developer enterprise workflows**, with the *agent* as the operator. The other threads cover memory, BI, and warehouse agents.

## Working frame

Three reasons an agent benefits from a lite DB:
1. **Token economy** — SQL aggregation reduces context fed back to the model.
2. **Determinism** — math should not be done by the LLM. SQL is reproducible.
3. **Auditability** — the SQL is the proof of work. Inspectable artifact.

Plus operational: privacy (no warehouse copy), speed (no round-trip), zero infra (single file/binary), works offline.

## Tool landscape draft

### Analytical (OLAP) embedded
- **DuckDB** — the king of this niche. Single binary, columnar, native Parquet/CSV/JSON, S3 reads, in-process, multi-platform. 2025 saw v1.0; by 2026 standard everywhere agentic data work happens. MotherDuck = managed cloud sibling.
- **chDB** — embedded ClickHouse. Slower startup, broader feature set, niche. Not the default choice unless you are already a CH shop.
- **Polars** — not a DB; a dataframe library with SQL frontend. Often used interchangeably; persistence story is "save Parquet". Very common as an agent's compute substrate alongside DuckDB.
- **Apache DataFusion** — Rust-native query engine, embedded in many products (LanceDB, InfluxDB 3, Comet). Building block more than UX surface.

### Transactional (OLTP) embedded
- **SQLite** — universal. Good for fact stores, logs, agent memory. Has FTS5, JSON1, geopoly, and via extensions vector (sqlite-vec).
- **libSQL / Turso** — SQLite fork with embedded replicas, server mode, vector built-in. The "SQLite for distributed systems" play.
- **DuckDB-WASM / SQLite-WASM** — browser-side. Datasette Lite, Observable, Hex, etc.
- **PGlite** — embedded Postgres in WASM. Newer; the "real Postgres in your laptop / browser" story. By 2026 increasingly used as agent state for richer semantics.

### Embedded vector
- **LanceDB** — embedded, columnar (Lance format), vector + filters, decent at hybrid search. The 2026 default embedded vector DB.
- **Chroma** — older, simpler, lots of legacy use. Now has its own DistributedChroma but local mode is still common.
- **sqlite-vec** — extension to SQLite. Great when you already have SQLite for relational data and want to bolt vectors on without a new system.
- **pgvector / pgvecto.rs** (with PGlite) — for an embedded Postgres world.

### Embedded graph
- **KuzuDB** — embedded property graph. Cypher dialect. Good fit for memory/knowledge-graph workloads inside an agent runtime. Used by Cognee.
- **Memgraph / Neo4j Aura Free** — not embedded but lightweight to start.

### Publishing / agent surface layers
- **Datasette** — read-only API + web UI on top of any SQLite file. Plug-ins. Agent-friendly: an agent can "publish" a finished analysis to Datasette and the human navigates it.
- **DuckDB UI** — added 2025 (browser-based query interface for DuckDB instances).
- **Evidence.dev / Rill** — markdown-driven BI over DuckDB. Similar agent-as-author pattern.

### MCP exposure
- `mcp-server-sqlite` — Anthropic reference; read-write or read-only modes.
- `duckdb-mcp` (community) — exec SQL against a duckdb file or s3 paths.
- `chroma-mcp`, `lancedb-mcp`, `qdrant-mcp` — vector side.
- `motherduck-mcp` — official MotherDuck MCP for cloud DuckDB.
- More relevantly: **sandboxed code interpreter** is the dominant pattern. Claude Code's Bash + Python skill, ChatGPT's code interpreter, Anthropic API "code execution tool" — all run a Python kernel that has DuckDB/Polars/SQLite preinstalled. Agent picks the substrate.

## Use-case brainstorm (to flesh out in README)

### Finance / FP&A
- AP duplicate-invoice detection
- Vendor concentration / spend rollup across BUs
- Monthly close reconciliation (subledger ⇄ GL)
- Variance analysis budget vs actual, with explanations
- Audit sampling — stratified, deterministic
- Foreign-exchange exposure rollup
- Stripe / NetSuite / Salesforce CSV → cohort revenue
- Board pack data prep
- 13-week cash flow build from ERP exports

### Marketing
- Campaign rollup across Meta/Google/TikTok/HubSpot CSVs
- Attribution sandbox modelling
- ICP scoring against CRM export
- List dedup / suppression list build
- Brand-search keyword analysis
- Email send-time cohorting

### Sales / RevOps
- Pipeline hygiene audits
- Stuck-stage anomaly detection
- Territory-planning sims
- Quota attainment cohort

### HR / People
- Comp-band analysis
- Attrition cohort
- Headcount roll-up across HRIS exports

### Operations / Supply chain
- SKU inventory anomaly
- Transfer-order recommendations
- Supplier scorecards

### Legal / Compliance
- Contract DB queries (with vector + relational hybrid)
- Due-diligence Parquet review
- Audit log searches

### Customer support
- Ticket trend analysis
- SLA breach root cause

## When NOT to use lite DB

- Source of truth for ops — concurrent writers, transactions, durability requirements.
- Already in a governed warehouse — bypassing Snowflake/BigQuery loses lineage and metric definitions.
- Multi-user / shared state — single-file → no shared state, last-writer-wins.
- Live freshness — by the time CSV exported, data is stale.
- Regulated data outside controlled environments — copying to local SQLite is data leak.
- Volumes that won't fit on one node — DuckDB scales to ~100GB on a laptop, ~few TB on a beefy box, but not arbitrary.
- Qualitative judgment questions — "should we restructure the team" is not a SQL question.
- Cross-team workflow — needs a hub, not a file.

## Things worth verifying via web (2026 status)

- DuckDB latest version + new features (UI, encryption, Iceberg)
- chDB current state
- sqlite-vec / sqlite-vss merge story
- LanceDB recent changes
- Anthropic code execution tool / "code interpreter" docs
- MotherDuck MCP
- A current adoption story (Ramp, OpenAI, anyone) using DuckDB or SQLite as agent substrate

Doing those next.


## Web research log

### DuckDB current state (2026)
- v1.5.2 released April 2026 (https://duckdb.org/2026/04/13/announcing-duckdb-152)
- DuckLake 1.0 (May 2026, InfoQ) — production-ready lakehouse spec with SQL catalog metadata, data inlining, sorted tables, deletion buffers as Iceberg-compatible Puffin files. Means you can run a "lakehouse" off DuckDB with no Spark/Trino.
- DuckDB-Iceberg full DML (INSERT/UPDATE/DELETE) for Iceberg v2 tables.
- DuckDB-Wasm + Iceberg in Browser (Dec 2025): first end-to-end Iceberg REST Catalog interface in a browser tab.
- Official **DuckDB Skills plugin** (`duckdb/duckdb-skills`) shipping in Anthropic marketplace — auto-discoverable in Claude Code via `/plugin`. Adds skills for: SQL queries (raw or NL) against attached DBs or ad-hoc files; reading/exploring CSV/JSON/Parquet/Avro/Excel/spatial/SQLite/etc.; remote storage too.
- DuckDB **`acp` community extension** — flips it: DuckDB can *call Claude Code or other ACP agents* from inside SQL. The agent becomes a DuckDB UDF.

### MotherDuck (managed cloud DuckDB)
- Remote MCP Server reports >95% functional correctness on text-to-SQL when fed contextual schema + run via Claude/Gemini/ChatGPT (https://motherduck.com/learn/best-analytics-db-llm-ai-agents/).
- Two MCP query tools: `query` (read-only) and `query_rw`.
- **Dives**: agent-built shareable React data apps over live MotherDuck queries. Stays live, no login required. Functions like the Abhi v0 / json-render pattern (from `ai-bi-json-render-pattern`) but at warehouse-data scale and integrated.
- **MotherDuck Agent Skills**: open-source catalog of Skills (NB: limitation today — no authenticated registry / org-scoped publishing for private skill sharing).
- MotherDuck workshop: `motherduckdb/analytics-agent-duckdb-workshop` — "engineering reliable analytics agents from scratch with DuckDB, MCP and a semantic layer." Confirms the same convergent architecture from `enterprise-data-agents/` applies at the lite end.

### sqlite-vec
- Asg017's sqlite-vec is the de-facto extension. Successor to sqlite-vss. KNN, multiple distance metrics, SIMD, dependency-free. Ships in OpenClaw, LangChain, etc.
- Alternative new entrant: SQLiteAI's sqlite-vector (cross-platform, similar idea).
- Pattern: store conversation/document chunks in SQLite + embeddings in vec0 virtual table → one file holds both relational metadata and vectors.
- Note Alibaba Tongyi's **Zvec** ("SQLite of vector databases") emerging Feb 2026 — embedded, in-process, edge-focused.

### Anthropic code execution tool
- Official tool: `code_execution` (anthropic docs) — sandboxed bash + Python, file ops, no state persistence between calls. The Python kernel has DuckDB/Pandas/Polars/sqlite3 available. **This is the primary surface where lite-DB-for-agent actually gets used in API land.**
- Different from Claude Code (which has direct shell + Python via Bash). But same shape: agent runs SQL or DataFrame code in a sandbox, returns aggregated results to context.

### PGlite
- v0.4 (March 2026): PostGIS, connection multiplexing, decoupled `initdb` from main WASM. ~3MB gzipped.
- Extensions: pgvector, pg_uuidv7, pgTAP, pg_hashids, Apache AGE (graph!).
- Roadmap: libpglite — native bindings for mobile / desktop / React Native.
- Agent angle: persistence to filesystem (Node/Bun) or IndexedDB (browser). Useful when you need *real* Postgres semantics (CTEs, window funcs at full strength, JSON ops, GIS) without server.

### AgentDB — the new product category
- agentdb.dev — vendor explicitly marketing "ephemeral SQLite/DuckDB per agent task." Calls out that 80% of new databases on Databricks are launched by AI agents (vendor claim).
- Architecture: agents spin up scratch DBs, do work, discard. "Database as a function call."
- Databricks claim is striking enough I'd flag it but not anchor on it without a primary source. The shape of the trend is right regardless.

### Context-engineering finding (relevant to AGENTS.md / skills)
- Empirical finding (martinfowler.com/Augment): context-file bloat reduces task success. Place critical rules early. Start fresh sessions for new tasks. Trade-off applies to agent system prompts that describe DB schemas — *more is not better*. This argues for a *semantic layer / curated skill* rather than dumping the whole information_schema into context.

### Real-world business workflow signals
- NetSuite 2026.1 ships AI close + reconciliation agents with bank-transaction matching using generative AI for richer extraction. Inside a closed product, but the pattern is "lite-DB + agent" at heart.
- DataCamp / Improvado / Synter / Cometly / Madgicx: marketing-side agentic platforms over multi-channel ad data, often DuckDB-backed.
- ChatFin guide on building reconciliation agents — CSV ingest → matching rules → exception triage. SQL substrate is where the matching happens.
- SAS Viya now embeds DuckDB in governed workflows — important: DuckDB has crossed into "approved-by-IT" territory.

## Synthesis points for README

1. **The thesis**: a lite DB is *the right substrate for an agent's working analytical scratchpad*. Three forces converge — token economy, determinism, auditability. Plus operational: privacy, speed, zero infra.

2. **The taxonomy is not "which DB" — it's "what role does the DB play":**
   - **Ephemeral analytical scratchpad** (DuckDB, Polars). Agent spins up, does work, discards.
   - **Persistent semantic memory** (SQLite + sqlite-vec, PGlite + pgvector). Long-lived agent state.
   - **Read-only published artifact** (Datasette, MotherDuck Dives, json-render dashboards). Result of an agent run.
   - **Source-of-truth bridge** (DuckDB attached to Iceberg/DuckLake; SQLite attached over S3). Lite engine, governed data.

3. **Decision rule**: lite DB belongs in the *task* layer, not the *system of record* layer. The minute multiple agents/users need to see consistent state, you're back to a server DB.

4. **Cross-reference with `enterprise-data-agents/`**: warehouses are still the canonical reasoning ground for company-wide analytics. Lite DB shines for (a) tasks that don't need warehouse data, (b) the agent's local reasoning, (c) "last mile" between warehouse query and human deliverable.

5. **Cross-reference with `ai-bi-json-render-pattern/`**: lite DB upstream → governed component spec downstream is a clean composition. Agent runs DuckDB → agent emits json-render JSON → human consumes.

6. **Cross-reference with `claude-code-excel-integration/`**: when Excel is the user-facing artifact, DuckDB is increasingly the compute layer behind it. The Claude Code analysis flow already uses pandas/DuckDB to produce inputs that the xlsx skill writes.

OK — ready to draft README.

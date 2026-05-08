# Notes — turso-deep-dive

## Brief

Deep research on **Turso** — https://turso.tech/ — pitched as a "SQLite alternative database for agents". Goal: understand what Turso actually is in 2026, what makes it relevant to AI agents specifically, where it fits relative to vanilla SQLite / DuckDB / D1 / SQLite Cloud / Neon, and the failure modes.

## Adjacent prior work in this repo

- [`lite-db-ai-agents/`](../lite-db-ai-agents/README.md) — the parent thread. Mentions libSQL/Turso once as "SQLite fork with embedded replicas, server mode, native vector". This thread goes deep on that one row.
- [`ai-memory-systems/`](../ai-memory-systems/README.md), [`memory-architectures-2026/`](../memory-architectures-2026/README.md), [`standalone-memory-tools-survey-2026/`](../standalone-memory-tools-survey-2026/README.md) — SQLite/libSQL-as-memory shows up there. I'll touch the memory angle but not duplicate.
- [`enterprise-data-agents/`](../enterprise-data-agents/README.md) — the warehouse end. Sets the contrast for "per-agent / per-tenant database" thinking.

## Working frame — what to figure out

1. **What is Turso today?** Company, product surface, hosted vs OSS.
2. **libSQL → Turso Database (Rust) rewrite.** Why the rewrite. Status. What changed.
3. **The "for agents" claim.** What's actually agent-specific vs marketing reframing.
4. **Architecture.** Embedded replicas, sync, multi-tenancy ("database per X"), branching, vector.
5. **Pricing / limits / operational story.**
6. **Comparisons.** Vanilla SQLite, Cloudflare D1, SQLite Cloud, Neon, PlanetScale, AgentDB.
7. **Failure modes / when not to use.**

## Plan

- Fetch turso.tech and key docs.
- Search for 2025–2026 announcements (the Rust rewrite, agent-DB pivot).
- Pull comparisons / benchmarks from independent sources.
- Sanity-check against the GitHub repo state.

---

## Log

### Session 1 — first pass

**WebFetch on turso.tech 403s** (Cloudflare bot protection). Pivot to WebSearch (which extracts blog content) for *.turso.tech URLs and WebFetch for third-party sources. Will rely on multiple independent sources to cross-check.

**Big confusion clarified — three things called "Turso"**:

1. **Turso (the company)** — Glauber Costa CEO, Pekka Enberg cofounder.
2. **libSQL** — the C fork of SQLite that Turso started. Adds embedded replicas, HTTP server, native vector (DiskANN), WASM UDFs. Last release Feb 2025 (libsql-server-v0.24.32). Production-ready. Powers today's Turso Cloud.
3. **Turso (the database)** — Rust rewrite of SQLite, formerly **Limbo** (Pekka's side project). Renamed to Turso when Limbo was made official, ~Dec 2024. In **beta** — not production-ready. **Replaces libSQL as the company's intended direction**. github.com/tursodatabase/turso.

Penberg quote (Pekka Enberg, X): "Turso is a new SQLite-compatible database, rewritten from scratch in Rust, currently in beta. libSQL is our open-source fork of SQLite, which powers Turso Cloud."

Timeline:
- ~2023: libSQL fork
- 2024: Pekka starts Limbo on personal GitHub
- Aug 2024: libSQL server gets a TigerBeetle-style DST architecture rewrite, diskless on S3
- Dec 2024: Limbo made official, renamed Turso (eventually)
- Mar 17, 2025: Turso Cloud on AWS GA
- Apr 2026: "Next-gen" Turso Cloud private beta — Rust Turso in cloud, agent-positioned
- May 2026: unlimited active databases for all paid plans

### Architecture

- **Embedded replicas** — local SQLite file replicates from remote primary. Reads served locally (zero-network); writes go to primary, sync back. Originally a `sync()` call; in new Turso replaced by async `push()`/`pull()` using CDC-based logical changes (faster, smaller deltas).
- **Diskless cloud** — Turso Cloud (libSQL flavour) runs on S3-Express One Zone + S3. Compute nodes are stateless/Kubernetes-friendly. Pro/Enterprise can BYO S3 bucket.
- **MVCC + BEGIN CONCURRENT** — only in Rust Turso. Defeats SQLite's single-writer bottleneck. Targets "thousands of concurrent writes/sec".
- **Async I/O** — io_uring on Linux. Native to Rust rewrite; libSQL is sync.
- **Vector** — `F32_BLOB(N)` column type. `vector_top_k()`, `vector_distance_cos()`. DiskANN ANN index in libSQL. Rust Turso has exact vector ops; ANN indexing still on roadmap.
- **CDC** — change-data-capture in Rust Turso, real-time stream of logical changes.
- **WASM** — Rust Turso has browser/WASM support out of the box. libSQL has WASM UDFs.

### Agent positioning — what's the actual claim?

The "for agents" framing is everywhere on Turso's 2026 marketing:
- "fast, isolated, ready to scale from one agent to a thousand and beyond"
- "100 agents = 100 independent units of work, each needing their own durable, isolated, local state"
- "every agent, user, or tenant gets their own database"
- "Turso databases are files, not processes: always on, instantly available, no cold start, no wake-up penalty"

So the agent angle is really **database-per-X** (per-agent, per-user, per-tenant) reframed for the agent era. Same multi-tenant story they told for SaaS in 2024, now applied to agent fleets.

What's *actually* different vs vanilla SQLite for agents:
1. **No process per DB** — many DBs, one server. 100k DBs viable.
2. **No cold start** — file-based, instantly mounted.
3. **Branching/forking** (file copy) — natural for agent sandboxing.
4. **Sync** — agent's local replica syncs to cloud for durability.
5. **Vector + relational in one file** — agent memory needs both.
6. **Per-DB encryption** — native encryption added recently to Turso Cloud.

### AgentFS

Separate Turso project: github.com/tursodatabase/agentfs. SDK (TS, Python, Rust) that gives an agent three primitives in one SQLite/Turso file:
- POSIX-like filesystem (`writeFile`, `readdir`)
- Key-value (`kv.set`/`kv.get`)
- Tool-call audit log (`tools.record(name, t0, t1, args, result)`)

Penberg has a blog post "Towards a Disaggregated Agent Filesystem on Object Storage" — extends AgentFS to S3 backend. Worth fetching.

### Agent-framework integrations

- **Mastra** — uses LibSQL as default storage; `LibSQLVector` for vectors.
- **VoltAgent** — `LibSQLStorage` provider.
- **Mem0** — independent memory product, can use SQLite/libSQL backend.
- **Letta** (formerly MemGPT) — adjacent, separate runtime.

### Pricing (May 2026)

- **Free**: 5GB storage, 500M row reads/month, unlimited DBs (post-May-2026), 100 monthly active DBs
- **Hobby**: $9/mo (or **Developer** $4.99/mo per one source — likely a renaming or A/B; need to confirm)
- **Scaler**: $24.92/mo, 24GB, 2.5k monthly active
- **Pro**: $416.58/mo, 50GB, 10k monthly active
- **Enterprise**: custom

Note the unit "monthly active databases" — they bill by DB count *that saw traffic this month*, not total inert DBs. That's the multi-tenant pricing innovation.

### Comparisons

| | Turso (libSQL/Rust) | Cloudflare D1 | SQLite Cloud | Neon |
|---|---|---|---|---|
| Engine | SQLite-compatible | SQLite | SQLite | Postgres |
| Edge | Embedded replicas global | Edge-native (Workers) | Replicas | Branching, scale-to-zero |
| Latency (read) | ~0.02ms (local replica) | ~0.5ms (Worker) | similar | 3–10ms |
| Multi-tenancy | DB-per-tenant native | DB-per-tenant possible | similar | Branching, not DB-per |
| Vector | Native (DiskANN) | Vectorize (separate) | sqlite-vec compatible | pgvector |
| Free tier | 5GB, 500M reads | 5GB, 25M reads | 1GB | 0.5GB |
| Lock-in | Cross-cloud, BYO S3 | Cloudflare-only | SQLite-compatible | Postgres-compatible |

Turso's unique-to-them axis: **local-first via embedded replicas** + **DB-per-X at scale**. D1 is edge-native but Cloudflare-bound. Neon is the right answer if you want Postgres semantics.

### Open questions for the report

- How does the new (Rust) Turso Cloud actually expose DBs to clients — same HTTP/wire protocol as libSQL? Per the announcement: "query over the wire as you would any database server". Need to check the docs.
- MCP server for Turso? There's likely a community one. Search.
- What does "branching" look like in Turso? Is it real (CoW) or just a copy?
- How well does the agent-positioning hold up vs the alternative pattern (one Postgres + a `tenant_id` column)?

### Session 2 — closing the loop

**Branching = metadata-only CoW.** Per Turso docs: "generations belonging to a database become shared between databases including the WAL fragments. This is a metadata-only operation, and no data copying occurs. That means that branching is instantaneous." Same family as Neon's branching but for SQLite. New writes diverge into new generations. Supports point-in-time-restore from snapshots.

**MCP servers exist:**
- **Official**: `--mcp` flag on Turso CLI turns the local DB into an MCP tool ("Introducing the Turso Database MCP" blog post). Cleanest local-dev shape.
- **Community**: `nbbaier/mcp-turso` (cloud libSQL), `spences10/mcp-turso-cloud` (org-level + DB-level two-tier auth — useful for fleet management).

**Offline writes / sync semantics.** Public beta in 2025. Default is **Last-Push-Wins** row-level conflict resolution; planned strategies are `DISCARD_LOCAL`, `REBASE_LOCAL`, and a custom transform hook. Conflict detection in the public beta but resolution still WIP. This is the local-first piece of the agent story for mobile/desktop.

**Native encryption (BYOK).** Late-2025 / 2026: Turso Cloud added BYOK — every query/sync encrypted with a customer key. Distinct keys per tenant possible. This is what makes "DB-per-end-user" actually defensible for regulated data.

**Adaptive Computer reference.** The headline customer for the agent story:
- AC1 — natural-language-to-app builder.
- ~40k DBs in alpha → **2 million+ DBs in production**.
- Each agent action = a new branched DB. Validate, merge, or roll back.
- Cited in Turso's marketing as the existence proof for "DB-per-agent-action at scale".

**Massive-multitenant architecture (separate blog post).** Turso has a "deep look into our new massive multitenant architecture" post — diskless S3 + S3-Express + a multi-tenant control plane that amortises costs. The economic precondition for "unlimited DBs" pricing.

### Synthesis — what is this actually about

If I had to pick one sentence for the report: **Turso is the bet that the natural granularity of agent state is "one SQLite file per agent or per task", and that the operational obstacle to that pattern (you can't have a million SQLite files in a million processes) is solved by (a) a multi-tenant cloud where files are cheap because they live on S3, and (b) a Rust rewrite that gives each file MVCC, async I/O, and concurrent writes.** Everything else — vector, embedded replicas, branching, AgentFS, the MCP server — is *consequences* of that bet.

The interesting question for an enterprise practitioner isn't "is Turso fast" (it is). It's "do I actually want a database per agent?" — vs. one shared DB with `agent_id` columns, vs. an in-process SQLite per agent in a sandbox VM. Turso wins when:
- Agent state needs to *outlive the sandbox* (durability).
- Branching/rollback semantics matter (PR-style agent loops, code-modifying agents).
- You want global low-latency access from a UI without warehouse infra.
- Per-tenant isolation is a regulatory/security requirement.

It loses when:
- You're already on Cloudflare → D1.
- You want Postgres semantics → Neon.
- The data is genuinely OLAP and the agent's job is aggregation → DuckDB.
- The agent needs zero infra and zero cloud → vanilla SQLite in the sandbox is fine.

Ready to write the README.

# Turso — a deep dive

*Researched May 2026. Audience: someone evaluating whether Turso belongs in an AI-agent stack, and trying to cut through three things called "Turso" plus a lot of "for agents" marketing.*

This thread builds on [`lite-db-ai-agents/`](../lite-db-ai-agents/README.md), where Turso appeared as a single row in a comparison table. This is the deep version of that row.

---

## TL;DR

1. **There are three things called "Turso", and conflating them wastes time.** *Turso* the company. *libSQL*, the company's open-source C fork of SQLite (production-ready, powers Turso Cloud today, last release Feb 2025 — effectively in maintenance). *Turso* the database, formerly **Limbo** — a from-scratch Rust rewrite of SQLite that is in **beta**, not production-ready, and is the company's stated future direction.
2. **Turso's core bet is "one SQLite file per agent / per user / per tenant" at million-DB scale.** The "database for AI agents" positioning is really database-per-X reframed for the agent era. The operational wall in vanilla SQLite — you can't run a million files in a million processes — is what Turso's diskless S3-backed multi-tenant cloud is built to remove.
3. **The Rust rewrite matters because it removes SQLite's single-writer bottleneck** via MVCC + `BEGIN CONCURRENT`, adds async I/O via `io_uring`, ships native vector and CDC, and runs in WASM. None of these are exotic individually; together they make per-agent SQLite a real production substrate, not a toy.
4. **The unique-to-Turso feature is embedded replicas.** A local SQLite file syncs from a remote primary; reads are local (~0.02 ms), writes go to primary and propagate. Combined with branching (metadata-only CoW) and offline writes (last-push-wins by default), this is the local-first / agent-local-state story that nothing else in the SQLite-as-a-service space matches end-to-end.
5. **The reference customer is real, not vapourware.** Adaptive Computer's AC1 ran ~40k DBs in alpha and is now past **2 million** databases on Turso, one ephemeral DB per agent action, branched on every change, rolled back on mistakes. That's the existence proof for the agent-DB-per-task pattern.
6. **It loses when** you're already on Cloudflare (D1 is closer), need Postgres semantics (Neon), are doing OLAP (DuckDB), or your agent is short-lived and stateless inside a sandbox (vanilla SQLite is fine).

---

## How to read this report

§1 sorts out the three Turso products. §2 walks the architecture. §3 unpacks the "for agents" claim and the AgentFS/branching/multi-tenant story. §4 compares Turso to D1, Neon, SQLite Cloud, and vanilla SQLite. §5 covers integration surfaces — wire protocol, embedded SDKs, MCP. §6 is pricing in May 2026. §7 is the decision framework — when this is the right pick. §8 is failure modes. §9 is sources.

Investigation log in [`notes.md`](./notes.md).

---

## 1. The three things called "Turso"

Untangling this first because every comparison and benchmark online glosses over it.

### 1.1 libSQL — the C fork

- A fork of SQLite, maintained by Turso the company, **open source and open-contribution** (which mainline SQLite explicitly is not).
- Adds: embedded replicas, an HTTP/server mode (`libsql-server`), native vector via `F32_BLOB` and a DiskANN ANN index, WASM UDFs, enhanced `ALTER TABLE`, randomised ROWIDs.
- 16.7k GitHub stars, 486 forks, multi-language drivers (TypeScript, Rust, Go, Python, C).
- **Production-ready.** Powers Turso Cloud today.
- **Maintenance mode.** Last server release `libsql-server-v0.24.32` was Feb 14 2025. The company has explicitly said the Rust rewrite *replaces libSQL as the intended direction*.

### 1.2 Turso (the database) — the Rust rewrite, formerly Limbo

- Started as a personal experiment by cofounder Pekka Enberg, called **Limbo**. ~1k stars and 30 contributors organically; 115+ contributors today.
- December 2024: officially adopted, eventually renamed Turso. (Penberg's framing, summer 2025: *"Limbo is just not a great name."*)
- A clean-room reimplementation of SQLite's file format and SQL engine in **Rust**.
- Status (May 2026): **BETA, not production-ready.** README quote: *"This software is in BETA. It may still contain bugs and unexpected behavior."*
- What it adds over SQLite/libSQL:
  - **MVCC + `BEGIN CONCURRENT`** — concurrent writes; the long-standing single-writer bottleneck is gone.
  - **Async I/O** — `io_uring` on Linux, async-first internals.
  - **Native vector** (exact search today; ANN indexing on roadmap).
  - **CDC** — change-data-capture as a first-class feature.
  - **WASM + browser** out of the box.
  - **Encryption at rest** (experimental).
  - SQLite SQL dialect, file format, and C API kept compatible.
- Bindings: Go, JavaScript, Java, .NET, Python, Rust.

### 1.3 Turso Cloud — the hosted service

- Today: runs on top of libSQL, on AWS (GA since 17 March 2025).
- Architecture: **fully diskless**. Data on S3-Express One Zone + S3. Compute nodes are stateless and Kubernetes-friendly. Pro/Enterprise can use their own S3 buckets.
- April 2026: **next-generation Turso Cloud** in private beta — runs the *Rust* Turso engine, not libSQL. Pitched explicitly at AI agents.
- May 2026: **unlimited active databases** for everyone (paid). Free tier still capped at 100 monthly active.

### 1.4 Where this leaves a builder today

If you want production *today*: libSQL (self-hosted) or Turso Cloud (libSQL underneath). The Rust Turso is for new projects whose timeline tolerates a beta engine, or for clients of the next-gen cloud beta.

When the next-gen cloud goes GA, the picture should consolidate: one engine (Turso, Rust), one cloud, libSQL kept on life support for compatibility.

---

## 2. Architecture

### 2.1 Embedded replicas

The signature feature, dating back to libSQL.

- A **remote primary** (in Turso Cloud or self-hosted) is the source of truth.
- Each client embeds a local SQLite/libSQL file as a **replica**.
- **Reads** are served from the local file — no network, ~0.02 ms.
- **Writes** are proxied to the primary; the primary acks; the change syncs back to the writing replica immediately and to other replicas on their next pull.
- libSQL exposes a `sync()` call and a `sync_interval` for periodic background pulls.
- The new Rust Turso replaces `sync()` with explicit async **`push()`** and **`pull()`**, sending **logical row-level changes via CDC** rather than file-page deltas. Smaller payloads, fewer error paths.

This is closest in spirit to Litestream or rqlite, but designed to be the *normal* way to use the DB rather than a backup tool.

### 2.2 Diskless cloud

The libSQL server was rewritten in 2024 in TigerBeetle-style **Deterministic Simulation Testing** style and made fully diskless: data lives in **S3-Express One Zone** for hot writes and **S3** for cold storage. Commits ack only after S3 durability.

The point isn't to be cheap — it's that compute nodes are stateless. They can be moved between AZs, scaled up and down, killed and replaced, without any state migration. That's the precondition for a multi-tenant cloud where individual databases are cheap to keep around even if they're idle.

For the regulated case, **Pro / Enterprise customers BYO S3**, so data lives in *their* AWS account. Same control plane, customer-owned blast radius.

### 2.3 MVCC and concurrent writes

SQLite has one writer and many readers. That's fine for a phone but not for a server with one DB shared across many request-handlers. libSQL inherits this limitation; the Rust Turso defeats it.

`BEGIN CONCURRENT` (a long-standing experimental SQLite branch) plus an MVCC implementation lets multiple writers commit in parallel as long as their write sets don't conflict. The vendor target is *thousands of writes/second* on a single DB. This is what makes "use SQLite for the agent's session log without bottlenecking" plausible.

### 2.4 Vector

- Column type: `F32_BLOB(N)` (or the friendlier alias). Stores N-dim float32 embeddings. Library authors are encouraged to use the `_BLOB` form for portable affinity.
- Functions: `vector_top_k()`, `vector_distance_cos()`, plus L2/dot variants.
- Index: in libSQL, a custom **DiskANN-backed ANN index** for fixed distance functions; cosine by default. In Rust Turso, exact vector search ships; ANN indexing is on the roadmap.
- Storage: native SQLite BLOB class, all metadata encoded in the BLOB. No separate storage class invented.
- Marketing line: *"You don't need a separate vector database."* For agent memory ≤ ~10M vectors, that's defensible. For a billion-vector ANN index, you'd still pick LanceDB or a dedicated vector DB.

### 2.5 Branching

- **Metadata-only, copy-on-write, instantaneous.**
- Mechanism: shared "generations" + WAL fragments referenced from multiple DB pointers. New writes spin off new generations; histories diverge from the branch point.
- Supports point-in-time-restore — branch from a snapshot at a chosen moment.
- Use cases: per-PR preview environments, A/B test arms, **per-agent-action workspaces** (the Adaptive Computer pattern).

This is essentially Neon's branching idea applied to SQLite. It's the feature that makes "every agent action is a branch" actually cheap.

### 2.6 Offline writes & conflict resolution

In public beta. Local writes accumulate while offline; sync flushes them when reconnected.

- Default conflict policy: **Last-Push-Wins** (row-level logical log, not commit time).
- Planned policies: `DISCARD_LOCAL`, `REBASE_LOCAL` (git-rebase semantics), custom transform hook.
- Honest caveat from the docs: conflict *detection* is in the public beta; *resolution* is still work in progress for non-default strategies.

This is the substrate for local-first agent UIs — a desktop or mobile agent that writes to its local DB even when the network is down, and reconciles later.

### 2.7 Native encryption (BYOK)

Added late 2025 / 2026 to Turso Cloud. Every query and sync request encrypted with a customer-controlled key; Turso never sees plaintext. Crucially, **distinct keys per tenant**: you can give each end-user a key, and the chain-of-trust extends down to them. This is what makes "one DB per regulated end-user" tractable.

---

## 3. The "database for AI agents" claim

Turso's 2026 marketing leans hard on this. Stripped of marketing, the actual technical claim is:

> An AI agent's natural state granularity is *per-agent* (or per-task, per-user, per-conversation, per-sandbox). It needs durability, isolation, sync, and the ability to be branched, snapshotted, and discarded cheaply. SQLite's shape fits — but its operational model doesn't, because you'd need millions of files in millions of processes. Turso fixes the operational model.

Three layers to evaluate.

### 3.1 The substrate — DB-per-agent at scale

Concrete: Adaptive Computer's AC1 (NL-to-app builder) runs **>2 million Turso databases**, with each agent action branching a new one. At ~40k in alpha, now past 2M. That's not theoretical — that's the working pattern. A handful of other AI-agent vendors are now public references.

What the substrate gives you that "one shared DB with `agent_id` columns" does not:

| Property | DB-per-agent (Turso) | Shared DB + tenant_id |
|---|---|---|
| **Branching / rollback** of an agent's state | Free, metadata-only | DIY transactional snapshots |
| **Hard isolation** (regulatory, blast radius) | Per-DB; per-DB encryption keys possible | Row-level security; one bug exposes everyone |
| **Move state to/from device** | Just copy the file | DIY export/import |
| **Cold/idle agents** | Free at rest (storage only) | Still in the schema; queries scan all |
| **Point-in-time restore** of a single agent | Single-DB PITR | Schema-wide restore or DIY |
| **One-writer bottleneck per agent** | One writer per file is fine — agents aren't concurrent on themselves | Shared write contention across all agents |

Cost: more operational surface (millions of DBs to monitor), per-DB connection bookkeeping, harder cross-agent analytics (you have to fan out queries or replicate to a warehouse).

### 3.2 The SDK — AgentFS

[`tursodatabase/agentfs`](https://github.com/tursodatabase/agentfs) is Turso's first-party agent SDK. It opens a single Turso DB per agent and exposes three primitives:

- **Filesystem** (POSIX-ish): `writeFile()`, `readdir()`, etc.
- **KV store**: `kv.set()`, `kv.get()` for arbitrary state.
- **Tool-call audit log**: `tools.record(name, t0, t1, args, result)` — every tool invocation logged with timing and arguments.

```ts
const agent = await AgentFS.open({ id: 'my-agent' });
await agent.kv.set('user:preferences', { theme: 'dark' });
await agent.fs.writeFile('/output/report.pdf', pdfBuffer);
await agent.tools.record('web_search', t0, t1,
  { query: 'AI' }, { results: [...] });
```

SDKs: TypeScript, Python, Rust. Same idea as `claude-code-sdk`'s session DB or OpenAI Assistants' Threads, but storage-first and portable: the agent's *entire* state is a single file you can `cp`, branch, encrypt, sync, or hand to another runtime.

The deeper architectural argument is in Pekka Enberg's blog post *Towards a Disaggregated Agent Filesystem on Object Storage* (penberg.org) — making the filesystem itself a Turso DB on S3, not POSIX, so an agent's "files" become first-class versioned objects.

### 3.3 The branching primitive — the agent-loop fit

The pattern that earns the "for agents" framing:

1. Agent decides to take a destructive-ish action (run a migration, modify code, change a calendar).
2. **Branch** the agent's working DB. Free, metadata-only.
3. Apply the action on the branch.
4. Validate (tests, eval, human review).
5. **Merge** the branch back, or **discard** it. No fallout either way.

This is git-style speculative execution but for agent state. It maps cleanly onto the "plan-and-branch" agent loop you see in Cursor, Devin, and homegrown coding agents — and onto non-coding agents that mutate user data (the AC1 calendar example in the Turso blog).

### 3.4 Where the claim is weak

- **AgentFS is young** (Rust SDK, TS, Python only; small audience). Most agent frameworks store memory as plain SQLite or Postgres rows; the gain over those is real but modest.
- **The Rust engine is beta.** Production claims today rest on libSQL, which is the older, slower, single-writer engine.
- **Per-DB analytics is a pain.** Cross-agent rollup ("how many tool calls did all my agents make this week") is a fan-out query problem; Turso doesn't solve that. You'll still want a warehouse downstream — see [`enterprise-data-agents/`](../enterprise-data-agents/README.md).
- **"Database for agents" works equally well as marketing for Neon, Cloudflare D1, or any cloud DB with cheap branching and DB-per-tenant.** Turso's specific edge is the *embedded-replica + branching + free DBs* triangle — not the word "agents".

---

## 4. Comparison

| | **Turso (libSQL)** | **Turso (Rust, beta)** | **Cloudflare D1** | **SQLite Cloud** | **Neon** | **Vanilla SQLite** |
|---|---|---|---|---|---|---|
| Engine | SQLite fork (C) | SQLite-compat (Rust) | SQLite | SQLite | Postgres | SQLite |
| Concurrency | 1 writer | MVCC, `BEGIN CONCURRENT` | 1 writer | 1 writer | Postgres MVCC | 1 writer |
| Async I/O | No | `io_uring` | n/a (Workers) | No | n/a | No |
| Embedded replicas | **Yes** | Yes | No (read replicas via Workers) | Yes | No | No |
| Branching | Yes (metadata-only) | Yes | Yes (D1 alpha) | No | **Yes (mature)** | No |
| Native vector | DiskANN ANN | Exact (ANN roadmap) | Vectorize (separate) | sqlite-vec compatible | pgvector | sqlite-vec extension |
| Multi-tenancy | DB-per-tenant native | DB-per-tenant native | DB-per-tenant possible | DB-per-tenant possible | Branch-per-tenant | Manual |
| Read latency (local replica) | ~0.02 ms | ~0.02 ms | ~0.5 ms (from Worker) | ~0.5–2 ms | 3–10 ms | ~0.01 ms |
| Cloud lock-in | Cross-cloud, BYO S3 | Same | Cloudflare-only | SQLite-compatible | Cloud-managed | None |
| Production-ready | **Yes** | No (beta) | Yes | Yes | Yes | Yes |
| Free tier (May 2026) | 5 GB / 500 M reads / mo | Same | 5 GB / 25 M reads | 1 GB | 0.5 GB | Free always |

**Picking between them in practice:**

- Already on Cloudflare → **D1**. Workers integration is too tight to give up.
- Need Postgres SQL or pgvector → **Neon**. Branching is just as good, semantics are more powerful.
- Want SQLite without vendor lock-in but with cloud sync → **Turso**. Embedded replicas are unmatched.
- Want SQLite-as-a-service from people who used to run SQLite at scale → **SQLite Cloud** is the pure-play comparison. Smaller, less aggressive on the rewrite/agent narrative.
- Agent runs in a sandbox VM and dies with its state → **vanilla SQLite** in the sandbox. No cloud needed.

---

## 5. Integration surfaces

### 5.1 Wire protocol — over-the-network access

The libSQL HTTP/WebSocket protocol (Hrana) is what Turso Cloud speaks. Drivers exist for TypeScript, Rust, Go, Python, Java, .NET, Swift, Kotlin. The new-generation cloud (Rust Turso, private beta) keeps the same client experience: *"query your databases over the wire as you would any database server."*

### 5.2 Embedded mode — in-process

The lower-friction shape, especially for agents:

- libSQL embedded — works wherever SQLite works, plus syncs to Turso Cloud or a self-hosted libSQL server.
- Turso (Rust) embedded — same shape, async-first; WASM build runs in the browser.

This is the substrate AgentFS sits on.

### 5.3 MCP servers

For LLM agents that should be able to query a Turso DB via MCP:

- **Official `--mcp` flag** on the Turso CLI. Spin up a local Turso DB; pass `--mcp`; it's now an MCP tool that an LLM can drive. Cleanest dev-loop story.
- **Community: `nbbaier/mcp-turso`** — connects to a Turso-hosted libSQL DB; raw query exec.
- **Community: `spences10/mcp-turso-cloud`** — two-tier auth (org-level + DB-level); useful when an LLM should be able to *manage* a DB fleet, not just query one.

The general rule from [`lite-db-ai-agents/`](../lite-db-ai-agents/README.md) §5.2 applies: don't dump the schema into the LLM context blindly; surface it via a Skill or curated description.

### 5.4 Agent-framework integrations

- **Mastra** — libSQL is the default storage for new Mastra apps; `LibSQLVector` for vectors.
- **VoltAgent** — `LibSQLStorage` provider.
- **Mem0**, **Letta** — adjacent memory/agent runtimes that *can* use libSQL/SQLite as a backend; not Turso-native.

### 5.5 Skills / docs catalog

Turso publishes an llms.txt and an *awesome-turso* repo (`tursodatabase/awesome-turso`). For Claude Code / Cursor users, a Turso "skill" pattern is in early circulation (e.g. the `turso-best-practices` plugin in the Claude plugin hub). Stable patterns aren't really there yet — this is moving fast.

---

## 6. Pricing (May 2026)

| Plan | Price | Storage | Monthly active DBs | Total DBs | Row reads / mo |
|---|---|---|---|---|---|
| **Free** | $0 | 5 GB | 100 | 100 | 500 M |
| **Hobby / Developer** | $4.99–$9 | 9 GB | 500 | unlimited | higher |
| **Scaler** | $24.92 | 24 GB | 2,500 | unlimited | higher |
| **Pro** | $416.58 | 50 GB | 10,000 | unlimited | higher |
| **Enterprise** | Custom | Custom | Custom | Custom | Custom |

(Hobby / Developer naming is in flux — independent sources cite both. Treat the lower tier of paid as ~$5–10/mo.)

The unit that matters is **monthly active databases (MAD)**: a DB that received any traffic in the calendar month. Idle DBs are free even at scale. That's the pricing innovation that makes "branch a DB on every PR / every agent action" economically sane.

May 2026: **paid plans now include unlimited total active databases.** The free tier still caps MADs at 100, but Pro can have 10k+ active in a month and Enterprise is uncapped — this is what made the AC1 case (>2 M DBs total) possible.

---

## 7. When to pick Turso

A **strong fit** when *all* of these hold:

1. You want SQLite shape (one writer, ACID, single-file portability), not Postgres semantics.
2. You want **per-agent / per-user / per-tenant** state isolation as a hard requirement (security, regulation, mental clarity).
3. **Branching, snapshot, or rollback** of state is part of the agent loop.
4. You need **low-latency reads from many places** (web, mobile, edge) and a **single durable source of truth**.
5. You're not already locked into a cloud (Cloudflare → D1; AWS-only with Aurora → just use Aurora; etc.).

A **weak fit** when:

| Condition | Why | What instead |
|---|---|---|
| OLAP / aggregation is the workload | SQLite is row-store; one writer; not the right shape | DuckDB ([`lite-db-ai-agents/`](../lite-db-ai-agents/README.md)) |
| Need Postgres types / extensions / pgvector / RLS | libSQL/Turso don't ship them | Neon |
| Already on Cloudflare end-to-end | D1 + Workers is tighter | D1 |
| Agent is fully ephemeral, dies with sandbox | No durability needed | Vanilla SQLite |
| Cross-agent analytics is the primary workload | Per-DB fan-out is painful | One Postgres / warehouse with `agent_id` |
| Production *today*, can't accept beta | Rust Turso is beta; libSQL works but is slowing | SQLite Cloud or Neon |
| You distrust single-vendor SQLite extensions | DiskANN, F32_BLOB are libSQL-specific | sqlite-vec on stock SQLite ([`memory-architectures-2026/`](../memory-architectures-2026/README.md)) |

The single most common 2026 misuse: **picking Turso "because agents", then using it as one shared DB with a `tenant_id` column.** If you're not actually using DB-per-X, you've paid for the architecture without taking the benefit. Pick Postgres in that case.

---

## 8. Failure modes

Things that have gone wrong, in rough order of frequency.

**Mistaking libSQL benchmarks for Rust-Turso behaviour.** A blog says "Turso has MVCC" — true of the Rust rewrite, false of the C libSQL most production users actually run today. Always check which engine the page is about.

**Using Rust Turso in production prematurely.** It's labelled BETA in the README. ANN vector indexing, FTS, encryption-at-rest are *experimental*. Use libSQL until the next-gen cloud goes GA, or accept beta risk explicitly.

**DB-per-agent without a control plane.** A million DBs is a million things to provision, monitor, back up, and bill. Turso Cloud handles a lot of this; self-hosted libSQL does not. Don't roll your own at scale.

**Embedded-replica conflict on offline writes.** Default policy is **last-push-wins, row-level**. If you assume git-style merge, you'll lose data on concurrent edits. Pick the conflict strategy explicitly. Note: conflict *detection* shipped in public beta; full *resolution* (REBASE_LOCAL, custom transform) is still work-in-progress at time of writing.

**Cross-agent queries become fan-out.** "Show me how many tool calls all my agents made this week" requires hitting N databases. Solve it by streaming CDC into a warehouse — don't try to query the OLTP cloud directly across millions of DBs.

**Vector-search recall surprises.** Until ANN indexing ships in Rust Turso, vector search is exact — fine for ≤ ~100k vectors, painful at scale. libSQL has DiskANN ANN already; if you're vector-heavy, that's a reason to stay on libSQL until the Rust rewrite catches up.

**Cold-start UX on first replica sync.** The "embedded replica" promise is *eventually* zero-network; first connection still pulls a full DB or a generation pointer. Big DBs over poor networks = slow first-paint. Mitigation: ship a seed DB, or sync incrementally before showing UI.

**Costs from monthly-active counting.** A DB you "thought was idle" got pinged by a health check or a forgotten cron and went active for the month. Audit your traffic before assuming MAD count is low.

**Vendor concentration.** Pricing is generous now ("Databases will be free" is a real Turso blog post). The economics depend on S3-Express + multi-tenant amortisation; if those move, prices move. Mitigation: stay on libSQL/Turso file format so a self-host fallback is a realistic exit.

---

## 9. Sources

### Turso primary materials

- [Turso main site](https://turso.tech/)
- [Turso Database (Rust) GitHub](https://github.com/tursodatabase/turso) — README states beta status, MVCC, async I/O, vector
- [libSQL GitHub](https://github.com/tursodatabase/libsql) — C fork, last release Feb 2025
- [Turso docs — libSQL](https://docs.turso.tech/libsql)
- [Turso docs — embedded replicas](https://docs.turso.tech/features/embedded-replicas/introduction)
- [Turso docs — branching](https://docs.turso.tech/features/branching)
- [Turso docs — AI & embeddings](https://docs.turso.tech/features/ai-and-embeddings)
- [Turso docs — agent databases guide](https://docs.turso.tech/guides/agent-databases)
- [Turso docs — multi-tenancy](https://turso.tech/multi-tenancy)
- [Turso docs — durability guarantees](https://docs.turso.tech/cloud/durability)
- [Turso docs — encryption](https://docs.turso.tech/tursodb/encryption)
- [Turso pricing](https://turso.tech/pricing)
- [`tursodatabase/agentfs` — AgentFS SDK](https://github.com/tursodatabase/agentfs)
- [`tursodatabase/awesome-turso`](https://github.com/tursodatabase/awesome-turso)
- [`tursodatabase/embedded-replica-examples`](https://github.com/tursodatabase/embedded-replica-examples)

### Turso blog — architecture & history

- [Introducing Limbo: A complete rewrite of SQLite in Rust](https://turso.tech/blog/introducing-limbo-a-complete-rewrite-of-sqlite-in-rust)
- [We will rewrite SQLite. And we are going all-in](https://turso.tech/blog/we-will-rewrite-sqlite-and-we-are-going-all-in)
- [Introducing the first alpha of Turso: The next evolution of SQLite](https://turso.tech/blog/turso-the-next-evolution-of-sqlite)
- [Turso Cloud Goes Diskless: How We Built a Fully S3-Based Database Architecture](https://turso.tech/blog/turso-cloud-goes-diskless)
- [How does Turso Cloud keep your data durable and safe?](https://turso.tech/blog/how-does-the-turso-cloud-keep-your-data-durable-and-safe)
- [Turso Cloud on AWS is now available for everybody](https://turso.tech/blog/turso-aws-out-of-beta)
- [A deep look into our new massive multitenant architecture](https://turso.tech/blog/a-deep-look-into-our-new-massive-multitenant-architecture)
- [Introducing Embedded Replicas: Deploy Turso anywhere](https://turso.tech/blog/introducing-embedded-replicas-deploy-turso-anywhere-2085aa0dc242)
- [Embedded Replicas go GA](https://turso.tech/blog/embedded-replicas-go-ga-with-production-friendly-upgrades)
- [Local-First SQLite, Cloud-Connected with Turso Embedded Replicas](https://turso.tech/blog/local-first-cloud-connected-sqlite-with-turso-embedded-replicas)
- [Turso Sync: a much, much, much better way to sync](https://turso.tech/blog/sync-benchmark)
- [Introducing Offline Writes for Turso](https://turso.tech/blog/introducing-offline-writes-for-turso)
- [Offline Sync Public Beta](https://turso.tech/blog/turso-offline-sync-public-beta)
- [Introducing Databases Anywhere with Turso Sync](https://turso.tech/blog/introducing-databases-anywhere-with-turso-sync)
- [Turso now supports Database Branching and Point-in-Time Restore](https://turso.tech/blog/turso-now-supports-database-branching-and-point-in-time-restore-eaadb8c4dce5)
- [Track Database Branching with Turso Cloud](https://turso.tech/blog/track-database-branching-with-turso-cloud)
- [Database Per Tenant production friendly improvements](https://turso.tech/blog/database-per-tenant-architectures-get-production-friendly-improvements)
- [Introducing Native Encryption in Turso Cloud](https://turso.tech/blog/turso-cloud-native-encryption)
- [Introducing Fast, Native Encryption in Turso Database](https://turso.tech/blog/introducing-fast-native-encryption-in-turso-database)
- [Fully Open Source Encryption for SQLite](https://turso.tech/blog/fully-open-source-encryption-for-sqlite-b3858225)

### Turso blog — vector / RAG / AI agents

- [Native Vector Search for SQLite (product page)](https://turso.tech/vector)
- [Turso brings Native Vector Search to SQLite](https://turso.tech/blog/turso-brings-native-vector-search-to-sqlite)
- [You Don't Need A Separate Vector Database](https://turso.tech/blog/you-dont-need-a-separate-vector-database)
- [How to Generate & Store OpenAI Vector Embeddings with Turso](https://turso.tech/blog/how-to-generate-and-store-openai-vector-embeddings-with-turso)
- [SQLite Retrieval Augmented Generation and Vector Search](https://turso.tech/blog/sqlite-retrieval-augmented-generation-and-vector-search)
- [Turso: Databases For All Your AI Apps (Oct 2024)](https://turso.tech/blog/databases-for-all-your-ai-apps)
- [The next generation of Turso Cloud is (almost) here: Now in Private Beta (Apr 2026)](https://turso.tech/blog/turso-cloud-new-generation-private-beta)
- [Turso Now Includes Unlimited Active Databases for Everybody (May 2026)](https://turso.tech/blog/turso-now-includes-unlimited-databases-for-everybody)
- [Databases will be free](https://turso.tech/blog/databases-will-be-free)
- [How to build a retrieval system for agents](https://turso.tech/blog/how-to-build-a-retrieval-system-for-agents)
- [Building AI Agents That Remember with Mastra and Turso Vector](https://turso.tech/blog/building-ai-agents-that-remember-with-mastra-and-turso-vector)
- [Powering AI Agents: VoltAgent & Turso for Global, Low-Latency Memory](https://turso.tech/blog/powering-ai-agents-turso-voltagent)
- [Adaptive Computer chooses Turso ephemeral databases](https://turso.tech/blog/adaptive-computer-chooses-turso-ephemeral-databases-to-power-ai-agents-that-build-and-modify-software)
- [Turso Cloud powers Adaptive's AI Builder Platform with 2 Million+ Databases](https://turso.tech/blog/turso-cloud-powers-adaptive-ai)
- [Introducing the Turso Database MCP](https://turso.tech/blog/introducing-the-turso-database-mcp-server)
- [Turso Cloud Debuts the New Developer Plan](https://turso.tech/blog/turso-cloud-debuts-the-new-developer-plan)
- [Turso introduces new Hobby plan for $9 a month](https://turso.tech/blog/turso-introduces-new-hobby-plan-for-9-dollar-a-month)
- [Database Freedom Day - Unlimited Databases Are Here](https://turso.tech/blog/unlimited-databases-are-here)
- [Turso Goes Mobile With Official iOS & Android SDKs](https://turso.tech/blog/turso-goes-mobile-with-official-ios-and-android-sdks)
- [Turso + Expo: Build offline-first mobile apps](https://expo.dev/blog/build-offline-first-mobile-apps)

### Founders / commentary

- [Pekka Enberg — *Towards a Disaggregated Agent Filesystem on Object Storage*](https://penberg.org/blog/disaggregated-agentfs.html)
- [Pekka Enberg on X — clarifying Turso vs libSQL vs Turso Cloud](https://x.com/penberg/status/2032373944007688226)
- [Changelog Interviews #626 — Glauber Costa on rewriting SQLite in Rust](https://changelog.com/podcast/626)

### Independent sources

- [BetterStack — How Turso Eliminates SQLite's Single-Writer Bottleneck](https://betterstack.com/community/guides/databases/turso-explained/)
- [The New Stack — Why We Created Turso, a Rust-Based Rewrite of SQLite](https://thenewstack.io/why-we-created-turso-a-rust-based-rewrite-of-sqlite/)
- [OpenReplay — Meet Turso, a Rust-Based Evolution of SQLite](https://blog.openreplay.com/turso-rust-sqlite-evolution/)
- [Hacker News — Limbo: A complete rewrite of SQLite in Rust (discussion)](https://news.ycombinator.com/item?id=42378843)
- [DEV — The SQLite Renaissance: 2026](https://dev.to/pockit_tools/the-sqlite-renaissance-why-the-worlds-most-deployed-database-is-taking-over-production-in-2026-3jcc)
- [SitePoint — Post-PostgreSQL: Is SQLite on the Edge Production Ready?](https://www.sitepoint.com/sqlite-edge-production-readiness-2026/)
- [Techsy — Neon vs PlanetScale vs Turso (2026)](https://techsy.io/blog/neon-vs-planetscale-vs-turso)
- [BuildMVPFast — Turso vs Cloudflare (2026)](https://www.buildmvpfast.com/compare/turso-vs-cloudflare)
- [BuildMVPFast — Best Turso Alternatives (2026)](https://www.buildmvpfast.com/alternatives/turso)
- [DragánSr — SQLite in Rust: Turso Limbo + libSQL](https://blog.dragansr.com/2025/02/sqlite-in-rust-turso-limbo-libsql.html)
- [Codebrand — Turso Database Guide 2026](https://www.codebrand.us/blog/turso-database-complete-guide-2026/)

### Community MCP servers

- [`nbbaier/mcp-turso`](https://github.com/nbbaier/mcp-turso)
- [`spences10/mcp-turso-cloud`](https://github.com/spences10/mcp-turso-cloud)

### Adjacent prior threads in this repo

- [`lite-db-ai-agents/`](../lite-db-ai-agents/README.md) — parent thread; the lite-DB landscape
- [`ai-memory-systems/`](../ai-memory-systems/README.md), [`memory-architectures-2026/`](../memory-architectures-2026/README.md), [`standalone-memory-tools-survey-2026/`](../standalone-memory-tools-survey-2026/README.md) — agent memory substrate
- [`enterprise-data-agents/`](../enterprise-data-agents/README.md) — the warehouse end; cross-agent analytics
- [`rag-domain-knowledge-strategies/`](../rag-domain-knowledge-strategies/README.md) — vector retrieval patterns

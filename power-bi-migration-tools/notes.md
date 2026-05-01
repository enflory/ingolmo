# Notes — Power BI migration tools

Research log. Append-only.

## Goal

Survey tools that streamline migrating off Power BI to another BI tool or semantic-layer setup. Both directions of the migration matter — what gets extracted from Power BI and what it gets converted into.

## Scoping the problem

Power BI is not one artifact. A migration touches several layers, and tools usually only cover one or two:

1. **Semantic model / dataset** — tables, relationships, calculated columns, measures. Encoded as Tabular Object Model (TOM) / TMSL JSON / .bim files. DAX is the formula language; M (Power Query) is the ELT language.
2. **Reports / visuals** — pages, visuals, bookmarks, themes. Stored as PBIX (binary) or PBIP (folder of JSON) — page layouts, slicers, conditional formatting.
3. **Data sources / refresh** — gateways, scheduled refresh, incremental refresh.
4. **RLS / OLS** — row-level and object-level security roles.
5. **Workspaces / governance** — workspace layout, datasets vs. reports separation, deployment pipelines, sensitivity labels.
6. **Power BI Service quirks** — apps, dashboards (legacy), paginated reports (SSRS-style RDL), dataflows, datamarts, Fabric-era artifacts.

Targets a migration could land at:

- **Another full BI tool**: Tableau, Looker (Studio or LookML), Qlik, Sigma, ThoughtSpot, Omni, Hex, Mode (now Sigma), Spotfire, MicroStrategy.
- **A headless semantic layer**: dbt Semantic Layer (MetricFlow), Cube, AtScale, Malloy. Then a thin viz layer on top.
- **Notebook / SQL-first**: Hex, Deepnote, Evidence.dev, Rill — paired with dbt models.
- **Just SQL views + Excel** — for small shops, the "rip out the cube and ship views" pattern.

## Existing prior work in this repo

Skimmed `agentic-self-improvement`, `applescript-research`, `realtime-api-low-latency-voice`, etc. None overlap with BI migration. Nothing to build on directly. The agentic-self-improvement notes do mention LangGraph/DSPy patterns that come up below in the LLM-assisted migration section.


## What gets extracted from Power BI

The unit of migration matters. Tools work at different layers:

### File formats

- **PBIX** — opaque binary. Single-file zip with embedded VertiPaq model, M scripts, and report layout. Bad for diffing, but it's what most users actually have.
- **PBIP / Power BI Project** — folder format. Splits a PBIX into a `.SemanticModel` folder and `.Report` folder of plain text. One-click `Save As` from Desktop. This is the source-control-friendly format.
- **TMSL / `.bim`** — JSON serialization of the tabular model. Older standard, still works.
- **TMDL** — Tabular Model Definition Language. Declarative YAML-ish text format released April 2023; successor to TMSL inside the PBIP folder. Diff- and merge-friendly. This is the format any sane migration tool should target as its source representation.
- **PBIR** — Enhanced report format (preview). JSON format for the report side of PBIP, replacing the legacy `report.json`.
- **RDL** — paginated reports (SSRS-flavor); largely orthogonal to the semantic-model conversation.

### APIs and protocols

- **XMLA endpoint** — Premium / PPU only. Read/write access to a deployed dataset via Tabular Object Model (TOM) or DMVs. This is how Tabular Editor, ALM Toolkit, and pbi-tools talk to a live dataset.
- **REST API** (Power BI / Fabric) — workspace metadata, exports, scheduling.
- **Power BI Scanner API** — workspace-level metadata for governance tools.
- **Semantic Link / SemPy** — Microsoft's Python library for Fabric notebooks, gives programmatic access to datasets, measures, DAX execution, lineage. `microsoft/semantic-link-labs` extends it.

### Extraction tools

- **Tabular Editor 2 (free, open source) and 3 (paid)** — The standard third-party model editor. Connects via XMLA, edits TOM, runs C#/scripts, supports best-practice analyzer rules. Tabular Editor 2 has the broadest hobbyist install base; TE3 is what consultancies use.
- **pbi-tools** (open source, community) — CLI for round-tripping between PBIX and TMDL/PbixProj. `extract`, `convert`, `compile`, `deploy` commands. The standard "PBIX as code" tool.
- **DAX Studio** (open source) — Reads/profiles DAX, executes against a deployed model. Useful for inventorying measures and queries before migration.
- **ALM Toolkit** (open source) — Diffs and deploys tabular models.
- **BISM Normalizer** (open source) — Compare/merge for Analysis Services tabular models.

So a typical migration extraction pipeline looks like: PBIX → (Save As) → PBIP → TMDL files; or live dataset → (XMLA + Tabular Editor / semantic-link-labs) → TMDL or BIM.

## Vendor and SI migration tools landscape

### Tableau-targeted (Power BI → Tableau)

- **DataTerrain "Any-to-Any BI Migration"** — automation for OBIEE, Cognos, BO, Tableau, Qlik, Hyperion, Crystal, Jasper, Power BI. They explicitly say PBIX→TWB is not "direct file conversion" — automation handles analysis/mapping/validation, but the visualization layer is rebuilt. This is the honest position.
- **EZConvertBI (Wavicle)** — AI engine that targets Power BI / Looker / Quick Suite as outputs from Tableau/Qlik/Power BI. Marketed as up to 90% cost reduction, which is sales puffery; treat as "gets you a starting point."
- **BIChart** — automated dashboard conversion, Tableau↔Power BI direction is the one with real coverage.
- General pattern: most "Tableau ↔ Power BI" tooling is *Tableau → Power BI* because that's the direction Microsoft and its partners are pushing. Power BI → Tableau is a smaller market with thinner tooling.

### Looker-targeted (Power BI → Looker / LookML)

- No mainstream automated Power BI → LookML converter exists. The architectural gap (DAX measures with row-context vs LookML's SQL templating) is genuinely large.
- **Travinto X2XConverter / X2XAnalyzer / X2XValidator** — services-led converter, claims Power BI Dataflows → Looker SQL. Service-shop tooling, not a self-serve product.
- Common pattern in real migrations: model the data once in dbt, then build LookML on top. The Power BI semantic model becomes a reference document, not a translation source.

### Cube / dbt / open semantic-layer–targeted

- **Cube `lkml2cube`** (open source) — bidirectional LookML ↔ Cube. *Not* PBIX-aware, but useful if you do a two-step migration: PBIX → LookML (manual) → Cube (automated), or if Looker is an interim stop.
- **AtScale Power BI to SML Converter** — recently announced. Translates Power BI semantic definitions (XMLA endpoint) into AtScale's Semantic Modeling Language (SML). Targets the "preserve the semantic layer, change the BI front-end" scenario. AtScale's pitch: keep DAX-speaking Power BI clients on top via XMLA-1600 while making the metrics also queryable from non-Power-BI tools.
- **dbt Semantic Layer (MetricFlow)** — *no first-party converter from Power BI*. The integration is "Power BI as a consumer of MetricFlow," not "MetricFlow as the destination of Power BI." Migration means rewriting DAX measures as MetricFlow YAML, typically by hand or with LLM assistance.
- **Timbr.ai** — proprietary script that parses .bim files and translates DAX measures into SQL DDL inside Timbr's semantic layer. Niche but interesting because it operates at the right layer (model, not viz).

### Power BI as the *destination* (more mature tooling — useful as a reference for what good looks like)

- **BIPort (Sparity)** — Tableau → Power BI, claims 70% automation, AI-powered LOD-to-DAX translation. Microsoft Marketplace listing.
- **Pulse Convert** — in-house LLM, 75-90% accuracy claim. Tableau workbooks → PBIP semantic model + DAX.
- **migVisor 2.0** — Tableau → Power BI semantic models.
- **PORT BI (Analytics Aura)** — Qlik Sense → Power BI focus.
- **MAQ Software** — Qlik → Power BI consulting + tooling.

The asymmetry is striking: there's a thriving cottage industry of Tableau/Qlik/SAP-BO → Power BI accelerators (because Microsoft funds the partner ecosystem to win those migrations), and almost nothing comparable in the other direction. Anyone leaving Power BI is mostly on their own.


## Open-source PBIX parsing libraries

Worth a section because they're the foundation under any "build your own migration pipeline" approach:

- **pbixray** (Hugoberry, Python, MIT) — parses the binary PBIX directly, including the Xpress9-compressed VertiPaq blob. Surfaces DAX measures, calculated columns, M expressions, table metadata as pandas DataFrames. There's also a `duckdb-pbix-extension` from the same author and a `pbixray-mcp-server` that exposes the parser as MCP tools to LLM clients. This is the closest thing the ecosystem has to a "PBIX SDK."
- **pbi_parsers** (Douglas Simonsen, Python) — proper lexers / parsers / formatters for DAX and M (Power Query). Built for code analysis, not execution. Useful if you want to walk an AST when transpiling.
- **PyDaxExtract** — works on `.pbit` template files (which contain the schema in plain JSON) rather than `.pbix`. Extracts M and DAX expressions.
- **Microsoft.AnalysisServices.Tabular** (.NET, the canonical TOM) — Microsoft's first-party C# library. Anything programmatic Microsoft does with tabular models eventually goes through TOM.

The combination of *PBIX → pbixray → pbi_parsers* is the buildable pipeline for anyone who wants to write their own converter without paying for Tabular Editor 3 or operating against an XMLA endpoint.

## Sigma + Hakkōda BI Analyst (free Snowflake Marketplace app)

Mentioned separately because it's the most interesting "assessment-first" tool I came across:

- Free Snowflake Native App. Connects to Power BI, Tableau, and Looker.
- Pulls metadata: workbooks, dashboards, fields, measures, refresh activity, usage.
- Lands it as Snowflake tables you can query, plus auto-provisioned Sigma workbooks for analysis.
- Uses Snowflake Cortex to *suggest* formula-syntax translations between BI tools.
- Marketing position: "before you migrate, find out what's worth migrating."

This is the realistic posture: rationalize first (what 20% of dashboards drive 80% of usage? what's stale? what's duplicated?), then convert only the survivors. Almost every successful migration story I've seen in the wild follows this shape.

## AI-assisted migration approaches

Three patterns showing up:

### 1. LLM-as-translator (input: DAX/M, output: SQL/MetricFlow YAML/LookML)

Used as a code-conversion pass. The honest framing in industry posts: get to ~70-85% on clean inputs, push to 86-95% with a real semantic-layer scaffold around the LLM. Failure modes are characteristically DAX-shaped: filter context, time-intelligence functions (`SAMEPERIODLASTYEAR`, `DATESYTD`), CALCULATE with multiple modifiers, iterators (`SUMX` over filtered tables) — these don't have one-line SQL equivalents and the LLM will sometimes generate plausible-looking but semantically wrong SQL.

Mitigations the literature converges on:
- Translate measures *one at a time* with the relevant table schema and a few canonical examples in the prompt.
- Validate by running both the original DAX (against the live model via XMLA) and the candidate SQL against the warehouse, comparing aggregate results across slicers. This is the only check that catches semantic drift.
- Keep a curated DAX → SQL pattern library and use few-shot retrieval, not zero-shot.

### 2. Agentic decomposition (multi-step, multi-agent)

The Applied Information Sciences (AIS) writeup describes a "specification-driven" pattern: an AI agent reads the Power BI artifact, *extracts a written spec of the business rule it implements*, then generates dbt models from the spec rather than transpiling DAX directly. Two-step, with the spec as a human-reviewable checkpoint.

Mentioned implementations: AutoGen Studio for agent orchestration; LangGraph for portable orchestration. Microsoft has signaled AutoGen → "Microsoft Agent Framework" continuity. The `power-bi-agentic-development` repo (data-goblins) collects skills, subagents, and hooks for this kind of work.

### 3. MCP servers exposing Power BI artifacts

- `pbixray-mcp-server` exposes pbixray parsing to MCP-speaking agents — so a Claude/Cursor session can load a PBIX, list measures, view DAX, walk the model, on its own.
- `microsoft/semantic-link-labs` covers the "live workspace" side via SemPy in Fabric notebooks; an MCP wrapper on top would be a natural project.

The center of gravity seems to be moving toward "expose the model to a coding agent and let it plan the migration interactively" rather than "feed inputs into a one-shot converter." This matches the pattern in agentic-self-improvement notes: persistent memory + reflection beats single-pass extraction for any task this lossy.

## What Microsoft itself ships

Notable absences are interesting:

- **No first-party Microsoft tool moves customers off Power BI**. Of course not — the marketplace tools in this space are *all* one-direction (Tableau/Qlik/SAP-BO/MicroStrategy/OBIEE → Power BI).
- **Power BI Migration Guidance** in Microsoft Learn is about migrating *into* Power BI from older Microsoft stacks (SSRS, SSAS, Excel-based reporting). Useful for understanding workspace-layout idioms but not for leaving.
- **AAS → Power BI migration** is well-documented (Azure Analysis Services to Power BI Premium), again, deeper into the Microsoft stack.
- **Fabric Direct Lake migration** is "modernize within Power BI" — also not what we need.

So the "leave Power BI" path is, in 2026, almost entirely a third-party / open-source / build-it-yourself story.

## Realistic migration shape (synthesized)

For someone actually doing this:

1. **Inventory** with semantic-link-labs (if Fabric/Premium) or Power BI Scanner API + pbixray (if Pro/local PBIX files). Catalog: dataset count, measure count, M sources, refresh schedules, RLS roles, report → dataset graph, usage stats.
2. **Rationalize** ruthlessly. Hakkōda's Sigma BI Analyst is one off-the-shelf option; otherwise a few SQL queries against the metadata catalog get you there.
3. **Save target PBIXes as PBIP** with TMDL serialization. Now everything you care about is plain text.
4. **Convert the data layer first.** M queries → dbt models or warehouse SQL. This is where most of the real business logic lives, and converting it is straightforward (M is mostly source connection + light transforms; dbt is a strict superset functionally).
5. **Convert measures.** This is the hard part. Options:
   - Manual rewrite (most teams, for high-value measures).
   - LLM-assisted with golden-output validation (compare DAX vs generated SQL/YAML aggregate-by-aggregate).
   - AtScale SML Converter if you're staying on Power BI as one of several front-ends and putting AtScale underneath.
6. **Rebuild reports** in the target tool. Visuals don't translate; layouts get redesigned. This is the part nobody automates well.
7. **Cut over with parallel run.** Run both stacks for a release cycle, diff KPIs, then deprecate.

Steps 1-4 are well-tooled. Step 5 is the bottleneck and where AI/agentic approaches are most useful. Step 6 is wedding-photographer work — careful and human.

## Sources collected

- https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-tmdl-view (TMDL view in Desktop)
- https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-overview (PBIP)
- https://pbi.tools/tmdl/ (pbi-tools TMDL support)
- https://www.sqlbi.com/tools/tabular-editor/ (Tabular Editor)
- https://docs.tabulareditor.com/te2/Useful-script-snippets.html (TE C# scripts)
- https://github.com/microsoft/semantic-link-labs (Semantic Link Labs)
- https://github.com/Hugoberry/pbixray (pbixray PBIX parser)
- https://pypi.org/project/PyDaxExtract/ (PyDaxExtract)
- https://douglassimonsen.github.io/pbi_parsers/ (pbi_parsers DAX/M lexer-parser)
- https://github.com/cube-js/lkml2cube (Cube lkml2cube)
- https://www.atscale.com/blog/unlock-power-bi-semantic-models/ (AtScale Power BI → SML Converter)
- https://timbr.ai/blog/why-sql-beats-dax-hands-down-for-power-bi-metrics/ (Timbr DAX → SQL)
- https://docs.getdbt.com/docs/cloud-integrations/semantic-layer/power-bi (dbt SL Power BI connector)
- https://hakkoda.io/resources/sigma-bi-analyst-by-hakkoda/ (Sigma BI Analyst)
- https://www.sigmacomputing.com/go/migrate-with-hakkoda (Hakkōda Migration Assistant)
- https://dataterrain.com/power-bi-to-tableau-migration (DataTerrain Power BI → Tableau)
- https://www.sparity.com/accelerators/tableau-to-power-bi-migration-accelerator/ (BIPort)
- https://marketplace.microsoft.com/en-us/product/saas/officesolution1640276900203.pulse_convert_1 (Pulse Convert)
- https://www.ais.com/from-knowledge-debt-to-governed-analytics-migrating-legacy-power-bi-to-dbt-in-microsoft-fabric/ (AIS specification-driven)
- https://github.com/data-goblins/power-bi-agentic-development (Power BI agentic dev)
- https://www.snowflake.com/en/engineering-blog/agentic-semantic-model-text-to-sql/ (Cortex Analyst agentic)
- https://omni.co/blog/put-your-semantic-layer-where-the-action-happens (Omni semantic layer)
- https://docs.thoughtspot.com/cloud/latest/tml-import-export-multiple (ThoughtSpot TML)
- https://github.com/thoughtspot/thoughtspot_tml (thoughtspot_tml Python)


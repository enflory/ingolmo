# Power BI migration tools

Survey of tools, libraries, and patterns for migrating off Power BI to another BI tool or headless semantic layer. Researched May 2026.

## TL;DR

- **There is no one-click "Power BI → X" tool.** The mature accelerator market goes the *other* direction (Tableau / Qlik / SAP-BO → Power BI), heavily subsidized by Microsoft's partner ecosystem. Anyone leaving Power BI assembles a pipeline from open-source pieces and accepts manual rework on measures and visuals.
- **The migration is at least three layers deep**: data prep (M / Power Query), semantic model (DAX measures, relationships, RLS), and reports (visuals, bookmarks, themes). Almost all tooling targets one or two; nothing convincingly handles all three.
- **Microsoft's PBIP + TMDL formats (2023+) changed the game** for the extraction layer. A modern Power BI project is now a folder of human-readable text. Anything you build operates on TMDL, not on opaque PBIX.
- **The strongest off-the-shelf options** depend on where you're going:
  - To **AtScale** (multi-front-end semantic layer): AtScale's *Power BI to SML Converter* is the only first-party converter that operates on the Power BI semantic model.
  - To **Sigma**: Hakkōda's *BI Analyst* (free Snowflake Native App) inventories Power BI/Tableau/Looker assets; the *BI Migration Copilot* uses Cortex AI to assist conversion.
  - To **Tableau / other proprietary BI**: services-led (DataTerrain, Wavicle EZConvertBI, Travinto). Honest vendors say only ~50–70% can be automated; visuals are rebuilt.
  - To **dbt Semantic Layer / Cube / Malloy**: no first-party converter. LLM-assisted transpilation of DAX → MetricFlow YAML / Cube model, validated by aggregate-comparison testing.
- **The interesting frontier** is agentic migration: expose the PBIX/TMDL to an LLM via MCP, let the agent decompose measures into specs, generate target-language code, validate with golden-output diffs, and iterate. AIS, data-goblins, and the pbixray-mcp-server author are publishing patterns for this.

## How to read this report

Sections are organized by **what gets extracted from Power BI** (formats and protocols), **what tools cover the extraction layer**, **what tools cover the conversion layer** organized by destination, and finally **AI-assisted approaches** and a **realistic migration playbook**.

## 1. What gets extracted from Power BI

A Power BI deployment isn't one artifact. Migrations hit several layers, and each layer has a different format/protocol:

| Layer | Format | Notes |
|---|---|---|
| Semantic model | TMDL (preferred), TMSL/`.bim` (legacy JSON) | Tables, relationships, calculated columns, measures, RLS/OLS. TMDL is the diff-friendly successor. |
| Data prep | M / Power Query | Lives inside the semantic model. Mostly source connections + light transforms. |
| Reports | PBIR (preview) / `report.json` (legacy) | Pages, visuals, bookmarks, themes. |
| Project file | PBIP (folder) or PBIX (binary zip) | PBIP is `Save As` from Desktop; it's the source-control-friendly form. |
| Live model | XMLA endpoint (Premium / PPU only), Tabular Object Model (TOM) | What Tabular Editor/ALM Toolkit/pbi-tools talk to. |
| Workspace metadata | Power BI REST API, Scanner API | For inventories, lineage, governance. |
| Notebook-side | Semantic Link / SemPy (Python in Fabric) | DAX exec, measure listing, lineage from a notebook. |
| Paginated reports | RDL | SSRS-flavor; orthogonal to the modern semantic model. |

**The practical move** for any modern migration: convert PBIX → PBIP (TMDL) first, then operate on plain text. Microsoft made this a one-click `File → Save As` in Desktop.

## 2. Extraction-layer tooling (mostly mature, mostly free)

These tools get you from "a Power BI workspace" to "data structures you can transform."

### Microsoft / official

- **PBIP + TMDL** ([Learn](https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-overview), [TMDL view](https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-tmdl-view)) — folder + text format for projects. Foundation for all programmatic work.
- **Semantic Link / SemPy + [`microsoft/semantic-link-labs`](https://github.com/microsoft/semantic-link-labs)** — Python in Fabric notebooks; lists tables, measures, executes DAX, walks lineage, exports models. The closest thing to an official "Python SDK for Power BI."
- **Power BI Scanner API + REST API** — for workspace-level inventory.
- **Microsoft.AnalysisServices.Tabular (TOM)** — canonical .NET library; everything else builds on it.

### Community-standard

- **[Tabular Editor 2](https://github.com/TabularEditor/TabularEditor) (free, OSS) / 3 (paid, [SQLBI](https://www.sqlbi.com/tools/tabular-editor/))** — the third-party model editor. C# scripting, Best Practice Analyzer, XMLA round-tripping. The standard scripted-export tool: `ExportProperties(Model.AllMeasures, "Name,Expression,FormatString,...")` dumps every measure to TSV in a few lines ([Useful script snippets](https://docs.tabulareditor.com/te2/Useful-script-snippets.html)).
- **[pbi-tools](https://pbi.tools/tmdl/) (OSS)** — CLI: `extract`, `convert`, `compile`, `deploy`. Round-trips PBIX ↔ PBIP/TMDL/`model.bim`.
- **[DAX Studio](https://daxstudio.org/) (OSS)** — runs DAX against a deployed model; useful for measure profiling and golden-output capture.
- **[ALM Toolkit](http://alm-toolkit.com/) (OSS)** — diff/deploy tabular models.

### PBIX parsers (build-your-own pipeline foundation)

- **[`Hugoberry/pbixray`](https://github.com/Hugoberry/pbixray) (Python, MIT)** — parses the binary PBIX directly, including the Xpress9-compressed VertiPaq blob. Returns DAX measures, calculated columns, and M expressions as DataFrames. Same author publishes a [DuckDB extension](https://github.com/Hugoberry/duckdb-pbix-extension) and an MCP server (see §5).
- **[`pbi_parsers`](https://douglassimonsen.github.io/pbi_parsers/) (Python)** — proper lexer/parser/formatter for DAX and M. Built for code-walking, not execution.
- **[PyDaxExtract](https://pypi.org/project/PyDaxExtract/)** — works on `.pbit` template files (plain JSON).

If you're building your own converter, the buildable pipeline is **PBIX → pbixray → pbi_parsers (AST) → your transpiler**. No license fees, no XMLA endpoint required.

## 3. Conversion-layer tooling, by destination

### → Tableau

- **[DataTerrain "Any-to-Any BI Migration"](https://dataterrain.com/power-bi-to-tableau-migration)** — services + automation. They're explicit that PBIX→TWB is *not* direct file conversion: automation handles inventory, mapping, and validation; viz is rebuilt. Honest framing.
- **[Wavicle EZConvertBI](https://wavicledata.com/capabilities/data-solutions/ezconvertbi/)** — AI-engine, targets Quick Suite / Power BI / Looker as outputs.
- **[BIChart](https://bichart.ai/tableau-to-power-bi)** — focused on dashboard conversion.

Net assessment: every tool in this row is consultancy-led. None are self-serve. Pricing is "call us."

### → Looker / LookML

- **No mainstream automated Power BI → LookML converter exists.** The DAX-vs-LookML mismatch (filter-context measures vs SQL templates) is fundamental.
- **[Travinto X2XConverter](https://travinto.com/products/code-converter/power-bi-dataflows-to-looker)** — services tool, focused on Power BI Dataflows SQL → Looker.
- The de-facto pattern is: model the data once in **dbt**, then build LookML on top. The Power BI semantic model becomes a reference doc, not a translation source.

### → dbt Semantic Layer (MetricFlow)

- **No first-party converter.** dbt's Power BI integration is the [Power BI Connector](https://docs.getdbt.com/docs/cloud-integrations/semantic-layer/power-bi) for Power BI to *consume* MetricFlow metrics, not the reverse.
- Migration shape:
  1. Convert M queries → dbt staging/marts models.
  2. Convert DAX measures → MetricFlow YAML by hand or with LLM assistance.
  3. Validate with aggregate-by-aggregate diffs against the live Power BI model (XMLA + DAX query).
- AIS published a **specification-driven** pattern ([blog post](https://www.ais.com/from-knowledge-debt-to-governed-analytics-migrating-legacy-power-bi-to-dbt-in-microsoft-fabric/)): an AI agent extracts a *natural-language spec* of each business rule from DAX, then regenerates dbt models from the spec. The spec is the human-reviewable checkpoint.

### → Cube

- **[`lkml2cube`](https://github.com/cube-js/lkml2cube) (Cube, OSS, Python)** — bidirectional LookML ↔ Cube. *Not* PBIX-aware. Useful only if you do a two-step migration: PBIX → LookML (manual) → Cube (automated).
- No dedicated DAX → Cube converter. Same LLM-assisted pattern as dbt applies.

### → AtScale

- **[AtScale Power BI to SML Converter](https://www.atscale.com/blog/unlock-power-bi-semantic-models/)** — the only vendor that ships a first-party converter rooted in the Power BI semantic model. Translates dimensional models, measures, and hierarchies into AtScale's Semantic Modeling Language (SML).
- AtScale's positioning is "keep Power BI as a front-end via XMLA-1600, but make the same metrics available to Tableau/Excel/AI agents." So it's also a viable *partial* migration where Power BI stays for some users and you stop being locked into it for others.

### → Sigma

- **[Sigma BI Analyst by Hakkōda](https://hakkoda.io/resources/sigma-bi-analyst-by-hakkoda/)** — free Snowflake Native App. Extracts metadata from Power BI/Tableau/Looker, lands it in Snowflake, auto-provisions Sigma workbooks for inventory analysis. Uses Snowflake Cortex to suggest formula-syntax translations.
- **[Hakkōda BI Migration Copilot](https://hakkoda.io/resources/bi-copilot/)** — paid services tier on top of the free app; targets ~3-month migrations.
- **[Sigma + dbt Semantic Layer](https://www.getdbt.com/blog/omni-dbt-semantic-layer)** — Sigma can sit on top of MetricFlow, so the dbt route is also a Sigma route.

### → Omni

- **[Omni's dbt Semantic Layer integration](https://omni.co/blog/put-your-semantic-layer-where-the-action-happens)** — you migrate to dbt SL and connect Omni; same path as the dbt route.
- **[Unwind Data's Migrate to Omni](https://www.unwinddata.com/migrate-to-omni)** — services-led, primarily Looker/Tableau → Omni; less coverage for Power BI but the same shape applies.

### → ThoughtSpot

- **[`thoughtspot_tml`](https://github.com/thoughtspot/thoughtspot_tml) (OSS Python)** + [TML import/export](https://docs.thoughtspot.com/cloud/latest/tml-import-export-multiple) — useful for *generating* TML on the destination side, but no Power BI-aware converter exists. Migration is hand-built.

### → Apache Superset / open-source viz

- Superset has **no semantic layer**, so the migration shape is "rip the model out into dbt or Cube, then point Superset at the warehouse." Plan for substantial manual rebuild ([discussion](https://www.augustinfotech.com/blogs/how-to-migrate-power-bi-to-open-source-dashboard-system/)).

### → Qlik Sense

- **[Article: Migration of Power BI to Qlik Sense Using AI Agents](https://medium.com/@arunanjan077/migration-of-power-bi-to-qlik-sense-using-ai-agents-89f9faf85a4d)** — DIY AutoGen-based pattern, no off-the-shelf product. The reverse direction (Qlik → Power BI) is well-tooled (e.g., [PORT BI](https://analyticsaura.com/portbi)); this direction isn't.

### Niche but interesting: Timbr.ai

- **[Timbr](https://timbr.ai/blog/why-sql-beats-dax-hands-down-for-power-bi-metrics/)** has a proprietary script that parses `.bim` and translates DAX measures into SQL DDL inside Timbr's semantic layer; existing Power BI reports can then connect via the Spark connector. Operates at the model layer rather than the viz layer, which is the right altitude.

## 4. AI-assisted migration approaches

Three patterns observable in the 2025–2026 literature:

### a) LLM-as-translator

Use the model as a code-conversion pass: feed DAX, get SQL/MetricFlow YAML/LookML. Industry-reported accuracy: ~70–85% on clean inputs, 86–95% with proper semantic-layer context ([Snowflake Cortex Analyst](https://www.snowflake.com/en/engineering-blog/agentic-semantic-model-text-to-sql/)). DAX failure modes are characteristically:

- **Filter context** — `CALCULATE` modifiers (`REMOVEFILTERS`, `KEEPFILTERS`, `ALL`, `ALLEXCEPT`) don't have one-line SQL equivalents.
- **Time intelligence** — `SAMEPERIODLASTYEAR`, `DATESYTD`, `DATEADD` rely on a date table the LLM can't see by default.
- **Iterators** — `SUMX`, `AVERAGEX`, `RANKX` over filtered tables need careful SQL window-function rewrites.

Mitigations the literature converges on:

1. Translate measures *one at a time* with the relevant table schema and a curated DAX→SQL pattern library in the prompt.
2. **Validate with golden-output diffs**: run the original DAX against the live model (XMLA) and the candidate SQL against the warehouse, comparing aggregates across multiple slicer combinations. This is the only check that catches semantic drift.
3. Treat "looks plausible" as a failure mode and assume the LLM will produce confidently-wrong SQL for edge cases.

### b) Specification-driven / agentic decomposition

Two-step pattern from [AIS](https://www.ais.com/from-knowledge-debt-to-governed-analytics-migrating-legacy-power-bi-to-dbt-in-microsoft-fabric/):

1. Agent extracts a written spec of the business rule from each DAX measure.
2. Agent generates dbt models / target code from the spec, not from the DAX.

The spec is a human-reviewable checkpoint. Catches "the original DAX was wrong" cases that pure transpilation would silently propagate.

Orchestration frameworks mentioned: **AutoGen Studio** (Microsoft, now in maintenance mode → "Microsoft Agent Framework"), **LangGraph** (portable, framework-agnostic), and the **[`data-goblins/power-bi-agentic-development`](https://github.com/data-goblins/power-bi-agentic-development)** repo of skills/subagents/hooks for Power BI work.

### c) MCP servers exposing Power BI artifacts

The most forward-looking pattern: don't build a converter, give an agent the model and let it do the work.

- **[`pbixray-mcp-server`](https://playbooks.com/mcp/jonaolden/pbixray-mcp-server)** — exposes `pbixray` parsing as MCP tools. A Claude/Cursor session can load a PBIX, list measures, view DAX, walk relationships interactively.
- An MCP wrapper around `microsoft/semantic-link-labs` is a natural next project for the live-workspace side.

This direction matches the agentic pattern from [`agentic-self-improvement`](../agentic-self-improvement/README.md) in this repo: persistent memory + reflection beats single-pass extraction for any task this lossy.

## 5. Realistic migration playbook

For a team actually doing this, the synthesis from across the survey:

1. **Inventory**: `semantic-link-labs` (Fabric/Premium) or `pbixray` + Power BI Scanner API (Pro/local). Catalog datasets, measures, M sources, refresh schedules, RLS roles, report→dataset graph, and (critically) usage stats.
2. **Rationalize ruthlessly**. Hakkōda's Sigma BI Analyst is one off-the-shelf option. Otherwise SQL queries against the metadata catalog. Migrate the survivors only.
3. **Convert PBIX → PBIP (TMDL)**. Now everything is plain text and diff-able.
4. **Convert the data prep first** (M → dbt or warehouse SQL). M is usually shallow — connections plus light transforms — and dbt is functionally a superset.
5. **Convert measures.** This is the bottleneck and where AI is most useful. Options in increasing order of automation:
   - Manual rewrite (default for high-value measures).
   - LLM-assisted with golden-output validation (compare DAX vs generated code aggregate-by-aggregate).
   - AtScale SML Converter if the destination is "semantic layer with Power BI optionally retained on top."
6. **Rebuild reports** in the destination tool. Visuals don't translate; layouts get redesigned. No tool automates this convincingly — it's wedding-photographer work.
7. **Cut over with parallel run.** Run both stacks for one release cycle, diff KPIs nightly, deprecate when diffs go to zero.

Steps 1–4 are well-tooled. Step 5 is the migration's center of gravity. Step 6 stays manual.

## 6. Tool quick-reference table

| Tool | Layer | Direction | License | Use when |
|---|---|---|---|---|
| Tabular Editor 2 | Semantic model | Bidir (PBI ↔ TMDL/.bim) | OSS | Default extraction tool |
| Tabular Editor 3 | Semantic model | Bidir | Paid | Larger teams; better UX |
| pbi-tools | PBIX ↔ PBIP/TMDL | Bidir | OSS | CI/CD, automation |
| pbixray | PBIX → metadata/DAX/M | One-way (read) | OSS | Build-your-own pipelines |
| pbi_parsers | DAX/M AST | One-way | OSS | Code-walking, transpilers |
| semantic-link-labs | Live workspace | Bidir | OSS (MS) | Fabric / Premium notebooks |
| AtScale SML Converter | DAX measures → SML | One-way | Commercial | Destination is AtScale |
| dbt SL Power BI Connector | MetricFlow → Power BI | Wrong direction | Commercial | Power BI staying as front-end |
| Hakkōda Sigma BI Analyst | Inventory only | Read | Free (Snowflake app) | Pre-migration assessment |
| BIPort / Pulse Convert / EZConvertBI | Tableau → PBI | Wrong direction | Commercial | (Reference only) |
| DataTerrain Any-to-Any | All layers | Power BI → various | Services | Enterprise services budget |
| Travinto X2X | Dataflows → Looker | One-way | Services | Niche dataflow conversion |
| `thoughtspot_tml` | TML generation | Output side | OSS | Destination is ThoughtSpot |
| `lkml2cube` | LookML ↔ Cube | Bidir (no PBI) | OSS | Two-step via Looker |
| Timbr | DAX measures → SQL | One-way | Commercial | Niche; Timbr destination |
| pbixray-mcp-server | Expose model to LLM | Read | OSS | Agentic migration |

## 7. Gaps in the market (where someone could build something)

- **A native, OSS DAX → MetricFlow YAML transpiler** with golden-output validation harness. Nothing in this slot. The pieces (pbixray, pbi_parsers, MetricFlow YAML schema) all exist.
- **A DAX → Cube model converter.** lkml2cube exists; the equivalent for DAX doesn't. Same building blocks.
- **An MCP server wrapping `semantic-link-labs`** so coding agents can drive a live Fabric workspace, not just static PBIX files.
- **A reusable "aggregate-diff" validation harness** that takes a DAX measure and a candidate target-language definition, picks slicer combinations intelligently, and reports semantic drift. Several teams clearly do this internally; nobody has packaged it.
- **A canonical DAX → SQL pattern library** as data, not prose. Could feed any LLM-translator. Filter context, time intelligence, and iterators as the priority categories.

## 8. Direct sources

- Power BI / TMDL / PBIP — [TMDL view](https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-tmdl-view), [PBIP overview](https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-overview), [PBIR blog](https://powerbi.microsoft.com/en-us/blog/power-bi-enhanced-report-format-pbir-in-power-bi-desktop-developer-mode-preview/)
- Tabular Editor — [Useful script snippets](https://docs.tabulareditor.com/te2/Useful-script-snippets.html), [SQLBI](https://www.sqlbi.com/tools/tabular-editor/), [LLMs for TE C# scripts](https://tabulareditor.com/blog/using-llms-to-create-c-scripts-for-tabular-editor)
- pbi-tools — [pbi.tools/tmdl](https://pbi.tools/tmdl/)
- Semantic Link Labs — [microsoft/semantic-link-labs](https://github.com/microsoft/semantic-link-labs), [Data Goblins overview](https://data-goblins.com/power-bi/semantic-link-labs)
- PBIX parsers — [Hugoberry/pbixray](https://github.com/Hugoberry/pbixray), [pbi_parsers](https://douglassimonsen.github.io/pbi_parsers/), [PyDaxExtract](https://pypi.org/project/PyDaxExtract/)
- Cube — [lkml2cube blog](https://cube.dev/blog/introducing-a-tool-for-looker-to-cube-migration), [lkml2cube repo](https://github.com/cube-js/lkml2cube)
- AtScale — [Power BI to SML Converter](https://www.atscale.com/blog/unlock-power-bi-semantic-models/), [Optimize Power BI brief](https://www.atscale.com/resource/optimize-power-bi-atscale/)
- dbt SL — [Power BI integration](https://docs.getdbt.com/docs/cloud-integrations/semantic-layer/power-bi), [MetricFlow](https://docs.getdbt.com/docs/build/about-metricflow)
- Sigma + Hakkōda — [Sigma BI Analyst app](https://hakkoda.io/resources/sigma-bi-analyst-by-hakkoda/), [Sigma migration page](https://www.sigmacomputing.com/go/migrate-with-hakkoda)
- DataTerrain — [Power BI → Tableau](https://dataterrain.com/power-bi-to-tableau-migration), [automation services](https://dataterrain.com/automation-driven-bi-migration-services)
- Pulse Convert — [Microsoft Marketplace listing](https://marketplace.microsoft.com/en-us/product/saas/officesolution1640276900203.pulse_convert_1?tab=overview)
- BIPort — [Sparity accelerator](https://www.sparity.com/accelerators/tableau-to-power-bi-migration-accelerator/)
- Timbr — [DAX vs SQL post](https://timbr.ai/blog/why-sql-beats-dax-hands-down-for-power-bi-metrics/)
- AIS specification-driven — [blog](https://www.ais.com/from-knowledge-debt-to-governed-analytics-migrating-legacy-power-bi-to-dbt-in-microsoft-fabric/)
- Agentic Power BI dev — [data-goblins/power-bi-agentic-development](https://github.com/data-goblins/power-bi-agentic-development), [SQLBI agentic intro](https://www.sqlbi.com/articles/introducing-ai-and-agentic-development-for-business-intelligence/)
- ThoughtSpot — [TML docs](https://docs.thoughtspot.com/cloud/latest/tml-import-export-multiple), [thoughtspot_tml repo](https://github.com/thoughtspot/thoughtspot_tml)
- Snowflake Cortex Analyst — [agentic semantic model post](https://www.snowflake.com/en/engineering-blog/agentic-semantic-model-text-to-sql/)

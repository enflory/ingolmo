# Notes: Abhi Sivasailam's AI BI pattern (v0 + json-render + shadcn + analytics agent)

Starting log: 2026-05-05.

## The quote

From Abhi Sivasailam in Locally Optimistic's Slack:

> My new pattern is to use v0 to make interactive data apps and json-render with custom shadcn components to make classic BI. I have an analytics agent that generates the json-render schema as a structured output and then charts and dashboards fall out of those.

## Decomposition

Three distinct things are happening, and they should not be conflated:

1. **v0 for interactive data apps** — Vercel's v0 (generate-a-React-app from a prompt) is being used to bootstrap *bespoke*, one-off "data apps" — workflows with embedded charts, filters, drill-downs, narrative. Output is React/Next.js code, deployable.
2. **json-render with custom shadcn components for "classic BI"** — i.e., the standard chart/table/KPI dashboard genre. Here you don't generate code. You generate a JSON document (a schema) that a *generic* renderer turns into a dashboard. The renderer's vocabulary is a fixed set of shadcn-based components (kpi-card, line-chart, bar-chart, table, filter, layout grid).
3. **An analytics agent that emits the json-render schema as structured output** — the LLM is constrained to a JSON schema (structured outputs / JSON mode / tool-use); the renderer consumes the validated JSON. Charts and dashboards "fall out" because the renderer is deterministic given the JSON.

The split matters: (1) is generative-code for non-routine apps; (2)+(3) is a *headless-BI* pattern where the LLM produces specs and the runtime is dumb. The classic BI half is the more reusable, governable artifact.

## Prior art and adjacent threads in this repo

- `power-bi-migration-tools/README.md` — the AIS specification-driven pattern (extract a NL spec from each DAX measure, regenerate dbt from spec) is the same shape: agent emits a structured artifact, deterministic generator consumes it. That repo's section §4 directly sets up the gap this pattern fills.

## Things I want to nail down

- Who is Abhi Sivasailam — establish credibility/context.
- What exactly is "json-render"? Is this an existing library (e.g., JSON Forms, react-jsonschema-form, Tremor's spec format, Vega-Lite, Plotly's figure JSON), or is he naming his own internal thing?
- What is the schema vocabulary likely to look like?
- How does the structured-output side actually work with current models (Anthropic, OpenAI) — JSON Schema vs grammar vs tool-use.
- What are the failure modes?
- Where does this fit relative to: Hex Magic, Vanna, Snowflake Cortex Analyst, Looker Studio, Tremor, Tableau Pulse, Mode AI, ThoughtSpot Sage, Streamlit / Evidence / Observable.

## Search plan

1. Identify Abhi Sivasailam.
2. Find any blog post / talk where he expanded on this pattern beyond the Slack one-liner.
3. Survey "json-render" candidates.
4. Survey shadcn chart libraries (shadcn/ui charts, Tremor, Recharts wrappers).
5. Survey LLM structured-output for chart/dashboard specs.
6. Pull together what the actual implementation looks like.

## Key facts established (json-render side)

- **json-render** is a Vercel Labs OSS project (Apache-2.0, repo: github.com/vercel-labs/json-render). Announced March 2026 (InfoQ). Currently at 0.18.0.
- It is **not** a thing Abhi invented. He's using a Vercel-shipped framework off the shelf.
- The slogan is "the Generative UI framework". Tagline: "AI generates JSON, you render it safely."
- Architecture (3 layers):
  1. **Catalog** — `defineCatalog(schema, { components, actions })` with Zod prop schemas. Each component has `props` (Zod), `description`, `slots`, optional `example`. Actions have `params` (Zod) + `description`.
  2. **AI generation** — Two routes:
     - **JSONL streaming mode** (default in dashboard example): `streamText` (Vercel AI SDK) with `system: catalog.prompt()`. Model emits one RFC-6902 JSON-Patch operation per line. `useUIStream` on the client compiles patches into a live spec, rendering progressively.
     - **Structured-output mode**: `catalog.jsonSchema({ strict: true })` returns a JSON Schema usable by OpenAI/Anthropic/Gemini structured-output APIs. The whole spec is one object the model emits in one shot (no streaming).
     - YAML wire format is also supported (`@json-render/yaml`) — same idea, YAML in a fenced block, supports unified-diff edits.
  3. **Renderer** — `<Renderer spec={spec} registry={registry} />`. Registry maps each catalog component name to a real React component.
- **Spec shape** is *flat*, not nested:
  ```
  { root: "card-1",
    elements: { "card-1": { type: "Card", props: {...}, children: ["btn-1"] }, ... },
    state: {...} }
  ```
  The flat-elements form (vs. nested children) is what makes JSON-Patch surgical edits + streaming + dynamic refs work.
- **Dynamic prop expressions** in spec values:
  - `{ "$state": "/path" }` — read state
  - `{ "$bindState": "/path" }` — two-way bind
  - `{ "$cond": cond, "$then": ..., "$else": ... }`
  - `{ "$template": "Hello, ${/user/name}!" }`
  - `{ "$computed": "fn", "args": {...} }`
  - This is how you parameterize charts/tables: `data: { "$state": "/customers/data" }` lets the renderer pull the table from state filled by an action.
- **Visibility** and **watchers** also live in the spec — `visible: [...]`, `watch: { "/path": { action, params } }`. So the JSON itself encodes interactivity (filters, drill-downs), not just static layout.
- **Shadcn shipping** — `@json-render/shadcn` ships 36 ready-built components with matching catalog definitions. You can pick a subset and override.
- **Charts** — the `examples/dashboard` registry uses **Recharts** under the hood (`RechartsBarChart`, `RechartsLineChart`, `Bar`, `Line`, `XAxis`, `CartesianGrid`, `ChartContainer`, `ChartTooltip`). The catalog only exposes BarChart and LineChart (props: title, data, xKey, yKey, aggregate, color, height) — i.e. it's deliberately a small grammar for the LLM. shadcn's own "Charts" block ships these wrappers (the `ChartContainer`/`ChartConfig` from shadcn ui).
- **Default model** in the dashboard example is `anthropic/claude-haiku-4.5` via Vercel AI Gateway.
- **Why JSON instead of code** (per docs):
  - Safety — no arbitrary code execution
  - Consistency — output always matches schema
  - Cross-platform — same spec → React Native, PDF, email, video, Three.js, terminal
  - Debuggability — structured data > generated code

## Mapping Abhi's quote to concrete pieces

| Abhi's phrase | Concrete piece |
|---|---|
| "use v0 to make interactive data apps" | Vercel v0 (now with DB connectors as of Feb 2026) generates Next.js + shadcn apps. Used for the *non-routine* one-off data apps: e.g. a custom workflow tool with embedded analytics. |
| "json-render with custom shadcn components to make classic BI" | `@json-render/shadcn` + custom-registered components like KPI/Metric/SparklineCard. The "classic BI" set: KPI cards, line/bar/pie, tables, filter bar, layout grid. |
| "an analytics agent that generates the json-render schema as a structured output" | An LLM constrained either via JSONL/Patch streaming (`catalog.prompt()` + `streamText`) or strict JSON-Schema structured outputs (`catalog.jsonSchema({ strict: true })`). |
| "charts and dashboards fall out of those" | Because the renderer is deterministic given a valid spec, the moment the agent emits a valid JSON, the dashboard exists. No code-gen. No build step. |

## What separates v0 (route 1) from json-render (route 2)

- **v0 generates code**: bespoke React/Next.js source you commit and host. Good for one-off apps with custom interactions; bad for runtime composability and governance (every change is a code review).
- **json-render generates data**: a JSON spec that a *fixed* runtime renders. Good for high-volume, governed BI (every "dashboard" is data, persisted in Postgres in the example, diffable, regenerable, sandboxed). Bad if you need to escape the catalog.
- Abhi's split is sensible: use v0 for the long tail of weird internal tools, use json-render for the stuff that looks like Tableau/Looker output.

## Analytics agent + structured output: how the LLM is actually constrained

Two routes, both first-class in json-render's `Catalog` API:

1. **JSONL streaming patches** (`catalog.prompt()`)
   - System prompt = catalog summary + RFC-6902 tutorial + small, **catalog-grounded** example.
   - Model emits `{op, path, value}` lines. `useUIStream`/`createSpecStreamCompiler` reduces them.
   - **Pros**: streams; partial UI shows up fast; supports edits (`replace`, `remove`) → "modify the existing spec" flows for iterative refinement.
   - **Cons**: relies on prompt adherence, not API-level constraint. Schema drift possible. No hard guarantee of validity until compiled.

2. **Strict JSON Schema structured outputs** (`catalog.jsonSchema({ strict: true })`)
   - The catalog is exported as a JSON Schema "subset" (`additionalProperties: false`, all fields in `required`, optionals as nullable, records collapsed).
   - Goes into:
     - OpenAI `response_format: { type: "json_schema", json_schema: { schema, strict: true } }`.
     - Anthropic tool-use (`input_schema`) — same idea, expressed as a forced tool call.
     - Gemini `response_schema`.
   - **Pros**: guaranteed valid JSON, no patch parser, single-shot. Smaller model failure surface.
   - **Cons**: no streaming → first paint blocked on the full generation. The catalog `record(...)` types collapse to opaque objects in strict schema (the codebase comment calls this out explicitly).

The Levers Labs / Abhi flavor of this pattern strongly implies route 2 ("structured output"). His sentence "generates the json-render schema as a structured output" is the OpenAI-vocabulary term-of-art; route 1 is "JSON Patch streaming," which he didn't say. So mentally, the agent he describes is doing schema-constrained one-shot generation — probably gpt-5/claude-4-something with json-schema guarantees — and the renderer takes it from there.

In practice, most production use will mix: structured output for the *initial* spec, streaming patches for *edits* ("make the second chart a line, not bar").

## Where the data actually comes from

Critical detail that the quote glosses: the agent doesn't conjure numbers. The dashboard example wires this via **actions**: each action maps to a REST endpoint. So:

- LLM emits a spec with `data: { $state: "/queries/wau/rows" }` and a `watch` that calls `runQuery({ queryId: "wau" })` on filter change.
- The frontend's action handler hits `/api/v1/queries/wau`, which itself fans out to a semantic layer (dbt SL, Cube, MetricFlow, Snowflake Cortex, AtScale SML) and returns rows.
- State updates → Recharts re-renders.

So the *actual* trust boundary is:
- Semantic layer = governed business definitions (no LLM hallucinated joins).
- Catalog = governed UI vocabulary (no rogue components).
- The LLM is only allowed to *compose* governed pieces; it can't introduce a new metric or a new chart type.

This is the architectural insight from the Levers Labs metric-tree thesis applied to the visualization layer. The "metric tree" in the data layer + the "component catalog" in the UI layer = two governance choke points the agent operates between.

## Prior art and adjacents (mostly 2026)

- **Vega-Lite** (UW Interactive Data Lab) — JSON grammar for *charts*. The natural alternative chart-spec format. Many text-to-chart papers (VegaChat, chart-llm) target it. Strengths: well-documented grammar, mature, single-chart focus. Weaknesses: not a *dashboard* spec, and not a UI-component spec — interactivity beyond brush/zoom is awkward; KPIs/filters/tables aren't first-class. **json-render relates to Vega-Lite as Tableau dashboards relate to a single Vega-Lite chart**: composition is the unit, not the visualization.
- **Google A2UI** (announced Q1 2026, v0.9 May 2026) — open standard for generative UI. Same shape: client owns a catalog of trusted components, server (agent) emits flat streaming JSON, validator + self-correct loop. **The portable answer to json-render**. Likely cross-pollinates with json-render over time; CopilotKit already has interop examples. If the field standardizes, the catalog format is the *bet*; renderers commodify.
- **Tremor** (now Tremor Labs / part of LangChain ecosystem) — React component library specifically for dashboards. Pre-shadcn; ships chart, KPI, grid, etc. Often used as the *output target* of an LLM that emits Tremor JSX. No native JSON-spec story; you emit code.
- **Snowflake Cortex Analyst** — text-to-SQL grounded in a YAML semantic model. Returns rows + a chart; the chart is a vendor-locked output. Lives upstream of the json-render layer (it's the "where do the rows come from" question). Pairs well: Cortex Analyst as the action handler, json-render as the rendering grammar.
- **Tableau Pulse** — vendor-locked NL summaries on existing Tableau workbooks. Doesn't generate dashboards from scratch — it *reads* them. Different shape.
- **Hex Magic / Notebook Agent** — code-first; the artifact is a notebook with cells the agent fills in. The closest "AI-generated analytics surface" but it's notebook-shaped, not dashboard-shaped.
- **Databricks AI/BI** — proprietary text-to-dashboard. Closest commercial competitor to the Abhi pattern; you give up portability for managed integration.
- **ThoughtSpot Spotter / Sage** — multi-agent (Spotter / SpotterViz / SpotterModel / SpotterCode). Closest analog to "analytics agent that generates dashboards." Sells governance of the semantic layer + agent-orchestrated viz. Closed.
- **CopilotKit Generative UI** — open glue: AG-UI/A2UI/MCP Apps protocols, similar idea, more chat-frontend-flavored than dashboard-flavored.

## Why this pattern is interesting (the Abhi-thesis read)

Sivasailam's published work has been pushing two ideas for years:

1. **Metric trees** — the atomic unit of analytics is the *metric*, not the *table*. Metrics decompose into a DAG. Analytics tooling should be metric-native ([leverslabs.com/article/introducing-metric-trees](https://www.leverslabs.com/article/introducing-metric-trees)).
2. **Self-serve analytics has failed because of bad abstractions, not bad UIs** ("You don't need the Modern Data Stack to get sh*t done", Hightouch blog).

The v0+json-render combo is interesting because it pushes *both* abstractions one level up:

- The data abstraction is the metric tree (governed in dbt SL / Cube / Snowflake YAML).
- The UI abstraction is the catalog (governed in Zod, owned by the developer).
- The LLM's job is the part that always *was* "wedding-photographer work" (per `power-bi-migration-tools/README.md`): composing the two governed vocabularies into a viewable artifact.

So instead of "LLM as analyst" (which has a reliability ceiling because it has to hallucinate joins and chart libraries) it becomes "LLM as compositor" (which is much more tractable because both vocabularies are typed and small).

The bet: the long tail of "I want a dashboard that shows X cut by Y" disappears as a Jira ticket. It becomes a 30-second conversation that emits a JSON spec, persisted, editable, governable.

## Failure modes and open questions

- **Catalog completeness vs. expressiveness**: every chart type the agent might emit must be in the catalog. Easy for KPIs and standard charts. Hard for niche viz (sankey, bullet, maps, custom small multiples). The catalog inevitably grows; the prompt grows; the model gets confused. Mitigation: per-domain sub-catalogs (one for finance dashboards, one for funnels) instead of a single mega-catalog.
- **Prompt budget**: `catalog.prompt()` lists every component + props + actions in the system prompt. Even with caching this is a fixed cost per request. At 20+ components × 5+ props × actions × example each, you're looking at thousands of tokens of system prompt. The current Vercel AI SDK with prompt caching makes this acceptable on Anthropic, less so on others.
- **Aggregation truthiness**: `BarChart` has an `aggregate: 'sum' | 'count' | 'avg'` prop that aggregates *client-side* in the registry. That means the *data fetched by the action* must be the raw rows. If the LLM picks the wrong `aggregate`, you get a believable-looking-but-wrong number. Mitigation: do all aggregation in the semantic layer; expose only `data` as the pre-aggregated series.
- **State path collisions**: the agent has free reign over `$state` paths. Two widgets binding the same path is a feature; two widgets accidentally clobbering the same path is a bug. Convention: path = `/<actionName>/<idempotencyKey>`. The example dashboard has this implicitly (`customers.data`, `invoices.data`).
- **Data freshness / cache**: state is in-memory; a refresh re-runs every action. Page reload regenerates from spec stored in Postgres → re-runs actions on render. Heavy fan-out for a many-tile dashboard; needs the action layer to dedupe / batch.
- **Edits at scale**: streaming JSON-Patch is great for "small follow-up edit" but breaks down for a wholesale refactor ("redo this dashboard but for finance"). For those, regenerate from scratch.
- **Drilldown is shallow**: `drillDown` action is fine but anything pivoty (cross-filter across all tiles, "what-if" on a metric) needs more state machinery than the catalog gives you. This is the next plateau.

## Worked example artifact

`example-catalog.ts` in this directory contains a minimal "BI catalog" with: DashboardGrid, GridTile, KPI (with sparkline), LineChart, BarChart, Table, DateRangeFilter, SegmentFilter, Heading, Insight; plus actions `runMetric`, `runQuery`, `drillDown`. Includes an example assembled spec for a "Growth dashboard" with MRR KPI, WAU-by-plan line chart, and a top-accounts table — all `$state`-bound to action results.

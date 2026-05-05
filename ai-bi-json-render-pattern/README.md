# AI BI via v0 + json-render: deep read of the Abhi Sivasailam pattern

Researched May 2026. Source quote (Locally Optimistic Slack, paraphrased to public form):

> My new pattern is to use v0 to make interactive data apps and json-render with custom shadcn components to make classic BI. I have an analytics agent that generates the json-render schema as a structured output and then charts and dashboards fall out of those.
> — Abhi Sivasailam, founder/CEO [Levers Labs](https://www.leverslabs.com/about)

This report explains what each piece is, how they fit, what the architecture actually looks like in code, and where the pattern fits relative to existing AI-BI work.

## TL;DR

- **The quote is two patterns, not one.** Use them for different jobs.
  - `v0` → bespoke, *one-off* interactive data apps. Output is committed React/Next.js code.
  - `json-render` → governed, *high-volume* "classic BI" (dashboards, KPI tiles, line/bar/table). Output is a JSON spec a fixed runtime renders.
- **`json-render` is a real Vercel Labs OSS framework** ([vercel-labs/json-render](https://github.com/vercel-labs/json-render), Apache-2.0, announced [March 2026 via InfoQ](https://www.infoq.com/news/2026/03/vercel-json-render/), at v0.18.0 by May 2026). Abhi did **not** invent it; he's using it off the shelf. The framework ships an `examples/dashboard` that *is* the pattern, complete with shadcn primitives, Recharts, action wiring, and Postgres persistence.
- **The pattern's three governance choke points**:
  1. The **semantic layer** (dbt SL / Cube / MetricFlow / Snowflake YAML / AtScale SML) — what metrics exist, what their definitions are.
  2. The **catalog** — what UI components exist, what props they accept (Zod-typed).
  3. The **action surface** — what the agent is allowed to ask the backend to do (typed, REST-mapped).
- **The LLM's role is composition, not invention.** It picks among governed metrics and governed components. It cannot introduce a new chart type or a new metric definition. This is why Abhi calls it "classic BI": the *output is dashboards*, but the *production model is metric-tree analytics with a generative front end*.
- **Two ways to constrain the LLM**, both first-class in `json-render`:
  - **Streaming JSONL with RFC-6902 JSON Patch** — `streamText` with `system: catalog.prompt()`. Default in the Vercel demo. Streams; allows surgical edits; no API-level guarantee.
  - **Strict JSON Schema structured outputs** — `catalog.jsonSchema({ strict: true })` then OpenAI/Anthropic/Gemini structured-output APIs. One-shot, valid by construction, no streaming. Abhi's "structured output" phrasing matches this route.
- **The pattern's center of gravity** is *not* the LLM. It's the catalog you build. A bad catalog produces bad dashboards no matter the model; a good catalog (small vocabulary, semantically rich descriptions, typed actions) lets a small/cheap model do the job. The Vercel demo runs on `claude-haiku-4.5`.

## How to read this report

§1 is the architecture in concrete terms. §2 is the actual code shape from the Vercel demo. §3 is what makes this pattern *Abhi's* read on AI-BI vs adjacent ones. §4 surveys the prior-art neighborhood. §5 is failure modes. §6 is what you'd need to actually build. §7 is sources.

A worked example catalog + spec is in [`example-catalog.ts`](./example-catalog.ts) in this directory. The full investigation log is in [`notes.md`](./notes.md).

## 1. Architecture: what the three pieces actually do

```
┌──────────────────────────────────────────────────────────────────┐
│ v0 (route 1): "interactive data apps" — bespoke one-offs         │
│                                                                  │
│ Prompt → v0 → Next.js + shadcn + DB connector code               │
│ (Snowflake/AWS as of v0 Feb 2026 update). You ship code.         │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ json-render (route 2): "classic BI" — high-volume governed       │
│                                                                  │
│  ┌─────────────┐    ┌──────────────┐   ┌──────────────────┐     │
│  │ User prompt │ →  │ Analytics    │ → │ JSON spec        │     │
│  │             │    │ agent (LLM)  │   │ (catalog-bound)  │     │
│  └─────────────┘    └──────────────┘   └────────┬─────────┘     │
│                            ▲                    │               │
│            ┌───────────────┘                    ▼               │
│            │ catalog.prompt()        ┌────────────────────────┐ │
│            │  or .jsonSchema()       │ Renderer (React +      │ │
│            │                         │  shadcn + Recharts)    │ │
│  ┌─────────┴──────┐                  └──────────┬─────────────┘ │
│  │ Catalog        │                             │               │
│  │ (Zod schemas:  │   ┌── action: runMetric ────┘               │
│  │  components +  │   │   → semantic layer (dbt SL/Cube/Cortex) │
│  │  actions)      │   │   → REST endpoint → state slot          │
│  └────────────────┘   │                                         │
│                       └── { $state: "/queries/<id>/rows" }      │
└──────────────────────────────────────────────────────────────────┘
```

The two routes are *not competing*. v0 wins for a one-off "log analyzer for shipping anomalies" app. json-render wins for "generate a Growth dashboard for the new SKU we launched" — the work BI tools have always done, just driven by a prompt instead of a Jira ticket.

### Catalog (the UI vocabulary)

```ts
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

const catalog = defineCatalog(schema, {
  components: {
    KPI: {
      props: z.object({
        label: z.string(),
        value: z.union([z.number(), z.string()]),
        format: z.enum(["currency", "percent", "number"]).nullable(),
        delta: z.number().nullable(),
      }),
      description: "Single-metric tile.",
    },
    LineChart: {
      props: z.object({
        title: z.string().nullable(),
        data: z.array(z.record(z.string(), z.unknown())),
        xKey: z.string(),
        yKey: z.string(),
        seriesKey: z.string().nullable(),
      }),
      description: "Line chart over time.",
    },
    // ...
  },
  actions: {
    runMetric: {
      params: z.object({
        metricId: z.string(),
        grain: z.enum(["day","week","month","quarter"]).nullable(),
        dateRange: z.object({ from: z.string(), to: z.string() }).nullable(),
      }),
      description: "Execute a governed metric. Result lands at /metrics/<id>.",
    },
  },
});
```

This object is the contract. It generates **two** artifacts:

- `catalog.prompt()` — the system prompt for streaming mode.
- `catalog.jsonSchema({ strict: true })` — the JSON Schema for structured-output mode (compatible with OpenAI/Anthropic/Gemini's strict-output APIs; emits `additionalProperties: false`, optionals as nullable, all keys in `required`).

### Spec shape (what the agent emits)

```jsonc
{
  "root": "grid",
  "state": { "filters": { "dateRange": { "from": "...", "to": "..." } } },
  "elements": {
    "grid": { "type": "DashboardGrid", "props": {...}, "children": ["mrr", "wau"] },
    "mrr":  { "type": "KPI", "props": {
                "label": "MRR",
                "value": { "$state": "/metrics/mrr/value" },
                "format": "currency"
              }, "children": [] },
    "wau":  { "type": "LineChart", "props": {
                "data": { "$state": "/queries/wau/rows" },
                "xKey": "week", "yKey": "users", "seriesKey": "plan"
              },
              "watch": { "/filters/dateRange": {
                "action": "runQuery",
                "params": { "queryId": "wau",
                            "params": { "range": { "$state": "/filters/dateRange" } } }
              }},
              "children": [] }
  }
}
```

Spec is **flat** (`elements` is a map keyed by id, not a nested tree). That's deliberate — RFC 6902 patches need stable paths to update, and `$state` references need stable ids. This single design choice is what makes streaming, surgical edits, and dynamic data binding all coexist.

### The expression mini-language inside `props`

Anywhere a prop value goes, json-render allows:

| Form | Meaning |
|---|---|
| `{ "$state": "/path" }` | Read state |
| `{ "$bindState": "/path" }` | Two-way bind (inputs) |
| `{ "$cond": cond, "$then": ..., "$else": ... }` | Branch |
| `{ "$template": "Hello, ${/user/name}!" }` | String interpolate |
| `{ "$computed": "fn", "args": {...} }` | Call registered function |
| `visible: [...]` (top-level on element) | Conditional visibility |
| `watch: { "/path": { action, params } }` | React to state change |

So the JSON itself encodes interactivity: filters write state, charts read state, watchers fire actions on change. The "dashboard" is fully expressed as data; the runtime is dumb.

## 2. The reference implementation: `examples/dashboard`

The Vercel demo (`vercel-labs/json-render/examples/dashboard`) is the textbook implementation of Abhi's pattern. Reading it is faster than reading any blog post.

- `lib/render/catalog.ts` — catalog with shadcn primitives + `BarChart` + `LineChart` + `Table` and seven typed actions (`viewCustomers`, `createInvoice`, `approveExpense`, …).
- `lib/render/registry.tsx` — maps each component name to a real React implementation. Charts use **Recharts** wrapped in shadcn's `ChartContainer` / `ChartTooltip` / `ChartConfig` (the official shadcn Charts block).
- `app/api/generate/route.ts` — the LLM call:
  ```ts
  const SYSTEM_PROMPT = dashboardCatalog.prompt();
  // ...
  const result = streamText({
    model: process.env.AI_GATEWAY_MODEL || "anthropic/claude-haiku-4.5",
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    temperature: 0.7,
  });
  return result.toTextStreamResponse();
  ```
- `components/widget.tsx` — `useUIStream` from `@json-render/react` consumes the stream, builds the spec progressively, persists final spec + prompt to Postgres via Drizzle. Add/edit/reorder via `@dnd-kit`.

The system prompt produced by `catalog.prompt()` (default `mode: "standalone"`) tells the model: emit JSONL where each line is an RFC-6902 JSON Patch op (`add`, `replace`, `remove`) building up `/root`, `/elements/*`, `/state/*`. Example included from the catalog itself, so component names and props in the example aren't hallucinated. From `packages/core/src/schema.ts`:

> Output JSONL (one JSON object per line) using RFC 6902 JSON Patch operations to build a UI tree. Each line is a JSON patch operation (add, remove, replace). Start with /root, then stream /elements and /state patches interleaved so the UI fills in progressively as it streams.

Result on the wire: an LLM streams into a `<Renderer>` and pixels appear as soon as the first `/root` and root-element ops land.

## 3. What makes this *Abhi's* read on AI-BI

Sivasailam's published thesis ([Levers Labs blog](https://www.leverslabs.com/article/introducing-metric-trees), [dbt Roundup interviews](https://roundup.getdbt.com/p/ep-33-how-does-data-drive-growth)) has consistently been:

1. **Metrics, not tables, are the atomic unit of analytics.** Metric trees decompose a North Star into a DAG of definitions. Each metric has exactly one definition.
2. **Self-serve has failed because of bad abstractions, not bad UIs.** The right move is fewer, better abstractions, not a slicker query builder.

The v0 + json-render combo applies that thesis to the *visualization* layer:

| Abstraction | Where it lives | Who governs |
|---|---|---|
| Metric definitions | dbt SL / Cube / MetricFlow / Cortex YAML | Data team |
| Action surface | json-render `actions` | Backend team (small, REST-mapped) |
| UI vocabulary | json-render `components` (Zod) | Design / FE team |
| Dashboard composition | LLM-emitted JSON spec | Anyone with a prompt |

The model is **never** allowed to write SQL, define a metric, or invent a chart type. It composes pre-built primitives over pre-defined metrics. That's why Abhi can say "classic BI" with a straight face: from the consumer's point of view, the output is a normal-looking dashboard. From the system's point of view, the LLM's role has been compressed to the part that's reliably tractable — picking which tile shows which metric.

This is the same shape as the AIS specification-driven Power BI migration pattern surveyed in [`../power-bi-migration-tools/README.md`](../power-bi-migration-tools/README.md) §4b: agent emits a structured artifact, deterministic generator consumes it, with a human-reviewable checkpoint in between. There the artifact is a NL spec for a metric; here it's a JSON spec for a dashboard. Same trick, different layer.

## 4. Prior art and adjacents (May 2026)

| System | Shape | How it relates |
|---|---|---|
| **Vega-Lite** ([UW IDL](https://vega.github.io/vega-lite/)) | JSON grammar for *charts* | Closest precedent for "chart as JSON spec." json-render relates to Vega-Lite as Tableau dashboards relate to a single chart — composition is the unit. Many text-to-chart papers (VegaChat, chart-llm) target Vega-Lite. |
| **Google A2UI v0.9** ([blog post](https://developers.googleblog.com/a2ui-v0-9-generative-ui/)) | Open standard for generative UI | Same shape as json-render: client-owned catalog, agent emits flat streaming JSON, validator + self-correct. Likely the *standard* answer. CopilotKit already has interop. |
| **Vercel v0** ([vercel.com/blog](https://vercel.com/blog/introducing-the-new-v0)) | Generates React/Next.js code | The *other half* of Abhi's quote. Best for one-off apps; outputs committable code with DB connectors. |
| **shadcn/ui charts** ([ui.shadcn.com/charts](https://ui.shadcn.com/charts/area)) | Recharts wrappers | The actual rendering primitives `@json-render/shadcn` and the Vercel demo registry use. Abhi's "custom shadcn components" lives here. |
| **Tremor** | React dashboard component lib | Often the *output target* of a code-emitting LLM. No native JSON-spec story. |
| **Snowflake Cortex Analyst** ([engineering blog](https://www.snowflake.com/en/engineering-blog/agentic-semantic-model-text-to-sql/)) | Text-to-SQL grounded in YAML semantic model | Lives upstream of json-render. Pairs naturally as the action handler ("run this metric"). |
| **Tableau Pulse** ([tableau.com/products/tableau-pulse](https://www.tableau.com/products/tableau-pulse)) | NL summaries on existing workbooks | Reads dashboards, doesn't generate them. Different shape. |
| **Hex Magic / Notebook Agent** ([hex.tech/blog](https://hex.tech/blog/introducing-notebook-agent/)) | Agent-edited notebooks | Code-first; artifact is a notebook. Closest "AI-generated analytics surface" but notebook-shaped, not dashboard-shaped. |
| **Databricks AI/BI** ([databricks.com](https://www.databricks.com/product/business-intelligence/ai-bi-dashboards)) | Proprietary text-to-dashboard | Closest commercial competitor. Managed integration; no portability. |
| **ThoughtSpot Spotter / Sage** ([thoughtspot.com](https://www.thoughtspot.com/data-trends/dashboard/ai-dashboard)) | Multi-agent: Spotter / Viz / Model / Code | The most agent-y commercial BI. Closed; semantic model is theirs. |
| **CopilotKit Generative UI** ([github.com/CopilotKit/generative-ui](https://github.com/CopilotKit/generative-ui)) | Open glue: AG-UI / A2UI / MCP Apps | More chat-frontend-flavored than dashboard-flavored, but interoperates. |
| **AIS spec-driven migration** ([ais.com](https://www.ais.com/from-knowledge-debt-to-governed-analytics-migrating-legacy-power-bi-to-dbt-in-microsoft-fabric/)) | Agent emits NL spec, code generator consumes | Same architectural shape one layer down (semantic-layer migration). See [`../power-bi-migration-tools/README.md`](../power-bi-migration-tools/README.md). |

## 5. Failure modes (what will bite you)

- **Catalog completeness vs. expressiveness.** Every chart type the agent might emit has to be in the catalog. Easy for KPIs and standard charts; hard for sankey/maps/small-multiples. Catalog grows → prompt grows → model gets confused. Mitigation: per-domain sub-catalogs (one for finance, one for funnels) instead of one mega-catalog; the LLM picks the catalog as a routing step.
- **Prompt budget.** `catalog.prompt()` lists every component, props, action, and example. With 20+ components it's thousands of tokens of system prompt per request. With Anthropic prompt caching this is cheap; on other providers, less so.
- **Aggregation truthiness.** The Vercel `BarChart` aggregates *client-side* via an `aggregate: 'sum'|'count'|'avg'` prop. If the LLM picks the wrong one you get believable-but-wrong numbers. **Mitigation: don't expose `aggregate` to the agent. Pre-aggregate in the semantic layer; the catalog should only see resolved series.**
- **State-path collisions.** Two widgets binding the same `$state` is a feature; two clobbering it is a bug. Convention: `/<actionName>/<idempotencyKey>`.
- **Data freshness.** Spec is persisted; actions re-run on every render. Many-tile dashboards fan out. Need dedupe/batch at the action layer (DataLoader pattern, query-result cache keyed on action+params).
- **Edits don't always patch cleanly.** JSONL JSON-Patch streaming is good for "make the second chart a line chart" but breaks for wholesale refactors. For those, regenerate from scratch.
- **Drilldown is shallow.** `drillDown` action fine; cross-filter across all tiles or what-if on a metric needs a state machinery the catalog doesn't natively have. Next plateau.
- **The "structured output" framing oversells the guarantee.** `catalog.jsonSchema({ strict: true })` produces a schema where `record(...)` types collapse to opaque objects (`additionalProperties: false`, no `propertyNames`). The schema constrains *shape*, not *semantics*. The model can still pick a wrong `xKey` for a chart's `data`. You still need defensive rendering ("No data available" branches in registry components).

## 6. To actually build this

A pragmatic build order, distilled:

1. **Pick the data spine first.** A semantic layer (dbt SL, Cube, MetricFlow, Cortex YAML, AtScale SML) is non-negotiable. The agent cannot be allowed to write SQL. If you don't have one, building this pattern is the wrong project; build the metric tree first.
2. **Define the action surface.** A small REST API: `POST /api/v1/metric` with `{ metricId, grain, dateRange, segments, compareTo }`, `POST /api/v1/query` with `{ queryId, params }`. Result shape standardized: `{ value, delta, series[], rows[] }`.
3. **Define the catalog.** Start small: `DashboardGrid`, `GridTile`, `KPI`, `LineChart`, `BarChart`, `Table`, `DateRangeFilter`, `SegmentFilter`, `Heading`, `Insight`. Resist adding anything else for the first month. (See [`example-catalog.ts`](./example-catalog.ts).)
4. **Wire `@json-render/shadcn` + Recharts** in the registry. The Vercel `examples/dashboard/lib/render/registry.tsx` is the reference.
5. **Pick a constraint route.** If you want streaming + edits, use `catalog.prompt()` + JSONL. If you want hard validity guarantees, use `catalog.jsonSchema({ strict: true })` + structured outputs (Anthropic tool-use is the most pleasant). Most teams will end up running both: structured outputs for *generation*, JSON Patch for *edits*.
6. **Persist specs, not screenshots.** Store `{ prompt, spec, version }` in Postgres (the Vercel demo's pattern). Specs are diffable, regenerable, exportable. Treat them like code: PR review for the catalog, but specs themselves are user-generated content.
7. **Add devtools early.** `@json-render/devtools-react` gives you a tree-of-elements + state inspector + stream replay. Without it, debugging "why is this number wrong?" is nightmarish.
8. **Cap the LLM's invention surface.** No free-text chart types. No SQL emission. Aggregation lives in the semantic layer, not the chart prop.

If you do these eight things you have, in maybe two engineer-weeks, the system Abhi describes.

## 7. Sources

### Primary
- [vercel-labs/json-render](https://github.com/vercel-labs/json-render) — the framework. Read the [README](https://github.com/vercel-labs/json-render/blob/main/README.md) and the `examples/dashboard` directory.
- [json-render.dev](https://json-render.dev/) — docs and playground.
- [InfoQ: Vercel Releases JSON-Render (March 2026)](https://www.infoq.com/news/2026/03/vercel-json-render/)
- [The New Stack: Vercel's json-render — a step toward generative UI](https://thenewstack.io/vercels-json-render-a-step-toward-generative-ui/)
- [Hacker News thread on json-render](https://news.ycombinator.com/item?id=46746570)

### Abhi / Levers Labs
- [Levers Labs about](https://www.leverslabs.com/about)
- [Introducing Metric Trees](https://www.leverslabs.com/article/introducing-metric-trees)
- [Metric Tree Design Patterns](https://www.leverslabs.com/article/metric-tree-design-patterns)
- [The Human Interfaces of Data — Abhi](https://davidsj.substack.com/p/the-human-interfaces-of-data-abhi)
- [Designing & Building Metric Trees (talk)](https://aicouncil.com/talks/designing-and-building-metric-trees)
- [Catalog & Cocktails podcast: SHOW ME THE METRICS w/ Abhi Sivasailam](https://podcasts.data.world/public/127/Catalog-&-Cocktails-2fcf8728/f3f2585c)
- [dbt Roundup Ep. 33: How does data drive growth in practice? (w/ Abhi Sivasailam)](https://roundup.getdbt.com/p/ep-33-how-does-data-drive-growth)
- [You Need More Metrics (dbt Roundup, Sivasailam)](https://roundup.getdbt.com/p/you-need-more-metrics)
- [Twitter: @_abhisivasailam](https://x.com/_abhisivasailam)

### v0 / Vercel
- [Introducing the new v0](https://vercel.com/blog/introducing-the-new-v0)
- [v0.app](https://v0.app/)
- [Dashboard templates on v0](https://v0.app/templates/dashboards)

### Adjacents
- [Vega-Lite](https://vega.github.io/vega-lite/)
- [Google A2UI v0.9](https://developers.googleblog.com/a2ui-v0-9-generative-ui/) and [google/A2UI repo](https://github.com/google/A2UI)
- [shadcn/ui charts](https://ui.shadcn.com/charts/area)
- [Recharts](https://recharts.org/)
- [CopilotKit Generative UI](https://github.com/CopilotKit/generative-ui)
- [Snowflake Cortex Analyst (engineering blog)](https://www.snowflake.com/en/engineering-blog/agentic-semantic-model-text-to-sql/)
- [Tableau Pulse](https://www.tableau.com/products/tableau-pulse)
- [Hex Notebook Agent](https://hex.tech/blog/introducing-notebook-agent/)
- [Databricks AI/BI](https://www.databricks.com/product/business-intelligence/ai-bi-dashboards)
- [ThoughtSpot Spotter / AI Dashboards](https://www.thoughtspot.com/data-trends/dashboard/ai-dashboard)

### Internal cross-link
- [`../power-bi-migration-tools/README.md`](../power-bi-migration-tools/README.md) §4b — same architectural shape (agent emits structured spec, deterministic generator consumes) one layer down at the semantic-layer migration.

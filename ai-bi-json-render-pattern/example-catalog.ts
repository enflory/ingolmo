// Worked example of the Abhi-style "json-render BI" catalog.
//
// This is illustrative — a minimal "classic BI" vocabulary an analytics agent
// can target. It mirrors the structure of vercel-labs/json-render's
// examples/dashboard but trims it to the BI essentials and adds the
// metric-tree-flavored primitives Levers Labs talks about.
//
// Two routes for the LLM:
//
//   1) JSONL streaming (catalog.prompt() + streamText, AI SDK)
//      - Model emits one RFC-6902 JSON-Patch op per line
//      - Spec fills in progressively as it streams
//
//   2) Strict JSON-Schema structured outputs (catalog.jsonSchema({ strict: true }))
//      - Model emits the whole spec in one shot, schema-validated
//      - Use with OpenAI response_format=json_schema, Gemini, or Anthropic
//        tool_use with input_schema. No streaming, but stronger guarantees.

import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

export const biCatalog = defineCatalog(schema, {
  components: {
    // ---------- Layout ----------
    DashboardGrid: {
      props: z.object({
        columns: z.number().nullable(), // default 12
        gap: z.enum(["sm", "md", "lg"]).nullable(),
      }),
      slots: ["default"],
      description:
        "Top-level grid for dashboard tiles. Children should be GridTile.",
    },
    GridTile: {
      props: z.object({
        colSpan: z.number(), // 1..12
        rowSpan: z.number().nullable(),
        title: z.string().nullable(),
      }),
      slots: ["default"],
      description: "A tile in the dashboard grid; one chart/table/KPI per tile.",
    },

    // ---------- KPIs / metric tree ----------
    KPI: {
      props: z.object({
        label: z.string(),
        value: z.union([z.number(), z.string()]),
        format: z
          .enum(["currency", "percent", "number", "duration"])
          .nullable(),
        delta: z.number().nullable(), // change vs comparison period
        deltaDirection: z.enum(["up-good", "up-bad", "neutral"]).nullable(),
        comparisonLabel: z.string().nullable(), // "vs last week"
        sparkline: z
          .array(z.object({ x: z.string(), y: z.number() }))
          .nullable(),
      }),
      description:
        "Single-metric tile. Bind value with { $state: '/metrics/<id>/value' } so the analytics agent can set it via an action.",
      example: {
        label: "MRR",
        value: { $state: "/metrics/mrr/value" },
        format: "currency",
        delta: { $state: "/metrics/mrr/delta" },
        deltaDirection: "up-good",
        comparisonLabel: "vs last week",
      },
    },

    // ---------- Charts (Recharts under the hood) ----------
    LineChart: {
      props: z.object({
        title: z.string().nullable(),
        data: z.array(z.record(z.string(), z.unknown())),
        xKey: z.string(),
        yKey: z.string(),
        seriesKey: z.string().nullable(), // for multi-series
        aggregate: z.enum(["sum", "count", "avg", "min", "max"]).nullable(),
        height: z.number().nullable(),
      }),
      description:
        "Line chart over time. Bind data with { $state: '/queries/<id>/rows' }.",
    },
    BarChart: {
      props: z.object({
        title: z.string().nullable(),
        data: z.array(z.record(z.string(), z.unknown())),
        xKey: z.string(),
        yKey: z.string(),
        orientation: z.enum(["vertical", "horizontal"]).nullable(),
        stack: z.boolean().nullable(),
        seriesKey: z.string().nullable(),
        height: z.number().nullable(),
      }),
      description: "Bar chart. Stacking and grouping via seriesKey + stack.",
    },
    Table: {
      props: z.object({
        data: z.array(z.record(z.string(), z.unknown())),
        columns: z.array(
          z.object({
            key: z.string(),
            label: z.string(),
            format: z
              .enum(["currency", "percent", "number", "date", "text"])
              .nullable(),
          }),
        ),
        pageSize: z.number().nullable(),
      }),
      description: "Detail table. Bind data with { $state: '/queries/<id>/rows' }.",
    },

    // ---------- Filters (drive state) ----------
    DateRangeFilter: {
      props: z.object({
        statePath: z.string(), // e.g. "/filters/dateRange"
        defaultPreset: z
          .enum(["today", "last_7d", "last_28d", "last_90d", "ytd", "custom"])
          .nullable(),
      }),
      description:
        "Date-range picker. Writes { from, to } to statePath; charts can $state-bind to it.",
    },
    SegmentFilter: {
      props: z.object({
        statePath: z.string(),
        label: z.string(),
        options: z.array(
          z.object({ value: z.string(), label: z.string() }),
        ),
        multi: z.boolean().nullable(),
      }),
      description: "Categorical filter writing to a state path.",
    },

    // ---------- Narrative ----------
    Heading: {
      props: z.object({
        text: z.string(),
        level: z.enum(["h1", "h2", "h3"]).nullable(),
      }),
      description: "Section heading.",
    },
    Insight: {
      props: z.object({
        text: z.string(),
        sentiment: z.enum(["positive", "negative", "neutral"]).nullable(),
      }),
      description:
        "One- or two-sentence narrative. Use sparingly; prefer the chart.",
    },
  },

  // ---------- Actions (agent → backend → state) ----------
  // Each action maps to a server endpoint that resolves a metric or query
  // against the semantic layer (dbt SL / Cube / MetricFlow). The result is
  // written into spec state at a known path the components $state-bind to.
  actions: {
    runMetric: {
      params: z.object({
        metricId: z.string(), // e.g. "mrr", "weekly_active_users"
        grain: z.enum(["day", "week", "month", "quarter"]).nullable(),
        groupBy: z.array(z.string()).nullable(),
        dateRange: z
          .object({ from: z.string(), to: z.string() })
          .nullable(),
        segments: z.record(z.string(), z.array(z.string())).nullable(),
        compareTo: z
          .enum(["prev_period", "prev_year", "none"])
          .nullable(),
      }),
      description:
        "Execute a governed metric from the semantic layer. Result lands at /metrics/<metricId>/{value,delta,series}.",
    },
    runQuery: {
      params: z.object({
        queryId: z.string(),
        params: z.record(z.string(), z.unknown()).nullable(),
      }),
      description:
        "Run a parameterized SQL or semantic query. Rows land at /queries/<queryId>/rows.",
    },
    drillDown: {
      params: z.object({
        metricId: z.string(),
        dimension: z.string(),
        value: z.string(),
      }),
      description:
        "Drill into one slice of a metric. Spawns a child query under /queries/.",
    },
  },
});

// ----------------------------------------------------------------------------
// Example spec the agent might emit for: "Weekly active users last 28 days,
// segmented by plan, plus MRR KPI."
//
// (In real usage this comes out as a stream of JSON-Patch ops; the assembled
// final spec is shown here for clarity.)
// ----------------------------------------------------------------------------

export const exampleSpec = {
  root: "grid",
  state: {
    filters: { dateRange: { from: "2026-04-07", to: "2026-05-05" } },
    metrics: {},
    queries: {},
  },
  elements: {
    grid: {
      type: "DashboardGrid",
      props: { columns: 12, gap: "md" },
      children: ["title", "filterRow", "kpi-mrr", "tile-wau", "tile-table"],
    },
    title: {
      type: "GridTile",
      props: { colSpan: 12 },
      children: ["h1"],
    },
    h1: {
      type: "Heading",
      props: { text: "Growth dashboard", level: "h1" },
      children: [],
    },
    filterRow: {
      type: "GridTile",
      props: { colSpan: 12 },
      children: ["dateFilter"],
    },
    dateFilter: {
      type: "DateRangeFilter",
      props: { statePath: "/filters/dateRange", defaultPreset: "last_28d" },
      // any change re-runs the metric and the query
      watch: {
        "/filters/dateRange": {
          action: "runMetric",
          params: {
            metricId: "mrr",
            dateRange: { $state: "/filters/dateRange" },
            compareTo: "prev_period",
          },
        },
      },
      children: [],
    },
    "kpi-mrr": {
      type: "GridTile",
      props: { colSpan: 4, title: "MRR" },
      children: ["mrr"],
    },
    mrr: {
      type: "KPI",
      props: {
        label: "MRR",
        value: { $state: "/metrics/mrr/value" },
        format: "currency",
        delta: { $state: "/metrics/mrr/delta" },
        deltaDirection: "up-good",
        comparisonLabel: "vs prev 28d",
        sparkline: { $state: "/metrics/mrr/series" },
      },
      children: [],
    },
    "tile-wau": {
      type: "GridTile",
      props: { colSpan: 8, title: "WAU by plan" },
      children: ["wauChart"],
    },
    wauChart: {
      type: "LineChart",
      props: {
        data: { $state: "/queries/wau-by-plan/rows" },
        xKey: "week",
        yKey: "users",
        seriesKey: "plan",
        height: 280,
      },
      children: [],
    },
    "tile-table": {
      type: "GridTile",
      props: { colSpan: 12, title: "Top accounts by MRR" },
      children: ["acctTable"],
    },
    acctTable: {
      type: "Table",
      props: {
        data: { $state: "/queries/top-accounts/rows" },
        columns: [
          { key: "account", label: "Account", format: "text" },
          { key: "mrr", label: "MRR", format: "currency" },
          { key: "delta_pct", label: "Δ", format: "percent" },
        ],
        pageSize: 10,
      },
      children: [],
    },
  },
} as const;

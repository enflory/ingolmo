# Research notes — UDFs as foundation for AI-agent data analysis systems

*Started 2026-05-14. Topic: Leonard Spiegelberg's AI Council 2026 talk "Stop building data frame APIs" and the broader research question of using Python UDFs as a ground-up foundation for agent-native data analysis.*

## Prior work in this repo

- [`enterprise-data-agents/`](../enterprise-data-agents/README.md) — warehouse-scale agents (OpenAI / Ramp). Relevant contrast: those systems use NL→SQL, not function composition.
- [`lite-db-ai-agents/`](../lite-db-ai-agents/README.md) — DuckDB/SQLite as scratchpad. Foundational overlap; UDFs are part of DuckDB's extensibility story.
- [`ai-bi-json-render-pattern/`](../ai-bi-json-render-pattern/README.md) — agent output as JSON spec. Related output layer.
- [`cli-tools-for-ai-agents/`](../cli-tools-for-ai-agents/README.md) — tooling ergonomics.

## Initial framing

The talk's four core claims:
1. High-level operators + functions > DataFrame APIs (for agents)
2. UDFs are slow on dataframes (the current obstacle)
3. Functions are "legos for agents" (composability)
4. We need more data-centric code tools for agents

This is fundamentally a claim about the right *interface* between LLM agents and data computation engines. The question is: what should the API surface look like when the *caller* is an LLM rather than a human developer?

## Research threads to pursue

- [ ] Spiegelberg's background and prior work (likely Ponder, Modin, or similar scale-out Pandas projects)
- [ ] UDF performance problem: why are Python UDFs slow in Pandas/DuckDB/Polars? What are the escape hatches?
- [ ] "High-level operators" concept — what does this mean in practice? Arrow, Substrait, Ibis?
- [ ] Functions-as-legos precedents: functional data pipelines, LINQ, Spark UDF composition
- [ ] Data-centric code tools for agents: what exists? What's missing?
- [ ] Vectorized UDFs, Arrow-native UDFs, Wasm UDFs — the performance solution space
- [ ] How agents currently call dataframe code (NL→pandas, NL→SQL, tool use)

## Notes as research proceeds

### 2026-05-14

Starting research. Need to find Spiegelberg's actual talk content and any associated materials.

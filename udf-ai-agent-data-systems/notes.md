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

### 2026-05-14 — Session 1

Starting research. Need to find Spiegelberg's actual talk content and any associated materials.

**Found: Spiegelberg identity and background**

- Full name: Leonhard F. Spiegelberg
- PhD: Brown University, 2023. Thesis: "Efficient Data Analytics Using Speculative Compilation Techniques." Advisor: Malte Schwarzkopf.
- Prior degrees: M.S. Harvard, B.S./M.S. Technische Universität München
- Brown ETOS lab GitHub: LeonhardFS
- Snowflake GitHub handle: sfc-gh-lspiegelberg (forked modin)
- Current: Member of Technical Staff, OpenAI
- Career arc: academic DB systems (SIGMOD'21 Tuplex) → Snowflake (shipped pandas on Snowflake after Ponder acquisition) → OpenAI (data agent infrastructure, exabyte-scale)
- Snowflake acquired Ponder (company behind Modin) in Oct 2023; Spiegelberg originated pandas on Snowflake feature there

**Tuplex — his key prior work (SIGMOD 2021)**

- Framework that JIT-compiles natural Python UDFs (no decorators) to LLVM IR via dual-mode execution
- Fast path: compiled for common-case types derived from data sampling; slow/exception path: fallback to interpreter
- UDFs are first-class citizens, compiled JIT when query executes
- Results: 5–91x vs Spark/Dask, comes within 1.1–1.7x of hand-optimized C++
- Key insight: Python UDFs are slow because they run through the interpreter, not because functions are the wrong abstraction
- URL: https://tuplex.cs.brown.edu/

**The AI Council talk**

- Title on aicouncil.com: "The Modern Data Stack Lost the War: Stop Building more DataFrame APIs"
- Talk page URL: https://aicouncil.com/talks25/the-modern-data-stack-lost-the-war-stop-building-more-dataframe-apis
- The page is 403 but the search engine excerpts give the key claims:
  - Every new dataframe library (pandas, Modin, Polars, RAPIDS, Ibis, Vaex, Dask, PySpark...) converges on the same API with the same limitations
  - Failure isn't execution or scale — it's ignoring that "appearance doesn't matter anymore" to agents and AI-first developers
  - Examines why the dataframe paradigm keeps reproducing itself and why it consistently underdelivers
  - Argues data stack's biggest problems won't be solved at the API layer
  - Alternative: simple Python functions instead

**UDF Performance — findings**

Pandas apply (row-at-a-time):
- Creates a Series from each row; calls __getitem__ 3 times per row
- GIL means no parallelism even with Python threads
- Real benchmark: multiplying 1M elements with map_elements (Polars equivalent) = 1.506 seconds; native Polars expression = 0.002 seconds. That's ~750x overhead.
- pandas.apply on 71M rows of datetime conversion: >1 hour
- Root cause: Python object construction, dynamic typing, GIL, no vectorization

Polars:
- map_elements: row-at-a-time Python UDF. Strongly discouraged by docs. ~750x slower than native expressions.
- map_batches: column-at-a-time, gets PyArrow/Series. Better than row-at-a-time.
- Native expressions: Rust, parallel, optimizer can see them, no GIL
- Plugins (pyo3-polars): Write Rust UDF, compile to .so, dynamically linked at runtime. "Almost as fast as native expressions." 14x speedup reported in one article; 50x for NLTK-style plugins.

DuckDB:
- Native Python UDF: row-at-a-time. >1 order of magnitude slower than Arrow UDF.
- Arrow UDF (type='arrow'): vectorized, processes chunks of up to 2048 rows. Zero-copy with PyArrow.
- JIT via Numba: DuckDB supports Numba JIT UDFs. Further speedup for numeric operations.
- WASM: DuckDB-Wasm runs full DB in browser; extension system in WASM supports UDFs.
- duckdb_functions() introspection table: agents can query this to discover registered functions.

Spark:
- Row-at-a-time Python UDFs: 3–100x slower than vectorized. Requires ser/deser for every row JVM↔Python.
- Pandas UDFs (Arrow-based): 3–100x faster than row-at-a-time. Zero-copy Arrow IPC between JVM and Python process.
- Catalyst optimizer: opaque to Python UDFs — no predicate pushdown, no scan skipping.

RAPIDS cuDF (GPU):
- cuDF.apply() with Numba JIT → CUDA kernels
- Up to 435x speedup over pandas for numeric UDFs on GPU
- Falls back to CPU for non-numeric/complex types

Numba on pandas:
- First run: compilation overhead (seconds)
- Subsequent runs: 200x speedup over pure pandas apply for row-wise UDFs
- Works best with >1M rows, numeric data

UDF optimization research (VLDB 2025):
- UDFBench (VLDB '25 Best Paper): 21 queries, 4 classes, real-world academic data
- Vectorized execution (DuckDB, MonetDB) significantly outperforms tuple-at-a-time
- Key technique: DuckDB/MonetDB pass NumPy arrays or DataFrames to UDFs (zero-copy), avoiding data copies
- PRISM (VLDB '25): UDF outlining + inlining hybrid. Average 1.29x speedup over pure inlining in DuckDB, 298x in SQL Server.

Tuplex vs everything:
- 5–91x over Spark/Dask
- 1.1–1.7x of hand-optimized C++
- Key: JIT compilation removes Python interpreter overhead entirely for common case

**High-level operators — findings**

Substrait:
- Cross-language serialization for relational algebra
- Used by: DuckDB, Apache Arrow (Acero), Velox, DataFusion, Ibis (as producer)
- Extension system for custom functions (1000s expected)
- Not a user interface — compiles from Ibis or similar down to Substrait, then to execution engines

Ibis:
- Unified Python API over 20+ backends (DuckDB, BigQuery, Snowflake, Spark, Polars, SQLite...)
- Deferred expression graph: lazy, backend-agnostic
- Supports scalar UDFs (Python functions registered as expressions)
- Produces Substrait for compatible backends
- Used by Wren AI engine (DataFusion backend)
- Hamilton integration: Ibis expressions as nodes in Hamilton DAG

Arrow as universal format:
- Byte-identical memory layout across all implementations
- Zero-copy between DuckDB, Polars, pandas (2.0+), PyArrow, DataFusion
- Arrow IPC now in DuckDB (May 2025 blog post)
- Zerrow paper (Apr 2025): true zero-copy Arrow pipelines in Bauplan with kernel module; 100–200x reduction in I/O time for 6–30GB tables
- ADBC: Arrow Database Connectivity — Arrow-native DB API replacing ODBC for columnar systems

**Functions as legos — findings**

LINQ (historical precedent):
- Higher-order operators (Where, Select, Aggregate) that take functions as parameters
- Chain composability: each produces a collection ready for next operator
- C#'s way of doing monads; expression trees as extension mechanism
- Why LINQ matters for cloud composability: standardized operator algebra, composable over any IEnumerable

Spark transformation DAG:
- Transformations are lazy; trigger on action
- DAG of transformations, pipeline narrow ones without shuffles
- Python UDFs opaque to Catalyst: no predicate pushdown, no scan skipping

Hamilton (Apache):
- "Define testable, modular, self-documenting dataflows using regular Python functions"
- Each Python function = one node; dependencies from parameter names
- Builds DAG automatically; portable (script, notebook, Airflow, FastAPI...)
- Integrates with Ibis for backend-agnostic execution

DataFlow framework (arXiv Dec 2025):
- 180+ operators (generation, evaluation, filtering, refinement) for LLM data prep
- PyTorch-style pipeline construction API
- DataFlow-Agent: NL → executable pipeline; can synthesize new operators on demand
- This is the "functions as legos" pattern applied to LLM training data pipelines

Agentics 2.0 (arXiv Mar 2026):
- Formalizes LLM inference as "transducible function": typed semantic transformation
- Functions compose via algebraically grounded operators (Map-Reduce style)
- Stateless asynchronous execution; schema validity enforced at type level
- Explicitly the "functions as first-class agentic primitives" thesis

**Agent data tools — findings**

OpenAI data agent (blog 2025):
- Built by 2 engineers, serves 4000+ OpenAI employees
- Uses GPT-5, Codex, memory
- NL → code interpreter (Python sandbox) pattern
- Notably: NOT a pure function-registry approach; still generates code

dbt MCP server:
- Exposes dbt project as MCP tools for agents
- Tools: query semantic layer metrics, access model metadata, run SQL against governed definitions
- MetricFlow: open-source, metrics defined once, accessible via NL through MCP
- Open Semantic Interchange (OSI) 2025: vendor-neutral YAML for semantic layer defs

Wren AI / Wren Engine:
- Semantic engine for LLM agents: DataFusion backend, Ibis API
- MDL (Model Definition Language): defines business entities, metrics, relationships
- Agents query via MDL-governed context layer, not raw tables
- MCP interface for agent queries

Bauplan:
- Python-first serverless lakehouse: each transformation = Python function
- FaaS execution: Arrow IPC between function nodes in DAG
- Agents can build entire ETL pipelines from S3 + prompt
- Open-sourced prototype: agent investigates failing pipeline, fixes it, proposes merge after deterministic verifier passes
- "Proof-carrying code" approach for safe untrusted agents (arXiv 2510.09567)
- Key property: Arrow buffers as the function I/O contract between all pipeline nodes

ToolRegistry (arXiv 2507.10593):
- Protocol-agnostic Python library for managing functions as tools for LLMs
- Generates schemas for OpenAI, Anthropic, Gemini automatically from Python functions
- Composable permission policies, self-describing via docstrings

NL→SQL failure modes (VLDB 2025 survey):
- Top error: LLMs assume columns co-located in same table (wrong schema topology)
- Enterprise schemas: large, versioned, complex; ambiguous naming
- Schema drift: model doesn't know schema changed → errors increase
- GPT-4o achieves only 38.58% valid invocations for low-frequency API calls

API complexity and hallucination:
- LLMs hallucinate pandas methods (e.g., df.merge_on_index() — invented)
- GPT-4o low-frequency API invocations: 38.58% valid
- Method chaining: readability benefits, but long chains hard to debug when one step fails

Semantic layer trend:
- 2025 = semantic layers going mainstream
- Metric layer: central, versioned KPI definitions
- Agents querying semantic layer = consistent answers regardless of LLM caller
- AtScale, dbt Labs (MetricFlow), Snowflake, Databricks all competing here

**Synthesis pointers**

The core argument Spiegelberg is making:
1. DataFrame APIs reproduce themselves endlessly because they're built for humans reading/writing code interactively
2. Agents don't read APIs — they call functions
3. The performance obstacle (Python UDF slowness) is solvable: Tuplex proved it (his own prior work), Arrow UDFs in DuckDB/Spark prove it, Polars plugins prove it
4. The composability insight: small typed Python functions + a type-checked composition layer is better than a 500-method API
5. The data-centric tools gap: existing tools (pandas, DuckDB Python API, etc.) were designed for human developers; an agent-first system would look like a UDF registry with Arrow I/O, function discovery, schema validation at composition time

Missing pieces for agent-first data system:
- Function registry with introspection (duckdb_functions() is partial; ToolRegistry covers the agent-tool side)
- Arrow as the universal I/O contract between functions
- JIT/Rust compilation to eliminate Python UDF overhead (Tuplex approach, Polars plugins approach)
- Type-checked composition: operator graph built from typed function signatures
- Safety properties: bounded side effects, deterministic execution, rollback (Bauplan "proof-carrying" approach)
- Self-describing: docstrings as tool schemas (ToolRegistry does this)

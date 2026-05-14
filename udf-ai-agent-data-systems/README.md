# UDFs as the Foundation for AI-Agent-Native Data Analysis Systems

**Research thread started:** 2026-05-14  
**Trigger:** Talk by Leonhard Spiegelberg at AI Council 2026 (San Francisco, May 12–14): "The Modern Data Stack Lost the War: Stop Building more DataFrame APIs"  
**Prior threads:** `enterprise-data-agents/`, `lite-db-ai-agents/`, `ai-bi-json-render-pattern/`

---

## 1. Leonhard Spiegelberg: Background and the Talk's Specific Claims

### Who he is

Leonhard F. Spiegelberg is a Member of Technical Staff at OpenAI, working on exabyte-scale data and agentic infrastructure for production-critical workloads. His career arc is directly relevant to his argument:

- **PhD, Brown University (2023):** Thesis "Efficient Data Analytics Using Speculative Compilation Techniques," under Malte Schwarzkopf. The core output was **Tuplex** (SIGMOD 2021), a system that JIT-compiles natural Python UDFs to native LLVM code, achieving 5–91x speedups over Spark and Dask.
- **Snowflake (2023–?):** After Snowflake acquired Ponder (the company behind the Modin open-source library) in October 2023, Spiegelberg originated and shipped "pandas on Snowflake" — native DataFrame computing pushed into the data warehouse.
- **OpenAI (current):** Working on data agent infrastructure at production scale.

His academic GitHub is LeonhardFS; his Snowflake GitHub handle is sfc-gh-lspiegelberg. His Google Scholar profile lists publications at SIGMOD, VLDB, and affiliated workshops. He has an S.M. from Harvard and a B.S./M.S. from Technische Universität München.

### The talk

- **Full title on AI Council website:** "The Modern Data Stack Lost the War: Stop Building more DataFrame APIs"  
- **URL:** https://aicouncil.com/talks25/the-modern-data-stack-lost-the-war-stop-building-more-dataframe-apis  
- **Date:** AI Council 2026, San Francisco, May 2026 (this is labeled "talks25" on the site, referring to the conference series)

The slides are not publicly available (the AI Council site returns 403). The search-engine excerpt from the talk page gives the core claims:

> "After more than a decade of limited innovation, the modern data stack is still slow, fragmented, and painfully repetitive — every new dataframe library promises better ergonomics or performance yet converges on the same API with the same limitations. The failure isn't in execution or scale. It's in ignoring that appearance doesn't matter anymore to agents and AI-first developers."

> "Agents and AI-first developers couldn't care less about how an API looks today."

The talk examines:
1. Why the dataframe paradigm keeps reproducing itself
2. Why it consistently underdelivers
3. Why the data stack's biggest problems were never going to be solved at the API layer
4. What the alternative is: simple Python functions

### The four core claims (as given in the research brief)

1. **High-level operators + functions > DataFrame APIs** (for agents)
2. **UDFs are currently slow** on dataframes — the main obstacle
3. **Functions are "legos for agents"** — composability is the key property
4. **We need more data-centric code tools** for agents

Spiegelberg is uniquely positioned to make claim (2): his PhD research was specifically about making Python UDFs fast via speculative JIT compilation. Tuplex's SIGMOD 2021 paper is the existence proof that the performance obstacle is not fundamental.

---

## 2. UDF Performance: The Problem and the Solutions

### Why Python UDFs are slow: the root causes

**Row-at-a-time execution pattern:**  
The dominant slow path is `DataFrame.apply()` in pandas (and equivalents in other systems). For every row, Python must:
- Construct a Series object from the row data
- Call `__getitem__` 3× per row access
- Execute Python bytecode for each scalar value
- Return a Python object

On 1 million rows, this is 1 million Python function invocations, 3+ million attribute lookups, and millions of object allocations/deallocations.

**GIL (Global Interpreter Lock):**  
Python's GIL prevents true parallel execution of Python bytecode. Even on multi-core machines, row-at-a-time UDFs serialize execution. Native expression engines (Rust in Polars, C++ in DuckDB) are not affected because they don't hold the GIL.

**Opaqueness to query optimizer:**  
When a query engine receives a Python UDF, it cannot see inside the function. In Spark, this means Catalyst cannot perform predicate pushdown — the optimizer must scan every row before applying the filter. In SQL Server and DuckDB, similar issues prevent zone map skipping.

**Serialization overhead (JVM systems):**  
In PySpark, row-at-a-time UDFs require serialization of every row from JVM (Java) to Python and back. This is separate from, and in addition to, the Python execution overhead.

### Benchmark numbers across systems

| System | Approach | Overhead vs. native |
|--------|----------|-------------------|
| Polars | map_elements (row Python UDF) vs native expression | ~750x slower |
| PySpark | Row Python UDF vs Pandas UDF (Arrow) | 3–100x slower |
| DuckDB | Native Python UDF vs Arrow UDF | >10x slower |
| pandas | .apply() vs vectorized numpy op | 100–1000x slower depending on operation |
| cuDF | pandas CPU apply vs GPU CUDA UDF (Numba) | 435x speedup on GPU |
| Tuplex | Python pipeline vs Spark/Dask | 5–91x faster (comparable to C++) |

**Concrete example (Polars, widely cited):**  
Multiplying 1 million elements:  
- `map_elements` (row-at-a-time Python): 1.506 seconds  
- Native Polars expression (Rust): 0.002 seconds  
- **Ratio: ~750x**

**VLDB 2025 UDFBench (Best Paper Award):**  
Benchmark with 21 SQL+UDF queries on real-world OpenAIRE data. Key finding: systems that pass NumPy arrays or DataFrames to UDFs (DuckDB, MonetDB) with zero-copy significantly outperform tuple-at-a-time systems. Aggregate UDF queries show the largest gap between vectorized and non-vectorized execution.

### The solutions

**1. Arrow-native vectorized UDFs (DuckDB, Spark, Ibis)**

Instead of calling the UDF per row, the engine batches rows into Arrow chunks (up to 2048 rows in DuckDB) and calls the function once per chunk. The Arrow format eliminates serialization because the data layout is identical in both Python and the C++ engine.

```python
# DuckDB Arrow UDF example
import duckdb, pyarrow

def udf_multiply(x: pyarrow.ChunkedArray) -> pyarrow.ChunkedArray:
    return pyarrow.compute.multiply(x, 2)

con = duckdb.connect()
con.create_function("double_val", udf_multiply, 
                    [duckdb.typing.DOUBLE], duckdb.typing.DOUBLE,
                    type="arrow")  # <-- key: Arrow vectorized mode
result = con.sql("SELECT double_val(val) FROM data").fetchall()
```

In Spark, "Pandas UDFs" (using Arrow) achieve 3–100x speedup over row UDFs. The Arrow IPC protocol enables zero-copy transfer between JVM and Python processes.

**2. Rust expression plugins (Polars)**

The `pyo3-polars` plugin system compiles Rust functions into `.so` shared objects that are dynamically linked into the Polars expression engine at runtime. The plugin operates directly on Arrow buffers with no GIL contention and no Python overhead. Reported speedups: 14x (Nelson Griffiths, TDS) to 50x (NLTK plugin example). The engine treats plugin expressions identically to native expressions: they participate in query optimization and parallel execution.

**3. JIT compilation (Tuplex, Numba)**

Tuplex's approach (Spiegelberg's PhD work): parse the Python AST of a UDF, derive common-case types from a data sample, compile LLVM IR for the fast path, fall back to Python interpreter for exceptions. Results: 5–91x over Spark/Dask, within 1.1–1.7x of hand-optimized C++. This approach is the strongest evidence that Python UDF performance is not a fundamental limitation — it's an implementation choice.

Numba: JIT compilation for numeric UDFs. ~200x speedup over pandas.apply for >1M rows. Compilation overhead on first run (seconds), but cached subsequently. Usable directly in DuckDB via Numba integration.

**4. WASM UDFs (DuckDB-Wasm)**

DuckDB-Wasm runs the full DuckDB engine in the browser via WebAssembly. The extension system (LOAD extension_name) supports custom UDFs as WASM modules. This enables client-side execution of custom logic without server round-trips. Relevant for agent systems that need sandboxed execution.

**5. GPU UDFs (RAPIDS cuDF)**

cuDF.apply() with Numba JIT compiles Python UDFs to CUDA kernels. 435x speedup over CPU pandas on an NVIDIA Quadro GV100. Falls back to CPU for non-numeric dtypes. Primarily relevant for ML-adjacent feature engineering at large scale.

**The key insight from Tuplex:**  
Python UDFs are slow because they run through the Python interpreter on every row. The interpreter overhead is not a property of "using Python functions" — it's a property of not compiling them. Tuplex proves this: natural, undecorated Python functions, compiled to LLVM, match C++ performance. The solution is compilation, not a different API paradigm.

### UDF optimization research (VLDB 2024–2025)

**PRISM (VLDB 2025):** "The Key to Effective UDF Optimization: Before Inlining, First Perform Outlining." Decomposes UDFs into pieces that benefit from SQL-level inlining (for predicate pushdown/zone maps) and pieces that benefit from native code compilation (for arithmetic/logic). Average 1.29x speedup over pure inlining in DuckDB; 298x in SQL Server. This shows the optimizer can work with UDFs when given proper decomposition.

---

## 3. High-Level Operators: The Algebraic Foundation

### What "high-level operators" means

The classical relational algebra defines a small set of operators: σ (select/filter), π (project), ⋈ (join), ∪ (union), ÷ (divide), and aggregate functions. These operators have well-defined semantics, can be reasoned about algebraically, and — crucially — compose: the output of one is always a relation that is valid input for another.

The contrast with a procedural DataFrame API:
- **Algebraic:** `filter(table, predicate)` is a function with a clear input/output type contract
- **Procedural:** `df.loc[df['x'] > 5]` is a method chain that mutates or returns a DataFrame but whose composition rules are implicit in the library's implementation

For an agent, algebraic operators are easier to reason about because:
1. The agent knows what each operator does from its type signature + documentation
2. The agent can verify composition is valid before execution (output type matches next input type)
3. The operator graph can be serialized, inspected, and optimized separately from execution

### Apache Substrait

Substrait (https://substrait.io) is a cross-language serialization format for relational algebra. It defines:
- A protobuf schema for relational operators (filter, project, aggregate, join, etc.)
- An extension mechanism for custom functions (function registry)
- A separate function binding from function declaration (enabling 1000s of functions)

Consumers: Apache Arrow (Acero execution engine), DuckDB, Apache Velox, Apache DataFusion, and others. Ibis produces Substrait plans.

Purpose: decouple the query expression layer (e.g., Python API like Ibis) from the execution engine. A Substrait plan produced by Ibis against DuckDB can be sent to Velox instead, without changing the user code.

### Ibis

Ibis (https://ibis-project.org) is the most important practical implementation of the high-level operator concept for Python. Key properties:
- Single Python API over 20+ backends: DuckDB, BigQuery, Snowflake, Spark, Polars, SQLite, ClickHouse, PostgreSQL, Trino, DataFusion, Flink, and more
- **Deferred expression graph:** Ibis expressions are lazy — `t.filter(t.x > 5).select(t.y)` builds a symbolic graph, not a result
- **Backend compilation:** Ibis compiles the expression to SQL (or Substrait, or LazyFrame) for the backend
- **UDF support:** Python scalar UDFs registered as Ibis expressions — cross-backend, backend-agnostic

From SciPy 2025 proceedings: Ibis has been called "the data processing workhorse of the Python analytics stack" and represents "the composable, Python-native data stack."

The expression graph is the key differentiator from pandas. In pandas, method chains are eager by default and tied to pandas' execution engine. An Ibis expression is a portable plan.

### Arrow as the universal in-memory format

Apache Arrow defines a byte-identical in-memory columnar layout for all implementations (Python, C++, Java, Rust, Go, R...). When DuckDB hands a result to pandas, when Spark passes data to a Pandas UDF, when Polars exchanges with a JVM client, the layout is Arrow.

**2025 developments:**
- Arrow IPC now directly supported in DuckDB (blog post May 23, 2025): DuckDB can consume/produce Arrow IPC format via the `arrow` community extension
- ADBC (Arrow Database Connectivity): Arrow-native database connectivity standard replacing ODBC for columnar systems
- Zerrow paper (arXiv Apr 2025, Bauplan): achieves 100–200x reduction in I/O time for 6–30GB tables by eliminating Arrow copy overhead via kernel-level de-anonymization

Arrow's role in an agent-native data system: it is the natural I/O contract between functions. If every UDF accepts and returns Arrow arrays/batches, then functions compose without serialization cost. This is the technical enabler for "functions as legos."

---

## 4. Functions as Legos: Composability Patterns and Prior Art

### The lego metaphor unpacked

For functions to be "legos," they need:
1. **Standard connectors:** I/O types must be compatible. Arrow Tables/ChunkedArrays as universal type = standard connector.
2. **Predictable interface contract:** Each function has an explicit signature (input types, output types, semantics documented in docstring).
3. **Composability without coupling:** Output of `f` is valid input of `g` without needing to know `g`'s implementation.
4. **Discoverability:** An agent can enumerate available functions and understand what each does.

### Historical precedents

**LINQ (C#, 2007):**  
Language-Integrated Query defines higher-order operators (Where, Select, Aggregate, Join) that each accept functions as parameters and return sequences. The entire point of LINQ's design is composability: each operator takes `IEnumerable<T>` and returns `IEnumerable<U>`. Chaining is structural, not syntactic. LINQ implements monads (SelectMany = flatMap = bind), giving it a firm algebraic foundation. The ACM Queue article "Why LINQ Matters: Cloud Composability Guaranteed" makes the explicit claim that this operator algebra extends naturally to distributed/cloud data sources.

**Apache Spark transformation DAG:**  
Spark transformations (map, filter, flatMap, groupBy, join) are lazy and build a DAG. The DAG is submitted for optimization and execution as a unit. Narrow transformations pipeline automatically. The key property: the computation graph is inspectable and optimizable before execution. Python UDFs break this by being opaque to Catalyst.

**Hamilton (Apache):**  
Hamilton defines dataflows as regular Python functions where parameter names declare dependencies. The framework automatically builds the DAG from the function signatures. Each function is independently testable and self-documenting. Integrates with Ibis for backend-agnostic execution. This is the "functions as DAG nodes" pattern applied to data pipelines.

**dbt (Directed Acyclic Graph of SQL nodes):**  
dbt models are SQL functions with well-defined input/output schemas. The MetricFlow semantic layer defines metrics as composable functions over dbt models. The dbt MCP server (announced 2025) exposes these as callable tools for LLM agents via Model Context Protocol.

**DataFlow framework (arXiv 2512.16676, Dec 2025):**  
"PyTorch-style pipeline construction API" with 180+ operators for LLM data preparation. DataFlow-Agent translates NL specifications into executable operator pipelines and can synthesize new operators. This is the function-registry + agent-composition pattern fully realized for training data pipelines.

**Agentics 2.0 (arXiv 2603.04241, Mar 2026):**  
Formalizes LLM inference as a "transducible function" — a typed semantic transformation that enforces schema validity. Functions compose via algebraically grounded operators into Map-Reduce programs. Stateless asynchronous execution. This is the theoretical underpinning of "functions as first-class agentic primitives."

### Why method chains are worse for agents

A pandas method chain like:
```python
df.groupby('region').agg({'revenue': 'sum', 'orders': 'count'}).reset_index().rename(columns={'revenue': 'total_rev'}).sort_values('total_rev', ascending=False).head(10)
```

Problems for an agent:
1. **API surface explosion:** pandas has ~500 methods. GPT-4o achieves 38.58% valid invocations for low-frequency API calls. The agent must know all 500 methods to use them correctly.
2. **Hallucination risk:** LLMs invent methods that don't exist (e.g., `df.merge_on_index()`). 
3. **Version sensitivity:** Method signatures change across pandas versions; the agent's training data may be outdated.
4. **Opaque composition:** Each method returns a DataFrame — the type is always DataFrame, so there's no type-checking at composition time.
5. **State binding:** The chain is bound to a specific DataFrame object, not a composable description of a computation.

A function-based alternative:
```python
# Each function is a named, typed, discoverable unit
revenue_by_region = aggregate(table=sales, group_by="region", metrics=["revenue", "orders"])
top_regions = top_k(table=revenue_by_region, sort_by="revenue", k=10)
```

Here, `aggregate` and `top_k` are registered functions with schemas. The agent can discover them via `list_functions()`, read their docstrings as tool descriptions, and compose them by matching output schema to input schema — without needing to know the implementation.

### The semantic layer connection

The semantic layer (dbt MetricFlow, AtScale, Databricks Unity Catalog metrics) is a production implementation of named functions with business meaning:

- Metric definitions: `revenue = sum(amount) where status='completed'`
- Dimension definitions: `region`, `time_period`, `product_category`
- Composable metric types: simple, ratio, cumulative, derived

Agents querying via a semantic layer call named functions, not raw SQL against raw tables. The metric definition enforces business logic; the agent doesn't need to know the underlying table schema or joins.

The dbt MCP server (2025) exposes the semantic layer as MCP tools: agents can call `query_metric(metric="revenue", dimensions=["region"], filters={"date": "last_30_days"})` — a pure function call with a discoverable schema.

---

## 5. Agent-First Data Tools: What Exists and What's Missing

### Current tools and their limitations

| Tool | What it offers | What it lacks for agents |
|------|---------------|--------------------------|
| pandas | Comprehensive transformations | ~500-method API surface, not agent-discoverable, slow UDFs |
| DuckDB Python | SQL + Python UDFs, Arrow integration, introspectable via `duckdb_functions()` | UDF registration not networked/sharable |
| Polars | Fast native expressions, plugin system | UDFs still slow; plugin system requires Rust |
| Ibis | Backend-agnostic expression graph, UDFs portable | Primarily for developers, not agent-first |
| dbt + MetricFlow | Named, governed metrics as functions | SQL-layer only; not arbitrary Python computation |
| Great Expectations | Data quality as callable assertions | MCP server exists (Smithery) but not purpose-built for agents |
| Hamilton | Function-as-DAG-node pattern | Human developer workflow, not agent-native |
| Bauplan | Python functions as pipeline nodes, Arrow I/O, agent-safe execution | Proprietary lakehouse platform |

### What an "agent-first data tool" requires (derived from research)

Five properties, derived from converging signals across the literature:

**1. Introspectable (agent can discover functions)**  
DuckDB has `duckdb_functions()` — a SQL-queryable catalog of all registered functions including their signatures. This is the right pattern. Every function in the registry must be queryable: name, parameter types, return type, description. The agent's discovery loop: `SELECT name, description, parameter_types, return_type FROM catalog WHERE category='aggregation'`.

**2. Safe to call (bounded side effects)**  
The Bauplan "proof-carrying code" paper (arXiv 2510.09567) formalizes this: agents should operate on data branches (like git branches), not production. Pure functions — no mutation of global state, no side effects outside explicit outputs. Sandboxed execution with deterministic replay. The agent can call any function without risk of corrupting production data.

**3. Composable (output of one is input of next)**  
Arrow as the universal I/O type makes this concrete. If every function in the registry accepts `pyarrow.Table` and returns `pyarrow.Table` (or typed ChunkedArrays), then composition is type-checkable at graph-construction time. This is the "lego connector" — all bricks have compatible connectors.

**4. Self-describing (docstrings/schemas the agent can read)**  
Python function docstrings + type annotations can be automatically converted to tool schemas (ToolRegistry, arXiv 2507.10593, does exactly this). A function like:
```python
def filter_by_date(table: pa.Table, column: str, start: date, end: date) -> pa.Table:
    """Filter rows where `column` falls within [start, end] inclusive."""
    ...
```
automatically becomes a JSON Schema-described tool that any agent framework (OpenAI, Anthropic, LangChain) can use.

**5. Deterministic**  
Given the same inputs, a data function should return the same output. No random seeds, no external state. This is a precondition for the agent being able to retry, verify, and compose reliably. The DataFlow and Agentics 2.0 frameworks both emphasize this: typed, schema-validated functions as the reliability primitive.

### What's currently missing

**Missing: A function registry specifically for data analysis**  
There is no production-ready system that combines: (a) a Python UDF registry, (b) Arrow as the I/O contract, (c) automatic schema generation for agent tool use, (d) function discovery queries, and (e) high-performance Arrow vectorized execution. DuckDB comes closest but is not purpose-built for the multi-function-registry pattern. ToolRegistry covers (c) and (d) but not (a), (b), or (e).

**Missing: JIT compilation integrated with the registry**  
Tuplex showed that Python UDFs can be JIT-compiled to native code with 5–91x speedup. No current tool integrates Tuplex-style compilation into a function registry. The closest is Polars plugins (Rust compilation) but those require writing Rust.

**Missing: Agent-native composition verification**  
No existing system type-checks UDF composition before execution. An agent assembling a pipeline of 5 functions cannot verify that the output of step 3 is a valid input for step 4 without running it. A typed composition layer (using Python type annotations on Arrow schemas) would enable static verification.

**Missing: Semantic function naming for data operations**  
Most UDF registries use technical names (e.g., `log_transform_col`). An agent-first registry would use business-semantic names (`normalize_revenue_by_market`), with descriptions that explain business meaning, not just implementation.

---

## 6. Synthesis: What a Ground-Up Agent-Native Data Analysis System Built on UDFs Would Look Like

### The architectural inversion

Current pattern (NL → code → execution):
```
Agent → generates pandas/SQL code → executes in interpreter/DB → returns result
```
Problems: API surface too large, hallucination risk, schema drift breaks generated code, no composability guarantee, UDF performance is unpredictable.

Proposed pattern (agent → function selection → composition → execution):
```
Agent → discovers functions from registry → composes typed function graph → executes compiled graph → returns result
```

This is not new in principle — it's what dbt's semantic layer does, what LINQ does, what Spark transformations do. What's new is building it ground-up for Python UDFs with Arrow I/O and agent-facing introspection.

### The five-layer stack

**Layer 0: Storage + format**  
Apache Arrow as the universal in-memory format. Parquet/Iceberg on disk. Arrow IPC for process boundaries. Zerrow-style zero-copy for pipeline-internal data movement (100–200x I/O speedup on large tables).

**Layer 1: Execution engine**  
DuckDB (or Apache DataFusion) as the SQL execution engine. Provides: vectorized execution, columnar processing, Arrow-native I/O, built-in `duckdb_functions()` introspection, Arrow UDF support, PRISM-style UDF optimization. The engine handles the hard problems: predicate pushdown, scan skipping, join optimization.

**Layer 2: UDF runtime with JIT**  
Arrow-vectorized Python UDFs as the primary registration format. JIT compilation via Tuplex-style speculative compilation (or Numba for numeric ops) as an optimization pass. Polars expression plugins as an escape hatch for Rust-level performance. The UDF runtime takes a Python function, compiles it (speculatively, on first execution with a data sample), and registers the compiled form. This eliminates the 750x overhead of row-at-a-time execution.

**Layer 3: Function registry with agent API**  
A catalog of registered functions with:
- Name, category, description (human-readable and agent-readable)
- Input types (Arrow schemas for tabular functions; scalar types for scalar functions)
- Output types
- Examples and test cases
- Performance characteristics (estimated cost per row)

Agent discovery:
```python
registry.search("aggregate by date")
# Returns: [date_bucket, daily_aggregate, cumulative_by_date, ...]

registry.get_schema("daily_aggregate")
# Returns: {input: {table: ArrowSchema, date_col: str, metric_cols: [str]}, output: ArrowSchema}
```

**Layer 4: Composition layer**  
A typed graph builder that checks composition validity:
```python
# Type-safe composition
pipeline = (
    Pipeline()
    .step(filter_date_range, kwargs={"start": "2024-01-01", "end": "2024-12-31"})
    .step(aggregate_by_region)
    .step(top_k, kwargs={"k": 10, "sort_col": "revenue"})
)
# Composition check: output of filter_date_range ↔ input of aggregate_by_region ✓
# Output of aggregate_by_region ↔ input of top_k ✓
result = pipeline.execute(data_source)
```

The composition layer uses Python type annotations on Arrow schemas to verify at graph-construction time that types are compatible. This prevents runtime type errors and enables the agent to catch errors before execution.

**Layer 5: Agent interface**  
Two modes:

*Structured tool use (preferred):* Functions exposed as MCP tools or OpenAI function-call schemas. The agent discovers available functions, reads their descriptions, and assembles a pipeline by calling the composition layer. No code generation required.

*NL → pipeline compilation (fallback):* For novel operations not in the registry, an LLM generates a Python function body, which is registered into the runtime layer, JIT-compiled, and added to the registry for future use (DataFlow-Agent pattern: synthesize new operators on demand).

### Comparison to current approaches

| Approach | API surface the agent sees | Failure modes | Performance | Safety |
|----------|---------------------------|---------------|-------------|--------|
| NL → pandas code | ~500 methods | Hallucination, schema drift, version mismatch | Variable (row-at-a-time by default) | Runs arbitrary code |
| NL → SQL | ~SQL dialect | Schema topology errors, ambiguity | Good (engine-native) | SQL only, limited expressiveness |
| NL → function registry | N registered functions | Function not in registry | Good (Arrow vectorized + JIT) | Bounded side effects by construction |
| Semantic layer (dbt/MetricFlow) | M metric definitions | Missing metric definition | Good | Governed, read-only |

The function-registry approach occupies a better trade-off: smaller (and discoverable) API surface than raw pandas, more expressive than SQL alone, faster than row-at-a-time Python, and safer than arbitrary code execution.

### What makes this technically feasible now (2025–2026)

1. **Arrow is ubiquitous:** DuckDB, Polars, pandas 2.0, PyArrow, DataFusion, Spark all speak Arrow. The universal connector exists.
2. **Performance gap is closable:** Tuplex (5–91x), Polars plugins (14–50x), DuckDB Arrow UDFs (>10x over row UDFs), RAPIDS cuDF (435x on GPU). The choice is compilation strategy, not giving up Python.
3. **LLM tool use is mature:** OpenAI Agents SDK (Mar 2025), MCP (Anthropic), function-calling in all major models. The agent-to-function protocol is standardized.
4. **Semantic layer tooling exists:** dbt MetricFlow is open source under Apache 2.0 as of 2025. ToolRegistry (arXiv 2507.10593) handles the schema-generation layer. dbt MCP server exists.
5. **Safety infrastructure exists:** Bauplan's proof-carrying-code approach, data branching, sandboxed FaaS execution. The patterns for safe agent data access are proven.

The remaining gap is integration: no system combines all five layers. The closest approximations are Bauplan (Layers 0–2, partial Layer 5) and dbt+MetricFlow+MCP (Layers 3–5, no Layer 2 performance). Building the full stack is an engineering project, not a research project.

---

## Key Sources

### Spiegelberg and talk
- Talk page: https://aicouncil.com/talks25/the-modern-data-stack-lost-the-war-stop-building-more-dataframe-apis
- LinkedIn: https://www.linkedin.com/in/leonhard-spiegelberg/
- GitHub: https://github.com/LeonhardFS
- Tuplex (SIGMOD 2021): https://dl.acm.org/doi/10.1145/3448016.3457244
- Tuplex project: https://tuplex.cs.brown.edu/
- Brown thesis abstract: listed on https://cs.brown.edu/~lspiegel/

### UDF performance
- Polars UDF docs: https://docs.pola.rs/user-guide/expressions/user-defined-python-functions/
- Polars plugins (14x speedup): https://medium.com/data-science/using-polars-plugins-for-a-14x-speed-boost-with-rust-ce80bcc13d94
- DuckDB Python UDF (original 2023): https://duckdb.org/2023/07/07/python-udf
- DuckDB Python function API: https://duckdb.org/docs/current/clients/python/function
- DuckDB Arrow IPC (May 2025): https://duckdb.org/2025/05/23/arrow-ipc-support-in-duckdb
- Spark Pandas UDFs (original): https://www.databricks.com/blog/2017/10/30/introducing-vectorized-udfs-for-pyspark.html
- RAPIDS cuDF CUDA UDFs: https://developer.nvidia.com/blog/running-python-udfs-in-native-cuda-kernels-with-rapids-cudf/
- UDFBench (VLDB 2025): https://www.vldb.org/pvldb/vol18/p2804-foufoulas.pdf
- PRISM UDF outlining (VLDB 2025): https://www.vldb.org/pvldb/vol18/p1-arch.pdf
- DuckDB scikit-learn UDF integration (May 2025): https://duckdb.org/2025/05/16/scikit-learn-duckdb

### High-level operators and the algebraic layer
- Substrait: https://substrait.io/
- Ibis composable ecosystem: https://ibis-project.org/concepts/composable-ecosystem
- Ibis + Substrait + DuckDB: https://ibis-project.org/posts/ibis_substrait_to_duckdb/
- Arrow "data wants to be free" (Feb 2025): https://arrow.apache.org/blog/2025/02/28/data-wants-to-be-free/
- Zerrow zero-copy Arrow (Apr 2025): https://arxiv.org/abs/2504.06151

### Functions as legos
- LINQ and cloud composability (ACM Queue): https://queue.acm.org/detail.cfm?id=2141937
- Apache Hamilton: https://hamilton.apache.org/
- DataFlow framework (arXiv Dec 2025): https://arxiv.org/abs/2512.16676
- Agentics 2.0 transducible functions (arXiv Mar 2026): https://arxiv.org/abs/2603.04241

### Agent-first data tools
- OpenAI in-house data agent: https://openai.com/index/inside-our-in-house-data-agent/
- dbt MCP server: https://docs.getdbt.com/blog/introducing-dbt-mcp-server
- MetricFlow open source: https://www.getdbt.com/blog/open-source-metricflow-governed-metrics
- Wren Engine (Ibis + DataFusion + MDL): https://github.com/Canner/wren-engine
- Bauplan agent-native lakehouse: https://www.bauplanlabs.com/
- Bauplan data agents: https://www.bauplanlabs.com/post/data-engineer-agents
- Bauplan safe agents paper (arXiv Oct 2025): https://arxiv.org/abs/2510.09567
- Bauplan FaaS pre-print (arXiv Oct 2025): https://arxiv.org/abs/2410.17465
- ToolRegistry for LLMs (arXiv 2507): https://arxiv.org/html/2507.10593v1
- AI agents need composable data systems: https://blog.ormilabs.com/why-ai-agents-need-composable-data-systems/
- Wren AI composable data systems and LLM agents: https://medium.com/wrenai/the-new-wave-of-composable-data-systems-and-the-interface-to-llm-agents-ec8f0a2e7141

### NL→SQL failure modes and API complexity
- NL2SQL state of the art (VLDB 2025): https://www.vldb.org/pvldb/vol18/p5466-luo.pdf
- 50K LLM SQL queries analysis: https://www.usedatabrain.com/blog/llm-sql-evaluation
- Beyond perfect APIs: LLMs under real-world API complexity (arXiv 2601): https://arxiv.org/html/2601.00268v1
- API hallucinations mitigation (Amazon Science): https://arxiv.org/html/2407.09726

### Semantic layer
- Databricks semantic layer architecture: https://www.databricks.com/blog/semantic-layer-architecture-components-design-patterns-and-ai-integration
- AtScale golden age of semantic layer: https://www.atscale.com/blog/golden-age-of-the-semantic-layer/

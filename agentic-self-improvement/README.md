# Agentic Self-Improvement: Frameworks and Business Deployment Patterns

Date researched: 2026-05-01

## Executive summary

Agentic systems can learn and improve themselves while in operation without retraining model weights. The practical 2026 stack for a business without an ML research team is: **persistent memory + reflection loops + periodic prompt optimization + observability with human annotation**. This requires only LLM API access, a vector database, and an orchestration library — no GPU, no labeling pipeline at scale, no ML infrastructure.

The field has converged on two improvement timescales:
- **Intra-task** (within a single run): reflection / self-critique that revises outputs before returning them.
- **Inter-task** (across runs / sessions): memory that persists learned facts, preferences, and successful strategies; prompt optimization that runs periodically on accumulated traces.

---

## The core taxonomy

Self-improvement in agents can be characterized along three axes:

| Axis | Options | Notes |
|---|---|---|
| **What to evolve** | Model weights, prompts, memory, tools, workflow graph | Weights = expensive/heavyweight; everything else = lightweight |
| **When to evolve** | Intra-task (within episode), inter-task (across episodes) | Both are achievable without fine-tuning |
| **How to evolve** | Gradient RL, LLM-guided, evolutionary, experience-driven | LLM-guided and experience-driven require only API calls |

The key practical insight: **evolving prompts, memory, and workflow topology via additional LLM calls captures most of the benefit of fine-tuning for typical business tasks**, at a fraction of the setup cost.

---

## Mechanisms

### 1. Persistent memory

Memory is the single highest-leverage improvement mechanism for most business agents. An agent that remembers what worked, what failed, and what a user prefers will naturally improve over sessions — without any other machinery.

**Types of memory relevant here:**

| Type | What it stores | Timescale | Example |
|---|---|---|---|
| Episodic | Recent interactions, trajectories | Short-to-medium | Last 5 support conversations with this user |
| Semantic | Consolidated facts, preferences | Long-term | "User prefers bullet-point summaries"; "Account X is in fintech" |
| Procedural | Successful action sequences | Long-term | "When classifying contract type, always check clause 4 first" |

**Recommended tools:**

- **[Mem0](https://mem0.ai/)** — the most practical choice for most teams. Self-hosted via Docker Compose (3 containers: FastAPI, PostgreSQL+pgvector, Neo4j). `pip install mem0ai`. Only needs an LLM API key to start. Extracts facts from conversations automatically, stores as vector embeddings + entity graph, retrieves by semantic similarity. 91% lower latency and 90%+ token savings vs naive full-context replay. Adopted by CrewAI, Flowise, Langflow; AWS's exclusive memory provider for its Agent SDK. Managed API available if self-hosting is too much overhead.

- **Anthropic Managed Agents `/mnt/memory/`** — if you're already on Claude Managed Agents, memory is mounted as a directory inside the container. The agent reads and writes it using the same bash and file tools it already has. Zero additional API patterns. Public beta as of April 2026. This is the lowest-barrier path if Claude is your runtime.

- **MemGPT / Letta** — the original OS-inspired hierarchical memory system. More flexible than Mem0 but more complex to configure. Good for use cases requiring fine-grained control over what gets moved between memory tiers.

**What to watch:** memory accumulates noise over time. Use Mem0's built-in scoring, or implement an Ebbinghaus-style decay (SAGE paper): decay memories by recency and access frequency, consolidate related memories, prune low-scoring ones periodically.

---

### 2. Reflection and self-critique

Reflection is an intra-task mechanism: the agent produces a draft, a critic evaluates it, and the agent revises — looping until the output passes or a max-iteration cap is hit.

**The Reflexion pattern:**
1. Agent generates a response.
2. A critic (same or different model) scores it against a rubric.
3. If score < threshold, critique is added to context and agent revises.
4. On task completion, the episode critique is stored in memory for future runs.

**Key implementation detail:** always cap at 2–3 iterations. Empirically, most improvement comes in the first revision; iterations beyond 3 rarely help and multiply cost.

**LangGraph reflection:** `langgraph-reflection` library implements this as a graph with Draft → Critic → Revise → Evaluate nodes and conditional edges. Used in production by Klarna and Replit. The critic can be: rule-based (regex/schema validation), LLM-as-judge, or an external evaluation tool.

**SAGE framework** extends this with a three-role system (User, Assistant, Checker) and couples reflection to memory: lessons from each reflection cycle are written to semantic memory and retrieved in future sessions.

---

### 3. Prompt optimization (offline, periodic)

DSPy is the leading framework for automatically improving prompts and few-shot examples without touching model weights. It treats the LLM pipeline as a program and the prompts/demonstrations as learnable parameters.

**How it works:**

```
1. Define pipeline as dspy.Modules with typed Signatures
2. Define a metric function (accuracy, F1, faithfulness, etc.)
3. Call optimizer.compile(pipeline, trainset=examples, metric=metric)
4. Optimizer runs many traces, collects successful ones, proposes prompt variants
5. Bayesian search finds the best combination
6. Export the optimized program; deploy it
```

**Key optimizer: MIPROv2** — jointly optimizes instructions + few-shot examples. Works best with 50+ labeled examples (300+ for larger pipelines). A typical RAG pipeline sees ~10% relative quality gain after one MIPRO run.

**Production cadence:** run MIPRO offline (weekly or on quality drift) against an accumulated trace/annotation dataset from LangSmith. Not a real-time loop — it's a scheduled improvement cycle. This is the right mental model: DSPy is to prompts what CI/CD is to code.

**When to start with DSPy:** when you have a well-defined task, a measurable metric, and at least 50 labeled examples. Document processing, structured extraction, triage classification, and RAG Q&A are the natural first targets.

---

### 4. Experience-driven learning (trajectory retrieval)

The simplest possible inter-task improvement mechanism: store successful task trajectories in a vector database, retrieve similar past successes as few-shot examples at inference time.

- When agent succeeds at a task, store the full (input, trajectory, output) triple.
- At next task, retrieve top-k most similar successful trajectories by embedding similarity.
- Provide them as in-context examples.

No optimizer, no critic, no memory system — just a vector database and a retrieval call. This alone lifted ALFWorld performance from 73% → 89% in research (Self-Generated In-Context Examples, 2024).

**Business applicability:** very high. Any team running a database can implement this. The only complexity is defining what "success" means and building the retrieval step.

---

### 5. Automated workflow evolution (research-grade, narrow tasks)

For narrow, well-defined tasks with automated evaluation, fully hands-off improvement loops are now practical.

**EvoTest (ICLR 2026):**
- Two roles: Actor (performs the task) and Evolver (reads the full episode transcript and rewrites the agent configuration for the next run).
- Evolver updates: system prompt, memory contents, hyperparameters (temperature, top-k), and tool-use routines.
- Pure LLM forward passes — no gradient computation, no GPU.
- 38% better than best prompt-evolution baseline on J-TTL benchmark.
- Best for: agents with a game-loop-like structure (run → score → improve → repeat).

**EvoAgentX (EMNLP 2025):**
- Framework that generates a multi-agent workflow from a natural language goal, then iteratively optimizes it.
- Uses TextGrad (natural-language "backpropagation"), AFlow (topology search), and MIPRO (prompt refinement) in combination.
- `pip install evoagentx`; LLM API key required; Docker optional for code sandboxing.
- Good for: teams that want to auto-discover the right multi-agent topology for a task rather than designing it by hand.

**Caveat:** both frameworks are at the research-to-production boundary. Suitable for pilot projects on narrow tasks; not yet turn-key for general enterprise deployment.

---

## Deployment stack options (ordered by barrier to entry)

### Tier 1: 1–2 days — Memory + reflection on existing agent

**What you need:** LLM API key, Mem0 (Docker Compose or managed API), ~50 lines of application code.

**What you build:**
- Memory add/search calls bracketing each agent session.
- A reflection loop: generate → evaluate (rule-based or LLM-as-judge) → revise (max 3 iterations).
- After each session: write lessons learned to Mem0 memory.

**What you get:** agent that remembers across sessions and self-corrects within sessions. The two highest-ROI improvements for the least effort.

**Example use cases:** customer support, personalized Q&A, research assistant.

---

### Tier 2: 1–2 weeks — DSPy prompt optimization

**What you need:** 50–300 labeled examples from your domain, a metric function, DSPy.

**What you build:**
- Replace hand-crafted prompts with `dspy.Predict` modules and typed `Signatures`.
- Define a metric (e.g., `exact_match`, `faithfulness_score`).
- Run `MIPROv2.compile()` offline. Export and deploy the optimized program.
- Schedule weekly re-runs as new labeled examples accumulate.

**What you get:** prompts and demonstrations that are optimized for your data, automatically. Ends the manual prompt-engineering cycle.

**Example use cases:** document extraction, RAG Q&A, triage classification.

---

### Tier 3: 2–4 weeks — Full improvement loop

**Stack:** LangGraph (orchestration) + LangSmith (observability + annotation) + Mem0 (memory) + DSPy (optimization).

**What you build:**
1. LangGraph agent with reflection nodes.
2. LangSmith traces captured on every production run.
3. Annotation queue: human reviewers flag poor outputs; LLM-as-judge auto-labels the rest.
4. Weekly DSPy re-optimization run against the annotated trace dataset.
5. Lessons from annotator notes written to Mem0 as semantic memories.

**What you get:** a continuously improving agent with human oversight integrated into the loop. The human workload is bounded (annotate a sample, not everything); the automation handles the rest.

**Example use cases:** code review agents, outreach personalization, meeting summarization, knowledge base Q&A.

---

### Tier 4: Anthropic Managed Agents (lowest friction for Claude users)

**What you need:** Managed Agents API access, memory feature enabled.

**What you build:**
- Agent with `/mnt/memory/` reads/writes using standard bash tools.
- Outcomes defined (research preview) for self-evaluation.
- Agent versions tracked explicitly (pin version on session create for staged rollout).

**What you get:** cross-session memory and self-evaluation baked into the runtime, with zero additional infrastructure. Managed Agents handles sandboxing, session isolation, prompt caching, and compaction automatically.

**Limitation:** least control over the improvement loop; the memory is agent-managed, which means you need to trust the agent's judgment about what's worth remembering and what's not. See notes on memory security.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Loop cost runaway** | Always cap reflection iterations (max 3). Monitor cost-per-run in LangSmith. |
| **Metric Goodhart** | Use multiple metrics; do periodic human review even in automated loops. |
| **Memory noise accumulation** | Use Mem0's scoring or implement time-decay pruning. Audit memory contents periodically. |
| **Cross-task performance regression** | Track metrics across all supported tasks, not just the last one optimized. |
| **Memory injection attacks** | Sanitize any user-supplied content before writing to memory. Scope `/mnt/memory/` access carefully. |
| **Production readiness gap** | Start with one narrow use case; prove the eval metric; then expand. Most failures come from skipping the eval step. |

---

## Comparison of key frameworks

| Framework | Self-improvement mechanism | Fine-tuning needed? | Setup barrier | Best for |
|---|---|---|---|---|
| **Mem0** | Persistent cross-session memory | No | Very low (pip + Docker) | Any agent needing personalization or context retention |
| **DSPy (MIPROv2)** | Automated prompt + demo optimization | No | Low-medium (need labeled data + metric) | Well-defined tasks with measurable metrics |
| **LangGraph + Reflexion** | Intra-task reflection loops | No | Low (pip + LangChain ecosystem) | Any agent with verifiable output quality |
| **LangSmith** | Observability, annotation, online eval | No (enables the loop, not the learner) | Low (managed SaaS) | Production monitoring and human-in-the-loop feedback |
| **EvoAgentX** | Workflow + prompt evolution | No | Low-medium (pip, research-grade) | Narrow tasks with automated evaluation; topology discovery |
| **EvoTest** | Full config evolution (prompt + memory + hyperparams) | No | Medium (need episode scoring infrastructure) | Game-loop-like tasks; fully automated narrow pipelines |
| **SAGE** | Reflection + memory with forgetting curve | No | Medium (custom implementation) | Long-horizon tasks requiring both correction and retention |
| **AutoGen v0.4** | Multi-agent feedback + HITL | No | Low-medium | Enterprise multi-agent coordination with observability |
| **Anthropic Managed Agents + Memory** | File-based memory, outcomes self-eval | No | Very low (if already using Managed Agents) | Claude-native agents; lowest infrastructure overhead |
| **Full RLHF** | Weight updates from human preference | Yes (GPU required) | High | High-volume, high-value narrow tasks at scale |

---

## Concrete business use cases

### Customer support
- **Memory:** store per-user preferences, past issues, resolutions.
- **Reflection:** retry failed resolution paths with self-critique.
- **Optimization:** DSPy optimizes triage routing against CSAT labels.
- **Result:** ≥20% CSAT improvement (Capital One Eno benchmark); 70% autonomous resolution rate (1-800-Accountant deployment).

### Internal knowledge Q&A (RAG)
- **Memory:** store per-team terminology, document conventions.
- **Optimization:** MIPROv2 auto-optimizes retrieval + synthesis prompts against accuracy metric.
- **Reflection:** hallucination checker node triggers re-retrieval when answer isn't grounded.
- **Result:** typical RAG quality improvement of 10–15% from prompt optimization alone.

### Document processing / data extraction
- **Optimization:** DSPy with typed Pydantic output schemas and field-level F1 metric.
- **Reflection:** schema validation failures trigger re-extraction with error in context.
- **Memory:** store domain-specific entity aliases and exception cases.
- **Note:** easiest case for full automation — metric is objective, human review sample is small.

### Code review / PR agent
- **Reflection:** draft review → check against style guide rules → revise.
- **Memory:** per-repository conventions accumulated over time.
- **Observability:** LangSmith traces; engineers flag poor reviews.
- **Optimization:** poor-review annotations feed weekly DSPy re-optimization.

### Sales outreach personalization
- **Memory:** per-account context (industry, past interactions, preferences).
- **HITL:** human edits to drafts captured as implicit feedback signal.
- **Optimization:** accepted vs rejected drafts used as DSPy training signal.

---

## What to read next

- `../claude-managed-agents/README.md` — detailed guide to Anthropic Managed Agents runtime, relevant because the memory layer and outcomes features described here run on top of it.
- [DSPy documentation and optimizers](https://dspy.ai/learn/optimization/optimizers/) — MIPROv2 is the main optimizer to start with.
- [Mem0 open-source overview](https://docs.mem0.ai/open-source/overview) — self-hosting guide.
- [LangGraph reflection library](https://github.com/langchain-ai/langgraph-reflection) — reference implementation of the Reflexion pattern.
- [EvoTest paper](https://arxiv.org/abs/2510.13220) — best current system for fully automated narrow-task improvement loops; ICLR 2026.
- [EvoAgentX](https://github.com/EvoAgentX/EvoAgentX) — workflow evolution framework, EMNLP 2025.
- [SAGE paper](https://arxiv.org/abs/2409.00872) — reflection + memory with forgetting-curve decay; best reference architecture for long-horizon agents.
- [Mem0 paper](https://arxiv.org/abs/2504.19413) — production architecture and benchmarks.
- [Survey of Self-Evolving Agents](https://openreview.net/pdf/3345d492f049f49353081001b10c99e2d7124cc5.pdf) — taxonomy and literature review.

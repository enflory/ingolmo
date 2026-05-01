# Research Notes: Agentic Self-Improvement Frameworks

Started: 2026-05-01
Researcher: Claude

## Objective

Survey frameworks and approaches that allow agentic AI systems to learn and improve themselves while in operation — with a focus on business-deployable, lower-technical-barrier implementations.

## Related prior work

- `../claude-managed-agents/` — covers Anthropic's Managed Agents runtime (async agent loop, sessions, tools). Directly relevant: Managed Agents now has memory (public beta as of ~Apr 2026) and outcomes (research preview) which form a natural substrate for self-improvement loops. Agent versioning is also a foundation for improvement tracking.

## Research plan

1. Web research: landscape of self-improving agent frameworks
2. Identify key mechanisms: memory, reflection, feedback loops, meta-learning
3. Identify specific frameworks/tools with low barrier to entry
4. Map use cases to business deployment scenarios
5. Synthesize findings into README

---

## Round 1: Core taxonomy

The self-improving agent space has a useful three-axis taxonomy (from survey literature):

**What to evolve:**
- Model parameters (weights) — needs fine-tuning, expensive
- Prompts / instructions
- Explicit external memory (episodic, semantic, procedural)
- Toolsets / tool definitions
- Workflow graph / agent topology
- Agent population / roles

**When to evolve:**
- Intra-task (within a single episode): reflection, error correction, online search
- Inter-task (across runs): prompt consolidation, knowledge distillation to memory, occasional fine-tuning

**How to evolve:**
- Gradient-based RL (expensive, needs GPU)
- LLM-guided (use another LLM call as the "optimizer")
- Evolutionary / population-based
- Experience-driven (successful trajectory retrieval)

The key insight for low-barrier business deployment: **you can get most of the improvement without touching model weights at all** — by evolving prompts, memory, and workflow topology using LLM calls.

---

## Round 2: Key mechanisms in detail

### 2.1 Memory systems

**Mem0** (mem0.ai):
- "Universal memory layer" — dynamically extracts, consolidates, retrieves facts from conversations
- Architecture: FastAPI + PostgreSQL/pgvector + Neo4j (graph for entity relationships)
- Self-hosted via Docker Compose (one command: `docker compose up`)
- Only OPENAI_API_KEY required; ~2-5 min setup
- Python SDK: `pip install mem0ai` — add/search memory in 3 lines
- Multi-user and multi-agent isolation via `user_id` / `agent_id` params
- 41k GitHub stars, 14M downloads; adopted by CrewAI, Flowise, Langflow; AWS chose it as exclusive memory provider for its Agent SDK
- Raised $24M Series A (Oct 2025) — production trajectory is solid
- 91% lower p95 latency vs naive full-context retrieval; 90%+ token cost savings

**SAGE (Self-evolving Agents with Reflective and Memory-augmented Abilities):**
- Research system published in Neurocomputing 2025
- Three agents: User, Assistant, Checker
- Memory types: working (context window), episodic (recent trajectory), semantic (consolidated facts)
- Memory optimization via Ebbinghaus forgetting curve simulation — decays low-value memories, reinforces high-value
- No fine-tuning needed — purely prompt + memory manipulation
- 2.26× improvement on closed-source models; 57.7–100% on open-source; 105.85% improvement on Minecraft long-horizon tasks

**MemGPT / Letta:**
- OS-inspired virtual context management: hierarchical memory (main context, external storage)
- Agent controls its own memory via tool calls (read, write, summarize)
- Inspired a whole class of "self-directed memory editing" agents
- More complex to set up than Mem0 but more flexible

**Anthropic Managed Agents Memory (public beta, Apr 2026):**
- Memory store mounted as `/mnt/memory/` directory inside agent container
- Agent reads/writes using the same bash/file tools already available — no new API patterns
- Workspace-scoped, versioned agents, persistent across sessions
- Extremely low barrier for teams already using Managed Agents — literally a file system

### 2.2 Reflection / self-critique loops

**Reflexion (Shinn et al.):**
- After a failed attempt, agent generates verbal self-critique → stores as episodic memory → uses in next attempt
- Operates entirely via prompting — no fine-tuning
- Production rule: rarely significant improvement after 3 iterations; always cap loops
- LangGraph implements this natively: nodes for Draft → Critic → Revise → Evaluate, with conditional edges

**LangGraph Reflection Agents:**
- LangGraph `langgraph-reflection` library: turn any chain into a reflection loop
- Define a "response generator" and a "critique generator"; loop until critique passes or max iterations hit
- Used by Klarna, Replit, Elastic in production
- LangSmith (now "LangSmith Deployment" after Oct 2025 rename) provides full observability: trace every step, annotation queues for human review, online evaluation for production drift detection

**Self-Discover / LATS:**
- LATS (Language Agent Tree Search): MCTS-like approach where agent explores multiple response branches and selects the best at inference time — expensive but powerful
- Self-Discover: agent constructs its own task-specific reasoning structure from atomic reasoning modules before tackling a problem

### 2.3 Prompt / workflow optimization (no fine-tuning)

**DSPy (Stanford):**
- Core idea: "programming language models" — define modules with typed signatures, then run an optimizer to find the best prompts and few-shot examples
- Key optimizers:
  - `BootstrapFewShot`: generates training examples by running your pipeline on data and keeping successful traces as demonstrations
  - `MIPROv2` (Multi-prompt Instruction Proposal): jointly optimizes instructions + few-shot examples via Bayesian optimization; works with 50–300+ examples
  - `BayesianSignatureOptimizer`: Bayesian refinement of signatures
- Typical workflow: define `dspy.Signature`, write pipeline modules, define a metric, call `optimizer.compile(pipeline, trainset, metric)` — outputs an optimized program
- Production pattern: run MIPRO offline on validation data periodically, export optimized prompts, deploy; re-run as performance drifts
- ~10% relative quality gain on a typical RAG pipeline with MIPRO
- JetBlue deployed DSPy for their RAG chatbot — reduced manual prompt engineering cycle significantly
- Barrier: need ~50 labeled examples minimum for BootstrapFewShot; MIPRO works better with 300+. You need a metric function (correctness, faithfulness, etc.)

**EvoAgentX (EMNLP 2025):**
- Framework that assembles multi-agent workflows from natural language goals, then evolves them
- Integrates three optimization algorithms: TextGrad (backprop-like in natural language), AFlow (workflow topology search), MIPRO (prompt refinement)
- Results: +7.44% HotPotQA F1, +10% MBPP, +10% MATH, +20% GAIA
- Install: `pip install evoagentx`; needs LLM API key; optional Docker for sandboxed code
- Low barrier for basic workflows; moderate complexity for custom tools or HITL

**EvoTest (ICLR 2026):**
- Actor Agent plays a task → Evolver Agent analyzes full transcript → rewrites prompt, updates memory, tunes hyperparameters, learns tool routines
- Pure LLM forward passes — no gradients, no GPU
- 38% better than best prompt-evolution baseline, 57% better than online RL on J-TTL benchmark
- Key tradeoff vs RL: replaces expensive backward pass with an additional LLM call — can be API-based

### 2.4 Human-in-the-loop feedback as the improvement signal

**LangSmith annotation + online evaluation:**
- Capture production traces → sample problematic runs → LLM-as-judge bootstraps labels → human annotators refine
- Annotation queues for single-run and pairwise comparison
- Online evaluation: real-time quality monitoring on production traffic, detects drift
- Result feeds back into: prompt revision, DSPy re-optimization, or Reflexion memory updates

**AutoGen v0.4 (Jan 2025):**
- Complete redesign: async, event-driven, better observability
- Human-in-the-loop pattern: escalate when confidence is low, allow human override, learn from human decisions
- OpenTelemetry support for enterprise observability
- Feedback from human decisions can be stored and used to update future agent behavior

**RLHF (high-barrier, included for completeness):**
- Full RLHF: SFT → reward modeling → PPO — needs GPU cluster, labeled preference data, ML expertise
- NOT lightweight; included because it's a common confusion point
- Practical alternative for businesses: use LLM-as-judge as a reward signal instead of training a separate reward model, then use DSPy or prompt evolution rather than weight updates

### 2.5 Experience-driven learning (trajectories as in-context examples)

Self-Generated In-Context Examples:
- When agent successfully solves a task, store full successful trajectory
- Future tasks prompted with a few past successful trajectories
- Lifts ALFWorld from 73% → 89%
- Zero infrastructure beyond a database; extremely lightweight

Procedural memory / skill libraries:
- Successful action sequences stored as named "skills" or "tools"
- Agent retrieves relevant skills at inference time
- Voyager (Minecraft) introduced this; Memento-Skills paper extends it to continual learning

---

## Round 3: Business deployment stack options

### Option A: Minimal — Reflection + Memory on existing agent (1–2 days to set up)

Stack:
- Any LLM API (Claude, GPT-4, etc.)
- Mem0 (Docker Compose, self-hosted or managed API) for long-term memory
- A reflection loop in your application code: run → evaluate → critique → update memory
- LangSmith or Langfuse for observability / trace capture

What you get: agent that remembers user preferences, past mistakes, and successful patterns across sessions. No fine-tuning, no GPU.

### Option B: Structured prompt optimization with DSPy (1–2 weeks)

Stack:
- DSPy pipeline replacing your hand-crafted prompts
- 50–300 labeled examples from your domain
- A metric function (accuracy, faithfulness, etc.)
- Run `MIPROv2` offline when performance drifts (can schedule weekly)

What you get: prompts and few-shot examples that are automatically optimized for your specific task and data. Repeatable, version-controlled improvement cycles.

### Option C: Full self-improving loop (2–4 weeks, moderate infra)

Stack:
- LangGraph for agent orchestration (stateful, persistent sessions)
- LangSmith for observability + annotation queues (human-in-the-loop)
- Mem0 or custom PostgreSQL + pgvector for memory
- DSPy for periodic prompt re-optimization based on annotated traces

What you get: a system that improves continuously — capturing production failures, routing them through human review when needed, and using annotated data to re-optimize prompts on a schedule.

### Option D: EvoAgentX / EvoTest pattern (experimental, 2–4 weeks)

Stack:
- EvoAgentX or custom Actor/Evolver agent pair
- A structured task environment with measurable outcomes
- Each run: actor executes, evolver analyzes transcript and rewrites configuration for next run

What you get: fully automated improvement loop — no human annotation needed if you have a reliable automated evaluator. Best for narrow, well-defined tasks (code generation, document classification, structured data extraction).

### Option E: Anthropic Managed Agents + Memory (lowest barrier for teams already on Claude)

Stack:
- Managed Agents API (Claude)
- Memory enabled (public beta)
- Outcomes defined (research preview)
- Agent reads/writes `/mnt/memory/` using existing bash tools

What you get: persistent cross-session learning baked into the runtime. Extremely low setup overhead if you're already on the platform. Self-evaluation loop via outcomes.

---

## Round 4: What to watch out for

- **Loop cost runaway**: reflection and evolution loops multiply LLM calls. Always cap iterations (3 is often enough). Monitor cost per run.
- **Metric goodhart**: if your evaluation metric is gameable, the agent will game it. Use multiple metrics and periodic human review even in automated loops.
- **Memory bloat**: without pruning, memories accumulate garbage. Mem0 and SAGE both address this (vector similarity + recency scoring; Ebbinghaus decay). Budget for periodic memory audits.
- **Catastrophic overwriting**: inter-task self-evolution can degrade performance on previously-mastered tasks. Track across-task metrics, not just latest-task metrics.
- **Production readiness gap**: ~75% of orgs have experimented with agentic AI; fewer than 25% have scaled to production. The tools exist — the challenge is evals, monitoring, and organizational trust.
- **Security of self-modification**: an agent that writes its own system prompt or memory is a potential injection target. Scope `/mnt/memory/` carefully; don't let untrusted input write to memory without sanitization.

---

## Round 5: Concrete business use cases

1. **Customer support agent**: Mem0 stores user preferences, past issues, resolutions. Reflection loop learns from failed resolution attempts. DSPy optimizes the triage routing prompt against CSAT labels. No fine-tuning needed.

2. **Internal knowledge Q&A (RAG)**: DSPy + MIPROv2 auto-optimizes retrieval + synthesis prompts against accuracy metric. EvoTest pattern can tune retrieval parameters (top-k, reranker threshold) automatically between deployments.

3. **Code review / PR agent**: Reflexion loop: draft review → check against company style guide → revise. Memory accumulates per-repository conventions. LangSmith captures traces; annotators flag poor reviews for DSPy re-optimization.

4. **Sales outreach personalization**: Agent drafts personalized outreach → human approves or edits → edits become training signal for DSPy prompt re-optimization. Memory stores per-account context.

5. **Document processing / data extraction**: Well-defined task = easiest case for DSPy. Define typed output schema (Pydantic), define F1 metric on field-level accuracy, run MIPRO. Can automate improvement entirely with a validation set.

6. **Meeting summarization / action item extraction**: Reflexion: generate summary → check against transcript completeness criterion → revise. Memory stores team-specific terminology and recurring project names.

---

## Synthesis

The field has converged on a practical "no-fine-tuning" stack for lightweight business deployment:
- **Memory** (Mem0 or file-based) for cross-session persistence
- **Reflection** (Reflexion pattern via LangGraph) for intra-task correction
- **Prompt optimization** (DSPy MIPROv2) for inter-task improvement
- **Observability + human annotation** (LangSmith) as the feedback pipeline

The Anthropic Managed Agents + Memory path is the most frictionless if you're already using Claude — the memory layer is a mounted file system the agent already knows how to use.

EvoTest/EvoAgentX are the leading edge for fully-automated improvement loops on narrow tasks — worth watching but not yet turn-key for most businesses.

Fine-tuning remains the highest-leverage option for high-volume, narrow tasks where you have thousands of examples and GPU access — but it's not necessary for most business deployments.

# notes — LLM provider/model abstraction

Working log. Append-only. Date opened: 2026-05-16.

## Goal

Research how to set up a **modular system that abstracts away the choice of LLM provider and model**, such that:
- swapping out the underlying model is easy
- the abstraction is **reusable across many applications**, not tied to one app
- the result is a recommendation backed by what the field actually uses in 2026

## Scope check before starting

The interesting question is not "is there an OpenAI-compatible wrapper" (LiteLLM, OpenRouter — yes, dozens). The interesting question is the **layering**: where in your stack does the abstraction live, what does its surface look like, how does it survive new model capabilities (extended thinking, computer use, tool use, structured outputs, multimodal, prompt caching) without becoming a lowest-common-denominator shell, and how do you keep configuration / model choice / prompt material out of the application code so apps stay portable.

## Prior threads in this repo to look at first

- `cli-tools-for-ai-agents/` — relevant because CLI tools that wrap LLMs face the same problem.
- `cli-agent-harness-survey/` — Codex/Cursor/Cline all have to deal with multi-provider; how do they?
- `claude-managed-agents/` — opinions on managed vs self-built.

Let me scan those before going wider.


## Round 1 — survey of named tools (2026 state, from web searches)

### Vercel AI SDK
- v5 introduced `LanguageModelV2` — interface defined by content **parts** (text, image, reasoning, sources, tool_call). Provider packages implement it.
- v6 in progress, mentions of `LanguageModelV3` already (Stagehand issue #1645).
- Same provider abstraction extended to **speech (TTS+STT)** in v5 — same shape across providers.
- TypeScript-first, but design now defines the conceptual model many people copy in Python.
- Core entry points: `generateText`, `streamText`, `generateObject`, `streamObject`, `Agent` (added later).

### LiteLLM
- Library + Proxy. ~140 providers, ~2,500 models. The library translates a single call shape (OpenAI chat completions) into provider-native calls.
- Proxy mode (the gateway) adds: virtual keys, budgets, RBAC, cost tracking, fallback chains, load balancing, caching, guardrails, logging.
- Quoted: powered 1B+ requests, 240M+ Docker pulls — i.e. de-facto org-scale option.

### aisuite (Andrew Ng / DeepLearning.AI)
- ~12k+ stars by mid-2025. Idea: `client.chat.completions.create(model="anthropic:claude-3-5-sonnet", ...)` — provider:model string is the *only* knob.
- Library only (no proxy). Tool/function calling abstraction. MCP support added.
- Compared to LiteLLM: aisuite is deliberately narrower — no proxy, no observability, no fallbacks. Just provider swap.

### Pydantic AI
- v1 stable, v1.85 by April 2026. Active.
- Architecture: `Model` is an abstract base class; provider packages implement it. Agent code is provider-agnostic by construction, but provider-specific capabilities are still reachable.
- Type-safe via Pydantic. FastAPI-style dependency injection.
- Supports OpenAI, Anthropic, Gemini, DeepSeek, Grok, Cohere, Mistral, Perplexity, Azure, Bedrock, Vertex, Ollama, **LiteLLM**, Groq, OpenRouter, Together, Fireworks, etc.
- Interesting: it can sit *on top of* LiteLLM, treating it as another provider — so you can use LiteLLM for routing and Pydantic AI for app shape.

### Instructor
- ~3M monthly downloads. Wraps any of 15+ provider SDKs to add Pydantic-validated structured outputs with retries.
- `from_provider("anthropic/claude-...")` style API normalized in 2025-2026.
- Doesn't try to abstract the whole chat surface, just the structured-output piece. Easier to keep correct as providers evolve.

### Gateways: OpenRouter / Portkey / Helicone / Cloudflare AI Gateway / LiteLLM Proxy
- **OpenRouter** — managed, 300+ models / 60+ providers. ~5.5% credit fee. Zero ops. Best for: prototypes, small teams, breadth of access.
- **Portkey** — managed + OSS. Differentiator: **guardrails, PII redaction, jailbreak detection, audit logs.** Compliance-heavy use cases.
- **Helicone** — observability-first. Acts as a logging proxy in front of whatever you already use. OSS self-host available.
- **Cloudflare AI Gateway** — observability + caching + retries, edge-deployed, no model hosting itself (proxies to providers).
- **LiteLLM Proxy** — self-host equivalent of OpenRouter+Portkey with fewer governance niceties out of the box.

### Hexagonal / Ports & Adapters for LLMs (2026 blogs)
- Pattern: define an `IntelligencePort` interface (or `LlmPort`) inside the application's core. Adapters implement it for OpenAI, Anthropic, etc. Core never imports a provider SDK.
- Argument behind it: LLM is the most volatile dependency in the codebase — today's SOTA model is tomorrow's legacy. Treat it like a database.
- Practical: define the port in domain terms (e.g. `extract_invoice`, `score_resume`) — *not* as a generic `chat()` method — and you get true portability. Generic `chat()` ports leak provider semantics back into the core.

### OpenAI Chat Completions as wire-level lingua franca
- vLLM, Ollama, llama.cpp, TGI, NVIDIA NIM, Together, Fireworks, Groq, DeepSeek, xAI, Mistral — all expose OpenAI-compatible `/v1/chat/completions`.
- This is the most powerful fact in the space: pointing the official OpenAI SDK at a different `base_url` works for ~80% of cases.
- Limits: structured outputs format varies, tool-calling shape drifts, reasoning_effort / extended thinking is provider-specific, prompt caching is mostly opaque to the wire format.

## Things still to look up

- OpenAI Responses API vs Chat Completions as the new universal shape
- Anthropic `messages` vs OpenAI shape — what doesn't round-trip
- Capability negotiation: who exposes a capability flag matrix?
- DSPy as an abstraction layer (signatures, not messages)
- Production patterns for fallback chains (when does silent fallback break apps?)


## Round 2 — more pieces

### OpenAI Responses API (2025-2026)
- "Strict superset" of Chat Completions. Supports `store=false` so it's stateless if you want.
- Built-in tools: web_search, file_search, code_interpreter, computer use, remote MCPs.
- Better cache utilization than Chat Completions (claimed 40–80% improvement) and small SWE-bench gain on same prompt.
- OpenAI deprecated Assistants API (sunset Aug 2026). Chat Completions stays "supported indefinitely as industry standard."
- Implication: there are now **two competing OpenAI-side wire formats**, and tool schemas differ between them.

### Anthropic Messages vs OpenAI Chat Completions (concrete drift)
- Anthropic: `system` is its own top-level param; OpenAI: `system` is just a role in the messages array.
- Tool use: Anthropic has tool_use / tool_result content blocks; OpenAI has tool_calls / `role: tool` messages.
- Prompt caching: Anthropic requires explicit `cache_control: {type: "ephemeral"}` markers; OpenAI auto-caches >= 1024 tokens.
- Anthropic OpenAI-compat endpoint exists but **does not support prompt caching** — caching needs the native Anthropic shape.
- Cost-wise it matters: Anthropic gives 90% cache discount, OpenAI 50% — abstracting away caching costs real money.

### DSPy as a different kind of abstraction
- Doesn't abstract the call; abstracts the **prompt itself**. You declare a Signature `question -> answer` and DSPy compiles it to whichever provider's prompt format.
- "Adapters" map signatures to provider-specific prompts.
- MIPROv2 optimizer can search prompts/few-shots against a metric — model-swap survives because the prompt is regenerated for the new model.
- The most opinionated answer in the space: "don't write prompts, write signatures."

### BAML (Boundary)
- Domain-specific language for type-safe LLM functions. Generates TS/Python/Ruby/Java/C#/Rust/Go bindings.
- Provider-agnostic client config — switch at runtime. Supports anything OpenAI-compatible plus Anthropic/Vertex/Bedrock natively.
- Distinctive: SAP (schema-aligned parsing) — tolerates markdown-wrapped JSON, CoT before the answer, etc. Most others reject those.

### Mirascope
- "LLM anti-framework" Python lib. Unified interface, Pydantic-backed structured outputs, similar provider list to Instructor.
- Aims at being a Goldilocks — control of raw SDKs, ergonomics of agent frameworks. Direct competitor to Pydantic AI and Instructor.

### Cloud-provider gateways (Bedrock / Vertex / Foundry)
- Bedrock **Converse API** is a unified shape across Anthropic, Llama, Mistral, Cohere, AI21, Titan. One auth (IAM), one API surface.
- Vertex AI is Gemini-first plus Model Garden for OSS weights.
- Azure AI Foundry plays a similar role for Azure-hosted models.
- Each is essentially a provider-managed gateway, but **locked to the cloud's models**. Bedrock doesn't host Gemini; Vertex doesn't host Claude (Anthropic models are also on Bedrock and Vertex now via Anthropic-on-cloud deals, complicating this).

### LangChain in 2026 (the cautionary tale)
- Multiple 2026 posts: "LangChain Is Quietly Losing Developers", "33 LangChain Alternatives". Core complaint: every layer is a leaky abstraction, debugging becomes archeology, and the API drifts toward LangSmith adoption rather than developer needs.
- Concrete 2026 fact: provider SDKs now ship enough natively (function calling, structured outputs, prompt caching, streaming tool calls, agent SDKs) that "I'm using LangChain to abstract over providers" is a much weaker justification than in 2023.
- LangGraph (the graph framework) still has a defensible niche; the LangChain Expression Language and the chain abstraction do not.

### What CLI agents do internally (from `cli-agent-harness-survey/`)
- Aider's "architect+editor" pattern is exactly the **two-model strategy** done in app code: use a strong reasoner for plan, a cheap fast editor for application. The abstraction must support per-call model choice, not just per-app.
- Continue's `config.yaml` has a `models:` block where each entry is `{ provider, model, apiBase, apiKey, roles: [chat,edit,...] }`. Multi-model selection by **role** is the cleanest UX I've seen.
- Cursor / Codex / Cline all use proprietary internal gateways that look LiteLLM-shaped — point at OpenAI-compatible URL, swap provider via config.

### Fallback-chain pitfalls (production)
- Silent fallback is the worst failure mode: 200 OK + worse output, indistinguishable from a slow day.
- Untested fallbacks don't work when you need them.
- Right shape: retries for transient errors, fallbacks for persistent failures, circuit breaker for systemic. Instrument all of them as first-class metrics.
- A realistic chain: Sonnet → Haiku → GPT-4o → local. Cross-provider only after intra-provider exhausted because cross-provider changes prompt semantics.

## Synthesis points to make in the README

1. **Two questions, not one.** "Where does the abstraction live?" (library vs gateway vs both) is independent of "what does the abstraction look like?" (chat shape vs domain ports vs signatures vs DSL).
2. **The wire is solved; the semantics aren't.** OpenAI chat completions has won as the wire format. But caching, tool use, structured outputs, reasoning, multimodal still diverge.
3. **LCD vs full-fidelity is a real tradeoff.** You either lose Anthropic prompt caching (50% money) or you write code that knows it's talking to Anthropic.
4. **Ports & adapters in domain language** is the design pattern most likely to age well. The application defines what it wants (`summarize`, `classify`), the adapter knows how to ask whichever model is configured.
5. **Two-layer recipe**: gateway for ops, library for ergonomics. Don't conflate.
6. **Prompts are data, not code.** They want their own registry with immutable versioning.
7. **Model selection should be runtime config**, never `import openai` at top of file deciding the choice for you.
8. **Capability flags must survive abstraction.** A model has a context window, a cost, a thinking knob, a caching mode. The registry that names models must carry those.

Ready to write README.

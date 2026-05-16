# Abstracting away the LLM provider and model

*Researched May 2026. Audience: a senior engineer who has shipped at least one production LLM feature, now designing an abstraction that will outlive a few model migrations and be reused across applications.*

This thread is about the layer of code that sits between your application and a specific model from a specific provider. The question is **how to design it so swapping models is cheap, swapping providers is possible, and the same abstraction works for app #2, #3, and #4 without rewrites.**

It is not a survey of "which LLM should I use." It assumes that question keeps changing every quarter and that the architecture should not.

---

## TL;DR

There is no single library that solves this. The good answer is a **two-layer recipe** plus three design rules.

The two layers:

1. **A wire-level gateway** for the cross-cutting operational concerns — billing, fallback, retries, rate limits, observability, key management, abuse controls. In 2026 that is **LiteLLM Proxy** for self-host, **OpenRouter** for managed (small teams), **Portkey** if you need compliance-grade guardrails, or a cloud-bundled equivalent (Bedrock Converse, Vertex, Azure AI Foundry) if you already live in that cloud. The gateway speaks **OpenAI Chat Completions** on the wire — every relevant inference engine (Anthropic, Gemini, Mistral, vLLM, Ollama, llama.cpp, Together, Fireworks, Groq, DeepSeek, xAI) either implements that format natively or has a translator.

2. **A typed application layer in each app** that exposes **domain-shaped operations** (e.g. `extract_invoice(pdf) -> Invoice`, not a generic `chat(messages)`). The implementation is a thin adapter around an LLM client pointed at the gateway. The libraries worth knowing are **Pydantic AI** (Python, agent-shaped, typed), **Vercel AI SDK** (TypeScript, content-parts model), **Instructor** or **BAML** (when the output is structured data), and **DSPy** (when you want to optimize the prompt against a metric instead of hand-tuning). All four can sit on top of the gateway.

The three rules — these matter more than the library choice:

- **Define the port in your domain's words, not the LLM's.** A `chat()` port leaks provider semantics back into the application. A `summarize_meeting(transcript) -> Summary` port doesn't.
- **Model identity is runtime config, never a code import.** Model name, base URL, API key, capability flags all live outside the application, loaded at start or per-request.
- **Prompts are data, not code.** They want their own registry with immutable versions, separate from the application binary, so you can swap a prompt without redeploying.

The rest of this document explains why these are the recommendations and the tradeoffs you should know about before adopting them.

---

## 1. The 2026 problem statement

Three forces shape this design problem today:

- **Models change quarterly.** A real production system in 2026 has migrated at least once from a model that is now retired. Locking your code shape to a specific model is the most expensive form of technical debt you can take on right now.
- **Provider APIs have stopped converging.** OpenAI shipped the Responses API, Anthropic kept the Messages shape and got dramatically better at prompt caching, Google kept its own shape, and capability-specific extensions (extended thinking, computer use, built-in web search, code interpreter, structured outputs) diverge faster than a unified spec can catch up. The wire format is mostly solved; the *semantics* are not.
- **Cross-cutting concerns are real.** Cost tracking, rate limiting, fallback chains, audit, PII redaction, guardrails, prompt versioning, A/B testing — every team rebuilds these badly the first time. They don't belong in application code.

The temptation is to grab one big framework and let it do everything. The 2026 consensus, from teams that have been through more than one model migration, is the opposite: **split the problem along the wire-vs-semantics seam, push ops into a gateway, push ergonomics into a typed in-app library, and write the domain port yourself.**

---

## 2. The layering model

Five layers, named for clarity:

| Layer | What it does | Examples |
|---|---|---|
| 0. Provider native | HTTP API or vendor SDK | `openai`, `anthropic`, `google-genai`, raw curl |
| 1. Wire normalizer | Same call shape, different provider | LiteLLM (lib mode), aisuite, OpenAI SDK pointed at compatible `base_url` |
| 2. Gateway / proxy | Org-level cross-cutting concerns | LiteLLM Proxy, OpenRouter, Portkey, Helicone, Cloudflare AI Gateway, Bedrock, Vertex |
| 3. Typed application layer | App-friendly types, structured outputs, tools, streams, agents | Vercel AI SDK, Pydantic AI, Mirascope, Instructor, BAML |
| 4. Agent / workflow layer | Graphs, loops, multi-agent | LangGraph, CrewAI, AutoGen, Smolagents, your own orchestrator |

Two seams matter:

- **Between 1 and 2.** Layer 1 lives in the application's address space; layer 2 is over the network. Whatever you do, the wire that crosses that seam wants to be **OpenAI Chat Completions** (or its strict superset, **OpenAI Responses**) because every relevant inference engine — including Anthropic via translators, Gemini, Bedrock, Vertex, vLLM, Ollama, llama.cpp, Groq, DeepSeek, Together, Fireworks, Mistral, xAI — speaks one or both of them. Picking a non-OpenAI-compatible wire is choosing to be incompatible with most of the ecosystem.
- **Between 2 and 3.** Below the seam, things are model-shaped: `messages`, `tools`, `response_format`. Above the seam, things should be domain-shaped: `Summary`, `Invoice`, `extract_topics`. Many teams build only layer 3, calling provider SDKs directly, and find swaps painful because their domain code is full of `messages.append({role: "user", ...})`.

You don't need all five layers. A solo project can collapse 0–3. A team with one app needs 1 + 3 at minimum. An org with many apps wants 2 + 3 wired thoughtfully.

---

## 3. The capabilities that don't normalize

Any abstraction has to make a choice here — either expose the full lowest common denominator (LCD) and lose features, or expose escape hatches and pay portability cost. The features that bite in 2026:

- **Prompt caching.** Anthropic uses explicit `cache_control: {type: "ephemeral"}` markers on individual content blocks, charges +25% to write, gives 90% off on reads. OpenAI auto-caches anything ≥ 1024 tokens, no markers, 50% off on reads. Gemini does its own implicit caching. **Anthropic's OpenAI-compatible endpoint does not support caching at all** — you must use the native Messages API to get the discount. Abstracting caching away can cost real money: on a heavy-context workload (200K prompts), full Anthropic caching is roughly 8x cheaper than no caching. A good abstraction lets the user opt into provider-specific caching without rewriting the rest.
- **Tool use shape.** Anthropic emits `tool_use` content blocks; OpenAI emits `tool_calls` on the assistant message and a `role: tool` reply; OpenAI Responses uses yet another tool schema. Parallel tool calls, streaming tool deltas, and `tool_choice` semantics all differ. LiteLLM and Vercel AI SDK normalize most of this; aisuite and Instructor handle the common case; raw SDKs do not.
- **Extended thinking / reasoning effort.** OpenAI o-series and GPT-5 use `reasoning_effort: minimal|low|medium|high`; Anthropic uses a `thinking` block with `budget_tokens`. The output shapes differ: OpenAI hides the reasoning trace, Anthropic returns it as a content part. Abstractions that hide this make it impossible to opt in to "think harder" or to bill correctly.
- **Structured outputs.** JSON mode (OpenAI old), strict schema mode (OpenAI new), `response_format: {type: "json_schema", strict: true}`, Anthropic's tool-call-as-schema trick, Gemini's `responseSchema`, and BAML's schema-aligned parsing all produce structured data with different reliability guarantees. The format you target affects whether retries help and whether validation should be done client-side.
- **Multimodal input.** Image, audio, PDF, and video parts all have different content-block shapes. Vercel AI SDK v5 generalized this to **content parts** (text, image, reasoning, source, tool_call), which is a defensible long-term abstraction.
- **Provider-built-in tools.** Web search, code interpreter, computer use, file search, remote MCPs — these are server-side capabilities on a specific provider. Cross-provider abstractions either ignore them or expose them only on the relevant adapter.
- **Cost & context window.** Numbers per model are stable enough to live in config but vary by 10x or more across the catalog. An app that picks "cheapest acceptable model" needs the registry to tell it cost.

The implication is design rule #1: **the abstraction should expose a `capabilities` flag on each model entry**, and the application should be able to ask "does this model support thinking? cache_control? vision?" before deciding what to send. The registries that don't do this (and many don't) push the application into either LCD code or model-aware branches.

---

## 4. The libraries and gateways worth knowing

### 4a. Wire normalizers (Layer 1)

**LiteLLM** is the gravitational center of this space. As a Python library it translates a single OpenAI-shaped call into ~140 provider APIs and ~2,500 models. As a proxy server (a separate process) it offers virtual keys, budgets, fallback chains, load balancing, caching, guardrails, and logging. The proxy mode is what most orgs end up running. It is heavily depended on — 240M+ Docker pulls, 1B+ requests served — which has costs (bloat, occasional bugs in obscure providers) and benefits (every new model lands here within days).

**aisuite** (Andrew Ng / DeepLearning.AI) is the minimalist alternative. One Python library, no proxy, `client.chat.completions.create(model="anthropic:claude-3-7-sonnet", ...)` — the only knob is the `provider:model` string. ~12K stars. It supports tool calling and MCP. Use it when you specifically *don't* want the operational machinery of LiteLLM and just need provider swap in code.

**OpenAI SDK with `base_url`** is the no-library answer. Most engines (vLLM, Ollama, llama.cpp, Together, Groq, OpenRouter, LiteLLM Proxy) accept `OPENAI_API_BASE` overrides and speak Chat Completions. For a single-provider app it's the lowest-dependency path; for multi-provider you pair it with a gateway that translates the non-compatible providers behind a single base URL.

### 4b. Gateways (Layer 2)

**LiteLLM Proxy** — self-host, OSS, runs anywhere, the broadest model support, decent governance. Default choice when you control the infrastructure.

**OpenRouter** — fully managed, 300+ models / 60+ providers, one API key, zero ops. Charges roughly 5.5% on credit purchases (minimum $0.80 per top-up), which is the cost of not running anything. Best for: prototypes, small teams, breadth.

**Portkey** — managed + OSS, distinctive on **guardrails, PII redaction, jailbreak detection, audit logs** at the gateway layer. The right call when "must not leak X" is a hard requirement and you don't want every app re-implementing scrubbers.

**Helicone** — observability-first proxy. Self-host or managed. Use it as a logging sidecar to a real gateway rather than as your only gateway.

**Cloudflare AI Gateway** — edge-deployed, observability + caching + retries, no models of its own. Good if you're already on Cloudflare.

**Bedrock / Vertex / Azure AI Foundry** — cloud-bundled gateways. Bedrock's **Converse API** is a unified, model-agnostic interface across Anthropic, Llama, Mistral, Cohere, AI21, Titan, with IAM auth and consistent shape. Vertex is Gemini-first plus Model Garden. Use these when the cloud is the principal constraint (data residency, IAM, VPC). Note that cross-vendor parity is uneven: Bedrock has Claude *and* Gemini-via-Vertex isn't a thing; teams that need everything still need a non-cloud gateway in front.

### 4c. Typed application layers (Layer 3)

**Vercel AI SDK** (TypeScript). The reference design in 2026. v5 introduced `LanguageModelV2`, defined by ordered content parts (text, image, reasoning, source, tool_call), with the same shape extended in v5 to speech. Provider packages implement the interface; switching providers is one line. Core entry points are `generateText`, `streamText`, `generateObject`, `streamObject`, and the `Agent` class. Even Python teams should know the shape, because everyone else copies it.

**Pydantic AI** (Python). Agent framework where `Model` is an abstract base class and adapters live behind it. Type-safe via Pydantic. FastAPI-style dependency injection. Supports OpenAI, Anthropic, Gemini, DeepSeek, Grok, Cohere, Mistral, Perplexity, Azure, Bedrock, Vertex, Ollama, **LiteLLM** itself (it can sit on top of LiteLLM), Groq, OpenRouter, Together, Fireworks. The combination "Pydantic AI in the app, LiteLLM Proxy as the gateway" is a strong default for new Python services.

**Mirascope** (Python). Direct competitor to Pydantic AI / Instructor. Bills itself as the "LLM anti-framework." Unified interface, Pydantic-backed structured outputs, similar provider list. Pick it if you find Pydantic AI's agent framing too heavy.

**Instructor** (Python, TS, Go, Ruby). Wraps any of 15+ provider SDKs to add Pydantic-validated structured outputs with retries. ~3M monthly downloads. Doesn't try to abstract the whole chat surface — just the structured-output piece. Easier to keep correct as providers evolve. Use when "extract typed data from an LLM call" is most of what you do.

**BAML** (multi-language). Domain-specific language for type-safe LLM functions. Generates TS/Python/Ruby/Java/C#/Rust/Go bindings. Provider-agnostic, switch at runtime. Distinctive feature: **schema-aligned parsing** that tolerates markdown-wrapped JSON, CoT-before-answer, mixed-format outputs — which most strict parsers refuse. Pick BAML if you're shipping LLM functions in multiple languages from one definition.

**DSPy** (Python). Different shape: doesn't abstract the call, it abstracts the *prompt*. You declare a signature `question -> answer` and DSPy compiles it to whichever provider's prompt format. The MIPROv2 optimizer can search prompts and few-shots against a metric. Model swaps survive because the prompt is regenerated for the new model. Pick DSPy when you have a measurable metric and want compilation, not authoring.

### 4d. What to think twice about

**LangChain (the chain abstractions, LCEL, runnables).** A long tail of complaints in 2026 from teams that wish they hadn't started there. Provider SDKs ship enough natively now — function calling, structured outputs, prompt caching, streaming tool calls, agent helpers — that the abstraction tax LangChain charges no longer buys much. The community has been moving toward thinner libraries and explicit code. **LangGraph** (the graph framework, separate package) still has a defensible niche for stateful multi-step agents; its API stability is better than LCEL's.

**LlamaIndex.** Better than LangChain when the work is RAG-shaped, but the model-abstraction story is similar and similarly leaky. Use the data-loading and index parts; don't depend on it as your LLM port.

**CrewAI / AutoGen / Smolagents.** Layer-4 multi-agent frameworks. Each defines its own model abstraction underneath. None are good places to *also* serve as your provider-portability layer for non-agent work.

---

## 5. Design rules that matter more than the library

### Rule 1: Define the port in your domain's words

A bad LLM port:

```python
class LlmPort:
    def chat(self, messages: list[Message]) -> str: ...
```

This leaks the provider semantics — message shape, role enums, tool-call structure — back into the application. Every caller knows that the LLM speaks in messages. Swapping the LLM means changing every call site.

A good LLM port:

```python
class CustomerSupportSummarizer:
    def summarize_ticket(self, ticket: Ticket) -> TicketSummary: ...

class InvoiceExtractor:
    def extract(self, pdf: bytes) -> Invoice: ...
```

The caller has no idea an LLM is involved. The adapter implementation owns the messages, the schema, the retries, the model choice. Three benefits:

- Application code is testable without an LLM (fakes implement the same interface).
- Swapping providers — or swapping LLMs for a fine-tuned classifier — happens behind the port.
- The same port works with any layer-3 library underneath.

This is the **hexagonal / ports & adapters** pattern applied to LLMs, and it's the single highest-leverage decision in this design. The 2026 blog literature on this is thick and consistent: define ports in domain language, not as a generic `chat()`.

### Rule 2: Model identity is runtime config

Treat the model the way you treat a database connection string. It belongs in config — env var, YAML, TOML, secrets store — not in `import` statements. Every adapter takes a `model_id` (e.g. `anthropic/claude-sonnet-4.7`, `openai/gpt-5`, `ollama/qwen3-coder`) and looks up the rest from a **model registry**.

A serviceable registry entry:

```yaml
- id: anthropic/claude-sonnet-4.7
  base_url: https://api.anthropic.com/v1
  protocol: anthropic-messages          # or openai-chat, openai-responses
  context_tokens: 200000
  max_output_tokens: 64000
  supports_tools: true
  supports_parallel_tools: true
  supports_thinking: true
  supports_cache_control: true
  supports_vision: true
  supports_structured_output: tool-call  # or strict-schema, json-mode, none
  cost_per_input_token: 0.000003
  cost_per_output_token: 0.000015
  cost_per_cached_input_token: 0.0000003
```

Most teams don't write this themselves anymore — LiteLLM ships a model-info table that covers ~all of it, and Pydantic AI / Vercel AI SDK / Mirascope expose similar metadata on their model wrappers. But the application must be able to *read* these flags. The adapter can then refuse, degrade, or pick a different call shape based on capabilities. Models without `supports_cache_control` get no `cache_control` markers; the request still goes out.

### Rule 3: Prompts are data, not code

The reason production LLM systems regress is rarely the model — it's a prompt edit that looked fine in dev. Treat prompts the way you treat database migrations:

- Live in a registry (file system, S3, a dedicated service like LangFuse, Helicone Prompts, Portkey Prompts, Mirascope's prompt registry, or your own table).
- Immutable versioning: a prompt is created once, never edited; changes create a new version.
- Trace IDs in logs reference the prompt version that produced the output, so an incident can be tied to a specific text.
- Hot-fix without redeploy: rolling a prompt version forward should be a config change.

This rule sits orthogonal to the provider abstraction but is what makes the abstraction useful in practice. With prompts in a registry, you can A/B test a new model against the same prompt or a new prompt against the same model — independently.

---

## 6. Concrete reference architectures

### Solo developer, one app

```
[app code]
   │
   └─► OpenAI SDK (model in env var)
          └─► api.openai.com  (or another OpenAI-compatible base_url)
```

Don't over-engineer. Put the model name and `base_url` in env. Avoid `import openai` in business code — wrap it in a small `summarize()`-shaped function so the next person can change providers without a chase. That's the whole abstraction you need until you ship a second app.

### Team, 2–5 apps, one stack

```
[app code]
   │
   └─► Pydantic AI Agent (Python)  OR  Vercel AI SDK (TS)
           │   (model_id, registered with capability flags)
           │
           └─► LiteLLM Proxy  (or OpenRouter for zero-ops)
                   ├─► OpenAI
                   ├─► Anthropic
                   ├─► Vertex (Gemini)
                   ├─► Together / Fireworks / Groq
                   └─► Ollama / vLLM (self-hosted)
```

The Proxy enforces budgets and logs everything; apps speak Chat Completions to it; the typed library gives ergonomics. Adding a new model is a YAML edit in the proxy plus a registry entry the apps read.

### Org-scale, many apps, regulated

```
[domain-shaped ports in each service]
              │
              ▼
[adapter using thin OpenAI client]
              │
              ▼
[Portkey or LiteLLM-with-guardrails Proxy]
   ├─ PII redaction
   ├─ Audit log
   ├─ Rate / budget per tenant
   ├─ Fallback chain (Sonnet → Haiku → GPT-4o → local)
   └─ Prompt registry lookup by ID
              │
              ▼
[provider catalog with capability flags]
```

The application code calls `summarize_ticket(ticket)` and never sees a message. The adapter resolves a model ID and a prompt ID, sends a Chat Completions request to the gateway, validates the response against the schema, and returns a typed object. Every request carries a trace ID, a prompt version, and a model ID into the logs.

### Heavy structured-output workload

```
[app code]
   │
   └─► Instructor or BAML (provider-agnostic, schema-aware)
          └─► Gateway → provider
```

When the dominant operation is "give me a typed object", the structured-output libraries outlast model swaps better than chat libraries do, because the contract is the Pydantic / BAML schema, not the prompt or the model.

### "Compile the prompt instead of authoring it"

```
[app code]
   │
   └─► DSPy module with Signature
          │  (compiled prompt for whichever model is configured)
          │
          └─► Gateway → provider
```

When you have a metric you can score against, DSPy's signatures + optimizer let you recompile when the model changes, instead of hand-tuning prompts. Higher barrier (you need an eval set), highest payoff over a multi-year horizon.

---

## 7. The seven anti-patterns

Numbered for citation:

1. **Generic `chat()` port.** Defined above. Leaks model semantics into the application. Replace with domain-shaped ports.
2. **Hard-coded model name.** `client.create(model="gpt-5", ...)` scattered across a codebase. Replace with a single `MODEL_ID` env var or a config lookup.
3. **Silent fallback chains.** A retry to a cheaper model returns 200 OK with worse output, indistinguishable from a slow day. Always emit an explicit metric/log when fallback fires; consider returning a flag in the response so callers can degrade UX accordingly.
4. **Hiding provider-specific cost wins.** Abstracting away `cache_control` on Anthropic costs real money on long-context workloads. Either expose the knob through the adapter or accept the cost. Don't pretend the choice is free.
5. **Prompts in source.** A prompt change requires a deploy and a Git diff to roll back. Move prompts to a registry with versions.
6. **One library doing both layers.** LangChain trying to be both the gateway and the typed library, with custom callbacks and chains, is the canonical example. Keep the seam clean: gateway is a network process, typed library is in-process, neither pretends to do the other's job.
7. **No capability flags.** "Add tool calls" is a six-day project if you have to test every model by hand. A capabilities table on each registered model lets the adapter route around the unsupported cases automatically.

---

## 8. Decision flowchart

```
Do you have just one app and one model?
├─ Yes → Provider SDK + env var. Wrap in 3 domain functions. Stop.
└─ No
   │
   Do you need to swap providers in code, today?
   ├─ Yes, very lightweight → aisuite (Python) or Vercel AI SDK (TS)
   ├─ Yes, with retries/fallbacks → LiteLLM library
   └─ No, but I will tomorrow → start with a small domain-port wrapper
   │
   Do you have more than one app, or more than one developer?
   ├─ Yes → Add a gateway.
   │        Self-host LiteLLM Proxy.
   │        Or OpenRouter (managed, small team).
   │        Or Portkey (compliance-heavy).
   │        Or Bedrock / Vertex (if locked to a cloud).
   └─ No → Skip the gateway for now.
   │
   Is structured output most of what you do?
   ├─ Yes → Instructor (single language) or BAML (multi-language).
   └─ No
       │
       Are you optimizing prompts against a measurable metric?
       ├─ Yes → DSPy.
       └─ No → Pydantic AI or Vercel AI SDK on top of the gateway.
```

---

## 9. What this won't solve

A list of things people hope an abstraction will solve and that no abstraction will:

- **Behavioral drift between models.** Two models behind the same port produce different outputs. The schema is the same; the answer isn't. You need evals, not abstractions, to catch this.
- **Token-counting fidelity.** Every provider tokenizes differently; counting "tokens used" before you call is approximate. Trust the response's `usage` field; don't budget against your local count.
- **Latency parity.** A swap from Sonnet to Haiku looks like a free 3x speedup until you find the task needed Sonnet's depth and now your retries cost more than you saved.
- **Prompt portability.** A prompt tuned for Claude often regresses on GPT, and vice versa. The abstraction routes the request; it does not rewrite the prompt. DSPy is the only mainstream library that even tries.
- **Capability differences in built-in tools.** OpenAI's web search and Anthropic's web search and Gemini's grounding are not the same product. An abstraction can route to one of them; it cannot make them behave the same.

Plan for those separately. The provider abstraction is necessary, not sufficient.

---

## 10. Recommendations

**The single sharpest recommendation.** If you build new applications in Python today and expect them to outlive a model migration, the path of least regret is:

1. Define the in-app port in domain words (Rule 1).
2. Implement the adapter using **Pydantic AI** (typed, agent-shaped, has a clean Model abstraction).
3. Point Pydantic AI at **LiteLLM Proxy** as the gateway (self-hosted) — or OpenRouter if you don't want ops.
4. Keep prompts in a registry — at minimum a folder of versioned `.md` files committed to your repo; ideally a service (LangFuse, Helicone, Portkey, your own).
5. Maintain a model-registry YAML with capability flags. Read it at startup. Pass capabilities into the adapter.
6. Wire structured outputs through **Instructor** (or use Pydantic AI's typed result, which handles this internally).

For TypeScript, replace step 2 with **Vercel AI SDK** and the rest carries over.

For a regulated context, replace step 3 with **Portkey** or a cloud-bundled gateway (Bedrock Converse, Vertex), and confirm that your prompt registry is itself audit-logged.

For a workload that's mostly structured extraction, push **BAML** or **Instructor** all the way down: those become your layer 3, and the abstraction is the schema.

For prompt-optimization-driven workloads with a real eval set, layer 3 becomes **DSPy** and you accept the higher floor in exchange for compilation.

The wrong recommendation in 2026 is "use LangChain because it abstracts providers." Provider SDKs ship enough native capability now — and lighter libraries exist for the rest — that the LangChain abstraction tax is no longer a good trade. The right LCEL/Chains migration is to peel them off, define your own domain ports, and run a thinner stack.

---

## 11. References

**Layer-1 libraries**

- [LiteLLM](https://github.com/BerriAI/litellm) — 140+ providers, 2,500+ models, library + proxy
- [LiteLLM Proxy docs](https://docs.litellm.ai/docs/simple_proxy) — gateway features (virtual keys, budgets, fallbacks, guardrails)
- [aisuite](https://github.com/andrewyng/aisuite) — Andrew Ng's minimalist unified interface
- [OpenAI Python SDK with `base_url`](https://github.com/openai/openai-python) — point at any OpenAI-compatible endpoint

**OpenAI-compatible inference engines**

- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- [vLLM OpenAI-compatible server](https://docs.vllm.ai/en/v0.8.3/serving/openai_compatible_server.html)
- [llama.cpp HTTP server](https://github.com/ggml-org/llama.cpp) — `/v1/chat/completions` endpoint

**Gateways**

- [OpenRouter](https://openrouter.ai/) — managed, 300+ models, 60+ providers (paid fee)
- [Portkey](https://portkey.ai/) — guardrails, PII redaction, jailbreak detection, audit logs
- [Helicone](https://www.helicone.ai/) — observability-first proxy (OSS)
- [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) — edge gateway
- [AWS Bedrock Converse API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html) — cloud-bundled unified shape
- [LLM gateway comparisons 2026](https://www.braintrust.dev/articles/best-llm-gateways-2026)
- [Best LLM Gateway Tools, ranked 2026](https://techsy.io/en/blog/best-llm-gateway-tools)

**Typed application libraries**

- [Vercel AI SDK](https://ai-sdk.dev/docs/introduction) — TypeScript, `LanguageModelV2` content-parts interface
- [Vercel AI SDK 5 release notes](https://vercel.com/blog/ai-sdk-5)
- [Pydantic AI](https://ai.pydantic.dev/) — Python, agent-shaped, type-safe, "FastAPI feeling for GenAI"
- [Pydantic AI model architecture & provider system](https://deepwiki.com/pydantic/pydantic-ai/4.1-model-architecture-and-provider-system)
- [Mirascope](https://mirascope.com/) — Python "LLM anti-framework"
- [Instructor](https://python.useinstructor.com/) — structured outputs across 15+ providers
- [BAML](https://boundaryml.com/) — DSL for type-safe LLM functions; schema-aligned parsing
- [DSPy](https://dspy.ai/) — signatures, modules, optimizers; compile prompts instead of authoring them

**Wire-format references**

- [OpenAI Responses API migration guide](https://platform.openai.com/docs/guides/migrate-to-responses)
- [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) — separate `system`, content blocks, `cache_control`
- [LLM API differences: Anthropic vs OpenAI vs Google](https://futuresearch.ai/blog/llm-provider-quirks/)
- [Prompt caching: OpenAI vs Anthropic vs Google](https://www.prompthub.us/blog/prompt-caching-with-openai-anthropic-and-google-models)
- [OpenAI Responses vs Chat Completions vs Anthropic Messages — Portkey](https://portkey.ai/blog/open-ai-responses-api-vs-chat-completions-vs-anthropic-anthropic-messages-api/)

**Design patterns**

- [Hexagonal architecture for GenAI chatbots](https://shivaramp.medium.com/hexagonal-architecture-for-genai-chatbots-decoupling-ai-logic-from-the-rest-fef1a162330c)
- [Hexagonal microservice with an LLM service](https://knitish91.medium.com/hexagonal-microservice-architecture-with-an-llm-service-for-credit-engine-cc8e6d21493e)
- [Hexagonal agents](https://anoliphantneverforgets.com/notes/2026-03-18-hexagonal-agents)
- [Mastering prompt versioning](https://dev.to/kuldeep_paul/mastering-prompt-versioning-best-practices-for-scalable-llm-development-2mgm)
- [LLMOps architecture 2026](https://calmops.com/architecture/llmops-architecture-managing-llm-production-2026/)

**Production failure modes**

- [Silent degradation in LLM systems](https://dev.to/delafosse_olivier_f47ff53/silent-degradation-in-llm-systems-detecting-when-your-ai-quietly-gets-worse-4gdm)
- [LLM error handling and fallback strategies 2026](https://www.buildmvpfast.com/blog/building-with-unreliable-ai-error-handling-fallback-strategies-2026)
- [LLM failover systems for high availability](https://www.pcstacks.com/6-llm-failover-systems-for-ensuring-high-availability-in-production/)

**LangChain criticism (2026)**

- [LangChain Is Quietly Losing Developers](https://www.roborhythms.com/langchain-losing-developers-2026/)
- [LangChain alternatives 2026](https://syncbricks.com/why-developers-are-leaving-langchain/)
- [33 LangChain alternatives that won't leak your data](https://blog.premai.io/33-langchain-alternatives-that-wont-leak-your-data-2026-guide/)

**Adjacent prior threads in this repo**

- [`../cli-agent-harness-survey/`](../cli-agent-harness-survey/README.md) — Continue's `models:` role-based config, Aider's architect+editor pattern, internal gateways inside CLI agents
- [`../cli-tools-for-ai-agents/`](../cli-tools-for-ai-agents/README.md) — CLI-vs-MCP tradeoff, complementary to the LLM-port question
- [`../standalone-memory-tools-survey-2026/`](../standalone-memory-tools-survey-2026/README.md) — Vercel AI SDK as a TS abstraction over providers with memory adapter ecosystem
- [`../claude-managed-agents/`](../claude-managed-agents/README.md) — when to outsource the LLM runtime entirely instead of abstracting over it
- [`../enterprise-data-agents/`](../enterprise-data-agents/README.md) — gateway+adapter pattern in the data-agent context

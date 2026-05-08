# OpenAI Realtime API — May 2026 release

Final report for the 2026-05-07 OpenAI announcement *"Advancing voice intelligence with new models in the API"* and the developer-docs Realtime guide. Focus: what changed, what's new, and what migrating from any pre-1.5 codebase actually requires.

This thread builds on, but does not duplicate, `realtime-api-low-latency-voice/` (April 2026), which still describes the architectural baseline (WebRTC browser client, server-sideband control, VAD modes, mouth-to-ear latency budget, prompt structure). Those recommendations did not change with this release.

> **Sourcing note.** OpenAI's `openai.com`, `developers.openai.com`, and `platform.openai.com` returned HTTP 403 to direct fetches in the research environment. Findings were assembled from web-search excerpts of those primary pages, the Microsoft Azure preview-to-GA migration guide (which mirrors the OpenAI changes), the field-tested `N1-AI/openai-realtime-webrtc-migration-guide` GitHub repo, and developer-blog/news coverage cross-checked against each other. Sources listed at the end.

---

## TL;DR

OpenAI shipped three new models on the existing Realtime API on **2026-05-07**:

| Model | Role | Pricing | Replaces / supersedes |
| --- | --- | --- | --- |
| `gpt-realtime-2` | Flagship S2S voice with GPT-5-class reasoning, 128K context, 5-level reasoning effort knob | $32 / 1M audio in, $0.40 cached in, $64 / 1M audio out | `gpt-realtime`, `gpt-realtime-1.5` |
| `gpt-realtime-translate` | Live S2S translation, 70+ in → 13 out languages | $0.034 / minute | Custom S2S translation prompts |
| `gpt-realtime-whisper` | Streaming speech-to-text with tunable latency/quality | $0.017 / minute | Batched Whisper, ad-hoc S2S transcription |

The **API surface is unchanged** by this release: you keep the GA Realtime session you already have. You just change a model ID and, for `gpt-realtime-2`, optionally set `reasoning.effort`.

If you are on the **beta API surface** or on the deprecated `gpt-4o-realtime-preview` model, you must do a separate, larger migration (header removed, endpoint moved to `/v1/realtime/calls`, audio config nested under `audio.*`, modalities renamed `output_modalities`, several event names prefixed with `output_`, session `type` field now required). That work is the actual cost; the new models drop in cleanly afterward.

---

## What's new in the May 2026 release

### `gpt-realtime-2` — flagship voice model

- **GPT-5-class reasoning** in a speech-to-speech model. Designed to "think before it speaks" while preserving low-latency conversational pacing.
- **128K context window** — large enough to hold an entire customer-history transcript during a long call.
- **`reasoning.effort` knob** with five levels: `minimal`, `low`, `medium`, `high`, `xhigh`. Default is `low`. `low` is the recommended starting point for production voice agents — increase only for multi-step tool decisions, troubleshooting flows, or escalations where failure cost is high.
- **Preambles**: the model can emit short verbal acknowledgements ("let me check that…") before slow tool calls so the user doesn't hear dead air.
- **Parallel tool calls** and **interruption recovery** are first-class.
- **Voices**: Cedar and Marin remain the recommended high-fidelity voices (carried from the August 2025 `gpt-realtime` GA release). Custom Voices are available to approved customers.
- **Languages**: 70+ input languages.
- **Benchmarks** (from the announcement and reporting):
  - Big Bench Audio (high mode): **96.6%** vs **81.4%** for `gpt-realtime-1.5` (+15.2 pts).
  - Scale AI Audio MultiChallenge S2S leaderboard: top spot. Instruction retention 36.7% → 70.8% APR vs 1.5.
  - Artificial Analysis Conversational Dynamics: 96.1%.
  - Artificial Analysis time-to-first-audio: avg **2.33 s at high reasoning effort**. (Lower at lower effort levels.)
- **Pricing**: $32 / 1M audio input tokens, $0.40 / 1M cached audio input tokens, $64 / 1M audio output tokens. *Identical to `gpt-realtime` and `gpt-realtime-1.5`* — the smarter model ships at the same per-token rate.

### `gpt-realtime-translate` — live S2S translation

- Accepts spoken input, **auto-detects source language**, returns translated speech plus text transcripts.
- **70+ input languages → 13 output languages**: Spanish, Portuguese, French, Japanese, Russian, Chinese, German, Korean, Hindi, Indonesian, Vietnamese, Italian, English.
- Trained on thousands of hours of professional interpreter audio. The model is **translation-only** — it ignores requests to do anything else and waits for enough context before producing speech, much like a human interpreter.
- Streams translated audio while still consuming input audio (low end-to-end latency over continuous speech).
- Developer specifies only the target output language.
- Designed for two patterns: **broadcast** (livestreams, lectures, earnings calls, conferences) and **conversational** (call centers, video chat, phone).
- **Pricing**: **$0.034 / minute** flat, regardless of who's talking.

### `gpt-realtime-whisper` — streaming STT

- Streaming speech-to-text with controllable latency/accuracy tradeoff. Lower delay produces earlier partial deltas; higher delay gives the model more context and better word-error rate. 0.4 s is cited as the most latency-sensitive useful operating point.
- Configured through the same Realtime session shape as the S2S models, just with a transcription session type. Key fields:
  - `audio.input.transcription.model = "gpt-realtime-whisper"`
  - `audio.input.transcription.language = "en"` (optional hint)
  - `audio.input.turn_detection = null` (set to `null` to commit audio manually)
- **Pricing**: **$0.017 / minute** flat — roughly half the price of `gpt-realtime-translate` and a small fraction of S2S audio token rates for transcription-shaped workloads.

### Implicit: GA surface confirmed for these models

All three are exposed via the **GA Realtime API** path (`POST /v1/realtime/calls`, ephemeral keys via `POST /v1/realtime/client_secrets`), not the beta surface. There is no path to call them via the old `OpenAI-Beta: realtime=v1` interface. This is the practical forcing function for any remaining beta-surface integrations.

---

## How the Realtime API surface looks today (reference)

Carryovers, all still current:

- **Transports**: WebRTC (recommended for browser/mobile), WebSocket (server-to-server), SIP (PSTN, PBX, desk phones), and the GA-only video support reported by webrtcHacks.
- **Auth patterns**: server mints an ephemeral client secret and the browser POSTs its SDP to `/v1/realtime/calls`; or the app server proxies the whole call.
- **Modalities**: text, audio, images. Video supported in GA (single-sourced; verify before depending on it).
- **Tool use**: function calling with parallel tool calls; remote MCP servers attachable via session config (carried from August 2025).
- **VAD**: `server_vad` (silence-based, tunable threshold/prefix/silence durations) or `semantic_vad` (chunks on perceived utterance completion, with `eagerness` setting). `null` to commit manually.
- **Cost accounting**: audio is tokenized by time — 1 token per 100 ms of user audio, 1 token per 50 ms of assistant audio (carried from the original gpt-realtime cost guide). Per-minute pricing on `gpt-realtime-translate` and `gpt-realtime-whisper` makes that math irrelevant for those two models.

---

## Model timeline

| Date | Model / event | Significance |
| --- | --- | --- |
| Oct 2024 | `gpt-4o-realtime-preview` ships | First S2S Realtime model. Beta API surface only. |
| Aug 28, 2025 | `gpt-realtime` (1.0, GA) | GA model. SIP, image input, MCP, voices Cedar/Marin. 20% price cut vs preview ($32/$64). |
| Sep 2025 | `gpt-4o-realtime-preview` deprecation announced | 6-month sunset. |
| Feb 23, 2026 | `gpt-realtime-1.5` | Drop-in upgrade. +5% Big Bench Audio, +10.23% alphanumeric transcription, +7% instruction following, better interruption handling. Same pricing. |
| Feb 27, 2026 | Beta Realtime API surface deprecated | GA-only after this. (Date from the N1-AI migration guide README.) |
| Apr 30, 2026 | Azure preview Realtime API deprecated | Mirrors the OpenAI cutover for Foundry users. |
| **May 7, 2026** | **`gpt-realtime-2`, `gpt-realtime-translate`, `gpt-realtime-whisper`** | **This release.** |

---

## Migrating from pre-1.5

There are two distinct "pre-1.5" cases. They require different amounts of work.

### Case A: you're on `gpt-4o-realtime-preview` (the deprecated preview model on the beta surface)

You must do **both** migrations together — model and API surface. Doing only one will not produce a working app.

1. Remove `OpenAI-Beta: realtime=v1` from every request.
2. Change WebRTC connection from `POST /v1/realtime?model=...` (raw SDP, `Content-Type: application/sdp`) to `POST /v1/realtime/calls` (multipart `FormData` with `sdp` and `session` fields). The GA call establishes the WebRTC session and the LLM session in one shot.
3. Mint ephemeral client secrets via `POST /v1/realtime/client_secrets` for browser clients.
4. Add a session **`type`** to `session.update`. For voice agents this is `"realtime"`; for STT-only sessions it's `"transcription"`. The same client event now serves both, so the field is mandatory.
5. Rename `modalities` → `output_modalities`. Now governs output only; e.g. `"output_modalities": ["audio"]` or `["audio","text"]`.
6. Re-nest audio config under `audio.*` (this is the single biggest source of "type error" surprises during migration):
   - `voice` → `audio.output.voice`
   - `output_audio_format` → `audio.output.format` (now an **object**, not a string)
   - `input_audio_format` → `audio.input.format` (object)
   - `input_audio_transcription` → `audio.input.transcription`
   - `input_audio_noise_reduction` → `audio.input.noise_reduction`
   - `turn_detection` → `audio.input.turn_detection`
7. Rename inbound events you handle:
   - `response.text.delta` → `response.output_text.delta`
   - `response.text.done` → `response.output_text.done`
   - `response.audio.delta` → `response.output_audio.delta`
   - `response.audio.done` → `response.output_audio.done`
   - `response.audio_transcript.delta` → `response.output_audio_transcript.delta`
   - `response.audio_transcript.done` → `response.output_audio_transcript.done`
8. If you rely on conversation-item events, you can now also subscribe to `conversation.item.added` and `conversation.item.done` (in addition to `conversation.item.created`). Useful for long-running operations like MCP tool listing. All conversation-item events now carry `object: "realtime.item"`.
9. Switch model ID to `gpt-realtime-2` (or `gpt-realtime-1.5` if you want the most conservative move). The preview model ID is gone.
10. Optional: set `reasoning.effort` on `gpt-realtime-2`. Start with `"low"` and only raise it for flows where failure cost is higher than latency cost.

Pricing reality check: the preview model was already gone, so this migration is forced. The good news is the new audio token rate ($32/$64) is 20% lower than the preview rate, and `gpt-realtime-2` ships at that same rate.

### Case B: you're on `gpt-realtime` or `gpt-realtime-1.5` on the beta surface

Same migration as Case A steps 1–8. Skip steps 9–10 if your model ID is already in the `gpt-realtime*` family — though you'll want to bump to `gpt-realtime-2` for the reasoning upgrade once you're on the GA surface.

### Case C: you're already on `gpt-realtime-1.5` on the GA surface

Genuinely a drop-in:

1. Change model ID to `gpt-realtime-2`.
2. Optionally add `reasoning.effort: "low"` to `session.update`.
3. Test interruption flows and tool-call timing — `gpt-realtime-2` reasons longer at higher effort levels and emits preambles, so your barge-in / "is the agent stuck?" UX heuristics may need retuning.
4. For transcription-shaped workloads on side legs (e.g. recording one party of a call), consider re-pointing to `gpt-realtime-whisper` to drop those legs from S2S audio token rates to $0.017/min.
5. For translation-shaped workloads, consider `gpt-realtime-translate` instead of prompting `gpt-realtime-2` to translate. You give up tool use and free-form behavior, but pricing drops to $0.034/min and quality benefits from interpreter-data training.

---

## Decision guide for the new models

**Default to `gpt-realtime-2` for any conversational voice agent.** Same price as `gpt-realtime-1.5`, materially smarter, and the reasoning knob lets you stay at low latency when reasoning isn't needed.

**Use `gpt-realtime-translate` only when the entire job is translation.** It is intentionally translation-only — it will not act on user requests, and that's a feature for interpreter-style products. Don't try to make it a general-purpose multilingual agent.

**Use `gpt-realtime-whisper` for transcription-only legs** (call recording, captions, dictation) where you do not need the model to speak back. The cost gap vs running an S2S model in transcription mode is significant.

**Mix freely on the same Realtime session shape.** All three use the same `session.update` event with the session `type` distinguishing `"realtime"` (S2S) from `"transcription"` (STT-only). You can run separate sessions of different types for the same call.

---

## Pitfalls observed in 2026 migration debugging

- Sending `OpenAI-Beta: realtime=v1` to a GA endpoint silently routes your session to the legacy interpretation in some SDK paths, manifesting as "wrong" event names being delivered. Strip the header entirely.
- Sending an audio format string (`"pcm16"`) where GA expects a format object yields `Invalid type for 'session.audio.input.format': expected an object, but got a string instead`. Wrap in `{ "type": "audio/pcm", "rate": 24000 }`-style objects.
- Setting `voice` at the session root in GA is silently dropped on some SDK paths and the session falls back to a default voice. Always set `audio.output.voice`.
- Forgetting the session `type` field in GA produces confusing 400s with no obvious schema hint. The error usually points at modalities; the actual problem is the missing top-level `session.type`.
- `gpt-realtime-2` at `xhigh` reasoning effort can produce 2+ second time-to-first-audio. If your UX assumed sub-second TTFA from `gpt-realtime-1.5`, your "agent is hung" indicator may now fire on a normal slow turn. Use preambles and tune effort downward.

---

## What did NOT change

Useful to call out so migrations don't get over-scoped:

- WebRTC vs WebSocket guidance: WebRTC for browser/mobile, WebSocket for server-to-server, SIP for telephony. Unchanged.
- Server-sideband architecture for private business logic, tools, guardrails, and session monitoring. Unchanged.
- Audio token accounting (1 token / 100 ms input, 1 token / 50 ms output) for S2S models. Unchanged.
- Cedar and Marin as recommended voices. Unchanged.
- Prompt structure recommendations from the OpenAI Cookbook Realtime Prompting Guide (skeleton sections for role/objective, tone, pronunciations, tools, rules, conversation flow, sample phrases). Unchanged.
- The fundamental session-conversation-response state model. Unchanged.

These are documented in `realtime-api-low-latency-voice/README.md`; refer there rather than duplicating.

---

## Open questions

- Whether `gpt-realtime-2` ships with a snapshot ID (e.g. `gpt-realtime-2-2026-05-07`) for pinning. Not confirmed in fetched sources.
- Full list of standard voices for `gpt-realtime-2` beyond Cedar and Marin. Not confirmed.
- Whether the GA surface accepts continuous video frames or only still images. webrtcHacks claims "video support" landed at GA but the claim is single-sourced.
- Custom Voices specifics (training data length, latency impact, regional availability). Gated behind approved-customer access.

If any of these matter for your migration, treat them as open and confirm against the live OpenAI docs before depending on them.

---

## Sources

Primary release announcement and OpenAI docs (fetched indirectly via web search; direct fetches returned 403):

- [Advancing voice intelligence with new models in the API — OpenAI](https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/)
- [Realtime and audio — OpenAI API guide](https://developers.openai.com/api/docs/guides/realtime)
- [gpt-realtime-1.5 model page — OpenAI API](https://developers.openai.com/api/docs/models/gpt-realtime-1.5)
- [gpt-realtime-whisper model page — OpenAI API](https://developers.openai.com/api/docs/models/gpt-realtime-whisper)
- [Realtime transcription guide — OpenAI API](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [Build Live Translation Apps with gpt-realtime-translate — OpenAI Cookbook](https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide)
- [Developer notes on the Realtime API — OpenAI Developers](https://developers.openai.com/blog/realtime-api)
- [Introducing gpt-realtime and Realtime API updates for production voice agents — OpenAI](https://openai.com/index/introducing-gpt-realtime/)
- [OpenAI API changelog](https://developers.openai.com/api/docs/changelog)

Migration references:

- [N1-AI/openai-realtime-webrtc-migration-guide — field-tested beta→GA migration notes](https://github.com/N1-AI/openai-realtime-webrtc-migration-guide)
- [Migration from Preview to GA version of Realtime API — Microsoft Foundry](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-preview-api-migration-guide)
- [Realtime API Beta → GA: type error with session.audio.input.format — OpenAI Developer Community](https://community.openai.com/t/realtime-api-beta-realtime-api-ga-receiving-type-error-with-session-audio-input-format/1355366)
- [How to use GA version of Realtime API with output modalities — OpenAI Developer Community](https://community.openai.com/t/how-to-use-ga-version-of-realtime-api-with-output-modalities-with-audio-and-text/1359916)
- [How OpenAI does WebRTC in the new gpt-realtime — webrtcHacks](https://webrtchacks.com/how-openai-does-webrtc-in-the-new-gpt-realtime/)

Reporting and analysis (cross-checks):

- [OpenAI launches new voice intelligence features in its API — TechCrunch](https://techcrunch.com/2026/05/07/openai-launches-new-voice-intelligence-features-in-its-api/)
- [OpenAI has new voice models that reason, translate, and transcribe as you speak — 9to5Mac](https://9to5mac.com/2026/05/07/openai-has-new-voice-models-that-reason-translate-and-transcribe-as-you-speak/)
- [GPT-Realtime-2 expands OpenAI's voice intelligence capabilities — Dataconomy](https://dataconomy.com/2026/05/08/gpt-realtime-2-expands-openais-voice-intelligence-capabilities/)
- [GPT-Realtime-2: A Voice Model with GPT-5-Class Reasoning — DataCamp](https://www.datacamp.com/blog/gpt-realtime-2)
- [OpenAI Releases Three Realtime Audio Models — MarkTechPost](https://www.marktechpost.com/2026/05/08/openai-releases-three-realtime-audio-models-gpt-realtime-2-gpt-realtime-translate-and-gpt-realtime-whisper-in-the-realtime-api/)
- [GPT-Realtime-2, -Translate, and -Whisper: new SOTA realtime voice APIs — Latent Space](https://www.latent.space/p/ainews-gpt-realtime-2-translate-and)
- [OpenAI's new voice model brings GPT-5-level reasoning to real-time conversations — The Decoder](https://the-decoder.com/openais-new-voice-model-brings-gpt-5-level-reasoning-to-real-time-conversations/)
- [OpenAI launches 3 new real-time voice AI models for developers — Quartz](https://qz.com/openai-realtime-voice-models-developers-050726)
- [OpenAI unveils trio of realtime audio models — Neowin](https://www.neowin.net/news/openai-unveils-trio-of-realtime-audio-models-to-power-next-gen-voice-agents/)
- [OpenAI releases gpt-realtime-1.5 for voice AI developers — Perplexity](https://www.perplexity.ai/page/openai-releases-gpt-realtime-1-uvxkVAujTJKQFr1N8we4Tg)
- [GPT-Realtime-1.5 Released — Hacker News](https://news.ycombinator.com/item?id=47129942)

Prior internal thread:

- `realtime-api-low-latency-voice/README.md` — architectural guidance (WebRTC, server sideband, VAD, prompting, latency measurement) that did not change with this release.

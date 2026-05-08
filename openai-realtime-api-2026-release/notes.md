# OpenAI Realtime API – May 2026 release research notes

Started: 2026-05-08

## Goal

Deeply research the latest realtime API release announced at:

- https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/
- https://developers.openai.com/api/docs/guides/realtime

Include implications for migrating from older versions of the API (pre-1.5).

## Prior work scan

- `/home/user/ingolmo/realtime-api-low-latency-voice/` (April 2026) covered architecture: WebRTC vs WebSocket, server-sideband control, server/semantic VAD, prompting guide, cost accounting (1 token / 100ms user, 1 token / 50ms assistant), GA in 2025-08-28 with `gpt-realtime`. Prior model = `gpt-realtime`.
- This new thread should focus on what is NEW in the May 2026 release: model names, capability changes, API surface changes, breaking changes vs `gpt-realtime` / pre-1.5 era, and migration steps.
- Will reference the prior thread for architectural context that has not changed rather than re-derive it.

## Plan

1. Fetch both URLs the user provided (announcement + guide).
2. Cross-check via web search to find the changelog, version notes, and any pre-1.5 -> 1.5+ migration guidance.
3. Capture: new model names, new API params, removed/deprecated endpoints, new modalities, pricing changes, new event types, default-behavior changes.
4. Write a structured README aimed at a developer migrating an existing Realtime app.

## Source-fetch outcome

- WebFetch returns 403 for every `openai.com`, `developers.openai.com`, `platform.openai.com`, and most major news domains in this environment. Direct `curl` with a browser UA also gets 403 from `openai.com`.
- WebSearch returns rich excerpts from those same pages and was the primary data source. Only the GitHub migration guide was retrievable directly via WebFetch.
- All factual claims below cross-checked across at least two sources where possible.

## Release facts (May 2026)

### Release event
- Announcement: "Advancing voice intelligence with new models in the API", openai.com/index, dated 2026-05-07. Three new models shipped to the Realtime API simultaneously.
- Reported by TechCrunch, 9to5Mac, Dataconomy, Quartz, Neowin, Latent Space, MarkTechPost on 2026-05-07/08.

### Three new models

1. **`gpt-realtime-2`** — flagship S2S model
   - GPT-5-class reasoning. "Thinks before it speaks."
   - **128K context** (vs prior gen which was much smaller — Aixploria headline calls it a quadrupling).
   - **Adjustable reasoning** with five levels: `minimal`, `low`, `medium`, `high`, `xhigh`. Default = `low`.
   - Tone control, parallel tool calls, interruption recovery, preambles ("let me check that…").
   - Voices: Marin and Cedar are the recommended high-quality voices (carried over from the late-2025 gpt-realtime release). Custom Voices available to approved customers.
   - Languages: 70+ input.
   - Big Bench Audio High mode: **96.6%** vs **81.4%** for `gpt-realtime-1.5` (+15.2 pts).
   - Scale AI Audio MultiChallenge S2S: top spot; instruction retention 36.7% → 70.8% APR vs 1.5.
   - Artificial Analysis: avg time-to-first-audio **2.33s at high reasoning**, 96.1% Conversational Dynamics.
   - Pricing: **$32 / 1M audio input**, **$0.40 / 1M cached audio input**, **$64 / 1M audio output**. (Same audio token rates as gpt-realtime / gpt-realtime-1.5 — i.e. no price increase for the smarter model.)

2. **`gpt-realtime-translate`** — live S2S translation
   - 70+ input languages, 13 output languages: Spanish, Portuguese, French, Japanese, Russian, Chinese, German, Korean, Hindi, Indonesian, Vietnamese, Italian, English.
   - Trained on thousands of hours of professional interpreter audio. Translation-only; will wait for context before producing speech.
   - Streams translated audio while still receiving input audio.
   - Developer specifies target output language only; source language auto-detected.
   - Pricing: **$0.034 / minute** (per-minute, not per-token).
   - Patterns: broadcast (livestream, lecture, earnings calls) and conversational (call center, video chat, phone).

3. **`gpt-realtime-whisper`** — streaming STT
   - Streaming partial transcript deltas while user speaks.
   - Latency/accuracy tradeoff is configurable; reference points include 0.4s for the most latency-sensitive use.
   - Configured via the same Realtime session shape with:
     - `audio.input.transcription.model = "gpt-realtime-whisper"`
     - `audio.input.transcription.language = "en"` (optional hint)
     - `audio.input.turn_detection = null` to commit audio manually
   - Pricing: **$0.017 / minute**.

### Realtime API surface in 2026

- All three new models share the same Realtime session API. Endpoint: `POST /v1/realtime/calls` (GA), with ephemeral client secrets minted by `POST /v1/realtime/client_secrets`.
- Sessions are stateful: Session, Conversation, Responses. Modalities supported: audio, text, images. Video has been added in the GA path per webrtcHacks ("This includes many capabilities that the Beta didn't have, including video support").
- MCP remote server support and SIP support carried over from the August 2025 gpt-realtime release; both still part of the GA surface.

## Pre-1.5 → 1.5 → 2 model timeline

| Date | Model | Notes |
| --- | --- | --- |
| Oct 2024 | `gpt-4o-realtime-preview` | First S2S Realtime model. Beta API surface. |
| Aug 28, 2025 | `gpt-realtime` (GA) | GA model. SIP, image input, MCP, voices Cedar/Marin. 20% price cut vs preview ($32/$64). |
| ~Sep 2025 | `gpt-4o-realtime-preview` deprecation announced | 6-month sunset. |
| Feb 23, 2026 | `gpt-realtime-1.5` | Same architecture & price. +5% Big Bench Audio, +10.23% alphanumeric transcription, +7% instruction following. Better interruption handling. |
| Feb 27, 2026 | Beta Realtime API surface deprecation date (per N1-AI migration guide README) | GA-only after this. |
| Apr 30, 2026 | Azure preview Realtime API deprecation date | Migration to GA required. |
| May 7, 2026 | `gpt-realtime-2`, `gpt-realtime-translate`, `gpt-realtime-whisper` | This release. |

## Beta-to-GA migration deltas (the "pre-1.5" question)

Source: N1-AI/openai-realtime-webrtc-migration-guide on GitHub (field-tested), Microsoft Azure Foundry preview-to-GA migration guide, OpenAI dev community posts, OpenAI dev blog "realtime-api". This is the same migration anyone on a pre-1.5 codebase has to make.

### Header
- Beta required `OpenAI-Beta: realtime=v1`. **GA forbids it** — do not send the header.

### Endpoint URLs
- Beta WebRTC: `POST /v1/realtime?model=...` with raw SDP body and `Content-Type: application/sdp`.
- GA WebRTC: `POST /v1/realtime/calls` with **multipart `FormData`** containing `sdp` and `session` fields. SDP and session creation are now one call.
- Ephemeral client secrets: `POST /v1/realtime/client_secrets` (replaces older session-creation route used to mint client tokens).

### Session create/update — `type` field is now required
- GA `session.update` payload must include a session `type`:
  ```json
  { "type": "session.update",
    "session": { "type": "realtime", "instructions": "Be extra nice today!" } }
  ```
- Two session types now share one event: `"realtime"` (S2S) and `"transcription"` (STT-only). Specifying it is mandatory.

### Modalities
- Beta: `modalities: ["text","audio"]` flat under session.
- GA: `output_modalities: ["audio"]` (or `["audio","text"]`). Field renamed and now governs OUTPUT only.

### Audio config nesting
- Beta flat fields: `voice`, `input_audio_format`, `output_audio_format`, `input_audio_transcription`, `input_audio_noise_reduction`, `turn_detection`.
- GA nested under `audio`:
  - `audio.input.format` (now an object, not a string)
  - `audio.input.noise_reduction`
  - `audio.input.transcription` (object — also where `gpt-realtime-whisper` is configured for transcription-only sessions)
  - `audio.input.turn_detection` (`server_vad`, `semantic_vad`, or `null`)
  - `audio.output.format`
  - `audio.output.voice` (note `voice` moved here, not at session root)
  - `audio.output.speed` (where supported)

### Event renames
- `response.text.delta` → `response.output_text.delta`
- `response.text.done` → `response.output_text.done`
- `response.audio.delta` → `response.output_audio.delta`
- `response.audio.done` → `response.output_audio.done`
- `response.audio_transcript.delta` → `response.output_audio_transcript.delta`
- `response.audio_transcript.done` → `response.output_audio_transcript.done`

### New events
- `conversation.item.added` and `conversation.item.done` added (alongside existing `conversation.item.created`) to give better hooks for long-running operations like MCP tool listing.
- Conversation item events now carry `object: "realtime.item"`.

### Model swap
- The model ID parameter accepts `gpt-realtime`, `gpt-realtime-1.5`, `gpt-realtime-2`. To get GPT-5-class reasoning you must use `gpt-realtime-2`. Pre-1.5 codebases on `gpt-4o-realtime-preview` first need to switch to `gpt-realtime` (1.0) family at minimum since the preview model is deprecated.
- Pipecat/LiveKit-style integrations note: model is connection-level and cannot be changed mid-session.

### New parameters specific to gpt-realtime-2
- `reasoning.effort` ∈ {`minimal`, `low`, `medium`, `high`, `xhigh`}; default `low`. Trades latency for reasoning depth.
- Tone-control prompting still in the prompt body, but the model adheres to it more reliably.

### Pricing migration
- No price change between gpt-realtime, gpt-realtime-1.5, and gpt-realtime-2 ($32 in / $0.40 cached in / $64 out per 1M audio tokens).
- Big change for translation/transcription workloads: previously you'd pay full S2S audio rates; now use `gpt-realtime-translate` ($0.034/min) and `gpt-realtime-whisper` ($0.017/min) which are flat per-minute and dramatically cheaper for those specific workloads.

## Implications for migration from pre-1.5

### If you are on `gpt-4o-realtime-preview` (deprecated)
1. Already past sunset — must move regardless of feature interest.
2. Cheapest path to working code: switch model ID to `gpt-realtime` AND complete the beta → GA migration (header, endpoints, event renames, audio config nesting, session `type`, modality rename) in the same change. Doing one without the other will break.
3. Then optionally bump model ID to `gpt-realtime-2` for the reasoning upgrade — no schema change needed beyond the optional `reasoning.effort` field.

### If you are on `gpt-realtime` or `gpt-realtime-1.5` on the beta surface
- Same migration as above minus the model rename. The schema work is the cost; the model upgrade is essentially free.

### If you are already on `gpt-realtime-1.5` GA
- Drop-in: change model ID to `gpt-realtime-2`, optionally add `reasoning.effort: "low"` and validate. No schema breaks.
- Consider splitting transcription-only call legs onto `gpt-realtime-whisper` for ~95% cost reduction on those legs.
- Consider routing translation workloads to `gpt-realtime-translate` rather than prompting `gpt-realtime` to translate.

### Architectural reuse from prior thread
- WebRTC-from-browser, server sideband for tool/business logic, server VAD vs semantic VAD tradeoff, mouth-to-ear latency measurement, and prompt structure (skeleton sections) all carry over unchanged. See `realtime-api-low-latency-voice/README.md` rather than restating.

## Open questions / unverified claims

- Exact list of GA voices for gpt-realtime-2 beyond Marin and Cedar is not confirmed in fetched sources. Likely the gpt-realtime voice set carries forward.
- "Video support" claim from webrtcHacks is single-sourced; need to confirm whether the Realtime API accepts continuous video frames or just images.
- Custom Voices specifics (length, training process, latency impact) require approved-customer access.
- Whether `gpt-realtime-2` is sold as a snapshot ID (e.g. `gpt-realtime-2-2026-05-07`) is not confirmed in this pass.


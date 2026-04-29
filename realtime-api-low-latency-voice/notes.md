# Realtime API Low-Latency Voice Research Notes

Started: 2026-04-29 14:52:29 PDT

## Prior work scan

- Scanned top-level directories with `find . -maxdepth 2 -type d | sort`.
- No existing research-thread directories were present beyond `.git` and `.github`, so this thread starts fresh.

## Research plan

- Start with official OpenAI Realtime API documentation and related guides.
- Cross-check with reputable external sources on WebRTC, low-latency voice architecture, turn detection, barge-in, audio codecs, observability, and production deployment.
- Produce a final `README.md` that focuses on reusable engineering guidance for building low-latency voice-to-voice applications with the Realtime API.

## OpenAI docs MCP status

- Tried to use the `openai-docs` skill's preferred MCP server, but no OpenAI developer docs MCP tools were available in this session.
- Ran `codex mcp add openaiDeveloperDocs --url https://developers.openai.com/mcp`; sandboxed write failed, then succeeded with user-approved escalation.
- Since newly added MCP tools are not exposed until a future session/restart, using official OpenAI web docs directly for this research pass.

## Official OpenAI source notes

- Official WebRTC guide: OpenAI recommends WebRTC rather than WebSockets for browser/mobile client connections because it gives more consistent performance. Two browser auth/setup patterns exist: unified `/v1/realtime/calls` through the app server, or server-minted ephemeral client secrets for direct client-to-OpenAI WebRTC setup. Source: https://developers.openai.com/api/docs/guides/realtime-webrtc
- Official WebSocket guide: WebSockets are positioned as the server-to-server path. Browser WebSocket is possible with ephemeral tokens, but WebRTC is described as more robust for browser/mobile. Source: https://developers.openai.com/api/docs/guides/realtime-websocket
- Official conversations guide: Realtime sessions are stateful: Session, Conversation, Responses. WebRTC handles much of the media path; WebSocket apps manually append base64 audio buffers. The guide also covers response creation, function calling, and interruption/truncation. Source: https://developers.openai.com/api/docs/guides/realtime-conversations
- VAD guide: two VAD modes matter for voice UX. `server_vad` chunks by silence and can be tuned with threshold, prefix padding, and silence duration. `semantic_vad` chunks based on whether the user's words appear complete, with `eagerness` controlling how quickly to chunk. Source: https://developers.openai.com/api/docs/guides/realtime-vad
- Prompting guide: `gpt-realtime` is the current advanced speech-to-speech model. Prompt guidance emphasizes precise, non-conflicting bullets, examples, handling unclear audio explicitly, and concise response pacing. Source: https://developers.openai.com/api/docs/guides/realtime-models-prompting
- Server controls guide: for direct WebRTC/SIP clients, use a sideband server connection to the same Realtime session so private business logic, tools, guardrails, instruction updates, and monitoring stay server-side. Source: https://developers.openai.com/api/docs/guides/realtime-server-controls
- Cost guide: audio token accounting is time-based in the docs: user audio is 1 token per 100 ms, assistant audio is 1 token per 50 ms. Usage details arrive on `response.done`; caching can reduce repeated input cost. Source: https://developers.openai.com/api/docs/guides/realtime-costs
- OpenAI launch blog: Realtime API was GA as of 2025-08-28 with `gpt-realtime`, SIP support, image input, remote MCP server support, safety/privacy notes, and production voice-agent framing. Source: https://openai.com/index/introducing-gpt-realtime/

## External source notes

- OpenAI Agents SDK docs: the SDK keeps the Realtime API model but wraps raw events with `RealtimeAgent`, `RealtimeSession`, transports, tools, guardrails, handoffs, and history. This is likely the fastest path for a TypeScript browser app unless lower-level control is required. Source: https://openai.github.io/openai-agents-js/guides/voice-agents/
- OpenAI Cookbook Realtime Prompting Guide: Realtime prompting has voice-specific patterns: skeleton sections for role/objective, tone, context, pronunciations, tools, rules, conversation flow, and sample phrases. Complex flows can be represented either as state-machine-like prompt structure or via dynamic `session.update`. Source: https://developers.openai.com/cookbook/examples/realtime_prompting_guide
- LiveKit OpenAI integration docs: LiveKit Agents can bridge frontend WebRTC to OpenAI Realtime over WebSockets, and adds noise cancellation, SIP/telephony, interruption/context truncation, and synced transcriptions. Useful if needing rooms, telephony, mobile SDKs, or managed realtime infrastructure. Source: https://docs.livekit.io/agents/integrations/openai/
- LiveKit OpenAI Realtime plugin docs: exposes `gpt-realtime`, voice selection, temperature, turn detection, semantic VAD, server VAD, optional video input, and text-only mode with separate TTS. Confirms semantic VAD default in that integration and provides practical parameter guidance. Source: https://docs.livekit.io/agents/models/realtime/plugins/openai/
- Twilio latency guide: latency should be measured as user-perceived mouth-to-ear turn gap. For cascaded agents, they show a straightforward implementation around ~1.1s mouth-to-ear and break down STT, LLM TTFT, TTS, network, buffering, and orchestration. Even with S2S Realtime, the measurement discipline applies. Source: https://www.twilio.com/en-us/blog/developers/best-practices/guide-core-latency-ai-voice-agents
- Twilio OpenAI Realtime resources: emphasizes lower latency, tone/pitch analysis, pacing, interruption handling, and turn-taking as Realtime strengths for telephony/conversational AI. Source: https://www.twilio.com/en-us/blog/developers/twilio-openai-realtime-api-resources
- MDN WebRTC API: WebRTC gives browser apps media streams and data channels through `RTCPeerConnection` without plugins; useful grounding for client-side architecture. Source: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API
- webrtc.org architecture: WebRTC includes STUN/ICE, RTP, Opus, NetEQ jitter buffering/error concealment, acoustic echo cancellation, and noise reduction. These are exactly the audio transport primitives a low-latency voice app needs. Source: https://webrtc.github.io/webrtc-org/architecture/
- Pipecat OpenAI Realtime docs: `OpenAIRealtimeLLMService` wraps Realtime for direct speech-to-speech, function calling, semantic/server VAD, runtime settings, paused audio/video, and manual turn control. It notes model is connection-level and cannot be changed mid-session. Source: https://docs.pipecat.ai/api-reference/server/services/s2s/openai

## Synthesis notes

- Recommended default: client WebRTC to OpenAI Realtime, app-server session creation, and sideband server control for sensitive business logic/tools.
- Major design decision: use native speech-to-speech unless the app needs a specific independent STT/TTS provider or separate TTS voice control.
- Latency guidance: optimize user-perceived mouth-to-ear turn gap, with subcomponents for VAD, first audio, tool calls, and WebRTC transport health.
- VAD guidance: start with semantic VAD at medium/auto eagerness, tune against recorded realistic conversations, and consider push-to-talk when user control/noisy environment matters more than hands-free naturalness.
- Prompt guidance: voice prompts should be concise, operational, and example-driven; avoid large text-chat-style policies that produce long spoken answers.
- Tooling guidance: keep private tools on the server side via sideband, keep tool outputs concise, and use short spoken preambles for non-trivial waits.
- Wrote final report to `realtime-api-low-latency-voice/README.md`.

## Verification

- Checked that the final report and notes do not contain the private app-context terms from the user request.
- Checked for non-ASCII characters in the new files and normalized typographic quotes/dashes to ASCII.
- Confirmed the thread contains only `README.md` and `notes.md`; no `_summary.md` was created.

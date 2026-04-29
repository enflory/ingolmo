# Best Practices for Low-Latency Voice-to-Voice Apps with OpenAI Realtime API

Research date: 2026-04-29

## Executive Summary

For a browser or mobile voice-to-voice application, the default architecture should be:

1. Client connects to OpenAI Realtime with WebRTC.
2. App server creates the session, mints ephemeral credentials or proxies SDP setup, and keeps secrets off the client.
3. Server opens a sideband control channel to the same Realtime session for private tools, guardrails, tracing, and business logic.
4. Use `gpt-realtime` for native speech-to-speech unless a specific requirement forces a cascaded STT -> LLM -> TTS pipeline.
5. Measure latency as the user experiences it: end-of-user-speech to audible assistant speech, not just model or server processing time.

The main product risk is not "can audio stream?" It is whether the interaction feels conversational under real network, microphone, interruption, background noise, and tool-latency conditions. Treat turn-taking, barge-in, audio transport, and instrumentation as first-class design surfaces.

## Source Base

Primary OpenAI sources:

- [Realtime API with WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [Realtime API with WebSocket](https://developers.openai.com/api/docs/guides/realtime-websocket)
- [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [Voice activity detection](https://developers.openai.com/api/docs/guides/realtime-vad)
- [Using realtime models](https://developers.openai.com/api/docs/guides/realtime-models-prompting)
- [Webhooks and server-side controls](https://developers.openai.com/api/docs/guides/realtime-server-controls)
- [Managing costs](https://developers.openai.com/api/docs/guides/realtime-costs)
- [Realtime API reference](https://developers.openai.com/api/reference/resources/realtime)
- [OpenAI launch post for `gpt-realtime`](https://openai.com/index/introducing-gpt-realtime/)
- [OpenAI Cookbook Realtime Prompting Guide](https://developers.openai.com/cookbook/examples/realtime_prompting_guide)
- [OpenAI Agents SDK voice agents guide](https://openai.github.io/openai-agents-js/guides/voice-agents/)

External engineering sources:

- [LiveKit OpenAI integration](https://docs.livekit.io/agents/integrations/openai/)
- [LiveKit OpenAI Realtime plugin guide](https://docs.livekit.io/agents/models/realtime/plugins/openai/)
- [Twilio core latency guide for AI voice agents](https://www.twilio.com/en-us/blog/developers/best-practices/guide-core-latency-ai-voice-agents)
- [Twilio OpenAI Realtime API resources](https://www.twilio.com/en-us/blog/developers/twilio-openai-realtime-api-resources)
- [MDN WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [webrtc.org architecture](https://webrtc.github.io/webrtc-org/architecture/)
- [Pipecat OpenAI Realtime service docs](https://docs.pipecat.ai/api-reference/server/services/s2s/openai)

## Recommended Architecture

### Default Browser Architecture

Use this for most interactive web apps:

```text
Browser / mobile app
  - Captures microphone
  - Plays assistant audio
  - Holds RTCPeerConnection
  - Uses RTCDataChannel for Realtime events
        |
        | WebRTC media + data
        v
OpenAI Realtime session
        ^
        | Sideband control connection
        |
App server
  - Authenticates user
  - Creates Realtime session / mints ephemeral client secret
  - Owns private tools, policy, retrieval, logs, metrics
  - Updates session instructions/config
```

OpenAI's WebRTC guide recommends WebRTC over WebSockets for browser/mobile clients because it gives more consistent client-side performance. WebRTC also gives you browser-native audio capture, playback, jitter handling, echo cancellation, noise suppression, and a data channel for Realtime events.

### When to Use the Agents SDK

Prefer the OpenAI Agents SDK for TypeScript if:

- You are building in TypeScript.
- You want a supported abstraction over Realtime sessions, tools, guardrails, handoffs, and session history.
- You are okay with the SDK's transport choices: WebRTC in browser, WebSocket elsewhere.

Use raw Realtime WebRTC if:

- You need precise control over SDP/session setup.
- You are building a custom media/control stack.
- You are integrating with an existing realtime framework.

### When to Use WebSockets

Use WebSockets for secure server-to-server integrations, not as the default browser path. OpenAI's WebSocket guide frames WebSockets as a good server-side choice because the standard API key stays on the backend. If using WebSocket for audio, your app must manually manage audio capture, encoding, playback, input audio buffer events, and interruption truncation.

### When to Use SIP or Telephony Providers

Use SIP, Twilio, LiveKit, or another telephony stack when the app needs phone numbers, PSTN, inbound/outbound calling, call transfer, or contact-center integration. Be aware that PSTN adds codec, routing, buffering, and carrier variability. Measure separately from browser WebRTC.

### When to Use LiveKit or Pipecat

Consider LiveKit if you need rooms, mobile SDKs, SIP integration, media infrastructure, managed WebRTC, noise cancellation, or a bridge from frontend WebRTC to OpenAI Realtime WebSockets. LiveKit's docs explicitly add interruption handling, synced transcriptions, telephony, and frontend coordination around OpenAI Realtime.

Consider Pipecat if you want an open source server-side voice pipeline framework with OpenAI Realtime support, runtime settings updates, turn-detection abstractions, video support, and event handlers.

## Transport and Audio Best Practices

### Use WebRTC for End-User Audio

WebRTC is not just a pipe. It is a mature realtime media stack with:

- `RTCPeerConnection` for media and data.
- `RTCDataChannel` for control events.
- ICE/STUN/TURN for NAT traversal.
- Opus and RTP media transport.
- Jitter buffering and packet loss concealment.
- Acoustic echo cancellation and noise reduction.

This matters because a voice AI app fails when the microphone path is brittle, echo feeds the model, or network jitter creates awkward pauses.

### Keep the WebRTC Session Simple

For a one-human-to-one-agent app:

- Use one peer connection where possible.
- Negotiate only the tracks you need.
- Avoid unused video tracks unless visual input is part of the product.
- Avoid repeated renegotiation during startup.
- Use one data channel for OpenAI Realtime events unless there is a clear reason to split channels.

### Configure Microphone Capture Deliberately

For browser audio capture, start with browser-native constraints:

- Echo cancellation enabled.
- Noise suppression enabled, unless you have a better client/server noise stack.
- Automatic gain control enabled for normal laptop/headset scenarios.

Then test with:

- Built-in laptop mic and speakers.
- Bluetooth headset.
- Wired headset.
- AirPods-style devices.
- Noisy room.
- Two voices near the microphone.
- User interrupting while assistant audio is playing.

### TURN and Network Reliability

If you operate your own WebRTC infrastructure or use a provider, verify:

- TURN is available for restrictive NAT/firewall environments.
- TURN over UDP, TCP, and TLS is supported where practical.
- TURN regions are near users.
- Connection setup failures and ICE candidate types are logged.
- You can distinguish direct, STUN-reflexive, and relay paths in metrics.

Even if OpenAI handles the peer on its side, your client and any intermediary WebRTC infrastructure still need production-grade network observability.

## Session Setup and Security

### Prefer Server-Mediated Session Creation

OpenAI documents two browser setup paths:

- Unified `/v1/realtime/calls` setup: browser sends SDP to your server, your server attaches session config and forwards to OpenAI.
- Ephemeral client secret setup: browser asks your server for a short-lived client secret, then connects directly to OpenAI.

Both keep the standard API key off the client. Choose based on how much you want the app server in the critical path:

- Unified setup is simpler to centralize and audit.
- Ephemeral setup keeps the browser's media setup path more direct after token minting.

### Use Sideband Server Control

OpenAI's server-side controls guide recommends a sideband connection when clients connect directly via WebRTC or SIP. This means the user client and your app server are both attached to the same Realtime session.

Use the sideband channel for:

- Tool execution.
- Private retrieval.
- Business rules.
- Dynamic instruction updates.
- Guardrails.
- Audit logging.
- Session tracing.
- Escalation or handoff decisions.

Do not run sensitive tools in the browser just because the browser owns the audio connection.

### Treat `session.update` as a Runtime Control Surface

Use session updates to adjust:

- Instructions.
- Prompt ID/version/variables.
- Turn detection.
- Input transcription settings.
- Tools.
- Tracing metadata.

Remember from the API reference and ecosystem docs: model is connection-level and voice changes are constrained once audio output has started. Choose model and voice before the session begins.

## Turn Detection and Interruption

Turn-taking is the core UX. A technically correct app that waits too long, interrupts too early, or cannot handle barge-in will feel broken.

### Start with Semantic VAD

OpenAI supports:

- `semantic_vad`: decides whether the user's words appear complete.
- `server_vad`: uses audio/silence thresholds.
- Manual turn control: disable VAD and commit audio yourself.

Start with `semantic_vad` for natural conversation because it is less likely to cut users off mid-thought. Tune `eagerness`:

- `low`: patient, better for reflective speakers, higher latency.
- `medium` or `auto`: balanced default.
- `high`: faster, more interruption risk.

### Use Server VAD When Audio Conditions Are Predictable

Use `server_vad` when silence-based turn boundaries are acceptable or when you need more explicit latency control. Tune:

- `threshold`: higher for noisy rooms, lower for quiet users.
- `prefix_padding_ms`: include audio just before detected speech.
- `silence_duration_ms`: lower for faster responses, higher to avoid premature cutoff.
- `interrupt_response`: allow user speech to stop assistant output.
- `create_response`: automatically respond after detected turn end.

### Use Push-to-Talk for High-Control Interfaces

Push-to-talk can be excellent when:

- Users are in noisy environments.
- The app has a task-focused workflow.
- False VAD triggers are costly.
- Users expect control.

With VAD disabled, the client must commit the audio buffer and explicitly create the response. This can feel very fast because the app is not waiting for a silence timeout.

### Barge-In Must Be a Requirement, Not a Bonus

For WebRTC and SIP, OpenAI manages output audio buffering and automatically truncates unplayed audio on interruption. For WebSocket audio, the client manages playback and must stop audio plus tell the session what portion was actually heard.

Test interruptions as a first-class scenario:

- Interrupt during the first word.
- Interrupt mid-sentence.
- Interrupt during a tool-call preamble.
- Interrupt when the model is silent but still processing.
- Ask "what did you just say?" after interruption to verify context is not polluted by unheard audio.

## Prompting for Realtime Voice

Realtime voice prompts should be shorter, more operational, and more example-driven than many text prompts.

### Prompt Structure

Use clear sections:

- Role and objective.
- Conversation style.
- Pacing.
- What to do with unclear audio.
- Flow/state.
- Tool-use rules.
- Escalation rules.
- Safety/compliance constraints.
- Sample phrases.
- Pronunciation rules for names, acronyms, and unusual terms.

OpenAI's realtime prompting guide strongly favors precise bullets, examples, and removing contradictions.

### Optimize for Short Spoken Turns

A good voice agent does not sound like a chat answer read aloud. Defaults:

- 1 to 3 sentences per turn.
- One question at a time.
- Acknowledge briefly, then move.
- Avoid lists unless explicitly requested.
- Prefer "I'll check that now" over long tool-call narration.
- Use sample phrases for style but include a variety rule so the model does not repeat them mechanically.

### Handle Unclear Audio Explicitly

Add rules such as:

- If audio is unclear, partial, noisy, or silent, ask for clarification.
- Do not guess names, dates, numbers, or commitments from unclear audio.
- Repeat back critical captured values before acting.
- Stay in the user's language if intelligible.

### Represent Complex Flows Carefully

For longer workflows, use one of two patterns:

- Prompt-level flow: a compact state-machine-like section with goals, exit criteria, and sample phrases.
- Dynamic session updates: your server updates instructions/tools as the conversation enters a new phase.

Avoid dumping every possible policy and tool into one large prompt. OpenAI's demo patterns and Agents SDK support handoffs and supervisor patterns when one realtime agent would become overloaded.

## Tools, Retrieval, and Business Logic

### Keep Tooling Narrow

Voice UX amplifies tool latency. Design tools so the model can call the smallest useful operation:

- Prefer `lookup_profile` over broad database-query tools.
- Prefer precomputed summaries over multi-step retrieval during the call.
- Return concise tool results shaped for the next spoken turn.
- Hide implementation details from the model.

### Use Preambles for Tool Latency

For tool calls above a few hundred milliseconds, have the agent say a brief preamble:

- "One moment, I'm checking that."
- "Let me pull that up."
- "I'm going to verify the details."

Keep these varied and short. Long filler increases perceived latency and user irritation.

### Consider Async or Supervisor Patterns for Hard Reasoning

OpenAI's `gpt-realtime` supports stronger function calling and asynchronous function-call behavior than earlier realtime models, but heavy reasoning or multi-tool workflows can still make voice feel slow.

Common patterns:

- Realtime agent handles greeting, clarification, and immediate spoken flow.
- A stronger text model or backend worker handles complex tool/reasoning work.
- Realtime agent tells the user it is checking, then summarizes the returned result.

This adds latency but can improve correctness. Use only when the task needs it.

## Transcription, Logs, and Memory

### Enable Input Transcription for Product State

Even though `gpt-realtime` can reason directly over audio, most apps still need transcripts for:

- UI captions.
- Session review.
- Analytics.
- Search.
- QA.
- Follow-up summaries.
- Debugging VAD and mishearing issues.

Use Realtime transcription events and associate transcript deltas/completions by item ID. OpenAI notes that completion events for different turns are not guaranteed to arrive in order, so order by item relationships rather than arrival time.

### Do Not Treat Transcripts as Perfect Ground Truth

For important values:

- Ask the user to confirm.
- Use spelling flows for names/emails.
- Use structured tool input validation.
- Store confidence/logprob where available.

### Summarize Long Sessions

Long voice sessions can become expensive and context-heavy. Use:

- Session summaries.
- Retention-ratio truncation or token limits where appropriate.
- Structured memory of facts that matter.
- Explicit "known so far" state on your server.

Do not rely only on the raw Realtime conversation context for durable app state.

## Latency Measurement

### Define the Metrics Before Optimizing

Use at least these metrics:

- **Mouth-to-ear turn gap:** user stops speaking -> assistant audio reaches user.
- **VAD latency:** actual user stop -> `speech_stopped` or committed turn.
- **Time to first audio:** response creation -> first audible assistant audio.
- **Tool latency:** tool call emitted -> tool result submitted.
- **Interruption latency:** user starts interrupting -> assistant audio stops.
- **Session setup latency:** user clicks start -> connected and ready.
- **Reconnect recovery time:** dropped connection -> usable session again.

Twilio's latency guide is useful because it separates user-perceived mouth-to-ear latency from platform-internal processing. Do the same for WebRTC Realtime; otherwise, "fast API" measurements can hide network, buffering, and playback delays.

### Add Client-Side WebRTC Metrics

Collect:

- ICE connection state transitions.
- Candidate pair type: host/srflx/relay.
- Round-trip time.
- Packet loss.
- Jitter.
- Audio level.
- Track muted/unmuted events.
- Device changes.
- Browser and OS.

Correlate these with model events and user complaints. Many "model latency" bugs are actually microphone, echo, packet loss, or relay path bugs.

### Build a Latency Waterfall

For every turn, log:

```text
user_speech_started
user_speech_stopped
input_audio_committed
response_created
first_response_delta
first_audio_played
response_done
tool_call_started
tool_call_finished
assistant_audio_playback_done
```

The exact event names depend on SDK/raw API usage, but the shape should survive architecture changes.

## Cost Management

OpenAI's Realtime cost guide frames audio tokens by time:

- User audio: 1 token per 100 ms.
- Assistant audio: 1 token per 50 ms.
- Usage details are available on `response.done`.
- Cached input tokens can reduce repeated context cost.

Practical cost controls:

- Keep spoken responses short.
- Avoid unnecessary assistant monologues.
- Enable truncation/summarization for long sessions.
- Avoid always-on sessions when the user is idle.
- Use idle timeout behavior or app-level session lifecycle.
- Cache or pre-load stable instructions.
- Minimize tool definitions in the active session.
- Prefer concise server-side state over replaying long transcripts.

## Safety, Privacy, and Trust

Baseline requirements:

- Disclose AI interaction unless obvious from context.
- Do not expose standard API keys to clients.
- Keep private tools and data access server-side.
- Log enough for abuse/debugging, but define retention and redaction.
- Add guardrails for unsafe outputs and sensitive workflows.
- Confirm high-impact actions before executing them.
- Avoid voice cloning or impersonation patterns; use provided voices.

OpenAI's release post notes active classifiers over Realtime sessions, preset voices, usage-policy constraints, and enterprise privacy commitments. Application-level guardrails are still required.

## Testing Matrix

### Conversation UX

- Fast speaker, slow speaker, long pauses.
- User changes topic mid-turn.
- User interrupts assistant repeatedly.
- User asks assistant to repeat itself after interruption.
- User provides ambiguous or partial answer.
- User says critical values: email, phone, dates, names, acronyms.
- User speaks in noisy room.
- User speaks with another person in background.

### Device and Browser

- Chrome, Safari, Firefox, Edge.
- iOS Safari and Android Chrome.
- Laptop mic/speakers.
- Bluetooth headset.
- Wired headset.
- Permission denied, device unplugged, device switched.

### Network

- High latency.
- Packet loss.
- Jitter.
- Corporate firewall.
- VPN.
- TURN relay path.
- Mobile handoff from Wi-Fi to cellular.

### Product Runtime

- Tool timeout.
- Tool returns invalid data.
- Tool returns sensitive data.
- Sideband connection drops.
- Client WebRTC connection drops.
- User reloads page mid-session.
- Session exceeds context/cost thresholds.

## Practical Build Sequence

1. Build a minimal WebRTC session with `gpt-realtime`, microphone input, assistant playback, and data-channel event logging.
2. Add app-server session creation with standard API key only on the server.
3. Add sideband server control before adding private tools.
4. Add input transcription and a turn-by-turn event log.
5. Tune VAD with recorded test conversations.
6. Add interruption tests and verify truncation behavior.
7. Write the voice prompt as a compact operational spec with sample phrases.
8. Add one tool at a time and measure added latency.
9. Add latency waterfall dashboards.
10. Add cost tracking from `response.done`.
11. Run noisy-device-network test matrix.
12. Only then expand into handoffs, supervisor models, telephony, or visual input.

## Opinionated Defaults

Use these as a starting point:

- Model: `gpt-realtime`.
- Transport: WebRTC for browser/mobile.
- SDK: OpenAI Agents SDK if TypeScript app and no special media needs.
- Auth: server-created session or ephemeral client secret; never standard API key in client.
- Control: sideband server connection for tools and guardrails.
- VAD: `semantic_vad`, `eagerness: "medium"` or `auto`.
- Barge-in: enabled and tested.
- Responses: audio-first, brief, one question at a time.
- Transcription: enabled for UI/logging, not trusted blindly.
- Prompt style: bullets, examples, explicit unclear-audio behavior.
- Metrics: mouth-to-ear turn gap, not just API timing.

## Major Pitfalls

- Using WebSocket in the browser and then rebuilding half of WebRTC badly.
- Letting sensitive tool calls run in the client.
- Measuring only server/model latency.
- Ignoring echo cancellation and noisy-room testing.
- Treating VAD defaults as final.
- Adding too many tools and instructions to one realtime agent.
- Allowing long spoken responses because the text prompt looked good.
- Forgetting to test interruption and recovery.
- Trusting transcripts for critical values without confirmation.
- Letting session context grow forever.

## Bottom Line

The best Realtime API apps are media products as much as AI products. The model choice matters, but the real quality bar comes from WebRTC discipline, careful turn detection, short voice-native prompting, server-side control, and ruthless latency measurement. Start with the simplest native speech-to-speech path, instrument it deeply, and add orchestration only where the product truly needs it.


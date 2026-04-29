# ingolmo

A personal research repo: notes, experiments, and in-progress thinking on AI, coding, and AI product building.

Modeled on [simonw/research](https://github.com/simonw/research). The goal is a persistent, pointable body of work — a personal knowledge base that accumulates value over time, rather than a drawer full of disposable scratch files.

*Ingolmo* is Quenya for "loremaster." It fits a broader Tolkien-flavored naming scheme for my side-project studio, [Lonely Mountain Labs](https://lonelymtnlabs.com).

## Structure

Roughly one directory per research thread. Each one contains whatever shape the thread happens to need: notes, scratch code, prompts, transcripts, sketches. Structure will evolve — treat any current convention as a suggestion rather than a scheme.

## How I use it

Primarily as durable context for coding agents. When I start a new thread, I can point an agent at prior directories to reuse decisions, vocabulary, and half-working solutions instead of re-deriving them from scratch. Over time the repo is meant to become more useful to the agents than it is to me.

## Expectations

Working material, not a portfolio. Expect unfinished notes, half-formed arguments, and threads I started and wandered away from. Some will be wrong; some will be superseded by the next entry. If something here looks polished, assume it's an accident.

— Ethan, Director of Data & Analytics at Stio.

## Projects

<!-- projects-start -->

*2 projects*

### [readme-update-ci-failure](readme-update-ci-failure/README.md)

Following an automated failure to update the root `README.md` Projects section, the investigation pinpointed two main issues: the workflow did not trigger on pull requests and the workflow token lacked the required `models: read` permission for GitHub Models access. Additionally, diagnostics were hindered by `build_readme.py` capturing subprocess stderr, obscuring useful error details. The resolution involved updating workflow triggers and permissions, improving token handling in code, and enhancing error visibility, along with adding targeted tests to confirm correct behavior. These changes collectively ensure robust automation for summarizing new projects and updating the README upon future pushes to `main`.

### [realtime-api-low-latency-voice](realtime-api-low-latency-voice/README.md)

Developing low-latency voice-to-voice applications with OpenAI's Realtime API requires a WebRTC-based architecture for browser and mobile clients, with session setup and sensitive business logic managed server-side for security and control. Key best practices include prioritizing conversational UX by focusing on reliable turn-taking, robust interruption handling, and precise latency measurement from the user's perspective, rather than only backend processing times. Voice prompts should be concise, operational, and tailored for spoken interaction, while narrow server-controlled tooling and layered fallback flows help minimize perceived latency. Instrumentation for audio quality, interruption, and network events is essential, and careful session management, cost controls, and privacy safeguards must be baked in from the start. Ultimately, real product quality hinges not just on the AI model but on rigorous media handling, server orchestration, and user-centric latency measurement.

<!-- projects-end -->

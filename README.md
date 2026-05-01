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

## Projects

<!-- projects-start -->

*7 projects*

### [power-bi-migration-tools](power-bi-migration-tools/README.md)

Power BI migration off-ramps remain fragmented: as of mid-2026, no tool offers a turnkey, end-to-end migration from Power BI to another BI platform or open semantic layer. Microsoft’s shift to text-based formats (PBIP/TMDL) has improved extraction and diffing, yet migration requires stitching together open-source tools (like pbixray or Tabular Editor) for extracting data prep, semantic models, and reports. Conversion tooling is highly destination-dependent—AtScale and Sigma are notable for first-party support, but most other paths (e.g., Tableau, dbt, Cube) rely on a mix of LLM-assisted transpilation, hand-translation, and manual rebuilding of visuals, with service providers filling gaps. The field is advancing toward agentic migration patterns, where AI agents analyze and rewrite models via human-readable specs and iterative validation, but significant automation gaps persist, especially at the report and business logic layers. Teams contemplating migration should expect well-tooled inventory and extraction stages, labor-intensive measure and visual conversion, and a growing but immature ecosystem for AI-driven automation.

### [agentic-self-improvement](agentic-self-improvement/README.md)

Agentic self-improvement enables business agents to learn and adapt in real time using mechanisms such as persistent memory, intra-task reflection, prompt optimization, and trajectory retrieval—without retraining model weights or requiring ML infrastructure. Recent frameworks (e.g., Mem0, DSPy, LangGraph) allow teams to deploy agents that remember user preferences, revise outputs via self-critique, and optimize prompts using labeled data and periodic offline runs. The most accessible deployment stack consists of memory and reflection loops, which yield significant quality gains with minimal setup (LLM API, vector database, orchestration library). For narrow, well-defined tasks, research-grade systems like EvoTest and EvoAgentX offer automated workflow evolution. Overall, these patterns deliver measurable improvements (10–20% or more) across use cases such as customer support, document processing, and knowledge Q&A, while keeping operational complexity and risk manageable.

### [applescript-research](applescript-research/README.md)

AppleScript is Apple's longstanding automation language for macOS, purpose-built for inter-application task orchestration with readable, English-like syntax. Its architecture relies on app-specific scripting dictionaries and Apple Events for deep integration, powering workflows across professional publishing, legal, healthcare, and creative industries. Despite stagnated development by Apple since 2016 and increased system security friction, AppleScript remains vital through third-party support (OmniGroup, BBEdit, FileMaker), robust communities, and tools like Keyboard Maestro and Script Debugger. Shortcuts has emerged as Apple’s new automation front-end but supplements rather than replaces AppleScript, whose extensibility and composability still underpin complex Mac workflows. Limitations like inconsistent app scriptability and lack of event triggers persist, yet AppleScript continues to enable powerful automation and inspires unclaimed opportunities in Mac RPA and AI-assisted scripting.

### [github-pages-hosting](github-pages-hosting/README.md)

Offering free static site hosting directly from GitHub repositories, GitHub Pages enables fast deployment of HTML, CSS, and JS files without server-side code, making it ideal for portfolios, project documentation, and blogs. Users can publish sites via branch deployments or GitHub Actions, supporting a variety of static site generators like Jekyll, Hugo, Astro, and Next.js (static export mode), though careful configuration of base paths and routing is essential for project pages. The service imposes soft bandwidth and storage limits, provides custom domain integration with automated HTTPS, and restricts commercial use to non-transactional sites. Common pitfalls include SPA routing challenges, Jekyll file processing, plugin whitelists, and base path misconfigurations. Compared to alternatives like Cloudflare Pages, Vercel, and Netlify, GitHub Pages excels for open-source projects seeking a simple, cost-free static hosting solution tightly integrated with their source code.

### [claude-managed-agents](claude-managed-agents/README.md)

Anthropic’s Claude Managed Agents provides an asynchronous, autonomous agent runtime in the cloud, enabling tool-using Claude models to run stateful, long-running jobs while abstracting away the manual management of agent loops, session history, and sandboxed containers. Developers configure reusable agents and environments, initiate session jobs, integrate through event streams, and manage files, outputs, and custom tools via a well-defined API. The platform’s built-in toolset supports operational tasks like file I/O and web access, while memory, outcomes grading, and multiagent orchestration are emerging capabilities for sustained work and quality assurance. Adoption is best suited for complex automation where streaming progress, managed infrastructure, and persistent context are required, but not for low-latency or tightly-controlled local interactions.

### [realtime-api-low-latency-voice](realtime-api-low-latency-voice/README.md)

Developing low-latency voice-to-voice applications with OpenAI's Realtime API requires a WebRTC-based architecture for browser and mobile clients, with session setup and sensitive business logic managed server-side for security and control. Key best practices include prioritizing conversational UX by focusing on reliable turn-taking, robust interruption handling, and precise latency measurement from the user's perspective, rather than only backend processing times. Voice prompts should be concise, operational, and tailored for spoken interaction, while narrow server-controlled tooling and layered fallback flows help minimize perceived latency. Instrumentation for audio quality, interruption, and network events is essential, and careful session management, cost controls, and privacy safeguards must be baked in from the start. Ultimately, real product quality hinges not just on the AI model but on rigorous media handling, server orchestration, and user-centric latency measurement.

### [readme-update-ci-failure](readme-update-ci-failure/README.md)

Following an automated failure to update the root `README.md` Projects section, the investigation pinpointed two main issues: the workflow did not trigger on pull requests and the workflow token lacked the required `models: read` permission for GitHub Models access. Additionally, diagnostics were hindered by `build_readme.py` capturing subprocess stderr, obscuring useful error details. The resolution involved updating workflow triggers and permissions, improving token handling in code, and enhancing error visibility, along with adding targeted tests to confirm correct behavior. These changes collectively ensure robust automation for summarizing new projects and updating the README upon future pushes to `main`.

<!-- projects-end -->

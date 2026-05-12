# Research Notes: Karpathy's LLM Wiki

**Date:** 2026-05-12  
**Branch:** claude/research-karpathy-llm-wiki-4MI0k

---

## Starting point

Checked existing ingolmo directories for prior work on Karpathy or LLM knowledge-bases — none found. Starting fresh.

---

## First searches

Searched "Andrej Karpathy LLM wiki 2025 2026" and "karpathy.ai wiki llm101n". 

Primary source confirmed: a GitHub Gist published April 4, 2026 at  
https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f  
Gist reception: 17 million views, 5,000+ stars, 4,282 forks. Went viral within days.

The gist describes itself as an "idea file" — meant to be copy-pasted into any LLM agent (Claude Code, OpenAI Codex, etc.) which then instantiates the pattern for the user's specific domain.

Karpathy frames the core claim: "the tedious part of maintaining a knowledge base is not the reading or the thinking — it's the bookkeeping." LLMs handle the bookkeeping; humans curate sources and direct analysis.

Karpathy's own personal wiki (at time of gist): ~100 articles, ~400,000 words, AI research domain.

---

## Architecture of the pattern (from Gist + multiple secondary sources)

Three layers:
1. **raw/** — Immutable source materials (papers, articles, PDFs, notes). You drop files here; you never edit them after.
2. **wiki/** — LLM-maintained markdown pages. Summaries, entity pages, concept pages, cross-references. The agent owns this directory.
3. **Schema** (CLAUDE.md or AGENTS.md) — Configuration document telling the LLM how the wiki is structured, what conventions apply, and what workflows to follow.

Two meta-files:
- **index.md** — Global table of contents: every wiki page with a one-line description, organized by category.
- **log.md** — Chronological record of ingests, queries, maintenance passes.

Three operations:
- **Ingest**: Drop source into raw/, instruct agent. Agent reads source, extracts key claims/entities/concepts, creates/updates wiki pages, updates index, appends to log.
- **Query**: Ask a question. Agent searches the compiled wiki and answers with citations to wiki pages. Good answers can be filed back as new wiki pages ("query-to-wiki conversion").
- **Lint**: Health check. Agent scans for orphan pages, broken cross-references, contradictions, stale claims, missing entries in index.

Key distinction from RAG: **synthesis happens at ingest time and compounds over time**, not re-derived on each query. Each ingest enriches the persistent structure rather than evaporating into context.

---

## The schema file in detail (AGENTS.md / CLAUDE.md)

Multiple sources identify this as the highest-leverage artifact in the system. One community guide: "Most people skip it and wonder why the LLM behaves inconsistently across sessions."

From the Programming-With-Maury AGENTS.md concrete example, the schema typically encodes:
- **Directory structure**: Where different page types live (sources/, entities/, concepts/, overviews/)
- **Writing standards**: YAML frontmatter requirements, cross-linking rules, uncertainty tracking conventions
- **Domain taxonomy**: What entity types and relationship types exist (domain-specific)
- **Staging workflow**: Large documents staged for review before full ingest
- **Ingest workflow**: Step-by-step: read source → identify claims/entities → create summary → update entity pages → update index → append log entry
- **Query workflow**: How to cite pages, when to file answers back as wiki pages
- **Lint workflow**: What checks to run, how to flag issues
- **Quality standards**: Conciseness, source-backed claims, no large verbatim excerpts

The schema co-evolves with the wiki — after a few dozen sources and a few lint passes, it reflects how the domain actually works.

---

## Community response and implementations

The gist sparked an immediate ecosystem (all within weeks of April 4, 2026):

### Agent skill packages (drop-in)
- **Astro-Han/karpathy-llm-wiki**: Claude Code / Cursor / Codex compatible via `npx add-skill`. Reports 94 wiki articles across 13 topic dirs, 99 sources. Daily maintenance since April 2026.
- **Pratiyush/llm-wiki** (yopedia): Full-stack CLI + static site generator. Converts .jsonl AI session transcripts into wiki. 33,600+ lines, 1,242 automated tests. Features: MCP server with 12 tools, 4-factor confidence scoring, 5-state lifecycle machine, 16 lint rules, auto-stale after 90 days, MEMORY.md consolidation.

### Full platforms
- **OmegaWiki** (skyllwt): Research lifecycle platform with 24 Claude Code skills spanning ingest → knowledge graph → gap detection → idea generation → experiment design → paper writing. Nine typed entity classes. Daily arXiv automation.
- **llmwiki** (lucasastorian): Web app (Next.js + FastAPI + SQLite). Upload PDFs/docs, Claude via MCP writes wiki pages. Uses pdf-oxide for PDF extraction. SQLite FTS5 for search.
- **yopedia** (yologdev): Fully autonomous — every commit from AI agents. Six specialized agents (Research, PM, Office Hour, Build, Architect, Review) communicating via GitHub Issues as shared bus. 33,600+ lines of autonomous code.
- **Synthadoc**: Multi-LLM (Anthropic/OpenAI/Gemini/Groq/Ollama), extensible Skills plugin, async job queue with retry/audit.

### Extension gists
- **LLM Wiki v2** (rohitg00): Extensions from building agentmemory. Adds: confidence scoring, 4-tier memory lifecycle (working/episodic/semantic/procedural), knowledge graph with typed edges, hybrid search (BM25 + vectors + graph), event-driven hooks.
- **Scaling extensions** (redmizt): 18 architectural extensions for multi-agent production — identity, security, concurrency, active learning, knowledge graphs, framework self-improvement.
- **jibrain comparison** (Joi): Critique + alternative. Claims advantages via entity resolution, hybrid search, multi-source extraction, quality gating, tiered access controls.

### Visualization integrations
Multiple guides connect the wiki to Obsidian (graph view for wikilinks), treating markdown as the human interface and the schema as the agent interface.

---

## Criticisms and known failure modes

### Hallucination compounding (most serious)
LLM-generated summaries silently contain errors. Future ingests read those summaries as if they were authoritative sources. Over time, the chain of custody back to the original source frays — "knowledge base poisoning." Proposed mitigations: explicit source provenance per claim, confidence decay, human-review gates before promotion.

### Scalability cliff
Works well up to ~100-200 pages (fits in context window). Above that, the index file alone outgrows context. Karpathy's own wiki is at this edge. Real retrieval substrate (semantic search, FTS, graph traversal) required above the threshold. Several implementations already add this.

### Link integrity
No referential integrity: renaming or deleting a file breaks all cross-references silently. Lint catches this, but only retrospectively. Requires continuous background re-wiring. Some implementations add a database layer.

### Context cost
Ingest of a large source + relevant existing wiki pages + schema can exhaust context. Implementations use chunked ingestion, staged review, or summarization pre-processing.

### Enterprise gaps (from community analysis)
- No RBAC (no page-level access control)
- No ACID transactions (concurrent writes corrupt wiki)
- No audit trail beyond the log.md convention
- No conflict resolution for multi-agent writes

### False precision in extensions
The LLM Wiki v2 critics noted that numeric confidence scores (e.g., "0.85") provide false precision; evidential chains with source counts are more verifiable. Ebbinghaus-style forgetting curves risk losing historically important context.

---

## The "RAG vs. LLM Wiki" framing

Multiple articles picked up on Karpathy's implicit challenge to RAG. The nuance that emerged in community discussion:
- RAG and LLM Wiki are **not** mutually exclusive. Large-scale wikis need a retrieval layer underneath.
- LLM Wiki is better when: domain is stable, sources are finite, synthesis matters (structured understanding vs. lookup), and human curator actively directs ingests.
- RAG is better when: source corpus is huge (thousands of docs), content is highly volatile, and exact retrieval of verbatim passages matters.
- The wiki pattern is a **pre-processing and curation layer** that can sit above a RAG retrieval system.

---

## Surprises / interesting details

1. The gist itself is explicitly called an "idea file" — Karpathy is seeding a pattern, not shipping a product. The implementation is deliberately left to the community.
2. Karpathy's personal wiki predates the gist; the gist documents an existing personal practice.
3. The gist notes that log.md and index.md are critical — without them the agent loses consistency across sessions. This is the "bookkeeping" that humans fail at and LLMs can sustain.
4. Several implementations treat the schema (CLAUDE.md/AGENTS.md) as the "actual product" — the transferable, evolving artifact — not the wiki content itself.
5. The yologdev/yopedia project is particularly striking: it used the LLM wiki pattern to autonomously build its own implementation from a single seed prompt — a kind of meta-demonstration of the concept.

---

## Dead ends

- aicritique.org, analyticsvidhya, mindstudio.ai, blog.starmorph.com, antigravity.codes, aaronfulkerson.com, aimaker.substack.com — all returned 403. These are secondary analysis articles that couldn't be fetched.
- redmizt gist (18 extensions) returned 404 — may have been deleted or set to private.
- Gist comments page partially failed (only one comment visible: Synthadoc announcement).

---

## Sources consulted

- https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f (primary)
- https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2 (LLM Wiki v2)
- https://gist.github.com/Joi/120f86eb39758ef75deb5e6145e5a717 (critique)
- https://github.com/skyllwt/OmegaWiki/blob/main/README.md
- https://github.com/lucasastorian/llmwiki
- https://github.com/Pratiyush/llm-wiki
- https://github.com/yologdev/karpathy-llm-wiki
- https://github.com/Astro-Han/karpathy-llm-wiki
- https://github.com/Programming-With-Maury/Karpathy-LLM-Wiki/blob/main/AGENTS.md
- Multiple web searches covering criticisms, community implementations, scaling concerns

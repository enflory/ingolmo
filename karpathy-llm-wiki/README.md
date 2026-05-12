# Karpathy's LLM Wiki: Deep Research Report

**Researched:** 2026-05-12  
**Primary source:** https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

---

## What it is

On **April 4, 2026**, Andrej Karpathy published a GitHub Gist called "LLM Wiki" — an "idea file" describing a pattern for AI-maintained personal knowledge bases. It received 17 million views, 5,000+ stars, and 4,282 forks within weeks. It sparked immediate ecosystem formation.

The gist is not a library or tool. It is a pattern specification meant to be copy-pasted into any LLM agent (Karpathy names Claude Code, OpenAI Codex, OpenCode, Pi). The agent then instantiates the pattern for the user's domain. Karpathy's own personal wiki — which predates the gist — has approximately 100 articles and 400,000 words in an AI research domain.

The core thesis: **"the tedious part of maintaining a knowledge base is not the reading or the thinking — it's the bookkeeping."** Humans curate sources and direct analysis. LLMs handle the bookkeeping that causes human-curated wikis to be abandoned.

---

## The pattern

### Three-layer architecture

```
raw/          ← Immutable source materials (papers, PDFs, articles, notes)
wiki/         ← LLM-maintained markdown pages (agent owns this directory)
CLAUDE.md     ← Schema: structure, conventions, workflows
  or AGENTS.md
```

Two meta-files inside wiki/:
- **index.md** — Global table of contents: every page with a one-line description, organized by category.
- **log.md** — Chronological record of every ingest, query, and maintenance pass.

### Three operations

**Ingest**: Drop a file into raw/, tell the agent to process it. The agent reads the source, identifies key claims, entities, and concepts, creates or updates wiki pages for each, updates the index, and appends an entry to the log. Knowledge compounds — each new source enriches existing pages rather than being queried in isolation.

**Query**: Ask a question. The agent searches the compiled wiki and answers with citations to specific wiki pages. Good answers can be filed back as new pages ("query-to-wiki conversion"), so conversational insights become permanent.

**Lint**: Health check. The agent scans for: orphan pages (in wiki/ but not in index), missing cross-references, contradictions between pages, stale claims, and broken links. Run periodically.

### The schema file (CLAUDE.md / AGENTS.md)

Multiple practitioners identify this as the highest-leverage artifact in the system. A concrete example (Programming-With-Maury/Karpathy-LLM-Wiki) shows it typically encodes:

- **Directory structure**: Where different page types live — `wiki/{domain}/sources/`, `wiki/{domain}/entities/`, `wiki/{domain}/concepts/`, `wiki/{domain}/overview.md`. Global pages for concepts spanning 2+ domains.
- **Writing standards**: YAML frontmatter requirements, cross-linking conventions, uncertainty tracking (explicit hedging for unverified claims), conciseness rules (no large verbatim excerpts).
- **Domain taxonomy**: Entity types and relationship types specific to the knowledge domain.
- **Staging workflow**: Large documents staged for review before full ingest (human gate before committing).
- **Ingest workflow**: Step-by-step — read → identify → create/update pages → update index → append log.
- **Query workflow**: Citation format, when to promote answers into permanent wiki pages.
- **Lint workflow**: Specific checks to run; how to flag vs. auto-fix.

The schema co-evolves with the wiki. After a few dozen sources and a few lint passes, it reflects how the domain actually works. Several practitioners frame it as the transferable artifact — the schema is what you'd share if you wanted someone else to maintain the same wiki.

### Key distinction from RAG

| RAG | LLM Wiki |
|-----|----------|
| Synthesis at query time, every time | Synthesis at ingest time, compounds |
| Answers evaporate after session | Knowledge persists and grows |
| Source corpus is authoritative | Wiki is a curated layer above sources |
| Scales to large volatile corpora | Optimized for curated, stable domains |
| No upfront cost per document | Ingest cost per document |

The two are **not mutually exclusive**. At scale (100+ pages) the LLM Wiki itself needs a retrieval substrate (semantic search, FTS) underneath it. The wiki pattern is a pre-processing and curation layer that can sit above RAG.

---

## Community ecosystem (first six weeks)

The gist spawned an immediate ecosystem of implementations:

### Agent skill packages

**Astro-Han/karpathy-llm-wiki** — Drop-in Claude Code / Cursor / Codex skill via `npx add-skill`. Reports: 94 wiki articles across 13 topic directories, 99 sources ingested, daily maintenance since April 2026.

**Pratiyush/llm-wiki** (yopedia) — Full-stack CLI + static site generator. Converts `.jsonl` AI session transcripts into a wiki. Features: MCP server (12 tools: `wiki_query`, `wiki_search`, `wiki_lint`, etc.), 4-factor confidence scoring, 5-state lifecycle machine (draft → reviewed → verified → stale → archived), 16 lint rules, auto-stale after 90 days, MEMORY.md consolidation. Exports `/llms.txt`, `/llms-full.txt`, `/graph.jsonld`.

### Full platforms

**OmegaWiki** (skyllwt/OmegaWiki) — Research lifecycle platform with 24 Claude Code skills spanning: paper ingestion → knowledge graph → gap detection → idea generation → experiment design → paper writing → peer review response. Nine typed entity classes (Papers, Concepts, Topics, People, Ideas, Experiments, Methods, Summaries, Foundations). Daily arXiv automation via GitHub Actions.

**llmwiki** (lucasastorian/llmwiki) — Web application (Next.js + FastAPI + SQLite). Upload documents, connect Claude via MCP, Claude writes wiki pages. Uses pdf-oxide for PDF extraction, Mistral API for enhanced OCR. SQLite FTS5 for full-text search.

**yopedia** (yologdev) — The most extreme implementation: fully autonomous. Every commit originates from AI agents. Six specialized agents communicate via GitHub Issues as a shared message bus: Research (Sundays, market scan), PM (daily, identifies gaps), Office Hour (daily, triages issues), Build (on-demand + every 4h, implements), Architect (decomposes complex tasks), Review (evaluates against acceptance criteria). 33,600+ lines of code; 1,242 automated tests. Demonstrates the wiki pattern applied recursively to its own development.

**Synthadoc** — Multi-LLM (Anthropic/OpenAI/Gemini/Groq/Ollama), extensible Skills plugin architecture, async job queue with retry logic and audit trails, full Obsidian integration.

### Extension gists

**LLM Wiki v2** (rohitg00) — Extends with production lessons from agentmemory:
- 4-tier memory lifecycle: working memory → episodic memory → semantic memory → procedural memory
- Typed knowledge graph layer (entities connected by typed edges: "uses", "depends on", "contradicts", "caused")
- Hybrid search: BM25 (keyword) + vector embeddings (semantic) + graph traversal, fused via reciprocal rank fusion
- Event-driven hooks: auto-fire on ingest, session start/end, quality thresholds, schedules
- Quality gating: every piece of content scored; contradictions flagged and auto-resolved or queued for human review

**jibrain critique** (Joi/120f86eb39758ef75deb5e6145e5a717) — Analysis identifying five patterns worth adopting (chapter-level extraction, contradiction detection, provenance logs, query-to-wiki conversion, source-type classification) while claiming a production system surpasses the pattern through entity resolution, hybrid search, multi-source extraction, and quality gating.

---

## Criticisms and failure modes

### Knowledge base poisoning (most serious)
LLM-generated summaries silently contain errors. Later ingests read those summaries as sources. The chain of custody back to original documents frays over time — the wiki becomes increasingly self-referential. LLM responses reason on top of prior LLM responses.

Mitigations proposed: explicit source provenance per claim, confidence decay curves, human review gates before promoting summaries to authoritative status.

### Scalability cliff
Karpathy's own wiki (~100 articles, 400,000 words) sits at the edge of what fits in a context window. The assumption that what works at 100 pages works at 10,000 does not hold. Once the wiki exceeds 50k–100k tokens, you need a real retrieval substrate — there is no shortcut around information-theoretic limits. Several implementations already add this.

### Link integrity
No referential integrity. Renaming or deleting a file silently breaks all cross-references in other pages. Lint catches this retrospectively. At scale, maintaining cross-references requires continuous background processing — transforming "a simple folder of files into a heavy, ongoing ETL process."

### Context cost per ingest
Ingesting a large source + pulling in all related existing wiki pages + loading the schema can exhaust context. Implementations handle this with chunked ingestion, staged review workflows, or summarization pre-processing.

### Enterprise gaps
No RBAC (page-level access control), no ACID transactions (concurrent writes corrupt state), no real conflict resolution for multi-agent parallel writes, no built-in audit trail beyond the log.md convention.

### False precision in confidence scoring
The LLM Wiki v2 critics note numeric confidence scores (e.g., "0.85") provide false precision. Evidential chains (source count, recency, contradiction count) are more verifiable than single-number scores. Similarly, Ebbinghaus-style forgetting curves risk discarding historically important context — explicit supersession with version control is safer.

---

## When to use it

**Good fit:**
- Stable, curated domain with finite source material
- Personal research where synthesis matters more than exact retrieval
- Agentic workflows where the LLM session should accumulate understanding over weeks/months
- Solo or small-team use where concurrency is not a concern

**Poor fit:**
- Rapidly changing source corpus (content becomes stale faster than lint can catch)
- Very large archives (1,000+ documents) without a retrieval layer underneath
- Multi-agent or multi-user collaborative use without the concurrency extensions
- Domains where exact verbatim retrieval matters more than synthesized understanding

---

## Practical setup (minimal viable wiki)

1. Create directory structure:
   ```
   raw/sources/        ← drop sources here
   wiki/               ← agent-owned
   wiki/index.md       ← global ToC
   wiki/log.md         ← operation history
   AGENTS.md           ← schema (see below)
   ```

2. Write AGENTS.md encoding:
   - Your domain taxonomy (entity types, concept categories)
   - Writing standards (frontmatter, cross-linking conventions)
   - The three workflows (ingest, query, lint) step by step
   - Where different page types live

3. Copy the gist into AGENTS.md as a starting point, then customize to your domain.

4. Start with 5–10 sources. Ingest each, review the wiki, run lint. Refine AGENTS.md based on what you observe.

5. After ~20 sources, the wiki will begin exhibiting the compounding property — new ingests will update existing pages rather than just creating new ones.

---

## Key insight

The LLM Wiki pattern is less about the wiki and more about the **schema**. The schema (AGENTS.md / CLAUDE.md) is what turns a generic LLM into a disciplined knowledge worker that behaves consistently across sessions. It is also the primary artifact you'd hand to someone else — or to a different agent — to continue the work. The wiki content is the output; the schema is the recipe.

Karpathy's contribution is not novel technology — it is a precise articulation of a discipline for using existing agentic LLMs to maintain persistent, compounding knowledge. The viral reception reflects that the idea was ready to be named.

---

## Related prior work in this repo

None found. This is the first thread on knowledge base patterns or Karpathy's agentic writing.

Potentially related threads to check if extending this research:
- `memory-architectures-2026/` — memory systems research, likely overlaps on session persistence
- `ai-memory-systems/` — similar overlap
- `rag-domain-knowledge-strategies/` — directly adjacent; the LLM Wiki is explicitly positioned as an alternative/complement to RAG

---

## Sources

- [Karpathy LLM Wiki Gist (primary)](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
- [LLM Wiki v2 (rohitg00)](https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2)
- [jibrain critique gist (Joi)](https://gist.github.com/Joi/120f86eb39758ef75deb5e6145e5a717)
- [OmegaWiki README](https://github.com/skyllwt/OmegaWiki/blob/main/README.md)
- [llmwiki (lucasastorian)](https://github.com/lucasastorian/llmwiki)
- [llm-wiki / yopedia (Pratiyush)](https://github.com/Pratiyush/llm-wiki)
- [yopedia self-growing (yologdev)](https://github.com/yologdev/karpathy-llm-wiki)
- [karpathy-llm-wiki skill (Astro-Han)](https://github.com/Astro-Han/karpathy-llm-wiki)
- [AGENTS.md example (Programming-With-Maury)](https://github.com/Programming-With-Maury/Karpathy-LLM-Wiki/blob/main/AGENTS.md)
- [AI Critique analysis](https://www.aicritique.org/us/2026/05/08/andrej-karpathys-latest-concept-llm-wiki-and-the-future-of-enterprise-knowledge/)
- [Beyond RAG (Level Up Coding)](https://levelup.gitconnected.com/beyond-rag-how-andrej-karpathys-llm-wiki-pattern-builds-knowledge-that-actually-compounds-31a08528665e)
- [Hidden Flaw (Medium)](https://foundanand.medium.com/the-hidden-flaw-in-karpathys-llm-wiki-e3a86a94b459)
- [LLM Wiki is a Bad Idea (Medium)](https://medium.com/data-science-in-your-pocket/andrej-karpathys-llm-wiki-is-a-bad-idea-8c7e8953c618)
- [Karpathy Killed RAG? (Towards AI)](https://pub.towardsai.net/andrej-karpathy-killed-rag-or-did-he-the-llm-wiki-pattern-7824d876e790)
- [TecAdRise community overview](https://tecadrise.ai/blog/llm-wiki-karpathy-ai-knowledge-management-2026)

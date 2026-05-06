# Notes: Claude Code + Excel integration for corporate finance

Started: 2026-05-06

## Goal

Figure out the best workflows, tools, best practices, and pitfalls for using Claude Code (the CLI agent) to interact with Excel workbooks, with a focus on corporate finance use cases. Also covers final-deliverable generation: PowerPoint, PDF, etc.

## Prior work in repo

- `applescript-research/` — covers macOS automation including Excel scripting via AppleScript dictionaries. Relevant for Mac-side automation paths.
- `cli-tools-for-ai-agents/` — best practices for designing CLIs that AI agents will drive. Direct application: any Excel CLI we recommend should be agent-friendly (token-efficient, schema-introspectable, deterministic).
- `ai-bi-json-render-pattern/` — governed structured-output pattern for analytics. The Excel parallel: agents should generate against a *catalog* of approved building blocks (chart types, formulas, layouts), not freeform.
- `power-bi-migration-tools/` — Microsoft data tooling landscape, including agentic migration patterns.

## Research plan

1. **File format / library landscape** — what can read/write .xlsx without Excel running?
2. **Live Excel automation** — when do we need a running Excel instance (xlwings / COM / AppleScript / Office Scripts)?
3. **Anthropic's Claude for Excel** — what does the official integration do, and where does Claude Code fit?
4. **MCP servers** — third-party MCP servers for Excel/Office.
5. **Output formats** — PowerPoint, PDF, HTML, image/PNG of slides.
6. **Corporate finance patterns** — 3-statement models, FP&A, valuation, board decks.
7. **Failure modes** — formula corruption, named ranges, data loss, formatting drift.

## Notes log (chronological)


### Round 1: Anthropic skills repo (canonical)

Source: github.com/anthropics/skills/blob/main/skills/{xlsx,pptx,pdf}/SKILL.md

**XLSX skill canonical pattern:**
- Tool selection: `openpyxl` for formulas/formatting/templates, `pandas` for bulk data and analysis
- "Always use Excel formulas instead of calculating values in Python and hardcoding them" — preserves dynamic models
- Formula recalc: `scripts/recalc.py <file> [timeout]` uses LibreOffice headless to compute formula values, returns JSON with errors. Required after writing
- **Critical destructive bug**: opening a workbook with `data_only=True` and saving it replaces formulas with values, permanently. Only use `data_only=True` for read-only access
- Color coding (industry standard, also used by big-banks finance):
  - Blue text: hardcoded user inputs
  - Black: formulas/calculations
  - Green: cross-sheet links
  - Red: external file links
  - Yellow background: key assumptions
- Number formats:
  - Years as text strings ("2024", not 2,024)
  - Currency: $#,##0 with units in headers ("Revenue ($mm)")
  - Zeros displayed as "-"
  - Percentages: 0.0%
  - Negatives in parentheses (123)
- Validation: zero formula errors (#REF!, #DIV/0!, #VALUE!, #N/A, #NAME?), test 2-3 references before full build, watch for div-by-zero

**PPTX skill canonical pattern:**
- Triggered by mentions of "deck"/"slides"/"presentation"/`.pptx`
- Path A — template-based: unpack OOXML → modify → pack (for branded decks)
- Path B — from scratch: `pptxgenjs` (Node) recommended over python-pptx in this repo
- Validation loop:
  1. Convert pptx → PDF → JPEGs via `pdftoppm`
  2. Generate thumbnail grid
  3. Subagent review with fresh eyes ("Assume there are problems. Your job is to find them")
  4. Fix → re-render affected slides → repeat
- Anti-patterns flagged as AI-tells: text-only slides, centered body text, accent lines under titles
- Color theory: 60-70% dominant, 1-2 supporting, one accent

**PDF skill canonical pattern:**
- Form filling: separate `FORMS.md`; tools `pdf-lib`, `pypdf`
- Merging: `pypdf` Python or `qpdf --empty --pages a.pdf b.pdf -- merged.pdf` CLI (`pdftk` legacy)
- Tools: pypdf, pdfplumber, reportlab, qpdf, pdfimages, pytesseract+pdf2image for OCR
- Gotcha: never use Unicode subscript/superscript chars — render as solid black boxes. Use XML markup tags

**Financial-cookbook patterns (claude-cookbooks/skills/notebooks/02_skills_financial_applications.ipynb):**
- Multi-sheet Excel models: P&L + balance sheet + KPI dashboard
- Optimal split: 2-3 sheets per workbook, each with single purpose
- Pipeline: Excel analysis → PowerPoint summary → PDF documentation, chained for consistency
- Prompting:
  - Pass structured data (JSON/CSV), not prose
  - Specify chart types and exact data points
  - Specify color schemes (green/red P&L, etc.)
- Performance: ~1-2 min for 2-sheet Excel, 1-2 min for PPT, 2-3 min for full three-doc pipeline
- "Skills use ~90% fewer tokens than manual instructions" — load skill, don't inline instructions


### Round 2: Claude for Excel (the add-in) details

Sources: support.claude.com, claude.com/claude-for-excel, anthropic.com/news, marketplace.microsoft.com

**Product positioning vs Claude Code:**
- "Claude for Excel" is an Office.js add-in that runs INSIDE Excel as a side panel, NOT Claude Code
- Beta launched October 2025 (Max/Enterprise), opened to Pro ($20/mo) Jan 24 2026
- Distribution: Microsoft AppSource (`marketplace.microsoft.com/.../wa200009404`)
- Available on Pro, Max, Team, Enterprise; NOT free
- March 2026 update added: Shared Context across Excel↔PowerPoint, reusable Skills (one-click workflows), MCP Connectors, Bedrock/Vertex/Microsoft Foundry deployment
- May 2026: 10 finance agent templates released

**Capabilities (in-product, not Claude Code):**
- Read multi-tab workbooks with cell-level citations
- Trace #REF!/#VALUE!/circular refs to source
- Update assumptions while preserving formula deps
- Apply native ops: sort, filter, pivot table edits, charts, conditional formatting, data validation, print prep
- Connectors: FactSet, S&P Capital IQ, MSCI, PitchBook, Moody's, IBISWorld, Dun & Bradstreet, Verisk

**10 finance agent templates (May 5 2026):**
- Research/coverage: Pitch builder, Meeting preparer, Earnings reviewer, Model builder, Market researcher
- Finance/ops: Valuation reviewer, GL reconciler, Month-end closer, Statement auditor, KYC screener
- Each ships as a plugin in Claude Cowork AND Claude Code, plus cookbook for Managed Agents
- Pitch agent: produces comps Excel + pitchbook PPTX + cover note in Outlook
- Opus 4.7 = state-of-the-art finance model: 64.37% on Vals AI Finance Agent benchmark

### Round 3: CRITICAL pitfall — openpyxl corrupts complex models

Source: github.com/anthropics/claude-code/issues/22044 (closed "not planned"), openpyxl-users mailing list

**The problem (verbatim from issue):**
- User had ~50 .xlsm investment models with macros + named ranges
- Used Claude Code's xlsx skill to add calculated columns
- openpyxl wrote files back; Excel reported "We found a problem with some content"
- All edited files corrupted or unopenable; user restored from Dropbox

**What openpyxl silently breaks:**
- VBA macros (.xlsm)
- Named ranges (`model`, `row_match`, `column_match`, `annual`, etc.)
- Complex conditional formatting
- Pivot tables (rendered as just text/values)
- Charts (often stripped or corrupted)
- External links
- Formulas in some edge cases

**No error is raised — silent corruption.** The xlsx skill's recalc step won't catch this; it only checks for #REF! errors after recalc, not file structure damage.

**Mitigations:**
1. NEVER use openpyxl write path on .xlsm files
2. For complex .xlsx models with named ranges/conditional formatting, prefer:
   - **xlwings** if Excel is available (controls live Excel via COM/AppleScript — preserves everything)
   - **Office Scripts** for cloud/web Excel
   - **The Claude for Excel add-in** (uses Office.js — preserves everything natively)
   - **MCP servers that wrap Excel COM/AppleScript**, not file rewriters
3. If openpyxl is the only option, treat as data-extraction-only (`read_only=True`), then reissue formulas/formatting fresh in a new file
4. Always backup before mutation; verify in Excel after every write

### Round 4: Library decision matrix

| Library | Lives | Read | Write | Formulas | Macros | Named ranges | Charts | Pivots | Cost | Headless server? |
|---|---|---|---|---|---|---|---|---|---|---|
| openpyxl | file (no Excel) | ✓ | ✓ (destructive on complex) | preserve as text | strips | breaks | partial | strips | free | ✓ |
| xlsxwriter | file (no Excel) | ✗ | ✓ (new only) | ✓ | ✗ | ✓ | ✓ | ✗ | free | ✓ |
| pandas | file (no Excel) | ✓ | ✓ (data only) | ✗ (loses) | ✗ | ✗ | ✗ | ✗ | free | ✓ |
| xlwings | live Excel via COM/AppleScript | ✓ | ✓ (safe) | ✓ | ✓ | ✓ | ✓ | ✓ | free + Excel | ✗ (needs Excel) |
| PyXLL | embedded in Excel | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | commercial | ✗ |
| Office Scripts | Excel for web | ✓ | ✓ | ✓ | mostly | ✓ | ✓ | ✓ | M365 | ✓ (cloud) |
| Office.js add-in | Excel runtime | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | M365 | ✗ |

**Key implication for Claude Code:**
- Headless server / sandbox / CI: openpyxl + LibreOffice recalc (Anthropic's xlsx skill). Safe ONLY for simple xlsx files.
- Analyst's local machine with Excel installed: xlwings is the safest mutator for production financial models. Claude Code can drive xlwings.
- Web/cloud: Office Scripts via Microsoft Graph or Power Automate; or the Claude for Excel add-in.


### Round 5: Architecture decision — Skills vs MCP vs Subagents

Source: claude.com/blog/skills-explained, code.claude.com/docs/skills

**Three orthogonal mechanisms:**

| Mechanism | What it does | When to use for Excel |
|---|---|---|
| **Skill** | Procedural knowledge (SKILL.md + scripts). Loaded into context dynamically. | Encode the *how* of building/auditing Excel models. Default mechanism. ~90% fewer tokens than inline instructions. |
| **MCP server** | Connects Claude to external services/state. Live access. | Live data feed (FactSet, Bloomberg), Excel COM bridge, internal data warehouse. |
| **Subagent** | Specialized agent with own context/tools. | Visual QA of decks (fresh eyes), parallel sensitivity-analysis runs, isolating heavy reads. |

**Recommended stack (2026 default): compose all three.**
- A **subagent** (Haiku for cost) running with
- A **skill** preloaded for finance conventions (color codes, formula patterns, recalc), plus
- A **scoped MCP server** for live market data or live Excel control via xlwings/COM.

**Common mistake**: using MCP to do what a skill should do. MCP is for connectivity; skills are for know-how.

### Round 6: Recalc internals (scripts/recalc.py)

The script:
- Auto-installs a LibreOffice StarBasic macro `RecalculateAndSave` in user's LibreOffice profile
- Macro: `ThisComponent.calculateAll(); ThisComponent.store(); ThisComponent.close(True)`
- Calls `soffice --headless --norestore vnd.sun.star.script:Standard.Module1.RecalculateAndSave?...`
- Cross-platform (Linux/macOS); uses `timeout`/`gtimeout` for safety
- After recalc, scans all cells for #REF!, #DIV/0!, #VALUE!, #N/A, #NAME?
- Returns JSON: `{"status": "success"|"errors_found", "total_errors": N, "total_formulas": N, "error_summary": {...}}`

**Implication:** LibreOffice is a hard dependency. Sandboxed environments (CI, lambda) need it pre-installed. Speed: a few seconds to a minute per file depending on model complexity.

**LibreOffice's calc engine ≠ Excel's calc engine** for some functions. Areas where they diverge:
- Some Excel-only functions (newer dynamic arrays like LET, LAMBDA, CHOOSECOLS, TEXTSPLIT) may calc differently or not at all
- Iterative calculation behavior (circular reference convergence) can differ
- Date system 1900 vs 1904 quirks

For fidelity-critical models, recalc with LibreOffice but verify in Excel before delivering.

### Round 7: docx (Word) skill notes

Source: github.com/anthropics/skills/blob/main/skills/docx/SKILL.md

- A .docx is a ZIP archive of XML
- Reading: `pandoc --track-changes=all` for clean text; `unpack.py` for raw XML
- Creation: `docx-js` (Node) - **CRITICAL gotcha**: docx-js defaults to A4 not US Letter; always set page size explicitly
- Editing: unpack → edit XML → repack (preserves styles, comments, tracked changes)
- Tracked changes: author defaults to "Claude" unless overridden; `scripts/accept_changes.py` finalizes
- Validation: `scripts/office/validate.py` — Office docs need post-write validation (unlike most file formats, malformed XML often opens with warning rather than fails)
- Anti-pattern: never insert Unicode bullets (U+2022) — use docx-js `LevelFormat.BULLET`

### Round 8: Enterprise/audit considerations

Source: support.claude.com release notes

- Claude for Excel observability (OTEL → SIEM): Enterprise tier only, NOT Pro/Team
- Compliance API: not available for Excel actions on Pro/Team/Max
- For corporate finance (regulated), this matters: Pro/Team users get no audit log of what Claude did to which workbook
- Mitigation for finance teams: keep workbooks in xltrail (a git for Excel) or version-controlled folder; commit before AI session; commit AI changes as a separate commit to preserve diff
- xltrail (xltrail.com) parses .xlsx/.xlsm and produces semantic diffs (cell, formula, VBA, charts)


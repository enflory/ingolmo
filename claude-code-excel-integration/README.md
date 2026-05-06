# Claude Code + Excel for corporate finance

A practical guide to using Claude Code (the CLI agent) to build, audit, and report on Excel models, with explicit best practices, failure modes, and downstream PowerPoint/PDF workflows.

**Audience:** corporate finance, FP&A, investment banking, equity research, controllers — anyone who lives in Excel and wants AI augmentation that doesn't break their models.

**Scope of "Claude Code":** the terminal CLI agent. We also reference its sibling product *Claude for Excel* (the Office.js add-in) where the workflow benefits from one or the other. They are different tools with different tradeoffs.

---

## TL;DR — what to do

1. **Pick the right surface for the work.** For exploratory analysis, audits, and model builds from scratch: **Claude Code with the official `xlsx` skill**. For interactive editing of an existing live workbook: the **Claude for Excel add-in**. For complex `.xlsm` production models with macros / named ranges / pivots: **xlwings driving live Excel** or stay in the add-in. Don't let Claude Code rewrite a complex `.xlsm` file with openpyxl — it silently corrupts.
2. **Install the canonical skills**: `xlsx`, `pptx`, `pdf`, `docx` from `github.com/anthropics/skills`. They cost ~90% fewer tokens than inline instructions and encode finance conventions.
3. **Always recalc.** openpyxl writes formulas as strings. Run `scripts/recalc.py` (LibreOffice headless) after every write, parse the JSON, fix any errors before declaring done.
4. **Treat workbooks as artifacts, not source of truth.** Version-control inputs as CSV/JSON, generate the workbook deterministically, and snapshot before/after with git or xltrail.
5. **For decks: validate visually.** Render to JPEG via `pdftoppm` and have a *subagent* review. AI-tells (centered body text, accent lines under titles, plain bullets) are the failure mode, not formula errors.
6. **For corporate finance specifically**: enforce industry color codes, 0.0% / parens / "-" formats, separate inputs from calcs from outputs, document every hardcode with a source citation.

---

## Surface comparison: where Claude Code fits

| Surface | What it is | Best for | Limits |
|---|---|---|---|
| **Claude Code (CLI)** | Terminal agent reading/writing files locally | Headless model builds, batch audits, repo-tracked workbooks, CI pipelines, generating decks/PDFs from data | Not in Excel — uses openpyxl/pandas, can corrupt `.xlsm` and complex `.xlsx` |
| **Claude for Excel (add-in)** | Office.js side panel inside Excel | Interactive Q&A on an open workbook, cell-level citations, safe in-place edits, live formula tracing | Pro+ subscription required; audit logs Enterprise-only; can't drive a CI pipeline |
| **Claude.ai chat with file upload** | Upload xlsx, get analysis | One-off analysis of a file you've been sent | No persistence, no formulas-as-formulas in output |
| **Claude API / Agent SDK** | Build your own integration | Custom flows: a finance agent that runs nightly, fits to your platform | You build the Excel I/O |

**Default for corporate-finance Claude Code work**: build inputs in CSV/JSON → Claude Code with `xlsx` skill produces the workbook → recalc → human audit → export PDF/PPT from the same artifact.

---

## The three mechanisms — Skill vs MCP vs Subagent

Claude Code's extension surface has three complementary pieces. Compose them.

| Mechanism | What | When to use for Excel |
|---|---|---|
| **Skill** (`.claude/skills/xlsx/SKILL.md` + scripts) | Procedural know-how loaded into context on demand | Encode the *how* of building/auditing models. ~90% token savings. **Default mechanism.** |
| **MCP server** | Live connection to external state/services | Live data feeds (FactSet, internal warehouses, Bloomberg), Excel COM bridge for live workbook control |
| **Subagent** | Specialized agent w/ own context + tool perms | Visual deck QA (fresh eyes), parallel sensitivity sweeps, isolating heavy file reads from main context |

**The default 2026 stack**: a Sonnet/Haiku subagent with the `xlsx` skill preloaded and a scoped MCP server for live data. Avoid the common mistake of using MCP for know-how that belongs in a skill.

---

## Library and tooling decision matrix

### File-format level (no Excel running)

| Library | Purpose | Strengths | Hard limits |
|---|---|---|---|
| **openpyxl** | Read/write `.xlsx` with formulas + formatting | Preserves simple formula trees, formatting, basic cells. Standard in `xlsx` skill. | **Silently corrupts** files with macros, named ranges, complex conditional formatting, pivots, charts. `data_only=True` + save = formulas permanently replaced with values. |
| **xlsxwriter** | Write new `.xlsx` | Faster than openpyxl, richer chart support, never corrupts because it's write-only | Cannot read or modify existing files |
| **pandas** | Tabular data I/O | Effortless DataFrame ↔ Excel | Drops formulas; not for model construction |
| **calamine / python-calamine** | Fast read | 5-30x faster reads of large files | Read-only |

### Live-Excel level (Excel must be running)

| Tool | Platform | Use for |
|---|---|---|
| **xlwings** | Win/Mac via COM/AppleScript | Safest for production `.xlsm` models — drives live Excel, preserves everything. Free. |
| **PyXLL** | Windows, embedded in Excel | When end-users need Python UDFs in Excel. Commercial. |
| **Office Scripts** | Excel Web/M365, TypeScript | Cloud automation via Power Automate; sandboxed, no machine access. Cannot run offline. |
| **VBA** | Win/Mac desktop | Legacy, full feature coverage, runs offline. Macros are the only path for some old workbooks. |
| **Office.js add-ins** | All Excel surfaces | What "Claude for Excel" itself is built on |

### Selection rule for Claude Code

```
Is the file a simple .xlsx without macros, named ranges, or pivots?
├─ Yes → openpyxl (xlsx skill default). Always recalc.py after.
└─ No  → Excel installed locally?
        ├─ Yes → xlwings (Claude Code shells out to xlwings scripts)
        └─ No  → Don't mutate the file. Either:
                  • Read with openpyxl(read_only=True, data_only=True), build a fresh
                    workbook from scratch with openpyxl/xlsxwriter
                  • Drive via Office Scripts (cloud) or use the Claude for Excel add-in
```

---

## The xlsx skill — what's inside, how to use it

Source: `github.com/anthropics/skills/blob/main/skills/xlsx/SKILL.md`

### Tool selection (canonical)
- **pandas** for analysis, bulk ops, simple data export
- **openpyxl** for formulas, formatting, Excel-specific features
- Always use **Excel formulas, never hardcoded values calculated in Python** — keeps the model dynamic

### The recalc loop (mandatory after every write)

```bash
python scripts/recalc.py output.xlsx [timeout_seconds]
```

Internally this:
1. Auto-installs a LibreOffice StarBasic macro `RecalculateAndSave` on first run
2. Calls `soffice --headless` to open the file, run `ThisComponent.calculateAll()`, save, close
3. Scans every cell for `#REF!`, `#DIV/0!`, `#VALUE!`, `#N/A`, `#NAME?`
4. Returns JSON with `status`, `total_errors`, `total_formulas`, `error_summary` keyed by error type

**Workflow Claude Code follows:**
```
write → recalc → if errors_found: fix specific cells → recalc → repeat
```

LibreOffice is a hard dependency. CI/sandbox environments need it pre-installed.

### LibreOffice ≠ Excel calc engine — known divergences
- Some recent Excel-only functions (`LET`, `LAMBDA`, `CHOOSECOLS`, `TEXTSPLIT`, dynamic-array spills) calc differently or not at all
- Iterative calc convergence can differ on circular references
- 1900 vs 1904 date systems
- For fidelity-critical deliverables, recalc with LibreOffice but **always open in Excel before sending to a counterparty**.

### Formatting standards the skill enforces

These are baked in because they're investment-banking and FP&A standard:

**Color coding (RGB):**
- Blue `0,0,255` — hardcoded inputs (assumptions users will change)
- Black `0,0,0` — all formulas and calculations
- Green `0,128,0` — links from other worksheets in same workbook
- Red `255,0,0` — links to external files
- Yellow background `255,255,0` — key assumptions / cells needing attention

**Number formats:**
- Years as text strings: `"2024"` not `2,024`
- Currency: `$#,##0` with units in headers (`Revenue ($mm)`)
- Zeros render as `-`: `$#,##0;($#,##0);-`
- Percentages: `0.0%` (one decimal)
- Multiples: `0.0x` (EV/EBITDA, P/E)
- Negatives in parens `(123)` not `-123`

**Formula construction:**
- All assumptions in dedicated cells, never hardcoded mid-formula
- `=B5*(1+$B$6)` not `=B5*1.05`
- Hardcodes documented inline: `"Source: Company 10-K, FY2024, Page 45, Revenue Note, [SEC EDGAR URL]"`

### Verification checklist the skill embeds

- Test 2-3 sample references before building the full model
- Confirm column mapping (column 64 = BL, not BK)
- Remember Excel rows are 1-indexed (DataFrame row 5 = Excel row 6)
- Check denominators before division (`#DIV/0!`)
- Verify all references point to intended cells (`#REF!`)
- Cross-sheet refs use `Sheet1!A1` format
- Test edge cases: zero, negative, very large

---

## Pitfalls and failure modes (read this first)

### 1. openpyxl corrupts complex Excel files — **silently**

Reported in `anthropics/claude-code` issue #22044, closed "not planned". When openpyxl writes back a file with any of:
- VBA macros (`.xlsm`)
- Named ranges (e.g. `model`, `row_match`, `annual`)
- Complex conditional formatting
- Pivot tables, charts, slicers
- External links

…it silently strips/breaks them. Excel later prompts: *"We found a problem with some content. Do you want us to try to recover as much as we can?"* The recalc step won't catch this — it only checks for formula errors, not file structure damage.

**Mitigations:**
- Never mutate `.xlsm` with openpyxl
- For complex `.xlsx` with named ranges/pivots: use xlwings to drive live Excel, or the Claude for Excel add-in, or refuse to mutate
- If openpyxl is the only option, treat as read-only and rebuild outputs as a fresh workbook
- Always `git diff`/xltrail-diff before delivery; commit pre-AI snapshot first

### 2. `data_only=True` + save is destructive

```python
# ❌ This permanently replaces formulas with their cached values
wb = load_workbook("model.xlsx", data_only=True)
wb["Inputs"]["B5"] = 0.05
wb.save("model.xlsx")  # formulas everywhere else are now constants
```

`data_only=True` is for *reading the cached value*, not for round-tripping. Open without it (or with explicit `data_only=False`) when you intend to save.

### 3. `keep_vba=True` preserves but doesn't make VBA editable

You can read `.xlsm` and keep the VBA stream intact, but openpyxl can't *modify* the VBA. Edits to the VBA require Excel itself or a `.bas` round-trip via xlwings.

### 4. Hardcoding Python-computed values into the workbook

The most common Claude Code anti-pattern. The model becomes static and the user can't change an input and see the effect. The xlsx skill explicitly forbids it. Always emit `=SUM(B2:B9)`, never `sheet["B10"] = df["Sales"].sum()`.

### 5. Pivot tables and charts

openpyxl's pivot table support is basically read-and-corrupt. If your deliverable needs pivots, either:
- Build the pivot in xlsxwriter (write-only, supports pivots)
- Pre-compute equivalent crosstabs in pandas and write as a regular table
- Drive live Excel via xlwings/Office.js

### 6. PowerPoint AI-tells

The `pptx` skill explicitly warns about giveaways:
- **Accent lines under titles** — hallmark of AI-generated slides
- Centered body text (only titles should center)
- Plain bullets on white background — every slide needs an image, chart, icon, or shape
- Defaulting to blue — pick a topic-specific palette
- Same layout repeated — vary cards, columns, callouts

### 7. PDF Unicode subscript/superscript renders as black boxes

ReportLab's built-in fonts don't include Unicode `₂` or `²`. They render as solid black boxes. Use `<sub>` and `<super>` XML tags in Paragraph objects:

```python
chemical = Paragraph("H<sub>2</sub>O", styles['Normal'])  # ✓
chemical = Paragraph("H₂O", styles['Normal'])             # ✗ black box
```

### 8. docx-js defaults to A4, not US Letter

Always set page size explicitly when generating Word docs for US audiences:
```javascript
size: { width: 12240, height: 15840 }  // Letter in DXA
```

### 9. Enterprise audit gap

Claude for Excel's OTEL/audit telemetry is Enterprise-tier only. Pro/Team/Max users get **no audit log** of what Claude did to which workbook — a problem for SOX-relevant work. Mitigation: snapshot workbooks in git or xltrail before/after each AI session.

### 10. Skills only work where they're loaded

A `.claude/skills/xlsx` in a repo doesn't help when an analyst opens a workbook in the Excel add-in unless they've also synced skills to their Claude account. Treat skills as a per-environment install, not a one-time setup.

---

## Recommended workflow patterns

### Pattern A: Build a 3-statement model from scratch

```
1. Inputs as CSV (revenue line items, growth rates, opex %, capex schedule, debt
   schedule, tax rate, working capital ratios) — checked into git
2. Claude Code session:
   - Skill: xlsx
   - Prompt: "Build a 3-statement model in `model.xlsx` from inputs/*.csv.
     Sheets: Inputs, IS, BS, CF, Summary. Use industry color codes. 5-year forecast.
     Assumptions cells must drive all forecasts. Document every hardcode with a CSV source."
3. Claude writes openpyxl code, saves, runs recalc.py
4. Claude inspects JSON; if errors, fixes specific cells, re-recalcs
5. Human audit pass — open in Excel, run sanity checks
6. Commit model.xlsx (and the openpyxl build script) to git
```

Why this works: the model is reproducible. Change an input CSV, re-run, get a new model. The build script *is* the audit trail.

### Pattern B: Audit an existing model

Use the **Claude for Excel add-in** for this when possible — it gives cell-level citations and won't corrupt the file. If you must use Claude Code:

```
1. Read-only inspect: load_workbook(path, data_only=True, read_only=True)
2. Claude generates an audit report (markdown) covering:
   - Formula consistency across columns
   - Off-by-one errors
   - Hard-coded values in formula cells (anti-pattern)
   - Circular references
   - #REF!/#DIV/0!/etc. that survived
   - Tabs that don't tie out (BS doesn't balance, CF doesn't reconcile to BS)
3. Claude proposes fixes as a *patch* — never directly mutates the file
4. Human applies fixes manually in Excel, OR uses xlwings to apply
```

The 30-prompts audit pack from The AI Corner is a useful starting set.

### Pattern C: Generate a pitchbook (Excel + PPT + PDF chain)

Anthropic's "Pitch builder" template structure:
```
1. Inputs: target company ticker, comp set, deal type
2. Claude Code → xlsx skill → comps_model.xlsx
   - Public comps tab: trading multiples (EV/EBITDA, P/E, EV/Revenue)
   - Precedent transactions tab
   - DCF tab (optional)
   - Football field tab — chart of valuation ranges
3. Claude Code → pptx skill → pitchbook.pptx
   - Cover, TOC, Bank intro, Market overview, Valuation, Recommendation, Team
   - Chart-driven (avoid AI-tells)
   - Embed/link Excel charts where appropriate
4. pdf skill → pitchbook.pdf for distribution
5. docx skill → cover_note.docx with tracked changes
```

The `pptx` skill mandates a visual QA loop with a subagent before declaring done.

### Pattern D: Month-end close / GL reconciliation

For repetitive work, save as a Skill:
```
.claude/skills/month-end-close/
├── SKILL.md          # describes the procedure
├── reconcile.py       # tie GL extract to subledgers
├── close_pkg.py       # generates close package PDF
└── README.md          # variances must be explained, exceptions listed
```

Anthropic's "Month-end closer" template provides the starting point.

### Pattern E: Driving live Excel via xlwings (the safe path for complex models)

```python
# scripts/update_inputs.py — Claude Code shells out to this
import xlwings as xw

wb = xw.Book("Model.xlsm")  # opens running Excel — preserves macros, names, pivots
wb.sheets["Inputs"].range("B5").value = 0.05  # safe edit
wb.app.calculate()
wb.save()
wb.close()
```

`xlwings` requires Excel installed locally. It's the *only* safe path for production `.xlsm` files. Claude Code can write and execute xlwings scripts.

---

## Best-practice checklist for corporate-finance Claude Code

### Before the session
- [ ] Workbook (or its inputs) committed to git/xltrail. Snapshot pre-AI state.
- [ ] Skills installed: `xlsx`, `pptx`, `pdf`, `docx`. Validate with `/validate-skill` if available.
- [ ] LibreOffice installed on the box that will run recalc.
- [ ] If `.xlsm` or has named ranges/pivots: confirm using xlwings/add-in path, not openpyxl.

### During build
- [ ] Inputs separated from calcs separated from outputs (3-tab minimum)
- [ ] All assumptions in dedicated cells with blue font
- [ ] No hardcoded numbers inside formulas
- [ ] Years as text, percentages 0.0%, zeros render as "-", negatives in parens
- [ ] Source citation comment on every hardcode
- [ ] Cross-sheet refs use green font; external links use red

### Post-build
- [ ] `python scripts/recalc.py output.xlsx` returns `"status": "success"`
- [ ] Model opens cleanly in real Excel (not just LibreOffice)
- [ ] BS balances; CF reconciles to BS; tax shield ties; debt schedule self-consistent
- [ ] Edge-case inputs tested (zero rev, negative growth, 100% margins)
- [ ] git commit with a clean diff (xltrail if `.xlsx` is binary in your repo)

### For decks / PDFs
- [ ] Visual QA via subagent on rendered JPEGs — *assume there are problems*
- [ ] No accent lines under titles, no centered body text
- [ ] Every slide has a visual element (chart, icon, image)
- [ ] Topic-specific color palette (not default blue)
- [ ] Source footers on every chart and stat

---

## Tooling install (Linux/macOS reference)

```bash
# Python deps
pip install openpyxl xlsxwriter pandas pypdf pdfplumber reportlab "markitdown[pptx]"
pip install xlwings  # only if Excel is installed locally
pip install python-pptx  # alternative to pptxgenjs

# Node deps
npm install -g pptxgenjs docx

# System deps
# Linux:
apt-get install libreoffice poppler-utils qpdf
# macOS:
brew install libreoffice poppler qpdf

# Anthropic skills (canonical)
git clone https://github.com/anthropics/skills.git ~/.claude/skills-anthropic
ln -s ~/.claude/skills-anthropic/skills/xlsx ~/.claude/skills/xlsx
ln -s ~/.claude/skills-anthropic/skills/pptx ~/.claude/skills/pptx
ln -s ~/.claude/skills-anthropic/skills/pdf  ~/.claude/skills/pdf
ln -s ~/.claude/skills-anthropic/skills/docx ~/.claude/skills/docx
```

For an MCP path:
```bash
# Most popular Excel MCP server (no Excel install needed)
pip install excel-mcp-server  # haris-musa
# Configure in .claude/settings.json or ~/.claude/mcp.json
```

---

## When to use Claude Code vs Claude for Excel

| Scenario | Claude Code | Claude for Excel add-in |
|---|---|---|
| Build a model from a template + inputs | ✓ best | ok |
| Audit an existing complex model | ok (read-only) | ✓ best — cell-level citations |
| Mutate an `.xlsm` with macros and named ranges | ✗ avoid (will corrupt) | ✓ best |
| Run a nightly close / batch process | ✓ best | ✗ no headless mode |
| Generate a deck + PDF from the model | ✓ best | partial — needs Shared Context (March 2026) |
| Cell-by-cell live Q&A | ✗ no | ✓ best |
| CI/test pipeline checking model integrity | ✓ best | ✗ |
| Live data feed integration (FactSet, Capital IQ) | possible via MCP | ✓ built-in connectors |
| Audit telemetry to SIEM | requires custom logging | Enterprise-only |

**Combination is the right answer for most teams**: Claude Code for builds, audits, batch jobs, and downstream artifacts; the Excel add-in for the analyst's interactive editing session.

---

## The 10 Anthropic finance agent templates (May 2026)

Each ships as a Claude Cowork plugin, a Claude Code plugin, and a Managed Agents cookbook. Use them as starting points; customize for your firm's data and policies.

**Research / coverage:**
- **Pitch builder** — comps Excel + pitchbook PPTX + Outlook cover note
- **Meeting preparer** — pre-reads, briefing books
- **Earnings reviewer** — earnings call analysis vs. consensus
- **Model builder** — reads filings + builds 3-statement
- **Market researcher** — industry/company research

**Finance / ops:**
- **Valuation reviewer** — checks vs. comparables, methodology, firm review standards
- **GL reconciler** — ties subledgers to GL
- **Month-end closer** — close package + variance commentary
- **Statement auditor** — controls testing
- **KYC screener** — onboarding due diligence

These templates are the fastest path to production for the matching workflows. Read the cookbook before customizing.

---

## Failure-mode summary table

| Failure | Surface | Detection | Fix |
|---|---|---|---|
| Silent file corruption (named ranges/pivots/macros stripped) | openpyxl write | Excel "needs repair" prompt; xltrail diff | Use xlwings or add-in for complex files |
| Formulas overwritten with values | `data_only=True` + save | Formula cells now numeric | Rebuild from pre-AI snapshot |
| Hardcoded computed values | Claude wrote `df.sum()` to a cell | Manual review; static cell where formula expected | Re-prompt; enforce skill convention |
| #REF! / #DIV/0! after recalc | recalc.py JSON | recalc.py error_summary | Fix indicated cells, re-recalc |
| LibreOffice ≠ Excel calc divergence | LET/LAMBDA/dynamic arrays | Open in Excel, compare | Avoid the divergent functions or recalc in Excel |
| Deck looks AI-generated | pptx output | Subagent visual QA | Remove accent lines, vary layouts, add visuals |
| Black box subscripts | reportlab PDF | Visual inspection | Use `<sub>`/`<super>` XML, not Unicode |
| docx Letter-sized doc came out A4 | docx-js default | Page check | Set explicit `size` |
| Pro/Team has no Claude-for-Excel audit log | Enterprise tier gap | n/a | git/xltrail snapshots, separate change log |

---

## References

### Anthropic canonical sources
- [xlsx skill](https://github.com/anthropics/skills/blob/main/skills/xlsx/SKILL.md) — full xlsx skill spec
- [pptx skill](https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md) — slide design + QA loop
- [pdf skill](https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md) — pypdf/pdfplumber/reportlab
- [docx skill](https://github.com/anthropics/skills/blob/main/skills/docx/SKILL.md) — docx-js + tracked changes
- [Financial applications cookbook](https://platform.claude.com/cookbook/skills-notebooks-02-skills-financial-applications)
- [Use Claude for Excel](https://support.claude.com/en/articles/12650343-use-claude-for-excel) — add-in docs
- [Advancing Claude for Financial Services](https://www.anthropic.com/news/advancing-claude-for-financial-services) — May 2026 announcement
- [Agents for financial services](https://www.anthropic.com/news/finance-agents) — 10 templates
- [Skills explained](https://claude.com/blog/skills-explained) — skills vs MCP vs subagents

### Critical bug report
- [Issue #22044: xlsx skill should warn about openpyxl corrupting complex Excel files](https://github.com/anthropics/claude-code/issues/22044)

### Library docs
- [openpyxl](https://openpyxl.readthedocs.io/)
- [xlsxwriter](https://xlsxwriter.readthedocs.io/)
- [xlwings](https://www.xlwings.org/)
- [Office Scripts vs VBA](https://learn.microsoft.com/en-us/office/dev/scripts/resources/vba-differences)
- [PptxGenJS](https://gitbrent.github.io/PptxGenJS/)
- [python-pptx](https://python-pptx.readthedocs.io/)

### MCP servers for Excel
- [haris-musa/excel-mcp-server](https://github.com/haris-musa/excel-mcp-server) — most popular, openpyxl-based
- [bassem-elsodany/mcp_excel_server](https://github.com/bassem-elsodany/mcp_excel_server)
- [jonemo/openpyxl-mcp-server](https://github.com/jonemo/openpyxl-mcp-server)
- [mort-lab/excel-mcp](https://github.com/mort-lab/excel-mcp)

### Corporate finance modeling standards
- [FAST Modelling Standard](https://www.fast-standard.org/)
- [SMART Modelling Standard](https://www.smartmethod.co.uk/)
- [ICAEW Financial Modelling Code](https://www.icaew.com/-/media/corporate/files/technical/technology/excel/financial-modelling-code.ashx)
- [CFI Financial Modeling guidelines](https://corporatefinanceinstitute.com/resources/financial-modeling/free-financial-modeling-guide/)
- [Macabacus financial modeling guide](https://macabacus.com/blog/financial-modeling-excel)

### Practitioner write-ups
- [Claude in Excel: 30 Prompts to Audit Any Financial Model](https://www.the-ai-corner.com/p/claude-excel-spreadsheets)
- [11-tab financial model in 10 minutes (Nate's Newsletter)](https://natesnewsletter.substack.com/p/anthropic-just-put-claude-inside)
- [Building a Financial Model with AI (SumProduct)](https://sumproduct.com/blog/ai-blog-building-a-financial-model-with-ai-what-really-happens-when-you-let-claude-do-the-work/)
- [tfriedel/claude-office-skills](https://github.com/tfriedel/claude-office-skills) — community skill bundle

### Version control for Excel
- [xltrail](https://www.xltrail.com/) — git for Excel workbooks (semantic diff for cells/formulas/VBA)

### Related prior work in this repo
- `applescript-research/` — AppleScript automation for Mac Excel
- `cli-tools-for-ai-agents/` — design principles for agent-friendly CLIs
- `ai-bi-json-render-pattern/` — governed structured-output pattern (parallel to the skills approach)

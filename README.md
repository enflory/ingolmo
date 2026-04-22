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

[[[cog
import cog, pathlib, subprocess

def last_commit_date(d):
    r = subprocess.run(
        ["git", "log", "-1", "--format=%ct", "--", str(d)],
        capture_output=True, text=True,
    )
    return int(r.stdout.strip() or "0")

dirs = sorted(
    [
        d for d in pathlib.Path(".").iterdir()
        if d.is_dir()
        and not d.name.startswith(".")
        and (d / "README.md").exists()
    ],
    key=last_commit_date,
    reverse=True,
)

cog.outl(f'*{len(dirs)} project{"s" if len(dirs) != 1 else ""}*\n')

for d in dirs:
    readme_text = (d / "README.md").read_text()
    if "<!-- not-ai-generated -->" in readme_text:
        continue
    summary_file = d / "_summary.md"
    if not summary_file.exists():
        prompt = (
            "Summarize this research project concisely. Write 1 paragraph "
            "(3-5 sentences). Vary your opening — do not start with 'This report' "
            "or 'This research'. Be specific but brief. No emoji.\n\n"
            + readme_text
        )
        result = subprocess.run(
            ["llm", "-m", "github/gpt-4.1", prompt],
            capture_output=True, text=True, check=True,
        )
        summary_file.write_text(result.stdout.strip())
    cog.outl(f'### [{d.name}]({d.name}/README.md)\n')
    cog.outl(summary_file.read_text().strip() + "\n")
]]]
[[[end]]]

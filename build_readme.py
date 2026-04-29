#!/usr/bin/env python3
"""Regenerates the Projects section in README.md."""
import os
import pathlib
import subprocess

MARKER_START = "<!-- projects-start -->"
MARKER_END = "<!-- projects-end -->"


def last_commit_date(d):
    r = subprocess.run(
        ["git", "log", "-1", "--format=%ct", "--", str(d)],
        capture_output=True, text=True,
    )
    return int(r.stdout.strip() or "0")



def generate_summary(readme_text):
    prompt = (
        "Summarize this research project concisely. Write 1 paragraph "
        "(3-5 sentences). Vary your opening — do not start with 'This report' "
        "or 'This research'. Be specific but brief. No emoji.\n\n"
        + readme_text
    )
    env = os.environ.copy()
    if "GITHUB_MODELS_KEY" not in env and "GITHUB_TOKEN" in env:
        env["GITHUB_MODELS_KEY"] = env["GITHUB_TOKEN"]
    try:
        result = subprocess.run(
            ["llm", "-m", "github/gpt-4.1", prompt],
            capture_output=True,
            text=True,
            check=True,
            env=env,
        )
    except subprocess.CalledProcessError as e:
        details = (e.stderr or e.stdout or str(e)).strip()
        raise RuntimeError(f"llm summary generation failed: {details}") from e
    return result.stdout.strip()


def main():
    root = pathlib.Path(".")
    dirs = sorted(
        [
            d for d in root.iterdir()
            if d.is_dir()
            and not d.name.startswith(".")
            and (d / "README.md").exists()
        ],
        key=last_commit_date,
        reverse=True,
    )

    entries = []
    for d in dirs:
        readme_text = (d / "README.md").read_text()
        if "not-ai-generated" in readme_text:
            continue
        summary_file = d / "_summary.md"
        if not summary_file.exists():
            summary_file.write_text(generate_summary(readme_text))
        entries.append(f'### [{d.name}]({d.name}/README.md)\n')
        entries.append(summary_file.read_text().strip() + "\n")

    n = len(entries) // 2
    lines = [f'*{n} project{"s" if n != 1 else ""}*\n'] + entries
    new_content = "\n".join(lines)

    readme_path = root / "README.md"
    readme = readme_path.read_text()
    start_idx = readme.index(MARKER_START) + len(MARKER_START)
    end_idx = readme.index(MARKER_END)
    readme_path.write_text(readme[:start_idx] + "\n\n" + new_content + "\n" + readme[end_idx:])


if __name__ == "__main__":
    main()

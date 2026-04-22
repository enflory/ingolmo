# Agent instructions for ingolmo

This is a personal research repo. When working here, follow the conventions below.

## Starting a new research thread

Create a top-level directory with a short, descriptive name (kebab-case). Do not nest it under any existing directory.

## During investigation

Create `notes.md` inside your directory and **append to it continuously** as you work — what you tried, what you found, dead ends, surprises. Write as you go; do not reconstruct the log at the end.

## At the end

Write a `README.md` inside the directory: a structured final report of what you investigated and what you found. This is the artifact meant to be reused. Write it clearly enough that another agent reading it cold can pick up from here without re-reading `notes.md`.

## Final commit

Include:
- `notes.md` and `README.md`
- Any code you wrote
- If you modified an existing repo: a `git diff` output saved as a file, not a full copy of the repo
- Binary files under 2MB if they aid understanding

Do **not** include full copies of fetched repositories or large downloaded assets.

Do **not** create a `_summary.md` file — these are added automatically.

## Reusing prior work

Before starting, scan existing directories for related prior work. If a relevant thread exists, link to it from your `notes.md` and build on it rather than re-deriving from scratch. This is the main reason the repo exists.

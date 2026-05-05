# README update token-limit failure notes

## 2026-05-05

- Task: the latest GitHub Actions run of `update-readme.yml` failed because one of
  the per-project READMEs being summarized exceeded 8000 tokens. Make
  `build_readme.py` not fail in that case.
- Scanned the repo for prior related work. Found `readme-update-ci-failure/` from
  2026-04-29: it diagnosed an earlier failure (missing `models: read`, hidden
  stderr) and added `tests/test_readme_automation.py`. Building on top of that.
- `build_readme.py` calls `llm -m github/gpt-4.1` with the full README text in
  the prompt. GitHub Models' free tier caps a single request's input at ~8000
  tokens (per GitHub Models docs). For longer READMEs the call fails before the
  workflow gets to commit anything.
- Sized every project README:
  ```
  $ wc -c */README.md | sort -n
  ...
  26085 cli-agent-harness-survey/README.md
  26714 memory-architectures-2026/README.md
  36703 standalone-memory-tools-survey-2026/README.md
  ```
  At a conservative ~3 chars/token, the longest one is ~12k tokens — well over
  the 8000 token limit. That matches the user's description of the failure.
- Plan: truncate the README before passing it to the LLM. Budget:
  - 8000 token request cap
  - ~100 tokens for the prompt prefix
  - ~500 tokens of output headroom
  - Stay conservative on chars/token (use 3) so we don't go over for English
    text with code blocks
  - Pick `MAX_README_CHARS = 20000` (~5000–6500 tokens depending on content),
    well under the cap and large enough that all but the two longest READMEs go
    in untouched.
- When truncation kicks in, append a short marker so the model knows the input
  is partial and doesn't try to summarize a non-existent conclusion. Keep the
  head of the file: research READMEs in this repo follow a top-down structure
  (title, abstract/short answer, evidence) so the head is the most informative
  region.
- Verified existing tests still describe what we want (push-only commit, models
  read, stderr exposure). Added a new test that asserts the prompt sent to
  `llm` is bounded — the LLM never sees more than `MAX_README_CHARS + small
  prefix/suffix`.
- Ran `python3 -m unittest tests/test_readme_automation.py` → 4 tests, all pass.
- Saved code changes as `git-diff.patch` per AGENTS.md convention.

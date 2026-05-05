# README Update Token-Limit Fix

Investigation date: 2026-05-05

## Question

The most recent `update-readme.yml` Actions run failed because one of the
per-project READMEs exceeded 8000 tokens when sent to GitHub Models. Make the
script tolerant of larger READMEs.

## Short Answer

`build_readme.py` was passing each project's `README.md` verbatim into a single
`llm -m github/gpt-4.1` call. GitHub Models' free tier caps a request at 8000
input tokens, and recent research-dive READMEs have grown well past that — at
~3 chars/token, `standalone-memory-tools-survey-2026/README.md` (36,703 chars)
is roughly 12,000 tokens.

The fix: truncate the README content before sending it to the model. The head
of each README contains the title, abstract / short answer, and key evidence,
which is what a one-paragraph summary needs anyway.

## What Changed

`build_readme.py`:

- Introduced a module-level constant `MAX_README_CHARS = 20000` (≈ 5,000–6,500
  tokens; well under the 8,000-token cap with room left for the prompt prefix
  and the model's response).
- In `generate_summary()`, truncate the input to `MAX_README_CHARS` and append
  a short `[... README truncated for length ...]` marker so the model knows the
  document is partial.

`tests/test_readme_automation.py`:

- Added `test_generate_summary_truncates_oversized_readme`: feeds in `2 ×
  MAX_README_CHARS` of content, asserts the prompt sent to `llm` stays within
  budget and contains the truncation marker.
- Updated the workflow-shape test (the previous assertion required a
  `pull_request:` trigger, but the maintainer intentionally removed that in
  commit `475e729` / PR #6; the assertion was stale and broke the suite). The
  remaining contract — `models: read` permission and push-only commit — is
  still asserted.

## Why 20,000 chars

Budget math (conservative, English text with code blocks):

| Item              | Tokens |
|-------------------|--------|
| Hard cap          | 8,000  |
| Prompt prefix     |   ~50  |
| Output headroom   |  ~500  |
| Safety margin     |  ~500  |
| **Content budget**| ~6,950 |

At 3 chars/token (worst case), 20,000 chars ≈ 6,500 tokens. At 4 chars/token
(typical), ≈ 5,000 tokens. Either way, comfortably inside the cap.

This leaves all but the two longest current READMEs untouched
(`memory-architectures-2026` at 26,714 chars and `standalone-memory-tools-survey-2026`
at 36,703 chars are the only ones over the threshold today).

## Verification

```
$ python3 -m unittest tests/test_readme_automation.py -v
test_generate_summary_allows_explicit_github_models_key ... ok
test_generate_summary_truncates_oversized_readme ... ok
test_generate_summary_uses_github_models_token_and_exposes_stderr ... ok
test_workflow_has_model_access_and_push_only_commit ... ok

Ran 4 tests in 0.003s

OK
```

## Files

- `notes.md` — running log of the investigation.
- `git-diff.patch` — code changes made on this branch.

## Related Prior Work

- `readme-update-ci-failure/` (2026-04-29) — earlier failure of the same
  workflow caused by missing `models: read` and hidden subprocess stderr. That
  thread set up `tests/test_readme_automation.py` and `generate_summary()`,
  which this thread builds on.

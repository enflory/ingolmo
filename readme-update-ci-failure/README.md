# README Update CI Failure

Investigation date: 2026-04-29

## Question

Why did the automation that is supposed to update the root `README.md` Projects section fail for the latest PR/commit?

## Short Answer

The latest failing run was triggered after PR #3 merged into `main` as commit `fd5721555edb1d2021f9dcbc4a461bcce366eeeb`. The automation found the new `realtime-api-low-latency-voice/README.md` project and tried to generate a `_summary.md` with `llm -m github/gpt-4.1`, but the LLM command exited with status 1 before the workflow reached the commit step.

There were two workflow issues:

1. The workflow did not run on PRs at all; it only ran on pushes to `main`.
2. The workflow token did not have GitHub Models access. The Actions log showed only `Contents: write` and `Metadata: read`, while `llm-github-models` documents `models: read` for Actions usage.

A smaller diagnosability issue made the failure harder to understand: `build_readme.py` captured the `llm` subprocess stderr and then let `CalledProcessError` hide it in the GitHub Actions traceback.

## Evidence

The relevant failing log is:

- `/Users/ethanflory/Downloads/logs_66793860680/update-readme/5_Build README.txt`

The failing step ran:

```text
python build_readme.py
```

The traceback failed at:

```text
subprocess.run(["llm", "-m", "github/gpt-4.1", prompt], capture_output=True, text=True, check=True)
```

Because stderr was captured, the log only showed `CalledProcessError` and the full prompt, not the underlying GitHub Models error.

The setup log showed the effective token permissions:

```text
Contents: write
Metadata: read
```

The workflow had:

```yaml
permissions:
  contents: write
```

It did not include:

```yaml
models: read
```

The `llm-github-models` README says Actions runners need `permissions: models: read` for `GITHUB_TOKEN` to have model access, and it documents `GITHUB_MODELS_KEY` or `GITHUB_TOKEN` as the token environment variables. GitHub's changelog also notes that GitHub Models access requires `models:read` for fine-grained tokens and GitHub Apps.

Sources:

- https://github.com/tonybaloney/llm-github-models
- https://github.blog/changelog/2025-05-15-modelsread-now-required-for-github-models-access/
- https://docs.github.com/en/actions/tutorials/authenticate-with-github_token

## What Changed

I updated `.github/workflows/update-readme.yml` to:

- Run on `pull_request` targeting `main` as well as pushes to `main`.
- Grant `models: read`.
- Pass `GITHUB_TOKEN` to the LLM step using the variable the plugin documents.
- Commit generated README changes only on push events, so PR runs validate generation without trying to push from PR context.

I updated `build_readme.py` to:

- Move top-level execution behind `main()` so it can be tested safely.
- Add `generate_summary()`.
- Map `GITHUB_TOKEN` to `GITHUB_MODELS_KEY` if an explicit models key is not already set.
- Raise a `RuntimeError` that includes subprocess stderr/stdout when summary generation fails.

I added `tests/test_readme_automation.py` to lock in:

- PR trigger and `models: read` permission.
- Push-only commit behavior.
- LLM stderr exposure.
- Correct GitHub Models token environment behavior.

## Verification

I first ran the new tests against the old code and saw the expected failures:

```text
FAILED (failures=1, errors=1)
```

After the fix:

```text
python3 -m unittest tests/test_readme_automation.py
...
Ran 3 tests in 0.001s

OK
```

## Remaining Note

The root `README.md` still says `*0 projects*` locally at the time of this investigation because I did not call GitHub Models from this machine. After this fix is committed and pushed, the next push to `main` should let the workflow generate summaries and commit the updated Projects section.

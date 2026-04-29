# README update CI failure notes

## 2026-04-29

- Started by scanning the repo for related prior research threads. Only the repo-level `README.md`, `AGENTS.md`, workflow, and script exist; no prior investigation directory was present.
- User-provided failing logs are in `/Users/ethanflory/Downloads/logs_66793860680/update-readme/`.
- The failing log is `5_Build README.txt`. The workflow ran `python build_readme.py`; inside that script, `subprocess.run(["llm", "-m", "github/gpt-4.1", prompt], check=True)` raised `CalledProcessError` with exit status 1.
- Important surprise: the traceback does not include `stderr` from the `llm` command because `build_readme.py` captures output and lets `CalledProcessError` print only the command. This hides the real provider/auth error in GitHub Actions.
- The workflow `.github/workflows/update-readme.yml` currently triggers only on `push` to `main`, not `pull_request`. If the expectation is "every commit or PR", the PR half is not wired.
- The workflow sets `LLM_GITHUB_MODELS_KEY: ${{ secrets.GITHUB_TOKEN }}`. Need verify whether the GitHub Models plugin accepts that variable with the Actions `GITHUB_TOKEN`, and whether the workflow needs explicit `models: read` permission.
- Fetched remote refs. The failing run was for `fd5721555edb1d2021f9dcbc4a461bcce366eeeb`, merge commit for PR #3 from `enflory/codex/openai-realtime`. That merge added `realtime-api-low-latency-voice/README.md` and `notes.md`; root `README.md` on `origin/main` still says `*0 projects*`.
- `llm-github-models` README says GitHub Actions usage requires `permissions: models: read`, and its token environment variable is `GITHUB_MODELS_KEY` or `GITHUB_TOKEN` fallback. The current workflow has neither `models: read` nor `GITHUB_TOKEN` in the LLM step; it uses `LLM_GITHUB_MODELS_KEY`, which is not what the plugin README documents.
- GitHub's Actions log confirms the generated `GITHUB_TOKEN` had only `Contents: write` and `Metadata: read`, matching the workflow's top-level permissions block.
- Wrote failing tests in `tests/test_readme_automation.py` before changing production files. `python3 -m unittest tests/test_readme_automation.py` fails because the workflow has no `pull_request`, no `models: read`, no push-only commit guard, and `build_readme.py` has no `generate_summary` helper that exposes stderr.
- Implemented the workflow/script fix and reran `python3 -m unittest tests/test_readme_automation.py`; the 3 tests now pass.
- Fast-forwarded local `main` to `origin/main` so the local worktree includes the PR #3 merge commit and its `realtime-api-low-latency-voice` directory. This confirms root `README.md` still says `*0 projects*` because the failed automation never committed the generated index.
- Wrote the final report in `readme-update-ci-failure/README.md`.
- Saved the code/workflow/test changes as `readme-update-ci-failure/git-diff.patch` per repo convention for modified existing repos.

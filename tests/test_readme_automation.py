import pathlib
import os
import subprocess
import unittest
from unittest import mock

import build_readme


ROOT = pathlib.Path(__file__).resolve().parents[1]


class ReadmeAutomationTests(unittest.TestCase):
    def test_workflow_has_model_access_and_push_only_commit(self):
        workflow = (ROOT / ".github" / "workflows" / "update-readme.yml").read_text()

        self.assertIn("models: read", workflow)
        self.assertIn("github.event_name == 'push'", workflow)

    def test_generate_summary_uses_github_models_token_and_exposes_stderr(self):
        failure = subprocess.CalledProcessError(
            1,
            ["llm"],
            output="",
            stderr="Unauthorized: missing models: read",
        )

        with mock.patch.dict(os.environ, {"GITHUB_TOKEN": "test-token"}, clear=True):
            with mock.patch("build_readme.subprocess.run", side_effect=failure) as run:
                with self.assertRaisesRegex(RuntimeError, "Unauthorized: missing models: read"):
                    build_readme.generate_summary("Project README")

        run.assert_called_once()
        _, kwargs = run.call_args
        self.assertEqual(kwargs["env"]["GITHUB_TOKEN"], "test-token")
        self.assertEqual(kwargs["env"]["GITHUB_MODELS_KEY"], "test-token")

    def test_generate_summary_allows_explicit_github_models_key(self):
        completed = subprocess.CompletedProcess(["llm"], 0, stdout="Useful summary\n", stderr="")

        with mock.patch.dict(os.environ, {"GITHUB_MODELS_KEY": "models-token"}, clear=True):
            with mock.patch("build_readme.subprocess.run", return_value=completed) as run:
                self.assertEqual(build_readme.generate_summary("Project README"), "Useful summary")

        _, kwargs = run.call_args
        self.assertEqual(kwargs["env"]["GITHUB_MODELS_KEY"], "models-token")
        self.assertNotIn("GITHUB_TOKEN", kwargs["env"])

    def test_generate_summary_truncates_oversized_readme(self):
        completed = subprocess.CompletedProcess(["llm"], 0, stdout="ok\n", stderr="")
        oversized = "x" * (build_readme.MAX_README_CHARS * 2)

        with mock.patch.dict(os.environ, {"GITHUB_MODELS_KEY": "k"}, clear=True):
            with mock.patch("build_readme.subprocess.run", return_value=completed) as run:
                build_readme.generate_summary(oversized)

        prompt = run.call_args.args[0][-1]
        self.assertLess(len(prompt), build_readme.MAX_README_CHARS + 500)
        self.assertIn("truncated", prompt)


if __name__ == "__main__":
    unittest.main()

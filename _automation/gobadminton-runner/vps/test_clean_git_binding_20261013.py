"""New clean Git-root binding regression; isolated, no live Github/host mutations."""
from __future__ import annotations
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import sys

try:
    import psutil
except ModuleNotFoundError:
    sys.modules["psutil"] = SimpleNamespace(
        Error=OSError, AccessDenied=OSError, NoSuchProcess=OSError,
        process_iter=lambda *a, **k: ())

import autopilot
import backlog_sync

ROOT = Path(__file__).resolve().parent
CLEAN = "anpavel84-afk/gobadminton-clean"
LEGACY = "anpavel84-afk/gobadminton"
REF = "f" * 40

class CleanGitBindingTests(unittest.TestCase):
    def test_clean_exact_sha_url_accepted(self):
        link = f"https://github.com/{CLEAN}/blob/{REF}/docs/README.md"
        parsed = backlog_sync.FULL_GITHUB_SOURCE.fullmatch(link)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.groups(), (REF, "docs/README.md"))

    def test_old_legacy_url_must_not_be_admissible(self):
        self.assertIsNone(backlog_sync.FULL_GITHUB_SOURCE.fullmatch(
            f"https://github.com/{LEGACY}/blob/{REF}/docs/README.md"))
        self.assertIsNone(backlog_sync.FULL_GITHUB_SOURCE.fullmatch(
            f"https://github.com/{LEGACY}-clean-evil/blob/{REF}/docs/README.md"))

    def test_unsafe_urls_rejected(self):
        for url in (
            f"http://github.com/{CLEAN}/blob/{REF}/docs/README.md",
            f"https://github.com/{CLEAN}/blob/main/docs/README.md",
            f"https://github.com/{CLEAN}/blob/{REF}/../secrets.txt",
            f"https://github.com/{CLEAN}/blob/{REF}/docs/README.md?ref=main",
        ):
            with self.subTest(url=url):
                self.assertIsNone(backlog_sync.FULL_GITHUB_SOURCE.fullmatch(url))

    def test_legacy_autopilot_git_remote_fail_closed_before_fetch(self):
        calls = []
        def read_only_git(args, cwd, timeout):
            calls.append(args)
            self.assertEqual(args[:3], ["git", "remote", "get-url"])
            return SimpleNamespace(returncode=0, stdout=f"git@github-gobadminton:{LEGACY}.git\n",stderr="")
        with patch.object(autopilot,"run",side_effect=read_only_git):
            ok, message = autopilot.ensure_worktree({"workspace":"/synthetic/clean"})
        self.assertFalse(ok)
        self.assertIn("not verified",message)
        self.assertEqual(len(calls),1)

    def test_clean_autopilot_remote_pin_present(self):
        import inspect
        body = inspect.getsource(autopilot.ensure_worktree)
        self.assertIn(f"git@github-gobadminton-clean:{CLEAN}.git",body)
        self.assertNotIn(f"git@github-gobadminton:{LEGACY}.git",body)

    def test_synthetic_fixture_uses_only_clean_immutable_source_urls(self):
        f = json.loads((ROOT/"friends_f1f5_dag_fixture_v001.json").read_text())
        self.assertEqual(len(f["tasks"]),8)
        for task in f["tasks"]:
            for field in ("source","admission"):
                with self.subTest(task=task["id"],field=field):
                    self.assertIsNotNone(backlog_sync.FULL_GITHUB_SOURCE.fullmatch(task[field]))
                    self.assertIn("/"+CLEAN+"/",task[field])
        self.assertFalse(f.get("prod_authorized",False))

    def test_clean_runtime_paths_are_not_legacy_runner_paths(self):
        from pathlib import Path
        roots = {
            "runner.py": ('/srv/gobadminton-clean/repo', '/srv/gobadminton-clean/worktrees'),
            "autopilot.py": ('/srv/gobadminton-clean/worktrees/pm-autopilot',),
            "backlog_sync.py": ('/srv/gobadminton-clean/repo', '/srv/gobadminton-clean/runner'),
            "control_agent.py": ('/srv/gobadminton-clean/runner',),
            "compact_pm_brief.py": ('/srv/gobadminton-clean/runner',),
        }
        for filename, paths in roots.items():
            content = (ROOT / filename).read_text()
            for path in paths:
                with self.subTest(filename=filename, path=path):
                    self.assertIn(path, content)
        self.assertNotIn('ROOT=Path("/srv/gobadminton-dev/runner")',
                         (ROOT/"control_agent.py").read_text())

    def test_clean_qa_and_writer_policy_paths_are_disjoint_from_legacy(self):
        import runner
        import writer_bridge
        self.assertEqual(str(runner.SOURCE_REVIEW_QA_ROOT),
                         "/var/lib/gobadminton-clean-trusted-qa-evidence")
        self.assertEqual(str(writer_bridge.ROOT_POLICY_PATH),
                         "/etc/gobadminton-clean-control-plane/v2-writer-bridge-policy.json")

if __name__=="__main__":
    unittest.main()

"""A live protected Clean PM does not masquerade as a generic exempt writer."""
import copy
import stat
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, MagicMock, patch

import runner


class CleanManagedPlanner(unittest.TestCase):
    def setUp(self):
        self.cfg = {"project_repo": "anpavel84-afk/gobadminton-clean",
                    "workspace": "/srv/gobadminton-clean/repo"}
        self.args = ["/home/agentagency-dev/.local/bin/codex", "exec",
                     "--disable", "apps", "--disable", "remote_plugin",
                     "--disable", "hooks", "--ignore-user-config", "-c",
                     "apps._default.enabled=false", "-C",
                     "/srv/gobadminton-clean/worktrees/pm-autopilot", "--approve-for-me",
                     "--output-last-message", "/srv/gobadminton-clean/runner/autopilot-receipt.json",
                     "--model", "gpt-6.1-sol", "-c", 'model_reasoning_effort="high"', "prompt"]
        self.ap = Mock(pid=100)
        self.ap.cmdline.return_value = ["/usr/bin/python3", "-E", "-s", "-B",
            "/opt/gobadminton-clean/runner-code/current/autopilot.py"]
        self.pm = Mock(pid=200)
        self.pm.cmdline.return_value = self.args
        self.pm.parents.return_value = [self.ap]
        self.child = Mock(pid=300)
        self.child.parents.return_value = [self.pm, self.ap]
        for p in (self.ap, self.pm, self.child):
            p.uids.return_value = SimpleNamespace(real=1002)
            p.cwd.return_value = "/srv/gobadminton-clean/worktrees/pm-autopilot"
        self.state = {"pid": 100, "planner_pid": 200, "status": "planning"}
        self.source = Path("/opt/gobadminton-clean/runner-code/accepted/autopilot.py")
        self.addCleanup(patch.stopall)
        patch.object(runner, "_clean_pm_source", return_value=self.source).start()
        patch.object(runner, "_clean_pm_state", side_effect=lambda: self.state).start()
        self.group = patch.object(runner, "_clean_pm_cgroup", return_value=True).start()
        patch("pwd.getpwnam", return_value=SimpleNamespace(pw_uid=1002)).start()

    def check(self, process=None):
        # The working directory resolution remains exact; the immutable script
        # resolves through the installed current pointer to its protected source.
        with patch.object(Path, "resolve", autospec=True, side_effect=lambda path, **kw:
                self.source if str(path).replace("\\", "/").endswith("current/autopilot.py") else path):
            return runner.managed_pm_planner(process or self.child, self.cfg)

    def test_protected_live_planner_and_helper_are_exempt(self):
        self.assertTrue(self.check())
        self.assertTrue(self.check(self.pm))

    def test_foreign_uid_cgroup_or_unbound_pid_is_not_exempt(self):
        self.child.uids.return_value = SimpleNamespace(real=985)
        self.assertFalse(self.check())
        self.child.uids.return_value = SimpleNamespace(real=1002)
        self.group.return_value = False
        self.assertFalse(self.check())
        self.group.return_value = True
        for key, value in (("pid", 999), ("planner_pid", 999), ("planner_pid", True),
                           ("status", "owner_instruction_backoff")):
            old = self.state[key]
            self.state[key] = value
            self.assertFalse(self.check())
            self.state[key] = old

    def test_spoofed_source_path_and_parent_ancestry_are_not_exempt(self):
        self.ap.cmdline.return_value[-1] = "/tmp/autopilot.py"
        self.assertFalse(self.check())
        self.ap.cmdline.return_value[-1] = "/opt/gobadminton-clean/runner-code/current/autopilot.py"
        self.pm.parents.return_value = []
        self.assertFalse(self.check())

    def test_unsafe_flags_and_sibling_worktree_are_not_exempt(self):
        for extra in (["--add-dir", "/srv"], ["--enable", "hooks"],
                      ["-cfeatures.hooks=true"], ["-punsafe"],
                      ["--sandbox", "danger-full-access"]):
            self.pm.cmdline.return_value = self.args + extra
            self.assertFalse(self.check())
        self.pm.cmdline.return_value = self.args
        for token in ("--ignore-user-config", "apps._default.enabled=false"):
            self.pm.cmdline.return_value = [a for a in self.args if a != token]
            self.assertFalse(self.check())
        changed = copy.copy(self.args)
        changed[changed.index("-C") + 1] = "/srv/gobadminton-clean/worktrees/runner-friends"
        self.pm.cmdline.return_value = changed
        self.assertFalse(self.check())

    def test_unprotected_source_or_state_fails_closed(self):
        for helper in ("_clean_pm_source", "_clean_pm_state"):
            with patch.object(runner, helper, side_effect=ValueError("not root protected")):
                self.assertFalse(self.check())


class CleanProtectedSource(unittest.TestCase):
    def test_service_owned_state_requires_root_pinned_group_and_stable_snapshot(self):
        data = b'{"pid":100,"planner_pid":200,"status":"planning"}'
        file_info = SimpleNamespace(st_uid=1002, st_gid=978, st_nlink=1,
            st_mode=stat.S_IFREG | 0o640, st_size=len(data), st_dev=1, st_ino=2,
            st_mtime_ns=1, st_ctime_ns=1)
        directory = SimpleNamespace(st_uid=1002, st_gid=978, st_mode=stat.S_IFDIR | 0o2770)
        stream = MagicMock()
        stream.__enter__.return_value = stream
        stream.read.return_value = data
        with patch.object(runner.clean_runtime_access, "policy", return_value={
                "submitter_uid": 1002, "runtime_gid": 978}), patch.object(
                runner.clean_runtime_access, "directory_allowed", return_value=True), patch.object(
                runner.os, "open", return_value=99), patch.object(
                runner.os, "fdopen", return_value=stream), patch.object(
                runner.os, "fstat", return_value=file_info), patch.object(
                Path, "lstat", autospec=True) as metadata:
            metadata.side_effect = lambda p: file_info if p.name == "autopilot-state.json" else directory
            self.assertEqual(runner._clean_pm_state()["planner_pid"], 200)
            for field, bad in (("st_uid", 0), ("st_gid", 0), ("st_nlink", 2),
                               ("st_mode", stat.S_IFREG | 0o660)):
                original = getattr(file_info, field)
                setattr(file_info, field, bad)
                with self.subTest(field=field), self.assertRaises(ValueError):
                    runner._clean_pm_state()
                setattr(file_info, field, original)
            with patch.object(runner.clean_runtime_access, "directory_allowed", return_value=False):
                with self.assertRaises(ValueError):
                    runner._clean_pm_state()
            stale = copy.copy(file_info)
            stale.st_ino = 999
            with patch.object(runner.os, "fstat", side_effect=[file_info, stale]):
                with self.assertRaises(ValueError):
                    runner._clean_pm_state()

    def test_exact_clean_cgroup_and_no_similar_or_legacy_group(self):
        process = SimpleNamespace(pid=123)
        for group, expected in (("/system.slice/gobadminton-clean-autopilot.service", True),
                ("/system.slice/gobadminton-autopilot.service", False),
                ("/other/system.slice/gobadminton-clean-autopilot.service", False),
                ("/system.slice/gobadminton-clean-autopilot.service/foreign", False)):
            with self.subTest(group=group), patch.object(Path, "read_text", return_value="0::" + group):
                self.assertEqual(runner._clean_pm_cgroup(process), expected)

    def test_release_pointer_owner_escape_and_writable_ancestry_refused(self):
        source = Path("/opt/gobadminton-clean/runner-code/accepted/autopilot.py")
        good = SimpleNamespace(st_uid=0, st_mode=stat.S_IFREG | 0o644)
        with patch.object(Path, "lstat", return_value=good), patch.object(
                Path, "stat", return_value=good), patch.object(Path, "resolve", return_value=source):
            self.assertEqual(runner._clean_pm_source(), source)
            with patch.object(Path, "lstat", return_value=SimpleNamespace(st_uid=1002)):
                with self.assertRaises(ValueError):
                    runner._clean_pm_source()
            with patch.object(Path, "resolve", return_value=Path("/tmp/autopilot.py")):
                with self.assertRaises(ValueError):
                    runner._clean_pm_source()
            with patch.object(Path, "stat", return_value=SimpleNamespace(st_uid=0, st_mode=0o100666)):
                with self.assertRaises(ValueError):
                    runner._clean_pm_source()


if __name__ == "__main__":
    unittest.main()

"""Fixed producer dependencies are private offline snapshots, never installations."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import runner
import clean_publish_submit as submit


class CleanDependencies(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.cache = self.base / "cache"
        self.worktree = self.base / "worktree"
        self.worktree.mkdir()
        self.task = {"id": "friends-dev-s1-api-20261013-v001"}
        self.cfg = {"project_repo": "anpavel84-afk/gobadminton-clean"}
        for relative in ("node_modules/.pnpm/example/node_modules/example",
                         "apps/api/node_modules", "packages/contracts/node_modules"):
            (self.cache / relative).mkdir(parents=True, exist_ok=True)
        (self.cache / "pnpm-lock.yaml").write_text("exact lock\n")
        (self.worktree / "pnpm-lock.yaml").write_text("exact lock\n")
        (self.cache / "node_modules/.pnpm/example/node_modules/example/index.js").write_text("module.exports=42;\n")
        (self.cache / "apps/api/node_modules/example").symlink_to(
            "../../../node_modules/.pnpm/example/node_modules/example", target_is_directory=True)

    def seed(self):
        with patch.object(runner, "_clean_dependency_cache", return_value=(self.cache, "api")), patch.object(
                runner, "_v2_task_worktree", return_value=self.worktree), patch.object(
                runner, "_root_protected_dependency_path"), patch.object(
                submit, "workspace", return_value=self.worktree), patch.object(
                submit, "git", return_value=""):
            runner._seed_clean_dependencies(self.cfg, self.task, self.worktree)

    def test_private_snapshot_resolves_modules_and_reseeds_existing_tree(self):
        self.seed()
        installed = self.worktree / "node_modules/.pnpm/example/node_modules/example/index.js"
        self.assertEqual(installed.read_text(), "module.exports=42;\n")
        self.assertNotEqual(installed.stat().st_ino,
                            (self.cache / "node_modules/.pnpm/example/node_modules/example/index.js").stat().st_ino)
        self.assertTrue((self.worktree / "apps/api/node_modules/example").resolve().is_relative_to(self.worktree))
        node = shutil.which("node")
        self.assertIsNotNone(node, "actual module resolution test requires Node")
        result = subprocess.run([node, "-e", "process.stdout.write(String(require('example')))"],
                                cwd=self.worktree / "apps/api", capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "42")
        installed.write_text("producer private mutation")
        self.assertEqual((self.cache / "node_modules/.pnpm/example/node_modules/example/index.js").read_text(),
                         "module.exports=42;\n")
        self.seed()
        self.assertEqual(installed.read_text(), "module.exports=42;\n")

    def test_lock_mismatch_fails_before_copy(self):
        (self.worktree / "pnpm-lock.yaml").write_text("changed lock")
        with self.assertRaisesRegex(RuntimeError, "lock"):
            self.seed()
        self.assertFalse((self.worktree / "node_modules").exists())

    def test_outside_or_absolute_symlink_fails_before_copy(self):
        link = self.cache / "apps/api/node_modules/example"
        for target in ("../../../../outside", str(self.base / "outside")):
            link.unlink()
            link.symlink_to(target)
            with self.assertRaisesRegex(RuntimeError, "symlink"):
                self.seed()
            self.assertFalse((self.worktree / "node_modules").exists())

    def test_root_cache_mode_tamper_is_refused(self):
        self.cache.chmod(0o777)
        with self.assertRaisesRegex(RuntimeError, "root-owned/read-only"):
            runner._root_protected_dependency_path(self.cache)

    def test_dirty_source_and_destination_escape_fail_before_copy(self):
        with patch.object(runner, "_clean_dependency_cache", return_value=(self.cache, "api")), patch.object(
                runner, "_v2_task_worktree", return_value=self.worktree), patch.object(
                submit, "workspace", return_value=self.worktree), patch.object(
                submit, "git", return_value=" M apps/api/source.ts"):
            with self.assertRaisesRegex(RuntimeError, "clean Git source"):
                runner._seed_clean_dependencies(self.cfg, self.task, self.worktree)
        (self.worktree / "apps").symlink_to(self.base, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "destination ancestry"):
            self.seed()
        self.assertFalse((self.worktree / "node_modules").exists())

    def test_only_exact_original_and_registered_env_successors_have_cache_bindings(self):
        self.assertEqual(runner._clean_dependency_cache(self.task["id"]),
                         (Path("/opt/gobadminton-clean-qa/dependencies/api"), "api"))
        self.assertEqual(runner._clean_dependency_cache("radar-dev-map-ui-20261013-v001"),
                         (Path("/opt/gobadminton-clean-qa/dependencies/web"), "web"))
        self.assertEqual(runner._clean_dependency_cache("friends-dev-s1-api-20261013-v002"),
                         (Path("/opt/gobadminton-clean-qa/dependencies/api"), "api"))
        self.assertEqual(runner._clean_dependency_cache("radar-dev-map-ui-20261013-v002"),
                         (Path("/opt/gobadminton-clean-qa/dependencies/web"), "web"))
        for task_id in ("friends-dev-s1-api-20261013-v003", "radar-dev-map-ui-20261013-v003",
                        "friends-dev-s1-api-20261013-v002-suffix", "../../tmp"):
            with self.subTest(task_id=task_id):
                self.assertIsNone(runner._clean_dependency_cache(task_id))
        self.assertIsNone(runner._clean_dependency_cache("qa-" + self.task["id"]))
        self.assertIsNone(runner._clean_dependency_cache("../../tmp"))

    def test_actual_git_fsmonitor_env_and_pointer_redirect_are_refused(self):
        primary = self.base / "source"
        primary.mkdir()
        submit.git(primary, "init")
        submit.git(primary, "config", "user.name", "fixture")
        submit.git(primary, "config", "user.email", "fixture@example.invalid")
        (primary / "pnpm-lock.yaml").write_text("exact lock\n")
        (primary / ".gitignore").write_text("node_modules/\n")
        submit.git(primary, "add", "pnpm-lock.yaml", ".gitignore")
        submit.git(primary, "commit", "-m", "fixture")
        shutil.rmtree(self.worktree)
        submit.git(primary, "worktree", "add", "--detach", str(self.worktree), "HEAD")
        marker = self.base / "fsmonitor-executed"
        hook = self.base / "evil-fsmonitor"
        hook.write_text("#!/bin/sh\ntouch " + str(marker) + "\n")
        hook.chmod(0o700)
        submit.git(primary, "config", "core.fsmonitor", str(hook))
        commit = submit.git(self.worktree, "rev-parse", "HEAD")
        with patch.object(submit, "SOURCE_REPO", primary), patch.object(
                submit, "WORKTREES", {self.task["id"]: self.worktree}), patch.object(
                runner, "_clean_dependency_cache", return_value=(self.cache, "api")), patch.object(
                runner, "_v2_task_worktree", return_value=self.worktree), patch.object(
                runner, "_root_protected_dependency_path"), patch.dict(os.environ, {
                    "GIT_ALTERNATE_OBJECT_DIRECTORIES": str(self.base / "foreign-objects"),
                    "GIT_DIR": str(self.base / "foreign-git"),
                    "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.fsmonitor",
                    "GIT_CONFIG_VALUE_0": str(hook)}):
            runner._seed_clean_dependencies(self.cfg, self.task, self.worktree)
            self.assertFalse(marker.exists())
            self.assertEqual(submit.git(self.worktree, "rev-parse", "HEAD"), commit)
            pointer = self.worktree / ".git"
            original = pointer.read_text()
            pointer.write_text("gitdir: " + str(self.base / "foreign-git") + "\n")
            before = (self.worktree / "node_modules/.pnpm/example/node_modules/example/index.js").read_bytes()
            with self.assertRaisesRegex(RuntimeError, "canonical metadata"):
                runner._seed_clean_dependencies(self.cfg, self.task, self.worktree)
            self.assertEqual((self.worktree / "node_modules/.pnpm/example/node_modules/example/index.js").read_bytes(), before)
            pointer.write_text(original)
            alternates = primary / ".git/objects/info/alternates"
            alternates.write_text(str(self.base / "foreign-objects"))
            with self.assertRaisesRegex(RuntimeError, "alternate"):
                runner._seed_clean_dependencies(self.cfg, self.task, self.worktree)


if __name__ == "__main__":
    unittest.main()

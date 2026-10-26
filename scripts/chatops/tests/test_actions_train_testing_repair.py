"""Regression coverage for PR #323 independent QA repair findings F1--F4."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_actions_train_testing_runner as fixture
import test_actions_train_testing_verifier as git_fixture

TOOLS = fixture.TOOLS
sys.path.insert(0, str(TOOLS))
import catalog as C
import plan_block as P
import run_test_group as R
import safe_io as S
import tier_classifier as T
import verify_profile as V


@unittest.skipIf(os.geteuid() == 0, "mode boundary unavailable as root")
class RunnerRepairTests(unittest.TestCase):
    setUp = fixture.RunnerTests.setUp
    git = fixture.RunnerTests.git
    make_catalog = fixture.RunnerTests.make_catalog
    run_group = fixture.RunnerTests.run_group
    result = fixture.RunnerTests.result

    def fp(self):
        return R.fingerprint(self.repo, self.runs, "tiny", [], self.catalog.read_bytes(), [])[0]

    def collect(self, fp):
        return subprocess.run([sys.executable, "-B", str(TOOLS / "run_test_group.py"), "collect",
            "--repo", str(self.repo), "--fingerprint", fp], env=self.env,
            capture_output=True, text=True, timeout=10)

    def assert_refused(self, result, code):
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertIn(code, result.stdout)
        self.assertLessEqual(len(result.stdout.splitlines()), 30)
        self.assertFalse(self.counter.exists())

    def test_symlinked_log_receipt_legacy_temp_and_lock_never_write_target(self):
        fp = self.fp()
        outside = self.home / "unrelated"
        outside.write_bytes(b"UNRELATED")
        for suffix in (".log", ".json", ".json.new", ".lock", ".json." + "a" * 32 + ".new"):
            with self.subTest(suffix=suffix):
                link = self.runs / (fp + suffix)
                link.symlink_to(outside)
                self.assert_refused(self.run_group(), "UNSAFE_ARTIFACT")
                self.assertEqual(outside.read_bytes(), b"UNRELATED")
                self.assertTrue(link.is_symlink())
                self.assertEqual(list(self.runs.iterdir()), [link])
                link.unlink()

    def test_symlinked_runs_directory_is_refused(self):
        self.runs.rmdir()
        outside = self.home / "outside-runs"
        outside.mkdir()
        self.runs.symlink_to(outside, target_is_directory=True)
        self.assert_refused(self.run_group(), "UNSAFE_RUNS_DIR")
        self.assertEqual(list(outside.iterdir()), [])

    def test_symlinked_runs_parent_is_refused(self):
        parent = self.home / "linked"
        outside = self.home / "outside"
        outside.mkdir()
        parent.symlink_to(outside, target_is_directory=True)
        self.assert_refused(self.run_group("--runs-dir", str(parent / "runs")), "RUNS_DIR_NOT_IN_GIT_DIR")
        self.assertEqual(list(outside.iterdir()), [])

    def test_non_directory_runs_is_refused(self):
        self.runs.rmdir()
        self.runs.write_bytes(b"KEEP")
        self.assert_refused(self.run_group(), "UNSAFE_RUNS_DIR")
        self.assertEqual(self.runs.read_bytes(), b"KEEP")

    def test_new_runs_directory_is_private(self):
        self.runs.rmdir()
        self.assertEqual(self.run_group().returncode, 0)
        self.assertEqual(self.runs.stat().st_mode & 0o777, 0o700)

    def test_foreign_owner_and_writable_runs_are_refused(self):
        with patch.object(R.os, "getuid", return_value=os.getuid() + 1):
            with self.assertRaises(R.BoundaryUnavailable):
                with R.runs_directory(self.repo, self.runs, locked=True):
                    pass
        self.runs.chmod(0o777)
        self.assert_refused(self.run_group(), "UNSAFE_RUNS_DIR")

    def test_hardlinked_artifact_is_refused(self):
        outside = self.home / "unrelated"
        outside.write_bytes(b"KEEP")
        os.link(outside, self.runs / (self.fp() + ".log"))
        self.assert_refused(self.run_group(), "UNSAFE_ARTIFACT")
        self.assertEqual(outside.read_bytes(), b"KEEP")

    def test_fifo_artifact_is_refused_without_blocking(self):
        os.mkfifo(self.runs / (self.fp() + ".log"))
        self.assert_refused(self.run_group(timeout=5), "UNSAFE_ARTIFACT")

    def test_collect_refuses_symlinked_lock_and_receipt(self):
        fp = self.fp()
        outside = self.home / "outside"
        outside.write_bytes(b"KEEP")
        for suffix in (".lock", ".json"):
            with self.subTest(suffix=suffix):
                link = self.runs / (fp + suffix)
                link.symlink_to(outside)
                self.assert_refused(self.collect(fp), "UNSAFE_ARTIFACT")
                self.assertEqual(outside.read_bytes(), b"KEEP")
                link.unlink()

    def test_regular_source_swapped_to_symlink_before_open_is_refused(self):
        outside = self.home / "outside"
        outside.write_bytes(b"OUTSIDE")
        source = self.repo / "tracked.txt"
        original = os.open
        swapped = False
        def racing_open(name, flags, *args, **kwargs):
            nonlocal swapped
            if name == source.name and not swapped:
                source.unlink()
                source.symlink_to(outside)
                swapped = True
                self.assertTrue(flags & os.O_NOFOLLOW)
            return original(name, flags, *args, **kwargs)
        with patch.object(S.os, "open", side_effect=racing_open):
            with self.assertRaisesRegex(ValueError, "UNSAFE_WORKTREE_FILE"):
                R.worktree_digest(self.repo, self.runs)
        self.assertTrue(swapped)
        self.assertEqual(outside.read_bytes(), b"OUTSIDE")

    def test_symlink_source_hashes_link_text_without_reading_target(self):
        source = self.repo / "tracked.txt"
        source.unlink()
        outside = self.home / "outside"
        outside.write_bytes(b"one")
        source.symlink_to(outside)
        before = R.worktree_digest(self.repo, self.runs)
        outside.write_bytes(b"two")
        self.assertEqual(R.worktree_digest(self.repo, self.runs), before)
        self.assertEqual(R.source_entry(source), ("120000", R.sha(os.fsencode(str(outside)))))

    def test_symlink_source_parent_is_refused(self):
        outside = self.home / "outside-dir"
        outside.mkdir()
        (outside / "input.txt").write_text("OUTSIDE")
        data = self.repo / "data"
        data.mkdir()
        (data / "input.txt").write_text("source")
        self.git("add", "data/input.txt")
        (data / "input.txt").unlink()
        data.rmdir()
        data.symlink_to(outside, target_is_directory=True)
        self.assert_refused(self.run_group(), "SYMLINK_PARENT")

    def test_tracked_input_in_runs_is_always_refused_even_after_change(self):
        data = self.repo / "data"
        data.mkdir()
        source = data / "input.txt"
        source.write_text("good")
        self.git("add", "data/input.txt")
        self.make_catalog("from pathlib import Path; assert Path('data/input.txt').read_text() == 'good'")
        for value in ("good", "bad"):
            source.write_text(value)
            self.assert_refused(self.run_group("--runs-dir", str(data)), "RUNS_DIR_IN_WORKTREE")
            self.assertEqual(list(data.iterdir()), [source])
        executed = subprocess.run(json.loads(self.catalog.read_text())["groups"][0]["argv"],
                                  cwd=self.repo, env=self.env, capture_output=True)
        self.assertEqual(executed.returncode, 1)

    def test_tracked_artifact_shaped_file_is_source_even_when_deleted(self):
        # Even an artifact-shaped tracked/deleted path in the OLD location is refused.
        source = self.repo / ".gb-test-runs" / ("a" * 64 + ".log")
        source.parent.mkdir()
        source.write_text("source")
        self.git("add", str(source))
        for deleted in (False, True):
            if deleted:
                source.unlink()
            self.assert_refused(self.run_group("--runs-dir", str(source.parent)), "RUNS_DIR_IN_WORKTREE")

    def test_source_directory_uses_source_refusal_code(self):
        source = self.repo / "docs" / "note.md"
        source.parent.mkdir()
        source.write_text("source")
        self.git("add", "docs/note.md")
        self.assert_refused(self.run_group("--runs-dir", str(source.parent)), "RUNS_DIR_IN_WORKTREE")
        self.assertEqual(list(source.parent.iterdir()), [source])

    def test_untracked_non_artifact_and_nested_source_are_refused(self):
        for name in ("input.txt", "nested"):
            source = self.runs / name
            source.write_text("source")
            self.assert_refused(self.run_group(), "RUNS_DIR_CONTAINS_SOURCE")
            self.assertEqual(source.read_text(), "source")
            source.unlink()
        (self.runs / "nested").mkdir()
        self.assert_refused(self.run_group(), "RUNS_DIR_CONTAINS_SOURCE")

    def test_default_artifacts_only_are_excluded_and_digest_stays_stable(self):
        before = self.fp()
        self.assertEqual(self.run_group().returncode, 0)
        self.assertEqual(self.fp(), before)
        self.assertEqual(self.result()["fingerprint"], before)
        result = self.run_group()
        self.assertEqual(result.returncode, 3, result.stdout)
        self.assertIn("SAME_FINGERPRINT", result.stdout)
        self.assertEqual(self.counter.read_text(), "1")

    def test_artifact_created_after_validation_is_not_silently_excluded(self):
        outside = self.home / "outside"
        outside.write_text("KEEP")
        original = R.git_paths
        def after_validation(repo, *, tracked=False):
            if not tracked:
                (self.runs / ("a" * 64 + ".log")).symlink_to(outside)
            return original(repo, tracked=tracked)
        with patch.object(R, "git_paths", side_effect=after_validation):
            with self.assertRaisesRegex(ValueError, "UNSAFE_ARTIFACT"):
                R.worktree_digest(self.repo, self.runs)
        self.assertEqual(outside.read_text(), "KEEP")

    def test_catalog_symlink_and_parent_symlink_are_refused(self):
        link = self.home / "catalog-link.json"
        link.symlink_to(self.catalog)
        with self.assertRaisesRegex(ValueError, "UNSAFE_CATALOG"):
            C.load_catalog(link)
        parent = self.home / "catalog-parent-link"
        parent.symlink_to(self.home, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "UNSAFE_CATALOG"):
            C.load_catalog(parent / self.catalog.name)

    def test_catalog_swap_to_symlink_is_refused(self):
        outside = self.home / "outside-catalog"
        outside.write_bytes(self.catalog.read_bytes())
        original = os.open
        def racing_open(name, flags, *args, **kwargs):
            if name == self.catalog.name:
                self.catalog.unlink()
                self.catalog.symlink_to(outside)
            return original(name, flags, *args, **kwargs)
        with patch.object(S.os, "open", side_effect=racing_open):
            with self.assertRaisesRegex(ValueError, "UNSAFE_CATALOG"):
                C.load_catalog(self.catalog)

    def test_result_write_uses_unique_exclusive_no_follow_temp_and_relative_rename(self):
        path = self.runs / ("a" * 64 + ".json")
        with R.runs_directory(self.repo, self.runs) as fd:
            with patch.object(R.os, "open", wraps=os.open) as opened, \
                    patch.object(R.os, "replace", wraps=os.replace) as renamed:
                R.write_result(path, {"status": "PASS"}, fd)
                R.write_result(path, {"status": "FAIL"}, fd)
            temps = [call for call in opened.call_args_list if str(call.args[0]).endswith(".new")]
            self.assertEqual(len(temps), 2)
            self.assertNotEqual(temps[0].args[0], temps[1].args[0])
            for call in temps:
                for flag in (os.O_CREAT, os.O_EXCL, os.O_NOFOLLOW):
                    self.assertTrue(call.args[1] & flag)
                self.assertEqual(call.kwargs["dir_fd"], fd)
            for call in renamed.call_args_list:
                self.assertEqual(call.kwargs, dict(src_dir_fd=fd, dst_dir_fd=fd))
        self.assertEqual(json.loads(path.read_text()), {"status": "FAIL"})

    def test_exclusive_temp_collision_refuses_without_modifying_target(self):
        path = self.runs / ("a" * 64 + ".json")
        outside = self.home / "outside"
        outside.write_text("KEEP")
        temp = path.with_name(path.name + "." + "b" * 32 + ".new")
        with R.runs_directory(self.repo, self.runs) as fd:
            temp.symlink_to(outside)
            with patch.object(R.uuid, "uuid4") as identifier:
                identifier.return_value.hex = "b" * 32
                with self.assertRaisesRegex(ValueError, "UNSAFE_ARTIFACT"):
                    R.write_result(path, {"status": "PASS"}, fd)
        self.assertEqual(outside.read_text(), "KEEP")
        self.assertTrue(temp.is_symlink())
        self.assertFalse(path.exists())

    def test_receipt_write_stays_in_open_directory_after_path_swapped_to_symlink(self):
        outside = self.home / "outside-runs"
        outside.mkdir()
        moved = self.home / "moved-runs"
        path = self.runs / ("a" * 64 + ".json")
        with R.runs_directory(self.repo, self.runs) as fd:
            self.runs.rename(moved)
            self.runs.symlink_to(outside, target_is_directory=True)
            R.write_result(path, {"status": "PASS"}, fd)
        self.assertEqual(json.loads((moved / path.name).read_text()), {"status": "PASS"})
        self.assertEqual(list(outside.iterdir()), [])


class PlanRepairTests(unittest.TestCase):
    def setUp(self):
        self.plan = P.plan_for_changes([dict(path="docs/note.md", status="M")])

    def test_unvalidated_marker_text_cannot_delete_security_criterion(self):
        text = "Keep A\n" + P.BEGIN + "\nMANDATORY SECURITY ACCEPTANCE\n" + P.END + "\nKeep B"
        with self.assertRaisesRegex(P.PlanError, "BAD_FIELD"):
            P.attach(text, self.plan)
        self.assertIn("MANDATORY SECURITY ACCEPTANCE", text)

    def test_original_acceptance_length_checked_before_replacement(self):
        text = P.BEGIN + "\n" + "MANDATORY " * 700 + "\n" + P.END
        with self.assertRaisesRegex(P.PlanError, "ACCEPTANCE_TOO_LONG"):
            P.attach(text, self.plan)

    def test_valid_block_replaced_with_surrounding_bytes_preserved(self):
        before, after = "Keep A\r\n  Привет\n", "\r\nKeep B  \t"
        old = P.plan_for_changes([dict(path="AGENTS.md", status="M")])
        self.assertEqual(P.attach(before + P.render(old) + after, self.plan).encode(),
                         (before + P.render(self.plan) + after).encode())

    def test_existing_block_must_pass_same_strict_parser(self):
        valid = P.render(self.plan)
        for text in (valid.replace('"tier":"T0"', '"tier":"T0","tier":"T0"'),
                     valid.replace('"needs_independent_qa":true', '"needs_independent_qa":false'),
                     valid.replace('"foundation"', '"unknown_group"')):
            with self.subTest(text=text), self.assertRaises(P.PlanError):
                P.attach(text, self.plan)


class RenameRepairTests(unittest.TestCase):
    def change(self, **kwargs):
        return dict(path="docs/note.md", status="R", mode="100644", old_mode="100644", **kwargs)

    def test_new_path_only_fails_closed_in_classifier_verifier_and_plan(self):
        changes = [self.change()]
        result = T.classify(changes)
        self.assertEqual(result["tier"], "T3")
        self.assertIn("RENAME_UNPAIRED:docs/note.md", result["reasons"])
        self.assertFalse(T.verify_declared("T0", changes)["ok"])
        self.assertEqual(P.plan_for_changes(changes)["tier"], "T3")

    def test_explicit_pair_classifies_old_endpoint(self):
        changes = [self.change(old_path="docs/rules/guide.md")]
        self.assertEqual(T.classify(changes)["tier"], "T3")
        self.assertIn("CRITICAL_PATH:docs/rules/guide.md", T.classify(changes)["reasons"])
        self.assertEqual(P.plan_for_changes(changes)["tier"], "T3")

    def test_non_critical_explicit_pair_can_be_t0(self):
        changes = [self.change(old_path="docs/old-note.md")]
        self.assertEqual(T.classify(changes)["tier"], "T0")
        self.assertTrue(T.verify_declared("T0", changes)["ok"])

    def test_invalid_old_path_is_rejected(self):
        for old in (None, "", "../docs/note.md", "/docs/note.md", "docs//x.md", "docs/../x.md"):
            with self.subTest(old=old), self.assertRaisesRegex(ValueError, "BAD_CHANGE"):
                T.classify([self.change(old_path=old)])

    def test_old_endpoint_visual_checks_and_modes_remain_required(self):
        changes = [self.change(old_path="apps/web/src/components/Popup.tsx")]
        self.assertTrue(T.classify(changes)["visual_qa"])
        changes[0]["old_mode"] = "120000"
        self.assertEqual(T.classify(changes)["tier"], "T3")


class GitRenameRepairTests(unittest.TestCase):
    setUp = git_fixture.VerifyProfileTests.setUp
    git = git_fixture.VerifyProfileTests.git
    write = git_fixture.VerifyProfileTests.write
    commit = git_fixture.VerifyProfileTests.commit

    def test_real_git_rename_from_rules_retains_both_explicit_endpoints(self):
        self.write("docs/rules/guide.md", "unique rules fixture\n")
        base = self.commit()
        self.git("mv", "docs/rules/guide.md", "docs/guide.md")
        head = self.commit()
        changes = V.diff_changes(base, head, self.repo)
        self.assertEqual({c["path"] for c in changes}, {"docs/rules/guide.md", "docs/guide.md"})
        self.assertTrue(all(c["old_path"] == "docs/rules/guide.md" for c in changes))
        self.assertEqual(T.classify(changes)["tier"], "T3")
        self.assertFalse(T.verify_declared("T0", changes)["ok"])

    def test_real_git_non_critical_pair_can_stay_t0(self):
        self.git("mv", "docs/note.md", "docs/new-note.md")
        changes = V.diff_changes(self.base, self.commit(), self.repo)
        self.assertEqual(len(changes), 2)
        self.assertEqual(T.classify(changes)["tier"], "T0")

    def test_plan_cli_new_path_only_and_explicit_pairs(self):
        for old, expected in ((None, "T3"), ("docs/rules/guide.md", "T3"), ("docs/old.md", "T0")):
            changes = [dict(path="docs/note.md", status="R")]
            if old is not None:
                changes[0]["old_path"] = old
            path = self.repo / "changes.json"
            path.write_text(json.dumps(changes))
            result = subprocess.run([sys.executable, "-B", str(TOOLS / "plan_block.py"), "render",
                "--paths-file", str(path)], capture_output=True, text=True, env=self.env)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(P.parse(result.stdout)["tier"], expected)
            self.assertLessEqual(len(result.stdout.splitlines()), 30)


if __name__ == "__main__":
    unittest.main()

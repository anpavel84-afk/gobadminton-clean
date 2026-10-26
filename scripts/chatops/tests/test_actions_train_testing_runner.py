"""Synthetic subprocesses only: no services, credentials or installed train code."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[3]
TOOLS = ROOT / "scripts/chatops/testing"
sys.path.insert(0, str(TOOLS))
import run_test_group as R


@unittest.skipIf(os.geteuid() == 0, "mode boundary unavailable as root")
class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.repo = self.home / "repo"
        self.repo.mkdir()
        # Command side effects are not runner artifacts or fingerprint inputs.
        self.counter = self.home / "counter"
        self.catalog = self.home / "catalog.json"
        self.env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "GIT_CONFIG_NOSYSTEM": "1",
                    "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}
        self.git("init", "-q")
        self.runs = self.repo / ".git" / "gb-test-runs"
        with R.runs_directory(self.repo, self.runs, create=True):
            pass
        (self.repo / "tracked.txt").write_text("original\n")
        self.git("add", "tracked.txt")
        self.make_catalog()

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, env=self.env,
                              capture_output=True, text=True, check=True)

    def make_catalog(self, code=None, kind="local", timeout=10, flags=None, gid="tiny"):
        if code is None:
            code = ("from pathlib import Path; p=Path(" + repr(str(self.counter)) + "); "
                    "p.write_text(str(int(p.read_text())+1) if p.exists() else '1'); print('done')")
        group = dict(id=gid, description="synthetic offline command", argv=[sys.executable, "-B", "-c", code],
                     cwd=".", timeout_s=timeout, tiers=["T1"], env_flags=flags or [], kind=kind)
        self.catalog.write_text(json.dumps(dict(schema="GB_TEST_GROUPS_V1", groups=[group])))

    def run_group(self, *args, group="tiny", timeout=20, env=None):
        return subprocess.run([sys.executable, "-B", str(TOOLS / "run_test_group.py"), "run",
                               "--group", group, "--repo", str(self.repo), "--catalog", str(self.catalog),
                               *args], capture_output=True, text=True, env=env or self.env, timeout=timeout)

    def result(self):
        files = list(self.runs.glob("*.json"))
        self.assertEqual(len(files), 1)
        return json.loads(files[0].read_text())

    def test_second_identical_run_is_refused_without_executing_command(self):
        first, second = self.run_group(), self.run_group()
        self.assertEqual(first.returncode, 0, first.stdout)
        self.assertEqual(second.returncode, 3, second.stdout)
        self.assertIn("SAME_FINGERPRINT previous=PASS (not re-verified; not evidence)", second.stdout)
        self.assertEqual(self.counter.read_text(), "1")

    def test_valid_repeat_reason_executes_and_records_history(self):
        self.assertEqual(self.run_group().returncode, 0)
        repeated = self.run_group("--repeat-reason", "flake_probe")
        self.assertEqual(repeated.returncode, 0, repeated.stdout)
        self.assertEqual(self.counter.read_text(), "2")
        history = self.result()["history"]
        self.assertEqual(len(history), 2)
        self.assertEqual(history[-1]["reason"], "flake_probe")
        self.assertEqual(history[-1]["status"], "PASS")
        self.assertIn("time", history[-1])

    def test_changing_tracked_content_changes_fingerprint_and_runs(self):
        self.assertEqual(self.run_group().returncode, 0)
        old = self.result()["fingerprint"]
        (self.repo / "tracked.txt").write_text("changed\n")
        self.assertEqual(self.run_group("--repeat-reason", "input_changed").returncode, 0)
        results = [json.loads(p.read_text()) for p in self.runs.glob("*.json")]
        self.assertEqual(len({r["fingerprint"] for r in results}), 2)
        self.assertTrue(any(r["fingerprint"] != old for r in results))
        self.assertEqual(self.counter.read_text(), "2")

    def test_same_fingerprint_input_changed_is_refused(self):
        self.assertEqual(self.run_group().returncode, 0)
        repeat = self.run_group("--repeat-reason", "input_changed")
        self.assertEqual(repeat.returncode, 3)
        self.assertEqual(self.counter.read_text(), "1")

    def test_unknown_reason_code_is_refused_before_execution(self):
        result = self.run_group("--repeat-reason", "because_i_want")
        self.assertEqual(result.returncode, 3)
        self.assertFalse(self.counter.exists())

    def test_fail_summary_stays_bounded_with_full_5000_line_log_and_failure_ids(self):
        code = ("import sys; [print('noise',i) for i in range(5000)]; "
                "[print('FAIL: test_'+str(i)+' (suite.Case)') for i in range(14)]; "
                "print('Ran 17 tests in 0.01s'); print('FAILED (failures=14, errors=2)'); sys.exit(1)")
        self.make_catalog(code)
        result = self.run_group()
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertLessEqual(len(result.stdout.splitlines()), 30)
        self.assertNotIn("noise", result.stdout)
        self.assertIn("... and 4 more", result.stdout)
        record = self.result()
        self.assertEqual(record["counts"], dict(tests=17, failures=14, errors=2))
        self.assertGreater(len(Path(record["log_path"]).read_text().splitlines()), 5000)
        self.assertEqual(self.run_group().returncode, 3)

    def test_detach_collect_blocks_on_inherited_lock_and_returns_completed_summary(self):
        self.make_catalog("import time; time.sleep(1); print('finished')")
        detached = self.run_group("--detach")
        self.assertEqual(detached.returncode, 0, detached.stdout + detached.stderr)
        fp = detached.stdout.splitlines()[0].split(": ")[1]
        started = time.monotonic()
        collected = subprocess.run([sys.executable, "-B", str(TOOLS / "run_test_group.py"), "collect",
                                   "--repo", str(self.repo), "--fingerprint", fp],
                                  capture_output=True, text=True, env=self.env, timeout=10)
        self.assertGreater(time.monotonic() - started, 0.5)
        self.assertEqual(collected.returncode, 0, collected.stdout)
        self.assertIn("status: PASS", collected.stdout)
        self.assertFalse(self.result()["pending"])

    def test_concurrent_same_fingerprint_executes_once(self):
        self.make_catalog("import time; from pathlib import Path; time.sleep(0.3); "
                          "Path(" + repr(str(self.counter)) + ").write_text('once')")
        self.assertEqual(self.run_group("--detach").returncode, 0)
        result = self.run_group()
        self.assertEqual(result.returncode, 3, result.stdout)
        self.assertEqual(self.counter.read_text(), "once")

    def test_ci_only_is_not_tested_exit_two_and_never_executes(self):
        self.make_catalog(kind="ci_only")
        result = self.run_group()
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertEqual(self.result()["status"], "NOT_TESTED")
        self.assertFalse(self.counter.exists())

    def test_missing_env_flag_is_not_tested(self):
        self.make_catalog(flags=["GB_SYNTHETIC_REQUIRED_FLAG"])
        env = {k: v for k, v in self.env.items() if k != "GB_SYNTHETIC_REQUIRED_FLAG"}
        result = self.run_group(env=env)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.result()["detail"], "MISSING_ENV_FLAG")
        self.assertFalse(self.counter.exists())

    def test_child_environment_is_scrubbed(self):
        self.make_catalog("import os; print(sorted(os.environ)); assert 'GB_NOT_ALLOWED' not in os.environ; "
                          "assert os.environ['GB_ALLOWED'] == 'synthetic'", flags=["GB_ALLOWED"])
        result = self.run_group(env={**self.env, "GB_NOT_ALLOWED": "synthetic", "GB_ALLOWED": "synthetic"})
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_missing_command_is_env_error_and_rerun_is_not_cached_pass(self):
        doc = json.loads(self.catalog.read_text())
        doc["groups"][0]["argv"] = [str(self.home / "does_not_exist")]
        self.catalog.write_text(json.dumps(doc))
        for _ in range(2):
            self.assertEqual(self.run_group().returncode, 2)
            self.assertEqual(self.result()["status"], "ENV_ERROR")
        self.assertEqual(len(self.result()["history"]), 2)

    def test_import_infra_failure_is_env_error(self):
        self.make_catalog("import absent_synthetic_infra_module")
        self.assertEqual(self.run_group().returncode, 2)
        self.assertEqual(self.result()["status"], "ENV_ERROR")

    def test_permission_denied_command_is_env_error(self):
        command = self.repo / "non_executable"
        command.write_text("synthetic, never executed")
        command.chmod(0o600)
        doc = json.loads(self.catalog.read_text())
        doc["groups"][0]["argv"] = [str(command)]
        self.catalog.write_text(json.dumps(doc))
        self.assertEqual(self.run_group().returncode, 2)
        self.assertEqual(self.result()["status"], "ENV_ERROR")

    def test_inconclusive_rerun_retains_original_status_in_history(self):
        self.make_catalog("import os,sys; sys.exit(0 if os.environ['GB_SYNTHETIC_FLAG']=='fixed' else 1)",
                          flags=["GB_SYNTHETIC_FLAG"])
        missing = {k: v for k, v in self.env.items() if k != "GB_SYNTHETIC_FLAG"}
        self.assertEqual(self.run_group(env=missing).returncode, 2)
        # Same presence fingerprint, still inconclusive: no relabel or cached PASS.
        self.assertEqual(self.run_group(env=missing).returncode, 2)
        self.assertEqual([h["status"] for h in self.result()["history"]], ["NOT_TESTED", "NOT_TESTED"])

    def test_catalog_bytes_and_env_presence_are_in_fingerprint(self):
        from unittest.mock import patch
        with patch.dict(os.environ, {}, clear=True):
            fp, inputs = R.fingerprint(self.repo, self.runs, "tiny", [], b"catalog1", ["GB_SYNTHETIC_FLAG"])
            changed, _ = R.fingerprint(self.repo, self.runs, "tiny", [], b"catalog2", ["GB_SYNTHETIC_FLAG"])
            self.assertNotEqual(fp, changed)
            os.environ["GB_SYNTHETIC_FLAG"] = "synthetic"
            present, _ = R.fingerprint(self.repo, self.runs, "tiny", [], b"catalog1", ["GB_SYNTHETIC_FLAG"])
            self.assertNotEqual(fp, present)
            self.assertEqual(inputs["env_flags"], {"GB_SYNTHETIC_FLAG": False})

    def test_timeout_is_exit_four_and_full_output_is_saved(self):
        self.make_catalog("import time; print('before timeout', flush=True); time.sleep(30)", timeout=1)
        self.assertEqual(self.run_group().returncode, 4)
        self.assertEqual(self.result()["status"], "TIMEOUT")
        self.assertIn("before timeout", Path(self.result()["log_path"]).read_text())

    def test_zero_unittest_tests_never_counts_as_pass(self):
        self.make_catalog("print('Ran 0 tests in 0.0s'); print('OK')")
        self.assertEqual(self.run_group().returncode, 2)
        self.assertEqual(self.result()["status"], "NOT_TESTED")

    def test_shell_string_argv_catalog_is_rejected(self):
        doc = json.loads(self.catalog.read_text())
        doc["groups"][0]["argv"] = "echo not_a_list"
        self.catalog.write_text(json.dumps(doc))
        self.assertEqual(self.run_group().returncode, 3)
        self.assertFalse(self.counter.exists())

    def test_targeted_name_path_traversal_is_rejected(self):
        self.make_catalog(gid="targeted_py")
        result = self.run_group("--tests", "../../test_escape", group="targeted_py")
        self.assertEqual(result.returncode, 3, result.stdout)
        self.assertFalse(self.counter.exists())

    def test_targeted_missing_test_file_is_rejected(self):
        self.make_catalog(gid="targeted_py")
        self.assertEqual(self.run_group("--tests", "test_missing", group="targeted_py").returncode, 3)

    def test_targeted_existing_modules_execute_with_unittest(self):
        directory = self.repo / "scripts/chatops/tests"
        directory.mkdir(parents=True)
        (directory / "test_tiny.py").write_text("import unittest\nclass Tiny(unittest.TestCase):\n def test_ok(self): self.assertTrue(True)\n")
        self.make_catalog(gid="targeted_py")
        doc = json.loads(self.catalog.read_text())
        doc["groups"][0]["argv"] = [sys.executable, "-B", "-m", "unittest"]
        self.catalog.write_text(json.dumps(doc))
        result = self.run_group("--tests", "test_tiny", group="targeted_py")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(self.result()["counts"]["tests"], 1)

    def test_explicit_base_catalog_and_runner_do_not_read_poisoned_candidate_copies(self):
        candidate = self.repo / "scripts/chatops/testing"
        candidate.mkdir(parents=True)
        (candidate / "test_groups.json").write_text("invalid candidate catalog")
        (candidate / "run_test_group.py").write_text("raise RuntimeError('candidate runner must not load')")
        self.assertEqual(self.run_group().returncode, 0)

    def test_untracked_content_mode_and_symlink_text_affect_digest(self):
        before = R.worktree_digest(self.repo, self.runs)
        extra = self.repo / "extra.txt"
        extra.write_text("untracked")
        added = R.worktree_digest(self.repo, self.runs)
        self.assertNotEqual(before, added)
        extra.chmod(0o755)
        executable = R.worktree_digest(self.repo, self.runs)
        self.assertNotEqual(added, executable)
        extra.unlink()
        extra.symlink_to("nonexistent-synthetic-target")
        self.assertNotEqual(before, R.worktree_digest(self.repo, self.runs))

    def test_changed_worktree_during_command_is_env_error(self):
        self.make_catalog("from pathlib import Path; Path('tracked.txt').write_text('mutated')")
        self.assertEqual(self.run_group().returncode, 2)
        self.assertEqual(self.result()["detail"], "WORKTREE_CHANGED_DURING_RUN")


class EvidenceTests(unittest.TestCase):
    def test_all_required_pass_is_pass(self):
        self.assertEqual(R.evidence_status({"a": {"status": "PASS"}}, ["a"]), "PASS")

    def test_not_tested_env_error_timeout_and_missing_never_pass(self):
        for status in ("NOT_TESTED", "ENV_ERROR", "TIMEOUT", None):
            with self.subTest(status=status):
                results = {"a": {"status": status}} if status else {}
                self.assertEqual(R.evidence_status(results, ["a"]), "NOT_TESTED")

    def test_fail_dominates_incomplete_evidence(self):
        self.assertEqual(R.evidence_status({"a": {"status": "FAIL"}}, ["a", "b"]), "FAIL")

    def test_receipt_list_cannot_hide_an_inconclusive_result(self):
        self.assertEqual(R.evidence_status([dict(group="a", status="PASS"),
                                          dict(group="b", status="ENV_ERROR")], ["a", "b"]), "NOT_TESTED")

    def test_identical_base_head_failures_are_preexisting_never_pass(self):
        failure = dict(status="FAIL", failing_test_ids=["test_a (C)", "test_b (C)"])
        self.assertEqual(R.compare_base_head(failure, failure), "PRE_EXISTING_FAIL")

    def test_head_only_failure_is_fail(self):
        self.assertEqual(R.compare_base_head(dict(status="FAIL", failing_test_ids=["a"]),
                                            dict(status="FAIL", failing_test_ids=["a", "b"])), "FAIL")

    def test_base_fail_head_pass_is_fixed(self):
        self.assertEqual(R.compare_base_head(dict(status="FAIL"), dict(status="PASS")), "PASS_WITH_BASE_FAIL_FIXED")

    def test_empty_failure_ids_do_not_prove_a_preexisting_failure(self):
        self.assertEqual(R.compare_base_head(dict(status="FAIL"), dict(status="FAIL")), "FAIL")

    def test_inconclusive_comparison_never_passes(self):
        self.assertEqual(R.compare_base_head(dict(status="ENV_ERROR"), dict(status="PASS")), "NOT_TESTED")


if __name__ == "__main__":
    unittest.main()

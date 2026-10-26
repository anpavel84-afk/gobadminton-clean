"""Round 2: runs scratch must never hide catalog command inputs."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_actions_train_testing_runner as fixture
import plan_block as P
import run_test_group as R


@unittest.skipIf(os.geteuid() == 0, "mode boundary unavailable as root")
class ProvenanceTests(unittest.TestCase):
    setUp = fixture.RunnerTests.setUp
    git = fixture.RunnerTests.git
    make_catalog = fixture.RunnerTests.make_catalog
    run_group = fixture.RunnerTests.run_group
    result = fixture.RunnerTests.result

    def refused(self, result, code="RUNS_DIR_CONTAINS_SOURCE"):
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertIn("REFUSED: " + code, result.stdout)
        self.assertNotIn("cached", result.stdout)
        self.assertLessEqual(len(result.stdout.splitlines()), 30)

    def collect(self, fp):
        return subprocess.run([sys.executable, "-B", str(fixture.TOOLS / "run_test_group.py"),
            "collect", "--repo", str(self.repo), "--fingerprint", fp],
            env=self.env, capture_output=True, text=True, timeout=10)

    def test_foreign_malformed_and_legacy_temp_files_are_never_excluded(self):
        for suffix, text in ((".json", '{"source":true}'), (".json", "{broken"),
                             (".json", "[]"), (".json", '{"schema":"FOREIGN"}'),
                             (".json.new", "{}"), (".json." + "b" * 32 + ".new", "{}")):
            with self.subTest(suffix=suffix, text=text):
                path = self.runs / ("a" * 64 + suffix)
                path.write_text(text)
                with self.assertRaisesRegex(ValueError, "RUNS_DIR_CONTAINS_SOURCE"):
                    R.worktree_digest(self.repo, self.runs)
                self.refused(self.run_group())
                self.assertEqual(path.read_text(), text)
                path.unlink()
        self.assertFalse(self.counter.exists())

    def test_wrong_stem_receipt_is_refused_by_run_digest_and_collect(self):
        self.assertEqual(self.run_group().returncode, 0)
        record = self.result()
        wrong = "a" * 64 if record["fingerprint"] != "a" * 64 else "b" * 64
        (self.runs / (wrong + ".json")).write_text(json.dumps(record))
        self.refused(self.run_group())
        self.refused(self.collect(record["fingerprint"]))
        with self.assertRaisesRegex(ValueError, "RUNS_DIR_CONTAINS_SOURCE"):
            R.worktree_digest(self.repo, self.runs)
        self.assertEqual(self.counter.read_text(), "1")

    def test_closed_receipt_schema_status_inputs_and_history_are_enforced(self):
        self.assertEqual(self.run_group().returncode, 0)
        original = self.result()
        path = self.runs / (original["fingerprint"] + ".json")
        mutations = [dict(schema="FOREIGN"), dict(extra="source"), dict(status="BOGUS"),
                     dict(status=[]), dict(history={}), dict(history=[{}]),
                     dict(history=[dict(reason="initial", time="bad", status="PASS")]),
                     dict(history=[dict(reason="unknown", time=R.now(), status="PASS")]),
                     dict(history=[dict(reason="initial", time=R.now(), status="BOGUS")]),
                     dict(history=[]), dict(inputs={}), dict(pending="false"),
                     dict(counts={}), dict(duration_s=float("nan")), dict(rc=True),
                     dict(failing_test_ids="test_x"), dict(log_path="wrong.log")]
        for changes in mutations:
            with self.subTest(changes=changes):
                path.write_text(json.dumps({**original, **changes}))
                self.refused(self.run_group())
                self.refused(self.collect(original["fingerprint"]))
        path.write_text(json.dumps(original).replace('"schema":', '"schema":"duplicate","schema":'))
        self.refused(self.run_group())
        self.assertEqual(self.counter.read_text(), "1")

    def test_runner_receipt_log_lock_excluded_with_stable_fingerprint_and_history(self):
        before, _ = R.fingerprint(self.repo, self.runs, "tiny", [], self.catalog.read_bytes(), [])
        self.assertEqual(self.run_group().returncode, 0)
        self.assertEqual({p.suffix for p in self.runs.iterdir()}, {".json", ".log", ".lock"})
        record = self.result()
        self.assertEqual(record["schema"], "GB_TEST_RUN_V1")
        self.assertEqual(record["fingerprint"], before)
        self.assertEqual(R.fingerprint(self.repo, self.runs, "tiny", [], self.catalog.read_bytes(), [])[0], before)
        self.assertEqual(self.run_group("--repeat-reason", "flake_probe").returncode, 0)
        self.assertEqual(self.result()["fingerprint"], before)
        self.assertEqual(len(self.result()["history"]), 2)
        self.assertEqual(self.collect(before).returncode, 0)
        self.assertIn("SAME_FINGERPRINT", self.run_group().stdout)

    def test_qa_repro_foreign_json_read_never_returns_stale_cached_pass(self):
        path = self.runs / ("a" * 64 + ".json")
        self.make_catalog("import json; from pathlib import Path; assert json.loads(Path(" +
                          repr(str(path)) + ").read_text())['ok']")
        argv = json.loads(self.catalog.read_text())["groups"][0]["argv"]
        for ok, direct_rc in ((True, 0), (False, 1)):
            path.write_text(json.dumps(dict(ok=ok)))
            direct = subprocess.run(argv, cwd=self.repo, env=self.env, capture_output=True)
            self.assertEqual(direct.returncode, direct_rc)
            self.refused(self.run_group())
        self.assertEqual(list(self.runs.iterdir()), [path])

    def test_argv_paths_cwd_and_symlink_alias_inside_runs_are_refused(self):
        alias = self.repo / "alias"
        alias.symlink_to(self.runs, target_is_directory=True)
        for cwd, arg in ((".git/gb-test-runs", "unused"), ("alias", "unused"),
                         (".", ".git/gb-test-runs/input.json"), (".", str(self.runs)),
                         (".", str(self.runs / "input.json")), (".", "alias/input.json"),
                         (".", "--input=.git/gb-test-runs/input.json")):
            with self.subTest(cwd=cwd, arg=arg):
                doc = json.loads(self.catalog.read_text())
                doc["groups"][0].update(cwd=cwd, argv=[sys.executable, "-B", "-c", "pass", arg])
                self.catalog.write_text(json.dumps(doc))
                self.refused(self.run_group(), "RUNS_DIR_READ_BY_COMMAND")
        self.assertEqual(list(self.runs.iterdir()), [])
        self.assertFalse(self.counter.exists())

    def test_targeted_names_paths_and_symlink_module_cannot_read_runs(self):
        self.make_catalog(gid="targeted_py")
        directory = self.repo / "scripts/chatops/tests"
        directory.mkdir(parents=True)
        (directory / "test_alias.py").symlink_to(self.runs / "input.py")
        for name in (str(self.runs / "test_x.py"), ".git/gb-test-runs/test_x.py",
                     "../../../.git/gb-test-runs/test_x.py", "test_alias"):
            with self.subTest(name=name):
                self.refused(self.run_group("--tests", name, group="targeted_py"), "RUNS_DIR_READ_BY_COMMAND")
        self.assertFalse(self.counter.exists())

    def test_artifact_shaped_subdirectory_is_refused_as_source(self):
        (self.runs / ("a" * 64 + ".lock")).mkdir()
        self.refused(self.run_group())

    def test_receipt_swapped_to_symlink_during_validation_is_refused(self):
        self.assertEqual(self.run_group().returncode, 0)
        path = next(self.runs.glob("*.json"))
        outside = self.home / "outside"
        outside.write_text("KEEP")
        original = os.open
        def racing_open(name, flags, *args, **kwargs):
            if name == path.name:
                path.unlink()
                path.symlink_to(outside)
            return original(name, flags, *args, **kwargs)
        with patch.object(R.os, "open", side_effect=racing_open):
            with self.assertRaisesRegex(ValueError, "UNSAFE_ARTIFACT"):
                R.worktree_digest(self.repo, self.runs)
        self.assertEqual(outside.read_text(), "KEEP")


class AttachPrecheckTests(unittest.TestCase):
    def test_oversized_valid_block_rejected_before_render_parse_or_replace(self):
        plan = P.plan_for_changes([dict(path="docs/note.md", status="M")])
        acceptance = "x" * 6001 + P.render(plan)
        with patch.object(P, "render") as render, patch.object(P, "parse") as parse, \
                patch.object(P, "_span") as span:
            with self.assertRaisesRegex(P.PlanError, "ACCEPTANCE_TOO_LONG"):
                P.attach(acceptance, plan)
            render.assert_not_called()
            parse.assert_not_called()
            span.assert_not_called()


if __name__ == "__main__":
    unittest.main()

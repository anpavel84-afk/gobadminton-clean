import copy
import json
import sys
import tempfile
import threading
import time
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import runner

CFG = {
    "workspace": "/srv/gobadminton-dev/repo",
    "dev_root": "/srv/gobadminton-dev",
    "max_parallel": 2,
    "prod_authorized": False,
}


def task(task_id, order, locks=None, **extra):
    data = {
        "id": task_id,
        "order": order,
        "source": "/tmp/source.md",
        "status": "queued",
        "enabled": True,
        "executor": "codex",
    }
    if locks is not None:
        data["locks"] = locks
    data.update(extra)
    return data


class LockDomainTests(unittest.TestCase):
    def test_legacy_is_global(self):
        self.assertEqual(runner.task_locks(task("legacy", 1)), ("global",))

    def test_conflicts(self):
        self.assertFalse(runner.locks_conflict(("web",), ("api",)))
        self.assertTrue(runner.locks_conflict(("web",), ("web",)))
        self.assertTrue(runner.locks_conflict(("global",), ("api",)))
        self.assertTrue(runner.locks_conflict(("api",), ("global",)))

    def test_web_and_api_can_select_together(self):
        q = {"tasks": [task("web", 1, ["web"]), task("api", 2, ["api"])]}
        selected, waits = runner.select_runnable_tasks(q, {"history": [], "active": {}}, CFG)
        self.assertEqual([x["id"] for x in selected], ["web", "api"])
        self.assertEqual(waits, [])

    def test_same_domain_serializes(self):
        q = {"tasks": [task("w1", 1, ["web"]), task("w2", 2, ["web"])]}
        selected, waits = runner.select_runnable_tasks(q, {"history": [], "active": {}}, CFG)
        self.assertEqual([x["id"] for x in selected], ["w1"])
        self.assertTrue(any(x["id"] == "w2" and "lock conflict" in x["reason"] for x in waits))

    def test_global_serializes(self):
        q = {"tasks": [task("legacy", 1), task("api", 2, ["api"])]}
        selected, _ = runner.select_runnable_tasks(q, {"history": [], "active": {}}, CFG)
        self.assertEqual([x["id"] for x in selected], ["legacy"])

    def test_existing_web_allows_api(self):
        st = {
            "history": [],
            "active": {
                "w": {"id": "w", "status": "running", "locks": ["web"], "claimed_at": "1"}
            },
        }
        q = {"tasks": [task("w2", 1, ["web"]), task("api", 2, ["api"])]}
        selected, _ = runner.select_runnable_tasks(q, st, CFG)
        self.assertEqual([x["id"] for x in selected], ["api"])

    def test_max_parallel_two(self):
        q = {"tasks": [task("a", 1, ["web"]), task("b", 2, ["api"]), task("c", 3, ["docs"])]}
        selected, _ = runner.select_runnable_tasks(q, {"history": [], "active": {}}, CFG)
        self.assertEqual(len(selected), 2)

    def test_lane_local_block_does_not_stop_independent_selection(self):
        q = {"tasks": [task("api", 2, ["api"])]}
        st = {
            "history": [{"id": "old-web", "status": "blocked", "blocker_scope": "lane_local"}],
            "active": {},
            "blocked": None,
            "blocked_tasks": {
                "old-web": {
                    "id": "old-web",
                    "status": "blocked",
                    "blocker_scope": "lane_local",
                }
            },
        }
        selected, waits = runner.select_runnable_tasks(q, st, CFG)
        self.assertEqual([x["id"] for x in selected], ["api"])
        self.assertEqual(waits, [])

    def test_project_global_block_stops_selection(self):
        q = {"tasks": [task("api", 2, ["api"])]}
        st = {
            "history": [],
            "active": {},
            "blocked": {
                "id": "privacy",
                "reason": "global gate",
                "blocker_scope": "project_global",
            },
        }
        selected, waits = runner.select_runnable_tasks(q, st, CFG)
        self.assertEqual(selected, [])
        self.assertEqual(waits, [])

    def test_legacy_notes_completed_dependency_blocks_parallel_qa(self):
        producer = task("producer", 1, ["api"])
        qa = task("qa-producer", 2, ["docs"], notes="depends_on_completed=producer. Independent QA.")
        q = {"tasks": [producer, qa]}
        selected, waits = runner.select_runnable_tasks(q, {"history": [], "active": {}}, CFG)
        self.assertEqual([x["id"] for x in selected], ["producer"])
        self.assertTrue(any(x["id"] == "qa-producer" and "waiting completed dependency producer" in x["reason"] for x in waits))

    def test_legacy_notes_multiple_accepted_dependencies_parse(self):
        tsk = task(
            "frontend", 3, ["web"],
            notes="depends_on_accepted=qa-api,qa-map. Dependency hold.",
        )
        self.assertEqual(
            runner._v2_dependencies(tsk, "depends_on_accepted"),
            ["qa-api", "qa-map"],
        )
        quoted = task(
            "email-web", 4, ["web"],
            notes="depends_on_accepted=['email-e1', 'ui-shell'].",
        )
        self.assertEqual(
            runner._v2_dependencies(quoted, "depends_on_accepted"),
            ["email-e1", "ui-shell"],
        )
        empty = task("root", 5, ["api"], notes="depends_on_accepted=[].")
        self.assertEqual(runner._v2_dependencies(empty, "depends_on_accepted"), [])

    def test_completed_dependency(self):
        q = {"tasks": [
            task("a", 1, ["web"], depends_on_completed=["pre"]),
            task("b", 2, ["api"]),
        ]}
        selected, waits = runner.select_runnable_tasks(q, {"history": [], "active": {}}, CFG)
        self.assertEqual([x["id"] for x in selected], ["b"])
        self.assertTrue(any(x["id"] == "a" for x in waits))
        st = {"history": [{"id": "pre", "status": "completed"}], "active": {}}
        selected, _ = runner.select_runnable_tasks(q, st, CFG)
        self.assertEqual([x["id"] for x in selected], ["a", "b"])


class StateProgressTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="gb-rv2-test-")
        self.root = Path(self.tmp.name)
        self.state = self.root / "state.json"
        self.progress = self.root / "progress.json"
        self.progress_dir = self.root / "progress"
        self.receipts = self.root / "receipts"
        self.receipts.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def stack(self):
        stack = ExitStack()
        stack.enter_context(patch.object(runner, "STATE_PATH", self.state))
        stack.enter_context(patch.object(runner, "PROGRESS_PATH", self.progress))
        stack.enter_context(patch.object(runner, "RUNNER_V2_PROGRESS_DIR", self.progress_dir))
        stack.enter_context(patch.object(runner, "RECEIPTS_DIR", self.receipts))
        stack.enter_context(patch.object(runner, "wake_autopilot"))
        stack.enter_context(patch.object(runner, "log"))
        return stack

    def test_v1_running_current_migrates_to_active(self):
        self.state.write_text(json.dumps({
            "version": 1,
            "paused": False,
            "current": {"id": "old", "status": "running", "claimed_at": "x", "agent_pid": 123},
            "history": [],
            "attempts": {},
        }))
        with self.stack():
            st = runner.load_state()
            self.assertEqual(st["version"], 2)
            self.assertIn("old", st["active"])
            self.assertEqual(st["current"]["id"], "old")

    def test_progress_is_task_scoped(self):
        with self.stack():
            runner.initialize_progress({"id": "a", "scope": "A", "blocks": [{"id": "A1", "title": "one"}]})
            runner.initialize_progress({"id": "b", "scope": "B", "blocks": [{"id": "B1", "title": "two"}]})
            self.assertEqual(json.loads(runner.progress_path_for("a").read_text())["task_id"], "a")
            self.assertEqual(json.loads(runner.progress_path_for("b").read_text())["task_id"], "b")

    def test_one_completion_keeps_other_active(self):
        self.state.write_text(json.dumps({
            "version": 2,
            "paused": False,
            "active": {
                "a": {"id": "a", "status": "running", "locks": ["web"], "claimed_at": "1"},
                "b": {"id": "b", "status": "running", "locks": ["api"], "claimed_at": "2"},
            },
            "history": [], "attempts": {}, "blocked_tasks": {}, "blocked": None,
        }))
        with self.stack():
            runner.mark_completed("a", "ok")
            st = runner.load_state()
            self.assertNotIn("a", st["active"])
            self.assertIn("b", st["active"])
            self.assertEqual(st["current"]["id"], "b")

    def test_recovery_requeues_two_dead_claims_without_duplicate(self):
        self.state.write_text(json.dumps({
            "version": 2, "paused": False,
            "active": {
                "a": {"id": "a", "status": "running", "locks": ["web"], "claimed_at": "1", "agent_pid": 111, "receipt": str(self.receipts/"a.json")},
                "b": {"id": "b", "status": "running", "locks": ["api"], "claimed_at": "2", "agent_pid": 222, "receipt": str(self.receipts/"b.json")},
            },
            "history": [], "attempts": {"a": 1, "b": 1}, "blocked_tasks": {}, "blocked": None,
        }))
        with self.stack(), patch.object(runner, "pid_alive", return_value=False):
            for claim in list(runner.active_claims()):
                runner._v2_finalize_or_requeue_recovered(CFG, claim)
            st = runner.load_state()
            self.assertEqual(st["active"], {})
            self.assertEqual(st["attempts"], {"a": 1, "b": 1})
            self.assertEqual(st["history"], [])


class AtomicWriteConcurrencyTests(unittest.TestCase):
    def test_shared_atomic_json_temp_names_do_not_collide(self):
        errors = []
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "compat.json"

            def writer(index):
                try:
                    for seq in range(25):
                        runner.atomic_write_json(path, {"writer": index, "seq": seq})
                except Exception as exc:
                    errors.append(exc)

            threads = [threading.Thread(target=writer, args=(i,)) for i in range(8)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()

            self.assertEqual(errors, [])
            data = json.loads(path.read_text())
            self.assertIn(data["writer"], range(8))
            self.assertIn(data["seq"], range(25))
            self.assertEqual(list(Path(td).glob("*.tmp")), [])
            self.assertEqual(list(Path(td).glob(".*.tmp")), [])


class SyntheticParallelHarnessTests(unittest.TestCase):
    def _elapsed(self, tasks):
        q = {"tasks": tasks}
        selected, _ = runner.select_runnable_tasks(q, {"history": [], "active": {}}, CFG)
        start = time.monotonic()
        threads = [threading.Thread(target=time.sleep, args=(0.15,)) for _ in selected]
        for th in threads:
            th.start()
        for th in threads:
            th.join()
        return len(selected), time.monotonic() - start

    def test_independent_pair_overlaps(self):
        count, elapsed = self._elapsed([task("web", 1, ["web"]), task("api", 2, ["api"])])
        self.assertEqual(count, 2)
        self.assertLess(elapsed, 0.27)

    def test_conflicting_pair_does_not_co_schedule(self):
        count, _ = self._elapsed([task("web1", 1, ["web"]), task("web2", 2, ["web"])])
        self.assertEqual(count, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)

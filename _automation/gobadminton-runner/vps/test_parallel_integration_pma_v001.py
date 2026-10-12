"""PMA author integration probes. Temporary Git/state only, not independent QA."""
import json
import unittest
from contextlib import ExitStack
from unittest.mock import patch
import runner
import backlog_sync
import test_backlog_sync_v001 as fixtures

class ParallelIntegrationTests(unittest.TestCase):
    restore_runner = fixtures.BacklogSyncTests.restore_runner
    update_canonical = fixtures.BacklogSyncTests.update_canonical
    set_state = fixtures.BacklogSyncTests.set_state

    def setUp(self):
        fixtures.BacklogSyncTests.setUp(self)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for name, value in {
            "ROOT": self.runtime, "STATE_PATH": self.runtime / "state.json",
            "CONFIG_PATH": self.runtime / "config.json",
            "LOG_PATH": self.runtime / "runner.log",
            "PROGRESS_PATH": self.runtime / "progress.json",
            "RUNNER_V2_PROGRESS_DIR": self.runtime / "progress",
            "AUTOPILOT_WAKE_PATH": self.runtime / "wake.json",
        }.items():
            self.stack.enter_context(patch.object(runner, name, value))
        self.cfg = {"workspace": str(self.work), "project": "GoBadminton", "prod_authorized": False, "max_parallel": 4}
        (self.runtime / "config.json").write_text(json.dumps(self.cfg))
        self.web["enabled"] = False
        self.api["enabled"] = False

    def prepare(self, additions):
        self.tasks = [self.web, self.api] + additions
        self.update_canonical(self.tasks)
        self.assertIn(backlog_sync.sync_once(self.work, self.runtime)["status"], {"SYNCED", "IN_SYNC"})
        return json.loads((self.runtime / "backlog.json").read_text())

    def state(self):
        return json.loads((self.runtime / "state.json").read_text())

    def item(self, name, locks, order):
        return fixtures.task(name, locks=locks, order=order, ref=self.ref)

    def test_four_compatible_selected_and_claimed(self):
        items = [self.item("radar", ["web:radar"], 0), self.item("games", ["web:games"], 1),
                 self.item("profiles", ["api:profiles"], 2), self.item("control", ["runner-control"], 3)]
        q = self.prepare(items)
        selected, _ = runner.select_runnable_tasks(q, self.state(), self.cfg)
        self.assertEqual([x["id"] for x in selected], [x["id"] for x in items])
        for item in selected:
            runner.claim_task(item)
        self.assertEqual(set(self.state()["active"]), {x["id"] for x in items})

    def test_broad_claim_blocks_stale_child_selection(self):
        broad = self.item("broad", ["web"], 0)
        child = self.item("child", ["web:radar"], 1)
        self.prepare([broad, child])
        runner.claim_task(broad)
        with self.assertRaises(RuntimeError):
            runner.claim_task(child)
        self.assertEqual(set(self.state()["active"]), {"broad"})

    def test_stale_selected_disabled_task_rejected(self):
        item = self.item("later-disabled", ["web:games"], 0)
        self.prepare([item])
        changed = dict(item, enabled=False)
        self.update_canonical([self.web, self.api, changed])
        self.assertIn(backlog_sync.sync_once(self.work, self.runtime)["status"], {"SYNCED", "IN_SYNC"})
        with self.assertRaises(RuntimeError):
            runner.claim_task(item)
        self.assertEqual(self.state()["active"], {})

    def test_fifth_disjoint_direct_claim_respects_capacity(self):
        items = [self.item("slot-" + str(i), ["independent-" + str(i)], i) for i in range(5)]
        self.prepare(items)
        for item in items[:4]:
            runner.claim_task(item)
        with self.assertRaises(RuntimeError):
            runner.claim_task(items[4])
        self.assertEqual(len(self.state()["active"]), 4)

if __name__ == "__main__":
    unittest.main()

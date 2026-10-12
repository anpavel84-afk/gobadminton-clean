"""P0 independent future QA input: valid deferred history remains terminal, never success.

These are author tests on an isolated additive source candidate; production history
is never normalized, edited or replaced.
"""
import copy
import unittest

import backlog_sync
import runner


class DeferredLegacyHistoryTests(unittest.TestCase):
    def setUp(self):
        self.history = [
            {"id": "launch-readiness-o01-legal-privacy-v001",
             "status": "deferred", "at": "2026-10-05T23:12:00+00:00"},
            {"id": "qa-preview-owner-b-messaging-status-evidence-reverify-01-v001",
             "status": "deferred", "at": "2026-10-07T01:54:02+00:00"},
            {"id": "accepted-source", "status": "completed", "at": "2026-10-08T22:12:27+00:00"},
            {"id": "historical-failed", "status": "qa_failed", "at": "2026-10-07T22:12:27+00:00"},
        ]
        self.state = {"version": 2, "paused": False, "active": {},
                      "history": self.history, "blocked": None}

    def test_exact_legacy_deferred_rows_accepted_unchanged(self):
        before = copy.deepcopy(self.history)
        backlog_sync.validate_history(self.history)
        self.assertEqual(self.history, before)

    def test_unknown_or_forged_verdict_never_accepted(self):
        for entry in ({"id": "x", "status": "unexpected"},
                      {"id": "x", "status": "deferred", "verdict": "PASS"},
                      {"id": "x", "status": "deferred", "task_id": "another"}):
            with self.subTest(entry=entry):
                with self.assertRaises(backlog_sync.InvalidRunnerState):
                    backlog_sync.validate_history([entry])

    def test_deferred_stays_terminal_even_if_queue_stale(self):
        pending = {"id": self.history[0]["id"], "order": 1, "status": "queued",
                   "enabled": True, "locks": ["runner-control"]}
        ready = {"id": "ready-new", "order": 2, "status": "queued",
                 "enabled": True, "locks": ["docs"]}
        q = {"tasks": [pending, ready]}
        self.assertIn(pending["id"], runner.completed_ids(self.state))
        self.assertEqual([x["id"] for x in runner.pending_tasks(q, self.state)],
                         [ready["id"]])
        rows = runner.queue_eligibility(q, self.state, {"max_parallel": 4})
        self.assertEqual(rows[0]["status"], "TERMINAL")
        self.assertEqual(rows[1]["status"], "READY")

    def test_deferred_does_not_satisfy_completed_or_accepted_dependencies(self):
        d = self.history[0]["id"]
        tasks = [
            {"id": d, "status": "queued", "enabled": False, "locks": ["runner-control"]},
            {"id": "future-dependency", "status": "queued", "enabled": True,
             "locks": ["docs"], "depends_on_completed": [d]},
            {"id": "future-acceptance", "status": "queued", "enabled": True,
             "locks": ["docs"], "depends_on_accepted": [d]},
        ]
        q = {"tasks": tasks}
        self.assertFalse(runner.dependencies_ready(tasks[1], q, self.state)[0])
        self.assertFalse(runner.dependencies_ready(tasks[2], q, self.state)[0])


if __name__ == "__main__":
    unittest.main()

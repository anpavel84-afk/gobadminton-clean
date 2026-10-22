"""Owner planner retries use durable outcomes, never semantic no-action polling."""
import json
import unittest
from unittest.mock import patch, MagicMock
from types import SimpleNamespace
import stat

import autopilot


class OwnerPlannerRetry(unittest.TestCase):
    def test_clean_prompt_allows_registered_verification_with_prior_findings_preserved(self):
        prompt = autopilot.build_prompt(
            {"project_repo": "anpavel84-afk/gobadminton-clean"}, owner_items=[])
        self.assertIn("friends-dev-s1-api-20261013-v002", prompt)
        self.assertIn("radar-dev-map-ui-20261013-v002", prompt)
        self.assertNotIn("terminal BLOCKED solely because", prompt)
        self.assertIn("dependency-only failure is not a prerequisite", prompt)
        self.assertIn("Carry every prior Foundation FAIL", prompt)
        self.assertIn("new task acceptance criteria", prompt)
        self.assertIn("actual Radar Style Guide parity evidence", prompt)
        self.assertIn("Unresolved findings remain FAIL/BLOCKED", prompt)
        self.assertIn("its own protected QA", prompt)
        self.assertIn("producer must not install dependencies", prompt)
        self.assertIn("Never rearm a terminal ID", prompt)
        self.assertIn("authorize product redevelopment", prompt)

    def state(self, outcome="planner_error"):
        return {"last_owner_input_key": "same", "last_owner_attempt_outcome": outcome,
                "last_owner_no_action_epoch": 1000, "status": "owner_instruction_backoff"}

    def test_failed_attempt_retries_only_at_300_seconds(self):
        state = self.state()
        self.assertTrue(autopilot.owner_input_backoff(state, "same", now=1299))
        self.assertFalse(autopilot.owner_input_backoff(state, "same", now=1300))

    def test_failure_classification_survives_backoff_and_restart(self):
        state = self.state()
        del state["last_owner_attempt_outcome"]
        state["status"] = "owner_instruction_planner_error_retriable"
        self.assertTrue(autopilot.owner_input_backoff(state, "same", now=1100))
        state["status"] = "owner_instruction_backoff"
        restarted = json.loads(json.dumps(state))
        self.assertFalse(autopilot.owner_input_backoff(restarted, "same", now=1300))

    def test_deployed_author_identity_failure_recovers_once_classified(self):
        state = self.state()
        del state["last_owner_attempt_outcome"]
        state["last_result"] = "planner author identity unavailable"
        self.assertFalse(autopilot.owner_input_backoff(state, "same", now=1300))
        self.assertEqual(state["last_owner_attempt_outcome"], "planner_error")

    def test_successful_decisions_do_not_retry_unchanged_inputs(self):
        for outcome in ("no_safe_action", "publication_unverified", "published", None):
            state = self.state(outcome)
            state["last_result"] = "planner author identity unavailable"
            if outcome is None:
                state["status"] = "owner_instruction_acknowledged_no_safe_action"
            with self.subTest(outcome=outcome):
                self.assertTrue(autopilot.owner_input_backoff(state, "same", now=10000))
                self.assertFalse(autopilot.owner_input_backoff(state, "changed", now=10000))

    def test_invalid_or_backward_clock_does_not_trigger_retry(self):
        for epoch in (None, "1000", True, 0, float("nan"), float("inf"), 2000):
            state = self.state()
            state["last_owner_no_action_epoch"] = epoch
            with self.subTest(epoch=epoch):
                self.assertTrue(autopilot.owner_input_backoff(state, "same", now=1300))

    def test_actual_readiness_change_unblocks_successful_no_safe_action(self):
        with patch.object(autopilot.os, "open", side_effect=FileNotFoundError):
            original = autopilot.runtime_readiness_key({"github_repo_write_authorized": False})
            changed = autopilot.runtime_readiness_key({"github_repo_write_authorized": True})
        args = ({"tasks": []}, {"history": []}, {"canonical_commit": "a"})
        first = autopilot.planning_input_key(*args, runtime_readiness=original)
        again = autopilot.planning_input_key(*args, runtime_readiness=original)
        next_key = autopilot.planning_input_key(*args, runtime_readiness=changed)
        state = self.state("no_safe_action")
        state["last_owner_input_key"] = first
        self.assertTrue(autopilot.owner_input_backoff(state, again, now=10000))
        self.assertFalse(autopilot.owner_input_backoff(state, next_key, now=10000))

    def test_readiness_ignores_monitor_timestamp_and_secret_config(self):
        with patch.object(autopilot.os, "open", side_effect=FileNotFoundError) as opened:
            a = autopilot.runtime_readiness_key({"owner_issue_intake_enabled": True,
                "updated_at": "first", "github_token": "secret-one"})
            b = autopilot.runtime_readiness_key({"owner_issue_intake_enabled": True,
                "updated_at": "second", "github_token": "secret-two",
                "publisher_policy": "/tmp/caller-supplied"})
        self.assertEqual(a, b)
        self.assertEqual({call.args[0] for call in opened.call_args_list}, {
            "/etc/gobadminton-clean-control-plane/clean-publisher-policy.json",
            "/var/lib/gobadminton-clean-trusted-qa-evidence/policy.json"})

    def test_unreadable_policy_marker_is_stable(self):
        with patch.object(autopilot.os, "open", side_effect=PermissionError("secret path")):
            self.assertEqual(autopilot.runtime_readiness_key({}),
                             autopilot.runtime_readiness_key({}))

    def test_policy_bytes_change_readiness_but_stat_timestamps_do_not(self):
        stream = MagicMock()
        stream.__enter__.return_value = stream
        info = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0,
                               st_size=2, st_mtime=1)
        with patch.object(autopilot.os, "open", return_value=99), patch.object(
                autopilot.os, "fdopen", return_value=stream), patch.object(
                autopilot.os, "fstat", return_value=info):
            stream.read.return_value = b"{}"
            first = autopilot.runtime_readiness_key({})
            info.st_mtime = 5000
            self.assertEqual(first, autopilot.runtime_readiness_key({}))
            stream.read.return_value = b'{"ready":true}'
            self.assertNotEqual(first, autopilot.runtime_readiness_key({}))
            self.assertTrue(all(c.args == (65537,) for c in stream.read.call_args_list))
            stream.read.reset_mock()
            info.st_size = 65537
            invalid = autopilot.runtime_readiness_key({})
            stream.read.assert_not_called()
            info.st_uid = 1000
            self.assertEqual(invalid, autopilot.runtime_readiness_key({}))


if __name__ == "__main__":
    unittest.main()

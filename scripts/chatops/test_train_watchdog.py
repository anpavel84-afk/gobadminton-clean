import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("watchdog", Path(__file__).with_name("train_watchdog.py"))
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


class WatchdogTests(unittest.TestCase):
    def snapshot(self, phase="ci", reason=None):
        return {"active": {"issue": 64, "head": "a" * 40, "phase": phase, "reason": reason}, "done": []}

    def classify(self, phase="ci", active="active", holder=123, helper=False, age=900, reason=None):
        return w.classify(self.snapshot(phase, reason), {"MainPID": "123", "ActiveState": active}, holder, helper, age)

    def test_live_worker_quota_or_ci_not_a_stall(self):
        for phase in ["ci", "qa", "developing", "pr_wait", "dev_wait"]:
            self.assertIsNone(self.classify(phase, age=999999))

    def test_blocked_live_service_is_alarm(self):
        self.assertEqual(self.classify("blocked", reason="QA FAIL; attempts exhausted")["kind"], "qa_exhausted")

    def test_stopped_with_work_is_alarm(self):
        self.assertEqual(self.classify(active="inactive", holder=0)["kind"], "worker_stopped")

    def test_finite_operator_owns_lock_is_maintenance(self):
        self.assertIsNone(self.classify("blocked", active="inactive", holder=234, helper=True))

    def test_unknown_holder_is_alarm(self):
        self.assertEqual(self.classify(holder=234)["kind"], "worker_lock_missing")

    def test_startup_grace_then_missing_lock(self):
        self.assertIsNone(self.classify(holder=0, age=30))
        self.assertEqual(self.classify(holder=0, age=121)["kind"], "worker_lock_missing")

    def test_all_expected_work_done_silences_stopped_service(self):
        self.assertIsNone(w.classify({"active": {"phase": "done"}, "done": [64, 66, 68]},
                                    {"MainPID": "0", "ActiveState": "inactive"}, 0, False, 900))

    def test_repeat_incident_dedup_and_recovery(self):
        ledger, sent = {}, []
        incident = self.classify("blocked")
        def send(i, episode):
            sent.append(episode)
            return "message-id"
        self.assertEqual(w.reconcile(ledger, incident, 0, send), "confirming")
        self.assertEqual(w.reconcile(ledger, incident, 120, send), "notified")
        self.assertEqual(w.reconcile(ledger, incident, 240, send), "already_notified")
        w.reconcile(ledger, None, 300, send)
        w.reconcile(ledger, incident, 360, send)
        w.reconcile(ledger, incident, 480, send)
        self.assertEqual(len(sent), 2)
        self.assertNotEqual(sent[0], sent[1])

    def test_failure_not_marked_sent_and_backoff(self):
        ledger, attempts = {}, []
        def fail(i, episode):
            attempts.append(episode)
            raise TimeoutError("must-not-log-secret")
        i = self.classify("blocked")
        w.reconcile(ledger, i, 0, fail)
        self.assertEqual(w.reconcile(ledger, i, 120, fail), "delivery_failed")
        self.assertEqual(ledger["status"], "pending")
        self.assertNotIn("must-not-log-secret", json.dumps(ledger))
        self.assertEqual(w.reconcile(ledger, i, 240, fail), "delivery_backoff")
        self.assertEqual(len(attempts), 1)

    def test_monitor_failure_requires_two_observations(self):
        i = {"kind": "monitor_unavailable", "issue": None, "phase": None, "sha": ""}
        ledger = {}
        self.assertEqual(w.reconcile(ledger, i, 0, lambda *_: "id"), "confirming")
        self.assertEqual(w.reconcile(ledger, i, 120, lambda *_: "id"), "notified")

    def test_config_permissions_and_tls_required(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "config.json"
            c = {"enabled": True, "host": "smtp.invalid", "port": 587, "tls": "starttls",
                 "from": "owner@example.invalid", "to": "owner@example.invalid"}
            p.write_text(json.dumps(c)); p.chmod(0o600)
            self.assertEqual(w.smtp_config(p), c)
            p.chmod(0o644)
            with self.assertRaises(ValueError): w.smtp_config(p)
            p.chmod(0o600); c["tls"] = "none"; p.write_text(json.dumps(c))
            with self.assertRaises(ValueError): w.smtp_config(p)

    def test_symlink_config_denied(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "real"; p.write_text("{}"); p.chmod(0o600)
            link = Path(d) / "link"; link.symlink_to(p)
            with self.assertRaises(OSError): w.read_json(link, private=True)

    def test_starttls_precedes_login_and_send(self):
        events = []
        class SMTP:
            def __init__(self, *args, **kw): pass
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def ehlo(self): events.append("ehlo")
            def starttls(self, context):
                self_tls = context.check_hostname
                assert self_tls
                events.append("tls")
            def login(self, *args): events.append("login")
            def send_message(self, msg): events.append("send"); return {}
        c = {"host": "smtp.invalid", "port": 587, "tls": "starttls", "username": "u", "password": "secret",
             "from": "owner@example.invalid", "to": "owner@example.invalid"}
        with patch.object(w.smtplib, "SMTP", SMTP):
            result = w.send_mail({"kind": "test"}, "episode", c)
        self.assertEqual(events, ["ehlo", "tls", "ehlo", "login", "send"])
        self.assertIn("episode", result)

    def test_atomic_delivery_state_private(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "state.json"
            w.atomic(p, {"status": "pending"})
            self.assertEqual(os.stat(p).st_mode & 0o777, 0o600)
            self.assertEqual(w.read_json(p, private=True), {"status": "pending"})


if __name__ == "__main__":
    unittest.main()

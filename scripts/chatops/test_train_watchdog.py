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
        self.assertEqual(self.classify("blocked", active="inactive", holder=234, helper=True), {"kind": "maintenance"})

    def test_maintenance_does_not_rearm_existing_alert(self):
        ledger = {"version": 1, "status": "sent", "fingerprint": "existing"}
        before = dict(ledger)
        self.assertEqual(w.reconcile(ledger, {"kind": "maintenance"}, 400, lambda *_: "id"), "maintenance")
        self.assertEqual(ledger, before)

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


class ActionsWatchdogTests(unittest.TestCase):
    def snapshot(self,status='waiting',now=100,**extra):
        card={'status':status,'stage':'QA','issue':207,'head':'a'*40,
              'operation':'qa','workflow_run':123,'supervisor':{'pid':12,'start':'100','boot':'synthetic'}}
        card.update(extra)
        return {'schema':'GB_ACTIONS_MONITOR_SOURCE_V1','mode':'active','observed_at':now,
                'slots':{'slot1':card}}

    def test_unknown_is_wired_to_main_collect_and_does_not_rearm_as_projection_ages(self):
        snap=self.snapshot('unknown')
        with patch.object(w,'read_json',return_value=snap):
            state,events,incident=w.collect_idle({},100)
            self.assertEqual(incident['kind'],'operation_unknown')
            self.assertEqual(events[0]['code'],'TRAIN_OPERATION_UNKNOWN')
            sent=[];ledger={}
            send=lambda *a:sent.append(a) or 'id'
            w.reconcile(ledger,incident,100,send)
            _,_,same=w.collect_idle(state,220)
            self.assertEqual(same,incident)
            w.reconcile(ledger,same,220,send)
            _,_,same=w.collect_idle(state,340)
            self.assertEqual(w.reconcile(ledger,same,340,send),'already_notified')
            self.assertEqual(len(sent),1)

    def test_global_staleness_respects_existing_fifteen_minute_rescue_cadence(self):
        snap=self.snapshot(stage=None)
        for now in (220,1000,1900):
            self.assertEqual(w.actions_incidents(snap,{},now)[2],[])
        operations,events,incidents=w.actions_incidents(snap,{},1901)
        self.assertEqual(incidents[0]['kind'],'monitor_stale')
        self.assertEqual(events[0]['code'],'TRAIN_EVIDENCE_STALE')
        self.assertNotIn('ready',str(incidents))
        snap['mode']='shadow'
        self.assertEqual(w.actions_incidents(snap,{},99999)[2],[])

    def test_running_requires_exact_process_deadline_not_old_checkpoint(self):
        snap=self.snapshot('running')
        before=json.loads(json.dumps(snap))
        for seconds in (10,1800,2400):
            self.assertEqual(w.actions_incidents(snap,{},100,lambda _:dict(state='alive',seconds=seconds))[2],[])
        incidents=w.actions_incidents(snap,{},100,lambda _:dict(state='alive',seconds=2401))[2]
        self.assertEqual(incidents[0]['kind'],'operation_stalled')
        self.assertEqual(snap,before)
        snap['slots']['slot1']['status']='waiting'
        self.assertEqual(w.actions_incidents(snap,{},100,lambda _:dict(state='alive',seconds=999999))[2],[])

    def test_gone_or_uninspectable_process_is_unknown_without_restart(self):
        snap=self.snapshot('running')
        incidents=w.actions_incidents(snap,{},100,lambda _:dict(state='gone'))[2]
        self.assertEqual(incidents[0]['kind'],'operation_unknown')
        state,_,first=w.actions_incidents(snap,{},100,lambda _:dict(state='unknown'))
        self.assertFalse(first)
        _,_,second=w.actions_incidents(snap,{'operations':state},220,lambda _:dict(state='unknown'))
        self.assertEqual(second[0]['kind'],'operation_unknown')
        self.assertNotIn('repair',json.dumps(second))

    def test_blocked_and_exhausted_are_wired_without_raw_reason_leak(self):
        snap=self.snapshot('error',previous_result={'issue':225,'status':'deferred','reason':'attempts exhausted'})
        with patch.object(w,'read_json',return_value=snap):
            _,_,incident=w.collect_idle({},100)
        self.assertEqual(incident['kind'],'qa_exhausted')
        snap['slots']['slot1']['previous_result']['reason']='SECRET_RAW_DIAGNOSTIC'
        with patch.object(w,'read_json',return_value=snap):
            _,_,incident=w.collect_idle({},100)
        self.assertEqual(incident['kind'],'train_blocked')
        self.assertNotIn('SECRET_RAW_DIAGNOSTIC',json.dumps(incident))

    def test_stale_planning_never_fabricates_current_eligible_task(self):
        snap=self.snapshot('waiting',now=2001,stage=None,issue=None,planning={
            'observed_at':100,'reason':'no_eligible_admission'})
        incident=w.actions_incidents(snap,{},2001)[2][0]
        self.assertEqual(incident['kind'],'planning_stale')
        self.assertIsNone(incident['issue'])
        self.assertNotIn('ready',json.dumps(incident))

    def test_process_identity_reads_only_exact_stat_boot_uptime(self):
        stat_tail=['S']+['0']*18+['100']
        seen=[]
        def read(path,*args,**kwargs):
            seen.append(str(path))
            if str(path).endswith('/boot_id'):return 'synthetic'
            if str(path)=='/proc/12/stat':return '12 (safe name) '+' '.join(stat_tail)
            if str(path)=='/proc/uptime':return '50 0'
            raise AssertionError('unscoped process read')
        with patch.object(Path,'read_text',read),patch.object(w.os,'sysconf',return_value=10):
            self.assertEqual(w.process_observation({'pid':12,'start':'100','boot':'synthetic'}),
                             {'state':'alive','seconds':40})
            self.assertEqual(w.process_observation({'pid':12,'start':'101','boot':'synthetic'}),{'state':'gone'})
        self.assertFalse(any('cmdline' in p or 'environ' in p for p in seen))

    def test_disabled_smtp_still_records_incident_and_bounded_delivery_backoff(self):
        ledger={};incident=w.actions_incidents(self.snapshot('unknown'),{},100)[2][0]
        send=lambda *_:(_ for _ in ()).throw(ValueError('smtp_not_configured'))
        self.assertEqual(w.reconcile(ledger,incident,100,send),'confirming')
        self.assertEqual(w.reconcile(ledger,incident,220,send),'delivery_failed')
        self.assertEqual(ledger['status'],'pending')
        self.assertEqual(ledger['delivery_error'],'ValueError')
        self.assertEqual(w.reconcile(ledger,incident,340,send),'delivery_backoff')
        self.assertLessEqual(ledger['retry_at']-220,3600)


if __name__ == "__main__":
    unittest.main()

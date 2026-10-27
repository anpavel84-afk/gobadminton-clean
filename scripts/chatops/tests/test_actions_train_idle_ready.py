"""Regression: admission continuity, dispatch coalescing, idle episodes. No live effects."""
import copy
import datetime as dt
import importlib.util
from pathlib import Path
import unittest
from test_actions_train import A,S,core,receiver,TASK,issue,card,NOW,STAMP
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location("watchdog",ROOT/"scripts/chatops/train_watchdog.py")
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)

def snapshot(now=100):
    counts={"assigned":1,"ready":0}
    p={"reason":"dispatch_pending","generation":7,"counts":counts,
       "decisions":[{"issue":207,"code":"assigned"}],"observed_at":now,"workflow_run":123}
    return {"schema":"GB_ACTIONS_MONITOR_SOURCE_V1","mode":"active","observed_at":now,
            "slots":{"slot1":{"status":"waiting","stage":"Accepted","planning":p}}}

class IdleReady(unittest.TestCase):
    def test_three_minute_episode_survives_fresh_reconcile_and_alerts_after_fifteen(self):
        state,events=w.idle_ready(snapshot(),{},100);self.assertFalse(events)
        state,events=w.idle_ready(snapshot(200),state,200);self.assertFalse(events)
        state,events=w.idle_ready(snapshot(281),state,281)
        self.assertEqual(events[0]["code"],"SLOT_IDLE_WITH_READY_TASK")
        self.assertEqual(events[0]["since"],100)
        with patch.object(w,"read_json",return_value=snapshot(1001)):
            state,events,incident=w.collect_idle(state,1001)
        self.assertEqual(incident["kind"],"slot_idle")
        sent=[];ledger={}
        w.reconcile(ledger,incident,1001,lambda *a:sent.append(a) or "id")
        w.reconcile(ledger,incident,1062,lambda *a:sent.append(a) or "id")
        w.reconcile(ledger,incident,1123,lambda *a:sent.append(a) or "id")
        self.assertEqual(len(sent),1)
    def test_unrelated_global_assignments_do_not_reset_slot_or_fabricate_target(self):
        state,_=w.idle_ready(snapshot(),{},100)
        s=snapshot(400);s["slots"]["slot1"]["planning"]["decisions"]=[{"issue":205,"code":"assigned"},{"issue":207,"code":"assigned"}]
        with patch.object(w,"read_json",return_value=s):
            state,events,incident=w.collect_idle(state,1001)
        self.assertEqual(state["slots"]["slot1"]["since"],100)
        self.assertIsNone(incident["issue"])
        self.assertNotIn("issues",events[0]["key"])

    def test_global_ready_count_never_grants_per_slot_readiness(self):
        s=snapshot();s["slots"]["slot1"]["planning"]["reason"]="dependencies_or_conflicts"
        s["slots"]["slot1"]["planning"]["counts"]={"ready":10}
        self.assertEqual(w.idle_ready(s,{},100)[0]["slots"],{})
    def test_occupied_disabled_new_assignment_or_changed_generation_resets_episode(self):
        state,_=w.idle_ready(snapshot(),{},100)
        for mode in ("running","unknown","not_started"):
            s=snapshot(400);s["slots"]["slot1"]["status"]=mode
            self.assertFalse(w.idle_ready(s,state,400)[1])
        s=snapshot(400);s["mode"]="disabled";self.assertFalse(w.idle_ready(s,state,400)[1])
        s=snapshot(400);s["slots"]["slot1"]["planning"]["generation"]=8
        self.assertFalse(w.idle_ready(s,state,400)[1])
    def test_stale_or_future_evidence_not_reported_current_ready(self):
        state,_=w.idle_ready(snapshot(),{},100)
        for now in (400,1000):
            _,events=w.idle_ready(snapshot(100),state,now)
            self.assertEqual(events[0]["code"],"SLOT_IDLE_EVIDENCE_STALE")
            self.assertEqual(events[0]["reason"],"planning_evidence_stale")
    @patch("cost_policy.EPOCH", "2100-01-01T00:00:00+00:00")
    def test_edited_issue_comment_restores_single_admission_without_relaxation(self):
        parent=issue(207);parent["updated_at"]=(NOW+dt.timedelta(seconds=1)).isoformat()
        comment={"id":123,"issue_url":f"https://api.github.com/repos/{core.REPO}/issues/207",
                 "user":{"id":core.OWNER},"body":parent["body"],"created_at":STAMP,"updated_at":STAMP}
        since=NOW-dt.timedelta(days=1)
        self.assertEqual(S.admitted(A,[parent],[],since),[])
        self.assertEqual(S.admitted(A,[parent],[comment],since),[(207,TASK)])
        self.assertEqual(S.admitted(A,[parent],[comment,dict(comment,id=124)],since),[])
    def test_both_slots_and_no_duplicate_after_queued_claim(self):
        snap={"slots":{"slot1":card(),"slot2":card()}}
        candidates=[(205,TASK|{"allowed_paths":["apps/web/src/venue.ts"],"locks":["web:venues"]}),
                    (207,TASK|{"allowed_paths":["apps/admin/src/venue.ts"],"locks":["admin:venues"]})]
        before=copy.deepcopy(snap);first=core.plan(A,S,snap,candidates)
        self.assertEqual(len(first),1)
        self.assertIn(first[0]["slot"],{"slot1","slot2"})
        self.assertEqual({x["issue"] for x in first},{205});self.assertEqual(snap,before)
        self.assertEqual(first,core.plan(A,S,snap,candidates))
        for intent in first:
            c=snap["slots"][intent["slot"]];c["pending"]={"status":"running"}
            c["reservation"]=S.task_record(intent["issue"],dict(candidates)[intent["issue"]])
        self.assertEqual(core.plan(A,S,snap,candidates),[])
    def test_only_reconcile_wakes_coalesce_not_effectful_stages(self):
        dispatch=(ROOT/".github/workflows/train-dispatch.yml").read_text()
        stage=(ROOT/".github/workflows/train-stage.yml").read_text()
        self.assertIn("queue: single",dispatch);self.assertIn("cancel-in-progress: false",dispatch)
        self.assertNotIn("queue: single",stage)
        self.assertIn("queue: max",stage)
        client=(ROOT/"scripts/chatops/actions_train/client.py").read_text()
        self.assertIn("issues?state=open&sort=created&direction=asc",client)
        self.assertIn("comments.extend(api.pages",client)
if __name__=="__main__":unittest.main()

"""Cost-routing, immutable compatibility, deterministic-first QA and metered unlimited budgets."""
import copy, datetime as dt, json, tempfile, unittest
from pathlib import Path
from unittest.mock import Mock,patch
from test_actions_train import A,S,TASK,HEAD,NOW,STAMP,core,stage,issue
import cost_policy as policy

def cost_task(author="standard",qa="standard"):
    t=TASK|{"work_kind":"implementation","risk":"complex",
            "author_routes":[policy.MATRIX[author]],"qa_routes":[policy.MATRIX[qa]]}
    t["routing_policy"]={"schema":policy.SCHEMA}
    for role,level in [("author",author),("qa",qa)]:
        t["routing_policy"][role]={"complexity":level,"reason":"standard_ui",
                                   "evidence":"Existing typed UI components and deterministic regression tests."}
        if level=="simple":t["routing_policy"][role]["reason"]="bounded_docs"
        elif level=="complex":t["routing_policy"][role]["reason"]="complex_logic"
        elif level in ("expert","critical"):t["routing_policy"][role]["reason"]="security"
    return t

class Routes(unittest.TestCase):
    def setUp(self):
        self.budget=Mock(remaining=lambda *a:10,used=lambda *a:2)
    def pick(self,t,role="qa"):
        return core.route(S,t,role,"auto",self.budget,"slot1")
    def test_complex_risk_does_not_make_standard_qa_expensive(self):
        t=cost_task("complex","standard");before=copy.deepcopy(t)
        self.assertEqual(self.pick(t)["effective_model"],"gpt-6.1-sol")
        self.assertEqual(self.pick(t)["effort"],"medium")
        self.assertEqual(self.pick(t,"author")["effort"],"high");self.assertEqual(t,before)
    def test_all_five_tiers_are_explicit_and_approved(self):
        for level,route in policy.MATRIX.items():
            c=self.pick(cost_task(level,level))
            self.assertEqual("codex:"+c["effective_model"]+":"+c["effort"],route)
    def test_high_astra_needs_specific_reason_evidence_and_no_complex_shortcut(self):
        for change in ({"reason":"complex_logic"},{"evidence":"complex"},{"evidence":" "*20},{"evidence":"  x  "},{"evidence":"meaningful\ncontrolcharacters"}):
            t=cost_task("critical","critical");t["routing_policy"]["qa"].update(change)
            with self.assertRaises(core.Refused):self.pick(t)
    def test_no_silent_extra_route_or_availability_escalation(self):
        t=cost_task();t["qa_routes"]=["codex:gpt-6-astra:high"]
        with self.assertRaises(core.Refused):self.pick(t)
        t=cost_task();t["qa_routes"].append("codex:gpt-6-astra:high")
        with patch.object(S,"adapter_status",return_value=(False,"provider quota")):
            with self.assertRaises(core.Refused):self.pick(t)
    def test_legacy205207_route_preserved_and_flagged(self):
        t=cost_task();t.pop("routing_policy");t["qa_routes"]=["codex:gpt-6-astra:high"]
        c=self.pick(t)
        self.assertEqual(c["effective_model"],"gpt-6-astra");self.assertEqual(c["effort"],"high")
        self.assertEqual(c["expense_diagnostic"],"UNRECORDED_ESCALATION_REASON")
    def test_new_auth_requires_cost_metadata_but_old_immutable_task_unchanged(self):
        parent=issue(999);since=NOW-dt.timedelta(days=1)
        self.assertEqual(S.admitted(A,[parent],[],since),[])
        parent=issue(999,cost_task());self.assertEqual(S.admitted(A,[parent],[],since),[(999,cost_task())])
        parent["updated_at"]="edited";self.assertEqual(S.admitted(A,[parent],[],since),[])
    def test_receipt_does_not_invent_token_or_money_data(self):
        u=policy.usage(30,31,"raised")
        self.assertEqual(u["charged_calls"],1);self.assertIsNone(u["tokens"]);self.assertIsNone(u["money"])
        self.assertTrue(u["repeat_needed"])
    def test_failed_stage_retains_actual_call_receipt(self):
        b=Mock(routing_receipts=[{"effective_model":"gpt-6.1-sol","usage":policy.usage(30,31,"raised")}])
        r=stage.model_receipt({"status":"unknown"},(None,None,None,None,None,b))
        self.assertEqual(r["routing"]["usage"]["charged_calls"],1)
        self.assertEqual(r["routing"]["stage_result"],"unknown")

class UnlimitedBudget(unittest.TestCase):
    def test_history_continues_past_old30_and_json_is_standard(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);(p/"out/slot1").mkdir(parents=True);(p/"lock").touch(mode=0o660)
            (p/"limits.json").write_text(json.dumps({"providers":{"codex":{"qa":"unlimited"}},"slots":{"slot1":{"codex":{"qa":"unlimited"}}}}))
            b=S.Budget(p/"limits.json",p/"out",p/"lock",today=lambda:"2026-10-22")
            ledger=p/"out/slot1/ledger.json";ledger.write_text(json.dumps({"2026-10-22":{"codex":{"qa":30}},"2026-10-21":{"codex":{"qa":9}}}))
            self.assertEqual(b.remaining("codex","qa","slot1"),float("inf"));b.charge("slot1","codex","qa")
            self.assertEqual(b.used("codex","qa","slot1"),31);self.assertEqual(json.loads(ledger.read_text())["2026-10-21"]["codex"]["qa"],9)
            c=core.route(S,cost_task(),"qa","auto",b,"slot1")
            self.assertEqual(c["budget_policy"],"unlimited_daily_metered");self.assertIsNone(c["remaining_calls"])
            json.dumps(c,allow_nan=False)
    def test_unknown_finite_and_disabled_adapter_are_not_bypassed(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);b=S.Budget(p/"limits.json",p/"out",p/"lock")
            self.assertIs(b.remaining("codex","qa"),S.UNKNOWN)
            (p/"limits.json").write_text(json.dumps({"providers":{"codex":{"qa":2}},"slots":{"slot1":{"codex":{"qa":"unlimited"}}}}))
            self.assertEqual(b.remaining("codex","qa","slot1"),2)
            self.assertFalse(S.adapter_status("agy","qa",b,"slot1")[0])
        for value in (True,-1,"free","infinity"):
            with self.assertRaises(S.Hold):S.Budget._limit({"codex":{"qa":value}},"codex","qa")

class DeterministicFirst(unittest.TestCase):
    def setUp(self):
        from test_actions_train_stages import StageBoundaries
        self.helper=StageBoundaries();self.helper.setUp()
        for name in ("store","bridge","rt","context","run_stage"):
            setattr(self,name,getattr(self.helper,name))
        self.store.data["active"]["task"]=cost_task()
    def tearDown(self):self.helper.tearDown()
    def test_pending_checks_never_spend_model_call_or_mutate_checkpoint(self):
        self.store.data["active"]["phase"]="pr_wait";before=copy.deepcopy(self.store.data)
        with patch.object(stage,"run_result",side_effect=core.Retry("checks pending")):
            with self.assertRaises(core.Retry):self.run_stage("qa")
        self.assertEqual(self.store.data,before);self.assertNotIn("qa",self.bridge.calls)
    def test_failed_checks_schedule_bounded_repair_without_fake_independent_qa(self):
        a=self.store.data["active"];a["phase"]="pr_wait"
        a["ci_failure"]={"head":HEAD,"run":999,"failed":[{"job":"source (web)","steps":["lint"]}]}
        with patch.object(stage,"run_result",side_effect=A.Hold("Actions failed")):
            r=self.run_stage("qa")
        self.assertNotIn("qa",self.bridge.calls);self.assertIsNone(a.get("qa"))
        self.assertEqual(a["phase"],"pr_wait");self.assertEqual(core.next_stage(a),"author")
        self.assertTrue(a["independent_qa_pending"]);self.assertIn("model_call_skipped",r)
    def test_checks_pass_still_require_real_independent_review(self):
        self.store.data["active"]["phase"]="pr_wait"
        with patch.object(stage,"run_result",return_value={"id":999,"sha":HEAD}):
            self.run_stage("qa")
        self.assertIn("qa",self.bridge.calls)
        self.assertEqual(self.store.data["active"]["qa"]["reviewed_sha"],HEAD)
if __name__=="__main__":unittest.main()

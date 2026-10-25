"""SR1 synthetic classifier cases SR-T01..SR-T28. No provider, install, or network."""
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts/chatops/actions_train"))
import smart_routing as sr

SHA = "a" * 40
HS = "b" * 64
BIND = {"task_sha": HS, "rules_commit": SHA, "rules_sha256": HS, "head": SHA, "operation_id": "op-1"}
PINS = {
    "code_commit": SHA, "code_sha256": HS,
    "capsule_commit": SHA, "capsule_sha256": HS,
    "policy_commit": SHA, "policy_sha256": HS,
    "policy_bytes_match": True,
}
QA = {"qa_independent": True, "qa_route_proof": "codex:gpt-6.1-sol:high",
      "session_shared": False, "author_qa_same_snapshot": False}


def case(evidence, **updates):
    value = {"schema": sr.CASE_SCHEMA, "semantics": "new", "classifier_selected": True,
             "binding": dict(BIND), "pins": dict(PINS), "evidence": evidence}
    value.update(updates)
    return value


def ready(**updates):
    evidence = {
        "context_complete": True, "context_hash_ok": True, "scope_within_admission": True,
        "finite_budget": True, "acceptance_unchanged": True, "external_effects_unknown": False,
        "architecture_research_required": False, "reconciled": True, "qa_independent": True,
        "risk": "low", "cause": "proven", "effects_proven_absent": True,
    }
    evidence.update(updates)
    return evidence


def search(instances=1, saved=True, assurance_only=False):
    return {"saved": saved, "method": "grep", "pattern": "OldExport", "scope": "apps/web/src",
            "instances": instances, "assurance_only": assurance_only}


def fast(**updates):
    evidence = ready(cause="proven", risk="low", change_surface="rename", complexity="mechanical",
                     minimal_action_known=True, regression_known=True, defect_fingerprint="fp-export",
                     class_search=search(), author_attempts=1, continuation_used=0,
                     effective_model_exposed=False)
    evidence.update(updates)
    return evidence


def plan(**updates):
    value = {
        "schema": sr.PLAN_SCHEMA, "author_route": "cursor:auto",
        "qa_route": "codex:gpt-6.1-sol:medium", "planner_calls": 0, "astra_calls": 0,
        "fast_fix": False, "effects": ["source_edit_within_scope"], "model_ids": [],
        "rights_delta": [], "binding": dict(BIND), "delete_assertions": False,
        "weaken_auth": False, "disable_security": False, "executable": True,
    }
    value.update(updates)
    return value


def check(decision):
    if decision["qa_verdict"] == "PASS":
        raise AssertionError("classifier emitted QA PASS")
    if decision["author_attempts_delta"] != 0 or decision["history_reset"] or decision["policy_rewritten"]:
        raise AssertionError(decision)
    if decision["rewritten_task"] is not None or decision["owner_micro_go"]:
        raise AssertionError(decision)
    return decision


class SmartRoutingSR1(unittest.TestCase):
    def test_sr_t01_proven_template_skips_planner_and_astra(self):
        decision = check(sr.decide(case(ready(
            template_id="formatter", template_applicable=True, template_tool="deterministic_tool",
            change_surface="format", risk="low"))))
        self.assertEqual(decision["event_class"], "TEMPLATE")
        self.assertEqual(decision["planner_calls"], 0)
        self.assertEqual(decision["astra_calls"], 0)
        self.assertEqual(decision["model_calls"], 0)
        self.assertEqual(decision["route"], "deterministic_tool")
        self.assertFalse(decision["fast_fix"])

    def test_sr_t02_auth_lint_keeps_risk_floor(self):
        decision = check(sr.decide(case(ready(
            template_id="eslint-simple", template_applicable=True, template_tool=None,
            change_surface="auth", risk="low", line_count=1, event_text="error TS2322",
            suggested_class="SOURCE_KNOWN_LOCAL", **QA))))
        self.assertFalse(decision["fast_fix"])
        self.assertEqual(decision["risk"], "critical")
        self.assertEqual(decision["event_class"], "SOURCE_CRITICAL")
        self.assertEqual(decision["astra_calls"], 1)
        self.assertNotEqual(decision["route"], "cursor:auto")

    def test_sr_t03_unknown_ordinary_task_uses_one_technical_pm(self):
        decision = check(sr.decide(case(ready(cause="unresolved", risk="moderate", complexity="standard"))))
        self.assertEqual(decision["planner_calls"], 1)
        self.assertEqual(decision["astra_calls"], 0)
        self.assertEqual(decision["model_calls"], 1)
        self.assertEqual(decision["route"], "codex:gpt-6.1-sol:high")
        self.assertEqual(decision["author_route"], "cursor:auto")
        self.assertEqual(decision["qa_route"], "codex:gpt-6.1-sol:medium")
        self.assertFalse(decision["writer"])

    def test_sr_t04_usable_brief_is_not_replayed(self):
        decision = check(sr.decide(case(ready(
            brief_usable=True, cause="proven", risk="moderate", author_attempts=1))))
        self.assertEqual(decision["planner_calls"], 0)
        self.assertEqual(decision["astra_calls"], 0)
        self.assertEqual(decision["event_class"], "SOURCE_KNOWN_STANDARD")

    def test_sr_t05_known_complex_noncritical_skips_astra(self):
        decision = check(sr.decide(case(ready(
            cause="proven", complexity="complex", risk="moderate", change_surface="state",
            difficult_or_repeating=False, brief_usable=False))))
        self.assertEqual(decision["event_class"], "SOURCE_KNOWN_COMPLEX")
        self.assertEqual(decision["author_route"], "codex:gpt-6.1-sol:high")
        self.assertEqual(decision["astra_calls"], 0)
        self.assertEqual(decision["planner_calls"], 0)

    def test_sr_t06_one_line_critical_uses_expert_and_qualified_qa(self):
        decision = check(sr.decide(case(ready(
            risk="critical", line_count=1, event_text="if (ok)", change_surface="auth",
            critical_signs=True, **QA))))
        self.assertEqual(decision["event_class"], "SOURCE_CRITICAL")
        self.assertEqual(decision["route"], "codex:gpt-6-astra:high")
        self.assertEqual(decision["qa_route"], "codex:gpt-6.1-sol:high")
        self.assertEqual(decision["astra_calls"], 1)
        self.assertFalse(decision["fast_fix"])
        self.assertFalse(decision["writer"])

    def test_sr_t07_failed_fast_fix_cannot_repeat(self):
        decision = check(sr.decide(case(fast(prior_fast_fix={"fingerprint": "fp-export", "result": "fail"}))))
        self.assertFalse(decision["fast_fix"])
        self.assertTrue(decision["fast_fix_closed"])
        self.assertEqual(decision["author_attempts"], 1)
        self.assertEqual(decision["route"], "codex:gpt-6.1-sol:high")

    def test_sr_t08_critical_finding_is_not_averaged_away(self):
        findings = [{"id": "f1", "severity": "low", "location": "apps/web/src/a.ts"},
                    {"id": "f2", "severity": "critical", "location": "apps/web/src/auth.ts"}]
        decision = check(sr.decide(case(ready(
            findings=findings, risk="low", suggested_class="SOURCE_KNOWN_LOCAL", **QA))))
        self.assertEqual([item["id"] for item in decision["findings"]], ["f1", "f2"])
        self.assertEqual(decision["risk"], "critical")
        self.assertEqual(decision["event_class"], "SOURCE_CRITICAL")
        self.assertFalse(decision["fast_fix"])

    def test_sr_t09_changed_binding_is_not_executed(self):
        stale = plan(binding=dict(BIND, head="c" * 40))
        decision = check(sr.decide(case(ready(plan=stale, risk="moderate"))))
        self.assertFalse(decision["executed"])
        self.assertEqual(decision["route"], "revalidate")
        self.assertEqual(decision["operation_id"], "op-1")
        self.assertFalse(decision["plan_honored"])

    def test_sr_t10_duplicate_dispatch_keeps_one_call(self):
        decision = check(sr.decide(case(ready(dispatch_duplicate=True))))
        self.assertTrue(decision["duplicate_suppressed"])
        self.assertEqual(decision["model_calls"], 1)
        self.assertEqual(decision["operation_id"], "op-1")
        self.assertFalse(decision["executed"])

    def test_sr_t11_unknown_effect_blocks_fallback_and_writer(self):
        decision = check(sr.decide(case(ready(
            unknown_effect=True, reconciled=False, fallback_route="codex:gpt-6.1-sol:medium",
            fallback_equivalent=True))))
        self.assertEqual(decision["event_class"], "UNKNOWN_EFFECT")
        self.assertFalse(decision["executed"])
        self.assertFalse(decision["writer"])
        self.assertIsNone(decision["fallback_reason"])

    def test_sr_t12_quota_uses_only_equivalent_fallback(self):
        allowed = check(sr.decide(case(ready(
            quota_exhausted=True, effects_proven_absent=True, fallback_equivalent=True,
            fallback_route="codex:gpt-6.1-sol:medium", unknown_effect=False))))
        self.assertEqual(allowed["route"], "codex:gpt-6.1-sol:medium")
        self.assertEqual(allowed["fallback_reason"], "quota_exhausted_equivalent_fallback")
        blocked = check(sr.decide(case(ready(
            quota_exhausted=True, effects_proven_absent=False, fallback_equivalent=True,
            fallback_route="codex:gpt-6.1-sol:medium"))))
        self.assertFalse(blocked["executed"])
        self.assertIsNone(blocked["fallback_reason"])

    def test_sr_t13_platform_refusal_is_not_retried_elsewhere(self):
        decision = check(sr.decide(case(ready(
            platform_refusal=True, refusal_operation="read-source", proposed_provider="agy",
            proposed_retry_operation="read-source"))))
        self.assertEqual(decision["event_class"], "PLATFORM_REFUSAL")
        self.assertTrue(decision["rejected"])
        self.assertFalse(decision["executed"])
        self.assertEqual(decision["model_calls"], 0)
        self.assertTrue(decision["independent_queue_continues"])
        self.assertNotIn("agy:", decision["route"])

    def test_sr_t14_catalog_without_qualification_is_not_ready(self):
        decision = check(sr.decide(case(ready(
            cause="unresolved", agy_catalog=True, agy_qa_qualified=False,
            qa_route_proof="agy:claude-sonnet-5-5-medium"))))
        self.assertFalse(decision["agy_ready"])
        self.assertEqual(decision["qa_route"], "codex:gpt-6.1-sol:medium")
        self.assertNotIn("agy:", json.dumps(decision["qa_route"]))

    def test_sr_t15_disallowed_model_or_rights_do_not_rewrite_policy(self):
        for bad in (plan(model_ids=["gpt-7-invented"]), plan(rights_delta=["root"])):
            decision = check(sr.decide(case(ready(plan=bad))))
            self.assertTrue(decision["rejected"])
            self.assertFalse(decision["executed"])
            self.assertFalse(decision["policy_rewritten"])
            self.assertIsNone(decision["rewritten_task"])

    def test_sr_t16_bad_context_is_not_a_qa_pass(self):
        missing = check(sr.decide(case(ready(context_complete=False, missing_inputs=["rules"]))))
        self.assertEqual(missing["missing_inputs"], ["rules"])
        self.assertFalse(missing["full_trusted_fallback"])
        self.assertIsNone(missing["qa_verdict"])
        fallback = check(sr.decide(case(ready(context_hash_ok=False, missing_inputs=[]))))
        self.assertTrue(fallback["full_trusted_fallback"])
        self.assertIsNone(fallback["qa_verdict"])
        self.assertNotEqual(fallback["qa_verdict"], "PASS")

    def test_sr_t17_weakening_auth_or_assertions_is_refused(self):
        decision = check(sr.decide(case(fast(plan=plan(delete_assertions=True, fast_fix=True)))))
        self.assertTrue(decision["rejected"])
        self.assertIn("weakened", decision["reason"])
        self.assertFalse(decision["fast_fix"])
        self.assertFalse(decision["policy_rewritten"])

    def test_sr_t18_progress_continues_without_reset_or_micro_go(self):
        history = ["attempt-1", "attempt-2", "attempt-3"]
        decision = check(sr.decide(case(ready(
            author_attempts=3, continuation_used=0, progress=True, brief_usable=True,
            risk="moderate", history=history))))
        self.assertTrue(decision["continuation_granted"])
        self.assertEqual(decision["author_attempts"], 3)
        self.assertEqual(decision["history"], history)
        self.assertFalse(decision["history_reset"])
        self.assertFalse(decision["owner_micro_go"])
        self.assertEqual(decision["planner_calls"], 0)
        self.assertEqual(decision["astra_calls"], 0)

    def test_sr_t19_no_progress_opens_only_a_local_breaker(self):
        decision = check(sr.decide(case(ready(no_progress_streak=2, cause="unresolved"))))
        self.assertTrue(decision["circuit_breaker"])
        self.assertTrue(decision["independent_queue_continues"])
        self.assertFalse(decision["executed"])
        self.assertEqual(decision["model_calls"], 0)

    def test_sr_t20_shared_session_cannot_accept(self):
        for flag in ("session_shared", "author_qa_same_snapshot"):
            decision = check(sr.decide(case(ready(**{flag: True}))))
            self.assertEqual(decision["event_class"], "INDEPENDENT_QA_REJECTED")
            self.assertIsNone(decision["qa_verdict"])
            self.assertFalse(decision["executed"])

    def test_sr_t21_invalid_plan_has_a_finite_repair_budget(self):
        first = check(sr.decide(case(ready(plan_json_valid=False, schema_repair_attempts=0))))
        self.assertEqual(first["route"], "schema_repair")
        self.assertEqual(first["astra_calls"], 0)
        stopped = check(sr.decide(case(ready(plan_json_valid=False, schema_repair_attempts=2))))
        self.assertEqual(stopped["route"], "hold")
        self.assertEqual(stopped["astra_calls"], 0)
        self.assertIn("budget", stopped["reason"])

    def test_sr_t22_legacy_task_keeps_the_old_route(self):
        decision = check(sr.decide(case(fast(), semantics="legacy")))
        self.assertFalse(decision["policy_applied"])
        self.assertFalse(decision["fast_fix"])
        self.assertEqual(decision["route"], sr.LEGACY_ROUTE)
        self.assertEqual(decision["author_attempts"], 1)
        self.assertFalse(decision["executed"])

    def test_sr_t23_hidden_auto_model_is_not_invented(self):
        decision = check(sr.decide(case(ready(
            template_id="formatter", template_applicable=True, template_tool=None,
            change_surface="format", invented_model_id="gpt-fake-9", invented_cost=True,
            effective_model_exposed=False))))
        self.assertEqual(decision["route"], "cursor:auto")
        self.assertEqual(decision["effective_model"], "not_exposed")
        self.assertIsNone(decision["cost"])
        self.assertNotIn("gpt-fake-9", json.dumps(decision))

    def test_sr_t24_pin_mismatch_blocks_activation(self):
        pins = dict(PINS, capsule_sha256="c" * 64)
        decision = check(sr.decide(case(fast(), pins=pins)))
        self.assertTrue(decision["activation_blocked"])
        self.assertFalse(decision["policy_applied"])
        self.assertFalse(decision["fast_fix"])
        self.assertEqual(decision["route"], sr.LEGACY_ROUTE)

    def test_sr_t25_another_instance_refuses_fast_fix(self):
        decision = check(sr.decide(case(fast(class_search=search(instances=2), risk="moderate"))))
        self.assertFalse(decision["fast_fix"])
        self.assertTrue(decision["whole_class"])
        self.assertEqual(decision["route"], "codex:gpt-6.1-sol:high")
        self.assertEqual(decision["astra_calls"], 0)
        self.assertEqual(decision["planner_calls"], 1)

    def test_sr_t26_unproven_class_is_not_one_example(self):
        assured = check(sr.decide(case(fast(class_search=search(saved=False, assurance_only=True)))))
        self.assertFalse(assured["fast_fix"])
        self.assertEqual(assured["planner_calls"], 1)
        self.assertEqual(assured["astra_calls"], 0)
        missing = check(sr.decide(case(fast(class_search=None, suggested_class="only one"))))
        self.assertFalse(missing["fast_fix"])
        self.assertEqual(missing["event_class"], "SOURCE_UNCERTAIN")

    def test_sr_t27_fast_fix_does_not_spend_an_author_attempt(self):
        decision = check(sr.decide(case(fast(author_attempts=1, continuation_used=0))))
        self.assertTrue(decision["fast_fix"])
        self.assertEqual(decision["author_attempts"], 1)
        self.assertEqual(decision["author_attempts_delta"], 0)
        self.assertEqual(decision["continuation_used"], 0)
        self.assertEqual(decision["ledger_category"], "fast_fix")
        self.assertFalse(decision["continuation_granted"])

    def test_sr_t28_failed_fast_fix_leaves_the_first_ordinary_attempt(self):
        history = ["fast_fix:fp-export:fail"]
        decision = check(sr.decide(case(fast(
            author_attempts=0, prior_fast_fix={"fingerprint": "fp-export", "result": "fail"},
            history=history))))
        self.assertFalse(decision["fast_fix"])
        self.assertTrue(decision["fast_fix_closed"])
        self.assertEqual(decision["author_attempts"], 0)
        self.assertEqual(decision["author_attempts_delta"], 0)
        self.assertEqual(decision["next_ordinary_attempt"], 1)
        self.assertEqual(decision["history"], history)

    def test_timeout_text_is_not_transient_infra(self):
        decision = check(sr.decide(case(ready(event_text="timeout", cause="unresolved", risk="low"))))
        self.assertNotEqual(decision["event_class"], "TRANSIENT_INFRA")
        self.assertEqual(decision["astra_calls"], 0)

    def test_live_controller_is_not_rewired(self):
        package = ROOT / "scripts/chatops/actions_train"
        for name in ("core.py", "failure_diagnosis.py", "cost_policy.py", "stage.py",
                     "native_antigravity.py", "context_policy.py"):
            self.assertNotIn("smart_routing", (package / name).read_text(), name)
        self.assertIn("mandatory_source_FAIL_218", (package / "core.py").read_text())

    def test_policy_is_not_written_into_autonomy_schema(self):
        task = {"schema": "GOBADMINTON_AUTONOMY_V1", "target": "dev", "kind": "source_only",
                "smart_routing": {"fast_fix": True}}
        original = json.dumps(task)
        decision = check(sr.refuse_unsupported_task(task))
        self.assertTrue(decision["rejected"])
        self.assertFalse(decision["policy_applied"])
        self.assertEqual(task, json.loads(original))
        self.assertIsNone(decision["rewritten_task"])


if __name__ == "__main__":
    unittest.main()

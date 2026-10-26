"""SR1 synthetic classifier cases SR-T01..SR-T28. No provider, install, or network."""
import copy
import json
import time
from unittest import mock
import random
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
      "critical_qa_qualified": True, "session_shared": False, "author_qa_same_snapshot": False}


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
        "unknown_effect": False, "risk": "low", "cause": "proven", "effects_proven_absent": True,
        "defect_fingerprint": "fp-export",
        "regression_known": True, "fast_fix_history_checked": True,
    }
    evidence.update(updates)
    return evidence


def search(instances=1, saved=True, assurance_only=False, pattern="OldExport",
           method="grep", scope="apps/web/src", matched_count=None,
           scope_listing=None, diff_identifiers=None):
    if matched_count is None:
        matched_count = instances
    if scope_listing is None:
        scope_listing = ["apps/web/src/export.ts"]
    if diff_identifiers is None:
        diff_identifiers = [pattern]
    return {"saved": saved, "method": method, "pattern": pattern, "scope": scope,
            "instances": instances, "assurance_only": assurance_only,
            "matched_count": matched_count, "scope_listing": list(scope_listing),
            "diff_identifiers": list(diff_identifiers)}


def diff_check(**updates):
    value = {"tool": "diff", "hunks": 1, "assertions_unchanged": True,
             "expected_values_unchanged": True, "qa_unchanged": True,
             "timeout_unchanged": True, "auth_unchanged": True}
    value.update(updates)
    return value


def plan(**updates):
    value = {
        "schema": sr.PLAN_SCHEMA, "author_route": "cursor:auto",
        "qa_route": "codex:gpt-6.1-sol:medium", "planner_calls": 0, "astra_calls": 0,
        "fast_fix": False, "effects": ["source_edit_within_scope"], "model_ids": [],
        "rights_delta": [], "binding": dict(BIND), "delete_assertions": False,
        "weaken_auth": False, "disable_security": False, "weaken_qa": False,
        "weaken_timeout": False, "adjust_expected": False,
        "assertions_unchanged": False, "expected_values_unchanged": False,
        "qa_unchanged": False, "timeout_unchanged": False, "auth_unchanged": False,
        "executable": True,
    }
    value.update(updates)
    return value


def proof_plan(**updates):
    value = plan(fast_fix=True, assertions_unchanged=True, expected_values_unchanged=True,
                 qa_unchanged=True, timeout_unchanged=True, auth_unchanged=True)
    value.update(updates)
    return value


def fast(**updates):
    evidence = ready(cause="proven", risk="low", change_surface="rename", complexity="mechanical",
                     minimal_action_known=True, regression_known=True, defect_fingerprint="fp-export",
                     class_search=search(), author_attempts=1, continuation_used=0,
                     effective_model_exposed=False, assertions_unchanged=True,
                     expected_values_unchanged=True, qa_unchanged=True, timeout_unchanged=True,
                     auth_unchanged=True, fast_fix_history_checked=True, plan=proof_plan(),
                     diff_check=diff_check())
    evidence.update(updates)
    return evidence


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
            change_surface="format", risk="low", minimal_action_known=True,
            plan=plan(author_route="deterministic_tool", effects=["source_edit_within_scope", "deterministic_tool"]),
            diff_check=diff_check(),
            class_search=search()))))
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
        # §8 STANDARD has a bound defect and checks, without LOCAL declarations.
        decision = check(sr.decide(case(ready(
            brief_usable=True, cause="proven", risk="moderate", author_attempts=1,
            minimal_action_known=True, change_surface="rename", plan=plan(),
            diff_check=diff_check(), class_search=search()))))
        self.assertEqual(decision["planner_calls"], 0)
        self.assertEqual(decision["astra_calls"], 0)
        self.assertEqual(decision["event_class"], "SOURCE_KNOWN_STANDARD")
        self.assertTrue(decision["writer"])
        self.assertFalse(decision["fast_fix"])

    def test_sr_t05_known_complex_noncritical_skips_astra(self):
        # §8 COMPLEX may name a non-allowlisted surface. It still needs diff and a closed class.
        decision = check(sr.decide(case(ready(
            cause="proven", complexity="complex", risk="moderate", change_surface="state",
            difficult_or_repeating=False, brief_usable=False, minimal_action_known=True,
            plan=plan(author_route=sr.SPECIALIST_SOL, qa_route=sr.SPECIALIST_SOL),
            diff_check=diff_check(), class_search=search(), **QA))))
        self.assertEqual(decision["event_class"], "SOURCE_KNOWN_COMPLEX")
        self.assertEqual(decision["author_route"], "codex:gpt-6.1-sol:high")
        self.assertEqual(decision["astra_calls"], 0)
        self.assertEqual(decision["planner_calls"], 0)
        self.assertEqual(decision["qa_route"], "codex:gpt-6.1-sol:high")
        self.assertTrue(decision["writer"])
        self.assertFalse(decision["fast_fix"])

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
            self.assertEqual(decision["event_class"], "SOURCE_UNCERTAIN")
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
            minimal_action_known=True, risk="moderate", history=history, plan=plan(),
            change_surface="rename", diff_check=diff_check(), class_search=search()))))
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
            change_surface="format", invented_model_id="gpt-6.1-sol", invented_cost=True,
            effective_model_exposed=False, minimal_action_known=True, plan=plan(),
            class_search=search(), diff_check=diff_check()))))
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


def _not_writer(test, evidence):
    decision = check(sr.decide(case(evidence)))
    test.assertFalse(decision["fast_fix"])
    test.assertFalse(decision["writer"])
    test.assertNotEqual(decision["route"], "cursor:auto")
    test.assertNotEqual(decision["qa_verdict"], "PASS")
    return decision


class SmartRoutingQaClass(unittest.TestCase):
    """Negative coverage for the QA FAIL class. Missing proof is not proof."""

    def test_positive_fast_fix_still_requires_every_proof(self):
        decision = check(sr.decide(case(fast())))
        self.assertTrue(decision["fast_fix"])
        self.assertTrue(decision["writer"])
        self.assertTrue(decision["executed"])
        self.assertEqual(decision["author_attempts_delta"], 0)
        self.assertEqual(decision["ledger_category"], "fast_fix")

    def test_each_fast_fix_condition_is_default_deny(self):
        omissions = {
            "1 acceptance missing": ("acceptance_unchanged",),
            "1 fingerprint blank": None,
            "2 minimal missing": ("minimal_action_known",),
            "2 architecture open": None,
            "3 effects unknown": ("external_effects_unknown",),
            "4 scope missing": ("scope_within_admission",),
            "4 budget missing": ("finite_budget",),
            "5 regression missing": ("regression_known",),
            "6 history missing": ("fast_fix_history_checked",),
            "7 plan missing": None,
            "7 assertions missing": ("assertions_unchanged",),
            "7 expected missing": ("expected_values_unchanged",),
            "7 qa missing": ("qa_unchanged",),
            "7 timeout missing": ("timeout_unchanged",),
            "7 auth missing": ("auth_unchanged",),
            "8 search missing": ("class_search",),
        }
        for name, keys in omissions.items():
            with self.subTest(name=name):
                evidence = fast()
                if name == "1 fingerprint blank":
                    evidence["defect_fingerprint"] = " "
                elif name == "2 architecture open":
                    evidence["architecture_research_required"] = True
                elif name == "7 plan missing":
                    evidence["plan"] = None
                else:
                    for key in keys:
                        evidence.pop(key)
                decision = _not_writer(self, evidence)
                self.assertFalse(decision["rejected"])

    def test_condition_seven_rejects_the_weakening_class(self):
        phrases = (
            "delete the assertions and raise timeout",
            "DELETE THE ASSERTIONS",
            "remove tests",
            "drop expects",
            "increase the timeout",
            "raise timeout",
            "extend timeout",
            "disable security",
            "disable the timeout",
            "weaken auth",
            "weaken QA",
            "adjust expected",
            "update the expected snapshot",
            "change expected",
            "loosen the matcher",
            "skip qa",
            "удалить ассерт",
            "ослабить timeout",
            "повысить таймаут",
        )
        for phrase in phrases:
            with self.subTest(phrase=phrase):
                decision = _not_writer(self, fast(event_text=phrase))
                if decision["risk"] != "critical":
                    self.assertIn("condition 7", decision["reason"])
        kept = check(sr.decide(case(fast(event_text="rename OldExport"))))
        self.assertTrue(kept["fast_fix"])

    def test_plan_weaken_flags_are_refused(self):
        for flag in ("delete_assertions", "weaken_auth", "disable_security",
                     "weaken_qa", "weaken_timeout", "adjust_expected"):
            with self.subTest(flag=flag):
                decision = check(sr.decide(case(fast(plan=proof_plan(**{flag: True})))))
                self.assertTrue(decision["rejected"])
                self.assertIn("weakened", decision["reason"])
                self.assertFalse(decision["fast_fix"])
                self.assertFalse(decision["executed"])
                self.assertFalse(decision["writer"])

    def test_plan_proof_flags_must_be_true_on_the_plan_too(self):
        for flag in ("assertions_unchanged", "expected_values_unchanged", "qa_unchanged",
                     "timeout_unchanged", "auth_unchanged"):
            with self.subTest(flag=flag):
                decision = check(sr.decide(case(fast(plan=proof_plan(**{flag: False})))))
                self.assertTrue(decision["rejected"])
                self.assertIn("proof", decision["reason"])
                self.assertFalse(decision["fast_fix"])
                self.assertFalse(decision["writer"])
                self.assertFalse(decision["executed"])

    def test_non_bool_proof_is_not_accepted(self):
        for key, value in (("acceptance_unchanged", 1), ("acceptance_unchanged", "yes"),
                           ("scope_within_admission", "yes"), ("regression_known", 1)):
            with self.subTest(key=key, value=value):
                decision = check(sr.decide(case(fast(**{key: value}))))
                self.assertEqual(decision["event_class"], "SOURCE_UNCERTAIN")
                self.assertFalse(decision["executed"])
                self.assertFalse(decision["fast_fix"])
                self.assertFalse(decision["writer"])

    def test_sensitive_surfaces_keep_the_risk_floor(self):
        surfaces = (
            "Auth", "AUTH", "authorization", "authorisation", "userAuth", "AuthZ",
            "pii", "PII", "userPII", "identity", "userIdentity", "secrets", "secretKey",
            "sandbox", "apparmor", "admission", "budget", "qa_reuse", "qa-reuse", "qaReuse",
            "concurrency", "money", "payment", "billing", "payments",
            "migration", "DB_migration", "data loss", "data-loss", "dataloss",
            "rollback", "roll-back", "roll_back", "irreversible", "permission",
            "credential", "privilege", "rbac", "password",
        )
        for surface in surfaces:
            with self.subTest(surface=surface):
                decision = _not_writer(self, fast(change_surface=surface, risk="low", line_count=1,
                                                  suggested_class="SOURCE_KNOWN_LOCAL"))
                self.assertEqual(decision["risk"], "critical")
                self.assertFalse(decision["executed"] and decision["writer"])
        for surface in ("author", "AUTHOR", "authors", "secretary"):
            with self.subTest(surface=surface):
                decision = check(sr.decide(case(fast(change_surface=surface, risk="low", line_count=1,
                                                     suggested_class="SOURCE_KNOWN_LOCAL"))))
                self.assertEqual(decision["risk"], "low")
                self.assertFalse(decision["fast_fix"])
                self.assertFalse(decision["writer"])
        renamed = check(sr.decide(case(fast(change_surface="rename", risk="low", line_count=1,
                                             suggested_class="SOURCE_KNOWN_LOCAL"))))
        self.assertEqual(renamed["risk"], "low")
        self.assertTrue(renamed["fast_fix"])
        located = _not_writer(self, fast(
            change_surface="rename",
            findings=[{"id": "f1", "severity": "low", "location": "apps/web/src/userAuth.ts"}]))
        self.assertEqual(located["risk"], "critical")
        named = _not_writer(self, fast(change_surface="rename", event_text="nullable authorization"))
        self.assertEqual(named["risk"], "critical")
        timeout = check(sr.decide(case(fast(event_text="timeout"))))
        self.assertEqual(timeout["risk"], "low")
        self.assertTrue(timeout["fast_fix"])

    def test_critical_qa_is_specialist_only(self):
        base = dict(risk="critical", critical_signs=True, change_surface="auth", line_count=1,
                    qa_independent=True, session_shared=False, author_qa_same_snapshot=False)
        rejected = (
            "agy:claude-sonnet-5-5-medium",
            "agy:claude-sonnet-5-5-high",
            "codex:gpt-6-astra:high",
            "codex:gpt-6-astra:medium",
            "codex:gpt-6.1-sol:medium",
            "cursor:auto",
        )
        for proof in rejected:
            with self.subTest(proof=proof):
                decision = _not_writer(self, ready(
                    **base, critical_qa_qualified=True, agy_qa_qualified=True, qa_route_proof=proof))
                self.assertEqual(decision["route"], "hold")
                self.assertIsNone(decision["qa_route"])
                self.assertFalse(decision["executed"])
                self.assertEqual(decision["event_class"], "SOURCE_CRITICAL")
        unqualified = _not_writer(self, ready(
            **base, critical_qa_qualified=False, qa_route_proof="codex:gpt-6.1-sol:high"))
        self.assertEqual(unqualified["route"], "hold")
        self.assertFalse(unqualified["executed"])
        opus = check(sr.decide(case(ready(
            **base, critical_qa_qualified=True, agy_qa_qualified=True,
            qa_route_proof="agy:claude-opus-5-5-high"))))
        self.assertEqual(opus["qa_route"], "agy:claude-opus-5-5-high")
        self.assertEqual(opus["route"], "codex:gpt-6-astra:high")
        self.assertFalse(opus["writer"])
        self.assertTrue(opus["executed"])
        opus_unqualified = _not_writer(self, ready(
            **base, critical_qa_qualified=True, agy_qa_qualified=False,
            qa_route_proof="agy:claude-opus-5-5-high"))
        self.assertEqual(opus_unqualified["route"], "hold")

    def test_open_architecture_or_unknown_minimal_action_is_not_a_writer(self):
        samples = (
            ready(cause="proven", risk="low", complexity="standard", brief_usable=False,
                  architecture_research_required=True, minimal_action_known=True),
            ready(cause="proven", risk="low", complexity="mechanical", brief_usable=False,
                  architecture_research_required=False, minimal_action_known=False),
            ready(cause="proven", risk="moderate", complexity="complex", brief_usable=True,
                  architecture_research_required=True, minimal_action_known=True, author_attempts=1),
            ready(cause="proven", risk="moderate", complexity="standard", brief_usable=True,
                  architecture_research_required=False, minimal_action_known=False, author_attempts=1),
            ready(cause="proven", risk="moderate", complexity="standard", brief_usable=True,
                  architecture_research_required=True, minimal_action_known=False,
                  author_attempts=3, progress=True, continuation_used=0),
        )
        for evidence in samples:
            with self.subTest(complexity=evidence["complexity"], brief=evidence["brief_usable"],
                              attempts=evidence.get("author_attempts", 0)):
                decision = _not_writer(self, evidence)
                self.assertEqual(decision["route"], "codex:gpt-6.1-sol:high")
                self.assertEqual(decision["event_class"], "SOURCE_UNCERTAIN")
                self.assertEqual(decision["author_route"] == "cursor:auto", evidence["complexity"] != "complex")

    def test_schema_repair_allows_one_turn_then_holds(self):
        first = check(sr.decide(case(ready(plan_json_valid=False, schema_repair_attempts=0))))
        self.assertEqual(first["route"], "schema_repair")
        self.assertEqual(first["astra_calls"], 0)
        self.assertFalse(first["executed"])
        for attempts in (1, 2, 3):
            with self.subTest(attempts=attempts):
                decision = check(sr.decide(case(ready(
                    plan_json_valid=False, schema_repair_attempts=attempts))))
                self.assertEqual(decision["route"], "hold")
                self.assertEqual(decision["astra_calls"], 0)
                self.assertEqual(decision["model_calls"], 0)
                self.assertFalse(decision["executed"])
                self.assertFalse(decision["writer"])
                self.assertIn("budget", decision["reason"])

    def test_writer_events_outside_scope_do_not_write(self):
        samples = {
            "template": ready(template_id="formatter", template_applicable=True,
                              template_tool="deterministic_tool", change_surface="format",
                              minimal_action_known=True, plan=plan(), class_search=search(),
                              scope_within_admission=False),
            "template-model": ready(template_id="formatter", template_applicable=True,
                                    template_tool=None, change_surface="format",
                                    minimal_action_known=True, plan=plan(), class_search=search(),
                                    scope_within_admission=False),
            "brief": ready(brief_usable=True, cause="proven", author_attempts=1,
                           minimal_action_known=True, plan=plan(), scope_within_admission=False),
            "continuation": ready(author_attempts=3, continuation_used=0, progress=True,
                                  brief_usable=True, minimal_action_known=True, risk="moderate",
                                  plan=plan(), scope_within_admission=False),
        }
        for name, evidence in samples.items():
            with self.subTest(name=name):
                decision = _not_writer(self, evidence)
                self.assertFalse(decision["executed"])
                self.assertFalse(decision["continuation_granted"])
                self.assertEqual(decision["route"], "hold")
                self.assertIn("scope", decision["reason"])
                self.assertEqual(decision["model_calls"], 0)

    def test_non_executable_plan_is_not_executed(self):
        samples = {
            "brief": ready(brief_usable=True, cause="proven", author_attempts=1,
                           minimal_action_known=True, plan=plan(executable=False)),
            "continuation": ready(author_attempts=3, continuation_used=0, progress=True,
                                  brief_usable=True, minimal_action_known=True, risk="moderate",
                                  plan=plan(executable=False)),
            "complex": ready(cause="proven", complexity="complex", risk="moderate",
                             minimal_action_known=True, brief_usable=False,
                             plan=plan(executable=False)),
            "template": ready(template_id="formatter", template_applicable=True,
                              change_surface="format", minimal_action_known=True,
                              class_search=search(), plan=plan(executable=False)),
            "fast": fast(plan=proof_plan(executable=False)),
        }
        for name, evidence in samples.items():
            with self.subTest(name=name):
                decision = _not_writer(self, evidence)
                self.assertFalse(decision["executed"])
        truthy = check(sr.decide(case(ready(
            brief_usable=True, cause="proven", author_attempts=1, minimal_action_known=True,
            plan=plan(executable=1)))))
        self.assertEqual(truthy["event_class"], "SOURCE_UNCERTAIN")
        self.assertFalse(truthy["executed"])
        self.assertFalse(truthy["writer"])

    def test_another_instance_and_prior_fail_are_both_kept(self):
        ordinary = check(sr.decide(case(fast(
            class_search=search(instances=2),
            prior_fast_fix={"fingerprint": " fp-export ", "result": "fail"}))))
        self.assertFalse(ordinary["fast_fix"])
        self.assertTrue(ordinary["whole_class"])
        self.assertTrue(ordinary["fast_fix_closed"])
        self.assertEqual(ordinary["route"], "codex:gpt-6.1-sol:high")
        self.assertEqual(ordinary["next_ordinary_attempt"], 2)
        self.assertFalse(ordinary["writer"])
        difficult = check(sr.decide(case(fast(
            difficult_or_repeating=True, class_search=search(instances=2),
            prior_fast_fix={"fingerprint": "FP-EXPORT", "result": "fail"}, **QA))))
        self.assertTrue(difficult["whole_class"])
        self.assertTrue(difficult["fast_fix_closed"])
        self.assertFalse(difficult["fast_fix"])
        self.assertFalse(difficult["writer"])
        self.assertEqual(difficult["route"], "codex:gpt-6-astra:high")
        self.assertEqual(difficult["event_class"], "SOURCE_CRITICAL")
        critical = check(sr.decide(case(fast(
            change_surface="authorization", class_search=search(instances=2),
            prior_fast_fix={"fingerprint": "fp-export", "result": "fail"}, **QA))))
        self.assertTrue(critical["whole_class"])
        self.assertTrue(critical["fast_fix_closed"])
        self.assertEqual(critical["risk"], "critical")
        self.assertEqual(critical["route"], "codex:gpt-6-astra:high")

    def test_diagnostic_or_blank_pattern_does_not_close_the_class(self):
        patterns = (
            " ", "   ", "error TS2322", "Error_TS2322", "AssertionError",
            "assertion failed", "expected: 1", "received: 2", "permission denied",
            "timeout", "FAIL", "fail", "401", "TS2322",
        )
        for pattern in patterns:
            for method in ("grep", "ast", "lint", "test"):
                with self.subTest(pattern=pattern, method=method):
                    decision = _not_writer(self, fast(class_search=search(
                        pattern=pattern, method=method, scope="apps/web/src")))
                    self.assertFalse(decision["rejected"])
                    if decision["risk"] == "critical":
                        self.assertEqual(decision["event_class"], "SOURCE_CRITICAL")
                        self.assertFalse(decision["executed"])
                    else:
                        self.assertTrue(decision["whole_class"])
                        self.assertEqual(decision["event_class"], "SOURCE_UNCERTAIN")
        blank_scope = _not_writer(self, fast(class_search=search(pattern="OldExport", scope=" ")))
        self.assertTrue(blank_scope["whole_class"])
        blank_fp = _not_writer(self, fast(defect_fingerprint=" \t "))
        self.assertFalse(blank_fp["rejected"])
        self.assertFalse(blank_fp["fast_fix_closed"])
        other = check(sr.decide(case(fast(
            prior_fast_fix={"fingerprint": "other-defect", "result": "fail"}))))
        self.assertTrue(other["fast_fix"])
        self.assertFalse(other["fast_fix_closed"])
        passed = check(sr.decide(case(fast(
            prior_fast_fix={"fingerprint": "fp-export", "result": "pass"}))))
        self.assertTrue(passed["fast_fix"])


_SURFACES = (
    "src/auth/callback.ts", "checkAuthorization", "authorization-null-check",
    "p.i.i", "P I I", "src/oauth/callback.ts", "OAUTH", "авторизация",
    "починить авторизацию", "authori\u200bzation", "\u0430uthorization",
    "\uff41\uff55\uff54\uff48", "roll-back", "OAuth", "Auth",
)
_DESTRUCTIVE = (
    "delete the assertions", "удалить тест", "remove the timeout",
    "comment out the test", "skip the test", "disable test", "skip/disable test",
    "delete\u200b the assertions", "commented out the tests", "disable the timeout",
)


class SmartRoutingQaR2(unittest.TestCase):
    def test_every_text_field_raises_the_risk_floor(self):
        carriers = (
            "change_surface", "event_text", "goal", "diagnostics", "fingerprint",
            "scope", "pattern", "paths", "finding",
        )
        for text in _SURFACES:
            for carrier in carriers:
                with self.subTest(text=text, carrier=carrier):
                    evidence = fast()
                    if carrier == "change_surface":
                        evidence["change_surface"] = text
                    elif carrier == "event_text":
                        evidence["event_text"] = text
                    elif carrier == "goal":
                        evidence["goal"] = text
                    elif carrier == "diagnostics":
                        evidence["diagnostics"] = text
                    elif carrier == "fingerprint":
                        evidence["defect_fingerprint"] = text
                    elif carrier == "scope":
                        evidence["class_search"] = search(scope=text, pattern="OldExport")
                    elif carrier == "pattern":
                        evidence["class_search"] = search(pattern=text, scope="apps/web/src")
                    elif carrier == "paths":
                        evidence["paths"] = [text]
                    else:
                        evidence["findings"] = [{"id": "f1", "severity": "low", "location": text}]
                    decision = _not_writer(self, evidence)
                    self.assertEqual(decision["risk"], "critical")
                    self.assertFalse(decision["executed"])
                    self.assertEqual(decision["route"], "hold")
        harmless = check(sr.decide(case(fast(
            change_surface="author", class_search=search(scope="src/author/notes.ts", scope_listing=["src/author/notes.ts"])))))
        self.assertEqual(harmless["risk"], "low")
        self.assertFalse(harmless["fast_fix"])
        self.assertFalse(harmless["writer"])
        kept = check(sr.decide(case(fast(
            change_surface="rename", class_search=search(scope="src/author/notes.ts", scope_listing=["src/author/notes.ts"])))))
        self.assertEqual(kept["risk"], "low")
        self.assertTrue(kept["fast_fix"])
        listed = check(sr.decide(case(fast(diagnostics=["таймаут не трогать"]))))
        self.assertTrue(listed["fast_fix"])

    def test_critical_quota_cannot_fall_back_to_auto(self):
        blocked = _not_writer(self, ready(
            quota_exhausted=True, effects_proven_absent=True, fallback_equivalent=True,
            fallback_route="cursor:auto", change_surface="authorization", unknown_effect=False))
        self.assertEqual(blocked["risk"], "critical")
        self.assertFalse(blocked["executed"])
        self.assertEqual(blocked["route"], "hold")
        self.assertEqual(blocked["event_class"], "QUOTA")
        for route in ("codex:gpt-6.1-sol:medium", "codex:gpt-6-luna:medium",
                      "agy:claude-sonnet-5-5-medium", "agy:claude-sonnet-5-5-high"):
            with self.subTest(route=route):
                decision = _not_writer(self, ready(
                    quota_exhausted=True, effects_proven_absent=True, fallback_equivalent=True,
                    fallback_route=route, change_surface="oauth", unknown_effect=False,
                    agy_qa_qualified=True))
                self.assertEqual(decision["route"], "hold")
                self.assertFalse(decision["executed"])
        opus = _not_writer(self, ready(
            quota_exhausted=True, effects_proven_absent=True, fallback_equivalent=True,
            fallback_route="agy:claude-opus-5-5-high", change_surface="oauth",
            unknown_effect=False, agy_qa_qualified=True))
        self.assertEqual(opus["route"], "hold")
        self.assertEqual(opus["event_class"], "QUOTA")
        specialist = _not_writer(self, ready(
            quota_exhausted=True, effects_proven_absent=True, fallback_equivalent=True,
            fallback_route="codex:gpt-6.1-sol:high", change_surface="Auth",
            unknown_effect=False))
        self.assertEqual(specialist["route"], "hold")
        self.assertEqual(specialist["event_class"], "QUOTA")
        qualified = check(sr.decide(case(ready(
            quota_exhausted=True, effects_proven_absent=True, fallback_equivalent=True,
            fallback_route="codex:gpt-6.1-sol:high", change_surface="Auth",
            unknown_effect=False, **QA))))
        self.assertEqual(qualified["route"], "codex:gpt-6.1-sol:high")
        self.assertEqual(qualified["qa_route"], "codex:gpt-6.1-sol:high")
        self.assertFalse(qualified["writer"])
        self.assertNotEqual(qualified["qa_route"], "codex:gpt-6.1-sol:medium")
        opus_ready = check(sr.decide(case(ready(
            quota_exhausted=True, effects_proven_absent=True, fallback_equivalent=True,
            fallback_route="agy:claude-opus-5-5-high", change_surface="oauth",
            unknown_effect=False, agy_qa_qualified=True, critical_qa_qualified=True,
            qa_route_proof="agy:claude-opus-5-5-high", qa_independent=True))))
        self.assertEqual(opus_ready["route"], "agy:claude-opus-5-5-high")
        self.assertEqual(opus_ready["qa_route"], "agy:claude-opus-5-5-high")
        self.assertFalse(opus_ready["writer"])
        missing = ready(quota_exhausted=True, effects_proven_absent=True, fallback_equivalent=True,
                        fallback_route="cursor:auto", change_surface="rename", unknown_effect=False)
        missing.pop("risk")
        naked = _not_writer(self, missing)
        self.assertIsNone(naked["risk"])
        self.assertEqual(naked["route"], "hold")

    def test_writer_paths_require_a_plan_object(self):
        samples = {
            "brief": ready(brief_usable=True, cause="proven", author_attempts=1,
                           minimal_action_known=True),
            "continuation": ready(author_attempts=3, continuation_used=0, progress=True,
                                  brief_usable=True, minimal_action_known=True, risk="moderate"),
            "complex": ready(cause="proven", complexity="complex", risk="moderate",
                             minimal_action_known=True, brief_usable=False),
            "template": ready(template_id="formatter", template_applicable=True,
                              change_surface="format", minimal_action_known=True,
                              class_search=search()),
        }
        for name, evidence in samples.items():
            with self.subTest(name=name):
                decision = _not_writer(self, evidence)
                self.assertFalse(decision["executed"])
                self.assertEqual(decision["route"], "hold")
                self.assertIn("plan", decision["reason"])

    def test_fingerprint_repeats_use_the_same_normalization(self):
        variants = ("fp-\u200bexport", "\ufefffp-export", "fp-export\ufeff", "fp-\u200cexport")
        for fingerprint in variants:
            with self.subTest(fingerprint=fingerprint):
                decision = _not_writer(self, fast(
                    defect_fingerprint=fingerprint,
                    prior_fast_fix={"fingerprint": "fp-export", "result": "fail"}))
                self.assertTrue(decision["fast_fix_closed"])
                self.assertFalse(decision["fast_fix"])
        swapped = _not_writer(self, fast(
            defect_fingerprint="fp-export",
            prior_fast_fix={"fingerprint": "\ufefffp-\u200bEXPORT", "result": "fail"}))
        self.assertTrue(swapped["fast_fix_closed"])
        self.assertFalse(swapped["fast_fix"])

    def test_generic_patterns_do_not_close_a_class(self):
        patterns = ("error TS2322 in src", "timeout at", "timeout", "AssertionError",
                    "401", "error TS2322", "FAIL at line", "assertion failed in file")
        for pattern in patterns:
            with self.subTest(pattern=pattern):
                decision = _not_writer(self, fast(class_search=search(pattern=pattern)))
                self.assertFalse(decision["fast_fix"])
                self.assertNotEqual(decision["route"], "cursor:auto")
        concrete = check(sr.decide(case(fast(class_search=search(pattern="OldExport")))))
        self.assertTrue(concrete["fast_fix"])
        snake = check(sr.decide(case(fast(class_search=search(pattern="old_export")))))
        self.assertTrue(snake["fast_fix"])

    def test_destructive_text_blocks_every_writer_path(self):
        for phrase in _DESTRUCTIVE:
            with self.subTest(path="fast", phrase=phrase):
                decision = _not_writer(self, fast(event_text=phrase))
                self.assertNotEqual(decision["route"], "cursor:auto")
                if decision["risk"] != "critical":
                    self.assertIn("condition 7", decision["reason"])
            with self.subTest(path="brief", phrase=phrase):
                decision = _not_writer(self, ready(
                    brief_usable=True, cause="proven", author_attempts=1,
                    minimal_action_known=True, plan=plan(), event_text=phrase))
                self.assertFalse(decision["executed"])
                self.assertIn("condition 7", decision["reason"])
            with self.subTest(path="template", phrase=phrase):
                decision = _not_writer(self, ready(
                    template_id="formatter", template_applicable=True, change_surface="format",
                    minimal_action_known=True, plan=plan(), class_search=search(),
                    diagnostics=phrase))
                self.assertFalse(decision["executed"])
                self.assertIn("condition 7", decision["reason"])
        buried = _not_writer(self, fast(goal="please delete the assertions"))
        self.assertFalse(buried["fast_fix"])
        self.assertIn("condition 7", buried["reason"])

    def test_template_and_missing_risk_never_write(self):
        open_architecture = _not_writer(self, ready(
            template_id="formatter", template_applicable=True, change_surface="format",
            architecture_research_required=True, minimal_action_known=True, plan=plan()))
        self.assertNotEqual(open_architecture["route"], "cursor:auto")
        self.assertFalse(open_architecture["writer"])
        unknown_minimal = _not_writer(self, ready(
            template_id="formatter", template_applicable=True, change_surface="format",
            minimal_action_known=False, plan=plan()))
        self.assertFalse(unknown_minimal["writer"])
        self.assertNotEqual(unknown_minimal["route"], "cursor:auto")
        for builder in (
            lambda: ready(template_id="formatter", template_applicable=True,
                          change_surface="format", minimal_action_known=True, plan=plan()),
            lambda: ready(brief_usable=True, cause="proven", author_attempts=1,
                          minimal_action_known=True, plan=plan()),
            lambda: ready(cause="proven", complexity="complex", risk="moderate",
                          minimal_action_known=True, plan=plan()),
        ):
            evidence = builder()
            evidence.pop("risk")
            with self.subTest(complexity=evidence.get("complexity"), template=evidence.get("template_applicable")):
                decision = _not_writer(self, evidence)
                self.assertIsNone(decision["risk"])
                self.assertFalse(decision["writer"])
                self.assertNotEqual(decision["route"], "cursor:auto")
        omitted = ready(brief_usable=True, cause="proven", author_attempts=1,
                        minimal_action_known=True, plan=plan())
        omitted.pop("unknown_effect")
        self.assertFalse(_not_writer(self, omitted)["writer"])
        omitted_effect = ready(brief_usable=True, cause="proven", author_attempts=1,
                               minimal_action_known=True, plan=plan())
        omitted_effect.pop("external_effects_unknown")
        self.assertFalse(_not_writer(self, omitted_effect)["writer"])
        omitted_budget = ready(brief_usable=True, cause="proven", author_attempts=1,
                               minimal_action_known=True, plan=plan())
        omitted_budget.pop("finite_budget")
        self.assertFalse(_not_writer(self, omitted_budget)["writer"])


_BYPASSES = (
    "authori\u0301zation",
    "aut-horization",
    "au\u0442horization",
    "\u03b1uthorization",
    "authori\ufe0fzation",
    "\u0430\u0432\u0442horiz\u0430\u0446\u0438\u044f",
    "pi.i",
    "p.i.i",
    "P I I",
    "aut%2Dhorization",
    "authori%CC%81zation",
    "auth or",
    "auth\u00a0orization",
)


class SmartRoutingQaR3(unittest.TestCase):
    """Positive proof. Free text may raise risk or block; it cannot clear a route."""

    def test_skeleton_bypasses_raise_the_floor(self):
        for text in _BYPASSES:
            for carrier in ("event_text", "goal", "change_surface", "pattern"):
                with self.subTest(text=text, carrier=carrier):
                    evidence = fast(change_surface="rename")
                    if carrier == "event_text":
                        evidence["event_text"] = text
                    elif carrier == "goal":
                        evidence["goal"] = text
                    elif carrier == "change_surface":
                        evidence["change_surface"] = text
                    else:
                        evidence["class_search"] = search(pattern=text)
                    decision = _not_writer(self, evidence)
                    self.assertEqual(decision["risk"], "critical")
                    self.assertFalse(decision["fast_fix"])
                    self.assertFalse(decision["writer"])
                    self.assertFalse(decision["executed"])

    def test_unknown_surface_is_not_fast_even_when_text_is_quiet(self):
        for surface in ("state", "author", "", "refactor", "logic", "test_name"):
            with self.subTest(surface=surface):
                decision = check(sr.decide(case(fast(change_surface=surface))))
                self.assertEqual(decision["risk"], "low")
                self.assertFalse(decision["fast_fix"])
                self.assertFalse(decision["writer"])
        for surface in ("rename", "comment", "docs", "formatting", "format", "test-name", "Rename"):
            with self.subTest(surface=surface):
                decision = check(sr.decide(case(fast(change_surface=surface))))
                self.assertTrue(decision["fast_fix"])
                self.assertTrue(decision["writer"])

    def test_generic_splits_do_not_close_a_class(self):
        patterns = ("timeout_at", "timeoutAt", "Assertion_Error", "error_TS2322_in_src",
                    "timeout", "AssertionError")
        for pattern in patterns:
            with self.subTest(pattern=pattern):
                decision = _not_writer(self, fast(class_search=search(pattern=pattern)))
                self.assertFalse(decision["rejected"])
                self.assertFalse(decision["fast_fix"])
                self.assertTrue(decision["whole_class"])
        bare = {"saved": True, "method": "grep", "pattern": "OldExport",
                "scope": "apps/web/src", "instances": 1, "assurance_only": False}
        bare_decision = _not_writer(self, fast(class_search=bare))
        self.assertFalse(bare_decision["rejected"])
        self.assertFalse(bare_decision["fast_fix"])
        src = _not_writer(self, fast(class_search=search(pattern="OldExport", scope="src")))
        self.assertTrue(src["whole_class"])
        self.assertFalse(src["fast_fix"])
        listing = search(pattern="OldExport", scope="apps/web/src/export.ts", scope_listing=["src"])
        self.assertFalse(_not_writer(self, fast(class_search=listing))["fast_fix"])
        missing_ident = search(pattern="OldExport", diff_identifiers=["OtherExport"])
        self.assertFalse(_not_writer(self, fast(class_search=missing_ident))["fast_fix"])
        wrong = search(pattern="OldExport", matched_count="1")
        rejected = check(sr.decide(case(fast(class_search=wrong))))
        self.assertEqual(rejected["event_class"], "SOURCE_UNCERTAIN")
        self.assertIn("search", rejected["reason"])

    def test_destructive_intent_uses_the_same_skeleton(self):
        phrases = (
            "delete%20the%20assertions", "deleteTheAssertions", "delete%2520the%2520assertions",
            "\u0443\u0434\u0430\u043b\u0438\u0442\u044c \u0442\u0435\u0441\u0442",
            "comment out the test", "skip the test", "disable test",
            "\u043e\u0442\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0442\u0435\u0441\u0442",
            "\u043f\u0440\u043e\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u0442\u0435\u0441\u0442",
            "\u0437\u0430\u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0442\u0435\u0441\u0442",
            "remove the timeout",
        )
        for phrase in phrases:
            with self.subTest(phrase=phrase):
                decision = _not_writer(self, fast(event_text=phrase))
                self.assertFalse(decision["fast_fix"])
                self.assertFalse(decision["writer"])
                if decision["risk"] != "critical":
                    self.assertIn("condition 7", decision["reason"])
                brief = _not_writer(self, ready(
                    brief_usable=True, cause="proven", author_attempts=1,
                    minimal_action_known=True, plan=plan(), event_text=phrase))
                self.assertFalse(brief["writer"])
                self.assertFalse(brief["executed"])
        quiet = check(sr.decide(case(fast(event_text="timeout"))))
        self.assertTrue(quiet["fast_fix"])
        renamed = check(sr.decide(case(fast(event_text="rename OldExport"))))
        self.assertTrue(renamed["fast_fix"])
        claim = fast(event_text="assertions unchanged")
        claim["diff_check"] = None
        claimed = check(sr.decide(case(claim)))
        self.assertFalse(claimed["fast_fix"])
        self.assertFalse(claimed["writer"])

    def test_fingerprint_skeleton_ignores_marks_and_whitespace_only(self):
        variants = ("fp-\nexport", "fp- export", "fp-\u0301export", "fp-\u200bexport",
                    "\ufefffp-export", "fp-\u00a0export")
        for fingerprint in variants:
            with self.subTest(fingerprint=fingerprint):
                decision = _not_writer(self, fast(
                    defect_fingerprint=fingerprint,
                    prior_fast_fix={"fingerprint": "fp-export", "result": "fail"}))
                self.assertTrue(decision["fast_fix_closed"])
                self.assertFalse(decision["fast_fix"])
        distinct = check(sr.decide(case(fast(
            defect_fingerprint="fp-export",
            prior_fast_fix={"fingerprint": "fpexport", "result": "fail"}))))
        self.assertFalse(distinct["fast_fix_closed"])
        self.assertNotEqual(sr._fingerprint_key("fp-export"), sr._fingerprint_key("fpexport"))
        self.assertFalse(distinct["writer"])  # unknown vocabulary does not grant a new fingerprint

    def test_template_needs_a_closed_single_instance(self):
        many = _not_writer(self, ready(
            template_id="formatter", template_applicable=True, change_surface="format",
            minimal_action_known=True, plan=plan(), class_search=search(instances=2)))
        self.assertFalse(many["writer"])
        self.assertNotEqual(many["event_class"], "TEMPLATE")
        self.assertNotEqual(many["route"], "cursor:auto")
        repeated = _not_writer(self, ready(
            template_id="formatter", template_applicable=True, change_surface="format",
            minimal_action_known=True, plan=plan(), class_search=search(),
            defect_fingerprint="fp-export",
            prior_fast_fix={"fingerprint": "fp-export", "result": "fail"}))
        self.assertFalse(repeated["writer"])
        self.assertTrue(repeated["fast_fix_closed"])
        self.assertNotEqual(repeated["event_class"], "TEMPLATE")
        missing = _not_writer(self, ready(
            template_id="formatter", template_applicable=True, change_surface="format",
            minimal_action_known=True, plan=plan()))
        self.assertFalse(missing["writer"])
        self.assertNotEqual(missing["route"], "cursor:auto")

    def test_author_fallback_never_accepts_astra_or_unproven_critical_qa(self):
        for route in ("codex:gpt-6-astra:high", "codex:gpt-6-astra:medium"):
            with self.subTest(route=route, risk="low"):
                decision = _not_writer(self, ready(
                    quota_exhausted=True, effects_proven_absent=True, fallback_equivalent=True,
                    fallback_route=route, unknown_effect=False, risk="low"))
                self.assertEqual(decision["route"], "hold")
                self.assertEqual(decision["event_class"], "QUOTA")
            with self.subTest(route=route, risk="critical"):
                decision = _not_writer(self, ready(
                    quota_exhausted=True, effects_proven_absent=True, fallback_equivalent=True,
                    fallback_route=route, unknown_effect=False, change_surface="auth", **QA))
                self.assertEqual(decision["route"], "hold")
                self.assertFalse(decision["writer"])
        medium = _not_writer(self, ready(
            quota_exhausted=True, effects_proven_absent=True, fallback_equivalent=True,
            fallback_route="codex:gpt-6.1-sol:medium", change_surface="oauth",
            unknown_effect=False, **QA))
        self.assertEqual(medium["route"], "hold")
        self.assertNotEqual(medium["qa_route"], "codex:gpt-6.1-sol:medium")

    def test_bad_types_are_rejected_without_raising(self):
        samples = []
        base = case(fast())
        for key, value in (("task_sha", None), ("task_sha", 7), ("operation_id", None),
                           ("operation_id", 7), ("head", None)):
            broken = case(fast())
            broken["binding"] = dict(broken["binding"], **{key: value})
            samples.append(broken)
        pins = case(fast())
        pins["pins"] = dict(pins["pins"], code_sha256=None)
        samples.append(pins)
        pins_int = case(fast())
        pins_int["pins"] = dict(pins_int["pins"], code_sha256=1)
        samples.append(pins_int)
        headed = fast()
        bad_plan = proof_plan()
        bad_plan["binding"] = dict(bad_plan["binding"], head=None)
        headed["plan"] = bad_plan
        samples.append(case(headed))
        headed_int = fast()
        bad_int = proof_plan()
        bad_int["binding"] = dict(bad_int["binding"], head=12)
        headed_int["plan"] = bad_int
        samples.append(case(headed_int))
        for sample in samples:
            decision = sr.decide(sample)
            if sr._binding_error(sample["binding"]) or sr._pin_error(sample["pins"]):
                self.assertEqual(decision["event_class"], "REJECTED")
            else:
                self.assertEqual(decision["event_class"], "SOURCE_UNCERTAIN")
            self.assertFalse(decision["writer"])
            self.assertFalse(decision["fast_fix"])
            self.assertFalse(decision["executed"])
        self.assertIn("binding", sr.decide(samples[-1])["reason"])
        self.assertIn("binding", sr.validate_plan(bad_int))

    def test_cyclic_class_search_is_rejected(self):
        loop = search()
        loop["scope_listing"].append(loop)
        decision = sr.decide(case(fast(class_search=loop)))
        self.assertEqual(decision["event_class"], "SOURCE_UNCERTAIN")
        self.assertEqual(decision["route"], "codex:gpt-6.1-sol:high")
        self.assertIn("closed schema", decision["reason"])
        self.assertFalse(decision["writer"])
        nested = []
        cursor = nested
        for _ in range(40):
            child = []
            cursor.append(child)
            cursor = child
        deep = fast()
        deep["paths"] = nested
        deep_decision = sr.decide(case(deep))
        self.assertEqual(deep_decision["event_class"], "SOURCE_UNCERTAIN")
        self.assertFalse(deep_decision["writer"])

    def test_attempt_seven_does_not_grant_continuation(self):
        for attempts in (4, 5, 6, 7):
            with self.subTest(attempts=attempts):
                decision = check(sr.decide(case(ready(
                    author_attempts=attempts, continuation_used=0, progress=True,
                    brief_usable=True, minimal_action_known=True, risk="moderate",
                    plan=plan()))))
                self.assertFalse(decision["continuation_granted"])
                self.assertFalse(decision["writer"])
                self.assertFalse(decision["executed"])
                self.assertEqual(decision["event_class"], "LIMIT")
                self.assertEqual(decision["route"], "hold")
        granted = check(sr.decide(case(ready(
            author_attempts=3, continuation_used=1, progress=True, brief_usable=True,
            minimal_action_known=True, risk="moderate", plan=plan(),
            change_surface="rename", diff_check=diff_check(), class_search=search()))))
        self.assertTrue(granted["continuation_granted"])
        self.assertTrue(granted["writer"])

    def test_fuzz_never_raises_or_writes_on_unproven_risk(self):
        rng = random.Random(20261025)
        alphabet = [
            "a", "auth", "author", "\u0410", "\u0301", "\u0442", "\u03b1", "\ufe0f",
            "-", "_", " ", "%20", "delete", "timeout", "OldExport", "\n", "\u200b",
            "\u0442\u0435\u0441\u0442", "\u0430\u0432\u0442horiz\u0430\u0446\u0438\u044f", "pi.i",
            "Rename", "assertions unchanged",
        ]
        for index in range(100):
            blob = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 24)))
            if index % 5 == 0:
                blob += chr(rng.randint(0, 0xD7FF))
            evidence = fast(event_text=blob, goal=blob)
            if index % 11 == 0:
                loop = search()
                loop["diff_identifiers"].append(loop)
                evidence["class_search"] = loop
            if index % 13 == 0:
                broken = proof_plan()
                broken["binding"] = dict(broken["binding"], head=None)
                evidence["plan"] = broken
            if index % 19 == 0:
                evidence["diagnostics"] = [blob, 1] if index % 2 else blob
            sample = case(evidence)
            if index % 17 == 0:
                sample["binding"] = dict(sample["binding"], task_sha=None if index % 2 else 3)
            decision = sr.decide(sample)
            self.assertIsInstance(decision, dict)
            self.assertIn("writer", decision)
            if decision["risk"] not in ("low", "moderate"):
                self.assertFalse(decision["writer"])
                self.assertFalse(decision["fast_fix"])
        for junk in (None, 1, "x", [], {"schema": sr.CASE_SCHEMA}, {"binding": None}):
            decision = sr.decide(junk)
            self.assertFalse(decision["writer"])
            self.assertFalse(decision["fast_fix"])
            self.assertTrue(decision["rejected"])


def _proven_brief(**updates):
    """§8 STANDARD: known checks/history, diff and closure; no LOCAL declarations."""
    evidence = ready(
        brief_usable=True, cause="proven", risk="moderate", author_attempts=1,
        minimal_action_known=True, change_surface="rename", plan=plan(),
        diff_check=diff_check(), class_search=search())
    evidence.update(updates)
    return evidence


class SmartRoutingQaR4(unittest.TestCase):
    """Encoding, other scripts, and missing proof fail closed. Legitimate renames stay."""

    def test_undecoded_residue_and_nested_encodings_raise_the_floor(self):
        nested = (
            "authori%25257Aation",
            "authori&#122;ation",
            "authori&#x7a;ation",
            "authori\\u007aation",
            "authori\\x7aation",
            "authori%26%23122%3Bation",
            "author\u0131zation",
            "authori1zation",
            # Nine percent layers: the decode limit stops on a leftover %XX.
            "authori%25252525252525257Aation",
            "rename &zzzunknown; helper",
        )
        for text in nested:
            for builder in (fast, _proven_brief):
                with self.subTest(text=text, brief=builder is _proven_brief):
                    decision = _not_writer(self, builder(event_text=text))
                    self.assertEqual(decision["risk"], "critical")
                    self.assertFalse(decision["executed"])
                    self.assertFalse(decision["writer"])
        destructive = (
            "delete%252520the%252520assertions",
            "delete the asser&#116;ions",
            "\\u0064elete the assertions",
        )
        for text in destructive:
            with self.subTest(text=text, path="fast"):
                decision = _not_writer(self, fast(event_text=text))
                self.assertFalse(decision["fast_fix"])
                if decision["risk"] != "critical":
                    self.assertIn("condition 7", decision["reason"])
            with self.subTest(text=text, path="brief"):
                decision = _not_writer(self, _proven_brief(event_text=text))
                self.assertFalse(decision["writer"])
                self.assertFalse(decision["executed"])
                if decision["risk"] != "critical":
                    self.assertIn("condition 7", decision["reason"])

    def test_other_scripts_and_embedded_auth_do_not_write(self):
        texts = (
            "αυθοριζατιον",
            "\u2c81\u2c89\u2c9f",
            "\u10d0\u10d1\u10d2",
            "preauth redirect",
            "xauth middleware",
            "unauth token",
        )
        for text in texts:
            with self.subTest(text=text):
                decision = _not_writer(self, fast(event_text=text))
                self.assertEqual(decision["risk"], "critical")
                self.assertFalse(decision["fast_fix"])
                self.assertFalse(decision["writer"])
                brief = _not_writer(self, _proven_brief(event_text=text))
                self.assertEqual(brief["risk"], "critical")
                self.assertFalse(brief["writer"])

    def test_path_glue_and_legitimate_words_stay_low(self):
        harmless = (
            "author", "authors", "AUTHOR", "secretary", "секретарь",
            "переименовать тестовый хелпер",
            "протест против опечатки",
            "remove the latest typo in the name",
            "переименовать платформу",
            "переименовать правильно",
            "таймаут не трогать",
        )
        for text in harmless:
            with self.subTest(text=text):
                decision = check(sr.decide(case(fast(event_text=text))))
                self.assertEqual(decision["risk"], "low")
                self.assertTrue(decision["fast_fix"])
                self.assertTrue(decision["writer"])
        paths = check(sr.decide(case(fast(
            paths=["apps/api/index.ts", "apps/api/internal/export.ts"],
            class_search=search(scope="apps/api", scope_listing=["apps/api/index.ts"]),
            goal="rename export to author"))))
        self.assertEqual(paths["risk"], "low")
        # Low risk alone cannot cover an unlisted second repair site (R9 H1).
        self.assertFalse(paths["fast_fix"])
        self.assertFalse(paths["writer"])
        covered = check(sr.decide(case(fast(
            paths=["apps/api/index.ts"],
            class_search=search(scope="apps/api", scope_listing=["apps/api/index.ts"]),
            goal="rename export to author"))))
        self.assertTrue(covered["fast_fix"])
        self.assertTrue(covered["writer"])

    def test_payment_migration_and_access_rights_raise_the_floor(self):
        for text in ("мигрируйте схему", "изменить права доступа", "платёж", "оплатить счёт"):
            with self.subTest(text=text):
                decision = _not_writer(self, fast(event_text=text))
                self.assertEqual(decision["risk"], "critical")
                self.assertFalse(decision["fast_fix"])

    def test_dot_and_glob_are_not_a_concrete_path(self):
        for scope in (".", "..", "**/*", "*"):
            with self.subTest(scope=scope):
                decision = _not_writer(self, fast(class_search=search(scope=scope)))
                self.assertFalse(decision["rejected"])
                self.assertTrue(decision["whole_class"])
                self.assertFalse(decision["fast_fix"])
        for listing in (["."], ["**/*"], ["*"]):
            with self.subTest(listing=listing):
                decision = _not_writer(self, fast(class_search=search(scope_listing=listing)))
                self.assertFalse(decision["fast_fix"])
                self.assertTrue(decision["whole_class"])
        named = check(sr.decide(case(fast(class_search=search(
            scope="apps/web/src", scope_listing=["apps/web/src/export.ts"])))))
        self.assertTrue(named["fast_fix"])

    def test_fast_fix_proof_outranks_a_usable_brief(self):
        decision = check(sr.decide(case(fast(brief_usable=True))))
        self.assertTrue(decision["fast_fix"])
        self.assertTrue(decision["writer"])
        self.assertEqual(decision["event_class"], "SOURCE_KNOWN_LOCAL")
        self.assertEqual(decision["ledger_category"], "fast_fix")
        self.assertEqual(decision["author_attempts_delta"], 0)

    def test_writer_routes_without_diff_and_class_do_not_write(self):
        samples = {
            "brief": ready(brief_usable=True, cause="proven", author_attempts=1,
                           minimal_action_known=True, plan=plan()),
            "complex-state": ready(cause="proven", complexity="complex", risk="moderate",
                                   change_surface="state", brief_usable=False,
                                   minimal_action_known=True, plan=plan()),
            "continuation": ready(author_attempts=3, continuation_used=0, progress=True,
                                  brief_usable=True, minimal_action_known=True,
                                  risk="moderate", plan=plan()),
            "template-state": ready(template_id="formatter", template_applicable=True,
                                    template_tool=None, change_surface="state",
                                    minimal_action_known=True, plan=plan(),
                                    class_search=search()),
            "brief-state": ready(brief_usable=True, cause="proven", author_attempts=1,
                                 minimal_action_known=True, change_surface="state",
                                 plan=plan(), diff_check=diff_check(), class_search=search()),
            "continuation-state": ready(author_attempts=3, continuation_used=0, progress=True,
                                        brief_usable=True, minimal_action_known=True,
                                        risk="moderate", change_surface="state", plan=plan(),
                                        diff_check=diff_check(), class_search=search()),
        }
        for name, evidence in samples.items():
            with self.subTest(name=name):
                decision = _not_writer(self, evidence)
                self.assertFalse(decision["executed"])
                self.assertFalse(decision["continuation_granted"])
                self.assertEqual(decision["route"], "hold")
                self.assertIn("writer proof", decision["reason"])

    def test_deepcopy_runtime_error_is_rejected(self):
        class Boom:
            def __deepcopy__(self, memo):
                raise RuntimeError("boom")

        evidence = fast()
        evidence["class_search"] = search()
        evidence["class_search"]["payload"] = Boom()
        decision = sr.decide(case(evidence))
        self.assertEqual(decision["event_class"], "SOURCE_UNCERTAIN")
        self.assertEqual(decision["route"], "codex:gpt-6.1-sol:high")
        self.assertFalse(decision["writer"])
        self.assertFalse(decision["fast_fix"])
        self.assertFalse(decision["executed"])
        self.assertIn("closed schema", decision["reason"])


def _encodings_of(char):
    """One encoding class for a single character: percent, HTML, and literal escapes."""
    code = ord(char)
    hex4 = f"{code:04x}"
    forms = [
        f"%u{hex4}",
        f"%{code:02x}",
        f"\\u{hex4}",
        f"\\u{{{code:x}}}",
        f"\\u{{{hex4}}}",
        f"&#{code};",
        f"&#x{hex4};",
        "&#" + "".join(chr(0xFF10 + int(digit)) for digit in str(code)) + ";",
        f"\\x{code:02x}",
        f"={code:02X}",
    ]
    if code < 0x100:
        forms.append(f"\\{code:03o}")
    return forms


def _with_repeat(word, index=2):
    return word[:index] + word[index] + word[index:]


class SmartRoutingQaR5(unittest.TestCase):
    """Fail closed. Fast Fix text is an allowlist; a split or encoded stem raises the floor."""

    def _assert_blocked(self, text, carrier="event_text"):
        evidence = fast(change_surface="rename")
        if carrier == "event_text":
            evidence["event_text"] = text
        elif carrier == "goal":
            evidence["goal"] = text
        elif carrier == "scope":
            evidence["class_search"] = search(scope=text if "/" in text or "." in text else "apps/" + text)
        else:
            evidence["class_search"] = search(scope_listing=[text if "." in text else text + ".ts"])
        decision = _not_writer(self, evidence)
        self.assertEqual(decision["risk"], "critical", text)
        self.assertFalse(decision["fast_fix"])
        self.assertFalse(decision["writer"])
        self.assertFalse(decision["executed"])
        brief = _not_writer(self, _proven_brief(event_text=text))
        self.assertFalse(brief["writer"])
        self.assertFalse(brief["executed"])
        self.assertFalse(brief["fast_fix"])

    def test_separator_and_encoding_matrix_cannot_hide_a_stem(self):
        splits = (
            ("authori", "zation"),
            ("author", "ization"),
            ("pass", "word"),
            ("creden", "tial"),
            ("sand", "box"),
            ("migrat", "ion"),
            ("ident", "ity"),
            ("secre", "t"),
        )
        separators = (
            " ", "/", "\\", "%20", "%2F", "\u00a0", "\u2028", "\u2029", "\u2003",
            "\uff0f", "\u2044", "\u2215",
        )
        for left, right in splits:
            for separator in separators:
                text = left + separator + right
                with self.subTest(text=text):
                    self._assert_blocked(text)
        stems = (
            "authorization", "password", "credential", "sandbox", "migration",
            "identity", "secret", "oauth",
        )
        for stem in stems:
            pivot = max(1, len(stem) // 2)
            for encoded in _encodings_of(stem[pivot]):
                text = stem[:pivot] + encoded + stem[pivot + 1:]
                with self.subTest(text=text):
                    self._assert_blocked(text)
            with self.subTest(text=_with_repeat(stem)):
                self._assert_blocked(_with_repeat(stem))
        # UTF-7 for "z", quoted as a class of residual encodings, not one string.
        self._assert_blocked("authori+AHo-ation")

    def test_encoded_stem_is_critical_in_scope_and_listing_too(self):
        samples = (
            "authori%20zation",
            "authori\u00a0zation",
            "authori\u2028zation",
            "pass/word",
            "author/ization",
            "authori\\zation",
            "passsword",
            "authori%u007aation",
            "authori\\u{7a}ation",
            "authori&#１２２;ation",
        )
        for text in samples:
            for carrier in ("event_text", "goal", "scope", "listing"):
                with self.subTest(text=text, carrier=carrier):
                    self._assert_blocked(text, carrier)

    def test_cyrillic_digit_sign_and_translit_raise_the_floor(self):
        words = ("пароль", "миграция", "доступ", "секрет")
        for word in words:
            pivot = max(1, len(word) // 2)
            for noise in ("0", "1", "ь"):
                text = "переименовать " + word[:pivot] + noise + word[pivot:]
                with self.subTest(text=text):
                    self._assert_blocked(text)
            for separator in (" ", "/", "%20", "\u00a0", "\u2028"):
                text = word[:pivot] + separator + word[pivot:]
                with self.subTest(text=text):
                    self._assert_blocked(text)
        for text in ("пар0ль", "миг1рация", "дост1уп", "секьрет",
                     "пассворд", "аутхоризейшн", "креденшл", "санбокс"):
            with self.subTest(text=text):
                self._assert_blocked(text)

    def test_split_words_still_prove_condition_seven(self):
        phrases = (
            "delete the asser tions",
            "delete the asser/tions",
            "delete the asser\\tions",
            "remove the time outs",
            "уда лить проверки",
            "уда/лить проверки",
            "уда\u00a0лить проверки",
        )
        for phrase in phrases:
            with self.subTest(phrase=phrase, path="fast"):
                decision = _not_writer(self, fast(event_text=phrase))
                self.assertFalse(decision["fast_fix"])
                self.assertFalse(decision["writer"])
                if decision["risk"] != "critical":
                    self.assertIn("condition 7", decision["reason"])
            with self.subTest(phrase=phrase, path="brief"):
                decision = _not_writer(self, _proven_brief(event_text=phrase))
                self.assertFalse(decision["writer"])
                self.assertFalse(decision["executed"])
                if decision["risk"] != "critical":
                    self.assertIn("condition 7", decision["reason"])

    def test_third_attempt_without_progress_does_not_write(self):
        samples = {
            "brief": ready(
                brief_usable=True, cause="proven", risk="moderate", author_attempts=3,
                progress=False, continuation_used=0, minimal_action_known=True,
                change_surface="rename", plan=plan(), diff_check=diff_check(),
                class_search=search()),
            "complex": ready(
                cause="proven", complexity="complex", risk="moderate", change_surface="state",
                brief_usable=False, author_attempts=3, progress=False,
                minimal_action_known=True, plan=plan(), diff_check=diff_check(),
                class_search=search()),
            "template": ready(
                template_id="formatter", template_applicable=True, change_surface="format",
                minimal_action_known=True, author_attempts=3, progress=False, plan=plan(),
                class_search=search()),
            "fast-proof": fast(author_attempts=3, progress=False),
        }
        for name, evidence in samples.items():
            with self.subTest(name=name):
                decision = check(sr.decide(case(evidence)))
                self.assertFalse(decision["writer"])
                self.assertFalse(decision["fast_fix"])
                self.assertFalse(decision["executed"])
                self.assertFalse(decision["continuation_granted"])
                self.assertEqual(decision["event_class"], "LIMIT")
                self.assertEqual(decision["route"], "hold")
        granted = check(sr.decide(case(ready(
            author_attempts=3, continuation_used=0, progress=True, brief_usable=True,
            minimal_action_known=True, risk="moderate", plan=plan(),
            change_surface="rename", diff_check=diff_check(), class_search=search()))))
        self.assertTrue(granted["continuation_granted"])
        self.assertTrue(granted["writer"])

    def test_globs_are_not_concrete_and_real_paths_stay_low(self):
        for scope in ("**/*.ts", "src/**", "*.js", "apps/**", "src/*", "*.ts", "**/*"):
            with self.subTest(scope=scope):
                self.assertFalse(sr._concrete_path(scope))
                decision = _not_writer(self, fast(class_search=search(scope=scope)))
                self.assertFalse(decision["rejected"])
                self.assertFalse(decision["fast_fix"])
                self.assertFalse(decision["writer"])
                self.assertTrue(decision["whole_class"])
        for listing in (["**/*.ts"], ["src/**"], ["*.js"], ["apps/**"], ["src/*"]):
            with self.subTest(listing=listing):
                decision = _not_writer(self, fast(class_search=search(scope_listing=listing)))
                self.assertFalse(decision["fast_fix"])
                self.assertFalse(decision["writer"])
                self.assertTrue(decision["whole_class"])
        for path in ("api_index.ts", "apps/api/index.ts", "apps\u2044api\u2044index.ts",
                     "apps\u2215api\u2215index.ts"):
            with self.subTest(path=path):
                if not path.isascii():
                    self.assertFalse(sr._concrete_path(path))
                    self.assertFalse(sr.decide(case(fast(paths=[path])))["writer"])
                    continue
                self.assertTrue(sr._concrete_path(path))
                decision = check(sr.decide(case(fast(
                    paths=[path], goal="rename export to author",
                    class_search=search(scope=path, scope_listing=[path])))))
                self.assertEqual(decision["risk"], "low")
                self.assertTrue(decision["fast_fix"])
                self.assertTrue(decision["writer"])

    def test_any_exception_is_rejected(self):
        class Odd(Exception):
            pass

        class Boom:
            def __deepcopy__(self, memo):
                raise Odd("odd")

        evidence = fast()
        evidence["class_search"] = search()
        evidence["class_search"]["payload"] = Boom()
        decision = sr.decide(case(evidence))
        self.assertEqual(decision["event_class"], "SOURCE_UNCERTAIN")
        self.assertEqual(decision["route"], "codex:gpt-6.1-sol:high")
        self.assertFalse(decision["writer"])
        self.assertFalse(decision["fast_fix"])
        self.assertFalse(decision["executed"])
        self.assertIn("closed schema", decision["reason"])

        class Bad(dict):
            def __iter__(self):
                raise Odd("odd")

        self.assertEqual(sr.validate_plan(Bad()), "incompatible plan")
        self.assertEqual(sr.refuse_unsupported_task(Bad())["event_class"], "REJECTED")
        self.assertFalse(sr.refuse_unsupported_task(Bad())["writer"])

    def test_legitimate_renames_stay_fast(self):
        harmless = (
            "author", "authors", "AUTHOR", "secretary", "секретарь", "автор",
            "переименовать тестовый хелпер",
            "переименовать платформу",
            "переименовать правильно",
            "remove the latest typo",
            "remove the latest typo in the name",
        )
        for text in harmless:
            with self.subTest(text=text):
                decision = check(sr.decide(case(fast(event_text=text))))
                self.assertEqual(decision["risk"], "low")
                self.assertTrue(decision["fast_fix"])
                self.assertTrue(decision["writer"])
                self.assertEqual(decision["event_class"], "SOURCE_KNOWN_LOCAL")


class SmartRoutingQaR6(unittest.TestCase):
    """Free text only downgrades. A split, a repeat, or a transliteration cannot write.

    These are the eighteen R6 probes: fourteen event texts, plus scope and
    scope listing for the two path-shaped fragments. On head 9ebe516e each of
    them was risk low with Fast Fix and a writer.
    """

    _SPLIT_SENSITIVE = (
        "aut hor iz ation",
        "aut/hor/iz/ation",
        "а в т о р и з а ц и я",
        "ав/то/ри/за/ция",
        "аввторизация",
        "паароль",
        "avtorizatsiya",
        "parol",
    )
    _SPLIT_WEAKEN = (
        "dis able test",
        "skip ti meout",
        "up date ex pected",
        "in crease time out",
        "de le te as ser tions",
        "у да лить ассерты",
    )

    def test_fragmented_sensitive_words_stay_critical(self):
        for text in self._SPLIT_SENSITIVE:
            for builder in (fast, _proven_brief):
                with self.subTest(text=text, brief=builder is _proven_brief):
                    decision = _not_writer(self, builder(event_text=text))
                    self.assertEqual(decision["risk"], "critical")
                    self.assertFalse(decision["fast_fix"])
                    self.assertFalse(decision["writer"])
                    self.assertFalse(decision["executed"])

    def test_fragmented_weaken_phrases_do_not_write(self):
        for text in self._SPLIT_WEAKEN:
            with self.subTest(text=text, path="fast"):
                decision = _not_writer(self, fast(event_text=text))
                self.assertFalse(decision["fast_fix"])
                self.assertFalse(decision["writer"])
                self.assertIn("condition 7", decision["reason"])
            with self.subTest(text=text, path="brief"):
                decision = _not_writer(self, _proven_brief(event_text=text))
                self.assertFalse(decision["writer"])
                self.assertFalse(decision["executed"])
                self.assertFalse(decision["fast_fix"])
                self.assertIn("condition 7", decision["reason"])

    def test_fragmented_stem_in_scope_and_listing(self):
        for text in ("aut/hor/iz/ation", "ав/то/ри/за/ция"):
            for field, value in (("scope", text), ("scope_listing", [text + ".ts"])):
                with self.subTest(field=field, text=text):
                    decision = _not_writer(self, fast(class_search=search(**{field: value})))
                    self.assertEqual(decision["risk"], "critical")
                    self.assertFalse(decision["fast_fix"])
                    self.assertFalse(decision["writer"])
                    self.assertFalse(decision["executed"])

    def test_text_outside_the_closed_vocabulary_has_no_writer(self):
        for builder in (fast, _proven_brief):
            with self.subTest(brief=builder is _proven_brief):
                decision = _not_writer(self, builder(event_text="rename the widget"))
                self.assertIn(decision["risk"], ("low", "moderate"))
                self.assertFalse(decision["fast_fix"])
                self.assertFalse(decision["writer"])
                self.assertEqual(decision["event_class"], "SOURCE_UNCERTAIN")
                self.assertIn("closed vocabulary", decision["reason"])
        pathed = _not_writer(self, fast(paths=["apps/web/src/widget.ts"]))
        self.assertEqual(pathed["risk"], "low")
        self.assertFalse(pathed["fast_fix"])
        self.assertFalse(pathed["writer"])
        self.assertEqual(pathed["event_class"], "SOURCE_UNCERTAIN")
        self.assertIn("closed vocabulary", pathed["reason"])


_LEGITIMATE_R7 = (
    "author", "authors", "secretary", "секретарь", "автор",
    "переименовать платформу", "переименовать правильно", "remove the latest typo",
)


def _appendix_b_probes():
    """Original Appendix B loops, including the ninth positive api_index.ts."""
    for text in _LEGITIMATE_R7 + ("api_index.ts",):
        yield "legitimate:" + text, fast(event_text=text), "fast"
    for left, right in (("authori", "zation"), ("pass", "word"), ("пар", "оль")):
        for sep in (" ", "\u00a0", "\u2028", "\u2029", "/", "\\"):
            yield "R5 separator:" + repr(left + sep + right), fast(event_text=left + sep + right), "blocked"
    for text in ("authori%u007aation", r"authori\u{7a}ation", "authori&#１２２;ation",
                 "авто1ризация", "автоьризация", "passsword", "пассворд"):
        yield "R5 encoding/noise:" + text, fast(event_text=text), "blocked"
    for text in SmartRoutingQaR6._SPLIT_SENSITIVE + SmartRoutingQaR6._SPLIT_WEAKEN:
        yield "remaining-fast:" + text, fast(event_text=text), "blocked"
        yield "remaining-brief:" + text, _proven_brief(event_text=text), "blocked"
    for field in ("scope", "scope_listing"):
        for text in ("aut/hor/iz/ation", "ав/то/ри/за/ция"):
            value = text if field == "scope" else [text + ".ts"]
            yield field + ":" + text, fast(class_search=search(**{field: value})), "blocked"
    for glob in ("**/*.ts", "src/**", "*.js"):
        yield "glob:" + glob, fast(class_search=search(scope=glob)), "blocked"
    for progress in (False, True):
        for used in (0, 1, 2):
            expected = "continuation" if progress and used < 2 else "limit"
            yield f"attempt3 progress={progress} used={used}", fast(
                author_attempts=3, progress=progress, brief_usable=True, continuation_used=used), expected
    yield "SR-T04", _proven_brief(), "standard"
    yield "SR-T05", ready(cause="proven", complexity="complex", risk="moderate", change_surface="state",
                           difficult_or_repeating=False, brief_usable=False, minimal_action_known=True,
                           plan=plan(), diff_check=diff_check(), class_search=search()), "pm"
    yield "SR-T26 missing", fast(class_search=None), "pm"
    yield "SR-T26 assurance", fast(class_search=search(saved=False, assurance_only=True)), "pm"

    class Odd(Exception):
        pass

    class Boom:
        def __deepcopy__(self, memo):
            raise Odd("synthetic")

    evidence = fast()
    evidence["class_search"]["payload"] = Boom()
    yield "non-ValueError", evidence, "pm"  # unknown key is refused before executing object hooks


def _appendix_c_probes():
    """Every original Appendix C input, with explicit legitimate/blocked expectations."""
    for text in SmartRoutingQaR6._SPLIT_SENSITIVE + SmartRoutingQaR6._SPLIT_WEAKEN:
        yield text, fast(event_text=text), "blocked"
    for text in ("aut/hor/iz/ation", "ав/то/ри/за/ция"):
        for field, value in (("scope", text), ("scope_listing", [text + ".ts"])):
            yield field + ":" + text, fast(class_search=search(**{field: value})), "blocked"
    for text in _LEGITIMATE_R7:
        yield text, fast(event_text=text), "fast"
    for field in ("change_surface", "template_id", "suggested_class", "defect_fingerprint",
                  "refusal_operation", "proposed_retry_operation", "proposed_provider", "qa_route_proof"):
        for text in ("rename the widget", "access control", "API keys", "sessions", "token", "авторизация", "dis able test"):
            yield field + ":" + text, fast(**{field: text}), "blocked"
    for field in ("id", "location"):
        for text in ("apps/web/src/widget.ts", "apps/web/src/access.ts", "apps/web/src/session.ts",
                     "apps/web/src/security.ts", "авторизация", "dis able test"):
            finding = {"id": "f1", "severity": "low", "location": "apps/web/src/export.ts"}
            finding[field] = text
            yield "finding." + field + ":" + text, fast(findings=[finding]), "blocked"
    for text in ("access control", "security", "API keys", "sessions", "delete user", "erase all data"):
        yield "complex surface:" + text, fast(change_surface=text, complexity="complex", brief_usable=True), "blocked"
    for path in ("apps/web/src/../../../../index.ts", "/apps/web/src/export.ts", "apps//web/src/export.ts",
                 "apps/web/src/export.ts/", "apps/web/src/export.ts:author", "apps/web/src/export.ts@api",
                 "apps web src export.ts", "api_index.ts", "apps/web/src/123.ts", "apps/web/src/au0thor.ts",
                 "apps/web/src/secretaary.ts", "apps/web/src/ex\u200bport.ts"):
        yield path, fast(paths=[path], class_search=search(scope=path, scope_listing=[path])), (
            "fast" if path == "api_index.ts" else "pm")
    for scope, listing in (("apps/api/index.ts", ["apps/web/src/export.ts"]),
                           ("apps/web/src", ["apps/api/index.ts"]),
                           ("apps/web/src", ["apps/web/src/export.ts", "**/*.ts"]),
                           ("apps/web/src", ["apps/web/src/export.ts", "../../api_index.ts"])):
        yield repr((scope, listing)), fast(class_search=search(scope=scope, scope_listing=listing)), "blocked"
    for text in ("authori\u200bzation", "authori\u202ezation", "ａｕｔｈｏｒｉｚａｔｉｏｎ", "AUTHORIZATION",
                 "аuthоrizаtion", "a\u0301uthorization", "𝕒𝕦𝕥𝕙𝕠𝕣𝕚𝕫𝕒𝕥𝕚𝕠𝕟", "а в т о р и з а ц и я",
                 "dіsаble test", "d\u200bis able te\u200bst"):
        for field in ("event_text", "goal", "diagnostics"):
            yield field + ":" + text, fast(**{field: text}), "blocked"
    for field in ("event_text", "goal", "diagnostics", "change_surface"):
        for value in (None, False, 1, [], {}, "a" * 501):
            yield field + ":" + repr(value)[:30], fast(**{field: value}), "pm"
    for field in ("id", "location"):
        finding = {"id": "f1", "severity": "low", "location": "apps/web/src/export.ts"}
        finding[field] = "author " * 1000
        yield "long finding." + field, fast(findings=[finding]), "pm"
    for hunks in (0, 1, 32, 33, True, "1", 1.0):
        yield "hunks:" + repr(hunks), fast(diff_check=diff_check(hunks=hunks)), (
            "fast" if type(hunks) is int and hunks in (1, 32) else "blocked")
    for n in (0, 1, 2, 3, 4, 5):
        for progress in (False, True):
            yield f"attempts:{n}:progress:{progress}", fast(author_attempts=n, progress=progress, brief_usable=True), (
                "fast" if n < 3 else "continuation" if n == 3 and progress else "limit")
    for values in (["remove", "timeout"], ["remove the", "timeout"], ["remove", "таймаут"], ["remove", "timeout", "999"]):
        yield "list:" + repr(values), fast(diagnostics=values), "blocked"
        yield "joined:" + repr(values), fast(diagnostics=" ".join(values)), "blocked"
    yield "event/goal", fast(event_text="remove the", goal="timeout"), "blocked"
    for builder in (fast, _proven_brief):
        label = "fast" if builder is fast else "brief"
        yield label + ":remove таймаут", builder(event_text="remove таймаут"), "blocked"
        yield label + ":list remove timeout", builder(diagnostics=["remove", "timeout"]), "blocked"
        yield label + ":unrecognised finding location", builder(findings=[
            {"id": "f1", "severity": "low", "location": "apps/web/src/access.ts"}]), "blocked"
        path = "apps/web/src/../../../../index.ts"
        yield label + ":nonconcrete path", builder(class_search=search(scope=path, scope_listing=[path])), "pm"
    for brief in (False, True):
        yield "complex brief=" + str(brief), ready(
            cause="proven", complexity="complex", risk="moderate", change_surface="state",
            minimal_action_known=True, brief_usable=brief,
            plan=plan(author_route="codex:gpt-6.1-sol:high", qa_route="codex:gpt-6.1-sol:high"),
            diff_check=diff_check(), class_search=search()), "pm"


class SmartRoutingQaR7(unittest.TestCase):
    """R8 regressions. Earlier fixtures now require canonical scope listings,
    ASCII paths, explicit complex QA qualification and uniform schema-to-PM
    refusal. Unknown objects are refused before deepcopy hooks can run.
    """
    def _blocked(self, evidence, pm=False):
        decision = check(sr.decide(case(evidence)))
        self.assertFalse(decision["writer"], decision)
        self.assertFalse(decision["fast_fix"], decision)
        if pm:
            self.assertEqual(decision["event_class"], "SOURCE_UNCERTAIN", decision)
            self.assertEqual(decision["route"], "codex:gpt-6.1-sol:high", decision)
        return decision

    def _replay(self, probes):
        for label, evidence, expected in probes:
            with self.subTest(probe=label):
                decision = check(sr.decide(case(evidence)))
                if expected in ("blocked", "pm", "limit"):
                    self._blocked(evidence, pm=expected == "pm")
                    if expected == "limit":
                        self.assertEqual(decision["event_class"], "LIMIT")
                        self.assertEqual(decision["route"], "hold")
                else:
                    self.assertTrue(decision["writer"], decision)
                    classes = {"fast": "SOURCE_KNOWN_LOCAL", "standard": "SOURCE_KNOWN_STANDARD", "continuation": "CONTINUATION"}
                    self.assertEqual(decision["event_class"], classes[expected])
                    self.assertEqual(decision["fast_fix"], expected == "fast")
                    self.assertEqual(decision["route"], "continuation" if expected == "continuation" else "cursor:auto")
                    if expected == "fast":
                        self.assertEqual(decision["risk"], "low")

    def test_appendix_b_replay(self):
        self._replay(_appendix_b_probes())

    def test_appendix_c_replay(self):
        self._replay(_appendix_c_probes())

    def test_h1_whole_evidence_weakening_and_controls(self):
        for builder in (fast, _proven_brief):
            for updates in ({"diagnostics": ["remove", "timeout"]}, {"event_text": "remove таймаут"},
                            {"diagnostics": "remove timeout"}, {"event_text": "remove the", "goal": "timeout"},
                            {"diagnostics": ["таймаут", "remove"]}, {"event_text": "удалить timeout"}):
                with self.subTest(builder=builder.__name__, updates=updates):
                    self._blocked(builder(**updates))
            control = sr.decide(case(builder(event_text="remove the latest typo")))
            self.assertTrue(control["writer"])
            self.assertEqual(control["event_class"], "SOURCE_KNOWN_LOCAL" if builder is fast else "SOURCE_KNOWN_STANDARD")

    def test_h2_every_field_and_finding_uses_gate(self):
        for builder in (fast, _proven_brief):
            for updates in ({"findings": [{"id": "f1", "severity": "low", "location": "apps/web/src/access.ts"}]},
                            {"change_surface": "access control", "complexity": "complex", "brief_usable": True}):
                with self.subTest(builder=builder.__name__, updates=updates):
                    self._blocked(builder(**updates))
            control = sr.decide(case(builder(findings=[{"id": "f1", "severity": "low", "location": "apps/web/src/export.ts"}])))
            self.assertTrue(control["writer"])

    def test_h3_paths_search_consistency_and_controls(self):
        bad_searches = (
            search(scope="apps/api/index.ts", scope_listing=["apps/web/src/export.ts"]),
            search(scope="apps/web/src/../../../../index.ts", scope_listing=["apps/web/src/../../../../index.ts"]),
            search(scope_listing=[]), search(scope_listing=["apps/web/src/export.ts"] * 2),
            search(matched_count=2), search(instances=2), search(diff_identifiers=[""]),
            search(diff_identifiers=["OldExport", "OtherExport"]),
        )
        paths = ("apps/./index.ts", "apps/../index.ts", "/apps/index.ts", "apps//index.ts",
                 "apps/index.ts/", "apps\\index.ts", "apps/**", "apps/ index.ts", "apps/ex\u200bport.ts",
                 "apps/éxport.ts", "apps/export.ts@api", "apps/export.ts:author")
        for builder in (fast, _proven_brief):
            for item in bad_searches:
                with self.subTest(builder=builder.__name__, search=item):
                    self._blocked(builder(class_search=item), pm=True)
            for path in paths:
                for updates in ({"paths": [path]}, {"findings": [{"id": "f1", "severity": "low", "location": path}]},
                                {"class_search": search(scope=path, scope_listing=[path])}):
                    with self.subTest(builder=builder.__name__, updates=updates):
                        self._blocked(builder(**updates))
            for scope, listing in (("apps/web/src", ["apps/web/src/export.ts"]),
                                   ("apps/web/src/export.ts", ["apps/web/src/export.ts"])):
                self.assertTrue(sr.decide(case(builder(class_search=search(scope=scope, scope_listing=listing))))["writer"])

    def test_m1_complex_brief_and_central_route_accounting(self):
        for brief in (False, True):
            evidence = ready(cause="proven", complexity="complex", risk="moderate", change_surface="state",
                             minimal_action_known=True, brief_usable=brief,
                             plan=plan(author_route="codex:gpt-6.1-sol:high", qa_route="codex:gpt-6.1-sol:high"),
                             diff_check=diff_check(), class_search=search())
            with self.subTest(brief=brief):
                self.assertFalse(self._blocked(evidence, pm=True)["plan_honored"])
                evidence.update(QA)
                d = sr.decide(case(evidence))
                self.assertTrue(d["writer"], d)
                self.assertEqual(d["event_class"], "SOURCE_KNOWN_COMPLEX")
                self.assertEqual(d["author_route"], "codex:gpt-6.1-sol:high")
                self.assertEqual(d["qa_route"], "codex:gpt-6.1-sol:high")
                self.assertTrue(d["plan_honored"])
                evidence["plan"]["qa_route"] = "codex:gpt-6.1-sol:medium"
                self.assertFalse(sr.decide(case(evidence))["plan_honored"])

    def test_fixed_seed_fragmentation_fuzz(self):
        rng = random.Random(20261025)
        seeds = ("remove timeout", "delete assertions", "disable test", "weaken auth", "access control",
                 "authorization", "password", "удалить ассерты", "remove таймаут", "отключить тест")
        started = time.monotonic()
        # First sample is the confirmed bypass; generated cases then vary split, carrier, order and encoding.
        self._blocked(fast(diagnostics=["remove", "timeout"]))
        for index in range(260):
            phrase = rng.choice(seeds)
            boundaries = list(range(1, len(phrase))) if index % 2 else [i for i, c in enumerate(phrase) if c == " "]
            cuts = sorted(rng.sample(boundaries, min(len(boundaries), rng.randint(1, 4))))
            pieces = [phrase[a:b] for a, b in zip([0] + cuts, cuts + [len(phrase)])]
            rng.shuffle(pieces)
            e = (fast if index % 2 else _proven_brief)()
            e["diagnostics"] = []
            carriers = ["event_text", "goal", "diagnostics", "change_surface", "finding.id", "finding.location", "paths", "scope_listing", "pattern"]
            for piece in pieces:
                variant = rng.randrange(5)
                if variant == 0:
                    piece = piece.upper()
                elif variant == 1:
                    piece = "\u200b".join(piece)
                elif variant == 2:
                    piece = "".join(chr(ord(c) + 0xFEE0) if "!" <= c <= "~" else c for c in piece)
                elif variant == 3:
                    piece = piece.translate(str.maketrans({"a": "а", "o": "о", "e": "е", "i": "і"}))
                if rng.choice((False, True)):
                    piece = "author " + piece + " latest"
                carrier = rng.choice(carriers)
                if carrier.startswith("finding."):
                    finding = {"id": "f1", "severity": "low", "location": "apps/web/src/export.ts"}
                    finding[carrier.split(".")[1]] = piece
                    e.setdefault("findings", []).append(finding)
                elif carrier in ("paths", "diagnostics"):
                    e.setdefault(carrier, []).append(piece)
                elif carrier in ("scope_listing", "pattern"):
                    if carrier == "scope_listing":
                        e["class_search"][carrier].append(piece)
                    else:
                        e["class_search"][carrier] += piece
                else:
                    e[carrier] = e.get(carrier, "") + " " + piece
            if not e["diagnostics"]:
                del e["diagnostics"]
            with self.subTest(sample=index):
                self._blocked(e)
        self.assertLess(time.monotonic() - started, 20)

    def test_fixed_seed_positive_vocabulary_family(self):
        rng = random.Random(20261025)
        for index in range(90):
            e = fast()
            words = rng.sample(("author", "authors", "secretary", "автор", "секретарь", "latest", "typo", "export"), 3)
            e[rng.choice(("event_text", "goal"))] = " ".join(words)
            e["diagnostics"] = rng.sample(words, 2)
            e["paths"] = [rng.choice(("apps/web/src/index.ts", "apps/web/src/export.ts"))]
            e["findings"] = [{"id": "f1", "severity": "low", "location": e["paths"][0]}]
            e["class_search"]["scope_listing"] = list(e["paths"])
            with self.subTest(sample=index):
                d = sr.decide(case(e))
                self.assertTrue(d["writer"], d)
                self.assertTrue(d["fast_fix"], d)
                self.assertEqual(d["risk"], "low")
        # Same carriers with an unrecognized vocabulary word must close.
        self._blocked(fast(findings=[{"id": "f1", "severity": "low", "location": "apps/web/src/widget.ts"}]), pm=True)

    def test_fixed_seed_structural_garbage_fuzz(self):
        rng = random.Random(20261025)
        bad_values = (None, {}, [None], [["author"]], ("author",), True, 1, "", "x" * 501, ["author"] * 1025, {False: "author"})
        self._blocked(fast(class_search=dict(search(), extra="author")), pm=True)
        for field in ("event_text", "goal", "diagnostics", "change_surface"):
            for value in (None, [], {}, "", (), False, 1, "author " * 10000):
                self._blocked(fast(**{field: value}), pm=True)
        for key in ("unknown", 1, False, None, ("author",)):
            e = fast()
            e[key] = "author"
            self._blocked(e, pm=True)
        # Each leaf is within its local limit but the total text/node budgets are exceeded.
        e = fast(diagnostics=["author " * 60] * 32, history=["author " * 60] * 32)
        self._blocked(e, pm=True)
        for index in range(180):
            e = fast()
            target = rng.choice((e, e["class_search"], e["diff_check"], e["plan"], e["plan"]["binding"]))
            if index % 2:
                target[rng.choice(("unknown", 1, False, None, ("author",)))] = rng.choice(bad_values)
            else:
                target[rng.choice(tuple(target))] = rng.choice(bad_values)
                # Ensure the randomly chosen valid scalar can never accidentally be a valid full proof.
                e["findings"] = [{"id": "f1", "severity": "low", "location": "apps/web/src/export.ts", "extra": "author"}]
            with self.subTest(sample=index):
                self._blocked(e, pm=True)
        # Unexpected implementation exceptions still reject; ordinary foreign values never execute hooks.
        with mock.patch.object(sr, "_decide", side_effect=RuntimeError("synthetic")):
            d = sr.decide(case(fast()))
            self.assertEqual(d["event_class"], "REJECTED")
            self.assertFalse(d["writer"])

    def test_fixed_seed_route_downgrade_fuzz(self):
        rng = random.Random(20261025)
        routes = sorted(sr.ROUTES)
        for index in range(100):
            builder = rng.choice((fast, _proven_brief))
            e = builder()
            before = sr.decide(case(e))
            requested = {key: rng.choice(routes) for key in ("author_route", "qa_route")}
            e["plan"].update(requested)
            with self.subTest(sample=index, requested=requested):
                after = sr.decide(case(e))
                matches = all(requested[key] == after[key] for key in requested)
                self.assertEqual(after["plan_honored"], matches)
                self.assertEqual(after["writer"], matches)
                self.assertEqual(after["executed"], matches)
                self.assertEqual(after["author_route"], before["author_route"])
                self.assertEqual(after["qa_route"], before["qa_route"])

    def test_schema_table_coverage_and_single_string_gate(self):
        self.assertTrue(hasattr(sr, "_FIELD_VALIDATORS"), "one explicit schema table is required")
        tables = sr._FIELD_VALIDATORS
        self.assertEqual(set(tables["evidence"]), sr._EVIDENCE_KEYS)
        self.assertEqual(set(tables["evidence"]), set(sr._defaults()))
        self.assertEqual(set(tables["plan"]), sr._PLAN_KEYS)
        self.assertEqual(set(tables["search"]), sr._SEARCH_BASE | sr._SEARCH_OPTIONAL)
        self.assertEqual(set(tables["diff"]), sr._DIFF_KEYS)
        self.assertEqual(set(tables["binding"]), sr._BIND_KEYS)
        self.assertEqual(set(tables["finding"]), {"id", "severity", "location"})
        self.assertEqual(set(tables["prior"]), {"fingerprint", "result"})
        self.assertEqual(set(sr._PLAN_ROUTE_FIELDS), {key for key in sr._PLAN_KEYS if key.endswith("_route")})
        seen = set()
        def walk(rule):
            kind = rule[0]
            self.assertIn(kind, {"optional", "obj", "list", "diagnostics", "empty_list", "text", "path",
                                 "bool", "int", "enum", "regex", "operation", "finding_id", "history"})
            if kind in ("optional", "list"):
                walk(rule[1])
            if kind == "obj" and rule[1] not in seen:
                seen.add(rule[1])
                for child in tables[rule[1]].values():
                    walk(child)
        walk(("obj", "evidence"))
        self.assertEqual(seen, set(tables))
        # Mutation coverage: every table key is visited, including optional objects and binding.
        populated = fast(findings=[{"id": "f1", "severity": "low", "location": "apps/web/src/export.ts"}],
                         prior_fast_fix={"fingerprint": "fp-export", "result": "pass"})
        for schema, path in (("evidence", ()), ("finding", ("findings", 0)),
                             ("prior", ("prior_fast_fix",)), ("search", ("class_search",)),
                             ("diff", ("diff_check",)), ("plan", ("plan",)), ("binding", ("plan", "binding"))):
            e = copy.deepcopy(populated)
            target = e
            for part in path:
                target = target[part]
            target["unknown"] = "author"
            self._blocked(e, pm=True)
            for key in tables[schema]:
                for value in ({"unknown": "author"}, "rename the widget"):
                    e = copy.deepcopy(populated)
                    target = e
                    for part in path:
                        target = target[part]
                    target[key] = value
                    with self.subTest(schema=schema, key=key, value=value):
                        self._blocked(e, pm=True)


class SmartRoutingQaR8(unittest.TestCase):
    """Policy enforcement at the final source gate, plus exact-type envelopes."""

    @staticmethod
    def _writers():
        return {
            "fast": fast(),
            "standard": _proven_brief(),
            "continuation": _proven_brief(author_attempts=3, progress=True),
            "complex": _proven_brief(
                complexity="complex", change_surface="state", **QA,
                plan=plan(author_route=sr.SPECIALIST_SOL, qa_route=sr.SPECIALIST_SOL)),
        }

    def _control(self, evidence):
        d = check(sr.decide(case(evidence)))
        self.assertTrue(d["writer"], d)
        self.assertTrue(d["executed"], d)
        self.assertTrue(d["plan_honored"], d)
        return d

    def _blocked(self, evidence, reason=None):
        d = check(sr.decide(case(evidence)))
        self.assertFalse(d["writer"], d)
        self.assertFalse(d["fast_fix"], d)
        self.assertFalse(d["continuation_granted"], d)
        self.assertFalse(d["plan_honored"], d)
        self.assertEqual(d["event_class"], "SOURCE_UNCERTAIN", d)
        self.assertEqual(d["route"], sr.SPECIALIST_SOL, d)
        if reason:
            self.assertFalse(d["executed"], d)
            self.assertIn(reason, d["reason"], d)
        return d

    def test_h1_effects_admit_the_selected_source_action(self):
        for name, original in self._writers().items():
            self._control(original)
            for effects in (["read"], [], ["none"], ["deterministic_tool"],
                            ["source_edit_within_scope", "none"]):
                with self.subTest(writer=name, effects=effects):
                    e = copy.deepcopy(original)
                    e["plan"]["effects"] = effects
                    self._blocked(e, "effects")
            e = copy.deepcopy(original)
            e["plan"]["effects"] = ["read", "source_edit_within_scope"]
            self._control(e)
        # A deterministic template edits source too and needs both permissions.
        e = fast(template_id="formatter", template_applicable=True,
                 template_tool="deterministic_tool", change_surface="format")
        e["plan"].update(author_route="deterministic_tool")
        self._blocked(e, "effects")
        e["plan"]["effects"].append("deterministic_tool")
        d = sr.decide(case(e))
        self.assertEqual(d["route"], "deterministic_tool", d)
        self.assertTrue(d["executed"], d)
        self.assertTrue(d["plan_honored"], d)
        self.assertFalse(d["writer"], d)
        e["plan"]["author_route"] = "cursor:auto"
        self._blocked(e, "routes")

    def test_h2_every_requested_route_is_enforced(self):
        for name, original in self._writers().items():
            before = self._control(original)
            requests = [dict(author_route=sr.SPECIALIST_SOL, qa_route=sr.SPECIALIST_SOL)]
            for field in sr._PLAN_ROUTE_FIELDS:
                for route in (None, "cursor:auto", "codex:gpt-6.1-sol:medium", sr.SPECIALIST_SOL):
                    if route != before[field]:
                        requests.append({field: route})
            for requested in requests:
                if all(requested[k] == before[k] for k in requested):
                    continue
                with self.subTest(writer=name, requested=requested):
                    e = copy.deepcopy(original)
                    e["plan"].update(requested)
                    self._blocked(e, "routes")
            # A qualified ordinary AGY QA is legitimate only when requested too.
            if name != "complex":
                e = copy.deepcopy(original)
                e.update(agy_qa_qualified=True, qa_route_proof="agy:claude-sonnet-5-5-medium")
                self._blocked(e, "routes")
                e["plan"]["qa_route"] = e["qa_route_proof"]
                self._control(e)

    def test_h3_search_covers_every_repair_and_the_same_defect(self):
        inside = "apps/web/src/export.ts"
        finding = {"id": "f1", "severity": "low", "location": inside}
        for name, original in self._writers().items():
            self._control(original)
            for updates in (
                {"paths": ["apps/api/index.ts"], "findings": [dict(finding, location="apps/api/index.ts")]},
                {"paths": [inside, "apps/api/index.ts"]},
                {"findings": [finding, dict(finding, id="f2", location="apps/api/index.ts")]},
                {"paths": ["apps/web/src_export.ts"]},
                {"paths": ["apps/web/src"], "findings": [finding]},
                {"paths": [inside], "findings": [dict(finding, location="apps/web/src")]},
                {"defect_fingerprint": "fp-author"},
                {"defect_fingerprint": ""},
                {"defect_fingerprint": "fp-port"},
                {"class_search": search(pattern="OldAuthor")},
                {"class_search": search(diff_identifiers=["OtherExport"])},
                {"suggested_class": "SOURCE_CRITICAL"},
            ):
                with self.subTest(writer=name, updates=updates):
                    e = copy.deepcopy(original)
                    e.update(updates)
                    self._blocked(e)
            for scope in ("apps/web/src", inside):
                e = copy.deepcopy(original)
                e.update(paths=[inside], findings=[finding],
                         class_search=search(scope=scope, scope_listing=[inside]))
                self._control(e)
                if scope == inside:
                    e["paths"].append(inside + "/index.ts")
                    self._blocked(e)
            e = copy.deepcopy(original)
            e.update(paths=[inside, "apps/web/src/index.ts"], findings=[finding])
            self._blocked(e)
            e["paths"] = [inside]
            e["defect_fingerprint"] = "fp-OldExport"
            self._control(e)

    def test_m1_outer_envelope_rejects_overloaded_equality(self):
        class Forged(str):
            def __eq__(self, other):
                return True
            def __ne__(self, other):
                return False
            __hash__ = str.__hash__

        for name, e in self._writers().items():
            self._control(e)
            for field in ("schema", "semantics"):
                c = case(copy.deepcopy(e))
                c[field] = Forged("authorization")
                with self.subTest(writer=name, field=field):
                    d = sr.decide(c)
                    self.assertTrue(d["rejected"], d)
                    self.assertEqual(d["event_class"], "REJECTED", d)
                    self.assertFalse(d["executed"], d)
                    self.assertFalse(d["writer"], d)

    def test_fixed_seed_effect_subsets_without_edit_never_write(self):
        started = time.monotonic()
        rng = random.Random(20261025)
        for index in range(120):
            e = rng.choice(list(self._writers().values()))
            e["plan"]["effects"] = [x for x in ("read", "none", "deterministic_tool") if rng.getrandbits(1)]
            with self.subTest(sample=index):
                self._blocked(e, "effects")
        self.assertLess(time.monotonic() - started, 20)

    def test_fixed_seed_requested_route_conflicts_never_write(self):
        started = time.monotonic()
        rng = random.Random(20261025)
        for index in range(120):
            e = rng.choice(list(self._writers().values()))
            before = self._control(e)
            field = rng.choice(sorted(sr._PLAN_ROUTE_FIELDS))
            e["plan"][field] = rng.choice([r for r in sorted(sr.ROUTES) + [None] if r != before[field]])
            with self.subTest(sample=index):
                self._blocked(e, "routes")
        self.assertLess(time.monotonic() - started, 20)

    def test_fixed_seed_outside_search_paths_never_write(self):
        started = time.monotonic()
        rng = random.Random(20261025)
        for index in range(120):
            e = rng.choice(list(self._writers().values()))
            path = rng.choice(("apps/api/", "apps/web/", "apps/web/src_export/")) + rng.choice(("index.ts", "export.ts", "author.ts"))
            e["paths"] = ["apps/web/src/export.ts"]
            e["findings"] = [{"id": "f1", "severity": "low", "location": "apps/web/src/export.ts"}]
            if rng.getrandbits(1):
                e["paths"].append(path)
            else:
                e["findings"].append({"id": "f2", "severity": "low", "location": path})
            with self.subTest(sample=index):
                self._blocked(e)
        self.assertLess(time.monotonic() - started, 20)

    def test_fixed_seed_subclass_and_foreign_type_fuzz(self):
        started = time.monotonic()
        rng = random.Random(20261025)
        hooks = []

        class Foreign:
            def __eq__(self, other):
                hooks.append("eq")
                return True
            def __ne__(self, other):
                hooks.append("ne")
                return False
            def __hash__(self):
                hooks.append("hash")
                return 0
            def __deepcopy__(self, memo):
                hooks.append("deepcopy")
                return self

        class Str(str, Foreign):
            __eq__ = Foreign.__eq__
            __ne__ = Foreign.__ne__
            __hash__ = str.__hash__

        class Int(int, Foreign):
            pass
        class List(list, Foreign):
            pass
        class Dict(dict, Foreign):
            pass

        # Every evidence descriptor is populated, as are both bindings, pins,
        # search/diff/plan/finding/prior fields and nonempty list elements.
        e = dict(sr._defaults(), **fast())
        e.update(event_text="author", goal="rename export", diagnostics=["author"],
                 paths=["apps/web/src/export.ts"], missing_inputs=["author"], history=["attempt-1"],
                 findings=[{"id": "f1", "severity": "low", "location": "apps/web/src/export.ts"}],
                 prior_fast_fix={"fingerprint": "fp-export", "result": "pass"})
        e["plan"]["model_ids"] = ["gpt-6.1-sol"]
        # A complete-context writer has no missing inputs (R10 finding B).
        # Keep the nonempty list below for the original element/type probes.
        self._control(dict(e, missing_inputs=[]))
        self.assertEqual(sr.decide(case(e))["event_class"], "INPUT_MISSING")
        original = case(e)

        def paths(value, prefix=()):
            yield prefix
            if type(value) is dict:
                for key, child in value.items():
                    yield from paths(child, prefix + (key,))
            elif type(value) is list:
                for i, child in enumerate(value):
                    yield from paths(child, prefix + (i,))

        locations = list(paths(original))
        rng.shuffle(locations)
        for path in locations:
            value = original
            for part in path:
                value = value[part]
            # Same-value subclasses and all foreign categories at EVERY field.
            bad = [Str(value if type(value) is str else "authorization"), Int(1), List(), Dict(), Foreign()]
            if type(value) is dict:
                bad.append(Dict(value))
            elif type(value) is list:
                bad.append(List(value))
            for replacement in bad:
                c = copy.deepcopy(original)
                target = c
                for part in path[:-1]:
                    target = target[part]
                if path:
                    target[path[-1]] = replacement
                else:
                    c = replacement
                with self.subTest(path=path, kind=type(replacement).__name__):
                    hooks.clear()
                    d = sr.decide(c)
                    self.assertFalse(d["writer"], d)
                    self.assertFalse(d["fast_fix"], d)
                    self.assertEqual(hooks, [], "input hooks ran before exact-type rejection")
                    if len(path) <= 1:
                        self.assertTrue(d["rejected"], d)
                    if path[:2] == ("evidence", "plan"):
                        self.assertIsNotNone(sr.validate_plan(c["evidence"]["plan"]))
                        self.assertEqual(hooks, [], "standalone plan validation ran input hooks")
            # Keys must be exact strings before hashing or lookup, at every level.
            if type(value) is dict:
                for key in value:
                    c = copy.deepcopy(original)
                    target = c
                    for part in path:
                        target = target[part]
                    item = target.pop(key)
                    target[Str(key)] = item
                    hooks.clear()
                    with self.subTest(path=path, key=key):
                        self.assertFalse(sr.decide(c)["writer"])
                        self.assertEqual(hooks, [])
                        if path[:2] == ("evidence", "plan"):
                            self.assertIsNotNone(sr.validate_plan(c["evidence"]["plan"]))
                            self.assertEqual(hooks, [])
        self.assertLess(time.monotonic() - started, 20)


class SmartRoutingQaR9(unittest.TestCase):
    """Writer admission is conjunctive across every source route, never a brief waiver."""

    @staticmethod
    def _writers():
        inside = "apps/web/src/export.ts"
        common = {"paths": [inside], "findings": [
            {"id": "f1", "severity": "low", "location": inside}]}
        return {
            "fast": fast(**common),
            "standard": _proven_brief(**common),
            # A LOCAL-looking repair reuses an ordinary plan; its LOCAL-only
            # declarations are not proven on that plan. It must use STANDARD.
            "brief_reuse": fast(brief_usable=True, plan=plan(), **common),
            "complex": _proven_brief(
                complexity="complex", change_surface="state", **QA, **common,
                plan=plan(author_route=sr.SPECIALIST_SOL, qa_route=sr.SPECIALIST_SOL)),
            "continuation": _proven_brief(author_attempts=3, progress=True, **common),
        }

    def _control(self, name, evidence):
        d = check(sr.decide(case(evidence)))
        self.assertTrue(d["writer"], d)
        self.assertTrue(d["executed"], d)
        self.assertTrue(d["plan_honored"], d)
        expected = {"fast": "SOURCE_KNOWN_LOCAL", "standard": "SOURCE_KNOWN_STANDARD",
                    "brief_reuse": "SOURCE_KNOWN_STANDARD", "complex": "SOURCE_KNOWN_COMPLEX",
                    "continuation": "CONTINUATION"}
        self.assertEqual(d["event_class"], expected[name], d)
        return d

    def _refuse(self, evidence, reason=None):
        d = check(sr.decide(case(evidence)))
        self.assertFalse(d["writer"], d)
        self.assertFalse(d["fast_fix"], d)
        self.assertFalse(d["continuation_granted"], d)
        self.assertFalse(d["plan_honored"], d)
        self.assertTrue(d["reason"], d)
        if reason:
            self.assertIn(reason, d["reason"], d)
        return d

    def test_h1_every_repair_and_finding_is_in_matched_listing(self):
        for name, original in self._writers().items():
            self._control(name, original)
            for carrier in ("paths", "findings", "both"):
                e = copy.deepcopy(original)
                if carrier in ("paths", "both"):
                    e["paths"].append("apps/web/src/index.ts")
                if carrier in ("findings", "both"):
                    e["findings"].append({"id": "f2", "severity": "low",
                                          "location": "apps/web/src/index.ts"})
                with self.subTest(route=name, carrier=carrier):
                    self._refuse(e)
            # A second identifier/class is not silently hidden by one good match.
            for updates in ({"class_search": search(diff_identifiers=["OldExport", "OldIndex"])},
                            {"suggested_class": "SOURCE_CRITICAL"}):
                e = copy.deepcopy(original)
                e.update(updates)
                self._refuse(e)
            # Multiple findings of the same matched location keep closure.
            e = copy.deepcopy(original)
            e["findings"].append(dict(e["findings"][0], id="f2"))
            self._control(name, e)

    def test_h2_exact_independence_proof_on_every_writer(self):
        missing = object()
        for name, original in self._writers().items():
            self._control(name, original)
            for value in (False, missing):
                e = copy.deepcopy(original)
                if value is missing:
                    del e["qa_independent"]
                else:
                    e["qa_independent"] = value
                with self.subTest(route=name, missing=value is missing):
                    self._refuse(e, "independent")
        # The exact reported continuation, with the helper's ordinary brief.
        self._refuse(_proven_brief(qa_independent=False, author_attempts=3, progress=True),
                     "independent")

    def test_h3_acceptance_is_immutable_even_with_usable_brief(self):
        for name, original in self._writers().items():
            self._control(name, original)
            e = copy.deepcopy(original)
            e["acceptance_unchanged"] = False
            with self.subTest(route=name):
                self._refuse(e, "acceptance")
        for brief in (False, True):
            self._refuse(fast(acceptance_unchanged=False, brief_usable=brief,
                              paths=["apps/web/src/export.ts"]), "acceptance")

    def test_m1_instruction_does_not_borrow_test_target_from_metadata(self):
        for name, original in self._writers().items():
            for path in ("apps/web/src/export.ts", "apps/web/src/test.ts",
                         "apps/web/src/remove_test.ts", "apps/web/src/delete_fixture_spec.ts"):
                e = copy.deepcopy(original)
                e.update(event_text="remove the latest typo", paths=[path],
                         findings=[{"id": "f1", "severity": "low", "location": path}],
                         class_search=search(scope=path, scope_listing=[path]))
                with self.subTest(route=name, path=path):
                    self._control(name, e)
                    if name != "complex":
                        self._control(name, dict(e, change_surface="test-name"))
                # Real deletion intent and failed diff proofs still refuse.
                e["event_text"] = "remove the test"
                self._refuse(e, "condition 7")
                e["event_text"] = "remove the latest typo"
                e["diff_check"]["assertions_unchanged"] = False
                self._refuse(e, "condition 7")

    def test_conditions_by_routes_matrix(self):
        # Each mutation changes ONE fact of an all-true control. §9 conditions
        # and §3.3/7/11/13 + EOM §8/8.1 envelope/continuation extras are explicit.
        mutations = {
            "1 cause": (("cause",), "unresolved"),
            "1 acceptance": (("acceptance_unchanged",), False),
            "2 minimal action": (("minimal_action_known",), False),
            "2 architecture": (("architecture_research_required",), True),
            "3 critical": (("risk",), "critical"),
            "3 effects": (("external_effects_unknown",), True),
            "3 unknown outcome": (("unknown_effect",), True),
            "4 scope": (("scope_within_admission",), False),
            "4 budget": (("finite_budget",), False),
            "5 regression": (("regression_known",), False),
            "6 history": (("fast_fix_history_checked",), False),
            "6 failed fast fix": (("prior_fast_fix",), {"fingerprint": "fp-export", "result": "fail"}),
            "7 diff assertions": (("diff_check", "assertions_unchanged"), False),
            "7 diff expected": (("diff_check", "expected_values_unchanged"), False),
            "7 diff QA": (("diff_check", "qa_unchanged"), False),
            "7 diff timeout": (("diff_check", "timeout_unchanged"), False),
            "7 diff auth": (("diff_check", "auth_unchanged"), False),
            "7 textual deletion": (("event_text",), "remove the test"),
            "8 saved search": (("class_search", "saved"), False),
            "8 matched location": (("findings", 0, "location"), "apps/web/src/index.ts"),
            "8 diff identifier": (("class_search", "diff_identifiers"), ["OtherExport"]),
            "8 suggested class": (("suggested_class",), "SOURCE_CRITICAL"),
            "independence": (("qa_independent",), False),
            "fresh session": (("session_shared",), True),
            "immutable snapshot": (("author_qa_same_snapshot",), True),
            "context complete": (("context_complete",), False),
            "context hash": (("context_hash_ok",), False),
            "plan schema": (("plan_json_valid",), False),
            "reconciliation": (("reconciled",), False),
            "duplicate": (("dispatch_duplicate",), True),
            "refusal": (("platform_refusal",), True),
            "source effects": (("plan", "effects"), ["read"]),
            "executable": (("plan", "executable"), False),
            "binding": (("plan", "binding", "head"), "c" * 40),
            "author route": (("plan", "author_route"), "codex:gpt-6-luna:medium"),
            "QA route": (("plan", "qa_route"), "codex:gpt-6-luna:medium"),
            "no progress": (("no_progress_streak",), 2),
        }
        for name, original in self._writers().items():
            self._control(name, original)
            for condition, (path, value) in mutations.items():
                e = copy.deepcopy(original)
                target = e
                for part in path[:-1]:
                    target = target[part]
                target[path[-1]] = value
                with self.subTest(route=name, condition=condition):
                    self._refuse(e)
        # Only continuation has progress/continuation-budget requirements.
        for field, value in (("progress", False), ("brief_usable", False), ("continuation_used", 2)):
            e = self._writers()["continuation"]
            e[field] = value
            self._refuse(e)
        e = self._writers()["complex"]
        e["critical_qa_qualified"] = False
        self._refuse(e)

    def test_fixed_seed_uncovered_subsets_never_write(self):
        started = time.monotonic()
        rng = random.Random(20261025)
        pool = ["apps/web/src/" + name + ".ts" for name in ("export", "index", "author", "test")]
        for index in range(90):
            # One real matched instance, plus a random subset of unlisted sites.
            covered = rng.choice(pool)
            uncovered = rng.sample([p for p in pool if p != covered], rng.randint(1, 3))
            for name, e in self._writers().items():
                e.update(paths=[covered], findings=[{"id": "f1", "severity": "low", "location": covered}],
                         class_search=search(scope_listing=[covered]))
                for path in uncovered:
                    if rng.getrandbits(1):
                        e["paths"].append(path)
                    else:
                        e["findings"].append({"id": "f" + str(len(e["findings"]) + 1),
                                              "severity": "low", "location": path})
                with self.subTest(sample=index, route=name):
                    self._refuse(e)
        self.assertLess(time.monotonic() - started, 20)

    def test_fixed_seed_nontrue_independence_and_acceptance_never_write(self):
        started = time.monotonic()
        rng = random.Random(20261025)
        # bool cannot be subclassed in Python. int subclasses include a hostile
        # bool-like object; exact schema validation must not call its hooks.
        hooks = []
        class Int(int):
            def __bool__(self):
                hooks.append("bool")
                return True
            def __eq__(self, other):
                hooks.append("eq")
                return True
        missing = object()
        values = [False, None, missing, 0, 1, "true", Int(0), Int(1)]
        rng.shuffle(values)
        for field in ("qa_independent", "acceptance_unchanged"):
            for value in values:
                for name, e in self._writers().items():
                    if value is missing:
                        del e[field]
                    else:
                        e[field] = value
                    with self.subTest(field=field, value=repr(value), route=name):
                        self._refuse(e)
                    self.assertEqual(hooks, [])
        self.assertLess(time.monotonic() - started, 20)

    def test_fixed_seed_path_words_keep_legitimate_typo_fast(self):
        started = time.monotonic()
        rng = random.Random(20261025)
        # Include test-only first: the exact reported false positive, with no
        # newly accepted path words needed to reproduce it on the old code.
        for index in range(100):
            words = ["test"] if index == 0 else rng.sample(
                ("test", "spec", "fixture", "remove", "delete", "export", "index"), rng.randint(1, 4))
            path = "apps/web/src/" + "_".join(words) + ".ts"
            e = fast(event_text="remove the latest typo", paths=[path],
                     class_search=search(scope=path, scope_listing=[path]))
            with self.subTest(sample=index, path=path):
                self._control("fast", e)
        self.assertLess(time.monotonic() - started, 20)


class SmartRoutingQaR11(unittest.TestCase):
    """Focused R10 A/B/C reproductions; earlier regression assertions stay intact."""

    _writers = staticmethod(SmartRoutingQaR9._writers)
    _control = SmartRoutingQaR9._control
    _refuse = SmartRoutingQaR9._refuse

    def test_a_split_direct_intent_blocks_all_five_routes(self):
        for name, original in self._writers().items():
            self._control(name, original)
            for mutation in ({"history": ["remove test"]},
                             {"history": ["remove", "test"]},
                             {"event_text": "remove", "history": ["test"]},
                             {"goal": "remove", "history": ["test"]},
                             {"history": ["test", "remove"]}):
                e = copy.deepcopy(original)
                e.update(mutation)
                with self.subTest(route=name, mutation=mutation):
                    d = self._refuse(e, "condition 7")
                    self.assertEqual(d["history"], e["history"])

    def test_a_metadata_cannot_supply_instruction_target(self):
        path = "apps/web/src/remove_test_delete_fixture_spec.ts"
        for name, original in self._writers().items():
            e = copy.deepcopy(original)
            e.update(event_text="remove", history=["attempt-1"], paths=[path],
                     findings=[{"id": "f1", "severity": "low", "location": path}],
                     class_search=search(scope=path, scope_listing=[path]))
            with self.subTest(route=name):
                self._control(name, e)

    def test_b_missing_inputs_hold_even_with_complete_context(self):
        for name, original in self._writers().items():
            self._control(name, dict(original, missing_inputs=[]))
            e = copy.deepcopy(original)
            e.update(missing_inputs=["export"], history=["attempt-1"])
            with self.subTest(route=name):
                d = self._refuse(e)
                self.assertEqual(d["event_class"], "INPUT_MISSING", d)
                self.assertEqual(d["route"], "hold", d)
                self.assertEqual(d["missing_inputs"], ["export"])
                self.assertFalse(d["executed"], d)
                self.assertFalse(d["full_trusted_fallback"], d)
                self.assertEqual(d["model_calls"], 0)
                self.assertEqual(d["author_attempts"], original["author_attempts"])
                self.assertEqual(d["history"], e["history"])
                # Exercise the final predicate separately from the initial gate:
                # a branch's success flags cannot override missing evidence.
                validated = sr._evidence(e)
                validated.binding = dict(BIND)
                validated.policy_active = True
                success = sr.decide(case(original))
                final = sr._emit({}, validated, validated["plan"], **success)
                for flag in ("writer", "executed", "fast_fix", "plan_honored",
                             "continuation_granted", "history_reset"):
                    self.assertFalse(final[flag], final)
                self.assertEqual(final["route"], "hold", final)
                self.assertEqual(final["model_calls"], 0)

    @staticmethod
    def _reorder(value, reverse):
        if type(value) is dict:
            return {key: SmartRoutingQaR11._reorder(value[key], reverse)
                    for key in sorted(value, reverse=reverse)}
        if type(value) is list:
            return [SmartRoutingQaR11._reorder(item, reverse) for item in value]
        return value

    def test_c_legitimate_paths_and_insertion_order_keep_all_routes(self):
        for name, original in self._writers().items():
            for text in ("author", "authors"):
                for filename in ("spec.ts", "fixture.ts"):
                    path = "apps/web/src/" + filename
                    e = copy.deepcopy(original)
                    e.update(event_text=text, paths=[path],
                             findings=[{"id": "f1", "severity": "low", "location": path}],
                             class_search=search(scope=path, scope_listing=[path]))
                    # Exact R10 permutation, plus recursive forward/reverse order.
                    items = [(key, val) for key, val in e.items() if key != "event_text"]
                    at = [key for key, val in items].index("minimal_action_known")
                    items.insert(at + 1, ("event_text", text))
                    with self.subTest(route=name, text=text, path=path):
                        expected = self._control(name, e)
                        self.assertEqual(expected["fast_fix"], name == "fast")
                        self.assertEqual(expected["risk"], sr.decide(case(original))["risk"])
                        for reordered in (dict(items), self._reorder(e, False),
                                          self._reorder(e, True)):
                            self.assertEqual(e, reordered)
                            self.assertEqual(sr.decide(case(reordered)), expected)

    def test_c_safety_and_unknown_path_fragments_survive_reordering(self):
        for name, original in self._writers().items():
            for mutation in ({"event_text": "%72emove%20test"},
                             {"event_text": "r e m o v e t e s t"},
                             {"event_text": "remоve test"},  # Cyrillic о
                             {"paths": ["apps/web/src/aut_h.ts"]},
                             {"paths": ["apps/web/src/unknownword.ts"]}):
                e = copy.deepcopy(original)
                e.update(mutation)
                with self.subTest(route=name, mutation=mutation):
                    expected = self._refuse(e)
                    for reverse in (False, True):
                        self.assertEqual(sr.decide(case(self._reorder(e, reverse))), expected)


if __name__ == "__main__":
    unittest.main()

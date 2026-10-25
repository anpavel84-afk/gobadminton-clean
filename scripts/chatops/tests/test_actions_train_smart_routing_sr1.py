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
        "risk": "low", "cause": "proven", "effects_proven_absent": True,
    }
    evidence.update(updates)
    return evidence


def search(instances=1, saved=True, assurance_only=False, pattern="OldExport",
           method="grep", scope="apps/web/src"):
    return {"saved": saved, "method": method, "pattern": pattern, "scope": scope,
            "instances": instances, "assurance_only": assurance_only}


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
                     auth_unchanged=True, fast_fix_history_checked=True, plan=proof_plan())
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
            brief_usable=True, cause="proven", risk="moderate", author_attempts=1,
            minimal_action_known=True))))
        self.assertEqual(decision["planner_calls"], 0)
        self.assertEqual(decision["astra_calls"], 0)
        self.assertEqual(decision["event_class"], "SOURCE_KNOWN_STANDARD")

    def test_sr_t05_known_complex_noncritical_skips_astra(self):
        decision = check(sr.decide(case(ready(
            cause="proven", complexity="complex", risk="moderate", change_surface="state",
            difficult_or_repeating=False, brief_usable=False, minimal_action_known=True))))
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
            minimal_action_known=True, risk="moderate", history=history))))
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
                self.assertTrue(decision["rejected"])
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
        for surface in ("author", "AUTHOR", "authors", "secretary", "rename"):
            with self.subTest(surface=surface):
                decision = check(sr.decide(case(fast(change_surface=surface, risk="low", line_count=1,
                                                     suggested_class="SOURCE_KNOWN_LOCAL"))))
                self.assertEqual(decision["risk"], "low")
                self.assertTrue(decision["fast_fix"])
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
                              scope_within_admission=False),
            "template-model": ready(template_id="formatter", template_applicable=True,
                                    template_tool=None, change_surface="format",
                                    scope_within_admission=False),
            "brief": ready(brief_usable=True, cause="proven", author_attempts=1,
                           minimal_action_known=True, scope_within_admission=False),
            "continuation": ready(author_attempts=3, continuation_used=0, progress=True,
                                  brief_usable=True, minimal_action_known=True, risk="moderate",
                                  scope_within_admission=False),
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
                              change_surface="format", plan=plan(executable=False)),
            "fast": fast(plan=proof_plan(executable=False)),
        }
        for name, evidence in samples.items():
            with self.subTest(name=name):
                decision = _not_writer(self, evidence)
                self.assertFalse(decision["executed"])
        truthy = check(sr.decide(case(ready(
            brief_usable=True, cause="proven", author_attempts=1, minimal_action_known=True,
            plan=plan(executable=1)))))
        self.assertTrue(truthy["rejected"])
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


if __name__ == "__main__":
    unittest.main()

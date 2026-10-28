"""Prelaunch simulation tests. No runtime/CLI/process/Issue writes."""
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts/chatops/planning"))
import phase_router_v2_dry as R

SHA="a"*40


def cap(model, *, proven=True, allowed=True, quota=True, qa=False):
    return R.Capability(model, proven, allowed, quota, read_only_qa=qa)


def author_stage(risk="routine", frozen=False, sha=None):
    return R.Stage("implementation",risk,("cursor:auto","codex:gpt-6.1-sol:medium",
                   "codex:gpt-6.1-sol:high"),True,
                   architecture_frozen=frozen,architecture_proof_sha=sha)


def independent_stage(risk="critical", **overrides):
    base=dict(role="independent_qa",risk=risk,
              approved_models=("agy:claude-opus-5-5-high", "agy:claude-sonnet-5-5-high"),
              exact_scope_authorized=True,candidate_sha=SHA,
              author_identity="agent-auth",author_session="session-auth",
              author_worktree="worktree-auth")
    base.update(overrides)
    return R.Stage(**base)


QA={"qa_identity":"agent-qa","qa_session":"session-qa",
    "qa_worktree":"worktree-qa","qa_candidate_sha":SHA}


class RoutingProposal(unittest.TestCase):
    def test_type_first_prefers_cursor_for_routine_source(self):
        stage=author_stage()
        caps={"cursor:auto":cap("cursor:auto"),
              "codex:gpt-6.1-sol:medium":cap("codex:gpt-6.1-sol:medium")}
        self.assertEqual(R.propose(stage,caps)["model"],"cursor:auto")

    def test_cursor_quota_gap_selects_approved_sol_medium(self):
        stage=author_stage()
        caps={"cursor:auto":cap("cursor:auto",quota=False),
              "codex:gpt-6.1-sol:medium":cap("codex:gpt-6.1-sol:medium")}
        self.assertEqual(R.propose(stage,caps)["model"],"codex:gpt-6.1-sol:medium")

    def test_unproven_model_and_unknown_quota_refuse_effect(self):
        stage=author_stage()
        for c in (cap("cursor:auto",proven=False),
                  cap("cursor:auto",quota=False),
                  cap("cursor:auto",allowed=False)):
            with self.subTest(c=c):
                self.assertEqual(R.propose(stage,{"cursor:auto":c})["status"],
                                 "WAIT_PROVIDER_OR_PERMISSION")

    def test_wrong_capability_binding_refused(self):
        self.assertEqual(R.propose(author_stage(),
            {"cursor:auto":cap("different-model")})["status"],"WAIT_PROVIDER_OR_PERMISSION")

    def test_critical_architecture_prefers_astra_high(self):
        a=R.Stage("architecture","critical",
                  ("codex:gpt-6-astra:high","codex:gpt-6.1-sol:high"),True)
        self.assertEqual(R.propose(a,{"codex:gpt-6-astra:high":
                         cap("codex:gpt-6-astra:high")})["model"],"codex:gpt-6-astra:high")

    def test_complex_architecture_can_use_astra_medium(self):
        a=R.Stage("architecture","complex",("codex:gpt-6-astra:medium",),True)
        self.assertEqual(R.propose(a,{"codex:gpt-6-astra:medium":
                         cap("codex:gpt-6-astra:medium")})["model"],"codex:gpt-6-astra:medium")

    def test_complex_critical_code_requires_frozen_architecture_and_exact_sha(self):
        for risk in ("complex","critical"):
            for frozen, proof in ((False,None),(True,None),(True,"not-sha")):
                stage=author_stage(risk,frozen,proof)
                with self.subTest(risk=risk,frozen=frozen,proof=proof):
                    self.assertEqual(R.propose(stage,{"cursor:auto":cap("cursor:auto")})["status"],"BLOCKED")
            self.assertEqual(R.propose(author_stage(risk,True,SHA),
                    {"cursor:auto":cap("cursor:auto")})["model"],"cursor:auto")

    def test_exploratory_code_cannot_run_until_diagnosed(self):
        self.assertEqual(R.propose(author_stage("exploratory"),{
            "cursor:auto":cap("cursor:auto")})["status"],"BLOCKED")

    def test_qa_requires_exact_separate_identity_and_source_sha(self):
        caps={"agy:claude-opus-5-5-high":
              cap("agy:claude-opus-5-5-high",qa=True)}
        self.assertEqual(R.propose(independent_stage(),caps,**QA)["model"],
                         "agy:claude-opus-5-5-high")
        for kwargs in (
            {},
            dict(QA,qa_identity="agent-auth"),
            dict(QA,qa_session="session-auth"),
            dict(QA,qa_worktree="worktree-auth"),
            dict(QA,qa_candidate_sha="b"*40),
            dict(QA,qa_session=None),
        ):
            with self.subTest(kwargs=kwargs):
                self.assertEqual(R.propose(independent_stage(),caps,**kwargs)["status"],"BLOCKED")

    def test_qa_requires_read_only_capability(self):
        caps={"agy:claude-opus-5-5-high":
              cap("agy:claude-opus-5-5-high",qa=False)}
        self.assertEqual(R.propose(independent_stage(),caps,**QA)["status"],
                         "WAIT_PROVIDER_OR_PERMISSION")

    def test_no_model_for_ci_dev_but_no_release_authority_minted(self):
        for role in ("ci","dev","ops"):
            stage=R.Stage(role,"critical",(),True)
            self.assertEqual(R.propose(stage,{})["status"],"DETERMINISTIC_PENDING_GATES")

    def test_owner_uat_is_not_deterministic_pass(self):
        stage=R.Stage("owner_uat","routine",(),True)
        self.assertEqual(R.propose(stage,{})["status"],"AWAIT_OWNER_ACCEPTANCE")

    def test_missing_owner_permission_never_runs(self):
        a=R.Stage("implementation","routine",("cursor:auto",),False)
        self.assertEqual(R.propose(a,{"cursor:auto":cap("cursor:auto")})["status"],"BLOCKED")

    def test_unknown_effect_requires_reconciliation_even_at_limit(self):
        stage=author_stage()
        r=R.after_failure(kind="provider_quota_before_effect",stage=stage,
                          consumed_attempts=3,max_attempts=3,effect_state="UNKNOWN_EFFECT",
                          same_attempt_reservation_valid=True,current_model="cursor:auto")
        self.assertEqual(r["status"],"RECONCILE_ONLY")

    def test_pre_effect_quota_fallback_requires_same_attempt_permission(self):
        stage=author_stage()
        args=dict(kind="provider_quota_before_effect",stage=stage,
                  consumed_attempts=1,max_attempts=3,effect_state="NO_EFFECT",
                  current_model="cursor:auto")
        self.assertEqual(R.after_failure(**args)["status"],"WAIT_PERMISSION")
        good=R.after_failure(**args,same_attempt_reservation_valid=True)
        self.assertEqual(good["status"],"TRY_APPROVED_FALLBACK")
        self.assertEqual(good["exclude"],("cursor:auto",))

    def test_known_effect_not_treated_as_no_effect_quota_error(self):
        stage=author_stage()
        r=R.after_failure(kind="provider_quota_before_effect",stage=stage,
                          consumed_attempts=1,max_attempts=3,effect_state="KNOWN_EFFECT",
                          same_attempt_reservation_valid=True,current_model="cursor:auto")
        self.assertEqual(r["status"],"CONFIRMED_EFFECT_RECONCILE_STAGE")

    def test_three_consumed_attempts_stop_source_repair(self):
        stage=author_stage()
        for kind in ("qa_source_failure","provider_quota_before_effect"):
            with self.subTest(kind=kind):
                r=R.after_failure(kind=kind,stage=stage,
                     consumed_attempts=3,max_attempts=3,effect_state="NO_EFFECT",
                     same_attempt_reservation_valid=True,current_model="cursor:auto")
                self.assertEqual(r["status"],"DEFERRED")

    def test_ci_environment_failure_never_spends_another_source_attempt(self):
        stage=author_stage()
        r=R.after_failure(kind="ci_environment_failure",stage=stage,
                          consumed_attempts=3,max_attempts=3,effect_state="KNOWN_EFFECT",
                          current_model="cursor:auto")
        self.assertEqual(r["status"],"OPS_EVIDENCE")

    def test_attempts_cannot_be_fractional_or_boolean(self):
        stage=author_stage()
        for attempts,maximum in ((1.2,3),(True,3),(1,2.5),(1,True),(4,3),(-1,3)):
            with self.subTest(attempts=attempts,maximum=maximum):
                r=R.after_failure(kind="qa_source_failure",stage=stage,
                     consumed_attempts=attempts,max_attempts=maximum,
                     effect_state="KNOWN_EFFECT",current_model="cursor:auto")
                self.assertEqual(r["status"],"BLOCKED")

    def test_source_failure_and_architecture_failure_are_different(self):
        stage=author_stage("complex",True,SHA)
        source=R.after_failure(kind="qa_source_failure",stage=stage,consumed_attempts=1,
                      max_attempts=3,effect_state="KNOWN_EFFECT",current_model="cursor:auto")
        arch=R.after_failure(kind="qa_architecture_failure",stage=stage,consumed_attempts=1,
                      max_attempts=3,effect_state="KNOWN_EFFECT",current_model="cursor:auto")
        self.assertEqual(source["status"],"BOUNDED_REPAIR")
        self.assertEqual(arch["status"],"READ_ONLY_ARCHITECTURE_REVIEW")

    def test_existing_backlog_is_inert_graph_not_owner_authority(self):
        p=ROOT/"docs/workbench/phase-routing-v2/BACKLOG_STAGE_PLAN_V002.json"
        data=json.loads(p.read_text())
        self.assertEqual(data["schema"],"GB_PHASE_PLAN_V2_PROPOSAL")
        result=R.validate_draft_graph(data["examples"])
        self.assertEqual(result["children"],18)
        self.assertEqual(result["status"],"STRUCTURE_ONLY_NOT_ADMITTED")
        self.assertIn("Owner_scope",result["unverified_gates"])

    def test_invalid_graph_dep_cycle_dup_and_unauthorized_draft(self):
        valid=lambda key,deps=None:dict(key=key,depends_on=deps or [],can_start_execution=False)
        for children in (
            [valid("a",["b"]),valid("b",["a"])],
            [valid("a",["b"])],
            [valid("a",[0])],
            [valid("a",[True])],
            [valid("a",[1,1])],
            [valid("a",{"evil":"bad"})],
            [dict(key="a",can_start_execution=True)],
        ):
            with self.subTest(children=children),self.assertRaises(ValueError):
                R.validate_draft_graph(children)


if __name__=="__main__":
    unittest.main()

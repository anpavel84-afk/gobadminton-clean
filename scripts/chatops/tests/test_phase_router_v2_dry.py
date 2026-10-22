"""Prelaunch simulation tests only. Never launch CLI, call GitHub or mutate runtime."""
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts/chatops/planning"))
import phase_router_v2_dry as R


def cap(model, *, proven=True, allowed=True, quota=True, qa=False):
    return R.Capability(model, proven, allowed, quota, read_only_qa=qa)


class RoutingProposal(unittest.TestCase):
    def test_type_first_prefers_cursor_for_routine_source(self):
        a = R.Stage(role="implementation", risk="routine",
                    approved_models=("cursor:auto","codex:gpt-6.1-sol:medium"),
                    exact_scope_authorized=True)
        outcome = R.propose(a, {
            "cursor:auto":cap("cursor:auto"),
            "codex:gpt-6.1-sol:medium":cap("codex:gpt-6.1-sol:medium")
        })
        self.assertEqual(outcome["model"],"cursor:auto")

    def test_cursor_quota_gap_selects_approved_sol_medium(self):
        a = R.Stage("implementation","routine",
                    ("cursor:auto","codex:gpt-6.1-sol:medium"),True)
        outcome = R.propose(a, {
            "cursor:auto":cap("cursor:auto",quota=False),
            "codex:gpt-6.1-sol:medium":cap("codex:gpt-6.1-sol:medium")
        })
        self.assertEqual(outcome["model"],"codex:gpt-6.1-sol:medium")

    def test_unproven_model_or_budget_unknown_does_not_run(self):
        a = R.Stage("implementation","routine",("cursor:auto",),True)
        self.assertEqual(R.propose(a,{"cursor:auto":cap("cursor:auto",proven=False)})["status"],
                         "WAIT_PROVIDER_OR_PERMISSION")
        self.assertEqual(R.propose(a,{"cursor:auto":cap("cursor:auto",quota=False)})["status"],
                         "WAIT_PROVIDER_OR_PERMISSION")

    def test_critical_architecture_has_astra_high_before_sol(self):
        a=R.Stage("architecture","critical",
                  ("codex:gpt-6-astra:high","codex:gpt-6.1-sol:high"),True)
        result=R.propose(a,{"codex:gpt-6-astra:high":cap("codex:gpt-6-astra:high"),
                            "codex:gpt-6.1-sol:high":cap("codex:gpt-6.1-sol:high")})
        self.assertEqual(result["model"],"codex:gpt-6-astra:high")

    def test_architecture_frozen_for_critical_cursor_author(self):
        a=R.Stage("implementation","critical",("cursor:auto",),True,
                  architecture_frozen=False)
        self.assertEqual(R.propose(a,{"cursor:auto":cap("cursor:auto")})["status"],
                         "BLOCKED")

    def test_independent_qa_uses_antigravity_readonly_and_not_same_author(self):
        a=R.Stage("independent_qa","critical",
                  ("agy:claude-opus-5-5-high","codex:gpt-6-astra:high"),True,
                  author_identity="agent-1")
        models={"agy:claude-opus-5-5-high":cap("agy:claude-opus-5-5-high",qa=True)}
        self.assertEqual(R.propose(a,models,qa_identity="agent-2")["model"],
                         "agy:claude-opus-5-5-high")
        self.assertEqual(R.propose(a,models,qa_identity="agent-1")["status"],"BLOCKED")
        self.assertEqual(R.propose(a,{"agy:claude-opus-5-5-high":
                                    cap("agy:claude-opus-5-5-high",qa=False)},qa_identity="agent-2")["status"],
                         "WAIT_PROVIDER_OR_PERMISSION")

    def test_deterministic_deploy_does_not_need_model(self):
        a=R.Stage("dev","critical",(),True)
        self.assertEqual(R.propose(a,{})["status"],"DETERMINISTIC")

    def test_missing_owner_envelope_never_runs_any_stage(self):
        a=R.Stage("implementation","routine",("cursor:auto",),False)
        self.assertEqual(R.propose(a,{"cursor:auto":cap("cursor:auto")})["status"],"BLOCKED")

    def test_unknown_effect_requires_reconciliation(self):
        a=R.Stage("implementation","routine",("cursor:auto",),True)
        r=R.after_failure(kind="provider_quota_before_effect",stage=a,attempts=1,
                          max_attempts=3,wrote_or_unknown=True,current_model="cursor:auto")
        self.assertEqual(r["status"],"RECONCILE_ONLY")

    def test_confirmed_pre_effect_quota_fallback_is_bounded(self):
        a=R.Stage("implementation","routine",("cursor:auto","codex:gpt-6.1-sol:medium"),True)
        r=R.after_failure(kind="provider_quota_before_effect",stage=a,attempts=1,
                          max_attempts=3,wrote_or_unknown=False,current_model="cursor:auto")
        self.assertEqual(r["status"],"TRY_APPROVED_FALLBACK")
        self.assertEqual(r["exclude"],("cursor:auto",))

    def test_source_qa_failure_vs_architecture_failure(self):
        a=R.Stage("implementation","complex",("cursor:auto",),True)
        local=R.after_failure(kind="qa_source_failure",stage=a,attempts=1,max_attempts=3,
                              wrote_or_unknown=False,current_model="cursor:auto")
        systemic=R.after_failure(kind="qa_architecture_failure",stage=a,attempts=1,
                                 max_attempts=3,wrote_or_unknown=False,current_model="cursor:auto")
        self.assertEqual(local["status"],"BOUNDED_REPAIR")
        self.assertEqual(systemic["status"],"READ_ONLY_ARCHITECTURE_REVIEW")

    def test_three_exhausted_attempts_never_allow_hidden_retry(self):
        a=R.Stage("implementation","critical",("cursor:auto",),True)
        for kind in ("qa_source_failure","provider_quota_before_effect"):
            with self.subTest(kind=kind):
                r=R.after_failure(kind=kind,stage=a,attempts=3,max_attempts=3,
                                  wrote_or_unknown=False,current_model="cursor:auto")
                self.assertEqual(r["status"],"DEFERRED")

    def test_backlog_graph_is_inert_and_acyclic(self):
        p=ROOT/"docs/workbench/phase-routing-v2/BACKLOG_STAGE_PLAN_V002.json"
        a=json.loads(p.read_text())
        self.assertEqual(a["schema"],"GB_PHASE_PLAN_V2_PROPOSAL")
        self.assertEqual(R.validate_draft_graph(a["examples"])["children"],18)
        self.assertTrue(all(e["can_start_execution"] is False for e in a["examples"]))

    def test_graph_cycle_and_unapproved_draft_refused(self):
        items=[{"key":"a","depends_on":["b"],"can_start_execution":False},
               {"key":"b","depends_on":["a"],"can_start_execution":False}]
        with self.assertRaisesRegex(ValueError,"cyclic"):
            R.validate_draft_graph(items)
        with self.assertRaisesRegex(ValueError,"cannot mint"):
            R.validate_draft_graph([{"key":"a","can_start_execution":True}])


if __name__=="__main__":
    unittest.main()

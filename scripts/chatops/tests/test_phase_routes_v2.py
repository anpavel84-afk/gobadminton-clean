"""V2 stage routing integrated with the immutable V1 Issues/Action bridge.

No runtime/CLI/model/provider calls. Old V1 tasks must remain executable as before.
"""
import copy
import unittest
from test_actions_train import A, S, core, TASK


class Budget:
    def __init__(self, exhausted=False):
        self.exhausted=exhausted

    def remaining(self, name, role, slot):
        return 0 if self.exhausted else 20

    def used(self, name, role, slot):
        return 0


def phase_task(*, kind="implementation", risk="routine", author=None, qa=None, deps=()):
    t=copy.deepcopy(TASK)
    t.update(work_kind=kind, risk=risk,
             author_routes=author or ["cursor:auto","codex:gpt-6.1-sol:medium"],
             qa_routes=qa or ["agy:claude-sonnet-5-5-high","codex:gpt-6.1-sol:high"])
    if deps:t["depends_on"]=list(deps)
    return t


class PhaseRoutingV2(unittest.TestCase):
    def test_legacy_v1_has_no_schema_or_default_route_change(self):
        t=copy.deepcopy(TASK)
        self.assertEqual(A.check_links(t, 200), None)
        r=core.route(S,t,"author","auto",Budget(),"slot1")
        self.assertEqual(r["provider"],"codex")
        self.assertEqual((r["effective_model"],r["effort"]),("gpt-6.1-sol","high"))
        q=core.route(S,t,"qa","codex",Budget(),"slot1")
        self.assertEqual((q["effective_model"],q["effort"]),("gpt-6.1-sol","high"))

    def test_scalar_astra_high_for_separate_architecture_issue(self):
        t=copy.deepcopy(TASK)
        t.update(model="gpt-6-astra",effort="high")
        self.assertIsNone(A.check_links(t,200))
        r=core.route(S,t,"author","auto",Budget(),"slot1")
        self.assertEqual((r["provider"],r["effective_model"],r["effort"]),
                         ("codex","gpt-6-astra","high"))
        # Independent QA remains the separate role, not the author's Astra session.
        q=core.route(S,t,"qa","codex",Budget(),"slot1")
        self.assertEqual(q["effective_model"],"gpt-6.1-sol")

    def test_role_first_prefers_cursor_but_uses_proven_codex_fallback(self):
        t=phase_task()
        self.assertIsNone(A.check_links(t,200))
        r=core.route(S,t,"author","auto",Budget(),"slot1")
        self.assertEqual((r["provider"],r["effective_model"],r["effort"]),
                         ("codex","gpt-6.1-sol","medium"))
        self.assertIn("cursor:auto",r["unavailable"])
        self.assertEqual(r["fallback_reason"],"previous preferred providers unavailable")
        self.assertEqual(r["work_kind"],"implementation")

    def test_critical_architecture_astra_high_route(self):
        t=phase_task(kind="architecture",risk="critical",
                     author=["codex:gpt-6-astra:high","codex:gpt-6.1-sol:high"])
        self.assertIsNone(A.check_links(t,200))
        r=core.route(S,t,"author","auto",Budget(),"slot2")
        self.assertEqual((r["effective_model"],r["effort"]),("gpt-6-astra","high"))

    def test_independent_qa_agy_not_falsely_claimed(self):
        t=phase_task(kind="architecture",risk="critical",
                     author=["codex:gpt-6-astra:high"],
                     qa=["agy:claude-opus-5-5-high","codex:gpt-6.1-sol:high"])
        r=core.route(S,t,"qa","auto",Budget(),"slot1")
        self.assertEqual(r["effective_model"],"gpt-6.1-sol")
        self.assertIn("agy:claude-opus-5-5-high",r["unavailable"])
        self.assertEqual(r["provider"],"codex")

    def test_no_unproven_cursor_or_agy_under_explicit_profiles(self):
        t=phase_task()
        for stage,profile in (("author","cursor"),("qa","agy")):
            with self.subTest(stage=stage):
                with self.assertRaisesRegex(core.Refused, "no safe role-specific provider"):
                    core.route(S,t,stage,profile,Budget(),"slot1")

    def test_critical_source_requires_separate_parent_architecture_dependency(self):
        t=phase_task(risk="critical")
        with self.assertRaisesRegex(A.Hold,"architecture dependency"):
            A.check_links(t,200)
        t["depends_on"]=[199]
        self.assertIsNone(A.check_links(t,200))

    def test_route_approval_is_exact_bounded_immutable_data(self):
        t=phase_task()
        variants = [
            dict(author_routes=["cursor:auto"]*2),
            dict(author_routes=["shell:arbitrary"]),
            dict(author_routes=["codex:gpt-6-astra:ultra"]),
            dict(qa_routes=[]),
            dict(risk="anything"),
            dict(work_kind="admin"),
            dict(model="gpt-6-astra",effort="high"),
        ]
        for mutation in variants:
            with self.subTest(mutation=mutation), self.assertRaises(A.Hold):
                A.check_links(t | mutation,200)

    def test_codex_unavailable_all_roles_fail_closed(self):
        t=phase_task()
        with self.assertRaisesRegex(core.Refused,"no safe role-specific provider"):
            core.route(S,t,"author","auto",Budget(exhausted=True),"slot1")

    def test_actual_model_ledger_meter_not_subscription_credits(self):
        t=phase_task(kind="test",risk="routine")
        v=core.route(S,t,"qa","auto",Budget(),"slot2")
        self.assertEqual(v["remaining_calls"],20)
        self.assertEqual(v["used_calls"],0)


if __name__ == "__main__":
    unittest.main()

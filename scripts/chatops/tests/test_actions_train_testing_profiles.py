"""Risk floors and acceptance plans: saved replays plus conservative negatives."""
import copy
import json
from pathlib import Path
import random
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts/chatops/testing"))
import plan_block as P
import tier_classifier as T


def changes(*paths):
    return [dict(path=path, status="M") for path in paths]


CRITICAL_PATHS = (
    ".github/workflows/ci.yml", "scripts/chatops/actions_train/stage.py",
    "scripts/chatops/planning/phase_task_plan_v2.py", "scripts/chatops/ops/install.py",
    "scripts/chatops/server/http.py", "scripts/chatops/autonomous_issues.py",
    "scripts/chatops/migration-ci.py", "scripts/chatops/db-ci.sh",
    "scripts/chatops/testing/test_groups.json", "docs/rules/DOCUMENT_REGISTER.md",
    "AGENTS.md", ".cursor/rules/rule.mdc", "apps/api/migrations/001.sql",
    *("apps/api/src/" + name + "/index.ts" for name in (
        "auth", "restrictions", "safety", "moderation", "game-moderation", "database")),
    "apps/api/src/tokens.ts", "packages/contracts/openapi.json",
    *("misc/" + name.upper() + ".txt" for name in (
        "budget", "admission", "resolver", "parser", "sandbox", "permission", "privacy",
        "secret", "token", "policy", "qualification")),
)


class ClassifierTests(unittest.TestCase):
    def test_small_python_test_only_uses_targeted_group_without_full_suite(self):
        result = T.classify(changes("scripts/chatops/tests/test_example.py"))
        self.assertEqual(result["tier"], "T1")
        self.assertEqual(result["required_groups"], ["targeted_py"])
        self.assertFalse(result["critical"])

    def test_docs_only_is_t0(self):
        result = T.classify(changes("docs/ops/notes.md", "README.md"))
        self.assertEqual(result["tier"], "T0")
        self.assertFalse(result["visual_qa"])

    def test_ui_css_and_component_need_visual_qa(self):
        result = T.classify(changes("apps/web/src/components/Popup.tsx", "apps/web/src/popup.css"))
        self.assertEqual(result["tier"], "T2")
        self.assertTrue(result["visual_qa"])

    def test_admin_css_and_component_need_visual_qa(self):
        result = T.classify(changes("apps/admin/src/components/Modal.tsx"))
        self.assertEqual(result["tier"], "T2")
        self.assertTrue(result["visual_qa"])

    def test_every_critical_family_is_t3_even_for_one_line(self):
        for path in CRITICAL_PATHS:
            with self.subTest(path=path, note="one-line diff; size deliberately absent"):
                result = T.classify(changes(path))
                self.assertEqual(result["tier"], "T3")
                self.assertTrue(result["critical"])
                self.assertTrue(result["needs_independent_qa"])

    def test_test_filename_does_not_exempt_a_critical_directory_or_name(self):
        for path in ("scripts/chatops/actions_train/test_helpers.py", "tests/test_permission.py"):
            self.assertEqual(T.classify(changes(path))["tier"], "T3")

    def test_removal_is_critical(self):
        self.assertEqual(T.classify([dict(path="docs/notes.md", status="D")])["tier"], "T3")

    def test_executable_mode_is_critical(self):
        for mode, old in (("100755", "100644"), ("100644", "100755")):
            with self.subTest(mode=mode):
                self.assertEqual(T.classify([dict(path="docs/notes.md", status="M", mode=mode,
                                                 old_mode=old)])["tier"], "T3")

    def test_symlink_and_type_changes_are_critical(self):
        for status, mode in (("T", "100644"), ("A", "120000")):
            self.assertEqual(T.classify([dict(path="docs/notes.md", status=status, mode=mode)])["tier"], "T3")

    def test_regular_added_test_is_not_critical_due_to_absent_old_mode(self):
        self.assertEqual(T.classify([dict(path="tests/test_new.py", status="A", old_mode="000000")])["tier"], "T1")

    def test_declared_higher_is_accepted_and_reported(self):
        result = T.verify_declared("T2", changes("docs/notes.md"))
        self.assertTrue(result["ok"])
        self.assertIn("OVER_DECLARED", result["reasons"])

    def test_declared_t0_on_critical_is_rejected(self):
        result = T.verify_declared("T0", changes("AGENTS.md"))
        self.assertFalse(result["ok"])
        self.assertIn("UNDER_DECLARED", result["reasons"])

    def test_unknown_tier_strings_are_errors(self):
        for call in (lambda: T.verify_declared("T4", changes("README.md")),
                     lambda: T.tier_to_risk("low"), lambda: T.risk_to_tier("T1")):
            with self.assertRaises(ValueError):
                call()

    def test_empty_change_list_is_error(self):
        with self.assertRaisesRegex(ValueError, "EMPTY_CHANGES"):
            T.classify([])

    def test_invalid_path_or_status_is_not_docs(self):
        for path, status in (("../docs/notes.md", "M"), ("docs//notes.md", "M"),
                             ("/docs/notes.md", "M"), ("README.md", "?")):
            with self.assertRaises(ValueError):
                T.classify([dict(path=path, status=status)])

    def test_unknown_path_is_raised_and_known_single_module_is_t1(self):
        self.assertEqual(T.classify(changes("unfamiliar/value.xyz"))["tier"], "T2")
        self.assertEqual(T.classify(changes("scripts/check_foundation.py"))["tier"], "T1")

    def test_readme_named_executable_source_is_not_t0(self):
        self.assertNotEqual(T.classify(changes("scripts/README.py"))["tier"], "T0")

    def test_multi_package_and_db_receiver_dependents_are_t2(self):
        for paths in (("apps/api/test/a.test.ts", "apps/web/test/a.test.ts"),
                      ("scripts/helpers/receiver.json",), ("data/db/schema.json",)):
            self.assertEqual(T.classify(changes(*paths))["tier"], "T2")

    def test_random_subsets_are_monotone_and_critical_dominates(self):
        rng = random.Random(31026)
        pool = ["docs/a.md", "README.md", "tests/test_a.py", "scripts/a.py", "scripts/b.py",
                "apps/web/src/c.tsx", "apps/api/src/games/service.ts", "other/a.bin"]
        for _ in range(150):
            subset = rng.sample(pool, rng.randint(1, len(pool)))
            before = T.classify(changes(*subset))["tier"]
            self.assertEqual(T.classify(changes(*subset, rng.choice(CRITICAL_PATHS)))["tier"], "T3")
            after = T.classify(changes(*subset, rng.choice(pool)))["tier"]
            self.assertGreaterEqual(T.TIERS.index(after), T.TIERS.index(before))

    def test_saved_replay_cases_match_every_expectation(self):
        cases = json.loads((ROOT / "scripts/chatops/tests/fixtures/proportionate_testing/replay_cases.json").read_text())["cases"]
        for case in cases:
            with self.subTest(case=case["id"]):
                result, expect = T.classify(case["files"]), case["expect"]
                if "tier" in expect:
                    self.assertEqual(result["tier"], expect["tier"])
                if "min_tier" in expect:
                    self.assertGreaterEqual(T.TIERS.index(result["tier"]), T.TIERS.index(expect["min_tier"]))
                if "visual_qa" in expect:
                    self.assertEqual(result["visual_qa"], expect["visual_qa"])
                if expect.get("strict"):
                    self.assertTrue(result["critical"])
                    self.assertTrue(result["needs_independent_qa"])
                    self.assertEqual(result["required_groups"], list(T.STRICT_GROUPS))
                    self.assertFalse(T.verify_declared("T1", case["files"])["ok"])
                if expect.get("must_not_require_full_suite"):
                    self.assertNotIn("chatops_receiver_actions_train", result["required_groups"])
                    self.assertNotIn("ci_receiver", result["required_groups"])

    def test_all_derived_t3_replay_cases_reject_declared_t1(self):
        cases = json.loads((ROOT / "scripts/chatops/tests/fixtures/proportionate_testing/replay_cases.json").read_text())["cases"]
        for case in cases:
            if T.classify(case["files"])["tier"] == "T3":
                with self.subTest(case=case["id"]):
                    self.assertFalse(T.verify_declared("T1", case["files"])["ok"])

    def test_task_risk_mapping_is_explicit_and_t0_uses_routine(self):
        for risk, tier in (("routine", "T1"), ("complex", "T2"), ("critical", "T3")):
            self.assertEqual(T.risk_to_tier(risk), tier)
            self.assertEqual(T.tier_to_risk(tier), risk)
        self.assertEqual(T.tier_to_risk("T0"), "routine")


class PlanTests(unittest.TestCase):
    def setUp(self):
        self.plan = P.plan_for_changes(changes("scripts/chatops/tests/test_example.py"))

    def assert_code(self, code, call):
        with self.assertRaises(P.PlanError) as caught:
            call()
        self.assertEqual(caught.exception.code, code)

    def test_render_is_byte_deterministic_and_round_trips(self):
        text = P.render(self.plan)
        self.assertEqual(P.parse(text), self.plan)
        self.assertEqual(text.encode(), P.render(dict(reversed(list(self.plan.items())))).encode())
        self.assertLessEqual(len(text), 1200)
        self.assertLessEqual(len(P.render(P.plan_for_changes(changes("AGENTS.md")))), 1200)

    def test_reordered_changes_produce_identical_plan_bytes(self):
        inputs = changes("apps/web/src/components/a.tsx", "apps/web/src/a.css")
        self.assertEqual(P.render(P.plan_for_changes(inputs)), P.render(P.plan_for_changes(inputs[::-1])))

    def test_attach_preserves_existing_acceptance_text(self):
        acceptance = "Criterion A\nCriterion B  \n"
        attached = P.attach(acceptance, self.plan)
        self.assertTrue(attached.startswith(acceptance))
        self.assertEqual(P.parse(attached), self.plan)

    def test_attach_replaces_one_block_preserving_surrounding_text(self):
        text = "before\n" + P.render(self.plan) + "\nafter  "
        plan = P.plan_for_changes(changes("docs/note.md"))
        result = P.attach(text, plan)
        self.assertEqual(result, "before\n" + P.render(plan) + "\nafter  ")

    def test_missing_plan_has_stable_code(self):
        self.assert_code("MISSING_TEST_PLAN", lambda: P.parse("Criterion"))

    def test_duplicate_blocks_are_rejected(self):
        block = P.render(self.plan)
        self.assert_code("DUPLICATE_BLOCK", lambda: P.parse(block + block))

    def test_unknown_group_is_rejected(self):
        text = P.render(self.plan).replace('"targeted_py"', '"made_up"')
        self.assert_code("UNKNOWN_GROUP", lambda: P.parse(text))

    def test_duplicate_group_is_rejected(self):
        plan = {**self.plan, "groups": ["targeted_py", "targeted_py"]}
        self.assert_code("BAD_FIELD", lambda: P.render(plan))

    def test_duplicate_json_key_is_rejected(self):
        text = P.render(self.plan).replace('"tier":"T1"', '"tier":"T1","tier":"T0"')
        self.assert_code("BAD_FIELD", lambda: P.parse(text))

    def test_unknown_key_is_rejected(self):
        self.assert_code("BAD_FIELD", lambda: P.render({**self.plan, "authority": True}))

    def test_missing_key_is_rejected(self):
        plan = copy.deepcopy(self.plan)
        del plan["evidence_rule"]
        self.assert_code("BAD_FIELD", lambda: P.render(plan))

    def test_bad_tier_has_stable_code(self):
        self.assert_code("BAD_TIER", lambda: P.render({**self.plan, "tier": "low"}))

    def test_acceptance_overflow_raises_without_truncation(self):
        acceptance = "x" * 6000
        self.assert_code("ACCEPTANCE_TOO_LONG", lambda: P.attach(acceptance, self.plan))
        self.assertEqual(len(acceptance), 6000)

    def test_acceptance_exact_boundary_is_accepted(self):
        block = P.render(self.plan)
        self.assertEqual(len(P.attach("x" * (5999 - len(block)), self.plan)), 6000)

    def test_parse_rejects_an_overlong_acceptance_too(self):
        self.assert_code("ACCEPTANCE_TOO_LONG", lambda: P.parse("x" * 6000 + P.render(self.plan)))

    def test_risk_is_a_floor_and_never_downgrades_critical(self):
        self.assertEqual(P.plan_for_changes(changes("AGENTS.md"), "routine")["tier"], "T3")
        self.assertEqual(P.plan_for_changes(changes("docs/note.md"), "complex")["tier"], "T2")
        self.assertEqual(P.plan_for_changes(changes("docs/note.md"), "critical")["groups"], list(T.STRICT_GROUPS))

    def test_security_evidence_and_independence_cannot_be_disabled(self):
        for key, value in (("needs_independent_qa", False), ("evidence_rule", "all green"),
                           ("visual_qa", 1), ("risk", "critical")):
            self.assert_code("BAD_FIELD", lambda: P.render({**self.plan, key: value}))


if __name__ == "__main__":
    unittest.main()

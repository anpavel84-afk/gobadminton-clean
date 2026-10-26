"""Catalog/CI alignment and real Git mode/rename profile verification."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
TOOLS = ROOT / "scripts/chatops/testing"
sys.path.insert(0, str(TOOLS))
import catalog as C
import plan_block as P
import tier_classifier as T
import verify_profile as V


class CatalogTests(unittest.TestCase):
    def test_catalog_has_unique_ids_and_executable_local_commands(self):
        groups, raw = C.load_catalog()
        doc = json.loads(raw)
        self.assertEqual(len(groups), len(doc["groups"]))
        for group in groups.values():
            with self.subTest(group=group["id"]):
                self.assertIsInstance(group["argv"], list)
                if group["kind"] == "local":
                    self.assertIsNotNone(shutil.which(group["argv"][0]))
                self.assertTrue((ROOT / group["cwd"]).is_dir())

    def test_all_classifier_required_groups_exist_in_catalog(self):
        groups, _ = C.load_catalog()
        for path in ("docs/notes.md", "scripts/check_foundation.py", "scripts/chatops/tests/test_a.py",
                     "apps/api/test/a.test.ts", "apps/web/src/a.tsx", "apps/admin/src/a.css",
                     "data/db/schema.json", "AGENTS.md"):
            result = T.classify([dict(path=path, status="M")])
            self.assertTrue(set(result["required_groups"]) <= set(groups))

    def test_ci_only_entries_match_seven_expanded_product_jobs(self):
        workflow = (ROOT / ".github/workflows/ci.yml").read_text()
        self.assertEqual(set(re.findall(r"^  ([a-z_]+):$", workflow.split("jobs:\n", 1)[1], re.M)),
                         {"foundation", "source", "database", "receiver"})
        packages = re.search(r"package: \[([^\]]+)\]", workflow).group(1).replace(" ", "").split(",")
        groups, _ = C.load_catalog()
        expected = {"ci_source_" + package for package in packages} | {"ci_database", "ci_receiver"}
        self.assertEqual({gid for gid, g in groups.items() if g["kind"] == "ci_only"}, expected)
        self.assertEqual(len(expected) + 1, 7)  # local foundation maps the seventh job
        self.assertEqual(groups["foundation"]["argv"][-1], "scripts/check_foundation.py")
        for package in packages:
            self.assertEqual(groups["ci_source_" + package]["argv"],
                             ["pnpm", "--filter", "@gobadminton/" + package, "run", "test:unit"])
        self.assertIn('pnpm --filter @gobadminton/${{ matrix.package }} run test:unit', workflow)

    def test_local_discovery_patterns_match_existing_receiver_ci(self):
        groups, _ = C.load_catalog()
        workflow = (ROOT / ".github/workflows/ci.yml").read_text()
        for gid, pattern in (("chatops_receiver_actions_train", "test_actions_train*.py"),
                             ("chatops_phase", "test_phase_*.py")):
            self.assertEqual(groups[gid]["argv"][-2:], ["-p", pattern])
            self.assertIn(pattern, workflow)
        self.assertEqual(groups["chatops_testing_tools"]["argv"][-1], "test_actions_train_testing_*.py")

    def test_catalog_duplicate_ids_are_rejected(self):
        _, raw = C.load_catalog()
        doc = json.loads(raw)
        doc["groups"].append(doc["groups"][0])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalog.json"
            path.write_text(json.dumps(doc))
            with self.assertRaises(ValueError):
                C.load_catalog(path)


class VerifyProfileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "GIT_CONFIG_NOSYSTEM": "1",
                    "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}
        self.git("init", "-q")
        self.git("config", "core.filemode", "true")
        self.write("docs/note.md", "base\n")
        self.write("scripts/chatops/actions_train/core.py", "base\n")
        self.base = self.commit()

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, env=self.env,
                              capture_output=True, text=True, check=True).stdout.strip()

    def write(self, path, text):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def commit(self):
        self.git("add", "-A")
        self.git("-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid",
                 "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture")
        return self.git("rev-parse", "HEAD")

    def acceptance(self, tier="T3"):
        plan = P.plan_for_changes([dict(path="AGENTS.md", status="M")])
        plan.update(tier=tier, risk=T.tier_to_risk(tier))
        return P.attach("Original acceptance", plan)

    def cli(self, head, declared, acceptance=None):
        args = [sys.executable, "-B", str(TOOLS / "verify_profile.py"), "--base", self.base,
                "--head", head, "--declared", declared, "--json"]
        if acceptance is not None:
            path = self.repo / "acceptance.txt"
            path.write_text(acceptance)
            args += ["--acceptance-file", str(path)]
        return subprocess.run(args, cwd=self.repo, env=self.env, capture_output=True, text=True)

    def test_real_diff_rejects_underdeclared_one_line_critical_change(self):
        self.write("scripts/chatops/actions_train/core.py", "head\n")
        head = self.commit()
        result = self.cli(head, "T1", self.acceptance("T1"))
        self.assertEqual(result.returncode, 1, result.stdout)
        data = json.loads(result.stdout)
        self.assertEqual(data["derived"]["tier"], "T3")
        self.assertIn("UNDER_DECLARED", data["reasons"])
        self.assertLessEqual(len(result.stdout.splitlines()), 30)

    def test_real_symlink_change_is_detected_and_t3(self):
        path = self.repo / "docs/note.md"
        path.unlink()
        path.symlink_to("nonexistent-synthetic-target")
        head = self.commit()
        change = V.diff_changes(self.base, head, self.repo)[0]
        self.assertEqual(change["mode"], "120000")
        self.assertEqual(change["status"], "T")
        self.assertEqual(self.cli(head, "T1", self.acceptance("T1")).returncode, 1)

    def test_real_executable_mode_change_is_t3(self):
        (self.repo / "docs/note.md").chmod(0o755)
        head = self.commit()
        change = V.diff_changes(self.base, head, self.repo)[0]
        self.assertEqual(change["old_mode"], "100644")
        self.assertEqual(change["mode"], "100755")
        self.assertEqual(self.cli(head, "T1", self.acceptance("T1")).returncode, 1)

    def test_real_removal_is_t3(self):
        (self.repo / "docs/note.md").unlink()
        head = self.commit()
        self.assertEqual(T.classify(V.diff_changes(self.base, head, self.repo))["tier"], "T3")

    def test_rename_out_of_critical_path_cannot_downgrade(self):
        self.git("mv", "scripts/chatops/actions_train/core.py", "plain.py")
        head = self.commit()
        result = V.diff_changes(self.base, head, self.repo)
        self.assertEqual(len(result), 2)
        self.assertEqual({c["status"] for c in result}, {"R"})
        self.assertEqual(T.classify(result)["tier"], "T3")

    def test_valid_plan_and_declared_tier_pass(self):
        self.write("docs/note.md", "head\n")
        head = self.commit()
        plan = P.plan_for_changes([dict(path="docs/note.md", status="M")])
        self.assertEqual(self.cli(head, "T0", P.attach("AC", plan)).returncode, 0)

    def test_overdeclared_plan_is_allowed_and_reported(self):
        self.write("docs/note.md", "head\n")
        head = self.commit()
        result = self.cli(head, "T3", self.acceptance())
        self.assertEqual(result.returncode, 0)
        self.assertIn("OVER_DECLARED", json.loads(result.stdout)["reasons"])

    def test_missing_acceptance_plan_is_violation(self):
        self.write("docs/note.md", "head\n")
        head = self.commit()
        result = self.cli(head, "T0")
        self.assertEqual(result.returncode, 1)
        self.assertIn("MISSING_TEST_PLAN", json.loads(result.stdout)["reasons"])

    def test_plan_tier_must_equal_declared(self):
        self.write("docs/note.md", "head\n")
        head = self.commit()
        result = self.cli(head, "T1", self.acceptance())
        self.assertEqual(result.returncode, 1)
        self.assertIn("PLAN_TIER_MISMATCH", json.loads(result.stdout)["reasons"])

    def test_missing_derived_required_group_is_violation(self):
        self.write("scripts/chatops/actions_train/core.py", "head\n")
        head = self.commit()
        plan = P.parse(self.acceptance())
        plan["groups"].remove("ci_receiver")
        result = self.cli(head, "T3", P.render(plan))
        self.assertEqual(result.returncode, 1)
        self.assertIn("MISSING_REQUIRED_GROUPS", json.loads(result.stdout)["reasons"])

    def test_visual_qa_cannot_be_cleared_by_plan(self):
        self.write("apps/web/src/components/Popup.tsx", "synthetic\n")
        head = self.commit()
        plan = P.plan_for_changes(V.diff_changes(self.base, head, self.repo))
        plan["visual_qa"] = False
        result = self.cli(head, "T2", P.render(plan))
        self.assertEqual(result.returncode, 1)
        self.assertIn("VISUAL_QA_REQUIRED", json.loads(result.stdout)["reasons"])

    def test_bad_revision_is_usage_error(self):
        self.assertEqual(self.cli("not-a-real-revision", "T1").returncode, 2)

    def test_invalid_tier_is_usage_error(self):
        self.assertEqual(self.cli(self.base, "T4").returncode, 2)

    def test_plan_cli_render_and_check(self):
        paths = self.repo / "paths.json"
        paths.write_text(json.dumps([dict(path="docs/note.md", status="M")]))
        created = subprocess.run([sys.executable, "-B", str(TOOLS / "plan_block.py"), "render",
                                  "--paths-file", str(paths)], capture_output=True, text=True, env=self.env)
        self.assertEqual(created.returncode, 0)
        acceptance = self.repo / "acceptance.txt"
        acceptance.write_text(created.stdout)
        checked = subprocess.run([sys.executable, "-B", str(TOOLS / "plan_block.py"), "check",
                                  "--acceptance-file", str(acceptance)], capture_output=True, text=True, env=self.env)
        self.assertEqual(checked.returncode, 0, checked.stdout)


if __name__ == "__main__":
    unittest.main()

"""PR11 scoped fix: compact planner dependency and safe advisory capsule."""
import unittest
import compact_pm_brief
from compact_task_capsule import capsule,new_semantic_event

class CompactCapsuleBoundary(unittest.TestCase):
    def test_clean_compact_planner_module_import_and_safe_render(self):
        prompt=compact_pm_brief.render([],active_admission_only=False)
        self.assertIn("GoBadminton PM",prompt)
        self.assertIn("source_only",prompt)
        self.assertIn("prod_authorized",prompt)
        self.assertNotIn("sk-proj-",prompt)
    def test_read_only_capsule_does_not_invent_acceptance(self):
        v="f"*40
        item={"id":"friends-test","source":f"https://github.com/anpavel84-afk/gobadminton-clean/blob/{v}/docs/friends.md",
              "admission":f"https://github.com/anpavel84-afk/gobadminton-clean/blob/{v}/docs/friends.md",
              "enabled":True,"locks":["api"],"status":"queued","effect_ceiling":"source_only"}
        data=capsule({"project":"GoBadminton","prod_authorized":False,"tasks":[item]},
                     {"history":[],"active":{},"paused":False},item["id"])
        self.assertEqual(data["disposition"],"REQUIRES_CANONICAL_RUNNER_GATE")
        self.assertEqual(data["next"],"CANONICAL_CHECK_ONLY")
        self.assertEqual(data["llm_default"],"NONE")
    def test_repeated_advisory_fingerprint_not_a_replan_trigger(self):
        item={"project":"GoBadminton","tasks":[{"id":"friends-test","enabled":False}]}
        state={"history":[],"active":{},"paused":False}
        a=capsule(item,state,"friends-test")
        b=capsule(item,state,"friends-test")
        self.assertFalse(new_semantic_event(a,b))
        self.assertTrue(new_semantic_event(None,b))
    def test_bad_identity_fails_closed(self):
        with self.assertRaises(ValueError):
            capsule({"project":"Nope","tasks": []},{"history":[],"active":{}},"friends-test")
        with self.assertRaises(ValueError):
            capsule({"project":"GoBadminton","tasks":[]},{"history":[],"active":{}},"../secrets")
if __name__=="__main__":
    unittest.main()

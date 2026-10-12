"""Conservative hierarchical Runner lock tests. Fully offline; no VPS mutation."""
import unittest
from unittest.mock import patch
from copy import deepcopy
import runner

class ScopedLockTests(unittest.TestCase):
    def test_legacy_coarse_lock_covers_children(self):
        for base in ["web", "api", "deploy-runtime", "schema-contracts"]:
            for child in (base+":games", base+":profile", base+":games:participants"):
                with self.subTest(base=base,child=child):
                    self.assertTrue(runner.locks_conflict([base], [child]))
                    self.assertTrue(runner.locks_conflict([child], [base]))
    def test_nested_scope_conflicts(self):
        self.assertTrue(runner.locks_conflict(["web:games"], ["web:games:create"]))
        self.assertTrue(runner.locks_conflict(["api:games:create"], ["api:games"]))
        self.assertTrue(runner.locks_conflict(["web:games"], ["web:games"]))
    def test_distinct_subdomains_safe(self):
        for left,right in [
            ("web:games","web:radar"),("web:nav","web:profile"),
            ("web:game","web:games"),("api:games","api:profiles"),
            ("web:games","api:games"),("runner-control","web:games"),
            ("deploy-runtime","web:games"),("web:games","map-assets")
        ]:
            with self.subTest(left=left,right=right):
                self.assertFalse(runner.locks_conflict([left],[right]))
                self.assertFalse(runner.locks_conflict([right],[left]))
    def test_multiple_scopes_any_collision(self):
        self.assertTrue(runner.locks_conflict(["web:games","api:games"],["web:radar","api:games:seat"]))
        self.assertFalse(runner.locks_conflict(["web:games","api:games"],["web:radar","api:profiles"]))
    def test_global_still_exclusive(self):
        self.assertTrue(runner.locks_conflict(["global"],["browser-observe"]))
        self.assertTrue(runner.locks_conflict(["web:games"],["global"]))
        self.assertTrue(runner.locks_conflict(["global"],["global"]))
    def test_no_locks_never_admitted(self):
        with self.assertRaises(RuntimeError):runner.task_locks({"id":"x","locks":[]})
        with self.assertRaises(RuntimeError):runner.task_locks({"id":"x","locks":["web:bad name"]})
        self.assertEqual(runner.task_locks({"id":"x"}),("global",))
    def test_scoped_names_validated(self):
        self.assertEqual(runner.task_locks({"id":"x","locks":["WEB:Games","api:games","web:games"]}),("web:games","api:games"))
    def make_state(self, active=None):
        return {"version":2,"paused":False,"blocked":None,"active":{c["id"]:c for c in (active or [])},"history":[],"attempts":{},"current":None}
    def task(self,id,locks,order,after=None):
        return {"id":id,"source":"docs/test-scoped-writer-source.md","locks":locks,"order":order,"status":"queued","enabled":True,"depends_on_completed":after or []}
    def test_four_way_source_selection_and_wait_gates(self):
        q={"tasks":[
            self.task("ui-games",["web:games","api:games"],1),
            self.task("ui-radar",["web:radar","web:nav"],2),
            self.task("nav-duplicate",["web:nav"],3),
            self.task("api-profiles",["api:profiles"],4),
            self.task("legacy-web",["web"],5),
            self.task("late-api",["api"],6),
            self.task("blocked-dependency",["browser-observe"],7,["unbuilt"]),
            self.task("other",["map-assets"],8),
        ]}
        candidates,wait=runner.select_runnable_tasks(q,self.make_state(),{"max_parallel":4},external_writer_busy=False)
        self.assertEqual([x["id"] for x in candidates],["ui-games","ui-radar","api-profiles","other"])
        w={x["id"]:x["reason"] for x in wait}
        self.assertIn("lock conflict",w["legacy-web"])
        self.assertIn("dependency",w["blocked-dependency"])
    def test_current_broad_web_held_cannot_launch_child_web(self):
        active=[{"id":"busy-messages","locks":["web","api","schema-contracts"],"status":"running","claimed_at":"0"}]
        q={"tasks":[self.task("radar",["web:radar"],1),self.task("games",["web:games","api:games","schema-contracts"],2),self.task("map",["map-assets"],3)]}
        c,w=runner.select_runnable_tasks(q,self.make_state(active),{"max_parallel":4},external_writer_busy=False)
        self.assertEqual([x["id"] for x in c],["map"])
        self.assertEqual(len(w),2)
    def test_external_busy_or_pause_keeps_zero(self):
        q={"tasks":[self.task("radar",["web:radar"],1)]}
        s=self.make_state()
        self.assertEqual(runner.select_runnable_tasks(q,s,{"max_parallel":4},external_writer_busy=True),([],[]))
        s["paused"]=True
        self.assertEqual(runner.select_runnable_tasks(q,s,{"max_parallel":4},external_writer_busy=False),([],[]))
    def test_claim_race_rechecks_alias(self):
        # PR143 claims require verified canonical trust and immutable sources.
        # Use disposable Git/runtime authority rather than bypassing preflight
        # and accidentally reading an installed/source-directory state path.
        from test_parallel_integration_pma_v001 import ParallelIntegrationTests
        fixture = ParallelIntegrationTests()
        fixture.setUp()
        try:
            busy = fixture.item('active-radar', ['web:radar'], 0)
            broad = fixture.item('global-web', ['web'], 1)
            nested = fixture.item('nested-radar', ['web:radar:map'], 2)
            games = fixture.item('ui-games', ['web:games'], 3)
            fixture.prepare([busy, broad, nested, games])
            runner.claim_task(busy)
            for item in (broad, nested):
                with self.assertRaisesRegex(RuntimeError, 'lock conflict'):
                    runner.claim_task(item)
            claim = runner.claim_task(games)
            self.assertEqual(claim['locks'], ['web:games'])
            self.assertIn('ui-games', fixture.state()['active'])
        finally:
            fixture.doCleanups()

if __name__=="__main__":unittest.main()

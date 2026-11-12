import json, os, tempfile, unittest
from slots import *

def T(i, areas, globs, dep=(), model="codex"): return Task(i, list(areas), list(globs), list(dep), model)
def codex_on(sup): sup.adapters["codex"].quota_remaining = 100

class Iso(unittest.TestCase):
    def setUp(self): self.d = tempfile.mkdtemp(); self.s = Supervisor(self.d, 3); codex_on(self.s)

    def test_no_shared_checkpoint_or_worktree(self):
        cps = {s.checkpoint for s in self.s.slots}; wts = {s.worktree for s in self.s.slots}
        self.assertEqual(len(cps), 3); self.assertEqual(len(wts), 3)
        for a in self.s.slots:
            for b in self.s.slots:
                if a is not b: self.assertFalse(a.worktree.startswith(b.root + "/" + b.name + "/"))

    def test_disjoint_parallel_overlap_serial(self):
        self.s.submit(T("a", ["web:games"], ["apps/web/src/games/*"]),
                      T("b", ["web:games:map"], ["apps/web/src/games/map/*"]),
                      T("c", ["api:profiles"], ["apps/api/src/profiles/*"]))
        self.s.schedule()
        claimed = {s.task.id for s in self.s.slots if s.task}
        self.assertEqual(claimed, {"a", "c"})

    def test_solo_area_runs_alone(self):
        self.s.submit(T("x", ["web:radar"], ["apps/web/radar/*"]), T("m", ["migrations"], ["db/*"]))
        self.s.schedule()
        self.assertEqual([s.task.id for s in self.s.slots if s.task], ["x"])

    def test_undeclared_locks_are_solo(self):
        self.s.submit(T("u", [], []), T("v", ["web:radar"], ["r/*"])); self.s.schedule()
        self.assertEqual(sum(1 for s in self.s.slots if s.task), 1)

    def test_no_overlapping_live_locks_invariant(self):
        import random; random.seed(1)
        areas = ["web:games", "web:games:map", "web:radar", "api:games", "api:profiles", "global"]
        for i in range(40):
            a = random.choice(areas); self.s.submit(T(f"t{i}", [a], [a.replace(":", "/") + "/*"]))
        for _ in range(30):
            self.s.schedule()
            live = [Task(**d) for d in self.s.locks.holders().values()]
            for i in range(len(live)):
                for j in range(i + 1, len(live)): self.assertFalse(conflicts(live[i], live[j]))
            busy = [s for s in self.s.slots if s.task]
            if busy:
                s = random.choice(busy); self.s.develop(s)
                while self.s.integrate_one(): pass

    def test_crash_releases_lock(self):
        self.s.submit(T("a", ["web:games"], ["g/*"]), T("b", ["web:games"], ["g/*"]))
        self.s.schedule(); s1 = next(s for s in self.s.slots if s.task)
        self.s.locks.crash(s1.name)  # holder died, lease file still on disk
        self.assertTrue(os.path.exists(os.path.join(self.d, "locks", s1.name + ".lease")))
        s1.task = None; s1.phase = "idle"
        self.s.schedule()
        self.assertIn("b", {s.task.id for s in self.s.slots if s.task})

    def test_single_integrator(self):
        m1 = IntegrationMutex(os.path.join(self.d, "i.lock")); m2 = IntegrationMutex(os.path.join(self.d, "i.lock"))
        self.assertTrue(m1.try_acquire("slot1")); self.assertFalse(m2.try_acquire("slot2"))
        m1.release(); self.assertTrue(m2.try_acquire("slot2"))

    def test_merge_serial_and_dependencies(self):
        self.s.submit(T("a", ["web:games"], ["g/*"]), T("c", ["api:x"], ["x/*"]),
                      T("b", ["web:radar"], ["r/*"], dep=["a"]))
        self.s.schedule()
        self.assertNotIn("b", {s.task.id for s in self.s.slots if s.task})
        for s in [s for s in self.s.slots if s.task]: self.s.develop(s)
        self.assertEqual(len(self.s.merge_queue), 2)
        self.s.integrate_one(); self.assertEqual(self.s.dev_head, 1)
        self.s.integrate_one(); self.assertEqual(self.s.dev_head, 2)
        self.s.schedule(); self.assertIn("b", {s.task.id for s in self.s.slots if s.task})

    def test_park_after_3_and_successor_blocks_dependents(self):
        self.s.adapters["codex"].run_fn = lambda r, t, w: "FAIL" if r == "qa" else "ok"
        self.s.submit(T("a", ["web:games"], ["g/*"]), T("b", ["web:radar"], ["r/*"], dep=["a"]))
        self.s.schedule(); s = next(x for x in self.s.slots if x.task)
        for _ in range(3): self.s.develop(s)
        self.assertIn("a", self.s.parked); self.assertEqual(self.s.locks.holders(), {})
        self.s.schedule(); self.assertFalse(any(x.task for x in self.s.slots))

    def test_checkpoint_per_slot_persisted(self):
        self.s.submit(T("a", ["web:games"], ["g/*"])); self.s.schedule()
        s = next(x for x in self.s.slots if x.task)
        self.assertEqual(json.load(open(s.checkpoint))["task"], "a")
        other = next(x for x in self.s.slots if not x.task)
        self.assertIsNone(json.load(open(other.checkpoint))["task"])

class Adapters(unittest.TestCase):
    def test_unknown_quota_blocks(self):
        a = default_adapters()["codex"]; self.assertFalse(a.enabled_for("author"))
    def test_cursor_agy_disabled(self):
        ad = default_adapters()
        self.assertFalse(ad["cursor"].enabled_for("author"))
        self.assertFalse(ad["agy"].enabled_for("qa"))
        self.assertRaises(AdapterDisabled, ad["agy"].run, "qa", None, "/tmp")
    def test_agy_task_not_scheduled(self):
        d = tempfile.mkdtemp(); s = Supervisor(d, 2); codex_on(s)
        s.submit(T("z", ["web:radar"], ["r/*"], model="agy")); s.schedule()
        self.assertFalse(any(x.task for x in s.slots))

if __name__ == "__main__": unittest.main()

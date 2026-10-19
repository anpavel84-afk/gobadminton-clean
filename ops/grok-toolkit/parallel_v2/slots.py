"""GoBadminton parallel_v2 prototype: slot supervisor, lock registry, PM scheduler,
model adapters, serialized merge queue. Offline only, no network, no secrets."""
from __future__ import annotations
import fcntl, fnmatch, json, os, time
from dataclasses import dataclass, field

SOLO_AREAS = {"global", "migrations", "packages/contracts", "workflows", "scripts/chatops"}
UNKNOWN = None  # quota unknown != 0: blocks scheduling, never treated as "free" or "empty"

# ---------- tasks & locks ----------
@dataclass
class Task:
    id: str
    areas: list[str]
    globs: list[str]
    depends_on: list[str] = field(default_factory=list)
    model: str = "codex"

def _area_conflict(a: str, b: str) -> bool:
    if "global" in (a, b): return True
    pa, pb = a.split(":"), b.split(":")
    n = min(len(pa), len(pb))
    return pa[:n] == pb[:n]

def _glob_overlap(g1: str, g2: str) -> bool:
    # conservative: overlap if either matches the other's literal prefix
    p1, p2 = g1.split("*")[0], g2.split("*")[0]
    return p1.startswith(p2) or p2.startswith(p1) or fnmatch.fnmatch(g1, g2) or fnmatch.fnmatch(g2, g1)

def conflicts(t1: Task, t2: Task) -> bool:
    if any(a in SOLO_AREAS for a in t1.areas + t2.areas): return True
    if not t1.areas or not t2.areas or not t1.globs or not t2.globs: return True  # undeclared = solo
    if any(_area_conflict(a, b) for a in t1.areas for b in t2.areas): return True
    return any(_glob_overlap(a, b) for a in t1.globs for b in t2.globs)

class LockRegistry:
    """Leases stored as files held by flock of the owning slot process.
    Crash-safe: a lease is live only while its holder fd is open (kernel releases on death)."""
    def __init__(self, root: str):
        self.root = root; os.makedirs(root, exist_ok=True)
        self._fds: dict[str, int] = {}
        self._mutex = os.path.join(root, ".registry.lock")

    def _live(self):
        out = {}
        for f in os.listdir(self.root):
            if not f.endswith(".lease"): continue
            p = os.path.join(self.root, f)
            try: fd = os.open(p, os.O_RDWR)
            except FileNotFoundError: continue
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                # nobody holds it -> stale lease from crashed slot; reclaim
                os.unlink(p); fcntl.flock(fd, fcntl.LOCK_UN)
            except BlockingIOError:
                with open(p) as fh: out[f[:-6]] = json.load(fh)
            finally: os.close(fd)
        return out

    def acquire(self, slot: str, task: Task) -> bool:
        with open(self._mutex, "a") as m:
            fcntl.flock(m, fcntl.LOCK_EX)
            live = self._live()
            for s, d in live.items():
                if s != slot and conflicts(task, Task(**d)): return False
            p = os.path.join(self.root, slot + ".lease")
            fd = os.open(p, os.O_RDWR | os.O_CREAT, 0o600)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            os.ftruncate(fd, 0); os.write(fd, json.dumps(task.__dict__).encode()); os.fsync(fd)
            self._fds[slot] = fd
            return True

    def release(self, slot: str):
        fd = self._fds.pop(slot, None)
        p = os.path.join(self.root, slot + ".lease")
        if fd is not None:
            try: os.unlink(p)
            except FileNotFoundError: pass
            os.close(fd)

    def crash(self, slot: str):  # test hook: simulate process death (fd closed, file left behind)
        fd = self._fds.pop(slot); os.close(fd)

    def holders(self): return self._live()

class IntegrationMutex:
    """Exactly one integrator (rebase->QA->CI->ff->deploy->accept). flock = crash-safe."""
    def __init__(self, path): self.path = path; self.fd = None; self.owner = None
    def try_acquire(self, owner) -> bool:
        fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: os.close(fd); return False
        self.fd, self.owner = fd, owner; return True
    def release(self):
        if self.fd is not None: os.close(self.fd); self.fd = self.owner = None

# ---------- model adapters ----------
class AdapterDisabled(Exception): pass

@dataclass
class ModelAdapter:
    name: str
    installed: bool = False
    in_catalog: bool = False
    authenticated: bool = False
    inference_proven: bool = False
    owner_approved: bool = False
    quota_remaining: float | None = UNKNOWN
    roles: tuple = ("author",)
    run_fn: object = None

    def enabled_for(self, role: str) -> bool:
        return (role in self.roles and self.installed and self.in_catalog and self.authenticated
                and self.inference_proven and self.owner_approved
                and self.quota_remaining is not UNKNOWN and self.quota_remaining > 0)

    def run(self, role, task, workdir):
        if not self.enabled_for(role): raise AdapterDisabled(f"{self.name}:{role}")
        self.quota_remaining -= 1
        return self.run_fn(role, task, workdir) if self.run_fn else "PASS"

def default_adapters():
    return {
        "codex": ModelAdapter("codex", True, True, True, True, True, UNKNOWN, ("author", "qa", "review")),
        "cursor": ModelAdapter("cursor", True, True, True, False, False, 0, ("author",)),      # out of tokens
        "agy": ModelAdapter("agy", True, True, True, False, False, UNKNOWN, ("review",)),     # #29: never QA
    }

# ---------- slots & scheduler ----------
@dataclass
class Slot:
    name: str
    root: str
    task: Task | None = None
    phase: str = "idle"
    attempts: int = 0
    @property
    def worktree(self): return os.path.join(self.root, self.name, "worktree")
    @property
    def state_dir(self): return os.path.join(self.root, self.name, "state")
    @property
    def checkpoint(self): return os.path.join(self.state_dir, "checkpoint.json")
    def save(self):
        os.makedirs(self.state_dir, exist_ok=True)
        tmp = self.checkpoint + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"slot": self.name, "task": self.task.id if self.task else None,
                       "phase": self.phase, "attempts": self.attempts}, f)
        os.replace(tmp, self.checkpoint)

class Supervisor:
    def __init__(self, root, n_slots=2, adapters=None, max_attempts=3, ci_parallel=2):
        self.root = root
        self.slots = [Slot(f"slot{i+1}", root) for i in range(n_slots)]
        for s in self.slots: os.makedirs(s.worktree, exist_ok=True); s.save()
        self.locks = LockRegistry(os.path.join(root, "locks"))
        self.integ = IntegrationMutex(os.path.join(root, "integration.lock"))
        self.adapters = adapters or default_adapters()
        self.max_attempts = max_attempts; self.ci_parallel = ci_parallel
        self.queue: list[Task] = []; self.done: set[str] = set(); self.parked: set[str] = set()
        self.merge_queue: list[Slot] = []; self.log: list[str] = []
        self.dev_head = 0

    def submit(self, *tasks): self.queue.extend(tasks)

    def ready(self, t): return all(d in self.done for d in t.depends_on) and not any(d in self.parked for d in t.depends_on)

    def schedule(self):
        for s in self.slots:
            if s.task: continue
            for t in list(self.queue):
                if not self.ready(t): continue
                ad = self.adapters.get(t.model)
                if not ad or not ad.enabled_for("author"): continue
                if not self.locks.acquire(s.name, t): continue
                self.queue.remove(t); s.task, s.phase, s.attempts = t, "developing", 0; s.save()
                self.log.append(f"{s.name} claim {t.id}"); break

    def develop(self, s: Slot):
        s.attempts += 1
        ad = self.adapters[s.task.model]
        ad.run("author", s.task, s.worktree)
        qa = self.adapters["codex"].run("qa", s.task, s.worktree)  # QA gate = codex only
        if qa == "PASS": s.phase = "merge_wait"; self.merge_queue.append(s)
        elif s.attempts >= self.max_attempts: self._park(s)
        else: s.phase = "developing"
        s.save()

    def integrate_one(self, ci_fn=lambda s: True, deploy_fn=lambda s: True):
        if not self.merge_queue: return None
        if not self.integ.try_acquire(self.merge_queue[0].name): return None
        s = self.merge_queue.pop(0)
        try:
            base = self.dev_head
            s.phase = "rebase_qa_ci"  # full QA + full CI on rebased SHA
            ok = self.adapters["codex"].run("qa", s.task, s.worktree) == "PASS" and ci_fn(s)
            if ok and self.dev_head == base and deploy_fn(s):
                self.dev_head += 1; self.done.add(s.task.id); self.log.append(f"{s.name} merged {s.task.id}")
                self._free(s)
            elif s.attempts >= self.max_attempts: self._park(s)
            else: s.phase = "developing"; s.save()
        finally: self.integ.release()
        return s

    def _park(self, s):
        self.parked.add(s.task.id); self.log.append(f"{s.name} park {s.task.id}"); self._free(s)

    def _free(self, s):
        self.locks.release(s.name); s.task, s.phase, s.attempts = None, "idle", 0; s.save()

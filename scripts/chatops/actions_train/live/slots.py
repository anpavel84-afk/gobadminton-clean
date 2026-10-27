#!/usr/bin/env python3
"""PARALLEL_SLOTS_V1: isolated executor slots, lock registry, PM scheduler, budgets, model adapters
and the single integration mutex (serialized merge queue). Fail-closed; no GitHub writes.

Two uses:
  * imported by autonomous_issues.py ONLY with ``--slot slotN``; the default slot never imports it;
  * the supervisor CLI: ``python3 slots.py supervise|status|plan|adapters|migrate``.
Nothing here is installed by this module; see docs/operations/chatops/AUTONOMY_SLOTS.md.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import stat
import sys
import tempfile
import time

SLOT_RE = re.compile(r'slot[1-8]')
STATE_ROOT = Path('/var/lib/gobadminton-autonomy')     # slots/<slot> (0700), outbox/<slot>, assign/, locks/
SLOT_ROOT = Path('/srv/gb-slots')                      # <slot>/{repo,worktrees,home}
CONFIG_ROOT = Path('/etc/gobadminton-slots')           # budgets.json, supervisor.json (root-owned)
RUNTIME_ROOT = Path('/opt/gb-slots/runtime')           # node + codex for non-legacy slot users
LEGACY_USER = 'agentagency-dev'
LEGACY_HOME = Path('/home/agentagency-dev')
LEGACY_STATE = LEGACY_HOME / '.gb-autonomy-state'
KEY_NAME = 'gobadminton-clean-chatops-ed25519'
SUPERVISOR_USER = 'gb-supervisor'
# slot1 keeps the existing executor account (its own SSH key and Codex login, nothing copied).
SLOT_USERS = {'slot1': LEGACY_USER}
SOLO_LOCKS = {'global', 'migrations', 'contracts', 'workflows', 'chatops'}
UNKNOWN = None          # quota unknown != 0: never "free", never "empty"; it blocks scheduling
ROLES = ('author', 'qa', 'review')
# Owner DIRECT 2026-10-27: new source authors are globally sequential even for disjoint
# paths. Immutable QA is read-only and must not be confused with a writer lease.
SOURCE_WRITER_PHASES = frozenset({'claimed', 'developing', 'candidate', 'pr_wait'})
SOURCE_WRITER_STAGES = frozenset({'claim', 'author', 'publish'})
# AGY executor home (UID978/GID968 sandbox). Logical Issue assignment is separate;
# cross-slot AGY checkpoint writes remain HOLD (see native_antigravity.qualification).
AGY_EXECUTOR_SLOT = 'slot2'
AGY_EXECUTOR_UID = 978
AGY_EXECUTOR_GID = 968
ASSIGN_SCHEMA = 'GB_SLOT_ASSIGN_V1'
STATUS_SCHEMA = 'GB_SLOT_STATUS_V1'
RETIRED = 'RETIRED_TO_SLOT.json'
MAX_FILE = 65536
CONTINUITY_SCHEMA = 'GB_SLOT_CONTINUITY_V1'
PENDING = CONFIG_ROOT / 'continuity.pending'
PENDING_SCHEMA = 'GB_CONTINUITY_PENDING_V1'


def deployment_pending(path):
    """Read only public installer metadata; even an absent marker needs trusted parents."""
    path = Path(path)
    require(path.is_absolute(), 'absolute deployment barrier required')
    for parent in reversed(path.parents):
        try:
            info = parent.lstat()
        except FileNotFoundError:
            return False
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                'untrusted deployment barrier directory')
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return False
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == 0
                and stat.S_IMODE(info.st_mode) == 0o644, 'untrusted deployment barrier')
        raw = os.read(fd, 4097)
    finally:
        os.close(fd)
    require(len(raw) <= 4096, 'deployment barrier too large')
    require(loads(raw) == {'schema': PENDING_SCHEMA}, 'invalid deployment barrier')
    return True


def wait_for_activation():
    # No state, lease, budget, API or model access before the installer durably commits.
    while deployment_pending(PENDING):
        time.sleep(0.25)


def continuity_policy(path):
    """Reviewed root policy only; absence disables continuity, malformed/untrusted files fail closed."""
    path = Path(path)
    require(path.is_absolute(), 'absolute continuity policy required')
    try:
        path.lstat()
    except FileNotFoundError:
        return None
    # An existing policy may only be reached through trusted real parents.
    for parent in reversed(path.parents):
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                'untrusted continuity directory')
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == 0
                and not info.st_mode & 0o022, 'untrusted continuity policy')
        raw = os.read(fd, 4097)
    finally:
        os.close(fd)
    require(len(raw) <= 4096, 'continuity policy too large')
    value = loads(raw)
    require(isinstance(value, dict) and set(value) == {
        'schema', 'enabled', 'max_attempts', 'max_integrations', 'read_backoff_seconds'}
        and value['schema'] == CONTINUITY_SCHEMA and type(value['enabled']) is bool,
        'invalid continuity policy')
    for key, low, high in (('max_attempts', 1, 3), ('max_integrations', 1, 3),
                           ('read_backoff_seconds', 120, 3600)):
        require(type(value[key]) is int and low <= value[key] <= high, 'invalid continuity bound')
    return (value | {'sha256': hashlib.sha256(raw).hexdigest()}) if value['enabled'] else None


class Hold(Exception):
    """Fail closed; the executor converts it into its own Hold."""


class AdapterDisabled(Hold):
    pass


def require(condition, reason):
    if not condition:
        raise Hold(reason)


def _unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON key')
        result[key] = value
    return result


def loads(raw):
    return json.loads(raw, object_pairs_hook=_unique)


def read_json(path, trusted_uids=None, limit=MAX_FILE):
    """No symlinks, regular file, bounded, optional owner allowlist, never group/world writable."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_mode & 0o022 == 0, f'untrusted file {Path(path).name}')
        if trusted_uids is not None:
            require(info.st_uid in trusted_uids, f'untrusted owner of {Path(path).name}')
        raw = os.read(fd, limit + 1)
    finally:
        os.close(fd)
    require(len(raw) <= limit, 'file too large')
    return loads(raw)


def atomic(path, value, mode=0o600):
    path = Path(path)
    data = json.dumps(value, ensure_ascii=False, sort_keys=True).encode()
    fd, tmp = tempfile.mkstemp(prefix='.slot-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def uid_of(user):
    try:
        return pwd.getpwnam(user).pw_uid
    except KeyError:
        return None


def slot_user(slot):
    require(SLOT_RE.fullmatch(slot or ''), 'invalid slot name')
    return SLOT_USERS.get(slot, f'gb-{slot}')


# ---------------------------------------------------------------- layout
class Layout:
    """Every per-slot path. Invariant: no path of slot A is inside a path of slot B."""

    def __init__(self, slot, state_root=STATE_ROOT, slot_root=SLOT_ROOT):
        require(isinstance(slot, str) and SLOT_RE.fullmatch(slot), 'invalid slot name')
        self.slot, self.state_root, self.slot_root = slot, Path(state_root), Path(slot_root)
        self.state_dir = self.state_root / 'slots' / slot
        self.outbox = self.state_root / 'outbox' / slot
        self.assignment = self.state_root / 'assign' / f'{slot}.json'
        self.locks = self.state_root / 'locks'
        self.integration = self.locks / 'integration.lock'
        self.registry = self.locks / 'registry.lock'
        self.api_clock = self.locks / 'api.clock'
        self.root = self.slot_root / slot
        self.repo = self.root / 'repo'
        self.worktrees = self.root / 'worktrees'
        self.home = self.root / 'home'

    def own(self):
        return [self.state_dir, self.outbox, self.root]

    def others(self):
        return [p for n in range(1, 9) if f'slot{n}' != self.slot
                for p in (self.state_root / 'slots' / f'slot{n}', self.slot_root / f'slot{n}')]


def readable_present(path):
    """Read-allowlist probe: an unstat-able path is absent (never granted, never a crash)."""
    try:
        return Path(path).exists()
    except OSError:
        return False


def deny_present(path):
    """Deny-list probe, fail-closed: a path we cannot stat (EACCES) may exist, so it stays denied."""
    try:
        return Path(path).exists()
    except OSError:
        return True


def disjoint(paths_a, paths_b):
    for a in paths_a:
        for b in paths_b:
            a, b = Path(a), Path(b)
            if a == b or a.is_relative_to(b) or b.is_relative_to(a):
                return False
    return True


# ---------------------------------------------------------------- locks
def task_record(issue, task, *, writer=True):
    locks = task.get('locks') or ['global']    # undeclared = solo
    return dict(issue=issue, locks=list(locks), allowed_paths=list(task['allowed_paths']),
                depends_on=list(task.get('depends_on', [])), writer=bool(writer))


def is_source_writer_phase(phase):
    return phase in SOURCE_WRITER_PHASES


def is_source_writer_stage(stage):
    return stage in SOURCE_WRITER_STAGES


def record_is_writer(record):
    """Legacy lease bytes without writer default to writer=True (fail closed)."""
    if not isinstance(record, dict):
        return True
    return record.get('writer', True) is not False


def lock_conflict(a, b):
    if a.split(':')[0] in SOLO_LOCKS or b.split(':')[0] in SOLO_LOCKS:
        return True
    pa, pb = a.split(':'), b.split(':')
    n = min(len(pa), len(pb))
    return pa[:n] == pb[:n]       # equal, parent/child


def path_overlap(p, q):
    def norm(x):
        return (x[:-2], True) if x.endswith('/**') else (x, False)
    (pp, pdir), (qq, qdir) = norm(p), norm(q)
    if pdir and (qq.startswith(pp) or (qdir and pp.startswith(qq))):
        return True
    if qdir and pp.startswith(qq):
        return True
    return pp == qq


def conflicts(r1, r2):
    """Conservative path/lock intersection. Also: two source writers always conflict.

    Owner DIRECT 2026-10-27 supersedes parallel disjoint authors. Immutable QA
    records set writer=False and still serialize only on real intersection.
    Historical UNKNOWN occupancy keeps using this predicate; never evade by
    renaming path/slot/op alone.
    """
    if r1['issue'] == r2['issue']:
        return True
    if record_is_writer(r1) and record_is_writer(r2):
        return True
    return (any(lock_conflict(a, b) for a in r1['locks'] for b in r2['locks'])
            or any(path_overlap(p, q) for p in r1['allowed_paths'] for q in r2['allowed_paths']))


def slot_maps_to_agy_executor(slot):
    """True when this logical slot's installed OS identity is the AGY executor sandbox.

    Today only slot2 maps to gb-slot2/UID978. Product routing may name any slot;
    live AGY invoke still requires that executor identity (see native_antigravity).
    """
    return slot == AGY_EXECUTOR_SLOT and slot_user(slot) == f'gb-{AGY_EXECUTOR_SLOT}'


def source_writer_occupied(statuses=None, journals=None):
    """Whether any slot currently holds a source-writer active/pending occupancy."""
    statuses = statuses or {}
    journals = journals or {}
    for slot, card in statuses.items():
        active = (card or {}).get('active')
        if active and is_source_writer_phase(active.get('phase')):
            return True
        pending = (card or {}).get('pending')
        if isinstance(pending, dict):
            binding = pending.get('binding') or {}
            if is_source_writer_stage(binding.get('stage')):
                return True
    for slot, journal in journals.items():
        pending = (journal or {}).get('pending')
        if not pending:
            continue
        op = (journal.get('operations') or {}).get(pending) or {}
        binding = op.get('binding') or {}
        if is_source_writer_stage(binding.get('stage')):
            return True
        # Active writer checkpoint without a stage binding still blocks new authors.
        # Do not treat QA/qualification UNKNOWN as a writer lease.
    return False


def historical_unknown_isolation_receipt(evidence):
    """Narrow #341 resource-disjoint isolation receipt evaluator (source-only).

    Owner DIRECT 2026-10-27: the guarded installer may accept a NEW exact
    resource-disjoint isolation receipt only when facts, stopped process identity
    and protected dependencies are verified. Absence of processes is not proof.
    No automatic clearing, safe_release override, grants reset or assume-safe.

    Current runtime uncertainty about historical Git/Python/shell/config helper
    effects means a broad disjoint claim cannot be safely minted here → HOLD.
    """
    evidence = evidence or {}
    require(isinstance(evidence, dict), 'isolation evidence must be an object')
    # Never invent provenance. Require explicit positive proofs; otherwise HOLD.
    required = ('stopped_process_identity', 'protected_dependencies',
                'resource_disjoint_proof', 'historical_effects_excluded')
    missing = [k for k in required if not evidence.get(k)]
    if missing:
        return dict(status='HOLD', schema='GB_UNKNOWN_ISOLATION_RECEIPT_V1',
                    reason='insufficient verified isolation facts', missing=missing,
                    safe_release=False, automatic_clear=False)
    if evidence.get('historical_effects_excluded') is not True:
        return dict(status='HOLD', schema='GB_UNKNOWN_ISOLATION_RECEIPT_V1',
                    reason='historical effects not proven absent; process absence is not proof',
                    safe_release=False, automatic_clear=False)
    if evidence.get('resource_disjoint_proof') is not True:
        return dict(status='HOLD', schema='GB_UNKNOWN_ISOLATION_RECEIPT_V1',
                    reason='resource-disjoint proof missing or unverified',
                    safe_release=False, automatic_clear=False)
    # Even with claimed proofs, this bounded source patch does not activate install.
    return dict(status='HOLD', schema='GB_UNKNOWN_ISOLATION_RECEIPT_V1',
                reason='verified receipt shape only; install activation out of this source patch',
                safe_release=False, automatic_clear=False)


class _Flock:
    def __init__(self, path, write=False):
        self.path, self.write, self.fd = Path(path), write, None

    def __enter__(self):
        flags = (os.O_RDWR | os.O_CREAT) if self.write else os.O_RDONLY
        self.fd = os.open(self.path, flags | os.O_NOFOLLOW, 0o660)
        if self.write and os.fstat(self.fd).st_uid == os.getuid():
            os.fchmod(self.fd, 0o660)                  # shared lock file: umask 0077 must not hide it
        fcntl.flock(self.fd, fcntl.LOCK_EX)
        return self.fd

    def __exit__(self, *exc):
        os.close(self.fd)
        self.fd = None


class LockRegistry:
    """Leases ``<slot>.lease`` in one sticky directory. A lease is LIVE only while its slot process
    holds an exclusive flock on it (the kernel drops it when the process dies). Stale leases are
    ignored, never deleted by another slot (sticky dir: only the owner may unlink)."""

    def __init__(self, directory, registry_lock):
        self.directory, self.registry_lock = Path(directory), Path(registry_lock)
        self.fd, self.slot, self.record = None, None, None

    def _live(self):
        out = {}
        for entry in sorted(os.listdir(self.directory)):
            name = entry[:-6] if entry.endswith('.lease') else None
            if not name or not SLOT_RE.fullmatch(name):
                continue
            try:
                fd = os.open(self.directory / entry, os.O_RDONLY | os.O_NOFOLLOW)
            except FileNotFoundError:
                continue
            except PermissionError:                    # unreadable lease: fail closed, treat as global writer
                out[name] = dict(issue=0, locks=['global'], allowed_paths=[], writer=True)
                continue
            try:
                try:
                    fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
                except BlockingIOError:
                    raw = os.read(fd, MAX_FILE + 1)
                    require(len(raw) <= MAX_FILE, 'lease too large')
                    out[name] = loads(raw) if raw else dict(issue=0, locks=['global'], allowed_paths=[], writer=True)
                else:
                    fcntl.flock(fd, fcntl.LOCK_UN)     # nobody holds it: stale, not live
            finally:
                os.close(fd)
        return out

    def holders(self):
        with _Flock(self.registry_lock):
            return self._live()

    def acquire(self, slot, record):
        """Atomic check-and-take under the registry mutex. Returns False on conflict.

        Two writer leases always conflict (Owner one-writer). QA leases (writer=False)
        still conflict on path/lock intersection and never clear UNKNOWN occupancy.
        """
        require(SLOT_RE.fullmatch(slot), 'invalid slot name')
        if self.fd is not None:
            require(self.slot == slot and self.record == record, 'slot already holds a different lease')
            return True
        with _Flock(self.registry_lock):
            for other, held in self._live().items():
                if other != slot and conflicts(record, held):
                    return False
            fd = os.open(self.directory / f'{slot}.lease', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o644)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                os.close(fd)
                raise Hold('another process holds this slot lease') from None
            os.fchmod(fd, 0o644)                       # readable by other slots despite umask 0077
            os.ftruncate(fd, 0)
            os.write(fd, json.dumps(record, sort_keys=True).encode())
            os.fsync(fd)
            self.fd, self.slot, self.record = fd, slot, record
            return True

    def release(self):
        if self.fd is None:
            return
        try:
            os.ftruncate(self.fd, 0)
            os.unlink(self.directory / f'{self.slot}.lease')
        except FileNotFoundError:
            pass
        os.close(self.fd)
        self.fd, self.slot, self.record = None, None, None


class IntegrationMutex:
    """Exactly one integrator for dev: merge-onto-dev -> full QA -> full CI -> ff -> deploy -> accept.
    flock = crash-safe (released when the holder dies). Re-entrant within one process."""

    def __init__(self, path):
        self.path, self.fd = Path(path), None

    @property
    def held(self):
        return self.fd is not None

    def try_acquire(self):
        if self.fd is not None:
            return True
        fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            return False
        self.fd = fd
        return True

    def release(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


class ApiClock:
    """One unauthenticated GitHub quota (60/h) is shared by every process on the host. All slots and
    the supervisor space their reads through this file so the HOST stays below it, not each process."""

    def __init__(self, path, spacing=65):
        self.path, self.spacing = Path(path), spacing

    def wait(self, sleep=time.sleep, now=time.time):
        with _Flock(self.path, write=True) as fd:
            raw = os.pread(fd, 64, 0)
            last = float(raw) if raw.strip() else 0.0
            delay = last + self.spacing - now()
            if delay > 0:
                sleep(min(delay, 4 * 3600))
            stamp = repr(now()).encode()
            os.ftruncate(fd, 0)
            os.pwrite(fd, stamp, 0)

    def backoff(self, seconds, now=time.time):
        with _Flock(self.path, write=True) as fd:
            os.ftruncate(fd, 0)
            os.pwrite(fd, repr(now() + seconds - self.spacing).encode(), 0)


# ---------------------------------------------------------------- adapters
class Adapter:
    def __init__(self, name, provider, roles, installed, in_catalog, authenticated, inference_proven,
                 owner_approved, executable, reason=''):
        self.name, self.provider, self.roles = name, provider, tuple(roles)
        self.installed, self.in_catalog, self.authenticated = installed, in_catalog, authenticated
        self.inference_proven, self.owner_approved, self.executable = inference_proven, owner_approved, executable
        self.reason = reason


# Closed registry. Flipping a flag is a reviewed code change, never runtime input.
ADAPTERS = {
    'codex': Adapter('codex', 'codex', ('author', 'qa', 'review'), True, True, True, True, True, True),
    'cursor': Adapter('cursor', 'cursor', ('author',), True, True, True, True, True, True,
                      '#211 exact native adapter; root qualification marker still required'),
    'agy': Adapter('agy', 'agy', ('review',), True, True, True, False, False, False,
                   '#29: 7 known defects open; never a QA gate'),
}
FORBIDDEN = {'agy': {'qa', 'author'}}    # hard rule, independent of flags
MODEL_ADAPTER = {'gpt-6.1-sol': 'codex', 'gpt-6-astra': 'codex', 'gpt-6-luna': 'codex'}  # exact proven secure CLI provider
QA_ADAPTER = 'codex'


def adapter_for(task):
    model = task.get('model')
    if model is None:
        return 'codex'
    require(model in MODEL_ADAPTER, 'model not in registry')
    return MODEL_ADAPTER[model]


def adapter_status(name, role, budget=None, slot=None, adapters=None):
    """(enabled, reason). Every state must be true AND the quota known and > 0."""
    ad = (adapters or ADAPTERS).get(name)
    if ad is None:
        return False, 'unknown adapter'
    if role in FORBIDDEN.get(name, ()):
        return False, f'{name} may never act as {role}'
    if role not in ad.roles:
        return False, f'role {role} not supported'
    for flag in ('installed', 'in_catalog', 'authenticated', 'inference_proven', 'owner_approved', 'executable'):
        if not getattr(ad, flag):
            return False, f'{flag}=false' + (f' ({ad.reason})' if ad.reason else '')
    if name == 'cursor' and adapters is None:
        from native_cursor import available
        ok, reason = available(slot, None)
        if not ok:return False, reason
    if budget is not None:
        left = budget.remaining(ad.provider, role, slot)
        if left is UNKNOWN:
            return False, 'quota UNKNOWN (not 0, not free): set a limit or measure first'
        if left <= 0:
            return False, 'daily budget exhausted'
    return True, 'enabled'


# ---------------------------------------------------------------- budgets
class Budget:
    """Daily call budgets per provider/role (host total) AND per slot. Missing limit = UNKNOWN.
    Each slot writes only its own ledger (outbox/<slot>/ledger.json); totals sum every ledger.

    Optional AGY policy: providers.agy.per_issue_daily (positive int) caps the sum of all AGY
    role charges for one GitHub Issue across slots in the UTC day. Requires a trusted positive
    issue binding before remaining/charge can authorize an AGY call. Issue counters live under
    ledger[day][agy]['issues'] and are updated atomically with the role aggregate.
    """

    _ISSUE_META = 'issues'
    _PER_ISSUE = 'per_issue_daily'

    def __init__(self, limits_path, outbox_root, registry_lock, today=None, issue=None):
        self.limits_path, self.outbox_root = Path(limits_path), Path(outbox_root)
        self.registry_lock = Path(registry_lock)
        self.today = today or (lambda: dt.datetime.now(dt.timezone.utc).date().isoformat())
        self.issue = None
        if issue is not None:
            self.bind_issue(issue)

    @staticmethod
    def _require_issue(issue):
        # bool is a subclass of int; reject it explicitly.
        require(type(issue) is int and issue > 0, 'invalid issue id')
        return issue

    def bind_issue(self, issue):
        self.issue = self._require_issue(issue)
        return self

    def limits(self):
        try:
            value = read_json(self.limits_path, trusted_uids=None)
        except FileNotFoundError:
            return {}
        require(isinstance(value, dict) and set(value) <= {'schema', 'providers', 'slots'}, 'invalid budgets')
        for section in ('providers', 'slots'):
            require(isinstance(value.get(section, {}), dict), 'invalid budgets')
        return value

    def per_issue_daily(self, provider):
        """Return AGY per-issue UTC daily cap when configured; None keeps legacy provider behavior."""
        if provider != 'agy':
            return None
        cell = self.limits().get('providers', {}).get('agy')
        if not isinstance(cell, dict) or self._PER_ISSUE not in cell:
            return None
        value = cell[self._PER_ISSUE]
        require(type(value) is int and value > 0 and value <= 10000, 'invalid per_issue_daily')
        return value

    @staticmethod
    def _limit(table, provider, role):
        cell = (table or {}).get(provider, {}) or {}
        if role in (Budget._PER_ISSUE, Budget._ISSUE_META):
            return UNKNOWN
        value = cell.get(role, UNKNOWN)
        if value is UNKNOWN:
            return UNKNOWN
        if value == 'unlimited': return float('inf')
        require(type(value) is int and 0 <= value <= 10000, 'invalid budget value')
        return value

    def _slot_names(self, slot=None):
        if not self.outbox_root.exists():
            return []
        return [name for name in sorted(os.listdir(self.outbox_root))
                if SLOT_RE.fullmatch(name) and (not slot or name == slot)]

    def used(self, provider, role, slot=None):
        total, day = 0, self.today()
        for name in self._slot_names(slot):
            path = self.outbox_root / name / 'ledger.json'
            if not path.exists():
                continue
            ledger = read_json(path)
            count = ledger.get(day, {}).get(provider, {}).get(role, 0)
            require(type(count) is int and count >= 0, 'invalid ledger')
            total += count
        return total

    def issue_used(self, provider, issue, slot=None):
        issue = self._require_issue(issue)
        total, day, key = 0, self.today(), str(issue)
        for name in self._slot_names(slot):
            path = self.outbox_root / name / 'ledger.json'
            if not path.exists():
                continue
            ledger = read_json(path)
            issues = ledger.get(day, {}).get(provider, {}).get(self._ISSUE_META, {})
            require(isinstance(issues, dict), 'invalid issue ledger')
            count = issues.get(key, 0)
            require(type(count) is int and count >= 0, 'invalid issue ledger')
            total += count
        return total

    def _provider_role_total(self, provider, slot=None):
        return sum(self.used(provider, role, slot) for role in ROLES)

    def _provider_issue_total(self, provider, slot=None):
        total, day = 0, self.today()
        for name in self._slot_names(slot):
            path = self.outbox_root / name / 'ledger.json'
            if not path.exists():
                continue
            ledger = read_json(path)
            issues = ledger.get(day, {}).get(provider, {}).get(self._ISSUE_META, {})
            require(isinstance(issues, dict), 'invalid issue ledger')
            for key, count in issues.items():
                require(type(key) is str and key.isdigit() and int(key) > 0, 'invalid issue ledger key')
                require(type(count) is int and count >= 0, 'invalid issue ledger')
                total += count
        return total

    def unattributed(self, provider, slot=None):
        """Same-day role aggregate minus attributed issue counters (host-wide unless slot set)."""
        roles = self._provider_role_total(provider, slot)
        attributed = self._provider_issue_total(provider, slot)
        require(attributed <= roles, 'issue attribution exceeds role aggregate')
        return roles - attributed

    def remaining(self, provider, role, slot=None):
        limits = self.limits()
        host = self._limit(limits.get('providers'), provider, role)
        if host is UNKNOWN:
            return UNKNOWN
        left = host - self.used(provider, role)
        if slot is not None:
            own = self._limit(limits.get('slots', {}).get(slot), provider, role)
            if own is UNKNOWN:
                return UNKNOWN
            left = min(left, own - self.used(provider, role, slot))
        cap = self.per_issue_daily(provider)
        if cap is not None:
            # Policy active: never authorize AGY without a trusted issue binding.
            if self.issue is None:
                return UNKNOWN
            if self.unattributed(provider) != 0:
                return UNKNOWN
            left = min(left, cap - self.issue_used(provider, self.issue))
        return left

    def charge(self, slot, provider, role, issue=None):
        with _Flock(self.registry_lock):
            cap = self.per_issue_daily(provider)
            bound = self.issue if issue is None else self._require_issue(issue)
            if cap is not None:
                require(bound is not None, f'{provider} {role} charge requires trusted issue')
                require(self.unattributed(provider) == 0,
                        f'{provider} unattributed same-day usage; seed issue attribution under registry lock')
            left = self.remaining(provider, role, slot) if issue is None else self._remaining_with_issue(
                provider, role, slot, bound)
            require(left is not UNKNOWN, f'{provider} {role} quota UNKNOWN; refusing model call')
            require(left > 0, f'{provider} {role} daily budget exhausted')
            path = self.outbox_root / slot / 'ledger.json'
            existed = path.exists()
            ledger = read_json(path) if existed else {}
            day = self.today()
            # Keep every day. used() selects today's window without pruning history.
            # Pin the exact previous inode before replacement, under the same lock.
            backup = path.with_name('ledger.json.bak')
            if existed:
                fd, tmp = tempfile.mkstemp(prefix='.ledger-', dir=path.parent)
                os.close(fd)
                try:
                    os.unlink(tmp)
                    os.link(path, tmp, follow_symlinks=False)
                    os.replace(tmp, backup)
                    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
                    try:
                        os.fsync(directory)
                    finally:
                        os.close(directory)
                finally:
                    Path(tmp).unlink(missing_ok=True)
            cell = ledger.setdefault(day, {}).setdefault(provider, {})
            cell[role] = cell.get(role, 0) + 1
            if cap is not None:
                issues = cell.setdefault(self._ISSUE_META, {})
                key = str(bound)
                issues[key] = issues.get(key, 0) + 1
            try:
                atomic(path, ledger, 0o644)
            except Exception:
                if existed:
                    os.replace(backup, path)
                else:
                    path.unlink(missing_ok=True)
                raise
            return left - 1

    def _remaining_with_issue(self, provider, role, slot, issue):
        """remaining() using an explicit issue without mutating self.issue (charge kwarg path)."""
        previous, self.issue = self.issue, issue
        try:
            return self.remaining(provider, role, slot)
        finally:
            self.issue = previous

    def seed_issue_attribution(self, slot, provider, issue, count):
        """OPS additive seed under registry lock: set issue counter without changing role aggregates.

        Fails closed unless count equals current unattributed host-wide total for provider today
        (or is a no-op equal to the existing counter). Does not refund or rewrite role history.
        """
        issue = self._require_issue(issue)
        require(type(count) is int and count >= 0, 'invalid seed count')
        require(SLOT_RE.fullmatch(slot or ''), 'invalid slot name')
        require(provider == 'agy', 'issue attribution seed is AGY-only')
        with _Flock(self.registry_lock):
            current = self.issue_used(provider, issue)
            if current == count:
                return count
            gap = self.unattributed(provider)
            require(current == 0 and count == gap and gap > 0,
                    'seed must attribute exact unattributed same-day total once')
            path = self.outbox_root / slot / 'ledger.json'
            existed = path.exists()
            ledger = read_json(path) if existed else {}
            day = self.today()
            backup = path.with_name('ledger.json.bak')
            if existed:
                fd, tmp = tempfile.mkstemp(prefix='.ledger-', dir=path.parent)
                os.close(fd)
                try:
                    os.unlink(tmp)
                    os.link(path, tmp, follow_symlinks=False)
                    os.replace(tmp, backup)
                    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
                    try:
                        os.fsync(directory)
                    finally:
                        os.close(directory)
                finally:
                    Path(tmp).unlink(missing_ok=True)
            cell = ledger.setdefault(day, {}).setdefault(provider, {})
            issues = cell.setdefault(self._ISSUE_META, {})
            issues[str(issue)] = count
            try:
                atomic(path, ledger, 0o644)
            except Exception:
                if existed:
                    os.replace(backup, path)
                else:
                    path.unlink(missing_ok=True)
                raise
            require(self.unattributed(provider) == 0, 'seed left unattributed usage')
            return count


# ---------------------------------------------------------------- runtime (executor side)
class Runtime:
    """Everything a slot executor needs; built only for --slot slotN."""

    def __init__(self, slot, state_root=STATE_ROOT, slot_root=SLOT_ROOT, config_root=CONFIG_ROOT,
                 runtime_root=RUNTIME_ROOT, trusted_assigners=None, legacy_reads=()):
        wait_for_activation()
        self.slot = slot
        self.layout = Layout(slot, state_root, slot_root)
        self.user = slot_user(slot)
        self.unit = f'gobadminton-slot@{slot}.service'
        self.legacy = self.user == LEGACY_USER
        self.home = LEGACY_HOME if self.legacy else self.layout.home
        self.key = self.home / '.ssh' / KEY_NAME
        self.codex_home = self.home / '.codex'
        if self.legacy:
            self.path = '/home/agentagency-dev/.local/node-v24.21.0/bin:/usr/bin:/bin'
            self.runtime_reads = list(legacy_reads)
        else:
            self.path = f'{runtime_root}/node/bin:/usr/bin:/bin'
            self.runtime_reads = [Path(runtime_root)] if readable_present(runtime_root) else []
        self.registry = LockRegistry(self.layout.locks, self.layout.registry)
        self.mutex = IntegrationMutex(self.layout.integration)
        self.budget = Budget(Path(config_root) / 'budgets.json', self.layout.state_root / 'outbox',
                             self.layout.registry)
        self.clock = ApiClock(self.layout.api_clock)
        self.continuity_path = Path(config_root) / 'continuity.json'
        if trusted_assigners is None:
            trusted_assigners = {0} | ({uid_of(SUPERVISOR_USER)} - {None})
        self.trusted_assigners = set(trusted_assigners)

    def env(self):
        return {'PATH': self.path, 'HOME': str(self.home), 'USER': self.user, 'LANG': 'C.UTF-8',
                'CODEX_HOME': str(self.codex_home), 'GIT_CONFIG_NOSYSTEM': '1',
                'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0'}

    def continuity(self):
        return continuity_policy(self.continuity_path)

    def denied(self):
        """Model sandbox deny-list: every other slot, the legacy state, other homes."""
        out = [p for p in self.layout.others() if deny_present(p)]
        if not self.legacy:
            out += [p for p in (LEGACY_HOME,) if deny_present(p)]
        if deny_present(LEGACY_STATE) and LEGACY_STATE != self.layout.state_dir:
            out.append(LEGACY_STATE)
        return out

    def check_paths(self, repo, state_dir, worktrees_root):
        require(Path(repo) == self.layout.repo and Path(state_dir) == self.layout.state_dir
                and Path(worktrees_root) == self.layout.worktrees, 'slot paths must be the fixed slot layout')
        require(disjoint(self.layout.own(), self.layout.others()), 'slot paths overlap another slot')
        require(disjoint([self.layout.state_dir], [LEGACY_STATE]), 'slot state overlaps legacy state')

    def assignment(self):
        """The issue the supervisor assigned to this slot, or None. Untrusted owner -> Hold."""
        try:
            value = read_json(self.layout.assignment, self.trusted_assigners, 4096)
        except FileNotFoundError:
            return None
        require(isinstance(value, dict)
                and set(value) == {'schema', 'slot', 'issue', 'assigned_at', 'locks', 'allowed_paths'}
                and value['schema'] == ASSIGN_SCHEMA and value['slot'] == self.slot
                and type(value['issue']) is int and value['issue'] > 0, 'invalid assignment')
        return value['issue']

    def lease(self, active, *, writer=True):
        record = task_record(active['issue'], active['task'], writer=writer)
        require(self.registry.acquire(self.slot, record), 'lock conflict with another live slot')

    def release_lease(self):
        self.registry.release()

    def charge(self, task, role):
        adapter = QA_ADAPTER if role == 'qa' else adapter_for(task)
        ok, reason = adapter_status(adapter, role)
        if not ok:
            raise AdapterDisabled(f'{adapter}:{role}: {reason}')
        return self.budget.charge(self.slot, ADAPTERS[adapter].provider, role)

    def publish(self, data, parked):
        active = data.get('active')
        summary = None
        if active:
            summary = dict(issue=active['issue'], phase=active['phase'], attempt=active.get('attempt'),
                           head=active.get('head'), base=active.get('base'),
                           integration=active.get('integration', 0),
                           **{k: v for k, v in task_record(active['issue'], active['task']).items() if k != 'issue'})
        atomic(self.layout.outbox / 'status.json',
               dict(schema=STATUS_SCHEMA, slot=self.slot, active=summary, done=list(data.get('done', [])),
                    parked=[e['issue'] for e in parked], at=int(time.time()),
                    integrating=self.mutex.held), 0o644)


# ---------------------------------------------------------------- scheduler (supervisor side)
def read_statuses(state_root, slots, owners=None):
    out = {}
    for slot in slots:
        path = Path(state_root) / 'outbox' / slot / 'status.json'
        try:
            value = read_json(path, None if owners is None else {owners[slot]})
        except FileNotFoundError:
            continue
        require(value.get('schema') == STATUS_SCHEMA and value.get('slot') == slot, 'invalid slot status')
        out[slot] = value
    return out


def plan(candidates, statuses, assignments, slots, max_parallel, budget=None, adapters=None):
    """Pure PM step. candidates: [(issue, task)] in claim order. Returns ({slot: issue}, reasons).

    * ready  = every depends_on is done; an unresolved parked dependency stays unsatisfied;
    * serial = locks/paths conflict with any busy or newly planned task (conservative);
    * Owner DIRECT 2026-10-27: new source authors are globally sequential (even disjoint);
      immutable QA occupancy (non-writer phase) does not alone consume author capacity;
    * at most max_parallel slots busy; author adapter and codex QA must be enabled with known quota."""
    done = set().union(*[set(s.get('done', [])) for s in statuses.values()]) if statuses else set()
    parked = set().union(*[set(s.get('parked', [])) for s in statuses.values()]) if statuses else set()
    busy = {}
    writer_busy = False
    for slot in slots:
        active = (statuses.get(slot) or {}).get('active')
        if active and active['phase'] != 'done':
            rec = dict(issue=active['issue'], locks=active['locks'], allowed_paths=active['allowed_paths'],
                       writer=is_source_writer_phase(active.get('phase')))
            busy[slot] = rec
            writer_busy = writer_busy or rec['writer']
        elif slot in assignments and assignments[slot]['issue'] not in done | parked:
            busy[slot] = dict(assignments[slot]['record'])
            busy[slot].setdefault('writer', True)
            writer_busy = writer_busy or record_is_writer(busy[slot])
    taken = {r['issue'] for r in busy.values()}
    free = [s for s in slots if s not in busy and s in statuses]
    # New author claims always need a free slot; global writer occupancy refuses another author
    # even when max_parallel would have allowed a disjoint second writer.
    capacity = 0 if writer_busy else max(0, max_parallel - len(busy))
    result, reasons = {}, {}
    for issue, task in candidates:
        if issue in done or issue in parked or issue in taken:
            reasons[issue] = 'done' if issue in done else ('unresolved parked task' if issue in parked else 'busy')
            continue
        deps = task.get('depends_on', [])
        if any(d in parked for d in deps):
            reasons[issue] = 'dependency parked: unresolved (successor does not satisfy depends_on)'
            continue
        if not all(d in done for d in deps):
            reasons[issue] = 'waiting for dependencies'
            continue
        try:
            author = adapter_for(task)
        except Hold as error:
            reasons[issue] = str(error)
            continue
        record = task_record(issue, task, writer=True)
        if writer_busy or any(record_is_writer(r) for r in busy.values()):
            reasons[issue] = 'global source writer sequential'
            continue
        if any(conflicts(record, r) for r in busy.values()):
            reasons[issue] = 'lock/path conflict: serialized'
            continue
        if capacity <= 0 or not free:
            reasons[issue] = 'busy: no free slot/capacity'
            continue
        slot = None
        for candidate in free:
            ok_a, why_a = adapter_status(author, 'author', budget, candidate, adapters)
            ok_q, why_q = adapter_status(QA_ADAPTER, 'qa', budget, candidate, adapters)
            if ok_a and ok_q:
                slot = candidate
                break
            reasons[issue] = f'author {author}: {why_a}; qa: {why_q}'
        if slot is None:
            continue
        reasons.pop(issue, None)
        result[slot] = issue
        busy[slot] = record
        writer_busy = True
        taken.add(issue)
        free.remove(slot)
        capacity -= 1
    return result, reasons


def admitted(a, issues, comments, since):
    """Same admission contract as Store.claim (body XOR exactly one Owner comment), claim order."""
    by_parent = {}
    for comment in comments:
        by_parent.setdefault(comment.get('issue_url'), []).append(comment)
    out = []
    for issue in issues:
        try:
            try:
                body = a.validate_issue(issue, since)
            except (a.Hold, ValueError, KeyError, TypeError):
                body = None
            auth = []
            for comment in by_parent.get(f'https://api.github.com/repos/{a.REPO}/issues/{issue["number"]}', []):
                try:
                    auth.append((comment, a.validate_comment(issue, comment, since)))
                except (a.Hold, ValueError, KeyError, TypeError):
                    continue
            if len(auth) + (body is not None) != 1:
                continue
            stamp, task = (auth[0][0]['created_at'], auth[0][1]) if auth else (issue['created_at'], body)
            created = dt.datetime.fromisoformat(stamp.replace('Z', '+00:00'))
            out.append((created, issue['number'], task))
        except (a.Hold, Hold, ValueError, KeyError, TypeError):
            continue
    return [(n, t) for _, n, t in sorted(out, key=lambda x: x[:2])]


# ---------------------------------------------------------------- state migration (code only)
STATE_FILES = re.compile(r'(state|parked)\.json|(qa|before-resume|before-park)-[0-9]+-a[0-9]+(-i[0-9]+)?\.json')


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def migrate_state(src, dst, slot='slot1', dry_run=True):
    """Copy the legacy executor state into a slot, byte-identical (no counter/history reset).

    Refuses unless: the legacy worker lock is free (no executor running), the state is idle
    (active is None or done), dst is absent/empty. Every copied file is sha256-verified; a manifest
    is written into dst and a tombstone into src so the legacy executor can never run on it again."""
    src, dst = Path(src), Path(dst)
    require(src.is_dir() and not src.is_symlink(), 'legacy state dir missing')
    require(not (src / RETIRED).exists(), 'legacy state already retired')
    require(not dst.is_symlink() and (not dst.exists() or not any(dst.iterdir())), 'slot state not empty')
    lock = os.open(src / 'worker.lock', os.O_RDWR | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Hold('legacy executor is running (worker.lock held)') from None
        state = loads((src / 'state.json').read_bytes())
        require(set(state) == {'active', 'done'} and isinstance(state['done'], list), 'invalid legacy state')
        require(state['active'] is None or state['active'].get('phase') == 'done', 'legacy executor not idle')
        names = sorted(n for n in os.listdir(src) if STATE_FILES.fullmatch(n))
        require('state.json' in names, 'state.json missing')
        files = {}
        for name in names:
            info = os.lstat(src / name)
            require(stat.S_ISREG(info.st_mode), f'non-regular state file {name}')
            files[name] = _sha(src / name)
        manifest = dict(schema='GB_SLOT_MIGRATION_V1', slot=slot, src=str(src), dst=str(dst), files=files,
                        done=len(state['done']), at=dt.datetime.now(dt.timezone.utc).isoformat())
        if dry_run:
            return manifest
        dst.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(dst, 0o700)
        for name, digest in files.items():
            data = (src / name).read_bytes()
            fd = os.open(dst / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'wb') as out:
                out.write(data)
                out.flush()
                os.fsync(out.fileno())
            require(_sha(dst / name) == digest == _sha(src / name), f'sha256 mismatch for {name}')
        require(loads((dst / 'state.json').read_bytes()) == state, 'state differs after copy')
        atomic(dst / 'MIGRATION.json', manifest)
        atomic(src / RETIRED, dict(slot=slot, dst=str(dst), manifest_sha=_sha(dst / 'MIGRATION.json')))
        return manifest
    finally:
        os.close(lock)


# ---------------------------------------------------------------- slot2 activation evidence (no secret-file reads)
def root_document(path):
    path = Path(path)
    require(path.is_absolute() and path == path.resolve(), 'unsafe evidence path')
    for parent in path.parents:
        info = parent.stat()
        require(info.st_uid == 0 and not info.st_mode & 0o022, 'untrusted evidence directory')
    return read_json(path, {0})


def slot2_preflight(rt, codex, model, effort, known_hosts, proof=None, *, activation=True):
    """Read-only capability checks as slot2. Login/SSH are external, root-owned evidence,
    never inferred from account existence or by opening auth.json/private keys here."""
    failures = []
    def check(name, call):
        try:
            require(call(), name)
        except (OSError, ValueError, KeyError, TypeError, Hold):
            failures.append(name)
    uid = uid_of(rt.user)
    check('runtime user must be gb-slot2', lambda: rt.slot == 'slot2' and os.getuid() == uid and uid != 0)
    try:
        account = pwd.getpwnam(rt.user)
    except KeyError:
        return dict(slot=rt.slot, ready=False, failures=failures + ['gb-slot2 account absent'])
    check('slot2 account uid/gid/home/shell/scope', lambda:
          (account.pw_uid, account.pw_gid, account.pw_dir, account.pw_shell) ==
          (978, 968, str(rt.layout.home), '/usr/sbin/nologin') and set(os.getgroups()) <= {968, rt.layout.registry.stat().st_gid})
    for path in (rt.layout.root, rt.layout.repo, rt.layout.worktrees, rt.layout.state_dir,
                 rt.layout.home, rt.codex_home, rt.key.parent):
        check('own private directory: ' + str(path), lambda path=path:
              path.is_dir() and path == path.resolve() and path.stat().st_uid == uid
              and path.stat().st_mode & 0o077 == 0)
    check('own SSH identity metadata (contents never opened)', lambda:
          stat.S_ISREG(rt.key.lstat().st_mode) and rt.key.lstat().st_uid == uid
          and rt.key.lstat().st_mode & 0o077 == 0 and rt.key.lstat().st_size > 0)
    codex = Path(codex)
    def executable():
        require(codex.is_absolute() and codex == codex.resolve() and codex.is_relative_to(RUNTIME_ROOT),
                'slot2 executable must be in reviewed runtime')
        for path in (codex, *codex.parents):
            info = path.stat()
            require(info.st_uid == 0 and not info.st_mode & 0o022, 'untrusted runtime')
        return codex.is_file() and os.access(codex, os.X_OK)
    check('reviewed root-owned Codex executable/runtime', executable)
    check('explicit model/effort', lambda: model == 'gpt-6.1-sol' and effort in {'high', 'medium'})
    def git_ready():
        import subprocess
        def git(*args):
            result = subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
                                     '-C', str(rt.layout.repo), *args], env=rt.env() | {
                                         'GIT_OPTIONAL_LOCKS': '0', 'GIT_NO_LAZY_FETCH': '1',
                                         'GIT_NO_REPLACE_OBJECTS': '1'},
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=15)
            require(result.returncode == 0, 'git readiness')
            return result.stdout.strip()
        require(git('rev-parse', '--path-format=absolute', '--git-common-dir') ==
                str(rt.layout.repo / '.git'), 'own Git common dir')
        common = rt.layout.repo / '.git'
        objects = common / 'objects'
        require(common == common.resolve() and objects == objects.resolve()
                and all(p.is_dir() and p.stat().st_uid == uid and not p.stat().st_mode & 0o022
                        for p in (common, objects)), 'own Git objects')
        alternates = objects / 'info/alternates'
        if os.path.lexists(alternates):
            require(stat.S_ISREG(alternates.lstat().st_mode) and
                    alternates.read_text().strip() == str(rt.layout.root.parent / 'base.git/objects'),
                    'read-only base alternates')
        else:
            # A repacked clone may intentionally have no alternates. Prove its local
            # object closure without lazy fetch, shallow history, grafts or promisor data.
            for path in objects.rglob('*'):
                info = path.lstat()
                require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode),
                        'external or special Git object dependency')
            require(not any(os.path.lexists(p) for p in
                            (objects / 'info/http-alternates', common / 'shallow', common / 'info/grafts'))
                    and not list((objects / 'pack').glob('*.promisor'))
                    and not any(name.lower() == 'extensions.partialclone' or
                                name.lower().startswith('remote.') and name.lower().endswith('.promisor')
                                for name in git('config', '--local', '--name-only', '--list').splitlines())
                    and not any(line.startswith('alternate:') for line in git('count-objects', '-v').splitlines()),
                    'self-contained Git objects required')
            require(git('for-each-ref', '--format=%(objectname)'), 'local Git refs required')
            git('cat-file', '-e', 'HEAD^{commit}')
            git('rev-list', '--objects', '--all', '--missing=error')
            git('fsck', '--full', '--no-dangling')
        git('cat-file', '-e', 'refs/heads/dev^{commit}')
        return not git('status', '--porcelain', '--untracked-files=all')
    check('own Git clone/common dir/dev/clean checkout', git_ready)
    kh = Path(known_hosts)
    check('NEEDS_EXCEPTION: existing trusted known_hosts inaccessible in slot2 unit', lambda:
          kh.is_absolute() and kh == kh.resolve() and kh.is_file() and os.access(kh, os.R_OK)
          and not any(kh.is_relative_to(p) for p in (Path('/home'), Path('/root'), Path('/run/user'))))
    for path in rt.layout.others():
        check('slot isolation: ' + str(path), lambda path=path: not os.access(path, os.R_OK | os.X_OK)
              and not os.access(path, os.W_OK))
    check('base.git is read-only', lambda: not os.access(rt.layout.root.parent / 'base.git', os.W_OK))
    check('assignment is read-only', lambda: not os.access(rt.layout.assignment.parent, os.W_OK))
    check('shared lock/API access', lambda: os.access(rt.layout.registry, os.R_OK)
          and os.access(rt.layout.api_clock, os.R_OK | os.W_OK))
    if activation:
        for role in ('author', 'qa'):
            check('shared daily cap for two slots: ' + role, lambda role=role:
                  (rt.budget.remaining('codex', role) or 0) >= 2)
            for candidate in ('slot1', 'slot2'):
                check('explicit unexhausted daily cap: ' + candidate + ':' + role,
                      lambda role=role, candidate=candidate:
                      (rt.budget.remaining('codex', role, candidate) or 0) > 0)
    def external_proof():
        value = root_document(proof or CONFIG_ROOT / 'slot2-proof.json')
        expected = dict(schema='GB_SLOT2_PROOF_V1', user=rt.user, uid=uid, gid=account.pw_gid,
                        home=str(rt.home), codex=str(codex), codex_sha256=_sha(codex),
                        model=model, effort=effort, known_hosts=str(kh))
        require(set(value) == set(expected) | {'probes', 'evidence_ref'}, 'invalid proof fields')
        require(all(value[k] == v for k, v in expected.items()), 'proof binding mismatch')
        require(isinstance(value['evidence_ref'], str) and 1 <= len(value['evidence_ref']) <= 200,
                'missing non-secret pipeline evidence reference')
        probes = value['probes']
        require(set(probes) == {'login', 'inference_author', 'inference_qa', 'ssh_push'}, 'incomplete probes')
        require(all(type(t) is int and t >= 0 and 0 <= time.time() - t
                    and (not activation or time.time() - t <= 14400) for t in probes.values()),
                'stale/unproven login/inference/SSH')
        return True
    check('PM/OPS pipeline proof of authorized own login + inference + authenticated SSH is absent/stale/mismatched', external_proof)
    return dict(slot=rt.slot, ready=not failures, failures=failures)


# ---------------------------------------------------------------- supervisor CLI
def load_supervisor_config(path):
    value = read_json(path, {0})
    require(set(value) == {'schema', 'slots', 'max_parallel', 'approved_since', 'poll'}
            and value['schema'] == 'GB_SLOT_SUPERVISOR_V1', 'invalid supervisor config')
    require(isinstance(value['slots'], list) and 1 <= len(value['slots']) <= 8
            and all(isinstance(s, str) and SLOT_RE.fullmatch(s) for s in value['slots'])
            and len(set(value['slots'])) == len(value['slots']), 'invalid slots')
    require(type(value['max_parallel']) is int and 1 <= value['max_parallel'] <= len(value['slots']),
            'invalid max_parallel')
    require(type(value['poll']) is int and 120 <= value['poll'] <= 600, 'invalid poll')
    return value


def _executor():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import autonomous_issues
    return autonomous_issues


def read_assignments(state_root, slots):
    out = {}
    for slot in slots:
        path = Path(state_root) / 'assign' / f'{slot}.json'
        try:
            value = read_json(path, None, 4096)
        except FileNotFoundError:
            continue
        require(isinstance(value, dict) and value.get('schema') == ASSIGN_SCHEMA and value.get('slot') == slot
                and type(value.get('issue')) is int and isinstance(value.get('locks'), list)
                and isinstance(value.get('allowed_paths'), list), 'invalid assignment')
        out[slot] = dict(issue=value['issue'], record=dict(issue=value['issue'], locks=value['locks'],
                                                             allowed_paths=value['allowed_paths']))
    return out


def tick(cfg, state_root=STATE_ROOT, config_root=CONFIG_ROOT, fetch=None, owners=None, a=None):
    """One supervisor pass: read slot statuses, retire finished assignments, assign ready tasks."""
    a = a or _executor()
    slots = cfg['slots']
    since = dt.datetime.fromisoformat(cfg['approved_since'].replace('Z', '+00:00'))
    statuses = read_statuses(state_root, slots, owners)
    assignments = read_assignments(state_root, slots)
    finished = set().union(*[set(s['done']) | set(s['parked']) for s in statuses.values()]) if statuses else set()
    for slot, asg in list(assignments.items()):
        active = (statuses.get(slot) or {}).get('active')
        if asg['issue'] in finished and not (active and active['issue'] == asg['issue'] and active['phase'] != 'done'):
            os.unlink(Path(state_root) / 'assign' / f'{slot}.json')
            del assignments[slot]
    busy = {name for name in slots if name in assignments or
            ((statuses.get(name) or {}).get('active') or {}).get('phase') not in (None, 'done')}
    if len(busy) >= cfg['max_parallel'] or not any(name in statuses and name not in busy for name in slots):
        return {}, {'queue': 'busy: no free slot/capacity'}
    budget = Budget(Path(config_root) / 'budgets.json', Path(state_root) / 'outbox', Path(state_root) / 'locks' / 'registry.lock')
    if fetch is None:
        issues = a.pages('issues?state=open')
        cutoff = a.urllib.parse.quote(since.isoformat(), safe='')
        comments = a.pages(f'issues/comments?since={cutoff}')
    else:
        issues, comments = fetch()
    candidates = admitted(a, issues, comments, since)
    planned, reasons = plan(candidates, statuses, assignments, slots,
                            cfg['max_parallel'], budget)
    if not candidates:
        reasons['queue'] = 'no admitted tasks'
    for slot, issue in planned.items():
        task = dict(admitted(a, [i for i in issues if i['number'] == issue], comments, since))[issue]
        record = task_record(issue, task)
        atomic(Path(state_root) / 'assign' / f'{slot}.json',
               dict(schema=ASSIGN_SCHEMA, slot=slot, issue=issue, assigned_at=int(time.time()),
                    locks=record['locks'], allowed_paths=record['allowed_paths']), 0o644)
    return planned, reasons


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest='cmd', required=True)
    sup = sub.add_parser('supervise')
    sup.add_argument('--config', type=Path, default=CONFIG_ROOT / 'supervisor.json')
    sub.add_parser('adapters')
    pf = sub.add_parser('preflight-slot2', help='read-only; never opens credentials or starts services')
    pf.add_argument('--codex', type=Path, required=True)
    pf.add_argument('--model', required=True)
    pf.add_argument('--effort', required=True)
    pf.add_argument('--known-hosts', type=Path, required=True)
    st = sub.add_parser('status')
    st.add_argument('--config', type=Path, default=CONFIG_ROOT / 'supervisor.json')
    pl = sub.add_parser('plan', help='dry-run the scheduler on a JSON list of {issue, task}')
    pl.add_argument('--tasks', type=Path, required=True)
    pl.add_argument('--max-parallel', type=int, default=2)
    mg = sub.add_parser('migrate')
    mg.add_argument('--src', type=Path, default=LEGACY_STATE)
    mg.add_argument('--dst', type=Path, default=STATE_ROOT / 'slots' / 'slot1')
    mg.add_argument('--apply', action='store_true', help='without it: dry-run only')
    args = parser.parse_args(argv)
    if args.cmd == 'supervise':
        wait_for_activation()
    if args.cmd == 'preflight-slot2':
        result = slot2_preflight(Runtime('slot2'), args.codex, args.model, args.effort, args.known_hosts)
        print(json.dumps(result, sort_keys=True))
        return 0 if result['ready'] else 1
    if args.cmd == 'adapters':
        for name in ADAPTERS:
            print(json.dumps({'adapter': name, **{r: adapter_status(name, r)[1] for r in ROLES}}))
        return 0
    if args.cmd == 'plan':
        items = loads(args.tasks.read_bytes())
        slots = [f'slot{i + 1}' for i in range(args.max_parallel)]
        statuses = {s: dict(active=None, done=[], parked=[]) for s in slots}
        always = Adapter('codex', 'codex', ('author', 'qa', 'review'), *([True] * 6))
        result, reasons = plan([(x['issue'], x['task']) for x in items], statuses, {}, slots,
                               args.max_parallel, None, dict(ADAPTERS, codex=always))
        print(json.dumps({'parallel': result, 'deferred': reasons}, sort_keys=True))
        return 0
    if args.cmd == 'migrate':
        print(json.dumps(migrate_state(args.src, args.dst, dry_run=not args.apply), sort_keys=True))
        return 0
    cfg = load_supervisor_config(args.config)
    if args.cmd == 'status':
        print(json.dumps({'statuses': read_statuses(STATE_ROOT, cfg['slots']),
                          'assignments': read_assignments(STATE_ROOT, cfg['slots'])}, sort_keys=True))
        return 0
    require(os.getuid() != 0 and pwd.getpwuid(os.getuid()).pw_name == SUPERVISOR_USER, 'wrong supervisor user')
    a = _executor()
    a._API_CLOCK = ApiClock(STATE_ROOT / 'locks' / 'api.clock')
    owners = {s: uid_of(slot_user(s)) for s in cfg['slots']}
    while True:
        try:
            planned, reasons = tick(cfg, owners=owners, a=a)
            print(json.dumps({'assigned': planned, 'deferred': {str(k): v for k, v in reasons.items()}}), flush=True)
        except Exception as error:   # never crash-loop on a transient read; report without details
            print('Supervisor pass failed: ' + (str(error) if isinstance(error, (Hold, a.Hold))
                                                 else type(error).__name__), flush=True)
        time.sleep(cfg['poll'])


if __name__ == '__main__':
    sys.exit(main())

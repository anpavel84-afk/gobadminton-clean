#!/usr/bin/python3
"""Reviewed root-only AGY author install (OD-014A). Dry by default; never activates.

Chosen accepted Git commit → exact Git blobs. Installs ONLY native_antigravity_author.py
plus protected author marker and OD-020 author=unlimited budget. Does not rewrite
core/stage/cost_policy, old backup.json gates, or QA-ready N/Guard modules.
Reuses stage5 quiet_v5 resource checks for dead historical 113/119 occupancy;
preserves journals/counters. C5 stays disabled. READY is a separate accepted OPS step.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

sys.path.insert(0, '/usr/local/lib/gb-actions-train')
import receiver as r
import installer as i
from core import loads, need

INSTALL = Path('/usr/local/lib/gb-actions-train')
CONFIG = Path('/etc/gobadminton-slots')
STATE = r.STATE
JOURNAL = STATE / 'antigravity-author-upgrade.json'
BACKUP = STATE / 'antigravity-author-backup'
AUTHOR_MODULE = 'native_antigravity_author.py'
PINS = ('native_antigravity.py', 'native_guard.py')
MODEL = 'claude-sonnet-5-5-medium'
MARKER = CONFIG / 'antigravity-author.json'
BUDGET = CONFIG / 'budgets.json'
QA_MARKER = CONFIG / 'antigravity-qa.json'
REPO_PREFIX = 'scripts/chatops/actions_train/'
OPS_SCRIPT = 'scripts/chatops/ops/antigravity_author_upgrade.py'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    r.trusted_tree(path)
    s = path.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1, 'nonregular upgrade input')
    return path.read_bytes()


def optional(path):
    need(not path.is_symlink(), 'upgrade target symlink')
    return read(path) if path.exists() else None


def encoded(value):
    return json.dumps(value, sort_keys=True).encode()


def _load_quiet_mod():
    """Reuse accepted stage5 quiet helpers — no new quiescence framework."""
    path = Path(__file__).resolve().with_name('stage5_cursor_context_upgrade.py')
    if not path.is_file():
        # Installed OPS may live beside the train lib.
        alt = INSTALL.parent / 'gb-ops' / 'stage5_cursor_context_upgrade.py'
        path = alt if alt.is_file() else path
    need(path.is_file(), 'stage5 quiet_v5 helper missing')
    spec = importlib.util.spec_from_file_location('agy_author_quiet_v5', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    need(hasattr(mod, 'quiet_v5'), 'quiet_v5 absent')
    need(getattr(mod, 'QUIET_SCOPE_NATIVE_ANTIGRAVITY_AUTHOR', None)
         == 'native_antigravity_author', 'author quiet scope absent')
    return mod


def _load_quiet_v5():
    """Compatibility: return quiet_v5 callable from the shared stage5 module."""
    return _load_quiet_mod().quiet_v5


def quiet(base_controller=None, *, canary_task_sha256=None):
    """DEAD historical occupancy via quiet_v5 author scope; never clears pending UNKNOWN.

    Requests native_antigravity_author resource scope only: shared_qa default for
    other callers stays strict. Carries this install's canary task hash so same-task
    product-QA pending cannot be skipped. Physical UID978 provider absence remains
    inside quiet_v5 after quiet_v4.
    """
    need(re.fullmatch('[a-f0-9]{64}', canary_task_sha256 or ''),
         'exact canary task hash required for author quiet')
    mod = _load_quiet_mod()
    mod.quiet_v5(mod.QUIET_SCOPE_NATIVE_ANTIGRAVITY_AUTHOR,
                 author_canary_task_sha256=canary_task_sha256)
    policy = r.read(r.POLICY, 0)
    need(policy.get('mode') == 'disabled', 'launches enabled; refuse author install')
    if base_controller:
        need(policy.get('controller_sha') == base_controller,
             'base controller differs')
    # C5 remains disabled — never flip policy mode here.


def git_blobs(bundle, commit):
    """Exact Git blobs for allowlisted author module + pin verification + this OPS script."""
    need(bundle.is_absolute() and '..' not in bundle.parts, 'noncanonical bundle path')
    need(re.fullmatch('[a-f0-9]{40}', commit or ''), 'exact accepted Git commit required')
    need(stat.S_ISDIR((bundle / '.git').lstat().st_mode), 'bundle .git must be a real directory')
    r.trusted_tree(bundle)
    r.trusted_tree(bundle / '.git')
    head = subprocess_git(bundle, 'rev-parse', 'HEAD')
    need(head == commit, 'bundle HEAD differs from reviewed commit')
    need(not subprocess_git(bundle, 'status', '--porcelain=v1', '--untracked-files=all'),
         'dirty bundle')
    wanted = {REPO_PREFIX + AUTHOR_MODULE, *(REPO_PREFIX + n for n in PINS), OPS_SCRIPT}
    material = {}
    for entry in subprocess_git_bytes(bundle, 'ls-tree', '-r', '-l', '-z', '--full-tree', commit).split(b'\0'):
        if not entry:
            continue
        meta, path = entry.split(b'\t', 1)
        mode, kind, oid, size = meta.split()
        path = path.decode('utf-8')
        if path not in wanted:
            continue
        need(mode in (b'100644', b'100755') and kind == b'blob', 'unsafe Git blob')
        raw = read(bundle / path)
        need(len(raw) == int(size) and raw == subprocess_git_bytes(bundle, 'cat-file', 'blob', oid.decode()),
             'bundle worktree/Git blob differs')
        material[path] = raw
    need(set(material) == wanted, 'author Git allowlist incomplete')
    need(material[OPS_SCRIPT] == Path(__file__).resolve().read_bytes(),
         'running installer differs from reviewed bundle script')
    return material


def subprocess_git(bundle, *args):
    out = subprocess_git_bytes(bundle, *args)
    return out.decode().strip()


def subprocess_git_bytes(bundle, *args):
    import subprocess
    proc = subprocess.run(
        ['/usr/bin/git', '-C', str(bundle), '-c', 'core.hooksPath=/dev/null',
         '-c', 'core.fsmonitor=false', *args],
        capture_output=True, check=False)
    need(proc.returncode == 0, 'git failed: ' + (proc.stderr or b'')[:200].decode(errors='replace'))
    return proc.stdout


def budget_author_unlimited(raw, *, legacy_finite=None):
    """OD-020: set providers.agy.author (+ slot2) to unlimited; preserve qa/others/ledgers.

    Main install path requires explicit unlimited. Optional legacy_finite retained only
    for historical unit fixtures that still exercise finite author caps.
    """
    old = loads(raw)
    need(isinstance(old, dict) and old.get('schema') == 1, 'unexpected budget schema')
    providers = old.get('providers') or {}
    need(isinstance(providers, dict), 'invalid providers')
    agy = dict(providers.get('agy') or {})
    need(agy.get('qa') == 'unlimited', 'current AGY QA budget must already be unlimited')
    need('per_issue_daily' not in agy, 'per_issue_daily must already be absent (OD-020)')
    need('author' not in agy, 'prior author budget must be reconciled')
    slots = old.get('slots') or {}
    need(isinstance(slots, dict), 'invalid slots')
    own = slots.get('slot2')
    need(isinstance(own, dict), 'slot2 budget baseline required')
    slot_agy = dict(own.get('agy') or {})
    need('author' not in slot_agy, 'slot2 author budget must be absent before install')
    desired = copy.deepcopy(old)
    value = 'unlimited' if legacy_finite is None else legacy_finite
    if legacy_finite is not None:
        need(type(legacy_finite) is int and 1 <= legacy_finite <= 10000,
             'finite positive legacy budget required')
    desired['providers']['agy']['author'] = value
    desired['slots']['slot2'].setdefault('agy', {})['author'] = value
    # Preserve unrelated providers / slot1 / qa / counters by structural equality check.
    check = copy.deepcopy(old)
    check.setdefault('providers', {}).setdefault('agy', {})['author'] = value
    check.setdefault('slots', {}).setdefault('slot2', {}).setdefault('agy', {})['author'] = value
    need(desired == check, 'unrelated budget fields would change')
    return encoded(desired)


def preserved():
    """Read-only fingerprint of policy, QA/cursor markers and authoritative history."""
    result = {}
    roots = (STATE, r.AUTONOMY / 'slots', r.AUTONOMY / 'outbox')
    for root in roots:
        for path in root.rglob('*'):
            if path in (JOURNAL, STATE / 'controller.lock') or BACKUP == path or BACKUP in path.parents:
                continue
            need(not path.is_symlink(), 'history link refused')
            if path.is_file():
                result[str(path)] = i.sha(path)
    for path in (r.POLICY, QA_MARKER, CONFIG / 'cursor-author.json'):
        if path.exists():
            result[str(path)] = i.sha(path)
    return result


def plan(bundle, commit, task_hash, *, base_controller=None, legacy_finite=None):
    need(re.fullmatch('[a-f0-9]{64}', task_hash or ''), 'exact canary task hash required')
    quiet(base_controller, canary_task_sha256=task_hash)
    material = git_blobs(bundle, commit)
    author_raw = material[REPO_PREFIX + AUTHOR_MODULE]
    # Verify retained N/Guard match chosen Git blobs AND installed QA-ready modules.
    qa = loads(read(QA_MARKER))
    need(qa.get('schema') == 'GB_ANTIGRAVITY_QA_29_V1'
         and qa.get('phase') in ('canary', 'ready'), 'AGY QA marker not ready/canary')
    for name in PINS:
        git_raw = material[REPO_PREFIX + name]
        installed = read(INSTALL / name)
        need(installed == git_raw, 'installed ' + name + ' differs from chosen Git blob')
        need(qa.get('modules', {}).get(name) == sha(installed),
             'AGY QA marker pins stale; separate reviewed re-pin required')
    need(optional(INSTALL / AUTHOR_MODULE) is None, 'prior author installation must be reconciled')
    need(optional(MARKER) is None, 'prior author qualification exists')
    marker = dict(
        schema='GB_ANTIGRAVITY_AUTHOR_V1', phase='canary', slot='slot2',
        executor_uid=978, canary_task_sha256=task_hash, admitted_models=[MODEL],
        modules={AUTHOR_MODULE: sha(author_raw),
                 **{n: sha(material[REPO_PREFIX + n]) for n in PINS}},
        model=MODEL, adapter_commit=commit)
    payload = {
        INSTALL / AUTHOR_MODULE: author_raw,
        MARKER: encoded(marker),
        BUDGET: budget_author_unlimited(read(BUDGET), legacy_finite=legacy_finite),
    }
    return payload, preserved(), marker


def put(path, raw, mode=0o644):
    """Exact bytes, same-directory atomic replace; only the fixed target allowlist."""
    allowed = {INSTALL / AUTHOR_MODULE, MARKER, BUDGET}
    need(path in allowed or path == JOURNAL or path.parent == BACKUP, 'out-of-scope upgrade write')
    r.trusted_tree(path.parent)
    need(not path.is_symlink(), 'upgrade destination link')
    fd, temp = tempfile.mkstemp(prefix='.agy-upgrade-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            os.fchmod(out.fileno(), mode)
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def execute(action, bundle, commit, task_hash, *, base_controller=None, legacy_finite=None,
            manifest_hash=None, calls=None):
    """Caller holds existing controller.lock; main acquires it, fixture caller isolates it.

    commit = accepted Git SHA (OD-014A). manifest_hash/calls kept as legacy kwargs for
    older CLI wrappers; calls maps to legacy_finite only when explicitly finite.
    """
    need(os.geteuid() == 0, 'root OPS only')
    need(action in ('dry', 'apply', 'verify', 'rollback'), 'unsupported upgrade action')
    if calls is not None and legacy_finite is None and calls != 'unlimited':
        legacy_finite = calls
    if action in ('dry', 'apply'):
        payload, history, marker = plan(
            bundle, commit, task_hash, base_controller=base_controller,
            legacy_finite=legacy_finite)
        need(not JOURNAL.exists() and not BACKUP.exists(),
             'prior upgrade journal must be reconciled')
        changes = {
            str(p): dict(
                before=sha(raw) if (raw := optional(p)) is not None else None,
                after=sha(after))
            for p, after in payload.items()
        }
        if action == 'dry':
            return dict(dry=True, changes=changes, qa_pins='match', no_activation=True,
                        canary_task_sha256=task_hash, author_budget='unlimited'
                        if legacy_finite is None else legacy_finite)
        j = dict(
            schema='GB_AGY_AUTHOR_UPGRADE_V1', phase='backing-up', changes=changes,
            bundle_commit=commit, task_sha256=task_hash, history=history,
            base_controller=base_controller, marker_phase='canary',
            metadata={str(p): (stat.S_IMODE(p.stat().st_mode) if p.exists() else 0o644)
                      for p in payload})
        put(JOURNAL, encoded(j), 0o600)
        BACKUP.mkdir(mode=0o700)
        for n, name in enumerate(sorted(changes)):
            before = optional(Path(name))
            if before is not None:
                put(BACKUP / str(n), before, 0o600)
        j['phase'] = 'applying'
        put(JOURNAL, encoded(j), 0o600)
        for target, raw in payload.items():
            put(target, raw, 0o644)  # Nonsecret role metadata: UID978 reads; only Root writes.
        need(all(sha(read(Path(p))) == row['after'] for p, row in changes.items()),
             'installed verification failed')
        need(preserved() == history, 'authoritative history changed')
        j['phase'] = 'installed-canary-disabled'
        put(JOURNAL, encoded(j), 0o600)
        return dict(phase=j['phase'], qa_pins='match', no_activation=True,
                    canary_task_sha256=task_hash, ready=False,
                    marker_modules=marker['modules'])
    j = loads(read(JOURNAL))
    need(j.get('schema') == 'GB_AGY_AUTHOR_UPGRADE_V1'
         and j.get('bundle_commit') == commit
         and j.get('task_sha256') == task_hash, 'upgrade identity differs')
    quiet(base_controller or j.get('base_controller'), canary_task_sha256=task_hash)
    need(preserved() == j['history'], 'history changed; never rewind it')
    allowed = {str(INSTALL / AUTHOR_MODULE), str(MARKER), str(BUDGET)}
    need(set(j['changes']) == allowed, 'invalid journal targets')
    restore = []
    for n, (name, row) in enumerate(sorted(j['changes'].items())):
        raw = optional(Path(name))
        actual = sha(raw) if raw is not None else None
        need(actual in (row['before'], row['after']), 'foreign target drift')
        if action == 'verify':
            need(actual == row['after'], 'installed target differs')
        elif actual != row['before']:
            before = None
            if row['before'] is not None:
                before = read(BACKUP / str(n))
                need(sha(before) == row['before'], 'backup drift')
            restore.append((Path(name), before, j['metadata'][name]))
    for target, before, mode in restore:
        if before is None:
            target.unlink()
            directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        else:
            put(target, before, mode)
    if action == 'rollback':
        need(all((sha(raw) if (raw := optional(Path(p))) is not None else None) == row['before']
                 for p, row in j['changes'].items()), 'rollback verification failed')
        need(preserved() == j['history'], 'history changed during rollback')
        j['phase'] = 'rolled-back-disabled'
        put(JOURNAL, encoded(j), 0o600)
    return dict(phase=j['phase'], verified=True, no_activation=True, ready=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--action', choices=('dry', 'apply', 'verify', 'rollback'), default='dry')
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--commit', required=True, help='accepted Git commit (OD-014A)')
    parser.add_argument('--canary-task-sha256', required=True)
    parser.add_argument('--base-controller', default=None)
    parser.add_argument('--author-budget', default='unlimited',
                        help='unlimited (OD-020 default) or finite int for legacy fixtures')
    # Legacy aliases — ignored for content authority.
    parser.add_argument('--manifest-sha256', default=None)
    parser.add_argument('--base-controller-sha', dest='base_controller', default=None)
    args = parser.parse_args()
    need(os.geteuid() == 0, 'root OPS only')
    legacy = None
    if args.author_budget != 'unlimited':
        legacy = int(args.author_budget)
    import fcntl
    fd = os.open(STATE / 'controller.lock', os.O_RDWR | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(execute(
            args.action, args.bundle, args.commit, args.canary_task_sha256,
            base_controller=args.base_controller, legacy_finite=legacy,
            manifest_hash=args.manifest_sha256), sort_keys=True))
    finally:
        os.close(fd)


if __name__ == '__main__':
    main()

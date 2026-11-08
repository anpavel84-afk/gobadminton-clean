#!/usr/bin/python3
"""Reviewed root-only AGY author install and proof-bound qualification (OD-014A).

Chosen accepted Git commit → exact Git blobs. Installs ONLY native_antigravity_author.py
plus protected author marker and OD-020 author=unlimited budget. Does not rewrite
core/stage/cost_policy, old backup.json gates, or QA-ready N/Guard modules.
Reuses stage5 quiet_v5 resource checks for dead historical 113/119 occupancy;
preserves journals/counters. C5 stays disabled. READY is a separate proof-bound OPS action; C5 launch policy stays disabled.
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
    Legitimate sequential upgrade may already have author=unlimited (OD-020); keep
    exact current bytes when the desired value matches — never rewrite ledgers.
    """
    old = loads(raw)
    need(isinstance(old, dict) and old.get('schema') == 1, 'unexpected budget schema')
    providers = old.get('providers') or {}
    need(isinstance(providers, dict), 'invalid providers')
    agy = dict(providers.get('agy') or {})
    need(agy.get('qa') == 'unlimited', 'current AGY QA budget must already be unlimited')
    need('per_issue_daily' not in agy, 'per_issue_daily must already be absent (OD-020)')
    slots = old.get('slots') or {}
    need(isinstance(slots, dict), 'invalid slots')
    own = slots.get('slot2')
    need(isinstance(own, dict), 'slot2 budget baseline required')
    slot_agy = dict(own.get('agy') or {})
    value = 'unlimited' if legacy_finite is None else legacy_finite
    if legacy_finite is not None:
        need(type(legacy_finite) is int and 1 <= legacy_finite <= 10000,
             'finite positive legacy budget required')
    # Already at desired OD-020 unlimited (or fixture finite): keep exact bytes.
    if agy.get('author') == value and slot_agy.get('author') == value:
        return raw
    need('author' not in agy, 'prior author budget must be reconciled')
    need('author' not in slot_agy, 'slot2 author budget must be absent before install')
    desired = copy.deepcopy(old)
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


def validate_canary_task(bundle, commit, path, task_hash):
    """A new isolated admission replaces no historical assignment or operation."""
    need(path == 'scripts/chatops/tests/fixtures/antigravity-author-canary.json',
         'unreviewed canary task path')
    raw = read(bundle / path)
    need(raw == subprocess_git_bytes(bundle, 'show', commit + ':' + path),
         'canary task differs from accepted Git blob')
    task = loads(raw)
    need(isinstance(task, dict) and task.get('issue') == 199
         and task.get('authorroute') == ['agy_author']
         and task.get('qaroute') == ['codex_sol_medium']
         and task.get('target') == 'dev', 'invalid isolated canary identity')
    allowed = task.get('allowed_paths')
    need(allowed == ['docs/handoffs/antigravity-author-canary/count_completed.py'],
         'canary scope must stay isolated')
    from native_antigravity_author import canonical_task_digest
    need(canonical_task_digest(task) == task_hash, 'prospective task digest mismatch')
    return task


def plan(bundle, commit, task_hash, *, base_controller=None, legacy_finite=None,
         prior_journal=None, canary_task_path=None):
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
    if prior_journal is not None:
        validate_prior_installed(prior_journal)
        if prior_journal.get('task_sha256') != task_hash:
            need(canary_task_path is not None,
                 'new canary requires reviewed prospective task blob')
            validate_canary_task(bundle, commit, canary_task_path, task_hash)
            quiet(base_controller, canary_task_sha256=prior_journal['task_sha256'])
        need(prior_journal.get('bundle_commit') != commit,
             'sequential upgrade requires a distinct accepted Git commit')
        installed_author = optional(INSTALL / AUTHOR_MODULE)
        installed_marker = optional(MARKER)
        need(installed_author is not None, 'prior author module missing')
        need(installed_marker is not None, 'prior author marker missing')
        need(sha(installed_author) == prior_journal['changes'][str(INSTALL / AUTHOR_MODULE)]['after'],
             'author module differs from prior accepted transaction')
        old_marker = loads(installed_marker)
        need(old_marker.get('schema') == 'GB_ANTIGRAVITY_AUTHOR_V1'
             and old_marker.get('phase') == 'canary'
             and old_marker.get('slot') == 'slot2'
             and old_marker.get('executor_uid') == 978
             and old_marker.get('canary_task_sha256') == prior_journal['task_sha256']
             and old_marker.get('model') == MODEL
             and old_marker.get('admitted_models') == [MODEL],
             'prior canary author marker identity differs')
        # Pins already matched Git+QA above; marker pin digests must agree.
        for name in PINS:
            need(old_marker.get('modules', {}).get(name) == sha(material[REPO_PREFIX + name]),
                 'prior marker pin digest differs')
    else:
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
    allowed = {INSTALL / AUTHOR_MODULE, MARKER, BUDGET, READY_PROOF, PROMOTION_JOURNAL}
    under_backup = path == BACKUP or path.parent == BACKUP or BACKUP in path.parents
    need(path in allowed or path == JOURNAL or under_backup, 'out-of-scope upgrade write')
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


def _mkdir_backup(path, mode=0o700):
    """Create a directory only under the existing author BACKUP area."""
    need(path == BACKUP or BACKUP in path.parents or path.parent == BACKUP,
         'out-of-scope backup mkdir')
    r.trusted_tree(path.parent)
    need(not path.is_symlink(), 'backup mkdir link refused')
    path.mkdir(mode=mode)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def read_prior_journal():
    """Return completed prior journal or None when no author upgrade exists yet."""
    if not JOURNAL.exists():
        need(not BACKUP.exists(), 'orphaned author backup without journal')
        return None
    j = loads(read(JOURNAL))
    need(j.get('schema') == 'GB_AGY_AUTHOR_UPGRADE_V1'
         and j.get('phase') == 'installed-canary-disabled',
         'prior upgrade journal must be installed-canary-disabled')
    need(BACKUP.is_dir() and not BACKUP.is_symlink(), 'prior author backup required')
    return j


def validate_prior_installed(j):
    """Current installed bytes must equal the previous accepted transaction after-hashes."""
    allowed = {str(INSTALL / AUTHOR_MODULE), str(MARKER), str(BUDGET)}
    need(set(j.get('changes') or ()) == allowed, 'invalid prior journal targets')
    for name, row in j['changes'].items():
        raw = optional(Path(name))
        actual = sha(raw) if raw is not None else None
        need(actual == row.get('after'), 'installed bytes differ from prior accepted transaction')
    need(j.get('task_sha256') and re.fullmatch('[a-f0-9]{64}', j['task_sha256']),
         'prior canary task hash required')
    need(j.get('bundle_commit') and re.fullmatch('[a-f0-9]{40}', j['bundle_commit']),
         'prior bundle commit required')


def journal_backup(j):
    """Old transactions use BACKUP; new sequential ones retain distinct before-bytes."""
    value = j.get('backup_dir')
    if value is None:
        return BACKUP
    expected = BACKUP / 'transactions' / j['bundle_commit']
    need(value == str(expected), 'invalid transaction backup directory')
    r.trusted_tree(expected)
    need(expected.is_dir() and not expected.is_symlink(), 'transaction backup absent')
    return expected


def archive_prior_transaction(j):
    """Freeze prior proof; never unlink its journal or numbered backups.

    The live journal remains valid until the new before-bytes are durable and
    atomically replacing the journal starts the next transaction.
    """
    validate_prior_installed(j)
    revisions = BACKUP / 'revisions'
    dest = revisions / j['bundle_commit']
    if not revisions.exists():
        _mkdir_backup(revisions)
    if not dest.exists():
        _mkdir_backup(dest)
    else:
        r.trusted_tree(dest)
        need(dest.is_dir() and not dest.is_symlink(), 'unsafe prior archive')
    def freeze(path, raw):
        if path.exists():
            need(read(path) == raw, 'prior archive differs')
        else:
            put(path, raw, 0o600)
    freeze(dest / 'antigravity-author-upgrade.json', read(JOURNAL))
    source = journal_backup(j)
    for n, name in enumerate(sorted(j['changes'])):
        src = source / str(n)
        if j['changes'][name].get('before') is None:
            need(not src.exists(), 'unexpected prior backup slot')
            continue
        raw = read(src)
        need(sha(raw) == j['changes'][name]['before'], 'prior backup drift')
        freeze(dest / str(n), raw)
    return dest


def execute(action, bundle, commit, task_hash, *, base_controller=None, legacy_finite=None,
            manifest_hash=None, calls=None, canary_task_path=None):
    """Caller holds existing controller.lock; main acquires it, fixture caller isolates it.

    commit = accepted Git SHA (OD-014A). manifest_hash/calls kept as legacy kwargs for
    older CLI wrappers; calls maps to legacy_finite only when explicitly finite.
    """
    need(os.geteuid() == 0, 'root OPS only')
    need(action in ('dry', 'apply', 'verify', 'rollback'), 'unsupported upgrade action')
    if calls is not None and legacy_finite is None and calls != 'unlimited':
        legacy_finite = calls
    if action in ('dry', 'apply'):
        prior = read_prior_journal()
        payload, history, marker = plan(
            bundle, commit, task_hash, base_controller=base_controller,
            legacy_finite=legacy_finite, prior_journal=prior,
            canary_task_path=canary_task_path)
        changes = {
            str(p): dict(
                before=sha(raw) if (raw := optional(p)) is not None else None,
                after=sha(after))
            for p, after in payload.items()
        }
        if action == 'dry':
            return dict(dry=True, changes=changes, qa_pins='match', no_activation=True,
                        canary_task_sha256=task_hash, author_budget='unlimited'
                        if legacy_finite is None else legacy_finite,
                        sequential=prior is not None,
                        prior_bundle_commit=(prior or {}).get('bundle_commit'))
        if prior is not None:
            archive_prior_transaction(prior)
            transactions = BACKUP / 'transactions'
            if not transactions.exists():
                _mkdir_backup(transactions)
            backup = transactions / commit
            if not backup.exists():
                _mkdir_backup(backup)
            else:
                r.trusted_tree(backup)
                need(backup.is_dir() and not backup.is_symlink(), 'unsafe next backup')
        else:
            need(not JOURNAL.exists() and not BACKUP.exists(),
                 'prior upgrade journal must be reconciled')
            BACKUP.mkdir(mode=0o700)
            backup = BACKUP
        # Keep prior journal and backup slots intact until all new before-bytes
        # are durable. An interrupted preparation never loses the current proof.
        for n, name in enumerate(sorted(changes)):
            before = optional(Path(name))
            slot = backup / str(n)
            if before is None:
                need(not slot.exists(), 'unexpected backup for absent target')
            elif slot.exists():
                need(read(slot) == before, 'prepared backup differs')
            else:
                put(slot, before, 0o600)
        j = dict(
            schema='GB_AGY_AUTHOR_UPGRADE_V1', phase='backing-up', changes=changes,
            bundle_commit=commit, task_sha256=task_hash, history=history,
            base_controller=base_controller, marker_phase='canary',
            prior_bundle_commit=(prior or {}).get('bundle_commit'),
            prior_task_sha256=(prior or {}).get('task_sha256'),
            canary_task_path=canary_task_path,
            **({'backup_dir': str(backup)} if prior is not None else {}),
            metadata={str(p): (stat.S_IMODE(p.stat().st_mode) if p.exists() else 0o644)
                      for p in payload})
        put(JOURNAL, encoded(j), 0o600)
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
                    marker_modules=marker['modules'],
                    sequential=prior is not None,
                    prior_bundle_commit=(prior or {}).get('bundle_commit'))
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
                before = read(journal_backup(j) / str(n))
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


# Root-protected qualification material; no caller-supplied booleans grant READY.
QUALIFICATION_ROOT = STATE / 'antigravity-author-qualification'
READY_PROOF = CONFIG / 'product-author-role-ready.json'
PROMOTION_JOURNAL = STATE / 'antigravity-author-promotion.json'


def qualification_artifacts(operation):
    need(re.fullmatch('[a-f0-9]{64}', operation or ''), 'exact qualification operation required')
    folder = QUALIFICATION_ROOT / operation
    manifest_raw = read(folder / 'manifest.json')
    manifest = loads(manifest_raw)
    names = {'native.json', 'route.json', 'qa.json', 'ci.json', 'acceptance.json', 'transcript.raw'}
    need(manifest.get('schema') == 'GB_AGY_AUTHOR_QUALIFICATION_V1'
         and manifest.get('kind') == 'isolated_ops_canary'
         and manifest.get('operation') == operation
         and set(manifest.get('artifacts', {})) == names,
         'invalid qualification manifest')
    artifacts = {}
    for name in names:
        raw = read(folder / name)
        need(sha(raw) == manifest['artifacts'][name], 'qualification artifact drift')
        artifacts[name] = raw if name.endswith('.raw') else loads(raw)
    return manifest, artifacts, sha(manifest_raw)


def verify_qualification_ci(ci, candidate):
    """Read GitHub as the existing trusted publisher; never infer CI from a label."""
    import subprocess
    need(type(ci.get('run_id')) is int and ci['run_id'] > 0, 'CI run identity missing')
    prefix = 'repos/anpavel84-afk/gobadminton-clean/actions/runs/' + str(ci['run_id'])
    def api(path):
        proc = subprocess.run(['/usr/bin/gh', 'api', path], capture_output=True,
            timeout=30, check=False, user=1002, group=1002, extra_groups=[],
            env={'PATH': '/usr/bin:/bin', 'HOME': '/home/agentagency-dev',
                 'GH_CONFIG_DIR': '/home/agentagency-dev/.config/gh'})
        need(proc.returncode == 0 and len(proc.stdout) <= 2 << 20, 'CI readback failed')
        return loads(proc.stdout)
    run = api(prefix)
    need(run.get('head_sha') == candidate and run.get('path') == '.github/workflows/ci.yml'
         and run.get('status') == 'completed' and run.get('conclusion') == 'success'
         and run.get('repository', {}).get('full_name') == 'anpavel84-afk/gobadminton-clean'
         and run.get('event') in ('pull_request', 'push'), 'exact candidate CI not accepted')
    jobs = api(prefix + '/attempts/' + str(run['run_attempt']) + '/jobs?per_page=100').get('jobs')
    expected = {'foundation', 'source (api)', 'source (web)', 'source (admin)',
                'source (contracts)', 'database', 'receiver'}
    need(isinstance(jobs, list) and len(jobs) == 7
         and {job.get('name') for job in jobs} == expected
         and all(job.get('conclusion') == 'success' for job in jobs), 'mandatory CI 7/7 missing')
    return {'run_id': run['id'], 'run_attempt': run['run_attempt'], 'head_sha': candidate}


def promotion_plan(bundle, commit, task_hash, operation):
    prior = read_prior_journal()
    need(prior is not None and prior['bundle_commit'] == commit
         and prior['task_sha256'] == task_hash, 'promotion install identity differs')
    validate_prior_installed(prior)
    quiet(canary_task_sha256=task_hash)
    material = git_blobs(bundle, commit)
    task = validate_canary_task(bundle, commit,
        'scripts/chatops/tests/fixtures/antigravity-author-canary.json', task_hash)
    manifest, artifacts, manifest_sha = qualification_artifacts(operation)
    need(manifest.get('adapter_commit') == commit and manifest.get('task_sha256') == task_hash,
         'qualification admission differs')
    candidate = manifest.get('candidate_sha')
    need(re.fullmatch('[a-f0-9]{40}', candidate or ''), 'candidate SHA missing')
    native, route, qa, ci, acceptance = (artifacts[n] for n in
        ('native.json', 'route.json', 'qa.json', 'ci.json', 'acceptance.json'))
    need(native.get('schema') == 'GB_AGY_AUTHOR_RECEIPT_V1'
         and native.get('phase') == 'imported' and native.get('exit_code') == 0
         and native.get('executor_uid') == 978 and native.get('executor_gid') == 968
         and native.get('task_sha256') == task_hash
         and native.get('requested_model') == native.get('effective_model') == MODEL
         and native.get('requested_route') == 'agy:' + MODEL
         and native.get('qualification_phase') == 'canary'
         and native.get('charge_state') == 'charged'
         and native.get('native_finish') is True
         and native.get('changed_paths') == task['allowed_paths']
         and native.get('executor_reap') in ('cgroup-absent', 'cgroup-quiet'),
         'native canary not accepted')
    from native_antigravity_author import parse_stream
    parsed = parse_stream(artifacts['transcript.raw'], MODEL)
    need(parsed['transcript_sha256'] == native.get('transcript_sha256')
         and parsed['provider_reported_usage'] == native.get('provider_reported_usage')
         and {'view_file', 'run_command'} <= set(parsed['executed_tools'])
         and any(t in parsed['executed_tools'] for t in
                 ('write_to_file', 'replace_file_content', 'multi_replace_file_content')),
         'real read/edit/command/finish transcript missing')
    need(route.get('phase') == 'completed'
         and route.get('provider') == route.get('effective_provider') == 'agy_author'
         and route.get('effective_model') == MODEL
         and route.get('operation_fingerprint') == operation
         and route.get('candidate_sha') == candidate
         and route.get('revision') == task['revision']
         and route.get('fallback_provider') is None, 'native route not proven')
    need(qa.get('provider') == 'codex' and qa.get('model') == 'gpt-6.1-sol'
         and qa.get('verdict') == 'PASS' and qa.get('reviewed_sha') == candidate,
         'independent exact Codex Sol QA missing')
    source_head = native.get('source_head')
    need(re.fullmatch('[a-f0-9]{40}', source_head or '')
         and subprocess_git(bundle, 'rev-parse', candidate + '^') == source_head,
         'candidate source parent differs')
    need(subprocess_git(bundle, 'diff', '--name-only', source_head, candidate).splitlines()
         == task['allowed_paths'], 'candidate effects differ from native canary')
    payload = subprocess_git_bytes(bundle, 'show', candidate + ':' + task['allowed_paths'][0])
    from core import digest
    need(digest({task['allowed_paths'][0]: sha(payload)}) == native.get('imported_payload_sha256'),
         'candidate payload differs from trusted import')
    ci_proof = verify_qualification_ci(ci, candidate)
    need(acceptance.get('schema') == 'GB_AGY_AUTHOR_OPS_ACCEPTANCE_V1'
         and acceptance.get('operation') == operation
         and acceptance.get('candidate_sha') == candidate
         and acceptance.get('task_sha256') == task_hash
         and acceptance.get('checker_exit_code') == 0
         and acceptance.get('checker_stdout') == 'ANTIGRAVITY_AUTHOR_CANARY_TESTS_PASS'
         and acceptance.get('scope') == 'isolated_ops_canary', 'isolated OPS acceptance missing')
    marker = loads(read(MARKER))
    pins = {n: sha(read(INSTALL / n)) for n in (AUTHOR_MODULE, *PINS)}
    need(marker.get('modules') == pins
         and all(read(INSTALL / n) == material[REPO_PREFIX + n] for n in pins),
         'promotion module drift')
    marker = dict(marker, phase='ready', qualification_operation=operation)
    proof = dict(schema='GB_PRODUCT_AUTHOR_ROLE_READY_V1', phase='ready',
        verdict='PASS', model=MODEL, executor_uid=978, modules=pins,
        operation=operation, qualification_kind='isolated_ops_canary',
        candidate_sha=candidate, adapter_commit=commit, task_sha256=task_hash,
        manifest_sha256=manifest_sha, ci=ci_proof,
        product_feature_dev_acceptance=False)
    return marker, proof


def promote(action, bundle, commit, task_hash, operation):
    """Install proof first, marker last: readiness changes at one atomic replace.

    Demotion reverses the grant first. Backups/history remain; no provider call,
    service restart, source lease takeover or policy activation happens here.
    """
    need(os.geteuid() == 0, 'root OPS only')
    need(action in ('promote-dry', 'promote', 'demote'), 'invalid promotion action')
    if action == 'demote':
        journal = loads(read(PROMOTION_JOURNAL))
        need(journal.get('operation') == operation and journal.get('commit') == commit
             and journal.get('task_sha256') == task_hash, 'demotion identity differs')
        quiet(canary_task_sha256=task_hash)
        backup = BACKUP / 'promotions' / operation
        for target, saved in ((MARKER, 'marker'), (READY_PROOF, 'proof')):
            current = optional(target)
            need((sha(current) if current is not None else None)
                 in (journal['before'][str(target)], journal['after'][str(target)]),
                 'foreign readiness drift')
        put(MARKER, read(backup / 'marker'))
        if journal['before'][str(READY_PROOF)] is None:
            if READY_PROOF.exists():
                READY_PROOF.unlink()
        else:
            put(READY_PROOF, read(backup / 'proof'))
        journal['phase'] = 'demoted-canary'
        put(PROMOTION_JOURNAL, encoded(journal), 0o600)
        return {'phase': journal['phase'], 'ready': False}
    marker, proof = promotion_plan(bundle, commit, task_hash, operation)
    need(optional(PROMOTION_JOURNAL) is None and optional(READY_PROOF) is None,
         'prior readiness must be reconciled')
    if action == 'promote-dry':
        return {'phase': 'qualification-verified', 'ready': False, 'dry': True}
    parent = BACKUP / 'promotions'
    if not parent.exists(): _mkdir_backup(parent)
    backup = parent / operation
    if not backup.exists(): _mkdir_backup(backup)
    before_marker = read(MARKER)
    put(backup / 'marker', before_marker, 0o600)
    journal = dict(schema='GB_AGY_AUTHOR_PROMOTION_V1', phase='prepared', operation=operation,
        commit=commit, task_sha256=task_hash,
        before={str(MARKER): sha(before_marker), str(READY_PROOF): None},
        after={str(MARKER): sha(encoded(marker)), str(READY_PROOF): sha(encoded(proof))})
    put(PROMOTION_JOURNAL, encoded(journal), 0o600)
    put(READY_PROOF, encoded(proof))
    put(MARKER, encoded(marker))
    need(read(MARKER) == encoded(marker) and read(READY_PROOF) == encoded(proof),
         'readiness readback failed')
    journal['phase'] = 'ready'
    put(PROMOTION_JOURNAL, encoded(journal), 0o600)
    return {'phase': 'ready', 'ready': True, 'operation': operation,
            'qualification_kind': 'isolated_ops_canary'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--action', choices=('dry', 'apply', 'verify', 'rollback', 'promote-dry', 'promote', 'demote'), default='dry')
    parser.add_argument('--operation', default=None)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--commit', required=True, help='accepted Git commit (OD-014A)')
    parser.add_argument('--canary-task-sha256', required=True)
    parser.add_argument('--canary-task-path', default=None,
                        help='reviewed isolated task Git blob for prospective rebind')
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
        if args.action in ('promote-dry', 'promote', 'demote'):
            result = promote(args.action, args.bundle, args.commit,
                             args.canary_task_sha256, args.operation)
        else:
            result = execute(
                args.action, args.bundle, args.commit, args.canary_task_sha256,
                base_controller=args.base_controller, legacy_finite=legacy,
                manifest_hash=args.manifest_sha256, canary_task_path=args.canary_task_path)
        print(json.dumps(result, sort_keys=True))
    finally:
        os.close(fd)


if __name__ == '__main__':
    main()

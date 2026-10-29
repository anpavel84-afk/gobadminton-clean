#!/usr/bin/env python3
"""Root installer for Lean Mode B. PMA-only after independent QA+CI on exact Git SHA.

selected accepted commit → Git blobs → root-owned versioned release directory
/usr/local/lib/gobadminton-lean/releases/SHA + regular-file current pointer
(content = SHA; NOT a symlink — trusted() forbids symlink ancestors) + config
enabled=false until explicit commission. Backup/rollback of only touched files.
Does not claim MODE_B_ACTIVE before two real tasks. Does not patch PROD.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = 'anpavel84-afk/gobadminton-clean'
INSTALL_ROOT = Path('/usr/local/lib/gobadminton-lean')
RELEASES = INSTALL_ROOT / 'releases'
CURRENT = INSTALL_ROOT / 'current'  # regular file pointer, not symlink
CONFIG_DIR = Path('/etc/gobadminton-lean')
CONFIG = CONFIG_DIR / 'config.json'
STATE_ROOT = Path('/var/lib/gobadminton-lean')
HELPER = Path('/usr/local/sbin/gb-deploy-helper.sh')
HELPER_BACKUP = Path('/var/lib/gobadminton-lean/backup/gb-deploy-helper.sh')
MONITOR_PROJECTION = Path('/var/lib/gb-ops-monitor/lean-mode-b.json')
SHA40 = re.compile(r'^[0-9a-f]{40}$')

INSTALL_FILES = (
    'tools/train/run.py',
    'tools/train/providers.py',
    'tools/train/live.py',
    'tools/train/host.py',
    'tools/train/install.py',
    'tools/train/client.py',
    'tools/train/test_train.py',
    'tools/train/monitor.py',
    'AGENTS.md',
    '.github/workflows/lean-delivery.yml',
    'scripts/chatops/lean-delivery-receiver.sh',
    'docs/handoffs/OD-017-lean-mode-b.md',
)

# OD-020 paired shared-budget receivers (exact accepted Git blobs). Native
# adapter/guard unchanged — qualification proof stays. Parent derives digests.
PAIRED_ACTIONS_TRAIN = (
    'scripts/chatops/actions_train/receiver.py',
    'scripts/chatops/actions_train/live/slots.py',
)
ACTIONS_TRAIN_INSTALL = Path('/usr/local/lib/gb-actions-train')
BUDGETS_POLICY = Path('/etc/gobadminton-slots/budgets.json')
CONTROLLER_LOCK = Path('/var/lib/gobadminton-actions-train/controller.lock')
INTEGRATION_LOCK = Path('/var/lib/gobadminton-autonomy/locks/integration.lock')
WRITER_REGISTRY_LOCK = Path('/var/lib/gobadminton-autonomy/locks/registry.lock')
AGY_EXECUTOR_UID = 978


class InstallError(RuntimeError):
    pass


def need(ok, reason):
    if not ok:
        raise InstallError(reason)


def unique(pairs):
    out = {}
    for k, v in pairs:
        need(k not in out, 'duplicate JSON key')
        out[k] = v
    return out


def loads(raw):
    if isinstance(raw, bytes):
        raw = raw.decode()
    return json.loads(raw, object_pairs_hook=unique)


def sha256_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def git_blob(repo, rev, path):
    """Read exact SHA blob as UID1002 — never Root Git against the agent repo.

    Disables hooks/fsmonitor/replacements. No safe-directory, chown, or recloning.
    """
    env = {
        'PATH': '/usr/bin:/bin',
        'HOME': '/nonexistent',
        'GIT_CONFIG_GLOBAL': '/dev/null',
        'GIT_CONFIG_SYSTEM': '/dev/null',
        'GIT_OPTIONAL_LOCKS': '0',
        'GIT_TERMINAL_PROMPT': '0',
    }
    argv = [
        '/usr/bin/git', '--no-replace-objects',
        '-c', 'core.hooksPath=/dev/null',
        '-c', 'core.fsmonitor=false',
        '-c', 'core.useReplaceRefs=false',
        '-C', str(repo), 'cat-file', '-p', f'{rev}:{path}',
    ]

    def _drop():
        if os.geteuid() == 0:
            os.setgroups([65042])
            os.setgid(1002)
            os.setuid(1002)

    raw = subprocess.check_output(
        argv, stderr=subprocess.PIPE, timeout=60, env=env,
        preexec_fn=_drop if os.geteuid() == 0 else None)
    return raw


def trusted_parents(path):
    path = Path(path)
    for parent in reversed(path.parents):
        info = parent.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
             f'untrusted parent {parent}')
        need(not parent.is_symlink(), f'symlink parent refused {parent}')


def atomic_write(path, data, mode=0o644, uid=0, gid=0):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = data if isinstance(data, bytes) else data.encode()
    fd, tmp = tempfile.mkstemp(prefix='.lean-inst-', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'wb') as fh:
            fh.write(raw)
            fh.flush()
            os.fsync(fh.fileno())
        os.chown(tmp, uid, gid)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def ensure_layout():
    for d, mode in (
        (INSTALL_ROOT, 0o755), (RELEASES, 0o755), (CONFIG_DIR, 0o755),
        (STATE_ROOT, 0o755), (STATE_ROOT / 'results', 0o755),
        (STATE_ROOT / 'locks', 0o770), (STATE_ROOT / 'backup', 0o700),
        (STATE_ROOT / 'state', 0o755),
    ):
        d.mkdir(parents=True, exist_ok=True)
        os.chown(d, 0, 0)
        os.chmod(d, mode)
        need(not d.is_symlink(), f'layout symlink refused {d}')


def collect_blobs(repo, sha):
    need(SHA40.fullmatch(sha), 'invalid release SHA')
    blobs = {}
    for rel in INSTALL_FILES:
        try:
            raw = git_blob(repo, sha, rel)
        except subprocess.CalledProcessError as err:
            raise InstallError(f'missing blob {rel} at {sha}: {err.stderr[:200]!r}') from err
        blobs[rel] = {'sha256': sha256_bytes(raw), 'bytes': len(raw), 'data': raw}
    return blobs


def write_release(sha, blobs):
    dest = RELEASES / sha
    if dest.exists():
        need(dest.is_dir() and not dest.is_symlink(), 'release path conflict')
        meta = dest / 'RELEASE.json'
        if meta.is_file():
            existing = loads(meta.read_bytes())
            need(existing.get('sha') == sha, 'release SHA mismatch')
            for rel, info in blobs.items():
                path = dest / rel
                need(path.is_file() and not path.is_symlink()
                     and sha256_bytes(path.read_bytes()) == info['sha256'],
                     f'installed bytes drift {rel}')
            return dest, False
    staging = RELEASES / f'.staging-{sha}-{os.getpid()}'
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    try:
        for rel, info in blobs.items():
            target = staging / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            mode = 0o755 if rel.endswith('.sh') else 0o644
            atomic_write(target, info['data'], mode=mode)
            need(sha256_bytes(target.read_bytes()) == info['sha256'], f'write drift {rel}')
        meta = {
            'schema': 'GB_LEAN_RELEASE_V1',
            'sha': sha,
            'repo': REPO,
            'files': {rel: {'sha256': b['sha256'], 'bytes': b['bytes']} for rel, b in blobs.items()},
            'installed_at': int(time.time()),
            'enabled_default': False,
            'pointer': 'regular_file_current',
        }
        atomic_write(staging / 'RELEASE.json', json.dumps(meta, sort_keys=True, indent=2) + '\n', 0o644)
        os.rename(staging, dest)
        os.chown(dest, 0, 0)
        need(not dest.is_symlink(), 'release became symlink')
        return dest, True
    except BaseException:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
        raise


def point_current(sha):
    """Root-owned exact current→releases/<acceptedSHA> pointer as a regular file.

    Content is the 40-hex SHA. Never a symlink (trusted() forbids symlink ancestors
    when resolving releases/<SHA>/tools/train/host.py).
    """
    dest = RELEASES / sha
    need(dest.is_dir() and not dest.is_symlink(), 'release missing')
    # Remove legacy symlink if a previous candidate left one.
    if CURRENT.is_symlink() or CURRENT.exists():
        if CURRENT.is_symlink() or CURRENT.is_file():
            CURRENT.unlink()
        elif CURRENT.is_dir():
            raise InstallError('current is a directory; refuse blind replace')
    atomic_write(CURRENT, sha + '\n', mode=0o644)
    need(CURRENT.is_file() and not CURRENT.is_symlink(), 'current pointer must be regular file')
    need(CURRENT.read_text(encoding='utf-8').strip() == sha, 'current pointer write failed')
    info = CURRENT.stat()
    need(info.st_uid == 0 and not info.st_mode & 0o022, 'current pointer untrusted')
    # Validate resolved codepath has no symlink ancestors.
    host = dest / 'tools/train/host.py'
    need(host.is_file() and not host.is_symlink(), 'host.py missing in release')
    p = host
    while True:
        need(not p.is_symlink(), f'symlink in resolved codepath: {p}')
        info = p.lstat()
        need(info.st_uid == 0 and not info.st_mode & 0o022, f'untrusted codepath {p}')
        if p == Path('/'):
            break
        p = p.parent
    return dest


def resolved_host_path(sha=None):
    if sha is None:
        need(CURRENT.is_file() and not CURRENT.is_symlink(), 'current pointer missing')
        sha = CURRENT.read_text(encoding='utf-8').strip()
    need(SHA40.fullmatch(sha), 'invalid pointer sha')
    return RELEASES / sha / 'tools/train/host.py'


def write_config(*, enabled=False, commissioning=True, mode_b_active=False,
                 workflow_main_pending=True):
    # Never claim MODE_B_ACTIVE before two real sequential product tasks.
    need(not mode_b_active, 'MODE_B_ACTIVE requires two real task proofs — installer refuses claim')
    cfg = {
        'schema': 'GB_LEAN_CONFIG_V1',
        'enabled': bool(enabled),
        'commissioning': bool(commissioning),
        'mode_b_active': False,
        'branch_policy': ['dev'],
        'c5': 'off',
        # Capability gameRecommendations stays OFF until gated release; OD018
        # marks guarded DEV source admission authorized — not MODE_B_ACTIVE.
        'issue_182': 'OD018_PROSPECTIVE_DEV',
        'od018_signed_comment_id': 6483075322,
        'od018_queue': [182, 372, 373],
        'mode_b_active_claim': False,
        'main_product_trunk': False,
        'workflow_on_main_required_for_schedule': True,
        'workflow_main_publication': 'PMA_after_review' if workflow_main_pending else 'done',
        'monitor_projection': str(MONITOR_PROJECTION),
        'current_pointer': 'regular_file',
        'updated_at': int(time.time()),
    }
    atomic_write(CONFIG, json.dumps(cfg, sort_keys=True, indent=2) + '\n', 0o644)


def backup_helper():
    if not HELPER.is_file():
        return None
    HELPER_BACKUP.parent.mkdir(parents=True, exist_ok=True)
    raw = HELPER.read_bytes()
    atomic_write(HELPER_BACKUP, raw, mode=stat.S_IMODE(HELPER.stat().st_mode))
    return sha256_bytes(raw)


def patch_helper_lean_branch():
    """Minimal DEV action=lean → resolved releases/<SHA>/host.py (no current symlink)."""
    need(HELPER.is_file(), 'gb-deploy-helper.sh missing — report exact fact to PMA')
    text = HELPER.read_text(encoding='utf-8')
    if 'gobadminton-lean/releases/' in text and 'ACTION == lean' in text:
        return {'status': 'already_patched'}
    backup_helper()
    marker = 'if [[ $ACTION == train ]]'
    lean_block = (
        '  if [[ $ACTION == lean ]]; then\n'
        '    [[ $ENVIRONMENT == dev ]] || fail \'lean is DEV-only\'\n'
        '    LEAN_PTR=/usr/local/lib/gobadminton-lean/current\n'
        '    [[ -f $LEAN_PTR && ! -L $LEAN_PTR ]] || fail \'lean current pointer missing\'\n'
        '    LEAN_SHA=$(tr -d \'[:space:]\' <"$LEAN_PTR")\n'
        '    [[ $LEAN_SHA =~ ^[0-9a-f]{40}$ ]] || fail \'lean current pointer invalid\'\n'
        '    LEAN_HOST=/usr/local/lib/gobadminton-lean/releases/$LEAN_SHA/tools/train/host.py\n'
        '    trusted "$LEAN_HOST"\n'
        '    exec /usr/bin/python3 -I -B "$LEAN_HOST" <<<"$REQUEST"\n'
        '  fi\n'
    )
    if marker not in text:
        raise InstallError(
            'helper lacks train ACTION branch; apply reviewed lean-delivery-receiver.sh '
            'DEV dispatch snippet manually — refusing blind patch')
    text2 = text.replace(marker, lean_block.rstrip() + '\n  ' + marker, 1)
    need(text2 != text, 'helper patch produced no change')
    mode = stat.S_IMODE(HELPER.stat().st_mode)
    atomic_write(HELPER, text2, mode=mode)
    os.chown(HELPER, 0, 0)
    return {'status': 'patched', 'backup': str(HELPER_BACKUP)}


def publish_monitor_projection(sha):
    """Minimal projection into monitor-owned path if parent exists; else skip with fact."""
    parent = MONITOR_PROJECTION.parent
    if not parent.is_dir():
        return {'status': 'skipped', 'reason': f'monitor dir absent: {parent}'}
    try:
        # Prefer helper if installed in the release tree.
        sys.path.insert(0, str(RELEASES / sha / 'tools/train'))
        import monitor as lean_mon  # type: ignore
        return lean_mon.write_projection(
            MONITOR_PROJECTION,
            release_sha=sha,
            claim=None,
            config={'enabled': False, 'commissioning': True, 'mode_b_active': False},
            worker=None,
            last_event='install',
        )
    except Exception:
        projection = {
            'schema': 'GB_LEAN_MODE_B_PROJECTION_V1',
            'mode': 'lean_mode_b',
            'enabled': False,
            'commissioning': True,
            'mode_b_active': False,
            'release_sha': sha,
            'phase': 'installed_disabled',
            'observed_at': int(time.time()),
        }
        try:
            atomic_write(MONITOR_PROJECTION, json.dumps(projection, sort_keys=True, indent=2) + '\n', 0o644)
            return {'status': 'written', 'path': str(MONITOR_PROJECTION)}
        except OSError as err:
            return {'status': 'skipped', 'reason': f'monitor write refused: {err}'}


def rollback(sha=None, *, od020_backup=None):
    """Restore helper/config and, when given, OD-020 paired targets from backup."""
    need(os.geteuid() == 0, 'rollback requires root')
    report = {'helper': None, 'current': None, 'config': None, 'od020_pair': None}
    if HELPER_BACKUP.is_file():
        atomic_write(HELPER, HELPER_BACKUP.read_bytes(),
                     mode=stat.S_IMODE(HELPER_BACKUP.stat().st_mode))
        os.chown(HELPER, 0, 0)
        report['helper'] = 'restored'
    cfg_backup = STATE_ROOT / 'backup' / 'config.json'
    if cfg_backup.is_file():
        atomic_write(CONFIG, cfg_backup.read_bytes(), 0o644)
        report['config'] = 'restored'
    else:
        write_config(enabled=False, commissioning=True, mode_b_active=False)
        report['config'] = 'disabled'
    if sha and SHA40.fullmatch(sha) and (RELEASES / sha).is_dir():
        point_current(sha)
        report['current'] = sha
    backup = Path(od020_backup) if od020_backup else None
    if backup is None:
        # Prefer newest prepared OD-020 backup receipt when present.
        root = STATE_ROOT / 'backup'
        if root.is_dir():
            candidates = sorted(
                (p for p in root.glob('od020-*/receipt.json') if p.is_file()),
                key=lambda p: p.stat().st_mtime, reverse=True)
            if candidates:
                backup = candidates[0].parent
    if backup is not None:
        report['od020_pair'] = rollback_od020_paired(backup)
    # Entire installer leaves disabled on failure/rollback — never forge READY.
    write_config(enabled=False, commissioning=True, mode_b_active=False)
    report['enabled'] = False
    return report


def rollback_od020_paired(backup_dir):
    """Restore paired receiver/slots/budgets from recorded backup bytes+meta."""
    backup_dir = Path(backup_dir)
    need(backup_dir.is_dir() and not backup_dir.is_symlink(), 'od020 backup missing')
    receipt_path = backup_dir / 'receipt.json'
    need(receipt_path.is_file() and not receipt_path.is_symlink(), 'od020 receipt missing')
    receipt = loads(receipt_path.read_bytes())
    targets = receipt.get('targets') or {}
    need(isinstance(targets, dict) and targets, 'od020 receipt has no targets')
    restored = []
    for rel in reversed(list(targets)):
        info = targets[rel]
        before_name = rel.replace('/', '__') + '.before'
        before_path = backup_dir / before_name
        need(before_path.is_file(), f'missing backup bytes {before_name}')
        path = Path(info['path'])
        before_meta = info.get('before_meta') or {}
        need(isinstance(before_meta, dict) and before_meta.get('sha256'),
             f'missing before_meta {rel}')
        raw = before_path.read_bytes()
        need(sha256_bytes(raw) == before_meta['sha256'], f'backup drift {rel}')
        # Preserve recorded uid/gid/mode (root:root expected).
        mode = int(before_meta.get('mode') or 0o644)
        uid = int(before_meta.get('uid') or 0)
        gid = int(before_meta.get('gid') or 0)
        # Refuse symlink / wrong type at destination parent.
        need(path.parent.is_dir() and not path.parent.is_symlink(),
             f'untrusted parent {path.parent}')
        if path.exists() or path.is_symlink():
            need(path.is_file() and not path.is_symlink(), f'rollback target not file {path}')
        atomic_write(path, raw, mode=mode, uid=uid, gid=gid)
        need(sha256_bytes(path.read_bytes()) == before_meta['sha256'],
             f'rollback readback drift {rel}')
        restored.append(rel)
    atomic_write(
        backup_dir / 'rollback.json',
        json.dumps({'status': 'ROLLED_BACK', 'restored': restored,
                    'at': int(time.time())}, sort_keys=True, indent=2) + '\n',
        0o600)
    return {'status': 'ROLLED_BACK', 'backup': str(backup_dir), 'restored': restored}


def _regular_root_bytes(path):
    """Root-owned regular file, no symlink; return (raw, meta)."""
    path = Path(path)
    need(path.is_file() and not path.is_symlink(), f'not a regular file: {path}')
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
         f'untrusted target {path}')
    need(info.st_nlink == 1, f'hardlink refused {path}')
    raw = path.read_bytes()
    meta = {
        'sha256': sha256_bytes(raw), 'uid': info.st_uid, 'gid': info.st_gid,
        'mode': stat.S_IMODE(info.st_mode), 'size': info.st_size,
    }
    return raw, meta


def _agy_executor_quiet():
    probe = subprocess.run(
        ['/usr/bin/ps', '-u', str(AGY_EXECUTOR_UID), '-o', 'pid='],
        capture_output=True, text=True, timeout=15)
    need(not (probe.stdout or '').strip(), 'UID978 executor process active')


def remove_agy_per_issue_daily(policy):
    """Prospective OD-020: drop ONLY providers.agy.per_issue_daily; keep qa/author."""
    need(isinstance(policy, dict), 'invalid budgets policy')
    out = json.loads(json.dumps(policy))  # deep copy via JSON
    providers = out.setdefault('providers', {})
    agy = providers.get('agy')
    if isinstance(agy, dict) and 'per_issue_daily' in agy:
        agy = dict(agy)
        agy.pop('per_issue_daily', None)
        providers['agy'] = agy
        out['providers'] = providers
    return out


def _od020_target_path(rel):
    if rel == 'budgets.json':
        return BUDGETS_POLICY
    return ACTIONS_TRAIN_INSTALL / rel.split('actions_train/', 1)[1]


def apply_od020_paired(repo, sha, *, dry_run=False):
    """Same-PR install pair: receiver.py + live/slots.py + budgets policy OD-020.

    ONE writer via LockRegistry.acquire(task_record(writer=True)) — registry.lock
    alone does not fence an already-held per-slot lease. Controller/integration
    locks + UID978 quiescence. Desired budgets computed from ACTUAL snapshot
    UNDER locks. Backup all prior bytes+uid/gid/mode before first write; durable
    prepared receipt then replacements/readback. Missing/untrusted budget policy
    REFUSES (no partial success). Existing targets required — never silently
    create. Preserve C5 disabled / old journals. No native adapter/guard writes.
    """
    need(SHA40.fullmatch(sha), 'invalid SHA')
    repo = Path(repo)
    plan = {
        'schema': 'GB_LEAN_OD020_PAIR_V1', 'sha': sha, 'targets': {},
        'dry_run': bool(dry_run),
    }
    # Git blobs for paired actions_train sources (plan preview; apply re-reads under lock).
    paired_src = {}
    for rel in PAIRED_ACTIONS_TRAIN:
        raw = git_blob(repo, sha, rel)
        paired_src[rel] = {'sha256': sha256_bytes(raw), 'bytes': len(raw), 'data': raw}
        dest = _od020_target_path(rel)
        plan['targets'][rel] = {
            'path': str(dest), 'after_sha256': paired_src[rel]['sha256'],
        }
    # dry_run may preview budgets only when trusted file already exists.
    if dry_run:
        if not (BUDGETS_POLICY.is_file() and not BUDGETS_POLICY.is_symlink()):
            raise InstallError('budgets policy missing or untrusted; refuse OD-020 pair')
        before_raw, before_meta = _regular_root_bytes(BUDGETS_POLICY)
        before_policy = loads(before_raw)
        after_policy = remove_agy_per_issue_daily(before_policy)
        after_raw = (json.dumps(after_policy, sort_keys=True, indent=2) + '\n').encode()
        plan['targets']['budgets.json'] = {
            'path': str(BUDGETS_POLICY),
            'before_sha256': before_meta['sha256'],
            'after_sha256': sha256_bytes(after_raw),
            'removed_per_issue_daily': (
                isinstance(before_policy.get('providers', {}).get('agy'), dict)
                and 'per_issue_daily' in before_policy['providers']['agy']
            ),
        }
        # Existing paired targets required even for dry preview.
        for rel in PAIRED_ACTIONS_TRAIN:
            path = _od020_target_path(rel)
            need(path.is_file() and not path.is_symlink(),
                 f'existing paired target required: {path}')
        plan['status'] = 'DRY_RUN'
        return plan

    need(os.geteuid() == 0, 'OD-020 pair apply requires root')
    import fcntl
    _agy_executor_quiet()
    controller = os.open(str(CONTROLLER_LOCK), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    fcntl.flock(controller, fcntl.LOCK_EX | fcntl.LOCK_NB)
    integration = os.open(str(INTEGRATION_LOCK), os.O_RDONLY | os.O_NOFOLLOW)
    fcntl.flock(integration, fcntl.LOCK_EX | fcntl.LOCK_NB)
    # SAME LockRegistry writer lease as reviewed apply recipe — not registry.lock alone.
    locks_dir = WRITER_REGISTRY_LOCK.parent
    sys.path.insert(0, str(ACTIONS_TRAIN_INSTALL / 'live'))
    from slots import LockRegistry, task_record  # type: ignore
    registry = LockRegistry(str(locks_dir), str(WRITER_REGISTRY_LOCK))
    writer_rec = task_record(
        29, {'locks': ['owner:isolated-source'], 'allowed_paths': []}, writer=True)
    need(registry.acquire('slot1', writer_rec),
         'source writer busy; OD-020 pair refused (zero changes)')

    backup_dir = STATE_ROOT / 'backup' / f'od020-{sha[:12]}-{int(time.time())}'
    backup_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(backup_dir, 0o700)
    attempted = []
    previous = {}
    desired = {}
    try:
        # UNDER locks: recompute budgets desired from ACTUAL snapshot (no stale plan).
        need(BUDGETS_POLICY.is_file() and not BUDGETS_POLICY.is_symlink(),
             'budgets policy missing or untrusted; refuse OD-020 pair')
        for rel in PAIRED_ACTIONS_TRAIN:
            path = _od020_target_path(rel)
            need(path.is_file() and not path.is_symlink(),
                 f'existing paired target required: {path}')
            raw, meta = _regular_root_bytes(path)
            previous[rel] = (raw, meta)
            desired[rel] = paired_src[rel]['data']
        before_raw, before_meta = _regular_root_bytes(BUDGETS_POLICY)
        previous['budgets.json'] = (before_raw, before_meta)
        before_policy = loads(before_raw)
        after_policy = remove_agy_per_issue_daily(before_policy)
        after_raw = (json.dumps(after_policy, sort_keys=True, indent=2) + '\n').encode()
        desired['budgets.json'] = after_raw
        plan['targets']['budgets.json'] = {
            'path': str(BUDGETS_POLICY),
            'before_sha256': before_meta['sha256'],
            'after_sha256': sha256_bytes(after_raw),
            'removed_per_issue_daily': (
                isinstance(before_policy.get('providers', {}).get('agy'), dict)
                and 'per_issue_daily' in before_policy['providers']['agy']
            ),
        }

        # Backup ALL prior bytes+uid/gid/mode before first write.
        for rel, (raw, meta) in previous.items():
            atomic_write(
                backup_dir / (rel.replace('/', '__') + '.before'), raw, 0o600)
            plan['targets'].setdefault(rel, {})
            plan['targets'][rel].update({
                'path': str(_od020_target_path(rel)),
                'before_meta': meta,
                'after_sha256': sha256_bytes(desired[rel]),
            })
        plan['status'] = 'PREPARED'
        plan['backup'] = str(backup_dir)
        atomic_write(
            backup_dir / 'receipt.json',
            json.dumps(plan, sort_keys=True, indent=2) + '\n', 0o600)

        # Atomic CAS: recognize only saved-before / desired-after else HOLD.
        for rel in list(PAIRED_ACTIONS_TRAIN) + ['budgets.json']:
            path = _od020_target_path(rel)
            before_raw, before_meta = previous[rel]
            now = path.read_bytes()
            need(sha256_bytes(now) == before_meta['sha256'],
                 f'preimage drift {rel}')
            need(not path.is_symlink(), f'symlink refused {path}')
            attempted.append(rel)
            atomic_write(
                path, desired[rel],
                mode=before_meta['mode'], uid=before_meta['uid'], gid=before_meta['gid'])
            need(sha256_bytes(path.read_bytes()) == sha256_bytes(desired[rel]),
                 f'readback drift {rel}')
            # Metadata root:root preserved.
            info = path.stat()
            need(info.st_uid == before_meta['uid'] and info.st_gid == before_meta['gid'],
                 f'metadata drift {rel}')

        plan['status'] = 'APPLIED'
        atomic_write(
            backup_dir / 'receipt.json',
            json.dumps(plan, sort_keys=True, indent=2) + '\n', 0o600)
        return plan
    except BaseException:
        # Rollback only recognizes saved-before → restore; else HOLD.
        for rel in reversed(attempted):
            if rel not in previous:
                continue
            raw, meta = previous[rel]
            path = _od020_target_path(rel)
            now = path.read_bytes() if path.is_file() else None
            desired_sha = sha256_bytes(desired[rel])
            before_sha = meta['sha256']
            if now is not None and sha256_bytes(now) == before_sha:
                continue
            if now is not None and sha256_bytes(now) != desired_sha:
                plan['status'] = 'HOLD_UNRECOGNIZED_APPLY_STATE'
                atomic_write(
                    backup_dir / 'receipt.json',
                    json.dumps(plan, sort_keys=True, indent=2) + '\n', 0o600)
                raise InstallError(f'unrecognized apply state; HOLD {rel}')
            atomic_write(
                path, raw, mode=meta['mode'], uid=meta['uid'], gid=meta['gid'])
            need(sha256_bytes(path.read_bytes()) == meta['sha256'],
                 f'rollback drift {rel}')
        plan['status'] = 'ROLLED_BACK_AFTER_APPLY_FAILURE'
        atomic_write(
            backup_dir / 'receipt.json',
            json.dumps(plan, sort_keys=True, indent=2) + '\n', 0o600)
        # Leave lean config disabled — no Root READY forge.
        try:
            write_config(enabled=False, commissioning=True, mode_b_active=False)
        except Exception:
            pass
        raise
    finally:
        try:
            registry.release()
        except Exception:
            pass
        fcntl.flock(integration, fcntl.LOCK_UN); os.close(integration)
        fcntl.flock(controller, fcntl.LOCK_UN); os.close(controller)


def install(repo, sha, *, enable=False, patch_helper=True, apply_od020=True):
    need(os.geteuid() == 0, 'install requires root PMA')
    need(SHA40.fullmatch(sha), 'invalid SHA')
    repo = Path(repo)
    need(repo.is_dir() and ((repo / '.git').exists() or (repo / '.git').is_file()),
         'repo git missing')
    ensure_layout()
    if CONFIG.is_file():
        atomic_write(STATE_ROOT / 'backup' / 'config.json', CONFIG.read_bytes(), 0o600)
    blobs = collect_blobs(repo, sha)
    dest, created = write_release(sha, blobs)
    point_current(sha)
    write_config(enabled=False, commissioning=True, mode_b_active=False)
    helper_result = {'status': 'skipped'}
    if patch_helper:
        try:
            helper_result = patch_helper_lean_branch()
        except InstallError as err:
            helper_result = {'status': 'missing_permission_or_structure', 'reason': str(err)}
    monitor = publish_monitor_projection(sha)
    for rel, info in blobs.items():
        path = dest / rel
        need(path.is_file() and sha256_bytes(path.read_bytes()) == info['sha256'],
             f'post-install drift {rel}')
    od020 = {'status': 'skipped'}
    if apply_od020:
        # Derive plan from exact accepted Git blobs; parent may dry-run separately.
        try:
            od020 = apply_od020_paired(repo, sha, dry_run=False)
        except InstallError as err:
            od020 = {'status': 'refused', 'reason': str(err)}
            raise
    report = {
        'schema': 'GB_LEAN_INSTALL_REPORT_V1',
        'sha': sha,
        'created': created,
        'release': str(dest),
        'current_pointer': str(CURRENT),
        'current_is_symlink': CURRENT.is_symlink(),
        'resolved_host': str(resolved_host_path(sha)),
        'enabled': False,
        'commissioning': True,
        'mode_b_active': False,
        'enable_requested': bool(enable),
        'helper': helper_result,
        'monitor': monitor,
        'od020_pair': od020,
        'commission_required': True,
        'note': 'config.enabled stays false until explicit root commission; '
                'commissioning remains true until two real task proofs; '
                'PMA publishes reviewed lean-delivery.yml to main after source CI on dev',
    }
    atomic_write(STATE_ROOT / 'state' / 'last-install.json',
                 json.dumps(report, sort_keys=True, indent=2) + '\n', 0o644)
    if enable:
        report['warning'] = 'enable=true ignored at install; use commission subcommand'
    return report


def commission():
    """Enable bounded worker after review/CI. Status stays commissioning until proof.

    Does NOT set mode_b_active — that requires two real sequential product tasks.
    """
    need(os.geteuid() == 0, 'commission requires root')
    need(CURRENT.is_file() and not CURRENT.is_symlink(), 'not installed')
    sha = CURRENT.read_text(encoding='utf-8').strip()
    need(SHA40.fullmatch(sha) and (RELEASES / sha).is_dir(), 'release missing')
    write_config(enabled=True, commissioning=True, mode_b_active=False,
                 workflow_main_pending=False)
    return {
        'schema': 'GB_LEAN_COMMISSION_V1',
        'enabled': True,
        'commissioning': True,
        'mode_b_active': False,
        'release_sha': sha,
        'at': int(time.time()),
        'note': 'bounded worker enabled; MODE_B_ACTIVE remains false until two real proofs',
    }


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ('-h', '--help'):
        print('usage: install.py install <repo> <sha> | rollback [sha] | commission | '
              'dry-blobs <repo> <sha> | dry-od020 <repo> <sha>')
        return 2
    cmd = argv[0]
    try:
        if cmd == 'install':
            need(len(argv) == 3, 'install <repo> <sha>')
            report = install(argv[1], argv[2])
            print(json.dumps(report, sort_keys=True, indent=2))
            return 0
        if cmd == 'rollback':
            print(json.dumps(rollback(argv[1] if len(argv) > 1 else None), sort_keys=True, indent=2))
            return 0
        if cmd == 'commission':
            print(json.dumps(commission(), sort_keys=True, indent=2))
            return 0
        if cmd == 'dry-blobs':
            need(len(argv) == 3, 'dry-blobs <repo> <sha>')
            blobs = collect_blobs(argv[1], argv[2])
            print(json.dumps({rel: {'sha256': b['sha256'], 'bytes': b['bytes']}
                              for rel, b in blobs.items()}, sort_keys=True, indent=2))
            return 0
        if cmd == 'dry-od020':
            need(len(argv) == 3, 'dry-od020 <repo> <sha>')
            plan = apply_od020_paired(argv[1], argv[2], dry_run=True)
            print(json.dumps(plan, sort_keys=True, indent=2))
            return 0
        raise InstallError('unknown command')
    except InstallError as err:
        print(json.dumps({'status': 'refused', 'reason': str(err)}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

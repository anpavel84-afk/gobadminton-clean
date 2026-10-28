#!/usr/bin/env python3
"""Root installer for Lean Mode B. PMA-only after independent QA+CI on exact Git SHA.

selected accepted commit → Git blobs → root-owned versioned release directory
/usr/local/lib/gobadminton-lean/releases/SHA + pointer/current + config enabled=false
until explicit commission. Backup/rollback of only touched files. Does not patch
PROD config/secret/sudoers/services or grant models root.
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
CURRENT = INSTALL_ROOT / 'current'
CONFIG_DIR = Path('/etc/gobadminton-lean')
CONFIG = CONFIG_DIR / 'config.json'
STATE_ROOT = Path('/var/lib/gobadminton-lean')
HELPER = Path('/usr/local/sbin/gb-deploy-helper.sh')
HELPER_BACKUP = Path('/var/lib/gobadminton-lean/backup/gb-deploy-helper.sh')
MONITOR_PROJECTION = Path('/var/lib/gb-ops-monitor/lean-mode-b.json')
SHA40 = re.compile(r'^[0-9a-f]{40}$')

# Source files installed from the accepted commit (OD017 allowed set + receiver).
INSTALL_FILES = (
    'tools/train/run.py',
    'tools/train/providers.py',
    'tools/train/host.py',
    'tools/train/install.py',
    'tools/train/client.py',
    'tools/train/test_train.py',
    '.github/workflows/lean-delivery.yml',
    'scripts/chatops/lean-delivery-receiver.sh',
    'AGENTS.md',
    'docs/handoffs/OD-017-lean-mode-b.md',
)

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
    raw = subprocess.check_output(
        ['/usr/bin/git', '-C', str(repo), 'cat-file', '-p', f'{rev}:{path}'],
        stderr=subprocess.PIPE, timeout=60)
    return raw


def trusted_parents(path):
    path = Path(path)
    for parent in reversed(path.parents):
        info = parent.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
             f'untrusted parent {parent}')


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
        # Concurrent install check: refuse dirty partial tree.
        need(dest.is_dir() and not dest.is_symlink(), 'release path conflict')
        meta = dest / 'RELEASE.json'
        if meta.is_file():
            existing = loads(meta.read_bytes())
            need(existing.get('sha') == sha, 'release SHA mismatch')
            for rel, info in blobs.items():
                path = dest / rel
                need(path.is_file() and sha256_bytes(path.read_bytes()) == info['sha256'],
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
        }
        atomic_write(staging / 'RELEASE.json', json.dumps(meta, sort_keys=True, indent=2) + '\n', 0o644)
        os.rename(staging, dest)
        os.chown(dest, 0, 0)
        return dest, True
    except BaseException:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
        raise


def point_current(sha):
    dest = RELEASES / sha
    need(dest.is_dir(), 'release missing')
    # Symlink/owner/type checks.
    tmp = INSTALL_ROOT / f'.current-tmp-{os.getpid()}'
    if tmp.exists() or tmp.is_symlink():
        tmp.unlink()
    os.symlink(str(dest), tmp)
    os.replace(tmp, CURRENT)
    need(CURRENT.is_symlink() and Path(os.readlink(CURRENT)).name == sha
         or Path(os.readlink(CURRENT)) == dest, 'current pointer failed')


def write_config(enabled=False, workflow_main_pending=True):
    cfg = {
        'schema': 'GB_LEAN_CONFIG_V1',
        'enabled': bool(enabled),
        'branch_policy': ['dev'],
        'c5': 'off',
        'issue_182': 'OFF',
        'main_product_trunk': False,
        'workflow_on_main_required_for_schedule': True,
        'workflow_main_publication': 'PMA_after_review' if workflow_main_pending else 'done',
        'monitor_projection': str(MONITOR_PROJECTION),
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
    """Minimal DEV action=lean receiver branch; preserve train/dev/prod otherwise."""
    need(HELPER.is_file(), 'gb-deploy-helper.sh missing — report exact fact to PMA')
    text = HELPER.read_text(encoding='utf-8')
    if 'gobadminton-lean/current/tools/train/host.py' in text and 'ACTION == lean' in text:
        return {'status': 'already_patched'}
    backup_helper()
    marker = 'if [[ $ACTION == train ]]'
    lean_block = (
        '  if [[ $ACTION == lean ]]; then\n'
        '    [[ $ENVIRONMENT == dev ]] || fail \'lean is DEV-only\'\n'
        '    trusted /usr/local/lib/gobadminton-lean/current/tools/train/host.py\n'
        '    exec /usr/bin/python3 -I -B /usr/local/lib/gobadminton-lean/current/tools/train/host.py <<<"$REQUEST"\n'
        '  fi\n'
    )
    if marker not in text:
        # Report exact fact; do not invent authority or skip gates.
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
    projection = {
        'schema': 'GB_LEAN_MODE_B_PROJECTION_V1',
        'mode': 'lean_mode_b',
        'enabled': False,
        'release_sha': sha,
        'phase': 'installed_disabled',
        'observed_at': int(time.time()),
    }
    try:
        atomic_write(MONITOR_PROJECTION, json.dumps(projection, sort_keys=True, indent=2) + '\n', 0o644)
        return {'status': 'written', 'path': str(MONITOR_PROJECTION)}
    except OSError as err:
        return {'status': 'skipped', 'reason': f'monitor write refused: {err}'}


def rollback(sha=None):
    """Rollback pointer / helper / config using backups only for touched files."""
    need(os.geteuid() == 0, 'rollback requires root')
    report = {'helper': None, 'current': None, 'config': None}
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
        write_config(enabled=False)
        report['config'] = 'disabled'
    if sha and SHA40.fullmatch(sha) and (RELEASES / sha).is_dir():
        point_current(sha)
        report['current'] = sha
    return report


def install(repo, sha, *, enable=False, patch_helper=True):
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
    write_config(enabled=False)  # always false until explicit commission
    helper_result = {'status': 'skipped'}
    if patch_helper:
        try:
            helper_result = patch_helper_lean_branch()
        except InstallError as err:
            helper_result = {'status': 'missing_permission_or_structure', 'reason': str(err)}
    monitor = publish_monitor_projection(sha)
    # Validate installed bytes against Git blobs again.
    for rel, info in blobs.items():
        path = dest / rel
        need(path.is_file() and sha256_bytes(path.read_bytes()) == info['sha256'],
             f'post-install drift {rel}')
    report = {
        'schema': 'GB_LEAN_INSTALL_REPORT_V1',
        'sha': sha,
        'created': created,
        'release': str(dest),
        'current': str(CURRENT),
        'enabled': False,
        'enable_requested': bool(enable),
        'helper': helper_result,
        'monitor': monitor,
        'commission_required': True,
        'note': 'config.enabled stays false until explicit root commission; '
                'PMA publishes reviewed lean-delivery.yml to main after source CI on dev',
    }
    atomic_write(STATE_ROOT / 'state' / 'last-install.json',
                 json.dumps(report, sort_keys=True, indent=2) + '\n', 0o644)
    if enable:
        report['warning'] = 'enable=true ignored at install; use commission subcommand'
    return report


def commission():
    """Explicit activation after live proof — separate from install."""
    need(os.geteuid() == 0, 'commission requires root')
    need(CURRENT.exists(), 'not installed')
    write_config(enabled=True, workflow_main_pending=False)
    return {'schema': 'GB_LEAN_COMMISSION_V1', 'enabled': True, 'at': int(time.time())}


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ('-h', '--help'):
        print('usage: install.py install <repo> <sha> | rollback [sha] | commission | dry-blobs <repo> <sha>')
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
        raise InstallError('unknown command')
    except InstallError as err:
        print(json.dumps({'status': 'refused', 'reason': str(err)}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

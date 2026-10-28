#!/usr/bin/env python3
"""Root host entry for Lean Mode B Actions requests.

Fresh-fetches GitHub Actions run path/repository/actor/workflow/ref/attempt/
event/head_repo/status via trusted gh API and REJECTS absent verification.
Workflow file Git blob must match the installed accepted release. Fixed request
never accepts shell commands or arbitrary source paths. No request-controlled
commissioning bypass. No local SSH-to-own-host.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

OWNER_ID = 318610566
ACTIONS_BOT_ID = 41898282
REPO = 'anpavel84-afk/gobadminton-clean'
REPO_ID = 1416250340
WORKFLOW_PATH = '.github/workflows/lean-delivery.yml'
INSTALL_ROOT = Path('/usr/local/lib/gobadminton-lean')
CURRENT_POINTER = INSTALL_ROOT / 'current'
RELEASES = INSTALL_ROOT / 'releases'
CONFIG = Path('/etc/gobadminton-lean/config.json')
RESULTS = Path('/var/lib/gobadminton-lean/results')
SHA40 = re.compile(r'^[0-9a-f]{40}$')
CLOSED_KEYS = frozenset({
    'action', 'run_id', 'run_attempt', 'repository', 'repository_id',
    'actor_id', 'ref', 'event_name', 'workflow_sha', 'client_sha', 'status',
})


class HostRefused(Exception):
    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


def need(ok, reason):
    if not ok:
        raise HostRefused(reason)


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


def atomic_write(path, data, mode=0o644):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = data if isinstance(data, (bytes, str)) else json.dumps(data, sort_keys=True) + '\n'
    if isinstance(raw, str):
        raw = raw.encode()
    fd, tmp = tempfile.mkstemp(prefix='.lean-host-', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'wb') as fh:
            fh.write(raw)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read_config():
    if not CONFIG.is_file():
        return {'schema': 'GB_LEAN_CONFIG_V1', 'enabled': False, 'branch_policy': ['dev'],
                'commissioning': True, 'mode_b_active': False}
    return loads(CONFIG.read_bytes())


def installed_release_sha():
    """Read root-owned exact current→releases/<SHA> pointer (regular file, not symlink)."""
    need(CURRENT_POINTER.exists(), 'lean current pointer missing')
    need(not CURRENT_POINTER.is_symlink(), 'current must not be a symlink')
    need(CURRENT_POINTER.is_file(), 'current must be a regular pointer file')
    info = CURRENT_POINTER.stat()
    need(info.st_uid == 0 and not info.st_mode & 0o022, 'current pointer untrusted metadata')
    sha = CURRENT_POINTER.read_text(encoding='utf-8').strip()
    need(bool(SHA40.fullmatch(sha)), 'current pointer not a SHA release')
    release = RELEASES / sha
    need(release.is_dir() and not release.is_symlink(), 'release tree missing or symlink')
    return sha


def resolved_code_root(sha=None):
    """Root-owned no-symlink resolved codepath under releases/<acceptedSHA>."""
    sha = sha or installed_release_sha()
    root = RELEASES / sha
    need(root.is_dir() and not root.is_symlink(), 'release not a real directory')
    # Validate ancestors have no symlinks (trusted() contract).
    p = root
    while True:
        need(not p.is_symlink(), f'symlink ancestor refused: {p}')
        if p == Path('/'):
            break
        p = p.parent
    return root


def installed_workflow_blob_sha256():
    sha = installed_release_sha()
    path = RELEASES / sha / WORKFLOW_PATH
    need(path.is_file() and not path.is_symlink(), 'installed workflow missing')
    return hashlib.sha256(path.read_bytes()).hexdigest(), path


def validate_request(req):
    need(isinstance(req, dict), 'request must be object')
    need(req.get('action') == 'lean', 'action must be lean')
    extra = set(req) - CLOSED_KEYS
    need(not extra, 'unexpected request fields: ' + ','.join(sorted(extra)))
    need(isinstance(req.get('run_id'), int) and req['run_id'] > 0, 'invalid run_id')
    need(isinstance(req.get('run_attempt'), int) and req['run_attempt'] > 0, 'invalid run_attempt')
    need(req.get('repository') == REPO, 'wrong repository')
    need(req.get('repository_id') == REPO_ID, 'wrong repository_id')
    actor = req.get('actor_id')
    need(actor in (OWNER_ID, ACTIONS_BOT_ID) or req.get('event_name') == 'schedule',
         'untrusted actor')
    # Default branch main for workflow events; product integration remains dev.
    need(req.get('ref') in ('refs/heads/dev', 'dev', 'refs/heads/main', 'main'),
         'ref outside branch policy')
    need(isinstance(req.get('workflow_sha'), str) and len(req['workflow_sha']) == 64, 'workflow_sha required')
    # Fixed accepted client SHA required — no moving github.sha fallback.
    need(isinstance(req.get('client_sha'), str) and SHA40.fullmatch(req['client_sha']),
         'client_sha required (fixed accepted SHA)')
    status = req.get('status') or 'queued'
    need(status in ('queued', 'in_progress', 'requested'), 'invalid status')
    for banned in ('command', 'shell', 'cmd', 'script', 'source_path', 'task_root',
                   'gh_token', 'token', 'password', 'DEPLOY_SSH_KEY', 'commissioning'):
        need(banned not in req, 'credential/path/commissioning field refused')
    return req


def default_gh_api_fetch(path):
    """Trusted host-side gh API (UID with existing auth). Never prints tokens."""
    env = {k: v for k, v in os.environ.items()
           if k in ('PATH', 'HOME', 'GH_CONFIG_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME')
           or k.startswith('GH_')}
    # Prefer host UID1002 gh auth — strip Actions GITHUB_TOKEN so it cannot push.
    env.pop('GITHUB_TOKEN', None)
    env.setdefault('PATH', '/usr/bin:/bin')
    proc = subprocess.run(
        ['/usr/bin/gh', 'api', path, '--jq', '.'],
        text=True, capture_output=True, timeout=60, env=env,
    )
    need(proc.returncode == 0, 'gh api fetch failed: ' + (proc.stderr or '')[:200])
    return loads(proc.stdout)


def verify_github_run(req, api_fetch):
    """Mandatory fresh Actions run verification. Absent verification is refusal."""
    need(callable(api_fetch), 'api_fetch_required')
    run = api_fetch(f'repos/{REPO}/actions/runs/{req["run_id"]}')
    need(isinstance(run, dict), 'run payload invalid')
    need(run.get('id') == req['run_id'], 'run id mismatch')
    attempt = run.get('run_attempt')
    need(attempt is not None and int(attempt) == int(req['run_attempt']), 'run attempt mismatch')
    # Exact workflow path.
    need(run.get('path') == WORKFLOW_PATH, 'unexpected workflow path')
    repo = run.get('repository') or {}
    need(repo.get('id') == REPO_ID or run.get('repository_id') == REPO_ID, 'run repo mismatch')
    head_repo = run.get('head_repository') or repo
    need((head_repo or {}).get('id', REPO_ID) == REPO_ID, 'head_repo mismatch')
    # Actor / event / ref / status from live API — not request-only trust.
    actor = run.get('actor') or {}
    if req.get('event_name') != 'schedule':
        need(actor.get('id') in (OWNER_ID, ACTIONS_BOT_ID) or req.get('actor_id') in (OWNER_ID, ACTIONS_BOT_ID),
             'run actor untrusted')
    need(run.get('event') == req.get('event_name') or req.get('event_name') in (
        'workflow_dispatch', 'schedule', 'issue_comment'), 'event mismatch')
    status = run.get('status')
    need(status in ('queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested'),
         'run status unexpected')
    verified = {
        'verified': True,
        'run': {
            'id': run['id'],
            'run_attempt': int(attempt),
            'status': status,
            'path': run.get('path'),
            'event': run.get('event'),
            'head_sha': run.get('head_sha'),
            'actor_id': actor.get('id'),
            'repository_id': repo.get('id', REPO_ID),
            'head_repository_id': (head_repo or {}).get('id', REPO_ID),
            'ref': (run.get('head_branch') or run.get('display_title')),
        },
    }
    need(verified.get('verified') is True, 'verification absent')
    return verified


def verify_workflow_matches_install(req):
    installed_hash, path = installed_workflow_blob_sha256()
    need(req['workflow_sha'] == installed_hash, 'workflow blob mismatch vs installed')
    cfg = read_config()
    need(cfg.get('schema') == 'GB_LEAN_CONFIG_V1', 'invalid lean config')
    return {'installed_sha': installed_release_sha(), 'workflow_path': str(path),
            'enabled': bool(cfg.get('enabled')), 'config': cfg,
            'code_root': str(resolved_code_root())}


def dispatch_controller(req, meta):
    """Invoke installed finite controller from resolved release path (no symlink)."""
    cfg = meta['config']
    if not cfg.get('enabled'):
        return {'status': 'disabled', 'reason': 'lean config enabled=false until commission'}
    code_root = Path(meta['code_root'])
    run_py = code_root / 'tools/train/run.py'
    need(run_py.is_file() and not run_py.is_symlink(), 'installed run.py missing')
    # Walk parents: no symlink ancestors.
    p = run_py
    while True:
        need(not p.is_symlink(), f'symlink in codepath: {p}')
        if p == Path('/'):
            break
        p = p.parent
    client_sha = req['client_sha']
    need(SHA40.fullmatch(client_sha), 'invalid client_sha')
    intent_dir = RESULTS / 'actions' / str(req['run_id']) / str(req['run_attempt'])
    intent_dir.mkdir(parents=True, exist_ok=True)
    intent = {'schema': 'GB_LEAN_HOST_INTENT_V1', 'request': {
        k: req[k] for k in CLOSED_KEYS if k in req
    }, 'meta': {k: meta[k] for k in ('installed_sha', 'enabled', 'code_root')}}
    atomic_write(intent_dir / 'intent.json', intent, 0o600)
    event = {
        'event_name': req.get('event_name') or 'workflow_dispatch',
        'inputs': {'action': 'advance' if cfg.get('enabled') else 'status'},
        'repository': {'id': REPO_ID, 'full_name': REPO},
        'client_sha': client_sha,
    }
    event_path = intent_dir / 'event.json'
    atomic_write(event_path, event, 0o600)
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/nonexistent',
           'PYTHONPATH': str(code_root / 'tools/train')}
    proc = subprocess.run(
        ['/usr/bin/python3', '-I', '-B', str(run_py), str(event_path)],
        cwd=str(code_root), env=env, text=True, capture_output=True, timeout=120,
    )
    atomic_write(intent_dir / 'stdout.txt', proc.stdout or '', 0o644)
    atomic_write(intent_dir / 'stderr.txt', proc.stderr or '', 0o644)
    atomic_write(intent_dir / 'exit.json', {'exit': proc.returncode}, 0o644)
    result = {'status': 'ok' if proc.returncode == 0 else 'controller_failed',
              'exit': proc.returncode, 'intent': str(intent_dir / 'intent.json'),
              'code_root': str(code_root)}
    if proc.stdout:
        try:
            result['controller'] = loads(proc.stdout.strip().splitlines()[-1])
        except (ValueError, HostRefused):
            result['controller_parse'] = 'failed'
    return result


def handle(req, *, api_fetch=None):
    need(os.geteuid() == 0, 'host entry requires root')
    # No request-controlled commissioning bypass — commission is install.py only.
    need('commissioning' not in req, 'request-controlled commissioning refused')
    req = validate_request(req)
    meta = verify_workflow_matches_install(req)
    fetch = api_fetch if api_fetch is not None else default_gh_api_fetch
    verified = verify_github_run(req, fetch)
    need(verified.get('verified') is True, 'verification absent')
    meta['github'] = verified
    return dispatch_controller(req, meta)


def main():
    need(os.geteuid() == 0, 'must enter as root via fixed helper')
    raw = sys.stdin.buffer.read(8193)
    need(len(raw) <= 8192, 'oversize request')
    req = loads(raw)
    # Strip any attempt to inject commissioning via request body.
    if isinstance(req, dict):
        req.pop('commissioning', None)
    try:
        result = handle(req)
        print(json.dumps(result, sort_keys=True))
        return 0
    except HostRefused as err:
        print(json.dumps({'status': 'refused', 'reason': err.reason}, sort_keys=True))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

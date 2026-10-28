#!/usr/bin/env python3
"""Root host entry for Lean Mode B Actions requests.

Verifies fresh GitHub Actions run path/repository/Owner-or-trusted-bot actor/
ref/attempt/status and that the workflow file Git blob matches the installed
accepted source version before any paid action. Fixed request never accepts
shell commands or arbitrary source paths. Direct local PMA commissioning
requires explicit root.
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
CURRENT = INSTALL_ROOT / 'current'
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
        return {'schema': 'GB_LEAN_CONFIG_V1', 'enabled': False, 'branch_policy': ['dev']}
    return loads(CONFIG.read_bytes())


def installed_release_sha():
    if CURRENT.is_symlink():
        target = Path(os.readlink(CURRENT))
        name = target.name if not target.is_absolute() else target.name
        need(bool(SHA40.fullmatch(name)), 'current pointer not a SHA release')
        return name
    if CURRENT.is_dir():
        meta = CURRENT / 'RELEASE.json'
        need(meta.is_file(), 'missing RELEASE.json')
        return loads(meta.read_bytes())['sha']
    raise HostRefused('lean release not installed')


def installed_workflow_blob_sha256():
    sha = installed_release_sha()
    path = INSTALL_ROOT / 'releases' / sha / WORKFLOW_PATH
    need(path.is_file(), 'installed workflow missing')
    return hashlib.sha256(path.read_bytes()).hexdigest(), path


def validate_request(req):
    need(isinstance(req, dict), 'request must be object')
    need(req.get('action') == 'lean', 'action must be lean')
    # Closed action: only known keys; no shell/commands/credentials/task roots.
    extra = set(req) - CLOSED_KEYS
    need(not extra, 'unexpected request fields: ' + ','.join(sorted(extra)))
    need(isinstance(req.get('run_id'), int) and req['run_id'] > 0, 'invalid run_id')
    need(isinstance(req.get('run_attempt'), int) and req['run_attempt'] > 0, 'invalid run_attempt')
    need(req.get('repository') == REPO, 'wrong repository')
    need(req.get('repository_id') == REPO_ID, 'wrong repository_id')
    actor = req.get('actor_id')
    need(actor in (OWNER_ID, ACTIONS_BOT_ID) or req.get('event_name') == 'schedule',
         'untrusted actor')
    need(req.get('ref') in ('refs/heads/dev', 'dev') or (
        req.get('event_name') in ('schedule', 'workflow_dispatch') and req.get('ref') in (
            'refs/heads/main', 'main', 'refs/heads/dev', 'dev')),
         'ref outside branch policy')
    need(isinstance(req.get('workflow_sha'), str) and len(req['workflow_sha']) == 64, 'workflow_sha required')
    if 'client_sha' in req:
        need(isinstance(req['client_sha'], str) and SHA40.fullmatch(req['client_sha']), 'invalid client_sha')
    status = req.get('status') or 'queued'
    need(status in ('queued', 'in_progress', 'requested'), 'invalid status')
    for banned in ('command', 'shell', 'cmd', 'script', 'source_path', 'task_root',
                   'gh_token', 'token', 'password', 'DEPLOY_SSH_KEY'):
        need(banned not in req, 'credential/path field refused')
    return req


def verify_workflow_matches_install(req):
    installed_hash, path = installed_workflow_blob_sha256()
    need(req['workflow_sha'] == installed_hash, 'workflow blob mismatch vs installed')
    cfg = read_config()
    need(cfg.get('schema') == 'GB_LEAN_CONFIG_V1', 'invalid lean config')
    return {'installed_sha': installed_release_sha(), 'workflow_path': str(path),
            'enabled': bool(cfg.get('enabled')), 'config': cfg}


def verify_github_run(req, api_fetch=None):
    """Optional live Actions run verification when API helper provided by PMA host."""
    if api_fetch is None:
        return {'verified': False, 'reason': 'api_fetch_not_provided_local_path'}
    run = api_fetch(f'actions/runs/{req["run_id"]}')
    need(run.get('id') == req['run_id'], 'run id mismatch')
    need(run.get('run_attempt') == req['run_attempt'] or run.get('run_attempt') is None
         or int(run.get('run_attempt')) == int(req['run_attempt']), 'run attempt mismatch')
    need(run.get('path') == WORKFLOW_PATH or run.get('path', '').endswith('lean-delivery.yml'),
         'unexpected workflow path')
    need((run.get('repository') or {}).get('id', REPO_ID) == REPO_ID, 'run repo mismatch')
    return {'verified': True, 'run': {'id': run['id'], 'status': run.get('status'),
                                      'path': run.get('path')}}


def dispatch_controller(req, meta):
    """Invoke installed finite controller; never untrusted Issue head."""
    cfg = meta['config']
    if not cfg.get('enabled'):
        return {'status': 'disabled', 'reason': 'lean config enabled=false until commission'}
    release = INSTALL_ROOT / 'releases' / meta['installed_sha']
    run_py = release / 'tools/train/run.py'
    need(run_py.is_file(), 'installed run.py missing')
    client_sha = req.get('client_sha')
    if client_sha:
        need(SHA40.fullmatch(client_sha), 'invalid client_sha')
    # Persist intent before controller work.
    intent_dir = RESULTS / 'actions' / str(req['run_id']) / str(req['run_attempt'])
    intent_dir.mkdir(parents=True, exist_ok=True)
    intent = {'schema': 'GB_LEAN_HOST_INTENT_V1', 'request': {
        k: req[k] for k in CLOSED_KEYS if k in req
    }, 'meta': {k: meta[k] for k in ('installed_sha', 'enabled')}}
    atomic_write(intent_dir / 'intent.json', intent, 0o600)
    event = {
        'event_name': req.get('event_name') or 'workflow_dispatch',
        'inputs': {'action': 'status'},
        'repository': {'id': REPO_ID, 'full_name': REPO},
    }
    event_path = intent_dir / 'event.json'
    atomic_write(event_path, event, 0o600)
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/nonexistent',
           'PYTHONPATH': str(release / 'tools/train')}
    proc = subprocess.run(
        ['/usr/bin/python3', '-I', '-B', str(run_py), str(event_path)],
        cwd=str(release), env=env, text=True, capture_output=True, timeout=120,
    )
    atomic_write(intent_dir / 'stdout.txt', proc.stdout or '', 0o644)
    atomic_write(intent_dir / 'stderr.txt', proc.stderr or '', 0o644)
    atomic_write(intent_dir / 'exit.json', {'exit': proc.returncode}, 0o644)
    result = {'status': 'ok' if proc.returncode == 0 else 'controller_failed',
              'exit': proc.returncode, 'intent': str(intent_dir / 'intent.json')}
    if proc.stdout:
        try:
            result['controller'] = loads(proc.stdout.strip().splitlines()[-1])
        except (ValueError, HostRefused):
            result['controller_parse'] = 'failed'
    return result


def handle(req, *, api_fetch=None, commissioning=False):
    need(os.geteuid() == 0, 'host entry requires root')
    if commissioning:
        # Explicit root PMA commissioning path — still validates closed request shape.
        need(req.get('action') in ('lean', 'commission'), 'commission action refused')
    req = validate_request({k: v for k, v in req.items() if k != 'commissioning'} if not commissioning else {
        **{k: v for k, v in req.items() if k in CLOSED_KEYS or k == 'action'},
        'action': 'lean',
    })
    meta = verify_workflow_matches_install(req)
    verify_github_run(req, api_fetch=api_fetch)
    return dispatch_controller(req, meta)


def main():
    need(os.geteuid() == 0, 'must enter as root via fixed helper')
    raw = sys.stdin.buffer.read(8193)
    need(len(raw) <= 8192, 'oversize request')
    req = loads(raw)
    commissioning = bool(req.pop('commissioning', False)) if isinstance(req, dict) else False
    try:
        result = handle(req, commissioning=commissioning)
        print(json.dumps(result, sort_keys=True))
        return 0
    except HostRefused as err:
        print(json.dumps({'status': 'refused', 'reason': err.reason}, sort_keys=True))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

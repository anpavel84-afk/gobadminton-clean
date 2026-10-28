#!/usr/bin/env python3
"""Hosted Actions SSH client for Lean Mode B (analogous to actions_train/client.py).

Writes DEPLOY_SSH_KEY to temp 0600; never logs key material. This is hosted
Actions → VPS SSH. PMA must not SSH to itself. Uses existing secret profile
DEPLOY_* and forced SSH user gb-deploy-dev. GITHUB_TOKEN is for API identity
checks only — publication uses trusted gh as UID1002 on the host, never
GITHUB_TOKEN for push (which does not wake CI).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

OWNER_ID = 318610566
ACTIONS_BOT_ID = 41898282
REPO = 'anpavel84-afk/gobadminton-clean'
REPO_ID = 1416250340
WORKFLOW_PATH = '.github/workflows/lean-delivery.yml'
CONCURRENCY_GROUP = 'gobadminton-lean-delivery'  # distinct from gobadminton-dev


class Refused(Exception):
    pass


def need(ok, reason):
    if not ok:
        raise Refused(reason)


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


class SSH:
    def __enter__(self):
        self.temp = tempfile.TemporaryDirectory(prefix='gb-lean-')
        folder = Path(self.temp.name)
        folder.chmod(0o700)
        for field, name in (('DEPLOY_SSH_KEY', 'key'), ('DEPLOY_KNOWN_HOSTS', 'known')):
            need(field in os.environ and os.environ[field], f'missing {field}')
            p = folder / name
            p.write_text(os.environ[field] + '\n')
            p.chmod(0o600)
        host = os.environ['DEPLOY_HOST']
        port = os.environ.get('DEPLOY_PORT') or '22'
        need(re.fullmatch(r'[a-zA-Z0-9.-]+', host) and port.isdigit() and 1 <= int(port) <= 65535,
             'invalid fixed SSH target')
        self.argv = [
            '/usr/bin/ssh', '-F', '/dev/null', '-T', '-p', port,
            '-i', str(folder / 'key'),
            '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
            '-o', 'StrictHostKeyChecking=yes',
            '-o', 'UserKnownHostsFile=' + str(folder / 'known'),
            '-o', 'ConnectTimeout=15',
            '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=8',
            'gb-deploy-dev@' + host,
        ]
        return self

    def __exit__(self, *_):
        self.temp.cleanup()

    def __call__(self, req, timeout=2400):
        # Child SSH has no API/model credentials. JSON private stdin is never logged.
        proc = subprocess.run(
            self.argv, input=json.dumps(req, sort_keys=True), text=True,
            capture_output=True, timeout=timeout,
            env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'},
        )
        need(len(proc.stdout) <= 2097152, 'SSH response too large')
        # Never print stderr if it might echo secrets — bound and classify only.
        try:
            value = loads(proc.stdout) if proc.stdout.strip() else {'status': 'empty'}
        except (ValueError, Refused):
            raise Refused('SSH result unavailable; query durable status') from None
        if proc.returncode:
            raise Refused('restricted receiver refused: ' + str(value.get('reason', 'unknown')))
        return value


def workflow_file_sha256(repo_root=None):
    root = Path(repo_root or '.')
    path = root / WORKFLOW_PATH
    need(path.is_file(), 'lean-delivery workflow missing in checkout')
    return hashlib.sha256(path.read_bytes()).hexdigest()


def trusted_event(event, name):
    need(event.get('repository', {}).get('id') == REPO_ID, 'wrong event repository')
    if name == 'issue_comment':
        need(event.get('action') in ('created', 'edited'), 'irrelevant comment action')
        need(event.get('sender', {}).get('id') == OWNER_ID, 'untrusted Issue comment actor')
    elif name == 'workflow_dispatch':
        need(event.get('sender', {}).get('id') in (OWNER_ID, ACTIONS_BOT_ID), 'untrusted dispatch actor')
    elif name == 'schedule':
        return True
    else:
        raise Refused('untrusted event type')
    return True


def lean_request(event_name, workflow_sha, client_sha=None):
    req = {
        'action': 'lean',
        'run_id': int(os.environ['GITHUB_RUN_ID']),
        'run_attempt': int(os.environ['GITHUB_RUN_ATTEMPT']),
        'repository': REPO,
        'repository_id': REPO_ID,
        'actor_id': int(os.environ.get('GITHUB_ACTOR_ID') or (
            OWNER_ID if os.environ.get('GITHUB_ACTOR') == 'anpavel84-afk' else ACTIONS_BOT_ID)),
        'ref': os.environ.get('GITHUB_REF') or 'refs/heads/dev',
        'event_name': event_name,
        'workflow_sha': workflow_sha,
        'status': 'requested',
    }
    if client_sha:
        need(re.fullmatch(r'[0-9a-f]{40}', client_sha), 'invalid client_sha')
        req['client_sha'] = client_sha
    return req


def wait_with_keepalive(ssh, req, *, deadline_s=2300, poll_s=20):
    """Bounded wait; robust disconnect saves intent/readback — no new service."""
    value = ssh(req)
    deadline = time.monotonic() + deadline_s
    while value.get('status') == 'running' and time.monotonic() < deadline:
        time.sleep(poll_s)
        try:
            value = ssh({
                'action': 'lean',
                'run_id': req['run_id'],
                'run_attempt': req['run_attempt'],
                'repository': REPO,
                'repository_id': REPO_ID,
                'actor_id': req['actor_id'],
                'ref': req['ref'],
                'event_name': 'workflow_dispatch',
                'workflow_sha': req['workflow_sha'],
                'status': 'queued',
            })
        except Refused as err:
            # Disconnect: do not invent success; durable host intent remains.
            return {'status': 'unknown', 'reason': str(err), 'recovery': 'read_host_intent'}
    need(value.get('status') != 'running', 'bounded lean wait expired')
    return value


def reconcile():
    need(os.environ.get('GITHUB_REPOSITORY') == REPO, 'trusted repository only')
    # Execution environment is DEV; workflow file may live on main for events.
    ref = os.environ.get('GITHUB_REF') or ''
    need(ref in ('refs/heads/dev', 'refs/heads/main') or ref.startswith('refs/heads/'),
         'unexpected ref')
    event_path = Path(os.environ['GITHUB_EVENT_PATH'])
    event = loads(event_path.read_bytes())
    name = os.environ['GITHUB_EVENT_NAME']
    trusted_event(event, name)
    workflow_sha = workflow_file_sha256()
    client_sha = subprocess.check_output(
        ['/usr/bin/git', 'rev-parse', 'HEAD'], text=True).strip()
    # Prefer reviewed fixed client SHA from env when installer/PMA pins it.
    pinned = os.environ.get('LEAN_CLIENT_SHA')
    if pinned:
        need(re.fullmatch(r'[0-9a-f]{40}', pinned), 'invalid LEAN_CLIENT_SHA')
        client_sha = pinned
    req = lean_request(name, workflow_sha, client_sha=client_sha)
    Path('evidence').mkdir(exist_ok=True)
    Path('evidence/lean-request.json').write_text(json.dumps(req, sort_keys=True) + '\n')
    with SSH() as ssh:
        result = wait_with_keepalive(ssh, req)
    Path('evidence/lean-result.json').write_text(json.dumps(result, sort_keys=True) + '\n')
    print('Lean result: ' + result.get('status', 'unknown'))
    if result.get('status') in ('unknown', 'refused', 'controller_failed'):
        raise Refused('lean requires reconciliation')
    return result


def main():
    need(os.environ.get('GITHUB_REPOSITORY') == REPO, 'trusted repository only')
    try:
        if len(sys.argv) < 2 or sys.argv[1] == 'reconcile':
            reconcile()
        else:
            raise Refused('unknown client operation')
    except Refused as err:
        print(str(err), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

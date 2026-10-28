#!/usr/bin/env python3
"""Lean Mode B finite controller: admit → claim → author → QA → CI → DEV.

One bounded host run. GitHub Issues are the only product queue. Durable receipts
live under /var/lib/gobadminton-lean/results — not a task DB. C5 stays off.
Stdlib only. Paid model/GitHub publication side effects require installed host
privileges and are invoked by PMA/Actions, not by source-author self-run.
"""
from __future__ import annotations

import fcntl
import json
import os
import sys
import time
from pathlib import Path

# Survive python -I (no script-dir on sys.path) for sibling imports.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from providers import (
    OWNER_ID, REPO_ID, REPO, ProviderError, SHA40, atomic_write, digest, loads,
    progress_halt, default_routes, AUTHOR_PASS_CLAIMS, role_ready,
)

MARKER = 'GOBADMINTON_LEAN_TASK_V1'
HOLD_ISSUE = 182
HOLD_CONFIG_KEY = 'gameRecommendations'
RESULTS = Path('/var/lib/gobadminton-lean/results')
LOCKS = Path('/var/lib/gobadminton-lean/locks')
STATE = Path('/var/lib/gobadminton-lean/state')
INTEGRATION_LOCK = Path('/var/lib/gobadminton-autonomy/locks/integration.lock')
SOURCE_LOCK_DIR = Path('/var/lib/gobadminton-autonomy/locks')
SOURCE_REGISTRY_LOCK = SOURCE_LOCK_DIR / 'registry.lock'
LEASE_SLOT = 'slot1'  # shared source-writer identity with Mode A / LockRegistry
REQUIRED_TASK_FIELDS = (
    'repo', 'target', 'issue', 'goal', 'acceptance', 'allowed_paths',
    'dependencies', 'priority', 'authorroute', 'qaroute',
)
PROTECTED_SELF_MUTATE = (
    '.github/', 'tools/train/', 'AGENTS.md', 'config/', 'secrets',
)


class LeanError(RuntimeError):
    def __init__(self, code, detail=None):
        self.code = code
        self.detail = detail
        super().__init__(code + ((': ' + detail) if detail else ''))


def _need(ok, code, detail=None):
    if not ok:
        raise LeanError(code, detail)


def task_revision(task_body, comment_id, comment_updated_at):
    """Freeze entire task snapshot when claimed; changed revision cannot replay."""
    payload = {
        'marker': MARKER,
        'task': task_body,
        'comment_id': int(comment_id),
        'comment_updated_at': comment_updated_at,
    }
    return digest(payload), payload


def extract_marker_json(body):
    if not isinstance(body, str) or MARKER not in body:
        return None
    # Prefer fenced or inline JSON object after the marker line.
    idx = body.find(MARKER)
    rest = body[idx + len(MARKER):].lstrip()
    if rest.startswith(':'):
        rest = rest[1:].lstrip()
    # Find first JSON object.
    start = rest.find('{')
    if start < 0:
        return None
    depth = 0
    for i, ch in enumerate(rest[start:], start):
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                try:
                    return loads(rest[start:i + 1])
                except (ValueError, ProviderError):
                    return None
    return None


def validate_owner_ids(comment, issue, repository):
    """Numeric Owner + repo IDs required; actor/name alone insufficient."""
    _need(isinstance(repository, dict) and repository.get('id') == REPO_ID, 'wrong_repo_id')
    _need(isinstance(issue, dict) and issue.get('number'), 'invalid_issue')
    user = comment.get('user') or {}
    _need(user.get('id') == OWNER_ID, 'outsider_comment_denied')
    # Issue author is not enough; admission is the Owner comment marker.
    return True


def validate_task_fields(task):
    _need(isinstance(task, dict), 'task_not_object')
    missing = [k for k in REQUIRED_TASK_FIELDS if k not in task]
    _need(not missing, 'missing_fields', ','.join(missing))
    _need(task.get('repo') in (REPO, f'https://github.com/{REPO}'), 'wrong_repo_field')
    _need(task.get('target') == 'dev', 'target_must_be_dev')
    _need(isinstance(task.get('issue'), int) and task['issue'] > 0, 'invalid_issue_number')
    _need(isinstance(task.get('allowed_paths'), list) and task['allowed_paths'], 'allowed_paths_required')
    for p in task['allowed_paths']:
        _need(isinstance(p, str) and p and not p.startswith('/') and '..' not in p.split('/'),
              'unsafe_allowed_path', str(p))
    _need(isinstance(task.get('dependencies'), list), 'dependencies_must_be_list')
    _need(isinstance(task.get('acceptance'), (list, str)) and task['acceptance'], 'acceptance_required')
    # Ordinary product scope must not self-mutate privileged trees.
    for p in task['allowed_paths']:
        for banned in PROTECTED_SELF_MUTATE:
            if p == banned.rstrip('/') or p.startswith(banned):
                # OD017 initial source is PMA-direct; queue product tasks cannot widen here.
                if task.get('assignment') != 'OD017_NEW_LEAN_MODE_B_SOURCE_ONLY':
                    raise LeanError('protected_path_self_mutate', p)
    return True


def owner_hold_markers(issue, comments, config=None):
    """Explicit Owner hold / closed / 182 config deny stops admission."""
    if issue.get('state') == 'closed':
        return True, 'issue_closed'
    if int(issue.get('number') or 0) == HOLD_ISSUE:
        return True, 'issue_182_hard_hold'
    cfg = config or {}
    if cfg.get(HOLD_CONFIG_KEY) is False:
        # Hard Owner hold must not be overridden by ordinary task comment.
        if int(issue.get('number') or 0) == HOLD_ISSUE or any(
                'gameRecommendations' in str((c.get('body') or '')) and 'false' in str((c.get('body') or ''))
                for c in comments or []):
            return True, '182_config_deny'
    for c in comments or []:
        body = c.get('body') or ''
        if 'GOBADMINTON_LEAN_HOLD' in body and (c.get('user') or {}).get('id') == OWNER_ID:
            return True, 'owner_hold_marker'
    return False, None


def admit_comment(comment, issue, repository, *, config=None, all_comments=None):
    validate_owner_ids(comment, issue, repository)
    held, why = owner_hold_markers(issue, all_comments or [comment], config=config)
    if held:
        raise LeanError('admission_hold', why)
    task = extract_marker_json(comment.get('body') or '')
    _need(task is not None, 'marker_missing_or_invalid')
    validate_task_fields(task)
    _need(int(task['issue']) == int(issue['number']), 'issue_number_mismatch')
    rev, snap = task_revision(task, comment['id'], comment.get('updated_at') or comment.get('created_at'))
    return {
        'schema': 'GB_LEAN_ADMISSION_V1',
        'task': task,
        'revision': rev,
        'snapshot': snap,
        'comment_id': int(comment['id']),
        'issue': int(issue['number']),
        'owner_id': OWNER_ID,
        'repo_id': REPO_ID,
        'admitted_at': int(time.time()),
    }


def receipt_path(issue, revision, role, attempt, root=None):
    base = Path(root) if root else RESULTS
    return base / f'issue-{int(issue)}' / revision[:16] / f'{role}-attempt-{int(attempt)}.json'


def write_receipt(path, record):
    record = dict(record)
    record.setdefault('schema', 'GB_LEAN_RECEIPT_V1')
    record['written_at'] = int(time.time())
    atomic_write(path, record, 0o644)
    return path


def read_receipt(path):
    path = Path(path)
    if not path.is_file():
        return None
    return loads(path.read_bytes())


def load_lock_registry():
    import importlib.util
    candidates = [
        Path('/usr/local/lib/gb-actions-train/live/slots.py'),
        Path(__file__).resolve().parents[2] / 'scripts' / 'chatops' / 'actions_train' / 'live' / 'slots.py',
    ]
    for path in candidates:
        if path.is_file():
            spec = importlib.util.spec_from_file_location('lean_slots', path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    raise LeanError('lock_registry_unavailable')


class WriterLease:
    """Shared source-writer lease across model + trusted publication.

    If parent already owns a validated lease, factored provider entry drops
    privileges without reclaim. Controller atomically rejects busy writers.
    """

    def __init__(self, issue, allowed_paths, *, parent_owns=False, registry=None, lock_dir=None):
        self.issue = int(issue)
        self.allowed_paths = list(allowed_paths)
        self.parent_owns = parent_owns
        self.registry = registry
        self.lock_dir = Path(lock_dir) if lock_dir else SOURCE_LOCK_DIR
        self._owned = False
        self._integration_fd = None
        self.slots = None

    def acquire(self):
        if self.parent_owns:
            # Parent Mode A / controller already holds validated lease.
            self._owned = False
            return True
        self.slots = load_lock_registry() if self.registry is None else None
        LockRegistry = self.registry or self.slots.LockRegistry
        task_record = (self.slots.task_record if self.slots else None)
        if task_record is None:
            record = dict(issue=self.issue, locks=['owner:isolated-source'],
                          allowed_paths=self.allowed_paths, depends_on=[], writer=True)
        else:
            record = task_record(self.issue, {
                'locks': ['owner:isolated-source'],
                'allowed_paths': self.allowed_paths,
            }, writer=True)
        reg = LockRegistry(str(self.lock_dir), str(self.lock_dir / 'registry.lock'))
        ok = reg.acquire(LEASE_SLOT, record)
        if not ok:
            raise LeanError('source_writer_busy')
        self.registry_obj = reg
        self._owned = True
        # Integration flock for finite controller serialization with merge/deploy path.
        try:
            fd = os.open(str(INTEGRATION_LOCK), os.O_RDONLY | os.O_NOFOLLOW)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                os.close(fd)
                self.release()
                raise LeanError('integration_lock_busy') from None
            self._integration_fd = fd
        except FileNotFoundError:
            # Pre-install / unit tests: optional when autonomy locks absent.
            self._integration_fd = None
        return True

    def release(self):
        if self._integration_fd is not None:
            try:
                os.close(self._integration_fd)
            except OSError:
                pass
            self._integration_fd = None
        if self._owned and hasattr(self, 'registry_obj'):
            try:
                self.registry_obj.release()
            except Exception:
                pass
            self._owned = False


def stage_order():
    return (
        'admit', 'claim', 'author', 'preqa_diff', 'publish_pr', 'wait_ci',
        'qa', 'repair', 'merge_dev', 'wait_deploy', 'uat_record', 'next',
    )


def claim_admission(admission, *, results_root=None, force=False):
    root = Path(results_root) if results_root else RESULTS
    claim_dir = root / f'issue-{admission["issue"]}' / admission['revision'][:16]
    claim_dir.mkdir(parents=True, exist_ok=True)
    claim_path = claim_dir / 'claim.json'
    existing = read_receipt(claim_path)
    if existing and not force:
        if existing.get('revision') != admission['revision']:
            raise LeanError('revision_changed_cannot_replay')
        if existing.get('phase') in ('RUNNING', 'UNKNOWN'):
            raise LeanError('no_automatic_paid_replay', existing.get('phase'))
        return existing
    record = {
        'schema': 'GB_LEAN_CLAIM_V1',
        'issue': admission['issue'],
        'revision': admission['revision'],
        'comment_id': admission['comment_id'],
        'task': admission['task'],
        'phase': 'CLAIMED',
        'routes': default_routes(),
        'attempts': {'author': 0, 'qa': 0},
        'findings_fingerprints': [],
        'claimed_at': int(time.time()),
    }
    write_receipt(claim_path, record)
    return record


def mark_phase(claim_path, phase, **extra):
    rec = read_receipt(claim_path) or {}
    if rec.get('phase') in ('RUNNING', 'UNKNOWN') and phase == 'RUNNING':
        raise LeanError('no_automatic_paid_replay', rec.get('phase'))
    rec['phase'] = phase
    rec.update(extra)
    write_receipt(claim_path, rec)
    return rec


def recover_publication(kind, *, remote_head=None, pr_number=None, merged_sha=None,
                        deploy_run=None, receipt=None, live_sha=None):
    """Recover via exact remote evidence — never blind new paid calls."""
    if kind == 'push':
        _need(remote_head and SHA40.fullmatch(remote_head), 'push_recovery_needs_remote_head')
        return {'kind': 'push', 'remote_head': remote_head, 'pr': pr_number, 'action': 'readback_only'}
    if kind == 'merge':
        _need(merged_sha and SHA40.fullmatch(merged_sha), 'merge_recovery_needs_merged_sha')
        return {'kind': 'merge', 'merged_sha': merged_sha, 'action': 'readback_only'}
    if kind == 'deploy':
        _need(deploy_run and receipt and live_sha and SHA40.fullmatch(live_sha),
              'deploy_recovery_needs_run_receipt_live_sha')
        accepted = isinstance(receipt, dict) and (
            receipt.get('status') == 'ACCEPTED' or 'ACCEPTED' in str(receipt.get('line') or ''))
        return {'kind': 'deploy', 'run': deploy_run, 'live_sha': live_sha,
                'accepted': bool(accepted), 'action': 'readback_only'}
    raise LeanError('unknown_recovery_kind', kind)


def deterministic_preqa_diff(worktree, allowed_paths, base_sha):
    """Addressed git diff check before QA; no model call."""
    import subprocess
    env = {'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'GIT_CONFIG_GLOBAL': '/dev/null',
           'GIT_CONFIG_SYSTEM': '/dev/null', 'GIT_OPTIONAL_LOCKS': '0', 'GIT_TERMINAL_PROMPT': '0'}
    def git(*args):
        return subprocess.run(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', *args],
                              cwd=worktree, env=env, text=True, capture_output=True, check=True, timeout=60)
    head = git('rev-parse', 'HEAD').stdout.strip()
    status = git('status', '--porcelain').stdout
    changed = []
    for line in status.splitlines():
        if not line.strip():
            continue
        path = line[3:].strip()
        if ' -> ' in path:
            path = path.split(' -> ', 1)[1]
        changed.append(path)
    if not changed:
        # Also consider committed-but-unpushed vs base.
        diff = git('diff', '--name-only', base_sha, 'HEAD').stdout.splitlines()
        changed = [p for p in diff if p]
    illegal = [p for p in changed if p not in set(allowed_paths)]
    return {
        'head': head,
        'base': base_sha,
        'changed': changed,
        'illegal': illegal,
        'ok': bool(changed) and not illegal,
    }


def apply_qa_result(claim, verdict_obj, *, claim_path):
    _need(verdict_obj.get('reviewed_sha') == claim.get('candidate_sha') or
          verdict_obj.get('reviewed_sha') == (claim.get('task') or {}).get('candidate_sha') or
          SHA40.fullmatch(str(verdict_obj.get('reviewed_sha') or '')),
          'qa_sha_bind')
    candidate = claim.get('candidate_sha')
    if candidate and verdict_obj.get('reviewed_sha') != candidate:
        raise LeanError('stale_sha_verdict', verdict_obj.get('reviewed_sha'))
    fps = list(claim.get('findings_fingerprints') or [])
    halt, fp = progress_halt(fps, verdict_obj.get('findings') or [])
    fps.append(fp)
    claim['findings_fingerprints'] = fps
    claim['last_qa'] = {
        'verdict': verdict_obj['verdict'],
        'findings': verdict_obj.get('findings') or [],
        'reviewed_sha': verdict_obj['reviewed_sha'],
        'fingerprint': fp,
        'charge': verdict_obj.get('charge', 'unknown'),
    }
    if verdict_obj['verdict'] == 'FAIL' and halt:
        claim['phase'] = 'STRATEGY_HALT'
        claim['halt_reason'] = 'two_identical_findings_no_progress'
    elif verdict_obj['verdict'] == 'PASS':
        claim['phase'] = 'QA_PASS'
    else:
        claim['phase'] = 'QA_FAIL'
    write_receipt(claim_path, claim)
    return claim


def record_uat_not_tested(claim_path, issue, sha):
    rec = read_receipt(claim_path) or {}
    rec['uat'] = 'NOT_TESTED'
    rec['uat_sha'] = sha
    rec['uat_issue'] = int(issue)
    rec['phase'] = 'DEV_ACCEPTED_UAT_PENDING'
    write_receipt(claim_path, rec)
    return rec


def pick_next_ready(admissions, *, blocked_issues=None, uat_pending=None):
    """Continue independent ready work even if local BLOCKED or Owner UAT pending."""
    blocked = set(blocked_issues or ())
    uat = set(uat_pending or ())
    ready = []
    for adm in admissions:
        issue = int(adm['issue'])
        deps = set(adm.get('task', {}).get('dependencies') or [])
        if issue in blocked:
            continue
        if deps & blocked:
            continue
        # UAT pending on other issues does not block independent work.
        if issue in uat:
            continue
        if int(adm.get('task', {}).get('priority') or 0) < 0:
            continue
        ready.append(adm)
    ready.sort(key=lambda a: (-int(a.get('task', {}).get('priority') or 0), int(a['issue'])))
    return ready[0] if ready else None


def mode_b_status_projection(claim=None, last_event=None):
    """Actual Mode B projection for OPS monitor — no fictitious RUNNING."""
    return {
        'schema': 'GB_LEAN_MODE_B_PROJECTION_V1',
        'mode': 'lean_mode_b',
        'enabled': False,  # installer leaves disabled until commission
        'active_claims': AUTHOR_PASS_CLAIMS['mode_b_active'],
        'issue': None if not claim else claim.get('issue'),
        'revision': None if not claim else claim.get('revision'),
        'phase': None if not claim else claim.get('phase'),
        'pr': None if not claim else claim.get('pr'),
        'candidate_sha': None if not claim else claim.get('candidate_sha'),
        'qa': None if not claim else claim.get('last_qa'),
        'ci': None if not claim else claim.get('ci'),
        'dev': None if not claim else claim.get('dev'),
        'last_event': last_event,
        'roles': {
            'cursor_author': role_ready('cursor_author')[0],
            'codex_qa': role_ready('codex_qa')[0],
            'agy_qa': role_ready('agy_qa')[0],
            'agy_author': role_ready('agy_author')[0],
        },
        'observed_at': int(time.time()),
    }


def run_once(event, *, gh_api=None, results_root=None, config=None, parent_lease=False):
    """Same entrypoint for schedule / comment / dispatch / recovery."""
    name = event.get('event_name') or event.get('name') or 'workflow_dispatch'
    root = Path(results_root) if results_root else RESULTS
    root.mkdir(parents=True, exist_ok=True)

    if name in ('issue_comment', 'issues'):
        comment = event.get('comment') or {}
        issue = event.get('issue') or {}
        repo = event.get('repository') or {'id': REPO_ID}
        try:
            admission = admit_comment(comment, issue, repo, config=config,
                                      all_comments=event.get('comments') or [comment])
        except LeanError as err:
            return {'status': 'denied', 'code': err.code, 'detail': err.detail}
        claim = claim_admission(admission, results_root=root)
        claim_path = root / f'issue-{admission["issue"]}' / admission['revision'][:16] / 'claim.json'
        # Duplicate event: existing claim is authoritative; no second writer / model call.
        return {'status': 'admitted', 'claim': claim, 'claim_path': str(claim_path),
                'duplicate': claim.get('claimed_at') is not None and name == 'issue_comment'}

    if name == 'schedule':
        # Recovery: HOLD RUNNING/UNKNOWN until actual exit + saved result read.
        holds = []
        if root.exists():
            for path in root.glob('issue-*/**/claim.json'):
                rec = read_receipt(path)
                if rec and rec.get('phase') in ('RUNNING', 'UNKNOWN'):
                    holds.append({'path': str(path), 'phase': rec['phase'], 'action': 'HOLD_no_automatic_charge'})
        return {'status': 'schedule_reconcile', 'holds': holds,
                'projection': mode_b_status_projection(last_event='schedule')}

    if name == 'workflow_dispatch':
        action = (event.get('inputs') or {}).get('action') or 'status'
        if action == 'status':
            return {'status': 'ok', 'projection': mode_b_status_projection(last_event='dispatch')}
        if action == 'recover':
            return recover_publication(
                (event.get('inputs') or {}).get('recover_kind') or 'push',
                remote_head=(event.get('inputs') or {}).get('remote_head'),
                pr_number=(event.get('inputs') or {}).get('pr'),
                merged_sha=(event.get('inputs') or {}).get('merged_sha'),
                deploy_run=(event.get('inputs') or {}).get('deploy_run'),
                receipt=event.get('receipt'),
                live_sha=(event.get('inputs') or {}).get('live_sha'),
            )
        return {'status': 'dispatch', 'action': action}

    return {'status': 'ignored', 'event': name}


def main(argv=None):
    import sys
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        print('usage: run.py <event.json>|--self-check', file=sys.stderr)
        return 2
    if argv[0] == '--self-check':
        print(json.dumps({
            'schema': 'GB_LEAN_SELF_CHECK_V1',
            'controller': 'lean_mode_b',
            'c5': 'off',
            'issue_182': 'OFF',
            'author_claims': AUTHOR_PASS_CLAIMS,
            'stages': list(stage_order()),
        }, sort_keys=True))
        return 0
    event = loads(Path(argv[0]).read_bytes())
    result = run_once(event)
    print(json.dumps(result, sort_keys=True))
    return 0 if result.get('status') not in ('denied',) else 1


if __name__ == '__main__':
    raise SystemExit(main())

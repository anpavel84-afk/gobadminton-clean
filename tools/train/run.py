#!/usr/bin/env python3
"""Lean Mode B finite controller: admit → claim → author → QA → CI → DEV.

One bounded host run. GitHub Issues are the only product queue. Durable receipts
live under /var/lib/gobadminton-lean/results — not a task DB. C5 stays off.
Stdlib only. Paid model/GitHub publication side effects require installed host
privileges and are invoked by PMA/Actions via injectable adapters — the same
controller path tests exercise with mocks. No parallel demo controller.
"""
from __future__ import annotations

import fcntl
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from providers import (
    OWNER_ID, REPO_ID, REPO, ProviderError, SHA40, atomic_write, digest, loads,
    progress_halt, default_routes, AUTHOR_PASS_CLAIMS, role_ready,
    invoke_cursor_author, invoke_codex_qa, invoke_trusted_publish, select_qa_provider,
    parse_qa_verdict,
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
LEASE_SLOT = 'slot1'
REQUIRED_TASK_FIELDS = (
    'repo', 'target', 'issue', 'goal', 'acceptance', 'allowed_paths',
    'dependencies', 'priority', 'authorroute', 'qaroute',
)
PROTECTED_SELF_MUTATE = (
    '.github/', 'tools/train/', 'AGENTS.md', 'config/', 'secrets',
)
TERMINAL_PHASES = frozenset({
    'DEV_ACCEPTED_UAT_PENDING', 'BLOCKED', 'STRATEGY_HALT', 'DENIED', 'DONE',
})
ACTIVE_HOLD_PHASES = frozenset({'RUNNING', 'UNKNOWN'})


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
    idx = body.find(MARKER)
    rest = body[idx + len(MARKER):].lstrip()
    if rest.startswith(':'):
        rest = rest[1:].lstrip()
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
    for p in task['allowed_paths']:
        for banned in PROTECTED_SELF_MUTATE:
            if p == banned.rstrip('/') or p.startswith(banned):
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
    Do not nest two writer lease acquisitions.
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
        self.registry_obj = None

    def acquire(self):
        if self.parent_owns:
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
            self._integration_fd = None
        return True

    def release(self):
        if self._integration_fd is not None:
            try:
                os.close(self._integration_fd)
            except OSError:
                pass
            self._integration_fd = None
        if self._owned and self.registry_obj is not None:
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


def claim_path_for(admission, results_root):
    root = Path(results_root)
    return root / f'issue-{admission["issue"]}' / admission['revision'][:16] / 'claim.json'


def claim_admission(admission, *, results_root=None, force=False):
    root = Path(results_root) if results_root else RESULTS
    claim_dir = root / f'issue-{admission["issue"]}' / admission['revision'][:16]
    claim_dir.mkdir(parents=True, exist_ok=True)
    claim_path = claim_dir / 'claim.json'
    existing = read_receipt(claim_path)
    if existing and not force:
        if existing.get('revision') != admission['revision']:
            raise LeanError('revision_changed_cannot_replay')
        if existing.get('phase') in ACTIVE_HOLD_PHASES:
            raise LeanError('no_automatic_paid_replay', existing.get('phase'))
        return existing
    record = {
        'schema': 'GB_LEAN_CLAIM_V1',
        'issue': admission['issue'],
        'revision': admission['revision'],
        'comment_id': admission['comment_id'],
        'task': admission['task'],
        'phase': 'CLAIMED',
        'stage': 'claim',
        'routes': default_routes(),
        'attempts': {'author': 0, 'qa': 0},
        'findings_fingerprints': [],
        'claimed_at': int(time.time()),
    }
    write_receipt(claim_path, record)
    return record


def mark_phase(claim_path, phase, **extra):
    rec = read_receipt(claim_path) or {}
    if rec.get('phase') in ACTIVE_HOLD_PHASES and phase in ACTIVE_HOLD_PHASES:
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
    candidate = claim.get('candidate_sha')
    reviewed = verdict_obj.get('reviewed_sha')
    _need(isinstance(reviewed, str) and SHA40.fullmatch(reviewed), 'qa_sha_bind')
    if candidate and reviewed != candidate:
        raise LeanError('stale_sha_verdict', reviewed)
    fps = list(claim.get('findings_fingerprints') or [])
    halt, fp = progress_halt(fps, verdict_obj.get('findings') or [])
    fps.append(fp)
    claim['findings_fingerprints'] = fps
    claim['last_qa'] = {
        'verdict': verdict_obj['verdict'],
        'findings': verdict_obj.get('findings') or [],
        'reviewed_sha': reviewed,
        'fingerprint': fp,
        'charge': verdict_obj.get('charge', 'unknown'),
    }
    if verdict_obj['verdict'] == 'FAIL' and halt:
        claim['phase'] = 'STRATEGY_HALT'
        claim['stage'] = 'repair'
        claim['halt_reason'] = 'two_identical_findings_no_progress'
    elif verdict_obj['verdict'] == 'PASS':
        claim['phase'] = 'QA_PASS'
        claim['stage'] = 'qa'
    else:
        claim['phase'] = 'QA_FAIL'
        claim['stage'] = 'repair'
    write_receipt(claim_path, claim)
    return claim


def record_uat_not_tested(claim_path, issue, sha):
    rec = read_receipt(claim_path) or {}
    rec['uat'] = 'NOT_TESTED'
    rec['uat_sha'] = sha
    rec['uat_issue'] = int(issue)
    rec['phase'] = 'DEV_ACCEPTED_UAT_PENDING'
    rec['stage'] = 'uat_record'
    write_receipt(claim_path, rec)
    return rec


def pick_next_ready(admissions, *, blocked_issues=None, uat_pending=None, done_issues=None):
    """Continue independent ready work even if local BLOCKED or Owner UAT pending."""
    blocked = set(blocked_issues or ())
    uat = set(uat_pending or ())
    done = set(done_issues or ())
    ready = []
    for adm in admissions:
        issue = int(adm['issue'])
        deps = set(adm.get('task', {}).get('dependencies') or [])
        if issue in blocked or issue in done:
            continue
        if deps & blocked:
            continue
        if issue in uat:
            continue
        if int(adm.get('task', {}).get('priority') or 0) < 0:
            continue
        ready.append(adm)
    ready.sort(key=lambda a: (-int(a.get('task', {}).get('priority') or 0), int(a['issue'])))
    return ready[0] if ready else None


def mode_b_status_projection(claim=None, last_event=None, *, worker=None, config=None):
    """Actual Mode B projection for OPS monitor — no fictitious RUNNING."""
    cfg = config or {}
    worker = worker or {}
    live = bool(worker.get('pid')) and bool(worker.get('alive'))
    phase = None if not claim else claim.get('phase')
    # Dead worker must not project RUNNING.
    if phase in ACTIVE_HOLD_PHASES and not live:
        phase = 'WORKER_DEAD_' + str(phase)
    return {
        'schema': 'GB_LEAN_MODE_B_PROJECTION_V1',
        'mode': 'lean_mode_b',
        'enabled': bool(cfg.get('enabled')),
        'commissioning': bool(cfg.get('commissioning', not cfg.get('mode_b_active'))),
        'mode_b_active': bool(cfg.get('mode_b_active')),
        'active_claims': AUTHOR_PASS_CLAIMS['mode_b_active'],
        'worker': {
            'pid': worker.get('pid'),
            'birth': worker.get('birth'),
            'alive': live,
            'stage': worker.get('stage') or (None if not claim else claim.get('stage')),
        },
        'issue': None if not claim else claim.get('issue'),
        'role': None if not claim else (claim.get('routes') or {}).get('author'),
        'revision': None if not claim else claim.get('revision'),
        'phase': phase,
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


class Adapters:
    """Injectable side effects. Tests and live host use the same controller."""

    def __init__(self, **hooks):
        self.fetch_admissions = hooks.get('fetch_admissions')
        self.gh_api = hooks.get('gh_api')
        self.author = hooks.get('author')
        self.qa = hooks.get('qa')
        self.publish = hooks.get('publish')
        self.wait_ci = hooks.get('wait_ci')
        self.merge = hooks.get('merge')
        self.deploy = hooks.get('deploy')
        self.worktree = hooks.get('worktree')
        self.project_status = hooks.get('project_status')
        self.lock_registry = hooks.get('lock_registry')
        self.lock_dir = hooks.get('lock_dir')
        self.preqa_diff = hooks.get('preqa_diff')
        self.evidence_dir = hooks.get('evidence_dir')
        self.now = hooks.get('now') or (lambda: int(time.time()))


def _evidence_dir(adapters, claim, results_root):
    if adapters.evidence_dir:
        base = Path(adapters.evidence_dir)
    else:
        base = Path(results_root) / f'issue-{claim["issue"]}' / claim['revision'][:16] / 'evidence'
    base.mkdir(parents=True, exist_ok=True)
    return base


def fetch_owner_admissions(gh_api, *, config=None):
    """Fresh numeric-Owner canonical admissions queue via trusted gh API."""
    _need(callable(gh_api), 'gh_api_required')
    issues = gh_api(f'repos/{REPO}/issues?state=open&per_page=100')
    if not isinstance(issues, list):
        raise LeanError('issues_list_invalid')
    admissions = []
    for issue in issues:
        if not isinstance(issue, dict) or not issue.get('number'):
            continue
        if issue.get('pull_request'):
            continue
        number = int(issue['number'])
        if number == HOLD_ISSUE:
            continue
        comments = gh_api(f'repos/{REPO}/issues/{number}/comments?per_page=100')
        if not isinstance(comments, list):
            continue
        for comment in comments:
            user = comment.get('user') or {}
            if user.get('id') != OWNER_ID:
                continue
            if MARKER not in (comment.get('body') or ''):
                continue
            try:
                adm = admit_comment(comment, issue, {'id': REPO_ID}, config=config,
                                    all_comments=comments)
            except LeanError:
                continue
            admissions.append(adm)
    admissions.sort(key=lambda a: (-int(a.get('task', {}).get('priority') or 0), int(a['issue'])))
    return admissions


def _scan_holds(results_root):
    holds = []
    root = Path(results_root)
    if not root.exists():
        return holds
    for path in root.glob('issue-*/**/claim.json'):
        rec = read_receipt(path)
        if rec and rec.get('phase') in ACTIVE_HOLD_PHASES:
            holds.append({'path': str(path), 'phase': rec['phase'],
                          'issue': rec.get('issue'), 'action': 'HOLD_no_automatic_charge'})
    return holds


def _collect_done_uat_blocked(results_root):
    done, uat, blocked = set(), set(), set()
    root = Path(results_root)
    if not root.exists():
        return done, uat, blocked
    for path in root.glob('issue-*/**/claim.json'):
        rec = read_receipt(path)
        if not rec:
            continue
        issue = rec.get('issue')
        if issue is None:
            continue
        phase = rec.get('phase')
        if phase in ('DEV_ACCEPTED_UAT_PENDING', 'DONE') or rec.get('uat') == 'NOT_TESTED':
            uat.add(int(issue))
            done.add(int(issue))
        if phase in ('BLOCKED', 'STRATEGY_HALT', 'DENIED'):
            blocked.add(int(issue))
        if phase == 'DONE':
            done.add(int(issue))
    return done, uat, blocked


def execute_claim(admission, adapters, *, results_root, config=None, parent_lease=False,
                  max_repair=8):
    """Finite resumable flow for one admitted Issue. Same path for live + tests."""
    root = Path(results_root)
    claim = claim_admission(admission, results_root=root)
    path = claim_path_for(admission, root)
    task = dict(claim['task'])
    task['revision'] = claim['revision']
    task['issue'] = claim['issue']
    evidence = _evidence_dir(adapters, claim, root)

    if claim.get('phase') in ACTIVE_HOLD_PHASES:
        raise LeanError('no_automatic_paid_replay', claim.get('phase'))
    if claim.get('phase') in TERMINAL_PHASES:
        return {'status': 'already_terminal', 'claim': claim, 'claim_path': str(path)}

    lease = WriterLease(
        claim['issue'], task.get('allowed_paths') or [],
        parent_owns=parent_lease,
        registry=adapters.lock_registry,
        lock_dir=adapters.lock_dir,
    )
    lease.acquire()
    try:
        # --- author ---
        if claim.get('phase') in ('CLAIMED', 'QA_FAIL') or claim.get('stage') in ('claim', 'repair', None):
            if claim.get('phase') == 'QA_FAIL' or claim.get('stage') == 'repair':
                # Repair pass: new author attempt with findings context.
                claim['attempts']['author'] = int((claim.get('attempts') or {}).get('author') or 0) + 1
            else:
                claim['attempts']['author'] = int((claim.get('attempts') or {}).get('author') or 0) + 1
            mark_phase(path, 'RUNNING', stage='author', attempts=claim['attempts'])
            worktree = adapters.worktree(task) if adapters.worktree else task.get('worktree')
            _need(worktree, 'worktree_required')
            try:
                if adapters.author:
                    author_result = invoke_cursor_author(
                        task=task, worktree=worktree, evidence_dir=evidence,
                        launcher=adapters.author, parent_lease=True)
                else:
                    raise LeanError('author_adapter_required')
            except ProviderError as err:
                if err.charge == 'unknown' or err.code.endswith('unknown'):
                    mark_phase(path, 'UNKNOWN', stage='author', error=err.code)
                    raise LeanError('no_automatic_paid_replay', 'UNKNOWN') from err
                mark_phase(path, 'BLOCKED', stage='author', error=err.code)
                raise
            candidate_sha = author_result['candidate_sha']
            claim = mark_phase(path, 'AUTHOR_DONE', stage='author',
                               candidate_sha=candidate_sha,
                               author_changed=author_result.get('changed_paths') or [],
                               attempts=claim['attempts'])

        # --- preqa diff ---
        claim = read_receipt(path)
        if claim.get('phase') == 'AUTHOR_DONE':
            base_sha = task.get('base') or claim.get('base_sha') or ('0' * 40)
            worktree = adapters.worktree(task) if adapters.worktree else task.get('worktree')
            if adapters.preqa_diff:
                diff = adapters.preqa_diff(worktree, task['allowed_paths'], base_sha)
            else:
                try:
                    diff = deterministic_preqa_diff(worktree, task['allowed_paths'], base_sha)
                except Exception as err:
                    raise LeanError('preqa_diff_failed', type(err).__name__) from err
            if not diff.get('ok'):
                mark_phase(path, 'BLOCKED', stage='preqa_diff', preqa=diff)
                return {'status': 'blocked', 'claim': read_receipt(path), 'claim_path': str(path),
                        'reason': 'preqa_diff'}
            claim = mark_phase(path, 'PREQA_OK', stage='preqa_diff', preqa=diff,
                               candidate_sha=diff.get('head') or claim.get('candidate_sha'))

        # --- publish PR (UID1002 gh, not GITHUB_TOKEN) ---
        claim = read_receipt(path)
        if claim.get('phase') == 'PREQA_OK':
            mark_phase(path, 'RUNNING', stage='publish_pr')
            try:
                if adapters.publish:
                    pub = invoke_trusted_publish(
                        kind='push_pr',
                        payload={'issue': claim['issue'], 'sha': claim['candidate_sha'],
                                 'allowed_paths': task['allowed_paths']},
                        evidence_dir=evidence, publisher=adapters.publish)
                else:
                    raise LeanError('publish_adapter_required')
            except ProviderError as err:
                if 'unknown' in err.code or err.charge == 'unknown':
                    mark_phase(path, 'UNKNOWN', stage='publish_pr', error=err.code)
                    raise LeanError('no_automatic_paid_replay', 'UNKNOWN') from err
                mark_phase(path, 'BLOCKED', stage='publish_pr', error=err.code)
                raise
            # Reconcile known GitHub effects from publisher readback.
            claim = mark_phase(path, 'PR_OPEN', stage='publish_pr',
                               pr=pub.get('pr'), candidate_sha=pub.get('head_sha') or claim['candidate_sha'],
                               publish=pub)

        # --- Product CI all7 exact head ---
        claim = read_receipt(path)
        if claim.get('phase') == 'PR_OPEN':
            mark_phase(path, 'RUNNING', stage='wait_ci')
            if not adapters.wait_ci:
                raise LeanError('ci_adapter_required')
            ci = adapters.wait_ci(claim)
            if not ci.get('ok'):
                mark_phase(path, 'BLOCKED', stage='wait_ci', ci=ci)
                return {'status': 'blocked', 'claim': read_receipt(path), 'claim_path': str(path),
                        'reason': 'ci'}
            if ci.get('head_sha') and ci['head_sha'] != claim.get('candidate_sha'):
                mark_phase(path, 'BLOCKED', stage='wait_ci', ci=ci, error='ci_head_mismatch')
                raise LeanError('ci_head_mismatch', ci.get('head_sha'))
            claim = mark_phase(path, 'CI_PASS', stage='wait_ci', ci=ci)

        # --- independent QA ---
        claim = read_receipt(path)
        if claim.get('phase') == 'CI_PASS':
            provider, reason, _meta = select_qa_provider(task, issue=claim['issue'])
            mark_phase(path, 'RUNNING', stage='qa', qa_provider=provider, qa_route_reason=reason)
            claim['attempts']['qa'] = int((claim.get('attempts') or {}).get('qa') or 0) + 1
            try:
                if adapters.qa:
                    # Adapter may return structured verdict or raw for parse.
                    raw = adapters.qa(dict(claim, qa_provider=provider))
                else:
                    raw = invoke_codex_qa(
                        task=task, candidate_sha=claim['candidate_sha'],
                        evidence_dir=evidence, launcher=None)
            except ProviderError as err:
                if 'unknown' in err.code or err.charge == 'unknown':
                    mark_phase(path, 'UNKNOWN', stage='qa', error=err.code, attempts=claim['attempts'])
                    raise LeanError('no_automatic_paid_replay', 'UNKNOWN') from err
                mark_phase(path, 'BLOCKED', stage='qa', error=err.code)
                raise
            if isinstance(raw, dict) and raw.get('verdict') in ('PASS', 'FAIL'):
                verdict = raw
                if verdict.get('reviewed_sha') != claim['candidate_sha']:
                    raise LeanError('stale_sha_verdict', str(verdict.get('reviewed_sha')))
            else:
                verdict = parse_qa_verdict(raw, claim['candidate_sha'], provider=provider)
            claim = apply_qa_result(claim, verdict, claim_path=path)
            claim['attempts'] = claim.get('attempts') or {}
            write_receipt(path, claim)

            if claim.get('phase') == 'STRATEGY_HALT':
                return {'status': 'strategy_halt', 'claim': claim, 'claim_path': str(path)}
            if claim.get('phase') == 'QA_FAIL':
                # Direct repair: loop author→…→qa with new exact SHA, bound attempts.
                if int(claim['attempts'].get('author') or 0) >= max_repair:
                    mark_phase(path, 'BLOCKED', stage='repair', error='repair_bound')
                    return {'status': 'blocked', 'claim': read_receipt(path), 'claim_path': str(path),
                            'reason': 'repair_bound'}
                # Resumable: release will happen; caller/schedule wakes next stage.
                return execute_claim(admission, adapters, results_root=root, config=config,
                                    parent_lease=True, max_repair=max_repair)

        # --- merge dev exact head ---
        claim = read_receipt(path)
        if claim.get('phase') == 'QA_PASS':
            mark_phase(path, 'RUNNING', stage='merge_dev')
            if not adapters.merge:
                raise LeanError('merge_adapter_required')
            try:
                merged = invoke_trusted_publish(
                    kind='merge_dev',
                    payload={'pr': claim.get('pr'), 'sha': claim['candidate_sha']},
                    evidence_dir=evidence, publisher=adapters.merge)
            except ProviderError as err:
                if 'unknown' in err.code or err.charge == 'unknown':
                    mark_phase(path, 'UNKNOWN', stage='merge_dev', error=err.code)
                    raise LeanError('no_automatic_paid_replay', 'UNKNOWN') from err
                raise
            if merged.get('merged_sha') != claim['candidate_sha']:
                raise LeanError('merge_sha_mismatch', str(merged.get('merged_sha')))
            claim = mark_phase(path, 'MERGED', stage='merge_dev', merge=merged,
                               merged_sha=merged['merged_sha'])

        # --- DEV deploy + ACCEPTED/liveSHA ---
        claim = read_receipt(path)
        if claim.get('phase') == 'MERGED':
            mark_phase(path, 'RUNNING', stage='wait_deploy')
            if not adapters.deploy:
                raise LeanError('deploy_adapter_required')
            dep = adapters.deploy(claim)
            accepted = bool(dep.get('accepted')) and dep.get('live_sha') == claim.get('merged_sha')
            if not accepted:
                mark_phase(path, 'BLOCKED', stage='wait_deploy', dev=dep)
                return {'status': 'blocked', 'claim': read_receipt(path), 'claim_path': str(path),
                        'reason': 'deploy'}
            claim = mark_phase(path, 'DEV_ACCEPTED', stage='wait_deploy', dev=dep)

        # --- UAT NOT_TESTED ---
        claim = read_receipt(path)
        if claim.get('phase') == 'DEV_ACCEPTED':
            claim = record_uat_not_tested(path, claim['issue'], claim.get('merged_sha'))

        projection = mode_b_status_projection(claim, last_event='execute_claim', config=config)
        if adapters.project_status:
            adapters.project_status(projection)
        return {'status': 'dev_accepted_uat_pending', 'claim': claim, 'claim_path': str(path),
                'projection': projection}
    finally:
        if not parent_lease:
            lease.release()


def advance_queue(adapters, *, results_root, config=None, parent_lease=False, limit=2):
    """Process next admitted issues automatically after DONE/UAT handoff."""
    holds = _scan_holds(results_root)
    if holds:
        return {'status': 'schedule_reconcile', 'holds': holds,
                'projection': mode_b_status_projection(last_event='schedule_hold', config=config)}

    if adapters.fetch_admissions:
        admissions = adapters.fetch_admissions()
    elif adapters.gh_api:
        admissions = fetch_owner_admissions(adapters.gh_api, config=config)
    else:
        return {'status': 'no_admissions_source',
                'projection': mode_b_status_projection(last_event='schedule', config=config)}

    done, uat, blocked = _collect_done_uat_blocked(results_root)
    results = []
    for _ in range(max(1, int(limit))):
        nxt = pick_next_ready(admissions, blocked_issues=blocked, uat_pending=uat, done_issues=done)
        if not nxt:
            break
        out = execute_claim(nxt, adapters, results_root=results_root, config=config,
                            parent_lease=parent_lease)
        results.append(out)
        issue = int(nxt['issue'])
        phase = (out.get('claim') or {}).get('phase')
        if phase in ('DEV_ACCEPTED_UAT_PENDING', 'DONE'):
            uat.add(issue)
            done.add(issue)
        elif phase in ('BLOCKED', 'STRATEGY_HALT', 'DENIED'):
            blocked.add(issue)
        elif out.get('status') in ('strategy_halt', 'blocked'):
            blocked.add(issue)
        else:
            # UNKNOWN / in-progress stops further auto advance this wake.
            break
    return {
        'status': 'advanced',
        'results': results,
        'projection': mode_b_status_projection(
            (results[-1].get('claim') if results else None),
            last_event='advance', config=config),
    }


def run_once(event, *, adapters=None, gh_api=None, results_root=None, config=None,
             parent_lease=False, limit=2):
    """Same entrypoint for schedule / comment / dispatch / recovery / API tests."""
    name = event.get('event_name') or event.get('name') or 'workflow_dispatch'
    root = Path(results_root) if results_root else RESULTS
    root.mkdir(parents=True, exist_ok=True)
    adapters = adapters or Adapters(gh_api=gh_api)
    if gh_api and adapters.gh_api is None:
        adapters.gh_api = gh_api

    if name in ('issue_comment', 'issues'):
        comment = event.get('comment') or {}
        issue = event.get('issue') or {}
        repo = event.get('repository') or {'id': REPO_ID}
        try:
            admission = admit_comment(comment, issue, repo, config=config,
                                      all_comments=event.get('comments') or [comment])
        except LeanError as err:
            return {'status': 'denied', 'code': err.code, 'detail': err.detail}
        # Duplicate event: claim is authoritative; do not start second writer/model call.
        claim_file = claim_path_for(admission, root)
        existing = read_receipt(claim_file)
        if existing and existing.get('revision') == admission['revision']:
            if existing.get('phase') in ACTIVE_HOLD_PHASES:
                return {'status': 'hold', 'code': 'no_automatic_paid_replay',
                        'claim': existing, 'claim_path': str(claim_file)}
            if existing.get('phase') not in ('CLAIMED',) and existing.get('claimed_at'):
                return {'status': 'duplicate_ignored', 'claim': existing,
                        'claim_path': str(claim_file)}
        claim = claim_admission(admission, results_root=root)
        # Optional immediate execute when adapters provided (API/tests/host wake).
        if event.get('execute') or (adapters.author and adapters.qa):
            try:
                return execute_claim(admission, adapters, results_root=root, config=config,
                                    parent_lease=parent_lease)
            except LeanError as err:
                if err.code == 'no_automatic_paid_replay':
                    return {'status': 'hold', 'code': err.code, 'detail': err.detail,
                            'claim': read_receipt(claim_file), 'claim_path': str(claim_file)}
                raise
        return {'status': 'admitted', 'claim': claim, 'claim_path': str(claim_file)}

    if name == 'schedule':
        return advance_queue(adapters, results_root=root, config=config,
                             parent_lease=parent_lease, limit=limit)

    if name == 'workflow_dispatch':
        action = (event.get('inputs') or {}).get('action') or 'status'
        if action == 'status':
            return {'status': 'ok', 'projection': mode_b_status_projection(last_event='dispatch',
                                                                          config=config)}
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
        if action in ('advance', 'run', 'lean'):
            return advance_queue(adapters, results_root=root, config=config,
                                 parent_lease=parent_lease, limit=limit)
        return {'status': 'dispatch', 'action': action}

    return {'status': 'ignored', 'event': name}


def main(argv=None):
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
            'effectful': True,
            'installed': False,
        }, sort_keys=True))
        return 0
    event = loads(Path(argv[0]).read_bytes())
    result = run_once(event)
    print(json.dumps(result, sort_keys=True))
    return 0 if result.get('status') not in ('denied',) else 1


if __name__ == '__main__':
    raise SystemExit(main())

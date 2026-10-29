#!/usr/bin/env python3
"""Lean Mode B finite controller: admit → claim → author → QA → CI → DEV.

One bounded host run. Canonical product queue = GitHub Project #1 ∩ Owner
admission comments (Issue #175). Durable receipts live under
/var/lib/gobadminton-lean/results — not a task DB. C5 stays off. Stdlib only.
Live host loads trusted default bindings from live.py; unit tests inject fakes.
No parallel demo controller. No PMA per-Issue Python hook injection required.
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
# OD018 signed Owner comment on #182 (2026-10-28). Supersedes older 182 OFF
# prospectively for guarded DEV only — never a global allow or JSON rewrite.
OD018_SIGNED_COMMENT_ID = 6483075322
OD018_QUEUE = (182, 372, 373)
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
# RUNNING/UNKNOWN block automatic paid replay. WAITING_* are durable external
# waits resumed on next wake by re-reading GitHub — not UNKNOWN and not RUNNING.
ACTIVE_HOLD_PHASES = frozenset({'RUNNING', 'UNKNOWN'})
WAITING_PHASES = frozenset({'WAITING_CI', 'WAITING_DEPLOY', 'WAKE_RESUME'})
# Default host wake budget fits Actions 45m client; stages resume at safe points.
DEFAULT_WAKE_BUDGET_S = 2400


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


def od018_prospective_release(issue, comments):
    """Exact prospective OD018 release for #182 guarded DEV admissions.

    Requires numeric Owner identity on the signed comment (or a later Owner
    comment that cites that id + OD018/OD-017 supersession scope) and a DEV
    envelope. Old admissions / holds without this evidence stay protected.
    Does not rewrite comment JSON history and is not a global 182 allow.
    """
    number = int(issue.get('number') or 0)
    if number != HOLD_ISSUE:
        return False, 'not_182'
    if str(issue.get('state') or '').lower() == 'closed':
        return False, 'issue_closed'
    signed = False
    for c in comments or []:
        user = c.get('user') or {}
        if user.get('id') != OWNER_ID:
            continue
        body = str(c.get('body') or '')
        cid = c.get('id')
        try:
            cid_int = int(cid)
        except (TypeError, ValueError):
            cid_int = None
        is_signed = cid_int == OD018_SIGNED_COMMENT_ID
        cites_signed = (
            str(OD018_SIGNED_COMMENT_ID) in body
            or f'issuecomment-{OD018_SIGNED_COMMENT_ID}' in body
        )
        od_mark = (
            'OD018' in body or 'OD-018' in body
            or ('OD-017' in body and ('SUPERSEDE' in body.upper() or 'Supersedes' in body))
        )
        dev_env = (
            'DEV ADMISSION' in body
            or 'guarded DEV' in body
            or 'target": "dev"' in body
            or 'target\': \'dev\'' in body
            or '"target":"dev"' in body
            or ('DEV' in body and 'PROD' in body and 'not permission for PROD' in body.lower())
            or ('dev' in body.lower() and 'no prod' in body.lower())
        )
        if is_signed and ('Supersedes' in body or 'SUPERSEDE' in body.upper()) and (
                'DEV' in body or 'dev' in body):
            signed = True
            break
        if cites_signed and od_mark and (dev_env or 'dev' in body.lower()):
            signed = True
            break
    if not signed:
        return False, 'issue_182_hard_hold'
    return True, 'od018_prospective_dev'


def owner_hold_markers(issue, comments, config=None):
    """Explicit Owner hold / closed / 182 prospective-deny stops admission."""
    if issue.get('state') == 'closed':
        return True, 'issue_closed'
    number = int(issue.get('number') or 0)
    od018_ok = False
    if number == HOLD_ISSUE:
        od018_ok, od018_why = od018_prospective_release(issue, comments)
        if not od018_ok:
            return True, od018_why or 'issue_182_hard_hold'
    cfg = config or {}
    if cfg.get(HOLD_CONFIG_KEY) is False:
        # Capability flag OFF still blocks non-OD018 182 / false-flag chatter;
        # OD018 prospective DEV source admission is authorized while the flag
        # remains OFF until gated release (signed scope).
        if number == HOLD_ISSUE and od018_ok:
            pass
        elif number == HOLD_ISSUE or any(
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
    # #182: prospective Owner release must not retroactively admit old machine
    # comments. Require a NEW admission comment id > signed authority and an
    # explicit task.owner_authority_comment binding. Do not rewrite old snapshots.
    if int(issue['number']) == HOLD_ISSUE:
        try:
            cid = int(comment['id'])
        except (TypeError, ValueError):
            raise LeanError('admission_hold', 'issue_182_stale_machine_comment')
        if cid <= OD018_SIGNED_COMMENT_ID:
            raise LeanError('admission_hold', 'issue_182_stale_machine_comment')
        try:
            auth = int(task.get('owner_authority_comment'))
        except (TypeError, ValueError):
            auth = None
        if auth != OD018_SIGNED_COMMENT_ID:
            raise LeanError('admission_hold', 'issue_182_owner_authority_required')
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

    Writer lease ≠ integration lock. Do NOT hold integration.lock across
    author/CI/DEV waits (DEV may need the same integration lock). Narrow
    IntegrationLock is used only around merge.
    """

    def __init__(self, issue, allowed_paths, *, parent_owns=False, registry=None,
                 lock_dir=None, integration_lock=None):
        self.issue = int(issue)
        self.allowed_paths = list(allowed_paths)
        self.parent_owns = parent_owns
        self.registry = registry
        self.lock_dir = Path(lock_dir) if lock_dir else SOURCE_LOCK_DIR
        # integration_lock path is recorded for callers; WriterLease itself never
        # opens host-protected integration.lock (avoids unit-test PermissionError
        # and long waits holding the merge mutex).
        self.integration_lock_path = (
            Path(integration_lock) if integration_lock is not None else None)
        self._owned = False
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
        return True

    def release(self):
        if self._owned and self.registry_obj is not None:
            try:
                self.registry_obj.release()
            except Exception:
                pass
            self._owned = False


class IntegrationLock:
    """Narrow trusted integration mutex for merge only — not for CI/DEV waits."""

    def __init__(self, path=None):
        self.path = Path(path) if path else INTEGRATION_LOCK
        self._fd = None

    def acquire(self):
        try:
            fd = os.open(str(self.path), os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError:
            self._fd = None
            return True
        except PermissionError as err:
            raise LeanError('integration_lock_unreadable', str(self.path)) from err
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            raise LeanError('integration_lock_busy') from None
        self._fd = fd
        return True

    def release(self):
        if self._fd is not None:
            try:
                os.close(self._fd)
            except OSError:
                pass
            self._fd = None

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *exc):
        self.release()
        return False


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
    """Addressed git diff check before QA; no model call.

    Uses live.git (UID1002 drop) — never Root direct subprocess or safe.directory.
    """
    _need(isinstance(base_sha, str) and SHA40.fullmatch(base_sha), 'preqa_base_sha_required', str(base_sha))
    import live as lean_live
    head = lean_live.git(worktree, 'rev-parse', 'HEAD')
    status = lean_live.git(worktree, 'status', '--porcelain')
    changed = []
    for line in (status or '').splitlines():
        if not line.strip():
            continue
        path = line[3:].strip()
        if ' -> ' in path:
            path = path.split(' -> ', 1)[1]
        changed.append(path)
    if not changed:
        diff = lean_live.git(worktree, 'diff', '--name-only', base_sha, 'HEAD')
        changed = [p for p in (diff or '').splitlines() if p]
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
    """Injectable side effects. Tests inject fakes; live host uses live.py defaults."""

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
        self.resolve_worktree = hooks.get('resolve_worktree')
        self.validate_worktree = hooks.get('validate_worktree')
        self.reuse_worktree = hooks.get('reuse_worktree')
        self.read_head = hooks.get('read_head')
        self.project_status = hooks.get('project_status')
        self.lock_registry = hooks.get('lock_registry')
        self.lock_dir = hooks.get('lock_dir')
        self.integration_lock = hooks.get('integration_lock')
        self.preqa_diff = hooks.get('preqa_diff')
        self.evidence_dir = hooks.get('evidence_dir')
        self.deadline = hooks.get('deadline')
        self.now = hooks.get('now') or (lambda: int(time.time()))


def default_live_adapters(*, deadline=None, results_root=None):
    """Load trusted LIVE bindings for real host run. Tests must not call this
    without patching — they construct Adapters with fakes explicitly."""
    import live as lean_live
    return lean_live.build_live_adapters(
        results_root=results_root, deadline=deadline)


def _remaining(adapters):
    if adapters.deadline is None:
        return None
    return max(0, float(adapters.deadline) - time.monotonic())


# Completion margin after model timeout so host (wake_budget+60) can collect
# raw/receipt and release the writer lease before Actions forcibly kills.
WAKE_STAGE_MARGIN_S = 60
# Mirrored from live.py stage timeouts — avoid importing live at module load.
_AUTHOR_STAGE_NEED_S = 1200 + WAKE_STAGE_MARGIN_S
_QA_STAGE_NEED_S = 1800 + WAKE_STAGE_MARGIN_S


def _wake_budget_exhausted(adapters, stage):
    """Defer paid stage unless remaining covers actual launch timeout + margin.

    author/repair → AUTHOR_TIMEOUT(1200)+margin; qa → QA_TIMEOUT(1800)+margin;
    other short stages keep the prior 45s floor. No deadline ⇒ not exhausted.
    """
    rem = _remaining(adapters)
    if rem is None:
        return False
    if stage in ('author', 'repair', 'claim'):
        return rem < _AUTHOR_STAGE_NEED_S
    if stage == 'qa':
        return rem < _QA_STAGE_NEED_S
    return rem < 45


def _evidence_dir(adapters, claim, results_root):
    """Evidence root for one Issue/revision — attempt folders live under it.

    Host may supply a parent evidence_dir; always namespace by issue/revision so
    independent claims never share author-attempt-N / qa-* raw paths.
    """
    if adapters.evidence_dir:
        base = (Path(adapters.evidence_dir)
                / f'issue-{claim["issue"]}' / claim['revision'][:16])
    else:
        base = Path(results_root) / f'issue-{claim["issue"]}' / claim['revision'][:16] / 'evidence'
    base.mkdir(parents=True, exist_ok=True)
    return base


def _author_attempt_dir(evidence_root, attempt_n):
    """Unique author-attempt-N folder under the existing evidence root."""
    d = Path(evidence_root) / f'author-attempt-{int(attempt_n)}'
    d.mkdir(parents=True, exist_ok=True)
    return d


def _qa_candidate_dir(evidence_root, candidate_sha, provider='codex'):
    """Unique QA candidate folder; never reuse raw paths across SHA/provider."""
    tag = (candidate_sha or 'unknown')[:12]
    d = Path(evidence_root) / f'qa-{provider}-{tag}'
    d.mkdir(parents=True, exist_ok=True)
    return d


def _read_worktree_head(adapters, worktree):
    """Actual HEAD under UID1002 live.git; adapters.read_head for unit fakes."""
    if getattr(adapters, 'read_head', None):
        head = adapters.read_head(worktree)
        _need(isinstance(head, str) and SHA40.fullmatch(head), 'worktree_head_invalid', str(head))
        return head
    import live as lean_live
    head = lean_live.git(worktree, 'rev-parse', 'HEAD')
    _need(isinstance(head, str) and SHA40.fullmatch(head), 'worktree_head_invalid', str(head))
    return head


def _ensure_frozen_runtime(claim, path, adapters, task):
    """Resolve worktree ONCE; persist clean initial HEAD as base_sha before paid launch.

    Admission task/revision are never rewritten. Missing task.base is normal —
    freeze actual verified HEAD (origin/dev via create). Never 000… fallback.
    Later preqa/QA/repair reuse claim.worktree + claim.base_sha.
    """
    frozen_wt = claim.get('worktree')
    frozen_base = claim.get('base_sha')
    if (
        isinstance(frozen_wt, str) and frozen_wt
        and isinstance(frozen_base, str) and SHA40.fullmatch(frozen_base)
    ):
        runtime = dict(claim.get('runtime') or {})
        runtime.update({'worktree': frozen_wt, 'base_sha': frozen_base})
        # Reuse: validate expected current HEAD (candidate after author, else base).
        expected = claim.get('candidate_sha') or frozen_base
        if getattr(adapters, 'validate_worktree', None):
            adapters.validate_worktree(frozen_wt, expected_head=expected)
        elif adapters.worktree and getattr(adapters, 'reuse_worktree', None):
            adapters.reuse_worktree(dict(task, worktree=frozen_wt, base=frozen_base,
                                         expected_head=expected, candidate_sha=claim.get('candidate_sha')))
        else:
            try:
                import live as lean_live
                lean_live.validate_frozen_worktree(
                    frozen_wt, expected_head=expected, base_sha=frozen_base)
            except ImportError:
                pass
            except Exception as err:
                code = getattr(err, 'code', None) or type(err).__name__
                raise LeanError(code if isinstance(code, str) else 'worktree_reuse_hold', str(err)) from err
        if claim.get('runtime') != runtime:
            claim = mark_phase(path, claim.get('phase') or 'CLAIMED',
                               worktree=frozen_wt, base_sha=frozen_base, runtime=runtime)
        return claim, frozen_wt, frozen_base

    # First resolve for this claim — paid launch must not start without freeze.
    if getattr(adapters, 'resolve_worktree', None):
        resolved = adapters.resolve_worktree(task)
        _need(isinstance(resolved, dict), 'worktree_resolve_invalid')
        worktree = resolved.get('worktree')
        base_sha = resolved.get('base_sha')
    else:
        worktree = adapters.worktree(task) if adapters.worktree else task.get('worktree')
        _need(worktree, 'worktree_required')
        # Prefer explicit prepared/base only when already a real SHA; else read HEAD.
        prepared = task.get('base') or task.get('prepared_base')
        if isinstance(prepared, str) and SHA40.fullmatch(prepared):
            # create_task_worktree already validated HEAD==prepared when present.
            base_sha = prepared
            # Still confirm actual HEAD matches (or capture if adapter created from origin/dev).
            try:
                actual = _read_worktree_head(adapters, worktree)
            except LeanError:
                actual = prepared
            if actual != prepared:
                # Fresh create from missing base freezes actual origin/dev HEAD.
                base_sha = actual
        else:
            base_sha = _read_worktree_head(adapters, worktree)
    _need(worktree, 'worktree_required')
    _need(isinstance(base_sha, str) and SHA40.fullmatch(base_sha), 'base_sha_unresolved', str(base_sha))
    runtime = {
        'worktree': str(worktree),
        'base_sha': base_sha,
        'publication_branch': task.get('publication_branch'),
        'existing_pr': task.get('existing_pr'),
    }
    claim = mark_phase(
        path, claim.get('phase') or 'CLAIMED',
        worktree=str(worktree), base_sha=base_sha, runtime=runtime,
        publication_branch=task.get('publication_branch'),
        existing_pr=task.get('existing_pr'),
    )
    return claim, str(worktree), base_sha


def fetch_owner_admissions(gh_api, *, config=None):
    """Deprecated open-Issues scan — NOT the canonical Mode B queue.

    Live path must use live.fetch_project_admissions (Project GraphQL). This
    helper remains only for explicit test injection via adapters.gh_api when
    adapters.fetch_admissions is absent. It never substitutes for a failed
    Project read (that must be queue_unavailable + zero calls).
    """
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
                  max_repair=None):
    """Finite resumable flow for one admitted Issue. Same path for live + tests.

    OD-016: no arbitrary productive author-pass ceiling. Bound a finite WAKE by
    deadline/remaining time; resume at safe completed stage. Preserve attempts /
    fingerprints; two non-progress halts stop strategy. Controlled FAIL findings
    propagate into the same worktree/PR/history author prompt.
    """
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
        integration_lock=adapters.integration_lock,
    )
    lease.acquire()
    try:
        # Resume durable external waits without marking RUNNING/UNKNOWN.
        claim = read_receipt(path)
        if claim.get('phase') == 'WAITING_CI':
            if not adapters.wait_ci:
                raise LeanError('ci_adapter_required')
            ci = adapters.wait_ci(claim)
            if ci.get('waiting'):
                claim = mark_phase(path, 'WAITING_CI', stage='wait_ci', ci=ci)
                return {'status': 'wake_resume', 'claim': claim, 'claim_path': str(path),
                        'reason': 'waiting_ci'}
            if ci.get('ok'):
                if ci.get('head_sha') and ci['head_sha'] != claim.get('candidate_sha'):
                    mark_phase(path, 'BLOCKED', stage='wait_ci', ci=ci, error='ci_head_mismatch')
                    raise LeanError('ci_head_mismatch', ci.get('head_sha'))
                claim = mark_phase(path, 'CI_PASS', stage='wait_ci', ci=ci)
            elif ci.get('repairable'):
                findings = list(ci.get('findings') or ['ci_failed'])
                claim = mark_phase(
                    path, 'QA_FAIL', stage='repair', ci=ci,
                    last_qa={'verdict': 'FAIL', 'findings': findings,
                             'reviewed_sha': claim.get('candidate_sha'),
                             'fingerprint': None, 'charge': 'none', 'source': 'product_ci'},
                    repair_findings=findings)
            else:
                mark_phase(path, 'BLOCKED', stage='wait_ci', ci=ci)
                return {'status': 'blocked', 'claim': read_receipt(path), 'claim_path': str(path),
                        'reason': 'ci'}

        claim = read_receipt(path)
        if claim.get('phase') == 'WAITING_DEPLOY':
            if not adapters.deploy:
                raise LeanError('deploy_adapter_required')
            dep = adapters.deploy(claim)
            if dep.get('waiting'):
                claim = mark_phase(path, 'WAITING_DEPLOY', stage='wait_deploy', dev=dep)
                return {'status': 'wake_resume', 'claim': claim, 'claim_path': str(path),
                        'reason': 'waiting_deploy'}
            accepted = bool(dep.get('accepted')) and dep.get('live_sha') == claim.get('merged_sha')
            if not accepted:
                mark_phase(path, 'BLOCKED', stage='wait_deploy', dev=dep)
                return {'status': 'blocked', 'claim': read_receipt(path), 'claim_path': str(path),
                        'reason': 'deploy'}
            claim = mark_phase(path, 'DEV_ACCEPTED', stage='wait_deploy', dev=dep)

        # --- author (CLAIMED / QA_FAIL repair / CI repair / wake resume) ---
        claim = read_receipt(path)
        if claim.get('phase') == 'WAKE_RESUME' and claim.get('stage') == 'publish_pr':
            # Resume after deadline mid-publish: redo publish from PREQA_OK.
            claim = mark_phase(path, 'PREQA_OK', stage='preqa_diff',
                               candidate_sha=claim.get('candidate_sha'))
        if claim.get('phase') == 'WAKE_RESUME' and claim.get('stage') == 'qa':
            # Restore eligible CI_PASS for ordinary deferred QA / capacity fallback.
            # Without this, wake skips every branch and returns DEV_ACCEPTED path
            # incorrectly (no QA/merge/deploy). Verify retained candidate + CI SHA.
            cand = claim.get('candidate_sha')
            ci = claim.get('ci') or {}
            if not (isinstance(cand, str) and SHA40.fullmatch(cand)):
                mark_phase(path, 'BLOCKED', stage='qa', error='resume_candidate_missing')
                return {'status': 'blocked', 'claim': read_receipt(path),
                        'claim_path': str(path), 'reason': 'resume_candidate'}
            if ci.get('head_sha') and ci['head_sha'] != cand:
                mark_phase(path, 'BLOCKED', stage='wait_ci', ci=ci,
                           error='ci_head_mismatch')
                raise LeanError('ci_head_mismatch', ci.get('head_sha'))
            claim = mark_phase(
                path, 'CI_PASS', stage='wait_ci', ci=ci,
                candidate_sha=cand,
                resume_provider=claim.get('resume_provider'),
                resume_operation=claim.get('resume_operation'),
                wake=claim.get('wake'),
                runtime=claim.get('runtime'))
        _resume_author = (
            claim.get('phase') == 'WAKE_RESUME'
            and claim.get('stage') in ('claim', 'author', 'repair', None)
        )
        if claim.get('phase') in ('CLAIMED', 'QA_FAIL') or _resume_author:
            if _wake_budget_exhausted(adapters, 'author'):
                claim = mark_phase(path, 'WAKE_RESUME', stage=claim.get('stage') or 'author',
                                   wake='deadline')
                return {'status': 'wake_resume', 'claim': claim, 'claim_path': str(path),
                        'reason': 'deadline'}
            # Freeze worktree/base_sha ONCE before any paid author launch.
            claim, worktree, base_sha = _ensure_frozen_runtime(claim, path, adapters, task)
            claim['attempts'] = dict(claim.get('attempts') or {})
            claim['attempts']['author'] = int(claim['attempts'].get('author') or 0) + 1
            author_n = int(claim['attempts']['author'])
            author_evidence = _author_attempt_dir(evidence, author_n)
            # Propagate exact findings into author task (same worktree/PR/history).
            findings = list(claim.get('repair_findings')
                            or (claim.get('last_qa') or {}).get('findings')
                            or [])
            if findings:
                task['repair_findings'] = findings
                task['findings'] = findings
            # Runtime context for author — do not rewrite admission task.base/revision.
            task['worktree'] = worktree
            task['runtime_base_sha'] = base_sha
            mark_phase(path, 'RUNNING', stage='author', attempts=claim['attempts'],
                       repair_findings=findings or None,
                       worktree=str(worktree), base_sha=base_sha,
                       author_evidence_dir=str(author_evidence),
                       evidence_root=str(evidence))
            try:
                if adapters.author:
                    author_result = invoke_cursor_author(
                        task=task, worktree=worktree, evidence_dir=author_evidence,
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
                               reviewed_candidate_sha=candidate_sha,
                               author_changed=author_result.get('changed_paths') or [],
                               attempts=claim['attempts'], worktree=str(worktree),
                               base_sha=base_sha,
                               author_evidence_dir=str(author_evidence),
                               evidence_root=str(evidence))

        # --- preqa diff ---
        claim = read_receipt(path)
        if claim.get('phase') == 'AUTHOR_DONE':
            # Immutable frozen runtime — never recreate worktree / never 000 SHA.
            base_sha = claim.get('base_sha')
            _need(isinstance(base_sha, str) and SHA40.fullmatch(base_sha),
                  'base_sha_unresolved', str(base_sha))
            worktree = claim.get('worktree') or task.get('worktree')
            _need(worktree, 'worktree_required')
            # Validate candidate HEAD + clean; do not call adapters.worktree again.
            if getattr(adapters, 'validate_worktree', None):
                adapters.validate_worktree(
                    worktree, expected_head=claim.get('candidate_sha') or base_sha)
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
                               candidate_sha=diff.get('head') or claim.get('candidate_sha'),
                               reviewed_candidate_sha=diff.get('head') or claim.get('candidate_sha'),
                               worktree=str(worktree), base_sha=base_sha)

        # --- publish PR (UID1002 gh, not GITHUB_TOKEN) ---
        claim = read_receipt(path)
        if claim.get('phase') == 'PREQA_OK':
            if _wake_budget_exhausted(adapters, 'publish_pr'):
                claim = mark_phase(path, 'WAKE_RESUME', stage='publish_pr', wake='deadline')
                return {'status': 'wake_resume', 'claim': claim, 'claim_path': str(path),
                        'reason': 'deadline'}
            mark_phase(path, 'RUNNING', stage='publish_pr')
            pub_branch = (
                claim.get('publication_branch')
                or task.get('publication_branch')
                or (claim.get('runtime') or {}).get('publication_branch')
            )
            existing_pr = (
                claim.get('existing_pr')
                or task.get('existing_pr')
                or (claim.get('runtime') or {}).get('existing_pr')
            )
            try:
                if adapters.publish:
                    pub = invoke_trusted_publish(
                        kind='push_pr',
                        payload={
                            'issue': claim['issue'],
                            'sha': claim['candidate_sha'],
                            'allowed_paths': task['allowed_paths'],
                            'worktree': claim.get('worktree') or task.get('worktree'),
                            'base_sha': claim.get('base_sha'),
                            'publication_branch': pub_branch,
                            'existing_pr': existing_pr,
                        },
                        evidence_dir=evidence, publisher=adapters.publish)
                else:
                    raise LeanError('publish_adapter_required')
            except ProviderError as err:
                if 'unknown' in err.code or err.charge == 'unknown':
                    mark_phase(path, 'UNKNOWN', stage='publish_pr', error=err.code)
                    raise LeanError('no_automatic_paid_replay', 'UNKNOWN') from err
                mark_phase(path, 'BLOCKED', stage='publish_pr', error=err.code)
                raise
            claim = mark_phase(path, 'PR_OPEN', stage='publish_pr',
                               pr=pub.get('pr'),
                               candidate_sha=pub.get('head_sha') or claim['candidate_sha'],
                               reviewed_candidate_sha=pub.get('head_sha') or claim['candidate_sha'],
                               publication_branch=pub.get('branch') or pub_branch,
                               existing_pr=existing_pr,
                               publish=pub)

        # --- Product CI all7 exact head (durable WAITING_CI, not RUNNING) ---
        claim = read_receipt(path)
        if claim.get('phase') == 'PR_OPEN':
            if not adapters.wait_ci:
                raise LeanError('ci_adapter_required')
            claim = mark_phase(path, 'WAITING_CI', stage='wait_ci')
            # Release writer before long CI wait? Keep lease for same-wake continue;
            # durable WAITING_CI lets next wake resume without UNKNOWN.
            ci = adapters.wait_ci(claim)
            if ci.get('waiting'):
                claim = mark_phase(path, 'WAITING_CI', stage='wait_ci', ci=ci)
                return {'status': 'wake_resume', 'claim': claim, 'claim_path': str(path),
                        'reason': 'waiting_ci'}
            if ci.get('ok'):
                if ci.get('head_sha') and ci['head_sha'] != claim.get('candidate_sha'):
                    mark_phase(path, 'BLOCKED', stage='wait_ci', ci=ci, error='ci_head_mismatch')
                    raise LeanError('ci_head_mismatch', ci.get('head_sha'))
                claim = mark_phase(path, 'CI_PASS', stage='wait_ci', ci=ci)
            elif ci.get('repairable'):
                findings = list(ci.get('findings') or ['ci_failed'])
                claim = mark_phase(
                    path, 'QA_FAIL', stage='repair', ci=ci,
                    last_qa={'verdict': 'FAIL', 'findings': findings,
                             'reviewed_sha': claim.get('candidate_sha'),
                             'fingerprint': None, 'charge': 'none', 'source': 'product_ci'},
                    repair_findings=findings)
                # Same worktree/PR/history; recurse into author repair (no numeric ceiling).
                if _wake_budget_exhausted(adapters, 'repair'):
                    claim = mark_phase(path, 'WAKE_RESUME', stage='repair', wake='deadline')
                    return {'status': 'wake_resume', 'claim': claim, 'claim_path': str(path),
                            'reason': 'deadline'}
                return execute_claim(admission, adapters, results_root=root, config=config,
                                    parent_lease=True)
            else:
                mark_phase(path, 'BLOCKED', stage='wait_ci', ci=ci)
                return {'status': 'blocked', 'claim': read_receipt(path), 'claim_path': str(path),
                        'reason': 'ci'}

        # --- independent QA ---
        claim = read_receipt(path)
        if claim.get('phase') == 'CI_PASS':
            if _wake_budget_exhausted(adapters, 'qa'):
                claim = mark_phase(path, 'WAKE_RESUME', stage='qa', wake='deadline',
                                   resume_provider=claim.get('resume_provider'),
                                   resume_operation=claim.get('resume_operation'))
                return {'status': 'wake_resume', 'claim': claim, 'claim_path': str(path),
                        'reason': 'deadline'}
            resume_provider = claim.get('resume_provider')
            if resume_provider == 'agy_qa':
                # Codex capacity already done on prior wake — AGY only, no Codex rerun.
                provider, reason = 'agy_qa', 'capacity_fallback_resume'
            else:
                provider, reason, _meta = select_qa_provider(task, issue=claim['issue'])
            claim['attempts'] = dict(claim.get('attempts') or {})
            claim['attempts']['qa'] = int(claim['attempts'].get('qa') or 0) + 1
            qa_evidence = _qa_candidate_dir(
                evidence, claim['candidate_sha'],
                provider=('agy' if provider == 'agy_qa' else 'codex'))
            runtime = dict(claim.get('runtime') or {})
            runtime.update({
                'worktree': claim.get('worktree'),
                'base_sha': claim.get('base_sha'),
                'candidate_sha': claim.get('candidate_sha'),
                'evidence_root': str(evidence),
                'qa_evidence_dir': str(qa_evidence),
                'resume_provider': resume_provider,
            })
            mark_phase(path, 'RUNNING', stage='qa', qa_provider=provider, qa_route_reason=reason,
                       attempts=claim['attempts'], qa_evidence_dir=str(qa_evidence),
                       resume_provider=resume_provider,
                       runtime=runtime)
            # Feed immutable frozen runtime to QA — never recreate worktree from raw task.
            qa_task = dict(task)
            qa_task['worktree'] = claim.get('worktree')
            qa_task['runtime_base_sha'] = claim.get('base_sha')
            if resume_provider == 'agy_qa':
                qa_task['qaroute'] = ['agy_qa']
            try:
                if adapters.qa:
                    raw = adapters.qa(dict(
                        claim, qa_provider=provider, task=qa_task,
                        worktree=claim.get('worktree'),
                        base_sha=claim.get('base_sha'),
                        evidence_dir=str(qa_evidence),
                        evidence_root=str(evidence),
                        resume_provider=resume_provider,
                        runtime=runtime,
                    ))
                else:
                    raw = invoke_codex_qa(
                        task=qa_task, candidate_sha=claim['candidate_sha'],
                        evidence_dir=qa_evidence, launcher=None)
            except ProviderError as err:
                if err.code == 'wake_defer_capacity_fallback':
                    # Codex capacity already charged; persist next AGY operation —
                    # no AGY paid call this wake; next wake skips Codex.
                    claim = mark_phase(
                        path, 'WAKE_RESUME', stage='qa',
                        wake='capacity_fallback_budget', error=err.code,
                        resume_provider='agy_qa',
                        resume_operation='agy_capacity_fallback',
                        attempts=claim['attempts'],
                        candidate_sha=claim.get('candidate_sha'),
                        runtime=runtime)
                    return {'status': 'wake_resume', 'claim': claim,
                            'claim_path': str(path), 'reason': 'deadline'}
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
            # Clear one-shot capacity resume after actual QA completed.
            if claim.get('resume_provider'):
                claim.pop('resume_provider', None)
                claim.pop('resume_operation', None)
            claim['attempts'] = claim.get('attempts') or {}
            if claim.get('phase') == 'QA_FAIL':
                claim['repair_findings'] = list(verdict.get('findings') or [])
            write_receipt(path, claim)

            if claim.get('phase') == 'STRATEGY_HALT':
                return {'status': 'strategy_halt', 'claim': claim, 'claim_path': str(path)}
            if claim.get('phase') == 'QA_FAIL':
                # OD-016: no arbitrary productive numeric ceiling. Bound by wake
                # deadline and two-fingerprint non-progress halt only.
                if max_repair is not None and int(claim['attempts'].get('author') or 0) >= int(max_repair):
                    # Optional explicit bound only when caller passes max_repair;
                    # live default is None (deadline / fingerprint halt).
                    mark_phase(path, 'BLOCKED', stage='repair', error='repair_bound')
                    return {'status': 'blocked', 'claim': read_receipt(path), 'claim_path': str(path),
                            'reason': 'repair_bound'}
                if _wake_budget_exhausted(adapters, 'repair'):
                    claim = mark_phase(path, 'WAKE_RESUME', stage='repair', wake='deadline',
                                       repair_findings=claim.get('repair_findings'))
                    return {'status': 'wake_resume', 'claim': claim, 'claim_path': str(path),
                            'reason': 'deadline'}
                return execute_claim(admission, adapters, results_root=root, config=config,
                                    parent_lease=True, max_repair=max_repair)

        # --- merge dev: retain candidate SHA; capture distinct merge SHA ---
        claim = read_receipt(path)
        if claim.get('phase') == 'QA_PASS':
            if not adapters.merge:
                raise LeanError('merge_adapter_required')
            mark_phase(path, 'RUNNING', stage='merge_dev')
            integ = IntegrationLock(adapters.integration_lock)
            try:
                integ.acquire()
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
            finally:
                integ.release()
            merge_sha = merged.get('merged_sha') or merged.get('merge_sha')
            _need(isinstance(merge_sha, str) and SHA40.fullmatch(merge_sha),
                  'merge_sha_missing', str(merge_sha))
            # Normal GitHub merge creates a NEW commit — candidate may differ.
            # Retain reviewed candidate; deploy/live must match MERGED SHA.
            reviewed = claim.get('reviewed_candidate_sha') or claim.get('candidate_sha')
            if merged.get('candidate_sha') and merged['candidate_sha'] != reviewed:
                raise LeanError('merge_candidate_drift', str(merged.get('candidate_sha')))
            claim = mark_phase(
                path, 'MERGED', stage='merge_dev', merge=merged,
                merged_sha=merge_sha, merge_sha=merge_sha,
                reviewed_candidate_sha=reviewed,
                candidate_sha=reviewed)

        # --- DEV deploy + ACCEPTED/liveSHA == MERGED SHA ---
        claim = read_receipt(path)
        if claim.get('phase') == 'MERGED':
            if not adapters.deploy:
                raise LeanError('deploy_adapter_required')
            claim = mark_phase(path, 'WAITING_DEPLOY', stage='wait_deploy')
            dep = adapters.deploy(claim)
            if dep.get('waiting'):
                claim = mark_phase(path, 'WAITING_DEPLOY', stage='wait_deploy', dev=dep)
                return {'status': 'wake_resume', 'claim': claim, 'claim_path': str(path),
                        'reason': 'waiting_deploy'}
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


def _scan_resumable(results_root):
    """Durable WAITING_*/WAKE_RESUME claims — next wake rereads GitHub external state."""
    root = Path(results_root)
    found = []
    if not root.exists():
        return found
    for path in root.glob('issue-*/**/claim.json'):
        rec = read_receipt(path)
        if rec and rec.get('phase') in WAITING_PHASES:
            found.append(rec)
    found.sort(key=lambda r: int(r.get('claimed_at') or 0))
    return found


def advance_queue(adapters, *, results_root, config=None, parent_lease=False, limit=2):
    """Process next admitted issues automatically after DONE/UAT handoff.

    Auto-next is real (not mock): after DEV ACCEPTED / UAT pending, continue to
    the next independently eligible Project admission without PMA GO.
    """
    holds = _scan_holds(results_root)
    if holds:
        return {'status': 'schedule_reconcile', 'holds': holds,
                'projection': mode_b_status_projection(last_event='schedule_hold', config=config)}

    results = []
    # Resume durable waits first (same Issue/PR/history; no UNKNOWN replay).
    for rec in _scan_resumable(results_root):
        adm = {
            'issue': rec['issue'],
            'revision': rec['revision'],
            'comment_id': rec.get('comment_id'),
            'task': rec.get('task') or {},
        }
        out = execute_claim(adm, adapters, results_root=results_root, config=config,
                            parent_lease=parent_lease)
        results.append(out)
        if out.get('status') == 'wake_resume':
            break
        if out.get('status') in ('strategy_halt', 'blocked'):
            break

    try:
        if adapters.fetch_admissions:
            admissions = adapters.fetch_admissions()
        elif adapters.gh_api:
            # Explicit test-only fallback; live adapters always set fetch_admissions.
            admissions = fetch_owner_admissions(adapters.gh_api, config=config)
        else:
            return {'status': 'no_admissions_source', 'results': results,
                    'projection': mode_b_status_projection(last_event='schedule', config=config)}
    except LeanError as err:
        if err.code == 'queue_unavailable':
            return {
                'status': 'queue_unavailable',
                'code': err.detail or 'PROJECT_ACCESS_NOT_VERIFIED',
                'calls': 0,
                'results': results,
                'projection': mode_b_status_projection(last_event='queue_unavailable',
                                                       config=config),
            }
        raise

    done, uat, blocked = _collect_done_uat_blocked(results_root)
    # Exclude issues already handled this wake.
    for r in results:
        issue = (r.get('claim') or {}).get('issue')
        if issue is not None:
            done.add(int(issue))
    remaining = max(0, int(limit) - len([r for r in results if r.get('status') == 'dev_accepted_uat_pending']))
    for _ in range(max(0, remaining) if results else max(1, int(limit))):
        if results and results[-1].get('status') == 'wake_resume':
            break
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
        elif out.get('status') == 'wake_resume':
            break
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
             parent_lease=False, limit=2, use_live_defaults=None):
    """Same entrypoint for schedule / comment / dispatch / recovery / API tests.

    Host main loads LIVE defaults. Unit tests pass adapters= explicitly
    (use_live_defaults=False) so no PMA hook injection and no live calls.
    """
    name = event.get('event_name') or event.get('name') or 'workflow_dispatch'
    root = Path(results_root) if results_root else RESULTS
    root.mkdir(parents=True, exist_ok=True)
    if adapters is None:
        # Real host path: trusted live bindings. Tests always pass adapters=.
        if use_live_defaults is False:
            adapters = Adapters(gh_api=gh_api)
        else:
            deadline = time.monotonic() + float(
                event.get('wake_budget_s') or DEFAULT_WAKE_BUDGET_S)
            adapters = default_live_adapters(deadline=deadline, results_root=root)
            adapters.deadline = deadline
    if gh_api and adapters.gh_api is None:
        adapters.gh_api = gh_api
    if adapters.deadline is None and event.get('wake_budget_s'):
        adapters.deadline = time.monotonic() + float(event['wake_budget_s'])

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
            if existing.get('phase') in WAITING_PHASES:
                try:
                    return execute_claim(admission, adapters, results_root=root, config=config,
                                        parent_lease=parent_lease)
                except LeanError as err:
                    if err.code == 'no_automatic_paid_replay':
                        return {'status': 'hold', 'code': err.code, 'detail': err.detail,
                                'claim': read_receipt(claim_file), 'claim_path': str(claim_file)}
                    raise
            if existing.get('phase') not in ('CLAIMED',) and existing.get('claimed_at'):
                return {'status': 'duplicate_ignored', 'claim': existing,
                        'claim_path': str(claim_file)}
        claim = claim_admission(admission, results_root=root)
        # Immediate execute when live/test adapters provide author+qa (or execute flag).
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
        live_bindings = None
        try:
            import live as lean_live
            live_bindings = lean_live.live_self_check()
        except Exception as err:
            live_bindings = {'status': 'unavailable', 'error': type(err).__name__}
        print(json.dumps({
            'schema': 'GB_LEAN_SELF_CHECK_V1',
            'controller': 'lean_mode_b',
            'c5': 'off',
            'issue_182': 'OD018_PROSPECTIVE_DEV',
            'od018_signed_comment_id': OD018_SIGNED_COMMENT_ID,
            'od018_queue': list(OD018_QUEUE),
            'author_claims': AUTHOR_PASS_CLAIMS,
            'stages': list(stage_order()),
            'effectful': True,
            'live_defaults': True,
            'live_bindings': live_bindings,
            'installed': False,
        }, sort_keys=True))
        return 0
    event = loads(Path(argv[0]).read_bytes())
    # Host entry: load trusted LIVE default functions (not None hooks).
    result = run_once(event, use_live_defaults=True)
    print(json.dumps(result, sort_keys=True))
    return 0 if result.get('status') not in ('denied', 'queue_unavailable') else 1


if __name__ == '__main__':
    raise SystemExit(main())

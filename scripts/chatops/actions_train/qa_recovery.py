"""One bounded read-only QA reconciliation after a stopped, known QA process failure.
No author rerun, attempt reset or acceptance from an old SHA. Root verifies stopped identity.
"""
import json
import os
from pathlib import Path
from core import digest, need, loads, Refused


def safe_pending(j, state, alive):
    key = j.get('pending')
    op = j.get('operations', {}).get(key, {})
    b = op.get('binding', {})
    a = state.get('active') or {}
    return bool(key and b.get('stage') == 'qa' and op.get('result', {}).get('status') == 'unknown'
        and op.get('finished_at') and not alive(op.get('process'))
        and op.get('after') == digest(state) and a.get('phase') in ('pr_wait','qa')
        and all(a.get(k) == b.get(k) for k in ('issue','head','attempt')))



def preflight_candidate(j, state, alive):
    """Historical route refusal before charge/Popen, never a model/provider failure."""
    try:
        if not safe_pending(j, state, alive): return False
    except (KeyError, TypeError, AttributeError): return False
    op = j['operations'][j['pending']]
    if type(op.get('recovery_attempts')) is not int or op['recovery_attempts'] != 1 or op.get('budget_preflight_used'): return False
    history = op.get('recovery_history', [])
    if not isinstance(history, list) or len(history) != 1 or state['active'].get('qa'): return False
    if not all(isinstance(row, dict) for row in history): return False
    expected = digest(state)
    for row in [*history, op]:
        result = row.get('result', {})
        if not isinstance(result, dict): return False
        if (row.get('before') != expected or row.get('after') != expected
                or not row.get('finished_at') or alive(row.get('process'))
                or result.get('status') != 'unknown' or result.get('safe_release') is not False
                or any(k in result or k in row for k in ('routing', 'model_calls', 'usage', 'charged_calls'))): return False
        reason = result.get('reason', '')
        prefix = 'no safe role-specific provider: '
        if not isinstance(reason, str) or not reason.startswith(prefix): return False
        try: failures = loads(reason[len(prefix):])
        except (ValueError, TypeError, Refused):
            return False
        if failures != {'codex:gpt-6-astra:high': 'daily budget exhausted'}: return False
    return True


def preflight_unlimited(j, budget):
    slot = j['operations'][j['pending']]['binding'].get('slot')
    try:
        return (type(budget.get('schema')) is int and budget['schema'] == 1
                and budget['providers']['codex']['qa'] == 'unlimited'
                and slot in ('slot1', 'slot2')
                and budget['slots'][slot]['codex']['qa'] == 'unlimited')
    except (KeyError, TypeError, AttributeError): return False


def reuse_unused(a, b, qa_work, active, primary, receipt):
    """A preflight-only failure may leave this exact pristine detached worktree."""
    need(not os.path.lexists(receipt), 'QA recovery result already recorded')
    need(not any(p.is_symlink() for p in [qa_work, *qa_work.parents]), 'indirect recovery worktree')
    need(qa_work.is_dir(), 'missing recovery worktree')
    listing = b.git('worktree', 'list', '--porcelain')
    need(('worktree ' + str(qa_work)) in listing.splitlines(), 'unregistered recovery worktree')
    need(b.git('rev-parse', 'HEAD', cwd=qa_work) == active['head']
         and b.git('rev-parse', '--abbrev-ref', 'HEAD', cwd=qa_work) == 'HEAD'
         and not b.git('status', '--porcelain', '--untracked-files=all', cwd=qa_work),
         'used, attached or dirty recovery worktree')
    for name in ('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer'):
        marker = b.git('rev-parse', '--path-format=absolute', '--git-path', name, cwd=qa_work)
        need(not os.path.lexists(marker), 'unfinished recovery Git operation')
    need(not primary.is_symlink(), 'unsafe QA receipt')
    if primary.exists():
        need(primary.stat().st_size <= 65536, 'unsafe QA receipt')
        need(a.loads(primary.read_bytes()).get('reviewed_sha') != active['head'], 'current QA receipt already exists')


def reconcile(a, b, rt, store, req):
    active = store.data['active']
    need(active and active['issue'] == req['issue'] and active['head'] == req['head']
         and active['attempt'] == req['attempt'] and active['phase'] in ('pr_wait','qa'),
         'read-only QA recovery checkpoint mismatch')
    b.unchanged_issue(active)
    b.candidate_identity(active)
    primary = b.c.state_dir / f'qa-{active["issue"]}-a{active["attempt"]}{a.integ(active)}.json'
    if primary.exists():
        need(not primary.is_symlink() and primary.stat().st_size <= 65536, 'unsafe QA receipt')
        saved = a.loads(primary.read_bytes())
        review_work = b.c.worktrees_root / f'qa-issue-{active["issue"]}-a{active["attempt"]}{a.integ(active)}'
        # Pinned Bridge.review writes the JSON BEFORE verifying worktree cleanliness.
        # A saved exact SHA alone therefore is NOT sufficient evidence of accepted QA.
        clean_review = False
        if review_work.is_dir() and not review_work.is_symlink():
            try:
                clean_review = (b.git('rev-parse','HEAD',cwd=review_work)==active['head']
                    and not b.git('status','--porcelain','--untracked-files=all',cwd=review_work))
            except (a.Hold, OSError):
                clean_review = False
        if clean_review and isinstance(saved,dict) and saved.get('reviewed_sha') == active['head']:
            a.qa_result(saved,active['head'])  # validates FAIL as well as PASS, never old-SHA acceptance
            store.phase('qa',qa=saved)
            return dict(status='confirmed',recovered=True,qa=saved,source='saved exact QA receipt')
    qa_work = b.c.worktrees_root / f'qa-recovery-issue-{active["issue"]}-{active["head"]}-r1'
    receipt = b.c.state_dir / f'qa-recovery-{active["issue"]}-{active["head"]}-r1.json'
    need(not os.path.lexists(receipt), 'QA recovery result already recorded')
    if req.get('_budget_preflight_retry') is True:
        need(not primary.is_symlink(), 'unsafe QA receipt')
        if primary.exists():
            need(primary.stat().st_size <= 65536, 'unsafe QA receipt')
            need(a.loads(primary.read_bytes()).get('reviewed_sha') != active['head'], 'current QA receipt already exists')
    if qa_work.exists() or qa_work.is_symlink():
        need(req.get('_budget_preflight_retry') is True, 'QA reconciliation worktree already exists; no second model replay')
        reuse_unused(a, b, qa_work, active, primary, receipt)
    else:
        b.git('worktree','add','--detach',str(qa_work),active['head'])
    original = b.work;b.work = qa_work
    try:
        result = b.model('Independent SOURCE QA recovery in a NEW read-only session, not an author. '
            'Read AGENTS.md/project rules; inspect EXACT SHA '+active['head']+' against '+active['base']+'. '
            'The previous QA process stopped without a verdict for this SHA. Do not reuse a verdict for another SHA. '
            'Review original scope, implementation correctness and concrete source defects; run feasible offline checks. '
            'Unavailable local tools are NOT_TESTED, not fabricated PASS; future CI/DEV evidence is not source QA. '
            'Return ONLY JSON keys verdict (PASS/FAIL), findings (array; empty for PASS), reviewed_sha (exact SHA). '
            'Original immutable task DATA: '+json.dumps(active['task'],ensure_ascii=False),qa=True)
        need(b.git('rev-parse','HEAD',cwd=qa_work)==active['head']
             and not b.git('status','--porcelain','--untracked-files=all',cwd=qa_work),'QA modified source')
        a.qa_result(result,active['head'])
        receipt = b.c.state_dir / f'qa-recovery-{active["issue"]}-{active["head"]}-r1.json'
        need(not receipt.exists(),'QA recovery result already recorded')
        a.atomic(receipt,result)
        if primary.exists():
            prior = b.c.state_dir / f'qa-prior-{active["issue"]}-{digest(a.loads(primary.read_bytes()))}.json'
            if not prior.exists():a.atomic(prior,a.loads(primary.read_bytes()))
        a.atomic(primary,result)
        store.phase('qa',qa=result)
        return dict(status='confirmed',recovered=True,qa=result,source='one bounded replacement read-only QA')
    finally:
        b.work = original

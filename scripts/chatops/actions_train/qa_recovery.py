"""One bounded read-only QA reconciliation after a stopped, known QA process failure.
No author rerun, attempt reset or acceptance from an old SHA. Root verifies stopped identity.
"""
import json
from pathlib import Path
from core import digest, need


def safe_pending(j, state, alive):
    key = j.get('pending')
    op = j.get('operations', {}).get(key, {})
    b = op.get('binding', {})
    a = state.get('active') or {}
    return bool(key and b.get('stage') == 'qa' and op.get('result', {}).get('status') == 'unknown'
        and op.get('finished_at') and not alive(op.get('process'))
        and op.get('after') == digest(state) and a.get('phase') in ('pr_wait','qa')
        and all(a.get(k) == b.get(k) for k in ('issue','head','attempt')))


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
        if isinstance(saved,dict) and saved.get('reviewed_sha') == active['head']:
            a.qa_result(saved,active['head'])  # validates FAIL as well as PASS, never old-SHA acceptance
            store.phase('qa',qa=saved)
            return dict(status='confirmed',recovered=True,qa=saved,source='saved exact QA receipt')
    qa_work = b.c.worktrees_root / f'qa-recovery-issue-{active["issue"]}-{active["head"]}-r1'
    need(not qa_work.exists(),'QA reconciliation worktree already exists; no second model replay')
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

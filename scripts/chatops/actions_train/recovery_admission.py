"""Issue185 delegated recovery admission. Never impersonates an Owner/user identity.

Authority is the independently reviewed root receipt under installed Owner delegation185.
A bot Issue by itself is inert. Both hosted planning and root execution compare exact bytes
with that receipt. Product libraries and the Owner-only original admission remain pinned.
"""
import copy
import datetime as dt
import json
from core import OWNER, REPO, Refused, digest, loads, need
from recovery import SCHEMA, policy, review_result, diagnosis_result

MARKER = 'GOBADMINTON_RECOVERY_185_V1'
BOT = 41898282


def safe_task(a, task):
    # Validate the DATA contract without fabricating an Owner Issue/comment.
    need(isinstance(task, dict) and a.TASK_FIELDS <= set(task) <= a.TASK_FIELDS | a.OPTIONAL_FIELDS,
         'unexpected recovery task fields')
    need(task['schema'] == a.MARKER and task['target'] == 'dev' and task['kind'] == 'source_only'
         and type(task['max_attempts']) is int and task['max_attempts'] == 2, 'invalid recovery task scope')
    need(isinstance(task['goal'], str) and 1 <= len(task['goal']) <= 6000
         and isinstance(task['acceptance'], str) and 1 <= len(task['acceptance']) <= 6000,
         'recovery task text exceeds original contract')
    a.patterns(task['allowed_paths'])
    a.check_links(task, 0)
    return task


def proposed(r):
    need(isinstance(r, dict) and r['status'] in ('publish_ready', 'successor_bound')
         and r['counts'] == {'diagnose': 1, 'task_review': 1, 'successor': 1},
         'no finite reviewed publication reservation')
    need(r['review']['verdict'] == 'PASS', 'independent recovery review did not pass')
    review_result(r, r['review'])
    computed = diagnosis_result(r, r['diagnosis']['result'], r['diagnosis']['evidence'])
    need(computed == r['proposal'] and computed['max_attempts'] == 2,
         'proposal no longer matches reviewed original task and diagnosis')
    f = r['frozen']
    return dict(schema=MARKER, delegation_issue=185, receipt=digest(f), root=f['root'],
        parent=f['issue'], lineage=f['lineage'], candidate_head=f['head'], candidate_base=f['base'],
        controller_sha=f['source_sha'], task=copy.deepcopy(computed),
        diagnostic_hash=digest(r['diagnosis']), review_hash=digest(r['review']))


def body(r):
    return MARKER + '\n' + json.dumps(proposed(r), ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def parse_issue(issue, r, *, bound=False):
    need('pull_request' not in issue and issue.get('state') == 'open'
         and type(issue.get('number')) is int and issue['number'] > 0, 'recovery must be open Issue')
    user = issue.get('user') or {}
    need(user.get('id') == BOT and user.get('login') == 'github-actions[bot]' and user.get('type') == 'Bot',
         'only the real Actions bot may publish a delegated proposal')
    raw = issue.get('body')
    need(isinstance(raw, str) and len(raw.encode()) <= 32768 and raw == body(r),
         'unreviewed/edited recovery Issue bytes')
    need(issue.get('html_url') == f'https://github.com/{REPO}/issues/{issue["number"]}',
         'recovery repository identity mismatch')
    created = dt.datetime.fromisoformat(issue['created_at'].replace('Z', '+00:00'))
    need(created <= dt.datetime.now(dt.timezone.utc), 'future recovery Issue')
    proof = r.get('successor')
    if bound:
        need(proof and proof['issue'] == issue['number'] and proof['body_hash'] == digest(raw)
             and proof['created_at'] == issue['created_at'], 'successor identity changed')
    elif proof:
        need(proof['issue'] == issue['number'] and proof['body_hash'] == digest(raw), 'different successor already bound')
    return proposed(r)['task']


def candidates(a, snapshot, issues):
    out = []
    for key, r in snapshot.get('recovery', {}).get('receipts', {}).items():
        if r.get('status') not in ('publish_ready', 'successor_bound'): continue
        try:
            need(key == digest(r['frozen']), 'receipt key mismatch')
            exact = body(r)
            matches = [i for i in issues if i.get('body') == exact and 'pull_request' not in i]
            need(len(matches) == 1, 'missing or duplicate recovery publication')
            task = parse_issue(matches[0], r, bound=r['status'] == 'successor_bound')
            safe_task(a, task)
            out.append((matches[0]['number'], task))
        except (Refused, KeyError, TypeError, ValueError):
            continue
    return out


def parent_unchanged(a, api, f):
    original = f['snapshot']
    # The existing pinned verifier validates true numeric Owner identity and immutable
    # original authorization, including competing comments. No rewritten user/body objects.
    a.api, a.pages = api, api.pages
    a.Bridge.unchanged_issue(None, original)


def root_admission(a, api, cache, issue, config, *, verification=None):
    p = policy(config)
    raw = issue.get('body') or ''
    marker, sep, text = raw.partition('\n')
    need(marker == MARKER and sep, 'not delegated recovery')
    payload = loads(text)
    key = payload.get('receipt')
    need(isinstance(key, str) and key in cache['receipts'], 'no root recovery receipt')
    r = cache['receipts'][key]
    need(key == digest(r['frozen']), 'frozen recovery receipt digest mismatch')
    from recovery import verify_frozen
    verify_frozen(r['frozen'], verification)
    need(r['policy_hash'] == digest(p) and r['frozen']['source_sha'] == config['controller_sha'],
         'recovery delegation changed or revoked')
    task = parse_issue(issue, r, bound=r['status'] == 'successor_bound')
    safe_task(a, task)
    parent_unchanged(a, api, r['frozen'])
    # Detect a duplicate publish even when the dispatcher sent just one chosen number.
    matches = [i for i in api.pages('issues?state=all&sort=created&direction=desc')
               if i.get('body') == raw and 'pull_request' not in i]
    need(len(matches) == 1 and matches[0]['number'] == issue['number'],
         'ambiguous recovery publication; do not choose an arbitrary duplicate')
    cert = dict(key=key, issue=issue['number'], body_hash=digest(raw), created_at=issue['created_at'],
                task=copy.deepcopy(task), frozen=copy.deepcopy(r['frozen']), policy_hash=r['policy_hash'])
    if 'failure_diagnosis' in r:
        cert['failure_diagnosis'] = copy.deepcopy(r['failure_diagnosis'])
    if r.get('successor'): need(r['successor'] == {k:cert[k] for k in ('issue','body_hash','created_at')}, 'successor binding drift')
    r['successor'] = {k:cert[k] for k in ('issue','body_hash','created_at')}
    r['status'] = 'successor_bound'
    r['reason'] = 'Reviewed bounded successor admitted; original attempts and failure history retained'
    return cert


def assert_certificate(a, api, active, cert, config):
    need(cert and active.get('recovery_receipt') == cert['key'] and active['issue'] == cert['issue']
         and active['task'] == cert['task'] and cert['policy_hash'] == digest(policy(config)),
         'missing or mismatched trusted stage recovery certificate')
    need(digest(cert['frozen']) == cert['key'], 'recovery certificate frozen digest mismatch')
    if 'qa_evidence' in cert['frozen']:
        from qa_equivalence import supplemental
        f = cert['frozen']
        need(supplemental(f['snapshot'], f['slot'], f['qa_evidence']['qa']) == f['qa_evidence'],
             'certificate parent QA provenance mismatch')
        need(active.get('parent_qa_provenance') == dict(receipt=cert['key'], evidence=f['qa_evidence']),
             'successor parent QA provenance drift')
    issue = api(f'issues/{active["issue"]}')
    need(issue.get('state') == 'open' and 'pull_request' not in issue
         and issue.get('user', {}).get('id') == BOT
         and issue.get('created_at') == cert['created_at']
         and digest(issue.get('body')) == cert['body_hash']
         and a.fingerprint(issue) == active['fingerprint'], 'recovery Issue closed/edited after claim')
    parent_unchanged(a, api, cert['frozen'])


def retry_publications(api, snapshot):
    """Retry only a FAILED hosted publisher; each failure is isolated from ordinary work."""
    outcomes = []
    for key, r in snapshot.get('recovery', {}).get('receipts', {}).items():
        source = r.get('publication_run')
        if r.get('status') != 'publish_ready' or not source: continue
        try:
            run = api(f'actions/runs/{source["run"]}')
            if run.get('status') != 'completed': continue
            need(run.get('id') == source['run'] and run.get('path') == '.github/workflows/train-stage.yml'
                 and run.get('event') == 'workflow_dispatch' and run.get('head_branch') == 'dev'
                 and run.get('repository', {}).get('full_name') == REPO, 'invalid publisher retry provenance')
            if run.get('run_attempt', 100) >= 3:
                outcomes.append(dict(receipt=key, reason='hosted publication retry cap; needs-owner')); continue
            jobs = api.pages(f'actions/runs/{source["run"]}/jobs', 'jobs')
            matches = [j for j in jobs if j.get('name') == 'publish_recovery']
            if len(matches) == 1 and matches[0].get('status') == 'completed' and matches[0].get('conclusion') == 'failure':
                api(f'actions/jobs/{matches[0]["id"]}/rerun', {})
                outcomes.append(dict(receipt=key, rerun_job=matches[0]['id']))
        except (Refused, KeyError, TypeError, ValueError, OSError) as error:
            # Unknown write results are not replayed here. Next pass reconciles the job.
            outcomes.append(dict(receipt=key, status='publication-waiting',
                reason=str(error)[:300] if isinstance(error,Refused) else type(error).__name__))
    return outcomes


def claim(a, api, store, cert, config):
    need(not store.data['active'] or store.data['active']['phase'] == 'done', 'recovery slot occupied')
    issue = api(f'issues/{cert["issue"]}')
    active = dict(issue=cert['issue'], task=copy.deepcopy(cert['task']), fingerprint=a.fingerprint(issue),
        approved_since=issue['created_at'], phase='claimed', base=cert['frozen']['base'],
        head=cert['frozen']['head'], pr=None, ci=None, run=None, attempt=0,
        qa=(None if cert['frozen'].get('qa_provenance') else
            copy.deepcopy(cert['frozen']['snapshot']['qa'])), recovery_receipt=cert['key'])
    if 'qa_evidence' in cert['frozen']:
        active['parent_qa_provenance'] = dict(receipt=cert['key'],
            evidence=copy.deepcopy(cert['frozen']['qa_evidence']))
        active['qa'] = None  # parent evidence never grants current-task QA permission
    assert_certificate(a, api, active, cert, config)
    store.data['active'] = active
    store.save()
    return active

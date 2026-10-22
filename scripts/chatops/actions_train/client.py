#!/usr/bin/python3
"""Hosted controller. Only pinned controller code runs on the permitted dev ref with environment secrets."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from core import API, OWNER, REPO, REPO_ID, Refused, Retry, SINCE, digest, live, loads, need, plan, request

class SSH:
    def __enter__(self):
        self.temp = tempfile.TemporaryDirectory(prefix='gb-train-')
        folder = Path(self.temp.name)
        folder.chmod(0o700)
        for field, name in (('DEPLOY_SSH_KEY', 'key'), ('DEPLOY_KNOWN_HOSTS', 'known')):
            p = folder / name
            p.write_text(os.environ[field] + '\n')
            p.chmod(0o600)
        host, port = os.environ['DEPLOY_HOST'], os.environ.get('DEPLOY_PORT') or '22'
        import re
        need(re.fullmatch('[a-zA-Z0-9.-]+', host) and port.isdigit() and 1 <= int(port) <= 65535, 'invalid fixed SSH target')
        self.argv = ['/usr/bin/ssh', '-F', '/dev/null', '-T', '-p', port, '-i', str(folder/'key'),
                     '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
                     '-o', 'UserKnownHostsFile='+str(folder/'known'), '-o', 'ConnectTimeout=15',
                     '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', 'gb-deploy-dev@'+host]
        return self

    def __exit__(self, *_): self.temp.cleanup()

    def __call__(self, req):
        request(req)
        # Child SSH has no API/model credentials in env. JSON private stdin is never logged.
        proc = subprocess.run(self.argv, input=json.dumps(req), text=True, capture_output=True,
                              timeout=60, env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        need(len(proc.stdout) <= 2097152, 'SSH response too large')
        try: value = loads(proc.stdout)
        except (ValueError, Refused): raise Retry('SSH result unavailable; query durable status') from None
        if proc.returncode:
            raise Refused('restricted receiver refused: ' + value.get('reason', 'unknown'))
        return value


def trusted_event(event, name, api):
    need(event.get('repository', {}).get('id') == REPO_ID, 'wrong event repository')
    if name == 'issue_comment':
        issue, comment = event.get('issue') or {}, event.get('comment') or {}
        body = comment.get('body')
        need(event.get('action') == 'created' and 'pull_request' not in issue
             and type(issue.get('number')) is int and issue['number'] > 0
             and event.get('sender', {}).get('id') == OWNER
             and comment.get('user', {}).get('id') == OWNER
             and isinstance(body, str) and len(body.encode()) <= 32768
             and (body.startswith('GOBADMINTON_AUTONOMY_V1\\n{')
                  or body.startswith('GOBADMINTON_TRAIN_RECONCILE_V1\\n{')),
             'untrusted or irrelevant Issue comment')
    elif name == 'issues':
        need(event.get('sender', {}).get('id') == OWNER and
             event.get('action') == 'opened', 'untrusted Issue event')
    elif name == 'workflow_run':
        r = event['workflow_run']
        fresh = api(f'actions/runs/{r["id"]}')
        allowed = {'.github/workflows/ci.yml', '.github/workflows/dev-deploy.yml', '.github/workflows/autonomy-pr.yml'}
        need(fresh['path'] in allowed and fresh['status'] == 'completed'
             and fresh['event'] == 'push' and fresh['repository']['id'] == REPO_ID
             and fresh.get('head_repository', {}).get('id') == REPO_ID
             and (fresh['head_branch'] == 'dev' or fresh['head_branch'].startswith('automation/issue-')),
             'irrelevant or fork completion')
    elif name == 'workflow_dispatch':
        # GITHUB_TOKEN explicit continuation is the Actions bot; human controls require numeric Owner.
        need(event.get('sender', {}).get('id') in (OWNER, 41898282), 'untrusted dispatch actor')
    else:
        need(name == 'schedule', 'untrusted event type')


def reconcile(api, ssh, event, name):
    import datetime as dt
    trusted_event(event, name, api)
    api.identity()
    snap = ssh({'action': 'train', 'stage': 'status'})
    a, s = live()
    issues = api.pages('issues?state=open&sort=created&direction=asc')
    comments = []
    for issue in issues:
        if 'pull_request' not in issue:
            comments.extend(api.pages(f'issues/{issue["number"]}/comments'))
    candidates = s.admitted(a, issues, comments, dt.datetime.fromisoformat(SINCE))
    from recovery_admission import candidates as recovery_candidates
    candidates.extend(recovery_candidates(a, snap, issues))
    # Routing selection belongs to root config or an explicit authorized dispatch; never task mutation.
    profile = event.get('inputs', {}).get('profile') or 'auto'
    intents = plan(a, s, snap, candidates, profile)
    from recovery import descriptors
    recovery_intents = descriptors(snap, intents)
    from queue_diagnostics import explain
    report = explain(s, snap, issues, candidates, intents, profile)
    Path('evidence').mkdir(exist_ok=True)
    Path('evidence/reconcile.json').write_text(json.dumps(dict(snapshot=snap, intents=intents,
        recovery_intents=recovery_intents, planning=report), sort_keys=True))
    if snap['mode'] != 'active':
        print('Shadow: source effects disabled; admitted intents=' + str(len(candidates)))
        return
    from recovery_admission import retry_publications
    try:
        publication_retries = retry_publications(api, snap)
    except (Refused, KeyError, TypeError, ValueError, OSError) as error:
        # Recovery reporting/publication never becomes a gate for ordinary ready stages.
        publication_retries = [dict(status='publication-waiting', reason=type(error).__name__)]
    Path('evidence/publication-retries.json').write_text(json.dumps(publication_retries, sort_keys=True))
    # Existing authenticated restricted SSH: this closed DATA-ONLY report cannot start a
    # task, alter any checkpoint/budget/lease, or mark a process running. No write token leaves Actions.
    controller = subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'], text=True).strip()
    ssh({'action':'train','stage':'planning','controller_sha':controller,
         'run':int(os.environ['GITHUB_RUN_ID']),'run_attempt':int(os.environ['GITHUB_RUN_ATTEMPT']),
         'report':report})
    for descriptor in intents + recovery_intents:
        api('actions/workflows/train-stage.yml/dispatches', dict(ref='dev', inputs={
            'operation': json.dumps(descriptor, sort_keys=True, separators=(',', ':'))}))
    print('Dispatched bounded stages: ' + str(len(intents) + len(recovery_intents)))


def execute(api, ssh, descriptor):
    need(os.environ['GITHUB_REF'] == 'refs/heads/dev', 'stage must run from permitted dev')
    need(set(descriptor) == {'slot', 'issue', 'stage', 'phase', 'head', 'attempt', 'generation', 'profile'}, 'unknown dispatch fields')
    req = dict(descriptor, action='train', run=int(os.environ['GITHUB_RUN_ID']),
               run_attempt=int(os.environ['GITHUB_RUN_ATTEMPT']), gh_token=os.environ['GH_TOKEN'])
    request(req)
    value = ssh(req)
    deadline = time.monotonic() + 2300
    while value['status'] == 'running' and time.monotonic() < deadline:
        time.sleep(20)
        snap = ssh({'action': 'train', 'stage': 'status'})
        card = snap['slots'][descriptor['slot']]
        pending = card['pending']
        if pending:
            if pending['status'] == 'unknown':
                value = dict(status='unknown', reason='lost process identity; reconcile exact effects')
                break
            continue
        last = card['last']
        if last and last['workflow_run'] == req['run'] and last['workflow_attempt'] == req['run_attempt']:
            value = dict(status=last['status'], last=last)
            break
        value = dict(status='unknown', reason='journal result identity mismatch')
    need(value['status'] != 'running', 'bounded stage wait expired; query before retry')
    Path('evidence').mkdir(exist_ok=True)
    Path('evidence/stage.json').write_text(json.dumps(value, sort_keys=True))
    last = value.get('last') or {}
    # Explicit dispatch bypasses GITHUB_TOKEN event suppression, only on a factual transition.
    changed = (last.get('changed') and last.get('workflow_run') == req['run']
               and last.get('workflow_attempt') == req['run_attempt']
               and value['status'] in ('confirmed', 'deferred'))
    # The remote token is READ-ONLY. A separate hosted job owns actions:write continuation.
    with open(os.environ['GITHUB_OUTPUT'], 'a') as out:
        out.write('changed=' + ('true' if changed else 'false') + '\n')
        ready = changed and (last.get('recovery') or {}).get('status') == 'publish_ready'
        out.write('recovery_ready=' + ('true' if ready else 'false') + '\n')
    print('Stage result: ' + value['status'])
    if value['status'] in ('unknown', 'refused'): raise Refused('stage requires reconciliation')


def main():
    need(os.environ.get('GITHUB_REPOSITORY') == REPO, 'wrong repository')
    action = sys.argv[1]
    event_name = os.environ['GITHUB_EVENT_NAME']
    event_ref = os.environ['GITHUB_REF']
    # GitHub delivers Issue comments from the default main ref; the trusted
    # controller still comes from a pinned immutable checkout, not main code.
    need((action == 'reconcile' and
          ((event_name == 'workflow_dispatch' and event_ref == 'refs/heads/dev')
           or (event_name == 'issue_comment' and event_ref == 'refs/heads/main')))
         or (action == 'stage' and event_name == 'workflow_dispatch'
             and event_ref == 'refs/heads/dev'), 'untrusted workflow event/ref')
    api = API(os.environ['GH_TOKEN'])
    with SSH() as ssh:
        if action == 'reconcile':
            reconcile(api, ssh, loads(Path(os.environ['GITHUB_EVENT_PATH']).read_bytes()), event_name)
        elif action == 'stage':
            execute(api, ssh, loads(os.environ['TRAIN_OPERATION']))
        else: raise Refused('unknown client operation')

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(str(error) if isinstance(error, Refused) else type(error).__name__, file=sys.stderr)
        sys.exit(1)

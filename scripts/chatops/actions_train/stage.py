"""Nonroot one-stage adapter over the exact installed V6 primitives. Never calls execute/main."""
import datetime as dt
import json
import os
import time
from pathlib import Path
from types import SimpleNamespace
import urllib.parse
from core import API, Refused, Retry, SINCE, live, need, route


def setup(req, config):
    a, s = live()
    rt = s.Runtime(req['slot'], legacy_reads=a.RUNTIME_READS)
    need(os.getuid() != 0 and os.getuid() == s.uid_of(rt.user) and os.getgid() != 0,
         'wrong execution UID/GID')
    a.SLOT, a._SLOTS, a._SLOTS_HOLD, a.KEY = req['slot'], rt, s.Hold, rt.key
    if not rt.legacy:
        a.RUNTIME_READS = rt.runtime_reads
    api = API(req.pop('gh_token'))
    api.identity()
    a.api, a.pages = api, api.pages   # authenticated, actual rate responses; no ApiClock/65s polling
    c = SimpleNamespace(repo=rt.layout.repo, state_dir=rt.layout.state_dir,
                        worktrees_root=rt.layout.worktrees, known_hosts=(rt.home / '.ssh/known_hosts' if req['slot'] == 'slot1' else Path('/etc/gobadminton-slots/slot2-known_hosts')),
                        codex=config['codex'][req['slot']], model='gpt-6.1-sol', effort='high',
                        model_timeout=1800, poll=1, wait_timeout=1, stage_route_enforced=True)
    rt.check_paths(c.repo, c.state_dir, c.worktrees_root)
    store = a.Store(c.state_dir)  # exact worker.lock rejects a second author/legacy worker
    need(rt.continuity(), 'reviewed V6 continuity policy must be enabled')
    bridge = a.Bridge(c, store)
    def effect_gate():
        from receiver import POLICY, units_quiet
        policy = s.read_json(POLICY, trusted_uids={0}, limit=16384)
        need(policy.get('mode') == 'active' and req['slot'] in policy.get('owned', {}),
             'root migration ownership revoked')
        units_quiet(('gobadminton-supervisor.service', f'gobadminton-slot@{req["slot"]}.service'))
        if store.data['active']: rt.lease(store.data['active'])
    original_git = bridge.git
    def checked_git(*args, **kwargs):
        # Read-only Git operations keep their original sandbox/transport. Every mutation rechecks
        # the public root-owned activation policy while retaining the same worker.lock/lease.
        verbs = {'add', 'reset', 'commit', 'merge', 'push', 'worktree', 'branch', 'update-ref'}
        if any(arg in verbs for arg in args): effect_gate()
        return original_git(*args, **kwargs)
    bridge.git = checked_git
    # Observe the actual CLI PID while preserving V6 Popen, environment, timeout and sandbox.
    from receiver import identity
    original_subprocess = a.subprocess
    trace = dict(schema='GB_ACTIONS_PROCESS_V1', stage=req['stage'], workflow_run=req['run'],
                 workflow_attempt=req['run_attempt'], process=None, model=None, observed_at=int(time.time()))
    def publish_process():
        trace['observed_at'] = int(time.time())
        a.atomic(rt.layout.outbox / 'actions-process.json', trace)
    class ObservedSubprocess:
        def __getattr__(self, name): return getattr(original_subprocess, name)
        def Popen(self, argv, *args, **kwargs):
            process = original_subprocess.Popen(argv, *args, **kwargs)
            if argv[0] == str(c.codex):
                try:
                    trace['process'] = identity(process.pid)
                    publish_process()
                except BaseException:
                    import signal
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                    raise
            return process
    a.subprocess = ObservedSubprocess()
    bridge.routing_receipts = []
    original_model = bridge.model
    def measured_model(prompt, qa=False):
        effect_gate()
        choice = route(s, store.data['active']['task'], 'qa' if qa else 'author',
                       'auto' if qa and 'qa_routes' in store.data['active']['task']
                       else 'codex' if qa else req['profile'], rt.budget, req['slot'])
        # A role-specific route MUST match the actual CLI. Never run Codex under a
        # trace claiming Cursor/Antigravity; those need their own reviewed adapter.
        need(choice['provider'] == 'codex', 'unimplemented native model adapter')
        trace['model'] = choice
        old_model, old_effort = c.model, c.effort
        c.model, c.effort = choice['effective_model'], choice['effort']
        role = 'qa' if qa else 'author'
        before = rt.budget.used('codex', role, req['slot'])
        completed, answer = 'raised', None
        try:
            answer = original_model(prompt, qa)
            completed = 'returned'
            return answer
        finally:
            from cost_policy import usage
            try: after = rt.budget.used('codex', role, req['slot'])
            except Exception: after = None
            choice['usage'] = usage(before, after, completed, answer if qa else None)
            choice['head'] = store.data['active'].get('head')
            choice['attempt'] = store.data['active'].get('attempt')
            bridge.routing_receipts.append(dict(choice))
            trace['model'] = choice
            c.model, c.effort = old_model, old_effort
            trace['process'] = None
            publish_process()
    bridge.model = measured_model
    ordinary_unchanged = bridge.unchanged_issue
    def unchanged(active):
        if active.get('recovery_receipt'):
            from recovery_admission import assert_certificate
            assert_certificate(a, api, active, req.get('_recovery_admission'), config)
        else:
            ordinary_unchanged(active)
    bridge.unchanged_issue = unchanged
    return a, s, rt, api, store, bridge


def run_result(a, api, active, dev=False):
    workflow, name, branch = ('dev-deploy.yml', 'DEV deploy', 'dev') if dev else (
        'ci.yml', 'Product CI', f'automation/issue-{active["issue"]}')
    runs = api.pages(f'actions/workflows/{workflow}/runs?head_sha={active["head"]}&event=push', 'workflow_runs')
    runs = [r for r in runs if r['name'] == name and r['head_sha'] == active['head']
            and r['head_branch'] == branch and r['event'] == 'push'
            and r.get('repository', {}).get('id') == 1416250340]
    if not runs:
        raise Retry('exact workflow run not_started', 60)
    r = max(runs, key=lambda v: (v['id'], v['run_attempt']))
    if r['status'] != 'completed':
        raise Retry('exact workflow waiting', 60)
    if r.get('conclusion') in ('cancelled', 'timed_out', 'action_required', 'stale', 'neutral'):
        raise Retry('exact workflow ' + r['conclusion'] + '; waiting for a real successful run', 300)
    jobs = api.pages(f'actions/runs/{r["id"]}/attempts/{r["run_attempt"]}/jobs', 'jobs')
    need(all(j.get('head_sha') == active['head'] for j in jobs), 'job head mismatch')
    a.successful(r, jobs, active['head'], a.DEV_JOBS if dev else a.CI_JOBS, dev)
    return dict(id=r['id'], attempt=r['run_attempt'], sha=active['head'], url=r['html_url'], jobs=jobs)


def require_mutex(rt):
    if not rt.mutex.try_acquire(): raise Retry('legacy integration mutex busy', 60)


def perform(req, config, context):
    a, s, rt, api, store, b = context
    active = store.data['active']
    stage = req['stage']
    metadata = {}
    if req.get('_recover'):
        need(active and active['issue'] == req['issue'], 'recovery task mismatch')
        rt.lease(active)
        b.work = b.c.worktrees_root / f'issue-{active["issue"]}'
        b.unchanged_issue(active)
        if stage == 'qa':
            from qa_recovery import reconcile
            return reconcile(a,b,rt,store,req)
        elif stage == 'publish':
            need(active['phase'] in ('candidate', 'pr_wait') and active['head'] == req['head'], 'publication recovery identity')
            b.candidate_identity(active)  # remote must ALREADY match; no push here
            store.phase('pr_wait')
        elif stage == 'integrate':
            if active['phase'] == 'integrating':
                need(rt.continuity(), 'reviewed continuity required')
                b.finish_integration(active, active['integration_target'])  # clean exact two parents only
            else:
                need(active['phase'] in ('candidate', 'promoting'), 'unknown merge outcome')
                b.stopped_writer(active['head'])
        elif stage == 'promote':
            need(active['phase'] in ('promoting', 'dev_wait') and active['head'] == req['head'], 'promotion recovery identity')
            b.stopped_writer(active['head'])
            b.saved_qa(active)
            run_result(a, api, active)
            need(b.remote_dev() == active['head'], 'unconfirmed DEV push; no replay')
            store.phase('dev_wait')
        elif stage == 'dev':
            # This stage has only authenticated reads and an exact accepted checkpoint write.
            if active['phase'] == 'done':
                need(active.get('head') == req['head'] and active.get('server'), 'accepted recovery identity')
            else:
                return perform({k: v for k, v in req.items() if k != '_recover'}, config, context)
        else:
            raise Refused('unknown effect requires PMA reconciliation')
        rt.publish(store.data, store.parked)
        return dict(status='confirmed', recovered=True)

    if stage == 'claim':
        need(not active or active['phase'] == 'done', 'slot occupied')
        issue = api(f'issues/{req["issue"]}')
        comments = api.pages(f'issues/{req["issue"]}/comments')
        if req.get('_recovery_admission'):
            from recovery_admission import claim
            active = claim(a, api, store, req['_recovery_admission'], config)
        else:
            active = store.claim([issue], dt.datetime.fromisoformat(SINCE), comments)
        need(active and active['issue'] == req['issue'], 'no unique immutable task admission')
        need(not req.get('_task_hash') or __import__('core').digest(active['task']) == req['_task_hash'],
             'task changed between admission and claim')
        b.unchanged_issue(active)
        rt.lease(active)
        b.work = b.c.worktrees_root / f'issue-{active["issue"]}'
        need(not b.work.exists() and not b.git('branch', '--list', f'automation/issue-{active["issue"]}'),
             'existing source worktree/branch; reconcile')
        need(not b.git('ls-remote', '--heads', a.READ_REMOTE,
                       f'refs/heads/automation/issue-{active["issue"]}'), 'remote branch already exists')
        if req.get('_recovery_admission'):
            f = req['_recovery_admission']['frozen']
            # Retain the exact old candidate without touching its old branch or attempts.
            b.git('fetch', '--no-tags', a.READ_REMOTE, f['head'])
            need(b.git('rev-parse', 'FETCH_HEAD') == f['head'], 'parent candidate not fetched exactly')
            b.git('worktree', 'add', '-b', f'automation/issue-{active["issue"]}', str(b.work), f['head'])
            need(b.git('merge-base', f['base'], f['head'], cwd=b.work) == f['base'], 'parent candidate ancestry drift')
            b.clean(f['head'])
        else:
            base = b.remote_dev()
            store.phase('claimed', base=base)
            b.git('worktree', 'add', '-b', f'automation/issue-{active["issue"]}', str(b.work), base)
    else:
        need(active and active['issue'] == req['issue'] and active['phase'] == req['phase']
             and active.get('head') == req['head'] and active['attempt'] == req['attempt'], 'stale checkpoint')
        rt.lease(active)
        b.work = b.c.worktrees_root / f'issue-{active["issue"]}'
        b.unchanged_issue(active)
        if stage == 'author':
            need(active['phase'] == 'claimed' or active['phase'] == 'qa' and
                 (active.get('qa') or {}).get('verdict') == 'FAIL' or
                 active['phase'] == 'ci' and active.get('ci_failure') or
                 active['phase'] == 'pr_wait' and active.get('deterministic_failure'), 'author phase gate')
            need(active['attempt'] < active['task']['max_attempts'], 'attempts exhausted')
            metadata['routing'] = route(s, active['task'], 'author', req['profile'], rt.budget, req['slot'])
            diagnostic = active.get('ci_failure') or active.get('deterministic_failure')
            checkpoint = {}
            if active['phase'] != 'claimed':
                b.candidate_identity(active)
                if active['phase'] == 'ci':
                    b.saved_qa(active)
                    need(b.failed_ci(active) == diagnostic, 'CI diagnostic changed; re-observe gate')
                    dev = b.remote_dev()
                    need(b.git('merge-base', active['base'], dev, cwd=b.work) == active['base'],
                         'DEV history changed; repair refused')
                if active.get('deterministic_failure'):
                    need(b.failed_ci(active) == diagnostic, 'deterministic CI evidence changed')
                before = b.c.state_dir / f'actions-before-repair-{active["issue"]}-a{active["attempt"]}.json'
                need(not before.is_symlink(), 'repair backup symlink')
                if before.exists(): need(a.loads(before.read_bytes()) == store.data, 'repair backup drift')
                else: a.atomic(before, store.data)
                checkpoint['history'] = list(active.get('history', [])) + [dict(
                    attempt=active['attempt'], head=active['head'], base=active['base'],
                    qa=active.get('qa'), ci=active.get('ci'), ci_failure=diagnostic,
                    source='actions bounded repair')]
            fix_details = diagnostic
            if diagnostic:
                from recovery import ci_evidence
                exact = ci_evidence(api, {'snapshot': active, 'head': active['head'], 'issue': active['issue']})
                need(exact, 'exact CI failure evidence missing; do not spend another author attempt blindly')
                fix_details = {'failure': diagnostic, 'assertion_evidence': exact}
            b.author(active, fix=fix_details, ci_failure=diagnostic, deterministic_failure=None, **checkpoint)
        elif stage == 'publish':
            need(active['phase'] == 'candidate', 'publish phase gate')
            b.stopped_writer(active['head'])
            ref = f'refs/heads/automation/issue-{active["issue"]}'
            remote = b.git('ls-remote', '--heads', a.READ_REMOTE, ref)
            if remote != active['head'] + '\t' + ref:
                b.git('push', a.WRITE_REMOTE, f'{active["head"]}:{ref}', write=True)
            store.phase('pr_wait')
        elif stage == 'qa':
            need(active['phase'] == 'pr_wait', 'QA phase gate')
            b.candidate_identity(active)
            prs = api.pages('pulls?state=open&base=dev&head=' + urllib.parse.quote(
                f'anpavel84-afk:automation/issue-{active["issue"]}'))
            prs = [p for p in prs if p['head']['sha'] == active['head']
                   and p['head']['repo']['id'] == 1416250340 and p['base']['repo']['id'] == 1416250340
                   and p['base']['ref'] == 'dev']
            need(len(prs) <= 1, 'ambiguous PR')
            if not prs: raise Retry('PR not_started; Autonomy PR must be enabled', 60)
            if 'routing_policy' in active['task']:
                # Cheap exact-SHA mandatory checks run first. They NEVER certify independent QA.
                try:
                    checks = run_result(a, api, active)
                except a.Hold as error:
                    if str(error) != 'Actions failed': raise
                    failure = b.failed_ci(active)
                    store.phase('pr_wait', pr=prs[0]['number'], deterministic_failure=failure,
                                independent_qa_pending=True)
                    rt.publish(store.data, store.parked)
                    return dict(status='confirmed', deterministic_checks=dict(status='failure', **failure),
                                model_call_skipped='mandatory deterministic check failed; bounded author repair next')
                metadata['deterministic_checks'] = dict(status='success', run=checks['id'], sha=checks['sha'])
            metadata['routing'] = route(s, active['task'], 'qa',
                                        'auto' if 'qa_routes' in active['task'] else 'codex',
                                        rt.budget, req['slot'])
            store.phase('qa', pr=prs[0]['number'])
            b.review(active)  # new detached exact SHA, read-only sandbox, independent new CLI session
            if 'routing_policy' in active['task']:
                store.phase('qa', independent_qa_pending=False, deterministic_failure=None)
        elif stage == 'ci':
            need(active['phase'] == 'qa' or active['phase'] == 'ci', 'CI phase gate')
            b.candidate_identity(active)
            b.saved_qa(active)
            try:
                ci = run_result(a, api, active)
            except a.Hold as error:
                if str(error) != 'Actions failed': raise
                failure = b.failed_ci(active)  # recognized closed diagnostic only
                store.phase('ci', ci=None, ci_failure=failure)
            else:
                store.phase('ci', ci=ci, ci_failure=None)
        elif stage == 'integrate':
            need(active['phase'] == 'ci' and active.get('ci', {}).get('sha') == active['head'], 'integration gate')
            b.saved_qa(active)
            b.candidate_identity(active)
            run_result(a, api, active)  # renewed exact run, not a cached green result
            require_mutex(rt)
            need(rt.continuity(), 'reviewed continuity policy required')
            dev = b.remote_dev()
            if dev == active['base']:
                store.phase('promoting')
            else:
                b.integrate(active, dev)  # ordinary merge -> publish -> renewed QA/CI
        elif stage == 'promote':
            need(active['phase'] == 'promoting', 'promote phase gate')
            require_mutex(rt)
            b.stopped_writer(active['head'])
            b.saved_qa(active)
            run_result(a, api, active)
            remote = b.remote_dev()
            if remote not in (active['base'], active['head']):
                need(b.git('merge-base', active['base'], remote, cwd=b.work) == active['base'],
                     'DEV history changed; promotion refused')
                # No push was attempted. Actions selects integration on the next pass.
                store.phase('ci', ci=active['ci'], ci_failure=None)
                rt.publish(store.data, store.parked)
                return dict(status='confirmed', needs_integration=True,
                            active=store.data['active'], done=store.data['done'])
            if remote != active['head']:
                need(b.git('merge-base', active['base'], active['head']) == active['base'], 'not fast forward')
                b.git('push', '--atomic', a.WRITE_REMOTE, f'{active["head"]}:refs/heads/dev', write=True)
            store.phase('dev_wait')
        elif stage == 'dev':
            need(active['phase'] == 'dev_wait', 'DEV phase gate')
            require_mutex(rt)
            b.saved_qa(active)
            need(b.remote_dev() == active['head'], 'DEV recovery drift')
            deployed = run_result(a, api, active, dev=True)
            release = f'r{deployed["id"]}-a{deployed["attempt"]}'
            receipt = a.server_evidence(release, active['head'])
            meta = api('https://dev.gobadminton.ru/v1/meta')
            need(meta.get('gitSha') == active['head'], 'live DEV mismatch')
            need(a.server_evidence(release, active['head'])['accepted'] == receipt['accepted'], 'receipt changed')
            store.phase('done', run=deployed, live=meta, server=receipt, release_id=release)
        else:
            raise Refused('unimplemented wire stage')
    rt.publish(store.data, store.parked)
    return dict(status='confirmed', **metadata)


def entry(req, config):
    context = None
    try:
        context = setup(req, config)
        if req['stage'] in ('diagnose', 'task_review'):
            from recovery import perform as recover
            return recover(req, config, context)
        return model_receipt(perform(req, config, context), context)
    except Retry as error:
        return dict(status='waiting', reason=str(error), retry_after=error.after)
    except Exception as error:
        reason = str(error)[:1000] if isinstance(error, Refused) or error.__class__.__name__ in (
            'Hold', 'AdapterDisabled') else type(error).__name__
        # Only proven stopped source failures can release occupancy. Unknown author/push/QA
        # effects retain their checkpoint and require exact recovery; never fake PARK/done.
        safe = False
        if context:
            a, s, rt, api, store, b = context
            active = store.data['active']
            unavailable = (reason == 'BLOCKED: model authentication rejected (401/unauthorized)' or
                           reason in ('codex author quota UNKNOWN; refusing model call',
                                      'codex qa quota UNKNOWN; refusing model call',
                                      'codex author daily budget exhausted', 'codex qa daily budget exhausted'))
            known = (reason == 'attempts exhausted' or reason.startswith('profile unavailable:')
                     or reason in ('integration conflict with new dev', 'integration bound exhausted') or unavailable)
            if active and known and (active['phase'] in ('claimed', 'qa', 'ci') or
                                     unavailable and active['phase'] == 'developing'):
                try:
                    b.stopped_writer(active['head'] or active['base'])
                    path = b.c.state_dir / 'actions-deferred.json'
                    archive = a.loads(path.read_bytes()) if path.exists() else {'schema': 'GB_ACTIONS_DEFERRED_V1', 'entries': []}
                    archive['entries'].append(dict(issue=active['issue'], reason=reason,
                                                   snapshot=json.loads(json.dumps(active))))
                    a.atomic(path, archive)  # archive first; never alter done/parked/history/budget
                    store.data['active'] = None
                    store.save()
                    safe = True
                except Exception:
                    pass
        uncertain = context and not safe and (req['stage'] in ('author', 'qa', 'publish', 'integrate', 'promote'))
        return model_receipt(dict(status='unknown' if uncertain else 'deferred', reason=reason, safe_release=safe), context)


def model_receipt(result, context):
    calls = getattr(context[-1], 'routing_receipts', []) if context else []
    if calls:
        result['routing'] = calls[-1] | {'stage_result': result.get('status')}
        result['model_calls'] = calls
    return result

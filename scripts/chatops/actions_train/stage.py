"""Nonroot one-stage adapter over the exact installed V6 primitives. Never calls execute/main."""
import datetime as dt
import json
import os
import time
from pathlib import Path
from types import SimpleNamespace
import urllib.parse
from core import API, Refused, Retry, SINCE, live, need, route


def setup(req, config, native_auth=None):
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
    # Resolve trusted context before a stage can consume an author attempt.
    from context_policy import load as load_rules
    accepted_rules = load_rules() if req['stage'] in ('author', 'qa', 'diagnose', 'task_review', 'qa_qualification', 'failure_diagnosis') else None
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
            if argv[0] == str(c.codex):
                need('--ignore-rules' in argv and '--ignore-user-config' in argv,
                     'untrusted automatic instruction loading enabled')
            process = original_subprocess.Popen(argv, *args, **kwargs)
            if argv[0] in (str(c.codex), '/opt/gobadminton-cursor-cli/2026.10.01-e373342/gb-bwrap',
                            '/opt/gb-slots/runtime/antigravity/agy'):
                try:
                    trace['context_source'] = dict(cwd=str(kwargs.get('cwd',bridge.work)),
                        cli_sha256=__import__('hashlib').sha256(Path(argv[0]).read_bytes()).hexdigest(),
                        ignore_rules=argv[0] == str(c.codex), ignore_user_config=argv[0] == str(c.codex),
                        native_namespace=argv[0] != str(c.codex))
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
        from failure_diagnosis import enabled
        if req['stage'] == 'failure_diagnosis' or (req['stage'] == 'diagnose'
                and enabled(store.data['active'])):
            need(qa, 'diagnosis must use read-only QA permissions')
            from core import diagnosis_route
            choice = diagnosis_route(s, store.data['active']['task'], rt.budget, req['slot'])
            pending = store.data['active'].get('failure_diagnosis', {}).get('receipts', {})
            keys = [k for k, r in pending.items() if r.get('status') == 'pending'
                    and r.get('inputs', {}).get('head') == store.data['active']['head']]
            need(len(keys) == 1, 'no unique write-ahead diagnosis reservation')
            choice['failure_fingerprint'] = keys[0]
            choice['diagnosis_call'] = store.data['active']['failure_diagnosis']['calls']
            choice['diagnosis_cap'] = store.data['active']['task']['failure_diagnosis']['max_calls']
        elif req['stage'] == 'task_review':
            need(qa, 'task_review must use read-only QA permissions')
            from core import task_review_route
            choice = task_review_route(s, store.data['active']['task'], rt.budget, req['slot'])
        else:
            choice = route(s, store.data['active']['task'], 'qa' if qa else 'author',
                           'auto' if qa and 'qa_routes' in store.data['active']['task']
                           else 'codex' if qa else req['profile'], rt.budget, req['slot'])
        # A role-specific route MUST match the actual CLI. Never run Codex under a
        # trace claiming Cursor/Antigravity; those need their own reviewed adapter.
        need(choice['provider'] in ('codex','cursor','agy') and (choice['provider'] != 'cursor' or not qa)
             and (choice['provider'] != 'agy' or qa),
             'unimplemented native model adapter')
        from context_policy import inject
        expectation = None
        if choice['provider'] == 'agy':
            wrapped, rules_receipt = prompt, None  # Native adapter injects after assembling source DATA.
        elif (choice['provider'] == 'codex' and req['stage'] in
              ('author', 'qa', 'task_review', 'diagnose', 'failure_diagnosis')
              and not req.get('_recover') and not req.get('_budget_preflight_retry')):
            # Stage 5 is scoped to this existing Codex transport only. Probe
            # immutable rules bytes as the actual slot identity before any
            # charged model invocation; failure preserves full rules inline.
            # Native Cursor/AGY need separate recipient and tool qualifications.
            from context_policy import (RULES_COMMIT, RULES_SHA256, RULES_SIZE,
                                        CANONICAL_GIT_RULES_PATH, verified_git_rules)
            context_role = ('failure_diagnosis' if choice.get('role') == 'failure_diagnosis'
                            else 'qa' if qa else 'author')
            reference=dict(path=CANONICAL_GIT_RULES_PATH,revision=RULES_COMMIT,
                           sha256=RULES_SHA256,bytes=RULES_SIZE)
            guidance=('If you need the complete accepted rules, read the IMMUTABLE '
                      'Git object with git show '+RULES_COMMIT+':'
                      +CANONICAL_GIT_RULES_PATH+'; do not trust modified '
                      'working-tree policy files.\n')
            wrapped, rules_receipt = inject(prompt, qa, bridge.work,
                accepted_rules, role=context_role, context_profile='scoped_v1',
                full_rules_reference=reference, scoped_guidance=guidance,
                verified_access=lambda ref: verified_git_rules(bridge.work,ref))
        elif (choice['provider'] == 'cursor' and req['stage'] == 'author'
              and not qa
              and not req.get('_recover') and not req.get('_budget_preflight_retry')):
            from context_cursor_delivery import cursor_author_context
            wrapped, rules_receipt, expectation = cursor_author_context(
                prompt, bridge, accepted_rules, role=choice.get('role', 'author'))
        else:
            wrapped, rules_receipt = inject(prompt, qa, bridge.work, accepted_rules, role=choice.get('role', 'qa' if qa else 'author'))
        choice['rules_context'] = rules_receipt
        trace['model'] = choice
        old_model, old_effort = c.model, c.effort
        c.model, c.effort = choice['effective_model'], choice['effort']
        role = 'qa' if qa else 'author'
        provider = choice['provider']
        before = rt.budget.used(provider, role, req['slot'])
        completed, answer = 'raised', None
        try:
            if provider == 'cursor':
                from native_cursor import invoke
                permitted = a.permitted
                if expectation and expectation['profile'] == 'scoped_v1':
                    from context_cursor_delivery import gated_permitted
                    permitted = gated_permitted(permitted, bridge, rt, expectation)
                answer = invoke(bridge, rt, wrapped, native_auth, choice, popen=a.subprocess.Popen,
                                atomic=a.atomic, permitted=permitted)
                choice['rules_context'] = choice['native_receipt']['rules_context']
                if expectation and expectation['profile'] == 'scoped_v1':
                    from context_cursor_delivery import verify_role_received
                    choice['rules_context']['context_proof'] = verify_role_received(
                        choice['native_receipt'].get('job'), expectation, choice['native_receipt'])
            elif provider == 'agy':
                from native_antigravity import review, save_receipt
                active = store.data['active']
                from core import digest
                answer, receipt = review(bridge.work, active['base'], active['head'], wrapped, c.model_timeout,
                    slot=req['slot'], task_hash=digest(active['task']), model=choice['effective_model'],
                    charge=lambda: rt.budget.charge(req['slot'], 'agy', 'qa'), popen=a.subprocess.Popen,
                    accepted_rules=accepted_rules, evidence_dir=c.state_dir/'antigravity-evidence')
                save_receipt(c.state_dir, active['issue'], active['attempt'], receipt)
                choice['native_receipt'] = receipt
                choice['rules_context'] = receipt['rules_context']
            else:
                answer = original_model(wrapped, qa)
            completed = 'returned'
            return answer
        finally:
            from cost_policy import usage
            try: after = rt.budget.used(provider, role, req['slot'])
            except Exception: after = None
            choice['usage'] = usage(before, after, completed, answer if qa else None)
            if provider == 'cursor' and isinstance(answer, dict):
                choice['usage'].update(tokens=answer.get('provider_reported_usage'),
                    usage_source='provider_reported_usage_plus_same_slot_invocation_ledger',
                    token_usage_reason=None, observed_model_call_ids=answer.get('observed_model_call_ids'),
                    provider_internal_calls=answer.get('provider_internal_calls'))
            if provider == 'agy' and choice.get('native_receipt'):
                choice['usage'].update(tokens=choice['native_receipt'].get('provider_reported_usage'),
                    usage_source='provider_reported_usage_plus_same_slot_invocation_ledger',
                    token_usage_reason=None)
            choice['head'] = store.data['active'].get('head')
            choice['attempt'] = store.data['active'].get('attempt')
            bridge.routing_receipts.append(dict(choice))
            trace['model'] = choice
            c.model, c.effort = old_model, old_effort
            trace['process'] = None
            publish_process()
    if req['stage'] == 'author' and store.data['active']:
        selected = route(s, store.data['active']['task'], 'author', req['profile'], rt.budget, req['slot'])
        if selected['provider'] == 'cursor':
            need(isinstance(native_auth,str) and native_auth, 'Cursor authentication unavailable before author attempt')
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



def cursor_successor_seed(a, api, active, slot):
    """One Owner-approved successor only; ordinary immutable admission still applies.

    This does not enroll/rewrite recovery185 or the original one-attempt canary.
    The installed root marker binds exact task bytes, archive and candidate.
    """
    if active['issue'] != 225:
        return None
    from native_cursor import MARKER, _read
    from core import digest, loads
    marker = loads(_read(MARKER, {0}, 16384))
    expected = dict(issue=225, parent=211, slot='slot2',
        task_sha256='4570522ac1c4a3685ba253a921561d1bb866c863878b3e084c6063a13efe3005',
        archive_sha256='97b0713cf85f8a97f1c84e620692c6090d1017c338b9857ca17dbccc7f756a88',
        head='95c138460cbaeeeab03b5bf781dea4cbfddadceb',
        base='f984891a10eebb73f1fc97ec8cd58013837e4da2',
        diagnosis_sha256='cf277ca0e02f12e989eee02c68d5e6e145f49f541e85c267dcd8a65b3b15548a')
    need(marker.get('successor') == expected and marker.get('phase') == 'canary'
         and marker.get('canary_task_sha256') == expected['task_sha256']
         and slot == expected['slot'] and digest(active['task']) == expected['task_sha256']
         and active['attempt'] == 0, 'unapproved Cursor successor seed')
    archive = loads(Path('/var/lib/gobadminton-autonomy/slots/slot2/actions-deferred.json').read_bytes())
    matches = [e for e in archive['entries'] if e.get('issue') == 211]
    need(len(matches) == 1 and digest(matches[0]) == expected['archive_sha256'],
         'original Cursor deferred evidence changed')
    original = matches[0]['snapshot']
    need(original['attempt'] == original['task']['max_attempts'] == 1
         and original['head'] == expected['head'] and original['base'] == expected['base']
         and original['qa']['verdict'] == 'FAIL' and original['qa']['reviewed_sha'] == expected['head'],
         'not the exact exhausted Cursor canary')
    a.Bridge.unchanged_issue(None, original)
    return expected


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
            inherited = req['_recovery_admission'].get('failure_diagnosis') or (
                req['_recovery_admission']['frozen']['snapshot'].get('failure_diagnosis'))
            if inherited:
                store.phase(active['phase'], failure_diagnosis=json.loads(json.dumps(inherited)))
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
            seed = cursor_successor_seed(a, api, active, req['slot'])
            if seed:
                b.git('fetch', '--no-tags', a.READ_REMOTE, seed['head'])
                need(b.git('rev-parse', 'FETCH_HEAD') == seed['head'], 'successor candidate fetch drift')
                store.phase('claimed', base=seed['base'], head=seed['head'])
                b.git('worktree', 'add', '-b', f'automation/issue-{active["issue"]}', str(b.work), seed['head'])
                need(b.git('merge-base', seed['base'], seed['head'], cwd=b.work) == seed['base'],
                     'successor candidate ancestry drift')
                b.clean(seed['head'])
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
        if stage == 'failure_diagnosis':
            from failure_diagnosis import perform as diagnose
            return diagnose(context)
        elif stage == 'author':
            need(active['phase'] == 'claimed' or active['phase'] == 'qa' and
                 (active.get('qa') or {}).get('verdict') == 'FAIL' or
                 active['phase'] == 'ci' and active.get('ci_failure') or
                 active['phase'] == 'pr_wait' and active.get('deterministic_failure'), 'author phase gate')
            need(active['attempt'] < active['task']['max_attempts'], 'attempts exhausted')
            metadata['routing'] = route(s, active['task'], 'author', req['profile'], rt.budget, req['slot'])
            diagnostic = active.get('ci_failure') or active.get('deterministic_failure')
            checkpoint = {}
            from failure_diagnosis import enabled, repair
            proof = b.saved_qa(active) if active['phase'] == 'ci' else None
            fix_details = repair(active, api, qa_evidence=proof) if active['phase'] != 'claimed' and enabled(active) else None
            if active['phase'] != 'claimed':
                b.candidate_identity(active)
                if active['phase'] == 'ci':
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
                    qa=active.get('qa'), qa_equivalence=active.get('qa_equivalence'),
                    ci=active.get('ci'), ci_failure=diagnostic,
                    source='actions bounded repair')]
            if fix_details is None and diagnostic:
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
            # Runtime review reuse is a separate proof, never a fresh PASS for
            # the integration SHA. CI remains exact to this new candidate.
            if hasattr(b, 'try_reuse_qa'):
                from qa_equivalence import eligible
                if eligible(b, active):
                    try:
                        metadata['deterministic_checks'] = run_result(a, api, active)
                    except a.Hold as error:
                        if str(error) != 'Actions failed': raise
                        failure = b.failed_ci(active)
                        store.phase('pr_wait', pr=prs[0]['number'], deterministic_failure=failure,
                                    independent_qa_pending=True)
                        rt.publish(store.data, store.parked)
                        return dict(status='confirmed', deterministic_checks=dict(status='failure', **failure),
                                    model_call_skipped='mandatory deterministic check failed')
                if b.try_reuse_qa(active):
                    store.phase('qa', pr=prs[0]['number'], independent_qa_pending=False)
                    passed = active['qa']['verdict'] == 'PASS'
                    if passed: b.saved_qa(active)
                    rt.publish(store.data, store.parked)
                    return dict(status='confirmed', runtime_review_reused=passed, **metadata)
                refusal = getattr(b, 'qa_reuse_refusal', None)
                if isinstance(refusal, str): metadata['qa_reuse_refusal'] = refusal
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


def qualify_qa(req, config, context):
    from native_antigravity import qualification, qualification_descriptor, review, save_receipt
    from context_policy import load
    from core import digest
    a, s, rt, api, store, b = context
    need(req['stage'] == 'qa_qualification' and store.data['active'] is None,
         'QA-only qualification source slot occupied')
    q = req.get('_qa_qualification')
    need(type(q) is dict, 'root QA qualification reservation missing')
    marker = qualification(req['slot'], q['task_sha256'])
    need(q == qualification_descriptor(marker) and q['head'] == req['head'], 'QA qualification marker drift')
    before = digest(store.data)
    work = Path(q['work'])
    text = ('Owner-authorized independent QA-only Antigravity qualification for Issue29. '
            'Review the exact source diff against the supplied accepted rules. Use native file '
            'and shell tools to inspect source and run a small relevant deterministic check; '
            'a successful run_command tool event is required. Candidate is read-only; use TMPDIR '
            'for generated outputs. Do not modify candidate/Git metadata, publish, access PROD/admin '
            'or credentials. Do not deliberately trigger denied tools. Return canonical QA JSON.')
    accepted_rules = load()
    before_calls = rt.budget.used('agy', 'qa', req['slot'])
    from antigravity_qa_recovery import grant,charge_grant,addressed,addressed_input
    is_addressed=addressed(q)
    analysis=is_addressed and q['qualification_grant']['role']=='technical_pm_product_analyst'
    if is_addressed:
        contract=addressed_input(work,q['qualification_grant'])
        if not analysis:text += '\nExact reviewed source/test contract DATA:\n'+contract
    charge=(lambda:charge_grant(q,req,rt.budget,b.c.state_dir,s)) if grant(q) else (lambda:rt.budget.charge(req['slot'],'agy','qa'))
    result, receipt = review(work, q['base'], q['head'], text, 1800,
        slot=req['slot'], task_hash=q['task_sha256'],
        charge=charge, popen=a.subprocess.Popen,
        accepted_rules=accepted_rules, evidence_dir=b.c.state_dir/'antigravity-evidence',
        **({'analysis_grant':q['qualification_grant']} if analysis else
           {'compact_files':True} if is_addressed and
           (q['qualification_grant'].get('owner_comment') in (6370661776,6372450456) or __import__('antigravity_qa_recovery').owner_package(q['qualification_grant'])) else {}))
    need(digest(store.data) == before, 'QA qualification changed source checkpoint')
    if grant(q):receipt['qualification_grant']=q['qualification_grant']
    receipt['qualification_task_sha256'] = q['task_sha256']
    receipt['qualification_lineage'] = {k:q[k] for k in ('parent_task_sha256','parent_operation','adapter_revision') if k in q}
    receipt['charged_calls'] = rt.budget.used('agy', 'qa', req['slot']) - before_calls
    need(receipt['charged_calls'] == 1, 'QA qualification ledger mismatch')
    if is_addressed:
        receipt['addressed_input_sha256']=q['qualification_grant']['input_sha256']
        receipt['addressed_role']=q['qualification_grant']['role']
    if analysis:
        receipt['qualification_passed']=False
        name=save_receipt(b.c.state_dir,29,0,receipt)
        return dict(status='confirmed',analysis_complete=result['completion']=='COMPLETE',
            analysis=result,qualification_passed=False,native_receipt=receipt,receipt_file=name,
            checkpoint_changed=False)
    passed = result['verdict'] == 'PASS' and 'run_command' in receipt.get('tool_names', [])
    receipt['qualification_passed'] = passed
    name = save_receipt(b.c.state_dir, 29, 0, receipt)
    return dict(status='confirmed', qualification_passed=passed, qa=result,
                native_receipt=receipt, receipt_file=name, checkpoint_changed=False)


def entry(req, config, native_auth=None):
    context = None
    try:
        context = setup(req, config, native_auth=native_auth)
        if req['stage'] == 'qa_qualification':
            return qualify_qa(req, config, context)
        if req['stage'] in ('diagnose', 'task_review'):
            from recovery import perform as recover
            return recover(req, config, context)
        return model_receipt(perform(req, config, context), context)
    except Retry as error:
        return dict(status='waiting', reason=str(error), retry_after=error.after)
    except Exception as error:
        from native_antigravity import ReviewError
        if isinstance(error, ReviewError):
            return model_receipt(dict(status='unknown',reason=error.code,safe_release=False,
                                      adapter_error=error.public()),context)
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
                    deferred = dict(issue=active['issue'], reason=reason,
                                    snapshot=json.loads(json.dumps(active)))
                    if (reason == 'attempts exhausted' and active['phase'] == 'ci'
                            and (active.get('qa') or {}).get('reviewed_sha') != active['head']):
                        from qa_equivalence import supplemental
                        deferred['qa_evidence'] = supplemental(active, req['slot'], b.saved_qa(active))
                    archive['entries'].append(deferred)
                    a.atomic(path, archive)  # archive first; never alter done/parked/history/budget
                    store.data['active'] = None
                    store.save()
                    safe = True
                except Exception:
                    pass
        uncertain = context and not safe and (req['stage'] in ('author', 'qa', 'qa_qualification', 'publish', 'integrate', 'promote', 'failure_diagnosis'))
        return model_receipt(dict(status='unknown' if uncertain else 'deferred', reason=reason, safe_release=safe), context)


def model_receipt(result, context):
    calls = getattr(context[-1], 'routing_receipts', []) if context else []
    if calls:
        result['routing'] = calls[-1] | {'stage_result': result.get('status')}
        result['model_calls'] = calls
    return result

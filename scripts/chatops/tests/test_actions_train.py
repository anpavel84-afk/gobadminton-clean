#!/usr/bin/python3
"""Bounded local simulations: no GitHub/SSH/model/services/install or private runtime reads."""
import copy
import datetime as dt
import fcntl
import hashlib
import base64
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.error

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts/chatops/actions_train'))
import core
import receiver
import stage
import client
import installer
import monitor
A, S = core.live()
TOKEN = 'github_pat_TEST_ONLY_NOT_A_CREDENTIAL'
HEAD, BASE = 'a'*40, 'b'*40
NOW = dt.datetime.now(dt.timezone.utc)
STAMP = NOW.isoformat()
TASK = dict(schema=A.MARKER, target='dev', kind='source_only', goal='Implement bounded change',
            acceptance='Independent source test and exact gates', allowed_paths=['apps/web/src/sample.ts'],
            locks=['web:sample'], max_attempts=3)

def issue(number=200, task=None):
    return dict(number=number, user={'id': core.OWNER}, state='open', created_at=STAMP, updated_at=STAMP,
                body=A.MARKER+'\n'+json.dumps(task or TASK))

def active(phase='candidate', number=200):
    return dict(issue=number, task=copy.deepcopy(TASK), phase=phase, head=HEAD, base=BASE,
                attempt=1, qa=None, ci=None, pr=None)

def req(stage_name='author', phase='claimed', **extra):
    return dict(action='train', stage=stage_name, phase=phase, head=HEAD, attempt=1, generation=0,
                slot='slot1', issue=200, profile='auto', run=100, run_attempt=1, gh_token=TOKEN, **extra)

def card(a=None, owned=True):
    return dict(active=a, done=[], parked=[], owned=owned, pending=None, generation=0, last=None)

def ci_run(dev=False, conclusion='success'):
    return dict(id=999, run_attempt=1, name='DEV deploy' if dev else 'Product CI', head_sha=HEAD,
                head_branch='dev' if dev else 'automation/issue-200', event='push', status='completed',
                repository={'id': core.REPO_ID}, html_url='https://github.com/test/run', conclusion=conclusion)

def jobs(dev=False):
    return [dict(name=n, head_sha=HEAD, status='completed', conclusion='success', steps=[
        dict(name=x, status='completed', conclusion='success') for x in A.REQUIRED_STEPS[n]])
        for n in sorted(A.DEV_JOBS if dev else A.CI_JOBS)]

class Admission(unittest.TestCase):
    def test_exact_numeric_immutable_schema(self):
        self.assertEqual(S.admitted(A, [issue()], [], NOW-dt.timedelta(days=1)), [(200, TASK)])
        for bad in (issue() | {'user': {'id': str(core.OWNER)}}, issue() | {'pull_request': {}},
                    issue() | {'updated_at': '2026-01-01T00:00:00Z'}, issue() | {'body': '# approved'},
                    issue(task=TASK | {'command': 'id'}), issue(task=TASK | {'max_attempts': 99}),
                    issue(task=TASK | {'allowed_paths': ['../secret']})):
            with self.subTest(bad=bad):
                self.assertEqual(S.admitted(A, [bad], [], NOW-dt.timedelta(days=1)), [])

    def test_duplicate_body_comment_not_authorized(self):
        parent = issue()
        comment = dict(id=1, issue_url=f'https://api.github.com/repos/{core.REPO}/issues/200',
                       user={'id': core.OWNER}, body=parent['body'], created_at=STAMP, updated_at=STAMP)
        self.assertEqual(S.admitted(A, [parent], [comment], NOW-dt.timedelta(days=1)), [])
        parent['body'] = 'ordinary parent'
        self.assertEqual(len(S.admitted(A, [parent], [comment], NOW-dt.timedelta(days=1))), 1)
        self.assertEqual(S.admitted(A, [parent], [comment, comment | {'id': 2}], NOW-dt.timedelta(days=1)), [])

    def test_wire_closed_and_token_not_in_binding(self):
        value = req()
        core.request(value)
        self.assertNotIn(TOKEN, json.dumps(core.binding(value)))
        for change in ({'shell': 'id'}, {'slot': 'slot3'}, {'head': 'main'}, {'attempt': True},
                       {'stage': 'supervise'}, {'profile': 'free'}, {'gh_token': 'a\nb'}):
            with self.assertRaises(core.Refused): core.request(value | change)
        with self.assertRaises(core.Refused): core.loads('{"stage":"a","stage":"b"}')

    def test_reviewable_install_manifest_pins_every_payload(self):
        manifest=json.loads((core.HERE/'manifest.json').read_text())
        for relative, checksum in manifest['files'].items():
            self.assertEqual(hashlib.sha256((ROOT/relative).read_bytes()).hexdigest(),checksum,relative)
        expected={str(p.relative_to(ROOT)) for p in core.HERE.rglob('*') if p.is_file()
                  and p.suffix in ('.py','.js','.json') and p.name!='manifest.json' and '__pycache__' not in p.parts}
        expected.add('scripts/chatops/server/gb-deploy-helper.sh')
        self.assertEqual(set(manifest['files']),expected)
    def test_live_hash_pins(self):
        for name, expected in core.PINS.items():
            self.assertEqual(hashlib.sha256((core.HERE/'live'/name).read_bytes()).hexdigest(), expected)
        self.assertNotIn('._execute(', (core.HERE/'stage.py').read_text())

class Planning(unittest.TestCase):
    def test_two_disjoint_slots_but_not_overlapping(self):
        snap = dict(slots={'slot1': card(), 'slot2': card()})
        independent = TASK | {'allowed_paths': ['apps/api/src/sample.ts'], 'locks': ['api:sample']}
        choices = [(200, TASK), (201, independent)]
        self.assertEqual([x['issue'] for x in core.plan(A,S,snap,choices)], [200,201])
        self.assertEqual(len(core.plan(A,S,snap,[(200,TASK),(201,TASK)])), 1)
        snap['slots']['slot1']['reservation'] = S.task_record(200, TASK)
        snap['slots']['slot1']['pending'] = {'status': 'running'}
        self.assertEqual([x['issue'] for x in core.plan(A,S,snap,choices)], [201])

    def test_dropped_overflow_cancelled_intent_rescued_from_issue(self):
        snap = dict(slots={'slot1': card(), 'slot2': card(owned=False)})
        # No transient event queue is consulted. Repeat reconcile rediscovers original immutable Issue.
        admitted = S.admitted(A,[issue()],[],NOW-dt.timedelta(days=1))
        self.assertEqual(core.plan(A,S,snap,admitted), core.plan(A,S,snap,admitted))
        self.assertEqual(core.plan(A,S,snap,admitted)[0]['stage'], 'claim')

    def test_failure_isolation_dependencies_and_done_preserved(self):
        snap = dict(slots={'slot1': card(), 'slot2': card()})
        snap['slots']['slot1']['parked'] = [200]
        snap['slots']['slot1']['done'] = list(range(34))
        snap['slots']['slot2']['done'] = [152]
        dependent = TASK | {'depends_on': [200]}
        choices = [(200,TASK),(201,dependent),(202,TASK)]
        self.assertEqual([x['issue'] for x in core.plan(A,S,snap,choices)], [202])
        self.assertEqual(snap['slots']['slot1']['done'], list(range(34)))
        self.assertEqual(snap['slots']['slot2']['done'], [152])

    def test_unknown_author_never_replayed_safe_effect_reconciled(self):
        snap = dict(slots={'slot1': card(active('developing'))})
        value = req()
        snap['slots']['slot1']['pending'] = dict(status='unknown', binding=core.binding(value))
        self.assertEqual(core.plan(A,S,snap,[]), [])
        value = req('publish', 'candidate')
        snap['slots']['slot1']['pending']['binding'] = core.binding(value)
        self.assertEqual(core.plan(A,S,snap,[])[0]['stage'], 'publish')

    def test_repair_routes_only_diagnostic_and_bound_enforced(self):
        a = active('ci'); a['ci_failure'] = {'failed': ['typecheck']}
        self.assertEqual(core.next_stage(a), 'author')
        a['phase']='qa';a['qa']={'verdict':'FAIL'}
        self.assertEqual(core.next_stage(a),'author')
        a['qa']={'verdict':'PASS'}
        self.assertEqual(core.next_stage(a),'ci')

class Routing(unittest.TestCase):
    class Budget:
        def __init__(self, left=4): self.left=left
        def remaining(self,*_): return self.left
        def used(self,*_): return 2
    def test_auto_only_proven_positive_budget(self):
        route=core.route(S,TASK,'author','auto',self.Budget(),'slot1')
        self.assertEqual(route['provider'],'codex')
        self.assertEqual(route['used_calls'],2)
        self.assertIn('cursor',route['unavailable'])
        self.assertEqual(route['effective_model'],'gpt-6.1-sol')
        for left in (None,0,-1):
            with self.assertRaises(core.Refused): core.route(S,TASK,'author','auto',self.Budget(left),'slot1')
    def test_explicit_refusal_and_role_bans(self):
        for name,role in (('cursor','author'),('agy','author'),('agy','qa'),('cursor','qa')):
            with self.assertRaises(core.Refused):core.route(S,TASK,role,name,self.Budget(),'slot1')
        self.assertEqual(core.route(S,TASK,'qa','codex',self.Budget(),'slot1')['provider'],'codex')
        with self.assertRaises(core.Refused):core.route(S,TASK|{'model':'unknown'},'author','auto',self.Budget(),'slot1')

class OpaqueGitHubCredentials(unittest.TestCase):
    def test_classic_and_2026_installation_jwt_are_opaque(self):
        for token in ('ghs_'+'A'*36, 'ghs_12345_'+('Ab-c_D'*30)+'.'+('ef-G_h'*30)+'.'+('ij-K_l'*25)):
            value=req();value['gh_token']=token
            self.assertEqual(core.request(value)['gh_token'],token)
            self.assertEqual(core.API(token)._token,token)
            self.assertNotIn('gh_token',core.binding(value))
    def test_transport_controls_whitespace_unicode_and_unbounded_values_rejected(self):
        for token in ('A'*9,'A'*4097,'A'*12+'\rX','A'*12+'\nX','A'*12+'\tX','A'*12+' X','A'*12+'\x00X','A'*12+'я',None):
            value=req();value['gh_token']=token
            with self.assertRaises(core.Refused):core.request(value)
            with self.assertRaises(core.Refused):core.API(token)
    def test_bad_credential_diagnostic_never_contains_credential(self):
        token='sensitive-value\nsecond-line';value=req();value['gh_token']=token
        with self.assertRaises(core.Refused) as error:core.request(value)
        self.assertEqual(str(error.exception),'invalid API credential')
        self.assertNotIn('sensitive',str(error.exception))


class APIReads(unittest.TestCase):
    def test_repository_identity_uses_canonical_root_without_trailing_slash(self):
        seen=[]
        def opener(req, **_):
            seen.append(req)
            return io.BytesIO(json.dumps(dict(id=core.REPO_ID, full_name=core.REPO, default_branch='main')).encode())
        api=core.API('fake_test_credential', opener=opener)
        api.identity()
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0].full_url, 'https://api.github.com/repos/' + core.REPO)
        self.assertEqual(seen[0].get_header('Authorization'), 'Bearer fake_test_credential')
    def test_repository_identity_still_rejects_wrong_repository(self):
        def opener(req, **_):
            return io.BytesIO(json.dumps(dict(id=1, full_name=core.REPO, default_branch='main')).encode())
        with self.assertRaises(core.Refused):
            core.API('fake_test_credential', opener=opener).identity()
    def test_auth_only_to_github(self):
        seen=[]
        def opener(req,**_): seen.append(req);return io.BytesIO(b'{"gitSha":"a"}')
        api=core.API(TOKEN,opener)
        api('issues/200');api('https://dev.gobadminton.ru/v1/meta')
        self.assertEqual(seen[0].get_header('Authorization'),'Bearer '+TOKEN)
        self.assertIsNone(seen[1].get_header('Authorization'))
        with self.assertRaises(core.Refused):api('https://evil.invalid')
    def test_rate_limit_uses_real_retry_and_never_echoes_token(self):
        def opener(req,**_):raise urllib.error.HTTPError(req.full_url,429,TOKEN,{'Retry-After':'7'},None)
        with self.assertRaises(core.Retry) as result:core.API(TOKEN,opener)('issues/200')
        self.assertEqual(result.exception.after,7)
        self.assertNotIn(TOKEN,str(result.exception))
    def test_nonidempotent_failure_not_blindly_repeated(self):
        calls=[]
        def opener(req,**_):calls.append(req);raise urllib.error.URLError(TOKEN)
        with self.assertRaises(core.Retry) as result:core.API(TOKEN,opener)('actions/workflows/x/dispatches',{'ref':'main'})
        self.assertEqual(len(calls),1)
        self.assertNotIn(TOKEN,str(result.exception))
    def test_read_transient_retry_is_bounded(self):
        with patch('core.time.sleep') as sleep:
            def opener(req,**_):raise urllib.error.URLError('offline')
            with self.assertRaises(core.Retry):core.API(TOKEN,opener)('issues/200')
            self.assertEqual(sleep.call_count,2)

class Gates(unittest.TestCase):
    class API:
        def __init__(self,dev=False):self.run=ci_run(dev);self.jobs=jobs(dev)
        def pages(self,path,key=None):return [self.run] if key=='workflow_runs' else self.jobs
    def test_ci_exact_full_jobs_and_required_steps(self):
        api=self.API()
        self.assertEqual(stage.run_result(A,api,active())['sha'],HEAD)
        for mutation in ('sha','missing','skipped','step','fork','branch'):
            api=self.API()
            if mutation=='sha':api.jobs[0]['head_sha']=BASE
            if mutation=='missing':api.jobs.pop()
            if mutation=='skipped':api.jobs[0]['conclusion']='skipped'
            if mutation=='step':api.jobs[0]['steps'].pop()
            if mutation=='fork':api.run['repository']['id']=1
            if mutation=='branch':api.run['head_branch']='dev'
            with self.subTest(mutation=mutation), self.assertRaises(Exception):stage.run_result(A,api,active())
    def test_cancelled_workflow_remains_waiting_for_exact_real_run(self):
        api=self.API();api.run['conclusion']='cancelled'
        with self.assertRaises(core.Retry):stage.run_result(A,api,active())
    def test_ci_failure_and_wait_are_not_pass(self):
        api=self.API();api.run['conclusion']='failure'
        with self.assertRaises(A.Hold):stage.run_result(A,api,active())
        api.run['status']='in_progress'
        with self.assertRaises(core.Retry):stage.run_result(A,api,active())
    def test_dev_accept_step_required_and_receipt_exact(self):
        api=self.API(True)
        stage.run_result(A,api,active('dev_wait'),True)
        deploy=next(j for j in api.jobs if j['name']=='deploy')
        deploy['steps']=[s for s in deploy['steps'] if s['name']!=A.DEPLOY_STEP]
        with self.assertRaises(A.Hold):stage.run_result(A,api,active('dev_wait'),True)
        now=int(time.time())
        receipt=dict(schema=1,environment='dev',pending=False,observed_at=now,accepted=dict(
            status='ACCEPTED',source_sha=HEAD,release_id='r999-a1',finished_at=now,
            api_digest='sha256:'+'a'*64,web_digest='sha256:'+'b'*64))
        A.validate_server_evidence(receipt,'r999-a1',HEAD)
        for change in ({'pending':True},{'accepted':receipt['accepted']|{'source_sha':BASE}},
                       {'accepted':receipt['accepted']|{'status':'ROLLED_BACK'}}):
            with self.assertRaises(A.Hold):A.validate_server_evidence(receipt|change,'r999-a1',HEAD)

class Journal(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=ROOT,prefix='.train-tests-')
        self.folder=Path(self.temp.name)
        self.state=card(active('claimed'))
        self.workflow_raw=('ref: '+HEAD+'\n').encode()
        self.policy=dict(mode='active',owned={'slot1': 'before','slot2':'before'},controller_sha=HEAD,
                         stage_workflow_sha256=hashlib.sha256(self.workflow_raw).hexdigest())
        self.patches=[patch.object(receiver,'STATE',self.folder), patch.object(receiver,'ROOT_LOCK',0,create=True),
                      patch.object(receiver,'guard',return_value=SimpleNamespace()),
                      patch.object(receiver,'checkpoint',side_effect=lambda slot:(dict(active=self.state['active'] if slot=='slot1' else None,done=[]),[])),
                      patch.object(receiver.os,'fork',return_value=999999),
                      patch.object(receiver,'identity',return_value={'pid':999999,'start':'1','boot':'boot'}),
                      patch.object(core,'API',self.FakeAPI)]
        original=receiver.read
        self.patches.append(patch.object(receiver,'read',side_effect=lambda p,owner=None,limit=2097152:original(p,None,limit)))
        for p in self.patches:p.start()
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()
    class FakeAPI:
        def __init__(self,*_):pass
        def identity(self):pass
        def __call__(self,path):
            if path.startswith('issues/'):return issue()
            if path.startswith('contents/'):
                import base64
                raw=('ref: '+HEAD+'\n').encode()
                return dict(type='file',path='.github/workflows/train-stage.yml',encoding='base64',
                            size=len(raw),content=base64.b64encode(raw).decode())
            return dict(path='.github/workflows/train-stage.yml',head_branch='dev',head_sha=HEAD,
                        event='workflow_dispatch',run_attempt=1,status='in_progress',
                        repository={'id':core.REPO_ID},head_repository={'id':core.REPO_ID},actor={'id':core.OWNER})
        def pages(self,*_):return []
    def test_pending_before_fork_and_no_token_persisted(self):
        receiver.handle(req(),self.policy)
        raw=(self.folder/'slot1.json').read_text()
        self.assertNotIn(TOKEN,raw)
        j=json.loads(raw)
        self.assertIsNotNone(j['pending'])
        with patch.object(receiver,'alive',return_value=True):
            self.assertEqual(receiver.handle(req(run=101) if False else req()|{'run':101},self.policy)['status'],'running')
            self.assertEqual(receiver.os.fork.call_count,1)
    def test_double_author_new_workflow_and_generation_rejected(self):
        receiver.handle(req(),self.policy)
        with patch.object(receiver,'alive',return_value=False):
            self.assertEqual(receiver.handle(req()|{'run':102},self.policy)['status'],'unknown')
        with self.assertRaises(core.Refused):receiver.handle(req()|{'generation':1},self.policy)
        self.assertEqual(receiver.os.fork.call_count,1)
    def test_cancel_reboot_unknown_writer_not_recharged(self):
        receiver.handle(req(),self.policy)
        with patch.object(receiver,'alive',return_value=False):
            value=receiver.snapshot(self.policy)
            self.assertEqual(value['slots']['slot1']['pending']['status'],'unknown')
            self.assertEqual(receiver.handle(req(),self.policy)['status'],'unknown')
        self.assertEqual(receiver.os.fork.call_count,1)
    def test_safe_unknown_publish_only_reconciles(self):
        self.state['active']=active('candidate')
        receiver.handle(req('publish','candidate'),self.policy)
        with patch.object(receiver,'alive',return_value=False):
            receiver.handle(req('publish','candidate'),self.policy)
        self.assertEqual(receiver.os.fork.call_count,2)
    def test_recovery_attempts_bounded(self):
        self.state['active']=active('candidate')
        receiver.handle(req('publish','candidate'),self.policy)
        with patch.object(receiver,'alive',return_value=False):
            for _ in range(5):receiver.handle(req('publish','candidate'),self.policy)
        self.assertEqual(receiver.os.fork.call_count,4)  # initial + three READ-only recoveries
        self.assertFalse(receiver.snapshot(self.policy)['slots']['slot1']['pending']['recoverable'])
    def test_root_dev_reservation_survives_stage_process(self):
        self.state['active']=active('ci')
        receiver.handle(req('integrate','ci'),self.policy)
        self.assertEqual(json.loads((self.folder/'integration.json').read_text()),{'slot':'slot1','issue':200})
    def test_stale_expected_head(self):
        with self.assertRaises(core.Refused):receiver.handle(req()|{'head':BASE},self.policy)
        self.assertFalse((self.folder/'slot1.json').exists())
    def test_parallel_pending_claims_overlap_rejected(self):
        self.state['active']=None
        receiver.handle(req('claim','idle')|{'head':None,'attempt':0},self.policy)
        with self.assertRaises(core.Refused):
            receiver.handle(req('claim','idle')|{'slot':'slot2','head':None,'attempt':0},self.policy)
        self.assertFalse((self.folder/'slot2.json').exists())
    def test_completed_receipts_archived_without_replaying_old_operation(self):
        j=receiver.journal('slot1');key=core.digest(core.binding(req()))
        j['operations']={key:dict(binding=core.binding(req()),result={'status':'confirmed'})}
        for i in range(100):j['operations'][str(i)]=dict(binding=core.binding(req()),result={'status':'confirmed'})
        receiver.archive_completed('slot1',j)
        self.assertEqual(len(j['operations']),96)
        receiver.atomic(self.folder/'slot1.json',j)
        self.assertEqual(receiver.handle(req(),self.policy)['status'],'confirmed')
        receiver.os.fork.assert_not_called()
        self.assertEqual(len(list((self.folder/'history/slot1').glob('*.json'))),5)
    def test_task_generation_bound_survives_operation_archival(self):
        j=receiver.journal('slot1');j['stage_counts']={'200':128}
        receiver.atomic(self.folder/'slot1.json',j)
        with self.assertRaises(core.Refused):receiver.handle(req(),self.policy)
        receiver.os.fork.assert_not_called()
    def test_profile_disabled_shadow_refuses_effect(self):
        with patch.object(receiver,'guard',side_effect=core.Refused('root migration ownership absent')):
            with self.assertRaises(core.Refused):receiver.handle(req(),self.policy|{'mode':'shadow'})
        receiver.os.fork.assert_not_called()

class ProcessExclusion(unittest.TestCase):
    def test_real_kernel_worker_lock_excludes_second_author(self):
        with tempfile.TemporaryDirectory(dir=ROOT,prefix='.train-tests-') as temp:
            folder=Path(temp);folder.chmod(0o700)
            store=A.Store(folder)
            code='import fcntl,os,sys; f=os.open(sys.argv[1],os.O_RDONLY); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)'
            p=subprocess.run([sys.executable,'-c',code,str(folder/'worker.lock')],capture_output=True)
            self.assertNotEqual(p.returncode,0)
            os.close(store.lock)
            p=subprocess.run([sys.executable,'-c',code,str(folder/'worker.lock')],capture_output=True)
            self.assertEqual(p.returncode,0,p.stderr)
    def test_boot_start_identity_defeats_pid_reuse(self):
        i=receiver.identity(os.getpid())
        self.assertTrue(receiver.alive(i))
        self.assertFalse(receiver.alive(i|{'boot':'previous boot'}))
        self.assertFalse(receiver.alive(i|{'start':'0'}))

class Migration(unittest.TestCase):
    def test_prepare_dry_writes_nothing_and_checks_before_hash(self):
        with tempfile.TemporaryDirectory(dir=ROOT,prefix='.train-tests-') as temp:
            d=Path(temp);helper=d/'helper';helper.write_text('live')
            bundle=d/'bundle';src=bundle/'scripts/chatops/actions_train';src.mkdir(parents=True)
            (src/'receiver.py').write_text('reviewed code')
            server=bundle/'scripts/chatops/server';server.mkdir();(server/'gb-deploy-helper.sh').write_text('hook')
            entries={str(p.relative_to(bundle)):installer.sha(p) for p in (src/'receiver.py',server/'gb-deploy-helper.sh')}
            manifest=src/'manifest.json';manifest.write_text(json.dumps(dict(schema='GB_ACTIONS_TRAIN_INSTALL_V1',files=entries)))
            with patch.multiple(installer,HELPER=helper,INSTALL=d/'install',STATE=d/'state',POLICY=d/'etc/policy.json',LIVE_HELPER=installer.sha(helper)),patch.object(installer,'units',return_value={}):
                before=sorted(str(p) for p in d.rglob('*'))
                result=installer.prepare(bundle,installer.sha(manifest))
                self.assertTrue(result['dry'])
                self.assertEqual(sorted(str(p) for p in d.rglob('*')),before)
                helper.write_text('drift')
                with self.assertRaises(core.Refused):installer.prepare(bundle,installer.sha(manifest))
    def test_unknown_writer_migration_refused_without_stopping_units(self):
        with patch.object(installer,'checkpoint',return_value=({'active':active('developing'),'done':[152]},[])), \
             patch.object(installer,'no_models'),patch.object(installer,'free_lock'), \
             patch('pwd.getpwnam',return_value=SimpleNamespace(pw_uid=1002)):
            with self.assertRaises(core.Refused):installer.safe_state('slot1',True)
    def test_rollback_disables_dispatch_before_unknown_refusal_and_keeps_history(self):
        policy=dict(mode='active',owned={'slot1':'hash'})
        record=dict(before={},after={})
        writes=[]
        def read(path,*_):return policy if path==installer.POLICY else record
        with patch.object(installer,'read',side_effect=read),patch.object(installer,'atomic',side_effect=lambda p,v,**_:writes.append((p,v))), \
             patch.object(installer,'journal',return_value={'pending':'unknown'}),patch.object(installer,'safe_state') as safe:
            with self.assertRaises(core.Refused):installer.rollback(True)
        self.assertEqual(writes[0][1]['mode'],'disabled')
        self.assertEqual(len(writes),1)
        safe.assert_not_called()
    def test_rollback_dry_preserves_all_runtime_data(self):
        with patch.object(installer,'read',side_effect=[dict(mode='disabled',owned={}),dict(before={},after={})]), \
             patch.object(installer,'atomic') as write,patch.object(installer.Path,'exists',return_value=False):
            self.assertTrue(installer.rollback()['dry'])
            write.assert_not_called()

class MonitorAndWorkflows(unittest.TestCase):
    def test_monitor_preserves_titles_backlog_and_no_fake_process(self):
        c=card(active('claimed'));c['last']=dict(confirmed_at=1,status='confirmed',stage='claim')
        source=dict(schema='GB_ACTIONS_TRAIN_V1',slots={'slot1':c})
        original=dict(slots=[{'slot':'slot1','title':'actual title'}],backlog=[151,156],history=[152])
        result=monitor.extend(original,source,10000)
        self.assertEqual(result['backlog'],[151,156]);self.assertEqual(result['history'],[152])
        value=result['slots'][0]['actions_train']
        self.assertEqual(value['stages'],list(monitor.STAGES));self.assertEqual(value['status'],'stale')
        self.assertIsNone(value['process']);self.assertEqual(result['slots'][0]['title'],'actual title')
    def test_monitor_wait_keeps_last_confirmed_event_and_reports_exact_failure(self):
        c=card(active('ci'));c['active']['ci_failure']={'head':HEAD,'run':99}
        c['last']=dict(status='waiting',reason='API backoff',confirmed_at=None)
        c['confirmed']=dict(confirmed_at=100,status='confirmed')
        value=monitor.project(c,200)
        self.assertEqual(value['last_confirmed_event'],100)
        self.assertEqual(value['ci']['status'],'error')
        self.assertEqual(value['wait_reason'],'API backoff')
    def test_hook_before_lock_and_original_remaining_helper_exact(self):
        text=(ROOT/'scripts/chatops/server/gb-deploy-helper.sh').read_text()
        self.assertLess(text.index('if [[ $ACTION == train ]]'),text.index('flock -w 30 9'))
        self.assertIn('[[ $ENVIRONMENT == dev ]]',text)
        self.assertNotIn('curl',text[text.index('if [[ $ACTION == train ]]'):text.index('trusted "$CONFIG_ROOT')])
        begin=text.index('# DEV train uses installed trusted code')
        end=text.index('trusted "$CONFIG_ROOT/$ENVIRONMENT.conf"',begin)
        read='\n'.join(line[2:] for line in text[begin:end].splitlines()[2:7])+'\n'
        original=text[:begin]+text[end:]
        prod='if [[ $ENVIRONMENT != dev ]]; then\n'+''.join('  '+x+'\n' for x in read.rstrip().splitlines())+'fi\n'
        original=original.replace(prod,read,1)
        self.assertEqual(hashlib.sha256(original.encode()).hexdigest(),installer.LIVE_HELPER)
    def test_workflows_hosted_dev_pinned_queue_and_no_candidate_secrets(self):
        for name in ('train-dispatch.yml','train-stage.yml'):
            text=(ROOT/'.github/workflows'/name).read_text()
            self.assertIn('queue: max',text);self.assertIn('cancel-in-progress: false',text)
            self.assertNotIn('self-hosted',text)
            self.assertRegex(text,r'ref: [0-9a-f]{40}')
            self.assertIn('persist-credentials: false',text)
            self.assertIn("github.ref == 'refs/heads/dev'",text)
        text=(ROOT/'.github/workflows/train-dispatch.yml').read_text()
        commissioning=text.split('  commissioning:')[1].split('  reconcile:')[0]
        self.assertNotIn('environment:',commissioning);self.assertNotIn('secrets.',commissioning)
        self.assertIn('chatops/actions-train-20261021',text)
        self.assertNotIn("workflows: ['Train stage'",text)
        stage_workflow=(ROOT/'.github/workflows/train-stage.yml').read_text()
        execute=stage_workflow.split('  execute:')[1].split('  continue:')[0]
        continuation=stage_workflow.split('  continue:')[1]
        self.assertIn('actions: read',execute);self.assertNotIn('actions: write',execute)
        self.assertIn('actions: write',continuation);self.assertNotIn('DEPLOY_SSH_KEY',continuation)
        self.assertNotIn('checkout@',continuation)
        self.assertIn("'ref': 'dev'",continuation)
        self.assertIn('fromJSON(inputs.operation).slot',stage_workflow)
    def test_exact_event_fork_and_untrusted_actor_rejection(self):
        event=dict(repository={'id':core.REPO_ID},sender={'id':123},action='created')
        with self.assertRaises(core.Refused):client.trusted_event(event,'issue_comment',None)
        event['sender']['id']=core.OWNER
        client.trusted_event(event,'issue_comment',None)
        event['workflow_run']={'id':1}
        fresh=dict(path='.github/workflows/ci.yml',status='completed',event='push',repository={'id':core.REPO_ID},
                   head_repository={'id':99},head_branch='automation/issue-200')
        with self.assertRaises(core.Refused):client.trusted_event(event,'workflow_run',lambda *_:fresh)

if __name__=='__main__':unittest.main()

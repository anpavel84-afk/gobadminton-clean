"""Stage boundary and reversible installer simulations, using only isolated local files."""
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from test_actions_train import client, A, S, ROOT, TASK, HEAD, BASE, TOKEN, active, req, core, stage, installer, receiver

class Store:
    def __init__(self, a):self.data={'active':a,'done':[152]};self.parked=[]
    def phase(self, p, **fields):
        self.data['active'].update(phase=p,**fields)
        if p=='done':self.data['done'].append(self.data['active']['issue'])
    def save(self):pass

class Bridge:
    def __init__(self, store, directory):
        self.store=store;self.c=SimpleNamespace(state_dir=directory,worktrees_root=directory)
        self.calls=[];self.remote=BASE;self.work=directory;self.qa_verdict='PASS'
    def unchanged_issue(self,a):self.calls.append('immutable')
    def stopped_writer(self,h):self.calls.append('stopped')
    def saved_qa(self,a):
        self.calls.append('saved_qa')
        core.need(A.qa_result(a['qa'],a['head']),'no exact QA')
    def candidate_identity(self,a):self.calls.append('identity')
    def author(self,a,**fields):
        self.calls.append('author');a.update(phase='candidate',attempt=a['attempt']+1,head='c'*40,qa=None,ci=None,**fields)
    def review(self,a):
        self.calls.append('qa');a['qa']=dict(verdict=self.qa_verdict,findings=[] if self.qa_verdict=='PASS' else ['source defect'],reviewed_sha=a['head'])
    def failed_ci(self,a):self.calls.append('failed_ci');return a['ci_failure']
    def remote_dev(self):self.calls.append('remote_dev');return self.remote
    def integrate(self,a,dev):
        self.calls.append('merge');a.update(phase='candidate',head='d'*40,base=dev,qa=None,ci=None)
    def finish_integration(self,a,dev):self.integrate(a,dev)
    def git(self,*argv,**_):
        self.calls.append(argv)
        if argv[0]=='ls-remote':return HEAD+'\trefs/heads/automation/issue-200'
        if argv[0]=='merge-base':return BASE
        if argv[0]=='push' and '--atomic' in argv:self.remote=HEAD
        return ''

class StageBoundaries(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=ROOT,prefix='.train-tests-');self.folder=Path(self.temp.name)
        self.store=Store(active('claimed'));self.bridge=Bridge(self.store,self.folder)
        self.rt=SimpleNamespace(lease=Mock(),publish=Mock(),continuity=lambda:{'enabled':True},
                                mutex=SimpleNamespace(try_acquire=lambda:True),budget=Mock())
        self.api=SimpleNamespace(pages=lambda *args:[dict(number=300,head=dict(sha=HEAD,repo={'id':core.REPO_ID}),base=dict(repo={'id':core.REPO_ID},ref='dev'))])
        self.context=(A,S,self.rt,self.api,self.store,self.bridge)
        self.routing=patch.object(stage,'route',return_value={'provider':'codex','effective_model':'gpt-6.1-sol'})
        self.routing.start()
    def tearDown(self):self.routing.stop();self.temp.cleanup()
    def run_stage(self,name,phase=None,**extra):
        a=self.store.data['active']
        r=req(name,phase or a['phase'])|{'head':a['head'],'attempt':a['attempt']}|extra
        return stage.perform(r,{},self.context)
    def exact_qa(self):self.store.data['active']['qa']={'verdict':'PASS','findings':[],'reviewed_sha':HEAD}
    def test_author_only_one_call_no_push_no_qa(self):
        self.run_stage('author')
        self.assertEqual(self.bridge.calls,['immutable','author'])
        self.assertEqual(self.store.data['active']['attempt'],2)
        self.assertEqual(self.store.data['active']['phase'],'candidate')
    def test_publish_does_not_qa_or_promote(self):
        self.store.data['active']['phase']='candidate'
        self.run_stage('publish')
        self.assertEqual(self.store.data['active']['phase'],'pr_wait')
        self.assertNotIn('qa',self.bridge.calls);self.assertNotIn('author',self.bridge.calls)
        self.assertFalse(any(isinstance(x,tuple) and x[0]=='push' for x in self.bridge.calls))
    def test_qa_independent_stage_never_repairs(self):
        self.store.data['active']['phase']='pr_wait';self.bridge.qa_verdict='FAIL'
        self.run_stage('qa')
        self.assertEqual(self.bridge.calls.count('qa'),1);self.assertNotIn('author',self.bridge.calls)
        self.assertEqual(self.store.data['active']['qa']['verdict'],'FAIL')
        self.assertEqual(self.store.data['active']['phase'],'qa')
    def test_ci_records_gate_without_promote(self):
        self.store.data['active']['phase']='qa';self.exact_qa()
        with patch.object(stage,'run_result',return_value={'sha':HEAD,'id':999}):self.run_stage('ci')
        self.assertEqual(self.store.data['active']['phase'],'ci')
        self.assertNotIn('remote_dev',self.bridge.calls)
    def test_ci_repair_keeps_diagnostic_and_before_snapshot_for_independent_qa(self):
        diagnostic={'head':HEAD,'run':999,'failed':[{'job':'source (web)','steps':['typecheck']}]}
        self.store.data['active'].update(phase='ci',ci_failure=diagnostic);self.exact_qa()
        before=copy.deepcopy(self.store.data)
        self.run_stage('author')
        a=self.store.data['active']
        self.assertEqual(a['ci_failure'],diagnostic)
        self.assertEqual(a['history'][-1]['head'],HEAD)
        self.assertEqual(json.loads((self.folder/'actions-before-repair-200-a1.json').read_text()),before)
        self.assertEqual(self.bridge.calls.count('author'),1)
        self.assertIn('failed_ci',self.bridge.calls)
    def test_dev_drift_merge_clears_gates_for_new_exact_qa_and_ci(self):
        self.store.data['active'].update(phase='ci',ci={'sha':HEAD});self.exact_qa()
        self.bridge.remote='e'*40
        with patch.object(stage,'run_result',return_value={'sha':HEAD}):self.run_stage('integrate')
        a=self.store.data['active'];self.assertEqual(a['phase'],'candidate')
        self.assertIsNone(a['qa']);self.assertIsNone(a['ci'])
        self.assertEqual(a['base'],'e'*40);self.assertIn('merge',self.bridge.calls)
        self.assertNotIn('qa',self.bridge.calls)
    def test_integrate_same_dev_stops_before_push(self):
        self.store.data['active'].update(phase='ci',ci={'sha':HEAD});self.exact_qa()
        with patch.object(stage,'run_result',return_value={'sha':HEAD}):self.run_stage('integrate')
        self.assertEqual(self.store.data['active']['phase'],'promoting')
        self.assertNotIn('merge',self.bridge.calls)
        self.assertFalse(any(isinstance(x,tuple) and x[0]=='push' for x in self.bridge.calls))
    def test_promote_requires_revalidated_ci_and_exact_qa(self):
        self.store.data['active']['phase']='promoting';self.exact_qa()
        with patch.object(stage,'run_result',return_value={'sha':HEAD}) as gate:self.run_stage('promote')
        gate.assert_called_once()
        self.assertEqual(self.store.data['active']['phase'],'dev_wait')
        self.assertIn(('push','--atomic',A.WRITE_REMOTE,HEAD+':refs/heads/dev'),self.bridge.calls)
    def test_promote_benign_drift_returns_to_integration_without_push(self):
        self.store.data['active'].update(phase='promoting',ci={'sha':HEAD});self.exact_qa();self.bridge.remote='e'*40
        with patch.object(stage,'run_result',return_value={'sha':HEAD}):result=self.run_stage('promote')
        self.assertTrue(result['needs_integration']);self.assertEqual(self.store.data['active']['phase'],'ci')
        self.assertFalse(any(isinstance(x,tuple) and x[0]=='push' for x in self.bridge.calls))
    def test_promote_rewritten_dev_history_refused_without_push(self):
        self.store.data['active'].update(phase='promoting',ci={'sha':HEAD});self.exact_qa();self.bridge.remote='e'*40
        original=self.bridge.git
        self.bridge.git=lambda *args,**kw: 'f'*40 if args[0]=='merge-base' else original(*args,**kw)
        with patch.object(stage,'run_result',return_value={'sha':HEAD}),self.assertRaises(core.Refused):self.run_stage('promote')
        self.assertFalse(any(isinstance(x,tuple) and x[0]=='push' for x in self.bridge.calls))
    def test_unknown_push_recovery_reads_remote_without_push(self):
        self.store.data['active']['phase']='promoting';self.exact_qa();self.bridge.remote=HEAD
        with patch.object(stage,'run_result',return_value={'sha':HEAD}):self.run_stage('promote',_recover=True)
        self.assertEqual(self.store.data['active']['phase'],'dev_wait')
        self.assertFalse(any(isinstance(x,tuple) and x[0]=='push' for x in self.bridge.calls))
    def test_dev_done_only_after_exact_live_receipt(self):
        self.store.data['active']['phase']='dev_wait';self.exact_qa();self.bridge.remote=HEAD
        self.context=(A,S,self.rt,lambda *_:{'gitSha':HEAD},self.store,self.bridge)
        with patch.object(stage,'run_result',return_value={'sha':HEAD,'id':999,'attempt':1}), \
             patch.object(A,'server_evidence',return_value={'accepted':{'source_sha':HEAD}}):self.run_stage('dev')
        self.assertEqual(self.store.data['active']['phase'],'done');self.assertEqual(self.store.data['done'],[152,200])
    def test_bounded_exhaustion_archives_without_done_or_park(self):
        self.store.data['active'].update(phase='qa',attempt=3,qa={'verdict':'FAIL','findings':['defect'],'reviewed_sha':HEAD})
        snapshot=copy.deepcopy(self.store.data['active'])
        with patch.object(stage,'setup',return_value=self.context):result=stage.entry(req('author','qa')|{'attempt':3},{})
        self.assertTrue(result['safe_release']);self.assertIsNone(self.store.data['active'])
        self.assertEqual(self.store.data['done'],[152]);self.assertEqual(self.store.parked,[])
        archive=json.loads((self.folder/'actions-deferred.json').read_text())
        self.assertEqual(archive['entries'][0]['snapshot'],snapshot)
        self.assertNotIn('author',self.bridge.calls)
    def test_known_auth_failure_releases_only_proven_clean_source_without_resetting_attempt(self):
        def unavailable(a,**_):
            a.update(phase='developing',attempt=2)
            raise A.Hold('BLOCKED: model authentication rejected (401/unauthorized)')
        self.bridge.author=unavailable
        with patch.object(stage,'setup',return_value=self.context):result=stage.entry(req(),{})
        self.assertEqual(result['status'],'deferred');self.assertTrue(result['safe_release'])
        archive=json.loads((self.folder/'actions-deferred.json').read_text())
        self.assertEqual(archive['entries'][0]['snapshot']['attempt'],2)
        self.assertEqual(self.store.data['done'],[152]);self.assertIn('stopped',self.bridge.calls)
    def test_actual_integration_limit_defers_clean_task_without_losing_history(self):
        import copy
        active=self.store.data['active']
        active.update(phase='ci',integration=3,ci={'sha':HEAD});self.exact_qa()
        self.bridge.remote='e'*40;self.bridge.clean=lambda head:None
        self.bridge.integrate=lambda current,dev:A.Bridge.integrate(self.bridge,current,dev)
        before=copy.deepcopy(self.store.data)
        with patch.object(A,'continuity',return_value={'max_integrations':3}), \
             patch.object(stage,'setup',return_value=self.context), \
             patch.object(stage,'run_result',return_value={'sha':HEAD}):
            result=stage.entry(req('integrate','ci'),{})
        self.assertEqual(result['status'],'deferred');self.assertTrue(result['safe_release'])
        self.assertIsNone(self.store.data['active']);self.assertEqual(self.store.data['done'],before['done'])
        archive=json.loads((self.folder/'actions-deferred.json').read_text())
        self.assertEqual(archive['entries'][0]['snapshot'],before['active'])
        self.assertEqual(archive['entries'][0]['reason'],'integration bound exhausted')
        self.assertIn('stopped',self.bridge.calls)

    def test_unknown_author_exception_retains_checkpoint(self):
        def uncertain(a,**_):a['phase']='developing';raise RuntimeError('process lost')
        self.bridge.author=uncertain
        with patch.object(stage,'setup',return_value=self.context):result=stage.entry(req(),{})
        self.assertEqual(result['status'],'unknown');self.assertEqual(self.store.data['active']['phase'],'developing')

class HostedContinuation(unittest.TestCase):
    def test_read_only_job_emits_continuation_only_for_its_actual_transition(self):
        import contextlib,io
        descriptor={k:v for k,v in req().items() if k not in ('action','run','run_attempt','gh_token')}
        for previous in (False,True):
            with tempfile.TemporaryDirectory(dir=ROOT,prefix='.train-tests-') as temp:
                folder=Path(temp);old=Path.cwd()
                try:
                    os.chdir(folder)
                    output=folder/'output'
                    with patch.dict(os.environ,dict(GITHUB_OUTPUT=str(output),GITHUB_REF='refs/heads/dev',
                                    GITHUB_RUN_ID='100',GITHUB_RUN_ATTEMPT='1',GH_TOKEN=TOKEN)):
                        api=Mock()
                        ssh=Mock(return_value=dict(status='confirmed',last=dict(changed=True,status='confirmed',
                                   workflow_run=99 if previous else 100,workflow_attempt=1)))
                        with contextlib.redirect_stdout(io.StringIO()):client.execute(api,ssh,descriptor)
                        self.assertEqual(output.read_text(),'changed='+('false' if previous else 'true')+'\n')
                        self.assertNotIn(TOKEN,(folder/'evidence/stage.json').read_text())
                        api.assert_not_called()  # actions:write is confined to the separate hosted job
                finally:os.chdir(old)

class ReversibleInstaller(unittest.TestCase):
    def test_isolated_prepare_activation_rollback_restores_code_and_flags_only(self):
        with tempfile.TemporaryDirectory(dir=ROOT,prefix='.train-tests-') as temp:
            d=Path(temp);bundle=d/'bundle';source=bundle/'scripts/chatops/actions_train';source.mkdir(parents=True)
            (source/'receiver.py').write_text('reviewed receiver')
            server=bundle/'scripts/chatops/server';server.mkdir();(server/'gb-deploy-helper.sh').write_text('tiny train hook')
            files={str(p.relative_to(bundle)):installer.sha(p) for p in (source/'receiver.py',server/'gb-deploy-helper.sh')}
            manifest=source/'manifest.json';manifest.write_text(json.dumps({'schema':'GB_ACTIONS_TRAIN_INSTALL_V1','files':files}))
            helper=d/'helper';helper.write_text('actual old helper');helper.chmod(0o755)
            live_hash=installer.sha(helper);state=d/'state';policy=d/'config/policy.json';handoff=d/'handoff.json';handoff.write_text('{}')
            history=d/'original-checkpoint';history.write_text(json.dumps({'done':[152],'attempt':3,'parked':list(range(14))}))
            before_history=history.read_bytes()
            old_units={unit:dict(ActiveState='inactive',MainPID='0',UnitFileState='enabled') for unit in installer.UNITS}
            original_read=receiver.read
            def test_read(path,owner=None,limit=2097152):return original_read(path,None,limit)
            with patch.multiple(installer,INSTALL=d/'installed',HELPER=helper,STATE=state,POLICY=policy,LIVE_HELPER=live_hash,HANDOFF=handoff), \
                 patch.object(installer,'trusted_tree'),patch.object(installer,'units',return_value=old_units), \
                 patch.object(installer.os,'geteuid',return_value=0),patch.object(installer.os,'chown'), \
                 patch.object(installer,'read',side_effect=test_read), \
                 patch.object(installer,'safe_state',side_effect=lambda slot,*_:slot+'-actual-hash'), \
                 patch.object(installer,'journal',return_value={'pending':None}),patch.object(installer,'units_quiet'), \
                 patch.object(installer.subprocess,'run') as calls:
                installer.prepare(bundle,installer.sha(manifest),True)
                self.assertEqual(json.loads(policy.read_text())['mode'],'disabled')
                calls.assert_not_called()
                codex={'slot1':sys.executable,'slot2':sys.executable}
                proof=d/'proof.json';proof.write_text(json.dumps(dict(schema='GB_ACTIONS_TRAIN_PROOF_V1',manifest=installer.sha(manifest),
                    controller_sha=HEAD,stage_workflow_sha256='a'*64,handoff_sha256=installer.sha(handoff),probe_run=123,reviewed=True,codex=codex)))
                installer.activate(HEAD,proof,codex,True)
                self.assertEqual(json.loads(policy.read_text())['mode'],'active')
                installer.rollback(True)
                self.assertEqual(installer.sha(helper),live_hash)
                self.assertEqual(history.read_bytes(),before_history)
                self.assertEqual(json.loads(policy.read_text())['mode'],'disabled')
                commands=[c.args[0][1] for c in calls.call_args_list]
                self.assertEqual(commands,['disable']*3+['enable']*3)
                self.assertFalse((d/'installed/receiver.py').exists())

if __name__=='__main__':unittest.main()

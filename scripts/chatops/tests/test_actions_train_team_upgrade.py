"""Future team installer functions: isolated files only, no runtime/provider/CI."""
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from test_actions_train import ROOT, core, A, S, TASK

spec=importlib.util.spec_from_file_location('team_upgrade_test',ROOT/'scripts/chatops/ops/team_runtime_upgrade.py')
U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U)

def proof():
    task=dict(TASK,work_kind='implementation',risk='complex',qa_routes=['agy:claude-sonnet-5-5-high','codex:gpt-6.1-sol:high'],
              author_routes=['cursor:auto','codex:gpt-6.1-sol:high'],
              failure_diagnosis=dict(schema='GB_FAILURE_DIAGNOSIS_218_V1',
                                    route='codex:gpt-6-astra:high',max_calls=3))
    return dict(schema='GB_TEAM_RUNTIME_218_PROOF_V1',reviewed=True,baseline_controller='a'*40,
        baseline_record_sha256='1'*64,controller='b'*40,manifest_sha256='2'*64,
        stage_workflow_sha256='3'*64,dispatch_workflow_sha256='4'*64,
        changes={'/reviewed/target':dict(before=None,after='5'*64)},
        agy_marker_sha256='6'*64,cursor_marker_sha256='7'*64,
        agy_operation='8'*64,agy_operation_sha256='9'*64,
        task=task,task_sha256=core.digest(task),admission_comment=dict(id=123,fingerprint='c'*64))

class Authority(unittest.TestCase):
    def test_requires_exact_future_baseline_review_hashes_and_finite_task(self):
        p=proof();U.validate_proof(p,'a'*40)
        for fields in (dict(reviewed=False),dict(baseline_controller='f'*40),
                       dict(manifest_sha256='main'),dict(unknown=True)):
            with self.assertRaises(core.Refused):U.validate_proof(p|fields,'a'*40)
        for n in (0,True,4):
            p=proof();p['task']['failure_diagnosis']['max_calls']=n;p['task_sha256']=core.digest(p['task'])
            with self.assertRaises(core.Refused):U.validate_proof(p,'a'*40)
    def test_new230_comment_is_mandatory_immutable_unique_and_unspent(self):
        p=proof();stamp=dt.datetime.now(dt.timezone.utc).isoformat()
        c=dict(id=123,user={'id':318610566},body=A.MARKER+'\n'+json.dumps(p['task']),
            created_at=stamp,updated_at=stamp,
            issue_url='https://api.github.com/repos/anpavel84-afk/gobadminton-clean/issues/230')
        p['admission_comment']['fingerprint']=A.comment_fingerprint(c)
        api=Mock(return_value=dict(number=230,user={'id':318610566},state='open',body='inert product record'))
        api.pages.return_value=[c]
        with tempfile.TemporaryDirectory() as t,patch.object(U,'STATE',Path(t)), \
             patch.object(U.r,'live',return_value=(A,S)), \
             patch.object(U.r,'checkpoint',return_value=({'done':[],'active':None},[])), \
             patch.object(U.r,'journal',return_value={'operations':{},'deferred':[]}):
            U.admission(api,p)
            api.pages.return_value=[]
            with self.assertRaises(core.Refused):U.admission(api,p)
            api.pages.return_value=[c,c]
            with self.assertRaises(core.Refused):U.admission(api,p)
            api.pages.return_value=[c|dict(updated_at='edited')]
            with self.assertRaises(core.Refused):U.admission(api,p)
            api.pages.return_value=[c]
            with patch.object(U.r,'journal',return_value={'operations':{'spent':{'binding':{'issue':230}}}}):
                with self.assertRaises(core.Refused):U.admission(api,p)
            with self.assertRaises(core.Refused):U.admission(None,p)
    def test_accepted_agy_receipt_preserved_and_only_new_cursor_hash_rebound(self):
        p=proof();q=dict(head='d'*40,base='e'*40,task_sha256='f'*64)
        accepted=dict(operation=p['agy_operation'],run=123,source_sha=q['head'],task_sha256=q['task_sha256'])
        agy=dict(schema='GB_ANTIGRAVITY_QA_29_V1',phase='ready',slot='slot2',executor_uid=978,
                 accepted_canary=accepted,qualification=q,modules={'native_antigravity.py':'old','native_guard.py':'old'})
        cursor=dict(schema='GB_CURSOR_AUTHOR_211_V1',phase='canary',slots=['slot1','slot2'],
                    canary_task_sha256='old225',successor={'issue':225,'parent':211},
                    modules={'native_cursor.py':'old','native_guard.py':'old'})
        receipt=dict(qualification_passed=True,charged_calls=1,effective_model=U.MODELS[0],
                     source_sha=q['head'],qualification_task_sha256=q['task_sha256'])
        op=dict(run=123,finished_at=1,before='same',after='same',result=dict(status='confirmed',
            qualification_passed=True,checkpoint_changed=False,qa={'verdict':'PASS'},native_receipt=receipt))
        p['agy_operation_sha256']=core.digest(op)
        original=copy.deepcopy((agy,cursor))
        def read(path,*args):return copy.deepcopy(agy if path==U.AGY else cursor)
        def sha(path):
            return p['agy_marker_sha256'] if path==U.AGY else p['cursor_marker_sha256'] if path==U.CURSOR else 'old'
        with patch.object(U.r,'read',side_effect=read),patch.object(U.i,'sha',side_effect=sha), \
             patch.object(U.r,'journal',return_value={'operations':{p['agy_operation']:op}}), \
             patch('antigravity_qa_recovery.acceptance_match',return_value=True):
            changed=U.markers(p,{n:'new-'+n for n in ('native_antigravity.py','native_guard.py','native_cursor.py')})
            self.assertEqual(changed[U.AGY]['accepted_canary'],accepted)
            self.assertEqual(changed[U.AGY]['qualification'],q)
            self.assertEqual(changed[U.AGY]['admitted_models'],U.MODELS)
            self.assertEqual(changed[U.CURSOR]['canary_task_sha256'],p['task_sha256'])
            self.assertEqual(changed[U.CURSOR]['successor'],cursor['successor'])
            self.assertEqual((agy,cursor),original)
            agy['phase']='canary'
            with self.assertRaises(core.Refused):U.markers(p,{})
    def test_preserved_history_includes_all_old_journals_but_not_new_control_metadata(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);backup=root/'team-backup';backup.mkdir()
            for path in (root/'slot1.json',root/'cursor-successor-211.json',root/'agy-ready.json',
                         root/'team.json',root/'planning.json',root/'backup.json',backup/'0'):
                path.write_text('immutable')
            C=SimpleNamespace(preserved=lambda u:{'ledger':'original'})
            with patch.multiple(U,STATE=root,JOURNAL=root/'team.json',BACKUP=backup):
                saved=U.preserved(C,None)
            self.assertEqual(saved['ledger'],'original')
            self.assertIn(str(root/'cursor-successor-211.json'),saved)
            self.assertIn(str(root/'agy-ready.json'),saved)
            self.assertNotIn(str(root/'planning.json'),saved)
            self.assertNotIn(str(backup/'0'),saved)

class ExactPlanAndWatchdog(unittest.TestCase):
    def test_only_reviewed_payload_workflows_and_exact_target_hashes_can_plan(self):
        with tempfile.TemporaryDirectory(prefix='team218-plan-') as t:
            root=Path(t);state=root/'state';state.mkdir();install=root/'installed';install.mkdir()
            bundle=root/'bundle';source=bundle/'scripts/chatops/actions_train';source.mkdir(parents=True)
            watchdog=root/'watchdog';watchdog.write_text('old user script');watchdog.chmod(0o755)
            wdsource=bundle/'scripts/chatops/train_watchdog.py';wdsource.write_text('new user script')
            target=install/'core.py';target.write_text('old module');candidate=source/'core.py';candidate.write_text('new module')
            policy=dict(mode='disabled',controller_sha='a'*40,recovery={'source_sha':'a'*40})
            record={'after':{str(target):U.i.sha(target)}};(state/'backup.json').write_text(json.dumps(record))
            p=proof();p['baseline_record_sha256']=U.i.sha(state/'backup.json')
            workflows=bundle/'.github/workflows';workflows.mkdir(parents=True)
            for filename,key in [('train-stage.yml','stage_workflow_sha256'),('train-dispatch.yml','dispatch_workflow_sha256')]:
                wf=workflows/filename;wf.write_text(('ref: '+p['controller']+chr(10))*2);p[key]=U.i.sha(wf)
            p['changes']={str(target):dict(before=U.i.sha(target),after=U.i.sha(candidate)),
                          str(watchdog):dict(before=U.i.sha(watchdog),after=U.i.sha(wdsource))}
            C=SimpleNamespace(quiet=Mock())
            with patch.multiple(U,STATE=state,INSTALL=install,WATCHDOG=watchdog,WATCHDOG_BEFORE=U.i.sha(watchdog),ALLOWED={target}), \
                 patch.object(U.r,'read',side_effect=lambda path,*a:record if path==state/'backup.json' else policy), \
                 patch.object(U.r,'trusted_tree'),patch.object(U.i,'payload',return_value={target:candidate}), \
                 patch.object(U,'admission') as admission,patch.object(U,'markers',return_value={}), \
                 patch.object(U,'preserved',return_value={'ledger':'unchanged'}):
                self.assertEqual(U.plan(bundle,p,'a'*40,C,None,Mock())[5],p['changes'])
                admission.assert_called_once()
                policy['mode']='active'
                with self.assertRaisesRegex(core.Refused,'future ready baseline'):U.plan(bundle,p,'a'*40,C,None,Mock())
                admission.assert_called_once()  # Refuse before consulting the new admission.
                policy['mode']='disabled'
                changed=copy.deepcopy(p);changed['changes'][str(target)]['after']='f'*64
                with self.assertRaisesRegex(core.Refused,'target deltas'):U.plan(bundle,changed,'a'*40,C,None,Mock())
                target.write_text('foreign module')
                with self.assertRaisesRegex(core.Refused,'baseline code'):U.plan(bundle,p,'a'*40,C,None,Mock())
            self.assertEqual(watchdog.read_text(),'old user script')
    def test_existing_user_script_metadata_preserved_and_symlink_refused(self):
        with tempfile.TemporaryDirectory(prefix='team218-watchdog-') as t:
            root=Path(t);target=root/'watchdog';target.write_text('old');target.chmod(0o755)
            source=root/'new';source.write_text('new');info=target.stat()
            with patch.object(U,'WATCHDOG',target), \
                 patch.object(U,'watchdog_parent',side_effect=lambda p:os.open(root,os.O_RDONLY|os.O_DIRECTORY)):
                U.put(source,target,0o755,info.st_uid,info.st_gid)
                self.assertEqual(target.read_text(),'new')
                self.assertEqual(target.stat().st_mode&0o777,0o755)
                target.unlink();outside=root/'outside';outside.write_text('preserve')
                target.symlink_to(outside)
                with self.assertRaises(OSError):U.put(source,target,0o755,info.st_uid,info.st_gid)
                self.assertEqual(outside.read_text(),'preserve')

class Transaction(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='team218-upgrade-');self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.state=self.root/'state';self.state.mkdir()
        self.policy=self.root/'policy.json';self.journal=self.state/'team.json';self.backup=self.state/'team-backup'
        self.target=self.root/'module';self.target.write_bytes(b'old-module')
        self.source=self.root/'source';self.source.write_bytes(b'new-module')
        self.marker=self.root/'marker';self.marker.write_text('old-marker')
        self.before=dict(mode='disabled',controller_sha='a'*40,recovery={'source_sha':'a'*40})
        self.policy.write_text(json.dumps(self.before));self.record=self.state/'backup.json';self.record.write_text(json.dumps({'after':{}}))
        self.proof=proof();self.proofpath=self.root/'proof.json';self.proofpath.write_text(json.dumps(self.proof))
        self.snapshot={'207':'unknown','225':'deferred','211':'preserved','ledger':'same'}
        self.C=SimpleNamespace(quiet=Mock(),sync_directory=Mock());self.helper=SimpleNamespace(probe=Mock(return_value={'run':999}))
        self.virtual={self.marker:dict(new='marker')}
        self.changes={str(self.target):dict(before=U.i.sha(self.target),after=U.i.sha(self.source)),
                      str(self.marker):dict(before=U.i.sha(self.marker),after=hashlib.sha256(U.encoded(self.virtual[self.marker])).hexdigest())}
        self.meta={str(p):dict(mode=0o644,uid=0,gid=0) for p in (self.target,self.marker)}
        def atomic(path,value,**kw):Path(path).write_text(json.dumps(copy.deepcopy(value)))
        def read(path,*args,**kw):return json.loads(Path(path).read_text())
        def put(source,target,mode,*args,**kw):Path(target).write_bytes(Path(source).read_bytes())
        self.patches=[patch.multiple(U,STATE=self.state,JOURNAL=self.journal,BACKUP=self.backup),
            patch.object(U.r,'POLICY',self.policy),patch.object(U.os,'geteuid',return_value=0),
            patch.object(U.r,'trusted_tree'),patch.object(U.r,'atomic',side_effect=atomic),
            patch.object(U.r,'read',side_effect=read),patch.object(U,'helpers',return_value=(self.C,self.helper)),
            patch.object(U,'preserved',side_effect=lambda *args:copy.deepcopy(self.snapshot)),
            patch.object(U.i,'put',side_effect=put),patch.object(U,'put',side_effect=put),
            patch.object(U.r,'locked',side_effect=lambda *a:os.open('/dev/null',os.O_RDONLY)),
            patch.object(U,'plan',side_effect=lambda *a:(copy.deepcopy(self.before),{'after':{}}, {self.target:self.source},
                {self.target:self.source},self.virtual,self.changes,copy.deepcopy(self.meta),copy.deepcopy(self.snapshot)))]
        for p in self.patches:p.start();self.addCleanup(p.stop)
    def call(self,action,run=None):
        return U.execute(action,self.root,self.proofpath,
                         U.i.sha(self.proofpath),'a'*40,api=Mock(),run_id=run)
    def test_dry_apply_rollback_only_own_targets_and_old_marker_backup(self):
        self.assertTrue(self.call('dry')['dry']);self.assertFalse(self.journal.exists())
        self.assertEqual(self.call('apply')['phase'],'installed-disabled')
        j=json.loads(self.journal.read_text());self.assertEqual(j['preserved'],self.snapshot)
        self.assertEqual(self.target.read_bytes(),b'new-module')
        self.assertEqual(self.call('rollback')['phase'],'rolled-back-disabled')
        self.assertEqual(self.target.read_bytes(),b'old-module')
        self.assertEqual(self.marker.read_text(),'old-marker')
        self.assertEqual(self.snapshot['225'],'deferred');self.assertEqual(self.snapshot['207'],'unknown')
    def test_writeahead_precedes_backup_and_target_mutation(self):
        original=U.r.atomic
        def crash(path,value,**kwargs):
            original(path,value,**kwargs)
            if path==self.journal and value['phase']=='backing-up':raise OSError('crash')
        with patch.object(U.r,'atomic',side_effect=crash):
            with self.assertRaises(OSError):self.call('apply')
        self.assertEqual(self.target.read_bytes(),b'old-module')
        self.assertEqual(self.call('rollback')['phase'],'rolled-back-disabled')
    def test_active_policy_cannot_run_disabled_shadow(self):
        self.call('apply')
        policy=json.loads(self.policy.read_text());policy['mode']='active'
        self.policy.write_text(json.dumps(policy))
        with self.assertRaisesRegex(core.Refused,'wrong disabled team policy'):self.call('activate',999)
        self.helper.probe.assert_not_called()
        self.assertEqual(json.loads(self.journal.read_text())['phase'],'installed-disabled')
    def test_activation_resume_does_not_rewind_new_live_progress(self):
        self.call('apply');original=U.r.atomic
        def crash(path,value,**kwargs):
            original(path,value,**kwargs)
            if path==self.policy and value['mode']=='active':raise OSError('after-effect crash')
        with patch.object(U.r,'atomic',side_effect=crash):
            with self.assertRaises(OSError):self.call('activate',999)
        self.snapshot['new-progress']='never-rewind'
        with patch.object(U.r,'publish_monitor'):
            self.assertEqual(self.call('activate',999)['phase'],'active')
        self.helper.probe.assert_called_once()
        with self.assertRaises(core.Refused):self.call('rollback')
    def test_foreign_drift_or_changed_history_blocks_rollback(self):
        self.call('apply');self.target.write_text('unrelated change')
        with self.assertRaises(core.Refused):self.call('rollback')
        self.target.write_bytes(b'new-module');self.snapshot['ledger']='changed'
        with self.assertRaises(core.Refused):self.call('rollback')

if __name__=='__main__':unittest.main()

"""Fixed two-file OPS upgrade: journal before backup, disabled interruption, no rewind."""
import copy,hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock,patch
from test_actions_train import ROOT,receiver,installer,core
from test_actions_train_budget_prefail import fixture
import qa_recovery as q
spec=importlib.util.spec_from_file_location('prefail_upgrade',ROOT/'scripts/chatops/ops/budget_preflight_upgrade.py')
U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U)
class Upgrade(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory();self.root=Path(self.t.name);self.state=self.root/'state';self.state.mkdir()
        self.bundle=self.root/'bundle';self.bundle.mkdir();self.install=self.root/'install';self.install.mkdir()
        self.policy=self.state/'policy.json';self.oldpolicy={'mode':'active','controller_sha':U.OLD,'recovery':{'source_sha':U.OLD}}
        self.policy.write_text(json.dumps(self.oldpolicy));self.journal=self.state/'budget-preflight-211.json';self.backup=self.state/'backup'
        self.budget=self.state/'budget.json';self.budget.write_text(json.dumps({'schema':1,'providers':{'codex':{'qa':'unlimited'}},'slots':{s:{'codex':{'qa':'unlimited'}} for s in ('slot1','slot2')}}))
        self.items={};self.old={}
        for name in ('receiver.py','qa_recovery.py'):
            target=self.install/name;target.write_text('before '+name);source=self.bundle/name;source.write_text('after '+name)
            self.items[target]=source;self.old[target]=target.read_bytes()
        (self.state/'backup.json').write_text(json.dumps({'manifest':'old','after':{str(p):installer.sha(p) for p in self.items}}))
        self.record=(self.state/'backup.json').read_bytes();self.authority=self.state/'slot1.json';self.authority.write_text('{"attempt":3,"history":"preserve"}')
        (self.state/'cost-policy-211.json').write_text('{"phase":"active"}')
        self.controller='a'*40;wf=self.bundle/'.github/workflows';wf.mkdir(parents=True)
        for name in ('train-stage.yml','train-dispatch.yml'):(wf/name).write_text(('ref: '+self.controller+'\n')*2)
        self.stagehash=installer.sha(wf/'train-stage.yml');self.dispatchhash=installer.sha(wf/'train-dispatch.yml')
        self.checkpoint,self.j,_,_=fixture()
        self.u=SimpleNamespace(BUDGET=self.budget,quiet=Mock(),preserved=lambda:{str(self.authority):installer.sha(self.authority)},probe=Mock(return_value={'run':123}))
        def read(path,*args):return json.loads(Path(path).read_text())
        def put(source,target,mode):
            self.assertTrue(self.journal.exists(),'write-ahead journal before even first backup')
            self.assertEqual(read(self.policy)['mode'],'disabled')
            Path(target).parent.mkdir(parents=True,exist_ok=True);Path(target).write_bytes(Path(source).read_bytes())
        self.put=put
        self.patches=[patch.object(U,'STATE',self.state),patch.object(U,'JOURNAL',self.journal),patch.object(U,'BACKUP',self.backup),patch.object(U,'TARGETS',set(self.items)),patch.object(U,'UNLIMITED',installer.sha(self.budget)),patch.object(U.os,'geteuid',return_value=0),
            patch.object(U,'load',side_effect=lambda name,path:self.u if name=='_reviewed_cost_upgrade' else q),
            patch.object(receiver,'POLICY',self.policy),patch.object(receiver,'read',side_effect=read),patch.object(receiver,'trusted_tree'),patch.object(receiver,'alive',return_value=False),patch.object(receiver,'journal',return_value=self.j),patch.object(receiver,'checkpoint',return_value=(self.checkpoint,[])),patch.object(receiver,'publish_monitor'),patch.object(installer,'payload',return_value=self.items),patch.object(installer,'put',side_effect=put)]
        for p in self.patches:p.start()
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.t.cleanup()
    def call(self,action):return U.execute(action,self.bundle,'reviewed',self.controller,self.stagehash,self.dispatchhash,123)
    def test_dry_apply_rollback_preserve_task_and_budget_history(self):
        before={str(p):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertTrue(self.call('dry')['dry']);self.assertEqual(before,{str(p):p.read_bytes() for p in self.root.rglob('*') if p.is_file()})
        self.assertEqual(self.call('apply')['phase'],'installed-disabled');self.assertEqual(self.authority.read_bytes(),before[str(self.authority)])
        self.assertEqual(self.call('rollback')['phase'],'rolled-back')
        for p,raw in self.old.items():self.assertEqual(p.read_bytes(),raw)
        self.assertEqual(json.loads((self.state/'backup.json').read_bytes()),json.loads(self.record))
    def test_interrupted_first_backup_is_disabled_and_can_rollback_without_rewinding(self):
        with patch.object(installer,'put',side_effect=RuntimeError('interruption before first backup')):
            with self.assertRaises(RuntimeError):self.call('apply')
        self.assertEqual(json.loads(self.policy.read_text())['mode'],'disabled')
        self.assertEqual(json.loads(self.journal.read_text())['phase'],'backing-up')
        self.assertEqual(self.call('rollback')['phase'],'rolled-back')
    def test_interrupted_code_replacement_rolls_back_only_reviewed_code(self):
        count=[0]
        def stopped(source,target,mode):
            if Path(target) in self.items:
                count[0]+=1
                if count[0]==2:raise RuntimeError('interrupted replacement')
            self.put(source,target,mode)
        with patch.object(installer,'put',side_effect=stopped):
            with self.assertRaises(RuntimeError):self.call('apply')
        self.call('rollback')
        for p,raw in self.old.items():self.assertEqual(p.read_bytes(),raw)
    def test_no_rollback_after_activation_and_no_state_rewind(self):
        self.call('apply');self.assertEqual(self.call('activate')['phase'],'active')
        with self.assertRaises(core.Refused):self.call('rollback')
    def test_drift_never_overwrites_real_checkpoint(self):
        self.call('apply');self.authority.write_text('{"actual":"new state"}')
        for action in ('activate','rollback'):
            with self.assertRaises(core.Refused):self.call(action)
        self.assertEqual(self.authority.read_text(),'{"actual":"new state"}')
if __name__=='__main__':unittest.main()

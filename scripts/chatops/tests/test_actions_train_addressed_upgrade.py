"""Reviewed helper transaction simulations: no installation or external effects."""
import copy
import hashlib
import importlib.util
import json
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch
from test_actions_train import ROOT,core
from test_actions_train_addressed_analysis import grant
import antigravity_qa_recovery as Q

spec=importlib.util.spec_from_file_location('addressed_upgrade_tests',ROOT/'scripts/chatops/ops/antigravity_addressed_upgrade.py')
U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U);U.Q=Q


def proof():
    return dict(schema='GB_AGY_29_ADDRESSED_UPGRADE_V1',owner_comment=6362661117,
        baseline_controller=Q.INSTALLED_BASELINE,baseline_record_sha256='a'*64,controller='c'*40,
        release_revision='d'*40,manifest_sha256='b'*64,stage_workflow_sha256='c'*64,
        dispatch_workflow_sha256='d'*64,team_helper_sha256='e'*64,
        changes={str(U.MARKER):dict(before='e'*64,after='f'*64)},
        history={n:'f'*64 for n in ('slot2.json',Q.LINEAGE,Q.GRANT_LEDGER,
                                  'antigravity-qa-one-shot-'+Q.THIRD_TASK+'.json')},grant=grant())


class Protocol(unittest.TestCase):
    def test_closed_proof_b51_only_exact_targets_and_hashes(self):
        p=proof();U.validate(p)
        for change in (dict(owner_comment=True),dict(baseline_controller='a'*40),dict(extra=True),
                       dict(manifest_sha256='dev'),dict(controller=Q.INSTALLED_BASELINE),
                       dict(changes={'/root/arbitrary':dict(before=None,after='f'*64)}),dict(history={})):
            with self.subTest(change=change),self.assertRaises(core.Refused):U.validate(p|change)
        for text in ('{}{}','{"schema":1,"schema":2}','{"schema":1} trailing'):
            with self.assertRaises((core.Refused,ValueError)):core.loads(text)
    def test_bootstrap_rejects_foreign_authority_before_import_or_payload(self):
        with patch.object(U.i,'payload') as payload:
            with self.assertRaises(core.Refused):U.load_reviewed(ROOT,proof()|dict(owner_comment=123))
            payload.assert_not_called()
    def test_analysis_is_not_qa_readiness(self):
        p=proof();q=U.descriptor(p['grant'])
        C=SimpleNamespace(quiet=Mock())
        with patch.object(U.r,'read',return_value={'qualification':q}),self.assertRaises(core.Refused):
            U.accept(p,dict(controller=p['controller'],changes={}),dict(mode='disabled',controller_sha=p['controller']),C,None)


class Transaction(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.state=self.root/'state';self.state.mkdir()
        self.jp=self.state/'upgrade';self.backup=self.state/'backup';self.policy=self.root/'policy'
        self.target=self.root/'native';self.source=self.root/'source';self.marker=self.root/'marker'
        self.target.write_text('old');self.source.write_text('new');self.marker.write_text('historical-marker')
        self.ledger=self.state/'addressed-ledger';self.before=dict(mode='disabled',controller_sha=Q.INSTALLED_BASELINE,
            recovery={'source_sha':Q.INSTALLED_BASELINE})
        self.policy.write_text(json.dumps(self.before));(self.state/'backup.json').write_text(json.dumps({'after':{}}))
        self.p=proof();self.pp=self.root/'proof';self.pp.write_text(json.dumps(self.p))
        self.virtual={self.marker:dict(phase='canary'),self.ledger:dict(used_calls=0)}
        self.changes={str(self.target):dict(before=U.i.sha(self.target),after=U.i.sha(self.source)),
            **{str(t):dict(before=U.i.sha(t),after=hashlib.sha256(U.encoded(v)).hexdigest()) for t,v in self.virtual.items()}}
        self.snapshot={'old2/2':'unchanged','old1/1':'unchanged','fac7':'unknown'}
        self.C=SimpleNamespace(quiet=Mock(),sync_directory=Mock())
        self.u=SimpleNamespace(probe=Mock(return_value={'run':7}))
        self.T=SimpleNamespace(helpers=lambda b:(self.C,self.u))
        def read(p,*a,**kw):return json.loads(Path(p).read_text())
        def atomic(p,v,**kw):Path(p).write_text(json.dumps(copy.deepcopy(v)))
        def put(s,t,*a):Path(t).write_bytes(Path(s).read_bytes())
        self.patches=[patch.multiple(U,STATE=self.state,JOURNAL=self.jp,BACKUP=self.backup,MARKER=self.marker,LEDGER=self.ledger),
            patch.object(U.r,'POLICY',self.policy),patch.object(U.os,'geteuid',return_value=0),
            patch.object(U.r,'trusted_tree'),patch.object(U.r,'read',side_effect=read),patch.object(U.r,'atomic',side_effect=atomic),
            patch.object(U.r,'locked',side_effect=lambda *a:os.open('/dev/null',os.O_RDONLY)),
            patch.object(U,'team',return_value=self.T),patch.object(U,'load_reviewed'),patch.object(U,'validate'),
            patch.object(U,'preserved',side_effect=lambda *a:copy.deepcopy(self.snapshot)),patch.object(U.i,'put',side_effect=put),
            patch.object(U,'plan',side_effect=lambda *a:(copy.deepcopy(self.before),{'after':{}},
                {self.target:self.source},{self.target:self.source},self.virtual,self.changes,copy.deepcopy(self.snapshot)))]
        for p in self.patches:p.start();self.addCleanup(p.stop)
    def call(self,action):return U.execute(action,self.root,self.pp,U.i.sha(self.pp),run_id=7)
    def test_dry_apply_disabled_and_rollback_restore_only_targets(self):
        self.assertTrue(self.call('dry')['dry']);self.assertFalse(self.jp.exists())
        self.assertEqual(self.call('apply')['phase'],'installed-disabled')
        self.assertEqual(json.loads(self.policy.read_text())['mode'],'disabled')
        self.assertEqual(self.target.read_text(),'new')
        self.assertEqual(self.call('rollback')['phase'],'rolled-back-disabled')
        self.assertEqual(self.target.read_text(),'old');self.assertFalse(self.ledger.exists())
        self.assertEqual(self.marker.read_text(),'historical-marker')
        self.assertEqual(self.snapshot['fac7'],'unknown')
    def test_intent_precedes_targets_and_backup_failure_is_reversible(self):
        def fail(s,t,*a):
            self.assertEqual(json.loads(self.jp.read_text())['phase'],'backing-up')
            self.assertEqual(self.target.read_text(),'old');raise OSError('backup unavailable')
        with patch.object(U.i,'put',side_effect=fail),self.assertRaises(OSError):self.call('apply')
        self.assertEqual(self.call('rollback')['phase'],'rolled-back-disabled')
    def test_disabled_shadow_then_activation_no_false_qa_ready_and_no_rollback_after_call(self):
        self.call('apply');out=self.call('activate');self.assertFalse(out['qa_ready'])
        self.u.probe.assert_called_once()
        self.assertEqual(json.loads(self.policy.read_text())['mode'],'active')
        self.assertEqual(self.call('activate')['phase'],'active-canary')
        self.u.probe.assert_called_once()
        with self.assertRaises(core.Refused):self.call('rollback')
    def test_foreign_target_or_history_drift_blocks_rollback(self):
        self.call('apply');self.target.write_text('foreign')
        with self.assertRaises(core.Refused):self.call('rollback')
        self.target.write_text('new');self.snapshot['fac7']='changed'
        with self.assertRaises(core.Refused):self.call('rollback')

class RoleTransition(unittest.TestCase):
    def test_new_role_same_sha_gets_new_generation_preserves_previous_operation_and_budget(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);mp=root/'marker';lp=root/'ledger';sp=root/'slot2.json';pp=root/'policy'
            g=grant();qa=g|dict(role='independent_qa',input_path='scripts/chatops/tests/fixtures/agy-reviewed-tests.json',input_sha256='f'*64)
            slot=dict(generation=88,pending=None,operations={'old':{'result':{'analysis_complete':True,'qualification_passed':False}}})
            oldmarker=dict(phase='canary',qualification=U.descriptor(g))
            ledger=dict(schema=Q.ADDRESSED_SCHEMA,lineage=Q.ADDRESSED_LINEAGE,ceiling=4,used_calls=1,
                grants={core.digest(g):dict(grant=g,operation='1'*64)})
            for path,value in ((mp,oldmarker),(lp,ledger),(sp,slot),(pp,dict(mode='disabled',controller_sha=g['controller_revision']))):
                path.write_text(json.dumps(value,sort_keys=True))
            newledger=copy.deepcopy(ledger);newledger['grants'][core.digest(qa)]=dict(grant=qa,operation=None)
            q=U.descriptor(qa);newmarker=dict(oldmarker,phase='canary',qualification=q,canary_task_sha256=q['task_sha256'])
            newslot=dict(slot,generation=89)
            p=proof();p['grant']=qa;p['changes']={str(t):dict(before=U.i.sha(t),after=hashlib.sha256(U.encoded(v)).hexdigest())
                for t,v in ((mp,newmarker),(lp,newledger),(sp,newslot))}
            written=[]
            def atomic(path,value,**kw):written.append(path);path.write_text(json.dumps(value,sort_keys=True))
            def read(path,*a):return json.loads(path.read_text())
            with patch.multiple(U,STATE=root,MARKER=mp,LEDGER=lp),patch.object(U.r,'POLICY',pp), \
                 patch.object(U.r,'read',side_effect=read),patch.object(U.r,'journal',side_effect=lambda s:read(sp)), \
                 patch.object(U.r,'atomic',side_effect=atomic),patch.object(U,'history'), \
                 patch.object(Q,'addressed_input',return_value='exact QA test contract'), \
                 patch.object(U,'preserved',side_effect=lambda *a:{str(sp):U.i.sha(sp)}):
                out=U.admit(p,dict(controller=g['controller_revision'],changes={}),SimpleNamespace(quiet=Mock()),None)
                self.assertEqual(out['phase'],'admitted-disabled')
                self.assertEqual(read(sp)['generation'],89);self.assertEqual(read(sp)['operations'],slot['operations'])
                self.assertEqual(read(lp)['used_calls'],1);self.assertEqual(read(lp)['grants'][core.digest(g)],ledger['grants'][core.digest(g)])
                count=len(written)
                self.assertEqual(U.admit(p,dict(controller=g['controller_revision'],changes={}),SimpleNamespace(quiet=Mock()),None)['phase'],'already-admitted')
                self.assertEqual(len(written),count)

class Bootstrap(unittest.TestCase):
    def test_corrected_helper_bootstraps_without_installed_addressed_adapter(self):
        import subprocess
        script=r'''
import sys,json,hashlib,importlib.util,types
from pathlib import Path
root=Path(sys.argv[1]);sys.path.insert(0,str(root/'scripts/chatops/actions_train'))
import receiver
receiver.trusted_tree=lambda p:None  # Test metadata only; real payload hashes still checked.
sys.modules['antigravity_qa_recovery']=types.ModuleType('old_b51_module_without_addressed_support')
spec=importlib.util.spec_from_file_location('bootstrap_helper',root/'scripts/chatops/ops/antigravity_addressed_upgrade.py')
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
p={k:None for k in u.KEYS}
p.update(schema='GB_AGY_29_ADDRESSED_UPGRADE_V1',owner_comment=6362661117,
    baseline_controller='b51e7c1c18103247606d35a414c82b04f5dd53ee',
    manifest_sha256=hashlib.sha256((root/'scripts/chatops/actions_train/manifest.json').read_bytes()).hexdigest())
u.load_reviewed(root,p)
assert u.Q.ADDRESSED_SCHEMA=='GB_AGY_29_ADDRESSED_CALL_V1'
assert u.Q.reconcile_addressed
assert sys.modules['native_antigravity'].analysis_canonical
print('hash-verified addressed bootstrap from simulated b51: OK')
'''
        result=subprocess.run(['/usr/bin/python3','-I','-B','-c',script,str(ROOT)],capture_output=True,text=True,timeout=30)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('bootstrap from simulated b51: OK',result.stdout)

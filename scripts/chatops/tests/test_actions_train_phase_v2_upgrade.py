"""Synthetic root-only V2 upgrade tests. Never touch the real policy, services or VPS state."""
from contextlib import ExitStack
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

from test_actions_train import installer, receiver

FILE=pathlib.Path(__file__).resolve().parents[1]/'ops/phase_v2_upgrade.py'
spec=importlib.util.spec_from_file_location('gb_phase_v2_upgrade',FILE)
V=importlib.util.module_from_spec(spec)
spec.loader.exec_module(V)


class OneShotStageUpgrade(unittest.TestCase):
    def fixture(self,root):
        install=root/'install';install.mkdir()
        state=root/'state';state.mkdir()
        (state/'controller.lock').write_text('lock')
        policy_file=root/'policy.json'
        oldpolicy=dict(mode='disabled',controller_sha=V.PRIOR_CONTROLLER,
                       stage_workflow_sha256='3'*64,
                       recovery=dict(source_sha=V.PRIOR_CONTROLLER))
        policy_file.write_text(json.dumps(oldpolicy))
        record=dict(manifest='old',after={})
        oldfiles={}
        newfiles={}
        for suffix in V.FILES:
            target=install/suffix
            target.parent.mkdir(exist_ok=True,parents=True)
            target.write_bytes(('OLD-'+suffix).encode())
            fresh=root/('new-'+suffix.replace('/','-'))
            fresh.write_bytes(('NEW-'+suffix).encode())
            record['after'][str(target)]=installer.sha(target)
            oldfiles[suffix]=installer.sha(target)
            newfiles[suffix]=installer.sha(fresh)
        (state/'backup.json').write_text(json.dumps(record))
        (state/'hotfix-191.json').write_text(json.dumps({'phase':'installed-disabled'}))
        newpol=copy.deepcopy(oldpolicy)
        newpol.update(controller_sha='f'*40,stage_workflow_sha256='a'*64)
        newpol['recovery']['source_sha']='f'*40
        nrecord=copy.deepcopy(record);nrecord['manifest']='new'
        for suffix in V.FILES:
            nrecord['after'][str(install/suffix)]=newfiles[suffix]
        payload={}
        for suffix in V.FILES:
            payload[install/suffix]=root/('new-'+suffix.replace('/','-'))
        return (state,install,policy_file,oldpolicy,record,newpol,nrecord,
                oldfiles,newfiles,payload)

    def test_exact_five_file_constraint(self):
        self.assertEqual(set(V.FILES),{
            'client.py','core.py','stage.py','live/slots.py',
            'live/autonomous_issues.py'})
        self.assertEqual(V.PRIOR_CONTROLLER,'6b24848520ba01f66d764917a577aa1d2d189a45')

    def test_install_remains_disabled_then_explicit_probe_activates(self):
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t)
            (state,install,policy,oldpolicy,record,newpolicy,newrecord,old,new,payload)=self.fixture(root)
            def put(source,target,mode):
                path=pathlib.Path(target)
                path.parent.mkdir(parents=True,exist_ok=True)
                path.write_bytes(pathlib.Path(source).read_bytes())
            def atomic(path,document,mode=0o600):
                pathlib.Path(path).write_text(json.dumps(document))
            def read(path,owner=0):
                return json.loads(pathlib.Path(path).read_text())
            new_map={suffix:(old[suffix],new[suffix]) for suffix in V.FILES}
            with ExitStack() as stack:
                patches=[
                    patch.object(V,'STATE',state),patch.object(V,'INSTALL',install),
                    patch.object(V,'POLICY',policy),patch.object(V,'JOURNAL',state/'hotfix-phase-v2.json'),
                    patch.object(V,'BACKUP',state/'hotfix-phase-v2-backup'),patch.object(V,'FILES',new_map),
                    patch.object(V,'quiet'),patch.object(V.receiver,'trusted_tree'),
                    patch.object(V,'state_hashes',return_value={'protected-ledger':'sha'}),
                    patch.object(V.installer,'put',side_effect=put),
                    patch.object(V.receiver,'atomic',side_effect=atomic),
                    patch.object(V.receiver,'read',side_effect=read),
                    patch.object(V,'plan',return_value=(
                        oldpolicy,record,newpolicy,newrecord,payload)),
                ]
                for item in patches:stack.enter_context(item)
                report=V.transaction('dry',root,'new','f'*40,'a'*64)
                self.assertEqual(report['status'],'DRY_PASS')
                self.assertFalse((state/'hotfix-phase-v2.json').exists())
                report=V.transaction('apply',root,'new','f'*40,'a'*64)
                self.assertEqual(report['status'],'INSTALLED_DISABLED')
                self.assertEqual(read(policy)['mode'],'disabled')
                self.assertEqual(read(state/'hotfix-phase-v2.json')['phase'],'installed-disabled')
                self.assertEqual(read(state/'backup.json')['after'],newrecord['after'])
                for suffix in new:
                    self.assertEqual(installer.sha(install/suffix),new[suffix])
                active=V.transaction('activate',probe=123)
                self.assertEqual(active['status'],'ACTIVE')
                self.assertEqual(read(policy)['mode'],'active')
                with self.assertRaises(receiver.Refused):
                    V.transaction('rollback')

    def test_interrupted_partial_install_keeps_disabled_and_rollback(self):
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t)
            (state,install,policy,oldpolicy,record,newpolicy,newrecord,old,new,payload)=self.fixture(root)
            def read(path,owner=0):
                return json.loads(pathlib.Path(path).read_text())
            def atomic(path,doc,mode=0o600):
                pathlib.Path(path).write_text(json.dumps(doc))
            n=[0]
            def put(source,target,mode):
                dest=pathlib.Path(target)
                dest.parent.mkdir(parents=True,exist_ok=True)
                dest.write_bytes(pathlib.Path(source).read_bytes())
                if dest.is_relative_to(install):
                    n[0]+=1
                    if n[0]==3: raise RuntimeError('synthetic interruption')
            new_map={suffix:(old[suffix],new[suffix]) for suffix in V.FILES}
            with ExitStack() as stack:
                patches=[
                    patch.object(V,'STATE',state),patch.object(V,'INSTALL',install),
                    patch.object(V,'POLICY',policy),patch.object(V,'JOURNAL',state/'hotfix-phase-v2.json'),
                    patch.object(V,'BACKUP',state/'hotfix-phase-v2-backup'),patch.object(V,'FILES',new_map),
                    patch.object(V,'quiet'),patch.object(V.receiver,'trusted_tree'),
                    patch.object(V,'state_hashes',return_value={'protected-ledger':'sha'}),
                    patch.object(V.installer,'put',side_effect=put),
                    patch.object(V.receiver,'atomic',side_effect=atomic),
                    patch.object(V.receiver,'read',side_effect=read),
                    patch.object(V,'plan',return_value=(
                        oldpolicy,record,newpolicy,newrecord,payload)),
                ]
                for item in patches:stack.enter_context(item)
                with self.assertRaisesRegex(RuntimeError,'interruption'):
                    V.transaction('apply',root,'new','f'*40,'a'*64)
                self.assertEqual(read(policy)['mode'],'disabled')
                self.assertEqual(read(state/'hotfix-phase-v2.json')['phase'],'installing')
                self.assertEqual(V.transaction('rollback')['status'],'ROLLED_BACK_DISABLED')
                self.assertEqual(read(state/'backup.json'),record)
                self.assertEqual(read(policy)['controller_sha'],V.PRIOR_CONTROLLER)
                self.assertEqual(read(policy)['mode'],'disabled')
                for suffix in old:self.assertEqual(installer.sha(install/suffix),old[suffix])


    def test_interrupted_activation_proof_is_recovered_without_a_second_effect(self):
        for fault in ('before_active_policy','before_final_journal'):
            with self.subTest(fault=fault),tempfile.TemporaryDirectory() as t:
                root=pathlib.Path(t)
                (state,install,policy,oldpolicy,record,newpolicy,newrecord,
                 old,new,payload)=self.fixture(root)
                failure={'armed':True}
                def put(source,target,mode):
                    p=pathlib.Path(target);p.parent.mkdir(parents=True,exist_ok=True)
                    p.write_bytes(pathlib.Path(source).read_bytes())
                def atomic(path,value,mode=0o600):
                    p=pathlib.Path(path)
                    if (failure['armed'] and fault=='before_active_policy'
                        and p==policy and value.get('mode')=='active'):
                        failure['armed']=False
                        raise RuntimeError('synthetic policy activation failure')
                    if (failure['armed'] and fault=='before_final_journal'
                        and p==state/'hotfix-phase-v2.json'
                        and value.get('phase')=='active'):
                        failure['armed']=False
                        raise RuntimeError('synthetic final journal failure')
                    p.write_text(json.dumps(value))
                def read(path,owner=0):
                    return json.loads(pathlib.Path(path).read_text())
                new_map={name:(old[name],new[name]) for name in V.FILES}
                with ExitStack() as stack:
                    patches=[
                        patch.object(V,'STATE',state),patch.object(V,'INSTALL',install),
                        patch.object(V,'POLICY',policy),
                        patch.object(V,'JOURNAL',state/'hotfix-phase-v2.json'),
                        patch.object(V,'BACKUP',state/'hotfix-phase-v2-backup'),
                        patch.object(V,'FILES',new_map),patch.object(V,'quiet'),
                        patch.object(V.receiver,'trusted_tree'),
                        patch.object(V,'state_hashes',
                                     return_value={'protected-ledger':'sha'}),
                        patch.object(V.installer,'put',side_effect=put),
                        patch.object(V.receiver,'atomic',side_effect=atomic),
                        patch.object(V.receiver,'read',side_effect=read),
                        patch.object(V,'plan',
                            return_value=(oldpolicy,record,newpolicy,newrecord,payload)),
                    ]
                    for entry in patches:stack.enter_context(entry)
                    self.assertEqual(V.transaction('apply',root,'new','f'*40,'a'*64)['status'],
                                     'INSTALLED_DISABLED')
                    with self.assertRaisesRegex(RuntimeError,'synthetic'):
                        V.transaction('activate',probe=321)
                    self.assertEqual(read(state/'hotfix-phase-v2.json')['phase'],'activating')
                    current=read(policy)['mode']
                    self.assertEqual(current,'disabled' if fault=='before_active_policy'
                                     else 'active')
                    with self.assertRaises(receiver.Refused):
                        V.transaction('activate',probe=322) # proof mismatch cannot finalize
                    complete=V.transaction('activate',probe=321)
                    self.assertEqual(complete['status'],'ACTIVE')
                    self.assertEqual(read(policy)['mode'],'active')
                    self.assertEqual(read(state/'hotfix-phase-v2.json')['phase'],'active')
                    self.assertEqual(read(state/'hotfix-phase-v2.json')['shadow_run'],321)
                    with self.assertRaises(receiver.Refused):
                        V.transaction('rollback')


if __name__=='__main__':unittest.main()

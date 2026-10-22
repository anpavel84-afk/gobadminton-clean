"""Pure synthetic tests for fail-closed, two-phase root hotfix #191. No external effects."""
import copy
from contextlib import ExitStack
import hashlib
import importlib.util
import json
import pathlib
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from test_actions_train import receiver, installer

FILE = pathlib.Path(__file__).resolve().parents[1]/'ops/recovery_hotfix_191.py'
spec = importlib.util.spec_from_file_location('recovery_hotfix_191', FILE)
H = importlib.util.module_from_spec(spec)
spec.loader.exec_module(H)

def sha(p):
    p=pathlib.Path(p)
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None

class Hotfix191(unittest.TestCase):
    def test_closed_explicit_actions_and_old_controller_identity(self):
        self.assertEqual(H.OLD_CONTROLLER,'ba02b9d9f9d56c7b07379da22d128c3dfa7341e1')
        self.assertEqual(set(H.OLD),set(H.NEW))
        self.assertEqual(len(H.OLD),2)
        self.assertIn("callbacks_drained()",FILE.read_text())
        self.assertIn("receiver.atomic(POLICY,before|{'mode':'disabled'}",FILE.read_text())
        self.assertIn("phase='draining'",FILE.read_text())
        self.assertIn("phase='installing'",FILE.read_text())

    def fixture(self,tmp):
        root=pathlib.Path(tmp)
        state=root/'state';state.mkdir()
        install=root/'install';install.mkdir()
        oldrec,oldrecv=install/'recovery.py',install/'receiver.py'
        oldrec.write_bytes(b'OLD-REC');oldrecv.write_bytes(b'OLD-RCV')
        newrec,newrecv=root/'new-recovery.py',root/'new-receiver.py'
        newrec.write_bytes(b'NEW-REC');newrecv.write_bytes(b'NEW-RCV')
        backup={'manifest':'old-manifest','after':{str(oldrec):sha(oldrec),str(oldrecv):sha(oldrecv)}}
        policy=dict(mode='active',controller_sha=H.OLD_CONTROLLER,
                    stage_workflow_sha256='0'*64,recovery=dict(source_sha=H.OLD_CONTROLLER))
        (state/'backup.json').write_text(json.dumps(backup))
        (root/'policy.json').write_text(json.dumps(policy))
        (state/'controller.lock').touch()
        old={str(oldrec):sha(oldrec),str(oldrecv):sha(oldrecv)}
        new={str(oldrec):sha(newrec),str(oldrecv):sha(newrecv)}
        proposed=copy.deepcopy(policy)
        proposed.update(mode='disabled',controller_sha='c'*40,stage_workflow_sha256='1'*64)
        proposed['recovery']['source_sha']='c'*40
        nextrec=copy.deepcopy(backup)
        nextrec['after'].update(new);nextrec['manifest']='new-manifest'
        payload={oldrec:newrec,oldrecv:newrecv}
        return root,state,install,oldrec,oldrecv,newrec,newrecv,policy,backup,proposed,nextrec,old,new,payload

    def test_two_step_disable_then_install_and_no_hidden_rollback_after_activation(self):
        with tempfile.TemporaryDirectory() as t:
            (root,state,inst,oldrec,oldrecv,newrec,newrecv,policy,backup,proposed,
             nextrec,old,new,payload)=self.fixture(t)
            def atomic(path,value,mode=0o600):
                pathlib.Path(path).write_text(json.dumps(value))
            def read(path,owner=0):
                return json.loads(pathlib.Path(path).read_text())
            def put(a,b,mode): pathlib.Path(b).write_bytes(pathlib.Path(a).read_bytes())
            patches = [
                patch.object(H,'STATE',state), patch.object(H,'POLICY',root/'policy.json'),
                patch.object(H,'INSTALL',inst), patch.object(H,'RECOVERY',oldrec),
                patch.object(H,'RECEIVER',oldrecv), patch.object(H,'JOURNAL',state/'hotfix-191.json'),
                patch.object(H,'BACKUP',state/'hotfix-191-backup'), patch.object(H,'OLD',old),
                patch.object(H,'NEW',new), patch.object(H.receiver,'trusted_tree'),
                patch.object(H,'quiet'), patch.object(H,'state_hashes',return_value={'ledger':'frozen'}),
                patch.object(H.receiver,'atomic',side_effect=atomic),
                patch.object(H.receiver,'read',side_effect=read),
                patch.object(H.installer,'put',side_effect=put),
                patch.object(H,'plan',return_value=(policy,backup,proposed,nextrec,payload)),
                patch.object(H,'validated_payload',return_value=payload),
                patch.object(H.recovery,'policy',return_value=None),
            ]
            with ExitStack() as stack:
                for p in patches: stack.enter_context(p)
                drained = stack.enter_context(patch.object(H,'callbacks_drained'))
                a=H.transaction('apply',root,'new-manifest','c'*40,'1'*64)
                self.assertEqual(a['status'],'DISABLED_DRAIN')
                self.assertEqual(oldrec.read_bytes(),b'OLD-REC')
                self.assertEqual(read(root/'policy.json')['mode'],'disabled')
                self.assertEqual(read(state/'hotfix-191.json')['phase'],'draining')
                # Recover a power loss between journal write and initial policy disable.
                atomic(root/'policy.json',policy)
                self.assertEqual(H.transaction('apply',root,'new-manifest','c'*40,'1'*64)['status'],
                                 'DISABLED_DRAIN')
                self.assertEqual(read(root/'policy.json')['mode'],'disabled')
                a=H.transaction('apply',root,'new-manifest','c'*40,'1'*64)
                self.assertEqual(a['status'],'INSTALLED_DISABLED')
                drained.assert_called()
                self.assertEqual(oldrec.read_bytes(),b'NEW-REC')
                self.assertEqual(oldrecv.read_bytes(),b'NEW-RCV')
                self.assertEqual(read(state/'backup.json')['after'],new)
                self.assertEqual(read(root/'policy.json')['mode'],'disabled')
                a=H.transaction('activate',probe=123)
                self.assertEqual(a['status'],'ACTIVE')
                self.assertEqual(read(root/'policy.json')['mode'],'active')
                with self.assertRaises(receiver.Refused):H.transaction('rollback')

    def test_interrupted_installer_temp_is_removed_only_if_root_owned_regular_and_safe(self):
        with tempfile.TemporaryDirectory() as folder:
            target=pathlib.Path(folder)/'recovery.py'
            tmp=target.with_name('.recovery.py.install')
            tmp.write_bytes(b'partially written')
            info=SimpleNamespace(st_mode=stat.S_IFREG|0o644,st_uid=0,st_nlink=1)
            with patch.object(H.receiver,'trusted_tree'),patch.object(pathlib.Path,'lstat',return_value=info):
                H.clear_interrupted_put(target)
            self.assertFalse(tmp.exists())
            tmp.write_bytes(b'intruder')
            bad=SimpleNamespace(st_mode=stat.S_IFREG|0o644,st_uid=1001,st_nlink=1)
            with patch.object(H.receiver,'trusted_tree'),patch.object(pathlib.Path,'lstat',return_value=bad):
                with self.assertRaises(receiver.Refused):H.clear_interrupted_put(target)
            self.assertTrue(tmp.exists())

    def test_crash_after_first_file_replacement_recovers_without_touching_tasks(self):
        with tempfile.TemporaryDirectory() as t:
            (root,state,inst,oldrec,oldrecv,newrec,newrecv,policy,backup,proposed,
             nextrec,old,new,payload)=self.fixture(t)
            def atomic(path,value,mode=0o600):
                pathlib.Path(path).write_text(json.dumps(value))
            def read(path,owner=0):
                return json.loads(pathlib.Path(path).read_text())
            calls=[0]
            def put(a,b,mode):
                pathlib.Path(b).write_bytes(pathlib.Path(a).read_bytes())
                if str(b)==str(oldrec) and pathlib.Path(a)==newrec and calls[0]==0:
                    calls[0]+=1
                    raise RuntimeError('interrupted after first trusted atomic file')
            patches = [
                patch.object(H,'STATE',state), patch.object(H,'POLICY',root/'policy.json'),
                patch.object(H,'INSTALL',inst), patch.object(H,'RECOVERY',oldrec),
                patch.object(H,'RECEIVER',oldrecv), patch.object(H,'JOURNAL',state/'hotfix-191.json'),
                patch.object(H,'BACKUP',state/'hotfix-191-backup'), patch.object(H,'OLD',old),
                patch.object(H,'NEW',new), patch.object(H.receiver,'trusted_tree'),
                patch.object(H,'quiet'), patch.object(H,'callbacks_drained'),
                patch.object(H,'state_hashes',return_value={'ledger':'frozen'}),
                patch.object(H.receiver,'atomic',side_effect=atomic),
                patch.object(H.receiver,'read',side_effect=read),
                patch.object(H.installer,'put',side_effect=put),
                patch.object(H,'plan',return_value=(policy,backup,proposed,nextrec,payload)),
                patch.object(H,'validated_payload',return_value=payload),
                patch.object(H.recovery,'policy',return_value=None),
            ]
            with ExitStack() as stack:
                for p in patches: stack.enter_context(p)
                H.transaction('apply',root,'new-manifest','c'*40,'1'*64)
                with self.assertRaises(RuntimeError):
                    H.transaction('apply',root,'new-manifest','c'*40,'1'*64)
                self.assertEqual(read(state/'hotfix-191.json')['phase'],'installing')
                self.assertEqual(H.transaction('rollback')['status'],'ROLLED_BACK_DISABLED')
                self.assertEqual(oldrec.read_bytes(),b'OLD-REC')
                self.assertEqual(oldrecv.read_bytes(),b'OLD-RCV')
                self.assertEqual(read(root/'policy.json')['mode'],'disabled')
                self.assertEqual(read(state/'backup.json'),backup)

if __name__=='__main__':unittest.main()

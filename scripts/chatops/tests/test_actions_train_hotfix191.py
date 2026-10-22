"""Offline root hotfix transaction tests. All paths are disposable synthetic test directories."""
import copy
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

from test_actions_train import installer, receiver

FILE = pathlib.Path(__file__).resolve().parents[1]/'ops/recovery_hotfix_191.py'
spec = importlib.util.spec_from_file_location('recovery_hotfix_191', FILE)
H = importlib.util.module_from_spec(spec)
spec.loader.exec_module(H)


def sha(path):
    p=pathlib.Path(path)
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None


class Hotfix191(unittest.TestCase):
    def test_closed_actions_and_paths(self):
        self.assertEqual({'dry','apply','activate','rollback'},
            set(__import__('ast').literal_eval(
                next(n for n in __import__('ast').walk(__import__('ast').parse(FILE.read_text()))
                     if isinstance(n,__import__('ast').Call) and isinstance(n.func,__import__('ast').Attribute)
                     and n.func.attr=='add_argument' and n.args and
                     isinstance(n.args[0],__import__('ast').Constant) and n.args[0].value=='action').keywords[0].value)))
        self.assertEqual(H.OLD_CONTROLLER,'ba02b9d9f9d56c7b07379da22d128c3dfa7341e1')
        self.assertEqual(H.NEW_SHA,'579ea87375a1008481f29a736f818944adb40bd5d924719824bee410849050ea')

    def test_single_source_change_and_pins_required(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);install=root/'install';install.mkdir()
            target=install/'recovery.py';target.write_text('old')
            source=root/'source.py';source.write_text('new')
            unchanged=install/'client.py';unchanged.write_text('same')
            p=root/'bundle';(p/'.github/workflows').mkdir(parents=True)
            ctrl='c'*40
            (p/'.github/workflows/train-stage.yml').write_text('ref: '+ctrl+'\nref: '+ctrl+'\n')
            (p/'.github/workflows/train-dispatch.yml').write_text('ref: '+ctrl+'\n')
            stage_sha=sha(p/'.github/workflows/train-stage.yml')
            policy=dict(mode='active',controller_sha=H.OLD_CONTROLLER,
                        recovery=dict(source_sha=H.OLD_CONTROLLER))
            record={'manifest':'old-manifest','after':{str(target):sha(target),str(unchanged):sha(unchanged)}}
            with patch.object(H,'TARGET',target),patch.object(H,'OLD_SHA',sha(target)),patch.object(H,'NEW_SHA',sha(source)), \
                 patch.object(H.receiver,'trusted_tree'),patch.object(H.installer,'payload',return_value={target:source,unchanged:unchanged}), \
                 patch.object(H.receiver,'read',side_effect=lambda path,*args:policy if path==H.POLICY else record), \
                 patch.object(H.recovery,'policy',return_value=None):
                r=H.planned(p,'test-manifest',ctrl,stage_sha)
                self.assertEqual(r[2]['mode'],'disabled')
                self.assertEqual(r[2]['controller_sha'],ctrl)
                self.assertEqual(r[2]['recovery']['source_sha'],ctrl)
                self.assertEqual(r[3]['after'][str(target)],sha(source))
                self.assertEqual(r[3]['after'][str(unchanged)],sha(unchanged))
                # Wrong target, extra changed runtime and wrong workflow hash refuse.
                with self.assertRaises(H.receiver.Refused):
                    H.planned(p,'test-manifest',ctrl,'0'*64)
                other=root/'different';other.write_text('drift')
                with patch.object(H.installer,'payload',return_value={target:source,unchanged:other}):
                    with self.assertRaises(H.receiver.Refused):
                        H.planned(p,'test-manifest',ctrl,stage_sha)

    def test_apply_activate_and_disabled_rollback_preserve_task_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp); install=root/'install';install.mkdir()
            state=root/'state';state.mkdir()
            target=install/'recovery.py';target.write_bytes(b'OLD')
            replacement=root/'NEW';replacement.write_bytes(b'NEW')
            (state/'controller.lock').touch()
            oldpolicy=dict(mode='active',controller_sha=H.OLD_CONTROLLER,stage_workflow_sha256='0'*64,
                           recovery=dict(source_sha=H.OLD_CONTROLLER))
            oldrecord=dict(after={str(target):sha(target)},manifest='old')
            journal={}
            def atomic(path,value,mode=0o600):
                p=pathlib.Path(path);p.write_text(json.dumps(value))
            def read(path,owner=0):
                p=pathlib.Path(path)
                return json.loads(p.read_text()) if p.exists() else copy.deepcopy(
                    oldpolicy if p.name=='policy.json' else oldrecord)
            with patch.object(H,'STATE',state),patch.object(H,'POLICY',root/'policy.json'),\
                 patch.object(H,'TARGET',target),patch.object(H,'BACKUP',state/'hotfix-191-backup'),\
                 patch.object(H,'JOURNAL',state/'hotfix-191.json'),\
                 patch.object(H,'OLD_SHA',sha(target)),patch.object(H,'NEW_SHA',sha(replacement)),\
                 patch.object(H.receiver,'trusted_tree'),patch.object(H,'quiet'),\
                 patch.object(H,'state_hashes',return_value={'ledger':'frozen'}),\
                 patch.object(H.receiver,'atomic',side_effect=atomic),\
                 patch.object(H.receiver,'read',side_effect=read),\
                 patch.object(H.installer,'put',side_effect=lambda a,b,mode: pathlib.Path(b).write_bytes(pathlib.Path(a).read_bytes())),\
                 patch.object(H,'planned',return_value=(oldpolicy,oldrecord,
                      dict(oldpolicy,mode='disabled',controller_sha='c'*40,
                           recovery=dict(source_sha='c'*40),stage_workflow_sha256='1'*64),
                      dict(oldrecord,after={str(target):sha(replacement)},manifest='new'),replacement)):
                self.assertEqual(H.transaction('apply',root,'manifest','c'*40,'1'*64)['status'],'INSTALLED_DISABLED')
                self.assertEqual(read(root/'policy.json')['mode'],'disabled')
                self.assertEqual(target.read_bytes(),b'NEW')
                self.assertEqual(H.transaction('activate',probe=123)['status'],'ACTIVE')
                self.assertEqual(read(root/'policy.json')['mode'],'active')
                with self.assertRaises(H.receiver.Refused):
                    H.transaction('rollback')
                # Stopping dispatch is an explicit OPS gate, not automatic rollback.
                p=read(root/'policy.json');p['mode']='disabled';atomic(root/'policy.json',p)
                with self.assertRaises(H.receiver.Refused):
                    H.transaction('rollback') # active journal must never rewind after more work


if __name__=='__main__':unittest.main()

"""Targeted live-topology adaptations; no network/model/service mutations."""
import base64,copy,hashlib,json
from pathlib import Path
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from test_actions_train import core,receiver,installer,stage,ROOT,HEAD,BASE,req,active,card,A,S,TASK

class DevRefTrust(unittest.TestCase):
    def setUp(self):
        self.raw=('ref: '+HEAD+'\n').encode()
        self.policy={'controller_sha':HEAD,'stage_workflow_sha256':hashlib.sha256(self.raw).hexdigest()}
        self.run={'path':'.github/workflows/train-stage.yml','head_branch':'dev','head_sha':'d'*40,
                  'event':'workflow_dispatch','run_attempt':1,'status':'in_progress',
                  'repository':{'id':core.REPO_ID},'head_repository':{'id':core.REPO_ID},'actor':{'id':core.OWNER}}
    def check(self):
        outer=self
        class API:
            def __init__(self,*_):pass
            def identity(self):pass
            def __call__(self,path):
                if path.startswith('actions/'):return outer.run
                return {'type':'file','path':'.github/workflows/train-stage.yml','encoding':'base64',
                        'size':len(outer.raw),'content':base64.b64encode(outer.raw).decode()}
        with patch.object(core,'API',API):receiver.hosted_identity(req(),self.policy)
    def test_new_dev_head_with_identical_pinned_controller_is_normal(self):self.check()
    def test_changed_workflow_refuses_even_if_run_actor_is_owner(self):
        self.raw+=b'# changed workflow\n'
        with self.assertRaises(core.Refused):self.check()
    def test_other_environment_ref_and_fork_refused(self):
        for change in ({'head_branch':'main'},{'head_repository':{'id':9}},{'actor':{'id':9}}):
            old=copy.deepcopy(self.run);self.run.update(change)
            with self.assertRaises(core.Refused):self.check()
            self.run=old
    def test_profile_persists_across_automatic_continuation(self):
        c=card(active('candidate'));c['profile']='codex'
        result=core.plan(A,S,{'slots':{'slot1':c}},[],profile='auto')
        self.assertEqual(result[0]['profile'],'codex')

class SlotTrust(unittest.TestCase):
    def test_quiescent_known_slot_cgroup_does_not_scan_unrelated_models(self):
        result=SimpleNamespace(stdout='ActiveState=inactive\nMainPID=0\nControlGroup=\n')
        with patch.object(receiver.subprocess,'run',return_value=result) as run,patch.object(receiver.pwd,'getpwnam',return_value=SimpleNamespace(pw_uid=1002)):
            receiver.no_models(1002,'slot1')
            self.assertIn('gobadminton-slot@slot1.service',run.call_args.args[0])
    def test_legacy_slot_still_active_refused(self):
        result=SimpleNamespace(stdout='ActiveState=active\nMainPID=123\nControlGroup=/scope\n')
        with patch.object(receiver.subprocess,'run',return_value=result),patch.object(receiver.pwd,'getpwnam',return_value=SimpleNamespace(pw_uid=1002)):
            with self.assertRaises(core.Refused):receiver.no_models(1002,'slot1')
    def test_unproven_promoting_checkpoint_never_accepted(self):
        state={'active':active('promoting'),'done':[]}
        with patch.object(installer,'checkpoint',return_value=(state,[])),patch.object(installer,'no_models'),patch.object(installer,'free_lock'),patch.object(installer.pwd,'getpwnam',return_value=SimpleNamespace(pw_uid=1002)):
            with self.assertRaises(core.Refused):installer.safe_state('slot1',True,{})
    def test_monitor_payload_is_exact_additive_patch(self):
        package=ROOT/'scripts/chatops/actions_train'
        mapping=json.loads((package/'monitor-mapping.json').read_text())
        writer=(package/'monitor_payload/writer.py').read_text()
        self.assertEqual(writer.count(mapping['writer_insert']),1)
        self.assertEqual(hashlib.sha256(writer.replace(mapping['writer_insert'],'',1).encode()).hexdigest(),mapping['writer_before_sha256'])
        app=(package/'monitor_payload/app.js').read_text();extension=(package/'monitor_extension.js').read_text()+'\n'
        self.assertTrue(app.startswith(extension))
        restored=app[len(extension):].replace(mapping['app_insert'],'',1)
        self.assertEqual(hashlib.sha256(restored.encode()).hexdigest(),mapping['app_before_sha256'])

if __name__=='__main__':unittest.main()

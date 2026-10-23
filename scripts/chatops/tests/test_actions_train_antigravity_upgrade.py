"""Bounded AGY installation: prospective budget, private auth and crash-safe activation."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch
from test_actions_train import ROOT,core,receiver as R
spec=importlib.util.spec_from_file_location('agy_upgrade_test',ROOT/'scripts/chatops/ops/antigravity_qa_upgrade.py')
U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U)

class AgYUpgrade(unittest.TestCase):
 def setUp(self):
  self.budget={'schema':1,'providers':{'codex':{'author':'unlimited','qa':'unlimited'},'cursor':{'author':'unlimited'}},
   'slots':{s:{'codex':{'author':'unlimited','qa':'unlimited'},'cursor':{'author':'unlimited'}} for s in ('slot1','slot2')}}
  self.modules={'native_antigravity.py':'a'*64,'native_guard.py':'b'*64}
  self.marker={'schema':'GB_ANTIGRAVITY_QA_29_V1','phase':'canary','executor_uid':978,'slot':'slot2',
   'canary_task_sha256':'c'*64,'modules':self.modules}
  q={'issue':29,'base':'d'*40,'head':'e'*40,'work':'/srv/gb-slots/slot2/worktrees/antigravity-qa-29-canary'}
  task={'schema':'GB_ANTIGRAVITY_QA_29_TASK_V1','issue':29,'role':'qa_qualification','slot':'slot2','base':q['base'],'head':q['head'],'model':'claude-sonnet-5-5-medium','max_calls':1}
  q['task_sha256']=core.digest(task);self.marker['canary_task_sha256']=core.digest(task);self.marker['qualification']=q
  self.proof={'schema':'GB_AGY_INSTALL_PROOF_29_V1','reviewed':True,'marker':self.marker}
 def test_budget_addition_is_one_qa_only_and_does_not_change_existing_caps(self):
  before=copy.deepcopy(self.budget)
  marker,budget=U.reviewed_configuration(self.proof,self.budget,self.modules)
  self.assertEqual(self.budget,before);self.assertEqual(marker,self.marker)
  self.assertEqual(budget['providers'].pop('agy'),{'qa':1})
  self.assertEqual(budget['slots']['slot2'].pop('agy'),{'qa':1})
  self.assertEqual(budget,before)
 def test_existing_agy_budget_cannot_be_reset_even_if_exhausted(self):
  for section in (self.budget['providers'],self.budget['slots']['slot1'],self.budget['slots']['slot2']):
   section['agy']={'qa':0}
   with self.assertRaises(core.Refused):U.reviewed_configuration(self.proof,self.budget,self.modules)
   del section['agy']
 def test_wrong_identity_phase_task_or_module_pin_cannot_install(self):
  for key,value in [('executor_uid',0),('slot','slot1'),('phase','ready'),('canary_task_sha256','bad'),('modules',{})]:
   proof=copy.deepcopy(self.proof);proof['marker'][key]=value
   with self.subTest(key=key),self.assertRaises(core.Refused):U.reviewed_configuration(proof,self.budget,self.modules)
  with self.assertRaises(core.Refused):U.reviewed_configuration(self.proof,self.budget,{})
 def test_historical_entries_cursor_qualification_and_ledgers_are_preserved(self):
  original={'ledger':'hash','entry207':'unknown','entry225':'deferred',str(U.BUDGET):'old-budget'}
  C=SimpleNamespace(preserved=lambda _:copy.deepcopy(original))
  with patch.object(U.i,'sha',return_value='old'):
   saved=U.preserved(C,None)
  self.assertNotIn(str(U.BUDGET),saved)
  for name in ('ledger','entry207','entry225'):self.assertEqual(saved[name],original[name])
  self.assertEqual(saved['/etc/gobadminton-slots/cursor-author.json'],'old')
 def test_private_auth_source_and_pinned_cli_only_no_overwrite(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);binary=root/'agy';auth=root/'auth';target=root/'target';auth_target=root/'auth-target'
   binary.write_bytes(b'fake pinned executable');binary.chmod(0o700)
   auth.write_text(json.dumps({'auth_method':'synthetic','id_token':'inert','token':'inert'}));auth.chmod(0o600)
   with patch.multiple(U,BIN_SOURCE=binary,AUTH_SOURCE=auth,BIN_TARGET=target,AUTH_TARGET=auth_target,
                       AGY_SHA=hashlib.sha256(binary.read_bytes()).hexdigest()):
    self.assertEqual(U.provisioning(),{target:binary,auth_target:auth})
    auth.chmod(0o644)
    with self.assertRaises(core.Refused):U.provisioning()
    auth.chmod(0o600);auth_target.write_text('existing private state')
    with self.assertRaises(core.Refused):U.provisioning()
    self.assertEqual(auth_target.read_text(),'existing private state')
 def test_activation_resume_after_policy_effect_preserves_new_train_progress(self):
  policy={'mode':'disabled','controller_sha':'a'*40}
  journal={'phase':'installed-disabled','controller':'a'*40,'changes':{},'preserved':{}}
  files={U.JOURNAL:copy.deepcopy(journal),R.POLICY:copy.deepcopy(policy)}
  C=SimpleNamespace(quiet=Mock());helper=SimpleNamespace(probe=Mock(return_value={'run':123}))
  def write(path,value,**kwargs):
   files[path]=copy.deepcopy(value)
   if path==R.POLICY and value['mode']=='active':raise OSError('crash after policy persisted')
  with patch.object(R,'atomic',side_effect=write),patch.object(U,'preserved',return_value={}):
   with self.assertRaises(OSError):U.activate_release(C,helper,journal,policy,123)
  self.assertEqual(files[R.POLICY]['mode'],'active')
  writes=[]
  def resume(path,value,**kwargs):files[path]=copy.deepcopy(value);writes.append(path)
  with patch.object(R,'atomic',side_effect=resume),patch.object(R,'publish_monitor'), \
       patch.object(U,'preserved',return_value={'new-progress':'never rewound'}):
   U.activate_release(C,helper,files[U.JOURNAL],files[R.POLICY],123)
   stable=copy.deepcopy(files);count=len(writes)
   U.activate_release(C,helper,files[U.JOURNAL],files[R.POLICY],123)
   self.assertEqual(files,stable);self.assertEqual(len(writes),count)
  helper.probe.assert_called_once();self.assertEqual(files[U.JOURNAL]['phase'],'active-canary')

class ActualQualification(unittest.TestCase):
 def scenario(self,fail_after=None,passed=True):
  marker={'phase':'canary','qualification':{'head':'a'*40,'base':'b'*40}}
  budget={'providers':{'agy':{'qa':1}},'slots':{'slot2':{'agy':{'qa':1}}}}
  receipt={'source_sha':'a'*40,'base_sha':'b'*40,'qualification_task_sha256':'task',
           'qualification_passed':passed,'charged_calls':1,'effective_model':'claude-sonnet-5-5-medium'}
  op={'binding':{'slot':'slot2','issue':29,'stage':'qa_qualification','head':'a'*40,'profile':'agy'},
      'run':123,'finished_at':456,'before':'same-checkpoint','after':'same-checkpoint',
      'result':{'status':'confirmed','qualification_passed':passed,'checkpoint_changed':False,
                'qa':{'verdict':'PASS','reviewed_sha':'a'*40},'native_receipt':receipt}}
  ops={'pending':None,'operations':{'canary':op}}
  policy={'mode':'active','controller_sha':'c'*40}
  journal={'phase':'active-canary','controller':'c'*40,'canary_task_sha256':'task','changes':{
    str(U.MARKER):{'after':U.encoded_hash(marker)},str(U.BUDGET):{'after':U.encoded_hash(budget)}}}
  files={U.JOURNAL:journal,U.MARKER:marker,U.BUDGET:budget};original=copy.deepcopy(ops);writes=[]
  def read(path,*args):return copy.deepcopy(files[path])
  def write(path,value,**kwargs):
   files[path]=copy.deepcopy(value);writes.append(path)
   if fail_after==len(writes):raise OSError('interrupted after durable write')
  with patch.object(R,'read',side_effect=read),patch.object(R,'atomic',side_effect=write), \
       patch.object(R,'checkpoint',return_value=({'active':None},[])),patch.object(R,'free_lock'), \
       patch.object(R,'journal',return_value=ops),patch.object(R,'publish_monitor'):
   if not passed:
    with self.assertRaises(core.Refused):U.accept_canary(copy.deepcopy(files[U.JOURNAL]),policy)
    self.assertEqual(writes,[]);return
   try:U.accept_canary(copy.deepcopy(files[U.JOURNAL]),policy)
   except OSError:pass
   fail_after=None
   U.accept_canary(copy.deepcopy(files[U.JOURNAL]),policy)
   stable=copy.deepcopy(files);count=len(writes)
   U.accept_canary(copy.deepcopy(files[U.JOURNAL]),policy)
   self.assertEqual(files,stable);self.assertEqual(len(writes),count)
  self.assertEqual(ops,original)
  self.assertEqual(files[U.MARKER]['phase'],'ready')
  self.assertEqual(files[U.BUDGET]['providers']['agy'],{'qa':'unlimited'})
  self.assertEqual(files[U.JOURNAL]['phase'],'active-ready')
  self.assertEqual(set(writes),{U.JOURNAL,U.MARKER,U.BUDGET})
 def test_nonpassing_real_qa_never_mints_readiness_or_budget(self):self.scenario(passed=False)
 def test_qualification_recovers_each_durable_effect_without_recall_or_history_rewind(self):
  for index in (None,1,2,3,4):
   with self.subTest(interruption=index):self.scenario(fail_after=index)

if __name__=='__main__':unittest.main()

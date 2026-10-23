"""One-time successor isolation and acceptance gates; no host writes or model calls."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from test_actions_train import ROOT, core, stage, receiver as R
import native_cursor as N
spec=importlib.util.spec_from_file_location('cursor_successor_upgrade_test',ROOT/'scripts/chatops/ops/cursor_successor_upgrade.py')
U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U)
TASK=json.loads((ROOT/'scripts/chatops/ops/cursor-author-successor-task.json').read_text())
EXPECTED=dict(issue=225,parent=211,slot='slot2',task_sha256=core.digest(TASK),
 archive_sha256='97b0713cf85f8a97f1c84e620692c6090d1017c338b9857ca17dbccc7f756a88',
 head='95c138460cbaeeeab03b5bf781dea4cbfddadceb',base='f984891a10eebb73f1fc97ec8cd58013837e4da2',
 diagnosis_sha256='cf277ca0e02f12e989eee02c68d5e6e145f49f541e85c267dcd8a65b3b15548a')

class SuccessorBoundary(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(); self.archive=Path(self.temp.name)/'archive.json'
  self.entry=dict(issue=211,snapshot=dict(issue=211,attempt=1,task={'max_attempts':1},
   head=EXPECTED['head'],base=EXPECTED['base'],qa={'verdict':'FAIL','reviewed_sha':EXPECTED['head']}))
  self.marker=dict(phase='canary',canary_task_sha256=core.digest(TASK),successor=copy.deepcopy(EXPECTED))
  self.active=dict(issue=225,task=copy.deepcopy(TASK),attempt=0)
  self.unchanged=Mock();self.a=SimpleNamespace(Bridge=SimpleNamespace(unchanged_issue=self.unchanged))
  self.real_digest=core.digest
 def tearDown(self):self.temp.cleanup()
 def seed(self,entry=None,slot='slot2'):
  self.archive.write_text(json.dumps({'entries':entry if entry is not None else [self.entry]}))
  original=copy.deepcopy(self.entry)
  def digest(v):return EXPECTED['archive_sha256'] if v==original else self.real_digest(v)
  with patch.object(N,'_read',return_value=json.dumps(self.marker).encode()), \
       patch.object(stage,'Path',return_value=self.archive),patch.object(core,'digest',side_effect=digest):
   return stage.cursor_successor_seed(self.a,None,self.active,slot)
 def test_exact_seed_revalidates_original_without_mutating_it(self):
  before=copy.deepcopy(self.entry);self.assertEqual(self.seed(),EXPECTED)
  self.assertEqual(self.entry,before);self.unchanged.assert_called_once_with(None,before['snapshot'])
 def test_other_issues_never_enter_exception_or_read_host_marker(self):
  self.active['issue']=226
  with patch.object(N,'_read') as read:self.assertIsNone(stage.cursor_successor_seed(self.a,None,self.active,'slot2'))
  read.assert_not_called()
 def test_wrong_slot_attempt_task_or_marker_cannot_seed(self):
  original=copy.deepcopy(self.active)
  cases=[('slot',None),('attempt',1),('goal','expanded scope'),('marker','ready'),('binding',226)]
  for kind,value in cases:
   with self.subTest(kind=kind):
    self.active=copy.deepcopy(original);self.marker=dict(phase='canary',canary_task_sha256=core.digest(TASK),successor=copy.deepcopy(EXPECTED))
    if kind=='attempt':self.active['attempt']=value
    if kind=='goal':self.active['task']['goal']=value
    if kind=='marker':self.marker['phase']=value
    if kind=='binding':self.marker['successor']['issue']=value
    with self.assertRaises(core.Refused):self.seed(slot='slot1' if kind=='slot' else 'slot2')
  self.unchanged.assert_not_called()
 def test_missing_duplicate_or_changed_archive_is_refused(self):
  for entries in [[],[self.entry,self.entry],[dict(self.entry,reason='rewritten')]]:
   with self.subTest(entries=entries),self.assertRaises(core.Refused):self.seed(entries)
  self.unchanged.assert_not_called()
 def test_parent_admission_drift_is_not_swallowed(self):
  self.unchanged.side_effect=core.Refused('parent changed')
  with self.assertRaisesRegex(core.Refused,'parent changed'):self.seed()
 def test_nonterminal_parent_cannot_seed_even_if_archive_digest_is_bound(self):
  self.entry['snapshot']['qa']['verdict']='PASS'
  with self.assertRaises(core.Refused):self.seed()

class SuccessorAcceptance(unittest.TestCase):
 def test_incomplete_done_never_promotes_qualification(self):
  j={'phase':'active-canary','controller':'a'*40,'canary_task_sha256':core.digest(TASK),'successor':EXPECTED}
  p={'mode':'active','controller_sha':'a'*40};marker=dict(phase='canary',canary_task_sha256=core.digest(TASK),successor=EXPECTED)
  def read(path,*args):return j if path==U.JOURNAL else p if path==R.POLICY else marker
  with patch.object(R,'read',side_effect=read),patch.object(R,'checkpoint',return_value=({'active':None},[])), \
       patch.object(R,'journal',return_value={'operations':{}}),patch.object(R,'atomic') as write:
   with self.assertRaises(core.Refused):U.accept_canary()
   write.assert_not_called()
 def test_changed_lineage_never_promotes(self):
  j={'phase':'active-canary','controller':'a'*40,'canary_task_sha256':core.digest(TASK),'successor':EXPECTED}
  p={'mode':'active','controller_sha':'a'*40};marker=dict(phase='canary',canary_task_sha256=core.digest(TASK),successor={})
  with patch.object(R,'read',side_effect=[j,p,marker]),patch.object(R,'atomic') as write:
   with self.assertRaises(core.Refused):U.accept_canary()
   write.assert_not_called()
 def test_budget_and_original_installation_receipt_are_preserved(self):
  fake=SimpleNamespace(preserved=lambda _: {'ledger':'unchanged'})
  with patch.object(U.i,'sha',return_value='old-hash'):
   preserved=U.preserved(fake,None)
  self.assertEqual(preserved[str(U.BUDGET)],'old-hash')
  self.assertEqual(preserved[str(U.STATE/'cursor-author-211.json')],'old-hash')


class IntegrationAcceptance(unittest.TestCase):
 def op(self,stage,head):
  return {'binding':{'issue':225,'stage':stage},'task_hash':'task','finished_at':123,
   'result':{'status':'confirmed','checkpoint':{'head':head}}}
 def test_only_final_exact_sha_qa_selected_after_integration(self):
  old=self.op('qa','old');new=self.op('qa','final')
  self.assertEqual(U.acceptance_operations({'before':old,'after':new},'qa','task','final'),{'after':new})
  self.assertEqual(old['result']['checkpoint']['head'],'old')
 def test_every_confirmed_author_counts_even_before_integration(self):
  ops={'one':self.op('author','before'),'two':self.op('author','after')}
  self.assertEqual(len(U.acceptance_operations(ops,'author','task','final')),2)


class CompleteAcceptancePath(unittest.TestCase):
 def test_integrated_canary_qualifies_once_from_final_evidence(self):
  head='a'*40;task_hash=core.digest(TASK)
  active={'issue':225,'phase':'done','task':copy.deepcopy(TASK),'attempt':1,'head':head,
   'qa':{'verdict':'PASS','reviewed_sha':head},'ci':{'sha':head,'id':101},'run':{'sha':head,'id':102},
   'live':{'gitSha':head},'server':{'accepted':{'status':'ACCEPTED','source_sha':head}},'release_id':'test-release'}
  state={'active':active,'done':[225]}
  def op(stage,sha,run):
   return {'binding':{'issue':225,'stage':stage},'task_hash':task_hash,'finished_at':1,'run':run,
    'after':core.digest(state),'result':{'status':'confirmed','checkpoint':{'head':sha},'routing':
     {'provider':'cursor' if stage=='author' else 'codex','effective_model':'Auto','usage':{'charged_calls':1},
      'native_receipt':{'phase':'imported'}}}}
  operations={'author':op('author','before-integration',1),'qa-before':op('qa','before-integration',2),
   'qa-final':op('qa',head,3),'dev-before':op('dev','before-integration',4),'dev-final':op('dev',head,5)}
  original=copy.deepcopy(operations)
  journal={'phase':'active-canary','controller':'c'*40,'canary_task_sha256':task_hash,'successor':EXPECTED,
   'changes':{str(U.MARKER):{'before':'original','after':'canary'}}}
  policy={'mode':'active','controller_sha':'c'*40}
  marker={'phase':'canary','canary_task_sha256':task_hash,'successor':EXPECTED,'modules':{}}
  files={U.JOURNAL:journal,R.POLICY:policy,U.MARKER:marker};writes=[]
  def read(path,*args):return copy.deepcopy(files[path])
  def write(path,value,**kwargs):files[path]=copy.deepcopy(value);writes.append(path)
  def checkpoint(slot):return (copy.deepcopy(state) if slot=='slot2' else {'active':None}),[]
  with patch.object(R,'read',side_effect=read),patch.object(R,'atomic',side_effect=write), \
       patch.object(R,'checkpoint',side_effect=checkpoint),patch.object(R,'journal',return_value={'operations':operations}), \
       patch.object(R,'publish_monitor'),patch.object(U.time,'time',return_value=12345):
   result=U.accept_canary();self.assertEqual(result['phase'],'active-ready')
   self.assertEqual(result['accepted_canary']['qa_run'],3)
   self.assertEqual(result['accepted_canary']['dev_run'],102)
   self.assertEqual(set(files[U.JOURNAL]['qualification_intent']['operations']),{'author','qa-final','dev-final'})
   self.assertEqual(result['accepted_canary']['author_run'],1)
   first=copy.deepcopy(files);count=len(writes);U.accept_canary()
   self.assertEqual(files,first);self.assertEqual(len(writes),count)
  self.assertEqual(files[U.MARKER]['qualified_at'],12345)
  self.assertEqual(operations,original)
  self.assertEqual(set(writes),{U.JOURNAL,U.MARKER})


class InterruptedTransitions(unittest.TestCase):
 def atomic_store(self,files,fail_at=None,before=False):
  calls=[]
  def write(path,value,**kwargs):
   calls.append(str(path))
   if len(calls)==fail_at and before:raise OSError('simulated interruption before durable write')
   files[path]=copy.deepcopy(value)
   if len(calls)==fail_at and not before:raise OSError('simulated interruption after durable write')
  return write,calls
 def activation(self,fail_at=None,before=False,monitor_failure=False):
  policy={'mode':'disabled','controller_sha':'a'*40};j={'phase':'installed-disabled','controller':'a'*40,'changes':{},'preserved':{}}
  files={U.JOURNAL:j,R.POLICY:policy};C=SimpleNamespace(quiet=Mock());u=SimpleNamespace(probe=Mock(return_value={'run':123}))
  write,calls=self.atomic_store(files,fail_at,before)
  monitor=Mock(side_effect=OSError('monitor unavailable') if monitor_failure else None)
  with patch.object(R,'atomic',side_effect=write),patch.object(R,'publish_monitor',monitor),patch.object(U,'preserved',return_value={}):
   try:U.activate_release(C,u,copy.deepcopy(files[U.JOURNAL]),copy.deepcopy(files[R.POLICY]),123)
   except OSError:pass
  # Simulate real task/ledger progress after dispatch became active: no history rewind or frozen-state requirement.
  progress={'attempts':7,'unknown207':'retained','pending':'existing-operation'}
  frozen=copy.deepcopy(progress);write2,repeat=self.atomic_store(files)
  changed={} if files[R.POLICY]['mode']=='disabled' else {'legitimate-progress':1}
  with patch.object(R,'atomic',side_effect=write2),patch.object(R,'publish_monitor'),patch.object(U,'preserved',return_value=changed):
   U.activate_release(C,u,copy.deepcopy(files[U.JOURNAL]),copy.deepcopy(files[R.POLICY]),123)
   stable=copy.deepcopy(files);count=len(repeat)
   U.activate_release(C,u,copy.deepcopy(files[U.JOURNAL]),copy.deepcopy(files[R.POLICY]),123)
   self.assertEqual(files,stable);self.assertEqual(len(repeat),count)
  self.assertEqual(files[R.POLICY]['mode'],'active');self.assertEqual(files[U.JOURNAL]['phase'],'active-canary')
  self.assertEqual(progress,frozen)
  # An intent persisted before the policy effect is reused; no repeated hosted probe.
  self.assertLessEqual(u.probe.call_count,2 if fail_at==1 and before else 1)
 def test_activation_recovers_before_and_after_every_durable_write(self):
  for index in (1,2,3):
   for before in (False,True):
    with self.subTest(write=index,before=before):self.activation(index,before)
 def test_activation_monitor_failure_is_idempotently_reportable(self):self.activation(monitor_failure=True)
 def qualification(self,fail_at=None,before=False,monitor_failure=False):
  policy={'mode':'active','controller_sha':'a'*40};old={'phase':'canary','modules':{}};proof={'slot':'slot2','head':'b'*40}
  operation={'status':'confirmed','head':'b'*40};new=old | {'phase':'ready','accepted_canary':proof,'qualified_at':12345}
  intent={'policy':policy,'controller':'a'*40,'task_sha256':core.digest(TASK),'successor':EXPECTED,
   'proof':proof,'operations':{'exact-op':core.digest(operation)},'old_marker':old,'old_hash':U.encoded_hash(old),
   'next_marker':new,'next_hash':U.encoded_hash(new),'qualified_at':12345}
  j={'phase':'qualifying-ready','controller':'a'*40,'canary_task_sha256':core.digest(TASK),'successor':EXPECTED,
   'qualification_intent':intent,'changes':{str(U.MARKER):{'before':U.encoded_hash(old),'after':U.encoded_hash(old)}}}
  files={U.JOURNAL:j,U.MARKER:old};write,calls=self.atomic_store(files,fail_at,before)
  with patch.object(R,'journal',return_value={'operations':{'exact-op':operation}}),patch.object(R,'atomic',side_effect=write), \
       patch.object(R,'publish_monitor',side_effect=OSError('monitor unavailable') if monitor_failure else None):
   try:U.complete_qualification(copy.deepcopy(files[U.JOURNAL]),policy,copy.deepcopy(files[U.MARKER]))
   except OSError:pass
  write2,repeat=self.atomic_store(files)
  with patch.object(R,'journal',return_value={'operations':{'exact-op':operation}}),patch.object(R,'atomic',side_effect=write2),patch.object(R,'publish_monitor'):
   U.complete_qualification(copy.deepcopy(files[U.JOURNAL]),policy,copy.deepcopy(files[U.MARKER]))
   stable=copy.deepcopy(files);count=len(repeat)
   U.complete_qualification(copy.deepcopy(files[U.JOURNAL]),policy,copy.deepcopy(files[U.MARKER]))
   self.assertEqual(files,stable);self.assertEqual(len(repeat),count)
  self.assertEqual(files[U.MARKER],new);self.assertEqual(files[U.JOURNAL]['phase'],'active-ready')
  self.assertEqual(files[U.JOURNAL]['changes'][str(U.MARKER)]['after'],U.encoded_hash(new))
 def test_qualification_recovers_before_and_after_each_effect(self):
  for index in (1,2):
   for before in (False,True):
    with self.subTest(write=index,before=before):self.qualification(index,before)
 def test_qualification_monitor_failure_does_not_repeat_effects(self):self.qualification(monitor_failure=True)
 def test_foreign_qualification_marker_and_changed_operation_refused(self):
  # Existing intent cannot bless arbitrary marker data, even if its shape looks ready.
  p={'mode':'active'};old={'phase':'canary','modules':{}};proof={'slot':'slot2'}
  new=old | {'phase':'ready','accepted_canary':proof,'qualified_at':123}
  intent={'policy':p,'controller':'a','task_sha256':'task','successor':EXPECTED,'old_marker':old,
   'old_hash':U.encoded_hash(old),'next_marker':new,'next_hash':U.encoded_hash(new),'proof':proof,
   'qualified_at':123,'operations':{'op':'original-hash'}}
  j={'phase':'qualifying-ready','controller':'a','canary_task_sha256':'task','successor':EXPECTED,'qualification_intent':intent}
  with patch.object(R,'journal',return_value={'operations':{'op':{'changed':True}}}),patch.object(R,'atomic') as write:
   with self.assertRaises(core.Refused):U.complete_qualification(j,p,old)
   write.assert_not_called()
  intent['operations']={}
  with patch.object(R,'journal',return_value={'operations':{}}),patch.object(R,'atomic') as write:
   with self.assertRaises(core.Refused):U.complete_qualification(j,p,{'phase':'ready','unrelated':True})
   write.assert_not_called()

if __name__=='__main__':unittest.main()

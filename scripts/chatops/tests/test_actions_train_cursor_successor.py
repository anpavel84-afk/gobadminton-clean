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

if __name__=='__main__':unittest.main()

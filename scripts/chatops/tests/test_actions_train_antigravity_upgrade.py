"""Bounded AGY installation: prospective budget, private auth and crash-safe activation."""
import copy
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch
from test_actions_train import ROOT,core,receiver as R
spec=importlib.util.spec_from_file_location('agy_upgrade_test',ROOT/'scripts/chatops/ops/antigravity_qa_upgrade.py')
U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U)
sys.path.insert(0,str(ROOT/'scripts/chatops/actions_train'))

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
                       AGY_SHA=hashlib.sha256(binary.read_bytes()).hexdigest(),SOURCE_UID=os.getuid()):
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

class RecoveryInstall(AgYUpgrade):
 def setUp(self):
  super().setUp()
  import native_antigravity as N
  import antigravity_qa_recovery as Q
  self.N=N;self.Q=Q
  self.mode=patch.object(U,'RECOVERY',True);self.mode.start();self.addCleanup(self.mode.stop)
  self.budget['providers']['agy']={'qa':1};self.budget['slots']['slot2']['agy']={'qa':1}
  q=self.marker['qualification'];q.update(parent_task_sha256=Q.PARENT_TASK,parent_operation=Q.PARENT_OPERATION,adapter_revision='f'*40)
  self.marker['adapter_revision']='f'*40
  q['task_sha256']=core.digest(N.qualification_task(q['base'],q['head'],**{k:q[k] for k in ('parent_task_sha256','parent_operation','adapter_revision')}))
  self.marker['canary_task_sha256']=q['task_sha256']
 def test_budget_addition_is_one_qa_only_and_does_not_change_existing_caps(self):
  before=copy.deepcopy(self.budget);_,after=U.reviewed_configuration(self.proof,self.budget,self.modules)
  self.assertEqual(self.budget,before)
  self.assertEqual(after['providers']['agy'],{'qa':2});self.assertEqual(after['slots']['slot2']['agy'],{'qa':2})
  after['providers']['agy']['qa']=1;after['slots']['slot2']['agy']['qa']=1;self.assertEqual(after,before)
 def test_existing_agy_budget_cannot_be_reset_even_if_exhausted(self):
  for section in (self.budget['providers'],self.budget['slots']['slot2']):
   for cap in (0,2,'unlimited'):
    old=copy.deepcopy(section['agy']);section['agy']={'qa':cap}
    with self.assertRaises(core.Refused):U.reviewed_configuration(self.proof,self.budget,self.modules)
    section['agy']=old
 def test_wrong_identity_phase_task_or_module_pin_cannot_install(self):
  for change in ({'adapter_revision':'a'*40},{'canary_task_sha256':'b'*64},{'modules':{}},{'phase':'ready'}):
   proof=copy.deepcopy(self.proof);proof['marker'].update(change)
   with self.assertRaises((core.Refused,self.N.ReviewError)):U.reviewed_configuration(proof,self.budget,self.modules)
 def test_historical_entries_cursor_qualification_and_ledgers_are_preserved(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);oldj=root/'old-journal';oldj.write_text('old immutable')
   oldb=root/'old-backup';oldb.mkdir();(oldb/'0').write_text('old saved source')
   (root/'antigravity-qa-qualification.json').write_text('original unknown reservation')
   with patch.multiple(U,STATE=root,LEGACY_JOURNAL=oldj,LEGACY_BACKUP=oldb),patch.object(U.i,'sha',side_effect=lambda p:'hash-'+str(p)):
    snapshot=U.preserved(SimpleNamespace(preserved=lambda u:{'ledger':'used1'}),None)
   for p in (oldj,oldb/'0',root/'antigravity-qa-qualification.json'):self.assertIn(str(p),snapshot)
   self.assertEqual(snapshot['ledger'],'used1')
 def test_recovery_mode_has_separate_journal_backup_and_exact_baseline_payload(self):
  with patch.multiple(U,RECOVERY=False,JOURNAL=U.LEGACY_JOURNAL,BACKUP=U.LEGACY_BACKUP,OLD=U.OLD,ALLOWED=U.ALLOWED):
   U.recovery_mode()
   self.assertNotEqual(U.JOURNAL,U.LEGACY_JOURNAL);self.assertNotEqual(U.BACKUP,U.LEGACY_BACKUP)
   self.assertEqual(U.OLD,'f68a4472f4f7478f007dc328f04569cf96b36f81')
   self.assertEqual(U.ALLOWED,{'native_antigravity.py','antigravity_qa_recovery.py','stage.py','receiver.py'})
 def test_cumulative_ledger_requires_one_across_dates_never_resets(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);p=root/'outbox/slot2/ledger.json';p.parent.mkdir(parents=True);p.write_text('{}')
   ledger={'2026-10-23':{'agy':{'qa':1}},'2026-10-24':{'codex':{'qa':5}}}
   with patch.object(R,'AUTONOMY',root),patch.object(R,'read',return_value=ledger):
    self.assertEqual(U.recovery_ledger(),{'slot1':0,'slot2':1})
    ledger['2026-10-24']['agy']={'qa':1}
    with self.assertRaises(core.Refused):U.recovery_ledger()
 def test_scoped_quiescence_view_restores_helper_after_exception_without_disk_writes(self):
  Q=self.Q;state={'active':None};original=SimpleNamespace(journal=lambda slot:{'pending':Q.PARENT_OPERATION,'generation':85,'operations':{}})
  C=SimpleNamespace(r=original)
  def quiet():
   self.assertIsNone(C.r.journal('slot2')['pending']);self.assertEqual(C.r.journal('slot1')['pending'],Q.PARENT_OPERATION)
   raise RuntimeError('existing helper stopped')
  C.quiet=quiet
  with patch.object(Q,'original_proof'),patch.object(Q,'executor_quiet'),patch.object(Q,'CHECKPOINT',core.digest(state)),patch.object(R,'journal',side_effect=original.journal),patch.object(R,'checkpoint',return_value=(state,None)),patch.object(R,'alive',return_value=False),patch.object(R,'identity',return_value=Q.PARENT_PROCESS),patch.object(R,'no_models'),patch.object(R,'free_lock'),patch.object(R,'atomic') as write:
   with U.recovery_quiescence(C) as scoped:
    with self.assertRaises(RuntimeError):scoped.quiet()
   self.assertIs(C.r,original);write.assert_not_called()
   self.assertEqual(original.journal('slot2')['pending'],Q.PARENT_OPERATION)
 def test_reconciliation_is_separate_active_action_never_dry_apply_or_activate(self):
  identity=('m','c'*40,'s','d','p');j=dict(zip(('manifest','controller','stage_sha256','dispatch_sha256','proof_sha256'),identity),phase='active-canary',changes={})
  policy={'mode':'active','controller_sha':'c'*40}
  with patch.object(U.os,'geteuid',return_value=0),patch.object(R,'trusted_tree'),patch.object(R,'read',side_effect=lambda path,*a:policy if path==R.POLICY else self.marker if path==U.MARKER else j),patch.object(Q:=self.Q,'reconcile_parent',return_value={'phase':'complete'}) as reconcile:
   result=U.execute_checked('reconcile',Path('/tmp'),'m','c'*40,'s','d',None,'p',None,None)
   self.assertEqual(result,{'phase':'complete'});reconcile.assert_called_once_with(R,self.marker['qualification'])
   reconcile.reset_mock();j['phase']='installed-disabled'
   with self.assertRaises(core.Refused):U.execute_checked('reconcile',Path('/tmp'),'m','c'*40,'s','d',None,'p',None,None)
   reconcile.assert_not_called()
 def test_dry_recovery_has_exact_payload_caps_and_no_reconciliation_or_provisioning_effects(self):
  with tempfile.TemporaryDirectory() as temp:
   bundle=Path(temp);controller='a'*40;stage='s';dispatch='d'
   ops=bundle/'scripts/chatops/ops';ops.mkdir(parents=True)
   proof=copy.deepcopy(self.proof);proof.update(schema='GB_AGY_RECOVERY_PROOF_29_V1',baseline_marker_sha256='old-marker')
   proofpath=ops/'antigravity-qa-install-proof.json';proofpath.write_text(json.dumps(proof))
   wf=bundle/'.github/workflows';wf.mkdir(parents=True)
   for name in ('train-stage.yml','train-dispatch.yml'):(wf/name).write_text(('ref: '+controller+'\n')*2)
   items={U.INSTALL/name:bundle/name for name in U.RECOVERY_ALLOWED}
   for source in items.values():source.write_text('reviewed source')
   policy=dict(mode='disabled',controller_sha=U.OLD)
   record={'after':{str(target):'before-'+target.name for target in items}}
   oldmarker={'phase':'canary','canary_task_sha256':self.Q.PARENT_TASK}
   def sha(path):
    if path.parent==bundle/'scripts/chatops/actions_train':return self.modules.get(path.name)
    if path==U.MARKER:return 'old-marker'
    if path in items:return 'before-'+path.name
    if path in items.values():return 'after-'+path.name
    if path.name=='train-stage.yml':return stage
    if path.name=='train-dispatch.yml':return dispatch
    if path==proofpath:return 'f'*64
    return None
   def read(path,*a):
    if path==R.POLICY:return policy
    if path==U.STATE/'backup.json':return record
    if path==U.MARKER:return oldmarker
    if path==U.BUDGET:return self.budget
    raise AssertionError(path)
   with patch.object(U,'ALLOWED',U.RECOVERY_ALLOWED),patch.object(U.os,'geteuid',return_value=0),patch.object(R,'trusted_tree'),patch.object(R,'read',side_effect=read),patch.object(U.i,'sha',side_effect=sha),patch.object(U.i,'payload',return_value=items),patch.object(U,'preserved',return_value={'ledger':'original-used1'}),patch.object(U,'recovery_ledger',return_value={'slot1':0,'slot2':1}),patch.object(U,'provisioning',side_effect=AssertionError('native credential rewrite')),patch.object(R,'atomic') as write,patch.object(self.Q,'reconcile_parent') as reconcile:
    result=U.execute_checked('dry',bundle,'manifest',controller,stage,dispatch,None,'f'*64,SimpleNamespace(quiet=Mock()),None)
   self.assertTrue(result['dry']);self.assertEqual(set(result['changes']),{str(p) for p in items}|{str(U.MARKER),str(U.BUDGET)})
   write.assert_not_called();reconcile.assert_not_called()
 def test_rollback_uses_only_recovery_backup_and_never_old_install_history(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);journalpath=root/'recovery.json';backup=root/'recovery-backup';backup.mkdir();target=root/'native.py';target.write_text('new');(backup/'0').write_text('old')
   j=dict(phase='installed-disabled',controller='new',preserved={'original':'preserved'},policy_before={'controller_sha':'old','mode':'disabled'},record_before={'old':'record'},changes={str(target):{'before':'before','after':'after'}})
   writes=[];restores=[]
   def sha(p):return 'before' if p==backup/'0' else 'after'
   with patch.multiple(U,JOURNAL=journalpath,BACKUP=backup),patch.object(U.os,'geteuid',return_value=0),patch.object(R,'trusted_tree'),patch.object(R,'read',side_effect=lambda p,*a:{'mode':'disabled','controller_sha':'new'} if p==R.POLICY else j),patch.object(U,'preserved',return_value={'original':'preserved'}),patch.object(U.i,'sha',side_effect=sha),patch.object(U,'put_managed',side_effect=lambda a,b:restores.append((a,b))),patch.object(R,'atomic',side_effect=lambda p,v,**kw:writes.append(p)):
    result=U.execute_checked('rollback',root,'m','c','s','d',None,'p',SimpleNamespace(quiet=Mock(),sync_directory=Mock()),None)
   self.assertEqual(result['phase'],'rolled-back-disabled');self.assertEqual(restores,[(backup/'0',target)])
   self.assertNotIn(U.LEGACY_JOURNAL,writes);self.assertNotIn(U.LEGACY_BACKUP,writes)
 def test_acceptance_filters_original_unknown_and_accepts_exact_successor_only(self):
  q=self.marker['qualification'];budget=copy.deepcopy(self.budget);budget['providers']['agy']['qa']=2;budget['slots']['slot2']['agy']['qa']=2
  receipt=dict(source_sha=q['head'],base_sha=q['base'],qualification_task_sha256=q['task_sha256'],qualification_lineage={k:q[k] for k in ('parent_task_sha256','parent_operation','adapter_revision')},qualification_passed=True,charged_calls=1,effective_model=self.N.MODEL)
  op=dict(task_hash=q['task_sha256'],run=99,finished_at=1,before='same',after='same',binding=dict(stage='qa_qualification',issue=29,slot='slot2',head=q['head']),result=dict(status='confirmed',qualification_passed=True,checkpoint_changed=False,qa=dict(verdict='PASS',reviewed_sha=q['head']),native_receipt=receipt))
  ops=dict(pending=None,operations={'original':dict(task_hash=self.Q.PARENT_TASK,binding=dict(stage='qa_qualification',issue=29),result={'status':'unknown'}),'successor':op});before=copy.deepcopy(ops)
  j=dict(phase='active-canary',controller='f'*40,canary_task_sha256=q['task_sha256'],changes={str(U.MARKER):{'after':U.encoded_hash(self.marker)},str(U.BUDGET):{'after':U.encoded_hash(budget)}})
  files={U.MARKER:copy.deepcopy(self.marker),U.BUDGET:budget,U.JOURNAL:j}
  with patch.object(R,'read',side_effect=lambda p,*a:copy.deepcopy(files[p])),patch.object(R,'atomic',side_effect=lambda p,v,**kw:files.update({p:copy.deepcopy(v)})),patch.object(R,'journal',return_value=ops),patch.object(R,'checkpoint',return_value=({'active':None},None)),patch.object(R,'free_lock'),patch.object(R,'publish_monitor'):
   U.accept_canary(j,{'mode':'active','controller_sha':'f'*40})
  self.assertEqual(ops,before);self.assertEqual(files[U.MARKER]['accepted_canary']['operation'],'successor')

if __name__=='__main__':unittest.main()

"""Offline controller-only entrypoint patch; no installed paths or provider calls."""
import copy,json,os,shutil,tempfile,unittest
from contextlib import contextmanager,ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock,patch
from test_actions_train_antigravity_upgrade import U,R,core
import native_antigravity as N
import antigravity_qa_recovery as Q

class EntrypointPatch(unittest.TestCase):
 @contextmanager
 def scenario(self):
  with tempfile.TemporaryDirectory() as temp,ExitStack() as stack:
   root=Path(temp);state=root/'state';state.mkdir();install=root/'install';install.mkdir();bundle=root/'bundle';bundle.mkdir()
   oldj=state/'original-install.json';oldj.write_text('immutable old installation')
   oldb=state/'original-backup';oldb.mkdir();(oldb/'0').write_text('immutable old backup')
   parentbackup=state/'parent-recovery-backup';parentbackup.mkdir();(parentbackup/'0').write_text('immutable parent backup')
   parentpath=state/'parent-recovery.json';markerpath=root/'marker.json';budgetpath=root/'budget.json';policy=root/'policy.json'
   receiver=install/'receiver.py';receiver.write_text('old receiver');native=install/'native_antigravity.py';native.write_text('unchanged pinned native')
   source=bundle/'receiver.py';source.write_text('reviewed receiver factory')
   controller='e'*40;workflows=bundle/'.github/workflows';workflows.mkdir(parents=True)
   for name in ('train-stage.yml','train-dispatch.yml'):(workflows/name).write_text(('ref: '+controller+'\n')*2)
   q=dict(issue=29,base='7f95328e9d3ff1270d9f24dc6c85576588767669',head='be3824982e030684ca6fabb1bb076c1a1542779c',work=str(N.QUALIFICATION_WORK),parent_task_sha256=Q.PARENT_TASK,parent_operation=Q.PARENT_OPERATION,adapter_revision=U.PATCH_BASE,task_sha256=U.PATCH_TASK)
   marker=dict(schema='GB_ANTIGRAVITY_QA_29_V1',phase='canary',executor_uid=978,slot='slot2',adapter_revision=U.PATCH_BASE,canary_task_sha256=U.PATCH_TASK,qualification=q)
   budget={'providers':{'agy':{'qa':2},'codex':{'author':'unlimited'}},'slots':{'slot2':{'agy':{'qa':2}}}}
   checkpoint={'active':None};j={'pending':None,'generation':86,'operations':{'original':{'task_hash':Q.PARENT_TASK,'result':{'status':'unknown'}}}}
   def write(path,value,**kw):path.write_text(json.dumps(value,sort_keys=True))
   def read(path,*a,**kw):return json.loads(path.read_text())
   write(markerpath,marker);write(budgetpath,budget);write(policy,dict(mode='disabled',controller_sha=U.PATCH_BASE,recovery={'source_sha':U.PATCH_BASE}))
   for name,value in [('slot2.json',j),(Q.FIXED,{'old':'unknown'}),(Q.LINEAGE,dict(schema='GB_AGY_29_LINEAGE_V1',ceiling=2,used_calls=1,parent_task=Q.PARENT_TASK,allowed_successor=U.PATCH_TASK)),(Q.RECONCILIATION,dict(phase='complete',successor_task=U.PATCH_TASK,parent_operation_sha256=Q.PARENT_DIGEST))]:write(state/name,value)
   ledger=state/'ledger.json';write(ledger,{'2026-10-23':{'agy':{'qa':1}}})
   parent=dict(controller=U.PATCH_BASE,phase='active-canary',canary_task_sha256=U.PATCH_TASK,changes={str(p):{'after':U.i.sha(p)} for p in (receiver,native,markerpath,budgetpath)})
   write(parentpath,parent)
   record=dict(manifest='old-manifest',after={str(p):U.i.sha(p) for p in (receiver,native)})
   write(state/'backup.json',record)
   proof=dict(schema='GB_AGY_ENTRYPOINT_PATCH_PROOF_29_V1',reviewed=True,parent_journal_sha256=U.i.sha(parentpath))
   proofpath=bundle/'scripts/chatops/ops/antigravity-qa-install-proof.json';proofpath.parent.mkdir(parents=True);write(proofpath,proof)
   journal=state/'patch.json';backup=state/'patch-backup'
   protected=[oldj,oldb/'0',parentbackup/'0',parentpath,state/'slot2.json',state/Q.FIXED,state/Q.LINEAGE,state/Q.RECONCILIATION,markerpath,budgetpath,ledger,native]
   snapshot={p:p.read_bytes() for p in protected}
   for module,values in [(U,dict(ENTRYPOINT_PATCH=True,RECOVERY=True,RECOVERY_MODULE=None,STATE=state,JOURNAL=journal,BACKUP=backup,INSTALL=install,MARKER=markerpath,BUDGET=budgetpath,OLD=U.PATCH_BASE,ALLOWED={'receiver.py'},PATCH_PARENT=parentpath,PATCH_PARENT_BACKUP=parentbackup,PATCH_PARENT_SHA=U.i.sha(parentpath),PATCH_MARKER_SHA=U.i.sha(markerpath),PATCH_BUDGET_SHA=U.i.sha(budgetpath),PATCH_NATIVE=U.i.sha(native),LEGACY_JOURNAL=oldj,LEGACY_BACKUP=oldb)),(R,dict(STATE=state,POLICY=policy))]:stack.enter_context(patch.multiple(module,**values))
   stack.enter_context(patch.object(Q,'CHECKPOINT',core.digest(checkpoint)))
   stack.enter_context(patch.object(Q,'executor_quiet'))
   stack.enter_context(patch.object(U.os,'geteuid',return_value=0))
   stack.enter_context(patch.object(R,'trusted_tree'))
   stack.enter_context(patch.object(R,'read',side_effect=read))
   stack.enter_context(patch.object(R,'atomic',side_effect=write))
   stack.enter_context(patch.object(R,'journal',side_effect=lambda slot:read(state/'slot2.json')))
   stack.enter_context(patch.object(R,'checkpoint',return_value=(checkpoint,None)))
   stack.enter_context(patch.object(R,'free_lock'))
   stack.enter_context(patch.object(R,'publish_monitor'))
   stack.enter_context(patch.object(U,'recovery_ledger',return_value={'slot1':0,'slot2':1}))
   stack.enter_context(patch.object(U.i,'payload',return_value={receiver:source,native:native}))
   stack.enter_context(patch.object(U.i,'put',side_effect=lambda a,b,mode:shutil.copyfile(a,b)))
   stack.enter_context(patch.object(U,'put_managed',side_effect=lambda a,b:shutil.copyfile(a,b)))
   helper=SimpleNamespace(probe=Mock(return_value={'run':123}))
   C=SimpleNamespace(quiet=Mock(),sync_directory=Mock(),preserved=lambda u:{str(ledger):U.i.sha(ledger),str(state/'slot2.json'):U.i.sha(state/'slot2.json')})
   args=(bundle,'reviewed-manifest',controller,U.i.sha(workflows/'train-stage.yml'),U.i.sha(workflows/'train-dispatch.yml'),123,U.i.sha(proofpath),C,helper)
   def execute(action):return U.execute_checked(action,*args)
   yield SimpleNamespace(**locals())
 def assert_protected(self,s):
  for path,raw in s.snapshot.items():self.assertEqual(path.read_bytes(),raw,str(path))
 def test_exact_constants_and_fresh_closed_mode(self):
  self.assertEqual(U.PATCH_BASE,'c70608bd5ed03c409e0bfd53e51974c68dd19deb')
  self.assertEqual(U.PATCH_TASK,'a76af5c1f3d79e9ca06ad5d0a66e238db1133004c821ff26c4737258dcd78b31')
  self.assertEqual(U.PATCH_NATIVE,'dbe3c8c89799365997bac19f17e2e492a1486eccc606c825607569fd09ff920d')
  with patch.multiple(U,ENTRYPOINT_PATCH=False,RECOVERY=False,JOURNAL=U.JOURNAL,BACKUP=U.BACKUP,OLD=U.OLD,ALLOWED=U.ALLOWED):
   U.entrypoint_patch_mode();self.assertEqual(U.ALLOWED,{'receiver.py'});self.assertEqual(U.OLD,U.PATCH_BASE)
   self.assertNotEqual(U.JOURNAL,U.PATCH_PARENT);self.assertNotEqual(U.JOURNAL,U.LEGACY_JOURNAL)
 def test_dry_apply_activate_chain_and_no_original_metadata_rewrite(self):
  with self.scenario() as s:
   dry=s.execute('dry');self.assertEqual(set(dry['changes']),{str(s.receiver)});self.assertFalse(s.journal.exists());self.assert_protected(s)
   s.execute('apply');j=s.read(s.journal);self.assertEqual(j['phase'],'installed-disabled');self.assertEqual(s.receiver.read_bytes(),s.source.read_bytes())
   self.assertEqual(j['patch_chain']['parent_journal_sha256'],s.proof['parent_journal_sha256']);self.assertEqual(j['patch_chain']['controller_after'],s.controller)
   self.assertEqual(j['inventory_after_sha256'],core.digest(s.read(s.state/'backup.json')));self.assert_protected(s)
   s.execute('activate');self.assertEqual(s.read(s.journal)['phase'],'active-canary');self.assert_protected(s)
   with self.assertRaises(core.Refused):s.execute('rollback')
 def test_each_durable_apply_interruption_rolls_back_only_patch_code_policy_inventory(self):
  for index in range(1,7):
   with self.subTest(index=index),self.scenario() as s:
    oldreceiver=s.receiver.read_bytes();oldrecord=(s.state/'backup.json').read_bytes();oldpolicy=s.policy.read_bytes();counter=[0]
    def interrupted(path,value,**kw):
     s.write(path,value,**kw);counter[0]+=1
     if counter[0]==index:raise OSError('simulated interruption after durable effect')
    with patch.object(R,'atomic',side_effect=interrupted):
     with self.assertRaises(OSError):s.execute('apply')
    s.execute('rollback');self.assertEqual(s.receiver.read_bytes(),oldreceiver)
    self.assertEqual((s.state/'backup.json').read_bytes(),oldrecord);self.assertEqual(s.policy.read_bytes(),oldpolicy)
    self.assertEqual(s.read(s.journal)['phase'],'rolled-back-disabled');self.assert_protected(s)
 def test_parent_hash_controller_inventory_task_lineage_and_pending_drift_refused(self):
  for kind in ('parent-hash','parent-controller','inventory','task','lineage','pending','generation','native'):
   with self.subTest(kind=kind),self.scenario() as s:
    if kind=='parent-hash':s.parentpath.write_text('changed')
    if kind=='parent-controller':
     parent=s.read(s.parentpath);parent['controller']='f'*40;s.write(s.parentpath,parent)
     s.proof['parent_journal_sha256']=U.i.sha(s.parentpath);s.write(s.proofpath,s.proof)
    if kind=='inventory':s.receiver.write_text('foreign receiver')
    if kind=='task':
     m=s.read(s.markerpath);m['canary_task_sha256']='a'*64;s.write(s.markerpath,m)
    if kind=='lineage':
     v=s.read(s.state/Q.LINEAGE);v['used_calls']=2;s.write(s.state/Q.LINEAGE,v)
    if kind in ('pending','generation'):
     v=s.read(s.state/'slot2.json');v[kind]='different' if kind=='pending' else 87;s.write(s.state/'slot2.json',v)
    if kind=='native':s.native.write_text('foreign native')
    # Re-bind proof digest to isolate semantic parent-controller rejection; all other drifts retain exact reviewed proof.
    args=list(s.args);args[6]=U.i.sha(s.proofpath)
    with self.assertRaises((core.Refused,N.ReviewError)):U.execute_checked('apply',*args)
    self.assertFalse(s.journal.exists())
 def test_accept_uses_patch_chain_exact_same_canary_and_own_durable_receipt(self):
  for crash in (None,1,2,3,4):
   with self.subTest(crash=crash),self.scenario() as s:
    s.execute('apply');s.execute('activate')
    q=s.q;receipt=dict(source_sha=q['head'],base_sha=q['base'],qualification_task_sha256=U.PATCH_TASK,qualification_lineage={k:q[k] for k in ('parent_task_sha256','parent_operation','adapter_revision')},qualification_passed=True,charged_calls=1,effective_model=N.MODEL)
    op=dict(task_hash=U.PATCH_TASK,run=999,finished_at=1,before='same',after='same',binding=dict(stage='qa_qualification',issue=29,slot='slot2',head=q['head']),result=dict(status='confirmed',qualification_passed=True,checkpoint_changed=False,qa=dict(verdict='PASS',reviewed_sha=q['head']),native_receipt=receipt))
    j=s.read(s.state/'slot2.json');j['operations']['actual-a76']=op;s.write(s.state/'slot2.json',j);count=[0];oldparent=s.parentpath.read_bytes()
    def interrupted(path,value,**kw):
     s.write(path,value,**kw);count[0]+=1
     if count[0]==crash:raise OSError('interrupted readiness metadata')
    with patch.object(R,'atomic',side_effect=interrupted):
     try:s.execute('accept')
     except OSError:pass
    s.execute('accept');stable=s.journal.read_bytes();s.execute('accept');self.assertEqual(s.journal.read_bytes(),stable)
    self.assertEqual(s.read(s.journal)['phase'],'active-ready');self.assertEqual(s.read(s.markerpath)['accepted_canary']['operation'],'actual-a76')
    self.assertEqual(s.parentpath.read_bytes(),oldparent);self.assertEqual(s.read(s.state/'slot2.json'),j)
 def test_accept_refuses_parent_or_current_inventory_drift_and_unknown_canary(self):
  for kind in ('parent','inventory','unknown'):
   with self.subTest(kind=kind),self.scenario() as s:
    s.execute('apply');s.execute('activate')
    if kind=='parent':s.parentpath.write_text('foreign history')
    if kind=='inventory':s.write(s.state/'backup.json',{'foreign':'inventory'})
    before=s.journal.read_bytes()
    with self.assertRaises(core.Refused):s.execute('accept')
    self.assertEqual(s.journal.read_bytes(),before)

if __name__=='__main__':unittest.main()

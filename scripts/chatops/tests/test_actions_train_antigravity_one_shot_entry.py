"""Full OPS dry/apply branch regressions; all effects stay in a temporary tree."""
import copy,json,shutil,tempfile,unittest
from contextlib import contextmanager,ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock,patch
from test_actions_train_antigravity_upgrade import U,R,core
from test_actions_train_antigravity_one_shot import descriptor
import antigravity_qa_recovery as Q

class OneShotEntry(unittest.TestCase):
 @contextmanager
 def scenario(self,mode='one-shot'):
  with tempfile.TemporaryDirectory() as temp,ExitStack() as stack:
   root=Path(temp);state=root/'state';state.mkdir();install=root/'install';install.mkdir()
   bundle=root/'bundle';source=bundle/'scripts/chatops/actions_train';source.mkdir(parents=True)
   markerpath=root/'marker.json';budgetpath=root/'budget.json';policy=root/'policy.json'
   parent=state/'antigravity-qa-29-entrypoint-patch.json';journal=state/'new-upgrade.json';backup=state/'new-backup'
   effects=[];validated=[]
   def write(path,value,**kw):path.write_text(json.dumps(value,sort_keys=True))
   def read(path,*a,**kw):return json.loads(path.read_text())
   allowed={'receiver.py','stage.py','native_antigravity.py','antigravity_qa_recovery.py'}
   items={}
   for name in allowed|{'native_guard.py'}:
    target=install/name;target.write_text('old '+name);candidate=source/name
    candidate.write_text(('old ' if name=='native_guard.py' else 'new ')+name);items[target]=candidate
   record=dict(manifest='old',after={str(p):U.i.sha(p) for p in items})
   write(state/'backup.json',record);write(parent,{'old':'immutable parent'})
   q=descriptor();controller=q['adapter_revision'];oldmarker=dict(phase='canary',canary_task_sha256=Q.SECOND_TASK)
   budget={'providers':{'agy':{'qa':2}},'slots':{'slot2':{'agy':{'qa':2}}}}
   write(markerpath,oldmarker);write(budgetpath,budget)
   write(policy,dict(mode='disabled',controller_sha='6efeca2391bff566e1aec980847b0322bc7f206f',recovery={'source_sha':'old'}))
   modules={name:U.i.sha(source/name) for name in ('native_antigravity.py','native_guard.py')}
   marker=dict(schema='GB_ANTIGRAVITY_QA_29_V1',phase='canary',slot='slot2',executor_uid=978,
    adapter_revision=q['adapter_revision'],qualification=q,canary_task_sha256=q['task_sha256'],modules=modules)
   proof=dict(schema='GB_AGY_ONE_SHOT_PROOF_29_V1',reviewed=True,marker=marker,baseline_marker_sha256=U.PATCH_MARKER_SHA,
    baseline_inventory_sha256='0ef1ec368d9402b279f46636927c069afb017a0892675b3f3cf7047ed747e281',
    parent_journal_sha256='b445479d6de88d6a66806ae897327e613c095f6342548c35a718e114b603c5ac')
   if mode!='one-shot':
    import native_antigravity as N
    q={k:q[k] for k in ('issue','base','head','work')}
    if mode=='recovery':q.update(parent_task_sha256=Q.PARENT_TASK,parent_operation=Q.PARENT_OPERATION,adapter_revision=controller)
    q['task_sha256']=core.digest(N.qualification_task(q['base'],q['head'],**{k:q[k] for k in ('parent_task_sha256','parent_operation','adapter_revision') if k in q}))
    marker['qualification']=q;marker['canary_task_sha256']=q['task_sha256']
    proof.update(schema='GB_AGY_INSTALL_PROOF_29_V1' if mode=='initial' else 'GB_AGY_RECOVERY_PROOF_29_V1')
    oldmarker['canary_task_sha256']=Q.PARENT_TASK;write(markerpath,oldmarker)
    if mode=='initial':budget={'providers':{},'slots':{'slot1':{},'slot2':{}}}
    else:budget={'providers':{'agy':{'qa':1}},'slots':{'slot2':{'agy':{'qa':1}}}}
    write(budgetpath,budget)
   proofpath=bundle/'scripts/chatops/ops/antigravity-qa-install-proof.json';proofpath.parent.mkdir(parents=True);write(proofpath,proof)
   workflows=bundle/'.github/workflows';workflows.mkdir(parents=True)
   for name in ('train-stage.yml','train-dispatch.yml'):(workflows/name).write_text(('ref: '+controller+'\n')*2)
   realsha=U.i.sha
   # Only immutable prerequisite byte snapshots receive supplied root evidence pins.
   pinned={p:(p.read_bytes(),h) for p,h in [(markerpath,U.PATCH_MARKER_SHA),(budgetpath,Q.BUDGET_RAW),
    (state/'backup.json',proof['baseline_inventory_sha256']),(parent,proof['parent_journal_sha256'])]}
   def sha(path):
    path=Path(path)
    if path in pinned and path.exists() and path.read_bytes()==pinned[path][0]:return pinned[path][1]
    return realsha(path)
   original_config=U.reviewed_configuration
   def configuration(*args):
    value=original_config(*args);validated.append(True);return value
   def observe(kind,path):
    if mode=='one-shot':assert validated,'write before complete real configuration validation'
    effects.append((kind,Path(path)))
   def atomic(path,value,**kw):observe('atomic',path);write(path,value)
   def put(a,b,*args):observe('copy',b);shutil.copyfile(a,b)
   realmkdir=Path.mkdir
   def mkdir(path,*args,**kw):observe('mkdir',path);return realmkdir(path,*args,**kw)
   before={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
   beforedirs={str(p.relative_to(root)) for p in root.rglob('*') if p.is_dir()}
   C=SimpleNamespace(quiet=Mock(),sync_directory=Mock(),preserved=lambda u:{'old':'unchanged'})
   helper=SimpleNamespace(probe=Mock())
   values=dict(ONE_SHOT=mode=='one-shot',RECOVERY=mode!='initial',ENTRYPOINT_PATCH=False,RECOVERY_MODULE=Q,STATE=state,INSTALL=install,
    JOURNAL=journal,BACKUP=backup,MARKER=markerpath,BUDGET=budgetpath,OLD='6efeca2391bff566e1aec980847b0322bc7f206f',ALLOWED=allowed)
   stack.enter_context(patch.multiple(U,**values));stack.enter_context(patch.object(U.os,'geteuid',return_value=0))
   stack.enter_context(patch.object(R,'POLICY',policy));stack.enter_context(patch.object(R,'read',side_effect=read))
   stack.enter_context(patch.object(R,'trusted_tree'));stack.enter_context(patch.object(R,'atomic',side_effect=atomic))
   stack.enter_context(patch.object(R,'journal',return_value={}))
   stack.enter_context(patch.object(Q,'grant_history'))
   stack.enter_context(patch.object(U,'recovery_ledger'))
   stack.enter_context(patch.object(U,'provisioning',return_value={}))
   stack.enter_context(patch.object(U,'preserved',return_value={'old':'unchanged'}))
   stack.enter_context(patch.object(U,'reviewed_configuration',side_effect=configuration))
   stack.enter_context(patch.object(U.i,'sha',side_effect=sha));stack.enter_context(patch.object(U.i,'payload',return_value=items))
   stack.enter_context(patch.object(U.i,'put',side_effect=put));stack.enter_context(patch.object(U,'put_managed',side_effect=put))
   stack.enter_context(patch.object(Path,'mkdir',mkdir))
   def execute(action):return U.execute_checked(action,bundle,'m'*64,controller,sha(workflows/'train-stage.yml'),sha(workflows/'train-dispatch.yml'),None,sha(proofpath),C,helper)
   yield SimpleNamespace(**locals())
 def assert_no_writes(self,s):
  self.assertEqual(s.effects,[])
  self.assertFalse(s.journal.exists());self.assertFalse(s.backup.exists())
  self.assertEqual({str(p.relative_to(s.root)):p.read_bytes() for p in s.root.rglob('*') if p.is_file()},s.before)
  self.assertEqual({str(p.relative_to(s.root)) for p in s.root.rglob('*') if p.is_dir()},s.beforedirs)
 def test_existing_exact_one_shot_marker_reaches_real_configuration_dry_and_apply(self):
  for action in ('dry','apply'):
   with self.subTest(action=action),self.scenario() as s:
    budget=s.budgetpath.read_bytes();answer=s.execute(action);self.assertEqual(s.validated,[True])
    if action=='dry':self.assertTrue(answer['dry']);self.assert_no_writes(s)
    else:
     self.assertEqual(answer['phase'],'installed-disabled');self.assertTrue(s.backup.is_dir())
     self.assertEqual(s.read(s.journal)['phase'],'installed-disabled')
     self.assertEqual(s.read(s.policy)['mode'],'disabled')
     self.assertEqual(s.read(s.markerpath),s.marker)
     self.assertTrue(all(path!=s.budgetpath for kind,path in s.effects))
    self.assertEqual(s.budgetpath.read_bytes(),budget)
 def test_bad_existing_marker_or_proof_rejects_full_entry_with_zero_any_writes(self):
  for action in ('dry','apply'):
   for fault in ('missing','existing-metadata','actual-marker-hash','proof-baseline'):
    with self.subTest(action=action,fault=fault),self.scenario() as s:
     if fault=='missing':s.markerpath.unlink()
     elif fault=='existing-metadata':s.write(s.markerpath,dict(s.oldmarker,phase='ready'))
     elif fault=='actual-marker-hash':s.pinned[s.markerpath]=(s.markerpath.read_bytes(),'f'*64)
     else:s.proof['baseline_marker_sha256']='f'*64;s.write(s.proofpath,s.proof)
     # Snapshot after intentional fixture corruption; installer must not mutate it.
     s.before={str(p.relative_to(s.root)):p.read_bytes() for p in s.root.rglob('*') if p.is_file()}
     with self.assertRaises(core.Refused):s.execute(action)
     self.assert_no_writes(s)
 def test_proposed_marker_grant_module_and_controller_mismatch_have_zero_any_writes(self):
  for action in ('dry','apply'):
   for fault in ('metadata','task','modules','grant','controller'):
    with self.subTest(action=action,fault=fault),self.scenario() as s:
     if fault=='metadata':s.marker['executor_uid']=0
     elif fault=='task':s.marker['canary_task_sha256']='f'*64
     elif fault=='modules':s.marker['modules']={}
     elif fault=='grant':s.q['qualification_grant']['permission_mode']='request-review'
     else:
      s.q['adapter_revision']='d'*40;s.marker['adapter_revision']='d'*40;s.q['qualification_grant']['controller_revision']='d'*40
      import native_antigravity as N
      s.q['task_sha256']=core.digest(N.qualification_task(s.q['base'],s.q['head'],adapter_revision='d'*40,qualification_grant=s.q['qualification_grant']))
      s.marker['canary_task_sha256']=s.q['task_sha256']
     s.write(s.proofpath,s.proof);s.before={str(p.relative_to(s.root)):p.read_bytes() for p in s.root.rglob('*') if p.is_file()}
     with self.assertRaises(core.Refused):s.execute(action)
     self.assertEqual(s.validated,[True] if fault=='controller' else [])
     self.assert_no_writes(s)

 def test_initial_absence_gate_and_legacy_recovery_paths_remain_exact(self):
  for action in ('dry','apply'):
   for mode in ('initial','recovery'):
    with self.subTest(action=action,mode=mode),self.scenario(mode) as s:
     if mode=='initial':s.markerpath.unlink()
     answer=s.execute(action);self.assertEqual(s.validated,[True])
     self.assertEqual(answer.get('phase'),'installed-disabled' if action=='apply' else None)
     if action=='dry':self.assertEqual(s.effects,[])
   for mode,fault in [('initial','exists'),('recovery','phase'),('recovery','task'),('recovery','hash')]:
    with self.subTest(action=action,mode=mode,fault=fault),self.scenario(mode) as s:
     if fault in ('phase','task'):
      value=copy.deepcopy(s.oldmarker);value['phase' if fault=='phase' else 'canary_task_sha256']='wrong';s.write(s.markerpath,value)
     elif fault=='hash':s.proof['baseline_marker_sha256']='f'*64;s.write(s.proofpath,s.proof)
     s.before={str(p.relative_to(s.root)):p.read_bytes() for p in s.root.rglob('*') if p.is_file()}
     with self.assertRaises(core.Refused):s.execute(action)
     self.assertEqual(s.validated,[]);self.assert_no_writes(s)

 def test_entrypoint_patch_wrong_marker_pin_rejects_before_any_kind_of_write(self):
  from test_actions_train_antigravity_entrypoint_patch import EntrypointPatch
  fixture=EntrypointPatch()
  for action in ('dry','apply'):
   with self.subTest(action=action),fixture.scenario() as s,patch.object(U,'ONE_SHOT',False),patch.object(U,'PATCH_MARKER_SHA','f'*64),patch.object(U.r,'atomic') as atomic,patch.object(U.i,'put') as copy,patch.object(U,'put_managed') as managed,patch.object(Path,'mkdir') as mkdir:
    with self.assertRaises(core.Refused):s.execute(action)
    for observed in (atomic,copy,managed,mkdir):observed.assert_not_called()
    fixture.assert_protected(s);self.assertFalse(s.journal.exists());self.assertFalse(s.backup.exists())

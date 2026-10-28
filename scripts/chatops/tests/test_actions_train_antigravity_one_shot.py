"""Separate exact one-shot grant; no provider or runtime actions."""
import copy,hashlib,importlib.util,json,os,sys,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock,patch
import test_actions_train_antigravity_recovery as old
import antigravity_qa_recovery as R
import native_antigravity as N
from core import digest,Refused
from context_policy import RULES_SHA256


def descriptor():
    q=dict(issue=29,base='a'*40,head='b'*40,work=str(N.QUALIFICATION_WORK),adapter_revision='c'*40)
    g=dict(schema=R.GRANT_SCHEMA,controller_revision=q['adapter_revision'],cli_sha256=N.AGY_SHA256,
           rules_sha256=RULES_SHA256,  # prospective fixture; real historical grants remain untouched
           fixture_sha256=digest({k:q[k] for k in ('base','head','work')}),permission_mode='always-proceed',
           input_transport='stream-json',timeout=1800,ceiling=1,
           prior_operations=[R.PARENT_OPERATION,R.SECOND_OPERATION],lineage_sha256=R.LINEAGE_RAW)
    q['qualification_grant']=g
    q['task_sha256']=digest(N.qualification_task(q['base'],q['head'],adapter_revision=q['adapter_revision'],qualification_grant=g))
    return q


class OneShot(unittest.TestCase):
    def setUp(self):
        self.f=old.Successor();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.f.reconcile();R.reserve_lineage(self.f.r,self.f.q,'old-successor')
        self.f.j=self.f.data['slot2.json'];self.f.j.update(pending=R.SECOND_OPERATION,generation=86)
        op=dict(task_hash=R.SECOND_TASK,run=39905564313,process=R.SECOND_PROCESS,
                before=R.CHECKPOINT,after=R.CHECKPOINT,result={'status':'unknown'})
        self.f.j['operations'][R.SECOND_OPERATION]=op
        self.q=descriptor();self.f.marker.update(qualification=self.q,canary_task_sha256=self.q['task_sha256'])
        self.saved=copy.deepcopy({k:self.f.data[k] for k in (R.LINEAGE,R.FIXED)})
        self.savedops=copy.deepcopy(self.f.j['operations'])
        self.patches=[patch.object(R,'SECOND_DIGEST',digest(op)),patch.object(R,'raw_pin')]
        for p in self.patches:p.start();self.addCleanup(p.stop)
    def reconcile(self):return R.reconcile_grant(self.f.r,self.q)
    def test_descriptor_closed_binds_every_field_and_does_not_reuse_old_lineage(self):
        self.assertEqual(N.qualification_descriptor(self.f.marker),self.q)
        self.assertFalse(R.successor(self.q));self.assertNotEqual(R.reservation_path(self.f.root,self.q),R.reservation_path(self.f.root,self.f.q))
        for field,value in [('ceiling',2),('permission_mode','request-review'),('input_transport','argv'),('timeout',1801),('unknown',True),('rules_sha256','0'*64)]:
            marker=copy.deepcopy(self.f.marker);marker['qualification']['qualification_grant'][field]=value
            with self.subTest(field=field),self.assertRaises((Refused,N.ReviewError)):N.qualification_descriptor(marker)
    def test_reconcile_and_duplicate_reservation_preserve_both_unknowns_and_old_2_of_2(self):
        self.reconcile();j=self.f.data['slot2.json']
        self.assertIsNone(j['pending']);self.assertEqual(j['generation'],87)
        self.assertEqual(j['operations'],self.savedops)
        for k,v in self.saved.items():self.assertEqual(self.f.data[k],v)
        R.reserve_grant(self.f.r,self.q,'new-operation')
        with self.assertRaises(Refused):R.reserve_grant(self.f.r,self.q,'duplicate')
        self.reconcile();self.assertEqual(self.f.data[R.GRANT_LEDGER]['used_calls'],1)
    def test_intent_crash_resumes_only_same_transaction(self):
        original=self.f.r.atomic
        def crash(path,value):
            original(path,value)
            if path.name==R.GRANT_RECONCILIATION and value['phase']=='intent':raise OSError('crash')
        with patch.object(self.f.r,'atomic',side_effect=crash):
            with self.assertRaises(OSError):self.reconcile()
        self.assertEqual(self.f.j['pending'],R.SECOND_OPERATION)
        self.assertEqual(self.reconcile()['phase'],'complete')
        for k,v in self.saved.items():self.assertEqual(self.f.data[k],v)
    def test_live_identity_lease_checkpoint_other_pending_or_old_evidence_blocks(self):
        cases=[patch.object(self.f.r,'identity',return_value=R.SECOND_PROCESS),
               patch.object(self.f.r,'free_lock',side_effect=Refused('lease occupied')),
               patch.object(self.f.r,'checkpoint',return_value=({'active':{}},None))]
        for p in cases:
            with p,patch.object(self.f.r,'alive',return_value=True),self.assertRaises(Refused):self.reconcile()
        self.f.j['pending']='foreign'
        with self.assertRaises(Refused):self.reconcile()
        self.assertNotIn(R.GRANT_LEDGER,self.f.data)
    def test_receiver_consumes_new_grant_before_fork_at_spent_daily_cap(self):
        import receiver
        self.reconcile();self.f.j=self.f.data['slot2.json']
        req=dict(action='train',stage='qa_qualification',slot='slot2',issue=29,phase='idle',head=self.q['head'],attempt=0,generation=87,profile='agy',run=123,run_attempt=1,gh_token='synthetic')
        from contextlib import ExitStack
        with ExitStack() as stack:
            def fake_budget(*a, **k):
                b=SimpleNamespace(remaining=lambda *a:0, issue=None)
                b.bind_issue=lambda issue: setattr(b,'issue',issue) or b
                if k.get('issue') is not None: b.bind_issue(k['issue'])
                return b
            for name,value in [('STATE',self.f.root),('read',self.f.r.read),('atomic',self.f.r.atomic),('journal',self.f.r.journal),('checkpoint',self.f.r.checkpoint),('guard',Mock()),('identity',Mock(return_value={})),('alive',Mock(return_value=False)),('live',lambda:(None,SimpleNamespace(Budget=fake_budget)))]:stack.enter_context(patch.object(receiver,name,value))
            stack.enter_context(patch.object(N,'qualification',return_value=self.f.marker));stack.enter_context(patch.object(N,'trusted',return_value=json.dumps(self.f.marker).encode()))
            def fork():
                self.assertEqual(self.f.data[R.GRANT_LEDGER]['used_calls'],1)
                self.assertTrue(R.reservation_path(self.f.root,self.q).exists());return 12345
            child=stack.enter_context(patch.object(receiver.os,'fork',side_effect=fork))
            self.assertEqual(receiver.qualification_request(req,{})['status'],'running')
            self.f.j=self.f.data['slot2.json']
            self.assertEqual(receiver.qualification_request(req|{'run':124},{})['status'],'unknown')
            child.assert_called_once()
        self.assertEqual(self.f.data[R.LINEAGE],self.saved[R.LINEAGE])


class ScopedCharge(unittest.TestCase):
    def setUp(self):
        from test_actions_train import S
        self.S=S;self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.limits=self.root/'limits.json';self.limits.write_text(json.dumps({'providers':{'agy':{'qa':2}},'slots':{'slot2':{'agy':{'qa':2}}}}))
        (self.root/'slot2').mkdir();self.ledger=self.root/'slot2/ledger.json';self.ledger.write_text(json.dumps({'2026-10-23':{'agy':{'qa':2}}}))
        (self.root/'registry.lock').touch()
        self.budget=S.Budget(self.limits,self.root,self.root/'registry.lock',today=lambda:'2026-10-23')
        self.q=descriptor();self.req=dict(stage='qa_qualification',slot='slot2',issue=29,head=self.q['head'],phase='idle',generation=87,attempt=0,run=1,run_attempt=1,profile='agy',_qa_qualification=self.q,_task_hash=self.q['task_sha256'])
        from core import binding
        self.req['_qa_grant_operation']=digest(binding({k:v for k,v in self.req.items() if not k.startswith('_')}))
        self.pin=patch.object(R,'BUDGET_RAW',hashlib.sha256(self.limits.read_bytes()).hexdigest());self.pin.start();self.addCleanup(self.pin.stop)
    def charge(self):return R.charge_grant(self.q,self.req,self.budget,self.root,self.S)
    def test_exact_charge_uses_existing_ledger_once_without_cap_change_or_refund(self):
        raw=self.limits.read_bytes();self.assertEqual(self.budget.remaining('agy','qa','slot2'),0)
        self.charge();self.assertEqual(self.budget.used('agy','qa','slot2'),3);self.assertEqual(self.limits.read_bytes(),raw)
        with self.assertRaises(FileExistsError):self.charge()
        with self.assertRaises(self.S.Hold):self.budget.charge('slot2','agy','qa')
    def test_no_leak_to_slot_role_task_or_ordinary_qa(self):
        for field,value in [('slot','slot1'),('stage','qa'),('_task_hash','f'*64),('issue',230),('_qa_grant_operation','f'*64)]:
            with self.subTest(field=field),patch.dict(self.req,{field:value}),self.assertRaises(Refused):self.charge()
        self.assertFalse((self.root/'antigravity-29-one-shot-charge.json').exists())
    def test_crash_after_intent_consumes_even_without_ledger_charge(self):
        with patch.object(self.S.Budget,'charge',side_effect=OSError('crash')):
            with self.assertRaises(OSError):self.charge()
        with self.assertRaises(FileExistsError):self.charge()
        self.assertEqual(self.budget.used('agy','qa','slot2'),2)
    def test_budget_pin_drift_refuses_before_intent(self):
        self.limits.write_text('{}')
        with self.assertRaises(Refused):self.charge()
        self.assertFalse((self.root/'antigravity-29-one-shot-charge.json').exists())

class ClosedInstaller(unittest.TestCase):
    def test_mode_owns_new_paths_and_preserves_legacy_modes(self):
        from test_actions_train_antigravity_upgrade import U
        keys=('ONE_SHOT','RECOVERY','JOURNAL','BACKUP','OLD','ALLOWED')
        with patch.multiple(U,**{k:getattr(U,k) for k in keys}):
            oldjournal=U.JOURNAL;U.one_shot_mode()
            self.assertTrue(U.ONE_SHOT);self.assertTrue(U.RECOVERY)
            self.assertNotEqual(U.JOURNAL,oldjournal)
            self.assertNotEqual(U.JOURNAL,U.PATCH_PARENT)
            self.assertEqual(U.OLD,'6efeca2391bff566e1aec980847b0322bc7f206f')
            self.assertEqual(U.ALLOWED,U.RECOVERY_ALLOWED)
    def test_closed_configuration_preserves_exact_budget_and_requires_all_pins(self):
        from test_actions_train_antigravity_upgrade import U
        q=descriptor();modules={name:'d'*64 for name in ('native_antigravity.py','native_guard.py')}
        marker=dict(schema='GB_ANTIGRAVITY_QA_29_V1',phase='canary',slot='slot2',executor_uid=978,
                    adapter_revision=q['adapter_revision'],qualification=q,canary_task_sha256=q['task_sha256'],modules=modules)
        proof=dict(schema='GB_AGY_ONE_SHOT_PROOF_29_V1',reviewed=True,marker=marker,
                   baseline_marker_sha256=U.PATCH_MARKER_SHA,
                   baseline_inventory_sha256='0ef1ec368d9402b279f46636927c069afb017a0892675b3f3cf7047ed747e281',
                   parent_journal_sha256='b445479d6de88d6a66806ae897327e613c095f6342548c35a718e114b603c5ac')
        budget={'providers':{'agy':{'qa':2}},'slots':{'slot2':{'agy':{'qa':2}}}}
        def sha(path):
            if path==U.MARKER:return U.PATCH_MARKER_SHA
            if path==U.BUDGET:return R.BUDGET_RAW
            return proof['baseline_inventory_sha256'] if path.name=='backup.json' else proof['parent_journal_sha256']
        with tempfile.TemporaryDirectory() as t,patch.object(U,'STATE',Path(t)),patch.object(U.i,'sha',side_effect=sha),patch.object(U,'recovery_module',return_value=R),patch.object(R,'grant_history'),patch.object(U.r,'journal',return_value={}),patch.object(U.r,'atomic') as writes:
            self.assertEqual(U.one_shot_configuration(proof,budget,modules),(marker,budget))
            for key,value in [('unknown',1),('baseline_marker_sha256','f'*64),('baseline_inventory_sha256','f'*64),('parent_journal_sha256','f'*64)]:
                with self.subTest(key=key),self.assertRaises(Refused):U.one_shot_configuration(proof|{key:value},budget,modules)
            (Path(t)/R.GRANT_LEDGER).touch()
            with self.assertRaises(Refused):U.one_shot_configuration(proof,budget,modules)
            writes.assert_not_called()
    def test_acceptance_requires_new_transport_mode_and_checkpoint_evidence(self):
        q=descriptor();receipt=dict(qualification_grant=q['qualification_grant'],input_transport='stream-json',
            input_delivery='written',requested_permission_mode='always-proceed',effective_permission_mode='always-proceed',
            semantic_input_bytes=200000,stdin_bytes=201000,semantic_input_sha256='d'*64,stdin_sha256='e'*64,
            qualification_task_sha256=q['task_sha256'],source_sha=q['head'],base_sha=q['base'],
            qualification_lineage={'adapter_revision':q['adapter_revision']},qualification_passed=True,charged_calls=1,effective_model=N.MODEL)
        op=dict(task_hash=q['task_sha256'],binding=dict(stage='qa_qualification',issue=29,slot='slot2',head=q['head']),before=R.CHECKPOINT,after=R.CHECKPOINT,finished_at=1,
                result=dict(status='confirmed',qualification_passed=True,checkpoint_changed=False,qa=dict(verdict='PASS',reviewed_sha=q['head']),native_receipt=receipt))
        self.assertTrue(R.acceptance_match(op,q))
        self.assertFalse(R.acceptance_match({'task_hash':R.SECOND_TASK},q))
        for field,value in [('input_delivery','prepared'),('effective_permission_mode','request-review'),('effective_model','claude-opus-5-5-high'),('stdin_sha256','')]:
            bad=copy.deepcopy(op);bad['result']['native_receipt'][field]=value
            with self.subTest(field=field),self.assertRaises(Refused):R.acceptance_match(bad,q)
    def test_exact_acceptance_promotes_only_normal_agy_qa_after_receipt(self):
        from test_actions_train_antigravity_upgrade import U
        q=descriptor();marker=dict(phase='canary',qualification=q)
        budget={'providers':{'agy':{'qa':2},'codex':{'author':3}},'slots':{'slot1':{'codex':{'author':1}},'slot2':{'agy':{'qa':2}}}}
        receipt=dict(qualification_grant=q['qualification_grant'],input_transport='stream-json',input_delivery='written',requested_permission_mode='always-proceed',effective_permission_mode='always-proceed',semantic_input_bytes=10,stdin_bytes=20,semantic_input_sha256='d'*64,stdin_sha256='e'*64,qualification_task_sha256=q['task_sha256'],source_sha=q['head'],base_sha=q['base'],qualification_lineage={'adapter_revision':q['adapter_revision']},qualification_passed=True,charged_calls=1,effective_model=N.MODEL)
        op=dict(task_hash=q['task_sha256'],binding=dict(stage='qa_qualification',issue=29,slot='slot2',head=q['head']),before=R.CHECKPOINT,after=R.CHECKPOINT,finished_at=1,run=123,result=dict(status='confirmed',qualification_passed=True,checkpoint_changed=False,qa=dict(verdict='PASS',reviewed_sha=q['head']),native_receipt=receipt))
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);mp=root/'marker';bp=root/'budget';jp=root/'upgrade'
            data={mp:marker,bp:budget};writes=[]
            def atomic(path,value,**kw):data[path]=copy.deepcopy(value);writes.append(path)
            j=dict(phase='active-canary',controller='c'*40,canary_task_sha256=q['task_sha256'],changes={str(mp):{'after':U.encoded_hash(marker)}})
            with patch.multiple(U,ONE_SHOT=True,RECOVERY=True,ENTRYPOINT_PATCH=False,MARKER=mp,BUDGET=bp,JOURNAL=jp,PATCH_BUDGET_SHA=U.encoded_hash(budget)),patch.object(U,'recovery_module',return_value=R),patch.object(U.r,'journal',return_value=dict(pending=None,operations={'new':op})),patch.object(U.r,'checkpoint',return_value=({'active':None},None)),patch.object(U.r,'free_lock'),patch.object(U.r,'read',side_effect=lambda p,*a:copy.deepcopy(data[p])),patch.object(U.r,'atomic',side_effect=atomic),patch.object(U.r,'publish_monitor'):
                self.assertEqual(U.accept_canary(j,dict(mode='active',controller_sha='c'*40))['phase'],'active-ready')
            expected=copy.deepcopy(budget);expected['providers']['agy']['qa']='unlimited';expected['slots']['slot2']['agy']['qa']='unlimited'
            self.assertEqual(data[bp],expected)
            self.assertEqual(j['normal_qa_budget_sha256'],U.encoded_hash(expected))
            self.assertEqual(data[mp]['accepted_canary']['operation'],'new')
            self.assertTrue(all(p in (mp,bp,jp) for p in writes))

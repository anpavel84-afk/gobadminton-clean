"""Offline #218 source preparation. No provider/hosted/runtime calls."""
import copy
import datetime as dt
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from test_actions_train import core, stage, A, S, HEAD, BASE, TASK, req, card, issue, NOW
import test_actions_train_stages as Fixtures
import failure_diagnosis as F

POLICY = dict(schema=F.SCHEMA, route=F.ROUTE, max_calls=3)

def brief():
    return dict(kind='source_defect', confidence='confirmed', diagnosis='Parser misses digits',
                evidence=['qa:findings:0'], changes=['Fix parser and preserve assertions'],
                paths=TASK['allowed_paths'], tests=['Regression fails on old parser'],
                risks=['Other formats'], missing_inputs=[],
                author_route='codex:gpt-6.1-sol:high', recheck='Fresh independent QA and exact CI')

class FailureLoop(unittest.TestCase):
    run_stage = Fixtures.StageBoundaries.run_stage
    # Reuse fixtures, not inherited generic tests.
    def setUp(self):
        Fixtures.StageBoundaries.setUp(self)
        self.bridge.clean=Mock()
        self.bridge.failed_ci=lambda a:a.get('deterministic_failure') or a.get('ci_failure')
        self.bridge.routing_receipts=[]
        self.bridge.model=Mock(return_value=brief())
        self.rt.slot='slot1'
        a=self.store.data['active']
        a['task']['failure_diagnosis']=copy.deepcopy(POLICY)
        a.update(phase='qa',qa=dict(verdict='FAIL',findings=['Parser misses digits'],reviewed_sha=HEAD))
        self.selection=patch.object(core,'diagnosis_route',return_value=dict(
            provider='codex',role='failure_diagnosis',effective_model='gpt-6-astra',
            requested_model='gpt-6-astra',effort='high'))
        self.selection.start()
    def tearDown(self):
        self.selection.stop()
        Fixtures.StageBoundaries.tearDown(self)
    def test_semantic_fail_brief_before_repair_fresh_candidate(self):
        a=self.store.data['active']
        self.assertEqual(core.next_stage(a),'failure_diagnosis')
        with self.assertRaisesRegex(core.Refused,'brief required'):
            self.run_stage('author')
        self.assertNotIn('author',self.bridge.calls)
        result=self.run_stage('failure_diagnosis')
        self.assertEqual(result['status'],'confirmed')
        self.bridge.model.assert_called_once()
        self.assertTrue(self.bridge.model.call_args.kwargs['qa'])
        self.assertEqual(a['attempt'],1)
        self.assertEqual(core.next_stage(a),'author')
        self.run_stage('author')
        self.assertEqual(a['attempt'],2)
        self.assertEqual(a['head'],'c'*40)
        self.assertIsNone(a['qa']);self.assertIsNone(a['ci'])
        self.assertEqual(core.next_stage(a),'publish')
    def test_cached_duplicate_never_calls_again_or_charges(self):
        self.run_stage('failure_diagnosis')
        before=copy.deepcopy(self.store.data)
        r=self.run_stage('failure_diagnosis')
        self.assertTrue(r['cached'])
        self.assertEqual(self.store.data,before)
        self.bridge.model.assert_called_once()
    def test_new_finding_same_sha_invalidates_and_supplies_prior_brief(self):
        self.run_stage('failure_diagnosis')
        a=self.store.data['active'];a['qa']['findings']=['New coverage regression']
        self.assertEqual(core.next_stage(a),'failure_diagnosis')
        with self.assertRaises(core.Refused):F.repair(a,self.api)
        self.run_stage('failure_diagnosis')
        self.assertEqual(self.bridge.model.call_count,2)
        self.assertEqual(a['failure_diagnosis']['calls'],2)
        self.assertIn('Parser misses digits',self.bridge.model.call_args.args[0])
    def test_changed_candidate_new_failure_requires_new_diagnosis(self):
        self.run_stage('failure_diagnosis')
        a=self.store.data['active'];a.update(head='f'*40,attempt=2)
        a['qa']['reviewed_sha']='f'*40
        self.assertEqual(core.next_stage(a),'failure_diagnosis')
        self.run_stage('failure_diagnosis')
        self.assertEqual(self.bridge.model.call_count,2)
    def test_infra_no_model_no_author_attempt(self):
        for message in ('Authentication unauthorized','Quota exhausted','environment NOT_TESTED','timeout unknown process'):
            a=self.store.data['active'];a['qa']['findings']=[message]
            with self.assertRaises(core.Refused):self.run_stage('failure_diagnosis')
        self.bridge.model.assert_not_called()
        self.assertEqual(a['attempt'],1)
        self.assertNotIn('failure_diagnosis',a)
    def test_authentication_source_defect_is_not_relabelled_infrastructure(self):
        self.store.data['active']['qa']['findings']=['Authentication lets unauthorized users access records']
        self.run_stage('failure_diagnosis')
        self.bridge.model.assert_called_once()
    def test_provider_unavailable_no_reservation_or_downshift(self):
        with patch.object(core,'diagnosis_route',side_effect=core.Refused('Astra unavailable')):
            with self.assertRaisesRegex(core.Refused,'Astra unavailable'):self.run_stage('failure_diagnosis')
        self.bridge.model.assert_not_called()
        self.assertNotIn('failure_diagnosis',self.store.data['active'])
    def test_crash_pending_is_durable_never_replay(self):
        def lost(*args,**kwargs):
            self.assertEqual(self.store.data['active']['failure_diagnosis']['calls'],1)
            self.assertEqual(next(iter(self.store.data['active']['failure_diagnosis']['receipts'].values()))['status'],'pending')
            raise RuntimeError('unknown external process')
        self.bridge.model.side_effect=lost
        with patch.object(stage,'setup',return_value=self.context):
            result=stage.entry(req('failure_diagnosis','qa'),{})
        self.assertEqual(result['status'],'unknown')
        self.store.data=json.loads(json.dumps(self.store.data))
        with self.assertRaisesRegex(core.Refused,'never replay'):self.run_stage('failure_diagnosis')
        self.bridge.model.assert_called_once()
    def test_separate_cap_does_not_reset_author_or_create_successor(self):
        a=self.store.data['active'];a['task']['failure_diagnosis']['max_calls']=1
        self.run_stage('failure_diagnosis')
        a['qa']['findings']=['Different failure']
        with self.assertRaisesRegex(core.Refused,'cap exhausted'):self.run_stage('failure_diagnosis')
        self.assertEqual(a['attempt'],1);self.assertEqual(a['task']['max_attempts'],3)
        a['attempt']=3
        self.assertEqual(core.next_stage(a),'author')
        with self.assertRaisesRegex(core.Refused,'attempts exhausted'):self.run_stage('author')
        self.assertEqual(self.bridge.model.call_count,1)
    def test_non_source_brief_blocks_content_repair(self):
        self.bridge.model.return_value=brief()|dict(kind='insufficient',missing_inputs=['exact reproduction'])
        self.run_stage('failure_diagnosis')
        with self.assertRaises(core.Refused):self.run_stage('author')
        self.assertNotIn('author',self.bridge.calls)
        with self.assertRaises(core.Refused):self.run_stage('failure_diagnosis')
        self.bridge.model.assert_called_once()
    def test_brief_hash_scope_route_and_evidence_tamper_refused(self):
        for change in (dict(paths=['scripts/control.py']),dict(author_route='cursor:auto'),
                       dict(evidence=['ci:999']),dict(tests=[])):
            self.bridge.model.return_value=brief()|change
            self.store.data['active'].pop('failure_diagnosis',None)
            with self.assertRaises(core.Refused):self.run_stage('failure_diagnosis')
        self.store.data['active'].pop('failure_diagnosis',None)
        self.bridge.model.return_value=brief()
        self.run_stage('failure_diagnosis')
        r=next(iter(self.store.data['active']['failure_diagnosis']['receipts'].values()))
        r['brief']['changes']=['tampered']
        with self.assertRaises(core.Refused):F.repair(self.store.data['active'],self.api)
    def test_ci_fail_exact_log_binding_and_repair(self):
        a=self.store.data['active']
        failure=dict(head=HEAD,run=999,run_attempt=1,failed=[dict(job='source (web)',steps=['test:unit'])])
        a.update(phase='pr_wait',qa=None,deterministic_failure=failure)
        evidence=[dict(head=HEAD,run=999,run_attempt=1,job=123,log=dict(sha256='a'*64,excerpt='AssertionError Expected: 2 Received: 0'))]
        self.bridge.model.return_value=brief()|dict(evidence=['ci:0'])
        with patch('recovery.ci_evidence',return_value=evidence):
            self.run_stage('failure_diagnosis')
            self.assertEqual(F.repair(a,self.api)['assertion_evidence'],evidence)
            evidence[0]['log']['excerpt']='AssertionError Expected: 3 Received: 0'
            with self.assertRaises(core.Refused):F.repair(a,self.api)
            self.run_stage('failure_diagnosis')
        self.assertEqual(self.bridge.model.call_count,2)
    def test_ci_environment_without_source_assertion_no_call(self):
        a=self.store.data['active'];a.update(phase='ci',ci_failure=dict(head=HEAD,run=999,run_attempt=1))
        with patch('recovery.ci_evidence',return_value=[dict(head=HEAD,log=dict(excerpt='Error: authentication quota exhausted'))]):
            with self.assertRaises(core.Refused):self.run_stage('failure_diagnosis')
        self.bridge.model.assert_not_called()
    def test_independent_other_slot_continues_with_diagnosis_pending(self):
        first=card(self.store.data['active'])
        first['pending']=dict(status='unknown',recoverable=False,binding=core.binding(req('failure_diagnosis','qa')))
        second=card(copy.deepcopy(self.store.data['active']))
        second['active']['issue']=201
        second['active']['task']['allowed_paths']=['apps/api/src/other.ts']
        planned=core.plan(A,S,dict(slots=dict(slot1=first,slot2=second)),[])
        self.assertEqual([(p['slot'],p['stage']) for p in planned],[('slot2','failure_diagnosis')])

class ProspectiveAndRoute(unittest.TestCase):
    def test_closed_finite_policy_and_historical_unchanged(self):
        a=dict(task=copy.deepcopy(TASK),phase='qa',attempt=1,qa=None,head=HEAD)
        self.assertEqual(F.next_stage(a),'author')
        F.policy(TASK|dict(failure_diagnosis=POLICY))
        for p in (POLICY|dict(max_calls=0),POLICY|dict(max_calls=True),
                  POLICY|dict(max_calls=4),POLICY|dict(route='codex:gpt-6.1-sol:high'),
                  POLICY|dict(unlimited=True)):
            with self.assertRaises(core.Refused):F.policy(TASK|dict(failure_diagnosis=p))
    @patch('cost_policy.EPOCH','2100-01-01T00:00:00+00:00')
    def test_admission_validates_supported_optional_field(self):
        t=TASK|dict(failure_diagnosis=POLICY)
        self.assertEqual(A.validate_issue(issue(task=t),NOW-dt.timedelta(days=1)),t)
        with self.assertRaises(A.Hold):
            A.validate_issue(issue(task=TASK|dict(failure_diagnosis=POLICY|dict(max_calls=999))),NOW-dt.timedelta(days=1))
    def test_astra_route_forces_high_uses_qa_qualification_and_budget(self):
        budget=Mock();budget.remaining.return_value=float('inf');budget.used.return_value=2
        slots=SimpleNamespace(MODEL_ADAPTER={'gpt-6-astra':'codex'},adapter_status=Mock(return_value=(True,'qualified')))
        result=core.diagnosis_route(slots,TASK|dict(failure_diagnosis=POLICY),budget,'slot2')
        self.assertEqual((result['role'],result['effective_model'],result['effort']),('failure_diagnosis','gpt-6-astra','high'))
        slots.adapter_status.assert_called_once_with('codex','qa',budget,'slot2')
        self.assertIsNone(result['remaining_calls'])
        slots.adapter_status.return_value=(False,'authentication unavailable')
        with self.assertRaisesRegex(core.Refused,'unavailable'):core.diagnosis_route(slots,TASK|dict(failure_diagnosis=POLICY),budget,'slot2')
    def test_actual_model_wrapper_forces_astra_readonly_and_receipts(self):
        import context_policy as C
        import test_actions_train_context as Context
        with tempfile.TemporaryDirectory(prefix='gb-218-context-') as temp:
            folder=Path(temp); calls=[0]
            active=dict(task=TASK|dict(failure_diagnosis=POLICY),head=HEAD,attempt=1,
                        failure_diagnosis=dict(calls=1,receipts={'f'*64:dict(status='pending',inputs={'head':HEAD})}))
            store=SimpleNamespace(data={'active':active})
            layout=SimpleNamespace(repo=folder,state_dir=folder,worktrees=folder,outbox=folder)
            budget=SimpleNamespace(used=lambda *_:calls[0],issue=None)
            budget.bind_issue=lambda issue: setattr(budget,'issue',issue) or budget
            rt=SimpleNamespace(user='test',legacy=True,home=folder,key=folder/'key',layout=layout,
                check_paths=Mock(),continuity=lambda:True,lease=Mock(),budget=budget)
            a=SimpleNamespace(RUNTIME_READS=(),Store=lambda *_:store,atomic=Mock(),
                              subprocess=SimpleNamespace(Popen=Mock()))
            def factory(c,st):
                def model(prompt,qa=False):
                    self.assertTrue(qa)
                    self.assertEqual((c.model,c.effort),('gpt-6-astra','high'))
                    self.assertIn('Role: failure_diagnosis.',prompt)
                    self.assertIn(Context.TEXT,prompt)
                    calls[0]+=1
                    return brief()
                return SimpleNamespace(c=c,store=st,work=folder,git=Mock(),unchanged_issue=Mock(),model=model)
            a.Bridge=factory
            s=SimpleNamespace(Runtime=lambda *_args,**_kw:rt,uid_of=lambda _:1002,Hold=RuntimeError,
                              read_json=lambda *_args,**_kw:dict(mode='active',owned={'slot1':'x'}),
                              is_source_writer_stage=S.is_source_writer_stage)
            choice=dict(provider='codex',role='failure_diagnosis',effective_model='gpt-6-astra',
                        requested_model='gpt-6-astra',effort='high')
            with patch.object(stage,'live',return_value=(a,s)),patch.object(stage.os,'getuid',return_value=1002), \
                 patch.object(stage.os,'getgid',return_value=1002),patch.object(stage,'API',return_value=Mock()), \
                 patch.object(C,'load',return_value=Context.accepted()),patch.object(core,'diagnosis_route',return_value=choice), \
                 patch('receiver.units_quiet'),patch.object(stage,'route',side_effect=AssertionError('ordinary QA route used')):
                b=stage.setup(req('failure_diagnosis','qa'),{'codex':{'slot1':'/fake-codex'}})[-1]
                b.model('bounded failure inputs',qa=True)
                r=b.routing_receipts[0]
                self.assertEqual(r['rules_context']['role'],'failure_diagnosis')
                self.assertEqual(r['failure_fingerprint'],'f'*64)
                self.assertEqual(r['usage']['charged_calls'],1)
                self.assertIsNone(r['usage']['tokens'])
                self.assertEqual(r['diagnosis_cap'],3)
    def test_new_wire_stage_closed_no_extra_authority(self):
        core.request(req('failure_diagnosis','qa'))
        with self.assertRaises(core.Refused):core.request(req('failure_diagnosis','qa')|dict(brief='forged'))

class Recovery185Budget(unittest.TestCase):
    def fixture(self, used=2):
        import test_actions_train_recovery as Fixtures185
        import recovery as R
        entry=Fixtures185.terminal()
        entry['snapshot']['task']['failure_diagnosis']=copy.deepcopy(POLICY)
        entry['snapshot']['failure_diagnosis']=dict(calls=used,receipts={})
        config=Fixtures185.config(entry);journal=R.empty()
        key=R.enroll(journal,entry,'slot1',config)
        request=req('diagnose','qa')|dict(issue=177,attempt=3)
        return R,entry,config,journal,key,request
    def reserve(self, R,entry,config,journal,key,request):
        with patch.object(core,'API',return_value=Mock()):
            return R.reserve(journal,request,config)
    def test_185_diagnosis_consumes_inherited_cap_without_modifying_frozen(self):
        R,entry,config,j,key,r=self.fixture()
        original=copy.deepcopy(j['receipts'][key]['frozen'])
        _,reserved=self.reserve(R,entry,config,j,key,r)
        self.assertEqual(reserved['failure_diagnosis']['calls'],3)
        self.assertEqual(reserved['counts'],dict(diagnose=1,task_review=0,successor=0))
        self.assertEqual(reserved['frozen'],original)
        self.assertFalse(reserved['diagnosis_cached'])
        self.assertEqual(next(iter(reserved['failure_diagnosis']['receipts'].values()))['status'],'pending')
        with self.assertRaises(core.Refused):self.reserve(R,entry,config,j,key,r)
        result=R.finish(j,key,'diagnose',dict(status='unknown',reason='lost model'),config)
        self.assertEqual(result['status'],'needs-owner')
        self.assertEqual(result['failure_diagnosis']['calls'],3)
    def test_exhausted_218_cap_cannot_buy_extra_185_astra_call(self):
        R,entry,config,j,key,r=self.fixture(3)
        with self.assertRaisesRegex(core.Refused,'cap exhausted'):self.reserve(R,entry,config,j,key,r)
        self.assertEqual(j['receipts'][key]['counts']['diagnose'],0)
    def test_exact_cached_astra_brief_reused_by_185_without_extra_call(self):
        R,entry,config,j,key,r=self.fixture(3)
        active=entry['snapshot']
        value=F.inputs(active,Mock())
        outcome=brief()
        active['failure_diagnosis']['receipts'][core.digest(value)]=dict(
            status='ready',inputs=copy.deepcopy(value),input_hash=core.digest(value),
            brief=outcome,brief_hash=core.digest(outcome),routing={'effective_model':'gpt-6-astra'})
        # The cached brief exists before terminal enrollment, as on the real path.
        from test_actions_train_recovery import config as recovery_config
        config=recovery_config(entry);j=R.empty();key=R.enroll(j,entry,'slot1',config)
        _,reserved=self.reserve(R,entry,config,j,key,r)
        self.assertTrue(reserved['diagnosis_cached'])
        self.assertEqual(reserved['failure_diagnosis']['calls'],3)
        result=R.finish(j,key,'diagnose',dict(status='confirmed',outcome=F.recovery_outcome(outcome),
                          evidence=[],repair_brief=outcome,routing={'effective_model':'gpt-6-astra'}),config)
        self.assertEqual(result['status'],'task_review_ready')
        self.assertEqual(result['proposal']['max_attempts'],2)
        self.assertEqual(result['failure_diagnosis']['calls'],3)
        self.assertEqual(result['proposal']['failure_diagnosis'],POLICY)

if __name__=='__main__':unittest.main()

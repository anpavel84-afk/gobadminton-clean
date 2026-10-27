"""One actual QA call after proven no-call route refusal; never reset/replay a model."""
import copy,json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock,patch
from test_actions_train import A,HEAD,active,core,receiver,req
import test_actions_train as base_tests
import qa_recovery as q

REASON='no safe role-specific provider: '+json.dumps({'codex:gpt-6-astra:high':'daily budget exhausted'})
BUDGET={'schema':1,'providers':{'codex':{'qa':'unlimited'}},'slots':{'slot1':{'codex':{'qa':'unlimited'}}}}

def fixture():
    from actions_train_plan_fixtures import planned_task
    state={'active':active('pr_wait'),'done':[]}
    state['active']['task'] = planned_task(state['active']['task'])
    expected=core.digest(state)
    r=req('qa','pr_wait');key=core.digest(core.binding(r))
    row={'before':expected,'after':expected,'started_at':1,'finished_at':2,
         'process':{'pid':900000,'start':'0','boot':'old'},'run':98,'run_attempt':1,
         'result':{'status':'unknown','reason':REASON,'safe_release':False}}
    op=copy.deepcopy(row)|{'binding':core.binding(r),'recovery_attempts':1,'recovery_history':[copy.deepcopy(row)]}
    j=dict(generation=0,operations={},pending=None,deferred=[],last=None,stage_counts={});j['pending']=key;j['operations'][key]=op
    return state,j,op,r

class Candidate(unittest.TestCase):
    def test_exact_known_no_call_requires_both_unlimited_limits(self):
        state,j,op,r=fixture();before=copy.deepcopy(j)
        self.assertTrue(q.preflight_candidate(j,state,lambda _:False))
        self.assertTrue(q.preflight_unlimited(j,BUDGET));self.assertEqual(j,before)
        for side in ['providers','slots']:
            b=copy.deepcopy(BUDGET)
            (b['providers']['codex'] if side=='providers' else b['slots']['slot1']['codex'])['qa']=31
            self.assertFalse(q.preflight_unlimited(j,b))
    def test_evidence_counter_history_model_and_drift_fail_closed(self):
        for field,value in [('recovery_attempts',0),('recovery_attempts',2),('budget_preflight_used',{'at':3}),('before','drift'),('after','drift')]:
            state,j,op,_=fixture();op[field]=value
            self.assertFalse(q.preflight_candidate(j,state,lambda _:False))
        for field,value in [('routing',{}),('model_calls',[]),('usage',{'charged_calls':0})]:
            state,j,op,_=fixture();op['result'][field]=value
            self.assertFalse(q.preflight_candidate(j,state,lambda _:False))
        state,j,op,_=fixture();op['recovery_history'][0]['result']['model_calls']=[{'usage':{'charged_calls':1}}]
        self.assertFalse(q.preflight_candidate(j,state,lambda _:False))
        state,j,op,_=fixture();state['active']['head']='c'*40
        self.assertFalse(q.preflight_candidate(j,state,lambda _:False))
        state,j,op,_=fixture();self.assertFalse(q.preflight_candidate(j,state,lambda _:True))
    def test_provider_auth_unknown_parse_or_other_route_are_not_preflight(self):
        for reason in ['BLOCKED: model authentication rejected (401/unauthorized)','provider quota exhausted','codex qa quota UNKNOWN; refusing model call',REASON+'x',REASON.replace('daily budget exhausted','rate limit'),REASON.replace('gpt-6-astra','gpt-6.1-sol')]:
            state,j,op,_=fixture();op['result']['reason']=reason
            self.assertFalse(q.preflight_candidate(j,state,lambda _:False))
    def test_internal_flag_cannot_be_submitted_over_wire(self):
        with self.assertRaises(core.Refused):core.request(req('qa','pr_wait')|{'_budget_preflight_retry':True})

class RootGate(unittest.TestCase):
    def setUp(self):
        self.h=base_tests.Journal();self.h.setUp();self.state,self.j,self.op,self.request=fixture()
        self.h.state['active']=self.state['active']
        receiver.atomic(self.h.folder/'slot1.json',self.j)
        self.budget=self.h.folder/'budget.json';self.budget.write_text(json.dumps(BUDGET))
        self.patches=[patch.object(receiver,'BUDGET',self.budget),patch.object(receiver,'alive',return_value=False)]
        for p in self.patches:p.start()
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.h.tearDown()
    def test_marker_history_and_counter_are_durable_before_fork_and_once_only(self):
        oldhistory=copy.deepcopy(self.op['recovery_history'])
        def before_fork():
            j=receiver.read(self.h.folder/'slot1.json');op=j['operations'][j['pending']]
            self.assertEqual(op['recovery_attempts'],2);self.assertTrue(op['budget_preflight_used'])
            self.assertEqual(op['recovery_history'][:1],oldhistory);self.assertEqual(len(op['recovery_history']),2)
            return 999999
        receiver.os.fork.side_effect=before_fork
        result=receiver.handle(self.request|{'run':101},self.h.policy)
        self.assertEqual(result['status'],'running');self.assertEqual(receiver.os.fork.call_count,1)
        self.assertEqual(receiver.handle(self.request|{'run':102},self.h.policy)['status'],'unknown')
        self.assertEqual(receiver.os.fork.call_count,1)
    def test_finite_budget_does_not_extend_the_existing_ceiling(self):
        b=copy.deepcopy(BUDGET);b['providers']['codex']['qa']=31;self.budget.write_text(json.dumps(b))
        self.assertEqual(receiver.handle(self.request|{'run':101},self.h.policy)['status'],'unknown')
        receiver.os.fork.assert_not_called()

class Reuse(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory();self.root=Path(self.t.name);self.work=self.root/'qa';self.work.mkdir()
        self.primary=self.root/'primary.json';self.receipt=self.root/'result.json';self.a={'head':HEAD}
        self.head=HEAD;self.branch='HEAD';self.status='';self.registered=True
        self.b=Mock();self.b.git.side_effect=self.git
    def tearDown(self):self.t.cleanup()
    def git(self,*args,**kwargs):
        if args==('worktree','list','--porcelain'):return 'worktree '+str(self.work) if self.registered else ''
        if args==('rev-parse','HEAD'):return self.head
        if args==('rev-parse','--abbrev-ref','HEAD'):return self.branch
        if args[0]=='status':return self.status
        return str(self.root/args[-1])
    def check(self):q.reuse_unused(A,self.b,self.work,self.a,self.primary,self.receipt)
    def test_pristine_registered_detached_worktree_is_reused_without_deletion(self):
        self.check();self.assertTrue(self.work.is_dir())
    def test_dirty_attached_wrong_head_and_unregistered_are_refused(self):
        for field,value in [('status','?? surprise'),('branch','some-branch'),('head','c'*40),('registered',False)]:
            before=getattr(self,field);setattr(self,field,value)
            with self.assertRaises(core.Refused):self.check()
            setattr(self,field,before)
    def test_prior_result_current_sha_receipt_and_git_operation_are_refused(self):
        for target,content in [(self.receipt,'{}'),(self.primary,json.dumps({'reviewed_sha':HEAD})),(self.root/'MERGE_HEAD',HEAD)]:
            target.write_text(content)
            with self.assertRaises(core.Refused):self.check()
            target.unlink()
    def test_symlink_worktree_is_refused(self):
        self.work.rmdir();self.work.symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(core.Refused):self.check()

if __name__=='__main__':unittest.main()

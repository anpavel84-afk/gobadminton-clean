"""Closed Owner-authenticated #29 grants: negative and compatibility regressions."""
import contextlib
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'actions_train'))
import antigravity_qa_recovery as Q
import native_antigravity as N
import owner_package_admission as A
from core import digest, Refused

COMMENT=6381122334
CONTROLLER='e02436862e606b61e4d2e2187bf25a205586426f'

def grant(role,comment=COMMENT):
    revision,path,sha=A.EXPECTED_PINS[role]
    return dict(schema=Q.ADDRESSED_SCHEMA,lineage=Q.ADDRESSED_LINEAGE,
                owner_comment=comment,role=role,controller_revision=CONTROLLER,
                cli_sha256=N.AGY_SHA256,rules_sha256=A.RULES,
                base=A.SOURCE_BASE,head=A.SOURCE_HEAD,input_revision=revision,
                input_path=path,input_sha256=sha,timeout=1800,
                max_output_bytes=N.MAX_OUT,permission_mode=N.PERMISSION_MODE,
                input_transport='stream-json',ceiling=1)

def ledger():
    gs=[grant('technical_pm_product_analyst'),grant('independent_qa')]
    return dict(schema=Q.OWNER_PACKAGE_SCHEMA,owner_comment=COMMENT,
                owner_id=318610566,issue=29,controller_sha=CONTROLLER,
                rules_sha256=A.RULES,source_base=A.SOURCE_BASE,
                source_head=A.SOURCE_HEAD,body_sha256='f'*64,ceiling=2,
                used_calls=0,grants={digest(g):dict(grant=g,operation=None) for g in gs},
                previous_addressed_sha256=A.HIST,
                previous_supplement_sha256=A.SUP)

class Response:
    status=200
    def __init__(self,data):self.data=json.dumps(data).encode()
    def __enter__(self):return self
    def __exit__(self,*_):return False
    def read(self,_):return self.data

class QuiescentTests(unittest.TestCase):
    def setUp(self):
        stack=contextlib.ExitStack();self.addCleanup(stack.close)
        self.journals={slot:dict(pending=None,generation=96,operations={
            Q.OWNER_PACKAGE_ORIGINAL_UNKNOWN:dict(status='unknown')})
            for slot in ('slot1','slot2')}
        self.states={slot:dict(active=None,done=[]) for slot in self.journals}
        for name,value in (('STATE',Path('/synthetic/state')),
                           ('AUTONOMY',Path('/synthetic/autonomy')),
                           ('POLICY',Path('/synthetic/policy.json')),
                           ('BUDGET',Path('/synthetic/budget.json'))):
            stack.enter_context(patch.object(A.R,name,value))
        stack.enter_context(patch.object(A.R,'read',return_value=dict(
            mode='active',controller_sha=CONTROLLER)))
        stack.enter_context(patch.object(A.R,'journal',side_effect=self.journals.__getitem__))
        stack.enter_context(patch.object(A.R,'checkpoint',side_effect=lambda slot:(self.states[slot],[])))
        self.no_models=stack.enter_context(patch.object(A.R,'no_models'))
        stack.enter_context(patch.object(A.R,'units_quiet'))
        self.free_lock=stack.enter_context(patch.object(A.R,'free_lock'))
        stack.enter_context(patch.object(Path,'exists',return_value=False))
        stack.enter_context(patch.object(A,'sha',side_effect={
            A.R.STATE/Q.ADDRESSED_LEDGER:A.HIST,
            A.R.STATE/Q.SUPPLEMENT_LEDGER:A.SUP,
            A.R.BUDGET:A.BUDGET,
            '/usr/local/lib/gb-actions-train/accepted-engineering-rules.md':A.RULES,
        }.__getitem__))
        stack.enter_context(patch.object(Q,'OWNER_PACKAGE_ORIGINAL_UNKNOWN_DIGEST',
            digest(dict(status='unknown'))))

    def test_idle_none_and_done_in_both_slots(self):
        for first in (None,dict(phase='done',issue=313)):
            for second in (None,dict(phase='done',issue=29)):
                with self.subTest(slot1=first,slot2=second):
                    self.states['slot1']['active']=first
                    self.states['slot2']['active']=second
                    self.assertIs(A.quiescent(CONTROLLER),self.journals['slot2'])
        self.assertEqual(self.no_models.call_count,8)
        self.assertEqual(self.free_lock.call_count,16)

    def test_other_active_phases_refuse(self):
        for slot in self.states:
            for phase in ('claimed','developing','qa','ci','unknown','DONE'):
                with self.subTest(slot=slot,phase=phase):
                    self.states[slot]['active']=dict(phase=phase)
                    with self.assertRaisesRegex(Refused,'^slot occupied$'):A.quiescent(CONTROLLER)
            self.states[slot]['active']=None

    def test_non_dict_or_missing_phase_refuses(self):
        for slot in self.states:
            for active in (False,0,'','done',[],['done'],{},dict(issue=313),dict(phase=None)):
                with self.subTest(slot=slot,active=active):
                    self.states[slot]['active']=active
                    with self.assertRaisesRegex(Refused,'^slot occupied$'):A.quiescent(CONTROLLER)
            self.states[slot]['active']=None

    def test_pending_always_refuses(self):
        for slot in self.states:
            for active in (None,dict(phase='done',issue=313)):
                for pending in ('operation',{},False,0,''):
                    with self.subTest(slot=slot,active=active,pending=pending):
                        self.states[slot]['active']=active
                        self.journals[slot]['pending']=pending
                        with self.assertRaisesRegex(Refused,'^slot occupied$'):A.quiescent(CONTROLLER)
            self.states[slot]['active']=None;self.journals[slot]['pending']=None

class OwnerPackageTests(unittest.TestCase):
    def test_dynamic_package_enrollment_pins(self):
        for role in A.EXPECTED_PINS: self.assertEqual(Q.validate_addressed_grant(grant(role),enrollment=True),grant(role))
        self.assertFalse(Q.owner_package(grant('independent_qa',Q.SUPPLEMENT_OWNER_COMMENT)))

    def test_closed_two_roles_no_overruns(self):
        l=ledger();self.assertEqual(Q.owner_package_ledger(l),l)
        for mutation in (
          lambda x:x.update(ceiling=3),
          lambda x:x.update(used_calls=1),
          lambda x:x.update(previous_addressed_sha256='0'*64),
          lambda x:x['grants'].pop(next(iter(x['grants']))),
          lambda x:x.update(controller_sha='0'*40),
          lambda x:x.update(owner_id=1),
        ):
            y=json.loads(json.dumps(l));mutation(y)
            with self.assertRaises(Exception):Q.owner_package_ledger(y)

    def test_single_spend_requires_exact_row_and_counter(self):
        l=ledger();first=next(k for k,r in l['grants'].items()
             if r['grant']['role']=='technical_pm_product_analyst')
        l['grants'][first]['operation']='a'*64;l['used_calls']=1
        self.assertIs(Q.owner_package_ledger(l),l)
        l['grants'][first]['operation']='b'*64;l['used_calls']=0
        with self.assertRaises(Exception):Q.owner_package_ledger(l)

    def test_owner_comment_must_be_real_owner_and_issue(self):
        v=dict(schema=A.Q.OWNER_PACKAGE_SCHEMA,issue=29,repo_id=A.REPO_ID,
               controller_sha=CONTROLLER,rules_sha256=A.RULES,
               source_base=A.SOURCE_BASE,source_head=A.SOURCE_HEAD,model=N.MODEL,
               max_calls=2,owner_comment=COMMENT,
               calls=[dict(role=r,input_revision=t[0],input_path=t[1],input_sha256=t[2])
                      for r,t in A.EXPECTED_PINS.items()])
        body=A.PREFIX+json.dumps(v,sort_keys=True,separators=(',',':'))
        data=dict(id=COMMENT,issue_url=A.ISSUE_URL,
                  user=dict(id=318610566,login='anpavel84-afk'),
                  author_association='OWNER',body=body)
        with patch.object(A.urllib.request,'urlopen',return_value=Response(data)):
            b,x=A.owner_comment(COMMENT);self.assertEqual(x,v)
        for field,value in [('id',COMMENT+1),('issue_url',A.ISSUE_URL+'1'),
                            ('author_association','NONE')]:
            altered=dict(data);altered[field]=value
            with patch.object(A.urllib.request,'urlopen',return_value=Response(altered)):
                with self.assertRaises(Exception):A.owner_comment(COMMENT)
        altered=dict(data,user=dict(id=12345,login='anpavel84-afk'))
        with patch.object(A.urllib.request,'urlopen',return_value=Response(altered)):
            with self.assertRaises(Exception):A.owner_comment(COMMENT)

    def test_authorize_cannot_weaken_controller_role_or_hash(self):
        v=dict(schema=Q.OWNER_PACKAGE_SCHEMA,issue=29,repo_id=A.REPO_ID,
               controller_sha=CONTROLLER,rules_sha256=A.RULES,
               source_base=A.SOURCE_BASE,source_head=A.SOURCE_HEAD,model=N.MODEL,
               max_calls=2,owner_comment=COMMENT,
               calls=[dict(role=r,input_revision=t[0],input_path=t[1],input_sha256=t[2])
                      for r,t in A.EXPECTED_PINS.items()])
        with patch.object(A,'owner_comment',return_value=('trusted',v)),patch.object(Q,'addressed_input',return_value='inert'):
            self.assertEqual(A.authorize(COMMENT,CONTROLLER)['used_calls'],0)
            for change in (
                {'max_calls':3},{'controller_sha':'0'*40},
                {'source_head':'0'*40},{'model':'unknown'},
                {'owner_comment':COMMENT+1}
            ):
                u=dict(v,**change)
                with patch.object(A,'owner_comment',return_value=('trusted',u)):
                    with self.assertRaises(Exception):A.authorize(COMMENT,CONTROLLER)
            u=dict(v,calls=[dict(v['calls'][0]),dict(v['calls'][0])])
            with patch.object(A,'owner_comment',return_value=('trusted',u)):
                with self.assertRaises(Exception):A.authorize(COMMENT,CONTROLLER)

    def test_installed_c5_comment_is_not_retargeted_by_document_pin(self):
        """Comment 6396105635 stays on installed C5 pins. A later EOM hash must not replace them."""
        comment = Q.INSTALLED_C5_COMMENT
        controller = Q.INSTALLED_C5_CONTROLLER
        self.assertEqual(comment, 6396105635)
        self.assertEqual(controller, '41e12be2d551158e97ea30eaf8e95f992f998615')
        self.assertEqual(Q.INSTALLED_C5_RULES, '017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269')
        self.assertNotEqual(Q.INSTALLED_C5_RULES, A.RULES)
        calls = [dict(role=role, input_revision=pin[0], input_path=pin[1], input_sha256=pin[2])
                 for role, pin in A.EXPECTED_PINS.items()]
        value = dict(schema=Q.OWNER_PACKAGE_SCHEMA, issue=29, repo_id=A.REPO_ID,
                     controller_sha=controller, rules_sha256=Q.INSTALLED_C5_RULES,
                     source_base=A.SOURCE_BASE, source_head=A.SOURCE_HEAD, model=N.MODEL,
                     max_calls=2, owner_comment=comment, calls=calls)
        body = A.PREFIX + json.dumps(value, sort_keys=True, separators=(',', ':'))
        data = dict(id=comment, issue_url=A.ISSUE_URL,
                    user=dict(id=318610566, login='anpavel84-afk'),
                    author_association='OWNER', body=body)
        with patch.object(A.urllib.request, 'urlopen', return_value=Response(data)), \
             patch.object(Q, 'addressed_input', return_value='inert'):
            ledger = A.authorize(comment, controller)
            self.assertEqual(A.authorize(comment, controller, existing=ledger), ledger)
        self.assertEqual(ledger['controller_sha'], controller)
        self.assertEqual(ledger['rules_sha256'], Q.INSTALLED_C5_RULES)
        for row in ledger['grants'].values():
            self.assertEqual(row['grant']['rules_sha256'], Q.INSTALLED_C5_RULES)
            self.assertEqual(row['grant']['controller_revision'], controller)
        drifted = dict(value, rules_sha256=A.RULES)
        drifted_data = dict(data, body=A.PREFIX + json.dumps(drifted, sort_keys=True, separators=(',', ':')))
        with patch.object(A.urllib.request, 'urlopen', return_value=Response(drifted_data)), \
             patch.object(Q, 'addressed_input', return_value='inert'):
            with self.assertRaises(Exception):
                A.authorize(comment, controller)
        with patch.object(A.urllib.request, 'urlopen', return_value=Response(data)), \
             patch.object(Q, 'addressed_input', return_value='inert'):
            with self.assertRaises(Exception):
                A.authorize(comment, '0' * 40)
        A.installed_rules_ok(controller, Q.INSTALLED_C5_RULES)
        with self.assertRaises(Exception):
            A.installed_rules_ok(controller, A.RULES)
        A.installed_rules_ok(CONTROLLER, A.RULES)
        with self.assertRaises(Exception):
            A.installed_rules_ok(CONTROLLER, Q.INSTALLED_C5_RULES)

if __name__=='__main__':unittest.main()

class AdmissionRepairTests(unittest.TestCase):
    def test_bootstrap_exact_task_does_not_require_future_marker(self):
        g=grant('technical_pm_product_analyst')
        with patch.object(N,'trusted',side_effect=RuntimeError('marker not yet installed')):
            q=A.exact_qualification(g,CONTROLLER)
        expected=dict(schema='GB_ANTIGRAVITY_29_ADDRESSED_TASK_V1',issue=29,
            role='technical_pm_product_analyst',slot='slot2',base=A.SOURCE_BASE,
            head=A.SOURCE_HEAD,model=N.MODEL,max_calls=1,
            adapter_revision=CONTROLLER,qualification_grant=g)
        self.assertEqual(q['task_sha256'],digest(expected))
        self.assertEqual(q['qualification_grant'],g)

    def test_separate_QA_marker_eligible_only_after_real_complete(self):
        import tempfile
        with tempfile.TemporaryDirectory() as root, patch.object(A.R,'STATE',Path(root)):
            self._separate_QA_marker()

    def _separate_QA_marker(self):
        l=ledger()
        roles={row['grant']['role']:row for row in l['grants'].values()}
        g=roles['technical_pm_product_analyst']['grant']
        q=A.exact_qualification(g,CONTROLLER)
        binding=dict(action='train',stage='qa_qualification',profile='agy',slot='slot2',issue=29,
                     phase='idle',attempt=0,generation=98,head=g['head'])
        key=digest(binding)
        roles['technical_pm_product_analyst']['operation']=key
        l['used_calls']=1
        slot={'generation':98,'pending':None,'operations':{
            key:{'run':122,'run_attempt':1,'binding':binding,'task_hash':q['task_sha256'],'qa_qualification':q,
                'finished_at':1,'before':Q.CHECKPOINT,'after':Q.CHECKPOINT,'result':{'status':'confirmed','analysis_complete':True,
                'analysis':{'completion':'COMPLETE','source_reads':[{'path':'a'},{'path':'b'}]},
                'native_receipt':{'tool_names':['view_file','run_command'],'qualification_grant':g,'qualification_task_sha256':q['task_sha256']}}}}}
        marker={'phase':'canary','executor_uid':978,
                'qualification':{'qualification_grant':grant('technical_pm_product_analyst')}}
        q,nextmarker,nextslot=A.transition_plan('qa',COMMENT,CONTROLLER,slot,marker,l)
        self.assertEqual(q['qualification_grant']['role'],'independent_qa')
        self.assertEqual(nextslot['generation'],99)
        self.assertEqual(nextmarker['qualification']['qualification_grant'],grant('independent_qa'))
        for result_update in ({'analysis_complete':False},
                {'analysis':{'completion':'INCOMPLETE','source_reads':[{'path':'a'},{'path':'b'}]}},
                {'native_receipt':{'tool_names':['view_file']}}):
            wrong=json.loads(json.dumps(slot))
            wrong['operations'][key]['result'].update(result_update)
            with self.assertRaises(Exception):A.transition_plan(
                'qa',COMMENT,CONTROLLER,wrong,marker,l)
        l['grants'][digest(grant('independent_qa'))]['operation']='b'*64
        l['used_calls']=2
        with self.assertRaises(Exception):A.transition_plan('qa',COMMENT,CONTROLLER,slot,marker,l)

    def test_existing_atomic_writes_resume_idempotently(self):
        import tempfile
        import hashlib
        with tempfile.TemporaryDirectory() as root:
            p=Path(root)/'slot2.json'
            original={'generation':96,'pending':None}
            new={'generation':97,'pending':None}
            p.write_bytes(A.encoded(original))
            before=hashlib.sha256(p.read_bytes()).hexdigest()
            after=hashlib.sha256(A.encoded(new)).hexdigest()
            A.safe_put(p,new,before,after)
            self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),after)
            A.safe_put(p,new,before,after)
            self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),after)
            p.write_text('foreign state')
            with self.assertRaises(Exception):A.safe_put(p,new,before,after)

class CrashBoundaryRepairTests(unittest.TestCase):
    def test_resume_after_every_durable_write(self):
        """Independent QA's actual 7-point failure-injection repro, now permanent."""
        import contextlib,copy,io,tempfile
        R=A.R
        real_sha=A.sha
        real_atomic=R.atomic
        for crash_at in range(1,8):
            with self.subTest(crash_after_write=crash_at):
                with tempfile.TemporaryDirectory() as root,contextlib.ExitStack() as stack:
                    root=Path(root);state=root/'state';state.mkdir()
                    policy=root/'policy.json';marker=root/'marker.json';budget=root/'budget.json'
                    original={'generation':96,'pending':None,'operations':{}}
                    real_atomic(state/'slot2.json',original)
                    real_atomic(policy,{'mode':'active','controller_sha':CONTROLLER})
                    real_atomic(marker,{'phase':'canary','executor_uid':978})
                    (state/'controller.lock').touch()
                    for obj,name,value in ((R,'STATE',state),(R,'POLICY',policy),
                                           (R,'BUDGET',budget),(N,'MARKER',marker)):
                        stack.enter_context(patch.object(obj,name,value))
                    stack.enter_context(patch.object(R,'trusted_tree'))
                    stack.enter_context(patch.object(A.os,'geteuid',return_value=0))
                    stack.enter_context(patch.object(R,'read',
                         side_effect=lambda p,*args:json.loads(p.read_bytes())))
                    stack.enter_context(patch.object(N,'trusted',
                         side_effect=lambda p:p.read_bytes()))
                    stack.enter_context(patch.object(A,'authorize',
                         side_effect=lambda *args:json.loads(json.dumps(ledger()))))
                    stack.enter_context(patch.object(A,'quiescent',
                         side_effect=lambda *args:json.loads((state/'slot2.json').read_bytes())))
                    def file_sha(p):
                        p=Path(p)
                        if p==state/Q.ADDRESSED_LEDGER:return A.HIST
                        if p==state/Q.SUPPLEMENT_LEDGER:return A.SUP
                        if p==budget:return A.BUDGET
                        return real_sha(p)
                    stack.enter_context(patch.object(A,'sha',side_effect=file_sha))
                    stack.enter_context(patch.object(A.sys,'argv',
                         ['owner_package_admission','--apply',str(COMMENT)]))
                    calls=[0]
                    def interrupted(p,v,mode=0o600):
                        real_atomic(p,v,mode)
                        calls[0]+=1
                        if calls[0]==crash_at:
                            raise RuntimeError('simulated interruption after durable write')
                    with patch.object(R,'atomic',side_effect=interrupted),contextlib.redirect_stdout(io.StringIO()):
                        with self.assertRaises(RuntimeError):
                            A.main()
                    with contextlib.redirect_stdout(io.StringIO()):
                        A.main()
                    self.assertEqual(json.loads(policy.read_bytes())['mode'],'active')
                    receipt=json.loads((state/(A.RECEIPT_PREFIX+str(COMMENT)+'.json')).read_bytes())
                    self.assertEqual(receipt['phase'],'complete')
                    self.assertEqual(json.loads((state/'slot2.json').read_bytes())['generation'],97)

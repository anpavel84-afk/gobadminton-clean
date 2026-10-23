"""Offline Issue29 failure retention and exact one-successor regressions."""
import copy,json,os,subprocess,sys,tempfile,unittest
from contextlib import contextmanager,ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'actions_train'))
import native_antigravity as N
import antigravity_qa_recovery as R
from core import digest,Refused

class Evidence(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.directory=self.root/'evidence'
    def records(self):
        paths=list(self.directory.iterdir());self.assertEqual(len(paths),1)
        self.assertEqual(paths[0].stat().st_mode&0o777,0o700)
        for f in paths[0].iterdir():self.assertEqual(f.stat().st_mode&0o777,0o600)
        return paths[0],json.loads(sorted(paths[0].glob('phase-*.json'))[-1].read_text())
    def test_private_bounded_streams_exclusive_no_follow_and_no_auth_archive(self):
        out=self.root/'output';out.mkdir();(out/'stdout').write_bytes(b'x'*(N.MAX_OUT+7));(out/'stderr').write_bytes(b'private diagnostic')
        ev=N.ReviewEvidence(self.directory,'f'*64,'a'*40,'b'*40)
        ev.streams(out);ev.record(terminal=True);ev.close();p,m=self.records()
        self.assertEqual((p/'stdout').stat().st_size,N.MAX_OUT)
        self.assertTrue(m['streams']['stdout']['truncated']);self.assertEqual(m['exit_code'],None)
        self.assertEqual(set(x.name for x in p.iterdir())-set(x.name for x in p.glob('phase-*')),{'stdout','stderr'})
        ev=N.ReviewEvidence(self.root/'other','f'*64)
        ev.write('once',b'first')
        with self.assertRaises(N.ReviewError):ev.write('once',b'replace')
        ev.close()
    def test_symlink_hardlink_and_disk_write_fail_closed(self):
        self.directory.symlink_to(self.root,target_is_directory=True)
        with self.assertRaisesRegex(N.ReviewError,'AGY_EVIDENCE_WRITE_FAILED'):N.ReviewEvidence(self.directory,'x')
        self.directory.unlink();ev=N.ReviewEvidence(self.directory,'x')
        out=self.root/'out';out.mkdir();(out/'stdout').write_text('raw');os.link(out/'stdout',out/'stderr')
        with self.assertRaisesRegex(N.ReviewError,'AGY_EVIDENCE_WRITE_FAILED'):ev.streams(out)
        with patch.object(N.os,'write',side_effect=OSError('secret disk detail')):
            # Writer uses fdopen; inject at its actual exclusive open boundary.
            with patch.object(N.os,'open',side_effect=OSError('secret disk detail')):
                with self.assertRaisesRegex(N.ReviewError,'AGY_EVIDENCE_WRITE_FAILED') as e:ev.record(phase='evidence')
        self.assertNotIn('secret',str(e.exception));ev.close()
    def invoke_case(self,kind):
        charge=Mock();seen={}
        class Process:
            pid=99999999
            returncode=None
            def communicate(self,input,timeout):
                self._input_offset=len(input)
                if kind=='timeout':raise subprocess.TimeoutExpired('SECRET_ARGV',timeout)
                self.returncode=3 if kind=='nonzero' else 0
            def wait(self):
                if self.returncode is None:self.returncode=-9
                return self.returncode
            def poll(self):return self.returncode
        def popen(argv,**kw):
            seen['home']=Path(kw['env']['HOME']);seen['temp']=seen['home'].parent
            kw['stdout'].write(b'x'*(N.MAX_OUT+1) if kind=='overflow' else b'output')
            kw['stderr'].write(b'SECRET_PRIVATE_DIAGNOSTIC');kw['stdout'].flush();kw['stderr'].flush()
            if kind in ('launch','preexec'):raise (OSError('secret launch') if kind=='launch' else subprocess.SubprocessError('secret preexec'))
            return Process()
        with patch.object(N,'qualification',return_value={'phase':'canary','adapter_revision':'a'*40}),patch.object(N.os,'geteuid',return_value=978),patch.object(N,'trusted',return_value=b'PRIVATE_AUTH'),patch.object(N,'git',return_value=b'/tmp/candidate/.git'),patch.object(N.os,'killpg'),patch.object(N,'filesystem_roots',return_value=([],[],[])):
            if kind=='success':N.invoke('SECRET_PROMPT',30,work=Path('/tmp/candidate'),slot='slot2',task_hash='f'*64,charge=charge,popen=popen,evidence_dir=self.directory)
            else:
                code={'timeout':'AGY_TIMEOUT','launch':'AGY_LAUNCH_FAILED','preexec':'AGY_LAUNCH_FAILED','nonzero':'AGY_EXIT_NONZERO','overflow':'AGY_OUTPUT_LIMIT'}[kind]
                with self.assertRaisesRegex(N.ReviewError,code) as e:N.invoke('SECRET_PROMPT',30,work=Path('/tmp/candidate'),slot='slot2',task_hash='f'*64,charge=charge,popen=popen,evidence_dir=self.directory)
                self.assertEqual(set(e.exception.public()),{'code','phase','evidence_id'})
                self.assertNotIn('SECRET',str(e.exception))
        charge.assert_called_once();p,m=self.records();self.assertEqual(m['charge_state'],'charged')
        self.assertEqual((p/'stderr').read_bytes(),b'SECRET_PRIVATE_DIAGNOSTIC');self.assertFalse(seen['temp'].exists())
        self.assertNotIn('PRIVATE_AUTH',''.join(f.read_text() for f in p.glob('phase-*')))
        self.assertTrue(m['terminal']);self.assertEqual(m['timeout'],kind=='timeout')
    def test_launch_preexec_timeout_nonzero_overflow_success(self):
        for kind in ('launch','preexec','timeout','nonzero','overflow','success'):
            with self.subTest(kind=kind):
                self.directory=self.root/('evidence-'+kind);self.invoke_case(kind)
    def test_parser_failure_retains_private_evidence_and_truthful_rules_hash(self):
        rules=('trusted',{'sha256':'d'*64})
        def invoke(*a,**kw):
            out=self.root/'outputs';out.mkdir();(out/'stdout').write_bytes(b'{malformed');(out/'stderr').write_bytes(b'private')
            kw['evidence'].streams(out)
            return b'{malformed',{'input_delivery':'written'}
        with patch.object(N,'git',side_effect=lambda work,*args:b'b'*40 if args==('rev-parse','HEAD') else b''),patch.object(N,'collect',return_value=('source',{})),patch('context_policy.inject',return_value=('final prompt',rules[1])),patch.object(N,'invoke',invoke):
            with self.assertRaisesRegex(N.ReviewError,'AGY_PARSE_FAILED'):
                N.review(Path('/tmp'),'a'*40,'b'*40,'task',30,slot='slot2',task_hash='f'*64,charge=Mock(),evidence_dir=self.directory)
        p,m=self.records();self.assertEqual((p/'stdout').read_bytes(),b'{malformed')
        self.assertEqual(m['rules_sha256'],'d'*64);self.assertEqual(m['phase'],'parse');self.assertEqual(m['error_code'],'AGY_PARSE_FAILED')
    def test_typed_error_stage_public_unknown(self):
        import stage
        err=N.ReviewError('AGY_PARSE_FAILED','parse','b'*32)
        with patch.object(stage,'setup',side_effect=err):result=stage.entry({'stage':'qa_qualification'},{})
        self.assertEqual(result,dict(status='unknown',reason='AGY_PARSE_FAILED',safe_release=False,adapter_error=err.public()))

class RunpyEntrypoint(unittest.TestCase):
    def test_actual_default_runpy_subprocess_and_ordinary_import_share_exact_contract(self):
        script=r"""
import io,runpy,sys
from contextlib import redirect_stdout
from types import SimpleNamespace
from unittest.mock import patch
import receiver
from test_actions_train_antigravity_recovery import Successor
from core import Refused
sentinel=SimpleNamespace(launcher_sentinel=True)
sys.modules['__main__']=sentinel
with patch('os.geteuid',return_value=1),patch('sys.exit') as stop,redirect_stdout(io.StringIO()):
    namespace=runpy.run_module('receiver',run_name='__main__')
stop.assert_called_once_with(1)
assert sys.modules['__main__'] is sentinel
assert not hasattr(sentinel,'STATE') and not hasattr(sentinel,'read')
for namespace in (namespace,receiver.__dict__):
    fixture=Successor();fixture.setUp()
    try:
        with fixture.date_fixture('2026-10-24') as (ordinary,budget,clock,req,fork,_):
            for name in ('STATE','read','atomic','journal','checkpoint','guard','live','identity','alive'):
                namespace[name]=getattr(ordinary,name)
            card=dict(owned=True,active=None,pending=None,generation=86)
            assert namespace['qualification_plan']({'mode':'active'},card,budget)['stage']=='qa_qualification'
            original_atomic=namespace['atomic']
            def checked_atomic(path,value):
                if path.name=='slot2.json':
                    op=next((op for op in value.get('operations',{}).values()
                             if op.get('task_hash')==fixture.q['task_sha256']),{})
                    if op.get('process') is None:assert fork.call_count==0
                else:assert fork.call_count==0
                return original_atomic(path,value)
            namespace['atomic']=checked_atomic
            assert namespace['qualification_request'](req,{})['status']=='running'
            fork.assert_called_once()
            assert fixture.data[fixture.Q.LINEAGE]['used_calls']==2
            assert namespace['qualification_plan']({'mode':'active'},card,budget) is None
            fixture.j=fixture.data['slot2.json'];clock[0]='2026-10-25'
            assert namespace['qualification_request'](req|{'run':124},{})['status']=='unknown'
            fork.assert_called_once()
    finally:fixture.doCleanups()
assert sys.modules['__main__'] is sentinel and vars(sentinel)=={'launcher_sentinel':True}
print('runpy and ordinary import PASS')
"""
        script=script.replace('fixture.Q.','R.')
        script=script.replace('import receiver','import receiver\nimport antigravity_qa_recovery as R',1)
        env=dict(os.environ,PYTHONPATH=os.pathsep.join((str(Path(__file__).parent),str(Path(__file__).parents[1]/'actions_train'))))
        result=subprocess.run([sys.executable,'-c',script],env=env,capture_output=True,text=True,timeout=30)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('runpy and ordinary import PASS',result.stdout)

class Successor(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.state={'active':None};self.q=dict(issue=29,base='a'*40,head='b'*40,work=str(N.QUALIFICATION_WORK),parent_task_sha256=R.PARENT_TASK,parent_operation=R.PARENT_OPERATION,adapter_revision='c'*40)
        self.q['task_sha256']=digest(N.qualification_task(self.q['base'],self.q['head'],**{k:self.q[k] for k in ('parent_task_sha256','parent_operation','adapter_revision')}))
        self.op=dict(task_hash=R.PARENT_TASK,run=R.PARENT_RUN,run_attempt=1,process=R.PARENT_PROCESS,before=digest(self.state),after=digest(self.state),result={'status':'unknown'})
        self.j=dict(pending=R.PARENT_OPERATION,generation=85,operations={R.PARENT_OPERATION:self.op})
        self.old={'original':'immutable'};self.data={R.FIXED:self.old};self.marker=dict(schema='GB_ANTIGRAVITY_QA_29_V1',slot='slot2',executor_uid=978,phase='canary',adapter_revision='c'*40,canary_task_sha256=self.q['task_sha256'],qualification=self.q)
        def read(path,*a):return copy.deepcopy(self.marker if str(path).startswith('/etc/') else self.data[Path(path).name])
        def atomic(path,value):Path(path).touch();self.data[Path(path).name]=copy.deepcopy(value)
        self.r=SimpleNamespace(STATE=self.root,AUTONOMY=self.root,read=read,atomic=atomic,locked=lambda p:os.open('/dev/null',os.O_RDONLY),journal=lambda slot:copy.deepcopy(self.j),checkpoint=lambda slot:(self.state,None),identity=lambda pid:dict(R.PARENT_PROCESS,start='different'),alive=Mock(return_value=False),no_models=Mock(),units_quiet=Mock(),free_lock=Mock())
        self.real_quiet=R.executor_quiet
        self.patches=[patch.object(R,'PARENT_DIGEST',digest(self.op)),patch.object(R,'PARENT_RESERVATION_DIGEST',digest(self.old)),patch.object(R,'CHECKPOINT',digest(self.state)),patch.object(R.os,'geteuid',return_value=0),patch.object(R,'executor_quiet')]
        for p in self.patches:p.start();self.addCleanup(p.stop)
    def reconcile(self):return R.reconcile_parent(self.r,self.q)
    def test_exact_successor_hash_revision_and_per_hash_reservation(self):
        self.assertEqual(N.qualification_descriptor(self.marker),self.q)
        changed=copy.deepcopy(self.marker);changed['adapter_revision']='d'*40
        with self.assertRaises(N.ReviewError):N.qualification_descriptor(changed)
        self.assertNotEqual(R.reservation_path(self.root,self.q),self.root/R.FIXED)
        altered=dict(self.q,adapter_revision='d'*40)
        self.assertNotEqual(digest(N.qualification_task(altered['base'],altered['head'],**{k:altered[k] for k in ('parent_task_sha256','parent_operation','adapter_revision')})),self.q['task_sha256'])
    def test_one_use_reconciliation_preserves_original_then_third_call_refused_even_new_day(self):
        original=copy.deepcopy(self.op);self.reconcile()
        updated=self.data['slot2.json'];self.assertIsNone(updated['pending']);self.assertEqual(updated['generation'],86)
        self.assertEqual(updated['operations'][R.PARENT_OPERATION],original);self.assertEqual(self.data[R.FIXED],self.old)
        R.reserve_lineage(self.r,self.q,'new-operation')
        with self.assertRaises(Refused):R.reserve_lineage(self.r,self.q,'third-operation')
        self.j=updated;before=copy.deepcopy(self.data);self.reconcile();self.assertEqual(self.data,before)
        self.assertEqual(self.data[R.LINEAGE]['used_calls'],2)
    def test_live_unknown_identity_checkpoint_stale_pending_and_evidence_changes_refused(self):
        for case in ('live','checkpoint','generation','pending','operation','worker'):
            with self.subTest(case=case):
                oldj=copy.deepcopy(self.j);olds=copy.deepcopy(self.state);oldidentity=self.r.identity
                if case=='live':self.r.identity=lambda p:R.PARENT_PROCESS;self.r.alive.return_value=True
                if case=='checkpoint':self.state['x']=1
                if case=='generation':self.j['generation']=84
                if case=='pending':self.j['pending']='another'
                if case=='operation':self.j['operations'][R.PARENT_OPERATION]['run']=4
                if case=='worker':self.r.free_lock.side_effect=Refused('occupied')
                with self.assertRaises(Refused):self.reconcile()
                self.assertNotIn(R.LINEAGE,self.data)
                self.j=oldj;self.state=olds;self.r.identity=oldidentity;self.r.alive.return_value=False;self.r.free_lock.side_effect=None
    def test_crash_after_intent_resumes_without_reset_or_original_rewrite(self):
        actual=self.r.atomic
        def fail(path,value):
            actual(path,value)
            if Path(path).name==R.RECONCILIATION and value['phase']=='intent':raise OSError('crash')
        self.r.atomic=fail
        with self.assertRaises(OSError):self.reconcile()
        self.r.atomic=actual;self.reconcile();self.assertEqual(self.data[R.LINEAGE]['used_calls'],1)
    def test_receiver_proposes_successor_despite_preserved_original_then_refuses_spent_lineage(self):
        import receiver
        self.reconcile()
        card=dict(owned=True,active=None,pending=None,generation=86)
        budget=Mock(remaining=lambda *a:1)
        (self.root/R.FIXED).write_text('original reservation remains')
        with patch.object(receiver,'STATE',self.root),patch.object(receiver,'read',self.r.read),patch.object(N,'trusted',return_value=json.dumps(self.marker).encode()):
            plan=receiver.qualification_plan({'mode':'active'},card,budget)
            self.assertEqual(plan['stage'],'qa_qualification');self.assertEqual(plan['generation'],86)
            R.reserve_lineage(self.r,self.q,'one-successor')
            self.assertIsNone(receiver.qualification_plan({'mode':'active'},card,budget))
            self.assertIsNone(receiver.qualification_plan({'mode':'shadow'},card,budget))
        self.assertEqual((self.root/R.FIXED).read_text(),'original reservation remains')
    @contextmanager
    def date_fixture(self,day='2026-10-23'):
        import receiver
        from test_actions_train import S
        self.reconcile();self.j=self.data['slot2.json'];self.j['last']=None
        limits=self.root/'budgets.json';outbox=self.root/'outbox';locks=self.root/'locks';locks.mkdir();(locks/'registry.lock').touch()
        (outbox/'slot2').mkdir(parents=True)
        original={'2026-10-23':{'agy':{'qa':1}}}
        (outbox/'slot2/ledger.json').write_text(json.dumps(original))
        caps={'providers':{'agy':{'qa':2}},'slots':{'slot2':{'agy':{'qa':2}}}}
        limits.write_text(json.dumps(caps));clock=[day]
        budget=S.Budget(limits,outbox,locks/'registry.lock',today=lambda:clock[0])
        req=dict(action='train',stage='qa_qualification',slot='slot2',issue=29,phase='idle',head=self.q['head'],attempt=0,generation=86,profile='agy',run=123,run_attempt=1,gh_token='synthetic-read-token')
        with ExitStack() as stack:
            for name,value in [('STATE',self.root),('read',self.r.read),('atomic',self.r.atomic),('journal',self.r.journal),('checkpoint',self.r.checkpoint),('guard',Mock()),('live',lambda:(None,SimpleNamespace(Budget=lambda *a:budget))),('identity',lambda pid:{'pid':pid}),('alive',lambda proc:False)]:
                stack.enter_context(patch.object(receiver,name,value))
            stack.enter_context(patch.object(N,'qualification',return_value=self.marker))
            stack.enter_context(patch.object(N,'trusted',side_effect=lambda *a,**k:json.dumps(self.marker).encode()))
            fork=stack.enter_context(patch.object(receiver.os,'fork',return_value=12345))
            yield receiver,budget,clock,req,fork,original
    def test_real_daily_budget_same_day_plan_cross_midnight_execution_and_no_third_day_replay(self):
        with self.date_fixture() as (receiver,budget,clock,req,fork,original):
            card=dict(owned=True,active=None,pending=None,generation=86)
            self.assertEqual(budget.remaining('agy','qa','slot2'),1)
            self.assertIsNotNone(receiver.qualification_plan({'mode':'active'},card,budget))
            clock[0]='2026-10-24'
            self.assertEqual(budget.remaining('agy','qa','slot2'),2)
            self.assertIsNotNone(receiver.qualification_plan({'mode':'active'},card,budget))
            answer=receiver.qualification_request(req,{})
            self.assertEqual(answer['status'],'running');fork.assert_called_once()
            self.assertEqual(self.data[R.LINEAGE]['used_calls'],2)
            # Reservation precedes provider charge; the untouched day1 ledger proves no reset.
            self.assertEqual(json.loads((budget.outbox_root/'slot2/ledger.json').read_text()),original)
            budget.charge('slot2','agy','qa')
            ledger=json.loads((budget.outbox_root/'slot2/ledger.json').read_text())
            self.assertEqual(ledger['2026-10-23'],original['2026-10-23']);self.assertEqual(ledger['2026-10-24']['agy']['qa'],1)
            self.j=self.data['slot2.json'];clock[0]='2026-10-25'
            self.assertEqual(receiver.qualification_request(req|{'run':124},{})['status'],'unknown')
            self.j['pending']=None;self.j['generation']=87
            self.assertIsNone(receiver.qualification_plan({'mode':'active'},card|{'generation':87},budget))
            with self.assertRaises(Refused):receiver.qualification_request(req|{'run':125,'generation':87},{})
            fork.assert_called_once()
    def test_real_same_day_request_remains_eligible(self):
        with self.date_fixture() as (receiver,budget,clock,req,fork,_):
            self.assertEqual(receiver.qualification_request(req,{})['status'],'running')
            fork.assert_called_once();self.assertEqual(self.data[R.LINEAGE]['used_calls'],2)
    def test_daily_invalid_unknown_unlimited_zero_negative_never_reserves_or_forks(self):
        with self.date_fixture('2026-10-24') as (receiver,budget,clock,req,fork,_):
            from test_actions_train import S
            card=dict(owned=True,active=None,pending=None,generation=86)
            for left in (0,-1,S.UNKNOWN,float('inf'),True,None,'2',{},1.0):
                with self.subTest(left=repr(left)),patch.object(budget,'remaining',return_value=left):
                    self.assertIsNone(receiver.qualification_plan({'mode':'active'},card,budget))
                    with self.assertRaises(Refused):receiver.qualification_request(req,{})
                    self.assertEqual(self.data[R.LINEAGE]['used_calls'],1)
                    self.assertFalse(R.reservation_path(self.root,self.q).exists())
            fork.assert_not_called()
    def test_original_v1_remains_exact_integer_one_in_both_predicates(self):
        with self.date_fixture() as (receiver,budget,clock,req,fork,_):
            q={k:self.q[k] for k in ('issue','base','head','work')};q['task_sha256']=digest(N.qualification_task(q['base'],q['head']))
            self.marker['qualification']=q;self.marker['canary_task_sha256']=q['task_sha256']
            card=dict(owned=True,active=None,pending=None,generation=86)
            with patch.object(budget,'remaining',return_value=2):
                self.assertIsNone(receiver.qualification_plan({'mode':'active'},card,budget))
                with self.assertRaises(Refused):receiver.qualification_request(req,{})
            with patch.object(budget,'remaining',return_value=1):
                self.assertIsNotNone(receiver.qualification_plan({'mode':'active'},card,budget))
                self.assertEqual(receiver.qualification_request(req,{})['status'],'running')
            fork.assert_called_once();self.assertEqual(self.data[R.LINEAGE]['used_calls'],1)
    def test_registry_charge_race_refuses_popen_without_refunding_lineage(self):
        with self.date_fixture('2026-10-24') as (receiver,budget,clock,req,fork,_):
            receiver.qualification_request(req,{})
            budget.charge('slot2','agy','qa');budget.charge('slot2','agy','qa')
            self.assertEqual(budget.remaining('agy','qa','slot2'),0)
            evidence=self.root/'race-evidence'
            with patch.object(N.os,'geteuid',return_value=978),patch.object(N,'trusted',return_value=b'PRIVATE_AUTH'),patch.object(N,'git',return_value=b'/tmp/candidate/.git'),patch.object(N,'filesystem_roots',return_value=([],[],[])):
                popen=Mock(side_effect=AssertionError('provider launched despite exhausted budget'))
                with self.assertRaisesRegex(N.ReviewError,'AGY_CHARGE_FAILED'):
                    N.invoke('prompt',30,work=Path('/tmp/candidate'),slot='slot2',task_hash=self.q['task_sha256'],charge=lambda:budget.charge('slot2','agy','qa'),popen=popen,evidence_dir=evidence)
                popen.assert_not_called()
            self.assertEqual(self.data[R.LINEAGE]['used_calls'],2)
    def test_executor_live_metadata_unknown_and_zombie(self):
        proc=self.root/'proc';proc.mkdir();entry=proc/'100';entry.mkdir();(entry/'stat').write_text('100 (no command read) S')
        # Use synthetic metadata UID only; no live process/provider is involved.
        original=Path.stat
        def stat(path,*a,**kw):
            info=original(path,*a,**kw)
            return SimpleNamespace(st_uid=978) if path==entry else info
        with patch.object(Path,'stat',stat):
            with self.assertRaises(Refused):self.real_quiet(proc)
            (entry/'stat').write_text('invalid')
            with self.assertRaises(Refused):self.real_quiet(proc)
            (entry/'stat').write_text('100 (zombie) Z');self.real_quiet(proc)
    def test_acceptance_skips_old_unknown_and_rejects_wrong_exact_successor(self):
        self.assertFalse(R.acceptance_match(self.op,self.q))
        with self.assertRaises(Refused):R.acceptance_match({'task_hash':self.q['task_sha256']},self.q)
        receipt=dict(qualification_task_sha256=self.q['task_sha256'],source_sha=self.q['head'],base_sha=self.q['base'],qualification_passed=True,charged_calls=1,effective_model=N.MODEL,qualification_lineage={k:self.q[k] for k in ('parent_task_sha256','parent_operation','adapter_revision')})
        op=dict(task_hash=self.q['task_sha256'],binding=dict(stage='qa_qualification',issue=29,slot='slot2',head=self.q['head']),before='same',after='same',finished_at=1,result=dict(status='confirmed',qualification_passed=True,checkpoint_changed=False,qa=dict(verdict='PASS',reviewed_sha=self.q['head']),native_receipt=receipt))
        self.assertTrue(R.acceptance_match(op,self.q))
        op['result']['native_receipt']['qualification_lineage']['adapter_revision']='d'*40
        with self.assertRaises(Refused):R.acceptance_match(op,self.q)

if __name__=='__main__':unittest.main()

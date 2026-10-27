"""Synthetic real Store + receiver/controller transactions. No host, model or network effects."""
import copy
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'actions_train'))
import core
import receiver as R
import scheduling_control as C
import stage
import test_plan_gate as G
A, S = core.live()
HEAD, BASE = 'a'*40, 'b'*40
TOKEN = 'github_pat_SYNTHETIC_ONLY'


class Controls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='scheduling-')
        self.root = Path(self.temp.name)
        self.folder = self.root/'autonomy/slots/slot1'
        self.folder.mkdir(parents=True, mode=0o700)
        self.folder.chmod(0o700)
        self.state = self.root/'controller'; self.state.mkdir(mode=0o700)
        self.policy = dict(mode='active', owned={'slot1':True,'slot2':True}, controller_sha='c'*40)
        self.metadata = {'source':'immutable', 'grants':{'used_calls':2,'ceiling':5}}
        block, classifier, verifier = G.trusted_tools()
        self.tools = (block, classifier, verifier)
        self.task = dict(schema=A.MARKER, target='dev', kind='source_only', goal='synthetic',
            acceptance=block.render(block.plan_for_changes([{'path':'docs/sample.md','status':'M'}])),
            allowed_paths=['docs/sample.md'], locks=['docs:sample'], max_attempts=3)
        self.active = dict(issue=450, phase='qa', head=HEAD, base=BASE, attempt=2,
            pr=900, task=copy.deepcopy(self.task), fingerprint='frozen',
            qa={'verdict':'PASS','reviewed_sha':HEAD,'findings':[]}, ci={'id':55,'sha':HEAD},
            history=[{'attempt':1,'head':'d'*40,'result':'FAIL'}],
            failure_diagnosis={'calls':1,'receipts':{'prior':'immutable'}}, resumes=[321])
        A.atomic(self.folder/'state.json', dict(active=self.active, done=[400]))
        A.atomic(self.folder/'qa-450-a2.json', self.active['qa'])
        A.atomic(self.state/'slot1.json', dict(generation=17,pending=None,operations={},
                 deferred=[],last={'status':'unknown','reason':'history'},profiles={'450':'auto'},stage_counts={}))
        A.atomic(self.state/'slot2.json', dict(generation=10,pending=None,operations={},deferred=[],last=None,stage_counts={}))
        self.other = {'active':None,'done':[]}
        self.auth = {}
        self.api = Mock(side_effect=self.api_call)
        self.api.identity = Mock()
        self.bridge = SimpleNamespace(c=SimpleNamespace(worktrees_root=self.root/'worktrees'),
            unchanged_issue=Mock(), stopped_writer=Mock(), candidate_identity=Mock(), saved_qa=Mock(),
            remote_dev=Mock(return_value=BASE), git=Mock(side_effect=self.git))
        self.rt = SimpleNamespace(lease=Mock())
        self.patches = [patch.object(R,'STATE',self.state),patch.object(R,'AUTONOMY',self.root/'autonomy'),
            patch.object(R,'checkpoint',side_effect=self.checkpoint),patch.object(R,'guard',return_value=SimpleNamespace(pw_uid=os.getuid())),
            patch.object(R,'hosted_identity'), patch.object(R,'API',return_value=self.api,create=True),
            patch.object(core,'API',return_value=self.api),patch.object(R,'live',return_value=(A,S)),
            patch.object(R,'read',side_effect=lambda p,*a,**kw: (Path(p).read_bytes() if kw.get('json_data') is False
                                                             else core.loads(Path(p).read_bytes()))),
            patch.object(C,'root_metadata',side_effect=lambda *a,**kw: copy.deepcopy(self.metadata)),
            patch.object(C,'no_live'),  # fixed synthetic PIDs; real verifier is tested below with fake /proc
            patch.object(C,'state_evidence',side_effect=lambda *a,**kw: {
                p:hashlib.sha256(__import__('base64').b64decode(raw)).hexdigest()
                for p,raw in C.evidence(self.folder,450).items()}),
            patch.object(G,'trusted_tools',return_value=self.tools),
            patch.object(verifier,'diff_changes',return_value=[{'path':'docs/sample.md','status':'M'}]),
            patch.object(A,'_SLOTS',None)]
        for p in self.patches: p.start()
        self.addCleanup(self.temp.cleanup)
        for p in self.patches: self.addCleanup(p.stop)
        self.counter = 700

    def git(self,*args,**kw):
        if args[0] == 'status': return ''
        if args[0] == 'merge-base': return BASE
        return HEAD

    def api_call(self,path,*args,**kw):
        if path == 'git/ref/heads/dev': return {'object':{'sha':self.bridge.remote_dev()}}
        if path.startswith('issues/comments/'): return copy.deepcopy(self.auth[int(path.split('/')[-1])])
        raise AssertionError('unexpected API '+path)

    def checkpoint(self,slot):
        if slot == 'slot2': return copy.deepcopy(self.other), []
        state = core.loads((self.folder/'state.json').read_bytes())
        path = self.folder/'parked.json'
        parked = core.loads(path.read_bytes())['parked'] if path.exists() else []
        return state, [e['issue'] for e in parked]

    def request(self,action='park',snapshot=None,archive=None,operation=None,proof=None):
        snapshot = snapshot or self.active
        self.counter += 1
        req = dict(action='train',stage=action,slot='slot1',issue=snapshot['issue'],
            head=snapshot['head'],attempt=snapshot['attempt'],phase=snapshot['phase'],
            generation=R.journal('slot1')['generation'],profile='auto',run=100,run_attempt=1,gh_token=TOKEN,
            control=dict(comment=self.counter,snapshot=core.digest(snapshot),archive=archive,
                         operation=operation,proof=proof,base=snapshot['base'],pr=snapshot['pr']))
        self.authorize(req)
        return req

    def authorize(self,req):
        stamp = dt.datetime.now(dt.timezone.utc).isoformat()
        self.auth[req['control']['comment']] = dict(id=req['control']['comment'],user={'id':core.OWNER},
            issue_url=f'https://api.github.com/repos/{core.REPO}/issues/{req["issue"]}',
            created_at=stamp,updated_at=stamp,
            body=C.MARKER+'\n'+json.dumps(dict(schema=C.MARKER,request=core.binding(req))))

    def prepare(self,req):
        # Real receiver dispatch and journal code, with fork represented by a fixed PID.
        lock = R.locked(self.state/'controller.lock')
        try:
            with patch.object(R.os,'fork',return_value=880000), patch.object(R,'identity',return_value={'pid':880000,'start':'5','boot':'test'}):
                return R.handle(copy.deepcopy(req),self.policy)
        finally: os.close(lock)

    def worker(self,req,finish=True):
        key = core.digest(core.binding(req)); j = R.journal('slot1')
        store = A.Store(self.folder)
        try:
            intent = j['operations'][key]['scheduling']
            local = dict(req,_control=intent)
            with patch.object(C.os,'getuid',return_value=1002):
                result = C.perform(local,(A,S,self.rt,self.api,store,self.bridge))
        finally: os.close(store.lock)
        if finish:
            R.finish_scheduling(req,self.policy,R.journal('slot1'),self.checkpoint('slot1')[0],result)
        return result

    def complete(self,req):
        self.prepare(req)
        return self.worker(req)

    def test_park_free_unrelated_then_resume_exact_next_stage_no_effects(self):
        park = self.request(); parked = self.complete(park)
        self.assertIsNone(self.checkpoint('slot1')[0]['active'])
        self.assertEqual(self.checkpoint('slot1')[0]['done'],[400])
        snap = {'slots':{'slot1':dict(active=None,done=[400],parked=[450],owned=True,pending=None,
                  generation=18,last=None,availability={'codex':{'author':True}})}}
        with patch('queue_diagnostics.provider_ready',return_value=True):
            plan = core.plan(A,S,snap,[(451,self.task|{'allowed_paths':['docs/other.md'],'locks':['docs:other']})])
        self.assertEqual(plan[0]['issue'],451)
        resume = self.request('resume',archive=parked['archive'])
        outcome = self.complete(resume)
        self.assertEqual(outcome['next_stage'],'ci')
        self.assertEqual(self.checkpoint('slot1')[0]['active'],self.active)
        self.assertTrue((self.folder/('scheduling-'+parked['archive']+'.json')).exists())
        self.assertEqual(self.metadata['grants']['used_calls'],2)
        self.assertEqual(self.bridge.stopped_writer.call_count,2)
        self.assertFalse(hasattr(self.bridge,'model'))

    def test_repeated_park_and_resume_return_saved_result_without_new_worker(self):
        req = self.request(); self.complete(req)
        first = R.journal('slot1')
        result = self.prepare(dict(req,run=101))
        self.assertEqual(result['status'],'confirmed'); self.assertEqual(R.journal('slot1'),first)
        resume = self.request('resume',archive=core.digest(core.binding(req)))
        self.complete(resume); saved = R.journal('slot1')
        self.assertEqual(self.prepare(dict(resume,run=102))['status'],'confirmed')
        self.assertEqual(R.journal('slot1'),saved)
        newer = self.request('resume',archive=resume['control']['archive'])
        with self.assertRaisesRegex(core.Refused,'slot occupied'): self.prepare(newer)

    def test_crash_archive_before_state_recovers_same_intent_and_proof(self):
        req = self.request(); self.prepare(req)
        original = A.atomic
        def crash(path,value):
            if Path(path) == self.folder/'state.json': raise OSError('synthetic archive/state crash')
            return original(path,value)
        with patch.object(A,'atomic',side_effect=crash), self.assertRaises(OSError): self.worker(req)
        key = core.digest(core.binding(req))
        self.assertTrue((self.folder/('scheduling-'+key+'.json')).exists())
        self.assertTrue((self.folder/'parked.json').exists())
        j = R.journal('slot1')
        R.finish_scheduling(req,self.policy,j,self.checkpoint('slot1')[0],{'status':'unknown','reason':'crash'})
        with patch.object(C,'no_live'):
            self.prepare(req)
        self.worker(req)
        self.assertIsNone(self.checkpoint('slot1')[0]['active'])
        self.assertEqual(len(core.loads((self.folder/'parked.json').read_bytes())['parked']),1)
        self.assertEqual(self.prepare(req)['status'],'confirmed')

    def test_crash_after_state_before_receipt_does_not_lose_pointer_or_replay(self):
        req = self.request(); self.prepare(req); self.worker(req,finish=False)
        j = R.journal('slot1')
        self.assertEqual(j['pending'],core.digest(core.binding(req)))
        R.finish_scheduling(req,self.policy,j,self.checkpoint('slot1')[0],{'status':'unknown'})
        with patch.object(C,'no_live'): self.prepare(req)
        before_calls = self.rt.lease.call_count
        self.worker(req)
        self.assertEqual(self.rt.lease.call_count,before_calls)

    def test_wrong_snapshot_slot_request_generation_and_edited_admission_refuse(self):
        for mutation in (lambda r:r.update(head='d'*40),lambda r:r.update(issue=451),
                         lambda r:r.update(slot='slot2'),lambda r:r.update(generation=16),
                         lambda r:r['control'].update(base='d'*40),lambda r:r['control'].update(pr=901),
                         lambda r:r['control'].update(snapshot='d'*64)):
            with self.subTest(mutation=mutation):
                req=self.request();mutation(req);self.authorize(req)
                with self.assertRaises((core.Refused,KeyError)):self.prepare(req)
        req=self.request();self.auth[req['control']['comment']]['updated_at']='changed'
        with self.assertRaisesRegex(core.Refused,'edited'):self.prepare(req)
        req=self.request();req['profile']='codex'
        with self.assertRaisesRegex(core.Refused,'request mismatch'):self.prepare(req)

    def test_pending_unknown_live_guard_and_missing_plan_hold_without_writes(self):
        req=self.request();before=(self.folder/'state.json').read_bytes()
        with patch.object(R,'guard',side_effect=core.Refused('live worker/lease')):
            with self.assertRaisesRegex(core.Refused,'live worker'):self.prepare(req)
        self.active['task']['acceptance']='no supported plan'
        A.atomic(self.folder/'state.json',{'active':self.active,'done':[400]})
        req=self.request()
        with self.assertRaisesRegex(core.Refused,'MISSING_TEST_PLAN'):self.prepare(req)
        self.assertIsNone(R.journal('slot1')['pending'])

    def test_resume_changed_source_receipts_candidate_or_dependency_conflict_holds(self):
        park=self.request();self.complete(park);archive=core.digest(core.binding(park))
        for case in ('source','base','dependency','conflict'):
            with self.subTest(case=case):
                req=self.request('resume',archive=archive)
                if case=='source':
                    with patch.object(C,'root_metadata',return_value={'source':'foreign'}),self.assertRaisesRegex(core.Refused,'drift'):self.prepare(req)
                elif case=='base':
                    self.bridge.remote_dev.return_value='d'*40
                    with self.assertRaisesRegex(core.Refused,'DEV base'):self.prepare(req)
                    self.bridge.remote_dev.return_value=BASE
                elif case=='conflict':
                    self.other['active']=dict(self.active,issue=999)
                    with self.assertRaisesRegex(core.Refused,'conflict'):self.prepare(req)
                    self.other['active']=None
                elif case=='dependency':
                    # A stale source snapshot cannot introduce a new dependency.
                    req['control']['snapshot']='d'*64;self.authorize(req)
                    with self.assertRaisesRegex(core.Refused,'snapshot'):self.prepare(req)

    def test_resume_edited_qa_receipt_holds_with_reserved_intent(self):
        park=self.request();self.complete(park)
        req=self.request('resume',archive=core.digest(core.binding(park)));self.prepare(req)
        (self.folder/'qa-450-a2.json').write_bytes(b'{"edited":true}')
        with self.assertRaisesRegex(core.Refused,'evidence changed'):self.worker(req)
        self.assertEqual(R.journal('slot1')['pending'],core.digest(core.binding(req)))

    def test_resume_changed_candidate_holds(self):
        park=self.request();self.complete(park)
        req=self.request('resume',archive=core.digest(core.binding(park)));self.prepare(req)
        with patch.object(self.bridge,'stopped_writer',side_effect=core.Refused('candidate changed')):
            with self.assertRaisesRegex(core.Refused,'candidate'):self.worker(req)

    def test_more_than_one_park_cycle_keeps_both_immutable_archives(self):
        first=self.request();self.complete(first)
        resume=self.request('resume',archive=core.digest(core.binding(first)));self.complete(resume)
        second=self.request();self.complete(second)
        entries=core.loads((self.folder/'parked.json').read_bytes())['parked']
        self.assertEqual(len(entries),2)
        self.assertEqual([e['snapshot'] for e in entries],[self.active,self.active])

    def unknown(self,closed=True):
        state={'active':None,'done':[400]};A.atomic(self.folder/'state.json',state)
        snapshot=dict(issue=450,phase='idle',head=HEAD,base=BASE,attempt=0,pr=None,task=self.task)
        q=dict(issue=450,head=HEAD,base=BASE,task_sha256=core.digest(self.task),work=str(self.root/'readonly'),
               qualification_grant={'role':'independent_qa'},task=self.task)
        original=dict(action='train',stage='qa_qualification',slot='slot1',issue=450,phase='idle',
                      head=HEAD,attempt=0,generation=17,profile='auto')
        key=core.digest(original);process={'pid':880000,'start':'5','boot':'test'}
        proof=dict(schema='GB_ROOT_PRECALL_ABSENCE_V1',worker_entered=False,child=process,
                   wait_status=0,operation=key)
        op=dict(binding=original,run=99,run_attempt=1,process=process,worker_process=process,
                before=core.digest(state),after=core.digest(state),checkpoint_before=state,
                finished_at=100,started_at=90,qa_qualification=q,task_hash=core.digest(self.task),
                result={'status':'unknown','safe_release':False},scheduling_preserved=copy.deepcopy(self.metadata))
        if closed:op['root_preflight_absence']=proof
        j=R.journal('slot1');j['operations'][key]=op;j['pending']=key
        A.atomic(self.state/'slot1.json',j)
        req=self.request('reconcile',snapshot=snapshot,operation=key,proof=core.digest(proof))
        return req,copy.deepcopy(op)

    def test_generic_pre_uid_drop_qualification_reconcile_preserves_unknown_and_charges(self):
        req,old=self.unknown();j=R.journal('slot1');original=copy.deepcopy(j)
        import native_antigravity as N
        with patch.object(C,'no_live'),patch.object(N,'qualification',return_value={}),\
             patch.object(N,'qualification_descriptor',return_value={k:v for k,v in old['qa_qualification'].items() if k!='task'}):
            self.complete(req)
        after=R.journal('slot1')
        self.assertEqual(after['operations'][req['control']['operation']],old)
        self.assertIsNone(after['pending']);self.assertEqual(after['generation'],18)
        for name in ('last','deferred','profiles','stage_counts'):self.assertEqual(after[name],original[name])
        self.assertEqual(self.metadata['grants']['used_calls'],2)
        self.assertEqual(self.prepare(req)['status'],'confirmed')
        self.assertEqual(self.checkpoint('slot1')[0],old['checkpoint_before'])

    def test_unknown_missing_closed_proof_or_wrong_proof_checkpoint_role_stays_hold(self):
        req,old=self.unknown(closed=False)
        before=R.journal('slot1')
        with patch.object(C,'no_live'),self.assertRaisesRegex(core.Refused,'external-effect'):self.prepare(req)
        self.assertEqual(R.journal('slot1'),before)
        req,old=self.unknown()
        for field in ('proof','operation','snapshot'):
            with self.subTest(field=field):
                bad=copy.deepcopy(req);bad['control'][field]='f'*64;self.authorize(bad)
                with patch.object(C,'no_live'),self.assertRaises(core.Refused):self.prepare(bad)
        self.authorize(req)
        j=R.journal('slot1');j['operations'][req['control']['operation']]['after']='f'*64
        A.atomic(self.state/'slot1.json',j)
        with patch.object(C,'no_live'),self.assertRaisesRegex(core.Refused,'unverifiable'):self.prepare(req)
        self.assertEqual(R.journal('slot1')['pending'],req['control']['operation'])

    def test_real_store_lock_blocks_second_writer_and_unrelated_slot_not_modified(self):
        req=self.request();before=(self.state/'slot2.json').read_bytes();self.prepare(req)
        store=A.Store(self.folder)
        try:
            with self.assertRaisesRegex(A.Hold,'another adapter'):self.worker(req)
        finally:os.close(store.lock)
        self.worker(req)
        self.assertEqual((self.state/'slot2.json').read_bytes(),before)

    def test_finalize_refuses_changed_journal_source_and_partial_state(self):
        req=self.request();self.prepare(req);result=self.worker(req,finish=False)
        j=R.journal('slot1');before=(self.state/'slot1.json').read_bytes()
        with patch.object(C,'root_metadata',return_value={'source':'changed'}),self.assertRaisesRegex(core.Refused,'source'):
            R.finish_scheduling(req,self.policy,j,self.checkpoint('slot1')[0],result)
        self.assertEqual((self.state/'slot1.json').read_bytes(),before)
        with self.assertRaisesRegex(core.Refused,'CAS'):
            R.finish_scheduling(req,self.policy,j,{'active':self.active,'done':[400]},result)

    def test_wire_refuses_caller_proof_json_and_internal_fields(self):
        req=self.request();core.request(req)
        for key in ('_control','_task_hash','shell','proof'):
            with self.assertRaises(core.Refused):core.request(dict(req,**{key:{'finished':True}}))
        bad=copy.deepcopy(req);bad['control']['proof']={'finished':True}
        with self.assertRaises(core.Refused):core.request(bad)

    def test_edited_archive_is_refused_against_root_receipt_seal(self):
        park=self.request();self.complete(park);key=core.digest(core.binding(park))
        path=self.folder/('scheduling-'+key+'.json')
        archive=core.loads(path.read_bytes());archive['evidence']={}
        A.atomic(path,archive)
        req=self.request('resume',archive=key);self.prepare(req)
        with self.assertRaisesRegex(core.Refused,'archive seal'):self.worker(req)

    def test_changed_proof_after_crash_cannot_replace_transaction(self):
        req=self.request();self.prepare(req)
        self.worker(req,finish=False)
        path=self.folder/('scheduling-'+core.digest(core.binding(req))+'.json')
        value=core.loads(path.read_bytes());value['intent']['admission']='f'*64
        A.atomic(path,value)
        with self.assertRaisesRegex(core.Refused,'proof changed'):self.worker(req)

    def test_other_slot_dispatches_when_unknown_has_no_proof(self):
        req,old=self.unknown(closed=False)
        with self.assertRaisesRegex(core.Refused,'external-effect'):self.prepare(req)
        snapshot={'slots':{
            'slot1':dict(active=None,done=[400],parked=[],owned=True,
                pending={'status':'unknown','recoverable':False,'binding':old['binding']},
                reservation=S.task_record(450,self.task),generation=17,last=None),
            'slot2':dict(active=None,done=[],parked=[],owned=True,pending=None,generation=10,last=None)}}
        with patch('queue_diagnostics.provider_ready',return_value=True):
            planned=core.plan(A,S,snapshot,[(451,self.task|{'allowed_paths':['docs/other.md'],'locks':['docs:other']})])
        self.assertEqual([(p['slot'],p['issue']) for p in planned],[('slot2',451)])

    def test_park_and_resume_completed_ci_selects_integration_without_repeating_ci(self):
        self.active['phase']='ci'
        A.atomic(self.folder/'state.json',{'active':self.active,'done':[400]})
        park=self.request();self.complete(park)
        resume=self.request('resume',archive=core.digest(core.binding(park)))
        result=self.complete(resume)
        self.assertEqual(result['next_stage'],'integrate')
        self.assertEqual(self.checkpoint('slot1')[0]['active'],self.active)

    def test_completed_publication_restores_qa_phase_and_no_publish(self):
        self.active.update(phase='pr_wait',qa=None,ci=None)
        A.atomic(self.folder/'state.json',{'active':self.active,'done':[400]})
        park=self.request();self.complete(park)
        resume=self.request('resume',archive=core.digest(core.binding(park)))
        result=self.complete(resume)
        self.assertEqual(result['next_stage'],'qa')
        self.assertEqual(self.checkpoint('slot1')[0]['active'],self.active)

    def test_old_archive_can_be_read_through_existing_cold_history(self):
        park=self.request();self.complete(park);key=core.digest(core.binding(park))
        j=R.journal('slot1');R.atomic(self.state/'history/slot1'/(key+'.json'),j['operations'].pop(key))
        R.atomic(self.state/'slot1.json',j)
        self.assertEqual(self.prepare(park)['status'],'confirmed')
        resume=self.request('resume',archive=key);self.complete(resume)
        self.assertEqual(self.checkpoint('slot1')[0]['active'],self.active)

    def test_entry_control_failure_never_clears_pending_as_deferred(self):
        req=self.request();store=A.Store(self.folder)
        try:
            context=(A,S,self.rt,self.api,store,self.bridge)
            with patch.object(stage,'setup',return_value=context),patch.object(C,'perform',side_effect=core.Refused('HOLD')):
                result=stage.entry(req,{})
            self.assertEqual(result['status'],'unknown');self.assertFalse(result['safe_release'])
        finally:os.close(store.lock)


class ProcessIdentity(unittest.TestCase):
    def test_missing_identity_pid_reuse_live_or_unknown_refuse(self):
        process={'pid':123,'start':'5','boot':'boot'}
        fake=SimpleNamespace(identity=Mock(return_value=process),alive=Mock(return_value=True))
        with self.assertRaisesRegex(core.Refused,'unknown process'):C.no_live(fake,None)
        with patch.object(Path,'read_text',return_value='boot'),patch.object(Path,'stat',return_value=object()):
            with self.assertRaisesRegex(core.Refused,'live executor'):C.no_live(fake,process)
            fake.identity.return_value=dict(process,start='6')
            with self.assertRaisesRegex(core.Refused,'PID reuse'):C.no_live(fake,process)
            fake.identity.return_value=None
            with self.assertRaisesRegex(core.Refused,'unknown process'):C.no_live(fake,process)
        with patch.object(Path,'read_text',return_value='boot'),patch.object(Path,'stat',side_effect=FileNotFoundError):
            C.no_live(fake,process)
        with patch.object(Path,'read_text',return_value='boot'),patch.object(Path,'stat',side_effect=PermissionError):
            with self.assertRaises(PermissionError):C.no_live(fake,process)


class MetadataAndBridge(unittest.TestCase):
    def test_secure_metadata_preserves_raw_hash_and_refuses_symlink(self):
        with tempfile.TemporaryDirectory(prefix='scheduling-metadata-') as temp:
            path=Path(temp)/'receipt.json';path.write_bytes(b'{"calls": 2}\n');path.chmod(0o600)
            info=R.read(path,os.getuid(),snapshot=True)
            self.assertEqual(info['sha256'],hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(info['value'],{'calls':2})
            self.assertEqual(R.read(path,os.getuid(),json_data=False),path.read_bytes())
            link=Path(temp)/'link';link.symlink_to(path)
            with self.assertRaises(OSError):R.read(link,os.getuid(),snapshot=True)

    def test_legacy_bridge_and_detached_store_candidate_verification(self):
        with tempfile.TemporaryDirectory(prefix='scheduling-bridge-') as temp:
            work=Path(temp);store=SimpleNamespace(data={'active':None})
            b=A.Bridge(SimpleNamespace(),store);b.work=work
            def git(*args,**kw):
                if args[:2]==('rev-parse','HEAD'):return HEAD
                if args[0]=='symbolic-ref':return 'automation/issue-450'
                if args[0]=='status':return ''
                if args[0]=='merge-base':return BASE
                if args[0]=='ls-remote':return HEAD+'\trefs/heads/automation/issue-450'
                return str(work/'absent-marker')
            b.git=Mock(side_effect=git)
            b.candidate_identity({'issue':450,'head':HEAD,'base':BASE},detached_store=True)
            store.data['active']={'issue':450}
            b.candidate_identity({'issue':450,'head':HEAD,'base':BASE})
            marker=work/'absent-marker';marker.write_text('unfinished')
            with self.assertRaisesRegex(A.Hold,'unfinished Git'):
                b.stopped_writer(HEAD)


if __name__ == '__main__':unittest.main()

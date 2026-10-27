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
import threading
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
SECURE_READ, ROOT_METADATA = R.read, C.root_metadata
HEAD, BASE = 'a'*40, 'b'*40
TOKEN = 'github_pat_SYNTHETIC_ONLY'


class Controls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='scheduling-')
        self.root = Path(self.temp.name)
        self.slot = 'slot1'
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
        self.rt = SimpleNamespace(lease=Mock(),budget=Mock())
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
        if slot != self.slot: return copy.deepcopy(self.other), []
        state = core.loads((self.folder/'state.json').read_bytes())
        path = self.folder/'parked.json'
        parked = core.loads(path.read_bytes())['parked'] if path.exists() else []
        return state, [e['issue'] for e in parked]

    def request(self,action='park',snapshot=None,archive=None,operation=None,proof=None):
        snapshot = snapshot or self.active
        self.counter += 1
        req = dict(action='train',stage=action,slot=self.slot,issue=snapshot['issue'],
            head=snapshot['head'],attempt=snapshot['attempt'],phase=snapshot['phase'],
            generation=R.journal(self.slot)['generation'],profile='auto',run=100,run_attempt=1,gh_token=TOKEN,
            control=dict(comment=self.counter,snapshot=core.digest(snapshot),archive=archive,
                         operation=operation,proof=proof,base=snapshot['base'],pr=snapshot['pr']))
        self.authorize(req)
        return req

    def authorize(self,req):
        stamp = dt.datetime.now(dt.timezone.utc).isoformat()
        self.auth[req['control']['comment']] = dict(id=req['control']['comment'],user={'id':core.OWNER},
            issue_url=f'https://api.github.com/repos/{core.REPO}/issues/{req["issue"]}',
            created_at=stamp,updated_at=stamp,
            body=C.MARKER+'\n'+json.dumps(C.admission_body(req)))

    def prepare(self,req):
        # Real receiver dispatch and journal code, with fork represented by a fixed PID.
        lock = R.locked(self.state/'controller.lock')
        try:
            with patch.object(R.os,'fork',return_value=880000), patch.object(R,'identity',return_value={'pid':880000,'start':'5','boot':'test'}):
                return R.handle(copy.deepcopy(req),self.policy)
        finally: os.close(lock)

    def worker(self,req,finish=True):
        key = core.digest(core.binding(req)); j = R.journal(self.slot)
        store = A.Store(self.folder)
        try:
            intent = j['operations'][key]['scheduling']
            local = dict(req,_control=intent)
            with patch.object(C.os,'getuid',return_value=1002):
                result = C.perform(local,(A,S,self.rt,self.api,store,self.bridge))
        finally: os.close(store.lock)
        if finish:
            R.finish_scheduling(req,self.policy,R.journal(self.slot),self.checkpoint(self.slot)[0],result)
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
        for case in ('source','dependency','conflict','base'):
            with self.subTest(case=case):
                req=self.request('resume',archive=archive)
                if case=='source':
                    with patch.object(C,'root_metadata',return_value={'source':'foreign'}),self.assertRaisesRegex(core.Refused,'drift'):self.prepare(req)
                elif case=='base':
                    self.bridge.remote_dev.return_value='d'*40
                    self.prepare(req)
                    with patch.object(self.bridge,'git',return_value='e'*40):
                        with self.assertRaisesRegex(core.Refused,'ancestry'):self.worker(req)
                    self.assertEqual(R.journal('slot1')['pending'],core.digest(core.binding(req)))
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

    def test_archive_whitespace_edit_is_detected_by_recorded_bytes(self):
        park=self.request();self.complete(park);key=core.digest(core.binding(park))
        path=self.folder/('scheduling-'+key+'.json');path.write_bytes(path.read_bytes()+b'\n')
        resume=self.request('resume',archive=key);self.prepare(resume)
        with self.assertRaisesRegex(core.Refused,'archive seal'):self.worker(resume)

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
        with patch.object(core,'route',return_value={'provider':'codex'}):
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

    def test_creation_order_id_allocated_after_final_body_no_patch(self):
        req=self.request();req['control'].pop('comment')
        body=C.MARKER+'\n'+json.dumps(C.admission_body(req))
        received=[]
        def create(body_received):
            received.append(body_received)
            # ID is chosen by the service only after the immutable body arrived.
            assigned=918374
            stamp=dt.datetime.now(dt.timezone.utc).isoformat()
            self.auth[assigned]=dict(id=assigned,user={'id':core.OWNER},
                issue_url=f'https://api.github.com/repos/{core.REPO}/issues/450',
                body=body_received,created_at=stamp,updated_at=stamp)
            return assigned
        req['control']['comment']=create(body)
        self.complete(req)
        self.assertEqual(received,[self.auth[req['control']['comment']]['body']])
        key=core.digest(core.binding(req));op=R.journal('slot1')['operations'][key]
        self.assertEqual(op['scheduling']['admission'],C.admission(req,self.api))
        self.assertEqual(op['binding']['control']['comment'],918374)
        other=copy.deepcopy(req);other['control']['comment']=918375;self.authorize(other)
        self.assertNotEqual(core.digest(core.binding(other)),key)
        with self.assertRaisesRegex(core.Refused,'stale'):self.prepare(other)

    def test_comment_owner_issue_id_and_semantic_tamper_refuse(self):
        req=self.request();cid=req['control']['comment'];original=copy.deepcopy(self.auth[cid])
        for field,value in (('id',cid+1),('user',{'id':1}),('issue_url','https://example.invalid/450'),
                            ('updated_at','edited')):
            self.auth[cid]=dict(original,**{field:value})
            with self.subTest(field=field),self.assertRaises(core.Refused):self.prepare(req)
        self.auth[cid]=original
        body=C.admission_body(req);body['request']['extra']=True
        self.auth[cid]['body']=C.MARKER+'\n'+json.dumps(body)
        with self.assertRaisesRegex(core.Refused,'mismatch'):self.prepare(req)
        self.assertIsNone(R.journal('slot1')['pending'])

    def test_Q2_R1_hot_cold_reactions_and_profile_metadata_do_not_change_authority(self):
        req=self.request();result=self.complete(req);key=core.digest(core.binding(req))
        auth=C.admission(req,self.api);cid=req['control']['comment'];original=copy.deepcopy(self.auth[cid])
        archive=self.folder/('scheduling-'+key+'.json');archive_bytes=archive.read_bytes()
        variants=[dict(original,reactions={'total_count':1,'+1':1}),
                  dict(original,reactions={'total_count':9,'heart':9},author_association='OWNER',
                       user=dict(original['user'],login='renamed',avatar_url='https://example.invalid/new')),
                  dict(original,user=dict(original['user'],login='another display name'))]
        for cold in (False,True):
            if cold:
                j=R.journal('slot1');R.atomic(self.state/'history/slot1'/(key+'.json'),j['operations'].pop(key))
                R.atomic(self.state/'slot1.json',j)
            journal=(self.state/'slot1.json').read_bytes();calls=self.bridge.stopped_writer.call_count
            for comment in variants:
                self.auth[cid]=comment
                self.assertEqual(C.admission(req,self.api),auth)
                self.assertEqual(self.prepare(dict(req,run=102)),dict(status='confirmed',key=key,result=result))
                self.assertEqual((self.state/'slot1.json').read_bytes(),journal)
                self.assertEqual(archive.read_bytes(),archive_bytes)
                self.assertEqual(self.bridge.stopped_writer.call_count,calls)

    def test_Q2_R3_typed_identity_scope_and_closed_semantics_refuse_before_effects(self):
        req=self.request();cid=req['control']['comment'];original=copy.deepcopy(self.auth[cid])
        mutations=[dict(id=value) for value in (cid+1,str(cid),True)]
        mutations += [dict(user={'id':value}) for value in (core.OWNER+1,str(core.OWNER),True)]
        mutations += [dict(user='owner'),dict(user=None)]
        mutations += [dict(issue_url=url) for url in (
            f'https://api.github.com/repos/foreign/repo/issues/{req["issue"]}',
            f'https://api.github.com/repos/{core.REPO}/issues/451')]
        body=C.admission_body(req)
        for change in (lambda b:b.update(extra=True),lambda b:b['request'].update(issue=451),
                       lambda b:b['request']['control'].update(extra=True)):
            altered=copy.deepcopy(body);change(altered)
            mutations.append(dict(body=C.MARKER+'\n'+json.dumps(altered)))
        before=(self.state/'slot1.json').read_bytes()
        for mutation in mutations:
            self.auth[cid]=dict(original,**mutation)
            with self.subTest(mutation=mutation),self.assertRaises(core.Refused):self.prepare(req)
            self.assertEqual((self.state/'slot1.json').read_bytes(),before)
            self.assertFalse(any(self.folder.glob('scheduling-*.json')))

    def test_Q2_R4_raw_body_exact_timestamps_edit_back_and_stale_new_id(self):
        req=self.request();self.complete(req);cid=req['control']['comment'];original=copy.deepcopy(self.auth[cid])
        auth=C.admission(req,self.api);before=(self.state/'slot1.json').read_bytes()
        # Semantic JSON equivalence must not turn a raw body edit into a duplicate.
        self.auth[cid]=dict(original,body=C.MARKER+'\n'+json.dumps(C.admission_body(req),indent=2,sort_keys=True))
        self.assertNotEqual(C.admission(req,self.api),auth)
        with self.assertRaisesRegex(core.Refused,'admission changed'):self.prepare(req)
        # Same instant spelled differently remains a different authenticated input.
        stamp=original['created_at'];different=stamp.replace('+00:00','Z')
        self.auth[cid]=dict(original,created_at=different,updated_at=different)
        self.assertNotEqual(C.admission(req,self.api),auth)
        with self.assertRaisesRegex(core.Refused,'admission changed'):self.prepare(req)
        for created,updated in ((stamp,'2026-10-27T00:00:00Z'), # edit-back retains updated timestamp
                                ('bad','bad'),('2026-10-27T00:00:00','2026-10-27T00:00:00'),
                                (None,None),('2000-01-01T00:00:00Z','2000-01-01T00:00:00Z'),
                                ('2999-01-01T00:00:00Z','2999-01-01T00:00:00Z')):
            self.auth[cid]=dict(original,created_at=created,updated_at=updated)
            with self.subTest(created=created,updated=updated),self.assertRaises(core.Refused):self.prepare(req)
        new=copy.deepcopy(req);new['control']['comment']=cid+1;self.auth[cid+1]=dict(original,id=cid+1)
        self.assertNotEqual(core.digest(core.binding(new)),core.digest(core.binding(req)))
        self.assertNotEqual(C.admission(new,self.api),auth)  # actual ID is also in authenticated identity
        with self.assertRaisesRegex(core.Refused,'stale'):self.prepare(new)
        self.assertEqual((self.state/'slot1.json').read_bytes(),before)

    def test_Q2_R4_consumed_archive_fresh_comment_cannot_resume_again(self):
        park=self.request();parked=self.complete(park)
        resume=self.request('resume',archive=parked['archive']);self.complete(resume)
        A.atomic(self.folder/'state.json',{'active':None,'done':[400]})
        replay=self.request('resume',archive=parked['archive']);before=(self.state/'slot1.json').read_bytes()
        with self.assertRaisesRegex(core.Refused,'already resumed/reserved'):self.prepare(replay)
        self.assertEqual((self.state/'slot1.json').read_bytes(),before)

    def test_Q2_R5_old_whole_response_digest_is_not_promoted_hot_or_cold(self):
        req=self.request();self.complete(req);key=core.digest(core.binding(req))
        old_digest=core.digest(self.auth[req['control']['comment']]);j=R.journal('slot1')
        self.assertNotEqual(old_digest,j['operations'][key]['scheduling']['admission'])
        j['operations'][key]['scheduling']['admission']=old_digest
        R.atomic(self.state/'slot1.json',j)
        for cold in (False,True):
            if cold:
                j=R.journal('slot1');R.atomic(self.state/'history/slot1'/(key+'.json'),j['operations'].pop(key))
                R.atomic(self.state/'slot1.json',j)
            paths=[self.state/'slot1.json',self.folder/('scheduling-'+key+'.json')]
            if cold:paths.append(self.state/'history/slot1'/(key+'.json'))
            before={p:p.read_bytes() for p in paths}
            with self.assertRaisesRegex(core.Refused,'admission changed'):self.prepare(req)
            self.assertEqual({p:p.read_bytes() for p in paths},before)

    def test_status_exact_key_cold_history_private_projection_and_no_recovery(self):
        req=self.request();self.complete(req);key=core.digest(core.binding(req))
        before=(self.state/'slot1.json').read_bytes()
        with (patch.object(R,'scheduling_request',side_effect=AssertionError('mutation')),
              patch.object(R,'guard',side_effect=AssertionError('guard'))):
            found=R.handle(dict(action='train',stage='status',slot='slot1',operation=key),self.policy)
        self.assertEqual(found['status'],'confirmed');self.assertEqual(found['binding'],core.binding(req))
        self.assertEqual((self.state/'slot1.json').read_bytes(),before)
        self.assertNotIn('scheduling',found);self.assertNotIn('checkpoint_before',json.dumps(found))
        self.assertNotIn(TOKEN,json.dumps(found))
        j=R.journal('slot1');op=j['operations'].pop(key)
        R.atomic(self.state/'history/slot1'/(key+'.json'),op);R.atomic(self.state/'slot1.json',j)
        self.assertEqual(R.operation_outcome('slot1',key),found)
        self.assertEqual(R.operation_outcome('slot1','f'*64)['status'],'not_found')
        j=R.journal('slot1');j['operations']['f'*64]=op;R.atomic(self.state/'slot1.json',j)
        with self.assertRaisesRegex(core.Refused,'binding integrity'):R.operation_outcome('slot1','f'*64)

    def test_actual_unrelated_completed_dev_and_usage_progress_restore_exact_task(self):
        import subprocess
        repo=self.root/'source';repo.mkdir()
        def git(*args):
            return subprocess.check_output(['/usr/bin/git','-c','core.hooksPath=/dev/null',
                '-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid',*args],
                cwd=repo,text=True).strip()
        git('init','-q');(repo/'task.py').write_text('value = 1\n');git('add','.');git('commit','-qm','base')
        base=git('rev-parse','HEAD');self.active['base']=base
        (repo/'task.py').write_text('value = 2\n');git('add','.');git('commit','-qm','task')
        head=git('rev-parse','HEAD');self.active['head']=head
        self.active['qa']['reviewed_sha']=head;self.active['ci']['sha']=head
        A.atomic(self.folder/'state.json',{'active':self.active,'done':[400]})
        A.atomic(self.folder/'qa-450-a2.json',self.active['qa'])
        def ledger(n):
            return dict(value={'2026-10-27':{'codex':{'author':n,'qa':2}}},uid=1002,gid=1002,mode=420,
                        sha256=core.digest(n),size=100)
        live=str(R.AUTONOMY/'outbox/slot1/ledger.json');bak=live+'.bak'
        self.metadata[live]=ledger(2);self.metadata[bak]=ledger(1)
        self.bridge.remote_dev.return_value=base
        park=self.request();self.complete(park);key=core.digest(core.binding(park))
        archive=(self.folder/('scheduling-'+key+'.json')).read_bytes()
        # A different task actually completes, advancing DEV from the old base.
        git('checkout','--detach','-q',base);handoff=repo/'docs/handoffs/unrelated.md'
        handoff.parent.mkdir(parents=True);handoff.write_text('other task completed\n')
        git('add','.');git('commit','-qm','unrelated completed work');dev=git('rev-parse','HEAD')
        other=dict(self.active,issue=451,phase='done',head=dev,base=base)
        A.atomic(self.folder/'state.json',{'active':other,'done':[400,451]})
        A.atomic(self.folder/'qa-451-a1.json',{'verdict':'PASS','reviewed_sha':dev,'findings':[]})
        self.metadata[live]=ledger(4);self.metadata[bak]=ledger(3)
        self.bridge.remote_dev.return_value=dev
        j=R.journal('slot1');unrelated_key='e'*64
        unrelated=dict(binding=dict(issue=451,stage='dev'),finished_at=200,result={'status':'confirmed'})
        j['operations'][unrelated_key]=copy.deepcopy(unrelated)
        j['stage_counts']['451']=7;j['generation']+=7
        j['last']={'issue':451,'status':'confirmed','stage':'dev'}
        A.atomic(self.state/'slot1.json',j)
        original_git=self.bridge.git
        self.bridge.git=lambda *args,**kw:git(*args)
        self.bridge.c.worktrees_root=self.root/'worktrees'
        # Object/ancestry proof reads the real synthetic Git repository.
        (self.root/'worktrees').mkdir();(self.root/'worktrees/issue-450').symlink_to(repo,target_is_directory=True)
        resume=self.request('resume',archive=key);outcome=self.complete(resume)
        self.assertEqual(outcome['next_stage'],'ci')
        state=self.checkpoint('slot1')[0]
        self.assertEqual(state,{'active':self.active,'done':[400,451]})
        self.assertEqual(self.metadata[live],ledger(4))
        self.assertEqual((self.folder/('scheduling-'+key+'.json')).read_bytes(),archive)
        self.assertEqual(self.rt.lease.call_count,2)
        self.assertEqual(R.journal('slot1')['operations'][unrelated_key],unrelated)
        self.assertEqual(R.journal('slot1')['stage_counts']['451'],7)
        self.assertEqual(R.journal('slot1')['last'],j['last'])
        self.assertNotIn('merge',[args[0][0] for args in original_git.call_args_list])

    def test_current_qualification_and_budget_rechecked_before_resume(self):
        self.active.update(phase='pr_wait',qa=None,ci=None)
        A.atomic(self.folder/'state.json',{'active':self.active,'done':[400]})
        park=self.request();self.complete(park)
        resume=self.request('resume',archive=core.digest(core.binding(park)));self.prepare(resume)
        with patch.object(core,'route',side_effect=core.Refused('current quota UNKNOWN')) as route:
            self.rt.budget=object()
            with self.assertRaisesRegex(core.Refused,'quota UNKNOWN'):self.worker(resume)
            route.assert_called_once()
        self.assertIsNone(self.checkpoint('slot1')[0]['active'])

    def test_real_current_budget_primitives_not_frozen_quota_before_resume(self):
        self.active.update(phase='pr_wait',qa=None,ci=None)
        A.atomic(self.folder/'state.json',{'active':self.active,'done':[400]})
        limits=self.root/'budgets.json'
        A.atomic(limits,{'providers':{'codex':{'qa':1}},'slots':{'slot1':{'codex':{'qa':1}}}})
        self.rt.budget=S.Budget(limits,self.root/'outbox',self.root/'registry.lock',today=lambda:'2026-10-27')
        park=self.request();self.complete(park)
        # An unrelated QA consumes the current quota after PARK. No refund or
        # change to parked authority, and actual route/adapter/Budget predicates run.
        outbox=self.root/'outbox/slot1';outbox.mkdir(parents=True)
        A.atomic(outbox/'ledger.json',{'2026-10-27':{'codex':{'qa':1}}})
        resume=self.request('resume',archive=core.digest(core.binding(park)));self.prepare(resume)
        with self.assertRaisesRegex(core.Refused,'budget exhausted'):self.worker(resume)
        self.assertEqual(self.rt.budget.used('codex','qa','slot1'),1)
        self.assertIsNone(self.checkpoint('slot1')[0]['active'])

    def test_paused_task_journal_edits_refuse_but_unrelated_completed_receipt_can_advance(self):
        j=R.journal('slot1')
        oldkey='d'*64
        old=dict(binding=dict(issue=450,stage='qa'),finished_at=10,result={'status':'confirmed'},process=None)
        j['operations'][oldkey]=old;A.atomic(self.state/'slot1.json',j)
        park=self.request();self.complete(park);key=core.digest(core.binding(park))
        j=R.journal('slot1');j['operations'][oldkey]['result']['status']='deferred'
        A.atomic(self.state/'slot1.json',j)
        resume=self.request('resume',archive=key)
        with self.assertRaisesRegex(core.Refused,'receipt changed'):self.prepare(resume)
        self.assertIsNone(R.journal('slot1')['pending'])

    def test_paid_legacy_unknown_without_root_absence_stays_hold(self):
        req,old=self.unknown(closed=False)
        j=R.journal('slot1');op=j['operations'][req['control']['operation']]
        op.update(charged_calls=1,tool_events=['run_command DONE','run_command DONE'])
        op['result'].update(reason='AGY_PARSE_FAILED',safe_release=False)
        A.atomic(self.state/'slot1.json',j);before=(self.state/'slot1.json').read_bytes()
        with self.assertRaisesRegex(core.Refused,'external-effect absence'):self.prepare(req)
        self.assertEqual((self.state/'slot1.json').read_bytes(),before)
        self.assertFalse(R.journal('slot1')['operations'][req['control']['operation']]['result']['safe_release'])

class Accounting:
    """Actual Budget, fixed lock and secure snapshot; privileged identity is synthetic.

    No installed inventory/root qualification is claimed. Only the lock's fstat
    uid/gid and the root-reader owner lookup are substituted for nonroot fixtures.
    """
    def __init__(self, root, state):
        self.auto = root/'autonomy'; self.state = state
        locks = self.auto/'locks'; locks.mkdir(parents=True, exist_ok=True)
        self.lock = locks/'registry.lock'; self.lock.touch(); self.lock.chmod(0o640)
        self.limits = root/'limits.json'; self.policy = root/'policy.json'
        cells = {p:{r:100 for r in ('author','qa')} for p in ('codex','cursor','agy')}
        A.atomic(self.limits, dict(providers=cells,slots={s:cells for s in ('slot1','slot2')}))
        A.atomic(self.policy, dict(controller_sha='c'*40))
        for slot in ('slot1','slot2'):
            (self.auto/'outbox'/slot).mkdir(parents=True, exist_ok=True)
        self.day = '2026-10-27'
        self.budget = S.Budget(self.limits,self.auto/'outbox',self.lock,today=lambda:self.day)
        self.reader = SimpleNamespace(AUTONOMY=self.auto,STATE=state,POLICY=self.policy,
            BUDGET=self.limits,GROUP=65042,
            read=lambda p,owner=None,*a,**kw:SECURE_READ(p,os.getuid(),*a,**kw))
        self.real_fstat = os.fstat
        self.lock_inode = self.lock.stat().st_ino

    def identity(self, fd):
        info = self.real_fstat(fd)
        if info.st_ino == self.lock_inode and info.st_dev == self.lock.stat().st_dev:
            fields = list(info); fields[4:6] = [0,65042]
            return os.stat_result(fields)
        return info

    def snapshot(self, slot='slot1', policy=None):
        with patch.object(C.os,'fstat',side_effect=self.identity), \
             patch('pwd.getpwnam',return_value=SimpleNamespace(pw_uid=os.getuid())), \
             patch.object(C,'installed_inventory',return_value={'synthetic_installed_pin':'unchanged'}):
            return ROOT_METADATA(self.reader,slot,policy or {'controller_sha':'c'*40})

    def path(self, slot, backup=False):
        return self.auto/'outbox'/slot/('ledger.json.bak' if backup else 'ledger.json')

    def charge(self, slot, provider='codex', role='qa'):
        return self.budget.charge(slot,provider,role)


class ConcurrentControls(unittest.TestCase):
    def fixture(self, slot='slot1'):
        f = Controls(); f.setUp()
        self.addCleanup(f.doCleanups)
        if slot == 'slot2':
            moved = f.folder.with_name(slot); f.folder.rename(moved); f.folder = moved; f.slot = slot
        accounting = Accounting(f.root,f.state)
        C.root_metadata.side_effect = lambda reader, slot, policy, **kw: accounting.snapshot(slot,policy)
        return f,accounting

    def finish(self, f, req, result):
        lock = R.locked(f.state/'controller.lock')
        try:
            R.finish_scheduling(req,f.policy,R.journal(f.slot),f.checkpoint(f.slot)[0],result)
        finally:
            os.close(lock)

    def interleave(self, slot, action, initially_absent):
        f,b = self.fixture(slot)
        try:
            other = 'slot2' if slot == 'slot1' else 'slot1'
            if not initially_absent:
                b.day='2026-10-26'; b.charge(other); b.charge(other)
            parked = f.complete(f.request()) if action == 'resume' else None
            park_bytes = (f.folder/('scheduling-'+parked['archive']+'.json')).read_bytes() if parked else None
            req=f.request(action,archive=parked['archive'] if parked else None)
            f.prepare(req); key=core.digest(core.binding(req)); before=R.journal(slot)
            result=f.worker(req,finish=False)  # actual Store postimage precedes all new charges
            archive=f.folder/('scheduling-'+key+'.json'); archive_bytes=archive.read_bytes()
            qa_bytes=(f.folder/'qa-450-a2.json').read_bytes()
            store_before=f.checkpoint(slot)[0]
            b.day='2026-10-27'; b.charge(other)
            first=b.snapshot(slot); b.charge(other,'cursor','author'); b.charge(other,'agy','qa')
            b.day='2026-10-28'; b.charge(other,'codex','author')
            charged=b.snapshot(slot)
            self.assertTrue(b.path(other,True).exists())
            self.assertEqual(first[str(b.path(other))]['value']['2026-10-27']['codex']['qa'],1)
            # Disjoint completed receipts, last and history are not re-created by finalization.
            j=R.journal(slot); unrelated='e'*64
            j['operations'][unrelated]={'binding':{'issue':451,'stage':'ci'},'result':{'status':'confirmed'}}
            R.atomic(f.state/(slot+'.json'),j)
            self.finish(f,req,result)
            after=R.journal(slot);op=after['operations'][key]
            self.assertIsNone(after['pending']);self.assertEqual(after['generation'],before['generation']+1)
            self.assertEqual(op['result'],result);self.assertIsInstance(op['finished_at'],int)
            self.assertEqual(op['binding'],core.binding(req))
            self.assertEqual(op['scheduling'],before['operations'][key]['scheduling'])
            self.assertEqual(op['task_hash'],core.digest(f.active['task']))
            self.assertEqual(after['operations'][unrelated],j['operations'][unrelated])
            for name in ('last','profiles','stage_counts','deferred'):
                self.assertEqual(name in after,name in before)
                if name in before:self.assertEqual(after[name],before[name])
            self.assertEqual(f.checkpoint(slot)[0],store_before)
            self.assertEqual(store_before,{'active':None if action=='park' else f.active,'done':[400]})
            self.assertEqual(archive.read_bytes(),archive_bytes)
            self.assertEqual((f.folder/'qa-450-a2.json').read_bytes(),qa_bytes)
            if parked:self.assertEqual((f.folder/('scheduling-'+parked['archive']+'.json')).read_bytes(),park_bytes)
            journal_bytes=(f.state/(slot+'.json')).read_bytes();lease_calls=f.rt.lease.call_count
            with patch.object(C,'perform',side_effect=AssertionError('duplicate worker')):
                duplicate=f.prepare(dict(req,run=101))
            self.assertEqual(duplicate,dict(status='confirmed',key=key,result=result))
            self.assertEqual((f.state/(slot+'.json')).read_bytes(),journal_bytes)
            self.assertEqual(b.snapshot(slot),charged);self.assertEqual(f.rt.lease.call_count,lease_calls)
        finally:
            f.doCleanups()

    def test_Q1_R1_park_other_slot_charge_after_store_postimage(self):
        for slot in ('slot1','slot2'):
            for absent in (True,False):
                with self.subTest(slot=slot,initially_absent=absent):self.interleave(slot,'park',absent)

    def test_Q1_R2_resume_other_slot_charge_after_store_postimage(self):
        for slot in ('slot1','slot2'):
            for absent in (True,False):
                with self.subTest(slot=slot,initially_absent=absent):self.interleave(slot,'resume',absent)

    def test_Q1_R3_first_second_charge_and_controlled_slot_exact(self):
        f,b=self.fixture();req=f.request();f.prepare(req);result=f.worker(req,finish=False)
        frozen=R.journal(f.slot)['operations'][core.digest(core.binding(req))]['scheduling']['preserved']
        b.charge('slot2');one=b.snapshot();self.assertIsNone(one[str(b.path('slot2',True))])
        C.preserved_control(b.reader,req,frozen,one)
        b.charge('slot2');two=b.snapshot();C.preserved_control(b.reader,req,one,two)
        self.assertEqual(two[str(b.path('slot2',True))],one[str(b.path('slot2'))])
        b.charge('slot1');before=(f.state/'slot1.json').read_bytes()
        with self.assertRaises(core.Refused):self.finish(f,req,result)
        self.assertEqual((f.state/'slot1.json').read_bytes(),before)
        self.assertEqual(b.budget.used('codex','qa','slot1'),1)
        # Qualification/RECONCILE still requires exact metadata for both slots.
        with self.assertRaises(core.Refused):C.preserved_control(b.reader,dict(req,stage='reconcile'),one,two)

    def test_Q1_R6_eligible_same_transaction_retry_with_other_charge_and_unknown_hold(self):
        f,b=self.fixture();req=f.request();f.prepare(req);result=f.worker(req,finish=False)
        b.charge('slot2');key=core.digest(core.binding(req));archive=f.folder/('scheduling-'+key+'.json')
        raw=archive.read_bytes();before=(f.state/'slot1.json').read_bytes()
        with self.assertRaisesRegex(core.Refused,'executor outcome unknown'):f.prepare(req)
        self.assertEqual((f.state/'slot1.json').read_bytes(),before)
        # A recorded bounded UNKNOWN from this synthetic executor enables only
        # the pre-existing Store transaction retry, never a historical certificate.
        self.finish(f,req,{'status':'unknown','reason':'synthetic stopped executor'})
        self.assertFalse(R.journal('slot1')['operations'][key]['result']['safe_release'])
        b.charge('slot2');self.assertEqual(f.prepare(req)['status'],'running')
        calls=f.rt.lease.call_count;f.worker(req)
        self.assertEqual(f.rt.lease.call_count,calls);self.assertEqual(archive.read_bytes(),raw)
        self.assertEqual(b.budget.used('codex','qa','slot2'),2)
        self.assertEqual(R.journal('slot1')['generation'],18)

    def test_Q1_R6_pending_binding_generation_checkpoint_and_task_seals(self):
        f,b=self.fixture();req=f.request();f.prepare(req);result=f.worker(req,finish=False)
        b.charge('slot2');key=core.digest(core.binding(req));saved=R.journal('slot1')
        for mutate in (lambda j:j.update(pending='f'*64),lambda j:j.update(generation=999),
                       lambda j:j['operations'][key]['binding'].update(issue=999)):
            bad=copy.deepcopy(saved);mutate(bad);R.atomic(f.state/'slot1.json',bad)
            before=(f.state/'slot1.json').read_bytes()
            with self.subTest(mutation=mutate),self.assertRaisesRegex(core.Refused,'CAS'):
                self.finish(f,req,result)
            self.assertEqual((f.state/'slot1.json').read_bytes(),before)
        R.atomic(f.state/'slot1.json',saved)
        with self.assertRaisesRegex(core.Refused,'checkpoint CAS'):
            R.finish_scheduling(req,f.policy,saved,{'active':f.active,'done':[400]},result)
        archive=f.folder/('scheduling-'+key+'.json');raw=archive.read_bytes()
        for field in ('intent','before','after','evidence'):
            bad=core.loads(raw)
            if field=='intent':bad[field]['snapshot']['task']['goal']='tampered'
            elif field=='evidence':bad[field]={}
            else:bad[field]['done'].append(999)
            A.atomic(archive,bad)
            with self.subTest(field=field),self.assertRaises(core.Refused):f.worker(req)
            archive.write_bytes(raw)
        self.assertEqual(R.journal('slot1'),saved)


class RegistrySnapshots(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='registry-snapshot-');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);state=self.root/'state';state.mkdir()
        self.b=Accounting(self.root,state)

    def threads(self, *calls):
        errors=[];threads=[]
        for call in calls:
            def run(call=call):
                try:call()
                except BaseException as exc:errors.append(exc)
            thread=threading.Thread(target=run,daemon=True,name=call.__name__);thread.start();threads.append(thread)
        return threads,errors

    def joined(self, threads, errors):
        for thread in threads:thread.join(5);self.assertFalse(thread.is_alive(),'registry lock deadlock')
        if errors:raise errors[0]

    def test_Q1_R4_snapshot_waits_for_real_backup_hardlink_window(self):
        b=self.b;b.charge('slot2');entered=threading.Event();release=threading.Event();reader_blocked=threading.Event()
        observed=[];original=S.atomic;real_flock=fcntl.flock
        def rotate(path,*args,**kwargs):
            if Path(path)==b.path('slot2'):
                self.assertEqual(path.stat().st_nlink,2)
                with self.assertRaisesRegex(core.Refused,'unsafe metadata'):SECURE_READ(path,os.getuid())
                entered.set();self.assertTrue(release.wait(5))
            return original(path,*args,**kwargs)
        def snapshot():observed.append(b.snapshot())
        def flock(fd,operation):
            if threading.current_thread().name == 'snapshot':
                with self.assertRaises(BlockingIOError):real_flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
                reader_blocked.set()
            return real_flock(fd,operation)
        with patch.object(S,'atomic',side_effect=rotate),patch.object(C.fcntl,'flock',side_effect=flock):
            writers,errors=self.threads(lambda:b.charge('slot2'))
            try:
                self.assertTrue(entered.wait(5));readers,read_errors=self.threads(snapshot)
                self.assertTrue(reader_blocked.wait(5));self.assertFalse(observed)
            finally:release.set()
            self.joined(writers,errors);self.joined(readers,read_errors)
        snap=observed[0];live=snap[str(b.path('slot2'))];prior=snap[str(b.path('slot2',True))]
        self.assertEqual(live['value']['2026-10-27']['codex']['qa'],2)
        self.assertEqual(prior['value']['2026-10-27']['codex']['qa'],1)
        self.assertEqual(b.path('slot2').stat().st_nlink,1)

    def test_Q1_R4_writer_waits_until_both_snapshot_reads_complete(self):
        b=self.b;b.charge('slot2');b.charge('slot2');entered=threading.Event();release=threading.Event()
        charged=threading.Event();writer_blocked=threading.Event();snapshots=[];original=b.reader.read
        real_flock=fcntl.flock
        def read(path,*args,**kwargs):
            value=original(path,*args,**kwargs)
            if Path(path)==b.path('slot2'):
                entered.set();self.assertTrue(release.wait(5))
            return value
        b.reader.read=read
        def writer():b.charge('slot2');charged.set()
        def flock(fd,operation):
            if threading.current_thread().name == 'writer':
                with self.assertRaises(BlockingIOError):real_flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
                writer_blocked.set()
            return real_flock(fd,operation)
        with patch.object(C.fcntl,'flock',side_effect=flock):
            readers,errors=self.threads(lambda:snapshots.append(b.snapshot()))
            try:
                self.assertTrue(entered.wait(5))
                writers,write_errors=self.threads(writer)
                self.assertTrue(writer_blocked.wait(5));self.assertFalse(charged.is_set())
            finally:release.set()
            self.joined(readers,errors);self.joined(writers,write_errors)
        snapshot=snapshots[0]
        self.assertEqual(snapshot[str(b.path('slot2'))]['value']['2026-10-27']['codex']['qa'],2)
        self.assertEqual(snapshot[str(b.path('slot2',True))]['value']['2026-10-27']['codex']['qa'],1)
        self.assertEqual(b.budget.used('codex','qa','slot2'),3)
        # Repeated snapshots complete without nested non-reentrant acquisition.
        self.assertEqual(b.snapshot()[str(b.path('slot2'))]['value']['2026-10-27']['codex']['qa'],3)

    def test_Q1_R4_fixed_lock_missing_symlink_mode_owner_group_links_refuse_without_repair(self):
        b=self.b;original=b.lock.read_bytes();b.lock.unlink()
        with self.assertRaisesRegex(core.Refused,'registry lock missing HOLD'):b.snapshot()
        self.assertFalse(b.lock.exists())
        target=self.root/'other';target.write_bytes(original);target.chmod(0o640);b.lock.symlink_to(target)
        with self.assertRaisesRegex(core.Refused,'unsafe path'):b.snapshot()
        self.assertTrue(b.lock.is_symlink());b.lock.unlink();b.lock.touch();b.lock.chmod(0o600)
        with self.assertRaisesRegex(core.Refused,'unsafe identity'):b.snapshot()
        self.assertEqual(b.lock.stat().st_mode & 0o777,0o600);b.lock.chmod(0o640)
        # Real nonroot uid/gid must refuse: the production reader expects 0:65042.
        with patch.object(b,'identity',side_effect=b.real_fstat),self.assertRaisesRegex(core.Refused,'unsafe identity'):b.snapshot()
        synthetic_identity=b.identity
        def wrong_group(fd):
            info=synthetic_identity(fd);fields=list(info)
            if info.st_ino == b.lock_inode:fields[5]=0
            return os.stat_result(fields)
        with patch.object(b,'identity',side_effect=wrong_group),self.assertRaisesRegex(core.Refused,'unsafe identity'):b.snapshot()
        alias=self.root/'hardlink';os.link(b.lock,alias)
        with self.assertRaisesRegex(core.Refused,'unsafe identity'):b.snapshot()
        self.assertEqual(b.lock.stat().st_nlink,2);alias.unlink()
        b.lock.unlink();b.lock.mkdir()
        with self.assertRaisesRegex(core.Refused,'unsafe identity'):b.snapshot()

    def test_Q1_R4_fixed_inode_replacement_during_acquisition_holds(self):
        b=self.b;real_flock=fcntl.flock;retained=self.root/'old-lock'
        def replace(fd,operation):
            real_flock(fd,operation)
            b.lock.rename(retained);b.lock.write_text('replacement');b.lock.chmod(0o640)
        with patch.object(C.fcntl,'flock',side_effect=replace),self.assertRaisesRegex(core.Refused,'inode changed HOLD'):
            b.snapshot()
        self.assertEqual(b.lock.read_text(),'replacement');self.assertEqual(retained.read_bytes(),b'')

    def test_Q1_R4_snapshot_lock_released_before_worker_lease_and_git(self):
        f=Controls();f.setUp();self.addCleanup(f.doCleanups);b=Accounting(f.root,f.state)
        C.root_metadata.side_effect=lambda reader,slot,policy,**kw:b.snapshot(slot,policy)
        def free():
            fd=os.open(b.lock,os.O_RDONLY)
            try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            finally:os.close(fd)
        f.bridge.stopped_writer.side_effect=lambda *a,**kw:free()
        f.bridge.git.side_effect=lambda *a,**kw:(free(),f.git(*a,**kw))[1]
        f.api.side_effect=lambda *a,**kw:(free(),f.api_call(*a,**kw))[1]
        f.rt.lease.side_effect=lambda *a,**kw:free()
        # These assertions run at the fork boundary and in actual Store perform.
        req=f.request()
        with patch.object(R.os,'fork',side_effect=lambda:(free(),880000)[1]), \
             patch.object(R,'identity',return_value={'pid':880000,'start':'5','boot':'test'}):
            R.handle(req,f.policy)
        f.worker(req);free()


class Inventory(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='inventory-');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.here=self.root/'lib';self.here.mkdir()
        self.state=self.root/'state';self.state.mkdir()
        self.policy=self.root/'policy.json';A.atomic(self.policy,{'controller_sha':'c'*40})
        self.real_read=R.read;self.reads=[]
        self.external={str(Path('/usr/local/sbin/gb-deploy-helper.sh')):self.root/'helper',
            '/usr/local/lib/gb-ops-monitor/opsmon/writer.py':self.root/'writer',
            '/usr/local/lib/gb-ops-monitor/web/app.js':self.root/'app'}
        def read(path,owner=None,*args,**kwargs):
            # Synthetic root ownership is substituted only here. The actual
            # nofollow/mode/nlink/bounds reader still reads every retained byte.
            self.assertEqual(owner,0);self.reads.append(str(path))
            path=Path(self.external.get(str(path),path))
            value=self.real_read(path,os.getuid(),*args,**kwargs)
            if kwargs.get('snapshot'):value.update(uid=0,gid=0)
            return value
        self.reader=SimpleNamespace(HERE=self.here,STATE=self.state,POLICY=self.policy,read=read)
        manifest=core.loads((core.HERE/'manifest.json').read_bytes())
        pins={}
        for source in manifest['files']:
            prefix='scripts/chatops/actions_train/'
            if 'monitor_payload' in source:continue
            dest=self.here/source[len(prefix):] if source.startswith(prefix) else Path('/usr/local/sbin/gb-deploy-helper.sh')
            actual=Path(self.external.get(str(dest),dest));actual.parent.mkdir(parents=True,exist_ok=True)
            actual.write_bytes(('synthetic '+source).encode());actual.chmod(0o755 if actual==self.root/'helper' else 0o644)
            pins[str(dest)]=hashlib.sha256(actual.read_bytes()).hexdigest()
        rules=self.here/'accepted-engineering-rules.md';rules.write_text('synthetic accepted rules')
        rules.chmod(0o644);pins[str(rules)]=hashlib.sha256(rules.read_bytes()).hexdigest()
        for dest,actual in self.external.items():
            if actual.exists():continue
            actual.write_text('external synthetic');actual.chmod(0o644)
            pins[dest]=hashlib.sha256(actual.read_bytes()).hexdigest()
        self.record=dict(schema='GB_ACTIONS_TRAIN_BACKUP_V1',manifest='f'*64,before={p:None for p in pins},
                         after=pins,targets=list(pins),units={},activated=False)
        A.atomic(self.state/'backup.json',self.record)
        self.p={'controller_sha':'c'*40}

    def inventory(self):return C.installed_inventory(self.reader,self.p)

    def partial(self):
        # Model the existing Stage5 transaction, including retained OLD inventory
        # and actual preimages, rather than inventing a live attestation.
        backup=self.state/'stage5-cursor-context-backup';backup.mkdir()
        A.atomic(backup/'inventory',self.record)
        before=self.reader.read(backup/'inventory',0,snapshot=True)
        changes={}
        for name in ('stage.py','context_cursor_delivery.py'):
            path=self.here/name;old=self.reader.read(path,0,snapshot=True,json_data=False)
            raw=path.read_bytes();(backup/name).write_bytes(raw);(backup/name).chmod(0o600)
            path.write_bytes(raw+b' reviewed NEW')
            new=self.reader.read(path,0,snapshot=True,json_data=False)
            meta=lambda v:{k:v[k] for k in ('sha256','uid','gid','mode')}
            changes[name]=dict(before=meta(old),after=meta(new))
            self.record['after'][str(path)]=new['sha256']
        A.atomic(self.state/'backup.json',self.record)
        imeta=self.reader.read(self.state/'backup.json',0,snapshot=True)
        identity=dict(baseline='c'*40,controller='d'*40,stage_sha256='a'*64,dispatch_sha256='b'*64,
                      manifest='c'*64,bundle_commit='e'*40,bundle_branch='dev',script_sha256='d'*64)
        j=dict(schema='GB_STAGE5_CURSOR_LIB_ONLY_V2',identity=identity,identity_sha256=core.digest(identity),
            phase='installed-lib-only',installed_at=100,changes=changes,inventory_before=meta(before),
            inventory_after=meta(imeta),policy=meta(self.reader.read(self.policy,0,snapshot=True)),
            preserved={'historical':'untouched'},shadow=None)
        A.atomic(self.state/'stage5-cursor-context.json',j)
        return j

    def test_no_library_manifest_real_after_inventory_and_partial_update(self):
        result=self.inventory()
        self.assertFalse((self.here/'manifest.json').exists())
        self.assertEqual(result['inventory']['value'],self.record)
        j=self.partial();result=self.inventory()
        self.assertEqual(result['transition']['value'],j)
        self.assertNotEqual(j['changes']['stage.py']['before']['sha256'],j['changes']['stage.py']['after']['sha256'])
        self.assertNotIn(str(self.here/'manifest.json'),self.reads)

    def test_real_32_path_baseline_and_new_partial_library_inventory(self):
        for name in ('admission_pm.py','context_cursor_delivery.py','context_native_delivery.py',
                     'native_antigravity_author.py','scheduling_control.py','smart_routing.py','test_plan_gate.py'):
            path=self.here/name;path.unlink()
            for field in ('after','before'):self.record[field].pop(str(path))
            self.record['targets'].remove(str(path))
        self.assertEqual(len(self.record['after']),32)
        A.atomic(self.state/'backup.json',self.record);self.inventory()
        # A missing library really is added: before=None, without OLD==NEW.
        backup=self.state/'stage5-cursor-context-backup';backup.mkdir()
        A.atomic(backup/'inventory',self.record)
        oldmeta=self.reader.read(backup/'inventory',0,snapshot=True)
        meta=lambda v:{k:v[k] for k in ('sha256','uid','gid','mode')}
        stage=self.here/'stage.py';before=meta(self.reader.read(stage,0,snapshot=True,json_data=False))
        (backup/'stage.py').write_bytes(stage.read_bytes());(backup/'stage.py').chmod(0o600)
        stage.write_bytes(stage.read_bytes()+b' NEW')
        new=self.here/'context_cursor_delivery.py';new.write_bytes(b'new reviewed library');new.chmod(0o644)
        changes={}
        for name,prior in (('stage.py',before),('context_cursor_delivery.py',None)):
            path=self.here/name;after=meta(self.reader.read(path,0,snapshot=True,json_data=False))
            changes[name]=dict(before=prior,after=after);self.record['after'][str(path)]=after['sha256']
        A.atomic(self.state/'backup.json',self.record)
        ident=dict(baseline='c'*40,controller='d'*40,stage_sha256='a'*64,dispatch_sha256='b'*64,
                   manifest='c'*64,bundle_commit='e'*40,bundle_branch='dev',script_sha256='d'*64)
        A.atomic(self.state/'stage5-cursor-context.json',dict(schema='GB_STAGE5_CURSOR_LIB_ONLY_V2',
            identity=ident,identity_sha256=core.digest(ident),phase='installed-lib-only',installed_at=100,
            changes=changes,inventory_before=meta(oldmeta),inventory_after=meta(self.reader.read(self.state/'backup.json',0,snapshot=True)),
            policy=meta(self.reader.read(self.policy,0,snapshot=True)),preserved={},shadow=None))
        self.assertEqual(len(self.inventory()['inventory']['value']['after']),33)

    def test_inventory_byte_mode_missing_foreign_and_symlink_negatives(self):
        path=self.here/'stage.py';raw=path.read_bytes()
        path.write_bytes(b'drift')
        with self.assertRaisesRegex(core.Refused,'byte/mode'):self.inventory()
        path.write_bytes(raw);path.chmod(0o600)
        with self.assertRaisesRegex(core.Refused,'byte/mode'):self.inventory()
        path.chmod(0o644);path.unlink()
        with self.assertRaises(FileNotFoundError):self.inventory()
        path.symlink_to(self.here/'core.py')
        with self.assertRaisesRegex(core.Refused,'indirect'):self.inventory()
        path.unlink();path.write_bytes(raw);path.chmod(0o644)
        self.record['after']['/foreign/file']='0'*64;A.atomic(self.state/'backup.json',self.record)
        with self.assertRaisesRegex(core.Refused,'membership'):self.inventory()

    def test_partial_upgrade_crash_old_bytes_inventory_and_dependency_tamper(self):
        j=self.partial();path=self.state/'stage5-cursor-context.json'
        for phase in ('applying','preparing','rolling-back','rolled-back'):
            A.atomic(path,dict(j,phase=phase))
            with self.subTest(phase=phase),self.assertRaisesRegex(core.Refused,'ACTIVE_OR_UNKNOWN'):self.inventory()
        A.atomic(path,j)
        backup=self.state/'stage5-cursor-context-backup/stage.py';backup.write_bytes(b'bad OLD')
        with self.assertRaisesRegex(core.Refused,'OLD bytes'):self.inventory()
        backup.write_bytes(('synthetic scripts/chatops/actions_train/stage.py').encode())
        dep=self.here/'native_guard.py';dep.write_bytes(b'unreviewed dependency')
        self.record['after'][str(dep)]=hashlib.sha256(dep.read_bytes()).hexdigest()
        A.atomic(self.state/'backup.json',self.record)
        with self.assertRaisesRegex(core.Refused,'inventory/policy drift'):self.inventory()

    def test_unrecognized_relevant_transaction_holds_instead_of_ignoring_hashes(self):
        A.atomic(self.state/'other-upgrade.json',dict(schema='unknown',phase='applying',
            changes={str(self.here/'native_guard.py'):{'before':'a'*64,'after':'b'*64}}))
        with self.assertRaisesRegex(core.Refused,'unsupported installed transaction closure HOLD'):self.inventory()


class HostedControl(unittest.TestCase):
    def setUp(self):
        import client
        self.client=client
        self.temp=tempfile.TemporaryDirectory(prefix='hosted-control-');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.cwd=Path.cwd();os.chdir(self.root);self.addCleanup(os.chdir,self.cwd)
        self.env=patch.dict(os.environ,dict(GITHUB_REF='refs/heads/dev',GITHUB_RUN_ID='100',
            GITHUB_RUN_ATTEMPT='1',GH_TOKEN=TOKEN,GITHUB_OUTPUT=str(self.root/'output')))
        self.env.start();self.addCleanup(self.env.stop)
        self.descriptor=dict(stage='resume',slot='slot1',issue=450,head=HEAD,phase='qa',attempt=2,
            generation=18,profile='auto',control=dict(comment=1000,snapshot='a'*64,archive='b'*64,
            operation=None,proof=None,base=BASE,pr=900))
        self.req=dict(client.dispatch_request(self.descriptor),gh_token=TOKEN)
        stamp=dt.datetime.now(dt.timezone.utc).isoformat()
        self.comment=dict(id=1000,user={'id':core.OWNER},
            issue_url=f'https://api.github.com/repos/{core.REPO}/issues/450',created_at=stamp,updated_at=stamp,
            body=C.MARKER+'\n'+json.dumps(C.admission_body(self.req)))
        self.api=Mock(return_value=self.comment);self.api.identity=Mock()
        self.key=core.digest(core.binding(self.req))
        self.receipt=dict(status='confirmed',scheduling_only=True,archive='b'*64,archive_sha256='c'*64,next_stage='ci')
        self.found=dict(schema=core.CONTROL_CAPABILITY,key=self.key,slot='slot1',generation=19,
            status='confirmed',binding=core.binding(self.req),admission=C.admission(self.req,self.api),result=self.receipt)
        self.cap=dict(capabilities=[core.CONTROL_CAPABILITY],mode='active',controller_sha='c'*40)

    def test_both_closed_validators_legacy_and_whole_batch_before_dispatch(self):
        ordinary={k:v for k,v in self.descriptor.items() if k!='control'};ordinary['stage']='ci'
        api=Mock();ssh=Mock(return_value=self.cap)
        self.client.dispatch_descriptors(api,[ordinary,self.descriptor],ssh=ssh)
        self.assertEqual(api.call_count,2)
        for bad in (dict(ordinary,control=self.descriptor['control']),dict(self.descriptor,_control={}),
                    dict(self.descriptor,control=dict(self.descriptor['control'],private_intent=True))):
            api.reset_mock();ssh.reset_mock()
            with self.subTest(bad=bad),self.assertRaises(core.Refused):
                self.client.dispatch_descriptors(api,[ordinary,bad],ssh=ssh)
            api.assert_not_called();ssh.assert_not_called()
            with self.assertRaises(core.Refused):self.client.execute(self.api,ssh,bad)
            ssh.assert_not_called()

    def test_old_server_refuses_before_dispatch_or_mutating_submission(self):
        ssh=Mock(return_value={'mode':'active','slots':{}});api=Mock()
        with self.assertRaisesRegex(core.Refused,'capability'):
            self.client.dispatch_descriptors(api,[self.descriptor],ssh=ssh)
        api.assert_not_called()
        with self.assertRaisesRegex(core.Refused,'capability'):self.client.execute(self.api,ssh,self.descriptor)
        self.assertTrue(all(call.args[0]['stage']=='status' for call in ssh.call_args_list))

    def test_lost_reply_queries_exact_authenticated_receipt_once_and_continues(self):
        ssh=Mock(side_effect=[self.cap,TimeoutError('lost reply'),self.found])
        self.client.execute(self.api,ssh,self.descriptor)
        calls=[c.args[0] for c in ssh.call_args_list]
        self.assertEqual([r['stage'] for r in calls],['status','resume','status'])
        self.assertEqual(calls[-1],dict(action='train',stage='status',slot='slot1',operation=self.key))
        self.assertIn('changed=true',(self.root/'output').read_text())
        self.assertNotIn(TOKEN,(self.root/'evidence/stage.json').read_text())

    def test_delayed_missing_then_running_queries_do_not_repeat_effect(self):
        missing=dict(self.found,status='not_found',binding=None,admission=None,result=None)
        running=dict(self.found,status='running',result=None)
        ssh=Mock(side_effect=[self.cap,dict(status='running',key=self.key),missing,running,self.found])
        with patch.object(self.client.time,'sleep'):
            self.client.execute(self.api,ssh,self.descriptor)
        self.assertEqual(sum(c.args[0]['stage']=='resume' for c in ssh.call_args_list),1)
        self.assertTrue(all(c.args[0].get('operation')==self.key for c in ssh.call_args_list[2:]))

    def test_Q2_R2_independent_client_server_reads_lost_reply_status_only(self):
        client_comment=copy.deepcopy(self.comment);server_comment=copy.deepcopy(self.comment)
        server_comment.update(reactions={'total_count':7,'heart':7},author_association='OWNER')
        server_comment['user'].update(login='changed',avatar_url='https://example.invalid/new')
        server_api=Mock(return_value=server_comment);server_api.identity=Mock()
        # Both independently authenticated reads use the same production helper.
        self.api.side_effect=lambda *a:copy.deepcopy(client_comment)
        self.api.reset_mock()  # setUp computed the synthetic receipt using admission().
        self.found['admission']=C.admission(self.req,server_api)
        missing=dict(self.found,status='not_found',binding=None,admission=None,result=None)
        running=dict(self.found,status='running',result=None)
        ssh=Mock(side_effect=[self.cap,TimeoutError('lost reply'),missing,running,self.found])
        with patch.object(self.client.time,'sleep'):self.client.execute(self.api,ssh,self.descriptor)
        calls=[call.args[0] for call in ssh.call_args_list]
        self.assertEqual(sum(req['stage']=='resume' for req in calls),1)
        self.assertTrue(all(req==dict(action='train',stage='status',slot='slot1',operation=self.key)
                            for req in calls[2:]))
        server_api.identity.assert_called_once();self.api.identity.assert_called_once()

    def test_Q2_R5_legacy_digest_mixed_versions_and_malformed_capabilities_fail_closed(self):
        old=dict(self.found,admission=core.digest(self.comment))
        ssh=Mock(side_effect=[self.cap,dict(status='running',key=self.key),old])
        with self.assertRaisesRegex(core.Refused,'admission/binding mismatch'):
            self.client.execute(self.api,ssh,self.descriptor)
        self.assertEqual(sum(c.args[0]['stage']=='resume' for c in ssh.call_args_list),1)
        self.assertEqual(old['admission'],core.digest(self.comment))
        for cap in ({},dict(self.cap,capabilities=[]),dict(self.cap,capabilities=['unknown']),
                    dict(self.cap,capabilities=core.CONTROL_CAPABILITY)):
            ssh=Mock(return_value=cap)
            with self.subTest(cap=cap),self.assertRaises(core.Refused):
                self.client.execute(self.api,ssh,self.descriptor)
            self.assertTrue(all(c.args[0]['stage']=='status' for c in ssh.call_args_list))

    def test_timeout_missing_or_unrelated_outcome_never_succeeds_or_replays(self):
        missing=dict(self.found,status='not_found',binding=None,admission=None,result=None)
        ssh=Mock(side_effect=[self.cap,dict(status='running',key=self.key),missing])
        with patch.object(self.client.time,'monotonic',side_effect=[0,2301]):
            with self.assertRaisesRegex(core.Refused,'unresolved'):self.client.execute(self.api,ssh,self.descriptor)
        self.assertIn('changed=false',(self.root/'output').read_text())
        for changed in (dict(self.found,key='f'*64),dict(self.found,binding=dict(core.binding(self.req),issue=999)),
                        dict(self.found,admission='f'*64),dict(self.found,result=dict(self.receipt,next_stage='shell'))):
            ssh=Mock(side_effect=[self.cap,dict(status='running',key=self.key),changed])
            with self.subTest(changed=changed),self.assertRaises(core.Refused):
                self.client.execute(self.api,ssh,self.descriptor)
            self.assertEqual(sum(c.args[0]['stage']=='resume' for c in ssh.call_args_list),1)


class SharedUsage(unittest.TestCase):
    def test_Q1_R5_closed_usage_history_rotating_chain_and_protected_metadata(self):
        reader=SimpleNamespace(AUTONOMY=Path('/synthetic'))
        path='/synthetic/outbox/slot2/ledger.json';backup=path+'.bak'
        def usage(n):return {'2026-10-25':{},'2026-10-26':{'cursor':{}},'2026-10-27':{'codex':{'qa':n,'author':0}}}
        def entry(value):
            raw=json.dumps(value,sort_keys=True).encode()
            return dict(value=value,uid=1,gid=1,mode=0o644,size=len(raw),sha256=hashlib.sha256(raw).hexdigest())
        frozen={path:entry(usage(2)),backup:entry(usage(1)),
            'policy':{'pin':'old'},'config':{'limit':100},'grant':{'used':1},
            'reservation':{'operation':'old'},'installed':{'pin':'old'},'unknown-accounting':{'n':1},
            '/synthetic/outbox/slot1/ledger.json':entry(usage(2))}
        current=copy.deepcopy(frozen);current[path]=entry(usage(5));current[backup]=entry(usage(4))
        req=dict(slot='slot1',stage='park');C.preserved_control(reader,req,frozen,current)
        bad_values=[{}, {'2026-10-27':{'codex':{'qa':5,'author':0}}},
            dict(usage(5),**{'2026-10-26':{}}), usage(1),
            dict(usage(5),**{'2026-10-27':{'codex':{'qa':5}}}),
            dict(usage(5),**{'2026-10-27':{'codex':{'qa':True}}}),
            dict(usage(5),**{'2026-10-27':{'codex':{'qa':-1}}}),
            dict(usage(5),**{'2026-10-27':{'codex':{'qa':5.0}}}),
            dict(usage(5),**{'2026-10-27':{'alien':{'qa':5}}}),
            dict(usage(5),**{'2026-10-27':{'codex':{'ops':5}}}),
            {'schema':'unsupported'},[],dict(usage(5),**{'tomorrow':{}})]
        negatives=[dict(current,**{path:entry(value)}) for value in bad_values]
        negatives += [dict(current,**{backup:None}),dict(current,**{backup:entry(usage(0))}),
                      dict(current,**{backup:entry(usage(6))}),dict(current,**{backup:entry(usage(1))})]
        for field in ('uid','gid','mode'):
            for target in (path,backup):
                bad=copy.deepcopy(current);bad[target][field]+=1;negatives.append(bad)
        for field in ('policy','config','grant','reservation','installed','unknown-accounting',
                      '/synthetic/outbox/slot1/ledger.json'):
            bad=copy.deepcopy(current);bad[field]={'changed':True};negatives.append(bad)
        bad=copy.deepcopy(current);del bad['reservation'];negatives.append(bad)
        bad=copy.deepcopy(current);bad['extra']={};negatives.append(bad)
        raw_change=copy.deepcopy(frozen);raw_change[path]['sha256']='f'*64;negatives.append(raw_change)
        no_charge=copy.deepcopy(frozen);no_charge[backup]=entry(usage(2));negatives.append(no_charge)
        for bad in negatives:
            before=copy.deepcopy(bad)
            with self.subTest(bad=bad),self.assertRaises(core.Refused):C.preserved_control(reader,req,frozen,bad)
            self.assertEqual(bad,before)
        self.assertEqual(frozen[path],entry(usage(2)))
        absent={path:None,backup:None}
        with self.assertRaisesRegex(core.Refused,'missing usage preimage'):
            C.preserved_control(reader,req,absent,{path:entry(usage(2)),backup:None})

    def test_monotonic_progress_backups_and_accounting_tamper(self):
        reader=SimpleNamespace(AUTONOMY=Path('/synthetic'))
        path='/synthetic/outbox/slot1/ledger.json'
        def entry(n):return dict(value={'2026-10-27':{'codex':{'qa':n}}},uid=1,gid=1,mode=420,sha256=core.digest(n))
        frozen={'installed':{'exact':'pin'},'grant':{'used_calls':2},path:entry(2),path+'.bak':entry(1)}
        current=dict(frozen,**{path:entry(5),path+'.bak':entry(4)})
        C.preserved_since_park(reader,frozen,current)
        for bad in (dict(current,**{path:entry(1)}),dict(current,**{path+'.bak':entry(0)}),
                    dict(current,grant={'used_calls':1}),dict(current,grant={'used_calls':3})):
            with self.subTest(bad=bad),self.assertRaises(core.Refused):C.preserved_since_park(reader,frozen,bad)
        self.assertEqual(frozen[path],entry(2))


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
    def test_real_controller_sources_unrelated_dev_advance_requires_provable_closure(self):
        import subprocess
        with tempfile.TemporaryDirectory(prefix='actual-controller-closure-') as temp:
            repo=Path(temp)
            def git(*args,**kw):
                return subprocess.check_output(['/usr/bin/git','-c','core.hooksPath=/dev/null',
                    '-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid',*args],
                    cwd=repo,text=True).strip()
            git('init','-q')
            # Actual production dependency bytes, never executed in this test.
            for source in core.HERE.rglob('*.py'):
                target=repo/'scripts/chatops/actions_train'/source.relative_to(core.HERE)
                target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(source.read_bytes())
            git('add','.');git('commit','-qm','actual controller source closure');base=git('rev-parse','HEAD')
            handoff=repo/'docs/handoffs/other-task.md';handoff.parent.mkdir(parents=True)
            handoff.write_text('unrelated completed work');git('add','.');git('commit','-qm','unrelated completion')
            dev=git('rev-parse','HEAD');self.assertEqual(git('merge-base',base,dev),base)
            snapshot=dict(base=base,head=base,phase='ci')
            bridge=SimpleNamespace(work=repo,git=git)
            before=git('status','--porcelain');original=copy.deepcopy(snapshot)
            with self.assertRaisesRegex(core.Refused,'dependency compatibility HOLD'):
                C.compatible_dev(bridge,snapshot,dev)
            self.assertEqual(snapshot,original);self.assertEqual(git('status','--porcelain'),before)

    def test_secure_metadata_preserves_raw_hash_and_refuses_symlink(self):
        with tempfile.TemporaryDirectory(prefix='scheduling-metadata-') as temp:
            path=Path(temp)/'receipt.json';path.write_bytes(b'{"calls": 2}\n');path.chmod(0o600)
            info=R.read(path,os.getuid(),snapshot=True)
            self.assertEqual(info['sha256'],hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(info['value'],{'calls':2})
            self.assertEqual(R.read(path,os.getuid(),json_data=False),path.read_bytes())
            with self.assertRaisesRegex(core.Refused,'owner mismatch'):R.read(path,os.getuid()+1)
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

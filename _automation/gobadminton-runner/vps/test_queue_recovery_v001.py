"""Author integration tests: disposable origin/runtime, never independent QA."""
import copy, hashlib, json, multiprocessing, unittest
from unittest import mock
from contextlib import ExitStack
from pathlib import Path
import autopilot, backlog_sync, runner
import publication_guard as guard
import queue_recovery as recovery
import test_backlog_sync_v001 as base
import test_backlog_sync_repair02_v001 as r02
from test_backlog_sync_v001 import task, git, as_bytes


def competing_reserve(root, evidence, pipe):
    entry,_=recovery.prepare(Path(root),evidence,autopilot.durable_create_notice)
    pipe.send(bool(recovery.reserve(Path(root),entry['key'])));pipe.close()


class RecoveryTests(unittest.TestCase):
    restore_runner=base.BacklogSyncTests.restore_runner
    update_canonical=base.BacklogSyncTests.update_canonical
    set_state=base.BacklogSyncTests.set_state
    producer_fixture=r02.Repair02Tests.producer_fixture

    def setUp(self):
        base.BacklogSyncTests.setUp(self)
        stack=ExitStack();self.addCleanup(stack.close)
        fields={'ROOT':self.runtime,'BACKLOG_PATH':self.runtime/'backlog.json',
            'RUNNER_STATE_PATH':self.runtime/'state.json','AUTOPILOT_STATE_PATH':self.runtime/'autopilot-state.json',
            'AUTOPILOT_LOG_PATH':self.runtime/'autopilot.log','AUTOPILOT_RECEIPT_PATH':self.runtime/'autopilot-receipt.json',
            'OWNER_INBOX_DIR':self.runtime/'owner-inbox','CONFIG_PATH':self.runtime/'config.json'}
        for k,v in fields.items():stack.enter_context(mock.patch.object(autopilot,k,v))
        for k,v in {'STATE_PATH':self.runtime/'state.json','ROOT':self.runtime,'RUNNER_V2_PROGRESS_DIR':self.runtime/'progress',
                    'PROGRESS_PATH':self.runtime/'progress.json','AUTOPILOT_WAKE_PATH':self.runtime/'wake.json','LOG_PATH':self.runtime/'runner.log'}.items():
            stack.enter_context(mock.patch.object(runner,k,v))
        stack.enter_context(mock.patch.object(autopilot,'any_gobadminton_cursor_active',return_value=(False,'')))
        self.cfg={'workspace':str(self.work),'project':'GoBadminton','prod_authorized':False,'max_parallel':2}
        (self.runtime/'config.json').write_text(json.dumps(self.cfg));self.ap={};self.calls=0

    def fixture(self,verdict='FAIL'):
        self.producer,self.qa,self.produced,st=self.producer_fixture()
        self.producer.update(enabled=False,status='completed');self.web['enabled']=False
        self.qa.update(enabled=False,status='qa_failed' if verdict=='FAIL' else 'qa_blocked')
        self.down=task('admin-a0b-source',order=3,accepted=[self.qa['id']],ref=self.ref)
        self.tasks=[self.web,self.producer,self.qa,self.down]
        self.set_state(history=st['history']+[{'id':self.qa['id'],'status':self.qa['status'],'verdict':verdict}])
        self.failed={'project':'GoBadminton','task_id':self.qa['id'],'ok':False,'verdict':verdict,'owner_blocker':False,
            'blocker_scope':'lane_local','candidate_sha':self.produced['candidate_sha'],'blocking_findings':['RBAC-DEFECT'],'result_ref':self.qa['source']}
        self.failed_path=self.runtime/'receipts'/(self.qa['id']+'.json');self.failed_path.write_text(json.dumps(self.failed))
        self.update_canonical(self.tasks);self.sync()

    def state(self):return json.loads((self.runtime/'state.json').read_text())
    def q(self):return json.loads((self.runtime/'backlog.json').read_text())
    def sync(self):
        r=backlog_sync.sync_once(self.work,self.runtime);self.ap['backlog_sync']=r
        self.assertIn(r['status'],{'SYNCED','IN_SYNC'},r);return r
    def evidence(self):
        runner.refresh_qa_candidate_refs(self.q(),self.state(),self.cfg,qa_tasks=[self.qa])
        return recovery.failure_evidence(self.qa['id'],self.q(),self.state())
    def entry(self):return next(iter(json.loads((self.runtime/'qa-recovery-ledger.json').read_text())['actions'].values()))
    def tick(self):return autopilot.recovery_tick(self.cfg,self.q(),self.state(),self.ap)
    def prepare(self):return recovery.prepare(self.runtime,self.evidence(),autopilot.durable_create_notice)

    def planner(self,cfg,owner_items,active_admission_only,*,locks=None,publish=True):
        self.calls+=1;notice=owner_items[0];e=json.loads((self.runtime/'qa-recovery-ledger.json').read_text())['actions'][notice['recovery_key']]
        lineage={'key':e['key'],'slice_id':e['evidence']['slice_id'],'attempt':e['attempt']}
        pid='admin-a0a-repair-'+str(e['attempt']).zfill(2)+'-source'
        self.pair=[task(pid,order=0,ref=self.ref),task('qa-'+pid,order=.1,deps=[pid],ref=self.ref)]
        if locks is not None:
            for t in self.pair:t['locks']=list(locks)
        for t in self.pair:t.update(effect_ceiling='source_only',recovery_from=lineage,base_sha=git(self.work,'rev-parse','HEAD'))
        ids=[t['id'] for t in self.pair];binding='docs/manifest/SYNTHETIC_RECOVERY_BINDING.json'
        (self.work/binding).write_text(json.dumps({'project':'GoBadminton','instructions':[{'id':notice['id'],
            'text_sha256':hashlib.sha256(notice['text'].strip().encode()).hexdigest(),'action':'enqueued','task_ids':ids}]}))
        self.backlog.write_bytes(as_bytes(self.q()['tasks']+self.pair))
        git(self.work,'add',binding,backlog_sync.CANONICAL_PATH)
        git(self.work,'commit','-qm','test: append recovery admission')
        if publish:git(self.work,'push','-q','origin','main')
        receipt={'ok':True,'project':'GoBadminton','action':'enqueued','task_ids':ids,'result_commit':git(self.work,'rev-parse','HEAD'),
                 'owner_binding_path':binding,'recovery_key':e['key'],'summary':'synthetic pair publication'}
        (self.runtime/'autopilot-receipt.json').write_text(json.dumps(receipt))
        return True,receipt['summary'],receipt

    def test_0_of_2_fail_one_admission_repeated_ticks_and_real_claim_pid(self):
        self.fixture()
        with mock.patch.object(autopilot,'launch_planner',side_effect=self.planner):
            self.tick();self.assertEqual(self.entry()['status'],'ADMITTED')
            for _ in range(5):self.tick()
        self.assertEqual(self.calls,1)
        selected,_=runner.select_runnable_tasks(self.q(),self.state(),self.cfg)
        self.assertEqual([t['id'] for t in selected],[self.pair[0]['id']]);c=runner.claim_task(selected[0])
        recovery.observe(self.runtime,self.q(),self.state(),lambda pid:True);self.assertEqual(self.entry()['status'],'ADMITTED')
        runner._v2_update_active(c['id'],{'agent_pid':12345})
        recovery.observe(self.runtime,self.q(),self.state(),lambda pid:pid==12345)
        self.assertEqual(self.entry()['status'],'RUNNING');self.assertEqual(self.entry()['claim_pid'],12345)

    def test_1_of_2_api_active_web_starts_without_planner(self):
        self.fixture();self.web['enabled']=True;self.update_canonical(self.tasks);self.sync()
        self.set_state(history=self.state()['history'],active={'existing-api':{'id':'existing-api','locks':['api'],'agent_pid':112}})
        with mock.patch.object(autopilot,'launch_planner') as p:self.tick();p.assert_not_called()
        selected,_=runner.select_runnable_tasks(self.q(),self.state(),self.cfg)
        self.assertEqual([t['id'] for t in selected],['web-live']);runner.claim_task(selected[0])
        self.assertEqual(self.state()['active']['existing-api']['agent_pid'],112)

    def occupied_slots(self):
        self.fixture();self.web['enabled']=True;self.update_canonical(self.tasks);self.sync()
        self.set_state(history=self.state()['history'],active={self.producer['id']:{'id':self.producer['id'],'locks':['api'],'agent_pid':11},
                self.web['id']:{'id':self.web['id'],'locks':['web'],'agent_pid':22}})
        st=self.state();st['attempts']={self.producer['id']:1,self.web['id']:2}
        (self.runtime/'state.json').write_text(json.dumps(st))

    def guarded_intake(self,locks):
        def planner(cfg,owner_items,active_admission_only):
            baseline=git(self.work,'rev-parse','HEAD')
            result=self.planner(cfg,owner_items,active_admission_only,locks=locks,publish=False)
            guard.publish_main(self.work,self.runtime,
                {'baseline':baseline,'active_admission_only':True},result[2])
            return result
        return planner

    def assert_failed_downstream_held(self):
        rows={r['id']:r for r in recovery.classify(self.q(),self.state(),self.cfg)}
        self.assertEqual(rows[self.down['id']]['status'],'TERMINAL_QA_DEPENDENCY')
        self.assertEqual(rows[self.down['id']]['failed_qa_ids'],[self.qa['id']])
        self.assertFalse(runner.dependencies_ready(self.down,self.q(),self.state())[0])

    def test_2_of_2_disjoint_source_intake_preserves_active_claim_bytes(self):
        self.occupied_slots();previous=self.q();failed=self.failed_path.read_bytes()
        before=(self.runtime/'state.json').read_bytes()
        with mock.patch.object(autopilot,'launch_planner',side_effect=self.guarded_intake(['docs'])):self.tick()
        self.assertEqual(before,(self.runtime/'state.json').read_bytes());self.assertEqual(self.entry()['status'],'ADMITTED')
        receipt=json.loads((self.runtime/'autopilot-receipt.json').read_text())
        self.assertEqual(recovery.validate_pair(self.entry(),previous,self.q(),receipt,self.state()),[t['id'] for t in self.pair])
        self.assertEqual(git(self.remote,'rev-parse','main'),receipt['result_commit'])
        self.assertEqual(self.entry()['attempt'],1);self.assertEqual(self.calls,1)
        self.assertEqual(self.failed_path.read_bytes(),failed);self.assert_failed_downstream_held()
        self.assertEqual(runner.select_runnable_tasks(self.q(),self.state(),self.cfg)[0],[])
        with self.assertRaises(RuntimeError):runner.claim_task(self.pair[0])
        self.assertEqual(before,(self.runtime/'state.json').read_bytes())

    def test_2_of_2_overlapping_api_intake_holds_before_publication_or_claim(self):
        self.occupied_slots();baseline=git(self.remote,'rev-parse','main')
        state=(self.runtime/'state.json').read_bytes();backlog=(self.runtime/'backlog.json').read_bytes()
        failed=self.failed_path.read_bytes()
        with mock.patch.object(autopilot,'launch_planner',side_effect=self.guarded_intake(['api'])):self.tick()
        self.assertEqual(self.entry()['status'],'HOLD');self.assertIn('overlaps active claim',self.entry()['reason'])
        self.assertEqual(self.entry()['attempt'],1);self.assertEqual(self.calls,1)
        self.assertEqual(git(self.remote,'rev-parse','main'),baseline)
        self.assertEqual((self.runtime/'backlog.json').read_bytes(),backlog)
        self.assertEqual((self.runtime/'state.json').read_bytes(),state)
        self.assertEqual(self.failed_path.read_bytes(),failed);self.assert_failed_downstream_held()
        self.assertTrue(all(t['effect_ceiling']=='source_only' and t['recovery_from']['key']==self.entry()['key'] for t in self.pair))
        self.assertEqual(self.pair[1]['depends_on_completed'],[self.pair[0]['id']])
        self.assertNotIn(self.pair[0]['id'],runner._v2_task_map(self.q()))
        with self.assertRaises(RuntimeError):runner.claim_task(self.pair[0])
        self.assertEqual((self.runtime/'state.json').read_bytes(),state)

    def test_recursive_and_legacy_dependency_terminal_classification(self):
        self.fixture();t=task('grandchild',ref=self.ref);t['notes']='depends_on_completed=admin-a0b-source.'
        q=self.q();q['tasks'].append(t);rows={r['id']:r for r in recovery.classify(q,self.state(),self.cfg)}
        self.assertEqual(rows['grandchild']['status'],'TERMINAL_QA_DEPENDENCY');self.assertEqual(rows['grandchild']['failed_qa_ids'],[self.qa['id']])

    def test_wait_lock_legitimate_dependency_owner_and_missing_merge(self):
        self.fixture();q=self.q();q['tasks']+=[task('fresh',ref=self.ref),task('waiting',deps=['fresh'],ref=self.ref),task('owner',enabled=False,ref=self.ref)]
        st=self.state();st['active']={'other':{'id':'other','locks':['api']}}
        rows={r['id']:r['status'] for r in recovery.classify(q,st,self.cfg)}
        self.assertEqual(rows['fresh'],'WAITING_LOCK');self.assertEqual(rows['waiting'],'WAITING_DEPENDENCY');self.assertEqual(rows['owner'],'WAITING_OWNER_RELEASE')
        st['history'][-1]={'id':self.qa['id'],'status':'completed'};q['tasks'][2]['status']='completed'
        self.assertEqual({r['id']:r['status'] for r in recovery.classify(q,st,self.cfg)}[self.down['id']],'PLANNER_REQUIRED')

    def test_completed_producer_missing_publication_requires_planner(self):
        self.fixture();q=self.q();q['tasks'][2].update(status='queued',enabled=True)
        st=self.state();st['history']=st['history'][:-1]
        git(self.remote,'update-ref','-d','refs/heads/impl/synthetic-producer')
        runner.refresh_qa_candidate_refs(q,st,self.cfg,qa_tasks=[q['tasks'][2]])
        rows={r['id']:r['status'] for r in recovery.classify(q,st,self.cfg)}
        self.assertEqual(rows[self.qa['id']],'PLANNER_REQUIRED')

    def test_disabled_preview_and_real_user_gates_never_admit_repairs(self):
        self.fixture();q=self.q();q['tasks'][-1]['enabled']=False
        with mock.patch.object(autopilot,'launch_planner') as p:
            self.assertFalse(autopilot.recovery_tick(self.cfg,q,self.state(),self.ap));p.assert_not_called()
        self.assertFalse((self.runtime/'owner-inbox').exists())

    def test_true_owner_and_blocked_noncode_hold(self):
        self.fixture('BLOCKED')
        with mock.patch.object(autopilot,'launch_planner') as p:self.tick();p.assert_not_called()
        self.assertEqual(self.ap['status'],'STOPPED_SAFE');self.assertIn('BLOCKED',self.ap['hold_reason'])
        self.failed.update(owner_blocker=True,blocker_scope='project_global');self.failed_path.write_text(json.dumps(self.failed))
        with self.assertRaises(recovery.RecoveryHold):self.evidence()

    def test_false_notice_ack_does_not_swallow_dispatch(self):
        self.fixture();e,n=self.prepare();path=self.runtime/'owner-inbox'/(n['id']+'.json')
        d=json.loads(path.read_text());d['status']='APPLIED';path.write_text(json.dumps(d))
        with mock.patch.object(autopilot,'launch_planner',side_effect=self.planner):self.tick()
        self.assertEqual(self.calls,1);self.assertEqual(self.entry()['status'],'ADMITTED');self.assertEqual(autopilot.pending_owner_instructions(),[])

    def test_crash_reserved_does_not_dispatch_twice(self):
        self.fixture();e,_=self.prepare();recovery.reserve(self.runtime,e['key'])
        with mock.patch.object(autopilot,'launch_planner') as p:
            for _ in range(3):self.tick()
            p.assert_not_called()
        self.assertEqual(self.entry()['attempt'],1);self.assertEqual(self.ap['status'],'STOPPED_SAFE')

    def test_crash_after_main_publish_adopts_verified_pair(self):
        self.fixture();before=self.q();before['_canonical_commit']=self.ap['backlog_sync']['canonical_commit']
        e,n=self.prepare();recovery.reserve(self.runtime,e['key'],baseline=before);self.planner(self.cfg,[n],True)
        with mock.patch.object(autopilot,'launch_planner') as p:self.tick();p.assert_not_called()
        self.assertEqual(self.entry()['status'],'ADMITTED')

    def test_false_receipt_never_admitted_or_replayed(self):
        self.fixture()
        with mock.patch.object(autopilot,'launch_planner',return_value=(True,'fake',{'ok':True,'project':'GoBadminton','action':'enqueued','recovery_key':'fake'})) as p:
            for _ in range(3):self.tick()
            self.assertEqual(p.call_count,1)
        self.assertEqual(self.entry()['status'],'HOLD');self.assertEqual(self.ap['status'],'STOPPED_SAFE')

    def test_receipt_without_main_publication_preserves_diagnostic(self):
        self.fixture()
        def no_push(*a,**kw):
            result=self.planner(*a,**kw);git(self.remote,'update-ref','refs/heads/main',self.ap['backlog_sync']['canonical_commit']);return result
        with mock.patch.object(autopilot,'launch_planner',side_effect=no_push):self.tick()
        self.assertEqual(self.entry()['status'],'HOLD');self.assertNotIn('admin-a0a-repair-01-source',runner._v2_task_map(self.q()))

    def test_corrupt_ledger_and_changed_receipt_preserve_bytes(self):
        self.fixture();self.prepare();p=self.runtime/'qa-recovery-ledger.json';raw=p.read_bytes();e=self.evidence();e['qa_digest']='b'*64
        with self.assertRaises(recovery.RecoveryHold):recovery.prepare(self.runtime,e,autopilot.durable_create_notice)
        self.assertEqual(p.read_bytes(),raw);p.write_text('[]')
        with self.assertRaises(recovery.RecoveryHold):self.prepare()
        self.assertEqual(p.read_text(),'[]')

    def test_two_process_timers_single_notice_and_dispatch(self):
        self.fixture();e=self.evidence();ctx=multiprocessing.get_context('fork');procs=[];pipes=[]
        for _ in range(2):
            parent,child=ctx.Pipe(duplex=False);p=ctx.Process(target=competing_reserve,args=(str(self.runtime),e,child));p.start();child.close();procs.append(p);pipes.append(parent)
        results=[p.recv() for p in pipes]
        for p in procs:p.join(10);self.assertEqual(p.exitcode,0)
        self.assertEqual(sorted(results),[False,True]);self.assertEqual(self.entry()['attempt'],1)
        self.assertEqual(len(list((self.runtime/'owner-inbox').glob('*.json'))),1)

    def test_five_attempts_across_names_and_candidates_other_lane_progresses(self):
        self.fixture();e=self.evidence();entry,_=self.prepare()
        for attempt in range(1,6):
            self.assertEqual(recovery.reserve(self.runtime,entry['key'])['attempt'],attempt);recovery.finish(self.runtime,entry['key'],'CLOSED')
            e=dict(e,failed_task_id='qa-successor-'+str(attempt),candidate_sha=str(attempt)*40,qa_digest=str(attempt)*64,predecessor_attempt=attempt)
            entry,_=recovery.prepare(self.runtime,e,autopilot.durable_create_notice)
        self.assertEqual(entry['status'],'HOLD');self.assertIn('five',entry['reason']);self.assertIsNone(recovery.reserve(self.runtime,entry['key']))
        q=self.q();q['tasks'][0]['enabled']=True
        self.assertIn('web-live',[t['id'] for t in runner.select_runnable_tasks(q,self.state(),self.cfg)[0]])

    def test_deleted_remote_branch_no_claim_state_corruption(self):
        self.fixture();raw=(self.runtime/'state.json').read_bytes();git(self.remote,'update-ref','-d','refs/heads/impl/synthetic-producer')
        with mock.patch.object(autopilot,'launch_planner') as p:self.tick();p.assert_not_called()
        self.assertEqual(self.ap['status'],'STOPPED_SAFE');self.assertEqual(raw,(self.runtime/'state.json').read_bytes())

    def test_uninspectable_writer_keeps_notice_unreserved(self):
        self.fixture()
        with mock.patch.object(autopilot,'any_gobadminton_cursor_active',return_value=(True,'unknown writer')):
            with mock.patch.object(autopilot,'launch_planner') as p:self.tick();p.assert_not_called()
        self.assertEqual(self.entry()['status'],'NOTICE');self.assertNotIn('attempt',self.entry())

    def test_sync_rejects_failed_dependency_removal_before_swap(self):
        self.fixture();raw=(self.runtime/'backlog.json').read_bytes();changed=copy.deepcopy(self.tasks);changed[-1]['depends_on_accepted']=[]
        self.update_canonical(changed);r=backlog_sync.sync_once(self.work,self.runtime)
        self.assertEqual(r['status'],'BLOCKED',r);self.assertIn('terminal QA dependency',r['reason']);self.assertEqual(raw,(self.runtime/'backlog.json').read_bytes())

    def test_new_same_failed_candidate_and_owner_release_rejected(self):
        self.fixture();e,n=self.prepare();reserved=recovery.reserve(self.runtime,e['key']);before=self.q()
        self.planner(self.cfg,[n],True);after=json.loads(self.backlog.read_text());receipt=json.loads((self.runtime/'autopilot-receipt.json').read_text())
        self.assertEqual(recovery.validate_pair(reserved,before,after,receipt,self.state()),receipt['task_ids'])
        for mutate in [lambda q:q['tasks'][-1].update(candidate_sha=self.failed['candidate_sha']),
                       lambda q:q['tasks'][0].update(enabled=True),lambda q:q['tasks'][3].update(depends_on_accepted=[self.pair[1]['id']])]:
            invalid=copy.deepcopy(after);mutate(invalid)
            with self.assertRaises(recovery.RecoveryHold):recovery.validate_pair(reserved,before,invalid,receipt,self.state())

    def test_claim_race_after_sync_before_verified_admission_is_held(self):
        self.fixture();original=recovery.finish;observed=[]
        def finish(root,key,status,**details):
            if status=='ADMITTED':
                with self.assertRaises(RuntimeError) as error:runner.claim_task(self.pair[0])
                observed.append(str(error.exception))
            return original(root,key,status,**details)
        with mock.patch.object(autopilot,'launch_planner',side_effect=self.planner),mock.patch.object(recovery,'finish',side_effect=finish):self.tick()
        self.assertIn('publication/admission not verified',observed[0]);self.assertEqual(self.entry()['status'],'ADMITTED')
        runner.claim_task(self.pair[0])

    def test_explicit_owner_release_starts_only_after_canonical_admission(self):
        self.fixture();before=self.state();q=self.q();q['tasks'][3]['enabled']=False
        self.update_canonical(q['tasks']);self.sync()
        with mock.patch.object(autopilot,'launch_planner') as p:self.assertFalse(self.tick());p.assert_not_called()
        q['tasks'][0]['enabled']=True;self.update_canonical(q['tasks']);self.sync()
        selected,_=runner.select_runnable_tasks(self.q(),before,self.cfg)
        self.assertEqual([t['id'] for t in selected],['web-live']);runner.claim_task(selected[0])

    def test_successor_failed_qa_creates_attempt_two_without_replaying_first(self):
        self.fixture()
        with mock.patch.object(autopilot,'launch_planner',side_effect=self.planner):self.tick()
        producer,qa=self.pair
        git(self.work,'checkout','-qb','impl/failed-first-repair')
        (self.work/'synthetic-code.txt').write_text('still defective repair')
        git(self.work,'add','synthetic-code.txt');git(self.work,'commit','-qm','first new repair')
        candidate=git(self.work,'rev-parse','HEAD');tree=git(self.work,'rev-parse',candidate+'^{tree}')
        git(self.work,'push','-q','origin','impl/failed-first-repair');git(self.work,'checkout','-q','main')
        (self.runtime/'receipts'/(producer['id']+'.json')).write_text(json.dumps({'ok':True,'project':'GoBadminton',
            'task_id':producer['id'],'candidate_sha':candidate,'candidate_tree':tree,'branch':'impl/failed-first-repair'}))
        runner.mark_completed(producer['id'],'synthetic first source')
        (self.runtime/'receipts'/(qa['id']+'.json')).write_text(json.dumps(dict(self.failed,task_id=qa['id'],candidate_sha=candidate,result_ref=qa['source'])))
        runner.mark_qa_terminal(qa['id'],'FAIL','still code defect')
        with mock.patch.object(autopilot,'launch_planner',side_effect=self.planner):
            self.tick();self.tick()
        ledger=json.loads((self.runtime/'qa-recovery-ledger.json').read_text());entries=list(ledger['actions'].values())
        self.assertEqual(len(entries),2);self.assertEqual(entries[0]['status'],'CLOSED')
        self.assertEqual(entries[1]['status'],'ADMITTED',entries[1].get('reason'));self.assertEqual(entries[1]['attempt'],2)
        self.assertEqual(self.calls,2);self.assertEqual(self.pair[0]['id'],'admin-a0a-repair-02-source')

    def test_global_gate_no_repair_and_live_planner_not_reset(self):
        self.fixture();st=self.state();st['global_gates']=['privacy']
        with mock.patch.object(autopilot,'launch_planner') as p:
            autopilot.recovery_tick(self.cfg,self.q(),st,self.ap);p.assert_not_called()
        self.assertEqual(self.ap['status'],'STOPPED_SAFE')
        (self.runtime/'autopilot-state.json').write_text(json.dumps({'planner_pid':42}))
        with mock.patch.object(autopilot,'pid_alive',return_value=True),mock.patch.object(autopilot,'ensure_worktree') as ensure:
            self.assertFalse(autopilot.launch_planner(self.cfg)[0]);ensure.assert_not_called()

    def test_e2e_fail_repair_independent_role_pass_merge_downstream_claim(self):
        self.fixture();failed_bytes=self.failed_path.read_bytes()
        with mock.patch.object(autopilot,'launch_planner',side_effect=self.planner):self.tick()
        producer,qa=self.pair;runner.claim_task(producer)
        git(self.work,'checkout','-qb','impl/new-repair');(self.work/'synthetic-code.txt').write_text('repaired RBAC\n')
        git(self.work,'add','synthetic-code.txt');git(self.work,'commit','-qm','source repair')
        candidate=git(self.work,'rev-parse','HEAD');tree=git(self.work,'rev-parse',candidate+'^{tree}')
        self.assertNotEqual(candidate,self.failed['candidate_sha']);git(self.work,'push','-q','origin','impl/new-repair');git(self.work,'checkout','-q','main')
        pp={'ok':True,'project':'GoBadminton','task_id':producer['id'],'candidate_sha':candidate,'candidate_tree':tree,'branch':'impl/new-repair'}
        (self.runtime/'receipts'/(producer['id']+'.json')).write_text(json.dumps(pp));runner.mark_completed(producer['id'],'synthetic source complete')
        self.sync();runner.claim_task(qa)
        qr={'ok':True,'project':'GoBadminton','task_id':qa['id'],'candidate_sha':candidate,'candidate_tree':tree,'verdict':'PASS',
            'blocking_findings':[],'merge_recommendation':'MERGE_RECOMMENDED'}
        qp=self.runtime/'receipts'/(qa['id']+'.json');qp.write_text(json.dumps(qr));runner.mark_completed(qa['id'],'synthetic QA role PASS')
        self.assertFalse(runner._v2_dependency_accepted(self.q(),self.state(),qa['id']))
        before=self.q();changed=copy.deepcopy(before);changed['tasks'][3]['depends_on_accepted']=[qa['id']]
        with self.assertRaises(backlog_sync.SyncBlocked):backlog_sync.verify_dependency_rebindings(self.work,self.runtime,runner._v2_task_map(before),runner._v2_task_map(changed),self.state(),git(self.work,'rev-parse','HEAD'))
        git(self.work,'merge','--no-ff','-qm','accepted exact synthetic source',candidate);git(self.work,'push','-q','origin','main');self.sync()
        self.assertTrue(runner._v2_dependency_accepted(self.q(),self.state(),qa['id']))
        for field,value in [('task_id','qa-wrong'),('candidate_sha',self.failed['candidate_sha']),('blocking_findings',['defect'])]:
            qp.write_text(json.dumps(dict(qr,**{field:value})));self.assertFalse(runner._v2_dependency_accepted(self.q(),self.state(),qa['id']))
        qp.write_text(json.dumps(qr));self.update_canonical(changed['tasks']);self.sync()
        selected,_=runner.select_runnable_tasks(self.q(),self.state(),self.cfg)
        self.assertEqual([t['id'] for t in selected],[self.down['id']]);runner.claim_task(selected[0])
        self.assertIn(self.down['id'],self.state()['active']);self.assertEqual(failed_bytes,self.failed_path.read_bytes())
        print('E2E_PROOF '+json.dumps({'failed_task_id':self.qa['id'],'failed_candidate_sha':self.failed['candidate_sha'],
            'repair_task_id':producer['id'],'repair_candidate_sha':candidate,'qa_task_id':qa['id'],'synthetic_qa_verdict':'PASS',
            'merge_sha':git(self.work,'rev-parse','HEAD'),'next_claimed_task_id':selected[0]['id'],'proof_kind':'AUTHOR_SYNTHETIC_NOT_INDEPENDENT_QA'},sort_keys=True))

if __name__=='__main__':unittest.main(verbosity=2)

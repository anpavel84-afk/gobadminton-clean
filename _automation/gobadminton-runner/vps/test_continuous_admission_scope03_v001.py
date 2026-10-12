"""Author checks: disposable Git/runtime; real HTTP lives in test_rmct_v001.
No installed code, live queue, runtime data, or external services are used.
"""
import copy
import fcntl
import hashlib
import json
from contextlib import ExitStack
import unittest
from unittest import mock
import autopilot
import backlog_sync
import publication_guard as guard
import runner
import test_backlog_sync_v001 as base
from test_backlog_sync_v001 import as_bytes, git, task


def pair(index, ref=base.S, enabled=True, locks=None):
    p={**task(f'producer-{index}',ref=ref,enabled=enabled,locks=locks or [f'lane:{index}']),'effect_ceiling':'source_only'}
    q={**task(f'qa-producer-{index}',ref=ref,enabled=enabled,deps=[p['id']],locks=p['locks']),'effect_ceiling':'source_only'}
    return [p,q]


def evidence(tasks, scopes=None):
    ids=[t['id'] for t in tasks]
    r={'ok':True,'project':'GoBadminton','action':'enqueued','task_ids':ids}
    b={'project':'GoBadminton','instructions':[{'id':'owner-source','action':'enqueued','task_ids':ids}]}
    if scopes is not None:r['admission_pairs']=scopes;b['admission_pairs']=copy.deepcopy(scopes)
    return r,b


class BatchTests(unittest.TestCase):
    def validate(self,tasks,before=None,state=None,scopes=None,change=None):
        r,b=evidence(tasks,scopes)
        if change:change(r,b)
        return guard.validate_admission_batch(before or {'tasks':[]},{'tasks':tasks},state or {'history':[],'active':{}},r,b)

    def test_one_to_four_complete_disjoint_pairs(self):
        for n in range(1,5):
            tasks=[t for i in range(n) for t in pair(i)]
            self.assertEqual(len(self.validate(tasks)),n)
            selected,_=runner.select_runnable_tasks({'tasks':tasks},{'active':{},'history':[]},{'max_parallel':4})
            self.assertEqual([t['id'] for t in selected],[f'producer-{i}' for i in range(n)])

    def test_five_or_orphan_duplicate_qa_unreported_delta_fail_closed(self):
        cases=[[t for i in range(5) for t in pair(i)],pair(1)[:1],pair(1)+[{**pair(1)[1],'id':'qa-duplicate'}],
               [{**pair(1)[1],'depends_on_completed':[]}]]
        for tasks in cases:
            with self.subTest(ids=[t['id'] for t in tasks]),self.assertRaises(backlog_sync.SyncBlocked):self.validate(tasks)
        for change in (lambda r,b:r.update(task_ids=r['task_ids'][:1]),lambda r,b:r.update(task_ids=r['task_ids']*2),
                       lambda r,b:b['instructions'][0].update(task_ids=[])):
            with self.assertRaises(backlog_sync.SyncBlocked):self.validate(pair(1),change=change)

    def test_hierarchical_global_path_and_dependency_overlap(self):
        for locks in (['lane'],['global'],['lane:1']):
            with self.assertRaises(backlog_sync.SyncBlocked):self.validate(pair(1)+pair(2,locks=locks))
        scopes=[{'producer_task_id':'producer-1','qa_task_id':'qa-producer-1','write_paths':['apps/web/**']},
                {'producer_task_id':'producer-2','qa_task_id':'qa-producer-2','write_paths':['apps/web/page.tsx']}]
        with self.assertRaises(backlog_sync.SyncBlocked):self.validate(pair(1)+pair(2),scopes=scopes)
        scopes[1]['write_paths']=['apps/api/'];self.assertEqual(len(self.validate(pair(1)+pair(2),scopes=scopes)),2)
        tasks=pair(1)+pair(2);tasks[2]['depends_on_completed']=['producer-1']
        with self.assertRaises(backlog_sync.SyncBlocked):self.validate(tasks)

    def test_future_ambiguous_paths_and_unbound_scopes(self):
        for path in ('../apps','/apps','apps//web','apps/./web','apps/*.py','apps\\web','**'):
            with self.subTest(path=path),self.assertRaises(backlog_sync.SyncBlocked):guard.normalized_paths([path])
        scopes=[{'producer_task_id':'producer-1','qa_task_id':'qa-producer-1','write_paths':['apps/api']}]
        with self.assertRaises(backlog_sync.SyncBlocked):self.validate(pair(1),scopes=scopes,change=lambda r,b:b.pop('admission_pairs'))
        tasks=pair(1);tasks[0]['file_scope']=['apps/web']
        with self.assertRaises(backlog_sync.SyncBlocked):self.validate(tasks)

    def test_active_terminal_and_effect_gates(self):
        active={**pair(9)[0],'locks':['lane:1']};r,b=evidence(pair(1))
        with self.assertRaises(backlog_sync.SyncBlocked):
            guard.validate_admission_batch({'tasks':[active]},{'tasks':[active,*pair(1)]},{'active':{active['id']:active}},r,b)
        for field,value in [('effect_ceiling','deploy'),('status','qa_blocked'),('source','floating-main')]:
            tasks=pair(1);tasks[0][field]=value
            with self.assertRaises(backlog_sync.SyncBlocked):self.validate(tasks)
        with self.assertRaises(backlog_sync.SyncBlocked):self.validate(pair(1),state={'history':[{'id':'qa-producer-1','status':'qa_failed'}]})

    def test_qa_only_requires_completed_own_producer(self):
        p,q=pair(1);p['status']='completed';r,b=evidence([q])
        state={'history':[{'id':p['id'],'status':'completed'}]}
        self.assertEqual(len(guard.validate_admission_batch({'tasks':[p]},{'tasks':[p,q]},state,r,b)),1)
        with self.assertRaises(backlog_sync.SyncBlocked):guard.validate_admission_batch({'tasks':[p]},{'tasks':[p,q]},{},r,b)

    def test_post_sync_claim_of_same_exact_pair_is_allowed(self):
        self.assertEqual(len(self.validate(pair(1),state={'active':{'producer-1':{'id':'producer-1','locks':['lane:1']}}})),1)


class SourceFixtureTests(unittest.TestCase):
    setUp=base.BacklogSyncTests.setUp
    restore_runner=base.BacklogSyncTests.restore_runner
    update_canonical=base.BacklogSyncTests.update_canonical
    set_state=base.BacklogSyncTests.set_state
    def sync(self):return backlog_sync.sync_once(self.work,self.runtime)

    def test_known_lock_drift_clears_but_real_unknown_and_collision_remain(self):
        self.sync();doc='docs/manifest/PM_ADMISSION_SCOPE03.md'
        tasks=[self.web,{**self.api,'locks':['runner-control']}]
        (self.work/doc).write_text('# SOURCE_ONLY_ADMITTED\nTask IDs: `missing-real-task`\nResource lock: `runner-control`\n')
        git(self.work,'add',doc);self.update_canonical(tasks);result=self.sync()
        self.assertEqual(result['admission_drift'][0]['disabled_queued_task_ids'],['missing-real-task'])
        meta=self.runtime/'backlog-sync-state.json';data=json.loads(meta.read_text())
        data['admission_drift'][0]['disabled_queued_task_ids'].append('runner-control');meta.write_text(json.dumps(data))
        self.assertEqual(self.sync()['admission_drift'][0]['disabled_queued_task_ids'],['missing-real-task'])
        disabled=task('runner-control',ref=self.ref,enabled=False)
        (self.work/doc).write_text('# SOURCE_ONLY_ADMITTED\n`runner-control`\n')
        git(self.work,'add',doc);self.update_canonical(tasks+[disabled])
        # A new real task/lock-name collision cannot erase the older unresolved
        # missing task when the same manifest is edited.
        self.assertEqual(self.sync()['admission_drift'][0]['disabled_queued_task_ids'],
                         ['missing-real-task','runner-control'])

    def prepare_publication(self,count=4,standby=()):
        prepared=[t for i in range(count) for t in pair(i,ref=self.ref,enabled=False)]
        self.update_canonical([self.web,self.api,*prepared,*standby]);self.sync()
        baseline=git(self.work,'rev-parse','HEAD');before=json.loads(self.backlog.read_text())
        enabled=[{**t,'enabled':True} for t in prepared];r,b=evidence(enabled)
        b['instructions'][0]['text_sha256']=hashlib.sha256(b'Exact approved source pairs').hexdigest()
        path='docs/manifest/OWNER_SCOPE03.json';(self.work/path).write_text(json.dumps(b));git(self.work,'add',path)
        self.backlog.write_bytes(as_bytes([self.web,self.api,*enabled,*standby]));git(self.work,'add',backlog_sync.CANONICAL_PATH)
        git(self.work,'commit','-qm','test: complete bounded batch');target=git(self.work,'rev-parse','HEAD')
        r.update(result_commit=target,owner_binding_path=path)
        return before,baseline,target,r

    def test_real_atomic_four_pair_publication_parity_and_runner_claims(self):
        fifth=task('fifth-approved-source',ref=self.ref,locks=['lane:fifth'])
        before,baseline,target,r=self.prepare_publication(standby=[fifth])
        guard.publish_main(self.work,self.runtime,{'baseline':baseline},r)
        result=self.sync();self.assertEqual(result['canonical_commit'],target,result)
        self.assertEqual(result['runtime_blob'],result['canonical_blob'])
        after=json.loads((self.runtime/'backlog.json').read_text())
        with mock.patch.object(autopilot,'BACKLOG_PATH',self.runtime/'backlog.json'):
            ok,reason=autopilot.verify_planner_publication({'workspace':str(self.work)},r,result,{**before,'_canonical_commit':baseline},
                after,[{'id':'owner-source','text':'Exact approved source pairs'}])
        self.assertTrue(ok,reason)
        self.set_state(history=[{'id':self.web['id'],'status':'completed'},{'id':self.api['id'],'status':'completed'}])
        state=backlog_sync.read_runner_state(self.runtime/'state.json')
        selected,_=runner.select_runnable_tasks(after,state,{'max_parallel':4});self.assertEqual(len(selected),4)
        with mock.patch.object(runner,'STATE_PATH',self.runtime/'state.json'),mock.patch.object(runner,'CONFIG_PATH',self.runtime/'config.json'):
            cfg=json.loads((self.runtime/'config.json').read_text());cfg['max_parallel']=4
            (self.runtime/'config.json').write_text(json.dumps(cfg))
            for p in selected:runner.claim_task(p)
            protected=(self.runtime/'state.json').read_bytes()
            with self.assertRaisesRegex(RuntimeError,'capacity'):
                runner.claim_task(fifth)
            self.assertEqual((self.runtime/'state.json').read_bytes(),protected)
        self.assertEqual(len(backlog_sync.read_runner_state(self.runtime/'state.json')['active']),4)

    def test_publication_lock_and_stale_main_stop_before_transport(self):
        _,baseline,target,r=self.prepare_publication(1)
        with (self.runtime/'planner-publication.lock').open('a+') as held:
            fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaisesRegex(backlog_sync.SyncBlocked,'writer'):guard.publish_main(self.work,self.runtime,{'baseline':baseline},r)
        git(self.work,'push','-q','origin',target+':refs/heads/main')
        with self.assertRaisesRegex(backlog_sync.SyncBlocked,'STALE_MAIN'):guard.publish_main(self.work,self.runtime,{'baseline':baseline},r)

    def test_stale_lease_race_cannot_rewrite_main(self):
        _,baseline,target,r=self.prepare_publication(1)
        git(self.work,'checkout','-qb','racer',baseline);(self.work/'docs/racer.md').write_text('independent writer\n')
        git(self.work,'add','docs/racer.md');git(self.work,'commit','-qm','racer');raced=git(self.work,'rev-parse','HEAD')
        git(self.work,'push','-q','origin','racer:refs/heads/racer')
        git(self.work,'checkout','-q','main');original=guard.pre_push
        def race(*args):original(*args);git(self.remote,'update-ref','refs/heads/main',raced)
        with mock.patch.object(guard,'pre_push',side_effect=race):
            with self.assertRaises(backlog_sync.SyncBlocked):guard.publish_main(self.work,self.runtime,{'baseline':baseline},r)
        self.assertEqual(git(self.remote,'rev-parse','main'),raced)

    def loop(self,wait,planner):
        paths={'CONFIG_PATH':'config.json','RUNNER_STATE_PATH':'state.json','BACKLOG_PATH':'backlog.json',
               'AUTOPILOT_STATE_PATH':'autopilot-state.json','AUTOPILOT_RECEIPT_PATH':'autopilot-receipt.json',
               'AUTOPILOT_WAKE_PATH':'wake.json','AUTOPILOT_LOCK_PATH':'autopilot.lock','AUTOPILOT_LOG_PATH':'autopilot.log','OWNER_INBOX_DIR':'owner-inbox'}
        with ExitStack() as stack:
            stack.enter_context(mock.patch.object(autopilot,'ROOT',self.runtime))
            for name,path in paths.items():stack.enter_context(mock.patch.object(autopilot,name,self.runtime/path))
            stack.enter_context(mock.patch.object(autopilot,'any_gobadminton_cursor_active',return_value=(False,'')))
            stack.enter_context(mock.patch.object(autopilot,'launch_planner',planner))
            stack.enter_context(mock.patch.object(autopilot,'wait_for_wake',side_effect=wait))
            with self.assertRaises(StopIteration):autopilot.main()

    def stop(self,timeout):raise StopIteration
    def completed_baseline(self):
        return [{'id':self.web['id'],'status':'completed'},{'id':self.api['id'],'status':'completed'}]

    def test_no_real_approved_work_does_not_launch_planner(self):
        self.set_state(history=self.completed_baseline());planner=mock.Mock();self.loop(self.stop,planner)
        planner.assert_not_called();self.assertEqual(json.loads((self.runtime/'autopilot-state.json').read_text())['status'],'STOPPED_SAFE')

    def test_unchanged_source_inputs_scan_once_even_on_wake_and_restart(self):
        self.update_canonical([self.web,self.api,*pair(1,ref=self.ref,enabled=False)])
        self.set_state(history=self.completed_baseline());planner=mock.Mock(return_value=(True,'exact gate',{'action':'no_safe_action'}))
        ticks=iter([{'event':'task_completed'},{'event':'qa_completed'}])
        self.loop(lambda timeout:next(ticks),planner);self.assertEqual(planner.call_count,1)
        self.loop(self.stop,planner);self.assertEqual(planner.call_count,1)

    def test_completion_wake_with_new_authority_plans_next_tick(self):
        prior=task('prior-source',ref=self.ref);prepared=pair(1,ref=self.ref,enabled=False)
        prepared[0]['depends_on_completed']=[prior['id']];self.update_canonical([self.web,self.api,prior,*prepared])
        history=self.completed_baseline();self.set_state(history=history)
        planner=mock.Mock(return_value=(True,'exact gate',{'action':'no_safe_action'}));calls=[]
        def wait(timeout):
            calls.append(timeout)
            if len(calls)==1:
                self.assertEqual(planner.call_count,0);self.set_state(history=history+[{'id':prior['id'],'status':'completed'}])
                return {'event':'task_completed','task_id':prior['id']}
            raise StopIteration
        self.loop(wait,planner);self.assertEqual(planner.call_count,1);self.assertTrue(all(n<=5 for n in calls))

    def test_active_claim_allows_only_disjoint_preapproved_intake(self):
        self.set_state(active={self.web['id']:{'id':self.web['id'],'locks':['web']}})
        prepared=pair(1,ref=self.ref,enabled=False,locks=['docs:source']);self.update_canonical([self.web,self.api,*prepared])
        planner=mock.Mock(return_value=(True,'exact gate',{'action':'no_safe_action'}));self.loop(self.stop,planner)
        self.assertTrue(planner.call_args.kwargs['active_admission_only'])
        for p in prepared:p['locks']=['web:header']
        self.update_canonical([self.web,self.api,*prepared])
        self.assertFalse(autopilot.approved_source_opportunity(json.loads(self.backlog.read_text()),
            backlog_sync.read_runner_state(self.runtime/'state.json'),{'max_parallel':4}))

    def test_stale_replan_once_only_on_unattempted_transport(self):
        stale=(False,'stale',{'error_code':'STALE_MAIN','publication_attempted':False})
        with mock.patch.object(autopilot,'ROOT',self.runtime),mock.patch.object(autopilot,'launch_planner',side_effect=[stale,stale]) as planner:
            self.assertEqual(autopilot.launch_planner_with_stale_retry({'workspace':str(self.work)}),stale)
            self.assertEqual(planner.call_count,2)
        for receipt in ({'error_code':'STALE_MAIN','publication_attempted':True},{},{'error_code':'OTHER','publication_attempted':False}):
            with mock.patch.object(autopilot,'launch_planner',return_value=(False,'error',receipt)) as planner:
                autopilot.launch_planner_with_stale_retry({'workspace':str(self.work)});self.assertEqual(planner.call_count,1)


if __name__=='__main__':unittest.main(verbosity=2)

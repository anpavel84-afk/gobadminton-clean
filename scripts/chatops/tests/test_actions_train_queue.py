"""Idle queue diagnostics and fair dispatch; no network, model calls or live state changes."""
import copy,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,Mock
from test_actions_train import A,S,core,receiver,monitor,ROOT,TASK,HEAD,active,card,req
import queue_diagnostics as q

class QueuePlanning(unittest.TestCase):
    def test_empty_queue_distinguishes_done_deferred_and_missing_admission(self):
        snap={'slots':{'slot1':card(),'slot2':card()}}
        snap['slots']['slot1']['done']=[151,157];snap['slots']['slot2']['parked']=[156]
        issues=[{'number':n} for n in (149,151,156,157)]
        r=q.explain(S,snap,issues,[(151,TASK),(156,TASK),(157,TASK)],[])
        self.assertEqual(r['counts']['not_admitted'],1);self.assertEqual(r['counts']['deferred'],1)
        self.assertEqual(r['counts']['done'],2);self.assertEqual(r['slots']['slot2']['reason'],'no_eligible_admission')
        self.assertTrue(q.valid_report(r))
    def test_oldest_idle_slot_selected_without_resetting_finished_history(self):
        snap={'slots':{'slot1':card(),'slot2':card()}}
        snap['slots']['slot1']['confirmed']={'confirmed_at':200};snap['slots']['slot2']['confirmed']={'confirmed_at':100}
        snap['slots']['slot2']['parked']=[156];before=copy.deepcopy(snap)
        plan=core.plan(A,S,snap,[(149,TASK)])
        self.assertEqual(plan[0]['slot'],'slot2');self.assertEqual(plan[0]['issue'],149)
        self.assertEqual(snap,before)
    def test_actual_unknown_or_exhausted_budget_does_not_claim(self):
        snap={'slots':{'slot1':card(),'slot2':card()}}
        for c in snap['slots'].values():c['availability']={'codex':{'author':False,'qa':True}}
        self.assertEqual(core.plan(A,S,snap,[(149,TASK)]),[])
        report=q.explain(S,snap,[{'number':149}],[(149,TASK)],[])
        self.assertEqual(report['decisions'][0]['code'],'unavailable')
        self.assertEqual(report['slots']['slot2']['reason'],'provider_or_budget')
    def test_disjoint_task_can_follow_deferred_task_but_not_its_dependency(self):
        snap={'slots':{'slot1':card(),'slot2':card()}}
        snap['slots']['slot1']['parked']=[156]
        choices=[(156,TASK),(201,TASK|{'depends_on':[156]}),(202,TASK)]
        intents=core.plan(A,S,snap,choices)
        self.assertEqual([x['issue'] for x in intents],[202])
        r=q.explain(S,snap,[{'number':n} for n,_ in choices],choices,intents)
        self.assertEqual([v['code'] for v in r['decisions']],['deferred','dependency','assigned'])
    def test_report_does_not_turn_draft_into_candidate(self):
        snap={'slots':{'slot1':card(),'slot2':card()}}
        self.assertEqual(core.plan(A,S,snap,[]),[])
        r=q.explain(S,snap,[{'number':149}],[],[])
        self.assertEqual(r['decisions'],[{'issue':149,'code':'not_admitted'}])
    def test_conflict_with_active_task_is_explicit(self):
        snap={'slots':{'slot1':card(active('developing')),'slot2':card()}}
        r=q.explain(S,snap,[{'number':201}],[(201,TASK)],[])
        self.assertEqual(r['decisions'][0]['code'],'conflict')

class ReportBoundary(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.snap={'slots':{'slot1':card(),'slot2':card()}}
        self.report=q.explain(S,self.snap,[{'number':149}],[],[])
        self.request={'action':'train','stage':'planning','controller_sha':HEAD,'run':123,'run_attempt':1,'report':self.report}
        self.policy={'mode':'active','controller_sha':HEAD}
    def tearDown(self):self.temp.cleanup()
    def test_closed_data_report_no_secret_author_or_source_fields(self):
        core.request(self.request)
        for field in ('gh_token','shell','path','pid','model','task','owned'):
            with self.assertRaises(core.Refused):core.request(self.request|{field:'untrusted'})
        r=copy.deepcopy(self.request);r['report']['decisions'][0]['code']='run-author'
        with self.assertRaises(core.Refused):core.request(r)
    def test_valid_report_records_only_planning_no_task_effect(self):
        with patch.object(receiver,'STATE',self.root),patch.object(receiver,'publish_monitor') as pub,patch.object(receiver.os,'fork') as fork,patch.object(receiver,'checkpoint') as checkpoint:
            self.assertEqual(receiver.handle(self.request,self.policy)['status'],'recorded')
            fork.assert_not_called();checkpoint.assert_not_called();pub.assert_called_once()
        self.assertEqual({p.name for p in self.root.iterdir()},{'planning.json'})
    def test_wrong_controller_refused_no_file(self):
        with patch.object(receiver,'STATE',self.root),self.assertRaises(core.Refused):receiver.handle(self.request,self.policy|{'controller_sha':'b'*40})
        self.assertEqual(list(self.root.iterdir()),[])
    def test_stale_generation_cannot_replace_current_plan(self):
        with patch.object(receiver,'STATE',self.root),patch.object(receiver,'journal',return_value={'generation':1}),patch.object(receiver,'publish_monitor') as pub:
            self.assertEqual(receiver.handle(self.request,self.policy)['status'],'obsolete');pub.assert_not_called()
        self.assertEqual(list(self.root.iterdir()),[])
    def test_no_budget_or_authorization_fields_in_report(self):
        r=copy.deepcopy(self.report);r['slots']['slot2']['budget_override']=100
        self.assertFalse(q.valid_report(r))
        r=copy.deepcopy(self.report);r['decisions']*=2;self.assertFalse(q.valid_report(r))

class IdleMonitor(unittest.TestCase):
    def test_old_exhausted_error_is_history_not_new_idle_reason(self):
        c=card();c['last']={'issue':156,'reason':'attempts exhausted','status':'deferred','stage':'author'}
        value=monitor.project(c,now=200)
        self.assertEqual(value['status'],'waiting');self.assertNotIn('attempts exhausted',value['wait_reason'])
        self.assertEqual(value['previous_result']['reason'],'attempts exhausted');self.assertIsNone(value['model'])
    def test_idle_uses_real_planning_counts_and_run(self):
        c=card();c['planning']={'reason':'no_eligible_admission','counts':{k:0 for k in q.CODES},'observed_at':100,'workflow_run':123}
        c['planning']['counts']['not_admitted']=30
        v=monitor.project(c,now=200)
        self.assertIn('без допуска 30',v['wait_reason']);self.assertIn('123',v['wait_reason'])
        self.assertEqual(v['status'],'waiting')
        self.assertEqual(monitor.project(c,now=4000)['status'],'stale')
    def test_running_stage_links_current_run_not_previous(self):
        c=card(active('qa'));c['pending']={'status':'running','stage':'qa','workflow_run':456,'workflow_attempt':2};c['last']={'workflow_run':123,'workflow_attempt':1}
        v=monitor.project(c,now=100)
        self.assertEqual(v['workflow_run'],456);self.assertEqual(v['workflow_attempt'],2)
        self.assertEqual(v['status'],'running')

if __name__=='__main__':unittest.main()

"""Route/cost/stage regressions; also exercise missing branches on pristine dev."""
import copy
from contextlib import nullcontext
import hashlib
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from test_actions_train import core, S, req, stage, receiver
from test_actions_train_cost_policy import cost_task
import context_policy
import cost_policy
import native_antigravity as QA


def author_task(level='standard'):
    t = cost_task(level,'standard'); t['routing_policy']['schema'] = 'GB_STAGE_COST_V2'
    model = {'simple':QA.MODEL,'standard':QA.MODEL,'complex':'claude-sonnet-5-5-high',
             'critical':'claude-opus-5-5-high'}[level]
    t['author_routes'] = ['agy:'+model,cost_policy.MATRIX[level]]
    return t


class Routing(unittest.TestCase):
    def setUp(self):
        self.budget = Mock(remaining=lambda *a:10,used=lambda *a:1)

    def test_cost_extension_keeps_exact_minimum_fallback_and_task_bytes(self):
        for level in ('simple','standard','complex','critical'):
            task = author_task(level); before = copy.deepcopy(task)
            route, rationale = cost_policy.selection(task,'author')
            self.assertEqual(route,task['author_routes'][0])
            self.assertEqual(rationale['approved_fallback_routes'],[cost_policy.MATRIX[level]])
            self.assertEqual(task,before)
            task['author_routes'].pop()
            with self.assertRaises(ValueError): cost_policy.validate_policy(task)

    def test_wrong_model_for_level_does_not_gain_preference(self):
        t = author_task('standard'); t['author_routes'][0] = 'agy:claude-opus-5-5-high'
        self.assertEqual(cost_policy.selection(t,'author')[0],'codex:gpt-6.1-sol:medium')

    def test_qualified_author_admission(self):
        import native_antigravity_author as N
        t = author_task(); before = copy.deepcopy(t)
        with patch.object(N,'available',return_value=(True,'qualified')) as available:
            choice = core.route(S,t,'author','auto',self.budget,'slot2')
        self.assertEqual(choice['provider'],'agy'); self.assertEqual(choice['role'],'author')
        self.assertEqual(choice['effective_model'],QA.MODEL); self.assertIsNone(choice['effort'])
        self.assertEqual(choice['remaining_calls'],10); self.assertEqual(choice['used_calls'],1)
        available.assert_called_once_with('slot2',core.digest(t),model=QA.MODEL)
        self.assertEqual(t,before)

    def test_no_marker_refuses_before_budget_and_uses_listed_fallback(self):
        import native_antigravity_author as N
        with patch.object(N,'trusted',side_effect=FileNotFoundError('synthetic marker')):
            choice = core.route(S,author_task(),'author','auto',self.budget,'slot2')
            self.assertEqual(choice['provider'],'codex')
            self.assertIn('agy:'+QA.MODEL,choice['unavailable'])
            t = author_task(); t.pop('routing_policy'); t['author_routes'].pop()
            with self.assertRaises(core.Refused): core.route(S,t,'author','auto',self.budget,'slot2')

    def test_unknown_missing_exhausted_budget_is_refusal_and_fallback(self):
        import native_antigravity_author as N
        for left in (None,0,-1,'UNKNOWN',KeyError('missing budget')):
            def remaining(provider,*args):
                if provider != 'agy': return 10
                if isinstance(left,Exception): raise left
                return left
            budget = Mock(remaining=remaining,used=lambda *a:0)
            with self.subTest(left=left), patch.object(N,'available',return_value=(True,'qualified')):
                choice = core.route(S,author_task(),'author','auto',budget,'slot2')
                self.assertEqual(choice['provider'],'codex')
                self.assertIn('budget UNKNOWN/exhausted',choice['unavailable']['agy:'+QA.MODEL])
                t = author_task(); t.pop('routing_policy'); t['author_routes'].pop()
                with self.assertRaises(core.Refused): core.route(S,t,'author','auto',budget,'slot2')

    def test_author_effort_or_model_refused_without_adapter_probe(self):
        import native_antigravity_author as N
        for route in ('agy:'+QA.MODEL+':high','agy:auto'):
            t = author_task(); t.pop('routing_policy'); t['author_routes'] = [route,'codex:gpt-6.1-sol:medium']
            with patch.object(N,'available',side_effect=AssertionError('must reject first')):
                choice = core.route(S,t,'author','auto',self.budget,'slot2')
            self.assertIn(route,choice['unavailable']); self.assertEqual(choice['provider'],'codex')

    def test_agy_author_requires_different_qa_provider(self):
        t = author_task(); t.pop('routing_policy'); t['qa_routes'] = ['agy:'+QA.MODEL,'codex:gpt-6.1-sol:medium']
        with patch.object(QA,'available',side_effect=AssertionError('same-provider QA must refuse first')):
            choice = core.route(S,t,'qa','auto',self.budget,'slot2')
        self.assertEqual(choice['provider'],'codex')
        self.assertEqual(choice['unavailable']['agy:'+QA.MODEL],'independent QA must be a different provider')
        t['qa_routes'].pop()
        with self.assertRaises(core.Refused): core.route(S,t,'qa','auto',self.budget,'slot2')

    def test_qa_branch_retains_models_effort_refusal_and_budget(self):
        t = author_task(); t.pop('routing_policy'); t['author_routes'] = ['cursor:auto']
        t['qa_routes'] = ['agy:'+QA.MODEL]
        with patch.object(QA,'available',return_value=(True,'qa qualified')) as available:
            self.assertEqual(core.route(S,t,'qa','auto',self.budget,'slot2')['provider'],'agy')
            available.assert_called_once_with('slot2',core.digest(t),model=QA.MODEL)
        for entry in ('agy:auto','agy:'+QA.MODEL+':high'):
            t['qa_routes'] = [entry,'codex:gpt-6.1-sol:medium']
            choice = core.route(S,t,'qa','auto',self.budget,'slot2')
            self.assertEqual(choice['unavailable'][entry],'Antigravity role/model/effort not supported by native QA adapter')

    def test_v1_scheduler_still_forbids_agy_and_selects_codex(self):
        task = {'model':'gpt-6.1-sol','effort':'medium'}
        self.assertEqual(S.FORBIDDEN['agy'],{'author','qa'})
        for role in ('author','qa'):
            self.assertFalse(S.adapter_status('agy',role,self.budget,'slot2')[0])
            choice = core.route(S,task,role,'auto',self.budget,'slot2')
            self.assertEqual(choice['provider'],'codex')


    def test_any_agy_author_entry_blocks_qa_with_or_without_cost_policy(self):
        import native_cursor as C
        import native_antigravity_author as N
        for policy in (False, True):
            task = author_task()
            if not policy: task.pop('routing_policy')
            task['author_routes'] = ['cursor:auto','agy:'+QA.MODEL,'codex:gpt-6.1-sol:medium']
            task['qa_routes'] = ['agy:'+QA.MODEL,'codex:gpt-6.1-sol:medium']
            with self.subTest(policy=policy), patch.object(C,'available',return_value=(False,'synthetic unavailable')), \
                 patch.object(N,'available',return_value=(True,'synthetic qualified')), \
                 patch.object(QA,'available',return_value=(True,'synthetic qualified')):
                if not policy: self.assertEqual(core.route(S,task,'author','auto',self.budget,'slot2')['provider'],'agy')
                qa = core.route(S,task,'qa','auto',self.budget,'slot2')
                self.assertEqual(qa['provider'],'codex')
                self.assertEqual(qa['unavailable']['agy:'+QA.MODEL], 'independent QA must be a different provider')

    def test_agy_qa_fallback_refused_after_codex_exhaustion(self):
        task = author_task(); task.pop('routing_policy')
        task['author_routes'] = ['cursor:auto','agy:'+QA.MODEL,'codex:gpt-6.1-sol:medium']
        task['qa_routes'] = ['codex:gpt-6.1-sol:medium','agy:'+QA.MODEL]
        budget = Mock(remaining=lambda p,r,s: 0 if (p,r)==('codex','qa') else 10, used=lambda *a: 0)
        with patch.object(QA,'available',return_value=(True,'qualified')), \
             self.assertRaisesRegex(core.Refused, 'independent QA must be a different provider'):
            core.route(S,task,'qa','auto',budget,'slot2')

    def test_agy_author_requires_listed_non_agy_admitted_qa(self):
        import native_antigravity_author as N
        with patch.object(N,'available',return_value=(True,'qualified')):
            for qa in ([], ['agy:'+QA.MODEL], ['codex:unsupported:medium'], ['codex:gpt-6-luna:high'], ['cursor:auto']):
                task = author_task(); task.pop('routing_policy'); task['qa_routes'] = qa
                with self.subTest(qa=qa):
                    choice = core.route(S,task,'author','auto',self.budget,'slot2')
                    self.assertEqual(choice['provider'],'codex')
                    self.assertIn('independent',choice['unavailable']['agy:'+QA.MODEL])
            task['author_routes'] = ['agy:'+QA.MODEL]; task['qa_routes'] = ['codex:gpt-6.1-sol:medium']
            self.assertEqual(core.route(S,task,'author','auto',self.budget,'slot2')['provider'],'agy')


class Dispatch(unittest.TestCase):
    def exercise(self,provider,qa=False,fail=False):
        # Actual stage.setup/measured_model including ObservedSubprocess and
        # receipt finalizers; only external runtime/transport are fixture doubles.
        with tempfile.TemporaryDirectory(prefix='agy-dispatch-') as temp:
            root = Path(temp); cli = root/'vendor'; cli.write_bytes(b'synthetic-pinned-vendor')
            count = [0]; calls = []; traces = []
            store = SimpleNamespace(data={'active':dict(task=author_task(),base='b'*40,head='a'*40,attempt=1,issue=421)})
            rt = SimpleNamespace(user='fixture',legacy=True,home=root,key=root/'key',
                layout=SimpleNamespace(repo=root,state_dir=root,worktrees=root,outbox=root),
                check_paths=Mock(),continuity=lambda:True,lease=Mock(),budget=SimpleNamespace(used=lambda *_:count[0]))
            process = SimpleNamespace(pid=424242)
            a = SimpleNamespace(RUNTIME_READS=(),Store=lambda *_:store,permitted=lambda *_:True,
                atomic=lambda p,v:traces.append(copy.deepcopy(v)),subprocess=SimpleNamespace(Popen=Mock(return_value=process)))
            original = Mock(side_effect=AssertionError('Codex model must not handle native provider'))
            def factory(c,s): return SimpleNamespace(c=c,store=s,work=root,git=Mock(),unchanged_issue=Mock(),model=original)
            a.Bridge = factory
            s = SimpleNamespace(Runtime=lambda *_args,**_kw:rt,uid_of=lambda _:978,Hold=RuntimeError,
                read_json=lambda *_a,**_k:{'mode':'active','owned':{'slot2':'fixture'}})
            choice = dict(provider=provider,effective_model=QA.MODEL if provider=='agy' else 'Auto',
                          effort=None,role='qa' if qa else 'author')
            receipt = dict(phase='imported',rules_context={'role':'qa' if qa else 'author'},
                           provider_reported_usage={'output_tokens':5})
            def author(bridge,rt,prompt,*args,**kwargs):
                calls.append(prompt); self.assertIn('TRUSTED_FULL_RULES',prompt)
                kwargs['popen']([QA.AGY],cwd=root/'private-export')
                count[0] += 1
                args[-1]['native_receipt'] = receipt
                if fail: raise QA.ReviewError()
                return dict(provider_reported_usage={'output_tokens':5})
            def review(*args,**kwargs):
                calls.append(args[3]); self.assertEqual(args[3],'task data')
                kwargs['popen']([QA.AGY],cwd=root/'private-export'); count[0] += 1
                return {'verdict':'PASS'},receipt
            read_bytes = Path.read_bytes
            def pinned_read(path): return b'synthetic-pinned-vendor' if str(path)==QA.AGY else read_bytes(path)
            agy_patch = (patch('native_antigravity_author.invoke',side_effect=author)
                         if provider == 'agy' and not qa else nullcontext(Mock()))
            with patch.object(stage,'live',return_value=(a,s)),patch.object(stage.os,'getuid',return_value=978), \
                 patch.object(stage.os,'getgid',return_value=968),patch.object(stage,'API',return_value=Mock()), \
                 patch.object(stage,'route',return_value=choice),patch.object(context_policy,'load',return_value=('TRUSTED_FULL_RULES',{})), \
                 patch.object(context_policy,'inject',side_effect=lambda prompt,*a,**k:('TRUSTED_FULL_RULES\n'+prompt,{'role':'author'})) as inject, \
                 patch.object(receiver,'units_quiet'),patch.object(receiver,'identity',return_value={'pid':424242}), \
                 agy_patch as agy_invoke, \
                 patch('native_cursor.invoke',side_effect=author) as cursor_invoke, \
                 patch.object(QA,'review',side_effect=review) as qa_review,patch.object(QA,'save_receipt'), \
                 patch.object(Path,'read_bytes',pinned_read):
                request = req('qa' if qa else 'author','candidate'); request['slot'] = 'slot2'
                bridge = stage.setup(request,{'codex':{'slot2':str(cli)}},native_auth='fixture-cursor-token' if provider == 'cursor' else None)[-1]
                if fail:
                    with self.assertRaises(QA.ReviewError): bridge.model('task data',qa=qa)
                else: bridge.model('task data',qa=qa)
            self.assertEqual(agy_invoke.call_count,int(provider=='agy' and not qa))
            self.assertEqual(qa_review.call_count,int(provider=='agy' and qa))
            self.assertEqual(cursor_invoke.call_count,int(provider=='cursor'))
            self.assertEqual(inject.call_count,int(not qa))
            routing = bridge.routing_receipts[0]
            self.assertEqual(routing['native_receipt'],receipt)
            self.assertEqual(routing['rules_context'],receipt['rules_context'])
            self.assertEqual(routing['usage']['charged_calls'],1)
            self.assertEqual(routing['usage']['tokens'],{'output_tokens':5})
            self.assertEqual(routing['usage']['model_completion'],'raised' if fail else 'returned')
            self.assertTrue(any(t.get('process',{}).get('pid')==424242 for t in traces if t.get('process')))
            self.assertIsNone(traces[-1]['process'])
            original.assert_not_called()

    def test_agy_author_adapter_and_finalization(self): self.exercise('agy')
    def test_agy_author_failure_finalization(self): self.exercise('agy',fail=True)
    def test_agy_qa_still_uses_review(self): self.exercise('agy',qa=True)
    def test_cursor_unchanged_dispatch(self): self.exercise('cursor')


if __name__ == '__main__': unittest.main()

"""New-policy integration only; synthetic admissions, source, adapters and shadow."""
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from test_actions_train import A, S, TASK, BASE, HEAD, NOW, ROOT, core, stage, issue, req
from test_actions_train_stages import Store, Bridge
from test_actions_train_smart_routing_sr1 import plan, case, ready, fast
import context_policy as C
import cost_policy as cost
import failure_diagnosis as fd
import smart_stage as smart


def task(author='standard', qa='standard', cursor=True, agy=True):
    t = copy.deepcopy(TASK)
    t.update(work_kind='implementation', risk='complex',
        author_routes=(['cursor:auto'] if cursor else []) +
            [smart.SOL_HIGH if author == 'complex' else smart.SOL_MEDIUM],
        qa_routes=([smart.AGY_HIGH if qa == 'complex' else smart.AGY_MEDIUM] if agy else []) +
            [smart.SOL_HIGH if qa == 'complex' else smart.SOL_MEDIUM],
        failure_diagnosis=dict(schema=fd.SCHEMA, route=fd.ROUTE, max_calls=3))
    t['routing_policy'] = dict(schema=smart.SCHEMA)
    for role, level in (('author', author), ('qa', qa)):
        t['routing_policy'][role] = dict(complexity=level,
            reason={'simple':'bounded_docs','standard':'standard_ui','complex':'complex_logic'}[level],
            evidence='Exact accepted source pattern and deterministic regression criteria.')
    t['routing_policy']['plan'] = plan(author_route=t['author_routes'][0], qa_route=t['qa_routes'][0])
    return bind(t)


def bind(t):
    t['routing_policy']['plan']['binding'] = dict(task_sha=smart.task_fingerprint(t),
        rules_commit=C.RULES_COMMIT, rules_sha256=C.RULES_SHA256, head=BASE, operation_id='admitted-plan-1')
    return t


class NewPolicy(unittest.TestCase):
    def setUp(self):
        self.budget = SimpleNamespace(remaining=lambda *_: 10, used=lambda *_: 2)

    def pick(self, t, role):
        return core.route(S, t, role, 'auto', self.budget, 'slot1')

    def test_parser_accepts_closed_extension_and_never_rewrites_admission(self):
        t = task(); before = copy.deepcopy(t)
        self.assertEqual(A.validate_issue(issue(336, t), NOW-dt.timedelta(days=1)), t)
        self.assertEqual(t, before)
        for extra in ('smart_routing', 'classifier', 'fast_fix', 'root', 'planning'):
            bad = bind(t | {extra: True})
            with self.subTest(extra=extra), self.assertRaises(A.Hold):
                A.validate_issue(issue(336, bad), NOW-dt.timedelta(days=1))

    def test_each_role_has_its_own_floor_and_native_qualification_is_still_required(self):
        t = task(author='complex', qa='standard'); before = copy.deepcopy(t)
        with patch('native_cursor.available', return_value=(False, 'not qualified')):
            a = self.pick(t, 'author')
        with patch('native_antigravity.available', return_value=(False, 'catalog only')):
            q = self.pick(t, 'qa')
        self.assertEqual((a['effective_model'], a['effort']), ('gpt-6.1-sol', 'high'))
        self.assertEqual((q['effective_model'], q['effort']), ('gpt-6.1-sol', 'medium'))
        self.assertIn('catalog only', q['unavailable'].values())
        self.assertEqual(q['requested_route'], smart.AGY_MEDIUM)
        self.assertIsNotNone(q['fallback_reason']); self.assertEqual(t, before)
        self.assertEqual(q['operation_class'], 'independent_qa')

    def test_qualified_cursor_and_exact_agy_model_are_preferred_without_backend_fiction(self):
        t = task()
        with patch('native_cursor.available', return_value=(True, 'exact task qualification')):
            a = self.pick(t, 'author')
        self.assertEqual(a['provider'], 'cursor'); self.assertIsNone(a['effective_model'])
        self.assertEqual(a['effective_model_status'], 'not_exposed'); self.assertIsNone(a['effort'])
        with patch('native_antigravity.available', return_value=(True, 'exact QA proof')) as available:
            q = self.pick(t, 'qa')
        self.assertEqual(q['effective_model'], 'claude-sonnet-5-5-medium')
        self.assertEqual(available.call_args.kwargs['model'], 'claude-sonnet-5-5-medium')
        self.assertEqual(available.call_args.args[1], core.digest(t))

    def test_fallback_cannot_add_a_route_or_pay_after_unknown_quota(self):
        t = task(); t['qa_routes'] = [smart.AGY_MEDIUM]; bind(t)
        with patch('native_antigravity.available', return_value=(False, 'unqualified')):
            with self.assertRaises(core.Refused): self.pick(t, 'qa')
        self.budget.remaining = lambda *_: S.UNKNOWN
        with patch('native_cursor.available', return_value=(False, 'unqualified')):
            with self.assertRaises(core.Refused): self.pick(task(), 'author')

    def test_astra_luna_qa_and_underpowered_complex_routes_are_rejected(self):
        for role, route in (('author', fd.ROUTE), ('qa', fd.ROUTE),
                            ('qa', 'codex:gpt-6-luna:medium'), ('author', smart.SOL_MEDIUM)):
            t = task(author='complex')
            t[role+'_routes'] = [route]; t['routing_policy']['plan'][role+'_route'] = route; bind(t)
            with self.subTest(role=role, route=route), self.assertRaises(ValueError):
                smart.validate_policy(t)

    def test_critical_floor_comes_from_task_or_source_not_line_count_or_cheap_qa(self):
        for change in ({'risk':'critical'}, {'work_kind':'architecture'},
                       {'allowed_paths':['apps/api/src/auth.ts']},
                       {'allowed_paths':['packages/db/migrations/**']}):
            t = bind(task() | change)
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'CRITICAL'):
                smart.validate_policy(t)

    def test_closed_sr1_plan_cannot_expand_rights_effects_or_call_budget(self):
        for change in ({'rights_delta':['root']}, {'effects':['deterministic_tool']},
                       {'planner_calls':1}, {'astra_calls':1}, {'fast_fix':True},
                       {'executable':False}, {'shell':'true'}, {'weaken_auth':True}):
            t = task(); t['routing_policy']['plan'].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError): smart.validate_policy(t)
        t = task(); t['routing_policy']['root'] = True
        with self.assertRaises(ValueError): smart.validate_policy(t)

    def test_input_task_rules_route_and_source_bindings_are_exact(self):
        for field, replacement in (('goal', 'different'), ('acceptance', 'different'),
                                   ('allowed_paths', ['apps/api/src/sample.ts']),
                                   ('max_attempts', 2)):
            t = task(); t[field] = replacement
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'stale'):
                smart.validate_policy(t)
        for field in ('rules_commit', 'rules_sha256', 'task_sha'):
            t = task(); t['routing_policy']['plan']['binding'][field] = 'c' * (40 if field=='rules_commit' else 64)
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'stale'):
                smart.validate_policy(t)
        t = task()
        with patch.object(C,'ROUTING_SHA256','d'*64), self.assertRaisesRegex(ValueError,'stale'):
            smart.validate_policy(t)
        t = task(); t['routing_policy']['plan']['author_route'] = smart.SOL_MEDIUM
        with self.assertRaisesRegex(ValueError, 'differs'): smart.validate_policy(t)
        with self.assertRaisesRegex(ValueError, 'BASE_CHANGED'):
            smart.dispatch_gate(task(), 'author', {'base':HEAD})
        with self.assertRaisesRegex(ValueError, 'HEAD_CHANGED'):
            smart.dispatch_gate(task(), 'author', {'base':BASE,'head':HEAD,'phase':'claimed'})

    def test_legacy_v1_v2_critical_routes_remain_exact(self):
        from test_actions_train_cost_policy import cost_task
        for schema in (cost.SCHEMA, 'GB_STAGE_COST_V2'):
            t = cost_task('critical', 'critical'); t['routing_policy']['schema'] = schema
            for role in ('author', 'qa'):
                c = self.pick(t, role)
                self.assertEqual((c['effective_model'], c['effort']), ('gpt-6-astra','high'))
                self.assertIsNone(smart.dispatch_gate(t, 'author', facts={'category':'unknown_effect'}))

    def test_218_is_required_and_timeout_words_never_bypass_it(self):
        t = task(); t.pop('failure_diagnosis'); bind(t)
        with self.assertRaisesRegex(ValueError, '#218'): smart.validate_policy(t)
        a = dict(issue=336, task=task(), phase='qa', head=HEAD, base=BASE, attempt=1,
                 qa=dict(verdict='FAIL', findings=['ENV_ERROR timeout AssertionError'], reviewed_sha=HEAD))
        self.assertEqual(core.next_stage(a), 'failure_diagnosis')
        with self.assertRaises(core.Refused): fd.repair(a, Mock())
        # A new model planning stage is deliberately unsupported by this slice.
        with self.assertRaises(core.Refused): core.request(req('technical_pm'))


class Operations(unittest.TestCase):
    def test_effect_classes_do_not_grant_privileged_writer_capability(self):
        for name, klass in (('author','source'), ('qa','independent_qa'),
                            ('publish','trusted_publication'), ('integrate','trusted_publication')):
            self.assertEqual(smart.operation(task(), name)['operation_class'], klass)
        for change, klass, reason in (
                ({'kind':'guarded_ops'}, 'guarded_ops', 'SEPARATE_TRUSTED_AUTHORITY'),
                ({'kind':'admin_auth'}, 'admin_auth', 'SEPARATE_TRUSTED_AUTHORITY'),
                ({'allowed_paths':['.github/workflows/train-stage.yml']}, 'guarded_ops', 'PRIVILEGED'),
                ({'allowed_paths':['docs/rules/SMART_ROUTING.md']}, 'admin_auth', 'ADMIN_AUTH'),
                ({'allowed_paths':['scripts/chatops/actions_train/stage.py']}, 'source', 'TRUSTED_PUBLISHER'),
                ({'kind':'root'}, 'unknown', 'TASK_KIND'),
                ({'allowed_paths':['../etc/passwd']}, 'unknown', 'SOURCE_SCOPE')):
            t = bind(task() | change); op = smart.operation(t, 'author')
            self.assertEqual(op['operation_class'], klass); self.assertIn(reason, op['operation_reason'])
            with self.assertRaises(ValueError): smart.validate_policy(t)

    def test_refusal_auth_permissions_and_unknown_are_distinct_and_no_fallback(self):
        codes = set()
        for category in ('model_auth', 'permission_denial', 'platform_refusal', 'unknown_effect'):
            op = smart.operation(task(), 'author', facts={'category':category}); codes.add(op['operation_reason'])
            with self.assertRaisesRegex(ValueError, op['operation_reason']):
                smart.dispatch_gate(task(), 'author', facts={'category':category})
        self.assertEqual(len(codes), 4)
        self.assertEqual(smart.operation(task(), 'author', facts={'category':'timeout'})['operation_class'], 'unknown')

    def test_parser_refuses_before_mutable_claim_and_stage_before_source_effects(self):
        with tempfile.TemporaryDirectory() as directory:
            store = A.Store(Path(directory)); before = copy.deepcopy(store.data)
            t = task(); t['routing_policy']['plan']['rights_delta'] = ['root']
            self.assertIsNone(store.claim([issue(336,t)], NOW-dt.timedelta(days=1), []))
            self.assertEqual(store.data, before)
        with tempfile.TemporaryDirectory() as directory:
            active = dict(issue=336, task=task(), phase='claimed', head=HEAD, base=HEAD, attempt=0)
            store = Store(active); bridge = Bridge(store, Path(directory))
            with self.assertRaisesRegex(core.Refused, 'BASE_CHANGED'):
                stage.perform(req('author') | {'issue':336,'head':HEAD,'attempt':0}, {},
                              (A,S,Mock(),Mock(),store,bridge))
            self.assertEqual(bridge.calls, []); self.assertEqual(active['attempt'],0)

    def test_preclaim_source_drift_never_calls_store_claim(self):
        t = task(); store = SimpleNamespace(data={'active':None}, claim=Mock())
        api = Mock(return_value=issue(336,t)); api.pages.return_value=[]
        bridge = SimpleNamespace(remote_dev=Mock(return_value=HEAD))
        with self.assertRaisesRegex(core.Refused, 'BASE_CHANGED'):
            stage.perform(req('claim','idle') | {'issue':336,'head':None,'attempt':0}, {},
                          (A,S,Mock(),api,store,bridge))
        store.claim.assert_not_called()

    def test_new_recovery_is_held_before_mutable_claim(self):
        t = task(); store = SimpleNamespace(data={'active':None}, claim=Mock())
        api = Mock(return_value=issue(336,t)); api.pages.return_value=[]
        request = req('claim','idle') | {'issue':336,'head':None,'attempt':0,
                                       '_recovery_admission':{'task':t}}
        with self.assertRaisesRegex(core.Refused,'SMART_RECOVERY_NOT_IMPLEMENTED'):
            stage.perform(request,{},(A,S,Mock(),api,store,Mock()))
        store.claim.assert_not_called()

    def test_unknown_operation_stays_reserved_and_suppresses_new_model_dispatch(self):
        from test_actions_train import card
        active = dict(issue=336, task=task(), phase='claimed', head=None, base=BASE, attempt=0)
        pending = dict(status='unknown', binding=dict(stage='author'))
        snapshot = dict(slots={'slot1':card(active) | {'pending':pending},
                               'slot2':card(owned=False)})
        before = copy.deepcopy(snapshot)
        self.assertEqual(core.plan(A,S,snapshot,[(336,active['task'])]), [])
        self.assertEqual(core.plan(A,S,snapshot,[(336,active['task'])]), [])
        self.assertEqual(snapshot,before)

    def test_shadow_reuses_classifier_without_paid_calls_or_task_mutation(self):
        for evidence in (ready(cause='unresolved'), fast(), ready(critical_signs=True)):
            c = case(evidence); p = evidence.get('plan') or plan(); before = copy.deepcopy(c)
            one = smart.shadow(c,p); two = smart.shadow(c,p)
            self.assertEqual(one,two); self.assertFalse(one['dispatch_allowed'])
            self.assertEqual(one['model_calls'],0); self.assertIsNone(one['tokens'])
            self.assertEqual(c,before)
        p = plan(rights_delta=['root'])
        with self.assertRaises(ValueError): smart.shadow(case(ready()),p)


class Context(unittest.TestCase):
    def test_model_wrapper_delivers_full_documents_without_scoped_qualification(self):
        from accepted_rules_fixture import accepted_rules_text
        from test_actions_train_context import accepted
        import receiver
        text = accepted_rules_text(ROOT); routing = C.load_routing(ROOT)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); cli = root/'fake-codex'; cli.write_text('never executed')
            active = dict(issue=336,task=task(cursor=False,agy=False),head=BASE,base=BASE,
                          phase='claimed',attempt=0)
            store = SimpleNamespace(data={'active':active}); received=[]
            layout = SimpleNamespace(repo=root,state_dir=root,worktrees=root,outbox=root)
            rt = SimpleNamespace(user='test',legacy=True,home=root,key=root/'key',layout=layout,
                check_paths=Mock(),continuity=lambda:True,lease=Mock(),
                budget=SimpleNamespace(used=lambda *_:len(received)))
            a = SimpleNamespace(RUNTIME_READS=(),Store=lambda *_:store,atomic=Mock(),
                                subprocess=SimpleNamespace(Popen=Mock()))
            def bridge(config, st):
                def model(prompt, qa=False):
                    received.append(prompt); return None
                return SimpleNamespace(c=config,store=st,work=root,git=Mock(),unchanged_issue=Mock(),model=model)
            a.Bridge=bridge
            s = SimpleNamespace(Runtime=lambda *_args,**_kwargs:rt,uid_of=lambda _:1002,Hold=RuntimeError,
                read_json=lambda *_args,**_kwargs:{'mode':'active','owned':{'slot1':'x'}})
            choice=dict(provider='codex',role='author',effective_model='gpt-6.1-sol',effort='medium')
            with patch.object(stage,'live',return_value=(a,s)),patch.object(stage,'API',return_value=Mock()), \
                 patch.object(stage.os,'getuid',return_value=1002),patch.object(stage.os,'getgid',return_value=1002), \
                 patch.object(C,'load',return_value=accepted()),patch.object(C,'load_routing',return_value=routing), \
                 patch.object(C,'verified_git_rules',return_value=True) as scoped, \
                 patch.object(stage,'route',return_value=choice),patch.object(receiver,'units_quiet'):
                *_, b = stage.setup(req('author'),{'codex':{'slot1':str(cli)}})
                b.model('bounded source task',False)
            self.assertEqual(len(received),1); scoped.assert_not_called()
            self.assertIn(text,received[0]); self.assertIn(routing[0],received[0])
            proof=b.routing_receipts[0]
            self.assertEqual(proof['rules_context']['context_metrics']['policy_profile'],'full')
            self.assertEqual(proof['routing_context']['policy_profile'],'full')
            self.assertEqual(proof['usage']['charged_calls'],1); self.assertIsNone(proof['usage']['tokens'])

    def test_routing_context_is_exact_full_local_immutable_input(self):
        from accepted_rules_fixture import accepted_rules_text
        text = accepted_rules_text(ROOT)
        prefix, receipt = C.load_routing(ROOT)
        self.assertEqual(receipt['sha256'],C.ROUTING_SHA256)
        self.assertEqual(receipt['policy_profile'],'full'); self.assertIsNone(receipt['input_tokens'])
        routing = prefix.split('\n',1)[1].rsplit('\nEND TRUSTED SMART ROUTING.',1)[0]
        with self.assertRaises(core.Refused): C.routing_prefix(routing+' ')
        metadata = dict(commit=C.RULES_COMMIT,sha256=C.RULES_SHA256,bytes=C.RULES_SIZE,
                        delivery='explicit_full_stdin')
        payload, proof = C.inject(prefix+'exact bounded task', False, ROOT, (text,metadata))
        self.assertIn(text,payload); self.assertIn(routing,payload)
        self.assertEqual(proof['context_metrics']['policy_profile'],'full')
        self.assertEqual(proof['stdin_sha256'],hashlib.sha256(payload.encode()).hexdigest())
        with patch.object(C.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout=b'')):
            with self.assertRaisesRegex(core.Refused,'UNAVAILABLE'): C.load_routing(ROOT)
        with patch.object(C.subprocess,'run',side_effect=PermissionError):
            with self.assertRaisesRegex(core.Refused,'PERMISSION_DENIED'): C.load_routing(ROOT)


if __name__ == '__main__': unittest.main()

"""New-policy integration only; synthetic admissions, source, adapters and shadow."""
import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
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
        # Route-table isolation only. These old rendering claims have no source
        # proof; admission tests below exercise the real classification gate.
        with patch.object(smart, 'classification_gate'):
            return core.route(S, t, role, 'auto', self.budget, 'slot1')

    def test_parser_holds_unproved_extension_and_never_rewrites_admission(self):
        t = task(); before = copy.deepcopy(t)
        with self.assertRaisesRegex(A.Hold, 'HOLD_CLASSIFICATION_'):
            A.validate_issue(issue(336, t), NOW-dt.timedelta(days=1))
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
        # Isolate the saved/live binding guard from the independent missing
        # classification proof HOLD. This patch grants no production admission.
        with patch.object(smart, 'classification_gate'):
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
                 patch.object(smart,'classification_gate'), \
                 patch.object(stage,'route',return_value=choice),patch.object(receiver,'units_quiet'):
                *_, b = stage.setup(req('author'),{'codex':{'slot1':str(cli)}})
                b.model('bounded source task',False)
            # Defense in depth: a direct wrapper call also refuses before its
            # effect_gate can renew a lease or reach any provider/ledger call.
            rt.lease.reset_mock()
            with self.assertRaisesRegex(core.Refused,'HOLD_CLASSIFICATION_'):
                b.model('bounded source task',False)
            rt.lease.assert_not_called()
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


class RepairFloors(unittest.TestCase):
    """R1 real parser/Store/stage effects; no provider or network boundary."""
    texts = (
        'Repair authorization identity permissions.',
        'Publish secret and PII.',
        'Repair concurrency payment.',
        'Migration data loss rollback.',
        'Исправить проверку прав доступа и персональных данных.',
        'Change canRead to return true.',
        'Remove tenant filter.',
        'a u t h o r i z a t i o n',
        '%61%75%74%68%6f%72%69%7a%61%74%69%6f%6e',
        'аuthorization',
        'Implement an opaque frobnicator.',
    )

    def rejected_store(self, t):
        original = copy.deepcopy(t)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); store = A.Store(root)
            try:
                before = copy.deepcopy(store.data)
                files = {p.name:p.read_bytes() for p in root.iterdir() if p.is_file()}
                with self.assertRaises(A.Hold):
                    A.validate_issue(issue(336,t), NOW-dt.timedelta(days=1))
                self.assertIsNone(store.claim([issue(336,t)],NOW-dt.timedelta(days=1),[]))
                self.assertEqual(store.data,before)
                self.assertEqual(files,{p.name:p.read_bytes() for p in root.iterdir() if p.is_file()})
                self.assertFalse((root/'state.json').exists())
            finally:
                os.close(store.lock)
        self.assertEqual(t,original)

    def test_all_original_and_expanded_text_carriers_hold_before_real_store_effects(self):
        for carrier in ('goal','acceptance','author','qa'):
            for text in self.texts:
                t=task()
                if carrier in ('author','qa'): t['routing_policy'][carrier]['evidence']=text
                else: t[carrier]=text
                with self.subTest(carrier=carrier,text=text): self.rejected_store(bind(t))

    def test_missing_malformed_oversize_wildcard_and_untrusted_proofs_hold(self):
        for change in ({'allowed_paths':['apps/api/**']},{'allowed_paths':['packages/db/**']},
                       {'allowed_paths':['apps/web/src/opaque.zzz']},
                       {'goal':'x'*501},{'acceptance':{'claims':'routine'}},
                       {'goal':None},{'source_proof':{'trusted':True}},
                       {'dependencies':['packages/db/src/access.ts']},
                       {'classification_evidence':ready()}):
            with self.subTest(change=change): self.rejected_store(bind(task()|change))
        for role in ('author','qa'):
            for value in ('', 'x'*501, {}, None):
                t=task(); t['routing_policy'][role]['evidence']=value
                with self.subTest(role=role,value=value): self.rejected_store(bind(t))
        for flag in ('auth_unchanged','assertions_unchanged','qa_unchanged'):
            t=task();t['routing_policy']['plan'][flag]=True
            self.rejected_store(bind(t))
        self.rejected_store(task())  # The former ready rendering fixture is unproved.

    def test_shared_floor_is_monotone_and_structured_critical_survives_malformed_sibling(self):
        import smart_routing as sr
        for raw in ({'risk':'low','critical_signs':True,'goal':[]},
                    {'risk':'low','goal':'rename export','findings':[
                        {'id':'f1','location':'apps/web/src/export.ts','severity':'critical'}]},
                    {'critical_signs':True,'unknown_field':None}):
            before=copy.deepcopy(raw); result=sr.classification_floor(raw)
            self.assertEqual(result['risk'],'critical'); self.assertFalse(result['evidence_complete'])
            self.assertIn('CRITICAL',result['reason']); self.assertEqual(raw,before)
        self.assertIsNone(sr.classification_floor({})['risk'])
        self.assertFalse(sr.classification_floor({'goal':'rename export'})['evidence_complete'])
        self.assertEqual(sr.classification_floor({'goal':'x'*501})['reason'],
                         'HOLD_CLASSIFICATION_UNSUPPORTED_UNCERTAINTY')
        # SR1's complete offline control stays complete; removing facts closes it.
        proven=fast(brief_usable=True)
        self.assertTrue(sr.classification_floor(proven)['evidence_complete'])
        for key in ('risk','cause','class_search','diff_check','minimal_action_known',
                    'external_effects_unknown','unknown_effect','acceptance_unchanged',
                    'scope_within_admission','finite_budget','regression_known'):
            value=copy.deepcopy(proven);value.pop(key)
            with self.subTest(key=key): self.assertFalse(sr.classification_floor(value)['evidence_complete'])

    def test_later_qa_ci_history_and_source_evidence_never_grant_effects(self):
        qa_cases=[dict(verdict='FAIL',findings=[text],reviewed_sha=HEAD) for text in self.texts]
        qa_cases += [dict(verdict='FAIL',findings=order,reviewed_sha=HEAD) for order in (
            ['rename export','Critical authorization'],['Critical authorization','rename export'])]
        qa_cases += [dict(verdict='FAIL',findings=[{'id':'f1','location':'apps/web/src/export.ts',
            'severity':'critical'}],reviewed_sha=HEAD),
            dict(verdict='FAIL',findings=['rename export'],reviewed_sha=BASE),
            dict(verdict='FAIL',findings=['x'*501],reviewed_sha=HEAD),
            dict(verdict='FAIL',findings=[None],reviewed_sha=HEAD),
            dict(verdict='FAIL',findings=['rename export'],reviewed_sha=HEAD,suggested_class='SOURCE_KNOWN_LOCAL')]
        extras=[{'qa':q} for q in qa_cases]
        extras += [{'history':[dict(head=BASE,qa=dict(verdict='FAIL',findings=['Critical authorization'],
                      reviewed_sha=BASE))]}, {'ci_failure':dict(head=BASE,run=1,run_attempt=1,failed=[])},
            {'ci_evidence':{'head':HEAD,'log':'Critical authorization'}},
            {'dependencies':['packages/db/src/access.ts']}, {'observed_paths':['apps/api/**']},
            {'source_evidence':{'critical_signs':True}},
            {'failure_diagnosis':{'brief':'routine'}}]
        for extra in extras:
            for name,phase in (('author','qa'),('qa','pr_wait'),('publish','candidate'),
                               ('integrate','ci'),('promote','promoting')):
                with self.subTest(extra=extra,stage=name), tempfile.TemporaryDirectory() as folder:
                    root=Path(folder);store=A.Store(root)
                    try:
                        # Archived candidate fixture only, NOT a new admission.
                        store.data['active']=dict(issue=336,task=task(),phase=phase,base=BASE,head=HEAD,
                            attempt=1,integration=0,qa=None,ci=None,**{})
                        store.data['active'].update(extra);store.save()
                        active=store.data['active'];before=copy.deepcopy(store.data)
                        disk=store.path.read_bytes();files=set(root.iterdir())
                        bridge=Mock();rt=Mock()
                        with self.assertRaisesRegex(core.Refused,'HOLD_CLASSIFICATION_|HOLD_CRITICAL_'):
                            stage.perform(req(name,phase)|dict(issue=336),{},(A,S,rt,Mock(),store,bridge))
                        self.assertEqual(store.data,before);self.assertEqual(store.path.read_bytes(),disk)
                        self.assertEqual(set(root.iterdir()),files)
                        self.assertEqual(bridge.mock_calls,[]);self.assertEqual(rt.mock_calls,[])
                    finally:os.close(store.lock)

    def test_critical_later_floor_and_unsupported_recovery_remain_precise(self):
        t=task();a=dict(base=BASE,head=HEAD,phase='qa',qa=dict(verdict='FAIL',
            reviewed_sha=HEAD,findings=['Critical authorization']))
        with self.assertRaisesRegex(ValueError,'HOLD_CRITICAL_'):smart.dispatch_gate(t,'author',a)
        # A cosmetic current PASS does not silently close a historical critical
        # finding, and unsupported structured source observations keep its floor.
        history=dict(a,qa=dict(verdict='PASS',reviewed_sha=HEAD,findings=[]),
            history=[dict(head=BASE,qa=dict(verdict='FAIL',reviewed_sha=BASE,
                                         findings=['Critical authorization']))])
        self.assertEqual(smart.classification(t,history)['risk'],'critical')
        self.assertEqual(smart.classification(t,dict(a,source_evidence={
            'risk':'low','critical_signs':True,'malformed':None}))['risk'],'critical')
        a['qa']['findings']=[dict(severity='critical')]
        with self.assertRaisesRegex(ValueError,'HOLD_CRITICAL_'):smart.dispatch_gate(t,'author',a)
        a['phase']='integrating'
        with self.assertRaisesRegex(ValueError,'SMART_RECOVERY'):smart.dispatch_gate(t,'integrate',a)
        with patch.object(smart,'classification_gate') as gate:
            for observed in (None, '', 'unknown', [], HEAD):
                a['phase']='ci'
                with self.subTest(observed=observed), self.assertRaisesRegex(ValueError,'BASE_CHANGED'):
                    smart.dispatch_gate(t,'integrate',a,live_dev=observed)
            gate.assert_not_called()
        with tempfile.TemporaryDirectory() as folder:
            store=Store(dict(issue=336,task=t,base=BASE,head=HEAD,phase='integrating',attempt=1))
            before=copy.deepcopy(store.data); bridge=Mock();rt=Mock()
            with self.assertRaisesRegex(core.Refused,'SMART_RECOVERY'):
                stage.perform(req('integrate','integrating')|dict(issue=336,_recover=True),{},
                              (A,S,rt,Mock(),store,bridge))
            self.assertEqual(store.data,before);self.assertEqual(bridge.mock_calls,[])
            self.assertEqual(rt.mock_calls,[])


class LiveDevRepair(unittest.TestCase):
    """R2 actual local Git and durable Store. Remote/QA/CI/mutex are boundary spies.

    No production new-policy positive is claimed: it has no proof producer. A
    test-only classification seam uses the existing SR1 closed comment-rename
    proof for exact controlled bytes, so R1's unconditional missing-proof HOLD
    cannot mask the ordering guard. All plan/binding/operation checks stay real.
    """
    def git(self, root, *args):
        result=subprocess.run(['/usr/bin/git','-c','core.hooksPath=/dev/null',
            '-c','core.fsmonitor=false','-c','commit.gpgsign=false',
            '-c','user.name=Synthetic repair','-c','user.email=repair@example.invalid',*args],
            cwd=root,env=dict(PATH='/usr/bin:/bin',HOME=str(root),GIT_CONFIG_NOSYSTEM='1',
            GIT_CONFIG_GLOBAL='/dev/null',GIT_TERMINAL_PROMPT='0',LANG='C.UTF-8'),
            capture_output=True,text=True,timeout=20)
        self.assertEqual(result.returncode,0,result.stderr)
        return result.stdout.strip()

    def exercise(self, moved, *, legacy=False, busy=False):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);repo=root/'repo';repo.mkdir();self.git(repo,'init','-q','-b','dev')
            path=repo/'apps/web/src/export.ts';path.parent.mkdir(parents=True)
            path.write_text('// OldExport\n');self.git(repo,'add','.');self.git(repo,'commit','-qm','base')
            base=self.git(repo,'rev-parse','HEAD');self.git(repo,'switch','-qc','automation/issue-336')
            path.write_text('// LatestExport\n');self.git(repo,'add','.');self.git(repo,'commit','-qm','candidate')
            head=self.git(repo,'rev-parse','HEAD');self.git(repo,'switch','-q','dev')
            worktrees=root/'worktrees';worktrees.mkdir();work=worktrees/'issue-336'
            self.git(repo,'worktree','add','-q',str(work),'automation/issue-336')
            # Exact synthetic non-executable change: every source/dependency byte
            # in this tiny repository is known. No model assurance is used.
            self.assertEqual(self.git(repo,'show',base+':apps/web/src/export.ts'),'// OldExport')
            self.assertEqual(self.git(work,'show',head+':apps/web/src/export.ts'),'// LatestExport')
            self.assertEqual(self.git(repo,'diff','--name-only',base,head),'apps/web/src/export.ts')
            self.assertEqual(self.git(repo,'ls-tree','-r','--name-only',base),'apps/web/src/export.ts')
            t=task(cursor=False,agy=False);t['allowed_paths']=['apps/web/src/export.ts'];bind(t)
            t['routing_policy']['plan']['binding']['head']=base
            if legacy:t=copy.deepcopy(TASK)|{'allowed_paths':['apps/web/src/export.ts']}
            state=root/'state';state.mkdir(mode=0o700);store=A.Store(state)
            try:
                store.data['active']=dict(issue=336,task=t,phase='ci',base=base,head=head,attempt=1,
                    integration=0,qa=dict(verdict='PASS',findings=[],reviewed_sha=head),ci=dict(sha=head))
                store.save();active=store.data['active'];events=[]
                bridge=A.Bridge.__new__(A.Bridge);bridge.store=store;bridge.work=work
                bridge.c=SimpleNamespace(repo=repo,state_dir=state,worktrees_root=worktrees)
                bridge.git=lambda *args,**kw:self.git(kw.get('cwd',repo),*args)
                bridge.unchanged_issue=Mock();bridge.candidate_identity=Mock()
                bridge.saved_qa=lambda a:core.need(A.qa_result(a['qa'],a['head']),'exact fixture QA')
                def remote():
                    events.append('remote')
                    return self.git(repo,'rev-parse','dev')
                bridge.remote_dev=remote
                bridge.integrate=Mock(wraps=bridge.integrate)
                def mutex():events.append('mutex');return not busy
                def continuity():events.append('continuity');return True
                rt=SimpleNamespace(lease=Mock(),publish=Mock(),continuity=continuity,
                    mutex=SimpleNamespace(try_acquire=mutex))
                # DEV moves only AFTER earlier pre-stage validation, in the
                # renewed exact CI check immediately before acquiring mutex.
                def checks(*_):
                    events.append('ci')
                    self.assertEqual(self.git(repo,'rev-parse','dev'),base)
                    if moved:
                        (repo/'docs').mkdir();(repo/'docs/notes.md').write_text('unrelated\n')
                        self.git(repo,'add','.');self.git(repo,'commit','-qm','concurrent dev')
                    return dict(sha=head,id=1)
                def proof(*_):
                    import smart_routing as sr
                    result=sr.classification_floor(fast(brief_usable=True))
                    self.assertTrue(result['evidence_complete']);self.assertEqual(result['risk'],'low')
                    events.append('floor');return result
                before=copy.deepcopy(store.data);disk=store.path.read_bytes()
                git_before=[self.git(work,*args) for args in (('rev-parse','HEAD'),
                    ('show','-s','--format=%P','HEAD'),('write-tree',),('status','--porcelain'))]
                plan_before=core.digest(t);state_files={p.name:p.read_bytes() for p in state.iterdir() if p.is_file()}
                with patch.object(smart,'classification_gate',side_effect=proof), \
                     patch.object(stage,'run_result',side_effect=checks), \
                     patch.object(A,'continuity',return_value=dict(max_attempts=3,max_integrations=3)):
                    call=lambda:stage.perform(req('integrate','ci')|dict(issue=336,head=head),{},
                                              (A,S,rt,Mock(),store,bridge))
                    if busy:
                        with self.assertRaisesRegex(core.Retry,'mutex busy'):call()
                    elif moved and not legacy:
                        with self.assertRaisesRegex(core.Refused,'HOLD_SOURCE_BASE_CHANGED_REPLAN_REQUIRED'):call()
                    else:call()
                self.assertEqual(core.digest(t),plan_before)
                if busy or moved and not legacy:
                    self.assertEqual(store.data,before);self.assertEqual(store.path.read_bytes(),disk)
                    self.assertEqual({p.name:p.read_bytes() for p in state.iterdir() if p.is_file()},state_files)
                    self.assertEqual([self.git(work,*args) for args in (('rev-parse','HEAD'),
                        ('show','-s','--format=%P','HEAD'),('write-tree',),('status','--porcelain'))],git_before)
                    bridge.integrate.assert_not_called();rt.publish.assert_not_called()
                elif legacy and moved:
                    self.assertEqual(active['integration'],1);self.assertEqual(active['phase'],'candidate')
                    self.assertEqual(len(self.git(work,'show','-s','--format=%P','HEAD').split()),2)
                    bridge.integrate.assert_called_once()
                else:
                    self.assertEqual(active['phase'],'promoting');self.assertEqual(active['integration'],0)
                    self.assertEqual(self.git(work,'rev-parse','HEAD'),head);bridge.integrate.assert_not_called()
                    self.assertEqual(active['qa'],before['active']['qa']);self.assertEqual(active['ci'],before['active']['ci'])
                if busy:self.assertNotIn('remote',events)
                else:
                    self.assertEqual(events.count('remote'),1)
                    self.assertLess(events.index('ci'),events.index('mutex'))
                    self.assertLess(events.index('mutex'),events.index('continuity'))
                    self.assertLess(events.index('continuity'),events.index('remote'))
                    if not legacy and not moved:self.assertEqual(events[-1],'floor')
                return dict(moved=moved,legacy=legacy,busy=busy,events=events,
                    before=before,after=copy.deepcopy(store.data),git_before=git_before,
                    git_after=[self.git(work,*args) for args in (('rev-parse','HEAD'),
                        ('show','-s','--format=%P','HEAD'),('write-tree',),('status','--porcelain'))],
                    plan_before=plan_before,plan_after=core.digest(t),
                    disk_before_sha256=hashlib.sha256(disk).hexdigest(),
                    disk_after_sha256=hashlib.sha256(store.path.read_bytes()).hexdigest(),
                    state_files_before={k:hashlib.sha256(v).hexdigest() for k,v in state_files.items()},
                    state_files_after={p.name:hashlib.sha256(p.read_bytes()).hexdigest()
                                       for p in state.iterdir() if p.is_file()},
                    integrate_calls=bridge.integrate.call_count,lease_boundary_calls=rt.lease.call_count,
                    publish_boundary_calls=rt.publish.call_count,real_provider_calls=0,network_calls=0,
                    classification_seam='test-only SR1 closed comment rename; no production proof producer',
                    deterministic_source_proof=dict(path='apps/web/src/export.ts',
                        before='// OldExport',after='// LatestExport',dependency_tree='one exact known file'),
                    boundaries='real Git/Store; remote observation, mutex, QA/CI, lease/publish spies')
            finally:os.close(store.lock)

    def test_advanced_live_dev_holds_before_git_checkpoint_or_counter(self):self.exercise(True)
    def test_bound_live_dev_control_reaches_promoting_without_merge(self):self.exercise(False)
    def test_existing_busy_mutex_prevents_remote_read(self):self.exercise(True,busy=True)
    def test_legacy_advanced_dev_still_performs_real_merge(self):self.exercise(True,legacy=True)


if __name__ == '__main__': unittest.main()

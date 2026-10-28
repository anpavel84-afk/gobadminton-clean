"""Legacy native read-only gate stays full; offline matrix has no provider calls."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from test_actions_train import ROOT, core, req, stage, S
import context_exchange as E
import context_native_delivery as N
import context_policy as C
from accepted_rules_fixture import accepted_rules_text

TEXT = accepted_rules_text(ROOT)
COMPARE = ROOT/'docs/workbench/context-exchange-20261023/stage5_offline_compare.py'
NATIVE = ROOT/'scripts/chatops/actions_train/native_antigravity.py'
GATE = ROOT/'scripts/chatops/actions_train/context_native_delivery.py'


def accepted():
    return TEXT, dict(schema='GB_RULES_CONTEXT_V1', revision=C.RULES_REVISION, commit=C.RULES_COMMIT,
        sha256=C.RULES_SHA256, bytes=C.RULES_SIZE, source=str(C.RULES_PATH),
        delivery='explicit_full_stdin', automatic_rules='disabled', user_config='ignored',
        candidate_instructions='untrusted_data')


def reference():
    return dict(path='docs/rules/ENGINEERING_OPERATING_MODEL.md', revision=C.RULES_COMMIT,
                sha256=C.RULES_SHA256, bytes=C.RULES_SIZE)


def load_compare():
    spec = importlib.util.spec_from_file_location('stage5_offline_compare', COMPARE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class NativeFailClosed(unittest.TestCase):
    def full(self, prompt='exact task'):
        return C.inject(prompt, True, ROOT, accepted(), role='qa', context_profile='full')

    def deliver(self, provider, role, **kwargs):
        return N.cursor_agy_context('exact task', True, ROOT, accepted(),
                                    provider=provider, operational_role=role,
                                    full_rules_reference=reference(), **kwargs)

    def assert_full(self, payload, receipt, provider, role, reason):
        full, baseline = self.full()
        self.assertEqual(payload, full)
        self.assertIn(TEXT, payload)
        self.assertTrue(payload.startswith('TRUSTED CLEAN OPERATING RULES; accepted commit ' + C.RULES_COMMIT))
        self.assertNotIn('CONTEXT_PROFILE scoped_v1', payload)
        self.assertEqual(receipt['stdin_sha256'], baseline['stdin_sha256'])
        self.assertEqual(receipt['semantic_input_bytes'], baseline['semantic_input_bytes'])
        self.assertEqual(receipt['delivery'], 'explicit_full_stdin')
        self.assertEqual(receipt['context_metrics']['policy_profile'], 'full')
        self.assertEqual(receipt['context_metrics']['effective_profile'], 'full')
        self.assertEqual(receipt['context_metrics']['delivered_policy_bytes'], C.RULES_SIZE)
        self.assertEqual(receipt['context_metrics']['full_rules_bytes'], C.RULES_SIZE)
        self.assertFalse(receipt['context_metrics']['scoped_qualified'])
        self.assertEqual(receipt['provider'], provider)
        self.assertEqual(receipt['operational_role'], role)
        self.assertEqual(receipt['context_metrics']['fallback_reason'], reason)
        self.assertEqual(receipt['context_metrics']['token_accounting'], 'not_exposed')
        self.assertIsNone(receipt['context_metrics']['input_tokens'])

    def test_runtime_pin_unchanged(self):
        index = json.loads((ROOT/'docs/rules/CONTEXT_SOURCES.json').read_text())['accepted_operating_model']
        self.assertEqual(C.RULES_COMMIT, index['commit'])
        self.assertEqual(C.RULES_SHA256, index['sha256'])
        self.assertEqual(C.RULES_SIZE, index['bytes'])
        self.assertEqual(hashlib.sha256(TEXT.encode()).hexdigest(), C.RULES_SHA256)
        self.assertIs(N.SCOPED_QUALIFIED, False)

    def test_default_profile_is_full_and_does_not_call_probe(self):
        def probe(_ref):
            raise AssertionError('default delivery must not consult verified_access')
        for provider in ('cursor', 'agy'):
            for role in ('analyst', 'independent_qa'):
                with self.subTest(provider=provider, role=role):
                    payload, receipt = self.deliver(provider, role, verified_access=probe,
                                                    scoped_guidance='DO_NOT_APPEND\n')
                    self.assert_full(payload, receipt, provider, role, None)
                    self.assertFalse(receipt['context_metrics']['verified_access_confirmed'])
                    self.assertNotIn('DO_NOT_APPEND', payload)

    def test_unverified_scoped_request_falls_back_to_exact_full_bytes(self):
        def raising(kind):
            def probe(_ref):
                raise kind('recipient access unconfirmed')
            return probe
        probes = (
            ('missing', None),
            ('false', lambda _ref: False),
            ('truthy_string', lambda _ref: 'yes'),
            ('truthy_int', lambda _ref: 1),
            ('oserror', raising(OSError)),
            ('valueerror', raising(ValueError)),
            ('runtimeerror', raising(RuntimeError)),
            ('typeerror', raising(TypeError)),
            ('keyerror', raising(KeyError)),
            ('assertion', raising(AssertionError)),
            ('exception', raising(Exception)),
        )
        guidance = 'If you need the complete accepted rules, read the immutable Git object.\n'
        for provider in ('cursor', 'agy'):
            for role in ('analyst', 'independent_qa'):
                for name, probe in probes:
                    with self.subTest(provider=provider, role=role, probe=name):
                        payload, receipt = self.deliver(
                            provider, role, requested_profile='scoped_v1', verified_access=probe,
                            scoped_guidance=guidance)
                        self.assert_full(payload, receipt, provider, role,
                                         'RECIPIENT_RULES_ACCESS_UNVERIFIED')
                        self.assertFalse(receipt['context_metrics']['verified_access_confirmed'])
                        self.assertNotIn(guidance, payload)
                        self.assertLess(len(E.compile_capsule(TEXT, 'qa', C.RULES_SHA256).encode()), len(TEXT.encode()))

    def test_confirmed_probe_still_does_not_enable_scoped_v1(self):
        seen = []
        original = reference()
        def probe(ref):
            seen.append(copy.deepcopy(ref))
            ref['sha256'] = 'mutated'
            return True
        for provider in ('cursor', 'agy'):
            for role in ('analyst', 'independent_qa'):
                with self.subTest(provider=provider, role=role):
                    seen.clear()
                    payload, receipt = self.deliver(
                        provider, role, requested_profile='scoped_v1', verified_access=probe)
                    self.assert_full(payload, receipt, provider, role, 'CURSOR_AGY_SCOPED_NOT_QUALIFIED')
                    self.assertTrue(receipt['context_metrics']['verified_access_confirmed'])
                    self.assertEqual(seen, [original])
                    self.assertEqual(reference(), original)

    def test_gate_source_never_calls_inject_with_scoped_profile(self):
        tree = ast.parse(GATE.read_text(encoding='utf-8'))
        calls = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                name = node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, 'attr', '')
                if name == 'inject':
                    calls.append(node)
        self.assertEqual(len(calls), 1)
        profiles = [kw.value.value for kw in calls[0].keywords if kw.arg == 'context_profile']
        self.assertEqual(profiles, ['full'])

    def test_unknown_provider_role_or_profile_refuses_without_partial_payload(self):
        for kwargs in (
                dict(provider='codex', operational_role='independent_qa'),
                dict(provider='cursor', operational_role='author'),
                dict(provider='agy', operational_role='qa'),
                dict(provider='cursor', operational_role='analyst', requested_profile='compact')):
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(core.Refused):
                    N.cursor_agy_context('exact task', True, ROOT, accepted(), **kwargs)
        with self.assertRaises(core.Refused):
            N.cursor_agy_context('exact task', False, ROOT, accepted(),
                                provider='cursor', operational_role='analyst')
        with self.assertRaises(ValueError):
            N.cursor_agy_context('exact task', True, ROOT, accepted(), provider='agy',
                                operational_role='independent_qa', scoped_guidance=None)

    def test_shared_compiler_unverified_access_keeps_full_rules_for_both_capsules(self):
        metadata = dict(commit=C.RULES_COMMIT, sha256=C.RULES_SHA256, bytes=C.RULES_SIZE)
        ref = reference()
        def boom(_ref):
            raise OSError('no recipient materialization')
        for capsule in ('planner', 'qa'):
            for probe in (None, lambda _ref: False, lambda _ref: 'yes', boom):
                with self.subTest(capsule=capsule, probe=probe):
                    prefix, metrics = E.rules_prefix(
                        text=TEXT, metadata=metadata, role=capsule, compact=True,
                        full_rules_reference=ref, verified_access=probe)
                    self.assertEqual(metrics['policy_profile'], 'full')
                    self.assertIn(TEXT, prefix)
                    self.assertNotIn('CONTEXT_PROFILE scoped_v1', prefix)
                    self.assertEqual(metrics['delivered_policy_bytes'], C.RULES_SIZE)
        scoped, metrics = E.rules_prefix(
            text=TEXT, metadata=metadata, role='qa', compact=True,
            full_rules_reference=ref, verified_access=lambda _ref: True)
        self.assertEqual(metrics['policy_profile'], 'scoped_v1')
        self.assertNotIn(TEXT, scoped)
        self.assertIn('CONTEXT_PROFILE scoped_v1', scoped)

    def test_inject_unverified_scoped_matches_full_for_the_native_qa_channel(self):
        full, full_receipt = self.full('native task')
        ref = reference()
        guidance = 'read the immutable rules\n'
        for probe in (None, lambda _ref: False):
            payload, receipt = C.inject(
                'native task', True, ROOT, accepted(), role='qa', context_profile='scoped_v1',
                full_rules_reference=ref, verified_access=probe, scoped_guidance=guidance)
            self.assertEqual(payload, full)
            self.assertEqual(receipt, full_receipt)
            self.assertIn(TEXT, payload)


class StageDoesNotSelectScoped(unittest.TestCase):
    def exercise(self, provider, qa):
        with tempfile.TemporaryDirectory(prefix='.context-native-') as temp:
            root = Path(temp)
            cli = root/'fake-codex'
            cli.write_text('trusted test fixture, never executed')
            captured = {}
            store = SimpleNamespace(data={'active': {
                'task': {}, 'head': 'a'*40, 'base': 'b'*40, 'attempt': 1, 'issue': 200}})
            layout = SimpleNamespace(repo=root, state_dir=root, worktrees=root, outbox=root)
            budget = SimpleNamespace(used=lambda *_a: 0, charge=Mock(), issue=None)
            budget.bind_issue = lambda issue: setattr(budget, 'issue', issue) or budget
            rt = SimpleNamespace(user='test', legacy=True, home=root, key=root/'key', layout=layout,
                slot='slot1', check_paths=Mock(), continuity=lambda: True, lease=Mock(), budget=budget)
            a = SimpleNamespace(RUNTIME_READS=(), Store=lambda *_a: store,
                atomic=lambda _p, _v: None, permitted=lambda *_a: True,
                subprocess=SimpleNamespace(Popen=Mock()))
            def factory(_c, _s):
                b = SimpleNamespace(c=_c, store=store, work=root, git=Mock(), unchanged_issue=Mock())
                def model(prompt, qa=False):
                    captured['codex_prompt'] = prompt
                    return {'verdict': 'PASS', 'findings': [], 'reviewed_sha': 'a'*40}
                b.model = model
                return b
            a.Bridge = factory
            s = SimpleNamespace(Runtime=lambda *_a, **_k: rt, uid_of=lambda _u: 1002, Hold=RuntimeError,
                                read_json=lambda *_a, **_k: {'mode': 'active', 'owned': {'slot1': 'x'}},
                                is_source_writer_stage=S.is_source_writer_stage)
            choice = {'provider': provider, 'effective_model': 'Auto' if provider == 'cursor' else 'claude-sonnet-5-5-medium',
                      'effort': 'medium', 'role': 'author' if provider == 'cursor' else 'qa'}
            def cursor_invoke(_bridge, _rt, prompt, _token, chosen, **_kwargs):
                captured['cursor_prompt'] = prompt
                chosen['native_receipt'] = {'rules_context': dict(chosen['rules_context']),
                                            'provider_reported_usage': None}
                return {'verdict': 'PASS', 'findings': [], 'reviewed_sha': 'a'*40,
                        'provider_reported_usage': None, 'observed_model_call_ids': None,
                        'provider_internal_calls': None}
            def agy_review(_work, _base, _head, prompt, _timeout, **kwargs):
                captured['agy_prompt'] = prompt
                captured['agy_kwargs'] = kwargs
                return ({'verdict': 'PASS', 'findings': [], 'reviewed_sha': 'a'*40},
                        {'rules_context': {'delivery': 'explicit_full_stream_json_stdin'},
                         'provider_reported_usage': None})
            with patch.object(stage, 'live', return_value=(a, s)), \
                 patch.object(stage.os, 'getuid', return_value=1002), \
                 patch.object(stage.os, 'getgid', return_value=1002), \
                 patch.object(stage, 'API', return_value=Mock()), \
                 patch.object(C, 'load', return_value=accepted()), \
                 patch.object(stage, 'route', return_value=choice), \
                 patch.object(C, 'verified_git_rules', side_effect=AssertionError('cursor/agy must not probe scoped access')) as git_probe, \
                 patch.object(core, 'task_review_route', return_value=choice), \
                 patch.object(core, 'diagnosis_route', return_value=choice), \
                 patch('native_cursor.invoke', side_effect=cursor_invoke), \
                 patch('native_antigravity.review', side_effect=agy_review), \
                 patch('native_antigravity.save_receipt', return_value='receipt.json'), \
                 patch('receiver.units_quiet'), \
                 patch('receiver.identity', return_value={'pid': 1, 'start': '1', 'boot': 'test'}):
                request = req('author' if provider == 'cursor' else 'qa', 'pr_wait')
                auth = 'cursor-test-token-not-a-credential' if provider == 'cursor' else None
                _a, _s, _rt, _api, _store, bridge = stage.setup(
                    request, {'codex': {'slot1': str(cli)}}, native_auth=auth)
                bridge.model('bounded immutable task', qa=qa)
            git_probe.assert_not_called()
            receipt = bridge.routing_receipts[0]['rules_context']
            return captured, receipt

    def test_cursor_author_stage_keeps_full_rules(self):
        captured, _receipt = self.exercise('cursor', False)
        prompt = captured['cursor_prompt']
        self.assertIn(TEXT, prompt)
        self.assertNotIn('CONTEXT_PROFILE scoped_v1', prompt)
        self.assertNotIn('codex_prompt', captured)

    def test_agy_stage_does_not_pretrim_rules_before_native_inject(self):
        captured, receipt = self.exercise('agy', True)
        self.assertEqual(captured['agy_prompt'], 'bounded immutable task')
        self.assertNotIn('context_profile', captured['agy_kwargs'])
        self.assertNotIn('verified_access', captured['agy_kwargs'])
        self.assertIn(TEXT, captured['agy_kwargs']['accepted_rules'][0])
        self.assertEqual(receipt['delivery'], 'explicit_full_stream_json_stdin')
        self.assertNotIn('CONTEXT_PROFILE scoped_v1', captured['agy_prompt'])

    def test_native_antigravity_inject_call_does_not_request_scoped_v1(self):
        tree = ast.parse(NATIVE.read_text(encoding='utf-8'))
        calls = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                name = node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, 'attr', '')
                if name == 'inject':
                    calls.append(node)
        self.assertEqual(len(calls), 1)
        keywords = {kw.arg for kw in calls[0].keywords}
        self.assertNotIn('context_profile', keywords)
        self.assertNotIn('verified_access', keywords)
        blob = ast.dump(calls[0])
        self.assertNotIn('scoped_v1', blob)


class OfflineComparison(unittest.TestCase):
    def test_committed_measurement_matches_a_fresh_run(self):
        module = load_compare()
        fresh = module.measure(ROOT)
        committed = json.loads((COMPARE.parent/'STAGE5_CURSOR_AGY_COMPARE.json').read_text(encoding='utf-8'))
        self.assertEqual(committed, fresh)
        self.assertEqual(fresh['provider_calls'], 0)
        self.assertEqual(fresh['tokens']['input_tokens'], 'not_exposed')
        self.assertEqual(fresh['tokens']['tokenizer'], 'not_exposed')
        self.assertEqual(fresh['tokens']['bytes_div_4'], 'not_used')
        self.assertEqual(fresh['scoped_delivery'], 'CURSOR_AUTHOR_IMPLEMENTED_DORMANT_AGY_NOT_ENABLED')
        self.assertFalse(fresh['cursor_author_enabled'])
        self.assertEqual(fresh['cursor_author_fallback_reason'], 'RECIPIENT_RULES_NOT_READONLY')
        self.assertEqual(fresh['providers_byte_identical'], 'VERIFIED')
        accepted_index = json.loads((ROOT/'docs/rules/CONTEXT_SOURCES.json').read_text())['accepted_operating_model']
        self.assertEqual(fresh['rules']['bytes'], accepted_index['bytes'])
        self.assertEqual(fresh['rules']['sha256'], accepted_index['sha256'])
        self.assertEqual(fresh['running_module_pin']['bytes'], C.RULES_SIZE)
        self.assertEqual(fresh['running_module_pin']['commit'], C.RULES_COMMIT)
        self.assertEqual(fresh['running_module_pin']['sha256'], C.RULES_SHA256)
        self.assertFalse(fresh['running_module_pin']['changed_by_this_comparison'])
        roles = {(row['provider'], row['operational_role']) for row in fresh['rows']}
        self.assertEqual(roles, {('cursor', 'analyst'), ('cursor', 'independent_qa'),
                                 ('agy', 'analyst'), ('agy', 'independent_qa'),
                                 ('cursor', 'author'), ('agy', 'author')})
        for row in fresh['rows']:
            self.assertGreater(row['full_package_bytes'], row['scoped_package_bytes'])
            self.assertEqual(row['full_canon_bytes'], accepted_index['bytes'])
            self.assertFalse(row['scoped_selected_for_delivery'])
            self.assertEqual(row['scoped_size_probe'], 'synthetic_reference_equality_not_a_recipient')
            self.assertGreater(row['package_byte_delta'], 0)
        report = (COMPARE.parent/'STAGE5_CURSOR_AGY_OFFLINE.md').read_text(encoding='utf-8')
        for row in fresh['rows']:
            self.assertIn(str(row['full_package_bytes']), report)
            self.assertIn(str(row['scoped_package_bytes']), report)
            self.assertIn(str(row['scoped_capsule_bytes']), report)
        self.assertIn('not_exposed', report)
        self.assertIn('NOT_MEASURED', report)
        self.assertIn('VERIFIED', report)

    def test_agy_qa_budget_formula_matches_native_and_exact_full_inject(self):
        module = load_compare(); result = module.measure(ROOT)
        budget = result['agy_qa_stage_budget']
        full, _ = C.inject('x', True, ROOT, accepted(), role='qa')
        self.assertEqual(budget['full_rules_overhead_bytes'], len(full.encode())-1)
        try:
            import native_antigravity as native
        except ImportError:
            native = None
        if native is not None:
            self.assertEqual(budget['input_limit_bytes'], native.QA_INPUT_LIMIT)
            self.assertEqual(budget['full_rules_overhead_bytes'], native.qa_rules_overhead())
            self.assertEqual(budget['full_stage_budget_bytes'], native.qa_stage_budget())
        self.assertGreater(budget['scoped_stage_budget_bytes'], budget['full_stage_budget_bytes'])
        prefix, _ = E.rules_prefix(text=TEXT, metadata=accepted()[1], role='qa', compact=True,
            full_rules_reference=reference(), verified_access=lambda _ref: True)
        self.assertEqual(budget['scoped_rules_overhead_bytes'], len((prefix+'BOUNDED STAGE INSTRUCTIONS:\n').encode()))
        self.assertEqual(budget['scoped_stage_budget_bytes'], budget['input_limit_bytes']-budget['scoped_rules_overhead_bytes'])
        agy_author = next(row for row in result['rows'] if row['provider']=='agy' and row['operational_role']=='author')
        self.assertEqual(agy_author['delivery_status'], 'NOT_QUALIFIED_UNTIL_312')


if __name__ == '__main__':
    unittest.main()

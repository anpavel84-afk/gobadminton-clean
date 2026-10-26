"""Existing stage path with fixture doubles; no model, network or deployment."""
import copy
from pathlib import Path
import subprocess
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import test_actions_train_stages as F
from test_actions_train import ROOT, core, stage, req
from test_actions_train_context import accepted
import context_policy as C
import test_plan_gate as G


class StageGateTests(unittest.TestCase):
    setUp = F.StageBoundaries.setUp
    tearDown = F.StageBoundaries.tearDown
    run_stage = F.StageBoundaries.run_stage
    exact_qa = F.StageBoundaries.exact_qa

    def plan(self):
        block, classifier, verifier = G.trusted_tools()
        self.store.data['active']['task']['acceptance'] = block.render(
            block.plan_for_changes([dict(path='scripts/helper.py', status='M')]))
        return block, classifier, verifier

    def with_real_gate(self, name, phase):
        tools = self.plan()
        self.store.data['active']['phase'] = phase
        self.exact_qa()
        with patch.object(G, 'trusted_tools', return_value=tools), \
             patch.object(tools[2], 'diff_changes', return_value=[dict(path='scripts/helper.py', status='M')]) as diff, \
             patch.object(stage, 'test_plan_check', wraps=G.stage_check) as gate, \
             patch.object(stage, 'run_result', return_value=dict(sha=F.HEAD, id=999)) as release:
            result = self.run_stage(name)
        gate.assert_called_once()
        self.assertEqual(result['test_plan']['status'], 'OK')
        self.assertEqual(diff.call_count, 0 if name == 'author' else 1)
        if name == 'promote': release.assert_called_once()
        return result

    def test_author_hook_before_attempt_keeps_existing_author_behavior_when_ok(self):
        self.with_real_gate('author', 'claimed')
        self.assertEqual(self.bridge.calls, ['immutable', 'author'])
        self.assertEqual(self.store.data['active']['attempt'], 2)
        self.assertEqual(self.store.data['active']['phase'], 'candidate')

    def test_publish_hook_at_exact_head_keeps_existing_no_push_behavior_when_ok(self):
        self.with_real_gate('publish', 'candidate')
        self.assertEqual(self.store.data['active']['phase'], 'pr_wait')
        self.assertNotIn('author', self.bridge.calls)
        self.assertNotIn('qa', self.bridge.calls)

    def test_qa_hook_at_exact_head_keeps_independent_review_when_ok(self):
        self.with_real_gate('qa', 'pr_wait')
        self.assertEqual(self.bridge.calls.count('qa'), 1)
        self.assertEqual(self.store.data['active']['phase'], 'qa')

    def test_promote_hook_keeps_saved_qa_ci_mutex_and_push_checks_when_ok(self):
        self.with_real_gate('promote', 'promoting')
        self.assertIn('saved_qa', self.bridge.calls)
        self.assertIn('stopped', self.bridge.calls)
        self.assertEqual(self.store.data['active']['phase'], 'dev_wait')

    def refusal(self, name, phase):
        self.store.data['active']['phase'] = phase
        before = copy.deepcopy(self.store.data)
        with self.assertRaisesRegex(core.Refused, 'MISSING_TEST_PLAN'):
            self.run_stage(name)
        self.assertEqual(self.store.data, before)
        self.assertEqual(self.bridge.calls, ['immutable'])
        self.assertEqual(self.bridge.test_plan['status'], 'MISSING_TEST_PLAN')

    def test_author_refuses_before_model_or_attempt(self): self.refusal('author', 'claimed')
    def test_publish_refuses_before_push(self): self.refusal('publish', 'candidate')
    def test_qa_refuses_before_model_or_checkpoint_change(self): self.refusal('qa', 'pr_wait')
    def test_promote_refuses_before_push_or_ci_call(self): self.refusal('promote', 'promoting')

    def test_claim_checks_plan_before_worktree_creation(self):
        self.store.data['active'] = None
        admitted = F.active('claimed')
        self.store.claim = lambda *args: admitted
        self.api = Mock(return_value={}); self.api.pages.return_value = []
        self.context = (F.A, F.S, self.rt, self.api, self.store, self.bridge)
        with self.assertRaisesRegex(core.Refused, 'MISSING_TEST_PLAN'):
            stage.perform(req('claim', 'empty'), {}, self.context)
        self.assertEqual(self.bridge.calls, ['immutable'])
        self.rt.lease.assert_not_called()

    def test_entry_refusal_receipt_uses_existing_result_metadata_no_store_fields(self):
        before = copy.deepcopy(self.store.data)
        with patch.object(stage, 'setup', return_value=self.context):
            result = stage.entry(req(), {})
        self.assertEqual(result['reason'], 'MISSING_TEST_PLAN')
        self.assertEqual(result['test_plan']['status'], 'MISSING_TEST_PLAN')
        self.assertEqual(before, self.store.data)
        self.assertNotIn('author', self.bridge.calls)

    def test_waiting_qa_keeps_profile_receipt_without_new_checkpoint_fields(self):
        tools = self.plan()
        self.store.data['active']['phase'] = 'pr_wait'
        before = copy.deepcopy(self.store.data)
        self.context = (F.A, F.S, self.rt, SimpleNamespace(pages=lambda *args: []), self.store, self.bridge)
        with patch.object(stage, 'setup', return_value=self.context), \
             patch.object(G, 'trusted_tools', return_value=tools), \
             patch.object(tools[2], 'diff_changes', return_value=[dict(path='scripts/helper.py', status='M')]):
            result = stage.entry(req('qa', 'pr_wait'), {})
        self.assertEqual(result['status'], 'waiting')
        self.assertEqual(result['test_plan']['status'], 'OK')
        self.assertEqual(self.store.data, before)

    def test_other_stages_leave_gate_metadata_and_behavior_unchanged(self):
        self.store.data['active']['phase'] = 'qa'; self.exact_qa()
        with patch.object(stage, 'run_result', return_value={'sha': F.HEAD}):
            result = self.run_stage('ci')
        self.assertNotIn('test_plan', result)
        self.assertEqual(self.store.data['active']['phase'], 'ci')

    def test_recovery_retains_all_existing_checks_and_never_pushes(self):
        self.store.data['active']['phase'] = 'promoting'; self.exact_qa(); self.bridge.remote = F.HEAD
        with patch.object(stage, 'run_result', return_value={'sha': F.HEAD}) as ci:
            result = self.run_stage('promote', _recover=True)
        self.assertTrue(result['recovered'])
        self.assertEqual(self.bridge.test_plan['status'], 'LEGACY_RECOVERY')
        ci.assert_called_once()
        self.assertIn('saved_qa', self.bridge.calls)
        self.assertFalse(any(isinstance(x, tuple) and x[0] == 'push' for x in self.bridge.calls))

    def test_recovery_keys_are_rejected_on_public_wire(self):
        for key in ('_recover', '_recovery_admission', 'recovery_receipt'):
            with self.assertRaises(core.Refused): core.request(req() | {key: True})


class ModelGuidanceTests(unittest.TestCase):
    def exercise(self, module=stage, name='author', acceptance=None):
        with tempfile.TemporaryDirectory(prefix='testing-gate-model-') as temp:
            root = Path(temp); captured = []
            block, classifier, verifier = G.trusted_tools()
            plan = block.plan_for_changes([dict(path='scripts/helper.py', status='M')])
            store = SimpleNamespace(data={'active': dict(task={'acceptance': block.render(plan) if acceptance is None else acceptance},
                head='a'*40, base='b'*40, attempt=1, issue=313)})
            rt = SimpleNamespace(user='test', legacy=True, home=root, key=root/'key',
                layout=SimpleNamespace(repo=root, state_dir=root, worktrees=root, outbox=root),
                check_paths=Mock(), continuity=lambda: True, lease=Mock(), budget=SimpleNamespace(used=lambda *_: 0))
            a = SimpleNamespace(RUNTIME_READS=(), Store=lambda *_: store, atomic=Mock(),
                subprocess=SimpleNamespace(Popen=Mock()))
            a.Bridge = lambda c, s: SimpleNamespace(c=c, store=s, work=root, git=Mock(),
                unchanged_issue=Mock(), model=lambda prompt, qa=False: captured.append(prompt))
            s = SimpleNamespace(Runtime=lambda *a, **k: rt, uid_of=lambda _: 1002, Hold=RuntimeError,
                read_json=lambda *a, **k: {'mode': 'active', 'owned': {'slot1': 'x'}})
            choice = dict(provider='codex', effective_model='gpt-6.1-sol', effort='high', role='author')
            request = req(name)
            with patch.object(module, 'live', return_value=(a, s)), patch.object(module, 'API', return_value=Mock()), \
                 patch.object(module.os, 'getuid', return_value=1002), patch.object(module.os, 'getgid', return_value=1002), \
                 patch.object(C, 'load', return_value=accepted()), patch.object(module, 'route', return_value=choice), \
                 patch.object(core, 'task_review_route', return_value=choice), \
                 patch.object(C, 'verified_git_rules', return_value=False), \
                 patch.object(G, 'trusted_tools', return_value=(block, classifier, verifier)), \
                 patch.object(verifier, 'diff_changes', return_value=[dict(path='scripts/helper.py', status='M')]), \
                 patch('receiver.units_quiet'):
                bridge = module.setup(request, {'codex': {'slot1': 'not-executed'}})[-1]
                try:
                    bridge.model('bounded original prompt', qa=name != 'author')
                except core.Refused:
                    self.assertEqual(captured, [])
                    raise
            return captured[0], bridge

    def test_author_guidance_appended_to_bounded_prompt(self):
        prompt, bridge = self.exercise()
        self.assertTrue(prompt.endswith('bounded original prompt\n' + G.guidance(bridge.test_plan)))
        self.assertEqual(bridge.test_plan['status'], 'OK')

    def test_independent_qa_guidance_appended_to_bounded_prompt(self):
        prompt, bridge = self.exercise(name='qa')
        self.assertTrue(prompt.endswith('bounded original prompt\n' + G.guidance(bridge.test_plan)))

    def test_direct_model_path_refuses_missing_plan_before_any_call(self):
        with self.assertRaisesRegex(core.Refused, 'MISSING_TEST_PLAN'):
            self.exercise(acceptance='no plan')

    def test_other_model_stage_prompts_are_byte_identical_to_base(self):
        raw = subprocess.check_output(['git', 'show', 'HEAD:scripts/chatops/actions_train/stage.py'], cwd=ROOT)
        old = ModuleType('base_stage'); exec(compile(raw, 'base_stage.py', 'exec'), old.__dict__)
        for name in ('diagnose', 'task_review'):
            with self.subTest(stage=name):
                current, _ = self.exercise(name=name)
                original, _ = self.exercise(module=old, name=name)
                self.assertEqual(current.encode(), original.encode())


if __name__ == '__main__':
    unittest.main()

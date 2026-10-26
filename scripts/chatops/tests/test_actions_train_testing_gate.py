"""Offline additive gate checks against synthetic immutable Git objects."""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts/chatops/actions_train'))
import test_plan_gate as G

B, C, V = G.trusted_tools()
CRITICAL = {
    'security_auth': 'apps/api/src/auth/session.ts',
    'permissions': 'scripts/permissions.py',
    'owner_admission': 'scripts/chatops/actions_train/owner_package_admission.py',
    'recovery_admission': 'scripts/chatops/actions_train/recovery_admission.py',
    'admission_pm': 'scripts/chatops/actions_train/admission_pm.py',
    'parser': 'scripts/parser.py',
    'sandbox': 'scripts/chatops/actions_train/native_guard.py',
    'stage': 'scripts/chatops/actions_train/stage.py',
    'core': 'scripts/chatops/actions_train/core.py',
    'receiver': 'scripts/chatops/actions_train/receiver.py',
    'context_policy': 'scripts/chatops/actions_train/context_policy.py',
    'budgets_acceptance': 'scripts/chatops/actions_train/cost_policy.py',
    'workflow': '.github/workflows/ci.yml',
    'rules': 'docs/rules/ENGINEERING_OPERATING_MODEL.md',
    'testing': 'scripts/chatops/testing/plan_block.py',
    'migrations': 'apps/api/migrations/001.sql',
}


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='testing-gate-')
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.env = {**os.environ, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull,
                    'GIT_CONFIG_SYSTEM': os.devnull, 'GIT_AUTHOR_NAME': 'Synthetic',
                    'GIT_AUTHOR_EMAIL': 'test@example.invalid', 'GIT_COMMITTER_NAME': 'Synthetic',
                    'GIT_COMMITTER_EMAIL': 'test@example.invalid'}
        self.git('init', '-q')
        for path in [*CRITICAL.values(), 'docs/guide.md', 'scripts/helper.py',
                     'apps/web/src/components/Card.tsx', 'apps/admin/src/style.css']:
            self.write(path, 'original\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'synthetic base')
        self.base = self.git('rev-parse', 'HEAD')
        self.active = dict(task={'acceptance': ''}, base=self.base, head=self.base)
        self.request = dict(stage='publish', base=self.base, head=self.base)

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.repo, env=self.env, capture_output=True,
                              text=True, check=True).stdout.strip()

    def write(self, path, text):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def change(self, path='docs/guide.md', kind='modify'):
        target = self.repo / path
        if kind == 'delete': target.unlink()
        elif kind == 'symlink':
            target.unlink(); target.symlink_to('nonexistent')
        elif kind == 'mode': target.chmod(0o755)
        elif kind == 'rename':
            target.rename(self.repo / 'docs/moved.md')
        else: target.write_text('one changed line\n')
        self.git('add', '-A')
        self.git('commit', '-qm', 'synthetic candidate')
        head = self.git('rev-parse', 'HEAD')
        self.active['head'] = self.request['head'] = head
        return V.diff_changes(self.base, head, self.repo)

    def plan(self, changes=None, tier=None):
        plan = B.plan_for_changes(changes or [dict(path='docs/guide.md', status='M')])
        if tier:
            plan['tier'], plan['risk'] = tier, C.tier_to_risk(tier)
            if tier == 'T3': plan['groups'] = list(C.STRICT_GROUPS)
        self.active['task']['acceptance'] = B.render(plan)
        return plan

    def check(self, **kwargs):
        return G.check(self.active, self.request, self.repo, **kwargs)

    def test_negative_t0_ordinary_docs_minimal_groups_and_no_qa_reduction(self):
        self.plan(self.change())
        result = self.check()
        self.assertEqual((result['status'], result['tier'], result['derived_tier']), ('OK', 'T0', 'T0'))
        self.assertEqual(result['required_groups'], ['foundation'])
        self.assertTrue(result['independent_qa_required'])
        self.assertIn('never reduces QA/CI', G.guidance(result))

    def test_positive_t1_one_function_targeted_groups_without_full_suite(self):
        self.plan(self.change('scripts/helper.py'))
        result = self.check()
        self.assertEqual((result['status'], result['derived_tier']), ('OK', 'T1'))
        self.assertEqual(result['required_groups'], ['targeted_py'])
        self.assertNotIn('chatops_receiver_actions_train', result['required_groups'])

    def test_t1_test_only_change_is_targeted(self):
        changes = self.change('scripts/helper.py')
        # A test path is tested through real raw Git addition as well.
        self.write('scripts/test_example.py', 'synthetic data\n')
        self.git('add', '.'); self.git('commit', '-qm', 'test data')
        self.active['head'] = self.request['head'] = self.git('rev-parse', 'HEAD')
        self.plan(V.diff_changes(self.base, self.active['head'], self.repo))
        self.assertEqual(self.check()['derived_tier'], 'T1')

    def test_t2_web_component_retains_visual_qa(self):
        self.plan(self.change('apps/web/src/components/Card.tsx'))
        result = self.check()
        self.assertEqual((result['status'], result['derived_tier']), ('OK', 'T2'))
        self.assertTrue(result['visual_qa_required'])

    def test_t2_admin_css_retains_visual_qa(self):
        self.plan(self.change('apps/admin/src/style.css'))
        self.assertTrue(self.check()['visual_qa_required'])
        self.assertEqual(self.check()['derived_tier'], 'T2')

    def test_visual_flag_cannot_be_removed(self):
        p = self.plan(self.change('apps/web/src/components/Card.tsx'))
        p['visual_qa'] = False
        self.active['task']['acceptance'] = B.render(p)
        self.assertEqual(self.check()['status'], 'VISUAL_QA_REQUIRED')

    def test_one_line_stage_change_is_t3(self):
        self.plan(self.change(CRITICAL['stage']))
        result = self.check()
        self.assertEqual((result['status'], result['derived_tier']), ('OK', 'T3'))
        self.assertEqual(result['required_groups'], list(C.STRICT_GROUPS))

    def test_over_declared_allowed_and_reported(self):
        self.plan(self.change(), tier='T3')
        self.assertEqual(self.check()['status'], 'OVER_DECLARED')

    def test_empty_diff_is_error_never_t0(self):
        self.plan()
        self.assertEqual(self.check()['status'], 'EMPTY_CHANGES')

    def test_required_groups_cannot_be_removed(self):
        p = self.plan(self.change('scripts/helper.py'))
        p['groups'] = ['foundation']
        self.active['task']['acceptance'] = B.render(p)
        self.assertEqual(self.check()['status'], 'MISSING_REQUIRED_GROUPS')

    def test_t3_requires_full_groups_even_before_author_attempt(self):
        self.request['stage'] = 'author'
        p = self.plan(tier='T3'); p['groups'] = ['foundation']
        self.active['task']['acceptance'] = B.render(p)
        self.assertEqual(self.check()['status'], 'MISSING_REQUIRED_GROUPS')

    def test_t3_requires_independent_qa_flag(self):
        self.request['stage'] = 'author'
        p = self.plan(tier='T3'); p['needs_independent_qa'] = False
        self.active['task']['acceptance'] = B.BEGIN + json.dumps(p) + B.END
        self.assertEqual(self.check()['status'], 'BAD_FIELD')

    def test_missing_plan_new_task_refused(self):
        self.request['stage'] = 'author'
        self.assertEqual(self.check()['status'], 'MISSING_TEST_PLAN')

    def test_duplicate_plan_refused(self):
        self.plan(); self.active['task']['acceptance'] *= 2
        self.assertEqual(self.check()['status'], 'DUPLICATE_BLOCK')

    def test_invalid_plan_refused(self):
        self.active['task']['acceptance'] = B.BEGIN + '{}' + B.END
        self.assertEqual(self.check()['status'], 'BAD_FIELD')

    def test_unknown_group_refused(self):
        p = self.plan(); p['groups'] = ['invented']
        self.active['task']['acceptance'] = B.BEGIN + json.dumps(p) + B.END
        self.assertEqual(self.check()['status'], 'UNKNOWN_GROUP')

    def test_candidate_file_never_supplies_plan(self):
        self.write('acceptance.txt', B.render(B.plan_for_changes([dict(path='docs/x.md', status='M')])))
        self.assertEqual(self.check()['status'], 'MISSING_TEST_PLAN')

    def test_recovery_exemption_only_trusted_controller_fields(self):
        for key in ('_recover', '_recovery_admission'):
            with self.subTest(key=key):
                self.request[key] = True
                self.assertEqual(self.check()['status'], 'LEGACY_RECOVERY')
                del self.request[key]
                self.active['task'][key] = True
                self.active['task']['acceptance'] = 'test_plan: LEGACY_RECOVERY; ' + key
                self.assertEqual(self.check()['status'], 'MISSING_TEST_PLAN')
        self.active['recovery_receipt'] = {'trusted': 'existing certified checkpoint'}
        self.assertEqual(self.check()['status'], 'LEGACY_RECOVERY')

    def test_recovery_does_not_exempt_invalid_present_plan(self):
        self.request['_recover'] = True
        self.active['task']['acceptance'] = B.BEGIN + '{}' + B.END
        self.assertEqual(self.check()['status'], 'BAD_FIELD')

    def test_plan_swapped_against_receiver_task_hash(self):
        self.plan(self.change()); self.request['_task_hash'] = G.digest(self.active['task'])
        self.active['task']['acceptance'] += '\nchanged admission'
        self.assertEqual(self.check()['status'], 'PLAN_SWAPPED')

    def test_plan_swapped_against_in_process_receipt(self):
        self.plan(self.change()); before = self.check()
        self.plan(tier='T3')
        self.assertEqual(self.check(previous=before)['status'], 'PLAN_SWAPPED')

    def test_swapped_head_refused(self):
        self.plan(self.change()); self.request['head'] = 'f' * 40
        self.assertEqual(self.check()['status'], 'HEAD_MISMATCH')

    def test_swapped_base_refused(self):
        self.plan(self.change()); self.request['base'] = 'f' * 40
        self.assertEqual(self.check()['status'], 'HEAD_MISMATCH')

    def test_previous_head_and_pins_cannot_be_reused(self):
        self.plan(self.change()); before = self.check()
        for key, code in [('base', 'HEAD_MISMATCH'), ('head', 'HEAD_MISMATCH'),
                          ('testing_pins_digest', 'TESTING_PIN_MISMATCH')]:
            stale = {**before, key: 'f' * 64}
            self.assertEqual(self.check(previous=stale)['status'], code)

    def test_pins_match_every_real_testing_dependency(self):
        for name, pin in G.PINS.items():
            self.assertEqual(hashlib.sha256((G.testing_directory() / name).read_bytes()).hexdigest(), pin)

    def test_tampered_trusted_file_copy_refuses_before_import(self):
        trusted = self.repo / 'trusted'; shutil.copytree(G.testing_directory(), trusted)
        self.plan()
        for name in G.PINS:
            p = trusted / name; original = p.read_bytes()
            p.write_bytes(b"raise RuntimeError('must not execute')\n")
            with patch.object(G, 'testing_directory', return_value=trusted):
                self.assertEqual(self.check()['status'], 'TESTING_PIN_MISMATCH')
            p.write_bytes(original)

    def test_candidate_modules_and_sys_path_cannot_replace_trusted_tools(self):
        self.plan(self.change())
        self.write('scripts/chatops/testing/plan_block.py', "raise RuntimeError('candidate executed')")
        before = list(sys.path)
        with patch.dict(sys.modules, {'plan_block': object(), 'catalog': object()}):
            self.assertEqual(self.check()['status'], 'OK')
        self.assertEqual(sys.path, before)
        self.assertFalse(list(self.repo.rglob('__pycache__')))

    def test_installed_and_repo_layout_selection(self):
        gate = self.repo / 'installed' / 'test_plan_gate.py'
        gate.parent.mkdir(); (gate.parent / 'testing').mkdir()
        with patch.object(G, '__file__', str(gate)):
            self.assertEqual(G.testing_directory(), gate.parent / 'testing')
        (gate.parent / 'testing').rmdir()
        with patch.object(G, '__file__', str(gate)):
            self.assertEqual(G.testing_directory(), self.repo / 'testing')

    def test_guidance_deterministic_bounded_detach_collect_and_no_model_wait(self):
        self.plan(tier='T3'); self.request['stage'] = 'author'
        receipt = self.check()
        text = G.guidance(receipt)
        self.assertEqual(text.encode(), G.guidance(copy.deepcopy(receipt)).encode())
        self.assertLessEqual(len(text.encode()), 900)
        for fragment in ('python3 scripts/chatops/testing/run_test_group.py run --detach / collect',
                         'no polling', 'reason code', 'same fingerprint is not rerun',
                         'full independent QA', 'all 7 Product CI jobs', 'visual QA retained',
                         'never reduces QA/CI', 'reconciliation, never replay'):
            self.assertIn(fragment, text)
        for status, passing in G.STATUSES.items():
            self.assertEqual(passing, status == 'PASS')
            self.assertIn(status, text)

    def test_manifest_stage_and_gate_hashes_exact_and_other_entries_unchanged(self):
        path = 'scripts/chatops/actions_train/manifest.json'
        current = json.loads((ROOT / path).read_text())['files']
        original = json.loads(subprocess.check_output(['git', 'show', 'HEAD:' + path], cwd=ROOT))['files']
        for name in ('stage.py', 'test_plan_gate.py'):
            key = 'scripts/chatops/actions_train/' + name
            self.assertEqual(current.pop(key), hashlib.sha256((ROOT / key).read_bytes()).hexdigest())
        original.pop('scripts/chatops/actions_train/stage.py')
        self.assertEqual(current, original)


def critical_test(path):
    def test(self):
        changes = self.change(path)
        self.assertEqual(C.classify(changes)['tier'], 'T3')
        for tier in ('T0', 'T1'):
            with self.subTest(tier=tier):
                self.plan(changes, tier=tier)
                self.assertEqual(self.check()['status'], 'UNDER_DECLARED')
    return test


for name, path in CRITICAL.items():
    setattr(GateTests, 'test_t3_' + name + '_refuses_t0_and_t1', critical_test(path))


def mode_test(kind):
    def test(self):
        self.plan(self.change(kind=kind), tier='T0')
        self.assertEqual(self.check()['status'], 'UNDER_DECLARED')
    return test


for kind in ('delete', 'symlink', 'mode'):
    setattr(GateTests, 'test_real_raw_diff_' + kind + '_raises_to_t3', mode_test(kind))


def test_rename(self):
    self.plan(self.change(CRITICAL['stage'], 'rename'), tier='T0')
    self.assertEqual(self.check()['status'], 'UNDER_DECLARED')


GateTests.test_rename_out_of_controller_cannot_lower_tier = test_rename


class EvidenceTests(unittest.TestCase):
    def test_only_conclusive_same_head_and_fingerprint_passes(self):
        record = dict(status='PASS', head='a' * 40, fingerprint='b' * 64, pending=False, cached=False)
        self.assertTrue(G.evidence_passes(record, head='a' * 40, fingerprint='b' * 64))
        for updates in (dict(head='c' * 40), dict(fingerprint='c' * 64), dict(pending=True),
                        dict(cached=True), dict(status='SAME_FINGERPRINT'), dict(head=None)):
            self.assertFalse(G.evidence_passes(record | updates, head='a' * 40, fingerprint='b' * 64))

    def test_same_fingerprint_runner_refuses_without_reexecution(self):
        import test_actions_train_testing_runner as fixture
        case = fixture.RunnerTests('test_second_identical_run_is_refused_without_executing_command')
        result = unittest.TestResult(); case.run(result)
        self.assertEqual(result.errors + result.failures, [])
        self.assertFalse(result.skipped)


def status_test(status):
    def test(self):
        sys.path.insert(0, str(ROOT / 'scripts/chatops/testing'))
        import run_test_group as R
        record = dict(status=status, head='a' * 40, fingerprint='b' * 64, pending=False, cached=False)
        self.assertFalse(G.evidence_passes(record, head='a' * 40, fingerprint='b' * 64))
        self.assertNotEqual(R.evidence_status([dict(group='tiny', status=status)], ['tiny']), 'PASS')
        self.assertNotEqual(R.compare_base_head(dict(status='PASS'), dict(status=status)), 'PASS')
        self.assertNotEqual(R.compare_base_head(dict(status=status), dict(status='PASS')), 'PASS')
    return test


for status in G.STATUSES:
    if status != 'PASS':
        setattr(EvidenceTests, 'test_' + status.lower() + '_never_becomes_fresh_pass', status_test(status))


if __name__ == '__main__':
    unittest.main()

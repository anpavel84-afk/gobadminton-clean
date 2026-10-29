"""Root AGY author upgrade (OD-014A) in isolated temp roots; no real OPS/system access."""
from contextlib import ExitStack
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from test_actions_train import ROOT, core

spec = importlib.util.spec_from_file_location(
    'agy_author_upgrade_fixture', ROOT / 'scripts/chatops/ops/antigravity_author_upgrade.py')
U = importlib.util.module_from_spec(spec)
spec.loader.exec_module(U)

stage5_spec = importlib.util.spec_from_file_location(
    'agy_author_stage5_quiet_fixture',
    ROOT / 'scripts/chatops/ops/stage5_cursor_context_upgrade.py')
S5 = importlib.util.module_from_spec(stage5_spec)
stage5_spec.loader.exec_module(S5)


def _material(bundle):
    source = bundle / 'scripts/chatops/actions_train'
    ops = (bundle / 'scripts/chatops/ops' / 'antigravity_author_upgrade.py').read_bytes()
    return {
        U.REPO_PREFIX + U.AUTHOR_MODULE: (source / U.AUTHOR_MODULE).read_bytes(),
        U.REPO_PREFIX + 'native_antigravity.py': (source / 'native_antigravity.py').read_bytes(),
        U.REPO_PREFIX + 'native_guard.py': (source / 'native_guard.py').read_bytes(),
        U.OPS_SCRIPT: ops,
    }


class Upgrade(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='agy-upgrade-fixture-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.install = self.root / 'installed'
        self.config = self.root / 'config'
        self.state = self.root / 'state'
        self.autonomy = self.root / 'autonomy'
        self.bundle = self.root / 'bundle'
        source = self.bundle / 'scripts/chatops/actions_train'
        ops = self.bundle / 'scripts/chatops/ops'
        source.mkdir(parents=True)
        ops.mkdir(parents=True)
        for p in (self.install, self.config, self.state, self.autonomy / 'slots',
                  self.autonomy / 'outbox'):
            p.mkdir(parents=True)
        self.commit = 'c' * 40
        self.task_hash = 'a' * 64
        # Author module + pins from repo; OPS script = loaded U source bytes.
        for name in (U.AUTHOR_MODULE, *U.PINS):
            raw = (ROOT / 'scripts/chatops/actions_train' / name).read_bytes()
            (source / name).write_bytes(raw)
            if name != U.AUTHOR_MODULE:
                (self.install / name).write_bytes(raw)
        ops_raw = (ROOT / 'scripts/chatops/ops' / 'antigravity_author_upgrade.py').read_bytes()
        (ops / 'antigravity_author_upgrade.py').write_bytes(ops_raw)
        self.policy = self.config / 'policy.json'
        self.policy.write_text(json.dumps(dict(mode='disabled', controller_sha=self.commit),
                                          indent=3) + '\n')
        (self.config / 'antigravity-qa.json').write_text(json.dumps(dict(
            schema='GB_ANTIGRAVITY_QA_29_V1', phase='ready',
            modules={n: U.sha((self.install / n).read_bytes()) for n in U.PINS}),
            indent=2) + '\n')
        (self.config / 'cursor-author.json').write_bytes(b'{"unchanged": "cursor marker"}\n')
        # Current host shape: qa unlimited, no per_issue_daily, author absent.
        self.budget = (
            b'{\n "schema":1, "providers":{"agy":{ "qa":"unlimited" }, '
            b'"codex":{"author":null}},\n '
            b'"slots":{"slot1":{"codex":{"qa":null}},'
            b'"slot2":{"agy":{"qa":"unlimited"}}}\n}\n')
        (self.config / 'budgets.json').write_bytes(self.budget)
        (self.state / 'slot2.json').write_bytes(b'{"operations":{"old":{"status":"unknown"}}}\n')
        for slot in ('slot1', 'slot2'):
            p = self.autonomy / 'outbox' / slot
            p.mkdir()
            (p / 'ledger.json').write_bytes(b'{ "old-day": {"agy": {"qa":1}} }\n')
        self.initial = self.files()
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)

        def trust(path):
            self.assertTrue(path.is_relative_to(self.root) or path == Path(U.__file__).resolve(),
                            str(path))

        def read_json(path, *a, **k):
            trust(path)
            return json.loads(path.read_bytes())

        self.stack.enter_context(patch.multiple(
            U, INSTALL=self.install, CONFIG=self.config, STATE=self.state,
            JOURNAL=self.state / 'upgrade.json', BACKUP=self.state / 'upgrade-backup',
            MARKER=self.config / 'antigravity-author.json',
            BUDGET=self.config / 'budgets.json',
            QA_MARKER=self.config / 'antigravity-qa.json'))
        self.stack.enter_context(patch.object(U.r, 'POLICY', self.policy))
        self.stack.enter_context(patch.object(U.r, 'AUTONOMY', self.autonomy))
        self.stack.enter_context(patch.object(U.r, 'trusted_tree', side_effect=trust))
        self.stack.enter_context(patch.object(U.r, 'read', side_effect=read_json))
        self.stack.enter_context(patch.object(U.os, 'geteuid', return_value=0))
        self.stack.enter_context(patch.object(U, 'quiet'))

        def fake_git_blobs(bundle, commit):
            mat = _material(bundle)
            # Fixture: equate OPS script bytes to the loaded module under test.
            mat[U.OPS_SCRIPT] = Path(U.__file__).read_bytes()
            return mat

        self.stack.enter_context(patch.object(U, 'git_blobs', side_effect=fake_git_blobs))

    def files(self):
        return {str(p.relative_to(self.root)): p.read_bytes()
                for p in self.root.rglob('*') if p.is_file()}

    def call(self, action='dry', **kw):
        return U.execute(
            action, self.bundle, kw.get('commit', self.commit), self.task_hash,
            base_controller=kw.get('base', self.commit),
            legacy_finite=kw.get('legacy_finite'))

    def test_dry_writes_nothing(self):
        result = self.call()
        self.assertTrue(result['dry'])
        self.assertEqual(result['qa_pins'], 'match')
        self.assertEqual(result['author_budget'], 'unlimited')
        self.assertEqual(self.files(), self.initial)

    def test_apply_verify_rollback_restores_exact_bytes(self):
        result = self.call('apply')
        self.assertEqual(result['phase'], 'installed-canary-disabled')
        self.assertFalse(result['ready'])
        self.assertTrue(self.call('verify')['verified'])
        marker = json.loads((self.config / 'antigravity-author.json').read_bytes())
        self.assertEqual((self.config / 'antigravity-author.json').stat().st_mode & 0o777, 0o644)
        self.assertEqual(marker['phase'], 'canary')
        self.assertEqual(marker['executor_uid'], 978)
        self.assertEqual(marker['canary_task_sha256'], self.task_hash)
        self.assertEqual(marker['model'], U.MODEL)
        for n, h in marker['modules'].items():
            if n == U.AUTHOR_MODULE:
                self.assertEqual(h, U.sha((self.install / n).read_bytes()))
            else:
                self.assertEqual(h, U.sha((self.install / n).read_bytes()))
        budget = json.loads((self.config / 'budgets.json').read_bytes())
        self.assertEqual(budget['providers']['agy'],
                         {'qa': 'unlimited', 'author': 'unlimited'})
        self.assertEqual(budget['slots']['slot2']['agy'],
                         {'qa': 'unlimited', 'author': 'unlimited'})
        self.assertNotIn('agy', budget['slots']['slot1'])
        self.assertIsNone(budget['providers']['codex']['author'])
        self.assertNotIn('per_issue_daily', budget['providers']['agy'])
        # Core/stage/cost_policy never installed by this upgrade.
        self.assertFalse((self.install / 'core.py').exists())
        self.assertFalse((self.install / 'stage.py').exists())
        self.assertFalse((self.install / 'cost_policy.py').exists())
        for name, raw in self.initial.items():
            if name.startswith('autonomy/') or name.startswith('state/') or name in (
                    'config/policy.json', 'config/antigravity-qa.json',
                    'config/cursor-author.json'):
                self.assertEqual((self.root / name).read_bytes(), raw, name)
        self.assertEqual(self.call('rollback')['phase'], 'rolled-back-disabled')
        for name, raw in self.initial.items():
            self.assertEqual((self.root / name).read_bytes(), raw, name)
        self.assertFalse((self.install / U.AUTHOR_MODULE).exists())
        self.assertFalse((self.config / 'antigravity-author.json').exists())

    def test_legacy_finite_budget_still_supported(self):
        result = U.budget_author_unlimited(self.budget, legacy_finite=3)
        parsed = json.loads(result)
        self.assertEqual(parsed['providers']['agy']['author'], 3)
        self.assertEqual(parsed['slots']['slot2']['agy']['author'], 3)
        self.assertEqual(parsed['providers']['agy']['qa'], 'unlimited')

    def test_budget_rejects_non_unlimited_qa_or_existing_author(self):
        for raw in (
                self.budget.replace(b'"qa":"unlimited"', b'"qa":2', 1),
                self.budget.replace(b'"qa":"unlimited"', b'"qa":"unlimited","author":null', 1),
                self.budget.replace(b'"agy":{ "qa":"unlimited" }',
                                    b'"agy":{ "qa":"unlimited","per_issue_daily":5 }', 1)):
            with self.assertRaises(core.Refused):
                U.budget_author_unlimited(raw)
        self.assertEqual((self.config / 'budgets.json').read_bytes(), self.budget)

    def test_stale_qa_pins_are_reported_not_rewritten(self):
        path = self.config / 'antigravity-qa.json'
        marker = json.loads(path.read_bytes())
        marker['modules']['native_antigravity.py'] = 'stale'
        path.write_bytes(U.encoded(marker))
        original = self.files()
        with self.assertRaisesRegex(core.Refused, 'QA marker pins stale'):
            self.call('apply')
        self.assertEqual(self.files(), original)

    def test_pin_git_blob_drift_refused(self):
        (self.install / 'native_guard.py').write_bytes(b'foreign guard')
        original = self.files()
        with self.assertRaisesRegex(core.Refused, 'differs from chosen Git blob'):
            self.call('apply')
        self.assertEqual(self.files(), original)

    def test_wrong_base_or_root_identity_refused(self):
        with patch.object(U, 'quiet', side_effect=core.Refused('base controller differs')):
            with self.assertRaises(core.Refused):
                self.call('apply', base='f' * 40)
        with patch.object(U.os, 'geteuid', return_value=978), self.assertRaises(core.Refused):
            self.call('apply')
        self.assertEqual(self.files(), self.initial)

    def test_rollback_never_rewinds_changed_history_or_foreign_code(self):
        self.call('apply')
        ledger = self.autonomy / 'outbox/slot2/ledger.json'
        ledger.write_bytes(b'new history')
        with self.assertRaisesRegex(core.Refused, 'history changed'):
            self.call('rollback')
        ledger.write_bytes(self.initial['autonomy/outbox/slot2/ledger.json'])
        (self.install / U.AUTHOR_MODULE).write_bytes(b'foreign code')
        with self.assertRaisesRegex(core.Refused, 'foreign target drift'):
            self.call('rollback')
        self.assertEqual((self.install / U.AUTHOR_MODULE).read_bytes(), b'foreign code')

    def test_write_allowlist_has_no_policy_qa_cursor_ledger_or_prod_path(self):
        for path in (self.policy, self.config / 'antigravity-qa.json',
                     self.config / 'cursor-author.json',
                     self.autonomy / 'outbox/slot2/ledger.json', self.root / 'prod'):
            with self.assertRaises(core.Refused):
                U.put(path, b'unwanted')
        self.assertEqual(self.files(), self.initial)

    def test_historical_quiescence_invokes_quiet_not_safe_release(self):
        quiet = self.stack.enter_context(patch.object(U, 'quiet'))
        self.call('dry')
        quiet.assert_called()
        # plan/verify/rollback must carry canary task hash into author quiet scope.
        quiet.assert_called_with(self.commit, canary_task_sha256=self.task_hash)
        src = Path(U.__file__).read_text()
        self.assertIn('quiet_v5', src)
        self.assertIn('QUIET_SCOPE_NATIVE_ANTIGRAVITY_AUTHOR', src)
        self.assertIn('native_antigravity_author', src)
        self.assertNotIn('allowUnknown', src)
        self.assertNotIn('safe_release', src)
        self.assertNotIn('pendingclearing', src.lower().replace('_', ''))

    def test_author_quiet_requests_named_author_scope_not_shared_default(self):
        captured = {}

        class Mod:
            QUIET_SCOPE_NATIVE_ANTIGRAVITY_AUTHOR = 'native_antigravity_author'

            @staticmethod
            def quiet_v5(resource_scope, *, author_canary_task_sha256=None):
                captured['scope'] = resource_scope
                captured['task'] = author_canary_task_sha256

        # Fresh module: setUp mocks U.quiet; probe the real wiring independently.
        spec2 = importlib.util.spec_from_file_location(
            'agy_author_upgrade_quiet_probe',
            ROOT / 'scripts/chatops/ops/antigravity_author_upgrade.py')
        probe = importlib.util.module_from_spec(spec2)
        spec2.loader.exec_module(probe)
        with patch.object(probe, '_load_quiet_mod', return_value=Mod), \
             patch.object(probe.r, 'read', return_value=dict(
                 mode='disabled', controller_sha=self.commit)):
            probe.quiet(self.commit, canary_task_sha256=self.task_hash)
        self.assertEqual(captured['scope'], 'native_antigravity_author')
        self.assertEqual(captured['task'], self.task_hash)
        with self.assertRaises(core.Refused):
            probe.quiet(self.commit, canary_task_sha256=None)


class QuietScope(unittest.TestCase):
    """Addressed quiet_v4/v5 resource_scope checks; no full matrix / history mutation."""

    PENDING = '3d556fe74c103d021184ca06a208718763f14f7713cdecfe56573a241a752a88'
    AUTHOR_TASK = '4b4ae8780d0ff1655886c7a9ed9c5c067a54d674e53ae4ea88cd474580a9fe06'

    def _finished_unknown_op(self, **overrides):
        op = {
            'task_hash': 'a' * 64,
            'binding': dict(action='train', attempt=1, generation=0,
                            head='8024caa659f4fee911d7e3afcb69ed7ac845ce5c',
                            issue=346, phase='idle', profile='agy', slot='slot2',
                            stage='product_qa'),
            'process': None,
            'started_at': 1793146026,
            'finished_at': 1793146043,
            'result': dict(status='unknown', safe_release=False,
                           reason='AGY_PARSE_FAILED',
                           adapter_error=dict(code='AGY_PARSE_FAILED', phase='parse',
                                              evidence_id='a21d29dae60642f784b6a52c6baca59d')),
        }
        op.update(overrides)
        return op

    def _ops(self, pending=None, op=None):
        if pending is None:
            pending = self.PENDING
        if op is None:
            op = self._finished_unknown_op()
        return dict(schema='GB_PRODUCT_QA_OPS_V1', generation=0, pending=pending,
                    operations={pending: op}, last=None)

    def _ready(self, confirmed_at=1793238391):
        return dict(schema='GB_PRODUCT_QA_ROLE_READY_V1', phase='ready', verdict='PASS',
                    confirmed_at=confirmed_at, model='claude-sonnet-5-5-medium',
                    executor_uid=978, operation='1d021ff96bbf57c048a12605e340590d192fefca5fcf1de512b7581dd5438960')

    def _physical(self, ops_path, ready_path, ops_value, ready_value, *, identity_dead=True):
        accounts = {'agentagency-dev': SimpleNamespace(pw_uid=1002),
                    'gb-slot2': SimpleNamespace(pw_uid=978)}
        dead = {'pid': 999, 'start': 'reused', 'boot': 'old'}

        def read(path, owner=None):
            # Same object: detect accidental pending clear / safe_release mutation.
            if path == ops_path:
                return ops_value
            if path == ready_path:
                return ready_value
            raise AssertionError('unexpected read ' + str(path))

        import pwd
        return (
            patch.object(pwd, 'getpwnam', side_effect=lambda n: accounts[n]),
            patch.object(S5, 'run', return_value=(
                b'ActiveState=inactive\nMainPID=0\nUnitFileState=masked\n')),
            patch.object(S5.receiver, 'units_quiet'),
            patch.object(S5.receiver, 'journal', return_value={'operations': {}}),
            patch.object(S5.receiver, 'checkpoint',
                         return_value=({'active': None, 'done': []}, [])),
            patch.object(S5.receiver, 'identity',
                         return_value=dead if identity_dead else {'pid': 1, 'start': 'x', 'boot': 'y'}),
            patch.object(S5.receiver, 'no_models'),
            patch.object(S5, 'lock_unheld'),
            patch.object(S5.receiver, 'free_lock'),
            patch.object(S5.receiver, 'recovery_journal', return_value={'receipts': {}}),
            patch.object(S5.os.path, 'lexists', return_value=False),
            patch.object(S5, 'V4_PRODUCT_OPS', ops_path),
            patch.object(S5, 'V4_PRODUCT_READY', ready_path),
            patch.object(S5.receiver, 'read', side_effect=read),
            patch.object(S5, '_uid978_provider_procs_absent'),
            patch.object(S5, 'V4_JOURNAL', type('P', (), {'exists': staticmethod(lambda: False)})()),
        )

    def test_default_shared_qa_still_holds_product_pending(self):
        with tempfile.TemporaryDirectory(prefix='quiet-scope-') as tmp:
            root = Path(tmp)
            ops_path = root / 'product-qa-operations.json'
            ready_path = root / 'product-qa-role-ready.json'
            ops_path.write_text('{}')
            ready_path.write_text('{}')
            ops = self._ops()
            snap = copy.deepcopy(ops)
            ctx = self._physical(ops_path, ready_path, ops, self._ready())
            with ExitStack() as stack:
                for p in ctx:
                    stack.enter_context(p)
                with self.assertRaisesRegex(core.Refused, 'product QA operation still pending'):
                    S5.quiet_v4()
                with self.assertRaisesRegex(core.Refused, 'product QA operation still pending'):
                    S5.quiet_v5()
                with self.assertRaisesRegex(core.Refused, 'product QA operation still pending'):
                    S5.quiet_v5(S5.QUIET_SCOPE_SHARED_QA)
                self.assertEqual(ops, snap)
                self.assertEqual(ops['pending'], self.PENDING)
                self.assertIs(ops['operations'][self.PENDING]['result']['safe_release'], False)

    def test_author_scope_allows_finished_independent_unknown_after_proof(self):
        with tempfile.TemporaryDirectory(prefix='quiet-scope-') as tmp:
            root = Path(tmp)
            ops_path = root / 'product-qa-operations.json'
            ready_path = root / 'product-qa-role-ready.json'
            ops_path.write_text('{}')
            ready_path.write_text('{}')
            ops = self._ops()
            ready = self._ready()
            snap = copy.deepcopy(ops)
            ctx = self._physical(ops_path, ready_path, ops, ready)
            with ExitStack() as stack:
                for p in ctx:
                    stack.enter_context(p)
                S5.quiet_v4(S5.QUIET_SCOPE_NATIVE_ANTIGRAVITY_AUTHOR,
                            author_canary_task_sha256=self.AUTHOR_TASK)
                S5.quiet_v5(S5.QUIET_SCOPE_NATIVE_ANTIGRAVITY_AUTHOR,
                            author_canary_task_sha256=self.AUTHOR_TASK)
                self.assertEqual(ops, snap)
                self.assertEqual(ops['pending'], self.PENDING)
                self.assertIs(ops['operations'][self.PENDING]['result']['safe_release'], False)

    def test_author_scope_holds_active_malformed_unfinished_same_task(self):
        with tempfile.TemporaryDirectory(prefix='quiet-scope-') as tmp:
            root = Path(tmp)
            ops_path = root / 'product-qa-operations.json'
            ready_path = root / 'product-qa-role-ready.json'
            ops_path.write_text('{}')
            ready_path.write_text('{}')
            cases = [
                ('same canary task', self._ops(pending=self.AUTHOR_TASK,
                                               op=self._finished_unknown_op()),
                 self._ready(), self.AUTHOR_TASK, 'same canary task'),
                ('same task different operation', self._ops(op=self._finished_unknown_op(
                     task_hash=self.AUTHOR_TASK)), self._ready(), self.AUTHOR_TASK, 'same canary task'),
                ('unfinished', self._ops(op=self._finished_unknown_op(finished_at=None)),
                 self._ready(), self.AUTHOR_TASK, 'unfinished'),
                ('non-QA', self._ops(op=self._finished_unknown_op(
                     binding=dict(stage='author', slot='slot2', profile='agy'))),
                 self._ready(), self.AUTHOR_TASK, 'non-QA'),
                ('wrong metadata safe_release', self._ops(op=self._finished_unknown_op(
                     result=dict(status='unknown', safe_release=True))),
                 self._ready(), self.AUTHOR_TASK, 'finished UNKNOWN'),
                ('ready before finished', self._ops(op=self._finished_unknown_op()),
                 self._ready(confirmed_at=1793146000), self.AUTHOR_TASK, 'ready proof'),
                ('malformed missing op', dict(schema='GB_PRODUCT_QA_OPS_V1', generation=0,
                                              pending=self.PENDING, operations={}, last=None),
                 self._ready(), self.AUTHOR_TASK, 'malformed'),
            ]
            for name, ops, ready, task, needle in cases:
                with self.subTest(name=name):
                    ctx = self._physical(ops_path, ready_path, ops, ready)
                    with ExitStack() as stack:
                        for p in ctx:
                            stack.enter_context(p)
                        with self.assertRaisesRegex(core.Refused, needle):
                            S5.quiet_v5(S5.QUIET_SCOPE_NATIVE_ANTIGRAVITY_AUTHOR,
                                        author_canary_task_sha256=task)
            # Live recorded PID with matching identity HOLDs even when finished_at set.
            live_op = self._finished_unknown_op(
                process={'pid': 4242, 'start': 'live', 'boot': 'boot'})
            ctx = self._physical(ops_path, ready_path, self._ops(op=live_op), self._ready(),
                                 identity_dead=False)
            with ExitStack() as stack:
                for p in ctx:
                    stack.enter_context(p)
                # Force identity equal to recorded process (alive).
                stack.enter_context(patch.object(
                    S5.receiver, 'identity',
                    return_value=live_op['process']))
                with self.assertRaisesRegex(core.Refused, 'live product QA process'):
                    S5.quiet_v5(S5.QUIET_SCOPE_NATIVE_ANTIGRAVITY_AUTHOR,
                                author_canary_task_sha256=self.AUTHOR_TASK)


if __name__ == '__main__':
    unittest.main()

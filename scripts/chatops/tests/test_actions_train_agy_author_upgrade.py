"""Root AGY author upgrade (OD-014A) in isolated temp roots; no real OPS/system access."""
from contextlib import ExitStack
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from test_actions_train import ROOT, core

spec = importlib.util.spec_from_file_location(
    'agy_author_upgrade_fixture', ROOT / 'scripts/chatops/ops/antigravity_author_upgrade.py')
U = importlib.util.module_from_spec(spec)
spec.loader.exec_module(U)


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
        src = Path(U.__file__).read_text()
        self.assertIn('quiet_v5', src)
        self.assertNotIn('safe_release', src)
        self.assertNotIn('pendingclearing', src.lower().replace('_', ''))


if __name__ == '__main__':
    unittest.main()

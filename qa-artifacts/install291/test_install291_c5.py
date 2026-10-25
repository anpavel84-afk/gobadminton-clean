"""Offline tests for the install291 candidate delta (post-C5 rules inventory + rollback gate).

No VPS, no root, no PROD. Run: python3 -B qa-artifacts/install291/test_install291_c5.py
The candidate must tolerate exactly one known mismatch: inventory `after` for
accepted-engineering-rules.md stays at EOM 1.3 while the live file is EOM 1.4.
Any other drift, a third rules sha, and a wrong rollback phase are refused.
Backup/restore copies the backup file bytes; it does not rewrite the rules entry.
"""
import contextlib
import hashlib
import importlib.util
import os
import pathlib
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.dont_write_bytecode = True
C5 = '41e12be2d551158e97ea30eaf8e95f992f998615'
EOM13 = '1169e965976e9498d4e5e1e23aae201e97ec9665:docs/rules/ENGINEERING_OPERATING_MODEL.md'
EOM14 = 'bc8bad0c38a861f8e72296d0a323e2941b9322e0:docs/rules/ENGINEERING_OPERATING_MODEL.md'
BASE = 'scripts/chatops/actions_train/'
TMP = pathlib.Path(tempfile.mkdtemp(prefix='i291test-'))


def git_show(spec):
    return subprocess.check_output(['git', '-C', str(REPO), 'show', spec])


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def setUpModule():
    global X, EOM13_BYTES, EOM14_BYTES
    mods = TMP / 'mods'
    mods.mkdir()
    for name in ('receiver.py', 'core.py', 'qa_recovery.py', 'installer.py'):
        (mods / name).write_bytes(git_show(C5 + ':' + BASE + name))
    sys.path.insert(0, str(mods))
    EOM13_BYTES = git_show(EOM13)
    EOM14_BYTES = git_show(EOM14)
    X = load(HERE / 'install291_c5.py', 'install291_c5_candidate')


def tearDownModule():
    shutil.rmtree(TMP, ignore_errors=True)


@contextlib.contextmanager
def no_lock():
    yield


class PatchCase(unittest.TestCase):
    def patch(self, obj, **kwargs):
        saved = {key: getattr(obj, key) for key in kwargs}
        for key, value in kwargs.items():
            setattr(obj, key, value)
        self.addCleanup(lambda: [setattr(obj, key, value) for key, value in saved.items()])


class Pins(PatchCase):
    def test_rules_pins_are_the_eom_git_objects(self):
        self.assertEqual(sha256(EOM13_BYTES), X.RULES_INVENTORY_SHA)
        self.assertEqual(sha256(EOM14_BYTES), X.RULES_LIVE_SHA)
        self.assertEqual(len(EOM13_BYTES), 100818)
        self.assertEqual(len(EOM14_BYTES), 113203)
        self.assertEqual(X.RULES_PATH, '/usr/local/lib/gb-actions-train/accepted-engineering-rules.md')
        self.assertNotEqual(X.RULES_INVENTORY_SHA, X.RULES_LIVE_SHA)

    def test_rules_file_is_outside_backup_set(self):
        self.assertEqual(set(X.BACKUP_PATHS), {'app', 'writer', 'server', 'extension', 'mapping', 'inventory'})
        self.assertNotIn(X.RULES_PATH, {str(path) for path in X.BACKUP_PATHS.values()})

    def test_sha256sums_matches_candidate(self):
        digest, name = (HERE / 'SHA256SUMS').read_text().split()
        self.assertEqual(name, 'install291_c5.py')
        self.assertEqual(digest, sha256((HERE / 'install291_c5.py').read_bytes()))

    def test_next_inventory_keeps_the_rules_entry(self):
        after = {str(X.TARGETS[name][0]): X.TARGETS[name][2]
                 for name in X.TARGETS if name not in X.NOT_IN_INVENTORY}
        after[X.RULES_PATH] = X.RULES_INVENTORY_SHA
        after['/usr/local/lib/gb-actions-train/content_identity.py'] = 'ab' * 32
        old = dict(manifest=X.INV_MANIFEST, after=dict(after))
        new = X.next_inventory(old)
        self.assertEqual(new['after'][X.RULES_PATH], X.RULES_INVENTORY_SHA)
        self.assertEqual(new['after']['/usr/local/lib/gb-actions-train/content_identity.py'], 'ab' * 32)
        self.assertEqual(old['after'][str(X.TARGETS['app'][0])], X.TARGETS['app'][2])
        self.assertEqual(new['after'][str(X.TARGETS['app'][0])], X.TARGETS['app'][3])
        self.assertEqual(set(new['after']), set(old['after']))
        self.assertEqual(new['manifest'], old['manifest'])


class InventoryIdle(PatchCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(dir=str(TMP)))
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        self.rules = self.tmp / 'accepted-engineering-rules.md'
        self.other = self.tmp / 'content_identity.py'
        self.policy_file = self.tmp / 'policy.json'
        self.policy_file.write_bytes(b'{"mode":"active"}\n')

    def _after(self, rules_inventory, other_bytes, other_inventory=None):
        after = {str(X.TARGETS[name][0]): X.TARGETS[name][2]
                 for name in X.TARGETS if name not in X.NOT_IN_INVENTORY}
        after[str(self.rules)] = rules_inventory
        after[str(self.other)] = other_inventory if other_inventory is not None else sha256(other_bytes)
        return after

    def _bind(self, rules_bytes, other_bytes, rules_inventory=None, other_inventory=None, manifest=None):
        self.rules.write_bytes(rules_bytes)
        self.other.write_bytes(other_bytes)
        inv = dict(manifest=X.INV_MANIFEST if manifest is None else manifest,
                   after=self._after(X.RULES_INVENTORY_SHA if rules_inventory is None else rules_inventory,
                                     other_bytes, other_inventory))
        policy = dict(mode='active', controller_sha=X.CONTROLLER, stage_workflow_sha256=X.STAGE_WF)
        reads = {
            str(X.R.POLICY): policy,
            str(X.J294): dict(phase='active', controller_sha=X.CONTROLLER),
            str(X.INV): inv,
            str(X.MARKER): dict(adapter_revision=X.CONTROLLER_C4),
        }

        def read(path, owner=0, limit=2097152):
            if str(path) not in reads:
                raise AssertionError('unexpected read ' + str(path))
            return reads[str(path)]

        self.patch(X, RULES_PATH=str(self.rules), live_slots=lambda: {'slot1': 1, 'slot2': 2},
                   apparmor_absent=lambda: None)
        self.patch(X.R, read=read)
        return inv

    def test_idle_accepts_post_c5_pair_and_either_matching_pin(self):
        self._bind(EOM14_BYTES, b'other-stable')  # inventory EOM 1.3, live EOM 1.4
        policy, inventory, _slots = X.idle()
        self.assertEqual(policy['controller_sha'], X.CONTROLLER)
        self.assertEqual(inventory['after'][str(self.rules)], X.RULES_INVENTORY_SHA)
        self._bind(EOM13_BYTES, b'other-stable')  # both EOM 1.3
        X.idle()
        self._bind(EOM14_BYTES, b'other-stable', rules_inventory=X.RULES_LIVE_SHA)  # both EOM 1.4
        X.idle()

    def test_idle_refuses_other_drifted_file(self):
        self._bind(EOM14_BYTES, b'drifted-live', other_inventory=sha256(b'other-stable'))
        with self.assertRaises(X.Refused) as caught:
            X.idle()
        self.assertEqual(str(caught.exception), 'installed inventory drift')

    def test_idle_refuses_third_rules_sha(self):
        third = b'third-rules-sha\n'
        self._bind(third, b'other-stable')  # inventory stays at the EOM 1.3 pin
        with self.assertRaises(X.Refused) as caught:
            X.idle()
        self.assertEqual(str(caught.exception), 'installed inventory drift')
        self._bind(third, b'other-stable', rules_inventory=sha256(third))  # matching third sha is still not a pin
        with self.assertRaises(X.Refused) as caught:
            X.idle()
        self.assertEqual(str(caught.exception), 'installed inventory drift')

    def test_idle_refuses_the_pinned_mismatch_on_another_path(self):
        self._bind(EOM13_BYTES, EOM14_BYTES, other_inventory=X.RULES_INVENTORY_SHA)
        with self.assertRaises(X.Refused) as caught:
            X.idle()
        self.assertEqual(str(caught.exception), 'installed inventory drift')

    def test_idle_refuses_reverse_rules_mismatch(self):
        self._bind(EOM13_BYTES, b'other-stable', rules_inventory=X.RULES_LIVE_SHA)
        with self.assertRaises(X.Refused) as caught:
            X.idle()
        self.assertEqual(str(caught.exception), 'installed inventory drift')

    def test_idle_still_refuses_manifest_and_target_drift(self):
        inv = self._bind(EOM14_BYTES, b'other-stable')
        X.idle()
        inv['manifest'] = '0' * 64
        with self.assertRaises(X.Refused) as caught:
            X.idle()
        self.assertEqual(str(caught.exception), 'installed inventory manifest drift')
        inv['manifest'] = X.INV_MANIFEST
        inv['after'][str(X.TARGETS['app'][0])] = 'ff' * 32
        with self.assertRaises(X.Refused) as caught:
            X.idle()
        self.assertEqual(str(caught.exception), 'installed inventory drift')

    def test_unchanged_foreign_uses_the_same_rules_exception(self):
        self._bind(EOM14_BYTES, b'other-stable')
        inv = dict(manifest=X.INV_MANIFEST, after=self._after(X.RULES_INVENTORY_SHA, b'other-stable'))
        self.patch(X.R, POLICY=self.policy_file, read=lambda *_a, **_k: inv)
        X.unchanged_foreign(dict(policy_sha=sha256(self.policy_file.read_bytes())))
        self.rules.write_bytes(b'third-rules-sha\n')
        with self.assertRaises(X.Refused) as caught:
            X.unchanged_foreign(dict(policy_sha=sha256(self.policy_file.read_bytes())))
        self.assertEqual(str(caught.exception), 'controller payload drift')
        self.rules.write_bytes(EOM14_BYTES)
        self.other.write_bytes(b'drifted-live')
        with self.assertRaises(X.Refused) as caught:
            X.unchanged_foreign(dict(policy_sha=sha256(self.policy_file.read_bytes())))
        self.assertEqual(str(caught.exception), 'controller payload drift')


class Rollback(PatchCase):
    def _receipt(self, phase, **extra):
        receipt = dict(schema=X.SCHEMA, pr_head=X.PR_HEAD, phase=phase)
        receipt.update(extra)
        return receipt

    def _bind_verb(self, receipt, **extra):
        flags = []

        def read(*_a, **_k):
            return receipt

        self.patch(X.R, trusted_tree=lambda *_a, **_k: None, read=read)
        self.patch(X, controller_lock=no_lock, manual_failure=lambda: flags.append('manual'),
                   atomic=lambda *_a, **_k: flags.append(('atomic', _a[1].get('phase') if len(_a) > 1 else None)),
                   **extra)
        return flags

    def test_second_rollback_does_not_write_rollback_failed(self):
        written = []
        receipt = self._receipt('rolled_back')
        self.patch(X.R, trusted_tree=lambda *_a, **_k: None, read=lambda *_a, **_k: receipt)
        self.patch(X, controller_lock=no_lock, manual_failure=lambda: written.append('manual'),
                   atomic=lambda *_a, **_k: written.append(_a[1]['phase']))
        with self.assertRaises(X.Refused) as caught:
            X.rollback()
        self.assertEqual(str(caught.exception), 'already rolled back')
        self.assertEqual(written, [])
        self.assertEqual(receipt['phase'], 'rolled_back')

    def test_restore_of_rolled_back_does_not_write(self):
        written = []
        receipt = self._receipt('rolled_back')
        self.patch(X, atomic=lambda *_a, **_k: written.append(_a[1]['phase']))
        with self.assertRaises(X.Refused) as caught:
            X.restore(receipt)
        self.assertEqual(str(caught.exception), 'already rolled back')
        self.assertEqual(written, [])
        self.assertEqual(receipt['phase'], 'rolled_back')

    def test_wrong_receipt_phase_refused_without_write(self):
        real_restore = X.restore
        for phase in ('verified', 'dry', 'rolled-back', None, ''):
            written = []
            receipt = self._receipt(phase)
            self.patch(X.R, trusted_tree=lambda *_a, **_k: None, read=lambda *_a, **_k: receipt)
            self.patch(X, controller_lock=no_lock, manual_failure=lambda: written.append('manual'),
                       atomic=lambda *_a, **_k: written.append('atomic'))
            with self.assertRaises(X.Refused) as caught:
                X.rollback()
            self.assertEqual(str(caught.exception), 'invalid rollback phase', phase)
            self.assertEqual(written, [], phase)
            self.assertEqual(receipt['phase'], phase)
            with self.assertRaises(X.Refused) as caught:
                real_restore(receipt)
            self.assertEqual(str(caught.exception), 'invalid rollback phase', phase)
            self.assertEqual(written, [], phase)
            self.assertEqual(receipt['phase'], phase)

    def test_rollback_failed_phase_still_reaches_restore(self):
        seen = []
        receipt = self._receipt('rollback_failed', slots={'ok': True})

        def restore(item):
            seen.append(item['phase'])
            raise X.Refused('stop-inside')

        self._bind_verb(receipt)
        self.patch(X, assert_manifest=lambda *_a, **_k: None, live_slots=lambda: {'ok': True}, restore=restore)
        with self.assertRaises(X.Refused) as caught:
            X.rollback()
        self.assertEqual(str(caught.exception), 'stop-inside')
        self.assertEqual(seen, ['rollback_failed'])

    def test_in_progress_restore_failure_still_records_rollback_failed(self):
        written = []
        receipt = self._receipt('active')
        self.patch(X, old_values=lambda _receipt: (_ for _ in ()).throw(X.Refused('rollback target drift')),
                   atomic=lambda *_a, **_k: written.append(dict(_a[1])))
        with self.assertRaises(X.Refused) as caught:
            X.restore(receipt)
        self.assertEqual(str(caught.exception), 'rollback target drift')
        self.assertEqual([item['phase'] for item in written], ['rollback_failed'])
        self.assertEqual(receipt['phase'], 'rollback_failed')

    def test_restore_copies_backup_bytes_exactly(self):
        root = pathlib.Path(tempfile.mkdtemp(dir=str(TMP)))
        self.addCleanup(lambda: shutil.rmtree(root, ignore_errors=True))
        names = ('app', 'writer', 'server', 'extension', 'mapping')
        live_dir = root / 'live'
        backup_dir = root / 'backup'
        live_dir.mkdir()
        backup_dir.mkdir()
        targets = {}
        old_raw = {}
        new_raw = {}
        for name in names:
            old_raw[name] = b'OLD-' + name.encode() + b'\n'
            new_raw[name] = b'NEW-' + name.encode() + b'\n'
            path = live_dir / name
            path.write_bytes(old_raw[name] if name == 'mapping' else new_raw[name])
            (backup_dir / name).write_bytes(old_raw[name])
            targets[name] = (path, name + '.src', sha256(old_raw[name]), sha256(new_raw[name]), 'unused')
        rules = root / 'accepted-engineering-rules.md'
        rules.write_bytes(b'LIVE-RULES-UNTOUCHED\n')
        inventory_blob = b'EXACT-INVENTORY\n' + X.RULES_INVENTORY_SHA.encode() + b'\nnot-canonical {\n'
        (backup_dir / 'inventory').write_bytes(inventory_blob)
        inventory_live = root / 'backup.json'
        inventory_live.write_bytes(b'LIVE-DIFFERENT\n')
        inventory_old = dict(manifest=X.INV_MANIFEST, after={
            str(targets[name][0]): targets[name][2] for name in names if name not in X.NOT_IN_INVENTORY})
        inventory_old['after'][X.RULES_PATH] = X.RULES_INVENTORY_SHA
        copied = []

        def fake_put(source, target, mode):
            data = pathlib.Path(source).read_bytes()
            copied.append((str(source), str(target), mode, data))
            pathlib.Path(target).write_bytes(data)
            os.chmod(target, mode)

        written = []
        backups = {name: dict(sha256=sha256(old_raw[name]), mode=0o640) for name in names}
        backups['inventory'] = dict(sha256=sha256(inventory_blob), mode=0o600)
        receipt = self._receipt('active', backups=backups, pma_work=dict(created=False))
        self.patch(X, TARGETS=targets, INV=inventory_live, BK=backup_dir,
                   old_values=lambda _receipt: inventory_old,
                   restored_checks=lambda *_a, **_k: None,
                   restart_web=lambda *_a, **_k: None,
                   run_writer_once=lambda: None,
                   atomic=lambda *_a, **_k: written.append(_a[1]['phase']))
        self.patch(X.I, put=fake_put)
        self.patch(X.R, read=lambda *_a, **_k: inventory_old)
        X.restore(receipt)
        self.assertEqual([item[1] for item in copied], [
            str(targets['app'][0]), str(targets['writer'][0]), str(targets['server'][0]),
            str(targets['extension'][0]), str(inventory_live)])
        for name in ('app', 'writer', 'server', 'extension'):
            self.assertEqual((live_dir / name).read_bytes(), old_raw[name])
        self.assertEqual((live_dir / 'mapping').read_bytes(), old_raw['mapping'])
        self.assertEqual(inventory_live.read_bytes(), inventory_blob)
        self.assertNotIn(X.RULES_LIVE_SHA.encode(), inventory_live.read_bytes())
        self.assertIn(X.RULES_INVENTORY_SHA.encode(), inventory_live.read_bytes())
        self.assertEqual(rules.read_bytes(), b'LIVE-RULES-UNTOUCHED\n')
        self.assertTrue(all(item[2] == 0o640 for item in copied if item[1] != str(inventory_live)))
        self.assertEqual(copied[-1][2], 0o600)
        self.assertEqual(stat.S_IMODE(inventory_live.stat().st_mode), 0o600)
        self.assertEqual(written, ['rolled_back'])
        self.assertEqual(receipt['phase'], 'rolled_back')
        self.assertNotIn(str(rules), [item[1] for item in copied])


if __name__ == '__main__':
    unittest.main(verbosity=2)

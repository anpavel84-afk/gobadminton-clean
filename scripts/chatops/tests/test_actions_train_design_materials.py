"""Offline Stage A negative controls; only tiny synthetic bytes, no real PNGs."""
import copy
import errno
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from test_actions_train import ROOT
import context_exchange as E
sys.path.insert(0, str(ROOT / 'scripts/chatops/ops'))
import design_materials as D
import design_access_probe as P

FIXTURES = ROOT / 'scripts/chatops/tests/fixtures/design_exchange'
REGISTRY = ROOT / 'docs/manifest/DESIGN_MATERIALS.json'


def synthetic_registry(raw=b'\x89PNG\r\nsynthetic-only'):
    registry = copy.deepcopy(D.load_registry(REGISTRY))
    material = copy.deepcopy(registry['materials'][0])
    material.update(id='synthetic', hub_locator='tiny.png',
        url=registry['hub']['base_url'] + 'tiny.png', bytes=len(raw), sha256=D.sha(raw))
    registry['materials'] = [material]
    registry['closures'] = [dict(id='synthetic-v1', materials=['synthetic'],
                                closure_sha256=D.closure_digest([material]))]
    registry['conflicts'] = []
    return registry


class DesignMaterials(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=FIXTURES)
        self.root = Path(self.temp.name)
        self.source, self.dest = self.root / 'source', self.root / 'dest'
        self.source.mkdir()
        self.dest.mkdir()
        self.raw = b'\x89PNG\r\nsynthetic-only'
        self.registry = synthetic_registry(self.raw)
        (self.source / 'tiny.png').write_bytes(self.raw)

    def tearDown(self):
        for parent, dirs, files in os.walk(self.root):
            os.chmod(parent, 0o700)
            for name in files:
                path = Path(parent) / name
                if not path.is_symlink():
                    os.chmod(path, 0o600)
        self.temp.cleanup()

    def imported(self):
        return D.import_closure(self.registry, 'synthetic-v1', self.source, self.dest, apply=True)

    def assert_stop(self, code, fn, *args, **kwargs):
        with self.assertRaises(D.DesignError) as caught:
            fn(*args, **kwargs)
        self.assertEqual(caught.exception.result['code'], code)
        self.assertIs(caught.exception.result['model_called'], False)
        self.assertIs(caught.exception.result['attempt_consumed'], False)
        return caught.exception.result

    def test_real_registry_exact_working_text_and_canonical_pretty_json(self):
        registry = D.load_registry(REGISTRY, ROOT)
        self.assertEqual(REGISTRY.read_text(), json.dumps(registry, ensure_ascii=False, sort_keys=True, indent=2) + '\n')
        for material in registry['materials']:
            if material['storage'] == 'git':
                raw = (ROOT / material['source']['path']).read_bytes()
                self.assertEqual((D.sha(raw), len(raw)), (material['sha256'], material['bytes']))
        frozen = next(m for m in registry['materials'] if m['id'] == 'style-guide-manifest')
        self.assertIn('NOT reconstructed', frozen['notes'][0])
        self.assertEqual(frozen['bytes'], 7274)

    def test_strict_unknown_keys_types_duplicates_and_digest(self):
        for mutate in (
            lambda r: r.update(extra=True),
            lambda r: r['hub'].update(extra=True),
            lambda r: r['materials'][0].update(extra=True),
            lambda r: r['materials'][0]['approval_ref'].update(extra=True),
            lambda r: r['materials'].append(copy.deepcopy(r['materials'][0])),
            lambda r: r['materials'][0].update(bytes=True),
            lambda r: r['materials'][0].update(sha256='z' * 64),
            lambda r: r['materials'][0].update(url='https://evil.invalid/tiny.png'),
            lambda r: r['closures'][0].update(closure_sha256='0' * 64),
            lambda r: r['open_owner_decisions'][0].update(extra=1),
            lambda r: r['owner_rulings'][0].update(extra=1),
        ):
            value = copy.deepcopy(self.registry)
            mutate(value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                D.validate_registry(value)
        with self.assertRaises(ValueError):
            D.parse('{"x":1,"x":2}')
        with self.assertRaises(ValueError):
            D.parse('{"x":NaN}')

    def test_git_text_hash_drift_rejected(self):
        registry = D.load_registry(REGISTRY)
        material = next(m for m in registry['materials'] if m['storage'] == 'git')
        material['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'git text bytes'):
            D.validate_registry(registry, ROOT)

    def test_closure_digest_matches_context_exchange(self):
        rows = [dict(id='b', version='v1', sha256='b' * 64, bytes=2),
                dict(id='a', version='v2', sha256='a' * 64, bytes=1)]
        self.assertEqual(D.closure_digest(rows), E.digest(sorted(rows, key=lambda m: (m['id'], m['version']))))
        self.assertEqual(P.closure_digest(rows), D.closure_digest(rows))
        self.assertEqual(D.registry_digest(self.registry), E.digest(self.registry))

    def test_closure_size_bound_and_unapproved_import(self):
        registry = copy.deepcopy(self.registry)
        members = []
        for index in range(5):
            member = copy.deepcopy(registry['materials'][0])
            member.update(id='large-' + str(index), bytes=D.MAX_FILE)
            members.append(member)
        registry['materials'] = members
        registry['closures'][0].update(materials=[m['id'] for m in members],
                                       closure_sha256=D.closure_digest(members))
        with self.assertRaisesRegex(ValueError, 'closure digest/size'):
            D.validate_registry(registry)
        self.registry['materials'][0]['status'] = 'proposed'
        self.assert_stop(D.DESIGN_REFERENCE_NOT_APPROVED, self.imported)

    def test_world_writable_destination_and_empty_existing_dir_refused(self):
        os.chmod(self.dest, 0o777)
        self.assert_stop(D.HUB_IMPORT_UNSAFE, self.imported)
        self.assert_stop(D.HUB_IMPORT_UNSAFE, D.rollback, self.dest, dry_run=False)
        os.chmod(self.dest, 0o755)
        final = self.dest / self.registry['closures'][0]['closure_sha256']
        final.mkdir()
        self.assert_stop(D.HUB_IMPORT_UNSAFE, self.imported)
        self.assertEqual(list(final.iterdir()), [])

    def test_309_negative_regression_no_closure_and_complete_verified_delivery(self):
        fixture = json.loads((FIXTURES / 'issue309-negative-regression.json').read_text())
        registry = D.load_registry(REGISTRY, ROOT)
        results = D.require_materials(fixture['required_ids'], registry, fixture['delivered_closure'])
        self.assertEqual(len(results), 4)
        self.assertEqual({r['code'] for r in results}, {D.DESIGN_INPUT_REQUIRED})
        self.assertTrue(all(r['model_called'] is False and r['attempt_consumed'] is False for r in results))
        # This is a synthetic verified metadata fixture, not a real access receipt.
        complete = dict(materials=[m for m in registry['materials'] if m['id'] in fixture['required_ids']])
        self.assertEqual(D.require_materials(fixture['required_ids'], registry, complete,
                                           D.registry_digest(registry)), [])
        without_frozen = dict(materials=[m for m in complete['materials'] if m['id'] != 'style-guide-manifest'])
        self.assertEqual(D.require_materials(['style-guide-manifest'], registry, without_frozen)[0]['code'],
                         D.DESIGN_INPUT_REQUIRED)

    def test_requirement_stop_controls(self):
        registry = copy.deepcopy(self.registry)
        delivered = dict(materials=copy.deepcopy(registry['materials']))
        self.assertEqual(D.require_materials(['unknown'], registry, delivered)[0]['code'], D.DESIGN_INPUT_REQUIRED)
        registry['materials'][0]['status'] = 'proposed'
        self.assertEqual(D.require_materials(['synthetic'], registry, delivered)[0]['code'], D.DESIGN_REFERENCE_NOT_APPROVED)
        registry['materials'][0]['status'] = 'approved'
        for field, value in [('sha256', '0' * 64), ('bytes', 1), ('bytes', True), ('version', 'v2')]:
            bad = copy.deepcopy(delivered)
            bad['materials'][0][field] = value
            self.assertEqual(D.require_materials(['synthetic'], registry, bad)[0]['code'], D.DESIGN_INPUT_HASH_MISMATCH)
        registry['conflicts'] = [dict(id='conflict', state='unresolved', blocking=True, topic='permission conflict')]
        self.assertEqual(D.require_materials([], registry, delivered)[0]['code'], D.DESIGN_REQUIREMENT_CONFLICT)
        registry['conflicts'][0]['blocking'] = False
        self.assertEqual(D.require_materials([], registry, delivered), [])
        registry['conflicts'][0].update(state='resolved', blocking=True)
        self.assertEqual(D.require_materials([], registry, delivered), [])
        self.assertEqual(D.require_materials([], registry, delivered, '0' * 64)[0]['code'], D.EXCHANGE_BINDING_MISMATCH)

    def test_stop_builder_is_closed_and_model_free(self):
        for code in D.STOP_CODES:
            result = D.stop_result(code, 'test', 'synthetic')
            self.assertEqual(set(result), {'code', 'stage', 'ref', 'expected', 'observed', 'remediation',
                                          'model_called', 'attempt_consumed'})
        with self.assertRaises(ValueError):
            D.stop_result('STYLE_GUIDE_GAP', 'test', 'x')

    def test_dry_run_writes_nothing_even_when_destination_missing(self):
        target = self.dest / 'does-not-exist'
        before = sorted(str(p.relative_to(self.root)) for p in self.root.rglob('*'))
        receipt = D.import_closure(self.registry, 'synthetic-v1', self.source, target)
        self.assertTrue(receipt['dry_run'])
        self.assertEqual(before, sorted(str(p.relative_to(self.root)) for p in self.root.rglob('*')))
        self.assertEqual(receipt['euid'], os.geteuid())

    def test_import_verify_reuse_and_permissions(self):
        receipt = self.imported()
        path = Path(receipt['path'])
        self.assertFalse(receipt['reused'])
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o555)
        for child in path.iterdir():
            self.assertEqual(stat.S_IMODE(child.stat().st_mode), 0o444)
            if os.geteuid() == 0:
                self.assertEqual((child.stat().st_uid, child.stat().st_gid), (0, 0))
        manifest = D.parse((path / 'CLOSURE.json').read_bytes())
        self.assertEqual(manifest['closure_sha256'], D.closure_digest(manifest['materials']))
        self.assertTrue(D.verify_closure(self.registry, 'synthetic-v1', path)['verified'])
        self.assertTrue(self.imported()['reused'])
        self.assertEqual(set(p.name for p in self.dest.iterdir()), {path.name})

    def test_existing_changed_bytes_or_manifest_or_extra_file_refused(self):
        receipt = self.imported()
        path = Path(receipt['path'])
        material = path / receipt['materials'][0]['name']
        os.chmod(material, 0o644)
        material.write_bytes(b'x' * len(self.raw))
        self.assert_stop(D.HUB_IMPORT_UNSAFE, self.imported)
        material.write_bytes(self.raw)
        os.chmod(material, 0o444)
        os.chmod(path, 0o755)
        (path / 'extra').write_text('unreviewed')
        self.assert_stop(D.HUB_IMPORT_UNSAFE, self.imported)
        (path / 'extra').unlink()
        manifest = path / 'CLOSURE.json'
        os.chmod(manifest, 0o644)
        manifest.write_bytes(manifest.read_bytes() + b'\n')
        self.assert_stop(D.HUB_IMPORT_UNSAFE, self.imported)

    def test_wrong_source_hash_and_length_do_not_retry(self):
        for raw, code in ((b'x' * len(self.raw), D.HUB_SHA_MISMATCH), (b'x', D.HUB_BYTES_MISMATCH)):
            (self.source / 'tiny.png').write_bytes(raw)
            sleeps = []
            self.assert_stop(code, D.import_closure, self.registry, 'synthetic-v1', self.source, self.dest,
                             sleep=sleeps.append)
            self.assertEqual(sleeps, [])
            self.assertEqual(list(self.dest.iterdir()), [])

    def test_missing_closure_and_source_controls(self):
        self.assert_stop(D.DESIGN_INPUT_REQUIRED, D.import_closure, self.registry, 'missing', self.source, self.dest)
        (self.source / 'tiny.png').unlink()
        sleeps = []
        self.assert_stop(D.HUB_UNAVAILABLE, D.import_closure, self.registry, 'synthetic-v1', self.source, self.dest,
                         sleep=sleeps.append)
        self.assertEqual(sleeps, [])

    def test_unsafe_locators(self):
        for bad in ('/abs.png', '../tiny.png', 'a/../tiny.png', 'a//tiny.png', './tiny.png',
                    'a\\tiny.png', 'a\ntiny.png', '..', 'a/./b', 'tiny%2epng'):
            value = copy.deepcopy(self.registry)
            value['materials'][0]['hub_locator'] = bad
            value['materials'][0]['url'] = value['hub']['base_url'] + bad
            with self.subTest(bad=bad):
                self.assert_stop(D.HUB_LOCATOR_REJECTED, D.import_closure, value, 'synthetic-v1', self.source, self.dest)

    def test_symlink_file_directory_source_root_and_dest_rejected(self):
        target = self.source / 'tiny.png'
        target.unlink()
        target.symlink_to(self.root / 'elsewhere')
        self.assert_stop(D.HUB_IMPORT_UNSAFE, self.imported)
        target.unlink()
        target.write_bytes(self.raw)
        link = self.root / 'source-link'
        link.symlink_to(self.source, target_is_directory=True)
        self.assert_stop(D.HUB_IMPORT_UNSAFE, D.import_closure, self.registry, 'synthetic-v1', link, self.dest)
        nested = copy.deepcopy(self.registry)
        nested['materials'][0].update(hub_locator='link/tiny.png', url=nested['hub']['base_url'] + 'link/tiny.png')
        (self.source / 'link').symlink_to(self.source, target_is_directory=True)
        self.assert_stop(D.HUB_IMPORT_UNSAFE, D.import_closure, nested, 'synthetic-v1', self.source, self.dest)
        destlink = self.root / 'dest-link'
        destlink.symlink_to(self.dest, target_is_directory=True)
        self.assert_stop(D.HUB_IMPORT_UNSAFE, D.import_closure, self.registry, 'synthetic-v1', self.source, destlink, apply=True)

    def test_hardlinks_fifo_and_oversize_refused(self):
        target = self.source / 'tiny.png'
        os.link(target, self.source / 'hardlink')
        self.assert_stop(D.HUB_IMPORT_UNSAFE, self.imported)
        (self.source / 'hardlink').unlink()
        target.unlink()
        os.mkfifo(target)
        self.assert_stop(D.HUB_IMPORT_UNSAFE, self.imported)
        target.unlink()
        with target.open('wb') as stream:
            stream.truncate(D.MAX_FILE + 1)
        self.assert_stop(D.HUB_IMPORT_UNSAFE, self.imported)

    def test_transient_retry_then_success_and_exhaustion(self):
        original = D._read_at
        calls, sleeps = [], []
        def flaky(fd, name):
            calls.append(name)
            if len(calls) < 3:
                raise OSError(errno.EIO, 'synthetic transient')
            return original(fd, name)
        with patch.object(D, '_read_at', side_effect=flaky):
            receipt = D.import_closure(self.registry, 'synthetic-v1', self.source, self.dest, sleep=sleeps.append)
        self.assertTrue(receipt['dry_run'])
        self.assertEqual((len(calls), sleeps), (3, [1, 3]))
        sleeps.clear()
        with patch.object(D, '_read_at', side_effect=OSError(errno.ETIMEDOUT, 'synthetic')) as read:
            self.assert_stop(D.HUB_UNAVAILABLE, D.import_closure, self.registry, 'synthetic-v1', self.source,
                             self.dest, sleep=sleeps.append)
        self.assertEqual((read.call_count, sleeps), (3, [1, 3]))

    def test_staging_cleanup_after_write_or_reverify_failure(self):
        original = D._write_at
        calls = []
        def fail_second(fd, name, raw):
            calls.append(name)
            if len(calls) == 2:
                raise OSError(errno.ENOSPC, 'synthetic full disk')
            original(fd, name, raw)
        with patch.object(D, '_write_at', side_effect=fail_second):
            self.assert_stop(D.HUB_UNAVAILABLE, self.imported)
        self.assertEqual(list(self.dest.iterdir()), [])
        with patch.object(D, '_verify_at', side_effect=D.DesignError(D.HUB_IMPORT_UNSAFE, 'staging')):
            self.assert_stop(D.HUB_IMPORT_UNSAFE, self.imported)
        self.assertEqual(list(self.dest.iterdir()), [])

    def test_rollback_only_old_same_owner_staging(self):
        published = Path(self.imported()['path'])
        old = self.dest / ('.staging-synthetic-v1-' + 'a' * 24)
        fresh = self.dest / ('.staging-synthetic-v1-' + 'b' * 24)
        other = self.dest / '.staging-not-our-format'
        for path in (old, fresh, other):
            path.mkdir()
            (path / 'partial').write_text('synthetic')
        os.utime(old, (1, 1))
        self.assertEqual(D.rollback(self.dest)['staging'], [old.name])
        self.assertTrue(old.exists())
        self.assertEqual(D.rollback(self.dest, dry_run=False)['staging'], [old.name])
        self.assertFalse(old.exists())
        self.assertTrue(all(p.exists() for p in (fresh, other, published)))
        self.assertTrue(D.verify_closure(self.registry, 'synthetic-v1', published)['verified'])
        with self.assertRaises(ValueError):
            D.rollback(self.dest, min_age=0)

    def test_rollback_never_follows_staging_symlink_or_hardlink(self):
        name = '.staging-synthetic-v1-' + 'c' * 24
        link = self.dest / name
        link.symlink_to(self.source, target_is_directory=True)
        self.assertEqual(D.rollback(self.dest, dry_run=False)['staging'], [])
        self.assertEqual((self.source / 'tiny.png').read_bytes(), self.raw)
        link.unlink()
        link.mkdir()
        os.link(self.source / 'tiny.png', link / 'hardlink')
        os.utime(link, (1, 1))
        self.assert_stop(D.HUB_IMPORT_UNSAFE, D.rollback, self.dest, dry_run=False)
        self.assertTrue(link.exists())

    def test_receipt_never_overwritten(self):
        target = self.root / 'receipt.json'
        D.write_receipt(target, {'first': True})
        with self.assertRaises(FileExistsError):
            D.write_receipt(target, {'second': True})
        self.assertEqual(D.parse(target.read_bytes()), {'first': True})

    def test_probe_missing_dir_and_directory_name_binding(self):
        missing = P.probe(self.root / 'missing', 'author', 'synthetic-revision', 'a' * 64)
        self.assertEqual((missing['result'], missing['stop_code']), ('FAIL', D.DESIGN_INPUT_REQUIRED))
        empty = self.dest / ('f' * 64)
        empty.mkdir()
        self.assertEqual(P.probe(empty, 'qa', 'synthetic', 'a' * 64)['stop_code'], D.DESIGN_INPUT_REQUIRED)
        path = Path(self.imported()['path'])
        wrong = self.dest / 'wrong-name'
        path.rename(wrong)
        result = P.probe(wrong, 'qa', 'synthetic-revision', 'a' * 64)
        self.assertEqual((result['result'], result['stop_code']), ('FAIL', D.DESIGN_INPUT_HASH_MISMATCH))

    @unittest.skipIf(os.geteuid() == 0, 'root can open 0444 files for writing; PASS requires non-root')
    def test_probe_pass_then_writable_file_and_directory_fail(self):
        receipt = self.imported()
        path = Path(receipt['path'])
        result = P.probe(path, 'author', 'synthetic-revision', 'a' * 64)
        self.assertEqual((result['result'], result['stop_code']), ('PASS', None))
        self.assertEqual(result['uid'], os.getuid())
        self.assertEqual(len(result['files']), 2)
        self.assertTrue(all(row['write_open']['denied'] for row in result['files']))
        with patch.object(P.os, 'geteuid', return_value=0):
            self.assertEqual(P.probe(path, 'author', 'synthetic', 'a' * 64)['stop_code'], D.HUB_IMPORT_UNSAFE)
        target = path / receipt['materials'][0]['name']
        os.chmod(target, 0o644)
        result = P.probe(path, 'author', 'synthetic-revision', 'a' * 64)
        self.assertEqual((result['result'], result['stop_code']), ('FAIL', D.HUB_IMPORT_UNSAFE))
        self.assertEqual(target.read_bytes(), self.raw)  # probe never writes
        os.chmod(target, 0o444)
        os.chmod(path, 0o755)
        self.assertEqual(P.probe(path, 'qa', 'synthetic', 'a' * 64)['stop_code'], D.HUB_IMPORT_UNSAFE)

    @unittest.skipIf(os.geteuid() == 0, 'root bypasses permissions; separate root control below')
    def test_probe_wrong_hash_length_unreadable_and_manifest_writable(self):
        receipt = self.imported()
        path = Path(receipt['path'])
        target = path / receipt['materials'][0]['name']
        for bad in (b'x' * len(self.raw), b'x'):
            os.chmod(target, 0o644)
            target.write_bytes(bad)
            os.chmod(target, 0o444)
            self.assertEqual(P.probe(path, 'qa', 'synthetic', 'a' * 64)['stop_code'], D.DESIGN_INPUT_HASH_MISMATCH)
        os.chmod(target, 0o000)
        result = P.probe(path, 'qa', 'synthetic', 'a' * 64)
        self.assertEqual(result['stop_code'], D.DESIGN_INPUT_UNREADABLE)
        self.assertEqual(result['files'][1]['errno'], errno.EACCES)
        os.chmod(target, 0o644)
        target.write_bytes(self.raw)
        os.chmod(target, 0o444)
        os.chmod(path / 'CLOSURE.json', 0o644)
        self.assertEqual(P.probe(path, 'qa', 'synthetic', 'a' * 64)['stop_code'], D.HUB_IMPORT_UNSAFE)

    @unittest.skipUnless(os.geteuid() == 0, 'root negative control only; never escalate tests')
    def test_root_probe_must_fail_as_writable(self):
        path = Path(self.imported()['path'])
        result = P.probe(path, 'author', 'synthetic', 'a' * 64)
        self.assertEqual((result['result'], result['stop_code']), ('FAIL', D.HUB_IMPORT_UNSAFE))

    def test_cli_validation_dry_run_verify_and_probe_exit_codes(self):
        registry_path = self.root / 'registry.json'
        registry_path.write_bytes(D.canonical(self.registry))
        tool = ROOT / 'scripts/chatops/ops/design_materials.py'
        common = [sys.executable, '-B', str(tool)]
        validate = subprocess.run(common + ['validate-registry', '--registry', str(REGISTRY), '--repo-root', str(ROOT)], capture_output=True)
        self.assertEqual(validate.returncode, 0, validate.stdout)
        command = common + ['import', '--registry', str(registry_path), '--closure-id', 'synthetic-v1',
            '--source-root', str(self.source), '--dest-root', str(self.dest)]
        dry = subprocess.run(command, capture_output=True)
        self.assertEqual(dry.returncode, 0, dry.stdout)
        self.assertTrue(D.parse(dry.stdout)['dry_run'])
        self.assertEqual(list(self.dest.iterdir()), [])
        applied = subprocess.run(command + ['--apply'], capture_output=True)
        self.assertEqual(applied.returncode, 0, applied.stdout)
        path = D.parse(applied.stdout)['path']
        verify = subprocess.run(common + ['verify', '--registry', str(registry_path), '--closure-id',
            'synthetic-v1', '--closure-dir', path], capture_output=True)
        self.assertEqual(verify.returncode, 0, verify.stdout)
        probe_tool = ROOT / 'scripts/chatops/ops/design_access_probe.py'
        command = [sys.executable, '-B', str(probe_tool), '--closure-dir', path, '--role', 'qa',
            '--adapter-revision', 'synthetic', '--permission-profile-digest', 'a' * 64]
        result = subprocess.run(command, capture_output=True)
        self.assertEqual(result.returncode, 1 if os.geteuid() == 0 else 0, result.stdout)
        missing = subprocess.run(command[:4] + [str(self.root / 'absent')] + command[5:], capture_output=True)
        self.assertNotEqual(missing.returncode, 0)


if __name__ == '__main__':
    unittest.main()

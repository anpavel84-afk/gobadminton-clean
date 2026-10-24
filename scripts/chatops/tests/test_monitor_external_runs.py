"""Offline metadata/privacy checks for evidence runs outside train slots."""
import builtins
from contextlib import contextmanager, ExitStack
import datetime
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch


PAYLOAD = Path(__file__).resolve().parents[1] / 'actions_train' / 'monitor_payload'
SPEC = importlib.util.spec_from_file_location('external_monitor_writer', PAYLOAD / 'writer.py')
writer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(writer)
NOW = datetime.datetime(2026, 10, 24, 12, tzinfo=datetime.timezone.utc)
SECRET = 'SECRET-token-password-should-never-be-published'


class ExternalRunsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def stamp(self, path, age):
        at = NOW.timestamp() - age
        os.utime(path, (at, at))

    def evidence(self, tag, prefix='qa', age=30, exit_value=None, events=True,
                 result=None, meta=None):
        d = self.root / (prefix + '-evidence-' + tag)
        d.mkdir()
        if events:
            (d / 'events.jsonl').write_text(SECRET)
            self.stamp(d / 'events.jsonl', age)
        if exit_value is not None:
            (d / 'exit.txt').write_text(exit_value)
            self.stamp(d / 'exit.txt', age)
        if result is not None:
            (d / 'result.json').write_text(json.dumps(result))
        if meta is not None:
            (d / 'meta.json').write_text(json.dumps(meta))
        self.stamp(d, age)
        return d

    def scan(self):
        return writer.external_runs(self.root, NOW)

    def one(self):
        block = self.scan()
        self.assertTrue(block['available'])
        self.assertEqual(len(block['runs']), 1)
        return block['runs'][0]

    @contextmanager
    def private_content_guard(self):
        opened = []

        def guarded(real_open):
            def record(path, *args, **kwargs):
                opened.append(path if isinstance(path, int) else os.fspath(path))
                return real_open(path, *args, **kwargs)
            return record

        with ExitStack() as stack:
            for module in (os, builtins, io):
                stack.enter_context(patch.object(module, 'open', side_effect=guarded(module.open)))
            try:
                yield opened
            finally:
                forbidden = {'events.jsonl', 'stderr', 'prompt.md'}
                self.assertFalse([path for path in opened if not isinstance(path, int)
                                  and os.fsdecode(os.path.basename(path)) in forbidden],
                                 'private content opened')

    def test_running_and_metadata(self):
        d = self.evidence('running', meta={'role': 'QA reviewer', 'model': 'gpt-6.1-sol'})
        (d / '.codex').mkdir()
        self.stamp(d / '.codex', 100)
        r = self.one()
        self.assertEqual((r['state'], r['kind'], r['age_s']), ('running', 'qa', 30))
        self.assertEqual(r['started_utc'], (NOW - datetime.timedelta(seconds=100)).isoformat())
        self.assertEqual(r['last_event_utc'], (NOW - datetime.timedelta(seconds=30)).isoformat())
        self.assertEqual((r['exit_code'], r['verdict'], r['reviewed_sha']), (None, None, None))
        self.assertEqual((r['role'], r['model']), ('QA reviewer', 'gpt-6.1-sol'))
        self.assertEqual(self.scan()['running'], 1)
        self.assertEqual(self.scan()['generated_utc'], NOW.isoformat())
        self.assertEqual(set(r), {'tag', 'kind', 'state', 'started_utc', 'last_event_utc',
                                 'age_s', 'exit_code', 'verdict', 'reviewed_sha', 'role', 'model'})

    def test_stale_and_threshold(self):
        self.evidence('stale', age=901)
        self.evidence('boundary', age=900)
        states = {r['tag']: r['state'] for r in self.scan()['runs']}
        self.assertEqual(states, {'stale': 'stale', 'boundary': 'running'})
        self.assertEqual(self.scan()['running'], 2)

    def test_future_activity_is_stale_beyond_clock_tolerance(self):
        self.evidence('future', age=-61)
        self.evidence('tolerated', age=-60)
        self.evidence('future-no-events', events=False, exit_value='', age=-61)
        runs = {r['tag']: r for r in self.scan()['runs']}
        self.assertEqual(runs['future']['state'], 'stale')
        self.assertEqual(runs['future-no-events']['state'], 'stale')
        self.assertEqual(runs['tolerated']['state'], 'running')
        self.assertTrue(all(r['age_s'] == 0 for r in runs.values()))

    def test_finished_verdicts_and_sha(self):
        for verdict in ('PASS', 'FAIL', 'BLOCKED'):
            with self.subTest(verdict=verdict):
                d = self.evidence(verdict, exit_value='0\n',
                                  result={'verdict': verdict, 'reviewed_sha': 'abcdef0123' * 4,
                                          'findings': [SECRET], 'text': SECRET})
                r = next(r for r in self.scan()['runs'] if r['tag'] == verdict)
                self.assertEqual((r['state'], r['verdict'], r['reviewed_sha']),
                                 ('done', verdict, 'abcdef0123ab'))
                self.assertEqual(r['exit_code'], 0)
                self.assertTrue(d.is_dir())
        self.assertEqual(self.scan()['running'], 0)
        self.assertNotIn(SECRET, json.dumps(self.scan()))

    def test_failed_and_timeout(self):
        self.evidence('failed', exit_value='1')
        self.evidence('timeout', exit_value='TIMEOUT\n')
        runs = {r['tag']: r for r in self.scan()['runs']}
        self.assertEqual(runs['failed']['exit_code'], 1)
        self.assertEqual(runs['timeout']['exit_code'], 'TIMEOUT')
        self.assertTrue(all(r['state'] == 'failed' for r in runs.values()))

    def test_diagnosis_and_author_never_open_private_content(self):
        self.evidence('astra-diagnosis-r3', result={'diagnosis': SECRET})
        d = self.evidence('author-r1', prefix='author', exit_value='1')
        (d / 'events.jsonl').write_text('')
        (d / 'stderr').write_text(SECRET)
        (d / 'prompt.md').write_text(SECRET)
        self.stamp(d / 'events.jsonl', 30)
        self.stamp(d / 'stderr', 120)
        self.stamp(d / 'prompt.md', 150)
        with self.private_content_guard() as opened:
            block = self.scan()
        self.assertTrue(opened)
        runs = {r['tag']: r for r in block['runs']}
        self.assertEqual(runs['astra-diagnosis-r3']['kind'], 'diagnosis')
        self.assertIsNone(runs['astra-diagnosis-r3']['verdict'])
        self.assertEqual((runs['author-r1']['kind'], runs['author-r1']['state']), ('author', 'failed'))
        self.assertEqual(runs['author-r1']['started_utc'], (NOW - datetime.timedelta(seconds=120)).isoformat())
        self.assertNotIn(SECRET, json.dumps(block))

    def test_private_content_guard_detects_mutated_open_on_every_api(self):
        d = self.evidence('mutation')
        (d / 'stderr').write_text(SECRET)
        (d / 'prompt.md').write_text(SECRET)
        for module in (os, builtins, io):
            for name in ('events.jsonl', 'stderr', 'prompt.md'):
                with self.subTest(api=module.__name__, name=name):
                    with self.assertRaisesRegex(AssertionError, 'private content opened'):
                        with self.private_content_guard() as opened:
                            handle = module.open(d / name, os.O_RDONLY if module is os else 'r')
                            if module is os:
                                os.close(handle)
                            else:
                                handle.close()
                    self.assertIn(str(d / name), opened)

    def test_legacy_nonmatching_invalid_tags_and_symlinks_ignored(self):
        d = self.evidence('legacy', events=False)
        (d / 'review.json').write_text(SECRET)
        target = self.evidence('valid')
        (self.root / 'qa-evidence-linked').symlink_to(target, target_is_directory=True)
        (self.root / 'qa-evidence-file').write_text(SECRET)
        for name in ('ordinary', 'qa-evidence-bad tag', 'qa-evidence-', 'qa-evidence-' + 'a' * 101):
            d = self.root / name
            d.mkdir()
            (d / 'events.jsonl').write_text(SECRET)
        self.assertEqual([r['tag'] for r in self.scan()['runs']], ['valid'])

    def test_bad_json_and_meta_are_null(self):
        for tag, result, meta in (
                ('oversized', ' ' * 65537, ' ' * 1025),
                ('invalid', '{', '{'),
                ('nondict', '[]', '[]'),
                ('injected', json.dumps({'verdict': SECRET, 'reviewed_sha': 'A' * 40}),
                 json.dumps({'role': '<script>', 'model': 'x' * 41}))):
            d = self.evidence(tag)
            (d / 'result.json').write_text(result)
            (d / 'meta.json').write_text(meta)
        for r in self.scan()['runs']:
            self.assertIsNone(r['verdict'])
            self.assertIsNone(r['reviewed_sha'])
            self.assertIsNone(r['role'])
            self.assertIsNone(r['model'])
        self.assertNotIn(SECRET, json.dumps(self.scan()))

    def test_invalid_exit_is_absent_and_no_events_uses_directory(self):
        for i, value in enumerate(('', 'bad', '-1', '0' * 17, SECRET)):
            self.evidence('invalid-' + str(i), exit_value=value, age=901)
        d = self.evidence('no-events', events=False, exit_value='', age=20)
        (d / 'prompt.md').write_text(SECRET)
        self.stamp(d / 'prompt.md', 150)
        self.stamp(d, 20)
        runs = {r['tag']: r for r in self.scan()['runs']}
        self.assertTrue(all(r['state'] == 'stale' and r['exit_code'] is None
                            for tag, r in runs.items() if tag.startswith('invalid-')))
        self.assertEqual(runs['no-events']['state'], 'running')
        self.assertIsNone(runs['no-events']['last_event_utc'])
        self.assertEqual(runs['no-events']['age_s'], 150)

    def test_symlink_and_nonregular_files_are_not_read(self):
        d = self.evidence('safe')
        target = self.root / 'private'
        target.write_text(json.dumps({'verdict': 'PASS', 'role': 'secret'}))
        for name in ('result.json', 'meta.json', 'exit.txt', 'stderr', 'prompt.md'):
            (d / name).symlink_to(target)
        (d / '.codex').symlink_to(self.root, target_is_directory=True)
        r = self.one()
        self.assertEqual(r['state'], 'running')
        self.assertIsNone(r['verdict'])
        self.assertIsNone(r['role'])
        for name in ('result.json', 'meta.json', 'exit.txt'):
            (d / name).unlink()
            os.mkfifo(d / name)
        r = self.one()
        self.assertIsNone(r['exit_code'])
        self.assertIsNone(r['verdict'])

    def test_foreign_owner_entries_and_files_ignored(self):
        self.evidence('foreign')
        d = self.evidence('owned', exit_value='1', result={'verdict': 'PASS'}, meta={'role': 'QA'})
        real_stat = os.lstat

        def foreign(path, *args, **kwargs):
            s = real_stat(path, *args, **kwargs)
            if os.fspath(path) in ('qa-evidence-foreign', 'exit.txt', 'result.json', 'meta.json'):
                fields = list(s)
                fields[4] = os.geteuid() + 1
                return os.stat_result(fields)
            return s

        with patch.object(writer.os, 'lstat', side_effect=foreign):
            r = self.one()
        self.assertEqual((r['tag'], r['state']), ('owned', 'running'))
        self.assertIsNone(r['role'])
        self.assertTrue(d.is_dir())

    def test_bounds_newest_finished_and_active_preserved(self):
        for i in range(25):
            self.evidence('finished-%02d' % i, exit_value='0', age=i)
        for i in range(10):
            self.evidence('active-%02d' % i, age=1000 + i)
        block = self.scan()
        self.assertEqual((block['running'], len(block['runs'])), (10, 20))
        self.assertEqual([r['tag'] for r in block['runs'][:10]], ['finished-%02d' % i for i in range(10)])
        self.assertEqual({r['tag'] for r in block['runs'][10:]}, {'active-%02d' % i for i in range(10)})
        self.assertLess(len(json.dumps(block, separators=(',', ':')).encode()), 8000)
        self.evidence('active-more', age=20)
        self.assertEqual((self.scan()['running'], len(self.scan()['runs'])), (11, 20))
        self.assertIn('active-more', [r['tag'] for r in self.scan()['runs']])

    def test_scan_limit_keeps_newest_400(self):
        for i in reversed(range(402)):
            self.evidence('%03d' % i, age=i)
        self.assertEqual(self.scan()['running'], 400)
        self.assertTrue(all(int(r['tag']) < 400 for r in self.scan()['runs']))
        self.assertTrue(self.scan()['truncated'])
        self.assertEqual(self.scan(), self.scan())

    def test_recent_running_survives_999_old_directories(self):
        for i in range(999):
            self.evidence('old-%03d' % i, exit_value='0', age=2000 + i)
        self.evidence('zz-current', age=10)
        with patch.object(writer.os, 'listdir', side_effect=AssertionError('unbounded listdir')):
            block = self.scan()
        self.assertTrue(block['available'])
        self.assertTrue(block['truncated'])
        self.assertEqual(block['running'], 1)
        self.assertEqual((block['runs'][0]['tag'], block['runs'][0]['state']), ('zz-current', 'running'))
        self.assertLess(len(json.dumps(block).encode()), 8000)

    def test_scandir_enumeration_stops_at_5000_including_nonmatches(self):
        d = self.evidence('current')
        real_scandir = os.scandir
        seen = []

        @contextmanager
        def bounded_entries(fd):
            with real_scandir(fd) as entries:
                current = next(entry for entry in entries if entry.name == d.name)

            def generate():
                for i in range(6000):
                    seen.append(i)
                    self.assertLess(i, 5000, 'enumeration cap exceeded')
                    yield current if i == 4999 else type('Entry', (), {'name': 'ordinary'})()
            yield generate()

        with patch.object(writer.os, 'scandir', side_effect=bounded_entries):
            block = self.scan()
        self.assertTrue(block['available'])
        self.assertTrue(block['truncated'])
        self.assertEqual(len(seen), 5000)
        self.assertEqual([r['tag'] for r in block['runs']], ['current'])

    def test_missing_unreadable_root_and_per_directory_error(self):
        unavailable = {'available': False, 'generated_utc': NOW.isoformat(),
                       'running': 0, 'runs': [], 'truncated': False}
        self.assertEqual(writer.external_runs(self.root / 'missing', NOW), unavailable)
        with patch.object(writer.os, 'scandir', side_effect=PermissionError):
            self.assertEqual(self.scan(), unavailable)
        (self.root / 'linked-root').symlink_to(self.root, target_is_directory=True)
        self.assertEqual(writer.external_runs(self.root / 'linked-root', NOW), unavailable)
        self.evidence('bad')
        self.evidence('good')
        real_open = os.open

        def broken(path, *args, **kwargs):
            if os.fspath(path) == 'qa-evidence-bad':
                raise PermissionError
            return real_open(path, *args, **kwargs)

        with patch.object(writer.os, 'open', side_effect=broken):
            self.assertEqual([r['tag'] for r in self.scan()['runs']], ['good'])

    def test_root_rejects_symlinked_ancestor_nondirectory_and_relative_path(self):
        self.evidence('visible')
        real = self.root / 'real'
        nested = real / 'nested'
        nested.mkdir(parents=True)
        link = self.root / 'linked-ancestor'
        link.symlink_to(real, target_is_directory=True)
        ordinary = self.root / 'ordinary-file'
        ordinary.write_text('')
        unavailable = {'available': False, 'generated_utc': NOW.isoformat(),
                       'running': 0, 'runs': [], 'truncated': False}
        for root in (link / 'nested', ordinary / 'nested', Path('.')):
            with self.subTest(root=root):
                self.assertEqual(writer.external_runs(root, NOW), unavailable)
        self.assertTrue(writer.external_runs(nested, NOW)['available'])

    def test_empty_root(self):
        self.assertEqual(self.scan(), {'available': True, 'generated_utc': NOW.isoformat(),
                                      'running': 0, 'runs': [], 'truncated': False})

    def test_main_adds_block_without_changing_build(self):
        self.evidence('main', exit_value='0', result={'verdict': 'PASS'})
        state = self.root / 'state'
        state.mkdir()
        out = self.root / 'out'
        out.mkdir()
        slots = self.root / 'slots'
        slots.mkdir()
        titles = self.root / 'titles.json'
        titles.write_text('{}')
        receipt = self.root / 'receipt.json'
        spec_fn = importlib.util.spec_from_file_location

        class Loader:
            def create_module(self, spec):
                return None

            def exec_module(self, module):
                module.extend = lambda snapshot, evidence: snapshot

        def local_spec(name, path, *args, **kwargs):
            if path == '/usr/local/lib/gb-actions-train/monitor.py':
                return importlib.util.spec_from_loader(name, Loader())
            return spec_fn(name, path, *args, **kwargs)

        read_json = writer.read_json

        def local_json(path, *args, **kwargs):
            if path == '/var/lib/gobadminton-deploy-evidence/actions-train.json':
                return {}
            return read_json(path, *args, **kwargs)

        baseline, _ = writer.build(state, receipt, {}, NOW, show_fn=lambda: {},
                                   checkpoint_owner=os.geteuid(), slot_outbox=slots)
        self.assertNotIn('external_runs', baseline)
        with patch.object(importlib.util, 'spec_from_file_location', side_effect=local_spec), \
                patch.object(writer, 'read_json', side_effect=local_json), \
                patch.object(writer, 'now_utc', return_value=NOW):
            writer.main(['--external-root', str(self.root), '--out-dir', str(out),
                         '--state-dir', str(state), '--receipt', str(receipt), '--no-systemd',
                         '--slot-outbox', str(slots), '--titles', str(titles)])
        snapshot = json.loads((out / 'snapshot.json').read_text())
        self.assertEqual(snapshot.pop('external_runs'), self.scan())
        self.assertEqual(snapshot, baseline)

    def test_ui_uses_text_only_and_existing_poll(self):
        app = (PAYLOAD / 'app.js').read_text()
        new_code = app.split('  function renderExternal(x) {', 1)[1].split('  function render(d) {', 1)[0]
        self.assertNotIn('innerHTML', new_code)
        self.assertIn('renderExternal(d.external_runs)', app)
        self.assertIn('Внешние запуски (вне слотов)', new_code)
        self.assertIn("s.id = 'external'", new_code)
        self.assertIn("if (x.truncated === true)", new_code)
        self.assertIn("'mut', 'Показаны не все запуски (ограничение сканирования).'", new_code)
        self.assertNotIn('fetch(', new_code)
        self.assertNotIn('setTimeout', new_code)

    @unittest.skipUnless(shutil.which('node'), 'node is unavailable')
    def test_javascript_syntax(self):
        result = subprocess.run([shutil.which('node'), '--check', str(PAYLOAD / 'app.js')],
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()

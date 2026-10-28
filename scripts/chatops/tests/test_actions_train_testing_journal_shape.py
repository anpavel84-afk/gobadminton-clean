"""Round 6: only an absent journal permits skipping reconciliation."""
import json
import os
import signal
import sys
import unittest
from unittest.mock import patch

import test_actions_train_testing_boundary as boundary
import test_actions_train_testing_reconciliation as reconciliation
import test_actions_train_testing_runner as fixture
import run_test_group as R


class JournalShapeTests(unittest.TestCase):
    setUp = fixture.RunnerTests.setUp
    git = fixture.RunnerTests.git
    make_catalog = fixture.RunnerTests.make_catalog
    run_group = fixture.RunnerTests.run_group
    args = boundary.BoundaryTests.args
    invoke = boundary.BoundaryTests.invoke
    collect = reconciliation.ReconciliationTests.collect
    live_journal = reconciliation.ReconciliationTests.live_journal

    @property
    def journal(self):
        return self.runs.parent / 'gb-test-runs.state'

    def assert_refused(self, data):
        before = self.journal.lstat()
        with patch.object(R.os, 'fchmod', wraps=os.fchmod) as fchmod, \
                patch.object(R.os, 'chmod', wraps=os.chmod) as chmod:
            for operation in (self.invoke, lambda: self.collect('a' * 64)):
                rc, output = operation()
                self.assertEqual(rc, 2, output)
                self.assertEqual(output.strip(), 'ENV_ERROR: EXECUTION_STATE_CORRUPT')
            with self.assertRaises(R.state.RecordCorrupt):
                R.worktree_digest(self.repo, self.runs)
            fchmod.assert_not_called()
            chmod.assert_not_called()
        self.assertFalse(self.counter.exists())
        self.assertEqual(list(self.runs.iterdir()), [])
        self.assertEqual(self.runs.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.journal.lstat().st_mode, before.st_mode)
        self.assertEqual(self.journal.lstat().st_ino, before.st_ino)
        if data is not None:
            self.assertEqual(self.journal.read_bytes(), data)
        self.assertEqual(list(self.journal.parent.glob('gb-test-runs.state.*.new')), [])

    def test_null_journal_with_live_child_refuses_even_when_boot_id_unavailable(self):
        self.live_journal()
        record = R.state.read_record(self.journal)
        self.journal.write_bytes(b'null\n')
        self.journal.chmod(0o400)
        self.assert_refused(b'null\n')
        with patch.object(R.state, 'boot_id', side_effect=R.BoundaryUnavailable) as boot:
            self.assert_refused(b'null\n')
            boot.assert_not_called()  # Corruption is refused before new-boundary fallback.
        self.assertTrue(R.state.group_alive(record))

    def test_existing_journal_shapes_are_closed_typed_and_bounded(self):
        good = dict(pgid=2**30, start=1, boot='synthetic', pending=False)
        malformed = [b'null\n', b'[]', b'"x"', b'1', b'{}', b'{"pending":true}',
                     b'{"pgid":', b'', b'\xff', b'[' * 1500 + b']' * 1500,
                     b' ' * (R.state.MAX_RECORD_BYTES + 1)]
        for key, values in [('pgid', [True, 0, -1, '1', 1.0, None]),
                            ('start', [True, 0, -1, '1', 1.0, None]),
                            ('boot', ['', 1, None, []]),
                            ('pending', [0, 1, 'true', None])]:
            malformed.extend(json.dumps({**good, key: value}).encode() for value in values)
        malformed.extend(json.dumps({k: v for k, v in good.items() if k != key}).encode()
                         for key in good)
        malformed.extend([json.dumps({**good, 'extra': True}).encode(),
                          b'{"pgid":1,"pgid":2,"start":1,"boot":"x","pending":false}',
                          json.dumps(dict(dev=1, ino=1, uid=1)).encode(),
                          json.dumps(good).encode() + b' ' * R.state.MAX_RECORD_BYTES])
        for data in malformed:
            with self.subTest(data=data[:100]):
                if self.journal.exists():
                    self.journal.chmod(0o600)
                self.journal.write_bytes(data)
                self.journal.chmod(0o400)
                self.assert_refused(data)

    def test_symlink_directory_and_fifo_journals_refuse_without_blocking(self):
        if not sys.platform.startswith('linux') or not hasattr(os, 'mkfifo'):
            self.skipTest('Linux no-follow/nonblocking file operations required')
        target = self.home / 'target'
        target.write_bytes(b'null\n')
        for kind in ('symlink', 'directory', 'fifo'):
            with self.subTest(kind=kind):
                if kind == 'symlink':
                    self.journal.symlink_to(target)
                elif kind == 'directory':
                    self.journal.mkdir()
                else:
                    os.mkfifo(self.journal, 0o600)
                try:
                    # Bound the real CLI too: opening a FIFO must never wait for a writer.
                    result = self.run_group(timeout=5)
                    self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                    self.assertIn('EXECUTION_STATE_CORRUPT', result.stdout)
                    self.assert_refused(None)
                    self.assertEqual(target.read_bytes(), b'null\n')
                finally:
                    self.journal.rmdir() if kind == 'directory' else self.journal.unlink()

    def test_valid_existing_journal_boot_failure_refuses_before_fallback(self):
        self.live_journal(pending=False)
        original = self.journal.read_bytes()
        with patch.object(R.state, 'boot_id', side_effect=R.BoundaryUnavailable), \
                patch.object(R.os, 'fchmod', wraps=os.fchmod) as chmod:
            for operation in (self.invoke, lambda: self.collect('a' * 64)):
                rc, output = operation()
                self.assertEqual(rc, 2, output)
                self.assertIn('EXECUTION_STATE_UNVERIFIABLE', output)
            chmod.assert_not_called()
        self.assertFalse(self.counter.exists())
        self.assertEqual(self.journal.read_bytes(), original)
        self.assertEqual(list(self.runs.iterdir()), [])

    def test_dead_group_recovers_and_missing_journal_still_runs(self):
        boundary.BoundaryTests.need_boundary(self)
        self.live_journal(pending=False)
        record = R.state.read_record(self.journal)
        os.killpg(record['pgid'], signal.SIGKILL)
        # Reap the exact synthetic child; registered cleanup remains idempotent.
        os.waitpid(record['pgid'], 0)
        self.assertFalse(R.state.group_alive(record))
        rc, output = self.invoke()
        self.assertEqual(rc, 0, output)
        self.assertFalse(self.journal.exists())
        rc, output = self.invoke('--repeat-reason', 'flake_probe')
        self.assertEqual(rc, 0, output)
        self.assertEqual(self.counter.read_text(), '2')
        self.assertFalse(self.journal.exists())
        self.assertIs(R.state.read_record(self.journal), R.state.MISSING)

    def test_writer_and_clear_never_replace_or_remove_corrupt_record(self):
        good = dict(pgid=2**30, start=1, boot='synthetic', pending=False)
        self.journal.write_bytes(b'null\n')
        self.journal.chmod(0o400)
        for operation in (lambda: R.state.write_record(self.journal, good),
                          lambda: R.state.clear_record(self.journal)):
            with self.assertRaises(R.state.RecordCorrupt):
                operation()
            self.assertEqual(self.journal.read_bytes(), b'null\n')
            self.assertEqual(self.journal.stat().st_mode & 0o777, 0o400)
            self.assertEqual(list(self.journal.parent.glob('gb-test-runs.state.*.new')), [])

    def test_corrupt_cleanup_preserves_pending_receipt_log_and_mode(self):
        boundary.BoundaryTests.need_boundary(self)
        if not sys.platform.startswith('linux'):
            self.skipTest('Linux /proc identities required')
        try:
            R.state.group_alive(R.state.identity(os.getpid()))
        except R.BoundaryUnavailable:
            self.skipTest('Linux /proc identity or group scan unavailable')
        inspect_group, write_result = R.state.group_alive, R.write_result
        calls, saved = 0, {}

        def pending(path, result, fd):
            write_result(path, result, fd)
            saved['receipt'], saved['bytes'] = path, path.read_bytes()

        def corrupt(record):
            nonlocal calls
            calls += 1
            if calls == 2:  # Cleanup loop; the command already completed.
                self.journal.write_bytes(b'null\n')
            return inspect_group(record)

        try:
            with patch.object(R.state, 'group_alive', side_effect=corrupt), \
                    patch.object(R, 'write_result', side_effect=pending), \
                    patch.object(R.os, 'fchmod', wraps=os.fchmod) as fchmod, \
                    patch.object(R.os, 'chmod', wraps=os.chmod) as chmod:
                rc, output = self.invoke()
                self.assertEqual(rc, 2, output)
                self.assertIn('EXECUTION_STATE_CORRUPT', output)
                self.assertEqual([call.args[1] for call in fchmod.call_args_list], [0, 0o700, 0])
                chmod.assert_not_called()
            self.assertEqual(self.counter.read_text(), '1')
            self.assertEqual(self.journal.read_bytes(), b'null\n')
            self.assertEqual(self.runs.stat().st_mode & 0o777, 0)
        finally:
            self.runs.chmod(0o700)
        self.assertEqual(saved['receipt'].read_bytes(), saved['bytes'])
        self.assertIn('done', saved['receipt'].with_suffix('.log').read_text())


if __name__ == '__main__':
    unittest.main()

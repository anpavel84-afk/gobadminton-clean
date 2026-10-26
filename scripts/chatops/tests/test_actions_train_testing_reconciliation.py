"""Round 5: unavailable identity must never bypass outstanding execution state."""
import contextlib
import io
import os
from pathlib import Path
import signal
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_actions_train_testing_boundary as boundary
import test_actions_train_testing_runner as fixture
import run_test_group as R


class ReconciliationTests(unittest.TestCase):
    setUp = fixture.RunnerTests.setUp
    git = fixture.RunnerTests.git
    make_catalog = fixture.RunnerTests.make_catalog
    args = boundary.BoundaryTests.args
    invoke = boundary.BoundaryTests.invoke

    def pending_receipt(self):
        groups, catalog = R.load_catalog(self.catalog)
        with R.runs_directory(self.repo, self.runs) as fd:
            fp, inputs = R.fingerprint(self.repo, self.runs, 'tiny', [], catalog, [], runs_fd=fd)
            path = self.runs / (fp + '.json')
            job = dict(argv=groups['tiny']['argv'], cwd=str(self.repo), repo=str(self.repo),
                       timeout_s=10, env_flags=[], kind='local', reason='initial')
            result = dict(schema=R.RECEIPT_SCHEMA, group='tiny', fingerprint=fp, inputs=inputs,
                          status='NOT_TESTED', pending=True, log_path=str(path.with_suffix('.log')),
                          history=[], _job=job)
            R.write_result(path, result, fd)
            self.assertEqual(R.read_result(Path(path.name), fd), result)
        path.with_suffix('.log').write_text('UNKNOWN: preserved test log\n')
        return path

    def live_journal(self, pending=True):
        if not sys.platform.startswith('linux'):
            self.skipTest('Linux /proc identities required')
        process = subprocess.Popen([sys.executable, '-B', '-c', 'import time; time.sleep(60)'],
            start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL)
        def cleanup():
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)
        self.addCleanup(cleanup)
        try:
            record = {**R.state.identity(process.pid), 'pending': pending}
            self.assertTrue(R.state.group_alive(record))
        except R.BoundaryUnavailable:
            self.skipTest('Linux /proc identity or group scan unavailable')
        journal = self.runs.parent / 'gb-test-runs.state'
        R.state.write_record(journal, record)
        return journal

    def collect(self, fingerprint):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            rc = R.main(['collect', '--repo', str(self.repo), '--fingerprint', fingerprint])
        self.assertLessEqual(len(output.getvalue().splitlines()), 30)
        return rc, output.getvalue()

    def test_live_pending_zero_mode_identity_unavailable_refuses_run_and_collect(self):
        boundary.BoundaryTests.need_boundary(self)
        receipt = self.pending_receipt()
        preserved = {p: p.read_bytes() for p in (receipt, receipt.with_suffix('.log'))}
        journal = self.live_journal()
        original = journal.read_bytes()
        self.runs.chmod(0)
        try:
            with patch.object(R.os, 'fchmod', wraps=os.fchmod) as fchmod, \
                    patch.object(R.os, 'chmod', wraps=os.chmod) as chmod:
                rc, output = self.invoke()
                self.assertEqual(rc, 3, output)
                self.assertIn('PREVIOUS_EXECUTION_ALIVE', output)
                with patch.object(R.state, 'group_alive', side_effect=R.BoundaryUnavailable):
                    for operation in (self.invoke, lambda: self.collect(receipt.stem)):
                        rc, output = operation()
                        self.assertEqual(rc, 2, output)
                        self.assertIn('ENV_ERROR: EXECUTION_STATE_UNVERIFIABLE', output)
                        self.assertFalse(self.counter.exists())
                        self.assertEqual(self.runs.stat().st_mode & 0o777, 0)
                        self.assertEqual(journal.read_bytes(), original)
                fchmod.assert_not_called()
                chmod.assert_not_called()
        finally:
            self.runs.chmod(0o700)
        for path, data in preserved.items():
            self.assertEqual(path.read_bytes(), data)

    def test_journal_without_receipt_identity_unavailable_refuses(self):
        journal = self.live_journal(pending=False)
        original = journal.read_bytes()
        with patch.object(R.state, 'group_alive', side_effect=R.BoundaryUnavailable), \
                patch.object(R.os, 'fchmod', wraps=os.fchmod) as chmod:
            rc, output = self.invoke()
        self.assertEqual(rc, 2, output)
        self.assertIn('EXECUTION_STATE_UNVERIFIABLE', output)
        self.assertFalse(self.counter.exists())
        self.assertEqual(journal.read_bytes(), original)
        self.assertEqual(list(self.runs.iterdir()), [])
        self.assertEqual(self.runs.stat().st_mode & 0o777, 0o700)
        chmod.assert_not_called()
        with patch.object(R.state, 'group_alive', side_effect=R.BoundaryUnavailable):
            with self.assertRaises(R.ExecutionStateUnverifiable):
                R.worktree_digest(self.repo, self.runs)
        self.assertEqual(journal.read_bytes(), original)

    def test_pending_without_journal_refuses_before_unavailable_boundary(self):
        receipt = self.pending_receipt()
        original = receipt.read_bytes()
        with patch.object(R.state, 'identity', side_effect=R.BoundaryUnavailable) as identity, \
                patch.object(R.os, 'fchmod', wraps=os.fchmod) as chmod:
            for operation in (self.invoke, lambda: self.collect(receipt.stem)):
                rc, output = operation()
                self.assertEqual(rc, 3, output)
                self.assertIn('INCOMPLETE_RUN_REQUIRES_RECONCILIATION', output)
        identity.assert_not_called()
        chmod.assert_not_called()
        self.assertFalse(self.counter.exists())
        self.assertEqual(receipt.read_bytes(), original)
        self.assertFalse((self.runs.parent / 'gb-test-runs.state').exists())

    def test_no_journal_or_pending_unavailable_identity_executes_once_per_invocation(self):
        with patch.object(R.state, 'identity', side_effect=R.BoundaryUnavailable):
            for count in (1, 2):
                rc, output = self.invoke()
                self.assertEqual(rc, 0, output)
                self.assertIn('CACHE_BOUNDARY_UNAVAILABLE (no receipt)', output)
                self.assertEqual(self.counter.read_text(), str(count))
                self.assertEqual(list(self.runs.iterdir()), [])
                self.assertFalse((self.runs.parent / 'gb-test-runs.state').exists())

    def test_identity_lost_after_execution_preserves_unknown_without_retry_or_restore(self):
        boundary.BoundaryTests.need_boundary(self)
        # Establish Linux identity support before injecting the later scan failure.
        try:
            R.state.group_alive(R.state.identity(os.getpid()))
        except R.BoundaryUnavailable:
            self.skipTest('Linux /proc identity or group scan unavailable')
        journal = self.runs.parent / 'gb-test-runs.state'
        try:
            with patch.object(R.state, 'group_alive', side_effect=R.BoundaryUnavailable):
                rc, output = self.invoke()
            self.assertEqual(rc, 2, output)
            self.assertIn('EXECUTION_STATE_UNVERIFIABLE', output)
            self.assertEqual(self.counter.read_text(), '1')
            self.assertEqual(self.runs.stat().st_mode & 0o777, 0)
            self.assertTrue(R.state.read_record(journal)['pending'])
        finally:
            self.runs.chmod(0o700)
        receipt = next(self.runs.glob('*.json'))
        with R.directory(self.runs) as fd:
            self.assertTrue(R.read_result(Path(receipt.name), fd)['pending'])


if __name__ == '__main__':
    unittest.main()

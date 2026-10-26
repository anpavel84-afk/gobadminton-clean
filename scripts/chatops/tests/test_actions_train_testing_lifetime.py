"""Round 4: owned inode recognition and executed-process lifetime, synthetic only."""
import ctypes
import json
import os
import signal
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_actions_train_testing_boundary as boundary
import test_actions_train_testing_runner as fixture
import run_test_group as R


class Round4Tests(unittest.TestCase):
    setUp = fixture.RunnerTests.setUp
    git = fixture.RunnerTests.git
    make_catalog = fixture.RunnerTests.make_catalog
    run_group = fixture.RunnerTests.run_group
    args = boundary.BoundaryTests.args
    invoke = boundary.BoundaryTests.invoke
    wait_for = boundary.BoundaryTests.wait_for

    def need_boundary(self):
        boundary.BoundaryTests.need_boundary(self)
        try:
            R.state.group_alive(R.state.identity(os.getpid()))
        except R.BoundaryUnavailable:
            self.skipTest('Linux /proc identity or group scan unavailable')

    def test_unrelated_directories_unchanged_without_sibling_files(self):
        for path, code in [(self.home / 'unrelated', 'RUNS_DIR_NOT_IN_GIT_DIR'),
                           (self.runs.parent / 'unrelated', 'RUNS_DIR_UNRECOGNISED')]:
            path.mkdir(mode=0o755)
            (path / 'KEEP.txt').write_text('KEEP')
            siblings = set(path.parent.iterdir())
            result = self.run_group('--runs-dir', str(path))
            self.assertEqual(result.returncode, 3, result.stdout)
            self.assertIn(code, result.stdout)
            self.assertEqual(path.stat().st_mode & 0o777, 0o755)
            self.assertEqual((path / 'KEEP.txt').read_text(), 'KEEP')
            self.assertEqual(set(path.parent.iterdir()), siblings)
        self.assertFalse(self.counter.exists())

    def test_marker_mismatch_and_missing_marker_refuse_before_lock_or_chmod(self):
        marker = R.marker_path(self.runs)
        for value in [dict(dev=0, ino=0, uid=os.getuid()), None]:
            if value is None:
                marker.unlink()
            else:
                R.state.write_record(marker, value, marker=True)
            self.runs.chmod(0o755)
            (self.runs.parent / 'gb-test-runs.lock').unlink(missing_ok=True)
            before = set(self.runs.parent.iterdir())
            with patch.object(R.os, 'fchmod', wraps=os.fchmod) as chmod:
                rc, output = self.invoke()
            self.assertEqual(rc, 3, output)
            self.assertIn('RUNS_DIR_UNRECOGNISED', output)
            chmod.assert_not_called()
            self.assertEqual(self.runs.stat().st_mode & 0o777, 0o755)
            self.assertEqual(set(self.runs.parent.iterdir()), before)

    def test_replacement_between_validation_and_fchmod_is_untouched(self):
        self.need_boundary()
        moved = self.runs.parent / 'original'
        original = os.fchmod
        swapped = False
        def swap(fd, mode):
            nonlocal swapped
            if not swapped and mode == 0:
                self.runs.rename(moved)
                self.runs.mkdir(mode=0o755)
                (self.runs / 'KEEP.txt').write_text('KEEP')
                swapped = True
            return original(fd, mode)
        with patch.object(R.os, 'fchmod', side_effect=swap), \
                patch.object(R.os, 'chmod', side_effect=AssertionError('pathname chmod')):
            rc, output = self.invoke()
        self.assertEqual(rc, 0, output)
        self.assertIn('CACHE_BOUNDARY_UNAVAILABLE', output)
        self.assertTrue(swapped)
        self.assertEqual(self.runs.stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.runs / 'KEEP.txt').read_text(), 'KEEP')
        self.assertEqual(moved.stat().st_mode & 0o777, 0o700)

    def test_later_validation_refusal_preserves_original_mode(self):
        self.runs.chmod(0o755)
        (self.runs / 'KEEP.txt').write_text('KEEP')
        with patch.object(R.os, 'fchmod', wraps=os.fchmod) as chmod:
            rc, output = self.invoke()
        self.assertEqual(rc, 3, output)
        self.assertIn('RUNS_DIR_CONTAINS_SOURCE', output)
        chmod.assert_not_called()
        self.assertEqual(self.runs.stat().st_mode & 0o777, 0o755)

    def test_marker_rechecked_on_open_fd_immediately_before_fchmod(self):
        self.need_boundary()
        with R.runs_directory(self.repo, self.runs) as fd:
            record = R.directory_identity(fd)
            R.state.write_record(R.marker_path(self.runs), {**record, 'ino': record['ino'] + 1}, marker=True)
            with patch.object(R.os, 'fchmod', wraps=os.fchmod) as chmod:
                with self.assertRaisesRegex(ValueError, 'RUNS_DIR_UNRECOGNISED'):
                    with R.cache_boundary(self.runs, fd):
                        self.fail('marker mismatch admitted')
            chmod.assert_not_called()
        self.assertEqual(self.runs.stat().st_mode & 0o777, 0o700)

    def test_later_boundary_refusal_restores_original_mode_on_same_fd(self):
        self.need_boundary()
        self.runs.chmod(0o755)
        with R.runs_directory(self.repo, self.runs) as fd:
            with self.assertRaisesRegex(ValueError, 'synthetic validation refusal'):
                with R.cache_boundary(self.runs, fd):
                    raise ValueError('synthetic validation refusal')
        self.assertEqual(self.runs.stat().st_mode & 0o777, 0o755)

    def test_new_git_child_records_inode_and_normal_runs_stay_private(self):
        self.need_boundary()
        runs = self.runs.parent / 'qa-runs'
        result = self.run_group('--runs-dir', str(runs))
        self.assertEqual(result.returncode, 0, result.stdout)
        with R.directory(runs) as fd:
            self.assertEqual(R.state.read_record(R.marker_path(runs), marker=True), R.directory_identity(fd))
        self.assertEqual(runs.stat().st_mode & 0o777, 0o700)
        self.assertFalse(runs.with_name('qa-runs.lock').exists())

    def test_global_pending_receipt_blocks_different_fingerprint(self):
        self.need_boundary()
        self.assertEqual(self.run_group().returncode, 0)
        receipt = next(self.runs.glob('*.json'))
        record = json.loads(receipt.read_text())
        record['pending'] = True
        record['status'] = 'NOT_TESTED'
        record['_job'] = dict(argv=[sys.executable, '-B', '-c', 'pass'], cwd=str(self.repo),
            repo=str(self.repo), timeout_s=10, env_flags=[], kind='local', reason='initial')
        receipt.write_text(json.dumps(record))
        self.make_catalog('print("different fingerprint")')
        rc, output = self.invoke()
        self.assertEqual(rc, 3, output)
        self.assertIn('INCOMPLETE_RUN_REQUIRES_RECONCILIATION', output)
        self.assertEqual(self.counter.read_text(), '1')
        self.assertEqual(json.loads(receipt.read_text()), record)

    def test_identity_unavailable_executes_each_time_without_receipt(self):
        with patch.object(R.state, 'boot_id', side_effect=R.BoundaryUnavailable):
            for _ in range(2):
                rc, output = self.invoke()
                self.assertEqual(rc, 0, output)
                self.assertIn('CACHE_BOUNDARY_UNAVAILABLE', output)
                self.assertEqual(list(self.runs.glob('*.json')), [])
        self.assertEqual(self.counter.read_text(), '2')

    def test_identity_lost_after_spawn_never_executes_gated_command_twice(self):
        self.need_boundary()
        identity = R.state.identity
        calls = 0
        def unavailable(pid):
            nonlocal calls
            calls += 1
            if calls > 1:
                raise R.BoundaryUnavailable()
            return identity(pid)
        with patch.object(R.state, 'identity', side_effect=unavailable):
            rc, output = self.invoke()
        self.assertEqual(rc, 0, output)
        self.assertIn('CACHE_BOUNDARY_UNAVAILABLE', output)
        self.assertEqual(self.counter.read_text(), '1')
        self.assertEqual(list(self.runs.glob('*.json')), [])
        self.assertFalse((self.runs.parent / 'gb-test-runs.state').exists())

    def test_journal_write_is_atomic_and_fsyncs_file_and_parent(self):
        journal = self.runs.parent / 'gb-test-runs.state'
        record = dict(pgid=2**30, start=1, boot=R.state.boot_id(), pending=False)
        with patch.object(R.state.os, 'fsync', wraps=os.fsync) as synced, \
                patch.object(R.state.os, 'replace', wraps=os.replace) as renamed:
            R.state.write_record(journal, record)
        self.assertEqual(synced.call_count, 2)
        self.assertEqual(renamed.call_count, 1)
        self.assertEqual(R.state.read_record(journal), record)
        self.assertEqual(list(journal.parent.glob(journal.name + '*.new')), [])

    def test_prctl_failure_is_best_effort(self):
        self.need_boundary()
        with patch.object(R.state.ctypes, 'CDLL', side_effect=OSError('synthetic prctl failure')):
            rc, output = self.invoke()
        self.assertEqual(rc, 0, output)
        self.assertIn('status: PASS', output)

    def test_dead_or_reused_identity_clears_stale_nonpending_state(self):
        self.need_boundary()
        journal = self.runs.parent / 'gb-test-runs.state'
        for record in [dict(pgid=2**30, start=1, boot=R.state.boot_id(), pending=False),
                       {**R.state.identity(os.getpid()), 'start': 1, 'pending': False}]:
            R.state.write_record(journal, record)
            rc, output = self.invoke('--repeat-reason', 'flake_probe')
            self.assertEqual(rc, 0, output)
            self.assertFalse(journal.exists())

    def test_child_is_journalled_before_command_starts(self):
        self.need_boundary()
        journal = self.runs.parent / 'gb-test-runs.state'
        self.make_catalog('import json,os; from pathlib import Path; s=json.loads(Path(' +
            repr(str(journal)) + ').read_text()); assert s["pgid"]==os.getpgrp(); '
            'assert s["pending"] is True')
        rc, output = self.invoke()
        self.assertEqual(rc, 0, output)
        self.assertFalse(journal.exists())

    def test_live_state_refuses_before_any_chmod(self):
        self.need_boundary()
        journal = self.runs.parent / 'gb-test-runs.state'
        R.state.write_record(journal, {**R.state.identity(os.getpid()), 'pending': True})
        with patch.object(R.state, 'group_alive', return_value=True), \
                patch.object(R.os, 'fchmod', wraps=os.fchmod) as chmod:
            rc, output = self.invoke()
        self.assertEqual(rc, 3, output)
        self.assertIn('PREVIOUS_EXECUTION_ALIVE', output)
        chmod.assert_not_called()
        self.assertFalse(self.counter.exists())

    def test_group_scan_includes_members_after_leader_disappears(self):
        def proc(pid):
            if pid == 123:
                raise FileNotFoundError()
            return dict(pgid=123, start=201, status='S')
        with patch.object(R.state, 'boot_id', return_value='synthetic'), \
                patch.object(R.state, 'proc_stat', side_effect=proc), \
                patch.object(R.state.Path, 'iterdir', return_value=[R.state.Path('/proc/456')]):
            self.assertTrue(R.state.group_alive(dict(pgid=123, start=200, boot='synthetic')))

    def test_sigkill_runner_retains_boundary_for_live_group_and_collect(self):
        self.need_boundary()
        # Subreaping lets this test reap its orphan too, without leaving zombies.
        libc = ctypes.CDLL(None, use_errno=True)
        old = ctypes.c_int()
        if libc.prctl(37, ctypes.byref(old), 0, 0, 0) or libc.prctl(36, 1, 0, 0, 0):
            self.skipTest('Linux child subreaper unavailable')
        process, child = None, None
        ready, release = self.runs.parent / 'ready', self.runs.parent / 'release'
        denied = self.runs.parent / 'denied'
        try:
            self.make_catalog('import os,time; from pathlib import Path; '
                'Path(' + repr(str(ready)) + ').write_text(str(os.getpid()))\n'
                'while not Path(' + repr(str(release)) + ').exists():\n'
                ' try: list(Path(' + repr(str(self.runs)) + ').iterdir())\n'
                ' except PermissionError: Path(' + repr(str(denied)) + ').write_text("denied")\n'
                ' time.sleep(.01)\n')
            bootstrap = ('import sys; sys.path.insert(0,' + repr(str(fixture.TOOLS)) + '); '
                'import run_test_group as R; R.state.parent_death_signal=lambda parent:None; '
                'raise SystemExit(R.main(sys.argv[1:]))')
            process = subprocess.Popen([sys.executable, '-B', '-c', bootstrap, *self.args()],
                env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.wait_for(ready.exists, process)
            child = int(ready.read_text())
            self.wait_for(denied.exists, process)
            journal = self.runs.parent / 'gb-test-runs.state'
            record = R.state.read_record(journal)
            self.assertEqual(record['pgid'], child)
            process.kill()
            process.communicate(timeout=5)
            self.assertTrue(R.state.group_alive(record))
            self.make_catalog('print("second fingerprint")')
            result = self.run_group()
            self.assertEqual(result.returncode, 3, result.stdout)
            self.assertIn('PREVIOUS_EXECUTION_ALIVE', result.stdout)
            collected = subprocess.run([sys.executable, '-B', str(fixture.TOOLS / 'run_test_group.py'),
                'collect', '--repo', str(self.repo), '--fingerprint', 'a'*64],
                env=self.env, capture_output=True, text=True, timeout=5)
            self.assertEqual(collected.returncode, 3, collected.stdout)
            self.assertIn('PREVIOUS_EXECUTION_ALIVE', collected.stdout)
            self.assertEqual(self.runs.stat().st_mode & 0o777, 0)
            denied.unlink()
            self.wait_for(denied.exists)
            release.touch()
            os.waitpid(child, 0)
            child = None
            self.assertFalse(R.state.group_alive(record))
            # A dead child does not silently reconcile the unknown test outcome.
            result = self.run_group()
            self.assertIn('INCOMPLETE_RUN_REQUIRES_RECONCILIATION', result.stdout)
            self.assertEqual(self.runs.stat().st_mode & 0o777, 0)
        finally:
            if process is not None and process.poll() is None:
                process.kill()
                process.communicate(timeout=5)
            if child is not None:
                try:
                    os.killpg(child, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                os.waitpid(child, 0)
            self.runs.chmod(0o700)
            libc.prctl(36, old.value, 0, 0, 0)


if __name__ == '__main__':
    unittest.main()

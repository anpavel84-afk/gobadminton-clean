"""Round 3: receipts cannot be an ordinary hidden input of a cached command."""
import contextlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

import test_actions_train_testing_runner as fixture
import run_test_group as R


class BoundaryTests(unittest.TestCase):
    setUp = fixture.RunnerTests.setUp
    git = fixture.RunnerTests.git
    make_catalog = fixture.RunnerTests.make_catalog
    run_group = fixture.RunnerTests.run_group
    result = fixture.RunnerTests.result

    def args(self, *extra):
        return ['run', '--repo', str(self.repo), '--catalog', str(self.catalog),
                '--group', 'tiny', *extra]

    def invoke(self, *extra):
        output = io.StringIO()
        with patch.dict(os.environ, self.env, clear=True), contextlib.redirect_stdout(output):
            rc = R.main(self.args(*extra))
        self.assertLessEqual(len(output.getvalue().splitlines()), 30)
        return rc, output.getvalue()

    def need_boundary(self):
        if os.geteuid() == 0:
            self.skipTest('root cannot deny access using directory mode bits')

    def wait_for(self, predicate, process=None):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if predicate():
                return
            if process is not None and process.poll() is not None:
                self.fail('runner exited before child readiness')
            time.sleep(0.01)
        self.fail('child readiness deadline exceeded')

    def test_default_location_and_linked_worktree_use_absolute_per_worktree_git_dir(self):
        args = type('Args', (), dict(repo=str(self.repo), runs_dir=None))()
        self.assertEqual(R.locations(args)[1], R.git_dir(self.repo) / 'gb-test-runs')
        self.git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid',
                 'commit', '-qm', 'fixture')
        linked = self.home / 'linked'
        self.git('worktree', 'add', '--detach', str(linked), 'HEAD')
        args.repo = str(linked)
        linked_git = R.git_dir(linked)
        self.assertNotEqual(linked_git, R.git_dir(self.repo))
        self.assertEqual(R.locations(args)[1], linked_git / 'gb-test-runs')
        result = self.run_group('--repo', str(linked))
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual((linked_git / 'gb-test-runs').stat().st_mode & 0o777, 0o700)

    def test_old_default_and_all_explicit_worktree_locations_are_refused(self):
        for path in (self.repo / '.gb-test-runs', self.repo / 'artifacts', self.repo):
            with self.subTest(path=path):
                result = self.run_group('--runs-dir', str(path))
                self.assertEqual(result.returncode, 3, result.stdout)
                self.assertIn('RUNS_DIR_IN_WORKTREE', result.stdout)
        self.assertFalse(self.counter.exists())

    def test_default_catalog_targeted_module_cannot_hide_receipt_input(self):
        self.need_boundary()
        self.assertEqual(self.run_group().returncode, 0)
        receipt = next(self.runs.glob('*.json'))
        tests = self.repo / 'scripts/chatops/tests'
        tests.mkdir(parents=True)
        (tests / 'test_receipt_input.py').write_text(
            'import json,unittest\nfrom pathlib import Path\n'
            'class Probe(unittest.TestCase):\n def test_input(self):\n'
            '  p=Path(__file__).parents[3]/".git"/"gb-test-runs"/' + repr(receipt.name) + '\n'
            '  self.assertEqual(json.loads(p.read_text())["detail"], "")\n')
        argv = [sys.executable, '-B', str(fixture.TOOLS / 'run_test_group.py'), 'run',
                '--repo', str(self.repo), '--group', 'targeted_py', '--tests', 'test_receipt_input']
        def direct():
            return subprocess.run([sys.executable, '-B', '-m', 'unittest', 'test_receipt_input'],
                cwd=tests, env=self.env, capture_output=True)
        self.assertEqual(direct().returncode, 0)
        first = subprocess.run(argv, env=self.env, text=True, capture_output=True, timeout=10)
        self.assertEqual(first.returncode, 2, first.stdout)
        self.assertIn('PermissionError', next(p for p in self.runs.glob('*.log')
                      if 'PermissionError' in p.read_text()).read_text())
        record = json.loads(receipt.read_text())
        record['detail'] = 'changed receipt only'
        receipt.write_text(json.dumps(record))
        self.assertEqual(direct().returncode, 1)
        second = subprocess.run(argv, env=self.env, text=True, capture_output=True, timeout=10)
        self.assertEqual(second.returncode, 2, second.stdout)
        self.assertNotIn('previous=PASS', second.stdout)
        self.assertNotIn('status: PASS', second.stdout)
        self.assertLessEqual(len(second.stdout.splitlines()), 30)

    def test_mode_restored_after_success_failure_timeout_and_spawn_error(self):
        self.need_boundary()
        for code, timeout, expected in [('pass', 10, 0), ('raise SystemExit(1)', 10, 1),
                ('import time; time.sleep(20)', 1, 4)]:
            with self.subTest(code=code):
                self.make_catalog(code, timeout=timeout)
                rc, output = self.invoke()
                self.assertEqual(rc, expected, output)
                self.assertEqual(self.runs.stat().st_mode & 0o777, 0o700)
        self.make_catalog()
        original = R.subprocess.Popen
        def spawn(argv, **kwargs):
            if argv[0] == sys.executable:
                self.assertEqual(self.runs.stat().st_mode & 0o777, 0)
                raise OSError('synthetic spawn error')
            return original(argv, **kwargs)
        with patch.object(R.subprocess, 'Popen', side_effect=spawn):
            self.assertEqual(self.invoke()[0], 2)
        self.assertEqual(self.runs.stat().st_mode & 0o777, 0o700)

    def test_mode_restored_after_unexpected_exception(self):
        self.need_boundary()
        original = R.subprocess.Popen
        def spawn(argv, **kwargs):
            if argv[0] == sys.executable:
                self.assertEqual(self.runs.stat().st_mode & 0o777, 0)
                raise RuntimeError('synthetic exception')
            return original(argv, **kwargs)
        with patch.object(R.subprocess, 'Popen', side_effect=spawn):
            with self.assertRaisesRegex(RuntimeError, 'synthetic exception'):
                self.invoke()
        self.assertEqual(self.runs.stat().st_mode & 0o777, 0o700)

    def test_stale_zero_mode_directory_is_conservatively_refused(self):
        self.need_boundary()
        try:
            self.runs.chmod(0)
            result = self.run_group()
            self.assertEqual(result.returncode, 3, result.stdout)
            self.assertIn('RUNS_DIR_UNAVAILABLE', result.stdout)
            self.assertEqual(self.runs.stat().st_mode & 0o777, 0)
        finally:
            self.runs.chmod(0o700)

    def test_chmod_unavailable_executes_each_time_without_receipt(self):
        with patch.object(R.os, 'fchmod', side_effect=PermissionError('synthetic chmod denial')):
            for _ in range(2):
                rc, output = self.invoke('--detach')
                self.assertEqual(rc, 0, output)
                self.assertIn('CACHE_BOUNDARY_UNAVAILABLE', output)
                self.assertIn('status: PASS', output)
                self.assertEqual(list(self.runs.iterdir()), [])
        self.assertEqual(self.counter.read_text(), '2')

    def test_restore_unavailable_disables_cache_and_next_start_refuses(self):
        self.need_boundary()
        chmod = R.os.fchmod
        def no_restore(fd, mode):
            if mode == 0o700:
                raise PermissionError('synthetic restore denial')
            return chmod(fd, mode)
        try:
            with patch.object(R.os, 'fchmod', side_effect=no_restore):
                rc, output = self.invoke()
            self.assertEqual(rc, 0, output)
            self.assertIn('CACHE_BOUNDARY_UNAVAILABLE', output)
            self.assertEqual(self.counter.read_text(), '1')
            self.assertEqual(self.runs.stat().st_mode & 0o777, 0)
            second = self.run_group()
            self.assertEqual(second.returncode, 3, second.stdout)
            self.assertIn("RUNS_DIR_UNAVAILABLE", second.stdout)
            self.assertEqual(self.counter.read_text(), "1")
            self.assertEqual(self.runs.stat().st_mode & 0o777, 0)
        finally:
            self.runs.chmod(0o700)

    def test_boundary_lost_after_preflight_still_executes_once_without_receipt(self):
        self.need_boundary()
        chmod = R.os.fchmod
        calls = 0
        def fail_second_boundary(fd, mode):
            nonlocal calls
            if mode == 0:
                calls += 1
                if calls == 2:
                    raise PermissionError('synthetic late boundary failure')
            return chmod(fd, mode)
        with patch.object(R.os, 'fchmod', side_effect=fail_second_boundary):
            rc, output = self.invoke()
        self.assertEqual(rc, 0, output)
        self.assertIn('CACHE_BOUNDARY_UNAVAILABLE', output)
        self.assertEqual(self.counter.read_text(), '1')
        self.assertEqual(list(self.runs.glob('*.json')), [])
        self.assertEqual(self.runs.stat().st_mode & 0o777, 0o700)

    def test_foreign_ownership_does_not_change_directory(self):
        with patch.object(R.os, 'getuid', return_value=os.getuid() + 1), \
                patch.object(R.os, 'fchmod', wraps=os.fchmod) as chmod:
            with self.assertRaises(R.BoundaryUnavailable):
                R.check_existing(self.runs)
        chmod.assert_not_called()
        self.assertEqual(list(self.runs.iterdir()), [])

    def test_root_or_filesystem_ignoring_mode_bits_disables_cache(self):
        with patch.object(R.os, 'geteuid', return_value=0):
            for _ in range(2):
                rc, output = self.invoke()
                self.assertEqual(rc, 0, output)
                self.assertIn('CACHE_BOUNDARY_UNAVAILABLE', output)
        self.assertEqual(self.counter.read_text(), '2')
        self.assertEqual(list(self.runs.iterdir()), [])
        self.need_boundary()
        with patch.object(R.os, 'fchmod', return_value=None):
            rc, output = self.invoke()
        self.assertEqual(rc, 0, output)
        self.assertIn('CACHE_BOUNDARY_UNAVAILABLE', output)
        self.assertEqual(list(self.runs.iterdir()), [])

    def test_existing_cached_pass_is_ignored_when_boundary_unavailable(self):
        self.need_boundary()
        self.assertEqual(self.run_group().returncode, 0)
        path = next(self.runs.glob('*.json'))
        original = path.read_bytes()
        with patch.object(R.os, 'geteuid', return_value=0):
            rc, output = self.invoke()
        self.assertEqual(rc, 0, output)
        self.assertIn('CACHE_BOUNDARY_UNAVAILABLE', output)
        self.assertEqual(self.counter.read_text(), '2')
        self.assertEqual(path.read_bytes(), original)

    def test_env_paths_to_runs_are_scrubbed_even_when_catalog_allowed(self):
        flags = ['GB_RUNS', 'GB_RUNS_ALIAS', 'GB_RUNS_CHILD', 'GB_OK']
        self.make_catalog("import os; assert not any(k in os.environ for k in "
            "['GB_RUNS','GB_RUNS_ALIAS','GB_RUNS_CHILD']); assert os.environ['GB_OK']=='yes'", flags=flags)
        alias = self.home / 'alias'
        alias.symlink_to(self.runs, target_is_directory=True)
        result = self.run_group(env={**self.env, 'GB_RUNS': str(self.runs),
            'GB_RUNS_ALIAS': str(alias), 'GB_RUNS_CHILD': str(self.runs / 'file.json'), 'GB_OK': 'yes'})
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_signal_restores_mode_and_kills_child_before_writing_receipt(self):
        self.need_boundary()
        for sig in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(sig=sig):
                self.counter.unlink(missing_ok=True)
                self.make_catalog('import time; from pathlib import Path; Path(' + repr(str(self.counter)) +
                    ').write_text("ready"); time.sleep(30)')
                process = subprocess.Popen([sys.executable, '-B', str(fixture.TOOLS / 'run_test_group.py'),
                    *self.args()], env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    self.wait_for(self.counter.exists, process)
                    self.assertEqual(self.runs.stat().st_mode & 0o777, 0)
                    process.send_signal(sig)
                    stdout, stderr = process.communicate(timeout=5)
                    self.assertEqual(process.returncode, 2, stdout + stderr)
                    self.assertIn('INTERRUPTED', stdout)
                    self.assertEqual(self.runs.stat().st_mode & 0o777, 0o700)
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.communicate()

    def test_concurrent_different_fingerprints_wait_without_self_healing_live_boundary(self):
        self.need_boundary()
        self.make_catalog('import time; from pathlib import Path; Path(' + repr(str(self.counter)) +
                          ').write_text("ready"); time.sleep(0.8)')
        first = self.run_group('--detach')
        self.assertEqual(first.returncode, 0, first.stdout)
        self.wait_for(self.counter.exists)
        self.assertEqual(self.runs.stat().st_mode & 0o777, 0)
        self.assertTrue((self.runs.parent / (self.runs.name + '.lock')).is_file())
        self.make_catalog('print("second")')
        started = time.monotonic()
        second = self.run_group()
        self.assertGreater(time.monotonic() - started, 0.4)
        self.assertEqual(second.returncode, 0, second.stdout)
        self.assertEqual(self.runs.stat().st_mode & 0o777, 0o700)
        self.assertEqual(len(list(self.runs.glob('*.json'))), 2)


if __name__ == '__main__':
    unittest.main()

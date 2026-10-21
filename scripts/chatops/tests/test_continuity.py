"""OPS #155: local Git histories and durable checkpoints, no network, services or models."""
import contextlib
import copy
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from test_slots import a, s, host, slot_mode, issue, task, SINCE
API = a.api

POLICY = dict(schema=s.CONTINUITY_SCHEMA, enabled=True, max_attempts=3, max_integrations=3,
              read_backoff_seconds=240, sha256='f' * 64)


class Crash(BaseException):
    pass


class LocalTrain:
    """Two disposable slot clones with a LOCAL bare origin. Only model/API edges are simulated."""
    def __init__(self, tmp, rt, conflict=False):
        self.tmp, self.rt = Path(tmp), rt
        self.repo, self.origin = rt.layout.repo, Path(tmp) / 'origin.git'
        self.repo.mkdir(parents=True)
        self.git('init', '-q', '--bare', str(self.origin))
        self.git('init', '-q', '-b', 'dev')
        self.git('remote', 'add', 'origin', str(self.origin))
        self.web = 'apps/web/src/games/map.ts'
        self.api_path = 'apps/api/src/profile.ts'
        for name in (self.web, self.api_path):
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('base\n')
        self.git('add', '.'); self.git('commit', '-qm', 'common base')
        self.base = self.git('rev-parse', 'HEAD')
        self.git('push', '-q', 'origin', 'dev')
        # B cloned at exactly the same base as A, then independently advances DEV.
        self.second = rt.layout.slot_root / 'slot2/repo'
        self.git('clone', '-q', '-b', 'dev', str(self.origin), str(self.second))
        self.work = rt.layout.worktrees / 'issue-40'
        self.work.parent.mkdir(parents=True, exist_ok=True)
        self.git('worktree', 'add', '-qb', 'automation/issue-40', str(self.work), self.base)
        (self.work / self.web).write_text('candidate with lint defect\n')
        self.git('commit', '-qam', 'A candidate', cwd=self.work)
        self.head = self.git('rev-parse', 'HEAD', cwd=self.work)
        self.git('push', '-q', 'origin', 'automation/issue-40', cwd=self.work)
        (self.second / (self.web if conflict else self.api_path)).write_text('B independent change\n')
        self.git('commit', '-qam', 'B advances DEV', cwd=self.second)
        self.dev = self.git('rev-parse', 'HEAD', cwd=self.second)
        self.git('push', '-q', 'origin', 'dev', cwd=self.second)
        self.st = a.Store(rt.layout.state_dir)
        self.parent = issue(40, locks=['web:games'])
        self.active = self.st.claim([self.parent], SINCE)
        self.qa = dict(verdict='PASS', findings=[], reviewed_sha=self.head)
        self.st.phase('blocked', attempt=2, head=self.head, base=self.base, pr=70,
                      resume_phase='ci', reason='Actions failed', qa=self.qa)
        a.atomic(self.st.directory / 'qa-40-a2.json', self.qa)
        self.config = types.SimpleNamespace(repo=self.repo, worktrees_root=rt.layout.worktrees,
            state_dir=self.st.directory, known_hosts=Path(tmp) / 'known_hosts', poll=120,
            wait_timeout=30, model_timeout=30)
        self.bridge = a.Bridge(self.config, self.st)
        self.bridge.work = self.work
        self.prompts, self.gated, self.comments = [], [], []
        self.bridge.model = self.model

    def close(self):
        self.rt.release_lease()
        self.rt.mutex.release()
        os.close(self.st.lock)

    def git(self, *args, cwd=None):
        return subprocess.run(['git', '-c', 'user.name=Offline', '-c', 'user.email=offline@example.invalid',
            '-c', 'commit.gpgsign=false', *args], cwd=cwd or self.repo, env=self.rt.env(),
            capture_output=True, text=True, check=True).stdout.strip()

    def model(self, prompt, qa=False):
        self.rt.charge(self.active['task'], 'qa' if qa else 'author')
        self.prompts.append((qa, prompt))
        if qa:
            return dict(verdict='PASS', findings=[], reviewed_sha=self.active['head'])
        (self.work / self.web).write_text('candidate repaired; original task diff retained\n')

    def pages(self, path, key=None):
        if path.startswith('issues/40/comments'):
            return self.comments
        if path.startswith('pulls?'):
            return [dict(number=70, head=dict(sha=self.active['head'], repo=dict(full_name=a.REPO)),
                         base=dict(ref='dev', repo=dict(full_name=a.REPO)))]
        if key == 'workflow_runs':
            sha = path.split('head_sha=', 1)[1].split('&', 1)[0]
            dev = 'dev-deploy.yml' in path
            if not dev:
                self.gated.append(sha)
            self.current_run = sha, dev
            return [dict(id=10 if sha == self.head else 20, run_attempt=1,
                name='DEV deploy' if dev else 'Product CI', head_sha=sha,
                head_branch='dev' if dev else 'automation/issue-40', event='push', status='completed',
                conclusion='failure' if sha == self.head else 'success', html_url='local-test-only')]
        if key == 'jobs':
            sha, dev = self.current_run
            return [dict(name=name, head_sha=sha, status='completed',
                conclusion='failure' if sha == self.head and name == 'source (web)' else 'success',
                steps=[dict(name=step, status='completed', conclusion='failure'
                    if sha == self.head and name == 'source (web)' and step.endswith('lint') else 'success')
                    for step in a.REQUIRED_STEPS[name]]) for name in (a.DEV_JOBS if dev else a.CI_JOBS)]
        raise AssertionError('unexpected local API route: ' + path)

    def api(self, path):
        if path == 'issues/40':
            return self.parent
        if path.startswith('https://dev.gobadminton.ru/'):
            return dict(gitSha=self.active['head'])
        raise AssertionError(path)

    @contextlib.contextmanager
    def edges(self):
        real_run = a.run
        def run(argv, *args, **kwargs):
            if argv[0] == 'python3' and argv[-1].endswith('check_foundation.py'):
                return ''  # source-repository foundation fixture is outside this disposable Git repo
            return real_run(argv, *args, **kwargs)
        with patch.object(a, 'READ_REMOTE', str(self.origin)), patch.object(a, 'WRITE_REMOTE', str(self.origin)), \
                patch.object(a, 'api', side_effect=self.api), patch.object(a, 'pages', side_effect=self.pages), \
                patch.object(a, 'run', side_effect=run), \
                patch.object(a, 'server_evidence', return_value={'accepted': 'offline-receipt'}):
            yield


class ContinuityTrain(unittest.TestCase):
    @contextlib.contextmanager
    def train(self, conflict=False):
        with tempfile.TemporaryDirectory() as tmp, slot_mode(tmp) as rt, \
                patch.object(rt, 'continuity', return_value=POLICY):
            train = LocalTrain(tmp, rt, conflict=conflict)
            try:
                with train.edges():
                    yield train
            finally:
                train.close()

    def test_two_slots_advanced_dev_repair_merge_fresh_qa_ci_promotion(self):
        with self.train() as t:
            t.rt.lease(t.active)
            old = copy.deepcopy(t.st.data)
            self.assertTrue(t.bridge.resume(t.active))
            repaired = t.active['head']
            self.assertEqual((t.active['attempt'], t.active['phase'], t.active['base']), (3, 'candidate', t.base))
            self.assertEqual(t.rt.budget.used('codex', 'author'), 1)
            self.assertEqual(t.active['history'][0]['policy'], POLICY)
            self.assertNotIn('comment', t.active['history'][0])
            self.assertEqual(t.active['resumes'], [])
            self.assertIn('Reproduce the failing typecheck', t.prompts[0][1])
            self.assertEqual(json.loads((t.st.directory / 'before-resume-40-a2.json').read_text()), old)
            t.bridge.execute(t.active, recovery=True)
            final = t.active['head']
            self.assertEqual(t.active['phase'], 'done')
            self.assertEqual(t.active['attempt'], 3)
            self.assertEqual(t.active['base'], t.dev)
            self.assertEqual(t.active['integration'], 1)
            self.assertEqual(t.git('rev-parse', 'refs/heads/dev', cwd=t.origin), final)
            self.assertEqual(t.git('show', final + ':' + t.api_path), 'B independent change')
            self.assertIn('original task diff retained', t.git('show', final + ':' + t.web))
            self.assertEqual(t.git('show', '-s', '--format=%P', final).split(), [repaired, t.dev])
            self.assertEqual([t.head, repaired, final], t.gated)
            self.assertEqual(t.rt.budget.used('codex', 'qa'), 2)
            for sha in (t.head, repaired, t.dev):
                t.git('merge-base', '--is-ancestor', sha, final)
            self.assertEqual(t.active['qa']['reviewed_sha'], final)
            self.assertEqual(t.active['ci']['sha'], final)
            self.assertEqual(t.st.data['done'], [40])

    def test_mismatched_qa_remote_dirty_changed_auth_and_rewritten_dev_refuse_repair(self):
        for bad in ('qa', 'remote_head', 'dirty', 'authorization', 'history', 'remote_url'):
            with self.subTest(bad=bad), self.train() as t:
                if bad == 'qa':
                    a.atomic(t.st.directory / 'qa-40-a2.json', t.qa | {'reviewed_sha': t.base})
                elif bad == 'remote_head':
                    t.git('update-ref', 'refs/heads/automation/issue-40', t.base, cwd=t.origin)
                elif bad == 'dirty':
                    (t.work / t.web).write_text('dirty\n')
                elif bad == 'authorization':
                    t.parent['body'] += 'changed'
                elif bad == 'history':
                    t.git('checkout', '--orphan', 'rewritten', cwd=t.second)
                    t.git('commit', '-qm', 'unrelated root', cwd=t.second)
                    t.git('push', '-q', 'origin', 'rewritten', cwd=t.second)
                    t.git('update-ref', 'refs/heads/dev', t.git('rev-parse', 'HEAD', cwd=t.second), cwd=t.origin)
                else:
                    t.git('remote', 'set-url', 'origin', str(t.tmp / 'altered.git'))
                before = copy.deepcopy(t.st.data)
                with self.assertRaises(a.Hold):
                    t.bridge.resume(t.active)
                self.assertEqual(t.st.data, before)
                self.assertEqual(t.rt.budget.used('codex', 'author'), 0)

    def test_owner_comment_preserved_with_dev_drift(self):
        from test_autonomous_issues import resume_comment
        with self.train() as t:
            t.comments = [resume_comment(t.active)]
            self.assertTrue(t.bridge.resume(t.active))
            self.assertEqual(t.active['resumes'], [777])
            self.assertEqual(t.active['history'][0]['comment'], 777)
            self.assertNotIn('policy', t.active['history'][0])
            self.assertIn('lint: console is not defined', t.prompts[0][1])
            self.assertTrue(t.active['owner_note'])

    def test_automatic_repair_requires_exact_failed_run_job_sha_and_recognized_check(self):
        for bad in ('green', 'cancelled', 'job_sha', 'unknown_step'):
            with self.subTest(bad=bad), self.train() as t:
                real_pages = t.pages
                def pages(path, key=None):
                    values = real_pages(path, key)
                    if key == 'workflow_runs' and bad in ('green', 'cancelled'):
                        values[0]['conclusion'] = 'success' if bad == 'green' else 'cancelled'
                    if key == 'jobs':
                        if bad == 'job_sha':
                            values[0]['head_sha'] = t.base
                        elif bad == 'unknown_step':
                            for job in values:
                                for step in job['steps']:
                                    if step['conclusion'] == 'failure':
                                        step['name'] = 'unrecognized API text'
                    return values
                before = copy.deepcopy(t.st.data)
                with patch.object(a, 'pages', side_effect=pages), self.assertRaises(a.Hold):
                    t.bridge.resume(t.active)
                self.assertEqual(t.st.data, before)
                self.assertEqual(t.rt.budget.used('codex', 'author'), 0)

    def test_crash_in_author_is_not_replayed_or_charged_again(self):
        with self.train() as t:
            def die(prompt, qa=False):
                t.rt.charge(t.active['task'], 'author')
                raise Crash()
            t.bridge.model = die
            with self.assertRaises(Crash):
                t.bridge.resume(t.active)
            self.assertEqual((t.active['phase'], t.active['attempt']), ('developing', 3))
            self.assertEqual(t.rt.budget.used('codex', 'author'), 1)
            with self.assertRaisesRegex(a.Hold, 'interrupted writer'):
                t.bridge.execute(t.active, recovery=True)
            self.assertEqual(t.rt.budget.used('codex', 'author'), 1)

    def test_completed_merge_crash_adopts_exact_commit_without_second_merge_or_author(self):
        with self.train() as t:
            t.bridge.resume(t.active)
            repaired = t.active['head']
            t.st.phase('ci', qa=dict(verdict='PASS', findings=[], reviewed_sha=repaired), ci=dict(sha=repaired))
            a.atomic(t.st.directory / 'qa-40-a3.json', t.active['qa'])
            real_finish = t.bridge.finish_integration
            with patch.object(t.bridge, 'finish_integration', side_effect=Crash):
                with self.assertRaises(Crash):
                    t.bridge.integrate(t.active, t.dev)
            merged = t.git('rev-parse', 'HEAD', cwd=t.work)
            self.assertEqual(t.active['phase'], 'integrating')
            real_git = t.bridge.git
            def no_merge(*args, **kwargs):
                self.assertNotIn('merge', args)
                return real_git(*args, **kwargs)
            with patch.object(t.bridge, 'git', side_effect=no_merge):
                t.bridge.execute(t.active, recovery=True)
            self.assertEqual((t.active['phase'], t.active['head'], t.active['integration']), ('done', merged, 1))
            self.assertEqual(t.rt.budget.used('codex', 'author'), 1)
            self.assertEqual(t.rt.budget.used('codex', 'qa'), 1)

    def test_merge_not_completed_is_never_replayed(self):
        with self.train() as t:
            t.st.phase('integrating', integration_target=t.dev)
            with self.assertRaisesRegex(a.Hold, 'invalid integration candidate'):
                t.bridge.execute(t.active, recovery=True)
            self.assertEqual(t.git('rev-parse', 'HEAD', cwd=t.work), t.head)

    def test_clean_aborted_conflict_defers_task_and_unsatisfied_dependency(self):
        with self.train(conflict=True) as t:
            t.bridge.remote_dev()
            t.st.phase('ci', ci=dict(sha=t.head))
            with self.assertRaisesRegex(a.Hold, 'integration conflict'):
                t.bridge.integrate(t.active, t.dev)
            self.assertEqual(t.git('rev-parse', 'HEAD', cwd=t.work), t.head)
            self.assertEqual(t.git('status', '--porcelain', cwd=t.work), '')
            t.st.phase('blocked', resume_phase='ci', reason='integration conflict with new dev')
            self.assertTrue(t.bridge.park(t.active))
            entry = t.st.parked[0]
            self.assertEqual(entry['kind'], 'policy')
            self.assertNotIn('park_comment', entry)
            self.assertEqual(t.st.data, {'active': None, 'done': []})
            status = dict(active=None, parked=[40], done=[41, 44])
            planned, reasons = s.plan([(42, task(depends_on=[40])), (43, task()),
                                      (45, task(depends_on=[40, 44]))], {'slot1': status}, {}, ['slot1'], 1)
            self.assertEqual(planned, {'slot1': 43})
            self.assertIn('dependency parked', reasons[42])
            self.assertIn('dependency parked', reasons[45])
            # An independent task may reuse the paths of the stopped clean writer.
            self.assertEqual(entry['allow_successors'], [])
            s.atomic(t.rt.layout.assignment, dict(schema=s.ASSIGN_SCHEMA, slot='slot1', issue=40,
                assigned_at=1, locks=['web:games'], allowed_paths=t.active['task']['allowed_paths']), 0o644)
            pending = [issue(42, depends_on=[40]), issue(43, locks=['web:games'])]
            cfg = dict(slots=['slot1'], max_parallel=1, approved_since=SINCE.isoformat())
            planned, reasons = s.tick(cfg, t.rt.layout.state_root, t.tmp / 'etc',
                                      fetch=lambda: (pending, []), a=a)
            self.assertEqual(planned, {'slot1': 43})
            self.assertIn('dependency parked', reasons[42])
            with patch.object(a, 'api', return_value=pending[1]), patch.object(a, 'pages', return_value=[]):
                claimed = a.slot_discover(t.st, SINCE)
            self.assertEqual(claimed['issue'], 43)
            self.assertEqual(claimed['attempt'], 0)
            self.assertEqual(t.st.parked[0]['attempt'], 2)
            self.assertNotIn(40, t.st.data['done'])

    def test_ci_and_qa_exhaustion_durable_deferral_and_crash_between_writes(self):
        for stage in ('ci', 'qa'):
            with self.subTest(stage=stage), self.train() as t:
                t.st.phase('blocked', attempt=3, resume_phase=stage,
                    reason='Actions failed' if stage == 'ci' else 'QA FAIL; attempts exhausted',
                    qa=t.qa if stage == 'ci' else t.qa | {'verdict': 'FAIL', 'findings': ['source defect']})
                a.atomic(t.st.directory / 'qa-40-a3.json', t.active['qa'])
                before = copy.deepcopy(t.st.data)
                real_atomic = a.atomic
                def crash_state(path, value):
                    if path == t.st.path:
                        raise Crash()
                    return real_atomic(path, value)
                with patch.object(a, 'atomic', side_effect=crash_state), self.assertRaises(Crash):
                    t.bridge.park(t.active)
                self.assertEqual(json.loads(t.st.path.read_text()), before)
                os.close(t.st.lock)
                t.st = a.Store(t.st.directory)
                t.bridge.store = t.st
                t.active = t.st.data['active']
                with patch.object(t.bridge, 'unchanged_issue', side_effect=AssertionError('durable recovery only')):
                    self.assertTrue(t.bridge.park(t.active))
                self.assertEqual(len(t.st.parked), 1)
                self.assertEqual(t.st.data['done'], [])
                self.assertIsNone(t.st.data['active'])
                self.assertEqual(t.rt.budget.used('codex', 'author'), 0)
                self.assertFalse(t.st.parked_path.exists())
                self.assertTrue(t.st.deferred_path.exists())

    def test_unknown_integrity_uncertain_mutations_and_dirty_exhaustion_never_defer(self):
        for reason, phase in (('unknown', 'ci'), ('API authentication rejected (401)', 'ci'),
                              ('untrusted modified path', 'integrating'), ('zero diff', 'developing'),
                              ('Actions failed', 'dev_wait'), ('dev recovery drift', 'promoting')):
            with self.subTest(reason=reason), self.train() as t:
                t.st.phase('blocked', attempt=3, reason=reason, resume_phase=phase)
                self.assertFalse(t.bridge.defer(t.active))
                self.assertIs(t.st.data['active'], t.active)
        with self.train() as t:
            t.st.phase('blocked', attempt=3)
            a.atomic(t.st.directory / 'qa-40-a3.json', t.qa)
            (t.work / t.web).write_text('unsafe dirty\n')
            with self.assertRaisesRegex(a.Hold, 'dirty'):
                t.bridge.defer(t.active)
            self.assertEqual(t.st.parked, [])

    def test_out_of_scope_merge_and_integration_bound_fail_closed(self):
        for mode in ('paths', 'bound'):
            with self.subTest(mode=mode), self.train() as t:
                t.bridge.remote_dev()
                if mode == 'paths':
                    t.active['task']['allowed_paths'] = ['apps/web/src/games/other.ts']
                else:
                    t.active['integration'] = 3
                with self.assertRaisesRegex(a.Hold, 'untrusted modified path' if mode == 'paths' else 'bound exhausted'):
                    t.bridge.integrate(t.active, t.dev)
                self.assertEqual(t.st.data['done'], [])
                self.assertEqual(t.st.parked, [])

    def test_repaired_or_integrated_head_cannot_promote_with_failed_new_qa_or_ci(self):
        for stage in ('qa', 'ci'):
            with self.subTest(stage=stage), self.train() as t:
                t.bridge.resume(t.active)
                real_model, real_pages = t.bridge.model, t.pages
                def model(prompt, qa=False):
                    result = real_model(prompt, qa)
                    return (result | {'verdict': 'FAIL', 'findings': ['source failure']}
                            if qa and stage == 'qa' and t.active.get('integration') else result)
                def pages(path, key=None):
                    values = real_pages(path, key)
                    if stage == 'ci' and t.active.get('integration'):
                        if key == 'workflow_runs' and 'ci.yml' in path:
                            values[0]['conclusion'] = 'failure'
                        if key == 'jobs':
                            for job in values:
                                if job['name'] == 'source (web)':
                                    job['conclusion'] = 'failure'
                                    for step in job['steps']:
                                        if step['name'].endswith('lint'):
                                            step['conclusion'] = 'failure'
                    return values
                t.bridge.model = model
                with patch.object(a, 'pages', side_effect=pages):
                    with self.assertRaisesRegex(a.Hold, 'QA FAIL' if stage == 'qa' else 'Actions failed'):
                        t.bridge.execute(t.active)
                    t.st.phase('blocked', resume_phase=stage,
                        reason='QA FAIL; attempts exhausted' if stage == 'qa' else 'Actions failed')
                    self.assertTrue(t.bridge.park(t.active))
                self.assertEqual(t.git('rev-parse', 'refs/heads/dev', cwd=t.origin), t.dev)
                self.assertEqual(t.st.data, {'active': None, 'done': []})
                self.assertEqual(t.st.parked[0]['attempt'], 3)
                self.assertEqual(t.rt.budget.used('codex', 'author'), 1)

    def test_out_of_scope_author_remains_dirty_blocked_and_retains_path_exclusion(self):
        with self.train() as t:
            t.rt.lease(t.active)
            def unsafe(prompt, qa=False):
                t.rt.charge(t.active['task'], 'author')
                (t.work / t.api_path).write_text('out of scope\n')
            t.bridge.model = unsafe
            with self.assertRaisesRegex(a.Hold, 'untrusted modified path'):
                t.bridge.resume(t.active)
            t.st.phase('blocked', resume_phase='developing', reason='untrusted modified path')
            self.assertFalse(t.bridge.park(t.active))
            self.assertIsNotNone(t.rt.registry.fd)
            t.rt.publish(t.st.data, [])
            status = s.read_statuses(t.rt.layout.state_root, ['slot1'])
            other = dict(active=None, done=[], parked=[])
            planned, reasons = s.plan([(41, task(locks=['api:unrelated']))],
                                      status | {'slot2': other}, {}, ['slot1', 'slot2'], 2)
            self.assertEqual(planned, {})
            self.assertIn('lock/path conflict', reasons[41])

    def test_main_read_backoff_is_durable_across_restart_without_attempt_or_phase_reset(self):
        with self.train() as t:
            t.st.phase('ci')
            key, known = t.tmp / 'key', t.tmp / 'known_hosts'
            key.write_text('offline dummy'); key.chmod(0o600); known.write_text('offline dummy')
            argv = ['autonomy', '--repo', str(t.repo), '--state-dir', str(t.st.directory),
                    '--worktrees-root', str(t.rt.layout.worktrees), '--known-hosts', str(known),
                    '--approved-since', SINCE.isoformat()]
            with patch.object(a.sys, 'argv', argv), patch.object(a, 'KEY', key), \
                    patch.object(a.pwd, 'getpwuid', return_value=types.SimpleNamespace(pw_name=t.rt.user)), \
                    patch.object(a, 'Store', return_value=t.st), patch.object(a, 'Bridge', return_value=t.bridge), \
                    patch.object(a.signal, 'signal'), \
                    patch.object(a, 'run', return_value=f'KillMode=control-group\nMainPID={os.getpid()}\nActiveState=active'), \
                    patch.object(t.bridge, 'execute', side_effect=a.ReadWait()) as execute, \
                    patch.object(a.time, 'time', return_value=1000), patch.object(a.time, 'sleep', side_effect=Crash):
                with self.assertRaises(Crash):
                    a.main()
                durable = json.loads(t.st.path.read_text())['active']
                self.assertEqual((durable['phase'], durable['attempt'], durable['head']), ('ci', 2, t.head))
                self.assertEqual(durable['wait']['until'], 1240)
                self.assertEqual(execute.call_count, 1)
                clock = [1000]
                def advance(seconds):
                    clock[0] += seconds
                with patch.object(a.time, 'time', side_effect=lambda: clock[0]), \
                        patch.object(a.time, 'sleep', side_effect=advance), \
                        patch.object(t.bridge, 'execute', side_effect=Crash) as resumed:
                    with self.assertRaises(Crash):
                        a.main()
                    self.assertEqual(resumed.call_count, 1)
                    self.assertEqual(clock[0], 1240)
                    self.assertNotIn('wait', t.active)
                    self.assertEqual(t.active['attempt'], 2)
                    self.assertEqual(t.rt.budget.used('codex', 'author'), 0)

    def test_transient_reads_keep_phase_but_uncertain_git_push_is_hold(self):
        with self.train() as t:
            before = copy.deepcopy(t.st.data)
            with patch.object(a, '_api_once', side_effect=a.ReadWait()), patch.object(a.time, 'sleep'), \
                    self.assertRaises(a.ReadWait):
                API('issues/40')
            self.assertEqual(t.st.data, before)
            # Real process failures: narrowly recognized read/network failure only.
            argv = ['/bin/sh', '-c', 'echo "fatal: Could not resolve host: local.invalid" >&2; exit 1']
            with self.assertRaises(a.ReadWait):
                a.run(argv, t.repo, t.rt.env(), network_read=True)
            with self.assertRaises(a.Hold):
                a.run(argv, t.repo, t.rt.env())
            with self.assertRaises(a.Hold):
                a.run(['/bin/sh', '-c', 'echo "Permission denied (publickey)" >&2; exit 1'],
                      t.repo, t.rt.env(), network_read=True)

    def test_budget_never_reset_and_disabled_policy_preserves_manual_drift_gate(self):
        with self.train() as t:
            for _ in range(40):
                t.rt.charge(t.active['task'], 'author')
            with self.assertRaisesRegex(s.Hold, 'budget exhausted'):
                t.rt.charge(t.active['task'], 'author')
            self.assertEqual(t.rt.budget.used('codex', 'author'), 40)
            with patch.object(t.rt, 'continuity', return_value=None):
                self.assertFalse(t.bridge.resume(t.active))
                from test_autonomous_issues import resume_comment
                t.comments = [resume_comment(t.active)]
                with self.assertRaisesRegex(a.Hold, 'dev baseline drift'):
                    t.bridge.resume(t.active)
                with patch.object(a, '_api_once', side_effect=a.ReadWait()), patch.object(a.time, 'sleep'), \
                        self.assertRaisesRegex(a.Hold, 'read retries exhausted'):
                    API('issues/40')


class PolicyTrust(unittest.TestCase):
    def test_policy_schema_bounds_disabled_missing_and_trust(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'continuity.json'
            self.assertIsNone(s.continuity_policy(path))
            value = {k: v for k, v in POLICY.items() if k != 'sha256'}
            real_lstat, real_fstat = Path.lstat, os.fstat
            def root_info(info, uid=0, mode=None):
                fields = list(info)
                fields[4] = uid
                if mode is not None:
                    fields[0] = mode
                return os.stat_result(fields)
            with patch.object(Path, 'lstat', lambda p: root_info(real_lstat(p))), \
                    patch.object(os, 'fstat', lambda fd: root_info(real_fstat(fd))):
                path.write_text(json.dumps(value)); path.chmod(0o644)
                policy = s.continuity_policy(path)
                self.assertEqual(policy['sha256'], hashlib.sha256(path.read_bytes()).hexdigest())
                for change in ({'enabled': False}, {'max_attempts': 4}, {'max_attempts': True},
                               {'max_integrations': 4}, {'read_backoff_seconds': 119}, {'extra': 1}):
                    path.write_text(json.dumps(value | change))
                    if change == {'enabled': False}:
                        self.assertIsNone(s.continuity_policy(path))
                    else:
                        with self.assertRaises(s.Hold):
                            s.continuity_policy(path)
                path.write_text(json.dumps(value))
                path.chmod(0o666)
                with self.assertRaises(s.Hold):
                    s.continuity_policy(path)
                path.chmod(0o644)
                hard = path.with_name('hard'); os.link(path, hard)
                with self.assertRaises(s.Hold):
                    s.continuity_policy(path)
                hard.unlink()
                path.rename(hard); path.symlink_to(hard)
                with self.assertRaises(OSError):
                    s.continuity_policy(path)
                path.unlink(); hard.rename(path)
                with patch.object(os, 'fstat', lambda fd: root_info(real_fstat(fd), uid=123)):
                    with self.assertRaises(s.Hold):
                        s.continuity_policy(path)
                with patch.object(Path, 'lstat', lambda p: root_info(real_lstat(p), uid=123)):
                    with self.assertRaises(s.Hold):
                        s.continuity_policy(path)


class QueueReasons(unittest.TestCase):
    def test_busy_conflict_dependency_and_no_admission_are_distinct(self):
        statuses = {
            'slot1': dict(active=dict(issue=1, phase='blocked', locks=['web:a'],
                allowed_paths=['apps/web/src/games/**']), parked=[50], done=[51]),
            'slot2': dict(active=dict(issue=2, phase='ci', locks=['api:a'],
                allowed_paths=['apps/api/src/**']), parked=[], done=[])}
        planned, reasons = s.plan([(3, task(depends_on=[50])), (4, task(depends_on=[99])),
            (5, task(locks=['web:a'])), (6, task(locks=['admin:a'], allowed_paths=['apps/admin/src/**']))],
            statuses, {}, ['slot1', 'slot2'], 2)
        self.assertEqual(planned, {})
        self.assertIn('dependency parked', reasons[3])
        self.assertEqual(reasons[4], 'waiting for dependencies')
        self.assertIn('lock/path conflict', reasons[5])
        self.assertIn('busy', reasons[6])
        with tempfile.TemporaryDirectory() as tmp:
            roots = host(tmp)
            s.atomic(roots['state_root'] / 'outbox/slot1/status.json',
                dict(schema=s.STATUS_SCHEMA, slot='slot1', active=None, done=[], parked=[]), 0o644)
            prose = issue(42) | {'body': 'Please do an arbitrary task from this web backlog'}
            planned, reasons = s.tick(dict(slots=['slot1'], max_parallel=1, approved_since=SINCE.isoformat()),
                roots['state_root'], roots['config_root'], fetch=lambda: ([prose], []), a=a)
            self.assertEqual(planned, {})
            self.assertEqual(reasons['queue'], 'no admitted tasks')


if __name__ == '__main__':
    unittest.main()

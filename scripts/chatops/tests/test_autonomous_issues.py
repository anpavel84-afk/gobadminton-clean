"""Offline contract/recovery tests; never consume live Issues or invoke a model."""
import copy
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('autonomy', Path(__file__).parents[1] / 'autonomous_issues.py')
a = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(a)
HEAD, BASE, DRIFT = 'a' * 40, 'b' * 40, 'c' * 40
NOW = dt.datetime.now(dt.timezone.utc)
SINCE = NOW - dt.timedelta(hours=1)


def issue(number=30):
    task = dict(schema=a.MARKER, target='dev', kind='source_only', goal='Write canary',
                acceptance='File contains the approved canary.',
                allowed_paths=[a.CANARIES[number]], max_attempts=1)
    stamp = NOW.isoformat()
    return dict(number=number, state='open', user={'id': 318610566},
                created_at=stamp, updated_at=stamp, body=a.MARKER + '\n' + json.dumps(task))


def gates(required, deploy=False):
    run = dict(head_sha=HEAD, event='push', status='completed', conclusion='success')
    jobs = [dict(name=n, status='completed', conclusion='success', steps=[
        dict(name=step, status='completed', conclusion='success') for step in a.REQUIRED_STEPS[n]])
        for n in required]
    return run, jobs


def existing(number=13):
    parent = issue() | dict(number=number, body='Original product prose',
                           created_at=(NOW-dt.timedelta(days=90)).isoformat(),
                           updated_at=(NOW-dt.timedelta(days=2)).isoformat())
    task = json.loads(issue()['body'].split('\n', 1)[1])
    task['allowed_paths'] = ['apps/web/src/example.ts']
    comment = dict(id=123, issue_url=f'https://api.github.com/repos/{a.REPO}/issues/{number}',
                   user={'id': 318610566}, created_at=NOW.isoformat(), updated_at=NOW.isoformat(),
                   body=a.MARKER+'\n'+json.dumps(task))
    return parent, comment


class CommentAdmission(unittest.TestCase):
    def test_old_parent_restart_done_and_no_body_rewrite(self):
        parent, comment = existing()
        original = copy.deepcopy(parent)
        with tempfile.TemporaryDirectory() as tmp:
            store = a.Store(Path(tmp)/'state')
            active = store.claim([parent], SINCE, [comment])
            self.assertEqual(active['issue'], 13)
            self.assertEqual(active['comment']['id'], 123)
            os.close(store.lock)
            store = a.Store(Path(tmp)/'state')
            try:
                self.assertEqual(store.claim([], SINCE), active)
                store.phase('done')
                self.assertIsNone(store.claim([parent], SINCE, [comment | {'id': 124}]))
                self.assertEqual(parent, original)
            finally:
                os.close(store.lock)

    def test_invalid_comments_and_parents(self):
        parent, comment = existing()
        old = (NOW-dt.timedelta(days=8)).isoformat()
        future = (NOW+dt.timedelta(days=1)).isoformat()
        cases = [(parent | change, comment) for change in
                 ({'user': {'id': 1}}, {'user': {'id': str(318610566)}},
                  {'state': 'closed'}, {'pull_request': {}})]
        cases += [(parent, comment | change) for change in
                  ({'user': {'id': 1}}, {'user': {'id': str(318610566)}},
                   {'id': True}, {'id': 0}, {'id': '123'},
                   {'issue_url': 'https://api.github.com/repos/other/repo/issues/13'},
                   {'issue_url': comment['issue_url']+'0'},
                   {'updated_at': old}, {'created_at': old, 'updated_at': old},
                   {'created_at': future, 'updated_at': future},
                   {'body': a.MARKER+'\n{invalid}'}, {'body': 'prose'},
                   {'body': ' '+comment['body']})]
        for par, com in cases:
            with self.subTest(parent=par, comment=com), tempfile.TemporaryDirectory() as tmp:
                store = a.Store(Path(tmp)/'state')
                try:
                    self.assertIsNone(store.claim([par], SINCE, [com]))
                finally:
                    os.close(store.lock)

    def test_comment_exact_task_contract_and_cutoff(self):
        parent, comment = existing()
        task = json.loads(comment['body'].split('\n', 1)[1])
        for changes in ({'target': 'prod'}, {'kind': 'deploy'}, {'schema': 1},
                        {'max_attempts': True}, {'max_attempts': 4},
                        {'allowed_paths': ['scripts/chatops/autonomous_issues.py']},
                        {'allowed_paths': ['apps/../secret']},
                        {'allowed_paths': ['apps/web/$(touch proof)']},
                        {'allowed_paths': [a.CANARIES[30]]}, {'extra': 'field'}):
            with self.subTest(changes=changes), self.assertRaises(a.Hold):
                a.validate_comment(parent, comment | {
                    'body': a.MARKER+'\n'+json.dumps(task | changes)}, SINCE, NOW)
        with self.assertRaises(a.Hold):
            a.validate_comment(parent, comment | {
                'body': a.MARKER+'\n'+comment['body'].split('\n', 1)[1][:-1]+',"target":"dev"}'}, SINCE, NOW)
        with self.assertRaises(a.Hold):
            a.validate_comment(parent, comment, NOW+dt.timedelta(seconds=1), NOW)
        # Equal instants with different UTC offsets must tie-break by Issue number.
        other, second = existing(12)
        second['created_at'] = second['updated_at'] = NOW.astimezone(
            dt.timezone(dt.timedelta(hours=2))).isoformat()
        with tempfile.TemporaryDirectory() as tmp:
            store = a.Store(Path(tmp)/'state')
            try:
                self.assertEqual(store.claim([parent, other], SINCE, [comment, second])['issue'], 12)
            finally:
                os.close(store.lock)

    def test_ambiguity_and_authorization_instant_order(self):
        parent, comment = existing()
        other, second = existing(15)
        second['created_at'] = second['updated_at'] = (NOW-dt.timedelta(minutes=1)).isoformat()
        with tempfile.TemporaryDirectory() as tmp:
            store = a.Store(Path(tmp)/'state')
            try:
                self.assertIsNone(store.claim([parent], SINCE, [comment, comment | {'id': 124}]))
                self.assertEqual(store.claim([parent, other], SINCE, [comment, second])['issue'], 15)
            finally:
                os.close(store.lock)

    def test_runtime_exact_comment_and_parent_fail_closed(self):
        parent, comment = existing()
        with tempfile.TemporaryDirectory() as tmp:
            store = a.Store(Path(tmp)/'state')
            try:
                active = store.claim([parent], SINCE, [comment])
                bridge = a.Bridge(types.SimpleNamespace(), store)
                with patch.object(a, 'api', side_effect=[parent, comment]) as read:
                    bridge.unchanged_issue(active)
                    self.assertEqual(read.call_args.args[0], 'issues/comments/123')
                for changes in ({'id': 124}, {'id': True}, {'body': issue()['body']},
                                {'user': {'id': 1}}, {'updated_at': 'edited'},
                                {'issue_url': comment['issue_url']+'0'},
                                {'created_at': (NOW-dt.timedelta(seconds=1)).isoformat()}):
                    with patch.object(a, 'api', side_effect=[parent, comment | changes]):
                        with self.assertRaises((a.Hold, ValueError)):
                            bridge.unchanged_issue(active)
                with patch.object(a, 'api', side_effect=[parent, a.Hold('deleted')]):
                    with self.assertRaises(a.Hold):
                        bridge.unchanged_issue(active)
                with patch.object(a, 'api', return_value=parent | {'body': 'changed'}):
                    with self.assertRaises(a.Hold):
                        bridge.unchanged_issue(active)
            finally:
                os.close(store.lock)

    def test_discovery_quota_preserves_checkpoint_and_fetches_once(self):
        parent, comment = existing()
        with tempfile.TemporaryDirectory() as tmp:
            store = a.Store(Path(tmp)/'state')
            try:
                active = store.claim([parent], SINCE, [comment])
                before = store.path.read_bytes()
                with patch.object(a, 'pages', side_effect=[[parent], a.QuotaWait()]):
                    with self.assertRaises(a.QuotaWait):
                        a.discover(store, SINCE)
                self.assertEqual(store.path.read_bytes(), before)
                with patch.object(a, 'pages', side_effect=[[parent], [comment]]) as read:
                    self.assertEqual(a.discover(store, SINCE), active)
                    self.assertEqual(read.call_count, 2)
                    self.assertTrue(read.call_args.args[0].startswith('issues/comments?since='))
            finally:
                os.close(store.lock)


class Contracts(unittest.TestCase):
    def test_two_canaries_and_strict_schema(self):
        for n in (30, 31):
            task = a.validate_issue(issue(n), SINCE, NOW)
            self.assertTrue(a.permitted(a.CANARIES[n], task['allowed_paths']))
        for field, value in [('schema', 1), ('acceptance', ['text']), ('target', 'prod'),
                             ('allowed_paths', ['docs/operations/chatops/README.md']),
                             ('allowed_paths', [a.CANARIES[31]]), ('max_attempts', True)]:
            i = issue(); task = json.loads(i['body'].split('\n', 1)[1]); task[field] = value
            i['body'] = a.MARKER + '\n' + json.dumps(task)
            with self.subTest(field=field, value=value), self.assertRaises(a.Hold):
                a.validate_issue(i, SINCE, NOW)

    def test_owner_freshness_marker_edits_and_paths(self):
        for changes in ({'user': {'id': 1}}, {'updated_at': 'changed'}, {'body': ' ' + issue()['body']},
                        {'pull_request': {}}, {'state': 'closed'}):
            with self.subTest(changes=changes), self.assertRaises(a.Hold):
                a.validate_issue(issue() | changes, SINCE, NOW)
        with self.assertRaises(a.Hold):
            a.validate_issue(issue(), NOW + dt.timedelta(seconds=1), NOW)
        for path in ('docs/operations/**', 'docs/rules/x.md', 'apps/../x', '.github/a.yml'):
            with self.assertRaises(a.Hold):
                a.patterns([path])

    def test_lock_durable_claim_and_sequence(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / 'state'; store = a.Store(directory)
            try:
                self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
                with self.assertRaises(a.Hold):
                    a.Store(directory)
                first = store.claim([issue(31), issue(30)], SINCE)
                self.assertEqual(first['issue'], 30)
                self.assertEqual(store.claim([issue(31)], SINCE)['issue'], 30)
                store.phase('done')
                self.assertEqual(store.claim([issue(30), issue(31)], SINCE)['issue'], 31)
                os.close(store.lock)
                store = a.Store(directory)
                self.assertEqual(store.data['active']['issue'], 31)
                self.assertEqual(store.data['done'], [30])
                self.assertEqual(store.path.stat().st_mode & 0o777, 0o600)
            finally:
                os.close(store.lock)

    def test_exact_sha_jobs_and_failures(self):
        run, jobs = gates(a.CI_JOBS)
        self.assertTrue(a.successful(run, jobs, HEAD, a.CI_JOBS))
        for bad_run, bad_jobs in [(run | {'head_sha': BASE}, jobs),
                                  (run | {'conclusion': 'failure'}, jobs), (run, jobs[:-1]),
                                  (run, jobs + jobs[:1])]:
            with self.assertRaises(a.Hold):
                a.successful(bad_run, bad_jobs, HEAD, a.CI_JOBS)
        run, jobs = gates(a.DEV_JOBS)
        next(j for j in jobs if j['name'] == 'deploy')['steps'][0]['conclusion'] = 'skipped'
        with self.assertRaises(a.Hold):
            a.successful(run, jobs, HEAD, a.DEV_JOBS, True)
        qa = dict(verdict='FAIL', findings=['defect'], reviewed_sha=HEAD)
        self.assertFalse(a.qa_result(qa, HEAD))
        with self.assertRaises(a.Hold):
            a.qa_result(qa, BASE)

    def test_default_profile_and_auth_blocked(self):
        with patch.dict(os.environ, {'CODEX_HOME': '/srv/gobadminton-clean/runner/codex-home'}):
            self.assertEqual(a.clean_env()['CODEX_HOME'], '/home/agentagency-dev/.codex')
        with self.assertRaisesRegex(a.Hold, 'BLOCKED'):
            a.run(['/bin/sh', '-c', 'echo Unauthorized 401 >&2; exit 1'], '/tmp', a.clean_env())

    def test_successful_stderr_auth_words_are_not_rejection(self):
        self.assertEqual(a.run(
            ['/bin/sh', '-c', 'echo /tmp/unauthorized/path Unauthorized401 >&2; printf ok'],
            '/tmp', a.clean_env()), 'ok')

    def test_nonzero_unauthorized_path_is_generic_failure(self):
        with self.assertRaisesRegex(a.Hold, '^command failed:'):
            a.run(['/bin/sh', '-c', 'echo /tmp/unauthorized/path >&2; exit 1'],
                  '/tmp', a.clean_env())

    def test_actual_unauthorized401_blocks(self):
        with self.assertRaisesRegex(a.Hold, 'BLOCKED: model authentication rejected'):
            a.run(['/bin/sh', '-c', 'echo Unauthorized401 >&2; exit 1'],
                  '/tmp', a.clean_env())

    def test_guard_setup_failure_never_executes_child(self):
        with tempfile.TemporaryDirectory() as tmp:
            proof = Path(tmp) / 'executed'
            with self.assertRaises(subprocess.SubprocessError):
                a.run(['/usr/bin/touch', str(proof)], tmp, a.clean_env(),
                      guard=([Path(tmp) / 'missing'], []))
            self.assertFalse(proof.exists())

    def test_quota_retains_backoff_without_tokens(self):
        error = a.urllib.error.HTTPError('url', 403, 'quota', {}, None)
        with patch.object(a, '_API_NEXT', 0), patch.object(a.urllib.request, 'urlopen', side_effect=error):
            with self.assertRaises(a.QuotaWait):
                a._api_once('issues?state=open')
            self.assertGreater(a._API_NEXT, a.time.monotonic() + 3500)
        a._API_NEXT = 0

    def test_landlock_child_enforcement_or_closed_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); allowed = root / 'allowed'; allowed.mkdir()
            secret = root / 'secret'; secret.write_text('test secret')
            (allowed/'link').symlink_to(secret)
            reads = [Path(p) for p in ('/usr', '/bin', '/lib', '/lib64') if Path(p).exists()]
            code = ('from pathlib import Path; import sys\n'
                    'Path(sys.argv[1]).write_text("ok")\n'
                    'for name in sys.argv[2:]:\n'
                    ' try:\n  Path(name).read_text()\n'
                    ' except PermissionError:\n  print("DENIED")\n'
                    ' else:\n  raise RuntimeError("secret readable")\n')
            command = ['/bin/sh', '-c', 'exec /usr/bin/python3 -B -c "$1" "$2" "$3" "$4" "$5"', 'guard-test', code,
                       str(allowed / 'proof'), str(secret), str(allowed/'link'), '/proc/self/root'+str(secret)]
            try:
                result = a.run(command, root, a.clean_env(), guard=(reads, [allowed]))
            except subprocess.SubprocessError:
                self.assertFalse((allowed / 'proof').exists(), 'guard failed after child executed')
                print('Landlock unavailable: child execution blocked; commissioning BLOCKED')
            else:
                self.assertEqual(result, 'DENIED\nDENIED\nDENIED')
                self.assertEqual((allowed / 'proof').read_text(), 'ok')


class Adversarial(unittest.TestCase):
    def test_each_required_step_cannot_be_skipped_missing_or_duplicated(self):
        for required in (a.CI_JOBS, a.DEV_JOBS):
            run, jobs = gates(required)
            for index, job in enumerate(jobs):
                for step in range(len(job['steps'])):
                    for mode in ('skip', 'missing', 'duplicate'):
                        bad = copy.deepcopy(jobs)
                        steps = bad[index]['steps']
                        if mode == 'skip':
                            steps[step]['conclusion'] = 'skipped'
                        elif mode == 'missing':
                            steps.pop(step)
                        else:
                            steps.append(steps[step].copy())
                        with self.subTest(job=job['name'], mode=mode), self.assertRaises(a.Hold):
                            a.successful(run, bad, HEAD, required, required == a.DEV_JOBS)

    def test_server_receipt_exact_identity_digests_pending_and_freshness(self):
        good = dict(schema=1, environment='dev', pending=False, observed_at=int(a.time.time()),
                    accepted=dict(status='ACCEPTED', finished_at=int(a.time.time()), release_id='r1-a1', source_sha=HEAD,
                                  api_digest='sha256:'+'b'*64, web_digest='sha256:'+'c'*64))
        self.assertEqual(a.validate_server_evidence(good, 'r1-a1', HEAD), good)
        for changes in ({'pending': True}, {'pending': None}, {'observed_at': 0},
                        {'environment': 'prod'}, {'observed_at': int(a.time.time())+60}):
            with self.assertRaises(a.Hold):
                a.validate_server_evidence(good | changes, 'r1-a1', HEAD)
        for changes in ({'release_id': 'r2-a1'}, {'source_sha': BASE}, {'status': 'PENDING_SMOKE'},
                        {'api_digest': 'sha256:bad'}, {'web_digest': None}, {'finished_at': 0}, {'finished_at': True}, {'finished_at': int(a.time.time())+1}):
            with self.assertRaises(a.Hold):
                a.validate_server_evidence(good | {'accepted': good['accepted'] | changes}, 'r1-a1', HEAD)

    def test_receipt_survives_api_spacing_but_expires_from_acceptance(self):
        now = 100000
        good = dict(schema=1, environment='dev', pending=False, observed_at=now-900,
                    accepted=dict(status='ACCEPTED', finished_at=now-901, release_id='r1-a1',
                                  source_sha=HEAD, api_digest='sha256:'+'b'*64, web_digest='sha256:'+'c'*64))
        with patch.object(a.time, 'time', return_value=now):
            a.validate_server_evidence(good, 'r1-a1', HEAD)
            good['accepted']['finished_at'] = now-a.EVIDENCE_MAX_AGE-1
            with self.assertRaises(a.Hold):
                a.validate_server_evidence(good, 'r1-a1', HEAD)

    def test_managed_profile_and_config_preflight(self):
        import tomllib
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); work = root/'work'; work.mkdir()
            args = a.model_command(a.NATIVE_CODEX, work, root/'job', root/'git', root/'state')
            self.assertNotIn('--sandbox', args)
            self.assertIn('--no-daemon', args)
            profile = tomllib.loads(next(x for x in args if x.startswith('permissions.')))['permissions']['gb-task']
            self.assertFalse(profile['network']['enabled'])
            self.assertEqual(profile['filesystem'][str(a.KEY.parent)], 'deny')
            self.assertEqual(profile['filesystem'][str(work/'.git')], 'read')
            self.assertEqual(profile['filesystem'][':root'], 'deny')
            self.assertEqual(profile['filesystem'][':slash_tmp'], 'deny')
            self.assertEqual(profile['filesystem'][':tmpdir'], 'write')
            self.assertEqual(profile['filesystem'][str(root/'job')], 'write')
            self.assertEqual(profile['filesystem'][str(root/'state')], 'deny')
            (work/'.codex').mkdir(); (work/'.codex/config.toml').write_text('')
            with self.assertRaises(a.Hold):
                a.model_command(a.NATIVE_CODEX, work, root/'job', root/'git', root/'state')

    def test_forged_evidence_and_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'dev.json'
            p.write_text(json.dumps(dict(schema=1, environment='dev', pending=False,
                observed_at=int(a.time.time()), accepted=dict(status='ACCEPTED',
                source_sha=HEAD, release_id='r1-a1', api_digest='sha256:'+'b'*64,
                web_digest='sha256:'+'c'*64))))
            p.chmod(0o644)
            with patch.object(a, 'EVIDENCE', p), self.assertRaises(a.Hold):
                a.server_evidence('r1-a1', HEAD)
            link = Path(tmp) / 'link'; link.symlink_to(p)
            with patch.object(a, 'EVIDENCE', link), self.assertRaises((a.Hold, OSError)):
                a.server_evidence('r1-a1', HEAD)

    def test_transient_reads_and_401_classification_without_sleep(self):
        for error in (a.urllib.error.URLError('offline'), TimeoutError(),
                      a.urllib.error.HTTPError('url', 503, 'unavailable', {}, None)):
            with patch.object(a, '_API_NEXT', 0), patch.object(a.urllib.request, 'urlopen', side_effect=error):
                with self.assertRaises(a.ReadWait):
                    a._api_once('issues')
        with patch.object(a, '_API_NEXT', 0), patch.object(a.urllib.request, 'urlopen',
                side_effect=a.urllib.error.HTTPError('url', 401, 'denied', {}, None)):
            with self.assertRaises(a.Hold):
                a.api('issues')

    def test_read_retries_are_bounded_and_never_repeat_caller(self):
        with patch.object(a, '_api_once', side_effect=[a.ReadWait(), {'ok': True}]) as read, patch.object(a.time, 'sleep') as sleep:
            self.assertEqual(a.api('issues'), {'ok': True})
            self.assertEqual(read.call_count, 2)
            sleep.assert_called_once_with(2)
        with patch.object(a, '_api_once', side_effect=a.ReadWait()) as read, patch.object(a.time, 'sleep') as sleep:
            with self.assertRaises(a.Hold):
                a.api('issues')
            self.assertEqual(read.call_count, 5)
            self.assertEqual([x.args[0] for x in sleep.call_args_list], [2, 4, 8, 16])

    def test_term_kills_real_child_and_grandchild_before_lock_release(self):
        import time
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            # Worker owns flock; descendants attempt delayed proof writes.
            script = root / 'worker.py'
            script.write_text("import importlib.util,signal,sys\n"
                "spec=importlib.util.spec_from_file_location('a',sys.argv[1]);a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)\n"
                "signal.signal(signal.SIGTERM,lambda *_:sys.exit(143))\n"
                "store=a.Store(a.Path(sys.argv[2])/'state')\n"
                "a.run(['/bin/sh','-c',sys.argv[3]],sys.argv[2],a.clean_env())\n")
            command = '(sleep 1; touch "' + str(root / 'survivor') + '") & echo ready > "' + str(root / 'ready') + '"; wait'
            worker = subprocess.Popen(['/usr/bin/python3', '-B', str(script), str(SPEC.origin), tmp, command])
            try:
                deadline = time.monotonic() + 5
                while not (root / 'ready').exists() and time.monotonic() < deadline:
                    time.sleep(.01)
                self.assertTrue((root / 'ready').exists())
                with self.assertRaises(a.Hold):
                    a.Store(root / 'state')
                worker.terminate(); worker.wait(timeout=5)
                store = a.Store(root / 'state'); os.close(store.lock)
                time.sleep(1.1)
                self.assertFalse((root / 'survivor').exists())
            finally:
                if worker.poll() is None:
                    worker.kill(); worker.wait()


class SourceReview(unittest.TestCase):
    def review(self, result):
        task = json.loads(issue()['body'].split('\n', 1)[1])
        task['acceptance'] = ('File contains the approved canary; GitHub CI succeeds, '
                              'DEV is deployed and server ACCEPTED release evidence is recorded.')
        active = dict(issue=30, attempt=1, head=HEAD, base=BASE, task=task)
        with tempfile.TemporaryDirectory() as tmp:
            store = unittest.mock.Mock()
            bridge = a.Bridge(types.SimpleNamespace(worktrees_root=Path(tmp),
                                                    state_dir=Path(tmp)), store)
            author_work = Path(tmp) / 'author'
            bridge.work = author_work
            bridge.clean = unittest.mock.Mock()
            bridge.git = unittest.mock.Mock(side_effect=['', HEAD, ''])
            bridge.model = unittest.mock.Mock(return_value=result)
            with patch.object(a, 'atomic') as save:
                passed = bridge.review(active)
            prompt = bridge.model.call_args.args[0]
            self.assertEqual(bridge.model.call_args.kwargs, {'qa': True})
            self.assertEqual(json.loads(prompt.split('TASK: ', 1)[1]), task)
            self.assertIn(HEAD + ' against base ' + BASE, prompt)
            self.assertIn('reviewed_sha (exact SHA)', prompt)
            self.assertEqual(bridge.work, author_work)
            return passed, prompt, store, save

    def test_mixed_acceptance_stays_source_only(self):
        result = dict(verdict='PASS', findings=[], reviewed_sha=HEAD)
        passed, prompt, store, save = self.review(result)
        self.assertTrue(passed)
        for instruction in ('SOURCE QA before CI and DEV', 'immutable task goal, allowed paths',
                            'project rules and source-level acceptance', 'run feasible source tests',
                            'future lifecycle clauses', 'must not require GitHub authentication',
                            'a CI run, release evidence, deployed acceptance, or any later-stage action',
                            'PASS is a source-only verdict, never lifecycle acceptance',
                            'Later CI and server ACCEPTED gates remain mandatory and unchanged'):
            self.assertIn(instruction, prompt)
        store.phase.assert_called_once_with('qa', qa=result)
        self.assertEqual(save.call_args.args[1], result)

    def test_mixed_acceptance_preserves_real_defect_and_exact_sha(self):
        result = dict(verdict='FAIL', findings=['Approved canary content is missing'], reviewed_sha=HEAD)
        passed, prompt, store, save = self.review(result)
        self.assertFalse(passed)
        self.assertIn('Report real source defects, scope/rule violations', prompt)
        self.assertIn('do not waive source requirements because acceptance mixes stages', prompt)
        store.phase.assert_called_once_with('qa', qa=result)
        self.assertEqual(save.call_args.args[1], result)
        with self.assertRaisesRegex(a.Hold, 'QA SHA mismatch'):
            self.review(result | {'reviewed_sha': BASE})


class Recovery(unittest.TestCase):
    def exercise(self, phase, remote=HEAD, dirty=False, qa='PASS', ci_fail=False, tamper=False):
        with tempfile.TemporaryDirectory() as tmp:
            store = a.Store(Path(tmp) / 'state')
            try:
                active = store.claim([issue()], SINCE)
                store.phase(phase, head=HEAD, base=BASE, qa=dict(verdict=qa, findings=[], reviewed_sha=HEAD),
                            ci={'sha': HEAD})
                a.atomic(store.directory / f'qa-30-a{active["attempt"]}.json',
                         active['qa'] | ({'reviewed_sha': BASE} if tamper else {}))
                bridge = a.Bridge(types.SimpleNamespace(worktrees_root=Path(tmp), state_dir=store.directory), store)
                calls = []
                bridge.unchanged_issue = lambda x: None
                bridge.clean = lambda sha: a.require(not dirty, 'dirty worktree')
                remote_state = [remote]
                bridge.remote_dev = lambda: remote_state[0]
                def wait_run(x, dev=False):
                    calls.append(('wait', dev))
                    a.require(not ci_fail, 'Actions failed')
                    return dict(sha=HEAD, id=1, run_attempt=1, attempt=1)
                bridge.wait_run = wait_run
                def git(*args, **kw):
                    calls.append(args)
                    if args[0] == 'push':
                        remote_state[0] = HEAD
                    return BASE
                bridge.git = git
                with patch.object(a, 'server_evidence', return_value={'accepted': {'synthetic': True}}), patch.object(a, 'api', return_value={'gitSha': HEAD}):
                    bridge.execute(active, recovery=True)
                return calls, copy.deepcopy(active)
            finally:
                os.close(store.lock)

    def test_promoting_head_no_double_push_base_push_once(self):
        for remote, pushes in ((HEAD, 0), (BASE, 1)):
            calls, active = self.exercise('promoting', remote)
            self.assertEqual(sum(c[0] == 'push' for c in calls), pushes)
            self.assertIn(('wait', False), calls)
            self.assertEqual(active['phase'], 'done')

    def test_dev_wait_exact_remote_and_gates(self):
        calls, active = self.exercise('dev_wait')
        self.assertIn(('wait', False), calls)
        self.assertEqual(active['phase'], 'done')
        for phase, options in [('developing', {}), ('qa', {}), ('candidate', {'dirty': True}),
                               ('promoting', {'remote': DRIFT}), ('dev_wait', {'remote': BASE}),
                               ('promoting', {'qa': 'FAIL'}), ('dev_wait', {'qa': 'FAIL'}),
                               ('promoting', {'ci_fail': True}), ('dev_wait', {'ci_fail': True}),
                               ('promoting', {'tamper': True}), ('dev_wait', {'tamper': True})]:
            with self.subTest(phase=phase, options=options), self.assertRaises(a.Hold):
                self.exercise(phase, **options)


if __name__ == '__main__':
    unittest.main()

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


class RoutePaths(unittest.TestCase):
    def test_exact_existing_admin_bff_route_only(self):
        path = 'apps/admin/src/app/v1/admin/[...path]/route.ts'
        self.assertEqual(a.safe_path(path), path)
        self.assertTrue(a.permitted(path, ['apps/admin/src/**']))
        self.assertFalse(a.permitted(path, ['apps/web/src/**']))
        for unsafe in (
            'apps/admin/src/app/v1/admin/[...path]/page.tsx',
            'apps/admin/src/app/v1/admin/[[...path]]/route.ts',
            'apps/admin/src/app/v1/admin/[...other]/route.ts',
            'apps/admin/src/app/v1/admin/[...path]/../route.ts',
            'apps/admin/src/app/v1/admin/[...path]/nested/route.ts',
            'apps/admin/src/app/v1/admin/%5B...path%5D/route.ts',
            'apps/admin/src/app/v1/other/[...path]/route.ts',
            'apps/web/src/app/v1/admin/[...path]/route.ts',
        ):
            with self.subTest(path=unsafe), self.assertRaises(a.Hold):
                a.safe_path(unsafe)

    def test_literal_dynamic_routes_and_allowed_path_admission(self):
        for path in ('apps/web/src/app/venues/[venueId]/page.tsx',
                     'apps/web/src/app/games/[gameId]/page.tsx',
                     'apps/web/src/app/players/[publicPlayerId]/page.tsx',
                     'apps/web/src/app/[A0_b]/[Child2]/page.tsx'):
            with self.subTest(path=path):
                self.assertIs(a.safe_path(path), path)
                self.assertEqual(a.patterns([path]), [path])
                self.assertTrue(a.permitted(path, [path]))
                self.assertTrue(a.permitted(path, ['apps/web/src/app/**']))
                self.assertFalse(a.permitted(path, ['apps/web/src/other/**']))
                parent, comment = existing(37)
                task = json.loads(comment['body'].split('\n', 1)[1])
                task['allowed_paths'] = [path]
                a.validate_comment(parent, comment | {
                    'body': a.MARKER+'\n'+json.dumps(task)}, SINCE, NOW)

    def test_unsafe_routes_remain_rejected(self):
        root = 'apps/web/src/app/'
        paths = [root+segment+'/page.tsx' for segment in (
            '[...slug]', '[[...slug]]', '[[id]]', '[]', '[0id]', '[_id]',
            '[éId]', '[id-name]', '[id.name]', '[id', 'id]', 'pre[id]',
            '[id]post', '[id][other]', '[id;echo]', '[id$]', '[id\n]',
            '%5Bid%5D', '%255Bid%255D', '[id]/../secrets', '[id]/./child',
            '[id]//child', '[id]/.hidden', '[id]/%2e%2e', '[id]\\child',
            '[id]/$(touch proof)', '[id]/`id`', '[id]/a;b', '[id]/a|b',
            '[id]/a&b', '[id]/a b', '[id]/a\x00b', '[id]/a\rb',
            '[id]/secrets', '[id]/credentials', '[id]/node_modules',
            '[id]/AGENTS.md', '[id]/private.pem', '[id]/private.KEY')]
        paths += [prefix+'[id]/page.tsx' for prefix in (
            'apps/web/src/', 'apps/web/src/application/', 'apps/web/src/app2/',
            'apps/web/src/App/', 'apps/api/src/app/', 'packages/', 'docs/',
            'docs/operations/', 'apps/[web]/src/app/')]
        paths += ['', '/'+root+'[id]/page.tsx', root+'[id]/'+'a'*240,
                  '../apps/web/src/app/[id]/page.tsx',
                  'docs/rules/policy.md', 'docs/governance/policy.md',
                  '/home/agentagency-dev/.gb-autonomy-state/checkpoint.json',
                  '/home/agentagency-dev/.ssh/gobadminton-clean-chatops-ed25519',
                  '.git/config', 'scripts/chatops/autonomous_issues.py',
                  '/tmp/sandbox/[id]/page.tsx', None, 37]
        for path in paths:
            with self.subTest(path=path), self.assertRaises(a.Hold):
                a.safe_path(path)


class CommentAdmission(unittest.TestCase):
    def test_body_and_comment_authorizations_are_ambiguous(self):
        parent = issue()
        _, comment = existing(30)
        for body in (parent['body'], parent['body'].replace('Write canary', 'Other task')):
            with self.subTest(body=body), tempfile.TemporaryDirectory() as tmp:
                store = a.Store(Path(tmp)/'state')
                try:
                    self.assertIsNone(store.claim([parent], SINCE, [comment | {'body': body}]))
                    self.assertIsNone(store.data['active'])
                finally:
                    os.close(store.lock)

    def test_competing_comment_blocks_both_modes_and_restart_before_effects(self):
        for comment_mode in (False, True):
            for restart in (False, True):
                with self.subTest(comment_mode=comment_mode, restart=restart), \
                        tempfile.TemporaryDirectory() as tmp:
                    parent, bound = existing() if comment_mode else (issue(), None)
                    _, competing = existing(parent['number'])
                    competing.update(id=124, body=bound['body'] if bound else parent['body'])
                    competing['body'] = competing['body'].replace('Write canary', 'New instruction')
                    store = a.Store(Path(tmp)/'state')
                    try:
                        active = store.claim([parent], SINCE, [bound] if bound else [])
                        store.phase('candidate', head=HEAD, base=BASE)
                        if restart:
                            os.close(store.lock)
                            store = a.Store(Path(tmp)/'state')
                            active = store.data['active']
                        bridge = a.Bridge(types.SimpleNamespace(worktrees_root=Path(tmp)), store)
                        bridge.git = unittest.mock.Mock()
                        bridge.model = unittest.mock.Mock()
                        with patch.object(a, 'api', side_effect=[parent, bound] if bound else [parent]), \
                                patch.object(a, 'pages', return_value=([bound] if bound else [])+[competing]), \
                                self.assertRaisesRegex(a.Hold, 'competing authorization'):
                            bridge.execute(active, recovery=restart)
                        bridge.git.assert_not_called()
                        bridge.model.assert_not_called()
                    finally:
                        os.close(store.lock)

    def test_runtime_ignores_non_authorizing_comments_in_both_modes(self):
        for comment_mode in (False, True):
            parent, bound = existing() if comment_mode else (issue(), None)
            _, candidate = existing(parent['number'])
            candidate.update(id=124, body=bound['body'] if bound else parent['body'])
            ignored = [candidate | {'user': {'id': 1}}, candidate | {'body': 'Owner prose'},
                       candidate | {'body': a.MARKER+'\n{invalid}'},
                       candidate | {'created_at': (SINCE-dt.timedelta(seconds=1)).isoformat(),
                                    'updated_at': (SINCE-dt.timedelta(seconds=1)).isoformat()}]
            with tempfile.TemporaryDirectory() as tmp:
                store = a.Store(Path(tmp)/'state')
                try:
                    active = store.claim([parent], SINCE, [bound] if bound else [])
                    bridge = a.Bridge(types.SimpleNamespace(), store)
                    with patch.object(a, 'api', side_effect=[parent, bound] if bound else [parent]), \
                            patch.object(a, 'pages', return_value=ignored+([bound] if bound else [])):
                        bridge.unchanged_issue(active)
                finally:
                    os.close(store.lock)

    def test_runtime_quota_preserves_claim(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = a.Store(Path(tmp)/'state')
            try:
                parent = issue()
                active = store.claim([parent], SINCE)
                before = store.path.read_bytes()
                bridge = a.Bridge(types.SimpleNamespace(), store)
                with patch.object(a, 'api', return_value=parent), \
                        patch.object(a, 'pages', side_effect=a.QuotaWait()), self.assertRaises(a.QuotaWait):
                    bridge.unchanged_issue(active)
                self.assertEqual(store.path.read_bytes(), before)
            finally:
                os.close(store.lock)

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
                with patch.object(a, 'api', side_effect=[parent, comment]) as read, \
                        patch.object(a, 'pages', return_value=[comment]):
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

NEW = 'd' * 40


def resume_comment(active, **over):
    body = dict(schema=a.RESUME_MARKER, issue=active['issue'], head=active['head'],
                attempt=active['attempt'], mode='ci_fix', note='lint: console is not defined')
    body.update(over.pop('body', {}))
    stamp = NOW.isoformat()
    comment = dict(id=777, issue_url=f'https://api.github.com/repos/{a.REPO}/issues/{active["issue"]}',
                   user={'id': 318610566}, created_at=stamp, updated_at=stamp,
                   body=a.RESUME_MARKER + '\n' + json.dumps(body))
    return comment | over


class Resume(unittest.TestCase):
    """RESUME_V1: blocked(CI FAIL) -> one more author attempt; never resets counters/history."""

    def setup_store(self, tmp, attempt=2, max_attempts=3, **blocked):
        store = a.Store(Path(tmp) / 'state')
        active = store.claim([issue()], SINCE)
        active['task']['max_attempts'] = max_attempts
        active['task']['allowed_paths'] = ['apps/web/test/**']
        qa = dict(verdict='PASS', findings=[], reviewed_sha=HEAD)
        store.phase('blocked', head=HEAD, base=BASE, pr=70, attempt=attempt, qa=qa, ci={'sha': None},
                    resume_phase=blocked.get('resume_phase', 'ci'),
                    reason=blocked.get('reason', 'Actions failed'))
        a.atomic(store.directory / f'qa-30-a{attempt}.json', qa)
        return store, active

    def bridge(self, tmp, store, remote=BASE, comments=(), failure=None, git_log=None):
        bridge = a.Bridge(types.SimpleNamespace(
            worktrees_root=Path(tmp), state_dir=store.directory, known_hosts=Path('/x')), store)
        bridge.unchanged_issue = lambda x: None
        bridge.clean = lambda sha: None
        bridge.remote_dev = lambda: remote
        bridge.failed_ci = lambda x: failure or dict(run=5, run_attempt=1, failed=[
            dict(job='source (web)', steps=['Run pnpm --filter @gobadminton/web run lint'])])
        head = [HEAD]
        log = git_log if git_log is not None else []

        def git(*args, **kw):
            log.append(args)
            if args[0] == 'ls-remote':
                return f'{HEAD}\trefs/heads/automation/issue-30'
            if args[0] == 'rev-parse':
                return head[0]
            if args[0] == 'diff':
                return 'apps/web/test/x.mjs\0' if args[1] == '--name-only' else ''
            if args[0] == 'ls-files':
                return ''
            if 'commit' in args and args[0] == '-c':
                head[0] = NEW
            return ''
        bridge.git = git
        bridge.prompts = []
        bridge.model = lambda prompt, qa=False: bridge.prompts.append(prompt)
        self.comments = list(comments)
        return bridge

    def run_resume(self, tmp, store, active, bridge):
        with patch.object(a, 'pages', side_effect=lambda path, key=None: self.comments), \
                patch.object(a, 'run', return_value=''):
            return bridge.resume(active)

    def test_validate_resume_accepts_exact_owner_marker_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            store, active = self.setup_store(tmp)
            try:
                good = resume_comment(active)
                self.assertEqual(a.validate_resume(active, good, SINCE)['mode'], 'ci_fix')
                bad = [
                    resume_comment(active, user={'id': 1}),
                    resume_comment(active, updated_at=(NOW + dt.timedelta(seconds=1)).isoformat()),
                    resume_comment(active, issue_url=f'https://api.github.com/repos/{a.REPO}/issues/31'),
                    resume_comment(active, body=dict(head=DRIFT)),
                    resume_comment(active, body=dict(attempt=1)),
                    resume_comment(active, body=dict(attempt=True)),
                    resume_comment(active, body=dict(issue=31)),
                    resume_comment(active, body=dict(mode='any')),
                    resume_comment(active, body=dict(note='x' * 2001)),
                    resume_comment(active, body=dict(extra=1)),
                    resume_comment(active, created_at=(SINCE - dt.timedelta(hours=1)).isoformat(),
                                   updated_at=(SINCE - dt.timedelta(hours=1)).isoformat()),
                    resume_comment(active, body=dict(), id=0),
                    resume_comment(active) | {'body': 'x' + resume_comment(active)['body']},
                    resume_comment(active) | {'body': resume_comment(active)['body'].replace('V1\n', 'V1 \n', 1)},
                    resume_comment(active) | {'body': a.MARKER + '\n' + json.dumps(active['task'])},
                ]
                for comment in bad:
                    with self.subTest(comment=comment['body'][:80]), self.assertRaises(a.Hold):
                        a.validate_resume(active, comment, SINCE)
                active['resumes'] = [777]
                with self.assertRaises(a.Hold):
                    a.validate_resume(active, good, SINCE)
            finally:
                os.close(store.lock)

    def test_only_ci_failed_blocks_with_unspent_attempt_are_eligible(self):
        with tempfile.TemporaryDirectory() as tmp:
            store, active = self.setup_store(tmp)
            try:
                self.assertTrue(a.resume_eligible(active))
                for change in (dict(attempt=3), dict(reason='QA FAIL; attempts exhausted'),
                               dict(resume_phase='qa'), dict(phase='ci'), dict(head=None)):
                    with self.subTest(change=change):
                        self.assertFalse(a.resume_eligible(copy.deepcopy(active) | change))
                self.assertFalse(a.resume_eligible(None))
            finally:
                os.close(store.lock)

    def test_resume_spends_exactly_one_attempt_and_keeps_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            store, active = self.setup_store(tmp)
            try:
                log = []
                bridge = self.bridge(tmp, store, comments=[], git_log=log)
                self.comments = [resume_comment(active)]
                done_before = list(store.data['done'])
                qa_file = store.directory / 'qa-30-a2.json'
                qa_bytes = qa_file.read_bytes()
                before = copy.deepcopy(store.data)
                self.assertTrue(self.run_resume(tmp, store, active, bridge))
                data = loads_state(store)
                live = data['active']
                self.assertEqual(set(data), {'active', 'done'})
                self.assertEqual(data['done'], done_before)
                self.assertEqual((live['phase'], live['attempt'], live['head']), ('candidate', 3, NEW))
                self.assertEqual(live['base'], BASE)
                self.assertEqual(live['pr'], 70)
                self.assertEqual(live['resumes'], [777])
                self.assertEqual(live['history'][0]['attempt'], 2)
                self.assertEqual(live['history'][0]['head'], HEAD)
                self.assertEqual(live['history'][0]['qa']['verdict'], 'PASS')
                self.assertEqual(live['history'][0]['reason'], 'Actions failed')
                self.assertEqual(live['ci_failure']['failed'][0]['job'], 'source (web)')
                self.assertFalse(a.resume_eligible(live))
                self.assertEqual(qa_file.read_bytes(), qa_bytes)
                backup = json.loads((store.directory / 'before-resume-30-a2.json').read_text())
                self.assertEqual(backup, before)
                self.assertIn('lint: console is not defined', bridge.prompts[0])
                self.assertIn('do not weaken', bridge.prompts[0])
                self.assertFalse([c for c in log if c[0] == 'push'])  # push belongs to execute()
                self.assertFalse([c for c in log if '--force' in c or 'rebase' in c or 'merge' in c])
                # Same comment can never be used twice, and attempt binding changed anyway.
                with self.assertRaises(a.Hold):
                    a.validate_resume(live | {'phase': 'blocked', 'resume_phase': 'ci',
                                             'reason': 'Actions failed'}, self.comments[0], SINCE)
            finally:
                os.close(store.lock)

    def test_exhausted_attempts_wrong_state_or_no_comment_change_nothing(self):
        cases = [dict(attempt=3), dict(reason='Actions failed ')]
        for options in cases:
            with tempfile.TemporaryDirectory() as tmp:
                store, active = self.setup_store(tmp, **{k: v for k, v in options.items() if k != 'attempt'},
                                                 **({'attempt': options['attempt']} if 'attempt' in options else {}))
                try:
                    bridge = self.bridge(tmp, store)
                    self.comments = [resume_comment(active)]
                    before = copy.deepcopy(store.data)
                    with patch.object(a, 'pages', side_effect=AssertionError('no request expected')):
                        self.assertFalse(bridge.resume(active))
                    self.assertEqual(store.data, before)
                finally:
                    os.close(store.lock)
        with tempfile.TemporaryDirectory() as tmp:
            store, active = self.setup_store(tmp)
            try:
                bridge = self.bridge(tmp, store)
                before = copy.deepcopy(store.data)
                self.assertFalse(self.run_resume(tmp, store, active, bridge))
                self.assertEqual(store.data, before)
                self.assertFalse((store.directory / 'before-resume-30-a2.json').exists())
            finally:
                os.close(store.lock)

    def test_ambiguity_drift_and_non_failure_refuse_without_state_change(self):
        for mode in ('ambiguous', 'drift', 'ci'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                store, active = self.setup_store(tmp)
                try:
                    bridge = self.bridge(tmp, store, remote=DRIFT if mode == 'drift' else BASE)
                    self.comments = [resume_comment(active)]
                    if mode == 'ambiguous':
                        self.comments.append(resume_comment(active, id=778))
                    if mode == 'ci':
                        bridge.failed_ci = lambda x: a.require(False, 'exact-head Actions run is not a completed failure')
                    before = copy.deepcopy(store.data)
                    with self.assertRaises(a.Hold):
                        self.run_resume(tmp, store, active, bridge)
                    self.assertEqual(store.data, before)
                    self.assertEqual(active['phase'], 'blocked')
                    self.assertEqual(active['attempt'], 2)
                finally:
                    os.close(store.lock)

    def test_failed_ci_reads_only_exact_head_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            store, active = self.setup_store(tmp)
            try:
                bridge = a.Bridge(types.SimpleNamespace(worktrees_root=Path(tmp), state_dir=store.directory), store)
                run = dict(id=9, run_attempt=2, name='Product CI', head_sha=HEAD, head_branch='automation/issue-30',
                           event='push', status='completed', conclusion='failure')
                jobs = [dict(name='source (web)', conclusion='failure', steps=[
                    dict(name='lint', conclusion='failure'), dict(name='ok', conclusion='success')]),
                    dict(name='foundation', conclusion='success', steps=[])]

                def fake(runs):
                    return lambda path, key=None: runs if key == 'workflow_runs' else jobs
                with patch.object(a, 'pages', side_effect=fake([run])):
                    result = bridge.failed_ci(active)
                self.assertEqual(result, dict(run=9, run_attempt=2, failed=[dict(job='source (web)', steps=['lint'])]))
                for runs in ([], [run | {'head_sha': DRIFT}], [run | {'conclusion': 'success'}],
                             [run | {'status': 'in_progress', 'conclusion': None}],
                             [run | {'conclusion': 'cancelled'}], [run | {'head_branch': 'dev'}]):
                    with self.subTest(runs=runs), patch.object(a, 'pages', side_effect=fake(runs)), \
                            self.assertRaises(a.Hold):
                        bridge.failed_ci(active)
            finally:
                os.close(store.lock)

    def test_resume_comment_is_not_a_competing_authorization(self):
        with tempfile.TemporaryDirectory() as tmp:
            store, active = self.setup_store(tmp)
            try:
                bridge = a.Bridge(types.SimpleNamespace(worktrees_root=Path(tmp), state_dir=store.directory), store)
                parent = issue()
                active['fingerprint'] = a.fingerprint(parent)
                comments = [resume_comment(active)]

                def fake_api(path):
                    return parent
                with patch.object(a, 'api', side_effect=fake_api), patch.object(a, 'pages', return_value=comments):
                    bridge.unchanged_issue(active)
            finally:
                os.close(store.lock)

    def test_blocked_without_marker_never_claims_other_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            store, active = self.setup_store(tmp)
            try:
                self.assertEqual(store.claim([issue(31)], SINCE)['issue'], 30)
                self.assertEqual(store.data['active']['phase'], 'blocked')
            finally:
                os.close(store.lock)


def loads_state(store):
    return json.loads(store.path.read_text())



def park_comment(active, **over):
    body = dict(schema=a.PARK_MARKER, issue=active['issue'], head=active['head'],
                attempt=active['attempt'], reason='QA FAIL x3; Owner chose successor',
                allow_successors=[31])
    body.update(over.pop('body', {}))
    stamp = NOW.isoformat()
    comment = dict(id=888, issue_url=f'https://api.github.com/repos/{a.REPO}/issues/{active["issue"]}',
                   user={'id': 318610566}, created_at=stamp, updated_at=stamp,
                   body=a.PARK_MARKER + '\n' + json.dumps(body))
    return comment | over


class Park(unittest.TestCase):
    """PARK_V1: Owner-authorised parking of a truly blocked task; parked != done."""

    def setup_store(self, tmp, attempt=3, **blocked):
        store = a.Store(Path(tmp) / 'state')
        active = store.claim([issue()], SINCE)
        active['task']['max_attempts'] = 3
        qa = dict(verdict='FAIL', findings=['x'], reviewed_sha=HEAD)
        store.phase('blocked', head=HEAD, base=BASE, pr=74, attempt=attempt, qa=qa, ci=None,
                    history=[dict(attempt=1, head=DRIFT)], resumes=[5],
                    resume_phase=blocked.get('resume_phase', 'qa'),
                    reason=blocked.get('reason', 'QA FAIL; attempts exhausted'))
        a.atomic(store.directory / f'qa-30-a{attempt}.json', qa)
        return store, active

    def bridge(self, tmp, store, comments):
        bridge = a.Bridge(types.SimpleNamespace(
            worktrees_root=Path(tmp), state_dir=store.directory), store)
        bridge.unchanged_issue = lambda x: None
        self.comments = comments
        return bridge

    def do_park(self, bridge, active):
        stamp = (NOW - dt.timedelta(days=1)).isoformat()

        def fake_api(path):
            return dict(created_at=stamp)
        with patch.object(a, 'pages', side_effect=lambda path, key=None: self.comments), \
                patch.object(a, 'api', side_effect=fake_api):
            return bridge.park(active)

    def test_validate_park_exact_owner_marker_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            store, active = self.setup_store(tmp)
            try:
                good = park_comment(active)
                self.assertEqual(a.validate_park(active, good, SINCE)['allow_successors'], [31])
                old = (SINCE - dt.timedelta(hours=1)).isoformat()
                bad = [
                    park_comment(active, user={'id': 1}),
                    park_comment(active, updated_at=(NOW + dt.timedelta(seconds=1)).isoformat()),
                    park_comment(active, issue_url=f'https://api.github.com/repos/{a.REPO}/issues/31'),
                    park_comment(active, body=dict(head=DRIFT)),
                    park_comment(active, body=dict(attempt=2)),
                    park_comment(active, body=dict(attempt=True)),
                    park_comment(active, body=dict(issue=31)),
                    park_comment(active, body=dict(schema='X')),
                    park_comment(active, body=dict(reason='')),
                    park_comment(active, body=dict(reason='x' * 501)),
                    park_comment(active, body=dict(allow_successors=[1, 2, 3, 4])),
                    park_comment(active, body=dict(allow_successors=[31, 31])),
                    park_comment(active, body=dict(allow_successors=[30])),
                    park_comment(active, body=dict(allow_successors=[True])),
                    park_comment(active, body=dict(allow_successors='31')),
                    park_comment(active, body=dict(extra=1)),
                    park_comment(active, created_at=old, updated_at=old),
                    park_comment(active, id=0),
                    park_comment(active) | {'body': 'x' + park_comment(active)['body']},
                    park_comment(active) | {'body': a.MARKER + '\n' + json.dumps(active['task'])},
                    park_comment(active) | {'body': park_comment(active)['body'].replace(a.PARK_MARKER, a.RESUME_MARKER, 1)},
                ]
                for comment in bad:
                    with self.subTest(comment=comment['body'][:90]), self.assertRaises(a.Hold):
                        a.validate_park(active, comment, SINCE)
                with self.assertRaises(a.Hold):
                    a.validate_park(active, good, SINCE, used={888})
                for change in (dict(phase='ci'), dict(phase='developing'), dict(head=None)):
                    with self.subTest(change=change), self.assertRaises(a.Hold):
                        a.validate_park(copy.deepcopy(active) | change, good, SINCE)
                resumable = copy.deepcopy(active) | dict(attempt=2, resume_phase='ci', reason='Actions failed')
                with self.assertRaises(a.Hold):
                    a.validate_park(resumable, park_comment(resumable), SINCE)
            finally:
                os.close(store.lock)

    def test_park_preserves_everything_and_is_not_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            store, active = self.setup_store(tmp)
            try:
                bridge = self.bridge(tmp, store, [park_comment(active)])
                before = copy.deepcopy(store.data)
                qa_file = store.directory / 'qa-30-a3.json'
                qa_bytes = qa_file.read_bytes()
                self.assertTrue(self.do_park(bridge, active))
                state = json.loads(store.path.read_text())
                self.assertEqual(set(state), {'active', 'done'})
                self.assertIsNone(state['active'])
                self.assertEqual(state['done'], before['done'])
                self.assertNotIn(30, state['done'])
                parked = json.loads(store.parked_path.read_text())
                self.assertEqual(set(parked), {'parked'})
                entry, = parked['parked']
                self.assertEqual(entry['snapshot'], before['active'])
                self.assertEqual((entry['issue'], entry['attempt'], entry['head']), (30, 3, HEAD))
                self.assertEqual(entry['snapshot']['history'], [dict(attempt=1, head=DRIFT)])
                self.assertEqual(entry['snapshot']['qa']['verdict'], 'FAIL')
                self.assertEqual(entry['allow_successors'], [31])
                self.assertEqual(entry['park_comment'], 888)
                self.assertEqual(json.loads((store.directory / 'before-park-30-a3.json').read_text()), before)
                self.assertEqual(qa_file.read_bytes(), qa_bytes)
                self.assertEqual(stat_mode(store.parked_path), 0o600)
                # Restart sees the same parked set; replay of the comment is ignored.
                os.close(store.lock)
                again = a.Store(Path(tmp) / 'state')
                try:
                    self.assertEqual(again.parked, [entry])
                    with self.assertRaises(a.Hold):
                        a.validate_park(entry['snapshot'], park_comment(entry['snapshot']), SINCE,
                                        used={e['park_comment'] for e in again.parked})
                finally:
                    os.close(again.lock)
                    store.lock = os.open(Path(tmp) / 'state' / 'worker.lock', os.O_RDWR)
            finally:
                os.close(store.lock)

    def test_negative_cases_change_nothing(self):
        cases = {'wrong author': park_comment, 'edited': park_comment, 'wrong head': park_comment,
                 'wrong attempt': park_comment, 'two comments': park_comment}
        overrides = {'wrong author': dict(user={'id': 2}),
                     'edited': dict(updated_at=(NOW + dt.timedelta(minutes=1)).isoformat()),
                     'wrong head': dict(body=dict(head=DRIFT)),
                     'wrong attempt': dict(body=dict(attempt=2))}
        for name in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                store, active = self.setup_store(tmp)
                try:
                    comments = [park_comment(active, **copy.deepcopy(overrides.get(name, {})))]
                    if name == 'two comments':
                        comments.append(park_comment(active, id=889))
                    bridge = self.bridge(tmp, store, comments)
                    before = copy.deepcopy(store.data)
                    try:
                        self.assertFalse(self.do_park(bridge, active))
                    except a.Hold:
                        self.assertEqual(name, 'two comments')
                    self.assertEqual(store.data, before)
                    self.assertFalse(store.parked_path.exists())
                    self.assertFalse((store.directory / 'before-park-30-a3.json').exists())
                finally:
                    os.close(store.lock)

    def test_not_blocked_resumable_or_no_comment_do_not_park(self):
        with tempfile.TemporaryDirectory() as tmp:
            store, active = self.setup_store(tmp, attempt=2, resume_phase='ci', reason='Actions failed')
            try:
                bridge = self.bridge(tmp, store, [park_comment(active)])
                with patch.object(a, 'pages', side_effect=AssertionError('no request expected')):
                    self.assertFalse(bridge.park(active))  # resumable: RESUME only
                self.assertEqual(store.data['active']['phase'], 'blocked')
            finally:
                os.close(store.lock)
        with tempfile.TemporaryDirectory() as tmp:
            store, active = self.setup_store(tmp)
            try:
                active['phase'] = 'ci'
                bridge = self.bridge(tmp, store, [])
                with patch.object(a, 'pages', side_effect=AssertionError('no request expected')):
                    self.assertFalse(bridge.park(active))
                active['phase'] = 'blocked'
                self.assertFalse(self.do_park(bridge, active))  # blocked without marker only waits
                self.assertEqual(store.data['active']['phase'], 'blocked')
                self.assertFalse(store.parked_path.exists())
            finally:
                os.close(store.lock)

    def test_parked_issue_is_never_reclaimed_and_dependents_wait(self):
        with tempfile.TemporaryDirectory() as tmp:
            store, active = self.setup_store(tmp)
            try:
                bridge = self.bridge(tmp, store, [park_comment(active)])
                parent, comment = existing(30)
                self.assertTrue(self.do_park(bridge, active))
                entry = store.parked[0]
                # Old admission comment of the parked Issue must not re-claim it.
                self.assertIsNone(store.claim([parent], SINCE, [comment]))
                self.assertIsNone(store.claim([issue(30)], SINCE))
                # Later Issues (dependents) wait unless listed in allow_successors.
                entry['authorized_at'] = (NOW - dt.timedelta(minutes=30)).isoformat()
                later = issue(31)
                later['created_at'] = later['updated_at'] = NOW.isoformat()
                later['body'] = a.MARKER + '\n' + json.dumps(dict(json.loads(later['body'].split('\n', 1)[1])))
                entry['allow_successors'] = []
                self.assertIsNone(store.claim([later], SINCE))
                entry['allow_successors'] = [31]
                claimed = store.claim([later], SINCE)
                self.assertEqual(claimed['issue'], 31)
                self.assertEqual(claimed['phase'], 'claimed')
                self.assertNotIn(30, store.data['done'])
            finally:
                os.close(store.lock)

    def test_issue_authorized_before_parked_task_is_not_blocked_by_barrier(self):
        with tempfile.TemporaryDirectory() as tmp:
            store, active = self.setup_store(tmp)
            try:
                self.assertTrue(self.do_park(self.bridge(tmp, store, [park_comment(active)]), active))
                store.parked[0]['authorized_at'] = (NOW + dt.timedelta(hours=1)).isoformat()
                store.parked[0]['allow_successors'] = []
                self.assertEqual(store.claim([issue(31)], SINCE)['issue'], 31)
            finally:
                os.close(store.lock)

    def test_crash_between_parked_file_and_state_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            store, active = self.setup_store(tmp)
            try:
                bridge = self.bridge(tmp, store, [park_comment(active)])
                original = store.save
                calls = []

                def crash():
                    calls.append(1)
                    raise OSError('simulated crash before state save')
                store.save = crash
                with self.assertRaises(OSError):
                    self.do_park(bridge, active)
                self.assertEqual(len(store.parked), 1)
                self.assertEqual(json.loads(store.path.read_text())['active']['phase'], 'blocked')
                store.save = original
                store.data['active'] = json.loads(store.path.read_text())['active']
                active = store.data['active']
                bridge = self.bridge(tmp, store, [park_comment(active)])
                self.assertTrue(self.do_park(bridge, active))
                self.assertEqual(len(store.parked), 1)
                self.assertIsNone(json.loads(store.path.read_text())['active'])
                self.assertEqual(len(json.loads(store.parked_path.read_text())['parked']), 1)
            finally:
                os.close(store.lock)

    def test_invalid_parked_file_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / 'state'
            store = a.Store(directory)
            os.close(store.lock)
            for raw in ('{"parked": 1}', '{"parked": [], "x": 1}', '{"parked": [{"issue": "1"}]}'):
                (directory / 'parked.json').write_text(raw)
                with self.subTest(raw=raw), self.assertRaises(a.Hold):
                    a.Store(directory)


def stat_mode(path):
    return os.stat(path).st_mode & 0o777


if __name__ == '__main__':
    unittest.main()

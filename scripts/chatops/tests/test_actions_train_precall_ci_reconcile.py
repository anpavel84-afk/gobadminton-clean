"""Offline actual-C5 proof and synthetic Store/Git transaction; no live access.

Pinned public blobs come only from the existing Git DB (CI receiver fetches full
history). No fetch/clone, provider, API, root identity or installed module runs.
Run locally with GB_PRECALL_TEST_SCRATCH set to the authorized evidence scratch.
Missing exact public source is a test error, never a skipped mandatory proof.
"""
import ast
import base64
import contextlib
import copy
import fcntl
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'scripts/chatops/ops/precall_ci_reconcile.py'
spec = importlib.util.spec_from_file_location('precall_ci_source_tests', SOURCE)
U = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = U
spec.loader.exec_module(U)
C5 = U.CONTROLLER
BASE = '0e279c6f826cbb9ceb4ba35d928797b01ffce0de'
# Exact public historical snapshot; test data, never live clearance.
ACTUAL_OPERATION = {'after': '092421c94b137a6713888ec85b09f16af4b8a83efdc467ca02f629c83df1eec2',
 'before': '092421c94b137a6713888ec85b09f16af4b8a83efdc467ca02f629c83df1eec2',
 'binding': {'action': 'train',
             'attempt': 1,
             'generation': 113,
             'head': '8024caa659f4fee911d7e3afcb69ed7ac845ce5c',
             'issue': 346,
             'phase': 'pr_wait',
             'profile': 'auto',
             'slot': 'slot1',
             'stage': 'author'},
 'checkpoint_before': {'active': {'approved_since': '2026-10-15T02:27:00+00:00',
                                  'attempt': 1,
                                  'base': '5878d8d9a99505f0d5636f134dea3f18d5006a89',
                                  'ci': None,
                                  'ci_failure': None,
                                  'deterministic_failure': {'failed': [{'job': 'receiver',
                                                                        'steps': ['Run find '
                                                                                  'scripts/chatops '
                                                                                  "-name '*.sh' "
                                                                                  '-exec bash -n '
                                                                                  '{} +']}],
                                                            'head': '8024caa659f4fee911d7e3afcb69ed7ac845ce5c',
                                                            'run': 40460196440,
                                                            'run_attempt': 1},
                                  'fingerprint': 'e468e74753cf13776a1ae44fb2a793513faf11c9d34e1be21744b1b1afce6523',
                                  'head': '8024caa659f4fee911d7e3afcb69ed7ac845ce5c',
                                  'independent_qa_pending': True,
                                  'issue': 346,
                                  'phase': 'pr_wait',
                                  'pr': 348,
                                  'qa': None,
                                  'qa_equivalence': None,
                                  'qa_origin': None,
                                  'run': None,
                                  'task': {'acceptance': 'Exactly the Owner probe module '
                                                         'introduced by Issue345 is deleted and '
                                                         'every other path unchanged. Offline '
                                                         'source deletion checks pass; fresh '
                                                         'independent qualified Codex SOURCE QA, '
                                                         'mandatory Product CI7/7, trusted '
                                                         'integration and actual DEV server '
                                                         'ACCEPTED. DEV public probe URL returns '
                                                         'baseline404 after release. Task status '
                                                         'becomes DONE through existing Train; no '
                                                         'manual status/attempt/receipt reset and '
                                                         'no PROD or user-data changes.\n'
                                                         '<!-- GB_TEST_PLAN_V1 -->\n'
                                                         '{"evidence_rule":"NOT_TESTED/ENV_ERROR '
                                                         'never counts as '
                                                         'PASS","groups":["foundation","chatops_receiver_actions_train","chatops_phase","ci_source_api","ci_source_web","ci_source_admin","ci_source_contracts","ci_database","ci_receiver"],"needs_independent_qa":true,"rerun_policy":"same '
                                                         'fingerprint: no rerun without reason '
                                                         'code","risk":"critical","tier":"T3","visual_qa":false}\n'
                                                         '<!-- /GB_TEST_PLAN_V1 -->',
                                           'allowed_paths': ['apps/web/public/owner-train-smoke-20261027.mjs'],
                                           'author_routes': ['cursor:auto'],
                                           'depends_on': [345],
                                           'failure_diagnosis': {'max_calls': 1,
                                                                 'route': 'codex:gpt-6-astra:high',
                                                                 'schema': 'GB_FAILURE_DIAGNOSIS_218_V1'},
                                           'goal': 'Owner-authorized minimal reversible DEV E2E '
                                                   'probe, part2 of2, automatically eligible only '
                                                   'after Issue345 is DONE/serverDEVACCEPTED. '
                                                   'Remove exactly '
                                                   'apps/web/public/owner-train-smoke-20261027.mjs '
                                                   'introduced by345; no other changes. This '
                                                   'restores the original public URL absence. Do '
                                                   'not recreate the module or touch other public '
                                                   'assets, configuration, rules, branches, '
                                                   'services, user data or PROD. Existing trusted '
                                                   'publisher handles Git. Source '
                                                   'self-check/independent QA: inspect exact '
                                                   'deletion diff against claimed accepted base, '
                                                   'verify this sole path is absent using Python '
                                                   'standard library; no packages, pnpm/npm or '
                                                   'network needed. Source QA must not require '
                                                   'future deployment evidence. Normal mandatory '
                                                   'Product CI7/7, guarded DEV release and '
                                                   'serverACCEPTED are later mandatory gates. '
                                                   'Integrator observes the DEV probe URL back at '
                                                   'its original HTTP404 after cleanup. Exactly '
                                                   'one Cursor Auto author invocation, no '
                                                   'fallback. Preserve all task histories, '
                                                   'UNKNOWNs and budgets. Successful automatic '
                                                   'claim after345 demonstrates baseline '
                                                   'continuation; do not claim completion of '
                                                   'remaining Master Plan stages.',
                                           'kind': 'source_only',
                                           'locks': ['web:owner-train-probe'],
                                           'max_attempts': 1,
                                           'qa_routes': ['codex:gpt-6.1-sol:medium'],
                                           'risk': 'routine',
                                           'routing_policy': {'author': {'complexity': 'standard',
                                                                         'evidence': 'Exact '
                                                                                     'cleanup of '
                                                                                     'one isolated '
                                                                                     'Owner probe '
                                                                                     'after its '
                                                                                     'accepted DEV '
                                                                                     'task, no '
                                                                                     'source '
                                                                                     'refactor, '
                                                                                     'credentials '
                                                                                     'or '
                                                                                     'privileged '
                                                                                     'action.',
                                                                         'reason': 'standard_ui'},
                                                              'qa': {'complexity': 'standard',
                                                                     'evidence': 'Independent '
                                                                                 'exact deletion '
                                                                                 'review and '
                                                                                 'standard-library '
                                                                                 'file absence '
                                                                                 'checks, no local '
                                                                                 'dependencies '
                                                                                 'required.',
                                                                     'reason': 'standard_ui'},
                                                              'schema': 'GB_STAGE_COST_V2'},
                                           'schema': 'GOBADMINTON_AUTONOMY_V1',
                                           'target': 'dev',
                                           'work_kind': 'test'}},
                       'done': [30,
                                31,
                                13,
                                15,
                                36,
                                37,
                                46,
                                12,
                                28,
                                47,
                                52,
                                54,
                                57,
                                61,
                                62,
                                64,
                                66,
                                78,
                                82,
                                84,
                                92,
                                98,
                                101,
                                104,
                                106,
                                108,
                                109,
                                112,
                                114,
                                131,
                                133,
                                138,
                                142,
                                147,
                                151,
                                157,
                                178,
                                203,
                                313,
                                345]},
 'finished_at': 1793082481,
 'process': {'boot': '447e18ce-024d-4230-b88f-bd8ca81e2a9e', 'pid': 1850973, 'start': '73634252'},
 'read_attempts': 1,
 'record': {'allowed_paths': ['apps/web/public/owner-train-smoke-20261027.mjs'],
            'depends_on': [345],
            'issue': 346,
            'locks': ['web:owner-train-probe']},
 'result': {'checkpoint': {'attempt': 1,
                           'ci': {'id': None, 'sha': None},
                           'ci_failure': None,
                           'head': '8024caa659f4fee911d7e3afcb69ed7ac845ce5c',
                           'issue': 346,
                           'phase': 'pr_wait',
                           'pr': 348,
                           'qa': {'reviewed_sha': None, 'verdict': None},
                           'release_id': None},
            'reason': 'attempts exhausted',
            'safe_release': False,
            'status': 'unknown'},
 'run': 40461245083,
 'run_attempt': 1,
 'started_at': 1793082478,
 'task_hash': '0a869c27e233f81c851016c99b3a53a052a0b43dcd9067bca3b02e4e528d6dae'}


def git(repo, *args):
    env = dict(PATH='/usr/bin:/bin', HOME='/nonexistent', LANG='C.UTF-8',
               GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_SYSTEM='/dev/null',
               GIT_CONFIG_NOSYSTEM='1', GIT_TERMINAL_PROMPT='0', GIT_NO_LAZY_FETCH='1',
               GIT_NO_REPLACE_OBJECTS='1', GIT_OPTIONAL_LOCKS='0')
    return subprocess.run(['/usr/bin/git', '--no-optional-locks', '-c', 'gc.auto=0',
                           '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null',
                           '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never',
                           '-C', str(repo), *args], env=env, check=True,
                          capture_output=True, timeout=20).stdout


def put(path, raw, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_bytes(raw)
    path.chmod(mode)


def journal_for(op):
    return dict(confirmed={'old': 'preserved'}, deferred=[], generation=op['binding']['generation'],
                last=copy.deepcopy(op['result']), operations={U.digest(op['binding']): copy.deepcopy(op)},
                pending=U.digest(op['binding']), profiles={'auto': {'count': 1}},
                stage_counts={'author': 1})


def rebind(op, cp):
    op['checkpoint_before'] = copy.deepcopy(cp)
    op['before'] = op['after'] = U.digest(cp)
    op['task_hash'] = U.digest(cp['active']['task'])
    for k in ('head', 'phase', 'issue', 'attempt'):
        op['binding'][k] = op['result']['checkpoint'][k] = cp['active'][k]
    op['result']['checkpoint']['pr'] = cp['active']['pr']
    return journal_for(op)


def ci_for(cp):
    a = cp['active']
    run = dict(id=a['deterministic_failure']['run'] + 100, run_attempt=1,
               head_sha=a['head'], head_branch=f'automation/issue-{a["issue"]}',
               repository={'id': U.REPO_ID}, head_repository={'id': U.REPO_ID},
               path='.github/workflows/ci.yml', event='push', name='Product CI',
               status='completed', conclusion='success')
    jobs, checks = [], []
    for i, name in enumerate(sorted(U.CI_JOBS), 1):
        jid, cid = 100 + i, 200 + i
        jobs.append(dict(id=jid, check_run_id=cid, name=name, head_sha=a['head'], run_id=run['id'],
                         run_attempt=run['run_attempt'], status='completed', conclusion='success',
                         steps=[dict(name=n, number=j, status='completed', conclusion='success')
                                for j, n in enumerate(sorted(U.REQUIRED_STEPS[name]), 1)]))
        checks.append(dict(id=cid, name=name, head_sha=a['head'], status='completed',
                           conclusion='success', app={'slug': 'github-actions'},
                           details_url=f'https://github.com/{U.REPO}/actions/runs/{run["id"]}/job/{jid}'))
    return dict(schema='GB_PRECALL_PRODUCT_CI_READS_V1', current=copy.deepcopy(run),
                attempt_run=run, runs=[copy.deepcopy(run)], total_count=1, jobs=jobs, checks=checks,
                workflow_revision=a['head'])


class FakeHTTP:
    """Actual API JSON shapes through the production bounded GET parser."""
    def __init__(self, proof, workflow):
        p = proof
        run = p['current']
        self.responses = {
            '': dict(id=U.REPO_ID, full_name=U.REPO, default_branch='main'),
            'actions/workflows/ci.yml/runs?head_sha=' + run['head_sha'] + '&per_page=20&page=1':
                dict(total_count=len(p['runs']), workflow_runs=p['runs']),
            f'actions/runs/{run["id"]}': p['current'],
            f'actions/runs/{run["id"]}/attempts/{run["run_attempt"]}': p['attempt_run'],
            'contents/.github/workflows/ci.yml?ref=' + run['head_sha']:
                dict(path='.github/workflows/ci.yml', encoding='base64', sha=U.blob_oid(workflow),
                     content=base64.b64encode(workflow).decode()),
        }
        jobs = copy.deepcopy(p['jobs'])
        for job in jobs:
            cid = job.pop('check_run_id')
            job['check_run_url'] = f'https://api.github.com/repos/{U.REPO}/check-runs/{cid}'
        self.jobs_endpoint = f'actions/runs/{run["id"]}/attempts/{run["run_attempt"]}/jobs?per_page=100&page=1'
        self.responses[self.jobs_endpoint] = dict(total_count=len(jobs), jobs=jobs)
        self.responses.update({f'check-runs/{c["id"]}': c for c in p['checks']})
        self.seen, self.mutate = [], None

    def open(self, request, timeout):
        self.assert_request(request, timeout)
        prefix = 'https://api.github.com/repos/' + U.REPO + '/'
        endpoint = request.full_url.removeprefix(prefix)
        self.seen.append(endpoint)
        if self.mutate:
            self.mutate(endpoint)
        return contextlib.closing(io.BytesIO(U.encode(self.responses[endpoint])))

    @staticmethod
    def assert_request(request, timeout):
        assert request.get_method() == 'GET'
        assert not request.has_header('Authorization')
        assert 0 < timeout <= 15
        assert request.full_url.startswith('https://api.github.com/repos/' + U.REPO + '/')

    def client(self):
        api = U.GitHubReads()
        api.open = self.open
        return api


class SourceFixture:
    """Materialize the FULL actual pinned C5 source, including mixed revisions."""
    def __init__(self, parent):
        self.path = Path(parent) / 'runtime'
        self.path.mkdir(mode=0o700)
        for name, (pin, size) in U.PROFILE.items():
            revision, path = C5, 'scripts/chatops/actions_train/' + name
            if name == 'accepted-engineering-rules.md':
                revision = 'bc8bad0c38a861f8e72296d0a323e2941b9322e0'
                path = 'docs/rules/ENGINEERING_OPERATING_MODEL.md'
            elif name == 'native_antigravity.py':
                revision = 'bf717cff53181e97fc1095be2f5717ab7d149217'
            elif name in ('antigravity_qa_recovery.py', 'owner_package_admission.py'):
                revision = BASE
            raw = git(ROOT, 'show', revision + ':' + path)
            if U.sha(raw) != pin or len(raw) != size:
                raise AssertionError('historical full source does not match actual snapshot: ' + name)
            put(self.path / name, raw, 0o644)
        U.runtime_profile(self.path, owner=os.getuid())

    def load(self, name, file):
        s = importlib.util.spec_from_file_location(name, self.path / file)
        module = importlib.util.module_from_spec(s)
        sys.modules[name] = module
        s.loader.exec_module(module)
        return module


class Fixture:
    def __init__(self, parent, sources):
        self.temp = tempfile.TemporaryDirectory(dir=parent, prefix='transaction-')
        self.root = Path(self.temp.name)
        self.root.chmod(0o700)
        self.sources = sources
        self.cp = copy.deepcopy(ACTUAL_OPERATION['checkpoint_before'])
        self.op = copy.deepcopy(ACTUAL_OPERATION)
        # Real synthetic Git candidate, never the live candidate or Git DB.
        repo = self.root / 'candidate'
        repo.mkdir(mode=0o700)
        git(repo, 'init', '-q')
        put(repo / 'probe.mjs', b'export const synthetic = true;\n', 0o644)
        git(repo, 'add', 'probe.mjs')
        git(repo, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid',
            'commit', '-qm', 'synthetic base')
        base = git(repo, 'rev-parse', 'HEAD').decode().strip()
        git(repo, 'rm', 'probe.mjs')
        git(repo, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid',
            'commit', '-qm', 'synthetic deletion')
        head = git(repo, 'rev-parse', 'HEAD').decode().strip()
        a = self.cp['active']
        a['base'], a['head'] = base, head
        a['task']['allowed_paths'] = ['probe.mjs']
        a['deterministic_failure']['head'] = head
        self.op['record']['allowed_paths'] = ['probe.mjs']
        self.journal = rebind(self.op, self.cp)
        self.workflow = git(ROOT, 'show', C5 + ':.github/workflows/ci.yml')
        self.ci = ci_for(self.cp)
        self.plan = U.transition(U.encode(self.journal), U.encode(self.cp), self.ci,
                                 self.workflow, U.sha(self.workflow))
        slotdir = self.root / 'autonomy/slots/slot1'
        slotdir.mkdir(parents=True, mode=0o700)
        slotdir.chmod(0o700)
        # The actual pinned C5 Store writes/loads this fixture, without disabling
        # its real schema, owner, lock or mode checks.
        store = sources.a.Store(slotdir)
        try:
            store.data = copy.deepcopy(self.cp)
            store.save(publish=False)
        finally:
            os.close(store.lock)
        put(self.root / 'synthetic.json', U.encode({'schema': 'GB_PRECALL_SYNTHETIC_ONLY_V1'}))
        put(self.root / 'controller/slot1.json', self.plan.journal_before)
        for name, mode in (('controller/controller.lock', 0o600),
                           ('autonomy/locks/slot1.lease', 0o644),
                           ('autonomy/locks/registry.lock', 0o640)):
            put(self.root / name, U.encode(self.op['record']) if name.endswith('.lease') else b'', mode)
        # Paid unrelated UNKNOWN, grants, ledgers, policy, inventory, old hold.
        preserved = {
            'controller/slot2.json': {'generation': 119, 'pending': 'b65d8eb5101c52b26fdcf27b3468365f666836cac0c3f3021e1b76030b3cc5db',
                                      'result': {'status': 'unknown', 'paid': True}},
            'controller/grants.json': {'used': 2, 'max_calls': 2},
            'autonomy/outbox/charges.json': {'calls': [1, 2], 'unknown_usage': None},
            'controller/issue335-publication-hold.json': {'hold': 'publication unknown; no retry'},
            'policy.json': {'mode': 'active', 'controller_sha': C5, 'stage_workflow_sha256': U.STAGE_WORKFLOW},
            'controller/backup.json': {'inventory': 'synthetic immutable prior install'},
        }
        for path, value in preserved.items():
            put(self.root / path, U.encode(value))
        self.tx = U.OfflineTransaction(self.root, self.plan)
        self.initial = self.tx.manifest()
        self.preserved = self.tx.preserved()

    def close(self):
        self.temp.cleanup()

    def operator(self, boundary=None):
        return U.OfflineTransaction(self.root, self.plan, boundary)


class Reconcile(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if 'GB_PRECALL_TEST_SCRATCH' in os.environ:
            scratch = Path(os.environ['GB_PRECALL_TEST_SCRATCH'])
            scratch.mkdir(mode=0o700, parents=True, exist_ok=True)
        else:
            scratch = Path(tempfile.gettempdir())
        cls.temp = tempfile.TemporaryDirectory(dir=scratch, prefix='c5-source-')
        cls.scratch = scratch
        cls.sources = sources = SourceFixture(cls.temp.name)
        cls.core = sources.load('precall_actual_c5_core', 'core.py')
        with patch.dict(sys.modules, {'core': cls.core}):
            cls.context = sources.load('precall_actual_c5_context', 'context_policy.py')
            cls.a = sources.a = sources.load('precall_actual_c5_store', 'live/autonomous_issues.py')
            cls.stage = sources.load('precall_actual_c5_stage', 'stage.py')
            with patch.dict(sys.modules, {'context_policy': cls.context}):
                cls.diagnosis = sources.load('precall_actual_c5_diagnosis', 'failure_diagnosis.py')

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def fixture(self):
        f = Fixture(self.scratch, self.sources)
        self.addCleanup(f.close)
        return f

    def next_stage(self, active):
        with patch.dict(sys.modules, {'failure_diagnosis': self.diagnosis}):
            return self.core.next_stage(active)

    @contextlib.contextmanager
    def root_metadata_fixture(self):
        """Metadata boundary spy only; bytes/links/modes/locks remain native.

        The managed source container ships /usr/bin/git as nobody-owned. The
        production guard MUST still refuse it. No chown/root/helper call occurs.
        """
        read, trust = U.read_image, U.trusted
        def trusted(path, uid=0, gid=0, mode=None):
            if str(path) in ('/usr/bin/git', '/usr/sbin/runuser', '/usr/bin/systemctl'):
                info = Path(path).lstat()
                self.assertFalse(info.st_mode & 0o022)
                return info
            info = Path(path).lstat()
            if uid == 0 and info.st_uid == os.getuid():
                return trust(path, os.getuid(), os.getgid(), mode)
            return trust(path, uid, gid, mode)
        def image(path, owner, mode, limit=4 * 1024 * 1024):
            actual_owner = Path(path).lstat().st_uid
            substitute = owner == 0 and actual_owner == os.getuid()
            result = read(path, os.getuid() if substitute else owner, mode, limit)
            if substitute:
                identity = list(result.identity)
                identity[2:4] = [0, 0]
                return U.Image(result.raw, tuple(identity))
            return result
        with patch.object(U, 'trusted', side_effect=trusted), patch.object(U, 'read_image', side_effect=image):
            yield

    def test_actual_historical_binding_and_exact_c5_planner(self):
        op = copy.deepcopy(ACTUAL_OPERATION)
        cp = op['checkpoint_before']
        j = journal_for(op)
        c = U.classify(j, cp)
        self.assertEqual(c['operation'], '02057f1cd74e35cfaf58d67ac1f3943abfe37995cbce938033bd957d1d05fa48')
        self.assertEqual(c['operation_sha256'], '8f16ea2c95272cf6d51b0a9963acec0fd038152b6bbc3dc78f6d25d65736c093')
        self.assertEqual(self.next_stage(cp['active']), 'author')
        workflow = git(ROOT, 'show', C5 + ':.github/workflows/ci.yml')
        p = U.transition(U.encode(j), U.encode(cp), ci_for(cp), workflow, U.sha(workflow))
        result = U.loads(p.checkpoint_after)
        self.assertEqual(self.next_stage(result['active']), 'qa')
        self.assertEqual(result['done'], cp['done'])
        self.assertEqual(U.loads(p.journal_after)['operations'], j['operations'])
        h = result['active']['history'][-1]
        self.assertEqual(h['original_deterministic_failure'], cp['active']['deterministic_failure'])
        self.assertEqual(h['kind'], 'NO_AUTHOR_CI_REFRESH')
        self.assertFalse(h['author_replay_authorized'])
        self.assertFalse(c['live_clearance'])

    def test_actual_perform_guard_has_no_author_git_model_or_charge(self):
        f = self.fixture()
        events = []
        def forbidden(*args, **kwargs):
            raise AssertionError('post-guard effect reached')
        store = SimpleNamespace(data=copy.deepcopy(f.cp))
        rt = SimpleNamespace(lease=lambda a: events.append('lease bookkeeping'), budget=SimpleNamespace(charge=forbidden))
        bridge = SimpleNamespace(c=SimpleNamespace(worktrees_root=f.root),
                                 unchanged_issue=lambda a: events.append('issue read'),
                                 author=forbidden, git=forbidden, invoke=forbidden)
        with patch.object(self.stage, 'route', side_effect=forbidden):
            with self.assertRaisesRegex(self.core.Refused, '^attempts exhausted$'):
                self.stage.perform(f.op['binding'], {}, (self.a, None, rt, forbidden, store, bridge))
        self.assertEqual(events, ['lease bookkeeping', 'issue read'])
        self.assertEqual(store.data, f.cp)
        # With an available attempt the same absence of checkpoint/model receipts
        # is not a proof: the actual post-guard route becomes reachable.
        store.data['active']['task']['max_attempts'] = 2
        with patch.object(self.stage, 'route', side_effect=forbidden):
            with self.assertRaisesRegex(AssertionError, 'post-guard'):
                self.stage.perform(f.op['binding'], {}, (self.a, None, rt, forbidden, store, bridge))

    def test_closed_classifier_rejects_wrong_bindings_and_paid_unknown(self):
        op = copy.deepcopy(ACTUAL_OPERATION)
        cp = copy.deepcopy(op['checkpoint_before'])
        cases = []
        for field, value in (('stage', 'qa_qualification'), ('profile', 'agy'), ('phase', 'qa'),
                             ('attempt', True), ('head', 'f' * 40), ('slot', 'slot3')):
            bad = copy.deepcopy(op)
            bad['binding'][field] = value
            cases.append((field, journal_for(bad), cp))
        for field, value in (('reason', 'AGY_INPUT_LIMIT'), ('safe_release', True),
                             ('model_calls', [{'charged': True}]), ('checkpoint', None)):
            bad = copy.deepcopy(op)
            bad['result'][field] = value
            cases.append((field, journal_for(bad), cp))
        for field, value in (('phase', 'developing'), ('attempt', 2), ('head', 'c' * 40),
                             ('ci', {'id': 2}), ('qa', {'verdict': 'PASS'}),
                             ('deterministic_failure', None), ('independent_qa_pending', False)):
            bad_cp = copy.deepcopy(cp)
            bad_cp['active'][field] = value
            cases.append((field, journal_for(op), bad_cp))
        for max_attempts in (0, 2, 3, True):
            bad_cp = copy.deepcopy(cp)
            bad_op = copy.deepcopy(op)
            bad_cp['active']['task']['max_attempts'] = max_attempts
            cases.append(('max_attempts', rebind(bad_op, bad_cp), bad_cp))
        for name, journal, checkpoint in cases:
            before = U.encode([journal, checkpoint])
            with self.subTest(name=name), self.assertRaises(U.Hold):
                U.classify(journal, checkpoint)
            self.assertEqual(U.encode([journal, checkpoint]), before)

    def test_ci_partial_stale_wrong_head_workflow_skips_and_provenance(self):
        cp = copy.deepcopy(ACTUAL_OPERATION['checkpoint_before'])
        valid = ci_for(cp)
        workflow = b'synthetic exact Product CI workflow'
        cases = []
        def changed(label, fn):
            p = copy.deepcopy(valid)
            fn(p)
            cases.append((label, p))
        changed('partial jobs', lambda p: p['jobs'].pop())
        changed('partial checks', lambda p: p['checks'].pop())
        changed('head', lambda p: p['attempt_run'].update(head_sha='a' * 40))
        changed('attempt', lambda p: p['current'].update(run_attempt=2))
        changed('bool attempt', lambda p: p['current'].update(run_attempt=True))
        changed('bool job attempt', lambda p: p['jobs'][0].update(run_attempt=True))
        changed('run', lambda p: p['current'].update(id=1))
        changed('path', lambda p: p['current'].update(path='.github/workflows/other.yml'))
        changed('repo', lambda p: p['current'].update(repository={'id': 1}))
        changed('event', lambda p: p['current'].update(event='pull_request'))
        changed('branch', lambda p: p['current'].update(head_branch='dev'))
        changed('latest missing', lambda p: p.update(total_count=2))
        changed('newer run', lambda p: (p['runs'].append(dict(p['runs'][0], id=p['current']['id'] + 1)), p.update(total_count=2)))
        changed('skipped job', lambda p: p['jobs'][0].update(conclusion='skipped'))
        changed('missing mandatory step', lambda p: p['jobs'][0]['steps'].pop())
        changed('skipped mandatory step', lambda p: p['jobs'][0]['steps'][0].update(conclusion='skipped'))
        changed('check app', lambda p: p['checks'][0].update(app={'slug': 'unknown'}))
        changed('check URL', lambda p: p['checks'][0].update(details_url='https://example.invalid/'))
        changed('check head', lambda p: p['checks'][0].update(head_sha='c' * 40))
        changed('duplicate job', lambda p: p['jobs'].__setitem__(1, p['jobs'][0]))
        changed('duplicate step', lambda p: p['jobs'][0]['steps'].append(p['jobs'][0]['steps'][0]))
        changed('workflow revision', lambda p: p.update(workflow_revision='c' * 40))
        changed('unknown field', lambda p: p.update(token='not-accepted'))
        for label, proof in cases:
            with self.subTest(label=label), self.assertRaises(U.Hold):
                U.exact_ci(proof, cp['active'], workflow, U.sha(workflow))
        with self.assertRaisesRegex(U.Hold, 'WORKFLOW'):
            U.exact_ci(valid, cp['active'], workflow, 'f' * 64)
        with self.assertRaises(U.Hold):
            U.exact_ci(None, cp['active'], workflow, U.sha(workflow))

    def test_fixed_profile_full_source_and_no_whole_commit_equality(self):
        self.assertEqual(len(U.PROFILE), 27)
        self.assertEqual(U.runtime_profile(self.sources.path, owner=os.getuid()), U.digest(U.PROFILE))
        # A single C5 commit is explicitly insufficient for this actual closure.
        raw = git(ROOT, 'show', C5 + ':scripts/chatops/actions_train/native_antigravity.py')
        self.assertNotEqual(U.sha(raw), U.PROFILE['native_antigravity.py'][0])
        for name in ('core.py', 'stage.py', 'context_policy.py'):
            path = self.sources.path / name
            original = path.read_bytes()
            try:
                path.write_bytes(original + b'\n# drift')
                with self.subTest(file=name), self.assertRaises(U.Hold):
                    U.runtime_profile(self.sources.path, owner=os.getuid())
            finally:
                path.write_bytes(original)
        p = self.sources.path / 'unreviewed.py'
        try:
            put(p, b'pass', 0o644)
            with self.assertRaises(U.Hold):
                U.runtime_profile(self.sources.path, owner=os.getuid())
        finally:
            p.unlink()
        p = self.sources.path / 'core.py'
        p.chmod(0o600)
        try:
            with self.assertRaisesRegex(U.Hold, 'OWNER_MODE'):
                U.runtime_profile(self.sources.path, owner=os.getuid())
        finally:
            p.chmod(0o644)
        with self.assertRaisesRegex(U.Hold, 'DIRECTORY_TRUST'):
            U.runtime_profile(self.sources.path, owner=os.getuid() + 1)
        raw = p.read_bytes()
        p.unlink()
        try:
            with self.assertRaises(U.Hold):
                U.runtime_profile(self.sources.path, owner=os.getuid())
        finally:
            put(p, raw, 0o644)

    def test_dry_apply_verify_duplicate_and_actual_store_qa_then_inverse(self):
        f = self.fixture()
        self.assertEqual(f.tx.execute('dry')['protected_writes'], 0)
        self.assertEqual(f.tx.manifest(), f.initial)
        f.tx.execute('apply')
        self.assertEqual(f.tx.preserved(), f.preserved)
        applied = f.tx.manifest()
        f.operator().execute('apply')
        f.operator().execute('verify')
        self.assertEqual(f.tx.manifest(), applied)
        j = U.loads(f.tx.targets['journal'].read_bytes())
        cp = U.loads(f.tx.targets['checkpoint'].read_bytes())
        self.assertEqual(j['generation'], f.journal['generation'] + 1)
        self.assertIsNone(j['pending'])
        self.assertEqual(j['operations'], f.journal['operations'])
        self.assertEqual(self.next_stage(cp['active']), 'qa')
        store = self.a.Store(f.tx.targets['checkpoint'].parent)
        try:
            self.assertEqual(store.data, cp)
        finally:
            os.close(store.lock)
        f.operator().execute('rollback')
        self.assertEqual(f.tx.preserved(), f.preserved)
        for n, p in f.tx.targets.items():
            self.assertEqual(p.read_bytes(), f.tx.before[n])
        prior = f.tx.manifest()
        f.operator().execute('rollback')
        self.assertEqual(prior, f.tx.manifest())
        with self.assertRaisesRegex(U.Hold, 'ROLLBACK'):
            f.operator().execute('apply')

    def test_held_locks_are_noncreating_nonmutating_and_never_deleted(self):
        f = self.fixture()
        for path, _ in f.tx.lock_paths:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                before = f.tx.manifest()
                for action in ('dry', 'apply'):
                    with self.subTest(lock=path.name, action=action), self.assertRaisesRegex(U.Hold, 'LOCK_HELD'):
                        f.operator().execute(action)
                    self.assertEqual(before, f.tx.manifest())
            finally:
                os.close(fd)
        lease = f.tx.lock_paths[2][0]
        before = lease.read_bytes()
        f.tx.execute('apply')
        self.assertEqual(lease.read_bytes(), before)

    def test_inode_cas_drift_and_never_rollback_new_work(self):
        f = self.fixture()
        f.tx.execute('apply')
        path = f.tx.targets['checkpoint']
        for same_bytes in (True, False):
            # Even byte-identical replacement is a foreign inode, not our postimage.
            replacement = path.with_name('new-state')
            raw = path.read_bytes() if same_bytes else U.encode(dict(active=None, done=[999]))
            put(replacement, raw)
            os.replace(replacement, path)
            before = f.tx.manifest()
            for action in ('apply', 'verify', 'rollback'):
                with self.subTest(same_bytes=same_bytes, action=action), self.assertRaises(U.Hold):
                    f.operator().execute(action)
                self.assertEqual(before, f.tx.manifest())

    def test_preserved_accounting_other_slot_and_policy_drift_zero_writes(self):
        for relative in ('controller/slot2.json', 'controller/grants.json',
                         'autonomy/outbox/charges.json', 'policy.json', 'controller/backup.json',
                         'autonomy/locks/slot1.lease'):
            f = self.fixture()
            f.tx.execute('apply')
            p = f.root / relative
            p.write_bytes(p.read_bytes() + b' ')
            before = f.tx.manifest()
            for action in ('apply', 'verify', 'rollback'):
                with self.subTest(path=relative, action=action), self.assertRaises(U.Hold):
                    f.operator().execute(action)
                self.assertEqual(before, f.tx.manifest())

    def test_file_metadata_links_symlinks_and_missing_lock_refused(self):
        f = self.fixture()
        p = f.tx.targets['checkpoint']
        raw = p.read_bytes()
        p.chmod(0o644)
        with self.assertRaises(U.Hold):
            f.operator().execute('dry')
        p.chmod(0o600)
        alias = p.with_name('alias')
        os.link(p, alias)
        with self.assertRaises(U.Hold):
            f.operator().execute('dry')
        alias.unlink()
        p.unlink()
        put(alias, raw)
        p.symlink_to(alias.name)
        with self.assertRaises((U.Hold, OSError)):
            f.operator().execute('dry')
        p.unlink()
        os.replace(alias, p)
        lock = f.tx.lock_paths[0][0]
        lock.unlink()
        with self.assertRaises(FileNotFoundError):
            f.operator().execute('dry')
        self.assertFalse(lock.exists())

    def cli_args(self, action):
        return [action, '--operation', 'a' * 64, '--bundle', '/root/reviewed-source',
                '--source-commit', 'b' * 40, '--source-branch', 'dev',
                '--source-ci-run', '1', '--qa-receipt', '/root/independent-qa.json']

    def test_cli_real_dispatch_nonroot_hold_and_no_proof_override(self):
        # Nonroot returns before ANY runtime read or network access.
        for action in ('dry', 'apply', 'verify', 'rollback'):
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout), patch.object(U, 'GitHubReads', side_effect=AssertionError):
                result = U.main(self.cli_args(action))
            value = json.loads(stdout.getvalue())
            self.assertEqual(result, 1)
            self.assertEqual(value['status'], 'HOLD')
            self.assertEqual(value['reason'], 'ROOT_OPS_IDENTITY_REQUIRED')
        # The CLI reaches its real adapter, with no unconditional partial HOLD.
        with patch.object(U, 'live_execute', return_value={'status': 'PROTECTED_COMPLETE'}) as run:
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(U.main(self.cli_args('apply')), 0)
            self.assertEqual(run.call_args.args[0].action, 'apply')
        with patch.object(U.os, 'getuid', return_value=0), patch.object(U.os, 'geteuid', return_value=0):
            with self.assertRaisesRegex(U.Hold, 'OFFLINE_NONROOT_ONLY'):
                U.OfflineTransaction(Path('/nonexistent'), None)
        for args in (['apply', '--operation', '../path'], self.cli_args('apply') + ['--force'],
                     self.cli_args('apply') + ['--proof', 'arbitrary.json']):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                U.main(args)

    def test_no_duplicate_json_nonfinite_or_noncanonical_checkpoint(self):
        for raw in (b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":Infinity}'):
            with self.assertRaises(U.Hold):
                U.loads(raw)
        with self.assertRaisesRegex(U.Hold, 'NONCANONICAL'):
            U.canonical(b'{"active":null,"done":[]}')

    def test_github_collector_real_shapes_gets_current_attempt_and_seven_checks(self):
        f = self.fixture()
        http = FakeHTTP(f.ci, f.workflow)
        proof, workflow = http.client().ci(f.cp['active'])
        expected = copy.deepcopy(f.ci)
        for job in expected['jobs']:
            job['check_run_url'] = f'https://api.github.com/repos/{U.REPO}/check-runs/{job["check_run_id"]}'
        self.assertEqual(proof, expected)
        self.assertEqual(workflow, f.workflow)
        self.assertEqual(len([e for e in http.seen if e.startswith('check-runs/')]), 7)
        self.assertEqual(http.seen.count(f'actions/runs/{f.ci["current"]["id"]}'), 2)
        self.assertEqual(U.exact_ci(proof, f.cp['active'], workflow, U.sha(workflow))['sha'], f.cp['active']['head'])

    def test_github_collector_refuses_incomplete_url_injection_rate_redirect_and_rerun(self):
        f = self.fixture()
        for label in ('partial', 'url', 'rerun', 'workflow', 'oversize', 'rate', 'redirect'):
            http = FakeHTTP(f.ci, f.workflow)
            api = http.client()
            if label == 'partial':
                http.responses[http.jobs_endpoint]['total_count'] = 8
            elif label == 'url':
                http.responses[http.jobs_endpoint]['jobs'][0]['check_run_url'] = 'https://example.invalid/token'
            elif label == 'rerun':
                endpoint = f'actions/runs/{f.ci["current"]["id"]}'
                seen = [0]
                def mutate(path):
                    if path == endpoint:
                        seen[0] += 1
                        if seen[0] == 2:
                            http.responses[path] = dict(http.responses[path], run_attempt=2)
                http.mutate = mutate
            elif label == 'workflow':
                for endpoint in http.responses:
                    if endpoint.startswith('contents/'):
                        http.responses[endpoint]['sha'] = 'f' * 40
            elif label == 'oversize':
                api.open = lambda *a, **k: contextlib.closing(io.BytesIO(b'x' * (2 * 1024 * 1024 + 1)))
            elif label == 'rate':
                def refuse(*a, **k):
                    raise U.urllib.error.HTTPError('redacted', 429, 'redacted', {}, None)
                api.open = refuse
            else:
                api.open = lambda *a, **k: U.NoRedirect().redirect_request(None)
            with self.subTest(label=label), self.assertRaises(U.Hold):
                api.ci(f.cp['active'])
        api = http.client()
        for endpoint in ('https://example.invalid/', '../secrets', 'actions/runs/1?token=x',
                         '/repos/other', 'issues/1/comments?per_page=100&page=2'):
            with self.subTest(endpoint=endpoint), self.assertRaises(U.Hold):
                api.get(endpoint)

    def test_safe_git_native_clean_raw_blobs_index_hooks_config_and_common(self):
        with self.root_metadata_fixture():
            self.safe_git_checks()

    def safe_git_checks(self):
        f = self.fixture()
        work = f.root / 'candidate'
        git(work, 'remote', 'add', 'origin', 'https://github.com/' + U.REPO + '.git')
        branch = git(work, 'symbolic-ref', '--short', 'HEAD').strip().decode()
        g = U.SafeGit(work, os.getuid(), os.getgid())
        self.assertEqual(g.clean(f.cp['active']['head'], branch), {})
        for relative, raw in (('.git/hooks/post-checkout', b'#!/bin/sh\nexit 0'),
                              ('.git/objects/info/alternates', b'/untrusted'),
                              ('.git/info/attributes', b'* filter=untrusted')):
            path = work / relative
            put(path, raw, 0o644)
            with self.subTest(path=relative), patch.object(U, 'bounded_command', side_effect=AssertionError):
                with self.assertRaises(U.Hold):
                    g.clean(f.cp['active']['head'], branch)
            path.unlink()
        config = work / '.git/config'
        original = config.read_bytes()
        config.write_bytes(original + b'\n[include]\npath = /untrusted\n')
        with patch.object(U, 'bounded_command', side_effect=AssertionError), self.assertRaises(U.Hold):
            g.clean(f.cp['active']['head'], branch)
        config.write_bytes(original)
        put(work / 'raw.txt', b'exact raw data\n', 0o644)
        git(work, 'add', 'raw.txt')
        git(work, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid',
            'commit', '-qm', 'synthetic raw proof')
        head = git(work, 'rev-parse', 'HEAD').strip().decode()
        self.assertEqual(g.clean(head, branch)['raw.txt'], b'exact raw data\n')
        git(work, 'update-index', '--assume-unchanged', 'raw.txt')
        with self.assertRaisesRegex(U.Hold, 'INDEX_FLAGS'):
            g.clean(head, branch)
        git(work, 'update-index', '--no-assume-unchanged', 'raw.txt')
        (work / 'raw.txt').write_bytes(b'corrupted data\n')
        with self.assertRaises(U.Hold):
            g.clean(head, branch)
        (work / 'raw.txt').write_bytes(b'exact raw data\n')
        # A real linked worktree uses the same validated common DB; no alternate
        # object store, config override or root trust of user-owned metadata.
        linked = f.root / 'linked'
        git(work, 'worktree', 'add', '-b', 'linked-proof', str(linked), head)
        self.assertEqual(U.SafeGit(linked, os.getuid(), os.getgid()).clean(head, 'linked-proof')['raw.txt'],
                         b'exact raw data\n')
        common_pointer = Path((linked / '.git').read_text()[8:].strip()) / 'commondir'
        old = common_pointer.read_bytes()
        common_pointer.write_bytes(b'../../not-the-common\n')
        with patch.object(U, 'bounded_command', side_effect=AssertionError), self.assertRaises((U.Hold, OSError)):
            U.SafeGit(linked, os.getuid(), os.getgid()).clean(head, 'linked-proof')
        common_pointer.write_bytes(old)

    def test_bounded_native_read_command_caps_and_no_shell(self):
        env = dict(PATH='/usr/bin:/bin', LANG='C.UTF-8')
        self.assertEqual(U.bounded_command([sys.executable, '-c', 'print("bounded")'], env), b'bounded\n')
        with self.assertRaisesRegex(U.Hold, 'OVERSIZE'):
            U.bounded_command([sys.executable, '-c', 'import os;os.write(2,b"x"*65536)'], env, cap=1024)
        with self.assertRaisesRegex(U.Hold, 'TIMEOUT'):
            U.bounded_command([sys.executable, '-c', 'import time;time.sleep(10)'], env, timeout=.1)

    def test_process_stat_session_descendant_uid_cgroup_and_boot_guards(self):
        f = self.fixture()
        proc, cgroup = f.root / 'proc', f.root / 'cgroup'
        boot = Path('/proc/sys/kernel/random/boot_id').read_text()
        put(proc / 'sys/kernel/random/boot_id', boot.encode())
        put(cgroup / 'system.scope/cgroup.procs', b'')
        op = copy.deepcopy(f.op)
        op['process']['boot'] = boot.strip()
        # Native own child, stat/status captured without command/env access.
        child = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(20)'],
                                 start_new_session=True, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            stat_raw = Path(f'/proc/{child.pid}/stat').read_bytes()
            status = Path(f'/proc/{child.pid}/status').read_bytes()
            pid = op['process']['pid']
            self.assertTrue(U.stopped_processes(op, 999999, proc, cgroup))
            for kind in ('identity', 'pgid', 'session', 'descendant', 'uid', 'cgroup'):
                fields = stat_raw.rsplit(b')', 1)[1].split()
                if kind == 'pgid': fields[2] = str(pid).encode()
                if kind == 'session': fields[3] = str(pid).encode()
                if kind == 'descendant': fields[1] = str(pid).encode()
                process_id = pid if kind == 'identity' else child.pid
                path = proc / str(process_id)
                if kind != 'cgroup':
                    put(path / 'stat', str(process_id).encode() + b' (synthetic) ' + b' '.join(fields))
                    put(path / 'status', status)
                else:
                    put(cgroup / 'system.scope/cgroup.procs', str(pid).encode())
                with self.subTest(kind=kind), self.assertRaises(U.Hold):
                    U.stopped_processes(op, os.getuid() if kind == 'uid' else 999999, proc, cgroup)
                if path.exists(): shutil.rmtree(path)
                put(cgroup / 'system.scope/cgroup.procs', b'')
            op['process']['boot'] = '00000000-0000-0000-0000-000000000000'
            with self.assertRaisesRegex(U.Hold, 'BOOT'):
                U.stopped_processes(op, 999999, proc, cgroup)
        finally:
            child.terminate()
            child.wait(timeout=5)

    def test_protected_adapter_real_locks_actual_c5_qa_and_metadata_policy(self):
        f = self.fixture()
        layout = U.Layout(controller=f.root / 'controller', autonomy=f.root / 'autonomy')
        events = []
        parent = self
        class Collector:
            core_raw = parent.sources.path.joinpath('core.py').read_bytes()
            local_evidence, remote_digest, release_hash = {'synthetic': True}, 'b' * 64, 'c' * 64
            def local(self): events.append('local')
            def current(self):
                events.append('current')
                self_plan = U.transition(U.encode(f.journal), U.encode(f.cp), f.ci, f.workflow, U.sha(f.workflow))
                parent.assertEqual(self_plan, f.plan)
        # Native files/flocks/renames/fsync; only privileged metadata identity is
        # substituted. There is no root execution or protected filesystem access.
        class SyntheticProtected(U.ProtectedTransaction):
            def file_owner(self, path): return os.getuid(), os.getgid()
            def file_metadata(self, path, fd, mode): os.fchmod(fd, mode)
            def prepare_artifact(self, path, raw, mode): pass
            def image(self, path, mode=0o600):
                return U.OfflineTransaction.image(self, path, mode)
        def tx():
            with patch.object(U.os, 'getuid', return_value=0), patch.object(U.os, 'geteuid', return_value=0):
                value = SyntheticProtected(layout, f.plan, Collector())
            value.uid, value.gid = os.getuid(), os.getgid()
            return value
        operator = tx()
        # Source metadata ownership policy itself is checked without mutation.
        self.assertEqual(U.ProtectedTransaction.file_owner(operator, operator.targets['checkpoint']), (1002, 1002))
        self.assertEqual(U.ProtectedTransaction.file_owner(operator, operator.targets['journal']), (0, 0))
        self.assertEqual(U.ProtectedTransaction.file_owner(operator, operator.lock_paths[2][0]), (1002, 65042))
        self.assertEqual(U.ProtectedTransaction.file_owner(operator, operator.lock_paths[3][0]), (0, 65042))
        self.assertEqual(operator.execute('dry')['status'], 'PROTECTED_DRY')
        self.assertEqual(operator.execute('apply')['status'], 'PROTECTED_COMPLETE')
        self.assertEqual(self.next_stage(U.loads(operator.targets['checkpoint'].read_bytes())['active']), 'qa')
        applied = operator.manifest()
        self.assertEqual(tx().execute('verify')['status'], 'PROTECTED_COMPLETE')
        self.assertEqual(tx().execute('apply')['status'], 'PROTECTED_COMPLETE')
        self.assertEqual(applied, operator.manifest())
        self.assertTrue((operator.tx / 'live-attestation.json').exists())
        self.assertGreaterEqual(events.count('current'), 6)
        self.assertEqual(tx().execute('rollback')['status'], 'PROTECTED_ROLLED_BACK')
        self.assertEqual(operator.targets['checkpoint'].read_bytes(), f.plan.checkpoint_before)
        # Every gate error before intent leaves all state bytes unchanged.
        (operator.tx / 'live-attestation.json').read_bytes()

    def test_protected_new_attestation_crashes_and_currentness_race_keep_pending(self):
        parent = self
        class SyntheticProtected(U.ProtectedTransaction):
            def file_owner(self, path): return os.getuid(), os.getgid()
            def file_metadata(self, path, fd, mode): os.fchmod(fd, mode)
            def prepare_artifact(self, path, raw, mode): pass
            def image(self, path, mode=0o600): return U.OfflineTransaction.image(self, path, mode)
        def make(f, boundary=None, fail_on=None):
            calls = [0]
            class Collector:
                core_raw = parent.sources.path.joinpath('core.py').read_bytes()
                local_evidence, remote_digest, release_hash = {'scope': 'synthetic'}, 'b' * 64, 'c' * 64
                def local(self): pass
                def current(self):
                    calls[0] += 1
                    if calls[0] == fail_on: raise U.Hold('CI_CURRENTNESS_CHANGED')
            with patch.object(U.os, 'getuid', return_value=0), patch.object(U.os, 'geteuid', return_value=0):
                tx = SyntheticProtected(U.Layout(controller=f.root / 'controller', autonomy=f.root / 'autonomy'),
                                        f.plan, Collector(), boundary)
            tx.uid, tx.gid = os.getuid(), os.getgid()
            return tx
        for fail_on in (1, 2, 3):
            f = self.fixture()
            tx = make(f, fail_on=fail_on)
            preserved = tx.preserved()
            with self.subTest(currentness_call=fail_on), self.assertRaises(U.TransactionHold):
                tx.execute('apply')
            self.assertEqual(U.loads(tx.targets['journal'].read_bytes())['pending'], f.journal['pending'])
            self.assertEqual(tx.preserved(), preserved)
            # Inverse does not require successful target CI or assert old PASS.
            if (tx.tx / 'intent.json').exists():
                make(f, fail_on=1).execute('rollback')
                self.assertEqual(tx.targets['checkpoint'].read_bytes(), f.plan.checkpoint_before)
        probe = self.fixture()
        events = []
        make(probe, events.append).execute('apply')
        new_events = [e for e in events if 'live-attestation' in e]
        self.assertGreaterEqual(len(new_events), 10)
        for event in new_events:
            f = self.fixture()
            fired = [False]
            def crash(label):
                if label == event and not fired[0]:
                    fired[0] = True
                    raise InterruptedError('injected new ' + label)
            tx = make(f, crash)
            with self.subTest(event=event), self.assertRaises(U.TransactionHold): tx.execute('apply')
            self.assertTrue(fired[0])
            self.assertEqual(tx.targets['checkpoint'].read_bytes(), f.plan.checkpoint_before)
            self.assertEqual(tx.targets['journal'].read_bytes(), f.plan.journal_before)
            make(f).execute('apply')
            make(f).execute('verify')
            self.assertEqual(self.next_stage(U.loads(tx.targets['checkpoint'].read_bytes())['active']), 'qa')

    def test_owner_raw_task_and_pr_binding_without_caller_trusted_boolean(self):
        f = self.fixture()
        active = copy.deepcopy(f.cp['active'])
        issue = dict(number=active['issue'], body='GOBADMINTON_AUTONOMY_V1\n' + U.encode(active['task']).decode(),
                     user={'id': 318610566}, created_at='2026-10-27T00:00:00Z',
                     updated_at='2026-10-27T00:00:00Z', state='open')
        active['fingerprint'] = U.sha(U.encode({k: issue[k] for k in ('number', 'body', 'user', 'created_at')}))
        pr = dict(number=active['pr'], state='open', merged=False, changed_files=1,
                  head=dict(sha=active['head'], ref=f'automation/issue-{active["issue"]}', repo={'id': U.REPO_ID}),
                  base=dict(ref='dev', repo={'id': U.REPO_ID}))
        data = {f'issues/{active["issue"]}': issue,
                f'issues/{active["issue"]}/comments?per_page=100&page=1': [],
                f'pulls/{active["pr"]}': pr,
                'git/commits/' + active['head']: dict(sha=active['head'], parents=[{'sha': active['base']}]),
                f'pulls/{active["pr"]}/files?per_page=100&page=1': [dict(filename='probe.mjs', status='removed')]}
        api = SimpleNamespace(get=lambda path: copy.deepcopy(data[path]))
        self.assertTrue(U.owner_task(api, active))
        # Native unchanged_issue permits updated_at from comments/PR references.
        issue['updated_at'] = '2026-10-27T00:01:00Z'
        self.assertTrue(U.owner_task(api, active))
        for label, mutation in (
            ('raw task', lambda: issue.update(body=issue['body'] + ' ')),
            ('owner', lambda: issue['user'].update(id=1)),
            ('creation drift', lambda: issue.update(created_at='2026-10-27T00:01:00Z')),
            ('head', lambda: pr['head'].update(sha='f' * 40)),
            ('base', lambda: data['git/commits/' + active['head']].update(parents=[])),
            ('files', lambda: data[f'pulls/{active["pr"]}/files?per_page=100&page=1'][0].update(filename='forbidden'))):
            saved = copy.deepcopy(data)
            mutation()
            with self.subTest(label=label), self.assertRaises(U.Hold):
                U.owner_task(api, active)
            data.clear(); data.update(saved)
            issue = data[f'issues/{active["issue"]}']; pr = data[f'pulls/{active["pr"]}']

    def test_source_release_native_tree_self_qa_ci_and_drift_negatives(self):
        f = self.fixture()
        bundle = f.root / 'reviewed-source'
        bundle.mkdir(mode=0o700)
        git(bundle, 'init', '-q')
        material = {U.SOURCE_PATH: SOURCE.read_bytes(), U.TEST_PATH: Path(__file__).read_bytes(),
                    '.github/workflows/ci.yml': f.workflow}
        for path, raw in material.items(): put(bundle / path, raw, 0o644)
        git(bundle, 'add', '.')
        git(bundle, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid',
            'commit', '-qm', 'synthetic reviewed package')
        git(bundle, 'remote', 'add', 'origin', 'https://github.com/' + U.REPO + '.git')
        head = git(bundle, 'rev-parse', 'HEAD').strip().decode()
        branch = git(bundle, 'symbolic-ref', '--short', 'HEAD').strip().decode()
        qa = dict(schema='GB_PRECALL_SOURCE_QA_V1', repo=U.REPO, reviewed_sha=head, verdict='PASS',
                  role='independent_source_qa', risk='critical', author_session='synthetic-author',
                  reviewer_session='synthetic-reviewer',
                  files={p: U.sha(material[p]) for p in (U.SOURCE_PATH, U.TEST_PATH)})
        qa_path = f.root / 'independent-source-qa.json'
        put(qa_path, U.encode(qa))
        cp = copy.deepcopy(f.cp)
        cp['active']['head'] = head
        proof = ci_for(cp)
        for row in [proof['current'], proof['attempt_run'], *proof['runs']]: row['head_branch'] = branch
        api = FakeHTTP(proof, f.workflow).client()
        real_git = U.SafeGit
        with self.assertRaises(U.Hold):
            U.source_release(bundle, head, branch, qa_path, proof['current']['id'], api)
        def fixture_git(work): return real_git(work, os.getuid(), os.getgid())
        with self.root_metadata_fixture(), patch.object(U, 'SafeGit', side_effect=fixture_git):
            def run():
                return U.source_release(bundle, head, branch, qa_path, proof['current']['id'],
                                        FakeHTTP(proof, f.workflow).client())
            self.assertTrue(run())
            for field, value in (('verdict', 'FAIL'), ('reviewed_sha', 'f' * 40), ('risk', 'routine'),
                                 ('reviewer_session', 'synthetic-author'), ('files', {})):
                wrong = dict(qa, **{field: value})
                put(qa_path, U.encode(wrong))
                with self.subTest(field=field), self.assertRaises(U.Hold): run()
                put(qa_path, U.encode(qa))
            (bundle / U.SOURCE_PATH).write_bytes(material[U.SOURCE_PATH] + b'\n# drift\n')
            with self.assertRaises(U.Hold): run()
            (bundle / U.SOURCE_PATH).write_bytes(material[U.SOURCE_PATH])
            proof['jobs'][0]['conclusion'] = 'failure'
            with self.assertRaises(U.Hold): run()

    def test_live_local_collector_actual_27_pins_inventory_policy_metadata_and_candidate(self):
        f = self.fixture()
        system = f.root / 'system'
        runtime = system / 'usr/local/lib/gb-actions-train'
        runtime.parent.mkdir(parents=True)
        shutil.copytree(self.sources.path, runtime)
        for rel, mtime in U.PROFILE_MTIME_NS.items():
            os.utime(runtime / rel, ns=(mtime, mtime))
        policy = system / 'etc/gobadminton-actions-train/policy.json'
        policy_raw = U.encode(dict(mode='active', controller_sha=U.CONTROLLER,
                                   stage_workflow_sha256=U.STAGE_WORKFLOW))
        put(policy, policy_raw, 0o644)
        for name, data in (
            ('budgets.json', dict(providers={}, slots={})),
            ('continuity.json', dict(schema='GB_SLOT_CONTINUITY_V1', enabled=True)),
            ('cursor-author.json', dict(schema='GB_CURSOR_AUTHOR_211_V1', phase='ready', slots=['slot1'],
                modules={p: U.PROFILE[p][0] for p in ('native_cursor.py', 'native_guard.py')}))):
            put(system / 'etc/gobadminton-slots' / name, U.encode(data), 0o644)
        inventory_raw = U.encode(dict(schema='GB_ACTIONS_TRAIN_BACKUP_V1',
            after={'/usr/local/lib/gb-actions-train/' + p: pin for p, (pin, _) in U.PROFILE.items()}))
        put(f.root / 'controller/backup.json', inventory_raw)
        proc, cgroups = f.root / 'proc', f.root / 'cgroups'
        put(proc / 'sys/kernel/random/boot_id', (f.op['process']['boot'] + '\n').encode())
        put(cgroups / 'scope/cgroup.procs', b'')
        git(f.root / 'candidate', 'remote', 'add', 'origin', 'https://github.com/' + U.REPO + '.git')
        git(f.root / 'candidate', 'branch', '-m', f'automation/issue-{f.cp["active"]["issue"]}')
        worktrees = f.root / 'worktrees'
        worktrees.mkdir()
        # Move the real plain synthetic Git tree into the fixed candidate layout.
        (f.root / 'candidate').rename(worktrees / f'issue-{f.cp["active"]["issue"]}')
        layout = U.Layout(controller=f.root / 'controller', autonomy=f.root / 'autonomy',
                          runtime=runtime, policy=policy, proc=proc, cgroups=cgroups,
                          worktrees=worktrees, system=system)
        read = U.read_image
        def lease_group(path, owner, mode, limit=4 * 1024 * 1024):
            result = read(path, owner, mode, limit)
            if str(path).endswith('/locks/slot1.lease'):
                identity = list(result.identity); identity[3] = 65042
                return U.Image(result.raw, tuple(identity))
            return result
        command = U.bounded_command
        def native_or_systemctl(argv, env, *args, **kwargs):
            if argv[0] == '/usr/bin/systemctl':
                self.assertIn(argv[2], ('gobadminton-supervisor.service', 'gobadminton-slot@slot1.service'))
                return b'ActiveState=inactive\nMainPID=0\nControlGroup=\n'
            return command(argv, env, *args, **kwargs)
        with patch.object(U, 'POLICY_PIN', U.sha(policy_raw)), patch.object(U, 'INVENTORY_PIN', U.sha(inventory_raw)):
            with patch.object(U, 'read_image', side_effect=lease_group), self.root_metadata_fixture(), \
                    patch.object(U, 'bounded_command', side_effect=native_or_systemctl):
                collector = U.LiveCollector(layout, f.plan, None)
                first = collector.local()
                self.assertEqual(collector.local(), first)
                self.assertEqual(len(collector.local_evidence['pins']), 27)
                U.pinned_next_qa(collector.core_raw, U.loads(f.plan.checkpoint_after)['active'])
                for relative in ('core.py', 'native_cursor.py', 'stage.py'):
                    path = runtime / relative
                    raw = path.read_bytes(); meta = path.stat()
                    path.write_bytes(raw + b'\n# drift')
                    with self.subTest(path=relative), self.assertRaises(U.Hold): collector.local()
                    path.write_bytes(raw); os.utime(path, ns=(meta.st_atime_ns, meta.st_mtime_ns))
                put(runtime / 'unreviewed.py', b'pass', 0o644)
                with self.assertRaises(U.Hold): collector.local()
                (runtime / 'unreviewed.py').unlink()
                # New collector resets only observation baseline, NOT policy/pins.
                collector = U.LiveCollector(layout, f.plan, None)
                self.assertTrue(collector.local())
                trace = layout.autonomy / 'outbox/slot1/actions-process.json'
                put(trace, U.encode(dict(workflow_run=f.op['run'], process={'pid': 1}, model='unknown')))
                with self.assertRaisesRegex(U.Hold, 'MODEL_PROCESS'): collector.local()
                trace.unlink()
                cursor = layout.autonomy / 'outbox/slot1/cursor-author-receipt.json'
                put(cursor, U.encode(dict(task_sha256=f.op['task_hash'], issue=f.cp['active']['issue'],
                                          started_at=f.op['started_at'])))
                with self.assertRaisesRegex(U.Hold, 'CURSOR_INVOCATION'): collector.local()
                cursor.unlink()
                config = system / 'etc/gobadminton-slots/budgets.json'
                saved = config.read_bytes()
                put(config, U.encode(dict(providers={'cursor': {'author': 1}}, slots={})), 0o644)
                with self.assertRaisesRegex(U.Hold, 'LOCAL_ATTESTATION_DRIFT'): collector.local()
                put(config, saved, 0o644)
                barrier = system / 'etc/gobadminton-slots/continuity.pending'
                put(barrier, b'{}', 0o644)
                with self.assertRaisesRegex(U.Hold, 'ACTIVATION_PENDING'): collector.local()
                barrier.unlink()
                with patch.object(U, 'bounded_command', return_value=b'ActiveState=active\nMainPID=123\nControlGroup=/scope\n'):
                    with self.assertRaisesRegex(U.Hold, 'LEGACY_WRITER_ACTIVE'): collector.local()
                put(policy, policy_raw + b' ', 0o644)
                with self.assertRaisesRegex(U.Hold, 'POLICY_PIN'): collector.local()

    def test_all_apply_crash_boundaries_safe_resume_or_precise_hold(self):
        probe = self.fixture()
        events = []
        probe.operator(events.append).execute('apply')
        self.assertGreater(len(events), 60)
        for index, event in enumerate(events):
            f = self.fixture()
            n = [0]
            def crash(label):
                current = n[0]
                n[0] += 1
                if current == index:
                    raise InterruptedError('injected ' + label)
            with self.subTest(boundary=event, index=index):
                with self.assertRaises(InterruptedError):
                    f.operator(crash).execute('apply')
                self.assertEqual(f.tx.preserved(), f.preserved)
                for name, path in f.tx.targets.items():
                    self.assertIn(path.read_bytes(), (f.tx.before[name], f.tx.after[name]))
                f.operator().execute('apply')
                f.operator().execute('verify')
                self.assertEqual(self.next_stage(U.loads(f.tx.targets['checkpoint'].read_bytes())['active']), 'qa')
                self.assertEqual(f.tx.preserved(), f.preserved)
                f.close()

    def test_all_rollback_crash_boundaries_resume_without_erasing_receipts(self):
        probe = self.fixture()
        probe.tx.execute('apply')
        events = []
        probe.operator(events.append).execute('rollback')
        for index, event in enumerate(events):
            f = self.fixture()
            f.tx.execute('apply')
            old_complete = (f.tx.tx / 'complete.json').read_bytes()
            n = [0]
            def crash(label):
                current = n[0]
                n[0] += 1
                if current == index:
                    raise InterruptedError('injected ' + label)
            with self.subTest(boundary=event, index=index):
                with self.assertRaises(InterruptedError):
                    f.operator(crash).execute('rollback')
                f.operator().execute('rollback')
                for name, path in f.tx.targets.items():
                    self.assertEqual(path.read_bytes(), f.tx.before[name])
                self.assertEqual((f.tx.tx / 'complete.json').read_bytes(), old_complete)
                self.assertEqual(f.tx.preserved(), f.preserved)
                f.close()


if __name__ == '__main__':
    unittest.main()

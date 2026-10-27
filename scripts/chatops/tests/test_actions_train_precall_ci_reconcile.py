"""Offline actual-C5 proof and synthetic Store/Git transaction; no live access.

Pinned public blobs come only from the existing Git DB (CI receiver fetches full
history). No fetch/clone, provider, API, root identity or installed module runs.
Run locally with GB_PRECALL_TEST_SCRATCH set to the authorized evidence scratch.
Missing exact public source is a test error, never a skipped mandatory proof.
"""
import ast
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

    def test_cli_always_holds_including_root_and_forged_proofs(self):
        # The source revision has no live apply path. Incomplete attestation,
        # process uncertainty, charges and missing release gates cannot be
        # turned into permission by a supplied JSON or by root identity.
        for action in ('dry', 'apply', 'verify', 'rollback'):
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                result = U.main([action, '--operation', 'a' * 64])
            value = json.loads(stdout.getvalue())
            self.assertEqual(result, 1)
            self.assertEqual(value['status'], 'HOLD')
            self.assertEqual(value['protected_writes'], 0)
            self.assertEqual(value['missing'], list(U.LIVE_GAPS))
        with patch.object(U.os, 'getuid', return_value=0), patch.object(U.os, 'geteuid', return_value=0):
            with self.assertRaisesRegex(U.Hold, 'OFFLINE_NONROOT_ONLY'):
                U.OfflineTransaction(Path('/nonexistent'), None)
        for args in (['apply', '--operation', '../path'], ['apply', '--operation', 'a' * 64, '--force'],
                     ['apply', '--operation', 'a' * 64, '--proof', 'arbitrary.json']):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                U.main(args)

    def test_no_duplicate_json_nonfinite_or_noncanonical_checkpoint(self):
        for raw in (b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":Infinity}'):
            with self.assertRaises(U.Hold):
                U.loads(raw)
        with self.assertRaisesRegex(U.Hold, 'NONCANONICAL'):
            U.canonical(b'{"active":null,"done":[]}')

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

"""B2 source-only controlled provider/process fixtures; no paid calls."""
import copy
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from contextlib import contextmanager
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
_TRAIN_DIR = ROOT / 'tools/train'
# Generic Lean import names also exist in legacy actions_train. Restore the
# complete import cache and path after discovery and after this module's tests.
_LEAN_NAMES = {p.stem for p in _TRAIN_DIR.glob('*.py')
               if not p.stem.startswith('test') and p.stem != '__init__'}


@contextmanager
def _lean_import_scope(modules=None):
    with patch.dict(sys.modules), patch.object(sys, 'path', [str(_TRAIN_DIR), *sys.path]):
        for name in list(sys.modules):
            if name.split('.')[0] in _LEAN_NAMES:
                sys.modules.pop(name)
        sys.modules.update(modules or {})
        yield


with _lean_import_scope():
    import author_routing as p
    import author_handoff as h
    import providers
    import live
    import run
    _LEAN_MODULES = {name: sys.modules[name] for name in _LEAN_NAMES if name in sys.modules}


def setUpModule():
    # Methods under test use absolute imports lazily as well as at load time.
    scope = _lean_import_scope(_LEAN_MODULES)
    scope.__enter__()
    unittest.addModuleCleanup(scope.__exit__, None, None, None)




def routes():
    return {k: p.Route(k, True, True, True, k + ':executor', model)
            for k, model in ((p.CURSOR, 'auto'), (p.AGY, p.AGY_MODEL), (p.CODEX, p.CODEX_MODEL))}


def task(**kw):
    return dict(issue=527, revision='a' * 64, allowed_paths=['x.py'],
                complexity='standard', work_kind='ops', runtime_base_sha='b' * 40,
                _author_operation='operation1', authorroute=['cursor_auto', 'agy_author', 'codex_author'], **kw)


def bound(t, mode='on', counts=None):
    t['_bound_author'] = h.freeze(t, revision=t['revision'], pipeline='c' * 40,
        routes=routes(), history_counts=counts, mode=mode)
    return t


def stop(provider=p.CURSOR, op='op1'):
    b = p.Operation('527', op, provider, 'a' * 40, 'scope', 'b' * 40)
    f = p.CapacityFailure(b, 'evidencehash', 'QUOTA_EXHAUSTED', 'native_top_level_error')
    proof = p.StopProof(b, f.fingerprint, True, True, True, False, 'checkpoint', ('native-final',), 'preserved_diff')
    return p.CapacityStop(f, proof)


class Binding(unittest.TestCase):
    def test_same_frozen_decision_used_by_wrapper_and_live(self):
        t = bound(task(), counts={p.CURSOR: 2, p.AGY: 0})
        seen = []
        def fake(**kw):
            seen.append(kw['task']['_bound_author'])
            return dict(candidate_sha='d' * 40, provider='agy_author')
        with tempfile.TemporaryDirectory() as td, patch.object(providers, 'role_ready', return_value=(True, {})), \
                patch.object(live, 'agy_author_live', side_effect=fake), \
                patch.object(p, 'select_author', side_effect=AssertionError('recomputed')):
            adapters = live.build_live_adapters()
            result = providers.invoke_cursor_author(task=t, worktree=td, evidence_dir=td, launcher=adapters.author)
            intent = json.loads((Path(td) / 'author-intent.json').read_text())
        self.assertEqual(result['provider'], 'agy_author')
        self.assertEqual(seen, [t['_bound_author']])
        self.assertEqual(intent['bound_author'], t['_bound_author'])

    def test_comparable_balance_and_mobile(self):
        self.assertEqual(h.bound_provider(bound(task(), counts={p.CURSOR: 1, p.AGY: 0}))[0], 'agy_author')
        self.assertEqual(h.bound_provider(bound(task(), counts={p.CURSOR: 0, p.AGY: 1}))[0], 'cursor_auto')
        t = task(); t['issue'] = 522
        self.assertEqual(h.bound_provider(bound(t))[0], 'agy_author')

    def test_continuation_keeps_author(self):
        t = task()
        b = h.freeze(t, revision=t['revision'], pipeline='c' * 40, routes=routes(), mode='on', current_provider=p.AGY)
        t['_bound_author'] = b
        self.assertEqual(h.bound_provider(t)[0], 'agy_author')

    def test_shadow_and_off_never_switch(self):
        for mode in ('off', 'shadow'):
            self.assertIsNone(h.bound_provider(bound(task(), mode)))

    def test_tampering_and_revision_mismatch_hold(self):
        t = bound(task()); t['revision'] = 'f' * 64
        with self.assertRaises(ValueError): h.bound_provider(t)
        t = bound(task()); t['_bound_author']['decision']['provider'] = p.CODEX
        with self.assertRaises(ValueError): h.bound_provider(t)

    def test_alias_mapping_and_qa_role_split(self):
        self.assertEqual(providers.author_routes({'authorroute': ['antigravity_sonnet', 'codex_sol_medium']}),
                         ['agy_author', 'codex_author'])
        t = bound(task())
        with patch.object(providers, 'role_ready', side_effect=lambda role: (role != 'codex_routing_qa', {})):
            with self.assertRaises(providers.ProviderError): providers.select_author_provider(t)

    def test_native_cursor_ready_without_cosmetic_marker(self):
        native = SimpleNamespace(qualification=lambda *a: {'phase': 'ready'})
        with patch.object(providers, '_import_native', return_value=native), \
                patch.object(providers, 'read_ready_marker', side_effect=AssertionError('cosmetic marker')):
            self.assertTrue(providers.role_ready('cursor_author')[0])

    def test_codex_author_requires_exact_registry_and_secure_command(self):
        slots = SimpleNamespace(MODEL_ADAPTER={'gpt-6.1-sol': 'codex'}, adapter_status=lambda *a: (True, 'qualified'))
        core = SimpleNamespace(live=lambda: (SimpleNamespace(model_command=lambda: None), slots))
        with patch.object(providers, '_import_native', return_value=core):
            self.assertTrue(providers.qualified_codex_role('author')[0])
            self.assertFalse(providers.qualified_codex_role('qa')[0])

    def test_mode_a_qa_authority_is_separate_exact_and_fail_closed(self):
        slots = SimpleNamespace(MODEL_ADAPTER={'gpt-6.1-sol': 'codex'},
                                adapter_status=lambda *a: (True, 'qualified'))
        issues = SimpleNamespace(model_command=lambda: None)
        core = SimpleNamespace(live=lambda: (issues, slots))
        def authority(**request):
            return dict(request, executor_uid=1002, admitted=True, qualified=True,
                        secured=True, independent_executor=True)
        with patch.object(providers, '_import_native', return_value=core):
            self.assertFalse(providers.role_ready('codex_routing_qa')[0])
            for effort in ('medium', 'high'):
                self.assertTrue(providers.qualified_codex_role('qa', effort=effort,
                    reviewer_authority=authority)[0])
            for change in ({'model': 'gpt-6.1-sol'}, {'role': 'author'},
                           {'effort': 'low'}, {'executor': 'native:codex:1002:author'},
                           {'admitted': False}, {'qualified': False},
                           {'secured': False}, {'independent_executor': False},
                           {'executor_uid': 0}):
                self.assertFalse(providers.qualified_codex_role('qa',
                    reviewer_authority=lambda **r: dict(authority(**r), **change))[0])
            issues.mode_a_reviewer_authority = authority
            self.assertTrue(providers.role_ready('codex_routing_qa')[0])
            self.assertFalse(providers.qualified_codex_role('unknown')[0])
            self.assertFalse(providers.qualified_codex_role('author', effort='high')[0])

    def test_bound_unready_does_not_hidden_fallback(self):
        t = bound(task(), counts={p.CURSOR: 2, p.AGY: 0})
        with patch.object(providers, 'role_ready', return_value=(False, {})):
            with self.assertRaises(providers.ProviderError) as e: providers.select_author_provider(t)
        self.assertEqual(e.exception.code, 'bound_author_unavailable_hold')

    def test_rollback_future_only_claims(self):
        admission = dict(issue=527, revision='a' * 64, comment_id=12, task=task())
        with tempfile.TemporaryDirectory() as td, patch.object(providers, 'routing_qualifications', return_value=routes()):
            first = run.claim_admission(admission, results_root=td,
                config={'author_routing': {'mode': 'on', 'pipeline_revision': 'c' * 40}})
            resumed = run.claim_admission(admission, results_root=td, config={})
            self.assertEqual(first['bound_author'], resumed['bound_author'])
            self.assertEqual(first['attempts'], resumed['attempts'])
            other = copy.deepcopy(admission); other.update(issue=528, revision='d' * 64)
            self.assertNotIn('bound_author', run.claim_admission(other, results_root=td, config={}))


class Capacity(unittest.TestCase):
    def propose(self, s, chain=(), rr=None, reviewer=None):
        return h.propose_handoff(current=s.failure.binding, failure=s.failure, proof=s.proof,
            routes=routes() if rr is None else rr, reviewer=reviewer or p.Reviewer('independentQA', 'gpt-6-sol:medium', True, True, True),
            initial_provider=chain[0].failure.binding.provider if chain else s.failure.binding.provider,
            chain=chain, cumulative_attempts=len(chain) + 1, history_refs=('paid1', 'unknown_usage_preserved'))

    def test_each_capacity_direction_and_codex_after_both(self):
        for initial, second in ((p.CURSOR, p.AGY), (p.AGY, p.CURSOR)):
            a = stop(initial)
            self.assertEqual(self.propose(a)['provider'], second)
            b = stop(second, 'op2')
            result = self.propose(b, (a,))
            self.assertEqual(result['actual_provider'], 'codex_author')
            self.assertEqual(result['cumulative_attempts'], 2)
            self.assertEqual(result['reviewer'].model, 'gpt-6-sol:medium')
            self.assertEqual(self.propose(stop(p.CODEX, 'op3'), (a, b))['action'], 'HOLD')

    def test_unready_backup_and_self_qa_hold(self):
        self.assertEqual(self.propose(stop(), rr={})['action'], 'HOLD')
        self.assertEqual(self.propose(stop(), reviewer=p.Reviewer('x', p.CODEX_MODEL, True, True, True))['action'], 'HOLD')

    def test_noncapacity_and_raw_literals_never_switch(self):
        for code in ('AUTH', 'SECURITY', 'PROGRAM', 'QAFAIL', 'LOCAL_GOVERNANCE', 'unknown', 'quota exhausted'):
            s = stop(); f = p.CapacityFailure(s.failure.binding, 'evidencehash', code, 'native_top_level_error')
            self.assertEqual(self.propose(p.CapacityStop(f, s.proof))['action'], 'HOLD')
        s = stop()
        self.assertEqual(h.propose_handoff(current=s.failure.binding, failure='QUOTA_EXHAUSTED', proof=s.proof,
            routes=routes(), reviewer=p.Reviewer('qa', 'gpt-6-sol:medium', True, True, True),
            initial_provider=p.CURSOR, cumulative_attempts=1, history_refs=('history',))['action'], 'HOLD')

    def test_unknown_effects_stop_scope_identity_and_missing_retention_hold(self):
        from dataclasses import replace
        s = stop()
        for proof in (replace(s.proof, pending_unknown=True), replace(s.proof, stopped=False),
                      replace(s.proof, checkpoint_ref=''), replace(s.proof, source_reconciled=False),
                      replace(s.proof, within_scope=False), replace(s.proof, failure_fingerprint='other')):
            self.assertEqual(self.propose(p.CapacityStop(s.failure, proof))['action'], 'HOLD')

    def test_repeat_chain_refused(self):
        s = stop()
        self.assertEqual(self.propose(s, (s,))['action'], 'HOLD')


    def test_persisted_proposal_and_new_immutable_successor(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); work = root / 'work'; work.mkdir()
            (work / 'x.py').write_bytes(b'partial')
            t = bound(task())
            original = 'a' * 40
            current = h.operation(t, 'cursor_auto', original)
            observer = h.SourceRetention(baseline={'x.py': hashlib.sha256(b'old').hexdigest()},
                allowed=['x.py'], ignored=lambda n: False, source_name=lambda n: True, secrets=lambda: ())
            observer.capture(work)
            manifest = observer.persist(root, current)
            checkpoint = str(root / 'source-checkpoint/manifest.json')
            failure = p.CapacityFailure(current, 'capacity-envelope-sha', 'RATE_LIMIT', 'native_top_level_error')
            proof = p.StopProof(current, failure.fingerprint, True, True, True, False,
                checkpoint, ('native-final-receipt',), 'preserved_diff')
            admission = dict(issue=527, revision=t['revision'], comment_id=1, task=t)
            config = {'author_routing': {'mode': 'on', 'pipeline_revision': 'c' * 40}}
            with patch.object(providers, 'routing_qualifications', return_value=routes()):
                old = run.claim_admission(admission, results_root=root, config=config)
                old.update(worktree=str(work), base_sha='b' * 40, attempts={'author': 1, 'qa': 0})
                path = run.claim_path_for(admission, root); run.write_receipt(path, old)
                with patch.object(run, '_read_worktree_head_for_control', return_value=original), \
                        patch.object(run, 'role_ready', return_value=(True, {})):
                    proposal = run.record_capacity_proposal(path, t, providers.ProviderError('provider_control_failure', charge='unknown'),
                        root, lambda **kw: p.CapacityStop(failure, proof))
                self.assertEqual(proposal['action'], 'REQUIRE_NEW_ADMISSION')
                preserved = run.read_receipt(path)
                self.assertEqual(preserved['capacity_error']['charge'], 'unknown')
                self.assertEqual(preserved['attempts']['author'], 1)
                newtask = task(); newtask.update(handoff_from_revision=t['revision'],
                    checkpoint_fingerprint=manifest['fingerprint'], checkpoint_sha='c' * 40, base='c' * 40)
                successor = dict(issue=527, revision='d' * 64, comment_id=2, task=newtask)
                def git(worktree, *args):
                    if args[:2] == ('rev-parse', 'HEAD'): return 'c' * 40
                    if args[0] == 'status': return ''
                    if args[0] == 'diff': return 'x.py\0'
                    raise AssertionError(args)
                with patch.object(live, 'git', side_effect=git):
                    result = run.claim_admission(successor, results_root=root, config=config)
                self.assertEqual(result['bound_author']['decision']['provider'], p.AGY)
                self.assertEqual(result['attempts']['author'], 1)
                self.assertEqual(result['base_sha'], 'b' * 40)
                self.assertEqual(result['candidate_sha'], 'c' * 40)
                self.assertEqual(run.read_receipt(path)['capacity_successor_revision'], 'd' * 64)

    def test_internal_noncapa_errors_cannot_reach_control_decoder(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / 'claim.json'; run.write_receipt(path, {})
            for code in ('AUTH', 'SECURITY', 'SAFETY', 'PROGRAM', 'QAFAIL',
                         'LOCAL_GOVERNANCE', 'shared_budget_ineligible',
                         'agy_quota_unknown_pending_reconcile', 'cursor_exit_nonzero'):
                def forbidden(**kwargs):
                    raise AssertionError('must not interpret non-control failure')
                self.assertEqual(run.record_capacity_proposal(path, task(),
                    providers.ProviderError(code), td, forbidden)['action'], 'HOLD')

    def test_final_native_closure_and_unknown_effects_hold(self):
        s = stop(p.AGY)
        checkpoint = dict(schema='GB_UNVALIDATED_AUTHOR_CHECKPOINT_V1',
            binding=__import__('dataclasses').asdict(s.failure.binding), changed_paths=[],
            payload_hashes={}, partial_state='confirmed_empty_diff')
        checkpoint['fingerprint'] = h.fingerprint(checkpoint)
        native = dict(schema='GB_AGY_AUTHOR_RECEIPT_V1', phase='failed_no_automatic_replay',
                      executor_reap='cgroup-quiet', source_head=s.failure.binding.source_sha)
        def reconcile(**changes):
            kwargs = dict(checkpoint=checkpoint, checkpoint_ref='fixed-manifest', native_receipt=native,
                receipt_refs=('native-final',), actual_effects='RECONCILED', owned_reaped=True)
            kwargs.update(changes)
            return h.reconciled_stop(s.failure.binding, s.failure, **kwargs)
        self.assertIsNotNone(reconcile())
        self.assertIsNone(reconcile(actual_effects='UNKNOWN'))
        self.assertIsNone(reconcile(owned_reaped=False))
        for field in ('cleanup_restore_guard', 'cleanup_cgroup', 'cleanup_reap', 'receipt_persist', 'oauth_refresh'):
            self.assertIsNone(reconcile(native_receipt=dict(native, **{field: 'failed'})))


class CodexCheckpoint(unittest.TestCase):
    def test_injected_completion_and_import_failure_checkpoint_binding(self):
        for fail_import in (False, True):
            with self.subTest(fail_import=fail_import), tempfile.TemporaryDirectory() as td, ExitStack() as stack:
                root = Path(td); evidence = root / 'evidence'; evidence.mkdir()
                private = root / 'private'; private.mkdir()
                observer = SimpleNamespace(result=dict(changed_paths=['x.py'],
                    payloads={'x.py': b'new'}, deleted=[]), failure=None,
                    observe=lambda *a: None, persist=unittest.mock.Mock())
                proc = SimpleNamespace(returncode=0, pid=12345,
                    communicate=lambda **k: None, poll=lambda: 0)
                def launch(*a, **kw):
                    kw['stdout'].write(b'{"type":"turn.completed"}\n')
                    return proc
                def git(work, *args):
                    return ('b' if args == ('rev-parse', 'HEAD') and imported[0] else 'a') * 40
                imported = [False]
                def import_source(**kw):
                    imported[0] = True
                    if fail_import: raise RuntimeError('import failure')
                native = SimpleNamespace(export=lambda *a: {}, source_name=lambda n: True)
                core = SimpleNamespace(live=lambda: (SimpleNamespace(
                    model_command=lambda *a, **k: ['injected'], clean_env=lambda: {}), None))
                patches = [
                    patch.object(providers, 'role_ready', return_value=(True, {})),
                    patch.object(providers, 'mark_intent_phase'),
                    patch.object(h, 'bound_provider', return_value=('codex_author',)),
                    patch.object(h, 'SourceRetention', return_value=observer),
                    patch.object(h, 'owned_group_gone', return_value=True),
                    patch.object(live, 'require_executor_uid'),
                    patch.object(live, '_load_native', side_effect=lambda n: core if n == 'core' else native),
                    patch.object(live.tempfile, 'mkdtemp', return_value=str(private)),
                    patch.object(live, 'chown_private_tree'),
                    patch.object(live, 'git', side_effect=git),
                    patch.object(live, '_git_common_dir', return_value=root),
                    patch.object(live, 'load_short_rules', return_value=('rules', 'a'*64, root)),
                    patch.object(live, 'shared_agy_budget', return_value=SimpleNamespace(
                        remaining=lambda *a: 1, charge=lambda *a: None)),
                    patch.object(live, 'uid1002_preexec', return_value=None),
                    patch.object(live.subprocess, 'Popen', side_effect=launch),
                    patch.object(live, 'owner_safe_atomic_import', side_effect=import_source)]
                for entry in patches: stack.enter_context(entry)
                t = task(_capacity_successor=True)
                if fail_import:
                    with self.assertRaises(RuntimeError):
                        live.codex_author_live(task=t, worktree=root, evidence_dir=evidence)
                    observer.persist.assert_called_once()
                    self.assertEqual(observer.persist.call_args.args[1].source_sha, 'a' * 40)
                else:
                    result = live.codex_author_live(task=t, worktree=root, evidence_dir=evidence)
                    self.assertEqual(result['candidate_sha'], 'b' * 40)
                    observer.persist.assert_not_called()


class Retention(unittest.TestCase):
    def test_cursor_unsafe_output_holds_and_cleans_only_own_sandbox(self):
        for kind in ('secret', 'oos'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as td, ExitStack() as stack:
                root = Path(td)
                private = root / 'private'; private.mkdir()
                evidence = root / 'evidence'; evidence.mkdir()
                historical = root / 'historical-UNKNOWN'; historical.mkdir()
                (historical / 'raw').write_bytes(b'previous receipt')
                intent = evidence / 'intent.json'
                intent.write_text('{"phase":"running"}')
                def export(bridge, work):
                    (work / 'x.py').write_bytes(b'old')
                    return {'x.py': hashlib.sha256(b'old').hexdigest()}
                proc = SimpleNamespace(returncode=0, pid=12345,
                    communicate=lambda **kw: None, poll=lambda: 0, wait=lambda **kw: 0)
                def launch(*args, **kw):
                    (private / 'home' / 'private-data').write_bytes(b'private')
                    (private / 'work' / ('x.py' if kind == 'secret' else 'outside.py')).write_bytes(
                        b'TEST_SECRET' if kind == 'secret' else b'outside scope')
                    kw['stdout'].write(b'completed')
                    return proc
                native = SimpleNamespace(export=export, author_config=lambda work: {'permissions': {'allow': []}},
                    source_name=lambda name: True, CURSOR_PIN=root, AUTHOR_TOOLS='tools',
                    _stop=lambda process: None, parse_stream=lambda raw: {'completed': True})
                patches = [
                    patch.dict(os.environ, {'CURSOR_AUTH_TOKEN': 'TEST_SECRET'}),
                    patch.object(live, 'require_executor_uid'),
                    patch.object(live, '_load_native', return_value=native),
                    patch.object(live.tempfile, 'mkdtemp', return_value=str(private)),
                    patch.object(live, 'git_env', return_value={}),
                    patch.object(live, 'git', return_value='a' * 40),
                    patch.object(live, 'materialize_inputs', return_value=[]),
                    patch.object(live, 'load_short_rules', return_value=('rules', 'a' * 64, root)),
                    patch.object(live.os, 'geteuid', return_value=1002),
                    patch.object(live, '_ensure_cursor_private_root'),
                    patch.object(live, '_cursor_namespace_argv_uid1002', return_value=['injected']),
                    patch.object(live, 'uid1002_preexec', return_value=None),
                    patch.object(live, 'run_argv', return_value=SimpleNamespace(returncode=1)),
                    patch.object(live.subprocess, 'Popen', side_effect=launch),
                    patch.object(live.os, 'killpg'),
                    patch.object(h, 'owned_group_gone', return_value=True),
                    patch.object(live, '_native_snapshot_uid1002', side_effect=providers.ProviderError('unsafe_source')),
                ]
                for entry in patches: stack.enter_context(entry)
                with self.assertRaises(providers.ProviderError) as raised:
                    live.cursor_author_live(task=task(), worktree=root, evidence_dir=evidence, intent_path=intent)
                self.assertEqual(raised.exception.code, 'unsafe_source')
                receipt = json.loads(intent.read_text())
                self.assertEqual(receipt['phase'], 'HOLD_no_automatic_replay')
                self.assertEqual(receipt['checkpoint'], 'INVALID')
                self.assertFalse(private.exists())
                self.assertFalse((evidence / 'unpublished-source').exists())
                self.assertFalse((evidence / 'source-checkpoint').exists())
                self.assertEqual((historical / 'raw').read_bytes(), b'previous receipt')
                self.assertEqual((evidence / 'stream.jsonl').read_bytes(), b'completed')

    def make(self, root, **kw):
        baseline = {'x.py': hashlib.sha256(b'old').hexdigest()}
        return h.SourceRetention(baseline=baseline, allowed=['x.py'], ignored=lambda n: n.endswith('.tmp'),
            source_name=lambda n: n != '.git' and not n.startswith('.git/'), secrets=lambda: (b'OLD_SECRET', b'NEW_SECRET'), **kw)

    def test_real_process_parser_failure_partial_before_cleanup(self):
        for exit_code in (0, 3):
            with tempfile.TemporaryDirectory() as td:
                root = Path(td); (root / 'x.py').write_text('old')
                observer = self.make(root)
                seen = []
                def reap(process):
                    seen.append(process)
                    process.wait(timeout=5)
                launch = observer.popen(subprocess.Popen, reap)
                proc = launch([sys.executable, '-c', f"from pathlib import Path; Path('x.py').write_text('partial'); raise SystemExit({exit_code})"],
                    cwd=root, env={'PATH': os.environ.get('PATH', '')}, stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
                proc.communicate(input=b'original stdin', timeout=5)
                self.assertEqual(observer.result['payloads'], {'x.py': b'partial'})
                self.assertEqual(seen[0].pid, proc.pid)
                # Fake semantic/native cleanup after the subprocess, never spoof success.
                (root / 'x.py').unlink()
                manifest = observer.persist(root, h.operation(task(), 'cursor_auto', 'a' * 40))
                self.assertEqual(manifest['payload_hashes']['x.py'], hashlib.sha256(b'partial').hexdigest())
                self.assertEqual((root / 'source-checkpoint/payload-0').read_bytes(), b'partial')

    def test_oos_secret_symlink_size_and_race_hold(self):
        for kind in ('oos', 'oldsecret', 'newsecret', 'symlink', 'size', 'count'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as td:
                root = Path(td); (root / 'x.py').write_text('new')
                observer = self.make(root, max_file=30, max_files=2)
                if kind == 'oos': (root / 'y.py').write_text('oos')
                if kind == 'oldsecret': (root / 'x.py').write_bytes(b'OLD_SECRET')
                if kind == 'newsecret': (root / 'x.py').write_bytes(b'NEW_SECRET')
                if kind == 'symlink': (root / 'link').symlink_to(root / 'x.py')
                if kind == 'size': (root / 'x.py').write_bytes(b'a' * 31)
                if kind == 'count':
                    (root / 'a.tmp').write_bytes(b''); (root / 'b.tmp').write_bytes(b'')
                with self.assertRaises((h.RetentionError, OSError)): observer.capture(root)
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); (root / 'x.py').write_text('new')
            observer = self.make(root)
            original = observer.scan
            def race(*a):
                result = original(*a); (root / 'x.py').write_text('raced'); return result
            with patch.object(observer, 'scan', side_effect=race):
                with self.assertRaises(h.RetentionError): observer.capture(root)

    def test_native_reap_failure_and_observer_failure_preserve_result(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); (root / 'x.py').write_text('new')
            observer = self.make(root)
            actual = SimpleNamespace(communicate=lambda **k: ('native result', None), pid=123)
            def fail(p): raise RuntimeError('stop failed')
            sentinel = object()
            captured = []
            def popen(*a, **k): captured.append((a, k)); return actual
            proc = observer.popen(popen, fail)(['exact argv'], cwd=root, env={'X': 'Y'}, preexec_fn=sentinel)
            self.assertEqual(proc.communicate(input=b'wire', timeout=3), ('native result', None))
            self.assertIs(captured[0][1]['preexec_fn'], sentinel)
            self.assertEqual(captured[0][1]['env'], {'X': 'Y'})
            self.assertIsNone(observer.result)
            self.assertIsNotNone(observer.failure)

    def test_exact_control_tree_only(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); (root / 'x.py').write_text('new')
            control = root / '.agents/agents/native.md'; control.parent.mkdir(parents=True)
            control.write_bytes(b'exact native definition')
            observer = self.make(root, control=('.agents/agents/native.md', b'exact native definition'))
            self.assertEqual(observer.capture(root)['changed_paths'], ['x.py'])
            control.write_bytes(b'changed')
            with self.assertRaises(h.RetentionError): observer.capture(root)

    def test_ignored_secret_is_still_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); (root / 'x.py').write_text('new'); (root / 'ignore.tmp').write_bytes(b'NEW_SECRET')
            with self.assertRaises(h.RetentionError): self.make(root).capture(root)


if __name__ == '__main__':
    unittest.main()

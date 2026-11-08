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


class ProvenanceBoundary(unittest.TestCase):
    def test_controller_contract_controls_scan_and_exact_provenance(self):
        result = dict(provider='cursor_auto', candidate_sha='b' * 40)
        fake = dict(revision='a' * 64, task=dict(_bound_author={'mode': 'on'}))
        with patch.object(live, '_qa_source_bytes', side_effect=AssertionError('scan')), \
                patch.object(live, 'git', side_effect=AssertionError('git')):
            self.assertIsNone(run._author_provenance(fake, result, '/fake', 'b' * 40, 'op', '/evidence'))
        controlled = dict(fake, bound_author={'mode': 'on'})
        controlled['task'] = dict(_bound_author={'mode': 'off'}, author_provenance={'source_bytes': 'forged'})
        for missing in (None, ''):
            with patch.object(live, '_qa_source_bytes', return_value=missing):
                with self.assertRaises(run.LeanError):
                    run._author_provenance(controlled, result, '/fake', 'b' * 40, 'op', '/evidence')
        with patch.object(live, '_qa_source_bytes', side_effect=ValueError('unsafe source')):
            with self.assertRaises(ValueError):
                run._author_provenance(controlled, result, '/fake', 'b' * 40, 'op', '/evidence')
        with patch.object(live, '_qa_source_bytes', return_value='exact-source') as scan:
            proof = run._author_provenance(controlled, result, '/controlled', 'b' * 40, 'op', '/evidence')
        scan.assert_called_once_with('/controlled')
        self.assertEqual(proof['source_bytes'], 'exact-source')
        self.assertEqual(proof['executor'], 'native:cursor:1002')
        self.assertEqual(proof['revision'], controlled['revision'])
        self.assertEqual(proof['candidate_sha'], 'b' * 40)
        self.assertEqual(proof['operation_id'], 'op')


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
        with patch.object(providers, 'role_ready', side_effect=lambda role, **kw: (role != 'codex_routing_qa', {})):
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
            self.assertFalse(providers.role_ready('codex_routing_qa')[0])
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
            def authority(**request):
                return dict(request, executor_uid=1002, qualified=True, admitted=True,
                    secured=True, independent_executor=True, recipe_fingerprint='accepted')
            core = SimpleNamespace(live=lambda: (SimpleNamespace(model_command=lambda: None), None))
            with patch.object(providers, 'routing_qualifications', return_value=routes()), \
                    patch.object(providers, '_import_native', return_value=core):
                old = run.claim_admission(admission, results_root=root, config=config, reviewer_authority=authority)
                old.update(worktree=str(work), base_sha='b' * 40, attempts={'author': 1, 'qa': 0})
                path = run.claim_path_for(admission, root); run.write_receipt(path, old)
                with patch.object(run, '_read_worktree_head_for_control', return_value=original):
                    proposal = run.record_capacity_proposal(path, t, providers.ProviderError('provider_control_failure', charge='unknown'),
                        root, lambda **kw: p.CapacityStop(failure, proof), reviewer_authority=authority)
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
                    result = run.claim_admission(successor, results_root=root, config=config, reviewer_authority=authority)
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


class RootReviewerDelivery(unittest.TestCase):
    def test_default_entry_builds_and_delivers_callback(self):
        callback = lambda **kw: None
        with patch.object(live, 'build_reviewer_authority', return_value=callback), \
                patch.object(live, 'qa_dispatch', return_value={'verdict': 'PASS'}) as qa, \
                patch.object(providers, 'select_author_provider', return_value=('codex_author', '', {})) as select, \
                patch.object(live, 'codex_author_live', return_value={}) as author:
            adapters = run.default_live_adapters(results_root='unused')
            self.assertIs(adapters.reviewer_authority, callback)
            adapters.qa({})
            self.assertIs(qa.call_args.kwargs['reviewer_authority'], callback)
            adapters.author(task={})
            self.assertIs(select.call_args.kwargs['reviewer_authority'], callback)
            self.assertIs(author.call_args.kwargs['reviewer_authority'], callback)

    def test_root_authority_rechecks_missing_revoked_and_recipe(self):
        recipe = dict(model='gpt-6-sol', effort='medium', role='qa',
            executor='native:codex:1002:qa', executor_uid=1002, recipe_fingerprint='r')
        pointer = dict(path='/var/lib/gobadminton-lean/results/issue-527/x/evidence/qa-1/qa-intent-codex_sol_medium.json', sha256='s')
        accepted = dict(recipe, root_acceptance='accepted', revoked=False,
                        candidate_sha='a' * 40, operation_id='historical-sample', intent_path=pointer['path'])
        request = {k: recipe[k] for k in ('model', 'effort', 'role', 'executor')}
        with patch.object(live.os, 'geteuid', return_value=0), \
                patch.object(live, '_qa_root_config', return_value={'codex_qa_authority': {'medium': pointer}}), \
                patch.object(live, '_qa_receipt', return_value=accepted), \
                patch.object(live, '_qa_validate_completed', return_value=recipe):
            authority = live.build_reviewer_authority()
            self.assertTrue(authority(**request)['qualified'])
            # Sample SHA is provenance only; no future candidate argument exists.
            self.assertEqual(authority(**request)['sample_candidate_sha'], 'a' * 40)
            for key, value in (('revoked', True), ('root_acceptance', None)):
                with patch.dict(accepted, {key: value}):
                    self.assertIsNone(authority(**request))
            self.assertIsNone(authority(**dict(request, model='gpt-6.1-sol')))
            with patch.object(live, '_qa_validate_completed', side_effect=ValueError('stale')):
                self.assertIsNone(authority(**request))
            with patch.object(live, '_qa_root_config', return_value={}):
                self.assertIsNone(authority(**request))
        with patch.object(live.os, 'geteuid', return_value=1002):
            self.assertIsNone(live.build_reviewer_authority()(**request))
            with self.assertRaises(providers.ProviderError): live.codex_qa_probe_live()

    def test_task_json_is_not_authority_and_probe_is_not_ready(self):
        t = bound(task()); t['reviewer_authority'] = lambda **kw: {'qualified': True}
        with self.assertRaises(providers.ProviderError):
            providers.select_qa_provider(t, issue=527)
        with patch.object(live.os, 'geteuid', return_value=0), \
                patch.object(live, '_qa_root_config', return_value={'codex_qa_probe': {}}), \
                patch.object(live, '_qa_receipt', return_value={'schema': 'wrong'}):
            with self.assertRaises(providers.ProviderError): live.codex_qa_probe_live()
        with tempfile.TemporaryDirectory() as td:
            providers.prepare_qa_intent(task(), 'a' * 40, 'codex_sol_medium', td)
            with self.assertRaises(providers.ProviderError):
                providers.prepare_qa_intent(task(), 'a' * 40, 'codex_sol_medium', td)
        self.assertFalse(providers.role_ready('codex_routing_qa')[0])

    def test_integrated_proposal_uses_actual_accepted_medium_and_high(self):
        core = SimpleNamespace(live=lambda: (SimpleNamespace(model_command=lambda: None), None))
        for effort in ('medium', 'high'):
            for initial, second in ((p.CURSOR, p.AGY), (p.AGY, p.CURSOR)):
                for chained in (False, True):
                    def actual_stop(provider, op):
                        from dataclasses import replace
                        value = stop(provider, op)
                        binding = replace(value.failure.binding, scope_id=h.fingerprint(['x.py']))
                        return p.CapacityStop(replace(value.failure, binding=binding),
                                              replace(value.proof, binding=binding))
                    first = actual_stop(initial, 'op1')
                    current = actual_stop(second, 'op2') if chained else first
                    t = task(); t['_author_operation'] = current.failure.binding.operation
                    admission = dict(issue=527, revision=t['revision'], comment_id=1, task=t)
                    with tempfile.TemporaryDirectory() as td:
                        claim = run.claim_admission(admission, results_root=td)
                        claim.update(bound_author={'decision': {'provider': current.failure.binding.provider}},
                            initial_author_provider=initial, attempts={'author': 2 if chained else 1},
                            capacity_chain=[run.json.loads(run.json.dumps(
                                first, default=lambda v: __import__('dataclasses').asdict(v)))] if chained else [])
                        path = run.claim_path_for(admission, td); run.write_receipt(path, claim)
                        def authority(**request):
                            return dict(request, executor_uid=1002, qualified=True, admitted=True,
                                        secured=True, independent_executor=True, recipe_fingerprint='accepted')
                        with patch.object(providers, '_import_native', return_value=core), \
                                patch.object(providers, 'routing_qualifications', return_value=routes()), \
                                patch.object(run, '_read_worktree_head_for_control', return_value=current.failure.binding.source_sha):
                            result = run.record_capacity_proposal(path, t,
                                providers.ProviderError('provider_control_failure'), td,
                                lambda **kw: current, reviewer_authority=authority, qa_effort=effort)
                            self.assertEqual(result['action'], 'REQUIRE_NEW_ADMISSION', result)
                            self.assertEqual(result['reviewer']['model'], 'gpt-6-sol:' + effort)
                            for change in ({'model': 'gpt-6.1-sol'}, {'qualified': False},
                                           {'executor': routes()[p.CODEX].executor}):
                                bad = lambda **kw: dict(authority(**kw), **change)
                                rejected = run.record_capacity_proposal(path, t,
                                    providers.ProviderError('provider_control_failure'), td,
                                    lambda **kw: current, reviewer_authority=bad, qa_effort=effort)
                                self.assertEqual(rejected['action'], 'HOLD')

    def test_receipt_json_and_metadata_boundary(self):
        import stat
        raw = b'{"role":"qa"}'
        info = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0, st_gid=0,
            st_nlink=1, st_size=len(raw), st_dev=1, st_ino=2, st_mtime_ns=1, st_ctime_ns=1)
        directory = SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0)
        target = '/var/lib/gobadminton-lean/results/x.json'
        def metadata(path):
            return info if str(path) == target else directory
        with patch.object(Path, 'lstat', metadata), patch.object(live.os, 'open', return_value=42), \
                patch.object(live.os, 'fstat', return_value=info), \
                patch.object(live.os, 'read', return_value=raw), patch.object(live.os, 'close'):
            self.assertEqual(live._qa_protected_bytes(target, results=True), raw)
            for change in ({'st_uid': 1002}, {'st_mode': stat.S_IFREG | 0o620},
                           {'st_size': 3 << 20}, {'st_mode': stat.S_IFLNK | 0o600}):
                with patch.dict(info.__dict__, change):
                    with self.assertRaises(ValueError): live._qa_protected_bytes(target, results=True)
            with patch.dict(directory.__dict__, {'st_mode': stat.S_IFDIR | 0o777}):
                with self.assertRaises(ValueError): live._qa_protected_bytes(target, results=True)
        duplicate = b'{"role":"qa","role":"author"}'
        with patch.object(live, '_qa_protected_bytes', return_value=duplicate):
            with self.assertRaises(Exception):
                live._qa_receipt(dict(path=target, sha256=hashlib.sha256(duplicate).hexdigest()))

    def test_probe_shared_factory_and_run_once_default(self):
        admission = dict(task=task(), candidate_sha='a' * 40, evidence_dir='qa-exact', effort='high')
        with patch.object(live, '_qa_probe_admission', return_value=admission), \
                patch.object(live, 'codex_qa_live', return_value={}) as operator:
            live.codex_qa_probe_live()
            self.assertEqual(operator.call_args.kwargs['_probe'], admission)
            self.assertEqual(operator.call_args.kwargs['qa_effort'], 'high')
        with tempfile.TemporaryDirectory() as td, \
                patch.object(live, 'build_reviewer_authority', return_value=lambda **kw: None) as factory:
            result = run.run_once({'event_name': 'offline-ignored'}, config={},
                                  results_root=td, use_live_defaults=True)
            self.assertEqual(result['status'], 'ignored')
            factory.assert_called_once_with()


class Repair1Focused(unittest.TestCase):
    def test_high_only_authority_reaches_normal_selectors(self):
        core = SimpleNamespace(live=lambda: (SimpleNamespace(model_command=lambda: None), None))
        def authority(**kw):
            if kw['effort'] != 'high': return None
            return dict(kw, executor_uid=1002, admitted=True, qualified=True,
                        secured=True, independent_executor=True)
        t = bound(task())
        with patch.object(providers, '_import_native', return_value=core), \
                patch.object(providers, 'role_ready', wraps=providers.role_ready) as ready:
            self.assertEqual(providers.accepted_qa_effort(authority), 'high')
            self.assertEqual(providers.select_qa_provider(t, issue=527, reviewer_authority=authority)[0], 'codex_sol_medium')
            with patch.object(h, 'bound_provider', return_value=('cursor_auto', 'bound', {})):
                original = providers.role_ready
                def roles(role, **kw):
                    return (True, {}) if role == 'cursor_author' else original(role, **kw)
                with patch.object(providers, 'role_ready', side_effect=roles):
                    self.assertEqual(providers.select_author_provider(t, reviewer_authority=authority)[0], 'cursor_auto')
            with self.assertRaises(providers.ProviderError):
                providers.accepted_qa_effort(lambda **kw: None)

    def test_actual_scoped_binary_resolver_without_execution(self):
        binary = live.AGENT_HOME / '.local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex'
        core = SimpleNamespace(live=lambda: (SimpleNamespace(NATIVE_CODEX=str(binary)), None))
        with patch.object(providers, '_import_native', return_value=core), \
                patch.object(Path, 'is_file', return_value=True), \
                patch.object(Path, 'is_symlink', return_value=False), \
                patch.object(Path, 'read_bytes', return_value=b'native'), \
                patch.object(live.hashlib, 'sha256', return_value=SimpleNamespace(hexdigest=lambda: 'f34a4d2301892ae96c90097786bfe5dc269f187b6f69faf42a7b357b8c081e35')):
            self.assertEqual(live._qa_native_binary(), binary)
            core.live = lambda: (SimpleNamespace(NATIVE_CODEX='/obsolete/vendor/codex/codex'), None)
            with self.assertRaises(ValueError): live._qa_native_binary()

    def test_author_receipt_exact_operation_candidate_and_role(self):
        t = task()
        record = dict(schema='GB_LEAN_CLAIM_V1', task=t, issue=527, revision=t['revision'],
            candidate_sha='b'*40, author_provider='codex_author', author_provenance=dict(
                role='author', executor='native:codex:1002:author', model='gpt-6.1-sol:medium',
                candidate_sha='b'*40, revision=t['revision'], operation_id='author-op', source_bytes='bytes'))
        admission = dict(task=t, candidate_sha='b'*40, admission_ref=t['revision'],
            author_receipt={}, author_executor='native:codex:1002:author', author_operation_id='author-op')
        with patch.object(live, '_qa_receipt', return_value=record):
            self.assertEqual(live._qa_author_binding(admission), admission['author_executor'])
            for key, value in [('candidate_sha', 'c'*40), ('author_operation_id', 'old'), ('author_executor', 'arbitrary')]:
                with self.assertRaises(ValueError): live._qa_author_binding(dict(admission, **{key: value}))
            with patch.dict(record['author_provenance'], role='qa'):
                with self.assertRaises(ValueError): live._qa_author_binding(admission)

    def test_expected_factory_and_protected_completion_reject_forgery(self):
        recipe = dict(role='qa', model='gpt-6-sol', effort='high', executor_uid=1002,
                      executor='native:codex:1002:qa')
        parent = '/var/lib/gobadminton-lean/results/qa-sample'
        candidate = 'b'*40
        admission = dict(schema='GB_LEAN_QA_PROBE_ADMISSION_V1', revoked=False,
            recipe=recipe, candidate_sha=candidate, operation_id='op', admission_ref='a'*64, pipeline_revision='c'*40,
            author_executor='native:cursor:1002:author', author_operation_id='author-op',
            author_receipt={}, evidence_dir=parent, task=dict(worktree='/source'))
        argv, permissions = ['native', '--read-only'], {'/source': 'read'}
        stop = dict(pid=42, pgrp=42, start_ticks='123', uid=1002,
            argv_sha256=h.fingerprint(argv), reaped=True, group_gone=True, exit=0,
            operation_id='op', admission_ref='a'*64, evidence_dir=parent)
        raw = b'{"type":"turn.completed"}\n'
        final = json.dumps(dict(verdict='PASS', reviewed_sha=candidate, findings=[])).encode()
        pointer = lambda name, data: dict(path=parent+'/'+name, sha256=hashlib.sha256(data).hexdigest())
        intent = dict(recipe, **{k: admission[k] for k in ('candidate_sha','operation_id','admission_ref','author_executor','author_operation_id','author_receipt')},
            phase='completed', pipeline_revision='c'*40, source_before=candidate, source_after=candidate,
            readonly_bytes_before='bytes', readonly_bytes_after='bytes', actual_argv=argv,
            actual_permissions=permissions, argv_sha256=h.fingerprint(argv), argv_permissions_sha256=h.fingerprint(permissions),
            completion_proof=dict(path=parent+'/completion.json'), final_proof=pointer('final.txt',final),
            raw_proof=pointer('events.jsonl', raw), owned_stop_proof=stop, probe_admission={'admission':True},
            intent_path=parent+'/qa-intent-codex_sol_medium.json', source_path='/source', private_tmpdir='/tmp/gb-codex-lean-x/tmp')
        completion = dict(exit=0, turn_completed=True, candidate_sha=candidate, stop_record=stop,
            operator=dict(**{k: stop[k] for k in ('pid','pgrp','uid','start_ticks','argv_sha256','operation_id','admission_ref','evidence_dir')},
                          actual_argv=argv, actual_permissions=permissions, source_before='bytes'))
        def receipt(pointer):
            if pointer == {}: return {'author_provenance': {'source_bytes': 'bytes'}}
            return admission if pointer.get('admission') else completion
        with patch.object(live, '_qa_recipe', return_value=recipe), \
                patch.object(live, '_qa_author_binding', return_value=admission['author_executor']), \
                patch.object(live, '_qa_launch', return_value=(argv, permissions)), \
                patch.object(live, '_qa_receipt', side_effect=receipt), \
                patch.object(live, '_qa_protected_bytes', side_effect=lambda path, **kw: final if str(path).endswith('final.txt') else raw):
            self.assertEqual(live._qa_validate_completed(intent), recipe)
            for patch_values in (
                dict(actual_argv=['native','--unsafe'], argv_sha256=h.fingerprint(['native','--unsafe'])),
                dict(actual_permissions={'/':'write'}, argv_permissions_sha256=h.fingerprint({'/':'write'})),
                dict(owned_stop_proof=True), dict(operation_id='replay'),
                dict(private_tmpdir='/source/tmp'), dict(source_path='/other')):
                with self.assertRaises((ValueError, KeyError)):
                    live._qa_validate_completed(dict(intent, **patch_values))


class Repair2Focused(unittest.TestCase):
    def test_normal_frozen_revision_and_owner_fields(self):
        original = dict(issue=527, allowed_paths=['x.py'], _owner_requirement='retain')
        revision = 'a'*64
        runtime = dict(original, revision=revision, worktree='/source')
        record = dict(schema='GB_LEAN_CLAIM_V1', task=original, issue=527,
            revision=revision, worktree='/source', candidate_sha='b'*40,
            author_provider='codex_author', author_provenance=dict(role='author',
                executor='native:codex:1002:author', model='gpt-6.1-sol:medium',
                candidate_sha='b'*40, revision=revision, operation_id='op', source_bytes='bytes'))
        admission = dict(task=runtime, candidate_sha='b'*40, admission_ref=revision,
            author_receipt={}, author_executor='native:codex:1002:author', author_operation_id='op')
        with patch.object(live, '_qa_receipt', return_value=record):
            self.assertEqual(live._qa_author_binding(admission), admission['author_executor'])
            for values in (dict(revision='c'*64), dict(_owner_requirement='lost')):
                with self.assertRaises(ValueError):
                    live._qa_author_binding(dict(admission, task=dict(runtime, **values)))

    def test_initial_mode_a_hash_bound_facts(self):
        original = dict(issue=527, allowed_paths=['x.py'], worktree='/source')
        expected = dict(operation_id='author-op', candidate_sha='b'*40, role='author',
            executor='native:codex:1002:author', model='gpt-6.1-sol', effort='medium',
            executor_uid=1002, mode='A')
        argv, perms = ['native', '--model', 'gpt-6.1-sol'], {'/source':'write'}
        launch = dict(argv_sha256=h.fingerprint(argv), permission_config_sha256=h.fingerprint(perms),
            cli_sha256='f34a4d2301892ae96c90097786bfe5dc269f187b6f69faf42a7b357b8c081e35', prompt_sha256='d'*64)
        stop_record = dict(expected, pid=42, pgrp=42, start_ticks='12', reaped=True,
            group_gone=True, exit=0, argv_sha256=launch['argv_sha256'])
        operator = dict(expected, **launch, pid=42, pgrp=42, start_ticks='12',
            actual_argv=argv, actual_permissions=perms)
        raw, final = b'{"type":"turn.completed"}\n', b'actual source completion'
        completion = dict(expected, exit=0, turn_completed=True, pending_unknown=False,
            stop_record=stop_record, operator=operator,
            raw_sha256=hashlib.sha256(raw).hexdigest(), final_sha256=hashlib.sha256(final).hexdigest())
        origin = dict(phase='IMPORTED_COMMITTED_SOURCE_ONLY', candidate='b'*40,
            executor_uid=1002, requested_model='gpt-6.1-sol', requested_effort='medium',
            new_model_calls=1, **launch)
        scope = h.fingerprint(['x.py'])
        artifacts = dict(source_receipt=origin, task_proof=original, completion_proof=completion,
            operator_proof=operator, stop_proof=stop_record,
            source_proof=dict(expected, source_bytes='bytes', task_sha256=h.fingerprint(original), scope_sha256=scope),
            raw_proof=raw, final_proof=final)
        def fixture():
            data = {k: v if isinstance(v, bytes) else json.dumps(v).encode() for k,v in artifacts.items()}
            claim = dict(expected, schema='GB_LEAN_INITIAL_MODE_A_AUTHOR_V1', revoked=False,
                root_verified=True, revision='a'*64, task=original, scope_sha256=scope,
                author_provenance=dict(source_bytes='bytes', candidate_sha='b'*40))
            claim.update({k:dict(path='/var/lib/gobadminton-lean/results/initial/'+k,
                sha256=hashlib.sha256(v).hexdigest()) for k,v in data.items()})
            return claim, data
        admission = dict(schema='GB_LEAN_QA_PROBE_ADMISSION_V1', revoked=False, operation_id='qa-op',
            task=dict(original, revision='a'*64), admission_ref='a'*64,
            candidate_sha='b'*40, author_operation_id='author-op', author_executor=expected['executor'])
        claim, data = fixture()
        with patch.object(live, '_qa_receipt', return_value=claim), \
                patch.object(live, '_qa_protected_bytes', side_effect=lambda path, **kw: data[Path(path).name]):
            self.assertEqual(live._qa_author_binding(dict(admission, author_receipt={})), expected['executor'])
            for artifact, key, value in [('source_receipt','phase','UNKNOWN'),
                    ('completion_proof','turn_completed',False), ('stop_proof','group_gone',False)]:
                old = artifacts[artifact][key]; artifacts[artifact][key] = value
                changed, changed_data = fixture()
                with patch.object(live, '_qa_receipt', return_value=changed), \
                        patch.object(live, '_qa_protected_bytes', side_effect=lambda path, **kw: changed_data[Path(path).name]):
                    with self.assertRaises(ValueError): live._qa_author_binding(dict(admission, author_receipt={}))
                artifacts[artifact][key] = old
        # An unprotected UID1002 receipt fails at the existing read boundary.
        with patch.object(live, '_qa_protected_bytes', side_effect=ValueError('qa authority metadata')):
            with self.assertRaises(ValueError): live._qa_receipt(dict(path='/raw/receipt.json', sha256='a'*64))

    def test_execute_claim_high_capacity_boundary(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); t = bound(task()); revision=t['revision']
            admission = dict(issue=527, revision=revision, task=t)
            claim = dict(schema='GB_LEAN_CLAIM_V1', issue=527, revision=revision, task=t,
                phase='CLAIMED', attempts={'author':0,'qa':0}, bound_author=t['_bound_author'])
            path = run.claim_path_for(admission, root); run.write_receipt(path, claim)
            def authority(**request):
                return dict(request, executor_uid=1002, admitted=True, qualified=True, secured=True,
                    independent_executor=True) if request['effort']=='high' else None
            adapters = run.Adapters(author=lambda **kw:None, author_capacity=lambda **kw: stop(), reviewer_authority=authority)
            core = SimpleNamespace(live=lambda: (SimpleNamespace(model_command=lambda:None), None))
            def frozen(c, path, adapters, task): return c, str(root), 'b'*40
            lease = SimpleNamespace(acquire=lambda:None, release=lambda:None)
            captured=[]
            with ExitStack() as stack:
                for name,value in [('claim_admission',claim), ('WriterLease',lease)]:
                    stack.enter_context(patch.object(run,name,return_value=value))
                stack.enter_context(patch.object(run,'_ensure_frozen_runtime',side_effect=frozen))
                stack.enter_context(patch.object(run,'invoke_cursor_author',side_effect=providers.ProviderError('provider_control_failure')))
                stack.enter_context(patch.object(providers,'_import_native',return_value=core))
                stack.enter_context(patch.object(run,'_read_worktree_head_for_control',return_value='b'*40))
                current=h.operation(dict(t, _author_operation=run.digest({'revision':revision,'attempt':1})), 'cursor_auto','b'*40)
                failure=p.CapacityFailure(current,'capacityhash','QUOTA_EXHAUSTED','native_top_level_error')
                proof=p.StopProof(current,failure.fingerprint,True,True,True,False,'checkpoint',('native-final',),'preserved_diff')
                adapters.author_capacity=lambda **kw:p.CapacityStop(failure,proof)
                stack.enter_context(patch.object(providers,'routing_qualifications',return_value=routes()))
                actual=run.record_capacity_proposal
                def call(*args,**kw):
                    captured.append(kw['qa_effort']); return actual(*args,**kw)
                stack.enter_context(patch.object(run,'record_capacity_proposal',side_effect=call))
                result=run.execute_claim(admission,adapters,results_root=root,parent_lease=True)
                for invalid in (lambda **kw: None,
                        lambda **kw: dict(authority(**kw) or {}, model='wrong'),
                        lambda **kw: dict(authority(**kw) or {}, admitted=False),
                        lambda **kw: dict(authority(**kw) or {}, independent_executor=False)):
                    run.write_receipt(path, dict(claim, phase='CLAIMED'))
                    adapters.reviewer_authority=invalid
                    with self.assertRaises(providers.ProviderError):
                        run.execute_claim(admission,adapters,results_root=root,parent_lease=True)
            self.assertEqual(captured,['high'])
            self.assertEqual(result['reason'],'new_capacity_admission_required')
            self.assertEqual(result['claim']['reviewer_authority']['effort'],'high')

    def test_git_python_bytes_change_stable_recipe(self):
        with tempfile.TemporaryDirectory() as td:
            native=Path(td); (native/'native.py').write_text('# closure')
            binary=native/'codex'; binary.write_bytes(b'cli')
            actual=Path.read_bytes; mutated=set()
            def read(path):
                if str(path) in mutated: return b'changed executable'
                if str(path).endswith('/bin/node'): return b'node'
                return actual(path)
            with patch.object(live,'NATIVE_TRAIN',native), patch.object(live,'_qa_native_binary',return_value=binary), \
                    patch.object(live,'load_short_rules',return_value=('', 'rules', Path('/rules'))), \
                    patch.object(Path,'read_bytes',read):
                baseline=live._qa_recipe()
                for executable in ('/usr/bin/git',sys.executable):
                    mutated.add(executable)
                    self.assertNotEqual(live._qa_recipe()['recipe_fingerprint'],baseline['recipe_fingerprint'])
                    mutated.clear()
                self.assertEqual(live._qa_recipe(),baseline)
                with patch.object(live, 'QA_OUTPUT_MAX', 4096):
                    limited = live._qa_recipe()
                    self.assertNotEqual(limited['recipe_fingerprint'], baseline['recipe_fingerprint'])
                    self.assertEqual(limited['output_policy']['fsize_hard'], 4096)

    def test_exited_leader_owned_child_and_foreign_guard(self):
        import ctypes
        import time
        libc=ctypes.CDLL(None, use_errno=True)
        old=ctypes.c_int()
        self.assertEqual(libc.prctl(37, ctypes.byref(old), 0, 0, 0), 0) # GET_CHILD_SUBREAPER
        self.assertEqual(libc.prctl(36, 1, 0, 0, 0), 0)
        process=None; child=None
        try:
            # Keep the leader until its original identity has been captured.
            process=subprocess.Popen([sys.executable,'-c',
                'import os,time,sys; p=os.fork(); '
                '(time.sleep(30) if p==0 else (print(p,flush=True),sys.stdin.readline()))'],
                start_new_session=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            child=int(process.stdout.readline())
            fields=(Path('/proc')/str(process.pid)/'stat').read_text().rsplit(')',1)[1].split()
            process._lean_owned_identity=dict(pid=process.pid,pgrp=process.pid,start_ticks=fields[19])
            process.stdin.close(); process.wait(timeout=3)
            self.assertIsNotNone(process.poll())
            # Reap the adopted child so kernel group-absence verification is real.
            native=providers._import_native('native_antigravity')
            real_reap=native.reap
            def reap(popen):
                real_reap(popen)
                os.waitpid(child,0)
            with patch.object(native,'reap',side_effect=reap), \
                    patch.object(providers,'_import_native',return_value=native):
                live._kill_owned_process_group(process)
            self.assertTrue(h.owned_group_gone(process))
            foreign=SimpleNamespace(pid=os.getpid(),poll=lambda:None)
            with patch.object(os,'killpg',side_effect=AssertionError('foreign signal')):
                with self.assertRaises(live.LiveError): live._kill_owned_process_group(foreign)
        finally:
            if process:
                process.stdout.close()
            if child:
                try: os.kill(child,9)
                except ProcessLookupError: pass
                try: os.waitpid(child,0)
                except ChildProcessError: pass
            libc.prctl(36, old.value, 0, 0, 0)


class ProtectedHighSuccessor(unittest.TestCase):
    """Injected Root proof and transports only; no native/model calls."""

    def authority(self, **request):
        return dict(request, executor_uid=1002, admitted=True, qualified=True,
                    secured=True, independent_executor=True, recipe_fingerprint='accepted')

    @contextmanager
    def fixture(self):
        core = SimpleNamespace(live=lambda: (SimpleNamespace(model_command=lambda: None), None))
        with tempfile.TemporaryDirectory() as td, ExitStack() as stack:
            root = Path(td); work = root / 'work'; work.mkdir()
            (work / 'x.py').write_bytes(b'partial')
            t = bound(task()); original = 'a' * 40
            current = h.operation(t, 'cursor_auto', original)
            observer = h.SourceRetention(baseline={'x.py': hashlib.sha256(b'old').hexdigest()},
                allowed=['x.py'], ignored=lambda n: False, source_name=lambda n: True, secrets=lambda: ())
            observer.capture(work)
            manifest = observer.persist(root, current)
            failure = p.CapacityFailure(current, 'capacityhash', 'RATE_LIMIT', 'native_top_level_error')
            proof = p.StopProof(current, failure.fingerprint, True, True, True, False,
                str(root / 'source-checkpoint/manifest.json'), ('native-final',), 'preserved_diff')
            stack.enter_context(patch.object(providers, '_import_native', return_value=core))
            stack.enter_context(patch.object(providers, 'routing_qualifications', return_value=routes()))
            config = {'author_routing': {'mode': 'on', 'pipeline_revision': 'c' * 40}}
            admission = dict(issue=527, comment_id=527001, revision=t['revision'], task=t)
            high_only = lambda **kw: self.authority(**kw) if kw['effort'] == 'high' else None
            claim = run.claim_admission(admission, results_root=root, config=config, reviewer_authority=high_only)
            claim.update(worktree=str(work), base_sha='b' * 40, attempts={'author': 1, 'qa': 0})
            path = run.claim_path_for(admission, root); run.write_receipt(path, claim)
            with patch.object(run, '_read_worktree_head_for_control', return_value=original):
                proposal = run.record_capacity_proposal(path, t, providers.ProviderError('provider_control_failure'),
                    root, lambda **kw: p.CapacityStop(failure, proof), reviewer_authority=high_only, qa_effort='high')
            self.assertEqual(proposal['action'], 'REQUIRE_NEW_ADMISSION')
            newtask = task(); newtask.update(handoff_from_revision=t['revision'],
                checkpoint_fingerprint=manifest['fingerprint'], checkpoint_sha='c' * 40, base='c' * 40)
            successor = dict(issue=527, comment_id=527002, revision='d' * 64, task=newtask)
            def git(worktree, *args):
                if args[:2] == ('rev-parse', 'HEAD'): return 'c' * 40
                if args[0] == 'status': return ''
                if args[0] == 'diff': return 'x.py\0'
                raise AssertionError(args)
            with patch.object(live, 'git', side_effect=git):
                claim = run.claim_admission(successor, results_root=root, config=config,
                                            reviewer_authority=self.authority)
            claim['task'] = dict(claim['task'], _bound_author=claim['bound_author'],
                                 revision=claim['revision'], worktree=str(work))
            yield root, claim, run.claim_path_for(successor, root)

    def test_successor_high_survives_both_proofs_through_live_and_capacity(self):
        with self.fixture() as (root, claim, path):
            protected = claim['reviewer_authority']; t = claim['task']
            self.assertEqual(protected['effort'], 'high')
            self.assertEqual(providers.accepted_qa_effort(self.authority), 'medium')
            with patch.object(live, 'build_reviewer_authority', return_value=self.authority), \
                    patch.object(live, 'agy_author_live', return_value={'candidate_sha': 'c' * 40}) as author, \
                    patch.object(live, 'codex_qa_live', return_value={'verdict': 'PASS'}) as qa, \
                    patch.object(providers, 'role_ready', wraps=providers.role_ready) as ready:
                # Author availability is injected; reviewer proof remains the real predicate.
                original_ready = ready._mock_wraps
                ready.side_effect = lambda role, **kw: (True, {}) if role == 'agy_author' else original_ready(role, **kw)
                adapters = run.default_live_adapters(results_root=root)
                providers.invoke_cursor_author(task=t, worktree=t['worktree'], evidence_dir=root / 'author',
                    launcher=adapters.author, reviewer_authority=self.authority, protected_reviewer=protected)
                author.assert_called_once()
                self.assertEqual(providers.select_qa_provider(t, issue=527,
                    reviewer_authority=self.authority, protected_reviewer=protected)[0], 'codex_sol_medium')
                adapters.qa(claim)
                self.assertEqual(qa.call_args.kwargs['qa_effort'], 'high')
                self.assertEqual(qa.call_args.kwargs['protected_reviewer'], protected)
            with patch.object(providers, '_live_codex_qa', return_value=lambda **kw: dict(
                    verdict='PASS', reviewed_sha=kw['candidate_sha'], findings=[], effort=kw['qa_effort'])):
                result = providers.invoke_codex_qa(task=t, candidate_sha='c' * 40, evidence_dir=root / 'qa',
                    reviewer_authority=self.authority, protected_reviewer=protected)
                self.assertEqual(result['effort'], 'high')
            # Enter the actual native QA preflight and stop before its transport.
            with patch.object(live, 'require_executor_uid'), \
                    patch.object(providers, 'role_ready', wraps=providers.role_ready) as ready, \
                    patch.object(providers, 'prepare_qa_intent', side_effect=RuntimeError('fixture stop')):
                with self.assertRaisesRegex(RuntimeError, 'fixture stop'):
                    live.codex_qa_live(task=t, candidate_sha='c' * 40, evidence_dir=root / 'native-qa',
                        reviewer_authority=self.authority, protected_reviewer=protected)
                qa_checks = [c.kwargs['effort'] for c in ready.call_args_list
                             if c.args[0] == 'codex_routing_qa']
                self.assertEqual(qa_checks, ['high', 'high'])
            # Simulate the orchestrator's next owned author attempt and receipt.
            t['_author_operation'] = 'operation2'
            claim['attempts']['author'] += 1
            run.write_receipt(path, claim)
            current = h.operation(t, 'agy_author', 'c' * 40)
            failure = p.CapacityFailure(current, 'secondhash', 'RATE_LIMIT', 'native_top_level_error')
            proof = p.StopProof(current, failure.fingerprint, True, True, True, False,
                'checkpoint2', ('native-final2',), 'preserved_diff')
            with patch.object(run, '_read_worktree_head_for_control', return_value='c' * 40):
                result = run.record_capacity_proposal(path, t, providers.ProviderError('provider_control_failure'),
                    root, lambda **kw: p.CapacityStop(failure, proof), reviewer_authority=self.authority)
            self.assertEqual(result['reviewer']['model'], 'gpt-6-sol:high')
            self.assertEqual(run.read_receipt(path)['reviewer_authority'], protected)

    def test_revoked_or_changed_high_holds_before_effects_with_medium_valid(self):
        with self.fixture() as (root, claim, path):
            for changed in (None, 'replacement'):
                def authority(**kw):
                    if kw['effort'] == 'medium': return self.authority(**kw)
                    return None if changed is None else dict(self.authority(**kw), recipe_fingerprint=changed)
                with patch.object(live, 'build_reviewer_authority', return_value=authority), \
                        patch.object(live, 'agy_author_live') as author, \
                        patch.object(live, 'codex_qa_live') as qa, \
                        patch.object(providers, 'prepare_cursor_author_intent') as intent:
                    adapters = run.default_live_adapters(results_root=root)
                    for operation in (
                        lambda: providers.invoke_cursor_author(task=claim['task'], worktree=root, evidence_dir=root,
                            launcher=adapters.author, reviewer_authority=authority,
                            protected_reviewer=claim['reviewer_authority']),
                        lambda: adapters.qa(claim),
                        lambda: providers.invoke_codex_qa(task=claim['task'], candidate_sha='c' * 40,
                            evidence_dir=root, reviewer_authority=authority,
                            protected_reviewer=claim['reviewer_authority'])):
                        with self.assertRaises(providers.ProviderError): operation()
                    author.assert_not_called(); qa.assert_not_called(); intent.assert_not_called()
                with patch.object(run, '_read_worktree_head_for_control') as head:
                    decoder = unittest.mock.Mock()
                    result = run.record_capacity_proposal(path, claim['task'],
                        providers.ProviderError('provider_control_failure'), root, decoder, reviewer_authority=authority)
                    self.assertEqual(result['action'], 'HOLD'); decoder.assert_not_called(); head.assert_not_called()

    def test_ordinary_medium_and_task_forgery_do_not_change_protected_authority(self):
        core = SimpleNamespace(live=lambda: (SimpleNamespace(model_command=lambda: None), None))
        t = bound(task()); t.update(effort='high', qa_effort='high',
            reviewer_authority={'effort': 'high'}, protected_reviewer={'effort': 'high'})
        with patch.object(providers, '_import_native', return_value=core):
            self.assertEqual(providers.accepted_qa_effort(self.authority), 'medium')
            medium = providers.role_ready('codex_routing_qa', reviewer_authority=self.authority)[1]
            self.assertEqual(providers.select_qa_provider(t, issue=527,
                reviewer_authority=self.authority, protected_reviewer=medium)[0], 'codex_sol_medium')
            with patch.object(live, 'codex_qa_live', return_value={}) as qa:
                claim = dict(issue=527, revision=t['revision'], task=t, bound_author=t['_bound_author'],
                    reviewer_authority=medium, worktree='/fixture', candidate_sha='c' * 40)
                live.qa_dispatch(claim, reviewer_authority=self.authority)
                self.assertEqual(qa.call_args.kwargs['qa_effort'], 'medium')
                self.assertEqual(qa.call_args.kwargs['protected_reviewer'], medium)
            with self.assertRaises(providers.ProviderError):
                providers.select_qa_provider(t, issue=527, reviewer_authority=lambda **kw: None,
                                             protected_reviewer=medium)


class QAOutputBoundary(unittest.TestCase):
    """Tiny local Python children only; no installed native/provider calls."""

    def test_real_child_inherits_hard_file_bound_and_valid_output(self):
        with tempfile.TemporaryDirectory() as td, patch.object(live, 'QA_OUTPUT_MAX', 4096):
            root = Path(td)
            for kind in ('stdout', 'file', 'valid'):
                output = root / (kind + '.out')
                code = (
                    'import os,resource,sys; '
                    'assert resource.getrlimit(resource.RLIMIT_FSIZE)==(4096,4096); '
                    'assert resource.getrlimit(resource.RLIMIT_CORE)==(0,0); '
                    'os.fork() == 0 and None; '
                    + ("os.write(1,b'x'*8192); os.write(1,b'x')" if kind == 'stdout' else
                       "f=open(sys.argv[1],'wb',buffering=0); f.write(b'x'*8192); f.write(b'x')" if kind == 'file' else
                       "os.write(1,b'valid')"))
                with output.open('wb') as stream:
                    result = subprocess.run([sys.executable, '-c', code, str(root / 'direct')],
                        stdout=stream, stderr=subprocess.DEVNULL, preexec_fn=live._qa_preexec(), timeout=3)
                if kind == 'valid':
                    self.assertEqual(result.returncode, 0)
                    self.assertIn(b'valid', live._qa_output_bytes(output))
                else:
                    target = output if kind == 'stdout' else root / 'direct'
                    self.assertLessEqual(target.stat().st_size, 4096)
                    with self.assertRaises(live.LiveError): live._qa_output_bytes(target)

    def test_oversize_rejected_before_parser_for_each_capture(self):
        with tempfile.TemporaryDirectory() as td, patch.object(live, 'QA_OUTPUT_MAX', 128):
            root = Path(td)
            for name in ('events.jsonl', 'stderr', 'final.txt'):
                path = root / name
                path.write_bytes(b'x' * 129)
                with patch.object(live, 'loads', side_effect=AssertionError('parsed oversized bytes')):
                    with self.assertRaises(live.LiveError): live._codex_capacity_technical(root)
                    if name == 'events.jsonl':
                        with self.assertRaises(live.LiveError): live._codex_turn_completed(path)
                with patch.object(live.hashlib, 'sha256', side_effect=AssertionError('hashed oversized bytes')):
                    with self.assertRaises(live.LiveError): live._qa_output_bytes(path)
                path.unlink()
            events = root / 'events.jsonl'
            events.write_text('{"type":"turn.completed"}\n')
            self.assertTrue(live._codex_turn_completed(events))
            self.assertFalse(live._codex_capacity_technical(root))
            (root / 'final.txt').write_bytes(b'{"verdict":"PASS"}')
            self.assertEqual(live._qa_output_bytes(root / 'final.txt', scope=root, private=True), b'{"verdict":"PASS"}')

    def test_links_fifo_sparse_and_unstable_rejected_without_blocking(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); path = root / 'output'
            target = root / 'target'; target.write_bytes(b'valid')
            path.symlink_to(target)
            with self.assertRaises(OSError): live._qa_output_bytes(path)
            path.unlink(); os.mkfifo(path)
            with self.assertRaises(live.LiveError): live._qa_output_bytes(path)
            path.unlink(); os.link(target, path)
            with self.assertRaises(live.LiveError): live._qa_output_bytes(path)
            path.unlink()
            with path.open('wb') as stream: stream.truncate(65536)
            with self.assertRaises(live.LiveError): live._qa_output_bytes(path)
            path.write_bytes(b'valid')
            read = os.read
            def mutate(fd, size):
                raw = read(fd, size)
                path.write_bytes(b'changed')
                return raw
            with patch.object(live.os, 'read', side_effect=mutate):
                with self.assertRaises(live.LiveError): live._qa_output_bytes(path)

    def test_capture_reaps_before_collection_and_rejects_each_oversize(self):
        candidate = 'b' * 40
        for oversized in (None, 'events.jsonl', 'stderr', 'final.txt'):
            with self.subTest(oversized=oversized), tempfile.TemporaryDirectory() as td:
                root = Path(td); evidence = root / 'qa-output'
                private = root / 'private'; private.mkdir()
                process = SimpleNamespace(pid=42, returncode=0, wait=lambda **kw: 0)
                stopped = []
                final = json.dumps(dict(verdict='PASS', findings=[], reviewed_sha=candidate)).encode()
                def launch(*args, **kw):
                    self.assertIsNotNone(kw['preexec_fn'])
                    (evidence / 'intent.json').write_text('{}')
                    kw['stdout'].write('{"type":"turn.completed"}\n')
                    kw['stdout'].flush()
                    (private / 'tmp' / 'final.txt').write_bytes(final)
                    if oversized:
                        dest = private / 'tmp' / 'final.txt' if oversized == 'final.txt' else evidence / oversized
                        dest.write_bytes(b'x' * 513)
                    return process
                reader = live._qa_output_bytes
                def collect(*args, **kw):
                    self.assertTrue(stopped, 'collected before owned group reaped')
                    return reader(*args, **kw)
                with ExitStack() as stack:
                    for name, value in [('QA_OUTPUT_MAX', 512)]:
                        stack.enter_context(patch.object(live, name, value))
                    stack.enter_context(patch.object(live, 'git', return_value=candidate))
                    stack.enter_context(patch.object(live, 'load_short_rules', return_value=('rules','sha',root/'rules')))
                    stack.enter_context(patch.object(live, '_qa_native_binary', return_value=Path('/synthetic')))
                    stack.enter_context(patch.object(live, '_git_common_dir', return_value=''))
                    stack.enter_context(patch.object(live, '_qa_launch', return_value=(['synthetic'], {})))
                    stack.enter_context(patch.object(live.tempfile, 'mkdtemp', return_value=str(private)))
                    stack.enter_context(patch.object(live.subprocess, 'Popen', side_effect=launch))
                    stack.enter_context(patch.object(live, '_qa_process_identity', return_value={}))
                    stack.enter_context(patch.object(live, '_kill_owned_process_group', side_effect=lambda p: stopped.append(True)))
                    stack.enter_context(patch.object(live, '_qa_output_bytes', side_effect=collect))
                    mark = stack.enter_context(patch.object(providers, 'mark_intent_phase'))
                    parser = stack.enter_context(patch.object(providers, 'parse_codex_final', wraps=providers.parse_codex_final))
                    call = lambda: live.codex_qa_live(task=dict(worktree='/source'), candidate_sha=candidate,
                        evidence_dir=evidence, intent_path=evidence/'intent.json')
                    if oversized:
                        with self.assertRaises(providers.ProviderError) as error: call()
                        self.assertEqual(error.exception.code, 'qa_output_boundary_hold')
                        parser.assert_not_called()
                        self.assertTrue(any(c.args[1] == 'HOLD_no_automatic_replay' for c in mark.call_args_list))
                        self.assertFalse((evidence / 'final.txt').exists())
                        self.assertTrue((evidence / 'failure-stop.json').is_file())
                    else:
                        self.assertEqual(call()['verdict'], 'PASS')
                        parser.assert_called_once()

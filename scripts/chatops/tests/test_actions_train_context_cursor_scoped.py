"""Cursor export access, exact context delivery and pre-import proof, offline only."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from test_actions_train import ROOT, core, stage, req
from test_actions_train_context import accepted, TEXT
import test_actions_train_cursor as cursor_tests
from test_actions_train_cursor import stream, INIT, ASSIST, RESULT
import context_cursor_delivery as D
import context_exchange as E
import context_policy as C
import native_cursor as N


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def reference():
    return dict(path=C.CANONICAL_GIT_RULES_PATH, revision=C.RULES_COMMIT,
                sha256=C.RULES_SHA256, bytes=C.RULES_SIZE)


def user(text):
    return {'type': 'user', 'message': {'role': 'user', 'content': [{'type': 'text', 'text': text}]}}


def readonly_builder(base, command):
    # Test-only guard variant: same rw work mount, then the future ro canon mount.
    work = str(base/'work')
    canon = str(base/'work'/C.CANONICAL_GIT_RULES_PATH)
    return ['synthetic-bwrap', '--bind', work, work, '--ro-bind', canon, canon,
            '--chdir', work, '--', *command]


def verified_material(exp):
    return dict(readonly_enforced=True, export_verified_before_stdin=True,
                rules_sha256=exp['rules_sha256'], rules_size=exp['rules_size'],
                export_sha256=exp['export_sha256'])


class ReadonlyCapability(unittest.TestCase):
    def test_real_builder_is_writable_and_full_is_exact_legacy(self):
        argv = D._synthetic_namespace_argv()
        self.assertIn('--bind', argv)  # real builder completed, no host metadata read
        self.assertFalse(D.recipient_rules_readonly())
        with patch.object(D, 'export_view', return_value={C.CANONICAL_GIT_RULES_PATH: C.RULES_SHA256}), \
             patch.object(D, 'verified_cursor_workspace_rules', return_value=True):
            work = ROOT
            payload, receipt, exp = D.cursor_author_context('task', SimpleNamespace(work=work), accepted())
        self.assertEqual(payload.encode(), C.inject('task', False, work, accepted(), role='author')[0].encode())
        self.assertEqual(exp['profile'], 'full')
        self.assertEqual(receipt['context_metrics']['requested_profile'], 'scoped_v1')
        self.assertEqual(receipt['context_metrics']['effective_profile'], 'full')
        self.assertEqual(receipt['context_metrics']['fallback_reason'], 'RECIPIENT_RULES_NOT_READONLY')
        popen = Mock(); self.assertIs(D.recipient_popen(popen, exp), popen)

    def test_simulated_ro_builder_and_all_exceptions(self):
        with patch.object(N, 'cursor_namespace_argv', readonly_builder):
            self.assertTrue(D.recipient_rules_readonly())
        with patch.object(D, '_synthetic_namespace_argv', side_effect=RuntimeError('fixture')):
            self.assertFalse(D.recipient_rules_readonly())

    def test_mount_order_source_and_later_overrides_fail_closed(self):
        work = Path('/synthetic/work')
        argv = readonly_builder(work.parent, ['node'])
        self.assertTrue(D._readonly_argv(argv, work))
        head, tail = argv[:-5], argv[-5:]
        canon = str(work/C.CANONICAL_GIT_RULES_PATH)
        for extra in (['--bind', str(work), str(work)], ['--bind', canon, canon],
                      ['--tmpfs', str(work/'docs')], ['--unknown']):
            try: result = D._readonly_argv(head+extra+tail, work)
            except core.Refused: result = False
            self.assertFalse(result)
        wrong = argv.copy(); wrong[5] = '/different/rules'
        self.assertFalse(D._readonly_argv(wrong, work))


class ExportAccess(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cursor-context-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root/C.CANONICAL_GIT_RULES_PATH
        self.path.parent.mkdir(parents=True)
        self.path.write_text(TEXT, encoding='utf-8')
        self.tracked = [C.CANONICAL_GIT_RULES_PATH]
        def ls(*args, **kwargs):
            return SimpleNamespace(stdout=('\0'.join(self.tracked)+'\0').encode())
        process_patch = patch.object(D.subprocess, 'run', side_effect=ls)
        self.proc = process_patch.start()
        self.addCleanup(process_patch.stop)
        guard = patch.object(N, 'cursor_namespace_argv', readonly_builder)
        guard.start(); self.addCleanup(guard.stop)

    def probe(self, ref=None):
        return D.verified_cursor_workspace_rules(self.root, reference() if ref is None else ref)

    def deliver(self, **kwargs):
        return D.cursor_author_context('точное задание\nDO_WORK', SimpleNamespace(work=self.root), accepted(), **kwargs)

    def assert_full(self, result):
        payload, receipt, exp = result
        full, legacy = C.inject('точное задание\nDO_WORK', False, self.root, accepted(), role='author')
        self.assertEqual(payload.encode(), full.encode())
        self.assertEqual(receipt['stdin_sha256'], legacy['stdin_sha256'])
        self.assertEqual(receipt['semantic_input_bytes'], legacy['semantic_input_bytes'])
        for key, value in legacy['context_metrics'].items():
            self.assertEqual(receipt['context_metrics'][key], value)
        self.assertEqual(exp['profile'], 'full')

    def test_exact_file_and_export_equivalence_without_writes(self):
        before = {p.relative_to(self.root).as_posix(): (p.lstat().st_mtime_ns, p.lstat().st_size)
                  for p in self.root.rglob('*')}
        with patch.object(Path, 'write_bytes', side_effect=AssertionError('probe wrote')), \
             patch.object(Path, 'write_text', side_effect=AssertionError('probe wrote')), \
             patch.object(Path, 'mkdir', side_effect=AssertionError('probe wrote')):
            files = D.export_view(self.root)
            self.assertTrue(self.probe())
        self.assertEqual(files, {C.CANONICAL_GIT_RULES_PATH: C.RULES_SHA256})
        self.assertEqual(before, {p.relative_to(self.root).as_posix(): (p.lstat().st_mtime_ns, p.lstat().st_size)
                                 for p in self.root.rglob('*')})
        with tempfile.TemporaryDirectory() as out:
            bridge = SimpleNamespace(work=self.root, git=lambda *a, **k: '\0'.join(self.tracked)+'\0')
            self.assertEqual(files, N.export(bridge, Path(out)))
        args, kw = self.proc.call_args
        self.assertEqual(args[0][-2:], ['ls-files', '-z'])
        self.assertEqual(kw['env']['GIT_TERMINAL_PROMPT'], '0')

    def test_missing_wrong_sha_wrong_size_untracked_and_unreadable_fallback(self):
        for mode in ('missing', 'sha', 'size', 'untracked', 'unreadable'):
            with self.subTest(mode=mode):
                self.tracked[:] = [C.CANONICAL_GIT_RULES_PATH]
                self.path.write_text(TEXT)
                if mode == 'missing': self.path.unlink()
                if mode == 'sha': self.path.write_bytes(b'x'+TEXT.encode()[1:])
                if mode == 'size': self.path.write_text(TEXT+'x')
                if mode == 'untracked': self.tracked[:] = []
                with patch.object(N, '_source', side_effect=PermissionError()) if mode == 'unreadable' else patch.object(N, '_source', wraps=N._source):
                    self.assertFalse(self.probe())
                    self.assert_full(self.deliver())

    def test_symlink_file_parent_and_workspace_refused(self):
        real = self.root/'real.md'; self.path.rename(real); self.path.symlink_to(real)
        self.assertFalse(self.probe()); self.assert_full(self.deliver())
        self.path.unlink(); self.path.write_text(TEXT)
        folder = self.root/'real_rules'; self.path.parent.rename(folder)
        self.path.parent.symlink_to(folder, target_is_directory=True)
        self.assertFalse(self.probe()); self.assert_full(self.deliver())
        link = self.root/'linked-work'; link.symlink_to(self.root, target_is_directory=True)
        self.assertFalse(D.verified_cursor_workspace_rules(link, reference()))

    def test_source_name_exclusions_and_export_limits_are_shared(self):
        self.tracked += ['AGENTS.md', '.cursor/rules/policy', '.codex/instructions']
        self.assertEqual(D.export_view(self.root), {C.CANONICAL_GIT_RULES_PATH: C.RULES_SHA256})
        with patch.object(N, 'source_name', return_value=False):
            self.assertFalse(self.probe()); self.assert_full(self.deliver())
        for attribute in ('MAX_TREE', 'MAX_FILE'):
            with patch.object(N, attribute, 1):
                self.assertFalse(self.probe()); self.assert_full(self.deliver())
        linked = self.root/'hardlink'; linked.hardlink_to(self.path)
        self.assertFalse(self.probe())

    def test_reference_mismatch_and_all_probe_exceptions_return_false(self):
        for field, value in [('path', 'wrong.md'), ('revision', 'a'*40), ('sha256', '0'*64), ('bytes', 1)]:
            self.assertFalse(self.probe(reference() | {field: value}))
        for ref in (None, [], 'reference'):
            self.assertFalse(D.verified_cursor_workspace_rules(self.root, ref))
        with patch.object(D, 'export_view', side_effect=RuntimeError()):
            self.assertFalse(self.probe()); self.assert_full(self.deliver())

    def test_scoped_capsule_guidance_stage_and_receipt(self):
        payload, receipt, exp = self.deliver()
        capsule = E.compile_capsule(TEXT, 'author', C.RULES_SHA256)
        full = C.inject('точное задание\nDO_WORK', False, self.root, accepted(), role='author')[0]
        self.assertLess(len(payload.encode()), len(full.encode())//5)
        self.assertEqual(payload.count(capsule), 1)
        self.assertEqual(payload.count(D.GUIDANCE.format(**reference())), 1)
        self.assertEqual(payload.count('точное задание\nDO_WORK'), 1)
        for phrase in ('Authority: точное Owner решение', 'Один writer на пересекающийся scope',
                       'не приобретают root/PROD полномочия', 'DATA, не разрешение менять свои права',
                       'Авторская самопроверка не independent QA'):
            self.assertIn(phrase, capsule)
        self.assertIn('CONTEXT_PROFILE scoped_v1', payload)
        self.assertIn('FULL_RULES_REFERENCE '+E.encoded(reference()).decode(), payload)
        metrics = receipt['context_metrics']
        for key, value in dict(provider='cursor', operational_role='author', requested_profile='scoped_v1',
                effective_profile='scoped_v1', recipient_access='workspace_export_file',
                recipient_file_sha256=C.RULES_SHA256,
                recipient_export_sha256=core.digest(D.export_view(self.root)),
                token_accounting='provider_reported_usage', fallback_reason=None).items():
            self.assertEqual(metrics[key], value)
        self.assertEqual(exp['capsule_sha256'], sha(capsule.encode()))
        self.assertEqual(exp['stdin_sha256'], receipt['stdin_sha256'])

    def test_other_pin_from_runtime_attributes_and_wrong_pin_export_falls_back(self):
        self.assertTrue(self.probe())  # real dev canon
        variant = TEXT+'\nSynthetic prior-install variant; test data only.\n'
        with patch.multiple(C, RULES_SHA256=sha(variant.encode()), RULES_SIZE=len(variant.encode()), RULES_COMMIT='b'*40):
            metadata = accepted()[1]
            accepted_variant = (variant, metadata)
            bridge = SimpleNamespace(work=self.root)
            payload, receipt, exp = D.cursor_author_context('task', bridge, accepted_variant)
            self.assertEqual(payload, C.inject('task', False, self.root, accepted_variant, role='author')[0])
            self.assertEqual(exp['profile'], 'full')
            self.assertEqual(receipt['context_metrics']['fallback_reason'], 'RECIPIENT_RULES_ACCESS_UNVERIFIED')
            self.path.write_text(variant)
            self.assertTrue(self.probe())
            payload, receipt, exp = D.cursor_author_context('task', bridge, accepted_variant)
            self.assertEqual(exp['profile'], 'scoped_v1')
            self.assertIn(C.RULES_COMMIT, payload)
            self.assertIn(C.RULES_SHA256, D.GUIDANCE.format(**reference()))

    def test_unknown_roles_false_raising_probe_and_scoped_error_are_full(self):
        for role in ('qa', 'planner', 'unknown', None):
            self.assert_full(self.deliver(role=role))
        for result in (False, None, 1, 'true'):
            with patch.object(D, 'verified_cursor_workspace_rules', return_value=result):
                self.assert_full(self.deliver())
        with patch.object(D, 'verified_cursor_workspace_rules', side_effect=RuntimeError()):
            self.assert_full(self.deliver())
        inject = C.inject
        def broken(*a, **kw):
            if kw.get('context_profile') == 'scoped_v1': raise ValueError('preflight fixture')
            return inject(*a, **kw)
        with patch.object(C, 'inject', side_effect=broken):
            result = self.deliver(); self.assert_full(result)
            self.assertEqual(result[1]['context_metrics']['fallback_reason'], 'CURSOR_SCOPED_PREFLIGHT_ERROR')


class ContextProof(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cursor-proof-'); self.addCleanup(self.temp.cleanup)
        self.job = Path(self.temp.name)
        with patch.object(N, 'cursor_namespace_argv', readonly_builder), \
             patch.object(D, 'export_view', return_value={C.CANONICAL_GIT_RULES_PATH: C.RULES_SHA256}), \
             patch.object(D, 'verified_cursor_workspace_rules', return_value=True):
            self.payload, self.receipt, self.exp = D.cursor_author_context('задание', SimpleNamespace(work=self.job), accepted())
        self.exp['recipient_materialization'].update(verified_material(self.exp))
        self.raw = stream(INIT, user(self.payload), ASSIST, RESULT)
        self.path = self.job/'stream.jsonl'; self.path.write_bytes(self.raw)
        self.native = dict(transcript_sha256=sha(self.raw), source_export_sha256=self.exp['export_sha256'],
                           changed_paths=['allowed.txt'])

    def proof(self, native=True):
        return D.verify_role_received(self.job, self.exp, self.native if native else None)

    def test_exact_utf8_payload_and_init_first_are_verified_hashes_only(self):
        proof = self.proof()
        self.assertEqual(proof['schema'], 'GB_CURSOR_CONTEXT_PROOF_V1')
        self.assertEqual(proof['status'], 'VERIFIED')
        self.assertTrue(all(proof['checks'].values()))
        self.assertEqual(proof['stdin_sha256'], sha(self.payload.encode('utf-8')))
        self.assertNotIn('задание', json.dumps(proof, ensure_ascii=False))
        self.assertNotIn(self.payload, json.dumps(proof))

    def test_missing_unreadable_symlink_oversized_or_wrong_owner_is_not_proven(self):
        self.path.unlink(); self.assertEqual(self.proof()['status'], 'NOT_PROVEN')
        self.assertEqual(D.verify_role_received(None, self.exp)['status'], 'NOT_PROVEN')
        target = self.job/'real'; target.write_bytes(self.raw); self.path.symlink_to(target)
        self.assertEqual(self.proof()['status'], 'NOT_PROVEN')
        self.path.unlink(); self.path.write_bytes(self.raw)
        with patch.object(N, 'MAX_STREAM', 1): self.assertEqual(self.proof()['status'], 'NOT_PROVEN')
        with patch.object(D.os, 'geteuid', return_value=-1): self.assertEqual(self.proof()['status'], 'NOT_PROVEN')
        with patch.object(D.os, 'open', side_effect=PermissionError()): self.assertEqual(self.proof()['status'], 'NOT_PROVEN')

    def test_wrong_text_two_users_malformed_content_or_markers_mismatch(self):
        for raw in (stream(INIT, user('wrong'), ASSIST, RESULT),
                    stream(INIT, user(self.payload), user(self.payload), RESULT), b'not json\n',
                    stream(INIT, user(self.payload.replace('ROLE author', 'ROLE qa')), RESULT),
                    stream(INIT, user(self.payload.replace(C.RULES_SHA256, '0'*64)), RESULT),
                    stream(INIT, {'type': 'user', 'message': {'role': 'user', 'content': []}}, RESULT)):
            self.path.write_bytes(raw)
            self.assertEqual(self.proof(False)['status'], 'MISMATCH')

    def test_tampered_transcript_export_rules_change_and_expectation_hashes_mismatch(self):
        for field, value in [('transcript_sha256', '0'*64), ('source_export_sha256', '0'*64),
                             ('changed_paths', [C.CANONICAL_GIT_RULES_PATH])]:
            with self.subTest(field=field):
                native = self.native | {field: value}
                self.assertEqual(D.verify_role_received(self.job, self.exp, native)['status'], 'MISMATCH')
        for field in ('stdin_sha256', 'prefix_sha256', 'capsule_sha256'):
            self.assertEqual(D.verify_role_received(self.job, self.exp | {field: '0'*64})['status'], 'MISMATCH')

    def test_verified_requires_both_recipient_materialization_checks(self):
        for check in ('readonly_enforced', 'export_verified_before_stdin'):
            self.exp['recipient_materialization'].update(verified_material(self.exp))
            self.exp['recipient_materialization'][check] = False
            proof = self.proof()
            self.assertTrue(proof['checks']['rules_net_unchanged'])
            self.assertEqual(proof['status'], 'NOT_PROVEN')

    def test_gate_checks_before_delegate_only_once_and_rejects_rules_on_any_call(self):
        outbox = self.job/'cursor-author-receipt.json'
        running = dict(phase='running', job=str(self.job), rules_context=self.receipt,
                       source_export_sha256=self.exp['export_sha256'])
        outbox.write_text(json.dumps(running))
        permitted = Mock(return_value=True)
        rt = SimpleNamespace(layout=SimpleNamespace(outbox=self.job))
        gate = D.gated_permitted(permitted, SimpleNamespace(work=self.job), rt, self.exp)
        with patch.object(D, 'verify_role_received', wraps=D.verify_role_received) as verify:
            self.assertTrue(gate('allowed.txt', ['allowed.txt']))
            self.assertTrue(gate('other.txt', ['other.txt']))
            verify.assert_called_once()
        with self.assertRaises(core.Refused): gate(C.CANONICAL_GIT_RULES_PATH, ['**'])
        self.assertEqual(permitted.call_count, 2)
        for field, value in [('source_export_sha256', '0'*64), ('rules_context', {'stdin_sha256': '0'*64}),
                             ('job', None), ('phase', 'prepared')]:
            permitted.reset_mock(); outbox.write_text(json.dumps(running | {field: value}))
            gate = D.gated_permitted(permitted, None, rt, self.exp)
            with self.assertRaises(core.Refused): gate('allowed.txt', ['allowed.txt'])
            permitted.assert_not_called()
        self.assertIs(D.gated_permitted(permitted, None, None, {'profile': 'full'}), permitted)


class PreImportProof(unittest.TestCase):
    setUp = cursor_tests.SourceImport.setUp
    def call(self, *args, **kwargs):
        return cursor_tests.SourceImport.call(self, *args, **kwargs,
            popen_wrapper=D.recipient_popen, namespace=readonly_builder)

    def delivery(self):
        path = self.source/C.CANONICAL_GIT_RULES_PATH; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(TEXT)
        subprocess.run(['git', '-C', str(self.source), 'add', '--', C.CANONICAL_GIT_RULES_PATH], env=self.env, check=True)
        with patch.object(N, 'cursor_namespace_argv', readonly_builder):
            return D.cursor_author_context('точное задание', self.bridge, accepted())

    def test_verified_context_imports_and_post_proof_matches_native_transcript(self):
        delivery = self.delivery(); self.call(delivery=delivery)
        receipt = self.last_choice['native_receipt']
        self.assertEqual(receipt['phase'], 'imported')
        self.assertEqual((self.source/'allowed.txt').read_text(), 'after\n')
        self.assertEqual(D.verify_role_received(receipt['job'], delivery[2], receipt)['status'], 'VERIFIED')

    def test_recipient_nonregular_linked_or_oversized_canon_refuses_before_spawn(self):
        delivery = self.delivery()
        prompt, receipt, exp = delivery
        work = self.base/'recipient'/'work'
        work.mkdir(parents=True)
        N.export(self.bridge, work)
        path = work/C.CANONICAL_GIT_RULES_PATH
        raw = path.read_bytes()
        for kind in ('symlink', 'hardlink', 'directory', 'oversized'):
            with self.subTest(kind=kind):
                path.unlink()
                target = work/'target'
                if kind == 'symlink':
                    target.write_bytes(raw); path.symlink_to(target)
                if kind == 'hardlink':
                    target.write_bytes(raw); path.hardlink_to(target)
                if kind == 'directory': path.mkdir()
                if kind == 'oversized': path.write_bytes(b'x'*(N.MAX_FILE+1))
                popen = Mock()
                with self.assertRaises(core.Refused):
                    D.recipient_popen(popen, exp)(readonly_builder(work.parent, ['node']), cwd=work)
                popen.assert_not_called()
                self.assertFalse(exp['recipient_materialization']['export_verified_before_stdin'])
                if path.is_dir(): path.rmdir()
                else: path.unlink()
                if target.exists(): target.unlink()
                path.write_bytes(raw)

    def test_probe_to_export_rules_and_other_file_drift_refuse_before_spawn(self):
        for name in (C.CANONICAL_GIT_RULES_PATH, 'other.txt'):
            with self.subTest(name=name):
                delivery = self.delivery()
                path = self.source/name
                original = path.read_bytes()
                path.write_bytes(original+b'changed after probe')
                with self.assertRaisesRegex(core.Refused, 'before stdin'):
                    self.call(delivery=delivery)
                self.assertFalse(self.spawned)
                self.assertFalse(self.stdin_sent)
                self.assertEqual((self.source/'allowed.txt').read_text(), 'before\n')
                self.assertEqual(self.last_choice['native_receipt']['phase'], 'failed_no_automatic_replay')
                path.write_bytes(original)

    def test_transient_modify_read_restore_net_clean_is_not_immutability(self):
        delivery = self.delivery()
        observed = []
        def transient(work):
            path = work/C.CANONICAL_GIT_RULES_PATH
            raw = path.read_bytes()
            path.write_bytes(b'mutable canon during model call')
            observed.append(path.read_bytes())
            path.write_bytes(raw)
        # Legacy writable guard simulation: no pre-spawn wrapper/import gate.
        # Provider can modify/read/restore; transcript and net diff alone pass.
        prompt, receipt, exp = delivery
        cursor_tests.SourceImport.call(self, during_call=transient)
        native = self.last_choice['native_receipt']
        (Path(native['job'])/'stream.jsonl').write_bytes(stream(INIT, user(prompt), ASSIST, RESULT))
        native['transcript_sha256'] = sha((Path(native['job'])/'stream.jsonl').read_bytes())
        exp['recipient_materialization'].update(verified_material(exp), readonly_enforced=False)
        proof = D.verify_role_received(native['job'], exp, native)
        self.assertEqual(observed, [b'mutable canon during model call'])
        self.assertTrue(proof['checks']['rules_net_unchanged'])
        self.assertEqual(proof['status'], 'NOT_PROVEN')
        # For scoped delivery a writable actual argv is refused before any call,
        # even if a prior synthetic capability/expectation said read-only.
        popen = Mock()
        work = Path(native['job'])/'work'
        argv = ['bwrap', '--bind', str(work), str(work), '--chdir', str(work), '--', 'node']
        with self.assertRaises(core.Refused): D.recipient_popen(popen, exp)(argv, cwd=work)
        popen.assert_not_called()
        self.assertFalse(exp['recipient_materialization']['readonly_enforced'])

    def test_wrong_context_refuses_before_import_and_preserves_source(self):
        delivery = self.delivery()
        with self.assertRaises(core.Refused): self.call(delivery=delivery, user_text=lambda text: text+'tampered')
        self.assertEqual((self.source/'allowed.txt').read_text(), 'before\n')
        self.assertEqual(self.last_choice['native_receipt']['phase'], 'failed_no_automatic_replay')

    def test_changed_rules_refuses_even_when_allowed_by_task(self):
        delivery = self.delivery()
        self.bridge.store.data['active']['task']['allowed_paths'].append(C.CANONICAL_GIT_RULES_PATH)
        with self.assertRaises(core.Refused): self.call(output=C.CANONICAL_GIT_RULES_PATH, delivery=delivery)
        self.assertEqual((self.source/C.CANONICAL_GIT_RULES_PATH).read_text(), TEXT)
        self.assertEqual(self.last_choice['native_receipt']['phase'], 'failed_no_automatic_replay')


class CursorStage(unittest.TestCase):
    def exercise(self, *, probe=True, recover=False, retry=False, qa=False, name='author',
                 operational_role='author', missing_stream=False, readonly=True):
        with tempfile.TemporaryDirectory(prefix='cursor-stage-') as temp:
            root = Path(temp); captured = {}
            store = SimpleNamespace(data={'active': {'task': {}, 'head': 'a'*40, 'base': 'b'*40, 'attempt': 1, 'issue': 313}})
            rt = SimpleNamespace(user='test', legacy=True, home=root, key=root/'key', slot='slot1',
                layout=SimpleNamespace(repo=root, state_dir=root, worktrees=root, outbox=root),
                check_paths=Mock(), continuity=lambda: True, lease=Mock(), budget=SimpleNamespace(used=lambda *_: 0))
            real_permitted = Mock(return_value=True)
            a = SimpleNamespace(RUNTIME_READS=(), Store=lambda *_: store, atomic=Mock(),
                permitted=real_permitted, subprocess=SimpleNamespace(Popen=Mock()))
            def factory(c, s):
                return SimpleNamespace(c=c, store=s, work=root, git=Mock(), unchanged_issue=Mock(), model=Mock())
            a.Bridge = factory
            s = SimpleNamespace(Runtime=lambda *a, **k: rt, uid_of=lambda _: 1002, Hold=RuntimeError,
                read_json=lambda *a, **k: {'mode': 'active', 'owned': {'slot1': 'x'}})
            choice = dict(provider='cursor', effective_model='Auto', effort=None, role=operational_role)
            def invoke(bridge, rt, prompt, token, chosen, **kwargs):
                captured.update(prompt=prompt, gated=kwargs['permitted'] is not real_permitted,
                                popen_wrapped=getattr(kwargs['popen'], '__self__', None) is not a.subprocess)
                if captured['popen_wrapped']:
                    # Invoke stand-in models the successful pre-spawn verification.
                    material = chosen['rules_context']['recipient_materialization']
                    material.update(readonly_enforced=True, export_verified_before_stdin=True,
                        rules_sha256=C.RULES_SHA256, rules_size=C.RULES_SIZE,
                        export_sha256=core.digest({C.CANONICAL_GIT_RULES_PATH: C.RULES_SHA256}))
                raw = stream(INIT, user(prompt), ASSIST, RESULT)
                if not missing_stream: (root/'stream.jsonl').write_bytes(raw)
                chosen['native_receipt'] = dict(job=str(root), rules_context=copy.deepcopy(chosen['rules_context']),
                    transcript_sha256=sha(raw), source_export_sha256=core.digest({C.CANONICAL_GIT_RULES_PATH: C.RULES_SHA256}),
                    changed_paths=['allowed.txt'])
                return dict(provider_reported_usage={'inputTokens': 42}, observed_model_call_ids=1)
            with patch.object(stage, 'live', return_value=(a, s)), patch.object(stage, 'API', return_value=Mock()), \
                 patch.object(stage.os, 'getuid', return_value=1002), patch.object(stage.os, 'getgid', return_value=1002), \
                 patch.object(C, 'load', return_value=accepted()), patch.object(stage, 'route', return_value=choice), \
                 patch.object(D, 'export_view', return_value={C.CANONICAL_GIT_RULES_PATH: C.RULES_SHA256}), \
                 patch.object(D, 'verified_cursor_workspace_rules', return_value=probe) as access, \
                 patch.object(D, 'recipient_rules_readonly', return_value=readonly), \
                 patch.object(C, 'verified_git_rules', side_effect=AssertionError('Cursor has no git')) as git_probe, \
                 patch('native_cursor.invoke', side_effect=invoke), patch('receiver.units_quiet'):
                request = req(name, 'pr_wait')
                if recover: request['_recover'] = True
                if retry: request['_budget_preflight_retry'] = True
                bridge = stage.setup(request, {'codex': {'slot1': 'not-executed'}}, native_auth='synthetic')[5]
                bridge.model('bounded immutable task', qa=qa)
            git_probe.assert_not_called()
            if recover or retry or name != 'author': access.assert_not_called()
            receipt = bridge.routing_receipts[0]['rules_context']
            if receipt['context_metrics']['policy_profile'] == 'full':
                self.assertEqual(captured['prompt'], C.inject('bounded immutable task', False, root, accepted(), role='author')[0])
                self.assertFalse(captured['gated'])
                self.assertFalse(captured['popen_wrapped'])
            self.assertEqual(bridge.routing_receipts[0]['usage']['tokens'], {'inputTokens': 42})
            return captured, receipt

    def test_cursor_author_scoped_and_proof_after_invoke(self):
        captured, receipt = self.exercise()
        self.assertIn('CONTEXT_PROFILE scoped_v1', captured['prompt']); self.assertTrue(captured['gated'])
        self.assertEqual(receipt['context_proof']['status'], 'VERIFIED')

    def test_unverified_recovery_retry_non_author_and_unknown_role_deliver_full(self):
        for kwargs in ({'readonly': False}, {'probe': False}, {'recover': True}, {'retry': True}, {'name': 'qa'}, {'operational_role': 'unknown'}):
            with self.subTest(kwargs=kwargs):
                _, receipt = self.exercise(**kwargs)
                self.assertEqual(receipt['context_metrics']['policy_profile'], 'full')
                self.assertNotIn('context_proof', receipt)

    def test_missing_postcall_proof_is_recorded_without_crashing_import(self):
        _, receipt = self.exercise(missing_stream=True)
        self.assertEqual(receipt['context_proof']['status'], 'NOT_PROVEN')

    def test_cursor_qa_still_refused(self):
        with self.assertRaisesRegex(core.Refused, 'unimplemented native model adapter'): self.exercise(qa=True)

    def test_native_modules_match_manifest_and_owner_supplied_marker_pins(self):
        manifest = json.loads((ROOT/'scripts/chatops/actions_train/manifest.json').read_text())['files']
        for name, expected in [('native_cursor.py', '02d26f8be9766bbeb1e92dd8514dfc496c1b3e1b0fc8035c1c65cc9aba6b6089'),
                               ('native_guard.py', 'dd2e0a0c6c0dea0d353b7dc5f16c1a5d4c4c21f022947ceaa640470c59fb0762')]:
            path = 'scripts/chatops/actions_train/'+name
            self.assertEqual(sha((ROOT/path).read_bytes()), expected)
            self.assertEqual(manifest[path], expected)


if __name__ == '__main__':
    unittest.main()

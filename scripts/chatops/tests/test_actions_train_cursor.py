"""Native Cursor protocol and trusted import tests; no model, auth or host writes."""
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
from test_actions_train import core, S, A, ROOT, NOW, issue
from test_actions_train_cost_policy import cost_task
import native_cursor as N


def stream(*events):
    return b'\n'.join(json.dumps(e).encode() for e in events) + b'\n'


INIT = {'type': 'system', 'subtype': 'init', 'model': 'Auto'}
ASSIST = {'type': 'assistant', 'model_call_id': 'observed-1'}
RESULT = {'type': 'result', 'subtype': 'success', 'is_error': False,
          'usage': {'inputTokens': 12, 'outputTokens': 3}}


class Protocol(unittest.TestCase):
    def test_honest_auto_usage_without_underlying_model_or_money(self):
        r = N.parse_stream(stream(INIT, ASSIST, RESULT))
        self.assertEqual(r['effective_route'], 'Auto')
        self.assertIsNone(r['underlying_model'])
        self.assertIsNone(r['provider_internal_calls'])
        self.assertEqual(r['observed_model_call_ids'], 1)
        self.assertEqual(r['provider_reported_usage']['inputTokens'], 12)

    def test_no_inference_terminal_error_wrong_model_and_ambiguous_json_rejected(self):
        cases = [stream(INIT, RESULT), stream(INIT, ASSIST),
                 stream(INIT | {'model': 'unproven'}, ASSIST, RESULT),
                 stream(INIT, ASSIST, RESULT | {'is_error': True}),
                 stream(INIT, ASSIST, RESULT, RESULT),
                 stream(INIT, ASSIST, RESULT, ASSIST),
                 stream(INIT, ASSIST, RESULT | {'usage': {'inputTokens': True}}),
                 b'{"type":"result","type":"assistant"}\n']
        for raw in cases:
            with self.subTest(raw=raw), self.assertRaises((core.Refused, ValueError)):
                N.parse_stream(raw)

    def test_executed_insecure_shell_is_rejected_but_denied_request_is_auditable(self):
        def event(result):
            return {'type':'tool_call','subtype':'completed','tool_call':{'shellToolCall':{
                'args':{'requestedSandboxPolicy':{'type':'TYPE_INSECURE_NONE'}}, 'result':result}}}
        for result in ({'success':{}},{'failure':{}}):
            with self.assertRaises(core.Refused): N.parse_stream(stream(INIT, ASSIST, event(result), RESULT))
        N.parse_stream(stream(INIT, ASSIST, event({'rejected':{}}), RESULT))

    def test_native_config_uses_sandbox_not_shell_allowlist_escalation(self):
        c = N.author_config(Path('/tmp/example/work'))
        self.assertEqual(c['sandbox']['mode'], 'enabled')
        self.assertEqual(c['sandbox']['readBoundary'], 'system')
        self.assertFalse(any(x.startswith('Shell(') for x in c['permissions']['allow']))
        self.assertNotIn('allow_all', c['sandbox'].values())


class ProspectiveRouting(unittest.TestCase):
    def setUp(self):
        self.budget = Mock(remaining=lambda *a: 10, used=lambda *a: 2)

    def cursor_task(self):
        t = cost_task()
        t['routing_policy']['schema'] = 'GB_STAGE_COST_V2'
        t['author_routes'] = ['cursor:auto', 'codex:gpt-6.1-sol:medium']
        return t

    def test_qualified_cursor_and_unchanged_immutable_hash(self):
        t = self.cursor_task(); before = copy.deepcopy(t)
        with patch.object(N, 'available', return_value=(True, 'qualified')) as available:
            r = core.route(S, t, 'author', 'auto', self.budget, 'slot2')
        self.assertEqual(r['provider'], 'cursor')
        self.assertEqual(r['effective_model'], 'Auto')
        self.assertIsNone(r['effort'])
        available.assert_called_once_with('slot2', core.digest(t))
        self.assertEqual(t, before)

    def test_unavailable_native_uses_only_explicit_fallback(self):
        t = self.cursor_task()
        with patch.object(N, 'available', return_value=(False, 'canary mismatch')):
            r = core.route(S, t, 'author', 'auto', self.budget, 'slot2')
            self.assertEqual(r['provider'], 'codex')
            self.assertIn('cursor:auto', r['unavailable'])
            t['author_routes'] = ['cursor:auto']
            with self.assertRaises(core.Refused):
                core.route(S, t, 'author', 'auto', self.budget, 'slot2')

    def test_v1_routes_and_independent_qa_preserved(self):
        t = cost_task()
        with patch.object(N, 'available', return_value=(True, 'qualified')):
            self.assertEqual(core.route(S, t, 'author', 'auto', self.budget, 'slot2')['provider'], 'codex')
            t = self.cursor_task()
            self.assertEqual(core.route(S, t, 'qa', 'auto', self.budget, 'slot2')['provider'], 'codex')

    def test_prepared_canary_uses_existing_immutable_admission_contract(self):
        import datetime as dt
        task=json.loads((ROOT/'scripts/chatops/ops/cursor-author-canary-task.json').read_text())
        parent=issue(211,task)
        self.assertEqual(A.validate_issue(parent,NOW-dt.timedelta(days=1),NOW),task)

    def test_marker_is_exact_task_bound_and_modules_pinned(self):
        marker = {'schema': 'GB_CURSOR_AUTHOR_211_V1', 'phase': 'canary',
                  'slots': ['slot2'], 'canary_task_sha256': 'approved',
                  'modules': {n: hashlib.sha256(Path(N.__file__).with_name(n).read_bytes()).hexdigest()
                              for n in ('native_cursor.py', 'native_guard.py')}}
        with patch.object(N, 'PIN_HASHES', {}), patch.object(N, '_read', side_effect=lambda *a: json.dumps(marker).encode()):
            self.assertEqual(N.qualification('slot2', 'approved')['phase'], 'canary')
            with self.assertRaises(core.Refused): N.qualification('slot2', 'other')
            with self.assertRaises(core.Refused): N.qualification('slot1', 'approved')
            marker['modules']['native_cursor.py'] = 'bad'
            with self.assertRaises(core.Refused): N.qualification('slot2', 'approved')

    def _modules(self):
        return {n: hashlib.sha256(Path(N.__file__).with_name(n).read_bytes()).hexdigest()
                for n in ('native_cursor.py', 'native_guard.py')}

    def _bind(self, marker):
        return patch.object(N, 'PIN_HASHES', {}), patch.object(
            N, '_read', side_effect=lambda *a: json.dumps(marker).encode()), patch.object(
            N, 'invoke', side_effect=AssertionError('cursor launch is not part of route selection'))

    def test_ready_phase_uses_the_same_route_for_a_non_canary_task(self):
        marker = {'schema': 'GB_CURSOR_AUTHOR_211_V1', 'phase': 'ready',
                  'slots': ['slot1', 'slot2'], 'canary_task_sha256': '4570522a',
                  'modules': self._modules()}
        task = self.cursor_task()
        task['goal'] = 'ordinary admitted author task after role qualification'
        self.assertNotEqual(core.digest(task), marker['canary_task_sha256'])
        pins, reader, launch = self._bind(marker)
        with pins, reader, launch:
            self.assertEqual(N.qualification('slot1', core.digest(task))['phase'], 'ready')
            chosen = core.route(S, task, 'author', 'auto', self.budget, 'slot1')
            qa = self.cursor_task()
            self.assertEqual(core.route(S, qa, 'qa', 'auto', self.budget, 'slot1')['provider'], 'codex')
        self.assertEqual(chosen['provider'], 'cursor')
        self.assertEqual(chosen['requested_route'], 'cursor:auto')
        self.assertEqual(chosen['effective_model'], 'Auto')
        self.assertIsNone(chosen['effort'])
        self.assertEqual(marker['phase'], 'ready')

    def test_canary_phase_still_refuses_every_other_task_on_that_route(self):
        marker = {'schema': 'GB_CURSOR_AUTHOR_211_V1', 'phase': 'canary',
                  'slots': ['slot1', 'slot2'], 'canary_task_sha256': '4570522a',
                  'modules': self._modules()}
        task = self.cursor_task()
        task['goal'] = 'not the reviewed canary'
        pins, reader, launch = self._bind(marker)
        with pins, reader, launch:
            with self.assertRaises(core.Refused):
                N.qualification('slot2', core.digest(task))
            chosen = core.route(S, task, 'author', 'auto', self.budget, 'slot2')
            task['author_routes'] = ['cursor:auto']
            with self.assertRaises(core.Refused):
                core.route(S, task, 'author', 'auto', self.budget, 'slot2')
        self.assertEqual(chosen['provider'], 'codex')
        self.assertIn('cursor:auto', chosen['unavailable'])
        self.assertIn('reviewed train canary', chosen['unavailable']['cursor:auto'])
        self.assertEqual(marker['phase'], 'canary')

    def test_ready_marker_does_not_invent_a_cursor_route(self):
        marker = {'schema': 'GB_CURSOR_AUTHOR_211_V1', 'phase': 'ready',
                  'slots': ['slot1', 'slot2'], 'canary_task_sha256': '4570522a',
                  'modules': self._modules()}
        pins, reader, launch = self._bind(marker)
        with pins, reader, launch:
            legacy = cost_task()
            legacy.pop('routing_policy')
            self.assertEqual(core.route(S, legacy, 'author', 'auto', self.budget, 'slot2')['provider'], 'codex')
            admitted = cost_task('complex', 'standard')
            admitted['routing_policy']['schema'] = 'GB_STAGE_COST_V2'
            admitted['author_routes'] = ['codex:gpt-6.1-sol:high', 'cursor:auto']
            chosen = core.route(S, admitted, 'author', 'auto', self.budget, 'slot2')
        self.assertEqual((chosen['provider'], chosen['effective_model'], chosen['effort']),
                         ('codex', 'gpt-6.1-sol', 'high'))
        self.assertEqual(chosen['requested_route'], 'codex:gpt-6.1-sol:high')
        self.assertEqual(marker['phase'], 'ready')


class SourceImport(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='gb-native-unit-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.source = self.base/'source'; self.source.mkdir()
        subprocess.run(['git', 'init', '--quiet', str(self.source)], check=True)
        self.env = {'PATH': '/usr/bin:/bin', 'HOME': str(self.base),
                    'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}
        (self.source/'allowed.txt').write_text('before\n')
        (self.source/'other.txt').write_text('unchanged\n')
        (self.source/'AGENTS.md').write_text('Untrusted instructions must not be exported.')
        (self.source/'.gitignore').write_text('build/\nnode_modules/\n')
        subprocess.run(['git', '-C', str(self.source), 'add', '--', '.'], env=self.env, check=True)
        self.bridge = SimpleNamespace(work=self.source, env=self.env,
                git=lambda *a, **k: subprocess.run(['git', *a], cwd=self.source, env=self.env,
                        check=True, stdout=subprocess.PIPE, text=True).stdout,
                store=SimpleNamespace(data={'active': {'task': {'allowed_paths': ['allowed.txt']},
                        'issue': 211, 'attempt': 1, 'base': 'a'*40, 'head': None}}),
                c=SimpleNamespace(model_timeout=1))
        self.outbox = self.base/'outbox'; self.outbox.mkdir()
        self.rt = SimpleNamespace(slot='slot2', layout=SimpleNamespace(outbox=self.outbox), budget=Mock())

    def test_generated_outputs_use_trusted_ignore_not_mutated_candidate_rules(self):
        work = self.base/'export'; work.mkdir()
        before = N.export(self.bridge, work)
        self.assertNotIn('AGENTS.md', before)
        self.assertFalse((work/'.git').exists())
        (work/'build').mkdir()
        (work/'build/large').write_bytes(b'x'*((8 << 20)+1))
        (work/'node_modules').mkdir()
        (work/'node_modules/external').symlink_to('/nonexistent')
        (work/'.gitignore').write_text('*\n')
        (work/'unauthorized.txt').write_text('not ignored by trusted source')
        after = N.snapshot(work, self.bridge, before)
        self.assertIn('unauthorized.txt', after)
        self.assertNotIn('build/large', after)
        self.assertIn('.gitignore', after)

    def test_nonignored_symlink_output_rejected(self):
        work = self.base/'export'; work.mkdir()
        before = N.export(self.bridge, work)
        (work/'allowed.txt').unlink()
        (work/'allowed.txt').symlink_to(self.source/'other.txt')
        with self.assertRaises(core.Refused): N.snapshot(work, self.bridge, before)

    def call(self, output='allowed.txt', mode='success', *, delivery=None, user_text=None):
        choice = {'rules_context': {'commit': 'accepted', 'stdin_sha256': 'rules-and-task'}}
        prompt, expectation = 'trusted rules and task', None
        if delivery is not None:
            prompt, choice['rules_context'], expectation = delivery
        self.last_choice = choice
        calls = []
        def fake_popen(argv, **kw):
            self.assertNotIn('existing-secret-token', ' '.join(argv))
            self.assertEqual(kw['env']['AGENT_CLI_CREDENTIAL_STORE'], 'memory')
            self.assertTrue(kw['close_fds'])
            calls.append(argv)
            p = Mock(pid=987654, returncode=None)
            p.poll.side_effect = lambda: p.returncode
            def communicate(input, timeout):
                work = Path(kw['cwd'])
                if mode == 'timeout': raise subprocess.TimeoutExpired(argv, timeout)
                (work/output).write_text('existing-secret-token' if mode == 'secret' else 'after\n')
                (work/'build').mkdir(); (work/'build/test-output').write_text('generated')
                events = [INIT, ASSIST, RESULT]
                if delivery is not None:
                    text = input.decode('utf-8') if user_text is None else user_text(input.decode('utf-8'))
                    events.insert(1, {'type': 'user', 'message': {'role': 'user',
                        'content': [{'type': 'text', 'text': text}]}})
                kw['stdout'].write(stream(*events)); kw['stdout'].flush()
                p.returncode = 7 if mode == 'error' else 0
            p.communicate.side_effect = communicate
            p.wait.side_effect = lambda **k: p.returncode
            return p
        def stop(p): p.returncode = p.returncode if p.returncode is not None else -9
        def atomic(p, value): p.write_text(json.dumps(value))
        permitted = lambda name, allowed: name in allowed
        if expectation is not None:
            from context_cursor_delivery import gated_permitted
            permitted = gated_permitted(permitted, self.bridge, self.rt, expectation)
        mkdtemp = tempfile.mkdtemp
        fstat = os.fstat
        def owned_stat(fd):
            info = list(fstat(fd)); info[4] = 978
            return os.stat_result(info)
        with patch.object(N, 'qualification', return_value={}), patch.object(N.os, 'geteuid', return_value=978), \
             patch.object(N.os, 'fstat', side_effect=owned_stat), \
             patch.object(N.tempfile, 'mkdtemp', side_effect=lambda **kw: mkdtemp(prefix=kw['prefix'], dir=self.base)), \
             patch.object(N, 'cursor_namespace_argv', side_effect=lambda base, argv: argv), \
             patch.object(N, 'process_boundary', return_value={'effective_capabilities': '0'}), \
             patch.object(N, '_stop', side_effect=stop):
            return N.invoke(self.bridge, self.rt, prompt, 'existing-secret-token', choice,
                            popen=fake_popen, atomic=atomic,
                            permitted=permitted)

    def test_one_charged_call_imports_only_authorized_source(self):
        r = self.call()
        self.assertEqual((self.source/'allowed.txt').read_text(), 'after\n')
        self.assertEqual((self.source/'other.txt').read_text(), 'unchanged\n')
        self.assertFalse((self.source/'build').exists())
        self.rt.budget.charge.assert_called_once_with('slot2', 'cursor', 'author')
        receipt = json.loads((self.outbox/'cursor-author-receipt.json').read_text())
        self.assertEqual(receipt['phase'], 'imported')
        self.assertNotIn('existing-secret-token', json.dumps(receipt))

    def test_failure_timeout_offscope_and_secret_never_import(self):
        for output, mode in [('allowed.txt', 'error'), ('allowed.txt', 'timeout'),
                             ('other.txt', 'success'), ('allowed.txt', 'secret')]:
            with self.subTest(mode=mode, output=output):
                with self.assertRaises((core.Refused, subprocess.TimeoutExpired)):
                    self.call(output, mode)
                self.assertEqual((self.source/'allowed.txt').read_text(), 'before\n')
                self.assertEqual((self.source/'other.txt').read_text(), 'unchanged\n')
                receipt = json.loads((self.outbox/'cursor-author-receipt.json').read_text())
                self.assertEqual(receipt['phase'], 'failed_no_automatic_replay')


if __name__ == '__main__':
    unittest.main()

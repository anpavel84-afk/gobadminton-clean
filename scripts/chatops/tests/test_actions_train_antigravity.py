"""Offline regressions from saved #29 evidence; no provider or credentials."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'actions_train'))
import native_antigravity as N

SHA = 'a' * 40
CID = 'synthetic-conversation'


def rows():
    # Observed AGY event envelopes/states, sanitized independently of adapter.
    # Baseline advertisement is evidence, not proof of authority or execution.
    return [
        {'event': 'init', 'conversation_id': CID, 'init': {
            'model': 'claude-sonnet-5-5-medium', 'agent': 'gobadminton-text-review',
            'tools': ['finish', 'view_file', 'run_command', 'call_mcp_tool'],
            'permission_mode': 'request-review', 'json_schema': copy.deepcopy(N.SCHEMA)}},
        {'event': 'step_update', 'step_update': {'conversation_id': CID, 'step_index': 0,
            'step_type': 'user_input', 'state': 'DONE'}},
        {'event': 'step_update', 'step_update': {'conversation_id': CID, 'step_index': 1,
            'step_type': 'agent_response', 'state': 'DONE'}},
        {'event': 'step_update', 'step_update': {'conversation_id': CID, 'step_index': 2,
            'step_type': 'finish', 'state': 'DONE'}},
        {'event': 'result', 'result': {'conversation_id': CID, 'status': 'SUCCESS',
            'structured_output': {'verdict': 'PASS', 'findings': [], 'reviewed_sha': SHA},
            'usage': {'input_tokens': 12, 'output_tokens': 3}}}]


def wire(events):
    return b'\n'.join(json.dumps(e).encode() for e in events) + b'\n'


class Protocol(unittest.TestCase):
    def test_real_envelope_uses_structured_output_and_effective_receipts(self):
        events = rows()
        events[-1]['result']['response'] = 'noncanonical prose is never a verdict'
        result, receipt = N.parse_stream(wire(events), SHA)
        self.assertEqual(result, {'verdict': 'PASS', 'findings': [], 'reviewed_sha': SHA})
        self.assertEqual(receipt['effective_model'], 'claude-sonnet-5-5-medium')
        self.assertEqual(receipt['effective_tools'], events[0]['init']['tools'])
        self.assertEqual(receipt['effective_permission_mode'], 'request-review')
        self.assertEqual(receipt['transcript_sha256'], hashlib.sha256(wire(events)).hexdigest())
        self.assertEqual(receipt['tool_events'], 0)

    def test_denied_or_successful_tool_is_rejected_despite_terminal_success(self):
        for state in ('ACTIVE', 'ERROR', 'DONE'):
            events = rows()
            events.insert(3, {'event': 'step_update', 'step_update': {
                'conversation_id': CID, 'step_type': 'tool', 'tool_name': 'view_file',
                'state': state, 'tool_info': {'error': {'type': 'TOOL_ERROR'}} if state == 'ERROR' else {}}})
            with self.subTest(state=state), self.assertRaises(N.ReviewError):
                N.parse_stream(wire(events), SHA)

    def test_all_nested_denial_evidence_rejected(self):
        for item in ({'error': 'denied'}, {'state': 'ERROR'}, {'permissionDenied': True},
                     {'step_type': 'tool'}, {'tool_name': 'run_command'}, {'is_error': True}):
            events = rows()
            events[-1]['result']['nested'] = item
            with self.subTest(item=item), self.assertRaises(N.ReviewError):
                N.parse_stream(wire(events), SHA)

    def test_bad_stream_identities_and_canonical_schema_rejected(self):
        cases = []
        for key, value in (('model', 'other'), ('agent', 'other'), ('permission_mode', 'auto'),
                           ('tools', []), ('tools', ['finish', 'finish']), ('json_schema', {})):
            e = rows(); e[0]['init'][key] = value; cases.append(e)
        for patch_value in ({'status': 'ERROR'}, {'conversation_id': 'other'},
                            {'structured_output': None}, {'structured_output': {
                                'verdict': 'PASS', 'findings': ['hidden failure'], 'reviewed_sha': SHA}},
                            {'structured_output': {'verdict': 'PASS', 'findings': [], 'reviewed_sha': 'b'*40}},
                            {'usage': {'input_tokens': True}}):
            e = rows(); e[-1]['result'].update(patch_value); cases.append(e)
        e = rows(); e[2]['step_update']['state'] = 'ERROR'; cases.append(e)
        e = rows(); e[2]['step_update']['conversation_id'] = 'other'; cases.append(e)
        cases += [rows()[:-1], rows()[1:], rows()+[rows()[-1]], rows()[:-2]+rows()[-1:],
                  rows()+[{'event': 'unknown'}]]
        for e in cases:
            with self.subTest(e=e), self.assertRaises(N.ReviewError): N.parse_stream(wire(e), SHA)
        for raw in (b'{bad', b'{"event":"init","event":"result"}\n', b'\xff',
                    json.dumps({'status': 'SUCCESS', 'result': {}}).encode()):
            with self.subTest(raw=raw), self.assertRaises(N.ReviewError): N.parse_stream(raw, SHA)

    def test_exact_cli_prompt_duration_and_native_flags(self):
        cmd = N.command(90, 'PUBLIC_SOURCE_SENTINEL')
        self.assertEqual(cmd[-2:], ['-p', 'PUBLIC_SOURCE_SENTINEL'])
        self.assertEqual(cmd[cmd.index('--print-timeout') + 1], '90s')
        self.assertEqual(cmd[cmd.index('--output-format') + 1], 'stream-json')
        self.assertIn('--sandbox', cmd)
        self.assertIn('--disable-slash-commands', cmd)
        for forbidden in ('--dangerously-skip-permissions', '--continue', '--conversation', '--remote-control'):
            self.assertNotIn(forbidden, cmd)

    def test_unqualified_boundary_refuses_before_popen_or_temp_workspace(self):
        with patch.object(N.subprocess, 'Popen', side_effect=AssertionError('provider started')), \
             patch.object(N.tempfile, 'TemporaryDirectory', side_effect=AssertionError('workspace created')):
            with self.assertRaisesRegex(N.ReviewError, 'authority|boundary|qualification'):
                N.invoke('public prompt', 60)
        self.assertEqual(N.available('slot2', 'x'), (False, N.BLOCKER))


class Collection(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='gb-agy-29-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.git('init', '-q')
        self.write('pkg/a.py', 'x = 1\n')
        self.write('pkg/b.py', 'y = 2\n')
        self.write('pkg/__init__.py', '')
        self.commit()
        self.base = self.git('rev-parse', 'HEAD')

    def git(self, *args):
        return subprocess.run(['git', '-c', 'user.name=offline', '-c', 'user.email=offline@example.invalid',
            '-c', 'commit.gpgsign=false', *args], cwd=self.root,
            env=dict(os.environ, GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_NOSYSTEM='1'),
            check=True, capture_output=True, text=True).stdout.strip()

    def write(self, name, text):
        p = self.root/name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(text)

    def commit(self):
        self.git('add', '-A'); self.git('commit', '-qm', 'offline fixture')
        return self.git('rev-parse', 'HEAD')

    def test_legitimate_tokens_and_local_absolute_import_are_collected(self):
        self.write('pkg/a.py', 'from pkg.b import y\nx = y\n')
        self.write('apps/api/src/tokens.ts', 'export const tokenLifetime = 60;\n')
        head = self.commit()
        text, _ = N.collect(self.root, self.base, head, 'trusted rules and task')
        data = json.loads(text.split('DATA_JSON:\n', 1)[1])
        self.assertIn('pkg/b.py', data['files'])
        self.assertIn('apps/api/src/tokens.ts', data['files'])

    def test_js_extension_resolution_collects_typescript_dependency(self):
        self.write('apps/web/src/a.ts', 'import {x} from "./tokens.js";\n')
        self.write('apps/web/src/tokens.ts', 'export const x=1;\n')
        head = self.commit()
        text, _ = N.collect(self.root, self.base, head, 'task')
        self.assertIn('apps/web/src/tokens.ts', json.loads(text.split('DATA_JSON:\n')[1])['files'])

    def test_missing_relative_alias_or_syntax_fails_before_model_even_if_it_would_pass(self):
        for source, suffix in [('from .absent import x\n', '.py'), ('this is invalid python!\n', '.py'),
                               ('import x from "@/lib/tokens";\n', '.ts')]:
            name = 'pkg/c' + suffix; self.write(name, source); head = self.commit()
            with self.subTest(source=source), patch.object(N, 'invoke', return_value=wire(rows())) as call:
                with self.assertRaises(N.ReviewError): N.review(self.root, self.base, head, 'task', 60)
                call.assert_not_called()
            (self.root/name).unlink(); self.commit()

    def test_real_secret_traversal_symlink_binary_and_size_guards_remain(self):
        for name in ('.env', '.env.production', '.ssh/config', 'credentials.json', 'key.pem', '.git/config', '../x'):
            with self.subTest(name=name), self.assertRaises(N.ReviewError): N.safe_path(name)
        for name in ('tokens.ts', 'auth/crypto.ts', 'config/env.ts', 'design-tokens/colors.ts'):
            self.assertEqual(N.safe_path(name), name)
        for name, data in [('pkg/private.py', '-----BEGIN PRIVATE KEY-----'),
                           ('pkg/blob.py', '\0'), ('pkg/big.py', 'x'*(N.MAX_INPUT+1))]:
            self.write(name, data); head=self.commit()
            with self.subTest(name=name), self.assertRaises(N.ReviewError):
                N.collect(self.root, self.base, head, 'task')
            (self.root/name).unlink(); self.commit()
        (self.root/'pkg/link.py').symlink_to('b.py'); head=self.commit()
        with self.assertRaises(N.ReviewError): N.collect(self.root,self.base,head,'task')


class Routing(unittest.TestCase):
    def test_unqualified_agy_falls_back_without_charge_or_call(self):
        from test_actions_train import core, S
        from test_actions_train_cost_policy import cost_task
        task = cost_task(); task['routing_policy']['schema'] = 'GB_STAGE_COST_V2'
        task['qa_routes'] = ['agy:claude-sonnet-5-5-medium', 'codex:gpt-6.1-sol:medium']
        before = copy.deepcopy(task)
        budget = Mock(remaining=lambda *a:10, used=lambda *a:2)
        with patch.object(N, 'invoke', side_effect=AssertionError('model started')):
            choice = core.route(S, task, 'qa', 'auto', budget, 'slot2')
        self.assertEqual(choice['provider'], 'codex')
        self.assertIn('Antigravity QA unavailable', choice['unavailable']['agy:claude-sonnet-5-5-medium'])
        self.assertEqual(task, before)
        budget.charge.assert_not_called()


if __name__ == '__main__': unittest.main()

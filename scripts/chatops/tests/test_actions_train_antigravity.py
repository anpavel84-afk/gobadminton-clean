"""Offline regressions from saved #29 evidence; no provider or credentials."""
import copy
import hashlib
import json
import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'actions_train'))
import native_antigravity as N
import native_guard as G
_REAL_NNP = G.no_new_privileges

SHA = 'a' * 40
CID = 'synthetic-conversation'


def rows():
    # Observed AGY event envelopes/states, sanitized independently of adapter.
    # Baseline advertisement is evidence, not proof of authority or execution.
    return [
        {'event': 'init', 'conversation_id': CID, 'init': {
            'model': 'claude-sonnet-5-5-medium', 'agent': 'gobadminton-text-review',
            'tools': ['finish', 'view_file', 'run_command', 'call_mcp_tool'],
            'permission_mode': 'always-proceed', 'json_schema': copy.deepcopy(N.SCHEMA)}},
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


class CountingVerdictDecoder:
    """Count actual documents, including the prefix cost of error construction.

    Counting only attempts or error.pos-start misses R5. Counting the length
    of every document handed to raw_decode bounds copies, traversal AND error
    construction independently of timing or the implementation's own charges.
    """
    def __init__(self, decoder, work):
        self.decoder, self.work = decoder, work

    def raw_decode(self, document, idx=0):
        self.work['attempts'] += 1
        self.work['characters'] += len(document)
        return self.decoder.raw_decode(document, idx)


class EvidenceTestCase(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory(prefix='gb-agy-evidence-test-');self.addCleanup(tmp.cleanup)
        self.evidence=Path(tmp.name)/'private'
        self._evidence_patch=patch.object(N,'EVIDENCE',self.evidence)
        self._evidence_patch.start();self.addCleanup(self._evidence_patch.stop)


class Protocol(EvidenceTestCase):
    def test_real_envelope_uses_structured_output_and_effective_receipts(self):
        events = rows()
        events[-1]['result']['response'] = 'noncanonical prose is never a verdict'
        result, receipt = N.parse_stream(wire(events), SHA)
        self.assertEqual(result, {'verdict': 'PASS', 'findings': [], 'reviewed_sha': SHA})
        self.assertEqual(receipt['effective_model'], 'claude-sonnet-5-5-medium')
        self.assertEqual(receipt['effective_tools'], events[0]['init']['tools'])
        self.assertEqual(receipt['effective_permission_mode'], 'always-proceed')
        self.assertEqual(receipt['transcript_sha256'], hashlib.sha256(wire(events)).hexdigest())
        self.assertEqual(receipt['tool_events'], 0)

    def test_denied_or_successful_tool_is_rejected_despite_terminal_success(self):
        for state in ('ACTIVE', 'ERROR'):
            events = rows()
            events.insert(3, {'event': 'step_update', 'step_update': {
                'conversation_id': CID, 'step_type': 'tool', 'tool_name': 'view_file', 'step_index': 9,
                'state': state, 'tool_info': {'error': {'type': 'TOOL_ERROR'}} if state == 'ERROR' else {}}})
            with self.subTest(state=state), self.assertRaises(N.ReviewError):
                N.parse_stream(wire(events), SHA)

    def test_all_nested_denial_evidence_rejected(self):
        for item in ({'error': 'denied'}, {'state': 'ERROR'}, {'permissionDenied': True},
                     {'permission': 'DENIED'}, {'decision': 'SKIPPED'}, {'is_error': True}):
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
        self.assertNotIn('PUBLIC_SOURCE_SENTINEL',cmd)
        self.assertIn('--dangerously-skip-permissions',cmd)
        self.assertEqual(cmd[cmd.index('--input-format')+1],'stream-json')
        self.assertEqual(cmd[cmd.index('--print-timeout') + 1], '90s')
        self.assertEqual(cmd[cmd.index('--output-format') + 1], 'stream-json')
        self.assertNotIn('--sandbox', cmd)
        self.assertIn('--disable-slash-commands', cmd)
        for forbidden in ('-p','--print','--prompt','--continue', '--conversation', '--remote-control'):
            self.assertNotIn(forbidden, cmd)

    def test_unqualified_executor_refuses_before_popen_or_temp_workspace(self):
        with patch.object(N.subprocess, 'Popen', side_effect=AssertionError('provider started')), \
             patch.object(N.tempfile, 'TemporaryDirectory', side_effect=AssertionError('workspace created')):
            with patch.object(N, 'qualification', side_effect=N.ReviewError('missing qualification')):
                with self.assertRaisesRegex(N.ReviewError, 'AGY_PRECHECK_FAILED'):
                    N.invoke('public prompt', 60, work=Path('/tmp'), slot='slot2', task_hash='x', charge=Mock())
        with patch.object(N, 'qualification', side_effect=N.ReviewError('native auth unavailable')):
            self.assertEqual(N.available('slot2', 'x'), (False, 'Antigravity QA unavailable: AGY_PRECHECK_FAILED:preflight'))


class VerdictBlocks(unittest.TestCase):
    """QA canary 2026-10-25 repeated one verdict object and the adapter parse failed."""

    def parsed(self, response):
        events = rows()
        events[-1]['result']['structured_output'] = None
        events[-1]['result']['response'] = response
        return N.parse_stream(wire(events), SHA)[0]

    def block(self, **changes):
        value = {'verdict': 'PASS', 'findings': [], 'reviewed_sha': SHA}
        value.update(changes)
        return json.dumps(value, sort_keys=True, separators=(',', ':'))

    def test_one_verdict_block(self):
        self.assertEqual(self.parsed(self.block()),
                         {'verdict': 'PASS', 'findings': [], 'reviewed_sha': SHA})

    def test_three_identical_blocks_collapse_to_one(self):
        body = self.block()
        self.assertEqual(self.parsed('\n'.join((body, body, body)))['verdict'], 'PASS')
        reordered = json.dumps({'findings': [], 'reviewed_sha': SHA, 'verdict': 'PASS'})
        spaced = json.dumps({'verdict': 'PASS', 'findings': [], 'reviewed_sha': SHA}, indent=2)
        self.assertEqual(self.parsed('\n'.join((body, reordered, spaced))),
                         {'verdict': 'PASS', 'findings': [], 'reviewed_sha': SHA})

    def test_two_different_blocks_fail_closed(self):
        other = json.dumps({'verdict': 'FAIL', 'findings': ['incomplete review'],
                            'reviewed_sha': SHA}, sort_keys=True)
        with self.assertRaises(N.ReviewError):
            self.parsed(self.block() + '\n' + other)

    def test_garbage_fails(self):
        with self.assertRaises(N.ReviewError):
            self.parsed('not a verdict, just prose')

    def test_empty_response_fails(self):
        for text in ('', ' \n\t'):
            with self.subTest(text=repr(text)), self.assertRaises(N.ReviewError):
                self.parsed(text)

    def test_verdict_block_inside_code_fence_is_accepted(self):
        fenced = '```json\n' + self.block() + '\n```'
        self.assertEqual(self.parsed(fenced)['verdict'], 'PASS')
        self.assertEqual(self.parsed('```\n' + self.block() + '\n```\n')['findings'], [])

    def test_identical_verdict_nested_in_a_string_collapses(self):
        body = self.block()
        wrapped = json.dumps({'echo': body})
        self.assertEqual(self.parsed(body + '\n' + wrapped),
                         {'verdict': 'PASS', 'findings': [], 'reviewed_sha': SHA})

    def _reject(self, text):
        with self.assertRaises(N.ReviewError) as caught:
            self.parsed(text)
        self.assertEqual(caught.exception.code, 'AGY_PARSE_FAILED')

    def test_neighbor_with_extra_severity_key_fails(self):
        bad = {'verdict': 'FAIL', 'findings': ['hidden'], 'reviewed_sha': SHA, 'severity': 'high'}
        self._reject(self.block() + '\n' + json.dumps(bad))

    def test_fail_without_findings_fails(self):
        self._reject(self.block() + '\n' + json.dumps({'verdict': 'FAIL', 'reviewed_sha': SHA}))
        self._reject(self.block() + '\n' + json.dumps({'verdict': 'FAIL'}))

    def test_fail_nested_in_an_object_fails(self):
        inner = {'verdict': 'FAIL', 'findings': ['nested'], 'reviewed_sha': SHA}
        self._reject(json.dumps({'outer': inner}) + '\n' + self.block())

    def test_fail_nested_in_an_array_fails(self):
        inner = {'verdict': 'FAIL', 'findings': ['nested'], 'reviewed_sha': SHA}
        self._reject(json.dumps([{'box': [inner]}]) + '\n' + self.block())

    def test_fail_inside_a_json_string_fails(self):
        inner = json.dumps({'verdict': 'FAIL', 'findings': ['hidden'], 'reviewed_sha': SHA})
        self._reject(json.dumps({'note': inner}) + '\n' + self.block())

    def test_fail_at_depth_50_fails(self):
        node = {'verdict': 'FAIL', 'findings': ['deep'], 'reviewed_sha': SHA}
        for _ in range(50):
            node = {'wrap': node}
        self._reject(json.dumps(node) + '\n' + self.block())

    def test_encoded_fail_strings_fail_closed(self):
        """A PASS beside an encoded FAIL string must not parse as PASS.

        The encoded value may be a top-level JSON string, an array of that
        string, a double-encoded object field, or unicode escapes that hide
        both '{' and the letters verdict until the string is decoded.
        """
        passed = json.dumps({'verdict': 'PASS', 'findings': [], 'reviewed_sha': SHA})
        fail = json.dumps({'verdict': 'FAIL', 'findings': ['hidden'], 'reviewed_sha': SHA})
        unicode_fail = '"' + ''.join('\\u%04x' % ord(char) for char in fail) + '"'
        cases = (
            ('top-level json string', passed + '\n' + json.dumps(fail)),
            ('array of encoded string', passed + '\n' + json.dumps([fail])),
            ('double-encoded note', passed + '\n' + json.dumps({'note': json.dumps(fail)})),
            ('unicode-escaped string', passed + '\n' + unicode_fail),
            ('unicode-escaped string in array', passed + '\n' + '[' + unicode_fail + ']'),
        )
        for name, text in cases:
            with self.subTest(name=name):
                with self.assertRaises(N.ReviewError) as direct:
                    N.parse_verdict_response(text, SHA)
                self.assertEqual(direct.exception.code, 'AGY_PARSE_FAILED')
                self._reject(text)

    def test_only_none_structured_output_parses_text(self):
        events = rows()
        events[-1]['result']['structured_output'] = None
        events[-1]['result']['response'] = self.block()
        self.assertEqual(N.parse_stream(wire(events), SHA)[0]['verdict'], 'PASS')
        for value in (False, [], '', 0, 'x'):
            events = rows()
            events[-1]['result']['structured_output'] = value
            events[-1]['result']['response'] = self.block()
            with self.subTest(value=value):
                with self.assertRaises(N.ReviewError) as caught:
                    N.parse_stream(wire(events), SHA)
                self.assertEqual(caught.exception.code, 'AGY_PARSE_FAILED')


class GenericVerdictScanner(EvidenceTestCase):
    """The same synthetic response must fail closed at both public entry points."""

    def block(self, **changes):
        value = dict(verdict='PASS', findings=[], reviewed_sha=SHA)
        value.update(changes)
        return json.dumps(value)

    def check_response(self, response, *, accepted=False, expected=None, max_seconds=None):
        events = rows()
        events[-1]['result'].update(structured_output=None, response=response)
        raw = wire(events)
        with patch.object(N, '_guard_accidental_writes', return_value=None), \
             patch.object(N, '_restore_write_guard'), \
             patch.object(N, '_candidate_state', return_value=(SHA, '')), \
             patch.object(N, 'collect', return_value=('synthetic source', None)), \
             patch('context_policy.inject', side_effect=lambda text, *a: (text, {'sha256': 'f'*64})), \
             patch.object(N, 'invoke', return_value=(raw, {'input_delivery': 'written'})):
            calls = {
                'parse_stream': lambda: N.parse_stream(raw, SHA),
                'review': lambda: N.review(self.evidence.parent/'candidate', 'b'*40, SHA,
                    'task', 30, slot='slot2', task_hash='f'*64, charge=Mock()),
            }
            for entry, call in calls.items():
                with self.subTest(entry=entry):
                    started = time.monotonic()
                    if accepted:
                        self.assertEqual(call()[0], expected if expected is not None else
                                         dict(verdict='PASS', findings=[], reviewed_sha=SHA))
                    else:
                        with self.assertRaises(N.ReviewError) as caught:
                            call()
                        self.assertEqual(caught.exception.code, 'AGY_PARSE_FAILED')
                        self.assertEqual(caught.exception.phase, 'parse')
                    if max_seconds is not None:
                        self.assertLess(time.monotonic() - started, max_seconds, entry)

    def test_qa_r4_markdown_reference_repro(self):
        finding = ('See [file.py:42] for missing handling. ' + 'x'*63)[:100]*40
        value = dict(verdict='FAIL', findings=[finding]*60, reviewed_sha=SHA)
        response = json.dumps(value)
        self.assertEqual(len(finding), 4000)
        self.assertLess(len(response.encode()), 256 << 10)
        self.check_response(response, accepted=True, expected=value, max_seconds=2)

    def test_linear_decoder_work_for_doubling_markdown_prefixes(self):
        factory = N._verdict_decoder
        for pattern in ('[x]', '{x}', '"x', '[1.2.3]', '[2024-01-01]',
                        '[a,b]', '(see [file.py:42])'):
            previous = None
            for count in (1000, 2000, 4000, 8000):
                response = pattern * count + '\n' + self.block()
                work = dict(attempts=0, characters=0)
                with self.subTest(pattern=pattern, count=count), patch.object(
                        N, '_verdict_decoder', side_effect=lambda:
                        CountingVerdictDecoder(factory(), work)):
                    # Each assertion covers BOTH parse_stream and review.
                    self.check_response(response, accepted=True)
                    self.assertLessEqual(work['characters'], 64 * len(response) + 4096)
                    self.assertLessEqual(work['attempts'], 2 * len(response))
                    if previous is not None:
                        self.assertLessEqual(work['characters'], 2.05 * previous + 4096)
                previous = work['characters']

    def test_linear_markdown_256k_and_one_mib_timeout_backstop(self):
        for size in (262144, 1 << 20):
            response = '[x]' * ((size - len(self.block()) - 1) // 3) + '\n' + self.block()
            with self.subTest(size=size):
                self.check_response_in_child(response, accepted=True)

    def check_response_in_child(self, response, *, accepted=False):
        # A hard deadline still works if the scanner never reaches an elapsed
        # time assertion. The child exercises both parse_stream and review.
        script = '''import sys
sys.path.insert(0, sys.argv[1])
import test_actions_train_antigravity as T
case = T.GenericVerdictScanner()
case.setUp()
try:
    case.check_response(T.json.loads(sys.stdin.read()),
                        accepted=(sys.argv[2] == 'True'), max_seconds=3)
finally:
    case.doCleanups()
'''
        result = subprocess.run([sys.executable, '-c', script, str(Path(__file__).parent), str(accepted)],
            input=json.dumps(response), text=True, capture_output=True, timeout=8,
            env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_verdict_response_utf8_cap_is_separate_from_input_and_stream_caps(self):
        for response in ('x' * (1 << 20) + self.block(),
                         '🎾' * ((1 << 20) // 4) + self.block()):
            with self.subTest(unicode=response.startswith('🎾')):
                self.check_response(response, max_seconds=3)
        # At exactly the cap, including UTF-8 rather than just character count.
        block = self.block()
        response = 'x' * ((1 << 20) - len(block)) + block
        self.check_response(response, accepted=True, max_seconds=3)

    def test_hidden_fail_after_100k_markdown_prefix(self):
        fail = self.block(verdict='FAIL', findings=['hidden'])
        escaped = '"' + ''.join('\\u%04x' % ord(c) for c in fail) + '"'
        for suffix in (json.dumps({fail: 0}), json.dumps({'outer': [{fail: 0}]}),
                       '{' + escaped + ':0}',
                       json.dumps({json.dumps({fail: 0}): 0}),
                       json.dumps({'\ud800': 0}),
                       json.dumps({self.block(verdict='FAIL', findings=['\udfff']): 0}),
                       'unparsed verdict: FAIL'):
            with self.subTest(suffix=suffix):
                self.check_response('[x]' * 35000 + '\n' + self.block() + '\n' + suffix,
                                    max_seconds=3)

    def test_100_markdown_findings_under_256k_with_schema_length_boundary(self):
        pattern = '[text](url) [file.py:42] {missing} "quote" \\path '
        findings = [(pattern * 100)[:4000]] + [(pattern * 100)[:2200]] * 99
        value = dict(verdict='FAIL', findings=findings, reviewed_sha=SHA)
        response = json.dumps(value)
        self.assertLess(len(response.encode()), 256 << 10)
        self.assertEqual(len(findings), 100)
        self.assertEqual(len(findings[0]), 4000)
        self.check_response(response, accepted=True, expected=value, max_seconds=3)

    def test_decoder_window_work_precharged_across_recursive_strings(self):
        response = self.block() + '\n' + json.dumps({'echo': '[x]' * 10000})
        self.check_response(response, accepted=True)
        with patch.object(N._VerdictScanBudget, 'decode', side_effect=N.ReviewError(
                'AGY_PARSE_FAILED', 'parse')), patch.object(
                N, '_verdict_decoder', return_value=Mock(raw_decode=Mock(
                    side_effect=AssertionError('unbudgeted decode')))):
            self.check_response(response)

    def test_subcap_encoded_response_still_enforces_four_mib_byte_budget(self):
        encoded = 'x' * 800000
        for _ in range(5):
            encoded = json.dumps(encoded)
        response = self.block() + '\n' + encoded
        self.assertLess(len(response.encode()), 1 << 20)
        # Isolate retained/decoded bytes from the independent traversal gate.
        with patch.object(N, '_VERDICT_SCAN_STEPS', 8 << 20):
            self.check_response(response)
            with patch.object(N, '_VERDICT_SCAN_BYTES', 16 << 20):
                self.check_response(response, accepted=True)

    def test_markdown_punctuation_findings_at_schema_and_wire_sizes(self):
        pattern = 'See [text](http://x) [file.py:42] {missing} "quoted" \\path\\name. '
        finding = (pattern * 100)[:4000]
        for count in (60, 100):
            value = dict(verdict='FAIL', findings=[finding]*count, reviewed_sha=SHA)
            response = json.dumps(value)
            with self.subTest(count=count):
                self.assertEqual(len(finding), 4000)
                # 100 x 4000 characters alone exceed 256 KiB. Exercise both
                # the sub-256 KiB response and the actual maximum schema.
                if count == 60:
                    self.assertLess(len(response.encode()), 256 << 10)
                self.check_response(response, accepted=True, expected=value, max_seconds=2)

    def test_punctuation_prose_surrounding_single_block(self):
        prose = 'See [text](http://x) {missing} "quoted" \\path. ' * 1000
        value = dict(verdict='FAIL', findings=['missing handling'], reviewed_sha=SHA)
        body = json.dumps(value)
        for block in (body, '```json\n' + body + '\n```'):
            with self.subTest(fenced=block.startswith('```')):
                response = prose + '\n' + block + '\n' + prose
                self.assertLess(len(response.encode()), 256 << 10)
                self.check_response(response, accepted=True, expected=value, max_seconds=2)

    def test_hidden_fail_after_many_markdown_references(self):
        findings = [('See [file.py:42] for missing handling. ' + 'x'*63)[:100]*40]*60
        body = self.block(verdict='FAIL', findings=findings)
        hidden = self.block(verdict='FAIL', findings=['hidden differing result'])
        for suffix in (hidden, json.dumps({hidden: 0}),
                       '{"' + ''.join('\\u%04x' % ord(c) for c in hidden) + '":0}'):
            with self.subTest(suffix=suffix):
                self.check_response(body + '\n' + suffix)

    def test_structural_depth_63_64_65_fails_closed(self):
        for depth in (63, 64, 65):
            with self.subTest(depth=depth):
                hidden = '['*depth + self.block(verdict='FAIL', findings=['deep']) + ']'*depth
                self.check_response(self.block() + '\n' + hidden)

    def test_structural_depth_boundary_with_harmless_values(self):
        for depth in (63, 64, 65):
            with self.subTest(depth=depth):
                response = self.block() + '\n' + '['*depth + '0' + ']'*depth
                self.check_response(response, accepted=(depth == 63))

    def test_lone_surrogate_values_and_findings(self):
        for suffix in (json.dumps({'note': '\ud800'}),
                       self.block(verdict='FAIL', findings=['\udfff'])):
            with self.subTest(suffix=suffix):
                self.check_response(self.block() + '\n' + suffix)

    def test_pathological_repetitions_have_hard_timeout(self):
        # A subprocess timeout also catches a regression that never returns to
        # an elapsed-time assertion. Both public entry points run in the child.
        script = '''import sys, time
sys.path.insert(0, sys.argv[1])
import test_actions_train_antigravity as T
case = T.GenericVerdictScanner()
case.setUp()
try:
    started = time.monotonic()
    case.check_response(T.json.loads(sys.stdin.read()))
    print(time.monotonic() - started)
finally:
    case.doCleanups()
'''
        for size in (8192, 262144):
            cases = {
                'arrays': '['*size + '\n' + self.block(),
                'objects': '{"a":'*size + '\n' + self.block(),
                'array values': '[1,'*size + '\n' + self.block(),
                'unterminated string': '"' + '\\'*size,
                'key/value alternation': '{"a":['*size + '\n' + self.block(),
                'escaped quotes': '\\"'*size + '\n' + self.block(),
            }
            for name, response in cases.items():
                with self.subTest(name=name, size=size):
                    started = time.monotonic()
                    result = subprocess.run([sys.executable, '-c', script, str(Path(__file__).parent)],
                        input=json.dumps(response), text=True, capture_output=True, timeout=5,
                        env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertLess(time.monotonic() - started, 5)

    def test_one_mib_pathologies_have_hard_subprocess_timeout(self):
        for pattern in ('[', '{"a":', '[1,', '{"a":[', '\\"', '"'):
            response = (pattern * ((1 << 20) // len(pattern)))[:(1 << 20) - 1]
            if pattern == '\\"':
                response = '"' + '\\' * ((1 << 20) - 2)
            with self.subTest(pattern=pattern):
                self.check_response_in_child(response)
        self.check_response_in_child('\\"' * (((1 << 20) // 2) - 1))

    def test_quadratic_decoder_rescans_fail_closed(self):
        # Below CPython's recursion limit, each candidate reads ~300 chars.
        # Quadratic work hits the relative step cap or absolute byte budget.
        self.check_response(('['*300 + 'x')*100 + '\n' + self.block())

    def test_unterminated_escaped_quotes_cannot_undercharge_decoder_work(self):
        # Every quote starts a string whose remaining quotes are escaped. C and
        # Python scanners report its opening quote, having scanned to EOF.
        self.check_response(('\\"'*4000) + '\n' + self.block())

    def test_scan_step_cap_is_separate_from_byte_and_node_budgets(self):
        # Harmless prose normally fits. Isolate the independent step gate.
        body = self.block() + '\n' + 'ordinary prose '*20
        self.check_response(body, accepted=True)
        with patch.object(N, '_VERDICT_SCAN_STEPS', 100):
            self.check_response(body)

    def test_cpython_error_positions_and_unterminated_string_exception(self):
        import json.scanner
        decoders = [json.JSONDecoder()]
        pure = json.JSONDecoder()
        pure.parse_string = json.decoder.py_scanstring
        pure.scan_once = json.scanner.py_make_scanner(pure)
        decoders.append(pure)
        for decoder in decoders:
            for candidate, position in (('[file.py:42]', 1), ('{missing}', 1),
                                        ('[1,?', 3), ('{"a":?', 5), ('"abc\\q"', 4)):
                text = 'prefix ' + candidate
                with self.subTest(scanner=type(decoder.scan_once), candidate=candidate):
                    with self.assertRaises(json.JSONDecodeError) as caught:
                        decoder.raw_decode(text, 7)
                    # The pure scanner reports an invalid escape one char later.
                    expected = position + (decoder is pure and candidate == '"abc\\q"')
                    self.assertEqual(caught.exception.pos, 7 + expected)
            for candidate in ('"tail', '["tail', '{"a":"tail', '"' + '\\'*100):
                with self.subTest(scanner=type(decoder.scan_once), candidate=candidate):
                    with self.assertRaises(json.JSONDecodeError) as caught:
                        decoder.raw_decode(candidate)
                    self.assertEqual(caught.exception.msg, 'Unterminated string starting at')
                    self.assertEqual(caught.exception.pos, candidate.rfind('"'))

    def test_plain_key_encoded_fail(self):
        fail = self.block(verdict='FAIL', findings=['hidden'])
        self.check_response(self.block() + '\n' + json.dumps({fail: 0}))

    def test_unicode_escaped_key_encoded_fail(self):
        fail = self.block(verdict='FAIL', findings=['hidden'])
        escaped = fail.replace('verdict', '\\u0076erdict')
        for suffix in (json.dumps({escaped: 0}),
                       '{"' + ''.join('\\u%04x' % ord(c) for c in fail) + '":0}'):
            with self.subTest(suffix=suffix):
                self.check_response(self.block() + '\n' + suffix)

    def test_nested_key_encoded_fail(self):
        fail = self.block(verdict='FAIL', findings=['hidden'])
        for node in ({'outer': {fail: 0}}, [{fail: 0}],
                     {json.dumps({fail: 0}): 0}):
            with self.subTest(node=node):
                self.check_response(self.block() + '\n' + json.dumps(node))

    def test_values_inside_keys_inside_arrays(self):
        fail = self.block(verdict='FAIL', findings=['hidden'])
        node = [{json.dumps({'inside': [json.dumps({'value': fail})]}): 0}]
        self.check_response(self.block() + '\n' + json.dumps(node))

    def test_lone_surrogate_fail_block(self):
        self.check_response(self.block() + '\n' + self.block(verdict='FAIL', findings=['\ud800']))

    def test_lone_surrogate_keys(self):
        fail = self.block(verdict='FAIL', findings=['\ud800'])
        for node in ({'\ud800': 0}, {fail: 0}, {json.dumps({'\ud800': 0}): 0}):
            with self.subTest(node=node):
                self.check_response(self.block() + '\n' + json.dumps(node))

    def test_key_decode_depth_cap(self):
        # Harmless content still must not evade the depth cap through a key.
        deep = '[' * 65 + '0' + ']' * 65
        self.check_response(self.block() + '\n' + json.dumps({deep: 0}))

    def test_key_decode_byte_budget(self):
        self.check_response(self.block() + '\n' + json.dumps({'x' * 1500000: 0}))

    def test_key_decode_node_budget(self):
        self.check_response(self.block() + '\n' + json.dumps({json.dumps([0] * 100001): 0}))

    def test_malformed_key_decode_work_budget(self):
        # Each failed '[' prefix can make raw_decode rescan a long suffix.
        self.check_response(self.block() + '\n' + json.dumps({('[' * 300 + 'x') * 16: 0}))

    def test_key_decoder_rejects_duplicates_constants_and_leftovers(self):
        for key in ('{"x":0,"x":1}', '[NaN]', '[Infinity]', 'prefix verdict suffix'):
            with self.subTest(key=key):
                self.check_response(self.block() + '\n' + json.dumps({key: 0}))

    def test_generic_scanner_positive_controls(self):
        body = self.block()
        for response in (body, '\n'.join([body] * 3), '```json\n' + body + '\n```',
                         body + '\n' + json.dumps({body: 0}),
                         body + '\n' + json.dumps([{json.dumps({'echo': body}): 0}])):
            with self.subTest(response=response):
                self.check_response(response, accepted=True)


class VerdictProbeEquivalence(unittest.TestCase):
    """A full-document decoder oracle, independent of probe classification."""

    @staticmethod
    def full_candidate(decoder, text, start, budget):
        try:
            value, end = decoder.raw_decode(text, start)
        except json.JSONDecodeError as error:
            consumed = (len(text) - start if error.msg == 'Unterminated string starting at'
                        else max(1, error.pos - start))
            budget.consume(consumed)
            budget.scan(consumed)
            return None
        budget.consume(end - start)
        budget.scan(end - start)
        return value, end

    def candidate_outcome(self, decode, text, start):
        try:
            return ('decoded', decode(N._verdict_decoder(), text, start,
                                      N._VerdictScanBudget(len(text))))
        except N.ReviewError as error:
            return ('rejected', error.code)

    def assert_candidate_matches_full(self, candidate):
        text = 'ordinary prefix ' * 13 + candidate
        start = len(text) - len(candidate)
        self.assertEqual(self.candidate_outcome(N._decode_verdict_candidate, text, start),
                         self.candidate_outcome(self.full_candidate, text, start), repr(candidate))

    def test_window_boundary_values_and_errors_match_full_document(self):
        width = N._VERDICT_PROBE_WINDOW
        for size in (width - 1, width, width + 1, 2 * width):
            # Every complete candidate has exactly the requested size. The
            # number/literal may be nested because only {[" are scan starts.
            candidates = (
                '"' + 's' * (size - 2) + '"',
                '[' + '1' * (size - 2) + ']',
                '[' + ' ' * (size - 6) + 'true]',
                '{"x":"' + 's' * (size - 8) + '"}',
                '[["' + 's' * (size - 6) + '"]]',
            )
            for candidate in candidates:
                self.assertEqual(len(candidate), size)
                for suffix in ('', ' more prose', '\n[false]', '0'):
                    with self.subTest(size=size, candidate=candidate, suffix=suffix):
                        self.assert_candidate_matches_full(candidate + suffix)
        cases = [
            '[' + ' ' * (width - 1) + '?]',  # error exactly at window end
            '[' + ' ' * (width - 2) + 'true]',  # literal straddles end
            '[' + ' ' * (width - 2) + '1e+20]',  # partial number is not an error
            '[' + ' ' * (width - 3) + '1.25]',
            '["' + 'x' * (width - 5) + '\\u0076"]',
            '["' + 'x' * (width - 5) + '\\u00',
            '["' + 'x' * (width - 5) + '\\q"]',
            '{"x":0,"x":1}', '[NaN]', '[Infinity]', '[-Infinity]',
            '["\\ud800"]', '["\\udfff"]', '["\\ud83c\\udfbe"]',
        ]
        for offset in range(width - 18, width + 2):
            for token in ('true', 'false', 'null', 'NaN', 'Infinity', '-Infinity',
                          '1e+23', '-12.34e-56', '"\\u0076"', '"\\u12', '"\\ud800"'):
                cases.append('[' + ' ' * offset + token + ']')
        for candidate in cases:
            with self.subTest(candidate=candidate):
                self.assert_candidate_matches_full(candidate)

    def test_seeded_4000_candidates_and_responses_match_full_decoder(self):
        rng = random.Random(30405)
        atoms = ['[x]', '{x}', '[1.2.3]', '[2024-01-01]', '[a,b]',
                 '{"x":0,"x":1}', '[NaN]', '[Infinity]', '[-Infinity]',
                 '"\\u0076erdict"', '"\\ud800"', '"\\udfff"', '"\\u12',
                 '"trailing\\', '["\\q"]', '["\\ud83c\\udfbe"]',
                 '{"verdict":"FAIL"}', '[[{"nested":[true,false,null]}]]']
        passed = json.dumps(dict(verdict='PASS', findings=[], reviewed_sha=SHA))

        def outcome(text):
            try:
                return ('accepted', N.parse_verdict_response(text, SHA))
            except N.ReviewError as error:
                return ('rejected', error.code)

        for index in range(4000):
            if index % 3:
                candidate = rng.choice(atoms)
            else:
                value = rng.choice(['x' * rng.randrange(1, 1200),
                    '[file.py:42] ' * rng.randrange(1, 40),
                    {'nested': [rng.choice(atoms), {'漢字': '🎾'}]},
                    {rng.choice(atoms): rng.choice(atoms)},
                    [rng.choice(atoms), rng.randrange(10000), None]])
                candidate = json.dumps(value, ensure_ascii=bool(index % 2))
            if index % 5 == 0:
                candidate = '[' + ' ' * rng.randrange(160) + candidate + ']'
            if index % 7 == 0:
                candidate = candidate[:rng.randrange(1, len(candidate) + 1)]
            candidate += rng.choice(['', '\nprose', '[x]', '"', '\\', ' verdict '])
            with self.subTest(index=index):
                self.assert_candidate_matches_full(candidate)
                response = passed + '\n' + candidate
                actual = outcome(response)
                with patch.object(N, '_decode_verdict_candidate', self.full_candidate):
                    expected = outcome(response)
                self.assertEqual(actual, expected)


class Collection(EvidenceTestCase):
    def setUp(self):
        super().setUp()
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
                with self.assertRaises(N.ReviewError): N.review(self.root, self.base, head, 'task', 60, slot='slot2',task_hash='x',charge=Mock())
                call.assert_not_called()
            (self.root/name).unlink(); self.commit()

    def test_trusted_rules_wrap_final_source_once_and_hash_exact_delivered_prompt(self):
        self.write('pkg/a.py','x = 2\n');head=self.commit()
        events=rows();events[-1]['result']['structured_output']['reviewed_sha']=head
        seen=[]; rules=('TRUSTED_ACCEPTED_POLICY',{'pin':'synthetic'})
        def inject(source,qa,work,accepted):
            self.assertEqual(accepted,rules);self.assertTrue(qa)
            self.assertIn('DATA_JSON:',source)
            self.assertNotIn('TRUSTED_ACCEPTED_POLICY',source)
            return 'TRUSTED_ACCEPTED_POLICY\n'+source, {'delivered':'synthetic'}
        def invoke(text,*args,**kwargs):
            seen.append(text);return wire(events),{'qualification_phase':'canary','input_delivery':'written'}
        with patch('context_policy.inject',inject),patch.object(N,'invoke',invoke):
            result,receipt=N.review(self.root,self.base,head,'raw task',60,slot='slot2',
                task_hash='x',charge=Mock(),accepted_rules=rules)
        self.assertEqual(result['verdict'],'PASS')
        self.assertEqual(seen[0].count('TRUSTED_ACCEPTED_POLICY'),1)
        self.assertEqual(receipt['input_sha256'],hashlib.sha256(seen[0].encode()).hexdigest())
        self.assertEqual(receipt['rules_context'],{'delivered':'synthetic',
            'delivery':'explicit_full_stream_json_stdin','prompt_sha256':receipt['input_sha256'],
            **{k:v for k,v in N.input_payload(seen[0])[1].items() if k!='input_transport'}})

    def test_real_rules_receipt_matches_exact_stdin_transport_without_mutating_metadata(self):
        import context_policy as C
        from accepted_rules_fixture import accepted_rules_text
        text=accepted_rules_text()
        metadata={'commit':C.RULES_COMMIT,'sha256':C.RULES_SHA256,'bytes':C.RULES_SIZE,
                  'delivery':'explicit_full_stdin','revision':'1.1'}
        original=copy.deepcopy(metadata)
        self.write('pkg/a.py','x = 2\n');head=self.commit()
        events=rows();events[-1]['result']['structured_output']['reviewed_sha']=head
        seen=[]
        def invoke(prompt,*args,**kwargs):
            seen.append(prompt);return wire(events),{'qualification_phase':'canary','input_delivery':'written'}
        with patch.object(N,'invoke',invoke):
            result,receipt=N.review(self.root,self.base,head,'raw task',60,slot='slot2',
                task_hash='x',charge=Mock(),accepted_rules=(text,metadata))
        self.assertEqual(result['verdict'],'PASS');self.assertEqual(metadata,original)
        context=receipt['rules_context'];actual=hashlib.sha256(seen[0].encode()).hexdigest()
        self.assertEqual(context['delivery'],'explicit_full_stream_json_stdin')
        self.assertEqual(context['stdin_sha256'],hashlib.sha256(N.input_payload(seen[0])[0]).hexdigest())
        self.assertEqual(context['prompt_sha256'],actual);self.assertEqual(receipt['input_sha256'],actual)
        self.assertEqual(context['commit'],C.RULES_COMMIT);self.assertEqual(context['sha256'],C.RULES_SHA256)
        self.assertEqual(context['bytes'],C.RULES_SIZE)

    def test_compact_source_reference_only_for_exact_readable_checkout(self):
        huge='# '+('a'*9000)+'\n'
        self.write('pkg/a.py',huge)
        head=self.commit()
        full,_=N.collect(self.root,self.base,head,'task')
        full_data=json.loads(full.split('DATA_JSON:\n',1)[1])
        self.assertEqual(full_data['files']['pkg/a.py'],huge)
        compact,_=N.collect(self.root,self.base,head,'task',compact_files=True)
        data=json.loads(compact.split('DATA_JSON:\n',1)[1])
        ref=data['files']['pkg/a.py']
        self.assertEqual(ref['delivery'],'verified_read_only_source')
        self.assertEqual(ref['revision'],head)
        self.assertEqual(ref['bytes'],len(huge.encode()))
        self.assertEqual(ref['sha256'],hashlib.sha256(huge.encode()).hexdigest())
        self.assertEqual(Path(ref['path']).read_text(),huge)
        self.assertIn(huge.strip(),data['diff'])
        self.assertLess(len(compact.encode()),len(full.encode()))
        self.write('pkg/a.py',huge+'# changed after commit\n')
        fallback,_=N.collect(self.root,self.base,head,'task',compact_files=True)
        self.assertEqual(json.loads(fallback.split('DATA_JSON:\n',1)[1])['files']['pkg/a.py'],huge)
        self.assertIsInstance(json.loads(fallback.split('DATA_JSON:\n',1)[1])['files']['pkg/a.py'],str)

    def test_protected_paths_binary_and_size_guards_remain_without_source_content_filter(self):
        for name in ('.env', '.env.production', '.ssh/config', 'credentials.json', 'key.pem', '.git/config', '../x'):
            with self.subTest(name=name), self.assertRaises(N.ReviewError): N.safe_path(name)
        for name in ('tokens.ts', 'auth/crypto.ts', 'config/env.ts', 'design-tokens/colors.ts'):
            self.assertEqual(N.safe_path(name), name)

        # This intentionally tests ordinary source containing a key-looking example.
        # Both the file and the Git diff must reach independent QA as ordinary data.
        key_marker = '-----BEGIN ' + 'PRIVATE' + ' ' + 'KEY' + '-----'
        example = 'EXAMPLE = ' + repr(key_marker) + '\n'
        self.write('pkg/example_key.py', example)
        head = self.commit()
        collected, _ = N.collect(self.root, self.base, head, 'task')
        context = json.loads(collected.split('DATA_JSON:\n', 1)[1])
        self.assertEqual(context['files']['pkg/example_key.py'], example)
        self.assertIn(example.strip(), context['diff'])
        (self.root/'pkg/example_key.py').unlink()
        self.commit()

        # Path protection, NUL bytes, size limits and symlinks remain forbidden.
        for name, data in [('pkg/blob.py', '\0'), ('pkg/big.py', 'x'*(N.MAX_INPUT+1))]:
            self.write(name, data)
            head = self.commit()
            with self.subTest(name=name), self.assertRaises(N.ReviewError):
                N.collect(self.root, self.base, head, 'task')
            (self.root/name).unlink()
            self.commit()
        (self.root/'pkg/link.py').symlink_to('b.py')
        head = self.commit()
        with self.assertRaises(N.ReviewError):
            N.collect(self.root, self.base, head, 'task')

    def test_over_limit_refuses_on_a_file_boundary_before_charge(self):
        self.write('pkg/a.py', 'A' * 300)
        self.write('pkg/b.py', 'B' * 300)
        head = self.commit()
        with patch.object(N, 'QA_INPUT_LIMIT', 10 ** 9):
            full, _ = N.collect(self.root, self.base, head, 'task')
        self.assertIn('pkg/a.py', full)
        self.assertIn('pkg/b.py', full)
        self.assertGreater(len(full.encode()), 400)
        charge = Mock()
        with patch.object(N, 'QA_INPUT_LIMIT', 400), \
             patch.object(N, 'invoke', side_effect=AssertionError('model called')):
            with self.assertRaises(N.ReviewError) as caught:
                N.review(self.root, self.base, head, 'task', 60, slot='slot2',
                         task_hash='x', charge=charge)
        self.assertEqual(caught.exception.code, 'AGY_INPUT_LIMIT')
        self.assertEqual(caught.exception.phase, 'source')
        self.assertIn('not truncated', caught.exception.detail)
        self.assertIn('no charge', caught.exception.detail)
        self.assertIn('before model call', caught.exception.detail)
        self.assertIn('pkg/a.py', caught.exception.detail)
        self.assertLess(len(caught.exception.detail), len(full))
        charge.assert_not_called()
        diff = ('diff --git a/pkg/a.py b/pkg/a.py\n+aaaa\n'
                'diff --git a/pkg/b.py b/pkg/b.py\n+bbbb\n')
        files = {'pkg/a.py': 'a' * 100, 'pkg/b.py': 'b' * 100}
        self.assertEqual(N.qa_limit_boundary(['pkg/a.py', 'pkg/b.py'], files, diff, 150), 'pkg/b.py')
        self.assertEqual(N.qa_limit_boundary(['pkg/a.py', 'pkg/b.py'], files, diff, 50), 'pkg/a.py')

    def test_differing_verdict_blocks_are_agy_parse_failed(self):
        self.write('pkg/a.py', 'x = 2\n')
        head = self.commit()
        body = json.dumps({'verdict': 'PASS', 'findings': [], 'reviewed_sha': head})
        other = json.dumps({'verdict': 'FAIL', 'findings': ['incomplete review'],
                            'reviewed_sha': head})
        events = rows()
        events[-1]['result']['structured_output'] = None
        events[-1]['result']['response'] = body + '\n' + body + '\n' + body
        def invoke(_text, *_args, **_kwargs):
            return wire(events), {'input_delivery': 'written'}
        with patch('context_policy.inject', side_effect=lambda text, *a: (text, {'sha256': 'f' * 64})), \
             patch.object(N, 'invoke', side_effect=invoke):
            result, _receipt = N.review(self.root, self.base, head, 'task', 60, slot='slot2',
                                        task_hash='x', charge=Mock())
        self.assertEqual(result, {'verdict': 'PASS', 'findings': [], 'reviewed_sha': head})
        events[-1]['result']['response'] = body + '\n' + other
        with patch('context_policy.inject', side_effect=lambda text, *a: (text, {'sha256': 'f' * 64})), \
             patch.object(N, 'invoke', side_effect=invoke):
            with self.assertRaises(N.ReviewError) as caught:
                N.review(self.root, self.base, head, 'task', 60, slot='slot2',
                         task_hash='x', charge=Mock())
        self.assertEqual(caught.exception.code, 'AGY_PARSE_FAILED')
        self.assertEqual(caught.exception.phase, 'parse')
        nested = json.dumps({'outer': {'verdict': 'FAIL', 'severity': 'high'}})
        events[-1]['result']['response'] = body + '\n' + nested
        with patch('context_policy.inject', side_effect=lambda text, *a: (text, {'sha256': 'f' * 64})), \
             patch.object(N, 'invoke', side_effect=invoke):
            with self.assertRaises(N.ReviewError) as caught:
                N.review(self.root, self.base, head, 'task', 60, slot='slot2',
                         task_hash='x', charge=Mock())
        self.assertEqual(caught.exception.code, 'AGY_PARSE_FAILED')
        self.assertEqual(caught.exception.phase, 'parse')

    def test_full_inject_stays_under_the_external_truncator(self):
        import context_policy as C
        from accepted_rules_fixture import accepted_rules_text
        rules = accepted_rules_text()
        meta = {'commit': C.RULES_COMMIT, 'sha256': C.RULES_SHA256, 'bytes': C.RULES_SIZE,
                'delivery': 'explicit_full_stdin'}
        overhead = N.qa_rules_overhead()
        self.assertGreater(N.qa_stage_budget(), 0)
        self.assertLess(N.QA_INPUT_LIMIT, N.QA_EXTERNAL_CUT)
        fitting = 'Q' * N.qa_stage_budget()
        stdin, _ = C.inject(fitting, True, self.root, (rules, meta))
        self.assertEqual(len(stdin.encode('utf-8')), N.QA_INPUT_LIMIT)
        self.assertEqual(len(stdin.encode('utf-8')) - len(fitting.encode('utf-8')), overhead)
        _wire, payload = N.input_payload(stdin)
        self.assertLessEqual(payload['semantic_input_bytes'], N.QA_INPUT_LIMIT)
        self.assertLessEqual(payload['stdin_bytes'], N.QA_EXTERNAL_CUT)
        # The old cap measured the stage alone. That stage plus the rules prefix
        # is the 377797-byte stdin the external truncator would still cut.
        oversized = 'Q' * N.QA_INPUT_LIMIT
        full, _ = C.inject(oversized, True, self.root, (rules, meta))
        self.assertEqual(len(full.encode('utf-8')), 377797)
        self.assertGreater(len(full.encode('utf-8')), N.QA_EXTERNAL_CUT)
        charge = Mock()
        with patch.object(N, 'collect', return_value=(oversized, 'ab' * 32)), \
             patch.object(N, 'invoke', side_effect=AssertionError('model called')):
            with self.assertRaises(N.ReviewError) as caught:
                N.review(self.root, self.base, self.base, 'task', 60, slot='slot2',
                         task_hash='x', charge=charge, accepted_rules=(rules, meta))
        self.assertEqual(caught.exception.code, 'AGY_INPUT_LIMIT')
        self.assertEqual(caught.exception.phase, 'source')
        self.assertIn('after rules inject', caught.exception.detail)
        self.assertIn('not truncated', caught.exception.detail)
        self.assertIn('no charge', caught.exception.detail)
        self.assertIn('before model call', caught.exception.detail)
        self.assertNotIn(oversized[:80], caught.exception.detail)
        charge.assert_not_called()

class Routing(unittest.TestCase):
    def test_unqualified_agy_falls_back_without_charge_or_call(self):
        from test_actions_train import core, S
        from test_actions_train_cost_policy import cost_task
        task = cost_task(); task['routing_policy']['schema'] = 'GB_STAGE_COST_V2'
        task['qa_routes'] = ['agy:claude-sonnet-5-5-medium', 'codex:gpt-6.1-sol:medium']
        before = copy.deepcopy(task)
        budget = Mock(remaining=lambda *a:10, used=lambda *a:2)
        with patch.object(N, 'qualification', side_effect=N.ReviewError('executor not provisioned')), \
             patch.object(N, 'invoke', side_effect=AssertionError('model started')):
            choice = core.route(S, task, 'qa', 'auto', budget, 'slot2')
        self.assertEqual(choice['provider'], 'codex')
        self.assertIn('Antigravity QA unavailable', choice['unavailable']['agy:claude-sonnet-5-5-medium'])
        self.assertEqual(task, before)
        budget.charge.assert_not_called()


class NativeToolScope(EvidenceTestCase):
    def setUp(self):
        super().setUp()
        from test_actions_train_agy_oauth_precharge import synthetic_vendor_preflight
        synthetic_vendor_preflight(self)
    def test_authorized_successful_native_tool_steps_are_receipted(self):
        events=rows()
        for state in ('ACTIVE','DONE'):
            events.insert(-2, {'event':'step_update','step_update':{'conversation_id':CID,
                'step_index':4,'step_type':'tool','tool_name':'run_command','state':state}})
        result, evidence=N.parse_stream(wire(events),SHA)
        self.assertEqual(result['verdict'],'PASS')
        self.assertEqual(evidence['tool_events'],1)
        self.assertEqual(evidence['tool_names'],['run_command'])

    def test_last_tool_state_must_be_done_even_after_prior_completion(self):
        for states in [('DONE','ACTIVE'),('ACTIVE','DONE','ACTIVE')]:
            events=rows()
            for state in states:
                events.insert(-2,{'event':'step_update','step_update':{'conversation_id':CID,
                    'step_index':4,'step_type':'tool','tool_name':'run_command','state':state}})
            with self.subTest(states=states),self.assertRaisesRegex(N.ReviewError,'AGY_PRECHECK_FAILED'):
                N.parse_stream(wire(events),SHA)
        events=rows()
        for index,state in [(4,'ACTIVE'),(5,'ACTIVE'),(4,'DONE'),(5,'DONE'),(4,'ACTIVE')]:
            events.insert(-2,{'event':'step_update','step_update':{'conversation_id':CID,
                'step_index':index,'step_type':'tool','tool_name':'run_command','state':state}})
        with self.assertRaisesRegex(N.ReviewError,'AGY_PRECHECK_FAILED'):
            N.parse_stream(wire(events),SHA)

    def test_synthetic_legacy_landlock_fixture_remains_readonly(self):
        with tempfile.TemporaryDirectory(prefix='gb-agy-synthetic-') as temp:
            root=Path(temp); work=root/'candidate';work.mkdir()
            subprocess.run(['git','init','-q',str(work)],check=True,capture_output=True)
            (work/'source.py').write_text('original')
            outside=root/'outside-key';outside.write_text('synthetic outside canary')
            script = """
import json,os,pathlib,subprocess,sys
sys.stdin.buffer.read()
work=pathlib.Path(os.environ['WORK']);outside=pathlib.Path(os.environ['OUTSIDE'])
def allowed(fn):
 try:fn();return True
 except OSError:return False
result={'read':allowed(lambda:(work/'source.py').read_bytes()),
 'write':allowed(lambda:(work/'source.py').write_text('bad')),
 'chmod_then_write':allowed(lambda:((work/'source.py').chmod(0o777),(work/'source.py').write_text('bad'))),
 'outside':allowed(lambda:outside.read_bytes()),
 'shell':allowed(lambda:subprocess.run(['/bin/true'],check=True))}
print(json.dumps(result))
"""
            original=N.filesystem_roots;captured={}
            def roots(private,candidate,common=None):
                result=original(private,candidate,common)
                captured['roots']=result
                return result
            def mock_legacy_landlock():
                # Synthetic test-seam only. The production AGY path applies no
                # Landlock/MAC layer; this fixture proves the read-only
                # expectations of the declared roots on a synthetic child.
                from native_guard import _landlock
                _REAL_NNP()
                _landlock(*captured['roots'])
            def cmd(timeout,prompt=None,model=N.MODEL):return [sys.executable,'-I','-c',script]
            original_popen=subprocess.Popen; charged=[]
            def popen(argv,**kwargs):
                self.assertEqual(charged,['one'])
                kwargs['env'].update(WORK=str(work),OUTSIDE=str(outside))
                return original_popen(argv,**kwargs)
            with patch.object(N,'qualification',return_value={'phase':'canary'}), \
                 patch.object(N.os,'geteuid',return_value=978), \
                 patch.object(N,'trusted',return_value=b'{"token":"synthetic"}'), \
                 patch.object(N,'command',cmd), patch.object(N,'AGY',sys.executable), \
                 patch.object(N,'filesystem_roots',side_effect=roots), \
                 patch.object(G,'no_new_privileges',side_effect=mock_legacy_landlock),patch.object(N,'_verify_executor_boundary',return_value=None),patch.object(N,'_candidate_state',return_value=('H','')) :
                raw, evidence=N.invoke('synthetic prompt',30,work=work,slot='slot2',task_hash='x',
                    charge=lambda:charged.append('one'),popen=popen)
            self.assertEqual(json.loads(raw),{'read':True,'write':False,'chmod_then_write':False,
                                               'outside':False,'shell':True})
            self.assertEqual((work/'source.py').read_text(),'original')
            self.assertEqual(evidence['filesystem_boundary'],'uid978_unix_permissions_nnp')
            self.assertIs(evidence['requested_native_sandbox'], False)
            self.assertEqual(charged,['one'])

    def test_synthetic_legacy_landlock_git_fixture_and_strict_gate(self):
        """Explicitly simulated legacy Landlock child, two source files + HEAD.

        Native tool DONE envelopes are separately tied to verified source
        excerpts/digests. CLI agent inference is deliberately not invoked.
        """
        from test_actions_train_addressed_analysis import stream,binding,answer
        with tempfile.TemporaryDirectory(prefix='gb-agy-source-root-') as temp:
            outer=Path(temp);work=outer/'candidate';work.mkdir()
            paths=N.REQUIRED_ANALYSIS_PATHS
            data=['// FIRST_NATIVE_SOURCE_EXCERPT: types and fields\n',
                  '// SECOND_NATIVE_SOURCE_EXCERPT: GameDetail reads\n']
            subprocess.run(['git','init','-q',str(work)],check=True,capture_output=True)
            for rel,src in zip(paths,data):
                dest=work/rel;dest.parent.mkdir(parents=True,exist_ok=True)
                dest.write_text(src)
            subprocess.run(['git','-C',str(work),'add','--',*paths],check=True,capture_output=True)
            subprocess.run(['git','-C',str(work),'-c','user.name=CI','-c',
                'user.email=qa@example.invalid','commit','-qm','source canary'],check=True)
            head=subprocess.check_output(['git','-C',str(work),'rev-parse','HEAD'],text=True).strip()
            outside=outer/'outside-secret';outside.write_text('outside boundary')
            full_argv=N.command(60,analysis=True,source_root=str(work.resolve()))
            self.assertEqual(full_argv.count('--add-dir'),1)
            self.assertEqual(full_argv[full_argv.index('--add-dir')+1],str(work.resolve()))
            self.assertNotIn('--sandbox',full_argv)
            with self.assertRaises(N.ReviewError):
                N.command(60,analysis=True,source_root=str(outside))
            with self.assertRaises(N.ReviewError):
                N.command(60,analysis=False,source_root=str(work.resolve()))
            sandbox_probe=r"""
import hashlib,json,os,pathlib,subprocess,sys
sys.stdin.buffer.read()
source=pathlib.Path(os.environ['SOURCE_ROOT'])
outside=pathlib.Path(os.environ['OUTSIDE'])
paths=json.loads(os.environ['FILES'])
contents=[]
for rel in paths:
    b=(source/rel).read_bytes()
    contents.append({'path':rel,'sha256':hashlib.sha256(b).hexdigest(),
                     'excerpt':b.decode().strip()})
git=subprocess.run(['/usr/bin/git','-C',str(source),'rev-parse','HEAD'],
                   capture_output=True,text=True)
def can_write(path):
    try:
        path.write_text('UNAUTHORIZED_CHANGE')
        return True
    except OSError:
        return False
def can_read(path):
    try:path.read_bytes();return True
    except OSError:return False
print(json.dumps({'cwd':os.getcwd(),'head':git.stdout.strip(),
                  'sources':contents,'write':can_write(source/paths[0]),
                  'outside_readable':can_read(outside),
                  'git_ok':git.returncode==0,'git_error':git.stderr[:700]}))
"""
            seen=[];charged=[]
            original_roots=N.filesystem_roots;captured={}
            def roots(private,candidate,common=None):
                result=original_roots(private,candidate,common)
                captured['roots']=result
                return result
            def mock_legacy_landlock():
                from native_guard import _landlock
                _landlock(*captured['roots'])
            original_command=N.command
            def child_command(timeout,prompt=None,model=N.MODEL,*,analysis=False,source_root=None):
                self.assertTrue(analysis)
                self.assertEqual(source_root,str(work.resolve()))
                actual=original_command(timeout,model=model,analysis=analysis,source_root=source_root)
                self.assertEqual(actual[actual.index('--add-dir')+1],str(work.resolve()))
                seen.append(actual)
                return [sys.executable,'-I','-c',sandbox_probe]
            def child_popen(argv,**kwargs):
                self.assertEqual(charged,['one-synthetic-call'])
                self.assertEqual(kwargs['cwd'].name,'ws')
                self.assertNotEqual(kwargs['cwd'],work)
                kwargs['env'].update(SOURCE_ROOT=str(work),OUTSIDE=str(outside),
                                    FILES=json.dumps(paths))
                return subprocess.Popen(argv,**kwargs)
            with patch.object(N,'qualification',return_value={'phase':'canary'}), \
                 patch.object(N.os,'geteuid',return_value=978), \
                 patch.object(N,'trusted',return_value=b'synthetic-not-real-oauth'), \
                 patch.object(N,'command',child_command), \
                 patch.object(N,'AGY',sys.executable), \
                 patch.object(N,'filesystem_roots',side_effect=roots), \
                 patch.object(G,'no_new_privileges',side_effect=mock_legacy_landlock),patch.object(N,'_verify_executor_boundary',return_value=None),patch.object(N,'_candidate_state',return_value=('H','')) :
                try:
                    raw,receipt=N.invoke('probe only',45,work=work,slot='slot2',
                        task_hash='x'*64,charge=lambda:charged.append('one-synthetic-call'),
                        popen=child_popen,analysis=True)
                except N.ReviewError as error:
                    logs=[v.read_text(errors='replace') for v in self.evidence.glob('*/stderr')]
                    raise AssertionError(str(error)+' child_stderr='+repr(logs[-1:] )) from None
            observed=json.loads(raw)
            self.assertEqual(observed['head'],head,msg=observed.get('git_error'))
            self.assertEqual(len(observed['sources']),2)
            self.assertIn('/ws',observed['cwd'])
            self.assertFalse(observed['write'])
            self.assertFalse(observed['outside_readable'])
            self.assertEqual(len(seen),1)
            self.assertEqual(receipt['filesystem_boundary'],'uid978_unix_permissions_nnp')
            self.assertIs(receipt['requested_native_sandbox'], False)
            self.assertNotIn('writable_roots',receipt)
            self.assertNotIn('readonly_roots',receipt)
            self.assertIs(receipt['filesystem_roots_enforced'],False)
            self.assertIn('not verified safety',receipt['owner_waiver'])
            rows=stream()
            rows[0]['init']['tools']=['view_file','run_command']
            answer_data=answer()|dict(completion='COMPLETE',source_reads=[
                dict(path=x['path'],sha256=x['sha256'],observation=x['excerpt'])
                for x in observed['sources']])
            rows[-1]['result']['response']=json.dumps(answer_data)
            for index,name in ((3,'view_file'),(4,'run_command')):
                rows.insert(-1,{'event':'step_update','step_update':dict(
                    conversation_id=CID,step_type='tool',step_index=index,
                    tool_name=name,state='DONE')})
            parsed,events=N.parse_stream(wire(rows),head,
                analysis_binding=binding(),strict_source_evidence=True)
            self.assertEqual(set(events['tool_names']),{'view_file','run_command'})
            with patch.object(N,'git',side_effect=lambda _w,cmd,ref:(
                work/ref.split(':',1)[1]).read_bytes()):
                verified=N.analysis_source_gate(parsed,events,work,head)
            self.assertEqual(verified['completion'],'COMPLETE')
            self.assertEqual([(work/x).read_text() for x in paths],data)
            self.assertEqual(charged,['one-synthetic-call'])

    def test_unsupported_historical_routes_do_not_probe_or_charge_agy(self):
        from test_actions_train import core,S
        from test_actions_train_cost_policy import cost_task
        task=cost_task();task.pop('routing_policy')
        task['qa_routes']=['agy:historical-model:medium','codex:gpt-6.1-sol:medium']
        budget=Mock(remaining=lambda *a:10,used=lambda *a:0)
        with patch.object(N,'available',side_effect=AssertionError('unsupported AGY probe')):
            chosen=core.route(S,task,'qa','auto',budget,'slot2')
            self.assertEqual(chosen['provider'],'codex')
            with self.assertRaisesRegex(core.Refused,'no safe role-specific provider'):
                core.route(S,task,'qa','agy',budget,'slot2')
        budget.charge.assert_not_called()

    def test_exact_medium_route_qualified_unavailable_and_unknown_budget(self):
        from test_actions_train import core,S
        from test_actions_train_cost_policy import cost_task
        task=cost_task();task['routing_policy']['schema']='GB_STAGE_COST_V2'
        task['qa_routes']=['agy:claude-sonnet-5-5-medium','codex:gpt-6.1-sol:medium']
        for available, remaining, expected in [(True,1,'agy'),(False,1,'codex'),(True,None,'codex')]:
            budget=Mock(remaining=lambda provider,*a:remaining if provider=='agy' else 10,used=lambda *a:0)
            with patch.object(N,'available',return_value=(available,'qualification evidence')):
                chosen=core.route(S,task,'qa','auto',budget,'slot2')
            self.assertEqual(chosen['provider'],expected)
            budget.charge.assert_not_called()


class QualificationSeam(unittest.TestCase):
    def marker(self):
        from core import digest
        q=dict(issue=29,base='b'*40,head=SHA,work=str(N.QUALIFICATION_WORK),
               task_sha256=digest(N.qualification_task('b'*40,SHA)))
        return dict(schema='GB_ANTIGRAVITY_QA_29_V1',phase='canary',slot='slot2',
            executor_uid=978,canary_task_sha256=q['task_sha256'],qualification=q)

    def request(self):
        return dict(action='train',stage='qa_qualification',slot='slot2',issue=29,
            phase='idle',head=SHA,attempt=0,generation=0,profile='agy',
            run=1234,run_attempt=1,gh_token='synthetic-read-token')

    def test_wire_and_marker_bind_exact_qa_only_scope(self):
        import core
        req=self.request();core.request(req)
        for fields in ({'issue':225},{'slot':'slot1'},{'phase':'pr_wait'},{'attempt':1},
                       {'profile':'auto'},{'head':None},{'task_sha256':'invented'}):
            with self.subTest(fields=fields),self.assertRaises(core.Refused):core.request(req|fields)
        m=self.marker();self.assertEqual(N.qualification_descriptor(m),m['qualification'])
        m['qualification']['head']='c'*40
        with self.assertRaises(N.ReviewError):N.qualification_descriptor(m)

    def test_durable_reservation_and_pending_unknown_never_replay_or_claim_source(self):
        import receiver
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory(prefix='gb-agy-qa-seam-') as temp:
            state={'active':None,'done':[152]};before=copy.deepcopy(state)
            budget=Mock(remaining=lambda *a:1)
            m=self.marker();original=receiver.read
            with patch.object(receiver,'STATE',Path(temp)), \
                 patch.object(receiver,'checkpoint',return_value=(state,[])), \
                 patch.object(receiver,'guard',return_value=None), \
                 patch.object(receiver,'live',return_value=(None,SimpleNamespace(Budget=lambda *a:budget))), \
                 patch.object(receiver,'read',side_effect=lambda p,owner=None,limit=2097152:original(p,None,limit)), \
                 patch.object(N,'qualification',return_value=m), \
                 patch.object(N,'trusted',return_value=json.dumps(m).encode()), \
                 patch.object(receiver.os,'fork',return_value=123) as fork, \
                 patch.object(receiver,'identity',return_value={'pid':123}), \
                 patch.object(receiver,'alive',return_value=False):
                first=receiver.qualification_request(self.request(),{})
                self.assertEqual(first['status'],'running')
                self.assertEqual(fork.call_count,1)
                reservation=json.loads((Path(temp)/'antigravity-qa-qualification.json').read_text())
                self.assertEqual(reservation['task_hash'],m['canary_task_sha256'])
                again=receiver.qualification_request(self.request()|{'run':1235},{})
                self.assertEqual(again['status'],'unknown')
                self.assertEqual(fork.call_count,1)
                journal=json.loads((Path(temp)/'slot2.json').read_text())
                journal['pending']=None; journal['generation']=1
                (Path(temp)/'slot2.json').write_text(json.dumps(journal))
                with self.assertRaisesRegex(receiver.Refused,'already reserved'):
                    receiver.qualification_request(self.request()|{'generation':1}, {})
                self.assertEqual(fork.call_count,1)
                self.assertEqual(state,before)
                budget.charge.assert_not_called()

    def test_qa_only_handler_charges_once_saves_truth_and_leaves_checkpoint_untouched(self):
        import stage
        from types import SimpleNamespace
        from core import digest
        with tempfile.TemporaryDirectory(prefix='gb-agy-qa-handler-') as temp:
            m=self.marker();q=m['qualification']
            store=SimpleNamespace(data={'active':None,'done':[152]})
            before=copy.deepcopy(store.data)
            budget=Mock();budget.used.side_effect=[0,1]
            rt=SimpleNamespace(budget=budget)
            a=SimpleNamespace(subprocess=SimpleNamespace(Popen=Mock()))
            b=SimpleNamespace(c=SimpleNamespace(state_dir=Path(temp)))
            req=self.request()|{'_qa_qualification':q}
            result={'verdict':'PASS','findings':[],'reviewed_sha':SHA}
            def review(*args,**kwargs):
                kwargs['charge']()
                return result,dict(schema=2,source_sha=SHA,base_sha=q['base'],
                    effective_model=N.MODEL,tool_names=['run_command'],tool_events=1)
            with patch.object(N,'qualification',return_value=m),patch.object(N,'review',review), \
                 patch('context_policy.load',return_value=('trusted',{})), \
                 patch('context_policy.inject',return_value=('trusted',{'rules':'synthetic'})):
                out=stage.qualify_qa(req,{},(a,None,rt,None,store,b))
            budget.charge.assert_called_once_with('slot2','agy','qa')
            self.assertEqual(store.data,before)
            self.assertTrue(out['qualification_passed'])
            self.assertFalse(out['checkpoint_changed'])
            saved=json.loads((Path(temp)/out['receipt_file']).read_text())
            self.assertEqual(saved['qualification_task_sha256'],q['task_sha256'])
            self.assertEqual(saved['charged_calls'],1)
            self.assertTrue(saved['qualification_passed'])
    def test_stale_done_parser_cannot_become_qualification_pass(self):
        import stage
        from types import SimpleNamespace
        m=self.marker();events=rows()
        for state in ('DONE','ACTIVE'):
            events.insert(-2,{'event':'step_update','step_update':{'conversation_id':CID,
                'step_index':4,'step_type':'tool','tool_name':'run_command','state':state}})
        store=SimpleNamespace(data={'active':None,'done':[]});before=copy.deepcopy(store.data)
        rt=SimpleNamespace(budget=Mock(used=Mock(return_value=0)))
        def review(*args,**kwargs):return N.parse_stream(wire(events),SHA)
        with patch.object(N,'qualification',return_value=m),patch.object(N,'review',review), \
             patch('context_policy.load',return_value=('trusted',{})),patch.object(N,'save_receipt') as save:
            with self.assertRaisesRegex(N.ReviewError,'AGY_PRECHECK_FAILED'):
                stage.qualify_qa(self.request()|{'_qa_qualification':m['qualification']},{},
                    (SimpleNamespace(subprocess=SimpleNamespace(Popen=Mock())),None,rt,None,store,SimpleNamespace(c=SimpleNamespace(state_dir=Path('/tmp')))))
            save.assert_not_called()
        self.assertEqual(store.data,before)


class QualificationPlanning(unittest.TestCase):
    marker = QualificationSeam.marker
    request = QualificationSeam.request
    def test_root_proposal_only_active_idle_unspent_finite_canary(self):
        import receiver
        with tempfile.TemporaryDirectory(prefix='gb-agy-qa-plan-') as temp:
            card=dict(owned=True,active=None,pending=None,generation=7)
            budget=Mock(remaining=lambda *a:1);m=self.marker()
            with patch.object(receiver,'STATE',Path(temp)),patch.object(N,'trusted',return_value=json.dumps(m).encode()) as read:
                self.assertIsNone(receiver.qualification_plan({'mode':'shadow'},card,budget))
                read.assert_not_called()
                q=receiver.qualification_plan({'mode':'active'},card,budget)
                self.assertEqual(q['stage'],'qa_qualification');self.assertEqual(q['generation'],7)
                for change in ({'owned':False},{'active':{'issue':225}},{'pending':{'stage':'qa'}}):
                    self.assertIsNone(receiver.qualification_plan({'mode':'active'},card|change,budget))
                (Path(temp)/'antigravity-qa-qualification.json').write_text('{}')
                self.assertIsNone(receiver.qualification_plan({'mode':'active'},card,budget))

    def test_existing_plan_uses_only_free_slot2_without_touching_unknown_peer(self):
        from test_actions_train import core,S
        q={k:v for k,v in self.request().items() if k not in ('action','run','run_attempt','gh_token')}
        empty=dict(owned=True,active=None,done=[],parked=[],generation=0,pending=None,last=None,reservation=None)
        peer=empty|{'pending':{'status':'unknown','recoverable':False,'binding':{'stage':'author','issue':207}}}
        snap=dict(mode='active',slots={'slot1':peer,'slot2':empty|{'qa_qualification':q}})
        before=copy.deepcopy(snap)
        self.assertEqual(core.plan(None,S,snap,[]),[q])
        self.assertEqual(snap,before)
        snap['mode']='shadow'
        self.assertFalse(any(d['stage']=='qa_qualification' for d in core.plan(None,S,snap,[])))


if __name__ == '__main__': unittest.main()

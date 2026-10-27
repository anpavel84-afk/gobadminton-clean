"""Offline QA request/completion contract; synthetic controls are never receipts.

The saved sanitized failure below is metadata, not native raw stdout. No
qualification fixture, grant, provider call or privileged host check is made.
"""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'actions_train'))
import native_antigravity as N
from test_actions_train_antigravity import SHA, CID, rows, wire
from test_actions_train_agy_tool_frontmatter import metadata


def verdict(**changes):
    value = dict(verdict='PASS', findings=[], reviewed_sha=SHA)
    value.update(changes)
    return value


# Exact sanitized metadata copied from diagnosis trace.json, SHA256
# 1cd081ecdfdc0335ee6b291a02c7a386e6d7229971d7e55747840f74ebc80546.
# Native raw stdout reference f7766790d64e7317ba33fb8a97cbc267afe7ccf5cbfb3f1f39de29be2e109395
# is provenance only; these reconstructed envelopes are not that raw stream.
SAVED_FAILURE = {'init': {'model': 'claude-sonnet-5-5-medium',
          'agent': 'gobadminton-text-review',
          'tools': ['ask_custom_permission',
                    'ask_permission',
                    'ask_question',
                    'browser_click_element',
                    'browser_drag_pixel_to_pixel',
                    'browser_get_dom',
                    'browser_get_network_request',
                    'browser_input',
                    'browser_list_network_requests',
                    'browser_mouse_down',
                    'browser_mouse_up',
                    'browser_move_mouse',
                    'browser_press_key',
                    'browser_refresh_page',
                    'browser_resize_window',
                    'browser_scroll',
                    'browser_scroll_dom',
                    'browser_select_option',
                    'browser_subagent',
                    'call_mcp_tool',
                    'capture_browser_console_logs',
                    'capture_browser_screenshot',
                    'click_browser_pixel',
                    'command_status',
                    'define_subagent',
                    'delete_knowledge',
                    'execute_browser_javascript',
                    'find_by_name',
                    'finish',
                    'generate_image',
                    'grep_search',
                    'invoke_subagent',
                    'list_browser_pages',
                    'list_dir',
                    'list_permissions',
                    'list_plugin_accounts',
                    'list_resources',
                    'manage_inbox',
                    'manage_subagents',
                    'manage_task',
                    'multi_replace_file_content',
                    'notebook_edit',
                    'notebook_execution',
                    'open_browser_url',
                    'read_browser_page',
                    'read_resource',
                    'read_url_content',
                    'replace_file_content',
                    'run_command',
                    'run_workflow',
                    'schedule',
                    'search_marketplace',
                    'search_web',
                    'sed_file',
                    'send_command_input',
                    'send_message',
                    'view_file',
                    'wait',
                    'wait_5_seconds',
                    'write_to_file'],
          'permission_mode': 'always-proceed',
          'json_schema': {'additionalProperties': False,
                          'properties': {'findings': {'items': {'maxLength': 4000, 'type': 'string'},
                                                      'maxItems': 100,
                                                      'type': 'array'},
                                         'reviewed_sha': {'pattern': '^[0-9a-f]{40}$', 'type': 'string'},
                                         'verdict': {'enum': ['PASS', 'FAIL']}},
                          'required': ['verdict', 'findings', 'reviewed_sha'],
                          'type': 'object'}},
 'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
 'steps': [{'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 0,
            'state': 'DONE',
            'step_type': 'user_input'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 1,
            'state': 'DONE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 2,
            'state': 'ACTIVE',
            'step_type': 'tool',
            'tool_name': 'run_command'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 2,
            'state': 'DONE',
            'step_type': 'tool',
            'tool_name': 'run_command'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 3,
            'state': 'ACTIVE',
            'step_type': 'tool',
            'tool_name': 'run_command'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 3,
            'state': 'DONE',
            'step_type': 'tool',
            'tool_name': 'run_command'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 4,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 4,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 4,
            'state': 'DONE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 5,
            'state': 'DONE',
            'step_type': 'user_input'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 6,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 6,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 6,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 6,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 6,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 6,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 6,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 6,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 6,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 6,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 6,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 6,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 6,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 6,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 6,
            'state': 'DONE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 7,
            'state': 'DONE',
            'step_type': 'user_input'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 8,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 8,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 8,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 8,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 8,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 8,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 8,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 8,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 8,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 8,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 8,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 8,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 8,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 8,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 8,
            'state': 'DONE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 9,
            'state': 'DONE',
            'step_type': 'user_input'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 10,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 10,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 10,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 10,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 10,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 10,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 10,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 10,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 10,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 10,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 10,
            'state': 'ACTIVE',
            'step_type': 'agent_response'},
           {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'step_index': 10,
            'state': 'DONE',
            'step_type': 'agent_response'}],
 'result': {'conversation_id': '2e0f42ba-1895-466b-aa8c-7383b41fe1e6',
            'status': 'SUCCESS',
            'response': '{"verdict":"PASS","findings":[],"reviewed_sha":"de193c74c11e1fef33d1e3c8405abe5a40081b87"}\n'
                        '{"verdict":"PASS","findings":[],"reviewed_sha":"de193c74c11e1fef33d1e3c8405abe5a40081b87"}\n'
                        '{"verdict":"PASS","findings":[],"reviewed_sha":"de193c74c11e1fef33d1e3c8405abe5a40081b87"}\n'
                        '{"verdict":"PASS","findings":[],"reviewed_sha":"de193c74c11e1fef33d1e3c8405abe5a40081b87"}\n',
            'usage': {'input_tokens': 76952,
                      'output_tokens': 879,
                      'thinking_tokens': 0,
                      'cache_read_tokens': 137937,
                      'total_tokens': 77831}}}


class SavedSanitizedFailure(unittest.TestCase):
    def events(self):
        saved = copy.deepcopy(SAVED_FAILURE)
        return [dict(event='init', conversation_id=saved['conversation_id'], init=saved['init'])] + [
            dict(event='step_update', step_update=step) for step in saved['steps']
        ] + [dict(event='result', result=saved['result'])]

    def test_saved_failure_without_finish_stays_negative(self):
        events = self.events()
        self.assertEqual(len(events[1:-1]), 54)
        self.assertIn('finish', events[0]['init']['tools'])
        self.assertFalse(any(e.get('step_update', {}).get('step_type')=='finish' for e in events))
        head = 'de193c74c11e1fef33d1e3c8405abe5a40081b87'
        self.assertEqual(len(events[-1]['result']['response'].splitlines()), 4)
        with self.assertRaises(N.ReviewError):
            N.parse_stream(wire(events), head)

    def test_synthetic_control_adds_finish_only_in_memory(self):
        # Not the saved failure, not a receipt, never used for qualification.
        events = self.events()
        events.insert(-1, dict(event='step_update', step_update=dict(
            conversation_id=SAVED_FAILURE['conversation_id'], step_index=11,
            step_type='finish', state='DONE')))
        head = 'de193c74c11e1fef33d1e3c8405abe5a40081b87'
        result, receipt = N.parse_stream(wire(events), head)
        self.assertEqual(result, verdict(reviewed_sha=head))
        self.assertEqual(receipt['tool_events'], 2)
        self.assertEqual(len(SAVED_FAILURE['steps']), 54)


class CompletionContract(unittest.TestCase):
    def test_explicit_qa_capability_and_synthetic_finish_agree(self):
        agent, tools, body = metadata(N.AGENT_DEF)
        self.assertEqual(agent, N.AGENT)
        self.assertEqual(tools, ['view_file', 'run_command', 'finish'])
        self.assertIn('call native finish exactly once', body)
        self.assertIn('{verdict, findings, reviewed_sha}', body)
        self.assertIn('Do not merely print JSON', body)
        events = rows()
        events[0]['init']['tools'] = tools
        self.assertEqual(N.parse_stream(wire(events), SHA)[0], verdict())
        del events[-2]  # Catalog exposure never substitutes for actual finish.
        with self.assertRaises(N.ReviewError):
            N.parse_stream(wire(events), SHA)

    def test_analysis_definition_bytes_and_schema_free_route_stay_exact(self):
        self.assertEqual(hashlib.sha256(N.ANALYSIS_AGENT_DEF.encode()).hexdigest(),
            '8093a7faf36f7bf317ed31117722d3325fef77810aa3774ff7cc3749c9644e6d')
        self.assertEqual(metadata(N.ANALYSIS_AGENT_DEF)[1], ['view_file', 'run_command'])
        self.assertNotIn('finish', N.ANALYSIS_AGENT_DEF)
        self.assertNotIn('--json-schema', N.command(45, analysis=True))
        self.assertEqual(json.loads(N.command(45)[N.command(45).index('--json-schema')+1]), N.SCHEMA)

    def test_missing_finish_and_inference_cannot_be_replaced_by_structured_pass(self):
        for kind in ('finish', 'agent_response'):
            events = rows()
            events = [e for e in events if e.get('step_update', {}).get('step_type') != kind]
            with self.subTest(kind=kind), self.assertRaises(N.ReviewError):
                N.parse_stream(wire(events), SHA)
        events = rows()
        events[-2]['step_update']['state'] = 'ACTIVE'
        with self.assertRaises(N.ReviewError):
            N.parse_stream(wire(events), SHA)


class BothVerdictChannels(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix='gb-agy-contract-')
        self.addCleanup(scratch.cleanup)
        self.scratch = Path(scratch.name)

    def check(self, response, *, structured=None, accepted=False):
        events = rows()
        events[-1]['result'].update(structured_output=verdict() if structured is None else structured,
                                   response=response)
        raw = wire(events)
        # Exercise the public wrapper as well; all source, context and invocation
        # inputs are inert fakes. No subprocess, qualification or credential read.
        with patch.object(N, '_guard_accidental_writes', return_value=None), \
             patch.object(N, '_restore_write_guard'), \
             patch.object(N, '_candidate_state', return_value=(SHA, '')), \
             patch.object(N, 'collect', return_value=('synthetic source', None)), \
             patch('context_policy.inject', side_effect=lambda text, *a: (text, {'sha256': 'f'*64})), \
             patch.object(N, 'invoke', return_value=(raw, {'input_delivery': 'written'})):
            calls = (
                lambda: N.parse_stream(raw, SHA),
                lambda: N.review(self.scratch/'candidate', 'b'*40, SHA, 'inert task', 30,
                    slot='slot2', task_hash='f'*64, charge=Mock(),
                    evidence_dir=self.scratch/'evidence'),
            )
            for index, call in enumerate(calls):
                with self.subTest(entry=('parse_stream', 'review')[index]):
                    if accepted:
                        self.assertEqual(call()[0], verdict() if structured is None else structured)
                    else:
                        with self.assertRaises(N.ReviewError):
                            call()

    def test_structured_only_absent_empty_and_ordinary_prose_accept(self):
        # rows() has no response field at all.
        self.assertEqual(N.parse_stream(wire(rows()), SHA)[0], verdict())
        for response in (None, '', ' \n\t', 'Review complete. See [file.py:42] {notes} "checked".'):
            with self.subTest(response=response):
                self.check(response, accepted=True)

    def test_matching_and_identical_repeated_response_accept(self):
        body = json.dumps(verdict())
        for response in (body, '\n'.join([body]*4), '```json\n'+body+'\n```',
                         json.dumps({'echo': [body, {body: 0}]})):
            with self.subTest(response=response):
                self.check(response, accepted=True)
        failed = verdict(verdict='FAIL', findings=['Missing required check.'])
        self.check(json.dumps(failed), structured=failed, accepted=True)

    def test_structured_pass_cannot_hide_response_fail_nested_or_encoded(self):
        fail = verdict(verdict='FAIL', findings=['hidden failure'])
        body = json.dumps(fail)
        unicode_body = '"' + ''.join('\\u%04x' % ord(c) for c in body) + '"'
        for response in (body, json.dumps({'outer': [fail]}), json.dumps(body),
                         json.dumps({'note': json.dumps(body)}), unicode_body,
                         json.dumps({body: 0}), json.dumps([{'outer': {body: 0}}])):
            with self.subTest(response=response):
                self.check(response)

    def test_structured_pass_cannot_hide_malformed_or_wrong_sha_response(self):
        for response in ('unparsed verdict: FAIL', '{"verdict":"FAIL"',
                         json.dumps({'verdict': 'FAIL'}),
                         json.dumps(verdict(reviewed_sha='b'*40)),
                         json.dumps(verdict(extra=True)),
                         json.dumps(verdict(findings=['hidden'])),
                         '{"verdict":"PASS","verdict":"FAIL"}', '[NaN]',
                         json.dumps({'note': '{"verdict":"FAIL"'})):
            with self.subTest(response=response):
                self.check(response)

    def test_invalid_structured_objects_never_fall_back_to_valid_response(self):
        for structured in (False, [], '', 0, 'x', verdict(reviewed_sha='b'*40),
                           verdict(findings=['hidden']), {'verdict': 'PASS'},
                           verdict(extra=True)):
            with self.subTest(structured=structured):
                self.check(json.dumps(verdict()), structured=structured)

    def test_structured_findings_cannot_hide_nested_encoded_verdict(self):
        # Both channels use the recursive scanner, including structured strings.
        self.check('', structured=verdict(verdict='FAIL', findings=[json.dumps(verdict())]))

    def test_structured_pass_still_uses_bounded_whole_response_scanner(self):
        for response in ('x' * ((1 << 20)+1), '['*65+'0'+']'*65,
                         json.dumps([0]*100001), '"'+'\\'*8192+' verdict'):
            with self.subTest(size=len(response)):
                self.check(response)
        for budget in ('_VERDICT_SCAN_BYTES', '_VERDICT_SCAN_STEPS'):
            with self.subTest(budget=budget), patch.object(N, budget, 10):
                self.check('ordinary prose')


def with_tools(updates):
    events = rows()
    for index, name, state, extra in updates:
        events.insert(-2, dict(event='step_update', step_update=dict(
            conversation_id=CID, step_index=index, step_type='tool',
            tool_name=name, state=state, **extra)))
    return events


class ToolCompletionState(unittest.TestCase):
    def parse_tools(self, updates, role):
        events = with_tools(updates)
        if role == 'analysis':
            binding = dict(role=N.ANALYSIS_ROLE, input_fingerprint='f'*64)
            events[0]['init'].pop('json_schema')
            events[0]['init']['tools'] = ['view_file', 'run_command']
            events = [e for e in events if e.get('step_update', {}).get('step_type') != 'finish']
            events[-1]['result'].pop('structured_output')
            events[-1]['result']['response'] = json.dumps(dict(binding,
                completion='COMPLETE', analysis='Synthetic lifecycle control.',
                evidence=['Synthetic in-memory events only.'], limitations=[]))
            return N.parse_stream(wire(events), SHA, analysis_binding=binding)
        return N.parse_stream(wire(events), SHA)

    def test_done_tools_and_identical_done_updates_accept(self):
        for role in ('qa', 'analysis'):
            for name in ('run_command', 'view_file'):
                for states in (('DONE',), ('DONE', 'DONE'), ('ACTIVE', 'DONE', 'DONE'),
                               ('ACTIVE', 'ACTIVE', 'DONE')):
                    with self.subTest(role=role, name=name, states=states):
                        result, receipt = self.parse_tools([(4, name, s, {}) for s in states], role)
                        if role == 'qa':
                            self.assertEqual(result, verdict())
                        else:
                            self.assertEqual(result['completion'], 'COMPLETE')
                            self.assertNotIn('verdict', result)
                        self.assertEqual(receipt['tool_events'], 1)
                        self.assertEqual(receipt['tool_names'], [name])

    def test_distinct_and_interleaved_tool_indices_accept(self):
        for role in ('qa', 'analysis'):
            for first in ('run_command', 'view_file'):
                for second in ('run_command', 'view_file'):
                    with self.subTest(role=role, first=first, second=second):
                        updates = [(4, first, 'ACTIVE', {}), (5, second, 'ACTIVE', {}),
                                   (5, second, 'DONE', {}), (4, first, 'DONE', {}),
                                   (5, second, 'DONE', {}), (4, first, 'DONE', {})]
                        result, receipt = self.parse_tools(updates, role)
                        self.assertEqual(result.get('verdict' if role == 'qa' else 'completion'),
                                         'PASS' if role == 'qa' else 'COMPLETE')
                        self.assertEqual(receipt['tool_events'], 2)
                        self.assertEqual(receipt['tool_names'], sorted({first, second}))

    def test_incomplete_or_denied_error_cannot_be_hidden_by_later_done(self):
        for role in ('qa', 'analysis'):
            for name in ('run_command', 'view_file'):
                for state, extra in (('ACTIVE', {}), ('ERROR', {}), ('DENIED', {}), ('UNKNOWN', {}),
                                     ('DONE', {'tool_info': {'is_error': True}}),
                                     ('DONE', {'nested': {'decision': 'SKIPPED'}}),
                                     ('DONE', {'nested': {'permission': 'DENIED'}}),
                                     ('DONE', {'denied_actions': ['synthetic denied read']})):
                    updates = [(4, name, state, extra)]
                    if state != 'ACTIVE':
                        updates.append((4, name, 'DONE', {}))
                    with self.subTest(role=role, name=name, state=state, extra=extra), \
                         self.assertRaises(N.ReviewError):
                        self.parse_tools(updates, role)

    def test_identity_change_cannot_erase_an_unfinished_tool(self):
        events = with_tools([(4, 'run_command', 'ACTIVE', {}), (4, 'view_file', 'DONE', {})])
        with self.assertRaises(N.ReviewError):
            N.parse_stream(wire(events), SHA)

    def test_reopened_unfinished_tool_remains_rejected(self):
        events = with_tools([(4, 'run_command', state, {}) for state in ('DONE', 'ACTIVE')])
        with self.assertRaises(N.ReviewError):
            N.parse_stream(wire(events), SHA)

    def test_qa_completed_tool_identity_change_must_reject(self):
        events = with_tools([(4, 'run_command', 'DONE', {}), (4, 'view_file', 'DONE', {})])
        with self.assertRaises(N.ReviewError):
            N.parse_stream(wire(events), SHA)

    def test_qa_reopened_then_done_tool_must_reject(self):
        events = with_tools([(4, 'run_command', state, {}) for state in ('DONE', 'ACTIVE', 'DONE')])
        with self.assertRaises(N.ReviewError):
            N.parse_stream(wire(events), SHA)

    def test_identity_change_before_done_must_reject(self):
        for role in ('qa', 'analysis'):
            for first, second in (('run_command', 'view_file'), ('view_file', 'run_command')):
                for previous in ('ACTIVE', 'DONE'):
                    for changed in ('ACTIVE', 'DONE'):
                        # Close both names so the final all-DONE gate alone cannot
                        # catch identity drift. Extra valid tools cannot erase it.
                        updates = [(4, first, previous, {}), (4, second, changed, {}),
                                   (4, second, 'DONE', {}), (4, first, 'DONE', {}),
                                   (5, first, 'DONE', {})]
                        with self.subTest(role=role, first=first, previous=previous, changed=changed), \
                             self.assertRaises(N.ReviewError):
                            self.parse_tools(updates, role)

    def test_done_cannot_reopen_with_interleaved_tools(self):
        for role in ('qa', 'analysis'):
            for name in ('run_command', 'view_file'):
                for close_again in (False, True):
                    updates = [(4, name, 'DONE', {}), (5, name, 'ACTIVE', {}),
                               (4, name, 'ACTIVE', {}), (5, name, 'DONE', {})]
                    if close_again:
                        updates.append((4, name, 'DONE', {}))
                    with self.subTest(role=role, name=name, close_again=close_again), \
                         self.assertRaises(N.ReviewError):
                        self.parse_tools(updates, role)

    def test_analysis_identity_and_reopen_guards_remain_strict(self):
        # The schema-free analysis envelope itself must be accepted. A QA-shaped
        # terminal would reject for the wrong reason even without lifecycle guards.
        result, receipt = self.parse_tools([(4, 'run_command', 'DONE', {})], 'analysis')
        self.assertEqual(result['completion'], 'COMPLETE')
        self.assertNotIn('verdict', result)
        self.assertEqual(receipt['tool_events'], 1)
        for updates in ([(4, 'run_command', 'DONE', {}), (4, 'view_file', 'DONE', {})],
                        [(4, 'run_command', s, {}) for s in ('DONE', 'ACTIVE', 'DONE')]):
            with self.subTest(updates=updates), self.assertRaises(N.ReviewError):
                self.parse_tools(updates, 'analysis')


if __name__ == '__main__':
    unittest.main()

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
        self.assertEqual(cmd[-2:], ['-p', 'PUBLIC_SOURCE_SENTINEL'])
        self.assertEqual(cmd[cmd.index('--print-timeout') + 1], '90s')
        self.assertEqual(cmd[cmd.index('--output-format') + 1], 'stream-json')
        self.assertIn('--sandbox', cmd)
        self.assertIn('--disable-slash-commands', cmd)
        for forbidden in ('--dangerously-skip-permissions', '--continue', '--conversation', '--remote-control'):
            self.assertNotIn(forbidden, cmd)

    def test_unqualified_executor_refuses_before_popen_or_temp_workspace(self):
        with patch.object(N.subprocess, 'Popen', side_effect=AssertionError('provider started')), \
             patch.object(N.tempfile, 'TemporaryDirectory', side_effect=AssertionError('workspace created')):
            with patch.object(N, 'qualification', side_effect=N.ReviewError('missing qualification')):
                with self.assertRaisesRegex(N.ReviewError, 'qualification'):
                    N.invoke('public prompt', 60, work=Path('/tmp'), slot='slot2', task_hash='x', charge=Mock())
        with patch.object(N, 'qualification', side_effect=N.ReviewError('native auth unavailable')):
            self.assertEqual(N.available('slot2', 'x'), (False, 'Antigravity QA unavailable: native auth unavailable'))


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
            seen.append(text);return wire(events),{'qualification_phase':'canary'}
        with patch('context_policy.inject',inject),patch.object(N,'invoke',invoke):
            result,receipt=N.review(self.root,self.base,head,'raw task',60,slot='slot2',
                task_hash='x',charge=Mock(),accepted_rules=rules)
        self.assertEqual(result['verdict'],'PASS')
        self.assertEqual(seen[0].count('TRUSTED_ACCEPTED_POLICY'),1)
        self.assertEqual(receipt['input_sha256'],hashlib.sha256(seen[0].encode()).hexdigest())
        self.assertEqual(receipt['rules_context'],{'delivered':'synthetic'})

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
        with patch.object(N, 'qualification', side_effect=N.ReviewError('executor not provisioned')), \
             patch.object(N, 'invoke', side_effect=AssertionError('model started')):
            choice = core.route(S, task, 'qa', 'auto', budget, 'slot2')
        self.assertEqual(choice['provider'], 'codex')
        self.assertIn('Antigravity QA unavailable', choice['unavailable']['agy:claude-sonnet-5-5-medium'])
        self.assertEqual(task, before)
        budget.charge.assert_not_called()


class NativeToolScope(unittest.TestCase):
    def test_authorized_successful_native_tool_steps_are_receipted(self):
        events=rows()
        for state in ('ACTIVE','DONE'):
            events.insert(-2, {'event':'step_update','step_update':{'conversation_id':CID,
                'step_index':4,'step_type':'tool','tool_name':'run_command','state':state}})
        result, evidence=N.parse_stream(wire(events),SHA)
        self.assertEqual(result['verdict'],'PASS')
        self.assertEqual(evidence['tool_events'],1)
        self.assertEqual(evidence['tool_names'],['run_command'])

    def test_ordinary_executor_reuses_existing_landlock_readonly_and_subprocesses(self):
        with tempfile.TemporaryDirectory(prefix='gb-agy-synthetic-') as temp:
            root=Path(temp); work=root/'candidate';work.mkdir()
            subprocess.run(['git','init','-q',str(work)],check=True,capture_output=True)
            (work/'source.py').write_text('original')
            outside=root/'outside-key';outside.write_text('synthetic outside canary')
            script = """
import json,os,pathlib,subprocess
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
            original=N.filesystem_roots
            def roots(private,candidate):
                return original(private,candidate)
            def cmd(timeout,prompt):return [sys.executable,'-I','-c',script]
            original_popen=subprocess.Popen; charged=[]
            def popen(argv,**kwargs):
                self.assertEqual(charged,['one'])
                kwargs['env'].update(WORK=str(work),OUTSIDE=str(outside))
                return original_popen(argv,**kwargs)
            with patch.object(N,'qualification',return_value={'phase':'canary'}), \
                 patch.object(N.os,'geteuid',return_value=978), \
                 patch.object(N,'trusted',return_value=b'{"token":"synthetic"}'), \
                 patch.object(N,'command',cmd), patch.object(N,'AGY',sys.executable):
                raw, evidence=N.invoke('synthetic prompt',30,work=work,slot='slot2',task_hash='x',
                    charge=lambda:charged.append('one'),popen=popen)
            self.assertEqual(json.loads(raw),{'read':True,'write':False,'chmod_then_write':False,
                                               'outside':False,'shell':True})
            self.assertEqual((work/'source.py').read_text(),'original')
            self.assertEqual(evidence['filesystem_boundary'],'existing_native_guard_landlock')
            self.assertEqual(charged,['one'])

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

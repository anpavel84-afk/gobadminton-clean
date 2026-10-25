"""Synthetic AGY author boundary tests. No vendor, real auth, install or network."""
import copy
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from test_actions_train import core, S
import native_antigravity_author as N

TOKEN = 'synthetic-access-credential-123456'
REFRESH = 'synthetic-refresh-credential-98765'
OAUTH = json.dumps({'access_token': TOKEN, 'refresh_token': REFRESH}).encode()
CID = 'author-fixture-conversation'


def rows():
    return [dict(event='init', conversation_id=CID, init=dict(model=N.MODEL, agent=N.AGENT,
                tools=list(N.AUTHOR_TOOLS), permission_mode=N.PERMISSION_MODE)),
            dict(event='step_update', step_update=dict(conversation_id=CID, step_index=0,
                step_type='agent_response', state='DONE')),
            dict(event='step_update', step_update=dict(conversation_id=CID, step_index=1,
                step_type='tool', tool_name='write_to_file', state='DONE')),
            dict(event='step_update', step_update=dict(conversation_id=CID, step_index=2,
                step_type='finish', state='DONE')),
            dict(event='result', result=dict(status='SUCCESS', conversation_id=CID,
                usage={'input_tokens': 12, 'output_tokens': 5}))]


def wire(events):
    return b'\n'.join(json.dumps(e).encode() for e in events)+b'\n'


class Parser(unittest.TestCase):
    def test_advertised_tools_usage_and_no_schema_command(self):
        result = N.parse_stream(wire(rows()))
        self.assertEqual(result['effective_model'], N.MODEL)
        self.assertEqual(result['provider_reported_usage']['output_tokens'], 5)
        self.assertEqual(result['tool_events'], 1)
        argv = N.command(30)
        self.assertNotIn('--json-schema', argv)
        self.assertEqual(argv[argv.index('--agent')+1], N.AGENT)
        self.assertIn('--dangerously-skip-permissions', argv)
        for tool in N.AUTHOR_TOOLS: self.assertIn('  - '+tool+'\n', N.AGENT_DEF)

    def test_exact_advertised_subset_is_allowed(self):
        events = rows(); events[0]['init']['tools'] = ['write_to_file']
        N.parse_stream(wire(events))
        events[0]['init']['tools'] = ['view_file']
        with self.assertRaises(core.Refused): N.parse_stream(wire(events))

    def test_bad_streams_and_nested_audit_fail_closed(self):
        cases = []
        for field, value in [('model','auto'), ('agent','other'), ('permission_mode','auto'),
                             ('tools',['view_file','view_file']), ('tools',['view_file','finish']),
                             ('tools',[]), ('json_schema', {'type':'object'})]:
            e = rows(); e[0]['init'][field] = value; cases.append(e)
        for state in ('ACTIVE','ERROR','DENIED','SKIPPED'):
            e = rows(); e[2]['step_update']['state'] = state; cases.append(e)
        e = rows(); e[2]['step_update']['tool_name'] = 'unadvertised'; cases.append(e)
        e = rows(); e[-1]['result']['usage'] = {'tokens':True}; cases.append(e)
        e = rows(); e[-1]['result']['conversation_id'] = 'other'; cases.append(e)
        e = rows(); e[1]['step_update']['conversation_id'] = 'other'; cases.append(e)
        e = rows(); e[-1]['result']['status'] = 'FAILURE'; cases.append(e)
        e = rows(); e[-1]['result']['nested'] = {'error':'denied'}; cases.append(e)
        e = rows(); e[0]['nested'] = {'permissionDenied':True}; cases.append(e)
        cases += [rows()[:-1], rows()+[rows()[-1]], rows()[1:], [rows()[0], *rows()],
                  [rows()[0], *rows()[2:]], rows()[:3]+rows()[4:]]
        e = rows(); e.insert(3, copy.deepcopy(e[2])); e[3]['step_update']['state'] = 'ACTIVE'; cases.append(e)
        e = rows(); e.insert(3, copy.deepcopy(e[2])); e[3]['step_update']['tool_name'] = 'view_file'; cases.append(e)
        for index, events in enumerate(cases):
            with self.subTest(index=index), self.assertRaises((core.Refused, N.ReviewError)):
                N.parse_stream(wire(events))
        with self.assertRaises(N.ReviewError): N.parse_stream(b'{"event":"init","event":"result"}')


    def test_usage_keys_are_closed_and_bounded(self):
        events = rows(); events[1]['step_update']['text'] = 'Тест 🏸'
        self.assertEqual(N.parse_stream(wire(events))['effective_model'], N.MODEL)
        for usage in ({'UPPER': 1}, {'a' * 65: 1}, {'hyphen-key': 1},
                      {f'tokens_{i}': 1 for i in range(33)}, {'tokens': -1},
                      {'tokens': {'nested': 1}}):
            events = rows(); events[-1]['result']['usage'] = usage
            with self.subTest(usage=usage), self.assertRaises(core.Refused):
                N.parse_stream(wire(events))


class Qualification(unittest.TestCase):
    def setUp(self):
        self.marker = dict(schema='GB_ANTIGRAVITY_AUTHOR_V1', phase='canary', slot='slot2', executor_uid=978,
            canary_task_sha256='exact', admitted_models=[N.MODEL], modules={n:hashlib.sha256(
                Path(N.__file__).with_name(n).read_bytes()).hexdigest() for n in N.MODULES})
        def trusted(path, **kwargs):
            if path == N.MARKER: return json.dumps(self.marker).encode()
            if path == N.AGY: return b'fixture-executable'
            self.assertEqual(path, N.AUTH); self.assertEqual(kwargs['owner'], 978)
            return OAUTH
        self.stack = ExitStack(); self.addCleanup(self.stack.close)
        self.reader = self.stack.enter_context(patch.object(N, 'trusted', side_effect=trusted))
        self.stack.enter_context(patch.object(N, 'AGY_SHA256', hashlib.sha256(b'fixture-executable').hexdigest()))
        self.boundary = self.stack.enter_context(patch.object(N, '_verify_executor_boundary'))

    def test_canary_task_and_medium_only(self):
        self.assertEqual(N.qualification('slot2', 'exact')['phase'], 'canary')
        for slot, task, model in [('slot1','exact',N.MODEL), ('slot2','wrong',N.MODEL),
                                  ('slot2',None,N.MODEL), *[('slot2','exact',m) for m in N.MODELS-{N.MODEL}]]:
            with self.subTest(slot=slot,task=task,model=model), self.assertRaises(core.Refused):
                N.qualification(slot, task, model)

        # Exercise the actual route -> available -> qualification chain too.
        task = dict(work_kind='implementation', risk='routine',
                    author_routes=['agy:'+N.MODEL, 'codex:gpt-6.1-sol:medium'],
                    qa_routes=['codex:gpt-6.1-sol:medium'])
        budget = Mock(remaining=lambda *a:10, used=lambda *a:0)
        self.marker['canary_task_sha256'] = core.digest(task)
        self.assertEqual(core.route(S,task,'author','auto',budget,'slot2')['provider'],'agy')
        self.assertEqual(core.route(S,task,'author','auto',budget,'slot1')['provider'],'codex')
        self.marker['canary_task_sha256'] = 'wrong'
        self.assertEqual(core.route(S,task,'author','auto',budget,'slot2')['provider'],'codex')
        for model in N.MODELS-{N.MODEL}:
            task['author_routes'][0] = 'agy:'+model
            self.marker['canary_task_sha256'] = core.digest(task)
            self.assertEqual(core.route(S,task,'author','auto',budget,'slot2')['provider'],'codex')

    def test_ready_models_are_explicit_unique_subset(self):
        self.marker['phase'] = 'ready'
        N.qualification('slot2','other')
        for model in N.MODELS-{N.MODEL}:
            with self.assertRaises(core.Refused): N.qualification('slot2','other',model)
            self.marker['admitted_models'].append(model)
            N.qualification('slot2','other',model)
        for models in ([], True, [N.MODEL,N.MODEL], ['auto'], None):
            self.marker['admitted_models'] = models
            with self.subTest(models=models), self.assertRaises(core.Refused): N.qualification('slot2','other')

    def test_schema_phase_uid_module_and_executable_drift(self):
        original = copy.deepcopy(self.marker)
        for key, value in [('schema','wrong'), ('phase','prepared'), ('executor_uid',0), ('slot','slot1')]:
            self.marker = original | {key:value}
            self.assertFalse(N.available('slot2','exact')[0])
        for name in N.MODULES:
            self.marker = copy.deepcopy(original); self.marker['modules'][name] = 'bad'
            self.assertFalse(N.available('slot2','exact')[0])
        self.marker = original
        with patch.object(N, 'AGY_SHA256', '0'*64): self.assertFalse(N.available('slot2','exact')[0])
        self.boundary.side_effect = PermissionError('synthetic private failure')
        self.assertFalse(N.available('slot2','exact')[0])
        self.assertNotIn('synthetic private', N.available('slot2','exact')[1])

    def test_missing_marker_is_closed_before_auth(self):
        self.reader.side_effect = FileNotFoundError('fixture marker missing')
        self.assertFalse(N.available('slot2','exact')[0])
        self.reader.assert_called_with(N.MARKER)

    def test_uses_trusted_root_reader(self):
        # Real exact-fd reader on an isolated fixture; reject links, hardlinks,
        # permissive metadata and wrong owner without any protected input.
        import native_antigravity as QA
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); path = root/'marker'; path.write_text('{}'); path.chmod(0o600)
            # The real reader refuses user-owned ancestors for root-owned marker.
            with self.assertRaises((OSError, QA.ReviewError)): QA.trusted(path)


class Invocation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='agy-author-test-'); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.source = self.root/'source'; self.source.mkdir()
        self.env = dict(PATH='/usr/bin:/bin',HOME=str(self.root),GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL='/dev/null')
        def git(*args, **kwargs):
            return subprocess.run(['git', *args], cwd=self.source, env=self.env, check=True,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).stdout
        subprocess.run(['git','init','-q',str(self.source)], env=self.env, check=True)
        (self.source/'allowed.txt').write_text('before\n'); (self.source/'other.txt').write_text('unchanged\n')
        (self.source/'AGENTS.md').write_text('not exported')
        (self.source/'GEMINI.md').write_text('not exported')
        (self.source/'.env.example').write_text('not exported')
        (self.source/'.gitconfig').write_text('not exported')
        (self.source/'.gitignore').write_text('build/\n.env\n')
        git('add','.'); git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture')
        self.bridge = SimpleNamespace(work=self.source,env=self.env,git=git,c=SimpleNamespace(model_timeout=30),
            store=SimpleNamespace(data={'active':dict(issue=421,attempt=1,base=git('rev-parse','HEAD').strip(),
                head=None, task={'allowed_paths':['allowed.txt']})}))
        self.outbox = self.root/'outbox'; self.outbox.mkdir()
        self.rt = SimpleNamespace(slot='slot2',layout=SimpleNamespace(outbox=self.outbox),budget=Mock())
        self.choice = dict(effective_model=N.MODEL, rules_context={'role':'author','delivery':'explicit_full_stdin'})
        self.phases = []; self.jobs = []; self.called = 0; self.guard_restored = False
        self.stack = ExitStack(); self.addCleanup(self.stack.close)
        def patcher(name, **kwargs): return self.stack.enter_context(patch.object(N, name, **kwargs))
        self.qualification = patcher('qualification', return_value={'phase':'canary'})
        self.catalog = patcher('catalog_precharge', return_value=3)
        self.refresh = patcher('retain_oauth_refresh', return_value='unchanged')
        self.trusted = patcher('trusted', return_value=OAUTH)
        patcher('_prepare_invocation_cgroup', return_value=None)
        patcher('_observe_cgroup_membership', return_value=False)
        self.reap_state = patcher('_executor_reap_state', return_value='cgroup-absent')
        patcher('_remove_cgroup')
        def reap(p): p.returncode = p.returncode if p.returncode is not None else -9
        patcher('reap', side_effect=reap)
        self.stack.enter_context(patch.object(N.os,'geteuid',return_value=978))
        # Production explicitly uses /tmp; tests redirect only that mkdtemp to TMPDIR.
        mkdtemp = tempfile.mkdtemp
        def private_temp(**kwargs):
            self.assertEqual(kwargs['dir'],'/tmp'); self.assertEqual(kwargs['prefix'],'gb-agy-author-')
            p = Path(mkdtemp(prefix=kwargs['prefix'],dir=self.root)); self.jobs.append(p); return str(p)
        self.stack.enter_context(patch.object(N.tempfile,'mkdtemp',side_effect=private_temp))

    def invoke(self, mode='success', events=None):
        def popen(argv, **kwargs):
            self.called += 1
            self.rt.budget.charge.assert_called_once_with('slot2','agy','author')
            work = Path(kwargs['cwd']); self.assertNotEqual(work,self.source)
            self.assertEqual(work.parent.stat().st_mode & 0o777,0o700)
            self.assertFalse((work/'.git').exists()); self.assertFalse((work/'AGENTS.md').exists())
            for name in ('GEMINI.md','.env.example','.gitconfig'): self.assertFalse((work/name).exists())
            auth = Path(kwargs['env']['HOME'])/'.gemini/antigravity-cli/antigravity-oauth-token'
            self.assertEqual(auth.stat().st_mode & 0o777,0o600)
            self.assertEqual(auth.read_bytes(),OAUTH)
            self.assertNotIn(TOKEN,json.dumps(argv)); self.assertNotIn(REFRESH,json.dumps(kwargs['env']))
            p = Mock(pid=99999999,returncode=None)
            def communicate(input,timeout):
                self.assertNotIn(TOKEN.encode(),input); self.assertNotIn(REFRESH.encode(),input)
                p._input_offset = len(input)
                if mode == 'timeout': raise subprocess.TimeoutExpired(argv,timeout)
                if mode != 'empty': (work/'allowed.txt').write_text('after\n')
                if mode == 'delete': (work/'allowed.txt').unlink()
                if mode == 'offscope': (work/'other.txt').write_text('bad')
                if mode == 'ignore_override':
                    (work/'.gitignore').write_text('*\n'); (work/'offscope').write_text('bad')
                if mode == 'symlink':
                    (work/'allowed.txt').unlink(); (work/'allowed.txt').symlink_to(self.source/'other.txt')
                if mode == 'hardlink':
                    (work/'allowed.txt').unlink(); os.link(work/'other.txt',work/'allowed.txt')
                if mode in ('.git', '.agents', 'AGENTS.md', '.env'):
                    path = work/mode
                    if path.exists() and path.is_dir(): path = path/'extra'
                    path.write_text('bad')
                if mode == 'oversize': (work/'allowed.txt').write_bytes(b'x'*(N.MAX_FILE+1))
                if mode == 'secret': (work/'allowed.txt').write_text(TOKEN)
                if mode == 'refresh-secret': (work/'allowed.txt').write_text(REFRESH)
                if mode == 'candidate':
                    (self.source/'other.txt').chmod(0o600); (self.source/'other.txt').write_text('tampered')
                if mode == 'ignored':
                    (work/'build').mkdir(); (work/'build/test-result').write_text('generated')
                raw = wire(events or rows())
                if mode == 'stream-secret': raw += TOKEN.encode()
                if mode == 'stderr-secret': kwargs['stderr'].write(REFRESH.encode())
                if mode == 'stream-oversize': raw = b'x'*(N.MAX_OUT+1)
                kwargs['stdout'].write(raw); kwargs['stdout'].flush(); kwargs['stderr'].flush()
                p.returncode = 7 if mode == 'exit' else 0
            p.communicate.side_effect = communicate
            p.poll.side_effect = lambda:p.returncode
            return p
        def atomic(path,value):
            self.phases.append(value['phase']); path.write_text(json.dumps(value))
        return N.invoke(self.bridge,self.rt,'trusted full rules and task',self.choice,
            popen=popen,atomic=atomic,permitted=lambda n,allowed:n in allowed)

    def assert_failed(self):
        receipt = json.loads((self.outbox/'agy-author-receipt.json').read_text())
        self.assertEqual(receipt['phase'],'failed_no_automatic_replay')
        self.assertEqual(receipt['charge_state'],'charged')
        self.assertEqual((self.source/'allowed.txt').read_text(),'before\n')
        self.rt.budget.charge.assert_called_once_with('slot2','agy','author')
        self.assertEqual(self.called,1)
        self.assertTrue(all(not p.exists() for p in self.jobs))
        for path in self.outbox.rglob('*'):
            if path.is_file():
                self.assertNotIn(TOKEN.encode(),path.read_bytes()); self.assertNotIn(REFRESH.encode(),path.read_bytes())

    def test_success_one_charge_private_cleanup_guard_restored_before_import(self):
        self.catalog.side_effect = lambda *args: self.rt.budget.charge.assert_not_called()
        original_import = N._import
        # Check exact original modes rather than assuming the test runner umask.
        original_mode = self.source.stat().st_mode
        def trusted_import(*args):
            self.assertEqual(self.source.stat().st_mode,original_mode); original_import(*args)
        with patch.object(N,'_import',side_effect=trusted_import): result = self.invoke('ignored')
        self.assertEqual(self.phases,['prepared','charged','running','validated','imported'])
        self.assertEqual(result['provider_reported_usage']['input_tokens'],12)
        self.assertEqual((self.source/'allowed.txt').read_text(),'after\n')
        self.assertEqual((self.source/'other.txt').read_text(),'unchanged\n')
        self.assertFalse((self.source/'build').exists())
        self.assertTrue(all(not p.exists() for p in self.jobs))
        r = self.choice['native_receipt']
        self.assertEqual(r['changed_paths'],['allowed.txt']); self.assertEqual(r['exit_code'],0)
        self.assertEqual(r['filesystem_boundary'],'uid978_unix_permissions_nnp')
        self.assertFalse(r['filesystem_roots_enforced']); self.assertFalse(r['requested_native_sandbox'])
        self.assertEqual(r['executor_reap'],'cgroup-absent')
        self.assertIsNotNone(r['source_export_sha256']); self.assertIsNotNone(r['output_manifest_sha256'])
        self.assertNotIn(TOKEN,json.dumps(r)); self.assertNotIn(REFRESH,json.dumps(r))

    def test_permitted_deletion(self):
        self.invoke('delete'); self.assertFalse((self.source/'allowed.txt').exists())

    def test_nonzero(self):
        with self.assertRaises(N.ReviewError): self.invoke('exit')
        self.assert_failed()

    def test_timeout(self):
        with self.assertRaises(N.ReviewError): self.invoke('timeout')
        self.assert_failed()

    def test_empty(self):
        with self.assertRaises(N.ReviewError): self.invoke('empty')
        self.assert_failed()

    def test_offscope(self):
        with self.assertRaises(N.ReviewError): self.invoke('offscope')
        self.assert_failed()

    def test_candidate_ignore_cannot_hide_output(self):
        with self.assertRaises(N.ReviewError): self.invoke('ignore_override')
        self.assert_failed()

    def test_symlink(self):
        with self.assertRaises(N.ReviewError): self.invoke('symlink')
        self.assert_failed()

    def test_hardlink(self):
        with self.assertRaises(N.ReviewError): self.invoke('hardlink')
        self.assert_failed()

    def test_forbidden_git(self):
        with self.assertRaises(N.ReviewError): self.invoke('.git')
        self.assert_failed()

    def test_forbidden_agents(self):
        with self.assertRaises(N.ReviewError): self.invoke('.agents')
        self.assert_failed()

    def test_forbidden_instructions(self):
        with self.assertRaises(N.ReviewError): self.invoke('AGENTS.md')
        self.assert_failed()

    def test_forbidden_env_even_when_ignored(self):
        with self.assertRaises(N.ReviewError): self.invoke('.env')
        self.assert_failed()

    def test_oversize(self):
        with self.assertRaises(N.ReviewError): self.invoke('oversize')
        self.assert_failed()

    def test_credential_source(self):
        with self.assertRaises(N.ReviewError): self.invoke('secret')
        self.assert_failed()

    def test_refresh_credential_source(self):
        with self.assertRaises(N.ReviewError): self.invoke('refresh-secret')
        self.assert_failed()

    def test_credential_stdout_is_not_retained(self):
        with self.assertRaises(N.ReviewError): self.invoke('stream-secret')
        self.assert_failed()

    def test_credential_stderr_is_not_retained(self):
        with self.assertRaises(N.ReviewError): self.invoke('stderr-secret')
        self.assert_failed()

    def test_output_bound(self):
        with self.assertRaises(N.ReviewError): self.invoke('stream-oversize')
        self.assert_failed()

    def test_candidate_changed(self):
        with self.assertRaises(N.ReviewError): self.invoke('candidate')
        self.assert_failed()
        self.assertEqual(self.choice['native_receipt']['error_code'],'AGY_CANDIDATE_CHANGED')

    def test_busy_cgroup(self):
        self.reap_state.return_value = 'cgroup-busy'
        with self.assertRaises(N.ReviewError): self.invoke()
        self.assert_failed()

    def test_wrong_model_stream(self):
        e = rows(); e[0]['init']['model'] = 'auto'
        with self.assertRaises(N.ReviewError): self.invoke(events=e)
        self.assert_failed()

    def test_unadvertised_tool_stream(self):
        e = rows(); e[2]['step_update']['tool_name'] = 'dangerous_tool'
        with self.assertRaises(N.ReviewError): self.invoke(events=e)
        self.assert_failed()

    def test_duplicate_result_stream(self):
        with self.assertRaises(N.ReviewError): self.invoke(events=rows()+[rows()[-1]])
        self.assert_failed()

    def test_missing_result_stream(self):
        with self.assertRaises(N.ReviewError): self.invoke(events=rows()[:-1])
        self.assert_failed()

    def test_qualification_precedes_every_charge(self):
        self.qualification.side_effect = core.Refused('no marker')
        with self.assertRaises(core.Refused): self.invoke()
        self.rt.budget.charge.assert_not_called(); self.catalog.assert_not_called()
        self.assertEqual(self.jobs,[])

    def test_catalog_or_refresh_failure_never_charges(self):
        self.catalog.side_effect = N.ReviewError()
        with self.assertRaises(N.ReviewError): self.invoke()
        self.rt.budget.charge.assert_not_called(); self.assertEqual(self.called,0)

    def test_refresh_failure_before_charge(self):
        self.refresh.side_effect = N.ReviewError()
        with self.assertRaises(N.ReviewError): self.invoke()
        self.rt.budget.charge.assert_not_called(); self.assertEqual(self.called,0)


    def credential_events(self, variant):
        events = rows()
        if variant == 'key': events[-1]['result']['usage'] = {TOKEN: 5}
        elif variant == 'value': events[-1]['result']['text'] = TOKEN
        elif variant == 'nested': events[-1]['result']['data'] = [{'deep': {TOKEN: [REFRESH]}}]
        elif variant == 'tool_args': events[2]['step_update']['arguments'] = {'content': TOKEN}
        elif variant == 'tool_response': events[2]['step_update']['response'] = {'text': REFRESH}
        elif variant == 'response': events[1]['step_update']['text'] = TOKEN
        return events

    def escaped_wire(self, events):
        return wire(events).replace(TOKEN.encode(), b'\\u0073'+TOKEN[1:].encode()).replace(
            REFRESH.encode(), b'\\u0073'+REFRESH[1:].encode())

    def reject_encoded(self, variant):
        events = self.credential_events(variant)
        raw = self.escaped_wire(events)
        with patch(__name__+'.wire', return_value=raw), self.assertRaises(N.ReviewError) as raised:
            self.invoke(events=events)
        self.assertEqual(type(raised.exception), N.ReviewError)
        self.assertNotIn(TOKEN, str(raised.exception)); self.assertNotIn(REFRESH, str(raised.exception))
        self.assertNotIn(TOKEN, json.dumps(self.choice)); self.assertNotIn(REFRESH, json.dumps(self.choice))
        self.assert_failed()

    def test_escaped_usage_key(self): self.reject_encoded('key')
    def test_escaped_result_value(self): self.reject_encoded('value')
    def test_escaped_nested_keys_and_values(self): self.reject_encoded('nested')
    def test_escaped_tool_arguments(self): self.reject_encoded('tool_args')
    def test_escaped_tool_response(self): self.reject_encoded('tool_response')
    def test_escaped_response_text(self): self.reject_encoded('response')

    def test_decoded_stderr_json_is_checked_before_evidence(self):
        source = N._source
        def stream(path, root):
            if path.name == 'stderr': return json.dumps({'diagnostic': TOKEN}).encode().replace(
                TOKEN.encode(), b'\\u0073'+TOKEN[1:].encode())
            return source(path, root)
        with patch.object(N, '_source', side_effect=stream), self.assertRaises(N.ReviewError): self.invoke()
        self.assert_failed()

    def test_decoded_string_stderr_is_checked_before_evidence(self):
        source = N._source
        def stream(path, root):
            if path.name == 'stderr': return json.dumps(TOKEN).encode().replace(TOKEN.encode(), b'\\u0073'+TOKEN[1:].encode())
            return source(path, root)
        with patch.object(N, '_source', side_effect=stream), self.assertRaises(N.ReviewError): self.invoke()
        self.assert_failed()

    def test_real_stage_finalizer_never_exports_decoded_credentials(self, variant="key"):
        from test_actions_train import stage, req, receiver
        import context_policy
        self.bridge.model = Mock(); self.bridge.unchanged_issue = Mock()
        self.rt.user = 'fixture'; self.rt.legacy = True; self.rt.home = self.root; self.rt.key = self.root/'key'
        self.rt.layout.repo = self.source; self.rt.layout.state_dir = self.outbox; self.rt.layout.worktrees = self.root
        self.rt.check_paths = Mock(); self.rt.continuity = lambda: True; self.rt.lease = Mock()
        self.rt.budget.used = lambda *args: self.rt.budget.charge.call_count
        traces = []
        a = SimpleNamespace(RUNTIME_READS=(), Store=lambda *_: self.bridge.store, permitted=lambda *_: True,
            atomic=lambda p,v: traces.append(copy.deepcopy(v)), subprocess=SimpleNamespace(Popen=Mock()))
        def factory(c, store): self.bridge.c = c; return self.bridge
        a.Bridge = factory
        runtime = SimpleNamespace(Runtime=lambda *_a,**_k: self.rt, uid_of=lambda _: os.getuid(),
            Hold=RuntimeError, read_json=lambda *_a,**_k: {'mode':'active','owned':{'slot2':'fixture'}})
        original_invoke = N.invoke
        # One charged invocation per isolated stage instance, including its finally/export.
        events = self.credential_events(variant); raw = self.escaped_wire(events)
        def invoke_fixture(bridge, rt, prompt, routing, **kw):
            self.choice = routing
            with patch.object(N, 'invoke', original_invoke): return self.invoke(events=events)
        choice = dict(provider='agy', effective_model=N.MODEL, effort=None, role='author')
        with patch.object(stage, 'live', return_value=(a,runtime)), patch.object(stage, 'API', return_value=Mock()), \
             patch.object(stage, 'route', return_value=choice), patch.object(context_policy, 'load', return_value=('TRUSTED_FULL_RULES',{})), \
             patch.object(context_policy, 'inject', return_value=('TRUSTED_FULL_RULES',{'role':'author'})), \
             patch.object(receiver, 'units_quiet'), patch.object(N, 'invoke', side_effect=invoke_fixture), \
             patch(__name__+'.wire', return_value=raw):
            request = req('author','candidate'); request['slot'] = 'slot2'
            context = stage.setup(request, {'codex':{'slot2':str(self.root/'vendor')}})
            with self.assertRaises(N.ReviewError) as raised: context[-1].model('task data')
            exported = stage.model_receipt({'status':'unknown'}, context)
        self.assertEqual(type(raised.exception), N.ReviewError)
        for token in (TOKEN, REFRESH):
            self.assertNotIn(token, json.dumps(traces)); self.assertNotIn(token, json.dumps(exported))
        self.assertEqual(exported['routing']['usage']['charged_calls'], 1)
        self.assert_failed()

    def test_real_stage_escaped_value(self): self.test_real_stage_finalizer_never_exports_decoded_credentials('value')
    def test_real_stage_escaped_nested(self): self.test_real_stage_finalizer_never_exports_decoded_credentials('nested')
    def test_real_stage_escaped_tool_args(self): self.test_real_stage_finalizer_never_exports_decoded_credentials('tool_args')
    def test_real_stage_escaped_tool_response(self): self.test_real_stage_finalizer_never_exports_decoded_credentials('tool_response')
    def test_real_stage_escaped_response(self): self.test_real_stage_finalizer_never_exports_decoded_credentials('response')

    def test_escaped_plain_stderr_is_checked_before_evidence(self):
        source = N._source
        def stream(path, root):
            if path.name == 'stderr': return b'diagnostic: \\u0073'+TOKEN[1:].encode()
            return source(path, root)
        with patch.object(N, '_source', side_effect=stream), self.assertRaises(N.ReviewError): self.invoke()
        self.assert_failed()

    def test_failure_receipt_rebuild_discards_untrusted_fields(self):
        parse = N.parse_stream
        def tainted(*args, **kwargs):
            return parse(*args, **kwargs) | {'provider_reported_usage': {TOKEN: 5}}
        with patch.object(N, 'parse_stream', side_effect=tainted), self.assertRaises(N.ReviewError): self.invoke()
        self.assertNotIn(TOKEN, json.dumps(self.choice)); self.assert_failed()

    def test_payload_snapshot_race_refuses_import(self):
        snapshot = N.snapshot
        def race(work, bridge, before):
            after = snapshot(work, bridge, before)
            (work/'allowed.txt').write_bytes(b'different-after-validation\n')
            return after
        with patch.object(N, 'snapshot', side_effect=race), self.assertRaises(N.ReviewError): self.invoke()
        self.assert_failed()

    def test_payload_deleted_after_snapshot_refuses_import(self):
        snapshot = N.snapshot
        def race(work, bridge, before):
            after = snapshot(work, bridge, before)
            (work/'allowed.txt').unlink()
            return after
        # A missing payload must also discard previously parsed provider fields
        # from the durable failure receipt, rather than retaining stale usage.
        with patch.object(N, 'snapshot', side_effect=race), self.assertRaises(N.ReviewError): self.invoke()
        self.assert_failed()
        self.assertEqual(self.choice['native_receipt'].get('imported_payload_sha256'), None)
        self.assertIsNone(self.choice['native_receipt'].get('provider_reported_usage'))

    def test_deletion_replaced_with_write_refuses_import(self):
        snapshot = N.snapshot
        def race(work, bridge, before):
            after = snapshot(work, bridge, before)
            (work/'allowed.txt').write_bytes(b'recreated-after-deletion\n')
            return after
        with patch.object(N, 'snapshot', side_effect=race), self.assertRaises(N.ReviewError): self.invoke('delete')
        self.assert_failed()

    def test_imported_payload_digest_binds_actual_bytes(self):
        self.invoke()
        expected = {'allowed.txt': hashlib.sha256((self.source/'allowed.txt').read_bytes()).hexdigest()}
        self.assertEqual(self.choice['native_receipt']['imported_payload_sha256'], core.digest(expected))

    def test_cgroup_rechecked_before_payload_read(self):
        self.reap_state.side_effect = ['cgroup-quiet', 'cgroup-busy', 'cgroup-busy']
        with self.assertRaises(N.ReviewError): self.invoke()
        self.assert_failed()

    def assert_cleanup_failure(self, step):
        receipt = json.loads((self.outbox/'agy-author-receipt.json').read_text())
        self.assertEqual(receipt['cleanup'], 'failed')
        self.assertEqual(receipt['cleanup_'+step], 'failed')
        self.assert_failed()

    def test_cgroup_cleanup_exception_still_removes_private_tree(self):
        with patch.object(N, '_remove_cgroup', side_effect=OSError('synthetic cleanup failure')), \
             self.assertRaises(N.ReviewError): self.invoke('exit')
        self.assert_cleanup_failure('cgroup')

    def test_real_cgroup_helper_eacces_still_removes_private_tree(self):
        import native_antigravity as QA
        locked = self.root/'cgroup-parent'; locked.mkdir(); cgroup = locked/'invocation'; cgroup.mkdir()
        self.addCleanup(locked.chmod, 0o700)
        self.stack.enter_context(patch.object(N, '_prepare_invocation_cgroup', return_value=cgroup))
        locked.chmod(0)
        with patch.object(N, '_remove_cgroup', side_effect=QA._remove_cgroup), self.assertRaises(N.ReviewError): self.invoke('exit')
        self.assert_cleanup_failure('cgroup')

    def test_cgroup_helper_silent_failure_is_not_success(self):
        cgroup = self.root/'cgroup'; cgroup.mkdir()
        self.stack.enter_context(patch.object(N, '_prepare_invocation_cgroup', return_value=cgroup))
        with self.assertRaises(N.ReviewError): self.invoke('exit')
        self.assert_cleanup_failure('cgroup')

    def test_real_rmtree_permission_repair_is_failed_closed(self):
        count = [0]
        def refresh(auth, original):
            count[0] += 1
            if count[0] == 2: (auth.parents[3]/'out').chmod(0)
            return 'unchanged'
        self.refresh.side_effect = refresh
        with self.assertRaises(N.ReviewError): self.invoke('exit')
        self.assert_cleanup_failure('private_tree')

    def test_guard_restore_failure_does_not_skip_tree_or_cgroup(self):
        restore = N._restore_write_guard
        guard = N._guard_accidental_writes
        saved = []
        def remember(work):
            value = guard(work); saved.append(value); return value
        # The fixture alone restores its real permissions after observing refusal.
        with patch.object(N, '_guard_accidental_writes', side_effect=remember), \
             patch.object(N, '_restore_write_guard', side_effect=OSError('synthetic restore failure')), \
             patch.object(N, '_remove_cgroup') as remove, self.assertRaises(N.ReviewError): self.invoke('exit')
        for value in saved: restore(value)
        remove.assert_called_once(); self.assert_cleanup_failure('restore_guard')

    def test_partial_rmtree_retries_and_removes_oauth_first(self):
        rmtree = N.shutil.rmtree; calls = []
        def partial(path, **kwargs):
            calls.append(path)
            self.assertFalse((Path(path)/'home/.gemini/antigravity-cli/antigravity-oauth-token').exists())
            if len(calls) == 1:
                (Path(path)/'out').chmod(0)
                raise PermissionError('synthetic partial rmtree failure')
            return rmtree(path, **kwargs)
        with patch.object(N.shutil, 'rmtree', side_effect=partial), self.assertRaises(N.ReviewError): self.invoke('exit')
        self.assertGreaterEqual(len(calls), 2); self.assert_cleanup_failure('private_tree')


if __name__ == '__main__': unittest.main()

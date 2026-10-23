"""#248 real disposable Git histories and trusted bridge/journal boundary tests."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from test_actions_train import A, S, ROOT, TASK, core, client, stage, card
from test_actions_train_stages import Store
import content_identity as identity
import qa_equivalence as qa

spec = importlib.util.spec_from_file_location('prepare_train_release', ROOT/'scripts/chatops/ops/prepare_train_release.py')
release = importlib.util.module_from_spec(spec); spec.loader.exec_module(release)


class GitFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='train248-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.repo = self.root/'source'; self.repo.mkdir()
        self.env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null',
            GIT_AUTHOR_NAME='Fixture', GIT_AUTHOR_EMAIL='fixture@example.invalid',
            GIT_COMMITTER_NAME='Fixture', GIT_COMMITTER_EMAIL='fixture@example.invalid',
            GIT_AUTHOR_DATE='2026-10-23T01:00:00+0000', GIT_COMMITTER_DATE='2026-10-23T01:00:00+0000',
            GIT_TERMINAL_PROMPT='0')
        self.git('init','-q'); self.git('checkout','-qb','automation/issue-248')
    def git(self, *args):
        p = subprocess.run(['/usr/bin/git','-c','core.hooksPath=/dev/null',*args],
            cwd=self.repo, env=self.env, capture_output=True, timeout=30)
        self.assertEqual(p.returncode,0,p.stderr.decode())
        return p.stdout.decode().strip()
    def write(self, path, raw):
        p = self.repo/path; p.parent.mkdir(parents=True,exist_ok=True)
        p.write_bytes(raw.encode() if isinstance(raw,str) else raw)
    def commit(self, message='fixture'):
        self.git('add','.'); self.git('-c','commit.gpgsign=false','commit','-qm',message)
        return self.git('rev-parse','HEAD')


class ContentReuse(GitFixture):
    def setUp(self):
        super().setUp()
        self.repo.rename(self.root/'issue-248'); self.repo=self.root/'issue-248'
        self.write('apps/runtime.py','value = 1\n')
        self.write('docs/rules/RULES.md','policy\n')
        self.write('scripts/chatops/tests/test_example.py','assert 1 == 1\n')
        self.write('apps/web/test/example.test.ts','expect(1).toBe(1);\n')
        self.base = self.commit('base')
        self.write('apps/runtime.py','value = 2\n'); self.original = self.commit('implementation')
        self.state = self.root/'state'; self.state.mkdir()
        task=copy.deepcopy(TASK);task['allowed_paths']=['apps/runtime.py','apps/web/test/example.test.ts']
        self.current = dict(issue=248,task=task,fingerprint='immutable admission',
            comment={'id':1,'fingerprint':'comment bytes'},approved_since='fixed',
            head=self.original,base=self.base,phase='qa',attempt=1,qa=None,ci=None)
        self.store = Store(self.current)
        config = SimpleNamespace(repo=self.repo,state_dir=self.state,worktrees_root=self.root)
        self.bridge = A.Bridge(config,self.store); self.bridge.work=self.repo
        self.result = dict(verdict='PASS',findings=[],reviewed_sha=self.original)
        self.bridge.model = Mock(return_value=self.result)
        # Real bridge creates a detached QA snapshot in this temporary Git repo;
        # the model boundary is a deterministic stub, never an actual model call.
        self.bridge.review(self.current)
        self.bridge.model.reset_mock()
        self.filename = qa.name(self.current)
        self.receipt = (self.state/self.filename).read_bytes()
    def candidate(self, head):
        self.current.update(head=head,phase='pr_wait',integration=1,qa=None,qa_origin=self.filename,
                            qa_equivalence=None,ci=None)
    def reuse(self):
        return self.bridge.try_reuse_qa(self.current)
    def test_real_rebase_identical_content_and_stage_skips_runtime_model(self):
        self.git('checkout','-qb','new-base',self.base)
        self.write('docs/handoffs/rebase.md','harmless handoff\n'); dev=self.commit('docs base')
        self.git('checkout','automation/issue-248')
        self.git('rebase',dev)
        head=self.git('rev-parse','HEAD'); self.assertNotEqual(head,self.original)
        self.candidate(head); self.current['base']=dev
        self.bridge.unchanged_issue=Mock();self.bridge.candidate_identity=Mock()
        api=SimpleNamespace(pages=lambda *_:[dict(number=248,head=dict(sha=head,repo={'id':core.REPO_ID}),
            base=dict(repo={'id':core.REPO_ID},ref='dev'))])
        rt=SimpleNamespace(lease=Mock(),publish=Mock(),budget=Mock())
        request=dict(stage='qa',issue=248,phase='pr_wait',head=head,attempt=1,slot='slot1',profile='auto')
        with patch.object(stage,'run_result',return_value={'sha':head,'id':123}), \
             patch.object(stage,'route',side_effect=AssertionError('no full runtime model route')):
            result=stage.perform(request,{},(A,S,rt,api,self.store,self.bridge))
        self.assertTrue(result['runtime_review_reused']);self.bridge.model.assert_not_called()
        self.assertEqual(self.current['qa'],self.result)
        self.assertEqual(self.current['qa']['reviewed_sha'],self.original)
        self.bridge.saved_qa(self.current)
        self.assertEqual((self.state/self.filename).read_bytes(),self.receipt)
    def test_real_merge_finish_retains_original_receipt_and_requires_new_ci(self):
        self.git('checkout','-qb','dev',self.base)
        self.write('docs/handoffs/merge.md','handoff\n'); dev=self.commit('dev handoff')
        self.git('checkout','automation/issue-248');self.git('merge','--no-ff','--no-edit',dev)
        with patch.object(A,'continuity',return_value=False):
            self.bridge.finish_integration(self.current,dev)
        self.assertEqual(self.current['qa_origin'],self.filename)
        self.assertIsNone(self.current['ci']); self.assertIsNone(self.current['qa'])
        self.assertTrue(self.reuse());self.bridge.saved_qa(self.current)
        self.bridge.model.assert_not_called()
    def test_exact_saved_pass_never_calls_model_twice(self):
        self.assertTrue(self.reuse()); self.bridge.model.assert_not_called()
        self.assertEqual((self.state/self.filename).read_bytes(),self.receipt)
    def test_actual_author_test_repair_keeps_origin_without_resetting_attempts(self):
        original_run=A.run
        def local_run(argv,*args,**kwargs):
            # This fixture has no application foundation; all real Git calls
            # still execute, and the deterministic foundation boundary is stubbed.
            if argv[0]=='python3':return ''
            return original_run(argv,*args,**kwargs)
        self.bridge.unchanged_issue=Mock()
        self.bridge.model.side_effect=lambda *args,**kwargs:self.write(
            'apps/web/test/example.test.ts','expect(2).toBe(2);\n')
        with patch.object(A,'run',side_effect=local_run):self.bridge.author(self.current)
        self.assertEqual(self.current['qa_origin'],self.filename)
        self.assertEqual(self.current['attempt'],2);self.assertIsNone(self.current['qa'])
        self.bridge.model.side_effect=None
        self.bridge.model.return_value=dict(verdict='PASS',findings=[],reviewed_sha=self.current['head'])
        self.assertTrue(self.reuse());self.bridge.saved_qa(self.current)
        self.assertEqual(self.current['qa']['reviewed_sha'],self.original)
        self.assertEqual((self.state/self.filename).read_bytes(),self.receipt)
    def test_test_only_delta_is_separate_and_preserves_requirements(self):
        self.write('scripts/chatops/tests/test_example.py','assert 2 == 2\n'); head=self.commit('test delta')
        self.candidate(head)
        self.bridge.model.return_value=dict(verdict='PASS',findings=[],reviewed_sha=head)
        self.assertTrue(self.reuse());self.bridge.saved_qa(self.current)
        self.assertEqual(self.current['qa'],self.result)
        self.assertIn('TEST DELTA QA',self.bridge.model.call_args.args[0])
        self.assertIn(TASK['acceptance'],self.bridge.model.call_args.args[0])
        self.assertIn('removed/weakened assertions',self.bridge.model.call_args.args[0])
        self.assertEqual((self.state/self.filename).read_bytes(),self.receipt)
    def test_test_delta_failure_cannot_be_erased_by_runtime_pass(self):
        self.write('scripts/chatops/tests/test_example.py','pass\n'); head=self.commit('weaken tests')
        self.candidate(head)
        delta=dict(verdict='FAIL',findings=['deleted assertion; acceptance untested'],reviewed_sha=head)
        self.bridge.model.return_value=delta
        self.assertTrue(self.reuse());self.assertEqual(self.current['qa'],delta)
        with self.assertRaises((A.Hold,FileNotFoundError)):self.bridge.saved_qa(self.current)
        self.assertEqual((self.state/self.filename).read_bytes(),self.receipt)
    def test_runtime_policy_dependency_modes_symlinks_deletion_rejected(self):
        changes=[('apps/runtime.py','value = 3\n'),('package-lock.json','{}'),
            ('docs/rules/RULES.md','changed policy'),('docs/architecture/OVERVIEW.md','new'),
            ('docs/handoffs/SECURITY.md','new security policy'),('AGENTS.md','new authority'),
            ('contracts/schema.json','{}'),('docs/README.md','unclassified docs')]
        for path,raw in changes:
            with self.subTest(path=path):
                self.git('reset','--hard',self.original); self.write(path,raw);head=self.commit(path)
                self.candidate(head);self.assertFalse(self.reuse())
        for mode in ('executable','symlink','removed'):
            with self.subTest(mode=mode):
                self.git('reset','--hard',self.original)
                p=self.repo/'scripts/chatops/tests/test_example.py'
                if mode=='executable':p.chmod(0o755)
                elif mode=='removed':p.unlink()
                else:p.unlink();p.symlink_to('../../apps/runtime.py')
                self.candidate(self.commit(mode));self.assertFalse(self.reuse())
        self.bridge.model.assert_not_called()
    def test_runtime_change_falls_back_to_real_bridge_addressed_QA(self):
        self.write('apps/runtime.py','value = 3\n');head=self.commit('runtime delta')
        self.candidate(head)
        self.bridge.unchanged_issue=Mock();self.bridge.candidate_identity=Mock()
        self.bridge.model.return_value=dict(verdict='PASS',findings=[],reviewed_sha=head)
        api=SimpleNamespace(pages=lambda *_:[dict(number=248,head=dict(sha=head,repo={'id':core.REPO_ID}),
            base=dict(repo={'id':core.REPO_ID},ref='dev'))])
        rt=SimpleNamespace(lease=Mock(),publish=Mock(),budget=Mock())
        request=dict(stage='qa',issue=248,phase='pr_wait',head=head,attempt=1,slot='slot1',profile='auto')
        with patch.object(stage,'run_result',return_value={'sha':head}), \
             patch.object(stage,'route',return_value={'provider':'codex'}):
            stage.perform(request,{},(A,S,rt,api,self.store,self.bridge))
        self.bridge.model.assert_called_once()
        self.assertIn('Independent QA in a NEW session',self.bridge.model.call_args.args[0])
        self.assertEqual(self.current['qa']['reviewed_sha'],head)
        self.bridge.saved_qa(self.current)
        self.assertEqual((self.state/self.filename).read_bytes(),self.receipt)
    def test_test_delta_does_not_run_before_applicable_new_SHA_CI(self):
        self.write('scripts/chatops/tests/test_example.py','assert 2 == 2\n');head=self.commit('test delta')
        self.candidate(head);self.bridge.unchanged_issue=Mock();self.bridge.candidate_identity=Mock()
        api=SimpleNamespace(pages=lambda *_:[dict(number=248,head=dict(sha=head,repo={'id':core.REPO_ID}),
            base=dict(repo={'id':core.REPO_ID},ref='dev'))])
        request=dict(stage='qa',issue=248,phase='pr_wait',head=head,attempt=1,slot='slot1',profile='auto')
        with patch.object(stage,'run_result',side_effect=core.Retry('CI pending')),self.assertRaises(core.Retry):
            stage.perform(request,{},(A,S,SimpleNamespace(lease=Mock()),api,self.store,self.bridge))
        self.bridge.model.assert_not_called();self.assertIsNone(self.current['qa'])
    def test_changed_task_acceptance_inputs_and_forged_receipt_rejected(self):
        self.write('docs/handoffs/ok.md','handoff');self.candidate(self.commit())
        for field,value in [('acceptance','different acceptance'),('goal','different goal'),
                            ('allowed_paths',['**']),('depends_on',[77])]:
            old=copy.deepcopy(self.current['task']);self.current['task'][field]=value
            self.assertFalse(self.reuse());self.current['task']=old
        self.current['fingerprint']='changed admission';self.assertFalse(self.reuse())
        self.current['fingerprint']='immutable admission'
        p=self.state/self.filename;p.write_text(json.dumps(dict(self.result,reviewed_sha=self.current['head'])))
        self.assertFalse(self.reuse())
    def test_forged_stale_proof_and_missing_git_objects_rejected(self):
        self.write('docs/handoffs/ok.md','handoff');head=self.commit();self.candidate(head)
        self.assertTrue(self.reuse()); proofpath=self.state/self.current['qa_equivalence']
        good=proofpath.read_bytes();proof=json.loads(good)
        proof['projection']['candidate']=self.original;proofpath.write_text(json.dumps(proof))
        with self.assertRaises(core.Refused):self.bridge.saved_qa(self.current)
        self.assertFalse(self.reuse())  # Addressed QA is available; no global disable.
        proofpath.write_bytes(good)
        self.current['head']=self.base
        with self.assertRaises(core.Refused):self.bridge.saved_qa(self.current)
        self.current['head']=head
        oid=self.git('rev-parse',self.original+':apps/runtime.py')
        (self.repo/'.git/objects'/oid[:2]/oid[2:]).unlink()
        with self.assertRaises(core.Refused):self.bridge.saved_qa(self.current)
        self.current['qa']=None;self.assertFalse(self.reuse())


    def test_changed_base_dependencies_never_reuse_identical_candidate(self):
        self.write('pnpm-lock.yaml','new base dependency')
        different_base=self.commit('dependency on base')
        (self.repo/'pnpm-lock.yaml').unlink()
        head=self.commit('restore old candidate contents')
        self.candidate(head);self.current['base']=different_base
        self.assertTrue(identity.equivalence(self.repo,self.original,head)['reusable'])
        self.assertFalse(self.reuse())
        self.assertEqual((self.state/self.filename).read_bytes(),self.receipt)

    def test_dependency_uncertainty_gets_real_addressed_review_not_invented_reuse(self):
        self.write('apps/runtime.py','import importlib\nvalue=importlib.import_module("plugin").value\n')
        runtime=self.commit('dynamic runtime dependency')
        self.current.update(head=runtime,phase='pr_wait',integration=1,qa=None,qa_origin=None,qa_equivalence=None)
        original=dict(verdict='PASS',findings=[],reviewed_sha=runtime)
        self.bridge.model=Mock(return_value=original);self.bridge.review(self.current)
        origin_name=qa.name(self.current);origin_bytes=(self.state/origin_name).read_bytes()
        self.write('scripts/chatops/tests/test_example.py','assert 1 != 2\n');candidate=self.commit('only test delta')
        self.current.update(head=candidate,phase='pr_wait',integration=2,qa=None,qa_origin=origin_name,qa_equivalence=None)
        self.bridge.model=Mock(return_value=dict(verdict='PASS',findings=[],reviewed_sha=candidate))
        self.assertFalse(self.bridge.try_reuse_qa(self.current))
        self.assertTrue(self.bridge.review(self.current))
        prompt=self.bridge.model.call_args.args[0]
        self.assertIn('ADDRESSED FOLLOW-UP REVIEW',prompt)
        self.assertIn('runtime consumers/imports/build dependencies',prompt)
        self.assertIn(runtime,prompt);self.assertIn(candidate,prompt)
        self.assertEqual(self.current['qa']['reviewed_sha'],candidate)
        self.assertIsNone(self.current.get('qa_equivalence'))
        self.assertEqual((self.state/origin_name).read_bytes(),origin_bytes)
        self.bridge.saved_qa(self.current)


class ReleaseTests(GitFixture):
    def setUp(self):
        super().setUp()
        manifest=json.loads((ROOT/release.MANIFEST).read_bytes())
        for path in list(manifest['files'])+[release.MANIFEST,*release.WORKFLOWS]:
            self.write(path,(ROOT/path).read_bytes())
        self.implementation=self.commit('implementation')
    def publish(self, **kwargs):
        return release.prepare(self.repo,self.implementation,self.implementation,
                               'refs/heads/train-release-248',**kwargs)
    def test_prepare_and_CAS_idempotence_exactly_four_refs_no_source_mutation(self):
        before=self.git('status','--porcelain');index=(self.repo/'.git/index').read_bytes()
        source={p:(self.repo/p).read_bytes() for p in release.WORKFLOWS}
        preview=release.prepare(self.repo,self.implementation,self.implementation)
        self.assertFalse(preview['published']);self.assertEqual(preview['ref_count'],4)
        first=self.publish();second=self.publish()
        self.assertEqual(first['release'],second['release']);self.assertTrue(second['idempotent'])
        self.assertEqual(self.git('rev-parse','HEAD'),self.implementation)
        self.assertEqual(self.git('status','--porcelain'),before)
        self.assertEqual((self.repo/'.git/index').read_bytes(),index)
        self.assertEqual(source,{p:(self.repo/p).read_bytes() for p in release.WORKFLOWS})
        checked=release.check(self.repo,first['release'],True)
        self.assertTrue(checked['runtime_identity_reusable'])
        self.assertEqual(self.git('show','-s','--format=%P',first['release']),self.implementation)
        self.assertEqual(set(self.git('diff','--name-only',self.implementation,first['release']).splitlines()),set(release.WORKFLOWS))
        for p in release.WORKFLOWS:
            self.assertEqual(release.refs(release.blob(self.repo,first['release'],p)),[self.implementation]*2)
        with self.assertRaises(core.Refused):self.publish(expected_ref='1'*40)
    def test_CAS_race_refuses_and_does_not_publish_branch(self):
        original=release.git; raced=False
        def racing(repo,*args,**kwargs):
            nonlocal raced
            if args[0]=='update-ref' and not raced:
                raced=True
                self.write('docs/handoffs/race.md','race');self.commit('concurrent source commit')
            return original(repo,*args,**kwargs)
        with patch.object(release,'git',side_effect=racing),self.assertRaises(core.Refused):self.publish()
        self.assertEqual(self.git('for-each-ref','--format=%(objectname)','refs/heads/train-release-248'),'')
    def test_dirty_or_wrong_expected_head_rejected(self):
        self.write('dirty','source')
        with self.assertRaises(core.Refused):self.publish()
        with self.assertRaises(core.Refused):release.prepare(self.repo,self.implementation,'0'*40)
    def test_release_doc_test_descendants_and_runtime_restore_classification(self):
        r=self.publish()['release'];self.git('checkout','-q','train-release-248')
        self.write('docs/handoffs/later.md','handoff');doc=self.commit('doc')
        self.assertTrue(release.check(self.repo,doc,True)['runtime_identity_reusable'])
        self.write('scripts/chatops/tests/test_delta.py','assert True');tests=self.commit('tests')
        self.assertTrue(release.check(self.repo,tests,True)['runtime_identity_reusable'])
        self.write('pnpm-lock.yaml','changed dependency');bad=self.commit('dependency')
        with self.assertRaises(core.Refused):release.check(self.repo,bad,True)
        (self.repo/'pnpm-lock.yaml').unlink();restored=self.commit('restore')
        self.assertTrue(release.check(self.repo,restored,True)['runtime_identity_reusable'])
    def test_payload_manifest_and_wrong_release_parent_mode_bytes_rejected(self):
        r=self.publish()['release'];self.git('checkout','-q','train-release-248')
        (self.repo/release.WORKFLOWS[0]).chmod(0o755);bad=self.commit('mode')
        with self.assertRaises(core.Refused):release.release(self.repo,self.implementation,bad)
        self.git('checkout','-q','automation/issue-248')
        self.write('scripts/chatops/actions_train/not_in_manifest.py','unknown payload')
        bad=self.commit('missing manifest entry')
        with self.assertRaises(core.Refused):release.prepare(self.repo,bad,bad)
    def test_direct_child_extra_bytes_mode_and_split_refs_are_rejected(self):
        preview=release.prepare(self.repo,self.implementation,self.implementation)
        for kind in ('extra','mode','workflow-byte','split-ref'):
            with self.subTest(kind=kind):
                self.git('reset','--hard',self.implementation)
                for path,value in preview['files'].items():self.write(path,value['content'])
                p=self.repo/release.WORKFLOWS[0]
                if kind=='extra':self.write('extra','mutation')
                elif kind=='mode':p.chmod(0o755)
                elif kind=='workflow-byte':p.write_text(p.read_text()+'# changed\n')
                else:p.write_text(p.read_text().replace(self.implementation,'1'*40,1))
                bad=self.commit('forged release')
                with self.assertRaises(core.Refused):release.release(self.repo,self.implementation,bad)
                if kind=='extra':(self.repo/'extra').unlink(missing_ok=True)


    def test_detached_implementation_release_is_supported(self):
        self.git('checkout','--detach','-q',self.implementation)
        result=self.publish()
        self.assertTrue(release.check(self.repo,result['release'],True)['runtime_identity_reusable'])
        self.assertEqual(self.git('rev-parse','HEAD'),self.implementation)

class DispatchIsolation(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='dispatch248-');self.addCleanup(self.temp.cleanup)
        self.directory=Path(self.temp.name)
        self.descriptors=[dict(slot=slot,issue=248+i,stage='claim',phase='idle',head=None,attempt=0,generation=0,profile='auto')
                          for i,slot in enumerate(('slot1','slot2'))]
    def dispatch(self,api,descriptors=None):
        with patch.dict(os.environ,GITHUB_RUN_ID='11',GITHUB_RUN_ATTEMPT='1'), \
             patch.object(client,'Path',side_effect=lambda path:self.directory/path):
            return client.dispatch_descriptors(api,self.descriptors if descriptors is None else descriptors)
    def test_local_rejection_or_unknown_does_not_block_other_slot(self):
        for failure,outcome in ((core.SubmissionFailed('HTTP 422'),'rejected'),
                                (core.SubmissionUnknown('HTTP outcome unknown'),'unknown')):
            with self.subTest(failure=type(failure).__name__):
                calls=[]
                def api(path,data):
                    slot=json.loads(data['inputs']['operation'])['slot'];calls.append(slot)
                    if slot=='slot1':raise failure
                result=self.dispatch(api)
                self.assertEqual(calls,['slot1','slot2'])
                self.assertEqual([r['outcome'] for r in result],[outcome,'submitted'])
                self.assertEqual(json.loads((self.directory/'evidence/dispatch-results.json').read_text()),result)
    def test_duplicate_descriptor_is_submitted_once_per_pass(self):
        api=Mock();self.dispatch(api,[self.descriptors[0],self.descriptors[0],self.descriptors[1]])
        self.assertEqual(api.call_count,2)
    def test_global_auth_rate_or_integrity_failure_is_not_ignored(self):
        for failure in (core.Refused('global identity failure'),core.Retry('GitHub rate/permission response 429',60)):
            api=Mock(side_effect=failure)
            with self.subTest(failure=str(failure)),self.assertRaises(type(failure)):self.dispatch(api)
            self.assertEqual(api.call_count,1)
    def test_full_batch_schema_is_checked_before_any_submission(self):
        wrong=dict(self.descriptors[1],extra='not admitted');api=Mock()
        with self.assertRaises(core.Refused):self.dispatch(api,[self.descriptors[0],wrong])
        api.assert_not_called()
    def test_unknown_slot_and_overlap_keep_existing_reservations(self):
        snap=dict(slots={'slot1':card(),'slot2':card()})
        old=copy.deepcopy(TASK);old.update(allowed_paths=['apps/a.py'],locks=['api:a'])
        snap['slots']['slot1'].update(active=dict(issue=248,task=old,phase='developing',head='a'*40,attempt=1),
            pending=dict(status='unknown',recoverable=False,binding=dict(self.descriptors[0],stage='author')),
            reservation=S.task_record(248,old))
        other=copy.deepcopy(TASK);other.update(allowed_paths=['apps/b.py'],locks=['api:b'])
        out=core.plan(A,S,snap,[(249,old),(250,other)])
        self.assertEqual([(r['slot'],r['issue']) for r in out],[('slot2',250)])
        self.assertEqual(snap['slots']['slot1']['pending']['status'],'unknown')
    def test_completed_task_is_never_planned_again(self):
        snap=dict(slots={'slot1':card(),'slot2':card()});snap['slots']['slot1']['done']=[248]
        out=core.plan(A,S,snap,[(248,TASK),(249,TASK)])
        self.assertNotIn(248,[r['issue'] for r in out])
    def test_real_HTTP_refusal_then_other_slot_accepted(self):
        import http.server,threading,urllib.request
        seen=[]
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                slot=json.loads(data['inputs']['operation'])['slot'];seen.append(slot)
                self.send_response(422 if slot=='slot1' else 204);self.end_headers()
            def log_message(self,*args):pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def opener(req,timeout):
            local=urllib.request.Request('http://127.0.0.1:'+str(server.server_port)+'/',
                data=req.data,method=req.get_method(),headers={'Content-Type':'application/json'})
            return urllib.request.urlopen(local,timeout=timeout)
        try:
            result=self.dispatch(core.API('synthetic-test-only-token',opener=opener))
            self.assertEqual(seen,['slot1','slot2'])
            self.assertEqual([r['outcome'] for r in result],['rejected','submitted'])
        finally:server.shutdown();server.server_close();thread.join(timeout=2)

if __name__=='__main__':unittest.main()

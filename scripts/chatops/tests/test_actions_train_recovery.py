"""Offline stdlib failure/authority/crash simulations. Never calls network/models/services."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import urllib.error

from test_actions_train import core, receiver, stage, installer, ROOT, HEAD, BASE, TASK, active, req, card, A, S, issue, STAMP
import recovery as R
import recovery_upgrade as U


def terminal(number=177):
    a = active('qa', number)
    a.update(attempt=3, qa=dict(verdict='FAIL', findings=['Candidate changed only handoff; source fixture defect remains'], reviewed_sha=HEAD),
             history=[dict(attempt=n, head=str(n)*40, base=BASE,
                           qa=dict(verdict='FAIL', findings=['source defect'], reviewed_sha=str(n)*40)) for n in (1, 2)])
    return dict(issue=number, reason='attempts exhausted', snapshot=a)


def config(entry=None):
    return dict(mode='active', owned={'slot1': 'enrolled', 'slot2': 'enrolled'}, controller_sha=HEAD,
        recovery=dict(schema=R.SCHEMA, enabled=True, deployment='reviewed-185-test', source_sha=HEAD, base_sha=BASE,
             delegation_issue=185, enrolled={'177': core.digest(entry or terminal())}, future_deferrals=True,
             excluded=[149, 170, 156], lineages={'177': [149, 177], '178': [170, 178]}, active_successors=R.MANUAL.copy()))


def diagnosis():
    return dict(kind='source_defect', requirements=['Repair the diagnosed fixture within sample.ts and preserve exact source assertions'],
         paths=TASK['allowed_paths'], citations=['qa:findings:0'], reason='Exact frozen QA reports missing source fixture repair')


class Receipts(unittest.TestCase):
    def setUp(self):
        self.entry=terminal(); self.c=config(self.entry); self.j=R.empty()
        self.key=R.enroll(self.j,self.entry,'slot1',self.c)
    def request(self,name='diagnose'):
        return req(name,'qa') | dict(issue=177, attempt=3)
    def diagnose(self):
        R.reserve(self.j,self.request(),self.c)
        return R.finish(self.j,self.key,'diagnose',dict(status='confirmed',outcome=diagnosis(),evidence=[]),self.c)
    def review(self, verdict='PASS'):
        r=self.diagnose()
        R.reserve(self.j,self.request('task_review'),self.c)
        outcome=dict(verdict=verdict,findings=[] if verdict=='PASS' else ['scope uncertain'],
             receipt_hash=core.digest(r['frozen']), proposed_task_hash=core.digest(r['proposal']),
             evidence_hash=core.digest(r['diagnosis']['evidence']), diagnosis_hash=core.digest(r['diagnosis']['result']))
        return R.finish(self.j,self.key,'task_review',dict(status='confirmed',outcome=outcome),self.c)
    def test_terminal_three_history_and_qa_frozen_byte_equivalent(self):
        before=copy.deepcopy(self.entry)
        r=self.review()
        self.assertEqual(r['frozen']['snapshot'],before['snapshot'])
        self.assertEqual(self.entry,before)
        self.assertEqual(r['frozen']['lineage'],[149,177])
        self.assertEqual(r['proposal']['max_attempts'],2)
        self.assertEqual(r['proposal']['acceptance'],TASK['acceptance'])
        for name in set(TASK)-{'goal','max_attempts','allowed_paths'}:
            self.assertEqual(r['proposal'][name],TASK[name])
        self.assertTrue(r['proposal']['goal'].startswith(TASK['goal']+'\n'))
        self.assertEqual(r['counts'],dict(diagnose=1,task_review=1,successor=1))
        self.assertEqual(r['status'],'publish_ready')
        self.assertIn('hosted publication pending',r['reason'])
        self.assertNotIn('done',r['status'])
    def test_manual_superseded_accepted_and_unenrolled_parents_ignored(self):
        for n in (149,170,156,999):
            e=terminal(n); c=config(e)
            if n != 999:c['recovery']['enrolled'][str(n)]=core.digest(e)
            j=R.empty()
            self.assertIsNone(R.enroll(j,e,'slot1',c))
            self.assertFalse(j['receipts'])
        j=R.empty();self.assertIsNone(R.enroll(j,self.entry,'slot1',self.c,done=[177]))
    def test_different_roots_tracked_independently_same_root_never_respent(self):
        e=terminal(178);second=R.enroll(self.j,e,'slot2',self.c,future=True)
        self.assertNotEqual(self.key,second)
        e2=copy.deepcopy(self.entry);e2['snapshot']['head']='f'*40;e2['snapshot']['qa']['reviewed_sha']='f'*40
        third=R.enroll(self.j,e2,'slot1',self.c,future=True)
        self.assertEqual(self.j['receipts'][third]['status'],'needs-owner')
        self.assertEqual(len(self.j['roots']),2)
        self.assertEqual(R.enroll(self.j,self.entry,'slot1',self.c),self.key)
        self.assertEqual(len(self.j['receipts']),3)
    def test_one_diagnosis_review_even_across_serialization_and_duplicates(self):
        for name in ('diagnose','task_review'):
            if name=='task_review':
                R.finish(self.j,self.key,'diagnose',dict(status='confirmed',outcome=diagnosis(),evidence=[]),self.c)
            R.reserve(self.j,self.request(name),self.c)
            self.j=core.loads(json.dumps(self.j))
            with self.assertRaises(core.Refused):R.reserve(self.j,self.request(name),self.c)
        r=R.finish(self.j,self.key,'task_review',dict(status='unknown',reason='lost CLI result; no replay'),self.c)
        self.assertEqual(r['status'],'needs-owner')
        with self.assertRaises(core.Refused):R.reserve(self.j,self.request('task_review'),self.c)
    def test_missing_qa_history_head_or_nonterminal_never_enrolled_for_models(self):
        for mutate in (lambda a:a.update(qa=None),lambda a:a.update(attempt=2),lambda a:a.update(head='main'),
                       lambda a:a.update(history=[]),lambda a:a['qa'].update(reviewed_sha=BASE),
                       lambda a:a['task'].update(max_attempts=4),lambda a:a['qa'].update(verdict='UNKNOWN')):
            e=terminal();mutate(e['snapshot']);c=config(e);j=R.empty()
            self.assertIsNone(R.enroll(j,e,'slot1',c))
            self.assertEqual(next(iter(j['blocked'].values()))['status'],'needs-owner')
    def test_scope_expansion_and_environmental_not_tested_not_a_source_fix(self):
        for change in ({'paths':['apps/api/src/new.ts']},{'paths':['scripts/chatops/core.py']},
                       {'kind':'environment'},{'requirements':[]},{'citations':['ci:999']}):
            r=copy.deepcopy(self.j);R.reserve(r,self.request(),self.c)
            result=R.finish(r,self.key,'diagnose',dict(status='confirmed',outcome=diagnosis()|change,evidence=[]),self.c)
            self.assertEqual(result['status'],'needs-owner');self.assertIsNone(result['proposal'])
    def test_owner_allowed_product_docs_accompany_real_source_repair_only(self):
        parent = copy.deepcopy(TASK)
        doc_api = 'docs/api/PRODUCT_V001.md'
        doc_handoff = 'docs/handoffs/product-repair.md'
        source = 'apps/api/src/sample.ts'
        parent['allowed_paths'] = [source, doc_api, doc_handoff]
        proposal = diagnosis() | {'paths': [source, doc_api, doc_handoff]}
        result = R.revised(parent, proposal)
        self.assertEqual(result['max_attempts'], 2)
        self.assertEqual(result['allowed_paths'], parent['allowed_paths'])
        self.assertEqual(result['acceptance'], parent['acceptance'])
        self.assertEqual(result['kind'], parent['kind'])
        self.assertEqual(result.get('depends_on'), parent.get('depends_on'))
        self.assertTrue(result['goal'].startswith(parent['goal']))
        self.assertIn('Bounded diagnosed repair requirements', result['goal'])
        for invalid in ([doc_api], [doc_handoff], [doc_api, doc_handoff]):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(core.Refused, 'no product source/test'):
                R.revised(parent, proposal | {'paths': invalid})

    def test_original_task_allowlist_never_authorizes_control_or_traversal(self):
        source = 'apps/api/src/sample.ts'
        for path in ('docs/operations/CHEATSHEET.md','docs/governance/POLICY.md',
                     'scripts/chatops/actions_train/core.py','.github/workflows/train-stage.yml',
                     'packages/tooling/exec.ts','docs/api/../../scripts/hijack.py'):
            with self.subTest(path=path):
                parent = copy.deepcopy(TASK)
                parent['allowed_paths'] = [source, path]
                with self.assertRaises(core.Refused):
                    R.revised(parent, diagnosis() | {'paths': [source, path]})
        # No broad docs/ prefix: only existing product API/handoff documents.
        parent = copy.deepcopy(TASK)
        parent['allowed_paths'] = [source, 'docs/random.md']
        with self.assertRaisesRegex(core.Refused, 'recovery control path forbidden'):
            R.revised(parent, diagnosis() | {'paths': parent['allowed_paths']})

    def test_policy_and_generation_effect_gates(self):
        for mutate in (lambda c:c.update(controller_sha=BASE),lambda c:c.update(mode='disabled'),
                       lambda c:c['recovery'].update(delegation_issue=186),lambda c:c['recovery'].update(excluded=[]),
                       lambda c:c['recovery']['active_successors'].update({'149':888})):
            c=copy.deepcopy(self.c);mutate(c)
            with self.assertRaises(core.Refused):R.reserve(self.j,self.request(),c)
        R.reserve(self.j,self.request(),self.c)
        c=copy.deepcopy(self.c);c['mode']='disabled'
        r=R.finish(self.j,self.key,'diagnose',dict(status='confirmed',outcome=diagnosis(),evidence=[]),c)
        self.assertEqual(r['status'],'needs-owner')
    def test_failed_independent_review_never_publishes(self):
        self.assertEqual(self.review('FAIL')['status'],'needs-owner')
    def test_no_metadata_can_mint_publication_or_admission_authority(self):
        for metadata in ({'user':{'id':41898282}}, {'user':{'id':core.OWNER}},
                         {'approved':True,'reviewed':True,'issue':185}, {'status':'ambiguous','successor':999}):
            for _ in range(2):
                with self.assertRaisesRegex(core.Refused,'bot comment is not Owner approval'):R.publication(metadata)
        bot=issue(999);bot['user']={'id':41898282}
        comment=dict(id=1,issue_url=f'https://api.github.com/repos/{core.REPO}/issues/999',user={'id':41898282},
                     body=bot['body'],created_at=STAMP,updated_at=STAMP)
        self.assertEqual(S.admitted(A,[bot],[comment],__import__('datetime').datetime.fromisoformat(STAMP)),[])
    def test_review_hash_mismatch_refused(self):
        r=self.diagnose();R.reserve(self.j,self.request('task_review'),self.c)
        value=dict(verdict='PASS',findings=[],receipt_hash=core.digest(r['frozen']),proposed_task_hash='f'*64,
                   evidence_hash=core.digest([]),diagnosis_hash=core.digest(diagnosis()))
        result=R.finish(self.j,self.key,'task_review',dict(status='confirmed',outcome=value),self.c)
        self.assertEqual(result['status'],'needs-owner')
    def test_recovery_waits_for_qa_budget_and_conflicting_paths_without_spending_reservation(self):
        snap=dict(slots={'slot1':card(), 'slot2':card(owned=False)},recovery=self.j)
        snap['slots']['slot1']['availability']={'codex':{'qa':False}}
        self.assertEqual(R.descriptors(snap,[]),[])
        snap['slots']['slot1']['availability']['codex']['qa']=True
        snap['slots']['slot2']['active']=active('claimed',300)
        self.assertEqual(R.descriptors(snap,[]),[])
        snap['slots']['slot2']['active']=None
        self.assertEqual(R.descriptors(snap,[])[0]['stage'],'diagnose')
        self.assertEqual(self.j['receipts'][self.key]['counts']['diagnose'],0)
    def test_normal_tasks_continue_while_recovery_waiting_or_ready(self):
        snap=dict(slots={'slot1':card(), 'slot2':card(owned=False)},recovery=self.j)
        normal=core.plan(A,S,snap,[(300,TASK)])
        self.assertEqual(normal[0]['issue'],300)
        self.assertEqual(R.descriptors(snap,normal),[])
        self.assertEqual(R.descriptors(snap,[])[0]['issue'],177)
        self.review()
        self.assertEqual(R.descriptors(snap,[]),[])
        self.assertEqual(core.plan(A,S,snap,[(300,TASK)])[0]['issue'],300)


class ExactCI(unittest.TestCase):
    def setUp(self):
        self.f=R.frozen(terminal(),'slot1',config())
        self.run=dict(id=901,run_attempt=2,head_sha=HEAD,repository={'id':core.REPO_ID},head_repository={'id':core.REPO_ID},
             path='.github/workflows/ci.yml',event='push',head_branch='automation/issue-177',status='completed',conclusion='failure')
        self.job=dict(id=902,run_id=901,run_attempt=2,head_sha=HEAD,status='completed',conclusion='failure',name='source (web)',
             html_url=f'https://github.com/{core.REPO}/actions/runs/901/job/902',check_run_url=f'https://api.github.com/repos/{core.REPO}/check-runs/903')
        self.check=dict(id=903,head_sha=HEAD,details_url=self.job['html_url'],output={'annotations_count':1})
        self.annotation=dict(path='apps/web/src/sample.ts',start_line=21,end_line=21,annotation_level='failure',
                             message='Process completed with exit code 1',raw_details='')
        self.log='setup\n2026 Error: AssertionError: expected fixture to preserve selected row\nExpected: 2\nReceived: 0\n'
        self.api=Mock(side_effect=lambda path:self.run if path.startswith('actions/') else self.check)
        self.api.pages.side_effect=lambda path,key=None: [self.run] if '/runs?' in path else [self.job] if path.endswith('/jobs') else [self.annotation]
        self.api.job_log.return_value=self.log
    def test_exact_assertion_annotations_log_with_line_numbers_not_only_labels(self):
        evidence=R.ci_evidence(self.api,self.f)
        self.assertEqual(evidence[0]['run_attempt'],2)
        self.assertIn('Expected: 2',evidence[0]['log']['excerpt'])
        self.assertIn('3:',evidence[0]['log']['excerpt'])
        self.assertEqual(evidence[0]['log']['sha256'],hashlib.sha256(self.log.encode()).hexdigest())
    def test_external_head_fork_job_attempt_and_missing_evidence_refused(self):
        for target,change in ((self.run,{'head_repository':{'id':1}}),(self.job,{'run_attempt':1}),
                             (self.check,{'head_sha':BASE}),(self.job,{'check_run_url':'https://evil/check-runs/903'}),
                             (self.check,{'output':{'annotations_count':1000}})):
            before=copy.deepcopy(target);target.update(change)
            with self.assertRaises(core.Refused):R.ci_evidence(self.api,self.f)
            target.clear();target.update(before)
        self.api.job_log.return_value='job failed: source (web) / typecheck'
        with self.assertRaises(core.Refused):R.ci_evidence(self.api,self.f)
    def test_stale_ci_diagnostic_can_only_reference_a_frozen_history_head(self):
        self.f['snapshot']['ci_failure']=dict(run=901,run_attempt=2,head='2'*40)
        self.run['head_sha']=self.job['head_sha']=self.check['head_sha']='2'*40
        self.api.pages.side_effect=lambda path,key=None: [] if '/runs?' in path else [self.job] if path.endswith('/jobs') else [self.annotation]
        self.assertEqual(R.ci_evidence(self.api,self.f)[0]['head'],'2'*40)
        self.f['snapshot']['ci_failure']['head']='f'*40
        with self.assertRaises(core.Refused):R.ci_evidence(self.api,self.f)
    def test_no_github_credential_forwarded_to_signed_log_blob(self):
        class Response(io.BytesIO):pass
        first=Mock();second=Mock(return_value=Response(b'AssertionError: source'))
        first.side_effect=urllib.error.HTTPError('fixed',302,'redirect',
             {'Location':'https://productionresultssa1.blob.core.windows.net/fixed?sig=opaque'},None)
        with patch.object(core.urllib.request,'build_opener',side_effect=[SimpleNamespace(open=first),SimpleNamespace(open=second)]):
            core.API('TEST-TOKEN-12345', opener=Mock()).job_log(902)
        self.assertIn('Authorization',first.call_args.args[0].headers)
        self.assertNotIn('Authorization',second.call_args.args[0].headers)
    def test_untrusted_log_redirect_and_overlarge_logs_refused(self):
        for url in ('http://production.blob.core.windows.net/a','https://evil.test/a','https://blob.core.windows.net.evil.test/a'):
            first=Mock(side_effect=urllib.error.HTTPError('fixed',302,'redirect',{'Location':url},None))
            with patch.object(core.urllib.request,'build_opener',return_value=SimpleNamespace(open=first)):
                with self.assertRaises(core.Refused):core.API('TEST-TOKEN-12345').job_log(902)


class ModelBoundary(unittest.TestCase):
    def test_two_read_only_separate_calls_no_store_save_no_source_git_write(self):
        j=R.empty();c=config();key=R.enroll(j,terminal(),'slot1',c)
        actual=dict(active=None,done=[156]);store=SimpleNamespace(data=copy.deepcopy(actual),save=Mock())
        rt=SimpleNamespace(release_lease=Mock())
        b=SimpleNamespace(c=SimpleNamespace(worktrees_root=Path('/unused-test')),unchanged_issue=Mock(),stopped_writer=Mock(),
                          clean=Mock(),model=Mock(return_value=diagnosis()))
        s=SimpleNamespace(read_json=Mock(return_value=c))
        context=(A,s,rt,Mock(),store,b)
        for name in ('diagnose','task_review'):
            request=req(name,'qa')|dict(issue=177,attempt=3)
            _,data=R.reserve(j,request,c);request['_recovery_data']=data
            if name=='task_review':
                r=j['receipts'][key]
                b.model.return_value=dict(verdict='PASS',findings=[],receipt_hash=core.digest(r['frozen']),
                     proposed_task_hash=core.digest(r['proposal']), evidence_hash=core.digest([]),diagnosis_hash=core.digest(diagnosis()))
            with patch.object(R,'ci_evidence',return_value=[]):result=R.perform(request,c,context)
            R.finish(j,key,name,result,c)
            self.assertEqual(store.data,actual)
        self.assertEqual(b.model.call_count,2)
        self.assertTrue(all(call.kwargs=={'qa':True} for call in b.model.call_args_list))
        self.assertIn('NEW session',b.model.call_args_list[1].args[0])
        store.save.assert_not_called()
        self.assertEqual(rt.release_lease.call_count,2)
    def test_revoked_policy_before_model_and_edited_owner_metadata_refused(self):
        j=R.empty();c=config();key=R.enroll(j,terminal(),'slot1',c);_,data=R.reserve(j,req('diagnose','qa')|dict(issue=177,attempt=3),c)
        store=SimpleNamespace(data=dict(active=None,done=[])); b=SimpleNamespace(c=SimpleNamespace(worktrees_root=Path('/unused')),
             unchanged_issue=Mock(),stopped_writer=Mock(),clean=Mock(),model=Mock())
        context=(A,SimpleNamespace(read_json=lambda *a,**k:c|{'mode':'disabled'}),SimpleNamespace(release_lease=Mock()),Mock(),store,b)
        request=req('diagnose','qa')|{'_recovery_data':data}
        with patch.object(R,'ci_evidence',return_value=[]),self.assertRaises(core.Refused):R.perform(request,c,context)
        b.model.assert_not_called()
        b.unchanged_issue.side_effect=core.Refused('authorization comment changed after claim')
        with self.assertRaisesRegex(core.Refused,'authorization comment changed'):R.perform(request,c,context)
        self.assertIsNone(store.data['active']); b.model.assert_not_called()


class RootSingleFlight(unittest.TestCase):
    def test_duplicate_workflows_restart_and_stale_generation_never_fork_again(self):
        with tempfile.TemporaryDirectory(dir=ROOT,prefix='.train-tests-') as temp:
            folder=Path(temp);c=config();j=R.empty();R.enroll(j,terminal(),'slot1',c)
            receiver.atomic(folder/'recovery.json',j)
            original_read=receiver.read
            def read(path,owner=None,limit=2097152):return original_read(path,None,limit)
            with patch.object(receiver,'STATE',folder),patch.object(receiver,'read',side_effect=read), \
                 patch.object(receiver,'guard'),patch.object(core,'route',return_value={}),patch.object(S,'Budget'),patch.object(receiver,'live',return_value=(A,S)),patch.object(receiver,'checkpoint',return_value=({'active':None,'done':[]},[])), \
                 patch.object(receiver.os,'fork',return_value=999) as fork,patch.object(receiver,'identity',return_value={'pid':999}), \
                 patch.object(receiver,'alive',return_value=True):
                request=req('diagnose','qa')|dict(issue=177,attempt=3)
                self.assertEqual(receiver.recovery_request(request,c)['status'],'running')
                self.assertEqual(receiver.recovery_request(request|{'run':999},c)['status'],'running')
                self.assertEqual(fork.call_count,1)
                with patch.object(receiver,'alive',return_value=False):
                    self.assertEqual(receiver.recovery_request(request,c)['status'],'unknown')
                self.assertEqual(fork.call_count,1)
                saved=receiver.recovery_journal()
                self.assertEqual(next(iter(saved['receipts'].values()))['counts']['diagnose'],1)
                with self.assertRaises(core.Refused):receiver.recovery_request(request|{'generation':1},c)


class Upgrade(unittest.TestCase):
    def exercise(self, crash=False):
        with tempfile.TemporaryDirectory(dir=ROOT,prefix='.train-tests-') as temp:
            d=Path(temp); installed=d/'installed'; installed.mkdir();state=d/'state';state.mkdir()
            autonomy=d/'autonomy';slot=autonomy/'slots/slot1';slot.mkdir(parents=True)
            out=autonomy/'outbox/slot1';out.mkdir(parents=True)
            (out/'ledger.json').write_text('{"subscription_calls":7}')
            (slot/'state.json').write_text('{"active":null,"done":[156]}')
            (slot/'parked.json').write_text('{"parked":[149,170]}')
            (slot/'qa-old.json').write_text('{"verdict":"FAIL"}')
            (slot/'actions-deferred.json').write_text(json.dumps({'entries':[terminal()]}))
            budget=d/'budget.json';budget.write_text('{"providers":{}}')
            policy_path=d/'policy.json';oldpolicy=dict(mode='disabled',controller_sha=BASE,owned={'slot1':'old','slot2':'old'})
            policy_path.write_text(json.dumps(oldpolicy))
            bundle=d/'bundle';source=bundle/'scripts/chatops/actions_train';source.mkdir(parents=True)
            helper=d/'helper';helper.write_text('same helper')
            server=bundle/'scripts/chatops/server';server.mkdir();(server/'gb-deploy-helper.sh').write_text('same helper')
            paths={}
            for name in sorted(U.CHANGES):
                (source/name).write_text('new reviewed '+name)
                if name not in ('recovery.py','recovery_upgrade.py'):(installed/name).write_text('old '+name)
                paths[str((source/name).relative_to(bundle))]=installer.sha(source/name)
            paths['scripts/chatops/server/gb-deploy-helper.sh']=installer.sha(helper)
            manifest=source/'manifest.json';manifest.write_text(json.dumps({'schema':'GB_ACTIONS_TRAIN_INSTALL_V1','files':paths}))
            workflows=bundle/'.github/workflows';workflows.mkdir(parents=True)
            (workflows/'train-stage.yml').write_text('ref: '+HEAD+'\n')
            baseline={str(p):installer.sha(p) for p in installed.iterdir()}|{str(helper):installer.sha(helper)}
            record=dict(manifest='old-manifest',after=baseline,before={p:None for p in baseline},targets=list(baseline))
            (state/'backup.json').write_text(json.dumps(record))
            proof=dict(schema='GB_RECOVERY_UPGRADE_185_V1',reviewed=True,old_manifest='old-manifest',old_controller_sha=BASE,
                 manifest=installer.sha(manifest),controller_sha=HEAD,stage_workflow_sha256=installer.sha(workflows/'train-stage.yml'),
                 recovery=config()['recovery'],enrollment_slot='slot1')
            original_read=receiver.read
            def read(path,owner=None,limit=2097152):return original_read(path,None,limit)
            with patch.multiple(receiver,STATE=state,POLICY=policy_path,AUTONOMY=autonomy), \
                 patch.multiple(installer,INSTALL=installed,HELPER=helper),patch.object(U,'BUDGET',budget), \
                 patch.object(receiver,'read',side_effect=read),patch.object(receiver,'units_quiet'),patch.object(receiver,'no_models'), \
                 patch.object(receiver,'free_lock'),patch.object(receiver,'checkpoint',return_value=({'active':None,'done':[156]},[])), \
                 patch.object(receiver,'journal',return_value={'pending':None}),patch.object(receiver,'trusted_tree'), \
                 patch.object(installer,'trusted_tree'),patch.object(installer.os,'chown'), \
                 patch.object(receiver.pwd,'getpwnam',return_value=SimpleNamespace(pw_uid=1000)):
                before=U.preserved();all_before={str(p):p.read_bytes() for p in d.rglob('*') if p.is_file()}
                dry=U.upgrade('install',bundle,proof['manifest'],proof)
                self.assertTrue(dry['dry']);self.assertFalse((state/'upgrade-185.json').exists())
                self.assertEqual(all_before,{str(p):p.read_bytes() for p in d.rglob('*') if p.is_file()})
                if crash:
                    put=installer.put
                    def failing_put(source,target,mode):
                        if target==installed/'receiver.py':raise OSError('injected interruption')
                        return put(source,target,mode)
                    with patch.object(installer,'put',side_effect=failing_put),self.assertRaises(OSError):
                        U.upgrade('install',bundle,proof['manifest'],proof,True)
                    self.assertEqual(json.loads((state/'upgrade-185.json').read_text())['phase'],'applying')
                else:
                    result=U.upgrade('install',bundle,proof['manifest'],proof,True)
                    self.assertEqual(result['phase'],'installed-disabled')
                    self.assertEqual(json.loads(policy_path.read_text())['mode'],'disabled')
                    cache=json.loads((state/'recovery.json').read_text())
                    self.assertEqual(next(iter(cache['receipts'].values()))['frozen']['issue'],177)
                    receipt_bytes=(state/'recovery.json').read_bytes()
                self.assertEqual(before,U.preserved())
                self.assertTrue(U.upgrade('rollback',None,None,None)['dry'])
                self.assertEqual(U.upgrade('rollback',None,None,None,True)['phase'],'rolled-back-disabled')
                self.assertEqual(before,U.preserved())
                self.assertEqual(baseline,{p:installer.sha(Path(p)) for p in baseline})
                self.assertFalse((installed/'recovery.py').exists())
                self.assertEqual(json.loads(policy_path.read_text()),oldpolicy)
                if not crash:self.assertEqual((state/'recovery.json').read_bytes(),receipt_bytes)
    def test_dry_apply_rollback_preserve_all_history_archives_budgets_receipts(self):self.exercise()
    def test_interrupted_apply_rollback_does_not_restore_task_state(self):self.exercise(crash=True)
    def test_active_job_refused_without_kill_or_service_launch(self):
        with patch.object(receiver,'units_quiet'),patch.object(receiver,'journal',return_value={'pending':'unknown'}), \
             patch.object(receiver.subprocess,'run') as process:
            with self.assertRaisesRegex(core.Refused,'never kill'):U.quiet()
            process.assert_not_called()


if __name__=='__main__':unittest.main()

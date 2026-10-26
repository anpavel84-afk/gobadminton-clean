"""Archived production receipts and marker-only acceptance; synthetic state only."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'actions_train'))
import receiver as R
import owner_package_admission as A
import antigravity_qa_recovery as Q
import native_antigravity as N
import context_policy as P
from core import digest, Refused
from test_actions_train_owner_package import ledger, CONTROLLER, COMMENT


def operation(row, generation=99, run=123):
    g=row['grant'];q=A.exact_qualification(g,g['controller_revision'])
    b=dict(action='train',stage='qa_qualification',issue=29,slot='slot2',profile='agy',head=q['head'],
           phase='idle',attempt=0,generation=generation)
    key=digest(b);row['operation']=key
    native=dict(qualification_grant=g,qualification_task_sha256=q['task_sha256'],
        source_sha=q['head'],base_sha=q['base'],qualification_lineage={'adapter_revision':q['adapter_revision']},
        charged_calls=1,effective_model=N.MODEL,qualification_passed=True,
        input_transport='stream-json',input_delivery='written',requested_permission_mode='always-proceed',
        effective_permission_mode='always-proceed',semantic_input_bytes=10,stdin_bytes=20,
        semantic_input_sha256='1'*64,stdin_sha256='2'*64,review_kind='native_source_qa',
        addressed_role=g['role'],addressed_input_sha256=g['input_sha256'],tool_names=['run_command','view_file'],
        conversation_sha256=hashlib.sha256(str(run).encode()).hexdigest())
    result=dict(status='confirmed',analysis_complete=True,analysis={'completion':'COMPLETE','source_reads':[{},{}]},
        qualification_passed=True,checkpoint_changed=False,qa={'verdict':'PASS','reviewed_sha':q['head']},native_receipt=native)
    return key,dict(binding=b,task_hash=q['task_sha256'],qa_qualification=q,run=run,run_attempt=1,
        before=Q.CHECKPOINT,after=Q.CHECKPOINT,finished_at=1,result=result)


class PackageFinishTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.stack=contextlib.ExitStack();self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(R,'STATE',self.root))
        self.stack.enter_context(patch.object(N,'MARKER',self.root/'marker.json'))
        self.stack.enter_context(patch.object(R,'POLICY',self.root/'policy.json'))
        self.stack.enter_context(patch.object(R,'BUDGET',self.root/'budget.json'))
        # Fixtures belong to the test identity; the real reader's owner/mode/link/size
        # gate is retained. A separate reader test exercises incorrect owners.
        self.reader=R.read
        self.stack.enter_context(patch.object(R,'read',side_effect=lambda p,owner=None,*args:
            self.reader(p,os.getuid() if owner==0 else owner,*args)))
        self.l=ledger();self.roles={r['grant']['role']:r for r in self.l['grants'].values()}
        self.analysis_key,self.analysis=operation(self.roles['technical_pm_product_analyst'],98,122)
        self.l['used_calls']=1
        self.j=dict(generation=99,pending=None,operations={self.analysis_key:self.analysis})

    def archive_analysis(self):
        # Real >96 hot index, canonical sort as the persisted journal supplies it.
        # Find filler hashes sorting AFTER the analysis key so it is evicted first.
        n=int(self.analysis_key,16)
        self.j['operations'].update({format(n+i+1,'064x'):dict(result={'status':'confirmed'}) for i in range(96)})
        self.j=json.loads(json.dumps(self.j,sort_keys=True))
        R.archive_completed('slot2',self.j)
        self.assertEqual(len(self.j['operations']),96)
        self.assertNotIn(self.analysis_key,self.j['operations'])
        self.assertTrue((self.root/'history'/'slot2'/(self.analysis_key+'.json')).is_file())

    def test_real_archive_qa_and_runtime_ready(self):
        self.archive_analysis()
        A.qa_ready(self.j,self.l)
        R.atomic(self.root/'slot2.json',self.j)
        R.atomic(R.POLICY,dict(controller_sha=CONTROLLER))
        R.atomic(self.root/Q.ADDRESSED_RECONCILIATION,dict(phase='complete',third_operation_sha256=Q.THIRD_DIGEST))
        q=A.exact_qualification(self.roles['independent_qa']['grant'],CONTROLLER)
        unknown=dict(evidence='synthetic unchanged unknown')
        self.j['operations'][Q.OWNER_PACKAGE_ORIGINAL_UNKNOWN]=unknown
        R.atomic(self.root/'slot2.json',self.j)
        with patch.object(Q,'addressed_history'),patch.object(Q,'owner_package_read',return_value=self.l), \
             patch.object(Q,'OWNER_PACKAGE_ORIGINAL_UNKNOWN_DIGEST',digest(unknown)), \
             patch.object(N,'trusted',return_value=json.dumps(dict(phase='canary',adapter_revision=CONTROLLER,
                              qualification=q)).encode()):
            self.assertEqual(Q.addressed_ready(R,q),self.l)

    def test_archive_tamper_fails_closed(self):
        self.archive_analysis();path=self.root/'history'/'slot2'/(self.analysis_key+'.json');raw=path.read_bytes()
        A.qa_ready(self.j,self.l)
        for variant in ('symlink','mode','binding','mismatch','oversize','wrongkey','owner','null','historylink','hardlink','grant','json-type','grant-type'):
            with self.subTest(variant=variant):
                path.unlink(missing_ok=True);path.write_bytes(raw);path.chmod(0o600)
                if variant=='symlink':
                    target=self.root/'target';target.write_bytes(raw);path.unlink();path.symlink_to(target)
                if variant=='json-type':
                    self.j['operations'][self.analysis_key]=copy.deepcopy(self.analysis)
                    op=copy.deepcopy(self.analysis);op['finished_at']=True;R.atomic(path,op)
                if variant=='grant-type':
                    op=copy.deepcopy(self.analysis);op['result']['native_receipt']['qualification_grant']['ceiling']=True
                    R.atomic(path,op)
                if variant=='grant':
                    op=copy.deepcopy(self.analysis);op['result']['native_receipt']['qualification_grant']['owner_comment']+=1
                    R.atomic(path,op)
                if variant=='hardlink':os.link(path,self.root/'hardlinked')
                if variant=='null':path.write_text('null')
                if variant=='historylink':
                    folder=path.parent;other=folder.with_name('other');folder.rename(other);folder.symlink_to(other,target_is_directory=True)
                    try:
                        with self.assertRaises(Exception):A.qa_ready(self.j,self.l)
                    finally:folder.unlink();other.rename(folder)
                    continue
                if variant=='mode':path.chmod(0o666)
                if variant=='binding':
                    op=copy.deepcopy(self.analysis);op['binding']['head']='0'*40;R.atomic(path,op)
                if variant=='mismatch':self.j['operations'][self.analysis_key]=dict(foreign=True)
                if variant=='oversize':path.write_bytes(b' '*(2097152+1))
                if variant=='wrongkey':
                    R.atomic(path,dict(self.analysis,task_hash='0'*64))
                if variant=='owner':
                    with patch.object(R,'read',side_effect=lambda p,*_:self.reader(p,os.getuid()+1)):
                        with self.assertRaises(Exception):A.qa_ready(self.j,self.l)
                    continue
                with self.assertRaises(Exception):A.qa_ready(self.j,self.l)
                self.j['operations'].pop(self.analysis_key,None)
        op=copy.deepcopy(self.analysis);op['binding']['run']=op['run'];key=digest(op['binding'])
        row=dict(grant=self.roles['technical_pm_product_analyst']['grant'],operation=key)
        with self.assertRaises(Exception):Q.analysis_operation(R,{'operations':{key:op}},row)
        for key in ('../bad','A'*64,'a'*63,'g'*64,None):
            with self.subTest(key=key),self.assertRaises(Exception):Q.qualification_operation(R,self.j,key)

    def accept_fixture(self, archived=False):
        self.archive_analysis()
        marker=dict(phase='canary',executor_uid=978,slot='slot2',qualification={
            'qualification_grant':self.roles['technical_pm_product_analyst']['grant']})
        q,marker,after=A.transition_plan('qa',COMMENT,CONTROLLER,self.j,marker,self.l)
        receipt=dict(schema='GB_AGY_29_OWNER_PACKAGE_TRANSACTION_V2',phase='complete',action='qa',
            owner_comment=COMMENT,controller_sha=CONTROLLER,body_sha256=self.l['body_sha256'],
            package_sha256=hashlib.sha256(A.encoded(self.l)).hexdigest(),
            task_sha256=q['task_sha256'],slot_before_raw=A.encoded(self.j).decode(),
            slot_before_sha256=hashlib.sha256(A.encoded(self.j)).hexdigest(),
            slot_after_sha256=hashlib.sha256(A.encoded(after)).hexdigest(),
            marker_before=dict(phase='canary',executor_uid=978,slot='slot2',qualification={
                'qualification_grant':self.roles['technical_pm_product_analyst']['grant']}),
            marker_after_sha256=hashlib.sha256(A.encoded(marker)).hexdigest())
        key,qa=operation(self.roles['independent_qa'],after['generation'])
        self.l['used_calls']=2;after['generation']+=1;after['operations'][key]=qa
        self.j=after
        if archived:
            R.atomic(self.root/'history'/'slot2'/(key+'.json'),qa);del self.j['operations'][key]
        return marker,receipt,key,qa

    def plan(self,marker,receipt):
        return A.acceptance_plan(COMMENT,CONTROLLER,self.j,marker,self.l,receipt)

    def test_accept_live_and_archived_and_refusals(self):
        for archived in (False,True):
            with self.subTest(archived=archived):
                self.setUp_fixture_again()
                marker,receipt,key,qa=self.accept_fixture(archived)
                with patch.object(A.os,'geteuid',return_value=0):
                    ready=self.plan(marker,receipt)
                    self.assertEqual(ready['phase'],'ready');self.assertEqual(ready['accepted_canary']['operation'],key)
                    mutations=[lambda m:m.update(phase='ready'),lambda m:m['modules'].update({'native_antigravity.py':'0'*64}),
                        lambda m:m['qualification']['qualification_grant'].update(owner_comment=COMMENT+1),
                        lambda m:m.update(adapter_revision='0'*40),
                        lambda m:m['qualification']['qualification_grant'].update(ceiling=True)]
                    for mutate in mutations:
                        wrong=copy.deepcopy(marker);mutate(wrong)
                        with self.assertRaises(Exception):self.plan(wrong,receipt)
                    with self.assertRaises(Exception):
                        A.acceptance_plan(COMMENT,'0'*40,self.j,marker,self.l,receipt)
                    with patch.object(P,'RULES_SHA256','0'*64),self.assertRaises(Exception):self.plan(marker,receipt)
                    for status in ('failed','unknown'):
                        qa['result']['status']=status
                        if archived:R.atomic(self.root/'history'/'slot2'/(key+'.json'),qa)
                        with self.assertRaises(Exception):self.plan(marker,receipt)
                    qa['result']['status']='confirmed'
                    if archived:R.atomic(self.root/'history'/'slot2'/(key+'.json'),qa)
                    duplicate=copy.deepcopy(qa);duplicate['task_hash']='0'*64
                    R.atomic(self.root/'history'/'slot2'/('f'*64+'.json'),duplicate)
                    with self.assertRaisesRegex(Exception,'reused'):self.plan(marker,receipt)

    def setUp_fixture_again(self):
        for path in (self.root/'history').rglob('*.json') if (self.root/'history').exists() else []:path.unlink()
        self.l=ledger();self.roles={r['grant']['role']:r for r in self.l['grants'].values()}
        self.analysis_key,self.analysis=operation(self.roles['technical_pm_product_analyst'],98,122)
        self.l['used_calls']=1;self.j=dict(generation=99,pending=None,operations={self.analysis_key:self.analysis})

    def test_accept_transaction_dry_idempotence_and_every_crash_boundary(self):
        marker,receipt,key,qa=self.accept_fixture(True)
        (self.root/'controller.lock').touch()
        initial=copy.deepcopy(self.l)
        for row in initial['grants'].values():row['operation']=None
        initial['used_calls']=0
        for crash in (None,1,2,3):
            with self.subTest(crash=crash):
                for path in self.root.glob(A.ACCEPT_PREFIX+'*'):path.unlink()
                for path,value in ((N.MARKER,marker),(R.POLICY,dict(mode='active',controller_sha=CONTROLLER)),
                   (R.BUDGET,dict(caps=2)),(self.root/'slot2.json',self.j),(self.root/'slot1.json',dict(pending=None)),
                   (self.root/(Q.OWNER_PACKAGE_LEDGER_PREFIX+str(COMMENT)+'.json'),self.l),
                   (self.root/(A.RECEIPT_PREFIX+str(COMMENT)+'-qa.json'),receipt),
                   (self.root/(A.RECEIPT_PREFIX+str(COMMENT)+'.json'),dict(schema='GB_AGY_29_OWNER_PACKAGE_TRANSACTION_V2',action='analysis',
                       package_sha256=hashlib.sha256(A.encoded(initial)).hexdigest(),phase='complete',owner_comment=COMMENT,
                       controller_sha=CONTROLLER,body_sha256=self.l['body_sha256'])),
                   (self.root/'other-marker.json',dict(phase='canary'))):R.atomic(path,value)
                before={p:p.read_bytes() for p in self.root.glob('*.json') if p!=N.MARKER}
                with patch.object(A.os,'geteuid',return_value=0),patch.object(A,'quiescent',return_value=self.j), \
                     patch.object(A,'package_rules_ok'), \
                     contextlib.redirect_stdout(io.StringIO()):
                    A.accept(COMMENT,dry=True)
                    self.assertEqual(N.MARKER.read_bytes(),A.encoded(marker))
                    self.assertFalse(list(self.root.glob(A.ACCEPT_PREFIX+'*')))
                    real=R.atomic;calls=[0]
                    def interrupted(*args,**kw):
                        real(*args,**kw);calls[0]+=1
                        if calls[0]==crash:raise RuntimeError('crash after durable write')
                    if crash:
                        with patch.object(R,'atomic',side_effect=interrupted),self.assertRaises(RuntimeError):A.accept(COMMENT)
                    A.accept(COMMENT);ready=N.MARKER.read_bytes();A.accept(COMMENT)
                    self.assertEqual(N.MARKER.read_bytes(),ready)
                    for path,raw in before.items():self.assertEqual(path.read_bytes(),raw)

    def test_installed_context_pin_compatibility_simulated(self):
        # This does not claim to reproduce the unavailable older file's bytes.
        # All three new modules run against the dev context implementation with
        # just RULES_SHA256 overridden to the installed value.
        with patch.object(P,'RULES_SHA256',Q.INSTALLED_C5_RULES):
            self.l=ledger();self.l['rules_sha256']=Q.INSTALLED_C5_RULES
            rows=[]
            for row in self.l['grants'].values():
                row['grant']['rules_sha256']=Q.INSTALLED_C5_RULES;rows.append(row)
            self.l['grants']={digest(row['grant']):row for row in rows}
            self.roles={r['grant']['role']:r for r in rows}
            self.analysis_key,self.analysis=operation(self.roles['technical_pm_product_analyst'],98,122)
            self.j=dict(generation=99,pending=None,operations={self.analysis_key:self.analysis});self.l['used_calls']=1
            self.archive_analysis();A.qa_ready(self.j,self.l)
            value=dict(schema=Q.OWNER_PACKAGE_SCHEMA,issue=29,repo_id=A.REPO_ID,owner_comment=COMMENT,
                controller_sha=CONTROLLER,rules_sha256=Q.INSTALLED_C5_RULES,source_base=A.SOURCE_BASE,
                source_head=A.SOURCE_HEAD,model=N.MODEL,max_calls=2,calls=[
                    dict(role=role,input_revision=pin[0],input_path=pin[1],input_sha256=pin[2])
                    for role,pin in A.EXPECTED_PINS.items()])
            with patch.object(A,'owner_comment',return_value=('trusted fixture',value)), \
                 patch.object(Q,'addressed_input',return_value='inert immutable fixture'):
                enrolled=A.authorize(COMMENT,CONTROLLER,existing=self.l)
                self.assertEqual(enrolled['rules_sha256'],Q.INSTALLED_C5_RULES)
                with self.assertRaises(Exception):A.authorize(COMMENT,CONTROLLER)

            g=self.roles['independent_qa']['grant']
            marker=dict(phase='canary',adapter_revision=CONTROLLER,
                        qualification=A.exact_qualification(g,CONTROLLER))
            with patch.object(N,'trusted',return_value=json.dumps(marker).encode()):
                self.assertEqual(N.qualification_task(A.SOURCE_BASE,A.SOURCE_HEAD,
                    adapter_revision=CONTROLLER,qualification_grant=g)['role'],'independent_qa')


    def test_real_qa_transaction_with_archived_analysis_and_installed_pins(self):
        comment=6404499964;controller=Q.INSTALLED_C5_CONTROLLER
        with patch.object(P,'RULES_SHA256',Q.INSTALLED_C5_RULES):
            self.l['owner_comment']=comment;self.l['controller_sha']=controller
            self.l['rules_sha256']=Q.INSTALLED_C5_RULES
            rows=list(self.l['grants'].values())
            for row in rows:
                row['grant'].update(owner_comment=comment,controller_revision=controller,rules_sha256=Q.INSTALLED_C5_RULES)
                row['operation']=None
            self.l['grants']={digest(row['grant']):row for row in rows}
            self.roles={row['grant']['role']:row for row in rows}
            value=dict(schema=Q.OWNER_PACKAGE_SCHEMA,issue=29,repo_id=A.REPO_ID,owner_comment=comment,
                controller_sha=controller,rules_sha256=Q.INSTALLED_C5_RULES,source_base=A.SOURCE_BASE,
                source_head=A.SOURCE_HEAD,model=N.MODEL,max_calls=2,calls=[
                    dict(role=role,input_revision=pin[0],input_path=pin[1],input_sha256=pin[2])
                    for role,pin in A.EXPECTED_PINS.items()])
            body=A.PREFIX+json.dumps(value,sort_keys=True,separators=(',',':'))
            self.l['body_sha256']=hashlib.sha256(body.encode()).hexdigest()
            self.analysis_key,self.analysis=operation(self.roles['technical_pm_product_analyst'],98,122)
            self.j=dict(generation=99,pending=None,operations={self.analysis_key:self.analysis})
            self.archive_analysis()
            marker=dict(phase='canary',executor_uid=978,qualification=A.exact_qualification(
                self.roles['technical_pm_product_analyst']['grant'],controller))
            (self.root/'controller.lock').touch()
            R.atomic(self.root/'slot2.json',self.j);R.atomic(N.MARKER,marker)
            R.atomic(R.POLICY,dict(mode='active',controller_sha=controller))
            R.atomic(self.root/(Q.OWNER_PACKAGE_LEDGER_PREFIX+str(comment)+'.json'),self.l)
            R.atomic(self.root/(A.RECEIPT_PREFIX+str(comment)+'.json'),dict(phase='complete'))
            real_sha=A.sha
            def file_sha(path):
                if path==self.root/Q.ADDRESSED_LEDGER:return A.HIST
                if path==self.root/Q.SUPPLEMENT_LEDGER:return A.SUP
                if path==R.BUDGET:return A.BUDGET
                return real_sha(path)
            with patch.object(A.os,'geteuid',return_value=0),patch.object(R,'trusted_tree'), \
                 patch.object(A,'quiescent',side_effect=lambda c:R.journal('slot2')), \
                 patch.object(A,'owner_comment',return_value=(body,value)), \
                 patch.object(Q,'addressed_input',return_value='immutable inert input'), \
                 patch.object(N,'trusted',side_effect=lambda p:p.read_bytes()), \
                 patch.object(A,'sha',side_effect=file_sha), \
                 patch.object(A.sys,'argv',['owner_package_admission','--qa',str(comment)]), \
                 contextlib.redirect_stdout(io.StringIO()):
                A.main();marker_after=N.MARKER.read_bytes();A.main()
            self.assertEqual(N.MARKER.read_bytes(),marker_after)
            self.assertEqual(R.journal('slot2')['generation'],100)
            self.assertEqual(json.loads(marker_after)['qualification']['qualification_grant'],self.roles['independent_qa']['grant'])
            self.assertEqual(R.read(self.root/(Q.OWNER_PACKAGE_LEDGER_PREFIX+str(comment)+'.json'),0),self.l)

    def test_accept_installed_rules_and_context_bytes_drift(self):
        package=dict(rules_sha256=Q.INSTALLED_C5_RULES)
        expected='d961079b9791f53cf7ce0ac208180b0c9d9100ef46b48c025c2938d2eb69a806'
        with patch.object(P,'RULES_SHA256',Q.INSTALLED_C5_RULES):
            def pin(path):return Q.INSTALLED_C5_RULES if Path(path).name.endswith('.md') else expected
            with patch.object(A,'sha',side_effect=pin):A.package_rules_ok(package)
            for changed in ('context_policy.py','accepted-engineering-rules.md'):
                with patch.object(A,'sha',side_effect=lambda p:'0'*64 if Path(p).name==changed else pin(p)), \
                     self.assertRaises(Exception):A.package_rules_ok(package)


spec=importlib.util.spec_from_file_location('pkg_install',Path(__file__).resolve().parents[1]/'ops'/'agy29_pkg_finish_install.py')
# Keep old-head regression discovery runnable even before this new file exists.
I=None
if spec and Path(spec.origin).exists():
    I=importlib.util.module_from_spec(spec);spec.loader.exec_module(I)

class ScopedInstallTests(unittest.TestCase):
    def bundle_fixture(self, root):
        bundle=root/'bundle';bundle.mkdir();(bundle/'.git').mkdir()
        (bundle/'.git'/'config').write_bytes(b'[core]\n\trepositoryformatversion = 0\n\tbare = false\n')
        return bundle

    def bundle_trusted(self, path):
        # Keep the production no-link/no-write checks, adapting root ownership
        # only for synthetic fixtures and their test-identity-owned ancestors.
        # Ancestors at or above the platform temp directory (for example the
        # sticky, world-writable /tmp on CI) are outside the synthetic fixture.
        temp=Path(tempfile.gettempdir()).resolve()
        for parent in (path,*path.parents):
            if parent.resolve()==temp:break
            info=parent.lstat()
            I.need(not stat.S_ISLNK(info.st_mode) and info.st_uid in (0,os.getuid())
                   and not info.st_mode & 0o022,'untrusted synthetic bundle path')

    def bundle_refuses_before_git(self, bundle, message):
        with patch.object(I,'R',SimpleNamespace(trusted_tree=self.bundle_trusted)), \
             patch.object(I.subprocess,'run',side_effect=AssertionError('Git ran before refusal')) as spy:
            with self.assertRaisesRegex(I.Refused,message):I.source(bundle,'a'*40)
            spy.assert_not_called()

    def test_bundle_gitfile_external_filter_refused_before_subprocess(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);bundle=self.bundle_fixture(root);external=root/'external'
            (bundle/'.git').rename(external);external.chmod(0o777)
            marker=root/'filter-marker'
            # Inert until Git invokes it; the subprocess spy must never be hit.
            (external/'config').write_text('[filter "probe"]\n\tclean = touch '+str(marker)+'\n')
            (bundle/'.gitattributes').write_text('payload filter=probe\n')
            (bundle/'payload').write_text('synthetic\n')
            (bundle/'.git').write_text('gitdir: '+str(external)+'\n')
            self.assertEqual(stat.S_IMODE(external.stat().st_mode),0o777)
            self.bundle_refuses_before_git(bundle,r'\.git must be a real directory')
            self.assertFalse(marker.exists())

    def test_bundle_git_symlink_refused_before_subprocess(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);bundle=self.bundle_fixture(root);external=root/'external'
            (bundle/'.git').rename(external);(bundle/'.git').symlink_to(external,target_is_directory=True)
            self.bundle_refuses_before_git(bundle,r'\.git must be a real directory')

    def test_bundle_git_indirection_and_info_attributes_refused(self):
        for name in ('commondir','gitdir','objects/info/alternates','modules','info/attributes'):
            with self.subTest(name=name),tempfile.TemporaryDirectory() as directory:
                bundle=self.bundle_fixture(Path(directory));path=bundle/'.git'/name
                path.parent.mkdir(parents=True,exist_ok=True)
                if name=='modules':path.mkdir()
                else:path.write_text('synthetic\n')
                self.bundle_refuses_before_git(bundle,'forbidden bundle .git/')

    def test_bundle_forbidden_config_families(self):
        cases=[('[filter "probe"]','clean'),('[diff "probe"]','textconv'),
               ('[diff "probe"]','command'),('[core]','fsmonitor'),('[core]','sshCommand'),
               ('[core]','hooksPath'),('[core]','pager'),('[core]','editor'),('[alias]','probe'),
               ('[include]','path'),('[includeIf "gitdir:*"]','path'),('[credential "probe"]','helper'),
               ('[url "probe"]','insteadOf'),('[protocol "file"]','allow'),
               ('[FiLtEr.probe]','clean'),('[DiFf.probe]','TeXtCoNv'),('[URL.probe]','INSTEADOF'),
               ('[CORE]','FSMONITOR'),('[INCLUDEIF.probe]','path')]
        for config in ('config','config.worktree'):
            for header,key in cases:
                with self.subTest(config=config,header=header,key=key),tempfile.TemporaryDirectory() as directory:
                    bundle=self.bundle_fixture(Path(directory))
                    if config=='config.worktree':
                        (bundle/'.git'/'config').write_text('[extensions]\n\tworktreeConfig = true\n')
                    (bundle/'.git'/config).write_text(header+'\n\t'+key+' = synthetic\n')
                    self.bundle_refuses_before_git(bundle,'forbidden bundle git config')

    def test_bundle_ambiguous_config_refused_before_subprocess(self):
        for raw in (b'[core] fsmonitor = synthetic\n',b'[core]\nfsmoni\\\ntor = synthetic\n',
                    b'[core]\nfsmonitor\x00 = synthetic\n',b'[core\nfsmonitor = synthetic\n'):
            with self.subTest(raw=raw),tempfile.TemporaryDirectory() as directory:
                bundle=self.bundle_fixture(Path(directory));(bundle/'.git'/'config').write_bytes(raw)
                self.bundle_refuses_before_git(bundle,'unsafe bundle git config')

    def test_bundle_filter_attributes_refused_before_subprocess(self):
        for name in ('.gitattributes','nested/.gitattributes','.gitmodules'):
            with self.subTest(name=name),tempfile.TemporaryDirectory() as directory:
                bundle=self.bundle_fixture(Path(directory));path=bundle/name
                path.parent.mkdir(parents=True,exist_ok=True);path.write_text('* filter=probe\n')
                self.bundle_refuses_before_git(bundle,'forbidden bundle filter attribute')

    def test_bundle_git_subprocess_scrubbed_environment_and_options(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle=self.bundle_fixture(Path(directory))
            poison=dict(GIT_DIR='/synthetic/foreign',GIT_WORK_TREE='/synthetic/foreign',
                GIT_CONFIG_COUNT='1',GIT_CONFIG_KEY_0='core.fsmonitor',GIT_CONFIG_VALUE_0='synthetic',
                GIT_CONFIG_PARAMETERS='synthetic',GIT_CONFIG_SYSTEM='/synthetic/foreign',
                GIT_EXEC_PATH='/synthetic/foreign',GIT_EXTERNAL_DIFF='synthetic',
                HOME='/synthetic/foreign',UNRELATED='synthetic')
            with patch.dict(os.environ,poison), \
                 patch.object(I.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=b'clean')) as spy:
                self.assertEqual(I.git(bundle,'status','--porcelain=v1','--ignore-submodules=all'),b'clean')
            spy.assert_called_once();args,kwargs=spy.call_args;argv=args[0]
            self.assertEqual(kwargs['env'],dict(PATH='/usr/bin:/bin',LC_ALL='C',HOME='/nonexistent',
                GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL='/dev/null',GIT_CONFIG_SYSTEM='/dev/null',
                GIT_TERMINAL_PROMPT='0',GIT_OPTIONAL_LOCKS='0',GIT_ATTR_NOSYSTEM='1'))
            self.assertEqual(argv,['/usr/bin/git','--no-optional-locks','--no-replace-objects',
                '--git-dir='+str(bundle/'.git'),'--work-tree='+str(bundle),
                '-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null',
                '-c','core.attributesFile=/dev/null','-c','core.untrackedCache=false',
                '-c','protocol.allow=never','-c','safe.directory='+str(bundle),
                'status','--porcelain=v1','--ignore-submodules=all'])
            self.assertEqual(kwargs['stdin'],subprocess.DEVNULL)
            self.assertFalse(kwargs['check']);self.assertEqual(kwargs['timeout'],20)
            self.assertNotIn('shell',kwargs)

    def test_bundle_plain_merge_checkout_and_dirty_detection(self):
        with tempfile.TemporaryDirectory() as directory,contextlib.ExitStack() as stack:
            bundle=self.bundle_fixture(Path(directory));repo=Path(__file__).resolve().parents[3]
            fixture_env=dict(PATH='/usr/bin:/bin',HOME='/nonexistent',LC_ALL='C',
                GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_SYSTEM='/dev/null',GIT_CONFIG_GLOBAL='/dev/null',
                GIT_AUTHOR_NAME='Synthetic',GIT_AUTHOR_EMAIL='synthetic@example.invalid',
                GIT_COMMITTER_NAME='Synthetic',GIT_COMMITTER_EMAIL='synthetic@example.invalid')
            def fixture_git(*args,input=None):
                return subprocess.run(['/usr/bin/git','-C',str(bundle),*args],input=input,env=fixture_env,
                    stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout.strip().decode()
            fixture_git('init','--template=')
            fixture_git('remote','add','origin','https://github.com/anpavel84-afk/gobadminton-clean.git')
            paths=['scripts/chatops/actions_train/'+n for n in I.TARGETS]
            paths+=['scripts/chatops/actions_train/manifest.json','.github/workflows/train-stage.yml']
            for name in paths:
                path=bundle/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes((repo/name).read_bytes())
            (bundle/'.gitignore').write_text('ignored\n')
            (bundle/'.gitattributes').write_text('*.txt text\n')
            fixture_git('add','.')
            tree=fixture_git('write-tree')
            base=fixture_git('commit-tree',tree,input=b'base\n')
            first=fixture_git('commit-tree',tree,'-p',base,input=b'first\n')
            second=fixture_git('commit-tree',tree,'-p',base,input=b'second\n')
            merge=fixture_git('commit-tree',tree,'-p',first,'-p',second,input=b'merge\n')
            fixture_git('update-ref','HEAD',merge)
            real_git=I.git
            def checked_git(path,*args):
                if args[0]=='merge-base':
                    self.assertEqual(args,('merge-base','--is-ancestor',
                        'bdd912a82a2f0087f4cfc9c6820edc8c49ee6527',merge))
                    args=('merge-base','--is-ancestor',base,merge)
                return real_git(path,*args)
            # Only substitute the impossible-to-synthesize production ancestor
            # SHA. Every source check and Git subprocess otherwise runs for real.
            stack.enter_context(patch.object(I,'git',side_effect=checked_git))
            stack.enter_context(patch.object(I,'R',SimpleNamespace(trusted_tree=self.bundle_trusted)))
            before={p:p.read_bytes() for p in bundle.rglob('*') if p.is_file()}
            expected={name:(repo/'scripts/chatops/actions_train'/name).read_bytes() for name in I.TARGETS}
            self.assertEqual(I.source(bundle,merge),expected)
            self.assertEqual({p:p.read_bytes() for p in bundle.rglob('*') if p.is_file()},before)
            (bundle/'ignored').write_text('ignored synthetic\n')
            self.assertEqual(I.source(bundle,merge),expected)
            target=bundle/paths[0];original=target.read_bytes()
            for dirty in ('untracked','unstaged','staged','deleted'):
                with self.subTest(dirty=dirty):
                    if dirty=='untracked':(bundle/'untracked').write_text('synthetic\n')
                    elif dirty=='deleted':target.unlink()
                    else:target.write_bytes(original+b'\n')
                    if dirty=='staged':fixture_git('add',paths[0])
                    with self.assertRaisesRegex(I.Refused,'dirty bundle'):I.source(bundle,merge)
                    (bundle/'untracked').unlink(missing_ok=True);target.write_bytes(original)
                    fixture_git('add',paths[0])
            for value in ('none','/dev/null'):
                fixture_git('config','core.hooksPath',value)
                self.assertEqual(I.source(bundle,merge),expected)

    def idle_fixture(self, active, pending=None, occupied=False):
        from unittest.mock import Mock
        receiver=SimpleNamespace(journal=Mock(return_value=dict(pending=pending)),
            checkpoint=Mock(return_value=(dict(active=active),[])),no_models=Mock(),
            units_quiet=Mock(),UNITS=('synthetic-unit',))
        policy=dict(mode='active',controller_sha=I.C,stage_workflow_sha256=I.STAGE_SHA)
        with patch.object(I,'R',receiver),patch.object(I,'read_json',return_value=policy), \
             patch.object(I,'lock_unheld') as locks,patch.object(I.os.path,'lexists',return_value=False), \
             patch.object(I,'run',return_value=b'ActiveState=inactive\nMainPID=0\nUnitFileState=masked\n') as run:
            if occupied:
                with self.assertRaisesRegex(I.Refused,'slot occupied'):I.idle()
                receiver.no_models.assert_not_called();locks.assert_not_called();run.assert_not_called()
            else:
                I.idle()
                self.assertEqual(receiver.journal.call_count,2)
                self.assertEqual(receiver.checkpoint.call_count,2)
                self.assertEqual(receiver.no_models.call_args_list,
                                 [unittest.mock.call(1002,'slot1'),unittest.mock.call(978,'slot2')])
                self.assertEqual(locks.call_count,4);receiver.units_quiet.assert_called_once()
                run.assert_called_once()

    def test_idle_active_none_free(self):
        self.idle_fixture(None)

    def test_idle_active_done_free(self):
        self.idle_fixture(dict(issue=29,phase='done'))

    def test_idle_non_done_or_malformed_active_occupied(self):
        for active in (dict(phase='author'),dict(phase='qa'),dict(phase='integrate'),{},
                       dict(phase=None),dict(phase=123),dict(phase=['done']),dict(phase='DONE'),
                       False,0,'done',[],['done']):
            with self.subTest(active=active):self.idle_fixture(active,occupied=True)

    def test_idle_pending_always_occupied(self):
        for active in (None,dict(phase='done')):
            for pending in ('operation',{},False,0):
                with self.subTest(active=active,pending=pending):
                    self.idle_fixture(active,pending,occupied=True)

    def test_target_and_manifest_pins_and_unchanged_coverage(self):
        self.assertIsNotNone(I,'scoped installer missing')
        repo=Path(__file__).resolve().parents[3]
        for name,(_,pin) in I.TARGETS.items():
            self.assertEqual(hashlib.sha256((repo/'scripts/chatops/actions_train'/name).read_bytes()).hexdigest(),pin)
        self.assertEqual(hashlib.sha256((repo/'scripts/chatops/actions_train/manifest.json').read_bytes()).hexdigest(),I.MANIFEST)
        self.assertEqual(set(I.TARGETS),{'native_antigravity.py','antigravity_qa_recovery.py','owner_package_admission.py'})
        required={'context_policy.py','accepted-engineering-rules.md','stage.py','receiver.py','native_guard.py',
            'core.py','content_identity.py','installer.py','monitor.py','monitor-mapping.json','monitor_extension.js'}
        self.assertTrue(required<={p.name for p in I.UNCHANGED})
        self.assertEqual({p.name for p in I.STATE_OBSERVED},{'policy.json','antigravity-qa.json','budgets.json'})
        self.assertEqual({p.name for p in I.REQUIRED_STATE},{'slot1.json','slot2.json',
            'antigravity-29-owner-package-6404499964.json','antigravity-29-addressed-ledger.json',
            'antigravity-29-stage3-supplement.json'})
        self.assertIn(Path('/usr/local/lib/gb-ops-monitor/opsmon/writer.py'),I.UNCHANGED)
        self.assertIn(Path('/usr/local/lib/gb-ops-monitor/web/app.js'),I.UNCHANGED)

    def test_inventory_updates_only_three_entries(self):
        self.assertIsNotNone(I,'scoped installer missing')
        before=dict(manifest=I.OLD_MANIFEST,after={str(I.LIB/n):pins[0] for n,pins in I.TARGETS.items()},other='preserved')
        before['after'].update({str(n):'a'*64 for n in range(29)})
        after=I.inventory_after(before)
        changes={k for k in before['after'] if before['after'][k]!=after['after'][k]}
        self.assertEqual(changes,{str(I.LIB/n) for n in I.TARGETS})
        self.assertEqual(before['manifest'],after['manifest']);self.assertEqual(after['other'],'preserved')

    def test_dry_no_writes_and_observation_binding(self):
        self.assertIsNotNone(I,'scoped installer missing')
        observed=dict(protected={'state/slot2.json':'a'*64},inventory_sha256='b'*64,targets={})
        with patch.object(I,'lock_unheld'),patch.object(I,'observation',return_value=observed), \
             patch.object(I.os.path,'lexists',return_value=False),patch.object(I,'sha',return_value='c'*64), \
             patch.object(I,'write_json',side_effect=AssertionError('dry write')), \
             patch.object(I,'atomic_bytes',side_effect=AssertionError('dry write')),contextlib.redirect_stdout(io.StringIO()) as out:
            I.dry({n:b'synthetic' for n in I.TARGETS},'1'*40)
            self.assertEqual(json.loads(out.getvalue())['observation_sha256'],I.digest(observed))
            with self.assertRaisesRegex(I.Refused,'observation changed'):I.apply({},'1'*40,'0'*64)


    def c5_rules_fixture(self, stack, lib, state, inventory, receipt_edit=None):
        # Synthetic EOM 1.3 -> 1.4 transition with a hash-bound C5 receipt chain.
        old,new=b'eom 1.3 rules',b'eom 1.4 rules'
        (lib/I.RULES_NAME).write_bytes(new)
        inventory['after'][str(lib/I.RULES_NAME)]=hashlib.sha256(old).hexdigest()
        (state/I.C5_BACKUP_NAME).mkdir()
        (state/I.C5_BACKUP_NAME/'rules').write_bytes(old)
        receipt=dict(schema=I.C5_SCHEMA,phase='active',controller_sha=I.C,manifest_sha256=I.OLD_MANIFEST,
                     rules_sha256=hashlib.sha256(new).hexdigest(),
                     backups=dict(rules=dict(mode=420,sha256=hashlib.sha256(old).hexdigest())))
        if receipt_edit:receipt_edit(receipt)
        raw=json.dumps(receipt,sort_keys=True).encode()
        (state/I.C5_RECEIPT_NAME).write_bytes(raw)
        for key,value in (('RULES_INVENTORY_SHA',hashlib.sha256(old).hexdigest()),
                          ('RULES_LIVE_SHA',hashlib.sha256(new).hexdigest()),
                          ('C5_RECEIPT_SHA',hashlib.sha256(raw).hexdigest())):
            stack.enter_context(patch.object(I,key,value))

    def test_inventory_live_match_is_exact_except_one_pinned_pair(self):
        self.assertIsNotNone(I,'scoped installer missing')
        rules=I.LIB/I.RULES_NAME
        a,b,c='a'*64,'b'*64,'c'*64
        self.assertEqual(I.inventory_live_matches(Path('/x'),a,a),'exact')
        self.assertEqual(I.inventory_live_matches(rules,a,a),'exact')
        self.assertEqual(I.inventory_live_matches(rules,I.RULES_INVENTORY_SHA,I.RULES_LIVE_SHA),'c5_rules')
        self.assertEqual(I.RULES_LIVE_SHA,I.UNCHANGED[rules])
        for path,pin,live in ((rules,I.RULES_LIVE_SHA,I.RULES_INVENTORY_SHA),   # reverse
                              (rules,I.RULES_INVENTORY_SHA,c),                   # third live hash
                              (rules,c,I.RULES_LIVE_SHA),                        # third inventory hash
                              (rules,a,b),
                              (I.LIB/'context_policy.py',I.RULES_INVENTORY_SHA,I.RULES_LIVE_SHA),  # right pair, wrong path
                              (I.LIB/'native_antigravity.py',I.RULES_INVENTORY_SHA,I.RULES_LIVE_SHA),
                              (Path('/other')/I.RULES_NAME,I.RULES_INVENTORY_SHA,I.RULES_LIVE_SHA)):
            with self.subTest(path=str(path),pin=pin[:8],live=live[:8]):
                self.assertIsNone(I.inventory_live_matches(path,pin,live))

    def observation_fixture(self, stack, root, receipt_edit=None):
        lib=root/'lib';lib.mkdir();state=root/'state';state.mkdir()
        marker=root/'marker';marker.write_text('{"phase":"canary"}')
        autonomy=root/'autonomy'
        for slot in ('slot1','slot2'):(autonomy/'slots'/slot).mkdir(parents=True)
        (autonomy/'locks').mkdir()
        (root/'policy').write_text('{}');(root/'budget').write_text('{}')
        for key,value in dict(LIB=lib,STATE=state,AUTONOMY=autonomy,MARKER=marker,POLICY=root/'policy',BUDGET=root/'budget',
                              INVENTORY=state/'backup.json').items():
            stack.enter_context(patch.object(I,key,value))
        stack.enter_context(patch.object(I,'REQUIRED_STATE',[]))
        stack.enter_context(patch.object(I,'UNCHANGED',{}));stack.enter_context(patch.object(I,'STATE_OBSERVED',{}))
        stack.enter_context(patch.object(I,'idle'))
        pins={name:(hashlib.sha256(('old '+name).encode()).hexdigest(),'f'*64) for name in I.TARGETS}
        stack.enter_context(patch.object(I,'TARGETS',pins))
        for name in pins:(lib/name).write_bytes(('old '+name).encode())
        inventory=dict(manifest=I.OLD_MANIFEST,after={str(lib/n):v[0] for n,v in pins.items()})
        for n in range(28):
            path=lib/('untouched'+str(n));path.write_bytes(b'unchanged')
            inventory['after'][str(path)]=hashlib.sha256(b'unchanged').hexdigest()
        self.c5_rules_fixture(stack,lib,state,inventory,receipt_edit)
        (state/'backup.json').write_text(json.dumps(inventory))
        return lib,state,inventory

    def test_observation_accepts_only_provenanced_c5_rules_drift(self):
        self.assertIsNotNone(I,'scoped installer missing')
        with tempfile.TemporaryDirectory() as directory,contextlib.ExitStack() as stack:
            lib,state,inventory=self.observation_fixture(stack,Path(directory))
            observed=I.observation()
            self.assertEqual(observed['inventory_rules_provenance']['c5_receipt_sha256'],I.C5_RECEIPT_SHA)
            def refuses(message,mutate,restore):
                mutate()
                try:
                    with self.assertRaisesRegex(I.Refused,message):I.observation()
                finally:restore()
            # Another file drifting still refuses, even with the rules exception active.
            other=lib/'untouched3';raw=other.read_bytes()
            refuses('live inventory byte drift',lambda:other.write_bytes(b'tampered'),lambda:other.write_bytes(raw))
            # Rules at a third hash (unprovenanced) refuses.
            rules=lib/I.RULES_NAME;live=rules.read_bytes()
            refuses('live inventory byte drift',lambda:rules.write_bytes(b'third rules'),lambda:rules.write_bytes(live))
            # Receipt bytes changed (hash-bound) refuses.
            receipt=state/I.C5_RECEIPT_NAME;raw=receipt.read_bytes()
            refuses('C5 receipt bytes drift',lambda:receipt.write_bytes(raw+b' '),lambda:receipt.write_bytes(raw))
            # Receipt removed refuses.
            refuses('C5 receipt unreadable',receipt.unlink,lambda:receipt.write_bytes(raw))
            # Backup of the EOM 1.3 bytes tampered refuses.
            backup=state/I.C5_BACKUP_NAME/'rules';braw=backup.read_bytes()
            refuses('C5 rules backup drift',lambda:backup.write_bytes(b'other'),lambda:backup.write_bytes(braw))
            refuses('C5 rules backup unreadable',backup.unlink,lambda:backup.write_bytes(braw))
            I.observation()

    def test_observation_refuses_receipt_chain_mismatch_even_when_hash_pinned(self):
        self.assertIsNotNone(I,'scoped installer missing')
        edits={'phase':lambda r:r.update(phase='rolled_back'),
               'schema':lambda r:r.update(schema='OTHER'),
               'controller':lambda r:r.update(controller_sha='0'*40),
               'manifest':lambda r:r.update(manifest_sha256='0'*64),
               'rules':lambda r:r.update(rules_sha256='0'*64),
               'backup':lambda r:r['backups']['rules'].update(sha256='0'*64),
               'nobackups':lambda r:r.pop('backups')}
        for label,edit in edits.items():
            with self.subTest(label),tempfile.TemporaryDirectory() as directory,contextlib.ExitStack() as stack:
                self.observation_fixture(stack,Path(directory),edit)
                with self.assertRaisesRegex(I.Refused,'C5 receipt chain mismatch'):I.observation()

    def test_observation_without_rules_drift_needs_no_receipt(self):
        self.assertIsNotNone(I,'scoped installer missing')
        with tempfile.TemporaryDirectory() as directory,contextlib.ExitStack() as stack:
            lib,state,inventory=self.observation_fixture(stack,Path(directory))
            inventory['after'][str(lib/I.RULES_NAME)]=hashlib.sha256((lib/I.RULES_NAME).read_bytes()).hexdigest()
            (state/'backup.json').write_text(json.dumps(inventory))
            (state/I.C5_RECEIPT_NAME).unlink()
            self.assertIsNone(I.observation()['inventory_rules_provenance'])

    def test_fake_root_apply_verify_rollback_byte_exact(self):
        self.fake_root_cycle(False)

    def test_fake_root_c5_rules_exception_apply_verify_rollback_byte_exact(self):
        self.fake_root_cycle(True)

    def fake_root_cycle(self, rules):
        self.assertIsNotNone(I,'scoped installer missing')
        with tempfile.TemporaryDirectory() as directory,contextlib.ExitStack() as stack:
            root=Path(directory);lib=root/'lib';lib.mkdir();state=root/'state';state.mkdir()
            autonomy=root/'autonomy'
            for slot in ('slot1','slot2'):(autonomy/'slots'/slot).mkdir(parents=True)
            (autonomy/'locks').mkdir()
            paths=dict(LIB=lib,STATE=state,AUTONOMY=autonomy,POLICY=root/'policy',MARKER=root/'marker',
                BUDGET=root/'budget',INVENTORY=state/'backup.json',BK=state/'backup',J=state/'journal')
            for key,value in paths.items():stack.enter_context(patch.object(I,key,value))
            required=[state/'slot1.json',state/'slot2.json']
            for path in required:path.write_text('{"pending":null}')
            stack.enter_context(patch.object(I,'REQUIRED_STATE',required))
            material={name:('new '+name).encode() for name in I.TARGETS}
            pins={name:(hashlib.sha256(('old '+name).encode()).hexdigest(),hashlib.sha256(raw).hexdigest())
                  for name,raw in material.items()}
            stack.enter_context(patch.object(I,'TARGETS',pins));stack.enter_context(patch.object(I,'UNCHANGED',{}))
            stack.enter_context(patch.object(I,'STATE_OBSERVED',{}))
            stack.enter_context(patch.object(I,'idle'));stack.enter_context(patch.object(I,'smoke'))
            stack.enter_context(patch.object(I,'R',SimpleNamespace(trusted_tree=lambda p:None)))
            # Synthetic tests cannot chown to root; exercise the real fsync/rename
            # writer while preserving fixture identity. Production ownership gate
            # stays mandatory and is not claimed as exercised here.
            stack.enter_context(patch.object(I.os,'fchown'))
            for name in pins:(lib/name).write_bytes(('old '+name).encode())
            for key in ('POLICY','MARKER','BUDGET'):
                paths[key].write_text(json.dumps({'phase':'canary'}))
            inventory=dict(manifest=I.OLD_MANIFEST,after={str(lib/n):v[0] for n,v in pins.items()})
            for n in range(28 if rules else 29):
                path=lib/('untouched'+str(n));path.write_bytes(b'unchanged')
                inventory['after'][str(path)]=hashlib.sha256(b'unchanged').hexdigest()
            if rules:
                self.c5_rules_fixture(stack,lib,state,inventory)
            paths['INVENTORY'].write_text(json.dumps(inventory,indent=2))
            before={p:p.read_bytes() for p in root.rglob('*') if p.is_file()}
            observed=I.observation()
            self.assertEqual(observed['inventory_rules_provenance'] is not None,rules)
            with contextlib.redirect_stdout(io.StringIO()):I.dry(material,'a'*40)
            self.assertEqual({p:p.read_bytes() for p in root.rglob('*') if p.is_file()},before)
            with contextlib.redirect_stdout(io.StringIO()):I.apply(material,'a'*40,I.digest(observed))
            receipt=json.loads(paths['J'].read_bytes());I.verify(receipt)
            for key in ('POLICY','MARKER','BUDGET'):self.assertEqual(paths[key].read_bytes(),before[paths[key]])
            I.restore(receipt)
            for path,raw in before.items():self.assertEqual(path.read_bytes(),raw)
            self.assertEqual(json.loads(paths['J'].read_bytes())['phase'],'rolled_back')

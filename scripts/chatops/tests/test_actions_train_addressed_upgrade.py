"""Reviewed helper transaction simulations: no installation or external effects."""
import copy
import hashlib
import importlib.util
import json
import os
import stat
import subprocess
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch
from test_actions_train import ROOT,core
from test_actions_train_addressed_analysis import grant
import antigravity_qa_recovery as Q

spec=importlib.util.spec_from_file_location('addressed_upgrade_tests',ROOT/'scripts/chatops/ops/antigravity_addressed_upgrade.py')
U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U);U.Q=Q


def proof():
    return dict(schema='GB_AGY_29_ADDRESSED_UPGRADE_V1',owner_comment=6362661117,
        baseline_controller=Q.INSTALLED_BASELINE,baseline_record_sha256='a'*64,controller='c'*40,
        release_revision='d'*40,manifest_sha256='b'*64,stage_workflow_sha256='c'*64,
        dispatch_workflow_sha256='d'*64,team_helper_sha256='e'*64,
        changes={str(U.MARKER):dict(before='e'*64,after='f'*64)},
        history={n:'f'*64 for n in ('slot2.json',Q.LINEAGE,Q.GRANT_LEDGER,
                                  'antigravity-qa-one-shot-'+Q.THIRD_TASK+'.json')},grant=grant())


class Protocol(unittest.TestCase):
    def test_closed_proof_b51_only_exact_targets_and_hashes(self):
        p=proof();U.validate(p)
        for change in (dict(owner_comment=True),dict(baseline_controller='a'*40),dict(extra=True),
                       dict(manifest_sha256='dev'),dict(controller=Q.INSTALLED_BASELINE),
                       dict(changes={'/root/arbitrary':dict(before=None,after='f'*64)}),dict(history={})):
            with self.subTest(change=change),self.assertRaises(core.Refused):U.validate(p|change)
        for text in ('{}{}','{"schema":1,"schema":2}','{"schema":1} trailing'):
            with self.assertRaises((core.Refused,ValueError)):core.loads(text)
    def test_bootstrap_rejects_foreign_authority_before_import_or_payload(self):
        with patch.object(U.i,'payload') as payload:
            with self.assertRaises(core.Refused):U.load_reviewed(ROOT,proof()|dict(owner_comment=123))
            payload.assert_not_called()
    def test_analysis_is_not_qa_readiness(self):
        p=proof();q=U.descriptor(p['grant'])
        C=SimpleNamespace(quiet=Mock())
        with patch.object(U.r,'read',return_value={'qualification':q}),self.assertRaises(core.Refused):
            U.accept(p,dict(controller=p['controller'],changes={}),dict(mode='disabled',controller_sha=p['controller']),C,None)


class Transaction(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.state=self.root/'state';self.state.mkdir()
        self.jp=self.state/'upgrade';self.backup=self.state/'backup';self.policy=self.root/'policy'
        self.target=self.root/'native';self.source=self.root/'source';self.marker=self.root/'marker'
        self.target.write_text('old');self.source.write_text('new');self.marker.write_text('historical-marker')
        self.ledger=self.state/'addressed-ledger';self.before=dict(mode='disabled',controller_sha=Q.INSTALLED_BASELINE,
            recovery={'source_sha':Q.INSTALLED_BASELINE})
        self.policy.write_text(json.dumps(self.before));(self.state/'backup.json').write_text(json.dumps({'after':{}}))
        self.p=proof();self.pp=self.root/'proof';self.pp.write_text(json.dumps(self.p))
        self.virtual={self.marker:dict(phase='canary'),self.ledger:dict(used_calls=0)}
        self.changes={str(self.target):dict(before=U.i.sha(self.target),after=U.i.sha(self.source)),
            **{str(t):dict(before=U.i.sha(t),after=hashlib.sha256(U.encoded(v)).hexdigest()) for t,v in self.virtual.items()}}
        self.snapshot={'old2/2':'unchanged','old1/1':'unchanged','fac7':'unknown'}
        self.C=SimpleNamespace(quiet=Mock(),sync_directory=Mock())
        self.u=SimpleNamespace(probe=Mock(return_value={'run':7}))
        self.T=SimpleNamespace(helpers=lambda b:(self.C,self.u))
        def read(p,*a,**kw):return json.loads(Path(p).read_text())
        def atomic(p,v,**kw):Path(p).write_text(json.dumps(copy.deepcopy(v)))
        def put(s,t,*a):Path(t).write_bytes(Path(s).read_bytes())
        self.patches=[patch.multiple(U,STATE=self.state,JOURNAL=self.jp,BACKUP=self.backup,MARKER=self.marker,LEDGER=self.ledger),
            patch.object(U.r,'POLICY',self.policy),patch.object(U.os,'geteuid',return_value=0),
            patch.object(U.r,'trusted_tree'),patch.object(U.r,'read',side_effect=read),patch.object(U.r,'atomic',side_effect=atomic),
            patch.object(U.r,'locked',side_effect=lambda *a:os.open('/dev/null',os.O_RDONLY)),
            patch.object(U,'team',return_value=self.T),patch.object(U,'load_reviewed'),patch.object(U,'validate'),
            patch.object(U,'preserved',side_effect=lambda *a:copy.deepcopy(self.snapshot)),patch.object(U.i,'put',side_effect=put),
            patch.object(U,'plan',side_effect=lambda *a:(copy.deepcopy(self.before),{'after':{}},
                {self.target:self.source},{self.target:self.source},self.virtual,self.changes,copy.deepcopy(self.snapshot)))]
        for p in self.patches:p.start();self.addCleanup(p.stop)
    def call(self,action):return U.execute(action,self.root,self.pp,U.i.sha(self.pp),run_id=7)
    def test_dry_apply_disabled_and_rollback_restore_only_targets(self):
        self.assertTrue(self.call('dry')['dry']);self.assertFalse(self.jp.exists())
        self.assertEqual(self.call('apply')['phase'],'installed-disabled')
        self.assertEqual(json.loads(self.policy.read_text())['mode'],'disabled')
        self.assertEqual(self.target.read_text(),'new')
        self.assertEqual(self.call('rollback')['phase'],'rolled-back-disabled')
        self.assertEqual(self.target.read_text(),'old');self.assertFalse(self.ledger.exists())
        self.assertEqual(self.marker.read_text(),'historical-marker')
        self.assertEqual(self.snapshot['fac7'],'unknown')
    def test_intent_precedes_targets_and_backup_failure_is_reversible(self):
        def fail(s,t,*a):
            self.assertEqual(json.loads(self.jp.read_text())['phase'],'backing-up')
            self.assertEqual(self.target.read_text(),'old');raise OSError('backup unavailable')
        with patch.object(U.i,'put',side_effect=fail),self.assertRaises(OSError):self.call('apply')
        self.assertEqual(self.call('rollback')['phase'],'rolled-back-disabled')
    def test_disabled_shadow_then_activation_no_false_qa_ready_and_no_rollback_after_call(self):
        self.call('apply');out=self.call('activate');self.assertFalse(out['qa_ready'])
        self.u.probe.assert_called_once()
        self.assertEqual(json.loads(self.policy.read_text())['mode'],'active')
        self.assertEqual(self.call('activate')['phase'],'active-canary')
        self.u.probe.assert_called_once()
        with self.assertRaises(core.Refused):self.call('rollback')
    def test_foreign_target_or_history_drift_blocks_rollback(self):
        self.call('apply');self.target.write_text('foreign')
        with self.assertRaises(core.Refused):self.call('rollback')
        self.target.write_text('new');self.snapshot['fac7']='changed'
        with self.assertRaises(core.Refused):self.call('rollback')

class RoleTransition(unittest.TestCase):
    def test_new_role_same_sha_gets_new_generation_preserves_previous_operation_and_budget(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);mp=root/'marker';lp=root/'ledger';sp=root/'slot2.json';pp=root/'policy'
            g=grant();qa=g|dict(role='independent_qa',input_path='scripts/chatops/tests/fixtures/agy-reviewed-tests.json',input_sha256='f'*64)
            slot=dict(generation=88,pending=None,operations={'old':{'result':{'analysis_complete':True,'qualification_passed':False}}})
            oldmarker=dict(phase='canary',qualification=U.descriptor(g))
            ledger=dict(schema=Q.ADDRESSED_SCHEMA,lineage=Q.ADDRESSED_LINEAGE,ceiling=4,used_calls=1,
                grants={core.digest(g):dict(grant=g,operation='1'*64)})
            for path,value in ((mp,oldmarker),(lp,ledger),(sp,slot),(pp,dict(mode='disabled',controller_sha=g['controller_revision']))):
                path.write_text(json.dumps(value,sort_keys=True))
            newledger=copy.deepcopy(ledger);newledger['grants'][core.digest(qa)]=dict(grant=qa,operation=None)
            q=U.descriptor(qa);newmarker=dict(oldmarker,phase='canary',qualification=q,canary_task_sha256=q['task_sha256'])
            newslot=dict(slot,generation=89)
            p=proof();p['grant']=qa;p['changes']={str(t):dict(before=U.i.sha(t),after=hashlib.sha256(U.encoded(v)).hexdigest())
                for t,v in ((mp,newmarker),(lp,newledger),(sp,newslot))}
            written=[]
            def atomic(path,value,**kw):written.append(path);path.write_text(json.dumps(value,sort_keys=True))
            def read(path,*a):return json.loads(path.read_text())
            with patch.multiple(U,STATE=root,MARKER=mp,LEDGER=lp),patch.object(U.r,'POLICY',pp), \
                 patch.object(U.r,'read',side_effect=read),patch.object(U.r,'journal',side_effect=lambda s:read(sp)), \
                 patch.object(U.r,'atomic',side_effect=atomic),patch.object(U,'history'), \
                 patch.object(Q,'addressed_input',return_value='exact QA test contract'), \
                 patch.object(U,'preserved',side_effect=lambda *a:{str(sp):U.i.sha(sp)}):
                out=U.admit(p,dict(controller=g['controller_revision'],changes={}),SimpleNamespace(quiet=Mock()),None)
                self.assertEqual(out['phase'],'admitted-disabled')
                self.assertEqual(read(sp)['generation'],89);self.assertEqual(read(sp)['operations'],slot['operations'])
                self.assertEqual(read(lp)['used_calls'],1);self.assertEqual(read(lp)['grants'][core.digest(g)],ledger['grants'][core.digest(g)])
                count=len(written)
                self.assertEqual(U.admit(p,dict(controller=g['controller_revision'],changes={}),SimpleNamespace(quiet=Mock()),None)['phase'],'already-admitted')
                self.assertEqual(len(written),count)

class InstallerInputIdentity(unittest.TestCase):
    def setUp(self):
        import native_antigravity as N
        self.N=N;self.uid=os.geteuid();self.tmp=tempfile.TemporaryDirectory(dir=os.environ.get('JOB'))
        self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.work=self.root/'canary'
        self.work.mkdir();self.env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8',
            'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_TERMINAL_PROMPT':'0'}
        def git(*args):
            return subprocess.run(['/usr/bin/git',*args],cwd=self.work,env=self.env,
                                  capture_output=True,check=True).stdout
        git('init','-q');path=self.work/Q.ANALYSIS_INPUT;path.parent.mkdir(parents=True)
        path.write_bytes((ROOT/Q.ANALYSIS_INPUT).read_bytes());git('add','.')
        git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','immutable input')
        self.g=grant()|dict(head=git('rev-parse','HEAD').decode().strip())
        self.g['input_revision']=self.g['head'];self.git=git
        self.patches=[patch.object(N,'QUALIFICATION_WORK',self.work)]
        for p in self.patches:p.start();self.addCleanup(p.stop)
    def test_real_runtime_git_and_differing_owner_negative(self):
        self.assertEqual(Q.addressed_input(self.work,self.g),(ROOT/Q.ANALYSIS_INPUT).read_text())
        result=subprocess.run(['/usr/bin/git','rev-parse','HEAD'],cwd=self.work,
            env=self.env|{'GIT_TEST_ASSUME_DIFFERENT_OWNER':'1'},capture_output=True)
        self.assertEqual(result.returncode,128);self.assertIn(b'dubious ownership',result.stderr)
    def test_closed_git_syscall_identity_and_real_input_without_privilege(self):
        # Exercise real Git as our actual identity. Root/setgroups/setuid cannot be
        # exercised by this unprivileged session; the separate root test covers it.
        calls=[];run=subprocess.run
        def child(argv,**kw):
            self.assertEqual(kw['user'],978);self.assertGreater(kw['group'],0);self.assertEqual(kw['extra_groups'],[])
            self.assertEqual(set(kw['env']),{'PATH','HOME','LANG','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL','GIT_TERMINAL_PROMPT'})
            calls.append(argv)
            for key in ('user','group','extra_groups'):kw.pop(key)
            return run(argv,**kw)
        with patch.object(self.N,'addressed_git_identity',return_value=dict(user=978,group=968,extra_groups=[])), \
             patch.object(self.N.subprocess,'run',side_effect=child):
            self.assertEqual(Q.addressed_input(self.work,self.g,installer=True),(ROOT/Q.ANALYSIS_INPUT).read_text())
        self.assertEqual(len(calls),2)
        self.assertEqual(calls[0][-2:],['rev-parse','HEAD'])
        self.assertEqual(calls[1][-2:],['show',self.g['head']+':'+Q.ANALYSIS_INPUT])
    def test_external_dry_apply_and_admit_use_closed_installer_git_boundary(self):
        state=self.root/'state';state.mkdir();policy=self.root/'policy';pp=self.root/'proof'
        target=self.root/'target';target.write_text('old');source=self.root/'source';source.write_text('new')
        p=proof();p['grant']=self.g
        p['changes']={str(target):dict(before=U.i.sha(target),after=U.i.sha(source))}
        pp.write_text(json.dumps(p));sha=U.i.sha(pp)
        policy.write_text(json.dumps(dict(mode='disabled',controller_sha=Q.INSTALLED_BASELINE,recovery={})))
        (state/'backup.json').write_text(json.dumps({'after':{}}))
        p['baseline_record_sha256']=U.i.sha(state/'backup.json');pp.write_text(json.dumps(p));sha=U.i.sha(pp)
        (state/'slot2.json').write_text(json.dumps({'pending':None}))
        (state/Q.ADDRESSED_RECONCILIATION).write_text(json.dumps(dict(phase='complete',third_operation_sha256=Q.THIRD_DIGEST)))
        C=SimpleNamespace(quiet=Mock(),sync_directory=Mock())
        T=SimpleNamespace(helpers=lambda b:(C,None),verify_release=Mock(),protocol_probe=Mock())
        run=subprocess.run;calls=[]
        def child(argv,**kw):
            self.assertEqual((kw.pop('user'),kw.pop('extra_groups')),(978,[]));kw.pop('group')
            calls.append(argv);return run(argv,**kw)
        def call(action):return U.execute(action,self.work,pp,sha)
        with patch.multiple(U,STATE=state,JOURNAL=state/'upgrade',BACKUP=state/'backup',ALLOWED={target}), \
             patch.multiple(U.r,STATE=state,POLICY=policy),patch.object(U.os,'geteuid',return_value=0), \
             patch.object(U.r,'trusted_tree'),patch.object(U,'load_reviewed'),patch.object(U,'team',return_value=T), \
             patch.object(U,'validate'),patch.object(U,'history'),patch.object(U,'configuration',return_value={}), \
             patch.object(U,'preserved',return_value={}),patch.object(U.i,'payload',return_value={target:source}), \
             patch.object(U.i,'put',side_effect=lambda s,t,*a:Path(t).write_bytes(Path(s).read_bytes())), \
             patch.object(U.r,'read',side_effect=lambda p,*a:core.loads(Path(p).read_bytes())), \
             patch.object(self.N,'addressed_git_identity',return_value=dict(user=978,group=968,extra_groups=[])), \
             patch.object(self.N.subprocess,'run',side_effect=child):
            self.assertTrue(call('dry')['dry']);self.assertEqual(len(calls),2)
            self.assertEqual(call('apply')['phase'],'installed-disabled');self.assertEqual(len(calls),4)
            admit=state/('antigravity-addressed-admit-'+core.digest(self.g)+'.json')
            admit.write_text(json.dumps(dict(grant=self.g,proof_sha256=core.digest(p),phase='complete')))
            self.assertEqual(call('admit')['phase'],'already-admitted');self.assertEqual(len(calls),6)
            before={f:f.read_bytes() for f in state.iterdir() if f.is_file()}
            # Incorrect HEAD, input hash, and identity failure all precede metadata writes.
            for change in (dict(head='f'*40,input_revision='f'*40),dict(input_sha256='f'*64)):
                p['grant']=self.g|change;pp.write_text(json.dumps(p));sha=U.i.sha(pp)
                with self.assertRaises((core.Refused,self.N.ReviewError)):call('admit')
            self.assertEqual(before,{f:f.read_bytes() for f in before})

    def test_fixed_identity_path_metadata_and_identity_failure_refuse(self):
        with self.assertRaises(self.N.ReviewError):self.N.addressed_git_identity(self.work.parent)
        real=Path.lstat
        def trusted_stat(path):
            info=real(path)
            # Only simulate ancestor metadata of the disposable fixture. The Git
            # tree inode types, permissions and all symlink checks remain real.
            owner=978 if path==self.work or self.work in path.parents else 0
            mode=info.st_mode & ~0o022 if path in self.work.parents else info.st_mode
            return SimpleNamespace(st_uid=owner,st_mode=mode)
        with patch.object(self.N.os,'geteuid',return_value=0),patch.object(Path,'lstat',trusted_stat):
            identity=self.N.addressed_git_identity(self.work);self.assertEqual(identity['user'],978)
            def foreign_owner(path):
                info=trusted_stat(path)
                return SimpleNamespace(st_uid=1234,st_mode=info.st_mode) if path==self.work else info
            with patch.object(Path,'lstat',foreign_owner),self.assertRaises(self.N.ReviewError):
                self.N.addressed_git_identity(self.work)
            for kind in ('symlink','redirect','writable','worktree','identity'):
                with self.subTest(kind=kind):
                    link=self.work/'.git/objects/foreign'
                    config=self.work/'.git/commondir'
                    if kind=='symlink':link.symlink_to(self.root)
                    if kind=='redirect':config.write_text(str(self.root))
                    if kind=='writable':(self.work/'.git/HEAD').chmod(0o666)
                    if kind=='worktree':
                        (self.work/'.git').rename(self.work/'saved-metadata')
                        (self.work/'.git').write_text('gitdir: '+str(self.work/'saved-metadata'))
                    try:
                        with self.assertRaises((self.N.ReviewError,OSError)):
                            if kind=='identity':
                                with patch.object(self.N.subprocess,'run',side_effect=PermissionError('setuid denied')):
                                    Q.addressed_input(self.work,self.g,installer=True)
                            else:self.N.addressed_git_identity(self.work)
                    finally:
                        if kind=='symlink':link.unlink()
                        if kind=='redirect':config.unlink()
                        if kind=='writable':(self.work/'.git/HEAD').chmod(0o644)
                        if kind=='worktree':
                            (self.work/'.git').unlink();(self.work/'saved-metadata').rename(self.work/'.git')
    @unittest.skipUnless(os.geteuid()==0,'NOT_TESTED: requires protected root/UID978 fixture')
    def test_actual_root_parent_git_child_and_runtime_same_uid978_checkout(self):
        # A standalone fixture only; never changes real canary ownership.
        import pwd
        account=pwd.getpwuid(978)
        for p in (self.work,*self.work.rglob('*')):os.chown(p,978,account.pw_gid)
        self.root.chmod(0o755)
        # All fixture ancestors must already be traversable by the executor.
        before=os.getresuid();run=subprocess.run;children=[]
        def child(argv,**kw):
            uid=run(['/usr/bin/id','-u'],**{k:v for k,v in kw.items() if k!='timeout'},timeout=10)
            self.assertEqual(uid.stdout.strip(),b'978');children.append(uid.stdout)
            return run(argv,**kw)
        real=Path.lstat
        def fixture_ancestry(path):
            info=real(path)
            # /tmp is intentionally forbidden for the real canary. Only this
            # disposable fixture's ancestors model its protected production path.
            return SimpleNamespace(st_uid=0,st_mode=info.st_mode & ~0o022) if path in self.work.parents else info
        with patch.object(self.N.subprocess,'run',side_effect=child),patch.object(Path,'lstat',fixture_ancestry):
            self.assertEqual(Q.addressed_input(self.work,self.g,installer=True),(ROOT/Q.ANALYSIS_INPUT).read_text())
        self.assertEqual(os.getresuid(),before);self.assertEqual(len(children),2)
        result=run(['/usr/bin/git','rev-parse','HEAD'],cwd=self.work,env=self.env,
                   user=978,group=account.pw_gid,extra_groups=[],capture_output=True,check=True)
        self.assertEqual(result.stdout.decode().strip(),self.g['head'])


class ReconcileEntrypoint(unittest.TestCase):
    """Real outer history/WAL/atomic writes, simulated host metadata and quiescence."""
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.slot=self.root/'slot2.json';self.pp=self.root/'proof'
        self.before=dict(pending=Q.THIRD_OPERATION,generation=87,operations={'immutable':{'status':'unknown'}},
                         last={'status':'unknown'},deferred=[{'issue':29}],stage_counts={'qa':3})
        self.slot.write_text(json.dumps(self.before,sort_keys=True))
        self.policy=self.root/'policy';self.policy.write_text(json.dumps(dict(mode='disabled',controller_sha=Q.INSTALLED_BASELINE)))
        self.budget=self.root/'budget';self.budget.write_text('{"unchanged": true}')
        self.p=proof()
        for name in self.p['history']:
            path=self.root/name
            if path!=self.slot:path.write_text('{"historical": "spent"}')
        self.p['history']={n:U.i.sha(self.root/n) for n in self.p['history']}
        self.pp.write_text(json.dumps(self.p));self.proof_raw=self.pp.read_bytes()
        self.sha=U.i.sha(self.pp);self.atomic=U.r.atomic;self.writes=[]
        def atomic(path,value,**kw):
            self.atomic(path,value,**kw);self.writes.append((path,copy.deepcopy(value)))
        self.write=atomic
        self.checkpoint={'active':None,'history':'unchanged'}
        self.identity=Mock(return_value=None);self.alive=Mock(return_value=False)
        self.free=Mock();self.units=Mock();self.quiet=Mock()
        self.patches=[patch.multiple(U,STATE=self.root),
            patch.multiple(U.r,STATE=self.root,POLICY=self.policy,BUDGET=self.budget),
            patch.object(U.os,'geteuid',return_value=0),patch.object(U.r,'trusted_tree'),
            patch.object(U.r,'read',side_effect=lambda path,*a:core.loads(Path(path).read_bytes())),
            patch.object(U.r,'atomic',side_effect=atomic),patch.object(U,'load_reviewed'),
            patch.object(U,'team',return_value=SimpleNamespace(helpers=lambda b:(None,None))),
            patch.object(Q,'addressed_history'),patch.object(Q,'executor_quiet',self.quiet),
            patch.object(Q,'BUDGET_RAW',U.i.sha(self.budget)),
            patch.object(U.r,'checkpoint',side_effect=lambda s:(self.checkpoint,[])),
            patch.object(Q,'CHECKPOINT',core.digest(self.checkpoint)),
            patch.object(U.r,'identity',self.identity),patch.object(U.r,'alive',self.alive),
            patch.object(U.r,'free_lock',self.free),patch.object(U.r,'units_quiet',self.units)]
        for p in self.patches:p.start();self.addCleanup(p.stop)
    def call(self):return U.execute('reconcile',self.root,self.pp,self.sha)
    def read(self,path):return core.loads(path.read_bytes())
    def interrupt(self,boundary):
        def atomic(path,value,**kw):
            self.write(path,value,**kw)
            phase='slot' if path==self.slot else value.get('phase')
            if phase==boundary:raise OSError('lost after durable '+boundary)
        with patch.object(U.r,'atomic',side_effect=atomic),self.assertRaises(OSError):self.call()
    def finish(self):
        out=self.call();self.assertEqual(out['phase'],'complete')
        self.assertEqual(self.read(self.slot),dict(self.before,pending=None,generation=88))
        self.assertEqual(self.pp.read_bytes(),self.proof_raw)
        count=len(self.writes);snapshot={p:p.read_bytes() for p in self.root.iterdir() if p.is_file()}
        self.assertEqual(self.call(),out);self.assertEqual(len(self.writes),count)
        self.assertEqual(snapshot,{p:p.read_bytes() for p in snapshot})
        self.assertEqual(sum(p==self.slot for p,v in self.writes),1)
    def test_resume_after_durable_intent(self):self.interrupt('intent');self.finish()
    def test_resume_after_durable_generation88(self):self.interrupt('slot');self.finish()
    def test_repeat_after_durable_complete(self):self.interrupt('complete');self.finish()
    def test_after_state_without_wal_refused(self):
        self.slot.write_text(json.dumps(dict(self.before,pending=None,generation=88),sort_keys=True))
        with self.assertRaises(core.Refused):self.call()
        self.assertEqual(self.writes,[])
    def test_exact_slot_and_all_history_pins_remain_mandatory(self):
        self.interrupt('slot');raw=self.slot.read_bytes();count=len(self.writes)
        for field,value in (('operations',{'changed':True}),('last',{}),('deferred',[]),('stage_counts',{}),
                            ('pending',Q.THIRD_OPERATION),('generation',89)):
            with self.subTest(field=field):
                self.slot.write_text(json.dumps(dict(self.read(self.slot),**{field:value}),sort_keys=True))
                with self.assertRaises(core.Refused):self.call()
                self.slot.write_bytes(raw)
        for path in (self.budget,self.root/Q.GRANT_LEDGER,self.root/Q.LINEAGE):
            original=path.read_bytes();path.write_bytes(original+b' ')
            with self.subTest(path=path),self.assertRaises(core.Refused):self.call()
            path.write_bytes(original)
        self.assertEqual(len(self.writes),count)
    def test_foreign_proof_or_receipt_schema_hash_phase_refused(self):
        self.interrupt('slot');rp=self.root/Q.ADDRESSED_RECONCILIATION;raw=rp.read_bytes();receipt=self.read(rp)
        for change in (dict(schema=Q.ADDRESSED_SCHEMA),dict(phase='other'),dict(proof_sha256='f'*64),
                       dict(third_operation_sha256='f'*64),dict(checkpoint='f'*64),dict(generation_before=True),
                       dict(slot_before_sha256='f'*64),dict(slot_after_sha256='f'*64),dict(slot_before_raw='{}')):
            rp.write_text(json.dumps(receipt|change))
            with self.subTest(change=change),self.assertRaises(core.Refused):self.call()
            rp.write_bytes(raw)
        self.pp.write_bytes(self.proof_raw+b' ');self.sha=U.i.sha(self.pp)
        with self.assertRaises(core.Refused):self.call()
    def test_resume_rechecks_host_and_disabled_boundary(self):
        self.interrupt('slot');count=len(self.writes)
        for kind in ('live','reused','unknown','checkpoint','lease','executor','policy'):
            with self.subTest(kind=kind):
                with __import__('contextlib').ExitStack() as stack:
                    if kind=='live':stack.enter_context(patch.object(U.r,'alive',return_value=True))
                    if kind=='reused':stack.enter_context(patch.object(U.r,'identity',return_value=dict(Q.THIRD_PROCESS,start='reused')))
                    if kind=='unknown':stack.enter_context(patch.object(Q.Path,'exists',return_value=True))
                    if kind=='checkpoint':stack.enter_context(patch.object(U.r,'checkpoint',return_value=({'active':True},[])))
                    if kind=='lease':stack.enter_context(patch.object(U.r,'free_lock',side_effect=core.Refused('busy')))
                    if kind=='executor':stack.enter_context(patch.object(Q,'executor_quiet',side_effect=core.Refused('live')))
                    if kind=='policy':self.policy.write_text(json.dumps(dict(mode='active',controller_sha=Q.INSTALLED_BASELINE)))
                    with self.assertRaises(core.Refused):self.call()
                self.policy.write_text(json.dumps(dict(mode='disabled',controller_sha=Q.INSTALLED_BASELINE)))
        self.assertEqual(len(self.writes),count)
    def test_reconcile_exception_does_not_relax_other_history_callers(self):
        self.call()
        with self.assertRaises(core.Refused):U.history(self.p)


class Bootstrap(unittest.TestCase):
    def test_corrected_helper_bootstraps_without_installed_addressed_adapter(self):
        import subprocess
        script=r'''
import sys,json,hashlib,importlib.util,types
from pathlib import Path
root=Path(sys.argv[1]);sys.path.insert(0,str(root/'scripts/chatops/actions_train'))
import receiver
receiver.trusted_tree=lambda p:None  # Test metadata only; real payload hashes still checked.
sys.modules['antigravity_qa_recovery']=types.ModuleType('old_b51_module_without_addressed_support')
spec=importlib.util.spec_from_file_location('bootstrap_helper',root/'scripts/chatops/ops/antigravity_addressed_upgrade.py')
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
p={k:None for k in u.KEYS}
p.update(schema='GB_AGY_29_ADDRESSED_UPGRADE_V1',owner_comment=6362661117,
    baseline_controller='b51e7c1c18103247606d35a414c82b04f5dd53ee',
    manifest_sha256=hashlib.sha256((root/'scripts/chatops/actions_train/manifest.json').read_bytes()).hexdigest())
u.load_reviewed(root,p)
assert u.Q.ADDRESSED_SCHEMA=='GB_AGY_29_ADDRESSED_CALL_V1'
assert u.Q.reconcile_addressed
assert sys.modules['native_antigravity'].analysis_canonical
print('hash-verified addressed bootstrap from simulated b51: OK')
'''
        result=subprocess.run(['/usr/bin/python3','-I','-B','-c',script,str(ROOT)],capture_output=True,text=True,timeout=30)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('bootstrap from simulated b51: OK',result.stdout)

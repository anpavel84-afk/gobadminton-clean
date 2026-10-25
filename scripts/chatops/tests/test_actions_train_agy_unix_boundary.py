"""Antigravity UID978 boundary: ordinary Unix permissions + no_new_privs, no AppArmor profile.

Owner decision (Issue #29): the special AppArmor profile for Antigravity is abandoned.
Kept: UID978/GID968, no supplementary groups, no capabilities, no_new_privs, not root,
separation of system users, real file permissions on controller state.
WAIVED by the Owner (not verified safety): Antigravity may read other projects'
files/secrets/PROD data on this server. Offline tests only; no model calls.
"""
import hashlib
import inspect
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'actions_train'))
import native_antigravity as N


class UnixBoundarySource(unittest.TestCase):
    def test_apparmor_symbols_and_profile_are_gone(self):
        for name in dir(N):
            self.assertNotIn('apparmor',name.lower(),name)
        source=pathlib.Path(N.__file__).read_text()
        for needle in ('aa_change_onexec','libapparmor','/etc/apparmor.d','gb-agy-runtime','_arm_apparmor_onexec',
                       '_verify_apparmor_precharge','uid978_apparmor_enforce','apparmor_policy_sha256','apparmor_mode'):
            self.assertNotIn(needle,source,needle)
        self.assertNotIn('uid978_read_only_foreign_owned_tree',source)
        self.assertNotIn('_live_executor_write_probe',source)
        self.assertIn('detected_accidental_modification_only',source)
        self.assertIn('978:968:[]:1:0',source)
        ops=pathlib.Path(__file__).resolve().parents[1]/'ops'
        self.assertFalse((ops/'gb_agy_runtime.apparmor').exists())

    def test_boundary_constants_and_command(self):
        self.assertEqual(N.FILESYSTEM_BOUNDARY,'uid978_unix_permissions_nnp')
        self.assertEqual((N.EXECUTOR_UID,N.EXECUTOR_GID),(978,968))
        self.assertEqual(N.READ_TOOLS,frozenset({'view_file','run_command'}))
        self.assertEqual(N.command(45)[0],N.AGY)
        self.assertNotIn('--sandbox',N.command(45))

    def test_invoke_source_order_and_evidence_fields(self):
        src=inspect.getsource(N.invoke)
        self.assertLess(src.index('_verify_executor_boundary()'),src.index('marker=qualification('))
        self.assertLess(src.index('_verify_executor_boundary()'),src.index('try:charge()'))
        self.assertLess(src.index('os.setsid()'),src.index('no_new_privileges()'))
        self.assertIn('no_new_privileges()',src)
        self.assertNotIn('_landlock(',src)
        self.assertIn('filesystem_boundary=FILESYSTEM_BOUNDARY',src)
        self.assertIn('resource.setrlimit(resource.RLIMIT_CORE,(0,0))',src)
        self.assertIn("AGY_CANDIDATE_CHANGED",src)
        self.assertNotIn('native_cli_sandbox',src)

    def test_qualification_runs_executor_boundary_before_credential(self):
        src=inspect.getsource(N.qualification)
        self.assertLess(src.index('_verify_executor_boundary()'),src.index('trusted(AUTH, owner=EXECUTOR_UID)'))

    def test_strict_complete_source_gate_remains(self):
        gate=inspect.getsource(N.analysis_source_gate)
        self.assertIn('READ_TOOLS <= set(evidence[',gate)
        self.assertIn("downgraded=dict(result,completion='INCOMPLETE')",gate)


class ExecutorBoundaryRuntime(unittest.TestCase):
    """Run the real probe child (no mock of subprocess) as the current non-root user shape."""
    def test_probe_script_reports_expected_fields_with_real_nnp(self):
        import os
        if os.geteuid()==0: self.skipTest('root host cannot imitate the non-root probe')
        # Real subprocess: identity differs from 978, so the helper must refuse (fail closed).
        with self.assertRaises(PermissionError):
            N._verify_executor_boundary()


class CandidateIntegrity(unittest.TestCase):
    def setUp(self):
        from test_actions_train_agy_oauth_precharge import synthetic_vendor_preflight
        synthetic_vendor_preflight(self)

    def git(self,cwd,*args):
        subprocess.run(['/usr/bin/git','-c','user.email=t@t','-c','user.name=t',*args],cwd=cwd,check=True,
                       stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

    def make_repo(self,tmp):
        work=pathlib.Path(tmp)/'candidate';work.mkdir()
        self.git(work,'init','-q');(work/'a.txt').write_text('x\n')
        self.git(work,'add','.');self.git(work,'commit','-qm','c')
        return work

    def allow_write(self,path):
        path.chmod(path.stat().st_mode | 0o222)

    def run_invoke(self,work,mutate,transient_dir):
        seen=[]
        def popen(_argv,**kwargs):
            if mutate: mutate()
            return subprocess.Popen(['/usr/bin/python3','-I','-c','import sys;sys.stdin.buffer.read();print("{}")'],**kwargs)
        with patch.object(N,'qualification',return_value={'phase':'canary'}), \
             patch.object(N.os,'geteuid',return_value=978), \
             patch.object(N,'trusted',return_value=b'synthetic-token'), \
             patch.object(N,'AGY','/usr/bin/python3'), \
             patch.object(N,'_verify_executor_boundary',return_value=None), \
             patch('native_guard.no_new_privileges',return_value=None):
            return N.invoke('inert no-model',45,work=work,slot='slot2',task_hash='0'*64,
                            charge=lambda:seen.append('charged'),popen=popen,analysis=True,
                            evidence_dir=pathlib.Path(transient_dir)),seen

    def test_state_changes_are_detected_by_candidate_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            work=self.make_repo(tmp)
            before=N._candidate_state(work)
            self.assertEqual(before[1],'')
            (work/'new.txt').write_text('y')
            self.assertNotEqual(N._candidate_state(work),before)
            (work/'new.txt').unlink();(work/'a.txt').write_text('changed')
            self.assertNotEqual(N._candidate_state(work),before)
            (work/'a.txt').write_text('x\n')
            self.assertEqual(N._candidate_state(work),before)
            self.git(work,'commit','--allow-empty','-qm','moved')
            self.assertNotEqual(N._candidate_state(work),before)

    def test_modified_checkout_rejected_after_call(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as ev:
            work=self.make_repo(tmp)
            with self.assertRaises(N.ReviewError) as err:
                self.run_invoke(work,lambda:(self.allow_write(work),(work/'tampered.txt').write_text('model wrote')),ev)
            self.assertEqual(err.exception.code,'AGY_CANDIDATE_CHANGED')

    def test_dirty_checkout_refused_before_charge(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as ev:
            work=self.make_repo(tmp);(work/'dirty.txt').write_text('x')
            charged=[]
            with patch.object(N,'qualification',return_value={'phase':'canary'}), \
                 patch.object(N.os,'geteuid',return_value=978), \
                 patch.object(N,'trusted',return_value=b'synthetic-token'), \
                 patch.object(N,'_verify_executor_boundary',return_value=None):
                with self.assertRaises(N.ReviewError) as err:
                    N.invoke('inert',45,work=work,slot='slot2',task_hash='0'*64,
                             charge=lambda:charged.append(1),evidence_dir=pathlib.Path(ev),analysis=True)
            self.assertEqual(err.exception.code,'AGY_CANDIDATE_CHANGED')
            self.assertEqual(err.exception.phase,'preflight')
            self.assertEqual(charged,[])

    def test_unchanged_checkout_records_boundary_and_state(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as ev:
            work=self.make_repo(tmp)
            (raw,receipt),seen=self.run_invoke(work,None,ev)
            self.assertEqual(seen,['charged'])
            self.assertEqual(receipt['filesystem_boundary'],'uid978_unix_permissions_nnp')
            self.assertEqual(receipt['candidate_integrity'],'detected_accidental_modification_only')
            self.assertEqual(receipt['write_guard'],N.WRITE_GUARD)
            self.assertNotIn('candidate_access',receipt)
            self.assertNotIn('uid978_read_only_foreign_owned_tree',json.dumps(receipt))
            self.assertIn('malicious same-uid',receipt['residual_risk'])
            self.assertIn('guard, not a boundary',receipt['residual_risk'])
            self.assertNotIn('apparmor_profile',receipt)
            self.assertNotIn('readonly_roots',receipt)
            self.assertNotIn('writable_roots',receipt)
            self.assertIs(receipt['filesystem_roots_enforced'],False)
            self.assertIn('not verified safety',receipt['owner_waiver'])
            self.assertEqual(receipt['executor_uid'],978)

    def test_snapshot_is_idempotent_on_a_clean_checkout(self):
        with tempfile.TemporaryDirectory() as tmp:
            work=self.make_repo(tmp)
            self.assertEqual(N._candidate_state(work),N._candidate_state(work))
            self.assertEqual(N._candidate_state(work)[1],'')

    def assert_invoke_rejects(self,work,mutate,ev):
        with self.assertRaises(N.ReviewError) as err:
            self.run_invoke(work,mutate,ev)
        self.assertEqual(err.exception.code,'AGY_CANDIDATE_CHANGED')
        self.assertEqual(N.CANDIDATE_INTEGRITY,'detected_accidental_modification_only')
        return err

    def test_each_status_bypass_is_candidate_changed(self):
        """Porcelain stays empty. Mutation during invoke is AGY_CANDIDATE_CHANGED."""
        def porcelain(work):
            return subprocess.check_output(['/usr/bin/git','-C',str(work),'status','--porcelain'])

        def skip(work):
            self.git(work,'update-index','--skip-worktree','a.txt')
            self.allow_write(work/'a.txt')
            (work/'a.txt').write_text('tampered\n')

        def assume(work):
            self.git(work,'update-index','--assume-unchanged','a.txt')
            self.allow_write(work/'a.txt')
            (work/'a.txt').write_text('tampered\n')

        def exclude(work):
            path=work/'.git'/'info'/'exclude'
            path.write_text(path.read_text()+'*.hidden\n')
            self.allow_write(work)
            (work/'secret.hidden').write_text('hidden\n')

        def prepare_ignored(work):
            (work/'.gitignore').write_text('*.secret\n')
            self.git(work,'add','.gitignore')
            self.git(work,'commit','-qm','ignore')

        def ignored(work):
            self.allow_write(work)
            (work/'token.secret').write_text('secret\n')

        def config(work):
            self.git(work,'config','advice.detachedHead','false')

        def hooks(work):
            (work/'.git'/'hooks'/'post-checkout').write_text('#!/bin/sh\n')

        def fsmonitor(work):
            self.git(work,'config','core.fsmonitor','true')

        def alternates(work):
            alt=work.parent/'alt-objects'
            alt.mkdir(exist_ok=True)
            info=work/'.git'/'objects'/'info'
            info.mkdir(parents=True,exist_ok=True)
            (info/'alternates').write_text(str(alt)+'\n')

        def prepare_worktree(work):
            linked=work.parent/'linked'
            self.git(work,'worktree','add','--detach',str(linked),'HEAD')
            return linked

        def worktree_config(linked):
            gitdir=pathlib.Path((linked/'.git').read_text().split(':',1)[1].strip())
            (gitdir/'config.worktree').write_text('[core]\n\tfsmonitor = true\n')

        cases=(
            ('skip-worktree',lambda work:None,skip,lambda work:work),
            ('assume-unchanged',lambda work:None,assume,lambda work:work),
            ('info-exclude',lambda work:None,exclude,lambda work:work),
            ('ignored-file',prepare_ignored,ignored,lambda work:work),
            ('git-config',lambda work:None,config,lambda work:work),
            ('hooks',lambda work:None,hooks,lambda work:work),
            ('core-fsmonitor',lambda work:None,fsmonitor,lambda work:work),
            ('alternates',lambda work:None,alternates,lambda work:work),
            ('worktree-config',prepare_worktree,worktree_config,lambda work:work.parent/'linked'),
        )
        for name,prepare,mutate,select in cases:
            with self.subTest(name=name):
                with tempfile.TemporaryDirectory() as tmp:
                    work=self.make_repo(tmp)
                    prepare(work)
                    target=select(work)
                    before=N._candidate_state(target)
                    self.assertEqual(before[1],'',name)
                    mutate(target)
                    self.assertEqual(porcelain(target),b'',name)
                    self.assertNotEqual(N._candidate_state(target),before,name)
                with tempfile.TemporaryDirectory() as tmp,tempfile.TemporaryDirectory() as ev:
                    work=self.make_repo(tmp)
                    prepare(work)
                    target=select(work)
                    self.assert_invoke_rejects(target,lambda:mutate(target),ev)

    def test_review_dirty_and_skip_worktree_before_charge(self):
        """Production review() must not collapse these into AGY_PRECHECK_FAILED."""
        with tempfile.TemporaryDirectory() as tmp,tempfile.TemporaryDirectory() as ev:
            work=self.make_repo(tmp)
            head=subprocess.check_output(['/usr/bin/git','-C',str(work),'rev-parse','HEAD'],text=True).strip()
            (work/'dirty.txt').write_text('x\n')
            charged=[]
            with self.assertRaises(N.ReviewError) as err:
                N.review(work,head,head,'task',45,slot='slot2',task_hash='0'*64,
                         charge=lambda:charged.append(1),evidence_dir=pathlib.Path(ev)/'evidence')
            self.assertEqual(err.exception.code,'AGY_CANDIDATE_CHANGED')
            self.assertEqual(err.exception.phase,'preflight')
            self.assertEqual(charged,[])
        with tempfile.TemporaryDirectory() as tmp,tempfile.TemporaryDirectory() as ev:
            work=self.make_repo(tmp)
            head=subprocess.check_output(['/usr/bin/git','-C',str(work),'rev-parse','HEAD'],text=True).strip()
            self.git(work,'update-index','--skip-worktree','a.txt')
            (work/'a.txt').write_text('tampered\n')
            self.assertEqual(subprocess.check_output(['/usr/bin/git','-C',str(work),'status','--porcelain']),b'')
            charged=[]
            with self.assertRaises(N.ReviewError) as err:
                N.review(work,head,head,'task',45,slot='slot2',task_hash='0'*64,
                         charge=lambda:charged.append(1),evidence_dir=pathlib.Path(ev)/'evidence')
            self.assertEqual(err.exception.code,'AGY_CANDIDATE_CHANGED')
            self.assertEqual(err.exception.phase,'preflight')
            self.assertEqual(charged,[])

    def test_nonzero_exit_loses_to_checkout_integrity(self):
        """Checkout is checked first. Both facts stay on the error evidence."""
        source=inspect.getsource(N.invoke)
        self.assertLess(source.index("raise ReviewError('AGY_CANDIDATE_CHANGED','output',ev.id)"),
                        source.index("raise ReviewError('AGY_EXIT_NONZERO','output',ev.id)"))
        with tempfile.TemporaryDirectory() as tmp,tempfile.TemporaryDirectory() as ev:
            work=self.make_repo(tmp)

            def popen_exit(code,mutate=None):
                def popen(_argv,**kwargs):
                    if mutate:mutate()
                    script='import sys;sys.stdin.buffer.read();raise SystemExit(%d)'%code
                    return subprocess.Popen(['/usr/bin/python3','-I','-c',script],**kwargs)
                return popen

            with patch.object(N,'qualification',return_value={'phase':'canary'}), \
                 patch.object(N.os,'geteuid',return_value=978), \
                 patch.object(N,'trusted',return_value=b'synthetic-token'), \
                 patch.object(N,'AGY','/usr/bin/python3'), \
                 patch.object(N,'_verify_executor_boundary',return_value=None), \
                 patch('native_guard.no_new_privileges',return_value=None):
                with self.assertRaises(N.ReviewError) as clean_err:
                    N.invoke('inert',45,work=work,slot='slot2',task_hash='0'*64,charge=lambda:None,
                             popen=popen_exit(3),analysis=True,evidence_dir=pathlib.Path(ev)/'clean')
                self.assertEqual(clean_err.exception.code,'AGY_EXIT_NONZERO')
                with self.assertRaises(N.ReviewError) as both:
                    N.invoke('inert',45,work=work,slot='slot2',task_hash='0'*64,charge=lambda:None,
                             popen=popen_exit(3,lambda:(self.allow_write(work/'a.txt'),(work/'a.txt').write_text('tampered\n'))),
                             analysis=True,evidence_dir=pathlib.Path(ev)/'both')
            self.assertEqual(both.exception.code,'AGY_CANDIDATE_CHANGED')
            meta=json.loads(sorted((pathlib.Path(ev)/'both'/both.exception.evidence_id).glob('phase-*.json'))[-1].read_text())
            self.assertEqual(meta['error_code'],'AGY_CANDIDATE_CHANGED')
            self.assertEqual(meta['concurrent_exit_code'],3)
            self.assertEqual(meta['exit_code'],3)

    def test_n1_write_during_git_reads_is_not_a_clean_snapshot(self):
        """A write after the file fd would have closed, during git, stays visible."""
        with tempfile.TemporaryDirectory() as tmp,tempfile.TemporaryDirectory() as ev:
            work=self.make_repo(tmp)
            head=subprocess.check_output(['/usr/bin/git','-C',str(work),'rev-parse','HEAD'],text=True).strip()
            original=N._read_only_git
            def raced(repo,*args):
                if args[:2]==('rev-parse','--show-object-format'):
                    target=pathlib.Path(repo)/'a.txt'
                    self.allow_write(target)
                    target.write_text('raced-bytes\n')
                return original(repo,*args)
            with patch.object(N,'_read_only_git',side_effect=raced):
                state=N._candidate_state(work)
            self.assertNotEqual(state[1],'')
            self.assertNotIn(state[1],('',))
            charged=[]
            with patch.object(N,'_read_only_git',side_effect=raced):
                with self.assertRaises(N.ReviewError) as err:
                    N.review(work,head,head,'task',45,slot='slot2',task_hash='0'*64,
                             charge=lambda:charged.append(1),evidence_dir=pathlib.Path(ev)/'evidence')
            self.assertEqual(err.exception.code,'AGY_CANDIDATE_CHANGED')
            self.assertEqual(charged,[])
            self.assertNotEqual((work/'a.txt').read_text(),'x\n')

    def test_n2_include_path_and_hooks_symlink_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            work=self.make_repo(tmp)
            included=pathlib.Path(tmp)/'included-config'
            included.write_text('[core]\n\tlogAllRefUpdates = true\n')
            self.git(work,'config','include.path',str(included))
            before=N._candidate_state(work)
            self.assertEqual(before[1],'')
            included.write_text('[core]\n\tlogAllRefUpdates = false\n')
            self.assertNotEqual(N._candidate_state(work),before)
            (work/'a.txt').write_text('x\n')
        with tempfile.TemporaryDirectory() as tmp,tempfile.TemporaryDirectory() as ev:
            work=self.make_repo(tmp)
            hook_dir=pathlib.Path(tmp)/'real-hooks'
            hook_dir.mkdir()
            hooks=work/'.git'/'hooks'
            for child in list(hooks.iterdir()):
                child.rename(hook_dir/child.name)
            hooks.rmdir()
            hooks.symlink_to(hook_dir)
            before=N._candidate_state(work)
            self.assertEqual(before[1],'')

            def plant():
                (hook_dir/'post-checkout').write_text('#!/bin/sh\n')

            plant()
            self.assertNotEqual(N._candidate_state(work),before)
            (hook_dir/'post-checkout').unlink()
            self.assert_invoke_rejects(work,plant,ev)

    def test_n3_dirty_index_with_clean_or_mixed_worktree(self):
        with tempfile.TemporaryDirectory() as tmp,tempfile.TemporaryDirectory() as ev:
            work=self.make_repo(tmp)
            (work/'a.txt').write_text('staged\n')
            self.git(work,'add','a.txt')
            self.git(work,'checkout','--','a.txt')
            status=subprocess.check_output(['/usr/bin/git','-C',str(work),'status','--porcelain'])
            self.assertTrue(status.startswith(b'M '),status)
            state=N._candidate_state(work)
            self.assertIn('index-diff',state[1])
            self.assert_invoke_rejects(work,None,ev)
        with tempfile.TemporaryDirectory() as tmp:
            work=self.make_repo(tmp)
            (work/'a.txt').write_text('staged\n')
            self.git(work,'add','a.txt')
            (work/'a.txt').write_text('staged\nand worktree\n')
            status=subprocess.check_output(['/usr/bin/git','-C',str(work),'status','--porcelain'])
            self.assertIn(b'MM',status)
            self.assertNotEqual(N._candidate_state(work)[1],'')

    def test_n4_empty_directory_and_mode_0600(self):
        with tempfile.TemporaryDirectory() as tmp:
            work=self.make_repo(tmp)
            before=N._candidate_state(work)
            (work/'empty').mkdir()
            changed=N._candidate_state(work)
            self.assertIn('directories',changed[1])
            self.assertNotEqual(changed,before)
            (work/'empty').rmdir()
            os.chmod(work/'a.txt',0o600)
            mode_state=N._candidate_state(work)
            # 0600 is a legal slot-checkout mode, so it is not a dirty tree.
            # The binding still changes, which is what a before/after check sees.
            self.assertEqual(mode_state[1],'')
            self.assertNotEqual(mode_state,before)

    def test_include_tilde_hooks_path_worktree_and_symlink_commondir(self):
        """The old write predicate missed these. The snapshot must not."""
        home_include=pathlib.Path.home()/('.agy-qa-include-%d.gitconfig'%os.getpid())
        try:
            home_include.write_text('[core]\n\tlogAllRefUpdates = true\n')
            with tempfile.TemporaryDirectory() as tmp:
                work=self.make_repo(tmp)
                self.git(work,'config','include.path','~/'+home_include.name)
                before=N._candidate_state(work)
                self.assertEqual(before[1],'')
                home_include.write_text('[core]\n\tlogAllRefUpdates = false\n')
                self.assertNotEqual(N._candidate_state(work),before)
                home_include.write_text('[core]\n\tlogAllRefUpdates = true\n')
                self.git(work,'config','--unset','include.path')
                before=N._candidate_state(work)
                self.git(work,'config','core.worktree',str(work))
                moved=N._candidate_state(work)
                self.assertEqual(moved[1],'')
                self.assertNotEqual(moved,before)
                self.git(work,'config','--unset','core.worktree')
                hooks=pathlib.Path(tmp)/'external-hooks'
                hooks.mkdir()
                self.git(work,'config','core.hooksPath',str(hooks))
                before=N._candidate_state(work)
                self.assertEqual(before[1],'')
                (hooks/'post-checkout').write_text('#!/bin/sh\n')
                self.assertNotEqual(N._candidate_state(work),before)
        finally:
            home_include.unlink(missing_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            work=self.make_repo(tmp)
            linked=pathlib.Path(tmp)/'linked'
            self.git(work,'worktree','add','--detach',str(linked),'HEAD')
            gitdir=pathlib.Path((linked/'.git').read_text().split(':',1)[1].strip())
            pointer=gitdir/'commondir'
            holder=pathlib.Path(tmp)/'commondir-file'
            holder.write_text(pointer.read_text())
            pointer.unlink()
            pointer.symlink_to(holder)
            before=N._candidate_state(linked)
            self.assertEqual(before[1],'')
            (work/'.git'/'hooks'/'post-checkout').write_text('#!/bin/sh\n')
            self.assertNotEqual(N._candidate_state(linked),before)
            pointer.unlink()
            target=pathlib.Path(tmp)/'commondir-dir'
            (target/'hooks').mkdir(parents=True)
            pointer.symlink_to(target)
            hostile=N._candidate_state(linked)
            self.assertNotEqual(hostile[1],'')

    def test_slot_worktree_contract_accepts_uid_owned_private_tree(self):
        """Receiver shape: git worktree add --detach, owner is the caller, mode & 077 == 0.

        slot2_preflight requires repo/.git and objects to be owned by uid978
        with no group/other write. This host is not uid978; the same contract
        is checked for the current uid. A root-owned tree is not required.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)/'slot2'
            repo=root/'repo'
            worktrees=root/'worktrees'
            repo.mkdir(parents=True)
            worktrees.mkdir()
            for path in (root,repo,worktrees):
                path.chmod(0o700)
            self.git(repo,'init','-q')
            (repo/'a.txt').write_text('x\n')
            self.git(repo,'add','.')
            self.git(repo,'commit','-qm','c')
            for path in (repo/'.git',repo/'.git'/'objects'):
                path.chmod(0o700)
                info=path.stat()
                self.assertEqual(info.st_uid,os.getuid())
                self.assertEqual(info.st_mode & 0o077,0)
                self.assertEqual(info.st_mode & 0o022,0)
            qa=worktrees/'qa-issue-1-a1'
            self.git(repo,'worktree','add','--detach',str(qa),'HEAD')
            for dirpath,dirnames,filenames in os.walk(qa):
                os.chmod(dirpath,0o700)
                for name in filenames:
                    os.chmod(pathlib.Path(dirpath)/name,0o600)
            head=subprocess.check_output(['/usr/bin/git','-C',str(qa),'rev-parse','HEAD'],text=True).strip()
            state=N._candidate_state(qa)
            self.assertEqual(state[0],head)
            self.assertEqual(state[1],'')
            N._guard_accidental_writes(qa)
            guarded=N._candidate_state(qa)
            self.assertEqual(guarded[0],head)
            self.assertEqual(guarded[1],'')
            self.assertEqual((qa/'a.txt').stat().st_mode & 0o222,0)
            self.assertEqual((repo/'.git'/'objects').stat().st_mode & 0o222,0o200)
            self.assertEqual(qa.stat().st_uid,os.getuid())
            self.assertEqual((repo/'.git').stat().st_uid,os.getuid())

    def test_setsid_writer_cannot_land_after_a_clean_return(self):
        """A quiet invocation cgroup kills a setsid grandchild before SUCCESS.

        A host that does not delegate a cgroup cannot see a process that has
        already been reparented. That late write is the named residual risk,
        and a success receipt must say so instead of claiming a boundary.
        """
        with tempfile.TemporaryDirectory() as tmp,tempfile.TemporaryDirectory() as ev:
            work=self.make_repo(tmp)
            target=work/'a.txt'
            script=(
                'import os,sys,time\n'
                'path=sys.argv[1]\n'
                'if os.fork()==0:\n'
                ' os.setsid()\n'
                ' if os.fork()==0:\n'
                '  time.sleep(0.4)\n'
                '  os.chmod(path,0o644)\n'
                '  open(path,"w").write("tampered\\n")\n'
                '  os._exit(0)\n'
                ' os._exit(0)\n'
                'os._exit(0)\n'
            )
            def popen(_argv,**kwargs):
                return subprocess.Popen(['/usr/bin/python3','-I','-c',script,str(target)],**kwargs)
            receipt=None
            with patch.object(N,'qualification',return_value={'phase':'canary'}), \
                 patch.object(N.os,'geteuid',return_value=978), \
                 patch.object(N,'trusted',return_value=b'synthetic-token'), \
                 patch.object(N,'AGY','/usr/bin/python3'), \
                 patch.object(N,'_verify_executor_boundary',return_value=None), \
                 patch('native_guard.no_new_privileges',return_value=None):
                try:
                    _raw,receipt=N.invoke('inert no-model',45,work=work,slot='slot2',task_hash='0'*64,
                             charge=lambda:None,popen=popen,analysis=True,
                             evidence_dir=pathlib.Path(ev))
                except N.ReviewError as err:
                    self.assertEqual(err.code,'AGY_CANDIDATE_CHANGED')
            phases=[]
            for path in pathlib.Path(ev).rglob('phase-*.json'):
                phases.append(json.loads(path.read_text()))
            reap_state=next(row['executor_reap'] for row in reversed(phases) if 'executor_reap' in row)
            time.sleep(0.6)
            if reap_state=='cgroup-quiet':
                self.assertEqual(target.read_text(),'x\n')
            elif reap_state=='cgroup-busy':
                self.assertIsNone(receipt)
            else:
                self.assertEqual(reap_state,'cgroup-absent')
                self.assertIn('left the session',N.RESIDUAL_RISK)
                if receipt is not None:
                    self.assertEqual(receipt['executor_reap'],'cgroup-absent')
                    self.assertEqual(receipt['candidate_integrity'],'detected_accidental_modification_only')

if __name__=='__main__': unittest.main()

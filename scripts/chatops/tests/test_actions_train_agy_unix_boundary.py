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
import pathlib
import subprocess
import sys
import tempfile
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
                self.run_invoke(work,lambda:(work/'tampered.txt').write_text('model wrote'),ev)
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
            self.assertEqual(receipt['candidate_access'],'uid_owned_checkout_state_verified_unchanged')
            self.assertNotIn('apparmor_profile',receipt)
            self.assertEqual(receipt['executor_uid'],978)

if __name__=='__main__': unittest.main()

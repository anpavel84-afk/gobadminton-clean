"""Stage3.2 UID978: explicit, narrowly attached AA-enforce sandbox.

Offline tests cover the exact source policy and fail-closed preexec design.
Real UID978/AppArmor enforcement, Go mapped-userns/mount and file-write
negatives are independently verified as guarded OPS proof on Germany.
"""
import ctypes
import inspect
import pathlib
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'actions_train'))
import native_antigravity as N

POLICY=pathlib.Path(__file__).resolve().parents[1]/'ops/gb_agy_runtime.apparmor'

class ScopedAgySecurity(unittest.TestCase):
    def test_per_executable_enforced_profile_exact_tools(self):
        text=POLICY.read_text()
        self.assertIn('profile gb-agy-runtime /opt/gb-slots/runtime/antigravity/agy flags=(attach_disconnected)',text)
        self.assertNotIn('default_allow',text)
        for requirement in ('    userns,','    mount,','    umount,','    pivot_root,','    capability sys_admin,',
                            '    deny /srv/gb-slots/slot2/worktrees/** wkl,',
                            '    deny /srv/gb-slots/slot2/home/** rwklmx,',
                            '    deny /var/lib/gobadminton-actions-train/** rwklmx,',
                            '    deny /etc/gobadminton-slots/** rwklmx,',
                            '    deny /root/** rwklmx,'):
            self.assertIn(requirement,text)
        self.assertEqual(N.APPARMOR_PROFILE,b'gb-agy-runtime')
        self.assertEqual(N.READ_TOOLS,frozenset({'view_file','run_command'}))
        for body in (N.AGENT_DEF,N.ANALYSIS_AGENT_DEF):
            self.assertIn('tools:\n  - view_file\n  - run_command',body)
        self.assertEqual(N.command(45)[0],N.AGY)
        self.assertIn('--sandbox',N.command(45))
        self.assertNotIn('--mode',N.command(45))

    def test_profile_absence_raises_without_fallback(self):
        class Fn:
            def __call__(self,_name):
                return -1
        class Library:
            def __init__(self):
                self.aa_change_onexec=Fn()
        with patch.object(N.ctypes,'CDLL',return_value=Library()),\
             patch.object(N.ctypes,'get_errno',return_value=2):
            with self.assertRaises(OSError) as err:
                N._arm_apparmor_onexec()
        self.assertEqual(err.exception.errno,2)

    def test_profile_is_selected_before_nnp_without_landlock_or_root(self):
        src=inspect.getsource(N.invoke)
        self.assertIn('_arm_apparmor_onexec()',src)
        self.assertIn('no_new_privileges()',src)
        self.assertLess(src.index('_arm_apparmor_onexec()'),src.index('no_new_privileges()'))
        self.assertNotIn('_landlock(',src)
        self.assertIn("filesystem_boundary='uid978_apparmor_enforce_and_native_cli_sandbox'",src)
        self.assertIn('resource.setrlimit(resource.RLIMIT_CORE,(0,0))',src)
        self.assertEqual(N.EXECUTOR_UID,978)
        self.assertEqual(N.APPARMOR_PROFILE,b'gb-agy-runtime')

    def test_strict_complete_source_gate_remains(self):
        gate=inspect.getsource(N.analysis_source_gate)
        self.assertIn('READ_TOOLS <= set(evidence[',gate)
        self.assertIn("downgraded=dict(result,completion='INCOMPLETE')",gate)
        self.assertIn('REQUIRED_ANALYSIS_PATHS',gate)
        self.assertIn('sha256',gate)

if __name__=='__main__': unittest.main()

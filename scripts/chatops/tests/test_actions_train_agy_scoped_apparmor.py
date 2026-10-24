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
        for requirement in (
            '  userns,',
            '  capability sys_admin,',
            '  /usr/** rmix,',
            '  /tmp/gb-agy-*/** rwkmix,',
            '  mount options=(rw, make-rprivate) -> /,',
            '  mount options=(bind) /usr/** -> /tmp/gb-agy-*/**,',
            '  /srv/gb-slots/slot2/worktrees/antigravity-qa-29-canary/** r,',
        ):
            self.assertIn(requirement, text)
        for forbidden in (
            'file rwlkm /**',
            '/** ix,',
            '\n  mount,\n',
            '\n  umount,\n',
            '\n  pivot_root,\n',
            'mount options=(bind) /srv/gb-slots/slot2/worktrees/',
        ):
            self.assertNotIn(forbidden, text)
        self.assertEqual(N.APPARMOR_PROFILE,b'gb-agy-runtime')
        self.assertEqual(N.READ_TOOLS,frozenset({'view_file','run_command'}))
        for body in (N.AGENT_DEF,N.ANALYSIS_AGENT_DEF):
            self.assertIn('tools:\n  - view_file\n  - run_command',body)
        self.assertEqual(N.command(45)[0],N.AGY)
        self.assertIn('--sandbox',N.command(45))
        self.assertNotIn('--mode',N.command(45))

    def test_precharge_hash_and_enforce_are_required(self):
        import hashlib
        import stat
        import tempfile
        from types import SimpleNamespace

        policy = POLICY.read_bytes()
        self.assertEqual(
            hashlib.sha256(policy).hexdigest(),
            N.APPARMOR_POLICY_SHA256
        )

        source = inspect.getsource(N.invoke)
        self.assertLess(
            source.index('_verify_apparmor_precharge()'),
            source.index('try:charge()')
        )

        with tempfile.TemporaryDirectory() as tmp:
            installed = pathlib.Path(tmp) / "installed-policy"
            installed.write_bytes(policy)
            labels = [b'gb-agy-runtime (complain)\n']

            original_read = pathlib.Path.read_bytes

            def read_bytes(path):
                if str(path) == '/sys/kernel/security/apparmor/profiles':
                    return labels[0]
                return original_read(path)

            metadata = SimpleNamespace(
                st_mode=stat.S_IFREG | 0o644,
                st_uid=0,
                st_nlink=1
            )

            with patch.object(N, 'APPARMOR_POLICY_FILE', installed), \
                 patch.object(N.os, 'fstat', return_value=metadata), \
                 patch.object(pathlib.Path, 'read_bytes', read_bytes):

                with self.assertRaises(PermissionError):
                    N._verify_apparmor_precharge()

                labels[0] = b'gb-agy-runtime (enforce)\n'
                self.assertIsNone(N._verify_apparmor_precharge())

                with patch.object(N, 'APPARMOR_POLICY_SHA256', '0' * 64):
                    with self.assertRaises(PermissionError):
                        N._verify_apparmor_precharge()

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

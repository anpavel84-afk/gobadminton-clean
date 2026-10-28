"""Ordered canon mounts, fail-closed delivery, and optional real kernel checks.

Only synthetic files and local processes; no model, login, marker or network.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
from types import FunctionType
import unittest
from unittest.mock import Mock, patch

from test_actions_train import ROOT, core
import test_actions_train_context_cursor_scoped as scoped
import context_cursor_delivery as D
import context_policy as C
import native_cursor as N
import native_guard as G


BASE = Path('/tmp/gb-cursor-211-context-probe')  # synthetic only, never read
WORK = BASE/'work'
CANON = WORK/C.CANONICAL_GIT_RULES_PATH


def fragment(work):
    """Independent expected fragment, not computed by the implementation."""
    docs, rules = work/'docs', work/'docs/rules'
    canon = work/C.CANONICAL_GIT_RULES_PATH
    return ['--bind', str(docs), str(docs), '--bind', str(rules), str(rules),
            '--ro-bind', str(canon), str(canon)]


def legacy_argv():
    """Exact pre-change argv under the probe's exists-always-True metadata."""
    argv = [str(G.CURSOR_PIN/'gb-bwrap'), '--unshare-all', '--share-net',
            '--die-with-parent', '--new-session', '--cap-drop', 'ALL',
            '--tmpfs', '/tmp', '--proc', '/proc', '--dev', '/dev', '--dir', '/usr',
            '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib',
            '--symlink', 'usr/lib64', '/lib64']
    for name in ('/usr/bin', '/usr/lib', '/usr/lib64', '/usr/share',
                 '/opt/gb-slots/runtime/node', '/opt/gb-slots/runtime/pnpm',
                 '/etc/ld.so.cache', '/etc/ssl/openssl.cnf', '/etc/ssl/certs',
                 '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/gai.conf'):
        argv += ['--ro-bind', name, name]
    argv += ['--ro-bind', str(G.CURSOR_PIN), str(G.CURSOR_PIN)]
    for name in ('home', 'config', 'data', 'cache', 'tmp', 'work'):
        argv += ['--bind', str(BASE/name), str(BASE/name)]
    return argv + ['--chdir', str(WORK), '--', str(G.CURSOR_PIN/'node')]


def negative_argv():
    old = legacy_argv()
    at = old.index('--chdir')
    head, tail = old[:at], old[at:]
    mounts = fragment(WORK)
    before_work = len(head)-3
    different = mounts.copy(); different[-2] = str(WORK/'different.md')
    rw_file = mounts.copy(); rw_file[-3] = '--bind'
    return {
        'ro_before_work': head[:before_work]+mounts+head[before_work:]+tail,
        'different_source': head+different+tail,
        'rw_file': head+rw_file+tail,
        'missing_all_ancestors': head+mounts[-3:]+tail,
        'missing_docs': head+mounts[3:]+tail,
        'missing_rules': head+mounts[:3]+mounts[-3:]+tail,
        'ancestor_after_ro': head+mounts[:3]+mounts[-3:]+mounts[3:6]+tail,
        'ancestors_reversed': head+mounts[3:6]+mounts[:3]+mounts[-3:]+tail,
        'later_docs_bind': head+mounts+mounts[:3]+tail,
        'later_work_bind': head+mounts+['--bind', str(WORK), str(WORK)]+tail,
        'unknown_option': head+mounts+['--unknown']+tail,
        'two_chdir': head+mounts+['--chdir', str(WORK)]+tail,
        'old_no_ro_mount': old,
    }


class RulesMountStructure(unittest.TestCase):
    def test_constant_and_exact_additive_builder_argv(self):
        self.assertEqual(G.CURSOR_RULES_PATH, C.CANONICAL_GIT_RULES_PATH)
        self.assertIs(N.cursor_namespace_argv, G.cursor_namespace_argv)
        old = legacy_argv()
        at = old.index('--chdir')
        argv = D._synthetic_namespace_argv()  # executes the real builder bytecode
        self.assertEqual(argv, old[:at]+fragment(WORK)+old[at:])
        self.assertEqual(argv[:at]+argv[at+9:], old)
        self.assertEqual(argv[at-3:at], ['--bind', str(WORK), str(WORK)])
        self.assertEqual(argv.count('--chdir'), 1)
        for i in range(at, at+9, 3):
            self.assertIn(argv[i], ('--bind', '--ro-bind'))
            self.assertEqual(argv[i+1], argv[i+2])
            self.assertIn(WORK, Path(argv[i+1]).parents)
        self.assertTrue(D.recipient_rules_readonly())

    def test_absent_canon_runs_real_builder_without_fragment(self):
        real = G.cursor_rules_readonly_mounts
        def absent(work):
            from types import FunctionType
            from unittest.mock import patch
            # Preserve synthetic metadata except the single missing canon.
            path_type = type(work)
            exists = path_type.exists
            namespace = dict(real.__globals__, Path=path_type, os=os)
            with patch.object(path_type, 'exists',
                    lambda p: False if p.name == 'ENGINEERING_OPERATING_MODEL.md' else exists(p)):
                return FunctionType(real.__code__, namespace)(work)
        # The probe clones helper bytecode into its copied globals. This wrapper
        # therefore calls a copy of the real helper with that same metadata.
        builder = N.cursor_namespace_argv
        namespace = dict(builder.__globals__, cursor_rules_readonly_mounts=absent)
        variant = FunctionType(builder.__code__, namespace, builder.__name__)
        with patch.object(N, 'cursor_namespace_argv', variant):
            argv = D._synthetic_namespace_argv()
            self.assertEqual(argv, legacy_argv())
            self.assertFalse(D.recipient_rules_readonly())

    def test_negative_mounts_full_stage_payload_and_no_spawn(self):
        # Obtain a valid scoped expectation, then validate each drifted argv
        # against the checked callback as well as the actual stage full path.
        fixture = scoped.ContextProof(methodName='test_exact_utf8_payload_and_init_first_are_verified_hashes_only')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        for name, argv in negative_argv().items():
            with self.subTest(name=name), patch.object(D, '_synthetic_namespace_argv', return_value=argv):
                self.assertFalse(D.recipient_rules_readonly())
                captured, receipt = scoped.CursorStage().exercise(readonly=None)
                # exercise() asserts exact legacy payload bytes and unwrapped
                # full path, including token accounting and no import gate.
                self.assertEqual(receipt['context_metrics']['effective_profile'], 'full')
                self.assertEqual(receipt['context_metrics']['fallback_reason'],
                                 'RECIPIENT_RULES_NOT_READONLY')
                self.assertIn('bounded immutable task', captured['prompt'])
                popen = Mock()
                exp = copy.deepcopy(fixture.exp)
                with self.assertRaises(core.Refused):
                    D.recipient_popen(popen, exp)(argv, cwd=WORK)
                popen.assert_not_called()
                self.assertFalse(exp['recipient_materialization']['readonly_enforced'])

    def test_unchanged_cursor_and_guard_manifest_pin(self):
        manifest = json.loads((ROOT/'scripts/chatops/actions_train/manifest.json').read_text())['files']
        path = ROOT/'scripts/chatops/actions_train'
        self.assertEqual(hashlib.sha256((path/'native_cursor.py').read_bytes()).hexdigest(),
                         '02d26f8be9766bbeb1e92dd8514dfc496c1b3e1b0fc8035c1c65cc9aba6b6089')
        for name in ('native_guard.py', 'context_cursor_delivery.py'):
            self.assertEqual(manifest['scripts/chatops/actions_train/'+name],
                             hashlib.sha256((path/name).read_bytes()).hexdigest())


class RulesMountDefence(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='canon-mount-')
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.canon = self.work/C.CANONICAL_GIT_RULES_PATH
        self.canon.parent.mkdir(parents=True)
        self.canon.write_bytes(b'synthetic canon\n')

    def test_regular_and_missing_file(self):
        self.assertEqual(G.cursor_rules_readonly_mounts(self.work), fragment(self.work))
        self.canon.unlink()
        self.assertEqual(G.cursor_rules_readonly_mounts(self.work), [])

    def test_symlink_and_directory_canon(self):
        target = self.work/'target'; self.canon.rename(target)
        self.canon.symlink_to(target)
        with self.assertRaises(G.GuardError): G.cursor_rules_readonly_mounts(self.work)
        self.canon.unlink(); self.canon.mkdir()
        with self.assertRaises(G.GuardError): G.cursor_rules_readonly_mounts(self.work)

    def test_hardlink(self):
        (self.work/'alias').hardlink_to(self.canon)
        with self.assertRaises(G.GuardError): G.cursor_rules_readonly_mounts(self.work)

    def test_wrong_file_owner(self):
        with patch.object(G.os, 'geteuid', return_value=os.geteuid()+1):
            with self.assertRaises(G.GuardError): G.cursor_rules_readonly_mounts(self.work)

    def test_each_ancestor_symlink(self):
        for rel in ('docs/rules', 'docs'):
            with self.subTest(rel=rel):
                parent = self.work/rel
                target = self.work/'moved'
                parent.rename(target); parent.symlink_to(target, target_is_directory=True)
                try:
                    with self.assertRaises(G.GuardError): G.cursor_rules_readonly_mounts(self.work)
                finally:
                    parent.unlink(); target.rename(parent)

    def test_each_ancestor_wrong_owner(self):
        real = Path.lstat
        for rel in ('docs', 'docs/rules'):
            def lstat(path):
                info = real(path)
                if path == self.work/rel:
                    values = list(info); values[4] = os.geteuid()+1
                    return os.stat_result(values)
                return info
            with self.subTest(rel=rel), patch.object(Path, 'lstat', lstat):
                with self.assertRaises(G.GuardError): G.cursor_rules_readonly_mounts(self.work)


KERNEL_PROBE = r'''
import json, os, pathlib, shutil, subprocess
p = pathlib.Path('docs/rules/ENGINEERING_OPERATING_MODEL.md')
out = {}
def blocked(name, fn):
    try:
        fn()
    except OSError:
        out[name] = True
    else:
        out[name] = False
def opened(mode):
    with p.open(mode) as f:
        if mode == 'r+': f.write('bad')
        else: f.write('bad')
def replace_symlink():
    p.unlink()
    p.symlink_to('replacement')
replacement = p.with_name('replacement'); replacement.write_text('replacement')
blocked('write', lambda: opened('w'))
blocked('append', lambda: opened('a'))
blocked('rplus', lambda: opened('r+'))
blocked('truncate', lambda: os.truncate(p, 0))
blocked('chmod', lambda: p.chmod(0o600))
blocked('utimes', lambda: os.utime(p, (1, 1)))
blocked('unlink', p.unlink)
blocked('rename_away', lambda: p.rename(p.with_name('moved.md')))
blocked('rename_over', lambda: replacement.replace(p))
blocked('hardlink', lambda: p.with_name('alias').hardlink_to(p))
blocked('symlink_replace', replace_symlink)
for name in ('docs/rules', 'docs'):
    d = pathlib.Path(name)
    blocked('rename_'+name, lambda d=d: d.rename(str(d)+'2'))
    blocked('rmtree_'+name, lambda d=d: shutil.rmtree(d))
for tool in ('mount', 'umount', 'unshare'):
    assert shutil.which(tool), 'missing required test tool: '+tool
commands = {
    'remount': ['mount', '-o', 'remount,rw,bind', str(p)],
    'umount': ['umount', str(p)],
    'unshare_remount': ['unshare', '-Urm', '--', 'mount', '-o', 'remount,rw,bind', str(p)],
    'unshare_umount': ['unshare', '-Urm', '--', 'umount', str(p)],
    'unshare_bind_over': ['unshare', '-Urm', '--', 'mount', '--bind', 'probe.py', str(p)],
}
for name, command in commands.items():
    out[name] = subprocess.run(command, capture_output=True, timeout=10).returncode != 0
# Even rmtree attempts above must leave both ancestor mountpoints available.
for name in ('docs/rules/sibling', 'docs/sibling', 'top', 'other/sibling'):
    s = pathlib.Path(name); s.parent.mkdir(exist_ok=True)
    s.write_text('before'); s.write_text('after'); assert s.read_text() == 'after'
    s.chmod(0o640); assert s.stat().st_mode & 0o777 == 0o640
    moved = s.with_name(s.name+'2'); s.rename(moved); moved.unlink()
    folder = s.with_name(s.name+'-dir'); folder.mkdir(); folder.rmdir()
out['siblings_writable'] = True
print(json.dumps(out))
assert all(out.values()), out
'''


class RealRulesMounts(unittest.TestCase):
    def test_generic_bwrap_enforcement_and_wrong_order_control(self):
        bwrap = shutil.which('bwrap')
        if not bwrap:
            self.skipTest('NOT_TESTED: bwrap missing on PATH')
        probe = subprocess.run([bwrap, '--ro-bind', '/', '/', 'true'],
                               capture_output=True, text=True, timeout=15)
        if probe.returncode:
            self.skipTest('NOT_TESTED: bwrap namespaces/mounts unavailable: '+probe.stderr.strip())
        with tempfile.TemporaryDirectory(prefix='bwrap-canon-') as temp:
            work = Path(temp)/'work'; canon = work/C.CANONICAL_GIT_RULES_PATH
            canon.parent.mkdir(parents=True)
            canon.write_bytes(b'synthetic immutable canon\n'); canon.chmod(0o644)
            (work/'probe.py').write_text(KERNEL_PROBE)
            before = canon.read_bytes(), canon.stat().st_mode, canon.stat().st_ino
            mounts = G.cursor_rules_readonly_mounts(work)
            prefix = [bwrap, '--ro-bind', '/', '/', '--unshare-user']
            bind = ['--bind', str(work), str(work)]
            tail = ['--chdir', str(work), '--', 'python3', '-B']
            process = subprocess.run(prefix+bind+mounts+tail+['probe.py'],
                                     capture_output=True, text=True, timeout=45)
            self.assertEqual(process.returncode, 0, process.stderr+'\n'+process.stdout)
            result = json.loads(process.stdout)
            self.assertEqual(len(result), 21)
            self.assertTrue(all(result.values()), result)
            self.assertEqual((canon.read_bytes(), canon.stat().st_mode, canon.stat().st_ino), before)
            # Negative control: a later rw work bind hides ALL protective mounts.
            control = subprocess.run(prefix+mounts+bind+tail+['-c',
                "from pathlib import Path; Path('"+C.CANONICAL_GIT_RULES_PATH+"').write_text('writable control')"],
                capture_output=True, text=True, timeout=15)
            self.assertEqual(control.returncode, 0, control.stderr)
            self.assertEqual(canon.read_text(), 'writable control')

    def test_vps_real_builder_pinned_helper_and_node_denies_write(self):
        if os.geteuid() not in (1002, 978):
            self.skipTest('NOT_TESTED: requires VPS slot uid 1002 or 978')
        helper, node = G.CURSOR_PIN/'gb-bwrap', G.CURSOR_PIN/'node'
        if not helper.exists() or not node.exists():
            self.skipTest('NOT_TESTED: pinned VPS gb-bwrap/node not installed')
        self.assertEqual(hashlib.sha256(helper.read_bytes()).hexdigest(), G.BWRAP_SHA256)
        self.assertEqual(hashlib.sha256(node.read_bytes()).hexdigest(), N.PIN_HASHES['node'])
        # Only this optional VPS test uses the real builder's required /tmp root.
        with tempfile.TemporaryDirectory(prefix='gb-cursor-211-ro-test-', dir='/tmp') as temp:
            base = Path(temp)
            for name in ('home', 'config', 'data', 'cache', 'tmp', 'work'):
                (base/name).mkdir(mode=0o700)
            work = base/'work'; canon = work/C.CANONICAL_GIT_RULES_PATH
            canon.parent.mkdir(parents=True); canon.write_bytes(b'synthetic canon\n')
            before = canon.read_bytes(), canon.stat().st_mode, canon.stat().st_ino
            script = ("try { require('fs').writeFileSync("+json.dumps(str(canon))+
                      ", 'bad'); process.exit(9); } catch(e) { "
                      "if (e.code !== 'EROFS') throw e; console.log('EROFS'); }")
            argv = G.cursor_namespace_argv(base, [str(node), '-e', script])
            process = subprocess.run(argv, cwd=work, env={'PATH': '/usr/bin:/bin', 'HOME': str(base/'home')},
                capture_output=True, text=True, timeout=20, close_fds=True, start_new_session=True,
                preexec_fn=G.no_new_privileges)
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertEqual(process.stdout.strip(), 'EROFS')
            self.assertEqual((canon.read_bytes(), canon.stat().st_mode, canon.stat().st_ino), before)


if __name__ == '__main__':
    unittest.main()

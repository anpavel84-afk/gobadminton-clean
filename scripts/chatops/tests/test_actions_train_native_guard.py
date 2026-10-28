"""Real kernel checks; no inference, credentials or host mutation."""
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'actions_train'))
from native_guard import _landlock, _supported_sandbox_root, restrict, GuardError


class WholeClientBoundary(unittest.TestCase):
    def test_real_kernel_files_processes_threads_and_symlink_escape(self):
        with tempfile.TemporaryDirectory(prefix='gb-native-guard-') as temp:
            root = Path(temp)
            work, home, config = (root / x for x in ('work', 'home', 'config'))
            for p in (work, home, config): p.mkdir()
            outside = root / 'outside'; outside.write_text('synthetic outside canary')
            (work / 'input').write_text('permitted source')
            (work / 'escape').symlink_to(outside)
            readonly = [p for p in (Path('/usr/lib'), Path('/usr/local/lib'), Path('/lib'),
                        Path('/lib64'), Path('/etc/ld.so.cache'), work, home,
                        Path('/dev/urandom')) if p.exists()]
            script = r"""
import json, os, pathlib, subprocess, threading
work=pathlib.Path(os.environ['WORK']); home=pathlib.Path(os.environ['HOME']); outside=pathlib.Path(os.environ['OUTSIDE'])
def success(call):
 try: call(); return True
 except (OSError,RuntimeError): return False
out={}
out['source_read']=success(lambda:(work/'input').read_bytes())
out['outside_read']=success(lambda:outside.read_bytes())
out['symlink_read']=success(lambda:(work/'escape').read_bytes())
out['environ_read']=success(lambda:pathlib.Path('/proc/self/environ').read_bytes())
out['source_write']=success(lambda:(work/'output').write_text('allowed'))
out['auth_home_write']=success(lambda:(home/'auth.json').write_text('must not persist'))
out['symlink_create']=success(lambda:(work/'new-link').symlink_to(outside))
out['subprocess']=success(lambda:subprocess.run(['/bin/true'],check=True))
ran=[]
t=threading.Thread(target=lambda:ran.append(True))
out['thread']=success(lambda:(t.start(),t.join())) and ran==[True]
p=work/'executable';p.write_text('#!/bin/sh\nexit 0\n');p.chmod(0o755)
out['source_exec']=success(lambda:os.execve(str(p),[str(p)],{}))
print(json.dumps(out))
"""
            env = {'PATH': '/usr/bin:/bin', 'HOME': str(home), 'WORK': str(work),
                   'OUTSIDE': str(outside), 'PYTHONDONTWRITEBYTECODE': '1'}
            process = subprocess.run([sys.executable, '-I', '-c', script], cwd=work, env=env,
                      text=True, capture_output=True, timeout=20, start_new_session=True,
                      preexec_fn=lambda:restrict(readonly, [work, config], [Path(sys.executable), Path("/lib64/ld-linux-x86-64.so.2")]))
            self.assertEqual(process.returncode, 0, process.stderr[:2000])
            value = json.loads(process.stdout)
            self.assertEqual({k for k,v in value.items() if v}, {'source_read','source_write','thread'})
            self.assertFalse((home/'auth.json').exists())
            self.assertEqual(outside.read_text(), 'synthetic outside canary')

    def test_root_exposure_is_refused(self):
        # Refusal runs only in a disposable child; never restrict the test process.
        script = "from native_guard import restrict; restrict(['/'],[],[])"
        r = subprocess.run([sys.executable, '-c', script],
             env=dict(os.environ,PYTHONPATH=str(Path(__file__).resolve().parents[1]/'actions_train')),
             capture_output=True,text=True,timeout=10)
        self.assertNotEqual(r.returncode,0)
        self.assertIn('root filesystem cannot be exposed',r.stderr)

    def test_explicit_pty_grant_permits_openpty_shell_git(self):
        """Landlock-only: explicit PTY mux+/dev/pts allow openpty and bounded shell/Git.

        Without the grant openpty stays denied. Outside sentinel remains denied
        when PTY is granted. Uses _landlock only (fork needed); seccomp unchanged.
        """
        ptmx, pts = Path('/dev/ptmx'), Path('/dev/pts')
        self.assertTrue(ptmx.exists(), '/dev/ptmx required on Linux runner')
        self.assertTrue(pts.is_dir(), '/dev/pts required on Linux runner')
        self.assertTrue(Path('/usr/bin/git').is_file(), '/usr/bin/git required')
        self.assertTrue(Path('/bin/sh').exists(), '/bin/sh required')
        resolved = ptmx.resolve(strict=True)
        st = resolved.stat()
        self.assertTrue(stat.S_ISCHR(st.st_mode))
        self.assertEqual((os.major(st.st_rdev), os.minor(st.st_rdev)), (5, 2))
        self.assertIn(str(resolved), ('/dev/ptmx', '/dev/pts/ptmx'))
        self.assertTrue(_supported_sandbox_root(resolved, st))
        # Arbitrary char devices remain refused (null/random path allowlist unchanged).
        with self.assertRaisesRegex(GuardError, 'unsupported sandbox root'):
            _landlock([], [Path('/dev/zero')], [])

        script = r"""
import json, os, pathlib, select
work=pathlib.Path(os.environ['WORK']); outside=pathlib.Path(os.environ['OUTSIDE'])
def success(call):
 try: call(); return True
 except OSError: return False
def via_pty(argv):
 master, slave = os.openpty()
 try:
  pid = os.fork()
  if pid == 0:
   os.close(master)
   os.setsid()
   os.dup2(slave, 0); os.dup2(slave, 1); os.dup2(slave, 2)
   if slave > 2: os.close(slave)
   os.execve(argv[0], argv, {'PATH':'/usr/bin:/bin','LANG':'C'})
  os.close(slave)
  chunks=[]; 
  while True:
   r,_,_ = select.select([master],[],[],5)
   if not r: break
   try: data=os.read(master,1024)
   except OSError: break
   if not data: break
   chunks.append(data)
  _, status = os.waitpid(pid, 0)
  return status, b''.join(chunks)
 finally:
  try: os.close(master)
  except OSError: pass
out={}
out['outside_read']=success(lambda:outside.read_bytes())
out['outside_write']=success(lambda:outside.write_text('must stay denied'))
try:
 m,s=os.openpty(); os.close(m); os.close(s); out['openpty']=True
except OSError:
 out['openpty']=False
if out['openpty']:
 st, git_out = via_pty(['/usr/bin/git','--version'])
 out['git_ok']=os.WIFEXITED(st) and os.WEXITSTATUS(st)==0 and git_out.startswith(b'git version')
 st, sh_out = via_pty(['/bin/sh','-c','echo PTY_SHELL_OK'])
 out['shell_ok']=os.WIFEXITED(st) and os.WEXITSTATUS(st)==0 and b'PTY_SHELL_OK' in sh_out
else:
 out['git_ok']=False; out['shell_ok']=False
print(json.dumps(out))
"""
        with tempfile.TemporaryDirectory(prefix='gb-native-guard-pty-') as temp:
            root = Path(temp)
            work, home, config = (root / x for x in ('work', 'home', 'config'))
            for p in (work, home, config):
                p.mkdir()
            outside = root / 'outside'
            outside.write_text('synthetic outside canary')
            readonly = [p for p in (Path('/usr/lib'), Path('/usr/local/lib'), Path('/lib'),
                        Path('/lib64'), Path('/usr/bin'), Path('/bin'), Path('/etc/ld.so.cache'),
                        work, home, Path('/dev/urandom'), Path('/dev/null')) if p.exists()]
            executables = [p for p in (Path(sys.executable), Path('/lib64/ld-linux-x86-64.so.2'),
                           Path('/usr/bin'), Path('/bin'), Path('/usr/lib'), Path('/lib64')) if p.exists()]
            env = {'PATH': '/usr/bin:/bin', 'HOME': str(home), 'WORK': str(work),
                   'OUTSIDE': str(outside), 'PYTHONDONTWRITEBYTECODE': '1'}
            py = [sys.executable, '-I', '-c', script]

            denied = subprocess.run(
                py, cwd=work, env=env, text=True, capture_output=True, timeout=20,
                start_new_session=True,
                preexec_fn=lambda: _landlock(readonly, [work, config], executables))
            self.assertEqual(denied.returncode, 0, denied.stderr[:2000])
            no_pty = json.loads(denied.stdout)
            self.assertFalse(no_pty['openpty'])
            self.assertFalse(no_pty['git_ok'])
            self.assertFalse(no_pty['shell_ok'])
            self.assertFalse(no_pty['outside_read'])
            self.assertFalse(no_pty['outside_write'])

            granted = subprocess.run(
                py, cwd=work, env=env, text=True, capture_output=True, timeout=20,
                start_new_session=True,
                preexec_fn=lambda: _landlock(
                    readonly, [work, config, ptmx, pts], executables))
            self.assertEqual(granted.returncode, 0, granted.stderr[:2000])
            with_pty = json.loads(granted.stdout)
            self.assertTrue(with_pty['openpty'], with_pty)
            self.assertTrue(with_pty['git_ok'], with_pty)
            self.assertTrue(with_pty['shell_ok'], with_pty)
            self.assertFalse(with_pty['outside_read'])
            self.assertFalse(with_pty['outside_write'])
            self.assertEqual(outside.read_text(), 'synthetic outside canary')


if __name__=='__main__':unittest.main()

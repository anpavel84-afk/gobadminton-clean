"""Real kernel checks; no inference, credentials or host mutation."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'actions_train'))
from native_guard import restrict, GuardError


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


if __name__=='__main__':unittest.main()

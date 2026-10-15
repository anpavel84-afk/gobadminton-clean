"""Dependency-free executable checks of actual TypeScript config/proxy via Node 24.
Only disposable imports adapt extension resolution; source auth logic is unchanged.
"""
import os, subprocess, tempfile, unittest
from pathlib import Path

class AdminPath(unittest.TestCase):
 def test_actual_config_and_proxy(self):
  root=Path.cwd()
  with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as td:
   tmp=Path(td)
   server=(root/'apps/admin/src/lib/server-config.ts').as_uri()
   proxy=(root/'apps/admin/src/app/v1/admin/[...path]/route.ts').read_text().replace('"../../../../lib/server-config"', '"'+server+'"')
   (tmp/'proxy.ts').write_text(proxy)
   config=(root/'apps/admin/next.config.ts').read_text().replace('const pathBuild', 'const __dirname = process.cwd();\nconst pathBuild')
   (tmp/'config.ts').write_text(config)
   script=(root/'scripts/chatops/tests/admin-path-regression.mjs').read_text().replace('SERVER_MODULE',server).replace('CLIENT_MODULE',(root/'apps/admin/src/lib/admin-path.ts').as_uri())
   (tmp/'check.mjs').write_text(script)
   result=subprocess.run(['node','--experimental-strip-types',str(tmp/'check.mjs')],env=os.environ|{'COREPACK_ENABLE_NETWORK':'0'},text=True,capture_output=True)
   self.assertEqual(result.returncode,0,result.stdout+result.stderr)

if __name__=='__main__':unittest.main()

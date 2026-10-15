"""Dependency-free executable checks of actual TypeScript config/proxy via Node 24.
Only disposable imports adapt extension resolution; source auth logic is unchanged.
"""
import os, re, subprocess, tempfile, unittest
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

class AdminNginxLogging(unittest.TestCase):
 """Source contract; nginx/runtime is deliberately not installed or started here."""
 def blocks(self):
  source=Path('scripts/chatops/server/dev-admin-nginx.example.conf').read_text()
  source=re.sub(r'#[^\n]*', '', source)
  matches=list(re.finditer(r'location\s+(=|\^~)\s+(\S+)\s*\{([^{}]*)\}', source))
  remainder=source
  for match in reversed(matches):
   remainder=remainder[:match.start()]+remainder[match.end():]
  self.assertFalse(remainder.strip(), 'only insertable fixed locations allowed')
  self.assertEqual(len(matches),4)
  return {m[2]:(m[1],m[3]) for m in matches}

 def test_both_callback_hops_override_inherited_logs(self):
  blocks=self.blocks()
  self.assertEqual(set(blocks),{'/admin','/admin/',
   '/v1/admin/auth/vk/callback','/v1/admin/auth/yandex/callback'})
  for path,(modifier,body) in blocks.items():
   with self.subTest(path=path):
    self.assertEqual(modifier,'^~' if path=='/admin/' else '=')
    self.assertEqual(re.findall(r'access_log\s+([^;]+);',body),['off'])
    self.assertEqual(re.findall(r'error_log\s+([^;]+);',body),['/dev/null crit'])
    self.assertNotRegex(body,r'\b(if|rewrite|error_page|include|set)\b|\$http_.*(?:bypass|log)')

 def test_original_query_and_proxy_safety_preserved(self):
  blocks=self.blocks()
  for path in ['/admin/','/v1/admin/auth/vk/callback','/v1/admin/auth/yandex/callback']:
   with self.subTest(path=path):
    body=blocks[path][1]
    port=18088 if path=='/admin/' else 18084
    self.assertEqual(re.findall(r'proxy_pass\s+([^;]+);',body),[f'http://127.0.0.1:{port}'])
    self.assertNotRegex(body,r'\breturn\b|\$args|\$request_uri|proxy_pass_request_(?:headers|body)\s+off')
    self.assertEqual(dict(re.findall(r'proxy_set_header\s+(\S+)\s+([^;]+);',body)),{
     'Host':'$host','X-Forwarded-Proto':'https','X-Forwarded-Host':'$host','Origin':'$http_origin'})
  self.assertRegex(blocks['/admin'][1],r'return 303 /admin/;')

if __name__=='__main__':unittest.main()

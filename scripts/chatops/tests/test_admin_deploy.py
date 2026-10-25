#!/usr/bin/env python3
"""Unprivileged offline protocol tests. Only a disposable COPY bypasses root/trusted
checks. This is NOT an ownership/sudo test or live deployment acceptance.
Root-only ownership tests remain in test_helper.py for hosted CI.
"""
import json, os, re, subprocess, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import test_helper as legacy

ADMIN = 'sha256:' + 'f'*64

class AdminProtocol(unittest.TestCase):
 def setUp(self):
  self.fixture = legacy.TestHelper('test_status')
  real = tempfile.mkdtemp
  with patch.object(legacy.tempfile, 'mkdtemp', side_effect=lambda **kw: real(prefix=kw['prefix'],dir=tempfile.gettempdir())):
   self.fixture.setUp()
  self.root = self.fixture.root
  text = self.fixture.helper.read_text()
  text = text.replace('[[ $EUID == 0 ]]', '[[ 1 == 1 ]]')
  text = re.sub(r'trusted\(\) \{.*?\n\}', 'trusted() { :; }', text, count=1, flags=re.S)
  text = text.replace('chown root:root "$tmp";', ':;')
  self.fixture.helper.write_text(text)
 def tearDown(self): self.fixture.tearDown()
 def enable(self, env='dev', existing=False):
  p=self.root/f'config/{env}.conf'
  p.write_text(p.read_text().replace('SERVICES=(api web)', 'SERVICES=(api web admin)')+f'''
DEV_ADMIN_COMMISSIONED=true
ADMIN_ENV_FILE={self.root}/config/admin.env
ADMIN_RESPONSE_URL=https://dev.gobadminton.ru/admin/
ADMIN_META_URL=https://dev.gobadminton.ru/v1/meta
''')
  (self.root/'config/admin.env').write_text('DUMMY=1\n')
  (self.root/'config/admin.env').chmod(0o600)
  if existing:
   d=self.data();d['testdev-admin']={'project':'testdev','service':'admin','image':'sha256:'+'9'*64,'sha':'e'*40};self.save(d)
 def data(self):return json.loads((self.root/'docker.json').read_text())
 def save(self,d):(self.root/'docker.json').write_text(json.dumps(d))
 def request(self):return self.fixture.req()|{'admin_digest':ADMIN}
 def call(self,p,**kw):return self.fixture.invoke(p,**kw)
 def ok(self,r):self.assertEqual(r.returncode,0,r.stderr);return json.loads(r.stdout)
 def test_two_image_protocol(self):
  d=self.ok(self.call(self.fixture.req()));self.assertNotIn('admin_digest',d['pending'])
  self.ok(self.call({'action':'accept','release_id':'r123-a1'}))
  e=json.loads((self.root/'evidence/dev.json').read_text());self.assertNotIn('admin_digest',e['accepted'])
 def test_flag_and_prod_rejection(self):
  self.assertNotEqual(self.call(self.request()).returncode,0)
  self.assertNotEqual(self.call(self.request(),extra={'DEV_ADMIN_COMMISSIONED':'true'}).returncode,0)
  self.assertNotEqual(self.call(self.request(),envname='prod').returncode,0)
  self.enable('prod');self.assertNotEqual(self.call(self.request(),envname='prod').returncode,0)
 def test_partial_config(self):
  p=self.root/'config/dev.conf';p.write_text(p.read_text()+'\nDEV_ADMIN_COMMISSIONED=invalid\n')
  self.assertNotEqual(self.call(self.fixture.req()).returncode,0)
 def test_fields(self):
  self.enable()
  for request in [self.fixture.req(), self.request()|{'admin_digest':'latest'},self.request()|{'admin_digest':None}, self.request()|{'source_sha':'a'*39}, self.request()|{'extra':1},self.request()|{'api_digest':'latest'},self.request()|{'web_digest':'sha256:bad'}]:
   self.assertNotEqual(self.call(request).returncode,0)
 def test_wrong_revision(self):
  self.enable();before=self.data()
  self.assertNotEqual(self.call(self.request(),extra={'IMAGE_SHA':'0'*40}).returncode,0)
  self.assertEqual(self.data(),before)
 def test_wrong_provenance_or_architecture(self):
  self.enable();before=self.data()
  for extra in [{'IMAGE_ARCH':'arm64'},{'IMAGE_SOURCE':'https://other.invalid/repo'},{'BAD_ADMIN_REVISION':'1'}]:
   # Each failed pull verification consumes a release ID, preserving sequence protection.
   request=self.request()|{'release_id':'r'+str(len(list((self.root/'state').glob('dev/r*')))+100)+'-a1','sequence':1001+len(list((self.root/'state').glob('dev/r*')))}
   self.assertNotEqual(self.call(request,extra=extra).returncode,0)
   self.assertEqual(self.data(),before)
 def test_success_and_idempotence(self):
  self.enable();self.ok(self.call(self.request()));self.ok(self.call(self.request()))
  r=self.ok(self.call({'action':'accept','release_id':'r123-a1'}));self.assertEqual(r['accepted']['admin_digest'],ADMIN)
  e=json.loads((self.root/'evidence/dev.json').read_text());self.assertEqual(e['accepted']['admin_digest'],ADMIN)
  self.assertEqual(e['accepted']['source_sha'],legacy.SHA)
  self.assertNotEqual(self.call(self.request()|{'admin_digest':legacy.API}).returncode,0)
 def test_admin_failure_rolls_back_all(self):
  self.enable(existing=True);before=self.data()
  self.assertNotEqual(self.call(self.request(),extra={'FAIL_ADMIN':'1'}).returncode,0)
  self.assertEqual(self.data(),before)
  r=self.ok(self.call({'action':'status'}));self.assertIsNone(r['pending']);self.assertEqual(r['last_result']['admin_digest'],ADMIN)
 def test_first_enable_failure_removes_admin(self):
  self.enable();before=self.data()
  self.assertNotEqual(self.call(self.request(),extra={'BAD_ADMIN':'1'}).returncode,0)
  self.assertEqual(self.data(),before)
 def test_consumer_page_cannot_accept(self):
  self.enable();self.ok(self.call(self.request()))
  curl=self.root/'curl'
  curl.write_text(curl.read_text().replace('GoBadminton · Администрирование Вход для команды /admin/_next/app.js','GoBadminton consumer page'))
  self.assertNotEqual(self.call({'action':'accept','release_id':'r123-a1'}).returncode,0)
  self.assertFalse((self.root/'state/dev/accepted.json').exists())
 def test_profile_requires_exact_main_path(self):
  self.enable()
  config=self.root/'config/dev.conf';original=config.read_text()
  for bad in ['https://dev.gobadminton.ru/admin', 'https://dev.gobadminton.ru/admin/?code=x',
              'https://dev.gobadminton.ru/admin/evil', 'https://dev-admin.gobadminton.ru/',
              'https://user@dev.gobadminton.ru/admin/']:
   config.write_text(original.replace('https://dev.gobadminton.ru/admin/',bad))
   self.assertNotEqual(self.call(self.request()).returncode,0)
  config.write_text(original)
 def test_missing_admin_cannot_accept(self):
  self.enable();self.ok(self.call(self.request()));d=self.data();d.pop('testdev-admin');self.save(d)
  self.assertNotEqual(self.call({'action':'accept','release_id':'r123-a1'}).returncode,0)
 def test_compensating_first_enable_after_accept(self):
  self.enable();before=self.data();self.ok(self.call(self.request()))
  self.ok(self.call({'action':'accept','release_id':'r123-a1'}))
  self.ok(self.call({'action':'rollback','release_id':'r123-a1'}))
  self.assertEqual(self.data(),before)
 def test_running_wrong_admin_image_cannot_accept(self):
  self.enable();self.ok(self.call(self.request()))
  d=self.data();d['testdev-admin']['reference']='unexpected:mutable';self.save(d)
  self.assertNotEqual(self.call({'action':'accept','release_id':'r123-a1'}).returncode,0)
 def test_watchdog_first_enable(self):
  self.enable();before=self.data();self.ok(self.call(self.request()))
  p=self.root/'state/dev/pending.json';d=json.loads(p.read_text());d['deadline']=1;p.write_text(json.dumps(d))
  self.ok_watchdog=self.call({},watchdog=True);self.assertEqual(self.ok_watchdog.returncode,0,self.ok_watchdog.stderr)
  self.assertEqual(self.data(),before)
 def test_expired_accept_restores_existing(self):
  self.enable(existing=True);before=self.data();self.ok(self.call(self.request()))
  p=self.root/'state/dev/pending.json';d=json.loads(p.read_text());d['deadline']=1;p.write_text(json.dumps(d))
  self.assertNotEqual(self.call({'action':'accept','release_id':'r123-a1'}).returncode,0)
  self.assertEqual(self.data(),before)

 def test_deadline_crossed_during_verification(self):
  # Real helper logic, fake clock and curl only in this disposable fixture copy.
  for admin in [False, True]:
   with self.subTest(admin=admin):
    if admin:self.enable(existing=True)
    before=self.data()
    request=(self.request() if admin else self.fixture.req())|{'release_id':f'r{200+int(admin)}-a1','sequence':2000+int(admin)}
    self.ok(self.call(request))
    pending=self.root/'state/dev/pending.json'
    d=json.loads(pending.read_text());d['deadline']=100;pending.write_text(json.dumps(d))
    clock=self.root/'clock';clock.write_text('99')
    helper=self.fixture.helper.read_text().replace('$(date +%s)', f'$(cat "{clock}")')
    self.fixture.helper.write_text(helper)
    curl=self.root/'curl'
    curl.write_text(curl.read_text().replace("d=json.loads", "(Path(os.environ['MOCK_ROOT'])/'clock').write_text('100')\nd=json.loads"))
    r=self.call({'action':'accept','release_id':request['release_id']})
    self.assertNotEqual(r.returncode,0,r.stderr)
    self.assertIn('acceptance expired',r.stderr)
    self.assertEqual(clock.read_text(),'100')
    self.assertEqual(self.data(),before)
    self.assertFalse(pending.exists())
    self.assertFalse((self.root/'state/dev/accepted.json').exists())
    status=self.ok(self.call({'action':'status'}))
    self.assertEqual(status['last_result']['status'],'ROLLED_BACK')
    self.assertIsNone(status['accepted'])
    self.assertIsNone(json.loads((self.root/'evidence/dev.json').read_text())['accepted'])

class ClientGates(unittest.TestCase):
 def test_prod_promotion_filters_admin_metadata(self):
  # Exercise the shared client end-to-end with fake SSH/npm/node and credentials.
  script=Path('scripts/chatops/deploy.sh').resolve()
  with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as td:
   root=Path(td)
   manifest={'schema':1,'source_sha':legacy.SHA,'api_digest':legacy.API,'web_digest':legacy.WEB,
             'dev_run_id':123,'expected_previous_sha':'e'*40,'admin_digest':ADMIN}
   release=root/'release.json';release.write_text(json.dumps(manifest))
   ssh=root/'ssh';ssh.write_text("""#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
p=json.load(sys.stdin)
with (Path(os.environ['FIXTURE_ROOT'])/'requests.jsonl').open('a') as f:f.write(json.dumps(p)+'\\n')
key='pending' if p['action']=='deploy' else 'accepted'
print(json.dumps({key:{'release_id':p['release_id'],'status':'PENDING_SMOKE' if key=='pending' else 'ACCEPTED'}}))
""")
   npm=root/'npm';npm.write_text("""#!/bin/bash
set -eu
mkdir -p "$3/node_modules/.bin"
printf '#!/bin/bash\nexit 0\n' > "$3/node_modules/.bin/playwright"
chmod +x "$3/node_modules/.bin/playwright"
""")
   node=root/'node';node.write_text('#!/bin/bash\nexit 0\n')
   for command in [ssh,npm,node]:command.chmod(0o755)
   env={'PATH':str(root)+':/usr/bin:/bin','RUNNER_TEMP':td,'FIXTURE_ROOT':td,
        'DEPLOY_HOST':'fake.invalid','DEPLOY_WEB_HOST':'web.fake.invalid','DEPLOY_SSH_KEY':'FAKE',
        'DEPLOY_KNOWN_HOSTS':'FAKE','PUBLIC_URL':'https://fake.invalid','GITHUB_RUN_ID':'123',
        'GITHUB_RUN_ATTEMPT':'1','GITHUB_RUN_NUMBER':'1'}
   r=subprocess.run(['bash',str(script),'prod',str(release)],cwd=root,env=env,text=True,capture_output=True)
   self.assertEqual(r.returncode,0,r.stderr)
   requests=[json.loads(line) for line in (root/'requests.jsonl').read_text().splitlines()]
   deploys=[p for p in requests if p['action']=='deploy']
   expected={k:manifest[k] for k in ['source_sha','api_digest','web_digest','expected_previous_sha']}
   self.assertEqual(deploys,[expected|{'action':'deploy','release_id':'r123-a1','sequence':1001}]*2)
   self.assertTrue(all('admin_digest' not in p for p in requests))
   self.assertEqual(json.loads(release.read_text()),manifest)
   for field,value in [('admin_digest',None),('api_digest','latest'),('web_digest',None),('extra',1)]:
    release.write_text(json.dumps(manifest|{field:value}))
    bad=subprocess.run(['bash',str(script),'prod',str(release)],cwd=root,env=env,text=True,capture_output=True)
    self.assertNotEqual(bad.returncode,0)
   self.assertEqual(len((root/'requests.jsonl').read_text().splitlines()),4)

 def test_reject_before_external_commands(self):
  # No credentials, no docker/ssh/npm is supplied or run: invalid input must exit first.
  with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as td:
   p=Path(td)/'release.json';p.write_text(json.dumps({'schema':1,'source_sha':legacy.SHA,'api_digest':legacy.API,'web_digest':legacy.WEB,'admin_digest':ADMIN}))
   base=os.environ|{'CHATOPS_DEV_ADMIN_COMMISSIONED':'true','GITHUB_REPOSITORY':'anpavel84-afk/gobadminton-clean','GITHUB_REF':'refs/heads/dev','GITHUB_ENVIRONMENT':'dev'}
   for override, environment in [({},'prod'),({'GITHUB_REF':'refs/heads/main'},'dev'),({'GITHUB_ENVIRONMENT':'prod'},'dev'),({'GITHUB_REPOSITORY':'other/repo'},'dev'),({'CHATOPS_DEV_ADMIN_COMMISSIONED':'false'},'dev'),({'CHATOPS_DEV_ADMIN_COMMISSIONED':'1'},'dev')]:
    r=subprocess.run(['bash','scripts/chatops/deploy.sh',environment,str(p)],env=base|override,capture_output=True,text=True)
    self.assertNotEqual(r.returncode,0);self.assertNotIn('DEPLOY_HOST',r.stderr)
   for override in [{'GITHUB_REF':'refs/tags/v1'}, {'GITHUB_ENVIRONMENT':'prod'}, {'CHATOPS_DEV_ADMIN_COMMISSIONED':'bad'}]:
    r=subprocess.run(['bash','scripts/chatops/build-pair.sh'],env=base|{'GITHUB_SHA':legacy.SHA,'GH_TOKEN':'FAKE','GITHUB_ACTOR':'test'}|override,capture_output=True,text=True)
    self.assertNotEqual(r.returncode,0)

class BuildManifest(unittest.TestCase):
 def test_optional_image_same_sha(self):
  script=Path('scripts/chatops/build-pair.sh').resolve()
  with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as td:
   root=Path(td);docker=root/'docker'
   docker.write_text("""#!/usr/bin/env python3
import sys,json
from pathlib import Path
a=sys.argv[1:]
if a[:2]==['buildx','build']:
 app=a[a.index('-f')+1].split('/')[1]
 assert a[a.index('--platform')+1]=='linux/amd64'
 if app=='admin':assert a[a.index('--build-arg')+1]=='ADMIN_DEV_PATH_BUILD=1'
 else:assert '--build-arg' not in a
 assert 'org.opencontainers.image.revision='+'a'*40 in a
 assert 'org.opencontainers.image.source=https://github.com/anpavel84-afk/gobadminton-clean' in a
 Path(a[a.index('--metadata-file')+1]).write_text(json.dumps({'containerimage.digest':'sha256:'+{'api':'b','web':'c','admin':'f'}[app]*64}))
 Path(app+'.built').touch()
""")
   docker.chmod(0o755)
   env=os.environ|{'PATH':str(root.resolve())+':'+os.environ['PATH'],'GITHUB_SHA':legacy.SHA,'GITHUB_REPOSITORY':'anpavel84-afk/gobadminton-clean','GITHUB_REF':'refs/heads/dev','GITHUB_ENVIRONMENT':'dev','GH_TOKEN':'FAKE','GITHUB_ACTOR':'test','GITHUB_RUN_ID':'123'}
   for flag in ['false','true']:
    r=subprocess.run(['bash',str(script)],cwd=root,env=env|{'CHATOPS_DEV_ADMIN_COMMISSIONED':flag},text=True,capture_output=True)
    self.assertEqual(r.returncode,0,r.stderr)
    manifest=json.loads((root/'_out/release.json').read_text())
    expected={'schema':1,'source_sha':legacy.SHA,'api_digest':legacy.API,'web_digest':legacy.WEB,'dev_run_id':123}
    if flag=='true':expected['admin_digest']=ADMIN
    else:self.assertFalse((root/'admin.built').exists())
    self.assertEqual(manifest,expected)

if __name__=='__main__': unittest.main(verbosity=2)

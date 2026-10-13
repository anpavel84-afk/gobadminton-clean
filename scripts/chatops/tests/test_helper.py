#!/usr/bin/env python3
"""Local integration tests with FAKE Docker/curl. Never connects to any VPS.
Requires Linux, root (for permission assertions), bash, jq, flock, timeout.
"""
import json, os, shutil, subprocess, tempfile, unittest
from pathlib import Path
SOURCE=Path(__file__).resolve().parents[1]/'server/gb-deploy-helper.sh'
SHA='a'*40
API='sha256:'+'b'*64
WEB='sha256:'+'c'*64
MOCK=r'''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
root=Path(os.environ['MOCK_ROOT']); p=root/'docker.json'
a=sys.argv[1:]; d=json.loads(p.read_text())
def save():p.write_text(json.dumps(d))
if a[0]=='pull':print(a[1]);sys.exit(0)
if a[:2]==['image','inspect']:
 print(json.dumps([{'Config':{'Labels':{'org.opencontainers.image.revision':os.environ['TEST_SHA']}}}]));sys.exit(0)
if a[0]=='inspect':
 item=d[a[1]]
 print(json.dumps([{'Image':item['image'],'State':{'Running':True,'Health':{'Status':'healthy'}},
 'Config':{'Labels':{'com.docker.compose.project':item['project'],'com.docker.compose.service':item['service']},
 'Env':['GIT_SHA='+item['sha']]}}]));sys.exit(0)
if a[0]=='exec':
 if 'pg_dump' in a:sys.stdout.write('PGDMPdummy');sys.exit(0)
 raise SystemExit(2)
if a[0]=='compose':
 project=a[a.index('--project-name')+1]
 action=next(x for x in a if x in ['ps','up','run'])
 if action=='ps':print(project+'-'+a[-1]);sys.exit(0)
 if action=='run':sys.exit(int(os.environ.get('FAIL_MIGRATION','0')))
 files=[a[i+1] for i,x in enumerate(a) if x=='-f'];overlay=json.loads(Path(files[-1]).read_text())
 names=[x for x in a[a.index('up')+1:] if x in ['api','web']]
 candidate=False
 for s in names:
  o=overlay['services'][s]; image=o['image']; candidate|=image.startswith('ghcr.io')
  d[project+'-'+s].update(image=image.split('@')[-1],sha=o.get('environment',{}).get('GIT_SHA',d[project+'-'+s]['sha']))
 save()
 if candidate and os.environ.get('FAIL_UP')=='1':raise SystemExit(5)
 sys.exit(0)
raise SystemExit('unsupported fake docker: '+repr(a))
'''
CURL=r'''#!/usr/bin/env python3
import os,json
from pathlib import Path
d=json.loads((Path(os.environ['MOCK_ROOT'])/'docker.json').read_text())
print(json.dumps({'gitSha':d['testdev-api']['sha']}))
'''
@unittest.skipUnless(os.geteuid()==0,'Root needed for local root-ownership assertions')
class TestHelper(unittest.TestCase):
 def setUp(self):
  self.root=Path(tempfile.mkdtemp(prefix='gb-helper-test-',dir='/root'))
  for n in ['config','state']:(self.root/n).mkdir(mode=0o700)
  (self.root/'config/dev.env').write_text('DUMMY=1\n');(self.root/'config/docker-compose.dev.yml').write_text('services: {}\n')
  cfg=f'''PROJECT=testdev
COMPOSE_FILES=({self.root}/config/docker-compose.dev.yml)
ENV_FILE={self.root}/config/dev.env
SERVICES=(api web)
DB_USER=gobadminton
DB_NAME=gobadminton
REGISTRY_PREFIX=ghcr.io/anpavel84-afk/gobadminton-clean
MIGRATE=1
API_META_URL=http://127.0.0.1/meta
'''
  for e in ['dev','prod']:(self.root/f'config/{e}.conf').write_text(cfg)
  for name,text in [('docker',MOCK),('curl',CURL)]:
   p=self.root/name;p.write_text(text);p.chmod(0o755)
  source=SOURCE.read_text().replace('CONFIG_ROOT=/etc/gobadminton/deploy',f'CONFIG_ROOT={self.root}/config').replace('STATE_ROOT=/var/lib/gobadminton-deploy',f'STATE_ROOT={self.root}/state').replace('DOCKER=/usr/bin/docker',f'DOCKER={self.root}/docker').replace('CURL=/usr/bin/curl',f'CURL={self.root}/curl')
  self.helper=self.root/'helper.sh';self.helper.write_text(source);self.helper.chmod(0o755)
  data={f'testdev-{s}':{'project':'testdev','service':s,'image':'sha256:'+'d'*64,'sha':'e'*40} for s in ['api','web','db']}
  (self.root/'docker.json').write_text(json.dumps(data))
 def tearDown(self):shutil.rmtree(self.root)
 def invoke(self,payload,envname='dev',extra=None,watchdog=False):
  env=os.environ|{'MOCK_ROOT':str(self.root),'TEST_SHA':SHA,'SUDO_USER':f'gb-deploy-{envname}'}|(extra or {})
  if watchdog:env.pop('SUDO_USER',None)
  args=['bash',str(self.helper)]+(['--watchdog'] if watchdog else [])+[envname]
  return subprocess.run(args,input=json.dumps(payload),text=True,capture_output=True,env=env,timeout=20)
 def req(self):return {'action':'deploy','release_id':'r123-a1','sequence':1001,'source_sha':SHA,'api_digest':API,'web_digest':WEB,'expected_previous_sha':''}
 def test_status(self):
  r=self.invoke({'action':'status'});self.assertEqual(r.returncode,0,r.stderr);self.assertIsNone(json.loads(r.stdout)['pending'])
 def test_wrong_credential(self):self.assertNotEqual(self.invoke({'action':'status'},'prod',{'SUDO_USER':'gb-deploy-dev'}).returncode,0)
 def test_unknown_field(self):self.assertNotEqual(self.invoke(self.req()|{'command':'id'}).returncode,0)
 def test_injected_id(self):self.assertNotEqual(self.invoke(self.req()|{'release_id':'r1-a1;id'}).returncode,0)
 def test_wrong_digest(self):self.assertNotEqual(self.invoke(self.req()|{'api_digest':'latest'}).returncode,0)
 def test_prod_without_baseline(self):self.assertNotEqual(self.invoke(self.req()|{'expected_previous_sha':'e'*40},'prod').returncode,0)
 def test_group_write_config(self):
  (self.root/'config/dev.conf').chmod(0o664);self.assertNotEqual(self.invoke({'action':'status'}).returncode,0)
 def test_symlink_config(self):
  p=self.root/'config/dev.conf';p.rename(self.root/'config/real.conf');p.symlink_to('real.conf');self.assertNotEqual(self.invoke({'action':'status'}).returncode,0)
 def test_apply_accept(self):
  r=self.invoke(self.req());self.assertEqual(r.returncode,0,r.stderr)
  self.assertEqual(json.loads(r.stdout)['pending']['status'],'PENDING_SMOKE')
  r=self.invoke({'action':'accept','release_id':'r123-a1'});self.assertEqual(r.returncode,0,r.stderr)
  self.assertEqual(json.loads(r.stdout)['accepted']['source_sha'],SHA)
 def test_failed_up_rolls_back(self):
  r=self.invoke(self.req(),extra={'FAIL_UP':'1'});self.assertNotEqual(r.returncode,0)
  s=json.loads(self.invoke({'action':'status'}).stdout)
  self.assertIsNone(s['pending']);self.assertEqual(s['last_result']['status'],'ROLLED_BACK')
  self.assertEqual(json.loads((self.root/'docker.json').read_text())['testdev-api']['sha'],'e'*40)
 def test_failed_migration_rolls_back_app(self):
  r=self.invoke(self.req(),extra={'FAIL_MIGRATION':'1'});self.assertNotEqual(r.returncode,0)
  self.assertIsNone(json.loads(self.invoke({'action':'status'}).stdout)['pending'])
 def test_pending_blocks_new_release(self):
  self.assertEqual(self.invoke(self.req()).returncode,0)
  self.assertNotEqual(self.invoke(self.req()|{'release_id':'r124-a1','sequence':2001}).returncode,0)
 def test_stale_accept_rejected(self):
  self.assertEqual(self.invoke(self.req()).returncode,0)
  self.assertNotEqual(self.invoke({'action':'accept','release_id':'r124-a1'}).returncode,0)
 def test_watchdog(self):
  self.assertEqual(self.invoke(self.req()).returncode,0)
  p=self.root/'state/dev/pending.json';d=json.loads(p.read_text());d['deadline']=1;p.write_text(json.dumps(d))
  r=self.invoke({},watchdog=True);self.assertEqual(r.returncode,0,r.stderr)
  self.assertEqual(json.loads(self.invoke({'action':'status'}).stdout)['last_result']['status'],'ROLLED_BACK')
 def test_compensating_rollback_after_accept(self):
  self.assertEqual(self.invoke(self.req()).returncode,0)
  self.assertEqual(self.invoke({'action':'accept','release_id':'r123-a1'}).returncode,0)
  r=self.invoke({'action':'rollback','release_id':'r123-a1'});self.assertEqual(r.returncode,0,r.stderr)
  self.assertIsNone(json.loads(r.stdout)['accepted'])
if __name__=='__main__':unittest.main(verbosity=2)

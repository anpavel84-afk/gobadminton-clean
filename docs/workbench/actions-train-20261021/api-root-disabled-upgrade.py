#!/usr/bin/python3
"""OPS #158 exact one-file update. WORKING DRAFT until focused review. DRY unless --apply.
Only a disabled, never-activated train may receive this canonical repository URL correction.
Original pre-migration rollback images/checkpoints/budgets are never overwritten.
"""
from pathlib import Path
import os,sys,json,stat,hashlib,fcntl,tempfile,subprocess
ROOT=Path('/var/lib/gb-actions-api-root-fix-20261021')
STATE=Path('/var/lib/gobadminton-actions-train')
CORE=Path('/usr/local/lib/gb-actions-train/core.py')
POLICY=Path('/etc/gobadminton-actions-train/policy.json')
OLD_CORE='5c0a3d264daef7c7b2a86f57670e5c9a57312e82d48e5c10dc68a95014d8c747'
NEW_CORE='3dc30f342fddeacba81a7a2a40cee1df31425a0858f849925f4510330f490560'
OLD_MANIFEST='a623fca645448f08615a9f31bb830fa92accaba69db370621dc184ea2af13b61'
NEW_MANIFEST='48d26e33ce0f4751c90deca21fd32a3c65714ee09e99eb8ee0da219e4539f795'
def need(ok,msg):
 if not ok:raise RuntimeError(msg)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def read(path):
 for p in reversed(path.parents):
  t=p.lstat();need(stat.S_ISDIR(t.st_mode) and t.st_uid==0 and not t.st_mode&0o022,'untrusted parent')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 with os.fdopen(fd,'rb') as f:
  t=os.fstat(f.fileno());need(stat.S_ISREG(t.st_mode) and t.st_uid==0 and t.st_nlink==1 and not t.st_mode&0o022 and t.st_size<=2097152,'untrusted file')
  return f.read(2097153)
def atomic(path,raw,mode):
 fd,tmp=tempfile.mkstemp(prefix='.api-root-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:os.fchmod(f.fileno(),mode);f.write(raw);f.flush();os.fsync(f.fileno())
  os.replace(tmp,path)
  fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
 finally:
  if os.path.lexists(tmp):os.unlink(tmp)
need(os.geteuid()==0 and sys.argv[1:] in ([],['--apply']),'root and closed CLI required')
policy_raw=read(POLICY);policy=json.loads(policy_raw)
need(policy['mode']=='disabled' and policy['owned']=={} and policy['controller_sha'] is None,'train already activated')
for unit in ('gobadminton-supervisor.service','gobadminton-slot@slot1.service','gobadminton-slot@slot2.service'):
 r=subprocess.check_output(['/usr/bin/systemctl','show',unit,'--property=ActiveState,MainPID'],text=True)
 v=dict(x.split('=',1) for x in r.splitlines());need(v['ActiveState']=='inactive' and v['MainPID']=='0','legacy worker active')
need(not (STATE/'activation.json').exists() and not (STATE/'integration.json').exists(),'unexpected activation/reservation')
for name in ('slot1.json','slot2.json'):
 if (STATE/name).exists():
  v=json.loads(read(STATE/name));need(not v.get('pending') and not v.get('operations'),'existing execution journal')
record_path=STATE/'backup.json';before_record=read(record_path);record=json.loads(before_record)
need(record['manifest']==OLD_MANIFEST,'unexpected current release')
for name,expected in record['after'].items():need(sha(read(Path(name)))==expected,'installed payload drift')
before_core=read(CORE);new_core=read(ROOT/'new-core.py');new_manifest=read(ROOT/'new-manifest.json')
need(sha(before_core)==OLD_CORE and sha(new_core)==NEW_CORE and sha(new_manifest)==NEW_MANIFEST,'unreviewed bytes')
a=b"url = path if public else f'https://api.github.com/repos/{REPO}/{path}'"
b=b"url = path if public else f'https://api.github.com/repos/{REPO}' + ('/' + path if path else '')"
need(before_core.count(a)==1 and before_core.replace(a,b)==new_core,'not the exact one-line correction')
updated=json.loads(before_record);updated['manifest']=NEW_MANIFEST;updated['after'][str(CORE)]=NEW_CORE
if not sys.argv[1:]:print(json.dumps({'dry':True,'old_core':OLD_CORE,'new_core':NEW_CORE,'new_manifest':NEW_MANIFEST}));sys.exit()
read(STATE/'controller.lock')
fd=os.open(STATE/'controller.lock',os.O_RDWR|os.O_NOFOLLOW);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
need(read(POLICY)==policy_raw and read(CORE)==before_core and read(record_path)==before_record,'concurrent change')
for name,raw in (('prior-core.py',before_core),('prior-backup.json',before_record)):
 p=ROOT/name;need(not os.path.lexists(p),'upgrade evidence already exists');atomic(p,raw,0o600)
try:
 atomic(CORE,new_core,0o644)
 atomic(record_path,(json.dumps(updated,sort_keys=True)+'\n').encode(),0o600)
 need(sha(read(CORE))==NEW_CORE and json.loads(read(record_path))==updated,'post-write verification failed')
except BaseException:
 atomic(CORE,before_core,0o644);atomic(record_path,before_record,0o600);raise
print(json.dumps({'applied':True,'mode':'disabled','new_manifest':NEW_MANIFEST,'original_rollback_images_preserved':True}))

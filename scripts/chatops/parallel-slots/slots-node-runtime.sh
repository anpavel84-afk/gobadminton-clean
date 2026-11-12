#!/bin/bash
set -euo pipefail
python3 -I - "$@" <<'PY'
import os,sys,stat,hashlib,json,tempfile,shutil,ctypes,errno,fcntl,subprocess,signal
from pathlib import Path
ROOT=Path('/opt/gb-slots/runtime');SRC=Path('/opt/gobadminton-clean-qa')
PINS={'node':'ccec5bf740a7118080bbfd6736f84865d97a325498beee277aeccd4055349d1a','pnpm':'39da3b4ee7a52ce8423729ed1dd768c1bd60995e0db67293980e5eacd4e75d97'}
PNPM='#!/bin/sh\nexec /opt/gb-slots/runtime/node/bin/node /opt/gb-slots/runtime/pnpm/bin/pnpm.cjs "$@"\n'
def inventory(root):
 rows=[]
 for p in [root,*sorted(root.rglob('*'))]:
  st=p.lstat();assert st.st_uid==st.st_gid==0
  mode=stat.S_IMODE(st.st_mode);rel=str(p.relative_to(root))
  if p.is_symlink():
   target=os.readlink(p);assert not os.path.isabs(target) and p.resolve().is_relative_to(root.resolve());value='link:'+target
  else:
   assert not mode&0o022
   if p.is_dir():value='dir'
   else:assert p.is_file();value=hashlib.sha256(p.read_bytes()).hexdigest()
  rows.append([rel,mode,value])
 return rows
def digest(rows):return hashlib.sha256(json.dumps(rows,ensure_ascii=True,separators=(',',':')).encode()).hexdigest()
def ancestors(p):
 for d in [p,*p.parents]:
  st=d.lstat();assert stat.S_ISDIR(st.st_mode) and st.st_uid==st.st_gid==0 and not st.st_mode&0o022
libc=ctypes.CDLL(None,use_errno=True)
def rename_new(a,b):
 rc=libc.renameat2(-100,os.fsencode(a),-100,os.fsencode(b),1)
 if rc:raise OSError(ctypes.get_errno(),'atomic no-replace rename failed')
SIGNALS={signal.SIGINT,signal.SIGTERM,signal.SIGHUP}
def interrupted(signum,frame):raise RuntimeError('runtime transaction interrupted')
for sig in SIGNALS:signal.signal(sig,interrupted)
assert os.getuid()==0 and sys.argv[1:] in ([],['--remove'])
dry=os.environ.get('DRY')=='1';remove=sys.argv[1:]==['--remove'];ancestors(ROOT);ancestors(SRC)
if not dry:
 fd=os.open('/run/gb-slots-node-runtime.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
expected={}
for name,pin in PINS.items():
 rows=inventory(SRC/name);assert digest(rows)==pin
 if name=='node':
  rows=[([rel,0o755,hashlib.sha256(PNPM.encode()).hexdigest()] if rel=='bin/pnpm' else [rel,mode,value]) for rel,mode,value in rows]
 expected[name]=digest(rows)
 p=ROOT/name
 if os.path.lexists(p):assert digest(inventory(p))==expected[name]
 # Missing targets are valid for partial-install recovery and idempotent removal.
if remove:
 assert subprocess.run(['systemctl','is-active','--quiet','gobadminton-slot@slot2.service']).returncode!=0
if dry:print('DRY: local public Node/pnpm source pins and destination guards passed; no writes');sys.exit()
staging=Path(tempfile.mkdtemp(prefix='.node-runtime-',dir=ROOT));changed=[];cleanup=True
def transact_rename(a,b,record):
 oldmask=signal.pthread_sigmask(signal.SIG_BLOCK,SIGNALS)
 try:rename_new(a,b);changed.append(record)
 finally:signal.pthread_sigmask(signal.SIG_SETMASK,oldmask)
try:
 for name in PINS:
  target=ROOT/name;temp=staging/name
  if remove:
   if os.path.lexists(target):transact_rename(target,temp,(name,'remove'))
   continue
  if os.path.lexists(target):continue
  shutil.copytree(SRC/name,temp,symlinks=True)
  if name=='node':
   p=temp/'bin/pnpm';p.unlink();p.write_text(PNPM);p.chmod(0o755)
  assert digest(inventory(temp))==expected[name]
  transact_rename(temp,target,(name,'install'))
except BaseException:
 cleanup=False
 for sig in SIGNALS:signal.signal(sig,signal.SIG_IGN)
 for name,action in reversed(changed):
  a,b=(ROOT/name,staging/name) if action=='install' else (staging/name,ROOT/name)
  assert digest(inventory(a))==expected[name];rename_new(a,b)
 cleanup=True
 raise
finally:
 # Only this private staging directory and verified local public runtime copies are removed.
 for sig in SIGNALS:signal.signal(sig,signal.SIG_IGN)
 if cleanup:shutil.rmtree(staging)
 else:print('Rollback held; retained staging: '+str(staging),file=sys.stderr)
print('Node/pnpm runtime '+('removed' if remove else 'installed')+' from pinned local public bundles; no downloads or credentials')

PY

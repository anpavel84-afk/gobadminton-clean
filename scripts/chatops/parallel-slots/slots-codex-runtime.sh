#!/bin/bash
set -euo pipefail
python3 -I - "$@" <<'PY'
import os,sys,stat,hashlib,tempfile,fcntl,subprocess,signal
from pathlib import Path
assert os.getuid()==0 and sys.argv[1:] in ([],['--remove'])
remove=sys.argv[1:]==['--remove'];dry=os.environ.get('DRY')=='1'
source=Path('/opt/gobadminton-clean-qa/bin/codex');target=Path('/opt/gb-slots/runtime/codex')
newsha='f34a4d2301892ae96c90097786bfe5dc269f187b6f69faf42a7b357b8c081e35'
old=b'#!/bin/bash\nset -euo pipefail\nprintf "%s\\n" "f34a4d2301892ae96c90097786bfe5dc269f187b6f69faf42a7b357b8c081e35  /opt/gobadminton-clean-qa/bin/codex" | /usr/bin/sha256sum -c --status\nexec /opt/gobadminton-clean-qa/bin/codex "$@"\n'
oldsha=hashlib.sha256(old).hexdigest()
def digest(data):return hashlib.sha256(data).hexdigest()
def read_public(path):
 for parent in reversed(path.parents):
  s=parent.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and not s.st_mode&0o022
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());assert stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o755
  data=f.read();assert len(data)==s.st_size
 return data
lock=os.open('/run/gb-slots-codex-runtime.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
st=os.fstat(lock);assert stat.S_ISREG(st.st_mode) and st.st_uid==st.st_gid==0 and st.st_nlink==1 and not st.st_mode&0o077
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
state=subprocess.run(['systemctl','is-active','gobadminton-slot@slot2.service'],capture_output=True,text=True)
assert state.stdout.strip() in ('inactive','failed','unknown'), 'slot2 must be stopped'
data=read_public(source);assert digest(data)==newsha
current=read_public(target);assert digest(current) in (oldsha,newsha)
wanted=old if remove else data
if dry:print('DRY: exact root-owned public Codex binary/wrapper verified; no runtime writes');sys.exit()
if current==wanted:print('Codex runtime already matches requested bytes');sys.exit()
def interrupted(signum,frame):raise RuntimeError('interrupted before publication')
for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(sig,interrupted)
fd,temp=tempfile.mkstemp(prefix='.codex-pinned-',dir=target.parent)
try:
 with os.fdopen(fd,'wb') as f:
  os.fchown(f.fileno(),0,0);os.fchmod(f.fileno(),0o755);f.write(wanted);f.flush();os.fsync(f.fileno())
 assert digest(read_public(Path(temp)))==digest(wanted)
 assert read_public(target)==current
 # Root owns every directory in this chain; publication is one atomic replacement.
 blocked=signal.pthread_sigmask(signal.SIG_BLOCK,{signal.SIGTERM,signal.SIGINT,signal.SIGHUP})
 try:
  os.replace(temp,target)
  directory=os.open(target.parent,os.O_DIRECTORY|os.O_RDONLY);os.fsync(directory);os.close(directory)
 finally:signal.pthread_sigmask(signal.SIG_SETMASK,blocked)
finally:
 if os.path.lexists(temp):os.unlink(temp)
print('Codex runtime '+('restored to pinned wrapper' if remove else 'installed as pinned standalone binary')+'; no authentication files accessed')
PY

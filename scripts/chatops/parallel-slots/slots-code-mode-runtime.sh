#!/bin/bash
set -euo pipefail
python3 -I - "$@" <<'PY'
import os,sys,stat,hashlib,tempfile,fcntl,subprocess
from pathlib import Path
assert os.getuid()==0 and sys.argv[1:] in ([],['--remove'])
dry=os.environ.get('DRY')=='1';remove=sys.argv[1:]==['--remove']
source=Path('/opt/gobadminton-clean-qa/bin/codex-code-mode-host');target=Path('/opt/gb-slots/runtime/codex-code-mode-host')
sha='b33e8a5283f3c65c2a0aca6d43a59cfe850f624d8fa16992e3cad4fcc27c14e1'
def read_public(p, expected):
 for d in reversed(p.parents):
  s=d.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and not s.st_mode&0o022
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());assert stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o755
  data=f.read();assert len(data)==s.st_size and hashlib.sha256(data).hexdigest()==expected
 return data
fd=os.open('/run/gb-slots-code-mode-runtime.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
s=os.fstat(fd);assert stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and not s.st_mode&0o077
fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
r=subprocess.run(['systemctl','is-active','gobadminton-slot@slot2.service'],capture_output=True,text=True)
assert r.stdout.strip() in ('inactive','failed','unknown'),'slot2 must be stopped'
read_public(target.parent/'codex','f34a4d2301892ae96c90097786bfe5dc269f187b6f69faf42a7b357b8c081e35')
data=read_public(source,sha)
exists=os.path.lexists(target)
if exists:read_public(target,sha)
if dry:print('DRY: exact standalone Codex and matching public code-mode helper verified; no runtime writes');sys.exit()
if remove:
 if exists:target.unlink()
 print('Pinned code-mode helper removed');sys.exit()
if not exists:
 fd,temp=tempfile.mkstemp(prefix='.code-mode-host-',dir=target.parent)
 try:
  with os.fdopen(fd,'wb') as f:
   os.fchown(f.fileno(),0,0);os.fchmod(f.fileno(),0o755);f.write(data);f.flush();os.fsync(f.fileno())
  os.link(temp,target,follow_symlinks=False)
 finally:
  if os.path.lexists(temp):os.unlink(temp)
print('Pinned public code-mode helper installed; authentication not accessed')
PY

#!/bin/bash
set -euo pipefail
python3 -I - "$@" <<'PYINSTALL'
import os,sys,stat,hashlib,tempfile,fcntl
from pathlib import Path
assert os.getuid()==0 and sys.argv[1:] in ([],['--remove'])
before='8f627b8945255d1a251703e87f4aad8f0634b448d4685c7ddab96681bf52b8a4'
after='7f8c35461b7a23d48677512e60d6abc6f1f53c5af0bb5372a9b006a5c6f0822f'
anchor='pins={"autonomous_issues.py":"0b367097be3aa5596327ebec14807b6f8ca39904e6a7279dbcb67b057c23f293","slots.py":"4fc51152b0f8a5bc97743101feca7e5f5e97c7ad791d6783def0b3bd3d6324b7"}\n'
block='pins={"autonomous_issues.py":"9995d0f268185c56d91cd0e15f986905abf093feb07c6edffec0c9b211e2fec7","slots.py":"1b4708b6ff64071074399cfcfd3c4c73f93501efdcd9266e9dafc61b927fb98c"}\n'
target=Path('/usr/local/sbin/gb-ops/codex-review')
for p in reversed(target.parents):
 s=p.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and not s.st_mode&0o022
fd=os.open('/run/gb-slot-review-metadata.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
s=os.fstat(fd);assert stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and not s.st_mode&0o077
fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
def read_public():
 fd=os.open(target,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());assert stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o755 and s.st_size<100000
  return f.read(100000)
def sha(data):return hashlib.sha256(data).hexdigest()
current=read_public();assert sha(current) in (before,after),'protected wrapper drift'
remove=sys.argv[1:]==['--remove'];expected=before if remove else after
if sha(current)==expected:print('Review wrapper already matches requested bytes');sys.exit()
source,replacement=(block,anchor) if remove else (anchor,block)
text=current.decode('utf-8');assert text.count(source)==1
wanted=text.replace(source,replacement,1).encode('utf-8');assert sha(wanted)==expected
if os.environ.get('DRY')=='1':print('DRY: exact review-wrapper metadata patch and rollback hashes verified; no writes');sys.exit()
fd,temp=tempfile.mkstemp(prefix='.slot-install-metadata-',dir=target.parent)
try:
 with os.fdopen(fd,'wb') as f:
  os.fchown(f.fileno(),0,0);os.fchmod(f.fileno(),0o755);f.write(wanted);f.flush();os.fsync(f.fileno())
 assert read_public()==current
 os.replace(temp,target)
finally:
 if os.path.lexists(temp):os.unlink(temp)
print('Trusted installed-format metadata added to review wrapper; validation and review gates unchanged')
PYINSTALL

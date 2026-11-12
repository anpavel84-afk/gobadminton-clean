#!/bin/bash
set -euo pipefail
python3 -I - "$@" <<'PY'
import os,sys,stat,hashlib,tempfile,fcntl
from pathlib import Path
FILES = [('/opt/gb-slots/runtime/codex', '#!/bin/bash\nset -euo pipefail\nprintf "%s\\n" "f34a4d2301892ae96c90097786bfe5dc269f187b6f69faf42a7b357b8c081e35  /opt/gobadminton-clean-qa/bin/codex" | /usr/bin/sha256sum -c --status\nexec /opt/gobadminton-clean-qa/bin/codex "$@"\n', 493), ('/etc/gobadminton-slots/slot2-known_hosts', 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\ngithub.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=\ngithub.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=\n', 420)]
assert os.getuid()==0 and sys.argv[1:] in ([],['--remove'])
dry=os.environ.get('DRY')=='1';remove=sys.argv[1:]==['--remove']
if not dry:
 lock=os.open('/run/gb-slots-runtime.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
def metadata(p):
 for d in [p,*p.parents]:
  if d.exists() or d.is_symlink():
   st=d.lstat();assert not stat.S_ISLNK(st.st_mode) and st.st_uid==0 and st.st_gid==0 and not st.st_mode&0o022
def ensure_dir(p):
 if p.exists():metadata(p);return
 ensure_dir(p.parent);os.mkdir(p,0o755);os.chown(p,0,0);os.chmod(p,0o755);metadata(p)
for name,data,mode in FILES:
 p=Path(name);metadata(p)
 if p.exists():assert p.is_file() and p.read_bytes()==data.encode() and stat.S_IMODE(p.stat().st_mode)==mode
 elif remove:raise RuntimeError('missing runtime file; no partial removal')
source=Path('/opt/gobadminton-clean-qa/bin/codex');metadata(source)
assert hashlib.sha256(source.read_bytes()).hexdigest()=='f34a4d2301892ae96c90097786bfe5dc269f187b6f69faf42a7b357b8c081e35'
if dry:print('DRY: pinned runtime and public trust files verified; no writes');sys.exit()
created=[];removed=[]
try:
 for name,data,mode in FILES:
  p=Path(name)
  if remove:p.unlink();removed.append((p,data,mode));continue
  if p.exists():continue
  ensure_dir(p.parent)
  fd,t=tempfile.mkstemp(prefix='.slots-runtime-',dir=p.parent)
  try:
   with os.fdopen(fd,'w') as f:os.fchown(f.fileno(),0,0);os.fchmod(f.fileno(),mode);f.write(data);f.flush();os.fsync(f.fileno())
   os.link(t,p,follow_symlinks=False);created.append(p)
  finally:
   if os.path.exists(t):os.unlink(t)
except BaseException:
 for p in created:
  if p.exists() and p.read_bytes()==next(x[1].encode() for x in FILES if x[0]==str(p)):p.unlink()
 for p,data,mode in removed:
  fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
  with os.fdopen(fd,'w') as f:os.fchown(f.fileno(),0,0);os.fchmod(f.fileno(),mode);f.write(data);f.flush();os.fsync(f.fileno())
 raise
print('runtime/trust '+('removed' if remove else 'installed')+'; existing authentication and private keys untouched')

PY

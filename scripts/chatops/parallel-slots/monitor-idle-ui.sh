#!/bin/bash
set -euo pipefail
python3 -I - "$@" <<'PYINSTALL'
import os,sys,stat,hashlib,tempfile,fcntl
from pathlib import Path
assert os.getuid()==0 and sys.argv[1:] in ([],['--remove'])
changes=[("var s = clear($('now')); s.appendChild(el('h2', null, 'Сейчас выполняется'));", "var s = clear($('now')), finished = d.claim && d.claim.phase === 'done';\n    s.appendChild(el('h2', null, d.source_mode === 'slots' ? 'Состояние слотов' : (finished || !d.claim ? 'Состояние исполнителя' : 'Сейчас выполняется')));"), ("    s.appendChild(el('div', 'big', c.issue != null ? nm(c.issue, c.desc, c.title_source === 'goal' ? c.title : null) : (c.title || 'без названия')));", "    if (finished) {\n      s.appendChild(el('div', 'big', 'Активной задачи нет'));\n      s.appendChild(el('div', 'mut', 'Ниже — результат последней завершённой задачи.'));\n    }\n    s.appendChild(el('div', 'big', c.issue != null ? nm(c.issue, c.desc, c.title_source === 'goal' ? c.title : null) : (c.title || 'без названия')));"), ("rows.push(['Замечено монитором',", "rows.push([finished ? 'Результат замечен монитором' : 'Состояние задачи не менялось',"), ("'данные свежие · ' + ago(d.age_s)", "'Снимок обновлён · ' + ago(d.age_s)"), ("    if (!stale && d.source_mode === 'slots') {", "    f.title = 'Свежесть отчёта не означает, что задача сейчас выполняется.';\n    if (!stale && d.source_mode === 'slots') {")]
before='e74d41d4d2973bb0e506a422624c891f32766b4ff5d1044d6e5a6803b63adca5'
after='9c4a4eb86ca9aab9905af8cb6963383d0654fd50d7407da4410ae5b623714035'
target=Path('/usr/local/lib/gb-ops-monitor/web/app.js')
for parent in reversed(target.parents):
 s=parent.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and not s.st_mode&0o022
fd=os.open('/run/gb-monitor-idle-ui.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
s=os.fstat(fd);assert stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and not s.st_mode&0o077
fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
def read_public():
 fd=os.open(target,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());assert stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o644 and s.st_size<100000
  return f.read(100000)
def sha(data):return hashlib.sha256(data).hexdigest()
current=read_public();current_sha=sha(current);assert current_sha in (before,after),'unreviewed app.js drift'
remove=sys.argv[1:]==['--remove'];expected=before if remove else after
if current_sha==expected:
 print('Monitor UI already matches requested bytes');sys.exit()
text=current.decode('utf-8')
for source,replacement in ([(b,a) for a,b in reversed(changes)] if remove else changes):
 assert text.count(source)==1,'UI patch anchor drift'
 text=text.replace(source,replacement,1)
wanted=text.encode('utf-8');assert sha(wanted)==expected,'UI output hash mismatch'
if os.environ.get('DRY')=='1':print('DRY: exact monitor UI input/output hashes verified; no writes');sys.exit()
fd,temp=tempfile.mkstemp(prefix='.monitor-idle-ui-',dir=target.parent)
try:
 with os.fdopen(fd,'wb') as f:
  os.fchown(f.fileno(),0,0);os.fchmod(f.fileno(),0o644);f.write(wanted);f.flush();os.fsync(f.fileno())
 assert read_public()==current
 os.replace(temp,target)
finally:
 if os.path.lexists(temp):os.unlink(temp)
print('Exact monitor UI labels patched; restart existing web service to load static JS')
PYINSTALL

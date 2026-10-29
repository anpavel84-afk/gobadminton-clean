#!/usr/bin/python3
"""Stage 5 lib-only transaction, never an installer deployment authorization.

V2 changes only stage.py, context_cursor_delivery.py, inventory and private
transaction artifacts. Explicit --version 3 permits only the six reviewed
libraries, accepted rules artifact, both markers' module pins and inventory
entries under exact OLD->NEW and frozen C5 protocol gates. This is source only;
independent QA/CI and release acceptance remain external install prerequisites.
V3 never grants a role: existing Cursor author history is retained for the exact
stronger RO guard delta; AGY remains canary; context qualification is unaccepted.
For V2 policy/controller/workflows/monitor/markers, rules, budgets and task
evidence remain byte-identical. Units must already be
masked and idle. activate records hosted proof ONLY: it cannot assert READY or
qualify scoped_v1. V2 still requires a separate reviewed guard/marker transition.
A preparing journal precedes backups; applying/rolling-back intents precede lib
writes. An interrupted operation requires explicit validated rollback (or proof
reconciliation), never blind apply/replay. Backups and terminal receipts remain.
Reads/Git/atomic writes follow the reviewed AGY29 small-range/pkg-finish patterns.
--bundle-commit pins the reviewed source (defaults to --controller); --bundle-branch
defaults to dev. Both are checked on every mode, including recovery. Legacy
transaction schemas are refused; an integrator must reconcile those separately.
"""
import argparse
import ast
import copy
import fcntl
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import time
import urllib.request
sys.dont_write_bytecode = True
INSTALL=pathlib.Path('/usr/local/lib/gb-actions-train')
sys.path.insert(0,str(INSTALL))
import receiver
from core import loads
STATE=receiver.STATE
JOURNAL=STATE/'stage5-cursor-context.json'
BACKUP=STATE/'stage5-cursor-context-backup'
TARGETS={'stage.py','context_cursor_delivery.py'}
FROZEN={"native_cursor.py":"02d26f8be9766bbeb1e92dd8514dfc496c1b3e1b0fc8035c1c65cc9aba6b6089",
        "native_guard.py":"dd2e0a0c6c0dea0d353b7dc5f16c1a5d4c4c21f022947ceaa640470c59fb0762"}
INSTALLED_RULES=INSTALL/'accepted-engineering-rules.md'
BUNDLE_RULES='docs/rules/ENGINEERING_OPERATING_MODEL.md'
PREFIX='scripts/chatops/actions_train/'
MANIFEST_PATH=PREFIX+'manifest.json'
SCRIPT_REPO_PATH='scripts/chatops/ops/stage5_cursor_context_upgrade.py'
RULES_COMMIT='13a8b6c54a45aaa57021e092a1bee54926d9eac4'
RULES_SHA256='8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5'
RULES_SIZE=115079
SCHEMA='GB_STAGE5_CURSOR_LIB_ONLY_V2'
OWNER_UID=0
OWNER_GID=0
PROC_LOCKS=pathlib.Path('/proc/locks')

def need(ok,message): receiver.need(ok,message)
def bytes_sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def digest(value): return bytes_sha(encoded(value))

def stable(info):
    # Reads may update atime; inode/content/permission changes must still fail.
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_uid,
            info.st_gid, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def directory_fd(path):
    path = pathlib.Path(path)
    need(path.is_absolute() and '..' not in path.parts, 'noncanonical directory path')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in path.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_file(path, *, trusted=True, limit=67108864, retain=True):
    """Bounded regular single-link read, retaining bytes and metadata from one fd."""
    path=pathlib.Path(path)
    parent=directory_fd(path.parent)
    fd=None
    try:
        if trusted: receiver.trusted_tree(path)
        fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=parent)
        before=os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_nlink==1
             and (not trusted or before.st_uid==OWNER_UID)
             and not before.st_mode & 0o022 and before.st_size<=limit,'unsafe regular file')
        digest_=hashlib.sha256();seen=0;chunks=[]
        with os.fdopen(os.dup(fd),'rb') as stream:
            while True:
                chunk=stream.read(min(1048576,limit+1-seen))
                if not chunk: break
                seen+=len(chunk);need(seen<=limit,'file too large');digest_.update(chunk)
                if retain: chunks.append(chunk)
        raw=b''.join(chunks) if retain else None
        need(seen==before.st_size and stable(os.fstat(fd))==stable(before),
             'file changed during read')
        current=os.stat(path.name,dir_fd=parent,follow_symlinks=False)
        need(stable(current)==stable(before),'file replaced during read')
        check=directory_fd(path.parent)
        try:
            need((os.fstat(check).st_dev,os.fstat(check).st_ino)==
                 (os.fstat(parent).st_dev,os.fstat(parent).st_ino),'parent replaced during read')
        finally: os.close(check)
        return raw,dict(sha256=digest_.hexdigest(),mode=stat.S_IMODE(before.st_mode),uid=before.st_uid,gid=before.st_gid)
    finally:
        if fd is not None: os.close(fd)
        os.close(parent)


def regular_bytes(path): return read_file(path)[0]


def sha(path):
    return bytes_sha(read_file(path)[0])


def run(argv, timeout=20, env=None):
    # No inherited credentials/config, shell, hooks, output/argv in errors, or prompts.
    if env is None: env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root',
           'LANG': 'C.UTF-8', 'GIT_CONFIG_NOSYSTEM': '1',
           'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0',
           'GIT_OPTIONAL_LOCKS': '0', 'GIT_NO_REPLACE_OBJECTS': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
    p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       timeout=timeout, check=False, env=env, stdin=subprocess.DEVNULL)
    need(p.returncode == 0, 'bounded OPS command failed')
    return p.stdout


def git(bundle, *args):
    """Only source()'s verified plain checkout; no discovery or inherited Git state."""
    env = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'HOME': '/nonexistent',
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
           'GIT_CONFIG_SYSTEM': '/dev/null', 'GIT_TERMINAL_PROMPT': '0',
           'GIT_OPTIONAL_LOCKS': '0', 'GIT_ATTR_NOSYSTEM': '1'}
    argv = ['/usr/bin/git', '--no-optional-locks', '--no-replace-objects',
            '--git-dir='+str(bundle/'.git'), '--work-tree='+str(bundle)]
    for option in ('core.fsmonitor=false', 'core.hooksPath=/dev/null',
                   'core.attributesFile=/dev/null', 'core.untrackedCache=false',
                   'protocol.allow=never', 'safe.directory='+str(bundle)):
        argv += ['-c', option]
    return run([*argv, *args], env=env)


def bundle_config(raw):
    """Fail closed on unsupported syntax before Git parses any local config.

    Plain checkout configs need sections and single-line variables only. Reject
    continuations rather than risk disagreeing with Git about a hidden key.
    Both modern quoted subsections and legacy section.subsection are checked.
    """
    need(b'\x00' not in raw, 'unsafe bundle git config syntax')
    section = None
    for line in raw.split(b'\n'):
        line = line.strip(b' \t\r')
        if not line or line[:1] in (b'#', b';'): continue
        need(not line.endswith(b'\\'), 'unsafe bundle git config continuation')
        if line.startswith(b'['):
            match = re.fullmatch(rb'\[([a-zA-Z0-9][a-zA-Z0-9.-]*)(?:[ \t]+"(?:[^"\\\r\n]|\\["\\])*")?\][ \t]*(?:[#;].*)?', line)
            need(match is not None, 'unsafe bundle git config section')
            section = match[1].lower().split(b'.', 1)[0]
            need(section not in (b'filter', b'alias', b'include', b'includeif', b'credential', b'protocol', b'extensions'),
                 'forbidden bundle git config section')
            continue
        match = re.fullmatch(rb'([a-zA-Z][a-zA-Z0-9-]*)[ \t]*(?:=[ \t]*(.*))?', line)
        need(section is not None and match is not None, 'unsafe bundle git config variable')
        key = match[1].lower()
        forbidden = (section == b'diff' and key in (b'textconv', b'command') or
                     section == b'url' and key == b'insteadof' or
                     section == b'core' and key in (b'fsmonitor', b'sshcommand', b'pager', b'editor', b'gitproxy', b'alternaterefscommand'))
        if section == b'core' and key == b'hookspath':
            # Only explicit inert values; the command line also forces /dev/null.
            forbidden = match[2] not in (b'none', b'"none"', b'/dev/null', b'"/dev/null"')
        need(not forbidden, 'forbidden bundle git config key')



def probe(run_id,j):
    def get(path):
        request=urllib.request.Request("https://api.github.com/repos/anpavel84-afk/gobadminton-clean/"+path,
            headers={"User-Agent":"gb-stage5-cursor-readonly","Accept":"application/vnd.github+json"})
        with urllib.request.urlopen(request,timeout=15) as response:raw=response.read(524289)
        need(len(raw)<=524288,"oversize proof")
        return json.loads(raw)
    run=get("actions/runs/"+str(run_id))
    need(run.get("path")==".github/workflows/train-dispatch.yml" and run.get("head_branch")=="dev"
         and run.get("event")=="workflow_dispatch" and run.get("status")=="completed"
         and run.get("conclusion")=="success" and run.get("repository",{}).get("id")==1416250340
         and run.get("head_repository",{}).get("id")==1416250340
         and run.get("actor",{}).get("id") in (318610566,41898282),"invalid hosted shadow proof")
    import datetime as dt,base64
    started=dt.datetime.fromisoformat(run["created_at"].replace("Z","+00:00")).timestamp()
    need(started>=j["installed_at"],"probe predates install")
    jobs=get("actions/runs/"+str(run_id)+"/attempts/"+str(run["run_attempt"])+"/jobs")["jobs"]
    for name in ("reconcile","publish_phase_drafts"):
        need(len([x for x in jobs if x["name"]==name and x["conclusion"]=="success"])==1,"shadow job not successful")
    raw=get("contents/.github/workflows/train-dispatch.yml?ref="+run["head_sha"])
    need(raw.get("encoding")=="base64","invalid workflow proof")
    need(hashlib.sha256(base64.b64decode(raw["content"])).hexdigest()==j["dispatch_sha256"],"shadow workflow differs")
    return {"run":run_id,"head":run["head_sha"],"attempt":run["run_attempt"]}


def lock_unheld(path,uid=0):
    """Observe every kernel lock type; never create or write a slot lock."""
    if not os.path.lexists(path): return
    read_file(path,trusted=False)
    before=path.lstat();need(before.st_uid in (0,uid),'foreign slot lock owner')
    key=(os.major(before.st_dev),os.minor(before.st_dev),before.st_ino)
    for line in PROC_LOCKS.read_text().splitlines():
        for field in line.split():
            if re.fullmatch(r'[0-9a-fA-F]+:[0-9a-fA-F]+:[0-9]+',field):
                major,minor,inode=field.split(':')
                need((int(major,16),int(minor,16),int(inode))!=key,'slot lock inode held')
    need(stable(path.lstat())==stable(before),'slot lock changed')


def quiet():
    receiver.units_quiet(receiver.UNITS)
    # No policy write can disable dispatch: units must ALREADY be masked.
    for unit in receiver.UNITS:
        props=dict(line.split('=',1) for line in run(['/usr/bin/systemctl','show',unit,
            '--property=ActiveState,MainPID,UnitFileState']).decode().splitlines() if '=' in line)
        need(props.get('ActiveState')=='inactive' and props.get('MainPID')=='0'
             and props.get('UnitFileState')=='masked','units must be inactive and masked')
    import pwd
    for slot in ('slot1','slot2'):
        j=receiver.journal(slot);state,_=receiver.checkpoint(slot);active=state.get('active')
        need(j['pending'] is None and (active is None or
             isinstance(active,dict) and active.get('phase')=='done'),'slot must be idle; pending must be none')
        uid=pwd.getpwnam('agentagency-dev' if slot=='slot1' else 'gb-slot2').pw_uid
        receiver.no_models(uid,slot)
        lock_unheld(receiver.AUTONOMY/'slots'/slot/'worker.lock',uid)
        lock_unheld(receiver.AUTONOMY/'locks'/(slot+'.lease'),uid)
    need(not os.path.lexists(STATE/'integration.json'),'integration in flight')
    need(not any(v['status'].endswith('_pending') for v in receiver.recovery_journal()['receipts'].values()),
         'recovery stage in flight')


def preserved(exclude=()):
    """Full state/history/ledger evidence, plus immutable inventory payloads."""
    result={};inventory=STATE/'backup.json'
    excluded=set(exclude)|{JOURNAL,BACKUP,inventory,STATE/'controller.lock',
              JOURNAL.with_name(temp_name(JOURNAL)),inventory.with_name(temp_name(inventory))}
    def walk(path):
        if path in excluded: return
        info=path.lstat()
        need(not stat.S_ISLNK(info.st_mode),'symlink in protected state')
        if stat.S_ISDIR(info.st_mode):
            fd=directory_fd(path)
            try:
                for name in sorted(os.listdir(fd)): walk(path/name)
                need(stable(path.lstat())==stable(info),'protected directory changed')
            finally: os.close(fd)
        else: result[str(path)]=read_file(path,trusted=False,limit=1073741824,retain=False)[1]
    for root in (STATE,receiver.AUTONOMY/'slots',receiver.AUTONOMY/'outbox',receiver.AUTONOMY/'locks'):
        if os.path.lexists(root): walk(root)
    for path in (receiver.POLICY,receiver.BUDGET,receiver.POLICY.parent.parent/'gobadminton-slots'):
        if os.path.lexists(path): walk(path)
    # The inventory has been scope-validated before this function is called.
    for path in loads(regular_bytes(STATE/'backup.json'))['after']:
        if pathlib.Path(path) not in {INSTALL/n for n in TARGETS}: walk(pathlib.Path(path))
    return result


def rules_pin(raw):
    """Parse only; never import/execute the bundle's context policy."""
    tree=ast.parse(raw)
    expected={'RULES_SHA256':RULES_SHA256,'RULES_SIZE':RULES_SIZE,'RULES_COMMIT':RULES_COMMIT}
    accepted={}
    for node in tree.body:
        if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name):
            name=node.targets[0].id
            if name in expected:
                need(name not in accepted and isinstance(node.value,ast.Constant)
                     and type(node.value.value) is type(expected[name]) and node.value.value==expected[name],
                     'invalid or duplicate rules literal')
                accepted[name]=node.targets[0]
    need(set(accepted)==set(expected),'missing accepted rules literals')
    for node in ast.walk(tree):
        if isinstance(node,ast.Name) and node.id in expected and isinstance(node.ctx,(ast.Store,ast.Del)):
            need(node is accepted[node.id],'rules pin override')
        if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef,ast.arg,ast.alias,
                            ast.ExceptHandler,ast.MatchAs,ast.MatchStar,ast.MatchMapping)):
            name=getattr(node,'asname',None) or getattr(node,'name',None) or getattr(node,'arg',None) or getattr(node,'rest',None)
            need(name not in expected,'rules pin rebinding')
    return expected


def payload_target(path):
    """Fixed installer mapping; manifest/journal cannot supply target paths."""
    if path=='scripts/chatops/server/gb-deploy-helper.sh': return pathlib.Path('/usr/local/sbin/gb-deploy-helper.sh')
    monitor={PREFIX+'monitor_payload/writer.py':pathlib.Path('/usr/local/lib/gb-ops-monitor/opsmon/writer.py'),
             PREFIX+'monitor_payload/app.js':pathlib.Path('/usr/local/lib/gb-ops-monitor/web/app.js')}
    if path in monitor: return monitor[path]
    need(path.startswith(PREFIX) and '..' not in path.split('/') and
         all(part and part!='.' for part in path.split('/')),'out-of-scope payload')
    return INSTALL/path[len(PREFIX):]


def source(bundle,commit,branch,manifest,controller,stage_sha,dispatch_sha,*,version=2,baseline=None):
    """Reviewed AGY29 plain-checkout/config gate, extended to ALL tracked blobs.

    V5 (OD-014A): desired module bytes come from accepted Git blobs on a validated
    tracked-path allowlist. Legacy --manifest digest may be recorded but must not
    authorize or deny V5 code content. Historical manual per-file pin gates are not
    upgrade gates for the six V5 targets.
    """
    need(bundle.is_absolute() and '..' not in bundle.parts,'noncanonical bundle path')
    need(re.fullmatch('[a-f0-9]{40}',commit or '') and
         re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9_./-]*',branch or '') and '..' not in branch,'exact bundle identity required')
    need(stat.S_ISDIR((bundle/'.git').lstat().st_mode),'bundle .git must be a real directory')
    receiver.trusted_tree(bundle);receiver.trusted_tree(bundle/'.git')
    for path in bundle.rglob('*'):
        receiver.trusted_tree(path)
        info=path.lstat()
        need(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode) and info.st_nlink==1,
             'nonregular/hardlinked bundle entry')
    for name in ('commondir','gitdir','objects/info/alternates','objects/info/http-alternates','modules','info/attributes','shallow'):
        need(not os.path.lexists(bundle/'.git'/name),'forbidden bundle Git indirection')
    bundle_config(regular_bytes(bundle/'.git'/'config'))
    need(not os.path.lexists(bundle/'.git'/'config.worktree'),'forbidden bundle worktree configuration')
    for path in bundle.rglob('*'):
        if path.name in ('.gitattributes','.gitmodules'):
            need(not re.search(rb'(?i)(?:^|\s)filter\s*=',regular_bytes(path)),'forbidden bundle filter attribute')
    need(git(bundle,'rev-parse','HEAD').decode().strip()==commit,'bundle HEAD differs from reviewed commit')
    need(git(bundle,'symbolic-ref','--short','HEAD').decode().strip()==branch,'wrong bundle branch')
    need(git(bundle,'remote','get-url','origin').decode().strip() in
         ('https://github.com/anpavel84-afk/gobadminton-clean',
          'https://github.com/anpavel84-afk/gobadminton-clean.git',
          'git@github.com:anpavel84-afk/gobadminton-clean.git'),'wrong bundle repository')
    need(not git(bundle,'status','--porcelain=v1','--untracked-files=all','--ignore-submodules=all'),'dirty bundle')
    material={};total=0
    for entry in git(bundle,'ls-tree','-r','-l','-z','--full-tree',commit).split(b'\0'):
        if not entry: continue
        meta,path=entry.split(b'\t',1);mode,kind,oid,size=meta.split();path=path.decode('utf-8')
        need(mode in (b'100644',b'100755') and kind==b'blob' and int(size)<=67108864,'unsafe Git blob')
        total+=int(size);need(total<=268435456,'oversize bundle')
        raw=regular_bytes(bundle/path)
        need(len(raw)==int(size) and raw==git(bundle,'cat-file','blob',oid.decode()),'bundle worktree/Git blob differs')
        material[path]=raw
    need(material.get(SCRIPT_REPO_PATH)==regular_bytes(pathlib.Path(__file__).absolute()),
         'running installer differs from reviewed bundle script')
    if version==5:
        need(re.fullmatch('[a-f0-9]{40}',baseline or ''),'V5 baseline controller identity required')
        # Legacy manifest digest: accepted for CLI/receipt continuity, never content authority.
        # Kept only as legacy receipt input. Git objects above, not this digest,
        # authorize the selected content (OD-014A).
        items={}
        for name in V5_TARGETS:
            path=PREFIX+name
            need(path in material,'V5 Git allowlist path missing: '+name)
            target=payload_target(path);need(target not in items,'duplicate target')
            items[target]=material[path]
        rules_pin(material[PREFIX+'context_policy.py'])
        canon=material[BUNDLE_RULES]
        need(bytes_sha(canon)==RULES_SHA256 and len(canon)==RULES_SIZE,'bundle canon differs from accepted rules')
        need(git(bundle,'rev-parse','--verify',RULES_COMMIT+'^{commit}').decode().strip()==RULES_COMMIT,
             'rules commit identity differs')
        need(canon==git(bundle,'show',RULES_COMMIT+':'+BUNDLE_RULES),'rules commit/object differs')
        for name,pin in (('train-stage.yml',stage_sha),('train-dispatch.yml',dispatch_sha)):
            raw=material['.github/workflows/'+name]
            need(bytes_sha(raw)==pin,'unreviewed workflow/pin')
            new_n=raw.count(('ref: '+controller).encode())
            old_n=raw.count(('ref: '+baseline).encode())
            need((new_n==2 and old_n==0) or (old_n==2 and new_n==0),
                 'unreviewed V5 workflow keep/release pin')
        need(git(bundle,'rev-parse','HEAD').decode().strip()==commit and
             not git(bundle,'status','--porcelain=v1','--untracked-files=all','--ignore-submodules=all'),'bundle changed')
        return items
    expected={path for path in material if path.startswith(PREFIX) and path!=MANIFEST_PATH}
    expected.add('scripts/chatops/server/gb-deploy-helper.sh')
    mraw=material.get(MANIFEST_PATH,b'');need(bytes_sha(mraw)==manifest,'unreviewed manifest')
    m=loads(mraw)
    need(isinstance(m,dict) and m.get('schema')=='GB_ACTIONS_TRAIN_INSTALL_V1' and
         isinstance(m.get('files'),dict) and set(m['files'])==expected,'incomplete manifest/code bundle')
    items={}
    for path,pin in m['files'].items():
        need(re.fullmatch('[a-f0-9]{64}',pin or '') and bytes_sha(material[path])==pin,'payload hash drift')
        target=payload_target(path);need(target not in items,'duplicate target');items[target]=material[path]
    rules_pin(material[PREFIX+'context_policy.py'])
    canon=material[BUNDLE_RULES]
    need(bytes_sha(canon)==RULES_SHA256 and len(canon)==RULES_SIZE,'bundle canon differs from accepted rules')
    need(git(bundle,'rev-parse','--verify',RULES_COMMIT+'^{commit}').decode().strip()==RULES_COMMIT,
         'rules commit identity differs')
    need(canon==git(bundle,'show',RULES_COMMIT+':'+BUNDLE_RULES),'rules commit/object differs')
    for name,pin in (('train-stage.yml',stage_sha),('train-dispatch.yml',dispatch_sha)):
        raw=(git(bundle,'show',controller+':.github/workflows/'+name) if version==3
             else material['.github/workflows/'+name])
        need(bytes_sha(raw)==pin,'unreviewed workflow/pin')
        if version==3:
            continue
        need(raw.count(('ref: '+controller).encode())==2,'unreviewed workflow/pin')
    # Refuse mutations during source validation as well; installed bytes are retained above.
    need(git(bundle,'rev-parse','HEAD').decode().strip()==commit and
         not git(bundle,'status','--porcelain=v1','--untracked-files=all','--ignore-submodules=all'),'bundle changed')
    return items


def temp_name(path): return '.'+path.name+'.stage5'


def unlink_durable(path):
    parent=directory_fd(path.parent)
    try:
        os.unlink(path.name,dir_fd=parent);os.fsync(parent)
    finally: os.close(parent)


_UNSPECIFIED=object()


def atomic_bytes(path,raw,meta,*,expected=_UNSPECIFIED):
    """Known fixed target, retained bytes, durable atomic replacement and readback."""
    parent=directory_fd(path.parent);tmp=path.with_name(temp_name(path));fd=None
    try:
        receiver.trusted_tree(path.parent)
        # Only this protocol's fixed temporary name, never a receipt-supplied path.
        if os.path.lexists(tmp):
            read_file(tmp);unlink_durable(tmp)
        fd=os.open(tmp.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=parent)
        os.fchown(fd,meta['uid'],meta['gid']);os.fchmod(fd,meta['mode'])
        with os.fdopen(fd,'wb') as out:
            fd=None;out.write(raw);out.flush();os.fsync(out.fileno())
        check=directory_fd(path.parent)
        try:
            need((os.fstat(check).st_dev,os.fstat(check).st_ino)==
                 (os.fstat(parent).st_dev,os.fstat(parent).st_ino),'parent replaced before write')
        finally: os.close(check)
        if expected is not _UNSPECIFIED:
            need(current(path)==expected,'compare-and-swap drift before rename')
        os.replace(tmp.name,path.name,src_dir_fd=parent,dst_dir_fd=parent);os.fsync(parent)
    finally:
        if fd is not None: os.close(fd)
        try: os.unlink(tmp.name,dir_fd=parent);os.fsync(parent)
        except FileNotFoundError: pass
        os.close(parent)
    need(read_file(path)==(raw,dict(meta,sha256=bytes_sha(raw))),'atomic bytes/metadata readback mismatch')


def save(j): atomic_bytes(JOURNAL,encoded(j),dict(mode=0o600,uid=OWNER_UID,gid=OWNER_GID))


def inventory_bytes(raw,changes):
    """Change only the two after entries; retain original manifest/other bytes."""
    record=loads(raw);updated=copy.deepcopy(record)
    for name,row in sorted(changes.items()):
        key=str(INSTALL/name);old=row['before'];new=row['after']['sha256']
        need(record['after'].get(key)==(old and old['sha256']),'inventory target baseline differs')
        if old is None:
            match=re.search(rb'"after"\s*:\s*\{',raw)
            need(match is not None,'missing inventory after object')
            raw=raw[:match.end()]+encoded(key)+b':'+encoded(new)+b','+raw[match.end():]
        else:
            pattern=re.escape(encoded(key))+rb'\s*:\s*"'+old['sha256'].encode()+b'"'
            matches=list(re.finditer(pattern,raw));need(len(matches)==1,'ambiguous inventory target')
            match=matches[0];piece=raw[match.start():match.end()].replace(old['sha256'].encode(),new.encode())
            raw=raw[:match.start()]+piece+raw[match.end():]
        updated['after'][key]=new
    need(loads(raw)==updated,'inventory edit differs outside targets')
    return raw


def exact_meta(meta):
    need(isinstance(meta,dict) and set(meta)=={'sha256','mode','uid','gid'} and
         re.fullmatch('[a-f0-9]{64}',meta.get('sha256','')) and type(meta['mode']) is int
         and 0<=meta['mode']<=0o777 and not meta['mode'] & 0o022
         and type(meta['uid']) is int and meta['uid']==OWNER_UID and
         type(meta['gid']) is int and meta['gid']==OWNER_GID,'invalid digest/metadata')


def current(path):
    if not os.path.lexists(path): return None
    return read_file(path)[1]


def inventory_scope(record,items,changes,allow_new=False):
    need(isinstance(record,dict) and isinstance(record.get('after'),dict),'invalid inventory')
    expected={str(path) for path in items}|{str(INSTALLED_RULES)}
    expected-={str(INSTALL/name) for name,row in changes.items() if row['before'] is None}
    need(set(record['after'])==expected or allow_new and
         set(record['after'])=={str(path) for path in items}|{str(INSTALLED_RULES)},
         'inventory membership differs from complete payload')
    need(all(re.fullmatch('[a-f0-9]{64}',pin or '') for pin in record['after'].values()),'invalid inventory digest')


def checked_transaction(identity,items):
    j=loads(regular_bytes(JOURNAL))
    need(isinstance(j,dict) and set(j)=={'schema','identity','identity_sha256','phase','installed_at',
         'changes','inventory_before','inventory_after','policy','preserved','shadow'},'transaction schema differs')
    need(j['schema']==SCHEMA and j['identity']==identity and j['identity_sha256']==digest(identity),
         'foreign transaction identity/controller/workflows')
    need(j['phase'] in ('preparing','applying','installed-lib-only','activating-proof','proof-recorded',
         'rolling-back','rolled-back') and type(j['installed_at']) is int and j['installed_at']>0,'invalid transaction phase/time')
    need(isinstance(j['changes'],dict) and set(j['changes'])==TARGETS,'transaction target membership differs')
    for name,row in j['changes'].items():
        need(isinstance(row,dict) and set(row)=={'before','after'},'invalid change schema')
        if row['before'] is not None: exact_meta(row['before'])
        exact_meta(row['after'])
        need(row['after']['sha256']==bytes_sha(items[INSTALL/name]) and
             row['after']==dict(row['before'] or dict(mode=0o644,uid=OWNER_UID,gid=OWNER_GID),
                                sha256=bytes_sha(items[INSTALL/name])),'transaction target bytes/metadata differ')
    exact_meta(j['inventory_before']);exact_meta(j['inventory_after'])
    need(j['inventory_after']==dict(j['inventory_before'],sha256=j['inventory_after']['sha256']),
         'inventory metadata differs')
    need(j['policy']==read_file(receiver.POLICY)[1],'controller policy/workflow drift')
    inventory_scope(loads(regular_bytes(STATE/'backup.json')),items,j['changes'],allow_new=True)
    need(j['preserved']==preserved(),'authoritative state changed; never rewind live effects')
    complete=j['phase']!='preparing'
    expected={name for name,row in j['changes'].items() if row['before'] is not None}|{'inventory'}
    backups={}
    if os.path.lexists(BACKUP):
        receiver.trusted_tree(BACKUP);info=BACKUP.lstat()
        need(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode)==0o700,'unsafe backup directory')
        names=set(os.listdir(BACKUP));temps={temp_name(pathlib.Path(n)) for n in expected}
        need(names<=expected|temps and (not complete or expected<=names),'backup membership differs')
        for name in names & expected:
            raw,meta=read_file(BACKUP/name)
            old=j['inventory_before'] if name=='inventory' else j['changes'][name]['before']
            need(meta==dict(old,mode=0o600),'backup bytes/metadata drift');backups[name]=raw
        # Incomplete temps have no authority and are never used for restoration.
        for name in names & temps: read_file(BACKUP/name)
    else: need(not complete,'missing complete backups')
    if 'inventory' in backups:
        inventory_scope(loads(backups['inventory']),items,j['changes'])
        new=inventory_bytes(backups['inventory'],j['changes'])
        need(bytes_sha(new)==j['inventory_after']['sha256'],'backup inventory identity differs')
    else: new=None
    return j,backups,new


def validate_current(j,backups,new,*,installed=False,preparing=False):
    for name,row in j['changes'].items():
        allowed=[row['after']] if installed else [row['before']] if preparing else [row['before'],row['after']]
        need(current(INSTALL/name) in allowed,'foreign target bytes/metadata drift')
    raw,meta=read_file(STATE/'backup.json')
    allowed=[j['inventory_after']] if installed else [j['inventory_before']] if preparing else [j['inventory_before'],j['inventory_after']]
    need(meta in allowed,'foreign inventory drift')
    if new is not None: need(raw in (backups['inventory'],new),'inventory bytes drift')


def execute(action,bundle,manifest,controller,stage_sha,dispatch_sha,run_id=None,baseline=None,
            bundle_commit=None,bundle_branch='dev',version=2):
    if version==5:
        return execute_v5(action,bundle,manifest,controller,stage_sha,dispatch_sha,run_id,baseline,
                          bundle_commit,bundle_branch)
    if version==4:
        return execute_v4(action,bundle,manifest,controller,stage_sha,dispatch_sha,run_id,baseline,
                          bundle_commit,bundle_branch)
    if version==3:
        return execute_v3(action,bundle,manifest,controller,stage_sha,dispatch_sha,run_id,baseline,
                          bundle_commit,bundle_branch)
    need(version==2,'unsupported installer version')
    need(os.geteuid()==0,'root integrator only')
    need(action in ('dry','apply','activate','rollback'),'invalid action')
    for value in (baseline,controller): need(re.fullmatch('[a-f0-9]{40}',value or ''),'immutable controller required')
    need(controller!=baseline,'distinct reviewed controller required')
    for value in (manifest,stage_sha,dispatch_sha): need(re.fullmatch('[a-f0-9]{64}',value or ''),'exact manifest/workflow digest required')
    quiet()
    commit=bundle_commit or controller
    identity=dict(baseline=baseline,controller=controller,stage_sha256=stage_sha,dispatch_sha256=dispatch_sha,
                  manifest=manifest,bundle_commit=commit,bundle_branch=bundle_branch,
                  script_sha256=sha(pathlib.Path(__file__).absolute()))
    items=source(bundle,commit,bundle_branch,manifest,controller,stage_sha,dispatch_sha)
    p=loads(regular_bytes(receiver.POLICY))
    need(p.get('controller_sha')==baseline and p.get('mode') in ('active','disabled')
         and re.fullmatch('[a-f0-9]{64}',p.get('stage_workflow_sha256','')),'wrong baseline controller/workflow')
    # Installed and bundle adapters must BOTH equal the exact independent pins.
    for name,pin in FROZEN.items():
        need(sha(INSTALL/name)==pin==bytes_sha(items[INSTALL/name]),'marker module not byte-identical: '+name)
    raw=regular_bytes(INSTALLED_RULES)
    need(len(raw)==RULES_SIZE and bytes_sha(raw)==RULES_SHA256,'installed rules pin missing/stale: apply rules bump first')
    if action in ('activate','rollback'):
        j,backups,new=checked_transaction(identity,items)
        if action=='activate':
            need(j['phase'] in ('installed-lib-only','activating-proof'),'not installed dormant libraries')
            validate_current(j,backups,new,installed=True)
            j['phase']='activating-proof';save(j)  # durable intent BEFORE hosted request
            need(type(run_id) is int and run_id>0,'exact hosted run required')
            evidence=probe(run_id,dict(j,dispatch_sha256=dispatch_sha))
            quiet();checked_transaction(identity,items);validate_current(j,backups,new,installed=True)
            j.update(phase='proof-recorded',shadow=evidence);save(j)
            return dict(phase='proof-recorded',state_preserved=True,shadow=evidence,cursor_scoped_v1=False,ready=False)
        need(j['phase'] in ('preparing','applying','installed-lib-only','activating-proof','rolling-back'),'no rollback after proof activation')
        preparing=j['phase']=='preparing'
        validate_current(j,backups,new,preparing=preparing)
        if preparing:
            # No lib effect is permitted before the durable applying phase. Never
            # restore from an incomplete/unproven backup: prove originals instead.
            j['phase']='rolled-back';save(j)
            return dict(phase='rolled-back',state_preserved=True)
        j['phase']='rolling-back';save(j)
        for name in sorted(TARGETS):
            tmp=(INSTALL/name).with_name(temp_name(INSTALL/name))
            if os.path.lexists(tmp):
                read_file(tmp);unlink_durable(tmp)
        for name,row in sorted(j['changes'].items()):
            target=INSTALL/name
            if row['before'] is None:
                if os.path.lexists(target): unlink_durable(target)
            else: atomic_bytes(target,backups[name],row['before'])
        atomic_bytes(STATE/'backup.json',backups['inventory'],j['inventory_before'])
        quiet();need(preserved()==j['preserved'],'state changed during rollback')
        validate_current(j,backups,new,preparing=True)
        j['phase']='rolled-back';save(j)
        return dict(phase='rolled-back',state_preserved=True)
    need(not os.path.lexists(JOURNAL) and not os.path.lexists(BACKUP),'prior transaction exists; inspect/rollback')
    originals={};changes={}
    for path,new in items.items():
        old=read_file(path) if os.path.lexists(path) else (None,None)
        if old[0]!=new:
            need(path in {INSTALL/n for n in TARGETS},'unexpected changed target; install other reviewed bumps first')
            originals[path.name]=old[0]
            changes[path.name]=dict(before=old[1],after=dict(old[1] or dict(mode=0o644,uid=OWNER_UID,gid=OWNER_GID),sha256=bytes_sha(new)))
    need(set(changes)==TARGETS,'exact two changed targets required')
    for row in changes.values():
        if row['before'] is not None: exact_meta(row['before'])
        exact_meta(row['after'])
    inventory,imeta=read_file(STATE/'backup.json');record=loads(inventory)
    exact_meta(imeta)
    inventory_scope(record,items,changes)
    need(all(sha(pathlib.Path(k))==v for k,v in record['after'].items()),'baseline code drift')
    newinventory=inventory_bytes(inventory,changes)
    snapshot=preserved()
    if action=='dry':
        return dict(dry=True,changes=changes,preserved_files=len(snapshot),baseline=baseline,controller=controller,
                    policy_writes=0,cursor_scoped_v1=False,ready=False)
    j=dict(schema=SCHEMA,identity=identity,identity_sha256=digest(identity),phase='preparing',installed_at=int(time.time()),
           changes=changes,inventory_before=imeta,inventory_after=dict(imeta,sha256=bytes_sha(newinventory)),
           policy=read_file(receiver.POLICY)[1],preserved=snapshot,shadow=None)
    save(j)  # FIRST effect: even a missing/incomplete backup is now recoverable.
    BACKUP.mkdir(mode=0o700)
    fd=directory_fd(BACKUP.parent)
    try: os.fsync(fd)
    finally: os.close(fd)
    for name,raw in sorted(originals.items()):
        if raw is not None: atomic_bytes(BACKUP/name,raw,dict(mode=0o600,uid=OWNER_UID,gid=OWNER_GID))
    atomic_bytes(BACKUP/'inventory',inventory,dict(mode=0o600,uid=OWNER_UID,gid=OWNER_GID))
    # Verify EVERY backup before any live replacement, and retain verified bytes.
    checked_transaction(identity,items);validate_current(j,{},None,preparing=True)
    for name,raw in originals.items():
        if raw is not None: need(regular_bytes(BACKUP/name)==raw,'backup integrity failure')
    need(regular_bytes(BACKUP/'inventory')==inventory,'backup inventory integrity failure')
    quiet();need(preserved()==snapshot,'state changed during backup')
    j['phase']='applying';save(j)
    for name,row in sorted(changes.items()):
        need(current(INSTALL/name)==row['before'],'pre-replacement drift')
        atomic_bytes(INSTALL/name,items[INSTALL/name],row['after'])
    need(read_file(STATE/'backup.json')==(inventory,imeta),'pre-inventory drift')
    atomic_bytes(STATE/'backup.json',newinventory,imeta)
    quiet();need(preserved()==snapshot,'state changed during install')
    j['phase']='installed-lib-only';save(j)
    j,backups,new=checked_transaction(identity,items);validate_current(j,backups,new,installed=True)
    return dict(phase='installed-lib-only',preserved_files=len(snapshot),ledger_reset=False,
                policy_writes=0,cursor_scoped_v1=False,ready=False)


# V3 is an explicitly selected extension of this transaction, sharing its fd,
# Git, journal, backup, CAS and inventory primitives. Never reinterpret a V2
# journal as V3: the same namespace forces separate legacy reconciliation.
V3_SCHEMA='GB_STAGE5_CONTEXT_COMPLETION_V3'
C5='41e12be2d551158e97ea30eaf8e95f992f998615'
C5_MANIFEST='0f16f0d60e05d13fa1778f5e9220341b4f62149ddc3e99ced10235344cf21944'
C5_WORKFLOWS=('b9703ca27b7bb3f494f379f8e259e62a6a48bc8f5ff50c6923e1712d8899d68d',
              '34bd4392edf64ba8c0d5fa998991edc0dd9dd4139087d7b1290aa5c19f930c20')
V3_OLD={
 'native_antigravity.py':'01d4816e881765da6361af07a15765528aef274dad0eb780b1afab6b0e5e0f72',
 'native_guard.py':'dd2e0a0c6c0dea0d353b7dc5f16c1a5d4c4c21f022947ceaa640470c59fb0762',
 'stage.py':'ea79b894076c755f28d62619154b0681ecb636b7b32dd05c18a8c996112a1c2e',
 'context_cursor_delivery.py':None,
 'context_policy.py':'d961079b9791f53cf7ce0ac208180b0c9d9100ef46b48c025c2938d2eb69a806',
 'admission_pm.py':None,
 'accepted-engineering-rules.md':'017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269'}
V3_NEW={
 'native_antigravity.py':'9dae383ae315f02f5ed03e6c8e45424b0516e8a653e446e5600440d12b438889',
 'native_guard.py':'334d4c78c57ba9a7f3f5c49e6737ec8e658033e4b4fdc84f92ce168ece9019f9',
 'stage.py':'ca5ca68eb8b3f8bafbb8c097790acc91c0323f2081fed977372cf571452b97ed',
 'context_cursor_delivery.py':'6352f6bd6175f447bc124a28d6a1dc67837da6514f1ede3a81c128b4623bff11',
 'context_policy.py':'b55398b64b68c83b88e2f45b53e690f4fbdab9d7e0f0333dd5a354db0c3826df',
 'admission_pm.py':'a17576fad805a736b926768d3aae7d5ed4bb6336f3c248805f8de3fac699784a',
 'accepted-engineering-rules.md':RULES_SHA256}
# These hashes bind the reviewed proof, not merely a matching import name:
# C5 _route_immutable rejects AGY role != qa; stage's only AGY author import is
# below that route and provider == agy and not qa. Diagnosis/task_review produce
# read-only QA choices. Legacy AGY adapters remain disabled by live/slots.py.
# The C5 context_exchange API already supports the Cursor calls; no binary
# feature or unqualified native_antigravity_author is installed by this delta.
V3_PROTOCOL={
 'core.py':'3ed9ab5503694f39011102ff34935810ef1dce67cf712c87be89b023689a15a7',
 'client.py':'1c63f4a53709f749cd6d7e88ee6cf1fd479a76762b385dc3a94764f4d42bce65',
 'receiver.py':'6405168b06f3902e40595528d30856c025a0311abfc31d70b59e969ed384af4e',
 'context_exchange.py':'baa4463cc6919e015ceabb1c05f398e095beb8c22a633191125442435586e132',
 'native_cursor.py':'02d26f8be9766bbeb1e92dd8514dfc496c1b3e1b0fc8035c1c65cc9aba6b6089',
 'cost_policy.py':'18f303fae73b3edf9b73249ae9d904050f65ed4089712dac3bbb98c1c9f58fad',
 'live/slots.py':'3c7b4ab36dd3cd8b41c3309a4d58c54ffc99027b1d7c1e5ad2235b5cd1f72a76',
 'live/autonomous_issues.py':'f3ca85b4392fa1e2ba76a09ec1140d78ebc6c708ba42397bee047184fec3ebe0',
 'owner_package_admission.py':'bb5bf8516d26ae293f16d794c2e46f90b01d0c27b34da15febbd0bff4398c7c5',
 'antigravity_qa_recovery.py':'93efc05c7aa46fc7ff0d6da70f0db01a9ebda434dbc7d99066590e0459a92a2e'}
V3_MARKERS={
 'cursor_marker':pathlib.Path('/etc/gobadminton-slots/cursor-author.json'),
 'agy_marker':pathlib.Path('/etc/gobadminton-slots/antigravity-qa.json')}
V3_OBSERVED={
 'policy':'52250df8b6391b46fe4b80f6805c27e89d06a1c493ca27002b187b1f1f7567d4',
 'cursor_marker':'022032d8aa92ee9944578366264814a7e68310329214d61e9ac0a090e1b43fef',
 'agy_marker':'529f5702f66e3e9bc00ccdefefb76eb4ee91648073c402b77f4352d9b2750afe',
 'inventory':'4b0eb93039712737a21b59bf9550084da01a963c67472034e25563deedd1f1bc'}


def canonical_meta(pin,mode=0o644):
    return dict(sha256=pin,mode=mode,uid=OWNER_UID,gid=OWNER_GID) if pin is not None else None


def v3_paths():
    return {**{name:INSTALL/name for name in V3_OLD},**V3_MARKERS,
            'inventory':STATE/'backup.json'}


def safe_checkpoint(state):
    """Offline terminal evidence only. Never clear active or reconcile UNKNOWN.

    Historical ACCEPTED need not be fresh; the exact run/release/head/QA/CI/live
    binding must still be complete. No remote read is an installer precondition.
    """
    need(type(state) is dict and set(state)=={'active','done'} and type(state['done']) is list
         and all(type(i) is int and i>0 for i in state['done'])
         and len(state['done'])==len(set(state['done'])),'invalid checkpoint/done array')
    a=state['active']
    if a is None: return
    need(type(a) is dict and a.get('phase')=='done' and type(a.get('issue')) is int
         and a['issue'] in state['done'] and type(a.get('attempt')) is int and a['attempt']>0
         and re.fullmatch('[0-9a-f]{40}',a.get('head','')),'active/UNKNOWN checkpoint HOLD')
    head=a['head'];run=a.get('run') or {};server=a.get('server') or {};accepted=server.get('accepted') or {}
    need(type(run.get('id')) is int and run['id']>0 and type(run.get('attempt')) is int
         and run['attempt']>0 and run.get('sha')==head
         and a.get('release_id')==f"r{run['id']}-a{run['attempt']}"
         and (a.get('ci') or {}).get('sha')==head
         and (a.get('qa') or {}).get('verdict')=='PASS'
         and (a.get('qa') or {}).get('reviewed_sha')==head
         and (a.get('live') or {}).get('gitSha')==head
         and server.get('schema')==1 and server.get('environment')=='dev' and server.get('pending') is False
         and accepted.get('status')=='ACCEPTED' and accepted.get('release_id')==a['release_id']
         and accepted.get('source_sha')==head,'terminal done lacks exact accepted release evidence')
    need(all(re.fullmatch('sha256:[a-f0-9]{64}',accepted.get(k,'')) for k in ('api_digest','web_digest'))
         and type(accepted.get('finished_at')) is int and type(server.get('observed_at')) is int
         and 0<accepted['finished_at']<=server['observed_at']<=int(time.time()),
         'terminal acceptance digests/time invalid')


def quiet_v3():
    quiet()  # retains units/cgroups, all kernel lock types and leases
    for slot in ('slot1','slot2'):
        j=receiver.journal(slot)
        need(j['pending'] is None,'current pending/UNKNOWN HOLD')
        safe_checkpoint(receiver.checkpoint(slot)[0])
        # A recorded live PID/start/boot tuple holds even if pending is absent.
        # PID reuse alone is not a match. UNKNOWN records remain untouched.
        for op in j.get('operations',{}).values():
            process=op.get('process')
            if process:
                need(type(process) is dict and set(process)=={'pid','start','boot'}
                     and type(process['pid']) is int and process['pid']>0,'invalid recorded process identity')
                need(receiver.identity(process['pid'])!=process,'recorded operation process still alive')


def module_pins_only(raw,key,newpins):
    """Edit hashes inside the unique modules object; keep all other bytes exact."""
    old=loads(raw);updated=copy.deepcopy(old)
    need(type(old) is dict and type(old.get('modules')) is dict,'invalid native marker')
    if key=='cursor_marker':
        need(old.get('schema')=='GB_CURSOR_AUTHOR_211_V1' and old.get('phase')=='ready'
             and old.get('accepted_canary',{}).get('acceptance_basis')=='runtime_qualification'
             and old['modules']=={n:(V3_OLD if n=='native_guard.py' else V3_PROTOCOL)[n]
                                  for n in ('native_cursor.py','native_guard.py')},
             'Cursor READY preservation not proven; require separately reviewed bound pilot marker')
    else:
        need(old.get('schema')=='GB_ANTIGRAVITY_QA_29_V1' and old.get('phase')=='canary'
             and old.get('adapter_revision')==C5 and old['modules']==
             {n:V3_OLD[n] for n in ('native_guard.py','native_antigravity.py')},'AGY canary module contract drift')
    matches=list(re.finditer(rb'"modules"\s*:\s*\{[^{}]*\}',raw))
    need(len(matches)==1,'ambiguous marker modules object')
    m=matches[0];piece=m[0]
    for name,pin in newpins.items():
        need(name in old['modules'],'missing marker module field')
        pattern=re.escape(encoded(name))+rb'\s*:\s*"'+old['modules'][name].encode()+b'"'
        hits=list(re.finditer(pattern,piece));need(len(hits)==1,'ambiguous module pin')
        hit=hits[0];piece=piece[:hit.start()]+hit[0].replace(old['modules'][name].encode(),pin.encode())+piece[hit.end():]
        updated['modules'][name]=pin
    result=raw[:m.start()]+piece+raw[m.end():]
    need(loads(result)==updated and len(result)==len(raw),'marker fields changed outside module pins')
    return result


def v3_scope(bundle):
    raw=git(bundle,'show',C5+':'+MANIFEST_PATH)
    need(bytes_sha(raw)==C5_MANIFEST,'C5 manifest identity drift')
    m=loads(raw)
    need(m.get('schema')=='GB_ACTIONS_TRAIN_INSTALL_V1' and type(m.get('files')) is dict,'invalid C5 manifest')
    paths={payload_target(p) for p in m['files']}|{INSTALLED_RULES}
    need(len(paths)==len(m['files'])+1,'C5 target mapping collision')
    return paths


def v3_inventory(raw,scope):
    need(bytes_sha(raw)==V3_OBSERVED['inventory'],'installed-before inventory differs')
    record=loads(raw)
    need(type(record) is dict and type(record.get('after')) is dict
         and set(record['after'])=={str(p) for p in scope},'C5 installed inventory membership differs')
    need(all(re.fullmatch('[a-f0-9]{64}',v or '') for v in record['after'].values()),'invalid inventory pin')
    return record


def v3_inventory_after(raw,changes):
    # Membership was proven against the exact C5 manifest. Change only our
    # seven entries; full install manifest/history are deliberately not reset.
    return inventory_bytes(raw,{n:changes[n] for n in V3_OLD})


def v3_material(items,bundle):
    target={n:items[INSTALL/n] for n in V3_OLD if n!='accepted-engineering-rules.md'}
    target['accepted-engineering-rules.md']=git(bundle,'show',RULES_COMMIT+':'+BUNDLE_RULES)
    need(set(target)==set(V3_NEW)==set(V3_OLD),'V3 target contract differs')
    for n,raw in target.items():
        need(bytes_sha(raw)==V3_NEW[n],'dependency closure not proven for target '+n)
    need(len(target['accepted-engineering-rules.md'])==RULES_SIZE,'accepted canon size differs')
    # Exact frozen imports, including old context_exchange, are the compatibility
    # proof boundary. Bundle versions of unrelated modules are never installed.
    for n,pin in V3_PROTOCOL.items():
        need(read_file(INSTALL/n)[1]==canonical_meta(pin),'frozen protocol dependency HOLD: '+n)
    need(not os.path.lexists(INSTALL/'native_antigravity_author.py'),
         'unqualified AGY author module present; unreachable closure not proven')
    return target


def v3_preserved():
    paths=v3_paths();exclude=set(paths.values())
    exclude|={p.with_name(temp_name(p)) for p in paths.values()}
    return preserved(exclude)


def v3_plan(target,marker_raw,inventory,scope):
    v3_inventory(inventory,scope)
    changes={n:dict(before=canonical_meta(pin),after=canonical_meta(bytes_sha(target[n])))
             for n,pin in V3_OLD.items()}
    for key,raw in marker_raw.items():
        need(bytes_sha(raw)==V3_OBSERVED[key],'installed-before marker drift: '+key)
        pins={'native_guard.py':V3_NEW['native_guard.py']}
        if key=='agy_marker': pins['native_antigravity.py']=V3_NEW['native_antigravity.py']
        target[key]=module_pins_only(raw,key,pins)
        changes[key]=dict(before=canonical_meta(V3_OBSERVED[key]),after=canonical_meta(bytes_sha(target[key])))
    # The exact post-small-range inventory is expected to match the actual rules
    # too. No generalized stale inventory waiver: mismatch remains a named gate.
    record=loads(inventory)
    for n,pin in V3_OLD.items():
        need(record['after'].get(str(INSTALL/n))==pin,'installed-before inventory target mismatch: '+n)
    target['inventory']=v3_inventory_after(inventory,changes)
    changes['inventory']=dict(before=canonical_meta(V3_OBSERVED['inventory'],0o600),
                              after=canonical_meta(bytes_sha(target['inventory']),0o600))
    return changes


def v3_current(j):
    paths=v3_paths();applied=j['applied'];restored=j['restored'];intent=j['write_intent']
    for n,row in j['changes'].items():
        state=row['after'] if n in applied and n not in restored else row['before']
        allowed=[state]
        if intent and intent['target']==n: allowed=[row['before'],row['after']]
        need(current(paths[n]) in allowed,'foreign CAS drift: '+n)


def checked_v3(identity,target,scope):
    j=loads(regular_bytes(JOURNAL))
    need(type(j) is dict and j.get('schema')==V3_SCHEMA,
         'legacy/foreign journal: separate reconciliation required; never overwrite')
    need(set(j)=={'schema','identity','identity_sha256','phase','installed_at','changes','marker_before',
         'inventory_raw','preserved','applied','restored','write_intent','shadow'}
         and j['identity']==identity and j['identity_sha256']==digest(identity),'V3 transaction identity/schema differs')
    phases=('preparing','applying','installed-lib-only','activating-proof','proof-recorded','rolling-back','rolled-back')
    need(j['phase'] in phases and type(j['installed_at']) is int and j['installed_at']>0,'V3 invalid phase/time')
    need(type(j['marker_before']) is dict and set(j['marker_before'])==set(V3_MARKERS)
         and all(type(v) is str for v in j['marker_before'].values()) and type(j['inventory_raw']) is str,'V3 preimages invalid')
    markers={n:v.encode() for n,v in j['marker_before'].items()};inventory=j['inventory_raw'].encode()
    expected=v3_plan(target,markers,inventory,scope)
    need(j['changes']==expected,'V3 exact target OLD/NEW schema differs')
    order=sorted(expected)
    for field in ('applied','restored'):
        value=j[field]
        need(type(value) is list and value==order[:len(value)] and len(value)<=len(order),'invalid V3 write progress')
    need(set(j['restored'])<=set(j['applied']),'restoration outside own applied phase')
    intent=j['write_intent']
    if intent is not None:
        need(type(intent) is dict and set(intent)=={'action','target'}
             and intent['action'] in ('apply','rollback'),'invalid write intent')
        prefix=j['applied'] if intent['action']=='apply' else j['restored']
        need(len(prefix)<len(order) and intent['target']==order[len(prefix)]
             and j['phase']==('applying' if intent['action']=='apply' else 'rolling-back'),
             'write intent outside own phase')
    if j['phase']=='preparing': need(not j['applied'] and not j['restored'] and intent is None,'preparing progress differs')
    if j['phase'] in ('installed-lib-only','activating-proof','proof-recorded'):
        need(j['applied']==order and not j['restored'] and intent is None,'incomplete install progress')
    if j['phase']=='rolled-back': need(j['restored']==j['applied'] and intent is None,'incomplete rollback')
    need(j['preserved']==v3_preserved(),'authoritative state/history/closure drift')
    backups={};expected_backups={n for n,row in expected.items() if row['before'] is not None}
    complete=j['phase'] not in ('preparing','rolled-back') or bool(j['applied'])
    if os.path.lexists(BACKUP):
        receiver.trusted_tree(BACKUP);info=BACKUP.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid==OWNER_UID and info.st_gid==OWNER_GID
             and stat.S_IMODE(info.st_mode)==0o700,'unsafe V3 backup directory')
        names=set(os.listdir(BACKUP));temps={temp_name(pathlib.Path(n)) for n in expected_backups}
        need(names<=expected_backups|temps and (not complete or expected_backups<=names),'V3 backup membership differs')
        for n in names&expected_backups:
            raw,meta=read_file(BACKUP/n)
            need(meta==dict(expected[n]['before'],mode=0o600),'V3 backup preimage drift: '+n)
            backups[n]=raw
        for n in names&temps: read_file(BACKUP/n)
    else: need(not complete,'V3 complete backups missing')
    v3_current(j)
    return j,backups


def execute_v3(action,bundle,manifest,controller,stage_sha,dispatch_sha,run_id,baseline,commit,branch):
    need(os.geteuid()==OWNER_UID,'root integrator only')
    need(action in ('dry','apply','verify','activate','rollback'),'invalid V3 action')
    need(baseline==controller==C5,'protocol/controller transition requires separate reviewed distinct-controller contract')
    need((stage_sha,dispatch_sha)==C5_WORKFLOWS,'C5 workflow closure differs')
    need(read_file(receiver.POLICY)[1]==canonical_meta(V3_OBSERVED['policy']),'installed-before policy drift')
    policy=loads(regular_bytes(receiver.POLICY))
    need(policy.get('controller_sha')==C5 and policy.get('stage_workflow_sha256')==stage_sha
         and policy.get('mode') in ('active','disabled'),'C5 policy binding differs')
    quiet_v3()
    need(re.fullmatch('[a-f0-9]{40}',commit or ''),'V3 exact reviewed candidate required')
    identity=dict(version=3,baseline=baseline,controller=controller,manifest=manifest,bundle_commit=commit,
                  bundle_branch=branch,stage_sha256=stage_sha,dispatch_sha256=dispatch_sha,
                  script_sha256=sha(pathlib.Path(__file__).absolute()))
    items=source(bundle,commit,branch,manifest,controller,stage_sha,dispatch_sha,version=3)
    target=v3_material(items,bundle);scope=v3_scope(bundle);paths=v3_paths()
    result=dict(status='RUNTIME_INSTALLED',role_qualified=False,e2e_accepted=False,
                context_qualified=False,ready=False,cursor_scoped_v1=False,policy_writes=0,ledger_reset=False)
    if os.path.lexists(JOURNAL):
        j,backups=checked_v3(identity,target,scope)
        if action in ('dry','apply','verify'):
            need(j['phase'] in ('installed-lib-only','proof-recorded'),'interrupted/old transaction; explicit rollback/reconciliation required')
            return dict(result,phase=j['phase'],noop=True,dry=action=='dry')
        if action=='activate':
            need(j['phase'] in ('installed-lib-only','activating-proof'),'not installed/proof already recorded')
            j['phase']='activating-proof';save(j)
            need(type(run_id) is int and run_id>0,'exact hosted run required')
            proof=probe(run_id,dict(j,dispatch_sha256=dispatch_sha))
            quiet_v3();checked_v3(identity,target,scope)
            j.update(phase='proof-recorded',shadow=proof);save(j)
            return dict(result,phase='proof-recorded',shadow=proof)
        need(j['phase']!='proof-recorded','post-proof rollback requires separate reconciliation')
        if j['phase']=='rolled-back': return dict(phase='rolled-back',noop=True)
        if j['phase']=='preparing':
            j.update(phase='rolled-back',write_intent=None);save(j)
            return dict(phase='rolled-back',state_preserved=True)
        # Classify the last owned apply intent by exact bytes before switching
        # phase. An interrupted apply is never replayed.
        if j['write_intent'] and j['write_intent']['action']=='apply':
            n=j['write_intent']['target']
            if current(paths[n])==j['changes'][n]['after']: j['applied'].append(n)
            j['write_intent']=None
        j['phase']='rolling-back';save(j)
        for n in j['applied'][len(j['restored']):]:
            quiet_v3();checked_v3(identity,target,scope)
            j['write_intent']=dict(action='rollback',target=n);save(j)
            before=j['changes'][n]['before'];now=current(paths[n])
            if now!=before:
                if before is None: unlink_cas(paths[n],j['changes'][n]['after'])
                else: atomic_bytes(paths[n],backups[n],before,expected=j['changes'][n]['after'])
            j['restored'].append(n);j['write_intent']=None;save(j)
        # Remove only our bounded temporary files, including a crash before rename.
        for p in paths.values():
            tmp=p.with_name(temp_name(p))
            if os.path.lexists(tmp): read_file(tmp);unlink_durable(tmp)
        quiet_v3();checked_v3(identity,target,scope)
        j['phase']='rolled-back';save(j)
        return dict(phase='rolled-back',state_preserved=True)
    need(action in ('dry','apply') and not os.path.lexists(BACKUP),'missing own journal or foreign backup; reconciliation required')
    inventory=regular_bytes(paths['inventory'])
    markers={n:regular_bytes(p) for n,p in V3_MARKERS.items()}
    changes=v3_plan(target,markers,inventory,scope)
    originals={}
    for n,row in changes.items():
        need(current(paths[n])==row['before'],'installed-before bytes/metadata drift: '+n)
        if row['before'] is not None: originals[n]=regular_bytes(paths[n])
    record=v3_inventory(inventory,scope)
    for path,pin in record['after'].items(): need(sha(pathlib.Path(path))==pin,'inventory integrity drift: '+path)
    snapshot=v3_preserved()
    if action=='dry': return dict(dry=True,status='PLANNED_UPGRADE',changes=changes,protected_writes=0,
                                 role_qualified=False,ready=False)
    j=dict(schema=V3_SCHEMA,identity=identity,identity_sha256=digest(identity),phase='preparing',
           installed_at=int(time.time()),changes=changes,marker_before={n:r.decode() for n,r in markers.items()},
           inventory_raw=inventory.decode(),preserved=snapshot,applied=[],restored=[],write_intent=None,shadow=None)
    save(j)  # first protected effect, BEFORE backup directory or any backup
    BACKUP.mkdir(mode=0o700)
    fd=directory_fd(BACKUP.parent)
    try: os.fsync(fd)
    finally: os.close(fd)
    for n,raw in sorted(originals.items()):
        atomic_bytes(BACKUP/n,raw,canonical_meta(bytes_sha(raw),0o600),expected=None)
    quiet_v3();checked_v3(identity,target,scope)
    # preparing permits partial backups; applying requires the complete set.
    need(set(os.listdir(BACKUP))==set(originals),'incomplete backups before applying')
    j['phase']='applying';save(j)
    for n in sorted(changes):
        quiet_v3();checked_v3(identity,target,scope)
        j['write_intent']=dict(action='apply',target=n);save(j)
        atomic_bytes(paths[n],target[n],changes[n]['after'],expected=changes[n]['before'])
        j['applied'].append(n);j['write_intent']=None;save(j)
    quiet_v3();checked_v3(identity,target,scope)
    j['phase']='installed-lib-only';save(j)
    checked_v3(identity,target,scope)
    return dict(result,phase='installed-lib-only',state_preserved=True)


# V4: controller protocol upgrade for product QA admission (not lib-only).
# Distinct from V3; never reinterprets a V3 journal. OLD pins = actual installed
# V3_OLD/V3_PROTOCOL baseline (27Oct), not assumed PR340/PR341. Closure includes
# native_guard + live/slots one-writer, PR341 context/admission/rules targets,
# plus Root policy/markers/budget config5. Allows install while historical slot
# pending UNKNOWN remains, only when NEW product-QA resources are free. Frozen V3
# quiet/contract behaviour is unchanged. Apply writes disabled policy+libs;
# activate records hosted shadow then enables policy without asserting product
# QA READY/role_qualified. Resource quiescence (quiet_v4) is separate from
# journal OLD/NEW current-state validation during apply/verify/rollback.
V4_SCHEMA='GB_STAGE5_PRODUCT_QA_ADMISSION_V4'
V4_PRODUCT_OPS=STATE/'product-qa-operations.json'
V4_PRODUCT_READY=pathlib.Path('/etc/gobadminton-slots/product-qa-role-ready.json')
V4_JOURNAL=STATE/'stage5-product-qa-admission.json'
V4_BACKUP=STATE/'stage5-product-qa-admission-backup'
# Fixed named quiet scopes. Default shared_qa keeps strict product-QA pending NULL
# for all shared QA/Guard callers. native_antigravity_author is author-namespace
# only (new module/marker/budget author keys); never a universal bypass flag.
QUIET_SCOPE_SHARED_QA='shared_qa'
QUIET_SCOPE_NATIVE_ANTIGRAVITY_AUTHOR='native_antigravity_author'
# Owner-approved stopped historical isolation (Issue346 slot1 pr_wait CP).
V4_HISTORICAL_SLOT1_PENDING='02057f1cd74e35cfaf58d67ac1f3943abfe37995cbce938033bd957d1d05fa48'
V4_HISTORICAL_SLOT1_HEAD='8024caa659f4fee911d7e3afcb69ed7ac845ce5c'
V4_HISTORICAL_SLOT1_ISSUE=346
V4_HISTORICAL_SLOT2_PENDING='b65d8eb5101c52b26fdcf27b3468365f666836cac0c3f3021e1b76030b3cc5db'
# Frozen PR341-compatible deps: prove installed, never rewritten by V4.
# antigravity_qa_recovery.py is the accepted #29-maintenance Q93 pin (already in
# V3_PROTOCOL); V4_NEW owner_package_admission imports its SMALL_SOURCE_HEAD /
# OWNER_PACKAGE_SOURCES / owner_package_input_pins. Declaring it frozen closes
# the hybrid C5+V4_NEW import gap without rewriting Q or installing unrelated modules.
V4_FROZEN={'native_cursor.py':'02d26f8be9766bbeb1e92dd8514dfc496c1b3e1b0fc8035c1c65cc9aba6b6089',
           'context_exchange.py':'baa4463cc6919e015ceabb1c05f398e095beb8c22a633191125442435586e132',
           'antigravity_qa_recovery.py':'93efc05c7aa46fc7ff0d6da70f0db01a9ebda434dbc7d99066590e0459a92a2e'}
V4_OLD={
 'core.py':'3ed9ab5503694f39011102ff34935810ef1dce67cf712c87be89b023689a15a7',
 'receiver.py':'6405168b06f3902e40595528d30856c025a0311abfc31d70b59e969ed384af4e',
 'stage.py':'ea79b894076c755f28d62619154b0681ecb636b7b32dd05c18a8c996112a1c2e',
 'native_antigravity.py':'01d4816e881765da6361af07a15765528aef274dad0eb780b1afab6b0e5e0f72',
 'native_guard.py':'dd2e0a0c6c0dea0d353b7dc5f16c1a5d4c4c21f022947ceaa640470c59fb0762',
 'owner_package_admission.py':'bb5bf8516d26ae293f16d794c2e46f90b01d0c27b34da15febbd0bff4398c7c5',
 'client.py':'1c63f4a53709f749cd6d7e88ee6cf1fd479a76762b385dc3a94764f4d42bce65',
 'live/slots.py':'3c7b4ab36dd3cd8b41c3309a4d58c54ffc99027b1d7c1e5ad2235b5cd1f72a76',
 'context_policy.py':'d961079b9791f53cf7ce0ac208180b0c9d9100ef46b48c025c2938d2eb69a806',
 'context_cursor_delivery.py':None,
 'admission_pm.py':None,
 'accepted-engineering-rules.md':'017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269'}
V4_NEW={
 'core.py':'f3f06cc1245635b937018c1cbe431645ae4aa9acc45e7249be18e0b87cf2ee19',
 'receiver.py':'8f7c142e7e370d03cb470150d1e97657ab5554274ec79fc7b62fab8a5fd1f77d',
 'stage.py':'994849f0deb414eff41276affef6a4e208809ab30b8cd835b58b7a7fc6e7c530',
 'native_antigravity.py':'26194449422b158f47a0557d717782e29bad0920c82b41087e1a71105d1599bd',
 'native_guard.py':'334d4c78c57ba9a7f3f5c49e6737ec8e658033e4b4fdc84f92ce168ece9019f9',
 'owner_package_admission.py':'4aeb579312e9ad2979298929f16ea92210b3323fde51dfc26778a6a96c7a4677',
 'client.py':'d02307161913f72d5c9864b5f36d8862b39cc6e564091be51ed7e02bdde2a897',
 'live/slots.py':'3c6d910ccdaa5d482a1cf05c9330f35ef5c9a5aabd5b14ce88d4033c71e144ce',
 'context_policy.py':'b55398b64b68c83b88e2f45b53e690f4fbdab9d7e0f0333dd5a354db0c3826df',
 'context_cursor_delivery.py':'6352f6bd6175f447bc124a28d6a1dc67837da6514f1ede3a81c128b4623bff11',
 'admission_pm.py':'a17576fad805a736b926768d3aae7d5ed4bb6336f3c248805f8de3fac699784a',
 'accepted-engineering-rules.md':RULES_SHA256}


def _v4_historical_checkpoint_ok(slot, state, journal):
    """Idle/done, or the single Owner-approved stopped Issue346 pr_wait binding."""
    active=state.get('active')
    if active is None: return True
    if isinstance(active,dict) and active.get('phase')=='done': return True
    if slot!='slot1' or not isinstance(active,dict): return False
    if not (active.get('phase')=='pr_wait' and active.get('issue')==V4_HISTORICAL_SLOT1_ISSUE
            and active.get('head')==V4_HISTORICAL_SLOT1_HEAD):
        return False
    key=V4_HISTORICAL_SLOT1_PENDING
    pending=journal.get('pending')
    need(pending==key and journal.get('generation')==113,
         'historical slot1 pending binding drift HOLD')
    op=(journal.get('operations') or {}).get(key)
    if not isinstance(op,dict): return False
    result=op.get('result') or {}
    binding=op.get('binding') or {}
    process=op.get('process')
    if not (result.get('status')=='unknown' and result.get('safe_release') is False
            and binding.get('slot')=='slot1'
            and binding.get('issue')==V4_HISTORICAL_SLOT1_ISSUE
            and binding.get('head')==V4_HISTORICAL_SLOT1_HEAD
            and isinstance(process,dict) and set(process)=={'pid','start','boot'}
            and type(process['pid']) is int and process['pid']>0):
        return False
    # Dead recorded identity only; never invent safe_release or ignore UNKNOWN.
    return receiver.identity(process['pid'])!=process


def _quiet_author_scope_product_qa_ok(ops, author_canary_task_sha256):
    """Author-namespace may leave one finished independent product-QA UNKNOWN pending.

    Physical quiescence already passed. Does not clear pending, invent safe_release,
    declare old PASS, or replay. Unfinished/malformed/same-task/non-QA/wrong
    metadata/live PID still HOLD. Requires a later protected role-ready PASS proof.
    """
    pending=ops.get('pending')
    if pending is None:
        return
    need(ops.get('schema')=='GB_PRODUCT_QA_OPS_V1' and isinstance(ops.get('operations'),dict),
         'malformed product QA ops HOLD')
    need(re.fullmatch('[a-f0-9]{64}', author_canary_task_sha256 or ''),
         'author canary task hash required for author quiet scope HOLD')
    need(pending!=author_canary_task_sha256,'same canary task product QA pending HOLD')
    need(isinstance(pending,str) and pending in ops['operations'],
         'malformed product QA pending HOLD')
    op=ops['operations'][pending]
    need(isinstance(op,dict),'malformed product QA pending HOLD')
    need(re.fullmatch('[a-f0-9]{64}',op.get('task_hash') or '')
         and op['task_hash']!=author_canary_task_sha256,'same canary task or unbound task HOLD')
    binding=op.get('binding')
    need(isinstance(binding,dict) and binding.get('stage')=='product_qa',
         'non-QA product pending HOLD')
    need(type(op.get('finished_at')) is int and op['finished_at']>0,
         'unfinished product QA pending HOLD')
    process=op.get('process')
    if process is not None:
        need(type(process) is dict and set(process)=={'pid','start','boot'}
             and type(process['pid']) is int and process['pid']>0,
             'malformed product QA process HOLD')
        need(receiver.identity(process['pid'])!=process,
             'live product QA process HOLD')
    result=op.get('result')
    need(isinstance(result,dict) and result.get('status')=='unknown'
         and result.get('safe_release') is False,
         'product QA pending not finished UNKNOWN HOLD')
    need(V4_PRODUCT_READY.exists(),'later product QA ready proof required for author scope HOLD')
    ready=receiver.read(V4_PRODUCT_READY,0)
    need(isinstance(ready,dict) and ready.get('schema')=='GB_PRODUCT_QA_ROLE_READY_V1'
         and ready.get('phase')=='ready' and ready.get('verdict')=='PASS'
         and ready.get('executor_uid')==978 and ready.get('model')=='claude-sonnet-5-5-medium'
         and re.fullmatch('[a-f0-9]{64}',ready.get('operation') or '')
         and ready['operation']!=pending
         and type(ready.get('confirmed_at')) is int
         and ready['confirmed_at']>op['finished_at'],
         'later product QA ready proof required for author scope HOLD')


def quiet_v4(resource_scope=QUIET_SCOPE_SHARED_QA, *, author_canary_task_sha256=None):
    """Historical pending UNKNOWN may remain; NEW product-QA resources must be free.

    Does not call quiet()/safe_checkpoint (those require pending=none / terminal
    ACCEPTED evidence). Proves units inactive+masked, UID1002/978 model/cgroup
    absence, recorded PID/start/boot identities dead, kernel worker locks/leases
    free, no integration/recovery occupancy, free product-qa lease, and
    product-qa ops pending none under default shared_qa scope. Author-only scope
    native_antigravity_author may leave one finished independent product-QA
    UNKNOWN after the same physical checks plus later role-ready proof; it is not
    a CLI/universal bypass. Does NOT assert installed OLD pins (those are
    transaction current-state checks). Targeted HOLD names the conflicting live
    resource; never invents assume_safe/ignore_pending bypass. Only the proven
    historical Issue346 pr_wait CP (dead process) plus idle/done may remain.
    """
    need(resource_scope in (QUIET_SCOPE_SHARED_QA, QUIET_SCOPE_NATIVE_ANTIGRAVITY_AUTHOR),
         'unsupported quiet resource scope HOLD')
    import pwd
    receiver.units_quiet(receiver.UNITS)
    for unit in receiver.UNITS:
        props=dict(line.split('=',1) for line in run(['/usr/bin/systemctl','show',unit,
            '--property=ActiveState,MainPID,UnitFileState']).decode().splitlines() if '=' in line)
        need(props.get('ActiveState')=='inactive' and props.get('MainPID')=='0'
             and props.get('UnitFileState')=='masked','units must be inactive and masked')
    for slot,uname in (('slot1','agentagency-dev'),('slot2','gb-slot2')):
        uid=pwd.getpwnam(uname).pw_uid
        j=receiver.journal(slot)
        # Observe only: historical pending UNKNOWN bytes stay; never require pending none.
        for op in j.get('operations',{}).values():
            process=op.get('process')
            if process:
                need(type(process) is dict and set(process)=={'pid','start','boot'}
                     and type(process['pid']) is int and process['pid']>0,
                     'invalid recorded process identity HOLD: '+slot)
                need(receiver.identity(process['pid'])!=process,
                     'recorded operation process still alive HOLD: '+slot)
        state,_=receiver.checkpoint(slot)
        # Live unmatched nonterminal CP is a current effect; historical done/None
        # or the exact Owner-approved stopped Issue346 pr_wait binding is fine.
        need(_v4_historical_checkpoint_ok(slot,state,j),
             'live checkpoint active HOLD: '+slot)
        receiver.no_models(uid,slot)
        lock_unheld(receiver.AUTONOMY/'slots'/slot/'worker.lock',uid)
        lock_unheld(receiver.AUTONOMY/'locks'/(slot+'.lease'),uid)
    need(not os.path.lexists(STATE/'integration.json'),'integration in flight HOLD')
    need(not any(v['status'].endswith('_pending') for v in receiver.recovery_journal()['receipts'].values()),
         'recovery stage in flight HOLD')
    receiver.no_models(978,'slot2')
    lock_unheld(receiver.AUTONOMY/'locks'/'product-qa.lease',978)
    receiver.free_lock(receiver.AUTONOMY/'locks'/'product-qa.lease')
    # The installed C5 adapter has no product constants before this upgrade.
    if V4_PRODUCT_OPS.exists():
        ops=receiver.read(V4_PRODUCT_OPS,0)
        if resource_scope==QUIET_SCOPE_SHARED_QA:
            need(ops.get('pending') is None,'product QA operation still pending/UNKNOWN HOLD')
        else:
            _quiet_author_scope_product_qa_ok(ops, author_canary_task_sha256)


def v4_reviewed_budget_config5(budget):
    """Minimal reviewed AGY product-QA budget (Issue #5 shape), no ledger reset.

    Sets providers.agy.qa and both slots' agy.qa to unlimited, and
    providers.agy.per_issue_daily=5. Preserves unrelated providers/roles/caps.
    No global cap field. Trusted integrator applies bytes; counters untouched.
    """
    need(isinstance(budget,dict) and set(budget)<= {'schema','providers','slots'},
         'invalid budgets for config5')
    need('global_cap' not in budget and 'daily_global' not in budget
         and 'global' not in budget,'global budget cap forbidden')
    nxt=copy.deepcopy(budget)
    if 'schema' in nxt: need(nxt['schema']==1,'unsupported budget schema')
    providers=nxt.setdefault('providers',{})
    need(isinstance(providers,dict),'invalid providers')
    agy=dict(providers.get('agy') or {})
    agy['qa']='unlimited'
    agy['per_issue_daily']=5
    providers['agy']=agy
    slots=nxt.setdefault('slots',{})
    need(isinstance(slots,dict),'invalid slots')
    for slot in ('slot1','slot2'):
        cell=dict(slots.get(slot) or {})
        slot_agy=dict(cell.get('agy') or {})
        slot_agy['qa']='unlimited'
        cell['agy']=slot_agy
        slots[slot]=cell
    return nxt


def _v4_backup_name(name):
    """Flat backup filename; live/slots.py → live__slots.py."""
    return name.replace('/', '__')


def _v4_save(j):
    """Crash-safe journal write; reuse durable save CAS (never expected=None always)."""
    # First create: current is None. Later updates: expect exact prior metadata.
    # Never unlink-then-create the journal.
    atomic_bytes(V4_JOURNAL,encoded(j),dict(mode=0o600,uid=OWNER_UID,gid=OWNER_GID),
                 expected=current(V4_JOURNAL))


def _v4_material(items,bundle):
    """Lib targets from manifest items; canon from BUNDLE_RULES (not in manifest)."""
    target={}
    for name in V4_OLD:
        if name=='accepted-engineering-rules.md':
            raw=git(bundle,'show',RULES_COMMIT+':'+BUNDLE_RULES)
        else:
            raw=items[INSTALL/name]
        need(bytes_sha(raw)==V4_NEW[name],'V4 source/NEW pin mismatch: '+name)
        target[name]=raw
    need(len(target['accepted-engineering-rules.md'])==RULES_SIZE,'accepted canon size differs')
    return target


def _v4_workflow_gates(bundle,controller,stage_sha,dispatch_sha):
    """Exact workflow digests must bind ref:controller (zeros placeholder allowed)."""
    for name,pin in (('train-stage.yml',stage_sha),('train-dispatch.yml',dispatch_sha)):
        raw=regular_bytes(bundle/'.github/workflows'/name)
        need(bytes_sha(raw)==pin and raw.count(('ref: '+controller).encode())==2,
             'unreviewed V4 workflow/pin HOLD: '+name)


def _v4_current(j):
    """Validate every fixed target against journal OLD/NEW + write_intent (V3 semantics)."""
    paths=_v4_paths()
    applied=j.get('applied') or []
    restored=j.get('restored') or []
    intent=j.get('write_intent')
    for n,row in j['changes'].items():
        state=row['after'] if n in applied and n not in restored else row['before']
        allowed=[state]
        if intent and intent.get('target')==n:
            allowed=[row['before'],row['after']]
        need(current(paths[n]) in allowed,'foreign CAS drift: '+n)


def _v4_plan(target,baseline,controller,stage_sha):
    # Actual OLD/root metadata BEFORE any writes (supports None preimage).
    for name,pin in V4_OLD.items():
        need(current(INSTALL/name)==canonical_meta(pin),
             'V4 installed OLD pin mismatch HOLD: '+name+'; blocker=installed module drift')
        need(bytes_sha(target[name])==V4_NEW[name],'V4 target/NEW pin mismatch: '+name)
    for name,pin in V4_FROZEN.items():
        need(current(INSTALL/name)==canonical_meta(pin),
             'V4 frozen compatible dependency HOLD: '+name)
    changes={n:dict(before=canonical_meta(V4_OLD[n]),after=canonical_meta(V4_NEW[n])) for n in V4_OLD}
    # Root policy: bind new controller + stage workflow while remaining disabled.
    policy_raw=regular_bytes(receiver.POLICY)
    policy=loads(policy_raw)
    need(policy.get('controller_sha')==baseline==C5
         and policy.get('mode') in ('active','disabled')
         and re.fullmatch('[a-f0-9]{64}',policy.get('stage_workflow_sha256','')),
         'V4 baseline policy/controller HOLD')
    need(controller!=baseline,'V4 distinct reviewed controller required')
    nextpolicy=copy.deepcopy(policy)
    nextpolicy.update(mode='disabled',controller_sha=controller,stage_workflow_sha256=stage_sha)
    if isinstance(nextpolicy.get('recovery'),dict):
        nextpolicy['recovery']=dict(nextpolicy['recovery'],source_sha=controller)
    policy_after=encoded(nextpolicy)
    changes['policy']=dict(before=canonical_meta(bytes_sha(policy_raw)),
                           after=canonical_meta(bytes_sha(policy_after)))
    target=dict(target,policy=policy_after)
    # Cursor marker native_guard pin must track the accepted PR341 guard delta.
    cursor_raw=regular_bytes(V3_MARKERS['cursor_marker'])
    cursor_after=module_pins_only(cursor_raw,'cursor_marker',
                                  {'native_guard.py':V4_NEW['native_guard.py']})
    changes['cursor_marker']=dict(before=canonical_meta(bytes_sha(cursor_raw)),
                                  after=canonical_meta(bytes_sha(cursor_after)))
    target=dict(target,cursor_marker=cursor_after)
    # AGY marker module pins must track native_antigravity/native_guard or READY drifts.
    marker_raw=regular_bytes(V3_MARKERS['agy_marker'])
    pins={'native_guard.py':V4_NEW['native_guard.py'],
          'native_antigravity.py':V4_NEW['native_antigravity.py']}
    marker_after=module_pins_only(marker_raw,'agy_marker',pins)
    changes['agy_marker']=dict(before=canonical_meta(bytes_sha(marker_raw)),
                               after=canonical_meta(bytes_sha(marker_after)))
    target=dict(target,agy_marker=marker_after)
    # Budget config5: agy qa unlimited both slot/provider + per_issue_daily=5; no ledger reset.
    need(os.path.lexists(receiver.BUDGET),'V4 budgets.json missing HOLD; config5 cannot apply')
    budget_raw=regular_bytes(receiver.BUDGET)
    budget_after=encoded(v4_reviewed_budget_config5(loads(budget_raw)))
    changes['budget']=dict(before=canonical_meta(bytes_sha(budget_raw)),
                           after=canonical_meta(bytes_sha(budget_after)))
    target=dict(target,budget=budget_after)
    # Inventory must list every present OLD target; None preimage may be absent.
    inv_path=STATE/'backup.json'
    need(os.path.lexists(inv_path),'V4 inventory missing HOLD; cannot prove OLD→NEW without backup.json')
    inv_raw=regular_bytes(inv_path)
    record=loads(inv_raw)
    need(type(record) is dict and type(record.get('after')) is dict,'invalid V4 inventory')
    for name,pin in V4_OLD.items():
        key=str(INSTALL/name)
        need(record['after'].get(key)==pin,
             'V4 inventory OLD pin missing/drift HOLD: '+name)
    inv_changes={n:changes[n] for n in V4_OLD}
    inv_after=inventory_bytes(inv_raw,inv_changes)
    changes['inventory']=dict(before=canonical_meta(bytes_sha(inv_raw),0o600),
                              after=canonical_meta(bytes_sha(inv_after),0o600))
    target=dict(target,inventory=inv_after)
    return changes,target


def _v4_paths():
    return {**{n:INSTALL/n for n in V4_OLD},
            'policy':receiver.POLICY,
            'cursor_marker':V3_MARKERS['cursor_marker'],
            'agy_marker':V3_MARKERS['agy_marker'],
            'budget':receiver.BUDGET,
            'inventory':STATE/'backup.json'}


def _v4_order():
    # Policy first (disabled+new controller), then libs, both markers, budget, inventory.
    # Rollback reverses so exact OLD policy is restored last while mode stays disabled.
    return ['policy']+sorted(V4_OLD)+['cursor_marker','agy_marker','budget','inventory']


def _v4_restore_one(j,name,paths):
    """Restore one applied target from backup / unlink None-preimage NEW."""
    before=j['changes'][name]['before']
    after=j['changes'][name]['after']
    path=paths[name]
    now=current(path)
    if now==before: return
    if before is None:
        unlink_cas(path,after)
        return
    raw,_=read_file(V4_BACKUP/_v4_backup_name(name),trusted=False)
    need(bytes_sha(raw)==before['sha256'],'V4 backup bytes drift: '+name)
    atomic_bytes(path,raw,before,expected=after)


def execute_v4(action,bundle,manifest,controller,stage_sha,dispatch_sha,run_id,baseline,commit,branch):
    need(os.geteuid()==OWNER_UID,'root integrator only')
    need(action in ('dry','apply','verify','activate','rollback'),'invalid V4 action')
    need(re.fullmatch('[a-f0-9]{40}',baseline or '') and re.fullmatch('[a-f0-9]{40}',controller or ''),
         'immutable controller required')
    need(re.fullmatch('[a-f0-9]{64}',stage_sha or '') and re.fullmatch('[a-f0-9]{64}',dispatch_sha or ''),
         'exact workflow digests required')
    need(re.fullmatch('[a-f0-9]{64}',manifest or ''),'exact manifest digest required')
    quiet_v4()
    need(re.fullmatch('[a-f0-9]{40}',commit or ''),'V4 exact reviewed candidate required')
    need(baseline==C5 and controller!=baseline,'V4 C5→new controller protocol gate')
    _v4_workflow_gates(bundle,controller,stage_sha,dispatch_sha)
    # Trusted bundle/manifest gates (same primitives as V2/V3 source()).
    items=source(bundle,commit,branch,manifest,controller,stage_sha,dispatch_sha,version=4)
    lib_target=_v4_material(items,bundle)
    slot1=STATE/'slot1.json';slot2=STATE/'slot2.json'
    slot1_before=slot1.read_bytes() if slot1.exists() else None
    slot2_before=slot2.read_bytes() if slot2.exists() else None
    identity=dict(version=4,baseline=baseline,controller=controller,manifest=manifest,
                  bundle_commit=commit,bundle_branch=branch,stage_sha256=stage_sha,
                  dispatch_sha256=dispatch_sha,schema=V4_SCHEMA,
                  slot1_before_sha256=bytes_sha(slot1_before) if slot1_before else None,
                  slot2_before_sha256=bytes_sha(slot2_before) if slot2_before else None)
    paths=_v4_paths()
    if os.path.lexists(V4_JOURNAL):
        # Use durable journal changes; do not re-plan against already-updated marker/inventory.
        j=loads(regular_bytes(V4_JOURNAL))
        need(isinstance(j,dict) and j.get('schema')==V4_SCHEMA and j.get('identity')==identity,
             'V4 journal identity/schema differs; separate reconciliation required')
        changes=j['changes']
        need(type(j.get('applied')) is list and type(j.get('restored')) is list,'invalid V4 progress')
        if action=='verify':
            need(j['phase']=='installed-disabled','V4 verify requires installed-disabled phase')
            quiet_v4();_v4_current(j)
            for n in V4_OLD:
                need(sha(INSTALL/n)==V4_NEW[n]==changes[n]['after']['sha256'],
                     'V4 verify NEW pin drift: '+n)
            for key in ('policy','cursor_marker','agy_marker','budget','inventory'):
                need(sha(paths[key])==changes[key]['after']['sha256'],
                     'V4 verify metadata pin drift: '+key)
            policy=loads(regular_bytes(receiver.POLICY))
            need(policy.get('mode')=='disabled' and policy.get('controller_sha')==controller
                 and policy.get('stage_workflow_sha256')==stage_sha,
                 'V4 verify disabled policy binding drift')
            need((slot1.read_bytes() if slot1.exists() else None)==slot1_before
                 and (slot2.read_bytes() if slot2.exists() else None)==slot2_before,
                 'V4 verify must not rewrite historical slot journals')
            return dict(phase='installed-disabled',version=4,verified=True,ready=False,
                        role_qualified=False,preserved_slot_pending=True,policy_writes=1)
        if action=='activate':
            # Hosted shadow proof then enable policy. Never assert product QA READY.
            need(j['phase'] in ('installed-disabled','activating-proof'),
                 'V4 activate requires installed-disabled')
            need(type(run_id) is int and run_id>0,'exact hosted run required')
            quiet_v4();_v4_current(j)
            policy=loads(regular_bytes(receiver.POLICY))
            need(policy.get('mode')=='disabled' and policy.get('controller_sha')==controller
                 and policy.get('stage_workflow_sha256')==stage_sha,
                 'V4 activate disabled policy binding required')
            for n in V4_OLD:
                need(sha(INSTALL/n)==V4_NEW[n]==changes[n]['after']['sha256'],
                     'V4 activate NEW pin drift: '+n)
            j['phase']='activating-proof';_v4_save(j)
            proof=probe(run_id,dict(j,dispatch_sha256=dispatch_sha))
            quiet_v4();_v4_current(j)
            active_policy=dict(policy,mode='active')
            atomic_bytes(receiver.POLICY,encoded(active_policy),
                         canonical_meta(bytes_sha(encoded(active_policy))),
                         expected=changes['policy']['after'])
            j.update(phase='proof-recorded',shadow=proof);_v4_save(j)
            return dict(phase='proof-recorded',version=4,shadow=proof,ready=False,
                        role_qualified=False,preserved_slot_pending=True,policy_writes=1)
        if action=='rollback':
            need(j['phase'] in ('preparing','applying','installed-disabled','activating-proof',
                                'rolling-back'),
                 'V4 rollback phase unsupported')
            need(loads(regular_bytes(receiver.POLICY)).get('mode')=='disabled',
                 'V4 rollback refuses after active policy; separate reconciliation')
            if j['phase']=='preparing' and not j.get('applied'):
                j['phase']='rolled-back';_v4_save(j)
                return dict(phase='rolled-back',state_preserved=True,noop=True)
            # Classify last owned apply intent by exact bytes before switching phase
            # (V3 semantics): interrupted write must not be lost from applied.
            if j.get('write_intent') and j['write_intent'].get('action')=='apply':
                n=j['write_intent']['target']
                if current(paths[n])==j['changes'][n]['after'] and n not in j['applied']:
                    j['applied'].append(n)
                j['write_intent']=None
            j['phase']='rolling-back';_v4_save(j)
            # Reverse apply order so policy (first written, disabled) restores last.
            order=list(reversed(j['applied']))
            for name in order[len(j['restored']):]:
                quiet_v4();_v4_current(j)
                j['write_intent']=dict(action='rollback',target=name);_v4_save(j)
                _v4_restore_one(j,name,paths)
                j['restored'].append(name);j['write_intent']=None;_v4_save(j)
            need((slot1.read_bytes() if slot1.exists() else None)==slot1_before
                 and (slot2.read_bytes() if slot2.exists() else None)==slot2_before,
                 'V4 rollback must not rewrite historical slot journals')
            j['phase']='rolled-back';_v4_save(j)
            return dict(phase='rolled-back',state_preserved=True,ready=False)
        need(False,'V4 prior journal exists; use verify/activate/rollback (apply refused)')
    # Fresh plan only when no journal (dry/apply). Re-planning after apply would
    # fail module_pins_only against already-updated marker pins.
    changes,target=_v4_plan(lib_target,baseline,controller,stage_sha)
    if action=='dry':
        return dict(dry=True,status='PLANNED_PRODUCT_QA_UPGRADE',version=4,changes=changes,
                    preserved_slot_pending=True,role_qualified=False,ready=False,policy_writes=1)
    need(action=='apply','V4 verify/activate/rollback require existing journal; apply first')
    need(not os.path.lexists(V4_BACKUP),'prior V4 backup exists; inspect/rollback')
    j=dict(schema=V4_SCHEMA,identity=identity,identity_sha256=digest(identity),
           phase='preparing',installed_at=int(time.time()),changes=changes,
           preserved_slot1=identity['slot1_before_sha256'],
           preserved_slot2=identity['slot2_before_sha256'],
           applied=[],restored=[],write_intent=None)
    _v4_save(j)
    V4_BACKUP.mkdir(mode=0o700)
    order=_v4_order()
    for name in order:
        path=paths[name]
        before=changes[name]['before']
        if before is None:
            need(not os.path.lexists(path),'pre-backup absent drift: '+name)
            continue
        raw,_=read_file(path)
        need(bytes_sha(raw)==before['sha256'],'pre-backup OLD drift: '+name)
        atomic_bytes(V4_BACKUP/_v4_backup_name(name),raw,
                     canonical_meta(before['sha256'],0o600),expected=None)
    quiet_v4();_v4_current(j)
    j['phase']='applying';_v4_save(j)
    for name in order:
        quiet_v4();_v4_current(j)
        j['write_intent']=dict(action='apply',target=name);_v4_save(j)
        atomic_bytes(paths[name],target[name],changes[name]['after'],
                     expected=changes[name]['before'])
        j['applied'].append(name);j['write_intent']=None;_v4_save(j)
    need((slot1.read_bytes() if slot1.exists() else None)==slot1_before
         and (slot2.read_bytes() if slot2.exists() else None)==slot2_before,
         'V4 install must not rewrite historical slot journals')
    quiet_v4();_v4_current(j)
    j['phase']='installed-disabled';_v4_save(j)
    return dict(phase='installed-disabled',version=4,state_preserved=True,
                preserved_slot_pending=True,role_qualified=False,ready=False,
                policy_writes=1,applied=list(j['applied']))



# V5: general reusable Antigravity product QA — Git-authoritative install (OD-014A).
# Narrow extension of V4 primitives: same trusted bundle/read/CAS/backup/rollback.
# Desired content = accepted Git blobs for six target modules; ACTUAL before bytes
# are recorded for backup/rollback. Historical manual OLD/NEW/FROZEN hash maps are
# not upgrade gates. Workflow SHA args come from Git blobs / prepare_train_release.
V5_SCHEMA='GB_STAGE5_GENERAL_PRODUCT_QA_V5'
V5_JOURNAL=STATE/'stage5-general-product-qa.json'
V5_BACKUP=STATE/'stage5-general-product-qa-backup'
# Historical installed358 controller identity only — NOT an upgrade success gate (OD-014A).
V5_BASELINE='d75887f8d50e05aa5e3032a3302c91f23947be5d'
# Historical pending UNKNOWN safety proof only — never new task routing.
V5_HISTORICAL_SLOT1_PENDING=V4_HISTORICAL_SLOT1_PENDING
V5_HISTORICAL_SLOT2_PENDING=V4_HISTORICAL_SLOT2_PENDING
# Six explicit V5 rewrite targets; desired bytes come from Git, not manual NEW pins.
V5_TARGETS=('core.py','receiver.py','stage.py','native_antigravity.py',
            'owner_package_admission.py','client.py')
# Untarget modules: Linux ownership/type guards only; legitimate version drift OK.
V5_UNTARGET=(
 'native_cursor.py','native_guard.py','live/slots.py','context_policy.py',
 'context_cursor_delivery.py','admission_pm.py','accepted-engineering-rules.md',
 'context_exchange.py','antigravity_qa_recovery.py',
)
# Legacy aliases retained for V4 lineage/tests that still read names; unused by active V5 flow.
V5_OLD={n:V4_NEW[n] for n in V5_TARGETS}
V5_NEW={n:None for n in V5_TARGETS}
V5_FROZEN={**V4_FROZEN,
 'native_guard.py':V4_NEW['native_guard.py'],
 'live/slots.py':V4_NEW['live/slots.py'],
 'context_policy.py':V4_NEW['context_policy.py'],
 'context_cursor_delivery.py':V4_NEW['context_cursor_delivery.py'],
 'admission_pm.py':V4_NEW['admission_pm.py'],
 'accepted-engineering-rules.md':V4_NEW['accepted-engineering-rules.md']}


def _uid978_provider_procs_absent():
    """Bounded /proc metadata: refuse live UID978 provider CLIs. No kill/chmod.

    receiver.no_models only observes the legacy slot cgroup; NEW provider processes
    under UID978 may live outside that cgroup. Status+cmdline only; no forensics.
    """
    markers=(b'cursor-agent', b'/agy', b'antigravity', b'gemini', b'codex')
    try:
        entries=os.listdir('/proc')
    except OSError:
        return
    for name in entries:
        if not name.isdigit():
            continue
        try:
            with open('/proc/'+name+'/status','rb') as fh:
                status=fh.read(4096)
        except OSError:
            continue
        uid=None
        for line in status.splitlines():
            if line.startswith(b'Uid:'):
                parts=line.split()
                if len(parts)>=2:
                    try: uid=int(parts[1])
                    except ValueError: uid=None
                break
        if uid!=978:
            continue
        try:
            with open('/proc/'+name+'/cmdline','rb') as fh:
                cmd=fh.read(4096)
        except OSError:
            continue
        if not cmd:
            continue
        lower=cmd.lower()
        need(not any(marker in lower for marker in markers),
             'UID978 provider process still alive HOLD')


def quiet_v5(resource_scope=QUIET_SCOPE_SHARED_QA, *, author_canary_task_sha256=None):
    """Reuse V4 resource quiescence; preserve completed V4 journal/backup/history.

    Default shared_qa is unchanged. Author upgrade may pass
    native_antigravity_author with its canary task hash; UID978 direct-provider
    absence remains mandatory after quiet_v4 for every scope.
    """
    quiet_v4(resource_scope, author_canary_task_sha256=author_canary_task_sha256)
    _uid978_provider_procs_absent()
    # Completed V4 transaction must remain; never mutate its journal/backup.
    if V4_JOURNAL.exists():
        j=loads(regular_bytes(V4_JOURNAL))
        need(isinstance(j,dict) and j.get('schema')==V4_SCHEMA, 'V4 journal must stay intact for V5')


def _v5_tx_paths(controller):
    """Per-controller journal/backup so a prior completed V5 Git commit cannot block the next.

    Filenames stay in the existing STATE family. V5_JOURNAL/V5_BACKUP module
    constants remain the historical unsuffixed names for docs/legacy references;
    active V5 transactions always select the controller-suffixed paths below.
    """
    need(re.fullmatch('[a-f0-9]{40}',controller or ''),'immutable controller required')
    return (STATE/('stage5-general-product-qa-%s.json'%controller),
            STATE/('stage5-general-product-qa-backup-%s'%controller))


def _v5_save(j,journal):
    atomic_bytes(journal,encoded(j),dict(mode=0o600,uid=OWNER_UID,gid=OWNER_GID),
                 expected=current(journal))


def _v5_backup_name(name):
    return name.replace('/', '__')


def _v5_paths():
    return {**{n:INSTALL/n for n in V5_TARGETS},
            'policy':receiver.POLICY,
            'agy_marker':V3_MARKERS['agy_marker'],
            'inventory':STATE/'backup.json'}


def _v5_order():
    return ['policy']+sorted(V5_TARGETS)+['agy_marker','inventory']


def _v5_material(items):
    """Desired bytes = Git blobs already validated by source(); no manual NEW pin."""
    target={}
    for name in V5_TARGETS:
        raw=items[INSTALL/name]
        need(isinstance(raw,(bytes,bytearray)) and len(raw)>0,'V5 empty Git target: '+name)
        target[name]=bytes(raw)
    return target


def _v5_workflow_gates(bundle,controller,baseline,stage_sha,dispatch_sha):
    """Accept exact OLD keep (actual baseline) or NEW controller workflow child release."""
    for name,pin in (('train-stage.yml',stage_sha),('train-dispatch.yml',dispatch_sha)):
        raw=regular_bytes(bundle/'.github/workflows'/name)
        need(bytes_sha(raw)==pin, 'unreviewed V5 workflow/pin HOLD: '+name)
        new_n=raw.count(('ref: '+controller).encode())
        old_n=raw.count(('ref: '+baseline).encode())
        need((new_n==2 and old_n==0) or (old_n==2 and new_n==0),
             'unreviewed V5 workflow keep/release pin HOLD: '+name)


def _v5_untarget_guards():
    """Ownership/type/symlink guards for untarget modules; hash pins do not gate upgrades."""
    for name in V5_UNTARGET:
        path=INSTALL/name
        if not os.path.lexists(path):
            continue
        info=path.lstat()
        need(stat.S_ISREG(info.st_mode) and info.st_nlink==1
             and info.st_uid==OWNER_UID and info.st_gid==OWNER_GID
             and not info.st_mode & 0o022,'V5 untarget unsafe type/owner/mode: '+name)
        # Bound read proves regular file / no symlink follow; content version may differ.
        read_file(path)


def _v5_agy_marker_pins_only(raw,newpins,oldpins):
    """Post-V4 AGY marker → Git-desired module pins; preserve non-module legacy fields.

    Prior module values are history, not an upgrade gate. Preserve every other
    marker field; new values describe the verified Git installation.
    """
    old=loads(raw);updated=copy.deepcopy(old)
    need(type(old) is dict and type(old.get('modules')) is dict,'invalid native marker')
    need(old.get('schema')=='GB_ANTIGRAVITY_QA_29_V1'
         and old.get('phase') in ('canary','ready'), 'invalid AGY marker contract')
    matches=list(re.finditer(rb'"modules"\s*:\s*\{[^{}]*\}',raw))
    need(len(matches)==1,'ambiguous marker modules object')
    m=matches[0];piece=m[0]
    for name,pin in newpins.items():
        need(name in old['modules'],'missing marker module field')
        need(type(old['modules'][name]) is str
             and re.fullmatch('[a-f0-9]{64}',old['modules'][name]),
             'invalid historical marker module value')
        pattern=re.escape(encoded(name))+rb'\s*:\s*"'+old['modules'][name].encode()+b'"'
        hits=list(re.finditer(pattern,piece));need(len(hits)==1,'ambiguous module pin')
        hit=hits[0]
        piece=piece[:hit.start()]+hit[0].replace(old['modules'][name].encode(),pin.encode())+piece[hit.end():]
        updated['modules'][name]=pin
    result=raw[:m.start()]+piece+raw[m.end():]
    need(loads(result)==updated and len(result)==len(raw),'marker fields changed outside module pins')
    return result


def _v5_inventory_after(inv_raw,changes):
    """Rewrite inventory target hashes from ACTUAL before→Git after; stale recorded hash OK."""
    record=loads(inv_raw);updated=copy.deepcopy(record)
    need(type(record) is dict and type(record.get('after')) is dict,'invalid V5 inventory')
    raw=inv_raw
    for name,row in sorted(changes.items()):
        key=str(INSTALL/name);new=row['after']['sha256'];before=row['before']
        need(before is not None and before['sha256'],'V5 inventory requires present target: '+name)
        recorded=record['after'].get(key)
        if recorded is None:
            match=re.search(rb'"after"\s*:\s*\{',raw)
            need(match is not None,'missing inventory after object')
            raw=raw[:match.end()]+encoded(key)+b':'+encoded(new)+b','+raw[match.end():]
        elif recorded==before['sha256']:
            pattern=re.escape(encoded(key))+rb'\s*:\s*"'+before['sha256'].encode()+b'"'
            matches=list(re.finditer(pattern,raw));need(len(matches)==1,'ambiguous inventory target')
            match=matches[0]
            piece=raw[match.start():match.end()].replace(before['sha256'].encode(),new.encode())
            raw=raw[:match.start()]+piece+raw[match.end():]
        else:
            # Stale historical inventory hash: replace recorded value, do not block upgrade.
            pattern=re.escape(encoded(key))+rb'\s*:\s*"'+re.escape(recorded.encode())+b'"'
            matches=list(re.finditer(pattern,raw));need(len(matches)==1,'ambiguous stale inventory target')
            match=matches[0]
            piece=raw[match.start():match.end()].replace(recorded.encode(),new.encode())
            raw=raw[:match.start()]+piece+raw[match.end():]
        updated['after'][key]=new
    need(loads(raw)==updated,'inventory edit differs outside targets')
    return raw


def _v5_current(j):
    paths=_v5_paths()
    applied=j.get('applied') or []
    restored=j.get('restored') or []
    intent=j.get('write_intent')
    for n,row in j['changes'].items():
        state=row['after'] if n in applied and n not in restored else row['before']
        allowed=[state]
        if intent and intent.get('target')==n:
            allowed=[row['before'],row['after']]
        need(current(paths[n]) in allowed,'foreign CAS drift: '+n)
    _v5_untarget_guards()


def _v5_plan(target,baseline,controller,stage_sha):
    """Plan from ACTUAL before metadata + Git desired bytes; no manual OLD/NEW pins."""
    _v5_untarget_guards()
    changes={}
    for name in V5_TARGETS:
        before=current(INSTALL/name)
        need(before is not None,'V5 installed target missing HOLD: '+name)
        exact_meta(before)
        desired=bytes_sha(target[name])
        after=dict(mode=0o644,uid=OWNER_UID,gid=OWNER_GID,sha256=desired)
        exact_meta(after)
        changes[name]=dict(before=before,after=after)
    policy_before=current(receiver.POLICY)
    need(policy_before is not None,'V5 policy missing HOLD')
    policy_raw=regular_bytes(receiver.POLICY)
    policy=loads(policy_raw)
    # baseline records ACTUAL current policy identity — not a hardcoded d758 gate.
    need(policy.get('controller_sha')==baseline
         and policy.get('mode') in ('active','disabled')
         and re.fullmatch('[a-f0-9]{64}',policy.get('stage_workflow_sha256','')),
         'V5 baseline policy/controller HOLD')
    need(controller!=baseline,'V5 distinct reviewed controller required')
    nextpolicy=copy.deepcopy(policy)
    nextpolicy.update(mode='disabled',controller_sha=controller,stage_workflow_sha256=stage_sha)
    if isinstance(nextpolicy.get('recovery'),dict):
        nextpolicy['recovery']=dict(nextpolicy['recovery'],source_sha=controller)
    policy_after=encoded(nextpolicy)
    changes['policy']=dict(before=policy_before,
                           after=dict(mode=policy_before['mode'],uid=OWNER_UID,gid=OWNER_GID,
                                      sha256=bytes_sha(policy_after)))
    target=dict(target,policy=policy_after)
    marker_before=current(V3_MARKERS['agy_marker'])
    need(marker_before is not None,'V5 AGY marker missing HOLD')
    marker_raw=regular_bytes(V3_MARKERS['agy_marker'])
    guard=current(INSTALL/'native_guard.py')
    antigravity=current(INSTALL/'native_antigravity.py')
    need(guard is not None and antigravity is not None,'V5 AGY marker module sources missing')
    oldpins={'native_guard.py':guard['sha256'],
             'native_antigravity.py':antigravity['sha256']}
    newpins={'native_guard.py':guard['sha256'],
             'native_antigravity.py':bytes_sha(target['native_antigravity.py'])}
    marker_after=_v5_agy_marker_pins_only(marker_raw,newpins,oldpins)
    changes['agy_marker']=dict(before=marker_before,
                               after=dict(mode=marker_before['mode'],uid=OWNER_UID,gid=OWNER_GID,
                                          sha256=bytes_sha(marker_after)))
    target=dict(target,agy_marker=marker_after)
    inv_path=STATE/'backup.json'
    inv_before=current(inv_path)
    need(inv_before is not None,'V5 inventory missing HOLD')
    need(inv_before['mode']==0o600,'V5 inventory mode HOLD')
    inv_raw=regular_bytes(inv_path)
    inv_changes={n:changes[n] for n in V5_TARGETS}
    inv_after=_v5_inventory_after(inv_raw,inv_changes)
    changes['inventory']=dict(before=inv_before,
                              after=dict(mode=0o600,uid=OWNER_UID,gid=OWNER_GID,
                                         sha256=bytes_sha(inv_after)))
    target=dict(target,inventory=inv_after)
    return changes,target


def _v5_restore_one(j,name,paths,backup):
    before=j['changes'][name]['before']
    after=j['changes'][name]['after']
    path=paths[name]
    now=current(path)
    if now==before: return
    if before is None:
        unlink_cas(path,after)
        return
    raw,_=read_file(backup/_v5_backup_name(name),trusted=False)
    need(bytes_sha(raw)==before['sha256'],'V5 backup bytes drift: '+name)
    atomic_bytes(path,raw,before,expected=after)


def execute_v5(action,bundle,manifest,controller,stage_sha,dispatch_sha,run_id,baseline,commit,branch):
    need(os.geteuid()==OWNER_UID,'root integrator only')
    need(action in ('dry','apply','verify','activate','rollback'),'invalid V5 action')
    need(re.fullmatch('[a-f0-9]{40}',baseline or '') and re.fullmatch('[a-f0-9]{40}',controller or ''),
         'immutable controller required')
    need(re.fullmatch('[a-f0-9]{64}',stage_sha or '') and re.fullmatch('[a-f0-9]{64}',dispatch_sha or ''),
         'exact workflow digests required')
    need(re.fullmatch('[a-f0-9]{64}',manifest or ''),'legacy manifest digest format')
    quiet_v5()
    need(re.fullmatch('[a-f0-9]{40}',commit or ''),'V5 exact reviewed candidate required')
    need(controller!=baseline,'V5 distinct reviewed controller required')
    journal,backup=_v5_tx_paths(controller)
    _v5_workflow_gates(bundle,controller,baseline,stage_sha,dispatch_sha)
    items=source(bundle,commit,branch,manifest,controller,stage_sha,dispatch_sha,
                 version=5,baseline=baseline)
    lib_target=_v5_material(items)
    # Integrity: installed after activate/verify must equal these Git desired digests.
    git_desired={n:bytes_sha(lib_target[n]) for n in V5_TARGETS}
    slot1=STATE/'slot1.json';slot2=STATE/'slot2.json'
    slot1_before=slot1.read_bytes() if slot1.exists() else None
    slot2_before=slot2.read_bytes() if slot2.exists() else None
    v4_before=V4_JOURNAL.read_bytes() if V4_JOURNAL.exists() else None
    identity=dict(version=5,baseline=baseline,controller=controller,manifest=manifest,
                  bundle_commit=commit,bundle_branch=branch,stage_sha256=stage_sha,
                  dispatch_sha256=dispatch_sha,schema=V5_SCHEMA,
                  git_desired=git_desired,
                  slot1_before_sha256=bytes_sha(slot1_before) if slot1_before else None,
                  slot2_before_sha256=bytes_sha(slot2_before) if slot2_before else None,
                  v4_journal_sha256=bytes_sha(v4_before) if v4_before else None)
    paths=_v5_paths()
    if os.path.lexists(journal):
        j=loads(regular_bytes(journal))
        need(isinstance(j,dict) and j.get('schema')==V5_SCHEMA and j.get('identity')==identity,
             'V5 journal identity/schema differs; separate reconciliation required')
        changes=j['changes']
        need(type(j.get('applied')) is list and type(j.get('restored')) is list,'invalid V5 progress')
        if action=='verify':
            need(j['phase']=='installed-disabled','V5 verify requires installed-disabled phase')
            quiet_v5();_v5_current(j)
            for n in V5_TARGETS:
                need(sha(INSTALL/n)==git_desired[n]==changes[n]['after']['sha256'],
                     'V5 verify Git blob drift: '+n)
            for key in ('policy','agy_marker','inventory'):
                need(sha(paths[key])==changes[key]['after']['sha256'],
                     'V5 verify metadata pin drift: '+key)
            policy=loads(regular_bytes(receiver.POLICY))
            need(policy.get('mode')=='disabled' and policy.get('controller_sha')==controller
                 and policy.get('stage_workflow_sha256')==stage_sha,
                 'V5 verify disabled policy binding drift')
            need((slot1.read_bytes() if slot1.exists() else None)==slot1_before
                 and (slot2.read_bytes() if slot2.exists() else None)==slot2_before,
                 'V5 verify must not rewrite historical slot journals')
            need((V4_JOURNAL.read_bytes() if V4_JOURNAL.exists() else None)==v4_before,
                 'V5 must preserve completed V4 journal')
            return dict(phase='installed-disabled',version=5,verified=True,ready=False,
                        role_qualified=False,preserved_slot_pending=True,policy_writes=1)
        if action=='activate':
            need(j['phase'] in ('installed-disabled','activating-proof'),
                 'V5 activate requires installed-disabled')
            need(type(run_id) is int and run_id>0,'exact hosted run required')
            quiet_v5();_v5_current(j)
            policy=loads(regular_bytes(receiver.POLICY))
            need(policy.get('mode')=='disabled' and policy.get('controller_sha')==controller
                 and policy.get('stage_workflow_sha256')==stage_sha,
                 'V5 activate disabled policy binding required')
            for n in V5_TARGETS:
                need(sha(INSTALL/n)==git_desired[n]==changes[n]['after']['sha256'],
                     'V5 activate Git blob drift: '+n)
            j['phase']='activating-proof';_v5_save(j,journal)
            proof=probe(run_id,dict(j,dispatch_sha256=dispatch_sha))
            quiet_v5();_v5_current(j)
            active_policy=dict(policy,mode='active')
            atomic_bytes(receiver.POLICY,encoded(active_policy),
                         canonical_meta(bytes_sha(encoded(active_policy))),
                         expected=changes['policy']['after'])
            j.update(phase='proof-recorded',shadow=proof);_v5_save(j,journal)
            return dict(phase='proof-recorded',version=5,shadow=proof,ready=False,
                        role_qualified=False,preserved_slot_pending=True,policy_writes=1)
        if action=='rollback':
            need(j['phase'] in ('preparing','applying','installed-disabled','activating-proof',
                                'rolling-back'),
                 'V5 rollback phase unsupported')
            # Pre-write preparing/applying: OLD policy may still be active. Validate exact
            # BEFORE CAS for all managed targets before the post-write disabled-policy gate.
            if j['phase'] in ('preparing','applying') and not j.get('applied'):
                intent=j.get('write_intent')
                if intent and intent.get('action')=='apply':
                    n=intent['target']
                    if current(paths[n])==j['changes'][n]['after']:
                        j['applied']=list(j.get('applied') or [])+[n]
                    j['write_intent']=None
                if not j.get('applied'):
                    for n,row in j['changes'].items():
                        need(current(paths[n])==row['before'],
                             'V5 pre-write rollback BEFORE CAS drift: '+n)
                    j['phase']='rolled-back';_v5_save(j,journal)
                    return dict(phase='rolled-back',state_preserved=True,noop=True)
            need(loads(regular_bytes(receiver.POLICY)).get('mode')=='disabled',
                 'V5 rollback refuses after active policy; separate reconciliation')
            if j.get('write_intent') and j['write_intent'].get('action')=='apply':
                n=j['write_intent']['target']
                if current(paths[n])==j['changes'][n]['after'] and n not in j['applied']:
                    j['applied'].append(n)
                j['write_intent']=None
            j['phase']='rolling-back';_v5_save(j,journal)
            order=list(reversed(j['applied']))
            for name in order[len(j['restored']):]:
                quiet_v5();_v5_current(j)
                j['write_intent']=dict(action='rollback',target=name);_v5_save(j,journal)
                _v5_restore_one(j,name,paths,backup)
                j['restored'].append(name);j['write_intent']=None;_v5_save(j,journal)
            need((slot1.read_bytes() if slot1.exists() else None)==slot1_before
                 and (slot2.read_bytes() if slot2.exists() else None)==slot2_before,
                 'V5 rollback must not rewrite historical slot journals')
            need((V4_JOURNAL.read_bytes() if V4_JOURNAL.exists() else None)==v4_before,
                 'V5 rollback must preserve completed V4 journal')
            j['phase']='rolled-back';_v5_save(j,journal)
            return dict(phase='rolled-back',state_preserved=True,ready=False)
        need(False,'V5 prior journal exists; use verify/activate/rollback (apply refused)')
    changes,target=_v5_plan(lib_target,baseline,controller,stage_sha)
    for n in V5_TARGETS:
        need(changes[n]['after']['sha256']==git_desired[n],'V5 plan/Git desired mismatch: '+n)
    if action=='dry':
        return dict(dry=True,status='PLANNED_GENERAL_PRODUCT_QA_UPGRADE',version=5,changes=changes,
                    preserved_slot_pending=True,role_qualified=False,ready=False,policy_writes=1,
                    git_commit=commit,git_desired=git_desired)
    need(action=='apply','V5 verify/activate/rollback require existing journal; apply first')
    need(not os.path.lexists(backup),'prior V5 backup exists; inspect/rollback')
    j=dict(schema=V5_SCHEMA,identity=identity,identity_sha256=digest(identity),
           phase='preparing',installed_at=int(time.time()),changes=changes,
           preserved_slot1=identity['slot1_before_sha256'],
           preserved_slot2=identity['slot2_before_sha256'],
           applied=[],restored=[],write_intent=None)
    _v5_save(j,journal)
    backup.mkdir(mode=0o700)
    order=_v5_order()
    for name in order:
        path=paths[name]
        before=changes[name]['before']
        if before is None:
            need(not os.path.lexists(path),'pre-backup absent drift: '+name)
            continue
        raw,_=read_file(path)
        need(bytes_sha(raw)==before['sha256'],'pre-backup OLD drift: '+name)
        atomic_bytes(backup/_v5_backup_name(name),raw,
                     canonical_meta(before['sha256'],0o600),expected=None)
    quiet_v5();_v5_current(j)
    j['phase']='applying';_v5_save(j,journal)
    for name in order:
        quiet_v5();_v5_current(j)
        j['write_intent']=dict(action='apply',target=name);_v5_save(j,journal)
        atomic_bytes(paths[name],target[name],changes[name]['after'],
                     expected=changes[name]['before'])
        j['applied'].append(name);j['write_intent']=None;_v5_save(j,journal)
    need((slot1.read_bytes() if slot1.exists() else None)==slot1_before
         and (slot2.read_bytes() if slot2.exists() else None)==slot2_before,
         'V5 install must not rewrite historical slot journals')
    need((V4_JOURNAL.read_bytes() if V4_JOURNAL.exists() else None)==v4_before,
         'V5 install must preserve completed V4 journal')
    quiet_v5();_v5_current(j)
    for n in V5_TARGETS:
        need(sha(INSTALL/n)==git_desired[n],'V5 installed bytes != accepted Git blob: '+n)
    j['phase']='installed-disabled';_v5_save(j,journal)
    return dict(phase='installed-disabled',version=5,state_preserved=True,
                preserved_slot_pending=True,role_qualified=False,ready=False,
                policy_writes=1,applied=list(j['applied']),git_commit=commit)



def unlink_cas(path,expected):
    parent=directory_fd(path.parent)
    try:
        need(current(path)==expected,'compare-and-swap drift before inverse unlink')
        check=directory_fd(path.parent)
        try:
            need((os.fstat(parent).st_dev,os.fstat(parent).st_ino)==
                 (os.fstat(check).st_dev,os.fstat(check).st_ino),'parent replaced before inverse unlink')
        finally: os.close(check)
        os.unlink(path.name,dir_fd=parent);os.fsync(parent)
    finally: os.close(parent)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('dry','apply','verify','activate','rollback'))
    parser.add_argument('--bundle',required=True,type=pathlib.Path)
    parser.add_argument('--manifest',required=True)
    parser.add_argument('--baseline-controller',required=True)
    parser.add_argument('--controller',required=True)
    parser.add_argument('--stage-hash',required=True);parser.add_argument('--dispatch-hash',required=True)
    parser.add_argument('--bundle-commit');parser.add_argument('--bundle-branch',default='dev')
    parser.add_argument('--version',type=int,choices=(2,3,4,5),default=2)
    parser.add_argument('--run',type=int);a=parser.parse_args()
    path=STATE/'controller.lock'
    # Existing lock only, including dry: no O_CREAT, mkdir or managed byte writes.
    read_file(path)
    parent=directory_fd(path.parent);fd=None
    try:
        fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=parent)
        info=os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_uid==OWNER_UID
             and not info.st_mode & 0o022,'unsafe controller lock')
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        need(stable(os.stat(path.name,dir_fd=parent,follow_symlinks=False))==stable(info),'controller lock replaced')
        print(json.dumps(execute(a.action,a.bundle,a.manifest,a.controller,a.stage_hash,a.dispatch_hash,
                                a.run,a.baseline_controller,a.bundle_commit,a.bundle_branch,a.version),sort_keys=True))
    finally:
        if fd is not None: os.close(fd)
        os.close(parent)


if __name__=='__main__': main()

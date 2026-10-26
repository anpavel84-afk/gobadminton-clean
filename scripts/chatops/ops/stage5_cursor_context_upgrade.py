#!/usr/bin/python3
"""Stage 5 lib-only transaction, never an installer deployment authorization.

Only stage.py, context_cursor_delivery.py, their inventory entries and private
transaction artifacts may change. Policy/controller/workflows/monitor/markers,
rules, budgets and task evidence remain byte-identical. Units must already be
masked and idle. activate records hosted proof ONLY: it cannot assert READY or
enable scoped_v1; the separate reviewed native_guard marker bind is still needed.
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


def preserved():
    """Full state/history/ledger evidence, plus immutable inventory payloads."""
    result={};inventory=STATE/'backup.json'
    excluded={JOURNAL,BACKUP,inventory,STATE/'controller.lock',
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


def source(bundle,commit,branch,manifest,controller,stage_sha,dispatch_sha):
    """Reviewed AGY29 plain-checkout/config gate, extended to ALL tracked blobs."""
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
    if os.path.lexists(bundle/'.git'/'config.worktree'): bundle_config(regular_bytes(bundle/'.git'/'config.worktree'))
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
        raw=material['.github/workflows/'+name]
        need(bytes_sha(raw)==pin and raw.count(('ref: '+controller).encode())==2,'unreviewed workflow/pin')
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


def atomic_bytes(path,raw,meta):
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
            bundle_commit=None,bundle_branch='dev'):
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


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('dry','apply','activate','rollback'))
    parser.add_argument('--bundle',required=True,type=pathlib.Path)
    parser.add_argument('--manifest',required=True)
    parser.add_argument('--baseline-controller',required=True)
    parser.add_argument('--controller',required=True)
    parser.add_argument('--stage-hash',required=True);parser.add_argument('--dispatch-hash',required=True)
    parser.add_argument('--bundle-commit');parser.add_argument('--bundle-branch',default='dev')
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
                                a.run,a.baseline_controller,a.bundle_commit,a.bundle_branch),sort_keys=True))
    finally:
        if fd is not None: os.close(fd)
        os.close(parent)


if __name__=='__main__': main()

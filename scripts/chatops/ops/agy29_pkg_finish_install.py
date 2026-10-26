#!/usr/bin/python3
"""AGY #29 lib-only install. No policy, rules, workflow, marker or budget writes.

The dry observation digest is passed explicitly to apply and stored in J.
Inventory manifest remains the original full install manifest: this delta is
recorded by J, never presented as a full-manifest installation.
"""
import argparse
import contextlib
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pathlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
sys.dont_write_bytecode = True

class Refused(Exception): pass

def need(ok, message):
    if not ok: raise Refused(message)

def digest(value):
    return bytes_sha(json.dumps(value,sort_keys=True,separators=(',',':')).encode())

LIB=Path('/usr/local/lib/gb-actions-train')
STATE=Path('/var/lib/gobadminton-actions-train')
AUTONOMY=Path('/var/lib/gobadminton-autonomy')
POLICY=Path('/etc/gobadminton-actions-train/policy.json')
MARKER=Path('/etc/gobadminton-slots/antigravity-qa.json')
BUDGET=Path('/etc/gobadminton-slots/budgets.json')
INVENTORY=STATE/'backup.json'
J=STATE/'agy29-pkg-finish-install.json'
BK=STATE/'agy29-pkg-finish-backup'
C='41e12be2d551158e97ea30eaf8e95f992f998615'
STAGE_SHA='b9703ca27b7bb3f494f379f8e259e62a6a48bc8f5ff50c6923e1712d8899d68d'
MANIFEST='cf4a4e66e7c1c3a403f0f1bca8d929769de483833cfce9bce0db98a6ce180218'
OLD_MANIFEST='0f16f0d60e05d13fa1778f5e9220341b4f62149ddc3e99ced10235344cf21944'
TARGETS={
 'native_antigravity.py':('99e70d960b1db2567c32dea10a7341487b3aeb511a1aa5a51b85be86cded2d42','01d4816e881765da6361af07a15765528aef274dad0eb780b1afab6b0e5e0f72'),
 'antigravity_qa_recovery.py':('e89e1154128e2ae9ea5536c0345c4a231368a1fe316daf0a444a36c2e2542142','e0785eeefa1117f0e0d3219637c2f58493412dfa945986e3f63c21a86f20f45a'),
 'owner_package_admission.py':('d72c85dada60dee30e7fd53f17eac65ddff7f9dafffb508615ec02a0ae22f026','f5dfd7e08b726f0a5318e7f6edb9eb15bbd39052a398ad7125ea35eb39569417'),
}
UNCHANGED={
 LIB/'context_policy.py':'d961079b9791f53cf7ce0ac208180b0c9d9100ef46b48c025c2938d2eb69a806',
 LIB/'accepted-engineering-rules.md':'017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269',
 LIB/'stage.py':'ea79b894076c755f28d62619154b0681ecb636b7b32dd05c18a8c996112a1c2e',
 LIB/'receiver.py':'6405168b06f3902e40595528d30856c025a0311abfc31d70b59e969ed384af4e',
 LIB/'native_guard.py':'dd2e0a0c6c0dea0d353b7dc5f16c1a5d4c4c21f022947ceaa640470c59fb0762',
 LIB/'core.py':'3ed9ab5503694f39011102ff34935810ef1dce67cf712c87be89b023689a15a7',
 LIB/'content_identity.py':'e2df72bcf044149bd5f87a8a9f01a64ed8116a6db72d691a0e6e2b2036cf71af',
 LIB/'installer.py':'efed82cd43d26abe917c76091743feda5437445630aa9aecb65af3075c2a9d26',
 LIB/'monitor.py':'1b0cdd9895c24407294739b5092cf8ad06b8761e2672eaede15900d4fe859a6e',
 LIB/'monitor-mapping.json':'e0e2c9dda1a6f349568501a0f0ae4122270cda0b32687205cde3c095a9cd20e9',
 LIB/'monitor_extension.js':'3ebaf48e1d839ffe7aca8f8de7b2c062122bd442755201cb138dbeb673510ea3',
 Path('/usr/local/lib/gb-ops-monitor/opsmon/writer.py'):'286b75f27868c05b37a275ffc0250013ea9934b60040a54c80e39f7251bcc1d4',
 Path('/usr/local/lib/gb-ops-monitor/web/app.js'):'ede2a37b349b523816a37afefd5ea2a53c1969c7404e2aab41923a0ce51a8a2c',
}
# State hashes are observations, not permanent lib pins. dry prints changes
# from launcher observations; apply binds the complete current observation.
STATE_OBSERVED={POLICY:'52250df8b6391b46fe4b80f6805c27e89d06a1c493ca27002b187b1f1f7567d4',
 MARKER:'caba63e191e1192f51547b3fd54edc60c82be1da52cb22dd5f37882a3c80cec6',
 BUDGET:'8f6752295c2ee65924b5a95ddc42bb9774f8f73ce146481e52aaf200e142ed8d'}
REQUIRED_STATE=(STATE/'slot1.json',STATE/'slot2.json',
 STATE/'antigravity-29-owner-package-6404499964.json',
 STATE/'antigravity-29-addressed-ledger.json',STATE/'antigravity-29-stage3-supplement.json')
SCHEMA='GB_AGY29_PKG_FINISH_INSTALL_V1'
PROC_LOCKS=Path('/proc/locks')
R=None

def bytes_sha(raw):
    return hashlib.sha256(raw).hexdigest()


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


def regular_bytes(path, owner=None):
    """Walk every component without following links; reject racing/hardlinked files."""
    path = pathlib.Path(path)
    need(path.is_absolute() and '..' not in path.parts, 'noncanonical file path')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in path.parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd)
            fd = child
        child = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=fd)
        os.close(fd)
        fd = child
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and (owner is None or before.st_uid==owner)
             and not before.st_mode & 0o022 and before.st_size<=67108864, 'unsafe regular file')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            raw = stream.read(67108865)
        need(len(raw)<=67108864, 'file too large')
        need(stable(os.fstat(fd)) == stable(before), 'file changed during hash')
        current = path.lstat()
        need((current.st_dev, current.st_ino) == (before.st_dev, before.st_ino), 'file replaced during hash')
        return raw
    finally:
        os.close(fd)


def sha(path):
    return bytes_sha(regular_bytes(path))


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
            need(section not in (b'filter', b'alias', b'include', b'includeif', b'credential', b'protocol'),
                 'forbidden bundle git config section')
            continue
        match = re.fullmatch(rb'([a-zA-Z][a-zA-Z0-9-]*)[ \t]*(?:=[ \t]*(.*))?', line)
        need(section is not None and match is not None, 'unsafe bundle git config variable')
        key = match[1].lower()
        forbidden = (section == b'diff' and key in (b'textconv', b'command') or
                     section == b'url' and key == b'insteadof' or
                     section == b'core' and key in (b'fsmonitor', b'sshcommand', b'pager', b'editor'))
        if section == b'core' and key == b'hookspath':
            # Only explicit inert values; the command line also forces /dev/null.
            forbidden = match[2] not in (b'none', b'"none"', b'/dev/null', b'"/dev/null"')
        need(not forbidden, 'forbidden bundle git config key')


def lock_unheld(path):
    """Never flock or open a slot lock for writing, even temporarily."""
    try:
        before = path.lstat()
    except FileNotFoundError:
        # Missing locks are allowed by the precedent; the manifest records lease absence.
        need(not os.path.lexists(path), 'racing slot lock')
        return
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, 'unsafe slot lock')
    key = (os.major(before.st_dev), os.minor(before.st_dev), before.st_ino)
    for line in PROC_LOCKS.read_text().splitlines():
        fields = line.split()
        # Includes blocked records ("->") and conservatively rejects any lock type.
        for field in fields:
            if re.fullmatch(r'[0-9a-fA-F]+:[0-9a-fA-F]+:[0-9]+', field):
                major, minor, inode = field.split(':')
                need((int(major, 16), int(minor, 16), int(inode)) != key, 'slot lock inode held')
    need(path.lstat() == before, 'slot lock changed during observation')


def script_sane(path=None, uid=0):
    """The installer itself must be a root-owned regular file, mode exactly 0700, single link, in a root-owned non-writable directory."""
    path=Path(__file__).absolute() if path is None else path
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_uid == uid and info.st_gid == (0 if uid == 0 else info.st_gid)
         and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o700,
         'installer script must be a root-owned regular file, mode 0700, single link')
    parent = path.parent.lstat()
    need(stat.S_ISDIR(parent.st_mode) and parent.st_uid == uid and not stat.S_IMODE(parent.st_mode) & 0o022,
         'installer directory must be root-owned and not group/world writable')



def read_json(path):
    from core import loads
    return loads(regular_bytes(path))


def atomic_bytes(path, raw, mode, uid=0, gid=0):
    """Single-fs NOFOLLOW/O_EXCL temporary, pinned owner/mode, durable rename."""
    parent=directory_fd(path.parent)
    name='.'+path.name+'.agy29-install'
    fd=None;created=False
    try:
        fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode,dir_fd=parent)
        created=True
        os.fchown(fd,uid,gid);os.fchmod(fd,mode)
        with os.fdopen(fd,'wb') as out:
            fd=None;out.write(raw);out.flush();os.fsync(out.fileno())
        os.rename(name,path.name,src_dir_fd=parent,dst_dir_fd=parent);os.fsync(parent)
    finally:
        if fd is not None:os.close(fd)
        if created:
            try:os.unlink(name,dir_fd=parent);os.fsync(parent)
            except FileNotFoundError:pass
        os.close(parent)
    need(regular_bytes(path)==raw,'atomic write readback mismatch')


def write_json(path,value):
    atomic_bytes(path,json.dumps(value,sort_keys=True).encode(),0o600)


def source(bundle,commit):
    need(re.fullmatch('[a-f0-9]{40}',commit),'exact 40hex bundle commit required')
    need(bundle.is_absolute() and '..' not in bundle.parts, 'noncanonical bundle path')
    need(stat.S_ISDIR((bundle/'.git').lstat().st_mode),
         'bundle .git must be a real directory; gitfiles and symlinks refused')
    R.trusted_tree(bundle);R.trusted_tree(bundle/'.git')
    # Git can consume local config/hooks/objects before inspecting tracked bytes.
    # Match the reference's root-owned, no-link tree gate before any Git command.
    for path in bundle.rglob('*'):R.trusted_tree(path)
    for name in ('commondir', 'gitdir', 'objects/info/alternates', 'modules', 'info/attributes'):
        need(not os.path.lexists(bundle/'.git'/name), 'forbidden bundle .git/'+name)
    bundle_config(regular_bytes(bundle/'.git'/'config'))
    if os.path.lexists(bundle/'.git'/'config.worktree'):
        bundle_config(regular_bytes(bundle/'.git'/'config.worktree'))
    for path in bundle.rglob('*'):
        if path.name in ('.gitattributes', '.gitmodules'):
            need(not re.search(rb'(?i)(?:^|\s)filter\s*=', regular_bytes(path)),
                 'forbidden bundle filter attribute')
    need(git(bundle,'rev-parse','HEAD').decode().strip()==commit,'bundle HEAD differs from commit')
    need(git(bundle,'remote','get-url','origin').decode().strip() in
         ('https://github.com/anpavel84-afk/gobadminton-clean.git',
          'git@github.com:anpavel84-afk/gobadminton-clean.git'),'wrong bundle repository')
    need(not git(bundle,'status','--porcelain=v1','--untracked-files=all','--ignore-submodules=all'),'dirty bundle')
    need(len(git(bundle,'show','-s','--format=%P',commit).split())==2,'bundle commit must be a dev merge')
    git(bundle,'merge-base','--is-ancestor','bdd912a82a2f0087f4cfc9c6820edc8c49ee6527',commit)
    paths=['scripts/chatops/actions_train/'+name for name in TARGETS]
    paths+=['scripts/chatops/actions_train/manifest.json','.github/workflows/train-stage.yml']
    material={}
    for path in paths:
        R.trusted_tree(bundle/path)
        raw=regular_bytes(bundle/path)
        need(raw==git(bundle,'show',commit+':'+path),'bundle worktree/git bytes differ')
        material[path]=raw
    need(bytes_sha(material[paths[-2]])==MANIFEST,'bundle manifest drift')
    manifest=json.loads(material[paths[-2]])
    for name,(_,new) in TARGETS.items():
        key='scripts/chatops/actions_train/'+name
        need(bytes_sha(material[key])==new==manifest['files'].get(key),'target/manifest pin drift')
    workflow=material[paths[-1]]
    need(bytes_sha(workflow)==STAGE_SHA and ('ref: '+C).encode() in workflow,'workflow/controller pin drift')
    # All other manifest entries are deliberately ignored for installation.
    return {name:material['scripts/chatops/actions_train/'+name] for name in TARGETS}


def protected_state():
    """Full journals/ledgers/history and slot state; no symlinks or exclusions for paid evidence."""
    result={}
    for path in REQUIRED_STATE:sha(path)
    excluded={J,BK,INVENTORY,STATE/'controller.lock'}
    def walk(path):
        if path in excluded:return
        info=path.lstat()
        need(not stat.S_ISLNK(info.st_mode),'symlink in protected state')
        if stat.S_ISDIR(info.st_mode):
            fd=directory_fd(path)
            try:
                need(stable(os.fstat(fd))==stable(info),'state directory replaced')
                for name in sorted(os.listdir(fd)):walk(path/name)
                need(stable(path.lstat())==stable(info),'state directory changed')
            finally:os.close(fd)
        elif stat.S_ISREG(info.st_mode):
            # Slot lock metadata is checked separately; lock bytes are preserved.
            result[str(path)]=dict(sha256=sha(path),mode=stat.S_IMODE(info.st_mode),uid=info.st_uid,gid=info.st_gid)
        else:need(False,'nonregular protected state entry')
    for root in (STATE,AUTONOMY/'slots'/'slot1',AUTONOMY/'slots'/'slot2'):
        walk(root)
    for path in (*UNCHANGED,POLICY,MARKER,BUDGET):walk(path)
    for name in read_json(INVENTORY)['after']:
        path=Path(name)
        if path not in {LIB/target for target in TARGETS}:walk(path)
    for slot in ('slot1','slot2'):
        lease=AUTONOMY/'locks'/(slot+'.lease')
        if os.path.lexists(lease):walk(lease)
        else:result[str(lease)]=None
    return result


def idle():
    policy=read_json(POLICY)
    need(policy.get('mode')=='active' and policy.get('controller_sha')==C
         and policy.get('stage_workflow_sha256')==STAGE_SHA,'installed controller/workflow drift')
    for slot,uid in (('slot1',1002),('slot2',978)):
        journal=R.journal(slot);checkpoint,_=R.checkpoint(slot)
        active=checkpoint['active']
        need(journal['pending'] is None and (active is None or
             isinstance(active,dict) and active.get('phase')=='done'),'slot occupied')
        R.no_models(uid,slot)
        lock_unheld(AUTONOMY/'slots'/slot/'worker.lock')
        lock_unheld(AUTONOMY/'locks'/(slot+'.lease'))
    R.units_quiet(R.UNITS)
    # A masked dispatcher is required while policy bytes remain untouched.
    for unit in R.UNITS:
        props=dict(line.split('=',1) for line in run(['/usr/bin/systemctl','show',unit,
            '--property=ActiveState,MainPID,UnitFileState']).decode().splitlines() if '=' in line)
        need(props.get('ActiveState')=='inactive' and props.get('MainPID')=='0'
             and props.get('UnitFileState')=='masked','units must be inactive and masked')
    need(not os.path.lexists(STATE/'integration.json'),'integration in flight')


def inventory_after(before):
    need(before.get('manifest')==OLD_MANIFEST and len(before.get('after',{}))==32,
         'baseline inventory manifest/membership drift')
    after=copy.deepcopy(before)
    for name,(old,new) in TARGETS.items():
        need(before['after'].get(str(LIB/name))==old,'inventory baseline target drift')
        after['after'][str(LIB/name)]=new
    # Preserve manifest field: the full dev payload is deliberately NOT installed.
    need(set(after['after'])==set(before['after']),'inventory membership changed')
    return after


def observation():
    idle()
    for path,pin in UNCHANGED.items():need(sha(path)==pin,'unchanged lib pin drift: '+path.name)
    for name,(old,_) in TARGETS.items():need(sha(LIB/name)==old,'target baseline drift: '+name)
    inventory=read_json(INVENTORY);inventory_after(inventory)
    for path,pin in inventory['after'].items():
        need(sha(Path(path))==pin,'live inventory byte drift')
    need(read_json(MARKER).get('phase')=='canary','installed marker must be canary')
    return dict(protected=protected_state(),inventory_sha256=sha(INVENTORY),
        targets={name:dict(sha256=sha(LIB/name),mode=stat.S_IMODE((LIB/name).stat().st_mode),
                          uid=(LIB/name).stat().st_uid,gid=(LIB/name).stat().st_gid) for name in TARGETS})


SMOKE_CODE=r"""
import hashlib,json,pathlib,sys,types
sys.path.insert(0,sys.argv[1])
import context_policy as P, native_antigravity as N
import antigravity_qa_recovery as Q, owner_package_admission as A
assert P.RULES_SHA256=='017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269'
assert callable(A.accept) and callable(Q.analysis_operation)
# Synthetic immutable archived lookup using the installed trusted state reader;
# files are root-owned and readable to either smoke UID. No live state access.
import receiver as R
fixture=pathlib.Path(sys.argv[2])
r=types.SimpleNamespace(STATE=fixture,read=R.read)
assert Q.qualification_operation(r,{'operations':{}},'a'*64)=={'synthetic':True}
R.STATE=fixture
ledger=R.read(fixture/'ledger.json',0)
A.qa_ready({'operations':{}},ledger)
print('ARCHIVED_QA_READY_PASS')
print('AGY29_SMOKE_PASS')
"""


def smoke():
    tmp=Path(tempfile.mkdtemp(prefix='agy29-pkg-smoke-',dir='/var/tmp'))
    try:
        tmp.chmod(0o755)
        history=tmp/'history'/'slot2';history.mkdir(parents=True,mode=0o755)
        (tmp/'history').chmod(0o755)
        atomic_bytes(history/('a'*64+'.json'),b'{"synthetic":true}',0o644)
        # Construct an inert, exact-grant archived COMPLETE analysis fixture.
        # It is never installed as an admission or presented to the dispatcher.
        import context_policy as P
        import owner_package_admission as A
        import antigravity_qa_recovery as Q
        import native_antigravity as N
        grants={}
        for role,(revision,path,pin) in A.EXPECTED_PINS.items():
            g=dict(schema=Q.ADDRESSED_SCHEMA,lineage=Q.ADDRESSED_LINEAGE,owner_comment=6404499964,
                role=role,controller_revision=C,cli_sha256=N.AGY_SHA256,rules_sha256=P.RULES_SHA256,
                base=A.SOURCE_BASE,head=A.SOURCE_HEAD,input_revision=revision,input_path=path,input_sha256=pin,
                timeout=1800,max_output_bytes=N.MAX_OUT,permission_mode=N.PERMISSION_MODE,
                input_transport='stream-json',ceiling=1)
            grants[digest(g)]=dict(grant=g,operation=None)
        row=next(row for row in grants.values() if row['grant']['role']=='technical_pm_product_analyst')
        g=row['grant'];q=A.exact_qualification(g,C)
        binding=dict(action='train',stage='qa_qualification',profile='agy',slot='slot2',issue=29,
                     phase='idle',attempt=0,generation=98,head=g['head'])
        key=digest(binding);row['operation']=key
        op=dict(run=122,run_attempt=1,binding=binding,task_hash=q['task_sha256'],qa_qualification=q,finished_at=1,
            before=Q.CHECKPOINT,after=Q.CHECKPOINT,result=dict(status='confirmed',analysis_complete=True,
                analysis=dict(completion='COMPLETE',source_reads=[{},{}]),native_receipt=dict(
                    qualification_grant=g,qualification_task_sha256=q['task_sha256'],
                    tool_names=['view_file','run_command'])))
        ledger=dict(schema=Q.OWNER_PACKAGE_SCHEMA,owner_comment=6404499964,owner_id=318610566,
            issue=29,controller_sha=C,rules_sha256=P.RULES_SHA256,source_base=A.SOURCE_BASE,source_head=A.SOURCE_HEAD,
            body_sha256='f'*64,ceiling=2,used_calls=1,grants=grants,
            previous_addressed_sha256=Q.OWNER_PACKAGE_OLD_ADDRESS_SHA,
            previous_supplement_sha256=Q.OWNER_PACKAGE_OLD_SUPPLEMENT_SHA)
        atomic_bytes(history/(key+'.json'),json.dumps(op,sort_keys=True).encode(),0o644)
        atomic_bytes(tmp/'ledger.json',json.dumps(ledger,sort_keys=True).encode(),0o644)
        for uid in (1002,978):
            out=run(['/usr/bin/unshare','-n','/usr/bin/setpriv','--reuid',str(uid),
                '--regid',str(uid),'--clear-groups','--no-new-privs',
                '/usr/bin/env','-i','PATH=/usr/bin:/bin','HOME=/nonexistent','LANG=C.UTF-8',
                '/usr/bin/python3','-I','-B','-c',SMOKE_CODE,str(LIB),str(tmp)],timeout=60)
            need(b'AGY29_SMOKE_PASS' in out,'installed compatibility smoke failed')
    finally:shutil.rmtree(tmp)


@contextlib.contextmanager
def controller_lock():
    path=STATE/'controller.lock';R.trusted_tree(path)
    fd=os.open(path,os.O_RDWR|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        info=os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink==1,'unsafe controller lock')
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        need(path.lstat().st_ino==info.st_ino,'controller lock replaced')
        yield
    finally:os.close(fd)


def backup_paths():
    return {**{name:LIB/name for name in TARGETS},'inventory':INVENTORY,'policy':POLICY,'marker':MARKER}


def receipt_read(commit):
    receipt=read_json(J)
    need(receipt.get('schema')==SCHEMA and receipt.get('commit')==commit
         and receipt.get('manifest')==MANIFEST and receipt.get('phase') in
         ('backed_up','content_installed','active','rollback_failed','rolled_back'), 'foreign install transaction')
    need(digest(receipt['observation'])==receipt['observation_sha256'],'observation receipt drift')
    need(set(receipt['backups'])==set(backup_paths()),'backup membership drift')
    R.trusted_tree(BK);R.trusted_tree(J)
    for name,meta in receipt['backups'].items():
        R.trusted_tree(BK/name)
        need(sha(BK/name)==meta['sha256'] and type(meta['mode']) is int
             and 0<=meta['mode']<=0o777 and meta['uid']==0,'backup bytes/metadata drift')
        if name in TARGETS:need(meta['sha256']==TARGETS[name][0],'backup target baseline drift')
    need(receipt['backups']['inventory']['sha256']==receipt['observation']['inventory_sha256'],
         'backup inventory baseline drift')
    for name,path in (('policy',POLICY),('marker',MARKER)):
        need(receipt['backups'][name]['sha256']==receipt['observation']['protected'][str(path)]['sha256'],
             'backup protected baseline drift')
    return receipt


def assert_unchanged(receipt):
    need(protected_state()==receipt['observation']['protected'],'protected state changed')


def verify(receipt):
    need(receipt['phase']=='active','install is not active')
    idle();assert_unchanged(receipt)
    for name,(_,new) in TARGETS.items():
        meta=receipt['backups'][name];info=(LIB/name).stat()
        need(sha(LIB/name)==new and (stat.S_IMODE(info.st_mode),info.st_uid,info.st_gid)==
             (meta['mode'],meta['uid'],meta['gid']),'installed target bytes/metadata drift')
    meta=receipt['backups']['inventory'];info=INVENTORY.stat()
    need((stat.S_IMODE(info.st_mode),info.st_uid,info.st_gid)==(meta['mode'],meta['uid'],meta['gid']),
         'inventory metadata drift')
    need(regular_bytes(INVENTORY)==json.dumps(inventory_after(read_json(BK/'inventory')),sort_keys=True).encode(),
         'installed inventory drift')


def restore(receipt):
    idle();assert_unchanged(receipt)
    for name,pins in TARGETS.items():need(sha(LIB/name) in pins,'rollback target drift')
    old=regular_bytes(BK/'inventory')
    new=json.dumps(inventory_after(json.loads(old)),sort_keys=True).encode()
    need(regular_bytes(INVENTORY) in (old,new),'rollback inventory drift')
    for name,path in backup_paths().items():
        if name in ('policy','marker'):continue
        meta=receipt['backups'][name]
        atomic_bytes(path,regular_bytes(BK/name),meta['mode'],meta['uid'],meta['gid'])
        info=path.stat()
        need(sha(path)==meta['sha256'] and (stat.S_IMODE(info.st_mode),info.st_uid,info.st_gid)==
             (meta['mode'],meta['uid'],meta['gid']),'rollback bytes/metadata readback drift')
    assert_unchanged(receipt)
    receipt['phase']='rolled_back';write_json(J,receipt)


def apply(material,commit,expected_observation):
    need(not os.path.lexists(J) and not os.path.lexists(BK),'existing guarded transaction; verify/rollback first')
    observed=observation()
    need(digest(observed)==expected_observation,'dry observation changed; rerun dry')
    need(set(material)==set(TARGETS) and all(type(raw) is bytes and bytes_sha(raw)==TARGETS[name][1]
         for name,raw in material.items()),'exact three-target material required')
    BK.mkdir(mode=0o700)
    saved={}
    for name,path in backup_paths().items():
        raw=regular_bytes(path);info=path.stat()
        saved[name]=dict(sha256=bytes_sha(raw),mode=stat.S_IMODE(info.st_mode),uid=info.st_uid,gid=info.st_gid)
        atomic_bytes(BK/name,raw,0o600)
    need(observation()==observed,'backup-phase drift; no lib writes occurred')
    receipt=dict(schema=SCHEMA,phase='backed_up',commit=commit,manifest=MANIFEST,
        observation=observed,observation_sha256=expected_observation,backups=saved)
    write_json(J,receipt)
    try:
        assert_unchanged(receipt)
        for name,raw in material.items():
            need(sha(LIB/name)==TARGETS[name][0] and bytes_sha(raw)==TARGETS[name][1], 'pre-install drift')
            meta=saved[name];atomic_bytes(LIB/name,raw,meta['mode'],meta['uid'],meta['gid'])
        receipt['phase']='content_installed';write_json(J,receipt)
        smoke();idle();assert_unchanged(receipt)
        updated=inventory_after(read_json(BK/'inventory'))
        meta=saved['inventory']
        atomic_bytes(INVENTORY,json.dumps(updated,sort_keys=True).encode(),meta['mode'],meta['uid'],meta['gid'])
        receipt['phase']='active';write_json(J,receipt);verify(receipt)
    except BaseException:
        try:restore(receipt)
        except BaseException:
            receipt['phase']='rollback_failed';write_json(J,receipt)
        raise
    print('APPLY_PASS: only three lib targets and their inventory entries changed')
    print('/usr/bin/python3 -B /usr/local/lib/gb-actions-train/owner_package_admission.py --qa 6404499964')


def dry(material,commit):
    lock_unheld(STATE/'controller.lock')
    need(not os.path.lexists(J) and not os.path.lexists(BK),'existing guarded transaction')
    observed=observation()
    print(json.dumps(dict(status='DRY_PASS',commit=commit,observation_sha256=digest(observed),
        observation=observed,changes={name:dict(before=TARGETS[name][0],after=bytes_sha(raw))
                                    for name,raw in material.items()},
        launcher_state_drift={str(path):sha(path)!=pin for path,pin in STATE_OBSERVED.items()},
        writes=['three lib targets','three inventory after entries','BK','J'],
        manifest_field='preserved',policy_writes=0,model_calls=0),sort_keys=True))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('verb',nargs='?',default='dry',choices=('dry','apply','verify','rollback'))
    parser.add_argument('--bundle',type=Path,required=True)
    parser.add_argument('--commit',required=True)
    parser.add_argument('--observation-sha256')
    args=parser.parse_args()
    need(os.geteuid()==0,'root only');script_sane()
    # Validate root ownership of every import path before loading installed code.
    for path in [LIB,*LIB.glob('*.py')]:
        for parent in (path,*path.parents):
            info=parent.lstat()
            need(not stat.S_ISLNK(info.st_mode) and info.st_uid==0 and not info.st_mode & 0o022,
                 'untrusted installed import path')
    # Validate installed import sources before importing any installed code.
    for path,pin in UNCHANGED.items():need(sha(path)==pin,'installed trusted lib drift')
    global R
    sys.path.insert(0,str(LIB))
    import receiver
    R=receiver
    R.trusted_tree(Path(__file__).absolute())
    for path in (*[LIB/name for name in TARGETS],*UNCHANGED,STATE,INVENTORY,POLICY,MARKER,BUDGET,
                 STATE/'controller.lock'):
        R.trusted_tree(path)
    for name,pins in TARGETS.items():need(sha(LIB/name) in pins,'unrecognized installed target')
    need((R.STATE,R.POLICY,R.AUTONOMY,R.BUDGET)==(STATE,POLICY,AUTONOMY,BUDGET),'receiver path drift')
    need(re.fullmatch('[a-f0-9]{40}',args.commit),'exact 40hex commit required')
    material=source(args.bundle.absolute(),args.commit) if args.verb!='rollback' else None
    if args.verb=='dry':return dry(material,args.commit)
    if args.verb=='verify':
        lock_unheld(STATE/'controller.lock');verify(receipt_read(args.commit));print('VERIFY_PASS');return
    with controller_lock():
        if args.verb=='apply':
            need(type(args.observation_sha256) is str and re.fullmatch('[a-f0-9]{64}',args.observation_sha256),
                 'apply requires --observation-sha256 from dry')
            apply(material,args.commit,args.observation_sha256)
        else:
            receipt=receipt_read(args.commit)
            need(receipt['phase']!='rolled_back','already rolled back; no writes')
            restore(receipt);print('ROLLBACK_PASS')


if __name__=='__main__':
    try:main()
    except BaseException as error:
        print('AGY29_INSTALL_REFUSED: '+(str(error) if isinstance(error,Refused) else type(error).__name__),file=sys.stderr)
        sys.exit(1)

#!/usr/bin/python3
"""AGY #29 inventory re-record: one reviewed, hash-gated write of ONE backup.json value.

The C5 installer (#294) installed the EOM 1.4 rules (017441de...) but left the
`after` entry of accepted-engineering-rules.md at EOM 1.3 (38c34012...). This
installer re-records exactly that entry through a verified write, after which
the stale-inventory exception in other installers is no longer needed.

It writes only STATE/backup.json (a single 64-hex value replaced byte-exactly),
plus its own receipt and backup. No lib, policy, rules, marker, budget or slot
file is touched. Verbs: dry, apply, verify, rollback.
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

LIB=Path('/usr/local/lib/gb-actions-train')
STATE=Path('/var/lib/gobadminton-actions-train')
AUTONOMY=Path('/var/lib/gobadminton-autonomy')
POLICY=Path('/etc/gobadminton-actions-train/policy.json')
MARKER=Path('/etc/gobadminton-slots/antigravity-qa.json')
BUDGET=Path('/etc/gobadminton-slots/budgets.json')
INVENTORY=STATE/'backup.json'
J=STATE/'agy29-inventory-rerecord.json'
BK=STATE/'agy29-inventory-rerecord-backup'
PKG_J=STATE/'agy29-pkg-finish-install.json'          # the package-finish installer's transaction files:
PKG_BK=STATE/'agy29-pkg-finish-backup'               # a later, separately guarded layer (see the runbook)
SCHEMA='GB_AGY29_INVENTORY_RERECORD_V1'
C='41e12be2d551158e97ea30eaf8e95f992f998615'
STAGE_SHA='b9703ca27b7bb3f494f379f8e259e62a6a48bc8f5ff50c6923e1712d8899d68d'
OLD_MANIFEST='0f16f0d60e05d13fa1778f5e9220341b4f62149ddc3e99ced10235344cf21944'
INVENTORY_ENTRIES=32
OWNER_UID=0  # the inventory and its backup are root-owned; tests substitute their own identity
SCRIPT_REPO_PATH='scripts/chatops/ops/agy29_inventory_rerecord.py'
RULES_NAME='accepted-engineering-rules.md'
RULES_INVENTORY_SHA='38c34012f10974496a7d7cbc74ecacb62bf7847278e295edfeb107d69a5d1c1c'  # EOM 1.3 (recorded, stale)
RULES_LIVE_SHA='017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269'  # EOM 1.4 (installed by C5)
C5_RECEIPT_NAME='agy29-nopolicy294-scoped-install.json'
C5_BACKUP_NAME='agy29-nopolicy294-scoped-backup'
C5_RECEIPT_SHA='04106cc1a6a2afa0bd840244b270947b129b661cca77834eed7f1fe1e008a704'
C5_SCHEMA='GB_AGY29_NOPOLICY294_INSTALL_V1'
STATE_FILE_LIMIT=1073741824  # protected-state evidence may hold large paid artifacts; bundle/lib/pinned reads keep 64 MiB
PROC_LOCKS=Path('/proc/locks')
# Installed trusted import sources. Lib targets of other installers are deliberately
# NOT pinned here: they may be pre- or post-AGY29-install; their live bytes are bound
# by the observation digest and must equal their recorded inventory value.
UNCHANGED={
 LIB/'context_policy.py':'d961079b9791f53cf7ce0ac208180b0c9d9100ef46b48c025c2938d2eb69a806',
 LIB/RULES_NAME:RULES_LIVE_SHA,
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
R=None


def need(ok, message):
    if not ok: raise Refused(message)


def digest(value):
    return bytes_sha(json.dumps(value,sort_keys=True,separators=(',',':')).encode())


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


def state_sha(path, limit=STATE_FILE_LIMIT):
    """Streamed digest of a protected-state regular file with the same no-link/no-race checks as regular_bytes."""
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
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and not before.st_mode & 0o022
             and before.st_size<=limit, 'unsafe regular file')
        digest_=hashlib.sha256();seen=0
        with os.fdopen(os.dup(fd), 'rb') as stream:
            while True:
                chunk=stream.read(1048576)
                if not chunk:break
                seen+=len(chunk);need(seen<=limit,'file too large')
                digest_.update(chunk)
        need(stable(os.fstat(fd)) == stable(before) and seen==before.st_size, 'file changed during hash')
        current = path.lstat()
        need((current.st_dev, current.st_ino) == (before.st_dev, before.st_ino), 'file replaced during hash')
        return digest_.hexdigest()
    finally:
        os.close(fd)


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
    name='.'+path.name+'.agy29-rerecord'
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


def rules_provenance():
    """Hash-bound proof that EOM 1.3 -> EOM 1.4 was installed by the active C5 receipt.

    Read-only. Returns a small dict that is part of the observation digest, so apply
    refuses if any of it changes between dry and apply.
    """
    try:raw=regular_bytes(STATE/C5_RECEIPT_NAME)
    except OSError:raise Refused('C5 receipt unreadable')
    need(bytes_sha(raw)==C5_RECEIPT_SHA,'C5 receipt bytes drift')
    from core import loads
    receipt=loads(raw)
    need(receipt.get('schema')==C5_SCHEMA and receipt.get('phase')=='active'
         and receipt.get('controller_sha')==C and receipt.get('manifest_sha256')==OLD_MANIFEST
         and receipt.get('rules_sha256')==RULES_LIVE_SHA
         and isinstance(receipt.get('backups'),dict)
         and isinstance(receipt['backups'].get('rules'),dict)
         and receipt['backups']['rules'].get('sha256')==RULES_INVENTORY_SHA,'C5 receipt chain mismatch')
    try:backup=regular_bytes(STATE/C5_BACKUP_NAME/'rules')
    except OSError:raise Refused('C5 rules backup unreadable')
    need(bytes_sha(backup)==RULES_INVENTORY_SHA,'C5 rules backup drift')
    need(sha(LIB/RULES_NAME)==RULES_LIVE_SHA and UNCHANGED.get(LIB/RULES_NAME,RULES_LIVE_SHA)==RULES_LIVE_SHA,
         'live rules are not the C5-installed EOM 1.4')
    return dict(c5_receipt_sha256=C5_RECEIPT_SHA,rules_backup_sha256=RULES_INVENTORY_SHA,
                rules_live_sha256=RULES_LIVE_SHA)


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


def source(bundle,commit):
    """The running installer must equal the blob of the exact reviewed dev merge commit in a verified plain checkout."""
    need(re.fullmatch('[a-f0-9]{40}',commit),'exact 40hex bundle commit required')
    need(bundle.is_absolute() and '..' not in bundle.parts, 'noncanonical bundle path')
    need(stat.S_ISDIR((bundle/'.git').lstat().st_mode),
         'bundle .git must be a real directory; gitfiles and symlinks refused')
    R.trusted_tree(bundle);R.trusted_tree(bundle/'.git')
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
    R.trusted_tree(bundle/SCRIPT_REPO_PATH)
    raw=regular_bytes(bundle/SCRIPT_REPO_PATH)
    need(raw==git(bundle,'show',commit+':'+SCRIPT_REPO_PATH),'bundle worktree/git bytes differ')
    need(raw==regular_bytes(Path(__file__).absolute()),'running installer differs from the bundle commit')
    return bytes_sha(raw)


def protected_state():
    """Full journals/ledgers/history and slot state; no symlinks or exclusions for paid evidence."""
    result={}
    for path in REQUIRED_STATE:sha(path)
    excluded={J,BK,PKG_J,PKG_BK,INVENTORY,STATE/'controller.lock'}
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
            result[str(path)]=dict(sha256=state_sha(path),mode=stat.S_IMODE(info.st_mode),uid=info.st_uid,gid=info.st_gid)
        else:need(False,'nonregular protected state entry')
    for root in (STATE,AUTONOMY/'slots'/'slot1',AUTONOMY/'slots'/'slot2'):
        walk(root)
    for path in (*UNCHANGED,POLICY,MARKER,BUDGET):walk(path)
    for name in recorded_inventory(regular_bytes(INVENTORY))['after']:walk(Path(name))
    for slot in ('slot1','slot2'):
        lease=AUTONOMY/'locks'/(slot+'.lease')
        if os.path.lexists(lease):walk(lease)
        else:result[str(lease)]=None
    return result


REQUIRED_STATE=(STATE/'slot1.json',STATE/'slot2.json',
 STATE/'antigravity-29-owner-package-6404499964.json',
 STATE/'antigravity-29-addressed-ledger.json',STATE/'antigravity-29-stage3-supplement.json')


def rules_key():
    return str(LIB/RULES_NAME)


def recorded_inventory(raw):
    """Parse and structurally gate the inventory bytes; returns the parsed dict."""
    from core import loads
    inventory=loads(raw)
    need(isinstance(inventory,dict) and inventory.get('manifest')==OLD_MANIFEST
         and isinstance(inventory.get('after'),dict) and len(inventory['after'])==INVENTORY_ENTRIES,
         'inventory manifest/membership drift')
    need(rules_key() in inventory['after'],'inventory has no rules entry')
    return inventory


def rerecorded_bytes(raw):
    """The single byte-exact edit: the one recorded stale rules hash becomes the installed hash."""
    inventory=recorded_inventory(raw)
    need(inventory['after'][rules_key()]==RULES_INVENTORY_SHA,'rules entry is not the stale EOM 1.3 value')
    need(raw.count(RULES_INVENTORY_SHA.encode())==1 and raw.count(RULES_LIVE_SHA.encode())==0,
         'stale value is not unique in the inventory bytes')
    new=raw.replace(RULES_INVENTORY_SHA.encode(),RULES_LIVE_SHA.encode())
    expected=copy.deepcopy(inventory);expected['after'][rules_key()]=RULES_LIVE_SHA
    from core import loads
    need(loads(new)==expected and len(new)==len(raw),'re-recorded inventory is not the single-entry edit')
    return new


def observation():
    idle()
    need(not os.path.lexists(PKG_J) and not os.path.lexists(PKG_BK),
         'package-finish transaction files exist; the re-record must be applied before the package-finish install')
    for path,pin in UNCHANGED.items():need(sha(path)==pin,'unchanged lib pin drift: '+path.name)
    raw=regular_bytes(INVENTORY)
    inventory=recorded_inventory(raw);rerecorded_bytes(raw)
    for path,pin in inventory['after'].items():
        if path==rules_key():continue
        need(sha(Path(path))==pin,'live inventory byte drift')
    provenance=rules_provenance()
    return dict(protected=protected_state(),inventory_sha256=bytes_sha(raw),rules_provenance=provenance,
        change=dict(path=rules_key(),before=RULES_INVENTORY_SHA,after=RULES_LIVE_SHA))


def inventory_meta():
    info=INVENTORY.stat()
    return dict(sha256=sha(INVENTORY),mode=stat.S_IMODE(info.st_mode),uid=info.st_uid,gid=info.st_gid)


def receipt_read(commit):
    receipt=read_json(J)
    need(receipt.get('schema')==SCHEMA and receipt.get('commit')==commit
         and receipt.get('phase') in ('backed_up','active','rollback_failed','rolled_back'),'foreign rerecord transaction')
    need(digest(receipt['observation'])==receipt['observation_sha256'],'observation receipt drift')
    need(set(receipt['backups'])=={'inventory'},'backup membership drift')
    R.trusted_tree(BK);R.trusted_tree(J);R.trusted_tree(BK/'inventory')
    meta=receipt['backups']['inventory']
    need(sha(BK/'inventory')==meta['sha256']==receipt['observation']['inventory_sha256']
         and type(meta['mode']) is int and 0<=meta['mode']<=0o777 and meta['uid']==OWNER_UID,'backup bytes/metadata drift')
    need(receipt.get('script_sha256')==bytes_sha(regular_bytes(Path(__file__).absolute())),'installer differs from the receipt')
    return receipt


def assert_unchanged(receipt):
    need(protected_state()==receipt['observation']['protected'],'protected state changed')


def verify(receipt):
    need(receipt['phase']=='active','rerecord is not active')
    idle();assert_unchanged(receipt)
    old=regular_bytes(BK/'inventory');new=rerecorded_bytes(old)
    need(regular_bytes(INVENTORY)==new,'installed inventory drift')
    meta=receipt['backups']['inventory'];info=INVENTORY.stat()
    need((stat.S_IMODE(info.st_mode),info.st_uid,info.st_gid)==(meta['mode'],meta['uid'],meta['gid']),'inventory metadata drift')
    inventory=json.loads(new)
    for path,pin in inventory['after'].items():need(sha(Path(path))==pin,'live inventory byte drift after rerecord')
    need(inventory['after'][rules_key()]==RULES_LIVE_SHA==sha(LIB/RULES_NAME),'rules entry not re-recorded')


def restore(receipt):
    idle();assert_unchanged(receipt)
    old=regular_bytes(BK/'inventory');new=rerecorded_bytes(old)
    need(regular_bytes(INVENTORY) in (old,new),'rollback inventory drift')
    meta=receipt['backups']['inventory']
    atomic_bytes(INVENTORY,old,meta['mode'],meta['uid'],meta['gid'])
    info=INVENTORY.stat()
    need(sha(INVENTORY)==meta['sha256'] and (stat.S_IMODE(info.st_mode),info.st_uid,info.st_gid)==
         (meta['mode'],meta['uid'],meta['gid']),'rollback bytes/metadata readback drift')
    assert_unchanged(receipt)
    receipt['phase']='rolled_back';write_json(J,receipt)


def apply(script_sha,commit,expected_observation):
    if os.path.lexists(J) or os.path.lexists(BK):
        # Idempotent: an already-active identical transaction is a verified no-op.
        receipt=receipt_read(commit)
        need(receipt['phase']=='active','existing guarded transaction; verify/rollback first')
        verify(receipt);print('APPLY_NOOP: already active and verified');return
    observed=observation()
    need(digest(observed)==expected_observation,'dry observation changed; rerun dry')
    BK.mkdir(mode=0o700)
    try:
        raw=regular_bytes(INVENTORY);saved=inventory_meta()
        atomic_bytes(BK/'inventory',raw,0o600)
        need(observation()==observed,'backup-phase drift; no inventory write occurred')
        receipt=dict(schema=SCHEMA,phase='backed_up',commit=commit,script_sha256=script_sha,
            observation=observed,observation_sha256=expected_observation,backups=dict(inventory=saved),
            new_sha256=bytes_sha(rerecorded_bytes(raw)))
        write_json(J,receipt)
    except BaseException:
        # Nothing but our own fresh backup directory exists yet; the inventory was never written.
        if not os.path.lexists(J):shutil.rmtree(BK,ignore_errors=True)
        raise
    try:
        assert_unchanged(receipt)
        need(regular_bytes(INVENTORY)==raw,'pre-write inventory drift')
        atomic_bytes(INVENTORY,rerecorded_bytes(raw),saved['mode'],saved['uid'],saved['gid'])
        receipt['phase']='active';write_json(J,receipt);verify(receipt)
    except BaseException:
        try:restore(receipt)
        except BaseException:
            receipt['phase']='rollback_failed';write_json(J,receipt)
        raise
    print('APPLY_PASS: only the accepted-engineering-rules.md entry of backup.json changed')


def dry(script_sha,commit):
    lock_unheld(STATE/'controller.lock')
    need(not os.path.lexists(J) and not os.path.lexists(BK),'existing guarded transaction')
    observed=observation()
    print(json.dumps(dict(status='DRY_PASS',commit=commit,script_sha256=script_sha,
        observation_sha256=digest(observed),observation=observed,change=observed['change'],
        writes=['backup.json (one value, byte-exact)','BK','J'],policy_writes=0,lib_writes=0,model_calls=0),sort_keys=True))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('verb',nargs='?',default='dry',choices=('dry','apply','verify','rollback'))
    parser.add_argument('--bundle',type=Path,required=True)
    parser.add_argument('--commit',required=True)
    parser.add_argument('--observation-sha256')
    args=parser.parse_args()
    need(os.geteuid()==0,'root only');script_sane()
    for path in [LIB,*LIB.glob('*.py')]:
        for parent in (path,*path.parents):
            info=parent.lstat()
            need(not stat.S_ISLNK(info.st_mode) and info.st_uid==0 and not info.st_mode & 0o022,
                 'untrusted installed import path')
    for path,pin in UNCHANGED.items():need(sha(path)==pin,'installed trusted lib drift')
    global R
    sys.path.insert(0,str(LIB))
    import receiver
    R=receiver
    R.trusted_tree(Path(__file__).absolute())
    for path in (*UNCHANGED,STATE,INVENTORY,POLICY,MARKER,BUDGET,STATE/'controller.lock'):
        R.trusted_tree(path)
    need((R.STATE,R.POLICY,R.AUTONOMY,R.BUDGET)==(STATE,POLICY,AUTONOMY,BUDGET),'receiver path drift')
    need(re.fullmatch('[a-f0-9]{40}',args.commit),'exact 40hex commit required')
    script_sha=source(args.bundle.absolute(),args.commit)
    if args.verb=='dry':return dry(script_sha,args.commit)
    if args.verb=='verify':
        lock_unheld(STATE/'controller.lock');verify(receipt_read(args.commit));print('VERIFY_PASS');return
    with controller_lock():
        if args.verb=='apply':
            need(type(args.observation_sha256) is str and re.fullmatch('[a-f0-9]{64}',args.observation_sha256),
                 'apply requires --observation-sha256 from dry')
            apply(script_sha,args.commit,args.observation_sha256)
        else:
            receipt=receipt_read(args.commit)
            need(receipt['phase']!='rolled_back','already rolled back; no writes')
            restore(receipt);print('ROLLBACK_PASS')


if __name__=='__main__':
    try:main()
    except BaseException as error:
        print('AGY29_RERECORD_REFUSED: '+(str(error) if isinstance(error,Refused) else type(error).__name__),file=sys.stderr)
        sys.exit(1)

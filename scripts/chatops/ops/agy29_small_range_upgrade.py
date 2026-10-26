#!/usr/bin/python3
"""AGY #29 two-file small-range upgrade, with byte-exact inventory edits.

Root-run reviewed OPS source: dry, apply, verify, rollback. Only the installed
antigravity_qa_recovery.py, owner_package_admission.py and their two backup.json
after values may change,
plus this layer's receipt and backups. No policy, rules, marker, budget, slot,
ledger, admission or model effects. All three lower layers remain immutable.
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
sys.dont_write_bytecode = True

class Refused(Exception): pass

LIB=Path('/usr/local/lib/gb-actions-train')
STATE=Path('/var/lib/gobadminton-actions-train')
AUTONOMY=Path('/var/lib/gobadminton-autonomy')
POLICY=Path('/etc/gobadminton-actions-train/policy.json')
MARKER=Path('/etc/gobadminton-slots/antigravity-qa.json')
BUDGET=Path('/etc/gobadminton-slots/budgets.json')
INVENTORY=STATE/'backup.json'
J=STATE/'agy29-small-range-upgrade.json'
BK=STATE/'agy29-small-range-upgrade-backup'
SCHEMA='GB_AGY29_SMALL_RANGE_UPGRADE_V1'
C='41e12be2d551158e97ea30eaf8e95f992f998615'
STAGE_SHA='b9703ca27b7bb3f494f379f8e259e62a6a48bc8f5ff50c6923e1712d8899d68d'
OLD_MANIFEST='0f16f0d60e05d13fa1778f5e9220341b4f62149ddc3e99ced10235344cf21944'
INVENTORY_ENTRIES=32
OWNER_UID=0  # tests substitute fixture identity only
OWNER_GID=0
SCRIPT_REPO_PATH='scripts/chatops/ops/agy29_small_range_upgrade.py'
RULES_NAME='accepted-engineering-rules.md'
RULES_INVENTORY_SHA='38c34012f10974496a7d7cbc74ecacb62bf7847278e295edfeb107d69a5d1c1c'  # EOM 1.3 (recorded, stale)
RULES_LIVE_SHA='017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269'  # EOM 1.4 (installed by C5)
C5_RECEIPT_NAME='agy29-nopolicy294-scoped-install.json'
C5_BACKUP_NAME='agy29-nopolicy294-scoped-backup'
C5_RECEIPT_SHA='04106cc1a6a2afa0bd840244b270947b129b661cca77834eed7f1fe1e008a704'
C5_SCHEMA='GB_AGY29_NOPOLICY294_INSTALL_V1'
STATE_FILE_LIMIT=1073741824  # protected-state evidence may hold large paid artifacts; bundle/lib/pinned reads keep 64 MiB
PROC_LOCKS=Path('/proc/locks')
# Installed trusted import sources remain pinned; only TARGETS may be replaced.
ADMISSION_NAME='agy29-admission-upgrade.json'
ADMISSION_BACKUP='agy29-admission-upgrade-backup'
ADMISSION_SHA='963575dd50a34137bf52999f73a2aa73c7b85aa36813e582af360ae9d66e54b6'
ADMISSION_SCHEMA='GB_AGY29_ADMISSION_UPGRADE_V1'
ADMISSION_COMMIT='aa9ece4d74d3e984ce75e59457304117a1438ff6'
ADMISSION_SCRIPT_SHA='67a43953b86c5955739a2336ab4aa904f39437705f67065dfc672247a8ce9df9'
ADMISSION_MANIFEST='be349608b39d33cad2af86069eccf09c8fb170a2daac3a472ade573c8e613742'
ADMISSION_MODULE='owner_package_admission.py'
ADMISSION_OLD='f5dfd7e08b726f0a5318e7f6edb9eb15bbd39052a398ad7125ea35eb39569417'
TARGETS={
 'antigravity_qa_recovery.py':('e0785eeefa1117f0e0d3219637c2f58493412dfa945986e3f63c21a86f20f45a','93efc05c7aa46fc7ff0d6da70f0db01a9ebda434dbc7d99066590e0459a92a2e'),
 'owner_package_admission.py':('4adbed703b420ab435a3d1d545c2c076a7bd5574bdf940143f8cf8447a9c74ae','bb5bf8516d26ae293f16d794c2e46f90b01d0c27b34da15febbd0bff4398c7c5'),
}
MANIFEST='3b39bb7fb810e97e4d6163dfc93356260d2a966ecbc66b4410c8b06deab0e150'
RERECORD_NAME='agy29-inventory-rerecord.json'
RERECORD_BACKUP='agy29-inventory-rerecord-backup'
RERECORD_SHA='eddb548a46d4f3fd2ab22683cf207c77fecfdcc937b5298e939a1c2f4df6bfed'
RERECORD_SCHEMA='GB_AGY29_INVENTORY_RERECORD_V1'
RERECORD_COMMIT='e6af59ea2bc6922ed12585b128d9e14b263e9f20'
RERECORD_NEW_SHA='4a7d4c07f2c8a856f60d3797f39fdbf5905f08838f457ae711044726ae859981'
RERECORD_SCRIPT_SHA='6de969a9070384c7a45deb605771e93a969fbc82f7d11d829d9603d31ce50712'
PKG_NAME='agy29-pkg-finish-install.json'
PKG_BACKUP='agy29-pkg-finish-backup'
PKG_SHA='690e49a05f6127558c8e0ef8c2c69abbfcf7df7043f95f320fbae3518fb127da'
PKG_SCHEMA='GB_AGY29_PKG_FINISH_INSTALL_V1'
PKG_COMMIT='f948d367292e85fc422dba2f8a3f6efd44400777'
PKG_MANIFEST='b2c4dd72a1844e972d007a9034cc89f5c120cf8f934c7fdfef9fae1efe275ed5'
PKG_OBSERVATION='2b06fd3f53386a63bd0e4114a80c6c54943938eb7151c5d5d54ea33b370f691a'
PKG_TARGETS={
 'native_antigravity.py':('99e70d960b1db2567c32dea10a7341487b3aeb511a1aa5a51b85be86cded2d42','01d4816e881765da6361af07a15765528aef274dad0eb780b1afab6b0e5e0f72'),
 'antigravity_qa_recovery.py':('e89e1154128e2ae9ea5536c0345c4a231368a1fe316daf0a444a36c2e2542142','e0785eeefa1117f0e0d3219637c2f58493412dfa945986e3f63c21a86f20f45a'),
 ADMISSION_MODULE:('d72c85dada60dee30e7fd53f17eac65ddff7f9dafffb508615ec02a0ae22f026',ADMISSION_OLD),
}
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
UNCHANGED.update({LIB/name:new for name,(_,new) in PKG_TARGETS.items()})
# Full final lib table; changing entries use stage-specific old/new gates below.
UNCHANGED.update({LIB/name:new for name,(_,new) in TARGETS.items()})
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
    name='.'+path.name+'.agy29-small-range-upgrade'
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
    git(bundle,'merge-base','--is-ancestor',ADMISSION_COMMIT,commit)
    R.trusted_tree(bundle/SCRIPT_REPO_PATH)
    raw=regular_bytes(bundle/SCRIPT_REPO_PATH)
    need(raw==git(bundle,'show',commit+':'+SCRIPT_REPO_PATH),'bundle worktree/git bytes differ')
    need(raw==regular_bytes(Path(__file__).absolute()),'running installer differs from the bundle commit')
    script_sha=bytes_sha(raw)
    paths=['scripts/chatops/actions_train/'+name for name in TARGETS]
    paths+=['scripts/chatops/actions_train/manifest.json','.github/workflows/train-stage.yml']
    material={}
    for path in paths:
        R.trusted_tree(bundle/path)
        raw=regular_bytes(bundle/path)
        need(raw==git(bundle,'show',commit+':'+path),'bundle worktree/git bytes differ')
        material[path]=raw
    need(bytes_sha(material[paths[-2]])==MANIFEST,'bundle manifest drift')
    from core import loads
    manifest=loads(material[paths[-2]])
    need(isinstance(manifest,dict) and isinstance(manifest.get('files'),dict),'bundle manifest drift')
    for name,(_,new) in TARGETS.items():
        key='scripts/chatops/actions_train/'+name
        need(manifest['files'].get(key)==new==bytes_sha(material[key]),'bundle manifest drift')
    workflow=material[paths[-1]]
    need(bytes_sha(workflow)==STAGE_SHA and ('ref: '+C).encode() in workflow,'workflow/controller pin drift')
    # All other manifest entries are ignored for installation.
    return script_sha,{name:material['scripts/chatops/actions_train/'+name] for name in TARGETS}


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
            result[str(path)]=dict(sha256=state_sha(path),mode=stat.S_IMODE(info.st_mode),uid=info.st_uid,gid=info.st_gid)
        else:need(False,'nonregular protected state entry')
    for root in (STATE,AUTONOMY/'slots'/'slot1',AUTONOMY/'slots'/'slot2'):
        walk(root)
    for path in (*UNCHANGED,POLICY,MARKER,BUDGET):
        if path not in {LIB/name for name in TARGETS}:walk(path)
    for name in read_json(INVENTORY)['after']:
        if name not in {str(LIB/target) for target in TARGETS}:walk(Path(name))
    for slot in ('slot1','slot2'):
        lease=AUTONOMY/'locks'/(slot+'.lease')
        if os.path.lexists(lease):walk(lease)
        else:result[str(lease)]=None
    return result


REQUIRED_STATE=(STATE/'slot1.json',STATE/'slot2.json',
 STATE/'antigravity-29-owner-package-6404499964.json',
 STATE/'antigravity-29-addressed-ledger.json',STATE/'antigravity-29-stage3-supplement.json')


def recorded_inventory(raw):
    from core import loads
    inventory=loads(raw)
    need(isinstance(inventory,dict) and inventory.get('manifest')==OLD_MANIFEST
         and isinstance(inventory.get('after'),dict) and len(inventory['after'])==INVENTORY_ENTRIES,
         'inventory manifest/membership drift')
    need(inventory['after'].get(str(LIB/RULES_NAME))==RULES_LIVE_SHA,'inventory rules entry drift')
    for name,(_,pin) in PKG_TARGETS.items():
        need(inventory['after'].get(str(LIB/name))==(TARGETS[name][0] if name in TARGETS else pin),
             'inventory baseline target drift: '+name)
    return inventory


def upgraded_bytes(raw):
    """Two unique 64-hex values replaced; every other byte/field is preserved."""
    inventory=recorded_inventory(raw)
    new=raw;expected=copy.deepcopy(inventory)
    for name,(old,pin) in TARGETS.items():
        need(raw.count(old.encode())==1 and raw.count(pin.encode())==0,
             'stale value is not unique in the inventory bytes')
        new=new.replace(old.encode(),pin.encode())
        expected['after'][str(LIB/name)]=pin
    from core import loads
    need(loads(new)==expected and len(new)==len(raw),'upgraded inventory is not the two-entry edit')
    return new


def pinned_receipt(name,pin):
    try:
        R.trusted_tree(STATE/name)
        raw=regular_bytes(STATE/name)
    except OSError:raise Refused('lower receipt unreadable: '+name)
    need(bytes_sha(raw)==pin,'lower receipt bytes drift: '+name)
    from core import loads
    receipt=loads(raw)
    need(isinstance(receipt,dict),'lower receipt shape drift')
    return receipt


def checked_backups(directory,backups):
    need(isinstance(backups,dict),'lower backup membership drift')
    R.trusted_tree(STATE/directory)
    need(stat.S_ISDIR((STATE/directory).lstat().st_mode),'lower backup directory drift')
    need(set(os.listdir(STATE/directory))==set(backups),'lower backup membership drift')
    for name,meta in backups.items():
        need(isinstance(name,str) and Path(name).name==name and name not in ('.','..')
             and isinstance(meta,dict),'lower backup shape drift')
        path=STATE/directory/name
        R.trusted_tree(path)
        need(sha(path)==meta.get('sha256'),'lower backup bytes drift: '+name)


def lower_stack():
    """Immutable active re-record -> pkg-finish -> admission receipts and backups.

    Returns the byte-bound post-#326 inventory. No stale-rules exception.
    """
    provenance=rules_provenance()
    rr=pinned_receipt(RERECORD_NAME,RERECORD_SHA)
    need(rr.get('schema')==RERECORD_SCHEMA and rr.get('phase')=='active'
         and rr.get('commit')==RERECORD_COMMIT and rr.get('new_sha256')==RERECORD_NEW_SHA
         and rr.get('script_sha256')==RERECORD_SCRIPT_SHA
         and isinstance(rr.get('backups'),dict) and set(rr['backups'])=={'inventory'},
         're-record receipt chain mismatch')
    checked_backups(RERECORD_BACKUP,rr['backups'])
    pkg=pinned_receipt(PKG_NAME,PKG_SHA)
    need(pkg.get('schema')==PKG_SCHEMA and pkg.get('phase')=='active'
         and pkg.get('commit')==PKG_COMMIT and pkg.get('manifest')==PKG_MANIFEST
         and pkg.get('observation_sha256')==PKG_OBSERVATION
         and isinstance(pkg.get('backups'),dict)
         and set(pkg['backups'])=={*PKG_TARGETS,'inventory','marker','policy'},
         'pkg-finish receipt chain mismatch')
    for name,(old,_) in PKG_TARGETS.items():
        need(isinstance(pkg['backups'][name],dict) and pkg['backups'][name].get('sha256')==old,
             'pkg-finish backup target chain mismatch')
    need(isinstance(pkg['backups']['inventory'],dict)
         and pkg['backups']['inventory'].get('sha256')==rr['new_sha256'],
         'pkg-finish inventory backup chain mismatch')
    checked_backups(PKG_BACKUP,pkg['backups'])
    before=read_json(STATE/PKG_BACKUP/'inventory')
    need(isinstance(before,dict) and before.get('manifest')==OLD_MANIFEST
         and isinstance(before.get('after'),dict) and len(before['after'])==INVENTORY_ENTRIES,
         'pkg-finish backup inventory shape drift')
    expected=copy.deepcopy(before)
    for name,(old,new) in PKG_TARGETS.items():
        need(before['after'].get(str(LIB/name))==old,'pkg-finish backup inventory target drift')
        expected['after'][str(LIB/name)]=new
    admission=pinned_receipt(ADMISSION_NAME,ADMISSION_SHA)
    need(admission.get('schema')==ADMISSION_SCHEMA and admission.get('phase')=='active'
         and admission.get('commit')==ADMISSION_COMMIT and admission.get('manifest')==ADMISSION_MANIFEST
         and admission.get('script_sha256')==ADMISSION_SCRIPT_SHA
         and admission.get('new_sha256')==TARGETS[ADMISSION_MODULE][0]
         and isinstance(admission.get('backups'),dict)
         and set(admission['backups'])=={ADMISSION_MODULE,'inventory'},
         'admission receipt chain mismatch')
    checked_backups(ADMISSION_BACKUP,admission['backups'])
    observed=admission.get('observation')
    need(isinstance(observed,dict) and digest(observed)==admission.get('observation_sha256'),
         'admission observation chain mismatch')
    for name,mode in ((ADMISSION_MODULE,0o644),('inventory',0o600)):
        meta=admission['backups'][name];exact_meta(meta,mode)
        need(meta==observed.get('target' if name==ADMISSION_MODULE else 'inventory_meta'),
             'admission backup observation mismatch')
    need(admission['backups'][ADMISSION_MODULE]['sha256']==ADMISSION_OLD,
         'admission backup target chain mismatch')
    raw=regular_bytes(STATE/ADMISSION_BACKUP/'inventory')
    need(read_json(STATE/ADMISSION_BACKUP/'inventory')==expected
         and bytes_sha(raw)==observed.get('inventory_sha256'),
         'admission backup inventory is not the pkg-finish pair')
    old=ADMISSION_OLD;new=TARGETS[ADMISSION_MODULE][0]
    need(raw.count(old.encode())==1 and raw.count(new.encode())==0,
         'admission inventory value is not unique')
    edited=raw.replace(old.encode(),new.encode())
    expected['after'][str(LIB/ADMISSION_MODULE)]=new
    from core import loads
    need(loads(edited)==expected and len(edited)==len(raw),'admission inventory edit drift')
    recorded_inventory(edited)
    return expected,dict(**provenance,rerecord_receipt_sha256=RERECORD_SHA,pkg_receipt_sha256=PKG_SHA,
        admission_receipt_sha256=ADMISSION_SHA,admission_inventory_sha256=bytes_sha(edited))


def file_meta(path):
    raw=regular_bytes(path);info=path.stat()
    return dict(sha256=bytes_sha(raw),mode=stat.S_IMODE(info.st_mode),uid=info.st_uid,gid=info.st_gid)


def exact_meta(meta,mode):
    need(meta['mode']==mode and meta['uid']==OWNER_UID and meta['gid']==OWNER_GID,
         'installed bytes/metadata drift')


def observation():
    idle()
    for path,pin in UNCHANGED.items():
        if path not in {LIB/name for name in TARGETS}:need(sha(path)==pin,'unchanged lib pin drift: '+path.name)
    for name,(old,_) in TARGETS.items():need(sha(LIB/name)==old,'target baseline drift: '+name)
    raw=regular_bytes(INVENTORY);inventory=recorded_inventory(raw);upgraded_bytes(raw)
    for path,pin in inventory['after'].items():need(sha(Path(path))==pin,'live inventory byte drift')
    expected,provenance=lower_stack()
    need(inventory==expected and bytes_sha(raw)==provenance['admission_inventory_sha256'],
         'inventory is not the post-admission pair')
    targets={name:file_meta(LIB/name) for name in TARGETS};meta=file_meta(INVENTORY)
    for target in targets.values():exact_meta(target,0o644)
    exact_meta(meta,0o600)
    return dict(protected=protected_state(),inventory_sha256=bytes_sha(raw),inventory_meta=meta,
        targets=targets,lower_stack=provenance,change=dict(
            targets={name:dict(path=str(LIB/name),before=old,after=new) for name,(old,new) in TARGETS.items()},
            inventory=dict(path=str(INVENTORY),entries={str(LIB/name):dict(before=old,after=new)
                for name,(old,new) in TARGETS.items()})))


SMOKE_CODE=r"""
import sys
sys.path.insert(0,sys.argv[1])
import owner_package_admission as A
import antigravity_qa_recovery as Q
assert Q.OWNER_PACKAGE_SOURCES and callable(Q.package_rules_ok)
assert A.EXPECTED_PINS and callable(A.accept)
print('AGY29_SMALL_RANGE_SMOKE_PASS')
"""


def smoke():
    # Imports only. No fixture directory, live-state read, acceptance or model call.
    for uid in (1002,978):
        out=run(['/usr/bin/unshare','-n','/usr/bin/setpriv','--reuid',str(uid),
            '--regid',str(uid),'--clear-groups','--no-new-privs',
            '/usr/bin/env','-i','PATH=/usr/bin:/bin','HOME=/nonexistent','LANG=C.UTF-8',
            '/usr/bin/python3','-I','-B','-c',SMOKE_CODE,str(LIB)],timeout=60)
        need(b'AGY29_SMALL_RANGE_SMOKE_PASS' in out,'installed import smoke failed')


def backup_paths():
    return {**{name:LIB/name for name in TARGETS},'inventory':INVENTORY}


def receipt_read(commit):
    receipt=read_json(J)
    need(receipt.get('schema')==SCHEMA and receipt.get('commit')==commit
         and receipt.get('manifest')==MANIFEST and receipt.get('phase') in
         ('backed_up','target_installed','active','rollback_failed','rolled_back'),
         'foreign small-range upgrade transaction')
    need(digest(receipt['observation'])==receipt['observation_sha256'],'observation receipt drift')
    need(set(receipt['backups'])==set(backup_paths()),'backup membership drift')
    R.trusted_tree(BK);R.trusted_tree(J)
    need(stat.S_IMODE(BK.stat().st_mode)==0o700,'backup directory mode drift')
    need(set(os.listdir(BK))==set(receipt['backups']),'backup membership drift')
    for name,meta in receipt['backups'].items():
        R.trusted_tree(BK/name)
        exact_meta(meta,0o600 if name=='inventory' else 0o644)
        need(sha(BK/name)==meta['sha256'],'backup bytes/metadata drift')
    for name,(old,_) in TARGETS.items():
        need(receipt['backups'][name]==receipt['observation']['targets'][name]
             and receipt['backups'][name]['sha256']==old,'backup target baseline drift')
    need(receipt['backups']['inventory']==receipt['observation']['inventory_meta']
         and receipt['backups']['inventory']['sha256']==receipt['observation']['inventory_sha256'],
         'backup inventory baseline drift')
    need(receipt.get('new_sha256')=={name:new for name,(_,new) in TARGETS.items()} and receipt.get('script_sha256')==
         bytes_sha(regular_bytes(Path(__file__).absolute())),'installer differs from the receipt')
    return receipt


def assert_unchanged(receipt):
    need(protected_state()==receipt['observation']['protected'],'protected state changed')


def transaction_bytes(receipt):
    old=regular_bytes(BK/'inventory');new=upgraded_bytes(old)
    expected,provenance=lower_stack()
    need(read_json(BK/'inventory')==expected and bytes_sha(old)==provenance['admission_inventory_sha256'],
         'backup inventory is not the post-admission pair')
    for name,(pin,_) in TARGETS.items():need(sha(BK/name)==pin,'backup target baseline drift')
    return old,new


def verify(receipt):
    need(receipt['phase']=='active','upgrade is not active')
    idle();assert_unchanged(receipt)
    old,new=transaction_bytes(receipt)
    for name,(_,pin) in TARGETS.items():
        meta=receipt['backups'][name]
        need(file_meta(LIB/name)==dict(meta,sha256=pin),'installed target bytes/metadata drift')
    meta=receipt['backups']['inventory']
    need(regular_bytes(INVENTORY)==new and file_meta(INVENTORY)==dict(meta,sha256=bytes_sha(new)),
         'installed inventory bytes/metadata drift')
    for path,pin in read_json(INVENTORY)['after'].items():need(sha(Path(path))==pin,'live inventory byte drift')


def restore(receipt):
    need(receipt['phase']!='rolled_back','already rolled back; no writes')
    idle();assert_unchanged(receipt)
    old,new=transaction_bytes(receipt)
    for name,pins in TARGETS.items():need(sha(LIB/name) in pins,'rollback target drift')
    need(regular_bytes(INVENTORY) in (old,new),'rollback inventory drift')
    for name,path in backup_paths().items():
        meta=receipt['backups'][name]
        atomic_bytes(path,regular_bytes(BK/name),meta['mode'],meta['uid'],meta['gid'])
        need(file_meta(path)==meta,'rollback bytes/metadata readback drift')
    assert_unchanged(receipt)
    receipt['phase']='rolled_back';write_json(J,receipt)


def apply(material,script_sha,commit,expected_observation):
    if os.path.lexists(J) or os.path.lexists(BK):
        # Only a verified identical active transaction is an idempotent no-op.
        need(os.path.lexists(J) and os.path.lexists(BK),'existing guarded transaction; verify/rollback first')
        receipt=receipt_read(commit)
        need(receipt['phase']=='active','existing guarded transaction; verify/rollback first')
        verify(receipt);print('APPLY_NOOP: already active and verified');return
    observed=observation()
    need(digest(observed)==expected_observation,'dry observation changed; rerun dry')
    need(isinstance(material,dict) and set(material)==set(TARGETS)
         and all(type(raw) is bytes and bytes_sha(raw)==TARGETS[name][1] for name,raw in material.items()),
         'exact two-target material required')
    BK.mkdir(mode=0o700)
    try:
        saved={}
        for name,path in backup_paths().items():
            raw=regular_bytes(path);saved[name]=file_meta(path)
            atomic_bytes(BK/name,raw,0o600)
        need(observation()==observed,'backup-phase drift; no installed write occurred')
        receipt=dict(schema=SCHEMA,phase='backed_up',commit=commit,manifest=MANIFEST,
            script_sha256=script_sha,new_sha256={name:new for name,(_,new) in TARGETS.items()},observation=observed,
            observation_sha256=expected_observation,backups=saved)
        write_json(J,receipt)
    except BaseException:
        if not os.path.lexists(J):shutil.rmtree(BK,ignore_errors=True)
        raise
    try:
        idle();assert_unchanged(receipt)
        need(all(file_meta(LIB/name)==saved[name] for name in TARGETS)
             and file_meta(INVENTORY)==saved['inventory'],'pre-write drift')
        for name in TARGETS:
            need(file_meta(LIB/name)==saved[name],'pre-install drift')
            meta=saved[name];atomic_bytes(LIB/name,material[name],meta['mode'],meta['uid'],meta['gid'])
        receipt['phase']='target_installed';write_json(J,receipt)
        smoke();idle();assert_unchanged(receipt)
        need(all(file_meta(LIB/name)==dict(saved[name],sha256=new) for name,(_,new) in TARGETS.items())
             and file_meta(INVENTORY)==saved['inventory'],
             'pre-inventory write drift')
        meta=saved['inventory']
        atomic_bytes(INVENTORY,upgraded_bytes(regular_bytes(BK/'inventory')),meta['mode'],meta['uid'],meta['gid'])
        receipt['phase']='active';write_json(J,receipt);verify(receipt)
    except BaseException:
        try:restore(receipt)
        except BaseException:
            receipt['phase']='rollback_failed';write_json(J,receipt)
        raise
    print('APPLY_PASS: only two library files and their two inventory values changed')


def dry(script_sha,commit):
    lock_unheld(STATE/'controller.lock')
    need(not os.path.lexists(J) and not os.path.lexists(BK),'existing guarded transaction')
    observed=observation()
    print(json.dumps(dict(status='DRY_PASS',commit=commit,script_sha256=script_sha,
        observation_sha256=digest(observed),observation=observed,change=observed['change'],
        writes=[*[str(LIB/name) for name in TARGETS],'backup.json (two values, byte-exact)',str(BK),str(J)],
        manifest_field='preserved',policy_writes=0,lib_writes=2,model_calls=0),sort_keys=True))


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
    for path,pin in UNCHANGED.items():
        if path not in {LIB/name for name in TARGETS}:need(sha(path)==pin,'installed trusted lib drift')
    global R
    sys.path.insert(0,str(LIB))
    import receiver
    R=receiver
    R.trusted_tree(Path(__file__).absolute())
    for path in (*[LIB/name for name in TARGETS],*UNCHANGED,STATE,INVENTORY,POLICY,MARKER,BUDGET,STATE/'controller.lock'):
        R.trusted_tree(path)
    for name,pins in TARGETS.items():need(sha(LIB/name) in pins,'unrecognized installed target')
    need((R.STATE,R.POLICY,R.AUTONOMY,R.BUDGET)==(STATE,POLICY,AUTONOMY,BUDGET),'receiver path drift')
    need(re.fullmatch('[a-f0-9]{40}',args.commit),'exact 40hex commit required')
    script_sha,material=source(args.bundle.absolute(),args.commit)
    if args.verb=='dry':return dry(script_sha,args.commit)
    if args.verb=='verify':
        lock_unheld(STATE/'controller.lock');verify(receipt_read(args.commit));print('VERIFY_PASS');return
    with controller_lock():
        if args.verb=='apply':
            need(type(args.observation_sha256) is str and re.fullmatch('[a-f0-9]{64}',args.observation_sha256),
                 'apply requires --observation-sha256 from dry')
            apply(material,script_sha,args.commit,args.observation_sha256)
        else:
            restore(receipt_read(args.commit));print('ROLLBACK_PASS')


if __name__=='__main__':
    try:main()
    except BaseException as error:
        print('AGY29_SMALL_RANGE_UPGRADE_REFUSED: '+(str(error) if isinstance(error,Refused) else type(error).__name__),file=sys.stderr)
        sys.exit(1)

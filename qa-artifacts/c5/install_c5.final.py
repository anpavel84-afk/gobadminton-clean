#!/usr/bin/python3
"""Scoped PR #294 (Stage 3 Antigravity: UID978 + unix permissions + NNP, NO AppArmor profile) installer, applied AFTER #292 (C4).
DRAFT: constants marked @@...@@ are filled by fill_c5.py after the #294 merge + R5 preparation; every verb refuses while any remains.
No model calls, grant charges, PROD or product effects. Installs exactly THREE manifest-payload deltas (native_antigravity.py #294, context_policy.py + owner_package_admission.py #297 = EOM 1.4 pin)
and ONE non-manifest file: /usr/local/lib/gb-actions-train/accepted-engineering-rules.md (EOM 1.3 38c34012.. -> EOM 1.4 017441de.., 113203 bytes),
copied from the verified release clone with byte backup, exact verify and rollback (the manifest installer does not copy it).
stage.py/monitor-mapping.json/native_guard.py/content_identity.py and ops-monitor files are asserted unchanged.
Also verifies the registry-group contour: receiver GROUP == 65042, native REGISTRY_GROUP/REGISTRY_GROUP_NOTE (CAP_SETGID, 'does not name gid 65042'),
and a non-root probe as 978:968 with groups [65042] (accepted) and with no groups (refused).
PRECONDITION (enforced): gb-agy-runtime is NOT loaded and /etc/apparmor.d/gb-agy-runtime is absent (host script
/root/gb-agy-profile-unload-20261024.py applied first), and slot2 UNKNOWN op 957fbe33 is reconciled (pending None).
The canary marker is NOT changed here; it is bound to C4/old native and is re-issued later by owner_package_admission.
Owner-scoped Slot1 checkpoint #271 idle exception carried over from install292 (must be confirmed in the Owner grant).
Root usage: /usr/bin/python3 -B /root/gb-agy29-nopolicy294-scoped-install-20261024.py <dry|apply|verify|verify-merged|rollback>
ROLLBACK ORDER: this installer's rollback FIRST, then the host profile unload rollback (never the reverse). A second rollback after
'rolled_back' refuses before any write; rollback does not need the profile loaded (it only reports its state read-only).
The script file must be root:root mode 0700 in a root-owned, not group/world writable directory (enforced for every verb).
"""
import contextlib
import copy
import fcntl
import hashlib
import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
sys.dont_write_bytecode = True
sys.path.insert(0, '/usr/local/lib/gb-actions-train')
import receiver as R
import installer as I
from core import need, digest, Refused

C='41e12be2d551158e97ea30eaf8e95f992f998615'  # C5 = merge commit of PR #294 head c9b67f9e + PR #297 head 0d160f67 (fixed identity/date, see c5_plan.md); sole release parent
RELEASE='05f06a7ab1197c81f795f35df2ab41f9625501a8'  # R5 ref-only child of C5 (scripts/chatops/ops/prepare_train_release.py)
OLD='7d3d6ca0b06275e7f4c3d35700cbdf14061a4e55'  # controller_sha installed by #292 (C4) = policy before this install
OLD_RELEASE='316a3c616b25405ac6ac2a4ad04cc6b63fb7f203'  # #292 release R4 (dev 2446bcc second parent)
PIN_OLD=OLD  # checkout pins inside C5 (== dev 2446bcc; the release rewrites them to C5)
MANIFEST='0f16f0d60e05d13fa1778f5e9220341b4f62149ddc3e99ced10235344cf21944'  # sha256 of manifest.json at C5 and RELEASE (local preview for C5 41e12be2: 0f16f0d60e05d13fa1778f5e9220341b4f62149ddc3e99ced10235344cf21944)
MANIFEST_OLD='a42d68be19a84ca9478f7931912174e440e6ed68572106df1417a696399f0298'  # inventory manifest after #292
PROFILE_NAME='gb-agy-runtime'
PROFILE_FILE=pathlib.Path('/etc/apparmor.d/gb-agy-runtime')  # must be ABSENT (parked by the host unload script)
PROFILE_PARKED=pathlib.Path('/root/gb-agy-profile-unload-backup-20261024/gb-agy-runtime')
PROFILE_SHA='771033253ed459b9bcd3617bb5a2b623e4fdbc120bee83d62ea1d591d571c589'  # parked profile bytes (only evidence, never reloaded here)
CI_CUR='e2df72bcf044149bd5f87a8a9f01a64ed8116a6db72d691a0e6e2b2036cf71af'  # content_identity.py (unchanged here)
RULES_OLD_COMMIT='1169e965976e9498d4e5e1e23aae201e97ec9665'
RULES_OLD_SHA='38c34012f10974496a7d7cbc74ecacb62bf7847278e295edfeb107d69a5d1c1c'  # installed accepted-engineering-rules.md BEFORE (EOM 1.3)
RULES_OLD_SIZE=100818
RULES_COMMIT='bc8bad0c38a861f8e72296d0a323e2941b9322e0'  # immutable git object of EOM 1.4 (context_policy.py RULES_COMMIT at C5)
RULES_SHA='017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269'  # accepted-engineering-rules.md AFTER (EOM 1.4)
RULES_SIZE=113203
RULES_REVISION='1.4'
RULES_SOURCE_PATH='docs/rules/ENGINEERING_OPERATING_MODEL.md'  # tracked file in the release clone, must equal the git object and RULES_SHA
REGISTRY_GROUP=65042  # supplementary group of the installed receiver / executor (residual: NOT named by Owner waiver t317u)
B=pathlib.Path('/root/gb-agy29-nopolicy294-r' + RELEASE[:8])
LIB=pathlib.Path('/usr/local/lib/gb-actions-train')
NATIVE=LIB/'native_antigravity.py'
GUARD=LIB/'native_guard.py'
ADMISSION=LIB/'owner_package_admission.py'
CONTENT=LIB/'content_identity.py'
RULES=LIB/'accepted-engineering-rules.md'
STAGE=LIB/'stage.py'
CONTEXT=LIB/'context_policy.py'
MAPPING=LIB/'monitor-mapping.json'
# target -> (installed sha before, sha after); these three manifest files + the rules file (RULES_*) are the WHOLE installed delta.
TARGETS = {
    NATIVE: ('349b4b4969e0ee2113fa731c6a11483634c6208504755987959f504d8aa489a8',
             '99e70d960b1db2567c32dea10a7341487b3aeb511a1aa5a51b85be86cded2d42'),  # expected for #294 head c9b67f9e: 99e70d960b1db2567c32dea10a7341487b3aeb511a1aa5a51b85be86cded2d42
    CONTEXT: ('82d869d74a9918694663c3acbc72bf9df2919ef2801a380013afb736c77b3aef',
              'd961079b9791f53cf7ce0ac208180b0c9d9100ef46b48c025c2938d2eb69a806'),  # expected for #297 head 0d160f67: d961079b9791f53cf7ce0ac208180b0c9d9100ef46b48c025c2938d2eb69a806
    ADMISSION: ('5987d7d1ff5f5440d66ab745ab2369cf4b35d6ef28391e8da335bef1b449e824',
                'd72c85dada60dee30e7fd53f17eac65ddff7f9dafffb508615ec02a0ae22f026'),  # expected for #297 head 0d160f67: d72c85dada60dee30e7fd53f17eac65ddff7f9dafffb508615ec02a0ae22f026
}
# Installed earlier and NOT touched here: must equal both the live bytes and the release payload.
UNCHANGED = {
    STAGE: 'ea79b894076c755f28d62619154b0681ecb636b7b32dd05c18a8c996112a1c2e',
    MAPPING: 'f12d50165bc7bea004a4dbeb058ad6a53b8e1a896c72ed5a584f67e1c7366405',
    GUARD: 'dd2e0a0c6c0dea0d353b7dc5f16c1a5d4c4c21f022947ceaa640470c59fb0762',
}
# Separately deployed ops-monitor files: live bytes == release payload (no drift). Never written by this script; any live difference refuses.
MONITOR = {
    '/usr/local/lib/gb-ops-monitor/web/app.js': ('c2d7a233ab77f10fd5795f1629814b7fee6e579d4da9968a29d982a5faf979ca',
                                                 'c2d7a233ab77f10fd5795f1629814b7fee6e579d4da9968a29d982a5faf979ca'),
    '/usr/local/lib/gb-ops-monitor/opsmon/writer.py': ('fc89ff1f9a26b565b2214f887873f4ea661c46bf86dd41daf37fe44680212158',
                                                       'fc89ff1f9a26b565b2214f887873f4ea661c46bf86dd41daf37fe44680212158'),
}
MARKER=pathlib.Path('/etc/gobadminton-slots/antigravity-qa.json')
MARKER_SHA='2ba7daa712ce92a13e1cf142c04e3f7470f292e45fba6aa8141a50da1054f411'  # read-only observation of the live marker (phase=canary, adapter_revision C4); re-verify at dry
J=R.STATE/'agy29-nopolicy294-scoped-install.json'
BK=R.STATE/'agy29-nopolicy294-scoped-backup'
J292=R.STATE/'agy29-nosandbox292-scoped-install.json'
J274=R.STATE/'agy29-oauth274-scoped-install.json'
J269=R.STATE/'agy29-content269-scoped-install.json'
J273=R.STATE/'agy29-context273-scoped-install.json'
BACKUP_PATHS={'native':NATIVE,'context':CONTEXT,'admission':ADMISSION,'rules':RULES,'policy':R.POLICY,
              'inventory':R.STATE/'backup.json'}
TARGET_BACKUP={'native':NATIVE,'context':CONTEXT,'admission':ADMISSION}  # backup name -> manifest target
RESTORE_ORDER=('native','context','admission','rules','inventory')  # policy is restored separately and LAST (disabled first)
# Exact telemetry files whose bytes change every minute; excluded from the state manifest if it ever reaches them.
TELEMETRY = {R.AUTONOMY/'outbox'/'slot1'/'telemetry.json', R.AUTONOMY/'outbox'/'slot2'/'telemetry.json'}
SCRIPT = pathlib.Path('/root/gb-agy29-nopolicy294-scoped-install-20261024.py')
REMOTE = 'https://github.com/anpavel84-afk/gobadminton-clean.git'
RELEASE_BRANCH = 'chatops/agy-c5-release-20261025'  # pushed release branch (PR #299, draft): R5 05f06a7a on top of C5 41e12be2; must exist before the VPS clone
WORKFLOW = '.github/workflows/train-stage.yml'
STAGE_SHA = 'b9703ca27b7bb3f494f379f8e259e62a6a48bc8f5ff50c6923e1712d8899d68d'  # train-stage.yml at RELEASE (R5) (local preview for R5 05f06a7a: b9703ca27b7bb3f494f379f8e259e62a6a48bc8f5ff50c6923e1712d8899d68d)
DEV_SHA = '80ee50f6b3138a098a885263670afd342772b3d906e54feebc41b5a35c82d715'  # dev train-stage.yml (R4) == installed policy pin after #292 (merge 2446bcc)
PROC_LOCKS = pathlib.Path('/proc/locks')
SCHEMA = 'GB_AGY29_NOPOLICY294_INSTALL_V1'
MANIFEST_FILE = BK / 'state-manifest.json'
MANUAL = '/usr/bin/python3 -B ' + str(SCRIPT) + ' rollback'
HOST_UNLOAD = '/root/gb-agy-profile-unload-20261024.py'  # host script (separate grant); its rollback is run AFTER this installer's rollback
ROLLBACK_PHASES = ('backed_up', 'disabled', 'content_installed', 'active', 'restored_disabled', 'rollback_failed')  # phases that still need a rollback (rolled_back does not)
ROLLBACK_ORDER = ('ROLLBACK ORDER: run this rollback FIRST, then the host profile unload rollback (' + HOST_UNLOAD + ' rollback); '
                  'never the other way round. This rollback does not require the profile to be loaded and never loads it.')
SLOTS = (('slot1', 1002), ('slot2', 978))
REQUIRED=[
 R.STATE/'slot1.json',R.STATE/'slot2.json',
 R.AUTONOMY/'slots/slot1/state.json',R.AUTONOMY/'slots/slot2/state.json',
 MARKER,R.BUDGET,
 R.STATE/'antigravity-29-owner-package-6379442541.json',
 R.STATE/'antigravity-29-owner-package-6379127824.json',
 R.STATE/'antigravity-29-addressed-ledger.json',
 R.STATE/'antigravity-29-stage3-supplement.json',
 R.STATE/'agy29-unknown105-model-scheduling-reconciliation.json',
 R.STATE/'agy-slot1-271-gen66-scheduling-reconciliation.json',
 J274, J269, J273, J292,
]


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


def regular_bytes(path):
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
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, 'unsafe regular file')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            raw = stream.read()
        need(stable(os.fstat(fd)) == stable(before), 'file changed during hash')
        current = path.lstat()
        need((current.st_dev, current.st_ino) == (before.st_dev, before.st_ino), 'file replaced during hash')
        return raw
    finally:
        os.close(fd)


def sha(path):
    return bytes_sha(regular_bytes(path))


def run(argv, timeout=20):
    # No inherited credentials/config, shell, hooks, output/argv in errors, or prompts.
    env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root',
           'LANG': 'C.UTF-8', 'GIT_CONFIG_NOSYSTEM': '1',
           'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0',
           'GIT_OPTIONAL_LOCKS': '0', 'GIT_NO_REPLACE_OBJECTS': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
    p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       timeout=timeout, check=False, env=env, stdin=subprocess.DEVNULL)
    need(p.returncode == 0, 'bounded OPS command failed')
    return p.stdout


def git(*args, timeout=20):
    return run(['/usr/bin/git', '-C', str(B), '-c', 'core.hooksPath=/dev/null',
                '-c', 'core.fsmonitor=false', *args], timeout=timeout)


def clone_identity():
    R.trusted_tree(B)
    R.trusted_tree(B / '.git')
    need(git('remote', 'get-url', 'origin').decode().strip() == REMOTE, 'wrong root clone origin')
    need(git('rev-parse', 'HEAD').decode().strip() == RELEASE,
         'root clone must be detached at release ' + RELEASE + ', sole parent ' + C)
    need(git('show', '-s', '--format=%P', RELEASE).decode().split() == [C],
         'release must have sole parent ' + C + ': ' + RELEASE)
    need(git('rev-parse', '--symbolic-full-name', 'HEAD').strip() == b'HEAD', 'root clone must be detached')
    need(not git('status', '--porcelain=v1', '--untracked-files=all'), 'dirty root source')
    # A clean worktree may still contain symlinks or an ignored injected file.
    for path in B.rglob('*'):
        R.trusted_tree(path)
    changed = git('diff-tree', '--no-commit-id', '--name-only', '-r', RELEASE).decode().splitlines()
    need(set(changed) == {WORKFLOW, '.github/workflows/train-dispatch.yml'}, 'release is not ref-only')
    for path in changed:
        before = git('show', C + ':' + path)
        after = git('show', RELEASE + ':' + path)
        need(before.count(('ref: ' + PIN_OLD).encode()) == 2 and
             before.replace(('ref: ' + PIN_OLD).encode(), ('ref: ' + C).encode()) == after,
             'release changed more than checkout pins')
        need(regular_bytes(B / path) == after, 'release worktree workflow drift')


def remote_workflow(fetch=False):
    if fetch:
        # Real apply only: the explicit fetch refreshes origin/dev in this fresh clone.
        git('fetch', 'origin', 'dev', timeout=60)
        head = git('rev-parse', 'FETCH_HEAD').strip()
        need(head == git('rev-parse', 'refs/remotes/origin/dev').strip(), 'fetch did not refresh origin/dev')
        return git('show', head.decode() + ':' + WORKFLOW)
    # dry/verify cannot fetch: even a no-ref fetch writes objects/FETCH_HEAD.
    # Resolve the same origin branch read-only and retrieve its immutable blob.
    rows = git('ls-remote', '--exit-code', 'origin', 'refs/heads/dev', timeout=30).splitlines()
    need(len(rows) == 1, 'ambiguous remote dev')
    fields = rows[0].split()
    need(len(fields) == 2 and fields[1] == b'refs/heads/dev' and
         re.fullmatch(rb'[0-9a-f]{40}', fields[0]), 'invalid remote dev SHA')
    head = fields[0].decode()
    return run(['/usr/bin/curl', '-q', '--fail', '--silent', '--show-error',
                '--proto', '=https', '--connect-timeout', '5', '--max-time', '20',
                '--max-filesize', '1048576',
                'https://raw.githubusercontent.com/anpavel84-afk/gobadminton-clean/' + head + '/' + WORKFLOW], timeout=25)


def predicted_merge(policy, current, release):
    old_pin, new_pin = ('ref: ' + OLD).encode(), ('ref: ' + C).encode()
    need(bytes_sha(release) == STAGE_SHA and release.count(new_pin) == 2, 'release stage workflow drift')
    need(bytes_sha(current) == DEV_SHA and policy.get('stage_workflow_sha256') == bytes_sha(current),
         'current dev/policy workflow mismatch or already merged')
    need(current.count(old_pin) == 2 and bytes_sha(current.replace(old_pin, new_pin)) == bytes_sha(release),
         'predicted dev merge workflow mismatch')
    return bytes_sha(release)


SMOKE_CODE = r"""
import hashlib, os, pathlib, sys
sys.dont_write_bytecode = True
MOD, WORK, EXPECT = sys.argv[1], sys.argv[2], sys.argv[3]
os.chdir(WORK)
sys.path.insert(0, MOD)
raw = pathlib.Path(MOD, 'native_antigravity.py').read_bytes()
assert hashlib.sha256(raw).hexdigest() == EXPECT
compile(raw, 'native_antigravity.py', 'exec')
import native_antigravity as N
assert os.path.realpath(N.__file__) == os.path.realpath(os.path.join(MOD, 'native_antigravity.py'))
assert N.EXECUTOR_UID == 978 and N.EXECUTOR_GID == 968 and N.FILESYSTEM_BOUNDARY == 'uid978_unix_permissions_nnp'
assert not hasattr(N, 'APPARMOR_PROFILE') and not hasattr(N, 'APPARMOR_POLICY_SHA256')
assert callable(N._verify_executor_boundary) and hasattr(N, 'OWNER_WAIVER')
assert N.REGISTRY_GROUP == 65042 and 'CAP_SETGID' in N.REGISTRY_GROUP_NOTE and 'does not name gid 65042' in N.REGISTRY_GROUP_NOTE
for argv in (N.command(60), N.command(60, analysis=False)):
    assert '--sandbox' not in argv and '--dangerously-skip-permissions' in argv
    assert argv[argv.index('--agent') + 1] == N.AGENT and '--input-format' in argv
for text in (N.ANALYSIS_AGENT_DEF, N.AGENT_DEF):
    assert '--sandbox' not in text
print('SMOKE_C5_PASS')
"""

# Root-side identity probe: the receiver (root) runs the same pre-charge check the adapter runs (child as 978:968, no groups, NNP, CapEff 0).
BOUNDARY_CODE = r"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
import native_antigravity as N
assert os.geteuid() == 0
N._verify_executor_boundary()
print('BOUNDARY_C5_PASS')
"""

# Non-root contour probe (the installed receiver leaves 978:968 + supplementary 65042): exactly [65042] is accepted, [] is refused.
CONTOUR_CODE = r"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
import native_antigravity as N
assert (os.geteuid(), os.getegid()) == (978, 968)
if sys.argv[2] == 'accept':
    assert os.getgroups() == [65042]
    N._verify_executor_boundary()
    print('CONTOUR_C5_ACCEPT_PASS')
else:
    assert os.getgroups() == []
    try:
        N._verify_executor_boundary()
    except PermissionError:
        print('CONTOUR_C5_REFUSE_PASS')
"""

# Root probe: context_policy pins (EOM 1.4) match the rules bytes at RULES_PATH and the owner-package admission pin.
RULES_CODE = r"""
import pathlib, re, sys
sys.dont_write_bytecode = True
MOD, RPATH, SHA, SIZE, COMMIT, REV, UID = sys.argv[1:8]
sys.path.insert(0, MOD)
import context_policy as P
assert (P.RULES_SHA256, P.RULES_SIZE, P.RULES_COMMIT, P.RULES_REVISION) == (SHA, int(SIZE), COMMIT, REV)
text, meta = P.load(pathlib.Path(RPATH), trusted_uids=tuple(int(x) for x in UID.split(',')))
assert (meta['sha256'], meta['bytes'], meta['revision'], meta['commit']) == (SHA, int(SIZE), REV, COMMIT)
assert re.search(r"^RULES='" + SHA + r"'$", pathlib.Path(MOD, 'owner_package_admission.py').read_text(), re.M)
print('RULES_C5_PASS')
"""


def smoke(module_dir, label):
    """UID 1002 and 978, no network namespace, isolated python: the target module imports, is byte-identical to the expected
    release bytes, builds the AGY argv WITHOUT --sandbox and keeps the UID978/NNP constants (no AppArmor symbols). No model call, no AGY exec,
    no credential, no protected-state write."""
    need(pathlib.Path('/var/tmp').is_dir(), 'missing /var/tmp')
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='gb294-smoke-', dir='/var/tmp'))
    try:
        os.chmod(tmp, 0o755)
        mod = module_dir
        if label == 'source':
            mod = tmp / 'mod'
            mod.mkdir(mode=0o755)
            for path in sorted((B / 'scripts/chatops/actions_train').glob('*.py')):
                need(not path.is_symlink(), 'indirect source module')
                (mod / path.name).write_bytes(regular_bytes(path))
                os.chmod(mod / path.name, 0o644)
        expect = TARGETS[NATIVE][1]
        for slot, uid in SLOTS:
            work = tmp / slot
            work.mkdir(mode=0o755)
            run(['/usr/bin/chown', '-R', str(uid) + ':' + str(uid), str(work)])
            out = run(['/usr/bin/unshare', '-n', '/usr/bin/setpriv', '--reuid', str(uid), '--regid', str(uid), '--clear-groups',
                       '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'HOME=/nonexistent', 'LANG=C.UTF-8',
                       '/usr/bin/python3', '-I', '-B', '-c', SMOKE_CODE, str(mod), str(work), expect], timeout=60)
            need(b'SMOKE_C5_PASS' in out, 'unix-boundary native smoke failed for ' + slot)
        out = run(['/usr/bin/unshare', '-n', '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'LANG=C.UTF-8',
                   '/usr/bin/python3', '-I', '-B', '-c', BOUNDARY_CODE, str(mod)], timeout=60)
        need(b'BOUNDARY_C5_PASS' in out, 'executor identity/NNP probe failed as root receiver')
        for mode, want, groups in (('accept', b'CONTOUR_C5_ACCEPT_PASS', str(REGISTRY_GROUP)), ('refuse', b'CONTOUR_C5_REFUSE_PASS', '')):
            gflag = ['--groups', groups] if groups else ['--clear-groups']
            out = run(['/usr/bin/unshare', '-n', '/usr/bin/setpriv', '--reuid', '978', '--regid', '968', *gflag,
                       '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'HOME=/nonexistent', 'LANG=C.UTF-8',
                       '/usr/bin/python3', '-I', '-B', '-c', CONTOUR_CODE, str(mod), mode], timeout=60)
            need(want in out, 'registry group 65042 contour probe failed: ' + mode)
        rules_path = (B / RULES_SOURCE_PATH) if label == 'source' else RULES
        out = run(['/usr/bin/unshare', '-n', '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'LANG=C.UTF-8',
                   '/usr/bin/python3', '-I', '-B', '-c', RULES_CODE, str(mod), str(rules_path), RULES_SHA, str(RULES_SIZE),
                   RULES_COMMIT, RULES_REVISION, '0'], timeout=60)
        need(b'RULES_C5_PASS' in out, 'EOM 1.4 rules/context_policy/admission pin probe failed')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return dict(smoke294='pass', boundary='uid978_nnp_probe', registry_group_probe='accept[65042]+refuse[]', rules_probe='eom1.4', target=label, uids=[uid for _, uid in SLOTS], network='unshared', model_calls=0)


def source():
    clone_identity()
    items = I.payload(B, MANIFEST)  # independently rehash the release manifest and every payload
    need(all(not p.is_symlink() for p in items), 'indirect installed payload')
    changes = {target: src for target, src in items.items() if sha(target) != sha(src)}
    need(set(changes) == set(TARGETS), 'unexpected installed payload delta')
    for target, (old, new) in TARGETS.items():
        need(sha(target) == old and sha(changes[target]) == new, 'installed target hash mismatch ' + target.name)
    for target, value in UNCHANGED.items():
        need(sha(target) == value == sha(items[target]), 'unchanged installed file differs ' + target.name)
    for name, (old, new) in MONITOR.items():
        path = pathlib.Path(name)
        need(path in items and sha(path) == new and sha(items[path]) == new,
             'ops-monitor installed bytes differ from the release payload')
    need(sha(CONTENT) == CI_CUR == sha(items[CONTENT]), 'content identity changed')
    rules_old_state()
    # The installed EOM 1.3 rules file is not release payload; prove it equals its immutable git object (baseline), and that the EOM 1.4
    # replacement is the same bytes in the immutable git object, in the clone worktree, and in the pins of the release payload.
    need(bytes_sha(git('show', RULES_OLD_COMMIT + ':' + RULES_SOURCE_PATH)) == RULES_OLD_SHA, 'immutable old rules git object drift')
    new_rules = git('show', RULES_COMMIT + ':' + RULES_SOURCE_PATH)
    need(bytes_sha(new_rules) == RULES_SHA and len(new_rules) == RULES_SIZE, 'immutable EOM 1.4 git object drift')
    need(regular_bytes(B / RULES_SOURCE_PATH) == new_rules, 'clone EOM 1.4 worktree file drift')
    git('merge-base', '--is-ancestor', RULES_COMMIT, RELEASE)
    rules_pins(items)
    need(sha(MARKER) == MARKER_SHA, 'canary marker changed')
    return changes


def rules_old_state():
    """Installed rules file is EXACTLY the EOM 1.3 baseline: regular root-owned file, not group/world writable."""
    trusted_target(RULES)
    need(not stat.S_IMODE(RULES.stat().st_mode) & 0o022, 'rules file group/world writable')
    need(sha(RULES) == RULES_OLD_SHA and RULES.stat().st_size == RULES_OLD_SIZE, 'installed rules are not the EOM 1.3 baseline')


def rules_new_state():
    trusted_target(RULES)
    need(not stat.S_IMODE(RULES.stat().st_mode) & 0o022, 'rules file group/world writable')
    need(sha(RULES) == RULES_SHA and RULES.stat().st_size == RULES_SIZE, 'installed rules are not EOM 1.4')


def rules_pins(items):
    """The release payload must pin exactly the EOM 1.4 bytes (context_policy) and admit exactly its sha (owner_package_admission)."""
    ctx = regular_bytes(items[CONTEXT]).decode()
    for needle in ("RULES_COMMIT = '" + RULES_COMMIT + "'", "RULES_SHA256 = '" + RULES_SHA + "'",
                   'RULES_SIZE = ' + str(RULES_SIZE), "RULES_REVISION = '" + RULES_REVISION + "'"):
        need(ctx.count(needle) == 1, 'context_policy pin differs from EOM 1.4')
    need(regular_bytes(items[ADMISSION]).decode().count("RULES='" + RULES_SHA + "'\n") == 1, 'owner admission rules pin differs from EOM 1.4')


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


def live_slots():
    observed = {}
    for slot, uid in SLOTS:
        journal = R.journal(slot)
        checkpoint = R.checkpoint(slot)
        need(type(journal['generation']) is int and journal['pending'] is None, 'slot pending ' + slot)
        # Owner exception (Pavel, 2026-10-24 16:13 BRT; this script/sha only; same discipline as t286u for #274):
        # Slot1 may hold the active #271 checkpoint (never modified: journal pending None, no model child, units inactive,
        # worker.lock/lease free, controller.lock held, and Slot1/Slot2 state manifest byte-identical before/after or rollback).
        # Slot2 must have no active checkpoint. Any other Slot1 issue is refused.
        if slot == 'slot2':
            need(checkpoint[0]['active'] is None, 'slot2 checkpoint occupied')
        else:
            active = checkpoint[0]['active']
            need(active is None or (isinstance(active, dict) and active.get('issue') == 271),
                 'slot1 exception is limited to checkpoint #271')
        R.no_models(uid, slot)
        lock_unheld(R.AUTONOMY / 'slots' / slot / 'worker.lock')
        lock_unheld(R.AUTONOMY / 'locks' / (slot + '.lease'))
        observed[slot] = dict(generation=journal['generation'], pending=journal['pending'],
                              checkpoint=copy.deepcopy(list(checkpoint)))
    R.units_quiet(R.UNITS)
    for unit in R.UNITS:
        props = dict(line.split('=', 1) for line in run([
            '/usr/bin/systemctl', 'show', unit,
            '--property=ActiveState,MainPID,UnitFileState']).decode().splitlines() if '=' in line)
        need(props.get('ActiveState') == 'inactive' and props.get('MainPID') == '0'
             and props.get('UnitFileState') == 'masked', 'slot/supervisor unit must be inactive and masked')
    need(not os.path.lexists(R.STATE / 'integration.json'), 'active integration')
    return observed


def idle():
    policy = R.read(R.POLICY, 0)
    need(policy['mode'] == 'active' and policy['controller_sha'] == OLD
         and policy.get('stage_workflow_sha256') == DEV_SHA, 'wrong active controller (#292/C4 not active?)')
    need(isinstance(policy.get('recovery'), dict) and policy['recovery'].get('source_sha') == OLD,
         'policy recovery.source_sha is not exactly the installed C4 controller')
    for path, controller in ((J274, '86801eb601a453f8e8db39266c3558beb26f60d3'),
                             (J269, 'cbc7099223590c3e4ce44e520d0da50f7fced0e0'),
                             (J273, '53ff2cc23d2f4d3bd676c61c5a9c601a12cc8998'), (J292, OLD)):
        receipt = R.read(path, 0, 67108864)
        need(receipt.get('phase') == 'active' and receipt.get('controller_sha') == controller,
             'prior scoped install receipt is not active')
    r292 = R.read(J292, 0, 67108864)
    need(r292.get('controller_sha') == OLD and r292.get('release_sha') == OLD_RELEASE, '#292 receipt is not the active release')
    observed = live_slots()
    inventory = R.read(R.STATE / 'backup.json', 0)
    after = inventory.get('after', {})
    expect = {str(t): v[0] for t, v in TARGETS.items()}
    expect.update({name: v[0] for name, v in MONITOR.items()})
    need(inventory.get('manifest') == MANIFEST_OLD and all(after.get(k) == v for k, v in expect.items()),
         'installed inventory drift')
    for key, value in after.items():
        if key not in expect:
            need(sha(pathlib.Path(key)) == value, 'installed inventory drift')
    need(sha(CONTENT) == CI_CUR, 'installed bytes drift')
    rules_old_state()
    need(all(sha(t) == v[0] for t, v in TARGETS.items()), 'installed target drift')
    need(all(sha(t) == v for t, v in UNCHANGED.items()), 'installed unchanged files drift')
    need(sha(MARKER) == MARKER_SHA, 'canary marker changed')
    return policy, inventory, observed


def state_manifest():
    """Content-only regular entries; size/mode for other entries; no link traversal."""
    result = {}
    excluded = {J, BK, R.STATE / 'backup.json', R.STATE / 'controller.lock', R.POLICY} | TELEMETRY
    for path in REQUIRED:
        sha(path)  # Preserve the precedent's required-path existence checks.
    def walk(path, key, slot=False):
        if path in excluded:
            return
        info = path.lstat()
        if slot and path.name.endswith('.lock') and not stat.S_ISDIR(info.st_mode):
            return
        need(not stat.S_ISLNK(info.st_mode), 'symlink in protected state')
        if stat.S_ISREG(info.st_mode):
            result[key] = sha(path)
        else:
            if not stat.S_ISDIR(info.st_mode):
                result[key] = [info.st_size, info.st_mode]
            if stat.S_ISDIR(info.st_mode):
                # The directory itself must not be exchanged for a link during traversal.
                fd = directory_fd(path)
                try:
                    need(stable(os.fstat(fd)) == stable(info), 'protected directory changed')
                    for name in sorted(os.listdir(fd)):
                        walk(path / name, key + '/' + name, slot)
                    need(stable(path.lstat()) == stable(info), 'protected directory changed during manifest')
                finally:
                    os.close(fd)
    for slot, _ in SLOTS:
        root = R.AUTONOMY / 'slots' / slot
        need(root.is_dir() and not root.is_symlink(), 'missing slot state directory')
        # Directory size is allocation-dependent and may reflect excluded .lock entries.
        # Directories are traversal nodes, not files in the content manifest.
        for child in sorted(root.iterdir()):
            walk(child, 'slots/' + slot + '/' + child.name, True)
    need(R.STATE.is_dir() and not R.STATE.is_symlink(), 'missing controller state directory')
    for child in sorted(R.STATE.iterdir()):
        walk(child, 'state/' + child.name)
    result['budget'] = sha(R.BUDGET)
    result['marker'] = sha(MARKER)
    for slot, _ in SLOTS:
        path = R.AUTONOMY / 'locks' / (slot + '.lease')
        result['leases/' + path.name] = sha(path) if os.path.lexists(path) else None
    return result


def assert_manifest(receipt):
    manifest = R.read(MANIFEST_FILE, 0, 67108864)
    need(digest(manifest) == receipt['state_manifest_sha256'], 'saved state manifest drift')
    need(state_manifest() == manifest, 'protected state manifest changed')


@contextlib.contextmanager
def controller_lock():
    path = R.STATE / 'controller.lock'
    R.trusted_tree(path)
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'unsafe controller lock')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        need(path.lstat().st_ino == info.st_ino, 'controller lock replaced')
        yield
    finally:
        os.close(fd)


def atomic(path, value, mode=0o600):
    R.trusted_tree(path.parent)
    need(not path.is_symlink(), 'indirect metadata target')
    R.atomic(path, value, mode=mode)
    need(sha(path) == bytes_sha(json.dumps(value, sort_keys=True).encode()), 'metadata write not exact')


def put(source, target, mode):
    """Use the installed fsync/rename copier; clean only our fresh partial temporary."""
    tmp = target.with_name('.' + target.name + '.install')
    need(not os.path.lexists(tmp), 'stale install temporary')
    try:
        I.put(source, target, mode)
    finally:
        # installer.put can leave this file behind if copying/fsync/rename fails.
        # Its absence was proved above; controller.lock excludes other installers.
        if os.path.lexists(tmp):
            R.trusted_tree(tmp)
            info = tmp.lstat()
            need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'unsafe partial install temporary')
            tmp.unlink()
            fd = directory_fd(target.parent)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)


def trusted_target(path):
    R.trusted_tree(path)
    info = path.lstat()
    # I.put creates root:root replacements; prove that is the original ownership.
    need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_gid == 0
         and stat.S_IMODE(info.st_mode) <= 0o777, 'unsafe installed target metadata')


def backups():
    need(not os.path.lexists(J) and not os.path.lexists(BK), 'existing guarded transaction')
    original = {}
    for name, path in BACKUP_PATHS.items():
        trusted_target(path)
        mode = stat.S_IMODE(path.stat().st_mode)
        need(mode <= 0o777, 'unsafe backup target mode')
        original[name] = dict(sha256=sha(path), mode=mode)
    BK.mkdir(mode=0o700)
    for name, path in BACKUP_PATHS.items():
        put(path, BK / name, 0o600)
        need(sha(BK / name) == original[name]['sha256'] == sha(path), 'backup verification failed')
    return original


def profile_label():
    """C5 precondition/postcondition: the per-binary AppArmor profile is gone from the kernel and from /etc/apparmor.d.
    Global AppArmor and every other profile are not inspected beyond this name (host script owns that proof)."""
    loaded = pathlib.Path('/sys/kernel/security/apparmor/profiles').read_text().splitlines()
    need(not any(line.startswith(PROFILE_NAME + ' (') or line.startswith(PROFILE_NAME + '//') for line in loaded),
         'gb-agy-runtime (or a child profile) still loaded: run the host unload script first')
    need(not os.path.lexists(PROFILE_FILE), 'gb-agy-runtime profile file still present in /etc/apparmor.d')
    need(PROFILE_PARKED.is_file() and sha(PROFILE_PARKED) == PROFILE_SHA, 'parked profile backup missing or changed')


def next_values(old_policy, old_inventory):
    policy = copy.deepcopy(old_policy)
    policy['controller_sha'] = C
    policy['stage_workflow_sha256'] = STAGE_SHA
    need(isinstance(policy.get('recovery'), dict) and policy['recovery'].get('source_sha') == OLD, 'recovery.source_sha is not the C4 controller')
    policy['recovery']['source_sha'] = C
    inventory = copy.deepcopy(old_inventory)
    for target, (_, new) in TARGETS.items():
        inventory['after'][str(target)] = new
    for name, (_, new) in MONITOR.items():
        inventory['after'][name] = new
    inventory['manifest'] = MANIFEST
    need(set(inventory['after']) == set(old_inventory['after']), 'inventory membership changed')
    return policy, inventory


def old_values(receipt):
    need(receipt.get('schema') == SCHEMA and receipt.get('source_sha') == C
         and receipt.get('release_sha') == RELEASE and receipt.get('manifest_sha256') == MANIFEST,
         'unrecognized rollback transaction')
    need(receipt.get('phase') in ROLLBACK_PHASES, 'invalid rollback phase')
    R.trusted_tree(BK)
    R.trusted_tree(MANIFEST_FILE)
    need(set(receipt['backups']) == set(BACKUP_PATHS), 'backup inventory mismatch')
    for name in BACKUP_PATHS:
        R.trusted_tree(BK / name)
        need(sha(BK / name) == receipt['backups'][name]['sha256'], 'rollback backup drift')
        need(type(receipt['backups'][name]['mode']) is int and
             0 <= receipt['backups'][name]['mode'] <= 0o777, 'unsafe restoration mode')
    for name, target in TARGET_BACKUP.items():
        need(sha(BK / name) == TARGETS[target][0], 'wrong baseline backups')
    need(sha(BK / 'rules') == RULES_OLD_SHA and (BK / 'rules').stat().st_size == RULES_OLD_SIZE, 'wrong baseline rules backup')
    policy = R.read(BK / 'policy', 0)
    inventory = R.read(BK / 'inventory', 0)
    need(policy.get('mode') == 'active' and policy.get('controller_sha') == OLD
         and policy.get('stage_workflow_sha256') == DEV_SHA
         and isinstance(policy.get('recovery'), dict) and policy['recovery'].get('source_sha') == OLD, 'wrong backup policy')
    need(inventory.get('manifest') == MANIFEST_OLD
         and all(inventory.get('after', {}).get(str(t)) == v[0] for t, v in TARGETS.items())
         and all(inventory.get('after', {}).get(n) == v[0] for n, v in MONITOR.items()),
         'wrong backup inventory')
    return policy, inventory


def rollback_gate(receipt):
    """Decide BEFORE any write whether this receipt still needs a rollback. Refusals here change nothing (no disable(), no mode change)."""
    need(isinstance(receipt, dict) and receipt.get('schema') == SCHEMA and receipt.get('source_sha') == C
         and receipt.get('release_sha') == RELEASE, 'unrecognized rollback transaction')
    need(receipt.get('phase') != 'rolled_back', 'transaction already rolled back: nothing to do (no policy or file was changed)')
    need(receipt.get('phase') in ROLLBACK_PHASES, 'invalid rollback phase')
    try:
        current = R.read(R.POLICY, 0)
    except Exception:
        return  # unreadable policy: disable() has an explicit fail-closed path for it
    if isinstance(current, dict):
        need(current.get('controller_sha') in (OLD, C), 'live policy belongs to another controller: refusing to disable or restore over it')


def profile_note():
    """Read-only and informative only: rollback never requires the profile to be loaded or absent."""
    try:
        lines = pathlib.Path('/sys/kernel/security/apparmor/profiles').read_text().splitlines()
    except Exception:
        return 'unknown'
    return 'loaded' if any(l.startswith(PROFILE_NAME + ' (') or l.startswith(PROFILE_NAME + '//') for l in lines) else 'absent'


def disable():
    try:
        current = R.read(R.POLICY, 0)
        need(isinstance(current, dict), 'invalid policy object')
    except Exception:
        # A corrupt policy must not prevent disabling and restoring this transaction.
        current = dict(schema='GB_ACTIONS_TRAIN_POLICY_V1', mode='disabled',
                       owned={}, controller_sha=OLD)
    atomic(R.POLICY, dict(current, mode='disabled'), mode=0o644)


def unchanged_foreign():
    need(sha(CONTENT) == CI_CUR, 'content identity drift')
    need(all(sha(t) == v for t, v in UNCHANGED.items()), 'unchanged installed files drift')
    for name, (old, new) in MONITOR.items():
        need(sha(pathlib.Path(name)) == new, 'ops-monitor bytes drift')


def restored_checks(receipt, old_policy, disabled):
    for path in BACKUP_PATHS.values():
        trusted_target(path)
    need(all(sha(t) == v[0] for t, v in TARGETS.items()), 'rollback bytes not exact')
    rules_old_state()
    unchanged_foreign()
    need(sha(R.STATE / 'backup.json') == receipt['backups']['inventory']['sha256'], 'rollback inventory not exact')
    need(all(stat.S_IMODE(path.stat().st_mode) == receipt['backups'][name]['mode']
             for name, path in BACKUP_PATHS.items() if name != 'policy'), 'rollback modes not exact')
    if disabled:
        need(R.read(R.POLICY, 0) == dict(old_policy, mode='disabled'), 'disabled rollback policy not exact')
    else:
        need(sha(R.POLICY) == receipt['backups']['policy']['sha256'], 'rollback policy not exact')
    assert_manifest(receipt)
    need(live_slots() == receipt['slots'], 'rollback live state changed')


def restore(receipt):
    """Called with controller lock held, and also on a failed apply with state drift.

    Restore only this install's delta first; never restore slot/budget/history bytes.
    Even if state drift prevents activation, targets/inventory are restored promptly.
    """
    disable()
    try:
        old_policy, _ = old_values(receipt)
        for name in RESTORE_ORDER:
            put(BK / name, BACKUP_PATHS[name], receipt['backups'][name]['mode'])
            need(sha(BACKUP_PATHS[name]) == receipt['backups'][name]['sha256'], 'restoration write failed')
        atomic(R.POLICY, dict(old_policy, mode='disabled'), mode=0o644)
        restored_checks(receipt, old_policy, True)
        receipt['phase'] = 'restored_disabled'
        atomic(J, receipt)
        # Restore the original policy BYTES, not a reserialized equivalent.
        put(BK / 'policy', R.POLICY, receipt['backups']['policy']['mode'])
        restored_checks(receipt, old_policy, False)
        need(stat.S_IMODE(R.POLICY.stat().st_mode) == receipt['backups']['policy']['mode'], 'policy mode drift')
        receipt['phase'] = 'rolled_back'
        atomic(J, receipt)
    except BaseException:
        disable()
        receipt['phase'] = 'rollback_failed'
        atomic(J, receipt)
        raise


def manual_failure():
    print('Exact restoration could not be proven; receiver must remain DISABLED. Manual rollback: ' + MANUAL + '\n' + ROLLBACK_ORDER,
          file=sys.stderr)


def backup_phase_failure():
    # No receipt exists yet, so the rollback verb has nothing to restore: do not point the operator at it.
    print('Backup phase failed BEFORE any install write and live state drifted; receiver left DISABLED. No receipt exists, so '
          'rollback has nothing to restore. Inspect the drift, then re-enable policy mode by hand (original policy bytes: '
          + str(BK / 'policy') + ' if present).', file=sys.stderr)


def scrub_partial_backup():
    """Backup-phase failure with NO receipt, NO installed delta and PROVEN unchanged live state: remove only the partial backup
    directory this very transaction created, so a clean retry is not blocked by 'existing guarded transaction'.
    Anything unexpected inside it is left untouched for diagnosis."""
    if os.path.lexists(J) or not os.path.lexists(BK):
        return
    R.trusted_tree(BK)
    names = set(BACKUP_PATHS) | {MANIFEST_FILE.name}
    entries = sorted(BK.iterdir())
    need(all(e.name in names and stat.S_ISREG(e.lstat().st_mode) and e.lstat().st_nlink == 1 for e in entries),
         'unexpected partial backup content')
    for entry in entries:
        entry.unlink()
    BK.rmdir()
    fd = directory_fd(BK.parent)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def script_sane(path=SCRIPT, uid=0):
    """The installer itself must be a root-owned regular file, mode exactly 0700, single link, in a root-owned non-writable directory."""
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_uid == uid and info.st_gid == (0 if uid == 0 else info.st_gid)
         and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o700,
         'installer script must be a root-owned regular file, mode 0700, single link')
    parent = path.parent.lstat()
    need(stat.S_ISDIR(parent.st_mode) and parent.st_uid == uid and not stat.S_IMODE(parent.st_mode) & 0o022,
         'installer directory must be root-owned and not group/world writable')


def preflight(fetch=False):
    script_sane()
    need(not os.path.lexists(J) and not os.path.lexists(BK), 'existing guarded transaction')
    need(stat.S_IMODE(CONTENT.parent.stat().st_mode) == 0o755, 'install directory mode drift')
    for path in (*TARGETS, R.STATE / 'backup.json', R.POLICY):
        need(not os.path.lexists(path.with_name('.' + path.name + '.install'))
             and not os.path.lexists(path.with_name('.' + path.name + '.' + str(os.getpid()))),
             'stale installer temporary')
    for path in (R.STATE, R.STATE / 'controller.lock', R.POLICY, *BACKUP_PATHS.values()):
        R.trusted_tree(path)
    for path in BACKUP_PATHS.values():
        trusted_target(path)
    need(R.GROUP == REGISTRY_GROUP, 'installed receiver registry group differs from 65042')
    changes = source()
    policy, inventory, slots = idle()
    predicted_merge(policy, remote_workflow(fetch), regular_bytes(B / WORKFLOW))
    profile_label()
    return changes, policy, inventory, slots


def dry():
    # Observe exclusion without ever taking/creating a lock in this read-only verb.
    lock_unheld(R.STATE / 'controller.lock')
    changes, policy, _, slots = preflight()
    manifest = state_manifest()
    source_smoke = smoke(None, 'source')  # temp clones/copies under /var/tmp only; removed before return
    print(json.dumps(dict(status='DRY_RUN_PASS', source=C, release=RELEASE,
                         clone=str(B), changed_targets=sorted(str(p) for p in changes),
                         old_controller=policy['controller_sha'],
                         slot_generations={slot: data['generation'] for slot, data in slots.items()},
                         state_manifest_sha256=digest(manifest),
                         manifest_entries=len(manifest), manifest_outbox_keys=[k for k in manifest if 'outbox' in k],
                         source_smoke=source_smoke, model_calls=0, protected_writes=0), sort_keys=True))


def apply():
    with controller_lock():
        changes, old_policy, old_inventory, slots = preflight(fetch=True)
        manifest = state_manifest()
        # Reassert live generation, pending and complete checkpoint just before first write.
        policy_now, inventory_now, slots_now = idle()
        need((policy_now, inventory_now, slots_now) == (old_policy, old_inventory, slots), 'pre-write live drift')
        baseline = {name: sha(path) for name, path in BACKUP_PATHS.items()}
        receipt = None
        try:
            saved = backups()
            need({name: item['sha256'] for name, item in saved.items()} == baseline, 'pre-backup drift')
            atomic(MANIFEST_FILE, manifest)
            receipt = dict(schema=SCHEMA, phase='backed_up', source_sha=C, release_sha=RELEASE,
                           manifest_sha256=MANIFEST, state_manifest_sha256=digest(manifest),
                           slots=slots, backups=saved)
            atomic(J, receipt)
        except BaseException:
            # No installed delta yet. Prove nothing changed, then drop only our own partial backup (clean retry possible).
            try:
                need(all(sha(path) == baseline[name] for name, path in BACKUP_PATHS.items()), 'backup-phase drift')
                need(state_manifest() == manifest and live_slots() == slots, 'backup-phase state drift')
            except BaseException:
                disable()
                backup_phase_failure()
                raise
            try:
                scrub_partial_backup()
            except BaseException:
                pass  # retained for diagnosis; a retry is refused until an operator removes it
            raise
        try:
            atomic(R.POLICY, dict(old_policy, mode='disabled'), mode=0o644)
            receipt['phase'] = 'disabled'
            atomic(J, receipt)
            for target, (old, new) in TARGETS.items():
                need(sha(changes[target]) == new and sha(target) == old, 'pre-install target drift')
            rules_old_state()
            need(sha(B / RULES_SOURCE_PATH) == RULES_SHA and (B / RULES_SOURCE_PATH).stat().st_size == RULES_SIZE, 'rules source drift')
            for target in TARGETS:
                put(changes[target], target, 0o644)
                need(sha(target) == TARGETS[target][1], 'installed SHA drift')
            put(B / RULES_SOURCE_PATH, RULES, receipt['backups']['rules']['mode'])
            rules_new_state()
            unchanged_foreign()
            profile_label()
            receipt['phase'] = 'content_installed'
            atomic(J, receipt)
            result = smoke(LIB, 'installed')
            assert_manifest(receipt)
            need(live_slots() == slots, 'post-install generation/pending/checkpoint drift')
            need(R.read(R.POLICY, 0) == dict(old_policy, mode='disabled')
                 and sha(R.STATE / 'backup.json') == saved['inventory']['sha256'], 'disabled policy/inventory drift')
            next_policy, inventory = next_values(old_policy, old_inventory)
            atomic(R.STATE / 'backup.json', inventory)
            # Verify all payload bytes again; only the three targets have changed.
            need(all(sha(target) == sha(src) for target, src in I.payload(B, MANIFEST).items()), 'activation payload drift')
            unchanged_foreign()
            assert_manifest(receipt)
            need(live_slots() == slots, 'pre-activation live drift')
            need(sha(B / WORKFLOW) == STAGE_SHA, 'pre-activation workflow source drift')
            profile_label()
            atomic(R.POLICY, next_policy, mode=0o644)
            assert_manifest(receipt)
            need(live_slots() == slots and R.read(R.POLICY, 0) == next_policy
                 and sha(R.STATE / 'backup.json') == bytes_sha(json.dumps(inventory, sort_keys=True).encode()),
                 'activation state/policy/inventory drift')
            receipt.update(phase='active', controller_sha=C, smoke=result, rules_sha256=RULES_SHA, registry_group=REGISTRY_GROUP,
                           policy_after_sha=sha(R.POLICY), inventory_after_sha=sha(R.STATE / 'backup.json'))
            atomic(J, receipt)
            print(json.dumps(dict(status='ACTIVE', release=RELEASE, controller=C,
                                  model_calls=0, state_manifest_sha256=receipt['state_manifest_sha256']), sort_keys=True))
        except BaseException:
            try:
                restore(receipt)
                print('Apply failed; exact prior controller restored and ACTIVE.', file=sys.stderr)
            except BaseException:
                manual_failure()
            raise


def rollback():
    with controller_lock():
        R.trusted_tree(J)
        receipt = R.read(J, 0, 67108864)
        rollback_gate(receipt)
        try:
            disable()  # Block new dispatch even if quiescence/state proof refuses restoration.
            old_policy, old_inventory = old_values(receipt)
            assert_manifest(receipt)  # Explicit rollback never overwrites a changed slot history.
            need(live_slots() == receipt['slots'], 'rollback slot state changed')
            current = R.read(R.POLICY, 0)
            new_policy, new_inventory = next_values(old_policy, old_inventory)
            need(current in (dict(old_policy, mode='disabled'), dict(new_policy, mode='disabled')),
                 'different controller policy installed')
            need(all(sha(t) in v for t, v in TARGETS.items()), 'rollback target drift')
            need(sha(RULES) in (RULES_OLD_SHA, RULES_SHA), 'rollback rules drift')
            unchanged_foreign()
            need(R.read(R.STATE / 'backup.json', 0) in (old_inventory, new_inventory), 'rollback inventory drift')
            restore(receipt)
        except BaseException:
            disable()
            manual_failure()
            raise
        print('ROLLBACK_PASS_PRIOR_CONTROLLER_ACTIVE_HISTORY_PRESERVED')
        print('NOTE gb-agy-runtime profile is ' + profile_note() + ' (read-only observation, not a rollback condition). '
              'The restored C4 adapter expects the profile: NEXT run the host unload rollback (' + HOST_UNLOAD + ' rollback). ' + ROLLBACK_ORDER)


def verify(strict=False):
    # Entirely read-only, including the root clone; no receiver/code execution.
    clone_identity()
    R.trusted_tree(J)
    receipt = R.read(J, 0, 67108864)
    old_policy, old_inventory = old_values(receipt)
    need(receipt['phase'] == 'active', 'install is not active')
    expected_policy, inventory = next_values(old_policy, old_inventory)
    policy = R.read(R.POLICY, 0)
    need(policy == expected_policy and policy['mode'] == 'active' and policy['controller_sha'] == C,
         'postflight installed policy drift')
    raw = remote_workflow()
    merged = bytes_sha(raw) == STAGE_SHA and raw.count(('ref: ' + C).encode()) == 2
    pending = bytes_sha(raw) == DEV_SHA and raw.count(('ref: ' + OLD).encode()) == 2
    need(policy['stage_workflow_sha256'] == STAGE_SHA and (merged or pending), 'postflight dev workflow incoherent')
    need(not strict or merged, 'dev does not yet contain the release workflow (train requests fail closed until it does)')
    need(all(sha(t) == v[1] for t, v in TARGETS.items()), 'postflight target drift')
    rules_new_state()
    unchanged_foreign()
    profile_label()
    need(sha(R.POLICY) == receipt['policy_after_sha'] and
         sha(R.STATE / 'backup.json') == receipt['inventory_after_sha'] and
         R.read(R.STATE / 'backup.json', 0) == inventory, 'postflight metadata drift')
    assert_manifest(receipt)
    need(live_slots() == receipt['slots'], 'postflight slot state drift')
    print('POSTFLIGHT_PASS dev_workflow=' + ('merged' if merged else 'PENDING_MERGE_OF_RELEASE'))


def main():
    need(not any('@@' in v for v in (C, RELEASE, MANIFEST, STAGE_SHA, TARGETS[NATIVE][1], TARGETS[CONTEXT][1], TARGETS[ADMISSION][1])), 'placeholders not filled: run fill_c5.py')
    need(os.geteuid() == 0 and len(sys.argv) == 2 and sys.argv[1] in ('dry', 'apply', 'verify', 'verify-merged', 'rollback'),
         'usage: /usr/bin/python3 -B ' + str(SCRIPT) + ' <dry|apply|verify|verify-merged|rollback> (root)')
    # Do not resolve symlinks before checking this exact deployment path.
    need(pathlib.Path(__file__).absolute() == SCRIPT, 'wrong root installer path')
    R.trusted_tree(SCRIPT)
    script_sane()
    import resource
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    return {'dry': dry, 'apply': apply, 'verify': verify, 'verify-merged': lambda: verify(True), 'rollback': rollback}[sys.argv[1]]()


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        # Fixed refusal messages only; never show subprocess stderr, request data or tracebacks.
        print('INSTALL_C5_REFUSED: ' + (str(error) if isinstance(error, Refused) else type(error).__name__), file=sys.stderr)
        sys.exit(1)

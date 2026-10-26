#!/usr/bin/python3
"""Scoped Slot2 scheduling-only closure of the UNKNOWN QA-qualification operation 36aec348...c210 (journal generation 115 -> 116,
pending -> None). Prepared for independent review; NOT executed on live state by its author.
No refund, no UNKNOWN replay, no model call, no GitHub/network access, no PROD. The charge receipts, the reservation, the budget, the
evidence, the owner package, the ledger and every other state file are proven byte-identical (state manifest before/after). The
operation stays recorded in `operations` as status=unknown / safe_release=false (consumed); another call needs a NEW Owner package.
Exactly ONE protected file changes: /var/lib/gobadminton-actions-train/slot2.json (generation+1, pending=None, nothing else).
Policy is disabled only for the write window and restored to its exact original bytes/mode/owner.
Root usage: /usr/bin/python3 -B /root/gb-agy29-unknown116-scheduling-reconcile-20261026.py <dry|apply|verify|rollback>
dry and verify write nothing. apply/rollback hold controller.lock.
"""
import contextlib
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
sys.dont_write_bytecode = True
sys.path.insert(0, '/usr/local/lib/gb-actions-train')
import receiver as R
from core import need, digest, Refused

C = '41e12be2d551158e97ea30eaf8e95f992f998615'  # the controller that must be ACTIVE (policy.controller_sha)
OP = '36aec3485a221a0c61fe84941877b15d57c8a07efbc8e081e20c478e61dcc210'
OPHASH = '4a5ec86f26263346b407757d3603428f788b6b1fdab210f505a4c7704da8663e'
PROCESS = {'boot': '447e18ce-024d-4230-b88f-bd8ca81e2a9e', 'pid': 427156, 'start': '66868215'}
RUN, ATTEMPT = 40316758633, 1
HEAD = '12f35ac4430348ae811cf712d9bb24d2a19b62e6'
BASE = 'b0e4d233bc150f42ada86c4c0f56897c57e0d0fe'
TASK = '67459c812560ba072cede2b6a8b4ad22cfa2a6190a1b7ee55b9567ef40d3138c'
FINGERPRINT = 'ae8d648efeee945f60cb25e0ea2bc646ca0cfdf4405379f8af3032f79d9e8ac6'
EVIDENCE_ID = '103b4acb54f64becb4c1e12c02f8aa38'
CHECKPOINT = {'active': None, 'done': [152, 205, 216]}
CHECKD = '6b5c9fab7fe8c73a9164d2fe7a1731232bfeb80cbf78746ab09a9b5e57e6b4eb'
BINDING = {'action': 'train', 'attempt': 0, 'generation': 115, 'head': '12f35ac4430348ae811cf712d9bb24d2a19b62e6', 'issue': 29, 'phase': 'idle', 'profile': 'agy', 'slot': 'slot2', 'stage': 'qa_qualification'}
RESULT = {'adapter_error': {'code': 'AGY_INPUT_LIMIT', 'detail': 'QA input 466131 bytes exceeds 262144 byte limit after rules inject; refusing before model call; no charge; not truncated; whole-file boundary scripts/chatops/ops/antigravity_addressed_upgrade.py; files=37; diff_bytes=314931', 'evidence_id': '103b4acb54f64becb4c1e12c02f8aa38', 'phase': 'source'}, 'checkpoint': None, 'reason': 'AGY_INPUT_LIMIT', 'safe_release': False, 'status': 'unknown'}
GENERATION = {'slot2': 115}  # slot1 is deliberately NOT pinned (it is live); it must be idle and byte-stable across the transaction
AFTER_GENERATION = {'slot2': 116}
WORK = '/srv/gb-slots/slot2/worktrees/antigravity-qa-29-canary'
EVID = R.AUTONOMY / 'slots' / 'slot2' / 'antigravity-evidence' / EVIDENCE_ID
EXPECTED = {  # immutable observed files; checked before AND after, never written
    EVID / 'phase-01.json': 'ef56bedb5d58b4ff433f76833b8d50ced614a774fa1066516180ad035dbb36fc',  # pre-model private evidence (preflight)
    EVID / 'phase-02.json': '07248ba10f8dbaad330d7875a7ac16b771f91a675331f7a6bbcce48022fcc69d',  # pre-model private evidence (preflight)
    EVID / 'phase-03.json': '642033e982c8b8835354de9cc666058f4083eee479ac37bcc87b8562717bb973',  # pre-model private evidence (source)
    R.STATE / 'antigravity-29-addressed-67459c812560ba072cede2b6a8b4ad22cfa2a6190a1b7ee55b9567ef40d3138c.json': 'ac3aa10366882cd9b8d25edebc9b1f30f316de9dd16fb44d9128f6ef568016f7',  # task scheduling reservation, kept consumed
    # Addressed grant charge mentioning this TASK (facts116b charges_mentioning); not a model-call proof.
    R.AUTONOMY / 'slots' / 'slot2' / 'antigravity-29-addressed-charge-ae8d648efeee945f60cb25e0ea2bc646ca0cfdf4405379f8af3032f79d9e8ac6.json': '699660fdfd3fcf3337fdaa1018e3e6a841af800dd4986251eed70ea8cd4bbba8',
    R.STATE / 'antigravity-29-owner-package-6404499964.json': '00295ddd34be9b71562d4fde670896b66bb68017ac1ae464e0c466317b396d60',  # Owner package ledger; name/content provenance only
    R.STATE / 'antigravity-29-owner-package-admission-6404499964-qa.json': '0a91d666549d391eb820eba6b1c8728bea6804d526f25946af89907bf7978a2e',  # QA admission; name/content provenance only
    R.STATE / 'antigravity-29-owner-package-admission-6404499964.json': '8d63c339646bfa24409f787d0a08dc0b8dd5b1e9e64bde7c7afb5762fecb5d00',  # package admission; name/content provenance only
    R.STATE / 'antigravity-29-owner-package-6396105635.json': '17609a229f800615682a33e4c406007d605b961c87d01a7e9179f1d67d6258ab',  # historical package ledger; name/content provenance only
    R.STATE / 'antigravity-29-addressed-ledger.json': '6b49d7a03bdb96182eae23ab18b4b8afa645aa35baf84ae90b6ff9b567e9c8a2',  # addressed history ledger; name/content provenance only
    R.BUDGET: '8f6752295c2ee65924b5a95ddc42bb9774f8f73ce146481e52aaf200e142ed8d',  # protected budget, no refund
    pathlib.Path('/etc/gobadminton-slots/antigravity-qa.json'): '2da2d8c7078f5c4e40d8aebe78487353965adaa57c4c91079508b54baf0bab8c',  # QA qualification marker
    R.AUTONOMY / 'slots' / 'slot2' / 'antigravity-29-one-shot-charge.json': '10cdf0844bb5eb4c71cd576a95cb7aa576c76c513ccc94231773e242f2244241',  # historical one-shot charge
}
F_JOURNAL = R.STATE / 'slot2.json'
F_POLICY = R.POLICY
# name -> (path, uid, gid, mode, sha256 before this transaction)
FILES = {
    'journal': (F_JOURNAL, 0, 0, 0o600, '8cf51b070574c5acd5c829031561ecd3149eabf7bfb575539d4a025348078e47'),
    'policy': (F_POLICY, 0, 0, 0o644, '52250df8b6391b46fe4b80f6805c27e89d06a1c493ca27002b187b1f1f7567d4'),
}
WRITE_ORDER = ('journal',)
CHANGED_KEYS = {'journal': 'state/slot2.json'}
J = R.STATE / 'agy29-unknown116-scheduling-reconciliation.json'
BK = R.STATE / 'agy29-unknown116-scheduling-backup'
MANIFEST_FILE = BK / 'state-manifest.json'
MARKER = pathlib.Path('/etc/gobadminton-slots/antigravity-qa.json')
TELEMETRY = {R.AUTONOMY / 'outbox' / 'slot1' / 'telemetry.json', R.AUTONOMY / 'outbox' / 'slot2' / 'telemetry.json'}
SCRIPT = pathlib.Path('/root/gb-agy29-unknown116-scheduling-reconcile-20261026.py')
PROC = pathlib.Path('/proc')
PROC_LOCKS = PROC / 'locks'
SCHEMA = 'GB_AGY29_UNKNOWN116_RECONCILE_V1'
MANUAL = '/usr/bin/python3 -B ' + str(SCRIPT) + ' rollback'
SLOTS = (('slot1', 1002), ('slot2', 978))
PHASES = ('backed_up', 'disabled', 'journal_written', 'applied', 'restored_disabled', 'restore_failed', 'rolled_back')
MODEL_RE = re.compile(r'codex|antigravity|\bagy\b|cursor-agent|/srv/gb-slots|gb-actions-train', re.I)
REQUIRED = [R.STATE / 'slot1.json', R.STATE / 'slot2.json', R.AUTONOMY / 'slots/slot1/state.json',
            R.AUTONOMY / 'slots/slot2/state.json', MARKER, R.BUDGET]


def bytes_sha(raw):
    return hashlib.sha256(raw).hexdigest()


def stable(info):
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


def meta(path):
    info = pathlib.Path(path).lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'unsafe regular file')
    return dict(mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)


def unique(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, 'duplicate JSON key')
        result[key] = value
    return result


def decode(raw, ascii_first):
    """Parse and require the exact canonical serialisation the live writer produces; return (value, ensure_ascii)."""
    try:
        value = json.loads(raw, object_pairs_hook=unique)
    except ValueError:
        raise Refused('unparseable protected JSON') from None
    for flag in ((True, False) if ascii_first else (False, True)):
        if json.dumps(value, ensure_ascii=flag, sort_keys=True).encode() == raw:
            return value, flag
    raise Refused('protected JSON is not in the canonical live serialisation')


def encode(value, flag):
    return json.dumps(value, ensure_ascii=flag, sort_keys=True).encode()


def run(argv, timeout=20):
    env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'}
    p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False,
                       env=env, stdin=subprocess.DEVNULL)
    need(p.returncode == 0, 'bounded OPS command failed')
    return p.stdout


def lock_unheld(path):
    """Never flock or open a slot lock for writing, even temporarily."""
    path = pathlib.Path(path)
    try:
        before = path.lstat()
    except FileNotFoundError:
        need(not os.path.lexists(path), 'racing slot lock')
        return
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, 'unsafe slot lock')
    key = (os.major(before.st_dev), os.minor(before.st_dev), before.st_ino)
    for line in PROC_LOCKS.read_text().splitlines():
        for field in line.split():
            if re.fullmatch(r'[0-9a-fA-F]+:[0-9a-fA-F]+:[0-9]+', field):
                major, minor, inode = field.split(':')
                need((int(major, 16), int(minor, 16), int(inode)) != key, 'slot lock inode held')
    need(path.lstat() == before, 'slot lock changed during observation')


def quiet():
    """Old dispatcher/worker units inactive and masked; slot cgroups contain no model child."""
    R.units_quiet(R.UNITS)
    for unit in R.UNITS:
        props = dict(line.split('=', 1) for line in run([
            '/usr/bin/systemctl', 'show', unit, '--property=ActiveState,MainPID,UnitFileState']).decode().splitlines() if '=' in line)
        need(props.get('ActiveState') == 'inactive' and props.get('MainPID') == '0'
             and props.get('UnitFileState') == 'masked', 'slot/supervisor unit must be inactive and masked')
    for slot, uid in SLOTS:
        R.no_models(uid, slot)


def model_procs():
    """No process of slot UIDs 978/1002 may look like a model/slot worker. (Unrelated long-lived UID1002 services exist and are
    only counted.) Returns the number of unrelated slot-UID processes seen."""
    others = 0
    for entry in PROC.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            uid = entry.stat().st_uid
            if uid not in (978, 1002):
                continue
            cmd = (entry / 'cmdline').read_bytes().replace(b'\0', b' ').decode('utf-8', 'replace')
        except OSError:
            continue  # process exited while scanning
        need(not MODEL_RE.search(cmd), 'model/slot worker process present')
        need(uid != 978, 'process of the Slot2 executor UID present')
        others += 1
    return others


def git(*args):
    env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/nonexistent', 'GIT_CONFIG_GLOBAL': '/dev/null',
           'GIT_CONFIG_SYSTEM': '/dev/null', 'GIT_OPTIONAL_LOCKS': '0', 'LANG': 'C.UTF-8'}
    p = subprocess.run(['/usr/sbin/runuser', '-u', 'gb-slot2', '--', '/usr/bin/git', '-C', WORK] + list(args),
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, check=False, env=env, stdin=subprocess.DEVNULL)
    need(p.returncode == 0, 'bounded git read failed')
    return p.stdout.decode()


def proof():
    """Read-only pre-model refusal proof: exact phases, no streams, dead process, unchanged candidate.
    A later separately reviewed step may move this worktree; this reconcile must then refuse, never move it back.
    """
    for path, want in EXPECTED.items():
        need(sha(path) == want, 'immutable evidence/receipt drift: ' + path.name)
    need(set(os.listdir(EVID)) == {'phase-01.json', 'phase-02.json', 'phase-03.json'},
         'unexpected evidence files; no stdout/stderr or model stream may exist')
    common = dict(schema='GB_AGY_PRIVATE_EVIDENCE_V1', evidence_id=EVIDENCE_ID,
                  adapter_sha256='01d4816e881765da6361af07a15765528aef274dad0eb780b1afab6b0e5e0f72',
                  base_sha=BASE, source_sha=HEAD, task_sha256=TASK, charge_state='not_charged',
                  exit_code=None, input_sha256=None, rules_sha256=None, timeout=False)
    phases = [dict(common, phase='preflight', terminal=False),
              dict(common, phase='preflight', terminal=False, requested_model='claude-sonnet-5-5-medium'),
              dict(common, phase='source', terminal=True, requested_model='claude-sonnet-5-5-medium',
                   error_code='AGY_INPUT_LIMIT', status='unknown', refusal=RESULT['adapter_error']['detail'])]
    for number, expected in enumerate(phases, 1):
        phase = json.loads(regular_bytes(EVID / ('phase-%02d.json' % number)), object_pairs_hook=unique)
        need(phase == expected, 'pre-model phase content drift: phase-%02d' % number)
    need(not R.alive(PROCESS), 'original operation process is still alive')
    need(git('rev-parse', 'HEAD').strip() == HEAD,
         'candidate HEAD changed; a later separately reviewed step may have moved this checkout; refuse without touching it')
    need(not git('status', '--porcelain=v1').strip(), 'source work tree dirty')
    return dict(evidence_files=len(EXPECTED), model_calls=0, charge_state='not_charged',
                terminal='AGY_INPUT_LIMIT', worktree_head=HEAD)


def live_slots(pending2):
    observed = {}
    expected_pending = {'slot1': None, 'slot2': pending2}
    for slot, uid in SLOTS:
        journal = R.journal(slot)
        checkpoint = R.checkpoint(slot)
        need(type(journal['generation']) is int and journal['pending'] == expected_pending[slot], 'unexpected pending ' + slot)
        lock_unheld(R.AUTONOMY / 'slots' / slot / 'worker.lock')
        lock_unheld(R.AUTONOMY / 'locks' / (slot + '.lease'))
        observed[slot] = dict(generation=journal['generation'], pending=journal['pending'],
                              checkpoint=copy.deepcopy(list(checkpoint)))
    quiet()
    model_procs()
    need(not os.path.lexists(R.STATE / 'integration.json'), 'active integration')
    return observed


def state_manifest():
    """Content-only regular entries; size/mode for other entries; no link traversal."""
    result = {}
    excluded = {J, BK, R.STATE / 'controller.lock', R.POLICY} | TELEMETRY
    for path in REQUIRED:
        sha(path)

    def walk(path, key, slot=False):
        if path in excluded:
            return
        info = path.lstat()
        if slot and path.name.endswith('.lock') and not stat.S_ISDIR(info.st_mode):
            return
        need(not stat.S_ISLNK(info.st_mode), 'symlink in protected state')
        if stat.S_ISREG(info.st_mode):
            result[key] = sha(path)
        elif not stat.S_ISDIR(info.st_mode):
            result[key] = [info.st_size, info.st_mode]
        else:
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


def expected_manifest(before, after_shas):
    expect = dict(before)
    for name, key in CHANGED_KEYS.items():
        need(key in expect, 'manifest key missing ' + key)
        expect[key] = after_shas[name]
    return expect


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
    put_raw(path, json.dumps(value, sort_keys=True).encode(), 0, 0, mode)
    need(sha(path) == bytes_sha(json.dumps(value, sort_keys=True).encode()), 'metadata write not exact')


def fsync_dir(path):
    fd = directory_fd(path)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def put_raw(path, raw, uid, gid, mode):
    """Atomic exact-bytes write preserving owner/group/mode: temp in the same directory, fchown+fchmod BEFORE data, fsync, rename."""
    path = pathlib.Path(path)
    tmp = path.with_name('.' + path.name + '.rec116')
    need(not os.path.lexists(tmp), 'stale rec116 temporary')
    need(not path.is_symlink(), 'indirect write target')
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        try:
            os.fchown(fd, uid, gid)
            os.fchmod(fd, mode)
            view = memoryview(raw)
            while view:
                view = view[os.write(fd, view):]
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(tmp, path)
        fsync_dir(path.parent)
    finally:
        if os.path.lexists(tmp):
            os.unlink(tmp)
            fsync_dir(path.parent)
    need(sha(path) == bytes_sha(raw), 'exact write failed')
    m = meta(path)
    need(m == dict(mode=mode, uid=uid, gid=gid), 'owner/mode not preserved')


def disable():
    try:
        current = R.read(R.POLICY, 0)
        need(isinstance(current, dict), 'invalid policy object')
    except Exception:
        current = dict(schema='GB_ACTIONS_TRAIN_POLICY_V1', mode='disabled', owned={}, controller_sha=C)
    atomic(R.POLICY, dict(current, mode='disabled'), mode=0o644)


def backups(live):
    need(not os.path.lexists(J) and not os.path.lexists(BK), 'existing guarded transaction')
    BK.mkdir(mode=0o700)
    saved = {}
    for name, item in live.items():
        put_raw(BK / name, item['raw'], 0, 0, 0o600)
        need(sha(BK / name) == item['sha256'], 'backup verification failed')
        saved[name] = dict(sha256=item['sha256'], mode=item['mode'], uid=item['uid'], gid=item['gid'])
    return saved


def scrub_partial_backup():
    if os.path.lexists(J) or not os.path.lexists(BK):
        return
    R.trusted_tree(BK)
    names = set(FILES) | {MANIFEST_FILE.name}
    entries = sorted(BK.iterdir())
    need(all(e.name in names and stat.S_ISREG(e.lstat().st_mode) and e.lstat().st_nlink == 1 for e in entries),
         'unexpected partial backup content')
    for entry in entries:
        entry.unlink()
    BK.rmdir()
    fsync_dir(BK.parent)


def check_receipt(receipt):
    need(receipt.get('schema') == SCHEMA and receipt.get('controller_sha') == C and receipt.get('operation') == OP and receipt.get('phase') in PHASES,
         'unrecognized rollback transaction')
    R.trusted_tree(BK)
    R.trusted_tree(MANIFEST_FILE)
    need(set(receipt['files']) == set(FILES), 'backup inventory mismatch')
    for name, item in receipt['files'].items():
        R.trusted_tree(BK / name)
        need(item['sha256'] == FILES[name][4] and sha(BK / name) == item['sha256'], 'rollback backup drift ' + name)
        need((item['uid'], item['gid'], item['mode']) == FILES[name][1:4], 'rollback owner/mode pin drift ' + name)
        need(all(type(item[k]) is int for k in ('uid', 'gid', 'mode')) and 0 <= item['mode'] <= 0o777, 'unsafe restoration mode')
    manifest = R.read(MANIFEST_FILE, 0, 67108864)
    need(digest(manifest) == receipt['state_manifest_sha256'], 'saved state manifest drift')
    for name in WRITE_ORDER:
        need(type(receipt['after'][name]) is str and len(receipt['after'][name]) == 64, 'invalid receipt after hashes')
    snapshots = {name: dict(raw=regular_bytes(BK / name), **item) for name, item in receipt['files'].items()}
    planned = plan(snapshots, CHECKPOINT)
    need(receipt['after'] == {name: bytes_sha(raw) for name, raw in planned['after'].items()}, 'receipt postimage drift')
    return manifest


def policy_original(receipt):
    """Accept only the pinned original policy or our exact canonical disabled variant."""
    raw = regular_bytes(R.POLICY)
    orig = regular_bytes(BK / 'policy')
    expected_meta = dict(mode=FILES['policy'][3], uid=0, gid=0)
    need(meta(R.POLICY) == expected_meta, 'policy owner/mode drift during rollback')
    need(raw in (orig, encode(dict(json.loads(orig), mode='disabled'), True)),
         'different controller policy installed; foreign bytes refused')
    return orig, expected_meta


def restore(receipt, manifest0, policy=None):
    """Exact restoration of the journal and policy under the controller lock; policy left DISABLED on any failure."""
    try:
        policy_raw, policy_meta = policy or policy_original(receipt)
        disable()
        full = True  # scoped rollback requires the complete original manifest
        for name in reversed(WRITE_ORDER):
            path, uid, gid, mode, before = FILES[name]
            current = sha(path)
            need(current in (before, receipt['after'][name]), 'unexpected live file during restore ' + name)
            if current != before or meta(path) != dict(mode=mode, uid=uid, gid=gid):
                put_raw(path, regular_bytes(BK / name), uid, gid, mode)
            need(sha(path) == before and meta(path) == dict(mode=mode, uid=uid, gid=gid), 'restoration not exact ' + name)
        if full:
            need(state_manifest() == manifest0, 'rollback manifest not identical to the pre-apply manifest')
        receipt['phase'] = 'restored_disabled'
        atomic(J, receipt)
        put_raw(R.POLICY, policy_raw, policy_meta['uid'], policy_meta['gid'], policy_meta['mode'])
        need(sha(R.POLICY) == bytes_sha(policy_raw) and meta(R.POLICY) == policy_meta, 'policy bytes/owner/mode not restored')
        if full:
            need(state_manifest() == manifest0, 'rollback manifest drift after policy restore')
            need(sha(R.POLICY) == FILES['policy'][4], 'policy not byte-identical to its original')
        receipt['phase'] = 'rolled_back'
        atomic(J, receipt)
    except BaseException:
        disable()
        receipt['phase'] = 'restore_failed'
        try:
            atomic(J, receipt)
        except BaseException:
            pass
        raise


def manual_failure():
    print('Exact restoration could not be proven; receiver must remain DISABLED. Manual rollback: ' + MANUAL, file=sys.stderr)


def backup_phase_failure():
    print('Backup phase failed BEFORE any protected write and live state drifted; receiver left DISABLED. No receipt exists, so '
          'rollback has nothing to restore. Inspect the drift, then re-enable policy mode by hand (original policy bytes: '
          + str(BK / 'policy') + ' if present).', file=sys.stderr)


def read_live():
    """Raw bytes + metadata of the protected files, with the exact pre-state pins enforced by plan()."""
    live = {}
    for name, (path, uid, gid, mode, before) in FILES.items():
        raw = regular_bytes(path)
        live[name] = dict(raw=raw, sha256=bytes_sha(raw), **meta(path))
    return live


def plan(live, checkpoint):
    """Pure function: validate supplied snapshots and return only planned journal bytes; no I/O."""
    for name, (path, uid, gid, mode, before) in FILES.items():
        need(bytes_sha(live[name]['raw']) == live[name]['sha256'] == before, 'pre-state sha drift: ' + name)
        need((live[name]['uid'], live[name]['gid'], live[name]['mode']) == (uid, gid, mode), 'pre-state owner/mode drift: ' + name)
    journal, journal_ascii = decode(live['journal']['raw'], True)
    policy = json.loads(live['policy']['raw'])
    need(policy.get('mode') == 'active' and policy.get('controller_sha') == C, 'controller must be ACTIVE and exact')
    need(set(journal) == {'confirmed', 'deferred', 'generation', 'last', 'operations', 'pending', 'profiles', 'stage_counts'},
         'unexpected slot2 journal keys')
    need(journal['generation'] == GENERATION['slot2'] and journal['pending'] == OP, 'not the exact UNKNOWN occupancy')
    op = journal['operations'][OP]
    need(digest(op) == OPHASH and op['process'] == PROCESS and op['run'] == RUN and op['run_attempt'] == ATTEMPT
         and op['task_hash'] == TASK and op['binding'] == BINDING, 'forged or changed operation')
    need(op['before'] == op['after'] == CHECKD and op['result'] == RESULT, 'operation is not the terminal unknown/safe_release=false result')
    need(checkpoint == CHECKPOINT and digest(checkpoint) == CHECKD and op['checkpoint_before'] == CHECKPOINT, 'slot2 checkpoint is not the recorded idle checkpoint')
    new_journal = copy.deepcopy(journal)
    new_journal['generation'] = GENERATION['slot2'] + 1
    new_journal['pending'] = None  # nothing else: operations (UNKNOWN stays consumed), last, confirmed, deferred, stage_counts, profiles
    need({k: v for k, v in new_journal.items() if k not in ('generation', 'pending')}
         == {k: v for k, v in journal.items() if k not in ('generation', 'pending')}, 'planner altered more than occupancy')
    need(new_journal['operations'][OP]['result'] == RESULT, 'UNKNOWN record must stay unknown')
    return dict(after={'journal': encode(new_journal, journal_ascii)},
                parsed=dict(journal=journal, policy=policy), new=dict(journal=new_journal))


def quiescent(predicted=None):
    """The admission tool's own quiescent(): same function, read-only (slot lock flock replaced by the no-open /proc/locks check).
    predicted=<journal> evaluates it as if slot2.json were that journal (dry only; nothing is written)."""
    import owner_package_admission as O
    real_free, real_journal = R.free_lock, R.journal
    R.free_lock = lambda path: lock_unheld(pathlib.Path(path))
    if predicted is not None:
        R.journal = lambda slot: predicted if slot == 'slot2' else real_journal(slot)
    try:
        O.quiescent(C)
    finally:
        R.free_lock, R.journal = real_free, real_journal
    return True


def postconditions(before, after_shas, slots_before, manifest0, policy_active):
    """Everything provable while the controller lock is held."""
    for name in WRITE_ORDER:
        path, uid, gid, mode, _ = FILES[name]
        need(sha(path) == after_shas[name], 'post-write sha mismatch ' + name)
        need(meta(path) == dict(mode=mode, uid=uid, gid=gid), 'post-write owner/mode mismatch ' + name)
    j = R.journal('slot2')  # the receiver's own strict loader
    need(j == before['new']['journal'] and j['generation'] == AFTER_GENERATION['slot2'] and j['pending'] is None, 'journal not the planned state')
    need(digest(j['operations'][OP]) == OPHASH and j['operations'][OP]['result'] == RESULT, 'UNKNOWN operation record changed')
    need(j['operations'] == before['parsed']['journal']['operations'], 'operations changed')
    now = live_slots(None)
    need(now['slot1'] == slots_before['slot1'], 'slot1 changed')
    need(now['slot2']['generation'] == AFTER_GENERATION['slot2'] and now['slot2']['checkpoint'] == slots_before['slot2']['checkpoint'],
         'slot2 observed state wrong')
    need(state_manifest() == expected_manifest(manifest0, after_shas), 'protected state manifest changed beyond slot2.json')
    proof()  # re-prove phases, process death and unchanged worktree after every write window
    if policy_active:
        need(R.read(R.POLICY, 0).get('mode') == 'active', 'policy not active')
    quiescent()
    return now


def preflight_static():
    need(not os.path.lexists(J) and not os.path.lexists(BK), 'existing guarded transaction')
    for name, (path, *_rest) in FILES.items():
        need(not os.path.lexists(path.with_name('.' + path.name + '.rec116'))
             and not os.path.lexists(path.with_name('.' + path.name + '.' + str(os.getpid()))), 'stale temporary')
    for path in (R.STATE, R.STATE / 'controller.lock', F_JOURNAL, R.POLICY, R.AUTONOMY / 'slots'):  # EVID is owned by the slot UID: read via regular_bytes (no-symlink fd walk) + sha pins
        R.trusted_tree(path)
    live = read_live()
    checkpoint, _parked = R.checkpoint('slot2')
    planned = plan(live, checkpoint)
    planned['evidence'] = proof()
    return live, planned


def preflight_slots():
    slots = live_slots(OP)
    need(slots['slot2']['generation'] == GENERATION['slot2'], 'slot2 generation drift')
    need(slots['slot1']['checkpoint'][0]['active'] is None and slots['slot2']['checkpoint'][0] == CHECKPOINT, 'slot checkpoint occupied')
    return slots


def preflight():
    live, planned = preflight_static()
    return live, planned, preflight_slots()


def dry():
    """Diagnostic dry run: every precondition is evaluated and reported separately; nothing is written. Status is DRY_RUN_PASS only
    if ALL pass, otherwise DRY_RUN_REFUSED (exit 1) with the reasons. apply() stays strict (single preflight, no tolerance)."""
    lock_unheld(R.STATE / 'controller.lock')
    checks = {}

    def attempt(name, fn):
        try:
            value = fn()
            checks[name] = 'PASS'
            return value
        except Refused as error:
            checks[name] = 'REFUSED(' + str(error) + ')'
        except Exception as error:  # a crash is a refusal too, never a pass
            checks[name] = 'REFUSED(' + type(error).__name__ + ')'
        return None

    static = attempt('pins_policy_op_checkpoint_evidence_proof', preflight_static)
    slots = attempt('slots_idle_units_masked_no_model_procs_locks_free', preflight_slots)
    manifest = attempt('state_manifest_stable_two_reads', lambda: (lambda m: m if state_manifest() == m else need(False, 'unstable'))(state_manifest()))
    others = attempt('slot_uid_processes_not_model_workers', model_procs)
    attempt('quiescent_now_info_only_slot2_pending_expected_refused', quiescent)  # informational: slot2 is pending today
    if static:
        attempt('quiescent_if_applied', lambda: quiescent(predicted=static[1]['new']['journal']))
    out = dict(controller=C, operation=OP, script_sha256=bytes_sha(pathlib.Path(__file__).read_bytes()), checks=checks,
               slot_generation_after=AFTER_GENERATION, model_calls=0, protected_writes=0)
    if static:
        live, planned = static
        after = {n: bytes_sha(raw) for n, raw in planned['after'].items()}
        out.update(
            planned_writes={n: dict(path=str(FILES[n][0]), before_sha256=live[n]['sha256'], after_sha256=after[n],
                                    owner=[FILES[n][1], FILES[n][2]], mode=oct(FILES[n][3]),
                                    bytes_before=len(live[n]['raw']), bytes_after=len(planned['after'][n]))
                            for n in WRITE_ORDER},
            journal_change='generation 115->116, pending 36aec348...->None, everything else identical',
            unknown_record_after='operations[36aec348...] unchanged: status=unknown safe_release=false (consumed reservation; pre-model not_charged; no refund, no replay)',
            operations_count=len(planned['new']['journal']['operations']), evidence=planned['evidence'],
            policy=dict(path=str(R.POLICY), sha256=live['policy']['sha256'], disabled_only_for_write_window=True, restored='exact bytes/mode/owner'))
    if slots:
        out['slots_observed'] = slots
    if manifest:
        out.update(state_manifest_sha256=digest(manifest), manifest_entries=len(manifest))
    if others is not None:
        out['unrelated_slot_uid_processes'] = others
    informational = 'quiescent_now_info_only_slot2_pending_expected_refused'
    failed = {k: v for k, v in checks.items() if v != 'PASS' and k != informational}
    out['status'] = 'DRY_RUN_PASS' if not failed else 'DRY_RUN_REFUSED'
    if failed:
        out['refused'] = failed
    print(json.dumps(out, sort_keys=True))
    if failed:
        sys.exit(1)


def apply():
    with controller_lock():
        live, planned, slots = preflight()
        manifest = state_manifest()
        live2, planned2, slots2 = preflight()
        need(live2 == live and slots2 == slots and planned2['after'] == planned['after'] and state_manifest() == manifest,
             'pre-write live drift')
        after = {n: bytes_sha(raw) for n, raw in planned['after'].items()}
        receipt = None
        try:
            saved = backups(live)
            atomic(MANIFEST_FILE, manifest)
            receipt = dict(schema=SCHEMA, phase='backed_up', controller_sha=C, operation=OP,
                           script_sha256=bytes_sha(pathlib.Path(__file__).read_bytes()), state_manifest_sha256=digest(manifest),
                           slots=slots, files=saved, after=after, evidence=planned['evidence'])
            atomic(J, receipt)
        except BaseException:
            try:
                need(all(sha(FILES[n][0]) == live[n]['sha256'] for n in FILES), 'backup-phase drift')
                need(state_manifest() == manifest and live_slots(OP) == slots, 'backup-phase state drift')
            except BaseException:
                disable()
                backup_phase_failure()
                raise
            try:
                scrub_partial_backup()
            except BaseException:
                pass
            raise
        try:
            disable()
            receipt['phase'] = 'disabled'
            atomic(J, receipt)
            for name in WRITE_ORDER:
                path, uid, gid, mode, before = FILES[name]
                need(sha(path) == before, 'pre-write drift ' + name)
                put_raw(path, planned['after'][name], uid, gid, mode)
                receipt['phase'] = 'journal_written'
                atomic(J, receipt)
            need(R.read(R.POLICY, 0) == dict(planned['parsed']['policy'], mode='disabled'), 'disabled policy drift')
            postconditions(planned, after, slots, manifest, policy_active=False)
            put_raw(R.POLICY, live['policy']['raw'], 0, 0, FILES['policy'][3])
            need(sha(R.POLICY) == FILES['policy'][4] and meta(R.POLICY) == dict(uid=0, gid=0, mode=FILES['policy'][3]), 'policy bytes/owner/mode not restored')
            now = postconditions(planned, after, slots, manifest, policy_active=True)
            receipt.update(phase='applied', slots_after=now)
            atomic(J, receipt)
            print(json.dumps(dict(status='APPLIED', operation=OP, model_calls=0, files_changed=sorted(CHANGED_KEYS.values()),
                                  after_sha256=after, policy_sha256=FILES['policy'][4],
                                  state_manifest_sha256=receipt['state_manifest_sha256']), sort_keys=True))
        except BaseException:
            try:
                restore(receipt, manifest)
                print('Apply failed; exact prior state restored, policy restored to its original bytes.', file=sys.stderr)
            except BaseException:
                manual_failure()
            raise


def rollback():
    with controller_lock():
        R.trusted_tree(J)
        receipt = R.read(J, 0, 67108864)
        manifest = check_receipt(receipt)  # read-only; a refusal here changes nothing
        policy = policy_original(receipt)
        proof()
        if receipt['phase'] == 'rolled_back':
            need(state_manifest() == manifest and sha(R.POLICY) == FILES['policy'][4], 'rolled-back state drift')
            need(all(meta(FILES[n][0]) == dict(uid=FILES[n][1], gid=FILES[n][2], mode=FILES[n][3]) for n in FILES),
                 'rolled-back owner/mode drift')
            print('ALREADY_ROLLED_BACK')
            return
        current_manifest = state_manifest()
        need(current_manifest in (manifest, expected_manifest(manifest, receipt['after'])), 'rollback protected manifest drift')
        # All refusal conditions are proven read-only first; a refusal here changes nothing and leaves the policy alone.
        need(R.journal('slot1')['pending'] is None and R.journal('slot2')['pending'] in (None, OP), 'unexpected pending operation')
        for slot, uid in SLOTS:
            lock_unheld(R.AUTONOMY / 'slots' / slot / 'worker.lock')
            lock_unheld(R.AUTONOMY / 'locks' / (slot + '.lease'))
        quiet()
        model_procs()
        for name in WRITE_ORDER:
            need(sha(FILES[name][0]) in (FILES[name][4], receipt['after'][name]),
                 'live file is neither the pre- nor the post-apply value (a later operation exists): ' + name)
        try:
            restore(receipt, manifest, policy)
        except BaseException:
            disable()
            manual_failure()
            raise
        print('ROLLBACK_PASS_PRIOR_STATE_RESTORED (slot2 is pending on the UNKNOWN operation again)')


def verify():
    R.trusted_tree(J)
    receipt = R.read(J, 0, 67108864)
    need(receipt.get('phase') == 'applied', 'apply is not complete')
    manifest = check_receipt(receipt)
    need(state_manifest() == expected_manifest(manifest, receipt['after']), 'protected state manifest drift during verify')
    need(meta(R.POLICY) == dict(uid=0, gid=0, mode=FILES['policy'][3]), 'policy owner/mode drift during verify')
    proof()
    need(sha(R.POLICY) == FILES['policy'][4], 'policy bytes differ from the original')
    before = json.loads(regular_bytes(BK / 'journal'))
    for name in WRITE_ORDER:
        path, uid, gid, mode, _ = FILES[name]
        need(sha(path) == receipt['after'][name] and meta(path) == dict(mode=mode, uid=uid, gid=gid), 'live file differs from apply: ' + name)
    j = R.journal('slot2')
    need(j['generation'] == AFTER_GENERATION['slot2'] and j['pending'] is None, 'slot2 journal not released')
    need(j['operations'] == before['operations'] and j['operations'][OP]['result'] == RESULT, 'UNKNOWN record changed')
    need({k: v for k, v in j.items() if k not in ('generation', 'pending')}
         == {k: v for k, v in before.items() if k not in ('generation', 'pending')}, 'journal changed beyond occupancy')
    for path, want in EXPECTED.items():
        need(sha(path) == want, 'immutable evidence/receipt drift: ' + path.name)
    need(R.read(R.POLICY, 0)['controller_sha'] == C, 'wrong controller')
    now = live_slots(None)
    need(now['slot1'] == receipt['slots']['slot1'], 'slot1 changed')
    need(now['slot2']['checkpoint'][0] == CHECKPOINT, 'slot2 checkpoint changed')
    quiescent()
    print('VERIFY_PASS slot2 generation 116 pending None; UNKNOWN 36aec348 still unknown/consumed; evidence+charge+reservation+budget identical; quiescent=ok')


def main():
    need(os.geteuid() == 0 and len(sys.argv) == 2 and sys.argv[1] in ('dry', 'apply', 'verify', 'rollback'),
         'usage: /usr/bin/python3 -B ' + str(SCRIPT) + ' <dry|apply|verify|rollback> (root)')
    need(pathlib.Path(__file__).absolute() == SCRIPT, 'wrong root script path')
    R.trusted_tree(SCRIPT)
    import resource
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    return {'dry': dry, 'apply': apply, 'verify': verify, 'rollback': rollback}[sys.argv[1]]()


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        print('AGY29_UNKNOWN116_REFUSED: ' + (str(error) if isinstance(error, Refused) else type(error).__name__), file=sys.stderr)
        sys.exit(1)

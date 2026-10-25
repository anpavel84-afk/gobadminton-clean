#!/usr/bin/python3
"""Scoped PR #291 (ops monitor: pma_work block, RU texts, external runs) installer. MONITOR FILES ONLY.
No model calls, no PROD, no controller policy/code change, no slot state change. Installs exactly:
  /usr/local/lib/gb-ops-monitor/web/app.js, opsmon/writer.py, opsmon/server.py (PR copy docs/ops/monitor-live/server.py.live.txt),
  /usr/local/lib/gb-actions-train/monitor_extension.js, monitor-mapping.json   (+ creates data file /var/lib/gb-ops-titles/pma_work_ru.json
  if absent), updates the 4 matching `after` hashes of the controller inventory backup.json (installer.py refuses 'installed code drift'
  otherwise), restarts gb-ops-monitor-web.service and starts gb-ops-monitor-writer.service once.
Slot/controller state manifest, the controller policy bytes and every other monitor file are asserted byte-identical before/after.
Root usage: /usr/bin/python3 -B /root/gb-ops-monitor291-scoped-install-20261024.py <dry|apply|verify|rollback>

Post-C5 inventory exception (install_c5 is already applied and is not modified here): backup.json `after`
still records /usr/local/lib/gb-actions-train/accepted-engineering-rules.md as EOM 1.3
38c34012f10974496a7d7cbc74ecacb62bf7847278e295edfeb107d69a5d1c1c while the live file is EOM 1.4
017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269. Foreign inventory checks accept that
single pinned pair (or either pin on both sides) and refuse every other mismatch, including a third sha.
This installer does not rewrite that entry or the rules file; backup/restore stays byte-exact.
A second rollback whose receipt phase is already rolled_back refuses before any write and does not
replace the receipt with rollback_failed. Any other non-rollback phase is refused the same way.
"""
import contextlib
import copy
import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import pwd
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
sys.dont_write_bytecode = True
sys.path.insert(0, '/usr/local/lib/gb-actions-train')
import receiver as R
from core import need, digest, Refused
import installer as I

PR_HEAD = '7dc38064f42c2e7b53d8436e5d81aa7cb47ac658'   # PR #291 head (base dev 4031ab9e, draft)
SRC = pathlib.Path('/root/gb-ops-monitor291-src-7dc38064')  # root 0700 dir: 5 files fetched from the immutable commit; shas pinned below
LIB = pathlib.Path('/usr/local/lib/gb-actions-train')
MON = pathlib.Path('/usr/local/lib/gb-ops-monitor')
APP = MON / 'web/app.js'
WRITER = MON / 'opsmon/writer.py'
SERVER = MON / 'opsmon/server.py'
EXT = LIB / 'monitor_extension.js'
MAP = LIB / 'monitor-mapping.json'
# name -> (target, source file name in SRC, sha before, sha after, git path at PR_HEAD)
TARGETS = {
    'app': (APP, 'app.js', 'c2d7a233ab77f10fd5795f1629814b7fee6e579d4da9968a29d982a5faf979ca',
            'ede2a37b349b523816a37afefd5ea2a53c1969c7404e2aab41923a0ce51a8a2c',
            'scripts/chatops/actions_train/monitor_payload/app.js'),
    'writer': (WRITER, 'writer.py', 'fc89ff1f9a26b565b2214f887873f4ea661c46bf86dd41daf37fe44680212158',
               '286b75f27868c05b37a275ffc0250013ea9934b60040a54c80e39f7251bcc1d4',
               'scripts/chatops/actions_train/monitor_payload/writer.py'),
    'server': (SERVER, 'server.py', '6a6c094e20b404bb09a299fc735325c385a08436877778f370f3c9394cee6ca4',
               'bbabefcaf9d5bba5e30dbfbc35ee9619849f129121c52707442cbdedf9c7ce30',
               'docs/ops/monitor-live/server.py.live.txt'),
    'extension': (EXT, 'monitor_extension.js', '35bc34203b95f48b3988f36ac1b78476c58639422abea1bb8c1168e3adc1ef20',
                  '3ebaf48e1d839ffe7aca8f8de7b2c062122bd442755201cb138dbeb673510ea3',
                  'scripts/chatops/actions_train/monitor_extension.js'),
    'mapping': (MAP, 'monitor-mapping.json', 'f12d50165bc7bea004a4dbeb058ad6a53b8e1a896c72ed5a584f67e1c7366405',
                'e0e2c9dda1a6f349568501a0f0ae4122270cda0b32687205cde3c095a9cd20e9',
                'scripts/chatops/actions_train/monitor-mapping.json'),
}
NOT_IN_INVENTORY = {'server'}   # live server.py is not controller payload; the other four are in backup.json `after`
CONTROLLER = '41e12be2d551158e97ea30eaf8e95f992f998615'   # controller_sha installed by install_c5 (C5 = #294+#297 merge) and left untouched here
CONTROLLER_C4 = '7d3d6ca0b06275e7f4c3d35700cbdf14061a4e55'   # C4: the live canary marker adapter_revision is not rewritten by install_c5
STAGE_WF = 'b9703ca27b7bb3f494f379f8e259e62a6a48bc8f5ff50c6923e1712d8899d68d'  # policy stage_workflow_sha256 after install_c5 (train-stage.yml at R5 05f06a7a, untouched)
INV_MANIFEST = '0f16f0d60e05d13fa1778f5e9220341b4f62149ddc3e99ced10235344cf21944'  # inventory `manifest` after install_c5 = manifest.json sha at C5/R5 (left unchanged)
RULES_PATH = '/usr/local/lib/gb-actions-train/accepted-engineering-rules.md'
# install_c5 replaced the live rules file and the inventory manifest, and left this one `after` entry at EOM 1.3.
RULES_INVENTORY_SHA = '38c34012f10974496a7d7cbc74ecacb62bf7847278e295edfeb107d69a5d1c1c'  # EOM 1.3 (100818 bytes); the inventory `after` value
RULES_LIVE_SHA = '017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269'  # EOM 1.4 (113203 bytes); the live file after install_c5
ROLLBACK_PHASES = ('backed_up', 'content_installed', 'restarted', 'active', 'rollback_failed')  # rolled_back is finished; a second rollback must not rewrite it
APPARMOR = pathlib.Path('/etc/apparmor.d/gb-agy-runtime')
MARKER = pathlib.Path('/etc/gobadminton-slots/antigravity-qa.json')
TITLES = pathlib.Path('/var/lib/gb-ops-titles')
PMA_FILE = TITLES / 'pma_work_ru.json'
PMA_USER = 'grokops'
SNAPSHOT = pathlib.Path('/var/lib/gb-ops-monitor/snapshot.json')
WEB_UNIT = 'gb-ops-monitor-web.service'
WRITER_UNIT = 'gb-ops-monitor-writer.service'
WRITER_ARGS = '/usr/bin/python3 -I /usr/local/lib/gb-ops-monitor/opsmon/writer.py'
PORT = 'http://127.0.0.1:18090'  # pragma: allowlist secret
J = R.STATE / 'monitor291-scoped-install.json'
BK = R.STATE / 'monitor291-scoped-backup'
J292 = R.STATE / 'agy29-nosandbox292-scoped-install.json'
J294 = R.STATE / 'agy29-nopolicy294-scoped-install.json'   # install_c5 receipt (prerequisite; replaces J292 as the active-release proof)
INV = R.STATE / 'backup.json'
SCRIPT = pathlib.Path('/root/gb-ops-monitor291-scoped-install-20261024.py')
SCHEMA = 'GB_OPS_MONITOR291_INSTALL_V1'
MANIFEST_FILE = BK / 'state-manifest.json'
MANUAL = '/usr/bin/python3 -B ' + str(SCRIPT) + ' rollback'
PROC_LOCKS = pathlib.Path('/proc/locks')
SLOTS = (('slot1', 1002), ('slot2', 978))
TELEMETRY = {R.AUTONOMY / 'outbox' / 'slot1' / 'telemetry.json', R.AUTONOMY / 'outbox' / 'slot2' / 'telemetry.json'}
REQUIRED = [
    R.STATE / 'slot1.json', R.STATE / 'slot2.json',
    R.AUTONOMY / 'slots/slot1/state.json', R.AUTONOMY / 'slots/slot2/state.json',
    MARKER, R.BUDGET, J292, J294,
]
BACKUP_PATHS = {name: v[0] for name, v in TARGETS.items()}
BACKUP_PATHS['inventory'] = INV


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


def run(argv, timeout=20, cwd=None):
    env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'}
    p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False,
                       env=env, stdin=subprocess.DEVNULL, cwd=cwd)
    need(p.returncode == 0, 'bounded OPS command failed')
    return p.stdout


def lock_unheld(path):
    """Never flock or open a slot lock for writing, even temporarily."""
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


def props(unit, names):
    out = run(['/usr/bin/systemctl', 'show', unit, '--property=' + ','.join(names)]).decode()
    return dict(line.split('=', 1) for line in out.splitlines() if '=' in line)


def live_slots():
    observed = {}
    for slot, uid in SLOTS:
        journal = R.journal(slot)
        checkpoint = R.checkpoint(slot)
        need(type(journal['generation']) is int and journal['pending'] is None, 'slot pending ' + slot)
        # Same owner-scoped discipline as #274/#269/#273/#292: Slot1 may hold only the idle #271 checkpoint; Slot2 none.
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
        p = props(unit, ('ActiveState', 'MainPID', 'UnitFileState'))
        need(p.get('ActiveState') == 'inactive' and p.get('MainPID') == '0' and p.get('UnitFileState') == 'masked',
             'slot/supervisor unit must be inactive and masked')
    need(not os.path.lexists(R.STATE / 'integration.json'), 'active integration')
    return observed


def state_manifest():
    """Content-only regular entries of slot + controller state; telemetry/own receipt/inventory/policy/lock excluded."""
    result = {}
    excluded = {J, BK, INV, R.STATE / 'controller.lock', R.POLICY} | TELEMETRY
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
        else:
            if not stat.S_ISDIR(info.st_mode):
                result[key] = [info.st_size, info.st_mode]
            if stat.S_ISDIR(info.st_mode):
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


def monitor_tree():
    """Every file under /usr/local/lib/gb-ops-monitor (except __pycache__) -> sha. No symlinks allowed."""
    result = {}

    def walk(path, key):
        info = path.lstat()
        need(not stat.S_ISLNK(info.st_mode), 'symlink in monitor tree')
        if stat.S_ISDIR(info.st_mode):
            for child in sorted(path.iterdir()):
                if child.name != '__pycache__':
                    walk(child, key + '/' + child.name)
        else:
            result[key] = sha(path)
    walk(MON, 'mon')
    return result


def expected_tree(before, after_targets=True):
    out = dict(before)
    for name, (target, _, old, new, _) in TARGETS.items():
        if target.is_relative_to(MON):
            key = 'mon/' + str(target.relative_to(MON))
            need(before.get(key) == old, 'monitor tree baseline drift')
            out[key] = new if after_targets else old
    return out


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
    """Installed fsync/rename copier; clean only our fresh partial temporary."""
    tmp = target.with_name('.' + target.name + '.install')
    need(not os.path.lexists(tmp), 'stale install temporary')
    try:
        I.put(source, target, mode)
    finally:
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
    need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == 0 and info.st_gid == 0
         and stat.S_IMODE(info.st_mode) <= 0o755, 'unsafe installed target metadata')


# ---- source / preconditions -------------------------------------------------
def source():
    R.trusted_tree(SRC)
    info = SRC.lstat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o700, 'payload dir must be root 0700')
    need(sorted(p.name for p in SRC.iterdir()) == sorted(v[1] for v in TARGETS.values()), 'payload dir content mismatch')
    files = {}
    for name, (target, fname, old, new, _) in TARGETS.items():
        R.trusted_tree(SRC / fname)
        need(sha(SRC / fname) == new, 'payload sha mismatch ' + fname)
        need(sha(target) == old, 'installed baseline mismatch ' + target.name)
        files[name] = SRC / fname
    # PR #291 is an additive patch: app.js starts with the extension; writer carries the inserted block.
    mapping = json.loads(regular_bytes(SRC / 'monitor-mapping.json'))
    writer = regular_bytes(SRC / 'writer.py').decode()
    app = regular_bytes(SRC / 'app.js').decode()
    ext = regular_bytes(SRC / 'monitor_extension.js').decode() + '\n'
    need(writer.count(mapping['writer_insert']) == 1 and
         bytes_sha(writer.replace(mapping['writer_insert'], '', 1).encode()) == mapping['writer_before_sha256'], 'writer additive patch mismatch')
    need(app.startswith(ext) and
         bytes_sha(app[len(ext):].replace(mapping['app_insert'], '', 1).encode()) == mapping['app_before_sha256'], 'app additive patch mismatch')
    return files


def apparmor_absent():
    """After host unload + install_c5 the per-binary profile is gone (file parked, not loaded); #291 must not change that."""
    need(not os.path.lexists(APPARMOR), 'gb-agy-runtime profile file reappeared')
    loaded = pathlib.Path('/sys/kernel/security/apparmor/profiles').read_text().splitlines()
    need(not any(line.startswith('gb-agy-runtime (') or line.startswith('gb-agy-runtime//') for line in loaded), 'gb-agy-runtime profile (or child) loaded')


def foreign_inventory_matches(key, value):
    """Non-target inventory `after` entry versus live bytes.

    Every entry must match, except the one post-C5 rules entry: inventory may still say
    RULES_INVENTORY_SHA while the live file is RULES_LIVE_SHA. Both sides may also be the
    same one of those two pins. A third sha, the reverse mismatch, and any other path are drift.
    """
    live = sha(pathlib.Path(key))
    if key == RULES_PATH:
        pinned = (RULES_INVENTORY_SHA, RULES_LIVE_SHA)
        if live == value:
            return live in pinned
        return value == RULES_INVENTORY_SHA and live == RULES_LIVE_SHA
    return live == value


def idle():
    policy = R.read(R.POLICY, 0)
    need(policy['mode'] == 'active' and policy['controller_sha'] == CONTROLLER
         and policy.get('stage_workflow_sha256') == STAGE_WF, 'wrong active controller (install_c5 not active?)')
    receipt = R.read(J294, 0, 67108864)
    need(receipt.get('phase') == 'active' and receipt.get('controller_sha') == CONTROLLER, 'install_c5 (#294) receipt is not active')
    observed = live_slots()
    inventory = R.read(INV, 0)
    after = inventory.get('after', {})
    need(inventory.get('manifest') == INV_MANIFEST, 'installed inventory manifest drift')
    for name, (target, _, old, new, _) in TARGETS.items():
        if name in NOT_IN_INVENTORY:
            need(str(target) not in after, 'server.py unexpectedly in inventory')
        else:
            need(after.get(str(target)) == old, 'installed inventory drift')
    for key, value in after.items():
        if key not in {str(v[0]) for v in TARGETS.values()}:
            need(foreign_inventory_matches(key, value), 'installed inventory drift')
    apparmor_absent()
    need(R.read(MARKER, 0).get('adapter_revision') in (CONTROLLER_C4, CONTROLLER), 'installed bytes drift')  # marker content is live slot state (canary phases): covered by the state manifest, not pinned
    return policy, inventory, observed


def next_inventory(old):
    inv = copy.deepcopy(old)
    for name, (target, _, _, new, _) in TARGETS.items():
        if name not in NOT_IN_INVENTORY:
            inv['after'][str(target)] = new
    need(set(inv['after']) == set(old['after']) and inv['manifest'] == old['manifest'], 'inventory membership changed')
    return inv


def units_ok():
    web = props(WEB_UNIT, ('ActiveState', 'User', 'ExecStart', 'MainPID'))
    need(web.get('ActiveState') == 'active' and web.get('User') == 'gbopsmon'
         and '/usr/local/lib/gb-ops-monitor/opsmon/server.py' in web.get('ExecStart', ''), 'web unit unexpected')
    wr = props(WRITER_UNIT, ('ExecStart', 'User', 'Type'))
    need(WRITER_ARGS in wr.get('ExecStart', '') and wr.get('User') == 'agentagency-dev', 'writer unit unexpected')
    need(props('gb-ops-monitor-writer.timer', ('ActiveState',)).get('ActiveState') == 'active', 'writer timer not active')
    return web['MainPID']


def http(path):
    return run(['/usr/bin/curl', '-q', '--silent', '--fail', '--noproxy', '*', '--max-time', '5', PORT + path], timeout=10)


def wait_web(app_sha):
    for _ in range(40):
        try:
            if http('/healthz') == b'ok\n' and bytes_sha(http('/app.js')) == app_sha:
                return True
        except Exception:
            pass
        time.sleep(0.5)
    raise Refused('web service did not serve the expected app.js')


def pma_bytes(now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    data = dict(_readme='Работа вне слотов (данные для монитора). Только русский текст, без секретов, токенов, путей и содержимого слотов. '
                        'Пока список пуст: PMA добавляет сюда пункты и обновляет updated_utc.',
                updated_utc=now.replace(microsecond=0).isoformat(), items=[])
    raw = (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode()
    need(len(raw) <= 65536, 'pma_work file too large')
    return raw


def pma_state():
    """None if absent; else sha. Never follows links; raises if something unsafe is there."""
    if not os.path.lexists(PMA_FILE):
        return None
    return sha(PMA_FILE)


def pma_create(raw):
    """Create-only (O_EXCL|O_NOFOLLOW relative to a dir fd): the directory is owned by grokops, so never trust the path."""
    uid = pwd.getpwnam(PMA_USER).pw_uid
    fd = directory_fd(TITLES)
    try:
        info = os.fstat(fd)
        need(info.st_uid == uid and not info.st_mode & 0o022, 'titles directory owner/mode unexpected')
        f = os.open(PMA_FILE.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o644, dir_fd=fd)
        try:
            os.write(f, raw)
            os.fchown(f, uid, uid)
            os.fchmod(f, 0o644)
            os.fsync(f)
        finally:
            os.close(f)
        os.fsync(fd)
    finally:
        os.close(fd)
    need(sha(PMA_FILE) == bytes_sha(raw), 'pma_work write not exact')
    st = PMA_FILE.lstat()
    need(st.st_uid == uid and stat.S_IMODE(st.st_mode) == 0o644, 'pma_work metadata not exact')


def pma_remove(expected_sha):
    fd = directory_fd(TITLES)
    try:
        if not os.path.lexists(PMA_FILE) or sha(PMA_FILE) != expected_sha:
            return False   # absent, or edited by PMA since: never delete data we do not own
        os.unlink(PMA_FILE.name, dir_fd=fd)
        os.fsync(fd)
        return True
    finally:
        os.close(fd)


# ---- smoke: writer under UID 1002, no network, writes only a temp dir ------------------------
SMOKE_CODE = r"""
import hashlib, importlib.util, json, os, pathlib, sys
sys.dont_write_bytecode = True
MOD, WORK, EXPECT, GROKOPS = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3], int(sys.argv[4])
raw = pathlib.Path(MOD, 'writer.py').read_bytes()
assert hashlib.sha256(raw).hexdigest() == EXPECT
spec = importlib.util.spec_from_file_location('gb_writer291', pathlib.Path(MOD, 'writer.py'))
W = importlib.util.module_from_spec(spec); spec.loader.exec_module(W)
ok = lambda p: W.load_pma_work_strict(str(p), {0, GROKOPS})
good = ok(WORK / 'good.json'); assert good is not None and good['items'] == [] and good['updated'] is not None
one = ok(WORK / 'one.json'); assert one is not None and len(one['items']) == 1
view = W.pma_work_view(one, one['updated'] + 60); assert view['available'] and len(view['items']) == 1
assert ok(WORK / 'groupw.json') is None and ok(WORK / 'badenum.json') is None and ok(WORK / 'badlink.json') is None
assert ok(WORK / 'missing.json') is None and W.pma_work_view(None, 0)['available'] is False
print('SMOKE291_PASS')
"""


def smoke(module_dir, label, expect_sha):
    need(pathlib.Path('/var/tmp').is_dir(), 'missing /var/tmp')
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='gb291-smoke-', dir='/var/tmp'))
    try:
        os.chmod(tmp, 0o755)
        mod = tmp / 'mod'
        work = tmp / 'work'
        out = tmp / 'out'
        for d in (mod, work, out):
            d.mkdir(mode=0o755)
        (mod / 'writer.py').write_bytes(regular_bytes(module_dir / 'writer.py'))
        os.chmod(mod / 'writer.py', 0o644)
        (mod / 'titles_ru.json').write_bytes(regular_bytes(MON / 'opsmon/titles_ru.json'))  # writer default fallback titles
        os.chmod(mod / 'titles_ru.json', 0o644)
        now = '2026-10-24T21:00:00+00:00'
        item = dict(id='pma-291', title_ru='Проверка', kind='установка', status='идёт', updated_utc=now)
        fixtures = {'good.json': json.loads(pma_bytes()), 'one.json': dict(items=[item], updated_utc=now),
                    'badenum.json': dict(items=[dict(item, status='x')]),
                    'badlink.json': dict(items=[dict(item, link='https://evil.example/x')])}
        for name, value in fixtures.items():
            (work / name).write_text(json.dumps(value, ensure_ascii=False))
            os.chmod(work / name, 0o644)
        (work / 'groupw.json').write_text(json.dumps(fixtures['good.json']))
        os.chmod(work / 'groupw.json', 0o664)
        run(['/usr/bin/chown', '-R', '0:0', str(work)])
        run(['/usr/bin/chown', '1002:1002', str(out)])
        grokops = pwd.getpwnam(PMA_USER).pw_uid
        sandbox = ['/usr/bin/unshare', '-n', '/usr/bin/setpriv', '--reuid', '1002', '--regid', '1002', '--clear-groups',
                   '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'HOME=/home/agentagency-dev', 'LANG=C.UTF-8']
        res = run(sandbox + ['/usr/bin/python3', '-I', '-B', '-c', SMOKE_CODE, str(mod), str(work), expect_sha, str(grokops)],
                  timeout=60, cwd='/')
        need(b'SMOKE291_PASS' in res, 'writer loader smoke failed')
        run(sandbox + ['/usr/bin/python3', '-I', '-B', str(mod / 'writer.py'),
                       '--state-dir', '/home/agentagency-dev/.gb-autonomy-state', '--out-dir', str(out), '--no-systemd',
                       '--titles-external', '/var/lib/gb-ops-titles/titles_ru.json',
                       '--backlog-external', '/var/lib/gb-ops-titles/backlog_ru.json',
                       '--pma-work-external', str(work / 'good.json')], timeout=60, cwd='/')
        snap = json.loads(regular_bytes(out / 'snapshot.json'))
        need(isinstance(snap, dict) and len(json.dumps(snap)) <= 131072, 'smoke snapshot invalid')
        pw = snap.get('pma_work')
        need(isinstance(pw, dict) and pw.get('available') is True and pw.get('items') == [], 'smoke pma_work block missing')
        need({'external_runs', 'generated_utc'} <= set(snap), 'smoke snapshot lost keys')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return dict(smoke291='pass', target=label, uid=1002, network='unshared', model_calls=0, snapshot_keys=len(snap))


# ---- transaction -----------------------------------------------------------
def backups():
    need(not os.path.lexists(J) and not os.path.lexists(BK), 'existing guarded transaction')
    original = {}
    for name, path in BACKUP_PATHS.items():
        trusted_target(path)
        mode = stat.S_IMODE(path.stat().st_mode)
        original[name] = dict(sha256=sha(path), mode=mode)
    BK.mkdir(mode=0o700)
    for name, path in BACKUP_PATHS.items():
        put(path, BK / name, 0o600)
        need(sha(BK / name) == original[name]['sha256'] == sha(path), 'backup verification failed')
    return original


def old_values(receipt):
    need(receipt.get('schema') == SCHEMA and receipt.get('pr_head') == PR_HEAD, 'unrecognized rollback transaction')
    need(receipt.get('phase') in ROLLBACK_PHASES, 'invalid rollback phase')
    R.trusted_tree(BK)
    R.trusted_tree(MANIFEST_FILE)
    need(set(receipt['backups']) == set(BACKUP_PATHS), 'backup inventory mismatch')
    for name in BACKUP_PATHS:
        R.trusted_tree(BK / name)
        need(sha(BK / name) == receipt['backups'][name]['sha256'], 'rollback backup drift')
        need(type(receipt['backups'][name]['mode']) is int and 0 <= receipt['backups'][name]['mode'] <= 0o755,
             'unsafe restoration mode')
    for name, (_, _, old, _, _) in TARGETS.items():
        need(sha(BK / name) == old, 'wrong baseline backups')
    inventory = R.read(BK / 'inventory', 0)
    need(inventory.get('manifest') == INV_MANIFEST, 'wrong backup inventory')
    return inventory


def unchanged_foreign(receipt):
    apparmor_absent()  # marker bytes: asserted by the state manifest
    need(sha(R.POLICY) == receipt['policy_sha'], 'controller policy bytes changed')
    for key, value in R.read(INV, 0)['after'].items():
        if key not in {str(v[0]) for v in TARGETS.values()}:
            need(foreign_inventory_matches(key, value), 'controller payload drift')


def rollback_gate(receipt):
    """Refuse a rollback that must not write. Runs outside restore()'s except, so a finished
    receipt stays rolled_back and a wrong phase is not rewritten to rollback_failed.
    """
    need(isinstance(receipt, dict) and receipt.get('schema') == SCHEMA and receipt.get('pr_head') == PR_HEAD,
         'unrecognized rollback transaction')
    need(receipt.get('phase') != 'rolled_back', 'already rolled back')
    need(receipt.get('phase') in ROLLBACK_PHASES, 'invalid rollback phase')


def restart_web(app_sha):
    pid = props(WEB_UNIT, ('MainPID',))['MainPID']
    run(['/usr/bin/systemctl', 'restart', WEB_UNIT], timeout=60)
    p = props(WEB_UNIT, ('ActiveState', 'MainPID'))
    need(p['ActiveState'] == 'active' and p['MainPID'] not in ('0', pid), 'web service did not restart')
    wait_web(app_sha)


def run_writer_once():
    run(['/usr/bin/systemctl', 'start', WRITER_UNIT], timeout=40)


def restored_checks(receipt, inventory_old):
    for path in BACKUP_PATHS.values():
        trusted_target(path)
    for name, (target, _, old, _, _) in TARGETS.items():
        need(sha(target) == old and stat.S_IMODE(target.stat().st_mode) == receipt['backups'][name]['mode'], 'rollback bytes not exact')
    need(sha(INV) == receipt['backups']['inventory']['sha256'], 'rollback inventory not exact')
    need(monitor_tree() == receipt['monitor_tree'], 'monitor tree not restored')
    unchanged_foreign(receipt)
    assert_manifest(receipt)
    need(live_slots() == receipt['slots'], 'rollback live state changed')
    need(inventory_old.get('manifest') == INV_MANIFEST, 'rollback inventory manifest')


def restore(receipt):
    """Controller lock held. Restores ONLY this transaction's delta from byte backups; never touches slot/budget/history.
    Phase refusals, including a second rollback, are outside the except that records rollback_failed.
    """
    rollback_gate(receipt)
    try:
        inventory_old = old_values(receipt)
        inventory_new = next_inventory(inventory_old)
        for name, (target, _, old, new, _) in TARGETS.items():
            need(sha(target) in (old, new), 'rollback target drift ' + target.name)
        need(R.read(INV, 0) in (inventory_old, inventory_new), 'rollback inventory drift')
        for name in TARGETS:
            if sha(TARGETS[name][0]) != TARGETS[name][2]:
                put(BK / name, TARGETS[name][0], receipt['backups'][name]['mode'])
        if sha(INV) != receipt['backups']['inventory']['sha256']:
            put(BK / 'inventory', INV, receipt['backups']['inventory']['mode'])
        pma = receipt.get('pma_work', {})
        if pma.get('created'):
            receipt['pma_work']['removed'] = pma_remove(pma['sha256'])
        restored_checks(receipt, inventory_old)
        restart_web(TARGETS['app'][2])
        run_writer_once()
        receipt['phase'] = 'rolled_back'
        atomic(J, receipt)
    except BaseException:
        receipt['phase'] = 'rollback_failed'
        try:
            atomic(J, receipt)
        except BaseException:
            pass
        raise


def manual_failure():
    print('Exact restoration could not be proven. Policy/slot state were never modified by this script. Manual rollback: '
          + MANUAL + ' (byte backups: ' + str(BK) + ')', file=sys.stderr)


def preflight():
    need(not os.path.lexists(J) and not os.path.lexists(BK), 'existing guarded transaction')
    for path in (*(v[0] for v in TARGETS.values()), INV):
        need(not os.path.lexists(path.with_name('.' + path.name + '.install'))
             and not os.path.lexists(path.with_name('.' + path.name + '.' + str(os.getpid()))), 'stale installer temporary')
    for path in (R.STATE, R.STATE / 'controller.lock', R.POLICY, *BACKUP_PATHS.values()):
        R.trusted_tree(path)
    for path in BACKUP_PATHS.values():
        trusted_target(path)
    files = source()
    policy, inventory, slots = idle()
    units_ok()
    need(pma_state() is None, 'pma_work_ru.json already exists; refusing to overwrite (verify/replace by hand)')
    wait_web(TARGETS['app'][2])   # web currently serves the baseline app.js
    return files, policy, inventory, slots


def dry():
    lock_unheld(R.STATE / 'controller.lock')
    files, policy, inventory, slots = preflight()
    manifest = state_manifest()
    tree = monitor_tree()
    expected_tree(tree)
    source_smoke = smoke(SRC, 'source', TARGETS['writer'][3])
    print(json.dumps(dict(status='DRY_RUN_PASS', pr_head=PR_HEAD, targets={n: str(v[0]) for n, v in TARGETS.items()},
                          pma_work_file=str(PMA_FILE) + ' (absent; created at apply)',
                          controller_sha=policy['controller_sha'], policy_sha256=sha(R.POLICY),
                          slot_generations={s: d['generation'] for s, d in slots.items()},
                          state_manifest_sha256=digest(manifest), manifest_entries=len(manifest),
                          monitor_tree_files=len(tree), source_smoke=source_smoke, will_restart=[WEB_UNIT],
                          will_start_once=[WRITER_UNIT], model_calls=0, protected_writes=0), sort_keys=True))


def apply():
    with controller_lock():
        files, old_policy, old_inventory, slots = preflight()
        manifest = state_manifest()
        tree = monitor_tree()
        expected_tree(tree)
        policy_now, inventory_now, slots_now = idle()
        need((policy_now, inventory_now, slots_now) == (old_policy, old_inventory, slots), 'pre-write live drift')
        baseline = {name: sha(path) for name, path in BACKUP_PATHS.items()}
        policy_sha = sha(R.POLICY)
        receipt = None
        try:
            saved = backups()
            need({n: i['sha256'] for n, i in saved.items()} == baseline, 'pre-backup drift')
            atomic(MANIFEST_FILE, manifest)
            receipt = dict(schema=SCHEMA, phase='backed_up', pr_head=PR_HEAD, state_manifest_sha256=digest(manifest),
                           slots=slots, backups=saved, monitor_tree=tree, policy_sha=policy_sha,
                           targets={n: dict(before=v[2], after=v[3]) for n, v in TARGETS.items()}, pma_work=dict(created=False))
            atomic(J, receipt)
        except BaseException:
            try:
                need(all(sha(p) == baseline[n] for n, p in BACKUP_PATHS.items()), 'backup-phase drift')
                need(state_manifest() == manifest and live_slots() == slots and sha(R.POLICY) == policy_sha, 'backup-phase state drift')
                if not os.path.lexists(J) and os.path.lexists(BK):
                    R.trusted_tree(BK)
                    names = set(BACKUP_PATHS) | {MANIFEST_FILE.name}
                    entries = sorted(BK.iterdir())
                    need(all(e.name in names and stat.S_ISREG(e.lstat().st_mode) and e.lstat().st_nlink == 1 for e in entries),
                         'unexpected partial backup content')
                    for e in entries:
                        e.unlink()
                    BK.rmdir()
            except BaseException:
                print('Backup phase failed before any install write; partial backup kept for diagnosis (no receipt, nothing to roll back).',
                      file=sys.stderr)
            raise
        try:
            for name, (target, _, old, new, _) in TARGETS.items():
                need(sha(files[name]) == new and sha(target) == old, 'pre-install target drift')
            for name, (target, _, old, new, _) in TARGETS.items():
                put(files[name], target, 0o644)
                need(sha(target) == new and stat.S_IMODE(target.stat().st_mode) == 0o644, 'installed SHA drift')
            need(monitor_tree() == expected_tree(tree), 'monitor tree changed beyond targets')
            unchanged_foreign(receipt)
            receipt['phase'] = 'content_installed'
            atomic(J, receipt)
            result = smoke(MON / 'opsmon', 'installed', TARGETS['writer'][3])
            raw = pma_bytes()
            pma_create(raw)
            receipt['pma_work'] = dict(created=True, sha256=bytes_sha(raw), owner=PMA_USER, mode=0o644)
            atomic(J, receipt)
            assert_manifest(receipt)
            need(live_slots() == slots, 'post-install generation/pending/checkpoint drift')
            restart_web(TARGETS['app'][3])
            receipt['phase'] = 'restarted'
            atomic(J, receipt)
            run_writer_once()
            snap = json.loads(regular_bytes(SNAPSHOT))
            pw = snap.get('pma_work')
            need(isinstance(pw, dict) and pw.get('available') is True, 'live snapshot has no valid pma_work block')
            inventory = next_inventory(old_inventory)
            atomic(INV, inventory, mode=receipt['backups']['inventory']['mode'])
            unchanged_foreign(receipt)
            assert_manifest(receipt)
            need(live_slots() == slots and sha(R.POLICY) == policy_sha, 'final state drift')
            need(bytes_sha(http('/app.js')) == TARGETS['app'][3], 'web serves wrong app.js')
            receipt.update(phase='active', smoke=result, inventory_after_sha=sha(INV))
            atomic(J, receipt)
            print(json.dumps(dict(status='ACTIVE', pr_head=PR_HEAD, model_calls=0,
                                  state_manifest_sha256=receipt['state_manifest_sha256'], policy_sha256=policy_sha), sort_keys=True))
        except BaseException:
            try:
                restore(receipt)
                print('Apply failed; exact prior monitor files/inventory restored, web restarted.', file=sys.stderr)
            except BaseException:
                manual_failure()
            raise


def rollback():
    with controller_lock():
        R.trusted_tree(J)
        receipt = R.read(J, 0, 67108864)
        rollback_gate(receipt)  # already rolled_back / wrong phase: no write, no manual_failure
        try:
            assert_manifest(receipt)
            need(live_slots() == receipt['slots'], 'rollback slot state changed')
            restore(receipt)
        except BaseException:
            manual_failure()
            raise
        print('ROLLBACK_PASS_MONITOR_BASELINE_RESTORED_STATE_UNCHANGED')


def verify():
    """Read-only: no restart, no write."""
    R.trusted_tree(J)
    receipt = R.read(J, 0, 67108864)
    inventory_old = old_values(receipt)
    need(receipt['phase'] == 'active', 'install is not active')
    for name, (target, _, _, new, _) in TARGETS.items():
        need(sha(target) == new, 'postflight target drift ' + target.name)
    need(monitor_tree() == expected_tree(receipt['monitor_tree']), 'postflight monitor tree drift')
    need(R.read(INV, 0) == next_inventory(inventory_old) and sha(INV) == receipt['inventory_after_sha'], 'postflight inventory drift')
    unchanged_foreign(receipt)
    assert_manifest(receipt)
    need(live_slots() == receipt['slots'], 'postflight slot state drift')
    need(R.read(R.POLICY, 0)['controller_sha'] == CONTROLLER, 'policy drift')
    need(bytes_sha(http('/app.js')) == TARGETS['app'][3] and http('/healthz') == b'ok\n', 'web serves wrong app.js')
    need(json.loads(regular_bytes(SNAPSHOT)).get('pma_work', {}).get('available') is True, 'snapshot pma_work missing')
    pma = receipt['pma_work']
    need(not pma.get('created') or os.path.lexists(PMA_FILE), 'pma_work file missing')  # PMA may edit it later; content is not pinned
    print('POSTFLIGHT_PASS')


def main():
    need(os.geteuid() == 0 and len(sys.argv) == 2 and sys.argv[1] in ('dry', 'apply', 'verify', 'rollback'),
         'usage: /usr/bin/python3 -B ' + str(SCRIPT) + ' <dry|apply|verify|rollback> (root)')
    need(pathlib.Path(__file__).absolute() == SCRIPT, 'wrong root installer path')
    R.trusted_tree(SCRIPT)
    import resource
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    return {'dry': dry, 'apply': apply, 'verify': verify, 'rollback': rollback}[sys.argv[1]]()


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        print('INSTALL291_REFUSED: ' + (str(error) if isinstance(error, Refused) else type(error).__name__), file=sys.stderr)
        sys.exit(1)

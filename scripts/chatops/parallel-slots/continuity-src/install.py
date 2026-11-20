"""OPS #155 installer controller. Embedded verbatim by build_installer.py; stdlib only.

No environment path overrides or test switches in the CLI. Tests inject a disposable filesystem
and a simulated systemd backend into Installer; main always uses the fixed live paths below.
"""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import signal
import stat
import subprocess
import sys
import tempfile
import time
import zlib

UNITS = ('gobadminton-supervisor.service', 'gobadminton-slot@slot1.service',
         'gobadminton-slot@slot2.service')
CODE = Path('/usr/local/lib/gobadminton-slots')
MONITOR = Path('/usr/local/lib/gb-ops-monitor')
POLICY = Path('/etc/gobadminton-slots/continuity.json')
BACKUP = Path('/var/lib/gobadminton-slots-continuity')
LOCK = Path('/run/gobadminton-slots-continuity.lock')
STATE = Path('/var/lib/gobadminton-autonomy/slots')
POLICY_VALUE = dict(schema='GB_SLOT_CONTINUITY_V1', enabled=True, max_attempts=3,
                    max_integrations=3, read_backoff_seconds=240)
PENDING_VALUE = {'schema': 'GB_CONTINUITY_PENDING_V1'}
PENDING_RAW = (json.dumps(PENDING_VALUE, sort_keys=True) + '\n').encode()
# Only this independently reviewed V4 candidate may seed a fresh V5 install after
# complete removal. Its payload bytes must still verify against these exact hashes.
PRIOR_REMOVED_SHA256 = {
    'autonomous_issues.py': '9995d0f268185c56d91cd0e15f986905abf093feb07c6edffec0c9b211e2fec7',
    'slots.py': 'bf23d7f46c1bd99fe16208d3dd0d0a9c91c7c381a9d5337d175556fd996f4ef1',
    'slot_telemetry.py': '2546f8409c57bd4db25af895518ed77ff46ac21a9e80af10d4bb977945687229',
    'writer.py': '957ebb3fb201efea31c7f29aa174bf142466c09e3222c03e5880b3467a14bc24',
    'app.js': 'b8d617d74d3b707cd459c305b90054b5ab263c0f8184bc877c943730bbd13f3b',
    'continuity.json': '1587e5881d6ef6429d29f3f033aff330faf0dd40ec11f83bfc20ba7e861bce6c',
}
STOP_TIMEOUT = 30
STOP_POLL = 0.25
STOPPING_SUBSTATES = ('stop', 'stop-sigterm', 'stop-post', 'final-sigterm')


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unique(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, 'duplicate JSON key')
        value[key] = item
    return value


def decode(raw):
    return json.loads(raw, object_pairs_hook=unique)


STYLE_GUIDE = Path('/opt/gobadminton-clean-qa/style-guide')
STYLE_PINS = {'src/App.tsx': '04187d4d7d70c8c61e9ca2f08b6b6325a98539a3ec90c711c48ab771f675b61c',
              'src/index.css': 'f660e31973a6142784308f22728c751d7bb7432fb2ac0136bac032dbc6b1db2a'}


def validate_style_guide():
    """Grant only the frozen public tree, never a symlink into private sibling data."""
    for path in (*reversed(STYLE_GUIDE.parents), STYLE_GUIDE):
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                'untrusted Style Guide directory')
    require((STYLE_GUIDE / 'refs').is_dir(), 'missing Style Guide refs')
    for path in STYLE_GUIDE.rglob('*'):
        info = path.lstat()
        directory = stat.S_ISDIR(info.st_mode)
        require(info.st_uid == 0 and not info.st_mode & 0o7022
                and (directory or stat.S_ISREG(info.st_mode) and info.st_nlink == 1)
                and info.st_mode & (0o005 if directory else 0o004) == (0o005 if directory else 0o004),
                'non-public or untrusted Style Guide entry')
    for name, expected in STYLE_PINS.items():
        fd = os.open(STYLE_GUIDE / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            raw = os.read(fd, 2 * 1024 * 1024 + 1)
            require(len(raw) <= 2 * 1024 * 1024 and hashlib.sha256(raw).hexdigest() == expected,
                    'frozen Style Guide checksum mismatch')
        finally:
            os.close(fd)


class System:
    def command(self, verb, *units):
        require(verb in ('freeze', 'thaw', 'stop', 'start') and set(units) <= set(UNITS),
                'unmanaged service action')
        subprocess.run(['/usr/bin/systemctl', verb, *units], check=True, timeout=60,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def status(self, unit):
        require(unit in UNITS, 'unmanaged unit')
        result = subprocess.run(['/usr/bin/systemctl', 'show', unit,
            '--property=LoadState,UnitFileState,ActiveState,SubState,MainPID,KillMode,ControlGroup,FreezerState'],
            check=True, capture_output=True, text=True, timeout=15)
        value = dict(line.split('=', 1) for line in result.stdout.splitlines())
        # Parse structural properties here; Installer decides which runtime states an
        # install or recovery operation may reconcile after inspecting the cgroup.
        require(value.get('LoadState') == 'loaded' and value.get('KillMode') == 'control-group'
                and value.get('UnitFileState') in ('enabled', 'disabled', 'static')
                and value.get('ActiveState') and value.get('SubState')
                and value.get('MainPID', '').isascii() and value['MainPID'].isdecimal(),
                'unsupported/busy unit: ' + unit)
        require(value.get('FreezerState') in ('running', 'frozen'), 'unknown freezer state')
        return value

    def pids(self, status, *, stopping=False):
        group = status.get('ControlGroup', '')
        quiescent = ((status['ActiveState'], status['SubState']) in (
            ('inactive', 'dead'), ('failed', 'failed')) or stopping
            and status['ActiveState'] == 'deactivating' and status['SubState'] in STOPPING_SUBSTATES
            ) and status['MainPID'] == '0'
        if not group:
            require(quiescent, 'active unit without cgroup')
            return set()
        require(group.startswith('/') and '..' not in group.split('/'), 'invalid cgroup')
        path = Path('/sys/fs/cgroup') / group[1:]
        require(path == path.resolve(), 'symlink cgroup')
        if not path.exists():
            require(quiescent, 'missing active cgroup')
            return set()
        return {int(pid) for file in path.rglob('cgroup.procs') for pid in file.read_text().split()}


class Installer:
    def __init__(self, payloads, system=None, code=CODE, policy=POLICY, backup=BACKUP,
                 lock=LOCK, state=STATE, monitor=MONITOR):
        self.system = system or System()
        self.code, self.policy, self.backup = Path(code), Path(policy), Path(backup)
        self.lock, self.state = Path(lock), Path(state)
        self.pending = self.policy.with_name('continuity.pending')
        # Gate first on upgrade; remove/restore originals in reverse order so an old
        # executor importing the new Runtime is also held during a partial switch.
        self.paths = [self.code / 'slots.py', self.code / 'autonomous_issues.py',
                      Path(monitor) / 'opsmon/slot_telemetry.py', Path(monitor) / 'opsmon/writer.py',
                      Path(monitor) / 'web/app.js', self.policy]
        self.payloads = payloads
        self.new = {}
        for name in (p.name for p in self.paths if p != self.policy):
            item = payloads[name]
            raw = zlib.decompress(base64.b64decode(item['data'], validate=True))
            require(digest(raw) == item['new'], 'payload checksum mismatch')
            if name.endswith('.py'):
                compile(raw, name, 'exec')
            self.new[name] = raw
        self.new['continuity.json'] = (json.dumps(POLICY_VALUE, sort_keys=True) + '\n').encode()
        self.disabled = (json.dumps(POLICY_VALUE | {'enabled': False}, sort_keys=True) + '\n').encode()

    def parents(self, path):
        require(path.is_absolute(), 'absolute path required')
        for parent in reversed(path.parents):
            info = parent.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                    'untrusted parent: ' + str(parent))

    def read(self, path, *, optional=False, private=False, owner=0):
        # fstat pins the inode actually read. Trusted non-writable parents prevent replacement races.
        self.parents(path)
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            require(optional, 'missing file: ' + path.name)
            return None
        try:
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == owner
                    and not info.st_mode & 0o7000
                    and not info.st_mode & (0o077 if private else 0o022), 'untrusted file: ' + path.name)
            raw = os.read(fd, 4 * 1024 * 1024 + 1)
            require(len(raw) <= 4 * 1024 * 1024, 'oversize file: ' + path.name)
            return dict(data=base64.b64encode(raw).decode(), sha256=digest(raw),
                        mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
        finally:
            os.close(fd)

    def write(self, path, record):
        self.parents(path)
        if record is None:
            if os.path.lexists(path):
                self.read(path)  # refuse a substituted link/file before unlink
                path.unlink()
        else:
            raw = base64.b64decode(record['data'], validate=True)
            require(digest(raw) == record['sha256'], 'backup checksum mismatch')
            if os.path.lexists(path):
                self.read(path)
            fd, temp = tempfile.mkstemp(prefix='.continuity-', dir=path.parent)
            try:
                with os.fdopen(fd, 'wb') as stream:
                    os.fchmod(stream.fileno(), record['mode'])
                    os.fchown(stream.fileno(), record['uid'], record['gid'])
                    stream.write(raw)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temp, path)
            finally:
                if os.path.lexists(temp):
                    os.unlink(temp)
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    @staticmethod
    def record(raw, mode=0o644, *, gid=0):
        return dict(data=base64.b64encode(raw).decode(), sha256=digest(raw), mode=mode, uid=0, gid=gid)

    def safe_slots(self, *, original=False):
        for name, user in (('slot1', 'agentagency-dev'), ('slot2', 'gb-slot2')):
            directory = self.state / name
            self.parents(directory)
            uid = pwd.getpwnam(user).pw_uid
            info = directory.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == uid and not info.st_mode & 0o077,
                    'unsafe slot state directory')
            # Slot-owned leaf directory is deliberately not a trusted managed-code parent.
            path = directory / 'state.json'
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                info = os.fstat(fd)
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == uid
                        and not info.st_mode & 0o077, 'unsafe slot checkpoint')
                raw = os.read(fd, 2 * 1024 * 1024 + 1)
                require(len(raw) <= 2 * 1024 * 1024, 'oversize checkpoint')
                value = decode(raw)
            finally:
                os.close(fd)
            require(set(value) == {'active', 'done'} and isinstance(value['done'], list), 'invalid checkpoint')
            active = value['active']
            require(active is None or isinstance(active, dict) and active.get('phase') in
                    ('blocked', 'done', 'candidate', 'pr_wait', 'ci'),
                    'active author/QA/claim/integration/deploy; installation refused')
            if original:
                # The pinned runtime ignores this archive entirely: retaining the bytes alone
                # would allow policy-deferred tasks to be admitted again after rollback.
                deferred = directory / 'deferred.json'
                try:
                    fd = os.open(deferred, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                except FileNotFoundError:
                    pass
                else:
                    try:
                        info = os.fstat(fd)
                        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == uid
                                and not info.st_mode & 0o077, 'unsafe deferred checkpoint')
                        raw = os.read(fd, 2 * 1024 * 1024 + 1)
                        require(len(raw) <= 2 * 1024 * 1024, 'oversize deferred checkpoint')
                        deferred_value = decode(raw)
                    finally:
                        os.close(fd)
                    require(set(deferred_value) == {'deferred'} and deferred_value['deferred'] == [],
                            'original runtime ignores policy deferrals; reconciliation required before rollback')
                # Original Store requires a real integer park_comment. Executor policy records
                # live separately; neither path is ever rewritten by this installer.
                try:
                    fd = os.open(directory / 'parked.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                except FileNotFoundError:
                    continue
                try:
                    info = os.fstat(fd)
                    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == uid
                            and not info.st_mode & 0o077, 'unsafe parked checkpoint')
                    raw = os.read(fd, 2 * 1024 * 1024 + 1)
                    require(len(raw) <= 2 * 1024 * 1024, 'oversize parked checkpoint')
                    value = decode(raw)
                finally:
                    os.close(fd)
                require(set(value) == {'parked'} and isinstance(value['parked'], list)
                        and all(isinstance(e, dict) and type(e.get('park_comment')) is int
                                for e in value['parked']),
                        'original Store cannot read parked state; refused without checkpoint edits')

    @staticmethod
    def unit_state(value, unit, *, recovery=False):
        allowed = {('active', 'running'), ('inactive', 'dead')}
        if recovery:
            allowed.add(('failed', 'failed'))
        require((value['ActiveState'], value['SubState']) in allowed, 'unsupported/busy unit: ' + unit)
        require(int(value['MainPID']) > 0 if value['ActiveState'] == 'active'
                else value['MainPID'] == '0', 'invalid unit MainPID')

    def statuses(self, *, stopped=False, frozen=False, recovery=False):
        result = {}
        for unit in UNITS:
            value = self.system.status(unit)
            self.unit_state(value, unit, recovery=recovery)
            pids = self.system.pids(value)
            if stopped:
                require(value['ActiveState'] != 'active' and value['MainPID'] == '0' and not pids,
                        'control group not quiescent: ' + unit)
            else:
                allowed = {int(value['MainPID'])} if value['ActiveState'] == 'active' else set()
                require(pids == allowed, 'unit has active children or unknown processes: ' + unit)
                require(value['FreezerState'] in ('running', 'frozen')
                        if recovery and (not frozen or not allowed) else
                        value['FreezerState'] == ('frozen' if frozen and allowed else 'running'),
                        'unexpected freezer state: ' + unit)
            result[unit] = value
        return result

    def wait_stopped(self, stopping, *, recovery=False):
        # Called ONLY after our own controlled stop. Entry/recovery checks remain
        # strict. Poll read-only; never stop again, kill a child or force a thaw.
        deadline = time.monotonic() + STOP_TIMEOUT
        while True:
            require(time.monotonic() < deadline, 'stop deadline exceeded; units did not settle')
            settled = True
            for unit in UNITS:
                value = self.system.status(unit)
                require(time.monotonic() <= deadline, 'stop deadline exceeded: ' + unit)
                require(value['UnitFileState'] == stopping[unit]['UnitFileState'],
                        'unit enabled state changed')
                transitional = value['ActiveState'] == 'deactivating'
                if transitional:
                    require(value['SubState'] in STOPPING_SUBSTATES,
                            'unsupported stopping state: ' + unit)
                    require(value['ControlGroup'] == stopping[unit]['ControlGroup']
                            or value['ControlGroup'] == '' and value['MainPID'] == '0',
                            'unit cgroup changed while stopping: ' + unit)
                # systemd may clear ControlGroup before SubState settles. Still inspect
                # the previously bound cgroup and every descendant, even if now absent.
                pids = self.system.pids(value | {'ControlGroup': value['ControlGroup']
                                        or stopping[unit]['ControlGroup']}, stopping=transitional)
                if transitional:
                    allowed = {int(stopping[unit]['MainPID'])} if int(stopping[unit]['MainPID']) else set()
                    require(value['MainPID'] in ('0', stopping[unit]['MainPID'])
                            and pids <= allowed, 'unknown process while stopping: ' + unit)
                    settled = False
                else:
                    # A service we explicitly stopped may settle as failed/failed when
                    # its Python process exits 143 under Restart=on-failure. Accept
                    # only a quiescent PID0/empty cgroup; initial checks remain strict.
                    self.unit_state(value, unit, recovery=True)
                    require(value['ActiveState'] != 'active' and value['MainPID'] == '0' and not pids,
                            'control group not quiescent: ' + unit)
                    if value['ControlGroup'] != stopping[unit]['ControlGroup']:
                        require(not self.system.pids(value | {'ControlGroup': stopping[unit]['ControlGroup']}),
                                'previous control group not quiescent: ' + unit)
            require(time.monotonic() <= deadline, 'stop deadline exceeded; units did not settle')
            if settled:
                return
            time.sleep(min(STOP_POLL, max(0, deadline - time.monotonic())))

    def restore_units(self, states, *, recovery=False):
        errors = []
        for unit in UNITS:
            try:
                current = self.system.status(unit)
                # Only reached after this installer's controlled stop. A stopped
                # service can be failed/failed with no processes; it may be started
                # from that state without weakening entry or completion gates.
                self.unit_state(current, unit, recovery=True)
                require(current['UnitFileState'] == states[unit]['UnitFileState'], 'unit enabled state changed')
                if current['ActiveState'] == 'failed':
                    require(not self.system.pids(current), 'control group not quiescent: ' + unit)
                if current['FreezerState'] == 'frozen':
                    self.system.command('thaw', unit)
                wanted = states[unit]['ActiveState']
                # A failed prior state in a recovery operation promises quiescence, not a
                # reproducible service failure. Never start it merely to recreate "failed".
                if current['ActiveState'] != wanted and not (
                        wanted == 'failed' and current['ActiveState'] == 'inactive'):
                    if current['ActiveState'] == 'active':
                        require(self.system.pids(current) == {int(current['MainPID'])},
                                'unit has active children or unknown processes: ' + unit)
                    self.system.command('start' if wanted == 'active' else 'stop', unit)
            except BaseException as error:
                if not recovery:
                    raise
                errors.append(error)
        for unit in UNITS:
            try:
                value = self.system.status(unit)
                self.unit_state(value, unit, recovery=recovery)
                wanted = states[unit]['ActiveState']
                require((value['ActiveState'] == wanted or wanted == 'failed'
                         and value['ActiveState'] == 'inactive')
                        and value['UnitFileState'] == states[unit]['UnitFileState']
                        and value['FreezerState'] == 'running', 'unit restoration failed')
                if value['ActiveState'] == 'failed':
                    require(not self.system.pids(value), 'control group not quiescent: ' + unit)
            except BaseException as error:
                if not recovery:
                    raise
                errors.append(error)
        if errors:
            raise errors[0]

    def journal(self, value):
        self.write(self.backup / 'managed.json', self.record(
            (json.dumps(value, sort_keys=True) + '\n').encode(), 0o600))

    def validate_manifest(self, saved):
        require(isinstance(saved, dict) and set(saved) == {'schema', 'phase', 'old', 'new', 'units'}
                and saved['schema'] == 'GB_CONTINUITY_INSTALL_V1'
                and saved['phase'] in ('prepared', 'installed', 'removed'), 'invalid backup manifest')
        require(all(isinstance(saved[key], dict) for key in ('old', 'new', 'units'))
                and set(saved['old']) == set(saved['new']) == {p.name for p in self.paths}
                and set(saved['units']) == set(UNITS), 'backup manifest binding mismatch')
        for path in self.paths:
            for record in (saved['new'][path.name], saved['old'][path.name]):
                if record is None:
                    continue
                require(isinstance(record, dict) and set(record) == {'data', 'sha256', 'mode', 'uid', 'gid'}
                        and type(record['uid']) is int and record['uid'] == 0,
                        'invalid backup record binding')
                raw = base64.b64decode(record['data'], validate=True)
                require(type(record['mode']) is int and 0 <= record['mode'] <= 0o777
                        and not record['mode'] & 0o022
                        and type(record['gid']) is int and record['gid'] >= 0
                        and record == self.record(raw, record['mode'], gid=record['gid']),
                        'invalid backup metadata/checksum')
            require(saved['new'][path.name] is not None, 'missing candidate backup')
            old = saved['old'][path.name]
            if path != self.policy:
                require(old and old['sha256'] == self.payloads[path.name]['old'], 'unrecognized backup code')
            elif old:
                require(base64.b64decode(old['data']) == self.disabled, 'unrecognized backup policy')
        for unit, value in saved['units'].items():
            require(isinstance(value, dict) and set(value) == {'LoadState', 'UnitFileState', 'ActiveState', 'SubState', 'MainPID',
                                   'KillMode', 'ControlGroup', 'FreezerState'}
                    and value['LoadState'] == 'loaded' and value['KillMode'] == 'control-group'
                    and value['UnitFileState'] in ('enabled', 'disabled', 'static')
                    and isinstance(value['MainPID'], str) and value['MainPID'].isascii()
                    and value['MainPID'].isdecimal() and value['FreezerState'] == 'running'
                    and isinstance(value['ControlGroup'], str), 'invalid backup unit state')
            self.unit_state(value, unit)
        hashes = {name: record['sha256'] for name, record in saved['new'].items()}
        current = {name: digest(raw) for name, raw in self.new.items()}
        require(hashes in (current, PRIOR_REMOVED_SHA256),
                'backup belongs to an unrecognized installer; use its reviewed recovery installer')
        return hashes != current

    def barrier(self):
        value = self.read(self.pending, optional=True)
        require(value is None or value == self.record(PENDING_RAW), 'invalid deployment barrier')
        return value

    def activate(self):
        # Unlink is the point of no return: a worker may observe it immediately.
        # Block catchable termination through directory fsync. Any I/O uncertainty or
        # pending signal escapes WITHOUT rollback, including a failure after unlink.
        numbers = (signal.SIGHUP, signal.SIGINT, signal.SIGTERM)
        previous = signal.pthread_sigmask(signal.SIG_BLOCK, numbers)
        try:
            require(self.barrier() is not None, 'missing deployment barrier at commit')
            self.write(self.pending, None)
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous)

    def apply(self, *, remove=False, dry=False):
        for path in self.paths:
            self.parents(path)
        self.parents(self.pending)
        self.parents(self.backup)
        self.parents(self.lock)
        lock_fd = None
        try:
            if not dry:
                lock_fd = os.open(self.lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
                info = os.fstat(lock_fd)
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == 0
                        and not info.st_mode & 0o077, 'unsafe dedicated installer lock')
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return self.transaction(remove, dry)
        finally:
            if lock_fd is not None:
                os.close(lock_fd)

    def transaction(self, remove, dry):
        if not remove:
            validate_style_guide()
        pending_before = self.barrier()
        archived_prior = False
        if self.backup.exists():
            info = self.backup.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077,
                    'unsafe backup directory')
            for name in os.listdir(self.backup):
                if name == 'managed.json':
                    continue
                require(name.startswith('removed-') and name.endswith('.json'), 'unknown backup contents')
                archive = self.read(self.backup / name, private=True)
                require(name == 'removed-' + archive['sha256'] + '.json', 'audit archive checksum/name mismatch')
                archived = decode(base64.b64decode(archive['data']))
                self.validate_manifest(archived)
                require(archived['phase'] == 'removed', 'audit archive is not fully removed')
                archived_prior = True
        saved_record = self.read(self.backup / 'managed.json', optional=True, private=True) if self.backup.exists() else None
        require(saved_record is not None or not archived_prior,
                'audit archive without managed journal; manual reconciliation required')
        saved = decode(base64.b64decode(saved_record['data'])) if saved_record else None
        require(saved_record is not None or pending_before is None, 'deployment barrier without backup; refused')
        migrate = False
        if saved_record is not None:
            migrate = self.validate_manifest(saved)
            require(not migrate or saved['phase'] == 'removed' and pending_before is None and not remove,
                    'different installer journal is not an uninstalled removal; use the prior reviewed --remove')
        before = {p.name: self.read(p, optional=p == self.policy) for p in self.paths}
        for path in self.paths:
            value = before[path.name]
            if path != self.policy:
                require(value and value['sha256'] in (self.payloads[path.name]['old'],
                                                      digest(self.new[path.name])), 'unrecognized code: ' + path.name)
            else:
                require(value is None or base64.b64decode(value['data']) in
                        (self.new[path.name], self.disabled), 'unrecognized policy bytes')
        if saved and (saved['phase'] == 'prepared' or pending_before is not None):
            # A killed installer may have switched only part of the files. --remove is the
            # explicit recovery action, using only this private, bound preinstall manifest.
            require(remove, 'interrupted installation: use --remove to restore the complete backup')
            require(all(before[n] in (saved['old'][n], saved['new'][n]) for n in before),
                    'interrupted installation drift')
        elif saved:
            expected = saved['new'] if saved['phase'] == 'installed' else saved['old']
            require(before == expected, 'managed files drifted since installation/removal')
            if not remove and saved['phase'] == 'installed':
                print('Уже установлено.')
                return
        if remove:
            require(saved is not None, 'no preinstall backup; removal refused')
            target, wanted_units = saved['old'], saved['units']
        else:
            require(all(before[p.name] and before[p.name]['sha256'] == self.payloads[p.name]['old']
                        for p in self.paths if p != self.policy)
                    and (before[self.policy.name] is None or
                         base64.b64decode(before[self.policy.name]['data']) == self.disabled),
                    'installation requires exact original bytes')
            target = {p.name: self.record(self.new[p.name], before[p.name]['mode']
                                        if before[p.name] else 0o644,
                                        gid=before[p.name]['gid'] if before[p.name] else 0) for p in self.paths}
            wanted_units = None
        self.safe_slots(original=remove)
        prior = self.statuses(recovery=remove)
        if migrate:
            # A fresh snapshot preserves the current quiescent slot2, even when the
            # prior install journal recorded that unit active. Never rewrite task state.
            require(before == saved['old'], 'prior removal is not byte/metadata exact')
            require(all(prior[u]['UnitFileState'] == saved['units'][u]['UnitFileState'] for u in UNITS),
                    'enabled state changed since prior removal; refusing migration')
        wanted_units = wanted_units or prior
        require(all(prior[u]['UnitFileState'] == wanted_units[u]['UnitFileState'] for u in UNITS),
                'enabled state changed since preinstall; refusing')
        if remove and pending_before is None and saved['phase'] == 'removed' and all(
                prior[u]['ActiveState'] == wanted_units[u]['ActiveState']
                and prior[u]['FreezerState'] == 'running' for u in UNITS):
            print('Уже удалено.')
            return
        if dry:
            print('DRY PASS: проверены исходные байты, policy, состояния и cgroup; изменений нет.')
            return
        if not self.backup.exists():
            self.backup.mkdir(mode=0o700)
            directory_fd = os.open(self.backup.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        if migrate:
            archive_path = self.backup / ('removed-' + saved_record['sha256'] + '.json')
            archived_record = self.read(archive_path, optional=True, private=True)
            require(archived_record is None or archived_record == saved_record, 'audit archive drift')
            # write fsyncs the complete prior journal and directory BEFORE prepared
            # replaces managed.json. A crash here is safe to retry without any units.
            self.write(archive_path, saved_record)
            require(self.read(archive_path, private=True) == saved_record, 'audit archive verification failed')
        # The prior journal is durable in its archive. A failed migration must keep
        # the fresh V5 snapshot for recovery, including slot2's current inactive state.
        original_saved = None if migrate else saved
        manifest = saved if remove else dict(schema='GB_CONTINUITY_INSTALL_V1', phase='prepared',
                                              old=before, new=target, units=prior)
        switched = False
        try:
            if remove:
                # Removal already has a durable bound backup. Hold new entries even
                # if recovery is interrupted before changing its journal phase.
                self.write(self.pending, self.record(PENDING_RAW))
            self.journal(manifest | {'phase': 'prepared'})
            if not remove:
                self.write(self.pending, self.record(PENDING_RAW))
            for unit in UNITS:
                if prior[unit]['ActiveState'] == 'active':
                    self.system.command('freeze', unit)
            stopping = self.statuses(frozen=True, recovery=remove)
            self.safe_slots(original=remove)  # frozen processes cannot cross into a writer
            self.system.command('stop', *UNITS)
            self.wait_stopped(stopping, recovery=remove)  # all descendant cgroups must be empty
            self.safe_slots(original=remove)
            require({p.name: self.read(p, optional=p == self.policy) for p in self.paths} == before,
                    'concurrent managed-file change')
            for path in reversed(self.paths) if remove else self.paths:
                switched = True
                self.write(path, target[path.name])
            # Old code ignores the gate. Record complete removal before restarting it,
            # so persistent service failure still has an exact, recoverable file journal.
            if remove:
                self.journal(manifest | {'phase': 'removed'})
            self.restore_units(wanted_units, recovery=remove)
            if not remove:
                self.statuses()  # all intended starts healthy, still blocked and child-free
                self.journal(manifest | {'phase': 'installed'})
        except BaseException:
            for number in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
                signal.signal(number, signal.SIG_IGN)
            errors = []
            def cleanup(call):
                try:
                    call()
                except BaseException as error:
                    errors.append(type(error).__name__)
            if switched:
                # A partially successful restart may already have begun work. Never kill a
                # writer to make rollback look successful. Freeze and recheck before stopping.
                try:
                    for unit in UNITS:
                        if self.system.status(unit)['ActiveState'] == 'active':
                            self.system.command('freeze', unit)
                    current = self.statuses(frozen=True, recovery=True)
                    require(all(current[u]['UnitFileState'] == prior[u]['UnitFileState'] for u in UNITS),
                            'unit enabled state changed')
                    self.safe_slots(original=not remove)
                    self.system.command('stop', *UNITS)
                    self.wait_stopped(current, recovery=True)
                    self.safe_slots(original=not remove)
                except BaseException as error:
                    errors.append(type(error).__name__)
                    # No file restoration occurred. Unfreeze retained workers; the private
                    # complete backup stays intact for a later safe recovery.
                    for unit in UNITS:
                        cleanup(lambda unit=unit: self.system.command('thaw', unit)
                                if self.system.status(unit)['FreezerState'] == 'frozen' else None)
                else:
                    cleanup(lambda: self.journal(manifest | {'phase': 'prepared'}))
                    if not errors:
                        for path in self.paths if remove else reversed(self.paths):
                            cleanup(lambda path=path: self.write(path, before[path.name]))
                    if not errors and original_saved:
                        cleanup(lambda: self.journal(original_saved))
                    elif not errors:
                        cleanup(lambda: self.journal(manifest | {'phase': 'removed'}))
            elif not errors:
                cleanup(lambda: self.journal(original_saved or (manifest | {'phase': 'removed'})))
            # An install rollback returns ungated originals. Drop only our marker after
            # the complete file/journal restore, before restarting those originals.
            if not errors and not remove:
                cleanup(lambda: self.write(self.pending, pending_before))
            if not errors:
                cleanup(lambda: self.restore_units(prior, recovery=True))
            if not errors and remove:
                cleanup(lambda: self.write(self.pending, pending_before))
            if errors:
                raise RuntimeError('ROLLBACK INCOMPLETE; backup retained; manual reconciliation required: '
                                   + ','.join(errors)) from None
            raise
        # No fallible managed mutation or service action follows release. In particular,
        # signals, unlink/fsync uncertainty and logging errors must never roll code back
        # underneath workers that may already have crossed the barrier.
        self.activate()
        print('Удалено: восстановлены preinstall код, policy и active/enabled состояния.' if remove else
              'Установлено: bounded continuity включена только для slot-режима.')


def main(payloads):
    require(os.geteuid() == 0, 'Требуется root; DRY также проверяет доверие root-owned файлов.')
    require(sys.argv[1:] in ([], ['--remove']), 'usage: slots-continuity.sh [--remove]; DRY=1')
    os.umask(0o077)
    def interrupted(number, frame):
        raise SystemExit(128 + number)
    for number in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
        signal.signal(number, interrupted)
    Installer(payloads).apply(remove=sys.argv[1:] == ['--remove'], dry=os.environ.get('DRY') == '1')

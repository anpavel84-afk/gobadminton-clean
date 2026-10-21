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

    def pids(self, status):
        group = status.get('ControlGroup', '')
        quiescent = (status['ActiveState'], status['SubState']) in (
            ('inactive', 'dead'), ('failed', 'failed')) and status['MainPID'] == '0'
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
        self.paths = [self.code / 'autonomous_issues.py', self.code / 'slots.py',
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
                require(value['FreezerState'] == ('frozen' if frozen and allowed else 'running'),
                        'unexpected freezer state: ' + unit)
            result[unit] = value
        return result

    def restore_units(self, states, *, recovery=False):
        errors = []
        for unit in UNITS:
            try:
                current = self.system.status(unit)
                self.unit_state(current, unit, recovery=recovery)
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

    def apply(self, *, remove=False, dry=False):
        for path in self.paths:
            self.parents(path)
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
        if self.backup.exists():
            info = self.backup.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077,
                    'unsafe backup directory')
            require(set(os.listdir(self.backup)) <= {'managed.json'}, 'unknown backup contents')
        saved = self.read(self.backup / 'managed.json', optional=True, private=True) if self.backup.exists() else None
        saved = decode(base64.b64decode(saved['data'])) if saved else None
        if saved:
            require(set(saved) == {'schema', 'phase', 'old', 'new', 'units'}
                    and saved['schema'] == 'GB_CONTINUITY_INSTALL_V1'
                    and saved['phase'] in ('prepared', 'installed', 'removed'), 'invalid backup manifest')
            require(set(saved['old']) == set(saved['new']) == {p.name for p in self.paths}
                    and set(saved['units']) == set(UNITS), 'backup manifest binding mismatch')
            for path in self.paths:
                record = saved['new'][path.name]
                require(record is not None and type(record['mode']) is int
                        and 0 <= record['mode'] <= 0o777 and not record['mode'] & 0o022
                        and type(record['gid']) is int and record['gid'] >= 0
                        and record == self.record(self.new[path.name], record['mode'], gid=record['gid']),
                        'backup belongs to a different installer')
                old = saved['old'][path.name]
                if old:
                    raw = base64.b64decode(old['data'], validate=True)
                    require(old == self.record(raw, old['mode'], gid=old['gid'])
                            and 0 <= old['mode'] <= 0o777 and not old['mode'] & 0o022
                            and old['gid'] >= 0, 'invalid original metadata/checksum')
                if path != self.policy:
                    require(old and old['sha256'] == self.payloads[path.name]['old'], 'unrecognized backup code')
                elif old:
                    require(base64.b64decode(old['data']) == self.disabled, 'unrecognized backup policy')
        before = {p.name: self.read(p, optional=p == self.policy) for p in self.paths}
        for path in self.paths:
            value = before[path.name]
            if path != self.policy:
                require(value and value['sha256'] in (self.payloads[path.name]['old'],
                                                      digest(self.new[path.name])), 'unrecognized code: ' + path.name)
            else:
                require(value is None or base64.b64decode(value['data']) in
                        (self.new[path.name], self.disabled), 'unrecognized policy bytes')
        if saved and saved['phase'] == 'prepared':
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
        wanted_units = wanted_units or prior
        require(all(prior[u]['UnitFileState'] == wanted_units[u]['UnitFileState'] for u in UNITS),
                'enabled state changed since preinstall; refusing')
        if remove and saved['phase'] == 'removed' and all(
                prior[u]['ActiveState'] == wanted_units[u]['ActiveState'] for u in UNITS):
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
        original_saved = saved
        manifest = saved if remove else dict(schema='GB_CONTINUITY_INSTALL_V1', phase='prepared',
                                              old=before, new=target, units=prior)
        frozen, switched = [], False
        try:
            self.journal(manifest | {'phase': 'prepared'})
            for unit in UNITS:
                if prior[unit]['ActiveState'] == 'active':
                    frozen.append(unit)  # includes a command whose completion is uncertain
                    self.system.command('freeze', unit)
            self.statuses(frozen=True, recovery=remove)
            self.safe_slots(original=remove)  # frozen processes cannot cross into a writer
            self.system.command('stop', *UNITS)
            self.statuses(stopped=True, recovery=remove)  # all descendant cgroups must be empty
            self.safe_slots(original=remove)
            require({p.name: self.read(p, optional=p == self.policy) for p in self.paths} == before,
                    'concurrent managed-file change')
            for path in self.paths:
                switched = True
                self.write(path, target[path.name])
            # Commit the durable manifest BEFORE starting workers. A failed start restores both
            # files and the old manifest; a crash leaves a complete backup for --remove.
            self.journal(manifest | {'phase': 'removed' if remove else 'installed'})
            self.restore_units(wanted_units, recovery=remove)
            print('Удалено: восстановлены preinstall код, policy и active/enabled состояния.' if remove else
                  'Установлено: bounded continuity включена только для slot-режима.')
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
                    self.statuses(stopped=True, recovery=True)
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
                    for path in reversed(self.paths):
                        cleanup(lambda path=path: self.write(path, before[path.name]))
                    if not errors and original_saved:
                        cleanup(lambda: self.journal(original_saved))
                    elif not errors:
                        cleanup(lambda: self.journal(manifest | {'phase': 'removed'}))
            if not errors:
                cleanup(lambda: self.restore_units(prior, recovery=True))
            if errors:
                raise RuntimeError('ROLLBACK INCOMPLETE; backup retained; manual reconciliation required: '
                                   + ','.join(errors)) from None
            raise


def main(payloads):
    require(os.geteuid() == 0, 'Требуется root; DRY также проверяет доверие root-owned файлов.')
    require(sys.argv[1:] in ([], ['--remove']), 'usage: slots-continuity.sh [--remove]; DRY=1')
    os.umask(0o077)
    def interrupted(number, frame):
        raise SystemExit(128 + number)
    for number in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
        signal.signal(number, interrupted)
    Installer(payloads).apply(remove=sys.argv[1:] == ['--remove'], dry=os.environ.get('DRY') == '1')

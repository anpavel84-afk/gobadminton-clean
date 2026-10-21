"""Installer fault injection: real scratch files, simulated root metadata/systemd, no services."""
import ast
import base64
import contextlib
import copy
import hashlib
import importlib.util
import json
import multiprocessing
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import zlib

HERE = Path(__file__).resolve().parents[1] / 'parallel-slots'
SPEC = importlib.util.spec_from_file_location('continuity_installer', HERE / 'continuity-src/install.py')
i = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(i)
sys.path.insert(0, str(HERE.parent))
import slots as s
REAL_SIGNAL = signal.signal


# A real disposable process enters the production Runtime (or the pinned old
# executor importing it). Only ownership is simulated; no runtime/barrier code
# is replaced. Actual lease, task publication and budget charge follow entry.
WORKER = r'''
import importlib.util, os, sys, time
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import slots as s
root, mode = Path(sys.argv[2]), sys.argv[3]
real_lstat, real_fstat = Path.lstat, os.fstat
def owned(info):
    values = list(info); values[4:6] = [0, 0]
    return os.stat_result(values)
Path.lstat = lambda p: owned(real_lstat(p))
os.fstat = lambda fd: owned(real_fstat(fd))
s.PENDING = root / 'etc/continuity.pending'
sleep = time.sleep
announced = False
def waiting(seconds):
    global announced
    if not announced:
        print('WAIT', flush=True)
        announced = True
    sleep(seconds)
s.time.sleep = waiting
if mode == 'supervise':
    def config(path):
        (root / 'supervisor-work').write_text('scheduled/API/assignment entry')
        raise SystemExit(0)
    s.load_supervisor_config = config
    s.main(['supervise'])
    raise AssertionError('unreachable')
roots = dict(state_root=root/'worker-state', slot_root=root/'srv', config_root=root/'etc',
             trusted_assigners={0})
if mode == 'old-slot1':
    spec = importlib.util.spec_from_file_location('old_executor', sys.argv[4])
    old = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old)
    rt = old.activate_slot('slot1', **roots)
else:
    rt = s.Runtime(mode, **roots)
assert rt.registry.acquire(rt.slot, dict(issue=155, locks=['global'], allowed_paths=['apps/**']))
s.atomic(root / 'task-mutation', dict(issue=155, phase='developing'), 0o600)
rt.budget.charge(rt.slot, 'codex', 'author')
rt.registry.release()
print('RELEASED', flush=True)
'''


class FakeSystem(i.System):
    def __init__(self):
        self.events = []
        self.states = {unit: dict(LoadState='loaded', UnitFileState='enabled' if n != 2 else 'disabled',
            ActiveState='active' if n != 2 else 'inactive', SubState='running' if n != 2 else 'dead',
            MainPID=str(100 + n) if n != 2 else '0', KillMode='control-group',
            ControlGroup='/system.slice/' + unit, FreezerState='running') for n, unit in enumerate(i.UNITS)}
        self.extra = set()
        self.after = lambda event: None

    def status(self, unit):
        return dict(self.states[unit])

    def pids(self, value, *, stopping=False):
        return ({int(value['MainPID'])} if value['ActiveState'] == 'active' else set()) | self.extra

    def command(self, verb, *units):
        if verb not in ('freeze', 'thaw', 'stop', 'start') or not set(units) <= set(i.UNITS):
            raise AssertionError((verb, units))
        self.events.append((verb, units))
        for unit in units:
            value = self.states[unit]
            if verb in ('freeze', 'thaw'):
                value['FreezerState'] = 'frozen' if verb == 'freeze' else 'running'
            else:
                active = verb == 'start'
                value.update(ActiveState='active' if active else 'inactive',
                    SubState='running' if active else 'dead', FreezerState='running',
                    MainPID=str(100 + i.UNITS.index(unit)) if active else '0')
        self.after(('system', verb, units))


class MockSystemctl(FakeSystem):
    """Mock only systemctl's subprocess edge; use production status/pids and scratch cgroups."""
    def __init__(self, root):
        super().__init__()
        self.cgroups = root / 'cgroup'
        self.cgroups.mkdir()
        self.start_failures = {}
        self.failed_group = ''
        self.missing_groups = set()
        self.extra_by_unit = {}
        self.show_sequences = {}

    def run(self, argv, **kwargs):
        assert argv[0] == '/usr/bin/systemctl'
        verb = argv[1]
        if verb == 'show':
            assert len(argv) == 4 and argv[2] in i.UNITS
            assert argv[3] == ('--property=LoadState,UnitFileState,ActiveState,SubState,MainPID,'
                               'KillMode,ControlGroup,FreezerState')
            assert kwargs == dict(check=True, capture_output=True, text=True, timeout=15)
            unit = argv[2]
            sequence = self.show_sequences.get(unit, [])
            value = sequence.pop(0) if sequence else self.states[unit]
            group = value.get('ControlGroup', '')
            if group.startswith('/') and '..' not in group.split('/') and group not in self.missing_groups:
                directory = self.cgroups / group[1:]
                directory.mkdir(parents=True, exist_ok=True)
                pids = ({int(value['MainPID'])} if value.get('MainPID', '').isdecimal()
                        and int(value['MainPID']) else set()) | self.extra | self.extra_by_unit.get(unit, set())
                (directory / 'cgroup.procs').write_text('\n'.join(map(str, sorted(pids))))
            return types.SimpleNamespace(stdout=''.join(f'{key}={item}\n' for key, item in value.items()))
        assert kwargs == dict(check=True, timeout=60, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        units = tuple(argv[2:])
        if verb == 'start' and self.start_failures.get(units[0], 0):
            unit, = units
            self.start_failures[unit] -= 1  # negative means persistent failure
            self.events.append((verb, units))
            self.states[unit].update(ActiveState='failed', SubState='failed', MainPID='0',
                                     ControlGroup=self.failed_group, FreezerState='running')
            self.after(('system', verb, units))
            raise subprocess.CalledProcessError(1, argv)
        if verb in ('start', 'stop'):
            for unit in units:
                self.states[unit]['ControlGroup'] = '/system.slice/' + unit
        self.command(verb, *units)
        return types.SimpleNamespace(returncode=0)


@contextlib.contextmanager
def fake_root():
    """Preserve real types, permissions and link counts; synthesize UID/GID only, never elevate."""
    real_lstat, real_fstat = Path.lstat, os.fstat
    def root(info):
        values = list(info); values[4:6] = [0, 0]
        return os.stat_result(values)
    with patch.object(Path, 'lstat', lambda p: root(real_lstat(p))), \
            patch.object(os, 'fstat', lambda fd: root(real_fstat(fd))), \
            patch.object(os, 'fchown', lambda *args: None), \
            patch.object(i.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=0)), \
            patch.object(i.signal, 'signal'):
        yield


class InstallerTests(unittest.TestCase):
    @contextlib.contextmanager
    def fixture(self, policy=False, parsed=False):
        with tempfile.TemporaryDirectory() as tmp, fake_root(), patch.object(i, 'validate_style_guide'), \
                contextlib.ExitStack() as mocks:
            root = Path(tmp)
            for name in ('code', 'monitor/opsmon', 'monitor/web', 'etc', 'state/slot1', 'state/slot2', 'run'):
                (root / name).mkdir(parents=True, mode=0o700, exist_ok=True)
            payloads = {}
            for name in ('autonomous_issues.py', 'slots.py', 'slot_telemetry.py', 'writer.py', 'app.js'):
                old, new = ('# original ' + name + '\n').encode(), ('# reviewed ' + name + '\n').encode()
                directory = 'code' if name in ('autonomous_issues.py', 'slots.py') else 'monitor/web' if name == 'app.js' else 'monitor/opsmon'
                (root / directory / name).write_bytes(old)
                payloads[name] = dict(old=i.digest(old), new=i.digest(new),
                                      data=base64.b64encode(zlib.compress(new)).decode())
            for slot in ('slot1', 'slot2'):
                path = root / 'state' / slot / 'state.json'
                path.write_text(json.dumps(dict(active=None if slot == 'slot2' else
                    dict(phase='blocked', attempt=2, issue=151, reason='Actions failed'), done=[])))
                path.chmod(0o600)
            system = MockSystemctl(root) if parsed else FakeSystem()
            if parsed:
                mocks.enter_context(patch.object(i.subprocess, 'run', side_effect=system.run))
                def scratch_path(*args):
                    path = Path(*args)
                    return system.cgroups if path == Path('/sys/fs/cgroup') else path
                mocks.enter_context(patch.object(i, 'Path', side_effect=scratch_path))
            installer = i.Installer(payloads, i.System() if parsed else system,
                code=root / 'code', policy=root / 'etc/continuity.json',
                backup=root / 'backup', lock=root / 'run/continuity.lock', state=root / 'state', monitor=root / 'monitor')
            if policy:
                installer.policy.write_bytes(installer.disabled)
                installer.policy.chmod(0o640)
            yield root, installer, system

    def managed(self, installer):
        return {p.name: installer.read(p, optional=p == installer.policy) for p in installer.paths}

    @contextlib.contextmanager
    def removed_prior(self, policy=False):
        with self.fixture(policy, parsed=True) as (root, installer, system):
            system.states[i.UNITS[2]]['UnitFileState'] = 'enabled'
            old = self.managed(installer)
            new = {name: installer.record(raw, old[name]['mode'] if old[name] else 0o644)
                   for name, raw in installer.new.items()}
            new['slots.py'] = installer.record(b'# independently reviewed prior slots fixture\n')
            units = copy.deepcopy(system.states)
            # The operator stopped slot2 after the prior failed transaction. A fresh
            # install must preserve CURRENT quiescence, while archiving this old fact.
            units[i.UNITS[2]].update(ActiveState='active', SubState='running', MainPID='102')
            manifest = dict(schema='GB_CONTINUITY_INSTALL_V1', phase='removed', old=old, new=new, units=units)
            installer.backup.mkdir(mode=0o700)
            installer.journal(manifest)
            hashes = {name: record['sha256'] for name, record in new.items()}
            # Only payload identities are synthetic; production manifest validation,
            # file checksums, ownership/types, atomic writes and cgroup parser run.
            with patch.object(i, 'PRIOR_REMOVED_SHA256', hashes):
                yield root, installer, system, manifest

    def test_removed_prior_migration_dry_no_writes_then_archive_before_fresh_snapshot(self):
        for policy in (False, True):
            with self.subTest(policy=policy), self.removed_prior(policy) as (root, installer, system, saved):
                before, units = self.managed(installer), copy.deepcopy(system.states)
                checkpoints = {p: p.read_bytes() for p in (root/'state').rglob('*') if p.is_file()}
                journal = (installer.backup/'managed.json').read_bytes()
                archive = installer.backup / ('removed-' + i.digest(journal) + '.json')
                write = installer.write
                with patch.object(installer, 'write', side_effect=AssertionError('DRY write')):
                    installer.apply(dry=True)
                self.assertEqual(system.events, [])
                self.assertFalse(installer.lock.exists())
                self.assertEqual((installer.backup/'managed.json').read_bytes(), journal)
                self.assertFalse(archive.exists())
                writes = []
                def traced(path, record):
                    if path.name == 'managed.json':
                        self.assertEqual(archive.read_bytes(), journal)
                    write(path, record)
                    writes.append(path)
                installer.write = traced
                installer.apply()
                self.assertEqual(writes[0], archive)
                self.assertEqual(archive.read_bytes(), journal)
                current = json.loads((installer.backup/'managed.json').read_text())
                self.assertEqual(current['old'], before)
                self.assertEqual(current['units'], units)
                self.assertNotEqual(current['units'], saved['units'])
                self.assertEqual(system.states, units)
                self.assertNotIn(('start', (i.UNITS[2],)), system.events)
                self.assertEqual({p: p.read_bytes() for p in checkpoints}, checkpoints)
                installer.write = write
                installer.apply(remove=True)
                self.assert_restored(installer, system, before, units)
                self.assertEqual(archive.read_bytes(), journal)

    def test_removed_prior_migration_rejects_pending_unremoved_mixed_drift_and_bad_digests(self):
        for mode in ('prepared', 'installed', 'pending', 'old-checksum', 'old-metadata', 'new-checksum',
                     'unknown-candidate', 'current-drift', 'mixed', 'enabled', 'children', 'writer', 'archive',
                     'empty-manifest', 'null-manifest', 'missing-old-digest', 'missing-new-digest', 'bad-units',
                     'missing-managed'):
            with self.subTest(mode=mode), self.removed_prior() as (root, installer, system, saved):
                if mode in ('prepared', 'installed'):
                    saved['phase'] = mode
                elif mode == 'pending':
                    installer.write(installer.pending, installer.record(i.PENDING_RAW))
                elif mode == 'old-checksum':
                    saved['old']['slots.py']['sha256'] = '0' * 64
                elif mode == 'old-metadata':
                    saved['old']['slots.py']['mode'] = 0o640
                elif mode == 'new-checksum':
                    saved['new']['slots.py']['sha256'] = '0' * 64
                elif mode == 'unknown-candidate':
                    saved['new']['slots.py'] = installer.record(b'# unreviewed candidate\n')
                elif mode == 'current-drift':
                    installer.paths[0].chmod(0o640)
                elif mode == 'mixed':
                    installer.write(installer.paths[0], saved['new'][installer.paths[0].name])
                elif mode == 'enabled':
                    system.states[i.UNITS[2]]['UnitFileState'] = 'disabled'
                elif mode == 'children':
                    system.extra_by_unit[i.UNITS[1]] = {9999}
                elif mode == 'writer':
                    (root/'state/slot1/state.json').write_text('{"active":{"phase":"qa"},"done":[]}')
                elif mode == 'archive':
                    (installer.backup / ('removed-' + '0' * 64 + '.json')).write_bytes(b'corrupt')
                    (installer.backup / ('removed-' + '0' * 64 + '.json')).chmod(0o600)
                elif mode == 'empty-manifest':
                    saved = {}
                elif mode == 'null-manifest':
                    saved = None
                elif mode == 'missing-old-digest':
                    saved['old']['slots.py'].pop('sha256')
                elif mode == 'missing-new-digest':
                    saved['new']['slots.py'].pop('sha256')
                elif mode == 'bad-units':
                    saved['units'][i.UNITS[2]]['MainPID'] = 'unknown'
                installer.journal(saved)
                if mode == 'missing-managed':
                    raw = (installer.backup/'managed.json').read_bytes()
                    installer.write(installer.backup / ('removed-' + i.digest(raw) + '.json'), installer.record(raw, 0o600))
                    (installer.backup/'managed.json').unlink()
                before = self.managed(installer)
                backup = {p.name: p.read_bytes() for p in installer.backup.iterdir()}
                for dry in (True, False):
                    with patch.object(installer, 'write', side_effect=AssertionError('unsafe write')), \
                            self.assertRaises(RuntimeError):
                        installer.apply(dry=dry)
                    self.assertEqual(system.events, [])
                    self.assertEqual(self.managed(installer), before)
                    self.assertEqual({p.name: p.read_bytes() for p in installer.backup.iterdir()}, backup)

    def test_removed_prior_archive_interruption_preserves_complete_journal_and_retry(self):
        for failure in (OSError, SystemExit):
            with self.subTest(failure=failure.__name__), self.removed_prior() as (_, installer, system, saved):
                journal = (installer.backup/'managed.json').read_bytes()
                write = installer.write
                def fail(path, record):
                    write(path, record)
                    if path.name.startswith('removed-'):
                        raise failure('interrupted after durable archive')
                installer.write = fail
                with self.assertRaises(failure):
                    installer.apply()
                self.assertEqual(system.events, [])
                self.assertEqual((installer.backup/'managed.json').read_bytes(), journal)
                self.assertEqual(self.managed(installer), saved['old'])
                self.assertFalse(installer.pending.exists())
                self.assertEqual(next(installer.backup.glob('removed-*')).read_bytes(), journal)
                installer.write = write
                installer.apply()

    def test_removed_prior_failed_start_rollback_retains_fresh_slot2_state_and_recovery(self):
        for persistent in (False, True):
            with self.subTest(persistent=persistent), self.removed_prior() as (_, installer, system, _):
                before, units = self.managed(installer), copy.deepcopy(system.states)
                journal = (installer.backup/'managed.json').read_bytes()
                system.start_failures[i.UNITS[0]] = -1 if persistent else 1
                expected = RuntimeError if persistent else subprocess.CalledProcessError
                with self.assertRaises(expected):
                    installer.apply()
                self.assertEqual(self.managed(installer), before)
                saved = json.loads((installer.backup/'managed.json').read_text())
                self.assertEqual(saved['phase'], 'removed')
                self.assertEqual(saved['units'], units)
                self.assertEqual(saved['new']['slots.py']['sha256'], installer.payloads['slots.py']['new'])
                self.assertEqual(next(installer.backup.glob('removed-*')).read_bytes(), journal)
                self.assertNotIn(('start', (i.UNITS[2],)), system.events)
                self.assertFalse(installer.pending.exists())
                system.start_failures.clear()
                installer.apply(remove=True, dry=True)
                installer.apply(remove=True)
                self.assert_restored(installer, system, before, units)

    def test_removed_prior_migration_crash_boundaries_keep_audit_and_explicit_recovery(self):
        with self.removed_prior() as (_, installer, system, _):
            sequence = []
            write = installer.write
            def trace(path, record):
                write(path, record); sequence.append(('write', path.name))
            installer.write, system.after = trace, sequence.append
            installer.apply()
        self.assertTrue(sequence[0][1].startswith('removed-'))
        for number, boundary in enumerate(sequence):
            with self.subTest(number=number, boundary=boundary), self.removed_prior() as (root, installer, system, _):
                before, units = self.managed(installer), copy.deepcopy(system.states)
                journal = (installer.backup/'managed.json').read_bytes()
                snapshot = root/'services.json'
                remaining = [number]
                write = installer.write
                def crash(event):
                    snapshot.write_text(json.dumps(system.states))
                    remaining[0] -= 1
                    if remaining[0] == -1:
                        os._exit(73)
                def crashing_write(path, record):
                    write(path, record); crash(('write', path.name))
                def run():
                    installer.write, system.after = crashing_write, crash
                    installer.apply()
                child = multiprocessing.get_context('fork').Process(target=run)
                child.start(); child.join(timeout=20)
                if child.is_alive():
                    child.kill(); child.join()
                self.assertEqual(child.exitcode, 73)
                system.states = json.loads(snapshot.read_text())
                fresh = i.Installer(installer.payloads, i.System(), code=installer.code,
                    policy=installer.policy, backup=installer.backup, lock=installer.lock,
                    state=installer.state, monitor=root/'monitor')
                archive = next(fresh.backup.glob('removed-*'))
                self.assertEqual(archive.read_bytes(), journal)
                if number == 0:
                    self.assertEqual((fresh.backup/'managed.json').read_bytes(), journal)
                    fresh.apply(dry=True)
                    fresh.apply()
                elif number != len(sequence) - 1:
                    with self.assertRaisesRegex(RuntimeError, 'interrupted installation'):
                        fresh.apply()
                fresh.apply(remove=True, dry=True)
                fresh.apply(remove=True)
                self.assert_restored(fresh, system, before, units)
                self.assertEqual(archive.read_bytes(), journal)
                self.assertFalse(fresh.pending.exists())

    def assert_restored(self, installer, system, before, units):
        self.assertEqual(self.managed(installer), before)
        self.assertEqual(system.states, units)
        self.assertFalse(any(verb in ('enable', 'disable', 'restart', 'daemon-reload')
                             for verb, _ in system.events))

    @contextlib.contextmanager
    def worker(self, root, mode='slot1'):
        for directory in ('worker-state/locks', 'worker-state/outbox/slot1',
                          'worker-state/outbox/slot2', 'srv'):
            (root / directory).mkdir(parents=True, exist_ok=True)
        for name in ('registry.lock', 'integration.lock', 'api.clock'):
            (root/'worker-state/locks'/name).touch()
        (root / 'etc/budgets.json').write_text(json.dumps(dict(
            schema=1, providers={'codex': {'author': 40, 'qa': 40}},
            slots={slot: {'codex': {'author': 20, 'qa': 20}} for slot in ('slot1', 'slot2')})))
        original = HERE.parents[2] / 'pinned-originals/autonomous_issues.py'
        process = subprocess.Popen([sys.executable, '-I', '-B', '-c', WORKER, str(HERE.parent),
            str(root), mode, str(original)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            ready, _, _ = select.select([process.stdout], [], [], 10)
            self.assertTrue(ready, 'worker did not reach barrier')
            self.assertEqual(process.stdout.readline().strip(), 'WAIT')
            self.assertIsNone(process.poll())
            yield process
        finally:
            if process.poll() is None:
                process.terminate()
            process.communicate(timeout=10)

    def assert_no_work(self, root):
        self.assertFalse((root / 'task-mutation').exists())
        self.assertFalse((root / 'supervisor-work').exists())
        self.assertFalse(list((root / 'worker-state').rglob('*.lease')))
        self.assertFalse(list((root / 'worker-state').rglob('ledger.json*')))

    def test_dry_is_read_only_and_install_remove_restores_bytes_modes_states(self):
        for policy in (False, True):
            with self.subTest(prior_policy=policy), self.fixture(policy) as (root, installer, system):
                before, units = self.managed(installer), copy.deepcopy(system.states)
                all_before = {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()}
                installer.apply(dry=True)
                self.assertEqual(all_before, {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()})
                self.assertEqual(system.events, [])
                installer.apply()
                new = self.managed(installer)
                self.assertTrue(all(new[p.name]['sha256'] == i.digest(installer.new[p.name]) for p in installer.paths))
                self.assertEqual(system.states, units)
                self.assertEqual(set(p.name for p in installer.backup.iterdir()), {'managed.json'})
                manifest = i.decode(base64.b64decode(installer.read(installer.backup / 'managed.json')['data']))
                self.assertEqual(set(manifest['old']), {'autonomous_issues.py', 'slots.py', 'slot_telemetry.py', 'writer.py', 'app.js', 'continuity.json'})
                events = list(system.events)
                installer.apply()
                self.assertEqual(events, system.events)
                installer.apply(remove=True, dry=True)
                self.assertEqual(self.managed(installer), new)
                installer.apply(remove=True)
                self.assert_restored(installer, system, before, units)
                events = list(system.events)
                installer.apply(remove=True)
                self.assertEqual(events, system.events)

    def test_failures_and_signals_after_each_mutating_boundary_restore_complete_managed_set(self):
        # Collect the successful transaction's mutation boundaries, then fail once AFTER each one.
        with self.fixture() as (_, installer, system):
            sequence = []
            real_write = installer.write
            def write(path, value):
                real_write(path, value); sequence.append(('write', path.name))
            installer.write = write
            system.after = sequence.append
            installer.apply()
        self.assertGreater(len(sequence), 8)
        for number in range(len(sequence)):
            for failure in (OSError, SystemExit):
                with self.subTest(number=number, failure=failure.__name__), self.fixture() as (_, installer, system):
                    before, units = self.managed(installer), copy.deepcopy(system.states)
                    real_write = installer.write
                    remaining = [number]
                    def fault(event):
                        remaining[0] -= 1
                        if remaining[0] == -1:
                            raise failure('injected')
                    def write(path, value):
                        real_write(path, value); fault(('write', path.name))
                    installer.write = write
                    system.after = fault
                    with self.assertRaises(failure):
                        installer.apply()
                    if number == len(sequence) - 1:
                        # Activation unlink has happened: writers may have entered, so
                        # neither an I/O error nor a signal may restore old code.
                        self.assertFalse(installer.pending.exists())
                        self.assertEqual(self.managed(installer),
                                         json.loads((installer.backup/'managed.json').read_text())['new'])
                        self.assertEqual(system.states, units)
                        self.assertEqual(json.loads((installer.backup/'managed.json').read_text())['phase'],
                                         'installed')
                    else:
                        self.assert_restored(installer, system, before, units)
                        self.assertFalse(installer.pending.exists())

    def test_remove_failure_restores_installed_set_and_operation_active_states(self):
        with self.fixture(True) as (_, installer, system):
            installer.apply()
            system.command('stop', i.UNITS[1])  # active state changed after installation, no enabling
            before, units = self.managed(installer), copy.deepcopy(system.states)
            real_write = installer.write
            fired = [False]
            def fail(path, value):
                real_write(path, value)
                if path == installer.paths[1] and not fired[0]:
                    fired[0] = True
                    raise OSError('injected remove failure')
            installer.write = fail
            with self.assertRaises(OSError):
                installer.apply(remove=True)
            self.assert_restored(installer, system, before, units)
            installer.write = real_write
            installer.apply(remove=True)
            self.assertEqual(system.states[i.UNITS[1]]['ActiveState'], 'active')

    def test_active_phase_children_and_freeze_race_refuse_before_stop(self):
        for phase in ('developing', 'qa', 'integrating', 'promoting', 'dev_wait', 'claimed'):
            with self.subTest(phase=phase), self.fixture() as (root, installer, system):
                (root / 'state/slot1/state.json').write_text(json.dumps(dict(active=dict(phase=phase), done=[])))
                with self.assertRaisesRegex(RuntimeError, 'active author'):
                    installer.apply()
                self.assertEqual(system.events, [])
        with self.fixture() as (_, installer, system):
            system.extra = {9999}
            with self.assertRaisesRegex(RuntimeError, 'active children'):
                installer.apply()
            self.assertEqual(system.events, [])
        with self.fixture() as (root, installer, system):
            before, units = self.managed(installer), copy.deepcopy(system.states)
            def race(event):
                if event[1] == 'freeze':
                    (root / 'state/slot1/state.json').write_text(json.dumps(dict(active=dict(phase='qa'), done=[])))
            system.after = race
            with self.assertRaisesRegex(RuntimeError, 'active author'):
                installer.apply()
            self.assertNotIn('stop', [verb for verb, _ in system.events])
            self.assert_restored(installer, system, before, units)

    def test_recheck_stopped_cgroup_and_checkpoint_before_code_switch(self):
        for mode in ('cgroup', 'state'):
            with self.subTest(mode=mode), self.fixture() as (root, installer, system):
                before, units = self.managed(installer), copy.deepcopy(system.states)
                fired = [False]
                def fault(event):
                    if event[1] == 'stop' and not fired[0]:
                        fired[0] = True
                        if mode == 'cgroup':
                            system.extra = {9999}
                        else:
                            (root / 'state/slot1/state.json').write_text(json.dumps(dict(active=dict(phase='qa'), done=[])))
                system.after = fault
                with self.assertRaises(RuntimeError):
                    installer.apply()
                self.assert_restored(installer, system, before, units)

    def test_unrecognized_bytes_symlinks_hardlinks_writable_parents_and_payloads_refused(self):
        for mode in ('drift', 'policy', 'symlink', 'hardlink', 'parent', 'backup'):
            with self.subTest(mode=mode), self.fixture() as (root, installer, system):
                path = installer.paths[0]
                if mode == 'drift':
                    path.write_bytes(b'unknown')
                elif mode == 'policy':
                    installer.policy.write_bytes(b'{"enabled":true}')
                elif mode == 'symlink':
                    other = root / 'other'; path.rename(other); path.symlink_to(other)
                elif mode == 'hardlink':
                    os.link(path, root / 'other')
                elif mode == 'parent':
                    path.parent.chmod(0o777)
                else:
                    installer.backup.mkdir(mode=0o777)
                    installer.backup.chmod(0o777)
                with self.assertRaises((RuntimeError, OSError)):
                    installer.apply()
                self.assertEqual(system.events, [])
        with self.fixture() as (_, installer, system):
            corrupt = copy.deepcopy(installer.payloads)
            corrupt['slots.py']['new'] = '0' * 64
            with self.assertRaisesRegex(RuntimeError, 'checksum'):
                i.Installer(corrupt)

    def test_interrupted_partial_switch_remove_uses_durable_exact_preinstall_backup(self):
        with self.fixture() as (_, installer, system):
            before, units = self.managed(installer), copy.deepcopy(system.states)
            installer.apply()
            manifest = i.decode(base64.b64decode(installer.read(installer.backup / 'managed.json')['data']))
            installer.journal(manifest | {'phase': 'prepared'})
            installer.write(installer.paths[0], before[installer.paths[0].name])
            with self.assertRaisesRegex(RuntimeError, 'interrupted installation'):
                installer.apply()
            installer.apply(remove=True)
            self.assert_restored(installer, system, before, units)

    def test_crash_halfway_through_remove_is_recoverable_and_reinstall_takes_fresh_snapshot(self):
        with self.fixture(True) as (_, installer, system):
            before = self.managed(installer)
            installer.apply()
            manifest = i.decode(base64.b64decode(installer.read(installer.backup / 'managed.json')['data']))
            # Durable marker is written before removal too; simulate loss of power after one file.
            installer.journal(manifest | {'phase': 'prepared'})
            installer.write(installer.paths[0], before[installer.paths[0].name])
            installer.apply(remove=True)
            self.assertEqual(self.managed(installer), before)
            system.command('stop', i.UNITS[1])
            new_prior = copy.deepcopy(system.states)
            installer.apply()
            installer.apply(remove=True)
            self.assertEqual(system.states, new_prior)

    def test_rollback_never_stops_writer_that_started_after_partial_restart(self):
        with self.fixture() as (_, installer, system):
            fired = [False]
            def started(event):
                if event[1] == 'start' and not fired[0]:
                    fired[0] = True
                    system.extra = {9999}
                    raise OSError('partial restart with a new writer')
            system.after = started
            with self.assertRaisesRegex(RuntimeError, 'ROLLBACK INCOMPLETE'):
                installer.apply()
            # Only the initial, verified clean stop is allowed. Code backup stays available.
            self.assertEqual(sum(verb == 'stop' for verb, _ in system.events), 1)
            self.assertTrue((installer.backup / 'managed.json').exists())
            self.assertEqual(self.managed(installer)['slots.py']['sha256'], installer.payloads['slots.py']['new'])

    def test_remove_refuses_incompatible_policy_state_without_fabricating_owner_or_editing_state(self):
        with self.fixture() as (root, installer, system):
            installer.apply()
            path = root / 'state/slot1/parked.json'
            raw = b'{"parked":[{"kind":"policy","issue":151,"allow_successors":[]}]}'
            path.write_bytes(raw); path.chmod(0o600)
            before, units, events = self.managed(installer), copy.deepcopy(system.states), list(system.events)
            with self.assertRaisesRegex(RuntimeError, 'original Store cannot read'):
                installer.apply(remove=True)
            self.assertEqual(path.read_bytes(), raw)
            self.assertEqual(system.events, events)
            self.assert_restored(installer, system, before, units)

    def test_remove_refuses_nonempty_deferred_without_mutating_files_units_or_checkpoints(self):
        with self.fixture() as (root, installer, system):
            installer.apply()
            path = root / 'state/slot1/deferred.json'
            raw = b'{"deferred":[{"kind":"policy","issue":151,"attempt":3}]}'
            path.write_bytes(raw); path.chmod(0o600)
            before, units, events = self.managed(installer), copy.deepcopy(system.states), list(system.events)
            journal = (installer.backup / 'managed.json').read_bytes()
            for dry in (True, False):
                with self.assertRaisesRegex(RuntimeError, 'ignores policy deferrals'):
                    installer.apply(remove=True, dry=dry)
            self.assertEqual(path.read_bytes(), raw)
            self.assertFalse((path.parent / 'parked.json').exists())
            self.assertEqual((installer.backup / 'managed.json').read_bytes(), journal)
            self.assertEqual(system.events, events)
            self.assert_restored(installer, system, before, units)

    def test_partial_restart_new_deferral_refuses_automatic_unsafe_rollback(self):
        with self.fixture() as (root, installer, system):
            fired = [False]
            def started(event):
                if event[1] == 'start' and not fired[0]:
                    fired[0] = True
                    path = root / 'state/slot1/deferred.json'
                    path.write_text('{"deferred":[{"kind":"policy","issue":151}]}')
                    path.chmod(0o600)
                    raise OSError('start failed after task was deferred')
            system.after = started
            with self.assertRaisesRegex(RuntimeError, 'ROLLBACK INCOMPLETE'):
                installer.apply()
            self.assertEqual(sum(verb == 'stop' for verb, _ in system.events), 1)
            self.assertTrue(all(self.managed(installer)[p.name]['sha256'] == i.digest(installer.new[p.name])
                                for p in installer.paths))
            manifest = i.decode(base64.b64decode(installer.read(installer.backup / 'managed.json')['data']))
            self.assertEqual(manifest['phase'], 'prepared')
            self.assertIsNotNone(installer.barrier())
            self.assertTrue(all(v['FreezerState'] == 'running' for v in system.states.values()))

    def test_empty_deferred_allows_exact_rollback_and_is_untouched(self):
        with self.fixture() as (root, installer, system):
            before, units = self.managed(installer), copy.deepcopy(system.states)
            installer.apply()
            path = root / 'state/slot1/deferred.json'
            path.write_text('{"deferred":[]}'); path.chmod(0o600)
            installer.apply(remove=True)
            self.assertEqual(path.read_text(), '{"deferred":[]}')
            self.assert_restored(installer, system, before, units)

    def test_production_parser_accepts_only_proven_quiescent_failed_recovery(self):
        for group in ('', '/missing.service', '/empty.service'):
            with self.subTest(group=group), self.fixture(parsed=True) as (_, installer, system):
                unit = i.UNITS[0]
                system.missing_groups.add('/missing.service')
                system.states[unit].update(ActiveState='failed', SubState='failed', MainPID='0',
                                          ControlGroup=group)
                value = installer.system.status(unit)
                self.assertEqual((value['ActiveState'], value['SubState']), ('failed', 'failed'))
                self.assertEqual(installer.system.pids(value), set())
                self.assertEqual(installer.statuses(recovery=True)[unit], value)
                with self.assertRaisesRegex(RuntimeError, 'unsupported/busy'):
                    installer.apply()
                self.assertEqual(system.events, [])
                self.assertFalse(installer.backup.exists())

    def test_production_parser_rejects_failed_pid_or_descendant_even_during_recovery(self):
        for mode in ('pid', 'descendant'):
            with self.subTest(mode=mode), self.fixture(parsed=True) as (_, installer, system):
                unit = i.UNITS[0]
                system.states[unit].update(ActiveState='failed', SubState='failed',
                                          MainPID='99' if mode == 'pid' else '0')
                value = installer.system.status(unit)
                if mode == 'descendant':
                    child = system.cgroups / value['ControlGroup'][1:] / 'worker'
                    child.mkdir()
                    (child / 'cgroup.procs').write_text('9999\n')
                    self.assertEqual(installer.system.pids(value), {9999})
                for kwargs in ({}, {'stopped': True}, {'frozen': True}):
                    with self.assertRaisesRegex(RuntimeError, 'MainPID|active children|not quiescent'):
                        installer.statuses(recovery=True, **kwargs)
                self.assertEqual(system.events, [])

    def test_production_status_preserves_structural_and_operation_guards(self):
        for key, value in (('LoadState', 'not-found'), ('KillMode', 'process'),
                           ('UnitFileState', 'masked'), ('FreezerState', 'unknown'),
                           ('MainPID', '-1'), ('MainPID', ''), ('MainPID', 'unknown')):
            with self.subTest(key=key, value=value), self.fixture(parsed=True) as (_, installer, system):
                system.states[i.UNITS[0]][key] = value
                with self.assertRaises(RuntimeError):
                    installer.system.status(i.UNITS[0])
                self.assertEqual(system.events, [])

        for active, sub in (('activating', 'start'), ('deactivating', 'stop'),
                            ('active', 'exited'), ('reloading', 'reload'),
                            ('failed', 'running'), ('unknown', 'unknown')):
            with self.subTest(active=active, sub=sub), self.fixture(parsed=True) as (_, installer, system):
                system.states[i.UNITS[0]].update(ActiveState=active, SubState=sub)
                for recovery in (False, True):
                    with self.assertRaisesRegex(RuntimeError, 'unsupported/busy'):
                        installer.statuses(recovery=recovery)
                self.assertEqual(system.events, [])

    def test_stop_poll_accepts_only_our_transition_then_empty_inactive_cgroups(self):
        for removing in (False, True):
            with self.subTest(remove=removing), self.fixture(parsed=True) as (_, installer, system):
                if removing:
                    installer.apply()
                before = self.managed(installer)
                units = copy.deepcopy(system.states)
                sleeps = []
                def stopped(event):
                    if event[1] == 'stop':
                        for unit in i.UNITS[:2]:
                            transient = units[unit] | dict(ActiveState='deactivating', SubState='stop-sigterm')
                            system.show_sequences[unit] = [transient, transient | dict(MainPID='0'),
                                                           transient | dict(MainPID='0', ControlGroup='')]
                system.after = stopped
                with patch.object(i.time, 'sleep', side_effect=sleeps.append):
                    installer.apply(remove=removing)
                self.assertEqual(len(sleeps), 3)
                self.assertEqual(system.states, units)
                self.assertEqual(sum(verb == 'stop' for verb, _ in system.events), 2 if removing else 1)
                self.assertNotEqual(self.managed(installer), before)
                self.assertFalse(installer.pending.exists())

    def test_real_systemd_sigterm_143_failed_is_quiescent_after_controlled_stop(self):
        # systemd can report failed/failed (exit 143) after a successful stop.
        # Never treat this as an initially valid unit or allow remaining children.
        with self.fixture(parsed=True) as (_, installer, system):
            before, units = self.managed(installer), copy.deepcopy(system.states)
            def stopped(event):
                if event[1] == 'stop':
                    for unit in i.UNITS[:2]:
                        system.states[unit].update(
                            ActiveState='failed', SubState='failed', MainPID='0',
                            FreezerState='running')
            system.after = stopped
            installer.apply()
            self.assertFalse(installer.pending.exists())
            self.assertEqual(system.states, units)
            self.assertEqual([u for verb, us in system.events
                              if verb == 'start' for u in us], list(i.UNITS[:2]))
            installer.apply(remove=True)
            self.assert_restored(installer, system, before, units)
        with self.fixture(parsed=True) as (_, installer, system):
            stopping = installer.statuses()
            unit = i.UNITS[1]
            system.command('stop', *i.UNITS)
            system.states[unit].update(ActiveState='failed', SubState='failed', MainPID='0')
            system.extra_by_unit[unit] = {9999}
            with self.assertRaisesRegex(RuntimeError, 'control group not quiescent'):
                installer.wait_stopped(stopping)

    def test_stop_poll_deadline_signal_unknown_state_and_children_fail_before_switch(self):
        for mode in ('timeout', 'signal', 'children', 'pid', 'group', 'enabled', 'activating', 'unknown-stop'):
            with self.subTest(mode=mode), self.fixture(parsed=True) as (_, installer, system):
                before, units = self.managed(installer), copy.deepcopy(system.states)
                unit = i.UNITS[1]
                transient = units[unit] | dict(ActiveState='deactivating', SubState='stop-sigterm')
                if mode == 'pid':
                    transient['MainPID'] = '9999'
                elif mode == 'group':
                    transient['ControlGroup'] = '/another.service'
                elif mode == 'enabled':
                    transient['UnitFileState'] = 'disabled'
                elif mode == 'activating':
                    transient.update(ActiveState='activating', SubState='start')
                elif mode == 'unknown-stop':
                    transient['SubState'] = 'unknown'
                def stopped(event):
                    if event[1] == 'stop':
                        system.show_sequences[unit] = [transient] * 20
                        if mode == 'children':
                            system.extra_by_unit[unit] = {9999}
                system.after = stopped
                clock = [0.0]
                def sleep(seconds):
                    if mode == 'signal':
                        raise SystemExit(143)
                    clock[0] += seconds
                with patch.object(i, 'STOP_TIMEOUT', 1), patch.object(i.time, 'monotonic', side_effect=lambda: clock[0]), \
                        patch.object(i.time, 'sleep', side_effect=sleep), self.assertRaises((RuntimeError, SystemExit)):
                    installer.apply()
                self.assertEqual(self.managed(installer), before)
                self.assertLessEqual(clock[0], 1)
                self.assertEqual(sum(verb == 'stop' for verb, _ in system.events), 1)

    def test_stop_poll_cleared_cgroup_checks_bound_descendants_and_missing_pid0_group(self):
        import shutil
        for mode in ('missing', 'descendant'):
            with self.subTest(mode=mode), self.fixture(parsed=True) as (_, installer, system):
                stopping = installer.statuses()
                unit = i.UNITS[1]
                group = stopping[unit]['ControlGroup']
                directory = system.cgroups / group[1:]
                system.command('stop', *i.UNITS)
                if mode == 'missing':
                    shutil.rmtree(directory)
                    system.missing_groups.add(group)
                else:
                    (directory / 'child').mkdir()
                    (directory / 'child/cgroup.procs').write_text('9999\n')
                system.show_sequences[unit] = [stopping[unit] | dict(ActiveState='deactivating',
                    SubState='stop-post', MainPID='0', ControlGroup='')]
                events = list(system.events)
                with patch.object(i.time, 'sleep'):
                    if mode == 'missing':
                        installer.wait_stopped(stopping)
                    else:
                        with self.assertRaisesRegex(RuntimeError, 'unknown process while stopping'):
                            installer.wait_stopped(stopping)
                self.assertEqual(system.events, events)

    def test_enabled_but_inactive_slot2_stays_inactive_through_barrier_verification(self):
        with self.fixture(parsed=True) as (_, installer, system):
            system.states[i.UNITS[2]]['UnitFileState'] = 'enabled'
            before, units = self.managed(installer), copy.deepcopy(system.states)
            activate = installer.activate
            def verify():
                self.assertIsNotNone(installer.barrier())
                self.assertEqual(system.states, units)
                self.assertEqual(json.loads((installer.backup/'managed.json').read_text())['phase'], 'installed')
                self.assertEqual([u for verb, us in system.events if verb == 'start' for u in us], list(i.UNITS[:2]))
                activate()
            installer.activate = verify
            installer.apply()
            installer.activate = activate
            installer.apply(remove=True)
            self.assert_restored(installer, system, before, units)

    def test_production_cgroup_trust_and_missing_active_group_guards(self):
        for group in ('', '/missing.service', 'relative', '/system.slice/../escape', '/linked'):
            with self.subTest(group=group), self.fixture(parsed=True) as (_, installer, system):
                unit = i.UNITS[0]
                system.missing_groups.update(('/missing.service', '/linked'))
                system.states[unit]['ControlGroup'] = group
                if group == '/linked':
                    (system.cgroups / 'target').mkdir()
                    (system.cgroups / 'linked').symlink_to(system.cgroups / 'target')
                with self.assertRaisesRegex(RuntimeError, 'cgroup'):
                    installer.statuses(recovery=True)
                self.assertEqual(system.events, [])

    def test_real_failed_first_second_or_third_start_rolls_back_all_files_manifest_and_states(self):
        for failed_unit in i.UNITS:
            for group in ('', '/missing.service', '/empty.service'):
                for policy in (False, True):
                    with self.subTest(unit=failed_unit, group=group, policy=policy), \
                            self.fixture(policy, parsed=True) as (_, installer, system):
                        system.states[i.UNITS[1]]['UnitFileState'] = 'static'
                        if failed_unit == i.UNITS[2]:
                            system.states[failed_unit].update(ActiveState='active', SubState='running', MainPID='102')
                        before, units = self.managed(installer), copy.deepcopy(system.states)
                        system.failed_group = group
                        system.missing_groups.add('/missing.service')
                        system.start_failures[failed_unit] = 1
                        with self.assertRaises(subprocess.CalledProcessError):
                            installer.apply()
                        self.assert_restored(installer, system, before, units)
                        manifest = json.loads((installer.backup / 'managed.json').read_text())
                        self.assertEqual(manifest['phase'], 'removed')
                        self.assertEqual(manifest['old'], before)
                        self.assertEqual(manifest['units'], units)
                        self.assertEqual(manifest['new'], {
                            p.name: installer.record(installer.new[p.name], before[p.name]['mode']
                                if before[p.name] else 0o644) for p in installer.paths})

    def test_persistent_start_failure_restores_files_reports_incomplete_and_remove_recovers(self):
        for failed_unit in i.UNITS:
            with self.subTest(unit=failed_unit), self.fixture(True, parsed=True) as (_, installer, system):
                system.states[i.UNITS[2]].update(ActiveState='active', SubState='running', MainPID='102')
                before, units = self.managed(installer), copy.deepcopy(system.states)
                system.start_failures[failed_unit] = -1
                with patch('builtins.print') as output, self.assertRaisesRegex(RuntimeError, 'ROLLBACK INCOMPLETE'):
                    installer.apply()
                self.assertFalse(output.called)
                self.assertEqual(self.managed(installer), before)
                self.assertEqual(system.states[failed_unit]['ActiveState'], 'failed')
                for other in i.UNITS:
                    self.assertEqual(system.states[other]['UnitFileState'], units[other]['UnitFileState'])
                    if other != failed_unit:
                        self.assertEqual(system.states[other], units[other])
                self.assertTrue(all(v['FreezerState'] == 'running' for v in system.states.values()))
                manifest_path = installer.backup / 'managed.json'
                manifest = manifest_path.read_bytes()
                self.assertEqual(json.loads(manifest)['phase'], 'removed')
                events = list(system.events)
                installer.apply(remove=True, dry=True)
                self.assertEqual(system.events, events)
                self.assertEqual(manifest_path.read_bytes(), manifest)
                with patch('builtins.print') as output, self.assertRaises(subprocess.CalledProcessError):
                    installer.apply(remove=True)
                self.assertFalse(output.called)
                self.assertEqual(self.managed(installer), before)
                self.assertEqual(manifest_path.read_bytes(), manifest)
                system.start_failures[failed_unit] = 0
                installer.apply(remove=True)
                self.assert_restored(installer, system, before, units)
                self.assertEqual(manifest_path.read_bytes(), manifest)
                events = list(system.events)
                installer.apply(remove=True)
                self.assertEqual(system.events, events)

    def test_remove_installed_files_with_quiescent_failed_unit_preserves_enabled_pin(self):
        for group in ('', '/missing.service', '/empty.service'):
            with self.subTest(group=group), self.fixture(parsed=True) as (_, installer, system):
                system.states[i.UNITS[1]]['UnitFileState'] = 'static'
                before, units = self.managed(installer), copy.deepcopy(system.states)
                installer.apply()
                system.states[i.UNITS[0]].update(ActiveState='failed', SubState='failed', MainPID='0',
                                               ControlGroup=group)
                system.missing_groups.add('/missing.service')
                installer.apply(remove=True)
                self.assert_restored(installer, system, before, units)

    def test_remove_failed_unit_with_descendants_or_enabled_drift_refuses_before_mutations(self):
        for mode in ('descendants', 'enabled'):
            with self.subTest(mode=mode), self.fixture(parsed=True) as (_, installer, system):
                installer.apply()
                unit = i.UNITS[0]
                system.states[unit].update(ActiveState='failed', SubState='failed', MainPID='0')
                if mode == 'descendants':
                    system.extra_by_unit[unit] = {9999}
                else:
                    system.states[unit]['UnitFileState'] = 'disabled'
                before, units = self.managed(installer), copy.deepcopy(system.states)
                manifest = (installer.backup / 'managed.json').read_bytes()
                events = list(system.events)
                for dry in (False, True):
                    with self.assertRaisesRegex(RuntimeError, 'active children|enabled state changed'):
                        installer.apply(remove=True, dry=dry)
                self.assert_restored(installer, system, before, units)
                self.assertEqual(system.events, events)
                self.assertEqual((installer.backup / 'managed.json').read_bytes(), manifest)

    def test_real_failed_later_start_never_stops_new_writer_or_rolls_back_deferrals(self):
        for failed_unit, retained_unit in zip(i.UNITS[1:], i.UNITS):
            for mode in ('children', 'developing', 'qa', 'integrating', 'promoting', 'dev_wait', 'deferred', 'enabled'):
                with self.subTest(unit=failed_unit, mode=mode), self.fixture(parsed=True) as (root, installer, system):
                    system.states[i.UNITS[2]].update(ActiveState='active', SubState='running', MainPID='102')
                    system.start_failures[failed_unit] = 1
                    def started(event):
                        if event[1:] != ('start', (failed_unit,)):
                            return
                        if mode == 'children':
                            system.extra_by_unit[retained_unit] = {9999}
                        elif mode == 'deferred':
                            path = root / 'state/slot1/deferred.json'
                            path.write_text('{"deferred":[{"kind":"policy","issue":151}]}')
                            path.chmod(0o600)
                        elif mode == 'enabled':
                            system.states[retained_unit]['UnitFileState'] = 'static'
                        else:
                            (root / 'state/slot1/state.json').write_text(json.dumps(
                                dict(active=dict(phase=mode), done=[])))
                    system.after = started
                    with self.assertRaisesRegex(RuntimeError, 'ROLLBACK INCOMPLETE'):
                        installer.apply()
                    self.assertEqual(sum(verb == 'stop' for verb, _ in system.events), 1)
                    self.assertTrue(all(self.managed(installer)[p.name]['sha256'] == i.digest(installer.new[p.name])
                                        for p in installer.paths))
                    self.assertEqual(system.states[retained_unit]['ActiveState'], 'active')
                    self.assertEqual(system.states[failed_unit]['ActiveState'], 'failed')
                    self.assertTrue(all(v['FreezerState'] == 'running' for v in system.states.values()))
                    manifest = (installer.backup / 'managed.json').read_bytes()
                    self.assertEqual(json.loads(manifest)['phase'], 'prepared')
                    self.assertIsNotNone(installer.barrier())
                    events = list(system.events)
                    for dry in (False, True):
                        with self.assertRaises(RuntimeError):
                            installer.apply(remove=True, dry=dry)
                    self.assertEqual(system.events, events)
                    self.assertEqual((installer.backup / 'managed.json').read_bytes(), manifest)

    def test_barrier_is_first_runtime_and_supervisor_work_and_status_remains_available(self):
        class Waiting(Exception):
            pass
        with self.fixture() as (root, installer, _), patch.object(s, 'PENDING', installer.pending):
            installer.write(installer.pending, installer.record(i.PENDING_RAW))
            for slot in ('slot1', 'slot2'):
                with patch.object(s, 'Layout', side_effect=AssertionError('layout before activation')), \
                        patch.object(s, 'Budget', side_effect=AssertionError('budget before activation')), \
                        patch.object(s.time, 'sleep', side_effect=Waiting), self.assertRaises(Waiting):
                    s.Runtime(slot)
            with patch.object(s, 'load_supervisor_config', side_effect=AssertionError('config before barrier')), \
                    patch.object(s, '_executor', side_effect=AssertionError('API before barrier')), \
                    patch.object(s, 'tick', side_effect=AssertionError('assignment before barrier')), \
                    patch.object(s.time, 'sleep', side_effect=Waiting), self.assertRaises(Waiting):
                s.main(['supervise'])
            with patch.object(s, 'load_supervisor_config', return_value={'slots': []}), \
                    patch.object(s, 'wait_for_activation', side_effect=AssertionError('read-only status blocked')):
                self.assertEqual(s.main(['status']), 0)
            installer.write(installer.pending, None)
            with patch.object(s, 'Layout', side_effect=Waiting), self.assertRaises(Waiting):
                s.Runtime('slot1')

    def test_marker_metadata_schema_and_absent_parent_trust_fail_closed(self):
        for bad in ('unknown', 'extra', 'duplicate', 'oversize', 'symlink', 'hardlink',
                    'directory', 'fifo', 'mode', 'special', 'parent', 'parent-link', 'owner', 'absent-parent'):
            with self.subTest(bad=bad), self.fixture() as (root, installer, system):
                path = installer.pending
                installer.write(path, installer.record(i.PENDING_RAW))
                if bad in ('unknown', 'extra', 'duplicate', 'oversize'):
                    path.write_bytes({'unknown': b'{"schema":"unknown"}',
                        'extra': b'{"schema":"GB_CONTINUITY_PENDING_V1","extra":1}',
                        'duplicate': b'{"schema":"GB_CONTINUITY_PENDING_V1","schema":"GB_CONTINUITY_PENDING_V1"}',
                        'oversize': b' ' * 5000}[bad])
                elif bad == 'symlink':
                    path.unlink(); path.symlink_to(root / 'missing')
                elif bad == 'hardlink':
                    os.link(path, root / 'linked')
                elif bad == 'directory':
                    path.unlink(); path.mkdir()
                elif bad == 'fifo':
                    path.unlink(); os.mkfifo(path)
                elif bad in ('mode', 'special'):
                    path.chmod(0o666 if bad == 'mode' else 0o4644)
                elif bad == 'parent-link':
                    path.parent.rename(root / 'real-etc'); path.parent.symlink_to(root / 'real-etc')
                elif bad in ('parent', 'absent-parent'):
                    if bad == 'absent-parent':
                        path.unlink()
                    path.parent.chmod(0o777)
                with contextlib.ExitStack() as mocks:
                    if bad == 'owner':
                        real = os.fstat
                        def wrong(fd):
                            values = list(real(fd)); values[4] = 123
                            return os.stat_result(values)
                        mocks.enter_context(patch.object(os, 'fstat', side_effect=wrong))
                    with self.assertRaises((s.Hold, OSError, ValueError)):
                        s.deployment_pending(path)
                    for dry in (True, False):
                        with self.assertRaises((RuntimeError, OSError, ValueError)):
                            installer.apply(dry=dry)
                self.assertFalse(system.events)
                self.assertFalse(installer.backup.exists())
        with self.fixture() as (_, installer, _):
            self.assertFalse(s.deployment_pending(installer.pending))
            installer.write(installer.pending, installer.record(i.PENDING_RAW))
            self.assertTrue(s.deployment_pending(installer.pending))
            with self.assertRaisesRegex(RuntimeError, 'without backup'):
                installer.apply(dry=True)

    def test_production_parser_frozen_recovery_stops_before_any_thaw_and_preserves_guards(self):
        for phase in ('prepared', 'installed', 'removed'):
            for failed in (False, True):
                with self.subTest(phase=phase, failed=failed), self.fixture(parsed=True) as (_, installer, system):
                    before, units = self.managed(installer), copy.deepcopy(system.states)
                    installer.apply()
                    manifest = json.loads((installer.backup/'managed.json').read_text())
                    installer.journal(manifest | {'phase': phase})
                    installer.write(installer.pending, installer.record(i.PENDING_RAW))
                    if phase == 'removed':
                        for path in reversed(installer.paths):
                            installer.write(path, before[path.name])
                    for unit in i.UNITS[:2]:
                        system.states[unit]['FreezerState'] = 'frozen'
                    if failed:
                        system.states[i.UNITS[1]].update(ActiveState='failed', SubState='failed', MainPID='0',
                                                        ControlGroup='')
                    installer.statuses(recovery=True)
                    events, journal = list(system.events), (installer.backup/'managed.json').read_bytes()
                    installer.apply(remove=True, dry=True)
                    self.assertEqual(system.events, events)
                    self.assertEqual((installer.backup/'managed.json').read_bytes(), journal)
                    installer.apply(remove=True)
                    self.assertNotIn('thaw', [verb for verb, _ in system.events[len(events):]])
                    self.assert_restored(installer, system, before, units)
                    self.assertFalse(installer.pending.exists())
                    events = list(system.events)
                    installer.apply(remove=True)
                    self.assertEqual(system.events, events)
        for bad in ('children', 'writer', 'deferred', 'enabled'):
            with self.subTest(bad=bad), self.fixture(parsed=True) as (root, installer, system):
                installer.apply()
                system.states[i.UNITS[0]]['FreezerState'] = 'frozen'
                if bad == 'children':
                    system.extra_by_unit[i.UNITS[0]] = {9999}
                elif bad == 'enabled':
                    system.states[i.UNITS[0]]['UnitFileState'] = 'disabled'
                elif bad == 'writer':
                    (root/'state/slot1/state.json').write_text('{"active":{"phase":"developing"},"done":[]}')
                else:
                    path = root/'state/slot1/deferred.json'
                    path.write_text('{"deferred":[{"issue":155}]}'); path.chmod(0o600)
                before, units, events = self.managed(installer), copy.deepcopy(system.states), list(system.events)
                for dry in (True, False):
                    with self.assertRaises(RuntimeError):
                        installer.apply(remove=True, dry=dry)
                self.assert_restored(installer, system, before, units)
                self.assertEqual(system.events, events)

    def test_real_waiters_release_only_after_all_healthy_and_durable_installed_journal(self):
        for mode in ('slot1', 'slot2', 'old-slot1', 'supervise'):
            with self.subTest(mode=mode), self.fixture(parsed=True) as (root, installer, system), \
                    contextlib.ExitStack() as workers:
                system.states[i.UNITS[2]].update(ActiveState='active', SubState='running', MainPID='102')
                entered = []
                def started(event):
                    if event[1] == 'start':
                        self.assertIsNotNone(installer.barrier())
                        if not entered:
                            entered.append(workers.enter_context(self.worker(root, mode)))
                        self.assert_no_work(root)
                system.after = started
                activate = installer.activate
                def release():
                    self.assertEqual(json.loads((installer.backup/'managed.json').read_text())['phase'], 'installed')
                    self.assertEqual([u for verb, units in system.events if verb == 'start' for u in units], list(i.UNITS))
                    self.assertTrue(all(v['ActiveState'] == 'active' and v['FreezerState'] == 'running'
                                        for v in system.states.values()))
                    self.assert_no_work(root)
                    activate()
                installer.activate = release
                installer.apply()
                output, error = entered[0].communicate(timeout=10)
                self.assertEqual(entered[0].returncode, 0, error)
                if mode == 'supervise':
                    self.assertTrue((root/'supervisor-work').exists())
                else:
                    self.assertIn('RELEASED', output)
                    self.assertTrue((root/'task-mutation').exists())
                    ledger = json.loads(next((root/'worker-state').rglob('ledger.json')).read_text())
                    self.assertEqual(sum(cell['codex']['author'] for cell in ledger.values()), 1)

    def test_first_started_real_waiter_cannot_author_before_second_or_third_start_failure(self):
        for failed_unit in i.UNITS[1:]:
            for mode in ('slot1', 'slot2', 'old-slot1', 'supervise'):
                with self.subTest(unit=failed_unit, mode=mode), self.fixture(parsed=True) as (root, installer, system), \
                        contextlib.ExitStack() as workers:
                    system.states[i.UNITS[2]].update(ActiveState='active', SubState='running', MainPID='102')
                    before, units = self.managed(installer), copy.deepcopy(system.states)
                    checkpoints = {p: p.read_bytes() for p in (root/'state').rglob('*.json')}
                    system.start_failures[failed_unit] = 1
                    entered = []
                    def event(value):
                        verb = value[1]
                        if verb == 'start' and self.managed(installer)['slots.py']['sha256'] == installer.payloads['slots.py']['new']:
                            self.assertIsNotNone(installer.barrier())
                            if not entered:
                                entered.append(workers.enter_context(self.worker(root, mode)))
                            self.assert_no_work(root)
                        if verb == 'stop':
                            for process in entered:
                                process.terminate(); process.communicate(timeout=10)
                    system.after = event
                    with self.assertRaises(subprocess.CalledProcessError):
                        installer.apply()
                    self.assertTrue(entered)
                    self.assert_no_work(root)
                    self.assertEqual({p: p.read_bytes() for p in checkpoints}, checkpoints)
                    self.assert_restored(installer, system, before, units)
                    self.assertFalse(installer.pending.exists())
                    self.assertEqual(json.loads((installer.backup/'managed.json').read_text())['phase'], 'removed')

    def test_process_crash_at_every_install_and_remove_mutation_boundary_is_recoverable(self):
        for removing in (False, True):
            with self.fixture(parsed=True) as (_, installer, system):
                if removing:
                    installer.apply()
                sequence = []
                write = installer.write
                def trace(path, value):
                    write(path, value); sequence.append(('write', path.name))
                installer.write, system.after = trace, sequence.append
                installer.apply(remove=removing)
            self.assertEqual(sequence[-1], ('write', 'continuity.pending'))
            for number, boundary in enumerate(sequence):
                with self.subTest(remove=removing, number=number, boundary=boundary), \
                        self.fixture(True, parsed=True) as (root, installer, system):
                    before, units = self.managed(installer), copy.deepcopy(system.states)
                    if removing:
                        installer.apply()
                    state_file = root/'simulated-services.json'
                    state_file.write_text(json.dumps(system.states))
                    write = installer.write
                    remaining = [number]
                    def crash(event):
                        state_file.write_text(json.dumps(system.states))
                        remaining[0] -= 1
                        if remaining[0] == -1:
                            os._exit(73)  # no Python rollback/finally, like SIGKILL/power loss
                    def crashing_write(path, value):
                        write(path, value); crash(('write', path.name))
                    def run():
                        installer.write, system.after = crashing_write, crash
                        installer.apply(remove=removing)
                    child = multiprocessing.get_context('fork').Process(target=run)
                    child.start(); child.join(timeout=20)
                    if child.is_alive():
                        child.kill(); child.join()
                    self.assertEqual(child.exitcode, 73)
                    system.states = json.loads(state_file.read_text())
                    # A new Installer has no process-local progress flags. The journal,
                    # persistent marker and parsed systemd properties are all it has.
                    fresh = i.Installer(installer.payloads, i.System(), code=installer.code,
                        policy=installer.policy, backup=installer.backup, lock=installer.lock,
                        state=installer.state, monitor=root/'monitor')
                    committed = number == len(sequence) - 1
                    if not committed:
                        with self.assertRaisesRegex(RuntimeError, 'interrupted installation'):
                            fresh.apply()
                        if self.managed(fresh)['slots.py']['sha256'] == fresh.payloads['slots.py']['new']:
                            self.assertIsNotNone(fresh.barrier())
                            with self.worker(root, 'old-slot1'):
                                self.assert_no_work(root)
                    journal = (fresh.backup/'managed.json').read_bytes()
                    pending, events = fresh.barrier(), list(system.events)
                    fresh.apply(remove=True, dry=True)
                    self.assertEqual((fresh.backup/'managed.json').read_bytes(), journal)
                    self.assertEqual(fresh.barrier(), pending)
                    self.assertEqual(system.events, events)
                    fresh.apply(remove=True)
                    self.assert_restored(fresh, system, before, units)
                    self.assertFalse(fresh.pending.exists())
                    events = list(system.events)
                    fresh.apply(remove=True)
                    self.assertEqual(system.events, events)

    def test_unlink_uncertainty_and_postcommit_logging_failure_never_roll_back_new_code(self):
        for boundary in ('before-unlink', 'directory-fsync', 'after-fsync', 'logging'):
            with self.subTest(boundary=boundary), self.fixture(parsed=True) as (_, installer, system):
                write, activate, fsync = installer.write, installer.activate, os.fsync
                reached = []
                def fail_fsync(fd):
                    if not installer.pending.exists():
                        raise OSError('commit directory fsync uncertain')
                    return fsync(fd)
                def fail_write(path, value):
                    if path == installer.pending and value is None:
                        if boundary == 'before-unlink':
                            raise OSError('commit unlink not attempted')
                        write(path, value)
                        if boundary == 'after-fsync':
                            raise OSError('error after durable commit')
                    else:
                        write(path, value)
                def commit():
                    reached.append(list(system.events))
                    if boundary == 'directory-fsync':
                        with patch.object(os, 'fsync', side_effect=fail_fsync):
                            activate()
                    else:
                        activate()
                installer.write, installer.activate = fail_write, commit
                with patch('builtins.print', side_effect=OSError('log failed') if boundary == 'logging' else None), \
                        self.assertRaises(OSError):
                    installer.apply()
                self.assertTrue(reached)
                self.assertEqual(system.events, reached[0])
                self.assertEqual(self.managed(installer),
                                 json.loads((installer.backup/'managed.json').read_text())['new'])
                self.assertEqual(json.loads((installer.backup/'managed.json').read_text())['phase'], 'installed')
                self.assertEqual(installer.pending.exists(), boundary == 'before-unlink')
                if installer.pending.exists():
                    with self.assertRaisesRegex(RuntimeError, 'interrupted installation'):
                        installer.apply()
                installer.write, installer.activate = write, activate
                installer.apply(remove=True)

    def test_real_termination_before_and_during_final_unlink_preserves_commit_direction(self):
        for boundary, termination in ((b, n) for b in ('before-commit', 'before-unlink', 'after-unlink')
                                      for n in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM)):
            with self.subTest(boundary=boundary, signal=termination), self.fixture(parsed=True) as (_, installer, system):
                activate, unlink, fsync = installer.activate, Path.unlink, os.fsync
                reached, durable = [], []
                def interrupted(number, frame):
                    if boundary != 'before-commit':
                        self.assertTrue(durable, 'termination delivered before commit fsync')
                    raise SystemExit(128 + number)
                def interrupted_unlink(path, *args, **kwargs):
                    if path == installer.pending and boundary == 'before-unlink':
                        os.kill(os.getpid(), termination)
                    result = unlink(path, *args, **kwargs)
                    if path == installer.pending and boundary == 'after-unlink':
                        os.kill(os.getpid(), termination)
                    return result
                def synced(fd):
                    fsync(fd)
                    if reached and not installer.pending.exists():
                        durable.append(True)
                def commit():
                    reached.append(list(system.events))
                    if boundary == 'before-commit':
                        os.kill(os.getpid(), termination)
                    activate()
                installer.activate = commit
                previous = REAL_SIGNAL(termination, interrupted)
                mask = signal.pthread_sigmask(signal.SIG_BLOCK, [])
                try:
                    with patch.object(Path, 'unlink', interrupted_unlink), patch.object(os, 'fsync', side_effect=synced), \
                            self.assertRaises(SystemExit) as error:
                        installer.apply()
                    self.assertEqual(error.exception.code, 128 + termination)
                finally:
                    REAL_SIGNAL(termination, previous)
                self.assertEqual(signal.pthread_sigmask(signal.SIG_BLOCK, []), mask)
                self.assertEqual(system.events, reached[0])
                self.assertEqual(installer.pending.exists(), boundary == 'before-commit')
                self.assertEqual(json.loads((installer.backup/'managed.json').read_text())['phase'], 'installed')
                self.assertTrue(all(self.managed(installer)[p.name]['sha256'] == i.digest(installer.new[p.name])
                                    for p in installer.paths))
                installer.activate = activate
                installer.apply(remove=True)

    def test_abrupt_process_crash_immediately_before_or_after_activation_unlink(self):
        for after in (False, True):
            with self.subTest(after_unlink=after), self.fixture(parsed=True) as (root, installer, system):
                before, units = self.managed(installer), copy.deepcopy(system.states)
                snapshot = root/'services.json'
                unlink, activate = Path.unlink, installer.activate
                def crash_unlink(path, *args, **kwargs):
                    if path == installer.pending:
                        if after:
                            unlink(path, *args, **kwargs)
                        os._exit(74)  # after unlink deliberately precedes directory fsync
                    return unlink(path, *args, **kwargs)
                def commit():
                    snapshot.write_text(json.dumps(system.states))
                    with patch.object(Path, 'unlink', crash_unlink):
                        activate()
                def run():
                    installer.activate = commit
                    installer.apply()
                child = multiprocessing.get_context('fork').Process(target=run)
                child.start(); child.join(timeout=20)
                if child.is_alive():
                    child.kill(); child.join()
                self.assertEqual(child.exitcode, 74)
                system.states = json.loads(snapshot.read_text())
                self.assertEqual(json.loads((installer.backup/'managed.json').read_text())['phase'], 'installed')
                self.assertEqual(installer.pending.exists(), not after)
                self.assertTrue(all(self.managed(installer)[p.name]['sha256'] == i.digest(installer.new[p.name])
                                    for p in installer.paths))
                if not after:
                    with self.worker(root, 'slot2'):
                        self.assert_no_work(root)
                    with self.assertRaisesRegex(RuntimeError, 'interrupted installation'):
                        installer.apply()
                else:
                    installer.apply()  # observed release never causes implicit rollback
                installer.apply(remove=True)
                self.assert_restored(installer, system, before, units)

    def test_gate_first_upgrade_and_reverse_restore_are_durable_before_service_starts(self):
        with self.fixture(parsed=True) as (_, installer, system):
            writes = []
            write = installer.write
            def traced(path, value):
                write(path, value)
                writes.append(path)
                if path in installer.paths:
                    self.assertIsNotNone(installer.barrier())
                    self.assertEqual(json.loads((installer.backup/'managed.json').read_text())['phase'], 'prepared')
            installer.write = traced
            installer.apply()
            self.assertEqual([p.name for p in writes if p in installer.paths],
                             ['slots.py', 'autonomous_issues.py', 'slot_telemetry.py', 'writer.py', 'app.js', 'continuity.json'])
            self.assertEqual(writes[-1], installer.pending)
            writes.clear()
            installer.apply(remove=True)
            self.assertEqual([p for p in writes if p in installer.paths], list(reversed(installer.paths)))
            self.assertEqual(writes[-1], installer.pending)

    def test_generated_installer_contains_current_sources_pins_and_exact_controller(self):
        text = (HERE / 'slots-continuity.sh').read_text()
        controller = text.split("<<'GB_CONTINUITY_PY'\n", 1)[1].rsplit('\nGB_CONTINUITY_PY', 1)[0]
        tree = ast.parse(controller)
        payload_node = next(node for node in tree.body if isinstance(node, ast.Assign)
                            and any(isinstance(t, ast.Name) and t.id == 'PAYLOADS' for t in node.targets))
        payloads = ast.literal_eval(payload_node.value)
        self.assertIn((HERE / 'continuity-src/install.py').read_text(), controller)
        originals = HERE.parents[2] / 'pinned-originals'
        pins = json.loads((originals / 'manifest.json').read_text()).values()
        self.assertEqual(set(item['old'] for item in payloads.values()), set(pins))
        for name, item in payloads.items():
            raw = (HERE.parent / name if name in ('autonomous_issues.py', 'slots.py') else HERE / 'monitor-src' / name).read_bytes()
            self.assertEqual(hashlib.sha256((originals / name).read_bytes()).hexdigest(), item['old'])
            self.assertEqual(zlib.decompress(base64.b64decode(item['data'])), raw)
            self.assertEqual(hashlib.sha256(raw).hexdigest(), item['new'])


if __name__ == '__main__':
    unittest.main()

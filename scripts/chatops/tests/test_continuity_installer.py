"""Installer fault injection: real scratch files, simulated root metadata/systemd, no services."""
import ast
import base64
import contextlib
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch
import zlib

HERE = Path(__file__).resolve().parents[1] / 'parallel-slots'
SPEC = importlib.util.spec_from_file_location('continuity_installer', HERE / 'continuity-src/install.py')
i = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(i)


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

    def pids(self, value):
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

    def run(self, argv, **kwargs):
        assert argv[0] == '/usr/bin/systemctl'
        verb = argv[1]
        if verb == 'show':
            assert len(argv) == 4 and argv[2] in i.UNITS
            assert argv[3] == ('--property=LoadState,UnitFileState,ActiveState,SubState,MainPID,'
                               'KillMode,ControlGroup,FreezerState')
            assert kwargs == dict(check=True, capture_output=True, text=True, timeout=15)
            unit = argv[2]
            value = self.states[unit]
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

    def assert_restored(self, installer, system, before, units):
        self.assertEqual(self.managed(installer), before)
        self.assertEqual(system.states, units)
        self.assertFalse(any(verb in ('enable', 'disable', 'restart', 'daemon-reload')
                             for verb, _ in system.events))

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
                    self.assert_restored(installer, system, before, units)

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
            self.assertEqual(manifest['phase'], 'installed')
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
                    self.assertEqual(json.loads(manifest)['phase'], 'installed')
                    events = list(system.events)
                    for dry in (False, True):
                        with self.assertRaises(RuntimeError):
                            installer.apply(remove=True, dry=dry)
                    self.assertEqual(system.events, events)
                    self.assertEqual((installer.backup / 'managed.json').read_bytes(), manifest)

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

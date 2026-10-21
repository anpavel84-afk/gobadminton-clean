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
    def fixture(self, policy=False):
        with tempfile.TemporaryDirectory() as tmp, fake_root(), patch.object(i, 'validate_style_guide'):
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
            system = FakeSystem()
            installer = i.Installer(payloads, system, code=root / 'code', policy=root / 'etc/continuity.json',
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

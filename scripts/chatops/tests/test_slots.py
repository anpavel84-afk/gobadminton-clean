"""PARALLEL_SLOTS_V1 offline tests: default slot unchanged, isolation, locks, scheduler, budgets,
adapters, merge queue and state migration. Never consumes live Issues, never invokes a model."""
import contextlib
import copy
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('autonomy_slots_test', HERE / 'autonomous_issues.py')
a = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(a)
sys.path.insert(0, str(HERE))
import slots as s  # noqa: E402  (same module object activate_slot imports)

HEAD, BASE, DRIFT, NEW = 'a' * 40, 'b' * 40, 'c' * 40, 'd' * 40
NOW = dt.datetime.now(dt.timezone.utc)
SINCE = NOW - dt.timedelta(hours=1)
GLOBALS = ('SLOT', '_SLOTS', '_API_CLOCK', '_SLOTS_HOLD', 'KEY', 'RUNTIME_READS')


def task(**extra):
    value = dict(schema=a.MARKER, target='dev', kind='source_only', goal='Map fix', acceptance='ok',
                 allowed_paths=['apps/web/src/games/**'], max_attempts=3)
    value.update(extra)
    return value


def issue(number=40, **extra):
    stamp = NOW.isoformat()
    return dict(number=number, state='open', user={'id': a.OWNER_ID}, created_at=stamp, updated_at=stamp,
                body=a.MARKER + '\n' + json.dumps(task(**extra)))


def host(tmp, budgets=None):
    """Synthetic host layout under tmp (what the installer would create)."""
    tmp = Path(tmp)
    for d in ('var/locks', 'var/assign', 'var/outbox/slot1', 'var/outbox/slot2', 'etc', 'srv/slot1', 'srv/slot2'):
        (tmp / d).mkdir(parents=True, exist_ok=True)
    for f in ('integration.lock', 'registry.lock', 'api.clock'):
        (tmp / 'var/locks' / f).touch()
    if budgets is not False:
        (tmp / 'etc/budgets.json').write_text(json.dumps(budgets or {
            'schema': 1, 'providers': {'codex': {'author': 40, 'qa': 40}},
            'slots': {'slot1': {'codex': {'author': 40, 'qa': 40}}, 'slot2': {'codex': {'author': 20, 'qa': 20}}}}))
        os.chmod(tmp / 'etc/budgets.json', 0o644)
    return dict(state_root=tmp / 'var', slot_root=tmp / 'srv', config_root=tmp / 'etc',
                runtime_root=tmp / 'opt', trusted_assigners={os.getuid()})


@contextlib.contextmanager
def slot_mode(tmp, name='slot1', **kw):
    saved = {k: getattr(a, k) for k in GLOBALS}
    try:
        yield a.activate_slot(name, **(host(tmp, **kw)))
    finally:
        for k, v in saved.items():
            setattr(a, k, v)


def assign(rt, number, t=None):
    record = s.task_record(number, t or task())
    s.atomic(rt.layout.assignment, dict(schema=s.ASSIGN_SCHEMA, slot=rt.slot, issue=number, assigned_at=1,
                                        locks=record['locks'], allowed_paths=record['allowed_paths']), 0o644)


class DefaultSlotUnchanged(unittest.TestCase):
    def test_module_defaults_are_the_legacy_executor(self):
        self.assertEqual((a.SLOT, a._SLOTS, a._API_CLOCK), ('default', None, None))
        self.assertEqual(a.KEY, Path('/home/agentagency-dev/.ssh/gobadminton-clean-chatops-ed25519'))
        self.assertEqual(a.clean_env(), {
            'PATH': '/home/agentagency-dev/.local/node-v24.21.0/bin:/usr/bin:/bin',
            'HOME': '/home/agentagency-dev', 'USER': 'agentagency-dev', 'LANG': 'C.UTF-8',
            'CODEX_HOME': '/home/agentagency-dev/.codex', 'GIT_CONFIG_NOSYSTEM': '1',
            'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0'})
        self.assertEqual(a.integ({'attempt': 2}), '')

    def probe(self, argv):
        calls = []

        def fake_run(cmd, cwd, env, **kw):
            calls.append((cmd, env))
            raise SystemExit(99)
        saved = {k: getattr(a, k) for k in GLOBALS}
        try:
            with patch.object(sys, 'argv', ['x', '--repo', '/r', '--state-dir', '/s', '--worktrees-root', '/w',
                                            '--known-hosts', '/k', '--approved-since', SINCE.isoformat()] + argv), \
                    patch.object(a, 'run', side_effect=fake_run), patch.object(a.signal, 'signal'), \
                    self.assertRaises(SystemExit):
                a.main()
        finally:
            for k, v in saved.items():
                setattr(a, k, v)
        return calls[0]

    def test_default_main_probes_the_same_user_service(self):
        cmd, env = self.probe([])
        self.assertEqual(cmd, ['systemctl', '--user', 'show', 'gobadminton-autonomy.service',
                               '--property=KillMode,MainPID,ActiveState'])
        self.assertEqual(env['USER'], 'agentagency-dev')
        cmd, _ = self.probe(['--slot', 'default'])
        self.assertEqual(cmd[:4], ['systemctl', '--user', 'show', 'gobadminton-autonomy.service'])

    def test_slot_main_probes_its_own_system_unit(self):
        cmd, env = self.probe(['--slot', 'slot2'])
        self.assertEqual(cmd, ['systemctl', 'show', 'gobadminton-slot@slot2.service',
                               '--property=KillMode,MainPID,ActiveState'])
        self.assertEqual(env['USER'], 'gb-slot2')
        self.assertEqual(env['HOME'], '/srv/gb-slots/slot2/home')
        with self.assertRaises(a.Hold):
            self.probe(['--slot', 'slot9'])

    def test_retired_state_is_refused_by_the_legacy_executor(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            state = root / 'state'
            state.mkdir()
            (state / 'RETIRED_TO_SLOT.json').write_text('{}')
            props = f'KillMode=control-group\nMainPID={os.getpid()}\nActiveState=active'
            with patch.object(sys, 'argv', ['x', '--repo', str(root), '--state-dir', str(state),
                                            '--worktrees-root', str(root), '--known-hosts', str(root / 'k'),
                                            '--approved-since', SINCE.isoformat()]), \
                    patch.object(a, 'run', return_value=props), patch.object(a.signal, 'signal'), \
                    patch.object(a.os, 'getuid', return_value=1000), \
                    patch.object(a.pwd, 'getpwuid', return_value=types.SimpleNamespace(pw_name='agentagency-dev')), \
                    self.assertRaisesRegex(a.Hold, 'retired'):
                a.main()


class OptionalFields(unittest.TestCase):
    def test_valid_links_are_admitted_and_recorded(self):
        for extra in ({}, {'depends_on': [39]}, {'locks': ['web:games:map']}, {'locks': ['global']},
                      {'model': 'gpt-6.1-sol', 'effort': 'high'},
                      {'depends_on': [1, 2], 'locks': ['web:games', 'api:games'], 'model': 'gpt-6.1-sol',
                       'effort': 'medium'}):
            with self.subTest(extra=extra):
                self.assertEqual(a.validate_issue(issue(**extra), SINCE, NOW), task(**extra))

    def test_invalid_links_and_unknown_fields_fail_closed(self):
        for extra in ({'depends_on': [40]}, {'depends_on': [True]}, {'depends_on': [1, 1]}, {'depends_on': 1},
                      {'depends_on': list(range(1, 10))}, {'locks': []}, {'locks': ['Web']},
                      {'locks': ['global', 'web']}, {'locks': ['a:b:c:d']}, {'locks': ['x' * 25]},
                      {'model': 'gpt-6.1-sol'}, {'effort': 'high'}, {'model': 'cursor-auto', 'effort': 'high'},
                      {'model': 'gpt-6.1-sol', 'effort': 'xhigh'}, {'extra': 1}, {'slot': 'slot2'}):
            with self.subTest(extra=extra), self.assertRaises(a.Hold):
                a.validate_issue(issue(**extra), SINCE, NOW)


class Locks(unittest.TestCase):
    def rec(self, n, locks, paths):
        return dict(issue=n, locks=locks, allowed_paths=paths)

    def test_conflict_matrix(self):
        R = self.rec
        self.assertTrue(s.conflicts(R(1, ['web:games'], ['apps/web/a/**']), R(2, ['web:games:map'], ['apps/web/b/**'])))
        self.assertFalse(s.conflicts(R(1, ['web:games'], ['apps/web/a/**']), R(2, ['api:profiles'], ['apps/api/x/**'])))
        self.assertTrue(s.conflicts(R(1, ['web:radar'], ['apps/web/a/**']), R(2, ['api:x'], ['apps/web/a/b.ts'])))
        self.assertTrue(s.conflicts(R(1, ['migrations'], ['apps/api/m/**']), R(2, ['web:x'], ['apps/web/x/**'])))
        self.assertTrue(s.conflicts(R(1, ['global'], ['apps/a.ts']), R(2, ['web:x'], ['apps/web/x/**'])))
        self.assertEqual(s.task_record(5, task())['locks'], ['global'])   # undeclared = solo
        self.assertTrue(s.conflicts(R(1, ['web:a'], ['apps/web/a.ts']), R(1, ['web:b'], ['apps/web/b.ts'])))
        self.assertFalse(s.path_overlap('apps/web/a.ts', 'apps/web/ab.ts'))
        self.assertTrue(s.path_overlap('apps/web/**', 'apps/web/src/**'))
        self.assertTrue(s.path_overlap('apps/web/src/x.ts', 'apps/web/**'))

    def child(self, tmp, code):
        script = ('import sys,time;sys.path.insert(0,sys.argv[1]);import slots as s;from pathlib import Path;'
                  'T=Path(sys.argv[2])\n' + code + '\nprint("ready",flush=True);time.sleep(60)')
        p = subprocess.Popen([sys.executable, '-B', '-c', script, str(HERE), str(tmp)], stdout=subprocess.PIPE)
        self.assertEqual(p.stdout.readline().strip(), b'ready')
        p.stdout.close()
        return p

    def test_lease_and_shared_lock_modes_survive_umask_0077(self):
        # QA100: the executor runs with umask 0077; leases must stay readable (not writable) by
        # other slots, shared flock files group-usable, and an unreadable lease fails closed.
        old = os.umask(0o077)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                locks = Path(tmp)
                reg = s.LockRegistry(locks, locks / 'registry.lock')
                with s._Flock(locks / 'registry.lock', write=True):
                    pass
                self.assertEqual((locks / 'registry.lock').stat().st_mode & 0o777, 0o660)
                self.assertTrue(reg.acquire('slot1', self.rec(1, ['web:a'], ['apps/web/a.ts'])))
                self.assertEqual((locks / 'slot1.lease').stat().st_mode & 0o777, 0o644)
                reg.release()
                bad = locks / 'slot8.lease'
                bad.write_text('{}')
                os.chmod(bad, 0)
                if os.getuid() != 0:                   # root bypasses modes; covered on the server by check 6
                    self.assertEqual(s.LockRegistry(locks, locks / 'registry.lock').holders(),
                                     {'slot8': dict(issue=0, locks=['global'], allowed_paths=[])})
        finally:
            os.umask(old)

    def test_lease_is_live_only_while_its_process_lives(self):
        with tempfile.TemporaryDirectory() as tmp:
            locks = Path(tmp)
            (locks / 'registry.lock').touch()
            mine = s.LockRegistry(locks, locks / 'registry.lock')
            p = self.child(tmp, "r=s.LockRegistry(T,T/'registry.lock');"
                                "assert r.acquire('slot2',dict(issue=7,locks=['web:games'],allowed_paths=['apps/web/g/**']))")
            try:
                self.assertEqual(set(mine.holders()), {'slot2'})
                self.assertFalse(mine.acquire('slot1', self.rec(8, ['web:games:map'], ['apps/web/m/**'])))
                self.assertTrue(mine.acquire('slot1', self.rec(9, ['api:profiles'], ['apps/api/p/**'])))
                mine.release()
            finally:
                p.send_signal(signal.SIGKILL)
                p.wait()
            self.assertTrue((locks / 'slot2.lease').exists())          # crashed holder left its file
            self.assertEqual(mine.holders(), {})                        # but it is not live
            self.assertTrue(mine.acquire('slot1', self.rec(8, ['web:games:map'], ['apps/web/m/**'])))
            with self.assertRaises(s.Hold):
                mine.acquire('slot1', self.rec(10, ['web:x'], ['apps/web/x/**']))
            mine.release()
            self.assertFalse((locks / 'slot1.lease').exists())

    def test_single_integrator_across_processes_and_crash_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'integration.lock').touch()
            p = self.child(tmp, "m=s.IntegrationMutex(T/'integration.lock');assert m.try_acquire()")
            mine = s.IntegrationMutex(Path(tmp) / 'integration.lock')
            try:
                self.assertFalse(mine.try_acquire())
            finally:
                p.send_signal(signal.SIGKILL)
                p.wait()
            self.assertTrue(mine.try_acquire())
            self.assertTrue(mine.try_acquire())     # re-entrant in the holder
            mine.release()
            self.assertFalse(mine.held)

    def test_shared_api_clock_spaces_the_whole_host(self):
        with tempfile.TemporaryDirectory() as tmp:
            clock = s.ApiClock(Path(tmp) / 'api.clock', spacing=65)
            now = [1000.0]
            slept = []
            clock.wait(sleep=slept.append, now=lambda: now[0])
            other = s.ApiClock(Path(tmp) / 'api.clock', spacing=65)
            now[0] = 1010.0
            other.wait(sleep=slept.append, now=lambda: now[0])
            self.assertEqual(slept, [55.0])
            other.backoff(3600, now=lambda: 2000.0)
            clock.wait(sleep=slept.append, now=lambda: 2000.0)
            self.assertEqual(slept[-1], 3600.0)


class Budgets(unittest.TestCase):
    def budget(self, tmp, limits):
        h = host(tmp, limits)
        return s.Budget(h['config_root'] / 'budgets.json', h['state_root'] / 'outbox',
                        h['state_root'] / 'locks/registry.lock', today=lambda: '2026-10-19')

    def test_unknown_is_not_zero_and_blocks(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = self.budget(tmp, False)
            self.assertIs(b.remaining('codex', 'author'), s.UNKNOWN)
            with self.assertRaisesRegex(s.Hold, 'UNKNOWN'):
                b.charge('slot1', 'codex', 'author')
            self.assertEqual(s.adapter_status('codex', 'author', b, 'slot1')[0], False)
        with tempfile.TemporaryDirectory() as tmp:
            b = self.budget(tmp, {'providers': {'codex': {'author': 40}}, 'slots': {}})
            self.assertIs(b.remaining('codex', 'qa'), s.UNKNOWN)
            self.assertIs(b.remaining('codex', 'author', 'slot1'), s.UNKNOWN)   # per-slot limit missing
            self.assertEqual(b.remaining('codex', 'author'), 40)

    def test_ledgers_sum_across_slots_and_exhaust(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = self.budget(tmp, {'providers': {'codex': {'author': 3, 'qa': 40}},
                                  'slots': {'slot1': {'codex': {'author': 2, 'qa': 40}},
                                            'slot2': {'codex': {'author': 5, 'qa': 40}}}})
            self.assertEqual(b.charge('slot1', 'codex', 'author'), 1)
            self.assertEqual(b.charge('slot1', 'codex', 'author'), 0)
            with self.assertRaisesRegex(s.Hold, 'exhausted'):
                b.charge('slot1', 'codex', 'author')           # per-slot cap
            self.assertEqual(b.charge('slot2', 'codex', 'author'), 0)
            with self.assertRaisesRegex(s.Hold, 'exhausted'):
                b.charge('slot2', 'codex', 'author')           # host cap = sum of all ledgers
            self.assertEqual(b.used('codex', 'author'), 3)
            self.assertEqual(b.remaining('codex', 'qa', 'slot2'), 40)


class Adapters(unittest.TestCase):
    def test_only_codex_is_enabled_and_agy_is_never_qa(self):
        self.assertTrue(s.adapter_status('codex', 'qa')[0])
        self.assertFalse(s.adapter_status('cursor', 'author')[0])
        self.assertFalse(s.adapter_status('agy', 'review')[0])
        everything = s.Adapter('agy', 'agy', s.ROLES, *([True] * 6))
        for role in ('qa', 'author'):
            ok, reason = s.adapter_status('agy', role, adapters={'agy': everything})
            self.assertFalse(ok)
            self.assertIn('never', reason)
        self.assertEqual(s.adapter_for(task()), 'codex')
        self.assertEqual(s.adapter_for(task(model='gpt-6.1-sol', effort='high')), 'codex')
        with self.assertRaises(s.Hold):
            s.adapter_for(task(model='cursor-auto', effort='high'))
        with contextlib.redirect_stdout(open(os.devnull, 'w')) as sink:
            self.assertEqual(s.main(['adapters']), 0)
        sink.close()


def status(slot, active=None, done=(), parked=()):
    return dict(schema=s.STATUS_SCHEMA, slot=slot, active=active, done=list(done), parked=list(parked))


class Scheduler(unittest.TestCase):
    SLOTS = ['slot1', 'slot2']

    def plan(self, cands, statuses=None, assignments=None, max_parallel=2, budget=None, adapters=None):
        statuses = statuses if statuses is not None else {x: status(x) for x in self.SLOTS}
        return s.plan(cands, statuses, assignments or {}, self.SLOTS, max_parallel, budget, adapters)

    def test_disjoint_parallel_overlap_serial_and_capacity(self):
        cands = [(1, task(locks=['web:games'])), (2, task(locks=['web:games:map'], allowed_paths=['apps/web/m/**'])),
                 (3, task(locks=['api:profiles'], allowed_paths=['apps/api/p/**']))]
        result, reasons = self.plan(cands)
        self.assertEqual(result, {'slot1': 1, 'slot2': 3})
        self.assertIn('conflict', reasons[2])
        result, _ = self.plan(cands, max_parallel=1)
        self.assertEqual(result, {'slot1': 1})

    def test_dependencies_parked_dependency_and_done(self):
        cands = [(5, task(depends_on=[4], locks=['web:a'], allowed_paths=['apps/web/a/**']))]
        result, reasons = self.plan(cands)
        self.assertEqual((result, reasons[5]), ({}, 'waiting for dependencies'))
        st = {'slot1': status('slot1', done=[4]), 'slot2': status('slot2')}
        self.assertEqual(self.plan(cands, st)[0], {'slot1': 5})
        st = {'slot1': status('slot1', parked=[4]), 'slot2': status('slot2')}
        self.assertIn('parked', self.plan(cands, st)[1][5])

    def test_busy_slots_block_conflicts_and_never_double_assign(self):
        active = dict(issue=7, phase='ci', locks=['web:games'], allowed_paths=['apps/web/src/games/**'])
        st = {'slot1': status('slot1', active=active), 'slot2': status('slot2')}
        result, reasons = self.plan([(7, task()), (8, task(locks=['web:games:map']))], st)
        self.assertEqual(result, {})
        self.assertIn('conflict', reasons[8])
        result, _ = self.plan([(9, task(locks=['api:x'], allowed_paths=['apps/api/x/**']))], st)
        self.assertEqual(result, {'slot2': 9})
        asg = {'slot2': dict(issue=9, record=dict(issue=9, locks=['api:x'], allowed_paths=['apps/api/x/**']))}
        self.assertEqual(self.plan([(9, task(locks=['api:x'], allowed_paths=['apps/api/x/**']))], st, asg)[0], {})

    def test_solo_and_undeclared_run_alone(self):
        cands = [(1, task(locks=['web:x'], allowed_paths=['apps/web/x/**'])),
                 (2, task(locks=['migrations'], allowed_paths=['apps/api/db/**'])),
                 (3, task(allowed_paths=['apps/api/y/**']))]
        self.assertEqual(self.plan(cands)[0], {'slot1': 1})

    def test_unknown_or_exhausted_quota_is_never_scheduled(self):
        with tempfile.TemporaryDirectory() as tmp:
            h = host(tmp, False)
            budget = s.Budget(h['config_root'] / 'budgets.json', h['state_root'] / 'outbox',
                              h['state_root'] / 'locks/registry.lock')
            result, reasons = self.plan([(1, task())], budget=budget)
            self.assertEqual(result, {})
            self.assertIn('UNKNOWN', reasons[1])

    def test_slot_without_status_is_not_used_and_dry_run_cli(self):
        self.assertEqual(self.plan([(1, task())], {'slot2': status('slot2')})[0], {'slot2': 1})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 't.json'
            path.write_text(json.dumps([{'issue': 1, 'task': task(locks=['web:games'])},
                                        {'issue': 2, 'task': task(locks=['web:games:map'])}]))
            out = subprocess.run([sys.executable, '-B', str(HERE / 'slots.py'), 'plan', '--tasks', str(path)],
                                 capture_output=True, text=True, check=True).stdout
            self.assertEqual(json.loads(out)['parallel'], {'slot1': 1})

    def test_supervisor_tick_assigns_and_retires(self):
        with tempfile.TemporaryDirectory() as tmp:
            h = host(tmp)
            root = h['state_root']
            for x in self.SLOTS:
                s.atomic(root / 'outbox' / x / 'status.json', status(x), 0o644)
            cfg = dict(schema='GB_SLOT_SUPERVISOR_V1', slots=self.SLOTS, max_parallel=2,
                       approved_since=SINCE.isoformat(), poll=240)
            issues = [issue(41, locks=['web:games']), issue(42, locks=['web:games:map']),
                      issue(43, locks=['api:x'], allowed_paths=['apps/api/x/**'])]
            planned, reasons = s.tick(cfg, root, h['config_root'], fetch=lambda: (issues, []), a=a)
            self.assertEqual(planned, {'slot1': 41, 'slot2': 43})
            asg = s.read_json(root / 'assign/slot1.json')
            self.assertEqual((asg['issue'], asg['locks']), (41, ['web:games']))
            s.atomic(root / 'outbox/slot1/status.json', status('slot1', done=[41]), 0o644)
            planned, _ = s.tick(cfg, root, h['config_root'], fetch=lambda: (issues, []), a=a)
            self.assertEqual(planned, {'slot1': 42})


class Layout(unittest.TestCase):
    def test_every_slot_is_disjoint_and_names_are_closed(self):
        layouts = [s.Layout(f'slot{i}') for i in range(1, 9)]
        for x in layouts:
            for y in layouts:
                if x is not y:
                    self.assertTrue(s.disjoint(x.own(), y.own()))
            self.assertTrue(s.disjoint(x.own(), [s.LEGACY_STATE]))
        for bad in ('default', 'slot0', 'slot9', 'slot1/../slot2', '', None, 'SLOT1'):
            with self.subTest(bad=bad), self.assertRaises(s.Hold):
                s.Layout(bad)
        self.assertEqual(s.slot_user('slot1'), 'agentagency-dev')
        self.assertEqual(s.slot_user('slot2'), 'gb-slot2')

    def test_slot_paths_are_fixed_and_others_are_denied(self):
        with tempfile.TemporaryDirectory() as tmp, slot_mode(tmp, 'slot2') as rt:
            L = rt.layout
            rt.check_paths(L.repo, L.state_dir, L.worktrees)
            for bad in ((L.repo, L.state_dir, L.worktrees.parent), (L.repo, s.Layout('slot1', L.state_root,
                        L.slot_root).state_dir, L.worktrees), (L.repo, s.LEGACY_STATE, L.worktrees)):
                with self.assertRaises(s.Hold):
                    rt.check_paths(*bad)
            denied = rt.denied()
            self.assertIn(L.slot_root / 'slot1', denied)
            self.assertNotIn(L.root, denied)
            self.assertEqual(a.clean_env()['HOME'], str(L.home))
            self.assertEqual(a.KEY, L.home / '.ssh' / s.KEY_NAME)

    def test_slot1_keeps_the_legacy_account_without_copies(self):
        with tempfile.TemporaryDirectory() as tmp:
            default_env, default_key, reads = a.clean_env(), a.KEY, a.RUNTIME_READS
            with slot_mode(tmp, 'slot1') as rt:
                self.assertEqual(a.clean_env(), default_env)
                self.assertEqual(a.KEY, default_key)
                self.assertEqual(a.RUNTIME_READS, reads)
                self.assertEqual(rt.unit, 'gobadminton-slot@slot1.service')


class Migration(unittest.TestCase):
    def legacy(self, tmp, active=None):
        src = Path(tmp) / 'legacy'
        store = a.Store(src)
        store.data = {'active': active, 'done': [13, 30, 96]}
        store.save()
        a.atomic(src / 'parked.json', {'parked': [dict(issue=96, head=HEAD, attempt=3, park_comment=1,
                                                        allow_successors=[98], reason='x', snapshot={})]})
        a.atomic(src / 'qa-96-a3.json', dict(verdict='FAIL', findings=['x'], reviewed_sha=HEAD))
        (src / 'notes.txt').write_text('not state')
        return store, src

    def test_idle_copy_is_byte_identical_with_manifest_and_tombstone(self):
        with tempfile.TemporaryDirectory() as tmp:
            store, src = self.legacy(tmp)
            os.close(store.lock)
            dst = Path(tmp) / 'slots/slot1'
            before = {p.name: p.read_bytes() for p in src.iterdir()}
            dry = s.migrate_state(src, dst)
            self.assertFalse(dst.exists())
            self.assertEqual(set(dry['files']), {'state.json', 'parked.json', 'qa-96-a3.json'})
            manifest = s.migrate_state(src, dst, dry_run=False)
            for name, digest in manifest['files'].items():
                self.assertEqual((dst / name).read_bytes(), before[name])
                self.assertEqual(s._sha(dst / name), digest)
            self.assertFalse((dst / 'notes.txt').exists())
            self.assertEqual(os.stat(dst).st_mode & 0o777, 0o700)
            moved = a.Store(dst)
            try:
                self.assertEqual(moved.data['done'], [13, 30, 96])
                self.assertEqual([e['issue'] for e in moved.parked], [96])
            finally:
                os.close(moved.lock)
            self.assertTrue((src / s.RETIRED).exists())
            with self.assertRaisesRegex(s.Hold, 'retired'):
                s.migrate_state(src, Path(tmp) / 'other')

    def test_refuses_running_busy_or_non_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            store, src = self.legacy(tmp)
            with self.assertRaisesRegex(s.Hold, 'running'):
                s.migrate_state(src, Path(tmp) / 'dst', dry_run=False)   # worker.lock held
            os.close(store.lock)
            (Path(tmp) / 'full').mkdir()
            (Path(tmp) / 'full/x').touch()
            with self.assertRaisesRegex(s.Hold, 'not empty'):
                s.migrate_state(src, Path(tmp) / 'full', dry_run=False)
        with tempfile.TemporaryDirectory() as tmp:
            store, src = self.legacy(tmp, active=dict(issue=98, phase='ci', task=task()))
            os.close(store.lock)
            with self.assertRaisesRegex(s.Hold, 'not idle'):
                s.migrate_state(src, Path(tmp) / 'dst', dry_run=False)
            self.assertFalse((Path(tmp) / 'dst').exists())
            self.assertFalse((src / s.RETIRED).exists())


class SlotExecutor(unittest.TestCase):
    def store(self, rt):
        rt.layout.state_dir.parent.mkdir(parents=True, exist_ok=True)
        return a.Store(rt.layout.state_dir)

    def test_claims_only_the_assigned_issue_and_takes_its_lease(self):
        with tempfile.TemporaryDirectory() as tmp, slot_mode(tmp) as rt:
            st = self.store(rt)
            try:
                with patch.object(a, 'api', side_effect=AssertionError('no read')), \
                        patch.object(a, 'pages', side_effect=AssertionError('no read')):
                    self.assertIsNone(a.discover(st, SINCE))              # nothing assigned
                assign(rt, 40)
                reads = []
                with patch.object(a, 'api', side_effect=lambda p: reads.append(p) or issue(40)), \
                        patch.object(a, 'pages', side_effect=lambda p, key=None: reads.append(p) or []):
                    active = a.discover(st, SINCE)
                self.assertEqual(active['issue'], 40)
                self.assertEqual(reads[0], 'issues/40')
                self.assertTrue(reads[1].startswith('issues/40/comments?since='))
                self.assertEqual(set(rt.registry.holders()), {'slot1'})
                published = json.loads((rt.layout.outbox / 'status.json').read_text())
                self.assertEqual((published['active']['issue'], published['active']['locks']), (40, ['global']))
                other = s.LockRegistry(rt.layout.locks, rt.layout.registry)
                self.assertFalse(other.acquire('slot2', s.task_record(41, task(locks=['api:x'],
                                                                                allowed_paths=['apps/api/**']))))
            finally:
                rt.release_lease()
                os.close(st.lock)

    def test_untrusted_assignment_owner_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp, slot_mode(tmp) as rt:
            assign(rt, 40)
            rt.trusted_assigners = {0}
            with self.assertRaises(s.Hold):
                rt.assignment()
            rt.trusted_assigners = {os.getuid()}
            os.chmod(rt.layout.assignment, 0o666)
            with self.assertRaises(s.Hold):
                rt.assignment()

    def test_budget_is_charged_before_any_model_call(self):
        with tempfile.TemporaryDirectory() as tmp, slot_mode(tmp, budgets={
                'providers': {'codex': {'author': 0, 'qa': 1}}, 'slots': {'slot1': {'codex': {'author': 5, 'qa': 1}}}}) as rt:
            st = self.store(rt)
            try:
                st.data['active'] = dict(issue=40, task=task(), phase='developing')
                bridge = a.Bridge(types.SimpleNamespace(codex='/bin/false', state_dir=rt.layout.state_dir,
                                                        model_timeout=30), st)
                bridge.work = Path(tmp)
                bridge.git = lambda *x, **k: str(Path(tmp))
                with patch.object(a, 'run', side_effect=AssertionError('model must not run')), \
                        self.assertRaisesRegex(a.Hold, 'exhausted'):
                    bridge.model('prompt')
                self.assertFalse((rt.layout.outbox / 'ledger.json').exists())
            finally:
                os.close(st.lock)

    def test_api_reads_use_the_host_clock(self):
        with tempfile.TemporaryDirectory() as tmp, slot_mode(tmp) as rt:
            calls = []
            rt.clock.wait = lambda: calls.append('wait')
            rt.clock.backoff = lambda sec: calls.append(('backoff', sec))
            response = unittest.mock.MagicMock()
            response.__enter__.return_value.read.return_value = b'{}'
            with patch.object(a, '_API_NEXT', 0), patch.object(a.urllib.request, 'urlopen', return_value=response):
                a._api_once('issues')
            with patch.object(a, '_API_NEXT', 0), patch.object(a.urllib.request, 'urlopen',
                    side_effect=a.urllib.error.HTTPError('u', 403, 'q', {}, None)), self.assertRaises(a.QuotaWait):
                a._api_once('issues')
            self.assertEqual(calls, ['wait', 'wait', ('backoff', 3600)])
            a._API_NEXT = 0

    def flow(self, tmp, rt, merge_fails=False, changed='apps/web/src/games/map.ts', drift=True):
        st = self.store(rt)
        active = st.claim([issue(40)], SINCE)
        qa = dict(verdict='PASS', findings=[], reviewed_sha=HEAD)
        st.phase('ci', base=BASE, head=HEAD, pr=70, attempt=1, qa=qa)
        a.atomic(st.directory / 'qa-40-a1.json', qa)
        bridge = a.Bridge(types.SimpleNamespace(worktrees_root=rt.layout.worktrees, state_dir=st.directory,
                                                poll=120), st)
        log, remote, head = [], [DRIFT if drift else BASE], [HEAD]
        bridge.unchanged_issue = lambda x: None
        bridge.clean = lambda sha: a.require(sha == head[0], 'dirty')
        bridge.remote_dev = lambda: remote[0]
        bridge.wait_run = lambda x, dev=False: dict(sha=x['head'], id=3, attempt=1, run_attempt=1)
        bridge.wait_pr = lambda x: 70

        def review(x):
            result = dict(verdict='PASS', findings=[], reviewed_sha=x['head'])
            a.atomic(st.directory / f'qa-40-a{x["attempt"]}{a.integ(x)}.json', result)
            st.phase('qa', qa=result)
            log.append(('qa', x['head']))
            return True
        bridge.review = review

        def git(*args, **kw):
            log.append(args)
            if 'merge' in args and '--abort' not in args and '--is-ancestor' not in args and merge_fails:
                raise a.Hold('command failed: git (output withheld)')
            if 'merge' in args and '--no-ff' in args:
                head[0] = NEW
            if args[0] == 'rev-parse':
                return head[0]
            if args[0] == 'diff' and '--name-only' in args:
                return changed + '\0'
            if args[0] == 'push' and 'refs/heads/dev' in args[-1]:
                remote[0] = args[-1].split(':')[0]
            if args[0] == 'merge-base' and '--is-ancestor' not in args:
                return remote[0]
            return ''
        bridge.git = git
        return st, active, bridge, log

    def test_drift_integrates_onto_new_dev_then_fresh_qa_ci_then_ff_deploy(self):
        with tempfile.TemporaryDirectory() as tmp, slot_mode(tmp) as rt:
            st, active, bridge, log = self.flow(tmp, rt)
            try:
                with patch.object(a, 'server_evidence', return_value={'accepted': {'ok': 1}}), \
                        patch.object(a, 'api', return_value={'gitSha': NEW}):
                    bridge.execute(active)
                live = st.data['active']
                self.assertEqual((live['phase'], live['base'], live['head'], live['integration']),
                                 ('done', DRIFT, NEW, 1))
                self.assertEqual(live['history'][-1]['integrated_onto'], DRIFT)
                self.assertEqual(live['history'][-1]['head'], HEAD)
                self.assertIn(('qa', NEW), log)                              # full QA on the NEW sha
                self.assertTrue((st.directory / 'qa-40-a1-i1.json').exists())
                self.assertEqual(json.loads((st.directory / 'qa-40-a1.json').read_text())['reviewed_sha'], HEAD)
                pushes = [x for x in log if x[0] == 'push']
                self.assertEqual([p[-1] for p in pushes], [f'{NEW}:refs/heads/automation/issue-40',
                                                           f'{NEW}:refs/heads/dev'])
                self.assertFalse([x for x in log if any(f in x for f in ('--force', '-f', 'rebase', 'reset'))])
                self.assertFalse(rt.mutex.held)                              # released after ACCEPTED
                self.assertTrue(s.IntegrationMutex(rt.layout.integration).try_acquire())
            finally:
                os.close(st.lock)

    def test_no_drift_keeps_the_legacy_path_under_the_mutex(self):
        with tempfile.TemporaryDirectory() as tmp, slot_mode(tmp) as rt:
            st, active, bridge, log = self.flow(tmp, rt, drift=False)
            try:
                with patch.object(a, 'server_evidence', return_value={'accepted': {'ok': 1}}), \
                        patch.object(a, 'api', return_value={'gitSha': HEAD}):
                    bridge.execute(active)
                self.assertEqual((st.data['active']['phase'], st.data['active']['head']), ('done', HEAD))
                self.assertNotIn('integration', st.data['active'])
                self.assertFalse([x for x in log if 'merge' in x and '--no-ff' in x])
            finally:
                os.close(st.lock)

    def test_conflict_and_out_of_scope_integration_fail_closed(self):
        for options, reason in (({'merge_fails': True}, 'integration conflict'),
                                ({'changed': 'apps/api/src/other.ts'}, 'untrusted modified path')):
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as tmp, slot_mode(tmp) as rt:
                st, active, bridge, log = self.flow(tmp, rt, **options)
                try:
                    with self.assertRaisesRegex(a.Hold, reason):
                        bridge.execute(active)
                    self.assertEqual((st.data['active']['phase'], st.data['active']['head']), ('ci', HEAD))
                    if options.get('merge_fails'):
                        self.assertIn(('merge', '--abort'), log)
                    self.assertFalse([x for x in log if x[0] == 'push'])
                    self.assertFalse(rt.mutex.held)
                finally:
                    os.close(st.lock)

    def test_quota_wait_keeps_the_merge_queue_position(self):
        with tempfile.TemporaryDirectory() as tmp, slot_mode(tmp) as rt:
            st, active, bridge, log = self.flow(tmp, rt, drift=False)
            try:
                with patch.object(a, 'api', side_effect=a.QuotaWait()), \
                        patch.object(a, 'server_evidence', return_value={'accepted': {}}), \
                        self.assertRaises(a.QuotaWait):
                    bridge.execute(active)
                self.assertEqual(st.data['active']['phase'], 'dev_wait')
                self.assertTrue(rt.mutex.held)
                self.assertFalse(s.IntegrationMutex(rt.layout.integration).try_acquire())
                with patch.object(a, 'server_evidence', return_value={'accepted': {'ok': 1}}), \
                        patch.object(a, 'api', return_value={'gitSha': HEAD}):
                    bridge.execute(st.data['active'], recovery=True)
                self.assertEqual(st.data['active']['phase'], 'done')
                self.assertFalse(rt.mutex.held)
            finally:
                os.close(st.lock)

    def test_busy_merge_queue_waits_without_checkpoint_change(self):
        with tempfile.TemporaryDirectory() as tmp, slot_mode(tmp) as rt:
            st, active, bridge, log = self.flow(tmp, rt)
            holder = s.IntegrationMutex(rt.layout.integration)
            fd = os.open(rt.layout.integration, os.O_RDONLY)
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_EX)       # another integrator
            try:
                before = copy.deepcopy(st.data)
                with patch.object(a.time, 'sleep', side_effect=KeyboardInterrupt), self.assertRaises(KeyboardInterrupt):
                    bridge.execute(active)
                after = copy.deepcopy(st.data)
                before['active'].pop('ci'), after['active'].pop('ci')
                self.assertEqual(after, before)
                self.assertFalse([x for x in log if x[0] in ('push', 'merge') or 'merge' in x])
            finally:
                os.close(fd)
                holder.release()
                os.close(st.lock)


if __name__ == '__main__':
    unittest.main()

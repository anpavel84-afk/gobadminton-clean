"""Concrete commissioning regressions: local Git/files only, no live services or API."""
import copy
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import tomllib
import unittest
from unittest.mock import patch

from test_slots import a, s, host, slot_mode, task, SINCE
import test_continuity as train_tests
from test_continuity_installer import fake_root, i

HERE = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


w = module('v2_writer', HERE / 'parallel-slots/monitor-src/writer.py')
old_writer = module('original_writer', HERE.parents[1] / 'pinned-originals/writer.py')
telemetry = module('v2_telemetry', HERE / 'parallel-slots/monitor-src/slot_telemetry.py')


class Commissioning(unittest.TestCase):
    train = train_tests.ContinuityTrain.train

    def test_literal_deployed_origin_with_exact_explicit_github_transports(self):
        with self.train() as t:
            for direction in ((), ('--push',)):
                for repo in (t.repo, t.second):
                    self.assertEqual(t.git('remote', 'get-url', '--all', *direction, 'origin', cwd=repo),
                                     '/srv/gb-slots/base.git')
            t.bridge.transport_identity()
            t.bridge.candidate_identity(t.active)
            t.bridge.resume(t.active)
            t.bridge.execute(t.active, recovery=True)
            self.assertEqual(t.active['phase'], 'done')
            self.assertTrue(any('push' in argv and a.WRITE_REMOTE in argv for argv in t.transports))
            self.assertTrue(any('ls-remote' in argv and a.READ_REMOTE in argv for argv in t.transports))

    def test_transport_rejects_other_local_push_urls_rewrites_and_commands(self):
        for key, value in (('remote.origin.url', '/srv/gb-slots/other.git'),
                           ('remote.origin.pushurl', '/srv/gb-slots/other.git'),
                           ('url./srv/gb-slots/base.git.insteadOf', a.READ_REMOTE),
                           ('core.sshCommand', 'false'), ('core.gitProxy', 'false')):
            with self.subTest(key=key), self.train() as t:
                t.git('config', '--local', key, value)
                with self.assertRaises(a.Hold):
                    t.bridge.transport_identity()
        with self.train() as t, patch.object(a, '_SLOTS', None):
            with self.assertRaisesRegex(a.Hold, 'Git remote changed'):
                t.bridge.transport_identity()

    def test_real_runtime_publications_pass_exact_supplied_v1_writer(self):
        with self.train() as t:
            t.active['wait'] = {'reason': 'private evidence', 'until': 9999999999}
            t.rt.publish(t.st.data, [dict(issue=39, kind='policy', reason='private evidence')])
            value = json.loads((t.rt.layout.outbox / 'status.json').read_text())
            self.assertEqual(old_writer._slot_status(value, t.rt.slot), value)
            self.assertNotIn('private evidence', json.dumps(value))
            t.active['phase'] = 'integrating'
            t.rt.publish(t.st.data, [])
            value = json.loads((t.rt.layout.outbox / 'status.json').read_text())
            self.assertEqual(w._slot_status(value, t.rt.slot), value)
            t.rt.publish({'active': None, 'done': []}, [])
            old_writer._slot_status(json.loads((t.rt.layout.outbox / 'status.json').read_text()), t.rt.slot)

    def test_integration_projection_and_validator_do_not_export_old_gates_as_pass(self):
        with self.train() as t:
            active = copy.deepcopy(t.active)
            active.update(phase='integrating', qa=t.qa,
                          ci={'id': 1, 'sha':t.head, 'jobs':[{'conclusion':'success'}]},
                          integration_target=t.dev, reason='private evidence')
            projected = telemetry.project(active)
            self.assertEqual(projected['phase'], 'integrating')
            self.assertEqual(projected['qa'], {'verdict':None, 'reviewed_sha':None})
            self.assertIsNone(projected['ci'])
            value = dict(schema='GB_SLOT_TELEMETRY_V1', slot='slot1', at=1, checkpoint_at=1,
                         checkpoint_status='OK', process=dict(active='active', sub='running', pid=1),
                         task=projected)
            telemetry.validate(value, 'slot1')
            self.assertNotIn('private evidence', json.dumps(value))
            for gate in ('qa', 'ci'):
                bad = copy.deepcopy(value)
                bad['task'][gate] = (dict(verdict='PASS', reviewed_sha=t.head) if gate == 'qa' else
                    dict(total=1, passed=1, failed=0, pending=0, sha=t.head, run_id=1, result='PASS'))
                with self.assertRaisesRegex(ValueError, 'integration gates pending'):
                    telemetry.validate(bad, 'slot1')
            # A new candidate cannot inherit the old candidate's PASS either.
            active.update(phase='candidate', head=t.dev)
            result = telemetry.project(active)
            self.assertEqual(result['qa']['verdict'], 'MISMATCH')
            self.assertEqual(result['ci']['result'], 'MISMATCH')

    def test_runtime_telemetry_writer_integration_reaches_real_monitor_card(self):
        with self.train() as t:
            t.st.phase('integrating', integration_target=t.dev,
                       ci=dict(id=1, sha=t.head, jobs=[dict(conclusion='success')]))
            now = datetime.datetime.now(datetime.timezone.utc)
            value = dict(schema='GB_SLOT_TELEMETRY_V1', slot='slot1', at=int(now.timestamp()),
                         checkpoint_at=int(now.timestamp()), checkpoint_status='OK',
                         process=dict(active='active', sub='running', pid=123), task=telemetry.project(t.active))
            s.atomic(t.rt.layout.outbox / 'telemetry.json', value, 0o644)
            telemetry_path = str(HERE / 'parallel-slots/monitor-src/slot_telemetry.py')
            source = (HERE / 'parallel-slots/monitor-src/writer.py').read_text().replace(
                '/usr/local/lib/gb-ops-monitor/opsmon/slot_telemetry.py', telemetry_path)
            namespace = {'__name__':'offline_writer', '__file__':str(HERE / 'parallel-slots/monitor-src/writer.py')}
            exec(compile(source, 'offline_writer', 'exec'), namespace)
            cards, values = namespace['slot_publications'](str(t.rt.layout.outbox.parent), now,
                                                         {'slot1':os.getuid(), 'slot2':os.getuid()})
            self.assertEqual(cards[0]['status'], 'FRESH')
            self.assertEqual(values['slot1']['active']['phase'], 'integrating')
            observed = cards[0]['telemetry_task']
            self.assertEqual(observed['phase'], 'integrating')
            self.assertIsNone(observed['qa']['verdict'])
            self.assertIsNone(observed['ci'])

    def test_busy_supervisor_returns_before_any_fetch_or_budget_read(self):
        for assignment_only in (False, True):
            with self.subTest(assignment_only=assignment_only), tempfile.TemporaryDirectory() as tmp:
                roots = host(tmp)
                for n, slot in enumerate(('slot1', 'slot2')):
                    record = s.task_record(40+n, task())
                    if assignment_only:
                        s.atomic(roots['state_root'] / 'assign' / (slot+'.json'),
                                 dict(schema=s.ASSIGN_SCHEMA, slot=slot, issue=40+n, assigned_at=1,
                                      locks=record['locks'], allowed_paths=record['allowed_paths']))
                    s.atomic(roots['state_root'] / 'outbox' / slot / 'status.json',
                             dict(schema=s.STATUS_SCHEMA, slot=slot, done=[], parked=[],
                                  active=None if assignment_only else dict(record, phase='ci')))
                with patch.object(a, 'pages', side_effect=AssertionError('network forbidden')), \
                        patch.object(s, 'Budget', side_effect=AssertionError('cheap return required')):
                    cfg = dict(slots=['slot1','slot2'], max_parallel=2, approved_since=SINCE.isoformat())
                    def no_fetch():
                        raise AssertionError('fetch forbidden when both slots busy')
                    for fetch in (no_fetch, None):
                        planned, reasons = s.tick(cfg, roots['state_root'], roots['config_root'], fetch=fetch, a=a)
                        self.assertEqual(planned, {})
                        self.assertEqual(reasons, {'queue':'busy: no free slot/capacity'})

    def test_archive_checkpoint_release_and_public_free_order_for_policy_and_owner(self):
        for automatic in (True, False):
            with self.subTest(automatic=automatic), self.train() as t:
                t.st.phase('blocked', attempt=3)
                a.atomic(t.st.directory / 'qa-40-a3.json', t.qa)
                t.rt.lease(t.active)
                self.assertTrue(t.rt.mutex.try_acquire())
                events = []
                atomic, release, mutex_release, publish = a.atomic, t.rt.release_lease, t.rt.mutex.release, t.rt.publish
                def checkpoint(path, value):
                    atomic(path, value)
                    if path in (t.st.deferred_path, t.st.parked_path):
                        events.append('archive')
                    elif path == t.st.path:
                        self.assertIsNone(value['active']); events.append('checkpoint')
                def unlock():
                    self.assertIsNone(json.loads(t.st.path.read_text())['active'])
                    release(); events.append('lease')
                def unmutex():
                    mutex_release(); events.append('mutex')
                def public(data, parked):
                    self.assertIsNone(t.rt.registry.fd)
                    self.assertFalse(t.rt.mutex.held)
                    self.assertIsNone(data['active'])
                    publish(data, parked)
                    w._slot_status(json.loads((t.rt.layout.outbox / 'status.json').read_text()), 'slot1')
                    # A conflicting successor can take the real registry lock at publication time.
                    successor = s.LockRegistry(t.rt.layout.locks, t.rt.layout.registry)
                    try:
                        self.assertTrue(successor.acquire('slot2', s.task_record(41, task())))
                    finally:
                        successor.release()
                    events.append('free')
                with patch.object(a, 'atomic', side_effect=checkpoint), \
                        patch.object(t.rt, 'release_lease', side_effect=unlock), \
                        patch.object(t.rt.mutex, 'release', side_effect=unmutex), \
                        patch.object(t.rt, 'publish', side_effect=public):
                    if automatic:
                        self.assertTrue(t.bridge.defer(t.active))
                    else:
                        t.bridge.finish_park(dict(issue=40, head=t.head, attempt=3, park_comment=888,
                            allow_successors=[], reason='Owner PARK', snapshot=copy.deepcopy(t.active)))
                self.assertEqual(events, ['archive', 'checkpoint', 'mutex', 'lease', 'free'])
                self.assertEqual(t.st.data['done'], [])

    def test_owner_dirty_or_unfinished_writer_keeps_exclusion_and_active_checkpoint(self):
        for unfinished in (True, False):
            with self.subTest(unfinished=unfinished), self.train() as t:
                t.rt.lease(t.active)
                if unfinished:
                    marker = Path(t.git('rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD', cwd=t.work))
                    marker.write_text(t.dev+'\n')
                else:
                    (t.work / t.web).write_text('dirty\n')
                before = t.st.path.read_bytes()
                with self.assertRaises(a.Hold):
                    t.bridge.finish_park(dict(issue=40, head=t.head, attempt=2))
                self.assertEqual(t.st.path.read_bytes(), before)
                self.assertIsNotNone(t.rt.registry.fd)
                self.assertFalse(t.st.parked_path.exists())

    def test_checkpointed_deferral_recovers_release_or_publication_failure_without_network(self):
        for boundary in ('release_lease', 'publish'):
            with self.subTest(boundary=boundary), self.train() as t:
                t.st.phase('blocked', attempt=3)
                a.atomic(t.st.directory / 'qa-40-a3.json', t.qa)
                t.rt.lease(t.active)
                with patch.object(t.rt, boundary, side_effect=train_tests.Crash), self.assertRaises(train_tests.Crash):
                    t.bridge.defer(t.active)
                self.assertIsNone(json.loads(t.st.path.read_text())['active'])
                self.assertEqual(json.loads(t.st.deferred_path.read_text())['deferred'][0]['issue'], 40)
                self.assertIsNotNone(json.loads((t.rt.layout.outbox / 'status.json').read_text())['active'])
                with patch.object(a, 'api', side_effect=AssertionError('no re-admission or network')):
                    self.assertIsNone(a.slot_discover(t.st, SINCE))
                self.assertIsNone(t.rt.registry.fd)
                self.assertFalse(t.rt.mutex.held)
                value = json.loads((t.rt.layout.outbox / 'status.json').read_text())
                old_writer._slot_status(value, 'slot1')
                self.assertIsNone(value['active'])
                self.assertEqual(value['parked'], [40])


class PublicStyleGuide(unittest.TestCase):
    def test_exact_read_only_permission_for_both_roles_and_slots_retains_denials(self):
        for name in ('slot1', 'slot2'):
            with tempfile.TemporaryDirectory() as tmp, slot_mode(tmp, name) as rt:
                root = Path(tmp)
                for qa in (False, True):
                    def config():
                        return tomllib.loads(a.permission_config(root/'work', root/'job', root/'git',
                            root/'state', qa, rt.denied()))['permissions']['gb-task']
                    current = config()
                    with patch.object(a, '_SLOTS', None):
                        baseline = config()
                    self.assertFalse(current['network']['enabled'])
                    fs = current['filesystem']
                    self.assertEqual(fs[str(a.STYLE_GUIDE)], 'read')
                    self.assertEqual(fs[str(a.STYLE_GUIDE.parent)], 'deny')
                    self.assertEqual(fs[str(a.KEY.parent.resolve())], 'deny')
                    self.assertEqual(fs[str(root/'state')], 'deny')
                    self.assertEqual(fs[':root'], 'deny')
                    for path in rt.denied():
                        self.assertEqual(fs[str(path.resolve())], 'deny')
                    self.assertEqual({k:v for k,v in fs.items() if k not in
                                      (str(a.STYLE_GUIDE), str(a.STYLE_GUIDE.parent))}, baseline['filesystem'])

    def test_frozen_tree_trust_and_pins_for_runtime_and_root_installer(self):
        self.assertEqual(a.STYLE_PINS, i.STYLE_PINS)
        for module_ in (a, i):
            for bad in (None, 'parent_link', 'directory_link', 'file_link', 'writable', 'owner', 'hash', 'refs'):
                with self.subTest(module=module_.__name__, bad=bad), tempfile.TemporaryDirectory() as tmp, fake_root():
                    root = Path(tmp); public = root/'public'; public.mkdir(mode=0o755)
                    (public/'src').mkdir(mode=0o755); (public/'refs').mkdir(mode=0o755)
                    for directory in (public, public/'src', public/'refs'):
                        directory.chmod(0o755)
                    pins = {}
                    for name in ('src/App.tsx','src/index.css'):
                        path = public/name; path.write_text('frozen '+name); path.chmod(0o644)
                        pins[name] = hashlib.sha256(path.read_bytes()).hexdigest()
                    if bad == 'parent_link':
                        link = root/'link'; link.symlink_to(public, target_is_directory=True); public = link
                    elif bad in ('directory_link', 'file_link'):
                        path = public/('refs' if bad == 'directory_link' else 'src/App.tsx')
                        target = root/'outside'; path.rename(target); path.symlink_to(target)
                    elif bad == 'writable':
                        public.chmod(0o777)
                    elif bad == 'owner':
                        real = Path.lstat
                        def wrong_owner(path):
                            info = real(path)
                            if path == public:
                                values = list(info); values[4] = 1234; return os.stat_result(values)
                            return info
                        owner_patch = patch.object(Path, 'lstat', wrong_owner)
                    elif bad == 'hash':
                        (public/'src/App.tsx').write_text('changed')
                    elif bad == 'refs':
                        (public/'refs').rmdir()
                    with patch.object(module_, 'STYLE_GUIDE', public), patch.object(module_, 'STYLE_PINS', pins):
                        if bad is None:
                            module_.validate_style_guide()
                        elif bad == 'owner':
                            with owner_patch, self.assertRaises((a.Hold, RuntimeError, OSError)):
                                module_.validate_style_guide()
                        else:
                            with self.assertRaises((a.Hold, RuntimeError, OSError)):
                                module_.validate_style_guide()


if __name__ == '__main__':
    unittest.main()

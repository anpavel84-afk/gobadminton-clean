"""Author regressions only: disposable Git/runtime; pinned historical objects required.

No live sync, notice edits, executor launch or independent QA verdict.
"""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

import autopilot
import backlog_sync
import test_backlog_sync_v001 as base
from test_backlog_sync_v001 import git, task

PLANNING = 'system-safe-planning-' + '922f228121a490a63530c0e6e3ca4c9707cd2944'
NOTICE = 'system-admission-drift-c6c97366f4e7c5a7'
PATH = 'docs/manifest/PM_ADMISSION_PHANTOM_TEST_V001.md'
OLD_MAIN = '922f228121a490a63530c0e6e3ca4c9707cd2944'
BAD_MAIN = '033a99a8c9c755ffac5f7814c277b55a79c5aae6'
CURRENT_MAIN = '65fd416b30238cc9eb7e95555a17bd9cb0beb374'


class PhantomRepairTests(unittest.TestCase):
    setUp = base.BacklogSyncTests.setUp
    restore_runner = base.BacklogSyncTests.restore_runner
    update_canonical = base.BacklogSyncTests.update_canonical

    def sync(self, **kwargs):
        result = backlog_sync.sync_once(self.work, self.runtime, **kwargs)
        self.assertIn(result['status'], {'SYNCED', 'IN_SYNC', 'WOULD_SYNC'}, result)
        return result

    def publish_doc(self, ids, tasks=None):
        (self.work / PATH).write_text('# PM ADMITTED\n' + ' '.join('`' + x + '`' for x in ids))
        git(self.work, 'add', PATH)
        self.update_canonical(tasks or [self.web, self.api])

    def seed_prior(self, ids, token='c6c97366f4e7c5a7'):
        meta = self.runtime / 'backlog-sync-state.json'
        data = json.loads(meta.read_text())
        finding = {'admission_path': PATH, 'disabled_queued_task_ids': ids,
                   'diagnostic_id': token, 'detected_commit': data['canonical_commit'],
                   'reason': 'historically persisted admission drift'}
        data['admission_drift'] = [finding]
        meta.write_text(json.dumps(data))
        return finding

    def test_new_synthetic_references_do_not_discover_tasks(self):
        self.sync()
        self.publish_doc([PLANNING, NOTICE, self.web['id'], self.api['id']])
        for _ in range(3):
            result = self.sync()
            self.assertEqual(result['admission_drift'], [])
            with mock.patch.object(autopilot, 'OWNER_INBOX_DIR', self.runtime / 'owner-inbox'):
                self.assertEqual(autopilot.enqueue_admission_reconcile_notice(result), [])
        self.assertFalse((self.runtime / 'owner-inbox').exists())

    def test_real_missing_disabled_and_unknown_system_tokens_remain(self):
        self.sync()
        unknown = ['system-safe-planning-untrusted', 'system-safe-planning-' + 'a' * 39,
                   'system-safe-planning-' + 'a' * 41, PLANNING + '-extra',
                   'system-admission-drift-' + 'b' * 15, 'system-admission-drift-' + 'b' * 17,
                   'system-other-' + 'c' * 40, 'real-missing-admission-v001']
        disabled = task('real-disabled-v001', enabled=False, ref=self.ref)
        self.publish_doc([PLANNING, NOTICE, disabled['id']] + unknown,
                         [self.web, self.api, disabled])
        result = self.sync()
        self.assertEqual(result['admission_drift'][0]['disabled_queued_task_ids'],
                         sorted(unknown + [disabled['id']]))
        for tid in [PLANNING.upper(), NOTICE.upper(), PLANNING + '\n', 'system-safe-planning-' + 'g' * 40]:
            self.assertFalse(backlog_sync.is_synthetic_admission_reference(tid, {}))

    def test_known_disabled_tasks_never_hidden_by_synthetic_shape(self):
        self.sync()
        tasks = [self.web, self.api] + [task(x, enabled=False, ref=self.ref) for x in [PLANNING, NOTICE]]
        self.publish_doc([PLANNING, NOTICE], tasks)
        self.assertEqual(self.sync()['admission_drift'][0]['disabled_queued_task_ids'], sorted([PLANNING, NOTICE]))
        self.seed_prior([PLANNING, NOTICE])
        self.assertEqual(self.sync()['admission_drift'][0]['disabled_queued_task_ids'], [PLANNING, NOTICE])

    def test_persisted_phantom_clears_without_touching_original_notices(self):
        self.sync()
        finding = self.seed_prior([PLANNING, NOTICE])
        with mock.patch.object(autopilot, 'OWNER_INBOX_DIR', self.runtime / 'owner-inbox'):
            autopilot.enqueue_admission_reconcile_notice({'admission_drift': [finding]})
        protected = {p: p.read_bytes() for p in self.runtime.rglob('*.json')
                     if p.name != 'backlog-sync-state.json'}
        self.assertEqual(self.sync(dry_run=True)['admission_drift'], [])
        self.assertEqual(json.loads((self.runtime / 'backlog-sync-state.json').read_text())['admission_drift'], [finding])
        for _ in range(3):
            self.assertEqual(self.sync()['admission_drift'], [])
        for p, raw in protected.items():
            self.assertEqual(p.read_bytes(), raw, p)

    def test_undelivered_persisted_phantom_also_clears(self):
        self.sync()
        self.seed_prior([PLANNING, NOTICE])
        self.assertEqual(self.sync()['admission_drift'], [])
        self.assertFalse((self.runtime / 'owner-inbox').exists())

    def test_mixed_drift_retains_real_ids_and_stable_one_time_alert(self):
        self.sync()
        self.seed_prior([PLANNING, 'real-missing-v001', NOTICE])
        result = self.sync()
        finding = result['admission_drift'][0]
        self.assertEqual(finding['disabled_queued_task_ids'], ['real-missing-v001'])
        self.assertEqual(finding['diagnostic_id'], 'c6c97366f4e7c5a7')
        with mock.patch.object(autopilot, 'OWNER_INBOX_DIR', self.runtime / 'owner-inbox'):
            notice_ids = autopilot.enqueue_admission_reconcile_notice(result)
            notice_path = self.runtime / 'owner-inbox' / (notice_ids[0] + '.json')
            original = notice_path.read_bytes()
            for i in range(3):
                self.publish_doc([PLANNING, NOTICE], [self.web, {**self.api, 'notes': 'FF cycle ' + str(i)}])
                result = self.sync()
                self.assertEqual(result['admission_drift'][0], finding)
                self.assertEqual(autopilot.enqueue_admission_reconcile_notice(result), notice_ids)
                self.assertEqual(notice_path.read_bytes(), original)
            self.assertEqual(len(list((self.runtime / 'owner-inbox').glob('*.json'))), 1)

    def test_materialized_real_drift_waits_for_delivery_then_clears(self):
        self.sync()
        self.seed_prior([PLANNING, self.api['id'], NOTICE])
        result = self.sync()
        self.assertEqual(result['admission_drift'][0]['disabled_queued_task_ids'], [self.api['id']])
        with mock.patch.object(autopilot, 'OWNER_INBOX_DIR', self.runtime / 'owner-inbox'):
            autopilot.enqueue_admission_reconcile_notice(result)
        self.assertEqual(self.sync()['admission_drift'], [])

    def test_blocked_sync_does_not_clean_metadata_prematurely(self):
        self.sync()
        finding = self.seed_prior([PLANNING])
        self.publish_doc([PLANNING], [{**self.web, 'source': self.web['source'].replace('test.md', 'absent.md')}, self.api])
        before = (self.runtime / 'backlog-sync-trust.json').read_bytes()
        result = backlog_sync.sync_once(self.work, self.runtime)
        self.assertEqual(result['status'], 'BLOCKED')
        self.assertEqual(result['admission_drift'], [finding])
        self.assertEqual((self.runtime / 'backlog-sync-trust.json').read_bytes(), before)


class HistoricalMainReplayTests(unittest.TestCase):
    def test_real_old_offending_and_current_main_with_existing_bad_diagnostic(self):
        source = Path(__file__).resolve().parents[3]
        with tempfile.TemporaryDirectory(prefix='gb-phantom-main-replay-') as tmp:
            root = Path(tmp); remote = root / 'remote.git'; work = root / 'objects'; runtime = root / 'runtime'
            runtime.mkdir()
            # Shared clones read original Git objects, but every ref/runtime write
            # stays inside this disposable directory. No checkout or external fetch.
            subprocess.run(['git', 'clone', '-q', '--shared', '--bare', str(source), str(remote)], check=True)
            git(remote, 'update-ref', 'refs/heads/main', OLD_MAIN)
            git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/main')
            subprocess.run(['git', 'clone', '-q', '--shared', '--no-checkout', str(remote), str(work)], check=True)
            def blob(ref):
                return subprocess.check_output(['git', '-C', str(work), 'show', ref + ':' + backlog_sync.CANONICAL_PATH])
            (runtime / 'backlog.json').write_bytes(blob(OLD_MAIN))
            (runtime / 'state.json').write_text(json.dumps({'paused': False, 'history': [], 'active': {}}))
            baseline = backlog_sync.sync_once(work, runtime)
            self.assertEqual(baseline['status'], 'IN_SYNC', baseline)
            git(remote, 'update-ref', 'refs/heads/main', BAD_MAIN)
            bad_cycle = backlog_sync.sync_once(work, runtime)
            self.assertEqual(bad_cycle['status'], 'SYNCED', bad_cycle)
            self.assertEqual(bad_cycle['admission_drift'], [])
            # Recreate the exact legacy diagnostic rather than editing live state.
            meta = runtime / 'backlog-sync-state.json'; data = json.loads(meta.read_text())
            data['admission_drift'] = [{'admission_path': 'docs/manifest/PM_ADMISSION_FB01_HEADER006_CURRENT_MAIN_20261009_V001.md',
                'disabled_queued_task_ids': [PLANNING], 'diagnostic_id': 'c6c97366f4e7c5a7', 'detected_commit': BAD_MAIN}]
            meta.write_text(json.dumps(data))
            git(remote, 'update-ref', 'refs/heads/main', CURRENT_MAIN)
            result = backlog_sync.sync_once(work, runtime)
            self.assertEqual(result['status'], 'SYNCED', result)
            self.assertEqual(result['admission_drift'], [])
            self.assertEqual((runtime / 'backlog.json').read_bytes(), blob(CURRENT_MAIN))
            self.assertEqual(result['task_count'], 436)
            for _ in range(2):
                self.assertEqual(backlog_sync.sync_once(work, runtime)['admission_drift'], [])


if __name__ == '__main__':
    unittest.main(verbosity=2)

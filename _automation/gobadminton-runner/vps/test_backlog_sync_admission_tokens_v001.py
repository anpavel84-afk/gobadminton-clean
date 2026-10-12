"""Explicit admission declarations and verified historical lock diagnostics.

Every sync/notice is confined to a disposable Git remote and runtime.
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


class AdmissionTokenTests(unittest.TestCase):
    setUp = base.BacklogSyncTests.setUp
    restore_runner = base.BacklogSyncTests.restore_runner
    update_canonical = base.BacklogSyncTests.update_canonical
    set_state = base.BacklogSyncTests.set_state

    def sync(self, **kwargs):
        result = backlog_sync.sync_once(self.work, self.runtime, **kwargs)
        self.assertIn(result['status'], {'IN_SYNC', 'SYNCED', 'WOULD_SYNC'}, result)
        return result

    def publish(self, body, tasks=None, name='TOKENS'):
        path = 'docs/manifest/PM_ADMISSION_' + name + '.md'
        (self.work / path).write_text('# SOURCE_ONLY_ADMITTED\n' + body)
        git(self.work, 'add', path)
        self.update_canonical(tasks or [self.web, {**self.api, 'locks': ['runner-control']}])
        return path

    def seed(self, findings):
        meta = self.runtime / 'backlog-sync-state.json'
        data = json.loads(meta.read_text())
        data['admission_drift'] = [dict(admission_path=path, disabled_queued_task_ids=ids,
            diagnostic_id=format(i, '016x'), detected_commit=data['canonical_commit'])
            for i, (path, ids) in enumerate(findings, 1)]
        meta.write_text(json.dumps(data))
        return data['admission_drift']

    def test_prose_resources_are_not_task_declarations(self):
        self.sync()
        self.publish('Resource lock: `runner-control`; API lane `api:radar`, client `web`.\n'
                     'Runtime uses `file-disjoint` paths and `source-only` effects.\n')
        self.assertEqual(self.sync()['admission_drift'], [])

    def test_leading_pairs_fields_and_task_table_keep_unknown_tasks(self):
        self.sync()
        self.publish('- `new-source-v001` → `qa-new-source-v001`. Lock `runner-control`.\n'
                     'Task IDs: `missing-task-v001`, `system-other-v001`\n'
                     '| Task ID | Resource |\n| --- | --- |\n'
                     '| `table-task-v001` | `runner-control` |\n')
        self.assertEqual(self.sync()['admission_drift'][0]['disabled_queued_task_ids'],
            sorted(['new-source-v001', 'qa-new-source-v001', 'missing-task-v001',
                    'system-other-v001', 'table-task-v001']))

    def test_explicit_unknown_task_equal_to_resource_is_never_hidden(self):
        self.sync()
        path = self.publish('Task ID: `runner-control`\nResource lock: `runner-control`\n')
        self.assertEqual(self.sync()['admission_drift'][0]['disabled_queued_task_ids'], ['runner-control'])
        self.seed([(path, ['runner-control'])])
        self.assertEqual(self.sync()['admission_drift'][0]['disabled_queued_task_ids'], ['runner-control'])

    def test_canonical_disabled_task_equal_to_resource_remains_actionable(self):
        self.sync()
        disabled = task('runner-control', enabled=False, ref=self.ref)
        path = self.publish('Resource lock: `runner-control`\n',
                            [self.web, self.api, disabled])
        self.assertEqual(self.sync()['admission_drift'][0]['disabled_queued_task_ids'], ['runner-control'])
        self.seed([(path, ['runner-control'])])
        self.assertEqual(self.sync()['admission_drift'][0]['disabled_queued_task_ids'], ['runner-control'])

    def test_three_persisted_pure_resource_notices_clear_without_new_owner_message(self):
        self.sync()
        paths = [self.publish('Resource lock: `runner-control`; `api:radar`, `web`.\n',
                              name='LOCK_' + str(i)) for i in range(3)]
        self.sync(); findings = self.seed([(p, ['runner-control']) for p in paths])
        protected = {p: p.read_bytes() for p in [self.runtime / 'state.json', self.runtime / 'backlog.json',
                                                self.runtime / 'backlog-sync-trust.json']}
        self.assertEqual(self.sync(dry_run=True)['admission_drift'], [])
        self.assertEqual(json.loads((self.runtime / 'backlog-sync-state.json').read_text())['admission_drift'], findings)
        with mock.patch.object(autopilot, 'OWNER_INBOX_DIR', self.runtime / 'owner-inbox'):
            for _ in range(3):
                result = self.sync()
                self.assertEqual(result['admission_drift'], [])
                self.assertEqual(autopilot.enqueue_admission_reconcile_notice(result), [])
        self.assertFalse((self.runtime / 'owner-inbox').exists())
        for p, raw in protected.items(): self.assertEqual(p.read_bytes(), raw)

    def test_mixed_drift_preserves_disabled_missing_unknown_and_diagnostic_identity(self):
        self.sync()
        disabled = task('real-disabled-v001', enabled=False, ref=self.ref)
        path = self.publish('Resource lock: `runner-control`\n',
                            [self.web, {**self.api, 'locks': ['runner-control']}, disabled])
        self.sync()
        ids = ['runner-control', disabled['id'], 'real-missing-v001', 'system-unrecognized-v001']
        prior = self.seed([(path, ids)])[0]
        for _ in range(2):
            finding = self.sync()['admission_drift'][0]
            self.assertEqual(finding, {**prior, 'disabled_queued_task_ids': ids[1:]})

    def test_missing_or_non_manifest_provenance_never_clears_resource_token(self):
        self.sync()
        self.publish('Resource lock: `runner-control`\n'); self.sync()
        for path in ['docs/manifest/PM_ADMISSION_ABSENT.md', 'docs/other.md']:
            self.seed([(path, ['runner-control'])])
            self.assertEqual(self.sync()['admission_drift'][0]['disabled_queued_task_ids'], ['runner-control'])

    def test_changed_manifest_cannot_replace_unresolved_mixed_real_notice(self):
        self.sync(); path = self.publish('Resource lock: `runner-control`\n'); self.sync()
        prior = self.seed([(path, ['runner-control', 'old-missing-v001', 'system-unknown-v001'])])[0]
        self.publish('Task IDs: `new-missing-v001`\nResource lock: `runner-control`\n')
        finding = self.sync()['admission_drift'][0]
        self.assertEqual(finding['disabled_queued_task_ids'],
                         ['old-missing-v001', 'system-unknown-v001', 'new-missing-v001'])
        self.assertEqual(finding['diagnostic_id'], prior['diagnostic_id'])
        self.assertEqual(len(self.sync()['admission_drift']), 1)

    def test_same_main_safe_cleanup_preserves_active_claim_history_and_attempt_bytes(self):
        self.sync(); path = self.publish('Resource lock: `runner-control`\n'); self.sync()
        self.set_state(active={self.web['id']: {'id': self.web['id'], 'locks': ['web'], 'agent_pid': 123}},
                       history=[{'id': 'old-failed-qa', 'status': 'qa_failed', 'verdict': 'FAIL'}])
        self.seed([(path, ['runner-control'])])
        state = self.runtime / 'state.json'; data = json.loads(state.read_text()); data['attempts'] = {'old-failed-qa': 5}
        state.write_text(json.dumps(data)); before = state.read_bytes()
        self.assertEqual(self.sync()['admission_drift'], [])
        self.assertEqual(state.read_bytes(), before)

    def test_corrupt_history_and_unverified_source_do_not_clear_prior_drift(self):
        self.sync(); path = self.publish('Resource lock: `runner-control`\n'); self.sync()
        prior = self.seed([(path, ['runner-control'])])
        meta = self.runtime / 'backlog-sync-state.json'; before = meta.read_bytes()
        self.set_state(history=[{'id': 'old-failed-qa', 'status': 'completed', 'verdict': 'FAIL'}])
        self.assertEqual(backlog_sync.sync_once(self.work, self.runtime)['status'], 'BLOCKED')
        self.assertEqual(meta.read_bytes(), before)
        self.set_state(history=[])
        self.update_canonical([self.web, {**self.api, 'source': self.api['source'].replace('test.md', 'absent.md')}])
        result = backlog_sync.sync_once(self.work, self.runtime)
        self.assertEqual(result['status'], 'BLOCKED'); self.assertEqual(result['admission_drift'], prior)

    def test_admit_sentence_excludes_its_resource_clause(self):
        self.sync()
        self.publish('Admit exactly `new-source-v001` plus directly dependent independent '
                     '`qa-new-source-v001`, both exclusive lock `runner-control`.\n')
        self.assertEqual(self.sync()['admission_drift'][0]['disabled_queued_task_ids'],
                         ['new-source-v001', 'qa-new-source-v001'])

    def test_admit_sentence_exclusive_alias_without_lock_word(self):
        self.sync()
        self.publish('Admit only `new-source-v001` and directly dependent independent '
                     '`qa-new-source-v001`, exclusive `runner-control`, independent of another lane.\n')
        self.assertEqual(self.sync()['admission_drift'][0]['disabled_queued_task_ids'],
                         ['new-source-v001', 'qa-new-source-v001'])


class CanonicalResidualReplayTests(unittest.TestCase):
    def test_exact_three_historical_resource_notices_clear_on_verified_current_main(self):
        source = Path(__file__).resolve().parents[3]
        head = 'b4eab46b59f241a9cf0aa488eee692147c6a4aa8'
        paths = ['docs/manifest/PM_ADMISSION_RUNNER_SCOPE03_REGRESSION_REPAIR01_20261009_V001.md',
                 'docs/manifest/PM_ADMISSION_RUNNER_BOUNDED_PUBLICATION_SCOPE02_20261009_V001.md',
                 'docs/manifest/PM_ADMISSION_RUNNER_BOUNDED_PUBLICATION_SCOPE01_20261009_V001.md']
        tokens = ['251d93d4c0c9777b', 'a4c345de3f26df67', '3722be00d250cf58']
        detected = ['3079f8f64501e358cd17bdb16d81d6c858081099',
                    'b4468d11e3726a64e46867dd9aecc300ed9ce80f',
                    '63934aba3bfafc9c5ab8d4c5db3470d85bc22cbc']
        with tempfile.TemporaryDirectory(prefix='gb-residual-main-replay-') as tmp:
            root = Path(tmp); remote = root / 'remote.git'; work = root / 'objects'; runtime = root / 'runtime'
            runtime.mkdir()
            subprocess.run(['git', 'clone', '-q', '--shared', '--bare', str(source), str(remote)], check=True)
            git(remote, 'update-ref', 'refs/heads/main', head)
            git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/main')
            subprocess.run(['git', 'clone', '-q', '--shared', '--no-checkout', str(remote), str(work)], check=True)
            raw = subprocess.check_output(['git', '-C', str(work), 'show', head + ':' + backlog_sync.CANONICAL_PATH])
            (runtime / 'backlog.json').write_bytes(raw)
            state = runtime / 'state.json'; state.write_text(json.dumps({'paused': False, 'history': [], 'active': {}}))
            result = backlog_sync.sync_once(work, runtime)
            self.assertEqual(result['status'], 'IN_SYNC', result)
            meta = runtime / 'backlog-sync-state.json'; data = json.loads(meta.read_text())
            data['admission_drift'] = [dict(admission_path=p, disabled_queued_task_ids=['runner-control'],
                diagnostic_id=t, detected_commit=c) for p, t, c in zip(paths, tokens, detected)]
            meta.write_text(json.dumps(data))
            protected = {p: p.read_bytes() for p in [state, runtime / 'backlog.json', runtime / 'backlog-sync-trust.json']}
            with mock.patch.object(autopilot, 'OWNER_INBOX_DIR', runtime / 'owner-inbox'):
                for _ in range(2):
                    result = backlog_sync.sync_once(work, runtime)
                    self.assertEqual(result['status'], 'IN_SYNC', result)
                    self.assertEqual(result['admission_drift'], [], result)
                    self.assertEqual(autopilot.enqueue_admission_reconcile_notice(result), [])
            self.assertFalse((runtime / 'owner-inbox').exists())
            for p, content in protected.items(): self.assertEqual(p.read_bytes(), content)


if __name__ == '__main__':
    unittest.main(verbosity=2)

"""Repair03 author regressions; disposable repos/runtime and no live effects."""
import copy
import fcntl
import json
import unittest
from unittest import mock

import backlog_sync
import runner
import test_backlog_sync_v001 as base
import test_backlog_sync_repair02_v001 as repair02
from test_backlog_sync_v001 import as_bytes, git, task


class Repair03Tests(unittest.TestCase):
    setUp = base.BacklogSyncTests.setUp
    restore_runner = base.BacklogSyncTests.restore_runner
    update_canonical = base.BacklogSyncTests.update_canonical
    set_state = base.BacklogSyncTests.set_state
    producer_fixture = repair02.Repair02Tests.producer_fixture

    def sync(self):
        return backlog_sync.sync_once(self.work, self.runtime)

    def claim(self, definition):
        with mock.patch.object(runner, 'STATE_PATH', self.runtime / 'state.json'):
            return runner.claim_task(definition)

    def protected(self):
        return {str(p.relative_to(self.runtime)): p.read_bytes()
                for p in self.runtime.rglob('*') if p.is_file()
                and p.suffix == '.json' and p.name != 'backlog-sync-diagnostic.json'}

    def qa_queue(self):
        producer, qa, receipt, state = self.producer_fixture()
        self.set_state(history=state['history'])
        self.update_canonical([self.web, producer, qa])
        self.assertEqual(self.sync()['status'], 'SYNCED')
        return producer, qa, receipt, state, {'tasks': [self.web, producer, qa]}

    def test_history_corruption_preserves_every_protected_byte_sync_and_claim(self):
        self.sync()
        self.update_canonical([self.web, self.api, task('new-source', ref=self.ref)])
        variants = [None, 'qa_failed', {'id': 'old-qa'}, {'status': 'qa_failed'},
                    {'id': 7, 'status': 'completed'}, {'id': '', 'status': 'blocked'},
                    {'id': ' x ', 'status': 'completed'}, {'id': 'old', 'status': 'running'},
                    {'id': 'old', 'status': ['completed']},
                    {'id': 'old', 'status': 'qa_failed', 'verdict': 'PASS'},
                    {'id': 'old', 'status': 'completed', 'task_id': 'other'},
                    {'id': 'old', 'status': 'completed', 'project': 'Other'},
                    {'id': 'old', 'status': 'completed', 'at': None}]
        for record in variants:
            with self.subTest(record=record):
                self.set_state(history=[record])
                before = self.protected()
                result = self.sync()
                self.assertEqual(result['status'], 'BLOCKED', result)
                self.assertIn('history[0]', result['reason'])
                self.assertEqual(self.protected(), before)
                with self.assertRaises(backlog_sync.InvalidRunnerState): self.claim(self.web)
                self.assertEqual(self.protected(), before)
                diagnostic = json.loads((self.runtime/'backlog-sync-diagnostic.json').read_text())
                self.assertIn('history[0]', diagnostic['reason'])

    def test_history_mixed_list_and_later_entry_diagnostic(self):
        self.sync()
        self.set_state(history=[{'id': 'ok', 'status': 'completed'}, None, 'qa_failed', {'id': 'old-qa'}])
        before = self.protected()
        result = self.sync()
        self.assertEqual(result['status'], 'BLOCKED')
        self.assertIn('history[1]: record must be object', result['reason'])
        self.assertEqual(self.protected(), before)

    def test_valid_legacy_terminal_records_are_read_only(self):
        records = [{'id': 'legacy-'+status, 'status': status} for status in backlog_sync.TERMINAL_STATUSES]
        self.set_state(history=records)
        before = (self.runtime/'state.json').read_bytes()
        self.assertEqual(self.sync()['status'], 'IN_SYNC')
        self.assertEqual((self.runtime/'state.json').read_bytes(), before)
        self.assertEqual(backlog_sync.read_runner_state(self.runtime/'state.json')['history'], records)

    def test_valid_v1_and_release_audit_are_read_only(self):
        event = {'id': 'old', 'status': 'block_released', 'result_commit': self.ref,
                 'original_block': {'id': 'old'}, 'original_current': {'id': 'old', 'status': 'blocked'}}
        state = {'version': 1, 'current': None, 'paused': False, 'history': [event]}
        (self.runtime/'state.json').write_text(json.dumps(state))
        before = (self.runtime/'state.json').read_bytes()
        self.assertEqual(self.sync()['status'], 'IN_SYNC')
        self.assertEqual((self.runtime/'state.json').read_bytes(), before)
        for field, value in [('result_commit', None), ('original_block', {'id': 'other'}),
                             ('original_current', {'id': 'old', 'status': 'running'})]:
            with self.subTest(field=field), self.assertRaises(backlog_sync.InvalidRunnerState):
                backlog_sync.validate_history([{**event, field: value}])

    def test_history_corruption_at_backup_boundary_blocks_swap(self):
        self.sync()
        self.update_canonical([self.web, self.api, task('new-backup', ref=self.ref)])
        before = self.protected()
        original = backlog_sync.atomic_write
        def write(path, data, mode=0o600):
            if path.parent.name == 'backlog-backups': self.set_state(history=[None])
            return original(path, data, mode)
        with mock.patch.object(backlog_sync, 'atomic_write', side_effect=write):
            result = self.sync()
        self.assertEqual(result['status'], 'BLOCKED')
        for name in ('backlog.json', 'backlog-sync-trust.json', 'backlog-sync-state.json'):
            self.assertEqual((self.runtime/name).read_bytes(), before[name])
        self.assertEqual(json.loads((self.runtime/'state.json').read_text())['history'], [None])

    def test_deleted_cached_remote_blocks_direct_claim_and_refresh(self):
        producer, qa, receipt, state, queue = self.qa_queue()
        self.assertTrue(runner.dependencies_ready(qa, queue, state)[0])
        before = self.protected()
        git(self.remote, 'update-ref', '-d', 'refs/heads/'+receipt['branch'])
        with self.assertRaisesRegex(RuntimeError, 'fresh producer publication'): self.claim(qa)
        self.assertEqual(self.protected(), before)
        self.assertFalse(runner.dependencies_ready(qa, queue, state)[0])
        self.assertEqual(git(self.work, 'rev-parse', 'refs/remotes/origin/'+receipt['branch']), receipt['candidate_sha'])

    def test_successive_claims_reverify_after_prior_success(self):
        producer, qa, receipt, state, queue = self.qa_queue()
        self.claim(qa)
        self.set_state(history=state['history'])  # disposable prior claim only
        git(self.remote, 'update-ref', '-d', 'refs/heads/'+receipt['branch'])
        before = self.protected()
        with self.assertRaisesRegex(RuntimeError, 'fresh producer publication'): self.claim(qa)
        self.assertEqual(self.protected(), before)

    def test_nonfastforward_branch_even_containing_candidate_blocks(self):
        producer, qa, receipt, state, queue = self.qa_queue()
        git(self.work, 'checkout', '-q', receipt['branch'])
        git(self.work, 'commit', '--allow-empty', '-qm', 'published handoff')
        git(self.work, 'push', '-q', 'origin', receipt['branch'])
        runner.refresh_qa_candidate_refs(queue, state, {'workspace': str(self.work)})
        prior = git(self.work, 'rev-parse', 'refs/remotes/origin/'+receipt['branch'])
        git(self.remote, 'update-ref', 'refs/heads/'+receipt['branch'], receipt['candidate_sha'])
        before = self.protected()
        for _ in range(3):
            with self.assertRaisesRegex(RuntimeError, 'fresh producer publication'): self.claim(qa)
            self.assertEqual(self.protected(), before)
            self.assertEqual(git(self.work, 'rev-parse', 'refs/remotes/origin/'+receipt['branch']), prior)

    def test_unavailable_remote_and_moved_during_check_fail_closed(self):
        producer, qa, receipt, state, queue = self.qa_queue()
        original = backlog_sync.run_git
        for failure in ('offline', 'moved'):
            with self.subTest(failure=failure):
                before = self.protected(); calls = []
                def run(repo, args, **kwargs):
                    if args[0] == 'ls-remote':
                        calls.append(args)
                        if failure == 'offline': raise backlog_sync.SyncBlocked('synthetic remote unavailable')
                        if len(calls) == 2: return ''
                    return original(repo, args, **kwargs)
                with mock.patch.object(backlog_sync, 'run_git', side_effect=run):
                    with self.assertRaisesRegex(RuntimeError, 'fresh producer publication'): self.claim(qa)
                self.assertEqual(self.protected(), before)
                self.assertFalse(runner.dependencies_ready(qa, queue, state)[0])

    def test_network_outside_lock_and_fastforward_handoff_positive(self):
        producer, qa, receipt, state, queue = self.qa_queue()
        git(self.work, 'checkout', '-q', receipt['branch'])
        git(self.work, 'commit', '--allow-empty', '-qm', 'new immutable handoff')
        git(self.work, 'push', '-q', 'origin', receipt['branch'])
        original = backlog_sync.run_git; calls = []
        def run(repo, args, **kwargs):
            if args[0] in ('fetch', 'ls-remote'):
                with backlog_sync.claim_sync_section(self.runtime): calls.append(args[0])
            return original(repo, args, **kwargs)
        with mock.patch.object(backlog_sync, 'run_git', side_effect=run): self.claim(qa)
        self.assertEqual(calls, ['ls-remote', 'fetch', 'ls-remote'])
        actual = json.loads((self.runtime/'state.json').read_text())['active'][qa['id']]
        self.assertEqual(actual['status'], 'running')
        self.assertNotEqual(qa['base_sha'], receipt['candidate_sha'])

    def test_receipt_changed_between_preflight_and_lock_rejects(self):
        producer, qa, receipt, state, queue = self.qa_queue()
        before = (self.runtime/'state.json').read_bytes()
        original = runner.refresh_qa_candidate_refs
        def refresh(*args, **kwargs):
            proofs = original(*args, **kwargs)
            (self.runtime/'receipts/api-high.json').write_text(json.dumps({**receipt, 'candidate_tree': 'f'*40}))
            return proofs
        with mock.patch.object(runner, 'refresh_qa_candidate_refs', side_effect=refresh):
            with self.assertRaisesRegex(RuntimeError, 'fresh producer publication'): self.claim(qa)
        self.assertEqual((self.runtime/'state.json').read_bytes(), before)

    def test_corrupt_history_cannot_select_qa_dependency(self):
        producer, qa, receipt, state, queue = self.qa_queue()
        state['history'].append({'id': 'hidden-fail'})
        ready, reason = runner.dependencies_ready(qa, queue, state)
        self.assertFalse(ready); self.assertIn('history[1]', reason)


if __name__ == '__main__': unittest.main(verbosity=2)

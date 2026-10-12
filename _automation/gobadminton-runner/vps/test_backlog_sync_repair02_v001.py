"""Author regressions: disposable Git/runtime, forked claims, no installed effects."""
import copy
import hashlib
import json
import multiprocessing
from contextlib import ExitStack
from pathlib import Path
import unittest
from unittest import mock

import autopilot
import backlog_sync
import runner
import test_backlog_sync_v001 as producer_tests
from test_backlog_sync_v001 import as_bytes, git, task


def try_claim(runtime, definition, connection):
    runner.BACKLOG_PATH = Path(runtime) / 'backlog.json'
    runner.STATE_PATH = Path(runtime) / 'state.json'
    runner.RECEIPTS_DIR = Path(runtime) / 'receipts'
    try:
        runner.claim_task(definition)
        connection.send('claimed')
    except Exception as exc:
        connection.send(str(exc))
    finally:
        connection.close()


class Repair02Tests(unittest.TestCase):
    setUp = producer_tests.BacklogSyncTests.setUp
    restore_runner = producer_tests.BacklogSyncTests.restore_runner
    update_canonical = producer_tests.BacklogSyncTests.update_canonical
    set_state = producer_tests.BacklogSyncTests.set_state

    def sync(self):
        return backlog_sync.sync_once(self.work, self.runtime)

    def claim_process(self, definition):
        ctx = multiprocessing.get_context('fork')
        parent, child = ctx.Pipe(duplex=False)
        process = ctx.Process(target=try_claim, args=(self.runtime, definition, child))
        process.start(); child.close()
        self.assertTrue(parent.poll(8), 'claim blocked instead of returning contention')
        result = parent.recv(); parent.close()
        process.join(8)
        self.assertEqual(process.exitcode, 0)
        return result

    def test_claim_arriving_during_backup_contends_without_state_write(self):
        changed = {**self.web, 'notes': 'new effective task definition'}
        self.update_canonical([changed, self.api])
        before = (self.runtime / 'state.json').read_bytes()
        original = backlog_sync.atomic_write
        observed = []
        def write(path, data, mode=0o600):
            if path.parent.name == 'backlog-backups':
                observed.append(self.claim_process(self.web))
                self.assertEqual((self.runtime / 'state.json').read_bytes(), before)
            return original(path, data, mode)
        with mock.patch.object(backlog_sync, 'atomic_write', side_effect=write):
            self.assertEqual(self.sync()['status'], 'SYNCED')
        self.assertIn('critical section busy', observed[0])
        self.assertIn('definition changed', self.claim_process(self.web))
        self.assertEqual(self.claim_process(changed), 'claimed')
        self.assertEqual(json.loads((self.runtime / 'state.json').read_text())['active']['web-live']['source'], changed['source'])

    def test_claim_first_prevents_mutation_in_another_process(self):
        self.sync()
        self.assertEqual(self.claim_process(self.web), 'claimed')
        changed = {**self.web, 'receipt': '/tmp/other-receipt.json'}
        self.update_canonical([changed, self.api])
        before = (self.runtime / 'backlog.json').read_bytes()
        self.assertEqual(self.sync()['status'], 'BLOCKED')
        self.assertEqual((self.runtime / 'backlog.json').read_bytes(), before)

    def test_blocked_or_missing_trust_stops_claim_without_resetting_state(self):
        before = (self.runtime / 'state.json').read_bytes()
        self.assertNotEqual(self.claim_process(self.web), 'claimed')
        self.sync()
        meta = self.runtime / 'backlog-sync-state.json'
        original = json.loads(meta.read_text())
        meta.write_text(json.dumps({**original, 'status': 'BLOCKED'}))
        self.assertNotEqual(self.claim_process(self.web), 'claimed')
        meta.write_text('[]')
        self.assertNotEqual(self.claim_process(self.web), 'claimed')
        self.assertEqual((self.runtime / 'state.json').read_bytes(), before)

    def test_complete_active_definition_is_immutable(self):
        fields = {'base_sha': self.ref, 'notes': 'depends_on_completed=api-high.',
                  'receipt': '/tmp/receipt.json', 'receipt_path': '/tmp/legacy.json',
                  'requires_pr_merged': 999, 'requires_dns_no_aaaa': {'names': ['fixture.invalid']},
                  'future_input': {'secret_ref': 'synthetic'}, 'scope': None, 'locks': ['docs']}
        for key, value in fields.items():
            with self.subTest(field=key), self.assertRaises(backlog_sync.SyncBlocked):
                backlog_sync.verify_candidate(as_bytes([{**self.web, key: value}, self.api]),
                    as_bytes([self.web, self.api]), {'web-live': {'id': 'web-live'}})

    def test_corrupt_or_missing_state_preserves_all_protected_files(self):
        self.sync()
        baseline = (self.runtime / 'state.json').read_bytes()
        protected = {'backlog.json': (self.runtime / 'backlog.json').read_bytes(),
                     'backlog-sync-trust.json': (self.runtime / 'backlog-sync-trust.json').read_bytes()}
        variants = [None, b'{', b'[]', b'{}', b'{"active":[],"paused":false,"history":[]}',
                    b'{"active":{"bad":{}},"paused":false,"history":[]}',
                    b'{"active":{},"paused":false,"history":{}}']
        for raw in variants:
            with self.subTest(raw=raw):
                path = self.runtime / 'state.json'
                if raw is None: path.unlink(missing_ok=True)
                else: path.write_bytes(raw)
                result = self.sync()
                self.assertEqual(result['status'], 'BLOCKED', result)
                self.assertTrue(result['reason'])
                if raw is not None: self.assertEqual(path.read_bytes(), raw)
                for name, data in protected.items(): self.assertEqual((self.runtime / name).read_bytes(), data)
                self.assertTrue((self.runtime / 'backlog-sync-diagnostic.json').exists())
                path.write_bytes(baseline)

    def test_corrupt_metadata_cannot_rebootstrap_or_erase_trust(self):
        self.sync()
        path = self.runtime / 'backlog-sync-state.json'
        original = path.read_bytes()
        trust = (self.runtime / 'backlog-sync-trust.json').read_bytes()
        for raw in [None, b'{', b'[]', b'{}', b'{"canonical_commit":null}',
                    json.dumps({**json.loads(original), 'admission_drift': [{}]}).encode()]:
            with self.subTest(raw=raw):
                if raw is None: path.unlink(missing_ok=True)
                else: path.write_bytes(raw)
                for _ in range(2):
                    self.assertEqual(self.sync()['status'], 'BLOCKED')
                    self.assertEqual((self.runtime / 'backlog-sync-trust.json').read_bytes(), trust)
                    if raw is not None: self.assertEqual(path.read_bytes(), raw)
                    else: self.assertFalse(path.exists())
                path.write_bytes(original)

    def test_first_install_requires_main_lineage_anchor(self):
        altered = {**self.api, 'notes': 'unpublished runtime definition'}
        (self.runtime / 'backlog.json').write_bytes(as_bytes([self.web, altered]))
        result = self.sync()
        self.assertEqual(result['status'], 'BLOCKED')
        self.assertIn('initial trust unavailable', result['reason'])
        self.assertFalse((self.runtime / 'backlog-sync-trust.json').exists())

    def test_multiple_sync_contenders_leave_all_shared_metadata_untouched(self):
        self.sync()
        before = {p.name: p.read_bytes() for p in self.runtime.glob('*.json')}
        import fcntl
        with (self.runtime / 'backlog-sync.lock').open('a+') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            for _ in range(4): self.assertEqual(self.sync()['status'], 'BLOCKED')
        after = {p.name: p.read_bytes() for p in self.runtime.glob('*.json')}
        self.assertEqual(before, after)

    def test_enabled_missing_admission_and_legacy_dependency_replay_fail_closed(self):
        invalid = {**self.api, 'admission': self.api['admission'].replace('TEST_ADMISSION.md', 'absent.md')}
        self.update_canonical([self.web, invalid])
        (self.runtime / 'backlog.json').write_bytes(as_bytes([self.web, invalid]))
        self.assertEqual(self.sync()['status'], 'BLOCKED')
        # Schema invalidity is rejected before changing runtime, including
        # an enabled task whose implicit status is queued.
        for field, value in [('blocks', [{}]), ('order', {}), ('enabled', 'true'), ('unknown_input', True)]:
            malformed = {**task('new-malformed', ref=self.ref), field: value}
            self.update_canonical([self.web, self.api, malformed])
            before = (self.runtime / 'backlog.json').read_bytes()
            self.assertEqual(self.sync()['status'], 'BLOCKED')
            self.assertEqual((self.runtime / 'backlog.json').read_bytes(), before)
        invalid = {**self.api, 'notes': 'depends_on_completed=nonexistent-producer.'}
        self.update_canonical([self.web, invalid])
        (self.runtime / 'backlog.json').write_bytes(as_bytes([self.web, invalid]))
        self.assertEqual(self.sync()['status'], 'BLOCKED')

    def test_disabled_historical_missing_source_is_preserved(self):
        old = {**task('old-failed', enabled=False, ref=self.ref), 'status': 'qa_failed',
               'source': 'https://example.invalid/historical'}
        self.update_canonical([self.web, self.api, old])
        self.assertEqual(self.sync()['status'], 'SYNCED')
        self.assertEqual(self.sync()['status'], 'IN_SYNC')
        self.set_state(history=[{'id': 'old-failed', 'status': 'qa_failed'}])
        reopened = {**old, 'enabled': True, 'status': 'queued', 'source': self.api['source']}
        self.update_canonical([self.web, self.api, reopened])
        self.assertEqual(self.sync()['status'], 'BLOCKED')

    def producer_fixture(self):
        git(self.work, 'checkout', '-qb', 'impl/synthetic-producer')
        (self.work / 'synthetic-code.txt').write_text('new candidate\n')
        git(self.work, 'add', 'synthetic-code.txt'); git(self.work, 'commit', '-qm', 'new code candidate')
        candidate = git(self.work, 'rev-parse', 'HEAD')
        git(self.work, 'push', '-q', 'origin', 'impl/synthetic-producer')
        git(self.work, 'fetch', '-q', 'origin', 'impl/synthetic-producer')
        git(self.work, 'checkout', '-q', 'main')
        producer = {**self.api, 'base_sha': self.ref}
        qa = {**task('qa-api-high', deps=['api-high'], ref=self.ref), 'base_sha': self.ref}
        receipt = {'ok': True, 'task_id': 'api-high', 'project': 'GoBadminton',
                   'candidate_sha': candidate, 'candidate_tree': git(self.work, 'rev-parse', candidate + '^{tree}'),
                   'branch': 'impl/synthetic-producer'}
        path = self.runtime / 'receipts/api-high.json'; path.write_text(json.dumps(receipt))
        state = {'history': [{'id': 'api-high', 'status': 'completed'}], 'active': {}}
        return producer, qa, receipt, state

    def test_new_candidate_is_ready_with_older_planning_baseline(self):
        producer, qa, receipt, state = self.producer_fixture()
        self.assertNotEqual(qa['base_sha'], receipt['candidate_sha'])
        self.assertTrue(runner.dependencies_ready(qa, {'tasks': [producer, qa]}, state)[0])
        (self.runtime / 'backlog.json').write_bytes(as_bytes([producer, qa]))
        prompt = runner.build_launch_prompt(qa, '/tmp/synthetic-source.md', self.runtime / 'receipts/qa-api-high.json')
        self.assertIn(receipt['candidate_sha'], prompt)
        self.assertIn(receipt['candidate_tree'], prompt)
        self.assertIn('planning baseline', prompt)
        qa['candidate_sha'] = self.ref
        self.assertFalse(runner.dependencies_ready(qa, {'tasks': [producer, qa]}, state)[0])

    def test_receipt_must_verify_identity_branch_tree_and_producer_ancestry(self):
        producer, qa, receipt, state = self.producer_fixture()
        path = self.runtime / 'receipts/api-high.json'
        for field, value in [('task_id', 'another-producer'), ('project', 'OtherProject'),
                             ('candidate_tree', 'a' * 40), ('branch', 'missing'), ('candidate_sha', self.ref),
                             ('branch', None), ('candidate_tree', None), ('ok', False)]:
            with self.subTest(field=field, value=value):
                path.write_text(json.dumps({**receipt, field: value}))
                self.assertFalse(runner.dependencies_ready(qa, {'tasks': [producer, qa]}, state)[0])
        path.unlink()
        self.assertFalse(runner.dependencies_ready(qa, {'tasks': [producer, qa]}, state)[0])
        unbound = {**qa, 'depends_on_completed': []}
        self.assertFalse(runner.dependencies_ready(unbound, {'tasks': [producer, unbound]}, state)[0])

    def test_published_candidate_branch_is_fetched_outside_claim(self):
        producer, qa, receipt, state = self.producer_fixture()
        git(self.work, 'update-ref', '-d', 'refs/remotes/origin/impl/synthetic-producer')
        q = {'tasks': [producer, qa]}
        self.assertFalse(runner.dependencies_ready(qa, q, state)[0])
        runner.refresh_qa_candidate_refs(q, state, {'workspace': str(self.work)})
        self.assertTrue(runner.dependencies_ready(qa, q, state)[0])

    def test_accepted_candidate_requires_actual_main_ancestry_and_own_qa_binding(self):
        producer, qa, receipt, state = self.producer_fixture()
        downstream = task('next-api', accepted=[qa['id']], ref=self.ref)
        q = {'tasks': [producer, qa, downstream]}
        state['history'].append({'id': qa['id'], 'status': 'completed'})
        qa_receipt = {'ok': True, 'project': 'GoBadminton', 'task_id': qa['id'], 'verdict': 'PASS',
                      'blocking_findings': [], 'merge_recommendation': 'MERGE_RECOMMENDED',
                      'candidate_sha': receipt['candidate_sha'], 'candidate_tree': receipt['candidate_tree']}
        path = self.runtime / 'receipts/qa-api-high.json'; path.write_text(json.dumps(qa_receipt))
        self.assertFalse(runner.dependencies_ready(downstream, q, state)[0])
        git(self.work, 'merge', '--ff-only', '-q', receipt['branch']); git(self.work, 'push', '-q', 'origin', 'main')
        git(self.work, 'fetch', '-q', 'origin', 'main')
        self.assertTrue(runner.dependencies_ready(downstream, q, state)[0])
        for field, value in [('blocking_findings', None), ('merge_recommendation', None),
                             ('candidate_sha', self.ref), ('task_id', 'wrong-qa'), ('candidate_tree', 'a' * 40),
                             ('verdict', 'FAIL'), ('verdict', 'BLOCKED')]:
            with self.subTest(field=field):
                path.write_text(json.dumps({**qa_receipt, field: value}))
                self.assertFalse(runner.dependencies_ready(downstream, q, state)[0])

    def owner_fixture(self):
        initial = self.sync()['canonical_commit']
        before = json.loads((self.runtime / 'backlog.json').read_text()); before['_canonical_commit'] = initial
        item = {'id': 'owner-exact', 'text': 'Admit the exact independent source task'}
        new = {**task('owner-new', locks=['docs'], ref=self.ref), 'effect_ceiling': 'source_only'}
        qa = {**task('qa-owner-new', deps=[new['id']], locks=['docs'], ref=self.ref), 'effect_ceiling': 'source_only'}
        binding_path = 'docs/manifest/OWNER_PUBLICATION_SYNTHETIC.json'
        (self.work / binding_path).write_text(json.dumps({'project': 'GoBadminton', 'instructions': [{
            'id': item['id'], 'text_sha256': hashlib.sha256(item['text'].encode()).hexdigest(),
            'action': 'enqueued', 'task_ids': [new['id'],qa['id']]}]}))
        git(self.work, 'add', binding_path)
        self.update_canonical([self.web, self.api, new, qa])
        result = self.sync(); after = json.loads((self.runtime / 'backlog.json').read_text())
        receipt = {'ok': True, 'project': 'GoBadminton', 'action': 'enqueued', 'task_ids': [new['id'],qa['id']],
                   'result_commit': result['canonical_commit'], 'owner_binding_path': binding_path}
        return before, item, result, after, receipt

    def verify_owner(self, before, item, result, after, receipt, active=False):
        with mock.patch.object(autopilot, 'BACKLOG_PATH', self.runtime / 'backlog.json'):
            return autopilot.verify_planner_publication({'workspace': str(self.work)}, receipt,
                result, before, after, [item], active_admission_only=active)

    def test_owner_publication_verifies_exact_request_and_real_result_commit(self):
        before, item, result, after, receipt = self.owner_fixture()
        self.assertTrue(self.verify_owner(before, item, result, after, receipt, True)[0])
        for field, value in [('text', 'Different Owner request'), ('id', 'different-owner')]:
            self.assertFalse(self.verify_owner(before, {**item, field: value}, result, after, receipt)[0])
        for field, value in [('result_commit', before['_canonical_commit']), ('task_ids', ['imaginary']),
                             ('owner_binding_path', 'docs/manifest/absent.json'), ('project', 'OtherProject')]:
            self.assertFalse(self.verify_owner(before, item, result, after, {**receipt, field: value})[0])
        self.assertFalse(self.verify_owner(before, item, {**result, 'runtime_blob': 'a' * 40}, after, receipt)[0])

    def test_active_owner_publication_rejects_product_code_even_if_receipt_says_enqueued(self):
        before, item, result, after, receipt = self.owner_fixture()
        (self.work / 'product-code.txt').write_text('outside PM active scope\n')
        git(self.work, 'add', 'product-code.txt'); git(self.work, 'commit', '-qm', 'unsafe mixed publication')
        git(self.work, 'push', '-q', 'origin', 'main')
        result = self.sync(); receipt['result_commit'] = result['canonical_commit']
        ok, reason = self.verify_owner(before, item, result, after, receipt, True)
        self.assertFalse(ok); self.assertIn('non-PM', reason)

    def test_owner_intake_plans_real_publication_at_one_and_two_active_slots(self):
        paths = {'ROOT': self.runtime, 'CONFIG_PATH': self.runtime / 'config.json',
                 'RUNNER_STATE_PATH': self.runtime / 'state.json', 'BACKLOG_PATH': self.runtime / 'backlog.json',
                 'AUTOPILOT_STATE_PATH': self.runtime / 'autopilot-state.json',
                 'AUTOPILOT_LOCK_PATH': self.runtime / 'autopilot.lock',
                 'OWNER_INBOX_DIR': self.runtime / 'owner-inbox'}
        paths['OWNER_INBOX_DIR'].mkdir()
        extra = []
        for count in (1, 2):
            with self.subTest(active_slots=count):
                active = {'web-live': {'id': 'web-live', 'locks': ['web'], 'agent_pid': 10001}}
                if count == 2: active['api-high'] = {'id': 'api-high', 'locks': ['api'], 'agent_pid': 10002}
                self.set_state(active=active)
                paths['AUTOPILOT_STATE_PATH'].unlink(missing_ok=True)
                item = {'id': f'owner-{count}', 'origin': 'OWNER_INBOX', 'status': 'NEW',
                        'payload': {'text': f'Admit independent source task {count}'}}
                item_path = paths['OWNER_INBOX_DIR'] / (item['id'] + '.json')
                item_path.write_text(json.dumps(item))
                protected_state = (self.runtime / 'state.json').read_bytes()
                def publish(cfg, owner_items, active_admission_only=False):
                    self.assertTrue(active_admission_only)
                    self.assertEqual(owner_items[0]['payload']['text'], item['payload']['text'])
                    new = {**task(f'owner-new-{count}', locks=['docs'], ref=self.ref), 'effect_ceiling': 'source_only'}
                    qa = {**task(f'qa-owner-new-{count}', deps=[new['id']], locks=['docs'], ref=self.ref), 'effect_ceiling': 'source_only'}
                    binding_path = f'docs/manifest/OWNER_PUBLICATION_{count}.json'
                    (self.work / binding_path).write_text(json.dumps({'project': 'GoBadminton', 'instructions': [{
                        'id': item['id'], 'text_sha256': hashlib.sha256(item['payload']['text'].encode()).hexdigest(),
                        'action': 'enqueued', 'task_ids': [new['id'],qa['id']]}]}))
                    git(self.work, 'add', binding_path)
                    extra.extend([new,qa]); self.update_canonical([self.web, self.api, *extra])
                    return True, 'published source task', {'ok': True, 'project': 'GoBadminton',
                        'action': 'enqueued', 'task_ids': [new['id'],qa['id']], 'owner_binding_path': binding_path,
                        'result_commit': git(self.work, 'rev-parse', 'HEAD')}
                with ExitStack() as stack:
                    for key, value in paths.items(): stack.enter_context(mock.patch.object(autopilot, key, value))
                    stack.enter_context(mock.patch.object(autopilot, 'log'))
                    stack.enter_context(mock.patch.object(autopilot, 'any_gobadminton_cursor_active', return_value=(False, 'managed workers')))
                    stack.enter_context(mock.patch.object(autopilot, 'launch_planner', side_effect=publish))
                    stack.enter_context(mock.patch.object(autopilot, 'wait_for_wake', side_effect=StopIteration))
                    with self.assertRaises(StopIteration): autopilot.main()
                self.assertEqual(json.loads(item_path.read_text())['status'], 'PLANNED')
                self.assertEqual((self.runtime / 'state.json').read_bytes(), protected_state)

    def test_notice_is_stable_across_unrelated_head_errors_and_restart(self):
        self.sync()
        held = task('owner-held', enabled=False, ref=self.ref)
        self.update_canonical([self.web, self.api, held]); self.sync()
        doc = self.work / 'docs/manifest/PM_ADMISSION_HELD.md'
        doc.write_text('# Source-only\nStatus: SOURCE_ONLY_ADMITTED\n`owner-held` and `missing-task`\n')
        git(self.work, 'add', 'docs'); git(self.work, 'commit', '-qm', 'held admission')
        git(self.work, 'push', '-q', 'origin', 'main')
        result = self.sync()
        self.assertIn('missing-task', result['admission_drift'][0]['disabled_queued_task_ids'])
        with mock.patch.object(autopilot, 'OWNER_INBOX_DIR', self.runtime / 'owner-inbox'):
            with mock.patch.object(autopilot, 'durable_create_notice', side_effect=OSError('synthetic storage error')):
                self.assertEqual(autopilot.enqueue_admission_reconcile_notice(result), [])
            self.assertTrue(self.sync()['admission_drift'])
            ids = autopilot.enqueue_admission_reconcile_notice(result)
            git(self.work, 'commit', '--allow-empty', '-qm', 'unrelated main advance')
            git(self.work, 'push', '-q', 'origin', 'main')
            replay = self.sync()
            self.assertEqual(autopilot.enqueue_admission_reconcile_notice(replay), ids)
            notice = self.runtime / 'owner-inbox' / (ids[0] + '.json')
            original = json.loads(notice.read_text()); original['status'] = 'ACKNOWLEDGED'
            notice.write_text(json.dumps(original))
            state = self.runtime / 'state.json'; raw = state.read_bytes(); state.write_text('[]')
            self.assertEqual(self.sync()['status'], 'BLOCKED'); state.write_bytes(raw)
            self.assertEqual(autopilot.enqueue_admission_reconcile_notice(self.sync()), ids)
            self.assertEqual(json.loads(notice.read_text())['status'], 'ACKNOWLEDGED')
            self.assertEqual(len(list((self.runtime / 'owner-inbox').glob('*.json'))), 1)

    def test_eligibility_distinguishes_gates_even_with_two_full_slots(self):
        active = {'a': {'id': 'a', 'locks': ['web']}, 'b': {'id': 'b', 'locks': ['api']}}
        ready = task('independent-docs', locks=['docs'], ref=self.ref)
        wait_lock = task('api-wait', locks=['api'], ref=self.ref)
        dep = task('dep-wait', deps=['unfinished'], locks=['docs'], ref=self.ref)
        held = task('owner-held', enabled=False, ref=self.ref)
        failed = task('qa-failed', ref=self.ref)
        q = {'tasks': [ready, wait_lock, dep, held, failed]}
        state = {'active': active, 'history': [{'id': failed['id'], 'status': 'qa_failed'}]}
        rows = {r['id']: r['status'] for r in runner.queue_eligibility(q, state, {'max_parallel': 2})}
        self.assertEqual(rows, {'independent-docs': 'WAITING_CAPACITY', 'api-wait': 'WAITING_LOCK',
                               'dep-wait': 'WAITING_DEPENDENCY', 'owner-held': 'WAITING_OWNER_RELEASE',
                               'qa-failed': 'TERMINAL_QA'})
        state['active'] = {}
        self.assertEqual(runner.queue_eligibility(q, state, {'max_parallel': 2})[0]['status'], 'READY')

    def test_unknown_writer_with_visible_command_but_no_scope_fails_closed(self):
        class Agent:
            info = {'pid': 987654, 'name': 'codex', 'cmdline': ['codex', 'exec', 'synthetic prompt']}
            def cwd(self): raise runner.psutil.AccessDenied(pid=987654)
            def parents(self): return []
        with mock.patch.object(runner.psutil, 'process_iter', return_value=[Agent()]):
            busy, reason = runner.external_cursor_agent_busy({'workspace': str(self.work), 'dev_root': str(self.root)})
        self.assertTrue(busy); self.assertIn('fail closed', reason)


if __name__ == '__main__':
    unittest.main(verbosity=2)

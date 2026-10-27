"""P1/P2 regressions on this candidate; real Store, synthetic files/API/model only.

No Git writes, network, credentials, protected journals, gate substitutes or live
legacy certificates. Diff DATA is bounded at the immutable Git-reader boundary.
"""
import copy
import datetime as dt
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from test_actions_train import A, S, BASE, HEAD, core, issue, req, stage, receiver
from test_actions_train_cost_policy import cost_task
import test_plan_gate as G
import qa_recovery as Q
import recovery_admission as D


CHANGES = [dict(path='scripts/helper.py', status='M')]


def planned_task():
    block, _, _ = G.trusted_tools()
    task = cost_task()
    task['acceptance'] = block.attach(task['acceptance'], block.plan_for_changes(CHANGES))
    return task


class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='plan-lifecycle-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state_dir = self.root / 'state'
        self.state_dir.mkdir(mode=0o700)
        self.patches = []
        self.use(patch.object(A, '_SLOTS', None))
        # The actual worker.lock, load/save/phase/claim code is used throughout.
        A.atomic(self.state_dir / 'state.json', dict(active=None, done=[152]))
        A.atomic(self.state_dir / 'parked.json', {'parked': [dict(
            issue=149, park_comment=1, allow_successors=[])]})
        A.atomic(self.state_dir / 'deferred.json', {'deferred': []})
        A.atomic(self.state_dir / 'actions-deferred.json', {'entries': [dict(
            issue=177, reason='UNKNOWN', attempts=3, charged_calls=3)]})
        self.store = A.Store(self.state_dir)
        self.addCleanup(os.close, self.store.lock)
        self.claim = Mock(wraps=self.store.claim)
        self.store.claim = self.claim
        self.worktrees = self.root / 'worktrees'
        self.worktrees.mkdir()
        self.bridge = SimpleNamespace(c=SimpleNamespace(state_dir=self.state_dir,
            worktrees_root=self.worktrees), work=self.worktrees,
            unchanged_issue=Mock(), git=Mock(return_value=''), remote_dev=Mock(return_value=BASE),
            clean=Mock(), candidate_identity=Mock(), model=Mock(return_value=dict(
                verdict='PASS', findings=[], reviewed_sha=HEAD)))
        self.rt = SimpleNamespace(lease=Mock(), publish=Mock(), budget=Mock())
        self.task = cost_task()  # deliberately modern, immutable, no TEST PLAN
        self.parent = issue(task=self.task)
        self.comments = []
        self.api = Mock(side_effect=lambda path: copy.deepcopy(self.parent))
        self.api.pages.side_effect = lambda path: copy.deepcopy(self.comments)
        self.context = (A, S, self.rt, self.api, self.store, self.bridge)
        self.use(patch.object(stage, 'setup', return_value=self.context))
        self.receiver_dir = self.root / 'receiver'
        self.receiver_dir.mkdir(mode=0o700)
        self.use(patch.object(receiver, 'STATE', self.receiver_dir))
        self.use(patch.object(receiver, 'hosted_identity'))
        self.guard = self.use(patch.object(receiver, 'guard', return_value=SimpleNamespace()))
        self.use(patch.object(receiver, 'checkpoint', side_effect=lambda slot:
            (copy.deepcopy(self.store.data) if slot == 'slot1' else dict(active=None, done=[]), [])))
        self.use(patch.object(core, 'API', return_value=self.api))
        self.fork = self.use(patch.object(receiver.os, 'fork', return_value=123456))
        self.use(patch.object(receiver, 'identity', return_value=dict(pid=123456, start='1', boot='test')))
        self.use(patch.object(receiver, 'alive', return_value=False))
        original_read = receiver.read
        self.use(patch.object(receiver, 'read', side_effect=lambda path, owner=None, limit=2097152:
            original_read(path, None, limit)))
        self.policy = dict(mode='active', owned={'slot1': 'synthetic', 'slot2': 'synthetic'})
        self.request = req('claim', 'idle') | dict(head=None, attempt=0)

    def use(self, patcher):
        value = patcher.start()
        self.addCleanup(patcher.stop)
        return value

    def plan(self):
        self.task = planned_task()
        self.parent = issue(task=self.task)

    def files(self):
        return {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*')
                if p.is_file()}

    def worker_refuses(self, expected='MISSING_TEST_PLAN', request=None):
        before = self.files()
        result = stage.entry(request or self.request, self.policy)
        self.assertEqual(result['reason'], expected)
        self.assertEqual(self.files(), before)
        self.claim.assert_not_called()
        self.rt.lease.assert_not_called()
        self.bridge.git.assert_not_called()
        self.bridge.model.assert_not_called()
        return result

    def receiver_refuses(self, expected='MISSING_TEST_PLAN', request=None):
        before = self.files()
        with self.assertRaisesRegex(core.Refused, expected):
            receiver.handle(request or self.request, self.policy)
        self.assertEqual(self.files(), before)
        self.fork.assert_not_called()
        self.bridge.model.assert_not_called()

    def comment_admission(self):
        body = self.parent['body']
        # The pinned comment verifier retains the real parent Owner identity.
        self.parent.update(body='Ordinary product discussion')
        self.comments = [dict(id=9001, issue_url=f'https://api.github.com/repos/{core.REPO}/issues/200',
            user={'id': core.OWNER}, body=body, created_at=self.parent['created_at'],
            updated_at=self.parent['updated_at'])]

    def active_qa(self):
        active = dict(issue=200, task=copy.deepcopy(self.task), fingerprint=A.fingerprint(self.parent),
            approved_since=core.SINCE, phase='pr_wait', base=BASE, head=HEAD, attempt=1,
            qa=None, ci=None, pr=300, history=[dict(attempt=1, head=BASE, outcome='UNKNOWN', charged_calls=1)])
        self.store.data['active'] = active
        self.store.save()
        return active

    def stopped_journal(self, result, *, task_hash=True):
        request = req('qa', 'pr_wait')
        key = core.digest(core.binding(request))
        op = dict(binding=core.binding(request), run=100, run_attempt=1, process=None,
            finished_at=123, before=core.digest(self.store.data), after=core.digest(self.store.data),
            result=copy.deepcopy(result))
        if task_hash: op['task_hash'] = core.digest(self.store.data['active']['task'])
        journal = dict(generation=0, operations={key: op}, pending=key, deferred=[], last=None)
        receiver.atomic(self.receiver_dir / 'slot1.json', journal)
        return request, journal, op

    def diff(self, changes=CHANGES):
        tools = G.trusted_tools()
        self.use(patch.object(G, 'trusted_tools', return_value=tools))
        return self.use(patch.object(tools[2], 'diff_changes', return_value=changes))

    def test_missing_plan_body_claim_is_byte_inert_real_store(self):
        self.worker_refuses()

    def test_missing_plan_comment_claim_is_byte_inert_real_store(self):
        self.comment_admission()
        self.worker_refuses()

    def test_missing_plan_receiver_body_refuses_before_reservation(self):
        self.receiver_refuses()

    def test_missing_plan_receiver_comment_refuses_before_reservation(self):
        self.comment_admission()
        self.receiver_refuses()

    def test_malformed_plan_claim_and_receiver_leave_all_bytes_unchanged(self):
        block, _, _ = G.trusted_tools()
        self.task['acceptance'] += block.BEGIN + '{}' + block.END
        self.parent = issue(task=self.task)
        self.worker_refuses('BAD_FIELD')
        self.receiver_refuses('BAD_FIELD')

    def test_stale_receiver_task_hash_refuses_before_store_claim(self):
        self.plan()
        self.worker_refuses('PLAN_SWAPPED', self.request | {'_task_hash': 'f' * 64})

    def test_receiver_admission_changed_before_worker_cannot_claim(self):
        self.plan()
        receiver.handle(self.request, self.policy)
        journal = receiver.journal('slot1')
        task_hash = journal['operations'][journal['pending']]['task_hash']
        self.task['goal'] += ' changed'
        self.parent = issue(task=self.task)
        self.worker_refuses('PLAN_SWAPPED', self.request | {'_task_hash': task_hash})

    def test_t3_missing_required_groups_refuses_before_claim_or_reservation(self):
        block, _, _ = G.trusted_tools()
        plan = block.plan_for_changes([dict(path='scripts/chatops/actions_train/stage.py', status='M')])
        plan['groups'] = ['foundation']
        self.task['acceptance'] = block.render(plan)
        self.parent = issue(task=self.task)
        self.worker_refuses('MISSING_REQUIRED_GROUPS')
        self.receiver_refuses('MISSING_REQUIRED_GROUPS')

    def test_ambiguous_body_and_comment_cannot_be_filtered_by_plan_validity(self):
        self.comment_admission()
        self.parent = issue(task=planned_task())
        self.worker_refuses('no unique immutable task admission')
        self.receiver_refuses('no exact unique Owner or reviewed delegated task')

    def test_zero_and_multiple_comments_never_claim(self):
        self.comment_admission()
        self.comments.append(dict(self.comments[0], id=9002))
        self.worker_refuses('no unique immutable task admission')
        self.receiver_refuses('no exact unique Owner or reviewed delegated task')
        self.comments = []
        self.worker_refuses('no unique immutable task admission')
        self.receiver_refuses('no exact unique Owner or reviewed delegated task')

    def test_missing_plan_preserves_prior_done_active_and_history(self):
        old = self.active_qa()
        old.update(phase='done', issue=150)
        self.store.save()
        self.worker_refuses()
        self.assertEqual(self.store.data['done'], [152])

    def test_valid_plan_claim_calls_real_store_once_on_same_fetched_batch(self):
        self.plan()
        with patch.object(S, 'admitted', wraps=S.admitted) as preview:
            result = stage.entry(self.request | {'_task_hash': G.digest(self.task)}, self.policy)
        self.assertEqual(result['status'], 'confirmed')
        self.claim.assert_called_once()
        preview.assert_called_once()
        self.assertEqual(self.claim.call_args.args[0], preview.call_args.args[1])
        self.assertEqual(self.claim.call_args.args[2], preview.call_args.args[2])
        self.assertEqual(self.store.data['active']['attempt'], 0)
        self.assertEqual(self.store.data['active']['base'], BASE)
        self.assertEqual(self.store.data['done'], [152])

    def test_valid_receiver_reserves_once_and_duplicate_does_not_fork(self):
        self.plan()
        first = receiver.handle(self.request, self.policy)
        second = receiver.handle(self.request, self.policy)
        self.assertEqual(first['status'], 'running')
        self.assertEqual(second['status'], 'unknown')
        self.fork.assert_called_once()
        journal = receiver.journal('slot1')
        self.assertEqual(journal['stage_counts'], {'200': 1})
        self.assertEqual(len(journal['operations']), 1)

    def test_receiver_other_slot_pending_overlap_still_refuses(self):
        self.plan()
        receiver.handle(self.request, self.policy)
        with self.assertRaisesRegex(core.Refused, 'overlapping pending claim'):
            receiver.handle(self.request | {'slot': 'slot2'}, self.policy)
        self.fork.assert_called_once()

    def test_full_missing_plan_refusal_unknown_recovery_never_calls_model_or_writes_pass(self):
        self.active_qa()
        request = req('qa', 'pr_wait')
        before = self.files()
        result = stage.entry(request, self.policy)
        self.assertEqual(result['status'], 'unknown')
        self.assertEqual(result['reason'], 'MISSING_TEST_PLAN')
        self.assertEqual(result['test_plan']['legacy_proof'], 'MISSING_LEGACY_OPERATION_PROOF')
        self.assertEqual(self.files(), before)
        request, journal, _ = self.stopped_journal(result)
        self.assertFalse(Q.safe_pending(journal, self.store.data, lambda _: False))
        self.receiver_refuses('unknown QA state changed', request)
        before = self.files()
        recovered = stage.entry(request | {'_recover': True}, self.policy)
        self.assertEqual(recovered['reason'], 'MISSING_TEST_PLAN')
        self.assertEqual(self.files(), before)
        self.bridge.model.assert_not_called()
        self.bridge.git.assert_not_called()
        self.rt.lease.assert_not_called()
        self.assertIsNone(self.store.data['active']['qa'])

    def test_historical_unknown_without_gate_metadata_still_requires_plan_before_recovery_counter(self):
        self.active_qa()
        request, journal, _ = self.stopped_journal(dict(status='unknown', safe_release=False))
        self.assertTrue(Q.safe_pending(journal, self.store.data, lambda _: False))
        self.receiver_refuses(request=request)

    def test_direct_reconcile_missing_plan_cannot_accept_saved_synthetic_pass(self):
        self.active_qa()
        saved = self.state_dir / 'qa-200-a1.json'
        saved.write_text(json.dumps(dict(verdict='PASS', findings=[], reviewed_sha=HEAD)))
        self.bridge.work = self.worktrees / 'issue-200'
        before = self.files()
        with self.assertRaisesRegex(core.Refused, 'MISSING_TEST_PLAN'):
            Q.reconcile(A, self.bridge, self.rt, self.store, req('qa', 'pr_wait'))
        self.assertEqual(self.files(), before)
        self.bridge.model.assert_not_called()
        self.bridge.candidate_identity.assert_not_called()

    def test_recovery_identity_process_checkpoint_and_spent_reservation_still_hold(self):
        self.plan(); self.active_qa()
        request, journal, op = self.stopped_journal(dict(status='unknown', safe_release=False))
        self.assertFalse(Q.safe_pending(journal, self.store.data, lambda _: True))
        op['after'] = 'f' * 64
        self.assertFalse(Q.safe_pending(journal, self.store.data, lambda _: False))
        op['after'] = core.digest(self.store.data)
        op['recovery_attempts'] = 1
        receiver.atomic(self.receiver_dir / 'slot1.json', journal)
        before = self.files()
        self.assertEqual(receiver.handle(request, self.policy)['status'], 'unknown')
        self.assertEqual(self.files(), before)
        self.fork.assert_not_called()

    def test_valid_plan_recovery_dirty_or_wrong_sha_saved_pass_requires_new_qa(self):
        self.plan(); self.active_qa(); self.diff()
        self.bridge.work = self.worktrees / 'issue-200'
        original = self.worktrees / 'qa-issue-200-a1'
        original.mkdir()
        primary = self.state_dir / 'qa-200-a1.json'
        primary.write_text(json.dumps(dict(verdict='PASS', findings=[], reviewed_sha=BASE)))
        self.bridge.git.side_effect = lambda *args, **kwargs: (
            HEAD if args[0] == 'rev-parse' else
            ' M source.py' if args[0] == 'status' and kwargs.get('cwd') == original else '')
        result = Q.reconcile(A, self.bridge, self.rt, self.store, req('qa', 'pr_wait') | {'_recover': True})
        self.assertEqual(result['source'], 'one bounded replacement read-only QA')
        self.bridge.model.assert_called_once()
        prior = list(self.state_dir.glob('qa-prior-*.json'))
        self.assertEqual(len(prior), 1)
        self.assertEqual(json.loads(prior[0].read_text())['reviewed_sha'], BASE)
        with self.assertRaisesRegex(core.Refused, 'QA recovery result already recorded'):
            Q.reconcile(A, self.bridge, self.rt, self.store, req('qa', 'pr_wait') | {'_recover': True})
        self.bridge.model.assert_called_once()

    def test_bare_flags_age_schema_ids_and_fake_certificate_never_exempt(self):
        active = self.active_qa()
        for extra in ({'_recover': True}, {'_recovery_admission': True},
                      {'_legacy_plan': {'trusted': True, 'source': 'old', 'operation': 'id'}}, {}):
            with self.subTest(extra=extra):
                active['approved_since'] = '2020-01-01T00:00:00+00:00'
                active['recovery_receipt'] = 'old-operation'
                receipt = G.check(active, req('qa', 'pr_wait') | extra)
                self.assertEqual(receipt['status'], 'MISSING_TEST_PLAN')

    def test_previous_plan_task_pins_and_candidate_cannot_be_swapped(self):
        self.plan(); active = self.active_qa(); self.diff()
        request = req('qa', 'pr_wait')
        previous = G.check(active, request)
        self.assertEqual(previous['status'], 'OK')
        for field, value, code in [('base', BASE[::-1] + '0', 'HEAD_MISMATCH'),
                                  ('testing_pins_digest', 'f' * 64, 'TESTING_PIN_MISMATCH')]:
            self.assertEqual(G.check(active, request, previous=previous | {field: value})['status'], code)
        active['task']['acceptance'] = 'plan removed'
        self.assertEqual(G.check(active, request | {'_recover': True}, previous=previous)['status'], 'PLAN_SWAPPED')

    def test_present_invalid_plan_never_exempt_on_recovery(self):
        block, classifier, _ = G.trusted_tools()
        plan = block.plan_for_changes(CHANGES)
        variants = [(block.BEGIN + '{}' + block.END, 'BAD_FIELD'),
                    (block.render(plan) * 2, 'DUPLICATE_BLOCK'),
                    (block.render(plan) + 'x' * 6000, 'ACCEPTANCE_TOO_LONG'),
                    (block.render(dict(plan, tier='T3', risk='critical', groups=['foundation'])),
                     'MISSING_REQUIRED_GROUPS')]
        active = self.active_qa()
        for acceptance, code in variants:
            with self.subTest(code=code):
                active['task']['acceptance'] = acceptance
                self.assertEqual(G.check(active, req('author', 'claimed') | {'_recover': True,
                    '_recovery_admission': {'trusted': True}})['status'], code)

    def test_underdeclared_groups_and_visual_diff_remain_required_on_recovery(self):
        block, _, _ = G.trusted_tools()
        self.plan(); active = self.active_qa()
        diff = self.diff([dict(path='scripts/chatops/actions_train/stage.py', status='M')])
        self.assertEqual(G.check(active, req('qa', 'pr_wait') | {'_recover': True})['status'], 'UNDER_DECLARED')
        diff.return_value = [dict(path='apps/web/src/components/Card.tsx', status='M')]
        plan = block.plan_for_changes(diff.return_value); plan['visual_qa'] = False
        active['task']['acceptance'] = block.render(plan)
        self.assertEqual(G.check(active, req('qa', 'pr_wait') | {'_recover': True})['status'], 'VISUAL_QA_REQUIRED')
        diff.return_value = CHANGES
        plan = block.plan_for_changes(CHANGES); plan['groups'] = ['foundation']
        active['task']['acceptance'] = block.render(plan)
        self.assertEqual(G.check(active, req('qa', 'pr_wait') | {'_recover': True})['status'], 'MISSING_REQUIRED_GROUPS')

    def test_seeded_claim_idle_wire_and_later_candidate_identity_are_distinct(self):
        task = planned_task()
        receipt = G.claim_check(task, self.request, seed=dict(base=BASE, head=HEAD))
        self.assertEqual(receipt['status'], 'OK')
        self.assertEqual((receipt['base'], receipt['head']), (BASE, HEAD))
        self.assertEqual(G.claim_check(task, self.request | {'head': HEAD},
            seed=dict(base=BASE, head=HEAD))['status'], 'HEAD_MISMATCH')
        active = dict(task=task, base=BASE, head=HEAD)
        self.assertEqual(G.check(active, req() | {'head': BASE})['status'], 'HEAD_MISMATCH')

    def delegated(self, with_plan):
        # Build the existing reviewed delegated receipt before immutable admission.
        from test_actions_train_recovery import R, config, terminal, diagnosis
        original = terminal()
        if with_plan:
            block, _, _ = G.trusted_tools()
            task = original['snapshot']['task']
            task['acceptance'] = block.attach(task['acceptance'], block.plan_for_changes(CHANGES))
        self.policy = config(original)
        cache = R.empty(); key = R.enroll(cache, original, 'slot1', self.policy)
        request = req('diagnose', 'qa') | dict(issue=177, attempt=3)
        R.reserve(cache, request, self.policy)
        r = R.finish(cache, key, 'diagnose', dict(status='confirmed', outcome=diagnosis(), evidence=[]), self.policy)
        R.reserve(cache, request | {'stage': 'task_review'}, self.policy)
        review = dict(verdict='PASS', findings=[], receipt_hash=core.digest(r['frozen']),
            proposed_task_hash=core.digest(r['proposal']), evidence_hash=core.digest(r['diagnosis']['evidence']),
            diagnosis_hash=core.digest(r['diagnosis']['result']))
        r = R.finish(cache, key, 'task_review', dict(status='confirmed', outcome=review), self.policy)
        from test_actions_train_recovery_admission import child
        self.parent = child(r)
        self.request |= {'issue': 777}
        self.api.pages.side_effect = lambda path: [copy.deepcopy(self.parent)] if path.startswith('issues?') else []
        self.use(patch.object(D, 'parent_unchanged'))  # synthetic remote immutability boundary
        self.use(patch.object(receiver, 'recovery_journal', return_value=cache))
        return cache

    def test_valid_reviewed_delegated_claim_seeds_head_without_second_claim_implementation(self):
        cache = self.delegated(True)
        cert = D.root_admission(A, self.api, cache, self.parent, self.policy)
        before = copy.deepcopy(cert['frozen'])
        self.bridge.git.side_effect = lambda *args, **kwargs: (
            cert['frozen']['head'] if args[0] == 'rev-parse' else
            cert['frozen']['base'] if args[0] == 'merge-base' else '')
        with patch.object(D, 'claim', wraps=D.claim) as claim:
            result = stage.entry(self.request | {'_recovery_admission': cert,
                '_task_hash': G.digest(cert['task'])}, self.policy)
        self.assertEqual(result['status'], 'confirmed')
        claim.assert_called_once(); self.claim.assert_not_called()
        self.assertEqual(self.store.data['active']['head'], before['head'])
        self.assertEqual(self.store.data['active']['attempt'], 0)
        self.assertEqual(cert['frozen'], before)
        self.assertEqual(before['snapshot']['attempt'], 3)

    def test_reviewed_delegated_missing_plan_is_not_legacy_and_cache_is_not_saved(self):
        cache = self.delegated(False)
        cert = D.root_admission(A, self.api, copy.deepcopy(cache), self.parent, self.policy)
        self.worker_refuses(request=self.request | {'_recovery_admission': cert})
        self.receiver_refuses()
        self.assertFalse((self.receiver_dir / 'recovery.json').exists())

    def test_tampered_delegated_frozen_identity_refuses_before_save(self):
        cache = self.delegated(True)
        cert = D.root_admission(A, self.api, cache, self.parent, self.policy)
        cert['frozen']['head'] = 'e' * 40
        self.worker_refuses('recovery certificate frozen digest mismatch',
                            self.request | {'_recovery_admission': cert})


if __name__ == '__main__':
    unittest.main()

"""Owner DIRECT 2026-10-27: one source writer, provider-independent QA boundaries.

Synthetic fixtures only. No network, package install, runtime claim, or READY assert.
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'actions_train'))
from live import slots as S
import core


TASK_A = dict(schema='GOBADMINTON_TASK_V1', title='A', acceptance='a',
              allowed_paths=['apps/web/src/a.ts'], locks=['web:a'], max_attempts=3)
TASK_B = dict(schema='GOBADMINTON_TASK_V1', title='B', acceptance='b',
              allowed_paths=['apps/api/src/b.ts'], locks=['api:b'], max_attempts=3)


def _card(active=None, owned=True, pending=None, reservation=None, done=None, parked=None):
    return dict(owned=owned, active=active, pending=pending, reservation=reservation,
                done=list(done or []), parked=list(parked or []), generation=1, profile='auto')


def _active(phase, issue=200, task=TASK_A):
    return dict(issue=issue, phase=phase, head='a' * 40, attempt=1, task=task,
                locks=task['locks'], allowed_paths=task['allowed_paths'])


class OneWriterConflicts(unittest.TestCase):
    def test_disjoint_writers_conflict_globally(self):
        a = S.task_record(200, TASK_A, writer=True)
        b = S.task_record(201, TASK_B, writer=True)
        self.assertTrue(S.conflicts(a, b))

    def test_immutable_qa_does_not_global_block_disjoint_author(self):
        qa = S.task_record(200, TASK_A, writer=False)
        author = S.task_record(201, TASK_B, writer=True)
        self.assertFalse(S.conflicts(qa, author))

    def test_qa_still_conflicts_on_same_paths(self):
        qa = S.task_record(200, TASK_A, writer=False)
        author = S.task_record(201, TASK_A, writer=True)
        self.assertTrue(S.conflicts(qa, author))

    def test_legacy_lease_without_writer_flag_is_writer(self):
        legacy = dict(issue=200, locks=['web:a'], allowed_paths=['apps/web/src/a.ts'], depends_on=[])
        self.assertTrue(S.record_is_writer(legacy))
        self.assertTrue(S.conflicts(legacy, S.task_record(201, TASK_B, writer=True)))

    def test_unknown_writer_phase_helpers(self):
        self.assertTrue(S.is_source_writer_phase('developing'))
        self.assertTrue(S.is_source_writer_stage('author'))
        self.assertFalse(S.is_source_writer_phase('qa'))
        self.assertFalse(S.is_source_writer_stage('qa'))
        self.assertFalse(S.is_source_writer_stage('qa_qualification'))


class LockRegistryOneWriter(unittest.TestCase):
    """Bounded real flock acquire: second disjoint writer rejected; disjoint QA allowed."""

    def test_acquire_rejects_second_disjoint_writer_allows_disjoint_qa(self):
        with tempfile.TemporaryDirectory(prefix='.one-writer-locks-') as tmp:
            locks = Path(tmp) / 'locks'
            locks.mkdir()
            registry_lock = locks / 'registry.lock'
            os.close(os.open(registry_lock, os.O_RDWR | os.O_CREAT, 0o660))
            first = S.LockRegistry(locks, registry_lock)
            second = S.LockRegistry(locks, registry_lock)
            writer_a = S.task_record(200, TASK_A, writer=True)
            writer_b = S.task_record(201, TASK_B, writer=True)
            self.assertTrue(first.acquire('slot1', writer_a))
            self.assertFalse(second.acquire('slot2', writer_b))
            qa = S.LockRegistry(locks, registry_lock)
            self.assertTrue(qa.acquire('slot2', S.task_record(201, TASK_B, writer=False)))
            qa.release()
            first.release()
            self.assertTrue(second.acquire('slot2', writer_b))
            second.release()

    def test_acquire_legacy_missing_writer_fail_closed_blocks_disjoint(self):
        with tempfile.TemporaryDirectory(prefix='.one-writer-legacy-') as tmp:
            locks = Path(tmp) / 'locks'
            locks.mkdir()
            registry_lock = locks / 'registry.lock'
            os.close(os.open(registry_lock, os.O_RDWR | os.O_CREAT, 0o660))
            held = S.LockRegistry(locks, registry_lock)
            legacy = dict(issue=200, locks=['web:a'], allowed_paths=['apps/web/src/a.ts'], depends_on=[])
            self.assertTrue(held.acquire('slot1', legacy))
            other = S.LockRegistry(locks, registry_lock)
            self.assertFalse(other.acquire('slot2', S.task_record(201, TASK_B, writer=True)))
            held.release()
            self.assertTrue(other.acquire('slot2', S.task_record(201, TASK_B, writer=True)))
            other.release()


class PlanSequentialAuthors(unittest.TestCase):
    def test_two_disjoint_claims_become_one_author(self):
        snap = dict(mode='active', slots={'slot1': _card(), 'slot2': _card()})
        choices = [(200, TASK_A), (201, TASK_B)]
        planned = core.plan(None, S, snap, choices)
        self.assertEqual([x['issue'] for x in planned if x['stage'] == 'claim'], [200])
        self.assertEqual(len([x for x in planned if x['stage'] == 'claim']), 1)

    def test_active_writer_blocks_new_claim_even_disjoint(self):
        snap = dict(mode='active', slots={
            'slot1': _card(active=_active('claimed', 200, TASK_A)),
            'slot2': _card()})
        planned = core.plan(None, S, snap, [(201, TASK_B)])
        self.assertEqual([x for x in planned if x.get('stage') == 'claim'], [])
        self.assertTrue(any(x.get('stage') == 'author' for x in planned))

    def test_qa_phase_allows_disjoint_new_claim(self):
        snap = dict(mode='active', slots={
            'slot1': _card(active=_active('qa', 200, TASK_A)),
            'slot2': _card()})
        planned = core.plan(None, S, snap, [(201, TASK_B)])
        claims = [x for x in planned if x.get('stage') == 'claim']
        self.assertEqual([c['issue'] for c in claims], [201])

    def test_qa_reservation_while_pr_wait_allows_disjoint_claim(self):
        # Admitted QA stage lease is non-writer even if checkpoint phase is still pr_wait.
        snap = dict(mode='active', slots={
            'slot1': _card(active=_active('pr_wait', 200, TASK_A),
                           reservation=S.task_record(200, TASK_A, writer=False),
                           pending=dict(status='running', stage='qa',
                                        binding=dict(action='train', stage='qa', slot='slot1',
                                                     issue=200, phase='pr_wait', head='a' * 40,
                                                     attempt=1, generation=1, profile='auto'))),
            'slot2': _card()})
        planned = core.plan(None, S, snap, [(201, TASK_B)])
        self.assertEqual([x['issue'] for x in planned if x.get('stage') == 'claim'], [201])

    def test_unknown_author_pending_blocks_second_claim(self):
        binding = dict(action='train', stage='author', slot='slot1', issue=200, phase='developing',
                       head='a' * 40, attempt=1, generation=1, profile='auto')
        snap = dict(mode='active', slots={
            'slot1': _card(active=_active('developing', 200, TASK_A),
                           pending=dict(status='unknown', binding=binding, recoverable=False)),
            'slot2': _card()})
        planned = core.plan(None, S, snap, [(201, TASK_B)])
        self.assertEqual([x for x in planned if x.get('stage') == 'claim'], [])

    def test_pending_without_binding_fails_closed_when_no_reservation(self):
        snap = dict(mode='active', slots={
            'slot1': _card(pending=dict(status='running')),
            'slot2': _card()})
        planned = core.plan(None, S, snap, [(201, TASK_B)])
        self.assertEqual([x for x in planned if x.get('stage') == 'claim'], [])

    def test_unknown_qa_pending_does_not_count_as_writer_lease(self):
        binding = dict(action='train', stage='qa', slot='slot1', issue=200, phase='qa',
                       head='a' * 40, attempt=1, generation=1, profile='auto')
        snap = dict(mode='active', slots={
            'slot1': _card(active=_active('qa', 200, TASK_A),
                           pending=dict(status='unknown', binding=binding, recoverable=True)),
            'slot2': _card()})
        # Pending unknown on slot1 skips that slot; slot2 may still claim disjoint work.
        planned = core.plan(None, S, snap, [(201, TASK_B)])
        self.assertEqual([x['issue'] for x in planned if x.get('stage') == 'claim'], [201])


class SlotsPlanSequential(unittest.TestCase):
    def test_pm_plan_refuses_second_disjoint_writer(self):
        statuses = {
            'slot1': dict(active=dict(issue=200, phase='developing', locks=['web:a'],
                                      allowed_paths=['apps/web/src/a.ts']), done=[], parked=[]),
            'slot2': dict(active=None, done=[], parked=[]),
        }
        result, reasons = S.plan([(201, TASK_B)], statuses, {}, ['slot1', 'slot2'], 2)
        self.assertEqual(result, {})
        self.assertEqual(reasons.get(201), 'global source writer sequential')

    def test_pm_plan_allows_one_when_idle(self):
        statuses = {
            'slot1': dict(active=None, done=[], parked=[]),
            'slot2': dict(active=None, done=[], parked=[]),
        }
        always = S.Adapter('codex', 'codex', ('author', 'qa', 'review'), True, True, True, True, True, True)
        adapters = dict(S.ADAPTERS, codex=always)
        with patch.object(S, 'adapter_status', side_effect=lambda *a, **k: (True, 'enabled')):
            result, reasons = S.plan([(200, TASK_A), (201, TASK_B)], statuses, {},
                                     ['slot1', 'slot2'], 2, adapters=adapters)
        self.assertEqual(len(result), 1)
        self.assertEqual(reasons.get(201), 'global source writer sequential')


class QuotaPreserved(unittest.TestCase):
    def test_agy_issue_budget_module_still_imports(self):
        # Existing per-Issue UTC-day cap5 source must remain; covered by test_agy_issue_budget.
        self.assertEqual(S.Budget._PER_ISSUE, 'per_issue_daily')
        self.assertTrue(hasattr(S.Budget, 'issue_used'))
        self.assertTrue(hasattr(S.Budget, 'seed_issue_attribution'))


class LegacyUnknownPreservation(unittest.TestCase):
    def test_conflicts_still_bind_intersecting_unknown_resources(self):
        unknown = dict(issue=346, locks=['web:a'], allowed_paths=['apps/web/src/a.ts'],
                       depends_on=[], writer=True)
        other = S.task_record(400, TASK_A, writer=True)
        self.assertTrue(S.conflicts(unknown, other))


if __name__ == '__main__':
    unittest.main()

"""Owner DIRECT 2026-10-27: one source writer, provider-independent QA boundaries.

Synthetic fixtures only. No network, package install, runtime claim, or READY assert.
"""
import sys
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

    def test_unknown_author_pending_blocks_second_claim(self):
        binding = dict(action='train', stage='author', slot='slot1', issue=200, phase='developing',
                       head='a' * 40, attempt=1, generation=1, profile='auto')
        snap = dict(mode='active', slots={
            'slot1': _card(active=_active('developing', 200, TASK_A),
                           pending=dict(status='unknown', binding=binding, recoverable=False)),
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


class ProviderIndependentBoundaries(unittest.TestCase):
    def test_agy_executor_slot_helper_not_slot1(self):
        self.assertTrue(S.slot_maps_to_agy_executor('slot2'))
        self.assertFalse(S.slot_maps_to_agy_executor('slot1'))

    def test_agy_available_refuses_foreign_logical_slot_without_executor_uid(self):
        import native_antigravity as N
        with patch.object(N.os, 'geteuid', return_value=1002):
            ok, why = N.available('slot1', 'a' * 64)
        self.assertFalse(ok)
        self.assertIn('executor', why.lower())

    def test_agy_qualification_marker_uses_executor_home_not_logical_affinity(self):
        import native_antigravity as N
        self.assertEqual(N.AGY_EXECUTOR_SLOT, 'slot2')
        self.assertEqual(N.EXECUTOR_UID, 978)

    def test_cursor_uses_marker_slots_not_hard_single_affinity(self):
        import native_cursor as C
        # Role capability: marker.slots list admits whichever slots are qualified.
        self.assertEqual(set(C.SLOT_UIDS), {'slot1', 'slot2'})
        self.assertNotEqual(C.SLOT_UIDS['slot1'], C.SLOT_UIDS['slot2'])


class LegacyUnknownPreservation(unittest.TestCase):
    def test_isolation_receipt_holds_without_fabricating_disjoint_proof(self):
        out = S.historical_unknown_isolation_receipt({
            'note': 'no processes observed',
            'safe_release': True,  # caller wish must not override
        })
        self.assertEqual(out['status'], 'HOLD')
        self.assertIs(out['safe_release'], False)
        self.assertIs(out['automatic_clear'], False)
        self.assertIn('insufficient', out['reason'])

    def test_isolation_receipt_holds_even_with_claimed_proofs(self):
        out = S.historical_unknown_isolation_receipt({
            'stopped_process_identity': True,
            'protected_dependencies': True,
            'resource_disjoint_proof': True,
            'historical_effects_excluded': True,
        })
        self.assertEqual(out['status'], 'HOLD')
        self.assertIs(out['safe_release'], False)

    def test_conflicts_still_bind_intersecting_unknown_resources(self):
        unknown = dict(issue=346, locks=['web:a'], allowed_paths=['apps/web/src/a.ts'],
                       depends_on=[], writer=True)
        other = S.task_record(400, TASK_A, writer=True)
        self.assertTrue(S.conflicts(unknown, other))


class QuotaPreserved(unittest.TestCase):
    def test_agy_issue_budget_module_still_imports(self):
        # Existing per-Issue UTC-day cap5 source must remain; covered by test_agy_issue_budget.
        self.assertEqual(S.Budget._PER_ISSUE, 'per_issue_daily')
        self.assertTrue(hasattr(S.Budget, 'issue_used'))
        self.assertTrue(hasattr(S.Budget, 'seed_issue_attribution'))


if __name__ == '__main__':
    unittest.main()

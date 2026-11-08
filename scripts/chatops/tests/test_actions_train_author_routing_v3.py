"""B1 synthetic policy checks only; never invoke a model or native adapter."""
from dataclasses import replace
from pathlib import Path
import sys
from contextlib import contextmanager
import unittest
from unittest.mock import patch

_TRAIN_DIR = Path(__file__).resolve().parents[3] / 'tools/train'
# Generic Lean import names also exist in legacy actions_train. Restore the
# complete import cache and path after discovery and after this module's tests.
_LEAN_NAMES = {p.stem for p in _TRAIN_DIR.glob('*.py')
               if not p.stem.startswith('test') and p.stem != '__init__'}


@contextmanager
def _lean_import_scope(modules=None):
    with patch.dict(sys.modules), patch.object(sys, 'path', [str(_TRAIN_DIR), *sys.path]):
        for name in list(sys.modules):
            if name.split('.')[0] in _LEAN_NAMES:
                sys.modules.pop(name)
        sys.modules.update(modules or {})
        yield


with _lean_import_scope():
    import author_routing as ar
    _LEAN_MODULES = {name: sys.modules[name] for name in _LEAN_NAMES if name in sys.modules}


def setUpModule():
    # Methods under test use absolute imports lazily as well as at load time.
    scope = _lean_import_scope(_LEAN_MODULES)
    scope.__enter__()
    unittest.addModuleCleanup(scope.__exit__, None, None, None)



BASE = 'a' * 40
SOURCE = 'b' * 40


def routes():
    return {
        ar.CURSOR: ar.Route(ar.CURSOR, True, True, True, 'cursor-exec', 'auto'),
        ar.AGY: ar.Route(ar.AGY, True, True, True, 'agy-exec', 'claude-sonnet-5-5-medium'),
        ar.CODEX: ar.Route(ar.CODEX, True, True, True, 'codex-author', 'gpt-6.1-sol:medium'),
    }


QA = ar.Reviewer('codex-qa', 'gpt-6-sol:medium', True, True, True)
SEPARATE_QA = ar.Reviewer('separate-qa', 'gpt-6-sol:medium', True, True, True)


def stopped(provider=ar.CURSOR, operation='op-1'):
    binding = ar.Operation('527', operation, provider, SOURCE, 'scope-digest', BASE)
    failure = ar.CapacityFailure(binding, 'envelope-fingerprint-' + operation,
                                 'QUOTA_EXHAUSTED', 'native_top_level_error')
    proof = ar.StopProof(binding, failure.fingerprint, True, True, True, False,
                         'checkpoint-' + operation, ('receipt-' + operation,), 'preserved_diff')
    return ar.CapacityStop(failure, proof)


def handoff(stop=None, **updates):
    stop = stop or stopped()
    args = dict(current=stop.failure.binding, failure=stop.failure, proof=stop.proof,
                routes=routes(), initial_provider=ar.CURSOR,
                cumulative_attempts=7, history_refs=('attempts-1-through-7',), reviewer=QA)
    args.update(updates)
    return ar.capacity_handoff(**args)


def select(**updates):
    args = dict(routes=routes(), complexity='ordinary', work_kind='product',
                policy_enabled=True, new_task=True)
    args.update(updates)
    return ar.select_author(**args)


class AssignmentTests(unittest.TestCase):
    def test_comparable_new_tasks_balance_by_bucket(self):
        buckets = {('ordinary', 'product'): {ar.CURSOR: 0, ar.AGY: 0},
                   ('complex', 'ops'): {ar.CURSOR: 0, ar.AGY: 0}}
        for (complexity, kind), counts in buckets.items():
            for _ in range(31):
                decision = select(complexity=complexity, work_kind=kind, history_counts=counts)
                counts[decision['provider']] += 1
            self.assertLessEqual(abs(counts[ar.CURSOR] - counts[ar.AGY]), 1)
            self.assertEqual(decision['bucket'], (complexity, kind))

    def test_missing_history_is_honest_deterministic(self):
        decision = select()
        self.assertEqual(decision['provider'], ar.CURSOR)
        self.assertIsNone(decision['history_counts'])
        self.assertIn('missing_history', decision['reason'])
        self.assertEqual(decision['initial_provider'], ar.CURSOR)
        self.assertEqual(decision['policy_version'], ar.POLICY_VERSION)

    def test_ordinary_fix_and_legacy_keep_author(self):
        for updates in (dict(new_task=False, current_provider=ar.AGY),
                        dict(current_provider=ar.AGY), dict(policy_enabled=False, current_provider=ar.AGY)):
            with self.subTest(updates=updates):
                decision = select(**updates)
                self.assertEqual((decision['action'], decision['provider']), ('KEEP', ar.AGY))
        self.assertEqual(select(policy_enabled=False)['action'], 'KEEP')

    def test_frozen_decision_not_reselected_on_retry(self):
        frozen = select()
        self.assertIs(select(frozen_decision=frozen, mobile_522=True), frozen)

    def test_mobile_preference_still_requires_qualification(self):
        self.assertEqual(select(mobile_522=True)['provider'], ar.AGY)
        available = routes()
        available[ar.AGY] = replace(available[ar.AGY], qualified=False)
        self.assertEqual(select(mobile_522=True, routes=available)['provider'], ar.CURSOR)

    def test_unadmitted_unqualified_unready_never_assigned(self):
        for field in ('admitted', 'qualified', 'ready'):
            available = routes()
            for p in (ar.CURSOR, ar.AGY):
                available[p] = replace(available[p], **{field: False})
            self.assertEqual(select(routes=available)['action'], 'HOLD')
        for provider in (ar.AGY, ar.CODEX):
            available = routes()
            available[provider] = replace(available[provider], model='unqualified-other-model')
            self.assertFalse(available[provider].available())
        available = {ar.CURSOR: routes()[ar.AGY]}
        self.assertEqual(select(routes=available)['action'], 'HOLD')

    def test_invalid_history_or_missing_bucket_holds(self):
        for counts in ({}, {ar.CURSOR: -1, ar.AGY: 0}, {ar.CURSOR: True, ar.AGY: 0}):
            self.assertEqual(select(history_counts=counts)['action'], 'HOLD')
        self.assertEqual(select(complexity='')['action'], 'HOLD')

    def test_unknown_blocks_even_frozen_assignment(self):
        self.assertEqual(select(pending_unknown=True, frozen_decision=select())['action'], 'HOLD')


class HandoffTests(unittest.TestCase):
    def test_cursor_to_agy_preserves_handoff(self):
        decision = handoff()
        self.assertEqual((decision['action'], decision['provider']), ('REQUIRE_NEW_ADMISSION', ar.AGY))
        self.assertEqual(decision['cumulative_attempts'], 7)
        self.assertEqual(decision['history_refs'], ('attempts-1-through-7',))
        self.assertEqual(decision['chain'], (stopped(),))
        self.assertEqual(decision['handoff']['original_base'], BASE)
        self.assertEqual(decision['handoff']['source_sha'], SOURCE)
        self.assertTrue(decision['handoff']['required_new_admission'])
        self.assertEqual(decision['handoff']['checkpoint_ref'], 'checkpoint-op-1')

    def test_agy_to_cursor(self):
        self.assertEqual(handoff(stopped(ar.AGY), initial_provider=ar.AGY)['provider'], ar.CURSOR)

    def test_both_exhausted_to_codex_in_either_order(self):
        for first, second in ((ar.CURSOR, ar.AGY), (ar.AGY, ar.CURSOR)):
            decision = handoff(stopped(second, 'op-2'), initial_provider=first,
                               chain=(stopped(first),), reviewer=SEPARATE_QA)
            self.assertEqual(decision['provider'], ar.CODEX)
            self.assertEqual(len(decision['chain']), 2)

    def test_unavailable_backup_holds_without_skipping(self):
        for field in ('admitted', 'qualified', 'ready'):
            available = routes()
            available[ar.AGY] = replace(available[ar.AGY], **{field: False})
            self.assertEqual(handoff(routes=available)['reason'], 'backup_unavailable')

    def test_no_provider_repeat_cycle_or_fourth_call(self):
        self.assertEqual(handoff(stopped(ar.CURSOR, 'op-2'), chain=(stopped(),))['action'], 'HOLD')
        self.assertEqual(handoff(stopped(ar.AGY), chain=(stopped(),))['action'], 'HOLD')
        self.assertEqual(handoff(stopped(ar.CODEX, 'op-3'),
                                chain=(stopped(), stopped(ar.AGY, 'op-2')))['reason'],
                         'capacity_chain_exhausted')

    def test_stop_proof_must_match_every_identity_field(self):
        stop = stopped()
        for field, value in (('task', 'other'), ('operation', 'other'), ('provider', ar.AGY),
                             ('source_sha', 'c' * 40), ('scope_id', 'other'), ('original_base', 'd' * 40)):
            with self.subTest(field=field):
                proof = replace(stop.proof, binding=replace(stop.proof.binding, **{field: value}))
                self.assertEqual(handoff(proof=proof)['action'], 'HOLD')
        self.assertEqual(handoff(current=replace(stop.failure.binding, operation='other'))['action'], 'HOLD')
        self.assertEqual(handoff(proof=replace(stop.proof, failure_fingerprint='other'))['action'], 'HOLD')

    def test_unstopped_unreconciled_out_of_scope_unknown_hold(self):
        stop = stopped()
        for field, value in (('stopped', False), ('source_reconciled', False),
                             ('within_scope', False), ('pending_unknown', True),
                             ('checkpoint_ref', ''), ('receipt_refs', ()), ('partial_state', '')):
            with self.subTest(field=field):
                self.assertEqual(handoff(proof=replace(stop.proof, **{field: value}))['action'], 'HOLD')

    def test_explicit_empty_diff_accepted_only_with_checkpoint(self):
        proof = replace(stopped().proof, partial_state='confirmed_empty_diff')
        self.assertEqual(handoff(proof=proof)['action'], 'REQUIRE_NEW_ADMISSION')
        self.assertEqual(handoff(proof=replace(proof, checkpoint_ref=''))['action'], 'HOLD')

    def test_missing_measurement_is_not_unknown(self):
        # No subscription measurement is supplied or required anywhere in B1.
        self.assertEqual(handoff()['action'], 'REQUIRE_NEW_ADMISSION')
        self.assertEqual(handoff(proof=replace(stopped().proof, pending_unknown=True))['action'], 'HOLD')

    def test_quota_like_code_tool_test_text_cannot_trigger(self):
        for text in ('QUOTA_EXHAUSTED', 'test says RATE_LIMIT', 'print("quota exhausted")'):
            self.assertEqual(handoff(failure=text)['action'], 'HOLD')
            forged = replace(stopped().failure, origin='tool_output', fingerprint=text)
            self.assertEqual(handoff(failure=forged)['action'], 'HOLD')
        for origin in ('source', 'test_output', 'user_output', 'task_output'):
            self.assertEqual(handoff(failure=replace(stopped().failure, origin=origin))['action'], 'HOLD')

    def test_program_qa_security_and_exit_codes_do_not_trigger(self):
        for code in ('PROGRAM_FAIL', 'QA_FAIL', 'SECURITY_REFUSAL', '1', 'quota exhausted'):
            self.assertEqual(handoff(failure=replace(stopped().failure, code=code))['action'], 'HOLD')
        self.assertEqual(handoff(failure=replace(stopped().failure, domain='PROGRAM'))['action'], 'HOLD')

    def test_trusted_preflight_known_capacity_supported(self):
        for code in ar.CAPACITY_CODES:
            failure = replace(stopped().failure, origin='trusted_preflight_budget_check', code=code)
            self.assertEqual(handoff(failure=failure)['action'], 'REQUIRE_NEW_ADMISSION')

    def test_prior_chain_and_history_cannot_be_reset(self):
        prior = stopped()
        bad_prior = replace(prior, proof=replace(prior.proof, source_reconciled=False))
        for chain in ((bad_prior,), (stopped(ar.AGY),)):
            self.assertEqual(handoff(stopped(ar.AGY, 'op-2'), chain=chain)['action'], 'HOLD')
        changed = stopped(ar.AGY, 'op-2')
        other = replace(prior.failure.binding, scope_id='different-scope')
        mismatched = ar.CapacityStop(replace(prior.failure, binding=other), replace(prior.proof, binding=other))
        self.assertEqual(handoff(changed, chain=(mismatched,))['action'], 'HOLD')
        for updates in (dict(history_refs=()), dict(cumulative_attempts=0), dict(initial_provider=ar.CODEX)):
            self.assertEqual(handoff(**updates)['action'], 'HOLD')

    def test_codex_author_requires_separate_qualified_reviewer(self):
        for reviewer in (None, replace(QA, model=ar.CODEX_MODEL), replace(SEPARATE_QA, executor='codex-author'),
                         replace(SEPARATE_QA, qualified=False), replace(SEPARATE_QA, admitted=False),
                         replace(SEPARATE_QA, ready=False)):
            self.assertEqual(handoff(stopped(ar.AGY, 'op-2'), chain=(stopped(),),
                                     reviewer=reviewer)['action'], 'HOLD')
        self.assertEqual(handoff(reviewer=replace(SEPARATE_QA, model=ar.CODEX_MODEL))['reason'], 'default_codex_qa_required')


if __name__ == '__main__':
    unittest.main()

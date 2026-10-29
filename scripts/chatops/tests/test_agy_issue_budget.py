"""AGY per-issue UTC daily budget: five calls per GitHub Issue, shared across roles/slots."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'actions_train'))
from live import slots as S


def limits(per_issue=5, agy_qa='unlimited', agy_author='unlimited',
           codex_qa=3, extra_providers=None):
    agy = {'qa': agy_qa, 'author': agy_author}
    if per_issue is not None:
        agy['per_issue_daily'] = per_issue
    providers = {'agy': agy, 'codex': {'qa': codex_qa, 'author': 'unlimited'}}
    if extra_providers:
        providers.update(extra_providers)
    slots = {
        'slot1': {'agy': {'qa': 'unlimited', 'author': 'unlimited'}, 'codex': {'qa': 'unlimited'}},
        'slot2': {'agy': {'qa': 'unlimited', 'author': 'unlimited'}, 'codex': {'qa': 'unlimited'}},
    }
    return {'schema': 1, 'providers': providers, 'slots': slots}


class AgyIssueBudget(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.out = self.root / 'out'
        for slot in ('slot1', 'slot2'):
            (self.out / slot).mkdir(parents=True)
        (self.root / 'lock').touch(mode=0o660)
        self.limits_path = self.root / 'budgets.json'
        self.day = '2026-10-27'
        self.limits_path.write_text(json.dumps(limits()))
        self.budget = S.Budget(self.limits_path, self.out, self.root / 'lock',
                               today=lambda: self.day)

    def tearDown(self):
        self.tmp.cleanup()

    def _write_ledger(self, slot, payload):
        (self.out / slot / 'ledger.json').write_text(json.dumps(payload))

    def test_issue_a_permits_five_then_refuses_sixth(self):
        self.budget.bind_issue(100)
        for _ in range(5):
            self.budget.charge('slot1', 'agy', 'qa')
        self.assertEqual(self.budget.issue_used('agy', 100), 5)
        with self.assertRaises(S.Hold):
            self.budget.charge('slot1', 'agy', 'qa')
        self.assertEqual(self.budget.issue_used('agy', 100), 5)
        self.assertEqual(self.budget.used('agy', 'qa', 'slot1'), 5)

    def test_issue_b_independent(self):
        self.budget.bind_issue(100)
        for _ in range(5):
            self.budget.charge('slot1', 'agy', 'qa')
        self.budget.bind_issue(200)
        self.budget.charge('slot1', 'agy', 'qa')
        self.assertEqual(self.budget.issue_used('agy', 100), 5)
        self.assertEqual(self.budget.issue_used('agy', 200), 1)

    def test_roles_share_issue_cap(self):
        self.budget.bind_issue(100)
        self.budget.charge('slot1', 'agy', 'qa')
        self.budget.charge('slot1', 'agy', 'author')
        self.budget.charge('slot1', 'agy', 'qa')
        self.assertEqual(self.budget.issue_used('agy', 100), 3)
        self.assertEqual(self.budget.used('agy', 'qa'), 2)
        self.assertEqual(self.budget.used('agy', 'author'), 1)
        for _ in range(2):
            self.budget.charge('slot1', 'agy', 'author')
        with self.assertRaises(S.Hold):
            self.budget.charge('slot1', 'agy', 'qa')

    def test_slots_aggregate_same_issue(self):
        self.budget.bind_issue(100)
        for _ in range(3):
            self.budget.charge('slot1', 'agy', 'qa')
        for _ in range(2):
            self.budget.charge('slot2', 'agy', 'author')
        self.assertEqual(self.budget.issue_used('agy', 100), 5)
        with self.assertRaises(S.Hold):
            self.budget.charge('slot2', 'agy', 'qa')

    def test_next_utc_day_new_window_old_dates_persist(self):
        self.budget.bind_issue(100)
        for _ in range(5):
            self.budget.charge('slot1', 'agy', 'qa')
        self.day = '2026-10-28'
        self.assertEqual(self.budget.issue_used('agy', 100), 0)
        self.budget.charge('slot1', 'agy', 'qa')
        self.assertEqual(self.budget.issue_used('agy', 100), 1)
        ledger = json.loads((self.out / 'slot1' / 'ledger.json').read_text())
        self.assertEqual(ledger['2026-10-27']['agy']['qa'], 5)
        self.assertEqual(ledger['2026-10-27']['agy']['issues']['100'], 5)
        self.assertEqual(ledger['2026-10-28']['agy']['issues']['100'], 1)

    def test_unattributed_legacy_aggregate_holds(self):
        self._write_ledger('slot1', {self.day: {'agy': {'qa': 2}}})
        self.budget.bind_issue(29)
        self.assertEqual(self.budget.unattributed('agy'), 2)
        self.assertIs(self.budget.remaining('agy', 'qa', 'slot1'), S.UNKNOWN)
        with self.assertRaises(S.Hold):
            self.budget.charge('slot1', 'agy', 'qa')
        self.assertEqual(self.budget.used('agy', 'qa'), 2)

    def test_seeded_issue29_keeps_two_leaves_three(self):
        self._write_ledger('slot1', {self.day: {'agy': {'qa': 2}}})
        self.budget.seed_issue_attribution('slot1', 'agy', 29, 2)
        self.assertEqual(self.budget.issue_used('agy', 29), 2)
        self.assertEqual(self.budget.unattributed('agy'), 0)
        self.budget.bind_issue(29)
        self.assertEqual(self.budget.remaining('agy', 'qa', 'slot1'), 3)
        for _ in range(3):
            self.budget.charge('slot1', 'agy', 'qa')
        with self.assertRaises(S.Hold):
            self.budget.charge('slot1', 'agy', 'qa')
        self.assertEqual(self.budget.issue_used('agy', 29), 5)
        self.assertEqual(self.budget.used('agy', 'qa'), 5)

    def test_refused_charge_preserves_history(self):
        self.budget.bind_issue(100)
        for _ in range(5):
            self.budget.charge('slot1', 'agy', 'qa')
        before = (self.out / 'slot1' / 'ledger.json').read_bytes()
        with self.assertRaises(S.Hold):
            self.budget.charge('slot1', 'agy', 'qa')
        self.assertEqual((self.out / 'slot1' / 'ledger.json').read_bytes(), before)
        with self.assertRaises(S.Hold):
            self.budget.charge('slot1', 'agy', 'qa', issue=False)
        with self.assertRaises(S.Hold):
            self.budget.charge('slot1', 'agy', 'qa', issue=0)
        with self.assertRaises(S.Hold):
            self.budget.charge('slot1', 'agy', 'qa', issue=-1)
        self.assertEqual((self.out / 'slot1' / 'ledger.json').read_bytes(), before)

    def test_other_providers_unchanged_and_missing_issue_fails_closed(self):
        self.assertEqual(self.budget.remaining('codex', 'qa', 'slot1'), 3)
        self.budget.charge('slot1', 'codex', 'qa')
        self.assertEqual(self.budget.used('codex', 'qa', 'slot1'), 1)
        ledger = json.loads((self.out / 'slot1' / 'ledger.json').read_text())
        self.assertNotIn('issues', ledger[self.day]['codex'])
        unbound = S.Budget(self.limits_path, self.out, self.root / 'lock', today=lambda: self.day)
        self.assertIs(unbound.remaining('agy', 'qa', 'slot1'), S.UNKNOWN)
        with self.assertRaises(S.Hold):
            unbound.charge('slot1', 'agy', 'qa')

    def test_policy_absent_keeps_legacy_agy_without_issue(self):
        self.limits_path.write_text(json.dumps(limits(per_issue=None, agy_qa=4)))
        legacy = S.Budget(self.limits_path, self.out, self.root / 'lock', today=lambda: self.day)
        self.assertIsNone(legacy.per_issue_daily('agy'))
        legacy.charge('slot1', 'agy', 'qa')
        self.assertEqual(legacy.used('agy', 'qa'), 1)
        ledger = json.loads((self.out / 'slot1' / 'ledger.json').read_text())
        self.assertNotIn('issues', ledger[self.day]['agy'])

    def test_od020_no_artificial_cap_unlimited_qa(self):
        """OD-020: absent per_issue_daily + unlimited qa — no artificial 5 ceiling."""
        self.limits_path.write_text(json.dumps(limits(per_issue=None, agy_qa='unlimited')))
        b = S.Budget(self.limits_path, self.out, self.root / 'lock', today=lambda: self.day)
        self.assertIsNone(b.per_issue_daily('agy'))
        self.assertEqual(b.remaining('agy', 'qa', 'slot1'), float('inf'))
        for _ in range(6):
            b.charge('slot1', 'agy', 'qa')
        self.assertEqual(b.used('agy', 'qa', 'slot1'), 6)
        self.assertEqual(b.remaining('agy', 'qa', 'slot1'), float('inf'))

    def test_od020_absent_author_unknown(self):
        self.limits_path.write_text(json.dumps({
            'schema': 1,
            'providers': {'agy': {'qa': 'unlimited'}},
            'slots': {'slot1': {'agy': {'qa': 'unlimited'}}},
        }))
        b = S.Budget(self.limits_path, self.out, self.root / 'lock', today=lambda: self.day)
        self.assertIs(b.remaining('agy', 'author', 'slot1'), S.UNKNOWN)
        with self.assertRaises(S.Hold):
            b.charge('slot1', 'agy', 'author')

    def test_od020_historical_explicit_five_still_enforced(self):
        """Existing tests verify historical 5 when explicit — retain that fact."""
        self.budget.bind_issue(29)
        self.assertEqual(self.budget.per_issue_daily('agy'), 5)
        for _ in range(5):
            self.budget.charge('slot1', 'agy', 'qa')
        with self.assertRaises(S.Hold):
            self.budget.charge('slot1', 'agy', 'qa')
        self.assertEqual(self.budget.issue_used('agy', 29), 5)

    def test_od020_invalid_per_issue_rejected(self):
        for bad in (0, -1, True, 1.5, 'unlimited', None):
            self.limits_path.write_text(json.dumps({
                'schema': 1,
                'providers': {'agy': {'qa': 'unlimited', 'per_issue_daily': bad}},
                'slots': {'slot1': {'agy': {'qa': 'unlimited'}}},
            }))
            b = S.Budget(self.limits_path, self.out, self.root / 'lock', today=lambda: self.day)
            with self.assertRaises(S.Hold):
                b.per_issue_daily('agy')


class Od020ReceiverBudgetGate(unittest.TestCase):
    """Receiver float/inf eligibility (OD-020); no LIVE pin import of core.live()."""

    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1] / 'actions_train'
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        import receiver as R
        cls.R = R

    def test_budget_left_eligible_accepts_float_inf(self):
        R = self.R
        # Default / product QA: positive finite + inf.
        self.assertTrue(R.budget_left_eligible(float('inf')))
        self.assertTrue(R.budget_left_eligible(2))
        self.assertTrue(R.budget_left_eligible(1.5))
        self.assertFalse(R.budget_left_eligible(0))
        self.assertFalse(R.budget_left_eligible(-3))
        self.assertFalse(R.budget_left_eligible(True))
        self.assertFalse(R.budget_left_eligible(None))
        self.assertFalse(R.budget_left_eligible(float('nan')))
        # Successor: positive finite + inf (restored legacy orientation).
        self.assertTrue(R.budget_left_eligible(float('inf'), successor=True))
        self.assertTrue(R.budget_left_eligible(1, successor=True))
        self.assertTrue(R.budget_left_eligible(2, successor=True))
        # Legacy exact_one: finite 1 + OD-020 inf; 2 refused.
        self.assertTrue(R.budget_left_eligible(1, exact_one=True))
        self.assertFalse(R.budget_left_eligible(2, exact_one=True))
        self.assertTrue(R.budget_left_eligible(float('inf'), exact_one=True))


if __name__ == '__main__':
    unittest.main()

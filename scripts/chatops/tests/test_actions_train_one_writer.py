"""Owner DIRECT 2026-10-27: one source writer, provider-independent QA boundaries.

Synthetic fixtures only. No network, package install, runtime claim, or READY assert.
"""
import copy
import json
import os
import stat
import sys
import tempfile
import unittest
from contextlib import ExitStack, contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'actions_train'))
from live import slots as S
import core
import receiver as R


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


def _req(slot='slot1', issue=200, stage_name='claim', phase='idle'):
    return dict(action='train', slot=slot, issue=issue, stage=stage_name, phase=phase,
                head=None if stage_name == 'claim' else 'a' * 40,
                attempt=0 if stage_name == 'claim' else 1, generation=0,
                run=100, run_attempt=1, profile='auto', gh_token='SYNTHETIC_TOKEN_ONLY')


def _pending_journal(record=None, stage_name=None):
    operation = {}
    if record is not None:
        operation['record'] = record
    if stage_name is not None:
        operation['binding'] = {'stage': stage_name}
    return dict(generation=0, operations={'old': operation}, pending='old',
                deferred=[], last=None, stage_counts={})


class _FakeAPI:
    def __init__(self, *_):
        pass

    def identity(self):
        pass

    def __call__(self, path):
        return {'number': int(path.split('/')[1])}

    def pages(self, *_):
        return []


@contextmanager
def _root_fixture(states=None, other_journal=None):
    with tempfile.TemporaryDirectory(prefix='qa-root-') as tmp, ExitStack() as stack:
        folder = Path(tmp)
        states = states or {'slot1': None, 'slot2': None}
        original_read = R.read
        stack.enter_context(patch.object(R, 'STATE', folder))
        stack.enter_context(patch.object(R, 'ROOT_LOCK', -1, create=True))
        stack.enter_context(patch.object(R, 'guard', return_value=SimpleNamespace()))
        stack.enter_context(patch.object(R, 'hosted_identity'))
        stack.enter_context(patch.object(R, 'checkpoint', side_effect=lambda slot:
            ({'active': copy.deepcopy(states[slot]), 'done': []}, [])))
        stack.enter_context(patch.object(R, 'read', side_effect=lambda p, owner=None, limit=2097152:
            original_read(p, None, limit)))
        stack.enter_context(patch.object(R, 'live', return_value=(None, S)))
        stack.enter_context(patch.object(core, 'API', _FakeAPI))
        stack.enter_context(patch.object(S, 'admitted', side_effect=lambda a, issues, *args:
            [(issues[0]['number'], TASK_A if issues[0]['number'] == 200 else TASK_B)]))
        forks = stack.enter_context(patch.object(R.os, 'fork', return_value=999999))
        stack.enter_context(patch.object(R, 'identity', return_value={
            'pid': 999999, 'start': '1', 'boot': 'synthetic'}))
        stack.enter_context(patch.object(R, 'alive', return_value=False))
        if other_journal is not None:
            R.atomic(folder / 'slot2.json', other_journal)
        yield folder, dict(mode='active', owned={'slot1': 1, 'slot2': 1}), forks


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


class RootReceiverOccupancy(unittest.TestCase):
    """Root handle must match planner/lease writer semantics (QA FAIL repair)."""

    def test_missing_pending_evidence_fail_closes_at_root(self):
        bad = _pending_journal()
        snapshot = {'mode': 'active', 'slots': {
            'slot1': _card(),
            'slot2': _card(pending={'status': 'unknown', 'recoverable': False})}}
        self.assertEqual(core.plan(None, S, snapshot, [(200, TASK_A)]), [])
        with _root_fixture(other_journal=bad) as (folder, policy, forks):
            before = (folder / 'slot2.json').read_bytes()
            with self.assertRaisesRegex(core.Refused, 'global source writer sequential'):
                R.handle(_req(), policy)
            self.assertEqual((folder / 'slot2.json').read_bytes(), before)
            forks.assert_not_called()

    def test_dangling_pending_operation_fail_closes(self):
        bad = _pending_journal()
        bad['operations'] = {}
        with _root_fixture(other_journal=bad) as (folder, policy, forks):
            before = (folder / 'slot2.json').read_bytes() if (folder / 'slot2.json').exists() else None
            with self.assertRaisesRegex(core.Refused, 'global source writer sequential'):
                R.handle(_req(), policy)
            if before is not None:
                self.assertEqual((folder / 'slot2.json').read_bytes(), before)
            forks.assert_not_called()

    def test_root_allows_planner_approved_disjoint_qa(self):
        other = _active('pr_wait', 201, TASK_B)
        record = S.task_record(201, TASK_B, writer=False)
        pending = {'status': 'running', 'binding': {'stage': 'qa'}}
        snapshot = {'mode': 'active', 'slots': {
            'slot1': _card(),
            'slot2': _card(other, reservation=record, pending=pending)}}
        planned = core.plan(None, S, snapshot, [(200, TASK_A)])
        self.assertEqual([p['issue'] for p in planned if p['stage'] == 'claim'], [200])
        self.assertFalse(__import__('stage')._writer_lease(S, 'qa', other))
        with _root_fixture({'slot1': None, 'slot2': other},
                           _pending_journal(record, 'qa')) as (_, policy, forks):
            self.assertEqual(R.handle(_req(), policy)['status'], 'running')
            self.assertEqual(forks.call_count, 1)

    def test_diagnosis_nonwriter_allows_disjoint_root_claim(self):
        other = _active('candidate', 201, TASK_B)
        record = S.task_record(201, TASK_B, writer=False)
        with _root_fixture({'slot1': None, 'slot2': other},
                           _pending_journal(record, 'failure_diagnosis')) as (_, policy, forks):
            self.assertEqual(R.handle(_req(), policy)['status'], 'running')
            self.assertEqual(forks.call_count, 1)

    def test_legacy_record_without_writer_bit_still_blocks(self):
        record = S.task_record(201, TASK_B)
        record.pop('writer')
        with _root_fixture(other_journal=_pending_journal(record)) as (_, policy, forks):
            with self.assertRaisesRegex(core.Refused, 'global source writer sequential'):
                R.handle(_req(), policy)
            forks.assert_not_called()

    def test_persisted_writer_without_pending_blocks_disjoint(self):
        states = {'slot1': None, 'slot2': _active('developing', 201, TASK_B)}
        with _root_fixture(states) as (_, policy, forks):
            with self.assertRaisesRegex(core.Refused, 'global source writer sequential'):
                R.handle(_req(), policy)
            forks.assert_not_called()

    def test_forged_pending_stage_cannot_waive_writer_occupancy(self):
        other = _active('pr_wait', 201, TASK_B)
        record = S.task_record(201, TASK_B, writer=False)
        with _root_fixture({'slot1': None, 'slot2': other},
                           _pending_journal(record, 'not_a_real_stage')) as (_, policy, forks):
            with self.assertRaisesRegex(core.Refused, 'global source writer sequential'):
                R.handle(_req(), policy)
            forks.assert_not_called()


class RootAuthorBudgetBinding(unittest.TestCase):
    def test_author_preselection_budget_requires_issue_binding(self):
        import native_antigravity_author as native
        with tempfile.TemporaryDirectory(prefix='.one-writer-budget-') as tmp:
            folder = Path(tmp)
            (folder / 'lock').touch(mode=0o660)
            (folder / 'out' / 'slot2').mkdir(parents=True)
            limits = {'schema': 1, 'providers': {
                'agy': {'author': 'unlimited', 'per_issue_daily': 5}},
                'slots': {'slot2': {'agy': {'author': 'unlimited'}}}}
            path = folder / 'budgets.json'
            path.write_text(json.dumps(limits))
            budget = S.Budget(path, folder / 'out', folder / 'lock', today=lambda: '2026-10-27')
            task = dict(TASK_A, author_routes=['agy:' + native.MODEL],
                        qa_routes=['codex:gpt-6.1-sol:medium'],
                        work_kind='implementation', risk='complex')
            with patch.object(native, 'available', return_value=(True, 'synthetic qualified role')):
                with self.assertRaisesRegex(core.Refused, 'Antigravity author budget UNKNOWN/exhausted'):
                    core.route(S, task, 'author', 'agy', budget, 'slot2')
                budget.bind_issue(200)
                self.assertEqual(core.route(S, task, 'author', 'agy', budget, 'slot2')['provider'], 'agy')

    def test_supervisor_binds_budget_to_active_issue(self):
        import inspect
        src = inspect.getsource(R.supervisor)
        self.assertIn("issue=active['issue']", src)


class ProductQaAdmissionWire(unittest.TestCase):
    """General reusable product QA admission: independent of historical slot pending."""

    HEAD = '8024caa659f4fee911d7e3afcb69ed7ac845ce5c'
    HEAD337 = '98a31a51d2d067af44cc3816be137fe6faa8bb2a'
    BASE = 'a' * 40
    BASE337 = 'acf27157cf39199f302929f7796e4e89d50a3381'

    @classmethod
    def setUpClass(cls):
        os.umask(0o022)

    def _admission(self, **extra):
        """Immutable V1 Issue346 ledger shape."""
        import owner_package_admission as A
        import native_antigravity as N
        value = dict(schema=A.PRODUCT_SCHEMA, issue=346, repo_id=A.REPO_ID,
                     owner_comment=999001, controller_sha='c' * 40,
                     source_base=self.BASE, source_sha=self.HEAD, model=N.MODEL,
                     attempt=1, max_calls=1,
                     work='/srv/gb-slots/slot2/worktrees/issue-346')
        value.update(extra)
        return value

    def _admission_v2(self, issue=337, head=None, base=None, comment=999002, **extra):
        import owner_package_admission as A
        import native_antigravity as N
        head = head or self.HEAD337
        base = base or self.BASE337
        value = dict(schema=A.PRODUCT_SCHEMA_V2, issue=issue, repo_id=A.REPO_ID,
                     owner_comment=comment, controller_sha='c' * 40,
                     source_base=base, source_sha=head, model=N.MODEL,
                     attempt=1, max_calls=1,
                     work=f'/srv/gb-slots/slot2/worktrees/issue-{issue}',
                     acceptance='Venue picker regression: selected venue persists after reload.',
                     allowed_paths=['apps/web/src/components/VenuePicker.tsx'])
        value.update(extra)
        return value

    def test_validate_two_distinct_issues_and_heads(self):
        import owner_package_admission as A
        a346 = A.validate_product_admission(self._admission())
        a337 = A.validate_product_admission(self._admission_v2())
        self.assertEqual(a346['issue'], 346)
        self.assertEqual(a346['source_sha'], self.HEAD)
        self.assertEqual(a337['issue'], 337)
        self.assertEqual(a337['source_sha'], self.HEAD337)
        self.assertNotEqual(a346['source_sha'], a337['source_sha'])

    def test_validate_admission_closed_fields_and_foreign_path(self):
        import owner_package_admission as A
        good = self._admission()
        self.assertEqual(A.validate_product_admission(good)['issue'], 346)
        with self.assertRaises(Exception):
            A.validate_product_admission(dict(good, work='/var/lib/gobadminton-autonomy/slots/slot1/state'))
        with self.assertRaises(Exception):
            A.validate_product_admission(dict(good, source_sha='b' * 40))
        with self.assertRaises(Exception):
            A.validate_product_admission(dict(good, extra='nope'))
        with self.assertRaises(Exception):
            A.validate_product_admission(dict(self._admission_v2(), acceptance='deleted probe only'))

    def test_owner_comment_wrong_issue_url_rejected(self):
        import owner_package_admission as A
        import json
        body_value = dict(self._admission_v2(issue=337), schema=A.PRODUCT_SCHEMA_V2)
        # Strip ledger-only keys if any
        for k in list(body_value):
            if k in A.PRODUCT_LEDGER_EXTRA:
                body_value.pop(k)
        content = json.dumps(body_value, sort_keys=True, separators=(',', ':'))
        body = A.PRODUCT_PREFIX + content
        fake = dict(id=42, issue_url=A.product_issue_url(346),  # wrong Issue URL
                    user=dict(id=A.OWNER_ID, login='anpavel84-afk'),
                    author_association='OWNER', body=body)
        class Resp:
            status = 200
            def read(self, n): return json.dumps(fake).encode()
            def __enter__(self): return self
            def __exit__(self, *a): pass
        with patch.object(A.urllib.request, 'urlopen', return_value=Resp()):
            with self.assertRaisesRegex(Exception, 'wrong Issue URL'):
                A.product_owner_comment(42)

    def test_find_product_admission_ignores_receipt_only(self):
        """Receipt-only STATE must not look like an admission (run40557833601 class)."""
        import owner_package_admission as A
        import importlib
        A = importlib.reload(A)
        with tempfile.TemporaryDirectory(prefix='product-qa-discovery-') as tmp:
            folder = Path(tmp)
            receipt = dict(schema='GB_PRODUCT_QA_ADMISSION_TX_V1', phase='complete',
                           owner_comment=6449940130)
            R.atomic(folder / (A.PRODUCT_RECEIPT_PREFIX + '6449940130.json'), receipt)
            with patch.object(R, 'STATE', folder):
                self.assertIsNone(R.find_product_admission(controller='c' * 40))
            self.assertTrue((folder / (A.PRODUCT_RECEIPT_PREFIX + '6449940130.json')).exists())

    def test_find_product_admission_one_actual_plus_receipt(self):
        """Exactly one numeric ledger + matching receipt is eligible, not ambiguous."""
        import owner_package_admission as A
        import importlib
        A = importlib.reload(A)
        with tempfile.TemporaryDirectory(prefix='product-qa-discovery-') as tmp:
            folder = Path(tmp)
            admission = dict(self._admission(owner_comment=6449940130),
                             body_sha256='e' * 64, owner_id=A.OWNER_ID)
            R.atomic(folder / (A.PRODUCT_LEDGER_PREFIX + '6449940130.json'), admission)
            R.atomic(folder / (A.PRODUCT_RECEIPT_PREFIX + '6449940130.json'),
                     dict(schema='GB_PRODUCT_QA_ADMISSION_TX_V1', phase='complete',
                          owner_comment=6449940130))
            original_read = R.read
            def read_fixture(path, owner):
                self.assertEqual(owner, 0)
                return original_read(path, os.getuid())
            with patch.object(R, 'STATE', folder), patch.object(R, 'read', side_effect=read_fixture):
                found = R.find_product_admission(controller='c' * 40)
            self.assertEqual(found['owner_comment'], 6449940130)
            self.assertEqual(found['schema'], A.PRODUCT_SCHEMA)
            self.assertTrue((folder / (A.PRODUCT_RECEIPT_PREFIX + '6449940130.json')).exists())

    def test_completed_admission_does_not_block_next(self):
        """Consumed ledger + fresh eligible → next; history retained."""
        import owner_package_admission as A
        import importlib
        from core import digest
        A = importlib.reload(A)
        with tempfile.TemporaryDirectory(prefix='product-qa-discovery-') as tmp:
            folder = Path(tmp)
            old = dict(self._admission(owner_comment=1001),
                       body_sha256='e' * 64, owner_id=A.OWNER_ID)
            nxt = dict(self._admission_v2(comment=1002),
                       body_sha256='f' * 64, owner_id=A.OWNER_ID)
            R.atomic(folder / (A.PRODUCT_LEDGER_PREFIX + '1001.json'), old)
            R.atomic(folder / (A.PRODUCT_LEDGER_PREFIX + '1002.json'), nxt)
            ops = dict(schema='GB_PRODUCT_QA_OPS_V1', generation=1, pending=None, last=None,
                       operations={'done': dict(admission_sha256=digest(old),
                                                result={'status': 'confirmed'})})
            original_read = R.read
            def read_fixture(path, owner, limit=2097152):
                return original_read(path, None if owner == 0 else owner, limit)
            with patch.object(R, 'STATE', folder), \
                 patch.object(R, 'read', side_effect=read_fixture), \
                 patch.object(R, 'product_qa_ops', return_value=ops):
                found = R.find_product_admission(controller='c' * 40, ops=ops)
            self.assertEqual(found['owner_comment'], 1002)
            self.assertEqual(found['issue'], 337)
            self.assertTrue((folder / (A.PRODUCT_LEDGER_PREFIX + '1001.json')).exists())

    def test_history_different_controller_not_eligible(self):
        import owner_package_admission as A
        import importlib
        A = importlib.reload(A)
        with tempfile.TemporaryDirectory(prefix='product-qa-discovery-') as tmp:
            folder = Path(tmp)
            old = dict(self._admission(controller_sha='d' * 40, owner_comment=1001),
                       body_sha256='e' * 64, owner_id=A.OWNER_ID)
            R.atomic(folder / (A.PRODUCT_LEDGER_PREFIX + '1001.json'), old)
            original_read = R.read
            with patch.object(R, 'STATE', folder), \
                 patch.object(R, 'read', side_effect=lambda p, o, limit=2097152: original_read(p, None, limit)):
                self.assertIsNone(R.find_product_admission(controller='c' * 40))

    def test_find_product_admission_two_actual_plus_receipts_refused(self):
        """Multiple real eligible numeric ledgers stay fail-closed even if receipts exist."""
        import owner_package_admission as A
        import importlib
        A = importlib.reload(A)
        with tempfile.TemporaryDirectory(prefix='product-qa-discovery-') as tmp:
            folder = Path(tmp)
            for comment in (6449940130, 6449940131):
                admission = dict(self._admission(owner_comment=comment),
                                 body_sha256='e' * 64, owner_id=A.OWNER_ID)
                R.atomic(folder / (A.PRODUCT_LEDGER_PREFIX + f'{comment}.json'), admission)
                R.atomic(folder / (A.PRODUCT_RECEIPT_PREFIX + f'{comment}.json'),
                         dict(schema='GB_PRODUCT_QA_ADMISSION_TX_V1', phase='complete',
                              owner_comment=comment))
            with patch.object(R, 'STATE', folder):
                with self.assertRaisesRegex(Exception, 'ambiguous|conflicting'):
                    R.find_product_admission(controller='c' * 40)

    def test_find_product_admission_invalid_ledger_still_validated(self):
        """Numeric ledger name still goes through product_qa_ledger validation."""
        import owner_package_admission as A
        import importlib
        A = importlib.reload(A)
        with tempfile.TemporaryDirectory(prefix='product-qa-discovery-') as tmp:
            folder = Path(tmp)
            R.atomic(folder / (A.PRODUCT_LEDGER_PREFIX + '999001.json'),
                     dict(schema='not-a-product-admission', owner_comment=999001))
            R.atomic(folder / (A.PRODUCT_RECEIPT_PREFIX + '999001.json'),
                     dict(schema='GB_PRODUCT_QA_ADMISSION_TX_V1', phase='complete'))
            original_read = R.read
            def read_fixture(path, owner):
                self.assertEqual(owner, 0)
                return original_read(path, os.getuid())
            with patch.object(R, 'STATE', folder), patch.object(R, 'read', side_effect=read_fixture):
                with self.assertRaisesRegex(Exception, 'invalid product QA ledger'):
                    R.find_product_admission(controller='c' * 40)

    def test_product_qa_request_fields_fail_closed(self):
        for fields in ({'slot': 'slot1'}, {'head': 'not-a-sha'},
                       {'phase': 'pr_wait'}, {'attempt': 1}, {'profile': 'auto'}):
            with self.subTest(fields=fields):
                req = dict(action='train', stage='product_qa', slot='slot2', issue=337,
                           phase='idle', head=self.HEAD337, attempt=0, generation=0,
                           profile='agy', run=1, run_attempt=1, gh_token='synthetic-read-token')
                with self.assertRaises(core.Refused):
                    core.request(req | fields)

    def test_plan_exposes_product_qa_with_legacy_slot2_pending(self):
        # Product ops generation 0 must not be compared to legacy slot2 generation 119.
        product = dict(slot='slot2', issue=337, stage='product_qa', phase='idle',
                       head=self.HEAD337, attempt=0, generation=0, profile='agy')
        slot2 = _card(pending=dict(status='unknown', recoverable=False,
                                   binding=dict(action='train', stage='qa_qualification',
                                                slot='slot2', issue=29, phase='idle',
                                                head='d' * 40, attempt=0, generation=119,
                                                profile='agy')))
        slot2['generation'] = 119
        slot2['product_qa'] = product
        snap = dict(mode='active', slots={
            'slot1': _card(active=_active('pr_wait', 346)),
            'slot2': slot2},
            product_qa_ops=dict(schema='GB_PRODUCT_QA_OPS_V1', generation=0,
                                operations={}, pending=None, last=None))
        planned = core.plan(None, S, snap, [])
        self.assertEqual([p for p in planned if p.get('stage') == 'product_qa'], [product])

    def test_plan_refuses_product_generation_mismatched_to_ops(self):
        product = dict(slot='slot2', issue=337, stage='product_qa', phase='idle',
                       head=self.HEAD337, attempt=0, generation=0, profile='agy')
        slot2 = _card()
        slot2['generation'] = 119
        slot2['product_qa'] = product
        snap = dict(mode='active', slots={'slot1': _card(), 'slot2': slot2},
                    product_qa_ops=dict(schema='GB_PRODUCT_QA_OPS_V1', generation=3,
                                        operations={}, pending=None, last=None))
        with self.assertRaises(core.Refused):
            core.plan(None, S, snap, [])

    def test_product_request_preserves_legacy_pending_and_no_replay(self):
        import native_antigravity as N
        import owner_package_admission as A
        import importlib
        A = importlib.reload(A)
        with tempfile.TemporaryDirectory(prefix='product-qa-') as tmp:
            folder = Path(tmp)
            legacy = dict(generation=119, operations={'old': {'result': {'status': 'unknown'}}},
                          pending='old', deferred=[], last=None, stage_counts={})
            R.atomic(folder / 'slot2.json', legacy)
            before = (folder / 'slot2.json').read_bytes()
            admission = dict(self._admission(), body_sha256='e' * 64, owner_id=A.OWNER_ID)
            R.atomic(folder / (A.PRODUCT_LEDGER_PREFIX + '999001.json'), admission)
            req = dict(action='train', stage='product_qa', slot='slot2', issue=346,
                       phase='idle', head=self.HEAD, attempt=0, generation=0,
                       profile='agy', run=10, run_attempt=1, gh_token='synthetic-read-token')
            budget = Mock(remaining=lambda *a: 3)
            original_read = R.read
            with patch.object(R, 'STATE', folder), \
                 patch.object(N, 'PRODUCT_OPS', folder / 'product-qa-operations.json'), \
                 patch.object(R, 'ROOT_LOCK', -1, create=True), \
                 patch.object(R, 'guard', return_value=SimpleNamespace(pw_uid=978, pw_gid=968, pw_dir='/tmp', pw_name='gb-slot2')), \
                 patch.object(R, 'hosted_identity'), \
                 patch.object(R, 'live', return_value=(None, SimpleNamespace(Budget=lambda *a, **k: budget))), \
                 patch.object(N, 'product_executor_ready', return_value={'phase': 'canary'}), \
                 patch.object(N, 'product_work_ok', return_value=Path(admission['work'])), \
                 patch.object(N, 'refuse_foreign_checkpoint'), \
                 patch.object(R, 'read', side_effect=lambda p, owner=None, limit=2097152: original_read(p, None, limit)), \
                 patch.object(R.os, 'fork', return_value=4242) as fork, \
                 patch.object(R, 'identity', return_value={'pid': 4242, 'start': '1', 'boot': 'x'}), \
                 patch.object(R, 'alive', return_value=False), \
                 patch.object(R, 'free_lock'):
                first = R.product_qa_request(req, {'mode': 'active', 'controller_sha': 'c' * 40,
                                                   'owned': {'slot1': 1, 'slot2': 1}})
                self.assertEqual(first['status'], 'running')
                fork.assert_called_once()
                self.assertEqual((folder / 'slot2.json').read_bytes(), before)
                again = R.product_qa_request(req | {'run': 11}, {'mode': 'active',
                    'controller_sha': 'c' * 40, 'owned': {'slot1': 1, 'slot2': 1}})
                self.assertEqual(again['status'], 'unknown')
                fork.assert_called_once()
                self.assertEqual((folder / 'slot2.json').read_bytes(), before)

    def test_spent_admission_rejects_new_generation_binding(self):
        """Finished first FAIL + generation advance must not re-fork same admission."""
        import native_antigravity as N
        import owner_package_admission as A
        import importlib
        from core import digest, binding
        A = importlib.reload(A)
        with tempfile.TemporaryDirectory(prefix='product-qa-spent-') as tmp:
            folder = Path(tmp)
            legacy = dict(generation=119, operations={'old': {'result': {'status': 'unknown'}}},
                          pending='old', deferred=[], last=None, stage_counts={})
            R.atomic(folder / 'slot2.json', legacy)
            before = (folder / 'slot2.json').read_bytes()
            admission = dict(self._admission(), body_sha256='e' * 64, owner_id=A.OWNER_ID)
            R.atomic(folder / (A.PRODUCT_LEDGER_PREFIX + '999001.json'), admission)
            first_req = dict(action='train', stage='product_qa', slot='slot2', issue=346,
                             phase='idle', head=self.HEAD, attempt=0, generation=0,
                             profile='agy', run=10, run_attempt=1, gh_token='synthetic-read-token')
            first_key = digest(binding(first_req))
            finished = dict(
                schema='GB_PRODUCT_QA_OPS_V1', generation=1, pending=None, last=dict(
                    stage='product_qa', issue=346, status='confirmed', reason='FAIL'),
                operations={first_key: dict(
                    task_hash='a' * 64, admission_sha256=digest(admission),
                    admission=admission, binding=binding(first_req),
                    run=10, run_attempt=1, started_at=1, process={'pid': 1, 'start': '1', 'boot': 'x'},
                    result={'status': 'confirmed', 'product_ready': False,
                            'qualification_passed': False,
                            'qa': {'verdict': 'FAIL', 'findings': ['x'], 'reviewed_sha': self.HEAD}},
                    finished_at=2)})
            ops_path = folder / 'product-qa-operations.json'
            R.atomic(ops_path, finished)
            journal_bytes = ops_path.read_bytes()
            next_req = dict(first_req, generation=1, run=20)
            budget = Mock(remaining=lambda *a: 3)
            original_read = R.read
            with patch.object(R, 'STATE', folder), \
                 patch.object(N, 'PRODUCT_OPS', ops_path), \
                 patch.object(R, 'ROOT_LOCK', -1, create=True), \
                 patch.object(R, 'guard', return_value=SimpleNamespace(
                     pw_uid=978, pw_gid=968, pw_dir='/tmp', pw_name='gb-slot2')), \
                 patch.object(R, 'hosted_identity'), \
                 patch.object(R, 'live', return_value=(None, SimpleNamespace(
                     Budget=lambda *a, **k: budget))), \
                 patch.object(N, 'product_executor_ready', return_value={'phase': 'canary'}), \
                 patch.object(N, 'product_work_ok', return_value=Path(admission['work'])), \
                 patch.object(N, 'refuse_foreign_checkpoint'), \
                 patch.object(R, 'read', side_effect=lambda p, owner=None, limit=2097152:
                              original_read(p, None, limit)), \
                 patch.object(R.os, 'fork', return_value=4242) as fork, \
                 patch.object(R, 'identity', return_value={'pid': 4242, 'start': '1', 'boot': 'x'}), \
                 patch.object(R, 'alive', return_value=False), \
                 patch.object(R, 'free_lock'):
                again = R.product_qa_request(next_req, {'mode': 'active',
                    'controller_sha': 'c' * 40, 'owned': {'slot1': 1, 'slot2': 1}})
                self.assertEqual(again['status'], 'confirmed')
                self.assertEqual(again['key'], first_key)
                self.assertIn('already consumed', again.get('reason', ''))
                fork.assert_not_called()
                self.assertEqual(ops_path.read_bytes(), journal_bytes)
                self.assertEqual((folder / 'slot2.json').read_bytes(), before)

    def test_stale_head_attempt_binding_rejected(self):
        """Request head/issue must match reserved admission exactly."""
        import native_antigravity as N
        import owner_package_admission as A
        import importlib
        A = importlib.reload(A)
        with tempfile.TemporaryDirectory(prefix='product-qa-stale-') as tmp:
            folder = Path(tmp)
            admission = dict(self._admission_v2(), body_sha256='e' * 64, owner_id=A.OWNER_ID)
            R.atomic(folder / (A.PRODUCT_LEDGER_PREFIX + '999002.json'), admission)
            req = dict(action='train', stage='product_qa', slot='slot2', issue=337,
                       phase='idle', head='0' * 40, attempt=0, generation=0,
                       profile='agy', run=10, run_attempt=1, gh_token='synthetic-read-token')
            budget = Mock(remaining=lambda *a: 3)
            original_read = R.read
            with patch.object(R, 'STATE', folder), \
                 patch.object(N, 'PRODUCT_OPS', folder / 'product-qa-operations.json'), \
                 patch.object(R, 'ROOT_LOCK', -1, create=True), \
                 patch.object(R, 'guard', return_value=SimpleNamespace(
                     pw_uid=978, pw_gid=968, pw_dir='/tmp', pw_name='gb-slot2')), \
                 patch.object(R, 'live', return_value=(None, SimpleNamespace(
                     Budget=lambda *a, **k: budget))), \
                 patch.object(N, 'product_executor_ready', return_value={'phase': 'canary'}), \
                 patch.object(R, 'read', side_effect=lambda p, owner=None, limit=2097152:
                              original_read(p, None, limit)), \
                 patch.object(R.os, 'fork') as fork, \
                 patch.object(R, 'free_lock'):
                with self.assertRaisesRegex(Exception, 'issue/source mismatch'):
                    R.product_qa_request(req, {'mode': 'active', 'controller_sha': 'c' * 40,
                                               'owned': {'slot1': 1, 'slot2': 1}})
                fork.assert_not_called()

    def test_product_stage_setup_skips_author_store(self):
        import stage as St
        import inspect
        src = inspect.getsource(St.setup_product_qa)
        self.assertNotIn('a.Store(', src)
        self.assertIn('978', src)
        entry = inspect.getsource(St.entry)
        self.assertIn('setup_product_qa', entry)


class ProductGitIdentity(unittest.TestCase):
    """Root product Git preflight must drop to UID978; UID978 keeps ordinary git."""

    HEAD = '8024caa659f4fee911d7e3afcb69ed7ac845ce5c'

    def _work(self):
        root = Path(tempfile.mkdtemp(prefix='product-git-root-'))
        self.addCleanup(lambda: __import__('shutil').rmtree(root, ignore_errors=True))
        work = root / 'issue-346'
        work.mkdir()
        return root, work

    def test_root_product_work_ok_passes_executor_identity_to_subprocess(self):
        import native_antigravity as N
        base, work = self._work()
        calls = []

        def fake_run(argv, **kw):
            calls.append((argv, kw))
            self.assertEqual(argv[0], '/usr/bin/git')
            self.assertIn('core.hooksPath=/dev/null', argv)
            self.assertIn('core.fsmonitor=false', argv)
            self.assertEqual(kw.get('user'), 978)
            self.assertEqual(kw.get('group'), 968)
            self.assertEqual(kw.get('extra_groups'), [65042])
            self.assertTrue(callable(kw.get('preexec_fn')))
            env = kw['env']
            self.assertEqual(env['HOME'], '/nonexistent')
            self.assertEqual(env['GIT_CONFIG_NOSYSTEM'], '1')
            self.assertEqual(env['GIT_CONFIG_GLOBAL'], '/dev/null')
            self.assertNotIn('safe.directory', ' '.join(argv))
            return SimpleNamespace(returncode=0, stdout=(self.HEAD + '\n').encode())

        with patch.object(N.os, 'geteuid', return_value=0), \
             patch.object(N, 'PRODUCT_WORK_ROOTS', (base,)), \
             patch.object(N, 'product_git_identity', return_value=dict(
                 user=978, group=968, extra_groups=[65042])), \
             patch.object(N.subprocess, 'run', side_effect=fake_run), \
             patch.object(N, 'refuse_foreign_checkpoint'):
            self.assertEqual(N.product_work_ok(work, self.HEAD), work)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0][-2:], ['rev-parse', 'HEAD'])

    def test_uid978_product_work_ok_uses_ordinary_git_without_identity(self):
        import native_antigravity as N
        base, work = self._work()
        calls = []

        def fake_run(argv, **kw):
            calls.append((argv, kw))
            self.assertEqual(argv[0], 'git')
            self.assertNotIn('user', kw)
            self.assertNotIn('preexec_fn', kw)
            return SimpleNamespace(returncode=0, stdout=(self.HEAD + '\n').encode())

        with patch.object(N.os, 'geteuid', return_value=978), \
             patch.object(N, 'PRODUCT_WORK_ROOTS', (base,)), \
             patch.object(N.subprocess, 'run', side_effect=fake_run), \
             patch.object(N, 'refuse_foreign_checkpoint'):
            self.assertEqual(N.product_work_ok(work, self.HEAD), work)
        self.assertEqual(len(calls), 1)

    def test_foreign_uid_product_work_ok_refused(self):
        import native_antigravity as N
        base, work = self._work()
        with patch.object(N.os, 'geteuid', return_value=1002), \
             patch.object(N, 'PRODUCT_WORK_ROOTS', (base,)), \
             patch.object(N, 'refuse_foreign_checkpoint'), \
             patch.object(N.subprocess, 'run') as run:
            with self.assertRaises(Exception):
                N.product_work_ok(work, self.HEAD)
            run.assert_not_called()

    def test_product_git_identity_args_without_privilege(self):
        """Static identity helper returns UID978/GID968/groups65042; no real setuid."""
        import native_antigravity as N
        import pwd
        base, work = self._work()
        # Ownership checks use lstat; mark work as uid978 and parents as root.
        real_lstat = Path.lstat

        def fake_lstat(path):
            info = real_lstat(path)
            uid = 978 if Path(path) == work else 0
            return SimpleNamespace(st_uid=uid, st_mode=info.st_mode | stat.S_IFDIR,
                                   st_gid=info.st_gid)

        with patch.object(N.os, 'geteuid', return_value=0), \
             patch.object(N, 'PRODUCT_WORK_ROOTS', (base,)), \
             patch.object(Path, 'lstat', fake_lstat), \
             patch.object(pwd, 'getpwuid', return_value=SimpleNamespace(
                 pw_uid=978, pw_gid=968, pw_name='gb-slot2')), \
             patch.object(N, 'refuse_foreign_checkpoint'):
            identity = N.product_git_identity(work)
        self.assertEqual(identity, dict(user=978, group=968, extra_groups=[65042]))


if __name__ == '__main__':
    unittest.main()

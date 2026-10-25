"""Synthetic offline admission tests; never access installed state or providers."""
import contextlib
import copy
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'actions_train'))
import admission_pm as P
import context_policy as C
from core import Refused, digest

A, Q, N, R = P.A, P.Q, P.N, P.R
CONTROLLER = 'd' * 40
COMMENT = 6390011223
NOW = dt.datetime(2026, 10, 25, tzinfo=dt.timezone.utc)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


class AdmissionPM(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        # tempfile respects TMPDIR in CI; no real protected directories are used.
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.state = self.root / 'state'
        self.state.mkdir()
        self.work = self.root / 'source'
        self.work.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.email', 'synthetic@example.invalid')
        self.git('config', 'user.name', 'Synthetic fixture')
        self.fixture = self.work / Q.ANALYSIS_INPUT
        self.fixture.parent.mkdir(parents=True)
        self.fixture.write_bytes((Path(__file__).parent / 'fixtures' / Path(Q.ANALYSIS_INPUT).name).read_bytes())
        self.git('add', '.')
        self.git('commit', '-qm', 'synthetic base before adapter fix')
        self.base = self.git('rev-parse', 'HEAD').strip()
        (self.work / 'adapter.txt').write_text('synthetic adapter fix PR304, not a runtime receipt')
        self.git('add', '.')
        self.git('commit', '-qm', 'synthetic reviewed adapter candidate')
        self.head = self.git('rev-parse', 'HEAD').strip()
        self.qa_path = 'scripts/chatops/tests/fixtures/agy-synthetic-full-qa.json'
        qa = dict(schema='GB_AGY_29_QA_TEST_CONTRACT_V1', source_sha=self.head,
                  requirements='Independent analysis/QA after adapter fix; retain all native source/QA gates.',
                  checks=[dict(command='synthetic adapter regression suite', exit_code=0,
                               output_sha256='e' * 64, source_sha=self.head)])
        (self.work / self.qa_path).write_text(canonical(qa))
        self.qa_sha = hashlib.sha256((self.work / self.qa_path).read_bytes()).hexdigest()
        self.git('add', '.')
        self.git('commit', '-qm', 'synthetic full QA input at its immutable revision')
        self.qa_revision = self.git('rev-parse', 'HEAD').strip()
        self.git('checkout', '-q', self.head)
        self.request = dict(source_base=self.base, source_head=self.head, input_revision=self.head,
                            input_path=Q.ANALYSIS_INPUT, input_sha256=Q.ANALYSIS_INPUT_SHA256)
        self.qa_request = dict(source_base=self.base, source_head=self.head, input_revision=self.qa_revision,
                               input_path=self.qa_path, input_sha256=self.qa_sha)
        self.delegation = dict(schema=P.SCHEMA, issue=29, repo_id=A.REPO_ID, delegation_comment=COMMENT,
                               scope='DEV_OPS_ONLY', roles=list(P.ROLES), model=N.MODEL,
                               max_calls_per_package=5, max_total_calls=5, max_packages=5,
                               controller_sha=CONTROLLER, rules_sha256=A.RULES, expires_at='2099-01-01T00:00:00Z',
                               allowed_input_paths=[dict(revision=self.head, path=Q.ANALYSIS_INPUT,
                                                        sha256=Q.ANALYSIS_INPUT_SHA256),
                                                    dict(revision=self.qa_revision, path=self.qa_path, sha256=self.qa_sha)])
        self.comment = dict(id=COMMENT, issue_url=A.ISSUE_URL, user=dict(id=A.OWNER_ID, login='anpavel84-afk'),
                            author_association='OWNER', created_at='2026-10-24T00:00:00Z',
                            updated_at='2026-10-24T00:00:00Z')
        self.sync_comment()
        self.policy = self.root / 'policy.json'
        self.marker = self.root / 'marker.json'
        self.budget = self.root / 'budget.json'
        self.real_fetch = P.fetch_delegation
        real_read = R.read
        self.stack.enter_context(patch.object(R, 'read', side_effect=lambda path, owner=None, limit=2097152:
                                             real_read(path, None, limit)))
        self.atomic = R.atomic
        self.atomic(self.policy, dict(mode='active', controller_sha=CONTROLLER))
        self.atomic(self.marker, dict(phase='canary', executor_uid=978))
        self.atomic(self.state / 'slot2.json', dict(generation=96, pending=None, operations={}))
        (self.state / 'controller.lock').touch()
        self.budget.write_text('synthetic budget pin')
        for name, value in (('STATE', self.state), ('POLICY', self.policy), ('BUDGET', self.budget)):
            self.stack.enter_context(patch.object(R, name, value))
        self.stack.enter_context(patch.object(N, 'MARKER', self.marker))
        self.stack.enter_context(patch.object(N, 'QUALIFICATION_WORK', self.work))
        # Replace only host metadata/UID checks; Git materialization, hash and
        # input-contract checks, transaction writes and native descriptor run for real.
        self.stack.enter_context(patch.object(N, 'addressed_git_identity', return_value={}))
        self.stack.enter_context(patch.object(N, 'trusted', side_effect=lambda p: Path(p).read_bytes()))
        self.stack.enter_context(patch.object(R, 'trusted_tree'))
        self.stack.enter_context(patch.object(P.os, 'geteuid', return_value=0))
        self.stack.enter_context(patch.object(A, 'quiescent', side_effect=lambda _: R.read(self.state / 'slot2.json', 0)))
        self.stack.enter_context(patch.object(P, 'fetch_delegation', side_effect=lambda _: copy.deepcopy(self.comment)))
        for name, pin in ((Q.ADDRESSED_LEDGER, 'HIST'), (Q.SUPPLEMENT_LEDGER, 'SUP')):
            path = self.state / name
            path.write_text('synthetic immutable ' + name)
            self.stack.enter_context(patch.object(A, pin, A.sha(path)))
            self.stack.enter_context(patch.object(Q, 'OWNER_PACKAGE_OLD_ADDRESS_SHA' if pin == 'HIST'
                                                  else 'OWNER_PACKAGE_OLD_SUPPLEMENT_SHA', A.sha(path)))
        self.stack.enter_context(patch.object(A, 'BUDGET', A.sha(self.budget)))
        # Deny actual network and any model launch, including on error paths.
        self.net = self.stack.enter_context(patch.object(socket, 'socket', side_effect=AssertionError('network forbidden')))
        real_run = subprocess.run
        def git_only(argv, *args, **kwargs):
            self.assertEqual(Path(argv[0]).name, 'git', argv)
            return real_run(argv, *args, **kwargs)
        self.stack.enter_context(patch.object(subprocess, 'run', side_effect=git_only))
        self.model = self.stack.enter_context(patch.object(N, 'invoke', side_effect=AssertionError('model forbidden')))

    def git(self, *args):
        return subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-C', str(self.work), *args],
                              check=True, capture_output=True, text=True).stdout

    def sync_comment(self):
        self.comment['body'] = P.PREFIX + canonical(self.delegation)

    def run_pm(self, mode='--apply', role=None, request=None):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            P.main([mode, '--issue', '29', '--role', role or P.ROLES[0],
                    '--delegation-comment-id', str(COMMENT), '--request-json', canonical(request or self.request)])
        lines = out.getvalue().splitlines()
        self.assertEqual(len(lines), 1)
        value = json.loads(lines[0])
        self.assertEqual(value['model_calls'], 0)
        self.net.assert_not_called()
        self.model.assert_not_called()
        return value

    def reservation(self, grant, operation, result):
        q = A.exact_qualification(grant, CONTROLLER)
        self.atomic(Q.reservation_path(self.state, q), dict(schema='GB_ANTIGRAVITY_QA_29_RESERVATION_V1',
            operation=operation, task_hash=q['task_sha256'], descriptor=q, result=result, finished_at=1))

    def consume_analysis(self, admission):
        path = Path(admission['package_path'])
        package = R.read(path, 0)
        row = next(iter(package['grants'].values()))
        operation = 'a' * 64
        row['operation'] = operation
        package['used_calls'] += 1
        self.atomic(path, package)
        slot = R.read(self.state / 'slot2.json', 0)
        slot['operations'][operation] = dict(finished_at=1,
            task_hash=A.exact_qualification(row['grant'], CONTROLLER)['task_sha256'],
            result=dict(status='confirmed', analysis_complete=True,
                        analysis=dict(completion='COMPLETE', source_reads=[dict(path='a'), dict(path='b')]),
                        native_receipt=dict(tool_names=['view_file', 'run_command'])))
        self.atomic(self.state / 'slot2.json', slot)
        self.reservation(row['grant'], operation, slot['operations'][operation]['result'])
        return package

    def test_standard_continuation_granted_and_full_qa_fixture(self):
        first = self.run_pm()
        self.assertEqual(first['status'], 'GRANTED', first)
        self.assertEqual(first['remaining_budget']['used_calls'], 0)
        previous = self.consume_analysis(first)
        old_bytes = Path(first['package_path']).read_bytes()
        qa = self.run_pm(role=P.ROLES[1], request=self.qa_request)
        self.assertEqual(qa['status'], 'GRANTED', qa)
        package = R.read(Path(qa['package_path']), 0)
        self.assertEqual(package['used_calls'], 1)
        self.assertEqual(package['delegation']['inherited_calls'], 1)
        self.assertEqual(qa['remaining_budget']['package_calls'], 4)
        self.assertEqual(Path(first['package_path']).read_bytes(), old_bytes)
        self.assertEqual(len(package['delegation']['prior_packages']), 1)
        self.assertEqual(N.qualification_descriptor(R.read(self.marker, 0))['qualification_grant']['role'], P.ROLES[1])
        self.assertEqual(Q.owner_package_ledger(package), package)

    def test_same_request_idempotent_even_after_spending(self):
        first = self.run_pm()
        self.consume_analysis(first)
        files = {p.name: p.read_bytes() for p in self.state.iterdir()}
        again = self.run_pm()
        self.assertEqual(again['status'], 'ALREADY_GRANTED', again)
        self.assertEqual(first['admission_id'], again['admission_id'])
        self.assertEqual(files, {p.name: p.read_bytes() for p in self.state.iterdir()})
        self.assertEqual(self.run_pm('--status')['status'], 'ALREADY_GRANTED')

    def test_dry_run_no_writes_and_apply_same_digest(self):
        before = {p.name: p.read_bytes() for p in self.state.iterdir()}
        dry = self.run_pm('--dry-run')
        self.assertEqual(dry['status'], 'GRANTED', dry)
        self.assertTrue(dry['dry_run'])
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.state.iterdir()})
        applied = self.run_pm()
        self.assertEqual(applied['admission_id'], dry['admission_id'])

    def test_exhausted_lineage_budget_not_reset(self):
        first = self.run_pm()
        self.consume_analysis(first)
        for field in ('max_calls_per_package', 'max_total_calls', 'max_packages'):
            with self.subTest(field=field):
                old = self.delegation[field]
                self.delegation[field] = 1
                self.sync_comment()
                value = self.run_pm(role=P.ROLES[1], request=self.qa_request)
                self.assertEqual(value['status'], 'NEEDS_OWNER', value)
                self.assertIn('budget exhausted', value['reason'])
                self.delegation[field] = old
                self.sync_comment()

    def test_unresolved_unknown_and_unfinished_operation_block(self):
        for result, finished in ((dict(status='unknown', safe_release=False), 1),
                                 (dict(status='running'), None),
                                 (dict(status='confirmed', safety_refusal=True), 1)):
            with self.subTest(result=result):
                self.atomic(self.state / 'slot2.json', dict(generation=96, pending=None,
                    operations={'f'*64: dict(result=result, finished_at=finished)}))
                value = self.run_pm()
                self.assertEqual(value['status'], 'BLOCKED', value)
                self.assertTrue(value['needs_review'])
                self.assertFalse(list(self.state.glob(P.RECEIPT_PREFIX + '*.json')))

    def test_quiescent_refusal_no_writes(self):
        with patch.object(A, 'quiescent', side_effect=Refused('slot occupied')):
            self.assertEqual(self.run_pm()['reason'], 'slot occupied')

    def test_wrong_source_head_or_base_block(self):
        for field in ('source_head', 'source_base'):
            request = dict(self.request, **{field: 'f' * 40})
            if field == 'source_head':
                request['input_revision'] = request[field]
                self.delegation['allowed_input_paths'].append(dict(revision=request[field], path=Q.ANALYSIS_INPUT,
                                                                 sha256=Q.ANALYSIS_INPUT_SHA256))
                self.sync_comment()
            value = self.run_pm(request=request)
            self.assertEqual(value['status'], 'BLOCKED', value)

    def test_input_hash_mismatch_and_full_qa_contract_checked(self):
        first = self.run_pm()
        self.consume_analysis(first)
        request = dict(self.qa_request, input_sha256='0' * 64)
        self.delegation['allowed_input_paths'][1]['sha256'] = '0' * 64
        self.sync_comment()
        value = self.run_pm(role=P.ROLES[1], request=request)
        self.assertEqual(value['status'], 'BLOCKED', value)
        self.assertIn('hash mismatch', value['reason'])

    def test_missing_analysis_or_missing_native_evidence_blocks_qa(self):
        missing = self.run_pm(role=P.ROLES[1], request=self.qa_request)
        self.assertEqual(missing['status'], 'BLOCKED', missing)
        first = self.run_pm()
        self.consume_analysis(first)
        slot = R.read(self.state / 'slot2.json', 0)
        slot['operations']['a'*64]['result']['native_receipt']['tool_names'] = ['view_file']
        self.atomic(self.state / 'slot2.json', slot)
        value = self.run_pm(role=P.ROLES[1], request=self.qa_request)
        self.assertEqual(value['status'], 'BLOCKED', value)
        self.assertIn('real native analysis', value['reason'])

    def test_role_scope_expiry_and_wrong_controller_need_owner(self):
        for change in ({'roles': [P.ROLES[1]]}, {'scope': 'PROD'},
                       {'expires_at': '2026-10-24T01:00:00Z'}, {'controller_sha': 'e'*40},
                       {'model': 'another-model'}):
            with self.subTest(change=change):
                original = copy.deepcopy(self.delegation)
                self.delegation.update(change)
                self.sync_comment()
                value = self.run_pm()
                self.assertEqual(value['status'], 'NEEDS_OWNER', value)
                self.delegation = original
                self.sync_comment()

    def test_installed_active_pin_is_accepted_only_for_active_new_admission(self):
        self.delegation['controller_sha'] = 'INSTALLED_ACTIVE'
        self.sync_comment()
        self.atomic(self.policy, dict(mode='disabled', controller_sha=CONTROLLER))
        self.assertEqual(self.run_pm()['status'], 'NEEDS_OWNER')
        self.atomic(self.policy, dict(mode='active', controller_sha=CONTROLLER))
        self.assertEqual(self.run_pm()['status'], 'GRANTED')

    def test_edited_wrong_user_association_issue_and_noncanonical_refused(self):
        original = copy.deepcopy(self.comment)
        mutations = [dict(updated_at='2026-10-24T01:00:00Z'),
                     dict(user=dict(id=1, login='anpavel84-afk')),
                     dict(user=dict(id=A.OWNER_ID, login='impostor')),
                     dict(author_association='NONE'), dict(issue_url=A.ISSUE_URL+'0'),
                     dict(body=P.PREFIX + json.dumps(self.delegation)),
                     dict(body=self.comment['body']+'\n'), dict(id=COMMENT+1)]
        for mutation in mutations:
            with self.subTest(mutation=list(mutation)):
                self.comment = dict(original, **mutation)
                self.assertEqual(self.run_pm()['status'], 'BLOCKED')
        self.comment = original

    def test_extra_fields_money_prod_ceiling_and_unbounded_budget_refused(self):
        for change in ({'money': 0}, {'prod': False}, {'product_authority': 'same'},
                       {'max_calls_per_package': 6}, {'max_calls_per_package': True},
                       {'max_total_calls': 0}, {'max_total_calls': 'unlimited'},
                       {'max_packages': 0}, {'unknown': None}):
            with self.subTest(change=change):
                original = copy.deepcopy(self.delegation)
                self.delegation.update(change)
                self.sync_comment()
                self.assertEqual(self.run_pm()['status'], 'BLOCKED')
                self.delegation = original
                self.sync_comment()

    def test_widened_paths_and_analysis_inputs_refused(self):
        self.delegation['allowed_input_paths'][0]['path'] = 'apps/web/arbitrary.json'
        self.sync_comment()
        self.assertEqual(self.run_pm()['status'], 'BLOCKED')
        self.delegation['allowed_input_paths'][0]['path'] = Q.ANALYSIS_INPUT
        self.delegation['allowed_input_paths'][0]['sha256'] = 'f'*64
        self.sync_comment()
        self.assertEqual(self.run_pm(request=dict(self.request, input_sha256='f'*64))['status'], 'NEEDS_OWNER')

    def test_outside_allowlist_and_extra_request_fields_refused(self):
        self.assertEqual(self.run_pm(request=dict(self.request, input_sha256='f'*64))['status'], 'NEEDS_OWNER')
        self.assertEqual(self.run_pm(request=dict(self.request, scope='PROD'))['status'], 'BLOCKED')

    def test_duplicate_json_keys_and_oversized_comment_refused(self):
        self.comment['body'] = self.comment['body'].replace('"issue":29', '"issue":29,"issue":29')
        self.assertEqual(self.run_pm()['status'], 'BLOCKED')
        self.sync_comment()
        self.comment['padding'] = 'x'*32769
        self.assertEqual(self.run_pm()['status'], 'BLOCKED')

    def test_prior_intent_or_orphan_package_blocks(self):
        self.atomic(self.state / (A.RECEIPT_PREFIX + '123.json'), dict(phase='intent'))
        self.assertEqual(self.run_pm()['status'], 'BLOCKED')
        (self.state / (A.RECEIPT_PREFIX + '123.json')).unlink()
        self.atomic(P.package_path(P.identity(29, P.ROLES[0], COMMENT, self.request)), dict(schema='fake'))
        self.assertEqual(self.run_pm()['status'], 'BLOCKED')

    def test_crash_after_every_durable_write_is_idempotent(self):
        original = {p.name: p.read_bytes() for p in self.state.iterdir()}
        policy_raw, marker_raw = self.policy.read_bytes(), self.marker.read_bytes()
        for crash_at in range(1, 8):
            with self.subTest(crash_after_write=crash_at):
                for p in self.state.iterdir():
                    if p.name not in original:
                        p.unlink()
                for name, raw in original.items():
                    (self.state / name).write_bytes(raw)
                self.policy.write_bytes(policy_raw)
                self.marker.write_bytes(marker_raw)
                writes = [0]
                def interrupted(path, value, mode=0o600):
                    self.atomic(path, value, mode)
                    writes[0] += 1
                    if writes[0] == crash_at:
                        raise RuntimeError('synthetic crash')
                with patch.object(R, 'atomic', side_effect=interrupted):
                    with self.assertRaises(RuntimeError):
                        self.run_pm()
                recovered = self.run_pm()
                self.assertEqual(recovered['status'], 'ALREADY_GRANTED', recovered)
                self.assertEqual(R.read(self.policy, 0)['mode'], 'active')
                self.assertEqual(R.read(self.state / 'slot2.json', 0)['generation'], 97)
                self.assertEqual(R.read(Path(recovered['receipt_path']), 0)['phase'], 'complete')
                self.assertEqual(len(list(self.state.glob(Q.OWNER_PACKAGE_LEDGER_PREFIX+'delegated-*.json'))), 1)
                self.assertEqual(R.read(Path(recovered['package_path']), 0)['used_calls'], 0)

    def test_qa_intent_recovery_never_recounts_prior_analysis(self):
        first = self.run_pm()
        self.consume_analysis(first)
        original = {p.name: p.read_bytes() for p in self.state.iterdir()}
        policy_raw, marker_raw = self.policy.read_bytes(), self.marker.read_bytes()
        for crash_at in range(1, 8):
            with self.subTest(crash_after_write=crash_at):
                for p in self.state.iterdir():
                    if p.name not in original:
                        p.unlink()
                for name, raw in original.items():
                    (self.state/name).write_bytes(raw)
                self.policy.write_bytes(policy_raw)
                self.marker.write_bytes(marker_raw)
                writes = [0]
                def interrupted(path, value, mode=0o600):
                    self.atomic(path, value, mode)
                    writes[0] += 1
                    if writes[0] == crash_at:
                        raise RuntimeError('synthetic QA admission crash')
                with patch.object(R, 'atomic', side_effect=interrupted):
                    with self.assertRaises(RuntimeError):
                        self.run_pm(role=P.ROLES[1], request=self.qa_request)
                recovered = self.run_pm(role=P.ROLES[1], request=self.qa_request)
                self.assertEqual(recovered['status'], 'ALREADY_GRANTED', recovered)
                self.assertEqual(R.read(Path(recovered['package_path']), 0)['used_calls'], 1)
                self.assertEqual(R.read(self.state/'slot2.json', 0)['generation'], 98)
                self.assertEqual(Path(first['package_path']).read_bytes(), original[Path(first['package_path']).name])

    def test_foreign_change_during_intent_blocks_recovery(self):
        def crash(path, value, mode=0o600):
            self.atomic(path, value, mode)
            raise RuntimeError('synthetic crash')
        with patch.object(R, 'atomic', side_effect=crash):
            with self.assertRaises(RuntimeError):
                self.run_pm()
        self.atomic(self.marker, dict(phase='foreign'))
        self.assertEqual(self.run_pm()['status'], 'BLOCKED')

    def test_provenance_tampering_is_rejected_by_existing_ledger_verifier(self):
        first = self.run_pm()
        package = R.read(Path(first['package_path']), 0)
        for field, bad in (('inherited_calls', 1), ('admission_id', '0'*64), ('role', P.ROLES[1])):
            with self.subTest(field=field):
                changed = copy.deepcopy(package)
                changed['delegation'][field] = bad
                with self.assertRaises(Refused):
                    Q.owner_package_ledger(changed)
        changed = copy.deepcopy(package)
        changed['delegation']['extra'] = True
        with self.assertRaises(Refused):
            Q.owner_package_ledger(changed)

    def test_previous_personal_owner_package_calls_are_inherited(self):
        # Synthetic pre-delegation enrollment, using the unchanged two-role schema.
        grants = []
        for role in P.ROLES:
            revision, path, checksum = A.EXPECTED_PINS[role]
            grants.append(dict(schema=Q.ADDRESSED_SCHEMA, lineage=Q.ADDRESSED_LINEAGE,
                owner_comment=COMMENT-1, role=role, controller_revision=CONTROLLER,
                cli_sha256=N.AGY_SHA256, rules_sha256=A.RULES,
                base='c'*40, head=self.base,
                input_revision=self.base if role == P.ROLES[0] else revision,
                input_path=path, input_sha256=checksum, timeout=1800, max_output_bytes=N.MAX_OUT,
                permission_mode=N.PERMISSION_MODE, input_transport='stream-json', ceiling=1))
        package = dict(schema=Q.OWNER_PACKAGE_SCHEMA, owner_comment=COMMENT-1, owner_id=A.OWNER_ID,
            issue=29, controller_sha=CONTROLLER, rules_sha256=A.RULES, source_base='c'*40,
            source_head=self.base, body_sha256='f'*64, ceiling=2, used_calls=0,
            grants={digest(g): dict(grant=g, operation=None) for g in grants},
            previous_addressed_sha256=A.HIST, previous_supplement_sha256=A.SUP)
        Q.owner_package_ledger(package)
        path = Q.owner_package_path(R, grants[0])
        receipt = self.state / (A.RECEIPT_PREFIX + str(COMMENT-1)+'.json')
        self.atomic(receipt, dict(schema='GB_AGY_29_OWNER_PACKAGE_TRANSACTION_V2', phase='complete',
            body_sha256=package['body_sha256'], controller_sha=CONTROLLER, owner_comment=COMMENT-1,
            package_sha256=hashlib.sha256(A.encoded(package)).hexdigest()))
        package['grants'][digest(grants[0])]['operation'] = 'b'*64
        package['used_calls'] = 1
        self.atomic(path, package)
        slot = R.read(self.state/'slot2.json', 0)
        slot['operations']['b'*64] = dict(finished_at=1,
            task_hash=A.exact_qualification(grants[0], CONTROLLER)['task_sha256'],
            result=dict(status='confirmed', analysis_complete=False))
        self.atomic(self.state/'slot2.json', slot)
        self.reservation(grants[0], 'b'*64, slot['operations']['b'*64]['result'])
        prior_bytes = path.read_bytes()
        admitted = self.run_pm()
        self.assertEqual(admitted['status'], 'GRANTED', admitted)
        self.assertEqual(R.read(Path(admitted['package_path']), 0)['used_calls'], 1)
        self.consume_analysis(admitted)
        qa = self.run_pm(role=P.ROLES[1], request=self.qa_request)
        self.assertEqual(qa['status'], 'GRANTED', qa)
        value = R.read(Path(qa['package_path']), 0)
        self.assertEqual(value['used_calls'], 2)  # not 3: inherited counters are not re-summed
        self.assertEqual(len(value['delegation']['prior_packages']), 2)
        self.assertEqual(path.read_bytes(), prior_bytes)

    def test_new_comment_cannot_reissue_unchanged_input(self):
        first = self.run_pm()
        self.assertEqual(first['status'], 'GRANTED', first)
        comment_id = COMMENT+1
        self.comment['id'] = comment_id
        self.delegation['delegation_comment'] = comment_id
        self.sync_comment()
        with self.assertRaisesRegex(Refused, 'unchanged candidate/role/input'):
            P.run('--apply', 29, P.ROLES[0], comment_id, self.request)
        self.assertEqual(len(list(self.state.glob(P.RECEIPT_PREFIX+'*.json'))), 1)

    def test_missing_or_orphan_model_reservation_receipts_block(self):
        first = self.run_pm()
        package = self.consume_analysis(first)
        g = next(iter(package['grants'].values()))['grant']
        reservation = Q.reservation_path(self.state, A.exact_qualification(g, CONTROLLER))
        saved = reservation.read_bytes()
        reservation.unlink()
        value = self.run_pm(role=P.ROLES[1], request=self.qa_request)
        self.assertEqual(value['status'], 'BLOCKED', value)
        reservation.write_bytes(saved)
        raw = R.read(reservation, 0)
        raw['operation'] = 'e'*64
        self.atomic(self.state/('antigravity-29-addressed-'+'f'*64+'.json'), raw)
        value = self.run_pm(role=P.ROLES[1], request=self.qa_request)
        self.assertEqual(value['status'], 'BLOCKED', value)
        self.assertIn('orphan model reservation', value['reason'])

    def test_runtime_reservation_retains_inherited_calls_and_prevents_second_spend(self):
        first = self.run_pm()
        self.consume_analysis(first)
        qa = self.run_pm(role=P.ROLES[1], request=self.qa_request)
        self.assertEqual(qa['status'], 'GRANTED', qa)
        q = N.qualification_descriptor(R.read(self.marker, 0))
        slot = R.read(self.state/'slot2.json', 0)
        historical = dict(finished_at=1, result=dict(status='unknown', safe_release=True))
        slot['operations'][Q.OWNER_PACKAGE_ORIGINAL_UNKNOWN] = historical
        self.atomic(self.state/'slot2.json', slot)
        self.atomic(self.state/Q.ADDRESSED_RECONCILIATION,
                    dict(phase='complete', third_operation_sha256=Q.THIRD_DIGEST))
        prior_bytes = Path(first['package_path']).read_bytes()
        with patch.object(Q, 'addressed_history'), patch.object(Q, 'OWNER_PACKAGE_ORIGINAL_UNKNOWN_DIGEST', digest(historical)):
            Q.reserve_addressed(R, q, 'c'*64)
            value = R.read(Path(qa['package_path']), 0)
            self.assertEqual(value['used_calls'], 2)
            self.assertEqual(next(iter(value['grants'].values()))['operation'], 'c'*64)
            with self.assertRaises(Refused):
                Q.reserve_addressed(R, q, 'd'*64)
        self.assertEqual(Path(first['package_path']).read_bytes(), prior_bytes)

    def test_pinned_predecessor_tampering_blocks_runtime_and_next_package(self):
        first = self.run_pm()
        self.consume_analysis(first)
        qa = self.run_pm(role=P.ROLES[1], request=self.qa_request)
        self.assertEqual(qa['status'], 'GRANTED', qa)
        grant = next(iter(R.read(Path(qa['package_path']), 0)['grants'].values()))['grant']
        # Read path verifies actual predecessor bytes, not just a claimed hash.
        self.assertEqual(Q.owner_package_read(R, grant)['used_calls'], 1)
        path = Path(first['package_path'])
        path.write_bytes(path.read_bytes()+b' ')
        with self.assertRaises(Refused):
            Q.owner_package_read(R, grant)

    def test_invalid_qa_contract_cannot_be_authorized_by_a_correct_hash(self):
        first = self.run_pm()
        self.consume_analysis(first)
        self.git('checkout', '-q', self.qa_revision)
        (self.work/self.qa_path).write_text(canonical(dict(schema='fake', source_sha=self.head, checks=[])))
        self.git('add', '.')
        self.git('commit', '-qm', 'synthetic malformed QA fixture')
        revision = self.git('rev-parse', 'HEAD').strip()
        checksum = hashlib.sha256((self.work/self.qa_path).read_bytes()).hexdigest()
        self.git('checkout', '-q', self.head)
        self.delegation['allowed_input_paths'].append(dict(revision=revision, path=self.qa_path, sha256=checksum))
        self.sync_comment()
        value = self.run_pm(role=P.ROLES[1], request=dict(self.qa_request, input_revision=revision, input_sha256=checksum))
        self.assertEqual(value['status'], 'BLOCKED', value)
        self.assertIn('QA source/test contract', value['reason'])

    def test_no_delegation_and_nonroot_and_lock_contention(self):
        with patch.object(P, 'fetch_delegation', side_effect=P.NeedsOwner('no delegation')):
            self.assertEqual(self.run_pm()['status'], 'NEEDS_OWNER')
        with patch.object(P.os, 'geteuid', return_value=1000):
            value = self.run_pm()
            self.assertEqual(value['status'], 'BLOCKED')
            self.assertIn('root', value['reason'])
        import fcntl
        fd = os.open(self.state/'controller.lock', os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX|fcntl.LOCK_NB)
            value = self.run_pm()
            self.assertEqual(value['status'], 'BLOCKED')
            self.assertIn('unavailable', value['reason'])
        finally:
            os.close(fd)

    def test_policy_drift_during_intent_does_not_get_overwritten(self):
        def crash(path, value, mode=0o600):
            self.atomic(path, value, mode)
            raise RuntimeError('synthetic crash')
        with patch.object(R, 'atomic', side_effect=crash):
            with self.assertRaises(RuntimeError):
                self.run_pm()
        foreign = dict(mode='active', controller_sha=CONTROLLER, owned={'slot2': 'foreign'})
        self.atomic(self.policy, foreign)
        value = self.run_pm()
        self.assertEqual(value['status'], 'BLOCKED', value)
        self.assertIn('policy changed', value['reason'])
        self.assertEqual(R.read(self.policy, 0), foreign)

    def test_fetch_uses_real_comment_without_network_in_tests(self):
        response = copy.deepcopy(self.comment)
        response['reactions'] = {'total_count': 12}
        response['user']['avatar_url'] = 'https://example.invalid/mutable-avatar'
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, size): return canonical(response).encode()[:size]
        # Explicitly exercise the production fetcher, mocking only HTTP transport.
        import urllib.request
        with patch.object(urllib.request, 'urlopen', return_value=Response()) as transport:
            comment = self.real_fetch(COMMENT)
            self.assertEqual(comment, self.comment)
            self.assertEqual(P.validate_delegation(comment, COMMENT, controller=CONTROLLER, now=NOW), self.delegation)
        transport.assert_called_once()


if __name__ == '__main__':
    unittest.main()

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
import urllib.request
import urllib.response
from email.message import Message
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
        self.delegation = dict(schema=P.SCHEMA, issue=29, repo_id=A.REPO_ID,
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
        self.atomic(self.budget, dict(providers=dict(agy=dict(qa=2))))
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
        self.history_operations = set()
        self.set_history()
        # Exercise production fetch/redirect/authentication code. Only the last
        # HTTPS transport is synthetic; no fetch_delegation mock hides sockets.
        self.http = self.stack.enter_context(patch.object(urllib.request.HTTPSHandler, 'https_open',
                                                         side_effect=self.http_response))
        self.sockets = [self.stack.enter_context(patch.object(target, name,
                         side_effect=AssertionError('network forbidden')))
                        for target, name in ((socket.socket, 'connect'),
                                             (socket, 'create_connection'), (socket, 'getaddrinfo'))]
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

    def http_response(self, req, *, data=None, code=200, location=None):
        self.assertRegex(req.full_url, r'^https://api\.github\.com/repos/anpavel84-afk/'
                                      r'gobadminton-clean/issues/comments/[1-9][0-9]*$')
        self.assertEqual(req.get_method(), 'GET')
        self.assertEqual(req.timeout, 10)
        self.assertIsNone(req.data)
        headers = Message()
        if location:
            headers['Location'] = location
        raw = canonical(self.comment if data is None else data).encode()
        response = urllib.response.addinfourl(io.BytesIO(raw), headers, req.full_url, code=code)
        response.msg = 'synthetic response'
        return response

    def set_history(self, count=0, *, supplemental=0, qualification=0, oneshot=False, original=False):
        """Real historical ledger schemas, synthetic charge identities and pins."""
        slot = R.read(self.state / 'slot2.json', 0)
        for operation in self.history_operations:
            slot['operations'].pop(operation, None)
        self.history_operations = set()
        def charge(operation):
            self.history_operations.add(operation)
            slot['operations'][operation] = dict(finished_at=1, result=dict(status='unknown', safe_release=True))
            return operation
        def historical_grant(index, comment=6362661117):
            head = hashlib.sha1(('synthetic history ' + str(index)).encode()).hexdigest()
            base = self.base
            if comment == Q.SUPPLEMENT_OWNER_COMMENT:
                base, head = Q.FRESH_SOURCE_BASE, Q.FRESH_SOURCE_HEAD
            return dict(schema=Q.ADDRESSED_SCHEMA, lineage=Q.ADDRESSED_LINEAGE, owner_comment=comment,
                        role=P.ROLES[0], controller_revision=CONTROLLER, cli_sha256=N.AGY_SHA256,
                        rules_sha256=A.RULES, base=base, head=head, input_revision=head,
                        input_path=Q.ANALYSIS_INPUT, input_sha256=Q.ANALYSIS_INPUT_SHA256,
                        timeout=1800, max_output_bytes=N.MAX_OUT, permission_mode=N.PERMISSION_MODE,
                        input_transport='stream-json', ceiling=1)
        rows = {}
        for index in range(max(1, count)):
            g = historical_grant(index)
            op = charge(hashlib.sha256(('history ' + str(index)).encode()).hexdigest()) if index < count else None
            rows[digest(g)] = dict(grant=g, operation=op)
        self.atomic(self.state / Q.ADDRESSED_LEDGER, dict(schema=Q.ADDRESSED_SCHEMA,
                    lineage=Q.ADDRESSED_LINEAGE, ceiling=4, used_calls=count, grants=rows))
        g = historical_grant(0, Q.SUPPLEMENT_OWNER_COMMENT)
        self.atomic(self.state / Q.SUPPLEMENT_LEDGER, dict(schema=Q.SUPPLEMENT_SCHEMA,
                    owner_comment=Q.SUPPLEMENT_OWNER_COMMENT, ceiling=2, used_calls=supplemental,
                    legacy_used_calls=3, grants={digest(g): dict(grant=g,
                        operation=charge('9'*64) if supplemental else None)}))
        for name, pin in ((Q.ADDRESSED_LEDGER, 'HIST'), (Q.SUPPLEMENT_LEDGER, 'SUP')):
            checksum = A.sha(self.state / name)
            self.stack.enter_context(patch.object(A, pin, checksum))
            self.stack.enter_context(patch.object(Q, 'OWNER_PACKAGE_OLD_ADDRESS_SHA' if pin == 'HIST'
                                                  else 'OWNER_PACKAGE_OLD_SUPPLEMENT_SHA', checksum))
        self.stack.enter_context(patch.object(A, 'BUDGET', A.sha(self.budget)))
        for name in (Q.LINEAGE, Q.GRANT_LEDGER, Q.FIXED):
            (self.state / name).unlink(missing_ok=True)
        if qualification:
            value = dict(schema='GB_AGY_29_LINEAGE_V1', ceiling=2, used_calls=qualification,
                         parent_task=Q.PARENT_TASK, allowed_successor=Q.SECOND_TASK)
            charge(Q.PARENT_OPERATION)
            if qualification == 2:
                value['reserved_operation'] = charge(Q.SECOND_OPERATION)
            self.atomic(self.state / Q.LINEAGE, value)
            self.stack.enter_context(patch.object(Q, 'LINEAGE_RAW', A.sha(self.state / Q.LINEAGE)))
        if original:
            value = dict(operation=charge(Q.PARENT_OPERATION), result=dict(status='unknown'))
            self.atomic(self.state / Q.FIXED, value)
            self.stack.enter_context(patch.object(Q, 'PARENT_RESERVATION_DIGEST', digest(value)))
        if oneshot:
            self.atomic(self.state / Q.GRANT_LEDGER, dict(schema=Q.GRANT_SCHEMA, ceiling=1,
                        used_calls=1, reserved_operation=charge(Q.THIRD_OPERATION), task_sha256=Q.THIRD_TASK))
        self.atomic(self.state / 'slot2.json', slot)

    def run_pm(self, mode='--apply', role=None, request=None, comment_id=COMMENT):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            P.main([mode, '--issue', '29', '--role', role or P.ROLES[0],
                    '--delegation-comment', str(comment_id), '--request-json', canonical(request or self.request)])
        lines = out.getvalue().splitlines()
        self.assertEqual(len(lines), 1)
        value = json.loads(lines[0])
        self.assertEqual(value['model_calls'], 0)
        for blocked in self.sockets:
            blocked.assert_not_called()
        self.assertIn(value['status'], ('GRANTED', 'BLOCKED', 'NEEDS_OWNER'))
        self.assertEqual(value['admission_id'], P.identity(29, role or P.ROLES[0], comment_id, request or self.request))
        self.assertTrue(value['reason'])
        self.assertIs(type(value['replayed']), bool)
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
        self.assertFalse(first['replayed'])
        self.consume_analysis(first)
        files = {p.name: p.read_bytes() for p in self.state.iterdir()}
        # No transport call is permitted for either replay or status.
        self.http.reset_mock()
        self.http.side_effect = AssertionError('offline replay fetched')
        again = self.run_pm()
        self.assertEqual(again['status'], 'GRANTED', again)
        self.assertTrue(again['replayed'])
        self.assertEqual(first['admission_id'], again['admission_id'])
        self.assertEqual(files, {p.name: p.read_bytes() for p in self.state.iterdir()})
        self.assertEqual(self.run_pm('--status')['status'], 'GRANTED')
        self.http.assert_not_called()

    def test_dry_run_no_writes_and_apply_same_digest(self):
        before = {p.name: p.read_bytes() for p in self.state.iterdir()}
        dry = self.run_pm('--dry-run')
        self.assertEqual(dry['status'], 'GRANTED', dry)
        self.assertTrue(dry['dry_run'])
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.state.iterdir()})
        applied = self.run_pm()
        self.assertEqual(applied['admission_id'], dry['admission_id'])

    def assert_historical_admission(self, used):
        before = {name: (self.state / name).read_bytes() for name in
                  (Q.ADDRESSED_LEDGER, Q.SUPPLEMENT_LEDGER, Q.LINEAGE, Q.GRANT_LEDGER, Q.FIXED)
                  if (self.state / name).exists()}
        admitted = self.run_pm()
        self.assertEqual(admitted['status'], 'GRANTED', admitted)
        self.assertEqual(admitted['remaining_budget']['used_calls'], used)
        self.assertEqual(admitted['remaining_budget']['package_calls'], 5-used)
        self.assertEqual(admitted['remaining_budget']['total_calls'], 5-used)
        package = R.read(Path(admitted['package_path']), 0)
        self.assertEqual(package['used_calls'], used)
        self.assertEqual(package['delegation']['inherited_calls'], used)
        grant = next(iter(package['grants'].values()))['grant']
        self.assertEqual(Q.owner_package_read(R, grant), package)
        self.assertEqual(before, {name: (self.state/name).read_bytes() for name in before})
        return admitted

    def test_historical_one_of_one_starts_at_one(self):
        self.set_history(oneshot=True)
        self.assert_historical_admission(1)

    def test_historical_two_of_two_unknown_charges_stay_spent(self):
        # The original reservation duplicates the first lineage charge. Count
        # it once, including when both UNKNOWNs have been safely released.
        self.set_history(qualification=2, original=True)
        self.assert_historical_admission(2)

    def test_historical_spend_survives_all_seven_intent_crash_points(self):
        self.set_history(qualification=2, original=True)
        self.test_crash_after_every_durable_write_is_idempotent(historical=2)

    def test_runtime_spend_uses_the_same_historical_accounting(self):
        self.set_history(qualification=2, original=True)
        self.test_runtime_reservation_retains_inherited_calls_and_prevents_second_spend(historical=2)

    def test_historical_three_of_three_starts_at_three(self):
        self.set_history(qualification=2, oneshot=True, original=True)
        self.assert_historical_admission(3)

    def test_historical_addressed_and_supplement_charges_are_inherited(self):
        self.set_history(count=3, supplemental=1)
        self.assert_historical_admission(4)

    def test_historical_and_dynamic_and_delegated_spend_is_counted_once(self):
        self.set_history(qualification=2, original=True)
        # This existing test exercises a personal Owner package followed by
        # delegated analysis and QA. Only expected cumulative totals differ.
        self.test_previous_personal_owner_package_calls_are_inherited(historical=2)

    def test_history_at_or_over_per_package_and_total_ceiling_needs_owner(self):
        self.set_history(qualification=2, oneshot=True)
        for per_package, total in ((3, 5), (2, 5), (5, 3), (5, 2)):
            with self.subTest(per_package=per_package, total=total):
                self.delegation.update(max_calls_per_package=per_package, max_total_calls=total)
                self.sync_comment()
                value = self.run_pm()
                self.assertEqual(value['status'], 'NEEDS_OWNER', value)
                self.assertEqual(value['remaining_budget']['used_calls'], 3)
                self.assertFalse(list(self.state.glob(P.RECEIPT_PREFIX+'*.json')))

    def test_history_at_five_cannot_be_reset_by_new_comment_or_larger_total(self):
        self.set_history(count=4, supplemental=1)
        self.comment['id'] = COMMENT+1
        self.delegation['max_total_calls'] = 100
        self.sync_comment()
        value = self.run_pm(comment_id=COMMENT+1)
        self.assertEqual(value['status'], 'NEEDS_OWNER', value)
        self.assertEqual(value['remaining_budget']['used_calls'], 5)

    def test_historical_pin_and_counter_tampering_refused(self):
        self.set_history(count=2)
        path = self.state / Q.ADDRESSED_LEDGER
        raw = path.read_bytes()
        path.write_bytes(raw+b' ')
        self.assertEqual(self.run_pm()['status'], 'BLOCKED')
        path.write_bytes(raw)
        value = R.read(path, 0)
        value['used_calls'] = 0
        self.atomic(path, value)
        # Even a synthetic new pin cannot make a counter disagree with its rows.
        with patch.object(A, 'HIST', A.sha(path)):
            self.assertEqual(self.run_pm()['status'], 'BLOCKED')

    def test_unresolved_historical_unknown_blocks_without_refunding(self):
        self.set_history(qualification=2)
        slot = R.read(self.state / 'slot2.json', 0)
        slot['operations'][Q.SECOND_OPERATION]['result']['safe_release'] = False
        self.atomic(self.state / 'slot2.json', slot)
        value = self.run_pm()
        self.assertEqual(value['status'], 'BLOCKED', value)
        self.assertIn('unresolved UNKNOWN', value['reason'])
        self.assertEqual(P.historical_operations(R, slot), {Q.PARENT_OPERATION, Q.SECOND_OPERATION})

    def test_offline_status_before_any_receipt_never_fetches(self):
        self.http.side_effect = AssertionError('status fetched')
        value = self.run_pm('--status')
        self.assertEqual(value['status'], 'BLOCKED')
        self.assertFalse(value['replayed'])
        self.http.assert_not_called()

    def test_production_fetch_once_per_new_dry_run_and_apply_exact_id_timeout(self):
        for mode in ('--dry-run', '--apply'):
            self.http.reset_mock()
            value = self.run_pm(mode)
            self.assertEqual(value['status'], 'GRANTED', value)
            self.http.assert_called_once()
            req = self.http.call_args.args[0]
            self.assertEqual(req.full_url, 'https://api.github.com/repos/anpavel84-afk/'
                             'gobadminton-clean/issues/comments/' + str(COMMENT))
            self.assertEqual(req.timeout, 10)

    def test_fetch_rejects_redirect_without_following_any_host_or_retrying(self):
        for location in ('https://example.invalid/stolen', 'http://api.github.com/elsewhere',
                         A.ISSUE_URL, 'https://api.github.com/repos/another/issues/comments/1'):
            with self.subTest(location=location):
                with patch.object(urllib.request.HTTPSHandler, 'https_open',
                     side_effect=lambda req: self.http_response(req, code=302, location=location)) as transport:
                    value = self.run_pm()
                    self.assertEqual(value['status'], 'BLOCKED', value)
                    self.assertIn('redirect', value['reason'])
                    transport.assert_called_once()

    def test_fetch_failure_and_oversized_http_response_have_no_retry(self):
        with patch.object(urllib.request.HTTPSHandler, 'https_open', side_effect=OSError('offline')) as transport:
            self.assertEqual(self.run_pm()['status'], 'NEEDS_OWNER')
            transport.assert_called_once()
        self.comment['padding'] = 'x'*32769
        self.http.reset_mock()
        self.assertEqual(self.run_pm()['status'], 'BLOCKED')
        self.http.assert_called_once()

    def test_self_id_is_rejected_and_posted_id_is_bound_in_receipt_and_digest(self):
        self.delegation['delegation_comment'] = COMMENT
        self.sync_comment()
        refused = self.run_pm()
        self.assertEqual(refused['status'], 'BLOCKED', refused)
        del self.delegation['delegation_comment']
        self.sync_comment()
        first = self.run_pm('--dry-run')
        self.comment['id'] = COMMENT+1  # Same body, a different posted comment.
        second = self.run_pm(comment_id=COMMENT+1)
        self.assertEqual(second['status'], 'GRANTED', second)
        self.assertNotEqual(first['admission_id'], second['admission_id'])
        receipt = R.read(Path(second['receipt_path']), 0)
        self.assertEqual(receipt['owner_comment'], COMMENT+1)
        self.assertEqual(receipt['comment']['id'], COMMENT+1)
        self.assertNotIn('delegation_comment', P.loads(receipt['comment']['body'][len(P.PREFIX):]))

    def test_refusal_digest_is_present_before_root_and_request_validation(self):
        with patch.object(P.os, 'geteuid', return_value=1000):
            self.assertEqual(self.run_pm()['status'], 'BLOCKED')
        value = self.run_pm(request=dict(self.request, scope='PROD'))
        self.assertEqual(value['status'], 'BLOCKED')
        self.assertTrue(value['needs_review'])

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

    def durable_snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes()
                for p in (self.policy, self.marker, self.budget, *self.state.iterdir())}

    def sized_journal(self, size, unit='x'):
        """Completed synthetic operation; exact atomic byte size, real read gate."""
        path = self.state / 'slot2.json'
        slot = R.read(path, 0)
        row = dict(finished_at=1, result=dict(status='confirmed', evidence=''))
        slot['operations']['f'*64] = row
        padding = size - len(A.encoded(slot))
        self.assertGreaterEqual(padding, 0)
        # Include adversarial JSON escaping when requested. Pad any byte-size
        # remainder with ASCII so all sizes, including exact boundaries, exist.
        count, tail = divmod(padding, len(json.dumps(unit).encode()) - 2)
        row['result']['evidence'] = unit*count + 'x'*tail
        self.atomic(path, slot)
        self.assertEqual(path.stat().st_size, size)
        self.assertEqual(R.read(path, 0), slot)
        return slot

    def assert_size_refusal_without_writes(self, mode='--apply'):
        before = self.durable_snapshot()
        with patch.object(R, 'atomic', wraps=self.atomic) as writes:
            value = self.run_pm(mode)
        self.assertEqual(value['status'], 'BLOCKED', value)
        self.assertIn('recovery read limit', value['reason'])
        self.assertFalse(value['replayed'])
        writes.assert_not_called()
        self.assertEqual(self.durable_snapshot(), before)
        return value

    def test_qa_2090201_byte_journal_refuses_before_any_mutation(self):
        # QA R2b reproduction: the input is readable but its transaction envelope
        # crosses 2 MiB. Refusal must precede even the intent/policy writes.
        self.set_history(qualification=2, original=True)
        self.sized_journal(2090201)
        for mode in ('--dry-run', '--apply'):
            with self.subTest(mode=mode):
                value = self.assert_size_refusal_without_writes(mode)
                self.assertIn('intent', value['reason'])

    def test_input_journal_at_read_limit_and_limit_minus_one_remains_unchanged(self):
        # Read accepts both inputs; the serialized envelope must still refuse.
        for size in (2097152, 2097151):
            self.sized_journal(size)
            for mode in ('--dry-run', '--apply'):
                with self.subTest(size=size, mode=mode):
                    self.assert_size_refusal_without_writes(mode)

    def test_complete_receipt_boundary_and_largest_accepted_round_trip(self):
        # Measure the real envelope without bypassing any validation or write.
        self.sized_journal(2000000)
        with patch.object(P, 'recoverable_sizes', wraps=P.recoverable_sizes) as sizes:
            self.assertEqual(self.run_pm('--dry-run')['status'], 'GRANTED')
        transaction = sizes.call_args.args[0]
        overhead = len(A.encoded(dict(transaction, phase='complete'))) - 2000000
        self.assertGreater(overhead, 0)
        for receipt_size in (2097153, 2097152):
            self.sized_journal(receipt_size - overhead)
            for mode in ('--dry-run', '--apply'):
                with self.subTest(receipt_size=receipt_size, mode=mode):
                    value = self.assert_size_refusal_without_writes(mode)
                    # Intent is two bytes shorter and fits; complete must be
                    # checked separately, before writing that valid intent.
                    self.assertIn('complete receipt', value['reason'])
        self.sized_journal(2097151 - overhead)
        granted = self.run_pm()
        self.assertEqual(granted['status'], 'GRANTED', granted)
        self.assertEqual(Path(granted['receipt_path']).stat().st_size, 2097151)
        for p in (self.policy, self.marker, *self.state.glob('*.json')):
            self.assertLess(p.stat().st_size, 65536 if p == self.marker else 2097152)
            R.read(p, 0)  # Same production recovery reader, no raised limits.
        self.http.reset_mock()
        self.http.side_effect = AssertionError('offline replay fetched')
        before = self.durable_snapshot()
        for mode in ('--apply', '--status'):
            value = self.run_pm(mode)
            self.assertEqual(value['status'], 'GRANTED', value)
            self.assertTrue(value['replayed'])
            self.assertEqual(value['admission_id'], granted['admission_id'])
        self.http.assert_not_called()
        self.assertEqual(before, self.durable_snapshot())

    def test_json_escaped_journal_must_fit_its_envelope_before_writes(self):
        # A much smaller readable journal can grow well beyond 2 MiB when its
        # quotes, backslashes, newlines and Unicode escapes are encoded again.
        self.sized_journal(1600000, unit='"\\\n\u2603')
        for mode in ('--dry-run', '--apply'):
            with self.subTest(mode=mode):
                self.assert_size_refusal_without_writes(mode)

    def test_large_accepted_journal_recovers_after_each_durable_write(self):
        self.set_history(qualification=2, original=True)
        original = self.sized_journal(2000000)
        # Includes writes 1 (intent), 2 (disabled policy), 3 (package), marker,
        # journal, complete receipt and reactivation, all with real readback.
        self.test_crash_after_every_durable_write_is_idempotent(historical=2)
        value = self.run_pm('--status')
        self.assertEqual(value['status'], 'GRANTED', value)
        self.assertTrue(value['replayed'])
        for p in (self.policy, self.marker, *self.state.glob('*.json')):
            self.assertLess(p.stat().st_size, 65536 if p == self.marker else 2097152)
            R.read(p, 0)
        self.assertEqual(R.read(self.state/'slot2.json', 0)['operations'], original['operations'])

    def test_crash_after_every_durable_write_is_idempotent(self, historical=0):
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
                fetches = self.http.call_count
                status = self.run_pm('--status')
                self.assertEqual(status['status'], 'GRANTED' if crash_at == 7 else 'BLOCKED', status)
                recovered = self.run_pm()
                self.assertEqual(recovered['status'], 'GRANTED', recovered)
                self.assertTrue(recovered['replayed'])
                self.assertEqual(self.http.call_count, fetches)
                self.assertEqual(R.read(self.policy, 0)['mode'], 'active')
                self.assertEqual(R.read(self.state / 'slot2.json', 0)['generation'], 97)
                self.assertEqual(R.read(Path(recovered['receipt_path']), 0)['phase'], 'complete')
                self.assertEqual(len(list(self.state.glob(Q.OWNER_PACKAGE_LEDGER_PREFIX+'delegated-*.json'))), 1)
                self.assertEqual(R.read(Path(recovered['package_path']), 0)['used_calls'], historical)

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
                self.assertEqual(recovered['status'], 'GRANTED', recovered)
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

    def test_previous_personal_owner_package_calls_are_inherited(self, historical=0):
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
        self.assertEqual(R.read(Path(admitted['package_path']), 0)['used_calls'], historical+1)
        self.consume_analysis(admitted)
        qa = self.run_pm(role=P.ROLES[1], request=self.qa_request)
        self.assertEqual(qa['status'], 'GRANTED', qa)
        value = R.read(Path(qa['package_path']), 0)
        self.assertEqual(value['used_calls'], historical+2)  # inherited counters are not re-summed
        self.assertEqual(len(value['delegation']['prior_packages']), 2)
        self.assertEqual(path.read_bytes(), prior_bytes)

    def test_new_comment_cannot_reissue_unchanged_input(self):
        first = self.run_pm()
        self.assertEqual(first['status'], 'GRANTED', first)
        comment_id = COMMENT+1
        self.comment['id'] = comment_id
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

    def test_runtime_reservation_retains_inherited_calls_and_prevents_second_spend(self, historical=0):
        first = self.run_pm()
        self.consume_analysis(first)
        qa = self.run_pm(role=P.ROLES[1], request=self.qa_request)
        self.assertEqual(qa['status'], 'GRANTED', qa)
        q = N.qualification_descriptor(R.read(self.marker, 0))
        slot = R.read(self.state/'slot2.json', 0)
        historical_operation = dict(finished_at=1, result=dict(status='unknown', safe_release=True))
        slot['operations'][Q.OWNER_PACKAGE_ORIGINAL_UNKNOWN] = historical_operation
        self.atomic(self.state/'slot2.json', slot)
        self.atomic(self.state/Q.ADDRESSED_RECONCILIATION,
                    dict(phase='complete', third_operation_sha256=Q.THIRD_DIGEST))
        prior_bytes = Path(first['package_path']).read_bytes()
        with patch.object(Q, 'addressed_history'), patch.object(Q, 'OWNER_PACKAGE_ORIGINAL_UNKNOWN_DIGEST', digest(historical_operation)):
            Q.reserve_addressed(R, q, 'c'*64)
            value = R.read(Path(qa['package_path']), 0)
            self.assertEqual(value['used_calls'], historical+2)
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
        with patch.object(urllib.request.HTTPSHandler, 'https_open', side_effect=OSError('synthetic offline')):
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
        with patch.object(urllib.request.HTTPSHandler, 'https_open',
                          side_effect=lambda req: self.http_response(req, data=response)) as transport:
            comment = self.real_fetch(COMMENT)
            self.assertEqual(comment, self.comment)
            self.assertEqual(P.validate_delegation(comment, COMMENT, controller=CONTROLLER, now=NOW), self.delegation)
        transport.assert_called_once()


if __name__ == '__main__':
    unittest.main()

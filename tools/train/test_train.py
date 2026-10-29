#!/usr/bin/env python3
"""Proportionate deterministic tests for Lean Mode B (OD-017 repair3).

Exercises the real run_once controller with mocked external adapters — not a
parallel demo. Covers: two eligible Project-style tasks auto-next; stale/park/OFF
exclusion; QA FAIL→repair→new SHA; distinct candidate/merge SHA; duplicate events;
concurrent writer; UNKNOWN no replay; CI repairable FAIL→author findings; wake
deadline resume; Project queue_unavailable zero calls; live default binding
presence via mock subprocess boundary (no live calls); parser; quota; landlock
fixtures with injected temp auth path (never probe host /srv); host request gates.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import providers
import run as lean_run
import host as lean_host
import monitor as lean_mon
import live as lean_live


OWNER = 318610566
REPO_ID = 1416250340
REPO = 'anpavel84-afk/gobadminton-clean'


def owner_task_comment(issue=337, **overrides):
    task = {
        'repo': REPO,
        'target': 'dev',
        'issue': issue,
        'goal': 'bounded product fix',
        'acceptance': ['DEV ACCEPTED', 'CI 7/7'],
        'allowed_paths': ['apps/web/src/x.ts'],
        'dependencies': [],
        'priority': 10,
        'authorroute': ['cursor_auto'],
        'qaroute': ['codex_sol_medium'],
        'independentfallback': ['codex_sol_medium'],
    }
    task.update(overrides)
    body = 'GOBADMINTON_LEAN_TASK_V1\n' + json.dumps(task)
    return {
        'id': 900000 + int(issue),
        'body': body,
        'user': {'id': OWNER, 'login': 'anpavel84-afk'},
        'created_at': '2026-10-28T12:00:00Z',
        'updated_at': '2026-10-28T12:00:00Z',
    }, task


def _sha(n):
    return format(n, 'x').zfill(40)[-40:]


class FakeRegistry:
    """Minimal one-writer lease for unit tests (no live slots.py / host locks)."""

    busy = False

    def __init__(self, lock_dir, registry_lock):
        self.lock_dir = lock_dir
        self._held = False

    def acquire(self, slot, record):
        if FakeRegistry.busy:
            return False
        FakeRegistry.busy = True
        self._held = True
        return True

    def release(self):
        if self._held:
            FakeRegistry.busy = False
            self._held = False


def make_flow_adapters(td, *, fail_qa_once=False, distinct_merge=False, shas=None,
                       ci_fail_once=False, wait_ci_once=False):
    """Mocked adapters exercising the real execute_claim path.

    Injects temp lock_dir + integration_lock under td — never host-protected paths.
    """
    shas = list(shas or [_sha(1), _sha(2), _sha(3)])
    state = {
        'author_i': 0, 'qa_calls': 0, 'author_calls': 0, 'publish_calls': 0,
        'merge_calls': 0, 'ci_calls': 0, 'author_findings': [],
    }
    integ = Path(td) / 'integration.lock'
    integ.write_text('test')
    locks = Path(td) / 'locks'
    locks.mkdir(exist_ok=True)

    def worktree(task):
        return str(Path(td) / 'wt' / str(task['issue']))

    def author(**kwargs):
        state['author_calls'] += 1
        task = kwargs.get('task') or {}
        state['author_findings'].append(list(task.get('repair_findings') or []))
        i = min(state['author_i'], len(shas) - 1)
        sha = shas[i]
        state['author_i'] += 1
        return {'candidate_sha': sha, 'changed_paths': ['apps/web/src/x.ts']}

    def qa(claim):
        state['qa_calls'] += 1
        sha = claim['candidate_sha']
        if fail_qa_once and state['qa_calls'] == 1:
            return {'verdict': 'FAIL', 'findings': ['missing test for X'],
                    'reviewed_sha': sha, 'charge': 'charged'}
        return {'verdict': 'PASS', 'findings': [], 'reviewed_sha': sha, 'charge': 'charged'}

    def publish(kind=None, payload=None, intent_path=None, **_):
        state['publish_calls'] += 1
        if kind == 'merge_dev':
            return merge(kind=kind, payload=payload)
        return {'pr': 1000 + int(payload['issue']), 'head_sha': payload['sha']}

    def merge(kind=None, payload=None, intent_path=None, **_):
        state['merge_calls'] += 1
        candidate = payload['sha']
        if distinct_merge:
            # Normal GitHub merge creates a NEW commit SHA.
            merged = _sha(int(candidate[-4:], 16) ^ 0xABC)
            return {
                'merged_sha': merged, 'merge_sha': merged,
                'candidate_sha': candidate, 'pr': payload.get('pr'),
                'parents': [candidate, 'd' * 40],
            }
        return {'merged_sha': candidate, 'merge_sha': candidate,
                'candidate_sha': candidate, 'pr': payload.get('pr')}

    def wait_ci(claim):
        state['ci_calls'] += 1
        if wait_ci_once and state['ci_calls'] == 1:
            return {'ok': False, 'waiting': True, 'head_sha': claim['candidate_sha']}
        if ci_fail_once and state['ci_calls'] == 1:
            return {
                'ok': False, 'repairable': True, 'head_sha': claim['candidate_sha'],
                'findings': ['CI job failed: source (web) (run 1/1)'],
            }
        return {'ok': True, 'head_sha': claim['candidate_sha'], 'checks': 7}

    def deploy(claim):
        return {'accepted': True, 'live_sha': claim['merged_sha'],
                'receipt': {'status': 'ACCEPTED', 'line': 'ACCEPTED'}}

    def preqa(worktree, allowed, base):
        return {'ok': True, 'head': shas[min(state['author_i'] - 1, len(shas) - 1)],
                'changed': list(allowed), 'illegal': [], 'base': base}

    FakeRegistry.busy = False
    return lean_run.Adapters(
        author=author,
        qa=qa,
        publish=publish,
        merge=merge,
        wait_ci=wait_ci,
        deploy=deploy,
        worktree=worktree,
        preqa_diff=preqa,
        lock_registry=FakeRegistry,
        lock_dir=str(locks),
        integration_lock=str(integ),
        evidence_dir=str(Path(td) / 'evidence'),
    ), state


class AdmissionTests(unittest.TestCase):
    def test_owner_admission_ok(self):
        comment, task = owner_task_comment()
        adm = lean_run.admit_comment(comment, {'number': 337, 'state': 'open'}, {'id': REPO_ID})
        self.assertEqual(adm['issue'], 337)
        self.assertEqual(len(adm['revision']), 64)

    def test_outsider_comment_denied(self):
        comment, _ = owner_task_comment()
        comment['user'] = {'id': 1, 'login': 'outsider'}
        with self.assertRaises(lean_run.LeanError) as ctx:
            lean_run.admit_comment(comment, {'number': 337, 'state': 'open'}, {'id': REPO_ID})
        self.assertEqual(ctx.exception.code, 'outsider_comment_denied')

    def test_182_old_admission_still_held(self):
        """Old #182 admissions without OD018 signed prospective release stay held."""
        comment, _ = owner_task_comment(issue=182)
        with self.assertRaises(lean_run.LeanError) as ctx:
            lean_run.admit_comment(comment, {'number': 182, 'state': 'open'}, {'id': REPO_ID})
        self.assertEqual(ctx.exception.code, 'admission_hold')
        self.assertEqual(ctx.exception.detail, 'issue_182_hard_hold')

    def test_182_od018_old_machine_held_new_admits(self):
        """Same signed OD018 context: old machine comment held; new id admits."""
        signed = {
            'id': lean_run.OD018_SIGNED_COMMENT_ID,
            'body': (
                '# OWNER DIRECT · SOCIAL GAMES RESTART & DEV ADMISSION · OD-017\n'
                'Supersedes the former Owner HOLD/OFF comment PROSPECTIVELY, '
                'only for the following bounded DEV rollout. '
                'This is not permission for PROD.\n'
            ),
            'user': {'id': OWNER, 'login': 'anpavel84-afk'},
            'created_at': '2026-10-28T23:09:33Z',
            'updated_at': '2026-10-28T23:09:33Z',
        }
        old_comment, _ = owner_task_comment(
            issue=182, owner_authority_comment=lean_run.OD018_SIGNED_COMMENT_ID)
        # Old machine admission id stays held even with new Owner release present.
        with self.assertRaises(lean_run.LeanError) as ctx:
            lean_run.admit_comment(
                old_comment, {'number': 182, 'state': 'open'}, {'id': REPO_ID},
                all_comments=[signed, old_comment])
        self.assertEqual(ctx.exception.code, 'admission_hold')
        self.assertEqual(ctx.exception.detail, 'issue_182_stale_machine_comment')
        # NEW machine admission (id > signed) + owner_authority_comment binding.
        new_comment, _ = owner_task_comment(
            issue=182, owner_authority_comment=lean_run.OD018_SIGNED_COMMENT_ID)
        new_comment['id'] = lean_run.OD018_SIGNED_COMMENT_ID + 100
        adm = lean_run.admit_comment(
            new_comment, {'number': 182, 'state': 'open'}, {'id': REPO_ID},
            all_comments=[signed, new_comment])
        self.assertEqual(adm['issue'], 182)
        self.assertEqual(adm['comment_id'], lean_run.OD018_SIGNED_COMMENT_ID + 100)
        self.assertEqual(adm['owner_id'], OWNER)
        # Unrelated issue must not use OD018 as a global 182 allow path.
        held, why = lean_run.od018_prospective_release(
            {'number': 701, 'state': 'open'}, [signed])
        self.assertFalse(held)
        self.assertEqual(why, 'not_182')

    def test_closed_issue_denied(self):
        comment, _ = owner_task_comment()
        with self.assertRaises(lean_run.LeanError) as ctx:
            lean_run.admit_comment(comment, {'number': 337, 'state': 'closed'}, {'id': REPO_ID})
        self.assertEqual(ctx.exception.code, 'admission_hold')


class FiniteFlowTests(unittest.TestCase):
    def test_two_eligible_tasks_autonext(self):
        """Two eligible Project-style tasks auto-next — NOT hardcoded 365→94.

        #94 PARK remains excluded from residual scope; 365 is UAT-delivered.
        """
        with tempfile.TemporaryDirectory() as td:
            adapters, state = make_flow_adapters(td, shas=[_sha(11), _sha(22)])
            admissions = []
            # Synthetic eligible residual Issues (not 365/94/182/UAT-delivered).
            for issue, prio in ((701, 20), (702, 10)):
                comment, task = owner_task_comment(issue=issue, priority=prio)
                adm = lean_run.admit_comment(
                    comment, {'number': issue, 'state': 'open'}, {'id': REPO_ID})
                admissions.append(adm)
            adapters.fetch_admissions = lambda: admissions
            out = lean_run.run_once(
                {'event_name': 'schedule'}, adapters=adapters, results_root=td, limit=2)
            self.assertEqual(out['status'], 'advanced')
            self.assertEqual(len(out['results']), 2)
            self.assertEqual(out['results'][0]['claim']['issue'], 701)
            self.assertEqual(out['results'][1]['claim']['issue'], 702)
            for r in out['results']:
                self.assertEqual(r['claim']['phase'], 'DEV_ACCEPTED_UAT_PENDING')
                self.assertEqual(r['claim']['uat'], 'NOT_TESTED')
            self.assertEqual(state['author_calls'], 2)
            self.assertEqual(state['qa_calls'], 2)

    def test_park_and_uat_delivered_excluded(self):
        self.assertFalse(lean_live.item_eligible(
            {'issue': 94, 'status': 'Ready', 'state': 'OPEN'})[0])
        self.assertFalse(lean_live.item_eligible(
            {'issue': 365, 'status': 'Ready', 'state': 'OPEN'})[0])
        # #182 is Project-eligible under OD018; admission still requires signed release.
        self.assertTrue(lean_live.item_eligible(
            {'issue': 182, 'status': 'Ready', 'state': 'OPEN'})[0])
        self.assertFalse(lean_live.item_eligible(
            {'issue': 701, 'status': 'Park', 'state': 'OPEN'})[0])
        self.assertTrue(lean_live.item_eligible(
            {'issue': 701, 'status': 'Ready', 'state': 'OPEN'})[0])

    def test_qa_fail_then_cursor_repair_new_sha(self):
        with tempfile.TemporaryDirectory() as td:
            adapters, state = make_flow_adapters(
                td, fail_qa_once=True, shas=[_sha(1), _sha(2)])
            comment, _ = owner_task_comment(issue=501)
            adm = lean_run.admit_comment(
                comment, {'number': 501, 'state': 'open'}, {'id': REPO_ID})
            out = lean_run.execute_claim(adm, adapters, results_root=td)
            self.assertEqual(out['claim']['phase'], 'DEV_ACCEPTED_UAT_PENDING')
            self.assertEqual(state['author_calls'], 2)
            self.assertEqual(state['qa_calls'], 2)
            self.assertEqual(out['claim']['candidate_sha'], _sha(2))
            self.assertEqual(out['claim']['last_qa']['verdict'], 'PASS')
            self.assertEqual(out['claim']['last_qa']['reviewed_sha'], _sha(2))
            # Exact findings propagated into repair author prompt.
            self.assertEqual(state['author_findings'][1], ['missing test for X'])

    def test_distinct_candidate_and_merge_sha(self):
        with tempfile.TemporaryDirectory() as td:
            adapters, state = make_flow_adapters(
                td, distinct_merge=True, shas=[_sha(5)])
            comment, _ = owner_task_comment(issue=510)
            adm = lean_run.admit_comment(
                comment, {'number': 510, 'state': 'open'}, {'id': REPO_ID})
            out = lean_run.execute_claim(adm, adapters, results_root=td)
            claim = out['claim']
            self.assertEqual(claim['phase'], 'DEV_ACCEPTED_UAT_PENDING')
            self.assertEqual(claim['candidate_sha'], _sha(5))
            self.assertEqual(claim['reviewed_candidate_sha'], _sha(5))
            self.assertNotEqual(claim['merged_sha'], claim['candidate_sha'])
            self.assertEqual(claim['dev']['live_sha'], claim['merged_sha'])

    def test_ci_fail_returns_author_findings_not_blocked(self):
        with tempfile.TemporaryDirectory() as td:
            adapters, state = make_flow_adapters(
                td, ci_fail_once=True, shas=[_sha(1), _sha(2)])
            comment, _ = owner_task_comment(issue=511)
            adm = lean_run.admit_comment(
                comment, {'number': 511, 'state': 'open'}, {'id': REPO_ID})
            out = lean_run.execute_claim(adm, adapters, results_root=td)
            self.assertEqual(out['claim']['phase'], 'DEV_ACCEPTED_UAT_PENDING')
            self.assertGreaterEqual(state['author_calls'], 2)
            self.assertTrue(any('CI job failed' in f for fs in state['author_findings'] for f in fs))

    def test_waiting_ci_resumes_without_unknown(self):
        with tempfile.TemporaryDirectory() as td:
            adapters, state = make_flow_adapters(
                td, wait_ci_once=True, shas=[_sha(9)])
            comment, _ = owner_task_comment(issue=512)
            adm = lean_run.admit_comment(
                comment, {'number': 512, 'state': 'open'}, {'id': REPO_ID})
            out1 = lean_run.execute_claim(adm, adapters, results_root=td)
            self.assertEqual(out1['status'], 'wake_resume')
            self.assertEqual(out1['claim']['phase'], 'WAITING_CI')
            out2 = lean_run.execute_claim(adm, adapters, results_root=td)
            self.assertEqual(out2['claim']['phase'], 'DEV_ACCEPTED_UAT_PENDING')
            self.assertEqual(state['author_calls'], 1)

    def test_no_numeric_repair_ceiling_eight(self):
        """OD-016: live default must not bind an arbitrary productive ceiling."""
        import inspect
        sig = inspect.signature(lean_run.execute_claim)
        self.assertIsNone(sig.parameters['max_repair'].default)

    def test_duplicate_event_no_second_call(self):
        with tempfile.TemporaryDirectory() as td:
            adapters, state = make_flow_adapters(td, shas=[_sha(7)])
            comment, _ = owner_task_comment(issue=502)
            event = {
                'event_name': 'issue_comment',
                'comment': comment,
                'issue': {'number': 502, 'state': 'open'},
                'repository': {'id': REPO_ID},
                'execute': True,
            }
            out1 = lean_run.run_once(event, adapters=adapters, results_root=td)
            self.assertEqual(out1['claim']['phase'], 'DEV_ACCEPTED_UAT_PENDING')
            calls = state['author_calls']
            out2 = lean_run.run_once(event, adapters=adapters, results_root=td)
            self.assertIn(out2['status'], ('duplicate_ignored', 'already_terminal'))
            self.assertEqual(state['author_calls'], calls)

    def test_concurrent_writer_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            FakeRegistry.busy = True
            lease = lean_run.WriterLease(
                1, ['apps/web/src/x.ts'], registry=FakeRegistry,
                lock_dir=str(Path(td) / 'locks'),
                integration_lock=str(Path(td) / 'integration.lock'))
            with self.assertRaises(lean_run.LeanError) as ctx:
                lease.acquire()
            self.assertEqual(ctx.exception.code, 'source_writer_busy')
            FakeRegistry.busy = False

    def test_writer_lease_does_not_open_host_integration_lock(self):
        """Fixtures must never probe /var/lib/.../integration.lock."""
        with tempfile.TemporaryDirectory() as td:
            FakeRegistry.busy = False
            lease = lean_run.WriterLease(
                1, ['apps/web/src/x.ts'], registry=FakeRegistry,
                lock_dir=str(Path(td) / 'locks'))
            lease.acquire()
            lease.release()

    def test_stale_qa_result_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            claim = {
                'candidate_sha': _sha(1),
                'findings_fingerprints': [],
                'task': {},
            }
            path = Path(td) / 'claim.json'
            with self.assertRaises(lean_run.LeanError) as ctx:
                lean_run.apply_qa_result(
                    claim,
                    {'verdict': 'PASS', 'findings': [], 'reviewed_sha': _sha(9)},
                    claim_path=path)
            self.assertEqual(ctx.exception.code, 'stale_sha_verdict')

    def test_unknown_no_replay(self):
        with tempfile.TemporaryDirectory() as td:
            comment, _ = owner_task_comment(issue=503)
            adm = lean_run.admit_comment(
                comment, {'number': 503, 'state': 'open'}, {'id': REPO_ID})
            claim = lean_run.claim_admission(adm, results_root=td)
            path = lean_run.claim_path_for(adm, td)
            lean_run.mark_phase(path, 'UNKNOWN')
            adapters, _ = make_flow_adapters(td)
            with self.assertRaises(lean_run.LeanError) as ctx:
                lean_run.execute_claim(adm, adapters, results_root=td)
            self.assertEqual(ctx.exception.code, 'no_automatic_paid_replay')
            out = lean_run.run_once({'event_name': 'schedule'}, adapters=adapters, results_root=td)
            self.assertEqual(out['status'], 'schedule_reconcile')
            self.assertTrue(out['holds'])


class ProjectQueueTests(unittest.TestCase):
    def test_project_access_not_verified_zero_calls(self):
        with mock.patch.object(lean_live, 'gh_graphql',
                               side_effect=lean_live.LiveError('PROJECT_ACCESS_NOT_VERIFIED', 'auth')):
            result = lean_live.fetch_project_admissions()
        self.assertEqual(result['status'], 'queue_unavailable')
        self.assertEqual(result['code'], 'PROJECT_ACCESS_NOT_VERIFIED')
        self.assertEqual(result['calls'], 0)
        self.assertEqual(result['admissions'], [])

    def test_insufficient_scopes_zero_calls(self):
        with mock.patch.object(lean_live, 'gh_graphql',
                               side_effect=lean_live.LiveError('INSUFFICIENT_SCOPES', 'scope')):
            result = lean_live.fetch_project_admissions()
        self.assertEqual(result['code'], 'INSUFFICIENT_SCOPES')
        self.assertEqual(result['calls'], 0)

    def test_advance_queue_unavailable_no_open_issues_fallback(self):
        with tempfile.TemporaryDirectory() as td:
            adapters, _ = make_flow_adapters(td)

            def boom():
                raise lean_run.LeanError('queue_unavailable', 'PROJECT_ACCESS_NOT_VERIFIED')

            adapters.fetch_admissions = boom
            out = lean_run.advance_queue(adapters, results_root=td, limit=2)
            self.assertEqual(out['status'], 'queue_unavailable')
            self.assertEqual(out['calls'], 0)


class ParserQuotaTests(unittest.TestCase):
    def test_stale_sha_verdict_rejected(self):
        raw = json.dumps({'verdict': 'PASS', 'findings': [], 'reviewed_sha': 'b' * 40})
        with self.assertRaises(providers.ProviderError) as ctx:
            providers.parse_qa_verdict(raw, 'a' * 40, provider='codex_sol_medium')
        self.assertEqual(ctx.exception.code, 'stale_sha_verdict')

    def test_codex_exact_json_no_charge_on_replay(self):
        sha = 'c' * 40
        raw = json.dumps({'verdict': 'FAIL', 'findings': ['x'], 'reviewed_sha': sha})
        result = providers.parse_codex_final(raw, sha)
        self.assertEqual(result['verdict'], 'FAIL')
        self.assertEqual(result['charge'], 'none')

    def test_agy_native_invalid_no_regex_fallback(self):
        sha = 'a' * 40
        raw = b'{"event":"init"}\n{"event":"result"}\n'
        class Boom(Exception):
            pass
        fake = mock.Mock()
        fake.parse_stream.side_effect = Boom('native invalid')
        with mock.patch.object(providers, '_import_native', return_value=fake):
            with self.assertRaises(providers.ProviderError) as ctx:
                providers.parse_qa_verdict(raw, sha, provider='agy_qa')
        self.assertEqual(ctx.exception.code, 'agy_native_invalid_stream')

    def test_agy_parse_stream_tuple(self):
        sha = 'd' * 40
        fake = mock.Mock()
        fake.parse_stream.return_value = (
            {'verdict': 'PASS', 'findings': [], 'reviewed_sha': sha},
            {'event_count': 3},
        )
        with mock.patch.object(providers, '_import_native', return_value=fake):
            result = providers.parse_agy_stream(b'{"event":"init"}', sha)
        self.assertEqual(result['verdict'], 'PASS')
        self.assertEqual(result['evidence']['event_count'], 3)

    def test_quota_and_unknown_retained(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for i in range(5):
                providers.record_agy_charge(368, {'id': f'r{i}'}, charge='charged',
                                            day_utc='2026-10-28', results_root=root)
            with mock.patch.object(providers, 'RESULTS_ROOT', root):
                avail, why, _ = providers.agy_quota_available(368, day_utc='2026-10-28')
            self.assertFalse(avail)
            self.assertEqual(why, 'agy_quota_exhausted')
            providers.record_agy_charge(2, {'id': 'u'}, charge='unknown',
                                        day_utc='2026-10-28', results_root=root)
            with mock.patch.object(providers, 'RESULTS_ROOT', root):
                avail, why, rec = providers.agy_quota_available(2, day_utc='2026-10-28')
            self.assertFalse(avail)
            self.assertGreaterEqual(rec['unknown_calls'], 1)

    def test_landlock_roots_inject_temp_auth_never_probe_srv(self):
        with tempfile.TemporaryDirectory() as td:
            home = Path(td) / 'home'
            scratch = Path(td) / 'scratch'
            auth = Path(td) / 'auth' / 'token'
            auth.parent.mkdir(parents=True)
            auth.write_text('x')
            home.mkdir(); scratch.mkdir()
            # Force host AGY_AUTH.parent.exists to PermissionError if probed.
            real_exists = Path.exists

            def boom(self):
                if str(self).startswith('/srv'):
                    raise PermissionError(13, 'Permission denied', str(self))
                return real_exists(self)

            with mock.patch.object(Path, 'exists', boom):
                ro, wr, ex = providers.build_agy_landlock_roots(
                    td, home, scratch, auth_path=auth)
            self.assertTrue(all(Path(p) != Path('/tmp') for p in wr))
            self.assertIn(home, wr)
            self.assertIn(scratch, wr)
            self.assertIn(auth.parent, ro)

    def test_progress_halt_two_same_fingerprints(self):
        findings = ['missing test for X']
        fp_list = []
        halt, fp = lean_run.progress_halt(fp_list, findings)
        self.assertFalse(halt)
        fp_list.append(fp)
        halt, fp = lean_run.progress_halt(fp_list, findings)
        self.assertFalse(halt)
        fp_list.append(fp)
        halt, fp = lean_run.progress_halt(fp_list, findings)
        self.assertTrue(halt)

    def test_ready_marker_requires_bindings(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / 'agy-qa-ready.json'
            path.write_text(json.dumps({
                'schema': 'GB_LEAN_ROLE_READY_V1', 'phase': 'ready', 'role': 'agy_qa',
            }))
            with mock.patch.object(providers, 'AGY_QA_READY', path):
                ok, reason = providers.role_ready('agy_qa')
            self.assertFalse(ok)


class LiveBindingsTests(unittest.TestCase):
    def test_live_module_exposes_required_functions(self):
        for name in (
            'cursor_author_live', 'codex_qa_live', 'agy_qa_live',
            'publish_push_pr', 'wait_product_ci', 'merge_pr_live',
            'wait_dev_deploy', 'fetch_project_admissions', 'create_task_worktree',
            'build_live_adapters', 'uid1002_preexec',
        ):
            self.assertTrue(callable(getattr(lean_live, name)))

    def test_host_entry_default_uses_live_adapters_mock_boundary(self):
        """Deterministic mock subprocess boundary — no live model/gh calls."""
        with tempfile.TemporaryDirectory() as td:
            adapters, state = make_flow_adapters(td, shas=[_sha(3)])
            admissions = []
            comment, _ = owner_task_comment(issue=720, priority=5)
            adm = lean_run.admit_comment(
                comment, {'number': 720, 'state': 'open'}, {'id': REPO_ID})
            admissions.append(adm)
            adapters.fetch_admissions = lambda: admissions
            with mock.patch.object(lean_run, 'default_live_adapters', return_value=adapters):
                out = lean_run.run_once(
                    {'event_name': 'schedule', 'wake_budget_s': 120},
                    results_root=td, limit=1, use_live_defaults=True)
            self.assertEqual(out['status'], 'advanced')
            self.assertEqual(out['results'][0]['claim']['issue'], 720)
            self.assertEqual(state['author_calls'], 1)

    def test_main_self_check_reports_live_defaults(self):
        code = lean_run.main(['--self-check'])
        self.assertEqual(code, 0)

    def test_run_argv_drop_uid_before_provider(self):
        """Trusted Root path must attach UID1002/NNP preexec; HOME alone is insufficient."""
        seen = {}

        def fake_run(*args, **kwargs):
            seen['preexec_fn'] = kwargs.get('preexec_fn')
            seen['env'] = kwargs.get('env')
            return mock.Mock(returncode=0, stdout='ok\n', stderr='')

        with mock.patch.object(lean_live.os, 'geteuid', return_value=0), \
                mock.patch.object(lean_live.subprocess, 'run', side_effect=fake_run):
            lean_live.run_argv(['/usr/bin/true'], env=lean_live.uid1002_env())
        self.assertTrue(callable(seen.get('preexec_fn')))
        self.assertEqual(seen['env'].get('HOME'), '/home/agentagency-dev')
        # preexec source must drop groups/gid/uid before provider/Git/GH.
        import inspect
        src = inspect.getsource(lean_live.uid1002_preexec)
        self.assertIn('setgroups', src)
        self.assertIn('setuid', src)
        self.assertIn('CURSOR_UID', src)
        self.assertIn('prctl', src)

    def test_dirty_worktree_preserved_hold(self):
        """Existing dirty/unexpected worktree => specific HOLD; no force-remove."""
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td) / 'repo'
            root = Path(td) / 'wt'
            work = root / 'issue-182'
            work.mkdir(parents=True)
            calls = []

            def fake_git(cwd, *args, **kwargs):
                calls.append((str(cwd), list(args)))
                if args and args[0] == 'rev-parse' and 'HEAD' in args:
                    return 'a' * 40
                if args and args[0] == 'status':
                    return ' M apps/web/src/x.ts'
                raise AssertionError('unexpected git ' + str(args))

            removed = []

            def fake_run_argv(argv, **kwargs):
                if 'worktree' in argv and 'remove' in argv:
                    removed.append(list(argv))
                return mock.Mock(returncode=0, stdout='', stderr='')

            with mock.patch.object(lean_live, 'git', side_effect=fake_git), \
                    mock.patch.object(lean_live, 'run_argv', side_effect=fake_run_argv):
                with self.assertRaises(lean_live.LiveError) as ctx:
                    lean_live.create_task_worktree(
                        {'issue': 182, 'base': 'a' * 40}, repo=repo, root=root)
            self.assertEqual(ctx.exception.code, 'worktree_dirty_hold')
            self.assertEqual(removed, [])
            self.assertTrue(work.is_dir())

    def test_unexpected_head_worktree_hold_no_force_remove(self):
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td) / 'repo'
            root = Path(td) / 'wt'
            work = root / 'issue-182'
            work.mkdir(parents=True)

            def fake_git(cwd, *args, **kwargs):
                if args and args[0] == 'rev-parse' and 'HEAD' in args:
                    return 'b' * 40
                if args and args[0] == 'status':
                    return ''
                raise AssertionError(str(args))

            removed = []

            def fake_run_argv(argv, **kwargs):
                if 'remove' in argv:
                    removed.append(list(argv))
                return mock.Mock(returncode=0, stdout='', stderr='')

            with mock.patch.object(lean_live, 'git', side_effect=fake_git), \
                    mock.patch.object(lean_live, 'run_argv', side_effect=fake_run_argv):
                with self.assertRaises(lean_live.LiveError) as ctx:
                    lean_live.create_task_worktree(
                        {'issue': 182, 'base': 'a' * 40}, repo=repo, root=root)
            self.assertEqual(ctx.exception.code, 'worktree_unexpected_head_hold')
            self.assertEqual(removed, [])

    def test_agy_not_ready_falls_back_before_charge_no_bare_cli(self):
        """AGY CANARY/HOLD: not READY => Codex fallback; never bare [agy,--model]."""
        provider, reason, _ = providers.select_qa_provider(
            {'qaroute': ['agy_qa']}, issue=182)
        self.assertEqual(provider, 'codex_sol_medium')
        self.assertEqual(reason, 'agy_not_ready_fallback')
        # live.agy_qa_live must not contain unsupported bare CLI product launch.
        import inspect
        src = inspect.getsource(lean_live.agy_qa_live)
        self.assertIn('agy_not_ready_fallback', src)
        self.assertIn('product_run_qa_absent_no_bare_cli', src)
        self.assertNotIn("[AGY_CLI, '--model', AGY_MODEL]", src)
        self.assertNotIn('[AGY_CLI, "--model", AGY_MODEL]', src)

    def test_codex_completion_requires_exit_and_turn_completed(self):
        """Exact QA completion: exit0 + turn.completed + SHA; timeout => no replay."""
        self.assertFalse(lean_live._codex_turn_completed(Path('/no/such/events.jsonl')))
        with tempfile.TemporaryDirectory() as td:
            events = Path(td) / 'events.jsonl'
            events.write_text('{"type":"thread.started"}\n')
            self.assertFalse(lean_live._codex_turn_completed(events))
            # Negative: malformed / alias / nested strings must not qualify even
            # with a PASS-looking final line in the same stream.
            events.write_text(
                '{"type":"thread.started"}\n'
                'PREFIX turn.completed SUFFIX not-json\n'
                '{"type":"turn_completed"}\n'
                '{"event":"turn.completed"}\n'
                '{"type":"foo.turn.completed"}\n'
                '{"item":{"type":"turn.completed"}}\n'
                '{"verdict":"PASS","findings":[],"reviewed_sha":"' + ('a' * 40) + '"}\n')
            self.assertFalse(lean_live._codex_turn_completed(events))
            # Positive: genuine JSON event type exactly turn.completed.
            events.write_text(
                '{"type":"thread.started"}\n'
                '{"type":"turn.completed","usage":{"input_tokens":1}}\n')
            self.assertTrue(lean_live._codex_turn_completed(events))
        # Timeout path marks UNKNOWN / no blind replay in source.
        import inspect
        src = inspect.getsource(lean_live.codex_qa_live)
        self.assertIn('no_blind_replay', src)
        self.assertIn('_kill_owned_process_group', src)
        self.assertIn('turn_completed', src)
        self.assertIn('gpt-6.1-sol', src)
        self.assertIn('qa_head_mismatch', src)
        self.assertNotIn("checkout', '--detach'", src)
        self.assertIn("HOME': str(AGENT_HOME)", src)
        self.assertIn('NATIVE_CODEX_HOME', src)
        self.assertIn("str(NATIVE_CODEX_HOME): 'deny'", src)
        self.assertIn("str(AGENT_HOME / '.ssh'): 'deny'", src)
        self.assertEqual(lean_live.MODE_A_RULES, lean_live.PACKAGE_ROOT / 'AGENTS.md')
        self.assertIn('parents[2]', inspect.getsource(lean_live))
        rules_src = inspect.getsource(lean_live.load_short_rules)
        self.assertIn('AGENTS.md', rules_src)
        self.assertIn('mode_a_rules_absent', rules_src)
        self.assertIn('load_short_rules', inspect.getsource(lean_live.cursor_author_live))


class HostRequestTests(unittest.TestCase):
    def _base(self):
        return {
            'action': 'lean', 'run_id': 1, 'run_attempt': 1,
            'repository': REPO, 'repository_id': REPO_ID,
            'actor_id': OWNER, 'ref': 'refs/heads/main',
            'event_name': 'workflow_dispatch',
            'workflow_sha': 'a' * 64, 'client_sha': 'b' * 40, 'status': 'queued',
        }

    def test_rejects_shell_and_arbitrary_paths(self):
        base = self._base()
        with self.assertRaises(lean_host.HostRefused):
            lean_host.validate_request(dict(base, command='id'))
        with self.assertRaises(lean_host.HostRefused):
            lean_host.validate_request(dict(base, source_path='/tmp/x'))
        lean_host.validate_request(base)

    def test_client_sha_required(self):
        base = self._base()
        del base['client_sha']
        with self.assertRaises(lean_host.HostRefused):
            lean_host.validate_request(base)

    def test_commissioning_field_refused(self):
        base = self._base()
        with self.assertRaises(lean_host.HostRefused):
            lean_host.validate_request(dict(base, commissioning=True))

    def test_verify_github_run_rejects_absent(self):
        base = self._base()
        with self.assertRaises(lean_host.HostRefused):
            lean_host.verify_github_run(base, api_fetch=None)

    def test_verify_github_run_fresh_fields(self):
        base = self._base()
        def api(path):
            return {
                'id': 1, 'run_attempt': 1, 'path': lean_host.WORKFLOW_PATH,
                'status': 'in_progress', 'event': 'workflow_dispatch',
                'repository': {'id': REPO_ID}, 'head_repository': {'id': REPO_ID},
                'actor': {'id': OWNER}, 'head_sha': 'b' * 40,
            }
        verified = lean_host.verify_github_run(base, api_fetch=api)
        self.assertTrue(verified['verified'])
        self.assertEqual(verified['run']['path'], lean_host.WORKFLOW_PATH)

    def test_verify_rejects_wrong_workflow_path(self):
        base = self._base()
        def api(path):
            return {
                'id': 1, 'run_attempt': 1, 'path': '.github/workflows/other.yml',
                'status': 'in_progress', 'event': 'workflow_dispatch',
                'repository': {'id': REPO_ID}, 'head_repository': {'id': REPO_ID},
                'actor': {'id': OWNER},
            }
        with self.assertRaises(lean_host.HostRefused):
            lean_host.verify_github_run(base, api_fetch=api)


class InstallPointerTests(unittest.TestCase):
    def test_point_current_regular_file_not_symlink(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            releases = root / 'releases'
            sha = 'a' * 40
            dest = releases / sha
            host = dest / 'tools/train/host.py'
            host.parent.mkdir(parents=True)
            host.write_text('#!/usr/bin/env python3\n')
            current = root / 'current'
            current.write_text(sha + '\n')
            self.assertTrue(current.is_file())
            self.assertFalse(current.is_symlink())
            self.assertEqual(current.read_text().strip(), sha)
            resolved = releases / sha / 'tools/train/host.py'
            self.assertTrue(resolved.is_file())
            self.assertFalse(resolved.is_symlink())

    def test_live_py_in_install_files(self):
        import install as lean_inst
        self.assertIn('tools/train/live.py', lean_inst.INSTALL_FILES)
        self.assertIn('AGENTS.md', lean_inst.INSTALL_FILES)
        # git_blob drops to UID1002; no Root Git / safe.directory / chown repo.
        import inspect
        blob_src = inspect.getsource(lean_inst.git_blob)
        self.assertIn('setuid', blob_src)
        self.assertIn('65042', blob_src)
        self.assertIn('--no-replace-objects', blob_src)
        self.assertIn('core.hooksPath=/dev/null', blob_src)
        self.assertNotIn('safe.directory', blob_src)
        cfg_src = inspect.getsource(lean_inst.write_config)
        self.assertIn('OD018_PROSPECTIVE_DEV', cfg_src)
        self.assertNotIn("'issue_182': 'OFF'", cfg_src)
        self.assertIn('mode_b_active', cfg_src)
        # Import refuses symlink parents before atomic replace.
        import_src = inspect.getsource(lean_live.cursor_author_live)
        self.assertIn('symlink_import_refused', import_src)
        self.assertIn('is_symlink()', import_src)


class MonitorTests(unittest.TestCase):
    def test_dead_worker_not_running(self):
        proj = lean_mon.build_projection(
            claim={'phase': 'RUNNING', 'issue': 1, 'stage': 'author'},
            worker={'pid': 999999, 'alive': False},
            config={'enabled': True, 'commissioning': True, 'mode_b_active': False},
        )
        self.assertEqual(proj['phase'], 'WORKER_DEAD_RUNNING')
        self.assertFalse(proj['worker']['alive'])
        self.assertFalse(proj['mode_b_active'])
        self.assertIn('ordered_backlog', proj)

    def test_write_projection_refuses_unrelated_path(self):
        with tempfile.TemporaryDirectory() as td:
            out = lean_mon.write_projection(Path(td) / 'pma-private.json', claim=None)
            self.assertEqual(out['status'], 'refused')


class NextReadyTests(unittest.TestCase):
    def test_continues_independent_while_uat_pending(self):
        a = {'issue': 1, 'task': {'dependencies': [], 'priority': 1}}
        b = {'issue': 2, 'task': {'dependencies': [], 'priority': 5}}
        nxt = lean_run.pick_next_ready([a, b], uat_pending={1})
        self.assertEqual(nxt['issue'], 2)


class AuthorClaimsTests(unittest.TestCase):
    def test_author_pass_claims_one_launch_not_ready(self):
        self.assertFalse(providers.AUTHOR_PASS_CLAIMS['agy_qa_ready'])
        self.assertFalse(providers.AUTHOR_PASS_CLAIMS['agy_author_ready'])
        self.assertFalse(providers.AUTHOR_PASS_CLAIMS['mode_b_active'])
        self.assertEqual(providers.AUTHOR_PASS_CLAIMS['cursor_author_launches'], 1)
        self.assertEqual(providers.AUTHOR_PASS_CLAIMS['nested_agy_codex_model_calls'], 0)
        self.assertEqual(providers.AUTHOR_PASS_CLAIMS['model_calls'], 1)


class DeployAcceptanceTests(unittest.TestCase):
    def test_accepted_receipt_not_stdout(self):
        with self.assertRaises(lean_run.LeanError):
            lean_run.recover_publication('deploy', deploy_run=1, receipt=None, live_sha='a' * 40)
        ok = lean_run.recover_publication(
            'deploy', deploy_run=99,
            receipt={'status': 'ACCEPTED', 'line': 'ACCEPTED'},
            live_sha='a' * 40)
        self.assertTrue(ok['accepted'])


if __name__ == '__main__':
    os.chdir(Path(__file__).resolve().parent)
    unittest.main()

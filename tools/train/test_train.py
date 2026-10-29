#!/usr/bin/env python3
"""Proportionate deterministic tests for Lean Mode B (OD-017/OD-018).

Exercises the real run_once controller with mocked external adapters — not a
parallel demo. Covers: two eligible Project-style tasks auto-next; stale/park/OFF
exclusion; QA FAIL→repair→new SHA; distinct candidate/merge SHA; duplicate events;
concurrent writer; UNKNOWN no replay; CI repairable FAIL→author findings; wake
deadline resume; Project queue_unavailable zero calls; live default binding
presence via mock subprocess boundary (no live calls); parser; quota; landlock
fixtures with injected temp auth path (never probe host /srv); host request gates;
frozen worktree/base once; author-attempt evidence; HTTPS FF publish fields.
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

import base64
import hashlib
import inspect

import providers
import run as lean_run
import host as lean_host
import client as lean_client
import monitor as lean_mon
import live as lean_live
import install as lean_install


OWNER = 318610566
ACTIONS_BOT = 41898282
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
                       ci_fail_once=False, wait_ci_once=False, frozen_base=None):
    """Mocked adapters exercising the real execute_claim path.

    Injects temp lock_dir + integration_lock under td — never host-protected paths.
    Tracks worktree create vs reuse and evidence paths for OD018 seam regressions.
    """
    shas = list(shas or [_sha(1), _sha(2), _sha(3)])
    base_sha = frozen_base or _sha(100)
    state = {
        'author_i': 0, 'qa_calls': 0, 'author_calls': 0, 'publish_calls': 0,
        'merge_calls': 0, 'ci_calls': 0, 'author_findings': [],
        'worktree_calls': 0, 'validate_calls': 0, 'frozen_base': base_sha,
        'heads': {}, 'preqa_bases': [], 'preqa_worktrees': [],
        'qa_worktrees': [], 'qa_bases': [], 'qa_evidence_dirs': [],
        'author_evidence_dirs': [], 'publish_payloads': [],
    }
    integ = Path(td) / 'integration.lock'
    integ.write_text('test')
    locks = Path(td) / 'locks'
    locks.mkdir(exist_ok=True)

    def worktree(task):
        state['worktree_calls'] += 1
        path = str(Path(td) / 'wt' / str(task['issue']))
        Path(path).mkdir(parents=True, exist_ok=True)
        state['heads'].setdefault(path, state['frozen_base'])
        return path

    def read_head(wt):
        return state['heads'].get(str(wt), state['frozen_base'])

    def validate_worktree(work, *, expected_head=None):
        state['validate_calls'] += 1
        head = state['heads'].get(str(work), state['frozen_base'])
        if expected_head and head != expected_head:
            raise lean_run.LeanError('worktree_unexpected_head_hold',
                                     f'{head}!={expected_head}')
        return head

    def author(**kwargs):
        state['author_calls'] += 1
        task = kwargs.get('task') or {}
        state['author_findings'].append(list(task.get('repair_findings') or []))
        ev = kwargs.get('evidence_dir')
        if ev:
            state['author_evidence_dirs'].append(str(ev))
            Path(ev).mkdir(parents=True, exist_ok=True)
            # Simulate exclusive raw create (stream.jsonl xb semantics).
            raw = Path(ev) / 'stream.jsonl'
            if raw.exists():
                raise FileExistsError(str(raw))
            raw.write_text('{"type":"test"}\n')
            (Path(ev) / 'author-intent.json').write_text('{"phase":"completed"}\n')
        i = min(state['author_i'], len(shas) - 1)
        sha = shas[i]
        state['author_i'] += 1
        wt = str(kwargs.get('worktree') or '')
        if wt:
            state['heads'][wt] = sha
        return {'candidate_sha': sha, 'changed_paths': ['apps/web/src/x.ts']}

    def qa(claim):
        state['qa_calls'] += 1
        sha = claim['candidate_sha']
        state['qa_worktrees'].append(claim.get('worktree'))
        state['qa_bases'].append(claim.get('base_sha'))
        state['qa_evidence_dirs'].append(claim.get('evidence_dir'))
        if fail_qa_once and state['qa_calls'] == 1:
            return {'verdict': 'FAIL', 'findings': ['missing test for X'],
                    'reviewed_sha': sha, 'charge': 'charged'}
        return {'verdict': 'PASS', 'findings': [], 'reviewed_sha': sha, 'charge': 'charged'}

    def publish(kind=None, payload=None, intent_path=None, **_):
        state['publish_calls'] += 1
        state['publish_payloads'].append(dict(payload or {}))
        if kind == 'merge_dev':
            return merge(kind=kind, payload=payload)
        branch = (payload or {}).get('publication_branch') or (
            f"automation/issue-{(payload or {}).get('issue')}")
        return {'pr': int((payload or {}).get('existing_pr') or (1000 + int(payload['issue']))),
                'head_sha': payload['sha'], 'branch': branch}

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
        state['preqa_bases'].append(base)
        state['preqa_worktrees'].append(str(worktree))
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
        read_head=read_head,
        validate_worktree=validate_worktree,
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

    def test_fetch_admissions_scans_past_stale_182_to_latest_valid(self):
        """Old pre-OD018 machine comment must not hide a later valid admission."""
        old, _ = owner_task_comment(
            issue=182, owner_authority_comment=lean_run.OD018_SIGNED_COMMENT_ID)
        new, _ = owner_task_comment(
            issue=182, owner_authority_comment=lean_run.OD018_SIGNED_COMMENT_ID)
        new['id'] = lean_run.OD018_SIGNED_COMMENT_ID + 100
        signed = {
            'id': lean_run.OD018_SIGNED_COMMENT_ID,
            'user': {'id': lean_live.OWNER_ID},
            'body': 'OD-018 Supersedes old OFF for guarded DEV; no PROD',
        }
        projection = {
            'items': [{'issue': 182, 'status': 'ready', 'state': 'OPEN', 'priority': 300}],
            'holds': [],
        }
        with mock.patch.object(lean_live, 'read_canonical_project', return_value=projection), \
                mock.patch.object(lean_live, 'gh_api', return_value=[old, signed, new]):
            result = lean_live.fetch_project_admissions()
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(len(result['admissions']), 1)
        self.assertEqual(result['admissions'][0]['comment_id'], new['id'])
        stale_holds = [
            h for h in result['holds']
            if 'issue_182_stale_machine_comment' in str(h.get('reason'))]
        self.assertTrue(stale_holds)
        # Same new admission alone still admits.
        with mock.patch.object(lean_live, 'read_canonical_project', return_value=projection), \
                mock.patch.object(lean_live, 'gh_api', return_value=[signed, new]):
            alone = lean_live.fetch_project_admissions()
        self.assertEqual(len(alone['admissions']), 1)

    def test_fetch_admissions_wrong_owner_hold_or_only_stale_zero_eligible(self):
        projection = {
            'items': [{'issue': 182, 'status': 'ready', 'state': 'OPEN', 'priority': 300}],
            'holds': [],
        }
        signed = {
            'id': lean_run.OD018_SIGNED_COMMENT_ID,
            'user': {'id': lean_live.OWNER_ID},
            'body': 'OD-018 Supersedes old OFF for guarded DEV; no PROD',
        }
        # Only stale machine comment → zero eligible (history retained via holds).
        old, _ = owner_task_comment(
            issue=182, owner_authority_comment=lean_run.OD018_SIGNED_COMMENT_ID)
        with mock.patch.object(lean_live, 'read_canonical_project', return_value=projection), \
                mock.patch.object(lean_live, 'gh_api', return_value=[old, signed]):
            only_stale = lean_live.fetch_project_admissions()
        self.assertEqual(only_stale['admissions'], [])
        # Wrong Owner user id on machine marker → skipped; zero eligible.
        wrong, _ = owner_task_comment(
            issue=182, owner_authority_comment=lean_run.OD018_SIGNED_COMMENT_ID)
        wrong['id'] = lean_run.OD018_SIGNED_COMMENT_ID + 100
        wrong['user'] = {'id': 1, 'login': 'not-owner'}
        with mock.patch.object(lean_live, 'read_canonical_project', return_value=projection), \
                mock.patch.object(lean_live, 'gh_api', return_value=[signed, wrong]):
            bad_owner = lean_live.fetch_project_admissions()
        self.assertEqual(bad_owner['admissions'], [])
        # Real Owner HOLD marker blocks even a fresh-looking admission id.
        hold_cmt = {
            'id': lean_run.OD018_SIGNED_COMMENT_ID + 50,
            'user': {'id': lean_live.OWNER_ID},
            'body': 'GOBADMINTON_LEAN_HOLD owner stop',
        }
        fresh, _ = owner_task_comment(
            issue=182, owner_authority_comment=lean_run.OD018_SIGNED_COMMENT_ID)
        fresh['id'] = lean_run.OD018_SIGNED_COMMENT_ID + 200
        with mock.patch.object(lean_live, 'read_canonical_project', return_value=projection), \
                mock.patch.object(lean_live, 'gh_api',
                                  return_value=[signed, hold_cmt, fresh]):
            held = lean_live.fetch_project_admissions()
        self.assertEqual(held['admissions'], [])


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
            # OD-020: no artificial day/5 cap by default.
            with mock.patch.object(providers, 'RESULTS_ROOT', root):
                avail, why, rec = providers.agy_quota_available(368, day_utc='2026-10-28')
            self.assertTrue(avail)
            self.assertEqual(why, 'ok')
            self.assertTrue(rec.get('od020_no_artificial_cap'))
            # Historical explicit limit still exhausts when tests pass limit=5.
            with mock.patch.object(providers, 'RESULTS_ROOT', root):
                avail, why, _ = providers.agy_quota_available(
                    368, limit=5, day_utc='2026-10-28')
            self.assertFalse(avail)
            self.assertEqual(why, 'agy_quota_exhausted')
            providers.record_agy_charge(2, {'id': 'u'}, charge='unknown',
                                        day_utc='2026-10-28', results_root=root)
            with mock.patch.object(providers, 'RESULTS_ROOT', root):
                avail, why, rec = providers.agy_quota_available(2, day_utc='2026-10-28')
            self.assertFalse(avail)
            self.assertEqual(why, 'agy_quota_unknown_pending_reconcile')
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
        """Incomplete lean marker stays not-ready; isolate real native role proof."""
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / 'agy-qa-ready.json'
            path.write_text(json.dumps({
                'schema': 'GB_LEAN_ROLE_READY_V1', 'phase': 'ready', 'role': 'agy_qa',
            }))
            # Negative case: real host product_role_ready must not leak into this unit.
            fake_native = mock.Mock()
            fake_native.product_role_ready.return_value = False
            with mock.patch.object(providers, 'AGY_QA_READY', path), \
                    mock.patch.object(providers, '_import_native', return_value=fake_native):
                ok, reason = providers.role_ready('agy_qa')
            self.assertFalse(ok)
            fake_native.product_role_ready.assert_called()


def _git_repo(path, *, branch='dev'):
    """Minimal temp git repo for deterministic worktree/base regressions."""
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    env = {
        'PATH': '/usr/bin:/bin', 'HOME': str(path / '.home'),
        'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null',
        'GIT_OPTIONAL_LOCKS': '0', 'GIT_TERMINAL_PROMPT': '0',
    }
    (path / '.home').mkdir(exist_ok=True)

    def g(*args):
        import subprocess
        return subprocess.run(
            ['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', *args],
            cwd=str(path), env=env, text=True, capture_output=True, check=True, timeout=30,
        )

    g('init', '-b', branch)
    g('config', 'user.name', 'test')
    g('config', 'user.email', 'test@localhost')
    (path / 'README').write_text('base\n')
    g('add', 'README')
    g('commit', '-m', 'base')
    head = g('rev-parse', 'HEAD').stdout.strip()
    return head, g, env


class Od018LifecycleSeamTests(unittest.TestCase):
    """Addressed regressions for confirmed Mode B controller/live seams."""

    def test_frozen_base_worktree_reaches_preqa_qa_without_second_create(self):
        with tempfile.TemporaryDirectory() as td:
            adapters, state = make_flow_adapters(td, shas=[_sha(1)])
            comment, _ = owner_task_comment(issue=801)
            adm = lean_run.admit_comment(
                comment, {'number': 801, 'state': 'open'}, {'id': REPO_ID})
            out = lean_run.execute_claim(adm, adapters, results_root=td)
            self.assertEqual(out['claim']['phase'], 'DEV_ACCEPTED_UAT_PENDING')
            self.assertEqual(state['worktree_calls'], 1)
            self.assertEqual(out['claim']['base_sha'], state['frozen_base'])
            self.assertEqual(state['preqa_bases'], [state['frozen_base']])
            self.assertEqual(state['qa_bases'], [state['frozen_base']])
            self.assertEqual(state['preqa_worktrees'], [out['claim']['worktree']])
            self.assertEqual(state['qa_worktrees'], [out['claim']['worktree']])
            self.assertNotEqual(out['claim']['base_sha'], '0' * 40)

    def test_qa_fail_repair_preserves_first_raw_and_same_base(self):
        with tempfile.TemporaryDirectory() as td:
            adapters, state = make_flow_adapters(
                td, fail_qa_once=True, shas=[_sha(1), _sha(2)])
            comment, _ = owner_task_comment(issue=802)
            adm = lean_run.admit_comment(
                comment, {'number': 802, 'state': 'open'}, {'id': REPO_ID})
            out = lean_run.execute_claim(adm, adapters, results_root=td)
            self.assertEqual(out['claim']['phase'], 'DEV_ACCEPTED_UAT_PENDING')
            self.assertEqual(state['author_calls'], 2)
            self.assertEqual(state['worktree_calls'], 1)
            self.assertEqual(out['claim']['base_sha'], state['frozen_base'])
            self.assertEqual(state['preqa_bases'], [state['frozen_base'], state['frozen_base']])
            self.assertEqual(len(state['author_evidence_dirs']), 2)
            self.assertNotEqual(state['author_evidence_dirs'][0], state['author_evidence_dirs'][1])
            first = Path(state['author_evidence_dirs'][0])
            second = Path(state['author_evidence_dirs'][1])
            self.assertTrue((first / 'stream.jsonl').is_file())
            self.assertTrue((second / 'stream.jsonl').is_file())
            self.assertIn('author-attempt-1', str(first))
            self.assertIn('author-attempt-2', str(second))
            # First raw preserved (not overwritten by repair).
            self.assertEqual((first / 'stream.jsonl').read_text(), '{"type":"test"}\n')

    def test_second_issue_after_dev_merge_resolves_fresh_base(self):
        with tempfile.TemporaryDirectory() as td:
            adapters, state = make_flow_adapters(td, shas=[_sha(11), _sha(22)])
            # First issue completes DEV; second must resolve its own worktree once.
            for issue, prio in ((811, 20), (812, 10)):
                comment, _ = owner_task_comment(issue=issue, priority=prio)
                adm = lean_run.admit_comment(
                    comment, {'number': issue, 'state': 'open'}, {'id': REPO_ID})
                out = lean_run.execute_claim(adm, adapters, results_root=td)
                self.assertEqual(out['claim']['phase'], 'DEV_ACCEPTED_UAT_PENDING')
            self.assertEqual(state['worktree_calls'], 2)
            self.assertEqual(state['author_calls'], 2)
            bases = state['preqa_bases']
            self.assertEqual(len(bases), 2)
            self.assertTrue(all(b == state['frozen_base'] for b in bases))

    def test_temp_git_create_once_candidate_head_reused(self):
        """Real temp git: create at origin/dev, author moves HEAD, preqa reuses."""
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td) / 'repo'
            wt_root = Path(td) / 'wt'
            base, g, env = _git_repo(repo)
            # Simulate origin/dev for create_task_worktree fetch/rev-parse path.
            g('remote', 'add', 'origin', str(repo))
            g('update-ref', 'refs/remotes/origin/dev', base)

            # create from missing task.base → origin/dev.
            with mock.patch.object(lean_live, 'git') as git_mock:
                def git_side(cwd, *args, **kwargs):
                    import subprocess
                    proc = subprocess.run(
                        ['/usr/bin/git', '-c', 'core.hooksPath=/dev/null',
                         '-c', 'core.fsmonitor=false', *args],
                        cwd=str(cwd), env=env, text=True, capture_output=True,
                        check=True, timeout=30)
                    return (proc.stdout or '').strip()

                git_mock.side_effect = git_side
                real_run = lean_live.run_argv

                def run_side(argv, **kwargs):
                    if argv and argv[0] == '/usr/bin/git':
                        # Drop UID may fail in unit env — run without preexec.
                        kwargs = dict(kwargs)
                        kwargs['drop_uid'] = False
                        if kwargs.get('env'):
                            e = dict(kwargs['env'])
                            e['HOME'] = str(repo / '.home')
                            kwargs['env'] = e
                    return real_run(argv, **kwargs)

                with mock.patch.object(lean_live, 'run_argv', side_effect=run_side), \
                        mock.patch.object(lean_live, 'require_executor_uid', return_value=0), \
                        mock.patch.object(lean_live.os, 'geteuid', return_value=1002):
                    wt = lean_live.create_task_worktree(
                        {'issue': 901}, repo=repo, root=wt_root)
                    head1 = lean_live.git(wt, 'rev-parse', 'HEAD')
                    self.assertEqual(head1, base)
                    # Author commit advances HEAD past base.
                    f = Path(wt) / 'apps' / 'x.ts'
                    f.parent.mkdir(parents=True, exist_ok=True)
                    f.write_text('x\n')
                    lean_live.git(wt, 'add', '--', 'apps/x.ts')
                    lean_live.git(
                        wt, '-c', 'user.name=t', '-c', 'user.email=t@localhost',
                        '-c', 'commit.gpgsign=false', 'commit', '-m', 'cand')
                    cand = lean_live.git(wt, 'rev-parse', 'HEAD')
                    self.assertNotEqual(cand, base)
                    # Reuse with expected candidate — must NOT hold / recreate.
                    wt2 = lean_live.create_task_worktree(
                        {'issue': 901, 'base': base, 'expected_head': cand,
                         'candidate_sha': cand},
                        repo=repo, root=wt_root)
                    self.assertEqual(wt2, wt)
                    self.assertEqual(lean_live.git(wt2, 'rev-parse', 'HEAD'), cand)
                    # Wrong expected head still HOLDs.
                    with self.assertRaises(lean_live.LiveError) as ctx:
                        lean_live.create_task_worktree(
                            {'issue': 901, 'base': base}, repo=repo, root=wt_root)
                    self.assertEqual(ctx.exception.code, 'worktree_unexpected_head_hold')

    def test_publish_propagates_publication_branch_and_existing_pr(self):
        with tempfile.TemporaryDirectory() as td:
            adapters, state = make_flow_adapters(td, shas=[_sha(7)])
            comment, task = owner_task_comment(
                issue=182,
                owner_authority_comment=lean_run.OD018_SIGNED_COMMENT_ID,
                publication_branch='mode-a/182-friend-recommendations',
                existing_pr=367,
            )
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
            comment['id'] = lean_run.OD018_SIGNED_COMMENT_ID + 50
            adm = lean_run.admit_comment(
                comment, {'number': 182, 'state': 'open'}, {'id': REPO_ID},
                all_comments=[signed, comment])
            out = lean_run.execute_claim(adm, adapters, results_root=td)
            self.assertEqual(out['claim']['phase'], 'DEV_ACCEPTED_UAT_PENDING')
            self.assertTrue(state['publish_payloads'])
            pub = state['publish_payloads'][0]
            self.assertEqual(pub.get('publication_branch'),
                             'mode-a/182-friend-recommendations')
            self.assertEqual(int(pub.get('existing_pr')), 367)
            self.assertEqual(out['claim'].get('publication_branch'),
                             'mode-a/182-friend-recommendations')

    def test_publish_push_pr_no_force_uses_https_helper(self):
        import inspect
        src = inspect.getsource(lean_live.publish_push_pr)
        helper = inspect.getsource(lean_live._git_https_argv)
        # Body must not invoke force/reset (ignore prose in docstring).
        body = src.split('"""', 2)[-1]
        self.assertNotIn('--force-with-lease', body)
        self.assertNotIn("checkout', '-B'", body)
        self.assertNotIn('checkout", "-B"', body)
        self.assertIn('gh auth git-credential', helper)
        self.assertIn('_git_https_argv', src)
        self.assertIn('publication_branch', src)
        self.assertIn('existing_pr', src)
        self.assertIn('remote_branch_unexpected_sha_hold', src)
        self.assertIn('https://github.com/', inspect.getsource(lean_live._https_origin_url))
        # No permanent Issue→branch hardcode table.
        self.assertNotIn('mode-a/182-friend-recommendations', src)

    def test_preqa_uses_live_git_not_root_subprocess(self):
        import inspect
        src = inspect.getsource(lean_run.deterministic_preqa_diff)
        body = src.split('"""', 2)[-1]
        self.assertIn('lean_live.git', src)
        self.assertNotIn('subprocess.run', body)
        self.assertNotIn('safe.directory', body)
        self.assertIn('preqa_base_sha_required', src)


class LiveBindingsTests(unittest.TestCase):
    def test_live_module_exposes_required_functions(self):
        for name in (
            'cursor_author_live', 'codex_qa_live', 'agy_qa_live',
            'publish_push_pr', 'wait_product_ci', 'merge_pr_live',
            'wait_dev_deploy', 'fetch_project_admissions', 'create_task_worktree',
            'build_live_adapters', 'uid1002_preexec', 'validate_frozen_worktree',
            'resolve_task_worktree',
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
                # wake_budget must cover AUTHOR_TIMEOUT+margin and QA_TIMEOUT+margin
                out = lean_run.run_once(
                    {'event_name': 'schedule', 'wake_budget_s': 2400},
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
        # Isolate real qualified native proof — negative unit must not see host READY.
        fake_native = mock.Mock()
        fake_native.product_role_ready.return_value = False
        with mock.patch.object(providers, '_import_native', return_value=fake_native), \
                mock.patch.object(providers, 'AGY_QA_READY', Path('/no/such/agy-qa-ready.json')):
            provider, reason, _ = providers.select_qa_provider(
                {'qaroute': ['agy_qa']}, issue=182)
        self.assertEqual(provider, 'codex_sol_medium')
        self.assertEqual(reason, 'agy_not_ready_fallback')
        # live.agy_qa_live binds native.invoke(product=True); never product_run_qa/bare CLI.
        src = inspect.getsource(lean_live.agy_qa_live)
        self.assertIn('agy_not_ready_fallback', src)
        self.assertIn('native_invoke_product', src)
        self.assertIn('product=True', inspect.getsource(lean_live._agy_product_invoke))
        self.assertNotIn('native.product_run_qa', src)
        self.assertNotIn('product_run_qa(', src)
        self.assertNotIn("[AGY_CLI, '--model', AGY_MODEL]", src)
        self.assertNotIn('[AGY_CLI, "--model", AGY_MODEL]', src)
        inv = inspect.getsource(lean_live._agy_product_invoke)
        self.assertNotIn('pickle.load', inv)
        self.assertNotIn('pickle.dump', inv)
        self.assertIn('_agy_ipc_pack', inv)
        self.assertIn('_agy_materialize_qa_snapshot', src)

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
        # umask 077 Root evidence: CLI -o final under private 1002 TMPDIR, parent collects.
        self.assertIn('final_private', src)
        self.assertIn("tmpdir / 'final.txt'", src)
        self.assertNotIn("'-o', str(evidence / 'final.txt')", src)
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
            'dispatch_action': 'status',
        }

    def _run_payload(self, **overrides):
        payload = {
            'id': 1, 'run_attempt': 1, 'path': lean_host.WORKFLOW_PATH,
            'status': 'in_progress', 'event': 'workflow_dispatch',
            'repository': {'id': REPO_ID}, 'head_repository': {'id': REPO_ID},
            'actor': {'id': OWNER}, 'head_sha': 'b' * 40, 'head_branch': 'main',
        }
        payload.update(overrides)
        return payload

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
            self.assertIn('/actions/runs/', path)
            return self._run_payload()

        verified = lean_host.verify_github_run(base, api_fetch=api)
        self.assertTrue(verified['verified'])
        self.assertEqual(verified['run']['path'], lean_host.WORKFLOW_PATH)
        self.assertEqual(verified['run']['ref'], 'main')
        self.assertEqual(verified['run']['head_sha'], 'b' * 40)

    def test_verify_rejects_wrong_workflow_path(self):
        base = self._base()

        def api(path):
            return self._run_payload(path='.github/workflows/other.yml')

        with self.assertRaises(lean_host.HostRefused):
            lean_host.verify_github_run(base, api_fetch=api)

    def test_default_gh_api_fetch_uses_uid1002_drop(self):
        """Trusted live.gh_api/uid1002 path — never Root HOME gh profile."""
        src = inspect.getsource(lean_host.default_gh_api_fetch)
        self.assertIn('ensure_same_release_train_import', src)
        self.assertIn('gh_api', src)
        self.assertIn('sys.path.insert', inspect.getsource(lean_host.ensure_same_release_train_import))
        seen = {}

        def fake_gh(path, **kwargs):
            seen['path'] = path
            seen['env'] = lean_live.uid1002_env()
            return {'ok': True, 'id': 9}

        with mock.patch.object(lean_live, 'gh_api', side_effect=fake_gh):
            out = lean_host.default_gh_api_fetch('repos/x')
        self.assertEqual(out['id'], 9)
        self.assertEqual(seen['path'], 'repos/x')
        self.assertEqual(seen['env']['HOME'], '/home/agentagency-dev')
        self.assertEqual(seen['env']['GH_CONFIG_DIR'], '/home/agentagency-dev/.config/gh')
        self.assertNotIn('GITHUB_TOKEN', seen['env'])
        drop_src = inspect.getsource(lean_live.uid1002_preexec)
        self.assertIn('65042', drop_src)
        self.assertIn('setuid', drop_src)

    def test_forged_actor_event_ref_workflow_refused(self):
        base = self._base()

        def bad_actor(path):
            return self._run_payload(actor={'id': 1})

        with self.assertRaises(lean_host.HostRefused):
            lean_host.verify_github_run(base, api_fetch=bad_actor)

        def actor_or_fallback_trap(path):
            # Wrong actual actor must fail even if request.actor_id is trusted.
            return self._run_payload(actor={'id': ACTIONS_BOT})

        with self.assertRaises(lean_host.HostRefused):
            lean_host.verify_github_run(base, api_fetch=actor_or_fallback_trap)

        def bad_event(path):
            return self._run_payload(event='schedule')

        with self.assertRaises(lean_host.HostRefused):
            lean_host.verify_github_run(base, api_fetch=bad_event)

        def bad_ref(path):
            return self._run_payload(head_branch='feature/x')

        with self.assertRaises(lean_host.HostRefused):
            lean_host.verify_github_run(base, api_fetch=bad_ref)

        def completed_replay(path):
            return self._run_payload(status='completed')

        with self.assertRaises(lean_host.HostRefused):
            lean_host.verify_github_run(base, api_fetch=completed_replay)

        workflow_bytes = b'name: lean-delivery\non: workflow_dispatch\n'
        good_hash = hashlib.sha256(workflow_bytes).hexdigest()
        release = 'b' * 40
        req = dict(base, workflow_sha=good_hash, client_sha=release)

        def contents_api(path):
            if '/contents/' in path:
                self.assertIn('ref=' + ('c' * 40), path)
                self.assertIn(lean_host.WORKFLOW_PATH, path)
                return {
                    'encoding': 'base64',
                    'content': base64.b64encode(workflow_bytes).decode(),
                }
            raise AssertionError(path)

        with mock.patch.object(lean_host, 'installed_workflow_blob_sha256',
                               return_value=(good_hash, Path('/installed/wf'))), \
                mock.patch.object(lean_host, 'installed_release_sha', return_value=release), \
                mock.patch.object(lean_host, 'read_config', return_value={
                    'schema': 'GB_LEAN_CONFIG_V1', 'enabled': False}), \
                mock.patch.object(lean_host, 'resolved_code_root',
                                  return_value=Path('/installed')):
            meta = lean_host.verify_workflow_matches_install(
                req, api_fetch=contents_api, head_sha='c' * 40)
            self.assertEqual(meta['workflow_git_sha256'], good_hash)

        forged = base64.b64encode(b'name: forged\n').decode()

        def forged_contents(path):
            return {'encoding': 'base64', 'content': forged}

        with mock.patch.object(lean_host, 'installed_workflow_blob_sha256',
                               return_value=(good_hash, Path('/installed/wf'))), \
                mock.patch.object(lean_host, 'installed_release_sha', return_value=release), \
                mock.patch.object(lean_host, 'read_config', return_value={
                    'schema': 'GB_LEAN_CONFIG_V1', 'enabled': False}), \
                mock.patch.object(lean_host, 'resolved_code_root',
                                  return_value=Path('/installed')):
            with self.assertRaises(lean_host.HostRefused):
                lean_host.verify_workflow_matches_install(
                    req, api_fetch=forged_contents, head_sha='c' * 40)
            with self.assertRaises(lean_host.HostRefused):
                lean_host.verify_workflow_matches_install(
                    dict(req, client_sha='d' * 40),
                    api_fetch=contents_api, head_sha='c' * 40)

    def test_status_dispatch_no_advance_and_schedule_transport(self):
        """Manual default status; schedule/comment advance; keepalive preserves fields."""
        self.assertEqual(
            lean_client.resolve_dispatch_action('workflow_dispatch', {'inputs': {}}),
            'status')
        self.assertEqual(
            lean_client.resolve_dispatch_action(
                'workflow_dispatch', {'inputs': {'action': 'advance'}}),
            'advance')
        self.assertEqual(lean_client.resolve_dispatch_action('schedule'), 'advance')
        self.assertEqual(lean_client.resolve_dispatch_action('issue_comment'), 'advance')

        base = self._base()
        lean_host.validate_request(base)
        with self.assertRaises(lean_host.HostRefused):
            lean_host.validate_request(dict(base, dispatch_action='run-models'))
        with self.assertRaises(lean_host.HostRefused):
            lean_host.validate_request(dict(
                base, event_name='schedule', dispatch_action='status'))

        env = {
            'GITHUB_RUN_ID': '42',
            'GITHUB_RUN_ATTEMPT': '1',
            'GITHUB_ACTOR_ID': str(OWNER),
            'GITHUB_REF': 'refs/heads/main',
        }
        with mock.patch.dict(os.environ, env, clear=False):
            manual = lean_client.lean_request(
                'workflow_dispatch', 'a' * 64, 'b' * 40, event={'inputs': {}})
            self.assertEqual(manual['dispatch_action'], 'status')
            sched = lean_client.lean_request('schedule', 'a' * 64, 'b' * 40)
            self.assertEqual(sched['dispatch_action'], 'advance')
            self.assertEqual(sched['event_name'], 'schedule')

        captured = {}

        def fake_run(argv, **kwargs):
            event_path = Path(argv[-1])
            captured['event'] = json.loads(event_path.read_text())
            return mock.Mock(returncode=0, stdout='{"status":"ok"}\n', stderr='')

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            run_py = root / 'tools/train/run.py'
            run_py.parent.mkdir(parents=True)
            run_py.write_text('#!/usr/bin/env python3\n')
            meta = {
                'config': {
                    'schema': 'GB_LEAN_CONFIG_V1', 'enabled': True, 'wake_budget_s': 300,
                },
                'code_root': str(root),
                'installed_sha': 'b' * 40,
                'enabled': True,
                'github': {'run': {'event': 'workflow_dispatch'}},
            }
            req = dict(self._base(), dispatch_action='status')
            with mock.patch.object(lean_host, 'RESULTS', root / 'results'), \
                    mock.patch.object(lean_host.subprocess, 'run', side_effect=fake_run):
                out = lean_host.dispatch_controller(req, meta)
            self.assertEqual(out['dispatch_action'], 'status')
            self.assertEqual(captured['event']['inputs']['action'], 'status')
            self.assertEqual(captured['event']['event_name'], 'workflow_dispatch')

            captured.clear()
            meta['github'] = {'run': {'event': 'schedule'}}
            req_sched = dict(self._base(), event_name='schedule',
                             dispatch_action='advance', actor_id=ACTIONS_BOT)
            with mock.patch.object(lean_host, 'RESULTS', root / 'results'), \
                    mock.patch.object(lean_host.subprocess, 'run', side_effect=fake_run):
                out2 = lean_host.dispatch_controller(req_sched, meta)
            self.assertEqual(out2['dispatch_action'], 'advance')
            self.assertEqual(captured['event']['inputs']['action'], 'advance')
            self.assertEqual(captured['event']['event_name'], 'schedule')

            disabled = lean_host.dispatch_controller(req, dict(meta, config={
                'schema': 'GB_LEAN_CONFIG_V1', 'enabled': False}))
            self.assertEqual(disabled['status'], 'disabled')

        polls = []

        class FakeSSH:
            def __call__(self, req, timeout=None):
                polls.append(dict(req))
                if len(polls) == 1:
                    return {'status': 'running'}
                return {'status': 'ok'}

        with mock.patch.object(lean_client.time, 'sleep', return_value=None):
            result = lean_client.wait_with_keepalive(
                FakeSSH(),
                {
                    'action': 'lean', 'run_id': 7, 'run_attempt': 1,
                    'actor_id': OWNER, 'ref': 'refs/heads/main',
                    'event_name': 'schedule', 'workflow_sha': 'a' * 64,
                    'client_sha': 'b' * 40, 'dispatch_action': 'advance',
                },
                deadline_s=100, poll_s=0,
            )
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(polls[1]['event_name'], 'schedule')
        self.assertEqual(polls[1]['dispatch_action'], 'advance')
        self.assertEqual(lean_client.DEFAULT_SSH_TIMEOUT_S, 2520)
        self.assertGreater(lean_client.DEFAULT_SSH_TIMEOUT_S, 2400)


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

    def test_unmet_dependency_not_ready_without_done_evidence(self):
        """Non-empty deps require done_issues; unstarted/absent ≠ done."""
        dependent = {'issue': 375, 'task': {'priority': 200, 'dependencies': [372]}}
        self.assertIsNone(
            lean_run.pick_next_ready([dependent], done_issues=set(), blocked_issues=set()))
        self.assertIsNone(
            lean_run.pick_next_ready([dependent], done_issues={999}, blocked_issues=set()))
        # Independent ready still selected while a dependent stays unmet.
        independent = {'issue': 370, 'task': {'priority': 50, 'dependencies': []}}
        nxt = lean_run.pick_next_ready(
            [dependent, independent], done_issues=set(), blocked_issues={371})
        self.assertEqual(nxt['issue'], 370)

    def test_completed_uat_pending_prereq_satisfies_dependency(self):
        """Technical DEV accepted (UAT pending) counts as done for deps."""
        dependent = {'issue': 375, 'task': {'priority': 200, 'dependencies': [372]}}
        nxt = lean_run.pick_next_ready(
            [dependent], done_issues={372}, blocked_issues=set(), uat_pending={372})
        self.assertEqual(nxt['issue'], 375)
        # Priority/order among ready independents preserved when another is blocked.
        a = {'issue': 10, 'task': {'dependencies': [], 'priority': 1}}
        b = {'issue': 11, 'task': {'dependencies': [], 'priority': 9}}
        nxt2 = lean_run.pick_next_ready([a, b], blocked_issues={10}, done_issues=set())
        self.assertEqual(nxt2['issue'], 11)


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


class WaitDevDeployGitShaTests(unittest.TestCase):
    """Real /v1/meta shape uses gitSha; exact merged SHA required."""

    def _claim(self, merge_sha):
        return {'merged_sha': merge_sha, 'merge_sha': merge_sha}

    def test_real_shape_gitSha_pass(self):
        merge = 'a' * 40
        meta = json.dumps({'gitSha': merge, 'env': 'dev'}).encode()

        def fake_gh(path, **kwargs):
            return {'workflow_runs': [{
                'id': 1, 'status': 'completed', 'conclusion': 'success',
                'head_sha': merge, 'run_attempt': 1,
            }]}

        def fake_run_argv(argv, **kwargs):
            return mock.Mock(returncode=0, stdout=meta.decode(), stderr='')

        with mock.patch.object(lean_live, 'gh_api', side_effect=fake_gh), \
                mock.patch.object(lean_live, 'run_argv', side_effect=fake_run_argv), \
                mock.patch.object(lean_live, 'readable_present', return_value=False), \
                mock.patch.object(lean_live.time, 'sleep', return_value=None):
            out = lean_live.wait_dev_deploy(self._claim(merge), budget_s=1, poll_s=0)
        self.assertTrue(out['accepted'])
        self.assertEqual(out['live_sha'], merge)

    def test_mismatched_gitSha_rejected(self):
        merge = 'a' * 40
        other = 'b' * 40
        meta = json.dumps({'gitSha': other}).encode()

        def fake_gh(path, **kwargs):
            return {'workflow_runs': [{
                'id': 2, 'status': 'completed', 'conclusion': 'success',
                'head_sha': merge, 'run_attempt': 1,
            }]}

        def fake_run_argv(argv, **kwargs):
            return mock.Mock(returncode=0, stdout=meta.decode(), stderr='')

        with mock.patch.object(lean_live, 'gh_api', side_effect=fake_gh), \
                mock.patch.object(lean_live, 'run_argv', side_effect=fake_run_argv), \
                mock.patch.object(lean_live, 'readable_present', return_value=False), \
                mock.patch.object(lean_live.time, 'sleep', return_value=None):
            out = lean_live.wait_dev_deploy(self._claim(merge), budget_s=1, poll_s=0)
        self.assertFalse(out['accepted'])
        self.assertEqual(out['live_sha'], other)
        self.assertEqual(out.get('reason'), 'live_sha_mismatch')

    def test_legacy_sha_field_not_accepted(self):
        """Wrong meta keys (sha/git_sha/commit) must not satisfy exact gitSha."""
        merge = 'c' * 40
        meta = json.dumps({'sha': merge, 'git_sha': merge, 'commit': merge}).encode()

        def fake_gh(path, **kwargs):
            return {'workflow_runs': [{
                'id': 3, 'status': 'completed', 'conclusion': 'success',
                'head_sha': merge, 'run_attempt': 1,
            }]}

        def fake_run_argv(argv, **kwargs):
            return mock.Mock(returncode=0, stdout=meta.decode(), stderr='')

        with mock.patch.object(lean_live, 'gh_api', side_effect=fake_gh), \
                mock.patch.object(lean_live, 'run_argv', side_effect=fake_run_argv), \
                mock.patch.object(lean_live, 'readable_present', return_value=False), \
                mock.patch.object(lean_live.time, 'sleep', return_value=None):
            out = lean_live.wait_dev_deploy(self._claim(merge), budget_s=1, poll_s=0)
        self.assertFalse(out.get('accepted'))
        self.assertIsNone(out.get('live_sha'))


class HostIssueCommentAdvanceTests(unittest.TestCase):
    def _base(self):
        return {
            'action': 'lean', 'run_id': 11, 'run_attempt': 1,
            'actor_id': OWNER, 'ref': 'refs/heads/main',
            'event_name': 'issue_comment', 'workflow_sha': 'a' * 64,
            'client_sha': 'b' * 40, 'dispatch_action': 'advance',
            'repository': REPO, 'repository_id': REPO_ID,
        }

    def test_issue_comment_advance_maps_to_advance_queue_event(self):
        captured = {}

        def fake_run(argv, **kwargs):
            event_path = Path(argv[-1])
            captured['event'] = json.loads(event_path.read_text())
            intent_dir = event_path.parent
            captured['verified_wake'] = json.loads(
                (intent_dir / 'verified_wake.json').read_text())
            # Simulate run.py advance_queue success (not admit_comment).
            return mock.Mock(
                returncode=0,
                stdout='{"status":"ok","projection":{"mode":"lean_mode_b"}}\n',
                stderr='')

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            run_py = root / 'tools/train/run.py'
            run_py.parent.mkdir(parents=True)
            run_py.write_text('#!/usr/bin/env python3\n')
            meta = {
                'config': {
                    'schema': 'GB_LEAN_CONFIG_V1', 'enabled': True, 'wake_budget_s': 300,
                },
                'code_root': str(root),
                'installed_sha': 'b' * 40,
                'enabled': True,
                'github': {'run': {'event': 'issue_comment'}},
            }
            req = self._base()
            with mock.patch.object(lean_host, 'RESULTS', root / 'results'), \
                    mock.patch.object(lean_host.subprocess, 'run', side_effect=fake_run):
                out = lean_host.dispatch_controller(req, meta)
            self.assertEqual(out['status'], 'ok')
            self.assertEqual(captured['event']['event_name'], 'workflow_dispatch')
            self.assertEqual(captured['event']['inputs']['action'], 'advance')
            self.assertNotIn('comment', captured['event'])
            self.assertNotIn('issue', captured['event'])
            self.assertEqual(captured['verified_wake']['event_name'], 'issue_comment')
            self.assertEqual(captured['verified_wake']['dispatch_action'], 'advance')

    def test_host_issue_comment_event_reaches_run_advance(self):
        """Real host→run.py path: mapped event advances queue, not admit_comment."""
        with tempfile.TemporaryDirectory() as td:
            adapters, _state = make_flow_adapters(td, shas=[_sha(3)])
            adapters.fetch_admissions = lambda: []
            event = {
                'event_name': 'workflow_dispatch',
                'inputs': {'action': 'advance'},
                'repository': {'id': REPO_ID, 'full_name': REPO},
                'verified_wake': {
                    'event_name': 'issue_comment', 'dispatch_action': 'advance',
                },
            }
            out = lean_run.run_once(event, adapters=adapters, results_root=td)
            self.assertIn(
                out.get('status'),
                ('ok', 'advanced', 'queue_unavailable', 'hold', 'empty',
                 'no_admissions_source', 'schedule_reconcile'))
            self.assertNotEqual(out.get('status'), 'denied')
            self.assertNotEqual(out.get('code'), 'invalid_issue')


class AgyNativeTransportTests(unittest.TestCase):
    def test_agy_invoke_product_mock_one_charge_no_unknown_replay(self):
        sha = 'e' * 40
        with tempfile.TemporaryDirectory() as td:
            work = Path(td) / 'work'
            work.mkdir()
            evidence = Path(td) / 'qa-agy-deadbeef'
            evidence.mkdir()
            task = {
                'issue': 29, 'worktree': str(work), 'revision': 'r' * 64,
                'attempt': 8, 'runtime_base_sha': 'f' * 40,
                'goal': 'commission', 'acceptance': ['DEV'],
            }
            raw = (
                b'{"event":"init","init":{"model":"x","agent":"qa","tools":'
                b'["run_command","view_file","finish"],"permission_mode":"default",'
                b'"json_schema":{}}}\n'
                b'{"event":"result","result":{"status":"SUCCESS"}}\n'
            )
            charges = {'n': 0}

            class FakeBudget:
                def remaining(self, *a, **k):
                    return float('inf')

                def charge(self, *a, **k):
                    charges['n'] += 1

            def fake_invoke(**kwargs):
                (evidence / 'stream.raw').write_bytes(raw)
                return raw, {
                    'protocol': {
                        'tool_names': ['run_command', 'view_file', 'finish'],
                        'finish_done': True,
                    }
                }

            with mock.patch.object(lean_live, 'git', side_effect=lambda *a, **k: (
                    sha if 'HEAD' in a else '')), \
                    mock.patch.object(lean_live, 'load_short_rules',
                                      return_value=('RULES', 'r' * 64, Path('/tmp/r'))), \
                    mock.patch.object(lean_live, 'shared_agy_budget',
                                      return_value=FakeBudget()), \
                    mock.patch.object(lean_live, '_load_native') as load_n, \
                    mock.patch.object(providers, 'role_ready',
                                      return_value=(True, {'source': 'native'})), \
                    mock.patch.object(providers, 'agy_quota_available',
                                      return_value=(True, 'ok', {})), \
                    mock.patch.object(providers, 'record_agy_charge',
                                      return_value={}), \
                    mock.patch.object(providers, 'parse_agy_stream', return_value={
                        'verdict': 'PASS', 'findings': [], 'reviewed_sha': sha,
                        'evidence': {'tool_names': ['run_command', 'view_file'],
                                     'finish_done': True},
                    }):
                fake_native = mock.Mock()
                fake_native.invoke = mock.Mock()
                fake_native.parse_stream = mock.Mock(return_value=(
                    {'verdict': 'PASS', 'findings': [], 'reviewed_sha': sha},
                    {'tool_names': ['run_command', 'view_file'], 'finish_done': True},
                ))
                load_n.return_value = fake_native
                out = lean_live.agy_qa_live(
                    task=task, candidate_sha=sha, evidence_dir=evidence,
                    _invoke=fake_invoke)
            self.assertEqual(out['verdict'], 'PASS')
            self.assertEqual(out['findings'], [])
            self.assertEqual(out['reviewed_sha'], sha)
            self.assertEqual(charges['n'], 1)
            self.assertTrue((evidence / 'stream.raw').is_file())
            # UNKNOWN never replayed: second call with unknown private ledger refuses.
            with mock.patch.object(providers, 'role_ready',
                                   return_value=(True, {'source': 'native'})), \
                    mock.patch.object(providers, 'agy_quota_available', return_value=(
                        False, 'agy_quota_unknown_pending_reconcile', {'unknown_calls': 1})):
                with self.assertRaises(providers.ProviderError) as ctx:
                    lean_live.agy_qa_live(
                        task=dict(task, attempt=9), candidate_sha=sha,
                        evidence_dir=Path(td) / 'qa-agy-2')
                self.assertEqual(ctx.exception.code, 'agy_quota_unknown_pending_reconcile')

    def test_role_ready_binds_product_role_ready(self):
        fake = mock.Mock()
        fake.product_role_ready.return_value = True
        with mock.patch.object(providers, '_import_native', return_value=fake):
            ok, meta = providers.role_ready('agy_qa')
        self.assertTrue(ok)
        self.assertEqual(meta['source'], 'native_product_role_ready')

    def test_wrong_task_sha_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            work = Path(td) / 'work'
            work.mkdir()
            task = {'issue': 29, 'worktree': str(work), 'attempt': 1}
            with mock.patch.object(providers, 'role_ready',
                                   return_value=(True, {'source': 'native'})), \
                    mock.patch.object(providers, 'agy_quota_available',
                                      return_value=(True, 'ok', {})), \
                    mock.patch.object(lean_live, '_load_native', return_value=mock.Mock(
                        invoke=mock.Mock(), parse_stream=mock.Mock())), \
                    mock.patch.object(lean_live, 'git',
                                      side_effect=lambda *a, **k: 'a' * 40):
                with self.assertRaises(providers.ProviderError) as ctx:
                    lean_live.agy_qa_live(
                        task=task, candidate_sha='b' * 40,
                        evidence_dir=Path(td) / 'qa')
            self.assertEqual(ctx.exception.code, 'qa_head_mismatch')


class Od020InstallPairTests(unittest.TestCase):
    def test_remove_agy_per_issue_daily_only(self):
        policy = {
            'schema': 1,
            'providers': {
                'agy': {'qa': 'unlimited', 'per_issue_daily': 5},
                'codex': {'qa': 3},
            },
            'slots': {'slot2': {'agy': {'qa': 'unlimited'}}},
        }
        cleaned = lean_install.remove_agy_per_issue_daily(policy)
        self.assertNotIn('per_issue_daily', cleaned['providers']['agy'])
        self.assertEqual(cleaned['providers']['agy']['qa'], 'unlimited')
        self.assertEqual(cleaned['providers']['codex']['qa'], 3)
        self.assertEqual(policy['providers']['agy']['per_issue_daily'], 5)

    def test_budget_left_eligible_float_inf_and_rejects(self):
        # Default / product QA: positive finite + inf.
        self.assertTrue(lean_live.budget_left_eligible(float('inf')))
        self.assertTrue(lean_live.budget_left_eligible(2.5))
        self.assertTrue(lean_live.budget_left_eligible(1))
        self.assertFalse(lean_live.budget_left_eligible(0))
        self.assertFalse(lean_live.budget_left_eligible(-1))
        self.assertFalse(lean_live.budget_left_eligible(float('-inf')))
        self.assertFalse(lean_live.budget_left_eligible(True))
        self.assertFalse(lean_live.budget_left_eligible(None))
        self.assertFalse(lean_live.budget_left_eligible(float('nan')))
        # Successor (restored): positive finite + inf (not exact-1-only).
        self.assertTrue(lean_live.budget_left_eligible(3, successor=True))
        self.assertTrue(lean_live.budget_left_eligible(1, successor=True))
        self.assertTrue(lean_live.budget_left_eligible(float('inf'), successor=True))
        self.assertFalse(lean_live.budget_left_eligible(0, successor=True))
        # Legacy exact_one: finite==1 + OD-020 inf; 2 refused.
        self.assertTrue(lean_live.budget_left_eligible(1, exact_one=True))
        self.assertFalse(lean_live.budget_left_eligible(2, exact_one=True))
        self.assertTrue(lean_live.budget_left_eligible(float('inf'), exact_one=True))

    def test_od020_busy_writer_zero_changes(self):
        """LockRegistry writer busy ⇒ refuse with zero filesystem writes."""
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td) / 'repo'
            repo.mkdir()
            fake_reg = mock.Mock()
            fake_reg.acquire.return_value = False
            fake_reg.release = mock.Mock()
            writes = []

            def track_atomic(path, data, mode=0o644, uid=0, gid=0):
                writes.append(str(path))
                raise AssertionError('atomic_write must not run when writer busy')

            with mock.patch.object(lean_install, 'git_blob', return_value=b'x'), \
                    mock.patch.object(lean_install, '_agy_executor_quiet'), \
                    mock.patch('os.geteuid', return_value=0), \
                    mock.patch('os.open', return_value=3), \
                    mock.patch('fcntl.flock'), \
                    mock.patch('os.close'), \
                    mock.patch.dict('sys.modules', {
                        'slots': mock.Mock(
                            LockRegistry=mock.Mock(return_value=fake_reg),
                            task_record=lambda *a, **k: {'issue': 29, 'writer': True},
                        ),
                    }), \
                    mock.patch.object(lean_install, 'atomic_write', side_effect=track_atomic):
                # Force import path used inside apply
                with mock.patch.object(lean_install, 'ACTIONS_TRAIN_INSTALL', Path(td)), \
                        mock.patch.object(lean_install, 'BUDGETS_POLICY', Path(td) / 'budgets.json'), \
                        mock.patch.object(lean_install, 'CONTROLLER_LOCK', Path(td) / 'c.lock'), \
                        mock.patch.object(lean_install, 'INTEGRATION_LOCK', Path(td) / 'i.lock'), \
                        mock.patch.object(lean_install, 'WRITER_REGISTRY_LOCK', Path(td) / 'r.lock'), \
                        mock.patch.object(lean_install, 'STATE_ROOT', Path(td)):
                    (Path(td) / 'c.lock').write_text('')
                    (Path(td) / 'i.lock').write_text('')
                    (Path(td) / 'r.lock').write_text('')
                    with self.assertRaises(lean_install.InstallError) as ctx:
                        lean_install.apply_od020_paired(repo, 'a' * 40, dry_run=False)
            self.assertIn('writer busy', str(ctx.exception).lower())
            self.assertEqual(writes, [])

    def test_od020_midwrite_rollback_preserves_history(self):
        """Mid-write failure restores saved-before bytes; history untouched."""
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            recv = td / 'receiver.py'
            slots = td / 'live' / 'slots.py'
            slots.parent.mkdir(parents=True)
            budgets = td / 'budgets.json'
            hist = td / 'slot1.json'
            recv.write_bytes(b'OLD_RECV')
            slots.write_bytes(b'OLD_SLOTS')
            budgets.write_text(json.dumps({
                'schema': 1,
                'providers': {'agy': {'qa': 'unlimited', 'per_issue_daily': 5}},
                'slots': {},
            }) + '\n')
            hist_raw = b'{"history":true}'
            hist.write_bytes(hist_raw)
            # root-owned regular meta stub via _regular_root_bytes mock
            meta = {'sha256': '', 'uid': 0, 'gid': 0, 'mode': 0o644, 'size': 0}

            def fake_regular(path):
                raw = Path(path).read_bytes()
                return raw, dict(meta, sha256=lean_install.sha256_bytes(raw), size=len(raw))

            blobs = {
                'scripts/chatops/actions_train/receiver.py': b'NEW_RECV',
                'scripts/chatops/actions_train/live/slots.py': b'NEW_SLOTS',
            }
            calls = {'n': 0}

            def fake_atomic(path, data, mode=0o644, uid=0, gid=0):
                path = Path(path)
                # Fail on second real target write (after backups+receipt).
                if path.name in ('receiver.py', 'slots.py', 'budgets.json'):
                    calls['n'] += 1
                    if calls['n'] == 2:
                        path.write_bytes(data if isinstance(data, bytes) else data.encode())
                        raise lean_install.InstallError('simulated mid-write fail')
                raw = data if isinstance(data, bytes) else data.encode()
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)

            fake_reg = mock.Mock()
            fake_reg.acquire.return_value = True
            fake_reg.release = mock.Mock()
            with mock.patch.object(lean_install, 'git_blob',
                                   side_effect=lambda r, s, rel: blobs[rel]), \
                    mock.patch.object(lean_install, '_agy_executor_quiet'), \
                    mock.patch.object(lean_install, '_regular_root_bytes',
                                      side_effect=fake_regular), \
                    mock.patch.object(lean_install, 'atomic_write', side_effect=fake_atomic), \
                    mock.patch.object(lean_install, 'write_config'), \
                    mock.patch('os.geteuid', return_value=0), \
                    mock.patch('os.open', return_value=3), \
                    mock.patch('fcntl.flock'), \
                    mock.patch('os.close'), \
                    mock.patch.dict('sys.modules', {
                        'slots': mock.Mock(
                            LockRegistry=mock.Mock(return_value=fake_reg),
                            task_record=lambda *a, **k: {'issue': 29, 'writer': True},
                        ),
                    }), \
                    mock.patch.object(lean_install, 'ACTIONS_TRAIN_INSTALL', td), \
                    mock.patch.object(lean_install, 'BUDGETS_POLICY', budgets), \
                    mock.patch.object(lean_install, 'CONTROLLER_LOCK', td / 'c.lock'), \
                    mock.patch.object(lean_install, 'INTEGRATION_LOCK', td / 'i.lock'), \
                    mock.patch.object(lean_install, 'WRITER_REGISTRY_LOCK', td / 'r.lock'), \
                    mock.patch.object(lean_install, 'STATE_ROOT', td):
                (td / 'c.lock').write_text('')
                (td / 'i.lock').write_text('')
                (td / 'r.lock').write_text('')
                with self.assertRaises(lean_install.InstallError):
                    lean_install.apply_od020_paired(td / 'repo', 'b' * 40, dry_run=False)
            self.assertEqual(recv.read_bytes(), b'OLD_RECV')
            self.assertEqual(slots.read_bytes(), b'OLD_SLOTS')
            self.assertEqual(hist.read_bytes(), hist_raw)


class WakeBudgetStageTests(unittest.TestCase):
    def test_wake_budget_author_insufficient_no_deadline_ok(self):
        adapters = lean_run.Adapters(deadline=None)
        self.assertFalse(lean_run._wake_budget_exhausted(adapters, 'author'))
        self.assertFalse(lean_run._wake_budget_exhausted(adapters, 'qa'))

    def test_wake_budget_author_rem50_exhausted(self):
        adapters = lean_run.Adapters(deadline=time.monotonic() + 50)
        self.assertTrue(lean_run._wake_budget_exhausted(adapters, 'author'))
        self.assertTrue(lean_run._wake_budget_exhausted(adapters, 'repair'))
        self.assertTrue(lean_run._wake_budget_exhausted(adapters, 'qa'))

    def test_wake_budget_enough_window_proceeds(self):
        # AUTHOR need=1260, QA need=1860
        adapters = lean_run.Adapters(deadline=time.monotonic() + 2000)
        self.assertFalse(lean_run._wake_budget_exhausted(adapters, 'author'))
        self.assertFalse(lean_run._wake_budget_exhausted(adapters, 'qa'))
        adapters_mid = lean_run.Adapters(deadline=time.monotonic() + 1300)
        self.assertFalse(lean_run._wake_budget_exhausted(adapters_mid, 'author'))
        self.assertTrue(lean_run._wake_budget_exhausted(adapters_mid, 'qa'))
        adapters2 = lean_run.Adapters(deadline=time.monotonic() + 1900)
        self.assertFalse(lean_run._wake_budget_exhausted(adapters2, 'qa'))

    def test_wake_resume_preserves_stage_attempts(self):
        with tempfile.TemporaryDirectory() as td:
            adapters, state = make_flow_adapters(td, shas=[_sha(1)])
            adapters.deadline = time.monotonic() + 30
            comment, _ = owner_task_comment(issue=910)
            adm = lean_run.admit_comment(
                comment, {'number': 910, 'state': 'open'}, {'id': REPO_ID})
            out = lean_run.execute_claim(adm, adapters, results_root=td)
            self.assertEqual(out['status'], 'wake_resume')
            self.assertEqual(out['claim']['phase'], 'WAKE_RESUME')
            self.assertEqual(state['author_calls'], 0)
            self.assertEqual(int((out['claim'].get('attempts') or {}).get('author') or 0), 0)


class Od018TransportSeamTests(unittest.TestCase):
    def test_agy_bundle_create_head_and_fetch_exact_candidate(self):
        """Real local git: bundle create HEAD (not bare SHA) + fetch tip == candidate."""
        import subprocess
        mat = inspect.getsource(lean_live._agy_materialize_qa_snapshot)
        self.assertIn("'HEAD'", mat)
        self.assertIn('chown(tmp_bundle', mat)
        self.assertNotIn(
            "bundle', 'create', str(tmp_path), candidate_sha", mat)
        # Proven recipe: named ref required; bare SHA → empty bundle refused.
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            repo = td / 'author'
            repo.mkdir()
            env = {
                'PATH': '/usr/bin:/bin', 'HOME': str(td),
                'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
                'GIT_CONFIG_SYSTEM': '/dev/null',
            }
            def g(*args):
                return subprocess.run(
                    ['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', *args],
                    cwd=repo, env=env, capture_output=True, text=True, check=True)
            g('init')
            g('config', 'user.email', 't@example.com')
            g('config', 'user.name', 't')
            (repo / 'f.txt').write_text('x\n')
            g('add', 'f.txt')
            g('commit', '-m', 'c1')
            head = g('rev-parse', 'HEAD').stdout.strip()
            self.assertEqual(len(head), 40)
            empty = td / 'empty.bundle'
            bad = subprocess.run(
                ['/usr/bin/git', '-c', 'core.hooksPath=/dev/null',
                 'bundle', 'create', str(empty), head],
                cwd=repo, env=env, capture_output=True, text=True)
            self.assertNotEqual(bad.returncode, 0)
            self.assertIn('empty bundle', (bad.stderr or bad.stdout or '').lower())
            good = td / 'ok.bundle'
            g('bundle', 'create', str(good), 'HEAD')
            dest = td / 'dest'
            dest.mkdir()
            subprocess.run(
                ['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', 'init'],
                cwd=dest, env=env, check=True, capture_output=True)
            subprocess.run(
                ['/usr/bin/git', '-c', 'core.hooksPath=/dev/null',
                 'fetch', '--no-tags', str(good), f'{head}:refs/lean-qa/t'],
                cwd=dest, env=env, check=True, capture_output=True)
            tip = subprocess.run(
                ['/usr/bin/git', '-c', 'core.hooksPath=/dev/null',
                 'rev-parse', 'refs/lean-qa/t'],
                cwd=dest, env=env, capture_output=True, text=True, check=True
            ).stdout.strip()
            self.assertEqual(tip, head)
            # Ownership drop order: chown fresh tmpdir before bundle Git drop.
            order = []
            real_chown = os.chown

            def track_chown(path, uid, gid):
                order.append(('chown', str(path), uid, gid))
                try:
                    real_chown(path, uid, gid)
                except OSError:
                    pass

            with mock.patch.object(lean_live, 'AGY_QA_GIT_BASE', dest), \
                    mock.patch.object(lean_live, 'AGY_QA_WORKTREES', td / 'wt'), \
                    mock.patch.object(lean_live, 'AGY_QA_INPUTS', td / 'inputs'), \
                    mock.patch.object(lean_live, 'git', side_effect=lambda cwd, *a, **k: (
                        head if 'HEAD' in a else (
                            '' if a and a[0] == 'status' else head))), \
                    mock.patch.object(lean_live, '_agy_plain_git') as plain, \
                    mock.patch('os.chown', side_effect=track_chown), \
                    mock.patch('os.geteuid', return_value=0):
                (td / 'wt').mkdir(exist_ok=True)
                (td / 'inputs').mkdir(exist_ok=True)

                def fake_plain(cwd, *args, home='/nonexistent', drop=None, timeout=120):
                    order.append(('git', list(args), drop))
                    if args[:2] == ('bundle', 'create'):
                        self.assertEqual(args[3], 'HEAD')
                        Path(args[2]).write_bytes(good.read_bytes())
                        return ''
                    if args and args[0] == 'rev-parse' and 'refs/lean-qa' in str(args):
                        raise lean_live.LiveError('agy_plain_git_failed', 'missing')
                    if args and args[0] == 'fetch':
                        return ''
                    if args[:2] == ('worktree', 'add'):
                        qa = Path(args[3])
                        qa.mkdir(parents=True, exist_ok=True)
                        return ''
                    if args and args[0] == 'rev-parse' and 'HEAD' in args:
                        return head
                    if args and args[0] == 'status':
                        return ''
                    return head

                plain.side_effect = fake_plain
                out = lean_live._agy_materialize_qa_snapshot(
                    author_source=repo, candidate_sha=head, base_sha=head,
                    issue=29, operation='abc123')
            self.assertEqual(out['candidate_sha'], head)
            chowns_before_bundle = [
                e for e in order
                if e[0] == 'chown' and 'gb-agy-bundle-' in e[1]
            ]
            bundle_git = [
                e for e in order
                if e[0] == 'git' and e[1][:2] == ['bundle', 'create']
            ]
            self.assertTrue(chowns_before_bundle)
            self.assertTrue(bundle_git)
            self.assertLess(
                order.index(chowns_before_bundle[0]),
                order.index(bundle_git[0]))
            self.assertEqual(chowns_before_bundle[0][2], lean_live.CURSOR_UID)

    def test_agy_prompt_diff_source_and_native_evidence_under_input(self):
        prompt_src = inspect.getsource(lean_live._agy_build_prompt)
        self.assertIn('diff_source', prompt_src)
        live_src = inspect.getsource(lean_live.agy_qa_live)
        self.assertIn('diff_source=author_source', live_src)
        self.assertIn("native-evidence", live_src)
        inv = inspect.getsource(lean_live._agy_product_invoke)
        self.assertIn('native_evidence', inv)
        self.assertIn('_agy_collect_native_evidence', inv)

    def test_wake_resume_qa_restores_ci_pass_capacity_two_wake(self):
        """Wake1: Codex capacity defer, no AGY/merge/deploy. Wake2: AGY only + DEV."""
        with tempfile.TemporaryDirectory() as td:
            cand = _sha(42)
            adapters, state = make_flow_adapters(td, shas=[cand])
            state['codex_calls'] = 0
            state['agy_calls'] = 0

            def qa(claim):
                state['qa_calls'] += 1
                sha = claim['candidate_sha']
                state['qa_worktrees'].append(claim.get('worktree'))
                state['qa_bases'].append(claim.get('base_sha'))
                state['qa_evidence_dirs'].append(claim.get('evidence_dir'))
                resume = claim.get('resume_provider') or claim.get('qa_provider')
                if resume == 'agy_qa':
                    state['agy_calls'] += 1
                    return {
                        'verdict': 'PASS', 'findings': [], 'reviewed_sha': sha,
                        'charge': 'charged', 'provider': 'agy_qa',
                    }
                state['codex_calls'] += 1
                if state['codex_calls'] == 1:
                    raise providers.ProviderError(
                        'wake_defer_capacity_fallback', 'remaining<1860',
                        charge='charged')
                self.fail('Codex must not rerun on capacity-fallback resume')

            adapters.qa = qa
            # Deploy must not be accepted until real server ACCEPTED on second wake.
            deploy_calls = {'n': 0}

            def deploy(claim):
                deploy_calls['n'] += 1
                return {
                    'accepted': True, 'live_sha': claim['merged_sha'],
                    'receipt': {'status': 'ACCEPTED', 'line': 'ACCEPTED'},
                }

            adapters.deploy = deploy
            comment, _ = owner_task_comment(
                issue=911,
                independentfallback=['agy_qa'],
                qaroute=['codex_sol_medium'],
            )
            adm = lean_run.admit_comment(
                comment, {'number': 911, 'state': 'open'}, {'id': REPO_ID})
            out1 = lean_run.execute_claim(adm, adapters, results_root=td)
            self.assertEqual(out1['status'], 'wake_resume')
            self.assertEqual(out1['claim']['phase'], 'WAKE_RESUME')
            self.assertEqual(out1['claim'].get('stage'), 'qa')
            self.assertEqual(out1['claim'].get('resume_provider'), 'agy_qa')
            self.assertEqual(out1['claim'].get('wake'), 'capacity_fallback_budget')
            self.assertEqual(state['codex_calls'], 1)
            self.assertEqual(state['agy_calls'], 0)
            self.assertEqual(state['merge_calls'], 0)
            self.assertEqual(deploy_calls['n'], 0)
            # Negative: must not report DEV accepted before server ACCEPTED.
            self.assertNotEqual(out1['status'], 'dev_accepted_uat_pending')
            self.assertNotEqual(
                out1['claim'].get('phase'), 'DEV_ACCEPTED_UAT_PENDING')
            self.assertNotEqual(out1['claim'].get('phase'), 'DEV_ACCEPTED')

            out2 = lean_run.execute_claim(adm, adapters, results_root=td)
            self.assertEqual(out2['status'], 'dev_accepted_uat_pending')
            self.assertEqual(out2['claim']['phase'], 'DEV_ACCEPTED_UAT_PENDING')
            self.assertEqual(state['codex_calls'], 1)
            self.assertEqual(state['agy_calls'], 1)
            self.assertEqual(state['qa_calls'], 2)
            self.assertEqual(state['merge_calls'], 1)
            self.assertEqual(deploy_calls['n'], 1)
            self.assertNotIn('resume_provider', out2['claim'] or {})

    def test_capacity_agy_resume_shared_budget_zero_never_calls_codex(self):
        """After Codex capacity, exhausted AGY shared budget must not launch Codex."""
        from types import SimpleNamespace
        task = {
            'issue': 375, 'worktree': '/unused/frozen',
            'runtime_base_sha': 'a' * 40, 'independentfallback': ['agy_qa'],
        }
        claim = {
            'issue': 375, 'candidate_sha': 'b' * 40, 'task': task,
            'resume_provider': 'agy_qa',
        }
        with tempfile.TemporaryDirectory() as td:
            ev = Path(td)
            with mock.patch.object(providers, 'role_ready', return_value=(True, {})), \
                    mock.patch.object(providers, 'agy_quota_available',
                                      return_value=(True, 'ok', {})), \
                    mock.patch.object(lean_live, '_load_native',
                                      return_value=SimpleNamespace(
                                          invoke=lambda: None, parse_stream=lambda: None)), \
                    mock.patch.object(lean_live, 'git', side_effect=['b' * 40, '']), \
                    mock.patch.object(lean_live, 'load_short_rules',
                                      return_value=('rules', 'hash', Path('/unused/rules'))), \
                    mock.patch.object(lean_live, 'shared_agy_budget',
                                      return_value=SimpleNamespace(
                                          remaining=lambda *a: 0)), \
                    mock.patch.object(lean_live, 'codex_qa_live',
                                      return_value={'unexpected': 'second Codex call'}) as codex:
                with self.assertRaises(providers.ProviderError) as ctx:
                    lean_live._qa_resume_agy_capacity(claim, task, ev)
                self.assertEqual(ctx.exception.code, 'agy_capacity_alternative_ineligible')
                self.assertEqual(ctx.exception.charge, 'none')
                self.assertEqual(codex.call_count, 0)

    def test_capacity_agy_ineligible_wake_preserves_pending_not_dev_accepted(self):
        """Known no-call AGY capacity HOLD must not become false DEV accepted."""
        with tempfile.TemporaryDirectory() as td:
            cand = _sha(77)
            adapters, state = make_flow_adapters(td, shas=[cand])
            state['codex_calls'] = 0

            def qa(claim):
                state['qa_calls'] += 1
                resume = claim.get('resume_provider') or claim.get('qa_provider')
                if resume == 'agy_qa':
                    raise providers.ProviderError(
                        'agy_capacity_alternative_ineligible',
                        'shared_budget_ineligible', charge='none')
                state['codex_calls'] += 1
                raise providers.ProviderError(
                    'wake_defer_capacity_fallback', 'remaining<1860', charge='charged')

            adapters.qa = qa
            comment, _ = owner_task_comment(
                issue=912, independentfallback=['agy_qa'], qaroute=['codex_sol_medium'])
            adm = lean_run.admit_comment(
                comment, {'number': 912, 'state': 'open'}, {'id': REPO_ID})
            out1 = lean_run.execute_claim(adm, adapters, results_root=td)
            self.assertEqual(out1['status'], 'wake_resume')
            self.assertEqual(out1['claim'].get('resume_provider'), 'agy_qa')
            out2 = lean_run.execute_claim(adm, adapters, results_root=td)
            self.assertEqual(out2['status'], 'wake_resume')
            self.assertEqual(out2['claim']['phase'], 'WAKE_RESUME')
            self.assertEqual(out2['claim'].get('resume_provider'), 'agy_qa')
            self.assertNotEqual(out2['status'], 'dev_accepted_uat_pending')
            self.assertEqual(state['codex_calls'], 1)
            self.assertEqual(state['merge_calls'], 0)


if __name__ == '__main__':
    os.chdir(Path(__file__).resolve().parent)
    unittest.main()

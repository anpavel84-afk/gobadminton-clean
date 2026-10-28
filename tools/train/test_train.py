#!/usr/bin/env python3
"""Proportionate deterministic tests for Lean Mode B boundaries (OD-017).

Real admission/hold/lease/receipt/quota boundaries — not a full synthetic framework.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import providers
import run as lean_run
import host as lean_host


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
        'id': 900001,
        'body': body,
        'user': {'id': OWNER, 'login': 'anpavel84-afk'},
        'created_at': '2026-10-28T12:00:00Z',
        'updated_at': '2026-10-28T12:00:00Z',
    }, task


class AdmissionTests(unittest.TestCase):
    def test_owner_admission_ok(self):
        comment, task = owner_task_comment()
        issue = {'number': 337, 'state': 'open'}
        repo = {'id': REPO_ID}
        adm = lean_run.admit_comment(comment, issue, repo)
        self.assertEqual(adm['issue'], 337)
        self.assertEqual(len(adm['revision']), 64)
        self.assertEqual(adm['task']['goal'], task['goal'])

    def test_outsider_comment_denied(self):
        comment, _ = owner_task_comment()
        comment['user'] = {'id': 1, 'login': 'outsider'}
        with self.assertRaises(lean_run.LeanError) as ctx:
            lean_run.admit_comment(comment, {'number': 337, 'state': 'open'}, {'id': REPO_ID})
        self.assertEqual(ctx.exception.code, 'outsider_comment_denied')

    def test_actor_name_alone_insufficient(self):
        comment, _ = owner_task_comment()
        comment['user'] = {'id': 999, 'login': 'anpavel84-afk'}
        with self.assertRaises(lean_run.LeanError) as ctx:
            lean_run.admit_comment(comment, {'number': 337, 'state': 'open'}, {'id': REPO_ID})
        self.assertEqual(ctx.exception.code, 'outsider_comment_denied')

    def test_182_hard_hold(self):
        comment, _ = owner_task_comment(issue=182)
        with self.assertRaises(lean_run.LeanError) as ctx:
            lean_run.admit_comment(
                comment, {'number': 182, 'state': 'open'}, {'id': REPO_ID},
                config={'gameRecommendations': False})
        self.assertEqual(ctx.exception.code, 'admission_hold')
        self.assertIn('182', ctx.exception.detail)

    def test_182_config_not_overridden_by_task_comment(self):
        # Even a well-formed Owner marker on #182 must not admit.
        comment, _ = owner_task_comment(issue=182)
        with self.assertRaises(lean_run.LeanError) as ctx:
            lean_run.admit_comment(comment, {'number': 182, 'state': 'open'}, {'id': REPO_ID})
        self.assertEqual(ctx.exception.code, 'admission_hold')

    def test_closed_issue_denied(self):
        comment, _ = owner_task_comment()
        with self.assertRaises(lean_run.LeanError) as ctx:
            lean_run.admit_comment(comment, {'number': 337, 'state': 'closed'}, {'id': REPO_ID})
        self.assertEqual(ctx.exception.code, 'admission_hold')

    def test_wrong_repo_id_denied(self):
        comment, _ = owner_task_comment()
        with self.assertRaises(lean_run.LeanError):
            lean_run.admit_comment(comment, {'number': 337, 'state': 'open'}, {'id': 1})


class DuplicateRestartTests(unittest.TestCase):
    def test_duplicate_claim_no_second_writer_phase(self):
        comment, _ = owner_task_comment()
        issue = {'number': 337, 'state': 'open'}
        adm = lean_run.admit_comment(comment, issue, {'id': REPO_ID})
        with tempfile.TemporaryDirectory() as td:
            c1 = lean_run.claim_admission(adm, results_root=td)
            c2 = lean_run.claim_admission(adm, results_root=td)
            self.assertEqual(c1['revision'], c2['revision'])
            self.assertEqual(c1['claimed_at'], c2['claimed_at'])

    def test_running_no_automatic_replay(self):
        comment, _ = owner_task_comment()
        adm = lean_run.admit_comment(comment, {'number': 337, 'state': 'open'}, {'id': REPO_ID})
        with tempfile.TemporaryDirectory() as td:
            claim = lean_run.claim_admission(adm, results_root=td)
            path = Path(td) / f'issue-{adm["issue"]}' / adm['revision'][:16] / 'claim.json'
            lean_run.mark_phase(path, 'RUNNING')
            with self.assertRaises(lean_run.LeanError) as ctx:
                lean_run.mark_phase(path, 'RUNNING')
            self.assertEqual(ctx.exception.code, 'no_automatic_paid_replay')

    def test_revision_change_cannot_replay_same_claim_file(self):
        comment, _ = owner_task_comment()
        adm = lean_run.admit_comment(comment, {'number': 337, 'state': 'open'}, {'id': REPO_ID})
        with tempfile.TemporaryDirectory() as td:
            lean_run.claim_admission(adm, results_root=td)
            path = Path(td) / f'issue-{adm["issue"]}' / adm['revision'][:16] / 'claim.json'
            # Simulate foreign rewrite of revision field while reusing path.
            rec = lean_run.read_receipt(path)
            rec['revision'] = 'a' * 64
            lean_run.write_receipt(path, rec)
            with self.assertRaises(lean_run.LeanError) as ctx:
                lean_run.claim_admission(adm, results_root=td)
            self.assertEqual(ctx.exception.code, 'revision_changed_cannot_replay')

    def test_schedule_holds_running_without_charge(self):
        with tempfile.TemporaryDirectory() as td:
            comment, _ = owner_task_comment()
            adm = lean_run.admit_comment(comment, {'number': 337, 'state': 'open'}, {'id': REPO_ID})
            lean_run.claim_admission(adm, results_root=td)
            path = Path(td) / f'issue-{adm["issue"]}' / adm['revision'][:16] / 'claim.json'
            lean_run.mark_phase(path, 'UNKNOWN')
            out = lean_run.run_once({'event_name': 'schedule'}, results_root=td)
            self.assertEqual(out['status'], 'schedule_reconcile')
            self.assertTrue(out['holds'])
            self.assertEqual(out['holds'][0]['action'], 'HOLD_no_automatic_charge')


class VerdictReceiptTests(unittest.TestCase):
    def test_stale_sha_verdict_rejected(self):
        raw = json.dumps({
            'verdict': 'PASS', 'findings': [], 'reviewed_sha': 'b' * 40,
        })
        with self.assertRaises(providers.ProviderError) as ctx:
            providers.parse_qa_verdict(raw, 'a' * 40)
        self.assertEqual(ctx.exception.code, 'stale_sha_verdict')

    def test_parser_replay_no_charge(self):
        sha = 'c' * 40
        raw = json.dumps({'verdict': 'FAIL', 'findings': ['x'], 'reviewed_sha': sha})
        with mock.patch.object(providers, '_import_native', side_effect=providers.ProviderError('native_missing')):
            result = providers.parse_qa_verdict(raw, sha)
        self.assertEqual(result['verdict'], 'FAIL')
        self.assertEqual(result['charge'], 'none')

    def test_accepted_receipt_not_stdout(self):
        # Deployment stdout 0 is not acceptance — recover_publication requires receipt.
        with self.assertRaises(lean_run.LeanError):
            lean_run.recover_publication('deploy', deploy_run=1, receipt=None, live_sha='a' * 40)
        ok = lean_run.recover_publication(
            'deploy', deploy_run=99,
            receipt={'status': 'ACCEPTED', 'line': 'ACCEPTED'},
            live_sha='a' * 40)
        self.assertTrue(ok['accepted'])
        self.assertEqual(ok['action'], 'readback_only')

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


class AgyQuotaTests(unittest.TestCase):
    def test_quota_and_fallback_no_charge_on_parser_replay(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            # Empty quota → available
            ok, why, rec = providers.agy_quota_available(368, day_utc='2026-10-28')
            # Without results dir override, function uses global path; simulate via record_agy_charge root.
            providers.record_agy_charge(368, {'id': 'r1'}, charge='charged', day_utc='2026-10-28', results_root=root)
            providers.record_agy_charge(368, {'id': 'r2'}, charge='charged', day_utc='2026-10-28', results_root=root)
            providers.record_agy_charge(368, {'id': 'r3'}, charge='charged', day_utc='2026-10-28', results_root=root)
            providers.record_agy_charge(368, {'id': 'r4'}, charge='charged', day_utc='2026-10-28', results_root=root)
            providers.record_agy_charge(368, {'id': 'r5'}, charge='charged', day_utc='2026-10-28', results_root=root)
            path = root / 'agy-quota' / 'issue-368-2026-10-28.json'
            rec = providers.loads(path.read_bytes())
            self.assertEqual(rec['charged_calls'], 5)
            # Force read path by monkeypatching RESULTS_ROOT
            with mock.patch.object(providers, 'RESULTS_ROOT', root):
                avail, why, _ = providers.agy_quota_available(368, day_utc='2026-10-28')
                self.assertFalse(avail)
                self.assertEqual(why, 'agy_quota_exhausted')
            # Fallback selection when not READY
            with mock.patch.object(providers, 'role_ready', return_value=(False, 'absent')):
                provider, reason, _ = providers.select_qa_provider(
                    {'qaroute': ['agy_qa']}, issue=368)
            self.assertEqual(provider, 'codex_sol_medium')
            self.assertIn('fallback', reason)
            # Parser replay charge remains none
            sha = 'd' * 40
            with mock.patch.object(providers, '_import_native', side_effect=providers.ProviderError('native_missing')):
                parsed = providers.parse_qa_verdict(
                    json.dumps({'verdict': 'PASS', 'findings': [], 'reviewed_sha': sha}), sha)
            self.assertEqual(parsed['charge'], 'none')

    def test_unknown_charge_blocks_not_zero(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            providers.record_agy_charge(1, {'id': 'u'}, charge='unknown', day_utc='2026-10-28', results_root=root)
            with mock.patch.object(providers, 'RESULTS_ROOT', root):
                avail, why, rec = providers.agy_quota_available(1, day_utc='2026-10-28')
            self.assertFalse(avail)
            self.assertEqual(why, 'agy_quota_unknown_pending_reconcile')
            self.assertGreaterEqual(rec['unknown_calls'], 1)


class HostRequestTests(unittest.TestCase):
    def test_rejects_shell_and_arbitrary_paths(self):
        base = {
            'action': 'lean', 'run_id': 1, 'run_attempt': 1,
            'repository': REPO, 'repository_id': REPO_ID,
            'actor_id': OWNER, 'ref': 'refs/heads/dev',
            'event_name': 'workflow_dispatch',
            'workflow_sha': 'a' * 64, 'status': 'queued',
        }
        with self.assertRaises(lean_host.HostRefused):
            lean_host.validate_request(dict(base, command='id'))
        with self.assertRaises(lean_host.HostRefused):
            lean_host.validate_request(dict(base, source_path='/tmp/x'))
        lean_host.validate_request(base)

    def test_outsider_actor_refused(self):
        base = {
            'action': 'lean', 'run_id': 1, 'run_attempt': 1,
            'repository': REPO, 'repository_id': REPO_ID,
            'actor_id': 1, 'ref': 'refs/heads/dev',
            'event_name': 'workflow_dispatch',
            'workflow_sha': 'a' * 64, 'status': 'queued',
        }
        with self.assertRaises(lean_host.HostRefused):
            lean_host.validate_request(base)


class NextReadyTests(unittest.TestCase):
    def test_continues_independent_while_uat_pending(self):
        a = {'issue': 1, 'task': {'dependencies': [], 'priority': 1}}
        b = {'issue': 2, 'task': {'dependencies': [], 'priority': 5}}
        nxt = lean_run.pick_next_ready([a, b], uat_pending={1})
        self.assertEqual(nxt['issue'], 2)


class AuthorClaimsTests(unittest.TestCase):
    def test_author_pass_does_not_claim_ready(self):
        self.assertFalse(providers.AUTHOR_PASS_CLAIMS['agy_qa_ready'])
        self.assertFalse(providers.AUTHOR_PASS_CLAIMS['agy_author_ready'])
        self.assertFalse(providers.AUTHOR_PASS_CLAIMS['mode_b_active'])
        self.assertEqual(providers.AUTHOR_PASS_CLAIMS['model_calls'], 0)


if __name__ == '__main__':
    # Allow running from tools/train without package install.
    os.chdir(Path(__file__).resolve().parent)
    unittest.main()

"""Fail-closed GitHub Actions phase V2 immutable checkout and draft isolation tests."""
import pathlib
import re
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[3]
PIN='ae02bafc5558c707e900f21964b17f76112177ba'


class HostedPhaseV2(unittest.TestCase):
    def test_every_hosted_checkout_exact_same_reviewed_controller(self):
        for file, count in (('train-dispatch.yml',2),('train-stage.yml',2)):
            with self.subTest(file=file):
                text=(ROOT/'.github/workflows'/file).read_text()
                self.assertEqual(text.count('ref: '+PIN),count)
                self.assertNotIn('ref: 6b24848520ba01f66d764917a577aa1d2d189a45',text)
                self.assertEqual(len(re.findall(r'^\s+ref: [a-f0-9]{40}$',text,re.M)),count)

    def test_planning_writer_is_after_serialized_read_only_reconciliation(self):
        text=(ROOT/'.github/workflows/train-dispatch.yml').read_text()
        self.assertIn('group: gobadminton-train-dispatch',text)
        self.assertIn('cancel-in-progress: false',text)
        self.assertIn('queue: single',text)
        self.assertEqual(text.count('  publish_phase_drafts:'),1)
        publish=text.split('  publish_phase_drafts:')[1]
        self.assertIn('needs: reconcile',publish)
        self.assertIn("needs.reconcile.result == 'success'",publish)
        self.assertIn("github.ref == 'refs/heads/dev'",publish)
        self.assertIn("github.event_name == 'workflow_dispatch'",publish)
        self.assertIn('permissions:\n      contents: read\n      issues: write\n      actions: read',publish)
        self.assertIn('python3 -B scripts/chatops/planning/phase_plan_publish_v2.py',publish)
        self.assertIn('name: train-reconcile',publish)
        self.assertIn('name: phase-plan-publication',publish)
        self.assertIn('name: train-reconcile, path: evidence/',text)

    def test_writer_has_no_model_or_vps_credential(self):
        text=(ROOT/'.github/workflows/train-dispatch.yml').read_text()
        writer=text.split('  publish_phase_drafts:')[1]
        for banned in ('DEPLOY_HOST','DEPLOY_PORT','DEPLOY_SSH_KEY',
                       'DEPLOY_KNOWN_HOSTS','CURSOR_API_KEY',
                       'CODEX_HOME','AGY_TOKEN','environment: dev',
                       'actions: write','contents: write','pull-requests: write'):
            with self.subTest(banned=banned):
                self.assertNotIn(banned,writer)
        self.assertIn('persist-credentials: false',writer)
        self.assertNotIn('issues: write',text.split('  reconcile:')[1].split('  publish_phase_drafts:')[0])

    def test_no_second_scheduler_or_untrusted_webhook(self):
        text=(ROOT/'.github/workflows/train-dispatch.yml').read_text()
        self.assertEqual(text.count('  reconcile:'),1)
        self.assertIn("github.actor_id == '318610566'",text)
        self.assertIn("github.repository_id == '1416250340'",text)
        self.assertNotIn('issue_comment:',text)
        self.assertNotIn('schedule:',text)


if __name__=='__main__':
    unittest.main()

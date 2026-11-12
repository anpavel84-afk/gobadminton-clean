"""Real host-success and local Git isolation are publication preconditions."""
import ast
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import clean_publish_submit as submit
import runner


class HostSourcePublication(unittest.TestCase):
    def proposal(self):
        task = {'id': 'friends-dev-s1-api-20261013-v001'}
        return task, {'ok': True, 'project': 'GoBadminton', 'task_id': task['id']}

    def test_failed_codex_cannot_reach_any_git_or_writer_operation(self):
        task, receipt = self.proposal()
        for code in (1, -9, True, None, '0'):
            with self.subTest(code=code), patch.object(submit, 'workspace') as work, patch.object(submit, 'submit') as writer:
                with self.assertRaisesRegex(RuntimeError, 'successful Codex process exit'):
                    submit.finish_producer(task, '/untrusted', receipt,
                                           executor_pid=1234, executor_exit_code=code)
                work.assert_not_called(); writer.assert_not_called()

    def test_model_ok_without_real_pid_cannot_publish(self):
        task, receipt = self.proposal()
        for pid in (0, -1, True, None, '1234'):
            with self.subTest(pid=pid), patch.object(submit, 'workspace') as work:
                with self.assertRaises(RuntimeError):
                    submit.finish_producer(task, '/untrusted', receipt,
                                           executor_pid=pid, executor_exit_code=0)
                work.assert_not_called()

    def test_recovery_cannot_launder_nonzero_or_missing_exit_receipt(self):
        for code in (1, None, True, '0'):
            with self.subTest(code=code), patch.object(submit, 'protected_receipt') as read:
                self.assertFalse(submit.producer_is_published('friends-dev-s1-api-20261013-v001',
                                                             {'executor_pid': 1234, 'executor_exit_code': code}))
                read.assert_not_called()

    def test_git_process_does_not_inherit_writer_or_object_environment(self):
        result = SimpleNamespace(returncode=0, stdout='source', stderr='')
        with patch.object(submit.subprocess, 'run', return_value=result) as called:
            self.assertEqual(submit.git('/source', 'status', '--porcelain'), 'source')
        args = called.call_args.args[0]; env = called.call_args.kwargs['env']
        self.assertEqual(env['GIT_NO_REPLACE_OBJECTS'], '1')
        self.assertEqual(env['GIT_CONFIG_NOSYSTEM'], '1')
        self.assertEqual(env['GIT_CONFIG_GLOBAL'], '/dev/null')
        self.assertNotIn('GIT_ALTERNATE_OBJECT_DIRECTORIES', env)
        self.assertNotIn('GIT_SSH_COMMAND', env)
        self.assertIn('core.fsmonitor=false', args)
        self.assertIn('core.hooksPath=/dev/null', args)
        self.assertIn('credential.helper=', args)

    def test_only_fixed_worktree_can_submit(self):
        with patch.object(submit, 'git') as git:
            for slot, source in (('invented', '/source'), ('main-pm', '/tmp/pm'),
                                 ('friends-dev-s1-api-20261013-v001', '/srv/gobadminton-clean/worktrees/runner-radar-dev-map-ui-20261013-v001')):
                with self.subTest(slot=slot), self.assertRaises(RuntimeError):
                    submit.workspace(slot, source)
            git.assert_not_called()

    def test_second_attempts_use_only_same_fixed_branches_and_own_worktrees(self):
        self.assertEqual(set(submit.BRANCHES), {'main-pm',
            'friends-dev-s1-api-20261013-v001','radar-dev-map-ui-20261013-v001',
            'friends-dev-s1-api-20261013-v002','radar-dev-map-ui-20261013-v002'})
        for family in ('friends-dev-s1-api-20261013','radar-dev-map-ui-20261013'):
            original, successor = family + '-v001', family + '-v002'
            self.assertEqual(submit.BRANCHES[successor], submit.BRANCHES[original])
            self.assertEqual(submit.WORKTREES[successor].name, 'runner-' + successor)
            with patch.object(submit, 'git') as git:
                with self.assertRaises(RuntimeError):
                    submit.workspace(successor, submit.WORKTREES[original])
                with self.assertRaises(RuntimeError):
                    submit.workspace(family + '-v003', '/untrusted')
                git.assert_not_called()

    def test_second_attempt_nonzero_exit_retains_same_no_publication_boundary(self):
        task = {'id':'friends-dev-s1-api-20261013-v002'}
        receipt = {'ok':True,'project':'GoBadminton','task_id':task['id']}
        with patch.object(submit, 'workspace') as workspace, patch.object(submit, 'submit') as writer:
            with self.assertRaises(RuntimeError):
                submit.finish_producer(task, submit.WORKTREES[task['id']], receipt,
                                       executor_pid=1234, executor_exit_code=1)
            workspace.assert_not_called(); writer.assert_not_called()

    def test_actual_active_v2_denies_nonzero_before_completed_gate(self):
        source = Path(runner.__file__).read_text()
        tree = ast.parse(source)
        actual = [f for f in tree.body if isinstance(f, ast.FunctionDef) and f.name == 'run_claimed'][-1]
        text = ast.get_source_segment(source, actual)
        self.assertIn('proc.returncode == 0', text)
        position = text.index('if proc.returncode != 0:')
        completion = text.index('if tid.startswith("qa-") or "source_review" in task:')
        self.assertLess(position, completion)
        block = next(node for node in ast.walk(actual) if isinstance(node, ast.If)
                     and ast.unparse(node.test) == 'proc.returncode != 0')
        context = {'proc': SimpleNamespace(returncode=1), 'ok': True, 'reason': 'model ok'}
        isolated = ast.Module(body=[block], type_ignores=[])
        exec(compile(isolated, '<actual-v2-nonzero-gate>', 'exec'), context)
        self.assertFalse(context['ok'])

    def test_clean_codex_launches_explicitly_disable_apps_and_hooks(self):
        source = Path(runner.__file__).read_text(); tree = ast.parse(source)
        actual = [f for f in tree.body if isinstance(f, ast.FunctionDef) and f.name == 'launch_agent'][-1]
        text = ast.get_source_segment(source, actual)
        for flag in ('apps', 'remote_plugin', 'hooks', '--ignore-user-config', 'apps._default.enabled=false'):
            self.assertIn(flag, text)


if __name__ == '__main__':
    unittest.main()

"""Targeted adapter safety regressions; no runtime/GitHub or credentials used."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

if os.name == 'nt':
    # Pure wire/transport tests on Windows; no kernel lease claims are made.
    sys.modules.setdefault('fcntl', types.SimpleNamespace())

spec = importlib.util.spec_from_file_location('clean_publisher', Path(__file__).with_name('clean_publisher.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class PublisherSafety(unittest.TestCase):
    def request(self):
        return {'schema': 'GBCLEAN_PUBLISH_V1', 'task_id': next(iter(p.SLOTS)),
                'candidate_sha': 'a' * 40, 'candidate_tree': 'b' * 40,
                'expected_remote_sha': 'c' * 40, 'bundle_sha256': 'd' * 64}

    def test_fixed_task_and_branch_identity(self):
        value = self.request()
        p.validate_request(value['task_id'], value)
        self.assertEqual(p.SLOTS['radar-dev-map-ui-20261013-v001'], 'feature/radar-dev-real-map-20261013')

    def test_only_exact_second_attempts_alias_owner_bootstrap(self):
        for family in ('friends-dev-s1-api-20261013', 'radar-dev-map-ui-20261013'):
            original, successor = family + '-v001', family + '-v002'
            self.assertEqual(p.owner_producer(successor), original)
            self.assertEqual(p.SLOTS[successor], p.SLOTS[original])
            self.assertEqual(p.WORKTREES[successor].name, 'runner-' + successor)
            with self.assertRaises(p.Hold): p.owner_producer(family + '-v003')

    def test_policy_requires_exact_five_slots_and_unchanged_prepared_scope(self):
        config = {'task_baseline': {slot:(p.PREPARED_BASES[p.OWNER_PRODUCERS[slot]] if slot != 'main-pm' else 'a'*40) for slot in p.SLOTS},
                  'task_scopes': {slot:['docs'] for slot in p.SLOTS}}
        p.validate_slots(config)
        for mutate in ('scope', 'base', 'extra', 'missing'):
            changed = __import__('copy').deepcopy(config)
            if mutate == 'scope': changed['task_scopes']['friends-dev-s1-api-20261013-v002'] = ['apps']
            if mutate == 'base': changed['task_baseline']['friends-dev-s1-api-20261013-v002'] = 'b'*40
            if mutate == 'extra': changed['task_baseline']['friends-dev-s1-api-20261013-v003'] = 'b'*40
            if mutate == 'missing': changed['task_scopes'].pop('radar-dev-map-ui-20261013-v002')
            with self.subTest(mutate=mutate), self.assertRaises(p.Hold): p.validate_slots(changed)

    def test_receipt_cannot_supply_shell_paths_credentials_or_other_refs(self):
        for field in ('command', 'shell', 'worktree', 'branch', 'ssh_identity', 'remote', 'owner_ref'):
            value = self.request()
            value[field] = 'untrusted'
            with self.subTest(field=field), self.assertRaises(p.Hold):
                p.validate_request(value['task_id'], value)

    def test_other_task_and_author_refs_refused(self):
        for slot in ('qa-friends-dev-s1-api-20261013-v001', 'friends-other', '../../main-pm', 'refs/heads/main'):
            with self.subTest(slot=slot), self.assertRaises(p.Hold):
                p.validate_request(slot, self.request())

    def test_spoofed_task_identity_refused(self):
        value = self.request()
        value['task_id'] = 'main-pm'
        with self.assertRaises(p.Hold):
            p.validate_request(next(iter(p.SLOTS)), value)

    def test_invalid_actual_sha_inputs(self):
        for field in ('candidate_sha', 'candidate_tree', 'expected_remote_sha', 'bundle_sha256'):
            for bad in ('HEAD', 'a;touch /tmp/bypass', '\n' + 'a' * 40, None):
                value = self.request()
                value[field] = bad
                with self.subTest(field=field, bad=bad), self.assertRaises(p.Hold):
                    p.validate_request(value['task_id'], value)

    def test_candidate_cannot_change_other_slice_or_ops(self):
        for path in ('apps/web/page.ts', '_automation/gobadminton-runner/vps/runner.py', '../escape'):
            with self.subTest(path=path), self.assertRaises(p.Hold):
                p.check_paths([path], ['apps/api/src/friendships'])
        p.check_paths(['apps/api/src/friendships/friendships.service.ts'], ['apps/api/src/friendships'])

    def test_exact_reuse_without_reauthoring_supported(self):
        p.check_paths([], ['apps/api/src/friendships'])

    def test_ambiguous_restart_never_retries_transport(self):
        previous = {'request_sha256': 'd' * 64, 'status': 'ATTEMPTING'}
        with self.assertRaises(p.Hold):
            p.assert_replay(previous, 'd' * 64, 'a' * 40, 'a' * 40)

    def test_changed_request_and_remote_on_replay_refused(self):
        previous = {'request_sha256': 'd' * 64, 'status': 'PUBLISHED'}
        with self.assertRaises(p.Hold):
            p.assert_replay(previous, 'e' * 64, 'a' * 40, 'a' * 40)
        with self.assertRaises(p.Hold):
            p.assert_replay(previous, 'd' * 64, 'b' * 40, 'a' * 40)
        self.assertTrue(p.assert_replay(previous, 'd' * 64, 'a' * 40, 'a' * 40))

    def test_observed_existing_is_truthful_idempotent(self):
        previous = {'request_sha256': 'd' * 64, 'status': 'OBSERVED_EXISTING', 'real_publication': False}
        self.assertTrue(p.assert_replay(previous, 'd' * 64, 'a' * 40, 'a' * 40))

    def test_next_request_progresses_only_from_exact_published_head(self):
        previous = {'request_sha256': 'd' * 64, 'status': 'PUBLISHED', 'candidate_sha': 'a' * 40}
        self.assertEqual(p.previous_action(previous, 'e' * 64, 'a' * 40, 'b' * 40), 'ADVANCE')
        self.assertEqual(p.previous_action(previous, 'd' * 64, 'a' * 40, 'a' * 40), 'REPLAY')
        with self.assertRaises(p.Hold):
            p.previous_action(previous, 'e' * 64, 'c' * 40, 'b' * 40)

    def test_different_request_cannot_hide_ambiguous_attempt_or_blocked_result(self):
        for status in ('ATTEMPTING', 'BLOCKED', 'RECONCILE_REQUIRED', None):
            previous = {'request_sha256': 'd' * 64, 'status': status, 'candidate_sha': 'a' * 40}
            with self.subTest(status=status), self.assertRaises(p.Hold):
                p.previous_action(previous, 'e' * 64, 'a' * 40, 'b' * 40)

    def test_same_request_does_not_accept_changed_candidate(self):
        previous = {'request_sha256': 'd' * 64, 'status': 'PUBLISHED', 'candidate_sha': 'a' * 40}
        with self.assertRaises(p.Hold):
            p.previous_action(previous, 'd' * 64, 'a' * 40, 'b' * 40)

    def test_duplicate_request_keys_refused(self):
        with self.assertRaises(p.Hold):
            p.strict(b'{"task_id":"friends","task_id":"main-pm"}')

    def test_privileged_or_wrong_process_cannot_borrow_credential(self):
        for actual in (0, 1002):
            with patch.object(p.os, 'geteuid', return_value=actual, create=True), self.assertRaises(p.Hold):
                p.git_environment({'publisher_uid': 1001})

    def test_git_environment_does_not_inherit_executor_credential_helpers(self):
        account = types.SimpleNamespace(getpwnam=lambda _: types.SimpleNamespace(pw_uid=1001))
        with patch.dict(sys.modules, {'pwd': account}), patch.object(p.os, 'geteuid', return_value=1001, create=True), patch.object(p, 'secure_read', return_value=b'fixture'):
            env = p.git_environment({'publisher_uid': 1001})
        self.assertNotIn('SSH_AUTH_SOCK', env)
        self.assertNotIn('GITHUB_TOKEN', env)
        self.assertNotIn('PYTHONPATH', env)
        values = {env['GIT_CONFIG_KEY_' + str(i)]: env['GIT_CONFIG_VALUE_' + str(i)]
                  for i in range(int(env['GIT_CONFIG_COUNT']))}
        self.assertEqual(values['credential.helper'], '')
        self.assertEqual(values['remote.origin.url'], p.REMOTE)
        self.assertEqual(values['core.hooksPath'], '/dev/null')
        self.assertIn('IdentitiesOnly=yes', values['core.sshCommand'])

    def test_only_fixed_clean_credential_paths_are_read_and_used(self):
        account = types.SimpleNamespace(getpwnam=lambda _: types.SimpleNamespace(pw_uid=988))
        with patch.dict(sys.modules, {'pwd': account}), patch.object(p.os, 'geteuid', return_value=988, create=True), \
                patch.object(p, 'secure_read', return_value=b'fixture') as reads:
            env = p.git_environment({'publisher_uid': 988})
        expected = Path('/etc/gobadminton-clean-control-plane/credentials')
        self.assertEqual([call.args[0] for call in reads.call_args_list],
                         [expected / 'github-publisher-identity', expected / 'github-known-hosts'])
        self.assertTrue(all(call.args[1] == 0 for call in reads.call_args_list))
        values = {env['GIT_CONFIG_KEY_' + str(i)]: env['GIT_CONFIG_VALUE_' + str(i)]
                  for i in range(int(env['GIT_CONFIG_COUNT']))}
        self.assertIn(str(expected / 'github-publisher-identity'), values['core.sshCommand'])
        self.assertIn(str(expected / 'github-known-hosts'), values['core.sshCommand'])
        self.assertNotIn('gobadminton-control-plane-v3-publisher', values['core.sshCommand'])
        self.assertNotIn('id_ed25519', values['core.sshCommand'])

    def test_historical_or_task_selected_credential_path_is_refused(self):
        with patch.object(p, 'secure_read') as read:
            for field in ('ssh_identity', 'ssh_known_hosts', 'credential_path', 'ssh_command'):
                with self.subTest(field=field), self.assertRaises(p.Hold):
                    p.git_environment({'publisher_uid': 988, field: '/etc/gobadminton-control-plane-v3-publisher/credentials/github-publisher-identity'})
            read.assert_not_called()

    def test_git_never_uses_request_repository_or_shell(self):
        with self.assertRaises(p.Hold):
            p.run_git(Path('/tmp/executor'), ['status'])
        result = types.SimpleNamespace(returncode=0, stdout='a' * 40 + '\n')
        with patch.object(p.subprocess, 'run', return_value=result) as executed:
            self.assertEqual(p.run_git(p.REPO, ['rev-parse', 'HEAD']), 'a' * 40)
        args, kwargs = executed.call_args
        self.assertEqual(args[0][0], '/usr/bin/git')
        self.assertNotIn('shell', kwargs)

    def test_source_snapshot_is_exact_worktree_and_has_no_writer_key(self):
        value = self.request()
        source = p.WORKTREES[value['task_id']]
        metadata = 'gitdir: ' + str(Path('/srv/gobadminton-clean/repo/.git/worktrees') / source.name)
        results = [types.SimpleNamespace(returncode=0, stdout=value['candidate_sha']),
                   types.SimpleNamespace(returncode=0, stdout=value['candidate_tree']),
                   types.SimpleNamespace(returncode=0, stdout='')]
        info = types.SimpleNamespace(st_mode=__import__('stat').S_IFDIR | 0o750, st_uid=1002)
        with patch.object(p.Path, 'is_symlink', return_value=False), patch.object(p.Path, 'is_dir', return_value=True), \
                patch.object(p.Path, 'exists', return_value=False), patch.object(p.Path, 'lstat', return_value=info), \
                patch.object(p, 'secure_read', side_effect=[metadata.encode(), b'../..\n']), patch.object(p.subprocess, 'run', side_effect=results) as calls:
            p.verify_source_worktree(value['task_id'], value, 1002)
        for call in calls.call_args_list:
            self.assertEqual(call.args[0][3], str(source))
            self.assertNotIn('GIT_SSH_COMMAND', call.kwargs['env'])
            self.assertNotIn('github-publisher-identity', str(call.kwargs['env']))
            env = call.kwargs['env']
            config = {env['GIT_CONFIG_KEY_' + str(n)]: env['GIT_CONFIG_VALUE_' + str(n)] for n in range(int(env['GIT_CONFIG_COUNT']))}
            self.assertEqual(config['core.fsmonitor'], 'false')
            self.assertEqual(config['core.sshCommand'], '/bin/false')
            self.assertEqual(config['protocol.ext.allow'], 'never')

    def test_source_git_metadata_substitution_refused(self):
        value = self.request()
        with patch.object(p.Path, 'is_symlink', return_value=False), patch.object(p.Path, 'is_dir', return_value=True), \
                patch.object(p, 'secure_read', return_value=b'gitdir: /tmp/attacker'), patch.object(p.subprocess, 'run') as calls:
            with self.assertRaises(p.Hold):
                p.verify_source_worktree(value['task_id'], value, 1002)
        calls.assert_not_called()

    def test_source_common_object_redirect_or_alternate_refused_before_git(self):
        value = self.request()
        source = p.WORKTREES[value['task_id']]
        metadata = 'gitdir: ' + str(Path('/srv/gobadminton-clean/repo/.git/worktrees') / source.name)
        info = types.SimpleNamespace(st_mode=__import__('stat').S_IFDIR | 0o750, st_uid=1002)
        for common, alternates in ((b'/tmp/attacker', False), (b'../..', True)):
            with self.subTest(common=common, alternates=alternates), patch.object(p.Path, 'is_symlink', return_value=False), \
                    patch.object(p.Path, 'is_dir', return_value=True), patch.object(p.Path, 'lstat', return_value=info), \
                    patch.object(p.Path, 'exists', return_value=alternates), patch.object(p, 'secure_read', side_effect=[metadata.encode(), common]), \
                    patch.object(p.subprocess, 'run') as calls:
                with self.assertRaises(p.Hold):
                    p.verify_source_worktree(value['task_id'], value, 1002)
                calls.assert_not_called()

    def test_stale_remote_refuses_before_bundle_or_transport(self):
        value = self.request()
        with patch.object(p.Path, 'exists', side_effect=[True, False]), patch.object(p, 'secure_read', return_value=json.dumps(value).encode()), \
                patch.object(p, 'remote_head', return_value='e' * 40), \
                patch.object(p, 'run_git') as transport:
            with self.assertRaises(p.Hold):
                p.publish_slot(value['task_id'], {'submitter_uid': 1002}, None, None)
            transport.assert_not_called()


if __name__ == '__main__':
    unittest.main()

"""Adversarial source-only tests. Never run Codex, Docker or install a service."""
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

import clean_qa_job as qa
import test_job_contract as contract


class CleanQAJobSafety(unittest.TestCase):
    def inputs(self):
        task = 'qa-radar-dev-map-ui-20261013-v001'
        producer, suite, _ = qa.SUITES[task]
        queue = {'tasks': [{'id': task, 'enabled': True, 'source_qa': {'producer_task_id': producer, 'suite_id': suite},
                            'depends_on_completed': [producer], 'effect_ceiling': 'source_only'}, {'id': producer, 'enabled': True}]}
        receipt = {'project': 'GoBadminton', 'task_id': producer, 'ok': True,
                   'candidate_sha': 'a' * 40, 'candidate_tree': 'b' * 40,
                   'branch': 'feature/radar-dev-real-map-20261013'}
        return task, queue, receipt

    def test_binding_uses_canonical_registry_not_task_commands(self):
        task, queue, receipt = self.inputs()
        identity, app = qa.bind(task, queue, receipt)
        self.assertEqual(app, 'web')
        self.assertEqual(identity['candidate_sha'], receipt['candidate_sha'])
        queue['tasks'][0]['source_qa']['suite_id'] = 'arbitrary-shell'
        with self.assertRaises(ValueError): qa.bind(task, queue, receipt)

    def test_cross_task_producer_receipt_rejected(self):
        task, queue, receipt = self.inputs()
        receipt['task_id'] = qa.SUITES['qa-friends-dev-s1-api-20261013-v001'][0]
        with self.assertRaises(ValueError): qa.bind(task, queue, receipt)

    def test_unregistered_job_rejected(self):
        _, queue, receipt = self.inputs()
        with self.assertRaises(ValueError): qa.bind('qa-arbitrary', queue, receipt)

    def test_receipt_redirect_and_non_source_effect_rejected(self):
        for field, value in [('receipt', '/tmp/fake.json'), ('effect_ceiling', 'dev_release'),
                             ('depends_on_completed', []), ('depends_on_accepted', ['other'])]:
            task, queue, receipt = self.inputs()
            queue['tasks'][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): qa.bind(task, queue, receipt)

    def test_remote_refs_and_shell_like_branches_rejected(self):
        for branch in ['https://evil/x', 'feature/../main', 'feature/x;id', '-cfoo', 'feature/x.lock']:
            task, queue, receipt = self.inputs()
            receipt['branch'] = branch
            with self.subTest(branch=branch), self.assertRaises(ValueError): qa.bind(task, queue, receipt)

    def test_claimed_sha_must_be_full_hex(self):
        task, queue, receipt = self.inputs()
        receipt['candidate_tree'] = 'g' * 40
        with self.assertRaises(ValueError): qa.bind(task, queue, receipt)

    def archive(self, name, kind=tarfile.REGTYPE):
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode='w') as archive:
            member = tarfile.TarInfo(name); member.type = kind
            if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE): member.linkname = '/etc/shadow'
            archive.addfile(member)
        return buffer.getvalue()

    def test_archive_path_escape_and_special_files_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            for name, kind in [('../escape', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE),
                               ('link', tarfile.SYMTYPE), ('hard', tarfile.LNKTYPE), ('dev', tarfile.CHRTYPE)]:
                with self.subTest(name=name), self.assertRaises(ValueError):
                    qa.extract_archive(self.archive(name, kind), Path(temporary))

    def test_real_reporter_only_positive_no_skipped_tests(self):
        report = {'numTotalTests': 428, 'numPassedTests': 428, 'numFailedTests': 0, 'numPendingTests': 0, 'success': True}
        self.assertEqual(qa.count_json(b'noise\n' + json.dumps(report).encode()), 428)
        for field, value in [('numTotalTests', 0), ('numTotalTests', True), ('numFailedTests', 1),
                             ('numPendingTests', 1), ('numPassedTests', 0), ('success', False)]:
            altered = {**report, field: value}
            with self.subTest(field=field), self.assertRaises(ValueError): qa.count_json(json.dumps(altered).encode())
        with self.assertRaises(ValueError): qa.count_json(b'421 tests PASS (model says so)')

    def test_reviewer_wrong_receipt_job_or_blocker_cannot_authorize(self):
        receipt = {'actual': 'receipt'}
        valid = {'job_id': 'job', 'receipt_sha': contract.digest(receipt), 'verdict': 'PASS', 'blocking_findings': [],
                 'merge_recommendation': 'MERGE_RECOMMENDED'}
        self.assertEqual(qa.reviewer_result(json.dumps(valid), receipt, 'job'), valid)
        for field, value in [('receipt_sha', '0' * 64), ('job_id', 'other'), ('verdict', 'BLOCKED'),
                             ('blocking_findings', ['privacy defect'])]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                qa.reviewer_result(json.dumps({**valid, field: value}), receipt, 'job')
        with self.assertRaises(ValueError):
            qa.reviewer_result(json.dumps({**valid, 'reviewer_id': 'self-authorized'}), receipt, 'job')

    def test_merge_recommendation_must_be_explicit_actual_bound_reviewer_output(self):
        receipt = {'actual': 'successful tests do not authorize merging'}
        reviewed = {'job_id': 'real-nonce', 'receipt_sha': contract.digest(receipt), 'verdict': 'PASS',
                    'blocking_findings': [], 'merge_recommendation': 'MERGE_RECOMMENDED'}
        self.assertEqual(qa.reviewer_result(json.dumps(reviewed), receipt, 'real-nonce')['merge_recommendation'], 'MERGE_RECOMMENDED')
        absent = {key: value for key, value in reviewed.items() if key != 'merge_recommendation'}
        for invalid in [absent, {**reviewed, 'merge_recommendation': 'MERGE_NOT_RECOMMENDED'},
                        {**reviewed, 'merge_recommendation': True}, {**reviewed, 'job_id': 'another-nonce'},
                        {**reviewed, 'blocking_findings': ['privacy defect']}]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                qa.reviewer_result(json.dumps(invalid), receipt, 'real-nonce')

    def test_dependency_fingerprint_changes_on_actual_byte_mutation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'dependency.js').write_text('safe')
            before = qa.tree_sha(root)
            (root / 'dependency.js').write_text('changed')
            self.assertNotEqual(before, qa.tree_sha(root))

    def test_sandbox_drops_privileges_and_never_mounts_writer_credentials(self):
        fake_pwd = types.SimpleNamespace(getpwnam=lambda _: types.SimpleNamespace(pw_uid=1234, pw_gid=1234))
        with patch.dict(sys.modules, {'pwd': fake_pwd}):
            command = qa.sandbox(Path('/snapshot'), 'api', 'qa', 999)
            self.assertEqual(command[:5], ['/usr/bin/nsenter', '--target', '999', '--net', '--'])
            self.assertNotIn('/usr/bin/setpriv', command); self.assertIn('--unshare-all', command)
            self.assertEqual(command[command.index('--uid') + 1], '1234')
            self.assertEqual(command[command.index('--gid') + 1], '1234')
            self.assertEqual(command[command.index('--cap-drop') + 1], 'ALL')
            self.assertIn('--share-net', command)
            self.assertIn('postgresql://qa:disposable-only@127.0.0.1:5432/gobadminton_friends_s1_disposable', command)
            self.assertIn('RUN_DB_INTEGRATION', command)
            self.assertNotIn('/var/run/docker.sock', command)
            self.assertNotIn('/home/agentagency-dev', command)
            radar = qa.sandbox(Path('/snapshot'), 'web', 'qa')
            self.assertNotIn('--share-net', radar)

    def test_sandbox_root_account_refused(self):
        fake_pwd = types.SimpleNamespace(getpwnam=lambda _: types.SimpleNamespace(pw_uid=0, pw_gid=0))
        with patch.dict(sys.modules, {'pwd': fake_pwd}), self.assertRaises(ValueError):
            qa.sandbox(Path('/snapshot'), 'web', 'root')

    def test_reviewer_root_namespace_creator_drops_nonroot_identity_and_all_caps(self):
        user = types.SimpleNamespace(pw_uid=985, pw_gid=977)
        command = qa.review_sandbox(Path('/snapshot'), Path('/job'), Path('/job/output'), user)
        self.assertEqual(command[0], '/usr/bin/bwrap')
        self.assertNotIn('/usr/bin/setpriv', command)
        self.assertEqual(command[command.index('--uid') + 1], '985')
        self.assertEqual(command[command.index('--gid') + 1], '977')
        self.assertEqual(command[command.index('--cap-drop') + 1], 'ALL')
        self.assertIn('--unshare-all', command); self.assertIn('--share-net', command)
        self.assertNotIn('/var/run/docker.sock', command)
        self.assertNotIn('/home/agentagency-dev', command)
        with self.assertRaises(ValueError):
            qa.review_sandbox(Path('/snapshot'), Path('/job'), Path('/job/output'), types.SimpleNamespace(pw_uid=0, pw_gid=0))

    def test_disposable_database_cleanup_on_suite_exception(self):
        commands = []
        def checked(command, **kwargs):
            commands.append(command)
            if command[1:3] == ['image', 'inspect']: return b'sha256:' + b'a' * 64
            if command[1] == 'inspect':
                return json.dumps([{'Mounts': [], 'HostConfig': {'NetworkMode': 'none'}, 'State': {'Pid': 999}}]).encode()
            return b'created'
        with patch.object(qa, 'checked', side_effect=checked), patch.object(qa, 'run', return_value=(0, b'')):
            with self.assertRaisesRegex(RuntimeError, 'suite failed'):
                with qa.disposable_database(): raise RuntimeError('suite failed')
        launch = next(c for c in commands if c[1] == 'run')
        self.assertIn('--pull=never', launch); self.assertIn('none', launch)
        self.assertNotIn('-p', launch); self.assertNotIn('--volume', launch)
        self.assertEqual(commands[-1][1:4], ['rm', '--force', '--volumes'])
        self.assertEqual(commands[-1][-1], launch[launch.index('--name') + 1])

    def test_fixed_registry_does_not_execute_package_manager_scripts(self):
        for app in ('api', 'web'):
            commands = qa.suite_commands(app)
            self.assertTrue(all(command[0] == '/qa-tools/node/bin/node' for command in commands))
            self.assertFalse(any('install' in command or 'run-script' in command for command in commands))
        with self.assertRaises(ValueError): qa.suite_commands('other')

    def test_disabled_producer_or_qa_is_not_admitted(self):
        for index in (0, 1):
            task, queue, receipt = self.inputs(); queue['tasks'][index]['enabled'] = False
            with self.assertRaises(ValueError): qa.bind(task, queue, receipt)

    def test_duplicate_task_identity_is_not_canonical(self):
        task, queue, receipt = self.inputs(); queue['tasks'].append(dict(queue['tasks'][0]))
        with self.assertRaises(ValueError): qa.bind(task, queue, receipt)

    def test_duplicate_input_keys_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'state.json'; path.write_bytes(b'{"enabled":false,"enabled":true}')
            with self.assertRaises(ValueError): qa.regular_json(path)

    def test_git_environment_hooks_helpers_and_replace_objects_are_disabled(self):
        command = qa.git_command(Path('/private/publisher/repo'))
        for item in ('core.hooksPath=/dev/null', 'core.fsmonitor=false', 'credential.helper=', 'core.useReplaceRefs=false'):
            self.assertIn(item, command)
        self.assertEqual(qa.TRUSTED_ENV['GIT_CONFIG_GLOBAL'], '/dev/null')
        self.assertEqual(qa.TRUSTED_ENV['GIT_CONFIG_SYSTEM'], '/dev/null')
        self.assertEqual(qa.TRUSTED_ENV['GIT_CONFIG_NOSYSTEM'], '1')
        self.assertEqual(qa.TRUSTED_ENV['GIT_NO_REPLACE_OBJECTS'], '1')
        self.assertNotIn('GIT_SSH_COMMAND', qa.TRUSTED_ENV)
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary); metadata = repo / '.git'; metadata.mkdir()
            qa.verify_git_metadata(repo)
            (metadata / 'objects/info').mkdir(parents=True)
            alternate = metadata / 'objects/info/alternates'; alternate.write_text('/writer/object/store')
            with self.assertRaises(ValueError): qa.verify_git_metadata(repo)
            alternate.unlink(); (metadata / 'packed-refs').write_text('a' * 40 + ' refs/replace/' + 'b' * 40)
            with self.assertRaises(ValueError): qa.verify_git_metadata(repo)

    def test_no_other_feature_branch_can_claim_fixed_suite(self):
        task, queue, receipt = self.inputs(); receipt['branch'] = qa.BRANCHES['api']
        with self.assertRaises(ValueError): qa.bind(task, queue, receipt)

    def test_independent_publisher_proof_must_match_task_branch_tree_sha_and_real_push(self):
        task, queue, receipt = self.inputs(); identity, _ = qa.bind(task, queue, receipt)
        record = {'schema': 'GBCLEAN_PUBLISH_RECEIPT_V1', 'status': 'PUBLISHED', 'real_publication': True,
                  'task_id': identity['producer_task_id'], **{key: identity[key] for key in ('candidate_sha', 'candidate_tree', 'branch')}}
        self.assertEqual(qa.validate_publication(identity, record), record)
        for field, value in [('status', 'ATTEMPTING'), ('real_publication', False), ('candidate_sha', 'c' * 40),
                             ('candidate_tree', 'd' * 40), ('branch', qa.BRANCHES['api']), ('task_id', 'other')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                qa.validate_publication(identity, {**record, field: value})

    def test_isolated_import_rejects_mutable_local_code_and_module_injection(self):
        with self.assertRaises(ValueError): qa.code_module('evil')
        with patch.object(qa.sys, 'flags', types.SimpleNamespace(isolated=True)):
            with tempfile.TemporaryDirectory() as temporary, self.assertRaises(ValueError):
                qa.code_module('test_job_contract', Path(temporary))

    def test_fixed_reviewer_model_and_no_apps_hooks_remote_plugins(self):
        for app, expected in [('api', 'gpt-6.1-sol'), ('web', 'gpt-6-astra')]:
            command = qa.reviewer_command(app, 'actual independent review')
            self.assertEqual(command[command.index('--model') + 1], expected)
            self.assertEqual(command[command.index('--sandbox') + 1], 'read-only')
            disabled = [command[index + 1] for index, value in enumerate(command) if value == '--disable']
            self.assertEqual(set(disabled), {'apps', 'remote_plugin', 'hooks'})
            self.assertIn('--ignore-user-config', command)
            self.assertIn('apps._default.enabled=false', command)
            self.assertIn('model_reasoning_effort="high"', command)
            self.assertNotIn('--dangerously-bypass-approvals-and-sandbox', command)

    def test_web_reporter_json_is_actual_stdout_not_private_disappearing_file(self):
        reports = qa.suite_commands('web')[:2]
        for command in reports:
            self.assertIn('--reporter=json', command)
            self.assertFalse(any(value.startswith('--outputFile') for value in command))

    def test_actual_wait_claim_required_and_other_waiter_pid_rejected(self):
        task, _, _ = self.inputs()
        state = {'active': {task: {'attempt': 2, 'agent_pid': 4444, 'started_at': 'now'}}}
        self.assertEqual(qa.active_attempt(task, state, waiter_pid=4444)['attempt'], 2)
        with self.assertRaises(ValueError): qa.active_attempt(task, state, waiter_pid=5555)
        with self.assertRaises(ValueError): qa.active_attempt(task, {'active': {}})

    def test_stale_blocked_attempt_or_candidate_does_not_abort_current_retry(self):
        task, queue, receipt = self.inputs(); identity, _ = qa.bind(task, queue, receipt)
        claim = {'attempt': 2, 'waiter_pid': 4444, 'started_at': 'new'}
        blocked = {'phase': 'BLOCKED', 'claim': claim, 'candidate_sha': identity['candidate_sha']}
        self.assertTrue(qa.current_failure(blocked, claim, identity))
        self.assertFalse(qa.current_failure({**blocked, 'claim': {**claim, 'attempt': 1}}, claim, identity))
        self.assertFalse(qa.current_failure({**blocked, 'candidate_sha': 'c' * 40}, claim, identity))

    def test_wait_receipt_uses_protected_shared_file_mode_and_group(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'receipt.json'
            with (patch.object(qa.access, 'file_access', return_value=(0o640, 71)) as access,
                  patch.object(qa.os, 'O_NOFOLLOW', 0, create=True),
                  patch.object(qa.os, 'fchown', create=True) as chown,
                  patch.object(qa.os, 'fchmod', create=True) as chmod):
                qa.write_runner_receipt(path, b'{"real":"root verified"}')
                access.assert_called_once_with(path)
                self.assertEqual(chown.call_args.args[1:], (-1, 71))
                self.assertEqual(chmod.call_args.args[1], 0o640)
            self.assertEqual(path.read_bytes(), b'{"real":"root verified"}')


if __name__ == '__main__': unittest.main()

"""DEV-only proof, command, migration, archive and rollback safety tests."""
import hashlib
import importlib.util
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

if os.name == 'nt':
    sys.modules.setdefault('fcntl', types.SimpleNamespace())
spec = importlib.util.spec_from_file_location('clean_dev_release', Path(__file__).with_name('clean_dev_release.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class DevRelease(unittest.TestCase):
    def proof(self):
        qa_id = next(iter(r.SUITES))
        producer_id = qa_id.removeprefix('qa-')
        candidate = {'candidate_sha': 'a' * 40, 'candidate_tree': 'b' * 40,
                     'branch': 'feature/friends-s1-clean-source-20261013'}
        publication = {'schema': 'GBCLEAN_PUBLISH_RECEIPT_V1', 'task_id': 'main-pm',
                       'candidate_sha': 'c' * 40, 'candidate_tree': 'd' * 40,
                       'expected_remote_sha': 'f' * 40,
                       'status': 'PUBLISHED', 'real_publication': True, 'branch': 'main'}
        planner = {'result_commit': 'c' * 40, 'action': 'merged', 'accepted_qa_task_id': qa_id,
                   'merged_candidate_sha': 'a' * 40}
        qa = {**candidate, 'project': 'GoBadminton', 'task_id': qa_id, 'producer_task_id': producer_id, 'ok': True,
              'acceptance_state': 'SOURCE_ACCEPTED', 'verdict': 'PASS', 'blocking_findings': [],
              'merge_recommendation': 'MERGE_RECOMMENDED',
              'trusted_job': 'e' * 64}
        producer = {**candidate, 'project': 'GoBadminton', 'task_id': producer_id, 'ok': True}
        identity = {'schema_version': 1, 'qa_task_id': qa_id, 'producer_task_id': producer_id,
                    **candidate, 'suite_id': r.SUITES[qa_id]}
        contract = types.SimpleNamespace(verify_runner_receipt=lambda *_: None,
            digest=lambda value: hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest())
        policy = {'source_qa_authorizations': {'e' * 64: contract.digest(identity)}}
        job = {'job': {'source_tree': 'b' * 40, 'suite_id': r.SUITES[qa_id]}}
        contract.protected_json = lambda path: policy if path.name == 'policy.json' else job
        return publication, planner, qa, producer, contract

    def test_only_actual_new_main_publication_releases(self):
        publication, planner, qa, producer, contract = self.proof()
        r.bind(publication, planner, qa, producer, {}, contract)
        for field, bad in [('real_publication', False), ('status', 'OBSERVED_EXISTING'),
                           ('task_id', producer['task_id']), ('branch', 'feature/owner')]:
            changed = {**publication, field: bad}
            with self.subTest(field=field), self.assertRaises(r.Blocked):
                r.bind(changed, planner, qa, producer, {}, contract)

    def test_admission_only_is_not_release_right(self):
        publication, planner, qa, producer, contract = self.proof()
        planner['action'] = 'enqueued'
        with self.assertRaises(r.Blocked):
            r.bind(publication, planner, qa, producer, {}, contract)

    def test_only_second_attempt_own_qa_can_release(self):
        self.assertEqual(set(r.SUITES), {'qa-friends-dev-s1-api-20261013-v002','qa-radar-dev-map-ui-20261013-v002'})
        for unsupported in ('qa-friends-dev-s1-api-20261013-v001','qa-friends-dev-s1-api-20261013-v003'):
            publication, planner, qa, producer, contract = self.proof()
            planner['accepted_qa_task_id'] = unsupported
            with self.subTest(unsupported=unsupported), self.assertRaises(r.Blocked):
                r.bind(publication, planner, qa, producer, {}, contract)

    def test_source_pass_without_independent_merge_recommendation_is_denied(self):
        publication, planner, qa, producer, contract = self.proof()
        qa.pop('merge_recommendation')
        with self.assertRaises(r.Blocked):
            r.bind(publication, planner, qa, producer, {}, contract)

    def test_dev_policy_cannot_switch_preimage_paths_or_collapse_browser_actor(self):
        authority = {'owner_event': {'comment_id': 6148670164}, 'publisher_uid': 988,
                     'submitter_uid': 1005, 'runtime_gid': 989}
        policy = {**authority, 'schema': 'GBCLEAN_DEV_RELEASE_POLICY_V1', 'browser_uid': 991,
                  'module_sha256': {name:'a'*64 for name in ('clean_dev_release.py','clean_runtime_access.py','test_job_contract.py')},
                  'compose_sha256': {path.name:'b'*64 for path in (*r.COMPOSE, r.DEV/'.env')},
                  'approved_additive_migrations': {'0032_friendship_core':'c'*64},
                  'node_sha256':'d'*64, 'browser_sha256':'e'*64, 'browser_dependencies_sha256':'f'*64}
        r.validate_policy(policy, authority)
        for key, value in [('browser_uid',1005), ('browser_uid',True),
                           ('compose_sha256',{'docker-compose.yml':'b'*64,'arbitrary-overlay.yml':'b'*64}),
                           ('node_sha256','latest')]:
            with self.subTest(key=key), self.assertRaises(r.Blocked):
                r.validate_policy({**policy,key:value}, authority)

    def test_sibling_qa_or_different_candidate_cannot_authorize(self):
        for field, value in [('task_id', 'qa-radar-dev-map-ui-20261013-v001'),
                             ('candidate_sha', 'f' * 40), ('candidate_tree', 'f' * 40),
                             ('producer_task_id', 'radar-dev-map-ui-20261013-v001')]:
            publication, planner, qa, producer, contract = self.proof()
            qa[field] = value
            with self.subTest(field=field), self.assertRaises(r.Blocked):
                r.bind(publication, planner, qa, producer, {}, contract)

    def test_author_or_revoked_root_job_denial_is_not_reinterpreted(self):
        publication, planner, qa, producer, contract = self.proof()
        def author_denied(*_):
            raise ValueError('author cannot review own source')
        contract.verify_runner_receipt = author_denied
        with self.assertRaises(ValueError):
            r.bind(publication, planner, qa, producer, {}, contract)

    def test_protected_job_suite_or_tree_substitution_refused(self):
        publication, planner, qa, producer, contract = self.proof()
        original = contract.protected_json
        contract.protected_json = lambda path: original(path) if path.name == 'policy.json' else {'job': {'source_tree': 'f' * 40, 'suite_id': 'author-ci'}}
        with self.assertRaises(r.Blocked):
            r.bind(publication, planner, qa, producer, {}, contract)

    def test_immutable_image_ids_and_only_git_version_overlay(self):
        overlay = r.overlay('sha256:' + 'a' * 64, 'sha256:' + 'b' * 64, 'c' * 40)
        self.assertEqual(set(overlay['services']), {'api', 'web', 'migrate'})
        self.assertEqual(overlay['services']['api']['environment'], {'GIT_SHA': 'c' * 40})
        self.assertEqual(overlay['services']['web']['environment'], {'GIT_SHA': 'c' * 40})
        self.assertNotIn('volumes', str(overlay))
        self.assertNotIn('NODE_ENV', str(overlay))
        for bad in ('latest', 'owner/image:tag', 'sha256:' + 'g' * 64):
            with self.assertRaises(r.Blocked):
                r.overlay(bad, 'sha256:' + 'b' * 64, 'c' * 40)

    def test_rollback_restores_exact_previous_environment_without_gate_override(self):
        old = {'api': {'NODE_ENV': 'production', 'GIT_SHA': 'f' * 40, 'FRIENDS_INTERNAL_ENABLED': '0'},
               'web': {'NODE_ENV': 'production'}}
        overlay = r.overlay('sha256:' + 'a' * 64, 'sha256:' + 'b' * 64, 'f' * 40, old_env=old)
        self.assertEqual(overlay['services']['api']['environment'], old['api'])
        self.assertEqual(overlay['services']['web']['environment'], old['web'])

    def test_compose_cannot_address_other_project_or_candidate_infra(self):
        args = r.compose_args(r.STORE / 'candidate-overlay.json')
        self.assertIn('gobadminton_dev_preview', args)
        self.assertIn(str(r.DEV / '.env'), args)
        self.assertNotIn('/srv/gobadminton/', ' '.join(args))
        for path in (Path('/tmp/arbitrary.yml'), r.STORE / 'docker-compose.yml'):
            with self.assertRaises(r.Blocked):
                r.compose_args(path)

    def test_no_non_dev_container_inspection(self):
        with patch.object(r, 'command') as execute:
            with self.assertRaises(r.Blocked):
                r.inspect_container('unrelated-container')
            execute.assert_not_called()

    def test_dev_container_project_or_public_port_denied(self):
        info = {'Name': '/' + r.API, 'Config': {'Labels': {'com.docker.compose.project': r.PROJECT}},
                'HostConfig': {'PortBindings': {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '18084'}]}}}
        r.check_container(info, r.API, 18084)
        info['HostConfig']['PortBindings']['3000/tcp'][0]['HostIp'] = '0.0.0.0'
        with self.assertRaises(r.Blocked):
            r.check_container(info, r.API, 18084)

    def test_pending_migration_requires_exact_rootapproved_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            migrations = root / 'apps/api/migrations'
            migrations.mkdir(parents=True)
            old = migrations / '0031_old.sql'
            new = migrations / '0032_friendship_core.sql'
            old.write_bytes(b'old'); new.write_bytes(b'CREATE TABLE synthetic(id int);')
            approval = {'0032_friendship_core': r.sha(new.read_bytes())}
            self.assertEqual(r.migrations(root, ['0031_old'], approval), ['0032_friendship_core'])
            new.write_bytes(b'DROP TABLE real_data;')
            with self.assertRaises(r.Blocked):
                r.migrations(root, ['0031_old'], approval)
            with self.assertRaises(r.Blocked):
                r.migrations(root, ['unknown_history'], approval)

    def test_archive_traversal_and_link_cannot_escape_build_directory(self):
        for name, kind in (('../escape', tarfile.REGTYPE), ('link', tarfile.SYMTYPE), ('hardlink', tarfile.LNKTYPE)):
            data = io.BytesIO()
            with tarfile.open(fileobj=data, mode='w') as archive:
                member = tarfile.TarInfo(name); member.type = kind; member.linkname = '/etc/passwd'
                archive.addfile(member)
            with tempfile.TemporaryDirectory() as target, self.assertRaises(r.Blocked):
                r.extract(data.getvalue(), target)

    def test_command_never_inherits_rootsecrets_or_uses_shell(self):
        result = types.SimpleNamespace(returncode=0, stdout=b'fixture', stderr=b'')
        with patch.dict(os.environ, {'GITHUB_TOKEN': 'secret', 'SSH_AUTH_SOCK': '/tmp/socket'}), patch.object(r.subprocess, 'run', return_value=result) as execute:
            r.command(['/usr/bin/docker', 'version'])
        kwargs = execute.call_args.kwargs
        self.assertNotIn('GITHUB_TOKEN', kwargs['env'])
        self.assertNotIn('SSH_AUTH_SOCK', kwargs['env'])
        self.assertNotIn('shell', kwargs)
        self.assertNotIn('secret', str(r.EVENTS))

    def test_browser_is_real_readonly_guest_with_no_fake_fixture(self):
        self.assertIn('data-map-ready="true"', r.BROWSER_SCRIPT)
        self.assertIn('newContext()', r.BROWSER_SCRIPT)
        self.assertNotIn('page.route', r.BROWSER_SCRIPT)
        self.assertNotIn('storageState', r.BROWSER_SCRIPT)

    def test_actual_control_flow_backs_up_before_migration_and_restores_old_apps_on_browser_failure(self):
        publication, planner, qa, producer, contract = self.proof()
        identity = r.bind(publication, planner, qa, producer, {}, contract)
        main_sha = publication['candidate_sha']
        old_images = {'api': 'sha256:' + '1' * 64, 'web': 'sha256:' + '2' * 64}
        new_images = {'api': 'sha256:' + '3' * 64, 'web': 'sha256:' + '4' * 64}
        old_env = {'api': {'NODE_ENV': 'production', 'GIT_SHA': 'f' * 40, 'FRIENDS_INTERNAL_ENABLED': '0'},
                   'web': {'NODE_ENV': 'production'}}
        running = {'new': False}
        calls = []
        content = b'fixed-private-config'
        policy = {'publisher_uid': 988, 'submitter_uid': 1005, 'runtime_gid': 989,
                  'compose_sha256': {p.name: r.sha(content) for p in (*r.COMPOSE, r.DEV / '.env')},
                  'approved_additive_migrations': {}}
        def protected(path, *_args, **_kwargs):
            if path == r.PUB: return json.dumps(publication).encode()
            if path == r.ROOT / 'autopilot-receipt.json': return json.dumps(planner).encode()
            if path.name == qa['task_id'] + '.json': return json.dumps(qa).encode()
            if path.name == producer['task_id'] + '.json': return json.dumps(producer).encode()
            return content
        def git(args):
            if args[0] == 'ls-remote': return main_sha + '\trefs/heads/main'
            if args[0] == 'rev-parse':
                if args[1] == 'FETCH_HEAD': return main_sha
                return publication['candidate_tree'] if args[1] == main_sha + '^{tree}' else identity['candidate_tree']
            if args[0] == 'merge-tree': return '9' * 40
            if args[0] == 'merge-base' and '--is-ancestor' not in args: return '8' * 40
            return ''
        def inspect(name):
            app = 'api' if name == r.API else 'web'
            env = old_env[app] if not running['new'] else {**old_env[app], 'GIT_SHA': main_sha}
            port = '18084' if name == r.API else '18086'
            info = {'Name': '/' + name, 'Id': name + '-stable-id',
                    'Config': {'Labels': {'com.docker.compose.project': r.PROJECT}, 'Env': [k+'='+v for k,v in env.items()]},
                    'HostConfig': {'PortBindings': {} if name == r.DB else
                                   {('3000/tcp' if name == r.API else '3001/tcp'): [{'HostIp':'127.0.0.1','HostPort':port}]}},
                    'Image': (new_images if running['new'] else old_images)[app],
                    'Mounts': [{'Name':'dev-preview-avatars','Destination':'/var/lib/gobadminton/avatars'}]}
            return info
        def command(args, **kwargs):
            calls.append(list(args))
            if args[0] == '/usr/bin/git': return b'archive-fixture'
            if 'config' in args: return json.dumps({'services': {name: {'environment': values} for name,values in old_env.items()}}).encode()
            if 'psql' in args: return b'0031_old\n'
            if 'pg_dump' in args: return b'PGDMPsynthetic-private-backup'
            if args[1:3] == ['image','inspect']:
                app = 'api' if 'dev-api:' in args[-1] else 'web'
                return json.dumps([{'Id':new_images[app],'Config':{'Labels':{'org.opencontainers.image.revision':main_sha}}}]).encode()
            if 'up' in args: running['new'] = any('candidate-overlay' in str(a) for a in args)
            return b''
        def record(path, value, *_): path.write_text(json.dumps(value))
        with tempfile.TemporaryDirectory() as directory, patch.object(r, 'STORE', Path(directory)), \
                patch.object(r, 'protected', side_effect=protected), patch.object(r, 'git', side_effect=git), \
                patch.object(r, 'command', side_effect=command), patch.object(r, 'inspect_container', side_effect=inspect), \
                patch.object(r, 'extract'), patch.object(r, 'check_database_binding'), patch.object(r, 'migrations', return_value=[]), patch.object(r, 'record', side_effect=record), \
                patch.object(r, 'smoke') as health, patch.object(r, 'browser', side_effect=r.Blocked('browser unavailable')), \
                patch.object(r, 'bind', return_value=identity), patch.object(r, '_POLICY_BYTES', content), \
                patch.object(r.importlib, 'import_module', return_value=contract), patch.object(r.os, 'fchmod', create=True):
            with self.assertRaises(r.Blocked):
                r.release(policy, publication, planner, identity)
            receipt = json.loads((Path(directory) / (main_sha + '.json')).read_text())
            self.assertEqual(receipt['status'], 'RECOVERY_REQUIRED')
            self.assertEqual(receipt['rollback'], 'OLD_APP_IMAGES_AND_ENV_RESTORED')
            self.assertTrue(receipt['database_schema_retained'])
            self.assertFalse(receipt['friend_ui_verified'])
            self.assertEqual(health.call_args_list[-1].args, ('f'*40,))
            self.assertEqual(health.call_args_list[-1].kwargs, {'privacy': False})
        backup_index = next(i for i,args in enumerate(calls) if 'pg_dump' in args)
        migration_index = next(i for i,args in enumerate(calls) if 'run' in args and 'migrate' in args)
        self.assertLess(backup_index, migration_index)
        self.assertFalse(running['new'])
        self.assertFalse(any('down' in args or 'restore' in args or '--volumes' in args for args in calls))
        self.assertTrue(all('/srv/gobadminton/' not in ' '.join(args) for args in calls))

    def test_migration_database_and_network_cannot_redirect_to_host_or_shared_db(self):
        database = {'Config': {'Env': ['POSTGRES_DB=gobadminton','POSTGRES_USER=gobadminton']},
                    'NetworkSettings': {'Networks': {'gobadminton_dev_preview_internal': {}}}}
        config = {'networks': {'isolated_dev_backend': {'name':'gobadminton_dev_preview_internal'}},
                  'services': {'api': {'environment':{'DATABASE_URL':'postgres://gobadminton:private@db:5432/gobadminton'}},
                               'migrate': {'networks': {'isolated_dev_backend': {}},
                                           'environment':{'DATABASE_URL':'postgres://gobadminton:private@db:5432/gobadminton'}}}}
        r.check_database_binding(config,database)
        for url in ('postgres://gobadminton:private@localhost:5432/gobadminton',
                    'postgres://gobadminton:private@db:5432/other',
                    'postgres://other:private@db:5432/gobadminton',
                    'postgres://gobadminton:private@db:5432/gobadminton?host=external'):
            config['services']['migrate']['environment']['DATABASE_URL'] = url
            with self.subTest(url=url), self.assertRaises(r.Blocked):
                r.check_database_binding(config,database)


if __name__ == '__main__':
    unittest.main()

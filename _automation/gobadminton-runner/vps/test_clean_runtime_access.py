"""Fixed runtime sharing must not relax private fixtures or authority checks."""
import importlib.util
from pathlib import Path
import stat
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('clean_runtime_access', Path(__file__).with_name('clean_runtime_access.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)


class RuntimeAccess(unittest.TestCase):
    def authority(self):
        return {'schema': 'GBCLEAN_PUBLISH_POLICY_V1', 'publisher_uid': 1001,
                'submitter_uid': 1002, 'runtime_gid': 2001, 'owner_event': dict(a.OWNER_EVENT)}

    def accounts(self):
        return [types.SimpleNamespace(pw_name='publisher', pw_uid=1001, pw_gid=3001),
                types.SimpleNamespace(pw_name='submitter', pw_uid=1002, pw_gid=3002),
                types.SimpleNamespace(pw_name='executor-other', pw_uid=1003, pw_gid=3003)]

    def group(self, members=None):
        return types.SimpleNamespace(gr_name=a.GROUP, gr_gid=2001,
                                     gr_mem=['publisher', 'submitter'] if members is None else members)

    def info(self, mode=0o2770, uid=1002, gid=2001):
        return types.SimpleNamespace(st_mode=stat.S_IFDIR | mode, st_uid=uid, st_gid=gid)

    def test_only_exact_dedicated_group_and_two_principals(self):
        a.validate_authority(self.authority(), group_record=self.group(), accounts=self.accounts())
        for members in (['publisher'], ['publisher', 'submitter', 'executor-other'], ['unknown']):
            with self.subTest(members=members), self.assertRaises(a.AccessHold):
                a.validate_authority(self.authority(), group_record=self.group(members), accounts=self.accounts())

    def test_primary_group_members_cannot_hide_extra_actor(self):
        accounts = self.accounts()
        accounts[-1].pw_gid = 2001
        with self.assertRaises(a.AccessHold):
            a.validate_authority(self.authority(), group_record=self.group(), accounts=accounts)

    def test_broad_existing_group_refused(self):
        group = self.group()
        group.gr_name = 'docker'
        with self.assertRaises(a.AccessHold):
            a.validate_authority(self.authority(), group_record=group, accounts=self.accounts())

    def test_root_same_author_and_boolean_identities_refused(self):
        for key, value in [('publisher_uid', 0), ('runtime_gid', True), ('publisher_uid', 1002)]:
            authority = self.authority()
            authority[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(a.AccessHold):
                a.validate_authority(authority, group_record=self.group(), accounts=self.accounts())

    def test_owner_body_account_event_time_cannot_be_substituted(self):
        for key in a.OWNER_EVENT:
            authority = self.authority()
            authority['owner_event'][key] = 'spoof'
            with self.subTest(key=key), self.assertRaises(a.AccessHold):
                a.validate_authority(authority, group_record=self.group(), accounts=self.accounts())

    def test_ordinary_private_fixture_retains700_without_policy(self):
        with patch.object(a.Path, 'lstat', return_value=self.info(0o700)), patch.object(a.Path, 'is_symlink', return_value=False), patch.object(a, 'policy') as policy:
            self.assertTrue(a.directory_allowed(Path('/tmp/test-fixture'), 1002))
            self.assertEqual(a.file_access(Path('/tmp/test-fixture/state.json')), (0o600, None))
            policy.assert_not_called()

    def test_temporary_shared_fixture_does_not_inherit_runtime_authority(self):
        with patch.object(a.Path, 'lstat', return_value=self.info()), patch.object(a.Path, 'is_symlink', return_value=False), patch.object(a, 'policy') as policy:
            self.assertFalse(a.directory_allowed(Path('/tmp/test-fixture'), 1002))
            policy.assert_not_called()

    def test_exact_runtime_sharedmode_gid_and_owner_required(self):
        with patch.object(a.Path, 'is_symlink', return_value=False), patch.object(a, 'policy', return_value=self.authority()):
            with patch.object(a.Path, 'lstat', return_value=self.info()):
                self.assertTrue(a.directory_allowed(a.ROOT, 1002))
            for info in (self.info(0o2777), self.info(0o770), self.info(gid=999), self.info(uid=1003)):
                with patch.object(a.Path, 'lstat', return_value=info):
                    self.assertFalse(a.directory_allowed(a.ROOT, 1002))

    def test_control_atomic_modes_are_explicit_and_do_not_share_credentials(self):
        with patch.object(a.Path, 'is_symlink', return_value=False), patch.object(a.Path, 'lstat', return_value=self.info()), \
                patch.object(a, 'policy', return_value=self.authority()), patch.object(a.os, 'geteuid', return_value=1002, create=True):
            self.assertEqual(a.file_access(a.ROOT / 'state.json'), (0o640, 2001))
            self.assertEqual(a.file_access(a.ROOT / 'source-merge-reservation.json'), (0o660, 2001))
            self.assertEqual(a.file_access(a.ROOT / 'planner-publication.lock'), (0o660, 2001))
            self.assertEqual(a.file_access(a.ROOT / 'receipts/friends-dev-s1-api-20261013-v001.json'), (0o640, 2001))
            self.assertEqual(a.file_access(a.ROOT / 'owner-inbox/event.json'), (0o600, None))
            self.assertEqual(a.file_access(a.ROOT / 'secret.key'), (0o600, None))
            self.assertEqual(a.file_access(a.ROOT / 'planner-publication-hooks/pre-push', 0o700), (0o700, None))

    def test_other_actor_cannot_request_shared_atomic_files(self):
        with patch.object(a.Path, 'lstat', return_value=self.info()), patch.object(a.Path, 'is_symlink', return_value=False), \
                patch.object(a, 'policy', return_value=self.authority()), patch.object(a.os, 'geteuid', return_value=1003, create=True):
            with self.assertRaises(a.AccessHold):
                a.file_access(a.ROOT / 'state.json')

    def test_linked_control_directory_or_file_refused(self):
        with patch.object(a.Path, 'lstat', return_value=self.info()), patch.object(a.Path, 'is_symlink', return_value=True):
            self.assertFalse(a.directory_allowed(a.ROOT, 1002))
            with self.assertRaises(a.AccessHold):
                a.file_access(a.ROOT / 'state.json')


if __name__ == '__main__':
    unittest.main()

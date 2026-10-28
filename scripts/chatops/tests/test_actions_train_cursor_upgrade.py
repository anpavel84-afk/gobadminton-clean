"""Reviewed installer gate tests; never use host paths or privileges."""
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from test_actions_train import ROOT, receiver as R
spec=importlib.util.spec_from_file_location('cursor_upgrade_test', ROOT/'scripts/chatops/ops/cursor_author_upgrade.py')
U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U)


class QualificationGates(unittest.TestCase):
    def test_policy_update_is_not_history_and_json_hash_matches_real_atomic_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'json'
            value={'schema':1,'providers':{'cursor':{'author':'unlimited'}}}
            R.atomic(p,value)
            self.assertEqual(p.read_bytes(),json.dumps(value,sort_keys=True).encode())
        fake=SimpleNamespace(preserved=lambda _: {str(U.BUDGET):'old-policy','ledger':'unchanged'})
        with tempfile.TemporaryDirectory() as directory, patch.object(U,'STATE',Path(directory)):
            self.assertEqual(U.preserved(fake,None)['ledger'],'unchanged')
            self.assertNotIn(str(U.BUDGET),U.preserved(fake,None))

    def test_no_ready_without_completed_native_canary(self):
        j={'phase':'active-canary','controller':'a'*40,'canary_task_sha256':'task'}
        p={'mode':'active','controller_sha':'a'*40}
        marker={'phase':'canary','canary_task_sha256':'task'}
        def read(path,*args):
            return j if path==U.JOURNAL else p if path==R.POLICY else marker
        with patch.object(R,'read',side_effect=read),patch.object(R,'checkpoint',return_value=({'active':None,'done':[]},[])), \
             patch.object(R,'journal',return_value={'operations':{}}),patch.object(R,'atomic') as write:
            with self.assertRaises(Exception):U.accept_canary()
            write.assert_not_called()

    def test_wrong_controller_cannot_promote_marker(self):
        values=[{'phase':'active-canary','controller':'a'*40,'canary_task_sha256':'task'},
                {'mode':'active','controller_sha':'b'*40},
                {'phase':'canary','canary_task_sha256':'task'}]
        with patch.object(R,'read',side_effect=values),patch.object(R,'atomic') as write:
            with self.assertRaises(Exception):U.accept_canary()
            write.assert_not_called()


if __name__=='__main__':unittest.main()

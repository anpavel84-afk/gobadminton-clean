"""Offline V2 shadow proof and interrupted-backup tests. No network or root writes."""
import base64
import hashlib
import json
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

from test_actions_train_phase_v2_upgrade import V, OneShotStageUpgrade
from test_actions_train import installer, receiver


class ShadowProof(unittest.TestCase):
    def setUp(self):
        self.workflow=b"name: Train dispatcher\non: workflow_dispatch\n"
        self.revision="a"*40
        self.run=dict(
            id=123, name="Train dispatcher", path=".github/workflows/train-dispatch.yml",
            event="workflow_dispatch", head_branch="dev",status="completed",
            conclusion="success",repository={"id":V.REPO_ID},
            head_repository={"id":V.REPO_ID},actor={"id":41898282},
            head_sha=self.revision,run_attempt=1,
            run_started_at="2026-10-22T16:40:00Z")
        self.jobs=dict(total_count=2,jobs=[
            dict(name=n,status="completed",conclusion="success",head_sha=self.revision)
            for n in ("reconcile","publish_phase_drafts")])
        self.file=dict(encoding="base64",path=".github/workflows/train-dispatch.yml",
                       content=base64.b64encode(self.workflow).decode())
        self.responses={
            "actions/runs/123":self.run,
            "actions/runs/123/jobs?per_page=40":self.jobs,
            "contents/.github/workflows/train-dispatch.yml?ref="+self.revision:self.file}

    def verify(self):
        with patch.object(V,"public_github",side_effect=lambda path:self.responses[path]), \
             patch.object(V,"REVIEWED_DISPATCH_SHA",hashlib.sha256(self.workflow).hexdigest()):
            return V.verify_hosted_probe(123,{"installed_at":1})

    def test_real_run_must_include_both_trusted_jobs_and_workflow_digest(self):
        self.assertEqual(self.verify()["verified_jobs"],["reconcile","publish_phase_drafts"])

    def test_fake_or_stale_run_cannot_activate(self):
        for key,value in (("status","in_progress"),("conclusion","failure"),
                          ("event","pull_request"),("head_branch","main")):
            with self.subTest(key=key):
                original=self.run[key]
                self.run[key]=value
                with self.assertRaises(receiver.Refused):self.verify()
                self.run[key]=original
        self.run["run_started_at"]="2026-10-22T15:00:00Z"
        with patch.object(V,"public_github",side_effect=lambda path:self.responses[path]), \
             patch.object(V,"REVIEWED_DISPATCH_SHA",hashlib.sha256(self.workflow).hexdigest()):
            with self.assertRaises(receiver.Refused):
                V.verify_hosted_probe(123,{"installed_at":1792683600})

    def test_missing_publication_job_or_changed_workflow_fails_closed(self):
        self.jobs["jobs"][1]["conclusion"]="skipped"
        with self.assertRaises(receiver.Refused):self.verify()
        self.jobs["jobs"][1]["conclusion"]="success"
        self.file["content"]=base64.b64encode(b"unreviewed changed workflow").decode()
        with self.assertRaises(receiver.Refused):self.verify()


class InterruptedPreparation(unittest.TestCase):
    def test_interrupted_backup_is_rollbackable_without_touching_controller(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)
            f=OneShotStageUpgrade()
            (state,install,policy,oldpolicy,record,newpolicy,newrecord,
             old,new,payload)=f.fixture(root)
            count=[0]
            def put(source,target,mode):
                dest=Path(target)
                dest.parent.mkdir(parents=True,exist_ok=True)
                dest.write_bytes(Path(source).read_bytes())
                if dest.is_relative_to(state/"hotfix-phase-v2-backup"):
                    count[0]+=1
                    if count[0]==2: raise RuntimeError("interrupted backup")
            def read(path,owner=0):return json.loads(Path(path).read_text())
            def atomic(path,obj,mode=0o600):Path(path).write_text(json.dumps(obj))
            file_map={k:(old[k],new[k]) for k in V.FILES}
            with ExitStack() as stack:
                patches=[
                    patch.object(V,"STATE",state),patch.object(V,"INSTALL",install),
                    patch.object(V,"POLICY",policy),
                    patch.object(V,"JOURNAL",state/"hotfix-phase-v2.json"),
                    patch.object(V,"BACKUP",state/"hotfix-phase-v2-backup"),
                    patch.object(V,"FILES",file_map),patch.object(V,"quiet"),
                    patch.object(V.receiver,"trusted_tree"),
                    patch.object(V,"state_hashes",return_value={"ledger":"unchanged"}),
                    patch.object(V.installer,"put",side_effect=put),
                    patch.object(V.receiver,"atomic",side_effect=atomic),
                    patch.object(V.receiver,"read",side_effect=read),
                    patch.object(V,"plan",return_value=(
                        oldpolicy,record,newpolicy,newrecord,payload))
                ]
                for value in patches:stack.enter_context(value)
                with self.assertRaisesRegex(RuntimeError,"interrupted backup"):
                    V.transaction("apply",root,"manifest","f"*40,"a"*64)
                self.assertEqual(read(state/"hotfix-phase-v2.json")["phase"],"preparing")
                self.assertEqual(read(policy)["mode"],"disabled")
                self.assertEqual(V.transaction("rollback")["status"],
                                 "ABORTED_PREPARATION_DISABLED")
                self.assertEqual(read(policy)["controller_sha"],V.PRIOR_CONTROLLER)
                self.assertEqual(read(state/"backup.json"),record)
                for key in old:self.assertEqual(installer.sha(install/key),old[key])


if __name__=="__main__":unittest.main()

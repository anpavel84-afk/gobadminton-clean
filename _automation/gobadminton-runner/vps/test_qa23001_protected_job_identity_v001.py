"""QA-230-01: actual protected root verifier + per-task nonauthor authority.

Only GitHub-hosted disposable /var/lib/gb-qa23001-<random> fixtures.
No original VPS/CLI, production accounts, live tasks, credentials or Git main.
External Git history is stubbed; root ownership, file permission, SHA256 job
digests, reviewer authorization, log hashes and policy reads are NOT stubbed.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch

try:
    import psutil
except ModuleNotFoundError:
    from types import SimpleNamespace
    sys.modules["psutil"] = SimpleNamespace(
        Error=OSError, AccessDenied=OSError, NoSuchProcess=OSError,
        process_iter=lambda *args, **kwargs: ())

import runner as r
import backlog_sync as sync
import test_job_contract as trusted

SHA = "a" * 40
TREE = "b" * 40
SUITE = "friends-shared-source-privacy-v001"
PA = "friends-producer-A"
QA = "qa-friends-producer-A"
PB = "friends-producer-B"
QB = "qa-friends-producer-B"
BRANCH_A = "friends-private-A"
BRANCH_B = "friends-private-B"
HANDOFF = "friends-dogfood-release-v001"


def binding(task_id, producer_id, branch):
    return {
        "schema_version": 1,
        "qa_task_id": task_id,
        "producer_task_id": producer_id,
        "candidate_sha": SHA,
        "candidate_tree": TREE,
        "branch": branch,
        "suite_id": SUITE,
    }


def make_job(environment_sha, authorization_id, log_sha):
    job = {
        "source_sha": SHA,
        "source_tree": TREE,
        "tests_sha": "c" * 64,
        "dependencies_sha": "d" * 64,
        "node_sha": "e" * 64,
        "pnpm_sha": "f" * 64,
        "lockfile_sha": "1" * 64,
        "environment_sha": environment_sha,
        "suite_id": SUITE,
        "author_id": "source-author",
    }
    receipt = {
        "job_sha": trusted.digest(job),
        "exit_code": 0,
        "test_count": 3,
        "log_sha": log_sha,
        "outcome": "PASS",
    }
    verdict = {
        "receipt_sha": trusted.digest(receipt),
        "reviewer_id": "different-independent-reviewer",
        "verdict": "PASS",
        "authorization_id": authorization_id,
    }
    record = {"job": job, "receipt": receipt, "verdict": verdict, "previous": []}
    return trusted.digest(record), record


class ActualProtectedRootIdentity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if sys.platform != "linux" or shutil.which("sudo") is None:
            raise RuntimeError("root-owned disposable Linux QA fixture requires CI sudo")
        if Path("/var/lib").stat().st_uid != 0:
            raise RuntimeError("refusing test: /var/lib is not root-owned")
        cls.root = Path("/var/lib") / ("gb-qa23001-" + uuid.uuid4().hex)
        cls.stage = tempfile.TemporaryDirectory(prefix="gb-qa23001-unpriv-")
        cls.stage_path = Path(cls.stage.name)
        cls.sudo("install", "-d", "-o", "root", "-g", "root",
                 "-m", "0755", str(cls.root))
        cls.log = b"synthetic independently verified test suite: 3 PASS\\n"
        cls.log_sha = hashlib.sha256(cls.log).hexdigest()
        cls.job_a, cls.record_a = make_job("2" * 64, "qa-authorization-A",
                                           cls.log_sha)
        cls.job_b, cls.record_b = make_job("3" * 64, "qa-authorization-B",
                                           cls.log_sha)
        if cls.job_a == cls.job_b:
            raise AssertionError("separate QA test jobs unexpectedly identical")
        cls.base_policy = {
            "suite_ids": [SUITE],
            "reviewers": ["different-independent-reviewer"],
            "verdict_authorizations": {
                cls.record_a["verdict"]["authorization_id"]:
                    trusted.digest(cls.record_a["verdict"]),
                cls.record_b["verdict"]["authorization_id"]:
                    trusted.digest(cls.record_b["verdict"]),
            },
        }
        for job, record in ((cls.job_a, cls.record_a),
                            (cls.job_b, cls.record_b)):
            cls.install_file(job + ".json", trusted.canonical(record))
        cls.install_file(cls.log_sha + ".log", cls.log)

    @classmethod
    def tearDownClass(cls):
        try:
            if hasattr(cls, "root") and cls.root.name.startswith("gb-qa23001-"):
                cls.sudo("rm", "-r", "--", str(cls.root))
        finally:
            if hasattr(cls, "stage"):
                cls.stage.cleanup()

    @classmethod
    def sudo(cls, *args):
        subprocess.run(["sudo", "-n", *args], check=True, timeout=15,
                       capture_output=True, text=True)

    @classmethod
    def install_file(cls, filename, payload):
        if "/" in filename or filename in (".", ".."):
            raise ValueError("invalid synthetic evidence filename")
        source = cls.stage_path / filename
        source.write_bytes(payload)
        cls.sudo("install", "-o", "root", "-g", "root",
                 "-m", "0444", str(source), str(cls.root / filename))

    def setUp(self):
        self.policy = copy.deepcopy(self.base_policy)
        self.policy["source_qa_authorizations"] = {
            self.job_a: trusted.digest(binding(QA, PA, BRANCH_A)),
        }
        self.publish_policy()
        self.producers = {
            PA: self.producer(PA, BRANCH_A),
            PB: self.producer(PB, BRANCH_B),
        }
        self.receipts = {
            PA: self.producer_receipt(PA, BRANCH_A),
            PB: self.producer_receipt(PB, BRANCH_B),
            QA: self.qa_receipt(QA, PA, BRANCH_A, self.job_a),
            QB: self.qa_receipt(QB, PB, BRANCH_B, self.job_a),
        }
        self.queue = {"prod_authorized": False, "tasks": [
            self.producers[PA], self.qa_task(QA, PA),
            self.producers[PB], self.qa_task(QB, PB),
            self.handoff_task(),
        ]}
        self.state = {"history": [
            {"id": task_id, "status": "completed"}
            for task_id in (PA, QA, PB, QB)
        ], "active": {}, "paused": False}
        self.stack = self.enterContext(patch.object(r, "SOURCE_REVIEW_QA_ROOT",
                                                     self.root))
        self.enterContext(patch.object(r, "read_receipt", side_effect=self.receipt))
        self.enterContext(patch.object(r, "_v2_evidence_repo",
                                       return_value=Path("/synthetic/sha-checkout")))
        self.enterContext(patch.object(r, "_v2_verified_producer_candidate",
                                       return_value=SHA))
        self.enterContext(patch.object(sync, "validate_immutable_sources"))
        # These two mocks stand only for unavailable external Git; the test uses
        # the ACTUAL verifier, protected policy, protected record and log.
        self.assertEqual(os.stat(self.root).st_uid, 0)
        self.assertFalse(os.stat(self.root).st_mode & 0o022)
        self.assertEqual(os.stat(self.root / "policy.json").st_uid, 0)
        self.assertFalse(os.stat(self.root / "policy.json").st_mode & 0o022)

    def publish_policy(self):
        self.install_file("policy.json", trusted.canonical(self.policy))

    def producer(self, task_id, branch):
        return {"id": task_id, "status": "queued", "effect_ceiling": "source_only",
                "source": "synthetic", "enabled": True, "locks": ["api"]}

    def qa_task(self, qa_id, producer_id):
        return {"id": qa_id, "status": "queued", "effect_ceiling": "source_only",
                "source_qa": {"producer_task_id": producer_id, "suite_id": SUITE},
                "depends_on_completed": [producer_id], "locks": ["api"]}

    def handoff_task(self):
        return {"id": HANDOFF, "status": "queued", "effect_ceiling": "source_only",
                "depends_on_accepted": [QB], "release_handoff":
                    {"kind": "ci_candidate", "target": "authorized_release_job"}}

    def producer_receipt(self, producer_id, branch):
        return {"ok": True, "project": "GoBadminton",
                "task_id": producer_id, "candidate_sha": SHA,
                "candidate_tree": TREE, "branch": branch}

    def qa_receipt(self, qa_id, producer_id, branch, trusted_job):
        return {"ok": True, "project": "GoBadminton", "task_id": qa_id,
                "acceptance_state": "SOURCE_ACCEPTED", "verdict": "PASS",
                "blocking_findings": [], "blocking_gap_count": 0,
                "producer_task_id": producer_id, "candidate_sha": SHA,
                "candidate_tree": TREE, "branch": branch,
                "trusted_job": trusted_job}

    def receipt(self, path):
        return copy.deepcopy(self.receipts.get(Path(path).stem))

    def accepted(self, qa_id):
        return r._v2_source_qa_accepted(self.queue, self.state, qa_id)

    def test_actual_original_verifier_accepts_genuine_protected_job(self):
        # No protected-json / root ownership / log / reviewer verifier mocked.
        self.assertEqual(trusted.verify_runner_receipt(
            self.receipts[QA], self.root),
            trusted.digest(self.record_a["receipt"]))
        self.assertTrue(self.accepted(QA))

    def test_reused_valid_root_job_rejected_for_other_qa_producer_branch(self):
        # Historical attack: job SHA, source SHA/tree AND suite are identical.
        # The original verifier quite correctly verifies this job as a source
        # test, but MUST NOT authorize QA-B's unrelated task and producer.
        self.assertEqual(self.receipts[QA]["trusted_job"],
                         self.receipts[QB]["trusted_job"])
        self.assertEqual(self.receipts[QA]["candidate_sha"],
                         self.receipts[QB]["candidate_sha"])
        self.assertTrue(trusted.verify_runner_receipt(
            self.receipts[QB], self.root))
        self.assertTrue(self.accepted(QA))
        self.assertFalse(self.accepted(QB))
        handoff = {"handoff": {
            "state": "SOURCE_ONLY_CI_HANDOFF_READY",
            "accepted_qa_task_id": QB,
            "candidate_sha": SHA, "candidate_tree": TREE,
        }}
        self.assertFalse(r._v2_release_handoff_valid(
            self.queue, self.state, self.handoff_task(), handoff))

    def test_wrong_branch_even_when_producer_and_local_qa_agree_rejected(self):
        self.receipts[QA]["branch"] = "attacker-branch"
        self.receipts[PA]["branch"] = "attacker-branch"
        self.assertTrue(trusted.verify_runner_receipt(
            self.receipts[QA], self.root))
        self.assertFalse(self.accepted(QA))

    def test_missing_binding_rejects_despite_original_verifier_pass(self):
        del self.policy["source_qa_authorizations"]
        self.publish_policy()
        self.assertTrue(trusted.verify_runner_receipt(
            self.receipts[QA], self.root))
        self.assertFalse(self.accepted(QA))

    def test_altered_protected_authorization_digest_rejects(self):
        self.policy["source_qa_authorizations"][self.job_a] = "0" * 64
        self.publish_policy()
        self.assertTrue(trusted.verify_runner_receipt(
            self.receipts[QA], self.root))
        self.assertFalse(self.accepted(QA))

    def test_actual_root_file_permission_tamper_is_rejected(self):
        self.sudo("chmod", "0666", str(self.root / "policy.json"))
        self.assertFalse(self.accepted(QA))
        self.publish_policy()  # restore root-owned read-only protected policy

    def test_unique_authorized_qa_b_pass_and_can_enable_f5_handoff(self):
        # Independent separate B job/record/verdict with identical source,
        # tree and suite, but a DIFFERENT trusted job hash and root identity.
        self.policy["source_qa_authorizations"][self.job_b] = (
            trusted.digest(binding(QB, PB, BRANCH_B)))
        self.publish_policy()
        self.receipts[QB]["trusted_job"] = self.job_b
        self.assertTrue(trusted.verify_runner_receipt(
            self.receipts[QB], self.root))
        self.assertTrue(self.accepted(QA))
        self.assertTrue(self.accepted(QB))
        handoff = {"handoff": {
            "state": "SOURCE_ONLY_CI_HANDOFF_READY",
            "accepted_qa_task_id": QB,
            "candidate_sha": SHA, "candidate_tree": TREE,
        }}
        self.assertTrue(r._v2_release_handoff_valid(
            self.queue, self.state, self.handoff_task(), handoff))

    def test_recovered_claim_cannot_replay_root_qa_a_for_qa_b(self):
        with (patch.object(r, "load_backlog", return_value=self.queue),
              patch.object(r, "load_state", return_value=self.state),
              patch.object(r, "validate_receipt", return_value=(True, "ok")),
              patch.object(r, "mark_completed") as done,
              patch.object(r, "mark_blocked") as blocked):
            r._v2_finalize_or_requeue_recovered({"max_repair_attempts": 5},
                                                {"id": QB})
            done.assert_not_called()
            blocked.assert_called_once()


if __name__ == "__main__":
    unittest.main(verbosity=2)

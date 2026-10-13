"""F1-F5 Owner-scope DAG — isolated, changed-boundary author regression.

No subprocess CLI, original-host/service, credentials, live database, canonical
main mutation or local runtime state. Protected root evidence is explicitly
stubbed with both positive and fail-closed negative paths.
"""
from __future__ import annotations
import copy
import json
import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

try:
    import psutil
except ModuleNotFoundError:
    sys.modules["psutil"] = SimpleNamespace(
        Error=OSError, AccessDenied=OSError, NoSuchProcess=OSError,
        process_iter=lambda *a, **k: ())

import backlog_sync as sync
import publication_guard as guard
import runner as r
import test_job_contract as trusted

INPUT = Path(__file__).with_name("friends_f1f5_dag_fixture_v001.json")
FIXTURE = json.loads(INPUT.read_text(encoding="utf-8"))
IDS = FIXTURE["task_order"]
F1, F2, Q2, F3, Q3, F4, Q4, F5 = IDS
PIN = FIXTURE["source_candidate"]


class DagSourceContract(unittest.TestCase):
    def setUp(self):
        self.input = copy.deepcopy(FIXTURE)
        self.queue = {"project": "GoBadminton", "prod_authorized": False,
                      "tasks": copy.deepcopy(self.input["tasks"])}
        self.state = {"history": [], "active": {}, "paused": False, "blocked": None}
        self.cfg = {"max_parallel": 2, "prod_authorized": False}
        self.tasks = {t["id"]: t for t in self.queue["tasks"]}
        self.receipts = {}
        self.jobs = {}
        self.root_authorizations = {}
        self.candidates = {}
        self.bad_root = False
        self.verifier_calls = []
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(r, "task_gate", return_value=(True, "")))
        self.stack.enter_context(patch.object(r, "read_receipt", side_effect=self.receipt))
        self.stack.enter_context(patch.object(r, "_v2_evidence_repo",
                                              return_value=Path("/synthetic/isolated-repo")))
        self.stack.enter_context(patch.object(r, "_v2_git_evidence", side_effect=self.git))
        self.stack.enter_context(patch.object(sync, "validate_immutable_sources"))
        self.stack.enter_context(patch.object(trusted, "verify_runner_receipt",
                                              side_effect=self.verify_root))
        self.stack.enter_context(patch.object(trusted, "protected_json",
                                              side_effect=self.protected_record))

    def receipt(self, path):
        return copy.deepcopy(self.receipts.get(Path(path).stem))

    def git(self, argv):
        if argv[0] == "rev-parse" and argv[-1].endswith("^{tree}"):
            sha = argv[-1][:-7]
            if sha == PIN["sha"]:
                return PIN["tree"]
            for item in self.candidates.values():
                if item["sha"] == sha:
                    return item["tree"]
            return None
        if argv[0] in {"merge-base", "check-ref-format"}:
            return "EXACT_SYNTHETIC_ANCESTRY"
        return None

    def verify_root(self, proof, root):
        self.verifier_calls.append(proof["task_id"])
        if self.bad_root or proof.get("trusted_job") not in self.jobs:
            raise ValueError("missing root-protected independent QA")
        return "independently-verified"

    def protected_record(self, path):
        if self.bad_root:
            raise ValueError("missing protected policy/job")
        if Path(path).name == "policy.json":
            return {"source_qa_authorizations":
                    copy.deepcopy(self.root_authorizations)}
        key = Path(path).stem
        if key not in self.jobs:
            raise ValueError("missing protected policy/job")
        return copy.deepcopy(self.jobs[key])

    def completed(self, task_id, *, status="completed"):
        self.state["history"].append({"id": task_id, "status": status})

    def chosen(self):
        selected, waits = r.select_runnable_tasks(self.queue, self.state, self.cfg)
        return [task["id"] for task in selected], waits

    def admit_f1_root_pass(self):
        proof = {
            "project": "GoBadminton", "task_id": F1, "ok": True,
            "acceptance_state": "SOURCE_ACCEPTED", "verdict": "PASS",
            "blocking_findings": [], "blocking_gap_count": 0,
            "candidate_sha": PIN["sha"], "candidate_tree": PIN["tree"],
            "trusted_job": "1" * 64,
        }
        self.receipts[F1] = proof
        self.jobs["1" * 64] = {"job": {"suite_id": self.tasks[F1]["source_review"]["suite_id"],
                                       "source_sha": PIN["sha"], "source_tree": PIN["tree"]}}

    def producer_completed(self, producer, digit):
        sha = str(digit) * 40
        tree = str(digit + 5) * 40
        branch = "friends-" + producer.split("-s")[1].split("-")[0] + "-source"
        self.candidates[producer] = {"sha": sha, "tree": tree, "branch": branch}
        self.receipts[producer] = {
            "project": "GoBadminton", "task_id": producer, "ok": True,
            "candidate_sha": sha, "candidate_tree": tree, "branch": branch,
        }
        self.completed(producer)

    def admit_qa_root_pass(self, qa, producer, digit):
        result = self.candidates[producer]
        job = str(digit) * 64
        self.receipts[qa] = {
            "project": "GoBadminton", "task_id": qa, "ok": True,
            "acceptance_state": "SOURCE_ACCEPTED", "verdict": "PASS",
            "blocking_findings": [], "blocking_gap_count": 0,
            "producer_task_id": producer,
            "candidate_sha": result["sha"], "candidate_tree": result["tree"],
            "branch": result["branch"], "trusted_job": job,
        }
        self.jobs[job] = {
            "job": {"suite_id": self.tasks[qa]["source_qa"]["suite_id"],
                    "source_sha": result["sha"], "source_tree": result["tree"]},
        }
        # Existing test uses explicit protected-policy simulation, distinct
        # from the actual root-owned verifier adversarial regression.
        self.root_authorizations[job] = trusted.digest({
            "schema_version": 1,
            "qa_task_id": qa,
            "producer_task_id": producer,
            "candidate_sha": result["sha"],
            "candidate_tree": result["tree"],
            "branch": result["branch"],
            "suite_id": self.tasks[qa]["source_qa"]["suite_id"],
        })

    def unlock_to_f4(self):
        self.admit_f1_root_pass()
        self.completed(F1)
        self.producer_completed(F2, 2)
        self.admit_qa_root_pass(Q2, F2, 2)
        self.completed(Q2)
        self.producer_completed(F3, 3)
        self.admit_qa_root_pass(Q3, F3, 3)
        self.completed(Q3)

    def unlock_to_f5(self):
        self.unlock_to_f4()
        self.producer_completed(F4, 4)
        self.admit_qa_root_pass(Q4, F4, 4)
        self.completed(Q4)

    def test_one_owner_batch_with_8_tasks_and_three_qa_companions(self):
        self.assertEqual(len(self.queue["tasks"]), 8)
        self.assertEqual(FIXTURE["QA_companions"], [Q2, Q3, Q4])
        self.assertEqual(len([t for t in self.queue["tasks"] if t["id"] in [F1,F2,F3,F4,F5]]), 5)
        r.validate_backlog(self.queue)
        before = {"project": "GoBadminton", "prod_authorized": False, "tasks": []}
        admitted = sync.verify_candidate(
            json.dumps(self.queue).encode(), json.dumps(before).encode(), {})
        self.assertEqual({t["id"] for t in admitted}, set(IDS))
        receipt = self.input["synthetic_admission_for_dry_run"]
        binding = self.input["synthetic_owner_binding_for_dry_run"]
        self.assertEqual(len(guard.validate_admission_batch(before, self.queue, self.state,
                                                             receipt, binding)), 3)
        self.assertEqual(guard.admission_delta(before, self.queue), set(IDS))
        for corrupted in (
            {**receipt, "task_ids": [F1]},
            {**receipt, "source_review_task_ids": []},
            {**receipt, "release_handoff_task_ids": []},
        ):
            with self.assertRaises(sync.SyncBlocked):
                guard.validate_admission_batch(before, self.queue, self.state,
                                               corrupted, binding)
        self.assertIn("Not cryptographically authenticated",
                      binding["warning"])

    def test_f1_then_serialized_f2_f3_with_real_hierarchical_lock(self):
        selected, waits = self.chosen()
        self.assertEqual(selected, [F1], waits)
        self.completed(F1)
        # Merely completed F1, without separately authorized root QA, unlocks NOTHING.
        selected, waits = self.chosen()
        self.assertEqual(selected, [], waits)
        self.admit_f1_root_pass()
        selected, waits = self.chosen()
        self.assertEqual(selected, [F2], waits)
        self.assertTrue(any(x["id"] == F3 and "lock conflict" in x["reason"]
                            for x in waits))
        self.state["active"] = {F2: {"id": F2, "status": "running",
                                      "locks": self.tasks[F2]["locks"]}}
        selected, waits = self.chosen()
        self.assertEqual(selected, [], waits)
        self.assertTrue(any(x["id"] == F3 and "lock conflict" in x["reason"]
                            for x in waits))
        self.assertGreater(len(self.verifier_calls), 0)

    def test_qa_two_three_and_four_enforce_actual_independent_pass(self):
        self.admit_f1_root_pass()
        self.completed(F1)
        self.producer_completed(F2, 2)
        self.assertEqual(self.chosen()[0], [Q2])
        self.completed(Q2)
        self.assertFalse(r.dependencies_ready(self.tasks[F4], self.queue,
                                              self.state)[0])
        # Even a completed Q2 must not be mistaken for accepted source.
        self.admit_qa_root_pass(Q2, F2, 2)
        self.assertEqual(self.chosen()[0], [F3])
        self.producer_completed(F3, 3)
        self.assertEqual(self.chosen()[0], [Q3])
        self.completed(Q3)
        self.assertFalse(r.dependencies_ready(self.tasks[F4], self.queue,
                                              self.state)[0])
        self.admit_qa_root_pass(Q3, F3, 3)
        self.assertEqual(self.chosen()[0], [F4])
        self.producer_completed(F4, 4)
        self.assertEqual(self.chosen()[0], [Q4])
        self.completed(Q4)
        self.assertEqual(self.chosen()[0], [])
        self.admit_qa_root_pass(Q4, F4, 4)
        self.assertEqual(self.chosen()[0], [F5])
        self.assertIn(Q4, self.verifier_calls)

    def test_missing_root_or_wrong_candidate_never_unblocks(self):
        self.unlock_to_f4()
        self.bad_root = True
        self.assertEqual(self.chosen()[0], [])
        self.bad_root = False
        self.receipts[Q2]["candidate_sha"] = "e" * 40
        self.assertEqual(self.chosen()[0], [])
        self.receipts[Q2]["candidate_sha"] = self.candidates[F2]["sha"]
        self.receipts[Q3]["verdict"] = "FAIL"
        self.assertEqual(self.chosen()[0], [])
        self.receipts[Q3]["verdict"] = "PASS"
        self.completed(Q3, status="qa_failed")
        self.assertEqual(self.chosen()[0], [])

    def test_immutable_qa_suite_and_handoff_binding_preserve_task_ids(self):
        initial = json.dumps(self.queue).encode()
        for key, update in (
            (Q2, {"source_qa": {"producer_task_id": F3, "suite_id": "wrong"}}),
            (F5, {"release_handoff": {"kind": "deploy", "target": "root"}}),
        ):
            after = copy.deepcopy(self.queue)
            for task in after["tasks"]:
                if task["id"] == key:
                    task.update(update)
            with self.assertRaisesRegex(sync.SyncBlocked, "immutable"):
                sync.verify_candidate(json.dumps(after).encode(), initial, {})
            with self.assertRaisesRegex(sync.SyncBlocked, "immutable"):
                guard.admission_delta(self.queue, after)

    def test_f5_handoff_only_verified_candidate_no_release_job_impersonation(self):
        self.unlock_to_f5()
        proof = self.receipts[Q4]
        base = {"handoff": {"state": "SOURCE_ONLY_CI_HANDOFF_READY",
                            "accepted_qa_task_id": Q4,
                            "candidate_sha": proof["candidate_sha"],
                            "candidate_tree": proof["candidate_tree"]}}
        self.assertTrue(r._v2_release_handoff_valid(self.queue, self.state,
                                                    self.tasks[F5], base))
        for altered in (
            {"handoff": {**base["handoff"], "candidate_sha": "f"*40}},
            {"handoff": {**base["handoff"], "candidate_tree": "f"*40}},
            {**base, "deployment_status": "DEPLOYED"},
            {**base, "release_job_id": "fake-run"},
        ):
            self.assertFalse(r._v2_release_handoff_valid(self.queue, self.state,
                                                          self.tasks[F5], altered))
        self.bad_root = True
        self.assertFalse(r._v2_release_handoff_valid(self.queue, self.state,
                                                      self.tasks[F5], base))

    def test_overlapping_paths_without_serialization_refused(self):
        state = {"history": [], "active": {}}
        before = {"project":"GoBadminton", "prod_authorized":False, "tasks":[]}
        rec = copy.deepcopy(self.input["synthetic_admission_for_dry_run"])
        binding = copy.deepcopy(self.input["synthetic_owner_binding_for_dry_run"])
        scopes = [
            {"producer_task_id":F2,"qa_task_id":Q2,"write_paths":["apps/api"]},
            {"producer_task_id":F3,"qa_task_id":Q3,"write_paths":["apps/api"]},
            {"producer_task_id":F4,"qa_task_id":Q4,"write_paths":["apps/web"]},
        ]
        rec["admission_pairs"] = binding["admission_pairs"] = scopes
        self.assertEqual(len(guard.validate_admission_batch(before,self.queue,state,
                                                              rec,binding)),3)
        without_lock = copy.deepcopy(self.queue)
        for task in without_lock["tasks"]:
            if task["id"] in (F3,Q3):
                task["locks"] = ["notifications"]
        with self.assertRaisesRegex(sync.SyncBlocked,"overlapping write paths"):
            guard.validate_admission_batch(before,without_lock,state,rec,binding)

    def test_cycles_or_missing_qa_or_duplicate_owner_batch_refused(self):
        before={"project":"GoBadminton","prod_authorized":False,"tasks":[]}
        receipt=copy.deepcopy(self.input["synthetic_admission_for_dry_run"])
        binding=copy.deepcopy(self.input["synthetic_owner_binding_for_dry_run"])
        q=copy.deepcopy(self.queue)
        for task in q["tasks"]:
            if task["id"]==F2:
                task["depends_on_accepted"].append(Q2)
        with self.assertRaisesRegex(sync.SyncBlocked,"cyclic"):
            guard.validate_admission_batch(before,q,self.state,receipt,binding)
        q=copy.deepcopy(self.queue)
        q["tasks"]=[t for t in q["tasks"] if t["id"]!=Q3]
        with self.assertRaises(sync.SyncBlocked):
            guard.validate_admission_batch(before,q,self.state,receipt,binding)
        q=copy.deepcopy(self.queue)
        q["tasks"].append(copy.deepcopy(q["tasks"][0]))
        with self.assertRaisesRegex(sync.SyncBlocked,"duplicate"):
            sync.verify_candidate(json.dumps(q).encode(),json.dumps(before).encode(),{})

    def test_recovered_executor_receipt_without_root_is_not_completed(self):
        from unittest.mock import Mock
        self.completed(F1)
        self.receipts[F1] = {"ok":True,"project":"GoBadminton","task_id":F1,
                             "acceptance_state":"SOURCE_ACCEPTED","verdict":"PASS",
                             "candidate_sha":PIN["sha"],"candidate_tree":PIN["tree"],
                             "blocking_findings":[],"trusted_job":"1"*64}
        self.bad_root=True
        with (patch.object(r,"load_backlog",return_value=self.queue),
              patch.object(r,"load_state",return_value=self.state),
              patch.object(r,"validate_receipt",return_value=(True,"ok")),
              patch.object(r,"mark_completed") as done,
              patch.object(r,"mark_blocked") as blocked):
            r._v2_finalize_or_requeue_recovered(self.cfg,{"id":F1})
            done.assert_not_called()
            blocked.assert_called_once()
        # Same fail-closed rule for a QA companion even after local "ok".
        self.bad_root=False
        self.receipts.clear()
        self.completed(F2)
        self.completed(Q2)
        with (patch.object(r,"load_backlog",return_value=self.queue),
              patch.object(r,"load_state",return_value=self.state),
              patch.object(r,"validate_receipt",return_value=(True,"ok")),
              patch.object(r,"mark_completed") as done,
              patch.object(r,"mark_blocked") as blocked):
            r._v2_finalize_or_requeue_recovered(self.cfg,{"id":Q2})
            done.assert_not_called()
            blocked.assert_called_once()


if __name__=="__main__":
    unittest.main(verbosity=2)

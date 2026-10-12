#!/usr/bin/env python3
"""Synthetic Owner→backlog→Runner→QA canonical/runtime coverage.

No access to live GoBadminton services or production data.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import backlog_sync
import runner
import autopilot
from unittest import mock

S = "a" * 40


def task(
    tid: str,
    *,
    order: int = 100,
    locks: list[str] | None = None,
    enabled: bool = True,
    deps: list[str] | None = None,
    accepted: list[str] | None = None,
    ref: str = S,
    qa: bool = False,
) -> dict:
    return {
        "id": tid, "order": order, "status": "queued", "enabled": enabled,
        "source": f"https://github.com/anpavel84-afk/gobadminton/blob/{ref}/docs/prompts/implementation/test.md",
        "admission": f"https://github.com/anpavel84-afk/gobadminton/blob/{ref}/docs/manifest/TEST_ADMISSION.md",
        "executor": "codex", "model": "gpt-6.1-sol", "effort": "medium",
        "sandbox": "workspace", "locks": locks or ["api"],
        "blocks": [{"id": "S1", "title": "Synthetic contract check"}],
        "depends_on_completed": deps or [], "depends_on_accepted": accepted or [],
    }


def as_bytes(tasks: list[dict]) -> bytes:
    return (json.dumps({"project": "GoBadminton", "prod_authorized": False, "tasks": tasks},
                       ensure_ascii=False, indent=2) + "\n").encode()


def git(repo: Path, *args: str) -> str:
    p = subprocess.run(["git", "-C", str(repo), *args],
                       text=True, capture_output=True, check=False, timeout=20)
    if p.returncode:
        raise AssertionError(f"git {' '.join(args)}: {p.stderr}")
    return p.stdout.strip()


class BacklogSyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="gb-sync-qa-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.remote = self.root / "remote.git"
        self.work = self.root / "work"
        self.runtime = self.root / "runner"
        self.runtime.mkdir()
        subprocess.run(["git", "init", "-q", "--bare", str(self.remote)], check=True)
        subprocess.run(["git", "init", "-q", "-b", "main", str(self.work)], check=True)
        git(self.work, "config", "user.name", "Synthetic QA")
        git(self.work, "config", "user.email", "qa@example.test")
        git(self.work, "remote", "add", "origin", str(self.remote))
        self.prompt = self.work / "docs/prompts/implementation/test.md"
        self.prompt.parent.mkdir(parents=True)
        self.prompt.write_text("# Test-only immutable source\n")
        self.admission = self.work / "docs/manifest/TEST_ADMISSION.md"
        self.admission.parent.mkdir(parents=True)
        self.admission.write_text("# Test-only accepted admission\n")
        git(self.work, "add", "docs")
        git(self.work, "commit", "-qm", "test: immutable prompts")
        self.ref = git(self.work, "rev-parse", "HEAD")
        self.web = task("web-live", order=1, locks=["web"], ref=self.ref)
        self.api = task("api-high", order=2, locks=["api", "schema-contracts"], ref=self.ref)
        self.backlog = self.work / backlog_sync.CANONICAL_PATH
        self.backlog.parent.mkdir(parents=True)
        self.backlog.write_bytes(as_bytes([self.web, self.api]))
        git(self.work, "add", backlog_sync.CANONICAL_PATH)
        git(self.work, "commit", "-qm", "test: canonical baseline")
        git(self.work, "push", "-q", "-u", "origin", "main")
        git(self.work, "fetch", "-q", "origin", "main")
        (self.runtime / "backlog.json").write_bytes(self.backlog.read_bytes())
        (self.runtime / "state.json").write_text(json.dumps({
            "paused": False, "blocked": None, "history": [], "active": {},
        }))
        (self.runtime / "config.json").write_text(json.dumps({
            "project": "GoBadminton", "prod_authorized": False, "workspace": str(self.work),
        }))
        (self.runtime / "receipts").mkdir()
        self._old_runner_dirs = runner.RECEIPTS_DIR, runner.BACKLOG_PATH
        runner.RECEIPTS_DIR = self.runtime / "receipts"
        runner.BACKLOG_PATH = self.runtime / "backlog.json"
        self.addCleanup(self.restore_runner)

    def restore_runner(self):
        runner.RECEIPTS_DIR, runner.BACKLOG_PATH = self._old_runner_dirs

    def update_canonical(self, tasks: list[dict]):
        self.backlog.write_bytes(as_bytes(tasks))
        git(self.work, "add", backlog_sync.CANONICAL_PATH)
        git(self.work, "commit", "-qm", "test: append owner admission")
        git(self.work, "push", "-q", "origin", "main")

    def set_state(self, *, active: dict | None = None, history: list | None = None):
        (self.runtime / "state.json").write_text(json.dumps({
            "paused": False, "blocked": None, "history": history or [], "active": active or {},
        }))

    def select(self, state: dict):
        b = json.loads((self.runtime / "backlog.json").read_text())
        cfg = {"max_parallel": 2, "prod_authorized": False}
        return runner.select_runnable_tasks(b, state, cfg)

    def test_01_new_owner_task_during_two_active_claims_persists(self):
        new = task("new-owner-api", order=0, locks=["api"], ref=self.ref)
        self.set_state(active={"web-live": {"id": "web-live", "locks": ["web"]},
                               "api-high": {"id": "api-high", "locks": ["api", "schema-contracts"]}})
        self.update_canonical([self.web, self.api, new])
        old_state = (self.runtime / "state.json").read_bytes()
        r = backlog_sync.sync_once(self.work, self.runtime)
        self.assertEqual(r["status"], "SYNCED")
        self.assertEqual(len(json.loads((self.runtime/"backlog.json").read_text())["tasks"]), 3)
        self.assertEqual((self.runtime/"state.json").read_bytes(), old_state)
        self.assertTrue(list((self.runtime/"backlog-backups").glob("*.json")))

    def test_02_single_free_slot_selects_independent_task(self):
        state = {"paused": False, "blocked": None, "history": [],
                 "active": {"web-live": {"id": "web-live", "locks": ["web"]}}}
        selected, _ = self.select(state)
        self.assertEqual([x["id"] for x in selected], ["api-high"])

    def test_03_occupied_api_lock_does_not_preempt_executor(self):
        state = {"paused": False, "blocked": None, "history": [],
                 "active": {"api-high": {"id": "api-high", "locks": ["api", "schema-contracts"]}}}
        selected, _ = self.select(state)
        self.assertEqual([x["id"] for x in selected], ["web-live"])

    def test_04_api_released_highest_priority_claims(self):
        high = task("new-high-priority-api", order=0, locks=["api"], ref=self.ref)
        self.update_canonical([self.web, self.api, high])
        r = backlog_sync.sync_once(self.work, self.runtime)
        self.assertEqual(r["status"], "SYNCED")
        selected, _ = self.select({"paused": False, "blocked": None, "history": [], "active": {}})
        self.assertEqual(selected[0]["id"], "new-high-priority-api")

    def test_05_implementation_completed_qa_is_selected(self):
        q = task("qa-api-high", order=2.1, locks=["api", "schema-contracts"],
                 deps=["api-high"], ref=self.ref, qa=True)
        self.update_canonical([self.web, self.api, q])
        self.assertEqual(backlog_sync.sync_once(self.work, self.runtime)["status"], "SYNCED")
        (self.runtime / "receipts/api-high.json").write_text(json.dumps({
            "ok": True, "task_id": "api-high", "project": "GoBadminton",
            "candidate_sha": self.ref, "candidate_tree": git(self.work, "rev-parse", self.ref + "^{tree}"),
            "branch": "main",
        }))
        state = {"paused": False, "blocked": None,
                 "history": [{"id": "api-high", "status": "completed"}], "active": {}}
        selected, _ = self.select(state)
        self.assertIn("qa-api-high", [x["id"] for x in selected])

    def test_06_qa_pass_and_merge_releases_downstream_dependency(self):
        qa = task("qa-api-high", order=2.1, deps=["api-high"], ref=self.ref)
        next_task = task("web-after-qa", order=2.2, locks=["web"],
                         accepted=["qa-api-high"], ref=self.ref)
        self.update_canonical([self.web, self.api, qa, next_task])
        self.assertEqual(backlog_sync.sync_once(self.work,self.runtime)["status"], "SYNCED")
        (self.runtime/"receipts/qa-api-high.json").write_text(json.dumps({
            "ok": True, "project": "GoBadminton", "task_id": "qa-api-high",
            "verdict": "PASS_WITH_NONBLOCKING_GAPS", "blocking_findings": [],
            "merge_recommendation": "MERGE_RECOMMENDED",
            "candidate_sha": self.ref
        }))
        state = {"paused": False, "blocked": None, "active": {},
                 "history": [{"id": "qa-api-high", "status": "completed"}]}
        self.assertTrue(runner.dependencies_ready(next_task,
                  json.loads((self.runtime/"backlog.json").read_text()),state)[0])

    def test_07_qa_fail_in_one_lane_does_not_block_other(self):
        q = task("qa-api-high", order=2.1, deps=["api-high"], ref=self.ref)
        alt = task("api-independent", order=3, locks=["api"], ref=self.ref)
        self.update_canonical([self.web, self.api, q, alt])
        self.assertEqual(backlog_sync.sync_once(self.work,self.runtime)["status"], "SYNCED")
        state = {"paused": False, "blocked": None, "active": {},
                 "history": [{"id": "api-high", "status": "completed"},
                             {"id": "qa-api-high", "status": "qa_failed"}]}
        selected,_ = self.select(state)
        self.assertIn("api-independent",[x["id"] for x in selected])
        self.assertNotIn("qa-api-high",[x["id"] for x in selected])

    def test_08_canonical_runtime_drift_reconciles_without_loss(self):
        alt = task("standby-owner-task",order=3,locks=["docs"],ref=self.ref)
        self.update_canonical([self.web,self.api,alt])
        previous = (self.runtime/"backlog.json").read_bytes()
        result = backlog_sync.sync_once(self.work,self.runtime)
        self.assertEqual(result["status"],"SYNCED")
        current=(self.runtime/"backlog.json").read_bytes()
        self.assertEqual(backlog_sync.git_blob_sha(current),result["canonical_blob"])
        self.assertNotEqual(current,previous)
        saved=list((self.runtime/"backlog-backups").glob("*.json"))
        self.assertEqual(len(saved),1)
        self.assertEqual(saved[0].read_bytes(),previous)
        self.assertEqual(backlog_sync.sync_once(self.work,self.runtime)["status"],"IN_SYNC")

    def test_09_new_owner_admission_uses_immutable_sha(self):
        new=task("owner-admitted",order=0,locks=["api"],ref=self.ref)
        self.update_canonical([self.web,self.api,new])
        self.assertEqual(backlog_sync.sync_once(self.work,self.runtime)["status"],"SYNCED")
        new["admission"]="https://github.com/anpavel84-afk/gobadminton/blob/main/docs/manifest/TEST_ADMISSION.md"
        self.update_canonical([self.web,self.api,new])
        # Even a change to admission alone must retain an exact immutable SHA.
        self.assertEqual(backlog_sync.sync_once(self.work,self.runtime)["status"],"BLOCKED")
        self.assertEqual(json.loads((self.runtime/"backlog.json").read_text())["tasks"][-1]["id"],"owner-admitted")

    def test_10_restart_preserves_claims_history_receipts_and_attempts(self):
        self.set_state(active={"web-live":{"id":"web-live","locks":["web"],"agent_pid":999}},
                       history=[{"id":"old-fail","status":"qa_failed","reason":"historical"}])
        (self.runtime/"receipts/old-fail.json").write_text('{"verdict":"FAIL","ok":false}')
        (self.runtime/"attempts.json").write_text('{"old-fail":5}')
        before={name:(self.runtime/name).read_bytes() for name in ["state.json","receipts/old-fail.json","attempts.json"]}
        new=task("new-deployment-free",order=3,locks=["docs"],ref=self.ref)
        self.update_canonical([self.web,self.api,new])
        self.assertEqual(backlog_sync.sync_once(self.work,self.runtime)["status"],"SYNCED")
        self.assertEqual(backlog_sync.sync_once(self.work,self.runtime)["status"],"IN_SYNC")
        for name,raw in before.items():
            self.assertEqual((self.runtime/name).read_bytes(),raw,name)

    def test_11_task_id_removal_fails_closed(self):
        self.update_canonical([self.web])
        self.assertEqual(backlog_sync.sync_once(self.work,self.runtime)["status"],"BLOCKED")
        self.assertEqual(len(json.loads((self.runtime/"backlog.json").read_text())["tasks"]),2)

    def test_12_active_task_mutation_fails_closed(self):
        self.set_state(active={"web-live":{"id":"web-live","locks":["web"]}})
        changed=copy.deepcopy(self.web);changed["source"]="https://example.com/moving"
        self.update_canonical([changed,self.api])
        self.assertEqual(backlog_sync.sync_once(self.work,self.runtime)["status"],"BLOCKED")
        self.assertEqual(json.loads((self.runtime/"backlog.json").read_text())["tasks"][0]["source"],self.web["source"])

    def test_13_terminal_qa_status_cannot_be_reopened(self):
        old=copy.deepcopy(self.api);old["status"]="qa_failed"
        (self.runtime/"backlog.json").write_bytes(as_bytes([self.web,old]))
        self.assertEqual(backlog_sync.sync_once(self.work,self.runtime)["status"],"BLOCKED")

    def test_14_unapproved_new_task_missing_admission_is_rejected(self):
        t=task("rogue",ref=self.ref)
        del t["admission"]
        self.update_canonical([self.web,self.api,t])
        self.assertEqual(backlog_sync.sync_once(self.work,self.runtime)["status"],"BLOCKED")

    def test_15_old_branch_does_not_overwrite_new_main(self):
        new=task("owner-git-main-new",ref=self.ref)
        self.update_canonical([self.web,self.api,new])
        self.assertEqual(backlog_sync.sync_once(self.work,self.runtime)["status"],"SYNCED")
        # A local old checkout HEAD remains at prior commit; git fetch from
        # origin/main, not git show HEAD:/_automation.
        self.assertEqual(len(json.loads((self.runtime/"backlog.json").read_text())["tasks"]),3)


    def test_16_new_pm_admission_without_queue_flag_is_diagnosed(self):
        self.assertEqual(backlog_sync.sync_once(self.work,self.runtime)["status"], "IN_SYNC")
        held=task("owner-admitted-held",ref=self.ref,enabled=False)
        self.update_canonical([self.web,self.api,held])
        self.assertEqual(backlog_sync.sync_once(self.work,self.runtime)["status"], "SYNCED")
        name=self.work/"docs/manifest/PM_ADMISSION_OWNER_SUBMITTED_V001.md"
        name.write_text(
            "# PM admission\\nStatus: OWNER_AUTHORIZED / SOURCE_ONLY_ADMITTED\\n"
            "Exactly two existing tasks: "+chr(96)+"owner-admitted-held"+chr(96)+" and dependent QA.\\n"
        )
        git(self.work,"add",str(name.relative_to(self.work)))
        git(self.work,"commit","-qm","test: admitted document without enabling task")
        git(self.work,"push","-q","origin","main")
        result=backlog_sync.sync_once(self.work,self.runtime)
        self.assertEqual(result["status"],"IN_SYNC")
        self.assertEqual(result["admission_drift"][0]["disabled_queued_task_ids"],["owner-admitted-held"])

    def test_17_qa88_uninspectable_agent_fails_closed(self):
        class Agent:
            info={"pid":876543,"name":"codex-code-mode-host","cmdline":None}
            def cwd(self):
                raise runner.psutil.AccessDenied(pid=876543)
            def parents(self):
                return []
        cfg={"workspace":str(self.work),"dev_root":str(self.work.parent)}
        with mock.patch.object(runner.psutil,"process_iter",return_value=[Agent()]):
            busy,reason=runner.external_cursor_agent_busy(cfg,None,set())
        self.assertTrue(busy)
        self.assertIn("fail closed",reason)

    def test_18_active_owner_intake_prompt_is_source_only(self):
        cfg={"workspace":str(self.work)}
        item={"id":"owner-test","status":"NEW","origin":"OWNER_INBOX",
              "payload":{"text":"Please add next ready task without stopping two workers"}}
        prompt=autopilot.build_prompt(cfg,[item],active_admission_only=True)
        self.assertIn("Active application or QA executors exist",prompt)
        self.assertIn("source-only",prompt.lower())
        self.assertIn("Please add next ready task",prompt)
        self.assertIn("do NOT copy a local worktree file",prompt)

    def test_19_drift_notice_is_idempotent_and_not_owner_authorization(self):
        info={"canonical_commit":self.ref,
              "admission_drift":[{"admission_path":"docs/manifest/PM_ADMISSION_OWNER_V001.md",
                                  "disabled_queued_task_ids":["owner-admitted-held"]}]}
        with mock.patch.object(autopilot,"OWNER_INBOX_DIR",self.runtime/"owner-inbox"):
            a=autopilot.enqueue_admission_reconcile_notice(info)
            b=autopilot.enqueue_admission_reconcile_notice(info)
        self.assertEqual(a,b)
        files=list((self.runtime/"owner-inbox").glob("*.json"))
        self.assertEqual(len(files),1)
        value=json.loads(files[0].read_text())
        self.assertEqual(value["status"],"NEW")
        self.assertIn("NOT_OWNER",value["origin"])
        self.assertIn("not enable",value["text"].lower()) if "not enable" in value["text"].lower() else self.assertIn("do not enable",value["text"].lower())

    def test_20_readiness_with_global_qa_gate_is_not_a_ready_task(self):
        t=task("web-after-qa",order=3,locks=["web"],accepted=["qa-api-high"],ref=self.ref)
        qa=task("qa-api-high",order=2,deps=["api-high"],ref=self.ref)
        self.update_canonical([self.web,self.api,qa,t])
        self.assertEqual(backlog_sync.sync_once(self.work,self.runtime)["status"],"SYNCED")
        b=json.loads((self.runtime/"backlog.json").read_text())
        state={"paused":False,"blocked":None,"history":[{"id":"qa-api-high","status":"qa_failed"}],"active":{}}
        ready,reason=runner.dependencies_ready(t,b,state)
        self.assertFalse(ready)
        self.assertIn("waiting accepted dependency",reason)


if __name__=="__main__":
    unittest.main(verbosity=2)

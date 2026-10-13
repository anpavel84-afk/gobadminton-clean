"""Isolated Clean Issue intake and sandbox/runner commissioning regressions.

No GitHub network, original VPS, Codex process, Git push, root policy,
Publisher activation or database. All externally sourced comments are fixtures.
"""
from __future__ import annotations
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock
import sys
from types import SimpleNamespace

try:
    import psutil
except ModuleNotFoundError:
    sys.modules["psutil"] = SimpleNamespace(
        Error=OSError, AccessDenied=OSError, NoSuchProcess=OSError,
        process_iter=lambda *args, **kwargs: ())

import github_owner_issue_intake as intake
import runner


ROOT = Path(__file__).resolve().parent
QUEUE = json.loads((ROOT.parent / "backlog.json").read_text())


def owner_comment(body=None, *, owner_id=intake.OWNER_ID,
                  cid=intake.OWNER_BOOTSTRAP_COMMENT):
    return {
        "id": cid, "issue_url": intake.ISSUE_URL,
        "url": intake.COMMENT_URL + str(cid),
        "created_at": intake.OWNER_BOOTSTRAP_CREATED,
        "user": {"login": intake.OWNER_LOGIN, "id": owner_id, "type": "User"},
        "body": body or (
            "## OWNER REQUEST · ONE-TIME AUTO-RUNNER COMMISSIONING · 2026-10-13\n"
            "OPERATOR_PAUSED retained until protected QA and Publisher.\n"
            "DEV only. PROD not allowed.\n"
        ),
    }


class FakeResponse:
    def __init__(self, url, body):
        self.url = url
        self.data = json.dumps(body).encode("utf-8")

    def geturl(self):
        return self.url

    def read(self, n):
        return self.data[:n]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass


class CleanOwnerIssueIntake(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="gb-owner-intake-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "owner-inbox").mkdir(mode=0o700)
        self.input = copy.deepcopy(QUEUE)

    def test_exact_owner_bootstrap_admits_prepared_tasks_not_live_claim(self):
        x = intake.checked_comment(owner_comment(), self.input)
        self.assertEqual(x["task_ids"], list(intake.BOOTSTRAP_IDS))
        self.assertEqual(x["origin"], "VERIFIED_GITHUB_OWNER_ISSUE")
        self.assertEqual(x["status"], "NEW")
        self.assertEqual(x["scope"], "SOURCE_ONLY_DEV_NO_PROD")
        self.assertEqual(len(x["text_sha256"]), 64)
        self.assertFalse(any(x.get(z) for z in ("accepted", "deployed", "claimed")))

    def test_public_spoof_wrong_owner_issue_or_comment_identity_refused(self):
        self.assertIsNone(intake.checked_comment(
            owner_comment(owner_id=1234), self.input))
        x = owner_comment()
        x["issue_url"] = "https://api.github.com/repos/evil/other/issues/4"
        with self.assertRaises(intake.IntakeHold):
            intake.checked_comment(x, self.input)
        x = owner_comment()
        x["url"] = x["url"] + "/fake"
        with self.assertRaises(intake.IntakeHold):
            intake.checked_comment(x, self.input)
        x = owner_comment()
        x["created_at"] = "2026-10-10T00:00:00Z"
        with self.assertRaises(intake.IntakeHold):
            intake.checked_comment(x, self.input)

    def test_other_owner_comments_not_automatically_task_authority(self):
        x = owner_comment("hello PM, how is the work?", cid=777700)
        self.assertIsNone(intake.checked_comment(x, self.input))
        arbitrary = owner_comment("please deploy to PROD now", cid=777701)
        self.assertIsNone(intake.checked_comment(arbitrary, self.input))

    def test_typed_future_pm_event_is_bounded_to_existing_dev_tasks(self):
        body = intake.MARKER + "\n" + json.dumps({
            "schema": intake.MARKER, "issue": 4,
            "task_ids": ["avatar-created-games-ui-20261013-v001"],
            "effect_ceiling": "source_only",
        })
        x = intake.checked_comment(owner_comment(body, cid=900001), self.input)
        self.assertEqual(x["task_ids"], ["avatar-created-games-ui-20261013-v001"])
        for edit in (
            {"effect_ceiling": "production"},
            {"task_ids": ["../../root"]},
            {"task_ids": ["invented-api-prod-write-v001"]},
            {"task_ids": [x["task_ids"][0], x["task_ids"][0]]},
        ):
            payload = json.loads(body.split("\n", 1)[1])
            payload.update(edit)
            with self.subTest(edit=edit), self.assertRaises(intake.IntakeHold):
                intake.checked_comment(owner_comment(
                    intake.MARKER + "\n" + json.dumps(payload),
                    cid=900001), self.input)
        with self.assertRaises(intake.IntakeHold):
            intake.checked_comment(owner_comment(
                intake.MARKER + "\n" + '{"schema":"x","schema":"y"}',
                cid=900002), self.input)

    def test_durable_event_exclusive_idempotency_and_replay_refusal(self):
        rec = intake.checked_comment(owner_comment(), self.input)
        self.assertTrue(intake.write_unique(self.root / "owner-inbox", rec))
        self.assertFalse(intake.write_unique(self.root / "owner-inbox", rec))
        path = self.root / "owner-inbox" / (rec["id"] + ".json")
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(path.read_text())["status"], "NEW")
        altered = {**rec, "text_sha256": "e" * 64}
        with self.assertRaises(intake.IntakeHold):
            intake.write_unique(self.root / "owner-inbox", altered)
        self.assertEqual(len(list((self.root / "owner-inbox").glob("*.json"))), 1)

    def test_polling_authenticated_issue_read_only_and_throttled(self):
        calls = []
        def opener(request, timeout=12):
            calls.append(request.full_url)
            return FakeResponse(request.full_url, [owner_comment()])
        a = intake.poll_once(self.root, self.input, opener=opener, now=1000000000)
        self.assertEqual(a, ["github-issue4-comment-6148670164"])
        self.assertEqual(len(calls), 1)
        b = intake.poll_once(self.root, self.input, opener=opener, now=1000000050)
        self.assertEqual(b, [])
        self.assertEqual(len(calls), 1)
        c = intake.poll_once(self.root, self.input, opener=opener, now=1000000600)
        self.assertEqual(c, [])
        self.assertEqual(len(calls), 2)
        self.assertEqual(len(list((self.root / "owner-inbox").glob("*.json"))), 1)

    def test_http_redirect_and_missing_private_inbox_fail_closed(self):
        def redirected(request, timeout=12):
            return FakeResponse("https://evil.example/not-github", [owner_comment()])
        with self.assertRaisesRegex(intake.IntakeHold, "redirected"):
            intake.poll_once(self.root, self.input, opener=redirected, now=1000000000)
        self.assertFalse((self.root / "github-issue-intake-last-poll").exists())
        def normal(request, timeout=12):
            return FakeResponse(request.full_url, [owner_comment()])
        (self.root / "owner-inbox").chmod(0o777)
        with self.assertRaisesRegex(intake.IntakeHold, "private"):
            intake.poll_once(self.root, self.input, opener=normal, now=1000000000)

    def test_no_prod_or_wrong_clean_root_even_with_valid_comment(self):
        invalid = copy.deepcopy(self.input)
        invalid["prod_authorized"] = True
        with self.assertRaises(intake.IntakeHold):
            intake.poll_once(self.root, invalid, opener=lambda request, timeout:
                             FakeResponse(request.full_url, [owner_comment()]), now=1000000000)
        invalid = copy.deepcopy(self.input)
        for t in invalid["tasks"]:
            if t["id"] == intake.BOOTSTRAP_IDS[0]:
                t["source"] = "file:///etc/passwd"
        with self.assertRaises(intake.IntakeHold):
            intake.checked_comment(owner_comment(), invalid)


class CleanCodexWorktree(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="gb-codex-worktree-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.cli = self.root / "codex"
        self.cli.write_text("dummy CLI, never executed\n")
        self.worktrees = self.root / "worktrees"
        self.worktrees.mkdir()
        self.workspace = self.worktrees / "runner-friends-api"
        self.workspace.mkdir()
        self.control = self.root / "runner"
        self.control.mkdir()
        self.receipts = self.control / "receipts"
        self.receipts.mkdir()
        self.cfg = {
            "project_repo": "anpavel84-afk/gobadminton-clean",
            "workspace": str(self.root / "shared_repo"),
            "worktrees_root": str(self.worktrees),
            "codex_cli": str(self.cli),
            "node_bin": "/home/agentagency-dev/.local/node-v24.21.0/bin",
            "local_bin": "/home/agentagency-dev/.local/bin",
        }

    def capture(self, task):
        with patch.object(runner, "ROOT", self.control), patch.object(
            runner, "RECEIPTS_DIR", self.receipts), patch.object(
            runner.subprocess, "Popen", return_value=Mock(pid=10000)) as proc:
            runner.launch_agent(self.cfg, task, "Test prompt; no execution")
            self.assertEqual(proc.call_count, 1)
            return proc.call_args.args[0], proc.call_args.kwargs

    def test_producer_scoped_worktree_no_sibling_or_control_roots(self):
        task={"id":"friends-dev-s1-api-20261013-v001","executor":"codex",
              "sandbox":"workspace","model":"gpt-6.1-sol",
              "_workspace":str(self.workspace)}
        cmd,kwargs=self.capture(task)
        self.assertEqual(cmd[cmd.index("-C")+1],str(self.workspace))
        self.assertEqual(kwargs["cwd"],str(self.workspace))
        self.assertIn("--approve-for-me",cmd)
        self.assertNotIn("--add-dir",cmd)
        self.assertNotIn("--dangerously-bypass-approvals-and-sandbox",cmd)
        self.assertEqual(cmd[cmd.index("--output-last-message")+1],
                         str(self.receipts / (task["id"]+".json")))
        self.assertTrue(kwargs["env"]["PATH"].startswith(
            "/home/agentagency-dev/.local/node-v24.21.0/bin:"))

    def test_clean_full_or_cursor_or_escaped_worktree_no_spawn(self):
        good={"id":"friends-dev-s1-api-20261013-v001","executor":"codex",
              "sandbox":"workspace","_workspace":str(self.workspace)}
        for task in ({**good,"sandbox":"full"},
                     {**good,"executor":"cursor"},
                     {**good,"_workspace":str(self.root / "shared_repo")}):
            with self.subTest(task=task),self.assertRaises(RuntimeError),patch.object(
                runner.subprocess,"Popen") as process:
                self.capture_without_spawn(task,process)
                process.assert_not_called()

    def capture_without_spawn(self,task,proc):
        with patch.object(runner,"ROOT",self.control),patch.object(
            runner,"RECEIPTS_DIR",self.receipts):
            runner.launch_agent(self.cfg,task,"No execution")


if __name__ == "__main__":
    unittest.main()

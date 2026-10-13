"""Runner PR11 R3: require real Codex read-only mode and isolated clean service names."""
from __future__ import annotations
import sys
from types import SimpleNamespace
from unittest.mock import patch
import unittest
from pathlib import Path

try:
    import psutil
except ModuleNotFoundError:
    sys.modules["psutil"] = SimpleNamespace(
        Error=OSError, AccessDenied=OSError, NoSuchProcess=OSError,
        process_iter=lambda *a, **k: ())
import runner
import control_agent

class QASandboxAndControlR3(unittest.TestCase):
    def cfg(self):
        return {"project":"GoBadminton",
                "workspace":"/srv/gobadminton-clean/repo",
                "worktrees_root":"/srv/gobadminton-clean/worktrees",
                "codex_cli":"/home/agentagency-dev/.local/bin/codex",
                "cursor_agent":"/home/agentagency-dev/.local/bin/agent",
                "prod_authorized":False,
                "max_parallel":2}
    def command(self, task):
        with patch.object(runner.subprocess,"Popen",return_value=SimpleNamespace(pid=100000,returncode=0)) as p:
            runner.launch_agent(self.cfg(),task,"Unit-test prompt only")
            assert p.call_count==1
            return list(p.call_args.args[0]),p.call_args.kwargs
    def test_readonly_qa_codex_disallows_all_write_modes(self):
        task={"id":"qa-friends-s1-v001","executor":"codex","model":"gpt-6.1-sol",
              "sandbox":"read-only","effort":"medium"}
        cmd,kw=self.command(task)
        self.assertIn("--sandbox",cmd)
        self.assertEqual(cmd[cmd.index("--sandbox")+1],"read-only")
        self.assertNotIn("--approve-for-me",cmd)
        self.assertNotIn("--dangerously-bypass-approvals-and-sandbox",cmd)
        self.assertNotIn("--add-dir",cmd)
        self.assertIn("--output-last-message",cmd)
        target=cmd[cmd.index("--output-last-message")+1]
        self.assertEqual(target,str(runner.RECEIPTS_DIR / (task["id"]+".json")))
        self.assertTrue(cmd[-1].endswith("Failure to prove a reviewer/job means BLOCKED."))
        self.assertEqual(kw["cwd"],"/srv/gobadminton-clean/repo")
    def test_readonly_task_cannot_redirect_output_outside_runner(self):
        x={"id":"qa-friends-s1-v001","executor":"codex","sandbox":"read-only",
           "receipt":"/tmp/qa-root-proof.json"}
        with self.assertRaisesRegex(RuntimeError,"cannot redirect"):
            self.command(x)
    def test_readonly_task_invalid_id_rejected(self):
        x={"id":"../escape","executor":"codex","sandbox":"read-only"}
        with self.assertRaisesRegex(RuntimeError,"invalid read-only task ID"):
            self.command(x)
    def test_readonly_cursor_must_fail_closed(self):
        x={"id":"qa-friends-s1-v001","executor":"cursor","sandbox":"read-only"}
        with patch.object(runner.subprocess,"Popen") as proc:
            with self.assertRaisesRegex(RuntimeError,"separately verified"):
                runner.launch_agent(self.cfg(),x,"Unit-test prompt")
            proc.assert_not_called()
    def test_regular_codex_producer_retains_bounded_workspace(self):
        x={"id":"friends-s1-implementation","executor":"codex","sandbox":"workspace"}
        cmd,_=self.command(x)
        self.assertIn("--approve-for-me",cmd)
        self.assertNotIn("--sandbox",cmd)
        self.assertIn("--add-dir",cmd)
    def test_workspace_parser_case_sensitive_codex_config(self):
        args=["codex","exec","-C","/srv/gobadminton-clean/repo",
              "-c",'model_reasoning_effort="medium"',"--sandbox","read-only"]
        self.assertEqual(runner._workspace_args(args),["/srv/gobadminton-clean/repo"])
        args2=["codex","exec","-c","config=xyz","--cd","/tmp/code"]
        self.assertEqual(runner._workspace_args(args2),["/tmp/code"])
    def test_old_and_uncommissioned_services_are_hard_denied_without_systemctl(self):
        for service in ("gobadminton-runner.service","gobadminton-autopilot.service",
                        "gobadminton-clean-autopilot.service","gobadminton-dashboard.service"):
            with self.subTest(service=service),patch.object(control_agent,"sh") as sh:
                ok,reason=control_agent.service_restart_allowed(service)
                self.assertFalse(ok)
                self.assertIn("forbidden",reason)
                sh.assert_not_called()
    def test_clean_runner_service_maps_to_actual_unit(self):
        self.assertEqual(str(control_agent.ROOT),"/srv/gobadminton-clean/runner")
        self.assertEqual(str(control_agent.PYTHON),"/srv/gobadminton-dev/runner/.venv/bin/python")
        with patch.object(control_agent,"bounded_restart",return_value=True) as restart:
            self.assertEqual(control_agent.execute({"type":"RESTART_RUNNER"}),"runner restarted")
            restart.assert_called_once_with("gobadminton-clean-runner.service")
    def test_old_owner_command_endpoint_absent_and_blocked(self):
        self.assertEqual(control_agent.REMOTE,"")
        with self.assertRaisesRegex(RuntimeError,"No clean-root authenticated Owner"):
            control_agent.request("/api/commands")
if __name__=="__main__":
    unittest.main()

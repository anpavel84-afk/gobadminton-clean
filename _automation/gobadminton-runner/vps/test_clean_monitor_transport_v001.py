"""Actual monitor liveness and transport-hold code never imply completion."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import monitor_snapshot as monitor
from github_owner_issue_intake import IntakeHold


class MonitorTransport(unittest.TestCase):
    def fake_path(self, command):
        def path(value):
            if str(value).endswith('/cmdline'):
                return SimpleNamespace(read_bytes=lambda: command)
            if str(value).endswith('/exe'):
                def denied():
                    raise PermissionError('different primary group')
                return SimpleNamespace(resolve=denied)
            return Path(value)
        return path

    def test_actual_launcher_pid_survives_monitor_group_difference(self):
        command=b'node\0/home/agentagency-dev/.local/bin/codex\0exec\0-C\0/source\0'
        with patch.object(monitor, 'Path', side_effect=self.fake_path(command)):
            self.assertEqual(monitor.verified_pid(123, 'exec'), 123)
            self.assertEqual(monitor.clean_claim({'id':'friends','agent_pid':123})['pid'],123)

    def test_unproven_launcher_and_noninteger_pid_are_not_displayed(self):
        for command in (b'node\0/tmp/codex\0exec\0',
                        b'node\0/home/agentagency-dev/.local/bin/codex\0help\0'):
            with patch.object(monitor,'Path',side_effect=self.fake_path(command)):
                self.assertIsNone(monitor.verified_pid(123,'exec'))
        for value in (True, '123', 0, None):
            self.assertIsNone(monitor.verified_pid(value, 'exec'))

    def test_actual_monitor_completed_list_excludes_terminal_failures(self):
        tree=ast.parse(Path(monitor.__file__).read_text(encoding='utf-8'))
        main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
        statements=[n for n in main.body if isinstance(n,ast.Assign)
                    and any(isinstance(t,ast.Name) and t.id in {'terminal','completed'} for t in n.targets)]
        context={'actual_state':{'history':[{'id':'old','status':'blocked'},
                  {'id':'qa-old','status':'qa_failed'},{'id':'new','status':'completed'}]},
                 'task_id':monitor.task_id}
        exec(compile(ast.Module(body=statements,type_ignores=[]),'<actual-monitor>','exec'),context)
        self.assertEqual(context['completed'],['new'])

    def hold_block(self):
        tree=ast.parse(Path(__file__).with_name('autopilot.py').read_text(encoding='utf-8'))
        main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
        return next(n for n in ast.walk(main) if isinstance(n,ast.Try)
                    and 'pending_owner_instructions()' in ast.unparse(n)
                    and 'owner_intake_transport_held' in ast.unparse(n)
                    and any(isinstance(h.type,ast.Name) and h.type.id=='RuntimeError' for h in n.handlers))

    def run_hold(self,error):
        context={'pending_owner_instructions':Mock(side_effect=error),'ap_state':{},
                 'write_json':Mock(),'AUTOPILOT_STATE_PATH':Path('/status'),
                 'wait_for_wake':Mock(),'ACTIVE_POLL_SECONDS':5,'planned':[]}
        after=ast.parse('planned.append(True)').body
        loop=ast.For(target=ast.Name(id='_',ctx=ast.Store()),iter=ast.List(elts=[ast.Constant(0)],ctx=ast.Load()),
                     body=[self.hold_block(),*after],orelse=[])
        program=ast.fix_missing_locations(ast.Module(body=[loop],type_ignores=[]))
        exec(compile(program,'<actual-autopilot-transport>','exec'),context)
        return context

    def test_intake_transport_failure_holds_planning_without_restarting(self):
        error=RuntimeError('authenticated intake held');error.__cause__=IntakeHold('API unavailable')
        context=self.run_hold(error)
        self.assertEqual(context['ap_state']['status'],'owner_intake_transport_held')
        self.assertEqual(context['planned'],[])
        context['write_json'].assert_called_once()
        context['wait_for_wake'].assert_called_once_with(5)

    def test_other_runtime_errors_are_not_hidden_as_transport_holds(self):
        with self.assertRaisesRegex(RuntimeError,'unexpected integrity failure'):
            self.run_hold(RuntimeError('unexpected integrity failure'))


if __name__=='__main__':
    unittest.main()

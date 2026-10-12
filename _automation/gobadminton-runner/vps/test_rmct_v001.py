import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parent))
import runner
import autopilot

DEV = Path('/srv/gobadminton-dev')
CFG = {'workspace': str(DEV / 'repo'), 'dev_root': str(DEV)}

class Proc:
    def __init__(self, cwd, parent=None):
        self.info = {'pid': 70001, 'cmdline': ['codex', 'exec', '-C', str(cwd)]}
        self._cwd = cwd
        self._parent = parent
    def cwd(self): return str(self._cwd)
    def parents(self):
        out=[]
        parent=self._parent
        while parent:
            out.append(parent)
            parent=getattr(parent,'_parent',None)
        return out
    def cmdline(self): return self.info['cmdline']

class WriterTests(unittest.TestCase):
    def busy(self, proc):
        with patch.object(runner.psutil, 'process_iter', return_value=[proc]):
            return runner.external_cursor_agent_busy(CFG, None)[0]
    def test_external_blocks(self):
        self.assertTrue(self.busy(Proc(DEV / 'worktrees/external')))
    def test_other_project_free(self):
        self.assertFalse(self.busy(Proc(Path('/tmp/unrelated-project'))))
    def test_other_project_prompt_mention_does_not_block(self):
        proc = Proc(Path('/srv/traffic-content/repo'))
        proc.info['cmdline'] = [
            'codex', 'exec', '-C', '/srv/traffic-content/repo',
            'Traffic task: /srv/gobadminton-dev is strictly out of scope',
        ]
        self.assertFalse(self.busy(proc))
    def test_explicit_gobadminton_workspace_blocks_even_from_other_cwd(self):
        proc = Proc(Path('/srv/traffic-content/repo'))
        proc.info['cmdline'] = ['codex', 'exec', '-C', str(DEV / 'worktrees/real-writer')]
        self.assertTrue(self.busy(proc))
    def test_managed_planner_free(self):
        parent = Proc(DEV / 'repo')
        parent.pid = 70000
        parent.info['cmdline'] = ['python', str(DEV / 'runner/autopilot.py')]
        with patch.object(Path, 'read_text', return_value='0::/system.slice/gobadminton-autopilot.service\n'):
            self.assertFalse(self.busy(Proc(DEV / 'worktrees/pm-autopilot', parent)))
    def test_managed_planner_child_helper_free(self):
        service=Proc(DEV/'repo');service.pid=70000
        service.info['cmdline']=['python',str(DEV/'runner/autopilot.py')]
        planner=Proc(DEV/'worktrees/pm-autopilot',service);planner.pid=70002
        helper=Proc(DEV/'worktrees/pm-autopilot',planner);helper.pid=70003
        helper.info['cmdline']=['/opt/openai/codex-code-mode-host']
        with patch.object(Path,'read_text',return_value='0::/system.slice/gobadminton-autopilot.service\n'):
            self.assertFalse(self.busy(helper))
    def test_managed_planner_child_wrong_cgroup_blocks(self):
        service=Proc(DEV/'repo');service.pid=70000
        service.info['cmdline']=['python',str(DEV/'runner/autopilot.py')]
        planner=Proc(DEV/'worktrees/pm-autopilot',service)
        helper=Proc(DEV/'worktrees/pm-autopilot',planner)
        helper.info['cmdline']=['/opt/openai/codex-code-mode-host']
        with patch.object(Path,'read_text',return_value='0::/unmanaged.service'):
            self.assertTrue(self.busy(helper))
    def test_ambiguous_planner_blocks(self):
        self.assertTrue(self.busy(Proc(DEV / 'worktrees/pm-autopilot')))
    def test_cursor_external_blocks(self):
        proc = Proc(DEV / 'repo');proc.info['cmdline'] = ['cursor-agent','--print','--workspace',str(DEV/'repo')]
        self.assertTrue(self.busy(proc))
    def test_service_ancestry_unreadable_or_wrong_cgroup_blocks(self):
        parent = Proc(DEV / 'repo');parent.pid=70000
        parent.info['cmdline']=['python',str(DEV/'runner/autopilot.py')]
        proc=Proc(DEV/'worktrees/pm-autopilot',parent)
        with patch.object(Path,'read_text',side_effect=PermissionError): self.assertTrue(self.busy(proc))
        with patch.object(Path,'read_text',return_value='0::/unmanaged.service'):
            self.assertTrue(self.busy(proc))
            proc._cwd=DEV/'worktrees/task'
            self.assertTrue(self.busy(proc))
    def test_managed_parent_with_conflicting_command_workspace_blocks(self):
        parent=Proc(DEV/'repo');parent.pid=70000
        parent.info['cmdline']=['python',str(DEV/'runner/autopilot.py')]
        proc=Proc(DEV/'worktrees/pm-autopilot',parent)
        proc.info['cmdline']=['codex','exec','-C',str(DEV/'worktrees/task')]
        with patch.object(Path,'read_text',return_value='0::/system.slice/gobadminton-autopilot.service'):
            self.assertTrue(self.busy(proc))
    def test_queue_executor_blocks(self):
        with patch.object(runner, 'pid_alive', return_value=True):
            self.assertTrue(runner.writer_busy(CFG, {'current': {'agent_pid': 70001}})[0])

class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='gb-scope03-rmct-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name in ('STATE_PATH', 'BACKLOG_PATH', 'BLOCK_RELEASE_PATH', 'LOG_PATH', 'PROGRESS_PATH'):
            replacement = self.root / name.lower()
            patcher = patch.object(runner, name, replacement)
            patcher.start(); self.addCleanup(patcher.stop)
        patcher = patch.object(runner, 'RECEIPTS_DIR', self.root / 'receipts')
        patcher.start(); self.addCleanup(patcher.stop)
        self.state = {'blocked': {'id': 'held', 'reason': 'missing candidate', 'at': 'fixed'},
                      'current': {'id': 'held', 'status': 'blocked'},
                      'history': [{'id': 'held', 'status': 'blocked', 'reason': 'original'}],
                      'attempts': {'held': 5}}
        self.receipt = {'project': 'GoBadminton', 'task_id': 'held', 'ok': False,
                        'owner_blocker': False, 'blocker_scope': 'lane_local', 'verdict': 'BLOCKED'}
        self.sha = 'a'*40
        self.backlog = {'tasks': [{'id': 'held', 'enabled': False, 'status': 'blocked'}]}
    def test_scope_and_owner_hard_stops(self):
        with patch.object(runner, 'read_receipt', return_value=self.receipt):
            self.assertTrue(runner.lane_local_block(self.state))
            for scope in ('project_global', None):
                self.receipt['blocker_scope'] = scope
                self.assertFalse(runner.lane_local_block(self.state))
            self.receipt['blocker_scope'] = 'lane_local'
            self.receipt['owner_blocker'] = True
            self.assertFalse(runner.lane_local_block(self.state))
            self.receipt['owner_blocker'] = False
            self.state['global_gates'] = ['privacy']
            self.assertFalse(runner.lane_local_block(self.state))
    def release(self, request=None, remote_sha=None):
        from types import SimpleNamespace
        request = request or {'blocked': copy.deepcopy(self.state['blocked']), 'result_commit': self.sha}
        def git(args, **kw):
            return SimpleNamespace(returncode=0, stdout=(remote_sha or self.sha)+' refs/heads/main' if 'ls-remote' in args else json.dumps(self.backlog))
        with patch.object(runner, 'read_receipt', return_value=self.receipt), \
             patch.object(runner, 'load_json', return_value=request), \
             patch.object(runner, 'load_backlog', return_value=self.backlog), \
             patch.object(runner.subprocess, 'run', side_effect=git), \
             patch.object(runner, 'save_state') as save:
            result = runner.release_lane_block(CFG, self.state)
            return result, save.call_count
    def test_release_preserves_terminal_evidence_and_attempts(self):
        old = copy.deepcopy(self.state)
        self.assertEqual(self.release(), (True, 1))
        self.assertIsNone(self.state['blocked'])
        self.assertIsNone(self.state['current'])
        self.assertEqual(self.state['history'][0], old['history'][0])
        self.assertEqual(self.state['attempts'], old['attempts'])
        self.assertEqual(self.receipt['verdict'], 'BLOCKED')
        self.assertEqual(runner.pending_tasks({'tasks': [{'id':'held','status':'queued'}]}, self.state), [])
    def test_release_requires_quarantine_and_durable_sha(self):
        self.backlog['tasks'][0]['enabled'] = True
        self.assertEqual(self.release(), (False, 0))
        self.backlog['tasks'][0]['enabled'] = False
        self.assertEqual(self.release(remote_sha='b'*40), (False, 0))
        self.assertEqual(self.release({'blocked': {'id':'different'},'result_commit':self.sha}), (False, 0))
    def test_qa_terminal_keeps_attempt_counter(self):
        def mutate(fn):
            fn(self.state)
            return self.state
        with patch.object(runner, '_v2_mutate_state', side_effect=mutate), \
             patch.object(runner, '_v2_finish_progress'), \
             patch.object(runner, '_v2_refresh_compat_progress'), \
             patch.object(runner, 'wake_autopilot'), patch.object(runner, 'log'):
            runner.mark_qa_terminal('held', 'BLOCKED', 'no new immutable candidate')
        self.assertEqual(self.state['attempts']['held'], 5)
        self.assertEqual(self.state['history'][-1]['verdict'], 'BLOCKED')

    def test_terminal_retry_refused_without_state_mutation(self):
        with patch.object(runner, 'load_state', return_value=self.state), patch.object(runner, 'save_state') as save:
            self.assertEqual(runner.retry_blocked(), 2)
            save.assert_not_called()

class PlanningBoundaryTests(unittest.TestCase):
    setUp = RecoveryTests.setUp
    def test_lane_block_reaches_planner_despite_pending_lane(self):
        self.cycle(expect_planning=True)
    def test_owner_global_and_unknown_block_stop_planner(self):
        for scope, owner in [('project_global', False), (None, False), ('lane_local', True)]:
            self.receipt['blocker_scope'] = scope
            self.receipt['owner_blocker'] = owner
            self.cycle(expect_planning=False)
    def cycle(self, expect_planning):
        def load(path, default=None):
            if path == autopilot.CONFIG_PATH: return {**CFG, 'project': 'GoBadminton', 'prod_authorized': False}
            if path == autopilot.RUNNER_STATE_PATH: return self.state
            if path == autopilot.BACKLOG_PATH: return {'tasks':[{'id':'safe','status':'queued'}]}
            return {}
        from unittest.mock import MagicMock
        with patch.object(autopilot, 'load_json', side_effect=load), \
             patch.object(autopilot, 'SingleInstanceLock', return_value=MagicMock()), \
             patch.object(autopilot, 'write_json'), patch.object(autopilot, 'log'), \
             patch.object(autopilot.backlog_sync, 'sync_once', return_value={'status':'IN_SYNC'}), \
             patch.object(autopilot.publication_guard, 'reconcile_reservation', return_value=None), \
             patch.object(autopilot, 'recovery_tick', return_value=False), \
             patch.object(autopilot, 'wait_for_wake', side_effect=SystemExit), \
             patch.object(autopilot, 'pending_owner_instructions', return_value=[]) as inbox, \
             patch.object(autopilot, 'any_gobadminton_cursor_active', return_value=(False,'')), \
             patch.object(runner, 'read_receipt', return_value=self.receipt), \
             patch.object(autopilot, 'launch_planner', return_value=(True,'quarantined',{'action':'quarantined'})) as planner:
            with self.assertRaises(SystemExit): autopilot.main()
            self.assertEqual(planner.called, expect_planning)
            inbox.assert_called_once()

class StatusHTTPTests(unittest.TestCase):
    def test_idle_and_running_status_http(self):
        import dashboard
        import threading
        from http.server import ThreadingHTTPServer
        from urllib.request import urlopen
        from contextlib import ExitStack
        state = {'current': None, 'history': [{'id':'fixture','status':'completed','at':'fixed'}]}
        progress = {'task_id':'fixture','status':'done','blocks':[{'id':'B1','status':'done'}]}
        def load(path, default=None):
            return progress if path == runner.PROGRESS_PATH else {}
        with ExitStack() as stack:
            scratch = stack.enter_context(tempfile.TemporaryDirectory(prefix='gb-scope03-http-'))
            for name in ('STATE_PATH','BACKLOG_PATH','PROGRESS_PATH','RUNNER_V2_PROGRESS_DIR','RECEIPTS_DIR'):
                stack.enter_context(patch.object(runner,name,Path(scratch)/name.lower()))
            for obj, name, value in [(runner,'load_config',CFG),(runner,'load_state',state),
                                      (runner,'load_task_progresses',{}),(runner,'writer_busy',(False,'')),
                                      (runner,'load_backlog',{'tasks':[]}),(dashboard,'cached_pr',(None,None)),
                                      (dashboard,'git_status',{}),(dashboard,'load_parallel_lanes',[]),
                                      (dashboard,'load_owner_instruction_summary',{}),(dashboard,'tail_log',[])]:
                stack.enter_context(patch.object(obj,name,return_value=value))
            stack.enter_context(patch.object(runner,'load_json',side_effect=load))
            server = ThreadingHTTPServer(('127.0.0.1',0), dashboard.Handler)
            thread = threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                for current, expected in [(None,False),({'id':'fixture','status':'running'},True),
                                           ({'id':'fixture','status':'blocked'},True),
                                           ({'id':'different','status':'running'},False)]:
                    state['current']=current;dashboard._cache=None
                    with urlopen(f'http://127.0.0.1:{server.server_port}/api/status',timeout=5) as response:
                        data=json.load(response)
                    self.assertEqual(data['progress'] is not None,expected)
                    self.assertEqual(data['recent_activity'][0]['id'],'fixture')
            finally:
                server.shutdown();server.server_close();thread.join();dashboard._cache=None

if __name__ == '__main__': unittest.main(verbosity=2)

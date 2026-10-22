"""Offline reviewer reproductions; no network, model, service or real Git calls."""
import copy
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

SOURCE = Path('/var/lib/gb-actions-review/recovery185-r1/source')
JOB = Path(__file__).resolve().parent
sys.path.insert(0, str(SOURCE / 'scripts/chatops/tests'))
from test_actions_train import A, S, HEAD, active, req, core, client
from test_actions_train_stages import Store
import qa_recovery as Q


def rejected_qa_receipt_is_reused():
    with tempfile.TemporaryDirectory(dir=JOB) as folder:
        directory = Path(folder)
        current = active('qa')
        store = Store(current)
        result = dict(verdict='PASS', findings=[], reviewed_sha=HEAD)
        qa_path = directory / f'qa-issue-{current["issue"]}-a{current["attempt"]}'
        dirty = [False]

        def git(*args, **kwargs):
            if args[0] == 'rev-parse':
                return HEAD
            if args[0] == 'status':
                return ' M apps/web/src/sample.ts' if dirty[0] else ''
            return ''

        def model(*args, **kwargs):
            dirty[0] = True
            return result

        bridge = SimpleNamespace(c=SimpleNamespace(state_dir=directory, worktrees_root=directory),
            work=directory, clean=Mock(), git=git, model=Mock(side_effect=model),
            candidate_identity=Mock(), unchanged_issue=Mock())
        try:
            A.Bridge.review(bridge, current)
        except A.Hold as error:
            assert str(error) == 'QA modified candidate', str(error)
        else:
            raise AssertionError('Original QA must reject modified worktree')
        assert store.data['active']['qa'] is None
        assert json.loads((directory / f'qa-{current["issue"]}-a1.json').read_text()) == result
        recovered = Q.reconcile(A, bridge, Mock(), store,
            req('qa', 'pr_wait') | {'issue': current['issue'], 'head': HEAD, 'attempt': 1})
        assert recovered['status'] == 'confirmed'
        assert store.data['active']['qa']['verdict'] == 'PASS'
        assert bridge.model.call_count == 1  # no new independent review
        print('REPRODUCED: rejected dirty-worktree QA receipt becomes confirmed PASS without a new review')


def recovery_retry_failure_blocks_normal_dispatch():
    descriptor = dict(slot='slot2', issue=300, stage='author', phase='claimed',
        head=HEAD, attempt=0, generation=0, profile='codex')
    api = Mock()
    api.pages.return_value = []
    ssh = Mock(return_value={'mode': 'active', 'slots': {}})
    import recovery
    import recovery_admission
    import queue_diagnostics
    with patch.object(client, 'trusted_event'), patch.object(client, 'live', return_value=(A, S)), \
         patch.object(S, 'admitted', return_value=[]), \
         patch.object(recovery_admission, 'candidates', return_value=[]), \
         patch.object(client, 'plan', return_value=[descriptor]), \
         patch.object(recovery, 'descriptors', return_value=[]), \
         patch.object(queue_diagnostics, 'explain', return_value={}), \
         patch.object(recovery_admission, 'retry_publications', side_effect=core.Refused('GitHub response 404')):
        try:
            client.reconcile(api, ssh, {}, 'workflow_dispatch')
        except core.Refused as error:
            assert str(error) == 'GitHub response 404'
        else:
            raise AssertionError('Expected publisher exception to escape')
    assert not any(call.args and call.args[0] == 'actions/workflows/train-stage.yml/dispatches'
                   for call in api.call_args_list)
    print('REPRODUCED: publisher-only API failure aborts reconciliation before ready normal task dispatch')


if __name__ == '__main__':
    rejected_qa_receipt_is_reused()
    recovery_retry_failure_blocks_normal_dispatch()

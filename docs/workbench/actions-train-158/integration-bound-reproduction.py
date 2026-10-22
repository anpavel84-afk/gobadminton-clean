import sys, json, copy
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode = True
source = Path('/var/lib/gb-actions-review/candidate')
sys.path.insert(0, str(source/'scripts/chatops/tests'))
import test_actions_train as t
import test_actions_train_stages as ts
t.ROOT = ts.ROOT = Path('/var/lib/gb-actions-review/job')
f = ts.StageBoundaries()
f.setUp()
try:
    a = f.store.data['active']
    a.update(phase='ci', integration=3, ci={'sha':t.HEAD})
    f.exact_qa()
    f.bridge.remote = 'e'*40
    f.bridge.clean = lambda head: None
    f.bridge.integrate = lambda active, dev: t.A.Bridge.integrate(f.bridge, active, dev)
    before = copy.deepcopy(f.store.data)
    with patch.object(t.A, 'continuity', return_value={'max_integrations':3}), patch.object(t.stage, 'setup', return_value=f.context), patch.object(t.stage, 'run_result', return_value={'sha':t.HEAD}):
        result = t.stage.entry(t.req('integrate','ci'), {})
    assert result['status'] == 'unknown', result
    assert f.store.data == before
    print('integration limit:', json.dumps(result), 'checkpoint_unchanged=', f.store.data == before)
finally:
    f.tearDown()

j = t.Journal()
j.setUp()
try:
    j.state['active'] = t.active('ci')
    t.receiver.handle(t.req('integrate','ci'), j.policy)
    reservation = json.loads((j.folder/'integration.json').read_text())
    # Finalization for UNKNOWN leaves pending/reservation (receiver.py:325,331).
    j.state['active'] = t.active('ci', 201)
    def checkpoint(slot):
        active = t.active('ci') if slot == 'slot1' else t.active('ci', 201)
        if slot == 'slot2':
            active['task'] = active['task'] | {'allowed_paths':['apps/api/src/independent.ts'], 'locks':['api:independent']}
        return {'active':active,'done':[]}, []
    with patch.object(t.receiver,'checkpoint',side_effect=checkpoint):
        second = t.receiver.handle(t.req('integrate','ci')|{'slot':'slot2','issue':201}, j.policy)
    assert second['status'] == 'waiting', second
    print('disjoint slot:', json.dumps(second), 'reservation=', reservation)
finally:
    j.tearDown()

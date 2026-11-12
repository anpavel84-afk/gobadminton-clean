import json, os, tempfile, datetime
SHA = lambda c: c * 40
GOAL = 'GOBADMINTON_AUTONOMY_V1\nTASK T0a-1: Контакты площадок и закрытое чтение игры\nallowed_paths: apps/api'
CI = {'id': 123, 'url': 'https://x', 'jobs': [{'name': 'a', 'conclusion': 'success'}, {'name': 'b', 'status': 'in_progress'}] }

def active(phase, **kw):
    a = {'issue': 82, 'phase': phase, 'attempt': 2, 'base': SHA('a'), 'head': SHA('b'), 'pr': 83,
         'task': {'goal': GOAL, 'allowed_paths': ['apps/api']}, 'qa': {'verdict': None}, 'ci': CI,
         'history': [{'x': 'secret-token-123'}]}
    a.update(kw); return a

def make_state(phase=None, done=(1, 2, 3), parked=None, **kw):
    d = tempfile.mkdtemp(); os.chmod(d, 0o700)
    st = {'active': active(phase, **kw) if phase else None, 'done': list(done)}
    json.dump(st, open(os.path.join(d, 'state.json'), 'w'))
    if parked is not None:
        json.dump(parked, open(os.path.join(d, 'parked.json'), 'w'))
    return d

def receipt(pending=False, status='ACCEPTED'):
    p = os.path.join(tempfile.mkdtemp(), 'dev.json')
    json.dump({'pending': pending, 'accepted': {'release_id': 'r12-a3', 'source_sha': SHA('c'), 'status': status, 'finished_at': 1760000000}}, open(p, 'w'))
    return p

PHASES = ('claimed', 'developing', 'candidate', 'pr_wait', 'qa', 'ci', 'promoting', 'dev_wait', 'done', 'blocked')

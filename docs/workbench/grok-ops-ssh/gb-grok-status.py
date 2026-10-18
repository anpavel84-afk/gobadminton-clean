#!/usr/bin/python3 -I
"""Read-only, field-whitelisted GoBadminton OPS status; no mutations."""
import datetime
import json
import os
from pathlib import Path
import re
import stat
import subprocess

UID = 1002
STATE_DIR = Path('/home/agentagency-dev/.gb-autonomy-state')
RECEIPT = Path('/var/lib/gobadminton-deploy-evidence/dev.json')

def read_json(path, limit, owner):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_uid != owner or not 2 <= s.st_size <= limit:
            raise ValueError('invalid file metadata')
        return json.loads(os.read(fd, limit + 1))
    finally:
        os.close(fd)

def sha(v):
    return v if isinstance(v, str) and re.fullmatch(r'[a-f0-9]{40}', v) else None

def reason(v):
    if not isinstance(v, str) or len(v) > 150:
        return None if v is None else 'WITHHELD'
    if not re.fullmatch(r'[A-Za-z0-9 .,:;()_+/-]+', v):
        return 'WITHHELD'
    if re.search(r'(?i)password|secret|token|private|credential|cookie|bearer|api.key', v):
        return 'WITHHELD'
    return v

def main():
    if os.geteuid() != UID:
        raise SystemExit('wrong runtime identity')
    d = STATE_DIR.lstat()
    if not stat.S_ISDIR(d.st_mode) or d.st_uid != UID or d.st_mode & 0o077:
        raise SystemExit('private directory integrity mismatch')
    state = read_json(STATE_DIR / 'state.json', 1_048_576, UID)
    if not isinstance(state, dict) or not isinstance(state.get('done'), list):
        raise SystemExit('checkpoint shape rejected')
    a = state.get('active') or {}
    if not isinstance(a, dict):
        raise SystemExit('active shape rejected')
    q = a.get('qa') or {}
    if not isinstance(q, dict):
        q = {}
    allowed_phases = ('claimed','developing','candidate','pr_wait','qa','ci','promoting','dev_wait','blocked','done')
    data = {
        'checked_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'host': 'vmi3510488',
        'worker': {'state': 'UNKNOWN'},
        'claim': {
            'issue': a.get('issue') if type(a.get('issue')) is int else None,
            'phase': a.get('phase') if a.get('phase') in allowed_phases else 'UNKNOWN',
            'attempt': a.get('attempt') if type(a.get('attempt')) is int else None,
            'base_sha': sha(a.get('base')), 'head_sha': sha(a.get('head')),
            'pr': a.get('pr') if type(a.get('pr')) is int else None,
            'resume_phase': a.get('resume_phase') if a.get('resume_phase') in allowed_phases else None,
            'reason': reason(a.get('reason')),
            'qa': {'verdict': q.get('verdict') if q.get('verdict') in ('PASS','FAIL','BLOCKED') else None,
                   'reviewed_sha': sha(q.get('reviewed_sha'))},
            'done_count': len(state.get('done',[])),
        },
        'dev_receipt': {'status': 'UNAVAILABLE'},
    }
    try:
        env = {'PATH':'/usr/bin:/bin','XDG_RUNTIME_DIR':'/run/user/1002',
               'DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/1002/bus'}
        r = subprocess.run(['/usr/bin/systemctl','--user','show','gobadminton-autonomy.service',
                            '-p','ActiveState','-p','SubState','-p','MainPID',
                            '-p','Result','-p','KillMode'],
                           text=True, capture_output=True, timeout=8, env=env, cwd='/')
        if r.returncode == 0:
            kv = dict(line.split('=',1) for line in r.stdout.splitlines() if '=' in line)
            data['worker'] = {'state':kv.get('ActiveState'),'substate':kv.get('SubState'),
                              'main_pid':int(kv.get('MainPID','0')),
                              'result':kv.get('Result'),'kill_mode':kv.get('KillMode')}
    except (ValueError, OSError, subprocess.TimeoutExpired):
        pass
    try:
        receipt = read_json(RECEIPT, 16384, 0)
        accepted = receipt.get('accepted') or {}
        if isinstance(accepted, dict):
            release = accepted.get('release_id')
            data['dev_receipt'] = {
                'status': 'READABLE',
                'pending': receipt.get('pending') if type(receipt.get('pending')) is bool else None,
                'release_id': release if isinstance(release,str) and re.fullmatch(r'r[0-9]+-a[0-9]+', release) else None,
                'source_sha': sha(accepted.get('source_sha')),
                'accepted_status': accepted.get('status') if accepted.get('status') in ('ACCEPTED','ROLLED_BACK','FAILED') else None,
                'finished_at': accepted.get('finished_at') if type(accepted.get('finished_at')) is int else None,
            }
    except (ValueError, OSError, json.JSONDecodeError):
        pass
    print(json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',',':')))

if __name__ == '__main__':
    main()

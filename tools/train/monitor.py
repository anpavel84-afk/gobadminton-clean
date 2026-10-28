#!/usr/bin/env python3
"""Minimal Lean Mode B status projection helper for the existing OPS monitor.

Does not create a new monitor service. Projects actual live worker/PID birth/
stage/Issue/role/SHA/PR/QA/CI/DEV/last event through existing files. Dead worker
is never RUNNING. Does not overwrite unrelated PMA data.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path

RESULTS = Path('/var/lib/gobadminton-lean/results')
STATE = Path('/var/lib/gobadminton-lean/state')
CONFIG = Path('/etc/gobadminton-lean/config.json')
DEFAULT_PROJECTION = Path('/var/lib/gb-ops-monitor/lean-mode-b.json')
WORKER_STATE = STATE / 'worker.json'


def _loads(raw):
    if isinstance(raw, bytes):
        raw = raw.decode()
    return json.loads(raw)


def _atomic_write(path, data, mode=0o644):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = data if isinstance(data, (bytes, str)) else json.dumps(data, sort_keys=True, indent=2) + '\n'
    if isinstance(raw, str):
        raw = raw.encode()
    fd, tmp = tempfile.mkstemp(prefix='.lean-mon-', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'wb') as fh:
            fh.write(raw)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def pid_alive(pid):
    if not isinstance(pid, int) or pid <= 1:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def read_worker(path=WORKER_STATE):
    path = Path(path)
    if not path.is_file() or path.is_symlink():
        return {'alive': False}
    try:
        data = _loads(path.read_bytes())
    except (OSError, ValueError):
        return {'alive': False}
    if not isinstance(data, dict):
        return {'alive': False}
    pid = data.get('pid')
    alive = pid_alive(pid) if pid else False
    return {
        'pid': pid if alive else None,
        'birth': data.get('birth') if alive else None,
        'stage': data.get('stage') if alive else None,
        'issue': data.get('issue') if alive else None,
        'alive': alive,
    }


def latest_claim(results_root=RESULTS):
    root = Path(results_root)
    if not root.is_dir():
        return None
    newest = None
    newest_mtime = -1
    for path in root.glob('issue-*/**/claim.json'):
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue
        if mtime > newest_mtime:
            newest_mtime = mtime
            newest = path
    if newest is None:
        return None
    try:
        return _loads(newest.read_bytes())
    except (OSError, ValueError):
        return None


def read_config(path=CONFIG):
    path = Path(path)
    if not path.is_file():
        return {'enabled': False, 'commissioning': True, 'mode_b_active': False}
    try:
        return _loads(path.read_bytes())
    except (OSError, ValueError):
        return {'enabled': False, 'commissioning': True, 'mode_b_active': False}


def build_projection(*, claim=None, worker=None, config=None, last_event=None,
                     release_sha=None):
    cfg = config or {}
    worker = worker or {}
    live = bool(worker.get('alive'))
    phase = None if not claim else claim.get('phase')
    if phase in ('RUNNING', 'UNKNOWN') and not live:
        phase = 'WORKER_DEAD_' + str(phase)
    return {
        'schema': 'GB_LEAN_MODE_B_PROJECTION_V1',
        'mode': 'lean_mode_b',
        'train_mode': 'lean_mode_b',
        'channel': 'lean_evidence',
        'pma_work': False,
        'enabled': bool(cfg.get('enabled')),
        'commissioning': bool(cfg.get('commissioning', True)),
        'mode_b_active': bool(cfg.get('mode_b_active')),
        'release_sha': release_sha,
        'worker': {
            'pid': worker.get('pid') if live else None,
            'birth': worker.get('birth') if live else None,
            'alive': live,
            'stage': worker.get('stage') if live else (None if not claim else claim.get('stage')),
        },
        'issue': None if not claim else claim.get('issue'),
        'role': None if not claim else (claim.get('routes') or {}).get('author'),
        'revision': None if not claim else claim.get('revision'),
        'phase': phase,
        'pr': None if not claim else claim.get('pr'),
        'candidate_sha': None if not claim else claim.get('candidate_sha'),
        'qa': None if not claim else claim.get('last_qa'),
        'ci': None if not claim else claim.get('ci'),
        'dev': None if not claim else claim.get('dev'),
        'last_event': last_event,
        'observed_at': int(time.time()),
    }


def write_projection(path, *, release_sha=None, claim=None, config=None, worker=None,
                     last_event=None):
    path = Path(path)
    # Never overwrite unrelated PMA filenames — only lean-mode-b.json (or explicit path).
    if path.name not in ('lean-mode-b.json', 'lean_evidence.json') and 'lean' not in path.name:
        return {'status': 'refused', 'reason': 'refusing non-lean projection path'}
    projection = build_projection(
        claim=claim, worker=worker, config=config, last_event=last_event,
        release_sha=release_sha)
    _atomic_write(path, projection, 0o644)
    return {'status': 'written', 'path': str(path), 'phase': projection.get('phase')}


def refresh(projection_path=DEFAULT_PROJECTION, results_root=RESULTS):
    """Read live state and project. Safe no-op if monitor dir absent."""
    path = Path(projection_path)
    if not path.parent.is_dir():
        return {'status': 'skipped', 'reason': f'monitor dir absent: {path.parent}'}
    return write_projection(
        path,
        claim=latest_claim(results_root),
        config=read_config(),
        worker=read_worker(),
        last_event='monitor_refresh',
    )


def main(argv=None):
    import sys
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == 'refresh':
        print(json.dumps(refresh(), sort_keys=True))
        return 0
    print(json.dumps(build_projection(
        claim=latest_claim(), worker=read_worker(), config=read_config(),
        last_event='monitor_print'), sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

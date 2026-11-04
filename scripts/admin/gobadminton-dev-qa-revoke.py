#!/usr/bin/python3 -I
"""Owner #480. Root-only, fixed DEV target. Never reads or emits plaintext key."""
import fcntl
import json
import os
from pathlib import Path
import pwd
import socket
import stat
import subprocess
import sys

def main():
    if os.geteuid() != 0:
        raise PermissionError('ROOT_REQUIRED')
    if socket.gethostname() != 'vmi3510488':
        raise RuntimeError('DEV_VPS_REQUIRED')
    if len(sys.argv) != 1:
        raise RuntimeError('NO_ARGUMENTS_ALLOWED')
    process_env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8'}
    with open('/var/lib/gobadminton-deploy/dev/lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        root = Path('/var/lib/gobadminton-deploy/dev')
        accepted = json.loads((root / 'accepted.json').read_text())
        if accepted['status'] != 'ACCEPTED' or (root / 'pending.json').exists():
            raise RuntimeError('ACCEPTED_DEV_REQUIRED')
        data = json.loads(subprocess.check_output(['/usr/bin/docker', 'inspect', 'gobadminton-dev-preview-api'], stderr=subprocess.PIPE, env=process_env))[0]
        env = dict(value.split('=', 1) for value in data['Config']['Env'])
        if (not data['State']['Running'] or env.get('GIT_SHA') != accepted['source_sha']
                or env.get('PUBLIC_WEB_ORIGIN') != 'https://dev.gobadminton.ru'
                or env.get('PUBLIC_API_ORIGIN') != 'https://dev.gobadminton.ru'
                or env.get('APP_ENV') not in ('mvp', 'stage')):
            raise RuntimeError('DEV_TARGET_MISMATCH')
        result = json.loads(subprocess.check_output(['/usr/bin/docker', 'exec', 'gobadminton-dev-preview-api',
            'node', 'dist/admin/dev-qa-ops.js', 'revoke'], stderr=subprocess.PIPE, timeout=30, env=process_env))
        if result.get('remaining') != {'credentials': 0, 'sessions': 0}:
            raise RuntimeError('REVOCATION_READBACK_FAILED')
        # Anchor unlink to an actual directory fd; never follow a grokops-controlled symlink.
        uid = pwd.getpwnam('grokops').pw_uid
        home = os.open('/home/grokops', os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            try:
                directory = os.open('.qa', os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=home)
            except FileNotFoundError:
                directory = None
            if directory is not None:
                try:
                    meta = os.fstat(directory)
                    if meta.st_uid != uid or stat.S_IMODE(meta.st_mode) != 0o700:
                        raise RuntimeError('QA_DIRECTORY_PERMISSIONS')
                    try:
                        key = os.stat('admin-dev.key', dir_fd=directory, follow_symlinks=False)
                    except FileNotFoundError:
                        key = None
                    if key is not None:
                        if not stat.S_ISREG(key.st_mode) or key.st_uid != uid or stat.S_IMODE(key.st_mode) != 0o600:
                            raise RuntimeError('QA_KEY_PERMISSIONS')
                        os.unlink('admin-dev.key', dir_fd=directory)
                        os.fsync(directory)
                finally:
                    os.close(directory)
        finally:
            os.close(home)
        print(json.dumps({'status': 'REVOKED', **result, 'key_file': 'ABSENT'}))

if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Never echo exceptions containing container env, request data, hashes, or cookies.
        print('DEV_QA_REVOCATION_FAILED; inspect protected DEV audit', file=sys.stderr)
        sys.exit(1)

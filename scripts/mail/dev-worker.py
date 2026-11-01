#!/usr/bin/python3
"""Run the existing worker from the exact accepted DEV API image. Root OPS only."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

RUNTIME = Path('/srv/gobadminton/mail-runtime')
API = 'gobadminton-dev-preview-api'
NAME = 'gobadminton-dev-mail-worker'

def main():
    if os.geteuid() != 0:
        raise ValueError('root required')
    accepted = json.loads(Path('/var/lib/gobadminton-deploy/dev/accepted.json').read_text())
    sha = accepted['source_sha']
    digest = accepted['api_digest']
    if accepted['status'] != 'ACCEPTED' or not re.fullmatch(r'[a-f0-9]{40}', sha) or not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
        raise ValueError('accepted DEV release required')
    image_ref = 'ghcr.io/anpavel84-afk/gobadminton-clean-api@' + digest
    api = json.loads(subprocess.check_output(['/usr/bin/docker', 'inspect', API]))[0]
    env = dict(item.split('=', 1) for item in api['Config']['Env'])
    if env.get('GIT_SHA') != sha or api['Config']['Image'] != image_ref or env.get('APP_ENV') not in ('mvp', 'stage') or env.get('PUBLIC_API_ORIGIN') != 'https://dev.gobadminton.ru' or env.get('PUBLIC_WEB_ORIGIN') != 'https://dev.gobadminton.ru' or env.get('EMAIL_AUTH_TRANSPORT') != 'smtp':
        raise ValueError('DEV API image/config mismatch')
    networks = api['NetworkSettings']['Networks']
    network = 'gobadminton_dev_preview_internal'
    if network not in networks:
        raise ValueError('existing DEV database network required')
    env['SERVICE_NAME'] = 'gobadminton-worker'
    env['MAIL_AUTH_FILE'] = '/run/gobadminton-mail/info-mail.auth'
    # Password never enters environment or Docker command arguments.
    if any('\n' in k + v or '\r' in k + v for k, v in env.items()):
        raise ValueError('invalid environment')
    private_env = RUNTIME / 'dev-worker.env'
    fd = os.open(private_env, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(''.join(k + '=' + v + '\n' for k, v in env.items()))
    args = ['/usr/bin/docker', 'run', '--rm', '--name', NAME,
            '--label', 'gobadminton.role=dev-mail-worker', '--user', '0:0',
            '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
            '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=16m', '--network', network,
            '--env-file', str(private_env), '--mount',
            'type=bind,src=/srv/gobadminton/mail-runtime/info-mail.auth,dst=/run/gobadminton-mail/info-mail.auth,readonly',
            image_ref, 'node', 'dist/worker-main.js']
    os.execv(args[0], args)

if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Do not print Docker inspect/environment/exception bodies.
        print('DEV_MAIL_WORKER_START_FAILED', file=sys.stderr)
        sys.exit(1)

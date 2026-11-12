#!/usr/bin/env python3
"""Creates the config with a salted scrypt PIN hash. PIN is read from the terminal (hidden)
or stdin; it is never written anywhere. Usage: make_config.py OUT.json [--snapshot PATH] [--port N]"""
import argparse, base64, getpass, json, os, secrets, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from opsmon.server import hash_pin

p = argparse.ArgumentParser()
p.add_argument('out'); p.add_argument('--snapshot', default='/var/lib/gb-ops-monitor/snapshot.json')
p.add_argument('--port', type=int, default=18090); p.add_argument('--insecure-cookie', action='store_true')
a = p.parse_args()
pin = sys.stdin.readline().strip() if not sys.stdin.isatty() else getpass.getpass('PIN: ')
if not (pin.isascii() and pin.isdigit() and 4 <= len(pin) <= 12):
    raise SystemExit('PIN must be 4-12 digits')
salt = secrets.token_bytes(16)
cfg = {'pin_salt': base64.b64encode(salt).decode(), 'pin_hash': base64.b64encode(hash_pin(pin, salt)).decode(),
       'scrypt_n': 2 ** 14, 'cookie_secret': base64.b64encode(secrets.token_bytes(32)).decode(),
       'session_seconds': 43200, 'cookie_secure': not a.insecure_cookie, 'prefix': '/ops-monitor',
       'bind': '127.0.0.1', 'port': a.port, 'snapshot_path': a.snapshot}
fd = os.open(a.out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o640)
with os.fdopen(fd, 'w') as f:
    json.dump(cfg, f, indent=1)
print('config written (PIN not stored):', a.out)

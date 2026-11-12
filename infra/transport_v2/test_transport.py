"""Author-side unit + real local nginx/mTLS tests. NOT XHTTP or original-host QA.
TCP relays model separate lanes only; no cross-border or DPI result is inferred.
Run: python3 -m unittest discover -s infra/transport_v2 -v
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.client
import json
import os
from pathlib import Path
import select
import shutil
import socket
import socketserver
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
import uuid

import transport as t


def free_port() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def vhost() -> bytes:
    return ('# unrelated { } comment\nserver { listen 80; server_name gobadminton.ru; return 301 https://$host$request_uri; }\n'
            'server { listen 443 ssl; server_name gobadminton.ru;\n'
            'location / { proxy_pass http://127.0.0.1:18082; }\n'
            'location /_gb-link/v1 { proxy_pass http://127.0.0.1:18441; }\n'
            + t.edge_locations('/etc/gb/ca.crt', '/etc/gb/client.crt', '/etc/gb/client.key', legacy=True)
            + '}\n').encode()


class SourceTests(unittest.TestCase):
    def test_01_pairs(self):
        for lane in t.LANES:
            a, b = t.xray_pair(lane, str(uuid.uuid4()))
            self.assertTrue(all(i['listen'] == '127.0.0.1' for i in a['inbounds']))
            self.assertEqual(b['inbounds'], [])
            self.assertEqual(b['outbounds'][1]['settings']['redirect'], '127.0.0.1:18543')
            self.assertEqual(a['outbounds'][0]['protocol'], 'blackhole')
            self.assertEqual(b['outbounds'][0]['protocol'], 'blackhole')
            remote = b['outbounds'][2]
            self.assertEqual(remote['settings']['address'], t.MOSCOW)
            self.assertEqual(remote['settings']['port'], 443)
            self.assertFalse(remote['streamSettings']['tlsSettings']['allowInsecure'])
            xmux = remote['streamSettings']['xhttpSettings']['extra']['xmux']
            self.assertEqual((xmux['maxConcurrency'], xmux['maxConnections']), (1, 0))
            self.assertNotIn('mux', remote)

    def test_02_distinct_lanes(self):
        self.assertEqual(len({l.path for l in t.LANES}), 3)
        self.assertEqual(len({p for l in t.LANES for p in (l.registration, l.ingress)}), 6)
        self.assertNotIn(18442, [l.ingress for l in t.LANES])

    def test_03_patch_scope(self):
        old = vhost(); new = t.patch_vhost(old, t.digest(old)).decode()
        self.assertIn('proxy_pass https://gb_v2_media;', new)
        self.assertIn('proxy_pass https://gb_v2_rpc;', new)
        self.assertEqual(new.count('proxy_connect_timeout 6s;'), 2)
        self.assertIn('location / { proxy_pass http://127.0.0.1:18082; }', new)
        self.assertIn('location /_gb-link/v1 { proxy_pass http://127.0.0.1:18441; }', new)
        self.assertIn('return 301 https://$host$request_uri;', new)
        self.assertEqual(new.count('proxy_next_upstream off;'), 5)
        self.assertEqual(new.count('proxy_ssl_verify on;'), 2)

    def test_04_snapshot_cas(self):
        with self.assertRaises(ValueError): t.patch_vhost(vhost(), '0' * 64)

    def test_05_drift_is_rejected(self):
        for before, after in [(b'127.0.0.1:18442', b'127.0.0.1:19000'),
                              (b'proxy_connect_timeout 3s', b'proxy_connect_timeout 9s'),
                              (b'proxy_ssl_verify on', b'proxy_ssl_verify off'),
                              (b'proxy_next_upstream off', b'proxy_next_upstream error'),
                              (b'Connection ""', b'Connection close')]:
            data = vhost().replace(before, after)
            with self.subTest(after=after), self.assertRaises(ValueError):
                t.patch_vhost(data, t.digest(data))

    def test_06_no_global_nginx_config(self):
        data = b'events {} http {' + vhost() + b'}'
        with self.assertRaises(ValueError): t.patch_vhost(data, t.digest(data))

    def test_07_reapply_rejected(self):
        old = vhost(); new = t.patch_vhost(old, t.digest(old))
        with self.assertRaises(ValueError): t.patch_vhost(new, t.digest(new))

    def test_08_parser_comments_and_quotes(self):
        bs = t.parse_blocks('server { # }\n location / { add_header Test "{hello}"; } }')
        self.assertEqual(len(bs), 2)
        self.assertIs(bs[1].parent, bs[0])
        with self.assertRaises(ValueError): t.parse_blocks('server {')

    def test_09_no_direct_fallback_or_personal_vpn(self):
        data = t.upstreams() + t.carriers()
        self.assertNotIn('45.158.46.119', data)
        self.assertNotIn('proxy_pass https://dev-api', data)
        self.assertIn('allow 169.58.183.182;', data)
        self.assertEqual(data.count('deny all;'), 3)

    def test_10_nginx_path_injection_rejected(self):
        for value in ['/tmp/a;include /etc/passwd', '/tmp/a\nfoo', '/tmp/$x', '/tmp/../etc', 'relative']:
            with self.assertRaises(ValueError): t.safe_path(value)

    def test_11_private_input_output(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'secret'; p.write_bytes(b'private'); p.chmod(0o600)
            self.assertEqual(t.private_read(p), b'private')
            p.chmod(0o644)
            with self.assertRaises(ValueError): t.private_read(p)
            link = Path(d) / 'link'; link.symlink_to(p)
            with self.assertRaises(OSError): t.private_read(link)
            out = Path(d) / 'candidate'; t.write_bundle(out, {'a/file': b'secret'})
            self.assertEqual((out / 'a/file').stat().st_mode & 0o777, 0o600)
            self.assertEqual(out.stat().st_mode & 0o777, 0o700)
            with self.assertRaises(ValueError): t.write_bundle(out, {})

    def test_12_duplicate_location_rejected(self):
        data = vhost().replace(b'location / {', b'location /v1/ {')
        with self.assertRaises(ValueError): t.patch_vhost(data, t.digest(data))

    def test_13_gate_security(self):
        gate = t.gate_config('/run/gb', '/etc/gb/ca', '/etc/gb/crt', '/etc/gb/key')
        for text in ['listen 127.0.0.1:18543 ssl', 'ssl_verify_client on',
                     'location ~ ^/v1/admin(?:/|$)', 'worker_connections 1024',
                     'server 127.0.0.1:18080 max_conns=96']:
            self.assertIn(text, gate)
        self.assertNotIn('18443', gate)
        self.assertNotIn('proxy_next_upstream non_idempotent', gate)

    def test_14_keepalive_and_capacity(self):
        u = t.upstreams()
        self.assertIn('zone gb_v2_rpc 64k', u)
        self.assertIn('keepalive 16', u)
        self.assertEqual(u.count('max_conns=32'), 2)
        self.assertIn('max_conns=4', u)


class Relay(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    def __init__(self, gate):
        self.gate = gate; self.enabled = True; self.accepted = 0
        self.clients = set(); self.lock = threading.Lock()
        super().__init__(('127.0.0.1', 0), RelayHandler)
    def disconnect(self):
        self.enabled = False
        with self.lock:
            for s in list(self.clients):
                try: s.shutdown(socket.SHUT_RDWR)
                except OSError: pass

class RelayHandler(socketserver.BaseRequestHandler):
    def handle(self):
        r = self.server
        with r.lock: r.accepted += 1; r.clients.add(self.request)
        try:
            if not r.enabled: return
            with socket.create_connection(('127.0.0.1', r.gate), timeout=2) as other:
                self.request.settimeout(2); other.settimeout(2)
                while r.enabled:
                    ready, _, _ = select.select([self.request, other], [], [], 0.2)
                    for src in ready:
                        data = src.recv(65536)
                        if not data: return
                        (other if src is self.request else self.request).sendall(data)
        except OSError:
            pass
        finally:
            with r.lock: r.clients.discard(self.request)


class Backend(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    lock = threading.Lock()
    writes = 0
    upload_started = threading.Event()
    release_upload = threading.Event()
    def log_message(self, *args): pass
    def send(self, body, status=200):
        self.send_response(status); self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path.startswith('/v1/download/'):
            self.send(b'x' * int(self.path.rsplit('/', 1)[1])); return
        self.send(json.dumps({'ok': True, 'headers': dict(self.headers)}).encode())
    def do_PUT(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        with self.lock: type(self).writes += 1
        if self.path == '/v1/drop-after-write':
            self.close_connection = True; return
        if self.headers.get('X-Test-Slow') == 'yes':
            self.upload_started.set()
            self.release_upload.wait(7)
        self.send(json.dumps({'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}).encode())


@unittest.skipUnless(shutil.which('nginx') and shutil.which('openssl'), 'nginx and openssl required')
class LocalNginxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='gb-local-proof-')
        cls.root = Path(cls.tmp.name); cls.procs = []; cls.relays = []
        cls.backend = ThreadingHTTPServer(('127.0.0.1', 0), Backend)
        cls.backend.daemon_threads = True
        threading.Thread(target=cls.backend.serve_forever, daemon=True).start()
        def command(args):
            subprocess.run(args, cwd=cls.root, check=True, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=15)
        try:
            command(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                     '-subj', '/CN=GoBadminton LOCAL TEST CA',
                     '-addext', 'basicConstraints=critical,CA:TRUE',
                     '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
                     '-keyout', 'ca.key', '-out', 'ca.crt'])
            for name, cn, usage in [('server', t.GATE_NAME, 'serverAuth'), ('client', 'local-test-client', 'clientAuth')]:
                command(['openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=' + cn,
                         '-keyout', name + '.key', '-out', name + '.csr'])
                (cls.root / (name + '.ext')).write_text(
                    'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n'
                    'subjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\nextendedKeyUsage=' + usage + '\n' +
                    ('subjectAltName=DNS:' + t.GATE_NAME + ',IP:127.0.0.1\n' if name == 'server' else ''))
                command(['openssl', 'x509', '-req', '-in', name + '.csr', '-CA', 'ca.crt', '-CAkey',
                         'ca.key', '-CAcreateserial', '-days', '1', '-extfile', name + '.ext', '-out', name + '.crt'])
            cls.gate = free_port(); cls.edge = free_port()
            cls.start_nginx('gate', t.gate_config(str(cls.root), str(cls.root/'ca.crt'),
                            str(cls.root/'server.crt'), str(cls.root/'server.key'),
                            cls.gate, cls.backend.server_port), cls.gate)
            lanes = []
            for lane in t.LANES:
                r = Relay(cls.gate); cls.relays.append(r)
                threading.Thread(target=r.serve_forever, daemon=True).start()
                lanes.append(t.Lane(lane.name, lane.registration, r.server_address[1], lane.max_connections))
            edge = f'''pid {cls.root}/edge.pid;
error_log {cls.root}/edge.error.log warn;
events {{ worker_connections 1024; }}
http {{ access_log off; client_body_temp_path {cls.root}/edge-body;
proxy_temp_path {cls.root}/edge-proxy;
{t.upstreams(tuple(lanes))}
server {{ listen 127.0.0.1:{cls.edge};
{t.edge_locations(str(cls.root/'ca.crt'), str(cls.root/'client.crt'), str(cls.root/'client.key'))}
location / {{ return 404; }}
}} }}'''
            cls.start_nginx('edge', edge, cls.edge)
        except Exception:
            cls.tearDownClass(); raise

    @classmethod
    def start_nginx(cls, name, text, port):
        conf = cls.root / (name + '.conf'); conf.write_text(text)
        tested = subprocess.run(['nginx', '-t', '-p', str(cls.root), '-c', str(conf)],
                                capture_output=True, text=True, timeout=5)
        if tested.returncode: raise RuntimeError(tested.stderr)
        p = subprocess.Popen(['nginx', '-p', str(cls.root), '-c', str(conf),
                              '-g', 'daemon off; master_process off;'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.procs.append(p)
        for _ in range(50):
            if p.poll() is not None: raise RuntimeError('local nginx exited')
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=.1): return
            except OSError: time.sleep(.05)
        raise RuntimeError('local nginx readiness timeout')

    @classmethod
    def tearDownClass(cls):
        Backend.release_upload.set()
        for p in getattr(cls, 'procs', []):
            p.terminate()
            try: p.wait(5)
            except subprocess.TimeoutExpired: p.kill(); p.wait()
        for r in getattr(cls, 'relays', []):
            r.disconnect(); r.shutdown(); r.server_close()
        if hasattr(cls, 'backend'): cls.backend.shutdown(); cls.backend.server_close()
        if hasattr(cls, 'tmp'): cls.tmp.cleanup()

    def request(self, method='GET', path='/v1/health', body=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', self.edge, timeout=10)
        try:
            c.request(method, path, body=body, headers=headers or {})
            r = c.getresponse(); return r.status, r.read()
        finally: c.close()

    def test_15_upload_size_matrix(self):
        for size in (4, 8, 16, 24, 32, 64, 384, 512):
            body = bytes(range(256)) * (size * 4)
            status, response = self.request('PUT', '/v1/me/avatar', body)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(response), {'bytes': len(body), 'sha256': t.digest(body)})

    def test_16_download_size_matrix(self):
        for size in (4, 8, 16, 24, 32, 64, 384, 512):
            status, body = self.request(path=f'/v1/download/{size * 1024}')
            self.assertEqual(status, 200)
            self.assertEqual(t.digest(body), t.digest(b'x' * (size * 1024)))

    def test_17_100_uploads(self):
        for i in range(100):
            body = b'z' * ((384 if i % 2 else 512) * 1024)
            status, response = self.request('PUT', '/v1/me/avatar', body)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(response)['sha256'], t.digest(body))

    def test_18_persistent_mtls(self):
        for _ in range(4): self.assertEqual(self.request()[0], 200)
        before = sum(r.accepted for r in self.relays[:2])
        for _ in range(24): self.assertEqual(self.request()[0], 200)
        # The actual nginx-to-Gate TLS connections pass through these TCP relays.
        self.assertLessEqual(sum(r.accepted for r in self.relays[:2]) - before, 2)

    def test_19_slow_upload_does_not_block_rpc(self):
        Backend.release_upload.clear(); Backend.upload_started.clear()
        with ThreadPoolExecutor(max_workers=2) as ex:
            job = ex.submit(self.request, 'PUT', '/v1/me/avatar', b'x' * 524288, {'X-Test-Slow': 'yes'})
            try:
                self.assertTrue(Backend.upload_started.wait(3))
                started = time.monotonic()
                for _ in range(20): self.assertEqual(self.request(path='/v1/me')[0], 200)
                self.assertLess(time.monotonic() - started, 3)
                self.assertFalse(job.done())
            finally: Backend.release_upload.set()
            self.assertEqual(job.result()[0], 200)

    def test_20_no_mutation_replay(self):
        before = Backend.writes
        status, _ = self.request('PUT', '/v1/drop-after-write', b'one mutation')
        self.assertEqual(status, 503)
        self.assertEqual(Backend.writes - before, 1)

    def test_21_headers_preserved(self):
        headers = {'Cookie': 'synthetic=test-only', 'Authorization': 'Bearer fixture-only',
                   'Origin': 'https://gobadminton.ru', 'X-CSRF-Token': 'synthetic-csrf'}
        status, body = self.request(path='/v1/me', headers={**headers, 'X-Forwarded-Host': 'evil.invalid'})
        self.assertEqual(status, 200)
        got = {k.lower(): v for k, v in json.loads(body)['headers'].items()}
        for k, value in headers.items(): self.assertEqual(got[k.lower()], value)
        self.assertEqual(got['host'], 'dev-api.gobadminton.ru')
        self.assertEqual(got['x-forwarded-proto'], 'https')  # preserve legacy gate contract
        self.assertNotIn('x-forwarded-host', got)

    def test_22_admin_and_nonconsumer_denied(self):
        self.assertEqual(self.request(path='/v1/admin')[0], 403)
        self.assertEqual(self.request(path='/v1/admin/users')[0], 403)
        self.assertEqual(self.request(path='/admin')[0], 404)

    def test_23_no_client_certificate_denied(self):
        ctx = ssl.create_default_context(cafile=str(self.root/'ca.crt'))
        c = http.client.HTTPSConnection('127.0.0.1', self.gate, context=ctx, timeout=3)
        try:
            c.request('GET', '/v1/health'); r = c.getresponse(); r.read()
            self.assertEqual(r.status, 400)
        finally: c.close()

    def test_24_wrong_server_ca_denied(self):
        ctx = ssl.create_default_context()
        c = http.client.HTTPSConnection('127.0.0.1', self.gate, context=ctx, timeout=3)
        try:
            with self.assertRaises(ssl.SSLCertVerificationError): c.request('GET', '/v1/health')
        finally: c.close()

    def test_25_oversized_avatar_denied(self):
        before = Backend.writes
        self.assertEqual(self.request('PUT', '/v1/me/avatar', b'x' * 524289)[0], 413)
        self.assertEqual(Backend.writes, before)

    def test_26_media_lane_loss_rpc_survives(self):
        media = self.relays[2]; media.disconnect()
        try:
            self.assertEqual(self.request('PUT', '/v1/me/avatar', b'x')[0], 503)
            for _ in range(20): self.assertEqual(self.request()[0], 200)
        finally: media.enabled = True


    def test_27_full_patched_vhost_nginx_syntax(self):
        old = vhost().replace(b'/etc/gb/ca.crt', str(self.root/'ca.crt').encode())
        old = old.replace(b'/etc/gb/client.crt', str(self.root/'client.crt').encode())
        old = old.replace(b'/etc/gb/client.key', str(self.root/'client.key').encode())
        old = old.replace(b'listen 443 ssl;', ('listen 443 ssl; ssl_certificate ' +
            str(self.root/'server.crt') + '; ssl_certificate_key ' + str(self.root/'server.key') + ';').encode())
        patched = t.patch_vhost(old, t.digest(old)).decode()
        conf = self.root/'patched-syntax.conf'
        conf.write_text(f'pid {self.root}/syntax.pid; error_log {self.root}/syntax.error.log; '
            + 'events {} http { access_log off; ' + patched + '}')
        r = subprocess.run(['nginx', '-t', '-p', str(self.root), '-c', str(conf)],
                           capture_output=True, text=True, timeout=5)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_28_cli_bundle_and_exact_rollback(self):
        secrets = {lane.name: str(uuid.uuid4()) for lane in t.LANES}
        inp = self.root/'secrets.json'; inp.write_text(json.dumps(secrets)); inp.chmod(0o600)
        snapshot = self.root/'snapshot.conf'; snapshot.write_bytes(vhost()); snapshot.chmod(0o600)
        out = self.root/'rendered'
        import sys
        r = subprocess.run([sys.executable, str(Path(t.__file__)), '--secrets', str(inp),
            '--vhost-snapshot', str(snapshot), '--expected-sha256', t.digest(vhost()),
            '--out', str(out), '--runtime', str(self.root), '--ca', str(self.root/'ca.crt'),
            '--gate-cert', str(self.root/'server.crt'), '--gate-key', str(self.root/'server.key')],
            capture_output=True, text=True, timeout=5)
        self.assertEqual(r.returncode, 0, r.stderr)
        manifest = json.loads((out/'manifest.json').read_text())
        self.assertFalse(manifest['production_changed'])
        self.assertTrue(manifest['operator_paused'])
        self.assertEqual((out/'moscow-vhost.rollback.conf').read_bytes(), snapshot.read_bytes())
        for name, expected in manifest['files'].items():
            self.assertEqual(t.digest((out/name).read_bytes()), expected)
            self.assertEqual((out/name).stat().st_mode & 0o777, 0o600)
        for secret in secrets.values():
            self.assertNotIn(secret, (out/'manifest.json').read_text())
            self.assertNotIn(secret, r.stdout + r.stderr)

if __name__ == '__main__': unittest.main()

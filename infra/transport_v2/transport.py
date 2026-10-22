#!/usr/bin/env python3
"""GoBadminton reverse-XHTTP lane candidate. Renders files only; never installs.
Derived from legacy PR92 (fb0a4e5a6da9b11754726a426e3b0f3c7773b099).
No subprocess, SSH, DNS mutation, service operation, database or firewall access.
"""
from __future__ import annotations
import argparse
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import uuid

BASE_SHA = '71aaabd97cf81f387ccc1f50258a81d54289b3b2'
LEGACY_SHA = 'fb0a4e5a6da9b11754726a426e3b0f3c7773b099'
MOSCOW = '194.87.214.217'
GERMANY = '169.58.183.182'
HOST = 'gobadminton.ru'
GATE_NAME = 'gb-api-gate.internal'

@dataclass(frozen=True)
class Lane:
    name: str
    registration: int
    ingress: int
    max_connections: int
    @property
    def path(self) -> str:
        return f'/_gb-link/v2/{self.name}/'

LANES = (Lane('rpc-a', 18541, 18542, 32),
         Lane('rpc-b', 18551, 18552, 32),
         Lane('media', 18561, 18562, 4))


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_path(value: str) -> str:
    # Paths are interpolated into nginx; do not accept directives or variables.
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+', value) or '..' in Path(value).parts:
        raise ValueError('absolute simple filesystem path required')
    return value


def xray_pair(lane: Lane, peer: str, gate: int = 18543) -> tuple[dict, dict]:
    """Separate Xray PROCESS per lane is required: no cross-lane HTTP client pool.

    maxConcurrency governs XHTTP proxy connections, NOT inner reverse-MUX streams.
    Native VLESS reverse MUX remains. No additional outbound mux is enabled.
    """
    peer = str(uuid.UUID(peer))
    tag = 'gb-v2-' + lane.name
    portal = {
        'log': {'loglevel': 'warning'},
        'inbounds': [
            {'tag': tag + '-register', 'listen': '127.0.0.1', 'port': lane.registration,
             'protocol': 'vless',
             'settings': {'decryption': 'none', 'clients': [
                 {'id': peer, 'email': tag, 'reverse': {'tag': tag + '-remote'}}]},
             'streamSettings': {'network': 'xhttp', 'security': 'none',
                 'xhttpSettings': {'path': lane.path, 'mode': 'packet-up'}}},
            {'tag': tag + '-api', 'listen': '127.0.0.1', 'port': lane.ingress,
             'protocol': 'tunnel'}],
        'routing': {'rules': [
            {'type': 'field', 'inboundTag': [tag + '-api'], 'outboundTag': tag + '-remote'}]},
        'outbounds': [{'protocol': 'blackhole', 'tag': tag + '-deny'},
                      {'protocol': 'freedom', 'tag': tag + '-unused'}]}
    bridge = {
        'log': {'loglevel': 'warning'}, 'inbounds': [],
        'routing': {'rules': [
            {'type': 'field', 'inboundTag': [tag + '-reverse'], 'outboundTag': tag + '-gate'}]},
        'outbounds': [
            {'protocol': 'blackhole', 'tag': tag + '-deny'},
            {'protocol': 'freedom', 'tag': tag + '-gate',
             'settings': {'redirect': f'127.0.0.1:{gate}'}},
            {'protocol': 'vless', 'tag': tag + '-to-moscow',
             'settings': {'address': MOSCOW, 'port': 443, 'id': peer, 'encryption': 'none',
                          'reverse': {'tag': tag + '-reverse'}},
             'streamSettings': {'network': 'xhttp', 'security': 'tls',
                 'tlsSettings': {'serverName': HOST, 'allowInsecure': False, 'alpn': ['h2']},
                 'xhttpSettings': {'host': HOST, 'path': lane.path, 'mode': 'packet-up',
                     'extra': {'xmux': {
                         'maxConcurrency': 1, 'maxConnections': 0, 'cMaxReuseTimes': 0,
                         'hMaxRequestTimes': '600-900', 'hMaxReusableSecs': '1800-3000',
                         'hKeepAlivePeriod': 0}}}}}]}
    return portal, bridge


def upstreams(lanes: tuple[Lane, ...] = LANES) -> str:
    a, b, m = lanes
    return f'''# http context. Named pools are necessary; Connection "" alone is insufficient.
upstream gb_v2_rpc {{
    zone gb_v2_rpc 64k;
    server 127.0.0.1:{a.ingress} max_conns={a.max_connections} max_fails=1 fail_timeout=10s;
    server 127.0.0.1:{b.ingress} max_conns={b.max_connections} max_fails=1 fail_timeout=10s;
    keepalive 16;
    keepalive_requests 100;
    keepalive_timeout 20s;
    keepalive_time 5m;
}}
upstream gb_v2_media {{
    zone gb_v2_media 64k;
    server 127.0.0.1:{m.ingress} max_conns={m.max_connections};
    keepalive 2;
    keepalive_requests 100;
    keepalive_timeout 20s;
    keepalive_time 5m;
}}
'''


def carriers(lanes: tuple[Lane, ...] = LANES) -> str:
    return '\n'.join(f'''# Existing Moscow TLS server context; preserve old /_gb-link/v1 unchanged.
location ^~ {lane.path} {{
    allow {GERMANY};
    deny all;
    client_max_body_size 2m;
    client_body_timeout 300s;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host {HOST};
    proxy_set_header Authorization "";
    proxy_set_header Cookie "";
    proxy_set_header Origin "";
    proxy_set_header X-Forwarded-For "";
    proxy_set_header X-Real-IP "";
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_pass http://127.0.0.1:{lane.registration};
    proxy_connect_timeout 3s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;
    proxy_next_upstream off;
    access_log off;
    add_header Cache-Control "no-store" always;
}}''' for lane in lanes) + '\n'


def edge_locations(ca: str, cert: str, key: str, *, legacy: bool = False) -> str:
    """Reference/test locations only. Live publication uses patch_vhost, not replacement."""
    for p in (ca, cert, key): safe_path(p)
    blocks = []
    for location, pool, timeouts in (
        ('= /v1/me/avatar', 'gb_v2_media',
         'client_max_body_size 512k;\n    client_body_timeout 12s;\n    proxy_request_buffering on;\n    proxy_send_timeout 15s;\n    proxy_read_timeout 15s;'),
        ('/v1/', 'gb_v2_rpc', 'proxy_send_timeout 60s;\n    proxy_read_timeout 60s;\n    proxy_buffering off;')):
        target = '127.0.0.1:18442' if legacy else pool
        blocks.append(f'''location {location} {{
    {timeouts}
    proxy_pass https://{target};
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host dev-api.gobadminton.ru;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_ssl_server_name on;
    proxy_ssl_name {GATE_NAME};
    proxy_ssl_verify on;
    proxy_ssl_verify_depth 2;
    proxy_ssl_trusted_certificate {ca};
    proxy_ssl_certificate {cert};
    proxy_ssl_certificate_key {key};
    proxy_ssl_session_reuse on;
    proxy_connect_timeout {3 if legacy else 6}s;
    proxy_next_upstream off;
    proxy_intercept_errors on;
    error_page 502 504 =503 /__gb_xhttp_unavailable;
}}''')
    return '\n'.join(blocks) + '\nlocation = /__gb_xhttp_unavailable { internal; return 503; }\n'


def gate_config(runtime: str, ca: str, cert: str, key: str,
                gate: int = 18543, api: int = 18080) -> str:
    for p in (runtime, ca, cert, key): safe_path(p)
    # Dedicated NEW gate, old 18443 remains rollback. Header/auth contract retained.
    return f'''worker_processes 1;
pid {runtime}/gate.pid;
error_log {runtime}/gate.error.log warn;
events {{ worker_connections 1024; }}
http {{
    access_log off;
    server_tokens off;
    client_body_temp_path {runtime}/body;
    proxy_temp_path {runtime}/proxy;
    client_body_timeout 15s;
    client_max_body_size 512k;
    upstream gb_v2_local_api {{
        server 127.0.0.1:{api} max_conns=96;
        keepalive 16;
        keepalive_requests 100;
        keepalive_timeout 20s;
    }}
    server {{
        listen 127.0.0.1:{gate} ssl;
        server_name {GATE_NAME};
        ssl_certificate {cert};
        ssl_certificate_key {key};
        ssl_client_certificate {ca};
        ssl_verify_client on;
        ssl_verify_depth 2;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_session_tickets off;
        ssl_session_cache shared:gb_v2_gate:1m;
        ssl_session_timeout 5m;
        keepalive_timeout 45s;
        keepalive_requests 1000;
        add_header Cache-Control "no-store" always;
        add_header X-Content-Type-Options "nosniff" always;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host dev-api.gobadminton.ru;
        proxy_set_header X-Real-IP $http_x_real_ip;
        proxy_set_header X-Forwarded-For $http_x_forwarded_for;
        proxy_set_header X-Forwarded-Host "";
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 2s;
        proxy_next_upstream off;
        location ~ ^/v1/admin(?:/|$) {{ return 403; }}
        location = /v1/me/avatar {{
            proxy_request_buffering on;
            proxy_send_timeout 15s;
            proxy_read_timeout 15s;
            proxy_pass http://gb_v2_local_api;
        }}
        location /v1/ {{
            proxy_read_timeout 60s;
            proxy_buffering off;
            proxy_pass http://gb_v2_local_api;
        }}
        location / {{ return 404; }}
    }}
}}
'''


@dataclass
class Block:
    header: tuple[str, ...]
    start: int
    opening: int
    end: int
    parent: 'Block | None'


TOKEN = re.compile(r'#([^\n]*)|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[{};]|[^\s{};#"\']+')


def parse_blocks(text: str) -> list[Block]:
    """Small lexical nginx block reader: quotes/comments do not affect brace depth."""
    stack: list[Block] = []
    pending: list[tuple[str, int]] = []
    blocks: list[Block] = []
    for m in TOKEN.finditer(text):
        token = m.group()
        if token.startswith('#'): continue
        if token == '{':
            if not pending: raise ValueError('block without header')
            b = Block(tuple(v for v, _ in pending), pending[0][1], m.start(), -1,
                      stack[-1] if stack else None)
            stack.append(b); blocks.append(b); pending = []
        elif token == '}':
            if not stack or pending: raise ValueError('malformed nginx block')
            stack.pop().end = m.end(); pending = []
        elif token == ';':
            pending = []
        else:
            pending.append((token, m.start()))
    if stack or pending: raise ValueError('unterminated nginx config')
    return blocks


def patch_vhost(original: bytes, expected_sha256: str) -> bytes:
    """Offline, compare-and-swap preparation. Preserves all unrelated vhost bytes.

    Accept only a dedicated http-context vhost file, not nginx -T output or a
    whole-host nginx.conf. Never weakens authentication, auto-replays, or edits v1.
    """
    if digest(original) != expected_sha256: raise ValueError('snapshot SHA256 mismatch')
    text = original.decode('utf-8')
    if 'gb_v2_' in text or '/_gb-link/v2/' in text: raise ValueError('v2 already present')
    blocks = parse_blocks(text)
    if any(b.header[0] in ('http', 'events', 'stream') for b in blocks):
        raise ValueError('dedicated vhost file required; no global config')
    selections = []
    for header, pool in ((('location', '=', '/v1/me/avatar'), 'gb_v2_media'),
                         (('location', '/v1/'), 'gb_v2_rpc')):
        found = [b for b in blocks if b.header == header]
        if len(found) != 1: raise ValueError('exactly one known consumer location required')
        b = found[0]
        if b.parent is None or b.parent.header != ('server',):
            raise ValueError('consumer location must be directly in server')
        body = text[b.opening + 1:b.end - 1]
        if any(c.parent is b for c in blocks): raise ValueError('nested consumer config needs review')
        # Removing comments only is safe here because accepted header values are simple.
        clean = re.sub(r'#[^\n]*', '', body)
        required = [r'proxy_ssl_verify\s+on\s*;',
                    r'proxy_ssl_name\s+gb-api-gate\.internal\s*;',
                    r'proxy_http_version\s+1\.1\s*;',
                    r'proxy_set_header\s+Connection\s+""\s*;',
                    r'proxy_next_upstream\s+off\s*;',
                    r'proxy_ssl_certificate\s+[^;]+;', r'proxy_ssl_certificate_key\s+[^;]+;',
                    r'proxy_ssl_trusted_certificate\s+[^;]+;']
        if any(len(re.findall(r, clean)) != 1 for r in required):
            raise ValueError('unexpected mTLS/header/replay contract; review loaded config')
        if len(re.findall(r'\bproxy_pass\b', clean)) != 1:
            raise ValueError('ambiguous upstream')
        if not re.search(r'proxy_pass\s+https://127\.0\.0\.1:18442\s*;', clean):
            raise ValueError('not the recorded GoBadminton upstream')
        if len(re.findall(r'\bproxy_connect_timeout\b', clean)) != 1 or not re.search(
                r'proxy_connect_timeout\s+3s\s*;', clean):
            raise ValueError('timeout drift; do not overwrite unknown live change')
        changed, n = re.subn(r'proxy_pass\s+https://127\.0\.0\.1:18442\s*;',
                             'proxy_pass https://' + pool + ';', body)
        if n != 1: raise ValueError('ambiguous commented upstream')
        changed, n = re.subn(r'proxy_connect_timeout\s+3s\s*;', 'proxy_connect_timeout 6s;', changed)
        if n != 1: raise ValueError('ambiguous commented timeout')
        selections.append((b, changed))
    server = selections[0][0].parent
    if selections[1][0].parent is not server: raise ValueError('consumer locations cross servers')
    # Both selected locations must belong to the actual public TLS vhost.
    prefix = text[server.opening + 1:server.end - 1]
    if not re.search(r'server_name\s+gobadminton\.ru(?:\s+[^;]+)?;', prefix):
        raise ValueError('not gobadminton.ru vhost')
    if not re.search(r'listen\s+[^;]*\b443\b[^;]*\bssl\b[^;]*;', prefix):
        raise ValueError('expected HTTPS/443 listener')
    edits = [(b.opening + 1, b.end - 1, changed) for b, changed in selections]
    edits.append((server.end - 1, server.end - 1, '\n' + carriers()))
    for start, end, value in sorted(edits, reverse=True):
        text = text[:start] + value + text[end:]
    return (upstreams() + '\n' + text).encode()


def private_read(path: Path) -> bytes:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_mode & 0o077 or st.st_uid != os.geteuid():
            raise ValueError('private input must be owned by caller, regular and mode 0600')
        if st.st_size > 1024 * 1024: raise ValueError('input too large')
        return os.read(fd, st.st_size + 1)
    finally:
        os.close(fd)


def write_bundle(out: Path, files: dict[str, bytes]) -> None:
    if out.exists() or out.is_symlink(): raise ValueError('output already exists')
    if any((p / '.git').exists() for p in (out, *out.parents)):
        raise ValueError('private generated bundle must be outside a Git checkout')
    old = os.umask(0o077)
    try:
        out.mkdir(mode=0o700, parents=False)
        for name, content in files.items():
            p = out / name
            p.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'wb') as f: f.write(content)
    finally:
        os.umask(old)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--secrets', type=Path, required=True, help='0600 JSON: unique rpc-a/rpc-b/media UUIDs')
    p.add_argument('--vhost-snapshot', type=Path, required=True, help='0600 authorized snapshot, NOT nginx -T')
    p.add_argument('--expected-sha256', required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--runtime', default='/run/gobadminton-transport-v2')
    p.add_argument('--ca', required=True)
    p.add_argument('--gate-cert', required=True)
    p.add_argument('--gate-key', required=True)
    a = p.parse_args()
    try:
        secrets = json.loads(private_read(a.secrets))
        if set(secrets) != {l.name for l in LANES}: raise ValueError('three named lane UUIDs required')
        peers = {k: str(uuid.UUID(v)) for k, v in secrets.items()}
        if len(set(peers.values())) != 3 or str(uuid.UUID(int=0)) in peers.values():
            raise ValueError('unique nonzero lane UUIDs required')
        snapshot = private_read(a.vhost_snapshot)
        patched = patch_vhost(snapshot, a.expected_sha256)
        files = {'moscow-vhost.candidate.conf': patched, 'moscow-vhost.rollback.conf': snapshot,
                 'germany-gate.candidate.conf': gate_config(a.runtime, a.ca, a.gate_cert, a.gate_key).encode()}
        for lane in LANES:
            for role, config in zip(('moscow', 'germany'), xray_pair(lane, peers[lane.name])):
                files[f'{role}-{lane.name}.json'] = (json.dumps(config, indent=2) + '\n').encode()
        manifest = {'schema': 1, 'base_sha': BASE_SHA, 'legacy_reference_sha': LEGACY_SHA,
            'status': 'SOURCE_CANDIDATE_NOT_INSTALLED', 'operator_paused': True,
            'production_changed': False, 'xray_process_model': 'one process per host per lane',
            'original_vhost_sha256': digest(snapshot),
            'candidate_vhost_sha256': digest(patched),
            'rollback': 'restore exact snapshot; validate nginx; graceful reload via approved original-host operator',
            'files': {k: digest(v) for k, v in files.items()}}
        files['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
        write_bundle(a.out.absolute(), files)
    except (ValueError, OSError, KeyError, TypeError) as e:
        p.error(str(e))
    print('RENDERED_ONLY; no host command executed; keep bundle private')

if __name__ == '__main__': main()

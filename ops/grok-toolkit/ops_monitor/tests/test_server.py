import base64, http.client, json, os, sys, tempfile, threading, time, unittest, datetime
from http.server import ThreadingHTTPServer
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from opsmon import server

PIN = os.environ.get('OPSMON_TEST_PIN', '2468')  # test-only, не реальный PIN
def start(snapshot=None, clock=time.time, secure=False):
    d = tempfile.mkdtemp(); sp = os.path.join(d, 'snapshot.json')
    if snapshot is not None: open(sp, 'w').write(json.dumps(snapshot))
    salt = os.urandom(16)
    cfg = {'pin_salt': base64.b64encode(salt).decode(), 'pin_hash': base64.b64encode(server.hash_pin(PIN, salt)).decode(),
           'cookie_secret': base64.b64encode(os.urandom(32)).decode(), 'cookie_secure': secure, 'snapshot_path': sp, 'prefix': '/ops-monitor'}
    app = server.App(cfg, clock=clock)
    srv = ThreadingHTTPServer(('127.0.0.1', 0), server.make_handler(app)); srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return app, srv, sp

def req(srv, method, path, body=None, headers=None, ctype='application/json'):
    c = http.client.HTTPConnection('127.0.0.1', srv.server_address[1], timeout=10)
    h = dict(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body); h['Content-Type'] = ctype
    c.request(method, path, data, h); r = c.getresponse(); b = r.read(); c.close()
    return r.status, dict(r.getheaders()), b

def snap(age=5):
    g = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=age)
    return {'schema': 1, 'generated_utc': g.isoformat(timespec='seconds'), 'claim': {'issue': 82, 'phase': 'qa'}, 'executor': {'running': True},
            'evil_extra': 'LEAK', 'done_count': 3, 'dev': {}, 'parked': []}

def login(srv, pin=PIN, ip='1.2.3.4'):
    return req(srv, 'POST', '/ops-monitor/api/login', {'pin': pin}, {'X-Real-IP': ip})

class T(unittest.TestCase):
    def test_anonymous_gets_401_no_data(self):
        app, srv, _ = start(snap())
        s, h, b = req(srv, 'GET', '/ops-monitor/api/snapshot')
        self.assertEqual(s, 401); self.assertNotIn(b'claim', b); self.assertNotIn(b'82', b)
        s, h, b = req(srv, 'GET', '/ops-monitor/api/snapshot', headers={'Cookie': 'gbops=1.2.3.deadbeef'}); self.assertEqual(s, 401)
        s, h, b = req(srv, 'GET', '/ops-monitor/api/snapshot', headers={'Cookie': 'gbops=%d.aa.%s' % (time.time() + 999, 'f' * 64)}); self.assertEqual(s, 401)

    def test_public_assets_contain_no_data(self):
        app, srv, _ = start(snap())
        for p in ('/ops-monitor/', '/ops-monitor/app.js', '/ops-monitor/manifest.webmanifest', '/ops-monitor/icon-180.png'):
            s, h, b = req(srv, 'GET', p); self.assertEqual(s, 200, p)
            self.assertNotIn(b'evil_extra', b); self.assertEqual(h['Cache-Control'], 'no-store')
        self.assertEqual(req(srv, 'GET', '/ops-monitor')[0], 308)
        self.assertEqual(req(srv, 'GET', '/ops-monitor/../etc/passwd')[0], 404)
        self.assertEqual(req(srv, 'GET', '/ops-monitor/state.json')[0], 404)

    def test_login_flow_cookie_and_snapshot(self):
        app, srv, _ = start(snap(), secure=True)
        s, h, b = login(srv); self.assertEqual(s, 200)
        ck = h['Set-Cookie']
        for part in ('HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/ops-monitor/', 'Max-Age=43200'): self.assertIn(part, ck)
        self.assertNotIn(PIN, ck)
        cookie = ck.split(';')[0]
        s, h, b = req(srv, 'GET', '/ops-monitor/api/snapshot', headers={'Cookie': cookie})
        d = json.loads(b); self.assertEqual(s, 200)
        self.assertEqual(d['claim']['issue'], 82); self.assertNotIn('evil_extra', d)
        self.assertFalse(d['stale']); self.assertEqual(h['Cache-Control'], 'no-store')
        self.assertIn('frame-ancestors', h['Content-Security-Policy'])

    def test_wrong_pin_and_lockout(self):
        app, srv, _ = start(snap())
        for i in range(4): self.assertEqual(login(srv, '0000')[0], 401)
        self.assertEqual(login(srv, '0000')[0], 429)           # 5th failure -> locked
        s, h, b = login(srv, PIN); self.assertEqual(s, 429)    # correct PIN is refused while locked
        self.assertIn('Retry-After', h); self.assertNotIn('Set-Cookie', h)
        self.assertEqual(login(srv, PIN, ip='9.9.9.9')[0], 200)  # other IP unaffected

    def test_lockout_expires(self):
        t = [1000.0]; app, srv, _ = start(snap(), clock=lambda: t[0])
        for i in range(5): login(srv, '1111')
        self.assertEqual(login(srv)[0], 429); t[0] += 901; self.assertEqual(login(srv)[0], 200)

    def test_global_cap(self):
        app, srv, _ = start(snap())
        for i in range(30): login(srv, '1111', ip='10.0.%d.%d' % (i // 4, i % 4))
        self.assertEqual(login(srv, PIN, ip='7.7.7.7')[0], 429)

    def test_bad_requests(self):
        app, srv, _ = start(snap())
        self.assertEqual(req(srv, 'POST', '/ops-monitor/api/login', {'pin': PIN}, ctype='text/plain')[0], 400)   # no CSRF form posts
        self.assertEqual(req(srv, 'POST', '/ops-monitor/api/login', {'pin': PIN}, {'Origin': 'https://evil.example'})[0], 400)
        self.assertEqual(login(srv, '99 11')[0], 401); self.assertEqual(login(srv, int(PIN))[0], 401)
        self.assertEqual(req(srv, 'PUT', '/ops-monitor/api/snapshot', {})[0], 405)

    def test_stale_and_missing_snapshot(self):
        app, srv, sp = start(snap(age=600))
        cookie = login(srv)[1]['Set-Cookie'].split(';')[0]
        d = json.loads(req(srv, 'GET', '/ops-monitor/api/snapshot', headers={'Cookie': cookie})[2]); self.assertTrue(d['stale'])
        os.unlink(sp)
        d = json.loads(req(srv, 'GET', '/ops-monitor/api/snapshot', headers={'Cookie': cookie})[2]); self.assertFalse(d['available'])
        open(sp, 'w').write('{garbage'); d = json.loads(req(srv, 'GET', '/ops-monitor/api/snapshot', headers={'Cookie': cookie})[2]); self.assertFalse(d['available'])
        open(sp, 'w').write(' ' * 200000); d = json.loads(req(srv, 'GET', '/ops-monitor/api/snapshot', headers={'Cookie': cookie})[2]); self.assertFalse(d['available'])

    def test_session_expiry_and_logout(self):
        t = [1000.0]; app, srv, _ = start(snap(), clock=lambda: t[0])
        cookie = login(srv)[1]['Set-Cookie'].split(';')[0]
        self.assertEqual(req(srv, 'GET', '/ops-monitor/api/snapshot', headers={'Cookie': cookie})[0], 200)
        t[0] += 43201; self.assertEqual(req(srv, 'GET', '/ops-monitor/api/snapshot', headers={'Cookie': cookie})[0], 401)

    def test_no_pin_plaintext_in_config(self):
        import subprocess
        out = os.path.join(tempfile.mkdtemp(), 'c.json')
        subprocess.run([sys.executable, os.path.join(os.path.dirname(server.__file__), 'make_config.py'), out], input=PIN + '\n', text=True, check=True, capture_output=True)
        raw = open(out).read(); self.assertNotIn(PIN, raw); self.assertEqual(oct(os.stat(out).st_mode & 0o777), '0o640')
        cfg = json.loads(raw); self.assertIn('pin_hash', cfg); self.assertNotIn('pin', cfg)

if __name__ == '__main__': unittest.main()

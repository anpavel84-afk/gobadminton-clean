"""Real built Next HTTP boundary; Docker required. No public API calls or auth stubs.
Only outbound fetch transport is replaced inside the disposable path image.
"""
import http.client
import json
from pathlib import Path
import subprocess
import tempfile
import time

PRELOAD = r'''
const assert = require('node:assert/strict');
globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  assert.equal(url.origin, 'https://dev.gobadminton.ru');
  assert.equal(options.headers.get('origin'), url.origin);
  assert.equal(options.headers.has('authorization'), false);
  assert.equal(options.redirect, 'manual');
  const callback = /^\/v1\/admin\/auth\/(vk|yandex)\/callback$/.test(url.pathname);
  assert.equal(options.headers.get('cookie'), callback ? '__Host-gb_admin_binding=fixture' : '__Host-gb_admin_session=fixture');
  if (callback) {
    assert.equal(options.method, 'GET');
    assert.equal(url.search, '?state=bound&code=private');
    const headers = new Headers();
    headers.append('set-cookie', '__Host-gb_admin_mfa=fixture; Path=/; Secure; HttpOnly');
    headers.append('set-cookie', '__Host-gb_session=forbidden; Path=/; Secure');
    return Response.json({csrfToken:'fixture',principalId:'fixture',status:'pending_mfa'}, {headers});
  }
  assert.equal(url.search, '');
  assert.equal(url.pathname, options.method === 'POST' ? '/v1/admin/auth/logout' : '/v1/admin/auth/me');
  if (options.method === 'POST') assert.equal(options.headers.get('x-csrf-token'), 'fixture-csrf');
  return Response.json({code:'ADMIN_SESSION_REQUIRED'}, {status:401});
};
'''


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, timeout=60).strip()


def main():
    container = None
    with tempfile.TemporaryDirectory(prefix='admin-http-') as directory:
        path = Path(directory)
        path.chmod(0o755)
        (path / 'fetch.cjs').write_text(PRELOAD)
        (path / 'fetch.cjs').chmod(0o644)
        try:
            env = dict(ADMIN_INTERNAL_APP_ENABLED='1', ADMIN_DEV_ENABLED='1', ADMIN_DEV_PATH_ENABLED='1',
                       APP_ENV='stage', ADMIN_ORIGIN='https://dev.gobadminton.ru',
                       PUBLIC_WEB_ORIGIN='https://dev.gobadminton.ru', ADMIN_API_URL='https://dev.gobadminton.ru',
                       NODE_OPTIONS='--require=/test/fetch.cjs')
            args = [item for key, value in env.items() for item in ('-e', key + '=' + value)]
            # No external network; only loopback published HTTP. Image retains its nonroot USER.
            container = docker('run', '-d', '--network=bridge', '-p', '127.0.0.1::3010',
                               '--mount', f'type=bind,src={path},dst=/test,readonly', *args, 'admin-ci-path')
            port = int(docker('port', container, '3010/tcp').rsplit(':', 1)[1])
            fixed = {'Host':'dev.gobadminton.ru', 'X-Forwarded-Host':'dev.gobadminton.ru',
                     'X-Forwarded-Proto':'https', 'Sec-Fetch-Site':'same-origin',
                     'Cookie':'__Host-gb_session=consumer; __Host-gb_admin_session=fixture',
                     'Authorization':'Bearer consumer'}

            def request(route, status, method='GET', changes=None, label='HTTP boundary'):
                headers = fixed | (changes or {})
                headers = {key:value for key,value in headers.items() if value is not None}
                conn = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
                try:
                    conn.request(method, route, body='{}' if method == 'POST' else None, headers=headers)
                    response = conn.getresponse()
                    body = response.read()
                    assert response.status in (status if isinstance(status, tuple) else (status,)), (label, method, route, changes or {}, response.status, status, body)
                    return response, body
                finally:
                    conn.close()

            deadline = time.monotonic() + 40
            while True:
                try:
                    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=1)
                    conn.request('GET', '/admin/')
                    conn.getresponse().read()
                    conn.close()
                    break
                except (OSError, http.client.HTTPException):
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(0.2)
            route = '/admin/v1/admin/auth/me'
            response, body = request(route, 401)
            assert json.loads(body)['code'] == 'ADMIN_SESSION_REQUIRED'
            # Supervisor verified next/dist/server/base-server.js in failed image f312:
            # req.headers['x-forwarded-host'] ??= req.headers['host'] ?? this.hostname;
            # Next synthesizes the exact validated Host before AppRoute; raw absence
            # cannot be distinguished by the handler after this normalization.
            response, body = request(route, 401, changes={'X-Forwarded-Host':None},
                                     label='missing raw XFHost synthesized from validated Host')
            assert json.loads(body)['code'] == 'ADMIN_SESSION_REQUIRED'
            request(route, (403, 404),
                    changes={'Host':'evil.test', 'X-Forwarded-Host':None},
                    label='wrong Host with missing XFHost remains denied')
            # Missing/forged proto may alter Next's internal URL and fail path
            # validation first (404); it must never reach outbound transport.
            for key, values in {'Host':[None,'evil.test','dev.gobadminton.ru:3010'],
                                'X-Forwarded-Host':['evil.test','dev.gobadminton.ru, evil.test'],
                                'X-Forwarded-Proto':[None,'http','https,http'],
                                'Origin':['https://evil.test','null'],
                                'Sec-Fetch-Site':['cross-site']}.items():
                for value in values:
                    request(route, 403 if key in ('Origin', 'Sec-Fetch-Site') else (403, 404), changes={key:value},
                            label='missing/forged header denied')
            for origin in (None, 'https://evil.test'):
                request('/admin/v1/admin/auth/logout', 403, 'POST', {'Origin':origin})
            request('/admin/v1/admin/auth/logout', 401, 'POST',
                    {'Origin':'https://dev.gobadminton.ru','X-CSRF-Token':'fixture-csrf'})
            request('/v1/admin/auth/me', 404)
            for malformed in ('auth%2fme','%61uth/me','auth/me/'):
                request('/admin/v1/admin/' + malformed, 404)
            for provider in ('vk','yandex'):
                response, body = request(f'/admin/v1/admin/auth/{provider}/callback?state=bound&code=private&activation=never', 303,
                    changes={'Cookie':'__Host-gb_session=consumer; __Host-gb_admin_binding=fixture','Sec-Fetch-Site':'cross-site'})
                assert response.getheader('Location') == 'https://dev.gobadminton.ru/admin/?auth=complete'
                assert body == b''
                cookies = '\n'.join(value for key,value in response.getheaders() if key.lower() == 'set-cookie')
                assert '__Host-gb_admin_mfa=fixture' in cookies and '__Host-gb_admin_handoff=' in cookies
                assert '__Host-gb_session=' not in cookies
            request('/admin/internal/auth-ticket', 401)
            print('Built standalone HTTP boundary checks passed (stub outbound transport only)')
        finally:
            if container:
                docker('rm', '-f', container)


if __name__ == '__main__':
    main()

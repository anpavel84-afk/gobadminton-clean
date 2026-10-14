#!/usr/bin/env python3
"""Issue #23 regression checks against copies of the real contract; stdlib only."""
import copy
import json
import unittest

from check_foundation import ROOT, contract_errors, markdown_errors, repository_files


class FoundationExceptionsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads((ROOT / 'packages/contracts/openapi.json').read_text())

    def setUp(self):
        self.document = copy.deepcopy(self.contract)

    def findings(self):
        return contract_errors(self.document)[0]

    def assert_idempotency(self, route, method='POST'):
        self.assertIn(f'{method} {route}: business mutation needs required Idempotency-Key', self.findings())

    def test_exact_residual_findings_and_docs(self):
        expected = {
            'PUT /me/avatar', 'DELETE /me/avatar',
        }
        self.assertEqual(set(self.findings()), {
            f'{label}: business mutation needs required Idempotency-Key' for label in expected
        })
        self.assertEqual(sum(len(markdown_errors(p)) for p in repository_files() if p.suffix == '.md'), 0)

    def test_admin_exemption_fail_closed(self):
        routes = ['/admin/auth/{provider}/start', '/admin/auth/webauthn/options', '/admin/auth/webauthn/verify']
        for route in routes:
            for change in ['removed marker', 'wrong marker', 'removed origin', 'optional origin',
                           'wrong origin declaration', 'wrong origin type', 'inherited security',
                           'consumer security', 'anonymous alternative', 'moved route']:
                with self.subTest(route=route, change=change):
                    self.document = copy.deepcopy(self.contract)
                    op = self.document['paths'][route]['post']
                    origin = next(p for p in op['parameters'] if p['name'] == 'Origin')
                    target = route
                    if change == 'removed marker': op.pop('x-auth-challenge-protocol')
                    elif change == 'wrong marker': op['x-auth-challenge-protocol'] = 'bound-single-use-v1'
                    elif change == 'removed origin': op['parameters'].remove(origin)
                    elif change == 'optional origin': origin['required'] = False
                    elif change == 'wrong origin declaration': origin['description'] = 'Consumer origin allowed'
                    elif change == 'wrong origin type': origin['schema']['type'] = 'integer'
                    elif change == 'inherited security': op.pop('security')
                    elif change == 'consumer security': op['security'] = [{'cookieSession': []}]
                    elif change == 'anonymous alternative': op['security'].append({})
                    elif change == 'moved route':
                        target = route + '/unknown'
                        self.document['paths'][target] = self.document['paths'].pop(route)
                    self.assert_idempotency(target)

    def test_webauthn_csrf_and_security_bindings(self):
        for route in ['/admin/auth/webauthn/options', '/admin/auth/webauthn/verify']:
            for change in ['removed csrf', 'optional csrf', 'wrong csrf name', 'missing alternative',
                           'and security', 'wrong scope', 'unknown scheme', 'wrong cookie',
                           'wrong scheme type', 'wrong scheme location', 'missing scheme']:
                with self.subTest(route=route, change=change):
                    self.document = copy.deepcopy(self.contract)
                    op = self.document['paths'][route]['post']
                    csrf = next(p for p in op['parameters'] if p['name'] == 'X-CSRF-Token')
                    schemes = self.document['components']['securitySchemes']
                    if change == 'removed csrf': op['parameters'].remove(csrf)
                    elif change == 'optional csrf': csrf['required'] = False
                    elif change == 'wrong csrf name': csrf['name'] = 'X-Consumer-CSRF'
                    elif change == 'missing alternative': op['security'].pop()
                    elif change == 'and security': op['security'] = [{'AdminSessionCookie': [], 'AdminMfaTicket': []}]
                    elif change == 'wrong scope': op['security'][0]['AdminSessionCookie'] = ['unexpected']
                    elif change == 'unknown scheme': op['security'][0] = {'UnknownAdmin': []}
                    elif change == 'wrong cookie': schemes['AdminSessionCookie']['name'] = '__Host-gb_session'
                    elif change == 'wrong scheme type': schemes['AdminMfaTicket']['type'] = 'http'
                    elif change == 'wrong scheme location': schemes['AdminMfaTicket']['in'] = 'header'
                    elif change == 'missing scheme': schemes.pop('AdminMfaTicket')
                    self.assert_idempotency(route)

    def test_oauth_link_exemption_fail_closed(self):
        route = '/me/linked-providers/{provider}/link'
        for change in ['marker missing', 'marker wrong', 'origin missing', 'origin optional',
                       'origin wrong type', 'origin wrong declaration', 'origin wrong name', 'csrf missing',
                       'csrf optional', 'csrf wrong name', 'csrf wrong type', 'security inherited',
                       'bearer', 'anonymous', 'and security', 'wrong scope', 'cookie missing',
                       'cookie wrong type', 'cookie wrong location', 'cookie wrong name', 'route moved',
                       'method changed']:
            with self.subTest(change=change):
                self.document = copy.deepcopy(self.contract)
                op = self.document['paths'][route]['post']
                origin = next(p for p in op['parameters'] if p['name'] == 'Origin')
                csrf = next(p for p in op['parameters'] if p['name'] == 'X-CSRF-Token')
                scheme = self.document['components']['securitySchemes']['cookieSession']
                target, method = route, 'POST'
                if change == 'marker missing': op.pop('x-auth-challenge-protocol')
                elif change == 'marker wrong': op['x-auth-challenge-protocol'] = 'bound-single-use-v1'
                elif change == 'origin missing': op['parameters'].remove(origin)
                elif change == 'origin optional': origin['required'] = False
                elif change == 'origin wrong type': origin['schema']['type'] = 'integer'
                elif change == 'origin wrong declaration': origin['description'] = 'Any Origin'
                elif change == 'origin wrong name': origin['name'] = 'X-Other-Origin'
                elif change == 'csrf missing': op['parameters'].remove(csrf)
                elif change == 'csrf optional': csrf['required'] = False
                elif change == 'csrf wrong name': csrf['name'] = 'X-Other-CSRF'
                elif change == 'csrf wrong type': csrf['schema']['type'] = 'integer'
                elif change == 'security inherited': op.pop('security')
                elif change == 'bearer': op['security'] = [{'bearerSession': []}]
                elif change == 'anonymous': op['security'].append({})
                elif change == 'and security': op['security'] = [{'cookieSession': [], 'bearerSession': []}]
                elif change == 'wrong scope': op['security'][0]['cookieSession'] = ['unexpected']
                elif change == 'cookie missing': self.document['components']['securitySchemes'].pop('cookieSession')
                elif change == 'cookie wrong type': scheme['type'] = 'http'
                elif change == 'cookie wrong location': scheme['in'] = 'header'
                elif change == 'cookie wrong name': scheme['name'] = '__Host-other-session'
                elif change == 'route moved':
                    target = route + '/other'
                    self.document['paths'][target] = self.document['paths'].pop(route)
                elif change == 'method changed':
                    method = 'PUT'
                    self.document['paths'][route] = {'put': op}
                self.assert_idempotency(target, method)

    def test_delete_keys_are_required_and_bodyless(self):
        for route in ['/me/linked-providers/{provider}', '/me/sessions/{sessionId}']:
            with self.subTest(route=route):
                self.document = copy.deepcopy(self.contract)
                op = self.document['paths'][route]['delete']
                self.assertNotIn('requestBody', op)
                self.assertEqual(op['security'], [{'cookieSession': []}])
                for name in ['Origin', 'X-CSRF-Token']:
                    self.assertTrue(next(p for p in op['parameters'] if p.get('name') == name)['required'])
                for change in ['missing', 'optional']:
                    with self.subTest(key=change):
                        self.document = copy.deepcopy(self.contract)
                        op = self.document['paths'][route]['delete']
                        if change == 'missing':
                            op['parameters'] = [p for p in op['parameters'] if p.get('$ref') != '#/components/parameters/IdempotencyKey']
                        else:
                            self.document['components']['parameters']['IdempotencyKey']['required'] = False
                        self.assert_idempotency(route, 'DELETE')

    def test_bodyless_deletes_keep_idempotency_and_csrf(self):
        for route in ['/me/linked-providers/{provider}', '/me/sessions/{sessionId}', '/me/avatar']:
            with self.subTest(route=route):
                self.document = copy.deepcopy(self.contract)
                op = self.document['paths'][route]['delete']
                op['parameters'] = [p for p in op['parameters'] if p.get('name') not in {'X-CSRF-Token', 'Idempotency-Key'} and p.get('$ref') not in {'#/components/parameters/CsrfToken', '#/components/parameters/IdempotencyKey'}]
                self.assert_idempotency(route, 'DELETE')
                self.assertIn(f'DELETE {route}: cookie mutation needs declared CSRF behavior', self.findings())
                op['requestBody'] = {'required': False}
                self.assertIn(f'DELETE {route}: expected explicit required command body', self.findings())

    def test_other_mutations_still_need_bodies(self):
        for method in ['post', 'put', 'patch', 'delete']:
            with self.subTest(method=method):
                self.document = copy.deepcopy(self.contract)
                op = copy.deepcopy(self.document['paths']['/me/avatar']['delete'])
                self.document['paths']['/unknown-delete'] = {method: op}
                self.assertIn(f'{method.upper()} /unknown-delete: expected explicit required command body', self.findings())
                self.assert_idempotency('/unknown-delete', method.upper())
        for method in ['post', 'put', 'patch']:
            with self.subTest(allowlisted_route_method=method):
                self.document = copy.deepcopy(self.contract)
                self.document['paths']['/me/avatar'] = {method: self.document['paths']['/me/avatar']['delete']}
                self.assertIn(f'{method.upper()} /me/avatar: expected explicit required command body', self.findings())


if __name__ == '__main__':
    unittest.main()

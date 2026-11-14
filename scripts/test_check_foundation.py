#!/usr/bin/env python3
"""Issue #23 regression checks against copies of the real contract; stdlib only."""
import copy
import json
import unittest

from check_foundation import ROOT, NATIVE_PROOF_COMMANDS, contract_errors, markdown_errors, repository_files


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
        # Both avatar commands now bind the same required key contract to real
        # MutationRunner receipts. Any regression must produce a fresh finding.
        self.assertEqual(self.findings(), [])
        self.assertEqual(sum(len(markdown_errors(p)) for p in repository_files() if p.suffix == '.md'), 0)

    def test_native_protocol_exact_seven_fail_closed(self):
        # Mutate real declarations, including non-mutating moved methods: a protocol
        # marker must never provide a generic /auth/native/ policy escape.
        for route in NATIVE_PROOF_COMMANDS:
            for change in ('moved route', 'unknown native route', 'method put', 'method get',
                           'missing marker', 'wrong marker', 'missing operation', 'wrong operation',
                           'inherited security', 'wrong security', 'anonymous alternative',
                           'missing body', 'optional body', 'missing json', 'extra content',
                           'missing schema', 'wrong schema', 'null schema', 'credentials'):
                with self.subTest(route=route, change=change):
                    self.document = copy.deepcopy(self.contract)
                    item = self.document['paths'][route]
                    op = item['post']
                    target, method = route, 'POST'
                    if change in ('moved route', 'unknown native route'):
                        target = '/unrelated/proof' if change == 'moved route' else route + '/unknown'
                        self.document['paths'][target] = self.document['paths'].pop(route)
                    elif change.startswith('method '):
                        method = change.split()[1].upper()
                        item[method.lower()] = item.pop('post')
                    elif change == 'missing marker': op.pop('x-native-auth-protocol')
                    elif change == 'wrong marker': op['x-native-auth-protocol'] = 'bound-single-use-v1'
                    elif change == 'missing operation': op.pop('operationId')
                    elif change == 'wrong operation': op['operationId'] = 'inventedProof'
                    elif change == 'inherited security': op.pop('security')
                    elif change == 'wrong security': op['security'] = [{'bearerSession': []}]
                    elif change == 'anonymous alternative': op['security'].append({})
                    elif change == 'missing body': op.pop('requestBody')
                    elif change == 'optional body': op['requestBody']['required'] = False
                    elif change == 'missing json': op['requestBody']['content'] = {}
                    elif change == 'extra content': op['requestBody']['content']['text/plain'] = {}
                    elif change == 'missing schema': op['requestBody']['content']['application/json'].pop('schema')
                    elif change == 'wrong schema': op['requestBody']['content']['application/json']['schema'] = {'type': 'string'}
                    elif change == 'null schema': op['requestBody']['content']['application/json']['schema'] = None
                    elif change == 'credentials': op.pop('x-native-credentials')
                    self.assertIn(f'{method} {target}: invalid closed native proof protocol declaration', self.findings())
                    if method != 'GET': self.assert_idempotency(target, method)
            with self.subTest(route=route, change='missing route'):
                self.document = copy.deepcopy(self.contract)
                self.document['paths'].pop(route)
                self.assertIn(f'POST {route}: missing closed native proof protocol command', self.findings())

    def test_native_proof_body_field_constraints(self):
        for route, (_, schema_name) in NATIVE_PROOF_COMMANDS.items():
            for change in ('type', 'required', 'properties', 'constraint', 'additional properties'):
                with self.subTest(route=route, change=change):
                    self.document = copy.deepcopy(self.contract)
                    op = self.document['paths'][route]['post']
                    schema = (self.document['components']['schemas'][schema_name] if schema_name
                              else op['requestBody']['content']['application/json']['schema'])
                    if change == 'type': schema['type'] = 'string'
                    elif change == 'required':
                        schema['required'] = [] if schema_name else ['invented']
                    elif change == 'properties': schema['properties']['invented'] = {'type': 'string'}
                    elif change == 'constraint':
                        if schema_name: schema['properties']['clientId'].pop('pattern')
                        else: schema.pop('properties')
                    elif change == 'additional properties': schema['additionalProperties'] = True
                    self.assert_idempotency(route)
        # Optional fields still carry binding/credential constraints.
        for schema_name, field in [('NativeTransactionRequest', 'returnPath'),
                                   ('NativeTransactionRequest', 'codeChallenge'),
                                   ('NativeTransactionRequest', 'codeChallengeMethod'),
                                   ('NativeExchangeRequest', 'verifier'),
                                   ('NativeLogoutRequest', 'refreshToken')]:
            with self.subTest(schema=schema_name, field=field):
                self.document = copy.deepcopy(self.contract)
                self.document['components']['schemas'][schema_name]['properties'][field] = {'type': 'string'}
                route = next(r for r, (_, name) in NATIVE_PROOF_COMMANDS.items() if name == schema_name)
                self.assert_idempotency(route)

    def test_native_browser_binding_and_complete_csrf(self):
        for route, (_, schema_name) in NATIVE_PROOF_COMMANDS.items():
            if schema_name: continue
            original = self.contract['paths'][route]['post']
            for parameter in original['parameters']:
                for change in ('missing', 'required', 'schema'):
                    with self.subTest(route=route, parameter=parameter['name'], change=change):
                        self.document = copy.deepcopy(self.contract)
                        op = self.document['paths'][route]['post']
                        p = next(p for p in op['parameters'] if p['name'] == parameter['name'])
                        if change == 'missing': op['parameters'].remove(p)
                        elif change == 'required': p['required'] = not p['required']
                        else: p['schema'] = {'type': 'integer'}
                        self.assert_idempotency(route)
            self.document = copy.deepcopy(self.contract)
            self.document['paths'][route]['post'].pop('x-native-browser-binding')
            self.assert_idempotency(route)
        complete = '/auth/native/transactions/{transactionId}/complete'
        for name in ('cookieSession', 'NativeBindingCookie'):
            for change in ('missing', 'type', 'in', 'name', 'alternative'):
                with self.subTest(scheme=name, change=change):
                    self.document = copy.deepcopy(self.contract)
                    schemes = self.document['components']['securitySchemes']
                    if change == 'missing': schemes.pop(name)
                    elif change == 'alternative':
                        self.document['paths'][complete]['post']['security'] = [{name: []}]
                    else: schemes[name][change] = 'wrong'
                    self.assert_idempotency(complete)
        self.document = copy.deepcopy(self.contract)
        op = self.document['paths'][complete]['post']
        op['parameters'] = [p for p in op['parameters'] if p['name'] != 'X-CSRF-Token']
        self.assertIn(f'POST {complete}: cookie mutation needs declared CSRF behavior', self.findings())

    def test_native_marker_cannot_exempt_business_mutation(self):
        route = '/me/role-reviews'
        op = self.document['paths'][route]['post']
        op['x-native-auth-protocol'] = 'native-pkce-bound-single-use-v1'
        op['parameters'] = [p for p in op['parameters'] if p.get('name') not in ('Idempotency-Key', 'X-CSRF-Token')
                            and p.get('$ref') not in ('#/components/parameters/IdempotencyKey', '#/components/parameters/CsrfToken')]
        self.assert_idempotency(route)
        self.assertIn(f'POST {route}: cookie mutation needs declared CSRF behavior', self.findings())

    def test_dev_qa_key_closed_protocol(self):
        route = '/admin/auth/dev-qa-key'
        for change in ['marker', 'origin', 'csrf', 'security', 'body', 'extra', 'key', 'moved']:
            with self.subTest(change=change):
                self.document = copy.deepcopy(self.contract)
                op = self.document['paths'][route]['post']
                schema = self.document['components']['schemas']['AdminDevQaKeyRequest']
                target = route
                if change == 'marker': op['x-auth-challenge-protocol'] = 'anything'
                elif change == 'origin': op['parameters'][0]['required'] = False
                elif change == 'csrf': op['parameters'][1]['required'] = False
                elif change == 'security': op['security'] = [{'cookieSession': []}]
                elif change == 'body': op['requestBody']['required'] = False
                elif change == 'extra': schema['additionalProperties'] = True
                elif change == 'key': schema['properties']['key']['writeOnly'] = False
                elif change == 'moved':
                    target = route + '/unknown'
                    self.document['paths'][target] = self.document['paths'].pop(route)
                self.assert_idempotency(target)

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
        for route in ['/me/linked-providers/{provider}', '/me/sessions/{sessionId}', '/me/avatar']:
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


    def test_avatar_required_key_does_not_displace_version_or_binary_upload(self):
        for method in ('put', 'delete'):
            with self.subTest(method=method):
                self.document = copy.deepcopy(self.contract)
                op = self.document['paths']['/me/avatar'][method]
                self.assertIn({'$ref': '#/components/parameters/IdempotencyKey'}, op['parameters'])
                self.assertTrue(next(p for p in op['parameters'] if p.get('name') == 'X-Profile-Version')['required'])
                self.assertTrue(next(p for p in op['parameters'] if p.get('name') == 'X-CSRF-Token')['required'])
                if method == 'put':
                    self.assertTrue(op['requestBody']['required'])
                    self.assertIn('image/png', op['requestBody']['content'])
                else:
                    self.assertNotIn('requestBody', op)
                op['parameters'] = [p for p in op['parameters'] if p.get('$ref') != '#/components/parameters/IdempotencyKey']
                self.assert_idempotency('/me/avatar', method.upper())

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
                op['parameters'] = [p for p in op['parameters'] if p.get('$ref') != '#/components/parameters/IdempotencyKey']
                self.document['paths']['/unknown-delete'] = {method: op}
                self.assertIn(f'{method.upper()} /unknown-delete: expected explicit required command body', self.findings())
                self.assert_idempotency('/unknown-delete', method.upper())
        for method in ['post', 'put', 'patch']:
            with self.subTest(allowlisted_route_method=method):
                self.document = copy.deepcopy(self.contract)
                self.document['paths']['/me/avatar'] = {method: self.document['paths']['/me/avatar']['delete']}
                self.assertIn(f'{method.upper()} /me/avatar: expected explicit required command body', self.findings())

    def test_consent_preview_authenticated_read_vs_mutator_escape(self):
        route = '/me/role-reviews/consent-preview'
        op = self.document['paths'][route]['post']
        self.assertEqual(op.get('x-operation-kind'), 'authenticated-read')
        self.assertFalse(any(
            p.get('name') == 'Idempotency-Key' or p.get('$ref') == '#/components/parameters/IdempotencyKey'
            for p in op.get('parameters', [])
        ))
        self.assertEqual(self.findings(), [])
        # Exact read loses classification without the marker.
        op.pop('x-operation-kind')
        self.assert_idempotency(route)
        # Real mutator cannot escape via annotation alone (path not in read allowlist).
        self.document = copy.deepcopy(self.contract)
        mutator = self.document['paths']['/me/role-reviews']['post']
        mutator['x-operation-kind'] = 'authenticated-read'
        mutator['parameters'] = [
            p for p in mutator['parameters']
            if p.get('$ref') != '#/components/parameters/IdempotencyKey' and p.get('name') != 'Idempotency-Key'
        ]
        self.assert_idempotency('/me/role-reviews')


if __name__ == '__main__':
    unittest.main()

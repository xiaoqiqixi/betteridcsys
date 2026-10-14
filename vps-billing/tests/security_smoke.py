#!/usr/bin/env python3
"""HTTP-only security regression suite. Uses an explicitly started local demo API.
Run: python3 tests/security_smoke.py --base http://127.0.0.1:8080
No real payments, destructive account changes, or external targets.
"""
import argparse
import concurrent.futures
import http.cookiejar
import json
import os
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid

PARSER = argparse.ArgumentParser()
PARSER.add_argument('--base', default=os.getenv('TEST_BASE_URL', 'http://127.0.0.1:8080'))
PARSER.add_argument('--origin', default=os.getenv('TEST_ORIGIN', ''))
PARSER.add_argument('--customer-email', default=os.getenv('TEST_CUSTOMER_EMAIL', 'demo@aster.local'))
PARSER.add_argument('--customer-password', default=os.getenv('TEST_CUSTOMER_PASSWORD', ''))
PARSER.add_argument('--admin-email', default=os.getenv('TEST_ADMIN_EMAIL', 'admin@aster.local'))
PARSER.add_argument('--admin-password', default=os.getenv('TEST_ADMIN_PASSWORD', ''))
PARSER.add_argument('--second-email', default=os.getenv('TEST_SECOND_EMAIL', ''))
PARSER.add_argument('--second-password', default=os.getenv('TEST_SECOND_PASSWORD', ''))
ARGS, REMAINING = PARSER.parse_known_args()
if urllib.parse.urlparse(ARGS.base).hostname not in ('localhost', '127.0.0.1', '::1'):
    PARSER.error('Only explicit loopback/local servers are permitted')

class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = ''

    def request(self, path, method='GET', body=None, csrf=True, headers=None):
        hdr = {'Accept': 'application/json'}
        if body is not None:
            hdr['Content-Type'] = 'application/json'
        if method != 'GET' and csrf:
            hdr['X-CSRF-Token'] = self.csrf
            hdr['Origin'] = ARGS.origin or ARGS.base
        hdr.update(headers or {})
        req = urllib.request.Request(ARGS.base + path, data=json.dumps(body).encode() if body is not None else None,
                                     method=method, headers=hdr)
        try:
            resp = self.opener.open(req, timeout=10)
        except urllib.error.HTTPError as error:
            resp = error
        raw = resp.read()
        try:
            payload = json.loads(raw)
        except ValueError:
            payload = {'raw': raw.decode(errors='replace')}
        return resp.status, payload, resp.headers

    def session(self):
        status, data, headers = self.request('/api/v1/session')
        assert status == 200, (status, data)
        self.csrf = data['data']['csrf_token']
        return data['data'], headers

    def login(self, email, password):
        self.session()
        result = self.request('/api/v1/auth/login', 'POST', {'email': email, 'password': password})
        assert result[0] == 200, result[:2]
        self.session()
        return self

class SecuritySmoke(unittest.TestCase):
    def setUp(self):
        self.client = Client()

    def customer(self):
        if not ARGS.customer_password:
            self.skipTest('TEST_CUSTOMER_PASSWORD not supplied')
        return Client().login(ARGS.customer_email, ARGS.customer_password)

    def test_unauthenticated_data_and_admin_denied(self):
        for path in ('overview', 'services', 'orders', 'invoices', 'audit', 'admin/overview',
                     'admin/customers', 'admin/orders', 'admin/invoices', 'admin/integrations'):
            with self.subTest(path=path):
                self.assertIn(self.client.request('/api/v1/' + path)[0], (401, 403))

    def test_login_requires_csrf(self):
        self.client.session()
        for token in (None, 'wrong-token'):
            kwargs = {'csrf': False} if token is None else {'headers': {'X-CSRF-Token': token}}
            status, _, _ = self.client.request('/api/v1/auth/login', 'POST',
                {'email': ARGS.customer_email, 'password': ARGS.customer_password}, **kwargs)
            self.assertIn(status, (400, 403))

    def test_customer_admin_boundary(self):
        client = self.customer()
        for path in ('overview', 'customers', 'orders', 'invoices', 'integrations'):
            with self.subTest(path=path):
                self.assertEqual(client.request('/api/v1/admin/' + path)[0], 403)

    def test_origin_and_csrf_on_order(self):
        client = self.customer()
        for headers, csrf in (({'Origin': 'https://attacker.invalid'}, True), ({}, False),
                              ({'X-CSRF-Token': 'wrong'}, True)):
            with self.subTest(headers=headers, csrf=csrf):
                self.assertIn(client.request('/api/v1/orders', 'POST', {'plan_id': 'invalid', 'hostname': 'smoke'},
                    csrf=csrf, headers=headers)[0], (400, 403))

    def test_order_idempotency_price_checkout_and_ownership(self):
        client = self.customer()
        status, payload, _ = client.request('/api/v1/plans')
        self.assertEqual(status, 200)
        plans = [p for p in payload['data'] if p['available']]
        self.assertTrue(plans)
        plan = plans[0]
        key = str(uuid.uuid4())
        body = {'plan_id': plan['id'], 'hostname': 'smoke-' + key[:8]}
        headers = {'Idempotency-Key': key}
        status, created, _ = client.request('/api/v1/orders', 'POST', body, headers=headers)
        self.assertIn(status, (200, 201), created)
        order = created['data']
        self.assertEqual(order['total_minor'], plan['price_minor'])
        status, replayed, _ = client.request('/api/v1/orders', 'POST', body, headers=headers)
        self.assertIn(status, (200, 201), replayed)
        self.assertEqual(replayed['data']['id'], order['id'])
        changed = dict(body, hostname=body['hostname'] + '-other')
        self.assertIn(client.request('/api/v1/orders', 'POST', changed, headers=headers)[0], (409, 422))
        status, arbitrary, _ = client.request('/api/v1/orders', 'POST', dict(body, amount_minor=1, total_minor=1),
            headers={'Idempotency-Key': str(uuid.uuid4())})
        if status in (200, 201):
            self.assertEqual(arbitrary['data']['total_minor'], plan['price_minor'])
        else:
            self.assertIn(status, (400, 422))
        status, payload, _ = client.request('/api/v1/invoices')
        self.assertEqual(status, 200)
        invoice = next(i for i in payload['data'] if i['order_id'] == order['id'])
        self.assertNotEqual(invoice['status'], 'paid')
        path = '/api/v1/invoices/' + invoice['id']
        self.assertEqual(client.request(path + '/checkout', 'POST', {})[0], 503)
        status, after, _ = client.request(path)
        self.assertEqual(status, 200)
        self.assertEqual(after['data']['status'], invoice['status'])
        self.assertFalse(after['data'].get('paid_at'))
        if ARGS.second_email and ARGS.second_password:
            second = Client().login(ARGS.second_email, ARGS.second_password)
            self.assertIn(second.request(path)[0], (403, 404))
            self.assertIn(second.request(path + '/checkout', 'POST', {})[0], (403, 404))
        else:
            print('NOTE: cross-customer ownership not exercised: no second account supplied')

    def test_logout_invalidates_cookie(self):
        client = self.customer()
        cookies = '; '.join(c.name + '=' + c.value for c in client.jar)
        status, _, _ = client.request('/api/v1/auth/logout', 'POST', {})
        self.assertIn(status, (200, 204))
        self.assertIn(client.request('/api/v1/overview')[0], (401, 403))
        fresh = Client()
        self.assertIn(fresh.request('/api/v1/overview', headers={'Cookie': cookies})[0], (401, 403))

    def test_session_cookie_and_login_rotation(self):
        if not ARGS.customer_password:
            self.skipTest('TEST_CUSTOMER_PASSWORD not supplied')
        anon = Client()
        _, headers = anon.session()
        cookie = headers.get('Set-Cookie', '')
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Strict', cookie)
        old = '; '.join(c.name + '=' + c.value for c in anon.jar)
        status, _, _ = anon.request('/api/v1/auth/login', 'POST',
            {'email': ARGS.customer_email, 'password': ARGS.customer_password})
        self.assertEqual(status, 200)
        current = '; '.join(c.name + '=' + c.value for c in anon.jar)
        self.assertNotEqual(old, current)
        stale = Client()
        self.assertIn(stale.request('/api/v1/overview', headers={'Cookie': old})[0], (401, 403))

    def test_admin_read_access(self):
        if not ARGS.admin_password:
            self.skipTest('TEST_ADMIN_PASSWORD not supplied')
        admin = Client().login(ARGS.admin_email, ARGS.admin_password)
        for path in ('overview', 'customers', 'orders', 'invoices', 'integrations'):
            with self.subTest(path=path):
                status, payload, _ = admin.request('/api/v1/admin/' + path)
                self.assertEqual(status, 200, payload)
                self.assertNotIn('password_hash', json.dumps(payload))

    def test_integration_manifest_is_admin_only_readonly_and_redacted(self):
        if not ARGS.admin_password:
            self.skipTest('TEST_ADMIN_PASSWORD not supplied')
        admin = Client().login(ARGS.admin_email, ARGS.admin_password)
        status, payload, _ = admin.request('/api/v1/admin/integrations')
        self.assertEqual(status, 200, payload)
        items = payload['data']['items']
        self.assertTrue(items)
        self.assertEqual(len({i['id'] for i in items}), len(items))
        for item in items:
            self.assertIn(item['kind'], ('payment', 'email'))
            self.assertIn(item['status'], ('disabled', 'ready', 'unavailable'))
            self.assertEqual(item['configuration_mode'], 'environment')
            self.assertNotIn('configuration_values', item)
            self.assertNotIn('config', item)
            for field in item['configuration_fields']:
                self.assertNotIn('value', field)
                self.assertNotIn('default', field)
        self.assertTrue(all(not i['enabled'] for i in items), 'Default demo must not enable live providers')
        status, _, _ = admin.request('/api/v1/admin/integrations', 'POST', {'enabled': True})
        self.assertIn(status, (404, 405))

    def test_concurrent_duplicate_orders(self):
        client = self.customer()
        _, payload, _ = client.request('/api/v1/plans')
        plan = next(p for p in payload['data'] if p['available'])
        key = str(uuid.uuid4())
        cookies = '; '.join(c.name + '=' + c.value for c in client.jar)
        body = {'plan_id': plan['id'], 'hostname': 'parallel-' + key[:8]}
        def submit(_):
            sender = Client()
            sender.csrf = client.csrf
            return sender.request('/api/v1/orders', 'POST', body,
                headers={'Cookie': cookies, 'Idempotency-Key': key})
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(submit, range(6)))
        for status, data, _ in results:
            self.assertIn(status, (200, 201), data)
        self.assertEqual(len({data['data']['id'] for _, data, _ in results}), 1)

    def test_unknown_host_rejected(self):
        status, _, _ = self.client.request('/api/v1/session', headers={'Host': 'attacker.invalid'})
        self.assertIn(status, (400, 403, 421))

if __name__ == '__main__':
    unittest.main(argv=['security_smoke.py'] + REMAINING, verbosity=2)

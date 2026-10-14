#!/usr/bin/env python3
"""Production-mode HTTPS checks on the isolated native CI instance only.

The existing HTTP regression suite is reused with a private test CA. No SSL
verification is disabled; proxy environment variables are never used.
"""
import argparse
import http.client
import importlib.util
import json
import os
from pathlib import Path
import ssl
import sys
import unittest
import urllib.error
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--ca", required=True)
    parser.add_argument("--accounts", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Only an explicit unprivileged localhost port is accepted")
    origin = f"https://localhost:{args.port}"
    accounts = json.loads(Path(args.accounts).read_text())
    for key, role in (("CUSTOMER", "customer"), ("SECOND", "second"), ("ADMIN", "admin")):
        os.environ[f"TEST_{key}_EMAIL"] = f"{role}@native-ci.invalid"
        os.environ[f"TEST_{key}_PASSWORD"] = accounts[role]
    context = ssl.create_default_context(cafile=args.ca)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    original_builder = urllib.request.build_opener

    def isolated_opener(*handlers):
        return original_builder(
            urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context), *handlers
        )

    urllib.request.build_opener = isolated_opener
    original_args = sys.argv
    sys.argv = ["security_smoke.py", "--base", origin, "--origin", origin]
    spec = importlib.util.spec_from_file_location(
        "native_existing_security_smoke", Path(args.project) / "tests/security_smoke.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sys.argv = original_args

    class NativeHTTPSAcceptance(module.SecuritySmoke):
        def test_unknown_host_rejected(self):
            # The real shipped nginx template closes invalid Host requests with
            # 444 before they reach the application's 421 response.
            try:
                status, _, _ = self.client.request(
                    "/api/v1/session", headers={"Host": "attacker.invalid"}
                )
            except (http.client.RemoteDisconnected, urllib.error.URLError):
                return
            self.assertIn(status, (400, 403, 421, 444))

        def test_production_cookie_and_origin(self):
            session, headers = self.client.session()
            self.assertFalse(session["demo_mode"])
            cookie = headers.get("Set-Cookie", "")
            for attribute in ("Secure", "HttpOnly", "SameSite=Strict"):
                self.assertIn(attribute, cookie)
            self.assertIn("max-age=31536000", headers.get("Strict-Transport-Security", ""))

        def test_tls_rejects_untrusted_ca(self):
            opener = original_builder(urllib.request.ProxyHandler({}))
            with self.assertRaises(urllib.error.URLError) as failure:
                opener.open(origin + "/healthz", timeout=5)
            self.assertIsInstance(failure.exception.reason, ssl.SSLCertVerificationError)

        def test_static_csp_deep_link_and_asset(self):
            client = isolated_opener()
            with client.open(origin + "/settings", timeout=5) as response:
                page = response.read().decode()
                self.assertEqual(response.status, 200)
                self.assertIn("default-src 'self'", response.headers["Content-Security-Policy"])
                self.assertIn("script-src 'self'", response.headers["Content-Security-Policy"])
                self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
                self.assertEqual(response.headers["X-Frame-Options"], "DENY")
            import re
            sources = re.findall(r'<script[^>]+src="([^"]+)"', page)
            self.assertTrue(sources)
            for source in sources:
                self.assertTrue(source.startswith("/assets/"))
                with client.open(origin + source, timeout=5) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn("javascript", response.headers["Content-Type"])
                    self.assertIn("script-src 'self'", response.headers["Content-Security-Policy"])

        def test_database_backed_readiness(self):
            for path in ("/healthz", "/readyz"):
                self.assertEqual(self.client.request(path)[0], 200)

    result = unittest.TextTestRunner(verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(NativeHTTPSAcceptance)
    )
    report = {
        "suite": "native-systemd-nginx-tls-http",
        "tests": result.testsRun,
        "failures": len(result.failures),
        "errors": len(result.errors),
        "skipped": len(result.skipped),
        "verified_tls": result.wasSuccessful() and not result.skipped,
        "production_mode": result.wasSuccessful() and not result.skipped,
        "live_providers": False,
    }
    Path(args.report).write_text(json.dumps(report, sort_keys=True, indent=2) + "\n")
    if not result.wasSuccessful() or result.skipped:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

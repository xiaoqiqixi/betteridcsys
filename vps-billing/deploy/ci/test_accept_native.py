#!/usr/bin/env python3
"""Unprivileged guard/loopback transport checks, not native deployment evidence."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import importlib.util
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import unittest


SCRIPT = Path(__file__).with_name("accept-native.sh")
HTTP_SCRIPT = Path(__file__).with_name("accept-native-http.py")
SPEC = importlib.util.spec_from_file_location("native_acceptance_http", HTTP_SCRIPT)
HTTP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HTTP)


class NativeHTTPSTransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix="aster-loopback-tls-")
        cls.addClassCleanup(cls.directory.cleanup)
        root = Path(cls.directory.name)
        cert, key = root / "localhost.pem", root / "localhost.key"
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
            "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost",
            "-keyout", str(key), "-out", str(cert),
        ], check=True, capture_output=True, timeout=15)

        class EchoPeer(BaseHTTPRequestHandler):
            def do_POST(self):
                # A local TLS transport fixture, never an imitation API result.
                payload = json.dumps({
                    "peer": self.client_address[0], "host": self.headers["Host"],
                    "cookie": self.headers.get("Cookie"), "csrf": self.headers.get("X-CSRF-Token"),
                    "body": self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode(),
                }).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        cls.server = HTTPServer(("127.0.0.1", 0), EchoPeer)
        cls.addClassCleanup(cls.server.server_close)
        server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server_context.load_cert_chain(cert, key)
        cls.server.socket = server_context.wrap_socket(cls.server.socket, server_side=True)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.addClassCleanup(cls.thread.join, 5)
        cls.addClassCleanup(cls.server.shutdown)
        cls.port = cls.server.server_port
        cls.context = ssl.create_default_context(cafile=str(cert))

    def test_real_source_peers_and_session_headers_reach_verified_tls_server(self):
        for peer in ("127.0.0.2", "127.0.0.3"):
            with self.subTest(peer=peer):
                status, raw, _ = HTTP.loopback_https_request(
                    self.port, self.context, "/fixture", source=peer, method="POST",
                    headers={"Cookie": "fixture=test-only", "X-CSRF-Token": "test-only"}, body=b"fixture-body",
                )
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(raw), {
                    "peer": peer, "host": f"localhost:{self.port}", "cookie": "fixture=test-only",
                    "csrf": "test-only", "body": "fixture-body",
                })

    def test_untrusted_certificate_is_rejected(self):
        with self.assertRaises(ssl.SSLCertVerificationError):
            HTTP.loopback_https_request(self.port, ssl.create_default_context(), "/fixture")

    def test_disabled_hostname_check_and_non_fixture_source_are_rejected(self):
        context = ssl.create_default_context()
        context.check_hostname = False
        with self.assertRaisesRegex(ValueError, "Verified TLS"):
            HTTP.loopback_https_request(self.port, context, "/fixture")
        with self.assertRaisesRegex(ValueError, "loopback sources"):
            HTTP.loopback_https_request(self.port, self.context, "/fixture", source="192.0.2.1")

    def test_http_port_cli_rejects_privileged_or_duplicate_ports_before_reading_files(self):
        for port in ("80", "443", "4443", "65536"):
            with self.subTest(port=port):
                result = subprocess.run([
                    "python3", str(HTTP_SCRIPT), "--project", "/nonexistent", "--port", "4443",
                    "--http-port", port, "--ca", "/nonexistent", "--accounts", "/nonexistent",
                    "--report", "/nonexistent",
                ], text=True, capture_output=True, timeout=5)
                self.assertEqual(result.returncode, 2)
                self.assertNotIn("Traceback", result.stderr)


class NativeAcceptanceGuardTests(unittest.TestCase):
    def run_guard(self, supplied, arguments=None):
        with tempfile.TemporaryDirectory(prefix="aster-native-guard-") as directory:
            root = Path(directory)
            marker = root / "privileged-command-ran"
            # A guard regression must fail before any privileged command. Never
            # use a fake successful systemd/MySQL result as acceptance evidence.
            sudo = root / "sudo"
            sudo.write_text(f"#!/bin/sh\n: > '{marker}'\nexit 99\n")
            sudo.chmod(0o755)
            env = {"PATH": str(root) + ":" + os.environ["PATH"]}
            env.update(supplied)
            result = subprocess.run(
                ["bash", str(SCRIPT), *(arguments if arguments is not None else [
                    "--allow-isolated-runner", str(root), str(root / "evidence")
                ])],
                env=env, text=True, capture_output=True, timeout=10,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(marker.exists(), result.stdout + result.stderr)
            self.assertFalse((root / "evidence").exists())
            return result.stderr

    def test_no_implicit_host_mutation(self):
        self.assertIn("Explicit isolated-runner", self.run_guard({}, []))

    def test_local_or_self_hosted_is_rejected_before_sudo(self):
        for settings in ({}, {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "self-hosted"}):
            with self.subTest(settings=settings):
                self.assertIn("GitHub-hosted", self.run_guard(settings))

    def test_wrong_repository_is_rejected(self):
        self.assertIn("Unexpected repository", self.run_guard({
            "GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted",
            "GITHUB_REPOSITORY": "another/project",
        }))

    def test_missing_or_malformed_run_identity_is_rejected(self):
        for identity in ("", "../other", "123;false", "not-a-number"):
            with self.subTest(identity=identity):
                self.assertIn("Missing run identity", self.run_guard({
                    "GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted",
                    "GITHUB_REPOSITORY": "xiaoqiqixi/betteridcsys",
                    "GITHUB_RUN_ID": identity, "GITHUB_RUN_ATTEMPT": "1",
                }))


if __name__ == "__main__":
    unittest.main()

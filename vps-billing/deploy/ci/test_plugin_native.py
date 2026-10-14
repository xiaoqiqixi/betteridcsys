#!/usr/bin/env python3
"""Offline guards and real local TLS fixture tests, not systemd acceptance."""
import concurrent.futures
import hashlib
import importlib.util
import os
from pathlib import Path
import smtplib
import ssl
import subprocess
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "plugin-native.sh"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    # dataclass metadata needs its defining module in sys.modules.
    import sys
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


FIXTURE = load("plugin_smtp_loopback_test", HERE / "smtp-loopback-fixture.py")
NATIVE = load("plugin_native_test", HERE / "plugin-native.py")
INSTALLER = load("plugin_native_installer_test", HERE.parent / "scripts/plugin-manager.py")


class PluginNativeGuardTests(unittest.TestCase):
    def guard(self, settings, arguments=None):
        with tempfile.TemporaryDirectory(prefix="aster-plugin-guard-") as directory:
            root = Path(directory)
            marker = root / "sudo-ran"
            sudo = root / "sudo"
            sudo.write_text("#!/bin/sh\n: > '" + str(marker) + "'\nexit 99\n")
            sudo.chmod(0o755)
            environment = {"PATH": str(root) + ":" + os.environ["PATH"], **settings}
            result = subprocess.run(["bash", str(SCRIPT), *(arguments if arguments is not None else
                ["--allow-isolated-runner", str(root), str(root / "evidence")])],
                env=environment, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(marker.exists(), result.stdout + result.stderr)
            self.assertFalse((root / "evidence").exists())
            return result.stderr

    def test_explicit_opt_in_required_before_any_mutation(self):
        self.assertIn("Explicit isolated-runner", self.guard({}, []))

    def test_no_local_or_self_hosted_privileged_execution(self):
        for values in ({}, {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "self-hosted"}):
            with self.subTest(values=values):
                self.assertIn("GitHub-hosted", self.guard(values))

    def test_other_repository_rejected_before_sudo(self):
        self.assertIn("Unexpected repository", self.guard({"GITHUB_ACTIONS": "true",
            "RUNNER_ENVIRONMENT": "github-hosted", "GITHUB_REPOSITORY": "another/project"}))

    def test_malformed_run_identity_rejected_before_sudo(self):
        for value in ("", "../other", "1;false", "arbitrary"):
            with self.subTest(value=value):
                self.assertIn("Missing run identity", self.guard({"GITHUB_ACTIONS": "true",
                    "RUNNER_ENVIRONMENT": "github-hosted", "GITHUB_REPOSITORY": "xiaoqiqixi/betteridcsys",
                    "GITHUB_RUN_ID": value, "GITHUB_RUN_ATTEMPT": "1"}))


class LoopbackSMTPFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix="aster-plugin-tls-")
        cls.addClassCleanup(cls.directory.cleanup)
        cls.root = Path(cls.directory.name)
        cls.certificate, cls.key = cls.root / "localhost.pem", cls.root / "localhost.key"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
            "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost", "-keyout", str(cls.key),
            "-out", str(cls.certificate)], check=True, capture_output=True, timeout=15)

    def setUp(self):
        self.fixture = FIXTURE.LoopbackSMTP(str(self.certificate), str(self.key), "fixture-user", "fixture-password").start()
        self.addCleanup(self.fixture.close)
        self.context = ssl.create_default_context(cafile=str(self.certificate))

    def client(self, context=None):
        return smtplib.SMTP_SSL("localhost", self.fixture.port, timeout=5, context=context or self.context)

    def send(self):
        with self.client() as smtp:
            smtp.login("fixture-user", "fixture-password")
            smtp.sendmail("smtp@native-ci.invalid", "operator@native-ci.invalid",
                          "Subject: Aster SMTP configuration test\r\n\r\nSynthetic fixture only\r\n")

    def test_real_verified_tls_auth_and_fixed_message_counters_without_relay(self):
        self.send()
        report = self.fixture.report()
        self.assertEqual(report["accepted"], 1)
        self.assertEqual(report["authenticated"], 1)
        self.assertEqual(report["relayed_messages"], 0)
        self.assertTrue(report["loopback_only"])
        self.assertFalse(report["message_content_recorded"])
        self.assertEqual(self.fixture.server.server_address[0], "127.0.0.1")

    def test_external_recipient_and_wrong_password_cannot_be_accepted(self):
        with self.client() as smtp:
            smtp.login("fixture-user", "fixture-password")
            with self.assertRaises(smtplib.SMTPRecipientsRefused):
                smtp.sendmail("smtp@native-ci.invalid", "someone@example.com", "Subject: synthetic\r\n\r\nbody")
        with self.client() as smtp:
            with self.assertRaises(smtplib.SMTPAuthenticationError):
                smtp.login("fixture-user", "wrong-password")
        self.assertEqual(self.fixture.report()["accepted"], 0)

    def test_unknown_certificate_is_rejected_by_real_client(self):
        with self.assertRaises(ssl.SSLCertVerificationError):
            self.client(ssl.create_default_context())
        self.assertEqual(self.fixture.report()["authenticated"], 0)

    def test_data_boundary_observable_before_final_reply_for_crash_test(self):
        self.fixture.hold_reply.set()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            sent = pool.submit(self.send)
            self.assertTrue(self.fixture.data_received.wait(3))
            self.assertEqual(self.fixture.report()["accepted"], 1)
            self.assertFalse(sent.done())
            self.fixture.release_reply.set()
            sent.result(timeout=3)


class NativeIndependentPackageTests(unittest.TestCase):
    def test_real_independent_smtp_build_fixture_matches_production_installer_contract(self):
        source = HERE.parents[2]
        with tempfile.TemporaryDirectory(prefix="aster-plugin-package-") as directory:
            package, manifest = NATIVE.fixture_package(source, Path(directory), "1.0.1")
            trust = INSTALLER._Trust(owner=os.geteuid(), ancestor=os.stat("/").st_uid)
            verified = INSTALLER.verify_package(str(package), hashlib.sha256(package.read_bytes()).hexdigest(), trust=trust)
            self.assertEqual(verified.manifest, manifest)
            self.assertEqual(set(verified.files), INSTALLER.FILES)
            self.assertEqual(manifest["version"], "1.0.1")
            self.assertIn(b"never publish", verified.files["README.md"])


if __name__ == "__main__":
    unittest.main()

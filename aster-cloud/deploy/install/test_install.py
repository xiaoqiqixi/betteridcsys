#!/usr/bin/env python3
"""Local installer unit tests. No package/service/network/VM host actions."""
import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import ssl
import stat
import sys
import tempfile
import time
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location("aster_install_unit", Path(__file__).with_name("install.py"))
i = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = i
SPEC.loader.exec_module(i)
p = i.provisioning_module()


class InstallerUnits(unittest.TestCase):
    def test_actual_migration_sql_privileges_include_foreign_key_references(self):
        # Read the real embedded SQL, not a synthetic CREATE fixture. New DDL
        # classes require an explicit grant-policy review instead of silently
        # assuming CREATE alone covers indexes and foreign-key parent access.
        migrations = Path(__file__).resolve().parents[2] / "migrations"
        identity = (migrations / "002_console_identity.sql").read_text()
        self.assertRegex(identity, r"FOREIGN\s+KEY\s*\(user_id\)\s+REFERENCES\s+controller_console_users\s*\(id\)")
        required = set()
        for path in sorted(migrations.glob("[0-9]*.sql")):
            raw = path.read_text()
            if re.search(r"\bCREATE\s+TABLE\b", raw, re.I):
                required.add("CREATE")
            if re.search(r"\bCREATE\s+(?:UNIQUE\s+)?INDEX\b", raw, re.I):
                required.add("INDEX")
            if re.search(r"\bALTER\s+TABLE\b", raw, re.I):
                required.add("ALTER")
            if re.search(r"\bFOREIGN\s+KEY\b[\s\S]*?\bREFERENCES\b", raw, re.I):
                required.add("REFERENCES")
        self.assertIn("REFERENCES", required)
        self.assertLessEqual(required, set(p.MIGRATION_PRIVILEGES))
        self.assertEqual(set(p.RUNTIME_PRIVILEGES), {"SELECT", "INSERT", "UPDATE", "DELETE"})
        self.assertFalse(set(p.RUNTIME_PRIVILEGES) & {"CREATE", "ALTER", "INDEX", "REFERENCES", "DROP", "GRANT OPTION"})

    def certificate(self, sans, before=None, after=None):
        now = time.time()
        return {"subjectAltName": sans,
                "notBefore": time.strftime("%b %d %H:%M:%S %Y GMT", time.gmtime(before or now - 86400)),
                "notAfter": time.strftime("%b %d %H:%M:%S %Y GMT", time.gmtime(after or now + 86400 * 4))}

    @contextlib.contextmanager
    def cert_mocks(self, decoded, pair_error=None):
        with mock.patch.object(i, "protected_read", return_value=b"synthetic public/private PEM"), \
                mock.patch.object(i.ssl, "SSLContext") as ctx, \
                mock.patch.object(i.ssl._ssl, "_test_decode_cert", return_value=decoded):
            if pair_error:
                ctx.return_value.load_cert_chain.side_effect = pair_error
            yield ctx

    def test_certificate_requires_valid_pair_and_exact_san(self):
        with self.cert_mocks(self.certificate((("DNS", "cloud.example.test"),))) as ctx:
            i.validate_certificate("/real.crt", "/private.key", "cloud.example.test")
            ctx.return_value.load_cert_chain.assert_called_once_with("/real.crt", "/private.key")
            with self.assertRaises(i.InstallerError):
                i.validate_certificate("/real.crt", "/private.key", "wrong.example.test")
        with self.cert_mocks(self.certificate((("DNS", "cloud.example.test"),)), ssl.SSLError("MISMATCH")):
            with self.assertRaises(i.InstallerError):
                i.validate_certificate("/real.crt", "/private.key", "cloud.example.test")

    def test_certificate_rejects_expired_not_yet_valid_and_nearly_expired(self):
        now = time.time()
        for before, after in ((now - 86400, now - 1), (now + 10, now + 86400 * 3), (now - 1, now + 3600)):
            with self.subTest(before=before, after=after), self.cert_mocks(self.certificate((("DNS", "cloud.test"),), before, after)):
                with self.assertRaises(i.InstallerError):
                    i.validate_certificate("/crt", "/key", "cloud.test")

    def test_certificate_wildcard_is_one_leftmost_label_and_ip_requires_ip_san(self):
        with self.cert_mocks(self.certificate((("DNS", "*.example.test"), ("IP Address", "192.0.2.8")))):
            i.validate_certificate("/crt", "/key", "cloud.example.test")
            i.validate_certificate("/crt", "/key", "192.0.2.8")
            for host in ("example.test", "a.b.example.test", "other.test", "192.0.2.9"):
                with self.subTest(host=host), self.assertRaises(i.InstallerError):
                    i.validate_certificate("/crt", "/key", host)
        with self.cert_mocks(self.certificate((("DNS", "192.0.2.8"),))):
            with self.assertRaises(i.InstallerError):
                i.validate_certificate("/crt", "/key", "192.0.2.8")

    def test_origin_rejects_systemd_and_url_injection(self):
        for origin in ("https://ok.test\nExecStart=/bin/evil", "https://ok.test/%n", "https://user:password@ok.test", "http://ok.test", "https://ok.test?q=secret", "https://ok.test#secret", "https://ok.test:0"):
            with self.subTest(origin=origin), self.assertRaises(i.InstallerError):
                i.parse_origin(origin)
        self.assertEqual(i.parse_origin("https://cloud.example.test:9443"), ("cloud.example.test", 9443))

    def test_node_has_no_tls_bypass_or_controller_private_identity_probe(self):
        with mock.patch.object(i.ssl, "create_default_context") as context:
            with self.assertRaises(i.InstallerError):
                i.strict_health("node", {}, {})
            context.assert_not_called()
        with mock.patch.object(i.socket, "create_connection") as connect:
            i.node_listener_check({"listen": "0.0.0.0:9443"})
            connect.assert_called_once_with(("127.0.0.1", 9443), timeout=5)

    def test_write_new_respects_exact_mode_despite_umask_and_preserves_existing(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(i, "protected_path", side_effect=lambda p, **_: Path(p)):
            p = Path(directory) / "config.json"
            previous = os.umask(0o077)
            try:
                i.write_new(p, b"original", 0o644)
            finally:
                os.umask(previous)
            self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o644)
            with mock.patch.object(i, "protected_read", side_effect=lambda p, *args: Path(p).read_bytes()):
                i.write_new(p, b"original", 0o644)
                with self.assertRaises(i.InstallerError):
                    i.write_new(p, b"replacement", 0o644)
            self.assertEqual(p.read_bytes(), b"original")

    def test_pending_atomic_state_needs_explicit_resume_and_matching_bundle(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(i, "protected_path", side_effect=lambda p, **_: Path(p)), \
                mock.patch.object(i, "protected_read", side_effect=lambda p, *args: Path(p).read_bytes()):
            state = Path(directory) / "state.json"
            pending = state.with_name("state.new")
            content = {"schema": 1, "component": "controller", "bundle_sha256": "a" * 64, "steps": ["software-installed"]}
            pending.write_text(json.dumps(content))
            args = argparse.Namespace(component="controller", sha256="a" * 64, resume=False)
            with self.assertRaises(i.InstallerError):
                i.recover_pending_state(state, args)
            self.assertTrue(pending.exists())
            args.resume, args.sha256 = True, "b" * 64
            with self.assertRaises(i.InstallerError):
                i.recover_pending_state(state, args)
            self.assertTrue(pending.exists())
            args.sha256 = "a" * 64
            i.recover_pending_state(state, args)
            self.assertEqual(json.loads(state.read_text()), content)
            self.assertFalse(pending.exists())

    def test_invalid_pending_receipt_is_not_deleted_or_promoted(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(i, "protected_read", side_effect=lambda p, *args: Path(p).read_bytes()):
            state = Path(directory) / "state.json"
            pending = state.with_name("state.new")
            pending.write_bytes(b'{"schema":')
            with self.assertRaises(i.InstallerError):
                i.recover_pending_state(state, argparse.Namespace(component="node", sha256="a" * 64, resume=True))
            self.assertEqual(pending.read_bytes(), b'{"schema":')
            self.assertFalse(state.exists())

    def test_main_withholds_oserror_paths_and_secrets(self):
        output = io.StringIO()
        with mock.patch.object(i, "execute", side_effect=OSError("mysql-secret-token /root/private.key")), contextlib.redirect_stderr(output):
            self.assertEqual(i.main(["controller"]), 1)
        self.assertNotIn("mysql-secret-token", output.getvalue())
        self.assertNotIn("/root/private.key", output.getvalue())


if __name__ == "__main__":
    unittest.main(verbosity=2)

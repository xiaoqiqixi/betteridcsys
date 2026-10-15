#!/usr/bin/env python3
"""Unprivileged guard/loopback transport checks, not native deployment evidence."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import ast
import importlib.util
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import tempfile
import threading
from types import SimpleNamespace
import unittest


SCRIPT = Path(__file__).with_name("accept-native.sh")
HTTP_SCRIPT = Path(__file__).with_name("accept-native-http.py")
CORE_SCRIPT = Path(__file__).with_name("core-native.sh")
PREPARE_SCRIPT = Path(__file__).with_name("prepare-native-runner.sh")
CORE_SPEC = importlib.util.spec_from_file_location("core_native_acceptance", CORE_SCRIPT.with_suffix(".py"))
CORE = importlib.util.module_from_spec(CORE_SPEC)
CORE_SPEC.loader.exec_module(CORE)
SPEC = importlib.util.spec_from_file_location("native_acceptance_http", HTTP_SCRIPT)
HTTP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HTTP)


class NativeReleaseModeTests(unittest.TestCase):
    def test_private_extract_modes_are_readable_with_only_approved_executables(self):
        executable = {
            'bin/aster-api', 'bin/aster-plugin-host', 'deploy/scripts/backup-native.sh',
            'deploy/scripts/plugin-manager.py', 'deploy/scripts/update-manager.py',
            'deploy/scripts/core-manager.py',
            'deploy/scripts/core-operation.py',
        }
        files = executable | {'manifests/BUILD.json', 'migrations/001_schema.sql', 'web/index.html', 'licenses/NOTICE'}
        with tempfile.TemporaryDirectory(prefix='aster public release ') as temp:
            root = Path(temp)
            for name in files:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                target.write_text('Public fixture; no credentials.\n')
                target.chmod(0o600)
            for directory in [root, *(p for p in root.rglob('*') if p.is_dir())]:
                directory.chmod(0o700)
            function = re.search(r'^normalize_fixture_release\(\) \{\n.*?^\}', SCRIPT.read_text(), re.M | re.S)
            self.assertIsNotNone(function)
            # Execute the actual normalization using real find/chmod on owned
            # files. The test's sudo function removes privilege only here.
            command = 'set -euo pipefail\nsudo() { [[ $1 == -n ]]; shift; "$@"; }\n' + function.group() + '\nnormalize_fixture_release "$1"\n'
            subprocess.run(['bash', '-c', command, 'mode-test', str(root)], check=True, capture_output=True, text=True, timeout=10)
            for directory in [root, *(p for p in root.rglob('*') if p.is_dir())]:
                self.assertEqual(directory.stat().st_mode & 0o7777, 0o755)
            for name in files:
                self.assertEqual((root / name).stat().st_mode & 0o7777, 0o755 if name in executable else 0o644)


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
    script = SCRIPT

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
                ["bash", str(self.script), *(arguments if arguments is not None else [
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


class CoreExecutorAcceptanceGuardTests(NativeAcceptanceGuardTests):
    script = CORE_SCRIPT


class NativePreparationSmokeGuardTests(unittest.TestCase):
    def test_actual_smoke_response_projection_is_bounded_and_never_echoes_payload(self):
        source = PREPARE_SCRIPT.read_text().split("<<'PYHOOKSMOKE'\n", 1)[1].split("\nPYHOOKSMOKE", 1)[0]
        function = next(node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef) and node.name == "safe_reply_shape")
        namespace = {"json": json}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "actual_smoke_projection", "exec"), namespace)
        project = namespace["safe_reply_shape"]
        hook = project(b'{"type":"a(sasbttttuii)","data":[]}', "ExecStartPre", "aster-test.service")
        self.assertTrue(hook["keys_exact"])
        self.assertEqual(hook["list_length"], 0)
        nested = project(b'{"type":"a(sasbttttuii)","data":[[]]}', "ExecStartPre", "aster-test.service")
        self.assertEqual(nested["nested_single_list_length"], 0)
        identity = project(b'{"type":"s","data":"aster-test.service"}', "unit-id", "aster-test.service")
        self.assertTrue(identity["identity_matches"])
        self.assertEqual(identity["type"], "s")
        self.assertEqual(identity["data_kind"], "string")
        self.assertNotIn("aster-test.service", json.dumps(identity))
        wrapped = project(b'{"type":"s","data":["aster-test.service"]}', "unit-id", "aster-test.service")
        self.assertFalse(wrapped["identity_matches"])
        private = json.dumps({"type": "private-provider-value", "data": ["/private/object/path"], "private-key": "private-password"}).encode()
        result = project(private, "unit-id", "aster-test.service")
        self.assertFalse(result["identity_matches"])
        self.assertFalse(result["keys_exact"])
        self.assertEqual(result["type"], "other_or_absent")
        self.assertNotIn("private", json.dumps(result))
        self.assertEqual(project(b"private-stderr", "unit-id", "aster-test.service"), {"json_valid": False})
        self.assertTrue(project(b"x" * 8193, "unit-id", "aster-test.service")["exceeded_json_bound"])

    def test_actual_inline_smoke_rejects_unowned_context_before_import_or_privilege(self):
        source = PREPARE_SCRIPT.read_text().split("<<'PYHOOKSMOKE'\n", 1)[1].split("\nPYHOOKSMOKE", 1)[0]
        with tempfile.TemporaryDirectory(prefix="aster-hook-smoke-guard-") as directory:
            root = Path(directory)
            marker = root / "privileged-command-ran"
            sudo = root / "sudo"
            sudo.write_text("#!/bin/sh\n: > '" + str(marker) + "'\nexit 99\n")
            sudo.chmod(0o755)
            for settings, reason in (({}, "isolated_runner_required"),
                ({"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "self-hosted", "GITHUB_REPOSITORY": "xiaoqiqixi/betteridcsys"}, "isolated_runner_required"),
                ({"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted", "GITHUB_REPOSITORY": "another/project"}, "isolated_runner_required"),
                ({"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted", "GITHUB_REPOSITORY": "xiaoqiqixi/betteridcsys", "GITHUB_RUN_ID": "../other", "GITHUB_RUN_ATTEMPT": "1"}, "run_identity_required")):
                with self.subTest(settings=settings):
                    result = subprocess.run(["python3", "-I", "-", "/nonexistent/source.py", str(root)], input=source,
                        env={"PATH": str(root) + ":" + os.environ["PATH"], **settings}, capture_output=True, text=True, timeout=5)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(reason, result.stderr)
                    self.assertFalse(marker.exists())
                    self.assertEqual(set(path.name for path in root.iterdir()), {"sudo"})


class CoreExecutorEvidenceSafetyTests(unittest.TestCase):
    def test_selected_unit_diagnostics_only_emit_expected_checks_and_bounded_categories(self):
        spec = {"api_unit": "aster-fixture.service", "instance_root": "/opt/aster-fixture",
                "config_root": "/etc/aster-fixture", "runtime_user": "astfixture"}
        executable = spec["instance_root"] + "/current/bin/aster-api"
        values = {"LoadState": "loaded", "ActiveState": "failed", "SubState": "failed", "Result": "exit-code",
            "FragmentPath": "/etc/systemd/system/" + spec["api_unit"], "DropInPaths": "",
            "User": "astfixture", "Group": "astfixture", "WorkingDirectory": spec["instance_root"] + "/current",
            "ExecStart": "{ path=" + executable + " ; argv[]=" + executable + " ; ignore_errors=no ; }",
            "EnvironmentFiles": spec["config_root"] + "/api.env (ignore_errors=no)",
            "ExecStartPre": "", "ExecStartPost": "", "ExecStop": "", "ExecReload": "",
            "ExecMainCode": "1", "ExecMainStatus": "203", "StatusErrno": "0"}
        report = CORE.selected_unit_diagnostics(spec, "api", values)
        self.assertTrue(all(report["checks"].values()))
        self.assertEqual(report["ExecMainStatus"], 203)
        for key in ("ExecStartPre", "ExecStartPost", "ExecStop", "ExecReload"):
            values.pop(key)
        missing = CORE.selected_unit_diagnostics(spec, "api", values)
        for key in ("ExecStartPre", "ExecStartPost", "ExecStop", "ExecReload"):
            self.assertNotIn(key, missing["properties_present"])
            self.assertNotIn(key + "_empty", missing["checks"])
        self.assertEqual(missing["checks"], report["checks"])
        self.assertTrue(missing["cli_hook_serialization_ignored"])
        self.assertEqual(missing["hook_verification_source"], "systemd-dbus-json")
        values.update(ExecStart="private-command-with-secret", EnvironmentFiles="private-credentials",
                      ActiveState="private-provider-reply", ExecMainStatus="private-password")
        report = CORE.selected_unit_diagnostics(spec, "api", values)
        self.assertFalse(report["checks"]["exec_start_parsed"])
        self.assertFalse(report["checks"]["environment_files_expected"])
        self.assertEqual(report["ActiveState"], "other_or_absent")
        self.assertIsNone(report["ExecMainStatus"])
        self.assertNotIn("private-", json.dumps(report))
        self.assertNotIn(spec["config_root"], json.dumps(report))

    def test_native_diagnostic_wrapper_forwards_results_and_suppresses_exception_bodies(self):
        class Native:
            def __init__(self, spec):
                self.spec = spec
            def service(self, verb, unit):
                return "private-native-result"
            def validate_service(self, release):
                raise RuntimeError("private-command-DSN-password")
            def verify_empty_service_hooks(self):
                return {name: True for name in ("ExecCondition", "ExecStartPre", "ExecStartPost", "ExecStop", "ExecStopPost", "ExecReload")}
        executor = SimpleNamespace(Native=Native, edge_unit=lambda spec: "aster-fixture-edge.service")
        spec = {"operation_id": "d" * 32, "api_unit": "aster-fixture.service"}
        CORE.NATIVE_TRACES.pop(spec["operation_id"], None)
        native = CORE.diagnostic_native(executor)(spec)
        self.assertEqual(native.service("start", spec["api_unit"]), "private-native-result")
        self.assertTrue(all(native.verify_empty_service_hooks().values()))
        with self.assertRaisesRegex(RuntimeError, "private-command"):
            native.validate_service("/private-release")
        trace = CORE.NATIVE_TRACES.pop(spec["operation_id"])
        self.assertEqual(trace["first_failure"], {"substep": "validate-service", "event": "failed", "reason": "failure_details_suppressed"})
        self.assertEqual(trace["typed_service_hooks"], {"source": "systemd-dbus-json", "verified": True})
        self.assertNotIn("private-", json.dumps(trace))

    def test_real_umask_077_keeps_new_public_ancestors_traversable_and_secrets_private(self):
        with tempfile.TemporaryDirectory(prefix="aster-core-umask-") as directory:
            root = Path(directory)
            control, mount, instance = root / "control", root / "socket", root / "instance"
            previous = os.umask(0o077)
            try:
                CORE.create_public_controls(control, mount)
                CORE.create_release_parent(instance)
                private = control / "private"
                private.mkdir(mode=0o700)
                CORE.write(private / "secret", "synthetic-fixture-secret")
            finally:
                os.umask(previous)
            for path in (control, control / "public", mount, instance, instance / "releases"):
                self.assertEqual(path.stat().st_mode & 0o7777, 0o755, str(path))
            self.assertEqual(private.stat().st_mode & 0o7777, 0o700)
            self.assertEqual((private / "secret").stat().st_mode & 0o7777, 0o600)
            # An already prepared public baseline is accepted without mutation.
            CORE.create_release_parent(instance)
            instance.chmod(0o700)
            with self.assertRaises(CORE.AcceptanceFailure):
                CORE.create_release_parent(instance)
            self.assertEqual(instance.stat().st_mode & 0o7777, 0o700)

    def test_failure_diagnostics_emit_fixed_reason_and_metadata_without_exception_body(self):
        with tempfile.TemporaryDirectory(prefix="aster-core-diagnostics-") as directory:
            root = Path(directory)
            control, mount, instance = root / "control", root / "socket", root / "instance"
            CORE.create_public_controls(control, mount)
            CORE.create_release_parent(instance)
            def no_checkpoint():
                raise RuntimeError("private SQL/password/DSN must not escape")
            fixture = SimpleNamespace(root=instance, config=root / "config", state=root / "state", status=no_checkpoint,
                spec={"action": "install", "operation_id": "a" * 32, "status_file": str(control / "public/status.json")})
            resources = SimpleNamespace(control=control, mount=mount, fixtures=[fixture])
            output = CORE.failure_diagnostics(resources, RuntimeError("private SQL/password/DSN must not escape"))
            self.assertEqual(output["reason"], "unclassified_failure_details_suppressed")
            self.assertFalse(output["fixtures"][0]["checkpoint_available"])
            self.assertNotIn("private SQL/password/DSN", json.dumps(output))
            metadata = {row["label"]: row for row in output["fixtures"][0]["path_metadata"]}
            self.assertEqual(metadata["status_parent"]["mode"], "0o755")
            fixed = CORE.failure_diagnostics(resources, RuntimeError("Public status ancestors must be traversable by the non-root API."))
            self.assertEqual(fixed["reason"], "public_status_parent_not_traversable")

    def test_failed_native_command_never_exposes_raw_diagnostics(self):
        with self.assertRaises(CORE.AcceptanceFailure) as failure:
            CORE.command(["python3", "-c", "import sys; print('private-dsn'); print('private-password',file=sys.stderr); sys.exit(17)"])
        self.assertIn("exit 17", str(failure.exception))
        self.assertNotIn("private-dsn", str(failure.exception))
        self.assertNotIn("private-password", str(failure.exception))

    def test_evidence_is_created_without_overwriting_existing_facts(self):
        with tempfile.TemporaryDirectory(prefix="aster-core-facts-") as directory:
            root = Path(directory)
            CORE.fact(root, "fixture", {"checked": True})
            self.assertEqual(json.loads((root / "fixture.json").read_text()), {"checked": True})
            with self.assertRaises(FileExistsError):
                CORE.fact(root, "fixture", {"checked": False})
            self.assertEqual(json.loads((root / "fixture.json").read_text()), {"checked": True})

    def test_noncanonical_fact_name_cannot_escape_evidence_directory(self):
        with tempfile.TemporaryDirectory(prefix="aster-core-facts-") as directory:
            for name in ("../outside", "/absolute", "contains space", "", "secret\nvalue"):
                with self.subTest(name=name), self.assertRaises(CORE.AcceptanceFailure):
                    CORE.fact(directory, name, {})
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()

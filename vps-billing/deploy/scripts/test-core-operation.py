#!/usr/bin/env python3
"""Offline executor tests: protected real files and fake host/database effects.

No subprocess, system identity, systemd unit, database or network is changed.
Official release verification uses the immutable in-memory updater fixtures.
The Python-only trust seam permits tests under an ordinary Unix account.
"""
import contextlib
import copy
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parent


def load(name, path):
    specification = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(specification)
    sys.modules[name] = module
    specification.loader.exec_module(module)
    return module


operation = load("aster_core_operation_under_test", SCRIPTS / "core-operation.py")
fixtures = load("aster_operation_release_fixtures", SCRIPTS / "test-update-manager.py")
updater = operation.updater
CANARY = "SecretCanary_NeverDisplay_7ca4829d"


def snapshot(root):
    result = {}
    for path in sorted(root.rglob("*")):
        info = path.lstat()
        result[str(path.relative_to(root))] = (
            stat.S_IMODE(info.st_mode),
            os.readlink(path) if path.is_symlink() else
            path.read_bytes() if path.is_file() else None,
        )
    return result


class FakeNative:
    """Model fixed effects while the executor owns real journal/link changes."""
    def __init__(self, case):
        self.case, self.events = case, []
        self.active = "active"
        self.migrated = False
        self.fail_migration = False
        self.partial_migration = False
        self.fail_ready = False
        self.fail_start = False
        self.preflight_mutation = None
        self.admin_count = 1
        self.created_identity = False
        self.enabled_units = set()
        self.partial_revokes = False
        self.partial_revokes_after_preflight = None
        self.provision_queries = []

    def run(self, argv, **kwargs):
        self.events.append(("run", tuple(argv)))
        if argv[0] == "/usr/sbin/useradd":
            self.created_identity = True
        return subprocess.CompletedProcess(argv, 0, stdout=b"")

    def sql(self, config, query):
        self.events.append(("sql", "inspect" if query.startswith("SELECT") else "provision"))
        if query.strip() == "SELECT @@partial_revokes;":
            selected = self.partial_revokes if self.partial_revokes_after_preflight is None else self.partial_revokes_after_preflight
            return str(int(selected))
        if query.startswith("SELECT"):
            return "8.4.0\tMySQL Community Server - GPL\t1\t" + str(int(self.partial_revokes)) + "\n0\n0"
        self.provision_queries.append(query)
        return ""

    def service(self, verb, unit=None):
        self.events.append(("service", verb, unit))
        if verb == "stop":
            self.active = "inactive"
        elif verb in {"start", "restart"}:
            if self.fail_start:
                raise updater.Rejected("Fixed start failure")
            self.active = "active"
        elif verb == "enable":
            self.enabled_units.add(unit)
        elif verb == "is-enabled":
            return "enabled" if unit in self.enabled_units else "disabled"
        return self.active if verb == "show" else ""

    def preflight(self, release, environment):
        self.events.append(("preflight", release, copy.deepcopy(environment)))
        facts = operation.prepared_release(release, self.case.trust)
        checksums = dict(facts["migration_checksums"])
        if self.partial_migration:
            checksums.pop(str(len(checksums)))
        empty = self.case.spec["action"] == "install" and not self.migrated
        if empty:
            checksums = {}
        report = {
            "schema": 1, "read_only": True, "configuration_checked": True,
            "core_version": facts["version"], "exit_code": 0,
            "database": {
                "read_only": True, "vendor": "MySQL", "transport": "local-unix-socket",
                "database": self.case.spec["database"], "status": "empty" if empty else "current",
                "table_visibility_verified": True,
                "schema_version": len(checksums),
                "required_schema_version": len(facts["migration_checksums"]),
                "migration_checksums": checksums,
                "pending_migrations": [], "admin_count": self.admin_count,
            },
        }
        if self.partial_migration:
            report["database"]["status"] = "pending_migrations"
        if self.preflight_mutation:
            self.preflight_mutation(report)
        return report

    def api(self, release, environment, command, allow_failure=False):
        self.events.append(("api", command, release, copy.deepcopy(environment)))
        if command == "-migrate":
            self.migrated = True
            if self.fail_migration:
                raise updater.Rejected("Fixed migration failure")
        elif command == "-create-user":
            self.admin_count += 1
        return subprocess.CompletedProcess([command], 0, stdout=b"", stderr=b"")

    def backup(self, old_release, output):
        self.events.append(("backup", old_release, output))
        self.case.backup_files(Path(output), old_release)
        return operation.Native(self.case.spec, self.case.trust).completed_backup(old_release, output)

    def verify_backup(self, saved_evidence, old_release):
        return operation.Native(self.case.spec, self.case.trust).verify_backup(saved_evidence, old_release)

    def edge(self, action):
        self.events.append(("edge", action))

    def process_identity(self, release):
        self.events.append(("process_identity", release))
        return {"verified": True}

    def validate_service(self, release):
        self.events.append(("validate_service", release))
        return {"verified": True}

    def unit_absent(self, unit):
        self.events.append(("unit_absent", unit))
        return True

    def https(self, path):
        self.events.append(("https", path))
        if path.startswith("/api/"):
            return 503, b"maintenance"
        if self.fail_ready:
            raise updater.Rejected("Fixed HTTPS failure")
        if path == "/index.html":
            return 200, (self.case.target / "web/index.html").read_bytes()
        return 200, b"{\"status\":\"ready\"}"


class ExecutorTests(unittest.TestCase):
    def setUp(self):
        previous_umask = os.umask(0o077)
        self.addCleanup(os.umask, previous_umask)
        self.temporary = tempfile.TemporaryDirectory(prefix="aster-core-operation-test-")
        self.base = Path(self.temporary.name)
        self.trust = updater._Trust(os.geteuid(), os.stat("/").st_uid)
        self.instance = self.directory("instance", 0o755)
        self.directory("instance/releases", 0o755)
        self.config = self.directory("config", 0o755)
        self.directory("config/secrets", 0o750)
        self.private = self.directory("private", 0o700)
        self.units = self.directory("units", 0o755)
        self.unit_patch = patch.object(operation, "UNIT_DIRECTORY", str(self.units), create=True)
        self.unit_patch.start()
        self.addCleanup(self.unit_patch.stop)
        self.state = self.base / "state"
        self.old = self.release("0.5.1")
        self.target = self.release("0.5.2")
        self.current = self.instance / "current"
        self.current.symlink_to(self.old, target_is_directory=True)
        self.directory("tools", 0o755)
        for name in ("mysql", "mysqldump", "nginx"):
            self.write("tools/" + name, fixtures.elf(), 0o755)
        self.write("private/certificate", b"Offline certificate fixture\n")
        self.write("private/certificate-key", (CANARY + "\n").encode())
        self.write("private/migrator-dsn", ("aster_migrator:" + CANARY + "@unix(/run/mysqld/mysqld.sock)/aster_test?parseTime=true\n").encode())
        self.write("private/backup.cnf", ("[client]\nuser=aster_backup\npassword=" + CANARY + "\n").encode())
        self.write("config/secrets/mysql_runtime_dsn", ("aster_runtime:" + CANARY + "@unix(/run/mysqld/mysqld.sock)/aster_test?parseTime=true\n").encode(), 0o640)
        self.write("config/secrets/session_secret", (CANARY * 2 + "\n").encode(), 0o640)
        self.spec = {
            "schema": 1, "action": "upgrade", "operation_id": "a" * 32,
            "release_directory": str(self.target), "instance_root": str(self.instance),
            "config_root": str(self.config), "state_directory": str(self.state),
            "origin": "https://billing.example.test", "listen_address": "127.0.0.1:18080",
            "runtime_user": "asttest", "api_unit": "aster-test.service",
            "socket": "/run/mysqld/mysqld.sock", "database": "aster_test",
            "mysql_binary": str(self.base / "tools/mysql"),
            "mysqldump_binary": str(self.base / "tools/mysqldump"),
            "nginx_binary": str(self.base / "tools/nginx"),
            "nginx_sha256": updater.digest(fixtures.elf()), "edge_mode": "managed",
            "edge_listen_address": "127.0.0.1",
            "certificate": str(self.base / "private/certificate"),
            "certificate_key": str(self.base / "private/certificate-key"),
            "migrator_dsn_file": str(self.base / "private/migrator-dsn"),
            "backup_client_config": str(self.base / "private/backup.cnf"),
            "acknowledge_backup_restore_limits": True,
        }
        environment = operation.runtime_environment(self.spec)
        environment.pop("PLUGIN_DIRECTORY")
        environment.pop("PLUGIN_POLICY_FILE")
        self.write("config/api.env", "".join(k + "=" + v + "\n" for k, v in sorted(environment.items())).encode(), 0o640)
        unit = (self.target / "deploy/systemd/aster-api.service").read_text()
        unit = unit.replace("/opt/aster", str(self.instance)).replace("/etc/aster", str(self.config))
        unit = unit.replace("User=aster\n", "User=asttest\n").replace("Group=aster\n", "Group=asttest\n")
        unit = unit.replace("SupplementaryGroups=aster-plugins\n", "")
        self.write("units/" + self.spec["api_unit"], unit.encode(), 0o644)
        self.write("units/" + operation.edge_unit(self.spec), operation.edge_unit_text(self.spec), 0o644)
        self.write("config/nginx.conf", operation.nginx_text(self.spec), 0o644)
        self.spec_path = self.base / "private/spec.json"
        self.save_spec()
        self.native = FakeNative(self)
        self.ssl_patch = patch.object(operation.ssl, "SSLContext")
        self.ssl_patch.start()
        self.addCleanup(self.ssl_patch.stop)
        self.addCleanup(self.temporary.cleanup)

    def directory(self, name, mode=0o700):
        path = self.base / name
        path.mkdir(mode=mode)
        path.chmod(mode)
        return path

    def write(self, name, raw, mode=0o600):
        path = self.base / name
        path.write_bytes(raw)
        path.chmod(mode)
        return path

    def release(self, version):
        fixture = fixtures.Fixture("core", raw=True)
        fixture.version, fixture.tag = version, "v" + version
        protocol = "vps-billing/backend/pkg/pluginapi/protocol.go"
        fixture.source[protocol] = ('package pluginapi\nconst CoreVersion = "' + version + '"\n').encode()
        fixture.build.update(release_label=version,
                             binary_assets=updater.binary_assets("core", version),
                             resources_asset=updater.archive_name("core", version, "raw-binaries-v1"))
        fixture.build["component_versions"]["core"] = version
        fixture.build["input_sha256"][protocol] = updater.digest(fixture.source[protocol])
        for path in list(fixture.build["source_files"]):
            if path.startswith("migrations/"):
                source = fixture.build["source_files"].pop(path)
                fixture.source.pop(source, None)
                fixture.bundle.pop(path)
        for number in (1, 2):
            path = "migrations/" + str(number).zfill(3) + "_fixture.sql"
            source = "vps-billing/backend/" + path
            fixture.source[source] = ("-- Immutable offline migration " + str(number) + "\n").encode()
            fixture.build["source_files"][path] = source
            fixture.bundle[path] = (fixture.source[source], 0o644)
        for name in ("core-manager.py", "core-operation.py"):
            if name == "core-operation.py" and updater.stable(version) < (0, 5, 2):
                continue
            path = "deploy/scripts/" + name
            source = "vps-billing/" + path
            fixture.source.setdefault(source, ("Reviewed offline fixture " + source + "\n").encode())
            fixture.build["source_files"][path] = source
            fixture.bundle[path] = (fixture.source[source], 0o755)
        for name in ("aster-api.service", "aster-smtp.service"):
            path = "deploy/systemd/" + name
            source = "vps-billing/" + path
            fixture.source[source] = (SCRIPTS.parent / "systemd" / name).read_bytes()
            fixture.bundle[path] = (fixture.source[source], 0o644)
        fixture.refresh()
        target = self.instance / "releases" / version
        operation.manager.prepare(version, str(target), api=fixture, trust=self.trust)
        return target

    def save_spec(self):
        self.spec_path.write_bytes(updater.json_bytes(self.spec))
        self.spec_path.chmod(0o600)

    def plan(self):
        return operation.plan(str(self.spec_path), self.trust)

    def execute(self, digest=None, resume=False):
        if digest is None:
            digest = self.plan()["plan_sha256"]
        with patch.object(operation.time, "sleep", return_value=None):
            return operation.execute(str(self.spec_path), digest, resume, self.trust, self.native)

    def journal(self):
        return self.state / self.spec["operation_id"] / "JOURNAL.json"

    def read_journal(self):
        return updater.strict_json(self.journal().read_bytes())

    def reseal(self, root):
        receipt_path = root / operation.manager.RECEIPT
        receipt = updater.strict_json(receipt_path.read_bytes())
        receipt["files_sha256"] = {
            str(path.relative_to(root)): updater.digest(path.read_bytes())
            for path in root.rglob("*") if path.is_file() and path != receipt_path
        }
        receipt_path.write_bytes(updater.json_bytes(receipt))

    def backup_files(self, output, old_release=None):
        if not output.exists():
            output.mkdir(mode=0o700)
        folder = output / "aster-test-verified-backup"
        folder.mkdir(mode=0o700)
        facts = operation.prepared_release(str(self.old) if old_release is None else old_release, self.trust)
        metadata = {
            "schema": 1, "source_commit": facts["source_sha"], "core_version": facts["version"],
            "database": self.spec["database"], "schema_version": len(facts["migration_checksums"]),
            "migration_checksums": facts["migration_checksums"],
        }
        for name, raw in {
                "database.sql.gz": gzip.compress(("-- Synthetic offline SQL\n-- " + CANARY + "\nSELECT 1;\n").encode(), mtime=0),
                "BACKUP.json": updater.json_bytes(metadata),
                "BACKUP.txt": b"Synthetic offline backup. SQL contents and isolated recovery are not verified.\n"}.items():
            path = folder / name
            path.write_bytes(raw)
            path.chmod(0o600)
        self.backup_checksums(folder)
        return folder

    def backup_checksums(self, folder):
        checksums = "".join(updater.digest((folder / name).read_bytes()) + "  " + name + "\n"
                            for name in ("database.sql.gz", "BACKUP.txt", "BACKUP.json"))
        path = folder / "SHA256SUMS"
        path.write_text(checksums)
        path.chmod(0o600)

    def backup_output(self):
        for path in (self.state, self.state / self.spec["operation_id"],
                     self.state / self.spec["operation_id"] / "backups"):
            if not path.exists():
                path.mkdir(mode=0o700)
        return self.state / self.spec["operation_id"] / "backups"

    def plugin_fixture(self, selected="1.1.0", enabled=False):
        root = self.directory("instance/plugins", 0o755)
        self.directory("instance/plugins/email.smtp", 0o755)
        manifests = {}
        for version, maximum in (("1.0.0", "0.5.0"), ("1.1.0", "0.6.0")):
            prefix = "instance/plugins/email.smtp/" + version
            self.directory(prefix, 0o755)
            raw = updater.json_bytes({
                "schema": 1, "id": "email.smtp", "version": version,
                "protocol": "aster.smtp/1", "core_min": "0.4.0",
                "core_max_exclusive": maximum, "capabilities": ["smtp.send"],
                "executable": "plugin", "sha256": updater.digest(fixtures.elf()),
            })
            self.write(prefix + "/manifest.json", raw, 0o644)
            self.write(prefix + "/plugin", fixtures.elf(), 0o755)
            manifests[version] = updater.digest(raw)
        policy = {
            "schema": 1, "revision": 1,
            "smtp": {"enabled": enabled, "id": "email.smtp", "version": selected,
                     "manifest_sha256": manifests[selected], "worker_uid": 11002,
                     "client_uid": 11001, "socket": "/run/aster-plugin/email.smtp.sock",
                     "allowed_targets": [{"host": "mail.example.test", "port": 587}]},
        }
        policy_path = self.write("config/plugins.json", updater.json_bytes(policy), 0o644)
        environment = operation.runtime_environment(self.spec)
        self.write("config/api.env", "".join(key + "=" + value + "\n"
                                            for key, value in sorted(environment.items())).encode(), 0o640)
        return environment, root, policy_path, manifests

    def test_plan_is_read_only_stable_and_canonical(self):
        before = snapshot(self.base)
        with patch("subprocess.run", side_effect=AssertionError("Plan executed a program")), \
                patch("subprocess.Popen", side_effect=AssertionError("Plan executed a program")):
            first, second = self.plan(), self.plan()
        self.assertEqual(first, second)
        canonical = {key: first[key] for key in ("schema", "spec", "inputs")}
        self.assertEqual(first["plan_sha256"], updater.digest(updater.json_bytes(canonical)))
        self.assertEqual(snapshot(self.base), before)
        self.assertNotIn(CANARY, json.dumps(first))

    def test_spec_requires_private_single_link_regular_file(self):
        raw = self.spec_path.read_bytes()
        self.spec_path.chmod(0o644)
        with self.assertRaises(updater.Rejected):
            self.plan()
        self.spec_path.chmod(0o600)
        original = self.private / "original.json"
        self.spec_path.rename(original)
        for link in (lambda: self.spec_path.symlink_to(original), lambda: os.link(original, self.spec_path)):
            link()
            with self.assertRaises(updater.Rejected):
                self.plan()
            self.spec_path.unlink()
        self.spec_path.write_bytes(raw)
        self.spec_path.chmod(0o600)

    def test_spec_duplicate_unknown_and_command_keys_rejected(self):
        original = copy.deepcopy(self.spec)
        for key in ("shell", "url", "service", "command", "migration_sql"):
            self.spec = dict(original, **{key: CANARY})
            self.save_spec()
            with self.subTest(key=key), self.assertRaises(updater.Rejected) as failure:
                self.plan()
            self.assertNotIn(CANARY, str(failure.exception))
        self.spec = original
        self.spec_path.write_bytes(updater.json_bytes(original).replace(b'"schema": 1,', b'"schema": 1, "schema": 1,'))
        with self.assertRaises(updater.Rejected):
            self.plan()

    def test_schema_number_cannot_be_replaced_with_json_boolean(self):
        self.spec["schema"] = True
        self.save_spec()
        with self.assertRaises(updater.Rejected):
            self.plan()

    def test_confirmed_digest_pins_credentials_and_config(self):
        digest = self.plan()["plan_sha256"]
        secret = self.base / "config/secrets/session_secret"
        secret.write_bytes((CANARY * 3 + "\n").encode())
        self.assertNotEqual(self.plan()["plan_sha256"], digest)
        with self.assertRaises(updater.Rejected):
            self.execute(digest)
        self.assertEqual(self.native.events, [])
        self.assertEqual(os.readlink(self.current), str(self.old))
        self.assertFalse((self.config / "maintenance").exists())

    def test_wrong_digest_causes_no_host_actions(self):
        with self.assertRaises(updater.Rejected):
            self.execute("0" * 64)
        self.assertEqual(self.native.events, [])
        self.assertEqual(os.readlink(self.current), str(self.old))

    def test_exact_prepared_inventory_modes_links_and_tamper(self):
        path = self.target / "bin/aster-api"
        raw = path.read_bytes()
        path.write_bytes(CANARY.encode())
        with self.assertRaises(updater.Rejected):
            operation.prepared_release(str(self.target), self.trust)
        path.write_bytes(raw)
        path.chmod(0o644)
        with self.assertRaises(updater.Rejected):
            operation.prepared_release(str(self.target), self.trust)
        path.chmod(0o755)
        original = self.private / "original-api"
        path.rename(original)
        for link in (lambda: path.symlink_to(original), lambda: os.link(original, path)):
            link()
            with self.assertRaises(updater.Rejected):
                operation.prepared_release(str(self.target), self.trust)
            path.unlink()
        path.write_bytes(raw)
        path.chmod(0o755)
        extra = self.target / "extra-secret"
        extra.write_bytes(CANARY.encode())
        extra.chmod(0o644)
        with self.assertRaises(updater.Rejected):
            operation.prepared_release(str(self.target), self.trust)

    def test_source_bound_migration_gap_rejected_even_with_resealed_receipt(self):
        (self.target / "migrations/001_fixture.sql").unlink()
        self.reseal(self.target)
        with self.assertRaises(updater.Rejected):
            operation.prepared_release(str(self.target), self.trust)

    def test_resealed_receipt_cannot_omit_required_source_or_forge_binary_metadata(self):
        build_path = self.target / "manifests/BUILD.json"
        original_build = build_path.read_bytes()
        build = updater.strict_json(original_build)
        path = "deploy/scripts/backup-native.sh"
        original_script = (self.target / path).read_bytes()
        (self.target / path).unlink()
        build["source_files"].pop(path)
        build_path.write_bytes(updater.json_bytes(build))
        self.reseal(self.target)
        with self.assertRaises(updater.Rejected):
            operation.prepared_release(str(self.target), self.trust)
        (self.target / path).write_bytes(original_script)
        (self.target / path).chmod(0o755)
        build = updater.strict_json(original_build)
        build["binary_sha256"]["bin/aster-api"] = "0" * 64
        build_path.write_bytes(updater.json_bytes(build))
        self.reseal(self.target)
        with self.assertRaises(updater.Rejected):
            operation.prepared_release(str(self.target), self.trust)

    def test_unrelated_api_unit_is_rejected_before_any_host_action(self):
        path = self.units / self.spec["api_unit"]
        path.write_bytes(path.read_bytes().replace(b"User=asttest\n", b"User=root\n"))
        with self.assertRaises(updater.Rejected):
            self.plan()
        self.assertEqual(self.native.events, [])

    def test_retained_old_plugin_allows_selected_compatible_version_for_target_core(self):
        environment, _, _, manifests = self.plugin_fixture(selected="1.1.0", enabled=False)
        with patch("subprocess.run", side_effect=AssertionError("Plugin verification executed a program")), \
                patch("subprocess.Popen", side_effect=AssertionError("Plugin verification executed a program")):
            facts = operation.plugin_facts(environment, "0.5.2", self.trust)
            self.assertEqual(self.plan()["inputs"]["plugins"], facts)
        self.assertEqual(facts["manifests"], {"email.smtp/" + version: value
                                              for version, value in manifests.items()})

    def test_selected_incompatible_old_plugin_fails_even_when_disabled(self):
        environment, _, policy_path, _ = self.plugin_fixture(selected="1.0.0", enabled=False)
        policy = updater.strict_json(policy_path.read_bytes())
        for enabled in (False, True):
            policy["smtp"]["enabled"] = enabled
            policy_path.write_bytes(updater.json_bytes(policy))
            with self.subTest(enabled=enabled), self.assertRaises(updater.Rejected) as failure:
                operation.plugin_facts(environment, "0.5.2", self.trust)
            self.assertIs(type(failure.exception), updater.Rejected)
            self.assertNotIn(CANARY, str(failure.exception))

    def test_corrupt_retained_plugin_and_policy_raise_fixed_normalized_errors(self):
        environment, root, policy_path, _ = self.plugin_fixture(selected="1.1.0", enabled=False)
        executable = root / "email.smtp/1.0.0/plugin"
        original = executable.read_bytes()
        executable.write_bytes(CANARY.encode())
        with self.assertRaises(updater.Rejected) as failure:
            operation.plugin_facts(environment, "0.5.2", self.trust)
        self.assertIs(type(failure.exception), updater.Rejected)
        self.assertEqual(str(failure.exception), "Installed plugin policy, integrity or selected-version compatibility verification failed.")
        executable.write_bytes(original)
        policy = updater.strict_json(policy_path.read_bytes())
        policy["smtp"]["worker_uid"] = policy["smtp"]["client_uid"]
        policy["smtp"]["allowed_targets"][0]["host"] = CANARY
        policy_path.write_bytes(updater.json_bytes(policy))
        with self.assertRaises(updater.Rejected) as failure:
            operation.plugin_facts(environment, "0.5.2", self.trust)
        self.assertIs(type(failure.exception), updater.Rejected)
        self.assertEqual(str(failure.exception), "Installed plugin policy, integrity or selected-version compatibility verification failed.")
        self.assertNotIn(CANARY, str(failure.exception))

    def test_effective_service_drops_override_and_root_identity_before_execution(self):
        native = operation.Native(self.spec, self.trust)
        current = str(self.instance / "current")
        executable = current + "/bin/aster-api"
        valid = {
            "LoadState": "loaded", "FragmentPath": str(self.units / self.spec["api_unit"]),
            "DropInPaths": "", "User": "asttest", "Group": "asttest",
            "WorkingDirectory": current,
            "ExecStart": "{ path=" + executable + " ; argv[]=" + executable + " ; ignore_errors=no ; }",
            "EnvironmentFiles": str(self.config / "api.env") + " (ignore_errors=no)",
            "ExecStartPre": "", "ExecStartPost": "", "ExecStop": "", "ExecReload": "",
        }
        account = types.SimpleNamespace(pw_uid=11001, pw_gid=11001)
        hooks = ("ExecStartPre", "ExecStartPost", "ExecStop", "ExecReload")
        def service_account(name):
            return types.SimpleNamespace(pw_uid=33, pw_gid=33) if name == "www-data" else account
        def completed(argv, values):
            selected = dict(values) if self.spec["api_unit"] in argv else {
                "FragmentPath": str(self.units / operation.edge_unit(self.spec)), "DropInPaths": ""}
            # Ubuntu 255 omits empty command arrays without an explicit --all,
            # even when each requested property has its own --property option.
            if "--all" not in argv:
                for hook in hooks:
                    if selected.get(hook) == "":
                        selected.pop(hook)
            return subprocess.CompletedProcess(argv, 0, stdout="".join(k + "=" + v + "\n" for k, v in selected.items()).encode())
        with patch.object(operation.pwd, "getpwnam", side_effect=service_account), \
                patch.object(native, "run", side_effect=lambda argv: completed(argv, valid)) as run:
            self.assertTrue(native.validate_service(str(self.old))["service_configuration_verified"])
        self.assertEqual(len(run.call_args_list), 2)
        self.assertTrue(all("--all" in call.args[0] for call in run.call_args_list))
        invalid = (("DropInPaths", "/etc/override.conf"), ("User", "root"),
                   ("EnvironmentFiles", "/unrelated/api.env")) + tuple((hook, CANARY) for hook in hooks)
        for key, value in invalid:
            changed = dict(valid, **{key: value})
            with self.subTest(key=key), patch.object(operation.pwd, "getpwnam", side_effect=service_account), \
                    patch.object(native, "run", side_effect=lambda argv: completed(argv, changed)), \
                    self.assertRaises(updater.Rejected) as failure:
                native.validate_service(str(self.old))
            self.assertNotIn(CANARY, str(failure.exception))
        for hook in hooks:
            missing = {key: value for key, value in valid.items() if key != hook}
            with self.subTest(missing_hook=hook), patch.object(operation.pwd, "getpwnam", side_effect=service_account), \
                    patch.object(native, "run", side_effect=lambda argv: completed(argv, missing)) as run, \
                    self.assertRaises(updater.Rejected):
                native.validate_service(str(self.old))
            self.assertIn("--all", run.call_args.args[0])
        with patch.object(operation.pwd, "getpwnam", return_value=types.SimpleNamespace(pw_uid=0, pw_gid=0)), \
                patch.object(native, "run") as run, self.assertRaises(updater.Rejected):
            native.validate_service(str(self.old))
        run.assert_not_called()

    def test_healthy_old_listener_cannot_satisfy_candidate_process_identity(self):
        native = operation.Native(self.spec, self.trust)
        with patch.object(native, "run", return_value=subprocess.CompletedProcess([], 0, stdout=b"12345\n")), \
                patch.object(operation.os, "readlink", return_value=str(self.old / "bin/aster-api")), \
                self.assertRaises(updater.Rejected):
            native.process_identity(str(self.target))

    def test_upgrade_success_retains_backup_and_never_bootstraps(self):
        digest = self.plan()["plan_sha256"]
        result = self.execute(digest)
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(os.readlink(self.current), str(self.target))
        self.assertFalse((self.config / "maintenance").exists())
        self.assertEqual([event[1] for event in self.native.events if event[0] == "api"], ["-migrate"])
        self.assertEqual(len([event for event in self.native.events if event[0] == "backup"]), 1)
        self.assertEqual(self.read_journal()["database_migration"], {"started": True, "completed": True})
        self.assertNotIn(CANARY, self.journal().read_text())
        before = copy.deepcopy(self.native.events)
        self.assertEqual(self.execute(digest, resume=True)["status"], "succeeded")
        self.assertEqual(self.native.events, before)
        self.assertEqual(stat.S_IMODE(self.journal().stat().st_mode), 0o600)

    def install_case(self, enable_at_boot, interrupt_configuration=False, conflicting_configuration=False,
                     partial_revokes=False, change_partial_revokes=False):
        self.current.unlink()
        shutil.rmtree(self.config)
        for path in self.units.iterdir():
            path.unlink()
        for key in tuple(operation.UPGRADE_KEYS):
            self.spec.pop(key, None)
        password = self.write("private/bootstrap-password", (CANARY + "_fresh\n").encode())
        dba = self.write("private/dba.cnf", ("[client]\nuser=aster_dba\npassword=" + CANARY + "\n").encode())
        self.spec.update(action="install", dba_client_config=str(dba),
                         bootstrap_email="operator@example.test", bootstrap_name="Offline Operator",
                         bootstrap_password_file=str(password), enable_at_boot=enable_at_boot)
        self.save_spec()
        self.native.active = "inactive"
        self.native.admin_count = 0
        self.native.partial_revokes = partial_revokes
        self.native.partial_revokes_after_preflight = not partial_revokes if change_partial_revokes else None
        account = types.SimpleNamespace(pw_uid=11001, pw_gid=11001)
        def find_account(name):
            if name == "www-data":
                return types.SimpleNamespace(pw_uid=33, pw_gid=33)
            if self.native.created_identity:
                return account
            raise KeyError(name)
        with patch.object(operation.pwd, "getpwnam", side_effect=find_account), \
                patch.object(operation.grp, "getgrnam", side_effect=KeyError("absent")), \
                patch.object(operation.os, "chown"):
            digest = self.plan()["plan_sha256"]
            if change_partial_revokes:
                with self.assertRaises(updater.Rejected):
                    self.execute(digest)
                self.assertEqual(self.native.provision_queries, [])
                self.assertEqual([event[1] for event in self.native.events if event[0] == "sql"], ["inspect", "inspect"])
                self.assertEqual([event for event in self.native.events if event[0] == "api"], [])
                self.assertFalse(self.current.exists())
                return
            if interrupt_configuration:
                original_new_file = operation.new_file
                unit_path = self.units / self.spec["api_unit"]
                interrupted = False
                def interrupted_write(path, *args, **kwargs):
                    nonlocal interrupted
                    original_new_file(path, *args, **kwargs)
                    if path == str(unit_path) and not interrupted:
                        interrupted = True
                        raise OSError("Offline interruption after durable generated-file publication")
                with patch.object(operation, "new_file", side_effect=interrupted_write), \
                        self.assertRaises(updater.Rejected):
                    self.execute(digest)
                self.assertTrue(interrupted)
                journal = self.read_journal()
                self.assertEqual(journal["steps"]["configure"]["status"], "started")
                self.assertTrue(journal["database_migration"]["completed"])
                self.assertEqual(self.native.admin_count, 1)
                self.assertEqual(os.readlink(self.current), str(self.target))
                if conflicting_configuration:
                    unit_path.write_bytes(b"Unexpected generated unit; preserve for operator review.\n")
                    before_file = unit_path.read_bytes()
                    with self.assertRaises(updater.Rejected):
                        self.execute(digest, resume=True)
                    self.assertEqual(unit_path.read_bytes(), before_file)
                    self.assertTrue((self.config / "maintenance").exists())
                    self.assertEqual([event[1] for event in self.native.events if event[0] == "api"], ["-migrate", "-create-user"])
                    self.assertEqual(self.native.admin_count, 1)
                    return
                before_file = unit_path.stat()
                with patch.object(operation, "new_file", wraps=original_new_file) as new_file:
                    result = self.execute(digest, resume=True)
                self.assertNotIn(str(unit_path), [call.args[0] for call in new_file.call_args_list])
                after_file = unit_path.stat()
                self.assertEqual((before_file.st_ino, before_file.st_mtime_ns),
                                 (after_file.st_ino, after_file.st_mtime_ns))
                self.assertEqual(stat.S_IMODE((self.config / "nginx-temp").stat().st_mode), 0o755)
            else:
                result = self.execute(digest)
            before = list(self.native.events)
            self.assertEqual(self.execute(digest, resume=True)["status"], "succeeded")
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(self.native.events, before)
        self.assertEqual([event[1] for event in self.native.events if event[0] == "api"], ["-migrate", "-create-user"])
        self.assertEqual([event[1] for event in self.native.events if event[0] == "sql"], ["inspect", "inspect", "provision"])
        self.assertEqual(len(self.native.provision_queries), 1)
        query = self.native.provision_queries[0]
        database_targets = [line.split(" ON ", 1)[1].split(" TO ", 1)[0]
                            for line in query.splitlines()
                            if line.startswith("GRANT ") and " ON *.* TO " not in line]
        target = "`aster_test`.*" if partial_revokes else r"`aster\_test`.*"
        self.assertEqual(database_targets, [target, target, target])
        self.assertFalse(any("SET GLOBAL" in line.upper() for line in query.splitlines()))
        self.assertIs(self.read_journal()["steps"]["install_preflight"]["result"]["partial_revokes"], partial_revokes)
        self.assertEqual(self.native.admin_count, 1)
        self.assertEqual(os.readlink(self.current), str(self.target))
        self.assertEqual(stat.S_IMODE((self.config / "api.env").stat().st_mode), 0o640)
        self.assertEqual(stat.S_IMODE(self.config.stat().st_mode), 0o755)
        self.assertEqual(stat.S_IMODE((self.config / "secrets").stat().st_mode), 0o750)
        self.assertEqual(stat.S_IMODE((self.config / "nginx-temp").stat().st_mode), 0o755)
        self.assertEqual(stat.S_IMODE((self.instance / "plugins").stat().st_mode), 0o755)
        self.assertNotIn(CANARY, self.journal().read_text())
        units = {self.spec["api_unit"], operation.edge_unit(self.spec)}
        enabled = [event[2] for event in self.native.events if event[:2] == ("service", "enable")]
        checked = [event[2] for event in self.native.events if event[:2] == ("service", "is-enabled")]
        if enable_at_boot:
            self.assertEqual(set(enabled), units)
            self.assertEqual(set(checked), units)
            self.assertEqual(len(enabled), 2)
            self.assertEqual(len(checked), 2)
            for unit in units:
                self.assertTrue((self.units / unit).is_file())
        else:
            self.assertEqual(enabled, [])
            self.assertEqual(checked, [])

    def test_fresh_install_provisions_then_bootstraps_exactly_once(self):
        self.install_case(enable_at_boot=False)

    def test_fresh_install_enables_only_both_generated_units_when_explicit(self):
        self.install_case(enable_at_boot=True)

    def test_interrupted_configuration_resumes_without_overwrite_or_repeating_database_and_admin(self):
        self.install_case(enable_at_boot=False, interrupt_configuration=True)

    def test_interrupted_configuration_refuses_a_changed_generated_file(self):
        self.install_case(enable_at_boot=False, interrupt_configuration=True,
                          conflicting_configuration=True)

    def test_fresh_install_escapes_database_underscore_when_partial_revocations_disabled(self):
        self.install_case(enable_at_boot=False, partial_revokes=False)

    def test_fresh_install_grants_literal_database_when_partial_revocations_enabled(self):
        self.install_case(enable_at_boot=False, partial_revokes=True)

    def test_partial_revocation_mode_change_blocks_database_creation_sql(self):
        self.install_case(enable_at_boot=False, partial_revokes=False, change_partial_revokes=True)

    def test_uncertain_migration_never_reexecutes_or_mutates_schema(self):
        digest = self.plan()["plan_sha256"]
        self.native.fail_migration = True
        self.native.partial_migration = False
        original_api = self.native.api
        def partial(release, environment, command, allow_failure=False):
            if command == "-migrate":
                self.native.partial_migration = True
            return original_api(release, environment, command, allow_failure)
        self.native.api = partial
        with self.assertRaises(updater.Rejected):
            self.execute(digest)
        self.assertEqual(self.read_journal()["status"], "recovery_required")
        self.assertTrue(self.read_journal()["database_migration"]["started"])
        self.assertFalse(self.read_journal()["database_migration"]["completed"])
        self.native.fail_migration = False
        with self.assertRaises(updater.Rejected):
            self.execute(digest, resume=True)
        self.assertEqual([event[1] for event in self.native.events if event[0] == "api"], ["-migrate"])
        self.assertTrue((self.config / "maintenance").exists())

    def test_uncertain_migration_forbids_automatic_rollback_even_when_old_schema_reports_current(self):
        self.native.fail_migration = True
        self.native.partial_migration = False
        with self.assertRaises(updater.Rejected):
            self.execute()
        journal = self.read_journal()
        self.assertEqual(journal["status"], "recovery_required")
        self.assertEqual(journal["database_migration"], {"started": True, "completed": False})
        self.assertNotEqual(journal["program_rollback"], "verified_old_schema")
        self.assertEqual(os.readlink(self.current), str(self.old))
        self.assertTrue((self.config / "maintenance").exists())
        self.assertEqual([event for event in self.native.events if event[:2] == ("service", "start")], [])
        self.assertEqual(self.native.active, "inactive")

    def test_manual_schema_repair_then_verified_resume_clears_stale_rollback_hold(self):
        digest = self.plan()["plan_sha256"]
        original_api = self.native.api
        def interrupted_migration(release, environment, command, allow_failure=False):
            if command == "-migrate":
                self.native.partial_migration = True
                self.native.fail_migration = True
            return original_api(release, environment, command, allow_failure)
        self.native.api = interrupted_migration
        with self.assertRaises(updater.Rejected):
            self.execute(digest)
        held = self.read_journal()
        self.assertEqual(held["status"], "recovery_required")
        self.assertEqual(held["program_rollback"], "blocked_schema_or_readiness")
        self.assertEqual(held["database_migration"], {"started": True, "completed": False})
        self.assertTrue((self.config / "maintenance").exists())
        # Model an independent operator repair; resume only observes this state.
        self.native.partial_migration = False
        self.native.fail_migration = False
        result = self.execute(digest, resume=True)
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["program_rollback"], "none")
        self.assertTrue(result["https_ready"])
        self.assertFalse(result["maintenance"])
        self.assertEqual(os.readlink(self.current), str(self.target))
        self.assertEqual([event[1] for event in self.native.events if event[0] == "api"], ["-migrate"])
        journal = self.read_journal()
        operation.validate_journal(journal)
        self.assertEqual(operation.status(str(self.state), self.spec["operation_id"], self.trust), result)
        before = list(self.native.events)
        self.assertEqual(self.execute(digest, resume=True), result)
        self.assertEqual(self.native.events, before)

    def test_interrupted_migration_can_reconcile_completed_schema_without_repeating(self):
        digest = self.plan()["plan_sha256"]
        self.native.fail_migration = True
        with self.assertRaises(updater.Rejected):
            self.execute(digest)
        journal = self.read_journal()
        # Model a verified current target after interruption, not a new migration.
        journal["status"] = "recovery_required"
        self.journal().write_bytes(updater.json_bytes(journal))
        self.native.fail_migration = False
        result = self.execute(digest, resume=True)
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual([event[1] for event in self.native.events if event[0] == "api"], ["-migrate"])

    def test_migration_intent_is_durable_before_database_effect(self):
        original_api = self.native.api
        observed = []
        def verify_checkpoint(release, environment, command, allow_failure=False):
            journal = self.read_journal()
            observed.append(journal["phase"])
            self.assertEqual(journal["steps"]["migrate"]["status"], "started")
            self.assertTrue(journal["database_migration"]["started"])
            self.assertFalse(journal["database_migration"]["completed"])
            return original_api(release, environment, command, allow_failure)
        self.native.api = verify_checkpoint
        self.execute()
        self.assertEqual(observed, ["migrate"])

    def test_backup_failure_can_only_restore_verified_old_program_and_keeps_maintenance(self):
        digest = self.plan()["plan_sha256"]
        with patch.object(self.native, "backup", side_effect=updater.Rejected("Fixed backup failure")), \
                self.assertRaises(updater.Rejected):
            self.execute(digest)
        journal = self.read_journal()
        self.assertEqual(journal["status"], "rolled_back")
        self.assertEqual(journal["program_rollback"], "verified_old_schema")
        self.assertEqual(os.readlink(self.current), str(self.old))
        self.assertTrue((self.config / "maintenance").exists())
        self.assertFalse(journal["database_migration"]["started"])
        self.assertEqual([event for event in self.native.events if event[0] == "api"], [])
        before = list(self.native.events)
        self.assertEqual(self.execute(digest, resume=True)["status"], "rolled_back")
        self.assertEqual(self.native.events, before)

    def test_real_gzip_backup_is_verified_without_claiming_sql_or_restore_validation(self):
        output = self.backup_output()
        folder = self.backup_files(output)
        native = operation.Native(self.spec, self.trust)
        evidence = native.completed_backup(str(self.old), str(output))
        self.assertEqual(evidence["directory"], str(folder))
        self.assertTrue(evidence["gzip_integrity_verified"])
        self.assertFalse(evidence["database_contents_verified"])
        self.assertFalse(evidence["isolated_restore_verified"])
        self.assertEqual(native.verify_backup(evidence, str(self.old)), evidence)

    def test_real_backup_corruption_missing_members_and_checksum_mutations_are_rejected(self):
        output = self.backup_output()
        native = operation.Native(self.spec, self.trust)
        for mutation in ("corrupt_sql", "truncated_gzip_resealed", "concatenated_gzip_resealed",
                         "missing_metadata", "extra_member", "missing_checksum", "duplicate_checksum"):
            folder = self.backup_files(output)
            sql = folder / "database.sql.gz"
            sums = folder / "SHA256SUMS"
            if mutation == "corrupt_sql":
                sql.write_bytes(sql.read_bytes() + CANARY.encode())
            elif mutation == "truncated_gzip_resealed":
                sql.write_bytes(sql.read_bytes()[:-5])
                self.backup_checksums(folder)
            elif mutation == "concatenated_gzip_resealed":
                sql.write_bytes(sql.read_bytes() + gzip.compress(b"SELECT 2;\n", mtime=0))
                self.backup_checksums(folder)
            elif mutation == "missing_metadata":
                (folder / "BACKUP.json").unlink()
            elif mutation == "extra_member":
                (folder / "extra-secret").write_bytes(CANARY.encode())
            elif mutation == "missing_checksum":
                sums.write_text("\n".join(sums.read_text().splitlines()[:-1]) + "\n")
            else:
                sums.write_text(sums.read_text() + sums.read_text().splitlines()[0] + "\n")
            with self.subTest(mutation=mutation), self.assertRaises(updater.Rejected) as failure:
                native.completed_backup(str(self.old), str(output))
            self.assertNotIn(CANARY, str(failure.exception))
            shutil.rmtree(folder)

    def test_resealed_backup_metadata_must_match_old_database_source_and_complete_schema(self):
        output = self.backup_output()
        native = operation.Native(self.spec, self.trust)
        for mutation in ("database", "source_commit", "core_version", "migration_checksums", "schema_prefix"):
            folder = self.backup_files(output)
            path = folder / "BACKUP.json"
            metadata = updater.strict_json(path.read_bytes())
            if mutation == "database":
                metadata["database"] = "another_database"
            elif mutation == "source_commit":
                metadata["source_commit"] = "f" * 40
            elif mutation == "core_version":
                metadata["core_version"] = "0.0.1"
            elif mutation == "migration_checksums":
                metadata["migration_checksums"]["1"] = "f" * 64
            else:
                metadata["schema_version"] = 1
                metadata["migration_checksums"].pop("2")
            path.write_bytes(updater.json_bytes(metadata))
            self.backup_checksums(folder)
            with self.subTest(mutation=mutation), self.assertRaises(updater.Rejected):
                native.completed_backup(str(self.old), str(output))
            shutil.rmtree(folder)

    def test_saved_backup_evidence_rejects_replacement_even_when_new_gzip_and_checksums_are_valid(self):
        output = self.backup_output()
        folder = self.backup_files(output)
        native = operation.Native(self.spec, self.trust)
        saved = native.completed_backup(str(self.old), str(output))
        (folder / "database.sql.gz").write_bytes(gzip.compress(b"-- Different valid backup\nSELECT 2;\n", mtime=0))
        self.backup_checksums(folder)
        native.completed_backup(str(self.old), str(output))
        with self.assertRaises(updater.Rejected):
            native.verify_backup(saved, str(self.old))

    def test_tamper_between_fresh_backup_and_migration_blocks_database_effects(self):
        original = self.native.backup
        def changed_backup(old_release, output):
            evidence = original(old_release, output)
            (Path(evidence["directory"]) / "database.sql.gz").write_bytes(b"Corrupted after checkpoint")
            return evidence
        self.native.backup = changed_backup
        digest = self.plan()["plan_sha256"]
        with self.assertRaises(updater.Rejected):
            self.execute(digest)
        self.assertFalse(self.read_journal()["database_migration"]["started"])
        self.assertEqual([event for event in self.native.events if event[0] == "api"], [])
        self.assertEqual(os.readlink(self.current), str(self.old))
        with self.assertRaises(updater.Rejected):
            self.execute(digest, resume=True)

    def test_tampered_backup_blocks_terminal_resume_before_success_claim(self):
        digest = self.plan()["plan_sha256"]
        self.execute(digest)
        saved = self.read_journal()["steps"]["backup"]["result"]
        (Path(saved["directory"]) / "BACKUP.json").unlink()
        before = list(self.native.events)
        with self.assertRaises(updater.Rejected):
            self.execute(digest, resume=True)
        self.assertEqual(self.native.events, before)

    def test_schema_does_not_treat_exit_zero_as_current(self):
        facts = operation.prepared_release(str(self.target), self.trust)
        report = self.native.preflight(str(self.target), {})
        for mutation in (
                lambda value: value["database"].update(status="pending_migrations"),
                lambda value: value["database"].update(migration_checksums={}),
                lambda value: value["database"].update(database="other_database"),
                lambda value: value["database"].update(table_visibility_verified=False),
                lambda value: value.update(core_version="0.0.0")):
            changed = copy.deepcopy(report)
            mutation(changed)
            with self.assertRaises(updater.Rejected):
                operation.schema(changed, facts, self.spec["database"], {"current"})

    def test_current_link_refuses_unexpected_target_and_existing_directory(self):
        self.current.unlink()
        self.current.mkdir(mode=0o755)
        with self.assertRaises(updater.Rejected):
            operation.set_current(self.spec, str(self.target), str(self.old), self.trust)
        self.current.rmdir()
        self.current.symlink_to(self.target)
        with self.assertRaises(updater.Rejected):
            operation.set_current(self.spec, str(self.old), str(self.old), self.trust)
        self.assertEqual(os.readlink(self.current), str(self.target))

    def test_operation_lock_rejects_concurrency_and_unsafe_files(self):
        self.state.mkdir(mode=0o700)
        fd = updater.protected_open(str(self.state), True, self.trust, True)
        try:
            with operation.operation_lock(fd, self.trust):
                with self.assertRaises(updater.Rejected):
                    self.execute()
            lock = self.state / ".operation.lock"
            lock.chmod(0o666)
            with self.assertRaises(updater.Rejected):
                self.execute()
            self.assertEqual(self.native.events, [])
        finally:
            os.close(fd)

    def test_instance_lock_covers_different_private_state_directories(self):
        fd = updater.protected_open(str(self.instance), True, self.trust)
        try:
            with operation.operation_lock(fd, self.trust):
                self.spec["state_directory"] = str(self.base / "different-state")
                self.save_spec()
                with self.assertRaises(updater.Rejected):
                    self.execute()
            self.assertEqual(self.native.events, [])
            self.assertEqual(os.readlink(self.current), str(self.old))
        finally:
            os.close(fd)

    def test_terminal_resume_rechecks_current_and_confirmed_secret(self):
        digest = self.plan()["plan_sha256"]
        self.execute(digest)
        before = list(self.native.events)
        self.current.unlink()
        self.current.symlink_to(self.old)
        with self.assertRaises(updater.Rejected):
            self.execute(digest, resume=True)
        self.current.unlink()
        self.current.symlink_to(self.target)
        (self.config / "secrets/session_secret").write_bytes(b"ChangedAfterConfirmation_abcdef0123456789\n")
        with self.assertRaises(updater.Rejected):
            self.execute(digest, resume=True)
        self.assertEqual(self.native.events, before)

    def test_unknown_or_mismatched_journal_cannot_resume(self):
        digest = self.plan()["plan_sha256"]
        self.execute(digest)
        journal = self.read_journal()
        for change in ({"status": "invented"}, {"operation_id": "b" * 32}, {"action": "install"}):
            self.journal().write_bytes(updater.json_bytes(dict(journal, **change)))
            with self.subTest(change=change), self.assertRaises(updater.Rejected):
                self.execute(digest, resume=True)

    def test_success_receipt_requires_consistent_journal_state(self):
        digest = self.plan()["plan_sha256"]
        self.execute(digest)
        journal = self.read_journal()
        journal["database_migration"] = {"started": False, "completed": False}
        journal["steps"] = {}
        self.journal().write_bytes(updater.json_bytes(journal))
        with self.assertRaises(updater.Rejected):
            self.execute(digest, resume=True)

    def test_status_rejects_forged_or_unknown_journal(self):
        self.state.mkdir(mode=0o700)
        directory = self.state / self.spec["operation_id"]
        directory.mkdir(mode=0o700)
        self.journal().write_bytes(updater.json_bytes({"schema": 1, "operation_id": self.spec["operation_id"], "status": "succeeded"}))
        self.journal().chmod(0o600)
        with self.assertRaises(updater.Rejected):
            operation.status(str(self.state), self.spec["operation_id"], self.trust)

    def test_digest_mismatch_does_not_create_operation_state(self):
        before = snapshot(self.base)
        with self.assertRaises(updater.Rejected):
            self.execute("0" * 64)
        self.assertEqual(snapshot(self.base), before)

    def test_native_runner_clears_ambient_env_and_suppresses_secret_diagnostics(self):
        native = operation.Native(self.spec, self.trust)
        observed = {}
        def child(argv, **kwargs):
            observed.update(argv=argv, **kwargs)
            return types.SimpleNamespace(poll=lambda: 1, returncode=1, pid=999999)
        with patch.dict(os.environ, {"MYSQL_DSN": CANARY, "BOOTSTRAP_PASSWORD": CANARY,
                                    "HTTP_PROXY": CANARY, "LD_PRELOAD": CANARY}), \
                patch.object(operation.subprocess, "Popen", side_effect=child), \
                self.assertRaises(updater.Rejected) as failure:
            native.run(["/usr/bin/systemctl", "show", "aster-test.service"])
        self.assertNotIn(CANARY, str(failure.exception))
        self.assertNotIn(CANARY, json.dumps(observed["env"]))
        self.assertIs(observed["stderr"], subprocess.DEVNULL)
        self.assertTrue(observed["close_fds"])

    def test_native_timeout_diagnostic_does_not_echo_argv_or_output(self):
        native = operation.Native(self.spec, self.trust)
        process = types.SimpleNamespace(poll=lambda: None, returncode=None, pid=999999, wait=lambda: None)
        with patch.object(operation.subprocess, "Popen", return_value=process), \
                patch.object(operation.time, "monotonic", side_effect=(0, 2)), \
                patch.object(operation.os, "killpg") as terminate, \
                self.assertRaises(updater.Rejected) as failure:
            native.run(["/usr/bin/systemctl", "show", "aster-test.service"], timeout=1)
        self.assertNotIn(CANARY, str(failure.exception))
        terminate.assert_called_once()

    def test_native_output_is_bounded_before_reading_into_memory(self):
        native = operation.Native(self.spec, self.trust)
        def child(argv, **kwargs):
            kwargs["stdout"].write(b"X" * ((4 << 20) + 1))
            kwargs["stdout"].flush()
            return types.SimpleNamespace(poll=lambda: 0, returncode=0, pid=999999)
        with patch.object(operation.subprocess, "Popen", side_effect=child), \
                self.assertRaises(updater.Rejected):
            native.run(["/usr/bin/systemctl", "show", "aster-test.service"])

    def test_runtime_preflight_uses_runtime_identity_and_migrator_stays_separate(self):
        native = operation.Native(self.spec, self.trust)
        environment = operation.read_environment(str(self.config / "api.env"), self.trust)[0]
        with patch.object(native, "run", return_value=subprocess.CompletedProcess([], 0, stdout=b"")) as run:
            native.api(str(self.target), environment, "-preflight")
            self.assertEqual(run.call_args.kwargs["identity"], self.spec["runtime_user"])
            migrator = dict(environment, MYSQL_DSN_FILE=self.spec["migrator_dsn_file"])
            native.api(str(self.target), migrator, "-preflight")
            self.assertIsNone(run.call_args.kwargs["identity"])
        with patch.object(native, "run", side_effect=AssertionError("Unknown command executed")), \
                self.assertRaises(updater.Rejected):
            native.api(str(self.target), environment, "-reset-admin")

    def test_environment_file_never_evaluates_shell_or_inline_secrets(self):
        path = self.config / "api.env"
        original = path.read_bytes()
        for line in ("MYSQL_DSN=" + CANARY, "APP_ORIGIN=$(touch /tmp/aster-must-never-exist)",
                     "APP_ORIGIN=`id`", "export APP_MODE=production", "APP_ORIGIN='https://example.test'"):
            path.write_bytes(original + (line + "\n").encode())
            with self.subTest(line=line), self.assertRaises(updater.Rejected) as failure:
                operation.read_environment(str(path), self.trust)
            self.assertNotIn(CANARY, str(failure.exception))

    def test_dsn_refuses_tcp_other_socket_and_other_database(self):
        path = Path(self.spec["migrator_dsn_file"])
        for value in ("aster:x@tcp(127.0.0.1:3306)/aster_test?parseTime=true",
                      "aster:x@unix(/run/other.sock)/aster_test?parseTime=true",
                      "aster:x@unix(/run/mysqld/mysqld.sock)/other?parseTime=true"):
            path.write_text(value)
            with self.assertRaises(updater.Rejected):
                operation.dsn_target(str(path), self.spec, self.trust, True)

    def test_status_is_read_only_and_omits_private_paths(self):
        self.execute()
        before = snapshot(self.base)
        value = operation.status(str(self.state), self.spec["operation_id"], self.trust)
        self.assertEqual(value["status"], "succeeded")
        self.assertEqual(snapshot(self.base), before)
        self.assertNotIn(str(self.base), json.dumps(value))
        self.assertNotIn(CANARY, json.dumps(value))

    def test_cli_keeps_root_requirement_and_no_relaxed_trust_options(self):
        output = io.StringIO()
        with patch.object(operation.os, "geteuid", return_value=12345), contextlib.redirect_stderr(output):
            self.assertEqual(operation.main(["plan", "--spec", str(self.spec_path)]), 1)
        self.assertIn("root", output.getvalue())
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            operation.main(["plan", "--spec", str(self.spec_path), "--trust-owner", "12345"])


if __name__ == "__main__":
    unittest.main()

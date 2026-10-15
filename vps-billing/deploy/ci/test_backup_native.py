#!/usr/bin/env python3
"""Run the real fake-database backup suite with isolated scanner availability."""
import errno
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/test-backup-native.sh"
BACKUP = SCRIPT.with_name("backup-native.sh")


class BackupStagingPermissionsTest(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="aster-backup-staging-")
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.staging = self.root / "new-staging"
        self.staging.mkdir(mode=0o700)
        source = BACKUP.read_text().split('if ! python3 - "$staging" 2>/dev/null <<\'PY\'\n', 1)[1].split("\nPY\nthen", 1)[0]
        self.guard = compile(source, str(BACKUP), "exec")

    def run_guard(self, path=None):
        with patch.object(sys, "argv", [str(BACKUP), str(path or self.staging)]):
            exec(self.guard, {})

    def test_actual_owned_directory_stays_private_without_requiring_acl_support(self):
        self.run_guard()
        self.assertEqual(stat.S_IMODE(self.staging.stat().st_mode), 0o700)
        try:
            os.getxattr(self.staging, "system.posix_acl_default")
        except OSError as failure:
            self.assertIn(failure.errno, {errno.ENODATA, errno.EOPNOTSUPP})
        else:
            self.fail("Default ACL remained after the staging guard")

    def test_inherited_acl_is_removed_and_verified_through_the_open_descriptor(self):
        inherited = {"default": b"synthetic-default-acl"}
        calls = []
        expected = self.staging.stat()
        def remove(descriptor, name):
            self.assertIsInstance(descriptor, int)
            info = os.fstat(descriptor)
            self.assertEqual((info.st_dev, info.st_ino), (expected.st_dev, expected.st_ino))
            self.assertEqual(name, "system.posix_acl_default")
            calls.append("remove")
            del inherited["default"]
        def read(descriptor, name):
            self.assertIsInstance(descriptor, int)
            self.assertEqual(name, "system.posix_acl_default")
            calls.append("verify")
            self.assertNotIn("default", inherited)
            raise OSError(errno.ENODATA, "synthetic absence")
        with patch.object(os, "removexattr", side_effect=remove), patch.object(os, "getxattr", side_effect=read):
            self.run_guard()
        self.assertEqual(calls, ["remove", "verify"])

    def test_only_documented_absence_or_unsupported_errors_are_tolerated(self):
        for absent in (errno.ENODATA, errno.EOPNOTSUPP):
            with self.subTest(errno=absent), patch.object(os, "removexattr", side_effect=OSError(absent, "synthetic absence")), patch.object(os, "getxattr", side_effect=OSError(absent, "synthetic absence")):
                self.run_guard()
        for operation in ("removexattr", "getxattr"):
            for denied in (errno.EACCES, errno.EPERM, errno.EIO):
                with self.subTest(operation=operation, errno=denied), patch.object(os, "removexattr"), patch.object(os, "getxattr"), patch.object(os, "fchmod") as chmod, patch.object(os, "fsync") as sync:
                    with patch.object(os, operation, side_effect=OSError(denied, "private diagnostic must not escape")), self.assertRaises(SystemExit) as failure:
                        self.run_guard()
                    self.assertEqual(failure.exception.code, 1)
                    chmod.assert_not_called()
                    sync.assert_not_called()

    def test_permission_or_durability_failures_cannot_pass_the_guard(self):
        for operation in ("fchmod", "fsync"):
            with self.subTest(operation=operation), patch.object(os, "removexattr"), patch.object(os, "getxattr", side_effect=OSError(errno.ENODATA, "synthetic absence")):
                with patch.object(os, operation, side_effect=OSError(errno.EIO, "private failure")) as failed, self.assertRaises(SystemExit) as failure:
                    self.run_guard()
                self.assertEqual(failure.exception.code, 1)
                failed.assert_called_once()

    def test_present_acl_even_empty_is_rejected_and_descriptor_is_closed(self):
        for value in (b"", b"synthetic-default-acl"):
            descriptors = []
            def read(descriptor, name):
                descriptors.append(descriptor)
                return value
            with self.subTest(value=value), patch.object(os, "removexattr"), patch.object(os, "getxattr", side_effect=read), self.assertRaises(SystemExit):
                self.run_guard()
            with self.assertRaises(OSError):
                os.fstat(descriptors[0])

    def test_unexpected_owner_permissions_links_and_non_directories_are_rejected(self):
        for uid, mode in ((os.geteuid() + 1, 0o40700), (os.geteuid(), 0o40750), (os.geteuid(), 0o42700), (os.geteuid(), 0o44700)):
            with self.subTest(uid=uid, mode=mode), patch.object(os, "fstat", return_value=SimpleNamespace(st_uid=uid, st_mode=mode)), patch.object(os, "removexattr") as remove, self.assertRaises(SystemExit):
                self.run_guard()
            remove.assert_not_called()
        link = self.root / "link"
        link.symlink_to(self.staging, target_is_directory=True)
        regular = self.root / "regular"
        regular.write_bytes(b"synthetic owned fixture")
        for path in (link, regular):
            with self.subTest(path=path.name), self.assertRaises(SystemExit):
                self.run_guard(path)

    def test_guard_failure_is_redacted_cleans_staging_and_never_reaches_database(self):
        tools = self.root / "bin"
        tools.mkdir()
        for name in ("mysql", "mysqldump"):
            path = tools / name
            path.write_text('#!/bin/sh\nprintf database-called > "' + str(self.root / "unexpected-call") + '"\nexit 1\n')
            path.chmod(0o700)
        python = tools / "python3"
        python.write_text("#!/bin/sh\nprintf 'private-path-and-error-must-not-escape\\n' >&2\nexit 71\n")
        python.chmod(0o700)
        # Match the existing shell suite's conventional root-owned / and /tmp
        # fixture; this sandbox maps those owners to nobody. All owned paths
        # and modes still use real metadata, and production checks stay strict.
        real_stat = shutil.which("stat")
        self.assertIsNotNone(real_stat)
        probe = tools / "stat"
        probe.write_text('#!/bin/bash\npath=${!#}\nif [[ $1 == -c && $2 == %u && ( "$path" == / || "$path" == /tmp ) ]]; then\n  printf "0\\n"\nelse\n  exec ' + repr(real_stat) + ' "$@"\nfi\n')
        probe.chmod(0o700)
        config = self.root / "client.cnf"
        config.write_text("[client]\nuser=fixture\npassword=fixture-not-a-real-secret\n")
        config.chmod(0o600)
        output = self.root / "output"
        output.mkdir(mode=0o700)
        release = self.root / "release"
        release.mkdir()
        result = subprocess.run(["bash", str(BACKUP), "--client-config", str(config), "--socket", str(self.root / "unused.sock"),
            "--database", "fixture", "--output-dir", str(output), "--release-directory", str(release)],
            env=dict(os.environ, PATH=str(tools) + ":" + os.environ["PATH"]), text=True, capture_output=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "Backup failed: New backup staging directory could not be made private.\n")
        self.assertEqual(list(output.iterdir()), [])
        self.assertFalse((self.root / "unexpected-call").exists())


class BackupScannerTest(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="aster-backup-scanner-")
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.temp = self.root / "tmp"
        self.temp.mkdir()
        self.grep = shutil.which("grep")
        self.assertIsNotNone(self.grep)
        for name in ("bash", "env", "dirname", "mktemp", "rm", "mkdir", "cat", "chmod", "gzip", "mv", "sha256sum", "stat", "find", "wc", "cp", "ln", "realpath", "date", "grep", "cmp", "python3"):
            target = shutil.which(name)
            self.assertIsNotNone(target, name)
            (self.bin / name).symlink_to(target)
        self.env = dict(os.environ, PATH=str(self.bin), TMPDIR=str(self.temp))

    def scanner(self, body):
        path = self.bin / "grep"
        path.unlink()
        path.write_text("#!/bin/bash\n" + body + "\n")
        path.chmod(0o700)

    def run_suite(self):
        result = subprocess.run([str(self.bin / "bash"), str(SCRIPT)], env=self.env, text=True, capture_output=True, timeout=60)
        self.assertEqual(list(self.temp.iterdir()), [])
        self.assertNotIn("fixture-not-a-real-secret", result.stdout + result.stderr)
        self.assertNotIn("fixture-private-diagnostic-do-not-log", result.stdout + result.stderr)
        return result

    def test_suite_runs_real_scans_without_ripgrep_installed(self):
        self.assertIsNone(shutil.which("rg", path=self.env["PATH"]))
        result = self.run_suite()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS: read-only private config accepted", result.stdout)

    def test_missing_grep_stops_before_any_pass(self):
        (self.bin / "grep").unlink()
        result = self.run_suite()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("scanner grep is unavailable", result.stderr)
        self.assertNotIn("PASS:", result.stdout)

    def test_scanner_error_or_missing_executable_status_cannot_pass(self):
        for status in (2, 127):
            with self.subTest(status=status):
                self.scanner(f"exit {status}")
                result = self.run_suite()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"scanner failed (exit {status})", result.stderr)
                self.assertNotIn("PASS:", result.stdout)

    def test_actual_marker_in_command_capture_is_detected_without_echo(self):
        # Inject a synthetic marker into the suite's own fake mysqldump argv
        # capture, then execute the real scanner over the complete directories.
        self.scanner('printf "%s\\n" "fixture-not-a-real-secret" > "${!#}/injected-marker"\nexec ' + repr(self.grep) + ' "$@"')
        result = self.run_suite()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("private diagnostic or credential leaked", result.stderr)
        self.assertNotIn("PASS:", result.stdout)


if __name__ == "__main__":
    unittest.main()

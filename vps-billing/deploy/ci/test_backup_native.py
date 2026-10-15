#!/usr/bin/env python3
"""Run the real fake-database backup suite with isolated scanner availability."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/test-backup-native.sh"


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

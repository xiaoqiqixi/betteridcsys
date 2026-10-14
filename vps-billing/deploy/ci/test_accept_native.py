#!/usr/bin/env python3
"""Unprivileged guard regressions; do not simulate a successful native deploy."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("accept-native.sh")


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

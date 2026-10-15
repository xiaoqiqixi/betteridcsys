#!/usr/bin/env python3
"""Offline payment acceptance guards and real synthetic package contract tests.

These tests compile/run only the fixture's --version command. They never start a
payment service, change OS identities, run privileged actions, or move money.
"""
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


NATIVE = load("payment_native_offline", HERE / "payment-native.py")
INSTALLER = load("payment_native_manager", HERE.parent / "scripts/plugin-manager.py")
UPDATER = load("payment_native_updater", HERE.parent / "scripts/update-manager.py")


class PaymentNativeGuards(unittest.TestCase):
    def test_missing_opt_in_or_non_hosted_environment_reject_before_output_creation(self):
        with tempfile.TemporaryDirectory(prefix="aster-payment-guard-") as directory:
            output = Path(directory) / "evidence"
            for arguments in ([], ["--allow-isolated-runner", str(HERE.parents[2]), str(output)]):
                result = subprocess.run(["bash", str(HERE / "payment-native.sh"), *arguments],
                    env={"PATH": os.environ["PATH"]}, capture_output=True, timeout=5)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(output.exists())

    def test_new_payment_policy_preserves_exact_published_executor_inventory(self):
        self.assertEqual(UPDATER.trusted_paths_for_core("0.5.2"), UPDATER.EXECUTOR_TRUSTED_PATHS)
        self.assertEqual(UPDATER.trusted_paths_for_core("0.5.3"), UPDATER.TRUSTED_PATHS)
        self.assertEqual(UPDATER.TRUSTED_PATHS - UPDATER.EXECUTOR_TRUSTED_PATHS, {
            "vps-billing/deploy/ci/payment-native.sh", "vps-billing/deploy/ci/payment-native.py",
            "vps-billing/deploy/ci/test_payment_native.py", "vps-billing/deploy/systemd/aster-payment.service"})

    def test_source_built_fixture_raw_binary_and_resources_match_installer_contract(self):
        source = HERE.parents[2]
        trust = INSTALLER._Trust(os.geteuid(), os.stat("/").st_uid)
        with tempfile.TemporaryDirectory(prefix="aster-payment-package-") as directory:
            scratch = Path(directory)
            hashes = []
            for version in ("0.1.0", "0.1.1"):
                with self.subTest(version=version):
                    resource, binary, manifest = NATIVE.fixture_package(source, scratch, version)
                    resource.chmod(0o644)
                    binary.chmod(0o755)
                    pin = hashlib.sha256(resource.read_bytes()).hexdigest()
                    package = INSTALLER.verify_package(str(resource), pin, trust=trust, binary=str(binary),
                        binary_sha256=hashlib.sha256(binary.read_bytes()).hexdigest())
                    self.assertEqual(package.manifest, manifest)
                    self.assertEqual(package.manifest["payment"]["checkout_hosts"], ["checkout.example.test"])
                    hashes.append(manifest["sha256"])
                    with self.assertRaises(INSTALLER.Rejected):
                        INSTALLER.verify_package(str(resource), pin, trust=trust, binary=str(binary), binary_sha256="0" * 64)
            self.assertEqual(len(hashes), 2)
            self.assertNotEqual(hashes[0], hashes[1])


if __name__ == "__main__":
    unittest.main()

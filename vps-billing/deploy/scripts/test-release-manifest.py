#!/usr/bin/env python3
"""Regression fixtures for lazy Go module graph inventory (no network/build)."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("release_manifest", Path(__file__).with_name("release-manifest.py"))
manifest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manifest)


class GoDependencyNoticesTest(unittest.TestCase):
    def test_graph_only_module_without_directory_is_explicit(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "notices"
            item = manifest.go_dependency_notices({"Path": "example.org/unused", "Version": "v1.0.0"}, target, set())
            self.assertEqual(item, {"linked_in_binary": False, "source_status": "module_graph_only", "notice_files": []})
            self.assertFalse(target.exists())

    def test_unlinked_graph_metadata_and_notices_ignore_cache_contents(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source"
            source.mkdir()
            (source / "LICENSE").write_text("unlinked fixture license\n")
            cold = {"Path": "example.org/unused", "Version": "v1.0.0"}
            warm = dict(cold, Dir=str(source), Sum="cache-dependent-sum", GoVersion="1.24")
            cold_target = Path(tmp) / "cold"
            warm_target = Path(tmp) / "warm"
            self.assertEqual(manifest.go_dependency_metadata(cold, set()), manifest.go_dependency_metadata(warm, set()))
            self.assertEqual(manifest.go_dependency_notices(cold, cold_target, set()), manifest.go_dependency_notices(warm, warm_target, set()))
            self.assertFalse(cold_target.exists())
            self.assertFalse(warm_target.exists())

    def test_linked_module_missing_source_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(SystemExit, "Linked Go dependency source unavailable"):
                manifest.go_dependency_notices({"Path": "example.org/linked", "Version": "v1.0.0"}, Path(tmp), {"example.org/linked"})

    def test_available_linked_module_copies_notice_without_local_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source"
            source.mkdir()
            (source / "LICENSE").write_text("test fixture license\n")
            target = Path(tmp) / "notices"
            item = manifest.go_dependency_notices({"Path": "example.org/linked", "Version": "v1.0.0", "Dir": str(source)}, target, {"example.org/linked"})
            self.assertEqual(item, {"linked_in_binary": True, "source_status": "source_available", "notice_files": ["LICENSE"]})
            self.assertEqual((target / "LICENSE").read_text(), "test fixture license\n")
            self.assertNotIn(str(source), str(item))


if __name__ == "__main__":
    unittest.main()

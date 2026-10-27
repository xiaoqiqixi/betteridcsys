#!/usr/bin/env python3
"""Keep copied README contracts useful after publication; no network reads."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[3]


def assert_timeless_readme(text):
    # These observed declarations were true before a tag, then remained false
    # forever in the immutable resource README. Conditions and dated evidence
    # are fine; this guard does not require a not-yet-published release to exist.
    for phrase in ("该版本尚未正式发布", "当前已发布版本仍为", "候选源码（未发布）", "候选路径；**该版本",
                   "**候选未发布", "当前仅为未发布候选"):
        if phrase in text:
            raise AssertionError("Copied README freezes a prepublication state: " + phrase)


class ReleaseReadmeContract(unittest.TestCase):
    def test_root_readme_does_not_freeze_a_prepublication_state(self):
        assert_timeless_readme((ROOT / "README.md").read_text())

    def test_runtime_entry_documents_use_conditions_not_frozen_candidate_status(self):
        for name in ("README.md", "vps-billing/README.md", "vps-billing/docs/INSTALL.md",
                     "vps-billing/docs/UPDATES.md", "vps-billing/docs/UPGRADE.md", "vps-billing/docs/BAOTA.md"):
            with self.subTest(path=name):
                assert_timeless_readme((ROOT / name).read_text())

    def test_guard_rejects_the_observed_old_declarations(self):
        for text in ("该版本尚未正式发布，不是现在可执行的下载承诺", "当前已发布版本仍为 `0.5.9`",
                     "本页对应 Core `0.5.10` 候选源码（未发布）", "> **候选未发布。**", "当前仅为未发布候选"):
            with self.subTest(text=text), self.assertRaises(AssertionError):
                assert_timeless_readme(text)

    def test_conditional_contracts_and_dated_evidence_are_not_publication_claims(self):
        assert_timeless_readme("以正常Release、完整资产及来源校验为安装前提；不存在或验证失败时不得安装。\n"
                               "2026-10-27曾复验0.5.10；后续源码不改变旧资产。")

    def test_root_and_project_readme_version_contract_matches_core_source(self):
        protocol = (ROOT / "vps-billing/backend/pkg/pluginapi/protocol.go").read_text()
        versions = re.findall(r'(?m)^\s*CoreVersion\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"', protocol)
        self.assertEqual(len(versions), 1)
        version = versions[0]
        self.assertIn("Core `" + version + "`", (ROOT / "README.md").read_text())
        self.assertIn("Core **" + version + "**", (ROOT / "vps-billing/README.md").read_text())


if __name__ == "__main__":
    unittest.main(verbosity=2)

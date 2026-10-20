import { describe, it, expect } from "vitest";
import { auditActionLabel } from "../src/lib/audit";
import { setLocale } from "../src/lib/i18n";
const labels = [
  ["account.created", "创建账户", "Account created"],
  ["account.updated", "更新账户", "Account updated"],
  ["account.password_reset", "重置账户密码", "Account password reset"],
  ["account.sessions_revoked", "撤销账户会话", "Account sessions revoked"],
  ["catalog.created", "新增商品", "Product created"],
  ["catalog.updated", "编辑商品", "Product updated"],
  ["catalog.duplicated", "复制商品草稿", "Product duplicated"],
  ["catalog.published", "上架商品", "Product published"],
  ["catalog.unpublished", "下架商品", "Product unpublished"],
];
describe("explicit management audit action labels", () => {
  it.each(labels)(
    "labels %s in Chinese and English without replacing the original code",
    (code, zh, en) => {
      setLocale("zh-CN");
      expect(auditActionLabel(code!)).toBe(zh);
      setLocale("en");
      expect(auditActionLabel(code!)).toBe(en);
    },
  );
  it.each(["constructor", "__proto__", "future.unknown"])(
    "does not invent a known label for %s",
    (code) => {
      setLocale("zh-CN");
      expect(auditActionLabel(code)).toBe("其他操作");
    },
  );
});

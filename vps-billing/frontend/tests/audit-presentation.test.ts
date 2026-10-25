import { describe, expect, it } from "vitest";
import { auditActionLabel } from "../src/services/audit-presentation";

describe("audit action presentation does not rewrite stored events", () => {
  it.each([
    "order.created",
    "order.cancelled",
    "payment.settled",
    "account.created",
    "account.updated",
    "account.password_reset",
    "account.sessions_revoked",
    "catalog.created",
    "catalog.duplicated",
    "catalog.updated",
    "catalog.published",
    "catalog.unpublished",
    "catalog.taxonomy_updated",
    "currencies.updated",
    "plan.prices.updated",
    "product.configuration.updated",
    "site.settings.updated",
    "email.settings_updated",
    "email.test_requested",
    "email.test_accepted",
    "email.test_failed",
    "email.test_uncertain",
    "provisioning.queued",
    "provisioning.sending",
    "provisioning.accepted",
    "provisioning.succeeded",
    "provisioning.rejected",
    "provisioning.uncertain",
    "update.handoff_requested",
    "update.asset_verified",
  ])("provides both display languages for current action %s", (action) => {
    const zh = auditActionLabel(action, "zh-CN"),
      en = auditActionLabel(action, "en");
    expect(zh).toMatch(/[\u4e00-\u9fff]/);
    expect(zh).not.toBe("其他操作");
    expect(en).not.toMatch(/[\u4e00-\u9fff]/);
    expect(en).not.toBe("Other activity");
    expect(en).not.toBe(action);
  });
  it.each([
    "future.action",
    "order.Created",
    "order.creáted",
    "__proto__",
    "constructor",
    "toString",
    "<script>private</script>",
  ])(
    "uses a neutral label for unknown historical code %s without guessing its result",
    (action) => {
      expect(auditActionLabel(action, "zh-CN")).toBe("其他操作");
      expect(auditActionLabel(action, "en")).toBe("Other activity");
    },
  );
  it("does not turn accepted mail or provisioning into delivered or completed work", () => {
    expect(auditActionLabel("email.test_accepted", "zh-CN")).toBe(
      "邮件服务器已接受测试邮件",
    );
    expect(auditActionLabel("email.test_accepted", "en")).toBe(
      "Test email accepted by mail server",
    );
    expect(auditActionLabel("provisioning.accepted", "zh-CN")).toBe(
      "主控已受理开通任务",
    );
    expect(auditActionLabel("provisioning.accepted", "en")).not.toMatch(
      /completed|succeeded|active/,
    );
    expect(auditActionLabel("update.handoff_requested", "en")).toContain(
      "requested",
    );
    expect(auditActionLabel("provisioning.uncertain", "zh-CN")).toContain(
      "待核对",
    );
  });
});

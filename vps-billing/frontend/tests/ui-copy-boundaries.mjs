// Read-only assertions shared by browser runners. These helpers neither create
// sessions nor intercept responses; callers retain their API/fixture boundaries.
import assert from "node:assert/strict";
import { expect } from "@playwright/test";

async function english(page) {
  const locale = await page.locator("html").getAttribute("lang");
  assert.ok(["zh-CN", "en"].includes(locale));
  return locale === "en";
}

export async function assertLocalizedClose(page) {
  const label = (await english(page)) ? "Close" : "关闭";
  await expect(
    page.getByRole("dialog").last().locator(".panel-header button[aria-label]"),
  ).toHaveAttribute("aria-label", label);
}

export async function assertCurrencyScope(page, reporting, currency) {
  const en = await english(page),
    panel = page.getByRole("dialog").last(),
    description = panel.locator(".currency-scope");
  await assertLocalizedClose(page);
  await expect(
    panel.getByRole("combobox", {
      name: reporting
        ? en
          ? "Report currency"
          : "报表币种"
        : en
          ? "Purchase currency"
          : "购买币种",
      exact: true,
    }),
  ).toBeVisible();
  if (reporting) {
    await expect(description).toHaveText(
      en
        ? "Shows reports in the selected currency without converting amounts or changing your purchase currency."
        : "仅查看所选币种的报表，不换算金额，也不改变购买币种。",
    );
    await expect(description).not.toContainText(en ? "new-order" : "新订单");
  } else if (currency !== "CNY") {
    await expect(description).toHaveText(
      en
        ? "Changes new-order prices only. Existing invoices keep their currency."
        : "仅影响新订单的报价，历史账单保留原币种。",
    );
  } else await expect(description).toHaveCount(0);
}

export async function assertAuditCopy(page, action, title) {
  const en = await english(page),
    cards = page.locator(".audit-card"),
    card = cards
      .filter({
        has: page.locator(".audit-action-code", { hasText: action }),
      })
      .first();
  await expect(card.locator("h2")).toHaveText(title);
  await expect(card.locator(".audit-action-code")).toHaveText(action);
  await expect(page.locator(".list-scope")).not.toContainText("HTTP");
  const help = page.locator("details.audit-help");
  await expect(help.locator("summary")).toHaveText(
    en ? "Understanding activity records" : "如何查看操作记录",
  );
  await expect(help.locator("p")).toBeHidden();
  await help.locator("summary").click();
  await expect(help.locator("p")).toBeVisible();
  await expect(help.locator("p")).toContainText(
    en ? "not a request" : "不是请求编号",
  );
  await help.locator("summary").click();
  await expect(help.locator("p")).toBeHidden();
}

export async function assertReadFailureCopy(page) {
  const en = await english(page),
    alert = page.getByRole("alert");
  await expect(alert).toContainText(
    en
      ? "Unable to load this information. Please reload."
      : "暂时无法加载，请重新加载。",
  );
  await expect(alert).not.toContainText(
    /核对|重复提交|请勿视为成功|unconfirmed|submitting/,
  );
  await expect(
    alert.getByRole("button", { name: en ? "Retry" : "重新加载", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".gh-workspace,.gh-empty")).toHaveCount(0);
}

import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const base = process.env.TEST_BASE_URL || "http://localhost:5173";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname))
  throw new Error("Browser acceptance must target a disposable loopback demo");
const output = process.env.E2E_OUTPUT_DIR || "test-results/browser";
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  headless: true,
  chromiumSandbox: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1,
  serviceWorkers: "block",
});
const blockedRequests = [];
async function allowLoopbackOnly(browserContext) {
  await browserContext.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== new URL(base).origin) {
      blockedRequests.push("cross-origin request blocked");
      await route.abort("blockedbyclient");
      return;
    }
    const requestURL = new URL(route.request().url());
    if (
      requestURL.pathname.startsWith("/api/v1/admin/email-settings") &&
      route.request().method() !== "GET"
    ) {
      blockedRequests.push("SMTP mutation blocked");
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}
await allowLoopbackOnly(context);
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const shot = async (name) => {
  await mkdir(output, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (page.viewportSize().width < 768) {
    await expect
      .poll(() =>
        page
          .locator(".sidebar")
          .evaluate((el) => el.getBoundingClientRect().right),
      )
      .toBeLessThanOrEqual(1);
  }
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
};
const json = async (route) => {
  const response = await context.request.get(`${base}/api/v1${route}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
};
let originalSettings;
let changedSettings = false;
async function restoreSettings() {
  if (!changedSettings || !originalSettings) return;
  const session = await json("/session");
  expect(session.user.role).toBe("admin");
  const current = await json("/admin/site-settings");
  const response = await context.request.post(
    `${base}/api/v1/admin/site-settings`,
    {
      data: { ...originalSettings, revision: current.revision },
      headers: { "X-CSRF-Token": session.csrf_token, Origin: base },
    },
  );
  expect(response.ok()).toBeTruthy();
  changedSettings = false;
}
try {
  expect((await json("/session")).demo_mode).toBe(true);
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "欢迎回来", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("语言", { exact: true })).toHaveValue("zh-CN");
  await expect(page.getByLabel("币种", { exact: true })).toHaveValue("CNY");
  await shot("login-desktop");
  await page.getByLabel("语言", { exact: true }).selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Currency", { exact: true })).toHaveValue("CNY");
  await page.getByLabel("Currency", { exact: true }).selectOption("USD");
  await page.reload();
  await expect(page.getByLabel("Language", { exact: true })).toHaveValue("en");
  await expect(page.getByLabel("Currency", { exact: true })).toHaveValue("USD");
  await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
  await expect(page.getByLabel("币种", { exact: true })).toHaveValue("USD");
  await page.getByLabel("币种", { exact: true }).selectOption("CNY");
  await page
    .getByRole("button", { name: "体验客户工作台", exact: true })
    .click();
  await expect(page.locator("h1")).toContainText("你好");
  await shot("dashboard-desktop");
  await page.getByRole("link", { name: "选购服务", exact: true }).click();
  const catalogCNY = await json("/plans?currency=CNY");
  const catalogUSD = await json("/plans?currency=USD");
  const firstPlan = catalogCNY[0];
  const alternatePlan = catalogCNY.find(
    (plan) => plan.region !== firstPlan.region && plan.available,
  );
  expect(alternatePlan).toBeTruthy();
  const summary = page.getByRole("complementary", { name: "订单摘要" });
  const amount = (plan) =>
    new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: plan.currency,
      currencyDisplay: "code",
    }).format(plan.price_minor / 100);
  await page
    .getByRole("button", { name: alternatePlan.region, exact: true })
    .click();
  await expect(page.locator(".catalog-plan")).toHaveCount(
    catalogCNY.filter((plan) => plan.region === alternatePlan.region).length,
  );
  await page
    .getByRole("button", {
      name: `选择套餐 ${alternatePlan.name}`,
      exact: true,
    })
    .click();
  await expect(summary).toContainText(alternatePlan.name);
  await expect(summary).toContainText(alternatePlan.region);
  await expect(summary.locator(".purchase-total")).toContainText(
    amount(alternatePlan),
  );
  await page.getByLabel("币种", { exact: true }).selectOption("USD");
  await expect(summary.locator(".purchase-total")).toContainText(
    amount(catalogUSD.find((plan) => plan.id === alternatePlan.id)),
  );
  await expect(page.getByLabel("语言", { exact: true })).toHaveValue("zh-CN");
  await page.getByLabel("币种", { exact: true }).selectOption("CNY");
  await expect(summary.locator(".purchase-total")).toContainText(
    amount(alternatePlan),
  );
  await page.getByRole("button", { name: "全部区域", exact: true }).click();
  await page
    .getByRole("button", { name: `选择套餐 ${firstPlan.name}`, exact: true })
    .click();
  await expect(summary.locator(".purchase-total")).toContainText(
    amount(firstPlan),
  );
  const desktopCatalog = await page.locator(".purchase-catalog").boundingBox();
  const desktopSummary = await summary.boundingBox();
  expect(desktopCatalog).toBeTruthy();
  expect(desktopSummary).toBeTruthy();
  expect(desktopSummary.x).toBeGreaterThanOrEqual(
    desktopCatalog.x + desktopCatalog.width,
  );
  expect(desktopSummary.x + desktopSummary.width).toBeLessThanOrEqual(
    page.viewportSize().width,
  );
  expect(desktopSummary.y).toBeGreaterThanOrEqual(0);
  expect(desktopSummary.y + desktopSummary.height).toBeLessThanOrEqual(
    page.viewportSize().height,
  );
  await shot("plans-desktop");
  await page.getByRole("button", { name: "确认配置", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "确认你的云服务器" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.getByRole("button", { name: "确认配置", exact: true }).click();
  await page.getByLabel("服务器名称", { exact: true }).fill("qa-browser-cny");
  await page.getByRole("checkbox").check();
  const orderResult = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/orders") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "创建待付款订单", exact: true })
    .click();
  const orderResponse = await orderResult;
  expect(orderResponse.status()).toBe(201);
  const order = (await orderResponse.json()).data;
  expect(orderResponse.request().postDataJSON()).toEqual({
    plan_id: firstPlan.id,
    hostname: "qa-browser-cny",
    currency: "CNY",
  });
  expect(order.currency).toBe("CNY");
  expect(order.plan_name).toBe(firstPlan.name);
  expect(order.total_minor).toBe(firstPlan.price_minor);
  await page.waitForURL("**/orders");
  await page.getByLabel("币种", { exact: true }).selectOption("USD");
  await expect(
    page.getByRole("row").filter({ hasText: order.number }),
  ).toContainText("CNY");
  await shot("orders-desktop");
  await page.getByRole("link", { name: /^账单与付款/ }).click();
  const invoice = (await json("/invoices")).find(
    (item) => item.order_id === order.id,
  );
  expect(invoice.issuer.name).toBe("星屿云");
  await page
    .getByRole("button", { name: `查看账单 ${invoice.number}`, exact: true })
    .click();
  await expect(page.locator(".invoice-issuer")).toContainText("星屿云");
  await page
    .getByRole("button", { name: "检查支付可用性", exact: true })
    .click();
  await expect(
    page.locator("dialog[open]").getByText("未发生扣款", { exact: false }),
  ).toBeVisible();
  await shot("invoice-desktop");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .getByLabel("搜索记录", { exact: true })
    .fill("impossible-no-record");
  await expect(
    page.getByText("没有匹配的账单", { exact: false }).first(),
  ).toBeVisible();
  await page.getByLabel("搜索记录", { exact: true }).fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page.getByRole("link", { name: "工作台", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await shot("dashboard-mobile");
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page.getByRole("link", { name: "选购服务", exact: true }).click();
  await page
    .getByRole("button", { name: alternatePlan.region, exact: true })
    .click();
  await expect(page.locator(".catalog-plan")).toHaveCount(
    catalogUSD.filter((plan) => plan.region === alternatePlan.region).length,
  );
  await page
    .getByRole("button", {
      name: `选择套餐 ${alternatePlan.name}`,
      exact: true,
    })
    .click();
  await expect(summary).toContainText(alternatePlan.name);
  await expect(summary.locator(".purchase-total")).toContainText(
    amount(catalogUSD.find((plan) => plan.id === alternatePlan.id)),
  );
  await page.getByLabel("币种", { exact: true }).selectOption("CNY");
  await expect(summary.locator(".purchase-total")).toContainText(
    amount(alternatePlan),
  );
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await summary.scrollIntoViewIfNeeded();
  await expect(summary).toBeVisible();
  await expect(summary.locator(".purchase-review")).toBeInViewport();
  const mobileCatalog = await page.locator(".purchase-catalog").boundingBox();
  const mobileSummary = await summary.boundingBox();
  expect(mobileSummary.y).toBeGreaterThanOrEqual(
    mobileCatalog.y + mobileCatalog.height,
  );
  expect(mobileSummary.x).toBeGreaterThanOrEqual(0);
  expect(mobileSummary.x + mobileSummary.width).toBeLessThanOrEqual(
    page.viewportSize().width,
  );
  await shot("plans-mobile");
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎回来", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: "体验管理后台", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("运营概况");
  await shot("admin-desktop");
  await page.getByRole("link", { name: "扩展中心", exact: true }).click();
  const smtp = page.locator(".smtp-settings");
  await expect(smtp.getByText("已保存：禁用", { exact: true })).toBeVisible();
  await expect(
    smtp.getByText(
      "服务器尚未配置凭据加密密钥。可以保存不含凭据的禁用草稿；启用和测试发送暂不可用。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(smtp.locator('input[name="enabled"]')).not.toBeChecked();
  await expect(smtp.locator('input[name="enabled"]')).toBeDisabled();
  await expect(smtp.locator("#smtp-username")).toBeEmpty();
  await expect(smtp.locator("#smtp-password")).toBeEmpty();
  await expect(smtp.locator("#smtp-username")).toBeDisabled();
  await expect(smtp.locator("#smtp-password")).toBeDisabled();
  await expect(
    smtp.locator('[data-testid="smtp-form"] button[type="submit"]'),
  ).toBeDisabled();
  await expect(
    smtp.locator('[data-testid="smtp-test-form"] button[type="submit"]'),
  ).toBeDisabled();
  await shot("smtp-disabled-desktop");
  originalSettings = await json("/admin/site-settings");
  await page.getByRole("link", { name: "站点设置", exact: true }).click();
  await page.locator('input[name="site_name"]').fill("验收测试云");
  await page.locator('input[name="company_name"]').fill("验收测试公司");
  await page.locator('input[name="theme"][value="teal"]').check();
  await page.locator('select[name="default_locale"]').selectOption("en");
  await page.locator('select[name="default_currency"]').selectOption("USD");
  await page.locator(".settings-advanced summary").click();
  await page.locator('input[name="invoice_issuer"]').fill("新开票主体");
  await shot("settings-preview-desktop");
  changedSettings = true;
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(
    page.getByText("设置已保存。已有账单的金额、币种和开具信息保持不变。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".sidebar .brand strong")).toHaveText("验收测试云");
  await expect(page.getByLabel("语言", { exact: true })).toHaveValue("zh-CN");
  const fresh = await browser.newContext({ serviceWorkers: "block" });
  await allowLoopbackOnly(fresh);
  try {
    const visitor = await fresh.newPage();
    await visitor.goto(base);
    await expect(
      visitor.getByRole("heading", { name: "Welcome back", exact: true }),
    ).toBeVisible();
    await expect(visitor.getByLabel("Currency", { exact: true })).toHaveValue(
      "USD",
    );
    await expect(visitor.locator(".login-brand")).toContainText("验收测试云");
  } finally {
    await fresh.close();
  }
  await page.getByRole("link", { name: /^账单管理/ }).click();
  await page
    .getByRole("button", { name: `查看账单 ${invoice.number}`, exact: true })
    .click();
  await expect(page.locator(".invoice-issuer")).toContainText("星屿云");
  await expect(page.locator(".invoice-issuer")).not.toContainText("新开票主体");
  await shot("invoice-snapshot-after-settings");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("link", { name: "站点设置", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await shot("settings-mobile");
  await restoreSettings();
  expect(errors).toEqual([]);
  expect(blockedRequests).toEqual([]);
  console.log(
    "PASS: real demo API, independent persistent preferences, CNY server-priced order, unchanged history currency, payment fail-closed, dialogs/search, desktop/mobile region filters and live selection summaries, currency refresh, mobile navigation/overflow, SMTP disabled/no-key read-only state, admin settings save/preview, new-visitor defaults, immutable invoice issuer, settings restored; no browser runtime errors.",
  );
} finally {
  try {
    await restoreSettings();
  } finally {
    await browser.close();
  }
}

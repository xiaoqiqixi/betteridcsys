// New production-console acceptance. Executed only by the strict Linux supervisor;
// the user's existing browser/profile is never attached or modified by this script.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { probeResponsiveBoundaries } from "./responsive-boundaries.mjs";
import {
  accessiblePanel,
  apiData,
  appearance,
  assertScreenSafe,
  closePanel,
  createScreen,
  dialog,
  exactMoney,
  fixture,
  goto,
  locale,
  login,
  logout,
  noOverflow,
  permit,
  probeHistoricalCheckout,
  probePreferencePersistence,
  selectedCoreVersion,
  settle,
  strictBase,
} from "./e2e-support.mjs";

const base = strictBase(process.env.TEST_BASE_URL || "http://127.0.0.1:5181");
const output = process.env.E2E_OUTPUT_DIR || "test-results/browser";
const version = await selectedCoreVersion();
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  headless: true,
  chromiumSandbox: true,
});
const screens = [];
let page,
  stage = "start",
  shots = 0;
async function screen(storage) {
  const result = await createScreen(browser, base, storage);
  screens.push(result);
  page = result.page;
  return result;
}
async function ready() {
  await expect(
    page.locator(".ui-loading,.gh-loading,.gfo-loading"),
  ).toHaveCount(0);
  await settle(page);
}
async function shot(name) {
  await ready();
  await noOverflow(page);
  await page.screenshot({
    path: path.join(output, name + ".png"),
    fullPage: false,
  });
  shots++;
}
async function route(target) {
  await goto(page, base, target);
  await ready();
}
async function chooseFirst(screen, hostname) {
  const [taxonomy, plans] = await Promise.all([
    apiData(screen.context, base, "/api/v1/catalog-taxonomy"),
    apiData(screen.context, base, "/api/v1/plans?currency=CNY"),
  ]);
  const sorted = (items) =>
    [...items].sort(
      (a, b) =>
        a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const selectedType = sorted(taxonomy.types).find(
    (type) => type.enabled && plans.some((plan) => plan.type_id === type.id),
  );
  assert.ok(
    selectedType,
    "Disposable demo needs a real type containing published plans",
  );
  const selectedRegion = sorted(taxonomy.regions).find(
    (region) =>
      region.enabled &&
      region.type_id === selectedType.id &&
      plans.some(
        (plan) =>
          plan.type_id === selectedType.id && plan.region_id === region.id,
      ),
  );
  assert.ok(
    selectedRegion,
    "Disposable demo needs a real region under its first type",
  );
  const selectedNode = sorted(taxonomy.nodes).find(
    (node) =>
      node.enabled &&
      node.region_id === selectedRegion.id &&
      plans.some(
        (plan) =>
          plan.type_id === selectedType.id &&
          plan.region_id === selectedRegion.id &&
          plan.node_id === node.id,
      ),
  );
  assert.ok(
    selectedNode,
    "Disposable demo needs a real node under its first region",
  );
  const selected = plans.find(
    (plan) =>
      plan.type_id === selectedType.id &&
      plan.region_id === selectedRegion.id &&
      plan.node_id === selectedNode.id,
  );
  assert.ok(
    selected?.available && selected.price_minor > 0,
    "Disposable demo's actual first plan needs an available positive CNY quote; never silently skip it",
  );
  assert.equal(selected.taxonomy_revision, taxonomy.revision);
  assert.equal(selected.region, selectedRegion.name);
  for (const id of [
    selected.type_id,
    selected.region_id,
    selected.node_id,
    selected.id,
  ])
    assert.match(id, /^[A-Za-z0-9_.-]{1,64}$/);
  for (const [name, id] of [
    ["type", selected.type_id],
    ["region", selected.region_id],
    ["node", selected.node_id],
  ]) {
    const control = page.locator(
      `.catalog-${name} button[data-${name}-id="${id}"]`,
    );
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute("aria-pressed", "true");
    await expect(control).toHaveClass(/active/);
  }
  const card = page.locator(`.gpc-card[data-plan-id="${selected.id}"]`);
  await expect(card).toHaveClass(/is-selected/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(".hostname-field input").fill(hostname);
  await expect(page.locator(".order-summary .summary-total strong")).toHaveText(
    exactMoney(selected.price_minor, selected.currency_format, true),
  );
  return selected;
}
async function openReview() {
  const action = page.locator(".summary-actions button");
  await (
    (await action.isVisible())
      ? action
      : page.locator(".mobile-purchase-bar button")
  ).click();
  await expect(dialog(page).locator(".purchase-consent")).toBeVisible();
}
async function orderFromUI(screen, plan, hostname) {
  const before = screen.state.writes.length;
  await dialog(page).locator(".purchase-consent input").check();
  permit(screen.state, "/orders");
  await dialog(page)
    .getByRole("button", { name: /^(创建待付款订单|Create unpaid order)$/ })
    .click();
  await expect(dialog(page).locator(".order-created")).toBeVisible();
  const writes = screen.state.writes.slice(before);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/api/v1/orders");
  assert.deepEqual(writes[0].body, {
    plan_id: plan.id,
    hostname,
    currency: plan.currency,
    quote: {
      price_minor: plan.price_minor,
      decimal_places: plan.currency_format.decimal_places,
      price_revision: plan.price_revision,
    },
  });
  assert.match(writes[0].headers["idempotency-key"], /^ui-[a-f0-9-]+$/);
  const orders = await apiData(screen.context, base, "/api/v1/orders");
  const order = orders.find((value) => value.hostname === hostname);
  assert.ok(order);
  assert.equal(order.status, "pending_payment");
  assert.equal(order.total_minor, plan.price_minor);
  assert.deepEqual(order.currency_format, plan.currency_format);
  return order;
}
try {
  await mkdir(output, { recursive: true });
  stage = "public-and-auth-boundaries";
  const customer = await screen();
  await route("/catalog");
  await expect(
    page.getByRole("heading", { name: "购买云服务器", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".gpc-card").first()).toBeVisible();
  await expect(page.locator(".hostname-field input")).toHaveCount(0);
  await expect(
    page.locator(".catalog-search,.catalog-sort,.gpc-btn-compare"),
  ).toHaveCount(0);
  assert.equal(await page.locator("select").count(), 0);
  await shot("catalog-public-desktop");
  await page.locator(".gpc-btn-choose").first().click();
  await expect(dialog(page).locator(".signin-form")).toBeVisible();
  await accessiblePanel(page);
  await shot("sign-in-desktop");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(".locale-trigger").click();
  await expect(dialog(page).getByRole("combobox")).toHaveCount(2);
  await accessiblePanel(page);
  await shot("preferences-desktop");
  await closePanel(page);
  await page.setViewportSize({ width: 375, height: 844 });
  await shot("catalog-public-mobile");
  await page.locator(".mobile-purchase-bar button").click();
  await expect(dialog(page).locator(".signin-form")).toBeVisible();
  await accessiblePanel(page);
  await shot("sign-in-mobile");
  await closePanel(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await login(customer, base, "customer");
  const customerStorage = await customer.context.storageState();
  await appearance(page, "light");
  await route("/home");
  await expect(page.locator(".gh-root")).toHaveAttribute("aria-busy", "false");
  await shot("dashboard-desktop");

  stage = "exact-pending-order";
  const serviceBefore = await apiData(
    customer.context,
    base,
    "/api/v1/services",
  );
  await route("/catalog");
  const chosen = await chooseFirst(customer, "ci-new-console-order");
  assert.equal(
    customer.state.writes.filter((value) => value.path === "/api/v1/orders")
      .length,
    0,
  );
  await shot("catalog-selected-desktop");
  await openReview();
  await accessiblePanel(page);
  await shot("order-review-desktop");
  const created = await orderFromUI(customer, chosen, "ci-new-console-order");
  assert.deepEqual(
    await apiData(customer.context, base, "/api/v1/services"),
    serviceBefore,
    "Order creation must not provision resources",
  );
  await shot("order-created-desktop");
  await dialog(page)
    .getByRole("button", { name: "查看订单", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp("/orders/" + created.id + "$"));
  await expect(dialog(page).locator(".detail-hero")).toBeVisible();
  await expect(dialog(page)).toContainText("服务器尚未开通");
  await shot("order-details-desktop");
  const details = await apiData(
    customer.context,
    base,
    "/api/v1/orders/" + encodeURIComponent(created.id),
  );
  assert.equal(details.service, null);
  assert.equal(details.invoice.status, "unpaid");
  await dialog(page)
    .getByRole("button", { name: /^查看账单/ })
    .click();
  await expect(dialog(page).locator(".detail-hero strong")).toHaveText(
    exactMoney(created.total_minor, created.currency_format) + " CNY",
  );
  await shot("invoice-desktop");

  stage = "disabled-and-untrusted-checkout";
  permit(customer.state, `/invoices/${details.invoice.id}/checkout`);
  await dialog(page)
    .getByRole("button", { name: "前往付款", exact: true })
    .click();
  await expect(dialog(page)).toContainText("PAYMENT_NOT_CONFIGURED");
  await expect(dialog(page).locator(".checkout-ready")).toHaveCount(0);
  assert.equal(
    (
      await apiData(
        customer.context,
        base,
        "/api/v1/invoices/" + details.invoice.id,
      )
    ).status,
    "unpaid",
  );
  await shot("payment-disabled-desktop");
  await dialog(page)
    .getByRole("button", { name: "重读账单", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("button", { name: "前往付款", exact: true }),
  ).toBeEnabled();
  for (const checkoutURL of [
    "javascript:alert(1)",
    "https://user:synthetic-secret@checkout.example.invalid/session",
  ]) {
    const remove = fixture(
      customer.state,
      "POST",
      `/invoices/${details.invoice.id}/checkout`,
      {
        provider_id: "payment.synthetic",
        session_id: "synthetic-session",
        checkout_url: checkoutURL,
        expires_at: new Date(Date.now() + 120000).toISOString(),
      },
    );
    permit(customer.state, `/invoices/${details.invoice.id}/checkout`);
    await dialog(page)
      .getByRole("button", { name: "前往付款", exact: true })
      .click();
    await expect(dialog(page).locator(".feedback-error")).toBeVisible();
    await expect(dialog(page).locator(".checkout-ready a")).toHaveCount(0);
    await expect(dialog(page)).not.toContainText("synthetic-secret");
    remove();
    await dialog(page)
      .getByRole("button", { name: "重读账单", exact: true })
      .click();
    await expect(
      dialog(page).getByRole("button", { name: "前往付款", exact: true }),
    ).toBeEnabled();
  }
  const removeCheckout = fixture(
    customer.state,
    "POST",
    `/invoices/${details.invoice.id}/checkout`,
    {
      provider_id: "payment.synthetic",
      session_id: "synthetic-session",
      checkout_url: "https://checkout.example.invalid/session",
      expires_at: new Date(Date.now() + 120000).toISOString(),
    },
  );
  permit(customer.state, `/invoices/${details.invoice.id}/checkout`);
  await dialog(page)
    .getByRole("button", { name: "前往付款", exact: true })
    .click();
  await expect(dialog(page).locator(".checkout-ready a")).toHaveAttribute(
    "href",
    "https://checkout.example.invalid/session",
  );
  await expect(dialog(page).locator(".checkout-ready a")).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  assert.equal(
    (
      await apiData(
        customer.context,
        base,
        "/api/v1/invoices/" + details.invoice.id,
      )
    ).status,
    "unpaid",
  );
  removeCheckout();
  await closePanel(page);

  stage = "customer-pages-and-owner-isolation";
  await route("/orders");
  await expect(page.locator(".record-row").first()).toBeVisible();
  await shot("customer-orders-desktop");
  await route("/invoices");
  await expect(page.locator(".record-row").first()).toBeVisible();
  await shot("customer-invoices-desktop");
  await route("/audit");
  await expect(page.locator(".cursor-pagination")).toBeVisible();
  await shot("customer-audit-desktop");
  await route("/services");
  await shot("customer-services-desktop");
  await route("/account");
  await expect(page.locator(".account-summary")).toBeVisible();
  await shot("customer-account-desktop");
  const requestStart = customer.state.requests.length;
  await route("/admin/customers");
  await expect(page.locator("#main-content")).toContainText("需要管理员权限");
  assert.equal(
    customer.state.requests
      .slice(requestStart)
      .some((value) => value.path.startsWith("/api/v1/admin/")),
    false,
  );
  const other = await screen();
  await login(other, base, "other");
  const denied = await other.context.request.get(
    base + "/api/v1/orders/" + created.id,
    { maxRedirects: 0 },
  );
  assert.ok([403, 404].includes(denied.status()));
  await route("/orders/" + created.id);
  await expect(dialog(page)).not.toContainText("ci-new-console-order");
  assertScreenSafe(other);
  await other.context.close();
  screens.splice(screens.indexOf(other), 1);
  page = customer.page;

  stage = "mobile-purchase-and-history";
  await page.setViewportSize({ width: 375, height: 844 });
  await route("/catalog");
  await chooseFirst(customer, "ci-mobile-review-only");
  const geometry = await page.evaluate(() => ({
    action: document
      .querySelector(".mobile-purchase-bar")
      .getBoundingClientRect()
      .toJSON(),
    nav: document
      .querySelector(".mobile-bottom")
      .getBoundingClientRect()
      .toJSON(),
  }));
  assert.ok(
    geometry.action.y + geometry.action.height <= geometry.nav.y + 1,
    "Purchase action must not cover mobile navigation",
  );
  await shot("plans-mobile");
  await openReview();
  await accessiblePanel(page);
  await shot("order-review-mobile");
  await closePanel(page);
  await route("/invoices");
  await page
    .locator(".record-row")
    .filter({ hasText: details.invoice.number })
    .getByRole("button")
    .click();
  await accessiblePanel(page);
  await shot("invoice-mobile");
  await closePanel(page);
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 375, height: 480 },
    { width: 844, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await route("/invoices");
    await page
      .locator(".record-row")
      .filter({ hasText: details.invoice.number })
      .getByRole("button")
      .click();
    await accessiblePanel(page);
    await closePanel(page);
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await route("/orders/" + created.id);
  await dialog(page)
    .getByLabel("取消原因（必填）")
    .fill("Disposable CI cancellation; no provider or resource action");
  permit(customer.state, `/orders/${created.id}/cancel`);
  await dialog(page)
    .getByRole("button", { name: "确认取消并作废账单", exact: true })
    .click();
  await expect(page.locator(".feedback-info")).toContainText("订单已安全取消");
  const cancelled = await apiData(
    customer.context,
    base,
    "/api/v1/orders/" + created.id,
  );
  assert.equal(cancelled.order.status, "cancelled");
  assert.equal(cancelled.invoice.status, "void");
  assert.equal(cancelled.order.total_minor, created.total_minor);
  await closePanel(page);

  stage = "admin-read-scope-and-draft-conflict";
  const admin = await screen();
  await login(admin, base, "admin");
  const adminStorage = await admin.context.storageState();
  await route("/admin/catalog");
  await expect(page.locator(".product-row").first()).toBeVisible();
  await shot("admin-catalog-desktop");
  const firstProductId = (
    await page.locator(".item-id").first().textContent()
  ).trim();
  await page.locator(".edit-action").first().click();
  await expect(dialog(page).locator(".price-editor")).toBeVisible();
  await accessiblePanel(page);
  await shot("admin-product-editor");
  await dialog(page).getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(".edit-action").first().click();
  await dialog(page)
    .locator(".reason-section textarea")
    .fill("Synthetic conflict; must never dispatch to the real catalog");
  const conflictPath = "/admin/catalog/" + firstProductId;
  const removeConflict = fixture(admin.state, "POST", conflictPath, null, 409);
  admin.state.fixtures.at(-1).error = { code: "CATALOG_CONFLICT" };
  permit(admin.state, conflictPath);
  await dialog(page)
    .getByRole("button", { name: "保存商品", exact: true })
    .click();
  await expect(dialog(page)).toContainText("草稿没有保存");
  await expect(
    dialog(page).getByRole("button", { name: "保存商品", exact: true }),
  ).toBeDisabled();
  removeConflict();
  await dialog(page)
    .getByRole("button", { name: "关闭草稿并核对最新目录", exact: true })
    .click();
  await route("/admin/customers");
  await expect(page.locator(".cursor-pagination")).toBeVisible();
  await shot("admin-accounts-desktop");
  await route("/admin/orders");
  await expect(page.locator(".record-row").first()).toBeVisible();
  await shot("admin-orders-desktop");
  await route("/admin/finance");
  await expect(page.locator(".gfo-root")).toBeVisible();
  await shot("admin-finance-desktop");
  await route("/admin/settings");
  await expect(page.locator(".settings-form")).toBeVisible();
  await shot("admin-site-settings");
  await page
    .locator(".settings-nav")
    .getByRole("button", { name: "运营币种", exact: true })
    .click();
  await expect(page.locator(".gce-root")).toBeVisible();
  await shot("admin-currency-settings");
  await page
    .locator(".settings-nav")
    .getByRole("button", { name: "邮件设置", exact: true })
    .click();
  await expect(page.locator(".gee-root")).toBeVisible();
  for (const credential of await page
    .locator(".gee-root input[type=password]")
    .all())
    await expect(credential).toHaveValue("");
  await expect(
    page
      .locator(".gee-root")
      .getByRole("button", { name: "发送测试", exact: true }),
  ).toBeDisabled();
  await shot("admin-email-settings");
  await page
    .locator(".settings-nav")
    .getByRole("button", { name: "版本与更新", exact: true })
    .click();
  await expect(page.locator(".update-facts").first()).toContainText(version);
  assert.equal(
    admin.state.writes.some(
      (value) =>
        value.path.includes("/admin/updates") ||
        value.path.includes("/admin/email-settings"),
    ),
    false,
  );
  await shot("admin-updates-readonly");
  await page.setViewportSize({ width: 375, height: 844 });
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await accessiblePanel(page);
  await shot("admin-navigation-mobile");
  await closePanel(page);

  stage = "themes-languages-and-navigation";
  await page.setViewportSize({ width: 1440, height: 1100 });
  const site = await apiData(admin.context, base, "/api/v1/site-settings");
  for (const theme of ["blue", "teal", "violet"]) {
    const removeTheme = fixture(admin.state, "GET", "/site-settings", {
      ...site,
      theme,
    });
    await route("/catalog");
    await expect(page.locator("html")).toHaveAttribute("data-brand", theme);
    for (const view of ["light", "dark"]) {
      await appearance(page, view);
      await noOverflow(page);
    }
    removeTheme();
  }
  await locale(page, "en");
  await expect(page.locator("h1")).toHaveText("Buy a cloud server");
  await locale(page, "zh-CN");
  for (const width of [320, 375, 720, 721, 768, 960, 961, 1024, 1025, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    assert.equal(await page.locator(".idc-sidebar").isVisible(), width > 960);
    assert.equal(
      await page.locator(".mobile-bottom").isVisible(),
      width <= 960,
    );
    await noOverflow(page);
  }
  stage = "preference-persistence-and-account-scopes";
  assert.equal(await probePreferencePersistence(browser, base), true);
  stage = "historical-invoice-boundaries";
  const historicalCases = await probeHistoricalCheckout(
    browser,
    base,
    customerStorage,
  );
  assert.equal(historicalCases, 28);
  stage = "unconfirmed-order-route-recovery";
  const unknown = await screen(customerStorage);
  await route("/catalog");
  await chooseFirst(unknown, "ci-unknown-order");
  await openReview();
  const removeUnknown = fixture(unknown.state, "POST", "/orders", null, 503);
  unknown.state.fixtures.at(-1).error = { code: "BACKEND_UNAVAILABLE" };
  await dialog(page).locator(".purchase-consent input").check();
  permit(unknown.state, "/orders");
  await dialog(page)
    .getByRole("button", { name: "创建待付款订单", exact: true })
    .click();
  await expect(dialog(page)).toContainText("订单结果尚未确认");
  await closePanel(page);
  await expect(page.locator(".order-reconciliation")).toBeVisible();
  await expect(page.locator(".gpc-btn-choose").first()).toBeDisabled();
  await page.locator('.idc-sidebar a[href="#/orders"]').click();
  await expect(page.locator(".operations-page")).toBeVisible();
  await page.locator('.idc-sidebar a[href="#/catalog"]').click();
  await expect(page.locator(".order-reconciliation")).toBeVisible();
  assert.equal(
    unknown.state.writes.length,
    1,
    "Route return must not automatically replay the uncertain request",
  );
  await page.locator(".order-reconciliation input").check();
  permit(unknown.state, "/orders");
  await page.getByRole("button", { name: "核对这笔订单", exact: true }).click();
  await expect(page.locator(".inline-error")).toContainText("这笔订单仍未确认");
  assert.equal(unknown.state.writes.length, 2);
  assert.deepEqual(unknown.state.writes[1].body, unknown.state.writes[0].body);
  assert.equal(
    unknown.state.writes[1].headers["idempotency-key"],
    unknown.state.writes[0].headers["idempotency-key"],
  );
  assert.equal(
    (await apiData(unknown.context, base, "/api/v1/orders")).some(
      (value) => value.hostname === "ci-unknown-order",
    ),
    false,
    "Synthetic failure must not create a real order",
  );
  removeUnknown();
  assertScreenSafe(unknown);
  await unknown.context.close();
  screens.splice(screens.indexOf(unknown), 1);
  page = admin.page;
  stage = "responsive-source-boundaries";
  assert.equal(shots, 30);
  const matrix = await probeResponsiveBoundaries(browser, base, adminStorage);
  assert.equal(matrix.cases, 50);
  // Do not suppress failed geometry. The Python supervisor consumes every case,
  // retains the complete 30-shot inventory, then fails its boundary gate.
  assertScreenSafe(customer);
  assertScreenSafe(admin);
  page = admin.page;
  await page.setViewportSize({ width: 1440, height: 1100 });
  await logout(admin, base);
  page = customer.page;
  await logout(customer, base);
  assertScreenSafe(customer);
  assertScreenSafe(admin);
  console.log(
    JSON.stringify({
      schema: "aster-new-console-e2e-v1",
      functional_passed: true,
      screenshots: shots,
      historical_invoice_cases: historicalCases,
      responsive_cases: matrix.cases,
      responsive_passed: matrix.passed,
      real_provider_requests: 0,
      automatic_payments: 0,
      resource_provisioning: 0,
    }),
  );
} catch (error) {
  console.error("E2E_FAILURE_STAGE=" + stage);
  console.error(error.stack || String(error));
  process.exitCode = 1;
} finally {
  for (const item of screens)
    await item.context.close().catch(() => {
      process.exitCode = 1;
    });
  await browser.close();
}

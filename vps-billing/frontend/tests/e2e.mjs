import { chromium, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const base = process.env.TEST_BASE_URL || "http://localhost:5173";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname))
  throw new Error("Browser acceptance must target a disposable loopback demo");
const output = process.env.E2E_OUTPUT_DIR || "test-results/browser";
const versionSource = await readFile(
  new URL("../../backend/pkg/pluginapi/protocol.go", import.meta.url),
  "utf8",
);
const versionDeclarations = [
  ...versionSource.matchAll(/^\s*CoreVersion\s*=\s*(.*)$/gm),
];
if (versionDeclarations.length !== 1)
  throw new Error("Expected one CoreVersion declaration in selected source");
const expectedCoreVersion =
  /^"((?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5}))"\s*$/.exec(
    versionDeclarations[0][1],
  )?.[1];
if (!expectedCoreVersion)
  throw new Error("Invalid selected-source CoreVersion literal");
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
    if (
      requestURL.pathname.startsWith("/api/v1/admin/updates") &&
      route.request().method() !== "GET"
    ) {
      blockedRequests.push("Update check or handoff must be explicit");
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
  if (page.viewportSize().width <= 720) {
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
const financialPage = page.locator(".financial-settings");
const currencyForm = page.getByTestId("currency-form");
const priceForm = page.getByTestId("price-form");
const financialReady = async () => {
  await expect(financialPage).toHaveAttribute("aria-busy", "false");
  await expect(currencyForm).toBeVisible();
  await expect(priceForm).toBeVisible();
  await expect(financialPage.getByRole("alert")).toHaveCount(0);
};
const waitForPost = (endpoint) =>
  page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1${endpoint}` &&
      response.request().method() === "POST",
  );
const cancellationRequests = [];
page.on("request", (request) => {
  if (
    request.method() === "POST" &&
    /^\/api\/v1\/(?:admin\/)?orders\/[^/]+\/cancel$/.test(
      new URL(request.url()).pathname,
    )
  )
    cancellationRequests.push(request);
});
async function cancellationState(admin = false) {
  const prefix = admin ? "/admin" : "";
  const [orders, invoices, overview, otherCurrency, services, audit] =
    await Promise.all([
      json(`${prefix}/orders`),
      json(`${prefix}/invoices`),
      json(`${prefix}/overview?currency=CNY`),
      json(`${prefix}/overview?currency=JPY`),
      json("/services"),
      json("/audit"),
    ]);
  return { orders, invoices, overview, otherCurrency, services, audit };
}
async function cancelThroughUI(order, invoice, reason, admin = false) {
  const before = await cancellationState(admin);
  expect(before.orders.find((item) => item.id === order.id)).toEqual(order);
  expect(before.invoices.find((item) => item.id === invoice.id)).toEqual(
    invoice,
  );
  expect(order.status).toBe("pending_payment");
  expect(invoice.status).toBe("unpaid");
  const requestCount = cancellationRequests.length;
  const row = page.locator(`tr[data-order-id="${order.id}"]`);
  const cancelButton = row.getByRole("button", {
    name: "取消订单",
    exact: true,
  });
  const dialog = page.getByTestId("cancellation-dialog");
  await cancelButton.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(order.number);
  expect(cancellationRequests).toHaveLength(requestCount);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await cancellationState(admin)).toEqual(before);
  expect(cancellationRequests).toHaveLength(requestCount);

  await cancelButton.click();
  const reasonField = dialog.locator('[name="cancellation_reason"]');
  const confirmation = dialog.locator('[name="confirm_cancellation"]');
  const submit = dialog.getByRole("button", {
    name: "确认取消订单",
    exact: true,
  });
  await expect(reasonField).toBeEmpty();
  await expect(confirmation).not.toBeChecked();
  await expect(submit).toBeDisabled();
  await reasonField.fill(reason);
  await expect(submit).toBeDisabled();
  // Exercise the form guard as well as its disabled submit button.
  await reasonField.evaluate((field) => field.form.requestSubmit());
  await reasonField.fill("");
  await confirmation.check();
  await expect(submit).toBeDisabled();
  await reasonField.evaluate((field) => field.form.requestSubmit());
  await reasonField.fill("   ");
  await expect(submit).toBeDisabled();
  await reasonField.evaluate((field) => field.form.requestSubmit());
  expect(await cancellationState(admin)).toEqual(before);
  expect(cancellationRequests).toHaveLength(requestCount);
  await reasonField.fill(`  ${reason}  `);
  await expect(submit).toBeEnabled();
  const endpoint = `${admin ? "/admin" : ""}/orders/${order.id}/cancel`;
  const result = waitForPost(endpoint);
  await submit.click();
  const response = await result;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ reason });
  const pair = (await response.json()).data;
  expect(pair).toEqual({
    order: { ...order, status: "cancelled" },
    invoice: { ...invoice, status: "void" },
  });
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText(`订单 ${order.number} 已取消，关联账单已作废。`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(row.locator(".badge")).toHaveText("已取消");
  await expect(cancelButton).toHaveCount(0);
  expect(cancellationRequests).toHaveLength(requestCount + 1);
  const after = await cancellationState(admin);
  expect(after.orders).toEqual(
    before.orders.map((item) => (item.id === order.id ? pair.order : item)),
  );
  expect(after.invoices).toEqual(
    before.invoices.map((item) =>
      item.id === invoice.id ? pair.invoice : item,
    ),
  );
  const countField = admin ? "unpaid_invoices" : "pending_invoices";
  expect(after.overview).toEqual({
    ...before.overview,
    [countField]: before.overview[countField] - 1,
    unpaid_total_minor:
      before.overview.unpaid_total_minor - invoice.amount_minor,
    ...(!admin && {
      recent_orders: before.overview.recent_orders.map((item) =>
        item.id === order.id ? pair.order : item,
      ),
    }),
  });
  expect(after.otherCurrency).toEqual({
    ...before.otherCurrency,
    ...(!admin && {
      recent_orders: before.otherCurrency.recent_orders.map((item) =>
        item.id === order.id ? pair.order : item,
      ),
    }),
  });
  expect(after.services).toEqual(before.services);
  const cancellationAudit = after.audit.filter(
    (event) => event.action === "order.cancelled" && event.target === order.id,
  );
  expect(cancellationAudit).toHaveLength(1);
  expect(cancellationAudit[0].detail).toContain(reason);
  const session = await json("/session");
  expect(cancellationAudit[0].actor_email).toBe(session.user.email);
  expect(
    after.audit.filter((event) => event.id !== cancellationAudit[0].id),
  ).toEqual(before.audit);
  // A repeated explicit request must return the original pair without another
  // audit entry, another deduction or any snapshot changes.
  const replay = await context.request.post(`${base}/api/v1${endpoint}`, {
    data: { reason },
    headers: { "X-CSRF-Token": session.csrf_token, Origin: base },
  });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).data).toEqual(pair);
  expect(await cancellationState(admin)).toEqual(after);
  await page
    .getByRole("link", { name: admin ? /^账单管理/ : /^账单与付款/ })
    .click();
  const invoiceRow = page.getByRole("row").filter({ hasText: invoice.number });
  await expect(invoiceRow.locator(".badge")).toHaveText("已作废");
  await expect(
    page.locator(".invoice-summary > div").nth(1).locator("b"),
  ).toHaveText(new RegExp(`^${after.overview[countField]}\\s*笔$`));
  await expect(page.locator(".invoice-summary > div").first()).toContainText(
    amount({
      price_minor: after.overview.unpaid_total_minor,
      currency: after.overview.currency,
      currency_format: after.overview.currency_format,
    }),
  );
  await invoiceRow
    .getByRole("button", { name: `查看账单 ${invoice.number}`, exact: true })
    .click();
  await expect(page.locator(".invoice-modal .badge")).toHaveText("已作废");
  await expect(page.locator(".invoice-modal .invoice-issuer")).toContainText(
    invoice.issuer.name,
  );
  await expect(
    page.locator(".invoice-modal").getByRole("button", {
      name: "检查支付可用性",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .locator(".invoice-modal")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  return pair;
}
const writableCurrency = ({
  code,
  name,
  prefix,
  suffix,
  decimal_places,
  enabled,
  sort_order,
}) => ({ code, name, prefix, suffix, decimal_places, enabled, sort_order });
const fixtureCurrencies = [
  {
    code: "JPY",
    name: "Japanese Yen",
    prefix: "¥",
    suffix: "",
    decimal_places: 0,
    enabled: true,
    sort_order: 1,
  },
  {
    code: "KWD",
    name: "Kuwaiti Dinar",
    prefix: "",
    suffix: " KD",
    decimal_places: 3,
    enabled: true,
    sort_order: 2,
  },
];
// Disposable demo fixtures: independent prices, with no exchange-rate calculation.
const fixturePrices = {
  JPY: ["900", "1200", "2400"],
  KWD: ["1.234", "2.345", "4.567"],
};
function minorUnits(amount, places) {
  const [whole, fraction = ""] = amount.split(".");
  expect(fraction.length).toBeLessThanOrEqual(places);
  return BigInt(whole + fraction.padEnd(places, "0"));
}
function amount(plan) {
  const format = plan.currency_format;
  expect(format.code).toBe(plan.currency);
  expect(Number.isSafeInteger(plan.price_minor)).toBe(true);
  const minor = BigInt(plan.price_minor);
  const units = 10n ** BigInt(format.decimal_places);
  const whole = new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 0,
  }).format(minor / units);
  const fraction = format.decimal_places
    ? `.${String(minor % units).padStart(format.decimal_places, "0")}`
    : "";
  return `${format.code}\u00a0${format.prefix}${whole}${fraction}${format.suffix}`;
}
async function saveFixturePrices(definition) {
  const readResult = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/admin/plan-prices" &&
      url.searchParams.get("currency") === definition.code &&
      response.request().method() === "GET"
    );
  });
  await priceForm
    .locator('[name="pricing_currency"]')
    .selectOption(definition.code);
  const readResponse = await readResult;
  expect(readResponse.ok()).toBe(true);
  const before = (await readResponse.json()).data;
  expect(before.currency).toBe(definition.code);
  expect(before.currency_format.decimal_places).toBe(definition.decimal_places);
  expect(before.plans.length).toBeGreaterThan(0);
  await financialReady();
  await expect(priceForm.locator(".price-card")).toHaveCount(
    before.plans.length,
  );
  const updates = [];
  for (const [index, plan] of before.plans.entries()) {
    expect(plan.amount).toBe("");
    expect(plan.available).toBe(false);
    const row = priceForm.locator(".price-card").nth(index);
    await expect(row).toHaveAttribute("data-plan", plan.plan_id);
    await expect(row).toContainText("未设置价格");
    const amount =
      fixturePrices[definition.code][
        index % fixturePrices[definition.code].length
      ];
    await row.locator('input[name$="-amount"]').fill(amount);
    await row.locator(`[name="price-${index}-available"]`).check();
    await row.locator(`[name="price-${index}-plan-available"]`).check();
    updates.push({
      plan_id: plan.plan_id,
      amount,
      available: true,
      plan_available: true,
    });
  }
  const savedResult = waitForPost("/admin/plan-prices");
  await priceForm.locator('button[type="submit"]').click();
  const savedResponse = await savedResult;
  expect(savedResponse.ok()).toBe(true);
  expect(savedResponse.request().postDataJSON()).toEqual({
    revision: before.revision,
    currency: definition.code,
    prices: updates,
  });
  const saved = (await savedResponse.json()).data;
  expect(saved.revision).toBeGreaterThan(before.revision);
  expect(saved.plans).toHaveLength(before.plans.length);
  for (const expected of updates) {
    const actual = saved.plans.find(
      (plan) => plan.plan_id === expected.plan_id,
    );
    expect(actual).toMatchObject(expected);
    expect(BigInt(actual.amount_minor)).toBe(
      minorUnits(expected.amount, definition.decimal_places),
    );
  }
  await expect(priceForm.getByRole("status")).toHaveText("套餐价格已保存");
  await financialReady();
  const publicPlans = await json(`/plans?currency=${definition.code}`);
  for (const expected of updates) {
    const actual = publicPlans.find((plan) => plan.id === expected.plan_id);
    expect(actual.available).toBe(true);
    expect(actual.currency_format).toMatchObject({
      code: definition.code,
      prefix: definition.prefix,
      suffix: definition.suffix,
      decimal_places: definition.decimal_places,
    });
    expect(BigInt(actual.price_minor)).toBe(
      minorUnits(expected.amount, definition.decimal_places),
    );
  }
}
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
  expect((await json("/currencies")).default_currency).toBe(
    originalSettings.default_currency,
  );
  // Added currencies are retained; the harness destroys this disposable demo.
  changedSettings = false;
}
try {
  expect((await json("/session")).demo_mode).toBe(true);
  const initialRegistry = await json("/currencies");
  expect(initialRegistry.default_currency).toBe("CNY");
  expect(initialRegistry.currencies.map((item) => item.code)).toEqual(["CNY"]);
  expect(initialRegistry.currencies[0]).toMatchObject({
    enabled: true,
    decimal_places: 2,
  });
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "欢迎回来", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("语言", { exact: true })).toHaveValue("zh-CN");
  await expect(page.getByLabel("币种", { exact: true })).toHaveValue("CNY");
  await expect(
    page.getByLabel("币种", { exact: true }).locator("option"),
  ).toHaveCount(1);
  await expect(
    page.getByLabel("币种", { exact: true }).locator("option"),
  ).toHaveAttribute("value", "CNY");
  await shot("login-desktop");
  await page.getByLabel("语言", { exact: true }).selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Currency", { exact: true })).toHaveValue("CNY");
  await page.reload();
  await expect(page.getByLabel("Language", { exact: true })).toHaveValue("en");
  await expect(page.getByLabel("Currency", { exact: true })).toHaveValue("CNY");
  await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
  await expect(page.getByLabel("币种", { exact: true })).toHaveValue("CNY");

  // Prepare real independent currency prices through the administrator UI.
  await page.getByRole("button", { name: "体验管理后台", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("运营概况");
  originalSettings = await json("/admin/site-settings");
  const originalCNYPlans = await json("/plans?currency=CNY");
  const beforeRegistry = await json("/admin/currencies");
  await page.getByRole("link", { name: "财务设置", exact: true }).click();
  await financialReady();
  await expect(currencyForm.locator(".currency-card")).toHaveCount(1);
  for (const [offset, definition] of fixtureCurrencies.entries()) {
    const index = beforeRegistry.currencies.length + offset;
    await page.getByTestId("add-currency").click();
    await expect(currencyForm.locator(".currency-card")).toHaveCount(index + 1);
    for (const field of ["code", "name", "prefix", "suffix"]) {
      await currencyForm
        .locator(`[name="currency-${index}-${field}"]`)
        .fill(definition[field]);
    }
    await currencyForm
      .locator(`[name="currency-${index}-decimal_places"]`)
      .selectOption(String(definition.decimal_places));
    await currencyForm.locator(`[name="currency-${index}-enabled"]`).check();
  }
  const createdResult = waitForPost("/admin/currencies");
  await currencyForm.locator('button[type="submit"]').click();
  const createdResponse = await createdResult;
  expect(createdResponse.ok()).toBe(true);
  expect(createdResponse.request().postDataJSON()).toEqual({
    revision: beforeRegistry.revision,
    default_currency: "CNY",
    currencies: [
      ...beforeRegistry.currencies.map(writableCurrency),
      ...fixtureCurrencies,
    ],
  });
  const createdRegistry = (await createdResponse.json()).data;
  expect(createdRegistry.revision).toBeGreaterThan(beforeRegistry.revision);
  expect(createdRegistry.default_currency).toBe("CNY");
  await financialReady();
  for (const definition of fixtureCurrencies)
    await saveFixturePrices(definition);
  const afterCNYPlans = await json("/plans?currency=CNY");
  for (const original of originalCNYPlans)
    expect(
      afterCNYPlans.find((plan) => plan.id === original.id).price_minor,
    ).toBe(original.price_minor);
  expect(
    (await json("/currencies")).currencies.map((item) => item.code),
  ).toEqual(["CNY", "JPY", "KWD"]);
  await shot("financial-prices-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await shot("financial-prices-mobile");
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎回来", exact: true }),
  ).toBeVisible();
  await page.getByLabel("币种", { exact: true }).selectOption("JPY");
  await page.reload();
  await expect(page.getByLabel("语言", { exact: true })).toHaveValue("zh-CN");
  await expect(page.getByLabel("币种", { exact: true })).toHaveValue("JPY");
  await page.getByLabel("币种", { exact: true }).selectOption("CNY");
  await page
    .getByRole("button", { name: "体验客户工作台", exact: true })
    .click();
  await expect(page.locator("h1")).toContainText("你好");
  await shot("dashboard-desktop");
  await page.getByRole("link", { name: "选购服务", exact: true }).click();
  const catalogCNY = await json("/plans?currency=CNY");
  const catalogJPY = await json("/plans?currency=JPY");
  const catalogKWD = await json("/plans?currency=KWD");
  const firstPlan = catalogCNY[0];
  const alternatePlan = catalogCNY.find(
    (plan) => plan.region !== firstPlan.region && plan.available,
  );
  expect(alternatePlan).toBeTruthy();
  const summary = page.getByRole("complementary", { name: "订单摘要" });
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
  await expect(summary.locator(".purchase-total strong")).toHaveText(
    amount(alternatePlan),
  );
  await page.getByLabel("币种", { exact: true }).selectOption("JPY");
  await expect(summary).toContainText(alternatePlan.name);
  await expect(page.locator(".catalog-plan")).toHaveCount(
    catalogJPY.filter((plan) => plan.region === alternatePlan.region).length,
  );
  await expect(summary.locator(".purchase-total strong")).toHaveText(
    amount(catalogJPY.find((plan) => plan.id === alternatePlan.id)),
  );
  await expect(page.getByLabel("语言", { exact: true })).toHaveValue("zh-CN");
  await page.getByLabel("币种", { exact: true }).selectOption("KWD");
  const kwdPlan = catalogKWD.find((plan) => plan.id === alternatePlan.id);
  expect(kwdPlan.currency_format).toMatchObject({
    code: "KWD",
    decimal_places: 3,
    prefix: "",
    suffix: " KD",
  });
  await expect(summary.locator(".purchase-total strong")).toHaveText(
    amount(kwdPlan),
  );
  await expect(summary.locator(".purchase-total")).toContainText(/\.\d{3} KD/);
  await expect(page.getByLabel("语言", { exact: true })).toHaveValue("zh-CN");
  await page.getByLabel("币种", { exact: true }).selectOption("CNY");
  await expect(summary.locator(".purchase-total strong")).toHaveText(
    amount(alternatePlan),
  );
  await page.getByRole("button", { name: "全部区域", exact: true }).click();
  await page
    .getByRole("button", { name: `选择套餐 ${firstPlan.name}`, exact: true })
    .click();
  await expect(summary.locator(".purchase-total strong")).toHaveText(
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
    quote: {
      price_minor: firstPlan.price_minor,
      decimal_places: firstPlan.currency_format.decimal_places,
      price_revision: firstPlan.price_revision,
    },
  });
  expect(order.currency).toBe("CNY");
  expect(order.plan_name).toBe(firstPlan.name);
  expect(order.total_minor).toBe(firstPlan.price_minor);
  await page.waitForURL("**/orders");
  await page.getByLabel("币种", { exact: true }).selectOption("JPY");
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
  await expect(page.locator(".invoice-document")).toHaveAttribute(
    "aria-busy",
    "false",
  );
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
  const navigation = page.locator("#primary-navigation");
  const navigationTrigger = page.locator(".mobile-menu");
  const navigationClose = navigation.locator(".sidebar-close");
  const currentInvoiceLink = navigation.locator('nav a[aria-current="page"]');
  await page.setViewportSize({ width: 720, height: 844 });
  await expect(navigation).toHaveAttribute("inert");
  await expect(navigation).toHaveAttribute("aria-hidden", "true");
  await expect(navigationTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(navigationTrigger).toHaveAttribute(
    "aria-controls",
    "primary-navigation",
  );
  await navigationTrigger.focus();
  await page.keyboard.press("Shift+Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest(".sidebar")),
  ).toBe(false);
  await page.keyboard.press("Tab");
  await expect(navigationTrigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(navigationTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(navigation).toHaveAttribute("role", "dialog");
  await expect(navigation).toHaveAttribute("aria-modal", "true");
  await expect(page.locator(".main-shell")).toHaveAttribute("inert");
  await expect(currentInvoiceLink).toBeFocused();
  await navigationClose.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    navigation.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(navigationClose).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(navigationTrigger).toBeFocused();
  await expect(navigation).toHaveAttribute("inert");

  await page.keyboard.press("Enter");
  await navigationClose.focus();
  await page.keyboard.press("Enter");
  await expect(navigationTrigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(currentInvoiceLink).toBeFocused();
  await page.setViewportSize({ width: 721, height: 844 });
  await expect(navigation).not.toHaveAttribute("inert");
  await expect(navigation).not.toHaveAttribute("aria-hidden");
  await expect(navigation).not.toHaveAttribute("role");
  await expect(page.locator(".main-shell")).not.toHaveAttribute("inert");
  await expect(page.locator(".sidebar-scrim")).toHaveCount(0);
  await expect(navigationTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(navigationTrigger).not.toBeVisible();
  await expect(currentInvoiceLink).toBeFocused();
  const languageControl = page.getByLabel("语言", { exact: true });
  await languageControl.focus();
  await page.setViewportSize({ width: 720, height: 844 });
  await expect(languageControl).toBeFocused();
  await navigationTrigger.focus();
  await page.keyboard.press("Enter");
  await navigation.getByRole("link", { name: "工作台", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(navigationTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(navigation).toHaveAttribute("inert");
  await expect(page.locator("#main")).toBeFocused();
  await expect(
    page.getByRole("button", { name: "选购套餐", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#main")).toBeFocused();
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
    catalogJPY.filter((plan) => plan.region === alternatePlan.region).length,
  );
  await page
    .getByRole("button", {
      name: `选择套餐 ${alternatePlan.name}`,
      exact: true,
    })
    .click();
  await expect(summary).toContainText(alternatePlan.name);
  await expect(summary.locator(".purchase-total strong")).toHaveText(
    amount(catalogJPY.find((plan) => plan.id === alternatePlan.id)),
  );
  await page.getByLabel("币种", { exact: true }).selectOption("CNY");
  await expect(summary.locator(".purchase-total strong")).toHaveText(
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
  await page.getByRole("link", { name: "版本更新", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("版本更新");
  const updateStatus = await json("/admin/updates");
  expect(updateStatus.current.core_version).toBe(expectedCoreVersion);
  await expect(page.locator(".updates-version").first()).toHaveText(
    expectedCoreVersion,
  );
  await expect(
    page.getByText("尚未检查官方版本。网页不会自动检查或启动安装。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "检查官方更新", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "生成更新交接单", exact: true }),
  ).toHaveCount(0);
  const hostOperation = await json("/admin/updates/operation");
  expect(hostOperation).toEqual({ state: "unconfigured" });
  const operationPanel = page.locator(".native-operation");
  await expect(operationPanel).toHaveAttribute(
    "data-operation-state",
    "unconfigured",
  );
  await expect(
    operationPanel.getByText(
      "主机回执读取未配置，无法确认安装或升级执行状态。",
      { exact: true },
    ),
  ).toBeVisible();
  const receiptRead = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/admin/updates/operation" &&
      response.request().method() === "GET",
  );
  await operationPanel
    .getByRole("button", { name: "读取主机回执", exact: true })
    .click();
  expect((await receiptRead).ok()).toBeTruthy();
  await expect(operationPanel).toHaveAttribute("aria-busy", "false");
  await expect(operationPanel).toHaveAttribute(
    "data-operation-state",
    "unconfigured",
  );
  await shot("updates-local-status-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await shot("updates-local-status-mobile");
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("link", { name: "财务设置", exact: true }).click();
  await financialReady();
  const registryBeforeDefault = await json("/admin/currencies");
  await currencyForm.locator('[name="default_currency"]').selectOption("JPY");
  changedSettings = true;
  const defaultResult = waitForPost("/admin/currencies");
  await currencyForm.locator('button[type="submit"]').click();
  const defaultResponse = await defaultResult;
  expect(defaultResponse.ok()).toBe(true);
  expect(defaultResponse.request().postDataJSON()).toEqual({
    revision: registryBeforeDefault.revision,
    default_currency: "JPY",
    currencies: registryBeforeDefault.currencies.map(writableCurrency),
  });
  expect((await defaultResponse.json()).data.default_currency).toBe("JPY");
  await financialReady();
  expect((await json("/site-settings")).default_currency).toBe("JPY");
  await page.getByRole("link", { name: "站点设置", exact: true }).click();
  await page.locator('input[name="site_name"]').fill("验收测试云");
  await page.locator('input[name="company_name"]').fill("验收测试公司");
  await page.locator('input[name="theme"][value="teal"]').check();
  await page.locator('select[name="default_locale"]').selectOption("en");
  await expect(page.locator('input[name="default_currency"]')).toHaveValue(
    "JPY",
  );
  await expect(page.locator('input[name="default_currency"]')).toHaveAttribute(
    "readonly",
    "",
  );
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
      "JPY",
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

  // Preserve the screenshot fixtures before cancelling newly created orders.
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page
    .getByRole("button", { name: "体验客户工作台", exact: true })
    .click();
  await expect(page.locator("h1")).toContainText("你好");
  await page.getByLabel("币种", { exact: true }).selectOption("CNY");
  const servicesBeforeCancellation = await json("/services");
  await page.getByRole("link", { name: "选购服务", exact: true }).click();
  const cancellationPlan = (await json("/plans?currency=CNY")).find(
    (plan) => plan.id === firstPlan.id,
  );
  await page.getByRole("button", { name: "全部区域", exact: true }).click();
  await page
    .getByRole("button", {
      name: `选择套餐 ${cancellationPlan.name}`,
      exact: true,
    })
    .click();
  await expect(summary.locator(".purchase-total strong")).toHaveText(
    amount(cancellationPlan),
  );
  await page.getByRole("button", { name: "确认配置", exact: true }).click();
  await page
    .getByLabel("服务器名称", { exact: true })
    .fill("qa-browser-admin-cancel");
  await page.locator("dialog[open]").getByRole("checkbox").check();
  const adminTargetResult = waitForPost("/orders");
  await page
    .getByRole("button", { name: "创建待付款订单", exact: true })
    .click();
  const adminTargetResponse = await adminTargetResult;
  expect(adminTargetResponse.status()).toBe(201);
  const adminTarget = (await adminTargetResponse.json()).data;
  await page.waitForURL("**/orders");
  const adminTargetInvoice = (await json("/invoices")).find(
    (item) => item.order_id === adminTarget.id,
  );
  const customerPair = await cancelThroughUI(
    order,
    invoice,
    "浏览器客户验收取消未付款订单",
  );
  await page.getByRole("link", { name: "工作台", exact: true }).click();
  const customerOverview = await json("/overview?currency=CNY");
  await expect(
    page
      .locator(".stat-card")
      .filter({ hasText: "待付款账单" })
      .locator(".stat-value"),
  ).toHaveText(new RegExp(`^${customerOverview.pending_invoices}\\s*笔$`));
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("button", { name: "体验管理后台", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("运营概况");
  await page.getByRole("link", { name: "订单管理", exact: true }).click();
  await expect(
    page.locator(`tr[data-order-id="${order.id}"] .badge`),
  ).toHaveText("已取消");
  const adminPair = await cancelThroughUI(
    adminTarget,
    adminTargetInvoice,
    "浏览器管理员验收取消未付款订单",
    true,
  );
  await page.getByRole("link", { name: "运营总览", exact: true }).click();
  const adminOverview = await json("/admin/overview?currency=CNY");
  await expect(
    page
      .locator(".stat-card")
      .filter({ hasText: "待付款账单" })
      .locator(".stat-value"),
  ).toHaveText(new RegExp(`^${adminOverview.unpaid_invoices}\\s*笔$`));
  await page.getByRole("link", { name: "审计日志", exact: true }).click();
  for (const cancelledOrder of [order, adminTarget]) {
    const auditRow = page
      .getByRole("row")
      .filter({ hasText: cancelledOrder.id });
    await expect(auditRow.filter({ hasText: "order.cancelled" })).toHaveCount(
      1,
    );
  }
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page
    .getByRole("button", { name: "体验客户工作台", exact: true })
    .click();
  await expect(page.locator("h1")).toContainText("你好");
  const customerHistory = await cancellationState();
  expect(customerHistory.services).toEqual(servicesBeforeCancellation);
  for (const pair of [customerPair, adminPair]) {
    expect(
      customerHistory.orders.find((item) => item.id === pair.order.id),
    ).toEqual(pair.order);
    expect(
      customerHistory.invoices.find((item) => item.id === pair.invoice.id),
    ).toEqual(pair.invoice);
    expect(
      customerHistory.audit.filter(
        (event) =>
          event.action === "order.cancelled" && event.target === pair.order.id,
      ),
    ).toHaveLength(1);
  }
  await page.getByRole("link", { name: "我的订单", exact: true }).click();
  for (const pair of [customerPair, adminPair]) {
    const historyRow = page.locator(`tr[data-order-id="${pair.order.id}"]`);
    await expect(historyRow.locator(".badge")).toHaveText("已取消");
    await expect(
      historyRow.getByRole("button", { name: "取消订单", exact: true }),
    ).toHaveCount(0);
  }
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("button", { name: "体验管理后台", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("运营概况");
  await restoreSettings();
  expect(errors).toEqual([]);
  expect(blockedRequests).toEqual([]);
  console.log(
    "PASS: real demo API, fresh CNY-only registry, JPY zero-decimal and KWD three-decimal currencies and independent prices saved through financial UI with exact revisioned payloads, independent persistent preferences, CNY server-priced order, unchanged history currency, payment fail-closed, dialogs/search, desktop/mobile region filters and live selection summaries, currency refresh, mobile navigation/overflow, SMTP disabled/no-key read-only state, actual core version, update status, unconfigured host receipt and explicit read-only receipt refresh without automatic check or handoff, financial default JPY and read-only site currency, admin settings save/preview, new-visitor English/JPY defaults, immutable invoice issuer, explicit customer/admin cancellation with required reason and confirmation, no mutation on opening/closing/incomplete confirmation, retained order/invoice snapshots with cancelled/void statuses, exact unpaid summary deductions and unchanged services/other-currency totals, one audit per cancellation and idempotent repeats, customer history retained across sessions, original site/default settings restored while added demo currencies remain until disposable teardown; no browser runtime errors.",
  );
} finally {
  try {
    await restoreSettings();
  } finally {
    await browser.close();
  }
}

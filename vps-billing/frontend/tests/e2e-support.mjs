// New-console browser helpers. Only the supervisor-owned loopback demo is a real target.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";

export const syntheticAccounts = {
  customer: { email: "demo@aster.local", password: "DemoCustomer!2026" },
  admin: { email: "admin@aster.local", password: "DemoAdmin!2026" },
  other: { email: "other@aster.local", password: "DemoOther!2026" },
};
export const widths = [320, 375, 720, 721, 768, 1440];
export const dialog = (page) => page.getByRole("dialog").last();
export function strictBase(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "http:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.ok(
    url.port &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash,
  );
  return url.origin;
}
export async function selectedCoreVersion() {
  let current = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++, current = dirname(current)) {
    try {
      const text = await readFile(
        join(current, "backend/pkg/pluginapi/protocol.go"),
        "utf8",
      );
      const declarations = [
        ...text.matchAll(
          /^\s*CoreVersion\s*=\s*"((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))"\s*$/gm,
        ),
      ];
      assert.equal(declarations.length, 1);
      return declarations[0][1];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error("Selected-source CoreVersion not found");
}
export async function apiData(context, base, path) {
  assert.ok(path.startsWith("/api/v1/") && !path.includes(".."));
  const response = await context.request.get(base + path, { maxRedirects: 0 });
  assert.equal(response.status(), 200, `Loopback GET ${path.split("?")[0]}`);
  const body = await response.json();
  assert.ok(Object.hasOwn(body, "data"));
  return body.data;
}
export async function createScreen(browser, base, storageState) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
    ...(storageState ? { storageState } : {}),
  });
  const state = {
    requests: [],
    writes: [],
    violations: [],
    pageErrors: [],
    permits: new Map(),
    fixtures: [],
  };
  // One dispatcher: fixtures cannot bypass the origin or explicit-mutation guard.
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      key = `${request.method()} ${url.pathname}`;
    if (url.origin !== base || !["http:", "https:"].includes(url.protocol)) {
      state.violations.push("cross-origin request");
      await route.abort("blockedbyclient");
      return;
    }
    state.requests.push({ method: request.method(), path: url.pathname });
    if (!["GET", "HEAD"].includes(request.method())) {
      const remaining = state.permits.get(key) || 0;
      if (remaining < 1) {
        state.violations.push(`unapproved ${key}`);
        await route.abort("blockedbyclient");
        return;
      }
      state.permits.set(key, remaining - 1);
      state.writes.push({
        method: request.method(),
        path: url.pathname,
        body: request.postDataJSON(),
        headers: request.headers(),
      });
    }
    const fixture = state.fixtures.findLast(
      (item) => item.method === request.method() && item.path === url.pathname,
    );
    if (fixture) {
      await route.fulfill({
        status: fixture.status || 200,
        contentType: "application/json",
        body: JSON.stringify(
          fixture.error
            ? { error: fixture.error }
            : {
                data:
                  typeof fixture.data === "function"
                    ? fixture.data({ url, request })
                    : structuredClone(fixture.data),
              },
        ),
      });
      return;
    }
    await route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", () => state.pageErrors.push("uncaught page error"));
  context.on("page", (extra) => {
    if (extra !== page) state.violations.push("unexpected popup");
  });
  const session = await apiData(context, base, "/api/v1/session");
  assert.equal(
    session.demo_mode,
    true,
    "A real production API must never receive browser acceptance mutations",
  );
  return { context, page, state };
}
export function permit(state, path, count = 1) {
  const key = `POST /api/v1${path}`;
  assert.equal(state.permits.get(key) || 0, 0);
  state.permits.set(key, count);
}
export function fixture(state, method, path, data, status = 200) {
  const value = { method, path: "/api/v1" + path, data, status };
  state.fixtures.push(value);
  return () => {
    state.fixtures = state.fixtures.filter((item) => item !== value);
  };
}
export async function goto(page, base, route) {
  // Every full navigation mounts the real shell, which reads site defaults only
  // after session/registry readiness. Do not inspect stale fallback branding.
  const settings = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/site-settings" &&
      response.request().method() === "GET" &&
      response.status() === 200,
  );
  await page.goto(`${base}/#${route}`, { waitUntil: "domcontentloaded" });
  await (await settings).finished();
  await expect(page.locator("#main-content")).toBeVisible();
  await settle(page);
}
export async function assertBrandIdentity(page, expected) {
  const brand = page.locator(".idc-topbar .brand");
  await expect(brand).toHaveAttribute("title", expected);
  await expect(brand).toHaveAttribute("aria-label", expected);
  const label = brand.locator(":scope > span:last-child");
  const clipped = await label.evaluate((node) => {
    const css = getComputedStyle(node);
    return (
      node.scrollWidth <= node.clientWidth + 1 ||
      (css.textOverflow === "ellipsis" &&
        css.overflowX === "hidden" &&
        css.whiteSpace === "nowrap")
    );
  });
  assert.equal(
    clipped,
    true,
    "Long branding may ellipsize only with the full title and accessible name retained",
  );
}
export async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}
export async function closePanel(page) {
  const panel = dialog(page);
  await panel.locator(".panel-header button[aria-label]").click();
  await expect(panel).toBeHidden();
}
export async function selectOption(page, combobox, value) {
  await combobox.click();
  await expect(combobox).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("option", { name: value, exact: true }).click();
  await expect(combobox).toHaveAttribute("aria-expanded", "false");
}
export async function locale(page, target) {
  const current = await page.locator("html").getAttribute("lang");
  if (current === target) return;
  await page.locator(".locale-trigger").click();
  await selectOption(
    page,
    dialog(page).getByRole("combobox", { name: /^(语言|Language)$/ }),
    target === "en" ? "English" : "简体中文",
  );
  await closePanel(page);
  await expect(page.locator("html")).toHaveAttribute("lang", target);
}
export async function accountMenu(page) {
  if (await page.locator(".idc-sidebar .account-trigger").isVisible())
    await page.locator(".idc-sidebar .account-trigger").click();
  else {
    await page
      .getByRole("button", { name: /^(打开导航|Open navigation)$/ })
      .click();
    await dialog(page)
      .getByRole("button", { name: /^(账户|Account)$/ })
      .click();
  }
  await expect(dialog(page).locator(".account-menu")).toBeVisible();
}
export async function appearance(page, target) {
  await accountMenu(page);
  await dialog(page)
    .getByRole("button", {
      name: target === "light" ? /^(浅色|Light)$/ : /^(深色|Dark)$/,
    })
    .click();
  await closePanel(page);
  await expect(page.locator("html")).toHaveAttribute("data-appearance", target);
}
export async function login(screen, base, identity) {
  const { page, context, state } = screen;
  await goto(page, base, "/catalog");
  await page.locator(".header-login").click();
  const panel = dialog(page);
  await panel
    .locator("input[type=email]")
    .fill(syntheticAccounts[identity].email);
  await panel
    .locator("input[autocomplete=current-password]")
    .fill(syntheticAccounts[identity].password);
  permit(state, "/auth/login");
  await panel
    .getByRole("button", { name: /^(登录|Sign in)$/, exact: true })
    .click();
  await expect(panel).toBeHidden();
  await expect(page.locator(".header-login")).toHaveCount(0);
  const session = await apiData(context, base, "/api/v1/session");
  assert.equal(session.user?.role, identity === "admin" ? "admin" : "customer");
  return session.user;
}
export async function logout(screen, base) {
  await accountMenu(screen.page);
  permit(screen.state, "/auth/logout");
  await dialog(screen.page)
    .getByRole("button", { name: /^(退出登录|Sign out)$/ })
    .click();
  await expect(screen.page.locator(".header-login")).toBeVisible();
  const session = await apiData(screen.context, base, "/api/v1/session");
  assert.equal(session.user, null);
}
export async function noOverflow(page) {
  const width = await page.evaluate(() => ({
    viewport: innerWidth,
    scroll: Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    ),
  }));
  assert.ok(
    width.scroll <= width.viewport + 1,
    "The document must not scroll horizontally",
  );
}
export async function accessiblePanel(page) {
  const panel = dialog(page);
  await expect(panel).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("#workspace-shell")).toHaveAttribute("inert", "");
  const controls = panel.locator(
    "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[role=combobox]:not(:disabled),a[href]",
  );
  const first = controls.first();
  await first.focus();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    assert.equal(
      await panel.evaluate((node) => node.contains(document.activeElement)),
      true,
      "Tab stays within the active panel",
    );
  }
  const footer = panel.locator(".panel-footer");
  if (await footer.count()) {
    await footer.scrollIntoViewIfNeeded();
    const box = await footer.boundingBox();
    assert.ok(
      box &&
        box.y >= -1 &&
        box.y + box.height <= page.viewportSize().height + 1,
    );
  }
  await noOverflow(page);
}
export function assertScreenSafe(screen) {
  assert.deepEqual(screen.state.violations, []);
  assert.deepEqual(screen.state.pageErrors, []);
  for (const remaining of screen.state.permits.values())
    assert.equal(
      remaining,
      0,
      "Every allowed mutation must have been the expected explicit request",
    );
}
export function exactMoney(minor, format, grouped = false) {
  assert.ok(Number.isSafeInteger(minor));
  const digits = BigInt(minor)
    .toString()
    .padStart(format.decimal_places + 1, "0");
  let whole = format.decimal_places
    ? digits.slice(0, -format.decimal_places)
    : digits;
  if (grouped) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${format.prefix}${whole}${format.decimal_places ? "." + digits.slice(-format.decimal_places) : ""}${format.suffix}`;
}

// 28 new-console invoice cases: four real viewport geometries × snapshot precision 0–6.
// These are read-only historical DTO fixtures, never new-order prices or conversions.
export async function probeHistoricalCheckout(browser, base, customerStorage) {
  const screen = await createScreen(browser, base, customerStorage),
    { page, state } = screen;
  let count = 0;
  try {
    for (const viewport of [
      { width: 320, height: 640 },
      { width: 375, height: 480 },
      { width: 844, height: 375 },
      { width: 1440, height: 1100 },
    ])
      for (let precision = 0; precision <= 6; precision++) {
        const id = "f".repeat(30) + String(precision).padStart(2, "0");
        const format = {
          code: precision === 3 ? "KWD" : "XTS",
          name: "Synthetic historical currency",
          prefix: "P".repeat(24),
          suffix: "S".repeat(24),
          decimal_places: precision,
        };
        const invoice = {
          id,
          number: `INV-SYNTHETIC-${precision}`,
          order_id: "e".repeat(32),
          status: precision === 3 ? "paid" : "unpaid",
          amount_minor: Number.MAX_SAFE_INTEGER,
          currency: format.code,
          currency_format: format,
          issued_at: "2026-01-01T00:00:00Z",
          due_at: "2026-02-01T00:00:00Z",
          ...(precision === 3 ? { paid_at: "2026-01-02T00:00:00Z" } : {}),
          issuer: {
            name: "Synthetic historical issuer",
            address: "Read-only fixture; no tax-invoice claim",
            support_email: "synthetic@example.invalid",
          },
        };
        const removeList = fixture(state, "GET", "/invoices", [invoice]);
        const removeDetails = fixture(state, "GET", "/invoices/" + id, invoice);
        await page.setViewportSize(viewport);
        await goto(page, base, "/invoices");
        await expect(page.locator(".ui-loading")).toHaveCount(0);
        await page.locator(".record-row").getByRole("button").click();
        const panel = dialog(page),
          total = panel.locator(".detail-hero strong");
        await expect(total).toHaveText(
          exactMoney(invoice.amount_minor, format) + " " + format.code,
        );
        await total.scrollIntoViewIfNeeded();
        const geometry = await total.evaluate((node) => {
          const r = node.getBoundingClientRect(),
            parent = node.closest(".panel-body").getBoundingClientRect(),
            range = document.createRange();
          range.selectNodeContents(node);
          const text = range.getBoundingClientRect();
          return {
            width: r.width,
            left: text.left,
            right: text.right,
            parent_left: parent.left,
            parent_right: parent.right,
            scroll: node.scrollWidth,
            client: node.clientWidth,
          };
        });
        assert.ok(
          geometry.width > 0 &&
            geometry.left >= geometry.parent_left - 1 &&
            geometry.right <= geometry.parent_right + 1 &&
            geometry.scroll <= geometry.client + 1,
          "The entire historical amount must wrap without clipping",
        );
        if (invoice.status === "paid")
          await expect(
            panel.getByRole("button", {
              name: /^(前往付款|Continue to payment)$/,
            }),
          ).toHaveCount(0);
        await accessiblePanel(page);
        await panel
          .getByRole("button", { name: /^(重读账单|Reload invoice)$/ })
          .click();
        await expect(total).toHaveText(
          exactMoney(invoice.amount_minor, format) + " " + format.code,
        );
        await closePanel(page);
        removeList();
        removeDetails();
        count++;
      }
    assert.equal(
      state.writes.length,
      0,
      "Historical rendering must never prepare payment or write business state",
    );
    assertScreenSafe(screen);
    return count;
  } finally {
    await screen.context.close();
  }
}

// Actual preference controls and reloads, never localStorage/DOM assignment.
// The registry/defaults/independent quotes are explicit GET fixtures; only login
// and logout reach the owned demo API. Disabled JPY is reporting-only history.
export async function probePreferencePersistence(browser, base) {
  const screen = await createScreen(browser, base),
    { context, page, state } = screen;
  try {
    const site = await apiData(context, base, "/api/v1/site-settings");
    const plans = await apiData(context, base, "/api/v1/plans?currency=CNY");
    const usage = {
      plan_prices: 1,
      orders: 1,
      invoices: 1,
      services: 0,
      pending_orders: 0,
      unpaid_invoices: 0,
      ongoing_services: 0,
    };
    const currencies = [
      {
        code: "CNY",
        name: "人民币",
        prefix: "¥",
        suffix: "",
        decimal_places: 2,
        enabled: true,
      },
      {
        code: "USD",
        name: "US Dollar",
        prefix: "$",
        suffix: "",
        decimal_places: 2,
        enabled: true,
      },
      {
        code: "JPY",
        name: "Historical JPY",
        prefix: "¥",
        suffix: "",
        decimal_places: 0,
        enabled: false,
      },
    ].map((value, sort_order) => ({
      ...value,
      sort_order,
      precision_locked: true,
      usage,
    }));
    const registry = { revision: 7, default_currency: "USD", currencies };
    fixture(state, "GET", "/site-settings", {
      ...site,
      default_locale: "en",
      default_currency: "USD",
    });
    fixture(state, "GET", "/currencies", registry);
    fixture(state, "GET", "/admin/currencies", registry);
    fixture(state, "GET", "/plans", ({ url }) => {
      const code = url.searchParams.get("currency"),
        format = currencies.find((value) => value.code === code);
      assert.ok(
        format?.enabled,
        "Only a currently enabled currency may request new-order quotes",
      );
      return plans.map((plan) => ({
        ...plan,
        currency: code,
        currency_format: {
          code,
          name: format.name,
          prefix: format.prefix,
          suffix: format.suffix,
          decimal_places: format.decimal_places,
        },
        price_minor: code === "USD" ? 1234 : 3900,
      }));
    });
    fixture(state, "GET", "/admin/overview", ({ url }) => {
      const code = url.searchParams.get("currency"),
        format = currencies.find((value) => value.code === code);
      assert.ok(format);
      return {
        customers: 3,
        total_services: 0,
        unpaid_invoices: 0,
        unpaid_total_minor: 0,
        revenue_minor: 0,
        currency: code,
        currency_format: format,
        count_scope: "currency",
        customers_scope: "all",
      };
    });
    async function loaded() {
      await expect(
        page.locator(".ui-loading,.gh-loading,.gfo-loading"),
      ).toHaveCount(0);
      await settle(page);
    }
    async function chooseCurrency(code, reporting) {
      await page.locator(".locale-trigger").click();
      const panel = dialog(page),
        combo = panel.getByRole("combobox", {
          name: reporting
            ? /^(报表币种|Report currency)$/
            : /^(购买币种|Purchase currency)$/,
        });
      await combo.click();
      if (!reporting)
        await expect(page.getByRole("option", { name: /JPY$/ })).toHaveCount(0);
      await page.getByRole("option", { name: new RegExp(code + "$") }).click();
      await closePanel(page);
      await expect(page.locator(".locale-currency")).toHaveText(code);
    }
    await goto(page, base, "/catalog");
    await loaded();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator(".locale-currency")).toHaveText("USD");
    await expect(page.locator(".gpc-currency-tag").first()).toHaveText("USD");
    await locale(page, "zh-CN");
    await chooseCurrency("CNY", false);
    await appearance(page, "light");
    await page.reload();
    await loaded();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.locator("html")).toHaveAttribute(
      "data-appearance",
      "light",
    );
    await expect(page.locator(".locale-currency")).toHaveText("CNY");
    await expect(page.locator(".gpc-currency-tag").first()).toHaveText("CNY");
    await login(screen, base, "customer");
    await expect(page.locator(".locale-currency")).toHaveText("CNY");
    await logout(screen, base);
    await login(screen, base, "admin");
    await goto(page, base, "/admin/finance");
    await loaded();
    await chooseCurrency("USD", true);
    await page.reload();
    await loaded();
    await expect(page.locator(".locale-currency")).toHaveText("USD");
    await chooseCurrency("JPY", true);
    // Real SPA navigation preserves this report selection without changing the
    // separate customer preference. A browser reload resets reporting only.
    await page.locator(".brand").click();
    await loaded();
    await page.locator('.idc-sidebar a[href="#/catalog"]').click();
    await loaded();
    await expect(page.locator(".locale-currency")).toHaveText("CNY");
    await expect(page.locator(".gpc-currency-tag").first()).toHaveText("CNY");
    await page.locator(".mode-link button").click();
    await loaded();
    await page.locator('.idc-sidebar a[href="#/admin/finance"]').click();
    await loaded();
    await expect(page.locator(".locale-currency")).toHaveText("JPY");
    await page.reload();
    await loaded();
    await expect(page.locator(".locale-currency")).toHaveText("USD");
    await page.locator(".brand").click();
    await loaded();
    await expect(page.locator(".locale-currency")).toHaveText("CNY");
    await page.reload();
    await loaded();
    await expect(page.locator(".locale-currency")).toHaveText("CNY");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.locator("html")).toHaveAttribute(
      "data-appearance",
      "light",
    );
    assert.ok(
      state.writes.every((value) =>
        ["/api/v1/auth/login", "/api/v1/auth/logout"].includes(value.path),
      ),
      "Preference checks cannot write settings, prices, orders or handoffs",
    );
    await logout(screen, base);
    assertScreenSafe(screen);
    return true;
  } finally {
    await context.close();
  }
}

import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const adminID = "9".repeat(32),
  customerID = "1".repeat(32),
  productID = "2".repeat(32),
  orderID = "4".repeat(32);
const formats = [
  { code: "CNY", name: "人民币", prefix: "¥", suffix: "", decimal_places: 2 },
  { code: "JPY", name: "日元", prefix: "¥", suffix: "", decimal_places: 0 },
  { code: "KWD", name: "KWD", prefix: "", suffix: "", decimal_places: 3 },
];
const site = {
  revision: 1,
  default_locale: "zh-CN",
  default_currency: "CNY",
  site_name: "星屿云",
  company_name: "星屿云计算",
  logo: "star",
  theme: "blue",
  support_email: "",
  support_url: "",
  display_url: "",
};
const registry = {
  revision: 1,
  default_currency: "CNY",
  currencies: formats.map((c, i) => ({
    ...c,
    enabled: true,
    sort_order: i,
    precision_locked: true,
  })),
};
const account = {
  id: customerID,
  email: "customer@example.invalid",
  name: "合成客户",
  role: "customer",
  disabled: false,
  revision: 3,
};
const product = {
  id: productID,
  name: "弹性计算套餐",
  description: "按实际业务配置独立规格与报价，不自动开通资源。",
  cpu: 2,
  memory_gb: 4,
  disk_gb: 80,
  transfer_tb: 2,
  region: "新加坡",
  available: true,
  prices: [
    { currency: "CNY", amount_minor: 3900, available: true },
    { currency: "JPY", amount_minor: 2000, available: true },
    { currency: "KWD", amount_minor: 1234, available: true },
  ],
};
const order = {
  id: orderID,
  number: "ORD-SYNTHETIC",
  plan_name: "当前资料不补造历史规格",
  status: "pending_payment",
  total_minor: 3900,
  currency: "CNY",
  currency_format: formats[0],
  created_at: "2026-10-20T08:00:00Z",
  plan_snapshot: {
    plan_id: productID,
    name: "历史成交套餐",
    cpu: 1,
    memory_gb: 2,
    disk_gb: 40,
    transfer_tb: 1,
    region: "成交时地区",
    billing_cycle: "monthly",
  },
};
const invoice = {
  id: "5".repeat(32),
  number: "INV-SYNTHETIC",
  order_id: orderID,
  status: "unpaid",
  amount_minor: 3900,
  currency: "CNY",
  currency_format: formats[0],
  issued_at: "2026-10-20T08:00:00Z",
  due_at: "2026-10-27T08:00:00Z",
  issuer: { name: "历史开具方", address: "历史地址", support_email: "" },
};
const scenarios = [
  {
    name: "management-account-late-role-change-zh",
    path: "/customers",
    width: 1440,
    height: 1100,
    kind: "lateidentity",
  },
  {
    name: "management-customers-desktop-zh",
    path: "/customers",
    width: 1440,
    height: 1100,
    kind: "accounts",
  },
  {
    name: "management-account-create-mobile-zh",
    path: "/customers",
    width: 375,
    height: 844,
    kind: "create",
  },
  {
    name: "management-account-conflict-mobile-en",
    path: "/customers",
    width: 375,
    height: 480,
    locale: "en",
    kind: "conflict",
  },
  {
    name: "management-account-first-error-zh",
    path: "/customers",
    width: 375,
    height: 844,
    kind: "readerror",
  },
  {
    name: "management-catalog-desktop-zh",
    path: "/catalog",
    width: 1440,
    height: 1100,
    kind: "catalog",
  },
  {
    name: "management-catalog-editor-mobile-zh",
    path: "/catalog?edit=" + productID,
    width: 375,
    height: 844,
    kind: "editor",
  },
  {
    name: "management-catalog-exact-prices-en",
    path: "/catalog?edit=new",
    width: 375,
    height: 844,
    locale: "en",
    kind: "prices",
  },
  {
    name: "management-order-long-short-en",
    path: "/orders/" + orderID,
    width: 320,
    height: 480,
    locale: "en",
    kind: "longorder",
  },
  {
    name: "management-order-customer-mobile-zh",
    path: "/orders/" + orderID,
    width: 375,
    height: 844,
    kind: "customerorder",
    customer: true,
  },
  {
    name: "management-order-not-found-en",
    path: "/orders/" + orderID,
    width: 375,
    height: 844,
    locale: "en",
    kind: "notfound",
  },
];
export async function managementFixture(browser, base, scenario, results) {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname))
    throw Error("Management probes require disposable loopback");
  const context = await browser.newContext({
    viewport: { width: scenario.width, height: scenario.height },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
    locale: scenario.locale ?? "zh-CN",
  });
  let releaseLate;
  const late = new Promise((resolve) => {
    releaseLate = resolve;
  });
  const state = {
    signedIn: true,
    role: scenario.customer ? "customer" : "admin",
    accounts: [structuredClone(account)],
    items: [structuredClone(product)],
    revision: 7,
    accountReads: 0,
    writes: [],
    requests: [],
  };
  if (scenario.kind === "longorder")
    state.accounts[0].email =
      "e".repeat(64) + "@" + "d".repeat(60) + ".invalid";
  await context.addInitScript((language) => {
    localStorage.setItem("aster.locale", language);
    localStorage.setItem("aster.currency", "CNY");
  }, scenario.locale ?? "zh-CN");
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace(/^\/api\/v1/, ""),
      method = request.method();
    if (url.origin !== new URL(base).origin) {
      results.blocked.push("external request");
      return route.abort("blockedbyclient");
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    state.requests.push({
      path,
      method,
      params: Object.fromEntries(url.searchParams),
    });
    const reply = (data, status = 200) =>
      route.fulfill({ status, json: { data } });
    const failure = (code, status) =>
      route.fulfill({
        status,
        headers: { "X-Request-ID": "f".repeat(32) },
        json: { error: { code, message: "synthetic-storage-secret" } },
      });
    if (method !== "GET") {
      const body = request.postDataJSON();
      if (
        scenario.kind === "lateidentity" &&
        ["/auth/logout", "/auth/login"].includes(path)
      ) {
        results.syntheticAuthWrites = (results.syntheticAuthWrites ?? 0) + 1;
        state.signedIn = path === "/auth/login";
        if (state.signedIn) state.role = "customer";
        return reply({ ok: true });
      }

      if (
        method !== "POST" ||
        !["/admin/customer-accounts", "/admin/catalog"].some(
          (prefix) => path === prefix || path.startsWith(prefix + "/"),
        )
      ) {
        results.blocked.push(method + " " + path);
        return route.abort("blockedbyclient");
      }
      state.writes.push({ path, body });
      results.syntheticWrites++;
      if (scenario.kind === "conflict") return failure("ACCOUNT_CONFLICT", 409);
      if (path === "/admin/customer-accounts") {
        const row = {
          ...account,
          id: "6".repeat(32),
          name: body.name,
          email: body.email,
          role: body.role,
          revision: 1,
        };
        state.accounts.push(row);
        return reply(row, 201);
      }
      if (path.startsWith("/admin/customer-accounts/")) {
        const row = state.accounts.find((c) => path.split("/")[3] === c.id);
        if (!row) return failure("NOT_FOUND", 404);
        row.revision++;
        if (!path.endsWith("/password") && !path.endsWith("/revoke-sessions"))
          Object.assign(row, {
            name: body.name,
            role: body.role,
            disabled: body.disabled,
          });
        return reply(row);
      }
      state.revision++;
      let item;
      if (path.endsWith("/duplicate")) {
        item = {
          ...structuredClone(product),
          id: "7".repeat(32),
          available: false,
        };
        state.items.push(item);
      } else if (path === "/admin/catalog") {
        item = { ...body, id: "7".repeat(32) };
        delete item.revision;
        delete item.reason;
        delete item.currency_revision;
        state.items.push(item);
      } else {
        item = { ...body, id: productID };
        delete item.revision;
        delete item.reason;
        delete item.currency_revision;
        state.items[0] = item;
      }
      return reply({
        revision: state.revision,
        currency_revision: registry.revision,
        plan: item,
      });
    }
    if (path === "/session")
      return reply({
        user: !state.signedIn
          ? null
          : {
              id: adminID,
              name: "Synthetic operator",
              email: "operator@example.invalid",
              role: state.role,
            },
        csrf_token: "synthetic-no-real-writes",
        demo_mode: false,
      });
    if (path === "/site-settings") return reply(site);
    if (["/currencies", "/admin/currencies"].includes(path))
      return reply(registry);
    if (path === "/admin/customer-accounts") {
      state.accountReads++;
      if (scenario.kind === "lateidentity" && state.accountReads === 2)
        await late;
      if (scenario.kind === "readerror" && state.accountReads === 1)
        return failure("INTERNAL_ERROR", 503);
      const isNext = url.searchParams.has("cursor");
      return reply({
        items: isNext
          ? [{ ...account, id: "8".repeat(32), name: "第二页客户" }]
          : state.accounts,
        has_more: scenario.kind === "accounts" && !isNext,
        ...(scenario.kind === "accounts" && !isNext
          ? { next_cursor: "opaque+/=next" }
          : {}),
        limit: 50,
      });
    }
    if (path.startsWith("/admin/customer-accounts/"))
      return reply(
        state.accounts.find((c) => c.id === path.split("/")[3]) ?? account,
      );
    if (path === "/admin/catalog")
      return reply({
        revision: state.revision,
        currency_revision: registry.revision,
        items: state.items,
      });
    if (path === "/admin/customers") return reply(state.accounts);
    if (path === "/admin/overview")
      return reply({
        customers: state.accounts.length,
        total_services: 0,
        unpaid_invoices: 1,
        unpaid_total_minor: 3900,
        revenue_minor: 0,
        currency: "CNY",
        currency_format: formats[0],
      });
    if (path === "/overview")
      return reply({
        active_services: 0,
        pending_invoices: 1,
        unpaid_total_minor: 3900,
        monthly_total_minor: 0,
        currency: "CNY",
        currency_format: formats[0],
        recent_orders: [order],
      });
    if (["/admin/orders", "/orders"].includes(path)) return reply([order]);
    if (["/admin/invoices", "/invoices"].includes(path))
      return reply([invoice]);
    if (path === "/admin/orders/" + orderID || path === "/orders/" + orderID) {
      if (scenario.kind === "notfound") return failure("NOT_FOUND", 404);
      const stressed = scenario.kind === "longorder",
        format = stressed
          ? { ...formats[0], prefix: "P".repeat(24), suffix: "S".repeat(24) }
          : formats[0];
      return reply({
        order: {
          ...order,
          ...(stressed
            ? {
                number: "ORD-" + orderID,
                plan_snapshot: {
                  ...order.plan_snapshot,
                  name: "历史成交规格".repeat(8),
                },
                total_minor: Number.MAX_SAFE_INTEGER,
                currency_format: format,
              }
            : {}),
        },
        ...(!scenario.customer ? { customer: state.accounts[0] } : {}),
        invoice: {
          ...invoice,
          ...(stressed
            ? { amount_minor: Number.MAX_SAFE_INTEGER, currency_format: format }
            : {}),
        },
        service: null,
        payment_attempts: [
          {
            id: "a".repeat(32),
            provider_id: "synthetic-provider",
            state: "uncertain",
            amount_minor: Number.MAX_SAFE_INTEGER,
            currency: "KWD",
            currency_decimal_places: 3,
            created_at: "2026-10-20T08:00:00Z",
            updated_at: "2026-10-20T08:05:00Z",
          },
        ],
        audit: [
          {
            id: "b".repeat(32),
            action: "order.created",
            target: orderID,
            actor_email: "operator@example.invalid",
            created_at: "2026-10-20T08:00:00Z",
            detail: "<img src=x onerror=alert(1)> 合成纯文本，不访问系统日志。",
          },
        ],
        audit_has_more: true,
        payment_attempts_has_more: true,
      });
    }
    if (path.startsWith("/admin/invoices/") || path.startsWith("/invoices/"))
      return reply(invoice);
    if (["/audit", "/admin/services", "/services", "/plans"].includes(path))
      return reply([]);
    results.blocked.push("unknown API " + path);
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => results.errors.push(e.message));
  return { context, page, state, releaseLate };
}
export async function probeManagementWorkflows(browser, base, { output } = {}) {
  if (output) await mkdir(output, { recursive: true });
  const results = { cases: [], blocked: [], errors: [], syntheticWrites: 0 };
  try {
    for (const scenario of scenarios) {
      const { context, page, state, releaseLate } = await managementFixture(
        browser,
        base,
        scenario,
        results,
      );
      const en = scenario.locale === "en";
      try {
        await page.goto(base + scenario.path);
        await expect(page.locator(".skeleton-grid")).toHaveCount(0);
        const accounts = page.getByTestId("customer-accounts-page"),
          catalog = page.getByTestId("catalog-page"),
          detail = page.getByTestId("order-details-page");
        if (
          [
            "accounts",
            "create",
            "conflict",
            "readerror",
            "lateidentity",
          ].includes(scenario.kind)
        ) {
          await expect(accounts).toBeVisible();
          if (scenario.kind === "readerror") {
            await expect(accounts.getByRole("alert")).toBeVisible();
            await expect(accounts.locator("[data-account-id]")).toHaveCount(0);
            await expect(accounts).not.toContainText("没有符合条件");
            await accounts
              .getByRole("button", { name: "重试读取", exact: true })
              .click();
          }
          await expect(accounts.locator("[data-account-id]")).toHaveCount(1);
          if (scenario.kind === "lateidentity") {
            await accounts
              .getByRole("button", { name: "刷新账户", exact: true })
              .click();
            await expect.poll(() => state.accountReads).toBe(2);
            await page
              .getByRole("button", { name: "退出登录", exact: true })
              .click();
            await page.locator("#email").fill("operator@example.invalid");
            await page.locator("#password").fill("synthetic-no-real-password");
            await page
              .getByRole("button", { name: "登录工作台", exact: true })
              .click();
            await expect(page.locator("h1")).toContainText("你好");
            releaseLate();
            await expect(
              page.getByTestId("customer-accounts-page"),
            ).toHaveCount(0);
            await expect(page.locator("nav a[href='/customers']")).toHaveCount(
              0,
            );
            await expect(page.locator("nav a[href='/catalog']")).toHaveCount(0);
            await expect(page.locator(".app-shell")).not.toContainText(
              account.email,
            );
            expect(state.accountReads).toBe(2);
          }
          if (scenario.kind === "accounts") {
            const placement = await accounts.evaluate((el) => {
              const cards = [...el.querySelectorAll("[data-account-id]")].map(
                (e) => e.getBoundingClientRect(),
              );
              const footer = el
                .querySelector(".management-pagination")
                .getBoundingClientRect();
              const grid = el
                .querySelector(".account-records")
                .getBoundingClientRect();
              return (
                footer.top >= Math.max(...cards.map((r) => r.bottom)) - 1 &&
                Math.abs(footer.width - grid.width) < 2
              );
            });
            expect(placement).toBe(true);

            await accounts
              .getByRole("button", { name: "下一页", exact: true })
              .click();
            await expect(accounts).toContainText("第二页客户");
            expect(
              state.requests
                .filter((x) => x.path === "/admin/customer-accounts")
                .at(-1).params.cursor,
            ).toBe("opaque+/=next");
            await accounts
              .getByRole("button", { name: "上一页", exact: true })
              .click();
            await expect(accounts).toHaveAttribute("aria-busy", "false");
            await expect(accounts).toContainText(account.name);
            await expect(accounts).toContainText(account.email);
          }
          if (scenario.kind === "create") {
            const trigger = accounts.getByRole("button", {
              name: "创建账户",
              exact: true,
            });
            await trigger.click();
            const dialog = page.locator("dialog[open]");
            await expect(dialog).toBeVisible();
            await dialog.locator('[name="account_name"]').fill("新建合成客户");
            await dialog
              .locator('[name="account_email"]')
              .fill("created@example.invalid");
            await dialog
              .locator('[name="account_password"]')
              .fill("synthetic-only-password");
            await dialog
              .locator('[name="account_confirmation"]')
              .fill("synthetic-only-password");
            await dialog
              .locator('[name="account_reason"]')
              .fill("合成界面创建回归，不写真实API");
            await dialog.locator('[name="account_agreed"]').check();
            await dialog
              .getByRole("button", { name: "确认操作", exact: true })
              .click();
            await expect(dialog).toHaveCount(0);
            expect(state.writes).toHaveLength(1);
            await expect(accounts).toContainText("created@example.invalid");
            await trigger.click();
            await expect(
              page.locator('dialog[open] [name="account_password"]'),
            ).toHaveValue("");
            if (output) {
              const opened = page.locator("dialog[open]");
              await opened.locator(".modal-body").evaluate((el) => {
                el.scrollTop = 0;
              });
              await page.screenshot({
                path: output + "/management-account-dialog-mobile-zh.png",
                animations: "disabled",
              });
              await opened.locator(".modal-body").evaluate((el) => {
                el.scrollTop = el.scrollHeight;
              });
              await expect(
                opened.locator('[name="account_reason"]'),
              ).toBeVisible();
              await page.screenshot({
                path: output + "/management-account-dialog-end-mobile-zh.png",
                animations: "disabled",
              });
            }
            for (let i = 0; i < 14; i++) {
              await page.keyboard.press("Tab");
              expect(
                await page
                  .locator("dialog[open]")
                  .evaluate((el) => el.contains(document.activeElement)),
              ).toBe(true);
            }
            await page.keyboard.press("Escape");
            await expect(page.locator("dialog[open]")).toHaveCount(0);
            await expect(trigger).toBeFocused();
          }
          if (scenario.kind === "conflict") {
            await accounts
              .getByRole("button", { name: "Revoke sessions", exact: true })
              .click();
            const dialog = page.locator("dialog[open]");
            await dialog
              .locator('[name="account_reason"]')
              .fill("synthetic conflict");
            await dialog.locator('[name="account_agreed"]').check();
            await dialog
              .getByRole("button", { name: "Confirm operation", exact: true })
              .click();
            await expect(dialog.getByRole("alert")).toContainText("changed");
            await expect(
              dialog.getByRole("button", {
                name: "Confirm operation",
                exact: true,
              }),
            ).toBeDisabled();
            await expect(dialog).not.toContainText("synthetic-storage-secret");
            expect(state.writes).toHaveLength(1);
          }
        } else if (["catalog", "editor", "prices"].includes(scenario.kind)) {
          await expect(catalog).toBeVisible();
          await expect(catalog).toHaveAttribute("aria-busy", "false");
          if (scenario.kind === "catalog") {
            await expect(catalog).toContainText("完整目录");
            await catalog
              .getByRole("button", { name: "复制为草稿", exact: true })
              .click();
            const dialog = page.locator("dialog[open]");
            await dialog
              .locator('[name="catalog_reason"]')
              .fill("复制合成商品");
            await dialog.locator('[name="catalog_agreed"]').check();
            await dialog
              .getByRole("button", { name: "确认操作", exact: true })
              .click();
            await expect(catalog.locator("[data-product-id]")).toHaveCount(2);
            expect(state.writes[0].path).toBe(
              "/admin/catalog/" + productID + "/duplicate",
            );
            expect(state.items[1].available).toBe(false);
          }
          if (scenario.kind === "editor") {
            await expect(catalog.locator('[name="catalog_name"]')).toHaveValue(
              product.name,
            );
            await expect(catalog.locator('[name="amount_CNY"]')).toHaveValue(
              "39.00",
            );
            expect(
              await catalog
                .locator('[name="amount_CNY"]')
                .evaluate((el) => el.clientWidth),
            ).toBeGreaterThanOrEqual(200);
            await catalog
              .getByRole("button", { name: "返回商品目录", exact: true })
              .click();
            await expect(catalog.locator("[data-product-id]")).toHaveCount(1);
            await page.goBack();
            await expect(catalog.locator('[name="catalog_name"]')).toHaveValue(
              product.name,
            );
          }
          if (scenario.kind === "prices") {
            await catalog
              .locator('[name="catalog_name"]')
              .fill("Exact independent prices");
            await catalog.locator('[name="catalog_region"]').fill("Tokyo");
            for (const [code, value] of [
              ["CNY", "90071992547409.91"],
              ["JPY", "123"],
              ["KWD", "1.234"],
            ]) {
              await catalog.locator('[name="include_' + code + '"]').check();
              await catalog.locator('[name="amount_' + code + '"]').fill(value);
              await catalog.locator('[name="available_' + code + '"]').check();
            }
            await catalog
              .getByRole("button", { name: "Save and publish", exact: true })
              .click();
            const dialog = page.locator("dialog[open]");
            await dialog
              .locator('[name="catalog_reason"]')
              .fill("synthetic exact price check");
            await dialog.locator('[name="catalog_agreed"]').check();
            await dialog
              .getByRole("button", { name: "Confirm operation", exact: true })
              .click();
            await expect(catalog.locator("[data-product-id]")).toHaveCount(2);
            expect(state.writes[0].body.prices).toEqual([
              {
                currency: "CNY",
                amount_minor: Number.MAX_SAFE_INTEGER,
                available: true,
              },
              { currency: "JPY", amount_minor: 123, available: true },
              { currency: "KWD", amount_minor: 1234, available: true },
            ]);
          }
        } else {
          await expect(detail).toBeVisible();
          await expect(detail).toHaveAttribute("aria-busy", "false");
          if (scenario.kind === "notfound") {
            await expect(detail.getByRole("alert")).toContainText("not found");
            await expect(detail.locator(".management-amount")).toHaveCount(0);
          } else {
            await expect(detail).toContainText("KWD 9007199254740.991");
            await expect(detail.locator("img")).toHaveCount(0);
            await expect(detail).toContainText("<img src=x");
            if (scenario.customer) {
              await expect(detail).not.toContainText(account.email);
              await expect(page.locator('nav a[href="/catalog"]')).toHaveCount(
                0,
              );
            } else await expect(detail).toContainText(state.accounts[0].email);
            await detail
              .getByRole("button", {
                name: en ? "View invoice" : "查看关联账单",
                exact: true,
              })
              .click();
            await expect(page.locator(".invoice-modal[open]")).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(page.locator(".invoice-modal[open]")).toHaveCount(0);
            if (scenario.kind === "longorder") {
              await expect(detail.locator(".management-amount")).toHaveText(
                "CNY " +
                  "P".repeat(24) +
                  "90,071,992,547,409.91" +
                  "S".repeat(24),
              );
              const geometry = await detail
                .locator(".management-amount")
                .evaluate((el) => {
                  const r = el.getBoundingClientRect(),
                    range = document.createRange();
                  range.selectNodeContents(el);
                  return (
                    el.scrollWidth <= el.clientWidth + 1 &&
                    [...range.getClientRects()].every(
                      (x) => x.left >= r.left - 1 && x.right <= r.right + 1,
                    )
                  );
                });
              expect(geometry).toBe(true);
            }
          }
        }
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          )
          .toBe(true);
        if (output) {
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({
            path: output + "/" + scenario.name + ".png",
            fullPage: scenario.kind !== "conflict",
            animations: "disabled",
          });
        }
        results.cases.push({
          name: scenario.name,
          width: scenario.width,
          height: scenario.height,
          passed: true,
          writes: state.writes.length,
        });
      } finally {
        releaseLate?.();
        await context.close();
      }
    }
    expect(results.cases).toHaveLength(11);
    expect(results.blocked).toEqual([]);
    expect(results.errors).toEqual([]);
    console.log(
      `PASS: management workflows ${results.cases.length}/11; account paging and explicit mutations, catalog draft/copy and exact independent prices, read-only order snapshots, customer projection, short viewport details and native close/back.`,
    );
    return results;
  } finally {
    if (output)
      await writeFile(
        output + "/results.json",
        JSON.stringify(results, null, 2) + "\n",
      );
  }
}

// Real disposable demo flow, separate from the eleven locally fulfilled cases.
export async function exerciseManagementLive(
  browser,
  page,
  base,
  { output, requireMultiCurrency = true } = {},
) {
  const results = {
    accountWrites: 0,
    catalogWrites: 0,
    customerOrders: 0,
    screenshots: [],
    realDemo: true,
  };
  if (output) await mkdir(output, { recursive: true });
  const capture = async (name, target = page) => {
    if (output) {
      await target.evaluate(() => scrollTo(0, 0));
      await target.screenshot({
        path: output + "/" + name + ".png",
        fullPage: true,
        animations: "disabled",
      });
      results.screenshots.push(name + ".png");
    }
  };
  const responseFor = (target, path) =>
    target.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1" + path &&
        r.request().method() === "POST",
    );
  const accountPage = page.getByTestId("customer-accounts-page"),
    catalogPage = page.getByTestId("catalog-page");
  const publicPlans = async (target = page) => {
    const response = await target.request.get(
      base + "/api/v1/plans?currency=CNY",
    );
    expect(response.status()).toBe(200);
    return (await response.json()).data;
  };
  const suffix = Date.now().toString(36),
    email = "management-" + suffix + "@example.invalid",
    password = "Disposable-browser-only-2026!";
  await page.goto(base + "/customers");
  await expect(accountPage).toHaveAttribute("aria-busy", "false");
  await accountPage
    .getByRole("button", { name: "创建账户", exact: true })
    .click();
  let dialog = page.locator("dialog[open]");
  await dialog.locator('[name="account_name"]').fill("浏览器管理验收账户");
  await dialog.locator('[name="account_email"]').fill(email);
  await dialog.locator('[name="account_password"]').fill(password);
  await dialog.locator('[name="account_confirmation"]').fill(password);
  await dialog
    .locator('[name="account_reason"]')
    .fill("隔离浏览器验收：创建账户");
  await dialog.locator('[name="account_agreed"]').check();
  const createdResponse = responseFor(page, "/admin/customer-accounts");
  await dialog.getByRole("button", { name: "确认操作", exact: true }).click();
  const createdHTTP = await createdResponse;
  expect(createdHTTP.status()).toBe(201);
  const created = (await createdHTTP.json()).data;
  expect(Object.keys(created).sort()).toEqual([
    "disabled",
    "email",
    "id",
    "name",
    "revision",
    "role",
  ]);
  expect(created.role).toBe("customer");
  results.accountWrites++;
  const row = accountPage.locator('[data-account-id="' + created.id + '"]');
  await expect(row).toBeVisible();
  async function accountTask(label, tail, fill) {
    await row.getByRole("button", { name: label, exact: true }).click();
    dialog = page.locator("dialog[open]");
    await expect(dialog.getByRole("status")).toHaveCount(0);
    if (fill) await fill(dialog);
    await dialog
      .locator('[name="account_reason"]')
      .fill("隔离浏览器验收：" + label);
    await dialog.locator('[name="account_agreed"]').check();
    const pending = responseFor(
      page,
      "/admin/customer-accounts/" + created.id + tail,
    );
    await dialog.getByRole("button", { name: "确认操作", exact: true }).click();
    const r = await pending;
    expect(r.status()).toBe(200);
    const data = (await r.json()).data;
    expect(Object.keys(data).sort()).toEqual([
      "disabled",
      "email",
      "id",
      "name",
      "revision",
      "role",
    ]);
    expect(data.revision).toBeGreaterThan(created.revision);
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(accountPage).toHaveAttribute("aria-busy", "false");
    results.accountWrites++;
    return data;
  }
  const promoted = await accountTask("编辑权限", "", async (d) =>
    d.locator('[name="account_role"]').selectOption("admin"),
  );
  expect(promoted.role).toBe("admin");
  await accountTask("重置密码", "/password", async (d) => {
    await d.locator('[name="account_password"]').fill(password + "2");
    await d.locator('[name="account_confirmation"]').fill(password + "2");
  });
  await accountTask("撤销会话", "/revoke-sessions");
  const disabled = await accountTask("编辑权限", "", async (d) =>
    d.locator('[name="account_disabled"]').check(),
  );
  expect(disabled.disabled).toBe(true);
  await capture("live-accounts-desktop-zh");
  await page.goto(base + "/catalog?edit=new");
  await expect(catalogPage).toHaveAttribute("aria-busy", "false");
  await catalogPage
    .locator('[name="catalog_name"]')
    .fill("浏览器验收商品-" + suffix);
  await catalogPage.locator('[name="catalog_region"]').fill("验收地区");
  await catalogPage
    .locator('[name="catalog_description"]')
    .fill("隔离 demo 商品，创建订单不代表真实资源开通。");
  async function confirmCatalog(path) {
    dialog = page.locator("dialog[open]");
    await dialog
      .locator('[name="catalog_reason"]')
      .fill("隔离浏览器验收：商品管理");
    await dialog.locator('[name="catalog_agreed"]').check();
    const pending = responseFor(page, path);
    await dialog.getByRole("button", { name: "确认操作", exact: true }).click();
    const r = await pending;
    expect([200, 201]).toContain(r.status());
    const result = (await r.json()).data;
    expect(Number.isSafeInteger(result.revision)).toBe(true);
    const submitted = r.request().postDataJSON();
    expect(
      Number.isSafeInteger(submitted.currency_revision) &&
        submitted.currency_revision >= 1,
    ).toBe(true);
    expect(result.currency_revision).toBe(submitted.currency_revision);

    results.catalogWrites++;
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(catalogPage).toHaveAttribute("aria-busy", "false");
    return result.plan;
  }
  await catalogPage
    .getByRole("button", { name: "保存为草稿", exact: true })
    .click();
  const draft = await confirmCatalog("/admin/catalog");
  expect(draft.available).toBe(false);
  expect(draft.prices).toEqual([]);
  expect((await publicPlans()).some((p) => p.id === draft.id)).toBe(false);

  await page.goto(base + "/catalog?edit=" + draft.id);
  await expect(catalogPage.locator('[name="catalog_name"]')).toHaveValue(
    draft.name,
  );
  const prices = [
      ["CNY", "12.34", 1234],
      ["JPY", "123", 123],
      ["KWD", "1.234", 1234],
    ],
    configured = [];
  for (const [code, value, minor] of prices) {
    const include = catalogPage.locator('[name="include_' + code + '"]');
    if (await include.count()) {
      await include.check();
      await catalogPage.locator('[name="amount_' + code + '"]').fill(value);
      await catalogPage.locator('[name="available_' + code + '"]').check();
      configured.push({ currency: code, amount_minor: minor, available: true });
    }
  }
  if (requireMultiCurrency) expect(configured).toHaveLength(3);
  await catalogPage
    .getByRole("button", { name: "保存并上架", exact: true })
    .click();
  const published = await confirmCatalog("/admin/catalog/" + draft.id);
  expect(published.available).toBe(true);
  expect(published.prices).toEqual(configured);
  const productRow = catalogPage.locator(
    '[data-product-id="' + draft.id + '"]',
  );
  await productRow
    .getByRole("button", { name: "复制为草稿", exact: true })
    .click();
  const copy = await confirmCatalog(
    "/admin/catalog/" + draft.id + "/duplicate",
  );
  expect(copy.id).not.toBe(draft.id);
  expect(copy.available).toBe(false);
  expect(copy.prices).toEqual(published.prices);
  expect((await publicPlans()).some((p) => p.id === copy.id)).toBe(false);

  await capture("live-catalog-desktop-zh");
  const customerContext = await browser.newContext({
      viewport: { width: 375, height: 844 },
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    }),
    blocked = [];
  try {
    await customerContext.addInitScript(() => {
      localStorage.setItem("aster.locale", "zh-CN");
      localStorage.setItem("aster.currency", "CNY");
    });
    await customerContext.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin !== new URL(base).origin) {
        blocked.push("external");
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    const client = await customerContext.newPage();
    await client.goto(base);
    await client
      .getByRole("button", { name: "体验客户工作台", exact: true })
      .click();
    await expect(client.locator("h1")).toContainText("你好");
    await client.goto(base + "/plans");
    await client
      .locator(".region-options")
      .getByRole("button", { name: "验收地区", exact: true })
      .click();
    await client
      .getByRole("button", { name: "选择套餐 " + draft.name, exact: true })
      .and(client.locator("button:enabled"))
      .click();
    await expect(client.locator(".purchase-total")).toContainText("12.34");
    await client.getByRole("button", { name: "确认配置", exact: true }).click();
    await client
      .getByLabel("服务器名称", { exact: true })
      .fill("management-check-" + suffix);
    await client.locator('dialog[open] input[type="checkbox"]').check();
    const orderResponse = responseFor(client, "/orders");
    await client
      .getByRole("button", { name: "创建待付款订单", exact: true })
      .click();
    const orderHTTP = await orderResponse;
    expect(orderHTTP.status()).toBe(201);
    const purchased = (await orderHTTP.json()).data;
    expect(purchased.total_minor).toBe(1234);
    expect(purchased.currency).toBe("CNY");
    expect(purchased.plan_snapshot.name).toBe(draft.name);
    results.customerOrders++;
    await client.goto(base + "/orders/" + purchased.id);
    await expect(client.getByTestId("order-details-page")).toContainText(
      draft.name,
    );
    await expect(client.getByTestId("order-details-page")).toContainText(
      "12.34",
    );
    await expect(client.getByTestId("order-details-page")).not.toContainText(
      "客户ID",
    );
    await capture("live-order-customer-mobile-zh", client);
    await page.goto(base + "/orders/" + purchased.id);
    await expect(page.getByTestId("order-details-page")).toContainText(
      purchased.number,
    );
    await expect(page.getByTestId("order-details-page")).toContainText(
      "客户ID",
    );
    await capture("live-order-admin-desktop-zh");
    await page.goto(base + "/catalog");
    await expect(
      catalogPage.locator('[data-product-id="' + draft.id + '"]'),
    ).toBeVisible();
    await catalogPage
      .locator('[data-product-id="' + draft.id + '"]')
      .getByRole("button", { name: "下架", exact: true })
      .click();
    const unpublished = await confirmCatalog("/admin/catalog/" + draft.id);
    expect(unpublished.available).toBe(false);
    expect((await publicPlans(client)).some((p) => p.id === draft.id)).toBe(
      false,
    );

    await client.goto(base + "/orders/" + purchased.id);
    await expect(client.getByTestId("order-details-page")).toContainText(
      draft.name,
    );
    await expect(client.getByTestId("order-details-page")).toContainText(
      "12.34",
    );
    const history = await client.request.get(
      base + "/api/v1/orders/" + purchased.id,
    );
    expect(history.status()).toBe(200);
    const record = (await history.json()).data;
    expect(record.order.plan_snapshot).toEqual(purchased.plan_snapshot);
    expect(record.order.total_minor).toBe(1234);
    expect(record.customer).toBeUndefined();
    await client.goto(base + "/plans");
    await expect(
      client.locator(".catalog-plan").filter({ hasText: draft.name }),
    ).toHaveCount(0);
    expect(blocked).toEqual([]);
  } finally {
    await customerContext.close();
  }
  await page.goto(base + "/overview");
  await expect(page.locator("h1")).toHaveText("运营概况");
  console.log(
    "PASS: live management workflows; account create/promote/reset/revoke/disable, catalog draft/publish/duplicate/unpublish, real customer selection and server-priced order, role-scoped single order details and immutable purchased snapshot.",
  );
  if (output)
    await writeFile(
      output + "/results.json",
      JSON.stringify(results, null, 2) + "\n",
    );
  return results;
}

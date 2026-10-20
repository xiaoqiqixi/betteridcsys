import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const format = {
  code: "CNY",
  name: "人民币",
  prefix: "¥",
  suffix: "",
  decimal_places: 2,
};
const customers = [
  {
    id: "customer-one",
    name: "林一",
    email: "lin@example.invalid",
    role: "customer",
  },
  {
    id: "customer-two",
    name: "Alex Chen",
    email: "alex@example.invalid",
    role: "customer",
  },
];
const service = {
  id: "service-one",
  name: "application-one",
  plan_name: "Starter",
  region: "新加坡 · Singapore",
  ipv4: "192.0.2.1",
  status: "active",
  next_due_at: "2026-11-01T00:00:00Z",
  price_minor: 3900,
  currency: "CNY",
  currency_format: format,
  cpu: 1,
  memory_gb: 2,
  disk_gb: 40,
};
const services = [
  { ...service, customer_id: customers[0].id },
  {
    ...service,
    id: "service-two",
    name: "application-two",
    customer_id: customers[1].id,
    price_minor: 1250,
    currency: "USD",
    currency_format: { ...format, code: "USD", name: "US Dollar", prefix: "$" },
  },
  {
    ...service,
    id: "service-unknown",
    name: "unknown-owner-service",
    customer_id: "U".repeat(64),
  },
];
const order = {
  id: "a".repeat(32),
  number: "ORD-SYNTHETIC-ADMIN",
  plan_name: "Starter",
  status: "pending_payment",
  total_minor: 3900,
  currency: "CNY",
  currency_format: format,
  created_at: "2026-10-20T00:00:00Z",
};
const invoice = {
  id: "b".repeat(32),
  number: "INV-SYNTHETIC-ADMIN",
  order_id: order.id,
  status: "unpaid",
  amount_minor: 3900,
  currency: "CNY",
  currency_format: format,
  issued_at: order.created_at,
  due_at: "2026-10-21T00:00:00Z",
};
const cases = [
  {
    name: "admin-cross-account-zh",
    width: 1440,
    height: 1100,
    locale: "zh-CN",
  },
  { name: "admin-mobile-en", width: 375, height: 844, locale: "en" },
  {
    name: "admin-long-owner-short-zh",
    width: 320,
    height: 480,
    locale: "zh-CN",
  },
  {
    name: "admin-loaded-limit-zh",
    width: 1440,
    height: 1100,
    locale: "zh-CN",
    limit: true,
  },
  {
    name: "admin-error-retry-zh",
    width: 375,
    height: 844,
    locale: "zh-CN",
    errors: true,
  },
  {
    name: "admin-same-id-downgrade-late-read-zh",
    width: 1440,
    height: 1100,
    locale: "zh-CN",
    downgrade: true,
  },
];

export async function probeAdminManagement(browser, base, { output } = {}) {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname))
    throw new Error("Administrator probes require disposable loopback pages");
  if (output) await mkdir(output, { recursive: true });
  const results = {
    cases: [],
    blocked: [],
    errors: [],
    syntheticCancellationPosts: 0,
  };
  try {
    for (const scenario of cases) {
      const context = await browser.newContext({
        viewport: { width: scenario.width, height: scenario.height },
        locale: scenario.locale,
        serviceWorkers: "block",
        deviceScaleFactor: 1,
      });
      let releaseLate, releaseSession;
      const lateRead = new Promise((resolve) => {
        releaseLate = resolve;
      });
      const roleRead = new Promise((resolve) => {
        releaseSession = resolve;
      });
      const state = {
        role: "admin",
        serviceReads: 0,
        sessionReads: 0,
        requests: [],
      };
      const stressed = scenario.name === "admin-long-owner-short-zh";
      const loadedCustomers = stressed
        ? customers.map((customer) => ({
            ...customer,
            name: "客户".repeat(12),
            email: "e".repeat(64) + "@" + "d".repeat(60) + ".invalid",
          }))
        : customers;
      const baseRecords = stressed
        ? services.map((record, index) =>
            index === 1
              ? {
                  ...record,
                  price_minor: Number.MAX_SAFE_INTEGER,
                  currency_format: {
                    ...record.currency_format,
                    prefix: "P".repeat(24),
                    suffix: "S".repeat(24),
                  },
                }
              : record,
          )
        : services;
      const records = scenario.limit
        ? Array.from({ length: 1000 }, (_, index) => ({
            ...baseRecords[index % 3],
            id: `service-${index}`,
          }))
        : baseRecords;
      try {
        await context.addInitScript((locale) => {
          localStorage.setItem("aster.locale", locale);
          localStorage.setItem("aster.currency", "CNY");
        }, scenario.locale);
        await context.route("**/*", async (route) => {
          const request = route.request(),
            url = new URL(request.url()),
            path = url.pathname.replace(/^\/api\/v1/, "");
          if (url.origin !== new URL(base).origin) {
            results.blocked.push(request.method() + " " + url.pathname);
            return route.abort("blockedbyclient");
          }
          if (!url.pathname.startsWith("/api/")) return route.continue();
          state.requests.push({ method: request.method(), path });
          if (
            scenario.downgrade &&
            request.method() === "POST" &&
            path === `/admin/orders/${order.id}/cancel`
          ) {
            results.syntheticCancellationPosts++;
            return route.fulfill({
              status: 503,
              json: {
                error: {
                  code: "UNAVAILABLE",
                  message: "Synthetic uncertain cancellation",
                },
              },
            });
          }
          if (request.method() !== "GET") {
            results.blocked.push(request.method() + " " + path);
            return route.abort("blockedbyclient");
          }
          let data;
          if (path === "/session") {
            state.sessionReads++;
            if (scenario.downgrade && state.sessionReads > 1) {
              await roleRead;
              state.role = "customer";
            }
            data = {
              user: {
                id: "same-session-account",
                name: "Synthetic operator",
                email: "operator@example.invalid",
                role: state.role,
              },
              csrf_token: "synthetic-csrf",
              demo_mode: false,
            };
          } else if (path === "/site-settings")
            data = {
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
          else if (path === "/currencies")
            data = {
              revision: 1,
              default_currency: "CNY",
              currencies: [
                {
                  ...format,
                  enabled: true,
                  sort_order: 0,
                  precision_locked: true,
                },
              ],
            };
          else if (path === "/admin/overview")
            data = {
              customers: 2,
              total_services: records.length,
              unpaid_invoices: 1,
              unpaid_total_minor: 3900,
              revenue_minor: 0,
              currency: "CNY",
              currency_format: format,
            };
          else if (path === "/admin/customers") data = loadedCustomers;
          else if (path === "/admin/services") {
            state.serviceReads++;
            if (scenario.errors && [1, 3].includes(state.serviceReads))
              return route.fulfill({
                status: 503,
                json: {
                  error: {
                    code: "UNAVAILABLE",
                    message: "Synthetic services unavailable",
                  },
                },
              });
            if (scenario.downgrade && state.serviceReads === 2) await lateRead;
            data = records;
          } else if (path === "/admin/orders" || path === "/orders")
            data = [order];
          else if (path === "/admin/invoices" || path === "/invoices")
            data = [invoice];
          else if (path === "/audit") data = [];
          else if (path === "/services")
            data = [
              {
                ...service,
                id: "own-customer-service",
                name: "owned-after-downgrade",
              },
            ];
          else if (path === "/plans") data = [];
          else if (path === "/overview")
            data = {
              active_services: 1,
              pending_invoices: 1,
              unpaid_total_minor: 3900,
              monthly_total_minor: 3900,
              currency: "CNY",
              currency_format: format,
              recent_orders: [order],
            };
          else {
            results.blocked.push(path);
            return route.abort("blockedbyclient");
          }
          return route.fulfill({ status: 200, json: { data } });
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => results.errors.push(error.message));
        await page.goto(base + (scenario.downgrade ? "/orders" : "/services"));
        await expect(page.locator(".app-shell")).toBeVisible();
        await expect(page.locator(".skeleton-grid")).toHaveCount(0);
        if (scenario.errors) {
          await expect(page.locator(".alert.error")).toBeVisible();
          await expect(page.locator(".service-cards")).toHaveCount(0);
          await expect(page.locator(".empty-state")).toHaveCount(0);
          await page.locator(".alert.error button").click();
        }
        if (scenario.downgrade) {
          await page.locator(".order-cancel-action").click();
          const dialog = page.getByTestId("cancellation-dialog");
          await dialog
            .locator('[name="cancellation_reason"]')
            .fill("Synthetic review only");
          await dialog.locator('[name="confirm_cancellation"]').check();
          await dialog.locator('button[type="submit"]').click();
          await expect(dialog).toContainText("取消结果尚未确认");
          await dialog.locator('button[type="submit"]').click();
          await expect.poll(() => state.sessionReads).toBe(2);
          // A deterministic race injection invokes the existing refresh handler
          // while native modality blocks physical background interaction. It is
          // not a user feature or a production state-setting/test API.
          await page.evaluate(() =>
            document
              .querySelector('button[aria-label="刷新数据"]')
              .dispatchEvent(new MouseEvent("click", { bubbles: true })),
          );
          await expect.poll(() => state.serviceReads).toBe(2);
          releaseSession();
          await expect(
            page.getByRole("link", { name: "云服务器", exact: true }),
          ).toBeVisible();
          await expect(dialog).not.toBeVisible();
          releaseLate();
          await page
            .getByRole("link", { name: "云服务器", exact: true })
            .click();
          await page
            .getByRole("button", { name: "刷新数据", exact: true })
            .click();
          await expect(
            page.locator(
              '.service-card[data-service-id="own-customer-service"]',
            ),
          ).toBeVisible();
          await expect(page.getByTestId("service-customer")).toHaveCount(0);
          await expect(page.locator(".service-card")).toHaveCount(1);
          await expect(page.locator(".service-cards")).not.toContainText(
            "unknown-owner-service",
          );
          await expect(
            page.getByRole("link", { name: "服务管理", exact: true }),
          ).toHaveCount(0);
        } else {
          await expect(page.locator(".service-card")).toHaveCount(
            records.length,
          );
          await expect(page.locator("h1")).toHaveText(
            scenario.locale === "en" ? "Services" : "服务管理",
          );
          for (const record of baseRecords) {
            if (scenario.limit) break;
            const card = page.locator(
                `.service-card[data-service-id="${record.id}"]`,
              ),
              owner = card.getByTestId("service-customer");
            await expect(owner).toContainText(record.customer_id);
            const known = loadedCustomers.find(
              (customer) => customer.id === record.customer_id,
            );
            await expect(owner).toContainText(
              known?.name ||
                (scenario.locale === "en"
                  ? "Customer details not loaded"
                  : "客户资料未载入"),
            );
            await expect(owner).not.toContainText("Synthetic operator");
            const labelLines = await owner.locator("dt").evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              return [...range.getClientRects()].filter(
                (rect) => rect.width > 0 && rect.height > 0,
              ).length;
            });
            expect(
              labelLines,
              "The ownership label must not be squeezed into vertical letters beside a long ID",
            ).toBe(1);
            const id = owner.locator(".mono");
            const geometry = await id.evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              const card = element
                .closest(".service-card")
                .getBoundingClientRect();
              return {
                width: element.clientWidth,
                scroll: element.scrollWidth,
                fits: [...range.getClientRects()].every(
                  (rect) => rect.left >= card.left && rect.right <= card.right,
                ),
              };
            });
            expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
            expect(geometry.fits).toBe(true);
          }
          if (scenario.limit) {
            await expect(page.getByTestId("list-limit-warning")).toContainText(
              "1,000",
            );
            await expect(page.getByTestId("list-count")).toContainText("1000");
          } else {
            await expect(
              page.locator(
                '[data-service-id="service-two"] .service-card-footer',
              ),
            ).toContainText("USD");
            const price = page.locator(
              '[data-service-id="service-two"] .service-card-footer > b',
            );
            await expect(price).toContainText(
              stressed
                ? "USD\u00a0" +
                    "P".repeat(24) +
                    "90,071,992,547,409.91" +
                    "S".repeat(24)
                : "12.50",
            );
            const amountFits = await price.evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              const bounds = element
                .closest(".service-card")
                .getBoundingClientRect();
              return (
                element.scrollWidth <= element.clientWidth + 1 &&
                [...range.getClientRects()].every(
                  (rect) =>
                    rect.left >= bounds.left && rect.right <= bounds.right,
                )
              );
            });
            expect(
              amountFits,
              "The complete recorded amount and currency must wrap without clipping",
            ).toBe(true);
          }
          await expect(page.locator(".service-card button")).toHaveCount(0);
          if (scenario.errors) {
            const before = await page.locator(".service-cards").innerText();
            await page
              .getByRole("button", { name: "刷新数据", exact: true })
              .click();
            await expect(
              page.getByTestId("service-refresh-note"),
            ).toBeVisible();
            expect(await page.locator(".service-cards").innerText()).toBe(
              before,
            );
            await page.locator(".alert.error button").click();
            await expect(page.locator(".alert.error")).toHaveCount(0);
            await expect(page.getByTestId("service-refresh-note")).toHaveCount(
              0,
            );
          }
          expect(
            state.requests.some((request) => request.path === "/services"),
          ).toBe(false);
        }
        await page.evaluate(async () => {
          await document.fonts.ready;
          window.scrollTo(0, 0);
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        if (output)
          await page.screenshot({
            path: output + "/" + scenario.name + ".png",
            fullPage: !scenario.limit && !scenario.downgrade,
            animations: "disabled",
          });
        results.cases.push({
          name: scenario.name,
          width: scenario.width,
          height: scenario.height,
          passed: true,
          serviceReads: state.serviceReads,
        });
      } finally {
        releaseLate();
        releaseSession();
        await context.close();
      }
    }
    expect(results.blocked).toEqual([]);
    expect(results.errors).toEqual([]);
    expect(results.syntheticCancellationPosts).toBe(1);
    console.log(
      `PASS: administrator management ${results.cases.length}/6; exact cross-customer IDs, unknown-owner fallback, 1000-row scope, recoverable errors and same-ID downgrade with a late administrator read.`,
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

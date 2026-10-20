import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const format = {
  code: "CNY",
  name: "人民币",
  prefix: "¥",
  suffix: "",
  decimal_places: 2,
};
const owner = "c".repeat(32);
const event = {
  id: "a".repeat(32),
  action: "order.cancelled",
  target: "b".repeat(32),
  created_at: "2026-10-20T08:35:42.123456Z",
  actor_email: "operator@example.invalid",
  owner_id: owner,
  detail: "未付款订单已取消，原账单已作废；仅为合成业务记录，不访问主机日志。",
};
const paid = {
  ...event,
  id: "d".repeat(32),
  action: "payment.settled",
  actor_email: "payment:approved-provider",
  detail: "Synthetic settled event, no payment operation performed.",
};
const scenarios = [
  {
    name: "audit-pagination-zh",
    width: 1440,
    height: 1100,
    locale: "zh-CN",
    pagination: true,
  },
  {
    name: "audit-exact-filters-en",
    width: 1440,
    height: 1100,
    locale: "en",
    filters: true,
  },
  {
    name: "audit-customer-owned-zh",
    width: 375,
    height: 844,
    locale: "zh-CN",
    customer: true,
  },
  {
    name: "audit-long-detail-short-en",
    width: 320,
    height: 480,
    locale: "en",
    long: true,
  },
  {
    name: "audit-first-and-cached-error-zh",
    width: 375,
    height: 844,
    locale: "zh-CN",
    errors: true,
  },
  {
    name: "audit-unmount-late-response-zh",
    width: 1440,
    height: 1100,
    locale: "zh-CN",
    late: true,
  },
  {
    name: "audit-empty-validation-en",
    width: 375,
    height: 480,
    locale: "en",
    empty: true,
  },
  {
    name: "audit-malformed-header-en",
    width: 375,
    height: 844,
    locale: "en",
    malformed: true,
  },
];
export async function probeAuditBoundaries(browser, base, { output } = {}) {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname))
    throw new Error("Audit probes require disposable loopback pages");
  if (output) await mkdir(output, { recursive: true });
  const results = { cases: [], blocked: [], errors: [], mutations: 0 };
  try {
    for (const scenario of scenarios) {
      const context = await browser.newContext({
        viewport: { width: scenario.width, height: scenario.height },
        locale: scenario.locale,
        serviceWorkers: "block",
        deviceScaleFactor: 1,
      });
      const reads = [];
      let releaseLate;
      const late = new Promise((resolve) => {
        releaseLate = resolve;
      });
      const row = scenario.long
        ? {
            ...event,
            action: "constructor",
            actor_email: "x".repeat(254),
            target: "T".repeat(128),
            detail: "完整详情".repeat(83) + "END",
          }
        : event;
      try {
        await context.addInitScript((language) => {
          localStorage.setItem("aster.locale", language);
          localStorage.setItem("aster.currency", "CNY");
        }, scenario.locale);
        await context.route("**/*", async (route) => {
          const request = route.request(),
            url = new URL(request.url()),
            path = url.pathname.replace(/^\/api\/v1/, "");
          if (
            url.origin !== new URL(base).origin ||
            request.method() !== "GET"
          ) {
            results.blocked.push(request.method() + " " + url.pathname);
            if (request.method() !== "GET") results.mutations++;
            return route.abort("blockedbyclient");
          }
          if (!url.pathname.startsWith("/api/")) return route.continue();
          let data;
          if (path === "/session")
            data = {
              user: {
                id: "9".repeat(32),
                name: "Synthetic operator",
                email: "operator@example.invalid",
                role: scenario.customer ? "customer" : "admin",
              },
              csrf_token: "synthetic-no-writes",
              demo_mode: false,
            };
          else if (path === "/site-settings")
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
              total_services: 0,
              unpaid_invoices: 0,
              unpaid_total_minor: 0,
              revenue_minor: 0,
              currency: "CNY",
              currency_format: format,
            };
          else if (path === "/overview")
            data = {
              active_services: 0,
              pending_invoices: 0,
              unpaid_total_minor: 0,
              monthly_total_minor: 0,
              currency: "CNY",
              currency_format: format,
              recent_orders: [],
            };
          else if (path === "/audit") data = [];
          else if (["/admin/audit-events", "/audit-events"].includes(path)) {
            reads.push({ path, params: Object.fromEntries(url.searchParams) });
            expect(path).toBe(
              scenario.customer ? "/audit-events" : "/admin/audit-events",
            );
            if (scenario.malformed && reads.length === 1)
              return route.fulfill({
                status: 502,
                headers: { "X-Request-ID": "e".repeat(32) },
                contentType: "text/html",
                body: "<h1>synthetic-storage-secret</h1>",
              });
            if (scenario.errors && [1, 3].includes(reads.length))
              return route.fulfill({
                status: 503,
                headers: { "X-Request-ID": "f".repeat(32) },
                json: {
                  error: {
                    code: "UNAVAILABLE",
                    message: "synthetic-storage-secret",
                  },
                },
              });
            if (scenario.late && reads.length === 1) await late;
            let items = scenario.empty
              ? []
              : scenario.filters && url.searchParams.has("action")
                ? [paid]
                : url.searchParams.has("cursor")
                  ? [
                      {
                        ...row,
                        id: "8".repeat(32),
                        detail: "Second server page",
                      },
                    ]
                  : [row, paid];
            if (scenario.long) items = [row];
            if (scenario.customer)
              items = items.map(({ owner_id: _, ...safe }) => safe);
            const hasMore =
              !!scenario.pagination && !url.searchParams.has("cursor");
            data = {
              items,
              has_more: hasMore,
              ...(hasMore ? { next_cursor: "opaque+/=next-cursor" } : {}),
              limit: 50,
            };
          } else if (
            [
              "/services",
              "/orders",
              "/invoices",
              "/plans",
              "/admin/services",
              "/admin/customers",
              "/admin/orders",
              "/admin/invoices",
            ].includes(path)
          )
            data = [];
          else {
            results.blocked.push(path);
            return route.abort("blockedbyclient");
          }
          return route.fulfill({ status: 200, json: { data } });
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => results.errors.push(error.message));
        await page.goto(base + "/audit");
        const audit = page.getByTestId("audit-log-page");
        await expect(audit).toBeVisible();
        if (scenario.errors || scenario.malformed) {
          await expect(audit.locator(".audit-query-error")).toBeVisible();
          await expect(audit.locator(".audit-empty")).toHaveCount(0);
          await expect(audit).not.toContainText("synthetic-storage-secret");
          await expect(audit.locator(".audit-request-id")).toContainText(
            (scenario.malformed ? "e" : "f").repeat(32),
          );
          await audit.locator(".audit-query-error button").click();
        }
        if (scenario.late) {
          await expect(audit.locator(".audit-feedback")).toBeVisible();
          await page.locator('.sidebar nav a[href="/services"]').click();
          await expect(audit).toHaveCount(0);
          releaseLate();
          await page.locator('.sidebar nav a[href="/audit"]').click();
          await expect(audit.locator(".audit-event")).toHaveCount(2);
        } else if (scenario.empty)
          await expect(audit.locator(".audit-empty")).toBeVisible();
        else
          await expect(audit.locator(".audit-event")).toHaveCount(
            scenario.long ? 1 : 2,
          );
        if (scenario.pagination) {
          await audit.locator(".audit-pagination button").last().click();
          await expect(audit).toContainText("第 2 页");
          expect(reads.at(-1).params.cursor).toBe("opaque+/=next-cursor");
          await expect(audit).toContainText("Second server page");
          await audit.locator(".audit-pagination button").first().click();
          await expect(audit).toContainText("第 1 页");
          expect(reads.at(-1).params.cursor).toBeUndefined();
        }
        if (scenario.filters) {
          await audit.locator(".audit-query-summary").click();
          await expect(audit.locator(".audit-filter-panel")).toHaveJSProperty(
            "open",
            true,
          );
          await audit.locator('[name="audit_action"]').fill("payment.settled");
          await audit
            .locator('[name="audit_actor"]')
            .fill("payment:approved-provider");
          await audit.locator(".audit-advanced > summary").click();
          await audit.locator('[name="audit_owner"]').fill(owner);
          await audit.locator('[name="audit_from"]').fill("2026-10-20T08:00");
          await audit
            .locator('[name="audit_until"]')
            .fill("2026-10-20T09:00:01");
          await audit
            .getByRole("button", { name: "Query records", exact: true })
            .click();
          await expect(audit.locator(".audit-event")).toHaveCount(1);
          expect(reads.at(-1).params).toEqual({
            limit: "50",
            action: "payment.settled",
            actor_email: "payment:approved-provider",
            owner_id: owner,
            from: "2026-10-20T08:00:00Z",
            until: "2026-10-20T09:00:01Z",
          });
          await audit
            .getByRole("button", { name: "Reset filters", exact: true })
            .click();
          await expect(audit.locator(".audit-event")).toHaveCount(2);
          expect(reads.at(-1).params).toEqual({ limit: "50" });
        }
        if (scenario.errors) {
          await audit.locator(".audit-query-summary").click();
          await audit
            .getByRole("button", { name: "刷新本页", exact: true })
            .click();
          await expect(audit.locator(".audit-query-error")).toBeVisible();
          await expect(audit.locator(".audit-event")).toHaveCount(2);
          await expect(audit).toContainText("上次成功查询");
          await audit.locator(".audit-query-error button").click();
          await expect(audit.locator(".audit-query-error")).toHaveCount(0);
        }
        if (scenario.empty) {
          await audit.locator(".audit-query-summary").click();
          const before = reads.length;
          await audit.locator('[name="audit_action"]').fill("INVALID");
          await audit
            .getByRole("button", { name: "Query records", exact: true })
            .click();
          await expect(audit.locator('[name="audit_action"]')).toHaveAttribute(
            "aria-invalid",
            "true",
          );
          await expect(audit.locator('[name="audit_action"]')).toBeFocused();
          expect(reads.length).toBe(before);
          await audit
            .getByRole("button", { name: "Reset filters", exact: true })
            .click();
          await expect(audit.locator(".audit-empty")).toBeVisible();
        }
        if (scenario.customer) {
          await expect(page.locator("h1")).toHaveText("操作记录");
          await expect(audit.locator('[name="audit_owner"]')).toHaveCount(0);
          await expect(audit).not.toContainText(owner);
          expect(
            reads.every(
              (read) =>
                !read.path.includes("/admin/") &&
                !Object.hasOwn(read.params, "owner_id"),
            ),
          ).toBe(true);
        }
        if (!scenario.empty) {
          const first = audit.locator(".audit-event").first();
          if (scenario.long) {
            await expect(first.locator("strong")).toHaveText("Other action");
            await expect(first.locator(".audit-event-heading code")).toHaveText(
              "constructor",
            );
          }
          await first.locator("details > summary").click();
          await expect(first.locator(".audit-event-detail")).toBeVisible();
          await expect(first).toContainText("08:35:42 UTC");
          await expect(first).toContainText(row.id);
          const detail = first.locator(".audit-event-detail");
          await expect(detail).toHaveText(row.detail);
          for (const field of await first
            .locator("dd, time, .audit-event-detail")
            .all()) {
            const fits = await field.evaluate((element) => {
              const bounds = element
                .closest(".audit-event")
                .getBoundingClientRect();
              const range = document.createRange();
              range.selectNodeContents(element);
              return (
                element.scrollWidth <= element.clientWidth + 1 &&
                [...range.getClientRects()].every(
                  (r) => r.left >= bounds.left && r.right <= bounds.right,
                )
              );
            });
            expect(
              fits,
              "Full audit identifiers, timestamps and details must wrap without clipping",
            ).toBe(true);
          }
          await first.locator("details > summary").focus();
          await expect(first.locator("details > summary")).toBeFocused();
          await page.keyboard.press("Enter");
          await expect(detail).not.toBeVisible();
          await page.keyboard.press("Enter");
          await expect(detail).toBeVisible();
        }
        await expect(audit).toHaveAttribute("aria-busy", "false");
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
            fullPage: true,
            animations: "disabled",
          });
        results.cases.push({
          name: scenario.name,
          width: scenario.width,
          height: scenario.height,
          passed: true,
          auditReads: reads.length,
        });
      } finally {
        releaseLate();
        await context.close();
      }
    }
    expect(results.blocked).toEqual([]);
    expect(results.errors).toEqual([]);
    expect(results.mutations).toBe(0);
    console.log(
      `PASS: audit boundaries ${results.cases.length}/8; actual cursor navigation, exact actor/owner/UTC filters, isolated customer projection, recoverable failures, inert full details and late-unmount safety.`,
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

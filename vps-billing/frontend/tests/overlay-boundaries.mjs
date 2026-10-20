import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const format = {
  code: "CNY",
  name: "人民币",
  prefix: "¥",
  suffix: "",
  decimal_places: 2,
};
const plan = {
  id: "p1",
  name: "Starter",
  description: "适合个人网站和测试环境。",
  cpu: 1,
  memory_gb: 2,
  disk_gb: 40,
  transfer_tb: 1,
  region: "新加坡 · Singapore",
  price_minor: 3900,
  price_revision: 1,
  currency: "CNY",
  currency_format: format,
  available: true,
};
const service = {
  id: "s1",
  name: "api-example",
  plan_name: "Starter",
  region: plan.region,
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
const order = {
  id: "o1",
  number: "ORD-SYNTHETIC-0001",
  plan_name: "Starter",
  status: "pending_payment",
  total_minor: 3900,
  currency: "CNY",
  currency_format: format,
  created_at: "2026-10-20T00:00:00Z",
};
const invoice = {
  id: "i1",
  number: "INV-SYNTHETIC-0001",
  order_id: "o1",
  status: "unpaid",
  amount_minor: 3900,
  currency: "CNY",
  currency_format: format,
  issued_at: "2026-10-20T00:00:00Z",
  due_at: "2026-10-21T00:00:00Z",
};
const fixtures = {
  "/site-settings": {
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
  },
  "/session": {
    user: {
      id: "synthetic-ui",
      name: "Alex",
      email: "ui@example.invalid",
      role: "customer",
    },
    csrf_token: "synthetic-no-mutations",
    demo_mode: false,
  },
  "/currencies": {
    revision: 1,
    default_currency: "CNY",
    currencies: [
      { ...format, enabled: true, sort_order: 0, precision_locked: true },
    ],
  },
  "/overview": {
    active_services: 1,
    pending_invoices: 1,
    unpaid_total_minor: 3900,
    monthly_total_minor: 3900,
    currency: "CNY",
    currency_format: format,
    recent_orders: [order],
  },
  "/plans": [
    plan,
    {
      ...plan,
      id: "p2",
      name: "Essential",
      cpu: 2,
      memory_gb: 4,
      disk_gb: 80,
      price_minor: 7900,
    },
    {
      ...plan,
      id: "p3",
      name: "Performance",
      cpu: 4,
      memory_gb: 8,
      disk_gb: 160,
      price_minor: 15900,
      region: "东京 · Tokyo",
    },
  ],
  "/services": [service],
  "/orders": [order],
  "/invoices": [invoice],
  "/audit": [],
};

const integration = {
  id: "payment.disabled",
  kind: "payment",
  name: "支付适配器 · 未接入",
  description: "此适配器当前关闭，不提供真实收款能力。",
  enabled: false,
  configured: false,
  status: "disabled",
  capabilities: ["checkout", "verify"],
  supported_currencies: ["CNY"],
  currency_decimal_places: { CNY: 2 },
  configuration_fields: [
    {
      key: "PAYMENT_ENDPOINT",
      label: "服务地址",
      type: "url",
      required: true,
      secret: false,
    },
    {
      key: "PAYMENT_SECRET_REF",
      label: "密钥引用",
      type: "secret_ref",
      required: true,
      secret: true,
    },
  ],
  configuration_mode: "environment",
  limitations: ["必须由运营者完成服务端配置并独立验证，当前不可付款。"],
};

const cases = [
  {
    name: "navigation-mobile-zh",
    kind: "navigation",
    path: "/overview",
    width: 375,
    height: 844,
    locale: "zh-CN",
  },
  {
    name: "navigation-short-admin-en",
    kind: "navigation",
    path: "/integrations",
    width: 320,
    height: 480,
    locale: "en",
    admin: true,
  },
  {
    name: "navigation-desktop-zh",
    kind: "sidebar",
    path: "/overview",
    width: 1440,
    height: 1100,
    locale: "zh-CN",
  },
  {
    name: "order-desktop-zh",
    kind: "order",
    path: "/plans",
    width: 1440,
    height: 1100,
    locale: "zh-CN",
  },
  {
    name: "order-mobile-en",
    kind: "order",
    path: "/plans",
    width: 375,
    height: 844,
    locale: "en",
  },
  {
    name: "order-long-mobile-en",
    kind: "order",
    path: "/plans",
    width: 320,
    height: 844,
    locale: "en",
    long: true,
  },
  {
    name: "cancel-mobile-zh",
    kind: "cancel",
    path: "/orders",
    width: 375,
    height: 844,
    locale: "zh-CN",
  },
  {
    name: "invoice-desktop-zh",
    kind: "invoice",
    path: "/invoices",
    width: 1440,
    height: 1100,
    locale: "zh-CN",
  },
  {
    name: "invoice-mobile-zh",
    kind: "invoice",
    path: "/invoices",
    width: 375,
    height: 844,
    locale: "zh-CN",
  },
  {
    name: "invoice-long-mobile-en",
    kind: "invoice",
    path: "/invoices",
    width: 375,
    height: 844,
    locale: "en",
    long: true,
  },
  {
    name: "invoice-checkout-short-en",
    kind: "invoice",
    path: "/invoices",
    width: 375,
    height: 480,
    locale: "en",
    prepared: true,
  },
  {
    name: "invoice-checkout-landscape-en",
    kind: "invoice",
    path: "/invoices",
    width: 844,
    height: 375,
    locale: "en",
    prepared: true,
  },
  {
    name: "help-mobile-zh",
    kind: "help",
    path: "/overview",
    width: 375,
    height: 844,
    locale: "zh-CN",
  },
  {
    name: "integration-desktop-zh",
    kind: "integration",
    path: "/integrations",
    width: 1440,
    height: 1100,
    locale: "zh-CN",
    admin: true,
  },
  {
    name: "integration-mobile-en",
    kind: "integration",
    path: "/integrations",
    width: 375,
    height: 844,
    locale: "en",
    admin: true,
  },
];

async function fullTextFits(locator, expected) {
  await expect(locator).toHaveText(expected);
  const metrics = await locator.evaluate((element) => {
    const body = element.closest(".modal-body") || element.closest("dialog");
    const box = body.getBoundingClientRect(),
      range = document.createRange();
    range.selectNodeContents(element);
    const fragments = [...range.getClientRects()].filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      whiteSpace: getComputedStyle(element).whiteSpace,
      textOverflow: getComputedStyle(element).textOverflow,
      fragments: fragments.map((rect) => ({
        left: rect.left,
        right: rect.right,
      })),
      bounds: { left: box.left, right: box.right },
    };
  });
  expect(
    metrics.scrollWidth,
    "The complete monetary value must fit its wrapping container",
  ).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.textOverflow).not.toBe("ellipsis");
  expect(metrics.fragments.length).toBeGreaterThan(0);
  for (const rect of metrics.fragments) {
    expect(rect.left).toBeGreaterThanOrEqual(metrics.bounds.left - 1);
    expect(rect.right).toBeLessThanOrEqual(metrics.bounds.right + 1);
  }
  return metrics;
}

// Isolated synthetic contexts never mutate the demo API. The sole checkout POST
// is fulfilled here, requires an explicit click, and its external link is not followed.
export async function probeOverlayBoundaries(
  browser,
  base,
  { output, longOnly = false } = {},
) {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname))
    throw new Error("Overlay tests require disposable loopback pages");
  if (output) await mkdir(output, { recursive: true });
  const results = {
    cases: [],
    blocked: [],
    errors: [],
    syntheticCheckoutPosts: 0,
  };
  try {
    for (const scenario of cases.filter(
      (item) => !longOnly || item.name === "invoice-long-mobile-en",
    )) {
      const context = await browser.newContext({
        viewport: { width: scenario.width, height: scenario.height },
        locale: scenario.locale,
        deviceScaleFactor: 1,
        serviceWorkers: "block",
      });
      try {
        await context.addInitScript((locale) => {
          localStorage.setItem("aster.locale", locale);
          localStorage.setItem("aster.currency", "CNY");
        }, scenario.locale);
        await context.route("**/*", async (route) => {
          const req = route.request(),
            u = new URL(req.url());
          if (u.origin !== new URL(base).origin) {
            results.blocked.push(req.method() + " " + u.pathname);
            return route.abort("blockedbyclient");
          }
          if (
            scenario.prepared &&
            req.method() === "POST" &&
            u.pathname === "/api/v1/invoices/i1/checkout"
          ) {
            results.syntheticCheckoutPosts++;
            return route.fulfill({
              status: 200,
              json: {
                data: {
                  provider_id: "synthetic-provider",
                  session_id: "synthetic-unpaid-session",
                  checkout_url: "https://checkout.example.invalid/session/test",
                  expires_at: new Date(Date.now() + 600000).toISOString(),
                },
              },
            });
          }
          if (req.method() !== "GET") {
            results.blocked.push(req.method() + " " + u.pathname);
            return route.abort("blockedbyclient");
          }
          if (!u.pathname.startsWith("/api/")) return route.continue();
          let endpoint = u.pathname.replace(/^\/api\/v1/, "");
          const detail =
            endpoint === "/invoices/i1" || endpoint === "/admin/invoices/i1";
          endpoint = endpoint.replace(/^\/admin/, "");
          let data;
          if (detail)
            data = {
              ...invoice,
              issuer: {
                name: "星屿云计算",
                address: "合成测试地址，不是真实客户资料",
                support_email: "support@example.invalid",
              },
              line_items: [
                {
                  description: "Starter 云服务器服务 · 单月",
                  amount_minor: 3900,
                },
              ],
            };
          else if (endpoint === "/integrations")
            data = { items: [integration] };
          else if (endpoint === "/customers") data = [];
          else if (endpoint === "/services" && scenario.admin)
            data = [{ ...service, customer_id: "synthetic-customer" }];
          else if (endpoint === "/overview" && scenario.admin)
            data = {
              customers: 1,
              total_services: 1,
              unpaid_invoices: 1,
              unpaid_total_minor: 3900,
              revenue_minor: 0,
              currency: "CNY",
            };
          else if (Object.hasOwn(fixtures, endpoint))
            data = structuredClone(fixtures[endpoint]);
          else {
            results.blocked.push(endpoint);
            return route.abort("blockedbyclient");
          }
          if (endpoint === "/session" && scenario.admin)
            data.user.role = "admin";
          if (scenario.long) {
            const longFormat = {
              ...format,
              prefix: "P".repeat(24),
              suffix: "S".repeat(24),
            };
            if (endpoint === "/invoices")
              data = data.map((x) => ({
                ...x,
                amount_minor: Number.MAX_SAFE_INTEGER,
                currency_format: longFormat,
              }));
            if (endpoint === "/plans")
              data = data.map((x) => ({
                ...x,
                price_minor: Number.MAX_SAFE_INTEGER,
                currency_format: longFormat,
              }));
            if (detail)
              data = {
                ...data,
                amount_minor: Number.MAX_SAFE_INTEGER,
                currency_format: longFormat,
                line_items: [
                  {
                    description: "Starter 云服务器服务 · 单月",
                    amount_minor: Number.MAX_SAFE_INTEGER,
                  },
                ],
              };
          }
          return route.fulfill({ status: 200, json: { data } });
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => results.errors.push(error.message));
        await page.goto(base + scenario.path);
        await expect(page.locator(".app-shell")).toBeVisible();
        await expect(page.locator(".skeleton-grid")).toHaveCount(0);
        let trigger;
        if (scenario.kind === "navigation") {
          trigger = page.locator(".mobile-menu");
          await trigger.click();
        }
        if (scenario.kind === "order") {
          await expect(page.locator(".purchase-page")).toHaveAttribute(
            "aria-busy",
            "false",
          );
          trigger = page.locator(".purchase-checkout .button.primary");
          await trigger.click();
        }
        if (scenario.kind === "cancel") {
          trigger = page.locator(".order-cancel-action").first();
          await trigger.click();
        }
        if (scenario.kind === "invoice") {
          trigger = page.locator(".invoice-table tbody button").first();
          await trigger.click();
          await expect(page.locator(".invoice-document")).toHaveAttribute(
            "aria-busy",
            "false",
          );
        }
        if (scenario.kind === "help") {
          await page.locator(".mobile-menu").click();
          trigger = page.locator(".side-action").nth(1);
          await trigger.click();
        }
        if (scenario.kind === "integration") {
          await expect(page.locator(".integration-card")).toHaveCount(1);
          trigger = page.locator(".integration-card button").first();
          await trigger.click();
        }
        if (scenario.prepared) {
          expect(results.syntheticCheckoutPosts).toBe(
            cases
              .slice(0, cases.indexOf(scenario))
              .filter((item) => item.prepared).length,
          );
          await page.locator("dialog[open] .invoice-actions > button").click();
          await expect(page.locator(".checkout-handoff a")).toBeVisible();
        }
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        });
        if (output)
          await page.screenshot({
            path: output + "/" + scenario.name + ".png",
            animations: "disabled",
          });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const overlay = page.locator(
          scenario.kind === "navigation"
            ? "#primary-navigation"
            : scenario.kind === "sidebar"
              ? ".sidebar"
              : "dialog[open]",
        );
        const metrics = await overlay.evaluate((el) => ({
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
        }));
        expect(
          metrics.scrollWidth,
          "Overlay must not crop or horizontally hide recorded amounts",
        ).toBeLessThanOrEqual(metrics.clientWidth + 1);
        const record = {
          name: scenario.name,
          viewport: scenario.width + "x" + scenario.height,
          ...metrics,
        };
        results.cases.push(record);
        if (scenario.long) {
          const expected =
            "CNY\u00a0" +
            "P".repeat(24) +
            "90,071,992,547,409.91" +
            "S".repeat(24);
          if (scenario.kind === "invoice") {
            record.lineAmount = await fullTextFits(
              page.locator(".invoice-line > b"),
              expected,
            );
            record.totalAmount = await fullTextFits(
              page.locator(".invoice-total strong"),
              expected,
            );
          } else {
            // The price and its period may share a node; test the complete value's own text range.
            const price = page.locator(".order-plan > strong");
            await expect(price).toContainText(expected);
            record.initialOrderAmount = await fullTextFits(
              page.locator(".order-summary > div").last().locator("dd"),
              expected,
            );
          }
        }
        if (scenario.kind === "navigation") {
          const close = overlay.locator(".sidebar-close"),
            logout = overlay.locator(".user-menu button");
          await expect(overlay).toHaveAttribute("role", "dialog");
          await expect(page.locator(".main-shell")).toHaveAttribute("inert");
          await close.focus();
          await page.keyboard.press("Shift+Tab");
          await expect(logout).toBeFocused();
          await page.keyboard.press("Tab");
          await expect(close).toBeFocused();
          await page.keyboard.press("Escape");
          await expect(trigger).toBeFocused();
          await expect(overlay).toHaveAttribute("inert");
          await trigger.click();
          await close.click();
          await expect(trigger).toBeFocused();
          await trigger.click();
          await page
            .locator(".sidebar-scrim")
            .click({ position: { x: scenario.width - 4, y: 40 } });
          await expect(trigger).toBeFocused();
          await trigger.click();
          await overlay.locator('nav a[href="/orders"]').click();
          await page.waitForURL("**/orders");
          await expect(overlay).toHaveAttribute("inert");
          await expect(page.locator("#main")).toBeFocused();
          await page.goBack();
          await page.waitForURL("**" + scenario.path);
          await expect(overlay).toHaveAttribute("inert");
          record.keyboardAndCloseAndRouteReturn = true;
        } else if (scenario.kind !== "sidebar") {
          const header = overlay.locator(".modal-heading"),
            body = overlay.locator(".modal-body"),
            footer = overlay.locator(".modal-actions");
          const close = header.locator("button");
          await expect(close).toBeVisible();
          const bodyMetrics = await body.evaluate((el) => ({
            clientWidth: el.clientWidth,
            scrollWidth: el.scrollWidth,
            height: el.clientHeight,
          }));
          expect(bodyMetrics.scrollWidth).toBeLessThanOrEqual(
            bodyMetrics.clientWidth + 1,
          );
          expect(
            bodyMetrics.height,
            "Body must retain usable scroll space even on short viewports",
          ).toBeGreaterThanOrEqual(44);
          await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
          const h = await header.boundingBox(),
            b = await body.boundingBox(),
            f = await footer.boundingBox();
          expect(h.y).toBeGreaterThanOrEqual(0);
          expect(h.y + h.height).toBeLessThanOrEqual(scenario.height);
          expect(f.y + f.height).toBeLessThanOrEqual(scenario.height);
          expect(b.y + b.height).toBeLessThanOrEqual(f.y + 1);
          await expect(close).toBeVisible();
          if (scenario.kind === "order" || scenario.kind === "cancel") {
            const checkbox = body.locator(".checkbox-label");
            await checkbox.scrollIntoViewIfNeeded();
            const label = await checkbox.boundingBox();
            expect(
              label.y + label.height,
              "The complete confirmation must scroll above, not under, the action area",
            ).toBeLessThanOrEqual(f.y + 1);
          }
          if (scenario.prepared) {
            const provider = footer.locator(".checkout-handoff a");
            await provider.scrollIntoViewIfNeeded();
            const pb = await provider.boundingBox();
            expect(pb.y).toBeGreaterThanOrEqual(f.y);
            expect(pb.y + pb.height).toBeLessThanOrEqual(f.y + f.height);
            await expect(footer).toContainText(
              "This does not confirm payment.",
            );
            await expect(footer).toContainText("Avoid duplicate payments.");
            expect(await page.evaluate(() => location.hostname)).toBe(
              new URL(base).hostname,
            );
          }
          if (output)
            await page.screenshot({
              path: output + "/" + scenario.name + "-end.png",
              animations: "disabled",
            });
          if (scenario.prepared) {
            await footer.evaluate((element) => {
              element.scrollTop = element.scrollHeight;
            });
            const caption = footer.locator(".invoice-caption");
            const captionBox = await caption.boundingBox();
            expect(captionBox.y).toBeGreaterThanOrEqual(f.y);
            expect(
              captionBox.y + captionBox.height,
              "The final receipt disclaimer must be fully reachable inside the scrollable footer",
            ).toBeLessThanOrEqual(f.y + f.height);
            if (output)
              await page.screenshot({
                path: output + "/" + scenario.name + "-footer-end.png",
                animations: "disabled",
              });
          }
          await close.focus();
          for (let index = 0; index < 12; index++) {
            await page.keyboard.press("Tab");
            const focus = await page.evaluate(() => ({
              tag: document.activeElement?.tagName,
              inDialog: !!document.activeElement?.closest("dialog[open]"),
              documentHasFocus: document.hasFocus(),
            }));
            // Chrome may move Tab to its own toolbar. It must never focus a
            // background page control; the following Tab returns to the dialog.
            expect(
              focus.inDialog ||
                (focus.tag === "BODY" && !focus.documentHasFocus),
            ).toBe(true);
          }
          await page.keyboard.press("Escape");
          await expect(page.locator("dialog[open]")).toHaveCount(0);
          await expect(trigger).toBeFocused();
          record.nativeKeyboardContainmentAndEscapeReturn = true;
          record.fixedHeaderAndReachableFooter = true;
        }
      } finally {
        await context.close();
      }
    }
    expect(results.blocked).toEqual([]);
    expect(results.errors).toEqual([]);
    expect(results.syntheticCheckoutPosts).toBe(longOnly ? 0 : 2);
    console.log(
      `PASS: overlay boundaries ${results.cases.length}/${longOnly ? 1 : cases.length}; full recorded amounts, keyboard containment, explicit close/Escape, drawer route/back and short viewport checkout remain reachable.`,
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

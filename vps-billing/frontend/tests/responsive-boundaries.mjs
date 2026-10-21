// The exact 50-case supervisor contract, rebound to the new console's real controls.
// Legacy evidence IDs describe semantic roles, not old selectors. Branding/context
// is measured before opening the drawer; quote fields are measured inside it.
// Fixtures are bounded GET DTOs. No DOM text/value injection or settings save occurs.
import { expect } from "@playwright/test";
import {
  apiData,
  assertBrandIdentity,
  closePanel,
  createScreen,
  dialog,
  fixture,
  goto,
  locale,
  settle,
  assertScreenSafe,
  widths,
} from "./e2e-support.mjs";

const locales = ["zh-CN", "en"];
const fixtures = {
  ascii: {
    site: "S".repeat(120),
    company: "C".repeat(240),
    prefix: "P".repeat(24),
    suffix: "S".repeat(24),
  },
  cjk: {
    site: "云".repeat(40),
    company: "公".repeat(80),
    prefix: "前".repeat(8),
    suffix: "后".repeat(8),
  },
};
const roles = {
  login: [
    "login-brand",
    "login-small-brand",
    "login-eyebrow",
    "login-footnote",
  ],
  financial: [
    "sidebar-brand",
    "workspace-context",
    "footer-company",
    "price-prefix",
    "price-input",
    "price-suffix",
    "price-code",
  ],
  breadcrumb: ["breadcrumb-root", "breadcrumb-current"],
};
async function measure(page, id, selector, parent) {
  const target = page.locator(selector).first();
  if ((await target.count()) && (await target.isVisible()))
    await target.scrollIntoViewIfNeeded();
  return page.evaluate(
    ({ id, selector, parent }) => {
      const element = document.querySelector(selector),
        container = document.querySelector(parent);
      const rectangle = (r) => ({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      });
      const zero = { x: 0, y: 0, width: 0, height: 0 };
      if (!element || !container)
        return {
          id,
          visible: false,
          rect: zero,
          container_rect: zero,
          text_rect: null,
          line_count: 0,
          client_width: 0,
          scroll_width: 0,
          content_width: 0,
          text_width: 0,
          visible_width: 0,
          overflow_left: 0,
          overflow_right: 0,
        };
      const box = element.getBoundingClientRect(),
        bounds = container.getBoundingClientRect(),
        css = getComputedStyle(element);
      let visible = box.width > 0 && box.height > 0,
        left = Math.max(0, bounds.left),
        right = Math.min(innerWidth, bounds.right);
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (
          style.display === "none" ||
          style.visibility !== "visible" ||
          node.getAttribute("aria-hidden") === "true"
        )
          visible = false;
        if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) {
          const r = node.getBoundingClientRect();
          left = Math.max(left, r.left + node.clientLeft);
          right = Math.min(right, r.left + node.clientLeft + node.clientWidth);
        }
      }
      // Operator branding intentionally ellipsizes and exposes the complete
      // name through title + aria-label (asserted separately). Keep its raw
      // Range evidence, but test its rendered anchor box for layout overflow.
      const brandTarget = id === "login-brand" || id === "sidebar-brand";
      if (brandTarget) {
        const label = element
          .querySelector(":scope > span:last-child")
          ?.getBoundingClientRect();
        if (label) {
          left = Math.max(left, label.left);
          right = Math.min(right, label.right);
        }
      }
      const input = element instanceof HTMLInputElement;
      const range = document.createRange();
      range.selectNodeContents(element);
      const fragments = input
        ? []
        : [...range.getClientRects()].filter(
            (r) => r.width > 0 && r.height > 0,
          );
      const text = fragments.length ? range.getBoundingClientRect() : null;
      const content = Math.max(
        0,
        box.width -
          parseFloat(css.borderLeftWidth || 0) -
          parseFloat(css.borderRightWidth || 0) -
          parseFloat(css.paddingLeft || 0) -
          parseFloat(css.paddingRight || 0),
      );
      const canvas = document.createElement("canvas").getContext("2d");
      canvas.font = css.font;
      const textWidth = input
          ? canvas.measureText(element.value).width
          : text?.width || 0,
        extent = text || box;
      const layoutExtent = brandTarget ? box : extent;
      return {
        id,
        visible,
        rect: rectangle(box),
        container_rect: rectangle(bounds),
        text_rect: text ? rectangle(text) : null,
        line_count: new Set(fragments.map((r) => Math.round(r.top * 2))).size,
        client_width: element.clientWidth,
        scroll_width: element.scrollWidth,
        content_width: content,
        text_width: textWidth,
        visible_width: visible
          ? Math.max(
              0,
              Math.min(extent.right, right) - Math.max(extent.left, left),
            )
          : 0,
        overflow_left: visible
          ? Math.max(0, bounds.left - layoutExtent.left)
          : 0,
        overflow_right: visible
          ? Math.max(0, layoutExtent.right - bounds.right)
          : 0,
      };
    },
    { id, selector, parent },
  );
}
export async function recordBoundaryCase(
  page,
  surface,
  fixtureName,
  language,
  measurements,
) {
  const document = await page.evaluate(() => ({
    viewport_width: innerWidth,
    scroll_width: Math.max(
      window.document.documentElement.scrollWidth,
      window.document.body.scrollWidth,
    ),
  }));
  const checks = [
    {
      id: "document-no-horizontal-overflow",
      passed: document.scroll_width <= document.viewport_width + 1,
    },
  ];
  for (const item of measurements) {
    checks.push({ id: item.id + "-visible", passed: item.visible });
    checks.push({
      id: item.id + "-within-container",
      passed:
        item.visible && item.overflow_left <= 1 && item.overflow_right <= 1,
    });
    if (item.id.startsWith("breadcrumb-"))
      checks.push({
        id: item.id + "-single-line",
        passed: item.visible && item.line_count === 1,
      });
    if (["price-prefix", "price-suffix", "price-code"].includes(item.id))
      checks.push({
        id: item.id + "-fully-readable",
        passed:
          item.visible &&
          item.line_count >= 1 &&
          (item.id !== "price-code" || item.line_count === 1) &&
          item.visible_width + 1 >= item.text_width,
      });
    if (item.id === "price-input") {
      checks.push({
        id: "price-input-usable-width",
        passed: item.visible && item.content_width > 30,
      });
      checks.push({
        id: "price-input-full-value-width",
        passed: item.visible && item.scroll_width <= item.client_width + 1,
      });
    }
  }
  const value = {
    schema: "aster-responsive-boundaries-v1",
    mode: "assertion",
    surface,
    fixture: fixtureName,
    locale: language,
    viewport: { width: page.viewportSize().width, height: 900 },
    document,
    passed: checks.every((c) => c.passed),
    checks,
    measurements,
  };
  if (measurements.map((m) => m.id).join() !== roles[surface].join())
    throw new Error("Responsive semantic target inventory mismatch");
  console.log("BOUNDARY_PROBE_JSON " + JSON.stringify(value));
  return value;
}
async function prepare(screen, base, route, language) {
  await goto(screen.page, base, route);
  await expect(screen.page.locator(".ui-loading,.gh-loading")).toHaveCount(0);
  await locale(screen.page, language);
  await settle(screen.page);
}
export async function probeResponsiveBoundaries(browser, base, adminStorage) {
  const cases = [];
  for (const [name, data] of Object.entries(fixtures))
    for (const language of locales) {
      const anonymous = await createScreen(browser, base);
      try {
        const original = await apiData(
          anonymous.context,
          base,
          "/api/v1/site-settings",
        );
        fixture(anonymous.state, "GET", "/site-settings", {
          ...original,
          site_name: data.site,
          company_name: data.company,
        });
        await prepare(anonymous, base, "/catalog", language);
        await assertBrandIdentity(anonymous.page, data.site);
        for (const width of widths) {
          await anonymous.page.setViewportSize({ width, height: 900 });
          await settle(anonymous.page);
          await assertBrandIdentity(anonymous.page, data.site);
          const metrics = [
            await measure(
              anonymous.page,
              "login-brand",
              ".idc-topbar .brand",
              ".idc-topbar",
            ),
          ];
          await anonymous.page.locator(".header-login").click();
          await expect(
            dialog(anonymous.page).locator(".signin-form"),
          ).toBeVisible();
          metrics.push(
            await measure(
              anonymous.page,
              "login-small-brand",
              "[role=dialog] .signin-trust p",
              "[role=dialog] .panel-body",
            ),
          );
          metrics.push(
            await measure(
              anonymous.page,
              "login-eyebrow",
              "[role=dialog] .signin-trust small",
              "[role=dialog] .panel-body",
            ),
          );
          metrics.push(
            await measure(
              anonymous.page,
              "login-footnote",
              "[role=dialog] .panel-description",
              "[role=dialog] .panel-header",
            ),
          );
          cases.push(
            await recordBoundaryCase(
              anonymous.page,
              "login",
              name,
              language,
              metrics,
            ),
          );
          await closePanel(anonymous.page);
        }
        assertScreenSafe(anonymous);
      } finally {
        await anonymous.context.close();
      }

      const admin = await createScreen(browser, base, adminStorage);
      try {
        const original = await apiData(
          admin.context,
          base,
          "/api/v1/site-settings",
        );
        fixture(admin.state, "GET", "/site-settings", {
          ...original,
          site_name: data.site,
          company_name: data.company,
        });
        const currency = {
          code: "CNY",
          name: language === "en" ? "Synthetic exact CNY" : "合成精确币种",
          prefix: data.prefix,
          suffix: data.suffix,
          decimal_places: 6,
          enabled: true,
          sort_order: 0,
          precision_locked: true,
          usage: {
            plan_prices: 1,
            orders: 0,
            invoices: 0,
            services: 0,
            pending_orders: 0,
            unpaid_invoices: 0,
            ongoing_services: 0,
          },
        };
        fixture(admin.state, "GET", "/admin/currencies", {
          revision: 7,
          default_currency: "CNY",
          currencies: [currency],
        });
        fixture(admin.state, "GET", "/admin/catalog", {
          revision: 7,
          currency_revision: 7,
          items: [
            {
              id: "boundary-plan",
              name: "Synthetic boundary plan",
              description: "Read-only synthetic GET fixture",
              region: "HKG",
              cpu: 2,
              memory_gb: 4,
              disk_gb: 40,
              transfer_tb: 1,
              available: true,
              prices: [
                {
                  currency: "CNY",
                  amount_minor: Number.MAX_SAFE_INTEGER,
                  available: true,
                },
              ],
            },
          ],
        });
        await prepare(admin, base, "/admin/catalog", language);
        await assertBrandIdentity(admin.page, data.site);
        for (const width of widths) {
          await admin.page.setViewportSize({ width, height: 900 });
          await settle(admin.page);
          await assertBrandIdentity(admin.page, data.site);
          const metrics = [
            await measure(
              admin.page,
              "sidebar-brand",
              ".idc-topbar .brand",
              ".idc-topbar",
            ),
            await measure(
              admin.page,
              "workspace-context",
              ".content-breadcrumb",
              "#main-content",
            ),
            await measure(
              admin.page,
              "footer-company",
              ".workspace-footer>span",
              ".workspace-footer",
            ),
          ];
          await admin.page.locator(".edit-action").first().click();
          await expect(
            dialog(admin.page).locator(".price-amount input"),
          ).toHaveValue("9007199254.740991");
          metrics.push(
            await measure(
              admin.page,
              "price-prefix",
              "[role=dialog] .price-amount .price-affix",
              "[role=dialog] .price-row",
            ),
          );
          metrics.push(
            await measure(
              admin.page,
              "price-input",
              "[role=dialog] .price-amount input",
              "[role=dialog] .price-row",
            ),
          );
          metrics.push(
            await measure(
              admin.page,
              "price-suffix",
              "[role=dialog] .price-amount .price-affix:nth-last-of-type(2)",
              "[role=dialog] .price-row",
            ),
          );
          metrics.push(
            await measure(
              admin.page,
              "price-code",
              "[role=dialog] .price-currency strong",
              "[role=dialog] .price-row",
            ),
          );
          cases.push(
            await recordBoundaryCase(
              admin.page,
              "financial",
              name,
              language,
              metrics,
            ),
          );
          await closePanel(admin.page);
        }
        assertScreenSafe(admin);
      } finally {
        await admin.context.close();
      }
    }
  const admin = await createScreen(browser, base, adminStorage);
  try {
    for (const language of locales) {
      await admin.page.setViewportSize({ width: 721, height: 900 });
      await prepare(admin, base, "/admin/customers", language);
      const metrics = [
        await measure(
          admin.page,
          "breadcrumb-root",
          ".content-breadcrumb>span:first-child",
          ".content-breadcrumb",
        ),
        await measure(
          admin.page,
          "breadcrumb-current",
          ".content-breadcrumb>strong",
          ".content-breadcrumb",
        ),
      ];
      cases.push(
        await recordBoundaryCase(
          admin.page,
          "breadcrumb",
          "default",
          language,
          metrics,
        ),
      );
    }
    assertScreenSafe(admin);
  } finally {
    await admin.context.close();
  }
  return {
    cases: cases.length,
    passed: cases.every((value) => value.passed),
    failed: cases.filter((value) => !value.passed).length,
  };
}

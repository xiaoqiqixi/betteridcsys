import { expect } from "@playwright/test";

const locales = ["zh-CN", "en"];
const coreCases = [320, 375].flatMap((width) =>
  locales.flatMap((locale) =>
    ["normal", "ascii", "cjk"].map((fixture) => ({
      width,
      height: 844,
      locale,
      fixture,
    })),
  ),
);
const cases = [
  ...coreCases,
  ...[390, 720, 721].flatMap((width) =>
    locales.flatMap((locale) =>
      ["normal", "ascii"].map((fixture) => ({
        width,
        height: 844,
        locale,
        fixture,
      })),
    ),
  ),
  ...locales.flatMap((locale) =>
    ["normal", "ascii"].map((fixture) => ({
      width: 375,
      height: 480,
      locale,
      fixture,
    })),
  ),
];

function fixtureData({ fixture, locale }) {
  // Each affix is at the accepted 24 UTF-8 byte limit. These are independent
  // read-only responses, never edits to the real registry or existing history.
  const format = {
    code: "CNY",
    name: "人民币",
    prefix:
      fixture === "normal"
        ? "¥"
        : fixture === "ascii"
          ? "P".repeat(24)
          : "前".repeat(8),
    suffix:
      fixture === "normal"
        ? ""
        : fixture === "ascii"
          ? "S".repeat(24)
          : "后".repeat(8),
    decimal_places: 2,
  };
  const plans = [3900, 7900, 15900].map((minor, index) => ({
    id: `synthetic-plan-${index + 1}`,
    name:
      fixture === "normal"
        ? ["Starter", "Essential", "Performance"][index]
        : (locale === "en" ? "Compute-" : "云服务器").repeat(8) + (index + 1),
    description: "合成套餐，仅用于本地布局验收。",
    cpu: index + 1,
    memory_gb: 2 ** (index + 1),
    disk_gb: 40 * (index + 1),
    transfer_tb: index + 1,
    region: index === 2 ? "东京 · Tokyo" : "新加坡 · Singapore",
    price_minor: fixture === "normal" ? minor : Number.MAX_SAFE_INTEGER - index,
    price_revision: 1,
    currency: "CNY",
    currency_format: format,
    available: true,
  }));
  return {
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
        id: "synthetic-checkout-customer",
        name: "Alex",
        email: "checkout@example.invalid",
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
      active_services: 0,
      pending_invoices: 0,
      unpaid_total_minor: 0,
      monthly_total_minor: 0,
      currency: "CNY",
      currency_format: format,
      recent_orders: [],
    },
    "/plans": plans,
    "/services": [],
    "/orders": [],
    "/invoices": [],
    "/audit": [],
  };
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}

function expectedTotal(plan, locale) {
  const minor = BigInt(plan.price_minor);
  const digits = new Intl.NumberFormat(
    locale === "en" ? "en-US" : "zh-CN",
  ).format(minor / 100n);
  return `CNY\u00a0${plan.currency_format.prefix}${digits}.${String(minor % 100n).padStart(2, "0")}${plan.currency_format.suffix}`;
}

async function geometry(page) {
  return page.evaluate(() => {
    const checkout = document.querySelector(".purchase-checkout");
    const total = checkout.querySelector(".purchase-total strong");
    const bar = checkout.getBoundingClientRect();
    const totalBox = total.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(total);
    const fragments = [...range.getClientRects()].filter(
      (part) => part.width > 0 && part.height > 0,
    );
    return {
      width: innerWidth,
      documentWidth: Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      ),
      checkoutHeight: bar.height,
      totalReadable:
        fragments.length > 0 &&
        fragments.every((part) => {
          const hit = document.elementFromPoint(
            (part.left + part.right) / 2,
            (part.top + part.bottom) / 2,
          );
          return (
            part.left >= Math.max(0, totalBox.left) - 1 &&
            part.right <= Math.min(innerWidth, totalBox.right) + 1 &&
            part.top >= Math.max(0, bar.top) - 1 &&
            part.bottom <= Math.min(innerHeight, bar.bottom) + 1 &&
            total.contains(hit)
          );
        }),
    };
  });
}

async function focusVisible(page, expected) {
  await expect(expected).toBeFocused();
  const visible = await expected.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const checkout = document.querySelector(".purchase-checkout");
    const bar = checkout.getBoundingClientRect();
    const header = document.querySelector(".topbar").getBoundingClientRect();
    const fixed = getComputedStyle(checkout).position === "fixed";
    const points = [
      [box.left + 3, box.top + 3],
      [box.right - 3, box.top + 3],
      [box.left + 3, box.bottom - 3],
      [box.right - 3, box.bottom - 3],
      [(box.left + box.right) / 2, (box.top + box.bottom) / 2],
    ];
    const unobscured =
      box.width > 0 &&
      box.height > 0 &&
      box.left >= 0 &&
      box.right <= innerWidth &&
      box.top >= Math.max(0, header.bottom) &&
      box.bottom <= innerHeight &&
      (!fixed || checkout.contains(element) || box.bottom <= bar.top - 3) &&
      points.every(([x, y]) =>
        element.contains(document.elementFromPoint(x, y)),
      );
    return {
      unobscured,
      element: element.textContent,
      box: box.toJSON(),
      header: header.toJSON(),
      checkout: bar.toJSON(),
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  expect(
    visible.unobscured,
    `Keyboard focus must remain fully visible and unobscured: ${JSON.stringify(visible)}`,
  ).toBe(true);
}

async function textVisible(page, selector) {
  const result = await page.locator(selector).evaluate((element) => {
    const checkout = document.querySelector(".purchase-checkout");
    const bar = checkout.getBoundingClientRect();
    const header = document.querySelector(".topbar").getBoundingClientRect();
    const limit =
      getComputedStyle(checkout).position === "fixed"
        ? Math.min(innerHeight, bar.top - 1)
        : innerHeight;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const fragments = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      fragments.push(
        ...[...range.getClientRects()].filter(
          (part) => part.width && part.height,
        ),
      );
    }
    return {
      fragments: fragments.length,
      readable: fragments.every((part) => {
        const hit = document.elementFromPoint(
          (part.left + part.right) / 2,
          (part.top + part.bottom) / 2,
        );
        return (
          part.left >= -1 &&
          part.right <= innerWidth + 1 &&
          part.top >= Math.max(0, header.bottom) &&
          part.bottom <= limit &&
          element.contains(hit)
        );
      }),
    };
  });
  expect(
    result.fragments,
    `${selector} must retain its visible text`,
  ).toBeGreaterThan(0);
  expect(
    result.readable,
    `${selector} text must be fully visible and unobscured`,
  ).toBe(true);
}

export async function probePlanCheckoutBoundaries(browser, base) {
  const origin = new URL(base);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
    throw new Error(
      "Checkout acceptance requires a disposable loopback origin",
    );
  const completed = [];
  for (const configuration of cases) {
    const { width, height, locale, fixture } = configuration;
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      serviceWorkers: "block",
      locale,
    });
    const blocked = [];
    const errors = [];
    try {
      const responses = fixtureData(configuration);
      await context.addInitScript((language) => {
        localStorage.setItem("aster.locale", language);
        localStorage.setItem("aster.currency", "CNY");
      }, locale);
      await context.routeWebSocket("**/*", (socket) => {
        blocked.push("WebSocket blocked");
        socket.close();
      });
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin.origin || request.method() !== "GET") {
          blocked.push("External or non-GET request blocked");
          await route.abort("blockedbyclient");
          return;
        }
        if (!url.pathname.startsWith("/api/")) {
          await route.continue();
          return;
        }
        const pathname = url.pathname.replace(/^\/api\/v1/, "");
        if (!Object.hasOwn(responses, pathname)) {
          blocked.push(`Unknown synthetic API route: ${pathname}`);
          await route.abort("blockedbyclient");
          return;
        }
        await route.fulfill({
          status: 200,
          json: { data: responses[pathname] },
        });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(new URL("/plans", origin).href);
      await expect(page.locator(".purchase-page")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator(".purchase-review")).toBeEnabled();
      await expect(page.locator(".catalog-plan")).toHaveCount(3);
      await expect(page.locator(".purchase-total strong")).toHaveText(
        expectedTotal(responses["/plans"][0], locale),
      );
      await page.locator(".purchase-total").scrollIntoViewIfNeeded();
      await settle(page);
      const initial = await geometry(page);
      expect(initial.documentWidth).toBeLessThanOrEqual(initial.width + 1);
      expect(
        initial.totalReadable,
        "The complete monetary amount must remain readable",
      ).toBe(true);
      const controls = page.locator(
        ".region-options button, .plan-select, .purchase-review",
      );
      await expect(controls).toHaveCount(7);
      await controls.first().focus();
      for (let index = 1; index < 7; index++) {
        await page.keyboard.press("Tab");
        await settle(page);
        await focusVisible(page, controls.nth(index));
      }
      await page.keyboard.press("Shift+Tab");
      await settle(page);
      await focusVisible(page, controls.nth(5));
      for (const selector of [".purchase-price-note", ".purchase-boundary"]) {
        await page
          .locator(selector)
          .evaluate((element) => element.scrollIntoView({ block: "center" }));
        await settle(page);
        await textVisible(page, selector);
      }
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      await settle(page);
      await textVisible(page, ".main-footer");
      const bottom = await geometry(page);
      expect(bottom.documentWidth).toBeLessThanOrEqual(bottom.width + 1);
      expect(errors, "Synthetic checkout must have no runtime errors").toEqual(
        [],
      );
      expect(
        blocked,
        "Synthetic checkout must not attempt external, mutation or unknown requests",
      ).toEqual([]);
      const result = {
        ...configuration,
        checkoutHeight: bottom.checkoutHeight,
        passed: true,
      };
      completed.push(result);
      // Independent assertions: retain the supervisor's original 50 boundary
      // records and 30-screenshot contract without adding synthetic images.
      console.log("CHECKOUT_PROBE_JSON " + JSON.stringify(result));
    } finally {
      await context.close();
    }
  }
  expect(completed).toHaveLength(28);
  return { cases: completed.length, coreCases: coreCases.length };
}

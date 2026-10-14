// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { defaultSiteSettings } from "../src/lib/settings";
import { restorePreferences, locale, currency } from "../src/lib/i18n";
import App from "../src/App.vue";
import { defaultCurrencyRegistry } from "../src/lib/currencies";
const configuredCurrencies = () => ({
  ...structuredClone(defaultCurrencyRegistry),
  currencies: [
    ...structuredClone(defaultCurrencyRegistry.currencies),
    {
      code: "USD",
      name: "US Dollar",
      prefix: "$",
      suffix: "",
      decimal_places: 2,
      enabled: true,
      sort_order: 1,
      precision_locked: true,
    },
  ],
});
import * as fixtures from "../src/lib/preview";
let checkoutResponse: unknown;
let activeUser: null | typeof fixtures.previewUser = null;
let requests: { path: string; method: string; options: RequestInit }[] = [];
async function mountApp() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }],
  });
  await router.push("/overview");
  const wrapper = mount(App, {
    global: { plugins: [router] },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, router };
}
beforeEach(() => {
  localStorage.clear();
  restorePreferences();
  activeUser = null;
  checkoutResponse = undefined;
  requests = [];
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options: RequestInit) => {
      const endpoint = path.replace("/api/v1", "");
      const requestedCurrency =
        new URL(path, "http://localhost").searchParams.get("currency") || "CNY";
      requests.push({
        path: endpoint,
        method: options.method || "GET",
        options,
      });
      let data: unknown;
      if (endpoint === "/currencies") data = configuredCurrencies();
      else if (endpoint === "/site-settings") data = defaultSiteSettings;
      else if (endpoint === "/session")
        data = { user: activeUser, csrf_token: "csrf-test", demo_mode: true };
      else if (endpoint === "/auth/login") {
        activeUser = { ...fixtures.previewUser };
        data = { user: activeUser };
      } else if (endpoint === "/auth/logout") {
        activeUser = null;
        data = { ok: true };
      } else if (endpoint.startsWith("/overview?"))
        data = {
          active_services: 3,
          pending_invoices: requestedCurrency === "USD" ? 1 : 0,
          unpaid_total_minor: requestedCurrency === "USD" ? 2400 : 0,
          monthly_total_minor: requestedCurrency === "USD" ? 4200 : 0,
          currency: requestedCurrency,
          recent_orders: fixtures.orders,
        };
      else if (endpoint === "/services") data = fixtures.services;
      else if (endpoint.startsWith("/plans?"))
        data = fixtures.previewPlans(requestedCurrency as "CNY" | "USD");
      else if (endpoint === "/orders")
        data = options.method === "POST" ? fixtures.orders[0] : fixtures.orders;
      else if (endpoint === "/invoices") data = fixtures.invoices;
      else if (endpoint === "/audit") data = fixtures.audit;
      else if (endpoint.endsWith("/checkout") && checkoutResponse !== undefined)
        data = checkoutResponse;
      else if (endpoint.endsWith("/checkout"))
        return {
          ok: false,
          json: async () => ({
            error: { code: "PAYMENT_NOT_CONFIGURED", message: "Unavailable" },
          }),
        };
      else if (endpoint.startsWith("/invoices/")) data = fixtures.invoices[0];
      else throw new Error("Unexpected endpoint: " + endpoint);
      return { ok: true, json: async () => ({ data }) };
    }),
  );
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
describe("billing workspace flows", () => {
  it("initializes a new CNY-only installation before fetching prices and keeps old USD history literal", async () => {
    activeUser = { ...fixtures.previewUser };
    localStorage.setItem("aster.currency", "USD");
    localStorage.setItem("aster.locale", "en");
    restorePreferences();
    const originalFetch = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit) =>
        path.endsWith("/currencies")
          ? {
              ok: true,
              json: async () => ({
                data: structuredClone(defaultCurrencyRegistry),
              }),
            }
          : originalFetch(path, options),
      ),
    );
    const { wrapper, router } = await mountApp();
    expect(locale.value).toBe("en");
    expect(currency.value).toBe("CNY");
    expect(
      wrapper.findAll('select[aria-label="Currency"] option'),
    ).toHaveLength(1);
    expect(
      requests.some((request) => request.path.includes("currency=USD")),
    ).toBe(false);
    await router.push("/invoices");
    await flushPromises();
    expect(wrapper.find("table").text()).toContain("USD 24.00");
    wrapper.unmount();
  });
  it("uses historical currency and plan snapshots even when the registry or live catalog differs", async () => {
    activeUser = { ...fixtures.previewUser };
    const oldFormat = {
      code: "KWD",
      name: "Recorded dinar",
      prefix: "old ",
      suffix: "",
      decimal_places: 3,
    };
    const originalFetch = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit) => {
        let data: unknown;
        if (path.endsWith("/currencies"))
          data = {
            ...configuredCurrencies(),
            currencies: [
              ...configuredCurrencies().currencies,
              {
                ...oldFormat,
                prefix: "new ",
                enabled: false,
                precision_locked: true,
                sort_order: 4,
              },
            ],
          };
        else if (path.endsWith("/invoices"))
          data = [
            {
              ...fixtures.invoices[0],
              currency: "KWD",
              amount_minor: 1234,
              currency_format: oldFormat,
            },
          ];
        else if (path.endsWith("/orders"))
          data = [
            {
              ...fixtures.orders[0],
              plan_snapshot: {
                plan_id: "p1",
                name: "Recorded plan",
                cpu: 7,
                memory_gb: 9,
                disk_gb: 111,
                transfer_tb: 3,
                region: "Recorded region",
                billing_cycle: "monthly",
              },
            },
            fixtures.orders[1],
          ];
        else return originalFetch(path, options);
        return { ok: true, json: async () => ({ data }) };
      }),
    );
    const { wrapper, router } = await mountApp();
    await router.push("/invoices");
    await flushPromises();
    expect(wrapper.find("table").text()).toContain("KWD old 1.234");
    expect(wrapper.find("table").text()).not.toContain("new ");
    expect(
      wrapper
        .findAll('select[aria-label="币种"] option')
        .map((item) => item.attributes("value")),
    ).not.toContain("KWD");
    await router.push("/orders");
    await flushPromises();
    expect(wrapper.find("table").text()).toContain("Recorded plan");
    expect(wrapper.find("table").text()).toContain("7 vCPU");
    expect(wrapper.find("table").text()).toContain("Recorded region");
    expect(wrapper.find("table").text()).toContain("未保存成交规格");
    wrapper.unmount();
  });
  it("reconciles a newly disabled purchase preference before requesting another catalog", async () => {
    activeUser = { ...fixtures.previewUser };
    let registry = configuredCurrencies();
    const originalFetch = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit) =>
        path.endsWith("/currencies")
          ? { ok: true, json: async () => ({ data: registry }) }
          : originalFetch(path, options),
      ),
    );
    const { wrapper, router } = await mountApp();
    await router.push("/plans");
    await wrapper.find('select[aria-label="币种"]').setValue("USD");
    await flushPromises();
    const oldRequestCount = requests.length;
    registry = {
      ...registry,
      revision: 2,
      currencies: registry.currencies.map((item) => ({
        ...item,
        enabled: item.code !== "USD",
      })),
    };
    await wrapper.find('button[aria-label="刷新数据"]').trigger("click");
    await flushPromises();
    expect(currency.value).toBe("CNY");
    expect(
      requests
        .slice(oldRequestCount)
        .filter((request) => request.path.startsWith("/plans?")),
    ).toHaveLength(1);
    expect(
      requests
        .slice(oldRequestCount)
        .filter((request) => request.path.startsWith("/plans?")),
    ).toEqual([expect.objectContaining({ path: "/plans?currency=CNY" })]);
    expect(wrapper.find(".purchase-total").text()).toContain("CNY");
    wrapper.unmount();
  });
  it("lets administrators query disabled historical currencies without enabling them for purchases", async () => {
    activeUser = { ...fixtures.previewUser, role: "admin" };
    const originalFetch = fetch;
    const reportQueries: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit) => {
        let data: unknown;
        if (path.endsWith("/currencies"))
          data = {
            ...configuredCurrencies(),
            currencies: configuredCurrencies().currencies.map((item) => ({
              ...item,
              enabled: item.code !== "USD",
            })),
          };
        else if (path.includes("/admin/overview?")) {
          const code = new URL(path, "http://localhost").searchParams.get(
            "currency",
          )!;
          reportQueries.push(code);
          data = {
            customers: 1,
            total_services: 0,
            unpaid_invoices: 0,
            unpaid_total_minor: 0,
            revenue_minor: code === "USD" ? 1201 : 0,
            currency: code,
            currency_format: {
              code,
              name: code,
              prefix: "",
              suffix: "",
              decimal_places: 2,
            },
          };
        } else if (path.includes("/admin/")) data = [];
        else return originalFetch(path, options);
        return { ok: true, json: async () => ({ data }) };
      }),
    );
    const { wrapper } = await mountApp();
    expect(
      wrapper.find('select[aria-label="币种"] option[value="USD"]').text(),
    ).toContain("仅历史");
    await wrapper.find('select[aria-label="币种"]').setValue("USD");
    await flushPromises();
    expect(reportQueries.at(-1)).toBe("USD");
    expect(wrapper.text()).toContain("USD 12.01");
    expect(currency.value).toBe("CNY");
    expect(requests.some((request) => request.method === "POST")).toBe(false);
    wrapper.unmount();
  });
  it("retains the selected region and plan through a delayed currency reload", async () => {
    activeUser = { ...fixtures.previewUser };
    const { wrapper, router } = await mountApp();
    await router.push("/plans");
    await flushPromises();
    const plan = fixtures.previewPlans("CNY")[2]!;
    await wrapper.findAll(".region-options button")[2]!.trigger("click");
    expect(wrapper.find(".purchase-summary").text()).toContain(plan.name);
    const originalFetch = fetch;
    let resolvePlans!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit) => {
        if (path.endsWith("/plans?currency=USD"))
          return new Promise((resolve) => {
            resolvePlans = resolve;
          });
        return originalFetch(path, options);
      }),
    );
    await wrapper.find('select[aria-label="币种"]').setValue("USD");
    await flushPromises();
    expect(wrapper.find(".purchase-page").exists()).toBe(true);
    expect(wrapper.find(".purchase-total").exists()).toBe(false);
    expect(
      wrapper.find(".purchase-review").attributes("disabled"),
    ).toBeDefined();
    resolvePlans({
      ok: true,
      json: async () => ({ data: fixtures.previewPlans("USD") }),
    });
    await flushPromises();
    expect(wrapper.findAll(".catalog-plan")).toHaveLength(1);
    expect(wrapper.find('.region-options [aria-pressed="true"]').text()).toBe(
      plan.region,
    );
    expect(wrapper.find(".purchase-summary").text()).toContain(plan.name);
    expect(wrapper.find(".purchase-total").text()).toContain("USD 24.00");
    await wrapper.find('select[aria-label="币种"]').setValue("CNY");
    await flushPromises();
    expect(wrapper.findAll(".catalog-plan")).toHaveLength(1);
    expect(wrapper.find(".purchase-total").text()).toContain("CNY 159.00");
    expect(
      requests.filter((request) => request.method === "POST"),
    ).toHaveLength(0);
    wrapper.unmount();
  });
  it("keeps locale and currency independent and historical invoices in their recorded currency", async () => {
    activeUser = { ...fixtures.previewUser };
    const { wrapper, router } = await mountApp();
    expect(locale.value).toBe("zh-CN");
    expect(currency.value).toBe("CNY");
    await router.push("/invoices");
    await flushPromises();
    expect(wrapper.find(".invoice-summary").text()).toContain("CNY 0.00");
    expect(wrapper.find("table").text()).toContain("USD 24.00");
    await wrapper.find('select[aria-label="语言"]').setValue("en");
    await flushPromises();
    expect(currency.value).toBe("CNY");
    expect(document.documentElement.lang).toBe("en");
    expect(wrapper.text()).toContain("Invoices and payments");
    expect(wrapper.find("table").text()).toContain("USD 24.00");
    expect(requests.at(-1)!.options.headers).toMatchObject({
      "Accept-Language": "en",
    });
    await wrapper.find('select[aria-label="Currency"]').setValue("USD");
    await flushPromises();
    expect(locale.value).toBe("en");
    expect(wrapper.find(".invoice-summary").text()).toContain("USD 24.00");
    await router.push("/plans");
    await flushPromises();
    expect(wrapper.find(".plan-price").text()).toContain("USD 6.00");
    await wrapper.find('select[aria-label="Currency"]').setValue("CNY");
    await flushPromises();
    expect(wrapper.find(".plan-price").text()).toContain("CNY 39.00");
    expect(localStorage.getItem("aster.locale")).toBe("en");
    expect(localStorage.getItem("aster.currency")).toBe("CNY");
    wrapper.unmount();
  });
  it("applies operator defaults but does not overwrite explicit browser preferences", async () => {
    const originalFetch = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit) => {
        if (path.endsWith("/currencies"))
          return {
            ok: true,
            json: async () => ({
              data: { ...configuredCurrencies(), default_currency: "USD" },
            }),
          };
        if (path.endsWith("/site-settings"))
          return {
            ok: true,
            json: async () => ({
              data: {
                ...defaultSiteSettings,
                site_name: "Example Cloud",
                company_name: "Example Operator",
                default_locale: "en",
                default_currency: "USD",
                theme: "teal",
                logo: "server",
              },
            }),
          };
        return originalFetch(path, options);
      }),
    );
    const first = await mountApp();
    expect(locale.value).toBe("en");
    expect(currency.value).toBe("USD");
    expect(first.wrapper.find(".login-brand").text()).toBe("Example Cloud");
    expect(document.title).toContain("Example Cloud");
    expect(document.documentElement.dataset.theme).toBe("teal");
    await first.wrapper.find('select[aria-label="Language"]').setValue("zh-CN");
    await first.wrapper.find('select[aria-label="币种"]').setValue("CNY");
    first.wrapper.unmount();
    restorePreferences();
    const second = await mountApp();
    expect(locale.value).toBe("zh-CN");
    expect(currency.value).toBe("CNY");
    expect(second.wrapper.text()).toContain("欢迎回来");
    second.wrapper.unmount();
  });
  it("shows the historical issuer snapshot without borrowing current operator identity", async () => {
    activeUser = { ...fixtures.previewUser };
    const originalFetch = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit) => {
        if (path.endsWith("/invoices/i1"))
          return {
            ok: true,
            json: async () => ({
              data: {
                ...fixtures.invoices[0],
                issuer: {
                  name: "Original Operator",
                  address: "Original address",
                  support_email: "original@example.com",
                },
              },
            }),
          };
        return originalFetch(path, options);
      }),
    );
    const { wrapper, router } = await mountApp();
    await router.push("/invoices");
    await flushPromises();
    await wrapper.findAll(".table-action")[0]!.trigger("click");
    await flushPromises();
    expect(wrapper.find(".invoice-issuer").text()).toContain(
      "Original Operator",
    );
    expect(wrapper.find(".invoice-document").text()).not.toContain("星屿云");
    await wrapper
      .find('.invoice-modal button[aria-label="关闭"]')
      .trigger("click");
    await wrapper.findAll(".table-action")[1]!.trigger("click");
    await flushPromises();
    expect(wrapper.find(".invoice-document").text()).toContain(
      "此历史账单未记录开具方信息",
    );
    wrapper.unmount();
  });
  it.each([
    "CSRF_FAILED",
    "CURRENCY_DISABLED",
    "UNSUPPORTED_CURRENCY",
    "PRICE_CHANGED",
  ])(
    "retries the original payload and key after a timeout, %s and currency change",
    async (rejection) => {
      activeUser = { ...fixtures.previewUser };
      const originalFetch = fetch;
      const attempts: RequestInit[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string, options: RequestInit) => {
          if (path.endsWith("/orders") && options.method === "POST") {
            attempts.push(options);
            if (attempts.length === 1)
              throw new TypeError("connection lost after commit");
            if (attempts.length === 2)
              return {
                ok: false,
                status: rejection === "CSRF_FAILED" ? 403 : 409,
                json: async () => ({
                  error: {
                    code: rejection,
                    message: "Session needs refresh",
                  },
                }),
              };
          }
          return originalFetch(path, options);
        }),
      );
      const { wrapper, router } = await mountApp();
      await router.push("/plans");
      await flushPromises();
      await wrapper.find(".purchase-review").trigger("click");
      await wrapper.find("#hostname").setValue("original-host");
      await wrapper.find("input[type=checkbox]").setValue(true);
      await wrapper.find("dialog form").trigger("submit");
      await flushPromises();
      expect(wrapper.find("#hostname").attributes("disabled")).toBeDefined();
      expect(wrapper.text()).toContain("订单结果尚未确认");
      await wrapper.find("dialog form").trigger("submit");
      await flushPromises();
      expect(wrapper.find("#hostname").attributes("disabled")).toBeDefined();
      await wrapper
        .find('dialog[aria-labelledby="order-title"] button[aria-label="关闭"]')
        .trigger("click");
      await wrapper.find('select[aria-label="币种"]').setValue("USD");
      await flushPromises();
      await wrapper.find(".purchase-review").trigger("click");
      expect(wrapper.find("#hostname").element).toHaveProperty(
        "value",
        "original-host",
      );
      expect(wrapper.find(".order-plan").text()).toContain("CNY 39.00");
      await wrapper.find("dialog form").trigger("submit");
      await flushPromises();
      expect(attempts).toHaveLength(3);
      expect(
        new Set(
          attempts.map(
            (r) => (r.headers as Record<string, string>)["Idempotency-Key"],
          ),
        ).size,
      ).toBe(1);
      expect(new Set(attempts.map((r) => r.body)).size).toBe(1);
      expect(JSON.parse(attempts[0]!.body as string)).toEqual({
        plan_id: "p1",
        hostname: "original-host",
        currency: "CNY",
        quote: { price_minor: 3900, decimal_places: 2, price_revision: 1 },
      });
      expect(router.currentRoute.value.path).toBe("/orders");
      wrapper.unmount();
    },
  );
  it("requires a fresh confirmation and quote after a definitive server price change", async () => {
    activeUser = { ...fixtures.previewUser };
    const originalFetch = fetch;
    const attempts: RequestInit[] = [];
    let changed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit) => {
        if (path.endsWith("/plans?currency=CNY") && changed)
          return {
            ok: true,
            json: async () => ({
              data: fixtures.previewPlans("CNY").map((plan) => ({
                ...plan,
                price_minor: 9900,
                price_revision: 2,
              })),
            }),
          };
        if (path.endsWith("/orders") && options.method === "POST") {
          attempts.push(options);
          if (attempts.length === 1) {
            changed = true;
            return {
              ok: false,
              status: 409,
              json: async () => ({
                error: {
                  code: "PRICE_CHANGED",
                  message: "Review the updated quote",
                },
              }),
            };
          }
        }
        return originalFetch(path, options);
      }),
    );
    const { wrapper, router } = await mountApp();
    await router.push("/plans");
    await flushPromises();
    await wrapper.find(".purchase-review").trigger("click");
    await wrapper.find("#hostname").setValue("old-quote-host");
    await wrapper.find("input[type=checkbox]").setValue(true);
    await wrapper.find("dialog form").trigger("submit");
    await flushPromises();
    expect(attempts).toHaveLength(1);
    expect(
      wrapper.find('dialog[aria-labelledby="order-title"]').attributes("open"),
    ).toBeUndefined();
    expect(wrapper.text()).toContain("套餐、价格或币种已变化");
    expect(wrapper.find(".purchase-total").text()).toContain("CNY 99.00");
    await wrapper.find(".purchase-review").trigger("click");
    expect(
      (wrapper.find("input[type=checkbox]").element as HTMLInputElement)
        .checked,
    ).toBe(false);
    await wrapper.find("dialog form").trigger("submit");
    await flushPromises();
    expect(attempts).toHaveLength(1);
    await wrapper.find("#hostname").setValue("new-quote-host");
    await wrapper.find("input[type=checkbox]").setValue(true);
    await wrapper.find("dialog form").trigger("submit");
    await flushPromises();
    expect(attempts).toHaveLength(2);
    expect(JSON.parse(attempts[0]!.body as string).quote).toEqual({
      price_minor: 3900,
      decimal_places: 2,
      price_revision: 1,
    });
    expect(JSON.parse(attempts[1]!.body as string).quote).toEqual({
      price_minor: 9900,
      decimal_places: 2,
      price_revision: 2,
    });
    expect(
      (attempts[1]!.headers as Record<string, string>)["Idempotency-Key"],
    ).not.toBe(
      (attempts[0]!.headers as Record<string, string>)["Idempotency-Key"],
    );
    wrapper.unmount();
  });
  it("blocks an unsubmitted confirmation while refreshed server prices are pending", async () => {
    activeUser = { ...fixtures.previewUser };
    const { wrapper, router } = await mountApp();
    await router.push("/plans");
    await flushPromises();
    await wrapper.find(".purchase-review").trigger("click");
    await wrapper.find("#hostname").setValue("wait-for-price");
    await wrapper.find("input[type=checkbox]").setValue(true);
    const originalFetch = fetch;
    let resolvePlans!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit) => {
        if (path.includes("/plans?"))
          return new Promise((resolve) => {
            resolvePlans = resolve;
          });
        return originalFetch(path, options);
      }),
    );
    await wrapper.find('button[aria-label="刷新数据"]').trigger("click");
    await flushPromises();
    expect(
      wrapper
        .find('dialog[aria-labelledby="order-title"] .button.primary')
        .attributes("disabled"),
    ).toBeDefined();
    await wrapper.find("dialog form").trigger("submit");
    expect(
      requests.filter(
        (request) => request.path === "/orders" && request.method === "POST",
      ),
    ).toHaveLength(0);
    const plans = fixtures.previewPlans("CNY");
    plans[0]!.price_minor += 100;
    resolvePlans({ ok: true, json: async () => ({ data: plans }) });
    await flushPromises();
    expect(
      wrapper.find('dialog[aria-labelledby="order-title"]').attributes("open"),
    ).toBeUndefined();
    expect(wrapper.text()).toContain("套餐、价格或币种已变化");
    wrapper.unmount();
  });
  it.each(["price", "availability", "removed", "currency"])(
    "requires renewed confirmation when an unsubmitted order changes: %s",
    async (change) => {
      activeUser = { ...fixtures.previewUser };
      const { wrapper, router } = await mountApp();
      await router.push("/plans");
      await flushPromises();
      await wrapper.find(".purchase-review").trigger("click");
      await wrapper.find("#hostname").setValue("review-again");
      await wrapper.find("input[type=checkbox]").setValue(true);
      if (change === "currency") {
        await wrapper.find('select[aria-label="币种"]').setValue("USD");
      } else {
        const originalFetch = fetch;
        vi.stubGlobal(
          "fetch",
          vi.fn(async (path: string, options: RequestInit) => {
            if (path.includes("/plans?")) {
              const plans = fixtures.previewPlans("CNY");
              if (change === "price") plans[0]!.price_minor += 100;
              if (change === "availability") plans[0]!.available = false;
              return {
                ok: true,
                json: async () => ({
                  data: change === "removed" ? plans.slice(1) : plans,
                }),
              };
            }
            return originalFetch(path, options);
          }),
        );
        await wrapper.find('button[aria-label="刷新数据"]').trigger("click");
      }
      await flushPromises();
      expect(
        wrapper
          .find('dialog[aria-labelledby="order-title"]')
          .attributes("open"),
      ).toBeUndefined();
      expect(wrapper.text()).toContain("套餐、价格或币种已变化");
      await wrapper.find("dialog form").trigger("submit");
      expect(
        requests.filter(
          (request) => request.path === "/orders" && request.method === "POST",
        ),
      ).toHaveLength(0);
      await wrapper.find(".purchase-review").trigger("click");
      expect(
        wrapper
          .find('dialog[aria-labelledby="order-title"]')
          .attributes("open"),
      ).toBeDefined();
      expect(wrapper.find("input[type=checkbox]").element).toHaveProperty(
        "checked",
        false,
      );
      wrapper.unmount();
    },
  );
  it("allows correcting a definitively rejected first order with a new key", async () => {
    activeUser = { ...fixtures.previewUser };
    const originalFetch = fetch;
    const attempts: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit) => {
        if (path.endsWith("/orders") && options.method === "POST") {
          attempts.push(options);
          if (attempts.length === 1)
            return {
              ok: false,
              status: 400,
              json: async () => ({
                error: {
                  code: "VALIDATION_ERROR",
                  message: "Invalid server name",
                },
              }),
            };
        }
        return originalFetch(path, options);
      }),
    );
    const { wrapper, router } = await mountApp();
    await router.push("/plans");
    await flushPromises();
    await wrapper.find(".purchase-review").trigger("click");
    await wrapper.find("#hostname").setValue("bad-host-");
    await wrapper.find("input[type=checkbox]").setValue(true);
    await wrapper.find("dialog form").trigger("submit");
    await flushPromises();
    expect(wrapper.find("#hostname").attributes("disabled")).toBeUndefined();
    await wrapper.find("#hostname").setValue("corrected-host");
    await wrapper.find("dialog form").trigger("submit");
    await flushPromises();
    expect(attempts).toHaveLength(2);
    expect(
      (attempts[0]!.headers as Record<string, string>)["Idempotency-Key"],
    ).not.toBe(
      (attempts[1]!.headers as Record<string, string>)["Idempotency-Key"],
    );
    expect(JSON.parse(attempts[1]!.body as string).hostname).toBe(
      "corrected-host",
    );
    wrapper.unmount();
  });
  it.each(["CURRENCY_DISABLED", "UNSUPPORTED_CURRENCY"])(
    "allows choosing a new currency and key after a definitive first %s rejection",
    async (code) => {
      activeUser = { ...fixtures.previewUser };
      const originalFetch = fetch;
      const attempts: RequestInit[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string, options: RequestInit) => {
          if (path.endsWith("/orders") && options.method === "POST") {
            attempts.push(options);
            if (attempts.length === 1)
              return {
                ok: false,
                status: code === "CURRENCY_DISABLED" ? 409 : 400,
                json: async () => ({
                  error: { code, message: "Currency unavailable" },
                }),
              };
          }
          return originalFetch(path, options);
        }),
      );
      const { wrapper, router } = await mountApp();
      await router.push("/plans");
      await flushPromises();
      await wrapper.find(".purchase-review").trigger("click");
      await wrapper.find("#hostname").setValue("first-host");
      await wrapper.find("input[type=checkbox]").setValue(true);
      await wrapper.find("dialog form").trigger("submit");
      await flushPromises();
      expect(wrapper.find("#hostname").attributes("disabled")).toBeUndefined();
      expect(wrapper.text()).not.toContain("订单结果尚未确认");
      await wrapper
        .find('dialog[aria-labelledby="order-title"] button[aria-label="关闭"]')
        .trigger("click");
      await wrapper.find('select[aria-label="币种"]').setValue("USD");
      await flushPromises();
      await wrapper.find(".purchase-review").trigger("click");
      await wrapper.find("#hostname").setValue("new-currency-host");
      await wrapper.find("input[type=checkbox]").setValue(true);
      await wrapper.find("dialog form").trigger("submit");
      await flushPromises();
      expect(attempts).toHaveLength(2);
      expect(
        (attempts[1]!.headers as Record<string, string>)["Idempotency-Key"],
      ).not.toBe(
        (attempts[0]!.headers as Record<string, string>)["Idempotency-Key"],
      );
      expect(JSON.parse(attempts[1]!.body as string)).toEqual({
        plan_id: "p1",
        hostname: "new-currency-host",
        currency: "USD",
        quote: { price_minor: 600, decimal_places: 2, price_revision: 1 },
      });
      expect(router.currentRoute.value.path).toBe("/orders");
      wrapper.unmount();
    },
  );
  it("refreshes CSRF before an uncertain retry and never resends under a different account", async () => {
    activeUser = { ...fixtures.previewUser };
    const originalFetch = fetch;
    let posts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit) => {
        if (path.endsWith("/orders") && options.method === "POST") {
          posts++;
          throw new TypeError("unconfirmed");
        }
        return originalFetch(path, options);
      }),
    );
    const { wrapper, router } = await mountApp();
    await router.push("/plans");
    await flushPromises();
    await wrapper.find(".purchase-review").trigger("click");
    await wrapper.find("#hostname").setValue("original-account-host");
    await wrapper.find("input[type=checkbox]").setValue(true);
    await wrapper.find("dialog form").trigger("submit");
    await flushPromises();
    activeUser = {
      ...fixtures.previewUser,
      id: "different-account",
      name: "Different user",
    };
    await wrapper.find("dialog form").trigger("submit");
    await flushPromises();
    expect(posts).toBe(1);
    expect(
      wrapper.find('dialog[aria-labelledby="order-title"]').attributes("open"),
    ).toBeUndefined();
    expect(wrapper.find(".data-panel").exists()).toBe(false);
    expect(wrapper.text()).toContain("原订单未重发");
    expect(wrapper.find("#hostname").element).toHaveProperty("value", "");
    expect(requests.filter((r) => r.path === "/session")).toHaveLength(2);
    wrapper.unmount();
  });
  it("renders a missing currency price as unavailable, never as a free plan", async () => {
    activeUser = { ...fixtures.previewUser };
    const originalFetch = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit) => {
        if (path.includes("/plans?"))
          return {
            ok: true,
            json: async () => ({
              data: [
                {
                  ...fixtures.plans[0],
                  currency: "CNY",
                  available: false,
                  price_minor: 0,
                },
              ],
            }),
          };
        return originalFetch(path, options);
      }),
    );
    const { wrapper, router } = await mountApp();
    await router.push("/plans");
    await flushPromises();
    expect(wrapper.find(".plan-price").text()).toContain("暂不可售");
    expect(wrapper.find(".plan-price").text()).not.toContain("0.00");
    expect(
      wrapper.find(".catalog-plan button").attributes("disabled"),
    ).toBeDefined();
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
    wrapper.unmount();
  });
  it("ignores invoice details that finish after the dialog was closed", async () => {
    activeUser = { ...fixtures.previewUser };
    const { wrapper, router } = await mountApp();
    await router.push("/invoices");
    await flushPromises();
    let resolveDetail!: (value: unknown) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDetail = resolve as typeof resolveDetail;
        }),
    );
    await wrapper.findAll(".table-action")[0]!.trigger("click");
    await flushPromises();
    await wrapper
      .find('.invoice-modal button[aria-label="关闭"]')
      .trigger("click");
    await wrapper.findAll(".table-action")[1]!.trigger("click");
    await flushPromises();
    resolveDetail({
      ok: true,
      json: async () => ({
        data: { ...fixtures.invoices[0], number: "STALE-INVOICE" },
      }),
    });
    await flushPromises();
    expect(wrapper.find(".invoice-modal").text()).not.toContain(
      "STALE-INVOICE",
    );
    wrapper.unmount();
  });
  it.each([
    ["https://checkout.example.com/session/test", true],
    ["javascript:alert(1)", false],
    ["http://checkout.example.com/session/test", false],
    ["https://name:password@checkout.example.com/session/test", false],
  ])(
    "validates checkout destination %s without marking the invoice paid",
    async (url, valid) => {
      activeUser = { ...fixtures.previewUser };
      checkoutResponse = {
        provider_id: "test-payment",
        session_id: "session-test",
        checkout_url: url,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      };
      const { wrapper, router } = await mountApp();
      await router.push("/invoices");
      await flushPromises();
      await wrapper.findAll(".table-action")[0]!.trigger("click");
      await flushPromises();
      await wrapper
        .findAll("button")
        .find((b) => b.text() === "检查支付可用性")!
        .trigger("click");
      await flushPromises();
      const link = wrapper.find(".checkout-handoff a");
      expect(link.exists()).toBe(valid);
      if (valid) {
        expect(link.attributes("href")).toBe(url);
        expect(link.attributes("target")).toBe("_blank");
        expect(link.attributes("rel")).toBe("noopener noreferrer");
        expect(link.text()).toContain("前往支付服务商");
        expect(wrapper.find(".checkout-handoff").text()).toContain(
          "此操作不代表已付款",
        );
      } else {
        expect(wrapper.find(".invoice-modal").text()).toContain(
          "本次未完成付款",
        );
      }
      expect(wrapper.find(".invoice-doc-top .badge").text()).toBe("待付款");
      expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
      wrapper.unmount();
    },
  );

  it("keeps preview explicitly read-only and never sends writes", async () => {
    const { wrapper, router } = await mountApp();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "只读设计预览")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("只读设计预览 · 以下均为样例数据");
    await router.push("/plans");
    await flushPromises();
    await wrapper.find(".purchase-review").trigger("click");
    await flushPromises();
    const action = wrapper
      .findAll("button")
      .find((b) => b.text() === "预览模式不可下单")!;
    expect(action.attributes("disabled")).toBeDefined();
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
    wrapper.unmount();
  });
  it("creates an order through API with CSRF and idempotency, then fails payment closed", async () => {
    const { wrapper, router } = await mountApp();
    await wrapper
      .findAll("button")
      .find((b) => b.text().includes("体验客户工作台"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("你好，Alex");
    await router.push("/plans");
    await flushPromises();
    await wrapper.find(".purchase-review").trigger("click");
    await flushPromises();
    await wrapper.find("#hostname").setValue("production-api");
    await wrapper.find("input[type=checkbox]").setValue(true);
    await wrapper.find("dialog form").trigger("submit");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/orders");
    expect(wrapper.text()).toContain("已创建。尚未付款");
    expect(
      JSON.parse(
        requests.find((r) => r.path === "/orders" && r.method === "POST")!
          .options.body as string,
      ).currency,
    ).toBe("CNY");
    const request = requests.find(
      (r) => r.path === "/orders" && r.method === "POST",
    )!;
    expect(
      (request.options.headers as Record<string, string>)["X-CSRF-Token"],
    ).toBe("csrf-test");
    expect(
      (request.options.headers as Record<string, string>)["Idempotency-Key"],
    ).toBeTruthy();
    await router.push("/invoices");
    await flushPromises();
    await wrapper.findAll(".table-action")[0]!.trigger("click");
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "检查支付可用性")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("未发生扣款，账单仍为待付款");
    wrapper.unmount();
  });
});

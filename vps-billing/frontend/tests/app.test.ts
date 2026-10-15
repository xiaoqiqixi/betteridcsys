// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { defaultSiteSettings } from "../src/lib/settings";
import {
  restorePreferences,
  locale,
  currency,
  setLocale,
} from "../src/lib/i18n";
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
function mockNavigationMedia(initial = false) {
  let matches = initial;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    get matches() {
      return matches;
    },
    media: "(max-width: 720px)",
    addEventListener: vi.fn(
      (_: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
    ),
    removeEventListener: vi.fn(
      (_: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
    ),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  return {
    media,
    change(next: boolean) {
      matches = next;
      listeners.forEach((listener) =>
        listener({ matches: next } as MediaQueryListEvent),
      );
    },
  };
}
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
  mockNavigationMedia();
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
          status: 503,
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
  it.each(
    ["services", "orders", "invoices", "customers", "audit"].flatMap((page) =>
      ["zh-CN", "en"].map((language) => ({ page, language })),
    ),
  )(
    "shows loaded and filtered scope for $page in $language without searching the server",
    async ({ page, language }) => {
      activeUser = {
        ...fixtures.previewUser,
        role: page === "customers" ? "admin" : "customer",
      };
      const originalFetch = fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string, options: RequestInit) => {
          if (path.includes("/admin/overview?"))
            return {
              ok: true,
              json: async () => ({
                data: {
                  customers: 12000,
                  total_services: 0,
                  unpaid_invoices: 0,
                  unpaid_total_minor: 0,
                  revenue_minor: 0,
                  currency: "CNY",
                },
              }),
            };
          const data = path.endsWith("/admin/customers")
            ? [
                fixtures.previewUser,
                {
                  ...fixtures.previewUser,
                  id: "other-customer",
                  name: "Other customer",
                },
              ]
            : path.endsWith("/admin/orders")
              ? fixtures.orders
              : path.endsWith("/admin/invoices")
                ? fixtures.invoices
                : undefined;
          return data
            ? { ok: true, json: async () => ({ data }) }
            : originalFetch(path, options);
        }),
      );
      const { wrapper, router } = await mountApp();
      await wrapper.get('select[aria-label="语言"]').setValue(language);
      await flushPromises();
      await router.push("/" + page);
      await flushPromises();
      const loaded =
        page === "customers"
          ? 2
          : page === "services"
            ? fixtures.services.length
            : page === "orders"
              ? fixtures.orders.length
              : page === "invoices"
                ? fixtures.invoices.length
                : fixtures.audit.length;
      const count = wrapper.get('[data-testid="list-count"]');
      expect(count.text()).toBe(
        language === "zh-CN"
          ? `已载入 ${loaded} 条 · 当前显示 ${loaded} 条`
          : `${loaded} loaded · ${loaded} visible`,
      );
      const search = wrapper.get(".list-toolbar input");
      expect(search.attributes("aria-describedby")).toBe("record-list-scope");
      expect(wrapper.get("#record-list-scope").text()).toContain(
        language === "zh-CN"
          ? "搜索仅限已载入内容"
          : "Search covers loaded records only",
      );
      expect(wrapper.find('[data-testid="list-limit-warning"]').exists()).toBe(
        false,
      );
      const requestCount = vi.mocked(fetch).mock.calls.length;
      await search.setValue("no-such-record-scope");
      expect(count.text()).toBe(
        language === "zh-CN"
          ? `已载入 ${loaded} 条 · 当前显示 0 条`
          : `${loaded} loaded · 0 visible`,
      );
      expect(vi.mocked(fetch).mock.calls).toHaveLength(requestCount);
      wrapper.unmount();
    },
  );
  it.each(["zh-CN", "en"])(
    "warns at the loading limit while retaining the filter and authoritative invoice summary in %s",
    async (language) => {
      activeUser = { ...fixtures.previewUser };
      const makeInvoices = (count: number) =>
        Array.from({ length: count }, (_, index) => ({
          ...fixtures.invoices[0]!,
          id: `scope-${index}`,
          number: index === 0 ? "VISIBLE-MARKER" : `OTHER-${index}`,
        }));
      let listedInvoices = makeInvoices(2);
      const originalFetch = fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string, options: RequestInit) => {
          if (path.endsWith("/invoices"))
            return { ok: true, json: async () => ({ data: listedInvoices }) };
          if (path.includes("/overview?"))
            return {
              ok: true,
              json: async () => ({
                data: {
                  active_services: 3,
                  pending_invoices: 7,
                  unpaid_total_minor: 7654321,
                  monthly_total_minor: 0,
                  currency: "CNY",
                  recent_orders: fixtures.orders,
                },
              }),
            };
          return originalFetch(path, options);
        }),
      );
      const { wrapper, router } = await mountApp();
      await wrapper.get('select[aria-label="语言"]').setValue(language);
      await flushPromises();
      await router.push("/invoices");
      await flushPromises();
      const summary = wrapper.get(".invoice-summary").text();
      expect(summary).toContain("76,543.21");
      expect(
        wrapper.get(".invoice-summary > div:nth-child(2) b").text(),
      ).toMatch(/^7/);
      const search = wrapper.get<HTMLInputElement>(".list-toolbar input");
      await search.setValue("VISIBLE-MARKER");
      for (const loaded of [999, 1000]) {
        listedInvoices = makeInvoices(loaded);
        await wrapper
          .get(
            'button[aria-label="' +
              (language === "zh-CN" ? "刷新数据" : "Refresh data") +
              '"]',
          )
          .trigger("click");
        await flushPromises();
        expect(search.element.value).toBe("VISIBLE-MARKER");
        expect(wrapper.get('[data-testid="list-count"]').text()).toBe(
          language === "zh-CN"
            ? `已载入 ${loaded} 条 · 当前显示 1 条`
            : `${loaded} loaded · 1 visible`,
        );
        expect(wrapper.findAll("tbody tr")).toHaveLength(1);
        expect(
          wrapper.find('[data-testid="list-limit-warning"]').exists(),
        ).toBe(loaded >= 1000);
        expect(wrapper.get(".invoice-summary").text()).toBe(summary);
      }
      expect(
        wrapper.get('[data-testid="list-limit-warning"]').text(),
      ).toContain(
        language === "zh-CN"
          ? "可能还有记录未载入"
          : "additional records may not be loaded",
      );
      await search.setValue("no-such-record-scope");
      expect(wrapper.get('[data-testid="list-count"]').text()).toBe(
        language === "zh-CN"
          ? "已载入 1000 条 · 当前显示 0 条"
          : "1000 loaded · 0 visible",
      );
      expect(wrapper.find('[data-testid="list-limit-warning"]').exists()).toBe(
        true,
      );
      expect(wrapper.get(".invoice-summary").text()).toBe(summary);
      wrapper.unmount();
    },
  );
  it("exports only the loaded matching invoices with their recorded currency and safe CSV escaping", async () => {
    activeUser = { ...fixtures.previewUser };
    const originalFetch = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit) =>
        path.endsWith("/invoices")
          ? {
              ok: true,
              json: async () => ({
                data: [
                  {
                    ...fixtures.invoices[0],
                    number: '=HYPERLINK("test")',
                    currency: "KWD",
                    amount_minor: 1234,
                    currency_format: {
                      code: "KWD",
                      name: "Recorded dinar",
                      prefix: "old ",
                      suffix: "",
                      decimal_places: 3,
                    },
                  },
                  { ...fixtures.invoices[1], number: "EXCLUDED-INVOICE" },
                ],
              }),
            }
          : originalFetch(path, options),
      ),
    );
    let exported!: Blob;
    const originalURL = URL;
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends originalURL {
        static createObjectURL(blob: Blob) {
          exported = blob;
          return "blob:scope-test";
        }
        static revokeObjectURL = revoke;
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const { wrapper, router } = await mountApp();
    await router.push("/invoices");
    await flushPromises();
    const search = wrapper.get<HTMLInputElement>(".list-toolbar input");
    await search.setValue("HYPERLINK");
    const button = wrapper.get(
      '.page-heading button[aria-describedby="invoice-export-scope"]',
    );
    expect(button.text()).toBe("导出当前列表");
    expect(wrapper.get("#invoice-export-scope").text()).toContain(
      "仅导出已载入且符合当前搜索条件的账单",
    );
    await button.trigger("click");
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exported);
    });
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv).toContain('"\'HYPERLINK(""test"")"');
    expect(csv).toContain('"KWD"');
    expect(csv).toContain('"1234"');
    expect(csv).toContain("old 1.234");
    expect(csv).not.toContain("EXCLUDED-INVOICE");
    expect(search.element.value).toBe("HYPERLINK");
    expect(click).toHaveBeenCalledOnce();
    expect(click.mock.instances[0]!.download).toBe("invoices.csv");
    expect(revoke).toHaveBeenCalledWith("blob:scope-test");
    await wrapper.get('select[aria-label="语言"]').setValue("en");
    await flushPromises();
    expect(button.text()).toBe("Export current list");
    expect(wrapper.get("#invoice-export-scope").text()).toContain(
      "Exports only loaded invoices matching the current search",
    );
    wrapper.unmount();
    click.mockRestore();
  });
  it("excludes the closed mobile navigation and restores visible focus after close or route selection", async () => {
    activeUser = { ...fixtures.previewUser };
    mockNavigationMedia(true);
    const { wrapper, router } = await mountApp();
    const sidebar = wrapper.get(".sidebar");
    const trigger = wrapper.get<HTMLButtonElement>(".mobile-menu");
    const main = wrapper.get<HTMLElement>("#main");
    expect(sidebar.attributes("inert")).toBeDefined();
    expect(sidebar.attributes("aria-hidden")).toBe("true");
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(trigger.attributes("aria-controls")).toBe(sidebar.attributes("id"));

    trigger.element.focus();
    await trigger.trigger("click");
    expect(sidebar.attributes("inert")).toBeUndefined();
    expect(sidebar.attributes("aria-hidden")).toBeUndefined();
    expect(sidebar.attributes("role")).toBe("dialog");
    expect(sidebar.attributes("aria-modal")).toBe("true");
    expect(wrapper.get(".main-shell").attributes("inert")).toBeDefined();
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(
      sidebar.get('nav a[href="/overview"]').element,
    );

    const close = sidebar.get<HTMLButtonElement>(".sidebar-close");
    const signOut = sidebar.get<HTMLButtonElement>(
      'button[aria-label="退出登录"]',
    );
    close.element.focus();
    await close.trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(signOut.element);
    await signOut.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(close.element);

    await sidebar.trigger("keydown", { key: "Escape" });
    expect(sidebar.attributes("inert")).toBeDefined();
    expect(document.activeElement).toBe(trigger.element);
    await trigger.trigger("click");
    await sidebar.get(".sidebar-close").trigger("click");
    expect(document.activeElement).toBe(trigger.element);
    await trigger.trigger("click");
    await wrapper.get(".sidebar-scrim").trigger("click");
    expect(document.activeElement).toBe(trigger.element);

    await trigger.trigger("click");
    await sidebar.get('nav a[href="/orders"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/orders");
    expect(sidebar.attributes("inert")).toBeDefined();
    expect(document.activeElement).toBe(main.element);
    await trigger.trigger("click");
    await sidebar.get('nav a[href="/orders"]').trigger("click");
    await flushPromises();
    expect(document.activeElement).toBe(main.element);

    const refresh = wrapper.get<HTMLButtonElement>(
      'button[aria-label="刷新数据"]',
    );
    refresh.element.focus();
    await refresh.trigger("click");
    await flushPromises();
    expect(document.activeElement).toBe(refresh.element);
    await trigger.trigger("click");
    await router.push("/services");
    await flushPromises();
    expect(sidebar.attributes("inert")).toBeDefined();
    expect(document.activeElement).toBe(main.element);
    wrapper.unmount();
  });
  it("moves only focus that a breakpoint change would hide and removes its media listener on unmount", async () => {
    activeUser = { ...fixtures.previewUser };
    const media = mockNavigationMedia();
    const { wrapper } = await mountApp();
    expect(vi.mocked(matchMedia)).toHaveBeenCalledWith("(max-width: 720px)");
    const sidebar = wrapper.get(".sidebar");
    const trigger = wrapper.get<HTMLButtonElement>(".mobile-menu");
    const overviewLink = sidebar.get<HTMLAnchorElement>(
      'nav a[href="/overview"]',
    );
    expect(sidebar.attributes("inert")).toBeUndefined();
    expect(sidebar.attributes("role")).toBeUndefined();
    overviewLink.element.focus();
    media.change(true);
    await flushPromises();
    expect(sidebar.attributes("inert")).toBeDefined();
    expect(document.activeElement).toBe(trigger.element);

    media.change(false);
    await flushPromises();
    expect(sidebar.attributes("inert")).toBeUndefined();
    expect(document.activeElement).toBe(overviewLink.element);
    const language = wrapper.get<HTMLSelectElement>(
      'select[aria-label="语言"]',
    );
    language.element.focus();
    media.change(true);
    await flushPromises();
    expect(document.activeElement).toBe(language.element);
    await trigger.trigger("click");
    expect(document.activeElement).toBe(overviewLink.element);
    media.change(false);
    await flushPromises();
    expect(wrapper.find(".sidebar-scrim").exists()).toBe(false);
    expect(wrapper.get(".main-shell").attributes("inert")).toBeUndefined();
    expect(document.activeElement).toBe(overviewLink.element);
    expect(sidebar.attributes("aria-modal")).toBeUndefined();
    wrapper.unmount();
    expect(media.media.removeEventListener).toHaveBeenCalledWith(
      "change",
      media.media.addEventListener.mock.calls[0]![1],
    );
  });
  it.each(["zh-CN", "en"])(
    "labels the customer CTA as plan selection in %s and opens the catalog",
    async (language) => {
      activeUser = { ...fixtures.previewUser };
      const { wrapper, router } = await mountApp();
      await wrapper.get('select[aria-label="语言"]').setValue(language);
      await flushPromises();
      const label = language === "zh-CN" ? "选购套餐" : "Choose a plan";
      expect(wrapper.get(".page-heading .button.primary").text()).toContain(
        label,
      );
      await wrapper.get(".page-heading .button.primary").trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.path).toBe("/plans");
      expect(wrapper.find(".purchase-catalog").exists()).toBe(true);
      expect(requests.some((request) => request.method === "POST")).toBe(false);
      wrapper.unmount();
    },
  );
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
  it.each(["zh-CN", "en"])(
    "keeps cached invoice details visible with localized refresh feedback and stable focus in %s",
    async (language) => {
      activeUser = { ...fixtures.previewUser };
      const { wrapper, router } = await mountApp();
      await wrapper.get('select[aria-label="语言"]').setValue(language);
      await flushPromises();
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
      const document = wrapper.get(".invoice-document");
      const close = wrapper.get<HTMLButtonElement>(
        ".invoice-modal .modal-heading button",
      );
      close.element.focus();
      expect(document.attributes("aria-busy")).toBe("true");
      expect(document.text()).toContain(fixtures.invoices[0]!.number);
      expect(wrapper.get(".invoice-refresh-status").attributes("role")).toBe(
        "status",
      );
      expect(wrapper.get(".invoice-refresh-status").text()).toBe(
        language === "zh-CN"
          ? "正在更新账单详情…"
          : "Updating invoice details…",
      );
      resolveDetail({
        ok: true,
        json: async () => ({
          data: { ...fixtures.invoices[0], number: "UPDATED-INVOICE" },
        }),
      });
      await flushPromises();
      expect(document.attributes("aria-busy")).toBe("false");
      expect(document.text()).toContain("UPDATED-INVOICE");
      expect(wrapper.find(".invoice-refresh-status").exists()).toBe(false);
      expect(window.document.activeElement).toBe(close.element);
      wrapper.unmount();
    },
  );
  it("clears invoice refresh feedback after failure while retaining the cached financial record", async () => {
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
    expect(wrapper.get(".invoice-document").attributes("aria-busy")).toBe(
      "true",
    );
    resolveDetail({
      ok: false,
      json: async () => ({
        error: { code: "UNAVAILABLE", message: "Detail unavailable" },
      }),
    });
    await flushPromises();
    expect(wrapper.get(".invoice-document").attributes("aria-busy")).toBe(
      "false",
    );
    expect(wrapper.get(".invoice-document").text()).toContain(
      fixtures.invoices[0]!.number,
    );
    expect(wrapper.get(".invoice-modal [role=alert]").text()).toContain(
      "Detail unavailable",
    );
    expect(wrapper.find(".invoice-refresh-status").exists()).toBe(false);
    wrapper.unmount();
  });
  it("clears invoice refresh feedback and invalidates pending details when authentication ends", async () => {
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
    expect(wrapper.get(".invoice-document").attributes("aria-busy")).toBe(
      "true",
    );
    const originalFetch = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit) =>
        path.endsWith("/currencies")
          ? {
              ok: false,
              json: async () => ({
                error: { code: "AUTH_REQUIRED", message: "Sign in again" },
              }),
            }
          : originalFetch(path, options),
      ),
    );
    await wrapper.get('button[aria-label="刷新数据"]').trigger("click");
    await flushPromises();
    expect(wrapper.find(".app-shell").exists()).toBe(false);
    expect(wrapper.find(".invoice-refresh-status").exists()).toBe(false);
    expect(wrapper.find(".invoice-document").exists()).toBe(false);
    resolveDetail({
      ok: true,
      json: async () => ({
        data: { ...fixtures.invoices[0], number: "OTHER-SESSION-INVOICE" },
      }),
    });
    await flushPromises();
    expect(wrapper.find(".invoice-document").exists()).toBe(false);
    expect(wrapper.get(".invoice-modal").text()).not.toContain(
      "OTHER-SESSION-INVOICE",
    );
    wrapper.unmount();
  });
  it("ignores old invoice details without clearing a newer selection's refresh feedback", async () => {
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
    expect(wrapper.get(".invoice-document").attributes("aria-busy")).toBe(
      "true",
    );
    await wrapper
      .find('.invoice-modal button[aria-label="关闭"]')
      .trigger("click");
    expect(wrapper.find(".invoice-refresh-status").exists()).toBe(false);
    let resolveNextDetail!: (value: unknown) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNextDetail = resolve as typeof resolveNextDetail;
        }),
    );
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
    expect(wrapper.get(".invoice-document").attributes("aria-busy")).toBe(
      "true",
    );
    expect(wrapper.find(".invoice-refresh-status").exists()).toBe(true);
    resolveNextDetail({
      ok: true,
      json: async () => ({ data: fixtures.invoices[1] }),
    });
    await flushPromises();
    expect(wrapper.get(".invoice-document").attributes("aria-busy")).toBe(
      "false",
    );
    expect(wrapper.find(".invoice-refresh-status").exists()).toBe(false);
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
        .find((b) => b.text() === "获取支付入口")!
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
          "请核对原渠道结果并刷新账单，勿重复支付",
        );
      }
      expect(wrapper.find(".invoice-doc-top .badge").text()).toBe("待付款");
      expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
      wrapper.unmount();
    },
  );

  it.each(["zh-CN", "en"] as const)(
    "does not promise no charge after an existing checkout becomes unavailable in %s",
    async (language) => {
      setLocale(language);
      activeUser = { ...fixtures.previewUser };
      checkoutResponse = {
        provider_id: "test-payment",
        session_id: "existing-unconfirmed-session",
        checkout_url: "https://checkout.example.com/session/existing",
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      };
      const { wrapper, router } = await mountApp();
      await router.push("/invoices");
      await flushPromises();
      await wrapper.findAll(".table-action")[0]!.trigger("click");
      await flushPromises();
      const prepare = () =>
        wrapper
          .findAll("button")
          .find(
            (button) =>
              button.text() ===
              (language === "en" ? "Prepare checkout" : "获取支付入口"),
          )!;
      await prepare().trigger("click");
      await flushPromises();
      expect(wrapper.find(".checkout-handoff a").exists()).toBe(true);

      // The channel can be disabled after accepting the original session. Its
      // current 503 cannot establish what happened to that earlier payment.
      checkoutResponse = undefined;
      await prepare().trigger("click");
      await flushPromises();
      const message = wrapper.find(".invoice-modal [role=alert]").text();
      expect(message).toContain(
        language === "en"
          ? "The payment provider is currently unavailable."
          : "支付渠道当前不可用。",
      );
      expect(message).toContain(
        language === "en"
          ? "Check the original provider and refresh the invoice"
          : "请核对原渠道结果并刷新账单",
      );
      expect(message).toContain(
        language === "en" ? "Avoid duplicate payments." : "勿重复支付。",
      );
      expect(message).not.toMatch(
        /未发生扣款|未完成付款|仍为待付款|状态未改变|No charge was made|No payment was completed|remains unpaid|status is unchanged/i,
      );
      expect(wrapper.find(".checkout-handoff a").exists()).toBe(false);
      expect(
        requests.filter((request) => request.method === "POST"),
      ).toHaveLength(2);
      wrapper.unmount();
    },
  );

  it.each(["zh-CN", "en"] as const)(
    "keeps a real checkout request timeout uncertain without an automatic retry in %s",
    async (language) => {
      setLocale(language);
      activeUser = { ...fixtures.previewUser };
      const originalFetch = globalThis.fetch;
      let timeoutSignal: AbortSignal | undefined;
      let observeAbort!: () => void;
      const aborted = new Promise<void>((resolve) => {
        observeAbort = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn((path: string, options: RequestInit) => {
          const endpoint = path.replace("/api/v1", "");
          if (endpoint.endsWith("/checkout") && options.method === "POST") {
            requests.push({ path: endpoint, method: "POST", options });
            timeoutSignal = options.signal as AbortSignal;
            return new Promise<Response>((_resolve, reject) => {
              timeoutSignal!.addEventListener(
                "abort",
                () => {
                  reject(timeoutSignal!.reason);
                  observeAbort();
                },
                { once: true },
              );
            });
          }
          return originalFetch(path, options);
        }),
      );
      const { wrapper, router } = await mountApp();
      try {
        await router.push("/invoices");
        await flushPromises();
        await wrapper.findAll(".table-action")[0]!.trigger("click");
        await flushPromises();
        const prepare = wrapper
          .findAll("button")
          .find(
            (button) =>
              button.text() ===
              (language === "en" ? "Prepare checkout" : "获取支付入口"),
          )!;
        await prepare.trigger("click");
        await flushPromises();
        expect(timeoutSignal).toBeDefined();
        expect(timeoutSignal!.aborted).toBe(false);
        expect(prepare.attributes("disabled")).toBeDefined();
        await aborted;
        await flushPromises();
        expect(timeoutSignal!.reason.name).toBe("TimeoutError");
        expect(wrapper.find(".checkout-handoff a").exists()).toBe(false);
        const message = wrapper.find(".invoice-modal [role=alert]").text();
        expect(message).toContain(
          language === "en"
            ? "Check the original provider and refresh the invoice"
            : "请核对原渠道结果并刷新账单",
        );
        expect(message).toContain(
          language === "en" ? "Avoid duplicate payments." : "勿重复支付。",
        );
        expect(message).not.toMatch(
          /未发生扣款|未完成付款|稍后重试|No charge was made|No payment was completed|try again/i,
        );
        expect(
          requests.filter((request) => request.method === "POST"),
        ).toHaveLength(1);
      } finally {
        wrapper.unmount();
      }
    },
    25_000,
  );

  it.each(["zh-CN", "en"] as const)(
    "asks to reconcile an expired checkout without promising payment status in %s",
    async (language) => {
      setLocale(language);
      activeUser = { ...fixtures.previewUser };
      const expiry = Date.now() + 60_000;
      checkoutResponse = {
        provider_id: "test-payment",
        session_id: "expiring-session",
        checkout_url: "https://checkout.example.com/session/expired",
        expires_at: new Date(expiry).toISOString(),
      };
      const { wrapper, router } = await mountApp();
      await router.push("/invoices");
      await flushPromises();
      await wrapper.findAll(".table-action")[0]!.trigger("click");
      await flushPromises();
      await wrapper
        .findAll("button")
        .find(
          (button) =>
            button.text() ===
            (language === "en" ? "Prepare checkout" : "获取支付入口"),
        )!
        .trigger("click");
      await flushPromises();
      const now = vi.spyOn(Date, "now").mockReturnValue(expiry + 1);
      try {
        await wrapper.find(".checkout-handoff a").trigger("click");
        await flushPromises();
        expect(wrapper.find(".checkout-handoff a").exists()).toBe(false);
        const message = wrapper.find(".invoice-modal [role=alert]").text();
        expect(message).toContain(
          language === "en"
            ? "Check the original provider and refresh the invoice"
            : "请核对原渠道结果并刷新账单",
        );
        expect(message).not.toMatch(/状态未改变|status is unchanged/i);
        expect(
          requests.filter((request) => request.method === "POST"),
        ).toHaveLength(1);
      } finally {
        now.mockRestore();
        wrapper.unmount();
      }
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
    expect(wrapper.text()).toContain("已创建。付款状态请以最新账单为准。");
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
      .find((b) => b.text() === "获取支付入口")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain(
      "支付渠道当前不可用。请核对原渠道结果并刷新账单，勿重复支付。",
    );
    wrapper.unmount();
  });
});

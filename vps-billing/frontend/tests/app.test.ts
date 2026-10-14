// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import App from "../src/App.vue";
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
      requests.push({
        path: endpoint,
        method: options.method || "GET",
        options,
      });
      let data: unknown;
      if (endpoint === "/session")
        data = { user: activeUser, csrf_token: "csrf-test", demo_mode: true };
      else if (endpoint === "/auth/login") {
        activeUser = { ...fixtures.previewUser };
        data = { user: activeUser };
      } else if (endpoint === "/auth/logout") {
        activeUser = null;
        data = { ok: true };
      } else if (endpoint === "/overview")
        data = {
          active_services: 3,
          pending_invoices: 1,
          monthly_total_minor: 4200,
          currency: "USD",
          recent_orders: fixtures.orders,
        };
      else if (endpoint === "/services") data = fixtures.services;
      else if (endpoint === "/plans") data = fixtures.plans;
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
    await wrapper
      .findAll("button")
      .find((b) => b.text().includes("选择此方案"))!
      .trigger("click");
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
    await wrapper
      .findAll("button")
      .find((b) => b.text().includes("选择此方案"))!
      .trigger("click");
    await flushPromises();
    await wrapper.find("#hostname").setValue("production-api");
    await wrapper.find("input[type=checkbox]").setValue(true);
    await wrapper.find("dialog form").trigger("submit");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/orders");
    expect(wrapper.text()).toContain("已创建。尚未付款");
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

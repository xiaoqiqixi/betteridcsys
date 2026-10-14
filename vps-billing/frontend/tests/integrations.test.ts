// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import IntegrationsPage from "../src/components/IntegrationsPage.vue";
import App from "../src/App.vue";
import {
  previewIntegrations,
  readIntegrationManifest,
  type IntegrationSummary,
} from "../src/lib/integrations";
import * as fixtures from "../src/lib/preview";

const manifest = (): IntegrationSummary[] =>
  structuredClone(previewIntegrations);
const reply = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("read-only integrations registry", () => {
  it("fetches the actual registry and shows disabled adapters without install or enable controls", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ items: manifest() }));
    vi.stubGlobal("fetch", fetcher);
    const wrapper = mount(IntegrationsPage, {
      props: { preview: false, refreshToken: 0 },
    });
    await flushPromises();
    expect(fetcher.mock.calls[0]![0]).toBe("/api/v1/admin/integrations");
    expect(fetcher.mock.calls[0]![1].method).toBe("GET");
    expect(wrapper.findAll(".integration-card")).toHaveLength(2);
    expect(
      wrapper.findAll(".integration-card .badge").map((b) => b.text()),
    ).toEqual(["未启用", "未启用"]);
    expect(wrapper.text()).toContain("尚未提供可用接口或插件");
    expect(wrapper.findAll("input")).toHaveLength(0);
    expect(
      wrapper.findAll("button").some((b) => /^(安装|启用|保存)/.test(b.text())),
    ).toBe(false);
    wrapper.unmount();
  });
  it("renders only schema metadata, never returned configuration values or diagnostics", async () => {
    const item = {
      ...manifest()[0]!,
      configuration_fields: [
        {
          key: "PAYMENT_KEY_REF",
          label: "密钥",
          type: "secret_ref",
          required: true,
          secret: true,
          value: "do-not-render-secret",
        },
      ],
      config: { token: "do-not-render-secret" },
      secret: "do-not-render-secret",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ items: [item] })));
    const wrapper = mount(IntegrationsPage, {
      props: { preview: false, refreshToken: 0 },
    });
    await flushPromises();
    await wrapper.find(".integration-card button").trigger("click");
    expect(wrapper.find("dialog").attributes("open")).toBeDefined();
    expect(wrapper.text()).toContain("PAYMENT_KEY_REF");
    expect(wrapper.text()).toContain("通过服务端密钥管理注入");
    expect(wrapper.html()).not.toContain("do-not-render-secret");
    await wrapper.find('[aria-label="关闭扩展详情"]').trigger("click");
    expect(wrapper.find("dialog").attributes("open")).toBeUndefined();
    await wrapper.find(".integration-card button").trigger("click");
    expect(wrapper.find("dialog").attributes("open")).toBeDefined();
    expect(wrapper.text()).toContain("PAYMENT_KEY_REF");
    wrapper.unmount();
  });
  it("fails closed, hides stale cards on refresh, and permits a successful read retry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply({ items: manifest() }))
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: { code: "SERVER_ERROR", message: "sensitive-diagnostic" },
        }),
      })
      .mockResolvedValueOnce(reply({ items: manifest() }));
    vi.stubGlobal("fetch", fetcher);
    const wrapper = mount(IntegrationsPage, {
      props: { preview: false, refreshToken: 0 },
    });
    await flushPromises();
    await wrapper.find(".integration-card button").trigger("click");
    await wrapper.setProps({ refreshToken: 1 });
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain("无法读取扩展清单");
    expect(wrapper.html()).not.toContain("sensitive-diagnostic");
    expect(wrapper.findAll(".integration-card")).toHaveLength(0);
    expect(wrapper.find("dialog").attributes("open")).toBeUndefined();
    await wrapper.find('[role="alert"] button').trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".integration-card")).toHaveLength(2);
    expect(fetcher.mock.calls.every((call) => call[1].method === "GET")).toBe(
      true,
    );
    wrapper.unmount();
  });
  it("rejects malformed or undocumented manifests", () => {
    for (const data of [
      {},
      { items: null },
      { items: [{ ...manifest()[0], status: "connected" }] },
      {
        items: [
          {
            ...manifest()[0],
            configuration_fields: [{ key: "TOKEN", value: "secret" }],
          },
        ],
      },
    ]) {
      expect(() => readIntegrationManifest(data)).toThrow();
    }
  });
  it("keeps preview fixtures visibly mock and performs no request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const wrapper = mount(IntegrationsPage, {
      props: { preview: true, refreshToken: 0 },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("样例清单 · 未连接任何外部服务");
    expect(fetcher).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("does not overwrite a newer registry fetch with an older response", async () => {
    let finish: (value: unknown) => void = () => {};
    const oldResponse = new Promise((resolve) => {
      finish = resolve;
    });
    const newer = manifest();
    newer[0]!.name = "New registry";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(oldResponse)
        .mockResolvedValueOnce(reply({ items: newer })),
    );
    const wrapper = mount(IntegrationsPage, {
      props: { preview: false, refreshToken: 0 },
    });
    await wrapper.setProps({ refreshToken: 1 });
    await flushPromises();
    finish(reply({ items: manifest() }));
    await flushPromises();
    expect(wrapper.text()).toContain("New registry");
    wrapper.unmount();
  });
});

describe("admin-only integrations route", () => {
  async function openApp(role: "admin" | "customer") {
    const fetcher = vi.fn(async (path: string) => {
      const data: Record<string, unknown> = {
        "/session": {
          user: { ...fixtures.previewUser, role },
          csrf_token: "test",
          demo_mode: false,
        },
        "/admin/overview": {
          customers: 1,
          total_services: 0,
          unpaid_invoices: 0,
          revenue_minor: 0,
          currency: "USD",
        },
        "/admin/customers": [],
        "/admin/orders": [],
        "/admin/invoices": [],
        "/admin/audit": [],
        "/admin/integrations": { items: manifest() },
        "/overview": {
          active_services: 0,
          pending_invoices: 0,
          monthly_total_minor: 0,
          currency: "USD",
          recent_orders: [],
        },
        "/services": [],
        "/plans": [],
        "/orders": [],
        "/invoices": [],
        "/audit": [],
      };
      return reply(data[path.replace("/api/v1", "")]);
    });
    vi.stubGlobal("fetch", fetcher);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/:pathMatch(.*)*", component: { template: "<div />" } },
      ],
    });
    await router.push("/integrations");
    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    return { wrapper, router, fetcher };
  }
  it("loads the admin manifest on direct navigation and closes details when navigating away", async () => {
    const { wrapper, router, fetcher } = await openApp("admin");
    expect(document.title).toBe("扩展中心 · 星屿云");
    expect(wrapper.find('nav a[href="/integrations"]').exists()).toBe(true);
    expect(wrapper.findAll(".integration-card")).toHaveLength(2);
    expect(
      fetcher.mock.calls.some((c) => c[0].endsWith("/admin/integrations")),
    ).toBe(true);
    await wrapper.find(".integration-card button").trigger("click");
    await router.push("/overview");
    await flushPromises();
    expect(wrapper.find(".integration-drawer").exists()).toBe(false);
    expect(document.title).toBe("运营总览 · 星屿云");
    await router.back();
    await flushPromises();
    expect(
      wrapper.find(".integration-drawer").attributes("open"),
    ).toBeUndefined();
    wrapper.unmount();
  });
  it("does not show the nav or fetch admin integrations for customers", async () => {
    const { wrapper, fetcher } = await openApp("customer");
    expect(document.title).toBe("页面未找到 · 星屿云");
    expect(wrapper.find('nav a[href="/integrations"]').exists()).toBe(false);
    expect(wrapper.find(".integrations-page").exists()).toBe(false);
    expect(wrapper.text()).toContain("这个页面还不存在");
    expect(fetcher.mock.calls.some((c) => c[0].includes("/admin/"))).toBe(
      false,
    );
    wrapper.unmount();
  });
});

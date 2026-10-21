// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, type Ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import GeminiHome from "../src/components/GeminiHome.vue";
import HomePage from "../src/pages/HomePage.vue";
import type { Overview, Session } from "../src/types/idc";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  generation: null as unknown as Ref<number>,
  session: null as unknown as Ref<Session>,
}));
vi.mock("../src/composables/useWorkspace", async () => {
  const { ref } = await import("vue");
  mocks.generation = ref(0);
  mocks.session = ref({
    user: {
      id: "synthetic-account",
      name: "合成用户",
      email: "user@example.invalid",
      role: "customer",
    },
    csrf_token: "synthetic",
    demo_mode: true,
  });
  return { useWorkspace: () => ({ ...mocks }) };
});
const cny = {
  code: "CNY",
  name: "人民币",
  prefix: "¥",
  suffix: "",
  decimal_places: 2,
};
const kwd = {
  code: "KWD",
  name: "Kuwaiti Dinar",
  prefix: "",
  suffix: " د.ك",
  decimal_places: 3,
};
const summary = (): Overview => ({
  active_services: 0,
  pending_invoices: 1,
  unpaid_total_minor: 3900,
  monthly_total_minor: 0,
  currency: "CNY",
  currency_format: { ...cny },
  recent_orders: [],
  count_scope: "currency",
  recent_orders_scope: "all",
});
const homeProps = () => ({
  locale: "zh-CN",
  currency: "CNY",
  user: { name: "合成用户" },
  loading: false,
  error: "",
  overview: summary(),
  services: [],
});
let wrappers: VueWrapper[] = [];
function screen(props: Record<string, unknown> = {}) {
  const wrapper = mount(GeminiHome, { props: { ...homeProps(), ...props } });
  wrappers.push(wrapper);
  return wrapper;
}
function adapter() {
  const wrapper = mount(HomePage, {
    props: { locale: "zh-CN", currency: "CNY", mode: "demo", role: "customer" },
  });
  wrappers.push(wrapper);
  return wrapper;
}
beforeEach(() => {
  mocks.read.mockReset();
  mocks.generation.value = 0;
  mocks.session.value = {
    user: {
      id: "synthetic-account",
      name: "合成用户",
      email: "user@example.invalid",
      role: "customer",
    },
    csrf_token: "synthetic",
    demo_mode: true,
  };
  mocks.read.mockImplementation(async (path: string) =>
    path === "/overview" ? summary() : [],
  );
});
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers = [];
});

describe("received Gemini home and minimal contract fixes", () => {
  it("preserves exact maximum-safe-integer grouping with the record snapshot", () => {
    const overview = {
      ...summary(),
      currency: "KWD",
      currency_format: kwd,
      unpaid_total_minor: Number.MAX_SAFE_INTEGER,
      monthly_total_minor: Number.MAX_SAFE_INTEGER,
    };
    const wrapper = screen({ overview, currency: "USD" });
    expect(wrapper.text()).toContain("9,007,199,254,740.991");
    expect(wrapper.text()).toContain("KWD");
    expect(wrapper.text()).not.toContain("9,007,199,254,740.992");
  });
  it("never truncates floats or invents absent/invalid snapshot precision", () => {
    for (const changes of [
      { monthly_total_minor: 39.9 },
      { monthly_total_minor: Number.MAX_SAFE_INTEGER + 1 },
      { currency_format: undefined },
      { currency_format: { ...cny, decimal_places: 7 } },
      { currency_format: { ...cny, decimal_places: 1.5 } },
      { currency_format: { ...cny, code: "USD" } },
    ]) {
      const wrapper = screen({ overview: { ...summary(), ...changes } });
      expect(wrapper.findAll(".gh-summary-value")[1]!.text()).toBe("—");
    }
  });
  it("initial read failure is not a successful empty workspace; cached data retains its warning", () => {
    const failed = screen({
      overview: null,
      services: [],
      error: "Synthetic read failure",
    });
    expect(failed.find('[role="alert"]').exists()).toBe(true);
    expect(failed.find(".gh-empty").exists()).toBe(false);
    expect(failed.find(".gh-workspace").exists()).toBe(false);
    const cached = screen({ error: "Synthetic refresh failure" });
    expect(cached.find('[role="alert"]').exists()).toBe(true);
    expect(cached.find(".gh-workspace").exists()).toBe(true);
  });
  it("does not promise unsupported downloads/provisioning and safely forwards encoded order IDs", async () => {
    const overview = {
      ...summary(),
      recent_orders: [
        {
          id: "synthetic/id",
          number: "SYNTHETIC",
          plan_name: "Synthetic",
          status: "review_needed",
          currency: "CNY",
          hostname: "test-host",
          total_minor: 3900,
          currency_format: cny,
          created_at: "2026-10-21T00:00:00Z",
        },
      ],
    };
    const wrapper = screen({ locale: "en", overview });
    expect(wrapper.text()).toContain("review_needed");
    expect(wrapper.text()).not.toMatch(
      /download billing|running and provisioning|deploy a virtual server|service interruption/i,
    );
    await wrapper.find(".gh-row-btn-compact").trigger("click");
    expect(wrapper.emitted("navigate")?.[0]).toEqual([
      "/orders/synthetic%2Fid",
    ]);
  });
  it("wrapper reads only customer-scoped overview/services and forwards retry/navigation", async () => {
    const wrapper = adapter();
    await flushPromises();
    expect(mocks.read.mock.calls).toEqual([
      ["/overview", { currency: "CNY" }],
      ["/services"],
    ]);
    const component = wrapper.findComponent(GeminiHome);
    expect(component.props("user")).toEqual(mocks.session.value.user);
    component.vm.$emit("navigate", "/catalog");
    expect(wrapper.emitted("navigate")?.[0]).toEqual(["/catalog"]);
    component.vm.$emit("retry");
    await flushPromises();
    expect(mocks.read).toHaveBeenCalledTimes(4);
    expect(
      mocks.read.mock.calls.some(
        ([path]) => path === "/invoices" || String(path).startsWith("/admin/"),
      ),
    ).toBe(false);
  });
  it("older currency responses cannot overwrite the latest selected scope", async () => {
    let resolveOld!: (value: Overview) => void;
    mocks.read.mockImplementation(
      (path: string, query?: { currency?: string }) =>
        path === "/services"
          ? Promise.resolve([])
          : query?.currency === "CNY"
            ? new Promise<Overview>((resolve) => {
                resolveOld = resolve;
              })
            : Promise.resolve({
                ...summary(),
                currency: "USD",
                currency_format: { ...cny, code: "USD", prefix: "$" },
              }),
    );
    const wrapper = adapter();
    await nextTick();
    await wrapper.setProps({ currency: "USD" });
    await flushPromises();
    expect(wrapper.findComponent(GeminiHome).props("overview")?.currency).toBe(
      "USD",
    );
    resolveOld(summary());
    await flushPromises();
    expect(wrapper.findComponent(GeminiHome).props("overview")?.currency).toBe(
      "USD",
    );
  });
  it("identity change clears old data immediately and does not leak it after a failed new read", async () => {
    const wrapper = adapter();
    await flushPromises();
    expect(wrapper.findComponent(GeminiHome).props("overview")).not.toBeNull();
    mocks.read.mockRejectedValue(new Error("/internal/private-path"));
    mocks.session.value = {
      ...mocks.session.value,
      user: {
        ...mocks.session.value.user!,
        id: "different-synthetic-account",
        name: "新合成用户",
      },
    };
    mocks.generation.value++;
    await flushPromises();
    const component = wrapper.findComponent(GeminiHome);
    expect(component.props("overview")).toBeNull();
    expect(component.props("services")).toEqual([]);
    expect(component.props("error")).toContain("首页暂时无法加载");
    expect(wrapper.text()).not.toContain("/internal/private-path");
  });
  it("unmount invalidates the pending read instead of applying stale data", async () => {
    let resolveRead!: (value: Overview) => void;
    mocks.read.mockImplementation((path: string) =>
      path === "/services"
        ? Promise.resolve([])
        : new Promise<Overview>((resolve) => {
            resolveRead = resolve;
          }),
    );
    const wrapper = adapter();
    await nextTick();
    wrapper.unmount();
    wrappers = wrappers.filter((item) => item !== wrapper);
    resolveRead(summary());
    await flushPromises();
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted("navigate")).toBeUndefined();
  });
});

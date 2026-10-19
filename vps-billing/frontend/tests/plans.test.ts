// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import PlansPage from "../src/components/PlansPage.vue";
import { previewPlans } from "../src/lib/preview";
import { restorePreferences, setLocale } from "../src/lib/i18n";

function setup(overrides = {}) {
  return mount(PlansPage, {
    props: {
      plans: previewPlans("CNY"),
      currency: "CNY",
      loading: false,
      saving: false,
      preview: false,
      demo: false,
      ...overrides,
    },
  });
}
beforeEach(() => {
  localStorage.clear();
  restorePreferences();
});

describe("plan selection and order summary", () => {
  it.each([false, true])(
    "releases checkout sizing and restores the prior root style (existing: %s)",
    (existing) => {
      const property = "--aster-checkout-height";
      const root = document.documentElement;
      const original = root.style.getPropertyValue(property);
      const originalPriority = root.style.getPropertyPriority(property);
      let notify = () => {};
      const disconnect = vi.fn();
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(callback: ResizeObserverCallback) {
            notify = () => callback([], this as unknown as ResizeObserver);
          }
          observe() {}
          disconnect = disconnect;
        },
      );
      if (existing) root.style.setProperty(property, "203px", "important");
      else root.style.removeProperty(property);
      const wrapper = setup();
      let unmounted = false;
      try {
        vi.spyOn(
          wrapper.get(".purchase-checkout").element,
          "getBoundingClientRect",
        ).mockReturnValue({ height: 181.4 } as DOMRect);
        notify();
        expect(root.style.getPropertyValue(property)).toBe("182px");
        wrapper.unmount();
        unmounted = true;
        expect(disconnect).toHaveBeenCalledOnce();
        expect(root.style.getPropertyValue(property)).toBe(
          existing ? "203px" : "",
        );
        expect(root.style.getPropertyPriority(property)).toBe(
          existing ? "important" : "",
        );
        // A queued observer callback must not overwrite a later page's style.
        notify();
        expect(root.style.getPropertyValue(property)).toBe(
          existing ? "203px" : "",
        );
      } finally {
        if (!unmounted) wrapper.unmount();
        if (original)
          root.style.setProperty(property, original, originalPriority);
        else root.style.removeProperty(property);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
      }
    },
  );

  it("filters real regions, updates the summary and only reviews on explicit confirmation", async () => {
    const wrapper = setup();
    const plans = previewPlans("CNY");
    expect(wrapper.findAll(".region-options button")).toHaveLength(3);
    expect(wrapper.findAll(".catalog-plan")).toHaveLength(3);
    expect(wrapper.find(".purchase-boundary").text()).toContain(
      "创建订单本身不发起扣款，也不会自动开通服务。",
    );
    expect(wrapper.find(".purchase-boundary").text()).not.toContain("尚未接入");
    await wrapper.findAll(".plan-select")[1]!.trigger("click");
    expect(wrapper.find(".purchase-summary").text()).toContain(plans[1]!.name);
    expect(wrapper.find(".purchase-total").text()).toContain("CNY 79.00");
    expect(wrapper.emitted("review")).toBeUndefined();
    await wrapper.findAll(".region-options button")[2]!.trigger("click");
    expect(wrapper.findAll(".catalog-plan")).toHaveLength(1);
    expect(wrapper.find(".purchase-summary").text()).toContain(
      plans[2]!.region,
    );
    expect(wrapper.find(".purchase-summary").text()).toContain("4 vCPU");
    await wrapper.find(".purchase-review").trigger("click");
    expect(wrapper.emitted("review")).toEqual([[plans[2]]]);
    wrapper.unmount();
  });

  it("preserves the selected plan across currency reloads and hides stale money while loading", async () => {
    const wrapper = setup();
    await wrapper.findAll(".plan-select")[1]!.trigger("click");
    await wrapper.setProps({ currency: "USD", plans: [], loading: true });
    expect(wrapper.find(".purchase-total").exists()).toBe(false);
    expect(
      wrapper.find(".purchase-review").attributes("disabled"),
    ).toBeDefined();
    await wrapper.setProps({ plans: previewPlans("USD"), loading: false });
    expect(wrapper.find(".purchase-total").text()).toContain("USD 12.00");
    expect(wrapper.findAll(".plan-select")[1]!.attributes("aria-pressed")).toBe(
      "true",
    );
    await wrapper.find(".purchase-review").trigger("click");
    expect(wrapper.emitted("review")![0]![0]).toMatchObject({
      id: "p2",
      currency: "USD",
      price_minor: 1200,
    });
    wrapper.unmount();
  });

  it("does not offer checkout when the server omits authoritative quote metadata", () => {
    const plan = previewPlans("CNY")[0]!;
    const wrapper = setup({
      plans: [
        { ...plan, currency_format: undefined },
        { ...plan, id: "no-revision", price_revision: undefined },
      ],
    });
    expect(
      wrapper
        .findAll(".plan-select")
        .every((button) => button.attributes("disabled") !== undefined),
    ).toBe(true);
    expect(
      wrapper.find(".purchase-review").attributes("disabled"),
    ).toBeDefined();
    wrapper.unmount();
  });
  it("keeps missing prices and wrong-currency plans unavailable without presenting them as free", async () => {
    const plans = previewPlans("CNY");
    const wrapper = setup({
      plans: [
        { ...plans[0], available: false, price_minor: 0 },
        { ...plans[1], currency: "USD" },
      ],
    });
    expect(
      wrapper
        .findAll(".plan-select")
        .every((button) => button.attributes("disabled") !== undefined),
    ).toBe(true);
    expect(
      wrapper.find(".purchase-review").attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.find(".purchase-total").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("0.00");
    expect(wrapper.text()).not.toContain("USD");
    wrapper.unmount();
  });

  it("preserves the original uncertain order even when the catalog currency or availability changes", async () => {
    const original = previewPlans("CNY")[0]!;
    const wrapper = setup({
      plans: previewPlans("USD"),
      currency: "USD",
      pendingPlan: original,
    });
    expect(wrapper.find(".purchase-total").text()).toContain("CNY 39.00");
    expect(wrapper.find(".purchase-pending").text()).toContain(
      "保留原配置与币种",
    );
    expect(
      wrapper
        .findAll(".plan-select")
        .every((button) => button.attributes("disabled") !== undefined),
    ).toBe(true);
    await wrapper.setProps({ plans: [] });
    await wrapper.find(".purchase-review").trigger("click");
    expect(wrapper.emitted("review")).toEqual([[original]]);
    wrapper.unmount();
  });

  it("reconciles removed regions or unavailable selections against refreshed API data", async () => {
    const plans = previewPlans("CNY");
    const wrapper = setup();
    await wrapper.findAll(".region-options button")[2]!.trigger("click");
    await wrapper.setProps({
      plans: [{ ...plans[0]!, available: false }, plans[1]!],
    });
    expect(
      wrapper.find(".region-options button").attributes("aria-pressed"),
    ).toBe("true");
    expect(wrapper.find(".purchase-summary").text()).toContain(plans[1]!.name);
    await wrapper.setProps({ plans: [] });
    expect(wrapper.find(".purchase-total").exists()).toBe(false);
    expect(
      wrapper.find(".purchase-review").attributes("disabled"),
    ).toBeDefined();
    wrapper.unmount();
  });

  it("translates controls while keeping operator content literal and escaped", async () => {
    const wrapper = setup({
      plans: [
        {
          ...previewPlans("CNY")[0],
          name: "<b>Operator</b>",
          description: "原始产品说明",
          region: "Private region",
        },
      ],
    });
    setLocale("en");
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Choose a region");
    expect(wrapper.text()).toContain("Order summary");
    expect(wrapper.find(".purchase-boundary").text()).toContain(
      "Creating an order does not itself initiate a charge or automatically activate a service.",
    );
    expect(wrapper.find(".purchase-boundary").text()).not.toContain(
      "not connected",
    );
    expect(wrapper.text()).toContain("<b>Operator</b>");
    expect(wrapper.text()).toContain("原始产品说明");
    expect(wrapper.find(".catalog-plan h3 b").exists()).toBe(false);
    expect(wrapper.find(".purchase-total").text()).toContain("CNY 39.00");
    wrapper.unmount();
  });

  it("allows read-only preview details and blocks review while saving", async () => {
    const wrapper = setup({ preview: true, demo: true });
    expect(wrapper.find(".purchase-review").text()).toBe("预览订单配置");
    expect(wrapper.find(".purchase-boundary").text()).toContain("不能创建订单");
    await wrapper.find(".purchase-review").trigger("click");
    expect(wrapper.emitted("review")).toHaveLength(1);
    await wrapper.setProps({ saving: true });
    await wrapper.find(".purchase-review").trigger("click");
    expect(wrapper.emitted("review")).toHaveLength(1);
    wrapper.unmount();
  });
});

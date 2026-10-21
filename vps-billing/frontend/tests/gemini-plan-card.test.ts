// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GeminiPlanCard from "../src/components/GeminiPlanCard.vue";
const plan = {
  id: "synthetic-plan",
  name: "Synthetic Plan",
  description: "No actual infrastructure",
  region: "HKG",
  cpu: 2,
  memory_gb: 4,
  disk_gb: 40,
  transfer_tb: 1,
  available: true,
  price_minor: 3900,
  price_revision: 7,
  currency: "CNY",
  currency_format: {
    code: "CNY",
    name: "人民币",
    prefix: "¥",
    suffix: "",
    decimal_places: 2,
  },
};
const card = (
  overrides: Record<string, unknown> = {},
  props: Record<string, unknown> = {},
) =>
  mount(GeminiPlanCard, {
    props: {
      plan: { ...plan, ...overrides } as typeof plan,
      locale: "zh-CN",
      ...props,
    },
  });

describe("Gemini-authored visual plan card hard constraints", () => {
  it("formats ordinary and very long safe integer prices exactly from snapshot precision", () => {
    expect(card().find(".gpc-price-amount").text()).toBe("¥39.00");
    expect(
      card({ price_minor: Number.MAX_SAFE_INTEGER })
        .find(".gpc-price-amount")
        .text(),
    ).toBe("¥90,071,992,547,409.91");
  });
  it("keeps the exact server-owned prefix and suffix without inserting spaces or converting currencies", () => {
    const wrapper = card({
      currency: "USD",
      currency_format: {
        ...plan.currency_format,
        code: "USD",
        prefix: "US$",
        suffix: "美元",
      },
    });
    expect(wrapper.get(".gpc-price-amount").text()).toBe("US$39.00美元");
    expect(wrapper.get(".gpc-currency-tag").text()).toBe("USD");
  });
  it.each([0, 1, 3, 6])(
    "uses a %i-decimal snapshot without rounding or fixed /100",
    (decimal_places) => {
      const wrapper = card({
        price_minor: 1234567,
        currency_format: { ...plan.currency_format, decimal_places },
      });
      const expected = [
        "¥1,234,567",
        "¥123,456.7",
        "",
        "¥1,234.567",
        "",
        "",
        "¥1.234567",
      ][decimal_places];
      expect(wrapper.find(".gpc-price-amount").text()).toBe(expected);
    },
  );
  it.each([
    { available: false, price_minor: 0 },
    { price_minor: 0 },
    { price_minor: -1 },
    { price_minor: 1.5 },
    { price_minor: Number.MAX_SAFE_INTEGER + 1 },
    { price_revision: 0 },
    { currency_format: undefined },
    { currency_format: { ...plan.currency_format, code: "USD" } },
    { currency_format: { ...plan.currency_format, decimal_places: 7 } },
    { currency_format: { ...plan.currency_format, prefix: undefined } },
  ])(
    "blocks unavailable, unsafe or unverifiable quote: %j",
    async (overrides) => {
      const wrapper = card(overrides);
      expect(
        wrapper.find(".gpc-btn-choose").attributes("disabled"),
      ).toBeDefined();
      expect(wrapper.find(".gpc-price-amount").exists()).toBe(false);
      await wrapper.find(".gpc-btn-choose").trigger("click");
      expect(wrapper.emitted("choose")).toBeUndefined();
      expect(wrapper.text()).not.toContain("免费");
    },
  );
  it("offers only a purchase action with no comparison checkbox or extra action", () => {
    const wrapper = card();
    expect(wrapper.findAll("button")).toHaveLength(1);
    expect(wrapper.find(".gpc-btn-choose").text()).toBe("选择此套餐");
    expect(wrapper.find(".gpc-btn-compare").exists()).toBe(false);
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("对比");
  });
  it("retains a valid visible quote but blocks choose for parent unresolved/stale states", async () => {
    const wrapper = card({}, { chooseDisabled: true, locale: "en" });
    expect(wrapper.find(".gpc-price-amount").text()).toBe("¥39.00");
    expect(
      wrapper.find(".gpc-btn-choose").attributes("disabled"),
    ).toBeDefined();
    await wrapper.find(".gpc-btn-choose").trigger("click");
    expect(wrapper.emitted("choose")).toBeUndefined();
    expect(wrapper.text()).toContain("Monthly Transfer");
  });
  it("marks the selected plan with one clear selection action", () => {
    const wrapper = card({}, { selected: true });
    expect(wrapper.classes()).toContain("is-selected");
    expect(wrapper.get(".gpc-btn-choose").attributes("aria-pressed")).toBe(
      "true",
    );
    expect(wrapper.get(".gpc-btn-choose").text()).toBe("已选择");
    expect(wrapper.text()).not.toContain("算力");
  });
  it("emits choose only, never performs API writes or changes order state", async () => {
    const wrapper = card();
    await wrapper.find(".gpc-btn-choose").trigger("click");
    expect(wrapper.emitted("choose")).toEqual([[]]);
    expect(wrapper.emitted("compare")).toBeUndefined();
  });
});

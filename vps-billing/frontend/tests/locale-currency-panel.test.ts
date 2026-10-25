// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import LocaleCurrencyPanel from "../src/components/LocaleCurrencyPanel.vue";

const wrappers: VueWrapper[] = [];
const overlay = defineComponent({
  props: ["open", "title", "closeLabel"],
  template:
    '<section v-if="open"><h2>{{title}}</h2><button :aria-label="closeLabel"/><slot/></section>',
});
function render(locale: string, currency: string, reporting: boolean) {
  const wrapper = mount(LocaleCurrencyPanel, {
    props: {
      open: true,
      locale,
      currency,
      reporting,
      anchor: null,
      currencies: [
        { code: "CNY", name: "人民币", enabled: true },
        { code: "USD", name: "美元", enabled: true },
      ],
    },
    global: { stubs: { OverlayPanel: overlay } },
  });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers.length = 0;
});

describe("language and currency scope copy", () => {
  it.each(["zh-CN", "en"])(
    "%s: report scope never promises to change new-order pricing, including CNY",
    async (locale) => {
      const wrapper = render(locale, "USD", true);
      const expected =
        locale === "en"
          ? "Shows reports in the selected currency without converting amounts or changing your purchase currency."
          : "仅查看所选币种的报表，不换算金额，也不改变购买币种。";
      expect(wrapper.get(".currency-scope").text()).toBe(expected);
      expect(wrapper.text()).not.toMatch(/新订单|new-order/);
      await wrapper.setProps({ currency: "CNY" });
      expect(wrapper.get(".currency-scope").text()).toBe(expected);
      expect(wrapper.emitted("update:currency")).toBeUndefined();
      expect(wrapper.emitted("update:locale")).toBeUndefined();
    },
  );
  it.each(["zh-CN", "en"])(
    "%s: customer scope keeps the historical-invoice boundary and updates when reporting changes",
    async (locale) => {
      const wrapper = render(locale, "USD", false);
      const expected =
        locale === "en"
          ? "Changes new-order prices only. Existing invoices keep their currency."
          : "仅影响新订单的报价，历史账单保留原币种。";
      expect(wrapper.get(".currency-scope").text()).toBe(expected);
      await wrapper.setProps({ reporting: true });
      expect(wrapper.get(".currency-scope").text()).not.toBe(expected);
      await wrapper.setProps({ reporting: false, currency: "CNY" });
      expect(wrapper.find(".currency-scope").exists()).toBe(false);
    },
  );
  it("updates the close name with the selected display language", async () => {
    const wrapper = render("zh-CN", "CNY", false);
    expect(wrapper.get('button[aria-label="关闭"]').exists()).toBe(true);
    await wrapper.setProps({ locale: "en" });
    expect(wrapper.get('button[aria-label="Close"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("人民币");
  });
});

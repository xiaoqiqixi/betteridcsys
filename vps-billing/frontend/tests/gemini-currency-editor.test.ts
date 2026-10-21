// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import GeminiCurrencyEditor from "../src/components/GeminiCurrencyEditor.vue";

const usage = () => ({
  plan_prices: 0,
  orders: 0,
  invoices: 0,
  services: 0,
  pending_orders: 0,
  unpaid_invoices: 0,
  ongoing_services: 0,
});
const registry = () => ({
  revision: 4,
  default_currency: "CNY",
  currencies: [
    {
      code: "CNY",
      name: "人民币",
      prefix: "¥",
      suffix: "",
      decimal_places: 2,
      enabled: true,
      sort_order: 0,
      precision_locked: true,
      usage: usage(),
    },
    {
      code: "USD",
      name: "US Dollar",
      prefix: "$",
      suffix: "",
      decimal_places: 2,
      enabled: true,
      sort_order: 10,
      precision_locked: false,
      usage: usage(),
    },
  ],
});
let wrappers: VueWrapper[] = [];
function screen(value: any = registry()) {
  const wrapper = mount(GeminiCurrencyEditor, {
    props: {
      registry: value,
      locale: "zh-CN",
      busy: false,
      uncertain: false,
      error: "",
      notice: "",
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}
const button = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll("button").find((node) => node.text() === text)!;
const card = (wrapper: VueWrapper, index = 1) =>
  wrapper.findAll(".gce-card")[index]!;
const nameInput = (wrapper: VueWrapper) =>
  card(wrapper).find('input[id^="name-"]');
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers = [];
});

describe("received Gemini currency editor: metadata and immutable snapshot guards", () => {
  it("keeps exact full-write fields and emits dirty state without leaking read-only metadata", async () => {
    const wrapper = screen();
    await nameInput(wrapper).setValue("美元");
    expect(wrapper.emitted("dirty")?.at(-1)).toEqual([true]);
    await button(wrapper, "保存修改").trigger("click");
    const payload = wrapper.emitted("save")?.[0]?.[0] as any;
    expect(payload.revision).toBe(4);
    expect(payload.default_currency).toBe("CNY");
    expect(payload.currencies[1]).toEqual({
      code: "USD",
      name: "美元",
      prefix: "$",
      suffix: "",
      decimal_places: 2,
      enabled: true,
      sort_order: 10,
    });
    expect(payload.currencies[1]).not.toHaveProperty("usage");
    expect(payload.currencies[1]).not.toHaveProperty("precision_locked");
  });
  it("accepts an exact acknowledged save as the new baseline even if server sorting differs", async () => {
    const wrapper = screen();
    await nameInput(wrapper).setValue("美元");
    await button(wrapper, "保存修改").trigger("click");
    const saved = registry();
    saved.revision = 5;
    saved.currencies[1]!.name = "美元";
    saved.currencies.reverse();
    await wrapper.setProps({ registry: saved, notice: "已保存" });
    await flushPromises();
    expect(wrapper.emitted("dirty")?.at(-1)).toEqual([false]);
    expect(wrapper.text()).not.toContain("设置已更新，你还有未保存的修改");
    expect(button(wrapper, "保存修改").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("配置版本 5");
  });
  it("does not treat an unsolicited matching update as a confirmed save", async () => {
    const wrapper = screen();
    await nameInput(wrapper).setValue("美元");
    const next = registry();
    next.revision = 5;
    next.currencies[1]!.name = "美元";
    await wrapper.setProps({ registry: next });
    expect(wrapper.text()).toContain("设置已更新，你还有未保存的修改");
    expect(wrapper.emitted("dirty")?.at(-1)).toEqual([true]);
    expect(button(wrapper, "保存修改").attributes("disabled")).toBeDefined();
  });
  it("preserves a dirty draft on an unrelated new revision instead of borrowing it", async () => {
    const wrapper = screen();
    await nameInput(wrapper).setValue("我的未存草稿");
    const next = registry();
    next.revision = 5;
    next.currencies[1]!.name = "别人更新";
    await wrapper.setProps({ registry: next });
    expect((nameInput(wrapper).element as HTMLInputElement).value).toBe(
      "我的未存草稿",
    );
    expect(wrapper.text()).toContain("设置已更新，你还有未保存的修改");
    expect(button(wrapper, "保存修改").attributes("disabled")).toBeDefined();
    await button(wrapper, "放弃修改并刷新").trigger("click");
    expect((nameInput(wrapper).element as HTMLInputElement).value).toBe(
      "别人更新",
    );
    expect(wrapper.emitted("dirty")?.at(-1)).toEqual([false]);
    expect(wrapper.emitted("reload")).toHaveLength(1);
  });
  it.each([undefined, null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "0"])(
    "never turns invalid/missing usage %s into zero or an enabled disable-control",
    async (invalid) => {
      const value: any = registry();
      value.currencies[1].usage.pending_orders = invalid;
      const wrapper = screen(value);
      expect(
        card(wrapper).find(".gce-usage-pills .gce-usage-item strong").text(),
      ).toBe("—");
      expect(
        card(wrapper).find("input[type=checkbox]").attributes("disabled"),
      ).toBeDefined();
      expect(wrapper.text()).toContain("使用记录未确认，暂不能停用");
      await nameInput(wrapper).setValue("合法新名");
      expect(button(wrapper, "保存修改").attributes("disabled")).toBeDefined();
    },
  );
  it("treats an entirely missing admin usage object as unknown, not a public zero-count registry", () => {
    const value: any = registry();
    delete value.currencies[1].usage;
    const wrapper = screen(value);
    expect(
      card(wrapper)
        .findAll(".gce-usage-item strong")
        .map((node) => node.text()),
    ).toEqual(Array(7).fill("—"));
    expect(
      card(wrapper).find("input[type=checkbox]").attributes("disabled"),
    ).toBeDefined();
  });
  it.each([undefined, -1, 7, 1.5, "2"])(
    "does not guess decimal precision for invalid metadata %s",
    async (invalid) => {
      const value: any = registry();
      value.currencies[1].decimal_places = invalid;
      const wrapper = screen(value);
      expect(
        (card(wrapper).find('input[id^="dec-"]').element as HTMLInputElement)
          .value,
      ).toBe("");
      expect(card(wrapper).find(".gce-preview-val").text()).toBe("—");
      await nameInput(wrapper).setValue("新名");
      expect(button(wrapper, "保存修改").attributes("disabled")).toBeDefined();
    },
  );
  it("locks historical precision and active obligations even if server precision flag is inconsistent", () => {
    const value = registry();
    value.currencies[1]!.usage.plan_prices = 1;
    value.currencies[1]!.usage.unpaid_invoices = 2;
    const wrapper = screen(value);
    expect(
      card(wrapper).find('input[id^="dec-"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      card(wrapper).find("input[type=checkbox]").attributes("disabled"),
    ).toBeDefined();
    expect(card(wrapper).text()).toContain("未付账单: 2");
  });
  it.each(["币".repeat(27), "   ", "<b>美元</b>", "隐\u200d藏", "\ud800"])(
    "rejects invalid UTF-8/plain text name without emitting save",
    async (value) => {
      const wrapper = screen();
      await nameInput(wrapper).setValue(value);
      await button(wrapper, "保存修改").trigger("click");
      expect(wrapper.emitted("save")).toBeUndefined();
    },
  );
  it("keeps new currency defaults explicit while preventing deletion of existing currencies", async () => {
    const wrapper = screen();
    expect(wrapper.findAll(".gce-btn-danger")).toHaveLength(0);
    await button(wrapper, "添加其他币种").trigger("click");
    expect(wrapper.findAll(".gce-card")).toHaveLength(3);
    expect(wrapper.findAll(".gce-btn-danger")).toHaveLength(1);
    expect(
      (
        wrapper.findAll(".gce-card")[2]!.find('input[id^="dec-"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("2");
  });
  it("blocks a save while its outcome is uncertain, with no automatic resubmission", async () => {
    const wrapper = screen();
    await nameInput(wrapper).setValue("美元");
    await wrapper.setProps({ uncertain: true });
    await button(wrapper, "保存修改").trigger("click");
    expect(wrapper.emitted("save")).toBeUndefined();
    expect(wrapper.text()).toContain("保存结果待确认");
  });
});

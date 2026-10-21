// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import UiSelect from "../src/components/UiSelect.vue";
import UiLoading from "../src/components/UiLoading.vue";
import UiSpinner from "../src/components/UiSpinner.vue";

const wrappers: VueWrapper[] = [];
function screen(
  props: Record<string, unknown> = {},
  slots: Record<string, unknown> = {},
) {
  const wrapper = mount(UiSelect, {
    props: {
      modelValue: "CNY",
      options: [
        { value: "CNY", label: "人民币" },
        { value: "USD", label: "US Dollar" },
        { value: "GBP", label: "Pound", disabled: true },
        { value: "EUR", label: "Euro" },
      ],
      ...props,
    },
    slots: slots as any,
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}
const popup = () => document.querySelector('[role="listbox"]')!;
const options = () => Array.from(document.querySelectorAll('[role="option"]'));
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers.length = 0;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("shared branded select", () => {
  it("never renders a native select and forwards form name, id, accessible name and initial value", () => {
    const wrapper = screen({
      id: "currency",
      name: "currency",
      "aria-label": "购买币种",
    });
    expect(wrapper.find("select").exists()).toBe(false);
    expect(wrapper.get('[role="combobox"]').attributes()).toMatchObject({
      id: "currency",
      "aria-label": "购买币种",
      "aria-expanded": "false",
      value: "CNY",
    });
    expect(wrapper.get("input[type=hidden]").attributes()).toMatchObject({
      name: "currency",
      value: "CNY",
    });
    expect(wrapper.get("button").text()).toBe("人民币");
  });
  it("keeps focus on the combobox, skips disabled options, and commits only on Enter", async () => {
    const wrapper = screen();
    const button = wrapper.get("button");
    (button.element as HTMLButtonElement).focus();
    await button.trigger("keydown", { key: "ArrowDown" });
    await nextTick();
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(button.element);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await button.trigger("keydown", { key: "ArrowDown" });
    expect(button.attributes("aria-activedescendant")).toBe(options()[1]!.id);
    await button.trigger("keydown", { key: "ArrowDown" });
    expect(button.attributes("aria-activedescendant")).toBe(options()[3]!.id);
    await button.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:modelValue")).toEqual([["EUR"]]);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    const event = wrapper.emitted("change")![0]![0] as Event;
    expect((event.target as HTMLButtonElement).value).toBe("EUR");
    expect(event.currentTarget).toBe(event.target);
  });
  it("supports Home/End/Space, Escape cancellation and Tab without swallowing normal focus navigation", async () => {
    const wrapper = screen();
    const button = wrapper.get("button");
    await button.trigger("keydown", { key: "End" });
    expect(button.attributes("aria-activedescendant")).toBe(options()[3]!.id);
    await button.trigger("keydown", { key: "Home" });
    expect(button.attributes("aria-activedescendant")).toBe(options()[0]!.id);
    await button.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(button.attributes("aria-expanded")).toBe("false");
    await button.trigger("keydown", { key: " " });
    expect(popup()).toBeTruthy();
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    button.element.dispatchEvent(event);
    await nextTick();
    expect(event.defaultPrevented).toBe(false);
    expect(button.attributes("aria-expanded")).toBe("false");
  });
  it("supports typeahead and cycles repeated letters while skipping unavailable choices", async () => {
    const wrapper = screen({
      modelValue: "first",
      options: [
        { value: "first", label: "Alpha" },
        { value: "blocked", label: "Beta blocked", disabled: true },
        { value: "second", label: "Beta one" },
        { value: "third", label: "Beta two" },
      ],
    });
    const button = wrapper.get("button");
    await button.trigger("keydown", { key: "b" });
    expect(button.attributes("aria-activedescendant")).toBe(options()[2]!.id);
    await button.trigger("keydown", { key: "b" });
    expect(button.attributes("aria-activedescendant")).toBe(options()[3]!.id);
    await button.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["third"]);
  });
  it("does not change anything when disabled or read-only, and closes an already open list when disabled", async () => {
    const wrapper = screen({ disabled: true });
    const button = wrapper.get("button");
    await button.trigger("click");
    await button.trigger("keydown", { key: "ArrowDown" });
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await wrapper.setProps({ disabled: false, readonly: true });
    await button.trigger("click");
    expect(button.attributes("aria-expanded")).toBe("false");
    await wrapper.setProps({ readonly: false });
    await button.trigger("click");
    expect(popup()).toBeTruthy();
    await wrapper.setProps({ disabled: true });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
  it("respects an inherited disabled fieldset rather than bypassing a busy form", async () => {
    const parent = mount(
      defineComponent({
        components: { UiSelect },
        template:
          '<fieldset disabled><UiSelect model-value="a"><option value="a">A</option><option value="b">B</option></UiSelect></fieldset>',
      }),
      { attachTo: document.body },
    );
    wrappers.push(parent);
    await parent.get("button").trigger("keydown", { key: "ArrowDown" });
    expect(parent.get("button").attributes("aria-expanded")).toBe("false");
  });
  it("parses v-for/v-if/template options reactively and retains boolean and numeric value types", async () => {
    const parent = mount(
      defineComponent({
        components: { UiSelect },
        setup() {
          return {
            enabled: ref(true),
            value: ref<string | number | boolean>(false),
            rows: ref([
              { value: false, label: "停用" },
              { value: true, label: "启用" },
            ]),
          };
        },
        template:
          '<UiSelect v-model="value"><template v-if="enabled"><option v-for="row in rows" :key="String(row.value)" :value="row.value">{{ row.label }}</option></template><option :value="2">两个</option></UiSelect>',
      }),
      { attachTo: document.body },
    );
    wrappers.push(parent);
    const button = parent.get("button");
    expect(button.text()).toBe("停用");
    await button.trigger("click");
    expect(options().map((option) => option.textContent)).toEqual([
      "停用",
      "启用",
      "两个",
    ]);
    options()[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect((parent.vm as any).value).toBe(true);
    expect(button.text()).toBe("启用");
    (parent.vm as any).enabled = false;
    await nextTick();
    await button.trigger("click");
    expect(options().map((option) => option.textContent)).toEqual(["两个"]);
    options()[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect((parent.vm as any).value).toBe(2);
  });
  it("applies v-model.number and value-prop legacy compatibility, without changing option labels", async () => {
    const wrapper = screen({
      modelValue: undefined,
      value: 1,
      modelModifiers: { number: true },
      options: [
        { value: "1", label: "1 位" },
        { value: "2", label: "2 位" },
      ],
    });
    expect(wrapper.get("button").text()).toBe("1 位");
    await wrapper.get("button").trigger("click");
    options()[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([2]);
    expect(
      ((wrapper.emitted("change")![0]![0] as Event).target as HTMLButtonElement)
        .value,
    ).toBe("2");
  });
  it("keeps the popup inside its owning modal, dismisses outside, and leaves disabled items unchanged", async () => {
    const dialog = document.createElement("section");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    const wrapper = mount(UiSelect, {
      props: {
        modelValue: "a",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B", disabled: true },
        ],
      },
      attachTo: dialog,
    });
    wrappers.push(wrapper);
    await wrapper.get("button").trigger("click");
    expect(dialog.contains(popup())).toBe(true);
    options()[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
  it("renders long labels as plain wrapped text with no HTML interpretation and updates external changes", async () => {
    const label = "<b>超长币种名称</b>".repeat(30);
    const wrapper = screen({
      options: [
        { value: "CNY", label },
        { value: "USD", label: "美元" },
      ],
    });
    expect(wrapper.get(".ui-select-value").text()).toBe(label);
    expect(wrapper.find("b").exists()).toBe(false);
    await wrapper.setProps({ modelValue: "USD" });
    expect(wrapper.get("button").text()).toBe("美元");
  });
  it("does not emit redundant writes when selecting the current option", async () => {
    const wrapper = screen();
    await wrapper.get("button").trigger("click");
    options()[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(wrapper.emitted("change")).toBeUndefined();
  });
});

describe("shared loading feedback", () => {
  it.each(["cards", "list", "form"] as const)(
    "provides one readable %s loading status with decorative, bounded skeletons",
    (layout) => {
      const wrapper = mount(UiLoading, {
        props: { layout, label: "正在读取商品…", rows: 3 },
      });
      wrappers.push(wrapper);
      expect(wrapper.get("[role=status]").text()).toBe("正在读取商品…");
      expect(wrapper.findAll(".ui-loading-item")).toHaveLength(3);
      expect(wrapper.get(".ui-loading-content").attributes("aria-hidden")).toBe(
        "true",
      );
      expect(wrapper.get("[role=status]").attributes("aria-busy")).toBe("true");
    },
  );
  it("keeps an inline spinner decorative unless it explicitly supplies the status label", () => {
    const wrapper = mount(UiSpinner);
    wrappers.push(wrapper);
    expect(wrapper.attributes("aria-hidden")).toBe("true");
    expect(wrapper.attributes("role")).toBeUndefined();
    const labelled = mount(UiSpinner, { props: { label: "正在保存…" } });
    wrappers.push(labelled);
    expect(labelled.attributes("role")).toBe("status");
    expect(labelled.attributes("aria-label")).toBe("正在保存…");
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, type Ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import SettingsPage from "../src/pages/SettingsPage.vue";
import { currencies, email, site } from "./settings-fixtures";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  generation: null as unknown as Ref<number>,
  leave: null as unknown as () => Promise<boolean>,
}));
vi.mock("../src/composables/useWorkspace", async () => {
  const { ref } = await import("vue");
  mocks.generation = ref(0);
  return { useWorkspace: () => ({ ...mocks }) };
});
vi.mock("vue-router", () => ({
  onBeforeRouteLeave: (guard: () => Promise<boolean>) => {
    mocks.leave = guard;
  },
}));
const overlay = defineComponent({
  props: ["open", "title"],
  template:
    '<section v-if="open" role="dialog"><h2>{{title}}</h2><slot/><footer><slot name="footer"/></footer></section>',
});
const currency = defineComponent({
  props: ["registry", "locale", "busy", "uncertain", "error", "notice"],
  emits: ["save", "reload", "dirty"],
  template:
    '<div class="currency-stub"><p role="alert" v-if="error">{{error}}</p><p v-if="notice" role="status">{{notice}}</p></div>',
});
const smtp = defineComponent({
  props: ["settings", "locale", "busy", "uncertain", "error", "notice"],
  emits: ["save", "test", "reload", "dirty"],
  template:
    '<div class="email-stub"><p role="alert" v-if="error">{{error}}</p><p v-if="notice" role="status">{{notice}}</p></div>',
});
const updates = defineComponent({
  props: ["locale", "mode"],
  emits: ["busy", "uncertain"],
  template: '<div class="updates-stub"/>',
});
let wrappers: VueWrapper[] = [];
function screen(role = "admin") {
  const w = mount(SettingsPage, {
    props: { locale: "zh-CN", mode: "api", role },
    global: {
      stubs: {
        OverlayPanel: overlay,
        GeminiCurrencyEditor: currency,
        GeminiEmailEditor: smtp,
        UpdateManager: updates,
      },
    },
  });
  wrappers.push(w);
  return w;
}
const button = (w: VueWrapper, s: string) =>
  w.findAll("button").find((b) => b.text() === s)!;
beforeEach(() => {
  mocks.read.mockReset();
  mocks.write.mockReset();
  mocks.generation.value = 0;
  mocks.read.mockImplementation(async (path: string) =>
    path === "/admin/site-settings"
      ? site()
      : path === "/admin/currencies"
        ? currencies()
        : path === "/admin/email-settings"
          ? email()
          : { items: [] },
  );
});
afterEach(() => {
  wrappers.forEach((w) => w.unmount());
  wrappers = [];
});
describe("settings wrapper acknowledgements and drafts", () => {
  it("does not read admin settings for an unprivileged role", async () => {
    const w = screen("customer");
    await flushPromises();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(w.text()).toContain("仅限管理员");
  });
  it("rejects a partial read rather than mounting an editable form", async () => {
    mocks.read.mockResolvedValue({ revision: 1, site_name: "partial" });
    const w = screen();
    await flushPromises();
    expect(w.find(".settings-form").exists()).toBe(false);
    expect(w.find('[role="alert"]').exists()).toBe(true);
  });
  it("prompts before abandoning a dirty site draft, and a declined prompt leaves it intact", async () => {
    const w = screen();
    await flushPromises();
    await w.find(".settings-form input").setValue("未保存站点");
    await button(w, "邮件设置").trigger("click");
    await flushPromises();
    expect(w.find('[role="dialog"]').exists()).toBe(true);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await button(w, "继续编辑").trigger("click");
    await flushPromises();
    expect(w.find(".settings-form input").element).toHaveProperty(
      "value",
      "未保存站点",
    );
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
  it("locks fields while saving and clears dirty only after an exact confirmed response", async () => {
    let finish!: (value: unknown) => void;
    mocks.write.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const w = screen();
    await flushPromises();
    await w.find(".settings-form input").setValue("新的站点名");
    await w.find(".settings-content>form").trigger("submit");
    await flushPromises();
    expect(w.find("fieldset").attributes("disabled")).toBeDefined();
    expect(mocks.write).toHaveBeenCalledWith("/admin/site-settings", {
      ...site(),
      site_name: "新的站点名",
    });
    finish({ ...site(), revision: 2, site_name: "新的站点名" });
    await flushPromises();
    expect(w.text()).toContain("设置已保存");
    expect(w.find(".setting-note").exists()).toBe(false);
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    await button(w, "邮件设置").trigger("click");
    await flushPromises();
    expect(w.findComponent(smtp).exists()).toBe(true);
    expect(w.find('[role="dialog"]').exists()).toBe(false);
  });
  it("treats a mismatched successful save as uncertain and keeps the original draft", async () => {
    mocks.write.mockResolvedValue({
      ...site(),
      revision: 2,
      site_name: "wrong response",
    });
    const w = screen();
    await flushPromises();
    await w.find(".settings-form input").setValue("保留的草稿");
    await w.find(".settings-content>form").trigger("submit");
    await flushPromises();
    expect(w.find(".settings-form input").element).toHaveProperty(
      "value",
      "保留的草稿",
    );
    expect(w.find(".save-notice").exists()).toBe(false);
    expect(button(w, "保存设置").attributes("disabled")).toBeDefined();
    await w.find(".settings-content>form").trigger("submit");
    await flushPromises();
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("keeps a conflict locked until the user explicitly discards and reloads, without automatic retry", async () => {
    mocks.write.mockRejectedValue({ status: 409, code: "SETTINGS_CONFLICT" });
    const w = screen();
    await flushPromises();
    await w.find(".settings-form input").setValue("冲突草稿");
    await w.find(".settings-content>form").trigger("submit");
    await flushPromises();
    expect(button(w, "保存设置").attributes("disabled")).toBeDefined();
    await button(w, "重新读取").trigger("click");
    await flushPromises();
    expect(w.find('[role="dialog"]').exists()).toBe(true);
    await button(w, "放弃并继续").trigger("click");
    await flushPromises();
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(w.find(".settings-form input").element).toHaveProperty(
      "value",
      site().site_name,
    );
  });
  it("passes Gemini editor events through existing write contracts and displays feedback once", async () => {
    const w = screen();
    await flushPromises();
    await button(w, "运营币种").trigger("click");
    await flushPromises();
    const child = w.findComponent(currency);
    child.vm.$emit("dirty", true);
    const body = {
      revision: 3,
      default_currency: "CNY",
      currencies: currencies().currencies.map(
        ({ precision_locked: _, usage: __, ...c }) => c,
      ),
    };
    mocks.write.mockResolvedValue({ ...currencies(), revision: 4 });
    child.vm.$emit("save", body);
    await flushPromises();
    expect(mocks.write).toHaveBeenCalledWith("/admin/currencies", body);
    expect(
      w
        .findAll('[role="status"]')
        .filter((n) => n.text().includes("设置已保存")),
    ).toHaveLength(1);
    expect(w.find('[role="dialog"]').exists()).toBe(false);
  });
  it("does not acknowledge an invalid SMTP test or permit another send after uncertain delivery", async () => {
    mocks.read.mockImplementation(async (path: string) =>
      path === "/admin/site-settings" ? site() : { ...email(), enabled: true },
    );
    mocks.write.mockResolvedValue({ status: "delivered" });
    const w = screen();
    await flushPromises();
    await button(w, "邮件设置").trigger("click");
    await flushPromises();
    const child = w.findComponent(smtp);
    child.vm.$emit("test", "test@example.invalid");
    await flushPromises();
    expect(mocks.write).toHaveBeenCalledWith("/admin/email-settings/test", {
      revision: 2,
      to: "test@example.invalid",
    });
    expect(w.text()).not.toContain("测试请求已接受");
    expect(child.props("uncertain")).toBe(true);
    child.vm.$emit("test", "test@example.invalid");
    await flushPromises();
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("guards navigation while the update child is busy or has an unconfirmed handoff", async () => {
    const w = screen();
    await flushPromises();
    await button(w, "版本与更新").trigger("click");
    await flushPromises();
    const child = w.findComponent(updates);
    child.vm.$emit("busy", true);
    await flushPromises();
    expect(await mocks.leave()).toBe(false);
    expect(button(w, "邮件设置").attributes("disabled")).toBeDefined();
    child.vm.$emit("busy", false);
    child.vm.$emit("uncertain", true);
    await flushPromises();
    const pending = mocks.leave();
    await flushPromises();
    expect(w.find('[role="dialog"]').exists()).toBe(true);
    await button(w, "继续编辑").trigger("click");
    expect(await pending).toBe(false);
  });
});

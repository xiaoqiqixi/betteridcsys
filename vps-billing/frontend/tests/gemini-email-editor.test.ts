// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";
import GeminiEmailEditor from "../src/components/GeminiEmailEditor.vue";

const settings = () => ({
  revision: 6,
  enabled: true,
  host: "smtp.example.invalid",
  port: 587,
  tls_mode: "starttls" as const,
  from_address: "mail@example.invalid",
  from_name: "测试站点",
  username_configured: true,
  password_configured: true,
  key_configured: true,
  plugin_available: true,
  destination_allowed: true,
  plugin_status: "approved" as const,
  plugin_version: "0.5.6",
  updated_at: "2026-10-21T00:00:00Z",
});
let wrappers: VueWrapper[] = [];
function screen(value: any = settings()) {
  const wrapper = mount(GeminiEmailEditor, {
    props: {
      settings: value,
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
async function credentialEdit(wrapper: VueWrapper) {
  await wrapper.find("#gee-user").setValue("new-user");
  await wrapper.find("#gee-pass").setValue("  exact test password  ");
}
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers = [];
});

describe("received Gemini email editor: credentials and confirmed-save boundaries", () => {
  it("accepts reactive Vue props without structuredClone(proxy) failures", () => {
    const wrapper = screen(reactive(settings()));
    expect((wrapper.find("#gee-host").element as HTMLInputElement).value).toBe(
      "smtp.example.invalid",
    );
    expect(wrapper.emitted("dirty")?.at(-1)).toEqual([false]);
  });
  it("omits blank credentials so an ordinary setting edit retains stored secrets", async () => {
    const wrapper = screen();
    await wrapper.find("#gee-name").setValue("新的发件人");
    await button(wrapper, "保存修改").trigger("click");
    expect(wrapper.emitted("save")?.[0]?.[0]).toEqual({
      revision: 6,
      enabled: true,
      host: "smtp.example.invalid",
      port: 587,
      tls_mode: "starttls",
      from_address: "mail@example.invalid",
      from_name: "新的发件人",
    });
  });
  it("preserves exact password bytes on submit and does not clear a secret before acknowledgment", async () => {
    const wrapper = screen();
    await credentialEdit(wrapper);
    await button(wrapper, "保存修改").trigger("click");
    expect((wrapper.emitted("save")?.[0]?.[0] as any).password).toBe(
      "  exact test password  ",
    );
    expect((wrapper.find("#gee-pass").element as HTMLInputElement).value).toBe(
      "  exact test password  ",
    );
    expect(wrapper.emitted("dirty")?.at(-1)).toEqual([true]);
  });
  it("clears secrets only on an exact confirmed public-data and credential-flag acknowledgment", async () => {
    const wrapper = screen();
    await credentialEdit(wrapper);
    await wrapper.find("#gee-name").setValue("新的发件人");
    await button(wrapper, "保存修改").trigger("click");
    await wrapper.setProps({
      settings: { ...settings(), revision: 7, from_name: "新的发件人" },
    });
    expect((wrapper.find("#gee-user").element as HTMLInputElement).value).toBe(
      "",
    );
    expect((wrapper.find("#gee-pass").element as HTMLInputElement).value).toBe(
      "",
    );
    expect(wrapper.emitted("dirty")?.at(-1)).toEqual([false]);
    expect(wrapper.text()).not.toContain("设置已更新，你的未保存修改仍然保留");
  });
  it("retains secret input after a failed save and never emits a test while dirty", async () => {
    const wrapper = screen();
    await credentialEdit(wrapper);
    await button(wrapper, "保存修改").trigger("click");
    await wrapper.setProps({ error: "保存未完成，请核对。", busy: false });
    expect((wrapper.find("#gee-pass").element as HTMLInputElement).value).toBe(
      "  exact test password  ",
    );
    await wrapper.find("#gee-test-to").setValue("recipient@example.invalid");
    await button(wrapper, "发送测试").trigger("click");
    expect(wrapper.emitted("test")).toBeUndefined();
    expect(wrapper.emitted("dirty")?.at(-1)).toEqual([true]);
  });
  it("retains dirty credentials through an unrelated newer revision and disables saving", async () => {
    const wrapper = screen();
    await credentialEdit(wrapper);
    await button(wrapper, "保存修改").trigger("click");
    await wrapper.setProps({
      settings: { ...settings(), revision: 7, from_name: "别人保存的设置" },
    });
    expect(wrapper.text()).toContain("设置已更新，你的未保存修改仍然保留");
    expect((wrapper.find("#gee-pass").element as HTMLInputElement).value).toBe(
      "  exact test password  ",
    );
    expect(button(wrapper, "保存修改").attributes("disabled")).toBeDefined();
  });
  it("does not accept a matching newer read without a submitted save marker", async () => {
    const wrapper = screen();
    await wrapper.find("#gee-name").setValue("未存修改");
    await wrapper.setProps({
      settings: { ...settings(), revision: 7, from_name: "未存修改" },
    });
    expect(wrapper.emitted("dirty")?.at(-1)).toEqual([true]);
    expect(button(wrapper, "保存修改").attributes("disabled")).toBeDefined();
  });
  it("does not clear credentials if the public acknowledgment has the wrong credential-presence flags", async () => {
    const wrapper = screen();
    await credentialEdit(wrapper);
    await button(wrapper, "保存修改").trigger("click");
    await wrapper.setProps({
      settings: {
        ...settings(),
        revision: 7,
        enabled: false,
        username_configured: false,
        password_configured: false,
      },
    });
    expect((wrapper.find("#gee-pass").element as HTMLInputElement).value).toBe(
      "  exact test password  ",
    );
    expect(wrapper.emitted("dirty")?.at(-1)).toEqual([true]);
  });
  it("does not acknowledge a revision jump or an uncertain write as saved", async () => {
    const wrapper = screen();
    await credentialEdit(wrapper);
    await button(wrapper, "保存修改").trigger("click");
    await wrapper.setProps({
      settings: { ...settings(), revision: 9 },
      uncertain: true,
    });
    expect((wrapper.find("#gee-pass").element as HTMLInputElement).value).toBe(
      "  exact test password  ",
    );
    expect(button(wrapper, "保存修改").attributes("disabled")).toBeDefined();
    expect(wrapper.emitted("dirty")?.at(-1)).toEqual([true]);
  });
  it("clears local secret inputs and sends paired clear flags only while disabled", async () => {
    const wrapper = screen();
    await credentialEdit(wrapper);
    const clear = wrapper.find(".gee-clear-toggle input");
    await clear.setValue(true);
    expect((wrapper.find("#gee-user").element as HTMLInputElement).value).toBe(
      "",
    );
    expect((wrapper.find("#gee-pass").element as HTMLInputElement).value).toBe(
      "",
    );
    expect(
      (wrapper.find(".gee-row-top input").element as HTMLInputElement).checked,
    ).toBe(false);
    await button(wrapper, "保存修改").trigger("click");
    const payload = wrapper.emitted("save")?.[0]?.[0] as any;
    expect(payload.enabled).toBe(false);
    expect(payload.clear_username).toBe(true);
    expect(payload.clear_password).toBe(true);
    expect(payload).not.toHaveProperty("username");
    expect(payload).not.toHaveProperty("password");
  });
  it("requires both new credentials when changing a server with stored credentials", async () => {
    const wrapper = screen();
    await wrapper.find("#gee-host").setValue("new-smtp.example.invalid");
    expect(button(wrapper, "保存修改").attributes("disabled")).toBeDefined();
    await wrapper.find("#gee-user").setValue("new-user");
    expect(button(wrapper, "保存修改").attributes("disabled")).toBeDefined();
    await wrapper.find("#gee-pass").setValue("test-secret");
    expect(button(wrapper, "保存修改").attributes("disabled")).toBeUndefined();
  });
  it("permits a disabled no-credentials draft to change the destination without inventing credentials", async () => {
    const wrapper = screen({
      ...settings(),
      enabled: false,
      username_configured: false,
      password_configured: false,
    });
    await wrapper.find("#gee-host").setValue("new-smtp.example.invalid");
    await button(wrapper, "保存修改").trigger("click");
    expect(wrapper.emitted("save")).toHaveLength(1);
    expect(wrapper.emitted("save")?.[0]?.[0]).not.toHaveProperty("password");
  });
  it.each([
    "user..name@example.invalid",
    "User <user@example.invalid>",
    "a@example.invalid,b@example.invalid",
    "user@-bad.example",
    "user name@example.invalid",
  ])("rejects invalid single-recipient grammar: %s", async (value) => {
    const wrapper = screen();
    await wrapper.find("#gee-test-to").setValue(value);
    await button(wrapper, "发送测试").trigger("click");
    expect(wrapper.emitted("test")).toBeUndefined();
  });
  it("emits one explicit test recipient using only unchanged saved, enabled and approved settings", async () => {
    const wrapper = screen();
    await wrapper
      .find("#gee-test-to")
      .setValue("recipient+check@example.invalid");
    await button(wrapper, "发送测试").trigger("click");
    expect(wrapper.emitted("test")).toEqual([
      ["recipient+check@example.invalid"],
    ]);
    expect(wrapper.emitted("save")).toBeUndefined();
  });
  it.each([
    { key_configured: false },
    { destination_allowed: false },
    { plugin_available: false, plugin_status: "unavailable" },
    { enabled: false },
  ])("cannot test unavailable saved settings %j", async (changes) => {
    const wrapper = screen({ ...settings(), ...changes });
    await wrapper.find("#gee-test-to").setValue("recipient@example.invalid");
    await button(wrapper, "发送测试").trigger("click");
    expect(wrapper.emitted("test")).toBeUndefined();
  });
  it.each([
    { revision: 0 },
    { port: "587" },
    { tls_mode: "none" },
    { username_configured: "true" },
    { password: "must-not-return" },
  ])(
    "blocks malformed read DTO without fabricating defaults %j",
    async (changes) => {
      const wrapper = screen({ ...settings(), ...changes });
      expect(wrapper.text()).toContain("暂时无法确认邮件设置，请刷新后再操作");
      expect(
        (wrapper.find("#gee-port").element as HTMLInputElement).value,
      ).toBe("");
      expect(
        (wrapper.find("#gee-user").element as HTMLInputElement).value,
      ).toBe("");
      expect(
        (wrapper.find("#gee-pass").element as HTMLInputElement).value,
      ).toBe("");
      expect(button(wrapper, "保存修改").attributes("disabled")).toBeDefined();
      expect(wrapper.text()).not.toContain("must-not-return");
    },
  );
  it("keeps secret fields masked and clears them explicitly on a non-unmount close", async () => {
    const wrapper = screen();
    await credentialEdit(wrapper);
    expect(wrapper.find("#gee-user").attributes("type")).toBe("password");
    expect(wrapper.find("#gee-pass").attributes("type")).toBe("password");
    (wrapper.vm as any).clearSecrets();
    expect((wrapper.find("#gee-user").element as HTMLInputElement).value).toBe(
      "",
    );
    expect((wrapper.find("#gee-pass").element as HTMLInputElement).value).toBe(
      "",
    );
  });
  it("clears the actual secret input nodes when unmounted on page close or identity change", async () => {
    const wrapper = screen();
    await credentialEdit(wrapper);
    const usernameNode = wrapper.find("#gee-user").element as HTMLInputElement,
      passwordNode = wrapper.find("#gee-pass").element as HTMLInputElement;
    wrapper.unmount();
    wrappers = wrappers.filter((value) => value !== wrapper);
    expect(usernameNode.value).toBe("");
    expect(passwordNode.value).toBe("");
  });
  it.each(["<b>sender</b>", "hidden\u200dname", "\ud800"])(
    "blocks invalid plain-text sender or malformed UTF-16 %s",
    async (value) => {
      const wrapper = screen();
      await wrapper.find("#gee-name").setValue(value);
      await button(wrapper, "保存修改").trigger("click");
      expect(wrapper.emitted("save")).toBeUndefined();
    },
  );
});

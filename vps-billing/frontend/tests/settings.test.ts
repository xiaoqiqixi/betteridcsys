// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import SettingsPage from "../src/components/SettingsPage.vue";
import { setCsrf } from "../src/lib/api";
import { locale } from "../src/lib/i18n";
import { defaultSiteSettings, type SiteSettings } from "../src/lib/settings";

const settings = (overrides: Partial<SiteSettings> = {}): SiteSettings => ({
  ...defaultSiteSettings,
  ...overrides,
});
const reply = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
const failure = (code: string) => ({
  ok: false,
  json: async () => ({
    error: { code, message: "private-backend-diagnostic" },
  }),
});
const submit = async (wrapper: ReturnType<typeof mount>) => {
  await wrapper.get("form").trigger("submit");
  await flushPromises();
};
beforeEach(() => {
  locale.value = "zh-CN";
  setCsrf("test-csrf");
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("administrator site settings", () => {
  it.each(["zh-CN", "en"] as const)(
    "describes a generic server validation rejection truthfully in %s and retains the draft",
    async (language) => {
      locale.value = language;
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(reply(settings()))
        .mockResolvedValueOnce(failure("INVALID_SETTINGS"));
      vi.stubGlobal("fetch", fetcher);
      const wrapper = mount(SettingsPage, { props: { preview: false } });
      await flushPromises();
      await wrapper.get('[name="site_name"]').setValue("Retained draft");
      await submit(wrapper);
      const alert = wrapper.get('[role="alert"]').text();
      expect(alert).toContain(
        language === "zh-CN" ? "服务器未接受" : "The server did not accept",
      );
      expect(alert).not.toMatch(/标注|highlighted|private-backend-diagnostic/);
      expect(wrapper.findAll('[aria-invalid="true"]')).toHaveLength(0);
      expect(
        wrapper.get<HTMLInputElement>('[name="site_name"]').element.value,
      ).toBe("Retained draft");
      expect(
        wrapper.get('[type="submit"]').attributes("disabled"),
      ).toBeUndefined();
      const currency = wrapper.get<HTMLInputElement>(
        '[name="default_currency"]',
      );
      expect(currency.element.readOnly).toBe(true);
      expect(currency.element.disabled).toBe(false);
      expect(currency.element.value).toBe("CNY");
      expect(
        wrapper.get(`#${currency.attributes("aria-describedby")}`).text(),
      ).toContain(language === "zh-CN" ? "复制" : "copy");
      expect(fetcher).toHaveBeenCalledTimes(2);
      wrapper.unmount();
    },
  );

  it("loads the persisted record, previews locally, and posts the whole revisioned model with CSRF", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(settings({ revision: 7 })))
      .mockResolvedValueOnce(
        reply(
          settings({
            revision: 8,
            site_name: "我的云",
            theme: "teal",
            default_locale: "en",
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const wrapper = mount(SettingsPage, { props: { preview: false } });
    await flushPromises();
    expect(fetcher.mock.calls[0]![0]).toBe("/api/v1/admin/site-settings");
    expect(wrapper.get("details").attributes("open")).toBeUndefined();
    expect(wrapper.get('[type="submit"]').attributes("disabled")).toBeDefined();
    await wrapper.get('[name="site_name"]').setValue("我的云");
    await wrapper.get('[name="theme"][value="teal"]').setValue();
    await wrapper.get('[name="default_locale"]').setValue("en");
    expect(wrapper.get(".settings-preview").attributes("data-theme")).toBe(
      "teal",
    );
    expect(wrapper.get(".settings-preview-brand").text()).toContain("我的云");
    expect(
      wrapper.get<HTMLSelectElement>('[name="default_currency"]').element.value,
    ).toBe("CNY");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await submit(wrapper);
    const request = fetcher.mock.calls[1]![1];
    expect(request.method).toBe("POST");
    expect(request.headers["X-CSRF-Token"]).toBe("test-csrf");
    expect(JSON.parse(request.body)).toEqual(
      settings({
        revision: 7,
        site_name: "我的云",
        theme: "teal",
        default_locale: "en",
      }),
    );
    expect(wrapper.emitted("saved")?.[0]?.[0]).toEqual(
      settings({
        revision: 8,
        site_name: "我的云",
        theme: "teal",
        default_locale: "en",
      }),
    );
    expect(wrapper.text()).toContain("设置已保存");
    expect(wrapper.get('[type="submit"]').attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("keeps offline preview local even on a programmatic submit", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const wrapper = mount(SettingsPage, { props: { preview: true } });
    await flushPromises();
    await wrapper.get('[name="site_name"]').setValue("预览云");
    await submit(wrapper);
    expect(wrapper.get(".settings-preview-brand").text()).toContain("预览云");
    expect(wrapper.text()).toContain("所有修改都不会保存");
    expect(wrapper.get('[type="submit"]').attributes("disabled")).toBeDefined();
    expect(fetcher).not.toHaveBeenCalled();
    expect(wrapper.emitted("saved")).toBeUndefined();
    wrapper.unmount();
  });

  it("preserves a conflicting draft and requires explicit reload before another save", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(settings()))
      .mockResolvedValueOnce(failure("SETTINGS_CONFLICT"))
      .mockResolvedValueOnce(
        reply(settings({ revision: 2, site_name: "其他管理员的名称" })),
      );
    vi.stubGlobal("fetch", fetcher);
    const wrapper = mount(SettingsPage, { props: { preview: false } });
    await flushPromises();
    await wrapper.get('[name="site_name"]').setValue("我的草稿");
    await submit(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toContain("其他管理员");
    expect(
      wrapper.get<HTMLInputElement>('[name="site_name"]').element.value,
    ).toBe("我的草稿");
    expect(wrapper.get('[type="submit"]').attributes("disabled")).toBeDefined();
    await submit(wrapper);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await wrapper.get(".settings-actions [type=button]").trigger("click");
    await flushPromises();
    expect(
      wrapper.get<HTMLInputElement>('[name="site_name"]').element.value,
    ).toBe("其他管理员的名称");
    expect(wrapper.text()).not.toContain("private-backend-diagnostic");
    wrapper.unmount();
  });

  it("shows a safe read error and retries without displaying a stale editor", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(failure("FORBIDDEN"))
      .mockResolvedValueOnce(reply(settings()));
    vi.stubGlobal("fetch", fetcher);
    const wrapper = mount(SettingsPage, { props: { preview: false } });
    await flushPromises();
    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.text()).toContain("无法读取站点设置");
    expect(wrapper.html()).not.toContain("private-backend-diagnostic");
    await wrapper.get('[role="alert"] button').trigger("click");
    await flushPromises();
    expect(wrapper.find("form").exists()).toBe(true);
    wrapper.unmount();
  });

  it.each(["AUTH_REQUIRED", "FORBIDDEN", "CSRF_INVALID"])(
    "explains administrator session failure %s",
    async (code) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(reply(settings()))
        .mockResolvedValueOnce(failure(code));
      vi.stubGlobal("fetch", fetcher);
      const wrapper = mount(SettingsPage, { props: { preview: false } });
      await flushPromises();
      await wrapper.get('[name="site_name"]').setValue("新名称");
      await submit(wrapper);
      expect(wrapper.get('[role="alert"]').text()).toContain("重新登录");
      expect(wrapper.text()).not.toContain("private-backend-diagnostic");
      expect(
        wrapper.get('[type="submit"]').attributes("disabled"),
      ).toBeDefined();
      wrapper.unmount();
    },
  );

  it("requires reading after an uncertain save outcome instead of retrying the write", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(settings()))
      .mockRejectedValueOnce(new Error("internal-secret"));
    vi.stubGlobal("fetch", fetcher);
    const wrapper = mount(SettingsPage, { props: { preview: false } });
    await flushPromises();
    await wrapper.get('[name="site_name"]').setValue("新名称");
    await submit(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toContain("无法确认保存结果");
    await submit(wrapper);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).not.toContain("internal-secret");
    wrapper.unmount();
  });

  it("renders stored markup as text and never creates unsafe links or remote logos", async () => {
    const attack = '<img src=x onerror="alert(1)">';
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        reply(
          settings({
            site_name: attack,
            company_name: "<script>alert(1)</script>",
            invoice_issuer: attack,
            email_signature: attack,
            support_url: "javascript:alert(1)",
            display_url: "https://user:pass@example.com",
          }),
        ),
      ),
    );
    const wrapper = mount(SettingsPage, { props: { preview: false } });
    await flushPromises();
    expect(wrapper.get(".settings-preview-brand").text()).toContain(attack);
    expect(wrapper.get(".settings-preview").text()).toContain(
      "<script>alert(1)</script>",
    );
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.find(".settings-preview a").exists()).toBe(false);
    wrapper.unmount();
  });

  it("validates UTF-8 byte limits, opens advanced errors and focuses the invalid field", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(settings()));
    vi.stubGlobal("fetch", fetcher);
    const wrapper = mount(SettingsPage, {
      props: { preview: false },
      attachTo: document.body,
    });
    await flushPromises();
    await wrapper.get('[name="invoice_issuer"]').setValue("中".repeat(81));
    await submit(wrapper);
    expect(wrapper.get("details").attributes("open")).toBeDefined();
    expect(
      wrapper.get('[name="invoice_issuer"]').attributes("aria-invalid"),
    ).toBe("true");
    expect(document.activeElement?.getAttribute("name")).toBe("invoice_issuer");
    expect(fetcher).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("covers English labels, help, validation and errors without changing the currency default", async () => {
    locale.value = "en";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(settings())));
    const wrapper = mount(SettingsPage, { props: { preview: false } });
    await flushPromises();
    expect(wrapper.text()).toContain("Site and operator settings");
    expect(wrapper.text()).toContain("Email delivery remains disabled");
    expect(
      wrapper.get<HTMLSelectElement>('[name="default_currency"]').element.value,
    ).toBe("CNY");
    await wrapper.get('[name="site_name"]').setValue("");
    await submit(wrapper);
    expect(wrapper.text()).toContain("This field is required");
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "Check the highlighted fields",
    );
    wrapper.unmount();
  });

  it("ignores a late server read after switching to offline preview", async () => {
    let finish!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const wrapper = mount(SettingsPage, { props: { preview: false } });
    await wrapper.setProps({ preview: true });
    await flushPromises();
    await wrapper.get('[name="site_name"]').setValue("本地预览");
    finish(reply(settings({ site_name: "迟到回复" })));
    await flushPromises();
    expect(
      wrapper.get<HTMLInputElement>('[name="site_name"]').element.value,
    ).toBe("本地预览");
    wrapper.unmount();
  });

  it("ignores a late save after switching to preview and does not emit persisted branding", async () => {
    let finish!: (value: unknown) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(settings()))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetcher);
    const wrapper = mount(SettingsPage, { props: { preview: false } });
    await flushPromises();
    await wrapper.get('[name="site_name"]').setValue("待保存名称");
    await wrapper.get("form").trigger("submit");
    await wrapper.setProps({ preview: true });
    await flushPromises();
    finish(reply(settings({ revision: 2, site_name: "待保存名称" })));
    await flushPromises();
    expect(wrapper.emitted("saved")).toBeUndefined();
    expect(
      wrapper.get<HTMLInputElement>('[name="site_name"]').element.value,
    ).toBe("星屿云");
    wrapper.unmount();
  });
});

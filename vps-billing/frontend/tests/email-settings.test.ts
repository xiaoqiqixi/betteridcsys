// @vitest-environment jsdom
import { defaultCurrencyRegistry } from "../src/lib/currencies";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import App from "../src/App.vue";
import EmailSettingsPanel from "../src/components/EmailSettingsPanel.vue";
import IntegrationsPage from "../src/components/IntegrationsPage.vue";
import { setCsrf, type Session } from "../src/lib/api";
import {
  defaultEmailSettings,
  readEmailSettings,
  type EmailSettings,
} from "../src/lib/email-settings";
import { restorePreferences, setLocale } from "../src/lib/i18n";
import {
  previewIntegrations,
  type IntegrationSummary,
} from "../src/lib/integrations";
import { defaultSiteSettings } from "../src/lib/settings";

const configured = (changes: Partial<EmailSettings> = {}): EmailSettings => ({
  ...defaultEmailSettings,
  enabled: true,
  host: "smtp.example.invalid",
  from_address: "billing@example.invalid",
  from_name: "Example sender",
  key_configured: true,
  plugin_available: true,
  plugin_status: "approved",
  plugin_version: "1.0.0",
  destination_allowed: true,
  username_configured: true,
  password_configured: true,
  ...changes,
});
const response = (data: unknown) => ({
  ok: true,
  json: async () => ({ data }),
});
const failure = (code: string, status = 400) => ({
  ok: false,
  status,
  json: async () => ({
    error: {
      code,
      message: "sensitive-provider-diagnostic",
      request_id: "sensitive-request-field",
    },
  }),
});
const wrappers: VueWrapper[] = [];
function panel(preview = false) {
  const wrapper = mount(EmailSettingsPanel, {
    props: { preview, refreshToken: 0 },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}
function saveButton(wrapper: VueWrapper) {
  return wrapper.find('[data-testid="smtp-form"] button[type="submit"]');
}
function sendButton(wrapper: VueWrapper) {
  return wrapper.find('[data-testid="smtp-test-form"] button[type="submit"]');
}
function credentialInput(wrapper: VueWrapper, name: "username" | "password") {
  return wrapper.find<HTMLInputElement>(`input[name="${name}"]`);
}
function reloadButton(wrapper: VueWrapper) {
  return wrapper.find(".smtp-reload button");
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  localStorage.clear();
  sessionStorage.clear();
  restorePreferences();
  setCsrf("smtp-test-csrf");
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("SMTP settings privacy and input contract", () => {
  it("selects only non-secret fields and rejects malformed or oversized response fields", () => {
    const parsed = readEmailSettings({
      ...configured(),
      username: "server-account",
      password: "server-secret",
      ciphertext: "encrypted-secret",
    });
    expect(parsed).toEqual(configured());
    for (const changes of [
      { revision: 0 },
      { port: 0 },
      { tls_mode: "insecure" },
      { password_configured: "yes" },
      { plugin_available: "yes" },
      { plugin_status: "running_unverified" },
      { plugin_version: "../plugin" },
      { destination_allowed: "yes" },
      { host: "x".repeat(254) },
      { from_name: "Injected\r\nHeader" },
      { updated_at: "invalid" },
    ]) {
      expect(() =>
        readEmailSettings({ ...configured(), ...changes }),
      ).toThrow();
    }
  });
  it("shows configured indicators with blank masked inputs and never hydrates accidental returned credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          ...configured(),
          username: "server-account",
          password: "server-secret",
          ciphertext: "encrypted-secret",
        }),
      ),
    );
    const wrapper = panel();
    await flushPromises();
    for (const name of ["username", "password"] as const) {
      expect(credentialInput(wrapper, name).element.value).toBe("");
      expect(credentialInput(wrapper, name).attributes("type")).toBe(
        "password",
      );
    }
    expect(wrapper.text()).toContain("已配置 · 不回显");
    expect(wrapper.html()).not.toMatch(
      /server-account|server-secret|encrypted-secret/,
    );
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  it("saves a revision with CSRF and omits blank credential fields to preserve saved values", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(configured()))
      .mockResolvedValueOnce(
        response(configured({ revision: 2, from_name: "New sender" })),
      );
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await flushPromises();
    await wrapper.find('[name="from_name"]').setValue("New sender");
    await wrapper.find('[data-testid="smtp-form"]').trigger("submit");
    await flushPromises();
    const [path, options] = fetcher.mock.calls[1]!;
    expect(path).toBe("/api/v1/admin/email-settings");
    expect(options.method).toBe("POST");
    expect(options.headers["X-CSRF-Token"]).toBe("smtp-test-csrf");
    expect(JSON.parse(options.body)).toEqual({
      enabled: true,
      host: "smtp.example.invalid",
      port: 587,
      tls_mode: "starttls",
      from_address: "billing@example.invalid",
      from_name: "New sender",
      revision: 1,
    });
    expect(wrapper.text()).toContain("SMTP 配置已保存");
    expect(wrapper.text()).toContain("版本 2");
  });
  it("clears both typed credentials after saving and never writes them to browser storage", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(configured()))
      .mockResolvedValueOnce(response(configured({ revision: 2 })));
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await flushPromises();
    await credentialInput(wrapper, "username").setValue("new-test-account");
    await credentialInput(wrapper, "password").setValue("new-test-password");
    await wrapper.find('[data-testid="smtp-form"]').trigger("submit");
    await flushPromises();
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toMatchObject({
      username: "new-test-account",
      password: "new-test-password",
    });
    expect(credentialInput(wrapper, "username").element.value).toBe("");
    expect(credentialInput(wrapper, "password").element.value).toBe("");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(wrapper.html()).not.toContain("new-test-password");
  });
  it("requires explicit credential replacement after a target change", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(configured()))
      .mockResolvedValueOnce(
        response(configured({ revision: 2, host: "other.example.invalid" })),
      );
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await flushPromises();
    await wrapper.find('[name="host"]').setValue("other.example.invalid");
    await wrapper.find('[data-testid="smtp-form"]').trigger("submit");
    await flushPromises();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("必须重新填写账号和密码");
    await credentialInput(wrapper, "username").setValue("replacement-account");
    await wrapper.find('[data-testid="smtp-form"]').trigger("submit");
    await flushPromises();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await credentialInput(wrapper, "password").setValue("replacement-password");
    await wrapper.find('[data-testid="smtp-form"]').trigger("submit");
    await flushPromises();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("supports explicit clearing only with a disabled configuration and never combines clear with replacement", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(configured()))
      .mockResolvedValueOnce(
        response(
          configured({
            revision: 2,
            enabled: false,
            username_configured: false,
            password_configured: false,
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await flushPromises();
    await credentialInput(wrapper, "username").setValue("discard-me");
    await credentialInput(wrapper, "password").setValue("discard-me-too");
    await wrapper.find('[name="clear_username"]').setValue(true);
    await wrapper.find('[name="clear_password"]').setValue(true);
    await wrapper.find('[data-testid="smtp-form"]').trigger("submit");
    await flushPromises();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await wrapper.find('[name="enabled"]').setValue(false);
    await wrapper.find('[data-testid="smtp-form"]').trigger("submit");
    await flushPromises();
    const body = JSON.parse(fetcher.mock.calls[1]![1].body);
    expect(body).toMatchObject({
      enabled: false,
      clear_username: true,
      clear_password: true,
    });
    expect(body).not.toHaveProperty("username");
    expect(body).not.toHaveProperty("password");
  });
  it("renders user-controlled configuration only as input text without links or HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response(
          configured({
            host: "javascript:alert(1)",
            from_name: '<img src=x onerror="alert(1)">',
          }),
        ),
      ),
    );
    const wrapper = panel();
    await flushPromises();
    expect(wrapper.find<HTMLInputElement>('[name="host"]').element.value).toBe(
      "javascript:alert(1)",
    );
    expect(wrapper.find("img, a[href], script").exists()).toBe(false);
  });
  it("requires a complete credential pair even for a disabled draft", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response(
        configured({
          enabled: false,
          username_configured: false,
          password_configured: false,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await flushPromises();
    await credentialInput(wrapper, "username").setValue("only-one-credential");
    await wrapper.find('[data-testid="smtp-form"]').trigger("submit");
    await flushPromises();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("账号和密码必须成对配置或同时清除");
  });
});

describe("SMTP field feedback", () => {
  it.each(["zh-CN", "en"] as const)(
    "focuses and associates a UTF-8 sender-name overflow in %s, then accepts the exact boundary",
    async (language) => {
      setLocale(language);
      const boundary = "中".repeat(40);
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(response(configured()))
        .mockResolvedValueOnce(
          response(configured({ revision: 2, from_name: boundary })),
        );
      vi.stubGlobal("fetch", fetcher);
      const wrapper = panel();
      await flushPromises();
      const name = wrapper.get('[name="from_name"]');
      await name.setValue("中".repeat(41));
      await wrapper.get('[data-testid="smtp-form"]').trigger("submit");
      await flushPromises();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(name.attributes("aria-invalid")).toBe("true");
      expect(name.attributes("aria-describedby")).toBe("smtp-from-name-error");
      expect(
        document.getElementById("smtp-from-name-error")?.textContent,
      ).toContain("120");
      expect(document.activeElement).toBe(name.element);
      expect(wrapper.get('[role="alert"]').text()).toContain(
        language === "zh-CN" ? "标注的字段" : "highlighted fields",
      );
      expect(
        wrapper.get('[name="from_address"]').attributes("aria-invalid"),
      ).toBe("false");
      expect(
        wrapper.get('[name="from_address"]').attributes("aria-describedby"),
      ).toBeUndefined();
      await name.setValue(boundary);
      expect(name.attributes("aria-invalid")).toBe("false");
      expect(name.attributes("aria-describedby")).toBeUndefined();
      expect(document.getElementById("smtp-from-name-error")).toBeNull();
      await wrapper.get('[data-testid="smtp-form"]').trigger("submit");
      await flushPromises();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({
        enabled: true,
        host: "smtp.example.invalid",
        port: 587,
        tls_mode: "starttls",
        from_address: "billing@example.invalid",
        from_name: boundary,
        revision: 1,
      });
    },
  );

  it.each([
    ["host", "smtp.example.invalid\u007f", "smtp-host-error"],
    ["port", "65536", "smtp-port-error"],
    ["username", "中".repeat(85), "smtp-username-error"],
    ["password", "中".repeat(342), "smtp-password-error"],
    ["from_address", "not-an-address", "smtp-from-address-error"],
  ])(
    "identifies invalid %s without posting or exposing its value",
    async (field, value, errorId) => {
      const fetcher = vi.fn().mockResolvedValue(response(configured()));
      vi.stubGlobal("fetch", fetcher);
      const wrapper = panel();
      await flushPromises();
      const input = wrapper.get(`[name="${field}"]`);
      await input.setValue(value);
      await wrapper.get('[data-testid="smtp-form"]').trigger("submit");
      await flushPromises();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(input.attributes("aria-invalid")).toBe("true");
      expect(input.attributes("aria-describedby")).toBe(errorId);
      expect(document.getElementById(errorId!)?.textContent).toBeTruthy();
      expect(document.getElementById(errorId!)?.textContent).not.toContain(
        value,
      );
      expect(document.activeElement).toBe(input.element);
      expect(wrapper.findAll('[aria-invalid="true"]')).toHaveLength(1);
    },
  );

  it("focuses the first invalid field in form order when several fields fail", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(configured()));
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await flushPromises();
    await wrapper.get('[name="host"]').setValue("bad\u007fhost");
    await wrapper.get('[name="from_name"]').setValue("中".repeat(41));
    await wrapper.get('[data-testid="smtp-form"]').trigger("submit");
    await flushPromises();
    expect(wrapper.findAll('[aria-invalid="true"]')).toHaveLength(2);
    expect(document.activeElement).toBe(wrapper.get('[name="host"]').element);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["host", "other.example.invalid"],
    ["port", "465"],
    ["tls_mode", "implicit_tls"],
  ])(
    "requires and focuses both replacement credentials when %s changes",
    async (field, value) => {
      const changed = {
        ...configured(),
        [field!]: field === "port" ? Number(value) : value,
      };
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(response(configured()))
        .mockResolvedValueOnce(response({ ...changed, revision: 2 }));
      vi.stubGlobal("fetch", fetcher);
      const wrapper = panel();
      await flushPromises();
      await wrapper.get(`[name="${field}"]`).setValue(value);
      await wrapper.get('[data-testid="smtp-form"]').trigger("submit");
      await flushPromises();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(
        credentialInput(wrapper, "username").element,
      );
      expect(
        credentialInput(wrapper, "username").attributes("aria-describedby"),
      ).toBe("smtp-username-error");
      await credentialInput(wrapper, "username").setValue(
        "replacement-account",
      );
      await wrapper.get('[data-testid="smtp-form"]').trigger("submit");
      await flushPromises();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(
        credentialInput(wrapper, "password").element,
      );
      await credentialInput(wrapper, "password").setValue(
        "replacement-password",
      );
      await wrapper.get('[data-testid="smtp-form"]').trigger("submit");
      await flushPromises();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toMatchObject({
        revision: 1,
        [field!]: field === "port" ? Number(value) : value,
        username: "replacement-account",
        password: "replacement-password",
      });
      expect(credentialInput(wrapper, "username").element.value).toBe("");
      expect(credentialInput(wrapper, "password").element.value).toBe("");
    },
  );

  it("focuses the missing credential for a pair and actionable controls for clearing", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response(
        configured({
          enabled: false,
          username_configured: false,
          password_configured: false,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await flushPromises();
    await credentialInput(wrapper, "username").setValue(
      "private-draft-account",
    );
    await wrapper.get('[data-testid="smtp-form"]').trigger("submit");
    await flushPromises();
    expect(document.activeElement).toBe(
      credentialInput(wrapper, "password").element,
    );
    expect(wrapper.get("#smtp-password-error").text()).not.toContain(
      "private-draft-account",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "focuses an enabled corrective control when clearing saved credentials (target changed: %s)",
    async (changeTarget) => {
      const fetcher = vi.fn().mockResolvedValue(response(configured()));
      vi.stubGlobal("fetch", fetcher);
      const wrapper = panel();
      await flushPromises();
      if (changeTarget)
        await wrapper.get('[name="host"]').setValue("other.example.invalid");
      await wrapper.get('[name="clear_password"]').setValue(true);
      await wrapper.get('[data-testid="smtp-form"]').trigger("submit");
      await flushPromises();
      expect(credentialInput(wrapper, "password").element.disabled).toBe(true);
      expect(
        (document.activeElement as HTMLInputElement).matches(":disabled"),
      ).toBe(false);
      expect(document.activeElement?.getAttribute("name")).toBe(
        changeTarget ? "username" : "clear_password",
      );
      await wrapper.get('[name="clear_username"]').setValue(true);
      await wrapper.get('[data-testid="smtp-form"]').trigger("submit");
      await flushPromises();
      expect(document.activeElement).toBe(
        wrapper.get('[name="enabled"]').element,
      );
      expect(
        wrapper.get('[name="enabled"]').attributes("aria-describedby"),
      ).toBe("smtp-enabled-error");
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("saves an endpoint change only after disabling and explicitly clearing both credentials", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(configured()))
      .mockResolvedValueOnce(
        response(
          configured({
            revision: 2,
            enabled: false,
            host: "other.example.invalid",
            username_configured: false,
            password_configured: false,
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await flushPromises();
    await wrapper.get('[name="host"]').setValue("other.example.invalid");
    await wrapper.get('[name="clear_username"]').setValue(true);
    await wrapper.get('[name="clear_password"]').setValue(true);
    await wrapper.get('[name="enabled"]').setValue(false);
    await wrapper.get('[data-testid="smtp-form"]').trigger("submit");
    await flushPromises();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({
      enabled: false,
      host: "other.example.invalid",
      port: 587,
      tls_mode: "starttls",
      from_address: "billing@example.invalid",
      from_name: "Example sender",
      revision: 1,
      clear_username: true,
      clear_password: true,
    });
    expect(fetcher.mock.calls.every(([path]) => !path.endsWith("/test"))).toBe(
      true,
    );
  });

  it.each(["zh-CN", "en"] as const)(
    "keeps generic server rejection safe and unmarked in %s",
    async (language) => {
      setLocale(language);
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(response(configured()))
        .mockResolvedValueOnce(failure("INVALID_EMAIL_SETTINGS"));
      vi.stubGlobal("fetch", fetcher);
      const wrapper = panel();
      await flushPromises();
      await wrapper.get('[name="from_name"]').setValue("Retained draft");
      await credentialInput(wrapper, "password").setValue(
        "private-draft-password",
      );
      await wrapper.get('[data-testid="smtp-form"]').trigger("submit");
      await flushPromises();
      const alert = wrapper.get('[role="alert"]').text();
      expect(alert).toContain(
        language === "zh-CN" ? "服务器未接受" : "The server did not accept",
      );
      expect(alert).not.toMatch(/标注|highlighted|sensitive|private-draft/);
      expect(wrapper.findAll('[aria-invalid="true"]')).toHaveLength(0);
      expect(
        wrapper.get<HTMLInputElement>('[name="from_name"]').element.value,
      ).toBe("Retained draft");
      expect(credentialInput(wrapper, "password").element.value).toBe("");
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it("associates an invalid test recipient and focuses it without sending", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(configured()));
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await flushPromises();
    const recipient = wrapper.get('[name="recipient"]');
    await recipient.setValue("invalid-recipient");
    await wrapper.get('[data-testid="smtp-test-form"]').trigger("submit");
    await flushPromises();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(recipient.element);
    expect(recipient.attributes("aria-invalid")).toBe("true");
    expect(recipient.attributes("aria-describedby")).toBe(
      "smtp-recipient-error",
    );
    expect(wrapper.get("#smtp-recipient-error").text()).toContain(
      "有效的收件邮箱",
    );
    await recipient.setValue("recipient@example.invalid");
    expect(recipient.attributes("aria-invalid")).toBe("false");
    expect(recipient.attributes("aria-describedby")).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("SMTP state and safe failure handling", () => {
  it("preserves the non-secret draft after a conflict, clears typed secrets and requires an explicit reload", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(configured()))
      .mockResolvedValueOnce(failure("SETTINGS_CONFLICT", 409))
      .mockResolvedValueOnce(
        response(configured({ revision: 3, from_name: "Server version" })),
      );
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await flushPromises();
    await wrapper.find('[name="from_name"]').setValue("Draft sender");
    await credentialInput(wrapper, "password").setValue("typed-secret");
    await wrapper.find('[data-testid="smtp-form"]').trigger("submit");
    await flushPromises();
    expect(
      wrapper.find<HTMLInputElement>('[name="from_name"]').element.value,
    ).toBe("Draft sender");
    expect(credentialInput(wrapper, "password").element.value).toBe("");
    expect(wrapper.text()).toContain("配置已被其他管理员修改");
    expect(wrapper.html()).not.toMatch(/sensitive-provider|sensitive-request/);
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    expect(sendButton(wrapper).attributes("disabled")).toBeDefined();
    await wrapper.find('[data-testid="smtp-form"]').trigger("submit");
    expect(fetcher).toHaveBeenCalledTimes(2);
    await reloadButton(wrapper).trigger("click");
    await flushPromises();
    expect(
      wrapper.find<HTMLInputElement>('[name="from_name"]').element.value,
    ).toBe("Server version");
    expect(wrapper.text()).toContain("版本 3");
  });
  it("blocks automatic save retries after an uncertain response", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(configured()))
      .mockRejectedValueOnce(new Error("provider-password-must-not-render"));
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await flushPromises();
    await credentialInput(wrapper, "password").setValue("typed-secret");
    await wrapper.find('[data-testid="smtp-form"]').trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("无法确认保存结果");
    expect(wrapper.text()).not.toContain("provider-password");
    expect(credentialInput(wrapper, "password").element.value).toBe("");
    await wrapper.find('[data-testid="smtp-form"]').trigger("submit");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("blocks duplicate saves, reload and test sending while a save is pending", async () => {
    let finish: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(configured()))
      .mockReturnValueOnce(pending);
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await flushPromises();
    await wrapper.find('[name="from_name"]').setValue("New sender");
    await wrapper.find('[data-testid="smtp-form"]').trigger("submit");
    expect(wrapper.find("fieldset").attributes("disabled")).toBeDefined();
    expect(reloadButton(wrapper).attributes("disabled")).toBeDefined();
    expect(sendButton(wrapper).attributes("disabled")).toBeDefined();
    await wrapper.find('[data-testid="smtp-form"]').trigger("submit");
    expect(fetcher).toHaveBeenCalledTimes(2);
    finish(response(configured({ revision: 2, from_name: "New sender" })));
    await flushPromises();
    expect(wrapper.text()).toContain("SMTP 配置已保存");
  });
  it("preserves dirty values on refresh and language change without fetching or exposing credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(configured()));
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await flushPromises();
    await credentialInput(wrapper, "username").setValue(
      "private-draft-account",
    );
    await wrapper.setProps({ refreshToken: 1 });
    setLocale("en");
    await flushPromises();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(credentialInput(wrapper, "username").element.value).toBe(
      "private-draft-account",
    );
    expect(wrapper.text()).toContain("Your pending changes were kept");
    expect(wrapper.text()).toContain("SMTP account");
    expect(localStorage.getItem("aster.locale")).toBe("en");
    expect(JSON.stringify(localStorage)).not.toContain("private-draft-account");
  });
  it("ignores a late load after switching into preview and never writes in preview", async () => {
    let finish: (value: unknown) => void = () => {};
    const fetcher = vi.fn().mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await wrapper.setProps({ preview: true });
    await flushPromises();
    finish(response(configured()));
    await flushPromises();
    expect(wrapper.text()).toContain("样例预览");
    expect(wrapper.find<HTMLInputElement>('[name="host"]').element.value).toBe(
      "",
    );
    await wrapper.find('[data-testid="smtp-form"]').trigger("submit");
    await wrapper.find('[data-testid="smtp-test-form"]').trigger("submit");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("saved SMTP test messages", () => {
  it.each([
    { enabled: false },
    { key_configured: false },
    { plugin_available: false },
    { destination_allowed: false },
    { password_configured: false },
  ])(
    "does not send with unavailable saved configuration %j",
    async (changes) => {
      const fetcher = vi.fn().mockResolvedValue(response(configured(changes)));
      vi.stubGlobal("fetch", fetcher);
      const wrapper = panel();
      await flushPromises();
      await wrapper
        .find('[name="recipient"]')
        .setValue("recipient@example.invalid");
      expect(sendButton(wrapper).attributes("disabled")).toBeDefined();
      await wrapper.find('[data-testid="smtp-test-form"]').trigger("submit");
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("sends only the saved revision and recipient with CSRF and describes acceptance accurately", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(configured()))
      .mockResolvedValueOnce(
        response({
          status: "accepted",
          diagnostic: "secret-that-must-not-render",
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await flushPromises();
    await wrapper
      .find('[name="recipient"]')
      .setValue("recipient@example.invalid");
    await wrapper.find('[data-testid="smtp-test-form"]').trigger("submit");
    await flushPromises();
    expect(fetcher.mock.calls[1]![0]).toBe("/api/v1/admin/email-settings/test");
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({
      revision: 1,
      to: "recipient@example.invalid",
    });
    expect(fetcher.mock.calls[1]![1].headers["X-CSRF-Token"]).toBe(
      "smtp-test-csrf",
    );
    expect(wrapper.text()).toContain("SMTP 服务器已接受测试邮件");
    expect(wrapper.text()).toContain("不保证最终送达");
    expect(wrapper.html()).not.toContain("secret-that-must-not-render");
  });
  it("does not send unsaved settings or duplicate a pending test", async () => {
    let finish: (value: unknown) => void = () => {};
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(configured()))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await flushPromises();
    await wrapper
      .find('[name="recipient"]')
      .setValue("recipient@example.invalid");
    await wrapper.find('[name="from_name"]').setValue("Unsaved");
    await wrapper.find('[data-testid="smtp-test-form"]').trigger("submit");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await wrapper.find('[name="from_name"]').setValue("Example sender");
    await wrapper.find('[data-testid="smtp-test-form"]').trigger("submit");
    await wrapper.find('[data-testid="smtp-test-form"]').trigger("submit");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(wrapper.find("fieldset").attributes("disabled")).toBeDefined();
    finish(response({ status: "accepted" }));
    await flushPromises();
  });
  it("does not automatically resend after an uncertain result and requires explicit acknowledgement", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(configured()))
      .mockResolvedValueOnce(failure("SMTP_DELIVERY_UNCERTAIN", 502))
      .mockResolvedValueOnce(response({ status: "accepted" }));
    vi.stubGlobal("fetch", fetcher);
    const wrapper = panel();
    await flushPromises();
    await wrapper
      .find('[name="recipient"]')
      .setValue("recipient@example.invalid");
    await wrapper.find('[data-testid="smtp-test-form"]').trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("再次发送可能产生重复邮件");
    expect(wrapper.html()).not.toContain("sensitive-provider");
    expect(sendButton(wrapper).attributes("disabled")).toBeDefined();
    await wrapper.find('[data-testid="smtp-test-form"]').trigger("submit");
    expect(fetcher).toHaveBeenCalledTimes(2);
    await wrapper.find(".smtp-test .text-button").trigger("click");
    expect(fetcher).toHaveBeenCalledTimes(2);
    await wrapper.find('[data-testid="smtp-test-form"]').trigger("submit");
    await flushPromises();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("treats a malformed successful response as uncertain rather than claiming delivery", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(configured()))
        .mockResolvedValueOnce(
          response({ status: "delivered", detail: "raw-provider-secret" }),
        ),
    );
    const wrapper = panel();
    await flushPromises();
    await wrapper
      .find('[name="recipient"]')
      .setValue("recipient@example.invalid");
    await wrapper.find('[data-testid="smtp-test-form"]').trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("无法确认邮件是否已被接受");
    expect(wrapper.text()).not.toContain("SMTP 服务器已接受测试邮件");
    expect(wrapper.html()).not.toContain("raw-provider-secret");
  });
});

describe("SMTP integration and account boundaries", () => {
  const smtp: IntegrationSummary = {
    ...previewIntegrations[1]!,
    id: "email.smtp",
    name: "Official SMTP",
    configuration_mode: "admin_api",
  };
  it("opens the SMTP configuration within the extension center and preserves drafts through manifest refresh", async () => {
    const fetcher = vi.fn(async (path: string) =>
      response(
        path.endsWith("/admin/integrations") ? { items: [smtp] } : configured(),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const wrapper = mount(IntegrationsPage, {
      props: { preview: false, refreshToken: 0 },
    });
    wrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.find(".smtp-settings").exists()).toBe(true);
    await credentialInput(wrapper, "password").setValue("retained-draft");
    await wrapper.setProps({ refreshToken: 1 });
    await flushPromises();
    expect(credentialInput(wrapper, "password").element.value).toBe(
      "retained-draft",
    );
    expect(
      fetcher.mock.calls.filter((call) =>
        call[0].endsWith("/admin/email-settings"),
      ),
    ).toHaveLength(1);
    await wrapper.find('[aria-label="配置 SMTP"]').trigger("click");
    expect(wrapper.find("dialog").attributes("open")).toBeUndefined();
  });
  it("discards old credentials and late responses on administrator changes, then removes the panel on logout", async () => {
    const user = {
      id: "admin-one",
      name: "First admin",
      email: "admin@example.invalid",
      role: "admin" as const,
    };
    const session: Session = { user, csrf_token: "csrf", demo_mode: false };
    let finishSave: (value: unknown) => void = () => {};
    const pendingSave = new Promise((resolve) => {
      finishSave = resolve;
    });
    const fetcher = vi.fn(async (path: string, options: RequestInit) => {
      if (path.endsWith("/site-settings")) return response(defaultSiteSettings);
      if (path.endsWith("/currencies"))
        return response(defaultCurrencyRegistry);
      if (path.endsWith("/session")) return response(session);
      if (path.endsWith("/admin/integrations"))
        return response({ items: [smtp] });
      if (path.endsWith("/admin/email-settings"))
        return options.method === "POST" ? pendingSave : response(configured());
      if (path.includes("/admin/overview"))
        return response({
          customers: 1,
          total_services: 0,
          unpaid_invoices: 0,
          unpaid_total_minor: 0,
          revenue_minor: 0,
          currency: "CNY",
        });
      return response([]);
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
    wrappers.push(wrapper);
    await flushPromises();
    const firstPanel = wrapper.findComponent(EmailSettingsPanel);
    await credentialInput(wrapper, "username").setValue("first-admin-account");
    await credentialInput(wrapper, "password").setValue("first-admin-password");
    await wrapper
      .find('[name="from_name"]')
      .setValue("First administrator draft");
    await wrapper.find('[data-testid="smtp-form"]').trigger("submit");
    const state = (
      wrapper.vm.$ as unknown as { setupState: { session: Session } }
    ).setupState;
    state.session = {
      ...session,
      user: { ...user, id: "admin-two", name: "Second admin" },
    };
    await flushPromises();
    expect(firstPanel.exists()).toBe(false);
    expect(credentialInput(wrapper, "username").element.value).toBe("");
    expect(credentialInput(wrapper, "password").element.value).toBe("");
    finishSave(
      response(configured({ revision: 2, from_name: "Old late response" })),
    );
    await flushPromises();
    expect(
      wrapper.find<HTMLInputElement>('[name="from_name"]').element.value,
    ).toBe("Example sender");
    expect(wrapper.text()).not.toContain("SMTP 配置已保存");
    expect(
      fetcher.mock.calls.filter(
        (call) =>
          call[0].endsWith("/admin/email-settings") && call[1].method === "GET",
      ),
    ).toHaveLength(2);
    state.session = { ...session, user: null };
    await flushPromises();
    expect(wrapper.find(".smtp-settings").exists()).toBe(false);
    expect(wrapper.html()).not.toContain("first-admin-password");
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import App from "../src/App.vue";
import { defaultCurrencyRegistry } from "../src/lib/currencies";
import { restorePreferences, setLocale, type Locale } from "../src/lib/i18n";
import { previewUser } from "../src/lib/preview";
import { defaultSiteSettings } from "../src/lib/settings";
import { setCsrf } from "../src/lib/api";

type Reply = { ok: boolean; status: number; json: () => Promise<unknown> };
const success = (data: unknown): Reply => ({
  ok: true,
  status: 200,
  json: async () => ({ data }),
});
const messages = {
  INVALID_CREDENTIALS: {
    "zh-CN": "邮箱或密码不正确",
    en: "The email address or password is incorrect.",
  },
  RATE_LIMITED: {
    "zh-CN": "尝试次数过多，请稍后再试",
    en: "Too many attempts. Please try again later.",
  },
} as const;
type LoginCode = keyof typeof messages;
function failure(code: LoginCode, language: Locale, requestId: string): Reply {
  return {
    ok: false,
    status: code === "RATE_LIMITED" ? 429 : 401,
    json: async () => ({
      error: { code, message: messages[code][language], request_id: requestId },
    }),
  };
}
function errorText(code: LoginCode, language: Locale, requestId: string) {
  return (
    messages[code][language] +
    (language === "en" ? " · Request ID " : " · 请求编号 ") +
    requestId
  );
}
const networkText = {
  "zh-CN": "无法连接服务器。请检查网络，或稍后重试。",
  en: "Cannot connect to the server. Check your connection and try again.",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
const anonymousSession = () => ({
  user: null,
  csrf_token: "synthetic-login-csrf",
  demo_mode: false,
});
const authenticatedSession = () => ({
  ...anonymousSession(),
  user: { ...previewUser },
});
let sessionReply: () => Reply | Promise<Reply>;
let loginReply: () => Reply | Promise<Reply>;
let requests: { path: string; options: RequestInit }[];
let wrappers: VueWrapper[];

async function mountApp() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }],
  });
  await router.push("/overview");
  const wrapper = mount(App, {
    global: { plugins: [router] },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}
async function changeLanguage(wrapper: VueWrapper, language: Locale) {
  await wrapper.get(".preference-controls select").setValue(language);
  await flushPromises();
}
async function submitLogin(wrapper: VueWrapper) {
  await wrapper.get("#email").setValue("synthetic@example.invalid");
  await wrapper.get("#password").setValue("synthetic-password");
  await wrapper.get(".login-card form").trigger("submit");
  await flushPromises();
}
function expectSaving(wrapper: VueWrapper) {
  expect(wrapper.get(".login-submit").attributes("disabled")).toBeDefined();
  expect(wrapper.get("#email").attributes("disabled")).toBeDefined();
  expect(wrapper.get("#password").attributes("disabled")).toBeDefined();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
}

beforeEach(() => {
  localStorage.clear();
  restorePreferences();
  setCsrf("");
  requests = [];
  wrappers = [];
  sessionReply = () => success(anonymousSession());
  loginReply = () => failure("INVALID_CREDENTIALS", "zh-CN", "login-first");
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options: RequestInit) => {
      const endpoint = path.replace("/api/v1", "");
      requests.push({ path: endpoint, options });
      if (endpoint === "/site-settings") return success(defaultSiteSettings);
      if (endpoint === "/currencies")
        return success(structuredClone(defaultCurrencyRegistry));
      if (endpoint === "/session") return sessionReply();
      if (endpoint === "/auth/login") return loginReply();
      if (endpoint === "/overview?currency=CNY")
        return success({
          currency: "CNY",
          active_services: 0,
          pending_invoices: 0,
          unpaid_total_minor: 0,
          monthly_total_minor: 0,
          recent_orders: [],
        });
      if (
        [
          "/services",
          "/plans?currency=CNY",
          "/orders",
          "/invoices",
          "/audit",
        ].includes(endpoint)
      )
        return success([]);
      throw new Error("Unexpected synthetic endpoint: " + endpoint);
    }),
  );
});
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  localStorage.clear();
  restorePreferences();
  setCsrf("");
});

describe("login error language and request lifecycle", () => {
  it("updates an initialization network error from Chinese to English and back without requests", async () => {
    sessionReply = () => {
      throw new TypeError("synthetic disconnected transport");
    };
    const wrapper = await mountApp();
    expect(wrapper.get('[role="alert"]').text()).toBe(networkText["zh-CN"]);
    expect(wrapper.get(".login-submit").attributes("disabled")).toBeDefined();
    const count = requests.length;
    for (const language of ["en", "zh-CN"] as const) {
      await changeLanguage(wrapper, language);
      expect(wrapper.get('[role="alert"]').text()).toBe(networkText[language]);
      expect(requests).toHaveLength(count);
    }
  });

  it.each([
    { code: "INVALID_CREDENTIALS", initial: "zh-CN", other: "en" },
    { code: "RATE_LIMITED", initial: "en", other: "zh-CN" },
  ] as const)(
    "updates $code in both directions and preserves its request ID",
    async ({ code, initial, other }) => {
      setLocale(initial);
      const requestId = "synthetic-" + code.toLowerCase();
      loginReply = () => failure(code, initial, requestId);
      const wrapper = await mountApp();
      await submitLogin(wrapper);
      expect(wrapper.get('[role="alert"]').text()).toBe(
        errorText(code, initial, requestId),
      );
      const count = requests.length;
      const login = requests.find((request) => request.path === "/auth/login")!;
      expect(login.options.headers).toMatchObject({
        "Accept-Language": initial,
      });
      for (const language of [other, initial]) {
        await changeLanguage(wrapper, language);
        expect(wrapper.get('[role="alert"]').text()).toBe(
          errorText(code, language, requestId),
        );
        expect(requests).toHaveLength(count);
      }
    },
  );

  it("clears a login alert during retry and keeps saving while language changes until a localized failure", async () => {
    const wrapper = await mountApp();
    await submitLogin(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toContain("login-first");
    const pending = deferred<Reply>();
    loginReply = () => pending.promise;
    await wrapper.get(".login-card form").trigger("submit");
    await flushPromises();
    expectSaving(wrapper);
    const count = requests.length;
    await changeLanguage(wrapper, "en");
    expectSaving(wrapper);
    expect(wrapper.get(".login-submit").text()).toBe("Signing in…");
    await wrapper.get(".login-card form").trigger("submit");
    await flushPromises();
    expect(requests).toHaveLength(count);
    pending.resolve(failure("RATE_LIMITED", "zh-CN", "login-retry-id"));
    await flushPromises();
    expect(wrapper.get(".login-submit").attributes("disabled")).toBeUndefined();
    expect(wrapper.get('[role="alert"]').text()).toBe(
      errorText("RATE_LIMITED", "en", "login-retry-id"),
    );
    await changeLanguage(wrapper, "zh-CN");
    expect(wrapper.get('[role="alert"]').text()).toBe(
      errorText("RATE_LIMITED", "zh-CN", "login-retry-id"),
    );
    expect(requests).toHaveLength(count);
  });

  it("clears a previous login error and enters the workspace after a successful retry", async () => {
    const wrapper = await mountApp();
    await submitLogin(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toContain("login-first");
    const pending = deferred<Reply>();
    loginReply = () => pending.promise;
    await wrapper.get(".login-card form").trigger("submit");
    await flushPromises();
    expectSaving(wrapper);
    sessionReply = () => success(authenticatedSession());
    pending.resolve(success({ user: { ...previewUser } }));
    await flushPromises();
    expect(wrapper.find(".app-shell").exists()).toBe(true);
    expect(wrapper.find(".login-shell").exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("login-first");
    expect(
      requests.filter((request) => request.path === "/auth/login"),
    ).toHaveLength(2);
  });

  it("clears the initialization alert while booting and reconnects into the workspace without a language-triggered request", async () => {
    sessionReply = () => {
      throw new TypeError("synthetic disconnected transport");
    };
    const wrapper = await mountApp();
    expect(wrapper.get('[role="alert"]').text()).toBe(networkText["zh-CN"]);
    const pending = deferred<Reply>();
    sessionReply = () => pending.promise;
    await wrapper.get(".login-card .text-button").trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get(".boot-screen[role=status]").text()).toContain(
      "正在连接工作台…",
    );
    const count = requests.length;
    setLocale("en");
    await flushPromises();
    expect(wrapper.get(".boot-screen[role=status]").text()).toContain(
      "Connecting to the console…",
    );
    expect(requests).toHaveLength(count);
    pending.resolve(success(authenticatedSession()));
    await flushPromises();
    expect(wrapper.find(".app-shell").exists()).toBe(true);
    expect(wrapper.find(".boot-screen").exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(
      requests.filter((request) => request.path === "/auth/login"),
    ).toHaveLength(0);
  });

  it("shows a reconnect failure in the language selected while booting and retains the request ID", async () => {
    sessionReply = () => {
      throw new TypeError("synthetic disconnected transport");
    };
    const wrapper = await mountApp();
    const pending = deferred<Reply>();
    sessionReply = () => pending.promise;
    await wrapper.get(".login-card .text-button").trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    const count = requests.length;
    setLocale("en");
    await flushPromises();
    expect(requests).toHaveLength(count);
    pending.resolve(failure("RATE_LIMITED", "zh-CN", "reconnect-retry-id"));
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe(
      errorText("RATE_LIMITED", "en", "reconnect-retry-id"),
    );
    expect(wrapper.get(".login-submit").attributes("disabled")).toBeDefined();
    await changeLanguage(wrapper, "zh-CN");
    expect(wrapper.get('[role="alert"]').text()).toBe(
      errorText("RATE_LIMITED", "zh-CN", "reconnect-retry-id"),
    );
    expect(requests).toHaveLength(count);
  });

  it("uses a safe bilingual fallback for an unknown API code and preserves its request ID", async () => {
    const rawMessage = "synthetic-server-message-must-not-be-shown";
    const rawDetail = "synthetic-detail-must-not-be-shown";
    loginReply = () => ({
      ok: false,
      status: 503,
      json: async () => ({
        error: {
          code: "constructor",
          message: rawMessage,
          request_id: "synthetic-unknown-id",
          details: { reason: rawDetail },
        },
      }),
    });
    const wrapper = await mountApp();
    await submitLogin(wrapper);
    const count = requests.length;
    for (const language of ["zh-CN", "en", "zh-CN"] as const) {
      await changeLanguage(wrapper, language);
      expect(wrapper.get('[role="alert"]').text()).toBe(
        language === "en"
          ? "Unable to complete the request. Try again later; contact your provider if the problem continues. · Request ID synthetic-unknown-id"
          : "暂时无法完成请求，请稍后重试；如果仍有问题，请联系服务提供方。 · 请求编号 synthetic-unknown-id",
      );
      expect(wrapper.text()).not.toContain(rawMessage);
      expect(wrapper.text()).not.toContain(rawDetail);
      expect(requests).toHaveLength(count);
    }
  });

  it.each([
    { name: "undefined", cause: undefined },
    { name: "null", cause: null },
  ])(
    "retains an initialization failure thrown as $name and clears it on explicit retry",
    async ({ cause }) => {
      sessionReply = () => Promise.reject(cause);
      const wrapper = await mountApp();
      expect(wrapper.get('[role="alert"]').text()).toBe(networkText["zh-CN"]);
      const count = requests.length;
      await changeLanguage(wrapper, "en");
      expect(wrapper.get('[role="alert"]').text()).toBe(networkText.en);
      expect(requests).toHaveLength(count);
      const pending = deferred<Reply>();
      sessionReply = () => pending.promise;
      await wrapper.get(".login-card .text-button").trigger("click");
      await flushPromises();
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(wrapper.find(".boot-screen[role=status]").exists()).toBe(true);
      expect(requests).toHaveLength(count + 3);
      setLocale("zh-CN");
      await flushPromises();
      expect(requests).toHaveLength(count + 3);
      pending.resolve(success(anonymousSession()));
      await flushPromises();
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(wrapper.find(".boot-screen").exists()).toBe(false);
      expect(
        wrapper.get(".login-submit").attributes("disabled"),
      ).toBeUndefined();
      expect(requests).toHaveLength(count + 3);
    },
  );
});

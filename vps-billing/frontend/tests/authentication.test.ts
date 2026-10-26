// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import App from "../src/App.vue";
import SignInPanel from "../src/components/SignInPanel.vue";
import { ApiError } from "../src/services/api";
import { useWorkspace } from "../src/composables/useWorkspace";

const state = vi.hoisted(() => ({ workspace: null as any }));
vi.mock("../src/composables/useWorkspace", async () => {
  const { computed, ref, shallowRef, watch } = await import("vue");
  const session = shallowRef<any>(null),
    mode = ref("api"),
    demoRole = ref("customer");
  const workspace = {
    session,
    mode,
    locale: ref("zh-CN"),
    currency: ref("CNY"),
    appearance: ref("dark"),
    reportCurrency: ref("CNY"),
    setLocale: vi.fn((value: string) => {
      workspace.locale.value = value;
    }),
    setAppearance: vi.fn((value: string) => {
      workspace.appearance.value = value;
    }),
    setPurchaseCurrency: vi.fn((value: string) => {
      workspace.currency.value = value;
    }),
    setReportCurrency: vi.fn((value: string) => {
      workspace.reportCurrency.value = value;
    }),
    applyCurrencyRegistry: vi.fn(() => true),
    applySiteDefaults: vi.fn(),
    generation: ref(0),
    role: computed(() =>
      mode.value === "demo"
        ? demoRole.value
        : (session.value?.user?.role ?? "customer"),
    ),
    sessionVerified: ref(false),
    sessionBusy: ref(false),
    sessionError: shallowRef(null),
    read: vi.fn(),
    write: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    refreshSession: vi.fn(),
    setMode: vi.fn((value: string) => {
      mode.value = value;
    }),
    setDemoRole: vi.fn(),
  };
  // Mirror the real composable's identity invalidation without inventing App-only state.
  watch(
    () =>
      `${mode.value}|${session.value?.user?.id ?? ""}|${workspace.role.value}`,
    () => {
      workspace.generation.value++;
    },
    { flush: "sync" },
  );
  state.workspace = workspace;
  return { useWorkspace: () => workspace };
});
const panel = defineComponent({
  props: ["open", "title", "busy", "kind", "anchor"],
  emits: ["close"],
  template:
    '<section v-if="open" role="dialog" :aria-label="title"><h2>{{title}}</h2><button aria-label="关闭面板" :disabled="busy" @click="$emit(\'close\')">关闭</button><slot/><footer><slot name="footer"/></footer></section>',
});
const user = {
  id: "a".repeat(32),
  name: "Auth test",
  email: "test@example.invalid",
  role: "customer",
};
const session = (role = "customer") => ({
  user: { ...user, role },
  csrf_token: "synthetic",
  demo_mode: false,
});
const publicSettings = () => ({
  default_locale: "zh-CN",
  default_currency: "CNY",
  site_name: "测试云",
  company_name: "",
  support_email: "",
  support_url: "",
  display_url: "",
  logo: "cloud",
  theme: "teal",
});
const publicCurrencies = () => ({
  revision: 1,
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
      precision_locked: false,
    },
    {
      code: "USD",
      name: "美元",
      prefix: "$",
      suffix: "",
      decimal_places: 2,
      enabled: true,
      sort_order: 1,
      precision_locked: false,
    },
    {
      code: "JPY",
      name: "日元",
      prefix: "¥",
      suffix: "",
      decimal_places: 0,
      enabled: false,
      sort_order: 2,
      precision_locked: false,
    },
  ],
});
async function publicRead(path: string) {
  if (path === "/currencies") return publicCurrencies();
  if (path === "/site-settings") return publicSettings();
  throw new ApiError("FORBIDDEN", 403);
}
let wrappers: VueWrapper[] = [];
const ws = () => state.workspace;
type ActionScope = Pick<VueWrapper, "findAll">;
const button = (wrapper: ActionScope, label: string) =>
  wrapper.findAll("button").find((b) => b.text() === label)!;
beforeEach(() => {
  ws().mode.value = "api";
  ws().session.value = null;
  ws().sessionVerified.value = false;
  ws().sessionBusy.value = false;
  ws().sessionError.value = null;
  ws().locale.value = "zh-CN";
  ws().currency.value = "CNY";
  ws().appearance.value = "dark";
  ws().reportCurrency.value = "CNY";
  ws().generation.value = 0;
  for (const key of [
    "read",
    "write",
    "signIn",
    "signOut",
    "refreshSession",
    "setMode",
    "setDemoRole",
  ])
    ws()[key].mockClear();
  for (const key of ["read", "write", "signIn", "signOut", "refreshSession"])
    ws()[key].mockReset();
  ws().read.mockImplementation(publicRead);
  ws().refreshSession.mockResolvedValue({
    user: null,
    csrf_token: "synthetic",
    demo_mode: false,
  });
  ws().signIn.mockResolvedValue(session());
  ws().signOut.mockResolvedValue({
    user: null,
    csrf_token: "synthetic",
    demo_mode: false,
  });
});
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers = [];
  document.body.innerHTML = "";
  delete document.documentElement.dataset.appearance;
  vi.useRealTimers();
});
async function shell(path: string) {
  // Deliberately capture once: reusing an old page instance would expose the prior owner's data.
  const privateView = defineComponent({
    setup: () => ({
      owner: useWorkspace().session.value?.user?.id ?? "anonymous",
    }),
    template: '<p data-private="true">Private record · {{owner}}</p>',
  });
  const publicView = defineComponent({
    template: '<p data-public="true">Public catalog</p>',
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/home", component: privateView },
      { path: "/catalog", component: publicView },
      ...["orders", "invoices", "services", "account", "audit"].map(
        (section) => ({ path: `/${section}`, component: privateView }),
      ),
      { path: "/admin/catalog", component: privateView },
      ...[
        "orders",
        "invoices",
        "services",
        "customers",
        "audit",
        "finance",
        "settings",
      ].map((section) => ({
        path: `/admin/${section}`,
        component: privateView,
      })),
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { plugins: [router], stubs: { OverlayPanel: panel } },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}
function signIn() {
  const wrapper = mount(SignInPanel, {
    props: { open: true, locale: "zh-CN" },
    global: { stubs: { OverlayPanel: panel } },
  });
  wrappers.push(wrapper);
  return wrapper;
}
async function fill(
  wrapper: VueWrapper,
  password = "  Exact password with spaces  ",
) {
  await wrapper.find("input[type=email]").setValue("LOCAL@example.invalid");
  await wrapper.find("input[autocomplete=current-password]").setValue(password);
}

describe("real authentication shell boundaries", () => {
  it("does not mount a private page for anonymous or unverified sessions and never shows demo admin", async () => {
    const wrapper = await shell("/orders");
    expect(wrapper.find("[data-private]").exists()).toBe(false);
    expect(button(wrapper, "登录").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("体验管理员");
    expect(
      ws()
        .read.mock.calls.map(([path]: [string]) => path)
        .sort(),
    ).toEqual(["/currencies", "/site-settings"]);
    expect(ws().write).not.toHaveBeenCalled();
  });
  it("keeps the public catalog available without mounting private views", async () => {
    const wrapper = await shell("/catalog");
    expect(wrapper.find("[data-public]").exists()).toBe(true);
    expect(wrapper.find("[data-private]").exists()).toBe(false);
  });
  it("shows a session failure with a recovery action, not a successful empty workspace", async () => {
    ws().sessionError.value = new ApiError("NETWORK_ERROR", 0, {
      locale: "zh-CN",
    });
    const wrapper = await shell("/home");
    expect(wrapper.text()).toContain("暂时无法连接，请重试");
    expect(button(wrapper, "重新连接").exists()).toBe(true);
    expect(wrapper.find("[data-private]").exists()).toBe(false);
    const reads = ws().refreshSession.mock.calls.length;
    await button(wrapper, "重新连接").trigger("click");
    await flushPromises();
    expect(ws().refreshSession).toHaveBeenCalledTimes(reads + 1);
    expect(wrapper.find("[data-private]").exists()).toBe(false);
  });
  it("unmounts private data immediately when an identity becomes unverified", async () => {
    ws().session.value = session();
    ws().sessionVerified.value = true;
    const wrapper = await shell("/orders");
    expect(wrapper.find("[data-private]").exists()).toBe(true);
    ws().session.value = null;
    ws().sessionVerified.value = false;
    await nextTick();
    expect(wrapper.find("[data-private]").exists()).toBe(false);
  });
  it("does not mount administrator routes for a valid customer session", async () => {
    ws().session.value = session();
    ws().sessionVerified.value = true;
    const wrapper = await shell("/admin/catalog");
    expect(wrapper.text()).toContain("需要管理员权限");
    expect(wrapper.find("[data-private]").exists()).toBe(false);
  });
  it("uses a confirmed public brand without fetching private company settings", async () => {
    const wrapper = await shell("/catalog");
    expect(wrapper.find(".brand").text()).toContain("测试云");
    expect(wrapper.find(".workspace-footer").text()).toBe("测试云");
    expect(document.title).toContain("测试云");
    expect(
      ws().read.mock.calls.every(([path]: [string]) =>
        ["/currencies", "/site-settings"].includes(path),
      ),
    ).toBe(true);
    expect(wrapper.find("[data-private]").exists()).toBe(false);
  });
  it("keeps the neutral fallback after a public-settings failure, without claiming a saved brand", async () => {
    document.title = "旧租户 · 不应残留";
    ws().read.mockImplementation(async (path: string) =>
      path === "/site-settings"
        ? Promise.reject(new ApiError("NETWORK_ERROR"))
        : publicRead(path),
    );
    const wrapper = await shell("/catalog");
    expect(wrapper.find(".brand").text()).toContain("AetherGrid");
    expect(wrapper.find(".brand").text()).not.toContain("测试云");
    expect(wrapper.find(".workspace-footer").text()).toBe("AetherGrid");
    expect(document.title).not.toContain("旧租户");
    expect(wrapper.find("[data-public]").exists()).toBe(true);
    expect(wrapper.find("[data-private]").exists()).toBe(false);
  });
  it("does not use a missing or invalid public site name as a successful brand", async () => {
    ws().read.mockImplementation(async (path: string) =>
      path === "/site-settings"
        ? { ...publicSettings(), site_name: 42 }
        : publicRead(path),
    );
    const wrapper = await shell("/catalog");
    expect(wrapper.find(".brand").text()).toContain("AetherGrid");
    expect(wrapper.find(".brand").text()).not.toContain("42");
    expect(wrapper.find("[data-public]").exists()).toBe(true);
  });
});

const dialog = (wrapper: VueWrapper, title: string) =>
  wrapper.get(`[role="dialog"][aria-label="${title}"]`);
const action = (wrapper: ActionScope, label: string) =>
  wrapper.findAll("button,a").find((element) => element.text() === label)!;
const authenticated = (role = "customer") => {
  ws().session.value = session(role);
  ws().sessionVerified.value = true;
};
async function chooseOption(
  control: ReturnType<VueWrapper["get"]>,
  text: string,
) {
  await control.trigger("click");
  await nextTick();
  const option = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((element) => element.textContent?.includes(text));
  expect(option, `available option ${text}`).toBeTruthy();
  option!.click();
  await nextTick();
}

describe("separate language/currency and account responsibilities", () => {
  it("has one shared topbar entry and opens only the two real language and currency controls", async () => {
    authenticated();
    const wrapper = await shell("/home");
    expect(wrapper.findAll('button[aria-label="语言与币种"]')).toHaveLength(1);
    await wrapper
      .get('header button[aria-label="语言与币种"]')
      .trigger("click");
    const localePanel = dialog(wrapper, "语言与币种");
    expect(localePanel.findAll('[role="combobox"]')).toHaveLength(2);
    expect(localePanel.find("select").exists()).toBe(false);
    for (const unrelated of ["外观", "退出登录", "数据来源", "偏好设置"])
      expect(localePanel.text()).not.toContain(unrelated);
    expect(wrapper.text()).not.toContain("偏好设置");
    expect(ws().setMode).not.toHaveBeenCalled();
    expect(ws().signOut).not.toHaveBeenCalled();
    expect(ws().write).not.toHaveBeenCalled();
  });
  it("updates purchase currency and language without changing identity or selecting synthetic data", async () => {
    authenticated();
    const wrapper = await shell("/catalog");
    await wrapper.get('button[aria-label="语言与币种"]').trigger("click");
    const localePanel = dialog(wrapper, "语言与币种");
    const controls = localePanel.findAll('[role="combobox"]');
    await chooseOption(controls[1]!, "USD");
    expect(ws().currency.value).toBe("USD");
    expect(ws().reportCurrency.value).toBe("CNY");
    expect(
      wrapper.get('header button[aria-label="语言与币种"]').text(),
    ).toContain("USD");
    await chooseOption(controls[0]!, "English");
    expect(ws().locale.value).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(wrapper.find("[data-public]").exists()).toBe(true);
    expect(ws().mode.value).toBe("api");
    expect(ws().setMode).not.toHaveBeenCalled();
    expect(ws().write).not.toHaveBeenCalled();
  });
  it("does not offer disabled purchase currencies to a customer", async () => {
    authenticated();
    const wrapper = await shell("/catalog");
    await wrapper.get('button[aria-label="语言与币种"]').trigger("click");
    await dialog(wrapper, "语言与币种")
      .findAll('[role="combobox"]')[1]!
      .trigger("click");
    const labels = Array.from(document.querySelectorAll('[role="option"]')).map(
      (element) => element.textContent,
    );
    expect(labels.some((label) => label?.includes("CNY"))).toBe(true);
    expect(labels.some((label) => label?.includes("USD"))).toBe(true);
    expect(labels.some((label) => label?.includes("JPY"))).toBe(false);
  });
  it("keeps administrator reporting currency separate from the customer purchase currency", async () => {
    authenticated("admin");
    const wrapper = await shell("/admin/catalog");
    await wrapper.get('button[aria-label="语言与币种"]').trigger("click");
    await chooseOption(
      dialog(wrapper, "语言与币种").findAll('[role="combobox"]')[1]!,
      "USD",
    );
    expect(ws().reportCurrency.value).toBe("USD");
    expect(ws().currency.value).toBe("CNY");
    expect(wrapper.find("[data-private]").exists()).toBe(true);
    expect(ws().write).not.toHaveBeenCalled();
  });
  it("opens the named account entry from the sidebar with profile, segmented appearance and sign-out only there", async () => {
    authenticated();
    const wrapper = await shell("/home");
    const accountEntry = wrapper.get('aside button[aria-label="账户"]');
    expect(accountEntry.text()).toContain(user.name);
    expect(wrapper.findAll('aside a[href="#/account"]')).toHaveLength(0);
    await accountEntry.trigger("click");
    const accountPanel = dialog(wrapper, "账户");
    expect(accountPanel.text()).toContain(user.name);
    expect(action(accountPanel, "账户资料").exists()).toBe(true);
    expect(button(accountPanel, "退出登录").exists()).toBe(true);
    expect(accountPanel.findAll('[role="combobox"]')).toHaveLength(0);
    expect(accountPanel.findAll("button[aria-pressed]")).toHaveLength(2);
    await button(accountPanel, "浅色").trigger("click");
    expect(button(accountPanel, "浅色").attributes("aria-pressed")).toBe(
      "true",
    );
    expect(button(accountPanel, "深色").attributes("aria-pressed")).toBe(
      "false",
    );
    expect(document.documentElement.dataset.appearance).toBe("light");
    expect(accountPanel.text()).not.toContain("数据来源");
    expect(accountPanel.text()).not.toContain("偏好设置");
    await action(accountPanel, "账户资料").trigger("click");
    await flushPromises();
    expect(wrapper.vm.$route.path).toBe("/account");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(ws().write).not.toHaveBeenCalled();
  });
  it("gives the mobile More drawer the same account entry instead of a duplicated preference panel", async () => {
    authenticated();
    const wrapper = await shell("/home");
    const mobile = wrapper.get('nav[aria-label="主导航"]');
    expect(
      mobile.findAll("a").map((link) => [link.text(), link.attributes("href")]),
    ).toEqual([
      ["首页", "#/home"],
      ["云服务器", "#/catalog"],
      ["账单", "#/invoices"],
    ]);
    await button(mobile, "更多").trigger("click");
    const navigation = dialog(wrapper, "导航");
    const accountEntry = navigation.get('button[aria-label="账户"]');
    expect(accountEntry.text()).toContain(user.name);
    expect(navigation.text()).not.toContain("偏好设置");
    expect(navigation.findAll('a[href^="#/admin"]')).toHaveLength(0);
    await accountEntry.trigger("click");
    expect(wrapper.find('[role="dialog"][aria-label="导航"]').exists()).toBe(
      false,
    );
    const accountPanel = dialog(wrapper, "账户");
    expect(action(accountPanel, "账户资料").exists()).toBe(true);
    expect(button(accountPanel, "退出登录").exists()).toBe(true);
    expect(accountPanel.findAll("button[aria-pressed]")).toHaveLength(2);
  });
  it("uses ordinary cloud product labels and keeps customer and administrator destinations distinct", async () => {
    authenticated();
    const customer = await shell("/home");
    const links = customer.get("aside").findAll("a");
    expect(
      Object.fromEntries(
        links.map((link) => [link.attributes("href"), link.text()]),
      ),
    ).toEqual({
      "#/home": "首页",
      "#/catalog": "云服务器",
      "#/services": "我的服务器",
      "#/orders": "订单",
      "#/invoices": "账单",
    });
    for (const invented of ["算力", "工作空间", "偏好设置"])
      expect(customer.get("#workspace-shell").text()).not.toContain(invented);
    authenticated("admin");
    const admin = await shell("/admin/catalog");
    const adminLinks = admin
      .get("aside")
      .findAll("a")
      .map((link) => link.attributes("href"));
    expect(adminLinks).toEqual(
      expect.arrayContaining([
        "#/admin/catalog",
        "#/admin/customers",
        "#/admin/orders",
        "#/admin/invoices",
        "#/admin/finance",
        "#/admin/services",
        "#/admin/audit",
        "#/admin/settings",
      ]),
    );
    expect(adminLinks.every((href) => href?.startsWith("#/admin/"))).toBe(true);
    const mobile = admin.get('nav[aria-label="主导航"]');
    expect(
      mobile
        .findAll("a")
        .every((link) => link.attributes("href")?.startsWith("#/admin/")),
    ).toBe(true);
    await button(mobile, "更多").trigger("click");
    const navigation = dialog(admin, "导航");
    expect(navigation.findAll('a[href^="#/admin/"]').length).toBeGreaterThan(0);
    expect(navigation.find('button[aria-label="账户"]').exists()).toBe(true);
    expect(navigation.text()).not.toContain("偏好设置");
  });
});

describe("authentication survives shell information-architecture changes", () => {
  it("does not mount an already populated but unverified identity", async () => {
    ws().session.value = session();
    ws().sessionVerified.value = false;
    const wrapper = await shell("/orders");
    expect(wrapper.find("[data-private]").exists()).toBe(false);
    expect(
      wrapper.findAll("button").some((element) => element.text() === "登录"),
    ).toBe(true);
    expect(ws().write).not.toHaveBeenCalled();
  });
  it("re-mounts private pages on a same-role identity change and removes prior-owner data", async () => {
    authenticated();
    const wrapper = await shell("/orders");
    expect(wrapper.get("[data-private]").text()).toContain(user.id);
    const replacementId = "f".repeat(32);
    ws().session.value = {
      ...session(),
      user: { ...user, id: replacementId, name: "Replacement user" },
    };
    await nextTick();
    expect(wrapper.get("[data-private]").text()).toContain(replacementId);
    expect(wrapper.text()).not.toContain(user.id);
    expect(wrapper.get('aside button[aria-label="账户"]').text()).toContain(
      "Replacement user",
    );
  });
  it.each(["语言与币种", "账户"])(
    "closes the %s panel on a user switch instead of retaining a prior user context",
    async (title) => {
      authenticated();
      const wrapper = await shell("/home");
      await wrapper.get(`button[aria-label="${title}"]`).trigger("click");
      expect(dialog(wrapper, title).exists()).toBe(true);
      ws().session.value = {
        ...session(),
        user: { ...user, id: "e".repeat(32), name: "Next owner" },
      };
      await nextTick();
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(wrapper.get('aside button[aria-label="账户"]').text()).toContain(
        "Next owner",
      );
      expect(wrapper.text()).not.toContain(user.name);
    },
  );
  it("opens the real sign-in panel and mounts the requested private page only after confirmed login", async () => {
    const wrapper = await shell("/orders");
    expect(wrapper.find("[data-private]").exists()).toBe(false);
    await button(wrapper, "登录").trigger("click");
    await fill(wrapper);
    let confirm!: () => void;
    ws().signIn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirm = () => {
            ws().session.value = session();
            ws().sessionVerified.value = true;
            resolve(session());
          };
        }),
    );
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find("[data-private]").exists()).toBe(false);
    confirm();
    await flushPromises();
    expect(ws().signIn).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.$route.path).toBe("/orders");
    expect(wrapper.get("[data-private]").text()).toContain(user.id);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(ws().write).not.toHaveBeenCalled();
  });
  it("signs out once, clears the private page and navigates to public purchasing only on acknowledgement", async () => {
    authenticated();
    const wrapper = await shell("/orders");
    await wrapper.get('aside button[aria-label="账户"]').trigger("click");
    let finish!: () => void;
    ws().signOut.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => {
            ws().session.value = {
              user: null,
              csrf_token: "logout",
              demo_mode: false,
            };
            ws().sessionVerified.value = true;
            resolve(ws().session.value);
          };
        }),
    );
    const exit = button(dialog(wrapper, "账户"), "退出登录");
    await exit.trigger("click");
    await exit.trigger("click");
    await flushPromises();
    expect(ws().signOut).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.$route.path).toBe("/orders");
    finish();
    await flushPromises();
    expect(wrapper.vm.$route.path).toBe("/catalog");
    expect(wrapper.find("[data-private]").exists()).toBe(false);
    expect(wrapper.find("[data-public]").exists()).toBe(true);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(ws().write).not.toHaveBeenCalled();
  });
  it("does not claim a failed sign-out succeeded and exposes explicit session recovery without an automatic replay", async () => {
    authenticated();
    ws().signOut.mockRejectedValueOnce(
      new ApiError("NETWORK_ERROR", 0, {
        uncertain: true,
        requestId: "c".repeat(32),
      }),
    );
    const wrapper = await shell("/orders");
    await wrapper.get('aside button[aria-label="账户"]').trigger("click");
    await button(dialog(wrapper, "账户"), "退出登录").trigger("click");
    await flushPromises();
    expect(ws().signOut).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.$route.path).toBe("/orders");
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toContain("c".repeat(32));
    const priorReads = ws().refreshSession.mock.calls.length;
    await button(wrapper, "重新连接").trigger("click");
    await flushPromises();
    expect(ws().refreshSession).toHaveBeenCalledTimes(priorReads + 1);
    expect(ws().signOut).toHaveBeenCalledTimes(1);
    expect(ws().write).not.toHaveBeenCalled();
  });
});

describe("independent sign-in panel", () => {
  it("preserves exact password bytes, clears the password and closes only on confirmed success", async () => {
    const wrapper = signIn();
    await fill(wrapper);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(ws().signIn).toHaveBeenCalledWith(
      "LOCAL@example.invalid",
      "  Exact password with spaces  ",
    );
    expect(
      (
        wrapper.find("input[autocomplete=current-password]")
          .element as HTMLInputElement
      ).value,
    ).toBe("");
    expect(wrapper.emitted("signedIn")).toHaveLength(1);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
  it("shows safe credential error and request number, with no false success", async () => {
    ws().signIn.mockRejectedValueOnce(
      new ApiError("INVALID_CREDENTIALS", 401, { requestId: "b".repeat(32) }),
    );
    const wrapper = signIn();
    await fill(wrapper);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("邮箱或密码不正确");
    expect(wrapper.text()).toContain("b".repeat(32));
    expect(wrapper.emitted("signedIn")).toBeUndefined();
    expect(
      (
        wrapper.find("input[autocomplete=current-password]")
          .element as HTMLInputElement
      ).value,
    ).toBe("");
  });
  it("keeps an uncertain authentication write locked until explicit session verification", async () => {
    ws().signIn.mockRejectedValueOnce(
      new ApiError("NETWORK_ERROR", 0, { uncertain: true }),
    );
    const wrapper = signIn();
    await fill(wrapper);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await fill(wrapper);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(ws().signIn).toHaveBeenCalledTimes(1);
    expect(button(wrapper, "先重新确认会话").exists()).toBe(true);
    ws().refreshSession.mockImplementationOnce(async () => {
      ws().session.value = session();
      return session();
    });
    await button(wrapper, "先重新确认会话").trigger("click");
    await flushPromises();
    expect(wrapper.emitted("signedIn")).toHaveLength(1);
  });
  it("honors Retry-After and prevents repeated credential submissions", async () => {
    // Make the real boundary deterministic: distinct Date.now() samples in
    // one response handler must not inflate an exact 120s delay to 121s.
    let clock = 1_790_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock++);
    ws().signIn.mockRejectedValueOnce(
      new ApiError("RATE_LIMITED", 429, { retryAfter: "120" }),
    );
    const wrapper = signIn();
    await fill(wrapper);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("120 秒");
    await fill(wrapper);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(ws().signIn).toHaveBeenCalledTimes(1);
  });
});

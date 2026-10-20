// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomerAccountsPage from "../src/components/CustomerAccountsPage.vue";
import CatalogPage from "../src/components/CatalogPage.vue";
import OrderDetailsPage from "../src/components/OrderDetailsPage.vue";
import { defaultCurrencyRegistry } from "../src/lib/currencies";
import { setLocale } from "../src/lib/i18n";
const id = "a".repeat(32),
  other = "b".repeat(32),
  productID = "c".repeat(32);
const customer = {
  id: other,
  name: "客户一",
  email: "customer@example.invalid",
  role: "customer",
  disabled: false,
  revision: 3,
};
const registry = {
  ...structuredClone(defaultCurrencyRegistry),
  currencies: [
    ...structuredClone(defaultCurrencyRegistry.currencies),
    {
      code: "JPY",
      name: "日元",
      prefix: "¥",
      suffix: "",
      decimal_places: 0,
      enabled: true,
      sort_order: 1,
      precision_locked: false,
    },
    {
      code: "KWD",
      name: "KWD",
      prefix: "",
      suffix: "",
      decimal_places: 3,
      enabled: true,
      sort_order: 2,
      precision_locked: false,
    },
  ],
};
const product = {
  id: productID,
  name: "现有商品",
  description: "当前商品说明",
  region: "新加坡",
  cpu: 2,
  memory_gb: 4,
  disk_gb: 80,
  transfer_tb: 2,
  available: true,
  prices: [{ currency: "CNY", amount_minor: 3900, available: true }],
};
const order = {
  id: other,
  number: "ORD-TEST",
  plan_name: "当前名称不能覆盖快照",
  status: "pending_payment",
  total_minor: 3900,
  currency: "CNY",
  currency_format: defaultCurrencyRegistry.currencies[0],
  created_at: "2026-10-20T08:00:00Z",
  plan_snapshot: {
    plan_id: productID,
    name: "成交规格",
    region: "历史地区",
    cpu: 1,
    memory_gb: 2,
    disk_gb: 40,
    transfer_tb: 1,
    billing_cycle: "monthly",
  },
};
const details = {
  order,
  customer: { ...customer },
  invoice: {
    id: "d".repeat(32),
    number: "INV-TEST",
    order_id: other,
    status: "unpaid",
    amount_minor: 3900,
    currency: "CNY",
    currency_format: defaultCurrencyRegistry.currencies[0],
    issued_at: "2026-10-20T08:00:00Z",
    due_at: "2026-10-27T08:00:00Z",
    issuer: { name: "历史开具方", address: "", support_email: "" },
  },
  service: null,
  payment_attempts: [
    {
      id: "e".repeat(32),
      provider_id: "test",
      amount_minor: 9007199254740991,
      currency: "KWD",
      currency_decimal_places: 3,
      state: "uncertain",
      created_at: "2026-10-20T08:00:00Z",
      updated_at: "2026-10-20T08:05:00Z",
    },
  ],
  audit: [
    {
      id: "f".repeat(32),
      action: "constructor",
      target: other,
      actor_email: "admin@example.invalid",
      created_at: "2026-10-20T08:00:00Z",
      detail: "<img src=x onerror=alert(1)> original reason",
    },
  ],
  audit_has_more: false,
  payment_attempts_has_more: false,
};
let calls: { path: string; method: string; body?: Record<string, unknown> }[];
let respond: (
  path: string,
  method: string,
  body?: Record<string, unknown>,
) => unknown | Promise<unknown>;
const wrappers: ReturnType<typeof mount>[] = [];
const originalShow = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "showModal",
  ),
  originalClose = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "close",
  );
const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => ({ data }),
});
const fail = (code: string, status = 409) => ({
  ok: false,
  status,
  headers: new Headers({ "X-Request-ID": "1".repeat(32) }),
  json: async () => ({
    error: { code, message: "untrusted raw storage message" },
  }),
});
async function app(
  component: Parameters<typeof mount>[0],
  props: Record<string, unknown> = {},
  path = "/customers",
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div/>" } }],
  });
  await router.push(path);
  const w = mount(component, {
    props: { account: id + ":admin", ...props },
    global: { plugins: [router] },
    attachTo: document.body,
  });
  wrappers.push(w);
  await flushPromises();
  return { w, router };
}
async function fill(
  w: ReturnType<typeof mount>,
  name: string,
  value: string | boolean,
) {
  await w.get(`[name="${name}"]`).setValue(value);
}
async function accountReason(w: ReturnType<typeof mount>) {
  await fill(w, "account_reason", "管理员核对后的测试操作");
  await fill(w, "account_agreed", true);
}
async function catalogReason(w: ReturnType<typeof mount>) {
  await fill(w, "catalog_reason", "管理员核对后的商品操作");
  await fill(w, "catalog_agreed", true);
}
function button(w: ReturnType<typeof mount>, label: string) {
  return w.findAll("button").find((b) => b.text() === label)!;
}
beforeEach(() => {
  setLocale("zh-CN");
  calls = [];
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  respond = (path, method) => {
    if (path.startsWith("/admin/customer-accounts?"))
      return ok({ items: [customer], has_more: false, limit: 50 });
    if (path.startsWith("/admin/customer-accounts/"))
      return ok({ ...customer, revision: method === "POST" ? 4 : 3 });
    if (path === "/admin/customer-accounts" && method === "POST")
      return ok({ ...customer, revision: 1 });
    if (path === "/admin/catalog")
      return ok({ revision: 7, currency_revision: 1, items: [product] });
    if (path === "/admin/currencies") return ok(registry);
    if (path.includes("/orders/")) return ok(details);
    throw Error("unexpected " + path);
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      const path = input.replace("/api/v1", ""),
        method = init.method ?? "GET",
        body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, method, body });
      return respond(path, method, body);
    }),
  );
});
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  if (originalShow)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "showModal",
      originalShow,
    );
  else
    delete (HTMLDialogElement.prototype as unknown as Record<string, unknown>)
      .showModal;
  if (originalClose)
    Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else
    delete (HTMLDialogElement.prototype as unknown as Record<string, unknown>)
      .close;
});
describe("real customer administration", () => {
  it("queries exact server filters and opaque next/previous pages", async () => {
    respond = (path) =>
      ok({
        items: [customer],
        has_more: !path.includes("cursor="),
        ...(path.includes("cursor=") ? {} : { next_cursor: "opaque+/=cursor" }),
        limit: 50,
      });
    const { w } = await app(CustomerAccountsPage);
    await button(w, "下一页").trigger("click");
    await flushPromises();
    expect(
      new URL(calls.at(-1)!.path, "http://localhost").searchParams.get(
        "cursor",
      ),
    ).toBe("opaque+/=cursor");
    await button(w, "上一页").trigger("click");
    await flushPromises();
    await fill(w, "account_search", "Exact%_name");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect(
      new URL(calls.at(-1)!.path, "http://localhost").searchParams.get("q"),
    ).toBe("Exact%_name");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
  it("creates with a required reason and confirmation and clears passwords on success", async () => {
    const { w } = await app(CustomerAccountsPage);
    await button(w, "创建账户").trigger("click");
    await fill(w, "account_name", "新客户");
    await fill(w, "account_email", "new@example.invalid");
    await fill(w, "account_password", "  exact secret password  ");
    await fill(w, "account_confirmation", "  exact secret password  ");
    await w.get("dialog form").trigger("submit");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await accountReason(w);
    await w.get("dialog form").trigger("submit");
    await flushPromises();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({
      name: "新客户",
      email: "new@example.invalid",
      role: "customer",
      password: "  exact secret password  ",
      reason: "管理员核对后的测试操作",
    });
    expect(w.find('[name="account_password"]').exists()).toBe(false);
    expect(w.text()).not.toContain("exact secret password");
    expect(w.text()).toContain("账户操作已完成");
  });
  it("re-reads the first page after a valid write and displays the changed account", async () => {
    let changed = false;
    respond = (path, method) => {
      if (method === "POST") {
        changed = true;
        return ok({
          ...customer,
          name: "修改后的客户",
          role: "admin",
          disabled: true,
          revision: 4,
        });
      }
      if (path.includes("?"))
        return ok({
          items: [
            {
              ...customer,
              ...(changed
                ? {
                    name: "修改后的客户",
                    role: "admin",
                    disabled: true,
                    revision: 4,
                  }
                : {}),
            },
          ],
          has_more: false,
          limit: 50,
        });
      return ok(customer);
    };
    const { w } = await app(CustomerAccountsPage);
    await button(w, "编辑权限").trigger("click");
    await flushPromises();
    await fill(w, "account_name", "修改后的客户");
    await fill(w, "account_role", "admin");
    await fill(w, "account_disabled", true);
    await accountReason(w);
    await w.get("dialog form").trigger("submit");
    await flushPromises();
    expect(
      calls.filter((c) => c.path.includes("?") && c.method === "GET"),
    ).toHaveLength(2);
    const row = w.get(`[data-account-id="${other}"]`);
    expect(row.text()).toContain("修改后的客户");
    expect(row.text()).toContain("管理员");
    expect(row.text()).toContain("已停用");
  });
  it("cycles Tab and Shift+Tab within the management dialog", async () => {
    const { w } = await app(CustomerAccountsPage);
    await button(w, "创建账户").trigger("click");
    await flushPromises();
    const dialog = w.get("dialog"),
      controls = dialog
        .findAll("button, input, select, textarea")
        .filter((el) => el.attributes("disabled") === undefined);
    const rect = vi
      .spyOn(HTMLElement.prototype, "getClientRects")
      .mockReturnValue([{ width: 20, height: 20 }] as unknown as DOMRectList);
    try {
      (controls.at(-1)!.element as HTMLElement).focus();
      await dialog.trigger("keydown", { key: "Tab" });
      expect(document.activeElement).toBe(controls[0]!.element);
      await dialog.trigger("keydown", { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(controls.at(-1)!.element);
    } finally {
      rect.mockRestore();
    }
  });
  it("loads current revision before editing and never edits email", async () => {
    const { w } = await app(CustomerAccountsPage);
    await button(w, "编辑权限").trigger("click");
    await flushPromises();
    expect(calls.at(-1)!.path).toBe("/admin/customer-accounts/" + other);
    expect(w.find('[name="account_email"]').exists()).toBe(false);
    await fill(w, "account_role", "admin");
    await fill(w, "account_disabled", true);
    await accountReason(w);
    await w.get("dialog form").trigger("submit");
    await flushPromises();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      revision: 3,
      reason: "管理员核对后的测试操作",
      name: "客户一",
      role: "admin",
      disabled: true,
    });
  });
  it.each([
    "ACCOUNT_CONFLICT",
    "SELF_ACCOUNT_CHANGE",
    "LAST_ACTIVE_ADMIN",
    "ACCOUNT_EXISTS",
  ])("explains %s without leaking server detail or retrying", async (code) => {
    const original = respond;
    respond = (path, method, body) =>
      method === "POST" ? fail(code) : original(path, method, body);
    const { w } = await app(CustomerAccountsPage);
    await button(w, "撤销会话").trigger("click");
    await flushPromises();
    await accountReason(w);
    await w.get("dialog form").trigger("submit");
    await flushPromises();
    expect(w.get('dialog [role="alert"]').text()).not.toContain("untrusted");
    expect(w.get('dialog [role="alert"]').text()).toContain("1".repeat(32));
    expect(button(w, "确认操作").attributes("disabled")).toBeDefined();
    await w.get("dialog form").trigger("submit");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
  it("submits reset and revoke only to their dedicated endpoints with revision", async () => {
    const { w } = await app(CustomerAccountsPage);
    await button(w, "重置密码").trigger("click");
    await flushPromises();
    await fill(w, "account_password", "a".repeat(16));
    await fill(w, "account_confirmation", "a".repeat(16));
    await accountReason(w);
    await w.get("dialog form").trigger("submit");
    await flushPromises();
    expect(calls.find((c) => c.method === "POST")!.path).toBe(
      "/admin/customer-accounts/" + other + "/password",
    );
    expect(calls.find((c) => c.method === "POST")!.body!.revision).toBe(3);
    await button(w, "撤销会话").trigger("click");
    await flushPromises();
    await accountReason(w);
    await w.get("dialog form").trigger("submit");
    await flushPromises();
    expect(calls.filter((c) => c.method === "POST").at(-1)!.path).toBe(
      "/admin/customer-accounts/" + other + "/revoke-sessions",
    );
  });
  it("prevents own role/disable controls but allows own password/revoke tasks", async () => {
    respond = () =>
      ok({
        items: [{ ...customer, id, role: "admin" }],
        limit: 50,
        has_more: false,
      });
    const { w } = await app(CustomerAccountsPage);
    await button(w, "编辑权限").trigger("click");
    expect(w.get('[name="account_role"]').attributes("disabled")).toBeDefined();
    expect(
      w.get('[name="account_disabled"]').attributes("disabled"),
    ).toBeDefined();
  });
  it("retains successful data after refresh error and rejects a late result after unmount", async () => {
    const { w } = await app(CustomerAccountsPage);
    respond = () => fail("INTERNAL_ERROR", 503);
    await w.setProps({ refreshKey: 1 });
    await flushPromises();
    expect(w.text()).toContain(customer.email);
    expect(w.get('[role="alert"]').text()).toContain("可能不是最新");
    let release!: (value: unknown) => void;
    respond = () => new Promise((r) => (release = r));
    await w.setProps({ refreshKey: 2 });
    await flushPromises();
    w.unmount();
    release(
      ok({
        items: [{ ...customer, email: "late-secret.invalid" }],
        has_more: false,
        limit: 50,
      }),
    );
    await flushPromises();
    expect(document.body.textContent).not.toContain("late-secret");
  });
});
describe("catalog operations use server revisions and exact independent prices", () => {
  it("lists a complete locally filtered catalog and makes no simulated pagination request", async () => {
    const { w } = await app(CatalogPage, {}, "/catalog");
    expect(w.text()).toContain("完整目录1项");
    const n = calls.length;
    await fill(w, "catalog_search", "not found");
    expect(w.text()).toContain("没有符合条件");
    expect(calls).toHaveLength(n);
  });
  it("creates an unpublished draft with no prices", async () => {
    const original = respond;
    respond = (p, m, b) =>
      m === "POST"
        ? ok({ revision: 8, currency_revision: 1, plan: { ...product, ...b } })
        : original(p, m, b);
    const { w, router } = await app(CatalogPage, {}, "/catalog?edit=new");
    await fill(w, "catalog_name", "新商品");
    await fill(w, "catalog_region", "东京");
    await w.get("section.management-page form").trigger("submit");
    await catalogReason(w);
    await w.get("dialog form").trigger("submit");
    await flushPromises();
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({
      revision: 7,
      available: false,
      name: "新商品",
      region: "东京",
      prices: [],
    });
    expect(router.currentRoute.value.path).toBe("/catalog");
  });
  it("publishes exact CNY max minor, JPY0 and KWD3 without floating conversion", async () => {
    const original = respond;
    respond = (p, m, b) =>
      m === "POST"
        ? ok({ revision: 8, currency_revision: 1, plan: product })
        : original(p, m, b);
    const { w } = await app(CatalogPage, {}, "/catalog?edit=new");
    await fill(w, "catalog_name", "精确报价");
    await fill(w, "catalog_region", "东京");
    for (const [code, value] of [
      ["CNY", "90071992547409.91"],
      ["JPY", "123"],
      ["KWD", "1.234"],
    ]) {
      await fill(w, "include_" + code, true);
      await fill(w, "amount_" + code, value);
      await fill(w, "available_" + code, true);
    }
    await button(w, "保存并上架").trigger("click");
    await catalogReason(w);
    await w.get("dialog form").trigger("submit");
    await flushPromises();
    expect(calls.find((c) => c.method === "POST")!.body!.prices).toEqual([
      { currency: "CNY", amount_minor: 9007199254740991, available: true },
      { currency: "JPY", amount_minor: 123, available: true },
      { currency: "KWD", amount_minor: 1234, available: true },
    ]);
  });
  it("refuses overprecision instead of rounding and never sends a write", async () => {
    const { w } = await app(CatalogPage, {}, "/catalog?edit=new");
    await fill(w, "catalog_name", "不舍入");
    await fill(w, "catalog_region", "东京");
    await fill(w, "include_JPY", true);
    await fill(w, "amount_JPY", "1.1");
    await button(w, "保存并上架").trigger("click");
    await catalogReason(w);
    await w.get("dialog form").trigger("submit");
    await flushPromises();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(w.get('dialog [role="alert"]').text()).toContain("不自动舍入");
  });
  it.each([
    ["复制为草稿", "/duplicate"],
    ["下架", ""],
  ])(
    "performs %s only after explicit reason/confirmation",
    async (label, suffix) => {
      const original = respond;
      respond = (p, m, b) =>
        m === "POST"
          ? ok({ revision: 8, currency_revision: 1, plan: product })
          : original(p, m, b);
      const { w } = await app(CatalogPage, {}, "/catalog");
      await button(w, label!).trigger("click");
      await w.get("dialog form").trigger("submit");
      expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
      await catalogReason(w);
      await w.get("dialog form").trigger("submit");
      await flushPromises();
      const post = calls.find((c) => c.method === "POST")!;
      expect(post.path).toBe("/admin/catalog/" + productID + suffix);
      expect(post.body).toMatchObject({
        revision: 7,
        reason: "管理员核对后的商品操作",
      });
      if (!suffix) expect(post.body!.available).toBe(false);
    },
  );
  it("blocks a conflicting submission until explicit reload; no automatic write retries", async () => {
    const original = respond;
    respond = (p, m, b) =>
      m === "POST" ? fail("CATALOG_CONFLICT") : original(p, m, b);
    const { w } = await app(CatalogPage, {}, "/catalog");
    await button(w, "下架").trigger("click");
    await catalogReason(w);
    await w.get("dialog form").trigger("submit");
    await flushPromises();
    expect(w.get('dialog [role="alert"]').text()).toContain("不会自动重发");
    await w.get("dialog form").trigger("submit");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
});
describe("single order details remain read-only and snapshot-based", () => {
  it("uses the admin endpoint and separates customer, invoice, attempts and audit", async () => {
    const { w } = await app(
      OrderDetailsPage,
      { administrator: true, orderID: other },
      "/orders/" + other,
    );
    expect(calls[0]!.path).toBe("/admin/orders/" + other);
    expect(w.text()).toContain(customer.email);
    expect(w.text()).toContain("成交规格");
    expect(w.text()).not.toContain("当前名称不能覆盖快照");
    expect(w.text()).toContain("KWD 9007199254740.991");
    expect(w.text()).toContain("历史开具方");
    expect(w.find("img").exists()).toBe(false);
    expect(w.text()).toContain("<img src=x");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    await button(w, "查看关联账单").trigger("click");
    await button(w, "申请取消订单").trigger("click");
    expect(w.emitted("invoice")?.[0]?.[0]).toEqual(details.invoice);
    expect(w.emitted("cancel")?.[0]?.[0]).toEqual(order);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
  it("uses customer owner route and strips an unexpected customer projection", async () => {
    const { w } = await app(
      OrderDetailsPage,
      { account: id + ":customer", administrator: false, orderID: other },
      "/orders/" + other,
    );
    expect(calls[0]!.path).toBe("/orders/" + other);
    expect(w.text()).not.toContain(customer.email);
    expect(w.text()).not.toContain("客户ID");
  });
  it("does not invent missing historical specifications or a service association", async () => {
    respond = () =>
      ok({
        ...details,
        order: { ...order, plan_snapshot: null },
        invoice: null,
        payment_attempts: [],
        audit: [],
        audit_has_more: true,
        payment_attempts_has_more: true,
      });
    const { w } = await app(
      OrderDetailsPage,
      { administrator: true, orderID: other },
      "/orders/" + other,
    );
    expect(w.text()).toContain("不使用当前商品资料补造");
    expect(w.text()).toContain("不按名称猜测");
    expect(w.text()).toContain("仍有历史未显示");
    expect(w.find("select").exists()).toBe(false);
  });
  it("clears admin details on same-ID role downgrade and ignores the held old response", async () => {
    let release!: (v: unknown) => void;
    respond = () => new Promise((r) => (release = r));
    const { w } = await app(
      OrderDetailsPage,
      { administrator: true, orderID: other },
      "/orders/" + other,
    );
    const oldRelease = release;
    respond = () => ok({ ...details, customer: undefined });
    await w.setProps({ account: id + ":customer", administrator: false });
    await flushPromises();
    oldRelease(ok(details));
    await flushPromises();
    expect(w.text()).not.toContain(customer.email);
    expect(calls.at(-1)!.path).toBe("/orders/" + other);
  });
  it("handles404 without claiming an empty completed order", async () => {
    respond = () => fail("NOT_FOUND", 404);
    const { w } = await app(
      OrderDetailsPage,
      { administrator: true, orderID: other },
      "/orders/" + other,
    );
    expect(w.get('[role="alert"]').text()).toContain("订单不存在");
    expect(w.text()).not.toContain("暂无关联支付尝试");
  });
});

describe("management request lifetime and recovery", () => {
  it("marks and focuses the actual invalid password byte field without sending a write", async () => {
    const { w } = await app(CustomerAccountsPage);
    await button(w, "创建账户").trigger("click");
    await fill(w, "account_name", "正常姓名");
    await fill(w, "account_email", "valid@example.invalid");
    await fill(w, "account_password", "密".repeat(25));
    await fill(w, "account_confirmation", "密".repeat(25));
    await accountReason(w);
    await w.get("dialog form").trigger("submit");
    await flushPromises();
    const input = w.get('[name="account_password"]');
    expect(input.attributes("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input.element);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
  it("rejects a control-bearing account reason rather than marking unrelated fields", async () => {
    const { w } = await app(CustomerAccountsPage);
    await button(w, "撤销会话").trigger("click");
    await flushPromises();
    await fill(w, "account_reason", "reason\nnot permitted");
    await fill(w, "account_agreed", true);
    await w.get("dialog form").trigger("submit");
    await flushPromises();
    expect(w.get('[name="account_reason"]').attributes("aria-invalid")).toBe(
      "true",
    );
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
  it("clears account data on same-ID downgrade and does not start another administrator read", async () => {
    const { w } = await app(CustomerAccountsPage);
    let release!: (v: unknown) => void;
    respond = () => new Promise((r) => (release = r));
    await w.setProps({ refreshKey: 2 });
    await flushPromises();
    const before = calls.length;
    await w.setProps({ account: id + ":customer" });
    await flushPromises();
    release(ok({ items: [customer], has_more: false, limit: 50 }));
    await flushPromises();
    expect(w.text()).not.toContain(customer.email);
    expect(calls).toHaveLength(before);
  });
  it("clears catalog data on same-ID downgrade and ignores a late catalog result", async () => {
    const { w } = await app(CatalogPage, {}, "/catalog");
    let release!: (v: unknown) => void;
    respond = (p) =>
      p === "/admin/catalog" ? new Promise((r) => (release = r)) : ok(registry);
    await w.setProps({ refreshKey: 2 });
    await flushPromises();
    const before = calls.length;
    await w.setProps({ account: id + ":customer" });
    await flushPromises();
    release(ok({ revision: 8, currency_revision: 1, items: [product] }));
    await flushPromises();
    expect(w.text()).not.toContain(product.name);
    expect(calls).toHaveLength(before);
  });
  it("requires a deliberate discard choice when returning from an edited product", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      const { w, router } = await app(CatalogPage, {}, "/catalog?edit=new");
      await fill(w, "catalog_name", "未保存内容");
      await router.push("/catalog");
      expect(confirm).toHaveBeenCalledOnce();
      expect(router.currentRoute.value.query.edit).toBe("new");
      confirm.mockReturnValue(true);
      await router.push("/catalog");
      expect(router.currentRoute.value.query.edit).toBeUndefined();
    } finally {
      confirm.mockRestore();
    }
  });
  it("treats a malformed catalog mutation response as unconfirmed, without automatic retry", async () => {
    const original = respond;
    respond = (p, m, b) =>
      m === "POST"
        ? ok({ revision: 8, currency_revision: 1, plan: { id: "broken" } })
        : original(p, m, b);
    const { w } = await app(CatalogPage, {}, "/catalog");
    await button(w, "下架").trigger("click");
    await catalogReason(w);
    await w.get("dialog form").trigger("submit");
    await flushPromises();
    expect(w.get("dialog [role=alert]").text()).toContain("尚未确认");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(button(w, "确认操作").attributes("disabled")).toBeDefined();
  });
  it("signs out after revoking its own sessions instead of keeping a stale privileged view", async () => {
    respond = (p, m) =>
      p.includes("?")
        ? ok({
            items: [{ ...customer, id, role: "admin" }],
            has_more: false,
            limit: 50,
          })
        : ok({
            ...customer,
            id,
            role: "admin",
            revision: m === "POST" ? 4 : 3,
          });
    const { w } = await app(CustomerAccountsPage);
    await button(w, "撤销会话").trigger("click");
    await flushPromises();
    await accountReason(w);
    await w.get("dialog form").trigger("submit");
    await flushPromises();
    expect(w.emitted("auth-expired")).toHaveLength(1);
    expect(w.find("[data-account-id]").exists()).toBe(false);
  });
});

describe("independent review async regressions", () => {
  it("binds catalog confirmation to its original revision despite a later refresh", async () => {
    let changed = false;
    const original = respond;
    respond = (p, m, b) => {
      if (p === "/admin/catalog" && m === "GET" && changed)
        return ok({
          revision: 8,
          currency_revision: 1,
          items: [{ ...product, cpu: 99 }],
        });
      if (m === "POST")
        return b?.revision === 8
          ? ok({
              revision: 9,
              currency_revision: 1,
              plan: { ...product, ...b },
            })
          : fail("CATALOG_CONFLICT");
      return original(p, m, b);
    };
    const { w } = await app(CatalogPage, {}, "/catalog");
    await button(w, "下架").trigger("click");
    changed = true;
    await w.setProps({ refreshKey: 2 });
    await flushPromises();
    await catalogReason(w);
    await w.get("dialog form").trigger("submit");
    await flushPromises();
    expect(calls.find((c) => c.method === "POST")!.body!.revision).toBe(7);
    expect(w.get("dialog [role=alert]").text()).toContain("不会自动重发");
  });
  it("guards selected record errors with a unique read token across close and reopen", async () => {
    const second = {
      ...customer,
      id: productID,
      name: "第二位客户",
      revision: 6,
    };
    let release!: (v: unknown) => void;
    respond = (p) =>
      p.includes("?")
        ? ok({ items: [customer, second], limit: 50, has_more: false })
        : p.endsWith(other)
          ? new Promise((r) => (release = r))
          : ok(second);
    const { w } = await app(CustomerAccountsPage);
    await w
      .get('[data-account-id="' + other + '"]')
      .findAll("button")[0]!
      .trigger("click");
    await flushPromises();
    await button(w, "取消").trigger("click");
    await w
      .get('[data-account-id="' + productID + '"]')
      .findAll("button")[0]!
      .trigger("click");
    await flushPromises();
    release(fail("INTERNAL_ERROR", 503));
    await flushPromises();
    expect(w.get('[name="account_name"]').element).toHaveProperty(
      "value",
      "第二位客户",
    );
    expect(w.find("dialog [role=alert]").exists()).toBe(false);
  });
  it("guards selected record success with a unique token when the same account is reopened", async () => {
    let reads = 0,
      release!: (v: unknown) => void;
    respond = (p) =>
      p.includes("?")
        ? ok({ items: [customer], limit: 50, has_more: false })
        : ++reads === 1
          ? new Promise((r) => (release = r))
          : ok({ ...customer, name: "最新账户名", revision: 6 });
    const { w } = await app(CustomerAccountsPage);
    await button(w, "编辑权限").trigger("click");
    await flushPromises();
    await button(w, "取消").trigger("click");
    await button(w, "编辑权限").trigger("click");
    await flushPromises();
    await fill(w, "account_name", "正在编辑的新草稿");
    release(ok({ ...customer, name: "旧响应名称", revision: 3 }));
    await flushPromises();
    expect(w.get('[name="account_name"]').element).toHaveProperty(
      "value",
      "正在编辑的新草稿",
    );
  });
});

describe("catalog currency snapshot binding", () => {
  it("rejects a mixed catalog and currency registry read before any edit is enabled", async () => {
    const original = respond;
    respond = (p, m, b) =>
      p === "/admin/catalog"
        ? ok({ revision: 7, currency_revision: 2, items: [product] })
        : original(p, m, b);
    const { w } = await app(CatalogPage, {}, "/catalog?edit=" + productID);
    expect(w.get("[role=alert]").text()).toContain("未能读取");
    expect(w.find('[name="amount_CNY"]').exists()).toBe(false);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
  it("preserves edited prices and their old currency revision across a background refresh", async () => {
    const original = respond;
    respond = (p, m, b) =>
      m === "POST" ? fail("CATALOG_CONFLICT") : original(p, m, b);
    const { w } = await app(CatalogPage, {}, "/catalog?edit=new");
    await fill(w, "catalog_name", "旧精度草稿");
    await fill(w, "catalog_region", "东京");
    await fill(w, "include_JPY", true);
    await fill(w, "amount_JPY", "100");
    await fill(w, "available_JPY", true);
    const reads = calls.length;
    await w.setProps({ refreshKey: 2 });
    await flushPromises();
    expect(calls).toHaveLength(reads);
    expect(w.get('[name="amount_JPY"]').element).toHaveProperty("value", "100");
    await button(w, "保存并上架").trigger("click");
    await catalogReason(w);
    await w.get("dialog form").trigger("submit");
    await flushPromises();
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({
      revision: 7,
      currency_revision: 1,
      prices: [{ currency: "JPY", amount_minor: 100, available: true }],
    });
    expect(w.get("dialog [role=alert]").text()).toContain("不会自动重发");
  });
  it("preserves a draft edited while an explicit read is still in flight", async () => {
    const { w } = await app(CatalogPage, {}, "/catalog?edit=" + productID);
    let release!: (v: unknown) => void;
    const original = respond;
    respond = (p, m, b) =>
      p === "/admin/catalog"
        ? new Promise((r) => (release = r))
        : original(p, m, b);
    await button(w, "重新读取目录").trigger("click");
    await flushPromises();
    await fill(w, "catalog_name", "读取时编辑的本地草稿");
    release(
      ok({
        revision: 8,
        currency_revision: 1,
        items: [{ ...product, name: "其他管理员新名称" }],
      }),
    );
    await flushPromises();
    expect(w.get('[name="catalog_name"]').element).toHaveProperty(
      "value",
      "读取时编辑的本地草稿",
    );
    expect(w.get("[role=alert]").text()).toContain("已保留本地草稿");
  });
});

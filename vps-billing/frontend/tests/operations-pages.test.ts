// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, type Ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import OperationsPage from "../src/pages/OperationsPage.vue";
import type { Session } from "../src/types/idc";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  generation: null as unknown as Ref<number>,
}));
vi.mock("../src/composables/useWorkspace", async () => {
  const { ref } = await import("vue");
  mocks.generation = ref(0);
  return { useWorkspace: () => ({ ...mocks }) };
});
const panel = defineComponent({
  props: ["open", "title"],
  template:
    '<section v-if="open" role="dialog"><h2>{{title}}</h2><slot/><footer><slot name="footer"/></footer></section>',
});
const admin: Session = {
  user: {
    id: "a".repeat(32),
    name: "合成管理员",
    email: "admin@example.invalid",
    role: "admin",
  },
  csrf_token: "synthetic",
  demo_mode: false,
};
const cny = {
  code: "CNY",
  name: "人民币",
  prefix: "¥",
  suffix: "",
  decimal_places: 2,
};
const usd = {
  code: "USD",
  name: "USD",
  prefix: "$",
  suffix: "",
  decimal_places: 2,
};
const account = (id = "b".repeat(32)) => ({
  id,
  name: `账户 ${id[0]}`,
  email: `${id[0]}@example.invalid`,
  role: "customer",
  disabled: false,
  revision: 3,
});
const order = () => ({
  id: "o".repeat(32),
  number: "ORD-SYNTHETIC",
  plan_name: "合成套餐",
  hostname: "synthetic-host",
  status: "pending_payment",
  currency: "CNY",
  total_minor: 3900,
  currency_format: cny,
  created_at: "2026-10-21T00:00:00Z",
});
const invoice = () => ({
  id: "i".repeat(32),
  number: "INV-SYNTHETIC",
  order_id: "o".repeat(32),
  status: "unpaid",
  currency: "CNY",
  amount_minor: 3900,
  currency_format: cny,
  issued_at: "2026-10-21T00:00:00Z",
  due_at: "2026-10-22T00:00:00Z",
});
const details = () => ({
  order: order(),
  invoice: invoice(),
  service: null,
  customer: account(),
  payment_attempts: [],
  audit: [],
  audit_has_more: false,
  payment_attempts_has_more: false,
});
const audit = (id: string) => ({
  id,
  action: `order.${id}`,
  target: "synthetic",
  actor_email: "payment:synthetic",
  owner_id: "b".repeat(32),
  detail: "合成记录",
  created_at: "2026-10-21T00:00:00Z",
});
const summary = () => ({
  customers: 2,
  total_services: 0,
  unpaid_invoices: 1,
  unpaid_total_minor: 3900,
  revenue_minor: 9900,
  currency: "CNY",
  currency_format: cny,
  count_scope: "currency",
  customers_scope: "all",
});
let wrappers: VueWrapper[] = [];
function render(section: string, role: "admin" | "customer" = "admin") {
  const w = mount(OperationsPage, {
    props: { section, role, locale: "zh-CN", currency: "CNY", mode: "api" },
    global: { stubs: { OverlayPanel: panel } },
  });
  wrappers.push(w);
  return w;
}
const button = (w: VueWrapper, text: string) =>
  w.findAll("button").find((b) => b.text().includes(text))!;
beforeEach(() => {
  mocks.generation.value = 0;
  mocks.read.mockReset();
  mocks.write.mockReset();
  mocks.read.mockImplementation(async (path: string) =>
    structuredClone(
      path === "/session"
        ? admin
        : path === "/admin/overview"
          ? summary()
          : path.endsWith("/orders")
            ? [order()]
            : path.endsWith(`/orders/${order().id}`)
              ? details()
              : path.endsWith("/invoices")
                ? [invoice()]
                : path.endsWith(`/invoices/${invoice().id}`)
                  ? invoice()
                  : path === "/admin/customer-accounts"
                    ? { items: [account()], has_more: false, limit: 50 }
                    : path.startsWith("/admin/customer-accounts/")
                      ? account(path.split("/").at(-1))
                      : {
                          items: [audit("first")],
                          has_more: true,
                          next_cursor: "opaque-next",
                          limit: 50,
                        },
    ),
  );
});
afterEach(() => {
  wrappers.forEach((w) => w.unmount());
  wrappers = [];
  vi.restoreAllMocks();
});

async function chooseAdmin(form: { find(selector: string): any }) {
  const combo = form.find('[role="combobox"]');
  await combo.trigger("keydown", { key: "End" });
  await combo.trigger("keydown", { key: "Enter" });
}

describe("real-contract operation pages", () => {
  it("uses branded UTC text fields while preserving inclusive from and exclusive until query values", async () => {
    const w = render("audit");
    await flushPromises();
    const inputs = w.findAll(".audit-filters input");
    expect(inputs[2]!.attributes("type")).toBe("text");
    expect(inputs[3]!.attributes("type")).toBe("text");
    await inputs[2]!.setValue("2026-10-21T00:00");
    await inputs[3]!.setValue("2026-10-22T00:00:00");
    await w.get(".audit-filters").trigger("submit");
    await flushPromises();
    expect(mocks.read).toHaveBeenLastCalledWith("/admin/audit-events", {
      limit: "50",
      from: "2026-10-21T00:00:00.000Z",
      until: "2026-10-22T00:00:00.000Z",
    });
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each([
    "2026-02-30T12:00",
    "2026-10-21T00:00Z",
    "10/21/2026 00:00",
    "2026-10-21T25:00",
  ])(
    "rejects ambiguous or invalid UTC filter %s without making a request",
    async (value) => {
      const w = render("audit");
      await flushPromises();
      const before = mocks.read.mock.calls.length;
      await w.findAll(".audit-filters input")[2]!.setValue(value);
      await w.get(".audit-filters").trigger("submit");
      await flushPromises();
      expect(mocks.read).toHaveBeenCalledTimes(before);
      expect(w.text()).toContain("起始UTC时间不正确");
    },
  );
  it("rejects semantically equal UTC boundaries even when one specifies seconds", async () => {
    const w = render("audit");
    await flushPromises();
    const before = mocks.read.mock.calls.length;
    await w.findAll(".audit-filters input")[2]!.setValue("2026-10-21T00:00");
    await w.findAll(".audit-filters input")[3]!.setValue("2026-10-21T00:00:00");
    await w.get(".audit-filters").trigger("submit");
    await flushPromises();
    expect(mocks.read).toHaveBeenCalledTimes(before);
    expect(w.text()).toContain("起始时间必须早于截止时间");
  });
  it("composes finance from existing per-currency overview and invoices, not a fictional finance API", async () => {
    const originalRead = mocks.read.getMockImplementation()!;
    mocks.read.mockImplementation(async (path: string, query: unknown) =>
      path === "/admin/invoices"
        ? [
            invoice(),
            {
              ...invoice(),
              id: "usd-invoice",
              number: "USD-ONLY",
              currency: "USD",
              amount_minor: 9007199254740991,
              currency_format: usd,
            },
          ]
        : originalRead(path, query),
    );
    const w = render("finance");
    await flushPromises();
    expect(mocks.read).toHaveBeenCalledWith("/admin/overview", {
      currency: "CNY",
    });
    expect(
      mocks.read.mock.calls.some(([path]) => path === "/admin/finance"),
    ).toBe(false);
    expect(w.get(".gfo-cell:nth-child(1) .gfo-cell-val").text()).toBe("¥99.00");
    expect(w.get(".gfo-cell:nth-child(1) .gfo-scope").text()).toBe("CNY");
    expect(w.get(".gfo-cell:nth-child(2) .gfo-cell-val").text()).toBe("¥39.00");
    expect(w.get(".gfo-cell:nth-child(2) .gfo-scope").text()).toBe("CNY");
    expect(w.findAll(".gfo-row")).toHaveLength(1);
    expect(w.text()).not.toContain("USD-ONLY");
    expect(w.get(".gfo-row .gfo-curr-pill").text()).toBe("CNY");
    expect(w.get(".gfo-row .gfo-amount").text()).toBe("¥39.00");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("does not read admin finances when the current session is a customer", async () => {
    mocks.read.mockResolvedValue({
      ...admin,
      user: { ...admin.user!, role: "customer" },
    });
    const w = render("finance");
    await flushPromises();
    expect(w.find(".finance-summary").exists()).toBe(false);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain("没有访问权限");
  });
  it("commits a cursor only with its records, keeping a failed next-page retry on the same opaque cursor", async () => {
    const w = render("audit");
    await flushPromises();
    mocks.read.mockImplementation(
      async (path: string, query: Record<string, string>) => {
        if (path === "/session") return admin;
        if (query.cursor) throw { status: 500, code: "STORAGE_UNAVAILABLE" };
        return {
          items: [audit("first")],
          has_more: true,
          next_cursor: "opaque-next",
          limit: 50,
        };
      },
    );
    await button(w, "下一页").trigger("click");
    await flushPromises();
    expect(w.find(".cursor-pagination").text()).toContain("第 1 页");
    expect(w.text()).toContain("order.first");
    expect(mocks.read).toHaveBeenLastCalledWith("/admin/audit-events", {
      limit: "50",
      cursor: "opaque-next",
    });
    mocks.read.mockImplementation(async (path: string) =>
      path === "/session"
        ? admin
        : { items: [audit("second")], has_more: false, limit: 50 },
    );
    await button(w, "下一页").trigger("click");
    await flushPromises();
    expect(mocks.read).toHaveBeenLastCalledWith("/admin/audit-events", {
      limit: "50",
      cursor: "opaque-next",
    });
    expect(w.find(".cursor-pagination").text()).toContain("第 2 页");
    expect(w.text()).toContain("order.second");
    await w.find(".audit-filters input").setValue("order.created");
    expect(w.find(".cursor-pagination").text()).toContain("第 2 页");
    expect(button(w, "上一页").attributes("disabled")).toBeDefined();
    await w.find(".audit-filters").trigger("submit");
    await flushPromises();
    expect(mocks.read).toHaveBeenLastCalledWith("/admin/audit-events", {
      limit: "50",
      action: "order.created",
    });
    expect(w.find(".cursor-pagination").text()).toContain("第 1 页");
  });
  it("refuses a detail response for another record instead of exposing cancellation controls", async () => {
    const read = mocks.read.getMockImplementation()!;
    mocks.read.mockImplementation(async (path: string, query: unknown) =>
      path.endsWith(`/orders/${order().id}`)
        ? { ...details(), order: { ...order(), id: "wrong" } }
        : read(path, query),
    );
    const w = render("orders");
    await flushPromises();
    await button(w, "订单详情").trigger("click");
    await flushPromises();
    expect(w.find(".danger-section").exists()).toBe(false);
    expect(w.text()).toContain("INVALID_RESPONSE");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("rejects a cancellation response that changes historical amounts and blocks repeated submission", async () => {
    mocks.write.mockResolvedValue({
      order: { ...order(), status: "cancelled", total_minor: 1 },
      invoice: { ...invoice(), status: "void" },
    });
    const w = render("orders");
    await flushPromises();
    await button(w, "订单详情").trigger("click");
    await flushPromises();
    await w.find(".danger-section textarea").setValue("合成测试：客户取消");
    await button(w, "确认取消并作废账单").trigger("click");
    await flushPromises();
    expect(mocks.write).toHaveBeenCalledWith(
      `/admin/orders/${order().id}/cancel`,
      { reason: "合成测试：客户取消" },
    );
    expect(w.text()).toContain("结果待核对");
    expect(w.text()).not.toContain("订单已安全取消");
    expect(
      button(w, "确认取消并作废账单").attributes("disabled"),
    ).toBeDefined();
  });
  it("does not expose a customer checkout to an administrator", async () => {
    const w = render("invoices");
    await flushPromises();
    await button(w, "查看账单").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("客户完成付款后，账单状态会自动更新。");
    expect(button(w, "前往付款")).toBeUndefined();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("invalidates an existing checkout on header refresh and never infers paid from a link", async () => {
    mocks.write.mockResolvedValue({
      provider_id: "synthetic",
      session_id: "synthetic-session",
      checkout_url: "https://checkout.example.invalid/pay",
      expires_at: new Date(Date.now() + 600000).toISOString(),
    });
    const w = render("invoices", "customer");
    await flushPromises();
    await button(w, "查看并付款").trigger("click");
    await flushPromises();
    await button(w, "前往付款").trigger("click");
    await flushPromises();
    expect(w.find("a.checkout-ready").exists()).toBe(false);
    expect(w.find(".checkout-ready a").attributes("href")).toBe(
      "https://checkout.example.invalid/pay",
    );
    expect(w.find(".detail-hero").text()).toContain("未付款");
    await w.find(".heading-actions button").trigger("click");
    await flushPromises();
    expect(w.find(".checkout-ready").exists()).toBe(false);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it.each(["click", "auxclick"])(
    "blocks an expired checkout at the final %s when the wall clock advances before its timer",
    async (eventType) => {
      const expiry = Date.now() + 600000;
      mocks.write.mockResolvedValue({
        provider_id: "synthetic",
        session_id: "synthetic-session",
        checkout_url: "https://checkout.example.invalid/pay",
        expires_at: new Date(expiry).toISOString(),
      });
      const w = render("invoices", "customer");
      await flushPromises();
      await button(w, "查看并付款").trigger("click");
      await flushPromises();
      await button(w, "前往付款").trigger("click");
      await flushPromises();
      const before = new MouseEvent(eventType, {
        bubbles: true,
        cancelable: true,
      });
      w.find(".checkout-ready a").element.dispatchEvent(before);
      expect(before.defaultPrevented).toBe(false);
      vi.spyOn(Date, "now").mockReturnValue(expiry);
      const after = new MouseEvent(eventType, {
        bubbles: true,
        cancelable: true,
      });
      w.find(".checkout-ready a").element.dispatchEvent(after);
      expect(after.defaultPrevented).toBe(true);
      await flushPromises();
      expect(w.find(".checkout-ready a").exists()).toBe(false);
      expect(w.text()).toContain("付款链接已到期");
      expect(w.find(".detail-hero").text()).toContain("未付款");
      expect(mocks.write).toHaveBeenCalledTimes(1);
    },
  );
  it("never renders editable defaults after a failed account read", async () => {
    const read = mocks.read.getMockImplementation()!;
    mocks.read.mockImplementation(async (path: string, query: unknown) =>
      path.startsWith("/admin/customer-accounts/")
        ? Promise.reject({ status: 404, code: "NOT_FOUND" })
        : read(path, query),
    );
    const w = render("customers");
    await flushPromises();
    await button(w, "管理账户").trigger("click");
    await flushPromises();
    expect(w.find("#account-operation-form").exists()).toBe(false);
    expect(w.text()).toContain("NOT_FOUND");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("posts profile and role changes with the fetched revision, without attempting to change immutable email", async () => {
    mocks.write.mockResolvedValue({
      ...account(),
      name: "新管理员",
      role: "admin",
      revision: 4,
    });
    const w = render("customers");
    await flushPromises();
    await button(w, "管理账户").trigger("click");
    await flushPromises();
    const form = w.find("#account-operation-form");
    await form.findAll("input")[1]!.setValue("新管理员");
    await chooseAdmin(form);
    await form.find("textarea").setValue("合成测试：授予管理员");
    await form.trigger("submit");
    await flushPromises();
    expect(mocks.write).toHaveBeenCalledWith(
      `/admin/customer-accounts/${account().id}`,
      {
        name: "新管理员",
        role: "admin",
        disabled: false,
        revision: 3,
        reason: "合成测试：授予管理员",
      },
    );
    expect(w.text()).toContain("操作已由服务器确认");
    expect(w.find('[role="dialog"]').exists()).toBe(false);
  });
  it("resets a password without submitting an unsaved role draft and validates the unchanged original profile", async () => {
    mocks.write.mockResolvedValue({ ...account(), revision: 4 });
    const w = render("customers");
    await flushPromises();
    await button(w, "管理账户").trigger("click");
    await flushPromises();
    await chooseAdmin(w.find("#account-operation-form"));
    await button(w, "重置密码").trigger("click");
    await w
      .find('#account-operation-form input[type="password"]')
      .setValue("synthetic-password-2026");
    await w
      .find("#account-operation-form textarea")
      .setValue("合成测试：重置密码");
    await w.find("#account-operation-form").trigger("submit");
    await flushPromises();
    expect(mocks.write).toHaveBeenCalledWith(
      `/admin/customer-accounts/${account().id}/password`,
      {
        password: "synthetic-password-2026",
        revision: 3,
        reason: "合成测试：重置密码",
      },
    );
    expect(w.text()).toContain("操作已由服务器确认");
    expect(w.text()).not.toContain("synthetic-password-2026");
  });
  it("does not announce a role change when the success response has the wrong record revision", async () => {
    mocks.write.mockResolvedValue({ ...account(), role: "admin", revision: 3 });
    const w = render("customers");
    await flushPromises();
    await button(w, "管理账户").trigger("click");
    await flushPromises();
    await chooseAdmin(w.find("#account-operation-form"));
    await w
      .find("#account-operation-form textarea")
      .setValue("合成测试：更新权限");
    await w.find("#account-operation-form").trigger("submit");
    await flushPromises();
    expect(w.text()).toContain("结果待核对");
    expect(w.text()).not.toContain("操作已由服务器确认");
    expect(button(w, "确认保存").attributes("disabled")).toBeDefined();
  });
  it("does not apply a late account reconciliation to a subsequently opened account", async () => {
    const w = render("customers");
    await flushPromises();
    await button(w, "管理账户").trigger("click");
    await flushPromises();
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const read = mocks.read.getMockImplementation()!;
    mocks.read.mockImplementation(async (path: string, query: unknown) =>
      path === `/admin/customer-accounts/${account().id}`
        ? pending
        : read(path, query),
    );
    await button(w, "重读账户").trigger("click");
    await flushPromises();
    await button(w, "关闭").trigger("click");
    await button(w, "新建账户").trigger("click");
    await flushPromises();
    finish(account());
    await flushPromises();
    expect(w.find("#account-operation-form input").element).toHaveProperty(
      "value",
      "",
    );
    expect(w.find("#account-operation-form").text()).not.toContain(
      "revision 3",
    );
  });
});

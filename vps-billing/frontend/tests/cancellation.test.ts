// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import App from "../src/App.vue";
import { defaultSiteSettings } from "../src/lib/settings";
import { defaultCurrencyRegistry } from "../src/lib/currencies";
import { restorePreferences } from "../src/lib/i18n";
import * as fixtures from "../src/lib/preview";
import type { Invoice, Order, User } from "../src/lib/api";

let user: User | null;
let orders: Order[];
let invoices: Invoice[];
let requests: { path: string; options: RequestInit }[];
let onCancel: (() => Promise<unknown>) | undefined;
let refreshFails: boolean;
const response = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ data }),
});
const posts = () =>
  requests.filter((request) => request.path.endsWith("/cancel"));
function complete() {
  orders[0] = { ...orders[0]!, status: "cancelled" };
  invoices[0] = { ...invoices[0]!, status: "void" };
  return response({ order: orders[0], invoice: invoices[0] });
}
async function workspace(admin = false, english = false) {
  if (admin) user = { ...user!, role: "admin" };
  if (english) {
    localStorage.setItem("aster.locale", "en");
    restorePreferences();
  }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }],
  });
  await router.push("/orders");
  const wrapper = mount(App, {
    global: { plugins: [router] },
    attachTo: document.body,
  });
  await flushPromises();
  const dialog = wrapper.find('[data-testid="cancellation-dialog"]');
  const open = async () => {
    await wrapper.find(".order-cancel-action").trigger("click");
    await flushPromises();
  };
  const prepare = async (reason = "  No longer needed  ") => {
    await open();
    await dialog.find('[name="cancellation_reason"]').setValue(reason);
    await dialog.find('[name="confirm_cancellation"]').setValue(true);
  };
  const submit = async () => {
    await dialog.find("form").trigger("submit");
    await flushPromises();
  };
  return { wrapper, router, dialog, open, prepare, submit };
}
beforeEach(() => {
  localStorage.clear();
  restorePreferences();
  user = { ...fixtures.previewUser };
  orders = structuredClone(fixtures.orders);
  invoices = structuredClone(fixtures.invoices);
  requests = [];
  onCancel = undefined;
  refreshFails = false;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options: RequestInit) => {
      const endpoint = path.replace("/api/v1", "");
      requests.push({ path: endpoint, options });
      if (endpoint.endsWith("/cancel"))
        return onCancel ? onCancel() : complete();
      if (endpoint === "/session")
        return response({ user, csrf_token: "fresh-csrf", demo_mode: false });
      if (endpoint === "/currencies") return response(defaultCurrencyRegistry);
      if (endpoint === "/site-settings") return response(defaultSiteSettings);
      if (endpoint === "/orders" || endpoint === "/admin/orders") {
        if (refreshFails) throw new TypeError("history unavailable");
        return response(structuredClone(orders));
      }
      if (endpoint === "/invoices" || endpoint === "/admin/invoices")
        return response(structuredClone(invoices));
      if (
        endpoint.startsWith("/invoices/") ||
        endpoint.startsWith("/admin/invoices/")
      )
        return response(invoices[0]);
      if (endpoint.includes("/overview?")) {
        const unpaid = invoices.filter(
          (invoice) => invoice.status === "unpaid",
        );
        return response({
          customers: 1,
          total_services: 0,
          active_services: 0,
          unpaid_invoices: unpaid.length,
          pending_invoices: unpaid.length,
          unpaid_total_minor: unpaid.reduce(
            (sum, invoice) => sum + invoice.amount_minor,
            0,
          ),
          monthly_total_minor: 0,
          revenue_minor: 0,
          currency: "CNY",
          recent_orders: structuredClone(orders),
        });
      }
      if (endpoint === "/admin/customers") return response([user]);
      if (endpoint === "/services" || endpoint === "/audit")
        return response([]);
      if (endpoint.startsWith("/plans?"))
        return response(fixtures.previewPlans("CNY"));
      throw new Error("Unexpected endpoint " + endpoint);
    }),
  );
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("explicit unpaid order cancellation", () => {
  it.each([false, true])(
    "confirms the pair and refreshes the correct history and overview (admin=%s)",
    async (admin) => {
      const { wrapper, router, dialog, open, prepare, submit } =
        await workspace(admin);
      expect(wrapper.findAll(".order-cancel-action")).toHaveLength(1);
      await open();
      expect(dialog.text()).toContain("USD 24.00");
      expect(posts()).toHaveLength(0);
      await dialog.find('button[aria-label="关闭"]').trigger("click");
      expect(posts()).toHaveLength(0);
      await prepare();
      const firstRefresh = requests.length;
      await submit();
      expect(posts()).toHaveLength(1);
      expect(posts()[0]!.path).toBe(
        `${admin ? "/admin" : ""}/orders/o1/cancel`,
      );
      expect(JSON.parse(posts()[0]!.options.body as string)).toEqual({
        reason: "No longer needed",
      });
      expect(
        (posts()[0]!.options.headers as Record<string, string>)["X-CSRF-Token"],
      ).toBe("fresh-csrf");
      expect(dialog.attributes("open")).toBeUndefined();
      expect(wrapper.text()).toContain("已取消，关联账单已作废");
      expect(wrapper.find('[data-order-id="o1"] .badge').text()).toBe("已取消");
      expect(wrapper.findAll(".order-cancel-action")).toHaveLength(0);
      const refreshed = requests
        .slice(firstRefresh)
        .map((request) => request.path);
      for (const suffix of ["/orders", "/invoices", "/overview?currency=CNY"])
        expect(refreshed).toContain(`${admin ? "/admin" : ""}${suffix}`);
      if (admin) {
        expect(refreshed).not.toContain("/orders");
        expect(refreshed).not.toContain("/invoices");
      }
      await router.push("/invoices");
      await flushPromises();
      expect(wrapper.find("table").text()).toContain("已作废");
      expect(wrapper.find("table").text()).toContain("USD 24.00");
      wrapper.unmount();
    },
  );

  it("requires a bounded UTF-8 plain-text reason and separate confirmation even when submit is triggered directly", async () => {
    const { wrapper, dialog, open, submit } = await workspace();
    await open();
    const field = dialog.find('[name="cancellation_reason"]');
    const agreed = dialog.find('[name="confirm_cancellation"]');
    for (const reason of [
      "",
      "   ",
      "中".repeat(167),
      "line\nbreak",
      "<script>",
    ]) {
      await field.setValue(reason);
      await agreed.setValue(true);
      await submit();
      expect(posts()).toHaveLength(0);
      expect(
        dialog.find('button[type="submit"]').attributes("disabled"),
      ).toBeDefined();
    }
    await field.setValue("中".repeat(166));
    await agreed.setValue(false);
    await submit();
    expect(posts()).toHaveLength(0);
    await agreed.setValue(true);
    expect(
      dialog.find('button[type="submit"]').attributes("disabled"),
    ).toBeUndefined();
    wrapper.unmount();
  });

  it.each([
    ["INVALID_BODY", 400, "cancellation request is invalid"],
    ["INVALID_CANCELLATION", 400, "single-line plain-text reason"],
    ["NOT_FOUND", 404, "No accessible order"],
    ["CANCELLATION_STATE_CONFLICT", 409, "can no longer be cancelled"],
    ["CANCELLATION_UNAVAILABLE", 409, "current payment configuration"],
  ])(
    "translates %s safely without changing local financial states",
    async (code, status, text) => {
      onCancel = async () => ({
        ok: false,
        status,
        json: async () => ({
          error: {
            code,
            message: "private provider diagnostic",
            request_id: "request-123",
          },
        }),
      });
      const { wrapper, dialog, prepare, submit } = await workspace(false, true);
      await prepare();
      await submit();
      expect(dialog.find('[role="alert"]').text()).toContain(text);
      expect(dialog.text()).toContain("request-123");
      expect(dialog.text()).not.toContain("private provider diagnostic");
      expect(wrapper.find('[data-order-id="o1"] .badge').text()).toBe("Unpaid");
      expect(
        wrapper.find('[data-testid="cancellation-unconfirmed"]').exists(),
      ).toBe(false);
      expect(orders[0]!.status).toBe("pending_payment");
      wrapper.unmount();
    },
  );

  it("retains the exact reason after a lost response and retries only on explicit confirmation", async () => {
    let attempts = 0;
    onCancel = async () => {
      if (++attempts === 1) throw new TypeError("lost response");
      return complete();
    };
    const { wrapper, dialog, prepare, submit } = await workspace();
    await prepare("  original reason  ");
    await submit();
    expect(posts()).toHaveLength(1);
    expect(dialog.text()).toContain("取消结果尚未确认");
    expect(wrapper.find('[data-order-id="o1"] .badge').text()).toBe("待付款");
    expect(
      dialog.find('[name="cancellation_reason"]').attributes("disabled"),
    ).toBeDefined();
    await wrapper.find('select[aria-label="语言"]').setValue("en");
    await flushPromises();
    expect(posts()).toHaveLength(1);
    await submit();
    expect(posts()).toHaveLength(2);
    expect(posts()[1]!.options.body).toBe(posts()[0]!.options.body);
    expect(
      requests.filter((request) => request.path === "/session"),
    ).toHaveLength(2);
    expect(wrapper.text()).toContain(
      "was cancelled and its invoice was voided",
    );
    wrapper.unmount();
  });

  it("settles an ambiguous committed result through read-only history without resending", async () => {
    onCancel = async () => {
      complete();
      throw new TypeError("response lost after commit");
    };
    const { wrapper, dialog, prepare, submit } = await workspace();
    await prepare();
    await submit();
    expect(
      wrapper.find('[data-testid="cancellation-unconfirmed"]').exists(),
    ).toBe(true);
    await dialog
      .findAll("button")
      .find((button) => button.text() === "查看最新订单记录")!
      .trigger("click");
    await flushPromises();
    expect(posts()).toHaveLength(1);
    expect(
      wrapper.find('[data-testid="cancellation-unconfirmed"]').exists(),
    ).toBe(false);
    expect(wrapper.find('[data-order-id="o1"] .badge').text()).toBe("已取消");
    expect(wrapper.text()).toContain("关联账单已作废");
    wrapper.unmount();
  });

  it("does not accept malformed successful responses or forget ambiguity after a later rejection", async () => {
    let attempts = 0;
    onCancel = async () =>
      ++attempts === 1
        ? response({ order: orders[0] })
        : {
            ok: false,
            status: 409,
            json: async () => ({
              error: {
                code: "CANCELLATION_STATE_CONFLICT",
                message: "private",
              },
            }),
          };
    const { wrapper, dialog, prepare, submit } = await workspace();
    await prepare();
    await submit();
    expect(dialog.text()).toContain("取消结果尚未确认");
    await submit();
    expect(posts()).toHaveLength(2);
    expect(
      wrapper.find('[data-testid="cancellation-unconfirmed"]').exists(),
    ).toBe(true);
    expect(
      dialog.find('[name="cancellation_reason"]').attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.find('[data-order-id="o1"] .badge').text()).toBe("待付款");
    wrapper.unmount();
  });

  it("never resends an uncertain cancellation under a different account", async () => {
    onCancel = async () => {
      throw new TypeError("unknown");
    };
    const { wrapper, dialog, prepare, submit } = await workspace();
    await prepare();
    await submit();
    user = { ...user!, id: "another-account" };
    await submit();
    expect(posts()).toHaveLength(1);
    expect(dialog.attributes("open")).toBeUndefined();
    expect(wrapper.text()).toContain("原取消请求未重发");
    expect(
      wrapper.find('[data-testid="cancellation-unconfirmed"]').exists(),
    ).toBe(false);
    expect(dialog.find('[name="cancellation_reason"]').element).toHaveProperty(
      "value",
      "",
    );
    wrapper.unmount();
  });

  it("blocks duplicate submits and closing while a request is in flight", async () => {
    let finish!: (value: unknown) => void;
    onCancel = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const { wrapper, dialog, prepare, submit } = await workspace();
    await prepare();
    await submit();
    expect(
      dialog.find('button[aria-label="关闭"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      dialog.find('[name="cancellation_reason"]').attributes("disabled"),
    ).toBeDefined();
    await submit();
    expect(posts()).toHaveLength(1);
    finish(complete());
    await flushPromises();
    expect(dialog.attributes("open")).toBeUndefined();
    wrapper.unmount();
  });

  it("retains a confirmed cancellation when refreshing history fails", async () => {
    onCancel = async () => {
      const result = complete();
      refreshFails = true;
      return result;
    };
    const { wrapper, prepare, submit } = await workspace();
    await prepare();
    await submit();
    expect(wrapper.text()).toContain("已取消，关联账单已作废");
    expect(wrapper.find('[data-order-id="o1"] .badge').text()).toBe("已取消");
    expect(
      wrapper.find('[data-testid="cancellation-unconfirmed"]').exists(),
    ).toBe(false);
    expect(wrapper.text()).toContain("无法连接服务器");
    wrapper.unmount();
  });
});

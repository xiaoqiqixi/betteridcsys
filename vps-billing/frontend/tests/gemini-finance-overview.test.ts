// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import GeminiFinanceOverview, {
  type CurrencyFormat,
  type FinanceInvoiceItem,
  type FinanceSummary,
} from "../src/components/GeminiFinanceOverview.vue";

const cny = (): CurrencyFormat => ({
  code: "CNY",
  name: "人民币",
  prefix: "¥",
  suffix: "",
  decimal_places: 2,
});
const summary = (): FinanceSummary => ({
  customers: 12,
  total_services: 8,
  unpaid_invoices: 1,
  unpaid_total_minor: 123456,
  revenue_minor: 123456,
  currency: "CNY",
  currency_format: cny(),
  count_scope: "currency",
  customers_scope: "all",
});
const invoice = (): FinanceInvoiceItem => ({
  id: "synthetic-invoice",
  number: "INV-SYNTHETIC",
  order_id: "synthetic-order",
  status: "unpaid",
  currency: "CNY",
  amount_minor: 123456,
  currency_format: cny(),
  issued_at: "2026-10-21T00:00:00Z",
  due_at: "2026-10-28T00:00:00Z",
});
let wrappers: VueWrapper[] = [];
function screen(props: Record<string, unknown> = {}) {
  const wrapper = mount(GeminiFinanceOverview, {
    props: {
      locale: "zh-CN",
      summary: summary(),
      invoices: [invoice()],
      loading: false,
      error: "",
      ...props,
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}
const revenue = (wrapper: VueWrapper) =>
  wrapper.findAll(".gfo-cell-val")[0]!.text();
const amount = (wrapper: VueWrapper) => wrapper.find(".gfo-amount").text();
function moneyScreen(
  minor: unknown,
  format: unknown = cny(),
  currency: unknown = "CNY",
) {
  return screen({
    summary: {
      ...summary(),
      revenue_minor: minor,
      currency,
      currency_format: format,
    },
    invoices: [
      { ...invoice(), amount_minor: minor, currency, currency_format: format },
    ],
  });
}
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers = [];
});

describe("received Gemini finance overview: exact historical money and statuses", () => {
  it("groups maximum-safe minor units without floating-point rounding", () => {
    const wrapper = moneyScreen(
      Number.MAX_SAFE_INTEGER,
      { ...cny(), code: "KWD", prefix: "", suffix: " د.ك", decimal_places: 3 },
      "KWD",
    );
    expect(revenue(wrapper)).toBe("9,007,199,254,740.991 د.ك");
    expect(amount(wrapper)).toBe("9,007,199,254,740.991 د.ك");
    expect(wrapper.text()).not.toContain("9,007,199,254,740.992");
  });
  it.each([
    [0, "¥123,456"],
    [1, "¥12,345.6"],
    [2, "¥1,234.56"],
    [3, "¥123.456"],
    [4, "¥12.3456"],
    [5, "¥1.23456"],
    [6, "¥0.123456"],
  ])("uses the supplied %i-place precision exactly", (precision, expected) => {
    const wrapper = moneyScreen(123456, {
      ...cny(),
      decimal_places: precision,
    });
    expect(revenue(wrapper)).toBe(expected);
    expect(amount(wrapper)).toBe(expected);
  });
  it.each([
    [0, "¥0.00"],
    [-1, "-¥0.01"],
    [1, "¥0.01"],
    [-Number.MAX_SAFE_INTEGER, "-¥90,071,992,547,409.91"],
  ])("retains the exact sign and minor units for %s", (minor, expected) => {
    const wrapper = moneyScreen(minor);
    expect(revenue(wrapper)).toBe(expected);
    expect(amount(wrapper)).toBe(expected);
  });
  it.each([
    NaN,
    Infinity,
    -Infinity,
    123.45,
    Number.MAX_SAFE_INTEGER + 1,
    "123456",
    null,
    undefined,
  ])("shows unknown rather than inventing an amount for %s", (minor) => {
    const wrapper = moneyScreen(minor);
    expect(revenue(wrapper)).toBe("—");
    expect(amount(wrapper)).toBe("—");
  });
  it.each([-1, 7, 1.5, NaN, "2", undefined])(
    "does not guess a default for invalid precision %s",
    (precision) => {
      const wrapper = moneyScreen(123456, {
        ...cny(),
        decimal_places: precision,
      });
      expect(revenue(wrapper)).toBe("—");
      expect(amount(wrapper)).toBe("—");
    },
  );
  it.each([
    undefined,
    null,
    { ...cny(), code: "USD" },
    { ...cny(), name: undefined },
    { ...cny(), prefix: undefined },
    { ...cny(), suffix: undefined },
  ])(
    "does not substitute current preferences for a missing or contradictory money snapshot %s",
    (format) => {
      // Explicit undefined must not trigger the helper's default argument.
      const wrapper = screen({
        summary: { ...summary(), currency_format: format },
        invoices: [{ ...invoice(), currency_format: format }],
      });
      expect(revenue(wrapper)).toBe("—");
      expect(amount(wrapper)).toBe("—");
    },
  );
  it.each(["cny", "CN", "", 156, null])(
    "rejects an invalid or noncanonical currency code %s",
    (currency) => {
      const wrapper = moneyScreen(
        123456,
        { ...cny(), code: currency },
        currency,
      );
      expect(revenue(wrapper)).toBe("—");
      expect(amount(wrapper)).toBe("—");
    },
  );
  it("preserves prefix and suffix literally without inserting an unsolicited separator", () => {
    const wrapper = moneyScreen(123456, {
      ...cny(),
      prefix: "RMB ",
      suffix: "元",
    });
    expect(revenue(wrapper)).toBe("RMB 1,234.56元");
    expect(amount(wrapper)).toBe("RMB 1,234.56元");
  });
  it("preserves a nonbreaking suffix separator and provides a currency label when both affixes are empty", () => {
    const literal = moneyScreen(123456, {
      ...cny(),
      prefix: "",
      suffix: "\u00a0元",
    });
    expect(revenue(literal)).toBe("1,234.56\u00a0元");
    expect(amount(literal)).toBe("1,234.56\u00a0元");
    const plain = moneyScreen(123456, { ...cny(), prefix: "", suffix: "" });
    expect(revenue(plain)).toBe("1,234.56 CNY");
    expect(amount(plain)).toBe("1,234.56 CNY");
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "12"])(
    "does not turn invalid counts into zero or a warning for %s",
    (count) => {
      const wrapper = screen({
        summary: {
          ...summary(),
          customers: count,
          total_services: count,
          unpaid_invoices: count,
        },
      });
      expect(
        wrapper
          .findAll(".gfo-cell-val")
          .slice(2)
          .map((node) => node.text()),
      ).toEqual(["—", "—", "—"]);
      expect(wrapper.findAll(".gfo-cell-val")[2]!.classes()).not.toContain(
        "is-warn",
      );
    },
  );
  it("distinguishes a confirmed zero count from unknown", () => {
    const wrapper = screen({
      summary: {
        ...summary(),
        customers: 0,
        total_services: 1000,
        unpaid_invoices: 0,
      },
    });
    expect(
      wrapper
        .findAll(".gfo-cell-val")
        .slice(2)
        .map((node) => node.text()),
    ).toEqual(["0", "1,000", "0"]);
  });
  it.each([
    ["paid", "已支付", "ok"],
    ["unpaid", "未支付", "warn"],
    ["void", "已作废", "neutral"],
    ["PAID", "PAID", "neutral"],
    ["review_needed", "review_needed", "neutral"],
    ["toString", "toString", "neutral"],
    ["__proto__", "__proto__", "neutral"],
    ["", "—", "neutral"],
  ])(
    "labels status %s without normalizing unknown values into successful states",
    (status, label, tone) => {
      const wrapper = screen({ invoices: [{ ...invoice(), status }] });
      expect(wrapper.find(".gfo-status").text()).toBe(label);
      expect(wrapper.find(".gfo-status").attributes("data-tone")).toBe(tone);
    },
  );
  it("updates English copy from the locale and escapes record content", () => {
    const wrapper = screen({
      locale: "en-US",
      invoices: [
        {
          ...invoice(),
          number: "<img src=x onerror=alert(1)>",
          status: "paid",
        },
      ],
    });
    expect(wrapper.find("h1").text()).toBe("Financial overview");
    expect(wrapper.find(".gfo-status").text()).toBe("Paid");
    expect(wrapper.find(".gfo-inv-num").text()).toBe(
      "<img src=x onerror=alert(1)>",
    );
    expect(wrapper.find("img").exists()).toBe(false);
  });
});

describe("finance overview loading, failure and user-event contract", () => {
  it("does not render a loading or failed first read as a confirmed empty result", () => {
    const loading = screen({ summary: null, invoices: [], loading: true });
    expect(loading.attributes("aria-busy")).toBe("true");
    expect(loading.find('[role="status"]').exists()).toBe(true);
    expect(loading.find(".gfo-empty").exists()).toBe(false);
    expect(loading.find(".gfo-summary").exists()).toBe(false);
    const failed = screen({
      summary: null,
      invoices: [],
      error: "Synthetic read failure",
    });
    expect(failed.find('[role="alert"]').text()).toContain(
      "Synthetic read failure",
    );
    expect(failed.find(".gfo-empty").exists()).toBe(false);
    expect(failed.find(".gfo-panel").exists()).toBe(false);
  });
  it("shows the empty state only after a successful empty read", () => {
    const wrapper = screen({ summary: null, invoices: [] });
    expect(wrapper.find(".gfo-empty").exists()).toBe(true);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
  it("keeps previous records visible with the failed-refresh warning", () => {
    const wrapper = screen({ error: "Synthetic refresh failure" });
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.find(".gfo-summary").exists()).toBe(true);
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.find(".gfo-empty").exists()).toBe(false);
  });
  it("keeps cached records during refresh and stops duplicate refresh clicks", async () => {
    const wrapper = screen({ loading: true });
    expect(wrapper.attributes("aria-busy")).toBe("true");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(
      wrapper.find(".gfo-header .gfo-btn").attributes("disabled"),
    ).toBeDefined();
    await wrapper.find(".gfo-header .gfo-btn").trigger("click");
    expect(wrapper.emitted("refresh")).toBeUndefined();
    await wrapper.setProps({ loading: false });
    await wrapper.find(".gfo-header .gfo-btn").trigger("click");
    expect(wrapper.emitted("refresh")).toEqual([[]]);
  });
  it("emits only the exact selected invoice ID and never changes a financial record", async () => {
    const record = {
      ...invoice(),
      id: "synthetic/id?not-a-route",
      status: "unpaid",
    };
    const snapshot = JSON.stringify(record),
      wrapper = screen({ invoices: [record] });
    await wrapper.find(".gfo-btn-inspect").trigger("click");
    expect(wrapper.emitted("openInvoice")).toEqual([
      ["synthetic/id?not-a-route"],
    ]);
    expect(JSON.stringify(record)).toBe(snapshot);
    expect(wrapper.emitted("save")).toBeUndefined();
  });
});

// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import CustomerOverview from "../src/components/CustomerOverview.vue";
import { setLocale } from "../src/lib/i18n";
import { money, type Invoice, type Service } from "../src/lib/api";

const historical = {
  code: "USD",
  name: "US Dollar",
  prefix: "$",
  suffix: " USD",
  decimal_places: 2,
};
const invoice: Invoice = {
  id: "i",
  number: "INV-EXAMPLE",
  order_id: "o",
  status: "unpaid",
  amount_minor: 876543210098,
  currency: "USD",
  currency_format: historical,
  issued_at: "2026-10-01T00:00:00Z",
  due_at: "2026-10-21T00:00:00Z",
};
const service: Service = {
  id: "s",
  name: "api-example",
  plan_name: "Starter",
  region: "Singapore",
  ipv4: "192.0.2.1",
  status: "active",
  next_due_at: "2026-11-01T00:00:00Z",
  price_minor: 3900,
  currency: "CNY",
  cpu: 1,
  memory_gb: 2,
  disk_gb: 40,
};
const props = {
  overview: {
    active_services: 1,
    pending_invoices: 0,
    monthly_total_minor: 3900,
    unpaid_total_minor: 0,
    currency: "CNY",
    recent_orders: [],
  },
  services: [service],
  orders: [],
  unpaid: [invoice],
  currency: "CNY",
};

beforeEach(() => setLocale("zh-CN"));
describe("customer overview financial presentation", () => {
  it("keeps invoice historical formatting independent from selected-currency totals", () => {
    const wrapper = mount(CustomerOverview, { props });
    expect(wrapper.get(".customer-invoice-amount").text()).toBe(
      money(invoice.amount_minor, "USD", historical),
    );
    expect(wrapper.get(".account-facts").text()).toContain(money(3900, "CNY"));
    expect(wrapper.get(".account-scope").text()).toContain("CNY");
    expect(wrapper.findAll(".customer-cost-item")).toHaveLength(1);
  });
  it("opens the original invoice and routes the empty-state action without mutation", async () => {
    const wrapper = mount(CustomerOverview, {
      props: { ...props, services: [] },
    });
    await wrapper.get(".customer-invoice .button").trigger("click");
    expect(wrapper.emitted("invoice")?.[0]?.[0]).toEqual(invoice);
    await wrapper.get(".customer-empty .button").trigger("click");
    expect(wrapper.emitted("navigate")?.[0]).toEqual(["plans"]);
  });
  it("renders English empty states while preserving the selected currency", () => {
    setLocale("en");
    const wrapper = mount(CustomerOverview, {
      props: { ...props, services: [], unpaid: [] },
    });
    expect(wrapper.text()).toContain("No cloud servers yet");
    expect(wrapper.text()).toContain("No unpaid invoices");
    expect(wrapper.get(".account-scope").text()).toContain("CNY");
  });
});

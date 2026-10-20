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
  it.each(["zh-CN", "en"] as const)(
    "labels the first four cost items and routes to all services in %s without changing totals",
    async (language) => {
      setLocale(language);
      const services = Array.from({ length: 5 }, (_, index) => ({
        ...service,
        id: `s-${index}`,
        name: `service-${index + 1}`,
      }));
      const wrapper = mount(CustomerOverview, {
        props: {
          ...props,
          services,
          overview: { ...props.overview, monthly_total_minor: 19500 },
        },
      });
      expect(wrapper.findAll(".customer-cost-item")).toHaveLength(4);
      expect(wrapper.get(".customer-cost-scope").text()).toContain(
        language === "en"
          ? "Showing the first 4 service costs."
          : "仅显示前 4 项服务费用。",
      );
      expect(wrapper.get(".account-facts").text()).toContain(
        money(19500, "CNY"),
      );
      await wrapper.get(".customer-cost-scope button").trigger("click");
      expect(wrapper.emitted("navigate")?.[0]).toEqual(["services"]);
      await wrapper.setProps({ services: services.slice(0, 4) });
      expect(wrapper.find(".customer-cost-scope").exists()).toBe(false);
      wrapper.unmount();
    },
  );
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

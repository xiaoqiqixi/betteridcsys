import { tr, type Currency } from "./i18n";
import type { Plan, Service, Order, Invoice, User, Audit } from "./api";
export const previewUser: User = {
  id: "preview-customer",
  email: "hello@example.com",
  name: "Alex",
  role: "customer",
};
export const plans: Plan[] = [
  {
    id: "p1",
    name: "Starter",
    description: "适合个人网站和测试环境。",
    cpu: 1,
    memory_gb: 2,
    disk_gb: 40,
    transfer_tb: 1,
    region: "新加坡 · Singapore",
    price_minor: 600,
    currency: "USD",
    price_revision: 1,
    currency_format: {
      code: "USD",
      name: "US Dollar",
      prefix: "",
      suffix: "",
      decimal_places: 2,
    },
    available: true,
  },
  {
    id: "p2",
    name: "Essential",
    description: "适合中小型网站和应用。",
    cpu: 2,
    memory_gb: 4,
    disk_gb: 80,
    transfer_tb: 2,
    region: "新加坡 · Singapore",
    price_minor: 1200,
    currency: "USD",
    price_revision: 1,
    currency_format: {
      code: "USD",
      name: "US Dollar",
      prefix: "",
      suffix: "",
      decimal_places: 2,
    },
    available: true,
  },
  {
    id: "p3",
    name: "Performance",
    description: "适合需要更多资源的应用。",
    cpu: 4,
    memory_gb: 8,
    disk_gb: 160,
    transfer_tb: 4,
    region: "东京 · Tokyo",
    price_minor: 2400,
    currency: "USD",
    price_revision: 1,
    currency_format: {
      code: "USD",
      name: "US Dollar",
      prefix: "",
      suffix: "",
      decimal_places: 2,
    },
    available: true,
  },
];
export const services: Service[] = [
  {
    id: "s1",
    name: "production-api",
    plan_name: "Essential",
    region: "新加坡 · Singapore",
    ipv4: "192.0.2.18",
    status: "active",
    next_due_at: "2026-11-01T00:00:00Z",
    price_minor: 1200,
    currency: "USD",
    cpu: 2,
    memory_gb: 4,
    disk_gb: 80,
  },
  {
    id: "s2",
    name: "studio-website",
    plan_name: "Starter",
    region: "东京 · Tokyo",
    ipv4: "192.0.2.42",
    status: "active",
    next_due_at: "2026-11-08T00:00:00Z",
    price_minor: 600,
    currency: "USD",
    cpu: 1,
    memory_gb: 2,
    disk_gb: 40,
  },
  {
    id: "s3",
    name: "data-worker",
    plan_name: "Performance",
    region: "新加坡 · Singapore",
    ipv4: "192.0.2.76",
    status: "active",
    next_due_at: "2026-11-12T00:00:00Z",
    price_minor: 2400,
    currency: "USD",
    cpu: 4,
    memory_gb: 8,
    disk_gb: 160,
  },
];
export const orders: Order[] = [
  {
    id: "o1",
    number: "ORD-202610-0042",
    plan_name: "Performance",
    status: "pending_payment",
    total_minor: 2400,
    currency: "USD",
    created_at: "2026-10-14T00:00:00Z",
  },
  {
    id: "o2",
    number: "ORD-202610-0038",
    plan_name: "Essential",
    status: "completed",
    total_minor: 1200,
    currency: "USD",
    created_at: "2026-10-01T00:00:00Z",
  },
];
export const invoices: Invoice[] = [
  {
    id: "i1",
    number: "INV-202610-0042",
    order_id: "o1",
    status: "unpaid",
    amount_minor: 2400,
    currency: "USD",
    issued_at: "2026-10-14T00:00:00Z",
    due_at: "2026-10-21T00:00:00Z",
  },
  {
    id: "i2",
    number: "INV-202610-0038",
    order_id: "o2",
    status: "paid",
    amount_minor: 1200,
    currency: "USD",
    issued_at: "2026-10-01T00:00:00Z",
    due_at: "2026-10-08T00:00:00Z",
    paid_at: "2026-10-01T00:00:00Z",
  },
];
export const audit: Audit[] = [
  {
    id: "a1",
    action: "order.created",
    target: "ORD-202610-0042",
    actor_email: "hello@example.com",
    created_at: "2026-10-14T00:00:00Z",
    detail: "订单已创建，等待付款。",
  },
  {
    id: "a2",
    action: "auth.login",
    target: "用户会话",
    actor_email: "hello@example.com",
    created_at: "2026-10-14T00:00:00Z",
    detail: "登录成功。",
  },
];

// Independent sample prices. No exchange-rate calculation; read-only preview data only.
const cnySamplePrices: Record<string, number> = {
  p1: 3900,
  p2: 7900,
  p3: 15900,
};
export function previewPlans(currency: Currency): Plan[] {
  if (currency !== "CNY" && currency !== "USD") return [];
  const descriptions = [
    tr(
      "适合个人网站和测试环境。",
      "For personal websites and test environments.",
    ),
    tr("适合中小型网站和应用。", "For small websites and applications."),
    tr(
      "适合需要更多资源的应用。",
      "For applications that need more resources.",
    ),
  ];
  return plans.map((plan, index) => ({
    ...plan,
    description: descriptions[index]!,
    currency,
    currency_format: {
      code: currency,
      name: currency,
      prefix: "",
      suffix: "",
      decimal_places: 2,
    },
    price_minor:
      currency === "CNY" ? cnySamplePrices[plan.id]! : plan.price_minor,
  }));
}

/** Entirely synthetic, in-memory preview. Never calls a network or opens a resource. */
import type {
  AdminAuditEvent,
  AdminOverview,
  AdminService,
  Catalog,
  CatalogInput,
  CatalogResult,
  CreateOrderInput,
  CurrencyDefinition,
  CurrencyFormat,
  CurrencyRegistry,
  CustomerAccount,
  EmailSettings,
  Invoice,
  Order,
  OrderDetails,
  Overview,
  Plan,
  PlanPricesUpdate,
  PublicSiteSettings,
  Query,
  Role,
  Session,
  SiteSettings,
  User,
} from "../types/idc";
import { formatMinor, parseMinor, validMinor } from "../types/idc";
import { ApiError } from "./api";

export const DEMO_CUSTOMER_ID = "11111111111111111111111111111111";
export const DEMO_ADMIN_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const copy = <T>(value: T): T => structuredClone(value);
const textBytes = (text: string) => new TextEncoder().encode(text).length;
function fail(code: string, status = 400, details?: unknown): never {
  throw new ApiError(code, status, { details });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("INVALID_BODY");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail("INVALID_BODY");
}
function text(value: unknown, max: number, required = true): string {
  if (
    typeof value !== "string" ||
    textBytes(value.trim()) > max ||
    (required && !value.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  )
    return fail("INVALID_BODY");
  return value.trim();
}
function positive(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (!validMinor(value) || value <= 0 || value > max)
    return fail("INVALID_BODY");
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") return fail("INVALID_BODY");
  return value;
}
function roleValue(value: unknown): Role {
  if (value !== "customer" && value !== "admin") return fail("INVALID_ACCOUNT");
  return value;
}
function password(value: unknown, reason: string): void {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    textBytes(value) < 16 ||
    textBytes(value) > 72 ||
    reason.includes(value)
  )
    fail("INVALID_ACCOUNT");
}
function user(account: CustomerAccount): User {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
  };
}
function format(currency: CurrencyDefinition): CurrencyFormat {
  return {
    code: currency.code,
    name: currency.name,
    prefix: currency.prefix,
    suffix: currency.suffix,
    decimal_places: currency.decimal_places,
  };
}

export function createDemoClient(currentRole: () => Role) {
  let serial = 1000;
  const id = () => (++serial).toString(16).padStart(32, "0");
  const now = () => new Date().toISOString();
  const actorId = () =>
    currentRole() === "admin" ? DEMO_ADMIN_ID : DEMO_CUSTOMER_ID;
  const accounts: CustomerAccount[] = [
    {
      id: DEMO_CUSTOMER_ID,
      email: "customer@example.invalid",
      name: "林知远 · 演示客户",
      role: "customer",
      disabled: false,
      revision: 1,
    },
    {
      id: "22222222222222222222222222222222",
      email: "studio@example.invalid",
      name: "青禾工作室 · 合成账户",
      role: "customer",
      disabled: false,
      revision: 1,
    },
    {
      id: DEMO_ADMIN_ID,
      email: "operator@example.invalid",
      name: "运营管理员 · 演示",
      role: "admin",
      disabled: false,
      revision: 1,
    },
    {
      id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      email: "backup-admin@example.invalid",
      name: "备用管理员 · 演示",
      role: "admin",
      disabled: false,
      revision: 1,
    },
  ];
  const registry: CurrencyRegistry = {
    revision: 3,
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
        precision_locked: true,
      },
      {
        code: "USD",
        name: "US Dollar",
        prefix: "$",
        suffix: "",
        decimal_places: 2,
        enabled: true,
        sort_order: 1,
        precision_locked: true,
      },
      {
        code: "JPY",
        name: "日本円 · 历史币种",
        prefix: "¥",
        suffix: "",
        decimal_places: 0,
        enabled: false,
        sort_order: 2,
        precision_locked: true,
      },
      {
        code: "KWD",
        name: "Kuwaiti Dinar",
        prefix: "",
        suffix: " د.ك",
        decimal_places: 3,
        enabled: true,
        sort_order: 3,
        precision_locked: true,
      },
    ],
  };
  const catalog: Catalog = {
    revision: 7,
    currency_revision: registry.revision,
    items: [
      {
        id: "hkg-essential",
        name: "香港 · Essential",
        description:
          "轻量应用、个人站点与开发环境。所有规格与价格均为合成演示。",
        region: "香港 HKG",
        cpu: 2,
        memory_gb: 4,
        disk_gb: 80,
        transfer_tb: 2,
        available: true,
        prices: [
          { currency: "CNY", amount_minor: 3900, available: true },
          { currency: "USD", amount_minor: 600, available: true },
        ],
      },
      {
        id: "hkg-balanced",
        name: "香港 · Balanced",
        description:
          "更从容的内存与存储，适合常驻应用。演示独立报价，非汇率换算。",
        region: "香港 HKG",
        cpu: 4,
        memory_gb: 8,
        disk_gb: 160,
        transfer_tb: 4,
        available: true,
        prices: [
          { currency: "CNY", amount_minor: 7900, available: true },
          { currency: "USD", amount_minor: 1200, available: true },
        ],
      },
      {
        id: "tyo-performance",
        name: "东京 · Performance",
        description: "高配合成示例，便于检查长规格、对比与手机布局。",
        region: "东京 TYO",
        cpu: 8,
        memory_gb: 16,
        disk_gb: 320,
        transfer_tb: 8,
        available: true,
        prices: [
          { currency: "CNY", amount_minor: 15900, available: true },
          { currency: "USD", amount_minor: 2400, available: true },
        ],
      },
      {
        id: "sin-studio",
        name: "新加坡 · Studio",
        description: "当前仅提供人民币独立报价；选择美元时应显示暂不可购买。",
        region: "新加坡 SIN",
        cpu: 4,
        memory_gb: 8,
        disk_gb: 120,
        transfer_tb: 3,
        available: true,
        prices: [{ currency: "CNY", amount_minor: 8900, available: true }],
      },
      {
        id: "draft-compute",
        name: "计算优化 · 草稿",
        description: "未上架的演示草稿，可编辑规格及各币种报价。",
        region: "东京 TYO",
        cpu: 16,
        memory_gb: 32,
        disk_gb: 480,
        transfer_tb: 10,
        available: false,
        prices: [],
      },
    ],
  };
  const currency = (code: string, enabled = false) => {
    const found = registry.currencies.find((item) => item.code === code);
    if (!found) return fail("UNSUPPORTED_CURRENCY");
    if (enabled && !found.enabled) return fail("CURRENCY_DISABLED", 409);
    return found;
  };
  const cny = format(currency("CNY")),
    usd = format(currency("USD")),
    kwd = format(currency("KWD"));
  const issuer = {
    name: "AetherGrid · 合成演示开具方",
    address: "此地址仅为界面演示，不代表实际开票信息",
    support_email: "support@example.invalid",
  };
  const orders: Order[] = [
    {
      id: "33333333333333333333333333333333",
      number: "ORD-DEMO-20261021-001",
      plan_name: "香港 · Essential",
      hostname: "studio-web",
      status: "pending_payment",
      total_minor: 3900,
      currency: "CNY",
      currency_format: cny,
      created_at: "2026-10-21T00:30:00Z",
      issuer,
      plan_snapshot: {
        plan_id: "hkg-essential",
        name: "香港 · Essential（历史快照）",
        cpu: 2,
        memory_gb: 4,
        disk_gb: 80,
        transfer_tb: 2,
        region: "香港 HKG",
        billing_cycle: "monthly",
      },
    },
    {
      id: "44444444444444444444444444444444",
      number: "ORD-DEMO-20261020-002",
      plan_name: "香港 · Balanced",
      hostname: "api-lab",
      status: "cancelled",
      total_minor: 1200,
      currency: "USD",
      currency_format: usd,
      created_at: "2026-10-20T02:00:00Z",
      issuer,
    },
    {
      id: "55555555555555555555555555555555",
      number: "ORD-DEMO-LONG-AMOUNT",
      plan_name: "长金额与三位精度 · 合成边界样例",
      hostname: "precision-fixture",
      status: "pending_payment",
      total_minor: Number.MAX_SAFE_INTEGER,
      currency: "KWD",
      currency_format: kwd,
      created_at: "2026-10-19T09:00:00Z",
      issuer,
    },
  ];
  const owners = new Map(orders.map((item) => [item.id, DEMO_CUSTOMER_ID]));
  const invoices: Invoice[] = orders.map((order, index) => ({
    id: String(index + 6).repeat(32),
    number: `INV-DEMO-${String(index + 1).padStart(3, "0")}`,
    order_id: order.id,
    status: order.status === "cancelled" ? "void" : "unpaid",
    amount_minor: order.total_minor,
    currency: order.currency,
    currency_format: copy(order.currency_format),
    issued_at: order.created_at,
    due_at: "2026-10-28T00:00:00Z",
    issuer: copy(issuer),
  }));
  const services: AdminService[] = [
    {
      id: "cccccccccccccccccccccccccccccccc",
      customer_id: DEMO_CUSTOMER_ID,
      name: "studio-production · 合成样例",
      plan_name: "香港 · Balanced（历史规格）",
      region: "香港 HKG",
      ipv4: "192.0.2.24",
      status: "active",
      currency: "CNY",
      next_due_at: "2026-11-01T00:00:00Z",
      price_minor: 7900,
      currency_format: cny,
      cpu: 4,
      memory_gb: 8,
      disk_gb: 160,
    },
    {
      id: "dddddddddddddddddddddddddddddddd",
      customer_id: "22222222222222222222222222222222",
      name: "design-lab · 合成样例",
      plan_name: "东京 · Performance（历史规格）",
      region: "东京 TYO",
      ipv4: "198.51.100.42",
      status: "active",
      currency: "USD",
      next_due_at: "2026-11-08T00:00:00Z",
      price_minor: 2400,
      currency_format: usd,
      cpu: 8,
      memory_gb: 16,
      disk_gb: 320,
    },
  ];
  const events: AdminAuditEvent[] = [
    {
      id: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      action: "order.created",
      target: orders[0]!.id,
      actor_email: "customer@example.invalid",
      owner_id: DEMO_CUSTOMER_ID,
      detail: "合成演示：创建待付款订单；没有付款或资源开通。",
      created_at: "2026-10-21T00:30:00Z",
    },
    {
      id: "ffffffffffffffffffffffffffffffff",
      action: "order.cancelled",
      target: orders[1]!.id,
      actor_email: "operator@example.invalid",
      owner_id: DEMO_CUSTOMER_ID,
      detail: "合成演示：未付订单取消，关联账单作废。",
      created_at: "2026-10-20T03:00:00Z",
    },
  ];
  let site: SiteSettings = {
    revision: 1,
    default_locale: "zh-CN",
    default_currency: "CNY",
    site_name: "AetherGrid",
    company_name: "合成演示 · 非真实运营商",
    support_email: "support@example.invalid",
    support_url: "",
    display_url: "",
    logo: "server",
    theme: "teal",
    email_signature: "合成演示，不发送邮件",
    invoice_issuer: issuer.name,
    invoice_address: issuer.address,
  };
  const email: EmailSettings = {
    revision: 1,
    port: 587,
    enabled: false,
    username_configured: false,
    password_configured: false,
    key_configured: false,
    plugin_available: false,
    destination_allowed: false,
    host: "",
    from_address: "",
    from_name: "",
    plugin_version: "",
    tls_mode: "starttls",
    plugin_status: "not_installed",
    updated_at: "2026-10-21T00:00:00Z",
  };
  const replay = new Map<string, { fingerprint: string; order: Order }>();
  const cursors = new Map<string, { fingerprint: string; offset: number }>();
  function actor() {
    const account = accounts.find((item) => item.id === actorId());
    if (!account || account.disabled) return fail("AUTH_REQUIRED", 401);
    return account;
  }
  function requireAdmin() {
    if (actor().role !== "admin") fail("FORBIDDEN", 403);
  }
  function session(): Session {
    const account = accounts.find((item) => item.id === actorId());
    return {
      user: account && !account.disabled ? user(account) : null,
      csrf_token: "synthetic-local-preview-no-cookie",
      demo_mode: true,
    };
  }
  function event(
    action: string,
    target: string,
    reason: string,
    owner = actorId(),
  ) {
    events.unshift({
      id: id(),
      action,
      target,
      actor_email: actor().email,
      owner_id: owner,
      detail: `合成演示：${reason}`,
      created_at: now(),
    });
  }
  function scopedOrder(orderId: string, admin: boolean) {
    const order = orders.find((item) => item.id === orderId);
    if (!order || (!admin && owners.get(order.id) !== actorId()))
      return fail("NOT_FOUND", 404);
    return order;
  }
  function scopedOrders(admin: boolean) {
    return orders.filter((item) => admin || owners.get(item.id) === actorId());
  }
  function scopedInvoices(admin: boolean) {
    return invoices.filter(
      (item) => admin || owners.get(item.order_id) === actorId(),
    );
  }
  function scopedServices(admin: boolean) {
    return services.filter((item) => admin || item.customer_id === actorId());
  }
  function plans(code: string): Plan[] {
    const definition = currency(code, true);
    return catalog.items
      .filter((item) => item.available)
      .map((item) => {
        const price = item.prices.find((p) => p.currency === code);
        return {
          id: item.id,
          name: item.name,
          description: item.description,
          region: item.region,
          cpu: item.cpu,
          memory_gb: item.memory_gb,
          disk_gb: item.disk_gb,
          transfer_tb: item.transfer_tb,
          currency: code,
          price_minor: price?.amount_minor ?? 0,
          price_revision: catalog.revision,
          currency_format: format(definition),
          available: !!price?.available && !!price.amount_minor,
        };
      });
  }
  function page<T>(items: T[], query: Query, kind: string, allowed: string[]) {
    if (
      Object.keys(query).some((key) => !allowed.includes(key)) ||
      Object.values(query).some((value) => value === "")
    )
      return fail(
        kind === "audit" ? "INVALID_AUDIT_QUERY" : "INVALID_ACCOUNT_QUERY",
      );
    if (
      query.limit !== undefined &&
      typeof query.limit !== "number" &&
      (typeof query.limit !== "string" || !/^\d+$/.test(query.limit))
    )
      fail("INVALID_BODY");
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      return fail("INVALID_BODY");
    const { cursor, ...filters } = query;
    const fingerprint = JSON.stringify([
      kind,
      actorId(),
      Object.fromEntries(
        Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)),
      ),
      limit,
    ]);
    let offset = 0;
    if (cursor !== undefined) {
      const saved = cursors.get(String(cursor));
      if (!saved || saved.fingerprint !== fingerprint)
        return fail(
          kind === "audit" ? "INVALID_AUDIT_QUERY" : "INVALID_ACCOUNT_QUERY",
        );
      offset = saved.offset;
    }
    const next = offset + limit,
      has_more = items.length > next;
    const next_cursor = has_more ? `demo-cursor-${id()}` : undefined;
    if (next_cursor) cursors.set(next_cursor, { fingerprint, offset: next });
    return {
      items: items.slice(offset, next),
      has_more,
      ...(next_cursor ? { next_cursor } : {}),
      limit,
    };
  }
  function details(orderId: string, admin: boolean): OrderDetails {
    const order = scopedOrder(orderId, admin),
      owner = accounts.find((item) => item.id === owners.get(order.id));
    return {
      order,
      ...(admin && owner ? { customer: user(owner) } : {}),
      invoice: invoices.find((item) => item.order_id === order.id) ?? null,
      service: order.service_id
        ? (services.find((item) => item.id === order.service_id) ?? null)
        : null,
      payment_attempts: [],
      audit: events
        .filter((item) => item.target === order.id)
        .map(({ owner_id: _, ...item }) => item),
      audit_has_more: false,
      payment_attempts_has_more: false,
    };
  }
  const safeSum = (values: number[]) => {
    const sum = values.reduce((total, amount) => total + BigInt(amount), 0n);
    if (sum > BigInt(Number.MAX_SAFE_INTEGER))
      return fail("INVALID_RESPONSE", 500);
    return Number(sum);
  };

  async function read<T>(path: string, query: Query = {}): Promise<T> {
    if (!["/session", "/site-settings", "/currencies", "/plans"].includes(path))
      actor();
    if (path.startsWith("/admin/")) requireAdmin();
    let value: unknown;
    const admin = path.startsWith("/admin/");
    const normalized = admin ? path.slice(6) : path;
    const code = String(query.currency ?? "CNY");
    if (path === "/session") value = session();
    else if (path === "/site-settings") {
      const {
        revision: _,
        email_signature: _s,
        invoice_issuer: _i,
        invoice_address: _a,
        ...publicSite
      } = site;
      value = publicSite satisfies PublicSiteSettings;
    } else if (normalized === "/currencies")
      value = admin
        ? {
            ...registry,
            currencies: registry.currencies.map((item) => ({
              ...item,
              usage: {
                plan_prices: catalog.items.filter((plan) =>
                  plan.prices.some((price) => price.currency === item.code),
                ).length,
                orders: orders.filter((order) => order.currency === item.code)
                  .length,
                invoices: invoices.filter(
                  (invoice) => invoice.currency === item.code,
                ).length,
                services: services.filter(
                  (service) => service.currency === item.code,
                ).length,
                pending_orders: orders.filter(
                  (order) =>
                    order.currency === item.code &&
                    order.status === "pending_payment",
                ).length,
                unpaid_invoices: invoices.filter(
                  (invoice) =>
                    invoice.currency === item.code &&
                    invoice.status === "unpaid",
                ).length,
                ongoing_services: services.filter(
                  (service) =>
                    service.currency === item.code &&
                    service.status === "active",
                ).length,
              },
            })),
          }
        : registry;
    else if (path === "/plans") value = plans(code);
    else if (path === "/admin/catalog") {
      if (Object.keys(query).length) fail("INVALID_CATALOG");
      value = catalog;
    } else if (normalized === "/overview") {
      const definition = currency(code),
        selected = scopedOrders(admin).filter((item) => item.currency === code),
        selectedInvoices = scopedInvoices(admin).filter(
          (item) => item.currency === code,
        ),
        selectedServices = scopedServices(admin).filter(
          (item) => item.currency === code,
        );
      value = admin
        ? ({
            customers: accounts.filter((item) => item.role === "customer")
              .length,
            total_services: selectedServices.length,
            unpaid_invoices: selectedInvoices.filter(
              (item) => item.status === "unpaid",
            ).length,
            unpaid_total_minor: safeSum(
              selectedInvoices
                .filter((item) => item.status === "unpaid")
                .map((item) => item.amount_minor),
            ),
            revenue_minor: 0,
            currency: code,
            currency_format: format(definition),
            count_scope: "currency",
            customers_scope: "all",
          } satisfies AdminOverview)
        : ({
            active_services: selectedServices.filter(
              (item) => item.status === "active",
            ).length,
            pending_invoices: selectedInvoices.filter(
              (item) => item.status === "unpaid",
            ).length,
            unpaid_total_minor: safeSum(
              selectedInvoices
                .filter((item) => item.status === "unpaid")
                .map((item) => item.amount_minor),
            ),
            monthly_total_minor: safeSum(
              selectedServices.map((item) => item.price_minor),
            ),
            currency: code,
            currency_format: format(definition),
            recent_orders: scopedOrders(false).slice(0, 5),
            count_scope: "currency",
            recent_orders_scope: "all",
          } satisfies Overview);
      void selected;
    } else if (normalized === "/services")
      value = scopedServices(admin).map((item) => {
        if (admin) return item;
        const { customer_id: _, ...service } = item;
        return service;
      });
    else if (normalized === "/orders") value = scopedOrders(admin);
    else if (/^\/orders\/[^/]+$/.test(normalized))
      value = details(decodeURIComponent(normalized.slice(8)), admin);
    else if (normalized === "/invoices") value = scopedInvoices(admin);
    else if (/^\/invoices\/[^/]+$/.test(normalized)) {
      const invoice = scopedInvoices(admin).find(
        (item) => item.id === decodeURIComponent(normalized.slice(10)),
      );
      if (!invoice) fail("NOT_FOUND", 404);
      value = invoice;
    } else if (path === "/admin/customers")
      value = accounts.filter((item) => item.role === "customer").map(user);
    else if (path === "/admin/customer-accounts") {
      if (
        (query.role !== undefined &&
          query.role !== "customer" &&
          query.role !== "admin") ||
        (query.status !== undefined &&
          query.status !== "active" &&
          query.status !== "disabled")
      )
        fail("INVALID_ACCOUNT_QUERY");
      const q = String(query.q ?? "")
        .trim()
        .toLowerCase();
      value = page(
        accounts
          .filter(
            (item) =>
              (!q || `${item.name} ${item.email}`.toLowerCase().includes(q)) &&
              (!query.role || item.role === query.role) &&
              (!query.status ||
                item.disabled === (query.status === "disabled")),
          )
          .sort((a, b) => b.id.localeCompare(a.id)),
        query,
        "accounts",
        ["q", "role", "status", "limit", "cursor"],
      );
    } else if (/^\/admin\/customer-accounts\/[^/]+$/.test(path)) {
      if (Object.keys(query).length) fail("INVALID_ACCOUNT_QUERY");
      value = accounts.find((item) => item.id === path.split("/").at(-1));
      if (!value) fail("NOT_FOUND", 404);
    } else if (normalized === "/audit-events" || path === "/audit") {
      const global = admin || (path === "/audit" && currentRole() === "admin");
      if (!admin && query.owner_id !== undefined) fail("INVALID_AUDIT_QUERY");
      if (
        (query.action !== undefined &&
          !/^[a-z][a-z0-9_.-]{0,63}$/.test(String(query.action))) ||
        (query.owner_id !== undefined &&
          !/^[a-f0-9]{32}$/.test(String(query.owner_id)))
      )
        fail("INVALID_AUDIT_QUERY");
      if (
        textBytes(
          new URLSearchParams(
            Object.entries(query)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [key, String(value)]),
          ).toString(),
        ) > 4096 ||
        (query.actor_email !== undefined &&
          (typeof query.actor_email !== "string" ||
            textBytes(query.actor_email) > 254))
      )
        fail("INVALID_AUDIT_QUERY");
      for (const key of ["from", "until"])
        if (
          query[key] !== undefined &&
          (typeof query[key] !== "string" ||
            !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
              String(query[key]),
            ))
        )
          fail("INVALID_AUDIT_QUERY");
      const from =
          query.from === undefined ? null : Date.parse(String(query.from)),
        until =
          query.until === undefined ? null : Date.parse(String(query.until));
      if (
        (from !== null && !Number.isFinite(from)) ||
        (until !== null && !Number.isFinite(until)) ||
        (from !== null && until !== null && from >= until)
      )
        fail("INVALID_AUDIT_QUERY");
      const filtered = events
        .filter(
          (item) =>
            (global || item.owner_id === actorId()) &&
            (!query.action || item.action === query.action) &&
            (!query.actor_email || item.actor_email === query.actor_email) &&
            (!query.owner_id || item.owner_id === query.owner_id) &&
            (from === null || Date.parse(item.created_at) >= from) &&
            (until === null || Date.parse(item.created_at) < until),
        )
        .sort(
          (a, b) =>
            b.created_at.localeCompare(a.created_at) ||
            b.id.localeCompare(a.id),
        )
        .map((item) => {
          if (admin) return item;
          const { owner_id: _, ...audit } = item;
          return audit;
        });
      value =
        path === "/audit"
          ? filtered
          : page(filtered, query, "audit", [
              "action",
              "actor_email",
              "owner_id",
              "from",
              "until",
              "limit",
              "cursor",
            ]);
    } else if (path === "/admin/plan-prices") {
      const definition = currency(code);
      value = {
        revision: catalog.revision,
        currency: code,
        currency_format: format(definition),
        plans: catalog.items.map((item) => {
          const price = item.prices.find((p) => p.currency === code);
          return {
            plan_id: item.id,
            plan_name: item.name,
            plan_available: item.available,
            available: price?.available ?? false,
            amount_minor: price?.amount_minor ?? 0,
            amount: price
              ? formatMinor(price.amount_minor, definition.decimal_places)
              : "",
          };
        }),
      };
    } else if (path === "/admin/site-settings") value = site;
    else if (path === "/admin/email-settings") value = email;
    else if (path === "/admin/integrations")
      value = {
        items: [
          {
            id: "payment-demo-unconfigured",
            name: "支付 · 演示未配置",
            description: "界面预览不会创建真实支付会话，不会收款。",
            kind: "payment",
            enabled: false,
            configured: false,
            status: "disabled",
            capabilities: [],
            supported_currencies: [],
            limitations: ["合成演示，未连接任何支付渠道"],
            currency_decimal_places: {},
            configuration_mode: "environment",
            configuration_fields: [],
          },
          {
            id: "smtp-demo-unconfigured",
            name: "邮件 · 演示未配置",
            description: "界面预览不发送邮件，不保存真实凭据。",
            kind: "email",
            enabled: false,
            configured: false,
            status: "disabled",
            capabilities: [],
            supported_currencies: [],
            limitations: ["合成演示，未连接SMTP"],
            currency_decimal_places: {},
            configuration_mode: "admin_api",
            configuration_fields: [],
          },
        ],
      };
    else if (path === "/admin/updates")
      value = {
        current: {
          core_version: "0.5.7",
          smtp_version: "",
          smtp_status: "not_installed",
          plugin_policy_revision: 1,
        },
        source: {
          repository: "xiaoqiqixi/betteridcsys",
          status: "not_checked",
        },
        checked_at: "",
        items: [],
        mode: "manual_host_handoff",
      };
    else if (path === "/admin/updates/operation")
      value = { state: "unconfigured" };
    else return fail("NOT_FOUND", 404);
    return copy(value) as T;
  }

  function checkCatalog(value: unknown): CatalogInput {
    const body = object(value);
    exact(body, [
      "name",
      "description",
      "region",
      "cpu",
      "memory_gb",
      "disk_gb",
      "transfer_tb",
      "available",
      "prices",
      "revision",
      "currency_revision",
      "reason",
    ]);
    if (body.revision !== catalog.revision) fail("CATALOG_CONFLICT", 409);
    if (body.currency_revision !== registry.revision)
      fail("CURRENCY_CONFLICT", 409);
    const name = text(body.name, 120),
      description = text(body.description, 500, false),
      region = text(body.region, 120),
      reason = text(body.reason, 500);
    const cpu = positive(body.cpu, 4096),
      memory_gb = positive(body.memory_gb, 1048576),
      disk_gb = positive(body.disk_gb, 16777216),
      transfer_tb = positive(body.transfer_tb, 1048576),
      available = bool(body.available);
    if (!Array.isArray(body.prices) || body.prices.length > 32)
      fail("INVALID_CATALOG");
    const seen = new Set<string>();
    const prices = (body.prices as unknown[]).map((raw) => {
      const price = object(raw);
      exact(price, ["currency", "amount_minor", "available"]);
      const code = text(price.currency, 3);
      if (!/^[A-Z]{3}$/.test(code) || seen.has(code))
        return fail("INVALID_CATALOG");
      currency(code);
      seen.add(code);
      return {
        currency: code,
        amount_minor: positive(price.amount_minor),
        available: bool(price.available),
      };
    });
    if (
      available &&
      !prices.some(
        (price) => price.available && currency(price.currency).enabled,
      )
    )
      fail("INVALID_CATALOG");
    return {
      name,
      description,
      region,
      cpu,
      memory_gb,
      disk_gb,
      transfer_tb,
      available,
      prices,
      revision: catalog.revision,
      currency_revision: registry.revision,
      reason,
    };
  }

  async function write<T>(
    path: string,
    raw: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    actor();
    if (path.startsWith("/admin/")) requireAdmin();
    const body = object(raw);
    let value: unknown;
    if (path === "/auth/login" || path === "/auth/logout")
      return fail("DEMO_AUTH_UNAVAILABLE", 409);
    if (path === "/orders") {
      exact(body, ["plan_id", "hostname", "currency", "quote"]);
      const input = body as unknown as CreateOrderInput;
      const planId = text(input.plan_id, 64),
        hostname = text(input.hostname, 63).toLowerCase(),
        code = text(input.currency, 3);
      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname))
        fail("VALIDATION_ERROR");
      const key = Object.entries(headers).find(
        ([name]) => name.toLowerCase() === "idempotency-key",
      )?.[1];
      if (!key || !/^[A-Za-z0-9_.:-]{8,128}$/.test(key))
        fail("IDEMPOTENCY_KEY_REQUIRED");
      const replayKey = `${actorId()}:${key}`,
        fingerprint = JSON.stringify([planId, hostname, code]);
      const original = replay.get(replayKey);
      if (original) {
        if (original.fingerprint !== fingerprint)
          fail("IDEMPOTENCY_CONFLICT", 409);
        return copy(original.order) as T;
      }
      const quote = object(input.quote);
      exact(quote, ["price_minor", "decimal_places", "price_revision"]);
      const plan = plans(code).find((item) => item.id === planId);
      if (!plan?.available) fail("PLAN_UNAVAILABLE", 409);
      if (
        quote.price_minor !== plan.price_minor ||
        quote.decimal_places !== plan.currency_format.decimal_places ||
        quote.price_revision !== plan.price_revision
      )
        fail("PRICE_CHANGED", 409);
      const order: Order = {
        id: id(),
        number: `ORD-DEMO-${serial}`,
        plan_name: plan.name,
        hostname,
        status: "pending_payment",
        total_minor: plan.price_minor,
        currency: code,
        currency_format: copy(plan.currency_format),
        created_at: now(),
        issuer: copy(issuer),
        plan_snapshot: {
          plan_id: plan.id,
          name: plan.name,
          cpu: plan.cpu,
          memory_gb: plan.memory_gb,
          disk_gb: plan.disk_gb,
          transfer_tb: plan.transfer_tb,
          region: plan.region,
          billing_cycle: "monthly",
        },
      };
      orders.unshift(order);
      owners.set(order.id, actorId());
      invoices.unshift({
        id: id(),
        number: `INV-DEMO-${serial}`,
        order_id: order.id,
        status: "unpaid",
        currency: code,
        currency_format: copy(order.currency_format),
        amount_minor: order.total_minor,
        issued_at: order.created_at,
        due_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        issuer: copy(issuer),
      });
      replay.set(replayKey, { fingerprint, order: copy(order) });
      event("order.created", order.id, "创建待付款订单；没有付款或资源开通。");
      value = order;
    } else if (/^\/(?:admin\/)?orders\/[^/]+\/cancel$/.test(path)) {
      exact(body, ["reason"]);
      const reason = text(body.reason, 500),
        admin = path.startsWith("/admin/");
      const orderId = path.split("/").at(-2)!,
        order = scopedOrder(orderId, admin),
        invoice = invoices.find((item) => item.order_id === order.id);
      if (!invoice) fail("ORDER_NOT_CANCELLABLE", 409);
      if (order.status === "cancelled" && invoice.status === "void")
        return copy({ order, invoice }) as T;
      if (
        order.status !== "pending_payment" ||
        invoice.status !== "unpaid" ||
        order.service_id
      )
        fail("ORDER_NOT_CANCELLABLE", 409);
      order.status = "cancelled";
      invoice.status = "void";
      event("order.cancelled", order.id, reason, owners.get(order.id));
      value = { order, invoice };
    } else if (/^\/invoices\/[^/]+\/checkout$/.test(path)) {
      exact(body, []);
      if (currentRole() === "admin") fail("FORBIDDEN", 403);
      const invoice = scopedInvoices(false).find(
        (item) => item.id === path.split("/").at(-2),
      );
      if (!invoice) fail("NOT_FOUND", 404);
      if (invoice.status !== "unpaid") fail("INVOICE_NOT_PAYABLE", 409);
      return fail("PAYMENT_NOT_CONFIGURED", 503);
    } else if (/^\/admin\/catalog(?:\/[^/]+)?$/.test(path)) {
      const input = checkCatalog(body),
        existingId = path.split("/")[3];
      const existing = existingId
        ? catalog.items.find((item) => item.id === existingId)
        : undefined;
      if (existingId && !existing) fail("NOT_FOUND", 404);
      const { revision: _, currency_revision: _c, reason, ...fields } = input;
      const plan = {
        id: existing?.id ?? `demo-plan-${id().slice(-8)}`,
        ...fields,
      };
      if (existing) Object.assign(existing, copy(plan));
      else catalog.items.unshift(plan);
      catalog.revision++;
      catalog.currency_revision = registry.revision;
      event(existing ? "catalog.updated" : "catalog.created", plan.id, reason);
      value = {
        revision: catalog.revision,
        currency_revision: registry.revision,
        plan,
      } satisfies CatalogResult;
    } else if (/^\/admin\/catalog\/[^/]+\/duplicate$/.test(path)) {
      exact(body, ["revision", "currency_revision", "reason"]);
      const reason = text(body.reason, 500);
      if (body.revision !== catalog.revision) fail("CATALOG_CONFLICT", 409);
      if (body.currency_revision !== registry.revision)
        fail("CURRENCY_CONFLICT", 409);
      const original = catalog.items.find(
        (item) => item.id === path.split("/")[3],
      );
      if (!original) fail("NOT_FOUND", 404);
      const plan = {
        ...copy(original),
        id: `demo-plan-${id().slice(-8)}`,
        name: text(`${original.name} · 副本`, 120),
        available: false,
      };
      catalog.items.unshift(plan);
      catalog.revision++;
      event("catalog.duplicated", plan.id, reason);
      value = {
        revision: catalog.revision,
        currency_revision: registry.revision,
        plan,
      } satisfies CatalogResult;
    } else if (path === "/admin/customer-accounts") {
      exact(body, ["email", "name", "role", "password", "reason"]);
      const emailAddress = text(body.email, 254).toLowerCase(),
        name = text(body.name, 120),
        reason = text(body.reason, 500),
        role = roleValue(body.role);
      password(body.password, reason);
      if (
        !/^[\x21-\x7e]+$/.test(emailAddress) ||
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailAddress)
      )
        fail("INVALID_ACCOUNT");
      if (accounts.some((item) => item.email === emailAddress))
        fail("ACCOUNT_EXISTS", 409);
      const account: CustomerAccount = {
        id: id(),
        email: emailAddress,
        name,
        role,
        disabled: false,
        revision: 1,
      };
      accounts.unshift(account);
      event("account.created", account.id, reason, account.id);
      value = account;
    } else if (
      /^\/admin\/customer-accounts\/[^/]+(?:\/(?:password|revoke-sessions))?$/.test(
        path,
      )
    ) {
      const account = accounts.find((item) => item.id === path.split("/")[3]);
      if (!account) fail("NOT_FOUND", 404);
      const action = path.split("/")[4];
      exact(
        body,
        action === "password"
          ? ["password", "revision", "reason"]
          : action === "revoke-sessions"
            ? ["revision", "reason"]
            : ["name", "role", "disabled", "revision", "reason"],
      );
      if (body.revision !== account.revision) fail("ACCOUNT_CONFLICT", 409);
      const reason = text(body.reason, 500);
      if (action === "password") password(body.password, reason);
      else if (!action) {
        const name = text(body.name, 120),
          role = roleValue(body.role),
          disabled = bool(body.disabled);
        if (account.id === actorId() && (role !== "admin" || disabled))
          fail("SELF_ACCOUNT_CHANGE", 409);
        if (
          account.role === "admin" &&
          !account.disabled &&
          (role !== "admin" || disabled) &&
          accounts.filter((item) => item.role === "admin" && !item.disabled)
            .length <= 1
        )
          fail("LAST_ACTIVE_ADMIN", 409);
        Object.assign(account, { name, role, disabled });
      }
      account.revision++;
      event(
        action === "password"
          ? "account.password_reset"
          : action === "revoke-sessions"
            ? "account.sessions_revoked"
            : "account.updated",
        account.id,
        reason,
        account.id,
      );
      value = account;
    } else if (path === "/admin/plan-prices") {
      exact(body, ["revision", "currency", "prices"]);
      const input = body as unknown as PlanPricesUpdate;
      if (input.revision !== catalog.revision) fail("PRICE_CONFLICT", 409);
      const definition = currency(input.currency, true);
      if (
        !Array.isArray(input.prices) ||
        !input.prices.length ||
        input.prices.length > 500
      )
        fail("INVALID_PLAN_PRICES");
      const seen = new Set<string>();
      const changes = input.prices.map((rawPrice) => {
        const price = object(rawPrice);
        exact(price, ["plan_id", "amount", "available", "plan_available"]);
        const plan = catalog.items.find((item) => item.id === price.plan_id);
        if (!plan || seen.has(plan.id) || typeof price.amount !== "string")
          return fail("INVALID_PLAN_PRICES");
        seen.add(plan.id);
        const amount_minor = parseMinor(
          price.amount,
          definition.decimal_places,
        );
        return {
          plan,
          amount_minor,
          available: bool(price.available),
          plan_available: bool(price.plan_available),
        };
      });
      for (const change of changes) {
        const proposedPrices = change.plan.prices
          .filter((item) => item.currency !== definition.code)
          .concat({
            currency: definition.code,
            amount_minor: change.amount_minor,
            available: change.available,
          });
        if (
          change.plan_available &&
          !proposedPrices.some(
            (price) => price.available && currency(price.currency).enabled,
          )
        )
          fail("INVALID_PLAN_PRICES");
      }
      for (const change of changes) {
        const existing = change.plan.prices.find(
          (item) => item.currency === definition.code,
        );
        if (existing)
          Object.assign(existing, {
            amount_minor: change.amount_minor,
            available: change.available,
          });
        else
          change.plan.prices.push({
            currency: definition.code,
            amount_minor: change.amount_minor,
            available: change.available,
          });
        change.plan.available = change.plan_available;
      }
      catalog.revision++;
      event(
        "plan_prices.updated",
        definition.code,
        "编辑独立演示报价，未变更历史订单。",
      );
      return read<T>("/admin/plan-prices", { currency: definition.code });
    } else if (path === "/admin/site-settings") {
      exact(body, [
        "revision",
        "default_locale",
        "default_currency",
        "site_name",
        "company_name",
        "support_email",
        "support_url",
        "display_url",
        "logo",
        "theme",
        "email_signature",
        "invoice_issuer",
        "invoice_address",
      ]);
      if (body.revision !== site.revision) fail("SETTINGS_CONFLICT", 409);
      if (
        !["zh-CN", "en"].includes(String(body.default_locale)) ||
        !["star", "cloud", "server"].includes(String(body.logo)) ||
        !["blue", "teal", "violet"].includes(String(body.theme))
      )
        fail("INVALID_BODY");
      currency(String(body.default_currency), true);
      const limits: Record<string, number> = {
        site_name: 120,
        company_name: 240,
        support_email: 254,
        support_url: 500,
        display_url: 300,
        email_signature: 1000,
        invoice_issuer: 240,
        invoice_address: 1000,
      };
      for (const [key, max] of Object.entries(limits))
        text(body[key], max, key === "site_name" || key === "invoice_issuer");
      for (const key of ["support_url", "display_url"])
        if (body[key]) {
          let url: URL;
          try {
            url = new URL(String(body[key]));
          } catch {
            return fail("INVALID_BODY");
          }
          if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            url.hash ||
            (key === "display_url" && (url.pathname !== "/" || url.search))
          )
            fail("INVALID_BODY");
        }
      site = {
        ...(copy(body) as unknown as SiteSettings),
        revision: site.revision + 1,
      };
      event(
        "site_settings.updated",
        "site",
        "修改演示站点设置；历史开具信息不变。",
      );
      value = site;
    } else if (path === "/admin/email-settings/test")
      return fail("SMTP_DISABLED", 409);
    else if (
      path === "/admin/email-settings" ||
      path === "/admin/currencies" ||
      path.startsWith("/admin/updates/")
    )
      return fail("DEMO_OPERATION_UNAVAILABLE", 409);
    else return fail("NOT_FOUND", 404);
    return copy(value) as T;
  }
  return { read, write, session };
}

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  LayoutDashboard,
  Server,
  Layers,
  ReceiptText,
  ShoppingBag,
  Users,
  ShieldCheck,
  Activity,
  Search,
  ChevronRight,
  ChevronDown,
  Plus,
  RefreshCw,
  LogOut,
  X,
  Check,
  CheckCircle2,
  AlertCircle,
  Clock3,
  LockKeyhole,
  Download,
  Menu,
  CircleHelp,
  Sparkles,
  LoaderCircle,
  Puzzle,
  Settings,
  Cloud,
  Star,
} from "@lucide/vue";
import {
  api,
  ApiError,
  setCsrf,
  money,
  date,
  statusLabel,
  statusTone,
  readCheckoutSession,
  readOrderQuote,
} from "./lib/api";
import type {
  Session,
  Plan,
  Service,
  Order,
  Invoice,
  Audit,
  User,
  Overview,
  AdminOverview,
  CheckoutSession,
  OrderQuote,
} from "./lib/api";
import SettingsPage from "./components/SettingsPage.vue";
import UpdatesPage from "./components/UpdatesPage.vue";
import PlansPage from "./components/PlansPage.vue";
import FinancialSettingsPage from "./components/FinancialSettingsPage.vue";
import { readCurrencyRegistry, type CurrencyRegistry } from "./lib/currencies";
import {
  defaultSiteSettings,
  readPublicSiteSettings,
  safeSettingsEmailHref,
  safeSettingsURL,
  type PublicSiteSettings,
  type SiteSettings,
} from "./lib/settings";
import {
  locale,
  currency,
  tr,
  setLocale,
  setCurrency,
  applyDefaults,
  applyCurrencyRegistry,
  enabledCurrencies,
  currencyRegistry,
} from "./lib/i18n";
import IntegrationsPage from "./components/IntegrationsPage.vue";
import * as fixture from "./lib/preview";
import {
  readCancellationReason,
  readCancellationResult,
  cancellationError,
  cancellationIsUncertain,
  type CancellationResult,
} from "./lib/cancellation";
const route = useRoute(),
  router = useRouter();
const session = ref<Session>({ user: null, csrf_token: "", demo_mode: false }),
  booting = ref(true),
  loading = ref(false),
  saving = ref(false),
  preview = ref(false),
  disconnected = ref(false);
const branding = ref<PublicSiteSettings>({ ...defaultSiteSettings });
const brandIcon = computed(
  () => ({ star: Star, cloud: Cloud, server: Server })[branding.value.logo],
);
function applyBranding(value: PublicSiteSettings | SiteSettings) {
  branding.value = readPublicSiteSettings(value);
  applyDefaults(value.default_locale, value.default_currency);
}
function selectLocale(event: Event) {
  setLocale((event.target as HTMLSelectElement).value);
}
function selectCurrency(event: Event) {
  const code = (event.target as HTMLSelectElement).value;
  if (isAdmin.value) {
    if (!currencyRegistry.value.currencies.some((item) => item.code === code))
      return;
    reportCurrency.value = code;
    void load();
  } else setCurrency(code);
}
const integrationRefresh = ref(0);
const error = ref(""),
  notice = ref(""),
  modalError = ref(""),
  query = ref(""),
  menuOpen = ref(false);
const email = ref(""),
  password = ref(""),
  loginError = ref("");
const plans = ref<Plan[]>([]),
  services = ref<Service[]>([]),
  orders = ref<Order[]>([]),
  invoices = ref<Invoice[]>([]),
  audit = ref<Audit[]>([]),
  customers = ref<User[]>([]);
const overview = ref<Overview>(),
  adminOverview = ref<AdminOverview>();
const orderDialog = ref<HTMLDialogElement>(),
  cancellationDialog = ref<HTMLDialogElement>(),
  invoiceDialog = ref<HTMLDialogElement>(),
  helpDialog = ref<HTMLDialogElement>();
const selectedPlan = ref<Plan>(),
  selectedInvoice = ref<Invoice>(),
  hostname = ref(""),
  agreed = ref(false),
  orderKey = ref("");
const orderCatalogChanged = ref(false);
const selectedCancellation = ref<Order>(),
  cancellationReason = ref(""),
  cancellationAgreed = ref(false),
  cancellationMessage = ref(""),
  cancellationBlocked = ref(false);
interface CancellationAttempt {
  order: Order;
  invoice?: Invoice;
  reason: string;
  admin: boolean;
  uncertain: boolean;
}
const cancellationAttempts = ref<Record<string, CancellationAttempt>>({});
const cancellationAccount = computed(() =>
  session.value.user
    ? `${session.value.user.id}:${session.value.user.role}`
    : "",
);
const pendingCancellation = computed(
  () => cancellationAttempts.value[cancellationAccount.value],
);
const cancellationReasonBytes = computed(
  () => new TextEncoder().encode(cancellationReason.value.trim()).length,
);
const cancellationReasonValid = computed(() => {
  try {
    readCancellationReason(cancellationReason.value);
    return true;
  } catch {
    return false;
  }
});
const checkoutSession = ref<CheckoutSession>();
const checkoutHost = computed(() =>
  checkoutSession.value
    ? new URL(checkoutSession.value.checkout_url).hostname
    : "",
);
const isAdmin = computed(() => session.value.user?.role === "admin");
const reportCurrency = ref("");
const displayCurrency = computed(() =>
  isAdmin.value &&
  currencyRegistry.value.currencies.some(
    (item) => item.code === reportCurrency.value,
  )
    ? reportCurrency.value
    : currency.value,
);
const viewCurrencies = computed(() =>
  isAdmin.value
    ? [...currencyRegistry.value.currencies].sort(
        (a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code),
      )
    : enabledCurrencies.value,
);
const page = computed(() => route.path.split("/")[1] || "overview");
const nav = computed(() =>
  isAdmin.value
    ? [
        {
          id: "overview",
          label: tr("运营总览", "Operations overview"),
          icon: LayoutDashboard,
        },
        { id: "customers", label: tr("客户管理", "Customers"), icon: Users },
        {
          id: "orders",
          label: tr("全部订单", "All orders"),
          icon: ShoppingBag,
        },
        {
          id: "invoices",
          label: tr("账单管理", "Invoices"),
          icon: ReceiptText,
        },
        { id: "audit", label: tr("审计日志", "Audit log"), icon: Activity },
        {
          id: "integrations",
          label: tr("扩展中心", "Integrations"),
          icon: Puzzle,
        },
        {
          id: "finance",
          label: tr("财务设置", "Financial settings"),
          icon: ReceiptText,
        },
        {
          id: "settings",
          label: tr("站点设置", "Site settings"),
          icon: Settings,
        },
        {
          id: "updates",
          label: tr("版本更新", "Version updates"),
          icon: Download,
        },
      ]
    : [
        {
          id: "overview",
          label: tr("工作台", "Overview"),
          icon: LayoutDashboard,
        },
        {
          id: "services",
          label: tr("云服务器", "Cloud servers"),
          icon: Server,
        },
        { id: "plans", label: tr("选购服务", "Browse plans"), icon: Layers },
        { id: "orders", label: tr("我的订单", "My orders"), icon: ShoppingBag },
        {
          id: "invoices",
          label: tr("账单与付款", "Invoices and payments"),
          icon: ReceiptText,
        },
      ],
);
const pageTitle = computed(() =>
  page.value === "account"
    ? tr("账户与安全", "Account and security")
    : nav.value.find((n) => n.id === page.value)?.label ||
      tr("页面未找到", "Page not found"),
);
const matches = (value: unknown) =>
  JSON.stringify(value).toLowerCase().includes(query.value.toLowerCase());
const filteredServices = computed(() => services.value.filter(matches)),
  filteredOrders = computed(() => orders.value.filter(matches)),
  filteredInvoices = computed(() => invoices.value.filter(matches)),
  filteredCustomers = computed(() => customers.value.filter(matches)),
  filteredAudit = computed(() => audit.value.filter(matches));
const unpaid = computed(() =>
  invoices.value.filter((i) =>
    ["unpaid", "open", "overdue", "pending"].includes(i.status),
  ),
);
const currencyServices = computed(() =>
  services.value.filter((s) => s.currency === displayCurrency.value),
);
const currencyUnpaid = computed(() =>
  unpaid.value.filter((i) => i.currency === displayCurrency.value),
);
const unpaidTotal = computed(() =>
  isAdmin.value
    ? adminOverview.value?.unpaid_total_minor
    : overview.value?.unpaid_total_minor,
);
const unpaidCount = computed(() =>
  isAdmin.value
    ? adminOverview.value?.unpaid_invoices
    : overview.value?.pending_invoices,
);
const monthly = computed(() => overview.value?.monthly_total_minor || 0);
const maxCost = computed(() =>
  Math.max(...currencyServices.value.map((s) => s.price_minor), 1),
);
const invoiceOrder = computed(() =>
  orders.value.find((o) => o.id === selectedInvoice.value?.order_id),
);
function go(path: string) {
  router.push("/" + path);
  menuOpen.value = false;
  query.value = "";
}
function explain(e: unknown) {
  return e instanceof ApiError
    ? `${e.message}${e.requestId ? tr(" · 请求编号 ", " · Request ID ") + e.requestId : ""}`
    : tr(
        "无法连接服务器。请检查网络，或稍后重试。",
        "Cannot connect to the server. Check your connection and try again.",
      );
}
async function init() {
  booting.value = true;
  loginError.value = "";
  try {
    const [site, currentSession, registry] = await Promise.all([
      api<unknown>("/site-settings"),
      api<Session>("/session"),
      api<unknown>("/currencies"),
    ]);
    applyCurrencyRegistry(readCurrencyRegistry(registry));
    applyBranding(readPublicSiteSettings(site));
    session.value = currentSession;
    setCsrf(session.value.csrf_token);
    disconnected.value = false;
    if (session.value.user) await load();
  } catch (e) {
    disconnected.value = true;
    loginError.value = explain(e);
  } finally {
    booting.value = false;
  }
}
async function login(role?: "customer" | "admin") {
  if (saving.value) return;
  if (role && session.value.demo_mode) {
    email.value = role === "admin" ? "admin@aster.local" : "demo@aster.local";
    password.value = role === "admin" ? "DemoAdmin!2026" : "DemoCustomer!2026";
  }
  saving.value = true;
  loginError.value = "";
  try {
    await api("/auth/login", "POST", {
      email: email.value,
      password: password.value,
    });
    session.value = await api<Session>("/session");
    setCsrf(session.value.csrf_token);
    password.value = "";
    preview.value = false;
    go("overview");
    await load();
  } catch (e) {
    loginError.value = explain(e);
  } finally {
    saving.value = false;
  }
}
async function logout() {
  if (saving.value) return;
  saving.value = true;
  try {
    if (!preview.value) await api("/auth/logout", "POST", {});
    loadGeneration++;
    orderDialog.value?.close();
    closeCancellation();
    closeInvoice();
    helpDialog.value?.close();
    selectedInvoice.value = undefined;
    checkoutSession.value = undefined;
    selectedPlan.value = undefined;
    pendingOrders.value = {};
    cancellationAttempts.value = {};
    notice.value = "";
    preview.value = false;
    session.value.user = null;
    services.value = [];
    orders.value = [];
    invoices.value = [];
    customers.value = [];
    audit.value = [];
    overview.value = undefined;
    adminOverview.value = undefined;
    await init();
  } catch (e) {
    error.value = explain(e);
  } finally {
    saving.value = false;
  }
}
function startPreview(admin = false) {
  preview.value = true;
  disconnected.value = false;
  session.value = {
    user: { ...fixture.previewUser, role: admin ? "admin" : "customer" },
    csrf_token: "",
    demo_mode: true,
  };
  go("overview");
  load();
}
let loadGeneration = 0;
let applyingRegistry = false;
function applyFinancialSettings(registry: CurrencyRegistry) {
  applyingRegistry = true;
  try {
    applyCurrencyRegistry(registry);
    branding.value.default_currency = currencyRegistry.value.default_currency;
  } finally {
    applyingRegistry = false;
  }
  void load();
}
async function load() {
  integrationRefresh.value++;
  const generation = ++loadGeneration;
  loading.value = true;
  error.value = "";
  try {
    if (preview.value) {
      plans.value = fixture.previewPlans(currency.value);
      services.value = fixture.services;
      orders.value = fixture.orders;
      invoices.value = fixture.invoices;
      audit.value = fixture.audit;
      customers.value = [fixture.previewUser];
      overview.value = {
        active_services: currencyServices.value.length,
        pending_invoices: currencyUnpaid.value.length,
        unpaid_total_minor: currencyUnpaid.value.reduce(
          (sum, i) => sum + i.amount_minor,
          0,
        ),
        monthly_total_minor: currencyServices.value.reduce(
          (sum, s) => sum + s.price_minor,
          0,
        ),
        currency: currency.value,
        recent_orders: fixture.orders,
      };
      adminOverview.value = {
        customers: 1,
        total_services: currencyServices.value.length,
        unpaid_invoices: currencyUnpaid.value.length,
        unpaid_total_minor: currencyUnpaid.value.reduce(
          (sum, i) => sum + i.amount_minor,
          0,
        ),
        revenue_minor: invoices.value
          .filter(
            (i) => i.currency === displayCurrency.value && i.status === "paid",
          )
          .reduce((sum, i) => sum + i.amount_minor, 0),
        currency: currency.value,
      };
      return;
    }
    const registry = readCurrencyRegistry(await api<unknown>("/currencies"));
    if (generation !== loadGeneration) return;
    applyingRegistry = true;
    try {
      applyCurrencyRegistry(registry);
    } finally {
      applyingRegistry = false;
    }
    const requestedCurrency = displayCurrency.value;
    if (isAdmin.value) {
      const [a, b, c, d, e] = await Promise.all([
        api<AdminOverview>(
          "/admin/overview?currency=" + encodeURIComponent(requestedCurrency),
        ),
        api<User[]>("/admin/customers"),
        api<Order[]>("/admin/orders"),
        api<Invoice[]>("/admin/invoices"),
        api<Audit[]>("/audit"),
      ]);
      if (
        generation !== loadGeneration ||
        requestedCurrency !== displayCurrency.value
      )
        return;
      adminOverview.value = a;
      customers.value = b;
      orders.value = c;
      invoices.value = d;
      audit.value = e;
    } else {
      const [a, b, c, d, e, f] = await Promise.all([
        api<Overview>(
          "/overview?currency=" + encodeURIComponent(requestedCurrency),
        ),
        api<Service[]>("/services"),
        api<Plan[]>("/plans?currency=" + encodeURIComponent(requestedCurrency)),
        api<Order[]>("/orders"),
        api<Invoice[]>("/invoices"),
        api<Audit[]>("/audit"),
      ]);
      if (
        generation !== loadGeneration ||
        requestedCurrency !== displayCurrency.value
      )
        return;
      overview.value = a;
      services.value = b;
      plans.value = c;
      orders.value = d;
      invoices.value = e;
      audit.value = f;
    }
    reconcileCancellation();
  } catch (e) {
    if (generation !== loadGeneration) return;
    error.value = explain(e);
    if (
      e instanceof ApiError &&
      ["UNAUTHORIZED", "AUTH_REQUIRED"].includes(e.code)
    )
      session.value.user = null;
  } finally {
    if (generation === loadGeneration) loading.value = false;
  }
}
function closeCancellation() {
  cancellationDialog.value?.close();
  selectedCancellation.value = undefined;
  cancellationReason.value = "";
  cancellationAgreed.value = false;
  cancellationMessage.value = "";
  cancellationBlocked.value = false;
}
async function openCancellation(order: Order) {
  if (preview.value || saving.value || loading.value) return;
  const attempt = pendingCancellation.value;
  if (!attempt && order.status !== "pending_payment") return;
  closeInvoice();
  selectedCancellation.value = structuredClone(
    JSON.parse(JSON.stringify(attempt?.order || order)),
  );
  cancellationReason.value = attempt?.reason || "";
  cancellationAgreed.value = !!attempt;
  cancellationMessage.value = "";
  cancellationBlocked.value = false;
  await nextTick();
  if (selectedCancellation.value) cancellationDialog.value?.showModal();
}
function completeCancellation(result: CancellationResult, account: string) {
  delete cancellationAttempts.value[account];
  if (account !== cancellationAccount.value) return;
  orders.value = orders.value.map((order) =>
    order.id === result.order.id ? result.order : order,
  );
  invoices.value = invoices.value.map((invoice) =>
    invoice.id === result.invoice.id ? result.invoice : invoice,
  );
  closeCancellation();
  notice.value = tr(
    `订单 ${result.order.number} 已取消，关联账单已作废。`,
    `Order ${result.order.number} was cancelled and its invoice was voided.`,
  );
}
function reconcileCancellation() {
  const attempt = pendingCancellation.value;
  if (!attempt?.uncertain) return;
  const order = orders.value.find((item) => item.id === attempt.order.id);
  const invoice = invoices.value.find(
    (item) => item.order_id === attempt.order.id,
  );
  if (order?.status !== "cancelled" || invoice?.status !== "void") return;
  try {
    completeCancellation(
      readCancellationResult(
        { order, invoice },
        attempt.order,
        attempt.invoice,
      ),
      cancellationAccount.value,
    );
  } catch {
    // Incomplete or conflicting history cannot settle an ambiguous request.
  }
}
async function cancelOrder() {
  if (
    preview.value ||
    saving.value ||
    loading.value ||
    !session.value.user ||
    !selectedCancellation.value ||
    !cancellationAgreed.value ||
    !cancellationReasonValid.value ||
    cancellationBlocked.value
  )
    return;
  const account = cancellationAccount.value;
  let attempt = cancellationAttempts.value[account];
  if (!attempt) {
    if (selectedCancellation.value.status !== "pending_payment") return;
    attempt = {
      order: selectedCancellation.value,
      invoice: invoices.value.find(
        (item) => item.order_id === selectedCancellation.value?.id,
      ),
      reason: readCancellationReason(cancellationReason.value),
      admin: isAdmin.value,
      uncertain: false,
    };
    cancellationAttempts.value[account] = attempt;
    attempt = cancellationAttempts.value[account]!;
  }
  saving.value = true;
  cancellationMessage.value = "";
  try {
    if (attempt.uncertain) {
      const refreshed = await api<Session>("/session");
      session.value = refreshed;
      setCsrf(refreshed.csrf_token);
      if (account !== cancellationAccount.value) {
        error.value = tr(
          "账户会话已变化，原取消请求未重发。请使用原账户登录后核对。",
          "The account session changed. The cancellation was not resent. Sign in to the original account to check it.",
        );
        return;
      }
    }
    const response = await api<unknown>(
      (attempt.admin ? "/admin/orders/" : "/orders/") +
        encodeURIComponent(attempt.order.id) +
        "/cancel",
      "POST",
      { reason: attempt.reason },
    );
    const result = readCancellationResult(
      response,
      attempt.order,
      attempt.invoice,
    );
    completeCancellation(result, account);
    if (account === cancellationAccount.value) await load();
  } catch (e) {
    if (attempt.uncertain || cancellationIsUncertain(e))
      attempt.uncertain = true;
    else delete cancellationAttempts.value[account];
    if (account !== cancellationAccount.value) return;
    cancellationMessage.value = cancellationError(e);
    if (!attempt.uncertain && e instanceof ApiError) {
      cancellationBlocked.value = [
        "NOT_FOUND",
        "CANCELLATION_STATE_CONFLICT",
        "CANCELLATION_UNAVAILABLE",
        "AUTH_REQUIRED",
        "UNAUTHORIZED",
        "FORBIDDEN",
      ].includes(e.code);
    }
  } finally {
    saving.value = false;
  }
}
async function checkCancellationHistory() {
  if (saving.value || loading.value) return;
  closeCancellation();
  go("orders");
  await load();
}
interface PendingOrder {
  key: string;
  plan: Plan;
  hostname: string;
  uncertain?: boolean;
  quote: OrderQuote;
}
// Keep an ambiguous attempt with its account during session expiry/re-login.
// Another account must never inherit its payload or idempotency key.
const pendingOrders = ref<Record<string, PendingOrder>>({});
const pendingOrder = computed({
  get: () => pendingOrders.value[session.value.user?.id || ""],
  set: (attempt: PendingOrder | undefined) => {
    const userId = session.value.user?.id;
    if (!userId) return;
    if (attempt) pendingOrders.value[userId] = attempt;
    else delete pendingOrders.value[userId];
  },
});
async function openOrder(plan: Plan) {
  if (saving.value) return;
  if (pendingOrder.value) {
    selectedPlan.value = pendingOrder.value.plan;
    hostname.value = pendingOrder.value.hostname;
    agreed.value = true;
    await nextTick();
    orderDialog.value?.showModal();
    return;
  }
  if (!plan.available || plan.currency !== currency.value) return;
  selectedPlan.value = {
    ...plan,
    ...(plan.currency_format
      ? { currency_format: { ...plan.currency_format } }
      : {}),
  };
  orderCatalogChanged.value = false;
  hostname.value = "";
  agreed.value = false;
  modalError.value = "";
  orderKey.value = crypto.randomUUID();
  await nextTick();
  orderDialog.value?.showModal();
}
function invalidateChangedOrder() {
  const draft = selectedPlan.value;
  if (!draft || pendingOrder.value) return false;
  const current = plans.value.find((plan) => plan.id === draft.id);
  const fields: (keyof Plan)[] = [
    "name",
    "description",
    "region",
    "cpu",
    "memory_gb",
    "disk_gb",
    "transfer_tb",
    "price_minor",
    "price_revision",
    "currency",
  ];
  if (
    current?.available &&
    current.currency === currency.value &&
    fields.every((field) => current[field] === draft[field]) &&
    JSON.stringify(current.currency_format) ===
      JSON.stringify(draft.currency_format)
  )
    return false;
  orderDialog.value?.close();
  selectedPlan.value = undefined;
  hostname.value = "";
  agreed.value = false;
  orderKey.value = "";
  orderCatalogChanged.value = true;
  return true;
}
async function createOrder() {
  if (
    preview.value ||
    !selectedPlan.value ||
    !agreed.value ||
    saving.value ||
    (loading.value && !pendingOrder.value)
  )
    return;
  if (invalidateChangedOrder()) return;
  if (!pendingOrder.value) {
    try {
      pendingOrder.value = {
        key: orderKey.value,
        plan: { ...selectedPlan.value },
        hostname: hostname.value,
        quote: readOrderQuote(selectedPlan.value),
      };
    } catch {
      modalError.value = tr(
        "报价信息不完整，请重新读取套餐后再确认。",
        "The quote is incomplete. Reload plans before confirming an order.",
      );
      return;
    }
  }
  const attempt = pendingOrder.value;
  const accountId = session.value.user?.id;
  saving.value = true;
  modalError.value = "";
  try {
    if (attempt.uncertain) {
      const refreshed = await api<Session>("/session");
      setCsrf(refreshed.csrf_token);
      session.value = refreshed;
      if (refreshed.user?.id !== accountId) {
        error.value = tr(
          "账户会话已变化，原订单未重发。请使用原账户登录后核对。",
          "The account session changed. The original order was not resent. Sign in to the original account to resolve it.",
        );
        return;
      }
    }
    const order = await api<Order>(
      "/orders",
      "POST",
      {
        plan_id: attempt.plan.id,
        hostname: attempt.hostname,
        currency: attempt.plan.currency,
        quote: attempt.quote,
      },
      { "Idempotency-Key": attempt.key },
    );
    pendingOrder.value = undefined;
    orderDialog.value?.close();
    notice.value = tr(
      `订单 ${order.number} 已创建。尚未付款，未开通真实服务器。`,
      `Order ${order.number} was created. It is unpaid and no server has been provisioned.`,
    );
    go("orders");
    await load();
  } catch (e) {
    if (
      e instanceof ApiError &&
      !attempt.uncertain &&
      e.code === "PRICE_CHANGED"
    ) {
      pendingOrder.value = undefined;
      orderDialog.value?.close();
      selectedPlan.value = undefined;
      agreed.value = false;
      hostname.value = "";
      orderKey.value = "";
      orderCatalogChanged.value = true;
      await load();
    } else if (
      e instanceof ApiError &&
      !attempt.uncertain &&
      [
        "INVALID_INPUT",
        "VALIDATION_ERROR",
        "INVALID_CURRENCY",
        "CURRENCY_DISABLED",
        "UNSUPPORTED_CURRENCY",
        "PLAN_UNAVAILABLE",
        "IDEMPOTENCY_KEY_REQUIRED",
      ].includes(e.code)
    ) {
      pendingOrder.value = undefined;
      orderKey.value = crypto.randomUUID();
      modalError.value = explain(e);
    } else {
      attempt.uncertain = true;
      modalError.value = tr(
        "订单结果尚未确认。请保留此页面并重试；系统会使用同一请求编号核对结果，避免重复下单。",
        "The order result is unconfirmed. Keep this page open and retry; the same request key will be used to avoid duplicate orders.",
      );
    }
  } finally {
    saving.value = false;
  }
}
async function openInvoice(invoice: Invoice) {
  const generation = ++invoiceGeneration;
  checkoutSession.value = undefined;
  selectedInvoice.value = invoice;
  modalError.value = "";
  await nextTick();
  invoiceDialog.value?.showModal();
  if (!preview.value) {
    try {
      const detail = await api<Invoice>(
        (isAdmin.value ? "/admin/invoices/" : "/invoices/") +
          encodeURIComponent(invoice.id),
      );
      if (generation === invoiceGeneration) selectedInvoice.value = detail;
    } catch (e) {
      if (generation === invoiceGeneration) modalError.value = explain(e);
    }
  }
}
async function checkout() {
  if (preview.value || isAdmin.value || !selectedInvoice.value || saving.value)
    return;
  saving.value = true;
  modalError.value = "";
  checkoutSession.value = undefined;
  const invoiceId = selectedInvoice.value.id;
  const generation = invoiceGeneration;
  try {
    const result = await api<unknown>(
      "/invoices/" + encodeURIComponent(invoiceId) + "/checkout",
      "POST",
      {},
    );
    const verified = readCheckoutSession(result);
    if (
      generation === invoiceGeneration &&
      selectedInvoice.value?.id === invoiceId
    )
      checkoutSession.value = verified;
  } catch (e) {
    if (generation !== invoiceGeneration) return;
    modalError.value =
      e instanceof ApiError && e.code === "PAYMENT_NOT_CONFIGURED"
        ? tr(
            "支付通道尚未接入。未发生扣款，账单仍为待付款。",
            "Payments are not connected. No charge was made; the invoice remains unpaid.",
          )
        : explain(e);
  } finally {
    saving.value = false;
  }
}
let invoiceGeneration = 0;
function closeInvoice() {
  invoiceGeneration++;
  invoiceDialog.value?.close();
  selectedInvoice.value = undefined;
  checkoutSession.value = undefined;
  modalError.value = "";
}
function followCheckout(event: MouseEvent) {
  try {
    readCheckoutSession(checkoutSession.value);
  } catch {
    event.preventDefault();
    checkoutSession.value = undefined;
    modalError.value = tr(
      "结账入口已失效，请重新检查支付可用性。账单状态未改变。",
      "The checkout link has expired. Check payment availability again. The invoice status is unchanged.",
    );
  }
}
function downloadInvoices() {
  const safe = (s: unknown) =>
    '"' +
    String(s ?? "")
      .replace(/^[=+@-]/, "'")
      .replaceAll('"', '""') +
    '"';
  const lines = [
    [
      tr("账单编号", "Invoice number"),
      tr("状态", "Status"),
      tr("币种", "Currency"),
      tr("金额（最小单位）", "Amount (minor units)"),
      tr("记录金额", "Recorded amount"),
      tr("出账日期", "Issued on"),
      tr("到期日期", "Due on"),
    ],
    ...filteredInvoices.value.map((i) => [
      i.number,
      statusLabel(i.status),
      i.currency,
      i.amount_minor,
      money(i.amount_minor, i.currency, i.currency_format),
      i.issued_at,
      i.due_at,
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob(
      ["\uFEFF" + lines.map((row) => row.map(safe).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8;" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = (preview.value ? "preview-" : "") + "invoices.csv";
  a.click();
  URL.revokeObjectURL(url);
}
watch(cancellationAccount, () => closeCancellation(), { flush: "sync" });
watch(
  () => session.value.user?.id,
  (next, previous) => {
    if (next === previous) return;
    loadGeneration++;
    reportCurrency.value = "";
    closeInvoice();
    orderDialog.value?.close();
    selectedPlan.value = undefined;
    hostname.value = "";
    agreed.value = false;
    orderKey.value = "";
    services.value = [];
    orders.value = [];
    invoices.value = [];
    customers.value = [];
    audit.value = [];
    plans.value = [];
    overview.value = undefined;
    adminOverview.value = undefined;
    notice.value = "";
  },
  { flush: "sync" },
);
watch(
  [pageTitle, () => branding.value.site_name, locale],
  ([title]) => {
    document.title = title + " · " + branding.value.site_name;
    document.documentElement.lang = locale.value;
  },
  { immediate: true },
);
watch(
  () => branding.value.theme,
  (theme) => {
    document.documentElement.dataset.theme = theme;
  },
  { immediate: true },
);
watch(
  currency,
  () => {
    plans.value = [];
    overview.value = undefined;
    adminOverview.value = undefined;
    if (!booting.value && session.value.user && !applyingRegistry) void load();
  },
  { flush: "sync" },
);
watch(
  [plans, currency],
  () => {
    if (orderDialog.value?.open && !saving.value) invalidateChangedOrder();
  },
  { flush: "sync" },
);
watch(locale, () => {
  if (!booting.value && session.value.user) void load();
});
watch(page, () => {
  query.value = "";
});
onMounted(init);
</script>

<template>
  <a class="skip-link" href="#main">
    {{ tr("跳到主要内容", "Skip to main content") }}
  </a>
  <div v-if="booting" class="boot-screen" role="status">
    <div class="brand-mark">
      <component :is="brandIcon" :size="25" aria-hidden="true" />
    </div>
    <LoaderCircle class="spin" :size="22" /><span>
      {{ tr("正在连接工作台…", "Connecting to the console…") }}
    </span>
  </div>
  <div v-else-if="!session.user" class="login-shell">
    <div class="login-brand">
      <div class="brand-mark">
        <component :is="brandIcon" :size="25" aria-hidden="true" />
      </div>
      <strong>{{ branding.site_name }}</strong>
    </div>
    <div class="preference-controls">
      <label
        ><span>{{ tr("语言", "Language") }}</span
        ><select
          :value="locale"
          @change="selectLocale"
          :aria-label="tr('语言', 'Language')"
        >
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
        </select></label
      >
      <label
        ><span>{{ tr("币种", "Currency") }}</span
        ><select
          :value="displayCurrency"
          @change="selectCurrency"
          :aria-label="tr('币种', 'Currency')"
          :disabled="saving"
        >
          <option
            v-for="item in viewCurrencies"
            :key="item.code"
            :value="item.code"
          >
            {{ item.code }} · {{ item.name
            }}{{ !item.enabled ? tr("（仅历史）", " (history only)") : "" }}
          </option>
        </select></label
      >
    </div>
    <div class="login-layout">
      <section class="login-story">
        <p class="eyebrow">{{ branding.site_name }}</p>
        <h1>
          {{ tr("管理云服务器", "Manage your servers") }}<br /><span>{{
            tr("查看订单与账单", "Track orders and invoices")
          }}</span>
        </h1>
        <p class="login-description">
          {{
            tr(
              "在同一处查看服务、订单和费用。",
              "Your services, orders and costs in one place.",
            )
          }}
        </p>
        <div class="abstract-cloud" aria-hidden="true">
          <div class="server-art art-back">
            <div />
            <div />
            <div />
          </div>
          <div class="server-art art-front">
            <div><span /><i /></div>
            <div><span /><i /></div>
            <div><span /><i /></div>
          </div>
          <span class="orbit-dot" />
          <div class="art-caption">
            {{ tr("云服务控制台", "CLOUD CONSOLE") }}
          </div>
        </div>
        <span class="login-footnote"
          >{{ branding.company_name }} ·
          {{ tr("云服务管理", "Cloud services") }}</span
        >
      </section>
      <section class="login-panel">
        <div class="login-card">
          <span class="small-brand">{{ branding.site_name }}</span>
          <h2>{{ tr("欢迎回来", "Welcome back") }}</h2>
          <p class="muted">
            {{ tr("登录以管理你的服务。", "Sign in to manage your services.") }}
          </p>
          <div v-if="loginError" class="alert error" role="alert">
            <AlertCircle :size="18" /><span>{{ loginError }}</span>
          </div>
          <form @submit.prevent="login()">
            <label for="email"> {{ tr("邮箱地址", "Email address") }} </label
            ><input
              id="email"
              v-model="email"
              type="email"
              placeholder="you@company.com"
              autocomplete="username"
              required
              :disabled="saving"
            /><label for="password"> {{ tr("密码", "Password") }} </label
            ><input
              id="password"
              v-model="password"
              type="password"
              :placeholder="tr('输入你的密码', 'Enter your password')"
              autocomplete="current-password"
              required
              :disabled="saving"
            /><button
              class="button primary login-submit"
              :disabled="saving || disconnected"
            >
              <LoaderCircle v-if="saving" class="spin" :size="16" />{{
                saving
                  ? tr("正在登录…", "Signing in…")
                  : tr("登录工作台", "Sign in")
              }}<ArrowRight v-if="!saving" :size="17" />
            </button>
          </form>
          <p class="secure-caption">
            <LockKeyhole :size="13" />
            {{
              tr(
                "安全会话 · 不存储支付卡资料",
                "Secure session · No payment card data stored",
              )
            }}
          </p>
          <div v-if="session.demo_mode" class="demo-login">
            <p>
              {{
                tr(
                  "本地演示环境 · 不涉及真实支付",
                  "Local demo · No real payments",
                )
              }}
            </p>
            <div>
              <button @click="login('customer')" :disabled="saving">
                {{ tr("体验客户工作台", "Try customer console") }}
                <ArrowUpRight :size="14" /></button
              ><button @click="login('admin')" :disabled="saving">
                {{ tr("体验管理后台", "Try admin console") }}
                <ArrowUpRight :size="14" />
              </button>
            </div>
          </div>
          <button v-if="disconnected" class="text-button" @click="init">
            <RefreshCw :size="14" />
            {{ tr("重新连接服务器", "Reconnect to server") }}
          </button>
          <div v-if="disconnected || session.demo_mode" class="preview-links">
            <button @click="startPreview()">
              {{ tr("只读设计预览", "Read-only design preview") }}</button
            ><span>·</span
            ><button @click="startPreview(true)">
              {{ tr("管理端预览", "Admin preview") }}
            </button>
          </div>
        </div>
        <p class="login-support">
          {{
            tr(
              "账户由管理员开通。需要帮助请联系服务提供方。",
              "Accounts are created by your administrator. Contact your provider for help.",
            )
          }}
          <a
            v-if="branding.support_url"
            :href="safeSettingsURL(branding.support_url)"
            target="_blank"
            rel="noopener noreferrer"
            >{{ tr("客户支持", "Support") }}</a
          >
          <a
            v-if="branding.support_email"
            :href="safeSettingsEmailHref(branding.support_email)"
            >{{ branding.support_email }}</a
          >
        </p>
      </section>
    </div>
  </div>
  <div v-else class="app-shell" :class="{ 'sidebar-open': menuOpen }">
    <button
      v-if="menuOpen"
      class="sidebar-scrim"
      :aria-label="tr('关闭导航', 'Close navigation')"
      @click="menuOpen = false"
    />
    <aside class="sidebar" :aria-label="tr('主导航', 'Main navigation')">
      <a class="brand" href="/overview" @click.prevent="go('overview')"
        ><div class="brand-mark">
          <component :is="brandIcon" :size="25" aria-hidden="true" />
        </div>
        <strong>{{ branding.site_name }}</strong></a
      ><button class="workspace-switch" @click="helpDialog?.showModal()">
        <span class="workspace-icon">{{ isAdmin ? "A" : "P" }}</span
        ><span
          ><b>{{
            isAdmin
              ? tr("管理控制台", "Admin console")
              : tr("个人工作空间", "Personal workspace")
          }}</b
          ><small>{{
            branding.company_name || branding.site_name
          }}</small></span
        ><ChevronDown :size="14" />
      </button>
      <div class="nav-label">
        {{
          isAdmin
            ? tr("运营管理", "Administration")
            : tr("工作空间", "Workspace")
        }}
      </div>
      <nav>
        <a
          v-for="item in nav"
          :key="item.id"
          :href="'/' + item.id"
          :class="{ active: page === item.id }"
          :aria-current="page === item.id ? 'page' : undefined"
          @click.prevent="go(item.id)"
          ><component :is="item.icon" :size="19" :stroke-width="1.7" /><span>{{
            item.label
          }}</span
          ><span
            v-if="item.id === 'invoices' && unpaid.length"
            class="nav-count"
            >{{ unpaid.length }}</span
          ></a
        >
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-note">
          <span class="status-dot" /><span>{{
            preview
              ? tr("只读预览模式", "Read-only preview")
              : session.demo_mode
                ? tr("本地演示环境", "Local demo")
                : tr("已连接", "Connected")
          }}</span>
        </div>
        <button
          class="side-action"
          :class="{ active: page === 'account' }"
          @click="go('account')"
        >
          <ShieldCheck :size="18" />
          {{ tr("账户与安全", "Account and security") }}</button
        ><button class="side-action" @click="helpDialog?.showModal()">
          <CircleHelp :size="18" />
          {{ tr("帮助与说明", "Help and information") }}
          <ArrowUpRight :size="14" />
        </button>
        <div class="user-menu">
          <span class="avatar">{{
            session.user.name?.slice(0, 1).toUpperCase() || "A"
          }}</span>
          <div>
            <b>{{ session.user.name }}</b
            ><small>{{
              isAdmin
                ? tr("管理员", "Administrator")
                : tr("个人账户", "Personal account")
            }}</small>
          </div>
          <button
            :aria-label="tr('退出登录', 'Sign out')"
            :title="tr('退出登录', 'Sign out')"
            @click="logout"
            :disabled="saving"
          >
            <LogOut :size="17" />
          </button>
        </div>
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <div class="breadcrumbs">
          <button
            class="mobile-menu icon-button"
            :aria-label="tr('打开导航', 'Open navigation')"
            @click="menuOpen = true"
          >
            <Menu :size="21" /></button
          ><span>{{
            isAdmin
              ? tr("管理控制台", "Admin console")
              : tr("控制台", "Console")
          }}</span
          ><ChevronRight :size="13" /><b>{{ pageTitle }}</b>
        </div>
        <div class="topbar-right">
          <div class="preference-controls">
            <label
              ><span>{{ tr("语言", "Language") }}</span
              ><select
                :value="locale"
                @change="selectLocale"
                :aria-label="tr('语言', 'Language')"
              >
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select></label
            >
            <label
              ><span>{{ tr("币种", "Currency") }}</span
              ><select
                :value="displayCurrency"
                @change="selectCurrency"
                :aria-label="tr('币种', 'Currency')"
                :disabled="saving"
              >
                <option
                  v-for="item in viewCurrencies"
                  :key="item.code"
                  :value="item.code"
                >
                  {{ item.code }} · {{ item.name
                  }}{{
                    !item.enabled ? tr("（仅历史）", " (history only)") : ""
                  }}
                </option>
              </select></label
            >
          </div>
          <span class="environment-chip">{{
            preview
              ? tr("只读预览", "Read-only preview")
              : session.demo_mode
                ? "DEMO"
                : "CONNECTED"
          }}</span
          ><button
            class="icon-button"
            :aria-label="tr('刷新数据', 'Refresh data')"
            :title="tr('刷新数据', 'Refresh data')"
            :disabled="loading"
            @click="load"
          >
            <RefreshCw :size="17" :class="{ spin: loading }" /></button
          ><span class="topbar-divider" /><button
            class="avatar small"
            :aria-label="tr('打开账户与安全', 'Open account and security')"
            @click="go('account')"
          >
            {{ session.user.name?.slice(0, 1).toUpperCase() || "A" }}
          </button>
        </div>
      </header>
      <div v-if="session.demo_mode || preview" class="demo-banner">
        <span
          ><Sparkles :size="14" />{{
            preview
              ? tr(
                  "只读设计预览 · 以下均为样例数据，所有交易操作已禁用。",
                  "Read-only design preview · All data is sample data. Transactions are disabled.",
                )
              : tr(
                  "本地演示环境 · 数据仅用于测试，不会扣款或开通真实服务器。",
                  "Local demo · Test data only. No charges or real server provisioning.",
                )
          }}</span
        ><button v-if="preview" @click="logout">
          {{ tr("返回登录", "Back to sign in") }} <ArrowRight :size="13" />
        </button>
      </div>
      <main id="main" tabindex="-1">
        <div v-if="orderCatalogChanged" class="alert info" role="status">
          <AlertCircle :size="18" /><span>{{
            tr(
              "套餐、价格或币种已变化，请重新核对配置后再下单。",
              "The plan, price or currency changed. Review the configuration again before ordering.",
            )
          }}</span>
          <button
            :aria-label="tr('关闭提示', 'Dismiss notice')"
            @click="orderCatalogChanged = false"
          >
            <X :size="16" />
          </button>
        </div>
        <div v-if="error" class="alert error" role="alert">
          <AlertCircle :size="18" /><span>{{ error }}</span
          ><button @click="load">{{ tr("重试", "Retry") }}</button>
        </div>
        <div v-if="notice" class="alert success" role="status">
          <CheckCircle2 :size="18" /><span>{{ notice }}</span
          ><button
            :aria-label="tr('关闭提示', 'Dismiss notice')"
            @click="notice = ''"
          >
            <X :size="16" />
          </button>
        </div>
        <div v-if="pendingOrder && !saving" class="alert info" role="status">
          <AlertCircle :size="18" /><span>{{
            tr(
              "有一笔订单结果尚未确认，请核对后再离开页面。",
              "An order result is unconfirmed. Resolve it before leaving this page.",
            )
          }}</span>
          <button @click="openOrder(pendingOrder.plan)">
            {{ tr("核对原订单", "Resolve original order") }}
          </button>
        </div>
        <div
          v-if="pendingCancellation?.uncertain && !saving"
          class="alert info"
          role="status"
          data-testid="cancellation-unconfirmed"
        >
          <AlertCircle :size="18" /><span>{{
            tr(
              "取消结果尚未确认，请核对订单记录。不会自动重发请求。",
              "The cancellation result is unconfirmed. Check order history. The request will not be resent automatically.",
            )
          }}</span>
          <button @click="openCancellation(pendingCancellation.order)">
            {{ tr("核对或重试取消", "Review or retry cancellation") }}
          </button>
        </div>
        <div class="page-heading">
          <div>
            <p class="eyebrow">
              {{ branding.site_name }}
            </p>
            <h1>
              {{
                page === "overview"
                  ? isAdmin
                    ? tr("运营概况", "Operations overview")
                    : tr("你好，", "Hello, ") +
                      session.user.name +
                      tr("。", ".")
                  : pageTitle
              }}
            </h1>
            <p>
              {{
                page === "overview"
                  ? isAdmin
                    ? tr(
                        "查看客户、服务和账单概况。",
                        "View account and billing activity.",
                      )
                    : tr(
                        "查看服务、订单和待付账单。",
                        "View your services, orders and unpaid invoices.",
                      )
                  : page === "services"
                    ? tr(
                        "查看已开通服务与续费日期。",
                        "View active services and renewal dates.",
                      )
                    : page === "plans"
                      ? tr(
                          "选择配置并确认独立币种价格。",
                          "Choose a plan and review prices for each currency.",
                        )
                      : page === "invoices"
                        ? tr(
                            "查看账单金额与付款状态。",
                            "View invoices and payment status.",
                          )
                        : page === "orders"
                          ? tr(
                              "查看订单状态与创建记录。",
                              "Track orders and their status.",
                            )
                          : page === "customers"
                            ? tr(
                                "查看客户资料与账户标识。",
                                "View customer accounts.",
                              )
                            : page === "audit"
                              ? tr(
                                  "记录重要操作，让变化有据可查。",
                                  "Review recorded account and billing actions.",
                                )
                              : page === "integrations"
                                ? tr(
                                    "查看支付与邮件服务配置。",
                                    "View registered payment and email adapters.",
                                  )
                                : page === "settings"
                                  ? tr(
                                      "设置站点品牌、联系方式和默认偏好。",
                                      "Manage site branding, contact details and defaults.",
                                    )
                                  : page === "updates"
                                    ? tr(
                                        "检查核心与插件版本，生成可审计的主机更新交接。",
                                        "Check core and plugin versions and request an audited host handoff.",
                                      )
                                    : tr(
                                        "你的身份、会话与安全信息。",
                                        "Your profile, session and security information.",
                                      )
              }}
            </p>
          </div>
          <button
            v-if="['overview', 'services'].includes(page) && !isAdmin"
            class="button primary"
            @click="go('plans')"
          >
            <Plus :size="17" />
            {{ tr("创建云服务器", "Create cloud server") }}</button
          ><button
            v-if="page === 'invoices'"
            class="button secondary"
            @click="downloadInvoices"
            :disabled="!filteredInvoices.length"
          >
            <Download :size="16" /> {{ tr("导出账单", "Export invoices") }}
          </button>
        </div>
        <div
          v-if="loading && !overview && !adminOverview && page !== 'plans'"
          class="skeleton-grid"
          :aria-label="tr('正在载入数据', 'Loading data')"
          role="status"
        >
          <div v-for="n in 3" :key="n" class="skeleton" />
        </div>
        <template v-else-if="page === 'overview'">
          <p class="page-note">
            {{
              tr(
                "服务、账单数量及金额按所选币种统计；客户总数和历史记录包含所有币种。",
                "Service and invoice counts and amounts use the selected currency; customer totals and history include all currencies.",
              )
            }}
          </p>
          <section
            class="stats-grid"
            :aria-label="tr('账户概况', 'Account overview')"
          >
            <article class="stat-card">
              <div class="stat-label">
                {{
                  isAdmin
                    ? tr("客户总数", "Total customers")
                    : tr("运行中的服务", "Active services")
                }}<Users v-if="isAdmin" :size="18" /><Server
                  v-else
                  :size="18"
                />
              </div>
              <div class="stat-value">
                {{
                  isAdmin
                    ? (adminOverview?.customers ?? "—")
                    : (overview?.active_services ?? "—")
                }}<span>{{
                  isAdmin ? tr("位", " customers") : tr("台", " servers")
                }}</span>
              </div>
              <div class="stat-foot">
                <span class="status-dot" />{{
                  isAdmin
                    ? tr("已注册客户账户", "Registered customer accounts")
                    : tr("已激活的云服务器", "Active cloud servers")
                }}
              </div>
            </article>
            <article class="stat-card">
              <div class="stat-label">
                {{
                  isAdmin
                    ? tr("已收款金额", "Received payments")
                    : tr("每月服务费用", "Monthly service cost")
                }}<ReceiptText :size="18" />
              </div>
              <div class="stat-value amount">
                {{
                  isAdmin
                    ? money(
                        adminOverview?.revenue_minor || 0,
                        adminOverview?.currency,
                        adminOverview?.currency_format,
                      )
                    : money(
                        monthly,
                        overview?.currency,
                        overview?.currency_format,
                      )
                }}<span>{{
                  isAdmin ? displayCurrency : tr("/ 月", "/ month")
                }}</span>
              </div>
              <div class="stat-foot">
                {{
                  isAdmin
                    ? tr(
                        "已付款账单合计 · 非利润",
                        "Paid invoice total · Not profit",
                      )
                    : tr(
                        "当前币种服务月费合计",
                        "Monthly total in selected currency",
                      )
                }}
              </div>
            </article>
            <article class="stat-card">
              <div class="stat-label">
                {{ tr("待付款账单", "Unpaid invoices") }} <Clock3 :size="18" />
              </div>
              <div class="stat-value">
                {{
                  isAdmin
                    ? (adminOverview?.unpaid_invoices ?? "—")
                    : (overview?.pending_invoices ?? "—")
                }}<span> {{ tr("笔", " invoices") }} </span>
              </div>
              <button class="stat-foot link" @click="go('invoices')">
                {{
                  unpaid.length
                    ? tr("查看待付账单", "View unpaid invoices")
                    : tr("查看全部账单", "View all invoices")
                }}<ArrowRight :size="14" />
              </button>
            </article>
          </section>
          <section v-if="unpaid.length" class="payment-reminder">
            <div class="reminder-icon"><ReceiptText :size="21" /></div>
            <div>
              <b>{{
                isAdmin
                  ? tr("有 ", "There are ") +
                    unpaid.length +
                    tr(
                      " 笔账单等待客户付款",
                      " invoices awaiting customer payment",
                    )
                  : tr("有 ", "There are ") +
                    unpaid.length +
                    tr(" 笔账单，等待你的安排。", " unpaid invoices.")
              }}</b>
              <p>
                {{ unpaid[0]?.number }}<span>·</span
                >{{
                  money(
                    unpaid[0]?.amount_minor || 0,
                    unpaid[0]?.currency,
                    unpaid[0]?.currency_format,
                  )
                }}<span>·</span>{{ date(unpaid[0]?.due_at || "") }}
                {{ tr("到期", "due") }}
              </p>
            </div>
            <button @click="openInvoice(unpaid[0]!)">
              {{ tr("查看账单", "View invoice") }} <ArrowRight :size="15" />
            </button>
          </section>
          <div class="overview-grid">
            <section class="panel services-panel">
              <div class="panel-heading">
                <div>
                  <h2>
                    {{
                      isAdmin
                        ? tr("最近订单", "Recent orders")
                        : tr("我的云服务器", "My cloud servers")
                    }}
                  </h2>
                  <p>
                    {{
                      isAdmin
                        ? tr(
                            "最近创建的客户订单",
                            "Recently created customer orders",
                          )
                        : tr(
                            "查看服务状态与当前费用。",
                            "View service status and current costs.",
                          )
                    }}
                  </p>
                </div>
                <button
                  class="text-button"
                  @click="go(isAdmin ? 'orders' : 'services')"
                >
                  {{ tr("查看全部", "View all") }} <ArrowRight :size="14" />
                </button>
              </div>
              <template v-if="!isAdmin"
                ><div
                  v-for="service in services.slice(0, 3)"
                  :key="service.id"
                  class="service-row"
                >
                  <div class="service-icon">
                    <Server :size="22" :stroke-width="1.5" />
                  </div>
                  <div class="service-identity">
                    <b>{{ service.name }}</b
                    ><span
                      >{{ service.region }} <i>·</i>
                      {{ service.plan_name }}</span
                    >
                  </div>
                  <div class="service-row-meta">
                    <span class="badge" :class="statusTone(service.status)"
                      ><i />{{ statusLabel(service.status) }}</span
                    ><small
                      >{{
                        money(
                          service.price_minor,
                          service.currency,
                          service.currency_format,
                        )
                      }}
                      {{ tr("/ 月", "/ month") }}
                    </small>
                  </div>
                </div>
                <div v-if="!services.length" class="empty-state">
                  <Server :size="30" />
                  <h3>
                    {{ tr("还没有云服务器", "No cloud servers yet") }}
                  </h3>
                  <p>
                    {{
                      tr(
                        "还没有云服务器，先选择适合你的配置。",
                        "Choose a plan to create your first service order.",
                      )
                    }}
                  </p>
                  <button class="button secondary" @click="go('plans')">
                    {{ tr("探索云服务器", "Browse cloud servers") }}
                    <ArrowRight :size="15" />
                  </button></div></template
              ><template v-else
                ><div
                  v-for="order in orders.slice(0, 4)"
                  :key="order.id"
                  class="service-row"
                >
                  <div class="service-icon"><ShoppingBag :size="21" /></div>
                  <div class="service-identity">
                    <b>{{ order.number }}</b
                    ><span
                      >{{ order.plan_name }} ·
                      {{ date(order.created_at) }}</span
                    >
                  </div>
                  <div class="service-row-meta">
                    <b>{{
                      money(
                        order.total_minor,
                        order.currency,
                        order.currency_format,
                      )
                    }}</b
                    ><span class="badge" :class="statusTone(order.status)">{{
                      statusLabel(order.status)
                    }}</span>
                  </div>
                </div>
                <div v-if="!orders.length" class="empty-state">
                  <ShoppingBag :size="30" />
                  <h3>{{ tr("暂无订单", "No orders yet") }}</h3>
                  <p>
                    {{
                      tr(
                        "客户下单后，订单会出现在这里。",
                        "Customer orders will appear here after they are created.",
                      )
                    }}
                  </p>
                </div></template
              >
              <div class="panel-footer">
                <ShieldCheck :size="15" />{{
                  isAdmin
                    ? tr(
                        "价格由服务器校验，关键操作留有审计记录。",
                        "The server validates prices and records key actions in the audit log.",
                      )
                    : tr(
                        "服务状态来自账务系统，不代表实时节点健康监控。",
                        "Service status comes from billing records, not live infrastructure monitoring.",
                      )
                }}
              </div>
            </section>
            <section class="panel cost-panel">
              <div class="panel-heading">
                <div>
                  <h2>
                    {{
                      isAdmin
                        ? tr("运营摘要", "Operations summary")
                        : tr("费用构成", "Cost breakdown")
                    }}
                  </h2>
                  <p>
                    {{
                      isAdmin
                        ? tr(
                            "当前业务规模与账单状态",
                            "Service and invoice overview",
                          )
                        : tr(
                            "当前服务的月度费用分布",
                            "Monthly costs of current services",
                          )
                    }}
                  </p>
                </div>
                <span class="tiny-tag">{{ displayCurrency }}</span>
              </div>
              <div v-if="isAdmin" class="admin-summary">
                <div>
                  <span> {{ tr("服务总数", "Total services") }} </span
                  ><b
                    >{{ adminOverview?.total_services ?? "—" }}
                    <small> {{ tr("台", " servers") }} </small></b
                  >
                </div>
                <div>
                  <span>
                    {{
                      tr(
                        "已加载的当前币种账单",
                        "Loaded invoices in this currency",
                      )
                    }} </span
                  ><b
                    >{{
                      invoices.filter(
                        (invoice) => invoice.currency === displayCurrency,
                      ).length
                    }}
                    <small> {{ tr("笔", " invoices") }} </small></b
                  >
                </div>
                <div>
                  <span> {{ tr("待收金额", "Amount outstanding") }} </span
                  ><b>{{
                    money(
                      unpaidTotal ?? Number.NaN,
                      displayCurrency,
                      isAdmin
                        ? adminOverview?.currency_format
                        : overview?.currency_format,
                    )
                  }}</b>
                </div>
                <p>
                  <LockKeyhole :size="14" />
                  {{
                    tr(
                      "支付通道尚未接入，无法收取真实款项。",
                      "Payments are not connected. Real payments cannot be collected.",
                    )
                  }}
                </p>
              </div>
              <template v-else
                ><div class="cost-total">
                  {{
                    money(
                      monthly,
                      overview?.currency,
                      overview?.currency_format,
                    )
                  }}<span> {{ tr("/ 月", "/ month") }} </span>
                </div>
                <div
                  v-for="(service, index) in currencyServices.slice(0, 4)"
                  :key="service.id"
                  class="cost-line"
                >
                  <div>
                    <span>{{ service.name }}</span
                    ><b>{{
                      money(
                        service.price_minor,
                        service.currency,
                        service.currency_format,
                      )
                    }}</b>
                  </div>
                  <div class="cost-track">
                    <span
                      :class="'shade-' + index"
                      :style="{
                        width: (service.price_minor / maxCost) * 100 + '%',
                      }"
                    />
                  </div>
                </div>
                <div v-if="!currencyServices.length" class="cost-empty">
                  {{
                    tr(
                      "启用服务后，即可查看费用分布。",
                      "Costs appear here when services in this currency are active.",
                    )
                  }}
                </div>
                <p class="cost-note">
                  {{
                    tr(
                      "仅汇总所选币种的服务费用，不折算其他币种。",
                      "Only services in the selected currency are included. No currency conversion.",
                    )
                  }}
                </p></template
              >
            </section>
          </div>
          <section class="panel latest-panel">
            <div class="panel-heading">
              <div>
                <h2>
                  {{
                    isAdmin
                      ? tr("最近操作", "Recent activity")
                      : tr("最近订单", "Recent orders")
                  }}
                </h2>
                <p>
                  {{
                    isAdmin
                      ? tr("关键操作的审计记录", "Audit records of key actions")
                      : tr(
                          "查看最近创建的订单。",
                          "View recently created orders.",
                        )
                  }}
                </p>
              </div>
              <button
                class="text-button"
                @click="go(isAdmin ? 'audit' : 'orders')"
              >
                {{ tr("查看全部", "View all") }} <ArrowRight :size="14" />
              </button>
            </div>
            <div class="table-wrap">
              <table v-if="!isAdmin">
                <thead>
                  <tr>
                    <th>{{ tr("订单编号", "Order number") }}</th>
                    <th>{{ tr("服务方案", "Plan") }}</th>
                    <th>{{ tr("创建日期", "Created on") }}</th>
                    <th>{{ tr("金额", "Amount") }}</th>
                    <th>{{ tr("状态", "Status") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="order in orders.slice(0, 4)" :key="order.id">
                    <td class="mono">{{ order.number }}</td>
                    <td>{{ order.plan_name }}</td>
                    <td class="muted">{{ date(order.created_at) }}</td>
                    <td class="numeric">
                      {{
                        money(
                          order.total_minor,
                          order.currency,
                          order.currency_format,
                        )
                      }}
                    </td>
                    <td>
                      <span class="badge" :class="statusTone(order.status)">{{
                        statusLabel(order.status)
                      }}</span>
                    </td>
                  </tr>
                  <tr v-if="!orders.length">
                    <td colspan="5" class="table-empty">
                      {{ tr("暂无订单记录", "No order records") }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <table v-else>
                <thead>
                  <tr>
                    <th>{{ tr("操作", "Action") }}</th>
                    <th>{{ tr("操作者", "Actor") }}</th>
                    <th>{{ tr("目标", "Target") }}</th>
                    <th>{{ tr("日期（UTC）", "Date (UTC)") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="event in audit.slice(0, 4)" :key="event.id">
                    <td>{{ event.action }}</td>
                    <td>{{ event.actor_email }}</td>
                    <td class="mono">{{ event.target }}</td>
                    <td>{{ date(event.created_at) }}</td>
                  </tr>
                  <tr v-if="!audit.length">
                    <td colspan="4" class="table-empty">
                      {{ tr("暂无操作记录", "No activity records") }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </template>
        <PlansPage
          v-else-if="page === 'plans'"
          :plans="plans"
          :currency="currency"
          :loading="loading"
          :saving="saving"
          :preview="preview"
          :demo="session.demo_mode"
          :pending-plan="pendingOrder?.plan"
          @review="openOrder"
        />
        <template v-else-if="page === 'services'"
          ><div class="list-toolbar">
            <span
              >{{ services.length }}
              {{ tr("台云服务器", " cloud servers") }} </span
            ><label class="search-field"
              ><Search :size="16" /><input
                v-model="query"
                :placeholder="
                  tr('搜索服务、区域或 IP', 'Search service, region or IP')
                "
                :aria-label="tr('搜索服务', 'Search services')"
            /></label>
          </div>
          <div class="service-cards">
            <article
              v-for="service in filteredServices"
              :key="service.id"
              class="panel service-card"
            >
              <div class="service-card-top">
                <div class="service-icon"><Server :size="24" /></div>
                <span class="badge" :class="statusTone(service.status)"
                  ><i />{{ statusLabel(service.status) }}</span
                >
              </div>
              <h2>{{ service.name }}</h2>
              <p class="muted">{{ service.region }}</p>
              <div class="service-specs">
                <span
                  ><b>{{ service.cpu }}</b> vCPU</span
                ><span
                  ><b>{{ service.memory_gb }}</b>
                  {{ tr("GB 内存", " GB memory") }} </span
                ><span
                  ><b>{{ service.disk_gb }}</b> GB SSD</span
                >
              </div>
              <dl>
                <div>
                  <dt>{{ tr("公网地址", "Public address") }}</dt>
                  <dd class="mono">
                    {{ service.ipv4 || tr("待分配", "Awaiting allocation") }}
                  </dd>
                </div>
                <div>
                  <dt>{{ tr("服务方案", "Plan") }}</dt>
                  <dd>{{ service.plan_name }}</dd>
                </div>
                <div>
                  <dt>{{ tr("下次到期", "Next due date") }}</dt>
                  <dd>{{ date(service.next_due_at) }}</dd>
                </div>
              </dl>
              <div class="service-card-footer">
                <b
                  >{{
                    money(
                      service.price_minor,
                      service.currency,
                      service.currency_format,
                    )
                  }}<small> {{ tr("/ 月", "/ month") }} </small></b
                ><span> {{ tr("账务记录", "Billing record") }} </span>
              </div>
            </article>
          </div>
          <div v-if="!filteredServices.length" class="panel empty-state">
            <Server :size="30" />
            <h3>
              {{
                query
                  ? tr("没有匹配的服务", "No matching services")
                  : tr("还没有云服务器", "No cloud servers yet")
              }}
            </h3>
            <p>
              {{
                query
                  ? tr(
                      "试试其他名称、区域或 IP。",
                      "Try another name, region or IP.",
                    )
                  : tr(
                      "选择一个方案，开始你的云端业务。",
                      "Choose a plan to create your first service order.",
                    )
              }}
            </p>
            <button v-if="!query" class="button primary" @click="go('plans')">
              {{ tr("选择方案", "Choose a plan") }} <ArrowRight :size="16" />
            </button>
          </div>
          <p class="page-note">
            {{
              tr(
                "当前仅展示账务服务记录。电源管理、系统重装与实时监控将在控制器集成后提供。",
                "Only billing records are shown. Power controls, OS reinstall and monitoring require a future controller integration.",
              )
            }}
          </p></template
        >
        <template
          v-else-if="
            ['orders', 'invoices', 'customers', 'audit'].includes(page)
          "
          ><section v-if="page === 'invoices'" class="invoice-summary">
            <div>
              <span> {{ tr("待付款金额", "Amount unpaid") }} </span
              ><b
                >{{
                  money(
                    unpaidTotal ?? Number.NaN,
                    displayCurrency,
                    isAdmin
                      ? adminOverview?.currency_format
                      : overview?.currency_format,
                  )
                }}<small>{{ displayCurrency }}</small></b
              >
            </div>
            <div>
              <span>
                {{
                  tr("当前币种待付账单", "Unpaid invoices in this currency")
                }} </span
              ><b
                >{{ unpaidCount ?? "—"
                }}<small> {{ tr("笔", " invoices") }} </small></b
              >
            </div>
            <p>
              <LockKeyhole :size="17" />
              {{ tr("支付通道尚未接入", "Payments are not connected") }}
              <br /><span>
                {{
                  tr(
                    "不会收集银行卡资料或发起真实扣款。",
                    "No payment card data or real charges are processed.",
                  )
                }}
              </span>
            </p>
          </section>
          <section class="panel data-panel">
            <div class="list-toolbar">
              <span
                >{{
                  page === "orders"
                    ? tr("全部订单", "All orders")
                    : page === "invoices"
                      ? tr("全部账单", "All invoices")
                      : page === "customers"
                        ? tr("客户账户", "Customer accounts")
                        : tr("操作记录", "Activity records")
                }}<small class="count-tag">{{
                  page === "orders"
                    ? orders.length
                    : page === "invoices"
                      ? invoices.length
                      : page === "customers"
                        ? customers.length
                        : audit.length
                }}</small></span
              ><label class="search-field"
                ><Search :size="16" /><input
                  v-model="query"
                  :placeholder="
                    page === 'customers'
                      ? tr('搜索姓名或邮箱', 'Search name or email')
                      : tr(
                          '搜索编号、状态或关键词',
                          'Search number, status or keyword',
                        )
                  "
                  :aria-label="tr('搜索记录', 'Search records')"
              /></label>
            </div>
            <div class="table-wrap">
              <table v-if="page === 'orders'">
                <thead>
                  <tr>
                    <th>{{ tr("订单编号", "Order number") }}</th>
                    <th>{{ tr("服务方案", "Plan") }}</th>
                    <th>{{ tr("创建日期（UTC）", "Created on (UTC)") }}</th>
                    <th>{{ tr("订单金额", "Order amount") }}</th>
                    <th>{{ tr("状态", "Status") }}</th>
                    <th>{{ tr("操作", "Actions") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="order in filteredOrders"
                    :key="order.id"
                    :data-order-id="order.id"
                  >
                    <td class="mono strong">{{ order.number }}</td>
                    <td>
                      <strong>{{
                        order.plan_snapshot?.name || order.plan_name
                      }}</strong>
                      <div class="muted" v-if="order.plan_snapshot">
                        {{ order.plan_snapshot.cpu }} vCPU ·
                        {{ order.plan_snapshot.memory_gb }} GB ·
                        {{ order.plan_snapshot.disk_gb }} GB ·
                        {{ order.plan_snapshot.transfer_tb }} TB<br />{{
                          order.plan_snapshot.region
                        }}
                        · {{ tr("月付", "Monthly") }}
                      </div>
                      <div class="muted" v-else>
                        {{
                          tr(
                            "未保存成交规格",
                            "Order specifications were not recorded",
                          )
                        }}
                      </div>
                    </td>
                    <td class="muted">{{ date(order.created_at) }}</td>
                    <td class="numeric">
                      {{
                        money(
                          order.total_minor,
                          order.currency,
                          order.currency_format,
                        )
                      }}
                    </td>
                    <td>
                      <span class="badge" :class="statusTone(order.status)">{{
                        statusLabel(order.status)
                      }}</span>
                    </td>
                    <td>
                      <button
                        v-if="order.status === 'pending_payment' && !preview"
                        class="table-action order-cancel-action"
                        :disabled="saving || loading"
                        @click="openCancellation(order)"
                      >
                        {{ tr("取消订单", "Cancel order") }}
                      </button>
                    </td>
                  </tr>
                  <tr v-if="!filteredOrders.length">
                    <td colspan="6" class="table-empty">
                      {{
                        query
                          ? tr("没有匹配的订单", "No matching orders")
                          : tr(
                              "暂无订单，选购服务后将在这里显示。",
                              "No orders yet. New service orders will appear here.",
                            )
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <table v-else-if="page === 'invoices'">
                <thead>
                  <tr>
                    <th>{{ tr("账单编号", "Invoice number") }}</th>
                    <th>{{ tr("出账日期", "Issued on") }}</th>
                    <th>{{ tr("到期日期", "Due on") }}</th>
                    <th>{{ tr("金额", "Amount") }}</th>
                    <th>{{ tr("状态", "Status") }}</th>
                    <th>
                      <span class="sr-only"> {{ tr("操作", "Action") }} </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="invoice in filteredInvoices" :key="invoice.id">
                    <td class="mono strong">{{ invoice.number }}</td>
                    <td class="muted">{{ date(invoice.issued_at) }}</td>
                    <td class="muted">{{ date(invoice.due_at) }}</td>
                    <td class="numeric">
                      {{
                        money(
                          invoice.amount_minor,
                          invoice.currency,
                          invoice.currency_format,
                        )
                      }}
                    </td>
                    <td>
                      <span class="badge" :class="statusTone(invoice.status)">{{
                        statusLabel(invoice.status)
                      }}</span>
                    </td>
                    <td>
                      <button
                        class="table-action"
                        :aria-label="
                          tr('查看账单 ', 'View invoice ') + invoice.number
                        "
                        @click="openInvoice(invoice)"
                      >
                        {{ tr("查看", "View") }} <ChevronRight :size="15" />
                      </button>
                    </td>
                  </tr>
                  <tr v-if="!filteredInvoices.length">
                    <td colspan="6" class="table-empty">
                      {{
                        query
                          ? tr("没有匹配的账单", "No matching invoices")
                          : tr("暂无账单记录。", "No invoice records.")
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <table v-else-if="page === 'customers'">
                <thead>
                  <tr>
                    <th>{{ tr("客户", "Customer") }}</th>
                    <th>{{ tr("邮箱", "Email") }}</th>
                    <th>{{ tr("角色", "Role") }}</th>
                    <th>{{ tr("账户标识", "Account ID") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="customer in filteredCustomers" :key="customer.id">
                    <td>
                      <div class="customer-name">
                        <span class="avatar small">{{
                          customer.name.slice(0, 1)
                        }}</span
                        ><b>{{ customer.name }}</b>
                      </div>
                    </td>
                    <td>{{ customer.email }}</td>
                    <td>
                      <span class="badge gray">{{
                        customer.role === "admin"
                          ? tr("管理员", "Administrator")
                          : tr("客户", "Customer")
                      }}</span>
                    </td>
                    <td class="mono muted">{{ customer.id }}</td>
                  </tr>
                  <tr v-if="!filteredCustomers.length">
                    <td colspan="4" class="table-empty">
                      {{
                        query
                          ? tr("没有匹配的客户", "No matching customers")
                          : tr("暂无客户账户。", "No customer accounts.")
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <table v-else>
                <thead>
                  <tr>
                    <th>{{ tr("操作类型", "Action type") }}</th>
                    <th>{{ tr("操作者", "Actor") }}</th>
                    <th>{{ tr("目标", "Target") }}</th>
                    <th>{{ tr("详情", "Details") }}</th>
                    <th>{{ tr("日期（UTC）", "Date (UTC)") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="event in filteredAudit" :key="event.id">
                    <td class="mono strong">{{ event.action }}</td>
                    <td>{{ event.actor_email }}</td>
                    <td class="mono">{{ event.target }}</td>
                    <td class="audit-detail">{{ event.detail }}</td>
                    <td class="muted">{{ date(event.created_at) }}</td>
                  </tr>
                  <tr v-if="!filteredAudit.length">
                    <td colspan="5" class="table-empty">
                      {{
                        query
                          ? tr("没有匹配的操作", "No matching actions")
                          : tr("暂无审计记录。", "No audit records.")
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="table-footer">
              {{
                query
                  ? tr("已按关键词筛选", "Filtered by keyword")
                  : tr("显示当前可访问的记录", "Showing accessible records")
              }}<span>{{
                page === "audit"
                  ? tr(
                      "关键操作由服务端记录",
                      "Key actions are recorded by the server",
                    )
                  : tr(
                      "金额均为记录原币种，不做汇率换算",
                      "Amounts retain their recorded currency. No currency conversion.",
                    )
              }}</span>
            </div>
          </section>
          <p v-if="page === 'orders'" class="page-note">
            {{
              tr(
                "下单不会自动扣款。订单付款与服务开通是独立的处理阶段。",
                "Creating an order does not charge you. Payment and service provisioning are separate stages.",
              )
            }}
          </p></template
        >
        <FinancialSettingsPage
          v-else-if="page === 'finance' && isAdmin"
          :preview="preview"
          @saved="applyFinancialSettings"
          @prices-saved="load"
        />
        <SettingsPage
          v-else-if="page === 'settings' && isAdmin"
          :preview="preview"
          @saved="applyBranding"
        />
        <IntegrationsPage
          v-else-if="page === 'integrations' && isAdmin"
          :key="session.user?.id"
          :preview="preview"
          :refresh-token="integrationRefresh"
        />
        <UpdatesPage
          v-else-if="page === 'updates' && isAdmin"
          :key="session.user?.id"
          :preview="preview"
          :administrator="isAdmin"
        />
        <template v-else-if="page === 'account'"
          ><div class="account-grid">
            <section class="panel account-panel">
              <div class="panel-heading">
                <h2>{{ tr("个人资料", "Profile") }}</h2>
                <span class="tiny-tag"> {{ tr("只读", "Read only") }} </span>
              </div>
              <div class="profile-hero">
                <span class="avatar large">{{
                  session.user.name.slice(0, 1)
                }}</span>
                <div>
                  <h2>{{ session.user.name }}</h2>
                  <p>{{ session.user.email }}</p>
                </div>
              </div>
              <dl class="account-details">
                <div>
                  <dt>{{ tr("账户角色", "Account role") }}</dt>
                  <dd>
                    {{
                      isAdmin
                        ? tr("管理员", "Administrator")
                        : tr("客户", "Customer")
                    }}
                  </dd>
                </div>
                <div>
                  <dt>{{ tr("账户 ID", "Account ID") }}</dt>
                  <dd class="mono">{{ session.user.id }}</dd>
                </div>
                <div>
                  <dt>{{ tr("计价币种", "Preferred currency") }}</dt>
                  <dd>{{ currency }}</dd>
                </div>
              </dl>
              <p class="page-note">
                {{
                  tr(
                    "语言与币种偏好保存在当前浏览器，彼此独立。历史账单保留原币种。",
                    "Language and currency preferences are independent and saved in this browser. Historical invoices keep their recorded currency.",
                  )
                }}
              </p>
              <p class="page-note">
                {{
                  tr(
                    "如需变更账户资料，请联系服务提供方。",
                    "Contact your service provider to update account details.",
                  )
                }}
              </p>
            </section>
            <section class="panel account-panel">
              <div class="panel-heading">
                <h2>{{ tr("安全与会话", "Security and session") }}</h2>
                <ShieldCheck :size="20" />
              </div>
              <div class="security-item">
                <LockKeyhole :size="20" />
                <div>
                  <b>{{
                    preview
                      ? tr(
                          "只读预览，无真实会话",
                          "Read-only preview, no real session",
                        )
                      : tr("服务端安全会话", "Authenticated server session")
                  }}</b>
                  <p>
                    {{
                      preview
                        ? tr(
                            "退出预览后可使用真实 API 登录。",
                            "Exit preview to sign in to the connected service.",
                          )
                        : tr(
                            "会话使用 HttpOnly Cookie；提交操作受 CSRF 保护。",
                            "Your session uses an HttpOnly cookie and requests have CSRF protection.",
                          )
                    }}
                  </p>
                </div>
                <CheckCircle2 :size="18" />
              </div>
              <div class="security-item">
                <ShieldCheck :size="20" />
                <div>
                  <b> {{ tr("支付资料保护", "Payment data protection") }} </b>
                  <p>
                    {{
                      tr(
                        "本系统不采集或存储完整银行卡信息。",
                        "This system does not collect or store full payment card details.",
                      )
                    }}
                  </p>
                </div>
                <CheckCircle2 :size="18" />
              </div>
              <div class="security-item">
                <AlertCircle :size="20" />
                <div>
                  <b>
                    {{
                      tr(
                        "密码与双重验证",
                        "Password and two-factor authentication",
                      )
                    }}
                  </b>
                  <p>
                    {{
                      tr(
                        "自助密码修改和双重验证尚未开放，请联系管理员处理账户访问问题。",
                        "Self-service password changes and two-factor authentication are not available yet. Contact your administrator for account access issues.",
                      )
                    }}
                  </p>
                </div>
              </div>
              <button
                class="button secondary"
                @click="logout"
                :disabled="saving"
              >
                <LogOut :size="16" />{{
                  preview
                    ? tr("退出只读预览", "Exit read-only preview")
                    : tr("退出当前会话", "Sign out of this session")
                }}
              </button>
            </section>
          </div></template
        >
        <section v-else class="panel empty-state">
          <h2>{{ tr("这个页面还不存在。", "Page not found") }}</h2>
          <p>
            {{
              tr(
                "返回工作台，继续管理你的云服务。",
                "Return to the console to manage your cloud services.",
              )
            }}
          </p>
          <button class="button primary" @click="go('overview')">
            <ArrowLeft :size="16" /> {{ tr("返回工作台", "Back to overview") }}
          </button>
        </section>
        <footer class="main-footer">
          <span>{{ branding.company_name || branding.site_name }} </span
          ><span
            >{{
              preview
                ? tr("只读预览", "READ-ONLY PREVIEW")
                : session.demo_mode
                  ? tr("演示环境", "DEVELOPMENT PREVIEW")
                  : tr("账单控制台", "BILLING CONSOLE")
            }}<i>·</i> {{ tr("日期使用 UTC", "Dates use UTC") }}
          </span>
        </footer>
      </main>
    </div>
  </div>
  <dialog
    ref="orderDialog"
    class="modal"
    aria-labelledby="order-title"
    @cancel="saving && $event.preventDefault()"
  >
    <form @submit.prevent="createOrder">
      <div class="modal-heading">
        <div>
          <p class="eyebrow">{{ tr("服务订单", "SERVICE ORDER") }}</p>
          <h2 id="order-title">
            {{ tr("确认你的云服务器", "Confirm your cloud server") }}
          </h2>
        </div>
        <button
          type="button"
          class="icon-button"
          :aria-label="tr('关闭', 'Close')"
          :disabled="saving"
          @click="orderDialog?.close()"
        >
          <X :size="21" />
        </button>
      </div>
      <div v-if="selectedPlan" class="order-plan">
        <div class="service-icon"><Server :size="24" /></div>
        <div>
          <b>{{ selectedPlan.name }}</b>
          <p>
            {{ selectedPlan.cpu }} vCPU · {{ selectedPlan.memory_gb }} GB ·
            {{ selectedPlan.disk_gb }} GB
          </p>
        </div>
        <strong
          >{{
            money(
              selectedPlan.price_minor,
              selectedPlan.currency,
              selectedPlan.currency_format,
            )
          }}<small> {{ tr("/ 月", "/ month") }} </small></strong
        >
      </div>
      <label for="hostname"> {{ tr("服务器名称", "Server name") }} </label
      ><input
        id="hostname"
        v-model="hostname"
        pattern="[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]|[a-zA-Z0-9]"
        maxlength="63"
        required
        :placeholder="tr('例如 production-api', 'For example, production-api')"
        autocomplete="off"
        :disabled="saving || !!pendingOrder"
      />
      <p class="field-help">
        {{
          tr(
            "1–63 个英文字母、数字或连字符，不以连字符开头或结尾。",
            "1–63 letters, digits or hyphens. Must not start or end with a hyphen.",
          )
        }}
      </p>
      <dl class="order-summary">
        <div>
          <dt>{{ tr("区域", "Region") }}</dt>
          <dd>{{ selectedPlan?.region }}</dd>
        </div>
        <div>
          <dt>{{ tr("计费周期", "Billing cycle") }}</dt>
          <dd>{{ tr("每月", "Monthly") }} · {{ selectedPlan?.currency }}</dd>
        </div>
        <div>
          <dt>{{ tr("首期订单金额", "Initial order amount") }}</dt>
          <dd>
            {{
              money(
                selectedPlan?.price_minor || 0,
                selectedPlan?.currency,
                selectedPlan?.currency_format,
              )
            }}
          </dd>
        </div>
      </dl>
      <div class="alert info">
        <AlertCircle :size="18" /><span>{{
          preview
            ? tr(
                "只读预览，不能创建订单。",
                "Read-only preview. Orders cannot be created.",
              )
            : tr(
                "创建订单不代表付款。支付和自动开通尚未接入，不会扣款或交付真实服务器。",
                "Creating an order does not make a payment. Payments and provisioning are not connected; no charges or real servers will be created.",
              )
        }}</span>
      </div>
      <label class="checkbox-label"
        ><input
          v-model="agreed"
          type="checkbox"
          required
          :disabled="preview || saving || !!pendingOrder"
        /><span>
          {{
            tr(
              "我确认方案与金额，了解此操作仅创建待付款订单。",
              "I have checked the plan and amount and understand that this creates an unpaid order only.",
            )
          }}
        </span></label
      >
      <div v-if="modalError" class="alert error" role="alert">
        <AlertCircle :size="18" /><span>{{ modalError }}</span>
      </div>
      <button
        class="button primary full"
        :disabled="preview || saving || !agreed || (loading && !pendingOrder)"
      >
        <LoaderCircle v-if="saving" :size="17" class="spin" />{{
          saving
            ? tr("正在创建…", "Creating…")
            : preview
              ? tr("预览模式不可下单", "Orders disabled in preview")
              : pendingOrder
                ? tr("核对并重试原订单", "Retry original order")
                : tr("创建待付款订单", "Create unpaid order")
        }}<ArrowRight v-if="!saving" :size="17" />
      </button>
    </form>
  </dialog>
  <dialog
    ref="cancellationDialog"
    class="modal cancellation-modal"
    aria-labelledby="cancellation-title"
    data-testid="cancellation-dialog"
    @cancel="saving ? $event.preventDefault() : closeCancellation()"
  >
    <form @submit.prevent="cancelOrder">
      <div class="modal-heading">
        <div>
          <p class="eyebrow">{{ tr("订单处理", "ORDER ACTION") }}</p>
          <h2 id="cancellation-title">{{ tr("取消订单", "Cancel order") }}</h2>
        </div>
        <button
          type="button"
          class="icon-button"
          :aria-label="tr('关闭', 'Close')"
          :disabled="saving"
          @click="closeCancellation"
        >
          <X :size="21" />
        </button>
      </div>
      <dl v-if="selectedCancellation" class="order-summary">
        <div>
          <dt>{{ tr("订单编号", "Order number") }}</dt>
          <dd class="mono">{{ selectedCancellation.number }}</dd>
        </div>
        <div>
          <dt>{{ tr("服务方案", "Plan") }}</dt>
          <dd>
            {{
              selectedCancellation.plan_snapshot?.name ||
              selectedCancellation.plan_name
            }}
          </dd>
        </div>
        <div>
          <dt>{{ tr("订单金额", "Order amount") }}</dt>
          <dd>
            {{
              money(
                selectedCancellation.total_minor,
                selectedCancellation.currency,
                selectedCancellation.currency_format,
              )
            }}
          </dd>
        </div>
      </dl>
      <div class="alert info">
        <AlertCircle :size="18" /><span>{{
          tr(
            "确认后将取消此待付款订单，并作废关联的未付账单。历史记录和金额会保留。",
            "Confirming cancels this unpaid order and voids its unpaid invoice. Historical records and amounts are retained.",
          )
        }}</span>
      </div>
      <label for="cancellation-reason">{{
        tr("取消原因", "Cancellation reason")
      }}</label>
      <textarea
        id="cancellation-reason"
        v-model="cancellationReason"
        name="cancellation_reason"
        required
        maxlength="500"
        rows="3"
        :disabled="saving || !!pendingCancellation?.uncertain"
        :aria-invalid="!!cancellationReason && !cancellationReasonValid"
        aria-describedby="cancellation-reason-help"
      ></textarea>
      <p
        id="cancellation-reason-help"
        class="field-help"
        :class="{ 'cancellation-invalid': cancellationReasonBytes > 500 }"
      >
        {{
          tr(
            "单行纯文本，不含尖括号，去除首尾空白后 1–500 个 UTF-8 字节。",
            "Single-line plain text without angle brackets; 1–500 UTF-8 bytes after trimming whitespace.",
          )
        }}
        <span>{{ cancellationReasonBytes }}/500</span>
      </p>
      <label class="checkbox-label">
        <input
          v-model="cancellationAgreed"
          type="checkbox"
          name="confirm_cancellation"
          required
          :disabled="saving || !!pendingCancellation?.uncertain"
        />
        <span>{{
          tr(
            "我确认取消此订单并作废关联未付账单。",
            "I confirm cancelling this order and voiding its unpaid invoice.",
          )
        }}</span>
      </label>
      <div
        v-if="pendingCancellation?.uncertain"
        class="alert info"
        role="status"
      >
        <AlertCircle :size="18" /><span>{{
          tr(
            "取消结果尚未确认。请查看最新订单记录；也可明确重试同一订单和原原因。",
            "The cancellation result is unconfirmed. Check current order history, or explicitly retry the same order and original reason.",
          )
        }}</span>
      </div>
      <div v-if="cancellationMessage" class="alert error" role="alert">
        <AlertCircle :size="18" /><span>{{ cancellationMessage }}</span>
      </div>
      <button
        class="button primary full"
        type="submit"
        :disabled="
          preview ||
          saving ||
          loading ||
          !cancellationAgreed ||
          !cancellationReasonValid ||
          cancellationBlocked
        "
      >
        <LoaderCircle v-if="saving" class="spin" :size="17" />{{
          saving
            ? tr("正在取消…", "Cancelling…")
            : pendingCancellation?.uncertain
              ? tr("重试原取消请求", "Retry original cancellation")
              : tr("确认取消订单", "Confirm cancellation")
        }}
      </button>
      <button
        type="button"
        class="button secondary full"
        :disabled="saving || loading"
        @click="checkCancellationHistory"
      >
        {{ tr("查看最新订单记录", "Check current order history") }}
      </button>
    </form>
  </dialog>
  <dialog
    ref="invoiceDialog"
    class="modal invoice-modal"
    aria-labelledby="invoice-title"
    @cancel="closeInvoice()"
  >
    <div class="modal-heading">
      <div>
        <p class="eyebrow">{{ tr("账单明细", "BILLING DETAILS") }}</p>
        <h2 id="invoice-title">{{ tr("账单详情", "Invoice details") }}</h2>
      </div>
      <button
        class="icon-button"
        :aria-label="tr('关闭', 'Close')"
        :disabled="saving"
        @click="closeInvoice()"
      >
        <X :size="21" />
      </button>
    </div>
    <template v-if="selectedInvoice"
      ><div class="invoice-document">
        <div class="invoice-doc-top">
          <div class="brand-mark">
            <ReceiptText :size="25" aria-hidden="true" />
          </div>
          <span class="badge" :class="statusTone(selectedInvoice.status)">{{
            statusLabel(selectedInvoice.status)
          }}</span>
        </div>
        <h3>{{ selectedInvoice.number }}</h3>
        <dl class="invoice-issuer" v-if="selectedInvoice.issuer">
          <div>
            <dt>{{ tr("开具方", "Issued by") }}</dt>
            <dd>{{ selectedInvoice.issuer.name }}</dd>
          </div>
          <div v-if="selectedInvoice.issuer.address">
            <dt>{{ tr("地址", "Address") }}</dt>
            <dd>{{ selectedInvoice.issuer.address }}</dd>
          </div>
          <div v-if="selectedInvoice.issuer.support_email">
            <dt>{{ tr("联系邮箱", "Contact email") }}</dt>
            <dd>{{ selectedInvoice.issuer.support_email }}</dd>
          </div>
        </dl>
        <p v-else class="page-note">
          {{
            tr(
              "此历史账单未记录开具方信息。",
              "Issuer information was not recorded for this historical invoice.",
            )
          }}
        </p>
        <div class="invoice-dates">
          <div>
            <span> {{ tr("出账日期", "Issued on") }} </span
            ><b>{{ date(selectedInvoice.issued_at) }}</b>
          </div>
          <div>
            <span> {{ tr("到期日期", "Due on") }} </span
            ><b>{{ date(selectedInvoice.due_at) }}</b>
          </div>
          <div>
            <span> {{ tr("币种", "Currency") }} </span
            ><b>{{ selectedInvoice.currency }}</b>
          </div>
        </div>
        <div class="invoice-line-header">
          <span> {{ tr("服务项目", "Service item") }} </span
          ><span> {{ tr("金额", "Amount") }} </span>
        </div>
        <template v-if="selectedInvoice.line_items?.length"
          ><div
            v-for="(item, index) in selectedInvoice.line_items"
            :key="index"
            class="invoice-line"
          >
            <span>{{ item.description }}</span
            ><b>{{
              money(
                item.amount_minor,
                selectedInvoice.currency,
                selectedInvoice.currency_format,
              )
            }}</b>
          </div></template
        >
        <div v-else class="invoice-line">
          <div>
            <b>{{
              invoiceOrder?.plan_name ||
              tr("云服务器服务", "Cloud server service")
            }}</b
            ><small>{{
              invoiceOrder?.number || selectedInvoice.order_id
            }}</small>
          </div>
          <b>{{
            money(
              selectedInvoice.amount_minor,
              selectedInvoice.currency,
              selectedInvoice.currency_format,
            )
          }}</b>
        </div>
        <div class="invoice-total">
          <span> {{ tr("账单总额", "Invoice total") }} </span
          ><strong>{{
            money(
              selectedInvoice.amount_minor,
              selectedInvoice.currency,
              selectedInvoice.currency_format,
            )
          }}</strong>
        </div>
        <p v-if="selectedInvoice.paid_at" class="paid-caption">
          <CheckCircle2 :size="15" /> {{ tr("付款日期：", "Paid on: ") }}
          {{ date(selectedInvoice.paid_at) }}
        </p>
      </div>
      <div
        v-if="!['paid', 'void', 'cancelled'].includes(selectedInvoice.status)"
        class="alert info"
      >
        <LockKeyhole :size="18" /><span>{{
          checkoutSession
            ? tr(
                "结账入口已准备好。前往服务商完成支付后，仍以服务端确认的账单状态为准。",
                "The checkout link is ready. After paying with the provider, the invoice status still depends on server confirmation.",
              )
            : tr(
                "如有可用支付适配器，可检查并获取结账入口。此处不收集银行卡信息，不会自动扣款。",
                "Check for an available payment adapter to get a checkout link. No payment card data is collected here and no automatic charge is made.",
              )
        }}</span>
      </div>
      <div v-if="modalError" class="alert error" role="alert">
        <AlertCircle :size="18" /><span>{{ modalError }}</span>
      </div>
      <button
        v-if="!['paid', 'void', 'cancelled'].includes(selectedInvoice.status)"
        class="button secondary full"
        :disabled="preview || saving || isAdmin"
        @click="checkout"
      >
        <LoaderCircle v-if="saving" :size="16" class="spin" /><LockKeyhole
          v-else
          :size="16"
        />{{
          preview
            ? tr("预览模式 · 支付不可用", "Preview · Payments unavailable")
            : isAdmin
              ? tr(
                  "管理员不能代客户付款",
                  "Administrators cannot pay for customers",
                )
              : saving
                ? tr("正在检查…", "Checking…")
                : tr("检查支付可用性", "Check payment availability")
        }}
      </button>
      <div v-if="checkoutSession" class="checkout-handoff">
        <a
          class="button primary full"
          :href="checkoutSession.checkout_url"
          @click="followCheckout"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ tr("前往支付服务商", "Open payment provider") }}
          <ArrowUpRight :size="16"
        /></a>
        <p>
          {{ tr("将在新标签页打开", "Opens in a new tab: ") }}
          {{ checkoutHost }}
          {{
            tr(
              "。此操作不代表已付款；链接过期后请重新检查。",
              ". This does not confirm payment. Check again if the link expires.",
            )
          }}
        </p>
      </div>
      <p class="invoice-caption">
        {{
          session.demo_mode
            ? tr(
                "演示账单，不作为税务发票或付款凭证。",
                "Demo invoice. Not a tax invoice or payment receipt.",
              )
            : tr(
                "此为服务账单，不替代当地税务发票。",
                "This service invoice does not replace a local tax invoice.",
              )
        }}
      </p></template
    >
  </dialog>
  <dialog
    ref="helpDialog"
    class="modal help-modal"
    aria-labelledby="help-title"
  >
    <div class="modal-heading">
      <h2 id="help-title">{{ tr("使用说明", "Help and information") }}</h2>
      <button
        class="icon-button"
        :aria-label="tr('关闭', 'Close')"
        @click="helpDialog?.close()"
      >
        <X :size="21" />
      </button>
    </div>
    <p>
      {{ branding.site_name }}
      {{
        tr(
          "提供服务、订单和账单管理。",
          "provides service, order and invoice management.",
        )
      }}
    </p>
    <p v-if="branding.support_email">
      <a :href="safeSettingsEmailHref(branding.support_email)">{{
        branding.support_email
      }}</a>
    </p>
    <p v-if="branding.support_url">
      <a
        :href="safeSettingsURL(branding.support_url)"
        target="_blank"
        rel="noopener noreferrer"
        >{{ tr("客户支持", "Support") }}</a
      >
    </p>
    <p v-if="branding.display_url">
      <a
        :href="safeSettingsURL(branding.display_url, true)"
        target="_blank"
        rel="noopener noreferrer"
        >{{ branding.display_url }}</a
      >
    </p>
    <ul class="help-list">
      <li>
        <Check :size="18" />
        {{
          tr(
            "真实 API、角色权限与服务端金额校验",
            "API authorization and server-side price validation",
          )
        }}
      </li>
      <li>
        <Check :size="18" />
        {{
          tr(
            "独立客户工作台与管理员视图",
            "Separate customer and administrator views",
          )
        }}
      </li>
      <li>
        <Clock3 :size="18" />
        {{
          tr(
            "支付网关、节点控制器尚未接入",
            "Payment gateways and server controllers are not connected",
          )
        }}
      </li>
      <li>
        <Clock3 :size="18" />
        {{
          tr(
            "税务、退款、密码自助服务尚待实施",
            "Tax, refunds and self-service passwords are not implemented yet",
          )
        }}
      </li>
    </ul>
    <div class="alert info">
      <ShieldCheck :size="19" /><span>
        {{
          tr(
            "演示不等于生产认证。真实上线前仍需安全审查、支付集成与备份恢复演练。",
            "A demo is not production certification. Security review, payment integration and backup recovery testing remain release requirements.",
          )
        }}
      </span>
    </div>
    <button class="button primary full" @click="helpDialog?.close()">
      {{ tr("了解了", "Got it") }}
    </button>
  </dialog>
</template>

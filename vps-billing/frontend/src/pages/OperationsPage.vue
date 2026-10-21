<script setup lang="ts">
import UiSelect from "../components/UiSelect.vue";
import UiLoading from "../components/UiLoading.vue";
import UiSpinner from "../components/UiSpinner.vue";

import GeminiFinanceOverview from "../components/GeminiFinanceOverview.vue";
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import OverlayPanel from "../components/OverlayPanel.vue";
import { useWorkspace } from "../composables/useWorkspace";
import { formatMoney, validateCheckout } from "../types/idc";
import type { AdminOverview } from "../types/idc";

type Role = "customer" | "admin";
type Format = {
  code: string;
  name: string;
  prefix: string;
  suffix: string;
  decimal_places: number;
};
type User = { id: string; email: string; name: string; role: Role };
type Account = User & { revision: number; disabled: boolean };
type Snapshot = {
  name: string;
  region: string;
  cpu: number;
  memory_gb: number;
  disk_gb: number;
  transfer_tb: number;
  billing_cycle: string;
};
type Order = {
  id: string;
  number: string;
  plan_name: string;
  hostname: string;
  status: string;
  currency: string;
  total_minor: number;
  currency_format: Format;
  created_at: string;
  service_id?: string;
  issuer?: Issuer;
  plan_snapshot?: Snapshot;
};
type Issuer = { name: string; address: string; support_email: string };
type Invoice = {
  id: string;
  number: string;
  order_id: string;
  status: string;
  amount_minor: number;
  currency: string;
  currency_format: Format;
  issued_at: string;
  due_at: string;
  paid_at?: string;
  issuer?: Issuer;
};
type Service = {
  id: string;
  name: string;
  plan_name: string;
  region: string;
  ipv4: string;
  status: string;
  next_due_at: string;
  price_minor: number;
  currency: string;
  currency_format: Format;
  cpu: number;
  memory_gb: number;
  disk_gb: number;
  customer_id?: string;
};
type Audit = {
  id: string;
  action: string;
  target: string;
  actor_email: string;
  detail: string;
  created_at: string;
  owner_id?: string;
};
type Attempt = {
  id: string;
  provider_id: string;
  state: string;
  amount_minor: number;
  currency: string;
  currency_decimal_places: number;
  created_at: string;
  updated_at: string;
};
type OrderDetails = {
  order: Order;
  invoice: Invoice | null;
  service: Service | null;
  customer?: User;
  payment_attempts: Attempt[];
  audit: Audit[];
  audit_has_more: boolean;
  payment_attempts_has_more: boolean;
};
type Page<T> = {
  items: T[];
  has_more: boolean;
  next_cursor?: string;
  limit: number;
};
type Checkout = {
  provider_id: string;
  session_id: string;
  checkout_url: string;
  expires_at: string;
};
const props = defineProps<{
  section: string;
  locale: "zh-CN" | "en";
  currency: string;
  mode: "demo" | "api";
  role: Role;
  initialId?: string;
}>();
const { read, write, generation: identityGeneration } = useWorkspace();
const t = (zh: string, en: string) => (props.locale === "en" ? en : zh);
const section = computed(() => props.section.split("/")[0]);
const prefix = computed(() => (props.role === "admin" ? "/admin" : ""));
const orders = ref<Order[]>([]),
  invoices = ref<Invoice[]>([]),
  services = ref<Service[]>([]),
  accounts = ref<Account[]>([]),
  audits = ref<Audit[]>([]);
const finance = ref<AdminOverview | null>(null);
const session = ref<{ user: User | null; demo_mode: boolean } | null>(null);
const loading = ref(false),
  refreshing = ref(false),
  loaded = ref(false),
  error = ref(""),
  notice = ref("");
const currentCursor = ref(""),
  cursorStack = ref<string[]>([]),
  nextCursor = ref(""),
  hasMore = ref(false);
const filters = reactive({
  q: "",
  status: "",
  role: "",
  action: "",
  actor: "",
  from: "",
  until: "",
  owner: "",
});
type Filters = typeof filters;
const appliedFilters = ref<Filters>({ ...filters });
const filtersChanged = computed(
  () => JSON.stringify(filters) !== JSON.stringify(appliedFilters.value),
);
const localSearch = ref(""),
  localStatus = ref("");
let epoch = 0;
const titles = computed(
  () =>
    ({
      finance: [
        t("财务核对", "Financial review"),
        t(
          "按原币核对已入账与待付账单。",
          "Review settled and unpaid invoices in their original currency.",
        ),
      ],
      orders: [
        t("订单", "Orders"),
        t("查看购买记录与订单状态。", "Review purchases and order status."),
      ],
      invoices: [
        t("账单", "Invoices"),
        t("查看账单明细和付款状态。", "Review invoices and payment status."),
      ],
      services: [
        t("服务", "Services"),
        t(
          "查看配置、归属与服务期限。",
          "Inspect configurations, ownership and service dates.",
        ),
      ],
      customers: [
        t("客户与权限", "Customers & access"),
        t("管理客户资料与访问权限。", "Manage customer profiles and access."),
      ],
      audit: [
        t("操作记录", "Activity log"),
        t("查清谁在什么时候，做了什么。", "Understand who did what, and when."),
      ],
      account: [
        t("我的账户", "My account"),
        t("管理你的账户资料。", "Your account details."),
      ],
    })[section.value === "order-detail" ? "orders" : section.value] || [
      t("页面不可用", "Page unavailable"),
      t("请选择一个有效页面。", "Choose an available page."),
    ],
);
function failure(e: unknown, writing = false) {
  const f = e as {
    code?: string;
    status?: number;
    requestId?: string;
    request_id?: string;
  };
  const code =
    typeof f?.code === "string" && /^[A-Z_]{1,80}$/.test(f.code) ? f.code : "";
  let text = writing
    ? t(
        "未确认操作结果。请先重新读取并核对，不要重复提交。",
        "The operation result is unconfirmed. Re-read and reconcile before submitting again.",
      )
    : t(
        "读取失败。请检查连接或重新登录后再试。",
        "Could not load data. Check the connection or sign in again.",
      );
  if (f?.status === 401 || f?.status === 403)
    text = t(
      "登录已过期或没有访问权限，请重新登录。",
      "Your session expired or access was denied. Sign in again.",
    );
  else if (f?.status === 409)
    text = t(
      "记录或业务状态已变化。重新读取后检查差异，再决定下一步。",
      "The record or business state changed. Reload and review before continuing.",
    );
  else if (code === "PAYMENT_NOT_CONFIGURED")
    text = t(
      "当前没有可用付款渠道。请保留账单，稍后刷新核对。",
      "No payment channel is currently available. Keep this invoice and refresh later.",
    );
  else if (f?.status === 400)
    text = t(
      "提交内容未通过校验。请检查字段、版本和操作原因。",
      "Validation failed. Check fields, record revision and the reason.",
    );
  const id = f?.requestId || f?.request_id || "";
  return (
    text +
    (code ? ` · ${code}` : "") +
    (/^[a-f0-9]{32}$/.test(id)
      ? ` · ${t("请求编号", "Request ID")}: ${id}`
      : "")
  );
}
const uncertain = (e: unknown) => {
  const f = e as { status?: number; uncertain?: boolean };
  return f?.uncertain === true || !f?.status || f.status >= 500;
};
function statusLabel(s: string) {
  return (
    (
      {
        pending_payment: t("待付款", "Awaiting payment"),
        unpaid: t("未付款", "Unpaid"),
        paid: t("已付款", "Paid"),
        cancelled: t("已取消", "Cancelled"),
        void: t("已作废", "Void"),
        active: t("使用中", "Active"),
        suspended: t("已暂停", "Suspended"),
        expired: t("已到期", "Expired"),
        failed: t("失败", "Failed"),
      } as Record<string, string>
    )[s] || s
  );
}
function badge(s: string) {
  return s === "paid" || s === "active"
    ? "badge-success"
    : s === "pending_payment" || s === "unpaid"
      ? "badge-warning"
      : s === "cancelled" || s === "void" || s === "expired"
        ? "badge-neutral"
        : "badge-info";
}
const money = (n: number, f: Format) => formatMoney(n, f);
function sameFields(a: object | undefined, b: object | undefined): boolean {
  if (!a || !b) return a === b;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.every((k) => {
    const av = (a as Record<string, unknown>)[k],
      bv = (b as Record<string, unknown>)[k];
    return av && bv && typeof av === "object" && typeof bv === "object"
      ? sameFields(av, bv)
      : av === bv;
  });
}
function utc(s: string) {
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? "—"
    : d
        .toISOString()
        .replace("T", " ")
        .replace(".000Z", " UTC")
        .replace("Z", " UTC");
}
const bytes = (s: string) => new TextEncoder().encode(s).length;
function validUTCFilter(value: string): boolean {
  // The branded text field accepts one unambiguous UTC representation, not a
  // locale-dependent date or a timezone that would be appended twice below.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return false;
  const canonical = value.length === 16 ? `${value}:00` : value;
  const stamp = Date.parse(`${canonical}Z`);
  return (
    Number.isFinite(stamp) &&
    new Date(stamp).toISOString().slice(0, 19) === canonical
  );
}
function validateFilters(values: Filters = filters) {
  if (section.value !== "audit") return "";
  if (values.action && !/^[a-z][a-z0-9_.-]{0,63}$/.test(values.action))
    return t("动作码格式不正确。", "Invalid action code.");
  if (bytes(values.actor) > 254) return t("操作者过长。", "Actor is too long.");
  if (
    props.role === "admin" &&
    values.owner &&
    !/^[a-f0-9]{32}$/.test(values.owner)
  )
    return t(
      "所属账户须为32位小写ID，不是操作者。",
      "Owner must be a 32-character lowercase account ID, not the actor.",
    );
  if (values.from && !validUTCFilter(values.from))
    return t("起始UTC时间不正确。", "Invalid UTC start time.");
  if (values.until && !validUTCFilter(values.until))
    return t("截止UTC时间不正确。", "Invalid UTC end time.");
  if (
    values.from &&
    values.until &&
    Date.parse(`${values.from}Z`) >= Date.parse(`${values.until}Z`)
  )
    return t("起始时间必须早于截止时间。", "Start must be before end.");
  return "";
}
function query(values: Filters, cursor: string) {
  const q: Record<string, string> = { limit: "50" };
  if (cursor) q.cursor = cursor;
  if (section.value === "customers") {
    if (values.q.trim()) q.q = values.q.trim();
    if (values.role) q.role = values.role;
    if (values.status) q.status = values.status;
  } else {
    if (values.action) q.action = values.action;
    if (values.actor) q.actor_email = values.actor;
    if (values.from) q.from = new Date(`${values.from}Z`).toISOString();
    if (values.until) q.until = new Date(`${values.until}Z`).toISOString();
    if (props.role === "admin" && values.owner) q.owner_id = values.owner;
  }
  return q;
}
async function loadPage(
  cursor = currentCursor.value,
  stack = [...cursorStack.value],
  criteria: Filters = { ...appliedFilters.value },
) {
  const invalid = validateFilters(criteria);
  if (invalid) {
    error.value = invalid;
    return;
  }
  const stamp = ++epoch;
  error.value = "";
  refreshing.value = loaded.value;
  loading.value = !loaded.value;
  try {
    const current = await read<{ user: User | null; demo_mode: boolean }>(
      "/session",
    );
    if (stamp !== epoch) return;
    if (
      session.value?.user &&
      (session.value.user.id !== current.user?.id ||
        session.value.user.role !== current.user?.role)
    ) {
      clearData();
      closeAll(true);
    }
    session.value = current;
    if (
      !current.user ||
      (props.role === "admin" && current.user.role !== "admin")
    )
      throw { status: 403, code: "FORBIDDEN" };
    if (section.value === "finance") {
      if (props.role !== "admin" || current.user.role !== "admin")
        throw { status: 403, code: "FORBIDDEN" };
      const [summary, records] = await Promise.all([
        read<AdminOverview>("/admin/overview", { currency: props.currency }),
        read<Invoice[]>("/admin/invoices"),
      ]);
      if (stamp !== epoch) return;
      if (
        summary.currency !== props.currency ||
        summary.currency_format.code !== props.currency ||
        summary.count_scope !== "currency"
      )
        throw { code: "INVALID_RESPONSE" };
      finance.value = summary;
      invoices.value = records;
    } else if (section.value === "orders" || section.value === "order-detail") {
      const data = await read<Order[]>(`${prefix.value}/orders`);
      if (stamp === epoch) orders.value = data;
    } else if (section.value === "invoices") {
      const data = await read<Invoice[]>(`${prefix.value}/invoices`);
      if (stamp === epoch) invoices.value = data;
    } else if (section.value === "services") {
      const data = await read<Service[]>(`${prefix.value}/services`);
      if (stamp === epoch) services.value = data;
    } else if (section.value === "customers" || section.value === "audit") {
      const path =
        section.value === "customers"
          ? "/admin/customer-accounts"
          : `${prefix.value}/audit-events`;
      if (section.value === "customers" && props.role !== "admin")
        throw { status: 403, code: "FORBIDDEN" };
      const data = await read<Page<Account | Audit>>(
        path,
        query(criteria, cursor),
      );
      if (stamp !== epoch) return;
      if (section.value === "customers")
        accounts.value = data.items as Account[];
      else audits.value = data.items as Audit[];
      hasMore.value = data.has_more;
      nextCursor.value = data.next_cursor || "";
      // Commit cursor, filters and rows together. A failed next page is not a new page.
      currentCursor.value = cursor;
      cursorStack.value = stack;
      appliedFilters.value = { ...criteria };
    }
    if (stamp === epoch) loaded.value = true;
  } catch (e) {
    if (stamp === epoch) {
      const f = e as { status?: number };
      if (f.status === 401 || f.status === 403) {
        clearData();
        closeAll(true);
      }
      error.value = failure(e);
    }
  } finally {
    if (stamp === epoch) {
      loading.value = false;
      refreshing.value = false;
    }
  }
}
async function load() {
  invalidateCheckout();
  await loadPage();
}
function clearData() {
  orders.value = [];
  invoices.value = [];
  services.value = [];
  accounts.value = [];
  audits.value = [];
  finance.value = null;
  loaded.value = false;
}
async function applyFilters() {
  await loadPage("", [], { ...filters });
}
async function nextPage() {
  if (
    !hasMore.value ||
    !nextCursor.value ||
    filtersChanged.value ||
    loading.value ||
    refreshing.value
  )
    return;
  await loadPage(nextCursor.value, [...cursorStack.value, currentCursor.value]);
}
async function prevPage() {
  if (
    !cursorStack.value.length ||
    filtersChanged.value ||
    loading.value ||
    refreshing.value
  )
    return;
  await loadPage(
    cursorStack.value[cursorStack.value.length - 1] || "",
    cursorStack.value.slice(0, -1),
  );
}
const filteredOrders = computed(() =>
  orders.value.filter(
    (o) =>
      (!localStatus.value || o.status === localStatus.value) &&
      `${o.number} ${o.hostname} ${o.id} ${o.plan_name}`
        .toLowerCase()
        .includes(localSearch.value.toLowerCase()),
  ),
);
const filteredInvoices = computed(() =>
  invoices.value.filter(
    (i) =>
      (!localStatus.value || i.status === localStatus.value) &&
      `${i.number} ${i.id} ${i.order_id}`
        .toLowerCase()
        .includes(localSearch.value.toLowerCase()),
  ),
);
const financeInvoices = computed(() =>
  filteredInvoices.value.filter((i) => i.currency === props.currency),
);

const detail = ref<OrderDetails | null>(null),
  invoice = ref<Invoice | null>(null),
  panel = ref<"order" | "invoice" | "account" | "">("");
const panelLoading = ref(false),
  panelError = ref(""),
  busy = ref(false),
  unresolved = ref(false),
  reason = ref("");
const checkout = ref<Checkout | null>(null),
  checkoutInvoiceId = ref(""),
  checkoutExpires = ref(false);
let detailEpoch = 0,
  expiryTimer: ReturnType<typeof setTimeout> | undefined;
const panelTitle = computed(() =>
  panel.value === "order"
    ? detail.value?.order.number || t("订单详情", "Order details")
    : panel.value === "invoice"
      ? invoice.value?.number || t("账单详情", "Invoice details")
      : editingId.value
        ? t("管理账户", "Manage account")
        : t("新建账户", "New account"),
);
function invalidateCheckout() {
  checkout.value = null;
  checkoutInvoiceId.value = "";
  checkoutExpires.value = false;
  if (expiryTimer) clearTimeout(expiryTimer);
}
function closeAll(force = false) {
  if (!force && (busy.value || unresolved.value)) {
    panelError.value = t(
      "请先核对本次操作结果，再关闭。",
      "Reconcile this operation before closing.",
    );
    return;
  }
  detailEpoch++;
  panel.value = "";
  detail.value = null;
  invoice.value = null;
  panelError.value = "";
  reason.value = "";
  busy.value = false;
  panelLoading.value = false;
  unresolved.value = false;
  accountForm.password = "";
  accountReady.value = false;
  invalidateCheckout();
}
async function openOrder(id: string) {
  if (busy.value || unresolved.value) return;
  const generation = ++detailEpoch;
  panel.value = "order";
  detail.value = null;
  panelError.value = "";
  panelLoading.value = true;
  reason.value = "";
  invalidateCheckout();
  try {
    const d = await read<OrderDetails>(
      `${prefix.value}/orders/${encodeURIComponent(id)}`,
    );
    if (generation === detailEpoch) {
      if (d.order.id !== id) throw { code: "INVALID_RESPONSE" };
      detail.value = d;
    }
  } catch (e) {
    if (generation === detailEpoch) panelError.value = failure(e);
  } finally {
    if (generation === detailEpoch) panelLoading.value = false;
  }
}
async function refreshOrder() {
  if (!detail.value || busy.value) return;
  const id = detail.value.order.id,
    generation = detailEpoch;
  panelLoading.value = true;
  panelError.value = "";
  try {
    const d = await read<OrderDetails>(
      `${prefix.value}/orders/${encodeURIComponent(id)}`,
    );
    if (generation !== detailEpoch) return;
    if (d.order.id !== id) throw { code: "INVALID_RESPONSE" };
    detail.value = d;
    unresolved.value = false;
    await load();
  } catch (e) {
    if (generation === detailEpoch) panelError.value = failure(e);
  } finally {
    if (generation === detailEpoch) panelLoading.value = false;
  }
}
const cancellable = computed(
  () =>
    !!detail.value &&
    detail.value.order.status === "pending_payment" &&
    !detail.value.order.service_id &&
    !detail.value.service &&
    !!detail.value.invoice &&
    detail.value.invoice.status === "unpaid",
);
async function cancelOrder() {
  if (!detail.value || !cancellable.value || busy.value || unresolved.value)
    return;
  if (!reason.value.trim() || bytes(reason.value.trim()) > 500) {
    panelError.value = t(
      "请填写1–500字节的取消原因。",
      "Enter a cancellation reason of 1–500 UTF-8 bytes.",
    );
    await focusError();
    return;
  }
  const d = detail.value,
    generation = detailEpoch;
  busy.value = true;
  panelError.value = "";
  try {
    const result = await write<{ order: Order; invoice: Invoice }>(
      `${prefix.value}/orders/${encodeURIComponent(d.order.id)}/cancel`,
      { reason: reason.value.trim() },
    );
    if (generation !== detailEpoch) return;
    const { status: previousOrderStatus, ...oldOrder } = d.order;
    const { status: nextOrderStatus, ...newOrder } = result.order;
    if (!d.invoice) throw new Error("Missing invoice");
    const { status: previousInvoiceStatus, ...oldInvoice } = d.invoice;
    const { status: nextInvoiceStatus, ...newInvoice } = result.invoice;
    if (
      nextOrderStatus !== "cancelled" ||
      nextInvoiceStatus !== "void" ||
      result.invoice.order_id !== d.order.id ||
      !sameFields(oldOrder, newOrder) ||
      !sameFields(oldInvoice, newInvoice)
    )
      throw new Error("Unexpected cancellation result");
    detail.value = { ...d, order: result.order, invoice: result.invoice };
    reason.value = "";
    notice.value = t(
      "订单已安全取消，关联账单已作废。",
      "Order safely cancelled; its invoice is void.",
    );
    await load();
  } catch (e) {
    if (generation === detailEpoch) {
      panelError.value = failure(e, true);
      unresolved.value = uncertain(e);
    }
  } finally {
    if (generation === detailEpoch) busy.value = false;
  }
}
async function openInvoice(id: string) {
  if (busy.value || unresolved.value) return;
  const generation = ++detailEpoch;
  panel.value = "invoice";
  invoice.value = null;
  panelLoading.value = true;
  panelError.value = "";
  invalidateCheckout();
  try {
    const d = await read<Invoice>(
      `${prefix.value}/invoices/${encodeURIComponent(id)}`,
    );
    if (generation === detailEpoch) {
      if (d.id !== id) throw { code: "INVALID_RESPONSE" };
      invoice.value = d;
    }
  } catch (e) {
    if (generation === detailEpoch) panelError.value = failure(e);
  } finally {
    if (generation === detailEpoch) panelLoading.value = false;
  }
}
async function refreshInvoice() {
  if (!invoice.value || busy.value) return;
  const id = invoice.value.id,
    generation = detailEpoch;
  panelLoading.value = true;
  panelError.value = "";
  invalidateCheckout();
  try {
    const d = await read<Invoice>(
      `${prefix.value}/invoices/${encodeURIComponent(id)}`,
    );
    if (generation !== detailEpoch) return;
    if (d.id !== id) throw { code: "INVALID_RESPONSE" };
    invoice.value = d;
    unresolved.value = false;
    await load();
  } catch (e) {
    if (generation === detailEpoch) panelError.value = failure(e);
  } finally {
    if (generation === detailEpoch) panelLoading.value = false;
  }
}
async function prepareCheckout() {
  if (
    !invoice.value ||
    invoice.value.status !== "unpaid" ||
    props.role !== "customer" ||
    busy.value ||
    unresolved.value
  )
    return;
  const id = invoice.value.id,
    generation = detailEpoch;
  busy.value = true;
  panelError.value = "";
  invalidateCheckout();
  try {
    const fresh = await read<Invoice>(`/invoices/${encodeURIComponent(id)}`);
    if (generation !== detailEpoch) return;
    if (fresh.id !== id) throw { code: "INVALID_RESPONSE" };
    invoice.value = fresh;
    if (fresh.status !== "unpaid") {
      panelError.value = t(
        "账单状态已变化，请核对最新记录。",
        "Invoice status changed. Review the latest record.",
      );
      return;
    }
    const result = await write<Checkout>(
      `/invoices/${encodeURIComponent(id)}/checkout`,
      {},
    );
    if (
      generation !== detailEpoch ||
      invoice.value?.id !== id ||
      panel.value !== "invoice"
    )
      return;
    validateCheckout(result);
    const remaining = Date.parse(result.expires_at) - Date.now();
    checkout.value = result;
    checkoutInvoiceId.value = id;
    expiryTimer = setTimeout(
      () => {
        checkout.value = null;
        checkoutExpires.value = true;
      },
      Math.min(remaining, 2147483647),
    );
  } catch (e) {
    if (generation === detailEpoch) {
      panelError.value = failure(e, true);
      unresolved.value = uncertain(e);
    }
  } finally {
    if (generation === detailEpoch) busy.value = false;
  }
}
function followCheckout(event: MouseEvent) {
  try {
    if (
      !checkout.value ||
      panel.value !== "invoice" ||
      props.role !== "customer" ||
      !invoice.value ||
      invoice.value.status !== "unpaid" ||
      invoice.value.id !== checkoutInvoiceId.value ||
      panelLoading.value ||
      busy.value ||
      unresolved.value
    )
      throw new Error("INVALID_CHECKOUT_CONTEXT");
    // Timers may be delayed or the wall clock may advance; re-check at the actual user action.
    validateCheckout(checkout.value);
  } catch {
    event.preventDefault();
    const expired =
      !!checkout.value && Date.parse(checkout.value.expires_at) <= Date.now();
    invalidateCheckout();
    checkoutExpires.value = expired;
    panelError.value = expired
      ? ""
      : t(
          "付款入口暂时无法确认，请刷新账单后核对，勿重复付款。",
          "The checkout link could not be confirmed. Refresh the invoice and check before paying again.",
        );
  }
}
const editingId = ref("");
const accountReady = ref(false);
const originalAccount = ref<Account | null>(null);
const accountForm = reactive({
  email: "",
  name: "",
  role: "customer" as Role,
  disabled: false,
  revision: 0,
  password: "",
  reason: "",
});
const accountTask = ref<"edit" | "password" | "revoke">("edit");
async function openAccount(id = "") {
  if (props.role !== "admin" || busy.value || unresolved.value) return;
  const generation = ++detailEpoch;
  panel.value = "account";
  editingId.value = id;
  panelError.value = "";
  panelLoading.value = !!id;
  accountTask.value = "edit";
  accountReady.value = !id;
  originalAccount.value = null;
  Object.assign(accountForm, {
    email: "",
    name: "",
    role: "customer",
    disabled: false,
    revision: 0,
    password: "",
    reason: "",
  });
  if (!id) return;
  try {
    const data = await read<Account>(
      `/admin/customer-accounts/${encodeURIComponent(id)}`,
    );
    if (generation === detailEpoch) {
      if (data.id !== id) throw { code: "INVALID_RESPONSE" };
      originalAccount.value = { ...data };
      Object.assign(accountForm, data, { password: "", reason: "" });
      accountReady.value = true;
    }
  } catch (e) {
    if (generation === detailEpoch) panelError.value = failure(e);
  } finally {
    if (generation === detailEpoch) panelLoading.value = false;
  }
}
const selfEdit = computed(
  () => !!editingId.value && editingId.value === session.value?.user?.id,
);
async function focusError() {
  await nextTick();
  document.querySelector<HTMLElement>(".operation-panel-error")?.focus();
}
async function saveAccount() {
  if (
    busy.value ||
    unresolved.value ||
    panelLoading.value ||
    !accountReady.value ||
    props.role !== "admin"
  )
    return;
  panelError.value = "";
  const why = accountForm.reason.trim(),
    name = accountForm.name.trim(),
    pass = accountForm.password;
  if (!why || bytes(why) > 500)
    panelError.value = t(
      "操作原因须为1–500字节。",
      "Reason must be 1–500 UTF-8 bytes.",
    );
  else if (
    (!editingId.value || accountTask.value === "edit") &&
    (!name || bytes(name) > 120)
  )
    panelError.value = t(
      "名称须为1–120字节。",
      "Name must be 1–120 UTF-8 bytes.",
    );
  else if (
    !editingId.value &&
    (!/^[^@\s<>]+@[^@\s<>]+$/.test(accountForm.email.trim()) ||
      !/^[\x21-\x7e]+$/.test(accountForm.email.trim()) ||
      bytes(accountForm.email.trim()) > 254)
  )
    panelError.value = t(
      "请填写有效ASCII邮箱。",
      "Enter a valid ASCII email address.",
    );
  else if (
    (!editingId.value || accountTask.value === "password") &&
    (bytes(pass) < 16 || bytes(pass) > 72 || !pass.trim() || why.includes(pass))
  )
    panelError.value = t(
      "密码须为16–72字节，不能全空白或出现在操作原因中。",
      "Password must be 16–72 UTF-8 bytes, not whitespace-only or included in the reason.",
    );
  else if (
    selfEdit.value &&
    (accountForm.disabled || accountForm.role !== "admin")
  )
    panelError.value = t(
      "不能停用或降低当前自己的管理员权限。",
      "You cannot disable or demote your current administrator account.",
    );
  if (panelError.value) {
    await focusError();
    return;
  }
  const generation = detailEpoch;
  busy.value = true;
  try {
    let result: Account;
    const previous = originalAccount.value;
    if (!editingId.value)
      result = await write<Account>("/admin/customer-accounts", {
        email: accountForm.email.trim().toLowerCase(),
        name,
        role: accountForm.role,
        password: pass,
        reason: why,
      });
    else {
      const path = `/admin/customer-accounts/${encodeURIComponent(editingId.value)}`;
      if (accountTask.value === "edit")
        result = await write<Account>(path, {
          name,
          role: accountForm.role,
          disabled: accountForm.disabled,
          revision: accountForm.revision,
          reason: why,
        });
      else if (accountTask.value === "password")
        result = await write<Account>(`${path}/password`, {
          password: pass,
          revision: accountForm.revision,
          reason: why,
        });
      else
        result = await write<Account>(`${path}/revoke-sessions`, {
          revision: accountForm.revision,
          reason: why,
        });
    }
    if (generation !== detailEpoch) return;
    const editingProfile = !editingId.value || accountTask.value === "edit";
    if (
      !result ||
      (editingId.value
        ? result.id !== editingId.value ||
          result.revision !== accountForm.revision + 1 ||
          result.email !== previous?.email
        : !/^[a-f0-9]{32}$/.test(result.id) ||
          result.revision !== 1 ||
          result.email !== accountForm.email.trim().toLowerCase()) ||
      result.name !== (editingProfile ? name : previous?.name) ||
      result.role !== (editingProfile ? accountForm.role : previous?.role) ||
      result.disabled !==
        (!editingId.value
          ? false
          : editingProfile
            ? accountForm.disabled
            : previous?.disabled)
    )
      throw { uncertain: true };
    accountForm.password = "";
    busy.value = false;
    closeAll(true);
    notice.value = t(
      "操作已由服务器确认。敏感变更会撤销旧会话。",
      "The server confirmed the change. Sensitive changes revoke old sessions.",
    );
    await load();
  } catch (e) {
    if (generation === detailEpoch) {
      panelError.value = failure(e, true);
      unresolved.value = uncertain(e);
      accountForm.password = "";
      await focusError();
    }
  } finally {
    if (generation === detailEpoch) busy.value = false;
  }
}
async function reconcileAccount() {
  if (busy.value || panelLoading.value || panel.value !== "account") return;
  const generation = detailEpoch,
    id = editingId.value,
    email = accountForm.email.trim().toLowerCase();
  panelError.value = "";
  panelLoading.value = true;
  try {
    const active = await read<{ user: User | null; demo_mode: boolean }>(
      "/session",
    );
    if (generation !== detailEpoch) return;
    session.value = active;
    if (!active.user || active.user.role !== "admin") {
      clearData();
      closeAll(true);
      return;
    }
    if (id) {
      const data = await read<Account>(
        `/admin/customer-accounts/${encodeURIComponent(id)}`,
      );
      if (generation !== detailEpoch) return;
      if (data.id !== id) throw { code: "INVALID_RESPONSE" };
      originalAccount.value = { ...data };
      Object.assign(accountForm, data, { password: "", reason: "" });
    } else {
      const results = await read<Page<Account>>("/admin/customer-accounts", {
        q: email,
        limit: "100",
      });
      if (generation !== detailEpoch) return;
      const exact = results.items.find((a) => a.email === email);
      if (!exact) {
        panelError.value = t(
          "尚未查到此邮箱账户，创建结果仍不确定，已阻止再次新增。请联系运营者核对。",
          "No account with this email was found. Creation is still unresolved; another submission is blocked. Ask the operator to reconcile.",
        );
        return;
      }
      editingId.value = exact.id;
      originalAccount.value = { ...exact };
      Object.assign(accountForm, exact, { password: "", reason: "" });
    }
    accountReady.value = true;
    unresolved.value = false;
    notice.value = t(
      "已读取最新账户。密码和会话撤销结果仍需核对，未自动重试。",
      "Latest account loaded. Password and session-revocation outcomes still require reconciliation; nothing was retried.",
    );
  } catch (e) {
    if (generation === detailEpoch) panelError.value = failure(e);
  } finally {
    if (generation === detailEpoch) panelLoading.value = false;
  }
}
function resetFilters() {
  Object.assign(filters, {
    q: "",
    status: "",
    role: "",
    action: "",
    actor: "",
    from: "",
    until: "",
    owner: "",
  });
  void applyFilters();
}
watch(
  () => [
    props.section,
    props.role,
    props.mode,
    props.initialId,
    identityGeneration.value,
  ],
  async () => {
    epoch++;
    detailEpoch++;
    clearData();
    closeAll(true);
    session.value = null;
    error.value = "";
    notice.value = "";
    localSearch.value = "";
    localStatus.value = "";
    currentCursor.value = "";
    cursorStack.value = [];
    Object.assign(filters, {
      q: "",
      status: "",
      role: "",
      action: "",
      actor: "",
      from: "",
      until: "",
      owner: "",
    });
    appliedFilters.value = { ...filters };
    await load();
    const id =
      props.initialId ||
      (props.section.startsWith("orders/") ? props.section.slice(7) : "");
    if (
      id &&
      loaded.value &&
      (section.value === "orders" || section.value === "order-detail")
    )
      await openOrder(id);
  },
  { immediate: true },
);
watch(
  () => props.currency,
  () => {
    if (section.value === "finance") {
      finance.value = null;
      void load();
    }
  },
);
onBeforeUnmount(() => {
  epoch++;
  detailEpoch++;
  accountForm.password = "";
  invalidateCheckout();
});
</script>

<template>
  <section class="operations-page">
    <header v-if="section !== 'finance'" class="operations-heading">
      <div>
        <h1>{{ titles[0] }}</h1>
        <p class="subtle">{{ titles[1] }}</p>
      </div>
      <div class="heading-actions">
        <button
          v-if="section === 'customers' && role === 'admin'"
          class="btn btn-admin"
          @click="openAccount()"
        >
          ＋ {{ t("新建账户", "New account") }}</button
        ><button
          class="btn btn-secondary"
          :disabled="loading || refreshing || busy"
          @click="load"
          :aria-busy="loading || refreshing"
        >
          <UiSpinner v-if="loading || refreshing" />{{
            refreshing ? t("刷新中…", "Refreshing…") : t("刷新", "Refresh")
          }}
        </button>
      </div>
    </header>
    <p v-if="mode === 'demo'" class="demo-note">
      {{
        t(
          "合成演示数据 · 所有更改仅保留在本次浏览器内存，不会付款或开通资源。",
          "Synthetic demo · Changes exist only in browser memory. No payments or resources are provisioned.",
        )
      }}
    </p>
    <div
      v-if="error && section !== 'finance'"
      class="feedback feedback-error"
      role="alert"
    >
      {{ error }}
      <span v-if="loaded">{{
        t(
          "已保留上次读取内容，可能过期。",
          "Previous data is retained and may be stale.",
        )
      }}</span>
    </div>
    <p v-if="notice" class="feedback feedback-info" role="status">
      {{ notice }}
    </p>
    <UiLoading
      v-if="loading && section !== 'finance'"
      :layout="section === 'account' ? 'form' : 'list'"
      :label="t('正在读取记录…', 'Loading records…')"
    />

    <GeminiFinanceOverview
      v-if="section === 'finance' && role === 'admin'"
      :locale="locale"
      :summary="finance"
      :invoices="financeInvoices"
      :loading="loading || refreshing"
      :error="error"
      @refresh="load"
      @open-invoice="openInvoice"
    />

    <template
      v-if="
        loaded &&
        (section === 'orders' ||
          section === 'order-detail' ||
          section === 'invoices')
      "
    >
      <div class="surface-card list-tools">
        <label class="search-control"
          ><span class="form-label">{{
            t("搜索已载入记录", "Search loaded records")
          }}</span
          ><input
            v-model="localSearch"
            class="form-input"
            :placeholder="t('编号、名称或ID', 'Number, name or ID')" /></label
        ><label
          ><span class="form-label">{{ t("状态", "Status") }}</span
          ><UiSelect v-model="localStatus" class="form-select"
            ><option value="">{{ t("所有状态", "All statuses") }}</option>
            <template v-if="section === 'invoices'"
              ><option value="unpaid">{{ t("未付款", "Unpaid") }}</option>
              <option value="paid">{{ t("已付款", "Paid") }}</option>
              <option value="void">{{ t("已作废", "Void") }}</option></template
            ><template v-else
              ><option value="pending_payment">
                {{ t("待付款", "Awaiting payment") }}
              </option>
              <option value="paid">{{ t("已付款", "Paid") }}</option>
              <option value="cancelled">
                {{ t("已取消", "Cancelled") }}
              </option></template
            ></UiSelect
          ></label
        >
      </div>
      <p class="list-scope">
        {{
          t(
            "最多展示最近 1,000 条记录，搜索当前列表。",
            "Showing up to 1,000 recent records. Search this list.",
          )
        }}
      </p>
      <div
        v-if="section === 'orders' || section === 'order-detail'"
        class="record-list"
      >
        <article
          v-for="o in filteredOrders"
          :key="o.id"
          class="surface-card record-row"
        >
          <div class="record-main">
            <div class="record-title">
              <span class="font-mono">{{ o.number }}</span
              ><span class="badge" :class="badge(o.status)">{{
                statusLabel(o.status)
              }}</span>
            </div>
            <h2>{{ o.plan_name }}</h2>
            <p>{{ o.hostname }}</p>
            <p class="record-id">{{ o.id }}</p>
          </div>
          <div class="record-side">
            <strong class="money-figure">{{
              money(o.total_minor, o.currency_format)
            }}</strong
            ><span class="subtle">{{ utc(o.created_at) }}</span
            ><button class="btn btn-secondary" @click="openOrder(o.id)">
              {{ t("订单详情", "Order details") }} ↗
            </button>
          </div>
        </article>
        <div v-if="!filteredOrders.length" class="surface-card empty-state">
          <h2>{{ t("没有符合条件的订单", "No matching orders") }}</h2>
          <p>
            {{
              t(
                "试试清除筛选，或前往目录选择套餐。",
                "Clear your filters or visit the catalog to choose a plan.",
              )
            }}
          </p>
        </div>
      </div>
      <div v-else class="record-list">
        <article
          v-for="i in filteredInvoices"
          :key="i.id"
          class="surface-card record-row"
        >
          <div class="record-main">
            <div class="record-title">
              <span class="font-mono">{{ i.number }}</span
              ><span class="badge" :class="badge(i.status)">{{
                statusLabel(i.status)
              }}</span>
            </div>
            <p>{{ t("开具", "Issued") }} {{ utc(i.issued_at) }}</p>
            <p>{{ t("到期", "Due") }} {{ utc(i.due_at) }}</p>
            <p class="record-id">{{ i.id }}</p>
          </div>
          <div class="record-side">
            <strong class="money-figure">{{
              money(i.amount_minor, i.currency_format)
            }}</strong
            ><button
              class="btn"
              :class="
                i.status === 'unpaid' && role === 'customer'
                  ? 'btn-primary'
                  : 'btn-secondary'
              "
              @click="openInvoice(i.id)"
            >
              {{
                i.status === "unpaid" && role === "customer"
                  ? t("查看并付款", "Review & pay")
                  : t("查看账单", "View invoice")
              }}
              ↗
            </button>
          </div>
        </article>
        <div v-if="!filteredInvoices.length" class="surface-card empty-state">
          <h2>{{ t("没有符合条件的账单", "No matching invoices") }}</h2>
          <p>
            {{
              t(
                "暂无账单，购买套餐后可在这里查看。",
                "Your invoices will appear here after ordering.",
              )
            }}
          </p>
        </div>
      </div>
    </template>

    <template v-else-if="loaded && section === 'services'">
      <div class="service-grid">
        <article
          v-for="s in services"
          :key="s.id"
          class="surface-card service-card"
        >
          <div class="record-title">
            <h2>{{ s.name }}</h2>
            <span class="badge" :class="badge(s.status)">{{
              statusLabel(s.status)
            }}</span>
          </div>
          <p class="subtle">{{ s.plan_name }} · {{ s.region }}</p>
          <p class="record-id">{{ s.id }}</p>
          <dl class="detail-grid">
            <div>
              <dt>CPU</dt>
              <dd>{{ s.cpu }} vCPU</dd>
            </div>
            <div>
              <dt>{{ t("内存", "Memory") }}</dt>
              <dd>{{ s.memory_gb }} GB</dd>
            </div>
            <div>
              <dt>{{ t("磁盘", "Disk") }}</dt>
              <dd>{{ s.disk_gb }} GB</dd>
            </div>
            <div>
              <dt>IPv4</dt>
              <dd>{{ s.ipv4 || "—" }}</dd>
            </div>
          </dl>
          <div class="service-footer">
            <strong class="money-figure">{{
              money(s.price_minor, s.currency_format)
            }}</strong
            ><span class="subtle"
              >{{ t("下次到期", "Next due") }} {{ utc(s.next_due_at) }}</span
            >
          </div>
          <p v-if="role === 'admin'" class="record-id">
            {{ t("所属账户", "Owner account") }}: {{ s.customer_id || "—" }}
          </p>
        </article>
      </div>
      <div v-if="!services.length" class="surface-card empty-state">
        <h2>{{ t("还没有服务", "No services yet") }}</h2>
        <p>
          {{
            t(
              "服务器开通后，可在这里查看配置与到期时间。",
              "Once a server is provisioned, its details and due date appear here.",
            )
          }}
        </p>
      </div>
    </template>

    <template v-else-if="loaded && section === 'customers' && role === 'admin'">
      <form class="surface-card filter-grid" @submit.prevent="applyFilters">
        <label
          ><span class="form-label">{{ t("名称或邮箱", "Name or email") }}</span
          ><input v-model="filters.q" class="form-input" /></label
        ><label
          ><span class="form-label">{{ t("角色", "Role") }}</span
          ><UiSelect v-model="filters.role" class="form-select"
            ><option value="">{{ t("全部角色", "All roles") }}</option>
            <option value="customer">{{ t("客户", "Customer") }}</option>
            <option value="admin">
              {{ t("管理员", "Administrator") }}
            </option></UiSelect
          ></label
        ><label
          ><span class="form-label">{{ t("状态", "Status") }}</span
          ><UiSelect v-model="filters.status" class="form-select"
            ><option value="">{{ t("全部", "All") }}</option>
            <option value="active">{{ t("已启用", "Active") }}</option>
            <option value="disabled">
              {{ t("已停用", "Disabled") }}
            </option></UiSelect
          ></label
        ><button
          class="btn btn-secondary"
          :disabled="refreshing"
          :aria-busy="refreshing"
        >
          <UiSpinner v-if="refreshing" />{{ t("应用筛选", "Apply filters") }}
        </button>
      </form>
      <div class="record-list">
        <article
          v-for="a in accounts"
          :key="a.id"
          class="surface-card record-row"
        >
          <div class="record-main">
            <div class="record-title">
              <h2>{{ a.name }}</h2>
              <span
                class="badge"
                :class="a.role === 'admin' ? 'badge-warning' : 'badge-info'"
                >{{
                  a.role === "admin"
                    ? t("管理员", "Administrator")
                    : t("客户", "Customer")
                }}</span
              ><span class="badge badge-neutral">{{
                a.disabled ? t("已停用", "Disabled") : t("已启用", "Active")
              }}</span>
            </div>
            <p class="break-word">{{ a.email }}</p>
            <p class="record-id">{{ a.id }}</p>
          </div>
          <button class="btn btn-secondary" @click="openAccount(a.id)">
            {{ t("管理账户", "Manage access") }} ↗
          </button>
        </article>
        <div v-if="!accounts.length" class="surface-card empty-state">
          <h2>{{ t("没有符合条件的账户", "No matching accounts") }}</h2>
          <p>
            {{
              t(
                "更改筛选条件或新建账户。",
                "Change the filters or create an account.",
              )
            }}
          </p>
        </div>
      </div>
    </template>

    <template v-else-if="loaded && section === 'audit'">
      <details class="audit-filter-disclosure">
        <summary>
          <span>{{ t("筛选操作记录", "Filter records") }}</span
          ><span class="muted">{{
            t("动作、操作者与 UTC 时间", "Action, actor and UTC time")
          }}</span>
        </summary>
        <form
          class="surface-card filter-grid audit-filters"
          @submit.prevent="applyFilters"
        >
          <label
            ><span class="form-label">{{
              t("动作码 · 精确匹配", "Action · exact match")
            }}</span
            ><input
              v-model="filters.action"
              class="form-input font-mono"
              placeholder="order.created" /></label
          ><label
            ><span class="form-label">{{
              t("操作者 · 精确匹配", "Actor · exact match")
            }}</span
            ><input
              v-model="filters.actor"
              class="form-input"
              placeholder="operator@example.invalid" /></label
          ><label
            ><span class="form-label">{{
              t("起始时间 · UTC（含）", "From · UTC (inclusive)")
            }}</span
            ><input
              v-model="filters.from"
              class="form-input"
              type="text"
              inputmode="numeric"
              placeholder="YYYY-MM-DDTHH:mm"
              maxlength="19"
              autocomplete="off"
              spellcheck="false" /></label
          ><label
            ><span class="form-label">{{
              t("截止时间 · UTC（不含）", "Until · UTC (exclusive)")
            }}</span
            ><input
              v-model="filters.until"
              class="form-input"
              type="text"
              inputmode="numeric"
              placeholder="YYYY-MM-DDTHH:mm"
              maxlength="19"
              autocomplete="off"
              spellcheck="false" /></label
          ><label v-if="role === 'admin'"
            ><span class="form-label">{{
              t("所属账户ID · 非操作者", "Owner account ID · not actor")
            }}</span
            ><input v-model="filters.owner" class="form-input font-mono"
          /></label>
          <div class="filter-actions">
            <button
              class="btn btn-primary"
              :disabled="refreshing"
              :aria-busy="refreshing"
            >
              <UiSpinner v-if="refreshing" />{{ t("查询", "Search") }}</button
            ><button
              class="btn btn-ghost"
              type="button"
              :disabled="refreshing"
              @click="resetFilters"
            >
              {{ t("重置", "Reset") }}
            </button>
          </div>
        </form>
      </details>
      <p class="list-scope">
        {{
          t(
            "业务审计，不是主机日志。动作码不是HTTP状态；事件ID不是请求编号。每页最多50条，按UTC时间和事件ID倒序。",
            "Business audit, not host logs. Action codes are not HTTP statuses; event IDs are not request IDs. Up to 50 per page, newest UTC time and event ID first.",
          )
        }}
      </p>
      <div class="record-list">
        <article
          v-for="a in audits"
          :key="a.id"
          class="surface-card audit-card"
        >
          <div class="record-title">
            <h2 class="font-mono">{{ a.action }}</h2>
            <time class="subtle">{{ utc(a.created_at) }}</time>
          </div>
          <dl class="detail-grid">
            <div>
              <dt>{{ t("操作者", "Actor") }}</dt>
              <dd>{{ a.actor_email }}</dd>
            </div>
            <div>
              <dt>{{ t("目标", "Target") }}</dt>
              <dd class="font-mono">{{ a.target }}</dd>
            </div>
            <div v-if="role === 'admin'">
              <dt>{{ t("所属账户", "Owner account") }}</dt>
              <dd class="font-mono">{{ a.owner_id || "—" }}</dd>
            </div>
            <div>
              <dt>{{ t("事件ID", "Event ID") }}</dt>
              <dd class="font-mono">{{ a.id }}</dd>
            </div>
          </dl>
          <details>
            <summary>{{ t("查看事件详情", "View event details") }}</summary>
            <p class="event-detail">
              {{
                a.detail ||
                t(
                  "此事件没有附加详情。",
                  "No additional details for this event.",
                )
              }}
            </p>
          </details>
        </article>
        <div v-if="!audits.length" class="surface-card empty-state">
          <h2>{{ t("没有符合条件的事件", "No matching events") }}</h2>
          <p>
            {{
              t(
                "尝试调整动作、操作者或UTC时间范围。",
                "Adjust the action, actor or UTC time range.",
              )
            }}
          </p>
        </div>
      </div>
    </template>

    <template v-else-if="loaded && section === 'account'">
      <div v-if="session?.user" class="surface-card account-summary">
        <p class="eyebrow">{{ t("当前身份", "CURRENT IDENTITY") }}</p>
        <h2>{{ session.user.name }}</h2>
        <p class="break-word">{{ session.user.email }}</p>
        <dl class="detail-grid">
          <div>
            <dt>{{ t("账户ID", "Account ID") }}</dt>
            <dd class="font-mono">{{ session.user.id }}</dd>
          </div>
          <div>
            <dt>{{ t("角色", "Role") }}</dt>
            <dd>
              {{
                session.user.role === "admin"
                  ? t("管理员", "Administrator")
                  : t("客户", "Customer")
              }}
            </dd>
          </div>
        </dl>
        <p class="subtle">
          {{
            t(
              "如需修改账户资料，请联系管理员。",
              "Contact support to update your account details.",
            )
          }}
        </p>
      </div>
    </template>

    <p
      v-if="
        loaded &&
        filtersChanged &&
        (section === 'customers' || section === 'audit')
      "
      class="subtle"
      role="status"
    >
      {{
        t(
          "筛选条件尚未应用，当前仍显示上次结果。应用后将从第一页查询。",
          "Filters are not applied yet. Previous results remain visible. Apply filters to start from page one.",
        )
      }}
    </p>
    <nav
      v-if="loaded && (section === 'customers' || section === 'audit')"
      class="cursor-pagination"
      :aria-label="t('游标分页', 'Cursor pagination')"
    >
      <span
        >{{ t("第", "Page") }} {{ cursorStack.length + 1 }} {{ t("页", "") }} ·
        {{ section === "audit" ? audits.length : accounts.length }}
        {{ t("条记录", "records") }}</span
      >
      <div>
        <button
          class="btn btn-secondary"
          :disabled="
            !cursorStack.length || loading || refreshing || filtersChanged
          "
          @click="prevPage"
        >
          ← {{ t("上一页", "Previous") }}</button
        ><button
          class="btn btn-secondary"
          :disabled="
            !hasMore || !nextCursor || loading || refreshing || filtersChanged
          "
          @click="nextPage"
        >
          {{ t("下一页", "Next") }} →
        </button>
      </div>
    </nav>

    <OverlayPanel
      :open="!!panel"
      :busy="busy || unresolved"
      :title="panelTitle"
      :description="
        panel === 'order'
          ? t(
              '查看订单配置、金额与处理进度。',
              'Review configuration, charges and order progress.',
            )
          : panel === 'invoice'
            ? t(
                '先核对，再付款。付款准备不代表已经入账。',
                'Review before paying. Checkout preparation is not payment confirmation.',
              )
            : t(
                '管理账户资料和访问权限，请填写更改原因。',
                'Manage account details and access. Include a reason for changes.',
              )
      "
      kind="drawer"
      @close="closeAll()"
    >
      <div class="operation-panel">
        <UiLoading
          v-if="panelLoading"
          layout="form"
          compact
          :rows="2"
          :label="t('正在读取最新记录…', 'Loading the latest record…')"
        />
        <p
          v-if="panelError"
          class="feedback feedback-error operation-panel-error"
          role="alert"
          tabindex="-1"
        >
          {{ panelError }}
        </p>
        <p v-if="unresolved" class="feedback feedback-warning">
          {{
            t(
              "结果待核对，已阻止重复提交。请使用下方重新读取；不要把请求失败当作没有执行。",
              "Outcome unresolved; duplicate submission is blocked. Re-read below. A failed request does not prove the operation did not execute.",
            )
          }}
        </p>
        <template v-if="panel === 'order' && detail">
          <div class="detail-hero">
            <span class="badge" :class="badge(detail.order.status)">{{
              statusLabel(detail.order.status)
            }}</span
            ><strong class="money-figure">{{
              money(detail.order.total_minor, detail.order.currency_format)
            }}</strong>
            <p class="record-id">{{ detail.order.id }}</p>
          </div>
          <section class="panel-section">
            <h3>{{ t("订单约定", "Order agreement") }}</h3>
            <dl class="detail-grid">
              <div>
                <dt>{{ t("套餐", "Plan") }}</dt>
                <dd>{{ detail.order.plan_name }}</dd>
              </div>
              <div>
                <dt>{{ t("服务器名称", "Hostname") }}</dt>
                <dd>{{ detail.order.hostname }}</dd>
              </div>
              <div>
                <dt>{{ t("创建时间", "Created") }}</dt>
                <dd>{{ utc(detail.order.created_at) }}</dd>
              </div>
              <div v-if="role === 'admin'">
                <dt>{{ t("客户", "Customer") }}</dt>
                <dd>
                  {{ detail.customer?.name || "—" }}<br />{{
                    detail.customer?.email || ""
                  }}<br /><span class="font-mono">{{
                    detail.customer?.id || ""
                  }}</span>
                </dd>
              </div>
            </dl>
            <div v-if="detail.order.plan_snapshot" class="snapshot">
              <strong>{{ detail.order.plan_snapshot.name }}</strong>
              <p>
                {{ detail.order.plan_snapshot.region }} ·
                {{ detail.order.plan_snapshot.cpu }} vCPU ·
                {{ detail.order.plan_snapshot.memory_gb }} GB RAM ·
                {{ detail.order.plan_snapshot.disk_gb }} GB
                {{ t("磁盘", "disk") }} ·
                {{ detail.order.plan_snapshot.transfer_tb }} TB
                {{ t("流量", "transfer") }}
              </p>
              <p class="subtle">
                {{
                  t(
                    "每月计费 · 历史规格",
                    "Monthly billing · historical specification",
                  )
                }}
              </p>
            </div>
            <p v-else class="subtle">
              {{
                t(
                  "此订单未记录购买时的详细配置。",
                  "The original specifications were not recorded for this order.",
                )
              }}
            </p>
          </section>
          <section class="panel-section">
            <h3>{{ t("关联记录", "Linked records") }}</h3>
            <div v-if="detail.invoice" class="snapshot">
              <div class="record-title">
                <span class="font-mono">{{ detail.invoice.number }}</span
                ><span class="badge" :class="badge(detail.invoice.status)">{{
                  statusLabel(detail.invoice.status)
                }}</span>
              </div>
              <p class="money-figure">
                {{
                  money(
                    detail.invoice.amount_minor,
                    detail.invoice.currency_format,
                  )
                }}
              </p>
              <p class="record-id">{{ detail.invoice.id }}</p>
              <button
                class="btn btn-secondary"
                :disabled="busy || unresolved"
                @click="openInvoice(detail.invoice.id)"
              >
                {{ t("查看账单", "View invoice") }} ↗
              </button>
            </div>
            <p v-else class="subtle">
              {{ t("没有可确认的关联账单。", "No confirmed linked invoice.") }}
            </p>
            <p v-if="detail.service" class="break-word">
              {{ t("服务", "Service") }}: {{ detail.service.name }} ·
              {{ statusLabel(detail.service.status) }} · {{ detail.service.id }}
            </p>
            <p v-else class="subtle">
              {{
                t("服务器尚未开通。", "The server has not been provisioned.")
              }}
            </p>
          </section>
          <section class="panel-section">
            <h3>{{ t("支付尝试", "Payment attempts") }}</h3>
            <p v-if="!detail.payment_attempts.length" class="subtle">
              {{ t("暂无付款记录。", "No payment attempts yet.") }}
            </p>
            <article
              v-for="a in detail.payment_attempts"
              :key="a.id"
              class="snapshot"
            >
              <div class="record-title">
                <strong>{{ a.provider_id }}</strong
                ><span class="badge badge-neutral">{{ a.state }}</span>
              </div>
              <p class="record-id">{{ a.id }}</p>
              <p class="subtle">
                {{ a.amount_minor }} {{ t("最小单位", "minor units") }} ·
                {{ a.currency }} · {{ t("精度", "precision") }}
                {{ a.currency_decimal_places }}
              </p>
              <p class="subtle">{{ utc(a.updated_at) }}</p>
            </article>
            <p v-if="detail.payment_attempts_has_more" class="subtle">
              {{
                t(
                  "仍有更多支付尝试，详情最多显示100条。",
                  "More payment attempts exist; details show at most 100.",
                )
              }}
            </p>
          </section>
          <section class="panel-section">
            <h3>{{ t("本单操作记录", "Order activity") }}</h3>
            <article v-for="a in detail.audit" :key="a.id" class="mini-event">
              <strong class="font-mono">{{ a.action }}</strong>
              <p>{{ a.actor_email }} · {{ utc(a.created_at) }}</p>
              <p class="record-id">{{ a.id }}</p>
              <p>{{ a.detail }}</p>
            </article>
            <p v-if="!detail.audit.length" class="subtle">
              {{ t("暂无操作记录。", "No activity yet.") }}
            </p>
            <p v-if="detail.audit_has_more" class="subtle">
              {{
                t(
                  "仍有更多事件，请到操作记录页查询。",
                  "More events exist. Query the activity page for further records.",
                )
              }}
            </p>
          </section>
          <section v-if="cancellable" class="panel-section danger-section">
            <h3>{{ t("安全取消订单", "Safely cancel order") }}</h3>
            <p class="subtle">
              {{
                t(
                  "仅未付款且不存在支付冲突时可取消，关联账单会同时作废。服务器会再次核验；不能撤销此操作。",
                  "Only unpaid orders without payment conflicts may be cancelled. The linked invoice becomes void. The server checks again; this cannot be undone.",
                )
              }}
            </p>
            <label class="form-group"
              ><span class="form-label">{{
                t("取消原因（必填）", "Cancellation reason (required)")
              }}</span
              ><textarea
                v-model="reason"
                class="form-textarea"
                rows="3"
                :disabled="busy || unresolved"
              /></label
            ><button
              class="btn btn-danger"
              :disabled="busy || unresolved || panelLoading"
              @click="cancelOrder"
              :aria-busy="busy"
            >
              <UiSpinner v-if="busy" />{{
                busy
                  ? t("处理中…", "Processing…")
                  : t(
                      "确认取消并作废账单",
                      "Confirm cancellation & void invoice",
                    )
              }}
            </button>
          </section>
        </template>
        <template v-if="panel === 'invoice' && invoice">
          <div class="detail-hero">
            <span class="badge" :class="badge(invoice.status)">{{
              statusLabel(invoice.status)
            }}</span
            ><strong class="money-figure">{{
              money(invoice.amount_minor, invoice.currency_format)
            }}</strong>
            <p class="subtle">{{ t("账单总额", "Invoice total") }}</p>
          </div>
          <section class="panel-section">
            <h3>{{ t("账单信息", "Invoice information") }}</h3>
            <dl class="detail-grid">
              <div>
                <dt>{{ t("账单ID", "Invoice ID") }}</dt>
                <dd class="font-mono">{{ invoice.id }}</dd>
              </div>
              <div>
                <dt>{{ t("关联订单", "Linked order") }}</dt>
                <dd class="font-mono">{{ invoice.order_id }}</dd>
              </div>
              <div>
                <dt>{{ t("开具时间", "Issued") }}</dt>
                <dd>{{ utc(invoice.issued_at) }}</dd>
              </div>
              <div>
                <dt>{{ t("到期时间", "Due") }}</dt>
                <dd>{{ utc(invoice.due_at) }}</dd>
              </div>
              <div v-if="invoice.paid_at">
                <dt>{{ t("入账时间", "Paid") }}</dt>
                <dd>{{ utc(invoice.paid_at) }}</dd>
              </div>
            </dl>
          </section>
          <section class="panel-section">
            <h3>{{ t("账单开具方", "Invoice issuer") }}</h3>
            <template v-if="invoice.issuer"
              ><strong>{{ invoice.issuer.name }}</strong>
              <p class="preserve-lines">{{ invoice.issuer.address }}</p>
              <p class="break-word">
                {{ invoice.issuer.support_email }}
              </p></template
            >
            <p v-else class="subtle">
              {{
                t(
                  "这张账单未记录开具方信息。",
                  "Issuer information was not recorded for this invoice.",
                )
              }}
            </p>
            <p class="subtle">{{ t("", "") }}</p>
          </section>
          <section
            v-if="role === 'customer' && invoice.status === 'unpaid'"
            class="panel-section"
          >
            <h3>{{ t("付款准备", "Prepare payment") }}</h3>
            <p class="subtle">
              {{
                t(
                  "前往付款页面完成支付后，刷新查看账单状态。",
                  "Complete payment at checkout, then refresh this invoice to check its status.",
                )
              }}
            </p>
            <p v-if="mode === 'demo'" class="demo-note">
              {{
                t(
                  "演示模式没有真实付款渠道。准备请求将诚实返回不可用。",
                  "Demo has no live payment channel. Preparation honestly reports it as unavailable.",
                )
              }}
            </p>
            <button
              class="btn btn-primary"
              :disabled="busy || unresolved || panelLoading || !!checkout"
              @click="prepareCheckout"
              :aria-busy="busy"
            >
              <UiSpinner v-if="busy" />{{
                busy
                  ? t("准备中…", "Preparing…")
                  : t("前往付款", "Continue to payment")
              }}
            </button>
            <div v-if="checkout" class="checkout-ready">
              <p>
                {{
                  t(
                    "链接已准备，请核对渠道与有效期。",
                    "Checkout is prepared. Check the provider and expiry.",
                  )
                }}
              </p>
              <p>{{ checkout.provider_id }} · {{ utc(checkout.expires_at) }}</p>
              <a
                :href="checkout.checkout_url"
                class="btn btn-primary"
                target="_blank"
                rel="noopener noreferrer"
                @click="followCheckout"
                @auxclick="followCheckout"
                >{{ t("前往安全付款页面", "Open secure checkout") }} ↗</a
              >
              <p class="subtle">
                {{
                  t(
                    "付款后请返回并刷新账单。",
                    "Return and refresh the invoice after payment.",
                  )
                }}
              </p>
            </div>
            <p v-if="checkoutExpires" class="feedback feedback-warning">
              {{
                t(
                  "付款链接已到期，请先刷新账单再决定下一步。",
                  "Checkout expired. Refresh the invoice before continuing.",
                )
              }}
            </p>
          </section>
          <p v-if="role === 'admin'" class="feedback feedback-info">
            {{
              t(
                "客户完成付款后，账单状态会自动更新。",
                "Invoice status updates after customer payment.",
              )
            }}
          </p>
        </template>
        <form
          v-if="panel === 'account' && !panelLoading && accountReady"
          id="account-operation-form"
          class="account-form"
          @submit.prevent="saveAccount"
        >
          <div v-if="editingId" class="pill-group task-switch">
            <button
              v-for="task in ['edit', 'password', 'revoke'] as const"
              :key="task"
              type="button"
              class="pill-btn"
              :class="{ 'is-active': accountTask === task }"
              :disabled="busy || unresolved"
              @click="
                accountTask = task;
                accountForm.password = '';
                panelError = '';
              "
            >
              {{
                task === "edit"
                  ? t("资料与权限", "Profile & access")
                  : task === "password"
                    ? t("重置密码", "Reset password")
                    : t("撤销会话", "Revoke sessions")
              }}
            </button>
          </div>
          <p v-if="editingId" class="record-id">{{ editingId }}</p>
          <label class="form-group"
            ><span class="form-label">{{
              t("邮箱（创建后不可改）", "Email (immutable after creation)")
            }}</span
            ><input
              v-model="accountForm.email"
              class="form-input"
              type="email"
              :disabled="!!editingId || busy || unresolved"
              autocomplete="off"
          /></label>
          <template v-if="!editingId || accountTask === 'edit'"
            ><label class="form-group"
              ><span class="form-label">{{ t("名称", "Name") }}</span
              ><input
                v-model="accountForm.name"
                class="form-input"
                :disabled="busy || unresolved"
                required /></label
            ><label class="form-group"
              ><span class="form-label">{{ t("角色", "Role") }}</span
              ><UiSelect
                v-model="accountForm.role"
                class="form-select"
                :disabled="busy || unresolved || selfEdit"
                ><option value="customer">{{ t("客户", "Customer") }}</option>
                <option value="admin">
                  {{ t("管理员", "Administrator") }}
                </option></UiSelect
              ></label
            ><label v-if="editingId" class="checkbox-label"
              ><input
                v-model="accountForm.disabled"
                type="checkbox"
                :disabled="busy || unresolved || selfEdit"
              /><span>{{
                t("停用此账户", "Disable this account")
              }}</span></label
            >
            <p v-if="selfEdit" class="subtle">
              {{
                t(
                  "不能停用或降低自己的权限，且须保留至少一位可用管理员。",
                  "You cannot disable or demote yourself. At least one administrator must remain active.",
                )
              }}
            </p></template
          >
          <label
            v-if="!editingId || accountTask === 'password'"
            class="form-group"
            ><span class="form-label">{{
              t("新密码 · 16–72字节", "New password · 16–72 UTF-8 bytes")
            }}</span
            ><input
              v-model="accountForm.password"
              class="form-input"
              type="password"
              autocomplete="new-password"
              :disabled="busy || unresolved"
              required
            /><span class="subtle">{{
              t(
                "设置后，该客户需使用新密码重新登录。",
                "The customer will need to sign in with the new password.",
              )
            }}</span></label
          >
          <p
            v-if="editingId && accountTask !== 'edit'"
            class="feedback feedback-warning"
          >
            {{
              t(
                "此操作将撤销该账户的全部旧会话。对自己的操作可能需要重新登录。",
                "This revokes all existing sessions for the account. Acting on your own account may require signing in again.",
              )
            }}
          </p>
          <label class="form-group"
            ><span class="form-label">{{
              t("操作原因 · 必填", "Reason · required")
            }}</span
            ><textarea
              v-model="accountForm.reason"
              class="form-textarea"
              rows="3"
              :disabled="busy || unresolved"
              required
            />
          </label>
          <p
            v-if="accountForm.role === 'admin' && !editingId"
            class="feedback feedback-warning"
          >
            {{
              t(
                "正在创建拥有全站管理权限的账户，请确认邮箱与身份。",
                "You are creating an account with site-wide administration. Verify the email and identity.",
              )
            }}
          </p>
          <button
            class="btn btn-admin"
            :disabled="busy || unresolved"
            :aria-busy="busy"
          >
            <UiSpinner v-if="busy" />{{
              busy
                ? t("提交中…", "Submitting…")
                : accountTask === "revoke"
                  ? t("确认撤销全部会话", "Confirm revoke all sessions")
                  : accountTask === "password"
                    ? t("确认重置密码", "Confirm password reset")
                    : t("确认保存", "Confirm save")
            }}
          </button>
        </form>
      </div>
      <template #footer
        ><button
          v-if="panel === 'order' && detail"
          class="btn btn-secondary"
          :disabled="busy || panelLoading"
          @click="refreshOrder"
          :aria-busy="busy || panelLoading"
        >
          <UiSpinner v-if="busy || panelLoading" />{{
            t("重读并核对", "Reload & reconcile")
          }}</button
        ><button
          v-if="panel === 'invoice' && invoice"
          class="btn btn-secondary"
          :disabled="busy || panelLoading"
          @click="refreshInvoice"
          :aria-busy="busy || panelLoading"
        >
          <UiSpinner v-if="busy || panelLoading" />{{
            t("重读账单", "Reload invoice")
          }}</button
        ><button
          v-if="panel === 'account' && editingId"
          class="btn btn-secondary"
          :disabled="busy || panelLoading"
          @click="reconcileAccount"
          :aria-busy="busy || panelLoading"
        >
          <UiSpinner v-if="busy || panelLoading" />{{
            t("重读账户", "Reload account")
          }}</button
        ><button
          v-if="panel === 'account' && !editingId && unresolved"
          class="btn btn-secondary"
          :disabled="busy"
          @click="reconcileAccount"
          :aria-busy="busy || panelLoading"
        >
          <UiSpinner v-if="busy || panelLoading" />{{
            t("核对创建结果", "Reconcile creation")
          }}</button
        ><button
          class="btn btn-ghost"
          :disabled="busy || unresolved"
          @click="closeAll()"
        >
          {{ t("关闭", "Close") }}
        </button></template
      >
    </OverlayPanel>
  </section>
</template>

<style scoped>
.finance-summary {
  display: grid;
  gap: 24px;
}
.finance-summary h2 {
  font-size: 20px;
  margin: 8px 0;
}
.finance-totals {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--border-subtle);
}
.finance-totals > div {
  min-width: 0;
}
.finance-totals dt,
.finance-totals small {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.7;
}
.finance-totals dd {
  font-size: clamp(20px, 2.5vw, 30px);
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
  margin: 8px 0;
}
@media (max-width: 500px) {
  .finance-totals {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
  }
  .finance-totals > div + div {
    border-top: 1px solid var(--border-subtle);
    padding-top: 16px;
  }
}
.operations-page {
  display: grid;
  gap: 18px;
  min-width: 0;
}
.operations-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 18px;
}
.operations-heading h1 {
  font-size: clamp(26px, 3vw, 34px);
  font-weight: 650;
  letter-spacing: -0.035em;
  margin: 5px 0 8px;
}
.eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--accent-primary);
}
.subtle {
  color: var(--text-secondary);
  font-size: 12px;
}
.heading-actions,
.filter-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.demo-note {
  color: var(--status-warning);
  font-size: 12px;
  line-height: 1.7;
  border-left: 2px solid var(--accent-admin);
  padding-left: 10px;
}
.feedback {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.feedback-error {
  background: var(--status-danger-bg);
  border-color: var(--status-danger-border);
  color: var(--status-danger);
}
.feedback-info {
  background: var(--status-info-bg);
  color: var(--status-info);
}
.feedback-warning {
  background: var(--status-warning-bg);
  color: var(--status-warning);
}
.list-tools {
  display: flex;
  align-items: flex-end;
  gap: 16px;
}
.list-tools label {
  display: grid;
  gap: 6px;
}
.search-control {
  flex: 1;
}
.list-scope {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.8;
}
.record-list {
  display: grid;
  gap: 12px;
}
.record-row {
  display: flex;
  gap: 20px;
  align-items: center;
  justify-content: space-between;
}
.record-main {
  min-width: 0;
  display: grid;
  gap: 6px;
}
.record-main h2,
.service-card h2,
.audit-card h2 {
  font-size: 15px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.record-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
.record-title .font-mono {
  overflow-wrap: anywhere;
}
.record-main > p {
  color: var(--text-secondary);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.record-id {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.record-side {
  display: grid;
  justify-items: end;
  gap: 10px;
  min-width: 0;
}
.record-side strong {
  font-size: 18px;
  overflow-wrap: anywhere;
  text-align: right;
}
.currency-code {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
}
.empty-state {
  text-align: center;
  padding: 44px 20px;
  color: var(--text-secondary);
}
.empty-state h2 {
  color: var(--text-primary);
  font-size: 17px;
  margin-bottom: 8px;
}
.service-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 350px), 1fr));
  gap: 16px;
}
.service-card {
  display: grid;
  gap: 13px;
  min-width: 0;
}
.service-footer {
  display: grid;
  gap: 4px;
  border-top: 1px solid var(--border-subtle);
  padding-top: 14px;
}
.service-footer strong {
  font-size: 18px;
  overflow-wrap: anywhere;
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 20px;
}
.detail-grid > div {
  display: grid;
  align-content: start;
  gap: 5px;
  min-width: 0;
}
.detail-grid dt {
  color: var(--text-secondary);
  font-size: 11px;
}
.detail-grid dd {
  font-size: 13px;
  overflow-wrap: anywhere;
  min-width: 0;
}
.filter-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 14px;
  align-items: end;
}
.filter-grid label {
  display: grid;
  gap: 7px;
  min-width: 0;
}
.audit-filter-disclosure {
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  background: var(--bg-surface);
  margin-bottom: 18px;
}
.audit-filter-disclosure summary {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 17px 20px;
  min-height: 72px;
  cursor: pointer;
  font-weight: 550;
}
.audit-filter-disclosure summary .muted {
  font-size: 12px;
  font-weight: 400;
}
.audit-filter-disclosure .surface-card {
  border: 0;
  box-shadow: none;
  border-top: 1px solid var(--border-subtle);
  border-radius: 0;
}
.audit-filters {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.filter-actions {
  align-items: flex-end;
}
.audit-card {
  display: grid;
  gap: 17px;
}
.audit-card details {
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}
.audit-card summary {
  cursor: pointer;
  font-size: 13px;
  padding: 7px 0;
  color: var(--accent-primary);
}
.event-detail {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
  margin-top: 12px;
  color: var(--text-secondary);
}
.cursor-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  color: var(--text-secondary);
  font-size: 12px;
}
.cursor-pagination > div {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.account-summary {
  display: grid;
  gap: 18px;
  max-width: 820px;
}
.account-summary h2 {
  font-size: 24px;
}
.operation-panel,
.account-form {
  display: grid;
  gap: 22px;
}
.detail-hero {
  display: grid;
  justify-items: start;
  gap: 12px;
  padding: 0 0 20px;
  border-bottom: 1px solid var(--border-subtle);
}
.detail-hero > strong {
  font-size: 30px;
  line-height: 1.3;
  letter-spacing: -0.04em;
  overflow-wrap: anywhere;
  max-width: 100%;
}
.panel-section {
  display: grid;
  gap: 14px;
}
.panel-section h3 {
  font-size: 14px;
  font-weight: 650;
}
.snapshot {
  padding: 14px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  display: grid;
  gap: 8px;
  overflow-wrap: anywhere;
}
.snapshot > p {
  font-size: 12px;
}
.snapshot > button {
  justify-self: start;
}
.mini-event {
  padding-left: 13px;
  border-left: 1px solid var(--border-strong);
  display: grid;
  gap: 5px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.danger-section {
  border-top: 1px solid var(--status-danger-border);
  padding-top: 18px;
}
.danger-section > button {
  justify-self: start;
}
.break-word {
  overflow-wrap: anywhere;
}
.preserve-lines {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.checkout-ready {
  display: grid;
  gap: 12px;
  padding: 16px;
  background: var(--status-success-bg);
  border-radius: var(--radius-sm);
  font-size: 13px;
}
.checkout-ready > a {
  justify-self: start;
}
.task-switch {
  display: flex;
  flex-wrap: wrap;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  font-size: 13px;
}
.checkbox-label input {
  width: 18px;
  height: 18px;
}
.operations-page .btn,
.operation-panel .btn {
  min-height: 44px;
  white-space: normal;
}
.operations-page .form-input,
.operations-page .form-select,
.operation-panel .form-input,
.operation-panel .form-select {
  min-height: 44px;
}
.operations-page :is(input, select, textarea):focus-visible,
.operation-panel :is(input, select, textarea):focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}
@media (max-width: 680px) {
  .operations-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .heading-actions {
    width: 100%;
  }
  .heading-actions > button {
    flex: 1;
  }
  .record-row {
    align-items: stretch;
    flex-direction: column;
    gap: 14px;
  }
  .record-side {
    justify-items: start;
    border-top: 1px solid var(--border-subtle);
    padding-top: 12px;
  }
  .record-side strong {
    text-align: left;
    font-size: 21px;
  }
  .record-side > button {
    width: 100%;
  }
  .list-tools {
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
  }
  .filter-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .detail-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .cursor-pagination {
    align-items: stretch;
    flex-direction: column;
  }
  .cursor-pagination > div > button {
    flex: 1;
  }
  .form-input,
  .form-select,
  .form-textarea {
    font-size: 16px;
  }
  .task-switch .pill-btn {
    flex: 1;
    min-height: 44px;
  }
  .detail-hero > strong {
    font-size: 27px;
  }
}
</style>

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
  Globe2,
  Cpu,
  HardDrive,
  MemoryStick,
  LockKeyhole,
  Download,
  Menu,
  CircleHelp,
  Sparkles,
  LoaderCircle,
  Puzzle,
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
} from "./lib/api";
import IntegrationsPage from "./components/IntegrationsPage.vue";
import * as fixture from "./lib/preview";
const route = useRoute(),
  router = useRouter();
const session = ref<Session>({ user: null, csrf_token: "", demo_mode: false }),
  booting = ref(true),
  loading = ref(false),
  saving = ref(false),
  preview = ref(false),
  disconnected = ref(false);
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
  invoiceDialog = ref<HTMLDialogElement>(),
  helpDialog = ref<HTMLDialogElement>();
const selectedPlan = ref<Plan>(),
  selectedInvoice = ref<Invoice>(),
  hostname = ref(""),
  agreed = ref(false),
  orderKey = ref("");
const checkoutSession = ref<CheckoutSession>();
const checkoutHost = computed(() =>
  checkoutSession.value
    ? new URL(checkoutSession.value.checkout_url).hostname
    : "",
);
const isAdmin = computed(() => session.value.user?.role === "admin");
const page = computed(() => route.path.split("/")[1] || "overview");
const nav = computed(() =>
  isAdmin.value
    ? [
        { id: "overview", label: "运营总览", icon: LayoutDashboard },
        { id: "customers", label: "客户管理", icon: Users },
        { id: "orders", label: "全部订单", icon: ShoppingBag },
        { id: "invoices", label: "账单管理", icon: ReceiptText },
        { id: "audit", label: "审计日志", icon: Activity },
        { id: "integrations", label: "扩展中心", icon: Puzzle },
      ]
    : [
        { id: "overview", label: "工作台", icon: LayoutDashboard },
        { id: "services", label: "云服务器", icon: Server },
        { id: "plans", label: "选购服务", icon: Layers },
        { id: "orders", label: "我的订单", icon: ShoppingBag },
        { id: "invoices", label: "账单与付款", icon: ReceiptText },
      ],
);
const pageTitle = computed(() =>
  page.value === "account"
    ? "账户与安全"
    : nav.value.find((n) => n.id === page.value)?.label || "页面未找到",
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
const monthly = computed(() => overview.value?.monthly_total_minor || 0);
const maxCost = computed(() =>
  Math.max(...services.value.map((s) => s.price_minor), 1),
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
    ? `${e.message}${e.requestId ? " · 请求编号 " + e.requestId : ""}`
    : "无法连接服务器。请检查网络，或稍后重试。";
}
async function init() {
  booting.value = true;
  loginError.value = "";
  try {
    session.value = await api<Session>("/session");
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
    invoiceDialog.value?.close();
    helpDialog.value?.close();
    selectedInvoice.value = undefined;
    checkoutSession.value = undefined;
    selectedPlan.value = undefined;
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
async function load() {
  integrationRefresh.value++;
  const generation = ++loadGeneration;
  loading.value = true;
  error.value = "";
  try {
    if (preview.value) {
      plans.value = fixture.plans;
      services.value = fixture.services;
      orders.value = fixture.orders;
      invoices.value = fixture.invoices;
      audit.value = fixture.audit;
      customers.value = [fixture.previewUser];
      overview.value = {
        active_services: 3,
        pending_invoices: 1,
        monthly_total_minor: 4200,
        currency: "USD",
        recent_orders: fixture.orders,
      };
      adminOverview.value = {
        customers: 1,
        total_services: 3,
        unpaid_invoices: 1,
        revenue_minor: 1200,
        currency: "USD",
      };
      return;
    }
    if (isAdmin.value) {
      const [a, b, c, d, e] = await Promise.all([
        api<AdminOverview>("/admin/overview"),
        api<User[]>("/admin/customers"),
        api<Order[]>("/admin/orders"),
        api<Invoice[]>("/admin/invoices"),
        api<Audit[]>("/audit"),
      ]);
      if (generation !== loadGeneration) return;
      adminOverview.value = a;
      customers.value = b;
      orders.value = c;
      invoices.value = d;
      audit.value = e;
    } else {
      const [a, b, c, d, e, f] = await Promise.all([
        api<Overview>("/overview"),
        api<Service[]>("/services"),
        api<Plan[]>("/plans"),
        api<Order[]>("/orders"),
        api<Invoice[]>("/invoices"),
        api<Audit[]>("/audit"),
      ]);
      if (generation !== loadGeneration) return;
      overview.value = a;
      services.value = b;
      plans.value = c;
      orders.value = d;
      invoices.value = e;
      audit.value = f;
    }
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
async function openOrder(plan: Plan) {
  selectedPlan.value = plan;
  hostname.value = "";
  agreed.value = false;
  modalError.value = "";
  orderKey.value = crypto.randomUUID();
  await nextTick();
  orderDialog.value?.showModal();
}
async function createOrder() {
  if (preview.value || !selectedPlan.value || !agreed.value || saving.value)
    return;
  saving.value = true;
  modalError.value = "";
  try {
    const order = await api<Order>(
      "/orders",
      "POST",
      { plan_id: selectedPlan.value.id, hostname: hostname.value },
      { "Idempotency-Key": orderKey.value },
    );
    orderDialog.value?.close();
    notice.value = `订单 ${order.number} 已创建。尚未付款，未开通真实服务器。`;
    go("orders");
    await load();
  } catch (e) {
    modalError.value = explain(e);
  } finally {
    saving.value = false;
  }
}
async function openInvoice(invoice: Invoice) {
  checkoutSession.value = undefined;
  selectedInvoice.value = invoice;
  modalError.value = "";
  await nextTick();
  invoiceDialog.value?.showModal();
  if (!preview.value) {
    try {
      selectedInvoice.value = await api<Invoice>(
        "/invoices/" + encodeURIComponent(invoice.id),
      );
    } catch (e) {
      modalError.value = explain(e);
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
  try {
    const result = await api<unknown>(
      "/invoices/" + encodeURIComponent(invoiceId) + "/checkout",
      "POST",
      {},
    );
    const verified = readCheckoutSession(result);
    if (selectedInvoice.value?.id === invoiceId)
      checkoutSession.value = verified;
  } catch (e) {
    modalError.value =
      e instanceof ApiError && e.code === "PAYMENT_NOT_CONFIGURED"
        ? "支付通道尚未接入。未发生扣款，账单仍为待付款。"
        : explain(e);
  } finally {
    saving.value = false;
  }
}
function followCheckout(event: MouseEvent) {
  try {
    readCheckoutSession(checkoutSession.value);
  } catch {
    event.preventDefault();
    checkoutSession.value = undefined;
    modalError.value = "结账入口已失效，请重新检查支付可用性。账单状态未改变。";
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
    ["账单编号", "状态", "币种", "金额（最小单位）", "出账日期", "到期日期"],
    ...filteredInvoices.value.map((i) => [
      i.number,
      statusLabel(i.status),
      i.currency,
      i.amount_minor,
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
  a.download = (preview.value ? "preview-" : "") + "aster-invoices.csv";
  a.click();
  URL.revokeObjectURL(url);
}
watch(
  pageTitle,
  (title) => {
    document.title = title + " · 星屿云";
  },
  { immediate: true },
);
watch(page, () => {
  query.value = "";
});
onMounted(init);
</script>

<template>
  <a class="skip-link" href="#main">跳到主要内容</a>
  <div v-if="booting" class="boot-screen" role="status">
    <div class="brand-mark">✦</div>
    <LoaderCircle class="spin" :size="22" /><span>正在安全连接工作台…</span>
  </div>
  <div v-else-if="!session.user" class="login-shell">
    <div class="login-brand">
      <div class="brand-mark">✦</div>
      <strong>aster<span>cloud</span></strong>
    </div>
    <div class="login-layout">
      <section class="login-story">
        <p class="eyebrow">YOUR CLOUD. CLEARLY.</p>
        <h1>专注创造。<br /><span>其余，清晰可见。</span></h1>
        <p class="login-description">
          从每一台云服务器，到每一笔账单。<br />一个安静、有序的空间，管理你的云端业务。
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
          <div class="art-caption">LESS FRICTION. MORE POSSIBILITY.</div>
        </div>
        <span class="login-footnote">星屿云 · 云服务财务工作台</span>
      </section>
      <section class="login-panel">
        <div class="login-card">
          <span class="small-brand">ASTER CONSOLE</span>
          <h2>欢迎回来</h2>
          <p class="muted">登录，继续你的云端旅程。</p>
          <div v-if="loginError" class="alert error" role="alert">
            <AlertCircle :size="18" /><span>{{ loginError }}</span>
          </div>
          <form @submit.prevent="login()">
            <label for="email">邮箱地址</label
            ><input
              id="email"
              v-model="email"
              type="email"
              placeholder="you@company.com"
              autocomplete="username"
              required
              :disabled="saving"
            /><label for="password">密码</label
            ><input
              id="password"
              v-model="password"
              type="password"
              placeholder="输入你的密码"
              autocomplete="current-password"
              required
              :disabled="saving"
            /><button
              class="button primary login-submit"
              :disabled="saving || disconnected"
            >
              <LoaderCircle v-if="saving" class="spin" :size="16" />{{
                saving ? "正在登录…" : "登录工作台"
              }}<ArrowRight v-if="!saving" :size="17" />
            </button>
          </form>
          <p class="secure-caption">
            <LockKeyhole :size="13" /> 安全会话 · 不存储支付卡资料
          </p>
          <div v-if="session.demo_mode" class="demo-login">
            <p>本地演示环境 · 不涉及真实支付</p>
            <div>
              <button @click="login('customer')" :disabled="saving">
                体验客户工作台 <ArrowUpRight :size="14" /></button
              ><button @click="login('admin')" :disabled="saving">
                体验管理后台 <ArrowUpRight :size="14" />
              </button>
            </div>
          </div>
          <button v-if="disconnected" class="text-button" @click="init">
            <RefreshCw :size="14" /> 重新连接服务器
          </button>
          <div v-if="disconnected || session.demo_mode" class="preview-links">
            <button @click="startPreview()">只读设计预览</button><span>·</span
            ><button @click="startPreview(true)">管理端预览</button>
          </div>
        </div>
        <p class="login-support">
          账户由管理员开通。需要帮助？请联系你的服务提供方。
        </p>
      </section>
    </div>
  </div>
  <div v-else class="app-shell" :class="{ 'sidebar-open': menuOpen }">
    <button
      v-if="menuOpen"
      class="sidebar-scrim"
      aria-label="关闭导航"
      @click="menuOpen = false"
    />
    <aside class="sidebar" aria-label="主导航">
      <a class="brand" href="/overview" @click.prevent="go('overview')"
        ><div class="brand-mark">✦</div>
        <strong>aster<span>cloud</span></strong></a
      ><button class="workspace-switch" @click="helpDialog?.showModal()">
        <span class="workspace-icon">{{ isAdmin ? "A" : "P" }}</span
        ><span
          ><b>{{ isAdmin ? "管理控制台" : "个人工作空间" }}</b
          ><small>{{
            isAdmin ? "ADMINISTRATOR" : "PERSONAL WORKSPACE"
          }}</small></span
        ><ChevronDown :size="14" />
      </button>
      <div class="nav-label">{{ isAdmin ? "运营管理" : "工作空间" }}</div>
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
              ? "只读预览模式"
              : session.demo_mode
                ? "本地演示环境"
                : "安全连接已建立"
          }}</span>
        </div>
        <button
          class="side-action"
          :class="{ active: page === 'account' }"
          @click="go('account')"
        >
          <ShieldCheck :size="18" />账户与安全</button
        ><button class="side-action" @click="helpDialog?.showModal()">
          <CircleHelp :size="18" />帮助与说明<ArrowUpRight :size="14" />
        </button>
        <div class="user-menu">
          <span class="avatar">{{
            session.user.name?.slice(0, 1).toUpperCase() || "A"
          }}</span>
          <div>
            <b>{{ session.user.name }}</b
            ><small>{{ isAdmin ? "管理员" : "个人账户" }}</small>
          </div>
          <button
            aria-label="退出登录"
            title="退出登录"
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
            aria-label="打开导航"
            @click="menuOpen = true"
          >
            <Menu :size="21" /></button
          ><span>{{ isAdmin ? "管理控制台" : "控制台" }}</span
          ><ChevronRight :size="13" /><b>{{ pageTitle }}</b>
        </div>
        <div class="topbar-right">
          <span class="environment-chip">{{
            preview ? "只读预览" : session.demo_mode ? "DEMO" : "LIVE"
          }}</span
          ><button
            class="icon-button"
            aria-label="刷新数据"
            title="刷新数据"
            :disabled="loading"
            @click="load"
          >
            <RefreshCw :size="17" :class="{ spin: loading }" /></button
          ><span class="topbar-divider" /><button
            class="avatar small"
            aria-label="打开账户与安全"
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
              ? "只读设计预览 · 以下均为样例数据，所有交易操作已禁用。"
              : "本地演示环境 · 数据仅用于测试，不会扣款或开通真实服务器。"
          }}</span
        ><button v-if="preview" @click="logout">
          返回登录 <ArrowRight :size="13" />
        </button>
      </div>
      <main id="main" tabindex="-1">
        <div v-if="error" class="alert error" role="alert">
          <AlertCircle :size="18" /><span>{{ error }}</span
          ><button @click="load">重试</button>
        </div>
        <div v-if="notice" class="alert success" role="status">
          <CheckCircle2 :size="18" /><span>{{ notice }}</span
          ><button aria-label="关闭提示" @click="notice = ''">
            <X :size="16" />
          </button>
        </div>
        <div class="page-heading">
          <div>
            <p class="eyebrow">
              {{
                page === "overview"
                  ? "A LITTLE CLARITY. A LOT OF POSSIBILITY."
                  : isAdmin
                    ? "ASTER / ADMINISTRATION"
                    : "ASTER / WORKSPACE"
              }}
            </p>
            <h1>
              {{
                page === "overview"
                  ? isAdmin
                    ? "掌握全局，从容运营。"
                    : "你好，" + session.user.name + "。"
                  : pageTitle
              }}
            </h1>
            <p>
              {{
                page === "overview"
                  ? isAdmin
                    ? "把重要的经营数据，放在一起。"
                    : "你的云端业务，井然有序。"
                  : page === "services"
                    ? "每一份算力，都有清晰的归属。"
                    : page === "plans"
                      ? "恰到好处的性能，为下一步准备。"
                      : page === "invoices"
                        ? "每一笔费用，清楚透明。"
                        : page === "orders"
                          ? "从下单到交付，全程有迹可循。"
                          : page === "customers"
                            ? "客户与账户，一目了然。"
                            : page === "audit"
                              ? "记录重要操作，让变化有据可查。"
                              : page === "integrations"
                                ? "连接外部能力，不牵动核心业务。"
                                : "你的身份、会话与安全信息。"
              }}
            </p>
          </div>
          <button
            v-if="['overview', 'services'].includes(page) && !isAdmin"
            class="button primary"
            @click="go('plans')"
          >
            <Plus :size="17" />创建云服务器</button
          ><button
            v-if="page === 'invoices'"
            class="button secondary"
            @click="downloadInvoices"
            :disabled="!filteredInvoices.length"
          >
            <Download :size="16" />导出账单
          </button>
        </div>
        <div
          v-if="loading && !overview && !adminOverview"
          class="skeleton-grid"
          aria-label="正在载入数据"
          role="status"
        >
          <div v-for="n in 3" :key="n" class="skeleton" />
        </div>
        <template v-else-if="page === 'overview'">
          <section class="stats-grid" aria-label="账户概况">
            <article class="stat-card">
              <div class="stat-label">
                {{ isAdmin ? "客户总数" : "运行中的服务"
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
                }}<span>{{ isAdmin ? "位" : "台" }}</span>
              </div>
              <div class="stat-foot">
                <span class="status-dot" />{{
                  isAdmin ? "已注册客户账户" : "已激活的云服务器"
                }}
              </div>
            </article>
            <article class="stat-card">
              <div class="stat-label">
                {{ isAdmin ? "已收款金额" : "每月服务费用"
                }}<ReceiptText :size="18" />
              </div>
              <div class="stat-value amount">
                {{
                  isAdmin
                    ? money(
                        adminOverview?.revenue_minor || 0,
                        adminOverview?.currency,
                      )
                    : money(monthly, overview?.currency)
                }}<span>{{ isAdmin ? "USD" : "/ 月" }}</span>
              </div>
              <div class="stat-foot">
                {{
                  isAdmin ? "已付款账单合计 · 非利润" : "当前服务月费合计 · USD"
                }}
              </div>
            </article>
            <article class="stat-card">
              <div class="stat-label">待付款账单<Clock3 :size="18" /></div>
              <div class="stat-value">
                {{
                  isAdmin
                    ? (adminOverview?.unpaid_invoices ?? "—")
                    : (overview?.pending_invoices ?? "—")
                }}<span>笔</span>
              </div>
              <button class="stat-foot link" @click="go('invoices')">
                {{ unpaid.length ? "查看待付账单" : "查看全部账单"
                }}<ArrowRight :size="14" />
              </button>
            </article>
          </section>
          <section v-if="unpaid.length" class="payment-reminder">
            <div class="reminder-icon"><ReceiptText :size="21" /></div>
            <div>
              <b>{{
                isAdmin
                  ? "有 " + unpaid.length + " 笔账单等待客户付款"
                  : "有 " + unpaid.length + " 笔账单，等待你的安排。"
              }}</b>
              <p>
                {{ unpaid[0]?.number }}<span>·</span
                >{{ money(unpaid[0]?.amount_minor || 0, unpaid[0]?.currency)
                }}<span>·</span>{{ date(unpaid[0]?.due_at || "") }} 到期
              </p>
            </div>
            <button @click="openInvoice(unpaid[0]!)">
              查看账单<ArrowRight :size="15" />
            </button>
          </section>
          <div class="overview-grid">
            <section class="panel services-panel">
              <div class="panel-heading">
                <div>
                  <h2>{{ isAdmin ? "最近订单" : "我的云服务器" }}</h2>
                  <p>
                    {{
                      isAdmin
                        ? "最近创建的客户订单"
                        : "为你的每一个想法，持续提供动力。"
                    }}
                  </p>
                </div>
                <button
                  class="text-button"
                  @click="go(isAdmin ? 'orders' : 'services')"
                >
                  查看全部<ArrowRight :size="14" />
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
                      >{{ money(service.price_minor, service.currency) }} /
                      月</small
                    >
                  </div>
                </div>
                <div v-if="!services.length" class="empty-state">
                  <Server :size="30" />
                  <h3>你的下一步，从这里开始。</h3>
                  <p>还没有云服务器，先选择适合你的配置。</p>
                  <button class="button secondary" @click="go('plans')">
                    探索云服务器<ArrowRight :size="15" />
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
                    <b>{{ money(order.total_minor, order.currency) }}</b
                    ><span class="badge" :class="statusTone(order.status)">{{
                      statusLabel(order.status)
                    }}</span>
                  </div>
                </div>
                <div v-if="!orders.length" class="empty-state">
                  <ShoppingBag :size="30" />
                  <h3>暂无订单</h3>
                  <p>客户下单后，订单会出现在这里。</p>
                </div></template
              >
              <div class="panel-footer">
                <ShieldCheck :size="15" />{{
                  isAdmin
                    ? "价格由服务器校验，关键操作留有审计记录。"
                    : "服务状态来自账务系统，不代表实时节点健康监控。"
                }}
              </div>
            </section>
            <section class="panel cost-panel">
              <div class="panel-heading">
                <div>
                  <h2>{{ isAdmin ? "运营摘要" : "费用构成" }}</h2>
                  <p>
                    {{
                      isAdmin
                        ? "当前业务规模与账单状态"
                        : "当前服务的月度费用分布"
                    }}
                  </p>
                </div>
                <span class="tiny-tag">USD</span>
              </div>
              <div v-if="isAdmin" class="admin-summary">
                <div>
                  <span>服务总数</span
                  ><b
                    >{{ adminOverview?.total_services ?? "—" }}
                    <small>台</small></b
                  >
                </div>
                <div>
                  <span>账单总数</span
                  ><b>{{ invoices.length }} <small>笔</small></b>
                </div>
                <div>
                  <span>待收金额</span
                  ><b>{{
                    money(unpaid.reduce((a, i) => a + i.amount_minor, 0))
                  }}</b>
                </div>
                <p>
                  <LockKeyhole :size="14" />支付通道尚未接入，无法收取真实款项。
                </p>
              </div>
              <template v-else
                ><div class="cost-total">
                  {{ money(monthly, overview?.currency) }}<span>/ 月</span>
                </div>
                <div
                  v-for="(service, index) in services.slice(0, 4)"
                  :key="service.id"
                  class="cost-line"
                >
                  <div>
                    <span>{{ service.name }}</span
                    ><b>{{ money(service.price_minor, service.currency) }}</b>
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
                <div v-if="!services.length" class="cost-empty">
                  启用服务后，即可查看费用分布。
                </div>
                <p class="cost-note">
                  按当前套餐月费汇总，不含待开通订单。
                </p></template
              >
            </section>
          </div>
          <section class="panel latest-panel">
            <div class="panel-heading">
              <div>
                <h2>{{ isAdmin ? "最近操作" : "最近订单" }}</h2>
                <p>
                  {{
                    isAdmin
                      ? "关键操作的审计记录"
                      : "每一次开始，都有清晰记录。"
                  }}
                </p>
              </div>
              <button
                class="text-button"
                @click="go(isAdmin ? 'audit' : 'orders')"
              >
                查看全部<ArrowRight :size="14" />
              </button>
            </div>
            <div class="table-wrap">
              <table v-if="!isAdmin">
                <thead>
                  <tr>
                    <th>订单编号</th>
                    <th>服务方案</th>
                    <th>创建日期</th>
                    <th>金额</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="order in orders.slice(0, 4)" :key="order.id">
                    <td class="mono">{{ order.number }}</td>
                    <td>{{ order.plan_name }}</td>
                    <td class="muted">{{ date(order.created_at) }}</td>
                    <td class="numeric">
                      {{ money(order.total_minor, order.currency) }}
                    </td>
                    <td>
                      <span class="badge" :class="statusTone(order.status)">{{
                        statusLabel(order.status)
                      }}</span>
                    </td>
                  </tr>
                  <tr v-if="!orders.length">
                    <td colspan="5" class="table-empty">暂无订单记录</td>
                  </tr>
                </tbody>
              </table>
              <table v-else>
                <thead>
                  <tr>
                    <th>操作</th>
                    <th>操作者</th>
                    <th>目标</th>
                    <th>日期（UTC）</th>
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
                    <td colspan="4" class="table-empty">暂无操作记录</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </template>
        <template v-else-if="page === 'plans'"
          ><div class="plans-intro">
            <span><Globe2 :size="17" />独立云服务器</span
            ><span
              >按月计费 <i>·</i> USD
              {{ session.demo_mode ? "演示定价" : "计价" }}</span
            >
          </div>
          <div class="plans-grid">
            <article
              v-for="(plan, index) in plans"
              :key="plan.id"
              class="plan-card"
              :class="{ featured: index === 1 }"
            >
              <div class="plan-top">
                <div class="plan-symbol">
                  <Layers :size="24" :stroke-width="1.4" />
                </div>
                <span v-if="index === 1" class="recommended">均衡之选</span>
              </div>
              <h2>{{ plan.name }}</h2>
              <p>{{ plan.description }}</p>
              <div class="plan-price">
                {{ money(plan.price_minor, plan.currency) }}<span>/ 月</span>
              </div>
              <button
                class="button"
                :class="index === 1 ? 'primary' : 'secondary'"
                :disabled="!plan.available"
                @click="openOrder(plan)"
              >
                {{ plan.available ? "选择此方案" : "暂不可用"
                }}<ArrowRight :size="16" />
              </button>
              <div class="plan-spec">
                <div>
                  <Cpu :size="17" /><span>计算核心</span
                  ><b>{{ plan.cpu }} vCPU</b>
                </div>
                <div>
                  <MemoryStick :size="17" /><span>内存</span
                  ><b>{{ plan.memory_gb }} GB</b>
                </div>
                <div>
                  <HardDrive :size="17" /><span>SSD 存储</span
                  ><b>{{ plan.disk_gb }} GB</b>
                </div>
                <div>
                  <Activity :size="17" /><span>月流量</span
                  ><b>{{ plan.transfer_tb }} TB</b>
                </div>
                <div>
                  <Globe2 :size="17" /><span>区域</span><b>{{ plan.region }}</b>
                </div>
              </div>
            </article>
          </div>
          <div v-if="!plans.length" class="panel empty-state">
            <Layers :size="30" />
            <h3>暂无可用方案</h3>
            <p>服务提供方还未发布套餐。</p>
          </div>
          <div class="quiet-note">
            <ShieldCheck :size="18" />
            <div>
              <b>在确认之前，一切都清清楚楚。</b>
              <p>
                下单只创建待付款订单。支付通道及自动开通尚未接入，不会扣款，也不会创建真实服务器。
              </p>
            </div>
          </div></template
        >
        <template v-else-if="page === 'services'"
          ><div class="list-toolbar">
            <span>{{ services.length }} 台云服务器</span
            ><label class="search-field"
              ><Search :size="16" /><input
                v-model="query"
                placeholder="搜索服务、区域或 IP"
                aria-label="搜索服务"
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
                  ><b>{{ service.memory_gb }}</b> GB 内存</span
                ><span
                  ><b>{{ service.disk_gb }}</b> GB SSD</span
                >
              </div>
              <dl>
                <div>
                  <dt>公网地址</dt>
                  <dd class="mono">{{ service.ipv4 || "待分配" }}</dd>
                </div>
                <div>
                  <dt>服务方案</dt>
                  <dd>{{ service.plan_name }}</dd>
                </div>
                <div>
                  <dt>下次到期</dt>
                  <dd>{{ date(service.next_due_at) }}</dd>
                </div>
              </dl>
              <div class="service-card-footer">
                <b
                  >{{ money(service.price_minor, service.currency)
                  }}<small> / 月</small></b
                ><span>账务记录</span>
              </div>
            </article>
          </div>
          <div v-if="!filteredServices.length" class="panel empty-state">
            <Server :size="30" />
            <h3>{{ query ? "没有匹配的服务" : "还没有云服务器" }}</h3>
            <p>
              {{
                query
                  ? "试试其他名称、区域或 IP。"
                  : "选择一个方案，开始你的云端业务。"
              }}
            </p>
            <button v-if="!query" class="button primary" @click="go('plans')">
              选择方案<ArrowRight :size="16" />
            </button>
          </div>
          <p class="page-note">
            当前仅展示账务服务记录。电源管理、系统重装与实时监控将在控制器集成后提供。
          </p></template
        >
        <template
          v-else-if="
            ['orders', 'invoices', 'customers', 'audit'].includes(page)
          "
          ><section v-if="page === 'invoices'" class="invoice-summary">
            <div>
              <span>待付款金额</span
              ><b
                >{{ money(unpaid.reduce((a, i) => a + i.amount_minor, 0))
                }}<small>USD</small></b
              >
            </div>
            <div>
              <span>待付款账单</span><b>{{ unpaid.length }}<small>笔</small></b>
            </div>
            <p>
              <LockKeyhole :size="17" />支付通道尚未接入<br /><span
                >不会收集银行卡资料或发起真实扣款。</span
              >
            </p>
          </section>
          <section class="panel data-panel">
            <div class="list-toolbar">
              <span
                >{{
                  page === "orders"
                    ? "全部订单"
                    : page === "invoices"
                      ? "全部账单"
                      : page === "customers"
                        ? "客户账户"
                        : "操作记录"
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
                      ? '搜索姓名或邮箱'
                      : '搜索编号、状态或关键词'
                  "
                  aria-label="搜索记录"
              /></label>
            </div>
            <div class="table-wrap">
              <table v-if="page === 'orders'">
                <thead>
                  <tr>
                    <th>订单编号</th>
                    <th>服务方案</th>
                    <th>创建日期（UTC）</th>
                    <th>订单金额</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="order in filteredOrders" :key="order.id">
                    <td class="mono strong">{{ order.number }}</td>
                    <td>{{ order.plan_name }}</td>
                    <td class="muted">{{ date(order.created_at) }}</td>
                    <td class="numeric">
                      {{ money(order.total_minor, order.currency) }}
                    </td>
                    <td>
                      <span class="badge" :class="statusTone(order.status)">{{
                        statusLabel(order.status)
                      }}</span>
                    </td>
                  </tr>
                  <tr v-if="!filteredOrders.length">
                    <td colspan="5" class="table-empty">
                      {{
                        query
                          ? "没有匹配的订单"
                          : "暂无订单，选购服务后将在这里显示。"
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <table v-else-if="page === 'invoices'">
                <thead>
                  <tr>
                    <th>账单编号</th>
                    <th>出账日期</th>
                    <th>到期日期</th>
                    <th>金额</th>
                    <th>状态</th>
                    <th><span class="sr-only">操作</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="invoice in filteredInvoices" :key="invoice.id">
                    <td class="mono strong">{{ invoice.number }}</td>
                    <td class="muted">{{ date(invoice.issued_at) }}</td>
                    <td class="muted">{{ date(invoice.due_at) }}</td>
                    <td class="numeric">
                      {{ money(invoice.amount_minor, invoice.currency) }}
                    </td>
                    <td>
                      <span class="badge" :class="statusTone(invoice.status)">{{
                        statusLabel(invoice.status)
                      }}</span>
                    </td>
                    <td>
                      <button
                        class="table-action"
                        :aria-label="'查看账单 ' + invoice.number"
                        @click="openInvoice(invoice)"
                      >
                        查看<ChevronRight :size="15" />
                      </button>
                    </td>
                  </tr>
                  <tr v-if="!filteredInvoices.length">
                    <td colspan="6" class="table-empty">
                      {{ query ? "没有匹配的账单" : "暂无账单记录。" }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <table v-else-if="page === 'customers'">
                <thead>
                  <tr>
                    <th>客户</th>
                    <th>邮箱</th>
                    <th>角色</th>
                    <th>账户标识</th>
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
                        customer.role === "admin" ? "管理员" : "客户"
                      }}</span>
                    </td>
                    <td class="mono muted">{{ customer.id }}</td>
                  </tr>
                  <tr v-if="!filteredCustomers.length">
                    <td colspan="4" class="table-empty">
                      {{ query ? "没有匹配的客户" : "暂无客户账户。" }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <table v-else>
                <thead>
                  <tr>
                    <th>操作类型</th>
                    <th>操作者</th>
                    <th>目标</th>
                    <th>详情</th>
                    <th>日期（UTC）</th>
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
                      {{ query ? "没有匹配的操作" : "暂无审计记录。" }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="table-footer">
              {{ query ? "已按关键词筛选" : "显示当前可访问的记录"
              }}<span>{{
                page === "audit"
                  ? "关键操作由服务端记录"
                  : "所有金额以 USD 计价"
              }}</span>
            </div>
          </section>
          <p v-if="page === 'orders'" class="page-note">
            下单不会自动扣款。订单付款与服务开通是独立的处理阶段。
          </p></template
        >
        <IntegrationsPage
          v-else-if="page === 'integrations' && isAdmin"
          :preview="preview"
          :refresh-token="integrationRefresh"
        />
        <template v-else-if="page === 'account'"
          ><div class="account-grid">
            <section class="panel account-panel">
              <div class="panel-heading">
                <h2>个人资料</h2>
                <span class="tiny-tag">只读</span>
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
                  <dt>账户角色</dt>
                  <dd>{{ isAdmin ? "管理员" : "客户" }}</dd>
                </div>
                <div>
                  <dt>账户 ID</dt>
                  <dd class="mono">{{ session.user.id }}</dd>
                </div>
                <div>
                  <dt>计价币种</dt>
                  <dd>USD · 美元</dd>
                </div>
              </dl>
              <p class="page-note">如需变更账户资料，请联系服务提供方。</p>
            </section>
            <section class="panel account-panel">
              <div class="panel-heading">
                <h2>安全与会话</h2>
                <ShieldCheck :size="20" />
              </div>
              <div class="security-item">
                <LockKeyhole :size="20" />
                <div>
                  <b>{{
                    preview ? "只读预览，无真实会话" : "服务端安全会话"
                  }}</b>
                  <p>
                    {{
                      preview
                        ? "退出预览后可使用真实 API 登录。"
                        : "会话使用 HttpOnly Cookie；提交操作受 CSRF 保护。"
                    }}
                  </p>
                </div>
                <CheckCircle2 :size="18" />
              </div>
              <div class="security-item">
                <ShieldCheck :size="20" />
                <div>
                  <b>支付资料保护</b>
                  <p>本系统不采集或存储完整银行卡信息。</p>
                </div>
                <CheckCircle2 :size="18" />
              </div>
              <div class="security-item">
                <AlertCircle :size="20" />
                <div>
                  <b>密码与双重验证</b>
                  <p>
                    自助密码修改和双重验证尚未开放，请联系管理员处理账户访问问题。
                  </p>
                </div>
              </div>
              <button
                class="button secondary"
                @click="logout"
                :disabled="saving"
              >
                <LogOut :size="16" />{{
                  preview ? "退出只读预览" : "退出当前会话"
                }}
              </button>
            </section>
          </div></template
        >
        <section v-else class="panel empty-state">
          <h2>这个页面还不存在。</h2>
          <p>返回工作台，继续管理你的云服务。</p>
          <button class="button primary" @click="go('overview')">
            <ArrowLeft :size="16" />返回工作台
          </button>
        </section>
        <footer class="main-footer">
          <span>✦ Aster Cloud <i>·</i> 简单，始终如一。</span
          ><span
            >{{
              preview
                ? "READ-ONLY PREVIEW"
                : session.demo_mode
                  ? "DEVELOPMENT PREVIEW"
                  : "BILLING CONSOLE"
            }}<i>·</i>日期使用 UTC</span
          >
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
          <p class="eyebrow">A NEW BEGINNING</p>
          <h2 id="order-title">确认你的云服务器</h2>
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label="关闭"
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
            {{ selectedPlan.disk_gb }} GB SSD
          </p>
        </div>
        <strong
          >{{ money(selectedPlan.price_minor, selectedPlan.currency)
          }}<small>/ 月</small></strong
        >
      </div>
      <label for="hostname">服务器名称</label
      ><input
        id="hostname"
        v-model="hostname"
        pattern="[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]|[a-zA-Z0-9]"
        maxlength="63"
        required
        placeholder="例如 production-api"
        autocomplete="off"
        :disabled="saving"
      />
      <p class="field-help">
        1–63 个英文字母、数字或连字符，不以连字符开头或结尾。
      </p>
      <dl class="order-summary">
        <div>
          <dt>区域</dt>
          <dd>{{ selectedPlan?.region }}</dd>
        </div>
        <div>
          <dt>计费周期</dt>
          <dd>每月 · USD</dd>
        </div>
        <div>
          <dt>首期订单金额</dt>
          <dd>
            {{ money(selectedPlan?.price_minor || 0, selectedPlan?.currency) }}
          </dd>
        </div>
      </dl>
      <div class="alert info">
        <AlertCircle :size="18" /><span>{{
          preview
            ? "只读预览，不能创建订单。"
            : "创建订单不代表付款。支付和自动开通尚未接入，不会扣款或交付真实服务器。"
        }}</span>
      </div>
      <label class="checkbox-label"
        ><input
          v-model="agreed"
          type="checkbox"
          required
          :disabled="preview || saving"
        /><span>我确认方案与金额，了解此操作仅创建待付款订单。</span></label
      >
      <div v-if="modalError" class="alert error" role="alert">
        <AlertCircle :size="18" /><span>{{ modalError }}</span>
      </div>
      <button
        class="button primary full"
        :disabled="preview || saving || !agreed"
      >
        <LoaderCircle v-if="saving" :size="17" class="spin" />{{
          saving
            ? "正在创建…"
            : preview
              ? "预览模式不可下单"
              : "创建待付款订单"
        }}<ArrowRight v-if="!saving" :size="17" />
      </button>
    </form>
  </dialog>
  <dialog
    ref="invoiceDialog"
    class="modal invoice-modal"
    aria-labelledby="invoice-title"
  >
    <div class="modal-heading">
      <div>
        <p class="eyebrow">BILLING DETAILS</p>
        <h2 id="invoice-title">账单详情</h2>
      </div>
      <button
        class="icon-button"
        aria-label="关闭"
        :disabled="saving"
        @click="invoiceDialog?.close()"
      >
        <X :size="21" />
      </button>
    </div>
    <template v-if="selectedInvoice"
      ><div class="invoice-document">
        <div class="invoice-doc-top">
          <div class="brand-mark">✦</div>
          <span class="badge" :class="statusTone(selectedInvoice.status)">{{
            statusLabel(selectedInvoice.status)
          }}</span>
        </div>
        <h3>{{ selectedInvoice.number }}</h3>
        <div class="invoice-dates">
          <div>
            <span>出账日期</span><b>{{ date(selectedInvoice.issued_at) }}</b>
          </div>
          <div>
            <span>到期日期</span><b>{{ date(selectedInvoice.due_at) }}</b>
          </div>
          <div>
            <span>币种</span><b>{{ selectedInvoice.currency }}</b>
          </div>
        </div>
        <div class="invoice-line-header">
          <span>服务项目</span><span>金额</span>
        </div>
        <template v-if="selectedInvoice.line_items?.length"
          ><div
            v-for="(item, index) in selectedInvoice.line_items"
            :key="index"
            class="invoice-line"
          >
            <span>{{ item.description }}</span
            ><b>{{ money(item.amount_minor, selectedInvoice.currency) }}</b>
          </div></template
        >
        <div v-else class="invoice-line">
          <div>
            <b>{{ invoiceOrder?.plan_name || "云服务器服务" }}</b
            ><small>{{
              invoiceOrder?.number || selectedInvoice.order_id
            }}</small>
          </div>
          <b>{{
            money(selectedInvoice.amount_minor, selectedInvoice.currency)
          }}</b>
        </div>
        <div class="invoice-total">
          <span>账单总额</span
          ><strong>{{
            money(selectedInvoice.amount_minor, selectedInvoice.currency)
          }}</strong>
        </div>
        <p v-if="selectedInvoice.paid_at" class="paid-caption">
          <CheckCircle2 :size="15" />付款日期：{{
            date(selectedInvoice.paid_at)
          }}
        </p>
      </div>
      <div
        v-if="!['paid', 'void', 'cancelled'].includes(selectedInvoice.status)"
        class="alert info"
      >
        <LockKeyhole :size="18" /><span>{{
          checkoutSession
            ? "结账入口已准备好。前往服务商完成支付后，仍以服务端确认的账单状态为准。"
            : "如有可用支付适配器，可检查并获取结账入口。此处不收集银行卡信息，不会自动扣款。"
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
            ? "预览模式 · 支付不可用"
            : isAdmin
              ? "管理员不能代客户付款"
              : saving
                ? "正在检查…"
                : "检查支付可用性"
        }}
      </button>
      <div v-if="checkoutSession" class="checkout-handoff">
        <a
          class="button primary full"
          :href="checkoutSession.checkout_url"
          @click="followCheckout"
          target="_blank"
          rel="noopener noreferrer"
          >前往支付服务商<ArrowUpRight :size="16"
        /></a>
        <p>
          将在新标签页打开
          {{ checkoutHost }}。此操作不代表已付款；链接过期后请重新检查。
        </p>
      </div>
      <p class="invoice-caption">
        {{
          session.demo_mode
            ? "演示账单，不作为税务发票或付款凭证。"
            : "此为服务账单，不替代当地税务发票。"
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
      <h2 id="help-title">清晰的边界，安心的体验。</h2>
      <button
        class="icon-button"
        aria-label="关闭"
        @click="helpDialog?.close()"
      >
        <X :size="21" />
      </button>
    </div>
    <p>
      星屿云是前后端分离的云服务财务工作台。当前版本聚焦账户、订单、账单和审计。
    </p>
    <ul class="help-list">
      <li><Check :size="18" />真实 API、角色权限与服务端金额校验</li>
      <li><Check :size="18" />独立客户工作台与管理员视图</li>
      <li><Clock3 :size="18" />支付网关、节点控制器尚未接入</li>
      <li><Clock3 :size="18" />税务、退款、密码自助服务尚待实施</li>
    </ul>
    <div class="alert info">
      <ShieldCheck :size="19" /><span
        >演示不等于生产认证。真实上线前仍需安全审查、支付集成与备份恢复演练。</span
      >
    </div>
    <button class="button primary full" @click="helpDialog?.close()">
      了解了
    </button>
  </dialog>
</template>

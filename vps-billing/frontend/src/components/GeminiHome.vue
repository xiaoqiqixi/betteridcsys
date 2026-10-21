<script setup lang="ts">
import { computed } from "vue";
import {
  Server,
  FileText,
  ArrowRight,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  Clock,
  XCircle,
  Plus,
  Globe,
  Cpu,
} from "@lucide/vue";

interface CurrencyFormat {
  code: string;
  name: string;
  prefix: string;
  suffix: string;
  decimal_places: number;
}

interface Order {
  id: string;
  number: string;
  plan_name: string;
  status: string;
  currency: string;
  hostname: string;
  total_minor: number;
  currency_format: CurrencyFormat;
  created_at: string;
}

interface Service {
  id: string;
  name: string;
  plan_name: string;
  region: string;
  ipv4: string;
  status: string;
  currency: string;
  next_due_at: string;
  price_minor: number;
  currency_format: CurrencyFormat;
  cpu: number;
  memory_gb: number;
  disk_gb: number;
}

interface Overview {
  active_services: number;
  pending_invoices: number;
  unpaid_total_minor: number;
  monthly_total_minor: number;
  currency: string;
  currency_format: CurrencyFormat;
  recent_orders: Order[];
}

const props = defineProps<{
  locale: string;
  currency: string;
  user: { name: string } | null;
  loading: boolean;
  error: string;
  overview: Overview | null;
  services: Service[];
}>();

const emit = defineEmits<{
  (e: "navigate", path: string): void;
  (e: "retry"): void;
}>();

const isEn = computed(
  () => props.locale === "en" || props.locale.startsWith("en"),
);

const t = computed(() => {
  if (isEn.value) {
    return {
      welcomeUser: (name: string) => `Welcome back, ${name}`,
      welcomeDefault: "Home",
      scopeNotice: () => `Your services and bills at a glance.`,
      deployNew: "Buy now",
      viewInvoices: "Pending Invoices",
      errorTitle: "Unable to load console data",
      retryBtn: "Retry",
      loadingLabel: "Loading your services and invoices...",
      unpaidBannerTitle: (count: number) =>
        count === 1
          ? "1 invoice requires payment"
          : `${count} invoices require payment`,
      unpaidBannerDesc: "Review your invoices and complete payment.",
      payNowBtn: "Review Invoices",
      metricActiveServices: "Active Services",
      metricMonthlyCommit: "Monthly Commitment",
      metricPendingInvoices: "Pending Invoices",
      metricUnpaidBalance: "Unpaid Total",
      currencyScopeTag: (curr: string) => `${curr} scope`,
      servicesHeading: "My servers",
      servicesSub: "Service specifications and next due dates",
      allServicesBtn: "All Services",
      emptyServicesTitle: "No services yet",
      emptyServicesDesc:
        "Compare regions and specifications, then choose a suitable monthly plan.",
      browseCatalogBtn: "Buy now",
      dueLabel: "Next due",
      perMonth: "/ mo",
      ordersHeading: "Recent Orders",
      ordersSub: "Your latest purchases",
      allOrdersBtn: "All Orders",
      emptyOrders: "No recent orders found.",
      orderStatus: {
        pending_payment: "Pending Payment",
        paid: "Paid",
        cancelled: "Cancelled",
      } as Record<string, string>,
      serviceStatus: {
        running: "Running",
        active: "Active",
        provisioning: "Provisioning",
        stopped: "Stopped",
        suspended: "Suspended",
      } as Record<string, string>,
      quickLinksHeading: "Billing & Orders",
      quickCatalogTitle: "Cloud servers",
      quickCatalogDesc:
        "Compare regional availability, CPU, memory, and traffic quotas.",
      quickInvoicesTitle: "Invoices & Statements",
      quickInvoicesDesc: "Review invoices and payment status.",
      quickOrdersTitle: "Order History",
      quickOrdersDesc: "View order progress and purchased specifications.",
    };
  }
  return {
    welcomeUser: (name: string) => `欢迎回来，${name}`,
    welcomeDefault: "首页",
    scopeNotice: () => `查看服务状态，处理待付账单。`,
    deployNew: "立即购买",
    viewInvoices: "查看账单",
    errorTitle: "无法加载控制台数据",
    retryBtn: "重新加载",
    loadingLabel: "正在加载服务与账单…",
    unpaidBannerTitle: (count: number) => `您有 ${count} 笔待支付账单`,
    unpaidBannerDesc: "查看账单明细，及时完成付款。",
    payNowBtn: "前往账单中心",
    metricActiveServices: "有效服务",
    metricMonthlyCommit: "每月费用",
    metricPendingInvoices: "待付账单数",
    metricUnpaidBalance: "待付总额",
    currencyScopeTag: (curr: string) => `${curr} 统计范围`,
    servicesHeading: "我的服务器",
    servicesSub: "服务规格与下次到期日",
    allServicesBtn: "全部服务",
    emptyServicesTitle: "暂无云服务",
    emptyServicesDesc: "挑选适合你的套餐，开始使用云服务。",
    browseCatalogBtn: "立即购买",
    dueLabel: "下次到期",
    perMonth: "/ 月",
    ordersHeading: "近期订单",
    ordersSub: "查看最近的购买记录",
    allOrdersBtn: "全部订单",
    emptyOrders: "暂无近期订单记录。",
    orderStatus: {
      pending_payment: "待付款",
      paid: "已支付",
      cancelled: "已取消",
    } as Record<string, string>,
    serviceStatus: {
      running: "运行中",
      active: "有效",
      provisioning: "开通中",
      stopped: "已关机",
      suspended: "已暂停",
    } as Record<string, string>,
    quickLinksHeading: "快捷入口",
    quickCatalogTitle: "云服务器",
    quickCatalogDesc: "按地区和配置选择合适的套餐。",
    quickInvoicesTitle: "账单与付款",
    quickInvoicesDesc: "核对待付账单明细并发起付款流程。",
    quickOrdersTitle: "订单记录",
    quickOrdersDesc: "查看订单进度和购买时的配置。",
  };
});

/**
 * Formats integer minor units using pure BigInt string arithmetic.
 * Never divides floats or converts across currencies.
 */
function formatMoneyMinor(
  minor: number | null | undefined,
  fmt: CurrencyFormat | null | undefined,
  fallbackCurrency = "",
): string {
  if (
    typeof minor !== "number" ||
    !Number.isSafeInteger(minor) ||
    !fmt ||
    typeof fmt.code !== "string" ||
    !/^[A-Z]{3}$/.test(fmt.code) ||
    typeof fmt.name !== "string" ||
    typeof fmt.prefix !== "string" ||
    typeof fmt.suffix !== "string" ||
    !Number.isInteger(fmt.decimal_places) ||
    fmt.decimal_places < 0 ||
    fmt.decimal_places > 6 ||
    (fallbackCurrency !== "" && fallbackCurrency !== fmt.code)
  ) {
    return "—";
  }
  const decimals = fmt.decimal_places;
  const prefix = fmt.prefix;
  const suffix = fmt.suffix;
  const raw = BigInt(minor);

  const isNegative = raw < 0n;
  const abs = isNegative ? -raw : raw;
  const digits = abs.toString();

  let intPart = "0";
  let fracPart = "";

  if (decimals === 0) {
    intPart = digits;
  } else if (digits.length <= decimals) {
    intPart = "0";
    fracPart = digits.padStart(decimals, "0");
  } else {
    intPart = digits.slice(0, digits.length - decimals);
    fracPart = digits.slice(digits.length - decimals);
  }

  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const numericBody = decimals > 0 ? `${groupedInt}.${fracPart}` : groupedInt;
  const sign = isNegative ? "-" : "";

  if (prefix || suffix) {
    const sufPart = suffix
      ? suffix.startsWith(" ")
        ? suffix
        : ` ${suffix}`
      : "";
    return `${sign}${prefix}${numericBody}${sufPart}`;
  }
  const code = fmt.code;
  return code ? `${sign}${numericBody} ${code}` : `${sign}${numericBody}`;
}

function formatDate(iso: string | undefined | null): string {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(isEn.value ? "en-US" : "zh-CN", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(d);
  } catch {
    return iso.slice(0, 10);
  }
}

function formatServiceStatus(status: string): string {
  const key = (status || "").toLowerCase();
  return t.value.serviceStatus[key] || status;
}

function serviceStatusTone(status: string): "ok" | "warn" | "muted" {
  const key = (status || "").toLowerCase();
  if (key === "running" || key === "active") return "ok";
  if (key === "provisioning" || key === "pending") return "warn";
  return "muted";
}

const activeCurrencyCode = computed(() => {
  return (
    props.overview?.currency ||
    props.overview?.currency_format?.code ||
    props.currency ||
    "CNY"
  );
});

const hasUnpaid = computed(() => {
  if (!props.overview) return false;
  return (
    props.overview.pending_invoices > 0 || props.overview.unpaid_total_minor > 0
  );
});

const recentOrders = computed(() => {
  return props.overview?.recent_orders ?? [];
});

function go(path: string) {
  emit("navigate", path);
}
</script>

<template>
  <section class="gh-root" :aria-busy="loading ? 'true' : 'false'">
    <!-- Page Header -->
    <header class="gh-header">
      <div class="gh-header-main">
        <h1 class="gh-title">
          {{ user?.name ? t.welcomeUser(user.name) : t.welcomeDefault }}
        </h1>
        <p class="gh-subtitle">
          {{ t.scopeNotice() }}
        </p>
      </div>

      <div class="gh-header-actions">
        <button
          type="button"
          class="gh-btn gh-btn-secondary"
          @click="go('/invoices')"
        >
          <FileText :size="16" aria-hidden="true" />
          <span>{{ t.viewInvoices }}</span>
        </button>
        <button
          type="button"
          class="gh-btn gh-btn-primary"
          @click="go('/catalog')"
        >
          <Plus :size="16" aria-hidden="true" />
          <span>{{ t.deployNew }}</span>
        </button>
      </div>
    </header>

    <!-- Error State -->
    <div v-if="error" class="gh-alert gh-alert-error" role="alert">
      <div class="gh-alert-body">
        <AlertCircle :size="18" class="gh-alert-icon" aria-hidden="true" />
        <div class="gh-alert-text">
          <h2 class="gh-alert-title">{{ t.errorTitle }}</h2>
          <p class="gh-alert-desc">{{ error }}</p>
        </div>
      </div>
      <button
        type="button"
        class="gh-btn gh-btn-secondary"
        @click="emit('retry')"
      >
        <RefreshCw :size="15" aria-hidden="true" />
        <span>{{ t.retryBtn }}</span>
      </button>
    </div>

    <!-- Loading Skeleton -->
    <div
      v-if="loading && !overview && services.length === 0"
      class="gh-loading"
      role="status"
    >
      <div class="gh-skeleton-strip"></div>
      <div class="gh-skeleton-grid">
        <div class="gh-skeleton-block"></div>
        <div class="gh-skeleton-block"></div>
      </div>
      <p class="gh-sr-only">{{ t.loadingLabel }}</p>
    </div>

    <template v-else-if="!error || overview">
      <!-- Priority Pending Invoice Notice -->
      <div v-if="overview && hasUnpaid" class="gh-alert gh-alert-warn">
        <div class="gh-alert-body">
          <Clock :size="18" class="gh-alert-icon" aria-hidden="true" />
          <div class="gh-alert-text">
            <h2 class="gh-alert-title">
              {{ t.unpaidBannerTitle(overview.pending_invoices) }}
              <span class="gh-inline-amount">
                {{
                  formatMoneyMinor(
                    overview.unpaid_total_minor,
                    overview.currency_format,
                    overview.currency,
                  )
                }}
              </span>
            </h2>
            <p class="gh-alert-desc">{{ t.unpaidBannerDesc }}</p>
          </div>
        </div>
        <button
          type="button"
          class="gh-btn gh-btn-warn"
          @click="go('/invoices')"
        >
          <span>{{ t.payNowBtn }}</span>
          <ArrowRight :size="15" aria-hidden="true" />
        </button>
      </div>

      <!-- Restrained Currency-Scoped Summary Strip -->
      <section
        v-if="overview"
        class="gh-summary-strip"
        :aria-label="t.currencyScopeTag(activeCurrencyCode)"
      >
        <div class="gh-summary-cell">
          <div class="gh-summary-meta">
            <span class="gh-summary-label">{{ t.metricActiveServices }}</span>
            <span class="gh-scope-pill">{{ overview.currency }}</span>
          </div>
          <div class="gh-summary-value gh-mono">
            {{ overview.active_services }}
          </div>
        </div>

        <div class="gh-summary-cell">
          <div class="gh-summary-meta">
            <span class="gh-summary-label">{{ t.metricMonthlyCommit }}</span>
            <span class="gh-scope-pill">{{ overview.currency }}</span>
          </div>
          <div class="gh-summary-value gh-mono">
            {{
              formatMoneyMinor(
                overview.monthly_total_minor,
                overview.currency_format,
                overview.currency,
              )
            }}
          </div>
        </div>

        <div class="gh-summary-cell">
          <div class="gh-summary-meta">
            <span class="gh-summary-label">{{ t.metricPendingInvoices }}</span>
            <span class="gh-scope-pill">{{ overview.currency }}</span>
          </div>
          <div
            class="gh-summary-value gh-mono"
            :class="{ 'is-warn': overview.pending_invoices > 0 }"
          >
            {{ overview.pending_invoices }}
          </div>
        </div>

        <div class="gh-summary-cell">
          <div class="gh-summary-meta">
            <span class="gh-summary-label">{{ t.metricUnpaidBalance }}</span>
            <span class="gh-scope-pill">{{ overview.currency }}</span>
          </div>
          <div
            class="gh-summary-value gh-mono"
            :class="{ 'is-warn': overview.unpaid_total_minor > 0 }"
          >
            {{
              formatMoneyMinor(
                overview.unpaid_total_minor,
                overview.currency_format,
                overview.currency,
              )
            }}
          </div>
        </div>
      </section>

      <!-- Main Workspace Grid -->
      <div class="gh-workspace">
        <!-- Primary Column: Active Services -->
        <section class="gh-panel" aria-labelledby="gh-services-heading">
          <div class="gh-panel-header">
            <div>
              <h2 id="gh-services-heading" class="gh-panel-title">
                {{ t.servicesHeading }}
              </h2>
              <p class="gh-panel-sub">{{ t.servicesSub }}</p>
            </div>
            <button type="button" class="gh-link-btn" @click="go('/services')">
              <span>{{ t.allServicesBtn }}</span>
              <ArrowRight :size="15" aria-hidden="true" />
            </button>
          </div>

          <div v-if="services.length === 0" class="gh-empty">
            <Server :size="24" class="gh-empty-icon" aria-hidden="true" />
            <h3 class="gh-empty-title">{{ t.emptyServicesTitle }}</h3>
            <p class="gh-empty-desc">{{ t.emptyServicesDesc }}</p>
            <button
              type="button"
              class="gh-btn gh-btn-primary"
              @click="go('/catalog')"
            >
              <Plus :size="16" aria-hidden="true" />
              <span>{{ t.browseCatalogBtn }}</span>
            </button>
          </div>

          <ul v-else class="gh-list" role="list">
            <li v-for="srv in services" :key="srv.id" class="gh-list-item">
              <button type="button" class="gh-row-btn" @click="go('/services')">
                <div class="gh-row-primary">
                  <div class="gh-row-title-line">
                    <span
                      class="gh-status-dot"
                      :data-tone="serviceStatusTone(srv.status)"
                      aria-hidden="true"
                    ></span>
                    <span class="gh-item-name">{{
                      srv.name || srv.plan_name
                    }}</span>
                    <span
                      class="gh-status-text"
                      :data-tone="serviceStatusTone(srv.status)"
                    >
                      {{ formatServiceStatus(srv.status) }}
                    </span>
                  </div>

                  <div class="gh-spec-line">
                    <span class="gh-spec-chip">
                      <Cpu :size="13" aria-hidden="true" />
                      {{ srv.cpu }} vCPU · {{ srv.memory_gb }} GB ·
                      {{ srv.disk_gb }} GB
                    </span>
                    <span class="gh-spec-sep" aria-hidden="true">·</span>
                    <span class="gh-spec-chip">
                      <Globe :size="13" aria-hidden="true" />
                      {{ srv.region }}
                    </span>
                    <template v-if="srv.ipv4">
                      <span class="gh-spec-sep" aria-hidden="true">·</span>
                      <span class="gh-mono gh-ip">{{ srv.ipv4 }}</span>
                    </template>
                  </div>
                </div>

                <div class="gh-row-aside">
                  <div class="gh-price-line gh-mono">
                    {{
                      formatMoneyMinor(
                        srv.price_minor,
                        srv.currency_format,
                        srv.currency,
                      )
                    }}
                    <span class="gh-price-unit">{{ t.perMonth }}</span>
                  </div>
                  <div class="gh-meta-line">
                    <span
                      >{{ t.dueLabel }} {{ formatDate(srv.next_due_at) }}</span
                    >
                    <span
                      v-if="srv.currency !== activeCurrencyCode"
                      class="gh-curr-badge"
                    >
                      {{ srv.currency }}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          </ul>
        </section>

        <!-- Secondary Column: Recent Orders & Direct Navigation -->
        <div class="gh-side-stack">
          <section class="gh-panel" aria-labelledby="gh-orders-heading">
            <div class="gh-panel-header">
              <div>
                <h2 id="gh-orders-heading" class="gh-panel-title">
                  {{ t.ordersHeading }}
                </h2>
                <p class="gh-panel-sub">{{ t.ordersSub }}</p>
              </div>
              <button type="button" class="gh-link-btn" @click="go('/orders')">
                <span>{{ t.allOrdersBtn }}</span>
                <ArrowRight :size="15" aria-hidden="true" />
              </button>
            </div>

            <div
              v-if="recentOrders.length === 0"
              class="gh-empty gh-empty-compact"
            >
              <p class="gh-empty-desc">{{ t.emptyOrders }}</p>
            </div>

            <ul v-else class="gh-list" role="list">
              <li
                v-for="ord in recentOrders"
                :key="ord.id"
                class="gh-list-item"
              >
                <button
                  type="button"
                  class="gh-row-btn gh-row-btn-compact"
                  @click="go(`/orders/${encodeURIComponent(ord.id)}`)"
                >
                  <div class="gh-row-primary">
                    <div class="gh-row-title-line">
                      <span class="gh-item-name">{{ ord.plan_name }}</span>
                      <span class="gh-order-badge" :data-status="ord.status">
                        <CheckCircle2
                          v-if="ord.status === 'paid'"
                          :size="12"
                          aria-hidden="true"
                        />
                        <Clock
                          v-else-if="ord.status === 'pending_payment'"
                          :size="12"
                          aria-hidden="true"
                        />
                        <XCircle
                          v-else-if="ord.status === 'cancelled'"
                          :size="12"
                          aria-hidden="true"
                        />
                        <AlertCircle v-else :size="12" aria-hidden="true" />
                        {{ t.orderStatus[ord.status] || ord.status }}
                      </span>
                    </div>

                    <div class="gh-spec-line">
                      <span class="gh-mono">{{ ord.number }}</span>
                      <template v-if="ord.hostname">
                        <span class="gh-spec-sep" aria-hidden="true">·</span>
                        <span class="gh-mono gh-hostname">{{
                          ord.hostname
                        }}</span>
                      </template>
                    </div>
                  </div>

                  <div class="gh-row-aside">
                    <div class="gh-price-line gh-mono">
                      {{
                        formatMoneyMinor(
                          ord.total_minor,
                          ord.currency_format,
                          ord.currency,
                        )
                      }}
                    </div>
                    <div class="gh-meta-line">
                      <span>{{ formatDate(ord.created_at) }}</span>
                      <span class="gh-curr-badge">{{ ord.currency }}</span>
                    </div>
                  </div>
                </button>
              </li>
            </ul>
          </section>

          <!-- Clean Task Navigation List -->
          <section class="gh-panel" aria-labelledby="gh-quick-heading">
            <div class="gh-panel-header">
              <h2 id="gh-quick-heading" class="gh-panel-title">
                {{ t.quickLinksHeading }}
              </h2>
            </div>
            <div class="gh-nav-list">
              <button type="button" class="gh-nav-row" @click="go('/catalog')">
                <div class="gh-nav-row-text">
                  <span class="gh-nav-row-title">{{
                    t.quickCatalogTitle
                  }}</span>
                  <span class="gh-nav-row-desc">{{ t.quickCatalogDesc }}</span>
                </div>
                <ArrowRight
                  :size="16"
                  class="gh-nav-arrow"
                  aria-hidden="true"
                />
              </button>

              <button type="button" class="gh-nav-row" @click="go('/invoices')">
                <div class="gh-nav-row-text">
                  <span class="gh-nav-row-title">{{
                    t.quickInvoicesTitle
                  }}</span>
                  <span class="gh-nav-row-desc">{{ t.quickInvoicesDesc }}</span>
                </div>
                <ArrowRight
                  :size="16"
                  class="gh-nav-arrow"
                  aria-hidden="true"
                />
              </button>

              <button type="button" class="gh-nav-row" @click="go('/orders')">
                <div class="gh-nav-row-text">
                  <span class="gh-nav-row-title">{{ t.quickOrdersTitle }}</span>
                  <span class="gh-nav-row-desc">{{ t.quickOrdersDesc }}</span>
                </div>
                <ArrowRight
                  :size="16"
                  class="gh-nav-arrow"
                  aria-hidden="true"
                />
              </button>
            </div>
          </section>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.gh-root {
  --c-canvas: var(--bg-canvas, #070b14);
  --c-surface: var(--bg-surface, #0d1322);
  --c-elevated: var(--bg-elevated, #131c31);
  --c-text: var(--text-primary, #f1f5f9);
  --c-text-sec: var(--text-secondary, #94a3b8);
  --c-text-muted: var(--text-muted, #64748b);
  --c-accent: var(--accent-primary, #00e5be);
  --c-border: var(--border-subtle, rgba(148, 163, 184, 0.14));
  --c-border-strong: var(--border-strong, rgba(148, 163, 184, 0.26));

  color: var(--c-text);
  width: 100%;
  max-width: 1360px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
  box-sizing: border-box;
}

.gh-root *,
.gh-root *::before,
.gh-root *::after {
  box-sizing: border-box;
}

.gh-mono {
  font-family: var(
    --font-mono,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    monospace
  );
  font-variant-numeric: tabular-nums;
}

.gh-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Header */
.gh-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding-bottom: 4px;
}

.gh-header-main {
  min-width: 0;
  flex: 1 1 320px;
}

.gh-title {
  font-size: clamp(1.25rem, 2vw, 1.5rem);
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.3;
  color: var(--c-text);
  margin: 0 0 6px;
}

.gh-subtitle {
  font-size: 0.875rem;
  color: var(--c-text-sec);
  line-height: 1.5;
  margin: 0;
}

.gh-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* Buttons */
.gh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
  white-space: nowrap;
}

.gh-btn-primary {
  background-color: var(--action-primary-bg);
  color: var(--action-primary-text);
  font-weight: 600;
}

.gh-btn-primary:hover {
  background-color: var(--action-primary-hover);
}

.gh-btn-secondary {
  background-color: var(--c-surface);
  color: var(--c-text);
  border-color: var(--c-border-strong);
}

.gh-btn-secondary:hover {
  background-color: var(--c-elevated);
}

.gh-btn-warn {
  background-color: var(--status-warning-bg);
  color: var(--status-warning);
  border-color: var(--status-warning-border);
}

.gh-btn-warn:hover {
  background-color: var(--status-warning-hover);
}

.gh-link-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 10px;
  margin-right: -10px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--c-text-sec);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.gh-link-btn:hover {
  color: var(--c-text);
  background-color: var(--bg-hover);
}

/* Alerts */
.gh-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 14px 18px;
  border-radius: 10px;
  border: 1px solid var(--c-border);
  background-color: var(--c-surface);
}

.gh-alert-warn {
  border-color: var(--status-warning-border);
  background-color: var(--status-warning-bg);
}

.gh-alert-error {
  border-color: var(--status-danger-border);
  background-color: var(--status-danger-bg);
}

.gh-alert-body {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
  flex: 1 1 260px;
}

.gh-alert-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--status-warning);
}

.gh-alert-error .gh-alert-icon {
  color: var(--status-danger);
}

.gh-alert-text {
  min-width: 0;
}

.gh-alert-title {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 0 0 2px;
  color: var(--c-text);
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
}

.gh-inline-amount {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  color: var(--status-warning);
  word-break: break-all;
}

.gh-alert-desc {
  font-size: 0.8125rem;
  color: var(--c-text-sec);
  margin: 0;
}

/* Restrained Summary Strip */
.gh-summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  background-color: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  overflow: hidden;
}

.gh-summary-cell {
  padding: 16px 18px;
  border-right: 1px solid var(--c-border);
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
}

.gh-summary-cell:last-child {
  border-right: none;
}

.gh-summary-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.gh-summary-label {
  font-size: 0.8125rem;
  color: var(--c-text-sec);
  font-weight: 500;
}

.gh-scope-pill {
  font-size: 0.75rem;
  color: var(--c-text-muted);
  font-family: var(--font-mono, ui-monospace, monospace);
}

.gh-summary-value {
  font-size: clamp(1.125rem, 1.8vw, 1.375rem);
  font-weight: 600;
  color: var(--c-text);
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.gh-summary-value.is-warn {
  color: var(--status-warning);
}

/* Main Workspace */
.gh-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.gh-side-stack {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}

.gh-panel {
  background-color: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  overflow: hidden;
  min-width: 0;
}

.gh-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--c-border);
}

.gh-panel-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--c-text);
  margin: 0;
}

.gh-panel-sub {
  font-size: 0.8125rem;
  color: var(--c-text-sec);
  margin: 2px 0 0;
}

/* Flat Divider Lists (No nested cards) */
.gh-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.gh-list-item {
  border-bottom: 1px solid var(--c-border);
}

.gh-list-item:last-child {
  border-bottom: none;
}

.gh-row-btn {
  width: 100%;
  min-height: 68px;
  padding: 14px 20px;
  background: transparent;
  border: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  transition: background-color 0.14s ease;
}

.gh-row-btn-compact {
  min-height: 60px;
  padding: 12px 20px;
}

.gh-row-btn:hover {
  background-color: var(--bg-hover);
}

.gh-row-primary {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gh-row-title-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.gh-item-name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--c-text);
  overflow-wrap: anywhere;
}

.gh-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex-shrink: 0;
  background-color: var(--c-text-muted);
}

.gh-status-dot[data-tone="ok"] {
  background-color: var(--status-success);
}

.gh-status-dot[data-tone="warn"] {
  background-color: var(--status-warning);
}

.gh-status-text {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--c-text-sec);
}

.gh-status-text[data-tone="ok"] {
  color: var(--status-success);
}

.gh-status-text[data-tone="warn"] {
  color: var(--status-warning);
}

.gh-spec-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 0.8125rem;
  color: var(--c-text-sec);
}

.gh-spec-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.gh-spec-sep {
  color: var(--c-text-muted);
}

.gh-ip,
.gh-hostname {
  color: var(--c-text-sec);
  overflow-wrap: anywhere;
}

.gh-row-aside {
  flex-shrink: 0;
  text-align: right;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  max-width: 45%;
}

.gh-price-line {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--c-text);
  overflow-wrap: anywhere;
}

.gh-price-unit {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--c-text-sec);
}

.gh-meta-line {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--c-text-muted);
}

.gh-curr-badge {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.6875rem;
  padding: 1px 6px;
  border-radius: 4px;
  background-color: var(--status-neutral-bg);
  color: var(--c-text-sec);
}

.gh-order-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 999px;
  background-color: var(--status-neutral-bg);
  color: var(--c-text-sec);
}

.gh-order-badge[data-status="paid"] {
  background-color: var(--status-success-bg);
  color: var(--status-success);
}

.gh-order-badge[data-status="pending_payment"] {
  background-color: var(--status-warning-bg);
  color: var(--status-warning);
}

.gh-order-badge[data-status="cancelled"] {
  background-color: var(--status-neutral-bg);
  color: var(--c-text-muted);
}

/* Quick Nav Rows */
.gh-nav-list {
  display: flex;
  flex-direction: column;
}

.gh-nav-row {
  width: 100%;
  min-height: 56px;
  padding: 12px 20px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--c-border);
  color: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  transition: background-color 0.14s ease;
}

.gh-nav-row:last-child {
  border-bottom: none;
}

.gh-nav-row:hover {
  background-color: var(--bg-hover);
}

.gh-nav-row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.gh-nav-row-title {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--c-text);
}

.gh-nav-row-desc {
  font-size: 0.75rem;
  color: var(--c-text-sec);
}

.gh-nav-arrow {
  color: var(--c-text-muted);
  flex-shrink: 0;
}

/* Empty & Loading States */
.gh-empty {
  padding: 40px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.gh-empty-compact {
  padding: 28px 20px;
}

.gh-empty-icon {
  color: var(--c-text-muted);
}

.gh-empty-title {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 0;
  color: var(--c-text);
}

.gh-empty-desc {
  font-size: 0.8125rem;
  color: var(--c-text-sec);
  max-width: 360px;
  margin: 0 0 6px;
}

.gh-loading {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.gh-skeleton-strip {
  height: 84px;
  border-radius: 10px;
  background-color: var(--c-surface);
  border: 1px solid var(--c-border);
}

.gh-skeleton-grid {
  display: grid;
  grid-template-columns: 1.55fr 1fr;
  gap: 20px;
}

.gh-skeleton-block {
  height: 260px;
  border-radius: 10px;
  background-color: var(--c-surface);
  border: 1px solid var(--c-border);
}

/* Focus & Reduced Motion */
.gh-btn:focus-visible,
.gh-link-btn:focus-visible,
.gh-row-btn:focus-visible,
.gh-nav-row:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: -2px;
}

@media (prefers-reduced-motion: reduce) {
  .gh-btn,
  .gh-link-btn,
  .gh-row-btn,
  .gh-nav-row {
    transition: none;
  }
}

/* Responsive Breakpoints (Tablet & 320px/375px Mobile) */
@media (max-width: 1024px) {
  .gh-workspace,
  .gh-skeleton-grid {
    grid-template-columns: 1fr;
  }

  .gh-summary-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .gh-summary-cell:nth-child(2) {
    border-right: none;
  }

  .gh-summary-cell:nth-child(1),
  .gh-summary-cell:nth-child(2) {
    border-bottom: 1px solid var(--c-border);
  }
}

@media (max-width: 600px) {
  .gh-root {
    gap: 18px;
  }

  .gh-header-actions {
    width: 100%;
  }

  .gh-header-actions .gh-btn {
    flex: 1 1 calc(50% - 6px);
  }

  .gh-summary-strip {
    grid-template-columns: 1fr;
  }

  .gh-summary-cell {
    border-right: none;
    border-bottom: 1px solid var(--c-border);
    padding: 14px 16px;
  }

  .gh-summary-cell:last-child {
    border-bottom: none;
  }

  .gh-row-btn {
    flex-direction: column;
    align-items: flex-start;
    padding: 14px 16px;
    gap: 10px;
  }

  .gh-row-aside {
    max-width: 100%;
    width: 100%;
    flex-direction: row;
    align-items: baseline;
    justify-content: space-between;
    text-align: left;
    padding-top: 8px;
    border-top: 1px dashed var(--c-border);
  }

  .gh-panel-header {
    padding: 14px 16px;
  }

  .gh-nav-row {
    padding: 12px 16px;
  }
}

/* Gemini-authored refinement after actual 375px browser review. */
/* === Mobile Viewport & 14px Root Typography Calibration === */
.gh-title {
  font-size: clamp(20px, 2.2vw, 24px);
}

.gh-subtitle,
.gh-btn,
.gh-panel-title,
.gh-alert-title,
.gh-item-name,
.gh-price-line,
.gh-nav-row-title {
  font-size: 14px;
}

.gh-panel-sub,
.gh-alert-desc,
.gh-spec-line,
.gh-summary-label,
.gh-link-btn,
.gh-empty-desc {
  font-size: 12.5px;
}

.gh-meta-line,
.gh-status-text,
.gh-order-badge,
.gh-nav-row-desc,
.gh-scope-pill,
.gh-curr-badge,
.gh-price-unit {
  font-size: 12px;
}

@media (max-width: 600px) {
  .gh-root {
    gap: 14px;
  }

  .gh-header {
    gap: 10px;
  }

  .gh-subtitle {
    font-size: 12.5px;
    line-height: 1.45;
  }

  /* Compact 2-column summary strip instead of 4 vertical rows */
  .gh-summary-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .gh-summary-cell {
    padding: 10px 12px;
    gap: 4px;
    border-bottom: 1px solid var(--c-border);
  }

  .gh-summary-cell:nth-child(odd) {
    border-right: 1px solid var(--c-border);
  }

  .gh-summary-cell:nth-last-child(-n + 2) {
    border-bottom: none;
  }

  /* Deduplicate pending invoice metrics when unpaid alert banner is active */
  .gh-alert-warn + .gh-summary-strip .gh-summary-cell:nth-child(n + 3) {
    display: none;
  }

  .gh-alert-warn + .gh-summary-strip .gh-summary-cell {
    border-bottom: none;
  }

  .gh-summary-value {
    font-size: 15px;
    line-height: 1.2;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .gh-alert {
    padding: 12px 14px;
    gap: 10px;
  }

  .gh-alert .gh-btn {
    width: 100%;
  }
}

@media (max-width: 359px) {
  .gh-header-actions .gh-btn {
    flex: 1 1 100%;
  }

  .gh-summary-cell {
    padding: 8px 10px;
  }
}
</style>

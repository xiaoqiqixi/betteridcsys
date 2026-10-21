<script setup lang="ts">
import { computed } from "vue";
import {
  RefreshCw,
  AlertCircle,
  FileText,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  MinusCircle,
} from "@lucide/vue";

export interface CurrencyFormat {
  code: string;
  name: string;
  prefix: string;
  suffix: string;
  decimal_places: number;
}

export interface FinanceSummary {
  customers: number;
  total_services: number;
  unpaid_invoices: number;
  unpaid_total_minor: number;
  revenue_minor: number;
  currency: string;
  currency_format: CurrencyFormat;
  count_scope: "currency";
  customers_scope: "all";
}

export interface FinanceInvoiceItem {
  id: string;
  number: string;
  order_id: string;
  status: string;
  currency: string;
  amount_minor: number;
  currency_format: CurrencyFormat;
  issued_at: string;
  due_at: string;
  paid_at?: string;
}

const props = defineProps<{
  locale: string;
  summary: FinanceSummary | null;
  invoices: FinanceInvoiceItem[];
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{
  (e: "refresh"): void;
  (e: "openInvoice", id: string): void;
}>();

const isEn = computed(
  () => props.locale === "en" || props.locale.startsWith("en"),
);

const t = computed(() =>
  isEn.value
    ? {
        title: "Financial overview",
        subtitle: "Review payments and outstanding invoices.",
        refresh: "Refresh",
        loading: "Loading invoices...",
        errTitle: "Failed to load financial data",
        collected: "Collected Revenue",
        unpaidTotal: "Unpaid Balance",
        unpaidCount: "Unpaid Invoices",
        services: "Services",
        customers: "Registered Customers",
        currScope: (c: string) => `${c || "—"}`,
        allScope: "Site-wide total",
        listTitle: "Recent invoices",
        listNote: (n: number) =>
          `${n} records shown, up to 1,000 recent invoices.`,
        empty: "No invoice records in current view.",
        colNumber: "Invoice / Order",
        colStatus: "Status",
        colCurrency: "Currency",
        colAmount: "Amount",
        colIssued: "Issued / Due",
        colPaidAt: "Paid At",
        colAction: "Inspect",
        openBtn: "Details",
        duePrefix: "Due",
        statusMap: {
          paid: "Paid",
          unpaid: "Unpaid",
          pending: "Pending",
          payment_prepared: "Payment Prepared",
          overdue: "Overdue",
          void: "Void",
          voided: "Voided",
          cancelled: "Cancelled",
        } as Record<string, string>,
      }
    : {
        title: "财务概览",
        subtitle: "查看收款与待付账单。",
        refresh: "刷新数据",
        loading: "正在加载账单…",
        errTitle: "财务数据加载失败",
        collected: "已收款总额",
        unpaidTotal: "未付款总额",
        unpaidCount: "待处理账单数",
        services: "所选币种服务数",
        customers: "全站客户总数",
        currScope: (c: string) => `${c || "—"}`,
        allScope: "全站范围",
        listTitle: "近期账单",
        listNote: (n: number) =>
          `当前显示 ${n} 条，最多展示最近 1,000 条账单。`,
        empty: "当前视图暂无账单记录。",
        colNumber: "账单号 / 关联订单",
        colStatus: "状态",
        colCurrency: "币种",
        colAmount: "账单金额",
        colIssued: "开具 / 到期时间",
        colPaidAt: "付款时间",
        colAction: "详情",
        openBtn: "查看详情",
        duePrefix: "到期",
        statusMap: {
          paid: "已支付",
          unpaid: "未支付",
          pending: "待处理",
          payment_prepared: "付款准备中",
          overdue: "已逾期",
          void: "已作废",
          voided: "已作废",
          cancelled: "已取消",
        } as Record<string, string>,
      },
);

function formatStrictMoney(
  minor: unknown,
  currency: unknown,
  fmt: CurrencyFormat | null | undefined,
): string {
  if (typeof minor !== "number" || !Number.isSafeInteger(minor)) return "—";
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return "—";
  if (
    !fmt ||
    typeof fmt !== "object" ||
    fmt.code !== currency ||
    typeof fmt.name !== "string" ||
    typeof fmt.prefix !== "string" ||
    typeof fmt.suffix !== "string" ||
    typeof fmt.decimal_places !== "number" ||
    !Number.isInteger(fmt.decimal_places) ||
    fmt.decimal_places < 0 ||
    fmt.decimal_places > 6
  ) {
    return "—";
  }

  const dec = fmt.decimal_places;
  const raw = BigInt(minor);
  const neg = raw < 0n;
  const digits = (neg ? -raw : raw).toString();

  let intPart = "0";
  let fracPart = "";
  if (dec === 0) {
    intPart = digits;
  } else if (digits.length <= dec) {
    intPart = "0";
    fracPart = digits.padStart(dec, "0");
  } else {
    intPart = digits.slice(0, digits.length - dec);
    fracPart = digits.slice(digits.length - dec);
  }

  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const numBody = dec > 0 ? `${grouped}.${fracPart}` : grouped;
  const sign = neg ? "-" : "";
  const pre = typeof fmt.prefix === "string" ? fmt.prefix : "";
  const suf = typeof fmt.suffix === "string" ? fmt.suffix : "";

  if (pre || suf) {
    return `${sign}${pre}${numBody}${suf}`;
  }
  return `${sign}${numBody} ${fmt.code}`;
}

function formatSafeCount(val: unknown): string {
  if (typeof val !== "number" || !Number.isSafeInteger(val) || val < 0)
    return "—";
  return val.toLocaleString("en-US");
}

function formatDate(iso: string | undefined | null): string {
  if (!iso || typeof iso !== "string") return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(isEn.value ? "en-US" : "zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return iso.slice(0, 10);
  }
}

function statusTone(status: string): "ok" | "warn" | "neutral" {
  const s = status || "";
  if (s === "paid") return "ok";
  if (
    s === "unpaid" ||
    s === "overdue" ||
    s === "pending" ||
    s === "payment_prepared"
  ) {
    return "warn";
  }
  return "neutral";
}

function statusLabel(status: string): string {
  if (!status) return "—";
  const key = status;
  return Object.hasOwn(t.value.statusMap, key)
    ? t.value.statusMap[key]!
    : status;
}
</script>

<template>
  <section class="gfo-root" :aria-busy="loading ? 'true' : 'false'">
    <header class="gfo-header">
      <div class="gfo-header-text">
        <h1 class="gfo-title">{{ t.title }}</h1>
        <p class="gfo-subtitle">{{ t.subtitle }}</p>
      </div>
      <button
        type="button"
        class="gfo-btn"
        :disabled="loading"
        @click="emit('refresh')"
      >
        <RefreshCw
          :size="15"
          :class="{ 'is-spin': loading }"
          aria-hidden="true"
        />
        <span>{{ t.refresh }}</span>
      </button>
    </header>

    <div v-if="error" class="gfo-alert" role="alert">
      <AlertCircle :size="18" class="gfo-alert-icon" aria-hidden="true" />
      <div class="gfo-alert-body">
        <h2 class="gfo-alert-title">{{ t.errTitle }}</h2>
        <p class="gfo-alert-desc">{{ error }}</p>
      </div>
    </div>

    <div
      v-if="loading && !summary && invoices.length === 0"
      class="gfo-loading"
      role="status"
    >
      {{ t.loading }}
    </div>

    <!-- Summary Strip -->
    <section v-if="summary" class="gfo-summary" :aria-label="t.title">
      <div class="gfo-cell">
        <div class="gfo-cell-top">
          <span class="gfo-cell-label">{{ t.collected }}</span>
          <span class="gfo-scope gfo-mono">{{
            t.currScope(summary.currency)
          }}</span>
        </div>
        <div class="gfo-cell-val gfo-mono">
          {{
            formatStrictMoney(
              summary.revenue_minor,
              summary.currency,
              summary.currency_format,
            )
          }}
        </div>
      </div>

      <div class="gfo-cell">
        <div class="gfo-cell-top">
          <span class="gfo-cell-label">{{ t.unpaidTotal }}</span>
          <span class="gfo-scope gfo-mono">{{
            t.currScope(summary.currency)
          }}</span>
        </div>
        <div
          class="gfo-cell-val gfo-mono"
          :class="{
            'is-warn':
              Number.isSafeInteger(summary.unpaid_total_minor) &&
              summary.unpaid_total_minor > 0,
          }"
        >
          {{
            formatStrictMoney(
              summary.unpaid_total_minor,
              summary.currency,
              summary.currency_format,
            )
          }}
        </div>
      </div>

      <div class="gfo-cell">
        <div class="gfo-cell-top">
          <span class="gfo-cell-label">{{ t.unpaidCount }}</span>
          <span class="gfo-scope gfo-mono">{{
            t.currScope(summary.currency)
          }}</span>
        </div>
        <div
          class="gfo-cell-val gfo-mono"
          :class="{
            'is-warn':
              Number.isSafeInteger(summary.unpaid_invoices) &&
              summary.unpaid_invoices > 0,
          }"
        >
          {{ formatSafeCount(summary.unpaid_invoices) }}
        </div>
      </div>

      <div class="gfo-cell">
        <div class="gfo-cell-top">
          <span class="gfo-cell-label">{{ t.services }}</span>
          <span class="gfo-scope gfo-mono">{{
            t.currScope(summary.currency)
          }}</span>
        </div>
        <div class="gfo-cell-val gfo-mono">
          {{ formatSafeCount(summary.total_services) }}
        </div>
      </div>

      <div class="gfo-cell">
        <div class="gfo-cell-top">
          <span class="gfo-cell-label">{{ t.customers }}</span>
          <span class="gfo-scope is-global">{{ t.allScope }}</span>
        </div>
        <div class="gfo-cell-val gfo-mono">
          {{ formatSafeCount(summary.customers) }}
        </div>
      </div>
    </section>

    <!-- Recent invoices Ledger View -->
    <section
      v-if="!error || invoices.length > 0"
      class="gfo-panel"
      aria-labelledby="gfo-list-heading"
    >
      <div class="gfo-panel-head">
        <div>
          <h2 id="gfo-list-heading" class="gfo-panel-title">
            {{ t.listTitle }}
          </h2>
          <p class="gfo-panel-note">{{ t.listNote(invoices.length) }}</p>
        </div>
      </div>

      <div v-if="!loading && !error && invoices.length === 0" class="gfo-empty">
        <FileText :size="20" aria-hidden="true" />
        <span>{{ t.empty }}</span>
      </div>

      <div v-else-if="invoices.length > 0" class="gfo-table-wrap">
        <table class="gfo-table">
          <thead>
            <tr>
              <th scope="col">{{ t.colNumber }}</th>
              <th scope="col">{{ t.colStatus }}</th>
              <th scope="col">{{ t.colCurrency }}</th>
              <th scope="col" class="is-right">{{ t.colAmount }}</th>
              <th scope="col">{{ t.colIssued }}</th>
              <th scope="col">{{ t.colPaidAt }}</th>
              <th scope="col" class="is-right">{{ t.colAction }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="inv in invoices" :key="inv.id" class="gfo-row">
              <td class="gfo-cell-id">
                <div class="gfo-inv-num gfo-mono">
                  {{ inv.number || inv.id }}
                </div>
                <div class="gfo-ord-id gfo-mono">{{ inv.order_id || "—" }}</div>
              </td>
              <td>
                <span class="gfo-status" :data-tone="statusTone(inv.status)">
                  <CheckCircle2
                    v-if="statusTone(inv.status) === 'ok'"
                    :size="13"
                    aria-hidden="true"
                  />
                  <Clock
                    v-else-if="statusTone(inv.status) === 'warn'"
                    :size="13"
                    aria-hidden="true"
                  />
                  <MinusCircle v-else :size="13" aria-hidden="true" />
                  <span>{{ statusLabel(inv.status) }}</span>
                </span>
              </td>
              <td>
                <span class="gfo-curr-pill gfo-mono">{{
                  inv.currency || "—"
                }}</span>
              </td>
              <td class="is-right gfo-amount gfo-mono">
                {{
                  formatStrictMoney(
                    inv.amount_minor,
                    inv.currency,
                    inv.currency_format,
                  )
                }}
              </td>
              <td class="gfo-dates gfo-mono">
                <div>{{ formatDate(inv.issued_at) }}</div>
                <div class="gfo-date-sub">
                  {{ t.duePrefix }}: {{ formatDate(inv.due_at) }}
                </div>
              </td>
              <td class="gfo-dates gfo-mono">
                {{ inv.paid_at ? formatDate(inv.paid_at) : "—" }}
              </td>
              <td class="is-right">
                <button
                  type="button"
                  class="gfo-btn gfo-btn-inspect"
                  @click="emit('openInvoice', inv.id)"
                >
                  <span>{{ t.openBtn }}</span>
                  <ArrowUpRight :size="14" aria-hidden="true" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<style scoped>
.gfo-root {
  --c-canvas: var(--bg-canvas, #070b14);
  --c-surface: var(--bg-surface, #0d1322);
  --c-elevated: var(--bg-elevated, #131c31);
  --c-text: var(--text-primary, #f1f5f9);
  --c-sec: var(--text-secondary, #94a3b8);
  --c-muted: var(--text-muted, #64748b);
  --c-accent: var(--accent-primary, #00e5be);
  --c-admin: var(--accent-admin, #f59e0b);
  --c-border: var(--border-subtle, rgba(148, 163, 184, 0.14));
  --c-strong: var(--border-strong, rgba(148, 163, 184, 0.28));

  color: var(--c-text);
  font-size: 14px;
  line-height: 1.5;
  width: 100%;
  max-width: 1360px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  box-sizing: border-box;
}

.gfo-root *,
.gfo-root *::before,
.gfo-root *::after {
  box-sizing: border-box;
}

.gfo-mono {
  font-family: var(
    --font-mono,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Consolas,
    monospace
  );
  font-variant-numeric: tabular-nums;
}

.gfo-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.gfo-header-text {
  flex: 1 1 280px;
  min-width: 0;
}

.gfo-title {
  font-size: clamp(20px, 2.2vw, 24px);
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0 0 4px;
}

.gfo-subtitle {
  font-size: 13px;
  color: var(--c-sec);
  margin: 0;
}

.gfo-btn {
  min-height: 44px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--c-strong);
  background: var(--c-surface);
  color: var(--c-text);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  white-space: nowrap;
}

.gfo-btn:hover:not(:disabled) {
  background: var(--c-elevated);
}

.gfo-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.gfo-btn:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: 2px;
}

.gfo-alert {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--status-danger-border);
  background: var(--status-danger-bg);
}

.gfo-alert-icon {
  color: var(--status-danger);
  flex-shrink: 0;
  margin-top: 2px;
}

.gfo-alert-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 2px;
}

.gfo-alert-desc {
  font-size: 13px;
  color: var(--c-sec);
  margin: 0;
  overflow-wrap: anywhere;
}

.gfo-loading {
  padding: 20px;
  border-radius: 10px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-sec);
  font-size: 14px;
}

/* Summary Strip */
.gfo-summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  overflow: hidden;
}

.gfo-cell {
  padding: 14px 16px;
  border-right: 1px solid var(--c-border);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.gfo-cell:last-child {
  border-right: none;
}

.gfo-cell-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}

.gfo-cell-label {
  font-size: 12.5px;
  color: var(--c-sec);
  font-weight: 500;
}

.gfo-scope {
  font-size: 12px;
  color: var(--c-admin);
  background: var(--status-warning-bg);
  padding: 1px 6px;
  border-radius: 4px;
}

.gfo-scope.is-global {
  color: var(--c-sec);
  background: var(--status-neutral-bg);
}

.gfo-cell-val {
  font-size: clamp(16px, 1.6vw, 20px);
  font-weight: 600;
  color: var(--c-text);
  line-height: 1.25;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.gfo-cell-val.is-warn {
  color: var(--status-warning);
}

/* Table Panel */
.gfo-panel {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  overflow: hidden;
}

.gfo-panel-head {
  padding: 14px 18px;
  border-bottom: 1px solid var(--c-border);
}

.gfo-panel-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 2px;
}

.gfo-panel-note {
  font-size: 12px;
  color: var(--c-sec);
  margin: 0;
}

.gfo-empty {
  padding: 36px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--c-sec);
  font-size: 14px;
}

.gfo-table-wrap {
  width: 100%;
  overflow-x: auto;
}

.gfo-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.gfo-table th {
  padding: 11px 16px;
  font-size: 12px;
  font-weight: 600;
  color: var(--c-sec);
  background: var(--bg-table-header);
  border-bottom: 1px solid var(--c-border);
  white-space: nowrap;
}

.gfo-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--c-border);
  vertical-align: middle;
  font-size: 14px;
}

.gfo-table tr:last-child td {
  border-bottom: none;
}

.gfo-table th.is-right,
.gfo-table td.is-right {
  text-align: right;
}

.gfo-inv-num {
  font-weight: 600;
  color: var(--c-text);
  overflow-wrap: anywhere;
}

.gfo-ord-id,
.gfo-date-sub {
  font-size: 12px;
  color: var(--c-sec);
  overflow-wrap: anywhere;
}

.gfo-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  font-weight: 500;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--status-neutral-bg);
  color: var(--c-sec);
}

.gfo-status[data-tone="ok"] {
  background: var(--status-success-bg);
  color: var(--status-success);
}

.gfo-status[data-tone="warn"] {
  background: var(--status-warning-bg);
  color: var(--status-warning);
}

.gfo-curr-pill {
  font-size: 12px;
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--status-neutral-bg);
  color: var(--c-text);
}

.gfo-amount {
  font-weight: 600;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.gfo-btn-inspect {
  padding: 0 12px;
  font-size: 13px;
}

@media (max-width: 1024px) {
  .gfo-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .gfo-cell {
    border-bottom: 1px solid var(--c-border);
  }
}

@media (max-width: 680px) {
  .gfo-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .gfo-cell:last-child {
    grid-column: span 2;
    border-bottom: none;
  }
  .gfo-table thead {
    display: none;
  }
  .gfo-table,
  .gfo-table tbody,
  .gfo-table tr,
  .gfo-table td {
    display: block;
    width: 100%;
  }
  .gfo-row {
    padding: 12px 14px;
    border-bottom: 1px solid var(--c-border);
  }
  .gfo-table td {
    padding: 4px 0;
    border: none;
    text-align: left !important;
  }
  .gfo-btn-inspect {
    width: 100%;
    margin-top: 6px;
  }
}
</style>

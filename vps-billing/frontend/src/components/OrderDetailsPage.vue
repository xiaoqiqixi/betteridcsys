<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  api,
  ApiError,
  money,
  statusLabel,
  statusTone,
  type OrderDetails,
  type Invoice,
  type Order,
  type OrderPaymentAttempt,
} from "../lib/api";
import { tr, intlLocale } from "../lib/i18n";
import { auditActionLabel } from "../lib/audit";
const props = defineProps<{
  account: string;
  administrator: boolean;
  orderID: string;
  preview?: boolean;
  refreshKey?: number;
  busy?: boolean;
}>();
const emit = defineEmits<{
  "auth-expired": [];
  invoice: [Invoice];
  cancel: [Order];
  back: [];
  audit: [];
}>();
const detail = ref<OrderDetails>(),
  loading = ref(false),
  error = ref(""),
  requestID = ref("");
let generation = 0;
function read(value: unknown): OrderDetails {
  const d = value as OrderDetails;
  if (
    !d ||
    !d.order ||
    d.order.id !== props.orderID ||
    typeof d.order.number !== "string" ||
    !Number.isSafeInteger(d.order.total_minor) ||
    !Array.isArray(d.payment_attempts) ||
    d.payment_attempts.length > 100 ||
    !Array.isArray(d.audit) ||
    d.audit.length > 100 ||
    typeof d.audit_has_more !== "boolean" ||
    typeof d.payment_attempts_has_more !== "boolean" ||
    !(d.invoice === null || typeof d.invoice === "object") ||
    !(d.service === null || typeof d.service === "object")
  )
    throw Error("INVALID_ORDER_DETAILS");
  for (const p of d.payment_attempts)
    if (
      !p ||
      ![
        "id",
        "provider_id",
        "currency",
        "state",
        "created_at",
        "updated_at",
      ].every((k) => typeof p[k as keyof OrderPaymentAttempt] === "string") ||
      !Number.isSafeInteger(p.amount_minor) ||
      p.amount_minor < 1 ||
      !Number.isInteger(p.currency_decimal_places) ||
      p.currency_decimal_places < 0 ||
      p.currency_decimal_places > 6
    )
      throw Error("INVALID_PAYMENT_ATTEMPT");
  return { ...d, ...(!props.administrator ? { customer: undefined } : {}) };
}
async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  requestID.value = "";
  if (props.preview) {
    error.value = tr(
      "离线预览不读取订单详情。",
      "Order details require an online session.",
    );
    loading.value = false;
    return;
  }
  try {
    const value = read(
      await api<unknown>(
        (props.administrator ? "/admin/orders/" : "/orders/") +
          encodeURIComponent(props.orderID),
      ),
    );
    if (current === generation) detail.value = value;
  } catch (cause) {
    if (current !== generation) return;
    if (cause instanceof ApiError) {
      requestID.value = cause.requestId ?? "";
      if ([401, 403].includes(cause.status ?? 0)) {
        detail.value = undefined;
        emit("auth-expired");
      }
    }
    error.value =
      cause instanceof ApiError && cause.status === 404
        ? tr(
            "订单不存在或不属于当前账户。",
            "Order not found or unavailable to this account.",
          )
        : tr(
            "未能读取订单详情，请重试。已有内容可能不是最新状态。",
            "Order details could not be loaded. Retry; existing content may be stale.",
          );
  } finally {
    if (current === generation) loading.value = false;
  }
}
function at(value: string) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return (
    new Intl.DateTimeFormat(intlLocale(), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZone: "UTC",
    }).format(d) + " UTC"
  );
}
function attemptLabel(state: string) {
  const labels: Record<string, [string, string]> = {
    pending: ["正在准备支付", "Preparing checkout"],
    checkout: ["支付入口已创建", "Checkout prepared"],
    uncertain: ["结果未确认", "Unconfirmed"],
    settled: ["已结算", "Settled"],
  };
  return Object.hasOwn(labels, state) ? tr(...labels[state]!) : state;
}
function amount(p: OrderPaymentAttempt) {
  const n = BigInt(p.amount_minor),
    unit = 10n ** BigInt(p.currency_decimal_places);
  return (
    p.currency +
    " " +
    String(n / unit) +
    (p.currency_decimal_places
      ? "." + String(n % unit).padStart(p.currency_decimal_places, "0")
      : "")
  );
}
function clear() {
  generation++;
  detail.value = undefined;
  error.value = "";
  requestID.value = "";
  void load();
}
watch(() => [props.account, props.administrator, props.orderID], clear, {
  flush: "sync",
});
watch(() => props.refreshKey, load);
onMounted(load);
onBeforeUnmount(() => {
  generation++;
  detail.value = undefined;
});
</script>
<template>
  <section
    class="management-page"
    data-testid="order-details-page"
    :aria-busy="loading"
  >
    <div class="management-toolbar">
      <button class="button secondary" @click="emit('back')">
        {{ tr("返回订单列表", "Back to orders") }}</button
      ><button
        class="button secondary"
        :disabled="loading || busy"
        @click="load"
      >
        {{ tr("刷新详情", "Refresh details") }}
      </button>
    </div>
    <div v-if="error" role="alert" class="management-error">
      <p>{{ error }}</p>
      <code v-if="requestID">{{ requestID }}</code>
    </div>
    <p v-if="loading" role="status" class="management-help">
      {{
        detail
          ? tr(
              "正在刷新，以下为上次读取的记录。",
              "Refreshing; previously loaded records remain visible.",
            )
          : tr("正在读取订单详情…", "Loading order details…")
      }}
    </p>
    <template v-if="detail"
      ><section class="panel management-section">
        <div class="management-record-heading">
          <div>
            <h2>{{ detail.order.number }}</h2>
            <code>{{ detail.order.id }}</code>
          </div>
          <span class="badge" :class="statusTone(detail.order.status)">{{
            statusLabel(detail.order.status)
          }}</span>
        </div>
        <div class="management-amount">
          {{
            money(
              detail.order.total_minor,
              detail.order.currency,
              detail.order.currency_format,
            )
          }}
        </div>
        <p class="management-help">
          {{
            tr(
              "订单、账单、支付尝试与资源开通是不同事实，不可直接修改状态。",
              "Order, invoice, payment attempts and provisioning are distinct facts. Statuses cannot be edited directly.",
            )
          }}
        </p>
        <dl class="management-kv">
          <div>
            <dt>{{ tr("创建时间", "Created") }}</dt>
            <dd>{{ at(detail.order.created_at) }}</dd>
          </div>
          <div>
            <dt>{{ tr("成交币种", "Recorded currency") }}</dt>
            <dd>{{ detail.order.currency }}</dd>
          </div>
          <template v-if="administrator && detail.customer"
            ><div>
              <dt>{{ tr("客户", "Customer") }}</dt>
              <dd>
                {{ detail.customer.name }}<br />{{ detail.customer.email }}
              </dd>
            </div>
            <div>
              <dt>{{ tr("客户ID", "Customer ID") }}</dt>
              <dd>
                <code>{{ detail.customer.id }}</code>
              </dd>
            </div></template
          >
        </dl>
        <div class="management-actions">
          <button
            v-if="detail.invoice"
            class="button primary"
            :disabled="busy || loading"
            @click="emit('invoice', detail.invoice)"
          >
            {{ tr("查看关联账单", "View invoice") }}</button
          ><button
            v-if="detail.order.status === 'pending_payment' && !preview"
            class="button secondary"
            :disabled="busy || loading"
            @click="emit('cancel', detail.order)"
          >
            {{ tr("申请取消订单", "Cancel unpaid order") }}
          </button>
        </div>
        <p class="management-help">
          {{
            tr(
              "取消仅限可安全取消的未付订单。若存在未确认支付处理，服务器将拒绝；须先核对支付记录。",
              "Cancellation is limited to safely cancellable unpaid orders. Unconfirmed payment processing is rejected by the server; review payment records first.",
            )
          }}
        </p>
      </section>
      <section class="panel management-section">
        <h2>{{ tr("成交规格", "Purchased specifications") }}</h2>
        <strong>{{
          detail.order.plan_snapshot?.name || detail.order.plan_name
        }}</strong>
        <dl v-if="detail.order.plan_snapshot" class="management-kv">
          <div>
            <dt>{{ tr("地区", "Region") }}</dt>
            <dd>{{ detail.order.plan_snapshot.region }}</dd>
          </div>
          <div>
            <dt>{{ tr("规格", "Specifications") }}</dt>
            <dd>
              {{ detail.order.plan_snapshot.cpu }} vCPU ·
              {{ detail.order.plan_snapshot.memory_gb }} GB ·
              {{ detail.order.plan_snapshot.disk_gb }} GB ·
              {{ detail.order.plan_snapshot.transfer_tb }} TB
            </dd>
          </div>
          <div>
            <dt>{{ tr("计费周期", "Billing cycle") }}</dt>
            <dd>{{ tr("月付", "Monthly") }}</dd>
          </div>
          <div>
            <dt>{{ tr("原商品ID", "Original product ID") }}</dt>
            <dd>
              <code>{{ detail.order.plan_snapshot.plan_id }}</code>
            </dd>
          </div>
        </dl>
        <p v-else class="management-help">
          {{
            tr(
              "历史订单未保存成交规格，不使用当前商品资料补造。",
              "Purchased specifications were not recorded. Current product data is not substituted.",
            )
          }}
        </p>
      </section>
      <section class="panel management-section">
        <h2>{{ tr("关联账单与服务", "Invoice and service") }}</h2>
        <dl v-if="detail.invoice" class="management-kv">
          <div>
            <dt>{{ tr("账单", "Invoice") }}</dt>
            <dd>
              {{ detail.invoice.number }}<br /><code>{{
                detail.invoice.id
              }}</code>
            </dd>
          </div>
          <div>
            <dt>{{ tr("账单状态", "Invoice status") }}</dt>
            <dd>{{ statusLabel(detail.invoice.status) }}</dd>
          </div>
          <div>
            <dt>{{ tr("账单金额", "Invoice amount") }}</dt>
            <dd>
              {{
                money(
                  detail.invoice.amount_minor,
                  detail.invoice.currency,
                  detail.invoice.currency_format,
                )
              }}
            </dd>
          </div>
          <div>
            <dt>{{ tr("开具方快照", "Recorded issuer") }}</dt>
            <dd>
              {{ detail.invoice.issuer?.name || tr("未保存", "Not recorded") }}
            </dd>
          </div>
        </dl>
        <p v-else class="management-help">
          {{
            tr("没有精确关联的账单记录。", "No precisely associated invoice.")
          }}
        </p>
        <p v-if="detail.service" class="management-help">
          {{ detail.service.name }} · {{ statusLabel(detail.service.status)
          }}<br /><code>{{ detail.service.id }}</code>
        </p>
        <p v-else class="management-help">
          {{
            tr(
              "没有精确关联的服务记录。不按名称猜测，也不表示已开通资源。",
              "No precisely associated service. No name-based guessing or implied resource provisioning.",
            )
          }}
        </p>
      </section>
      <section class="panel management-section">
        <h2>{{ tr("支付处理记录", "Payment attempts") }}</h2>
        <p class="management-help">
          {{
            tr(
              "只读安全字段，不显示支付链接、幂等密钥或渠道交易标识。尝试状态本身不等于已入账。",
              "Safe read-only fields only: no checkout URLs, idempotency keys or provider transaction identifiers. Attempt state alone does not prove settlement.",
            )
          }}
        </p>
        <div
          v-for="attempt in detail.payment_attempts"
          :key="attempt.id"
          class="management-record"
        >
          <div class="management-record-heading">
            <strong>{{ amount(attempt) }}</strong>
            <div>
              <strong>{{ attemptLabel(attempt.state) }}</strong
              ><code>{{ attempt.state }}</code>
            </div>
          </div>
          <dl class="management-kv">
            <div>
              <dt>{{ tr("渠道", "Provider") }}</dt>
              <dd>{{ attempt.provider_id }}</dd>
            </div>
            <div>
              <dt>{{ tr("尝试ID", "Attempt ID") }}</dt>
              <dd>
                <code>{{ attempt.id }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ tr("创建", "Created") }}</dt>
              <dd>{{ at(attempt.created_at) }}</dd>
            </div>
            <div>
              <dt>{{ tr("更新", "Updated") }}</dt>
              <dd>{{ at(attempt.updated_at) }}</dd>
            </div>
          </dl>
        </div>
        <p v-if="!detail.payment_attempts.length" class="management-help">
          {{ tr("暂无关联支付尝试。", "No associated payment attempts.") }}
        </p>
        <p v-if="detail.payment_attempts_has_more" class="management-help">
          {{
            tr(
              "这里只显示最新100条尝试，仍有记录未显示。请核对服务端记录。",
              "Only the latest 100 attempts are shown. Additional records remain; review server records.",
            )
          }}
        </p>
      </section>
      <section class="panel management-section">
        <h2>{{ tr("订单相关操作", "Order-related activity") }}</h2>
        <div
          v-for="event in detail.audit"
          :key="event.id"
          class="management-record"
        >
          <div class="management-record-heading">
            <div>
              <strong>{{ auditActionLabel(event.action) }}</strong
              ><code>{{ event.action }}</code>
            </div>
            <span class="management-help">{{ at(event.created_at) }}</span>
          </div>
          <dl class="management-kv">
            <div>
              <dt>{{ tr("操作者", "Actor") }}</dt>
              <dd>{{ event.actor_email }}</dd>
            </div>
            <div>
              <dt>{{ tr("目标", "Target") }}</dt>
              <dd>
                <code>{{ event.target }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ tr("事件ID", "Event ID") }}</dt>
              <dd>
                <code>{{ event.id }}</code>
              </dd>
            </div>
          </dl>
          <details>
            <summary>{{ tr("查看详情", "View details") }}</summary>
            <p
              style="
                white-space: pre-wrap;
                overflow-wrap: anywhere;
                margin-top: 14px;
              "
            >
              {{ event.detail }}
            </p>
          </details>
        </div>
        <p v-if="!detail.audit.length" class="management-help">
          {{ tr("暂无关联业务操作记录。", "No associated business activity.") }}
        </p>
        <p v-if="detail.audit_has_more" class="management-help">
          {{
            tr(
              "这里只显示最新100条记录，仍有历史未显示。",
              "Only the latest 100 records are shown; older records remain.",
            )
          }}
        </p>
        <button class="button secondary" @click="emit('audit')">
          {{ tr("打开操作记录查询", "Open activity query") }}
        </button>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ArrowRight, ChevronDown, Server, ReceiptText } from "@lucide/vue";
import { money, date, statusLabel, statusTone } from "../lib/api";
import type { Overview, Service, Order, Invoice } from "../lib/api";
import { tr } from "../lib/i18n";

const props = defineProps<{
  overview?: Overview;
  services: Service[];
  orders: Order[];
  unpaid: Invoice[];
  currency: string;
}>();
const emit = defineEmits<{
  navigate: [page: string];
  invoice: [invoice: Invoice];
}>();
const monthlyAmount = computed(() =>
  money(
    props.overview?.monthly_total_minor ?? 0,
    props.overview?.currency,
    props.overview?.currency_format,
  ),
);
const currencyServices = computed(() =>
  props.services.filter((service) => service.currency === props.currency),
);
</script>

<template>
  <div class="customer-overview">
    <section
      class="account-facts"
      :aria-label="tr('账户概况', 'Account overview')"
    >
      <div>
        <span>{{ tr("运行中的服务", "Active services") }}</span>
        <p>
          {{ overview?.active_services ?? "—"
          }}<small>{{ tr("台", "servers") }}</small>
        </p>
      </div>
      <div>
        <span>{{ tr("每月服务费用", "Monthly service cost") }}</span>
        <p :class="{ 'long-amount': monthlyAmount.length > 16 }">
          {{ monthlyAmount }}<small>{{ tr("/ 月", "/ month") }}</small>
        </p>
      </div>
      <div>
        <span>{{ tr("待付款账单", "Unpaid invoices") }}</span>
        <p>
          {{ overview?.pending_invoices ?? "—"
          }}<small>{{ tr("笔", "invoices") }}</small>
        </p>
      </div>
      <p class="account-scope">
        {{ tr("以上按所选币种统计", "Totals in selected currency") }}
        <b>{{ currency }}</b>
      </p>
    </section>

    <div class="customer-workspace" :class="{ 'has-invoice': unpaid.length }">
      <div class="customer-records">
        <section
          class="customer-services"
          aria-labelledby="customer-services-title"
        >
          <header class="customer-section-heading">
            <h2 id="customer-services-title">
              {{ tr("我的云服务器", "My cloud servers") }}
            </h2>
            <button class="text-button" @click="emit('navigate', 'services')">
              {{ tr("全部服务", "All services") }}<ArrowRight :size="16" />
            </button>
          </header>
          <div v-if="services.length" class="customer-service-list">
            <div class="customer-service-columns" aria-hidden="true">
              <span>{{ tr("服务 / 区域", "Service / region") }}</span>
              <span>{{ tr("状态", "Status") }}</span>
              <span>{{ tr("月费 / 续费日期", "Monthly cost / renewal") }}</span>
            </div>
            <article
              v-for="service in services.slice(0, 3)"
              :key="service.id"
              class="customer-service-row"
            >
              <div class="customer-service-identity">
                <span class="customer-server-icon"
                  ><Server :size="22" :stroke-width="1.5" aria-hidden="true"
                /></span>
                <div>
                  <h3>{{ service.name }}</h3>
                  <p>
                    {{ service.region }}<span> · </span>{{ service.plan_name }}
                  </p>
                </div>
              </div>
              <span class="badge" :class="statusTone(service.status)">{{
                statusLabel(service.status)
              }}</span>
              <div class="customer-service-price">
                <strong>{{
                  money(
                    service.price_minor,
                    service.currency,
                    service.currency_format,
                  )
                }}</strong
                ><span
                  ><span class="customer-renewal-label"
                    >{{ tr("续费", "Renews") }} </span
                  >{{ date(service.next_due_at) }}</span
                >
              </div>
            </article>
            <p class="customer-section-note">
              {{
                tr(
                  "服务状态来自账务记录，不代表实时节点健康状态。",
                  "Service status reflects billing records, not live infrastructure health.",
                )
              }}
            </p>
          </div>
          <div v-else class="customer-empty">
            <Server :size="30" :stroke-width="1.4" aria-hidden="true" />
            <h3>{{ tr("还没有云服务器", "No cloud servers yet") }}</h3>
            <p>
              {{
                tr(
                  "选择配置，核对价格后创建你的第一笔订单。",
                  "Choose a plan and review the price to create your first order.",
                )
              }}
            </p>
            <button class="button secondary" @click="emit('navigate', 'plans')">
              {{ tr("选购套餐", "Choose a plan") }}<ArrowRight :size="16" />
            </button>
          </div>
        </section>

        <section
          class="customer-orders"
          aria-labelledby="customer-orders-title"
        >
          <header class="customer-section-heading">
            <h2 id="customer-orders-title">
              {{ tr("最近订单", "Recent orders") }}
            </h2>
            <button class="text-button" @click="emit('navigate', 'orders')">
              {{ tr("全部订单", "All orders") }}<ArrowRight :size="16" />
            </button>
          </header>
          <div v-if="orders.length" class="customer-order-list">
            <article
              v-for="order in orders.slice(0, 4)"
              :key="order.id"
              class="customer-order-row"
            >
              <div>
                <h3>{{ order.plan_name }}</h3>
                <p class="mono">{{ order.number }}</p>
              </div>
              <span class="customer-order-date">{{
                date(order.created_at)
              }}</span>
              <strong>{{
                money(order.total_minor, order.currency, order.currency_format)
              }}</strong>
              <span class="badge" :class="statusTone(order.status)">{{
                statusLabel(order.status)
              }}</span>
            </article>
          </div>
          <div v-else class="customer-order-empty">
            {{
              tr(
                "暂无订单记录。创建订单后，可在这里查看进度。",
                "No orders yet. New orders and their status will appear here.",
              )
            }}
          </div>
        </section>
      </div>

      <aside class="customer-billing" aria-labelledby="customer-billing-title">
        <header class="customer-section-heading">
          <h2 id="customer-billing-title">
            {{ tr("待处理账单", "Invoices to review") }}
          </h2>
          <ReceiptText :size="19" :stroke-width="1.5" aria-hidden="true" />
        </header>
        <template v-if="unpaid.length">
          <article
            v-for="invoice in unpaid.slice(0, 2)"
            :key="invoice.id"
            class="customer-invoice"
          >
            <span class="badge" :class="statusTone(invoice.status)">{{
              statusLabel(invoice.status)
            }}</span>
            <p
              class="customer-invoice-amount"
              :class="{
                'long-amount':
                  money(
                    invoice.amount_minor,
                    invoice.currency,
                    invoice.currency_format,
                  ).length > 16,
              }"
            >
              {{
                money(
                  invoice.amount_minor,
                  invoice.currency,
                  invoice.currency_format,
                )
              }}
            </p>
            <p class="mono">{{ invoice.number }}</p>
            <p class="customer-invoice-due">
              {{ tr("到期日期", "Due date")
              }}<span>{{ date(invoice.due_at) }}</span>
            </p>
            <button
              class="button secondary full"
              @click="emit('invoice', invoice)"
            >
              {{ tr("查看账单", "View invoice") }}<ArrowRight :size="16" />
            </button>
          </article>
          <p class="customer-section-note">
            {{
              tr(
                "已有付款请先核对原渠道，刷新后确认账单状态。",
                "Already paid? Check the original provider and refresh the invoice status.",
              )
            }}
          </p>
        </template>
        <div v-else class="customer-invoice-clear">
          <p>{{ tr("没有待付款账单", "No unpaid invoices") }}</p>
          <span>{{
            tr(
              "账单与付款记录都可在账单列表中查看。",
              "View past invoices and payments in your invoice list.",
            )
          }}</span>
        </div>
        <button
          class="text-button customer-all-invoices"
          @click="emit('navigate', 'invoices')"
        >
          {{ tr("全部账单", "All invoices") }}<ArrowRight :size="16" />
        </button>
        <details class="customer-cost-details">
          <summary>
            {{ tr("每月费用明细", "Monthly cost details")
            }}<ChevronDown :size="16" aria-hidden="true" />
          </summary>
          <div
            v-for="service in currencyServices.slice(0, 4)"
            :key="service.id"
            class="customer-cost-item"
          >
            <span>{{ service.name }}</span
            ><strong>{{
              money(
                service.price_minor,
                service.currency,
                service.currency_format,
              )
            }}</strong>
          </div>
          <p v-if="!currencyServices.length" class="customer-section-note">
            {{
              tr("此币种暂无服务费用。", "No service costs in this currency.")
            }}
          </p>
          <p class="customer-section-note">
            {{
              tr(
                "仅列出所选币种的服务费用，不折算其他币种。",
                "Services in the selected currency only. No currency conversion.",
              )
            }}
          </p>
        </details>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.account-facts {
  display: grid;
  grid-template-columns: minmax(0, 0.75fr) minmax(0, 1.2fr) minmax(0, 0.75fr);
  gap: 24px;
  padding: 28px 0 18px;
  margin-bottom: 40px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.account-facts > div {
  min-width: 0;
}
.account-facts > div > span {
  font-size: 14px;
  color: var(--text-secondary);
}
.account-facts > div > p {
  margin-top: 8px;
  font-size: clamp(26px, 2.4vw, 34px);
  font-weight: 600;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.account-facts small {
  font-size: 14px;
  color: var(--text-secondary);
  font-weight: 400;
  margin-left: 8px;
  white-space: nowrap;
}
.account-scope {
  grid-column: 1 / -1;
  font-size: 13px;
  color: var(--text-secondary);
}
.account-scope b {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 500;
}
.customer-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 296px);
  gap: 36px;
  align-items: start;
}
.customer-records {
  min-width: 0;
}
.customer-section-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
}
.customer-section-heading h2 {
  font-size: 18px;
  line-height: 1.5;
  font-weight: 600;
}
.customer-section-heading > svg {
  color: var(--text-secondary);
}
.customer-service-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 96px minmax(120px, 0.5fr);
  gap: 16px;
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 13px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.customer-service-columns > :last-child {
  text-align: right;
}
.customer-service-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 96px minmax(120px, 0.5fr);
  gap: 16px;
  align-items: center;
  padding: 22px 0;
  border-bottom: 1px solid var(--border);
}
.customer-service-identity {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.customer-server-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.customer-service-identity h3 {
  font-size: 15px;
  font-weight: 550;
  overflow-wrap: anywhere;
}
.customer-service-identity p {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
  overflow-wrap: anywhere;
}
.customer-service-row > .badge {
  justify-self: start;
}
.customer-service-price {
  display: grid;
  gap: 5px;
  text-align: right;
  min-width: 0;
  font-variant-numeric: tabular-nums;
}
.customer-service-price strong {
  font-size: 15px;
  overflow-wrap: anywhere;
}
.customer-renewal-label {
  display: none;
}
.customer-service-price > span {
  font-size: 13px;
  color: var(--text-secondary);
}
.customer-section-note {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.8;
  padding-top: 16px;
}
.customer-orders {
  margin-top: 42px;
}
.customer-order-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 94px minmax(90px, 0.5fr) auto;
  gap: 16px;
  align-items: center;
  padding: 18px 0;
  border-top: 1px solid var(--border);
}
.customer-order-row h3 {
  font-size: 15px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.customer-order-row .mono {
  font-size: 12px;
  margin-top: 5px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.customer-order-date {
  color: var(--text-secondary);
  font-size: 13px;
}
.customer-order-row > strong {
  font-size: 15px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.customer-billing {
  background: var(--surface-subtle);
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: 12px;
  min-width: 0;
}
.customer-billing .customer-section-heading {
  margin-bottom: 20px;
}
.customer-invoice + .customer-invoice {
  margin-top: 24px;
  border-top: 1px solid var(--border);
  padding-top: 24px;
}
.customer-invoice-amount {
  margin: 12px 0 4px;
  font-size: 28px;
  line-height: 1.4;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.customer-invoice > .mono {
  font-size: 12px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.customer-invoice-due {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  flex-wrap: wrap;
  color: var(--text-secondary);
  font-size: 13px;
  margin: 20px 0 16px;
}
.customer-invoice-due span {
  color: var(--text-primary);
}
.customer-all-invoices {
  margin-top: 16px;
}
.customer-cost-details {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
}
.customer-cost-details summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  font-size: 14px;
  min-height: 32px;
  list-style: none;
}
.customer-cost-details summary::-webkit-details-marker {
  display: none;
}
.customer-cost-details[open] summary svg {
  transform: rotate(180deg);
}
.customer-cost-item {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 14px;
  font-size: 13px;
  margin-top: 16px;
}
.customer-cost-item span {
  overflow-wrap: anywhere;
  min-width: 0;
  color: var(--text-secondary);
}
.customer-cost-item strong {
  font-weight: 500;
  text-align: right;
  overflow-wrap: anywhere;
  min-width: 0;
}
.customer-invoice-clear p {
  font-size: 16px;
  margin: 24px 0 8px;
}
.customer-invoice-clear span {
  color: var(--text-secondary);
  font-size: 14px;
}
.customer-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
  padding: 36px 0;
  border-top: 1px solid var(--border);
}
.customer-empty > svg,
.customer-empty p {
  color: var(--text-secondary);
}
.customer-empty h3 {
  font-size: 18px;
}
.customer-empty p,
.customer-order-empty {
  font-size: 14px;
  color: var(--text-secondary);
}
.customer-order-empty {
  border-top: 1px solid var(--border);
  padding: 24px 0;
}
@media (max-width: 1200px) {
  .customer-workspace {
    gap: 24px;
    grid-template-columns: minmax(0, 1fr) 270px;
  }
  .customer-service-columns {
    display: none;
  }
  .customer-renewal-label {
    display: inline;
  }
  .customer-service-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
  }
  .customer-service-identity {
    grid-column: 1;
  }
  .customer-service-row > .badge {
    grid-column: 2;
    grid-row: 1;
    justify-self: end;
  }
  .customer-service-price {
    grid-column: 1 / -1;
    display: flex;
    justify-content: space-between;
    padding-left: 56px;
    text-align: left;
  }
  .customer-order-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
  }
  .customer-order-row > strong {
    grid-column: 2;
    grid-row: 1;
  }
  .customer-order-date {
    grid-column: 1;
    grid-row: 2;
  }
  .customer-order-row > .badge {
    grid-column: 2;
    grid-row: 2;
    justify-self: end;
  }
}
@media (max-width: 980px) {
  .customer-workspace {
    grid-template-columns: minmax(0, 1fr);
    gap: 32px;
  }
  .customer-billing {
    max-width: none;
  }
  .has-invoice .customer-billing {
    grid-row: 1;
  }
  .customer-invoice {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 24px;
    align-items: center;
  }
  .customer-invoice > .badge {
    justify-self: start;
  }
  .customer-invoice > .button {
    grid-column: 2;
    grid-row: 2 / 4;
  }
  .customer-invoice-amount,
  .customer-invoice > .mono {
    grid-column: 1;
  }
  .customer-invoice-due {
    grid-column: 2;
    grid-row: 1;
    margin: 0;
  }
}
@media (max-width: 720px) {
  .account-facts {
    grid-template-columns: 1fr 1fr;
    gap: 24px 16px;
    padding: 24px 0 18px;
    margin-bottom: 32px;
  }
  .account-facts > div:nth-child(2) {
    grid-column: 1 / -1;
    grid-row: 1;
  }
  .account-facts > div > p {
    font-size: 30px;
  }
  .account-facts > div:nth-child(2) > p {
    font-size: 38px;
  }
  .account-facts > div > span,
  .account-facts small {
    font-size: 14px;
  }
  .customer-section-heading {
    margin-bottom: 18px;
  }
  .customer-service-identity {
    gap: 12px;
  }
  .customer-server-icon {
    width: 36px;
    height: 40px;
  }
  .customer-service-identity h3 {
    font-size: 16px;
  }
  .customer-service-identity p {
    font-size: 13px;
  }
  .customer-service-price {
    padding-left: 48px;
    flex-wrap: wrap;
    gap: 8px;
  }
  .customer-order-row {
    padding: 18px 0;
  }
  .customer-orders {
    margin-top: 32px;
  }
  .customer-billing {
    padding: 24px 20px;
  }
  .customer-invoice {
    display: block;
  }
  .customer-invoice-due {
    margin: 16px 0;
  }
  .customer-invoice-amount {
    font-size: 30px;
  }
  .customer-overview .text-button {
    min-height: 44px;
    font-size: 14px;
  }
}
/* Preserve the whole financial value at a readable size before allowing reflow. */
.account-facts > div > p.long-amount {
  font-size: 24px;
}
.customer-invoice-amount.long-amount {
  font-size: 22px;
}
</style>

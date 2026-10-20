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
              <strong
                :class="{
                  'long-amount':
                    money(
                      order.total_minor,
                      order.currency,
                      order.currency_format,
                    ).length > 16,
                }"
                >{{
                  money(
                    order.total_minor,
                    order.currency,
                    order.currency_format,
                  )
                }}</strong
              >
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
          <p
            v-if="currencyServices.length > 4"
            class="customer-section-note customer-cost-scope"
          >
            {{
              tr(
                "仅显示前 4 项服务费用。",
                "Showing the first 4 service costs.",
              )
            }}
            <button class="text-button" @click="emit('navigate', 'services')">
              {{ tr("查看全部服务", "View all services")
              }}<ArrowRight :size="16" />
            </button>
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
.customer-overview {
  min-width: 0;
}
.account-facts {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 14px 28px;
  padding: 24px 28px;
  margin-bottom: 24px;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--surface);
  box-shadow: var(--panel-shadow);
}
.account-facts > div {
  min-width: 0;
}
.account-facts > div:nth-child(2) {
  padding-inline: 28px;
  border-inline: 1px solid var(--border);
}
.account-facts > div > span {
  font-size: 14px;
  color: var(--text-secondary);
}
.account-facts > div > p {
  margin-top: 7px;
  font-size: 26px;
  font-weight: 600;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.account-facts > div:nth-child(2) > p {
  font-size: 30px;
}
.account-facts small {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 400;
  margin-left: 7px;
  white-space: nowrap;
}
.account-scope {
  grid-column: 1 / -1;
  font-size: 12px;
  color: var(--text-secondary);
}
.account-scope b {
  margin-left: 6px;
  font-weight: 500;
}
.customer-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(270px, 300px);
  gap: 24px;
  align-items: start;
}
.customer-records {
  min-width: 0;
}
.customer-services,
.customer-orders,
.customer-billing {
  min-width: 0;
  padding: 26px 28px;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--surface);
  box-shadow: var(--panel-shadow);
}
.customer-section-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 22px;
}
.customer-section-heading h2 {
  font-size: 19px;
  line-height: 1.4;
  font-weight: 600;
}
.customer-section-heading > svg {
  color: var(--text-secondary);
}
.customer-service-columns {
  display: none;
}
.customer-service-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(110px, 0.5fr);
  gap: 18px;
  align-items: center;
  padding: 20px 0;
  border-bottom: 1px solid var(--border);
}
.customer-service-row:first-of-type {
  padding-top: 4px;
}
.customer-service-identity {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.customer-service-identity > div {
  min-width: 0;
}
.customer-server-icon {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: var(--text-secondary);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 13px;
}
.customer-service-identity h3 {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
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
  font-weight: 600;
  overflow-wrap: anywhere;
}
.customer-renewal-label {
  display: none;
}
.customer-service-price > span {
  font-size: 12px;
  color: var(--text-secondary);
}
.customer-section-note {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.8;
  padding-top: 16px;
}
.customer-orders {
  margin-top: 24px;
}
.customer-orders .customer-section-heading {
  margin-bottom: 12px;
}
.customer-order-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 88px minmax(80px, 0.5fr) auto;
  gap: 14px;
  align-items: center;
  padding: 18px 0;
  border-top: 1px solid var(--border);
}
.customer-order-row:last-child {
  padding-bottom: 0;
}
.customer-order-row h3 {
  font-size: 15px;
  font-weight: 550;
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
  font-size: 12px;
}
.customer-order-row > strong {
  font-size: 15px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.customer-billing {
  padding: 26px 24px;
}
.customer-billing .customer-section-heading {
  margin-bottom: 24px;
}
.customer-invoice + .customer-invoice {
  margin-top: 24px;
  border-top: 1px solid var(--border);
  padding-top: 24px;
}
.customer-invoice-amount {
  margin: 14px 0 6px;
  font-size: 30px;
  line-height: 1.3;
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
  margin: 22px 0 18px;
}
.customer-invoice-due span {
  color: var(--text-primary);
}
.customer-invoice .button {
  background: var(--surface-subtle);
}
.customer-all-invoices {
  margin-top: 18px;
}
.customer-cost-details {
  margin-top: 22px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.customer-cost-details summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  font-size: 14px;
  min-height: 44px;
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
  font-weight: 550;
  margin: 26px 0 8px;
}
.customer-invoice-clear span {
  color: var(--text-secondary);
  font-size: 14px;
}
.customer-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 14px;
  padding: 32px 16px;
}
.customer-empty > svg {
  box-sizing: content-box;
  padding: 16px;
  border-radius: 20px;
  background: var(--surface-subtle);
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.customer-empty h3 {
  font-size: 19px;
  font-weight: 600;
}
.customer-empty p,
.customer-order-empty {
  font-size: 14px;
  color: var(--text-secondary);
}
.customer-empty p {
  max-width: 360px;
}
.customer-empty .button {
  margin-top: 6px;
}
.customer-order-empty {
  border-top: 1px solid var(--border);
  padding: 22px 0 4px;
}
@media (max-width: 1200px) {
  .customer-workspace {
    grid-template-columns: minmax(0, 1fr) 270px;
    gap: 20px;
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
    padding-left: 58px;
    text-align: left;
  }
  .customer-renewal-label {
    display: inline;
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
  .customer-order-row:has(> strong.long-amount) > div {
    grid-column: 1 / -1;
  }
  .customer-order-row > strong.long-amount {
    grid-column: 1 / -1;
    grid-row: 2;
    text-align: left;
  }
  .customer-order-row:has(> strong.long-amount) > .customer-order-date,
  .customer-order-row:has(> strong.long-amount) > .badge {
    grid-row: 3;
  }
}
@media (max-width: 980px) {
  .customer-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .has-invoice .customer-billing {
    grid-row: 1;
  }
  .customer-invoice {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
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
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 20px 16px;
    padding: 22px 20px;
  }
  .account-facts > div:nth-child(2) {
    grid-column: 1 / -1;
    grid-row: 1;
    padding: 0 0 18px;
    border: 0;
    border-bottom: 1px solid var(--border);
  }
  .account-facts > div > p {
    font-size: 26px;
  }
  .account-facts > div:nth-child(2) > p {
    font-size: 32px;
  }
  .customer-services,
  .customer-orders,
  .customer-billing {
    padding: 22px 20px;
    border-radius: 18px;
  }
  .customer-section-heading {
    margin-bottom: 20px;
  }
  .customer-section-heading h2 {
    font-size: 18px;
  }
  .customer-service-identity {
    gap: 12px;
  }
  .customer-server-icon {
    width: 38px;
    height: 42px;
    border-radius: 12px;
  }
  .customer-service-price {
    padding-left: 50px;
    flex-wrap: wrap;
    gap: 8px;
  }
  .customer-invoice {
    display: block;
  }
  .customer-invoice-due {
    margin: 18px 0;
  }
  .customer-overview .text-button {
    min-height: 44px;
    font-size: 14px;
  }
}
.account-facts > div > p.long-amount {
  font-size: 22px;
}
.customer-invoice-amount.long-amount {
  font-size: 22px;
}
</style>

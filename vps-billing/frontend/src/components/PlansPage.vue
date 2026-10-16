<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  ArrowRight,
  Check,
  Globe2,
  Layers,
  LoaderCircle,
  Server,
} from "@lucide/vue";
import { money, readOrderQuote, type Plan } from "../lib/api";
import { tr, type Currency } from "../lib/i18n";

const props = defineProps<{
  plans: Plan[];
  currency: Currency;
  loading: boolean;
  saving: boolean;
  preview: boolean;
  demo: boolean;
  pendingPlan?: Plan;
}>();
const emit = defineEmits<{ review: [plan: Plan] }>();
const region = ref<string | null>(null);
const selectedId = ref("");
const regions = computed(() => [
  ...new Set(props.plans.map((plan) => plan.region)),
]);
const visiblePlans = computed(() =>
  props.plans.filter(
    (plan) => region.value === null || plan.region === region.value,
  ),
);
const available = (plan: Plan) => {
  if (!plan.available || plan.currency !== props.currency) return false;
  try {
    readOrderQuote(plan);
    return true;
  } catch {
    return false;
  }
};
const selected = computed(() =>
  visiblePlans.value.find(
    (plan) => plan.id === selectedId.value && available(plan),
  ),
);
const summary = computed(
  () => props.pendingPlan || (!props.loading ? selected.value : undefined),
);
const blocked = computed(() => props.loading || props.saving);

watch(
  [() => props.plans, () => props.currency, region],
  () => {
    if (props.loading && !props.plans.length) return;
    if (region.value !== null && !regions.value.includes(region.value))
      region.value = null;
    if (!selected.value)
      selectedId.value = visiblePlans.value.find(available)?.id || "";
  },
  { immediate: true },
);

function selectPlan(plan: Plan) {
  if (!blocked.value && !props.pendingPlan && available(plan))
    selectedId.value = plan.id;
}
function review() {
  if (
    !blocked.value &&
    summary.value &&
    (props.pendingPlan || available(summary.value))
  )
    emit("review", summary.value);
}
</script>

<template>
  <section
    class="purchase-page"
    :aria-label="tr('选购云服务器', 'Choose a cloud server')"
    :aria-busy="loading"
  >
    <div class="purchase-layout">
      <div class="purchase-catalog">
        <section class="region-panel" aria-labelledby="region-title">
          <div class="purchase-section-heading">
            <h2 id="region-title">{{ tr("选择区域", "Choose a region") }}</h2>
          </div>
          <div
            class="region-options"
            role="group"
            :aria-label="tr('区域筛选', 'Filter by region')"
          >
            <button
              type="button"
              :aria-pressed="region === null"
              :disabled="blocked || !!pendingPlan"
              @click="region = null"
            >
              {{ tr("全部区域", "All regions") }}
            </button>
            <button
              v-for="item in regions"
              :key="item"
              type="button"
              :aria-pressed="region === item"
              :disabled="blocked || !!pendingPlan"
              @click="region = item"
            >
              <Globe2 :size="15" aria-hidden="true" />{{ item }}
            </button>
          </div>
          <span class="purchase-billing">
            {{ tr("按月计费", "Monthly billing") }} · {{ currency }}
            <template v-if="demo">
              · {{ tr("演示定价", "Demo prices") }}</template
            >
          </span>
        </section>

        <section aria-labelledby="plan-title">
          <div class="purchase-section-heading purchase-plan-heading">
            <h2 id="plan-title">{{ tr("选择套餐", "Choose a plan") }}</h2>
            <span v-if="!loading" class="catalog-count">{{
              tr(
                `${visiblePlans.length} 个套餐`,
                `${visiblePlans.length} plans`,
              )
            }}</span>
          </div>
          <div v-if="loading" class="catalog-state" role="status">
            <LoaderCircle :size="22" class="spin" aria-hidden="true" />
            <p>{{ tr("正在更新套餐与价格…", "Updating plans and prices…") }}</p>
          </div>
          <div v-else-if="!visiblePlans.length" class="catalog-state">
            <Layers :size="28" aria-hidden="true" />
            <h3>{{ tr("暂无可用方案", "No plans available") }}</h3>
            <p>
              {{
                tr(
                  "服务提供方还未发布套餐。",
                  "Your provider has not published plans for this currency.",
                )
              }}
            </p>
          </div>
          <div
            v-else
            class="catalog-plans"
            role="group"
            :aria-label="tr('可选套餐', 'Plan selection')"
          >
            <article
              v-for="plan in visiblePlans"
              :key="plan.id"
              class="catalog-plan"
              :class="{
                selected: selected?.id === plan.id,
                unavailable: !available(plan),
              }"
            >
              <div class="catalog-plan-heading">
                <div>
                  <h3>{{ plan.name }}</h3>
                  <p class="catalog-region">
                    <Globe2 :size="13" aria-hidden="true" />{{ plan.region }}
                  </p>
                  <p v-if="plan.description" class="catalog-description">
                    {{ plan.description }}
                  </p>
                  <span v-if="!available(plan)" class="catalog-availability">{{
                    tr("暂不可售", "Unavailable")
                  }}</span>
                </div>
              </div>
              <dl class="catalog-specs">
                <div>
                  <dt>{{ tr("计算核心", "CPU cores") }}</dt>
                  <dd>{{ plan.cpu }} <small>vCPU</small></dd>
                </div>
                <div>
                  <dt>{{ tr("内存", "Memory") }}</dt>
                  <dd>{{ plan.memory_gb }} <small>GB</small></dd>
                </div>
                <div>
                  <dt>{{ tr("存储", "Storage") }}</dt>
                  <dd>{{ plan.disk_gb }} <small>GB</small></dd>
                </div>
                <div>
                  <dt>{{ tr("月流量", "Monthly transfer") }}</dt>
                  <dd>{{ plan.transfer_tb }} <small>TB</small></dd>
                </div>
              </dl>
              <div class="catalog-plan-footer">
                <div class="plan-price">
                  {{
                    available(plan)
                      ? money(
                          plan.price_minor,
                          plan.currency,
                          plan.currency_format,
                        )
                      : tr("暂不可售", "Unavailable")
                  }}<span v-if="available(plan)">{{
                    tr("/ 月", "/ month")
                  }}</span>
                </div>
                <button
                  type="button"
                  class="button secondary plan-select"
                  :aria-label="
                    tr(`选择套餐 ${plan.name}`, `Select plan ${plan.name}`)
                  "
                  :aria-pressed="selected?.id === plan.id"
                  :disabled="!available(plan) || blocked || !!pendingPlan"
                  @click="selectPlan(plan)"
                >
                  <Check
                    v-if="selected?.id === plan.id"
                    :size="16"
                    aria-hidden="true"
                  />{{
                    selected?.id === plan.id
                      ? tr("已选择", "Selected")
                      : tr("选择此方案", "Choose this plan")
                  }}
                </button>
              </div>
            </article>
          </div>
        </section>
      </div>

      <aside class="purchase-summary" aria-labelledby="purchase-summary-title">
        <div class="purchase-section-heading">
          <Server :size="19" aria-hidden="true" />
          <h2 id="purchase-summary-title">
            {{ tr("订单摘要", "Order summary") }}
          </h2>
        </div>
        <div
          class="purchase-summary-content"
          aria-live="polite"
          aria-atomic="true"
        >
          <p v-if="pendingPlan" class="purchase-pending">
            {{
              tr(
                "有一笔订单结果待确认。请先核对原订单，以下保留原配置与币种。",
                "An order is still unconfirmed. Resolve the original order first; its configuration and currency are shown below.",
              )
            }}
          </p>
          <template v-if="summary">
            <h3>{{ summary.name }}</h3>
            <p class="summary-region">
              <Globe2 :size="14" aria-hidden="true" />{{ summary.region }}
            </p>
            <dl class="purchase-summary-specs">
              <div>
                <dt>{{ tr("计算核心", "CPU cores") }}</dt>
                <dd>{{ summary.cpu }} vCPU</dd>
              </div>
              <div>
                <dt>{{ tr("内存", "Memory") }}</dt>
                <dd>{{ summary.memory_gb }} GB</dd>
              </div>
              <div>
                <dt>{{ tr("存储", "Storage") }}</dt>
                <dd>{{ summary.disk_gb }} GB</dd>
              </div>
              <div>
                <dt>{{ tr("月流量", "Monthly transfer") }}</dt>
                <dd>{{ summary.transfer_tb }} TB</dd>
              </div>
              <div>
                <dt>{{ tr("计费周期", "Billing cycle") }}</dt>
                <dd>{{ tr("每月", "Monthly") }}</dd>
              </div>
            </dl>
          </template>
          <p v-else class="summary-empty">
            {{
              loading
                ? tr(
                    "套餐价格更新后可继续。",
                    "Continue when plan prices have updated.",
                  )
                : tr(
                    "请选择一个当前币种可售的套餐。",
                    "Select a plan available in this currency.",
                  )
            }}
          </p>
        </div>
        <div class="purchase-checkout">
          <div v-if="summary" class="purchase-total" aria-live="polite">
            <span>{{ tr("首期订单金额", "Initial order amount") }}</span>
            <strong
              :class="{
                'long-total':
                  money(
                    summary.price_minor,
                    summary.currency,
                    summary.currency_format,
                  ).length > 16,
              }"
              >{{
                money(
                  summary.price_minor,
                  summary.currency,
                  summary.currency_format,
                )
              }}</strong
            >
          </div>
          <button
            type="button"
            class="button primary full purchase-review"
            :disabled="blocked || !summary"
            @click="review"
          >
            {{
              pendingPlan
                ? tr("核对原订单", "Review original order")
                : preview
                  ? tr("预览订单配置", "Preview order details")
                  : tr("确认配置", "Review order")
            }}<ArrowRight :size="17" aria-hidden="true" />
          </button>
        </div>
        <p class="purchase-price-note">
          {{
            tr(
              "下一步填写服务器名称并确认，价格由服务端在下单时核验。",
              "Next, enter a server name and confirm. The server verifies the price when creating the order.",
            )
          }}
        </p>
        <div class="purchase-boundary">
          <span>{{
            preview
              ? tr("只读预览", "Read-only preview")
              : tr("仅创建待付款订单", "Creates an unpaid order only")
          }}</span>
          <p>
            {{
              preview
                ? tr(
                    "样例配置可预览，不能创建订单。",
                    "You can preview sample configurations. Orders cannot be created.",
                  )
                : tr(
                    "创建订单本身不发起扣款，也不会自动开通服务。",
                    "Creating an order does not itself initiate a charge or automatically activate a service.",
                  )
            }}
          </p>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.purchase-page,
.purchase-catalog {
  min-width: 0;
}
.purchase-billing {
  margin-left: auto;
  color: var(--text-secondary);
  font-size: 14px;
}
.purchase-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  align-items: start;
  gap: 32px;
}
.purchase-section-heading {
  display: flex;
  align-items: center;
  gap: 8px;
}
.purchase-section-heading h2 {
  font-size: 18px;
  font-weight: 600;
}
.region-panel {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 20px;
  padding-bottom: 24px;
  margin-bottom: 28px;
  border-bottom: 1px solid var(--border);
}
.region-panel h2 {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}
.region-options {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.region-options button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  max-width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.5;
  text-align: left;
  overflow-wrap: anywhere;
}
.region-options button:hover:not(:disabled) {
  background: var(--surface-subtle);
}
.region-options button[aria-pressed="true"] {
  background: var(--theme-soft);
  color: var(--brand-ink);
  border-color: var(--blue);
}
.purchase-plan-heading {
  justify-content: space-between;
  margin-bottom: 16px;
}
.catalog-count {
  color: var(--text-secondary);
  font-size: 14px;
}
.catalog-plans {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}
.catalog-plan {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(200px, 1.4fr) minmax(
      132px,
      0.9fr
    );
  align-items: center;
  gap: 20px;
  min-width: 0;
  padding: 24px;
  border-bottom: 1px solid var(--border);
}
.catalog-plan:last-child {
  border-bottom: 0;
}
.catalog-plan.selected {
  background: var(--theme-soft);
  box-shadow: inset 3px 0 var(--blue);
}
.catalog-plan h3 {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.catalog-plan-heading {
  min-width: 0;
}
.catalog-region,
.summary-region {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.catalog-region svg,
.summary-region svg {
  flex-shrink: 0;
}
.catalog-description {
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.catalog-availability {
  display: inline-block;
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 13px;
}
.catalog-specs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
  align-items: stretch;
}
.catalog-specs > div {
  display: grid;
  grid-template-rows: 1fr auto;
  min-width: 0;
}
.catalog-specs dt {
  min-height: 20px;
  margin-bottom: 7px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
}
.catalog-specs dd {
  margin: 0;
  color: var(--text-primary);
  font-size: 18px;
  line-height: 1.6;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.catalog-specs small {
  display: block;
  margin-top: 2px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
  font-weight: 400;
}
.catalog-plan-footer {
  display: grid;
  justify-items: stretch;
  gap: 12px;
  min-width: 0;
}
.catalog-plan .plan-price {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0 6px;
  margin: 0;
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.4px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.catalog-plan .plan-price span {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 400;
  letter-spacing: normal;
}
.plan-select {
  min-width: 0;
  min-height: 44px;
  padding: 8px 12px;
  font-size: 14px;
  line-height: 1.5;
  white-space: normal;
  scroll-margin-block: 24px 160px;
}
.plan-select[aria-pressed="true"] {
  color: var(--brand-ink);
  background: var(--theme-soft);
  border-color: var(--blue);
}
.purchase-summary {
  position: sticky;
  top: 32px;
  min-width: 0;
  padding: 24px;
  border-radius: 12px;
  background: var(--surface-subtle);
}
.purchase-summary > .purchase-section-heading {
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
}
.purchase-summary > .purchase-section-heading svg {
  color: var(--text-secondary);
}
.purchase-summary-content {
  margin-top: 24px;
}
.purchase-summary h3 {
  font-size: 19px;
  line-height: 1.5;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.purchase-summary-specs {
  display: grid;
  gap: 12px;
  margin: 24px 0;
}
.purchase-summary-specs > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
  line-height: 1.6;
}
.purchase-summary-specs dt {
  color: var(--text-secondary);
}
.purchase-summary-specs dd {
  margin: 0;
  color: var(--text-primary);
  text-align: right;
  overflow-wrap: anywhere;
}
.purchase-checkout {
  padding-top: 20px;
  border-top: 1px solid var(--border);
}
.purchase-total {
  display: grid;
  gap: 8px;
  min-width: 0;
  margin-bottom: 20px;
}
.purchase-total span {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}
.purchase-total strong {
  min-width: 0;
  font-size: 29px;
  line-height: 1.4;
  font-weight: 600;
  letter-spacing: -0.6px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.purchase-review {
  min-height: 46px;
  font-size: 14px;
}
.purchase-price-note {
  margin-top: 12px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
}
.purchase-boundary {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
  font-size: 13px;
  line-height: 1.7;
}
.purchase-boundary span {
  font-weight: 600;
}
.purchase-boundary p {
  margin-top: 6px;
  color: var(--text-secondary);
}
.purchase-pending {
  padding: 12px;
  margin-bottom: 20px;
  border: 1px solid var(--blue);
  border-radius: 8px;
  background: var(--theme-soft);
  color: var(--brand-ink);
  font-size: 14px;
  line-height: 1.7;
}
.summary-empty {
  padding-bottom: 24px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}
.catalog-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 56px 24px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  text-align: center;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}
@media (max-width: 1320px) and (min-width: 901px) {
  .purchase-layout {
    grid-template-columns: minmax(0, 1fr) 260px;
    gap: 24px;
  }
  .catalog-plan {
    grid-template-columns: minmax(110px, 1fr) minmax(115px, 0.8fr);
    gap: 16px 24px;
    padding: 20px;
  }
  .catalog-plan-heading {
    align-self: start;
  }
  .catalog-specs {
    grid-row: 2;
    grid-column: 1 / -1;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  .catalog-specs small {
    display: inline;
  }
  .catalog-plan-footer {
    grid-column: 2;
    grid-row: 1;
  }
  .purchase-summary {
    padding: 20px;
  }
}
@media (max-width: 900px) {
  .purchase-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 32px;
  }
  .catalog-plan {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
    padding: 20px;
  }
  .catalog-specs small {
    display: inline;
  }
  .catalog-plan-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  .purchase-summary {
    position: static;
  }
  .purchase-summary-specs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 32px;
  }
}
@media (max-width: 720px) {
  .purchase-page {
    padding-bottom: 160px;
  }
  .purchase-checkout {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 20;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    padding: 14px 24px calc(14px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
    background: var(--surface);
    box-shadow: 0 -4px 24px rgb(0 0 0 / 0.04);
  }
  .purchase-total {
    gap: 2px;
    margin: 0;
  }
  .purchase-total strong {
    font-size: 25px;
  }
  .purchase-total strong.long-total {
    font-size: 17px;
    letter-spacing: -0.2px;
  }
  .purchase-review {
    width: auto;
  }
  .purchase-checkout:not(:has(.purchase-total)) .purchase-review {
    grid-column: 1 / -1;
  }
}
@media (max-width: 650px) {
  .region-panel {
    align-items: baseline;
    gap: 12px;
    margin-bottom: 24px;
    padding-bottom: 20px;
  }
  .region-options {
    order: 1;
    flex-basis: 100%;
    gap: 8px;
  }
  .region-options button {
    padding: 8px 10px;
  }
  .catalog-plans {
    display: grid;
    gap: 12px;
    overflow: visible;
    border: 0;
    border-radius: 0;
    background: none;
  }
  .catalog-plan,
  .catalog-plan:last-child {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .catalog-plan.selected {
    border-color: var(--blue);
    box-shadow: none;
  }
  .catalog-plan h3 {
    font-size: 18px;
  }
  .catalog-region,
  .summary-region,
  .catalog-description,
  .catalog-availability {
    font-size: 14px;
  }
  .catalog-specs {
    gap: 8px;
  }
  .catalog-specs dt {
    min-height: 0;
    margin-bottom: 4px;
    font-size: 14px;
  }
  .catalog-specs dd {
    font-size: 20px;
  }
  .catalog-specs small {
    display: block;
    font-size: 14px;
  }
  .catalog-plan-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  .catalog-plan .plan-price {
    justify-content: flex-start;
    font-size: 23px;
  }
  .catalog-plan .plan-price span {
    font-size: 14px;
  }
  .purchase-summary {
    padding: 20px;
  }
  .purchase-summary-specs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 24px;
  }
  .purchase-price-note,
  .purchase-boundary,
  .purchase-total span {
    font-size: 14px;
  }
  .purchase-checkout {
    gap: 12px;
    padding-right: 20px;
    padding-left: 20px;
  }
  .purchase-total strong {
    font-size: clamp(19px, 5.4vw, 25px);
  }
  .purchase-review {
    gap: 6px;
    padding-right: 14px;
    padding-left: 14px;
  }
}
@media (max-width: 380px) {
  .purchase-checkout:has(.long-total) {
    grid-template-columns: minmax(0, 1fr);
  }
  .purchase-checkout:has(.long-total) .purchase-review {
    width: 100%;
  }
}
@media (max-width: 360px) {
  .purchase-summary-specs {
    grid-template-columns: minmax(0, 1fr);
  }
  .catalog-specs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  .catalog-specs small {
    display: inline;
  }
  .purchase-checkout {
    gap: 8px;
    padding-right: 16px;
    padding-left: 16px;
  }
  .purchase-review {
    padding-right: 10px;
    padding-left: 10px;
  }
}
</style>

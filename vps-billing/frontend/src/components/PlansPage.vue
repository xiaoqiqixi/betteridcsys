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
    <div class="purchase-intro">
      <p>
        {{
          tr(
            "选择区域与配置，核对后再创建订单。",
            "Choose a region and plan, then review your order.",
          )
        }}
      </p>
      <span class="purchase-billing"
        >{{ tr("按月计费", "Monthly billing") }} · {{ currency
        }}<template v-if="demo">
          · {{ tr("演示定价", "Demo prices") }}</template
        ></span
      >
    </div>
    <div class="purchase-layout">
      <div class="purchase-catalog">
        <section class="region-panel" aria-labelledby="region-title">
          <div class="purchase-section-heading">
            <span class="purchase-step">1</span>
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
        </section>

        <section aria-labelledby="plan-title">
          <div class="purchase-section-heading purchase-plan-heading">
            <span class="purchase-step">2</span>
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
                </div>
                <span
                  class="catalog-availability"
                  :class="{ available: available(plan) }"
                  >{{
                    available(plan)
                      ? tr("可选", "Available")
                      : tr("暂不可售", "Unavailable")
                  }}</span
                >
              </div>
              <p v-if="plan.description" class="catalog-description">
                {{ plan.description }}
              </p>
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
            <div class="purchase-total">
              <span>{{ tr("首期订单金额", "Initial order amount") }}</span
              ><strong>{{
                money(
                  summary.price_minor,
                  summary.currency,
                  summary.currency_format,
                )
              }}</strong>
            </div>
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
                    "支付与自动开通尚未接入，不会扣款或创建真实服务器。",
                    "Payments and provisioning are not connected. No charge or real server will be created.",
                  )
            }}
          </p>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.purchase-page {
  min-width: 0;
}
.purchase-intro {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  color: #657182;
  font-size: 13px;
  line-height: 1.7;
  margin: 0 0 24px;
}
.purchase-billing {
  font-size: 12px;
  color: #657182;
}
.purchase-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
  align-items: start;
  gap: 24px;
}
.purchase-catalog {
  min-width: 0;
}
.purchase-section-heading {
  display: flex;
  align-items: center;
  gap: 10px;
}
.purchase-section-heading h2 {
  font-size: 16px;
}
.purchase-step {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 7px;
  color: var(--blue);
  background: var(--theme-soft);
  font-size: 12px;
  font-weight: 600;
}
.region-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 22px;
  margin-bottom: 28px;
}
.region-options {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  margin-top: 18px;
}
.region-options button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  max-width: 100%;
  min-height: 42px;
  padding: 9px 13px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 12px;
  text-align: left;
  overflow-wrap: anywhere;
}
.region-options button[aria-pressed="true"] {
  background: var(--theme-soft);
  color: var(--blue);
  border-color: var(--blue);
}
.purchase-plan-heading {
  margin: 0 0 16px;
}
.catalog-count {
  margin-left: auto;
  font-size: 12px;
  color: #657182;
}
.catalog-plans {
  display: grid;
  gap: 14px;
}
.catalog-plan {
  padding: 22px;
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 14px;
  min-width: 0;
}
.catalog-plan.selected {
  border-color: var(--blue);
  box-shadow: 0 0 0 1px var(--blue);
}
.catalog-plan-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}
.catalog-plan h3 {
  font-size: 18px;
  overflow-wrap: anywhere;
}
.catalog-region,
.summary-region {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 7px;
  font-size: 12px;
  color: #657182;
  overflow-wrap: anywhere;
}
.catalog-region svg,
.summary-region svg {
  flex-shrink: 0;
}
.catalog-availability {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1.5;
  padding: 4px 8px;
  border-radius: 5px;
  background: #f1f3f5;
  color: #657182;
}
.catalog-availability.available {
  color: #21734b;
  background: #eff8f1;
}
.catalog-description {
  color: #657182;
  line-height: 1.7;
  font-size: 12px;
  margin-top: 13px;
  overflow-wrap: anywhere;
}
.catalog-specs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 20px 0;
}
.catalog-specs dt {
  color: #657182;
  font-size: 11px;
  line-height: 1.5;
  margin-bottom: 6px;
}
.catalog-specs dd {
  margin: 0;
  font-size: 19px;
  font-weight: 550;
  overflow-wrap: anywhere;
}
.catalog-specs small {
  font-size: 11px;
  font-weight: 400;
  color: #657182;
}
.catalog-plan-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.catalog-plan .plan-price {
  font-size: 23px;
  letter-spacing: -0.6px;
  margin: 0;
  overflow-wrap: anywhere;
}
.catalog-plan .plan-price span {
  display: inline-block;
  font-size: 11px;
  color: #657182;
  margin-left: 7px;
}
.plan-select {
  min-height: 42px;
  font-size: 12px;
}
.plan-select[aria-pressed="true"] {
  color: var(--blue);
  background: var(--theme-soft);
  border-color: var(--blue);
}
.purchase-summary {
  position: sticky;
  top: 96px;
  min-width: 0;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: #fff;
}
.purchase-summary > .purchase-section-heading {
  padding-bottom: 21px;
  border-bottom: 1px solid var(--border);
}
.purchase-summary > .purchase-section-heading svg {
  color: var(--blue);
}
.purchase-summary-content {
  margin-top: 22px;
}
.purchase-summary h3 {
  font-size: 19px;
  overflow-wrap: anywhere;
}
.purchase-summary-specs {
  margin: 22px 0;
  display: grid;
  gap: 13px;
}
.purchase-summary-specs > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}
.purchase-summary-specs dt {
  color: #657182;
}
.purchase-summary-specs dd {
  margin: 0;
  text-align: right;
  overflow-wrap: anywhere;
}
.purchase-total {
  display: grid;
  gap: 9px;
  padding: 20px 0;
  border-top: 1px solid var(--border);
}
.purchase-total span {
  color: #657182;
  font-size: 12px;
}
.purchase-total strong {
  font-size: 28px;
  color: var(--blue);
  letter-spacing: -0.7px;
  overflow-wrap: anywhere;
}
.purchase-review {
  min-height: 46px;
}
.purchase-price-note {
  font-size: 11px;
  line-height: 1.8;
  margin-top: 12px;
  color: #657182;
}
.purchase-boundary {
  border-top: 1px solid var(--border);
  margin-top: 22px;
  padding-top: 18px;
  font-size: 12px;
}
.purchase-boundary span {
  font-weight: 550;
}
.purchase-boundary p {
  font-size: 11px;
  line-height: 1.8;
  color: #657182;
  margin-top: 7px;
}
.purchase-pending {
  padding: 12px;
  margin-bottom: 20px;
  background: var(--theme-soft);
  color: #45546a;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.8;
}
.summary-empty {
  color: #657182;
  padding: 12px 0 25px;
  font-size: 13px;
  line-height: 1.8;
}
.catalog-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 22px;
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 14px;
  text-align: center;
  color: #657182;
  font-size: 13px;
  line-height: 1.8;
}
@media (max-width: 1100px) {
  .purchase-layout {
    grid-template-columns: minmax(0, 1fr) 270px;
    gap: 18px;
  }
  .catalog-plan,
  .region-panel,
  .purchase-summary {
    padding: 20px;
  }
  .catalog-specs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
}
@media (max-width: 850px) {
  .purchase-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .purchase-summary {
    position: static;
  }
  .catalog-specs {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
@media (max-width: 520px) {
  .purchase-intro {
    margin-bottom: 18px;
  }
  .catalog-plan,
  .region-panel,
  .purchase-summary {
    padding: 18px;
  }
  .catalog-specs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .catalog-plan .plan-price {
    font-size: 22px;
  }
  .catalog-plan-heading {
    flex-wrap: wrap;
  }
  .region-options button {
    min-height: 44px;
  }
  .purchase-summary {
    margin-top: 4px;
  }
}
</style>

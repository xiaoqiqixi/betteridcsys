<script lang="ts">
// Memory-only lock survives route unmounts; scoped to the originating account, never persisted.
type OriginalOrderInput = {
  plan_id: string;
  hostname: string;
  currency: string;
  quote: {
    price_minor: number;
    decimal_places: number;
    price_revision: number;
  };
};
const unconfirmedAttempts = new Map<
  string,
  { key: string; body: OriginalOrderInput }
>();
</script>

<script setup lang="ts">
import UiLoading from "../components/UiLoading.vue";
import UiSpinner from "../components/UiSpinner.vue";

import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  ArrowRight,
  Check,
  CheckCheck,
  MapPin,
  RefreshCw,
  Server,
} from "@lucide/vue";
import OverlayPanel from "../components/OverlayPanel.vue";
import ProductSpecs from "../components/ProductSpecs.vue";
import GeminiPlanCard from "../components/GeminiPlanCard.vue";
import { useWorkspace } from "../composables/useWorkspace";
import {
  sortCatalogEntries,
  validCatalogTaxonomy,
  type CatalogTaxonomy,
} from "../services/catalog-taxonomy";

const props = defineProps<{
  locale: "zh-CN" | "en";
  currency: string;
  mode: "demo" | "api";
}>();
const emit = defineEmits<{
  "order-created": [id: string];
  "request-sign-in": [];
}>();
interface CurrencyFormat {
  code: string;
  name: string;
  prefix: string;
  suffix: string;
  decimal_places: number;
}
interface Plan {
  id: string;
  name: string;
  description: string;
  type_id: string;
  region_id: string;
  node_id: string;
  taxonomy_revision: number;
  region: string;
  cpu: number;
  memory_gb: number;
  disk_gb: number;
  transfer_tb: number;
  price_minor: number;
  currency: string;
  price_revision: number;
  currency_format: CurrencyFormat;
  available: boolean;
}
interface CreatedOrder {
  id: string;
  number: string;
  status: string;
  currency: string;
  total_minor: number;
  hostname: string;
  currency_format: CurrencyFormat;
  plan_snapshot?: { plan_id: string };
}
const { read, write, generation: identityGeneration, session } = useWorkspace();
const identityKey = () =>
  `${props.mode}|${session.value?.user?.id || "anonymous"}`;
const en = computed(() => props.locale === "en");
const t = (zh: string, english: string) => (en.value ? english : zh);
const plans = ref<Plan[]>([]);
const taxonomy = ref<CatalogTaxonomy | null>(null);
const loading = ref(true);
const error = ref("");
const typeId = ref("");
const regionId = ref("");
const nodeId = ref("");
const purchasing = ref<Plan | null>(null);
const reviewOpen = ref(false);
const hostname = ref("");
const accepted = ref(false);
const submitting = ref(false);
const purchaseError = ref("");
const outcomeUnknown = ref(false);
const quotationInvalid = ref(false);
const created = ref<CreatedOrder | null>(null);
const attempt = ref<{ key: string; body: OriginalOrderInput } | null>(null);
const reconcileConsent = ref(false);
const reconciling = ref(false);
const reconcileError = ref("");
let generation = 0;
const types = computed(() =>
  sortCatalogEntries(
    (taxonomy.value?.types ?? []).filter(
      (type) =>
        type.enabled && plans.value.some((plan) => plan.type_id === type.id),
    ),
  ),
);
const selectedType = computed(() =>
  types.value.find((type) => type.id === typeId.value),
);
const regions = computed(() =>
  sortCatalogEntries(
    (taxonomy.value?.regions ?? []).filter(
      (region) =>
        selectedType.value &&
        region.enabled &&
        region.type_id === typeId.value &&
        plans.value.some(
          (plan) =>
            plan.type_id === typeId.value && plan.region_id === region.id,
        ),
    ),
  ),
);
const selectedRegion = computed(() =>
  regions.value.find((region) => region.id === regionId.value),
);
const nodes = computed(() =>
  sortCatalogEntries(
    (taxonomy.value?.nodes ?? []).filter(
      (node) =>
        selectedRegion.value &&
        node.enabled &&
        node.region_id === regionId.value &&
        plans.value.some(
          (plan) =>
            plan.type_id === typeId.value &&
            plan.region_id === regionId.value &&
            plan.node_id === node.id,
        ),
    ),
  ),
);
const selectedNode = computed(() =>
  nodes.value.find((node) => node.id === nodeId.value),
);
const shownPlans = computed(() =>
  plans.value.filter(
    (plan) =>
      !!selectedType.value &&
      !!selectedRegion.value &&
      !!selectedNode.value &&
      plan.type_id === typeId.value &&
      plan.region_id === regionId.value &&
      plan.node_id === nodeId.value,
  ),
);
const selectionLocked = computed(
  () =>
    loading.value ||
    submitting.value ||
    reconciling.value ||
    outcomeUnknown.value ||
    !!error.value,
);
function selectType(id: string) {
  if (selectionLocked.value) return;
  if (typeId.value === id || !types.value.some((type) => type.id === id))
    return;
  clearSelection();
  typeId.value = id;
  regionId.value = regions.value[0]?.id ?? "";
  nodeId.value = nodes.value[0]?.id ?? "";
  selectDefaultPlan();
}
function selectRegion(id: string) {
  if (
    selectionLocked.value ||
    regionId.value === id ||
    !regions.value.some((region) => region.id === id)
  )
    return;
  clearSelection();
  regionId.value = id;
  nodeId.value = nodes.value[0]?.id ?? "";
  selectDefaultPlan();
}
function selectNode(id: string) {
  if (
    selectionLocked.value ||
    nodeId.value === id ||
    !nodes.value.some((node) => node.id === id)
  )
    return;
  clearSelection();
  nodeId.value = id;
  selectDefaultPlan();
}
function money(plan: Plan) {
  const f = plan.currency_format;
  if (
    !plan.available ||
    !f ||
    f.code !== plan.currency ||
    !Number.isSafeInteger(plan.price_minor) ||
    plan.price_minor <= 0 ||
    !Number.isInteger(f.decimal_places) ||
    f.decimal_places < 0 ||
    f.decimal_places > 6
  )
    return "—";
  const amount = BigInt(plan.price_minor)
    .toString()
    .padStart(f.decimal_places + 1, "0");
  const whole = f.decimal_places ? amount.slice(0, -f.decimal_places) : amount;
  const fraction = f.decimal_places
    ? `.${amount.slice(-f.decimal_places)}`
    : "";
  return `${f.prefix}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction}${f.suffix}`;
}
function safeError(e: unknown) {
  const value = e as { code?: string; requestId?: string; status?: number };
  const messages: Record<string, string> = {
    AUTH_REQUIRED: t("请先登录再创建订单。", "Please sign in before ordering."),
    PRICE_CHANGED: t(
      "报价已变化，请重新读取套餐，核对新报价后再确认。",
      "The price changed. Refresh plans and confirm the new quote.",
    ),
    PLAN_UNAVAILABLE: t(
      "套餐当前无法购买，请刷新套餐。",
      "This plan is no longer available. Refresh plans.",
    ),
    CURRENCY_DISABLED: t(
      "此币种已停用，请选择其他币种。",
      "This currency is disabled. Select another currency.",
    ),
    CSRF_INVALID: t(
      "会话已变化，请刷新后重新登录。",
      "Your session changed. Refresh and sign in again.",
    ),
  };
  const text =
    messages[value.code || ""] ||
    t(
      "请求未完成，请稍后重试。",
      "The request could not be completed. Please try again later.",
    );
  return (
    text +
    (value.requestId && /^[a-f0-9]{32}$/.test(value.requestId)
      ? ` · ${t("请求编号", "Request ID")} ${value.requestId}`
      : "")
  );
}
function clearSelection() {
  purchasing.value = null;
  reviewOpen.value = false;
  hostname.value = "";
  accepted.value = false;
  created.value = null;
  purchaseError.value = "";
  // Only a local draft can be discarded. Never clear an in-flight/unknown intent.
  if (!unconfirmedAttempts.has(identityKey())) attempt.value = null;
}
async function load() {
  const id = ++generation;
  // A refreshed default is a new draft, never accepted or automatically submitted.
  clearSelection();
  loading.value = true;
  error.value = "";
  try {
    const [registry, result] = await Promise.all([
      read<CatalogTaxonomy>("/catalog-taxonomy"),
      read<Plan[]>("/plans", { currency: props.currency }),
    ]);
    if (id !== generation) return;
    if (!validCatalogTaxonomy(registry)) throw { code: "INVALID_RESPONSE" };
    const validTypes = new Map(registry.types.map((type) => [type.id, type]));
    const validRegions = new Map(
      registry.regions.map((region) => [region.id, region]),
    );
    const validNodes = new Map(registry.nodes.map((node) => [node.id, node]));
    if (
      result.some((plan) => {
        const type = validTypes.get(plan.type_id);
        const region = validRegions.get(plan.region_id);
        const node = validNodes.get(plan.node_id);
        return (
          plan.currency !== props.currency ||
          plan.taxonomy_revision !== registry.revision ||
          !type?.enabled ||
          !region?.enabled ||
          !node?.enabled ||
          region.type_id !== plan.type_id ||
          node.region_id !== plan.region_id ||
          region.name !== plan.region
        );
      })
    )
      throw { code: "INVALID_RESPONSE" };
    // Publish a mutually consistent pair; never combine different registry revisions.
    taxonomy.value = registry;
    plans.value = result;
    if (!types.value.some((type) => type.id === typeId.value))
      typeId.value = types.value[0]?.id ?? "";
    if (!regions.value.some((region) => region.id === regionId.value))
      regionId.value = regions.value[0]?.id ?? "";
    if (!nodes.value.some((node) => node.id === nodeId.value))
      nodeId.value = nodes.value[0]?.id ?? "";
    selectDefaultPlan();
  } catch (e) {
    if (id === generation) error.value = safeError(e);
  } finally {
    if (id === generation) loading.value = false;
  }
}

function purchasable(plan: Plan) {
  return (
    plan.currency === props.currency &&
    plan.available &&
    Number.isSafeInteger(plan.price_minor) &&
    plan.price_minor > 0 &&
    Number.isSafeInteger(plan.price_revision) &&
    plan.price_revision >= 1 &&
    money(plan) !== "—"
  );
}
function selectDefaultPlan() {
  if (
    submitting.value ||
    outcomeUnknown.value ||
    unconfirmedAttempts.has(identityKey())
  )
    return;
  // The first published plan is the default, even without a purchasable quote.
  // Never silently skip it, compare prices, or move to a different parent chain.
  const plan = shownPlans.value[0];
  if (plan) selectPlan(plan);
}
function buy(plan: Plan) {
  if (
    selectionLocked.value ||
    !shownPlans.value.some((item) => item.id === plan.id) ||
    !purchasable(plan)
  )
    return;
  if (!session.value?.user) {
    emit("request-sign-in");
    return;
  }
  if (outcomeUnknown.value || unconfirmedAttempts.has(identityKey())) {
    outcomeUnknown.value = true;
    return;
  }
  selectPlan(plan);
}
function selectPlan(plan: Plan) {
  if (
    purchasing.value?.id === plan.id &&
    purchasing.value.price_revision === plan.price_revision &&
    !created.value
  )
    return;
  purchasing.value = { ...plan, currency_format: { ...plan.currency_format } };
  hostname.value = "";
  accepted.value = false;
  purchaseError.value = "";
  created.value = null;
  outcomeUnknown.value = false;
  quotationInvalid.value = false;
  attempt.value = null;
}
function closePurchase() {
  if (!submitting.value) reviewOpen.value = false;
}
const hostnameValid = computed(() =>
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
    hostname.value.trim().toLowerCase(),
  ),
);
const canReview = computed(
  () =>
    !!purchasing.value &&
    purchasable(purchasing.value) &&
    hostnameValid.value &&
    !loading.value &&
    !error.value &&
    !submitting.value &&
    !outcomeUnknown.value &&
    !quotationInvalid.value &&
    !created.value,
);
function openReview() {
  if (!session.value?.user) {
    emit("request-sign-in");
    return;
  }
  if (!canReview.value) return;
  accepted.value = false;
  reviewOpen.value = true;
}
async function createOrder() {
  const plan = purchasing.value;
  if (
    !plan ||
    !accepted.value ||
    !hostnameValid.value ||
    submitting.value ||
    outcomeUnknown.value ||
    quotationInvalid.value ||
    created.value
  )
    return;
  if (!purchasable(plan)) return;
  if (!attempt.value)
    attempt.value = {
      key: `ui-${crypto.randomUUID()}`,
      body: {
        plan_id: plan.id,
        hostname: hostname.value.trim().toLowerCase(),
        currency: plan.currency,
        quote: {
          price_minor: plan.price_minor,
          decimal_places: plan.currency_format.decimal_places,
          price_revision: plan.price_revision,
        },
      },
    };
  submitting.value = true;
  const identity = identityGeneration.value;
  const account = identityKey();
  const sentAttempt = { ...attempt.value };
  const sentHostname = hostname.value.trim().toLowerCase();
  // Lock before dispatch: an identity switch or route unmount must not lose an in-flight write.
  unconfirmedAttempts.set(account, sentAttempt);
  purchaseError.value = "";
  try {
    const order = await write<CreatedOrder>("/orders", sentAttempt.body, {
      "Idempotency-Key": sentAttempt.key,
    });
    if (identity !== identityGeneration.value) return;
    if (
      !order ||
      typeof order.id !== "string" ||
      !order.id.trim() ||
      typeof order.number !== "string" ||
      !order.number.trim() ||
      order.status !== "pending_payment" ||
      order.currency !== plan.currency ||
      order.total_minor !== plan.price_minor ||
      order.hostname !== sentHostname ||
      order.currency_format?.code !== plan.currency ||
      order.currency_format.decimal_places !==
        plan.currency_format.decimal_places ||
      (order.plan_snapshot && order.plan_snapshot.plan_id !== plan.id)
    )
      throw { uncertain: true };
    unconfirmedAttempts.delete(account);
    created.value = order;
  } catch (e) {
    if (identity !== identityGeneration.value) return;
    const err = e as { status?: number; code?: string; uncertain?: boolean };
    if (err.uncertain || !err.status || err.status >= 500) {
      outcomeUnknown.value = true;
      unconfirmedAttempts.set(account, sentAttempt);
      purchaseError.value = t(
        "订单结果尚未确认。请先查看订单列表，勿重复下单。",
        "Your order is not yet confirmed. Check your orders before trying again.",
      );
    } else {
      unconfirmedAttempts.delete(account);
      purchaseError.value = safeError(e);
      if (
        ["PRICE_CHANGED", "PLAN_UNAVAILABLE", "CURRENCY_DISABLED"].includes(
          err.code || "",
        )
      ) {
        quotationInvalid.value = true;
        attempt.value = null;
      }
    }
  } finally {
    submitting.value = false;
  }
}
async function reconcileOrder() {
  const account = identityKey(),
    pending = unconfirmedAttempts.get(account),
    originalUser = session.value?.user?.id;
  if (
    !originalUser ||
    !reconcileConsent.value ||
    reconciling.value ||
    submitting.value
  )
    return;
  // A previous mounted instance may have confirmed the request after this page
  // restored its lock. With no pending request left, only navigate; never replay.
  if (!pending) {
    outcomeUnknown.value = false;
    attempt.value = null;
    clearSelection();
    reconcileConsent.value = false;
    emit("order-created", "");
    return;
  }
  const identity = identityGeneration.value;
  reconciling.value = true;
  reconcileError.value = "";
  try {
    // A cookie may have changed in another tab. Re-verify the account before replaying a write.
    const active = await read<{ user: { id: string } | null }>("/session");
    if (
      identity !== identityGeneration.value ||
      account !== identityKey() ||
      active.user?.id !== originalUser
    )
      throw { status: 403, code: "FORBIDDEN" };
    // This is an explicit, user-confirmed replay of the exact request, never a new-key retry.
    // The server may return an already paid/cancelled original order, or complete a missing one.
    const order = await write<CreatedOrder>("/orders", pending.body, {
      "Idempotency-Key": pending.key,
    });
    if (identity !== identityGeneration.value || account !== identityKey())
      return;
    if (
      !order?.id?.trim() ||
      !order.number?.trim() ||
      !["pending_payment", "paid", "cancelled"].includes(order.status) ||
      order.currency !== pending.body.currency ||
      order.total_minor !== pending.body.quote.price_minor ||
      order.hostname !== pending.body.hostname ||
      order.currency_format?.code !== pending.body.currency ||
      order.currency_format.decimal_places !==
        pending.body.quote.decimal_places ||
      (order.plan_snapshot &&
        order.plan_snapshot.plan_id !== pending.body.plan_id)
    )
      throw { uncertain: true };
    unconfirmedAttempts.delete(account);
    outcomeUnknown.value = false;
    attempt.value = null;
    purchasing.value = null;
    emit("order-created", order.id);
  } catch (e) {
    if (identity !== identityGeneration.value || account !== identityKey())
      return;
    const err = e as { code?: string; status?: number };
    // These business rejections happen only after the completed-idempotency lookup.
    // An auth/network/conflicting-key failure cannot establish that no original order exists.
    if (
      err.status === 409 &&
      ["PRICE_CHANGED", "PLAN_UNAVAILABLE", "CURRENCY_DISABLED"].includes(
        err.code || "",
      )
    ) {
      unconfirmedAttempts.delete(account);
      outcomeUnknown.value = false;
      attempt.value = null;
      purchasing.value = null;
      reconcileError.value = safeError(e);
      void load();
    } else
      reconcileError.value = t(
        "这笔订单仍未确认，请用原账户查看订单，勿重复下单。",
        "This order is still unconfirmed. Check it in the original account; do not order again.",
      );
  } finally {
    reconciling.value = false;
    reconcileConsent.value = false;
  }
}
watch(
  () => [props.currency, props.mode, identityGeneration.value],
  () => {
    clearSelection();
    reconcileConsent.value = false;
    reconcileError.value = "";
    const pending = unconfirmedAttempts.get(identityKey());
    outcomeUnknown.value = !!pending;
    attempt.value = pending ? { ...pending } : null;
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation++;
});
</script>

<template>
  <section class="catalog-page">
    <header class="catalog-heading">
      <div>
        <h1>{{ t("购买云服务器", "Buy a cloud server") }}</h1>
        <p>
          {{
            t(
              "选择类型、地区、节点和套餐，确认订单后前往账单付款。",
              "Choose a type, region, node and plan, then review your order before payment.",
            )
          }}
        </p>
      </div>
      <button
        class="btn btn-ghost refresh-btn"
        :disabled="loading || submitting || reconciling || outcomeUnknown"
        :aria-busy="loading"
        :aria-label="t('刷新套餐', 'Refresh plans')"
        @click="load"
      >
        <UiSpinner v-if="loading" :size="16" /><RefreshCw
          v-else
          :size="16"
        /><span>{{ t("刷新套餐", "Refresh plans") }}</span>
      </button>
    </header>

    <div
      v-if="outcomeUnknown && !reviewOpen"
      class="uncertain-banner order-reconciliation"
      role="alert"
    >
      <p>
        {{
          t(
            "上一笔下单结果尚未确认，已暂停新下单。请先核对原账户的订单列表。",
            "A previous order is unconfirmed. New orders are paused. Check the original account’s orders first.",
          )
        }}
      </p>
      <button
        class="btn btn-secondary"
        :disabled="reconciling"
        @click="emit('order-created', '')"
      >
        {{ t("核对订单列表", "Check order list") }}
      </button>
      <label class="purchase-consent"
        ><input
          v-model="reconcileConsent"
          type="checkbox"
          :disabled="reconciling"
        /><span>{{
          t(
            "我已查看订单列表，确认核对这笔订单；若尚未下单，将按刚才确认的价格创建一笔待付款订单。",
            "I checked my orders. If this order does not exist, complete it once at the price I confirmed, without taking payment.",
          )
        }}</span></label
      >
      <button
        class="btn btn-primary"
        :disabled="!reconcileConsent || reconciling"
        @click="reconcileOrder"
        :aria-busy="reconciling"
      >
        <UiSpinner v-if="reconciling" />{{
          reconciling
            ? t("正在核对订单…", "Reconciling…")
            : t("核对这笔订单", "Reconcile original order")
        }}
      </button>
    </div>
    <p v-if="reconcileError" class="inline-error" role="alert">
      {{ reconcileError }}
    </p>
    <p v-if="error && plans.length" class="stale-banner" role="alert">
      {{ error }} ·
      {{
        t(
          "上次读取的套餐仅供核对，请刷新成功后再下单。",
          "Previous plans are shown for reference. Refresh successfully before ordering.",
        )
      }}
    </p>

    <div class="purchase-layout">
      <div class="purchase-options">
        <section
          class="selection-section surface-card"
          aria-labelledby="type-heading"
        >
          <div class="section-heading">
            <span class="step-number" aria-hidden="true">1</span>
            <h2 id="type-heading">{{ t("选择类型", "Choose a type") }}</h2>
          </div>
          <div
            v-if="types.length"
            class="catalog-type"
            :aria-label="t('可选类型', 'Available types')"
          >
            <button
              v-for="item in types"
              :key="item.id"
              :data-type-id="item.id"
              :class="{ active: typeId === item.id }"
              :aria-pressed="typeId === item.id"
              :disabled="selectionLocked"
              @click="selectType(item.id)"
            >
              <Server :size="15" /><span>{{ item.name }}</span
              ><Check
                v-if="typeId === item.id"
                :size="14"
                class="region-check"
              />
            </button>
          </div>
          <p v-else class="section-hint">
            {{
              loading
                ? t("正在读取类型…", "Loading types…")
                : t("暂无可选类型", "No types available")
            }}
          </p>
        </section>

        <section
          class="selection-section surface-card"
          aria-labelledby="region-heading"
        >
          <div class="section-heading">
            <span class="step-number" aria-hidden="true">2</span>
            <h2 id="region-heading">{{ t("选择地区", "Choose a region") }}</h2>
          </div>
          <div
            v-if="regions.length"
            class="catalog-region"
            :aria-label="t('可选地区', 'Available regions')"
          >
            <button
              v-for="item in regions"
              :key="item.id"
              :data-region-id="item.id"
              :class="{ active: regionId === item.id }"
              :aria-pressed="regionId === item.id"
              :disabled="selectionLocked"
              @click="selectRegion(item.id)"
            >
              <MapPin :size="15" /><span>{{ item.name }}</span
              ><Check
                v-if="regionId === item.id"
                :size="14"
                class="region-check"
              />
            </button>
          </div>
          <p v-else class="section-hint">
            {{
              loading
                ? t("正在读取地区…", "Loading regions…")
                : t("暂无可选地区", "No regions available")
            }}
          </p>
        </section>

        <section
          class="selection-section surface-card"
          aria-labelledby="node-heading"
        >
          <div class="section-heading">
            <span class="step-number" aria-hidden="true">3</span>
            <h2 id="node-heading">{{ t("选择节点", "Choose a node") }}</h2>
          </div>
          <div
            v-if="nodes.length"
            class="catalog-node"
            :aria-label="t('可选节点', 'Available nodes')"
          >
            <button
              v-for="item in nodes"
              :key="item.id"
              :data-node-id="item.id"
              :class="{ active: nodeId === item.id }"
              :aria-pressed="nodeId === item.id"
              :disabled="selectionLocked"
              @click="selectNode(item.id)"
            >
              <Server :size="15" /><span>{{ item.name }}</span
              ><Check
                v-if="nodeId === item.id"
                :size="14"
                class="region-check"
              />
            </button>
          </div>
          <p v-else class="section-hint">
            {{
              loading
                ? t("正在读取节点…", "Loading nodes…")
                : t("暂无可选节点", "No nodes available")
            }}
          </p>
        </section>

        <section
          class="selection-section surface-card"
          aria-labelledby="plan-heading"
        >
          <div class="section-heading">
            <span class="step-number" aria-hidden="true">4</span>
            <h2 id="plan-heading">{{ t("选择套餐", "Choose a plan") }}</h2>
            <span class="section-meta"
              >{{ t("月付", "Monthly") }} · {{ currency }}</span
            >
          </div>
          <div v-if="error && !plans.length" class="catalog-empty" role="alert">
            <Server :size="28" />
            <h3>{{ t("暂时无法读取套餐", "Plans unavailable") }}</h3>
            <p>{{ error }}</p>
            <button class="btn btn-secondary" @click="load">
              {{ t("重新读取", "Try again") }}
            </button>
          </div>
          <UiLoading
            v-else-if="loading && !plans.length"
            layout="cards"
            :label="t('正在读取套餐…', 'Loading plans…')"
          />
          <div v-else-if="!shownPlans.length" class="catalog-empty">
            <Server :size="28" />
            <h3>{{ t("暂无可选套餐", "No plans available") }}</h3>
            <p>
              {{
                t(
                  "套餐上架后会显示在这里。",
                  "Plans will appear here when available.",
                )
              }}
            </p>
          </div>
          <div v-else class="plan-grid">
            <GeminiPlanCard
              v-for="plan in shownPlans"
              :key="plan.id"
              :data-plan-id="plan.id"
              :plan="plan"
              :locale="locale"
              :selected="purchasing?.id === plan.id"
              :choose-disabled="
                loading ||
                submitting ||
                outcomeUnknown ||
                !!error ||
                plan.currency !== currency
              "
              @choose="buy(plan)"
            />
          </div>
        </section>

        <section
          class="selection-section surface-card"
          aria-labelledby="hostname-heading"
        >
          <div class="section-heading">
            <span class="step-number" aria-hidden="true">5</span>
            <h2 id="hostname-heading">{{ t("主机名称", "Hostname") }}</h2>
          </div>
          <template v-if="session?.user"
            ><label class="form-group hostname-field"
              ><span class="form-label sr-only">{{
                t("主机名称", "Hostname")
              }}</span
              ><input
                v-model="hostname"
                class="form-input"
                type="text"
                autocomplete="off"
                maxlength="63"
                :disabled="
                  !purchasing ||
                  submitting ||
                  outcomeUnknown ||
                  !!created ||
                  !!attempt
                "
                placeholder="my-cloud-01"
                :aria-invalid="hostname.length > 0 && !hostnameValid"
                aria-describedby="hostname-help"
              /><small id="hostname-help">{{
                t(
                  "1–63 位字母、数字或中横线，首尾为字母或数字。将统一使用小写。",
                  "1–63 letters, digits or hyphens. Start and end with a letter or digit; saved in lowercase.",
                )
              }}</small></label
            >
            <p v-if="!purchasing" class="section-hint">
              {{ t("请先选择套餐。", "Choose a plan first.") }}
            </p></template
          >
          <div v-else class="sign-in-hint">
            <p>
              {{
                t(
                  "登录后填写主机名称并创建订单。",
                  "Sign in to enter a hostname and create your order.",
                )
              }}
            </p>
            <button class="btn btn-secondary" @click="emit('request-sign-in')">
              {{ t("登录", "Sign in") }}<ArrowRight :size="15" />
            </button>
          </div>
        </section>
      </div>

      <aside
        class="order-summary surface-card"
        aria-labelledby="summary-heading"
      >
        <h2 id="summary-heading">{{ t("订单详情", "Order details") }}</h2>
        <template v-if="purchasing"
          ><div class="summary-plan">
            <span class="summary-region"
              ><MapPin :size="14" />{{ purchasing.region }}</span
            >
            <h3>{{ purchasing.name }}</h3>
            <p v-if="purchasing.description">{{ purchasing.description }}</p>
          </div>
          <ProductSpecs :plan="purchasing" :locale="locale"
        /></template>
        <p v-else class="summary-placeholder">
          {{
            t(
              "选择套餐后，在这里核对配置与价格。",
              "Choose a plan to review its specifications and price.",
            )
          }}
        </p>
        <dl class="summary-lines">
          <div>
            <dt>{{ t("类型", "Type") }}</dt>
            <dd>{{ selectedType?.name || "—" }}</dd>
          </div>
          <div>
            <dt>{{ t("节点", "Node") }}</dt>
            <dd>{{ selectedNode?.name || "—" }}</dd>
          </div>
          <div v-if="!purchasing">
            <dt>{{ t("地区", "Region") }}</dt>
            <dd>{{ selectedRegion?.name || "—" }}</dd>
          </div>
          <div>
            <dt>{{ t("付款周期", "Billing cycle") }}</dt>
            <dd>{{ t("月付", "Monthly") }}</dd>
          </div>
          <div>
            <dt>{{ t("币种", "Currency") }}</dt>
            <dd>{{ purchasing?.currency || currency }}</dd>
          </div>
          <div v-if="purchasing && hostname.trim()">
            <dt>{{ t("主机名称", "Hostname") }}</dt>
            <dd class="font-mono">{{ hostname.trim().toLowerCase() }}</dd>
          </div>
        </dl>
        <div class="summary-total">
          <span>{{ t("每月应付", "Monthly total") }}</span
          ><strong class="money-figure">{{
            purchasing ? money(purchasing) : "—"
          }}</strong
          ><small
            >{{ purchasing?.currency || currency }} / {{ t("月", "mo") }}</small
          >
        </div>
        <p
          v-if="purchasing && !purchasable(purchasing)"
          class="section-hint"
          role="status"
        >
          {{
            t(
              "当前套餐在所选币种下暂无可购报价。",
              "This plan has no purchasable quote in the selected currency.",
            )
          }}
        </p>
        <div class="summary-actions">
          <button
            v-if="created"
            class="btn btn-primary"
            @click="emit('order-created', created.id)"
          >
            {{ t("查看订单", "View order") }}<ArrowRight :size="16" /></button
          ><button
            v-else
            class="btn btn-primary"
            :disabled="
              session?.user ? !canReview : loading || !!error || outcomeUnknown
            "
            @click="openReview"
          >
            {{
              session?.user
                ? t("确认订单", "Review order")
                : t("登录后购买", "Sign in to order")
            }}<ArrowRight :size="16" />
          </button>
        </div>
        <p class="summary-note">
          {{
            t(
              "确认后仅创建待付款订单，不会自动扣款或开通。",
              "Confirmation creates an unpaid order only. No automatic payment or activation.",
            )
          }}
        </p>
      </aside>
    </div>

    <div class="mobile-purchase-bar">
      <div>
        <span>{{ t("每月应付", "Monthly total") }}</span
        ><strong class="money-figure"
          >{{ purchasing ? money(purchasing) : "—"
          }}<small>{{ purchasing?.currency || currency }}</small></strong
        >
      </div>
      <button
        v-if="created"
        class="btn btn-primary"
        @click="emit('order-created', created.id)"
      >
        {{ t("查看订单", "View order") }}</button
      ><button
        v-else
        class="btn btn-primary"
        :disabled="
          session?.user ? !canReview : loading || !!error || outcomeUnknown
        "
        @click="openReview"
      >
        {{
          session?.user
            ? t("确认订单", "Review order")
            : t("登录后购买", "Sign in to order")
        }}<ArrowRight :size="16" />
      </button>
    </div>

    <OverlayPanel
      :open="reviewOpen && !!purchasing"
      :busy="submitting"
      :title="
        created
          ? t('订单已创建', 'Order created')
          : t('确认订单', 'Review order')
      "
      :description="
        mode === 'demo'
          ? t(
              '演示环境 · 不产生真实订单或付款',
              'Demo environment · No real orders or payments',
            )
          : t(
              '请核对以下信息。创建后仍需手动付款。',
              'Review the details below. Payment is a separate step.',
            )
      "
      kind="drawer"
      @close="closePurchase"
    >
      <template v-if="purchasing">
        <div v-if="created" class="order-created">
          <div class="created-check"><CheckCheck :size="28" /></div>
          <h3>
            {{
              mode === "demo"
                ? t("演示订单已创建", "Demo order created")
                : t("已生成待付款订单", "Your unpaid order is ready")
            }}
          </h3>
          <p class="font-mono">{{ created.number }}</p>
          <p>
            {{
              t(
                "订单已创建，请前往账单完成付款。",
                "Your order is ready. Complete payment from your invoices.",
              )
            }}
          </p>
        </div>
        <template v-else
          ><div class="purchase-plan">
            <span class="summary-region"
              ><MapPin :size="14" />{{ purchasing.region }}</span
            >
            <h3>{{ purchasing.name }}</h3>
            <ProductSpecs :plan="purchasing" :locale="locale" />
          </div>
          <dl class="summary-lines review-lines">
            <div>
              <dt>{{ t("类型", "Type") }}</dt>
              <dd>{{ selectedType?.name || "—" }}</dd>
            </div>
            <div>
              <dt>{{ t("节点", "Node") }}</dt>
              <dd>{{ selectedNode?.name || "—" }}</dd>
            </div>
            <div>
              <dt>{{ t("主机名称", "Hostname") }}</dt>
              <dd class="font-mono">{{ hostname.trim().toLowerCase() }}</dd>
            </div>
            <div>
              <dt>{{ t("付款周期", "Billing cycle") }}</dt>
              <dd>{{ t("月付", "Monthly") }}</dd>
            </div>
          </dl>
          <div class="summary-total">
            <span>{{ t("每月应付", "Monthly total") }}</span
            ><strong class="money-figure">{{ money(purchasing) }}</strong
            ><small>{{ purchasing.currency }} / {{ t("月", "mo") }}</small>
          </div>
          <label class="purchase-consent"
            ><input
              v-model="accepted"
              type="checkbox"
              :disabled="submitting || outcomeUnknown"
            /><span>{{
              t(
                "我已核对套餐规格与当前报价。创建订单不代表已付款。",
                "I have reviewed the specifications and this quote. Creating an order does not complete payment.",
              )
            }}</span></label
          >
          <p v-if="purchaseError" class="inline-error" role="alert">
            {{ purchaseError }}
          </p>
          <button
            v-if="quotationInvalid"
            class="btn btn-secondary requote-button"
            @click="
              closePurchase();
              load();
            "
          >
            {{ t("重新读取报价", "Refresh quotes") }}
          </button></template
        >
      </template>
      <template #footer
        ><button
          v-if="created"
          class="btn btn-primary"
          @click="
            emit('order-created', created.id);
            reviewOpen = false;
            purchasing = null;
          "
        >
          {{ t("查看订单", "View order") }}<ArrowRight :size="16" /></button
        ><template v-else
          ><button
            class="btn btn-secondary"
            :disabled="submitting"
            @click="closePurchase"
          >
            {{ t("返回修改", "Back") }}</button
          ><button
            v-if="outcomeUnknown"
            class="btn btn-primary"
            @click="
              emit('order-created', '');
              reviewOpen = false;
            "
          >
            {{ t("到订单列表核对", "Check order list") }}</button
          ><button
            v-else
            class="btn btn-primary"
            :disabled="
              !purchasing ||
              !purchasable(purchasing) ||
              !hostnameValid ||
              !accepted ||
              submitting ||
              quotationInvalid
            "
            @click="createOrder"
            :aria-busy="submitting"
          >
            <UiSpinner v-if="submitting" />{{
              submitting
                ? t("正在创建…", "Creating…")
                : mode === "demo"
                  ? t("创建演示订单", "Create demo order")
                  : t("创建待付款订单", "Create unpaid order")
            }}<ArrowRight v-if="!submitting" :size="16" /></button></template
      ></template>
    </OverlayPanel>
  </section>
</template>

<style scoped>
.catalog-page {
  padding-bottom: 32px;
  min-width: 0;
}
.catalog-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 8px 0 28px;
}
.catalog-heading h1 {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.04em;
}
.catalog-heading p {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
  margin-top: 9px;
}
.refresh-btn {
  flex-shrink: 0;
  gap: 7px;
  font-size: 12px;
  color: var(--text-secondary);
}
.purchase-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  align-items: start;
  gap: 24px;
}
.purchase-options {
  display: grid;
  gap: 20px;
  min-width: 0;
}
.selection-section {
  padding: 24px;
  border-radius: 14px;
  box-shadow: none;
  min-width: 0;
}
.section-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 22px;
}
.section-heading h2,
.order-summary > h2 {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.step-number {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font: 500 11px var(--font-mono);
}
.section-meta {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-secondary);
}
.catalog-type,
.catalog-region,
.catalog-node {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.catalog-type button,
.catalog-region button,
.catalog-node button {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 116px;
  min-height: 46px;
  padding: 11px 14px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-surface);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  max-width: 100%;
  overflow-wrap: anywhere;
  text-align: left;
}
.catalog-type button > span,
.catalog-region button > span,
.catalog-node button > span {
  min-width: 0;
}
.catalog-type button > svg,
.catalog-region button > svg,
.catalog-node button > svg {
  flex-shrink: 0;
}
.catalog-type button.active,
.catalog-region button.active,
.catalog-node button.active {
  border-color: var(--accent-primary);
  background: var(--bg-active);
  color: var(--text-primary);
}
.catalog-type button.active > svg,
.catalog-region button.active > svg,
.catalog-node button.active > svg {
  color: var(--accent-primary);
}
.region-check {
  margin-left: auto;
}
.catalog-type,
.catalog-node {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
}
.catalog-type button:focus-visible,
.catalog-region button:focus-visible,
.catalog-node button:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 3px;
}
.plan-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.section-hint {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-top: 12px;
}
.hostname-field {
  max-width: 460px;
}
.hostname-field input {
  min-height: 46px;
  background: var(--bg-elevated);
}
.hostname-field small {
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-secondary);
}
.sign-in-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.sign-in-hint p {
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-secondary);
}
.sign-in-hint .btn {
  font-size: 12px;
  min-height: 40px;
  flex-shrink: 0;
}
.order-summary {
  position: sticky;
  top: 24px;
  min-width: 0;
  padding: 24px;
  border-radius: 14px;
  box-shadow: none;
}
.order-summary > h2 {
  margin-bottom: 24px;
}
.summary-plan {
  margin-bottom: 24px;
  min-width: 0;
}
.summary-region {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.summary-plan h3,
.purchase-plan h3 {
  font-size: 20px;
  line-height: 1.4;
  letter-spacing: -0.03em;
  overflow-wrap: anywhere;
  margin: 9px 0;
}
.summary-plan p {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.summary-placeholder {
  font-size: 12px;
  line-height: 1.8;
  color: var(--text-secondary);
  padding: 4px 0 20px;
}
.order-summary :deep(.product-specs) {
  gap: 17px 10px;
}
.order-summary :deep(.product-specs dt) {
  font-size: 11px;
  gap: 5px;
}
.order-summary :deep(.product-specs dt svg) {
  width: 13px;
}
.order-summary :deep(.product-specs dd) {
  font-size: 16px;
}
.summary-lines {
  display: grid;
  gap: 13px;
  padding: 23px 0;
  margin-top: 24px;
  border-top: 1px solid var(--border-subtle);
}
.summary-lines > div {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 18px;
  font-size: 12px;
  line-height: 1.6;
}
.summary-lines dt {
  color: var(--text-secondary);
  flex-shrink: 0;
}
.summary-lines dd {
  text-align: right;
  overflow-wrap: anywhere;
  min-width: 0;
}
.summary-total {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  padding-top: 22px;
  border-top: 1px solid var(--border-subtle);
}
.summary-total > span {
  font-size: 12px;
  color: var(--text-secondary);
}
.summary-total strong {
  font-size: 29px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.summary-total small {
  font-size: 11px;
  color: var(--text-secondary);
}
.summary-actions {
  margin-top: 24px;
}
.summary-actions .btn {
  width: 100%;
  min-height: 44px;
  justify-content: space-between;
  font-size: 12px;
}
.summary-note {
  font-size: 11px;
  line-height: 1.8;
  color: var(--text-secondary);
  margin-top: 14px;
}
.mobile-purchase-bar {
  display: none;
}
.catalog-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
  color: var(--text-secondary);
  padding: 36px 16px;
}
.catalog-empty h3 {
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 500;
}
.catalog-empty p {
  max-width: 480px;
  font-size: 12px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.stale-banner,
.uncertain-banner {
  font-size: 12px;
  line-height: 1.8;
  padding: 16px;
  border: 1px solid var(--border-strong);
  background: var(--status-warning-bg);
  color: var(--text-primary);
  border-radius: 10px;
  margin-bottom: 20px;
}
.order-reconciliation {
  display: grid;
  gap: 14px;
  justify-items: start;
}
.order-reconciliation .purchase-consent {
  margin: 0;
}
.order-reconciliation .btn {
  white-space: normal;
  max-width: 100%;
}
.inline-error {
  font-size: 12px;
  line-height: 1.8;
  padding: 13px;
  background: var(--status-danger-bg);
  color: var(--text-primary);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  margin: 16px 0;
  overflow-wrap: anywhere;
}
.purchase-plan {
  padding: 4px 0 4px;
}
.purchase-plan h3 {
  margin-bottom: 24px;
}
.review-lines {
  margin-top: 24px;
}
.purchase-consent {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.8;
  margin-top: 24px;
  cursor: pointer;
}
.purchase-consent input {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
  margin-top: 3px;
  accent-color: var(--accent-primary);
}
.requote-button {
  width: 100%;
  margin-top: 16px;
}
.order-created {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 16px;
  text-align: center;
  padding: 32px 4px;
}
.created-check {
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  color: var(--accent-primary);
  background: var(--bg-active);
  border-radius: 50%;
}
.order-created h3 {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.03em;
}
.order-created p {
  font-size: 12px;
  line-height: 1.8;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.sr-only {
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
@media (min-width: 1440px) {
  .purchase-layout {
    grid-template-columns: minmax(0, 1fr) 344px;
    gap: 28px;
  }
  .selection-section {
    padding: 28px;
  }
  .order-summary {
    padding: 28px;
  }
}
@media (max-width: 1100px) {
  .purchase-layout {
    grid-template-columns: minmax(0, 1fr) 292px;
    gap: 18px;
  }
  .selection-section,
  .order-summary {
    padding: 20px;
  }
  .plan-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 800px) {
  .catalog-page {
    padding-bottom: 108px;
  }
  .catalog-heading {
    align-items: flex-start;
    padding: 4px 0 24px;
  }
  .catalog-heading h1 {
    font-size: 25px;
  }
  .catalog-heading p {
    font-size: 12px;
    max-width: 360px;
  }
  .refresh-btn {
    padding: 9px;
    min-height: 40px;
  }
  .refresh-btn span {
    display: none;
  }
  .purchase-layout {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .purchase-options {
    gap: 16px;
  }
  .selection-section,
  .order-summary {
    padding: 20px;
    border-radius: 12px;
  }
  .section-heading {
    margin-bottom: 19px;
  }
  .order-summary {
    position: static;
  }
  .plan-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .summary-actions {
    display: none;
  }
  .order-summary :deep(.product-specs) {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .summary-lines {
    margin-top: 20px;
    padding: 20px 0;
  }
  .summary-total {
    grid-template-columns: 1fr auto;
    align-items: baseline;
    gap: 7px 16px;
  }
  .summary-total strong {
    font-size: 26px;
  }
  .summary-total small {
    grid-column: 2;
    text-align: right;
  }
  .mobile-purchase-bar {
    position: fixed;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    left: 0;
    right: 0;
    bottom: var(
      --mobile-nav-height,
      calc(59px + max(8px, env(safe-area-inset-bottom)))
    );
    padding: 14px 20px;
    background: var(--bg-surface);
    border-top: 1px solid var(--border-subtle);
    z-index: 35;
  }
  .mobile-purchase-bar > div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .mobile-purchase-bar > div > span {
    font-size: 10px;
    color: var(--text-secondary);
  }
  .mobile-purchase-bar strong {
    font-size: 20px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .mobile-purchase-bar small {
    font: 400 10px var(--font-sans);
    color: var(--text-secondary);
    margin-left: 6px;
  }
  .mobile-purchase-bar .btn {
    font-size: 12px;
    min-height: 44px;
    flex-shrink: 0;
    gap: 14px;
  }
}
@media (max-width: 520px) {
  .plan-grid {
    grid-template-columns: 1fr;
  }
  .catalog-region {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .catalog-type,
  .catalog-node {
    grid-template-columns: minmax(0, 1fr);
  }
  .catalog-type button,
  .catalog-region button,
  .catalog-node button {
    min-width: 0;
    width: 100%;
    font-size: 13px;
  }
  .sign-in-hint {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }
  .order-summary :deep(.product-specs) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .mobile-purchase-bar {
    padding-inline: 16px;
  }
  .mobile-purchase-bar .btn {
    padding-inline: 15px;
    gap: 9px;
  }
  .summary-total strong {
    font-size: 24px;
  }
  .section-meta {
    font-size: 10px;
  }
}
</style>

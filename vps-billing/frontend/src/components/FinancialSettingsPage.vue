<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Check, Plus, RefreshCw, Save } from "@lucide/vue";
import { api, ApiError } from "../lib/api";
import { tr } from "../lib/i18n";
import {
  canonicalAmount,
  currencyWritePayload,
  readCurrencyRegistry,
  readCurrencyBlocker,
  readPlanPrices,
  type CurrencyDefinition,
  type CurrencyRegistry,
  type PlanPriceList,
} from "../lib/currencies";

const props = defineProps<{ preview: boolean }>();
const emit = defineEmits<{
  saved: [registry: CurrencyRegistry];
  pricesSaved: [];
}>();
const page = ref<HTMLElement>();
const registry = ref<CurrencyRegistry>();
const registryDraft = ref<CurrencyRegistry>();
const prices = ref<PlanPriceList>();
const priceDraft = ref<PlanPriceList>();
const selectedCurrency = ref("CNY");
const registryLoading = ref(false),
  priceLoading = ref(false);
const registrySaving = ref(false),
  priceSaving = ref(false);
const registryBlocked = ref(false),
  priceBlocked = ref(false);
const registrySaved = ref(false),
  priceSaved = ref(false);
type Failure =
  | ""
  | "load"
  | "invalid"
  | "conflict"
  | "session"
  | "uncertain"
  | "in_use"
  | "precision"
  | "unavailable";
const registryError = ref<Failure>(""),
  priceError = ref<Failure>("");
const registryBlocker = ref<ReturnType<typeof readCurrencyBlocker>>();
const registryIssues = ref<Record<string, boolean>>({});
const priceIssues = ref<Record<string, boolean>>({});
let generation = 0,
  priceGeneration = 0;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const busy = computed(
  () =>
    registryLoading.value ||
    priceLoading.value ||
    registrySaving.value ||
    priceSaving.value,
);
const registryDirty = computed(
  () =>
    !!registry.value &&
    !!registryDraft.value &&
    JSON.stringify(registry.value) !== JSON.stringify(registryDraft.value),
);
const priceDirty = computed(
  () =>
    !!prices.value &&
    !!priceDraft.value &&
    JSON.stringify(prices.value.plans) !==
      JSON.stringify(priceDraft.value.plans),
);
const currencyOptions = computed(() => registry.value?.currencies ?? []);
const currentFormat = computed(() => priceDraft.value?.currency_format);
const selectedDefinition = computed(() =>
  registry.value?.currencies.find(
    (item) => item.code === selectedCurrency.value,
  ),
);
const currencyFields = ["name", "prefix", "suffix"] as const;

function previewRegistry(): CurrencyRegistry {
  return readCurrencyRegistry({
    revision: 1,
    default_currency: "CNY",
    currencies: [
      {
        code: "CNY",
        name: "人民币",
        prefix: "¥",
        suffix: "",
        decimal_places: 2,
        enabled: true,
        sort_order: 0,
        precision_locked: true,
        usage: {
          plan_prices: 2,
          orders: 0,
          invoices: 0,
          services: 0,
          pending_orders: 0,
          unpaid_invoices: 0,
          ongoing_services: 0,
        },
      },
    ],
  });
}
function previewPrices(): PlanPriceList {
  return readPlanPrices(
    {
      revision: 1,
      currency: "CNY",
      currency_format: previewRegistry().currencies[0],
      plans: [
        {
          plan_id: "preview-small",
          plan_name: "Aster Basic",
          plan_available: true,
          amount: "39.00",
          amount_minor: 3900,
          available: true,
        },
        {
          plan_id: "preview-standard",
          plan_name: "Aster Standard",
          plan_available: true,
          amount: "",
          amount_minor: 0,
          available: false,
        },
      ],
    },
    "CNY",
  );
}
function errorText(error: Failure, fieldIssues: Record<string, boolean>) {
  return {
    "": "",
    load: tr(
      "无法读取财务配置，请确认管理员会话后重试。",
      "Could not load financial settings. Check your administrator session and retry.",
    ),
    invalid: Object.keys(fieldIssues).length
      ? tr(
          "请检查标注字段。金额须大于零，不能超过币种精度或安全金额上限。",
          "Check the highlighted fields. Prices must be positive and within the currency precision and supported amount limit.",
        )
      : tr(
          "服务器未接受这份财务配置。草稿仍保留；请核对配置，必要时复制草稿后重新读取。",
          "The server did not accept this financial configuration. Your draft is retained. Review the configuration; if needed, copy your draft before reloading.",
        ),
    conflict: tr(
      "配置已被其他管理员修改。草稿仍保留；请先复制需要的内容，再重新读取。",
      "Another administrator changed this configuration. Your draft is retained; copy any changes you need, then reload.",
    ),
    session: tr(
      "管理员会话或操作验证已失效，请重新登录后读取配置。",
      "Your administrator session or request verification expired. Sign in again, then reload.",
    ),
    uncertain: tr(
      "无法确认保存结果。请先保留草稿并重新读取，核对服务器记录后再编辑。不会自动重试。",
      "The save result is unknown. Keep a copy of your draft, then reload and check the saved records before editing. No automatic retry will occur.",
    ),
    in_use: tr(
      "该币种仍有待付款订单、未付账单或运行中服务，暂时不能停用。请重新读取并核对使用情况。",
      "This currency still has pending orders, unpaid invoices or ongoing services and cannot be disabled. Reload to check its usage.",
    ),
    precision: tr(
      "该币种已有金额记录，不能更改小数位数。请重新读取。",
      "This currency already has recorded amounts; its decimal places cannot be changed. Reload the configuration.",
    ),
    unavailable: tr(
      "币种或套餐状态已变化，保存未完成。请重新读取后检查可售状态。",
      "The currency or plan status changed and the save did not complete. Reload and check availability.",
    ),
  }[error];
}
function classify(cause: unknown): Failure {
  if (!(cause instanceof ApiError)) return "uncertain";
  if (["INVALID_CURRENCY_CONFIG", "INVALID_PLAN_PRICES"].includes(cause.code))
    return "invalid";
  if (["CURRENCY_CONFLICT", "PRICE_CONFLICT"].includes(cause.code))
    return "conflict";
  if (cause.code === "CURRENCY_IN_USE") return "in_use";
  if (cause.code === "CURRENCY_PRECISION_LOCKED") return "precision";
  if (
    ["CURRENCY_DISABLED", "UNSUPPORTED_CURRENCY", "PLAN_UNAVAILABLE"].includes(
      cause.code,
    )
  )
    return "unavailable";
  if (
    [
      "AUTH_REQUIRED",
      "FORBIDDEN",
      "UNAUTHORIZED",
      "UNAUTHENTICATED",
      "CSRF_INVALID",
      "INVALID_CSRF",
      "CSRF_FAILED",
      "ORIGIN_DENIED",
    ].includes(cause.code)
  )
    return "session";
  return "uncertain";
}
function obligations(item: CurrencyDefinition) {
  return (
    (item.usage?.pending_orders ?? 0) +
    (item.usage?.unpaid_invoices ?? 0) +
    (item.usage?.ongoing_services ?? 0)
  );
}
function disableReason(item: CurrencyDefinition) {
  if (item.code === registryDraft.value?.default_currency)
    return tr(
      "默认币种必须启用；请先选择另一个已启用币种。",
      "The default currency must remain enabled. Choose another enabled default first.",
    );
  if (obligations(item) > 0)
    return tr(
      "仍有待付款订单、未付账单或运行中服务，不能停用。",
      "Pending orders, unpaid invoices or ongoing services prevent disabling this currency.",
    );
  return "";
}
function currencyContext(item: CurrencyDefinition, index: number) {
  return item.code || `${tr("新币种", "New currency")} ${index + 1}`;
}
function currencyFieldLabel(field: (typeof currencyFields)[number]) {
  return field === "name"
    ? tr("显示名称", "Display name")
    : field === "prefix"
      ? tr("金额前缀", "Amount prefix")
      : tr("金额后缀", "Amount suffix");
}
function priceId(planId: string, part: string) {
  return `price-${selectedCurrency.value}-${encodeURIComponent(planId)}-${part}`;
}
function fieldName(index: number, field: string) {
  return `currency-${index}-${field}`;
}
function textValid(value: string, max: number, required = false) {
  return (
    (!required || !!value.trim()) &&
    new TextEncoder().encode(value).length <= max &&
    !/[\p{Cc}\p{Cf}\p{Cs}<>]/u.test(value)
  );
}
function validateRegistry() {
  const draft = registryDraft.value;
  if (!draft) return false;
  const issues: Record<string, boolean> = {};
  const codes = new Set<string>();
  draft.currencies.forEach((item, index) => {
    if (!/^[A-Z]{3}$/.test(item.code) || codes.has(item.code))
      issues[fieldName(index, "code")] = true;
    codes.add(item.code);
    if (!textValid(item.name, 80, true))
      issues[fieldName(index, "name")] = true;
    for (const key of ["prefix", "suffix"] as const)
      if (!textValid(item[key], 24)) issues[fieldName(index, key)] = true;
    if (
      !Number.isInteger(item.decimal_places) ||
      item.decimal_places < 0 ||
      item.decimal_places > 6
    )
      issues[fieldName(index, "decimal_places")] = true;
    if (
      !Number.isInteger(item.sort_order) ||
      item.sort_order < 0 ||
      item.sort_order > 10000
    )
      issues[fieldName(index, "sort_order")] = true;
  });
  if (
    !draft.currencies.some(
      (item) => item.code === draft.default_currency && item.enabled,
    )
  )
    issues.default_currency = true;
  registryIssues.value = issues;
  return !Object.keys(issues).length;
}
async function focusInvalid(form: "currency" | "price") {
  await nextTick();
  page.value
    ?.querySelector<HTMLElement>(
      `[data-testid="${form}-form"] [aria-invalid="true"]`,
    )
    ?.focus();
}
async function loadRegistry() {
  if (registrySaving.value || priceSaving.value) return;
  const current = ++generation;
  ++priceGeneration;
  registryLoading.value = true;
  priceLoading.value = false;
  registry.value = registryDraft.value = undefined;
  prices.value = priceDraft.value = undefined;
  registryError.value = priceError.value = "";
  registryBlocker.value = undefined;
  registryBlocked.value = priceBlocked.value = false;
  registrySaved.value = priceSaved.value = false;
  registryIssues.value = {};
  priceIssues.value = {};
  try {
    const result = props.preview
      ? previewRegistry()
      : readCurrencyRegistry(await api<unknown>("/admin/currencies"));
    if (current !== generation) return;
    registry.value = result;
    registryDraft.value = clone(result);
    if (!result.currencies.some((item) => item.code === selectedCurrency.value))
      selectedCurrency.value = result.default_currency;
  } catch {
    if (current === generation) registryError.value = "load";
  } finally {
    if (current === generation) registryLoading.value = false;
  }
  if (current === generation && registry.value) await loadPrices();
}
async function loadPrices() {
  if (registrySaving.value || priceSaving.value || !registry.value) return;
  const current = generation,
    request = ++priceGeneration,
    code = selectedCurrency.value;
  priceLoading.value = true;
  prices.value = priceDraft.value = undefined;
  priceError.value = "";
  priceBlocked.value = false;
  priceSaved.value = false;
  priceIssues.value = {};
  try {
    const result = props.preview
      ? previewPrices()
      : readPlanPrices(
          await api<unknown>(
            `/admin/plan-prices?currency=${encodeURIComponent(code)}`,
          ),
          code,
        );
    if (current !== generation || request !== priceGeneration) return;
    prices.value = result;
    priceDraft.value = clone(result);
  } catch {
    if (current === generation && request === priceGeneration)
      priceError.value = "load";
  } finally {
    if (current === generation && request === priceGeneration)
      priceLoading.value = false;
  }
}
function addCurrency() {
  if (
    props.preview ||
    busy.value ||
    registryBlocked.value ||
    priceDirty.value ||
    !registryDraft.value ||
    registryDraft.value.currencies.length >= 32
  )
    return;
  registryDraft.value.currencies.push({
    code: "",
    name: "",
    prefix: "",
    suffix: "",
    decimal_places: 2,
    enabled: false,
    sort_order: Math.min(
      10000,
      Math.max(
        0,
        ...registryDraft.value.currencies.map((item) => item.sort_order),
      ) + 1,
    ),
    precision_locked: false,
  });
}
function removeNew(index: number) {
  const item = registryDraft.value?.currencies[index];
  if (
    props.preview ||
    busy.value ||
    registryBlocked.value ||
    !item ||
    index < (registry.value?.currencies.length ?? 0)
  )
    return;
  registryDraft.value!.currencies.splice(index, 1);
}
async function saveRegistry() {
  if (
    props.preview ||
    busy.value ||
    registryBlocked.value ||
    priceDirty.value ||
    !registryDirty.value ||
    !registryDraft.value
  )
    return;
  registrySaved.value = false;
  registryError.value = "";
  registryBlocker.value = undefined;
  if (!validateRegistry()) {
    registryError.value = "invalid";
    await focusInvalid("currency");
    return;
  }
  const current = generation,
    submitted = currencyWritePayload(registryDraft.value);
  registrySaving.value = true;
  try {
    const result = readCurrencyRegistry(
      await api<unknown>("/admin/currencies", "POST", submitted),
    );
    if (current !== generation || props.preview) return;
    if (result.revision <= submitted.revision)
      throw new Error("INVALID_SAVE_REVISION");
    registry.value = result;
    registryDraft.value = clone(result);
    registrySaved.value = true;
    emit("saved", result);
  } catch (cause) {
    if (current === generation) {
      registryError.value = classify(cause);
      if (cause instanceof ApiError && cause.code === "CURRENCY_IN_USE")
        registryBlocker.value = readCurrencyBlocker(cause.details);
      registryBlocked.value = registryError.value !== "invalid";
    }
  } finally {
    if (current === generation) registrySaving.value = false;
  }
  if (current === generation && registrySaved.value) await loadPrices();
}
async function savePrices() {
  if (
    props.preview ||
    busy.value ||
    priceBlocked.value ||
    registryDirty.value ||
    !priceDirty.value ||
    !priceDraft.value ||
    !prices.value
  )
    return;
  priceSaved.value = false;
  priceError.value = "";
  const issues: Record<string, boolean> = {};
  const changed = priceDraft.value.plans.filter(
    (item, index) =>
      JSON.stringify(item) !== JSON.stringify(prices.value!.plans[index]),
  );
  const updates = changed.map((item) => {
    let amount = item.amount;
    try {
      amount = canonicalAmount(
        amount,
        priceDraft.value!.currency_format.decimal_places,
      );
    } catch {
      issues[item.plan_id] = true;
    }
    return {
      plan_id: item.plan_id,
      amount,
      available: item.available,
      plan_available: item.plan_available,
    };
  });
  priceIssues.value = issues;
  if (Object.keys(issues).length) {
    priceError.value = "invalid";
    await focusInvalid("price");
    return;
  }
  const current = generation,
    request = priceGeneration,
    submitted = {
      revision: priceDraft.value.revision,
      currency: priceDraft.value.currency,
      prices: updates,
    };
  priceSaving.value = true;
  try {
    const result = readPlanPrices(
      await api<unknown>("/admin/plan-prices", "POST", submitted),
      submitted.currency,
    );
    if (current !== generation || request !== priceGeneration || props.preview)
      return;
    if (result.revision <= submitted.revision)
      throw new Error("INVALID_SAVE_REVISION");
    prices.value = result;
    priceDraft.value = clone(result);
    priceSaved.value = true;
    emit("pricesSaved");
    // Creating the first price locks precision and advances the registry revision.
    // Refresh that metadata before permitting another edit on this page.
    if (!selectedDefinition.value?.precision_locked) {
      try {
        const refreshed = readCurrencyRegistry(
          await api<unknown>("/admin/currencies"),
        );
        if (
          current !== generation ||
          request !== priceGeneration ||
          props.preview
        )
          return;
        if (refreshed.revision < (registry.value?.revision ?? 0))
          throw new Error("STALE_REGISTRY");
        registry.value = refreshed;
        registryDraft.value = clone(refreshed);
        emit("saved", refreshed);
      } catch {
        if (current === generation) {
          registryError.value = "load";
          registryBlocked.value = true;
        }
      }
    }
  } catch (cause) {
    if (current === generation && request === priceGeneration) {
      priceError.value = classify(cause);
      priceBlocked.value = priceError.value !== "invalid";
    }
  } finally {
    if (current === generation && request === priceGeneration)
      priceSaving.value = false;
  }
}
watch(
  registryDraft,
  () => {
    registrySaved.value = false;
    if (registryError.value === "invalid") {
      registryError.value = "";
      registryIssues.value = {};
    }
  },
  { deep: true, flush: "sync" },
);
watch(
  priceDraft,
  () => {
    priceSaved.value = false;
    if (priceError.value === "invalid") {
      priceError.value = "";
      priceIssues.value = {};
    }
  },
  { deep: true, flush: "sync" },
);
watch(
  () => props.preview,
  () => {
    ++generation;
    ++priceGeneration;
    registrySaving.value = priceSaving.value = false;
    void loadRegistry();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  ++generation;
  ++priceGeneration;
});
</script>

<template>
  <section ref="page" class="financial-settings" :aria-busy="busy">
    <header class="financial-intro">
      <div>
        <h2>{{ tr("币种与套餐定价", "Currencies and plan pricing") }}</h2>
        <p>
          {{
            tr(
              "每种币种独立定价，不进行自动换汇。历史订单和账单保留原币种与金额。",
              "Set independent prices for each currency. No automatic exchange conversion is performed. Historical orders and invoices retain their recorded currency and amount.",
            )
          }}
        </p>
      </div>
    </header>
    <p v-if="preview" class="financial-notice" role="status">
      {{
        tr(
          "只读预览：下方为示例配置，不会读取或保存服务器数据。",
          "Read-only preview: these are sample settings. No server data is read or saved.",
        )
      }}
    </p>
    <p v-if="registryLoading" role="status">
      {{ tr("正在读取财务配置…", "Loading financial settings…") }}
    </p>
    <div
      v-if="registryError"
      class="financial-error"
      role="alert"
      data-testid="currency-error"
    >
      <p>{{ errorText(registryError, registryIssues) }}</p>
      <p v-if="registryBlocker" data-testid="currency-blocker-counts">
        {{ registryBlocker.currency }} ·
        {{ tr("待付款订单", "Pending orders") }}
        {{ registryBlocker.usage.pending_orders }} ·
        {{ tr("未付账单", "Unpaid invoices") }}
        {{ registryBlocker.usage.unpaid_invoices }} ·
        {{ tr("运行中服务", "Ongoing services") }}
        {{ registryBlocker.usage.ongoing_services }}
      </p>
      <button
        v-if="!registry"
        class="button secondary"
        type="button"
        :disabled="busy"
        @click="loadRegistry"
      >
        <RefreshCw :size="16" />{{ tr("重试读取", "Retry loading") }}
      </button>
    </div>
    <template v-if="registryDraft">
      <form
        class="financial-panel"
        data-testid="currency-form"
        novalidate
        @submit.prevent="saveRegistry"
      >
        <div class="financial-heading">
          <div>
            <h3>{{ tr("币种管理", "Currency management") }}</h3>
            <p>
              {{
                tr(
                  "币种代码创建后不可修改；已有金额记录的币种不能更改小数位数。",
                  "Currency codes cannot change after creation. Decimal places are locked once amounts have been recorded.",
                )
              }}
            </p>
          </div>
          <span class="financial-revision"
            >{{ tr("版本", "Revision") }} {{ registryDraft.revision }}</span
          >
        </div>
        <p v-if="priceDirty" class="financial-notice">
          {{
            tr(
              "请先保存或重新读取套餐价格，再修改币种。",
              "Save or reload your plan price changes before editing currencies.",
            )
          }}
        </p>
        <fieldset :disabled="preview || busy || priceDirty">
          <label class="financial-default"
            >{{ tr("默认币种", "Default currency")
            }}<select
              v-model="registryDraft.default_currency"
              name="default_currency"
              :aria-invalid="registryIssues.default_currency || undefined"
            >
              <option
                v-for="item in registryDraft.currencies.filter(
                  (item) => item.enabled && /^[A-Z]{3}$/.test(item.code),
                )"
                :key="item.code"
                :value="item.code"
              >
                {{ item.code }} · {{ item.name }}
              </option></select
            ><small>{{
              tr(
                "用于新访客和未选择币种的请求，不改变历史金额。",
                "Used for new visitors and requests without a currency selection; historical amounts remain unchanged.",
              )
            }}</small></label
          >
          <div class="currency-cards">
            <article
              v-for="(item, index) in registryDraft.currencies"
              :key="index"
              class="currency-card"
              role="group"
              :aria-labelledby="`currency-group-${index}`"
              :data-currency="item.code"
            >
              <div class="currency-title">
                <strong :id="`currency-group-${index}`">{{
                  currencyContext(item, index)
                }}</strong
                ><span
                  v-if="item.code === registryDraft.default_currency"
                  class="financial-badge"
                  >{{ tr("默认", "Default") }}</span
                ><button
                  v-if="index >= (registry?.currencies.length ?? 0)"
                  type="button"
                  class="financial-link"
                  :disabled="registryBlocked"
                  :aria-label="`${currencyContext(item, index)} · ${tr('移除未保存项', 'Remove unsaved entry')}`"
                  @click="removeNew(index)"
                >
                  {{ tr("移除未保存项", "Remove unsaved entry") }}
                </button>
              </div>
              <div class="currency-fields">
                <label
                  >{{ tr("币种代码", "Currency code")
                  }}<input
                    v-model="item.code"
                    :name="fieldName(index, 'code')"
                    :aria-label="`${currencyContext(item, index)} · ${tr('币种代码', 'Currency code')}`"
                    :disabled="index < (registry?.currencies.length ?? 0)"
                    :aria-invalid="
                      registryIssues[fieldName(index, 'code')] || undefined
                    "
                    maxlength="3"
                    autocomplete="off"
                    autocapitalize="characters"
                    spellcheck="false"
                    placeholder="CNY"
                  /><small>{{
                    tr("3 位大写英文字母", "3 uppercase ASCII letters")
                  }}</small></label
                >
                <label v-for="field in currencyFields" :key="field"
                  >{{ currencyFieldLabel(field)
                  }}<input
                    v-model="item[field]"
                    :name="fieldName(index, field)"
                    :aria-label="`${currencyContext(item, index)} · ${currencyFieldLabel(field)}`"
                    :aria-invalid="
                      registryIssues[fieldName(index, field)] || undefined
                    "
                    :maxlength="field === 'name' ? 80 : 24"
                  /><small>{{
                    field === "name"
                      ? tr("最多 80 个 UTF-8 字节", "Up to 80 UTF-8 bytes")
                      : tr(
                          "最多 24 个 UTF-8 字节，可留空",
                          "Up to 24 UTF-8 bytes; optional",
                        )
                  }}</small></label
                >
                <label
                  >{{ tr("小数位数", "Decimal places")
                  }}<select
                    v-model="item.decimal_places"
                    :name="fieldName(index, 'decimal_places')"
                    :aria-label="`${currencyContext(item, index)} · ${tr('小数位数', 'Decimal places')}`"
                    :disabled="item.precision_locked"
                    :aria-invalid="
                      registryIssues[fieldName(index, 'decimal_places')] ||
                      undefined
                    "
                  >
                    <option v-for="n in 7" :key="n" :value="n - 1">
                      {{ n - 1 }}
                    </option></select
                  ><small v-if="item.precision_locked">{{
                    tr(
                      "已有金额记录，精度已锁定",
                      "Precision locked by recorded amounts",
                    )
                  }}</small></label
                >
                <label
                  >{{ tr("排序", "Sort order")
                  }}<input
                    v-model.number="item.sort_order"
                    :name="fieldName(index, 'sort_order')"
                    :aria-label="`${currencyContext(item, index)} · ${tr('排序', 'Sort order')}`"
                    type="number"
                    min="0"
                    max="10000"
                    step="1"
                    :aria-invalid="
                      registryIssues[fieldName(index, 'sort_order')] ||
                      undefined
                    "
                  /><small>{{
                    tr(
                      "0–10000，较小值排在前面",
                      "0–10000; lower values appear first",
                    )
                  }}</small></label
                >
              </div>
              <label class="financial-check"
                ><input
                  v-model="item.enabled"
                  type="checkbox"
                  :name="fieldName(index, 'enabled')"
                  :aria-label="`${currencyContext(item, index)} · ${tr('启用此币种', 'Enable this currency')}`"
                  :disabled="item.enabled && !!disableReason(item)"
                />{{ tr("启用此币种", "Enable this currency") }}</label
              >
              <p v-if="disableReason(item)" class="financial-help">
                {{ disableReason(item) }}
              </p>
              <p v-if="item.usage" class="financial-usage">
                {{ tr("待付款订单", "Pending orders") }}
                {{ item.usage.pending_orders }} ·
                {{ tr("未付账单", "Unpaid invoices") }}
                {{ item.usage.unpaid_invoices }} ·
                {{ tr("运行中服务", "Ongoing services") }}
                {{ item.usage.ongoing_services }}
              </p>
            </article>
          </div>
          <button
            class="button secondary"
            type="button"
            data-testid="add-currency"
            :disabled="registryBlocked || registryDraft.currencies.length >= 32"
            @click="addCurrency"
          >
            <Plus :size="16" />{{ tr("添加币种", "Add currency") }}
          </button>
        </fieldset>
        <div class="financial-actions">
          <button
            class="button primary"
            type="submit"
            :disabled="
              preview || busy || registryBlocked || priceDirty || !registryDirty
            "
          >
            <Save :size="16" />{{
              registrySaving
                ? tr("正在保存…", "Saving…")
                : tr("保存币种配置", "Save currencies")
            }}</button
          ><button
            class="button secondary"
            type="button"
            data-testid="reload-currencies"
            :disabled="busy || priceDirty"
            @click="loadRegistry"
          >
            <RefreshCw :size="16" />{{
              tr("重新读取币种配置", "Reload currencies")
            }}</button
          ><span v-if="registrySaved" role="status" class="financial-success"
            ><Check :size="16" />{{
              tr("币种配置已保存", "Currencies saved")
            }}</span
          >
        </div>
        <p v-if="registryDirty" class="financial-help">
          {{
            tr(
              "有未保存修改；重新读取会丢弃本页草稿。",
              "You have unsaved changes. Reloading discards this draft.",
            )
          }}
        </p>
      </form>

      <form
        class="financial-panel"
        data-testid="price-form"
        novalidate
        @submit.prevent="savePrices"
      >
        <div class="financial-heading">
          <div>
            <h3>{{ tr("套餐价格", "Plan prices") }}</h3>
            <p>
              {{
                tr(
                  "填写该币种的完整金额。没有价格或价格未启用时，该套餐不能以此币种购买。",
                  "Enter a full price in this currency. A plan cannot be purchased in a currency with no price or with a disabled price.",
                )
              }}
            </p>
          </div>
          <span v-if="priceDraft" class="financial-revision"
            >{{ tr("版本", "Revision") }} {{ priceDraft.revision }}</span
          >
        </div>
        <label class="financial-default"
          >{{ tr("定价币种", "Pricing currency")
          }}<select
            v-model="selectedCurrency"
            name="pricing_currency"
            :disabled="busy || priceDirty || registryDirty || preview"
            @change="loadPrices"
          >
            <option
              v-for="item in currencyOptions"
              :key="item.code"
              :value="item.code"
            >
              {{ item.code }} · {{ item.name
              }}{{ item.enabled ? "" : tr("（已停用）", " (disabled)") }}
            </option>
          </select></label
        >
        <p
          v-if="selectedDefinition && !selectedDefinition.enabled"
          class="financial-notice"
          data-testid="disabled-currency-notice"
        >
          {{
            tr(
              "此币种已停用。可以提前配置独立价格，但启用币种前不能产生新的购买。保存价格不会启用币种。",
              "This currency is disabled. You can prepare independent prices, but new purchases remain unavailable until the currency is enabled. Saving prices does not enable it.",
            )
          }}
        </p>
        <p v-if="registryDirty" class="financial-notice">
          {{
            tr(
              "请先保存或重新读取币种配置，再编辑套餐价格。",
              "Save or reload currency changes before editing plan prices.",
            )
          }}
        </p>
        <p v-if="priceLoading" role="status">
          {{ tr("正在读取套餐价格…", "Loading plan prices…") }}
        </p>
        <div
          v-if="priceError"
          class="financial-error"
          role="alert"
          data-testid="price-error"
        >
          <p>{{ errorText(priceError, priceIssues) }}</p>
          <button
            v-if="!priceDraft"
            class="button secondary"
            type="button"
            :disabled="busy || registryDirty"
            @click="loadPrices"
          >
            <RefreshCw :size="16" />{{ tr("重试读取", "Retry loading") }}
          </button>
        </div>
        <template v-if="priceDraft && currentFormat">
          <p class="financial-help">
            {{ tr("当前精度：", "Decimal places: ")
            }}{{ currentFormat.decimal_places }} ·
            {{
              tr(
                "“套餐总开关”影响所有币种；“此币种价格可售”仅影响当前币种。",
                "“Plan enabled globally” affects every currency. “Price enabled” applies only to the selected currency.",
              )
            }}
          </p>
          <fieldset :disabled="preview || busy || registryDirty">
            <div class="price-cards">
              <article
                v-for="(item, index) in priceDraft.plans"
                :key="item.plan_id"
                class="price-card"
                role="group"
                :aria-labelledby="priceId(item.plan_id, 'heading')"
                :data-plan="item.plan_id"
              >
                <div class="price-title">
                  <strong :id="priceId(item.plan_id, 'heading')"
                    >{{ item.plan_name
                    }}<span class="settings-sr-only">
                      · {{ selectedCurrency }}</span
                    ></strong
                  ><span>{{
                    !item.amount
                      ? tr("未设置价格", "Price not set")
                      : item.available && item.plan_available
                        ? tr("价格已启用", "Price enabled")
                        : tr("不可购买", "Unavailable")
                  }}</span>
                </div>
                <label
                  >{{ tr("月付金额", "Monthly amount") }}
                  <div class="price-input">
                    <span v-if="currentFormat.prefix">{{
                      currentFormat.prefix
                    }}</span
                    ><input
                      v-model="item.amount"
                      :name="`price-${index}-amount`"
                      inputmode="decimal"
                      type="text"
                      autocomplete="off"
                      spellcheck="false"
                      :aria-invalid="priceIssues[item.plan_id] || undefined"
                      :aria-describedby="
                        priceIssues[item.plan_id]
                          ? priceId(item.plan_id, 'error')
                          : undefined
                      "
                      :aria-label="`${item.plan_name} · ${selectedCurrency} · ${tr('月付金额', 'Monthly amount')}`"
                      :placeholder="
                        currentFormat.decimal_places
                          ? `0.${'0'.repeat(currentFormat.decimal_places)}`
                          : '0'
                      "
                    /><span v-if="currentFormat.suffix">{{
                      currentFormat.suffix
                    }}</span
                    ><span>{{ selectedCurrency }}</span>
                  </div>
                  <small
                    v-if="priceIssues[item.plan_id]"
                    :id="priceId(item.plan_id, 'error')"
                    class="financial-field-error"
                    >{{
                      tr(
                        "请填写正数金额，不使用逗号、指数或超出精度的小数。已有价格不能清空。",
                        "Enter a positive amount without commas, exponents or extra decimal places. Existing prices cannot be cleared.",
                      )
                    }}</small
                  ></label
                >
                <div class="price-switches">
                  <label class="financial-check"
                    ><input
                      v-model="item.available"
                      :name="`price-${index}-available`"
                      :aria-label="`${item.plan_name} · ${selectedCurrency} · ${tr('此币种价格可售', 'Price enabled')}`"
                      type="checkbox"
                      :disabled="!item.amount"
                    />{{ tr("此币种价格可售", "Price enabled") }}</label
                  ><label class="financial-check"
                    ><input
                      v-model="item.plan_available"
                      :name="`price-${index}-plan-available`"
                      :aria-label="`${item.plan_name} · ${tr('套餐总开关（所有币种）', 'Plan enabled globally (all currencies)')}`"
                      type="checkbox"
                      :disabled="!item.amount"
                    />{{
                      tr("套餐总开关（所有币种）", "Plan enabled globally")
                    }}</label
                  >
                </div>
              </article>
            </div>
            <p v-if="priceDraft.plans.length === 0" class="financial-help">
              {{ tr("暂无可配置套餐。", "There are no plans to price.") }}
            </p>
          </fieldset>
          <div class="financial-actions">
            <button
              class="button primary"
              type="submit"
              :disabled="
                preview || busy || priceBlocked || registryDirty || !priceDirty
              "
            >
              <Save :size="16" />{{
                priceSaving
                  ? tr("正在保存…", "Saving…")
                  : tr("保存此币种价格", "Save prices for this currency")
              }}</button
            ><button
              class="button secondary"
              type="button"
              data-testid="reload-prices"
              :disabled="busy || registryDirty"
              @click="loadPrices"
            >
              <RefreshCw :size="16" />{{
                tr("重新读取价格", "Reload prices")
              }}</button
            ><span v-if="priceSaved" role="status" class="financial-success"
              ><Check :size="16" />{{
                tr("套餐价格已保存", "Plan prices saved")
              }}</span
            >
          </div>
          <p v-if="priceDirty" class="financial-help">
            {{
              tr(
                "有未保存价格；保存或重新读取后可切换币种。重新读取会丢弃草稿。",
                "You have unsaved prices. Save or reload before switching currencies. Reloading discards this draft.",
              )
            }}
          </p>
        </template>
      </form>
    </template>
  </section>
</template>

<style scoped>
.financial-settings {
  display: grid;
  gap: 24px;
  min-width: 0;
}
.financial-intro p,
.financial-heading p {
  color: var(--text-secondary);
  line-height: 1.7;
  margin-top: 8px;
  max-width: 800px;
}
.financial-panel {
  padding: 24px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  min-width: 0;
}
.financial-heading {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 16px;
  margin-bottom: 22px;
}
.financial-revision {
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 14px;
}
fieldset {
  padding: 0;
  margin: 0;
  border: 0;
  min-width: 0;
}
label {
  display: grid;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  min-width: 0;
}
label small,
.financial-help,
.financial-usage {
  font-size: 14px;
  font-weight: 400;
  line-height: 1.7;
  color: var(--text-secondary);
}
select {
  width: 100%;
  min-width: 0;
  padding: 11px 12px;
  color: inherit;
  background: var(--surface);
  font: inherit;
  border: 1px solid var(--control-border);
  border-radius: 9px;
}
select:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
input:disabled,
select:disabled {
  background: var(--page-background);
  color: var(--text-secondary);
}
input[aria-invalid="true"],
select[aria-invalid="true"] {
  border-color: var(--status-danger);
}
.financial-default {
  max-width: 420px;
  margin-bottom: 20px;
}
.currency-cards,
.price-cards {
  display: grid;
  gap: 14px;
  margin-bottom: 18px;
}
.currency-card,
.price-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 18px;
  min-width: 0;
}
.currency-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 18px;
}
.financial-badge {
  font-size: 12px;
  padding: 3px 7px;
  border-radius: 6px;
  color: var(--brand-ink);
  background: color-mix(in srgb, var(--blue) 7%, white);
}
.financial-link {
  margin-left: auto;
  padding: 4px;
  color: var(--brand-ink);
  font-size: 14px;
}
.currency-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  margin-bottom: 16px;
}
.financial-check {
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1.5;
}
.financial-check input {
  margin: 0;
}
.financial-help,
.financial-usage {
  margin-top: 10px;
}
.financial-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 20px;
}
.financial-success {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--status-success);
  font-size: 14px;
}
.financial-notice,
.financial-error {
  border-radius: 9px;
  padding: 14px 16px;
  line-height: 1.7;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.financial-notice {
  background: color-mix(in srgb, var(--blue) 6%, white);
  color: var(--brand-ink);
  margin-bottom: 16px;
}
.financial-error {
  color: var(--status-danger);
  background: #fff4f2;
  border: 1px solid #ffd9d3;
}
.financial-error .button {
  margin-top: 10px;
}
.financial-field-error {
  color: var(--status-danger);
}
.price-cards {
  margin-top: 18px;
}
.price-card {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(200px, 1.4fr);
  gap: 16px 24px;
}
.price-title {
  display: grid;
  align-content: start;
  gap: 8px;
  padding-top: 4px;
  overflow-wrap: anywhere;
}
.price-title span {
  font-size: 14px;
  color: var(--text-secondary);
}
.price-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.price-input input {
  flex: 1 1 calc(17ch + 14px);
  min-width: min(100%, calc(17ch + 14px));
  padding-inline: 6px;
  font-variant-numeric: tabular-nums;
}
.price-input span {
  flex-shrink: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  font-weight: 400;
}
.price-switches {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 16px 24px;
}
@media (max-width: 900px) {
  .currency-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .price-card {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 600px) {
  .financial-panel {
    padding: 16px;
  }
  .financial-heading {
    flex-direction: column;
    gap: 8px;
  }
  .currency-fields,
  .price-card {
    grid-template-columns: minmax(0, 1fr);
  }
  .currency-card,
  .price-card {
    padding: 14px;
  }
  .financial-actions .button {
    width: 100%;
    justify-content: center;
  }
  .financial-default {
    max-width: none;
  }
  .price-switches {
    flex-direction: column;
  }
}
</style>

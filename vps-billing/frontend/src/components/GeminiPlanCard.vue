<script setup lang="ts">
import { computed } from "vue";
import { Check } from "@lucide/vue";

export interface CurrencyFormat {
  code: string;
  name: string;
  prefix: string;
  suffix: string;
  decimal_places: number;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
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

const props = defineProps<{
  plan: Plan;
  locale: string;
  /** Parent-level unresolved/stale-data guard; does not change the quoted plan. */
  chooseDisabled?: boolean;
  selected?: boolean;
}>();

const emit = defineEmits<{
  (e: "choose"): void;
}>();

const isEn = computed(
  () => props.locale === "en" || props.locale.startsWith("en"),
);

const t = computed(() => {
  if (isEn.value) {
    return {
      monthlyLabel: "Monthly price",
      perMonth: "/ mo",
      unavailableQuote: "No quote available in current currency",
      specHeading: "Specifications",
      cpuLabel: "Processor",
      cpuUnit: (n: number) => `${n} vCPU`,
      memoryLabel: "Memory",
      memoryUnit: (n: number) => `${n} GB`,
      diskLabel: "Storage",
      diskUnit: (n: number) => `${n} GB`,
      transferLabel: "Monthly Transfer",
      transferUnit: (n: number) => `${n} TB`,
      chooseBtn: "Select plan",
      selectedBtn: "Selected",
      unavailableBtn: "Unavailable",
    };
  }
  return {
    monthlyLabel: "月付价格",
    perMonth: "/ 月",
    unavailableQuote: "当前币种暂无可购报价",
    specHeading: "套餐规格",
    cpuLabel: "处理器",
    cpuUnit: (n: number) => `${n} 核 vCPU`,
    memoryLabel: "内存",
    memoryUnit: (n: number) => `${n} GB`,
    diskLabel: "存储",
    diskUnit: (n: number) => `${n} GB`,
    transferLabel: "每月流量",
    transferUnit: (n: number) => `${n} TB`,
    chooseBtn: "选择此套餐",
    selectedBtn: "已选择",
    unavailableBtn: "暂不可购",
  };
});

/**
 * Strictly formats minor integer amounts using BigInt string slicing.
 * Never truncates floats, guesses precision, or converts currencies.
 */
function formatStrictMoney(
  minor: unknown,
  fmt: CurrencyFormat | null | undefined,
): string {
  if (typeof minor !== "number" || !Number.isSafeInteger(minor) || minor <= 0) {
    return "—";
  }
  if (
    !fmt ||
    typeof fmt !== "object" ||
    typeof fmt.decimal_places !== "number" ||
    !Number.isInteger(fmt.decimal_places) ||
    fmt.decimal_places < 0 ||
    fmt.decimal_places > 6
  ) {
    return "—";
  }

  const decimals = fmt.decimal_places;
  const prefix = typeof fmt.prefix === "string" ? fmt.prefix : "";
  const suffix = typeof fmt.suffix === "string" ? fmt.suffix : "";
  const code = typeof fmt.code === "string" ? fmt.code : "";

  const raw = BigInt(minor);
  const digits = raw.toString();

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

  if (prefix || suffix) {
    // Prefix and suffix are a server-owned snapshot, including any whitespace.
    return `${prefix}${numericBody}${suffix}`;
  }
  return code ? `${numericBody} ${code}` : numericBody;
}

const validSnapshot = computed(() => {
  const fmt = props.plan.currency_format;
  return (
    !!fmt &&
    typeof fmt === "object" &&
    typeof props.plan.currency === "string" &&
    /^[A-Z]{3}$/.test(props.plan.currency) &&
    fmt.code === props.plan.currency &&
    typeof fmt.name === "string" &&
    typeof fmt.prefix === "string" &&
    typeof fmt.suffix === "string" &&
    Number.isInteger(fmt.decimal_places) &&
    fmt.decimal_places >= 0 &&
    fmt.decimal_places <= 6
  );
});

const isPurchasable = computed(() => {
  return (
    validSnapshot.value &&
    Number.isSafeInteger(props.plan.price_revision) &&
    props.plan.price_revision > 0 &&
    props.plan.available === true &&
    typeof props.plan.price_minor === "number" &&
    Number.isSafeInteger(props.plan.price_minor) &&
    props.plan.price_minor > 0
  );
});

const formattedMonthlyPrice = computed(() => {
  if (!isPurchasable.value) return "—";
  return formatStrictMoney(props.plan.price_minor, props.plan.currency_format);
});

const currencyBadge = computed(() => {
  return typeof props.plan.currency === "string" &&
    /^[A-Z]{3}$/.test(props.plan.currency)
    ? props.plan.currency
    : "";
});

function handleChoose() {
  if (!isPurchasable.value || props.chooseDisabled) return;
  emit("choose");
}
</script>

<template>
  <article
    class="gpc-card"
    :class="{ 'is-unavailable': !isPurchasable, 'is-selected': selected }"
  >
    <header class="gpc-header">
      <div class="gpc-title-row">
        <h3 class="gpc-title">{{ plan.name }}</h3>
        <span v-if="currencyBadge" class="gpc-currency-tag gpc-mono">{{
          currencyBadge
        }}</span>
      </div>
      <p v-if="plan.description" class="gpc-desc">{{ plan.description }}</p>
    </header>
    <dl class="gpc-specs" :aria-label="t.specHeading">
      <div class="gpc-spec-row">
        <dt>{{ t.cpuLabel }}</dt>
        <dd class="gpc-mono">{{ t.cpuUnit(plan.cpu) }}</dd>
      </div>
      <div class="gpc-spec-row">
        <dt>{{ t.memoryLabel }}</dt>
        <dd class="gpc-mono">{{ t.memoryUnit(plan.memory_gb) }}</dd>
      </div>
      <div class="gpc-spec-row">
        <dt>{{ t.diskLabel }}</dt>
        <dd class="gpc-mono">{{ t.diskUnit(plan.disk_gb) }}</dd>
      </div>
      <div class="gpc-spec-row">
        <dt>{{ t.transferLabel }}</dt>
        <dd class="gpc-mono">{{ t.transferUnit(plan.transfer_tb) }}</dd>
      </div>
    </dl>
    <section class="gpc-pricing" :aria-label="t.monthlyLabel">
      <div v-if="isPurchasable" class="gpc-price-row">
        <span class="gpc-price-amount gpc-mono">{{
          formattedMonthlyPrice
        }}</span
        ><span class="gpc-price-cycle">{{ t.perMonth }}</span>
      </div>
      <p v-else class="gpc-unavailable-text">{{ t.unavailableQuote }}</p>
    </section>
    <footer class="gpc-footer">
      <button
        type="button"
        class="gpc-btn gpc-btn-choose"
        :disabled="!isPurchasable || chooseDisabled"
        :aria-pressed="selected || false"
        @click="handleChoose"
      >
        <Check v-if="selected" :size="15" aria-hidden="true" /><span>{{
          !isPurchasable
            ? t.unavailableBtn
            : selected
              ? t.selectedBtn
              : t.chooseBtn
        }}</span>
      </button>
    </footer>
  </article>
</template>

<style scoped>
.gpc-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 19px;
  width: 100%;
  min-width: 0;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease;
  color: var(--text-primary);
}
.gpc-card:hover {
  border-color: var(--border-strong);
}
.gpc-card.is-selected {
  border-color: var(--accent-primary);
  background: var(--bg-active);
}
.gpc-mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.gpc-header {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.gpc-title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.gpc-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.5;
  letter-spacing: -0.015em;
  overflow-wrap: anywhere;
  min-width: 0;
}
.gpc-currency-tag {
  font-size: 10px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.gpc-desc {
  font-size: 11px;
  line-height: 1.8;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.gpc-specs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 15px 12px;
}
.gpc-spec-row {
  min-width: 0;
  display: grid;
  gap: 5px;
}
.gpc-spec-row dt {
  font-size: 10px;
  color: var(--text-secondary);
  line-height: 1.4;
}
.gpc-spec-row dd {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.gpc-pricing {
  margin-top: auto;
  padding-top: 17px;
  border-top: 1px solid var(--border-subtle);
  min-height: 43px;
  display: flex;
  align-items: center;
}
.gpc-price-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 5px;
  min-width: 0;
}
.gpc-price-amount {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.gpc-price-cycle {
  font-size: 10px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.gpc-unavailable-text {
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-secondary);
}
.gpc-footer {
  margin-top: -5px;
}
.gpc-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  min-height: 40px;
  padding: 9px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  background: transparent;
  color: var(--text-primary);
  font: 500 11px var(--font-sans);
  line-height: 1.5;
  cursor: pointer;
  overflow-wrap: anywhere;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}
.gpc-btn:hover:not(:disabled) {
  background: var(--bg-elevated);
  border-color: var(--text-secondary);
}
.is-selected .gpc-btn {
  color: var(--accent-primary);
  border-color: var(--accent-primary);
}
.is-selected .gpc-btn:hover:not(:disabled) {
  background: var(--bg-active);
}
.gpc-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.gpc-btn:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 3px;
}
@media (max-width: 520px) {
  .gpc-card {
    padding: 18px;
    gap: 18px;
  }
  .gpc-specs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px 12px;
  }
  .gpc-spec-row dd {
    font-size: 12px;
  }
  .gpc-btn {
    min-height: 44px;
  }
}
@media (max-width: 360px) {
  .gpc-specs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (prefers-reduced-motion: reduce) {
  .gpc-card,
  .gpc-btn {
    transition: none;
  }
}
</style>

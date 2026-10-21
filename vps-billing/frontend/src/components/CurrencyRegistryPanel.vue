<script setup lang="ts">
import UiSelect from "./UiSelect.vue";

import { computed, ref, watch } from "vue";
import { Plus, LockKeyhole } from "@lucide/vue";
import type { CurrencyRegistry, CurrencyUpdate } from "../types/idc";
import { currencyInput } from "../services/settings-input";
const props = defineProps<{
  locale: string;
  registry: CurrencyRegistry;
  busy: boolean;
  uncertain: boolean;
}>();
const emit = defineEmits<{
  save: [value: CurrencyUpdate];
  dirty: [value: boolean];
}>();
const t = (zh: string, en: string) => (props.locale === "zh-CN" ? zh : en);
const draft = ref<CurrencyUpdate>({
    revision: 1,
    default_currency: "CNY",
    currencies: [],
  }),
  validation = ref("");
function reset() {
  draft.value = {
    revision: props.registry.revision,
    default_currency: props.registry.default_currency,
    currencies: props.registry.currencies.map(
      ({
        code,
        name,
        prefix,
        suffix,
        decimal_places,
        enabled,
        sort_order,
      }) => ({
        code,
        name,
        prefix,
        suffix,
        decimal_places,
        enabled,
        sort_order,
      }),
    ),
  };
  validation.value = "";
}
watch(() => props.registry, reset, { immediate: true });
const original = (code: string) =>
  props.registry.currencies.find((c) => c.code === code);
const locked = computed(() => props.busy || props.uncertain);
const dirty = computed(
  () =>
    JSON.stringify(draft.value) !==
    JSON.stringify({
      revision: props.registry.revision,
      default_currency: props.registry.default_currency,
      currencies: props.registry.currencies.map(
        ({
          code,
          name,
          prefix,
          suffix,
          decimal_places,
          enabled,
          sort_order,
        }) => ({
          code,
          name,
          prefix,
          suffix,
          decimal_places,
          enabled,
          sort_order,
        }),
      ),
    }),
);
watch(dirty, (value) => emit("dirty", value), { immediate: true });
const inUse = (code: string) => {
  const u = original(code)?.usage;
  return (
    !!u &&
    [u.pending_orders, u.unpaid_invoices, u.ongoing_services].some((n) => n > 0)
  );
};
function add() {
  draft.value.currencies.push({
    code: "",
    name: "",
    prefix: "",
    suffix: "",
    decimal_places: 2,
    enabled: false,
    sort_order: 100,
  });
}
function save() {
  try {
    const value = currencyInput(draft.value, props.registry);
    validation.value = "";
    emit("save", value);
  } catch {
    validation.value = t(
      "检查币种代码、名称、字节长度、精度与排序。默认币种必须启用；已有币种不能删除，历史精度与未结义务必须保留。",
      "Check codes, names, byte lengths, precision and sorting. The default must be enabled. Existing codes, historical precision and open obligations must be preserved.",
    );
  }
}
</script>
<template>
  <div class="currency-panel">
    <header>
      <h2>{{ t("运营币种", "Operating currencies") }}</h2>
      <p>
        {{
          t(
            "每种币种独立定价，不换汇，不改变历史金额。",
            "Independent prices, without conversion or changes to historical amounts.",
          )
        }}
      </p>
    </header>
    <p v-if="validation" class="error-box" role="alert">{{ validation }}</p>
    <form @submit.prevent="save">
      <fieldset :disabled="locked">
        <label class="form-group default-field"
          ><span class="form-label">{{
            t("默认购买币种", "Default purchase currency")
          }}</span
          ><UiSelect v-model="draft.default_currency" class="form-select"
            ><option
              v-for="c in draft.currencies.filter((x) => x.enabled)"
              :key="c.code"
              :value="c.code"
            >
              {{ c.code }} · {{ c.name }}
            </option></UiSelect
          ></label
        >
        <article
          v-for="(c, i) in draft.currencies"
          :key="i"
          class="currency-row"
        >
          <div class="currency-row-head">
            <strong>{{ c.code || t("新增币种", "New currency") }}</strong
            ><span v-if="original(c.code)?.precision_locked" class="precision"
              ><LockKeyhole :size="14" />{{
                t("历史精度已锁定", "Historical precision locked")
              }}</span
            ><button
              v-if="i >= registry.currencies.length"
              type="button"
              class="btn btn-ghost"
              @click="draft.currencies.splice(i, 1)"
            >
              {{ t("取消新增", "Remove draft") }}
            </button>
          </div>
          <div class="currency-grid">
            <label class="form-group"
              ><span class="form-label">{{ t("代码", "Code") }}</span
              ><input
                v-model="c.code"
                class="form-input"
                pattern="[A-Z]{3}"
                maxlength="3"
                required
                :readonly="i < registry.currencies.length"
                autocapitalize="characters" /></label
            ><label class="form-group"
              ><span class="form-label">{{ t("名称", "Name") }}</span
              ><input v-model="c.name" class="form-input" required /></label
            ><label class="form-group"
              ><span class="form-label">{{ t("金额前缀", "Prefix") }}</span
              ><input v-model="c.prefix" class="form-input" /></label
            ><label class="form-group"
              ><span class="form-label">{{ t("金额后缀", "Suffix") }}</span
              ><input v-model="c.suffix" class="form-input" /></label
            ><label class="form-group"
              ><span class="form-label">{{ t("小数位", "Decimals") }}</span
              ><input
                v-model.number="c.decimal_places"
                class="form-input"
                type="number"
                min="0"
                max="6"
                required
                :readonly="original(c.code)?.precision_locked" /></label
            ><label class="form-group"
              ><span class="form-label">{{ t("排序", "Sort order") }}</span
              ><input
                v-model.number="c.sort_order"
                class="form-input"
                type="number"
                min="0"
                max="10000"
                required
            /></label>
          </div>
          <label class="enabled"
            ><input
              v-model="c.enabled"
              type="checkbox"
              :disabled="inUse(c.code)"
            />{{ t("启用购买", "Enable purchases") }}</label
          >
          <p v-if="inUse(c.code)" class="helper">
            {{
              t(
                "存在未结义务，不能停用。",
                "Open obligations prevent disabling.",
              )
            }}
            {{ t("待付订单", "Pending orders") }}
            {{ original(c.code)?.usage?.pending_orders }} ·
            {{ t("未付账单", "Unpaid invoices") }}
            {{ original(c.code)?.usage?.unpaid_invoices }} ·
            {{ t("进行中服务", "Ongoing services") }}
            {{ original(c.code)?.usage?.ongoing_services }}
          </p>
        </article>
        <div class="currency-actions">
          <button
            class="btn btn-secondary"
            type="button"
            :disabled="draft.currencies.length >= 32"
            @click="add"
          >
            <Plus :size="16" />{{ t("新增币种", "Add currency") }}</button
          ><span>{{ draft.currencies.length }} / 32</span>
        </div>
        <div class="currency-actions">
          <button
            class="btn btn-admin"
            type="submit"
            :disabled="locked || !dirty"
          >
            {{ t("保存币种设置", "Save currencies") }}</button
          ><button
            class="btn btn-secondary"
            type="button"
            :disabled="locked || !dirty"
            @click="reset"
          >
            {{ t("放弃修改", "Discard changes") }}
          </button>
        </div>
      </fieldset>
    </form>
  </div>
</template>
<style scoped>
.currency-panel {
  font-size: 14px;
  line-height: 1.7;
}
.currency-panel h2 {
  font-size: 22px;
  font-weight: 600;
}
.currency-panel header p {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 8px 0 24px;
}
.currency-panel fieldset {
  border: 0;
  padding: 0;
  min-width: 0;
}
.default-field {
  max-width: 350px;
}
.currency-row {
  padding: 24px 0;
  border-bottom: 1px solid var(--border-subtle);
}
.currency-row-head {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.currency-row-head strong {
  font-size: 17px;
}
.precision {
  display: flex;
  gap: 6px;
  align-items: center;
  color: var(--text-secondary);
  font-size: 12px;
}
.currency-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 18px;
}
.enabled {
  display: flex;
  gap: 10px;
  min-height: 44px;
  align-items: center;
  margin-top: 12px;
}
.enabled input {
  width: 18px;
  height: 18px;
}
.currency-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 24px;
}
.currency-actions span {
  color: var(--text-secondary);
  font-size: 12px;
}
.form-input,
.form-select {
  font-size: 14px;
  min-width: 0;
}
.helper {
  font-size: 12px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.btn {
  min-height: 44px;
}
@media (max-width: 500px) {
  .currency-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .currency-panel h2 {
    font-size: 20px;
  }
}
</style>

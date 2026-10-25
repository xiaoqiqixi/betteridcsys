<script setup lang="ts">
import OverlayPanel from "./OverlayPanel.vue";
import UiSelect from "./UiSelect.vue";
const props = defineProps<{
  open: boolean;
  locale: string;
  currency: string;
  currencies: { code: string; name: string; enabled: boolean }[];
  reporting: boolean;
  anchor: HTMLElement | null;
}>();
const emit = defineEmits<{
  "update:locale": [value: string];
  "update:currency": [value: string];
  close: [];
}>();
const t = (zh: string, en: string) => (props.locale === "zh-CN" ? zh : en);
</script>
<template>
  <OverlayPanel
    :close-label="t('关闭', 'Close')"
    :open="open"
    :title="t('语言与币种', 'Language & currency')"
    kind="popover"
    :anchor="anchor"
    @close="emit('close')"
    ><div class="locale-options">
      <label class="form-group"
        ><span class="form-label">{{ t("语言", "Language") }}</span
        ><UiSelect
          :model-value="locale"
          :aria-label="t('语言', 'Language')"
          @update:model-value="emit('update:locale', String($event))"
          ><option value="zh-CN">简体中文</option>
          <option value="en">English</option></UiSelect
        ></label
      ><label class="form-group"
        ><span class="form-label">{{
          reporting
            ? t("报表币种", "Report currency")
            : t("购买币种", "Purchase currency")
        }}</span
        ><UiSelect
          :model-value="currency"
          :aria-label="
            reporting
              ? t('报表币种', 'Report currency')
              : t('购买币种', 'Purchase currency')
          "
          :disabled="!currencies.length"
          @update:model-value="emit('update:currency', String($event))"
          ><option v-for="c in currencies" :key="c.code" :value="c.code">
            {{ c.name }} · {{ c.code }}
          </option></UiSelect
        ></label
      >
      <p v-if="reporting || currency !== 'CNY'" class="currency-scope">
        {{
          reporting
            ? t(
                "仅查看所选币种的报表，不换算金额，也不改变购买币种。",
                "Shows reports in the selected currency without converting amounts or changing your purchase currency.",
              )
            : t(
                "仅影响新订单的报价，历史账单保留原币种。",
                "Changes new-order prices only. Existing invoices keep their currency.",
              )
        }}
      </p>
    </div></OverlayPanel
  >
</template>
<style scoped>
.locale-options {
  display: grid;
  gap: 20px;
  padding-top: 6px;
}
.form-label {
  font-size: 13px;
  font-weight: 500;
}
.locale-options p {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}
</style>

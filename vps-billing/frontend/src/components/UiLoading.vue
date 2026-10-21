<script setup lang="ts">
import { computed } from "vue";
import UiSpinner from "./UiSpinner.vue";
const props = withDefaults(
  defineProps<{
    layout?: "cards" | "list" | "form";
    label?: string;
    rows?: number;
    compact?: boolean;
  }>(),
  { layout: "cards", label: "正在加载…", rows: 3, compact: false },
);
const count = computed(() =>
  Number.isFinite(props.rows)
    ? Math.max(1, Math.min(6, Math.floor(props.rows)))
    : 3,
);
</script>
<template>
  <div
    class="ui-loading"
    :class="[`ui-loading-${layout}`, { 'is-compact': compact }]"
    role="status"
    aria-live="polite"
    aria-atomic="true"
    aria-busy="true"
  >
    <div class="ui-loading-caption">
      <UiSpinner :size="15" /><span>{{ label }}</span>
    </div>
    <div class="ui-loading-content" aria-hidden="true">
      <div v-for="row in count" :key="row" class="ui-loading-item">
        <span class="ui-skeleton ui-skeleton-heading" /><span
          class="ui-skeleton ui-skeleton-line"
        /><span class="ui-skeleton ui-skeleton-line ui-skeleton-short" /><span
          v-if="layout === 'cards'"
          class="ui-skeleton ui-skeleton-action"
        />
      </div>
    </div>
  </div>
</template>

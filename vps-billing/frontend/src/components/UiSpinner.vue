<script setup lang="ts">
withDefaults(defineProps<{ size?: number; label?: string }>(), { size: 16 });
</script>
<template>
  <span
    class="ui-spinner"
    :class="{ 'has-label': label }"
    :role="label ? 'status' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : true"
    :style="{ width: `${size}px`, height: `${size}px` }"
    ><svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle
        class="ui-spinner-track"
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        stroke-width="2.4"
      />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
      /></svg
  ></span>
</template>

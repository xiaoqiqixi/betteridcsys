<script setup lang="ts">
import { CheckCircle2, X, AlertCircle } from "@lucide/vue";
import type { Notice } from "../context";
defineProps<{ notices: Notice[]; closeLabel: string }>();
defineEmits<{ dismiss: [id: number] }>();
</script>
<template>
  <div class="toast-stack" aria-live="polite" aria-relevant="additions">
    <TransitionGroup name="toast"
      ><div
        v-for="notice in notices"
        :key="notice.id"
        class="toast-item"
        :class="notice.kind"
      >
        <AlertCircle
          v-if="notice.kind === 'error'"
          :size="19"
          aria-hidden="true"
        /><CheckCircle2 v-else :size="19" aria-hidden="true" />
        <p>{{ notice.title }}</p>
        <button
          type="button"
          class="icon-button"
          :aria-label="closeLabel"
          @click="$emit('dismiss', notice.id)"
        >
          <X :size="17" aria-hidden="true" />
        </button></div
    ></TransitionGroup>
  </div>
</template>
<style scoped>
.toast-stack {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 300;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(420px, calc(100vw - 32px));
  pointer-events: none;
}
.toast-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 12px 12px 16px;
  background: var(--surface-raised);
  border: 1px solid var(--control-border);
  border-radius: 14px;
  box-shadow: var(--shadow-popover);
  pointer-events: auto;
}
.toast-item > svg {
  color: var(--success);
  flex-shrink: 0;
}
.toast-item.error > svg {
  color: var(--danger);
}
.toast-item p {
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  flex: 1;
  margin: 0;
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.15s,
    transform 0.15s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
@media (max-width: 600px) {
  .toast-stack {
    right: 16px;
    bottom: calc(16px + env(safe-area-inset-bottom));
  }
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }
}
</style>

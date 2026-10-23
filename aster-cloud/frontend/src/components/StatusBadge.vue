<script setup lang="ts">
import { computed } from "vue";
import { useConsole } from "../context";
const props = defineProps<{ state: string }>();
const {
  prefs: { tr },
} = useConsole();
const labels: Record<string, [string, string, string]> = {
  shutoff: ["已关机", "Shut off", "neutral"],
  sending: ["正在派发", "Sending", "info"],
  dispatched: ["已派发", "Dispatched", "info"],
  transferred: ["已传输", "Transferred", "info"],
  imported: ["已导入", "Imported", "info"],
  running: ["运行中", "Running", "good"],
  stopped: ["已关机", "Stopped", "neutral"],
  active: ["可用", "Active", "good"],
  enabled: ["已启用", "Enabled", "good"],
  disabled: ["已停用", "Disabled", "neutral"],
  online: ["在线", "Online", "good"],
  offline: ["离线", "Offline", "neutral"],
  accepted: ["已受理", "Accepted", "info"],
  pending: ["待执行", "Pending", "info"],
  superseded: ["已由新版本替代", "Superseded", "neutral"],
  queued: ["等待执行", "Queued", "info"],
  dispatching: ["正在派发", "Dispatching", "info"],
  succeeded: ["已完成", "Completed", "good"],
  failed: ["失败", "Failed", "danger"],
  rejected: ["已拒绝", "Rejected", "danger"],
  uncertain: ["待核实", "Uncertain", "warning"],
  unknown: ["待核实", "Unknown", "warning"],
  ready: ["可用", "Ready", "good"],
  verified: ["已校验", "Verified", "good"],
  preparing: ["准备中", "Preparing", "info"],
  prepared: ["已准备", "Prepared", "info"],
  fenced: ["已隔离", "Fenced", "warning"],
  deleted: ["已删除", "Deleted", "neutral"],
  maintenance: ["维护中", "Maintenance", "warning"],
};
const info = computed(() => labels[props.state]);
const label = computed(() =>
  info.value
    ? tr(info.value[0], info.value[1])
    : props.state || tr("待核实", "Unknown"),
);
</script>
<template>
  <span class="status-badge" :class="`tone-${info?.[2] || 'neutral'}`"
    ><span class="status-dot" aria-hidden="true" />{{ label }}</span
  >
</template>
<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  min-height: 28px;
  border-radius: 7px;
  background: var(--hover);
  color: var(--secondary);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  overflow-wrap: anywhere;
  max-width: 100%;
}
.status-dot {
  width: 5px;
  height: 5px;
  background: currentColor;
  border-radius: 50%;
  flex-shrink: 0;
}
.tone-good {
  color: var(--success);
  background: var(--success-bg);
}
.tone-info {
  color: var(--accent-text);
  background: var(--accent-bg);
}
.tone-warning {
  color: var(--warning);
  background: var(--warning-bg);
}
.tone-danger {
  color: var(--danger);
  background: var(--danger-bg);
}
</style>

<script setup lang="ts">
import { Cpu, MemoryStick, HardDrive, Network } from "@lucide/vue";
defineProps<{
  plan: {
    cpu: number;
    memory_gb: number;
    disk_gb: number;
    transfer_tb: number;
  };
  locale: "zh-CN" | "en";
}>();
</script>

<template>
  <dl class="product-specs">
    <div>
      <dt>
        <Cpu :size="15" />{{ locale === "zh-CN" ? "处理器" : "Processor" }}
      </dt>
      <dd>{{ plan.cpu }} <span>vCPU</span></dd>
    </div>
    <div>
      <dt>
        <MemoryStick :size="15" />{{ locale === "zh-CN" ? "内存" : "Memory" }}
      </dt>
      <dd>{{ plan.memory_gb }} <span>GB</span></dd>
    </div>
    <div>
      <dt>
        <HardDrive :size="15" />{{ locale === "zh-CN" ? "存储" : "Storage" }}
      </dt>
      <dd>{{ plan.disk_gb }} <span>GB</span></dd>
    </div>
    <div>
      <dt>
        <Network :size="15" />{{
          locale === "zh-CN" ? "每月流量" : "Monthly transfer"
        }}
      </dt>
      <dd>{{ plan.transfer_tb }} <span>TB</span></dd>
    </div>
  </dl>
</template>

<style scoped>
.product-specs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 12px;
}
.product-specs div {
  min-width: 0;
}
.product-specs dt {
  display: flex;
  gap: 7px;
  align-items: center;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 5px;
}
.product-specs dd {
  font: 600 17px var(--font-mono);
  overflow-wrap: anywhere;
  color: var(--text-primary);
}
.product-specs dd span {
  font: 400 11px var(--font-sans);
  color: var(--text-secondary);
}
</style>

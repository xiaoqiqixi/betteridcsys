<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { ChevronRight, Search, RefreshCw, Server, Plus } from "@lucide/vue";
import { RouterLink } from "vue-router";
import { useConsole } from "../context";
import { useQuery } from "../composables/query";
import { validInstance, validPage } from "../api/client";
import type { Instance, Page } from "../api/types";
import { sizeMiB } from "../format";
import CreateInstanceDialog from "../components/CreateInstanceDialog.vue";
import StateBlock from "../components/StateBlock.vue";
import StatusBadge from "../components/StatusBadge.vue";
import UiButton from "../components/UiButton.vue";
const {
  prefs: { tr },
  session,
} = useConsole();
const createOpen = shallowRef(false);
const cursor = shallowRef(""),
  search = shallowRef("");
const list = useQuery(
  () =>
    `/instances${cursor.value ? `?cursor=${encodeURIComponent(cursor.value)}` : ""}`,
  (v): v is Page<Instance> => validPage(v, validInstance),
);
const visible = computed(
  () =>
    list.data.value?.items.filter((i) =>
      [i.hostname, i.id, i.node_id].some((v) =>
        v.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()),
      ),
    ) || [],
);
</script>
<template>
  <section class="page">
    <header class="page-heading">
      <div>
        <h1>{{ tr("实例", "Instances") }}</h1>
        <p>
          {{
            tr(
              "查看服务器状态，管理电源、数据与迁移。",
              "Manage server state, power, data and migrations.",
            )
          }}
        </p>
      </div>
      <div class="heading-actions">
        <UiButton :busy="list.loading.value" @click="list.reload"
          ><RefreshCw :size="16" aria-hidden="true" />{{
            tr("刷新", "Refresh")
          }}</UiButton
        ><UiButton
          v-if="session.can('instances.manage')"
          variant="primary"
          @click="createOpen = true"
          ><Plus :size="16" aria-hidden="true" />{{
            tr("创建实例", "Create instance")
          }}</UiButton
        >
      </div>
    </header>
    <div class="list-toolbar">
      <label class="search-field"
        ><Search :size="18" aria-hidden="true" /><input
          v-model="search"
          :aria-label="tr('搜索当前页实例', 'Search instances on this page')"
          :placeholder="
            tr('搜索名称、实例 ID 或节点', 'Search name, instance ID or node')
          "
          type="search" /></label
      ><span v-if="list.data.value" class="result-count"
        >{{ tr("本页", "This page") }} {{ list.data.value.items.length }}</span
      >
    </div>
    <StateBlock
      :loading="list.loading.value"
      :error="list.error.value"
      :empty="!visible.length"
      :title="
        search
          ? tr('没有匹配的实例', 'No matching instances')
          : tr('暂无实例', 'No instances yet')
      "
      :description="
        search
          ? tr('尝试其他名称或 ID。', 'Try another name or ID.')
          : tr(
              '新开通的服务器将在这里显示。',
              'Newly provisioned servers will appear here.',
            )
      "
      @reload="list.reload"
      ><div class="resource-list">
        <div class="list-labels">
          <span>{{ tr("实例", "Instance") }}</span
          ><span>{{ tr("规格", "Configuration") }}</span
          ><span>{{ tr("节点", "Node") }}</span
          ><span>{{ tr("状态", "State") }}</span
          ><span />
        </div>
        <RouterLink
          v-for="instance in visible"
          :key="instance.id"
          :to="`/instances/${encodeURIComponent(instance.id)}`"
          class="instance-row"
          ><div class="instance-identity">
            <span class="resource-icon"
              ><Server :size="20" aria-hidden="true"
            /></span>
            <div>
              <strong>{{ instance.hostname || instance.id }}</strong
              ><span class="identifier">{{ instance.id }}</span>
            </div>
          </div>
          <div class="instance-specs">
            <span>{{ instance.resources.cpu_cores }} vCPU</span
            ><span
              >{{ sizeMiB(instance.resources.memory_mib) }} ·
              {{ instance.resources.system_disk_gib }} GiB</span
            >
          </div>
          <span class="instance-node">{{ instance.node_id }}</span
          ><StatusBadge :state="instance.state" /><ChevronRight
            :size="18"
            class="row-chevron"
            aria-hidden="true"
        /></RouterLink></div
    ></StateBlock>
    <div v-if="list.data.value" class="pagination">
      <UiButton
        v-if="cursor"
        :disabled="list.loading.value"
        @click="cursor = ''"
        >{{ tr("回到首页", "First page") }}</UiButton
      ><UiButton
        v-if="list.data.value.next_cursor"
        :disabled="list.loading.value"
        @click="cursor = list.data.value!.next_cursor!"
        >{{ tr("下一页", "Next page") }}</UiButton
      >
    </div>
    <CreateInstanceDialog :open="createOpen" @close="createOpen = false" />
  </section>
</template>
<style scoped>
.list-labels,
.instance-row {
  display: grid;
  grid-template-columns:
    minmax(180px, 2fr) minmax(140px, 1.3fr) minmax(100px, 1fr)
    100px 20px;
  align-items: center;
  gap: 20px;
}
.list-labels {
  font-size: 12px;
  color: var(--secondary);
  padding: 14px 24px;
  background: var(--subtle);
}
.instance-row {
  padding: 22px 24px;
  color: var(--text);
  text-decoration: none;
  border-top: 1px solid var(--border);
  transition: background 0.12s;
}
.instance-row:focus-visible {
  outline-offset: -3px;
}
.instance-row:hover {
  background: var(--hover);
}
.instance-identity {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.instance-identity > div {
  min-width: 0;
}
.instance-identity strong {
  display: block;
  font-size: 15px;
  overflow-wrap: anywhere;
  font-weight: 600;
}
.identifier {
  font-size: 12px;
  color: var(--secondary);
  display: block;
  overflow-wrap: anywhere;
  margin-top: 5px;
}
.resource-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  background: var(--subtle);
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--secondary);
}
.instance-specs {
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.instance-specs span + span {
  color: var(--secondary);
}
.instance-node {
  font-size: 13px;
  color: var(--secondary);
  overflow-wrap: anywhere;
}
.row-chevron {
  color: var(--muted);
}
@media (max-width: 1000px) {
  .list-labels,
  .instance-row {
    grid-template-columns: minmax(160px, 2fr) minmax(130px, 1fr) 95px 18px;
  }
  .list-labels > span:nth-child(3),
  .instance-node {
    display: none;
  }
}
@media (max-width: 600px) {
  .list-labels {
    display: none;
  }
  .instance-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 14px;
    padding: 20px;
  }
  .instance-identity {
    grid-column: 1;
    gap: 12px;
  }
  .instance-specs {
    grid-column: 1;
    margin-left: 54px;
    flex-direction: row;
    flex-wrap: wrap;
    font-size: 12px;
  }
  .instance-row > .status-badge {
    grid-column: 2;
    grid-row: 1;
  }
  .row-chevron {
    grid-column: 2;
    grid-row: 2;
    justify-self: end;
  }
  .identifier {
    font-size: 11px;
  }
  .resource-icon {
    width: 40px;
    height: 40px;
  }
}
</style>

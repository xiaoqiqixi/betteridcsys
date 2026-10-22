<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { RefreshCw, Server, Wrench } from "@lucide/vue";
import { useConsole } from "../context";
import { useQuery } from "../composables/query";
import { useMutation } from "../composables/mutation";
import { record, validNode, validPage } from "../api/client";
import type { Node, Page } from "../api/types";
import { dateText, sizeMiB } from "../format";
import UiButton from "../components/UiButton.vue";
import UiOverlay from "../components/UiOverlay.vue";
import StateBlock from "../components/StateBlock.vue";
import StatusBadge from "../components/StatusBadge.vue";
import InlineError from "../components/InlineError.vue";
const {
  prefs: { tr, locale },
  session,
  notify,
} = useConsole();
const list = useQuery(
  () => "/nodes",
  (v): v is Page<Node> => validPage(v, validNode),
);
const selected = shallowRef<Node | null>(null),
  confirmation = shallowRef("");
const mutation = useMutation();
const target = computed(() => !selected.value?.maintenance);
function open(node: Node) {
  selected.value = node;
  confirmation.value = "";
  mutation.clearMessage();
}
async function save() {
  if (
    !selected.value ||
    confirmation.value !== selected.value.id ||
    mutation.pendingKey.value
  )
    return;
  const expected = target.value;
  const result = await mutation.execute(
    "POST",
    `/nodes/${encodeURIComponent(selected.value.id)}/maintenance`,
    { enabled: expected },
    (x): x is { maintenance: boolean } =>
      record(x) && x.maintenance === expected,
  );
  if (result && result.maintenance === expected) {
    notify(
      expected
        ? tr("节点已进入维护模式。", "Maintenance mode enabled.")
        : tr("节点已退出维护模式。", "Maintenance mode disabled."),
    );
    selected.value = null;
    await list.reload();
  }
}
</script>
<template>
  <section class="page">
    <header class="page-heading">
      <div>
        <h1>{{ tr("节点", "Nodes") }}</h1>
        <p>
          {{
            tr(
              "查看节点心跳、资源余量与维护状态。",
              "Review node heartbeats, available resources and maintenance state.",
            )
          }}
        </p>
      </div>
      <UiButton :busy="list.loading.value" @click="list.reload"
        ><RefreshCw :size="16" aria-hidden="true" />{{
          tr("刷新", "Refresh")
        }}</UiButton
      >
    </header>
    <StateBlock
      :loading="list.loading.value"
      :error="list.error.value"
      :empty="!list.data.value?.items.length"
      :title="tr('暂无节点', 'No nodes yet')"
      :description="
        tr(
          '节点完成配置并上报心跳后，将在这里显示。',
          'Nodes appear here after configuration and their first heartbeat.',
        )
      "
      @reload="list.reload"
      ><div class="node-grid">
        <article
          v-for="node in list.data.value?.items"
          :key="node.id"
          class="node-panel"
        >
          <header>
            <div class="node-name">
              <Server :size="20" aria-hidden="true" />
              <div>
                <h2>{{ node.id }}</h2>
                <p>{{ node.datacenter_id }}</p>
              </div>
            </div>
            <StatusBadge
              :state="
                node.maintenance
                  ? 'maintenance'
                  : node.online
                    ? 'online'
                    : 'offline'
              "
            />
          </header>
          <dl class="node-capacity">
            <div>
              <dt>{{ tr("可用 CPU", "Available CPU") }}</dt>
              <dd>{{ node.free_cpu }} <span>vCPU</span></dd>
            </div>
            <div>
              <dt>{{ tr("可用内存", "Available memory") }}</dt>
              <dd>{{ sizeMiB(node.free_memory_mib) }}</dd>
            </div>
            <div>
              <dt>{{ tr("可用磁盘", "Available disk") }}</dt>
              <dd>{{ node.free_disk_gib }} <span>GiB</span></dd>
            </div>
          </dl>
          <div class="node-reserved">
            {{ tr("已预留", "Reserved") }} {{ node.reserved_cpu }} vCPU ·
            {{ sizeMiB(node.reserved_memory_mib) }} ·
            {{ node.reserved_disk_gib }} GiB
          </div>
          <footer>
            <div>
              <span>{{ tr("最近心跳", "Last heartbeat") }}</span>
              <p>{{ dateText(node.heartbeat_at, locale) }}</p>
            </div>
            <UiButton
              variant="quiet"
              :disabled="!session.can('nodes.manage')"
              @click="open(node)"
              ><Wrench :size="16" aria-hidden="true" />{{
                tr("维护", "Maintenance")
              }}</UiButton
            >
          </footer>
        </article>
      </div></StateBlock
    ><UiOverlay
      :open="!!selected"
      :title="
        target
          ? tr('进入维护模式', 'Enable maintenance')
          : tr('退出维护模式', 'Disable maintenance')
      "
      :description="selected?.id"
      :busy="mutation.busy.value"
      :close-label="tr('关闭', 'Close')"
      @close="selected = null"
      ><p class="secondary">
        {{
          tr(
            "维护模式下，不再向节点分配新的实例。现有实例不会因此自动关机。",
            "Maintenance mode stops new assignments. Existing instances are not automatically shut down.",
          )
        }}
      </p>
      <label class="field"
        >{{ tr("输入节点 ID 以确认", "Type the node ID to confirm")
        }}<input
          v-model="confirmation"
          autocomplete="off"
          :disabled="
            mutation.busy.value || !!mutation.pendingKey.value
          " /></label
      ><InlineError
        :error="mutation.error.value"
        :pending-key="mutation.pendingKey.value"
      /><template #footer
        ><UiButton :disabled="mutation.busy.value" @click="selected = null">{{
          tr("取消", "Cancel")
        }}</UiButton
        ><UiButton
          variant="primary"
          :busy="mutation.busy.value"
          :disabled="
            confirmation !== selected?.id || !!mutation.pendingKey.value
          "
          @click="save"
          >{{ tr("确认更改", "Confirm change") }}</UiButton
        ></template
      ></UiOverlay
    >
  </section>
</template>
<style scoped>
.node-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.node-panel {
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  padding: 24px;
  min-width: 0;
}
.node-panel > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.node-name {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.node-name svg {
  flex-shrink: 0;
  color: var(--secondary);
}
.node-name h2 {
  font-size: 16px;
  overflow-wrap: anywhere;
  margin: 0 0 6px;
}
.node-name p {
  font-size: 12px;
  margin: 0;
  color: var(--secondary);
  overflow-wrap: anywhere;
}
.node-capacity {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin: 28px 0 20px;
}
.node-capacity dt {
  color: var(--secondary);
  font-size: 12px;
  line-height: 1.6;
  margin-bottom: 8px;
}
.node-capacity dd {
  font-size: 20px;
  font-weight: 550;
  margin: 0;
  overflow-wrap: anywhere;
  letter-spacing: -0.025em;
}
.node-capacity dd span {
  font-size: 12px;
  color: var(--secondary);
}
.node-reserved {
  font-size: 12px;
  line-height: 1.7;
  color: var(--secondary);
  padding: 12px 0 20px;
}
.node-panel > footer {
  border-top: 1px solid var(--border);
  padding-top: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.node-panel > footer span {
  font-size: 11px;
  color: var(--secondary);
}
.node-panel > footer p {
  font-size: 12px;
  margin: 6px 0 0;
}
.field {
  margin-top: 24px;
}
@media (max-width: 1000px) {
  .node-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 400px) {
  .node-panel {
    padding: 20px;
  }
  .node-capacity {
    gap: 10px;
  }
  .node-capacity dd {
    font-size: 18px;
  }
  .node-panel > footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

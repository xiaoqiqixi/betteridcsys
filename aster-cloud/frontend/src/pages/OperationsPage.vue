<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { RouterLink } from "vue-router";
import { RefreshCw, ArrowUpRight } from "@lucide/vue";
import { useConsole } from "../context";
import { useQuery } from "../composables/query";
import { useMutation } from "../composables/mutation";
import {
  ApiError,
  operationResponse,
  validOperation,
  validPage,
} from "../api/client";
import { acknowledgeOperations } from "../composables/mutation";
import type { Operation, Page } from "../api/types";
import { actionPermission } from "../permissions";
import { actionNames, dateText } from "../format";
import UiButton from "../components/UiButton.vue";
import UiOverlay from "../components/UiOverlay.vue";
import StatusBadge from "../components/StatusBadge.vue";
import StateBlock from "../components/StateBlock.vue";
import InlineError from "../components/InlineError.vue";
const {
  prefs: { tr, locale },
  session,
  api,
  notify,
} = useConsole();
const cursor = shallowRef("");
const list = useQuery(
  () =>
    `/operations${cursor.value ? `?cursor=${encodeURIComponent(cursor.value)}` : ""}`,
  (v): v is Page<Operation> => validPage(v, validOperation),
);
const selected = shallowRef<Operation | null>(null),
  mode = shallowRef<"dispatch" | "reconcile">("dispatch"),
  confirmation = shallowRef("");
const mutation = useMutation();
const reading = shallowRef("");
const readError = shallowRef("");
const displayName = computed(
  () =>
    selected.value &&
    (actionNames[selected.value.action]
      ? tr(...actionNames[selected.value.action]!)
      : selected.value.action),
);
const canDispatch = (op: Operation) =>
  op.state === "accepted" && session.can(actionPermission(op.action));
const canReconcile = (op: Operation) =>
  ["sending", "dispatched", "uncertain"].includes(op.state) &&
  session.can(actionPermission(op.action));
async function readOperation(op: Operation) {
  if (reading.value) return;
  const identity = session.epoch.value;
  reading.value = op.id;
  readError.value = "";
  try {
    const result = await api.get(
      `/operations/${encodeURIComponent(op.id)}`,
      operationResponse,
    );
    if (identity !== session.epoch.value) return;
    if (
      result.operation.id !== op.id ||
      result.operation.instance_id !== op.instance_id ||
      result.operation.action !== op.action
    )
      throw new ApiError("invalid");
    if (list.data.value)
      list.data.value = {
        ...list.data.value,
        items: list.data.value.items.map((value) =>
          value.id === op.id ? result.operation : value,
        ),
      };
    acknowledgeOperations(session.user.value?.id || "", [result.operation]);
  } catch (cause) {
    if (identity !== session.epoch.value) return;
    readError.value = cause instanceof ApiError ? cause.kind : "network";
    if (cause instanceof ApiError && cause.kind === "unauthorized")
      session.invalidate();
  } finally {
    reading.value = "";
  }
}
function open(op: Operation, action: "dispatch" | "reconcile") {
  selected.value = op;
  mode.value = action;
  confirmation.value = "";
  mutation.clearMessage();
}
async function submit() {
  const op = selected.value;
  if (!op || confirmation.value !== op.id) return;
  const result = await mutation.execute(
    "POST",
    `/operations/${encodeURIComponent(op.id)}/${mode.value}`,
    {},
    operationResponse,
    {
      key: op.id,
      expectedStatus: 202,
      allowUncertainReconcile: mode.value === "reconcile",
      bindOperation: { instanceId: op.instance_id, action: op.action },
    },
  );
  if (result) {
    notify(
      result.operation.state === "succeeded"
        ? tr("任务已完成。", "Task completed.")
        : result.operation.state === "uncertain"
          ? tr(
              "结果仍待核实，请勿重复派发。",
              "The result remains uncertain. Do not dispatch again.",
            )
          : tr("任务状态已更新。", "Task state updated."),
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
        <h1>{{ tr("操作任务", "Tasks") }}</h1>
        <p>
          {{
            tr(
              "任务受理后需明确派发；结果不确定时，只核实状态。",
              "Dispatch accepted tasks explicitly. Reconcile uncertain results instead of resending.",
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
    <InlineError :error="readError" />
    <StateBlock
      :loading="list.loading.value"
      :error="list.error.value"
      :empty="!list.data.value?.items.length"
      :title="tr('暂无操作任务', 'No tasks yet')"
      :description="
        tr(
          '实例操作的进度与结果会保存在这里。',
          'Instance operations and their results will appear here.',
        )
      "
      @reload="list.reload"
      ><div class="resource-list">
        <article
          v-for="op in list.data.value?.items"
          :key="op.id"
          class="operation-row"
        >
          <div class="operation-main">
            <div class="operation-name">
              <strong>{{
                actionNames[op.action]
                  ? tr(...actionNames[op.action]!)
                  : op.action
              }}</strong
              ><StatusBadge :state="op.state" />
            </div>
            <code>{{ op.id }}</code>
            <div class="operation-context">
              <RouterLink
                :to="`/instances/${encodeURIComponent(op.instance_id)}`"
                >{{ op.instance_id
                }}<ArrowUpRight :size="13" aria-hidden="true" /></RouterLink
              ><span>{{ dateText(op.created_at, locale) }}</span>
            </div>
          </div>
          <div class="operation-actions">
            <UiButton
              variant="quiet"
              :busy="reading === op.id"
              :disabled="!!reading && reading !== op.id"
              @click="readOperation(op)"
              >{{ tr("读取状态", "Read state") }}</UiButton
            >
            <UiButton v-if="canDispatch(op)" @click="open(op, 'dispatch')">{{
              tr("派发任务", "Dispatch")
            }}</UiButton
            ><UiButton v-if="canReconcile(op)" @click="open(op, 'reconcile')">{{
              tr(
                op.state === "uncertain" ? "核对结果" : "核对进度",
                op.state === "uncertain"
                  ? "Reconcile result"
                  : "Check progress",
              )
            }}</UiButton>
          </div>
        </article>
      </div></StateBlock
    >
    <div v-if="list.data.value" class="pagination">
      <UiButton v-if="cursor" @click="cursor = ''">{{
        tr("回到首页", "First page")
      }}</UiButton
      ><UiButton
        v-if="list.data.value.next_cursor"
        @click="cursor = list.data.value!.next_cursor!"
        >{{ tr("下一页", "Next page") }}</UiButton
      >
    </div>
    <UiOverlay
      :open="!!selected"
      :title="
        mode === 'dispatch'
          ? tr('派发任务', 'Dispatch task')
          : tr('核对任务进度', 'Check task progress')
      "
      :description="displayName || ''"
      :busy="mutation.busy.value"
      :close-label="tr('关闭', 'Close')"
      @close="selected = null"
      ><p class="secondary">
        {{
          mode === "dispatch"
            ? tr(
                "将向节点发送一次此任务。确认后，请勿重复派发。",
                "Send this task to the node once. Do not dispatch it again.",
              )
            : tr(
                "只查询节点已有操作的结果，不会重新执行任务。",
                "Query the existing node operation. The task will not be executed again.",
              )
        }}
      </p>
      <dl class="detail-pairs">
        <div>
          <dt>{{ tr("实例", "Instance") }}</dt>
          <dd>{{ selected?.instance_id }}</dd>
        </div>
        <div>
          <dt>{{ tr("任务 ID", "Task ID") }}</dt>
          <dd>{{ selected?.id }}</dd>
        </div>
      </dl>
      <label class="field"
        >{{ tr("输入任务 ID 以确认", "Type the task ID to confirm")
        }}<input
          v-model="confirmation"
          autocomplete="off"
          :disabled="
            mutation.busy.value ||
            (!!mutation.pendingKey.value && mode !== 'reconcile')
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
            confirmation !== selected?.id ||
            (!!mutation.pendingKey.value && mode !== 'reconcile')
          "
          @click="submit"
          >{{
            mode === "dispatch"
              ? tr("确认派发", "Confirm dispatch")
              : tr("核对进度", "Check progress")
          }}</UiButton
        ></template
      ></UiOverlay
    >
  </section>
</template>
<style scoped>
.operation-row {
  padding: 24px;
  display: flex;
  align-items: center;
  gap: 24px;
  border-bottom: 1px solid var(--border);
}
.operation-row:last-child {
  border-bottom: 0;
}
.operation-main {
  min-width: 0;
  flex: 1;
}
.operation-name {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.operation-name strong {
  font-size: 15px;
}
.operation-main > code {
  display: block;
  color: var(--secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
  margin-top: 12px;
}
.operation-context {
  display: flex;
  gap: 18px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 10px;
  font-size: 12px;
  color: var(--secondary);
}
.operation-context a {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--accent-text);
  overflow-wrap: anywhere;
}
.operation-context a svg {
  flex-shrink: 0;
}
.operation-actions {
  display: flex;
  gap: 8px;
}
.field {
  margin-top: 24px;
}
@media (max-width: 600px) {
  .operation-row {
    padding: 20px;
    align-items: flex-start;
    flex-direction: column;
    gap: 16px;
  }
  .operation-actions {
    width: 100%;
  }
  .operation-context {
    gap: 8px;
  }
}
</style>

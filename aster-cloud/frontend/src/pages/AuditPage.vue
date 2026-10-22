<script setup lang="ts">
import { shallowRef } from "vue";
import { RefreshCw } from "@lucide/vue";
import { useConsole } from "../context";
import { useQuery } from "../composables/query";
import { validAudit, validPage } from "../api/client";
import type { Audit, Page } from "../api/types";
import { dateText, auditNames, actionNames } from "../format";
import UiButton from "../components/UiButton.vue";
import StateBlock from "../components/StateBlock.vue";
const {
  prefs: { tr, locale },
} = useConsole();
const cursor = shallowRef("");
const list = useQuery(
  () =>
    `/audit${cursor.value ? `?cursor=${encodeURIComponent(cursor.value)}` : ""}`,
  (v): v is Page<Audit> => validPage(v, validAudit),
);
</script>
<template>
  <section class="page">
    <header class="page-heading">
      <div>
        <h1>{{ tr("审计记录", "Audit log") }}</h1>
        <p>
          {{
            tr(
              "追溯账户管理与资源操作。",
              "Review account administration and resource operations.",
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
      :title="tr('暂无审计记录', 'No audit records yet')"
      @reload="list.reload"
      ><div class="resource-list">
        <article
          v-for="entry in list.data.value?.items"
          :key="`${entry.source}:${entry.id}`"
          class="audit-row"
        >
          <div class="audit-time">
            <span class="timeline-dot" aria-hidden="true" />{{
              dateText(entry.created_at, locale)
            }}
          </div>
          <div class="audit-content">
            <h2>
              {{
                auditNames[entry.action]
                  ? tr(...auditNames[entry.action]!)
                  : entry.action.startsWith("operation.") &&
                      actionNames[entry.action.slice(10)]
                    ? tr(...actionNames[entry.action.slice(10)]!)
                    : entry.action
              }}
            </h2>
            <dl>
              <div>
                <dt>{{ tr("操作者", "Actor") }}</dt>
                <dd>{{ entry.actor }}</dd>
              </div>
              <div>
                <dt>{{ tr("操作对象", "Target") }}</dt>
                <dd>{{ entry.target }}</dd>
              </div>
            </dl>
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
  </section>
</template>
<style scoped>
.audit-row {
  padding: 24px;
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 20px;
  border-bottom: 1px solid var(--border);
}
.audit-row:last-child {
  border-bottom: 0;
}
.audit-time {
  color: var(--secondary);
  font-size: 12px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding-top: 4px;
  line-height: 1.5;
}
.timeline-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--muted);
  flex-shrink: 0;
  margin-top: 4px;
}
.audit-content h2 {
  font-size: 14px;
  margin: 0 0 14px;
  overflow-wrap: anywhere;
}
.audit-content dl {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin: 0;
}
.audit-content dl > div {
  min-width: 100px;
  max-width: 100%;
}
.audit-content dt {
  font-size: 12px;
  color: var(--secondary);
  margin-bottom: 5px;
}
.audit-content dd {
  margin: 0;
  font-size: 13px;
  overflow-wrap: anywhere;
}
@media (max-width: 700px) {
  .audit-row {
    grid-template-columns: 1fr;
    gap: 14px;
    padding: 20px;
  }
  .audit-content {
    padding-left: 19px;
  }
  .audit-content dl {
    flex-direction: column;
    gap: 12px;
  }
}
</style>

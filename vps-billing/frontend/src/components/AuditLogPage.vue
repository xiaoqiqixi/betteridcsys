<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import {
  Activity,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "@lucide/vue";
import {
  api,
  ApiError,
  type AdminAuditEvent,
  type Audit,
  type AuditEventsPage,
} from "../lib/api";
import { intlLocale, tr } from "../lib/i18n";
import {
  auditActionLabels as actions,
  auditActionLabel as label,
} from "../lib/audit";

const props = withDefaults(
  defineProps<{
    account: string;
    administrator: boolean;
    preview?: boolean;
    previewItems?: Audit[];
    refreshKey?: number;
  }>(),
  { preview: false, previewItems: () => [], refreshKey: 0 },
);
const emit = defineEmits<{ "auth-expired": [] }>();
const blank = () => ({
  action: "",
  actor_email: "",
  owner_id: "",
  from: "",
  until: "",
});
type Filters = ReturnType<typeof blank>;
type Query = {
  filters: Filters;
  cursor: string;
  history: string[];
  index: number;
};
const draft = reactive(blank());
const invalid = ref<Partial<Record<keyof Filters, string>>>({});
const form = ref<HTMLFormElement>();
const filtersExpanded = ref(false);
function syncFilterPanel(event: Event) {
  filtersExpanded.value = (event.target as HTMLDetailsElement).open;
}
const page = ref<AuditEventsPage>();
const loading = ref(false),
  error = ref("");
const requestID = ref("");
const index = ref(0),
  history = ref([""]);
let applied = blank(),
  generation = 0;
let pending: Query = { filters: blank(), cursor: "", history: [""], index: 0 };
const owner = (event: Audit) =>
  props.administrator && "owner_id" in event ? String(event.owner_id) : "";
const timestamp = (value: string) =>
  new Intl.DateTimeFormat(intlLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
const visible = computed(() => page.value?.items ?? []);
function utc(value: string) {
  if (!value) return "";
  const complete = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ? value + ":00"
    : value;
  const at = new Date(complete + "Z");
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(complete) &&
    Number.isFinite(at.getTime()) &&
    at.toISOString().slice(0, 19) === complete
    ? complete + "Z"
    : undefined;
}
function readPage(value: unknown): AuditEventsPage {
  if (!value || typeof value !== "object")
    throw new Error("INVALID_AUDIT_PAGE");
  const p = value as Record<string, unknown>;
  if (
    !Array.isArray(p.items) ||
    !Number.isInteger(p.limit) ||
    Number(p.limit) < 1 ||
    Number(p.limit) > 100 ||
    p.items.length > Number(p.limit) ||
    typeof p.has_more !== "boolean" ||
    (p.has_more &&
      (typeof p.next_cursor !== "string" ||
        !p.next_cursor ||
        p.next_cursor.length > 2048))
  )
    throw new Error("INVALID_AUDIT_PAGE");
  const keys = [
    "id",
    "action",
    "target",
    "created_at",
    "actor_email",
    "detail",
  ] as const;
  const items = p.items.map((row: unknown) => {
    if (!row || typeof row !== "object") throw new Error("INVALID_AUDIT_EVENT");
    const raw = row as Record<string, unknown>;
    if (
      keys.some((key) => typeof raw[key] !== "string") ||
      !Number.isFinite(Date.parse(String(raw.created_at)))
    )
      throw new Error("INVALID_AUDIT_EVENT");
    const event = Object.fromEntries(
      keys.map((key) => [key, raw[key]]),
    ) as unknown as Audit;
    if (!props.administrator) return event;
    if (
      typeof raw.owner_id !== "string" ||
      !/^[a-f0-9]{32}$/.test(raw.owner_id)
    )
      throw new Error("INVALID_AUDIT_OWNER");
    return { ...event, owner_id: raw.owner_id } satisfies AdminAuditEvent;
  });
  return {
    items,
    has_more: p.has_more,
    limit: Number(p.limit),
    ...(p.has_more ? { next_cursor: String(p.next_cursor) } : {}),
  };
}
async function load(query: Query) {
  const current = ++generation;
  pending = query;
  loading.value = true;
  error.value = "";
  requestID.value = "";
  try {
    if (props.preview) {
      page.value = {
        items: props.previewItems.slice(0, 50),
        has_more: false,
        limit: 50,
      };
      return;
    }
    const params = new URLSearchParams({ limit: "50" });
    for (const [key, value] of Object.entries(query.filters))
      if (value && (key !== "owner_id" || props.administrator))
        params.set(key, value);
    if (query.cursor) params.set("cursor", query.cursor);
    const endpoint = props.administrator
      ? "/admin/audit-events"
      : "/audit-events";
    const response = await api<unknown>(endpoint + "?" + params);
    if (current !== generation) return;
    const result = readPage(response);
    page.value = result;
    applied = { ...query.filters };
    index.value = query.index;
    history.value = query.history;
  } catch (failure) {
    if (current !== generation) return;
    const expired =
      failure instanceof ApiError && [401, 403].includes(failure.status ?? 0);
    if (expired) {
      page.value = undefined;
      emit("auth-expired");
    }
    error.value = expired
      ? tr(
          "登录或权限已变化，请重新登录后查询。",
          "Your session or permissions changed. Sign in again to query records.",
        )
      : tr(
          "未能载入审计记录，可重试或重置筛选重新查询。",
          "Audit records could not be loaded. Retry, or reset the filters to start a new query.",
        );
    requestID.value =
      failure instanceof ApiError ? (failure.requestId ?? "") : "";
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function submit() {
  if (loading.value || props.preview) return;
  const filters = Object.fromEntries(
    Object.entries(draft).map(([k, v]) => [k, v.trim()]),
  ) as Filters;
  const errors: typeof invalid.value = {};
  if (filters.action && !/^[a-z][a-z0-9_.-]{0,63}$/.test(filters.action))
    errors.action = tr(
      "使用小写操作代码，例如 order.cancelled。",
      "Use a lowercase action code, such as order.cancelled.",
    );
  if (
    new TextEncoder().encode(filters.actor_email).length > 254 ||
    /[\u0000-\u001f\u007f]/.test(filters.actor_email)
  )
    errors.actor_email = tr(
      "操作者标识不能超过 254 字节或包含控制字符。",
      "Actor identifiers must fit within 254 bytes without control characters.",
    );
  if (
    props.administrator &&
    filters.owner_id &&
    !/^[a-f0-9]{32}$/.test(filters.owner_id)
  )
    errors.owner_id = tr(
      "填写完整的 32 位小写十六进制账户 ID。",
      "Enter the full 32-character lowercase hexadecimal account ID.",
    );
  for (const key of ["from", "until"] as const) {
    const result = utc(filters[key]);
    if (result === undefined)
      errors[key] = tr(
        "填写有效的 UTC 日期与时间。",
        "Enter a valid UTC date and time.",
      );
    else filters[key] = result;
  }
  if (
    !errors.from &&
    !errors.until &&
    filters.from &&
    filters.until &&
    filters.from >= filters.until
  )
    errors.until = tr(
      "结束时间必须晚于开始时间。",
      "The end time must be later than the start time.",
    );
  invalid.value = errors;
  if (Object.keys(errors).length) {
    filtersExpanded.value = true;
    if (errors.owner_id || errors.from || errors.until) {
      const advanced =
        form.value?.querySelector<HTMLDetailsElement>(".audit-advanced");
      if (advanced) advanced.open = true;
    }
    await nextTick();
    form.value
      ?.querySelector<HTMLInputElement>('[aria-invalid="true"]')
      ?.focus();
    return;
  }
  if (!props.administrator) filters.owner_id = "";
  await load({ filters, cursor: "", history: [""], index: 0 });
}
function reset() {
  Object.assign(draft, blank());
  invalid.value = {};
  void load({ filters: blank(), cursor: "", history: [""], index: 0 });
}
function turn(next: boolean) {
  if (loading.value || error.value || !page.value) return;
  if (next && page.value.has_more && page.value.next_cursor) {
    const cursor = page.value.next_cursor;
    void load({
      filters: { ...applied },
      cursor,
      history: [...history.value.slice(0, index.value + 1), cursor],
      index: index.value + 1,
    });
  } else if (!next && index.value > 0) {
    void load({
      filters: { ...applied },
      cursor: history.value[index.value - 1]!,
      history: [...history.value],
      index: index.value - 1,
    });
  }
}
function refresh() {
  void load({ ...pending, filters: { ...pending.filters } });
}
watch(
  () => [props.account, props.administrator],
  () => {
    const identityGeneration = ++generation;
    page.value = undefined;
    loading.value = false;
    error.value = "";
    requestID.value = "";
    index.value = 0;
    history.value = [""];
    applied = blank();
    pending = { filters: blank(), cursor: "", history: [""], index: 0 };
    Object.assign(draft, blank());
    invalid.value = {};
    filtersExpanded.value = false;
    // Invalidate immediately; wait for the account and role props to update together.
    void nextTick(() => {
      if (identityGeneration === generation && props.account) refresh();
    });
  },
  { flush: "sync" },
);
watch(() => props.refreshKey, refresh);
onMounted(() => {
  if (props.account) refresh();
});
onBeforeUnmount(() => {
  generation++;
});
</script>

<template>
  <section
    class="audit-log-page"
    data-testid="audit-log-page"
    :aria-busy="loading"
  >
    <p class="audit-context">
      {{
        tr(
          "查询业务操作记录，不包含主机原始日志。操作代码不是 HTTP 状态，事件编号也不是 HTTP 请求编号。",
          "Query business actions, not raw host logs. Action codes are not HTTP statuses, and event IDs are not HTTP request IDs.",
        )
      }}
    </p>
    <p v-if="preview" class="page-note" role="status">
      {{
        tr(
          "离线示例：以下记录仅供预览，不查询或修改后台日志。",
          "Offline sample: these records are for preview only. No server logs are queried or modified.",
        )
      }}
    </p>
    <details
      class="panel audit-filter-panel"
      :open="filtersExpanded"
      @toggle="syncFilterPanel"
    >
      <summary class="audit-query-summary">
        <span>{{ tr("筛选记录", "Filter records") }}</span
        ><small>{{
          tr("操作、操作者与 UTC 时间", "Action, actor and UTC time")
        }}</small
        ><ChevronDown :size="16" aria-hidden="true" />
      </summary>
      <form
        ref="form"
        class="audit-filters"
        :aria-label="tr('审计查询筛选', 'Audit query filters')"
        novalidate
        @submit.prevent="submit"
      >
        <div class="audit-filter-fields">
          <label
            ><span>{{ tr("操作代码（精确）", "Action code (exact)") }}</span
            ><input
              v-model="draft.action"
              name="audit_action"
              list="audit-actions"
              :disabled="preview || loading"
              :aria-invalid="!!invalid.action"
              aria-describedby="audit-action-help audit-action-error"
              placeholder="order.cancelled"
              autocomplete="off"
            /><small id="audit-action-help">{{
              tr(
                "留空查询全部操作；支持完整操作代码。",
                "Leave blank for all actions; enter a complete action code.",
              )
            }}</small
            ><small
              v-if="invalid.action"
              id="audit-action-error"
              class="audit-field-error"
              >{{ invalid.action }}</small
            ></label
          >
          <label
            ><span>{{ tr("操作者（精确）", "Actor (exact)") }}</span
            ><input
              v-model="draft.actor_email"
              name="audit_actor"
              type="text"
              :disabled="preview || loading"
              :aria-invalid="!!invalid.actor_email"
              aria-describedby="audit-actor-help audit-actor-error"
              autocomplete="off"
            /><small id="audit-actor-help">{{
              tr(
                "邮箱或系统标识，例如 payment:provider。",
                "Email or system identifier, such as payment:provider.",
              )
            }}</small
            ><small
              v-if="invalid.actor_email"
              id="audit-actor-error"
              class="audit-field-error"
              >{{ invalid.actor_email }}</small
            ></label
          >
        </div>
        <datalist id="audit-actions">
          <option
            v-for="(_, action) in actions"
            :key="action"
            :value="action"
          />
        </datalist>
        <details class="audit-advanced">
          <summary>
            {{ tr("时间与账户筛选", "Time and account filters")
            }}<ChevronDown :size="16" aria-hidden="true" />
          </summary>
          <div class="audit-filter-fields">
            <label
              ><span>{{
                tr("开始时间（UTC，含）", "From (UTC, inclusive)")
              }}</span
              ><input
                v-model="draft.from"
                name="audit_from"
                type="datetime-local"
                step="1"
                :disabled="preview || loading"
                :aria-invalid="!!invalid.from"
                aria-describedby="audit-from-error"
              /><small
                v-if="invalid.from"
                id="audit-from-error"
                class="audit-field-error"
                >{{ invalid.from }}</small
              ></label
            >
            <label
              ><span>{{
                tr("结束时间（UTC，不含）", "Until (UTC, exclusive)")
              }}</span
              ><input
                v-model="draft.until"
                name="audit_until"
                type="datetime-local"
                step="1"
                :disabled="preview || loading"
                :aria-invalid="!!invalid.until"
                aria-describedby="audit-until-error"
              /><small
                v-if="invalid.until"
                id="audit-until-error"
                class="audit-field-error"
                >{{ invalid.until }}</small
              ></label
            >
            <label v-if="administrator" class="audit-owner-filter"
              ><span>{{
                tr("事件所属账户 ID（精确）", "Event owner account ID (exact)")
              }}</span
              ><input
                v-model="draft.owner_id"
                name="audit_owner"
                :disabled="preview || loading"
                :aria-invalid="!!invalid.owner_id"
                aria-describedby="audit-owner-help audit-owner-error"
                autocomplete="off"
              /><small id="audit-owner-help">{{
                tr(
                  "指事件归属账户，不一定是操作者；不推断历史身份。",
                  "The account that owns the event, not necessarily its actor. Historical identities are not inferred.",
                )
              }}</small
              ><small
                v-if="invalid.owner_id"
                id="audit-owner-error"
                class="audit-field-error"
                >{{ invalid.owner_id }}</small
              ></label
            >
          </div>
        </details>
        <div class="audit-filter-actions">
          <button
            class="button primary"
            type="submit"
            :disabled="preview || loading"
          >
            {{ tr("查询记录", "Query records") }}</button
          ><button
            class="button secondary"
            type="button"
            :disabled="preview || loading"
            @click="reset"
          >
            {{ tr("重置筛选", "Reset filters") }}</button
          ><button
            class="button text-button"
            type="button"
            :disabled="preview || loading"
            @click="refresh"
          >
            <RefreshCw
              :size="15"
              :class="{ spin: loading }"
              aria-hidden="true"
            />{{ tr("刷新本页", "Refresh page") }}
          </button>
        </div>
      </form>
    </details>
    <div v-if="error" class="alert error audit-query-error" role="alert">
      <span>{{ error }}</span
      ><button type="button" :disabled="loading" @click="refresh">
        {{ tr("重试", "Retry") }}
      </button>
      <span v-if="requestID" class="audit-request-id"
        ><span>{{ tr("请求编号：", "Request ID: ") }}</span
        ><code>{{ requestID }}</code></span
      >
    </div>
    <p v-if="loading" class="audit-feedback" role="status">
      {{
        page
          ? tr(
              "正在刷新查询，当前仍显示上次成功载入的记录。",
              "Refreshing the query. Previously loaded records remain visible.",
            )
          : tr("正在查询审计记录…", "Querying audit records…")
      }}
    </p>
    <p v-else-if="error && page" class="audit-feedback" role="status">
      {{
        tr(
          "以下仍为上次成功查询的记录，可能已过期；未将失败查询视为没有记录。",
          "The last successful query remains below and may be out of date. A failed query does not mean there are no records.",
        )
      }}
    </p>
    <div
      v-if="page"
      class="audit-results"
      :aria-label="tr('审计查询结果', 'Audit query results')"
    >
      <div class="audit-result-heading">
        <p role="status">
          {{
            tr(
              `第 ${index + 1} 页 · 本页 ${visible.length} 条`,
              `Page ${index + 1} · ${visible.length} ${visible.length === 1 ? "record" : "records"}`,
            )
          }}
        </p>
        <span>{{
          tr(
            `每页最多 ${page.limit} 条 · 按时间和事件编号倒序`,
            `Up to ${page.limit} per page · Newest time and event ID first`,
          )
        }}</span>
      </div>
      <div v-if="!visible.length" class="panel empty-state audit-empty">
        <Activity :size="26" aria-hidden="true" />
        <h2>
          {{
            tr("没有符合条件的审计记录", "No audit records match these filters")
          }}
        </h2>
        <p>
          {{
            tr(
              "可调整时间、操作或操作者，或重置筛选重新查询。",
              "Adjust the time, action or actor, or reset the filters and query again.",
            )
          }}
        </p>
      </div>
      <ol v-else class="audit-events">
        <li
          v-for="event in visible"
          :key="event.id"
          class="panel audit-event"
          :data-event-id="event.id"
        >
          <div class="audit-event-heading">
            <div>
              <strong>{{ label(event.action) }}</strong
              ><code>{{ event.action }}</code>
            </div>
            <time :datetime="event.created_at">{{
              timestamp(event.created_at)
            }}</time>
          </div>
          <dl>
            <div>
              <dt>{{ tr("操作者", "Actor") }}</dt>
              <dd>{{ event.actor_email }}</dd>
            </div>
            <div>
              <dt>{{ tr("目标", "Target") }}</dt>
              <dd class="mono">{{ event.target }}</dd>
            </div>
            <div v-if="owner(event)">
              <dt>{{ tr("所属账户", "Owner account") }}</dt>
              <dd class="mono">{{ owner(event) }}</dd>
            </div>
            <div>
              <dt>{{ tr("事件编号", "Event ID") }}</dt>
              <dd class="mono">{{ event.id }}</dd>
            </div>
          </dl>
          <details>
            <summary>
              {{ tr("查看操作详情", "View action details")
              }}<ChevronDown :size="16" aria-hidden="true" />
            </summary>
            <p class="audit-event-detail">
              {{
                event.detail || tr("未记录详情。", "No details were recorded.")
              }}
            </p>
          </details>
        </li>
      </ol>
      <nav
        class="audit-pagination"
        :aria-label="tr('审计分页', 'Audit pagination')"
      >
        <button
          class="button secondary"
          type="button"
          :disabled="preview || loading || !!error || index === 0"
          @click="turn(false)"
        >
          <ChevronLeft :size="16" aria-hidden="true" />{{
            tr("上一页", "Previous")
          }}
        </button>
        <p>
          {{
            page.has_more
              ? tr("还有更早的记录", "More earlier records are available")
              : tr("已到本次查询末页", "End of this query")
          }}
        </p>
        <button
          class="button secondary"
          type="button"
          :disabled="preview || loading || !!error || !page.has_more"
          @click="turn(true)"
        >
          {{ tr("下一页", "Next")
          }}<ChevronRight :size="16" aria-hidden="true" />
        </button>
      </nav>
    </div>
  </section>
</template>

<style scoped>
.audit-log-page {
  display: grid;
  gap: 20px;
}
.audit-context,
.audit-feedback {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
  margin: 0;
}
.audit-filter-panel {
  padding: 6px 24px;
}
.audit-query-summary {
  min-height: 54px;
  justify-content: flex-start;
  font-weight: 600;
}
.audit-query-summary small {
  font-size: 13px;
  font-weight: 400;
  color: var(--text-secondary);
  margin-left: auto;
}
.audit-filter-panel[open] > .audit-query-summary {
  border-bottom: 1px solid var(--border);
}
.audit-filters {
  padding: 20px 0 18px;
}
.audit-filter-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.audit-filter-fields label {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
  color: var(--text-primary);
  font-size: 14px;
}
.audit-filter-fields input {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  border: 1px solid var(--control-border);
  border-radius: 8px;
  padding: 9px 12px;
  color: var(--text-primary);
  background: var(--surface);
  font: inherit;
}
.audit-filter-fields small {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.audit-filter-fields .audit-field-error {
  color: var(--status-danger);
}
.audit-advanced {
  margin-top: 16px;
}
.audit-advanced > .audit-filter-fields {
  padding-top: 16px;
}
.audit-owner-filter {
  grid-column: 1 / -1;
}
summary {
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-primary);
}
summary::-webkit-details-marker {
  display: none;
}
details[open] > summary svg {
  transform: rotate(180deg);
}
.audit-filter-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
.audit-result-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin-bottom: 14px;
}
.audit-result-heading p {
  margin: 0;
  font-weight: 600;
  font-size: 14px;
}
.audit-result-heading > span {
  font-size: 13px;
  color: var(--text-secondary);
}
.audit-events {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 14px;
}
.audit-event {
  padding: 24px;
  min-width: 0;
}
.audit-event-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
}
.audit-event-heading > div {
  display: grid;
  gap: 5px;
  min-width: 0;
}
.audit-event-heading strong {
  font-size: 17px;
  line-height: 1.5;
}
.audit-event-heading code {
  color: var(--text-secondary);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.audit-event time {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.audit-event dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 24px;
  margin: 20px 0 14px;
}
.audit-event dl > div {
  display: grid;
  grid-template-columns: 6em minmax(0, 1fr);
  gap: 10px;
  font-size: 14px;
  line-height: 1.7;
  min-width: 0;
}
.audit-event dt {
  color: var(--text-secondary);
}
.audit-event dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.audit-event details {
  border-top: 1px solid var(--border);
  padding-top: 4px;
}
.audit-event-detail {
  margin: 8px 0 0;
  padding: 16px;
  background: var(--surface-subtle);
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.audit-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 20px;
}
.audit-pagination p {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
}
.audit-query-error {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
}
.audit-query-error > span {
  min-width: 0;
}
.audit-query-error .audit-request-id {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  grid-column: 1 / -1;
  overflow-wrap: anywhere;
}
.audit-request-id code {
  min-width: 0;
}
.audit-empty h2 {
  font-size: 18px;
}
@media (max-width: 720px) {
  .audit-log-page {
    gap: 16px;
  }
  .audit-filter-panel {
    padding: 4px 18px;
  }
  .audit-query-summary {
    flex-wrap: wrap;
    gap: 4px 12px;
    padding: 8px 0;
  }
  .audit-query-summary small {
    order: 3;
    flex-basis: 100%;
  }
  .audit-query-summary svg {
    margin-left: auto;
  }
  .audit-event {
    padding: 18px;
  }
  .audit-filter-fields {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  .audit-event-heading {
    flex-direction: column;
    gap: 8px;
  }
  .audit-event dl {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    margin-top: 16px;
  }
  .audit-pagination {
    flex-wrap: wrap;
    gap: 12px;
  }
  .audit-pagination p {
    order: 3;
    width: 100%;
  }
  .audit-filter-actions .button {
    flex: 1 1 auto;
  }
}
</style>

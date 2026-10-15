<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RefreshCw } from "@lucide/vue";
import { api, ApiError } from "../lib/api";
import { tr } from "../lib/i18n";
import {
  isNativeOperationActive,
  readNativeOperationView,
  type NativeOperation,
  type NativeOperationView,
} from "../lib/native-operations";

const props = defineProps<{ preview: boolean; administrator: boolean }>();
const view = ref<NativeOperationView>();
const loading = ref(false);
const sessionExpired = ref(false);
const retrying = ref(false);
let generation = 0;
let poll: ReturnType<typeof setTimeout> | undefined;
let observingActive = false;
let retryAttempt = 0;
const operation = computed(() =>
  view.value?.state === "available" ? view.value.operation : undefined,
);
const statusText = computed(() => {
  const labels: Record<NativeOperation["status"], [string, string]> = {
    checking: ["主机检查中", "Host checks in progress"],
    prepared: ["主机准备完成", "Host preparation complete"],
    executing: ["主机执行中", "Host execution in progress"],
    succeeded: ["主机执行成功", "Host execution succeeded"],
    failed: ["主机执行失败", "Host execution failed"],
    needs_manual_recovery: ["需要人工恢复", "Manual recovery required"],
    rolled_back: ["程序已回退", "Program rolled back"],
  };
  return operation.value ? tr(...labels[operation.value.status]) : "";
});
const phaseText = computed(() => {
  const labels: Record<NativeOperation["phase"], [string, string]> = {
    confirmed: ["主机管理员已确认", "Confirmed by the host administrator"],
    install_preflight: [
      "检查安装前置条件",
      "Checking installation prerequisites",
    ],
    provision: [
      "准备系统与数据库身份",
      "Provisioning system and database identities",
    ],
    configure: ["配置主机服务", "Configuring host services"],
    old_schema_preflight: [
      "核对旧版与数据库结构",
      "Checking the previous release and database schema",
    ],
    maintenance: ["进入维护窗口", "Entering maintenance"],
    backup: ["核验备份", "Verifying backups"],
    migrate: ["执行数据库迁移", "Applying database migrations"],
    first_admin: ["创建首位管理员", "Creating the first administrator"],
    activate: ["切换程序版本", "Activating the release"],
    readiness: [
      "检查服务与 HTTPS 就绪",
      "Checking service and HTTPS readiness",
    ],
    complete: ["执行完成", "Execution complete"],
  };
  const label = operation.value && labels[operation.value.phase];
  return label
    ? tr(...label)
    : tr(
        "阶段未识别，请核对主机记录",
        "Phase unrecognized; check the host records",
      );
});
const actionText = computed(() => {
  const labels: Record<NativeOperation["action"], [string, string]> = {
    install: ["首次安装", "Initial installation"],
    upgrade: ["升级", "Upgrade"],
    recover: ["恢复", "Recovery"],
  };
  return operation.value ? tr(...labels[operation.value.action]) : "";
});
const serviceText = computed(() => {
  const labels: Record<NativeOperation["service_action"], [string, string]> = {
    none: ["未记录服务动作", "No service action recorded"],
    stopped: ["服务已停止", "Services stopped"],
    started: ["服务已启动", "Services started"],
    previous_started: [
      "先前版本服务已启动",
      "Previous release services started",
    ],
  };
  return operation.value ? tr(...labels[operation.value.service_action]) : "";
});
const stateText = computed(() => {
  if (props.preview)
    return tr(
      "离线预览：不读取主机执行回执。",
      "Offline preview: host execution receipts are not read.",
    );
  if (sessionExpired.value)
    return tr(
      "管理员会话已失效，已停止读取回执。请重新登录。",
      "Your administrator session expired. Receipt reads have stopped; sign in again.",
    );
  if (!view.value)
    return tr("正在读取主机执行回执…", "Reading the host execution receipt…");
  const labels = {
    unconfigured: [
      "主机回执读取未配置，无法确认安装或升级执行状态。",
      "Host receipt access is not configured. Installation or upgrade execution status is unknown.",
    ],
    absent: [
      "主机尚无执行回执，不能据此确认安装或升级已开始。",
      "No host execution receipt is present. This does not confirm that installation or upgrade has started.",
    ],
    unavailable: [
      "主机执行回执不可用，当前结果未知。请核对主机记录后重新读取。",
      "The host execution receipt is unavailable. The current result is unknown; check the host records and refresh.",
    ],
  } as const;
  if (view.value.state === "available") return "";
  const label = labels[view.value.state];
  return tr(label[0], label[1]);
});
function clearPoll() {
  if (poll !== undefined) clearTimeout(poll);
  poll = undefined;
}
function schedulePoll() {
  clearPoll();
  if (
    props.administrator &&
    !props.preview &&
    !sessionExpired.value &&
    !document.hidden &&
    ((operation.value && isNativeOperationActive(operation.value)) ||
      retrying.value)
  )
    poll = setTimeout(
      () => void refresh(),
      retrying.value ? Math.min(5000 * 2 ** (retryAttempt - 1), 30000) : 5000,
    );
}
async function refresh() {
  if (
    !props.administrator ||
    props.preview ||
    loading.value ||
    sessionExpired.value
  )
    return;
  clearPoll();
  const current = generation;
  loading.value = true;
  try {
    const result = readNativeOperationView(
      await api<unknown>("/admin/updates/operation"),
    );
    if (current === generation) {
      view.value = result;
      observingActive =
        result.state === "available" &&
        isNativeOperationActive(result.operation);
      retrying.value = false;
      retryAttempt = 0;
    }
  } catch (cause) {
    if (current !== generation) return;
    view.value = { state: "unavailable" };
    const expired =
      cause instanceof ApiError &&
      ([401, 403].includes(cause.status || 0) ||
        ["AUTH_REQUIRED", "UNAUTHORIZED", "FORBIDDEN"].includes(cause.code));
    sessionExpired.value = expired;
    const transient =
      !(cause instanceof ApiError) ||
      cause.code === "INVALID_RESPONSE" ||
      (cause.status || 0) >= 500;
    if (!expired && transient && observingActive && retryAttempt < 6) {
      retryAttempt++;
      retrying.value = true;
    } else {
      observingActive = false;
      retrying.value = false;
    }
  } finally {
    if (current === generation) {
      loading.value = false;
      schedulePoll();
    }
  }
}
function visibilityChanged() {
  if (document.hidden) clearPoll();
  else schedulePoll();
}
watch(
  () => [props.administrator, props.preview],
  () => {
    generation++;
    clearPoll();
    loading.value = false;
    sessionExpired.value = false;
    retrying.value = false;
    observingActive = false;
    retryAttempt = 0;
    view.value = undefined;
    if (props.administrator && !props.preview) void refresh();
  },
  { immediate: true },
);
onMounted(() =>
  document.addEventListener("visibilitychange", visibilityChanged),
);
onBeforeUnmount(() => {
  generation++;
  clearPoll();
  document.removeEventListener("visibilitychange", visibilityChanged);
});
</script>

<template>
  <section
    v-if="administrator"
    class="panel native-operation"
    aria-labelledby="native-operation-title"
    :aria-busy="loading"
    :data-operation-state="operation?.status || view?.state || 'loading'"
  >
    <div class="native-operation-heading">
      <h3 id="native-operation-title">
        {{ tr("主机安装与升级回执", "Host installation and upgrade receipt") }}
      </h3>
      <button
        class="button secondary"
        type="button"
        data-action="refresh-operation"
        :disabled="preview || loading || sessionExpired"
        @click="refresh"
      >
        <RefreshCw :size="16" :class="{ spin: loading }" />{{
          tr("读取主机回执", "Refresh host receipt")
        }}
      </button>
    </div>
    <p class="settings-help">
      {{
        tr(
          "网页仅只读展示主机受限工具的最近回执，不执行命令或授予 root 权限。回执不代替当前服务或业务验收。",
          "This page reads the restricted host tool’s latest receipt. It executes no commands and grants no root privileges. A receipt does not replace current service or business validation.",
        )
      }}
    </p>
    <p v-if="stateText" :role="sessionExpired ? 'alert' : 'status'">
      {{ stateText }}
    </p>
    <p v-if="retrying" class="settings-help">
      {{
        tr(
          "执行期间连接暂时中断，正在有限次数重新读取回执；不会重试主机操作。",
          "The connection was interrupted during execution. Receipt reads will retry a limited number of times; the host operation will not be retried.",
        )
      }}
    </p>
    <template v-if="operation">
      <p class="native-operation-status" role="status">{{ statusText }}</p>
      <p>
        {{ actionText }} ·
        {{
          operation.previous_core_version || tr("新安装", "New installation")
        }}
        → {{ operation.target_core_version }}
      </p>
      <p>{{ tr("最近报告阶段", "Last reported phase") }}：{{ phaseText }}</p>
      <p>
        {{ tr("回执更新时间", "Receipt updated at") }}：<time
          :datetime="operation.updated_at"
          >{{ operation.updated_at }}</time
        >
      </p>
      <p v-if="operation.status === 'prepared'" class="settings-help">
        {{
          tr(
            "准备完成不等于已安装。执行须由主机管理员明确确认；网页读取或刷新回执不会启动执行。",
            "Prepared does not mean installed. Host execution requires explicit administrator confirmation. Reading or refreshing this receipt does not launch execution.",
          )
        }}
      </p>
      <p
        v-if="
          operation.status === 'needs_manual_recovery' ||
          operation.status === 'failed'
        "
        class="native-operation-warning"
      >
        {{
          tr(
            "保留现场并由主机管理员核对操作记录与备份。网页不会重试执行或恢复数据库。",
            "Preserve the host state and have its administrator check the operation records and backups. This page will not retry execution or restore the database.",
          )
        }}
      </p>
      <ul class="native-operation-facts">
        <li>
          {{ tr("回执报告服务动作", "Reported service action") }}：{{
            serviceText
          }}
        </li>
        <li v-if="operation.maintenance" class="native-operation-warning">
          {{
            tr(
              "回执显示维护仍开启；恢复业务前须由主机管理员处理。",
              "The receipt reports that maintenance remains enabled; the host administrator must resolve it before resuming business.",
            )
          }}
        </li>
        <li
          v-if="
            operation.database_migration.started &&
            !operation.database_migration.completed
          "
          class="native-operation-warning"
        >
          {{
            tr(
              "数据库迁移已开始但尚未报告完成。禁止据程序回退推断数据库已恢复。",
              "Database migration started without reported completion. A program rollback does not establish database recovery.",
            )
          }}
        </li>
        <li v-else-if="operation.database_migration.completed">
          {{
            tr(
              "回执报告数据库迁移完成。",
              "The receipt reports database migration completion.",
            )
          }}
        </li>
        <li v-if="operation.active_release_changed">
          {{
            tr(
              "回执报告活动程序版本已切换。",
              "The receipt reports an active release change.",
            )
          }}
        </li>
        <li
          v-if="operation.status === 'rolled_back'"
          class="native-operation-warning"
        >
          {{
            tr(
              "回退记录仅涉及程序；没有自动数据库降级或恢复保证。",
              "The rollback record concerns the program; it provides no automatic database downgrade or recovery guarantee.",
            )
          }}
        </li>
        <li
          v-if="operation.program_rollback === 'blocked_schema_or_readiness'"
          class="native-operation-warning"
        >
          {{
            tr(
              "因数据库结构或就绪条件无法核实，程序回退被阻止；需要主机管理员人工恢复。",
              "Program rollback was blocked because schema or readiness checks could not be satisfied. Manual host recovery is required.",
            )
          }}
        </li>
        <li v-if="!operation.https_ready" class="native-operation-warning">
          {{
            tr(
              "HTTPS 就绪尚未确认。",
              "HTTPS readiness has not been confirmed.",
            )
          }}
        </li>
        <li
          v-if="operation.business_validation_required"
          class="native-operation-warning"
        >
          {{
            tr(
              "业务验收仍需完成；执行成功不代表可以商业运营。",
              "Business validation is still required. Successful execution does not establish readiness for commercial operation.",
            )
          }}
        </li>
      </ul>
      <p
        v-if="operation.error_code !== 'none'"
        class="native-operation-warning"
      >
        {{
          tr(
            "工具记录了固定错误类别，请在主机上核对受限记录。",
            "The tool recorded an error category; check the restricted records on the host.",
          )
        }}
      </p>
      <details>
        <summary>
          {{ tr("操作标识与来源", "Operation reference and source") }}
        </summary>
        <dl>
          <dt>{{ tr("操作标识", "Operation reference") }}</dt>
          <dd>{{ operation.operation_id }}</dd>
          <dt>{{ tr("目标源码", "Target source") }}</dt>
          <dd>{{ operation.target_source_sha }}</dd>
          <dt>{{ tr("开始时间", "Started at") }}</dt>
          <dd>{{ operation.started_at }}</dd>
        </dl>
      </details>
    </template>
  </section>
</template>

<style scoped>
.native-operation {
  padding: 24px;
  min-width: 0;
}
.native-operation-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
h3 {
  margin: 0 0 8px;
}
p,
li {
  line-height: 1.65;
  color: var(--text-secondary, #64748b);
}
.native-operation-status {
  color: var(--text-primary, #0f172a);
  font-weight: 600;
}
.native-operation-warning {
  color: #b45309;
}
.native-operation-facts {
  padding-left: 20px;
}
summary {
  cursor: pointer;
  font-weight: 600;
}
time,
dd {
  overflow-wrap: anywhere;
}
dd {
  margin: 4px 0 12px;
  font-size: 13px;
}
@media (max-width: 760px) {
  .native-operation {
    padding: 20px;
  }
  .native-operation-heading {
    flex-wrap: wrap;
  }
}
</style>

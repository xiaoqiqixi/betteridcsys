<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ArrowUpRight, Download, RefreshCw, ShieldCheck } from "@lucide/vue";
import { api, ApiError } from "../lib/api";
import { tr } from "../lib/i18n";
import NativeOperationStatus from "./NativeOperationStatus.vue";
import {
  componentName,
  readUpdateHandoff,
  readUpdateStatus,
  type UpdateCandidate,
  type UpdateComponent,
  type UpdateStatus,
  type UpdateHandoff,
} from "../lib/updates";

const props = defineProps<{ preview: boolean; administrator: boolean }>();
const status = ref<UpdateStatus>();
const loading = ref(false),
  checking = ref(false),
  submitting = ref(false);
const checkedHere = ref(false),
  acknowledged = ref(false),
  blocked = ref(false);
const selected = ref<UpdateComponent>();
const handoff = ref<UpdateHandoff>();
const error = ref<
  "" | "load" | "check" | "busy" | "session" | "stale" | "uncertain"
>("");
let generation = 0;
const busy = computed(
  () => loading.value || checking.value || submitting.value,
);
const candidate = computed(() =>
  status.value?.items.find((item) => item.component === selected.value),
);
const canSelect = (item: UpdateCandidate) =>
  props.administrator &&
  !props.preview &&
  !busy.value &&
  !blocked.value &&
  !handoff.value &&
  checkedHere.value &&
  status.value?.source.status === "available" &&
  item.compatible &&
  item.update_available;
const canSubmit = computed(
  () => candidate.value && canSelect(candidate.value) && acknowledged.value,
);
const errorText = computed(
  () =>
    ({
      "": "",
      load: tr(
        "无法读取版本信息，请确认管理员会话后重试。",
        "Could not load version information. Check your administrator session and retry.",
      ),
      check: tr(
        "无法确认官方更新。私有仓库需要服务器端只读访问配置；当前未确认是否有新版本。",
        "Official updates could not be verified. Private repositories need read-only access configured on the server. Update availability is unknown.",
      ),
      busy: tr(
        "另一个版本检查正在运行，本次未生成交接单。请稍后重新检查。",
        "Another version check is running. No handoff was generated; check again shortly.",
      ),
      session: tr(
        "管理员会话或操作验证已失效，请重新登录后检查更新。",
        "Your administrator session or request verification has expired. Sign in again before checking updates.",
      ),
      stale: tr(
        "版本或前置条件已经变化。本次未生成交接单，请重新检查官方更新。",
        "The version or prerequisites changed. No handoff was generated; check official updates again.",
      ),
      uncertain: tr(
        "无法确认交接单是否已生成。请核对审计日志与主机交接记录后再操作，勿重复提交。",
        "The handoff result could not be confirmed. Check the audit log and host handoff records before another request; do not submit it again.",
      ),
    })[error.value],
);
const smtpStatus = computed(
  () =>
    ({
      not_installed: tr("未安装或未选择", "Not installed or selected"),
      disabled: tr("已禁用", "Disabled"),
      unavailable: tr(
        "无法验证授权文件",
        "Approval files could not be verified",
      ),
      approved: tr("已授权 · 运行状态未检查", "Approved · runtime not checked"),
    })[status.value?.current.smtp_status || "not_installed"],
);
function isSessionError(cause: unknown): boolean {
  return (
    cause instanceof ApiError &&
    [
      "FORBIDDEN",
      "AUTH_REQUIRED",
      "UNAUTHORIZED",
      "CSRF_INVALID",
      "ORIGIN_DENIED",
    ].includes(cause.code)
  );
}
function preconditionText(value: string): string {
  const labels: Record<string, [string, string]> = {
    host_operator_required: [
      "由授权主机运维执行",
      "Authorized host operator required",
    ],
    backup_required: [
      "验证数据库、配置与密钥备份",
      "Verify database, configuration, and key backups",
    ],
    restore_test_required: [
      "确认备份已通过恢复演练",
      "Confirm that backup restoration has been tested",
    ],
    exclusive_lock_required: [
      "取得排他更新锁",
      "Acquire the exclusive update lock",
    ],
    schema_review_required: [
      "检查数据结构变化与回退条件",
      "Review schema changes and rollback conditions",
    ],
    service_restart_required: [
      "安排维护窗口、服务重启与健康检查",
      "Arrange maintenance, service restart, and health checks",
    ],
    plugin_approval_required: [
      "显式确认插件授权与 SMTP 目标",
      "Explicitly confirm plugin approval and SMTP targets",
    ],
  };
  return labels[value] ? tr(...labels[value]) : value;
}
async function load() {
  if (busy.value || !props.administrator || props.preview) return;
  const current = ++generation;
  loading.value = true;
  status.value = undefined;
  selected.value = undefined;
  acknowledged.value = false;
  checkedHere.value = false;
  error.value = "";
  blocked.value = false;
  try {
    const result = readUpdateStatus(await api<unknown>("/admin/updates"));
    if (current === generation) status.value = result;
  } catch (cause) {
    if (current === generation)
      error.value = isSessionError(cause) ? "session" : "load";
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function check() {
  if (busy.value || !props.administrator || props.preview || blocked.value)
    return;
  const current = generation;
  checking.value = true;
  selected.value = undefined;
  acknowledged.value = false;
  checkedHere.value = false;
  error.value = "";
  try {
    const result = readUpdateStatus(
      await api<unknown>("/admin/updates/check", "POST", {}),
    );
    if (current !== generation) return;
    status.value = result;
    checkedHere.value = result.source.status === "available";
    if (!checkedHere.value) error.value = "check";
  } catch (cause) {
    if (current === generation) {
      error.value = isSessionError(cause)
        ? "session"
        : cause instanceof ApiError && cause.code === "UPDATE_BUSY"
          ? "busy"
          : "check";
      if (status.value && error.value === "check")
        status.value = {
          ...status.value,
          source: { ...status.value.source, status: "unavailable" },
          checked_at: "",
          items: [],
        };
    }
  } finally {
    if (current === generation) checking.value = false;
  }
}
function select(item: UpdateCandidate) {
  if (!canSelect(item)) return;
  selected.value = item.component;
  acknowledged.value = false;
  error.value = "";
}
async function requestHandoff() {
  if (!canSubmit.value || !candidate.value || !status.value) return;
  const current = generation;
  const chosen = candidate.value;
  const installed = status.value.current;
  submitting.value = true;
  error.value = "";
  try {
    const result = readUpdateHandoff(
      await api<unknown>("/admin/updates/handoff", "POST", {
        component: chosen.component,
        tag: chosen.tag,
        source_sha: chosen.source_sha,
        release_id: chosen.release_id,
        catalog_sha256: chosen.catalog_sha256,
        acknowledge_manual_handoff: true,
      }),
      chosen,
      installed,
    );
    if (current !== generation) return;
    handoff.value = result;
    acknowledged.value = false;
  } catch (cause) {
    if (current !== generation) return;
    if (isSessionError(cause)) {
      error.value = "session";
      blocked.value = true;
    } else if (cause instanceof ApiError && cause.code === "UPDATE_BUSY") {
      error.value = "busy";
      checkedHere.value = false;
      selected.value = undefined;
      acknowledged.value = false;
    } else if (
      cause instanceof ApiError &&
      ["UPDATE_STALE", "UPDATE_INCOMPATIBLE", "UPDATE_UNAVAILABLE"].includes(
        cause.code,
      )
    ) {
      error.value = "stale";
      checkedHere.value = false;
      selected.value = undefined;
      acknowledged.value = false;
    } else {
      error.value = "uncertain";
      blocked.value = true;
    }
  } finally {
    if (current === generation) submitting.value = false;
  }
}
function downloadHandoff() {
  if (!handoff.value || !props.administrator || props.preview) return;
  const intent = handoff.value.intent;
  const blob = new Blob([JSON.stringify(handoff.value, null, 2) + "\n"], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `aster-update-${intent.component}-${intent.version}-${intent.request_id}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
watch(
  () => [props.preview, props.administrator],
  () => {
    generation++;
    status.value = undefined;
    selected.value = undefined;
    acknowledged.value = false;
    checkedHere.value = false;
    handoff.value = undefined;
    blocked.value = false;
    error.value = "";
    loading.value = checking.value = submitting.value = false;
    if (props.administrator && !props.preview) void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation++;
});
</script>

<template>
  <div class="updates-page">
    <div v-if="!administrator" class="settings-notice" role="status">
      {{
        tr(
          "仅管理员可以查看版本与提交更新交接。",
          "Only administrators can view versions and request an update handoff.",
        )
      }}
    </div>
    <template v-else>
      <div class="updates-intro">
        <div>
          <h2>{{ tr("程序与插件版本", "Core and plugin versions") }}</h2>
          <p>
            {{
              tr(
                "检查官方版本并生成主机更新交接单。主机管理员明确启动受限工具后，才会执行安装或升级；下方单独显示执行回执。",
                "Check official versions and create a host handoff. A host administrator explicitly launches the restricted tool to install or upgrade; its receipt is shown separately below.",
              )
            }}
          </p>
        </div>
        <button
          class="button secondary"
          type="button"
          data-action="reload"
          :disabled="busy || preview"
          @click="load"
        >
          <RefreshCw :size="16" />{{ tr("重新读取", "Reload") }}
        </button>
      </div>
      <div v-if="preview" class="settings-notice" role="status">
        {{
          tr(
            "离线预览：不读取版本、不检查官方更新，也不生成交接单。",
            "Offline preview: no versions are fetched, updates checked, or handoffs created.",
          )
        }}
      </div>
      <div v-if="error" class="alert error" role="alert">{{ errorText }}</div>
      <div v-if="loading" class="panel settings-loading" role="status">
        <RefreshCw :size="20" class="spin" />{{
          tr("正在读取版本…", "Loading versions…")
        }}
      </div>
      <NativeOperationStatus
        :preview="preview"
        :administrator="administrator"
      />
      <template v-if="status">
        <div class="updates-current">
          <section
            class="panel updates-card"
            aria-labelledby="core-current-title"
          >
            <h3 id="core-current-title">
              {{ tr("当前核心程序", "Current core") }}
            </h3>
            <strong class="updates-version">{{
              status.current.core_version
            }}</strong>
            <p>
              {{
                tr(
                  "核心更新包含后台与前端。",
                  "Core updates include the API and frontend.",
                )
              }}
            </p>
          </section>
          <section
            class="panel updates-card"
            aria-labelledby="smtp-current-title"
          >
            <h3 id="smtp-current-title">
              {{ tr("当前 SMTP 选择", "Selected SMTP plugin") }}
            </h3>
            <strong class="updates-version">{{
              status.current.smtp_version || "—"
            }}</strong>
            <p data-plugin-status>{{ smtpStatus }}</p>
            <small>{{
              tr(
                "这里只显示授权选择；投递前会验证运行进程。",
                "This shows the approved selection. The running process is verified before delivery.",
              )
            }}</small>
          </section>
        </div>
        <section
          class="panel updates-card updates-source"
          aria-labelledby="official-update-title"
        >
          <div class="updates-heading">
            <div>
              <h3 id="official-update-title">
                {{ tr("官方发布", "Official releases") }}
              </h3>
              <p>xiaoqiqixi/betteridcsys</p>
            </div>
            <button
              class="button secondary"
              type="button"
              data-action="check"
              :disabled="busy || preview || blocked"
              @click="check"
            >
              <RefreshCw :size="16" :class="{ spin: checking }" />{{
                checking
                  ? tr("正在检查…", "Checking…")
                  : tr("检查官方更新", "Check official updates")
              }}
            </button>
          </div>
          <p v-if="status.source.status === 'not_checked'">
            {{
              tr(
                "尚未检查官方版本。网页不会自动检查或启动安装。",
                "Official versions have not been checked. This page does not automatically check releases or start installation.",
              )
            }}
          </p>
          <p v-else-if="status.source.status === 'unavailable'">
            {{
              tr(
                "官方来源不可用；更新状态尚未确认。",
                "The official source is unavailable. Update availability is unknown.",
              )
            }}
          </p>
          <p v-else>
            {{ tr("最近检查", "Last checked") }}：<time
              :datetime="status.checked_at"
              >{{ status.checked_at }}</time
            >
            <span v-if="!checkedHere">
              ·
              {{
                tr(
                  "提交前请再次检查",
                  "Check again before requesting a handoff",
                )
              }}</span
            >
          </p>
          <p class="settings-help">
            {{
              tr(
                "版本检查只读取发布元数据。资产真实性、备份、排他锁与回退准备由主机工具在安装前再次核验。",
                "The check reads release metadata. The host tool rechecks authenticity, backups, the exclusive lock, and rollback readiness before installation.",
              )
            }}
          </p>
          <p
            v-if="status.source.status === 'available' && !status.items.length"
          >
            {{
              tr(
                "官方来源尚无通过验证的正式版本记录。",
                "The official source has no verified stable release records yet.",
              )
            }}
          </p>
        </section>
        <div v-if="status.items.length" class="updates-candidates">
          <section
            v-for="item in status.items"
            :key="item.component"
            class="panel updates-card"
            :data-component="item.component"
          >
            <div class="updates-heading">
              <h3>{{ componentName(item.component) }} {{ item.version }}</h3>
              <span class="tiny-tag">{{
                !item.compatible
                  ? tr("不兼容", "Incompatible")
                  : item.update_available
                    ? tr("有可用更新", "Update available")
                    : tr("无需更新", "No update needed")
              }}</span>
            </div>
            <p v-if="!item.compatible" class="updates-warning">
              {{
                tr(
                  "此版本与当前程序不兼容，无法生成交接单。",
                  "This version is incompatible with the current installation. A handoff cannot be requested.",
                )
              }}
            </p>
            <a
              :href="item.release_url"
              target="_blank"
              rel="noopener noreferrer"
              >{{ tr("查看官方 Release", "View official release")
              }}<ArrowUpRight :size="14"
            /></a>
            <details class="updates-notes">
              <summary>{{ tr("更新说明", "Release notes") }}</summary>
              <pre>{{
                item.notes ||
                tr("该发布未提供说明。", "No release notes were provided.")
              }}</pre>
            </details>
            <div v-if="item.preconditions.length" class="updates-preconditions">
              <h4>{{ tr("主机安装前检查", "Host prerequisites") }}</h4>
              <ul>
                <li v-for="condition in item.preconditions" :key="condition">
                  {{ preconditionText(condition) }}
                </li>
              </ul>
            </div>
            <button
              class="button secondary"
              type="button"
              data-action="select"
              :disabled="!canSelect(item)"
              @click="select(item)"
            >
              {{ tr("选择此更新", "Select this update") }}
            </button>
          </section>
        </div>
        <form
          v-if="candidate && !handoff"
          class="panel updates-card updates-confirmation"
          aria-labelledby="handoff-title"
          @submit.prevent="requestHandoff"
        >
          <h3 id="handoff-title">
            {{ tr("确认更新交接", "Confirm update handoff") }} ·
            {{ componentName(candidate.component) }} {{ candidate.version }}
          </h3>
          <p>
            {{
              tr(
                "生成交接单会记录审计事件，尚未下载或安装程序。主机运维应先完成真实性核验、备份、维护与回退检查。",
                "Creating a handoff records an audit event. It does not download or install software. The host operator must verify authenticity, backups, maintenance, and rollback readiness first.",
              )
            }}
          </p>
          <label class="updates-acknowledgement"
            ><input
              v-model="acknowledged"
              type="checkbox"
              name="acknowledge_manual_handoff"
              :disabled="busy || blocked"
            />{{
              tr(
                "我确认由授权主机运维执行检查、备份和安装；网页只生成交接单。",
                "I understand that an authorized host operator performs checks, backups, and installation. This page only creates a handoff.",
              )
            }}</label
          >
          <button class="button primary" type="submit" :disabled="!canSubmit">
            <ShieldCheck :size="16" />{{
              submitting
                ? tr("正在生成…", "Creating…")
                : tr("生成更新交接单", "Create update handoff")
            }}
          </button>
        </form>
        <section
          v-if="handoff"
          class="panel updates-card updates-handoff"
          role="status"
          aria-labelledby="handoff-pending-title"
        >
          <h3 id="handoff-pending-title">
            {{
              tr(
                "交接单已生成 · 仅供主机核验",
                "Handoff created · for host verification",
              )
            }}
          </h3>
          <p>
            {{ componentName(handoff.intent.component) }}
            {{ handoff.intent.version }} ·
            {{
              tr(
                "交接单仅表示准备请求；此网页操作未执行安装或升级。主机执行情况请查看独立回执。",
                "The handoff is a preparation request. This page action did not install or upgrade software. Check the separate receipt for host execution.",
              )
            }}
          </p>
          <p>
            {{
              tr(
                "下载 JSON 并交给授权主机管理员，按更新文档核验后，由管理员在主机上明确确认并启动受限执行工具。交接单只是待核验的请求，不能授予网页主机权限。",
                "Download the JSON for an authorized host administrator to verify using the update guide, then explicitly confirm and launch the restricted executor on the host. The proposal grants no host privileges to this page.",
              )
            }}
          </p>
          <p class="settings-help">
            {{ tr("交接有效期至", "Handoff expires at") }}：<time
              :datetime="handoff.intent.expires_at"
              >{{ handoff.intent.expires_at }}</time
            >
          </p>
          <button
            class="button secondary"
            type="button"
            data-action="download"
            @click="downloadHandoff"
          >
            <Download :size="16" />{{
              tr("下载更新交接单", "Download update handoff")
            }}
          </button>
          <details class="updates-notes">
            <summary>{{ tr("审计标识", "Audit reference") }}</summary>
            <pre>{{ handoff.intent.request_id }}</pre>
          </details>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.updates-page {
  display: grid;
  gap: 20px;
}
.updates-intro,
.updates-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.updates-intro h2,
.updates-card h3 {
  margin: 0 0 8px;
}
.updates-intro p,
.updates-card p {
  color: var(--text-secondary, #64748b);
  line-height: 1.65;
  margin: 6px 0 12px;
}
.updates-card {
  padding: 24px;
  min-width: 0;
}
.updates-current,
.updates-candidates {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.updates-version {
  font-size: 27px;
  font-variant-numeric: tabular-nums;
}
.updates-card small {
  color: var(--text-secondary, #64748b);
  line-height: 1.6;
}
.updates-card a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.updates-notes {
  margin: 20px 0;
}
.updates-notes summary {
  cursor: pointer;
  font-weight: 600;
}
.updates-notes pre {
  font-family: inherit;
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 360px;
  overflow-y: auto;
  margin: 14px 0;
}
.updates-preconditions {
  margin: 20px 0;
  font-size: 13px;
}
.updates-preconditions h4 {
  margin: 0 0 10px;
}
.updates-preconditions ul {
  padding-left: 20px;
  line-height: 1.8;
}
.updates-warning {
  color: #b45309 !important;
}
.updates-acknowledgement {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
  line-height: 1.7;
  margin: 20px 0;
}
.updates-acknowledgement input {
  margin-top: 4px;
  flex: none;
}
.updates-source time {
  overflow-wrap: anywhere;
}
@media (max-width: 760px) {
  .updates-current,
  .updates-candidates {
    grid-template-columns: minmax(0, 1fr);
  }
  .updates-intro,
  .updates-heading {
    flex-wrap: wrap;
  }
  .updates-card {
    padding: 20px;
  }
}
</style>

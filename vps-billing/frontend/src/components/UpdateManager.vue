<script setup lang="ts">
import UiLoading from "./UiLoading.vue";

import UiSpinner from "./UiSpinner.vue";

import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ArrowUpRight, Download, RefreshCw, ShieldCheck } from "@lucide/vue";
import OverlayPanel from "./OverlayPanel.vue";
import { useWorkspace } from "../composables/useWorkspace";
import type {
  NativeOperationView,
  UpdateCandidate,
  UpdateStatus,
} from "../types/idc";
import {
  nativeOperation,
  updateStatus,
  validHandoff,
} from "../services/update-contract";
const props = defineProps<{ locale: string; mode: string }>();
const { read, write, generation, session } = useWorkspace();
const emit = defineEmits<{
  busy: [value: boolean];
  uncertain: [value: boolean];
}>();
const t = (zh: string, en: string) => (props.locale === "zh-CN" ? zh : en);
const status = ref<UpdateStatus | null>(null),
  operation = ref<NativeOperationView | null>(null),
  busy = ref(false),
  uncertain = ref(false),
  error = ref(""),
  requestId = ref(""),
  selected = ref<UpdateCandidate | null>(null),
  ack = ref(false),
  handoff = ref<any>(null),
  download = ref("");
const handoffUnknown = ref(false);
let seq = 0,
  expiryTimer: ReturnType<typeof setTimeout> | undefined;
function failure(e: unknown, writing = false) {
  const err = e as { status?: number; requestId?: string; uncertain?: boolean };
  error.value =
    err?.status === 409
      ? t(
          "候选版本已变化，请重新读取后核对。",
          "The release changed. Reload and review it.",
        )
      : t(
          "结果未能确认，请重新读取并核对。",
          "The result is unconfirmed. Reload and review it.",
        );
  requestId.value = /^[a-f0-9]{32}$/.test(err?.requestId || "")
    ? err.requestId!
    : "";
  uncertain.value =
    uncertain.value ||
    (writing &&
      (!!err?.uncertain ||
        !err?.status ||
        err.status >= 500 ||
        err.status === 409));
}
function revoke() {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = undefined;
  if (download.value) URL.revokeObjectURL(download.value);
  download.value = "";
}
async function load() {
  const n = ++seq;
  busy.value = true;
  error.value = "";
  requestId.value = "";
  status.value = null;
  operation.value = null;
  handoff.value = null;
  selected.value = null;
  ack.value = false;
  revoke();
  try {
    const [s, o] = await Promise.all([
      read("/admin/updates"),
      read("/admin/updates/operation"),
    ]);
    if (n !== seq) return;
    if (!updateStatus(s) || !nativeOperation(o)) throw { status: 200 };
    status.value = s;
    operation.value = o;
    uncertain.value = handoffUnknown.value;
  } catch (e) {
    if (n === seq) failure(e);
  } finally {
    if (n === seq) busy.value = false;
  }
}
async function check() {
  if (busy.value || uncertain.value || props.mode !== "api") return;
  const n = ++seq;
  busy.value = true;
  error.value = "";
  requestId.value = "";
  handoff.value = null;
  selected.value = null;
  ack.value = false;
  revoke();
  try {
    const s = await write("/admin/updates/check", {});
    if (n !== seq) return;
    if (!updateStatus(s)) throw { status: 200, uncertain: true };
    status.value = s;
  } catch (e) {
    if (n === seq) failure(e, true);
  } finally {
    if (n === seq) busy.value = false;
  }
}
async function prepare() {
  const c = selected.value,
    current = status.value?.current;
  if (
    !c ||
    !current ||
    !c.compatible ||
    !c.update_available ||
    status.value?.source.status !== "available" ||
    !ack.value ||
    busy.value ||
    uncertain.value ||
    props.mode !== "api"
  )
    return;
  const n = seq;
  busy.value = true;
  error.value = "";
  requestId.value = "";
  handoffUnknown.value = true;
  try {
    const result = await write("/admin/updates/handoff", {
      component: c.component,
      tag: c.tag,
      source_sha: c.source_sha,
      catalog_sha256: c.catalog_sha256,
      release_id: c.release_id,
      acknowledge_manual_handoff: true,
    });
    if (n !== seq) return;
    if (!validHandoff(result, c, current, session.value?.user?.id))
      throw { status: 200, uncertain: true };
    handoff.value = result;
    handoffUnknown.value = false;
    revoke();
    download.value = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    expiryTimer = setTimeout(
      () => {
        revoke();
        handoff.value = null;
        selected.value = null;
        ack.value = false;
        error.value = t(
          "交接已到期，请核对后重新准备。",
          "The handoff expired. Review it before preparing another.",
        );
      },
      Math.min(
        Date.parse((result as any).intent.expires_at) - Date.now(),
        2147483647,
      ),
    );
  } catch (e) {
    if (n === seq) {
      const err = e as { status?: number; uncertain?: boolean };
      if (err?.status && err.status < 500 && !err.uncertain)
        handoffUnknown.value = false;
      failure(e, true);
    }
  } finally {
    if (n === seq) busy.value = false;
  }
}
watch(busy, (value) => emit("busy", value), { immediate: true, flush: "sync" });
watch(uncertain, (value) => emit("uncertain", value), {
  immediate: true,
  flush: "sync",
});
const labels = (value: string, kind: string) =>
  (
    ({
      status: {
        checking: t("核对中", "Checking"),
        prepared: t("等待执行", "Prepared"),
        executing: t("执行中", "Running"),
        succeeded: t("操作完成", "Completed"),
        failed: t("操作失败", "Failed"),
        needs_manual_recovery: t("需要人工恢复", "Manual recovery required"),
        rolled_back: t("已恢复旧版本", "Previous version restored"),
      },
      phase: {
        confirmed: t("已确认", "Confirmed"),
        install_preflight: t("安装检查", "Installation checks"),
        provision: t("准备环境", "Preparing environment"),
        configure: t("配置环境", "Configuring"),
        old_schema_preflight: t("数据检查", "Data checks"),
        maintenance: t("维护模式", "Maintenance"),
        backup: t("备份", "Backup"),
        migrate: t("更新数据", "Updating data"),
        first_admin: t("管理员设置", "Administrator setup"),
        activate: t("切换版本", "Activating release"),
        readiness: t("就绪检查", "Readiness checks"),
        complete: t("已结束", "Complete"),
      },
      plugin: {
        not_installed: t("未安装", "Not installed"),
        disabled: t("已停用", "Disabled"),
        unavailable: t("暂不可用", "Unavailable"),
        approved: t("已批准", "Approved"),
      },
    }) as Record<string, Record<string, string>>
  )[kind]?.[value] || value;
const sourceLabel = computed(() =>
  status.value?.source.status === "available"
    ? t("官方来源可用", "Official source available")
    : status.value?.source.status === "unavailable"
      ? t(
          "检查失败，不代表没有更新",
          "Check failed; update availability unknown",
        )
      : t("尚未检查", "Not checked"),
);
watch(() => [props.mode, generation.value], load, { immediate: true });
onBeforeUnmount(() => {
  seq++;
  revoke();
  emit("busy", false);
  emit("uncertain", false);
});
</script>
<template>
  <div class="updates-manager">
    <header class="update-heading">
      <div>
        <h2>{{ t("版本与更新", "Version & updates") }}</h2>
        <p>
          {{
            t(
              "检查官方版本，准备服务器更新交接。不会直接安装。",
              "Check official releases and prepare a server handoff. Nothing is installed here.",
            )
          }}
        </p>
      </div>
      <button
        class="btn btn-secondary"
        :disabled="busy"
        @click="load"
        :aria-busy="busy"
      >
        <UiSpinner v-if="busy" /><RefreshCw v-else :size="16" />{{
          t("重新读取", "Reload")
        }}
      </button>
    </header>
    <div v-if="error" class="error-box" role="alert">
      {{ error
      }}<small v-if="requestId"
        >{{ t("请求编号", "Request ID") }}: {{ requestId }}</small
      >
    </div>
    <UiLoading
      v-if="busy && !status"
      layout="list"
      :label="t('正在读取…', 'Loading…')"
    />
    <p v-if="handoffUnknown && !busy" class="error-box" role="alert">
      {{
        t(
          "上次交接结果未确认。请先核对操作记录，勿重复生成。",
          "The previous handoff is unconfirmed. Check the activity log before preparing another.",
        )
      }}
    </p>
    <template v-if="status"
      ><dl class="update-facts">
        <div>
          <dt>{{ t("核心版本", "Core version") }}</dt>
          <dd>{{ status.current.core_version }}</dd>
        </div>
        <div>
          <dt>{{ t("邮件插件", "SMTP plugin") }}</dt>
          <dd>
            {{ status.current.smtp_version || "—" }} ·
            {{ labels(status.current.smtp_status, "plugin") }}
          </dd>
        </div>
        <div>
          <dt>{{ t("更新来源", "Source") }}</dt>
          <dd>
            {{ status.source.repository }}
            <p>{{ sourceLabel }}</p>
          </dd>
        </div>
        <div>
          <dt>{{ t("上次检查", "Last checked") }}</dt>
          <dd>{{ status.checked_at || t("尚未检查", "Not checked") }}</dd>
        </div>
      </dl>
      <button
        class="btn btn-admin"
        :disabled="busy || uncertain || mode === 'demo'"
        @click="check"
        :aria-busy="busy"
      >
        <UiSpinner v-if="busy" />{{
          t("检查官方更新", "Check official updates")
        }}
      </button>
      <p class="helper muted">
        {{ t("仅检查官方正式版本。", "Checks official releases only.") }}
      </p>
      <section class="releases">
        <article
          v-for="c in status.items"
          :key="c.component + c.tag"
          class="release"
        >
          <div class="release-top">
            <h3>
              {{
                c.component === "core"
                  ? t("核心系统", "Core")
                  : t("邮件插件", "SMTP")
              }}
              {{ c.tag }}
            </h3>
            <span
              class="badge"
              :class="c.compatible ? 'badge-success' : 'badge-warning'"
              >{{
                c.compatible
                  ? t("兼容", "Compatible")
                  : t("不兼容", "Incompatible")
              }}</span
            >
          </div>
          <p>{{ c.published_at }}</p>
          <p class="notes">{{ c.notes }}</p>
          <ul>
            <li v-for="(p, i) in c.preconditions" :key="i">{{ p }}</li>
          </ul>
          <div class="release-actions">
            <a
              :href="c.release_url"
              class="btn btn-secondary"
              target="_blank"
              rel="noopener noreferrer"
              >{{ t("发布说明", "Release notes")
              }}<ArrowUpRight :size="15" /></a
            ><button
              class="btn btn-admin"
              :disabled="
                busy ||
                uncertain ||
                !c.compatible ||
                !c.update_available ||
                mode === 'demo'
              "
              @click="
                selected = c;
                ack = false;
                handoff = null;
                revoke();
              "
            >
              {{ t("准备主机交接", "Prepare host handoff") }}
            </button>
          </div>
        </article>
        <p v-if="!status.items.length" class="empty-note">
          {{
            status.source.status === "available"
              ? t(
                  "本次检查未返回可展示候选。",
                  "No candidates returned by this check.",
                )
              : t(
                  "暂无可信候选，请先检查官方更新。",
                  "No verified candidates. Check official updates first.",
                )
          }}
        </p>
      </section></template
    >
    <section class="host-receipt">
      <h3>
        <ShieldCheck :size="18" />{{
          t("主机操作回执", "Host operation receipt")
        }}
      </h3>
      <p v-if="!operation || operation.state !== 'available'">
        {{
          t(
            "暂无可用的服务器操作记录。",
            "No server operation record is available.",
          )
        }}
        <span v-if="operation">({{ operation.state }})</span>
      </p>
      <template v-else
        ><dl class="update-facts">
          <div>
            <dt>{{ t("状态", "Status") }}</dt>
            <dd>{{ labels(operation.operation.status, "status") }}</dd>
          </div>
          <div>
            <dt>{{ t("阶段", "Phase") }}</dt>
            <dd>{{ labels(operation.operation.phase, "phase") }}</dd>
          </div>
          <div>
            <dt>{{ t("目标版本", "Target version") }}</dt>
            <dd>{{ operation.operation.target_core_version }}</dd>
          </div>
          <div>
            <dt>{{ t("更新时间", "Updated") }}</dt>
            <dd>{{ operation.operation.updated_at }}</dd>
          </div>
        </dl>
        <p>
          {{
            operation.operation.business_validation_required
              ? t(
                  "操作已记录，仍需核对业务是否正常。",
                  "The operation is recorded. Check that the service works as expected.",
                )
              : t(
                  "显示服务器最近一次操作记录。",
                  "Shows the latest server operation record.",
                )
          }}
        </p></template
      >
    </section>
    <OverlayPanel
      :close-label="t('关闭', 'Close')"
      :open="!!selected"
      :title="t('准备主机操作交接', 'Prepare host handoff')"
      kind="modal"
      :busy="busy"
      @close="
        selected = null;
        revoke();
      "
      ><template v-if="selected"
        ><p>
          {{
            t(
              "生成未签名的交接文件，30分钟内有效。请由服务器操作员校验并执行；此处不会安装或升级。",
              "Creates an unsigned handoff valid for 30 minutes. A server operator must verify and execute it. Nothing is installed here.",
            )
          }}
        </p>
        <p class="handoff-target">
          {{ selected.component }} {{ selected.tag
          }}<small>{{ selected.source_sha }}</small>
        </p>
        <label v-if="!handoff" class="ack"
          ><input
            v-model="ack"
            type="checkbox"
            :disabled="busy || uncertain"
          />{{
            t(
              "我已确认版本，知道下一步需由操作员执行",
              "I reviewed the release and understand an operator must execute it",
            )
          }}</label
        >
        <p v-else role="status">
          {{
            t(
              "交接已生成，等待操作员处理。系统尚未更新。",
              "Handoff ready for the operator. The system has not been updated.",
            )
          }}
        </p></template
      ><template #footer
        ><a
          v-if="download"
          :href="download"
          download="native-update-handoff.json"
          class="btn btn-admin"
          ><Download :size="16" />{{ t("下载交接文件", "Download handoff") }}</a
        ><button
          v-else
          class="btn btn-admin"
          :disabled="!ack || busy || uncertain"
          @click="prepare"
          :aria-busy="busy"
        >
          <UiSpinner v-if="busy" />{{ t("生成交接", "Generate handoff") }}
        </button></template
      ></OverlayPanel
    >
  </div>
</template>
<style scoped>
.updates-manager {
  font-size: 14px;
  line-height: 1.7;
}
.update-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}
.updates-manager h2 {
  font-size: 22px;
  font-weight: 600;
}
.updates-manager h3 {
  font-size: 16px;
  font-weight: 600;
}
.updates-manager p {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 8px 0 16px;
  overflow-wrap: anywhere;
}
.update-facts {
  margin: 20px 0;
}
.update-facts > div {
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr);
  padding: 16px 0;
  gap: 16px;
  border-bottom: 1px solid var(--border-subtle);
}
dt {
  color: var(--text-secondary);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.release {
  padding: 24px 0;
  border-bottom: 1px solid var(--border-subtle);
}
.release-top,
.release-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}
.release .notes {
  white-space: pre-wrap;
  max-height: 280px;
  overflow: auto;
}
.release ul {
  padding-left: 20px;
  font-size: 13px;
}
.release-actions {
  justify-content: flex-start;
  margin-top: 20px;
}
.host-receipt {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--border-subtle);
}
.host-receipt h3 {
  display: flex;
  gap: 10px;
  align-items: center;
}
.error-box small,
.handoff-target small {
  display: block;
  overflow-wrap: anywhere;
  margin-top: 12px;
}
.handoff-target {
  padding: 20px 0;
  border-block: 1px solid var(--border-subtle);
}
.ack {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  min-height: 44px;
  margin-top: 24px;
}
.ack input {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.btn {
  min-height: 44px;
}
@media (max-width: 600px) {
  .update-heading {
    flex-direction: column;
  }
  .update-facts > div {
    grid-template-columns: 95px minmax(0, 1fr);
  }
  .updates-manager h2 {
    font-size: 20px;
  }
  .release-actions > .btn {
    width: 100%;
  }
}
</style>

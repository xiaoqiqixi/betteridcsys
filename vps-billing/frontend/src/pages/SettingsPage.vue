<script setup lang="ts">
import UiLoading from "../components/UiLoading.vue";

import UiSpinner from "../components/UiSpinner.vue";

import UiSelect from "../components/UiSelect.vue";

import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import GeminiEmailEditor from "../components/GeminiEmailEditor.vue";
import GeminiCurrencyEditor from "../components/GeminiCurrencyEditor.vue";
import UpdateManager from "../components/UpdateManager.vue";
import OverlayPanel from "../components/OverlayPanel.vue";
import {
  siteInput,
  currencyInput,
  emailInput,
  settingsResponse,
  matchesSettingsSave,
  smtpRecipient,
} from "../services/settings-input";
import { ApiError } from "../services/api";
import type { CurrencyUpdate, EmailSettingsUpdate } from "../types/idc";
import {
  Check,
  Link2,
  Mail,
  Palette,
  RefreshCw,
  ShieldCheck,
} from "@lucide/vue";
import { useWorkspace } from "../composables/useWorkspace";
const props = defineProps<{ locale: string; mode: string; role: string }>();
const { read, write, generation } = useWorkspace();
const tab = ref("site"),
  saved = ref<any>(null),
  data = ref<any>(null),
  error = ref(""),
  notice = ref(""),
  busy = ref(false),
  uncertain = ref(false),
  dirty = ref(false),
  requestId = ref(""),
  confirmLeave = ref(false);
const t = (zh: string, en: string) => (props.locale === "zh-CN" ? zh : en);
const tabs = computed(() => [
  { id: "site", name: t("站点与品牌", "Site & brand"), icon: Palette },
  { id: "currencies", name: t("运营币种", "Currencies"), icon: ShieldCheck },
  { id: "email", name: t("邮件设置", "Email"), icon: Mail },
  { id: "integrations", name: t("扩展能力", "Integrations"), icon: Link2 },
  { id: "updates", name: t("版本与更新", "Updates"), icon: RefreshCw },
]);
const paths: Record<string, string> = {
  site: "/admin/site-settings",
  currencies: "/admin/currencies",
  email: "/admin/email-settings",
  integrations: "/admin/integrations",
};
const updateBusy = ref(false),
  updateUncertain = ref(false);
const guardBusy = computed(() => busy.value || updateBusy.value);
const guardUncertain = computed(() => uncertain.value || updateUncertain.value);
const childMessage = computed(
  () =>
    error.value +
    (requestId.value
      ? ` · ${t("请求编号", "Request ID")}: ${requestId.value}`
      : ""),
);
let sequence = 0,
  pendingLeave: ((ok: boolean) => void) | null = null;
function failure(e: unknown, writing = false) {
  const err = e as {
    status?: number;
    code?: string;
    requestId?: string;
    uncertain?: boolean;
  };
  error.value =
    e instanceof ApiError
      ? e.message
      : err?.status === 409
        ? t(
            "设置已变化，请重新读取后核对。",
            "Settings changed. Reload and review them.",
          )
        : t(
            "操作未完成，请检查输入或重新读取。",
            "The operation did not complete. Check the fields or reload.",
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
async function load() {
  const n = ++sequence,
    kind = tab.value;
  error.value = "";
  requestId.value = "";
  notice.value = "";
  data.value = null;
  saved.value = null;
  dirty.value = false;
  busy.value = false;
  if (props.role !== "admin") {
    error.value = t("此页面仅限管理员。", "This page is for administrators.");
    return;
  }
  if (kind === "updates") return;
  busy.value = true;
  try {
    const value = await read(paths[kind]);
    if (n !== sequence) return;
    if (!settingsResponse(kind, value))
      throw { status: 200, code: "INVALID_RESPONSE" };
    saved.value = structuredClone(value);
    data.value = value;
    uncertain.value = false;
  } catch (e) {
    if (n === sequence) failure(e);
  } finally {
    if (n === sequence) busy.value = false;
  }
}
async function save(input?: CurrencyUpdate | EmailSettingsUpdate) {
  if (
    guardBusy.value ||
    guardUncertain.value ||
    !data.value ||
    props.role !== "admin"
  )
    return;
  const n = sequence,
    kind = tab.value;
  let body;
  try {
    body =
      kind === "site"
        ? siteInput(data.value)
        : kind === "currencies"
          ? currencyInput(input as CurrencyUpdate, saved.value)
          : kind === "email"
            ? emailInput(input as EmailSettingsUpdate, saved.value)
            : null;
    if (!body) return;
  } catch (e) {
    failure(e);
    return;
  }
  const original = saved.value;
  busy.value = true;
  error.value = "";
  requestId.value = "";
  notice.value = "";
  try {
    const value = await write(paths[kind], body);
    if (n !== sequence) return;
    if (!matchesSettingsSave(kind, value, body, original))
      throw { status: 200, code: "INVALID_RESPONSE", uncertain: true };
    saved.value = structuredClone(value);
    data.value = value;
    dirty.value = false;
    notice.value = t("设置已保存。", "Settings saved.");
  } catch (e) {
    if (n === sequence) failure(e, true);
  } finally {
    if (n === sequence) busy.value = false;
  }
}
async function testEmail(to: string) {
  if (
    guardBusy.value ||
    guardUncertain.value ||
    dirty.value ||
    !data.value?.enabled ||
    !data.value?.plugin_available ||
    !data.value?.destination_allowed ||
    !smtpRecipient(to) ||
    props.role !== "admin"
  )
    return;
  const n = sequence;
  busy.value = true;
  error.value = "";
  requestId.value = "";
  notice.value = "";
  try {
    const result = await write<any>("/admin/email-settings/test", {
      revision: data.value.revision,
      to,
    });
    if (n !== sequence) return;
    if (result?.status !== "accepted")
      throw { status: 200, code: "INVALID_RESPONSE", uncertain: true };
    notice.value = t(
      "测试请求已接受，请检查收件箱。",
      "Test accepted. Check the recipient inbox.",
    );
  } catch (e) {
    if (n === sequence) failure(e, true);
  } finally {
    if (n === sequence) busy.value = false;
  }
}
function askLeave(): Promise<boolean> {
  if (!dirty.value && !guardUncertain.value) return Promise.resolve(true);
  pendingLeave?.(false);
  return new Promise((resolve) => {
    pendingLeave = resolve;
    confirmLeave.value = true;
  });
}
function resolveLeave(ok: boolean) {
  confirmLeave.value = false;
  pendingLeave?.(ok);
  pendingLeave = null;
}
async function selectTab(id: string) {
  if (id === tab.value || guardBusy.value) return;
  if (await askLeave()) tab.value = id;
}
async function reload() {
  if (guardBusy.value) return;
  if (await askLeave()) await load();
}
onBeforeRouteLeave(async () => (guardBusy.value ? false : await askLeave()));
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value || guardUncertain.value || guardBusy.value) {
    e.preventDefault();
    e.returnValue = "";
  }
}
onMounted(() => window.addEventListener("beforeunload", beforeUnload));
watch(
  () =>
    tab.value === "site" && data.value && saved.value
      ? JSON.stringify(data.value) !== JSON.stringify(saved.value)
      : false,
  (value) => {
    if (tab.value === "site") dirty.value = !!value;
  },
);
watch(
  () => [tab.value, props.mode, props.role, generation.value],
  () => {
    sequence++;
    data.value = null;
    saved.value = null;
    dirty.value = false;
    uncertain.value = false;
    updateBusy.value = false;
    updateUncertain.value = false;
    resolveLeave(false);
    load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  sequence++;
  window.removeEventListener("beforeunload", beforeUnload);
  resolveLeave(false);
});
</script>
<template>
  <section class="welcome-heading">
    <div>
      <h1>{{ t("系统设置", "System settings") }}</h1>
      <p>
        {{
          t(
            "站点身份、运营配置与可用能力。",
            "Site identity, operational settings and available capabilities.",
          )
        }}
      </p>
    </div>
  </section>
  <div class="settings-layout">
    <nav
      class="settings-nav"
      :aria-label="t('设置分类', 'Settings categories')"
    >
      <button
        v-for="item in tabs"
        :key="item.id"
        :class="{ 'is-selected': tab === item.id }"
        :disabled="guardBusy"
        @click="selectTab(item.id)"
      >
        <component :is="item.icon" :size="17" />{{ item.name }}
      </button>
    </nav>
    <section class="settings-content">
      <UiLoading
        v-if="busy && !data"
        layout="form"
        :label="t('正在读取设置…', 'Loading settings…')"
      />
      <div
        v-if="error && (!data || !['currencies', 'email'].includes(tab))"
        class="error-box"
        role="alert"
      >
        {{ error
        }}<small v-if="requestId"
          >{{ t("请求编号", "Request ID") }}: {{ requestId }}</small
        ><button class="btn btn-secondary" @click="reload">
          {{ t("重新读取", "Reload") }}
        </button>
      </div>
      <p
        v-if="notice && !['currencies', 'email'].includes(tab)"
        class="save-notice"
        role="status"
      >
        <Check :size="16" />{{ notice }}
      </p>
      <form v-if="data && tab === 'site'" @submit.prevent="save()">
        <header>
          <h2>{{ t("站点与品牌", "Site & brand") }}</h2>
          <p>
            {{
              t(
                "设置名称、标识与默认偏好。",
                "Set the name, identity and defaults.",
              )
            }}
          </p>
        </header>
        <fieldset class="settings-form" :disabled="busy || uncertain">
          <label class="form-group"
            ><span class="form-label">{{ t("站点名称", "Site name") }}</span
            ><input
              v-model="data.site_name"
              class="form-input"
              required
              maxlength="120" /></label
          ><label class="form-group"
            ><span class="form-label">{{ t("公司名称", "Company name") }}</span
            ><input
              v-model="data.company_name"
              class="form-input"
              maxlength="240"
          /></label>
          <div class="grid-2col">
            <label class="form-group"
              ><span class="form-label">{{ t("标识", "Logo") }}</span
              ><UiSelect v-model="data.logo" class="form-select"
                ><option value="star">{{ t("星标", "Star") }}</option>
                <option value="cloud">{{ t("云", "Cloud") }}</option>
                <option value="server">
                  {{ t("服务器", "Server") }}
                </option></UiSelect
              ></label
            ><label class="form-group"
              ><span class="form-label">{{ t("品牌主题", "Brand theme") }}</span
              ><UiSelect v-model="data.theme" class="form-select"
                ><option value="blue">{{ t("蓝色", "Blue") }}</option>
                <option value="teal">{{ t("青色", "Teal") }}</option>
                <option value="violet">
                  {{ t("紫色", "Violet") }}
                </option></UiSelect
              ></label
            >
          </div>
          <label class="form-group"
            ><span class="form-label">{{ t("支持邮箱", "Support email") }}</span
            ><input
              v-model="data.support_email"
              class="form-input"
              type="email" /></label
          ><label class="form-group"
            ><span class="form-label">{{
              t("支持链接（HTTPS）", "Support link (HTTPS)")
            }}</span
            ><input
              v-model="data.support_url"
              class="form-input"
              type="url"
              pattern="https://.*" /></label
          ><label class="form-group"
            ><span class="form-label">{{
              t("展示来源（HTTPS）", "Display origin (HTTPS)")
            }}</span
            ><input
              v-model="data.display_url"
              class="form-input"
              type="url"
              pattern="https://.*"
          /></label>
          <div class="grid-2col">
            <label class="form-group"
              ><span class="form-label">{{
                t("默认语言", "Default language")
              }}</span
              ><UiSelect v-model="data.default_locale" class="form-select"
                ><option value="zh-CN">简体中文</option>
                <option value="en">English</option></UiSelect
              ></label
            ><label class="form-group"
              ><span class="form-label">{{
                t("默认币种", "Default currency")
              }}</span
              ><input
                v-model="data.default_currency"
                class="form-input"
                pattern="[A-Z]{3}"
                maxlength="3"
                required
            /></label>
          </div>
          <label class="form-group"
            ><span class="form-label">{{
              t("账单抬头", "Invoice issuer")
            }}</span
            ><input
              v-model="data.invoice_issuer"
              class="form-input"
              required /></label
          ><label class="form-group"
            ><span class="form-label">{{
              t("账单地址", "Invoice address")
            }}</span
            ><textarea
              v-model="data.invoice_address"
              class="form-textarea"
            /></label
          ><label class="form-group"
            ><span class="form-label">{{
              t("邮件署名", "Email signature")
            }}</span
            ><textarea v-model="data.email_signature" class="form-textarea" />
          </label>
          <p class="helper muted">
            {{
              t(
                "修改不会改变已开具账单的抬头和金额。",
                "Changes do not alter existing invoice identities or amounts.",
              )
            }}
          </p>
          <button
            class="btn btn-admin"
            :disabled="busy || uncertain"
            type="submit"
            :aria-busy="busy"
          >
            <UiSpinner v-if="busy" />{{
              busy ? t("正在保存…", "Saving…") : t("保存设置", "Save settings")
            }}
          </button>
        </fieldset>
      </form>
      <GeminiCurrencyEditor
        v-else-if="data && tab === 'currencies'"
        :key="tab + data.revision"
        :locale="locale"
        :registry="data"
        :busy="busy"
        :uncertain="uncertain"
        :error="childMessage"
        :notice="notice"
        @save="save"
        @reload="reload"
        @dirty="dirty = $event"
      />
      <GeminiEmailEditor
        v-else-if="data && tab === 'email'"
        :key="tab + data.revision"
        :locale="locale"
        :settings="data"
        :busy="busy"
        :uncertain="uncertain"
        :error="childMessage"
        :notice="notice"
        @save="save"
        @test="testEmail"
        @reload="reload"
        @dirty="dirty = $event"
      />
      <div v-else-if="data && tab === 'integrations'">
        <header>
          <h2>{{ t("扩展能力", "Integrations") }}</h2>
          <p>
            {{
              t(
                "查看当前可用的支付与邮件服务。",
                "Review the available payment and email services.",
              )
            }}
          </p>
        </header>
        <div v-if="!data.items?.length" class="empty-state">
          <Link2 :size="25" />
          <h3>{{ t("尚无可用扩展", "No integrations available") }}</h3>
          <p>
            {{
              t(
                "请在服务器完成安装与审批后重新读取。",
                "Install and approve services on the server, then reload.",
              )
            }}
          </p>
        </div>
        <article v-for="i in data.items" :key="i.id" class="setting-row">
          <div>
            <strong>{{ i.name }}</strong>
            <p>{{ i.description }}</p>
            <p>{{ i.capabilities?.join(", ") }}</p>
          </div>
          <span class="badge badge-neutral">{{ i.status }}</span>
        </article>
      </div>
      <UpdateManager
        v-else-if="tab === 'updates'"
        :locale="locale"
        :mode="mode"
        @busy="updateBusy = $event"
        @uncertain="updateUncertain = $event"
      />
      <div v-if="dirty && tab === 'site'" class="helper muted setting-note">
        {{
          t(
            "有未保存的修改。离开前请保存或放弃。",
            "You have unsaved changes. Save or discard before leaving.",
          )
        }}
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="busy"
          @click="reload"
        >
          {{ t("放弃修改并重读", "Discard and reload") }}
        </button>
      </div>
    </section>
  </div>
  <OverlayPanel
    :open="confirmLeave"
    :title="t('放弃当前修改？', 'Discard current changes?')"
    kind="modal"
    @close="resolveLeave(false)"
    ><p>
      {{
        t(
          "未保存的输入会丢失。若上次操作结果未确认，请先核对；不会自动重做。",
          "Unsaved input will be lost. Check any unconfirmed operation first; nothing is retried automatically.",
        )
      }}
    </p>
    <template #footer
      ><button class="btn btn-secondary" @click="resolveLeave(false)">
        {{ t("继续编辑", "Keep editing") }}</button
      ><button class="btn btn-admin" @click="resolveLeave(true)">
        {{ t("放弃并继续", "Discard and continue") }}
      </button></template
    ></OverlayPanel
  >
</template>
<style scoped>
.settings-layout {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 32px;
  margin-top: 30px;
}
.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.settings-nav button {
  display: flex;
  gap: 10px;
  align-items: center;
  text-align: left;
  padding: 12px 14px;
  background: transparent;
  border: 0;
  border-radius: 9px;
  color: var(--text-secondary);
  cursor: pointer;
  min-height: 46px;
  font-size: 13px;
}
.settings-nav .is-selected {
  color: var(--accent-admin);
  background: var(--status-warning-bg);
}
.settings-content {
  padding: 28px;
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  background: var(--bg-surface);
  min-width: 0;
}
.settings-content h2 {
  font-size: 21px;
  font-weight: 550;
  margin-bottom: 8px;
}
.settings-content header > p {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.8;
}
.settings-form {
  border: 0;
  padding: 0;
  min-width: 0;
  display: grid;
  gap: 22px;
  max-width: 640px;
  margin-top: 30px;
}
.settings-form > .btn {
  justify-self: start;
}
.setting-row {
  padding: 22px 0;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  gap: 20px;
  justify-content: space-between;
  align-items: center;
}
.setting-row strong {
  font-size: 14px;
  font-weight: 550;
}
.setting-row p {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.8;
}
.setting-note {
  margin-top: 24px;
}
.settings-facts {
  margin-top: 22px;
}
.settings-facts > div {
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr);
  gap: 20px;
  padding: 18px 0;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 13px;
}
.settings-facts dt {
  color: var(--text-secondary);
}
.settings-facts dd {
  overflow-wrap: anywhere;
}
.save-notice {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--accent-primary);
  margin-bottom: 20px;
}
@media (max-width: 800px) {
  .settings-layout {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .settings-nav {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .settings-nav button {
    font-size: 12px;
  }
  .settings-content {
    padding: 22px;
  }
  .settings-facts > div {
    grid-template-columns: 90px minmax(0, 1fr);
    gap: 12px;
  }
}
</style>

<script setup lang="ts">
import UiSpinner from "./UiSpinner.vue";

import UiSelect from "./UiSelect.vue";

import { ref, computed, watch, onBeforeUnmount, shallowRef } from "vue";
import {
  emailInput,
  emailSettings,
  smtpRecipient,
} from "../services/settings-input";
import {
  Save,
  RotateCcw,
  Send,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Lock,
  Mail,
} from "@lucide/vue";

export type TlsMode = "starttls" | "implicit_tls";
export type PluginStatus =
  "not_installed" | "disabled" | "unavailable" | "approved";

export interface EmailSettings {
  revision: number;
  enabled: boolean;
  host: string;
  port: number;
  tls_mode: TlsMode;
  from_address: string;
  from_name: string;
  username_configured: boolean;
  password_configured: boolean;
  key_configured: boolean;
  plugin_available: boolean;
  destination_allowed: boolean;
  plugin_status: PluginStatus;
  plugin_version: string;
  updated_at: string;
}

export interface SaveEmailPayload {
  revision: number;
  enabled: boolean;
  host: string;
  port: number;
  tls_mode: TlsMode;
  from_address: string;
  from_name: string;
  username?: string;
  password?: string;
  clear_username?: boolean;
  clear_password?: boolean;
}

const props = defineProps<{
  locale: string;
  settings: EmailSettings;
  busy: boolean;
  uncertain: boolean;
  error: string;
  notice: string;
}>();

const emit = defineEmits<{
  (e: "save", payload: SaveEmailPayload): void;
  (e: "test", to: string): void;
  (e: "reload"): void;
  (e: "dirty", isDirty: boolean): void;
}>();

const enc = new TextEncoder();
const bLen = (s: string) => enc.encode(s || "").length;
function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
const settingsValid = computed(
  () =>
    emailSettings(props.settings) &&
    [
      props.settings.host,
      props.settings.from_address,
      props.settings.from_name,
      props.settings.plugin_version,
    ].every(wellFormed),
);
const safeSettings = computed(() =>
  settingsValid.value ? props.settings : null,
);

const isEn = computed(
  () => props.locale === "en" || props.locale.startsWith("en"),
);

const t = computed(() =>
  isEn.value
    ? {
        title: "Email service",
        versionLabel: "Configuration version",
        unknown: "Not confirmed",
        allowed: "Approved",
        pluginMissing: "Not installed",
        pluginDisabled: "Disabled",
        pluginUnavailable: "Unavailable",
        pluginApproved: "Approved",
        errRead:
          "Email settings could not be confirmed. Refresh before making changes.",
        errConfig:
          "Check the server, sender and credentials. A new server needs both new credentials, or disable email and clear both.",
        sub: "Save your email settings here. Send a separate test below when you are ready.",
        rev: (n: number) => `Configuration version ${n}`,
        reload: "Reload",
        discard: "Discard",
        save: "Save Settings",
        saving: "Saving...",
        uncertainTitle: "Result not yet confirmed",
        uncertainDesc:
          "Refresh and check the saved settings before trying again. If a test was sent, check the inbox first.",
        conflictTitle:
          "Settings changed while you were editing. Your changes are still here.",
        conflictLoad: "Discard & Load Latest",
        statusKey: "Credential protection",
        statusPlugin: "Delivery Plugin",
        statusDest: "Server approval",
        ready: "Ready",
        missing: "Not Configured",
        blocked: "Restricted",
        enabled: "Enable Email Delivery",
        host: "SMTP Host",
        port: "Port (1-65535)",
        tls: "TLS Mode",
        starttls: "STARTTLS",
        implicit: "Implicit TLS",
        fromAddr: "Sender email",
        fromName: "From Name",
        credsTitle: "SMTP Credentials",
        userLabel: "Username",
        passLabel: "Password",
        configured: "Configured (leave blank to keep)",
        notConfigured: "Not set",
        clearBoth: "Clear stored username & password (requires disabling)",
        testTitle: "Send one test email",
        testNote:
          "Sends once using the saved settings. An accepted request is not proof of delivery; check the recipient inbox.",
        testTo: "Recipient Email",
        testBtn: "Send Test",
        dirtyTestHint: "Save or discard unsaved changes before testing.",
        errKey: "Encryption key required to enable.",
        errHost: "Valid ASCII host (1-253 bytes) required.",
        errPort: "Port must be an integer 1-65535.",
        errFrom: "Valid single ASCII email (max 254 bytes) required.",
        errName: "From name max 120 UTF-8 bytes without line breaks.",
        errUser: "Username max 254 UTF-8 bytes.",
        errPass: "Password max 1024 UTF-8 bytes.",
        errClearEnable: "Disable email before clearing credentials.",
        errEndpointCreds:
          "Changing host/port/TLS with stored credentials requires replacing both or disabling & clearing both.",
        errEnableCreds: "Both username and password are required when enabled.",
      }
    : {
        title: "邮件服务",
        versionLabel: "配置版本",
        unknown: "未确认",
        allowed: "已允许",
        pluginMissing: "未安装",
        pluginDisabled: "已停用",
        pluginUnavailable: "暂不可用",
        pluginApproved: "已批准",
        errRead: "暂时无法确认邮件设置，请刷新后再操作。",
        errConfig:
          "请检查服务器、发件邮箱和凭据。更换服务器时，需填写新的用户名和密码，或停用并清除两项。",
        sub: "保存设置不会发送邮件。准备好后，可在下方单独测试。",
        rev: (n: number) => `配置版本 ${n}`,
        reload: "刷新设置",
        discard: "放弃修改",
        save: "保存修改",
        saving: "保存中…",
        uncertainTitle: "操作结果待确认",
        uncertainDesc:
          "请先刷新并核对设置，再决定下一步。如果刚发送过测试邮件，请先检查收件箱，勿重复发送。",
        conflictTitle: "设置已更新，你的未保存修改仍然保留。",
        conflictLoad: "放弃修改并刷新",
        statusKey: "凭据保护",
        statusPlugin: "邮件扩展",
        statusDest: "服务器授权",
        ready: "已就绪",
        missing: "未配置",
        blocked: "受限",
        enabled: "启用邮件发送",
        host: "SMTP 服务器",
        port: "端口 (1-65535)",
        tls: "连接加密",
        starttls: "STARTTLS",
        implicit: "隐式 TLS",
        fromAddr: "发件邮箱",
        fromName: "发件人名称",
        credsTitle: "登录凭据",
        userLabel: "用户名",
        passLabel: "密码",
        configured: "已配置（留空则保留原值）",
        notConfigured: "未配置",
        clearBoth: "同时清除已存用户名与密码（需停用发信）",
        testTitle: "发送一封测试邮件",
        testNote:
          "使用已保存的设置发送一次。显示“已受理”后，仍需检查收件箱是否收到邮件。",
        testTo: "测试收件邮箱",
        testBtn: "发送测试",
        dirtyTestHint: "先保存或放弃修改，再测试已保存的设置。",
        errKey: "未配置加密密钥，无法启用发信。",
        errHost: "请填写有效的 SMTP 主机（1-253 字节）。",
        errPort: "端口须为 1-65535 的安全整数。",
        errFrom: "请填写单个有效的 ASCII 发件邮箱（最多 254 字节）。",
        errName: "发件人名称最多 120 UTF-8 字节且不含换行。",
        errUser: "用户名最多 254 UTF-8 字节。",
        errPass: "密码最多 1024 UTF-8 字节。",
        errClearEnable: "清除凭据时必须停用邮件发送。",
        errEndpointCreds:
          "已有凭据下修改主机/端口/TLS，必须同时替换用户名与密码，或停用并同时清除两项。",
        errEnableCreds: "启用发信时必须具备完整的用户名与密码。",
      },
);

const baseRev = ref(NaN);
const baseSettings = shallowRef<EmailSettings | null>(null);
const baseSnap = ref({
  enabled: false,
  host: "",
  port: NaN,
  tls_mode: "" as TlsMode,
  from_address: "",
  from_name: "",
});

const draft = ref({ ...baseSnap.value });
const newUsername = ref("");
const newPassword = ref("");
const clearCreds = ref(false);
const testRecipient = ref("");
const hasConflict = ref(false);
const usernameInput = ref<HTMLInputElement | null>(null),
  passwordInput = ref<HTMLInputElement | null>(null);
let credentialGeneration = 0;
watch(
  [newUsername, newPassword],
  () => {
    credentialGeneration++;
  },
  { flush: "sync" },
);
const publicFields = [
  "enabled",
  "host",
  "port",
  "tls_mode",
  "from_address",
  "from_name",
] as const;
let pendingSave: {
  revision: number;
  public: typeof baseSnap.value;
  usernameConfigured: boolean;
  passwordConfigured: boolean;
  generation: number;
  clear: boolean;
} | null = null;
function samePublic(
  a: typeof baseSnap.value,
  b: typeof baseSnap.value,
): boolean {
  return publicFields.every((key) => Object.is(a[key], b[key]));
}
function clearSecrets() {
  newUsername.value = "";
  newPassword.value = "";
  pendingSave = null;
  if (usernameInput.value) usernameInput.value.value = "";
  if (passwordInput.value) passwordInput.value.value = "";
}
onBeforeUnmount(clearSecrets);
defineExpose({ clearSecrets });

function syncFromSettings(s: EmailSettings) {
  if (
    !emailSettings(s) ||
    ![s.host, s.from_address, s.from_name, s.plugin_version].every(wellFormed)
  )
    return;
  baseRev.value = s.revision;
  baseSettings.value = {
    revision: s.revision,
    enabled: s.enabled,
    host: s.host,
    port: s.port,
    tls_mode: s.tls_mode,
    from_address: s.from_address,
    from_name: s.from_name,
    username_configured: s.username_configured,
    password_configured: s.password_configured,
    key_configured: s.key_configured,
    plugin_available: s.plugin_available,
    destination_allowed: s.destination_allowed,
    plugin_status: s.plugin_status,
    plugin_version: s.plugin_version,
    updated_at: s.updated_at,
  };
  baseSnap.value = {
    enabled: s.enabled,
    host: s.host,
    port: s.port,
    tls_mode: s.tls_mode,
    from_address: s.from_address,
    from_name: s.from_name,
  };
  draft.value = { ...baseSnap.value };
  clearSecrets();
  clearCreds.value = false;
  hasConflict.value = false;
}

const isDirty = computed(() => {
  const d = draft.value;
  const b = baseSnap.value;
  return (
    d.enabled !== b.enabled ||
    d.host !== b.host ||
    !Object.is(d.port, b.port) ||
    d.tls_mode !== b.tls_mode ||
    d.from_address !== b.from_address ||
    d.from_name !== b.from_name ||
    newUsername.value.length > 0 ||
    newPassword.value.length > 0 ||
    clearCreds.value
  );
});

watch(isDirty, (val) => emit("dirty", val), { immediate: true });

watch(
  () => props.settings,
  (next) => {
    if (
      !next ||
      !emailSettings(next) ||
      ![
        next.host,
        next.from_address,
        next.from_name,
        next.plugin_version,
      ].every(wellFormed)
    )
      return;
    const acknowledged =
      pendingSave &&
      !props.uncertain &&
      next.revision === pendingSave.revision + 1 &&
      samePublic(next, pendingSave.public) &&
      samePublic(draft.value, pendingSave.public) &&
      next.username_configured === pendingSave.usernameConfigured &&
      next.password_configured === pendingSave.passwordConfigured &&
      credentialGeneration === pendingSave.generation &&
      clearCreds.value === pendingSave.clear;
    if (!baseSettings.value || !isDirty.value || acknowledged)
      syncFromSettings(next);
    else if (
      next.revision !== baseRev.value ||
      !samePublic(next, baseSnap.value)
    )
      hasConflict.value = true;
  },
  { immediate: true, deep: true },
);

const hasStoredCreds = computed(
  () =>
    baseSettings.value?.username_configured === true ||
    baseSettings.value?.password_configured === true,
);

function cleanInput(): SaveEmailPayload {
  if (!baseSettings.value) throw new Error("INVALID_EMAIL_SETTINGS");
  if (
    ![
      draft.value.host,
      draft.value.from_address,
      draft.value.from_name,
      newUsername.value,
      newPassword.value,
    ].every(wellFormed)
  )
    throw new Error("INVALID_EMAIL_SETTINGS");
  return emailInput(
    {
      revision: baseRev.value,
      ...draft.value,
      username: newUsername.value,
      password: newPassword.value,
      clear_username: clearCreds.value,
      clear_password: clearCreds.value,
    },
    baseSettings.value,
  );
}
const validationErrors = computed<string[]>(() => {
  if (!settingsValid.value || !baseSettings.value) return [t.value.errRead];
  try {
    cleanInput();
    return [];
  } catch {
    return [t.value.errConfig];
  }
});
const canSave = computed(
  () =>
    !props.busy &&
    !props.uncertain &&
    !hasConflict.value &&
    isDirty.value &&
    validationErrors.value.length === 0,
);
const isTestEmailValid = computed(
  () => smtpRecipient(testRecipient.value) && wellFormed(testRecipient.value),
);
const canTest = computed(() => {
  const s = safeSettings.value;
  return (
    !props.busy &&
    !props.uncertain &&
    !hasConflict.value &&
    !isDirty.value &&
    !!s &&
    !!baseSettings.value &&
    s.revision === baseRev.value &&
    samePublic(s, baseSnap.value) &&
    s.enabled &&
    s.key_configured &&
    s.username_configured &&
    s.password_configured &&
    s.plugin_available &&
    s.destination_allowed &&
    s.plugin_status === "approved" &&
    isTestEmailValid.value
  );
});
const pluginLabel = computed(() =>
  safeSettings.value
    ? {
        not_installed: t.value.pluginMissing,
        disabled: t.value.pluginDisabled,
        unavailable: t.value.pluginUnavailable,
        approved: t.value.pluginApproved,
      }[safeSettings.value.plugin_status]
    : t.value.unknown,
);

function onPortInput(ev: Event) {
  const raw = (ev.target as HTMLInputElement).value.trim();
  const n = Number(raw);
  draft.value.port = /^\d+$/.test(raw) && Number.isSafeInteger(n) ? n : NaN;
}

function onClearChange() {
  if (clearCreds.value) {
    draft.value.enabled = false;
    newUsername.value = "";
    newPassword.value = "";
  }
}

function handleSave() {
  if (!canSave.value || !baseSettings.value) return;
  let payload: SaveEmailPayload;
  try {
    payload = cleanInput();
  } catch {
    return;
  }
  pendingSave = {
    revision: baseRev.value,
    public: { ...draft.value },
    generation: credentialGeneration,
    clear: clearCreds.value,
    usernameConfigured:
      !clearCreds.value &&
      (!!payload.username || baseSettings.value.username_configured),
    passwordConfigured:
      !clearCreds.value &&
      (!!payload.password || baseSettings.value.password_configured),
  };
  emit("save", payload);
}

function handleTest() {
  if (!canTest.value) return;
  emit("test", testRecipient.value);
}

function discardAndReload() {
  clearSecrets();
  syncFromSettings(props.settings);
  emit("reload");
}
</script>

<template>
  <section class="gee-root" :aria-busy="busy ? 'true' : 'false'">
    <header class="gee-header">
      <div>
        <div class="gee-title-row">
          <h1 class="gee-title">{{ t.title }}</h1>
          <details>
            <summary class="gee-badge">{{ t.versionLabel }}</summary>
            <span class="gee-badge gee-mono">{{
              Number.isSafeInteger(baseRev) ? t.rev(baseRev) : "—"
            }}</span>
          </details>
        </div>
        <p class="gee-sub">{{ t.sub }}</p>
      </div>

      <div class="gee-actions">
        <button
          type="button"
          class="gee-btn"
          :disabled="busy"
          @click="emit('reload')"
        >
          <RotateCcw :size="15" aria-hidden="true" />
          <span>{{ t.reload }}</span>
        </button>
        <button
          v-if="isDirty"
          type="button"
          class="gee-btn"
          :disabled="busy"
          @click="syncFromSettings(settings)"
        >
          <span>{{ t.discard }}</span>
        </button>
        <button
          type="button"
          class="gee-btn gee-btn-admin"
          :disabled="!canSave"
          :aria-busy="busy"
          @click="handleSave"
        >
          <UiSpinner v-if="busy" :size="15" /><Save
            v-else
            :size="15"
            aria-hidden="true"
          />
          <span>{{ busy ? t.saving : t.save }}</span>
        </button>
      </div>
    </header>

    <!-- Banners -->
    <div v-if="uncertain" class="gee-alert is-warn" role="alert">
      <ShieldAlert :size="18" class="gee-icon" aria-hidden="true" />
      <div class="gee-alert-text">
        <strong>{{ t.uncertainTitle }}</strong>
        <p>{{ t.uncertainDesc }}</p>
      </div>
      <button
        type="button"
        class="gee-btn"
        :disabled="busy"
        @click="emit('reload')"
      >
        {{ t.reload }}
      </button>
    </div>

    <div v-if="hasConflict" class="gee-alert is-warn" role="alert">
      <AlertTriangle :size="18" class="gee-icon" aria-hidden="true" />
      <div class="gee-alert-text">
        <strong>{{ t.conflictTitle }}</strong>
      </div>
      <button
        type="button"
        class="gee-btn"
        :disabled="busy"
        @click="discardAndReload"
      >
        {{ t.conflictLoad }}
      </button>
    </div>

    <div v-if="error" class="gee-alert is-err" role="alert">
      <AlertTriangle :size="18" class="gee-icon" aria-hidden="true" />
      <p class="gee-plain">{{ error }}</p>
    </div>

    <div v-if="notice" class="gee-alert is-ok" role="status">
      <CheckCircle2 :size="18" class="gee-icon" aria-hidden="true" />
      <p class="gee-plain">{{ notice }}</p>
    </div>

    <!-- Read-only Status Strip -->
    <div class="gee-status-strip">
      <div class="gee-status-item">
        <span class="gee-label">{{ t.statusKey }}</span>
        <span
          :class="
            safeSettings?.key_configured === true ? 'is-ready' : 'is-warn'
          "
        >
          {{
            !settingsValid
              ? t.unknown
              : safeSettings?.key_configured === true
                ? t.ready
                : t.missing
          }}
        </span>
      </div>
      <div class="gee-status-item">
        <span class="gee-label">{{ t.statusPlugin }}</span>
        <span class="gee-mono">
          {{ pluginLabel }}
          <template v-if="settingsValid && settings.plugin_version"
            >({{ settings.plugin_version }})</template
          >
        </span>
      </div>
      <div class="gee-status-item">
        <span class="gee-label">{{ t.statusDest }}</span>
        <span
          :class="
            safeSettings?.destination_allowed === true ? 'is-ready' : 'is-warn'
          "
        >
          {{
            !settingsValid
              ? t.unknown
              : safeSettings?.destination_allowed === true
                ? t.allowed
                : t.blocked
          }}
        </span>
      </div>
    </div>

    <!-- SMTP Config Panel -->
    <div class="gee-panel">
      <div class="gee-row-top">
        <label class="gee-switch">
          <input
            v-model="draft.enabled"
            type="checkbox"
            :disabled="busy || clearCreds"
          />
          <span>{{ t.enabled }}</span>
        </label>
      </div>

      <div class="gee-grid">
        <div class="gee-field gee-span-2">
          <label class="gee-label" for="gee-host"
            >{{ t.host }} ({{ bLen(draft.host) }}/253 B)</label
          >
          <input
            id="gee-host"
            v-model="draft.host"
            type="text"
            class="gee-input gee-mono"
            :disabled="busy"
            autocomplete="off"
          />
        </div>

        <div class="gee-field">
          <label class="gee-label" for="gee-port">{{ t.port }}</label>
          <input
            id="gee-port"
            type="number"
            min="1"
            max="65535"
            class="gee-input gee-mono"
            :value="Number.isSafeInteger(draft.port) ? draft.port : ''"
            :disabled="busy"
            @input="onPortInput"
          />
        </div>

        <div class="gee-field">
          <label class="gee-label" for="gee-tls">{{ t.tls }}</label>
          <UiSelect
            id="gee-tls"
            v-model="draft.tls_mode"
            class="gee-input"
            :disabled="busy"
          >
            <option v-if="!draft.tls_mode" value="" disabled>—</option>
            <option value="starttls">{{ t.starttls }}</option>
            <option value="implicit_tls">{{ t.implicit }}</option>
          </UiSelect>
        </div>

        <div class="gee-field gee-span-2">
          <label class="gee-label" for="gee-from">
            {{ t.fromAddr }} ({{ bLen(draft.from_address) }}/254 B)
          </label>
          <input
            id="gee-from"
            v-model="draft.from_address"
            type="email"
            class="gee-input gee-mono"
            :disabled="busy"
            autocomplete="off"
          />
        </div>

        <div class="gee-field gee-span-2">
          <label class="gee-label" for="gee-name">
            {{ t.fromName }} ({{ bLen(draft.from_name) }}/120 B)
          </label>
          <input
            id="gee-name"
            v-model="draft.from_name"
            type="text"
            class="gee-input"
            :disabled="busy"
            autocomplete="off"
          />
        </div>
      </div>

      <!-- Credentials Section -->
      <div class="gee-creds">
        <div class="gee-creds-head">
          <Lock :size="15" aria-hidden="true" />
          <h2 class="gee-sec-title">{{ t.credsTitle }}</h2>
        </div>

        <div class="gee-grid">
          <div class="gee-field gee-span-2">
            <label class="gee-label" for="gee-user">
              {{ t.userLabel }} —
              {{
                settingsValid
                  ? settings.username_configured
                    ? t.configured
                    : t.notConfigured
                  : t.unknown
              }}
              ({{ bLen(newUsername) }}/254 B)
            </label>
            <input
              id="gee-user"
              ref="usernameInput"
              v-model="newUsername"
              type="password"
              class="gee-input gee-mono"
              :disabled="busy || clearCreds"
              autocomplete="new-password"
            />
          </div>

          <div class="gee-field gee-span-2">
            <label class="gee-label" for="gee-pass">
              {{ t.passLabel }} —
              {{
                settingsValid
                  ? settings.password_configured
                    ? t.configured
                    : t.notConfigured
                  : t.unknown
              }}
              ({{ bLen(newPassword) }}/1024 B)
            </label>
            <input
              id="gee-pass"
              ref="passwordInput"
              v-model="newPassword"
              type="password"
              class="gee-input gee-mono"
              :disabled="busy || clearCreds"
              autocomplete="new-password"
            />
          </div>
        </div>

        <label v-if="hasStoredCreds" class="gee-switch gee-clear-toggle">
          <input
            v-model="clearCreds"
            type="checkbox"
            :disabled="busy"
            @change="onClearChange"
          />
          <span>{{ t.clearBoth }}</span>
        </label>
      </div>

      <ul v-if="validationErrors.length > 0" class="gee-err-list" role="alert">
        <li v-for="(err, i) in validationErrors" :key="i">{{ err }}</li>
      </ul>
    </div>

    <!-- Single Test Email Section -->
    <div class="gee-panel">
      <div class="gee-creds-head">
        <Mail :size="15" aria-hidden="true" />
        <h2 class="gee-sec-title">{{ t.testTitle }}</h2>
      </div>
      <p class="gee-sub">{{ t.testNote }}</p>
      <p v-if="isDirty" class="gee-warn-inline">{{ t.dirtyTestHint }}</p>

      <div class="gee-test-row">
        <div class="gee-field gee-test-input">
          <label class="gee-label" for="gee-test-to">{{ t.testTo }}</label>
          <input
            id="gee-test-to"
            v-model="testRecipient"
            type="email"
            class="gee-input gee-mono"
            :disabled="busy || uncertain || isDirty"
            autocomplete="off"
          />
        </div>
        <button
          type="button"
          class="gee-btn"
          :disabled="!canTest"
          :aria-busy="busy"
          @click="handleTest"
        >
          <Send :size="15" aria-hidden="true" />
          <span>{{ t.testBtn }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.gee-root {
  --c-canvas: var(--bg-canvas, #070b14);
  --c-surface: var(--bg-surface, #0d1322);
  --c-elevated: var(--bg-elevated, #131c31);
  --c-text: var(--text-primary, #f1f5f9);
  --c-sec: var(--text-secondary, #94a3b8);
  --c-accent: var(--accent-primary, #00e5be);
  --c-admin: var(--accent-admin, #f59e0b);
  --c-border: var(--border-subtle, rgba(148, 163, 184, 0.14));
  --c-strong: var(--border-strong, rgba(148, 163, 184, 0.28));

  color: var(--c-text);
  font-size: 14px;
  line-height: 1.5;
  max-width: 1120px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-sizing: border-box;
}

.gee-root *,
.gee-root *::before,
.gee-root *::after {
  box-sizing: border-box;
}

.gee-mono {
  font-family: var(
    --font-mono,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Consolas,
    monospace
  );
}

.gee-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}

.gee-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.gee-title {
  font-size: clamp(20px, 2.2vw, 24px);
  font-weight: 600;
  margin: 0;
}

.gee-sec-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}

.gee-badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--status-warning-bg);
  color: var(--status-warning);
}

.gee-sub {
  font-size: 12.5px;
  color: var(--c-sec);
  margin: 4px 0 0;
}

.gee-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.gee-btn {
  min-height: 44px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--c-strong);
  background: var(--c-surface);
  color: var(--c-text);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}

.gee-btn-admin {
  background: var(--action-admin-bg);
  border-color: transparent;
  color: var(--action-admin-text);
}

.gee-btn-admin:hover:not(:disabled) {
  background: var(--action-admin-hover);
}

.gee-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.gee-alert {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
}

.gee-alert.is-warn {
  border-color: var(--status-warning-border);
  background: var(--status-warning-bg);
}

.gee-alert.is-err {
  border-color: var(--status-danger-border);
  background: var(--status-danger-bg);
}

.gee-alert.is-ok {
  border-color: var(--status-success-border);
  background: var(--status-success-bg);
}

.gee-alert-text {
  flex: 1 1 220px;
}

.gee-alert-text p,
.gee-plain {
  margin: 0;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.gee-status-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  padding: 12px 16px;
  gap: 12px;
}

.gee-status-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.gee-status-item .is-ready {
  color: var(--status-success);
  font-weight: 600;
}

.gee-status-item .is-warn {
  color: var(--status-warning);
  font-weight: 600;
}

.gee-panel {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.gee-row-top {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--c-border);
}

.gee-switch {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-weight: 500;
}

.gee-switch input {
  width: 16px;
  height: 16px;
  accent-color: var(--c-accent);
}

.gee-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.gee-span-2 {
  grid-column: span 2;
}

.gee-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.gee-label {
  font-size: 12px;
  color: var(--c-sec);
  font-weight: 500;
}

.gee-input {
  min-height: 44px;
  width: 100%;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border-control);
  background: var(--c-canvas);
  color: var(--c-text);
  font-size: 14px;
}

.gee-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.gee-creds {
  padding-top: 14px;
  border-top: 1px solid var(--c-border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.gee-creds-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.gee-err-list {
  margin: 0;
  padding-left: 18px;
  color: var(--status-danger);
  font-size: 12.5px;
}

.gee-warn-inline {
  margin: 0;
  font-size: 12.5px;
  color: var(--status-warning);
}

.gee-test-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.gee-test-input {
  flex: 1 1 240px;
}

.gee-btn:focus-visible,
.gee-input:focus-visible,
.gee-switch input:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: 2px;
}

@media (max-width: 680px) {
  .gee-status-strip,
  .gee-grid {
    grid-template-columns: 1fr;
  }
  .gee-span-2 {
    grid-column: span 1;
  }
  .gee-actions,
  .gee-test-row .gee-btn {
    width: 100%;
  }
  .gee-actions .gee-btn {
    flex: 1 1 calc(50% - 4px);
  }
}
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { LockKeyhole, Mail, RefreshCw, Save, Send } from "@lucide/vue";
import { api, ApiError } from "../lib/api";
import { tr } from "../lib/i18n";
import {
  defaultEmailSettings,
  emailDraft,
  readEmailSettings,
  validEmailAddress,
  type EmailSettings,
} from "../lib/email-settings";

const props = defineProps<{ preview: boolean; refreshToken: number }>();
const emit = defineEmits<{ saved: [settings: EmailSettings] }>();
const baseline = ref<EmailSettings>();
const form = ref(emailDraft(defaultEmailSettings));
const username = ref(""),
  password = ref(""),
  clearUsername = ref(false),
  clearPassword = ref(false);
const recipient = ref("");
const loading = ref(false),
  saving = ref(false),
  sending = ref(false),
  saved = ref(false),
  blocked = ref(false),
  sendBlocked = ref(false);
const refreshNotice = ref(false);
type Failure =
  | ""
  | "load"
  | "invalid"
  | "credentials"
  | "endpoint"
  | "conflict"
  | "session"
  | "key"
  | "save_uncertain";
type Delivery =
  | ""
  | "accepted"
  | "recipient"
  | "disabled"
  | "unavailable"
  | "uncertain"
  | "rate";
const error = ref<Failure>("");
const delivery = ref<Delivery>("");
let generation = 0;
const busy = computed(() => loading.value || saving.value || sending.value);
const dirty = computed(
  () =>
    baseline.value !== undefined &&
    (JSON.stringify(form.value) !==
      JSON.stringify(emailDraft(baseline.value)) ||
      !!username.value ||
      !!password.value ||
      clearUsername.value ||
      clearPassword.value),
);
const endpointChanged = computed(
  () =>
    baseline.value !== undefined &&
    (form.value.host !== baseline.value.host ||
      form.value.port !== baseline.value.port ||
      form.value.tls_mode !== baseline.value.tls_mode),
);
const credentialsNeedReplacement = computed(
  () =>
    endpointChanged.value &&
    (baseline.value?.username_configured ||
      baseline.value?.password_configured),
);
const canTest = computed(
  () =>
    !props.preview &&
    !busy.value &&
    !dirty.value &&
    !blocked.value &&
    !sendBlocked.value &&
    !!baseline.value?.enabled &&
    baseline.value.key_configured &&
    baseline.value.username_configured &&
    baseline.value.password_configured,
);
const errorText = computed(
  () =>
    ({
      "": "",
      load: tr(
        "无法读取 SMTP 设置，请确认管理员会话后重试。",
        "Could not load SMTP settings. Check your administrator session and retry.",
      ),
      invalid: tr(
        "请检查服务器、端口、发件地址及字段长度。保存未完成。",
        "Check the server, port, sender address and field lengths. Settings were not saved.",
      ),
      credentials: tr(
        "账号和密码必须成对配置或同时清除。启用 SMTP 还需要服务器和发件地址；清除凭据前请先关闭启用开关。",
        "Configure or clear both account and password together. Enabling SMTP also requires a server and sender address; turn it off before clearing credentials.",
      ),
      endpoint: tr(
        "服务器地址、端口或 TLS 模式已变更。请同时重新输入账号和密码，或禁用 SMTP 并明确清除两项凭据。",
        "The server, port or TLS mode changed. Enter both account and password again, or disable SMTP and explicitly clear both credentials.",
      ),
      conflict: tr(
        "配置已被其他管理员修改。非敏感草稿仍保留；请记录需要保留的修改，然后重新读取。",
        "Another administrator changed this configuration. Your non-secret draft is retained. Keep any changes you need, then reload.",
      ),
      session: tr(
        "管理员会话或操作验证已失效，请重新登录后读取配置。",
        "Your administrator session or request verification expired. Sign in again, then reload.",
      ),
      key: tr(
        "服务端无法加密或解密凭据。请核对服务器密钥配置；如需更换凭据，请重新读取后同时填写账号和密码。",
        "The server could not encrypt or decrypt the credentials. Check its encryption key configuration. To replace credentials, reload and enter both account and password.",
      ),
      save_uncertain: tr(
        "无法确认保存结果，请先重新读取核对。输入的账号和密码已清空，不会自动重试。",
        "The save result is unknown. Reload to check the saved configuration. Entered credentials were cleared; this request will not be retried automatically.",
      ),
    })[error.value],
);
const deliveryText = computed(
  () =>
    ({
      "": "",
      accepted: tr(
        "SMTP 服务器已接受测试邮件。请检查收件箱及垃圾邮件；这不保证最终送达。",
        "The SMTP server accepted the test message. Check the inbox and spam folder; final delivery is not guaranteed.",
      ),
      recipient: tr(
        "请填写一个有效的收件邮箱。",
        "Enter a valid recipient email address.",
      ),
      disabled: tr(
        "已保存的 SMTP 配置未启用。请重新读取并检查配置。",
        "The saved SMTP configuration is disabled. Reload and check it.",
      ),
      unavailable: tr(
        "测试邮件未被服务器接受。请核对配置、TLS 证书和服务状态后手动重试。",
        "The test message was not accepted. Check the configuration, TLS certificate and service status before trying again.",
      ),
      uncertain: tr(
        "无法确认邮件是否已被接受。请先核对收件箱和服务端投递记录，再决定是否重发；再次发送可能产生重复邮件。",
        "It is unknown whether the message was accepted. Check the inbox and server delivery records before deciding to send again; another attempt may deliver a duplicate.",
      ),
      rate: tr(
        "测试发送过于频繁，请稍后再试。不会自动重试。",
        "Too many test sends. Try again later; no automatic retry will occur.",
      ),
    })[delivery.value],
);

function clearTypedCredentials() {
  username.value = "";
  password.value = "";
}
function resetActions() {
  clearTypedCredentials();
  clearUsername.value = false;
  clearPassword.value = false;
}
async function load() {
  if (saving.value || sending.value) return;
  const current = ++generation;
  loading.value = true;
  baseline.value = undefined;
  form.value = emailDraft(defaultEmailSettings);
  resetActions();
  error.value = "";
  delivery.value = "";
  saved.value = false;
  blocked.value = false;
  sendBlocked.value = false;
  refreshNotice.value = false;
  try {
    const settings = props.preview
      ? { ...defaultEmailSettings }
      : readEmailSettings(await api<unknown>("/admin/email-settings"));
    if (current !== generation) return;
    baseline.value = settings;
    form.value = emailDraft(settings);
  } catch {
    if (current === generation) error.value = "load";
  } finally {
    if (current === generation) loading.value = false;
  }
}
function validate(): Failure {
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  if (
    !Number.isInteger(form.value.port) ||
    form.value.port < 1 ||
    form.value.port > 65535 ||
    bytes(form.value.host) > 253 ||
    bytes(form.value.from_name) > 120 ||
    bytes(username.value) > 254 ||
    bytes(password.value) > 1024 ||
    /[\u0000-\u001f\u007f]/.test(
      form.value.host + form.value.from_name + username.value,
    ) ||
    (form.value.from_address !== "" &&
      !validEmailAddress(form.value.from_address))
  )
    return "invalid";
  if (
    credentialsNeedReplacement.value &&
    !(
      (username.value &&
        password.value &&
        !clearUsername.value &&
        !clearPassword.value) ||
      (!form.value.enabled && clearUsername.value && clearPassword.value)
    )
  )
    return "endpoint";
  const hasUsername =
    !!username.value ||
    (!!baseline.value?.username_configured && !clearUsername.value);
  const hasPassword =
    !!password.value ||
    (!!baseline.value?.password_configured && !clearPassword.value);
  if (hasUsername !== hasPassword) return "credentials";
  if (
    form.value.enabled &&
    (!form.value.host ||
      !validEmailAddress(form.value.from_address) ||
      !hasUsername ||
      !hasPassword)
  )
    return "credentials";
  return "";
}
function codeOf(failure: unknown) {
  return failure instanceof ApiError ? failure.code.toUpperCase() : "";
}
function settingsFailure(code: string): Failure {
  if (["SETTINGS_CONFLICT", "REVISION_CONFLICT"].includes(code))
    return "conflict";
  if (
    [
      "AUTH_REQUIRED",
      "FORBIDDEN",
      "CSRF_INVALID",
      "CSRF_REQUIRED",
      "CSRF_FAILED",
      "ORIGIN_INVALID",
    ].includes(code)
  )
    return "session";
  if (code === "SMTP_KEY_UNAVAILABLE") return "key";
  if (
    ["INVALID_EMAIL_SETTINGS", "VALIDATION", "VALIDATION_FAILED"].includes(code)
  )
    return "invalid";
  return "save_uncertain";
}
async function save() {
  if (
    props.preview ||
    busy.value ||
    blocked.value ||
    !dirty.value ||
    !baseline.value
  )
    return;
  saved.value = false;
  delivery.value = "";
  error.value = validate();
  if (error.value) return;
  const current = generation;
  const body = {
    ...form.value,
    revision: baseline.value.revision,
    ...(username.value ? { username: username.value } : {}),
    ...(password.value ? { password: password.value } : {}),
    ...(clearUsername.value ? { clear_username: true } : {}),
    ...(clearPassword.value ? { clear_password: true } : {}),
  };
  saving.value = true;
  try {
    const settings = readEmailSettings(
      await api<unknown>("/admin/email-settings", "POST", body),
    );
    if (current !== generation || props.preview) return;
    baseline.value = settings;
    form.value = emailDraft(settings);
    resetActions();
    saved.value = true;
    sendBlocked.value = false;
    refreshNotice.value = false;
    emit("saved", settings);
  } catch (failure) {
    if (current !== generation) return;
    error.value = settingsFailure(codeOf(failure));
    blocked.value = !["invalid", "credentials", "endpoint"].includes(
      error.value,
    );
  } finally {
    if (current === generation) {
      clearTypedCredentials();
      saving.value = false;
    }
  }
}
async function sendTest() {
  if (!canTest.value || !baseline.value) return;
  delivery.value = "";
  if (!validEmailAddress(recipient.value)) {
    delivery.value = "recipient";
    return;
  }
  const current = generation;
  sending.value = true;
  try {
    const result = await api<unknown>("/admin/email-settings/test", "POST", {
      revision: baseline.value.revision,
      to: recipient.value,
    });
    if (current !== generation || props.preview) return;
    if (
      !result ||
      typeof result !== "object" ||
      !("status" in result) ||
      result.status !== "accepted"
    )
      throw new ApiError("INVALID_RESPONSE", "Invalid test response");
    delivery.value = "accepted";
  } catch (failure) {
    if (current !== generation) return;
    const code = codeOf(failure);
    if (
      [
        "SETTINGS_CONFLICT",
        "REVISION_CONFLICT",
        "AUTH_REQUIRED",
        "FORBIDDEN",
        "CSRF_INVALID",
        "CSRF_REQUIRED",
        "CSRF_FAILED",
        "ORIGIN_INVALID",
        "SMTP_KEY_UNAVAILABLE",
      ].includes(code)
    ) {
      error.value = settingsFailure(code);
      blocked.value = true;
    } else if (code === "SMTP_DISABLED") {
      delivery.value = "disabled";
      sendBlocked.value = true;
    } else if (code === "RATE_LIMITED") delivery.value = "rate";
    else if (
      ["INVALID_EMAIL_SETTINGS", "VALIDATION", "VALIDATION_FAILED"].includes(
        code,
      )
    )
      delivery.value = "recipient";
    else if (code === "SMTP_UNAVAILABLE") delivery.value = "unavailable";
    else {
      delivery.value = "uncertain";
      sendBlocked.value = true;
    }
  } finally {
    if (current === generation) sending.value = false;
  }
}
watch(clearUsername, (value) => {
  if (value) username.value = "";
});
watch(clearPassword, (value) => {
  if (value) password.value = "";
});
watch(
  () => props.preview,
  () => {
    generation++;
    saving.value = false;
    sending.value = false;
    recipient.value = "";
    void load();
  },
  { immediate: true },
);
watch(
  () => props.refreshToken,
  () => {
    if (busy.value || dirty.value) refreshNotice.value = true;
    else void load();
  },
);
onBeforeUnmount(() => {
  generation++;
  resetActions();
  recipient.value = "";
});
</script>

<template>
  <section
    class="panel smtp-settings"
    aria-labelledby="smtp-heading"
    :aria-busy="busy"
  >
    <div class="smtp-heading">
      <div>
        <p class="eyebrow">{{ tr("官方邮件插件", "OFFICIAL EMAIL PLUGIN") }}</p>
        <h3 id="smtp-heading" tabindex="-1"><Mail :size="20" />SMTP</h3>
      </div>
      <span class="badge" :class="baseline?.enabled ? 'green' : 'gray'">{{
        baseline?.enabled
          ? tr("已保存：启用", "Saved: enabled")
          : tr("已保存：禁用", "Saved: disabled")
      }}</span>
    </div>
    <p class="settings-help">
      {{
        tr(
          "连接你管理的 SMTP 服务。仅支持验证证书的 STARTTLS 或隐式 TLS；不提供明文或跳过验证选项。",
          "Connect your SMTP service using verified STARTTLS or implicit TLS. Plaintext and skipped certificate verification are unavailable.",
        )
      }}
    </p>
    <p v-if="preview" class="settings-notice">
      {{
        tr(
          "样例预览：不读取、保存配置，也不发送邮件。",
          "Preview only: configuration is not read or saved, and no email is sent.",
        )
      }}
    </p>
    <p v-if="loading" role="status" class="settings-loading">
      <RefreshCw :size="18" class="spin" />{{
        tr("正在读取 SMTP 设置…", "Loading SMTP settings…")
      }}
    </p>
    <div v-if="error" role="alert" class="settings-notice">
      <p>{{ errorText }}</p>
    </div>
    <p v-if="saved && !dirty" class="settings-success" role="status">
      {{
        tr(
          "SMTP 配置已保存。账号和密码不会回显。",
          "SMTP configuration saved. Account and password are never returned.",
        )
      }}
    </p>
    <p v-if="refreshNotice" class="settings-notice">
      {{
        tr(
          "刷新时保留了未提交的修改。重新读取会丢弃这份草稿。",
          "Your pending changes were kept during refresh. Reloading will discard this draft.",
        )
      }}
    </p>
    <template v-if="baseline">
      <p v-if="!baseline.key_configured && !preview" class="settings-notice">
        <LockKeyhole :size="16" />{{
          tr(
            "服务器尚未配置凭据加密密钥。可以保存不含凭据的禁用草稿；启用和测试发送暂不可用。",
            "The server credential encryption key is not configured. You may save a disabled draft without credentials; enabling and test sending are unavailable.",
          )
        }}
      </p>
      <form data-testid="smtp-form" @submit.prevent="save">
        <fieldset class="smtp-fields" :disabled="preview || busy || blocked">
          <label class="smtp-toggle"
            ><input
              v-model="form.enabled"
              name="enabled"
              type="checkbox"
              :disabled="!baseline.key_configured && !form.enabled"
            /><span>{{ tr("启用 SMTP", "Enable SMTP") }}</span></label
          >
          <div class="settings-two-columns">
            <div class="settings-field">
              <label for="smtp-host">{{
                tr("SMTP 服务器", "SMTP server")
              }}</label
              ><input
                id="smtp-host"
                v-model="form.host"
                name="host"
                type="text"
                maxlength="253"
                autocomplete="off"
                spellcheck="false"
                placeholder="smtp.example.com"
                :required="form.enabled"
              />
            </div>
            <div class="settings-field">
              <label for="smtp-port">{{ tr("端口", "Port") }}</label
              ><input
                id="smtp-port"
                v-model.number="form.port"
                name="port"
                type="number"
                min="1"
                max="65535"
                step="1"
                required
              />
            </div>
          </div>
          <div class="settings-field">
            <label for="smtp-tls">{{ tr("TLS 模式", "TLS mode") }}</label
            ><select id="smtp-tls" v-model="form.tls_mode" name="tls_mode">
              <option value="starttls">
                STARTTLS · {{ tr("验证证书", "Verified certificate") }}
              </option>
              <option value="implicit_tls">
                {{
                  tr(
                    "隐式 TLS · 验证证书",
                    "Implicit TLS · Verified certificate",
                  )
                }}
              </option>
            </select>
            <p class="settings-help">
              {{
                tr(
                  "常见端口为 STARTTLS 587、隐式 TLS 465；请使用服务商指定的端口。切换模式不会自动更改端口。",
                  "Common ports are 587 for STARTTLS and 465 for implicit TLS. Use your provider's port; switching modes does not change it automatically.",
                )
              }}
            </p>
          </div>
          <p v-if="credentialsNeedReplacement" class="settings-notice">
            {{
              tr(
                "连接目标已变更：必须重新填写账号和密码，或禁用并清除两项凭据。原凭据不会自动转发到新目标。",
                "The connection target changed: replace both credentials, or disable SMTP and clear both. Stored credentials will not automatically be forwarded to a new target.",
              )
            }}
          </p>
          <div class="settings-two-columns">
            <div class="settings-field">
              <label for="smtp-username"
                >{{ tr("SMTP 账号", "SMTP account") }}
                <span>{{
                  baseline.username_configured
                    ? tr("已配置 · 不回显", "Configured · hidden")
                    : tr("未配置", "Not configured")
                }}</span></label
              ><input
                id="smtp-username"
                v-model="username"
                name="username"
                type="password"
                maxlength="254"
                autocomplete="new-password"
                spellcheck="false"
                :disabled="clearUsername || !baseline.key_configured"
                :placeholder="
                  baseline.username_configured
                    ? tr(
                        '留空保留现有账号',
                        'Leave blank to keep the saved account',
                      )
                    : tr('输入 SMTP 账号', 'Enter SMTP account')
                "
              /><label class="smtp-clear"
                ><input
                  v-model="clearUsername"
                  name="clear_username"
                  type="checkbox"
                />{{
                  tr(
                    "保存时清除已存账号",
                    "Clear the saved account when saving",
                  )
                }}</label
              >
            </div>
            <div class="settings-field">
              <label for="smtp-password"
                >{{
                  tr("SMTP 密码或应用密码", "SMTP password or app password")
                }}
                <span>{{
                  baseline.password_configured
                    ? tr("已配置 · 不回显", "Configured · hidden")
                    : tr("未配置", "Not configured")
                }}</span></label
              ><input
                id="smtp-password"
                v-model="password"
                name="password"
                type="password"
                maxlength="1024"
                autocomplete="new-password"
                :disabled="clearPassword || !baseline.key_configured"
                :placeholder="
                  baseline.password_configured
                    ? tr(
                        '留空保留现有密码',
                        'Leave blank to keep the saved password',
                      )
                    : tr('输入 SMTP 密码', 'Enter SMTP password')
                "
              /><label class="smtp-clear"
                ><input
                  v-model="clearPassword"
                  name="clear_password"
                  type="checkbox"
                />{{
                  tr(
                    "保存时清除已存密码",
                    "Clear the saved password when saving",
                  )
                }}</label
              >
            </div>
          </div>
          <p class="settings-help">
            {{
              tr(
                "凭据仅用于本次提交，不保存在浏览器存储中。提交结束后，输入的账号和密码会清空。",
                "Credentials are used only for this submission and are not saved in browser storage. Both inputs are cleared after the request finishes.",
              )
            }}
          </p>
          <div class="settings-two-columns">
            <div class="settings-field">
              <label for="smtp-from-address">{{
                tr("发件邮箱", "Sender address")
              }}</label
              ><input
                id="smtp-from-address"
                v-model="form.from_address"
                name="from_address"
                type="email"
                maxlength="254"
                autocomplete="off"
                :required="form.enabled"
              />
            </div>
            <div class="settings-field">
              <label for="smtp-from-name"
                >{{ tr("发件人名称", "Sender name") }}
                <span>{{ tr("可选", "Optional") }}</span></label
              ><input
                id="smtp-from-name"
                v-model="form.from_name"
                name="from_name"
                type="text"
                maxlength="120"
                autocomplete="off"
              />
            </div>
          </div>
        </fieldset>
        <div class="smtp-actions">
          <p class="settings-help">
            {{
              dirty
                ? tr("有尚未保存的修改", "Unsaved changes")
                : tr("当前显示已保存的配置", "Showing the saved configuration")
            }}
            · {{ tr("版本", "Revision") }} {{ baseline.revision }}
          </p>
          <button
            class="button primary"
            type="submit"
            :disabled="preview || busy || blocked || !dirty"
          >
            <Save :size="16" />{{
              saving
                ? tr("正在保存…", "Saving…")
                : tr("保存 SMTP 配置", "Save SMTP configuration")
            }}
          </button>
        </div>
      </form>
      <form
        class="smtp-test"
        data-testid="smtp-test-form"
        @submit.prevent="sendTest"
      >
        <h4>{{ tr("发送测试邮件", "Send a test message") }}</h4>
        <p class="settings-help">
          {{
            tr(
              "使用已保存且启用的配置发送一封测试邮件。请先保存所有修改；测试不会更改账单或订单。",
              "Send one test message using the saved, enabled configuration. Save all changes first; this does not change invoices or orders.",
            )
          }}
        </p>
        <div class="smtp-test-controls">
          <div class="settings-field">
            <label for="smtp-recipient">{{
              tr("测试收件邮箱", "Test recipient")
            }}</label
            ><input
              id="smtp-recipient"
              v-model="recipient"
              name="recipient"
              type="email"
              maxlength="254"
              autocomplete="off"
              :disabled="preview || busy"
              required
            />
          </div>
          <button class="button secondary" type="submit" :disabled="!canTest">
            <Send :size="16" />{{
              sending
                ? tr("正在发送…", "Sending…")
                : tr("发送一封测试邮件", "Send one test message")
            }}
          </button>
        </div>
        <p
          v-if="delivery"
          :class="
            delivery === 'accepted' ? 'settings-success' : 'settings-notice'
          "
          :role="delivery === 'accepted' ? 'status' : 'alert'"
        >
          {{ deliveryText }}
        </p>
        <button
          v-if="delivery === 'uncertain' && sendBlocked"
          type="button"
          class="text-button"
          :disabled="busy || preview"
          @click="
            sendBlocked = false;
            delivery = '';
          "
        >
          {{
            tr("允许再次发送（可能重复）", "Allow another send (may duplicate)")
          }}
        </button>
      </form>
    </template>
    <div class="smtp-reload">
      <button
        type="button"
        class="text-button"
        :disabled="busy || preview"
        @click="load"
      >
        <RefreshCw :size="15" />{{
          dirty
            ? tr("丢弃草稿并重新读取", "Discard draft and reload")
            : tr("重新读取 SMTP 配置", "Reload SMTP configuration")
        }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.smtp-settings {
  padding: 26px;
  margin-top: 24px;
}
.smtp-heading,
.smtp-heading h3,
.smtp-toggle,
.smtp-clear,
.smtp-actions,
.smtp-test-controls,
.smtp-reload button {
  display: flex;
  align-items: center;
  gap: 10px;
}
.smtp-heading,
.smtp-actions {
  justify-content: space-between;
  flex-wrap: wrap;
}
.smtp-heading h3 {
  margin: 4px 0 12px;
}
.smtp-fields {
  border: 0;
  padding: 0;
  margin: 22px 0 0;
  min-width: 0;
  display: grid;
  gap: 18px;
}
.smtp-toggle {
  font-weight: 600;
}
.settings-field .smtp-clear {
  font-size: 12px;
  font-weight: 400;
  margin: 9px 0 0;
}
.smtp-clear input,
.smtp-toggle input {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  margin: 0;
  accent-color: var(--blue);
}
.smtp-actions {
  margin-top: 22px;
  gap: 14px;
}
.smtp-test {
  border-top: 1px solid var(--border);
  margin-top: 26px;
  padding-top: 22px;
}
.smtp-test h4 {
  margin: 0 0 10px;
}
.smtp-test-controls {
  align-items: flex-end;
  margin: 16px 0;
  gap: 16px;
}
.smtp-test-controls .settings-field {
  flex: 1;
  min-width: 0;
}
.smtp-test-controls button {
  flex: 0 0 auto;
}
.smtp-reload {
  margin-top: 20px;
}
.settings-notice > p {
  margin: 0;
}
@media (max-width: 640px) {
  .smtp-settings {
    padding: 20px;
  }
  .smtp-test-controls {
    align-items: stretch;
    flex-direction: column;
  }
  .smtp-actions .button {
    width: 100%;
  }
}
</style>

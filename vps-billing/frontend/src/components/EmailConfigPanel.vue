<script setup lang="ts">
import UiSelect from "./UiSelect.vue";

import { computed, ref, watch } from "vue";
import { Mail, ShieldCheck } from "@lucide/vue";
import type { EmailSettings, EmailSettingsUpdate } from "../types/idc";
import { emailInput, smtpRecipient } from "../services/settings-input";
const props = defineProps<{
  locale: string;
  settings: EmailSettings;
  busy: boolean;
  uncertain: boolean;
}>();
const emit = defineEmits<{
  save: [value: EmailSettingsUpdate];
  test: [to: string];
  dirty: [value: boolean];
}>();
const t = (zh: string, en: string) => (props.locale === "zh-CN" ? zh : en);
const draft = ref<EmailSettingsUpdate>({} as EmailSettingsUpdate),
  username = ref(""),
  password = ref(""),
  clear = ref(false),
  to = ref(""),
  validation = ref("");
function reset() {
  draft.value = {
    revision: props.settings.revision,
    enabled: props.settings.enabled,
    host: props.settings.host,
    port: props.settings.port,
    tls_mode: props.settings.tls_mode,
    from_address: props.settings.from_address,
    from_name: props.settings.from_name,
  };
  username.value = "";
  password.value = "";
  clear.value = false;
  validation.value = "";
}
watch(() => props.settings, reset, { immediate: true });
const dirty = computed(
  () =>
    !!username.value ||
    !!password.value ||
    clear.value ||
    (
      [
        "enabled",
        "host",
        "port",
        "tls_mode",
        "from_address",
        "from_name",
      ] as const
    ).some((k) => draft.value[k] !== props.settings[k]),
);
watch(dirty, (value) => emit("dirty", value), { immediate: true });
const locked = computed(() => props.busy || props.uncertain);
watch(clear, (value) => {
  if (value) {
    username.value = "";
    password.value = "";
  }
});
watch(
  () => draft.value.enabled,
  (value) => {
    if (value) clear.value = false;
  },
);
function submit() {
  if (locked.value || !dirty.value) return;
  try {
    const value = emailInput(
      {
        ...draft.value,
        username: username.value,
        password: password.value,
        clear_username: clear.value,
        clear_password: clear.value,
      },
      props.settings,
    );
    validation.value = "";
    emit("save", value);
  } catch {
    validation.value = t(
      "检查服务器、发件地址和凭据。更换服务器时，请填写新的用户名与密码，或停用并清除两项。",
      "Check the server, sender and credentials. A new server needs both new credentials, or disable email and clear both.",
    );
  }
}
function test() {
  if (
    locked.value ||
    dirty.value ||
    !props.settings.enabled ||
    !props.settings.destination_allowed ||
    !props.settings.plugin_available
  )
    return;
  if (!smtpRecipient(to.value)) {
    validation.value = t(
      "填写一个有效的收件地址。",
      "Enter one valid recipient.",
    );
    return;
  }
  validation.value = "";
  emit("test", to.value);
}
</script>
<template>
  <div class="email-config">
    <header>
      <Mail :size="22" />
      <div>
        <h2>{{ t("邮件服务", "Email service") }}</h2>
        <p>
          {{
            t(
              "保存配置与发送测试分开操作。",
              "Save configuration separately from sending a test.",
            )
          }}
        </p>
      </div>
    </header>
    <div class="smtp-status" role="status">
      <ShieldCheck :size="18" /><span
        >{{ t("插件状态", "Plugin status") }}: {{ settings.plugin_status }} ·
        {{
          settings.destination_allowed
            ? t("目的地已批准", "Destination approved")
            : t("目的地尚未批准", "Destination not approved")
        }}</span
      >
    </div>
    <p v-if="validation" class="error-box" role="alert">{{ validation }}</p>
    <form @submit.prevent="submit">
      <fieldset :disabled="locked">
        <label class="switch-label"
          ><input v-model="draft.enabled" type="checkbox" />{{
            t("启用邮件服务", "Enable email service")
          }}</label
        >
        <div class="form-grid">
          <label class="form-group"
            ><span class="form-label">{{ t("SMTP 服务器", "SMTP host") }}</span
            ><input
              v-model="draft.host"
              class="form-input"
              autocomplete="off"
              placeholder="smtp.example.com" /></label
          ><label class="form-group"
            ><span class="form-label">{{ t("端口", "Port") }}</span
            ><input
              v-model.number="draft.port"
              class="form-input"
              type="number"
              min="1"
              max="65535"
              required
          /></label>
          <label class="form-group"
            ><span class="form-label">{{ t("加密方式", "Encryption") }}</span
            ><UiSelect v-model="draft.tls_mode" class="form-select"
              ><option value="starttls">STARTTLS</option>
              <option value="implicit_tls">TLS</option></UiSelect
            ></label
          ><label class="form-group"
            ><span class="form-label">{{ t("发件人名称", "Sender name") }}</span
            ><input v-model="draft.from_name" class="form-input" /></label
          ><label class="form-group wide"
            ><span class="form-label">{{
              t("发件地址", "Sender address")
            }}</span
            ><input
              v-model="draft.from_address"
              class="form-input"
              type="email"
          /></label>
        </div>
        <section class="credentials">
          <h3>{{ t("认证凭据", "Credentials") }}</h3>
          <p>
            {{
              t(
                "留空保留已有凭据。保存后不会显示用户名或密码。",
                "Leave blank to keep saved credentials. Saved usernames and passwords are not displayed.",
              )
            }}
          </p>
          <div class="form-grid">
            <label class="form-group"
              ><span class="form-label"
                >{{ t("新用户名", "New username") }} ·
                {{
                  settings.username_configured
                    ? t("已配置", "Configured")
                    : t("未配置", "Not configured")
                }}</span
              ><input
                v-model="username"
                class="form-input"
                type="password"
                autocomplete="off"
                :disabled="clear" /></label
            ><label class="form-group"
              ><span class="form-label"
                >{{ t("新密码", "New password") }} ·
                {{
                  settings.password_configured
                    ? t("已配置", "Configured")
                    : t("未配置", "Not configured")
                }}</span
              ><input
                v-model="password"
                class="form-input"
                type="password"
                autocomplete="new-password"
                :disabled="clear"
            /></label>
          </div>
          <label class="switch-label"
            ><input
              v-model="clear"
              type="checkbox"
              :disabled="draft.enabled"
            />{{
              t(
                "停用并同时清除用户名和密码",
                "Clear both username and password while disabled",
              )
            }}</label
          >
        </section>
        <p class="helper muted">
          {{
            t(
              "保存不会发送邮件，可在下方单独测试。",
              "Saving does not send email. Send a separate test below.",
            )
          }}
        </p>
        <div class="form-actions">
          <button
            class="btn btn-admin"
            :disabled="locked || !dirty"
            type="submit"
          >
            {{
              busy
                ? t("正在保存…", "Saving…")
                : t("保存邮件设置", "Save email settings")
            }}</button
          ><button
            class="btn btn-secondary"
            :disabled="locked || !dirty"
            type="button"
            @click="reset"
          >
            {{ t("放弃修改", "Discard changes") }}
          </button>
        </div>
      </fieldset>
    </form>
    <section class="test-email">
      <h3>{{ t("发送单封测试邮件", "Send one test email") }}</h3>
      <p>
        {{
          t(
            "使用已保存的配置发送一次。结果未确认时，请先检查收件箱，勿重复发送。",
            "Sends once using the saved settings. If the result is unconfirmed, check the inbox before sending again.",
          )
        }}
      </p>
      <form @submit.prevent="test">
        <label class="form-group"
          ><span class="form-label">{{
            t("测试收件人", "Test recipient")
          }}</span
          ><input
            v-model="to"
            type="email"
            class="form-input"
            required
            :disabled="locked" /></label
        ><button
          class="btn btn-secondary"
          :disabled="
            locked ||
            dirty ||
            !settings.enabled ||
            !settings.destination_allowed ||
            !settings.plugin_available
          "
        >
          {{ t("发送一次测试", "Send one test") }}
        </button>
      </form>
      <p v-if="dirty" class="helper muted">
        {{
          t(
            "先保存或放弃修改，再测试已保存配置。",
            "Save or discard changes before testing the saved configuration.",
          )
        }}
      </p>
    </section>
  </div>
</template>
<style scoped>
.email-config {
  font-size: 14px;
  line-height: 1.7;
}
.email-config > header {
  display: flex;
  align-items: center;
  gap: 14px;
}
.email-config h2 {
  font-size: 22px;
  font-weight: 600;
}
.email-config h3 {
  font-size: 16px;
  font-weight: 600;
}
.email-config p {
  color: var(--text-secondary);
  font-size: 13px;
  margin: 8px 0 16px;
}
.smtp-status {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 16px 0;
  margin: 16px 0;
  border-block: 1px solid var(--border-subtle);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  margin: 20px 0;
}
.wide {
  grid-column: 1/-1;
}
fieldset {
  border: 0;
  min-width: 0;
  padding: 0;
}
.switch-label {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  cursor: pointer;
}
.switch-label input {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.credentials,
.test-email {
  border-top: 1px solid var(--border-subtle);
  padding-top: 24px;
  margin-top: 24px;
}
.form-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 24px;
}
.test-email form {
  display: flex;
  align-items: end;
  gap: 12px;
}
.test-email .form-group {
  flex: 1;
  min-width: 0;
}
.test-email .btn {
  flex-shrink: 0;
}
.form-label {
  font-size: 13px;
}
.form-input,
.form-select {
  min-width: 0;
  font-size: 14px;
}
.btn {
  min-height: 44px;
}
input:focus-visible,
select:focus-visible,
button:focus-visible {
  outline: 2px solid var(--accent-admin);
  outline-offset: 3px;
}
@media (max-width: 600px) {
  .form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .test-email form {
    align-items: stretch;
    flex-direction: column;
  }
  .email-config > header {
    align-items: flex-start;
  }
  .email-config h2 {
    font-size: 20px;
  }
}
</style>

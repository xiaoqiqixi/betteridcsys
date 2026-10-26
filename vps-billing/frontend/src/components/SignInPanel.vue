<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from "@lucide/vue";
import OverlayPanel from "./OverlayPanel.vue";
import { useWorkspace } from "../composables/useWorkspace";
import { ApiError } from "../services/api";
import type { Locale } from "../types/idc";

const props = defineProps<{ open: boolean; locale: Locale }>();
const emit = defineEmits<{ close: []; signedIn: [] }>();
const ws = useWorkspace();
const email = ref(""),
  password = ref(""),
  visible = ref(false),
  busy = ref(false);
const error = shallowRef<ApiError | null>(null);
const retryUntil = ref(0),
  now = ref(Date.now());
const t = (zh: string, en: string) => (props.locale === "en" ? en : zh);
const remaining = computed(() =>
  Math.max(0, Math.ceil((retryUntil.value - now.value) / 1000)),
);
const invalidInput = computed(
  () =>
    !email.value.trim() ||
    new TextEncoder().encode(email.value.trim()).length > 254 ||
    !password.value ||
    new TextEncoder().encode(password.value).length > 72,
);
let ticker: ReturnType<typeof setInterval> | undefined;
watch(
  () => props.open,
  (open) => {
    if (ticker) clearInterval(ticker);
    password.value = "";
    visible.value = false;
    if (open) {
      now.value = Date.now();
      ticker = setInterval(() => {
        now.value = Date.now();
      }, 1000);
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker);
  password.value = "";
});
function close() {
  if (!busy.value) emit("close");
}
async function submit() {
  if (
    busy.value ||
    invalidInput.value ||
    remaining.value ||
    error.value?.uncertain
  )
    return;
  busy.value = true;
  error.value = null;
  try {
    await ws.signIn(email.value, password.value);
    emit("signedIn");
    emit("close");
  } catch (cause) {
    error.value =
      cause instanceof ApiError
        ? cause
        : new ApiError("NETWORK_ERROR", 0, {
            locale: props.locale,
            uncertain: true,
          });
    if (error.value.code === "RATE_LIMITED") {
      const observedAt = Date.now();
      now.value = observedAt;
      const raw = error.value.retryAfter;
      const until =
        raw && /^\d+$/.test(raw)
          ? observedAt + Number(raw) * 1000
          : raw
            ? Date.parse(raw)
            : NaN;
      retryUntil.value =
        Number.isFinite(until) && until > observedAt
          ? until
          : observedAt + 900000;
    }
  } finally {
    password.value = "";
    busy.value = false;
  }
}
async function verifySession() {
  if (busy.value) return;
  busy.value = true;
  try {
    await ws.refreshSession();
    if (ws.session.value?.user) {
      error.value = null;
      emit("signedIn");
      emit("close");
    } else error.value = null;
  } catch (cause) {
    error.value =
      cause instanceof ApiError
        ? cause
        : new ApiError("NETWORK_ERROR", 0, {
            locale: props.locale,
            context: "read",
          });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <OverlayPanel
    :close-label="t('关闭', 'Close')"
    :open="open"
    :title="t('登录账户', 'Sign in')"
    :description="
      t(
        '使用你的账户管理订单、账单与云服务。',
        'Access your orders, invoices and cloud services.',
      )
    "
    kind="modal"
    :busy="busy"
    @close="close"
  >
    <div class="signin-trust">
      <span><ShieldCheck :size="20" /></span>
      <p>
        {{ t("登录账户", "Sign in to your account")
        }}<small>{{
          t(
            "查看服务、订单与账单。",
            "Manage your services, orders and invoices.",
          )
        }}</small>
      </p>
    </div>
    <form id="signin-form" class="signin-form" @submit.prevent="submit">
      <fieldset :disabled="busy" class="signin-fields">
        <label class="form-group"
          ><span class="form-label">{{ t("邮箱", "Email") }}</span
          ><input
            v-model="email"
            class="form-input"
            type="email"
            autocomplete="username"
            inputmode="email"
            autocapitalize="none"
            spellcheck="false"
            required
            maxlength="254"
            placeholder="you@example.com"
        /></label>
        <label class="form-group"
          ><span class="form-label">{{ t("密码", "Password") }}</span
          ><span class="signin-password"
            ><input
              v-model="password"
              class="form-input"
              :type="visible ? 'text' : 'password'"
              autocomplete="current-password"
              required
              maxlength="72"
              :aria-describedby="error ? 'signin-error' : undefined" /><button
              type="button"
              class="icon-button"
              :aria-label="
                visible
                  ? t('隐藏密码', 'Hide password')
                  : t('显示密码', 'Show password')
              "
              :aria-pressed="visible"
              @click="visible = !visible"
            >
              <EyeOff v-if="visible" :size="18" /><Eye
                v-else
                :size="18"
              /></button></span
        ></label>
      </fieldset>
      <div v-if="error" id="signin-error" class="error-box" role="alert">
        <p>{{ error.message }}</p>
        <small v-if="error.requestId"
          >{{ t("请求编号", "Request ID") }}: {{ error.requestId }}</small
        >
        <p v-if="remaining">
          {{ t("请稍后再试，剩余", "Try again in") }} {{ remaining }}
          {{ t("秒", "seconds") }}
        </p>
        <button
          v-if="error.uncertain"
          type="button"
          class="btn btn-secondary"
          :disabled="busy"
          @click="verifySession"
        >
          {{ t("先重新确认会话", "Verify session first") }}
        </button>
      </div>
      <p class="signin-note">
        <LockKeyhole :size="14" />{{
          t("", "Signing in does not create an order or make a payment.")
        }}
      </p>
    </form>
    <template #footer
      ><button
        type="button"
        class="btn btn-secondary"
        :disabled="busy"
        @click="close"
      >
        {{ t("暂不登录", "Not now") }}</button
      ><button
        class="btn btn-primary"
        type="submit"
        form="signin-form"
        :disabled="busy || invalidInput || remaining > 0 || !!error?.uncertain"
      >
        {{ busy ? t("正在验证…", "Verifying…") : t("登录", "Sign in") }}
      </button></template
    >
  </OverlayPanel>
</template>

<style scoped>
.signin-trust {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 26px;
}
.signin-trust > span {
  display: grid;
  place-items: center;
  padding: 11px;
  background: var(--accent-dim);
  color: var(--accent-primary);
  border-radius: 12px;
}
.signin-trust p {
  font-weight: 600;
  font-size: 14px;
}
.signin-trust small {
  display: block;
  max-width: 34ch;
  color: var(--text-secondary);
  font-weight: 400;
  font-size: 12px;
  line-height: 1.7;
  margin-top: 5px;
}
.signin-fields {
  display: grid;
  gap: 20px;
  border: 0;
  padding: 0;
  min-width: 0;
}
.signin-password {
  display: flex;
  position: relative;
  min-width: 0;
}
.signin-password input {
  padding-right: 48px;
  width: 100%;
  min-width: 0;
}
.signin-password button {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  min-width: 40px;
  min-height: 40px;
}
.signin-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 20px;
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.7;
}
.signin-note svg {
  margin-top: 3px;
  flex-shrink: 0;
}
.error-box {
  margin-top: 18px;
  overflow-wrap: anywhere;
}
.error-box small {
  display: block;
  margin-top: 8px;
}
.error-box button {
  margin-top: 12px;
}
.signin-form input {
  font-size: 16px;
}
</style>

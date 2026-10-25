<script setup lang="ts">
import { ArrowUpRight, LogOut, Moon, Sun, UserRound } from "@lucide/vue";
import OverlayPanel from "./OverlayPanel.vue";
import UiSpinner from "./UiSpinner.vue";
import type { User } from "../types/idc";
const props = defineProps<{
  open: boolean;
  locale: string;
  user: User | null;
  appearance: string;
  busy: boolean;
  anchor: HTMLElement | null;
  realMode: boolean;
}>();
const emit = defineEmits<{
  close: [];
  profile: [];
  signIn: [];
  signOut: [];
  "update:appearance": [value: string];
}>();
const t = (zh: string, en: string) => (props.locale === "zh-CN" ? zh : en);
</script>
<template>
  <OverlayPanel
    :close-label="t('关闭', 'Close')"
    :open="open"
    :title="t('账户', 'Account')"
    kind="popover"
    :anchor="anchor"
    :busy="busy"
    @close="emit('close')"
    ><div class="account-menu">
      <div v-if="user" class="account-identity">
        <span class="account-initial">{{
          user.name.trim().slice(0, 1) || "U"
        }}</span>
        <div>
          <strong>{{ user.name }}</strong>
          <p>{{ user.email }}</p>
        </div>
      </div>
      <button v-if="user" class="account-link" @click="emit('profile')">
        <UserRound :size="18" /><span>{{
          t("账户资料", "Account details")
        }}</span
        ><ArrowUpRight :size="16" /></button
      ><button v-else class="btn btn-primary" @click="emit('signIn')">
        {{ t("登录", "Sign in") }}
      </button>
      <section class="appearance-group">
        <h3>{{ t("外观", "Appearance") }}</h3>
        <div class="appearance-segment">
          <button
            :aria-pressed="appearance === 'light'"
            @click="emit('update:appearance', 'light')"
          >
            <Sun :size="17" />{{ t("浅色", "Light") }}</button
          ><button
            :aria-pressed="appearance === 'dark'"
            @click="emit('update:appearance', 'dark')"
          >
            <Moon :size="17" />{{ t("深色", "Dark") }}
          </button>
        </div>
      </section>
      <button
        v-if="user && realMode"
        class="account-link signout"
        :disabled="busy"
        :aria-busy="busy"
        @click="emit('signOut')"
      >
        <UiSpinner v-if="busy" /><LogOut v-else :size="18" /><span>{{
          busy ? t("正在退出…", "Signing out…") : t("退出登录", "Sign out")
        }}</span>
      </button>
    </div></OverlayPanel
  >
</template>
<style scoped>
.account-menu {
  display: grid;
  gap: 16px;
}
.account-identity {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 2px 0 14px;
  border-bottom: 1px solid var(--border-subtle);
  min-width: 0;
}
.account-identity > div {
  min-width: 0;
}
.account-identity strong {
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.account-identity p {
  font-size: 12px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
  margin-top: 3px;
}
.account-initial {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  background: var(--bg-canvas);
  border: 1px solid var(--border-subtle);
  border-radius: 50%;
  font-size: 16px;
}
.account-link {
  display: flex;
  gap: 12px;
  align-items: center;
  min-height: 44px;
  padding: 10px 0;
  background: none;
  border: 0;
  font-size: 14px;
  cursor: pointer;
  text-align: left;
  color: var(--text-primary);
}
.account-link span {
  flex: 1;
}
.account-link:disabled {
  opacity: 0.5;
  cursor: wait;
}
.account-link:hover {
  color: var(--accent-primary);
}
.appearance-group {
  padding: 16px 0;
  border-block: 1px solid var(--border-subtle);
}
.appearance-group h3 {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.appearance-segment {
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: var(--bg-canvas);
  padding: 4px;
  border-radius: 10px;
  gap: 4px;
}
.appearance-segment button {
  border: 1px solid transparent;
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  font-size: 13px;
  background: transparent;
  border-radius: 7px;
  cursor: pointer;
  color: var(--text-secondary);
}
.appearance-segment [aria-pressed="true"] {
  background: var(--bg-surface);
  border-color: var(--border-subtle);
  color: var(--text-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
button:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 3px;
}
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, shallowRef } from "vue";
import { RouterView, useRoute } from "vue-router";
import { Server, Menu, SlidersHorizontal, LogOut } from "@lucide/vue";
import { createApiClient } from "./api/client";
import { useSession } from "./composables/session";
import { usePreferences } from "./composables/preferences";
import { consoleKey, type Notice } from "./context";
import NavLinks from "./components/NavLinks.vue";
import UiOverlay from "./components/UiOverlay.vue";
import UiSelect from "./components/UiSelect.vue";
import UiButton from "./components/UiButton.vue";
import StateBlock from "./components/StateBlock.vue";
import ToastStack from "./components/ToastStack.vue";
import InlineError from "./components/InlineError.vue";
import LoginPage from "./pages/LoginPage.vue";
const api = createApiClient(),
  session = useSession(api),
  prefs = usePreferences(),
  route = useRoute();
const { tr } = prefs;
const notices = shallowRef<Notice[]>([]),
  mobileOpen = shallowRef(false),
  preferencesOpen = shallowRef(false);
let noticeID = 0;
function notify(title: string, kind: "info" | "error" = "info") {
  notices.value = [...notices.value.slice(-3), { id: ++noticeID, title, kind }];
}
provide(consoleKey, { api, session, prefs, notify });
const pageTitle = computed(() =>
  route.path.startsWith("/nodes")
    ? tr("节点", "Nodes")
    : route.path.startsWith("/operations")
      ? tr("操作任务", "Tasks")
      : route.path.startsWith("/audit")
        ? tr("审计记录", "Audit log")
        : route.path.startsWith("/users")
          ? tr("成员与权限", "Members & access")
          : tr("实例", "Instances"),
);
const permission = computed(() => route.meta.permission as string | undefined);
const authorized = computed(
  () => !permission.value || session.can(permission.value),
);
const roleText = computed(() =>
  session.user.value?.role === "admin"
    ? tr("管理员", "Administrator")
    : session.user.value?.role === "operator"
      ? tr("操作员", "Operator")
      : session.user.value?.role === "viewer"
        ? tr("只读成员", "Viewer")
        : tr("自定义角色", "Custom role"),
);
const langOptions = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
];
const themeOptions = computed(() => [
  { value: "system", label: tr("跟随系统", "System") },
  { value: "light", label: tr("浅色", "Light") },
  { value: "dark", label: tr("深色", "Dark") },
]);
function locale(value: string) {
  if (value === "zh-CN" || value === "en") prefs.locale.value = value;
}
function appearance(value: string) {
  if (value === "system" || value === "light" || value === "dark")
    prefs.appearance.value = value;
}
function focus() {
  if (session.user.value && !session.busy.value) void session.refresh();
}
onMounted(() => {
  void session.refresh();
  window.addEventListener("focus", focus);
});
onBeforeUnmount(() => {
  prefs.dispose();
  window.removeEventListener("focus", focus);
});
</script>
<template>
  <a class="skip-link" href="#main-content">{{
    tr("跳到主要内容", "Skip to content")
  }}</a>
  <div v-if="!session.ready.value" class="boot-state">
    <div class="boot-mark"><Server :size="26" aria-hidden="true" />Aster</div>
    <StateBlock loading />
  </div>
  <template v-else-if="!session.user.value"
    ><div class="login-utilities">
      <button
        class="icon-button"
        type="button"
        :aria-label="tr('语言与外观', 'Language & appearance')"
        :title="tr('语言与外观', 'Language & appearance')"
        @click="preferencesOpen = true"
      >
        <SlidersHorizontal :size="19" aria-hidden="true" />
      </button>
    </div>
    <LoginPage
  /></template>
  <div v-else class="console-shell">
    <aside class="sidebar">
      <a class="brand" href="#/instances"
        ><span class="brand-symbol"
          ><Server :size="21" aria-hidden="true" /></span
        ><span
          >Aster<span class="brand-subtitle">{{
            tr("云管理", "Cloud console")
          }}</span></span
        ></a
      ><NavLinks tone="sidebar" />
      <div class="sidebar-account">
        <div class="account-avatar">
          {{
            (session.user.value.name || session.user.value.email)
              .slice(0, 1)
              .toLocaleUpperCase()
          }}
        </div>
        <div class="account-info">
          <strong>{{ session.user.value.name }}</strong
          ><span>{{ roleText }}</span>
        </div>
        <button
          type="button"
          class="sidebar-logout"
          :disabled="session.busy.value"
          :aria-label="tr('退出登录', 'Sign out')"
          @click="session.logout"
        >
          <LogOut :size="18" aria-hidden="true" />
        </button>
      </div>
    </aside>
    <div class="console-workspace">
      <header class="topbar">
        <div class="topbar-leading">
          <button
            class="icon-button mobile-menu"
            type="button"
            :aria-label="tr('打开导航', 'Open navigation')"
            @click="mobileOpen = true"
          >
            <Menu :size="21" aria-hidden="true" /></button
          ><span class="topbar-context">{{ tr("管理控制台", "Console") }}</span
          ><span class="topbar-separator" aria-hidden="true">/</span
          ><span class="topbar-page">{{ pageTitle }}</span>
        </div>
        <button
          class="appearance-trigger"
          type="button"
          :aria-label="tr('语言与外观', 'Language & appearance')"
          :title="tr('语言与外观', 'Language & appearance')"
          @click="preferencesOpen = true"
        >
          <SlidersHorizontal :size="16" aria-hidden="true" /><span>{{
            prefs.locale.value === "zh-CN" ? "中文" : "EN"
          }}</span>
        </button>
      </header>
      <main id="main-content" class="main-content" tabindex="-1">
        <InlineError
          v-if="session.error.value"
          :error="session.error.value"
        /><StateBlock
          v-if="!authorized"
          error="forbidden"
          @reload="session.refresh"
        /><RouterView v-else :key="session.user.value.id" />
      </main>
      <footer class="workspace-footer">
        <span>Aster</span
        ><span>{{ tr("基础设施管理", "Infrastructure management") }}</span>
      </footer>
    </div>
  </div>
  <UiOverlay
    :open="mobileOpen"
    :title="tr('导航', 'Navigation')"
    drawer
    :close-label="tr('关闭导航', 'Close navigation')"
    @close="mobileOpen = false"
    ><NavLinks tone="surface" @navigate="mobileOpen = false" />
    <template #footer
      ><UiButton
        :busy="session.busy.value"
        @click="
          session.logout();
          mobileOpen = false;
        "
        ><LogOut :size="16" aria-hidden="true" />{{
          tr("退出登录", "Sign out")
        }}</UiButton
      ></template
    ></UiOverlay
  ><UiOverlay
    :open="preferencesOpen"
    :title="tr('语言与外观', 'Language & appearance')"
    :close-label="tr('关闭', 'Close')"
    @close="preferencesOpen = false"
    ><div class="preferences-fields">
      <label class="field"
        >{{ tr("界面语言", "Language")
        }}<UiSelect
          :model-value="prefs.locale.value"
          :options="langOptions"
          :label="tr('界面语言', 'Language')"
          @update:model-value="locale" /></label
      ><label class="field"
        >{{ tr("外观", "Appearance")
        }}<UiSelect
          :model-value="prefs.appearance.value"
          :options="themeOptions"
          :label="tr('外观', 'Appearance')"
          @update:model-value="appearance"
      /></label>
    </div>
    <template #footer
      ><UiButton variant="primary" @click="preferencesOpen = false">{{
        tr("完成", "Done")
      }}</UiButton></template
    ></UiOverlay
  ><ToastStack
    :notices="notices"
    :close-label="tr('关闭通知', 'Dismiss notification')"
    @dismiss="(id) => (notices = notices.filter((n) => n.id !== id))"
  />
</template>
<style scoped>
.boot-state {
  min-height: 100dvh;
  max-width: 500px;
  margin: auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 32px;
  padding: 24px;
}
.boot-mark {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 24px;
  font-weight: 600;
}
.login-utilities {
  position: absolute;
  right: 24px;
  top: 20px;
  z-index: 20;
}
.console-shell {
  display: flex;
  min-height: 100dvh;
}
.sidebar {
  width: 232px;
  flex-shrink: 0;
  position: fixed;
  inset: 0 auto 0 0;
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
  padding: 30px 18px 18px;
  display: flex;
  flex-direction: column;
  z-index: 40;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--sidebar-text);
  text-decoration: none;
  padding: 0 12px;
  margin-bottom: 42px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.025em;
}
.brand-symbol {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 1px solid var(--sidebar-border);
  border-radius: 10px;
}
.brand-subtitle {
  display: block;
  font-size: 10px;
  font-weight: 400;
  color: var(--sidebar-secondary);
  margin-top: 4px;
  letter-spacing: 0.02em;
}
.sidebar-account {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 8px 0;
  border-top: 1px solid var(--sidebar-border);
}
.account-avatar {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  background: var(--sidebar-selected);
  border: 1px solid var(--sidebar-border);
  border-radius: 50%;
  flex-shrink: 0;
  font-size: 13px;
}
.account-info {
  flex: 1;
  min-width: 0;
}
.account-info strong {
  display: block;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.account-info > span {
  display: block;
  font-size: 10px;
  color: var(--sidebar-secondary);
  margin-top: 5px;
}
.sidebar-logout {
  width: 36px;
  height: 44px;
  display: grid;
  place-items: center;
  background: none;
  border: 0;
  color: var(--sidebar-secondary);
  border-radius: 8px;
}
.sidebar-logout:hover {
  background: var(--sidebar-hover);
}
.console-workspace {
  margin-left: 232px;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.topbar {
  height: 76px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 40px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  position: sticky;
  top: 0;
  z-index: 20;
}
.topbar-leading {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.topbar-context {
  font-size: 12px;
  color: var(--secondary);
}
.topbar-separator {
  color: var(--muted);
  font-size: 12px;
}
.topbar-page {
  font-size: 12px;
  font-weight: 500;
}
.appearance-trigger {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 40px;
  padding: 0 12px;
  color: var(--secondary);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 9px;
  font-size: 12px;
  flex-shrink: 0;
}
.appearance-trigger:hover {
  background: var(--hover);
}
.main-content {
  flex: 1;
  width: 100%;
  outline: none;
}
.workspace-footer {
  padding: 20px 40px;
  display: flex;
  justify-content: space-between;
  gap: 20px;
  font-size: 11px;
  color: var(--secondary);
  border-top: 1px solid var(--border);
}
.workspace-footer span {
  overflow-wrap: anywhere;
}
.mobile-menu {
  display: none;
}
.preferences-fields {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-height: 200px;
}
@media (max-width: 900px) {
  .sidebar {
    width: 204px;
    padding-inline: 12px;
  }
  .console-workspace {
    margin-left: 204px;
  }
  .topbar {
    padding-inline: 28px;
  }
  .workspace-footer {
    padding-inline: 28px;
  }
}
@media (max-width: 720px) {
  .sidebar {
    display: none;
  }
  .console-workspace {
    margin-left: 0;
  }
  .topbar {
    height: 64px;
    padding: 0 20px;
  }
  .mobile-menu {
    display: grid;
    margin-left: -8px;
  }
  .topbar-leading {
    gap: 10px;
  }
  .topbar-context,
  .topbar-separator {
    display: none;
  }
  .workspace-footer {
    padding: 20px;
  }
  .appearance-trigger {
    min-height: 40px;
  }
  .topbar-page {
    font-size: 14px;
  }
  .login-utilities {
    right: 12px;
    top: 12px;
  }
}
@media (max-width: 360px) {
  .topbar {
    padding-inline: 16px;
  }
  .appearance-trigger {
    padding-inline: 9px;
  }
}
</style>

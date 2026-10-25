<script setup lang="ts">
import LocaleCurrencyPanel from "./components/LocaleCurrencyPanel.vue";
import AccountPanel from "./components/AccountPanel.vue";
import UiSpinner from "./components/UiSpinner.vue";

import { computed, nextTick, onMounted, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import {
  ArrowUpRight,
  Box,
  ChevronDown,
  CreditCard,
  Cloud,
  Globe2,
  House,
  LayoutGrid,
  ListOrdered,
  Menu,
  Server,
  Settings2,
  ShieldCheck,
  Star,
  Users,
} from "@lucide/vue";
import OverlayPanel from "./components/OverlayPanel.vue";
import SignInPanel from "./components/SignInPanel.vue";
import { ApiError } from "./services/api";
import { useWorkspace } from "./composables/useWorkspace";
import type { CurrencyRegistry, PublicSiteSettings } from "./types/idc";

const ws = useWorkspace();
const {
  locale,
  currency,
  appearance,
  reportCurrency,
  mode,
  role,
  session,
  sessionVerified,
  sessionBusy,
  sessionError,
  generation,
  read,
} = ws;
const router = useRouter();
const route = useRoute();
const isAdmin = computed(
  () => route.path.startsWith("/admin") && role.value === "admin",
);
const t = (zh: string, en: string) => (locale.value === "zh-CN" ? zh : en);
const localeOpen = ref(false),
  accountOpen = ref(false),
  navigation = ref(false),
  login = ref(false),
  signOutBusy = ref(false),
  authError = ref<ApiError | null>(null);
const localeAnchor = ref<HTMLElement | null>(null),
  accountAnchor = ref<HTMLElement | null>(null);
const brand = ref("AetherGrid");
const brandLogo = ref<"star" | "cloud" | "server">("cloud");
const brandIcon = computed(
  () => ({ star: Star, cloud: Cloud, server: Server })[brandLogo.value],
);
const companyName = ref("");
const displayCurrencies = computed(() =>
  currencies.value
    .filter((c) => isAdmin.value || c.enabled)
    .slice()
    .sort((a, b) => Number(b.code === "CNY") - Number(a.code === "CNY")),
);
const publicRoute = computed(() => route.path === "/catalog");
const canMountPrivate = computed(
  () =>
    mode.value === "demo" || (sessionVerified.value && !!session.value?.user),
);
const selectedCurrency = computed({
  get: () => (isAdmin.value ? reportCurrency.value : currency.value),
  set: (v) => {
    if (isAdmin.value) ws.setReportCurrency(v);
    else ws.setPurchaseCurrency(v);
  },
});
const currencies = ref<Array<{ code: string; name: string; enabled: boolean }>>(
  [],
);
const customerNav = computed(() => [
  { path: "/home", label: t("首页", "Home"), icon: House },
  { path: "/catalog", label: t("云服务器", "Cloud servers"), icon: LayoutGrid },
  { path: "/orders", label: t("订单", "Orders"), icon: ListOrdered },
  { path: "/invoices", label: t("账单", "Invoices"), icon: CreditCard },
  { path: "/services", label: t("我的服务器", "My servers"), icon: Server },
]);
const adminNav = computed(() => [
  { path: "/admin/catalog", label: t("商品管理", "Products"), icon: Box },
  {
    path: "/admin/customers",
    label: t("客户与角色", "Accounts & roles"),
    icon: Users,
  },
  {
    path: "/admin/orders",
    label: t("全站订单", "All orders"),
    icon: ListOrdered,
  },
  {
    path: "/admin/invoices",
    label: t("全站账单", "All invoices"),
    icon: CreditCard,
  },
  {
    path: "/admin/finance",
    label: t("财务核对", "Financial review"),
    icon: CreditCard,
  },
  {
    path: "/admin/services",
    label: t("全站服务", "All services"),
    icon: Server,
  },
  {
    path: "/admin/audit",
    label: t("审计日志", "Audit log"),
    icon: ShieldCheck,
  },
  {
    path: "/admin/settings",
    label: t("系统设置", "Settings"),
    icon: Settings2,
  },
]);
const activeNav = computed(() =>
  isAdmin.value ? adminNav.value : customerNav.value,
);
const title = computed(() =>
  route.path === "/account"
    ? t("账户资料", "Account details")
    : [...customerNav.value, ...adminNav.value].find(
        (n) => route.path === n.path,
      )?.label || t("订单详情", "Order details"),
);
const mobileNav = computed(() =>
  isAdmin.value
    ? adminNav.value.slice(0, 3)
    : [
        customerNav.value[0]!,
        customerNav.value[1]!,
        customerNav.value.find((n) => n.path === "/invoices")!,
      ],
);
const initials = computed(
  () => session.value?.user?.name?.trim().slice(0, 1).toUpperCase() || "U",
);
function openLocale(event: Event) {
  localeAnchor.value = event.currentTarget as HTMLElement;
  accountOpen.value = false;
  localeOpen.value = true;
}
async function openAccount(event: Event) {
  accountAnchor.value = event.currentTarget as HTMLElement;
  localeOpen.value = false;
  navigation.value = false;
  await nextTick();
  accountOpen.value = true;
}
function orderCreated(id: string) {
  go(id ? `/orders/${id}` : "/orders");
}
function go(path: string) {
  navigation.value = false;
  localeOpen.value = false;
  accountOpen.value = false;
  router.push(path);
}
async function switchIdentity() {
  if (mode.value !== "demo") return;
  ws.setDemoRole(role.value === "admin" ? "customer" : "admin");
  await router.replace("/home");
}
async function refresh() {
  generation.value++;
  try {
    const registry = await read<CurrencyRegistry>("/currencies");
    if (ws.applyCurrencyRegistry(registry))
      currencies.value = registry.currencies;
  } catch {
    currencies.value = [];
  }
}
async function verifySession() {
  try {
    await ws.refreshSession();
  } catch {
    /* The session error is displayed; private pages remain unmounted. */
  }
}
async function signedIn() {
  authError.value = null;
  await refresh();
}
async function signOut() {
  if (signOutBusy.value) return;
  signOutBusy.value = true;
  authError.value = null;
  try {
    await ws.signOut();
    accountOpen.value = false;
    await router.replace("/catalog");
  } catch (e) {
    authError.value =
      e instanceof ApiError
        ? e
        : new ApiError("NETWORK_ERROR", 0, {
            locale: locale.value,
            uncertain: true,
          });
  } finally {
    signOutBusy.value = false;
  }
}
watch(appearance, (v) => (document.documentElement.dataset.appearance = v), {
  immediate: true,
});
watch(
  locale,
  (v) => (document.documentElement.lang = v === "zh-CN" ? "zh-CN" : "en"),
  { immediate: true },
);
watch(
  () => route.path,
  () => {
    navigation.value = false;
  },
);
watch(
  () => [title.value, brand.value],
  () => {
    document.title = `${title.value} · ${brand.value}`;
  },
  { immediate: true },
);
watch(
  () => `${mode.value}|${session.value?.user?.id ?? ""}|${role.value}`,
  () => {
    navigation.value = false;
    localeOpen.value = false;
    accountOpen.value = false;
    authError.value = null;
  },
);
onMounted(async () => {
  await verifySession();
  await refresh();
  try {
    const settings = await read<PublicSiteSettings>("/site-settings");
    ws.applySiteDefaults(settings);
    if (["star", "cloud", "server"].includes(settings.logo))
      brandLogo.value = settings.logo;
    if (typeof settings.company_name === "string")
      companyName.value = settings.company_name;
    if (typeof settings.site_name === "string" && settings.site_name.trim()) {
      brand.value = settings.site_name;
      if (["blue", "teal", "violet"].includes(settings.theme || ""))
        document.documentElement.dataset.brand = settings.theme;
      document.title = `${title.value} · ${brand.value}`;
    }
  } catch {
    /* Keep the neutral fallback brand; never invent successful settings. */
  }
});
</script>

<template>
  <div
    id="workspace-shell"
    class="idc-shell"
    :class="{ 'admin-mode': isAdmin }"
  >
    <a class="skip-link" href="#main-content">{{
      t("跳到内容", "Skip to content")
    }}</a>
    <div v-if="mode === 'demo'" class="preview-ribbon">
      <span class="preview-dot" /><span>{{
        t("演示环境 · 数据不会保存", "Demo · Changes are not saved")
      }}</span
      ><button v-if="mode === 'demo'" @click="switchIdentity">
        {{
          role === "customer"
            ? t("体验管理员", "Preview admin")
            : t("切回客户", "Preview customer")
        }}
        <ArrowUpRight :size="13" />
      </button>
    </div>
    <header class="idc-topbar">
      <div class="topbar-left">
        <button
          class="icon-button mobile-only"
          :aria-label="t('打开导航', 'Open navigation')"
          @click="navigation = true"
        >
          <Menu :size="21" /></button
        ><a href="#/home" class="brand" :title="brand" :aria-label="brand"
          ><span class="brand-icon"
            ><component :is="brandIcon" :size="22" /></span
          ><span
            >{{ brand
            }}<span class="brand-caption desktop-only">{{
              t("云服务控制台", "Cloud console")
            }}</span></span
          ></a
        ><span class="header-divider desktop-only" /><span
          class="desktop-only muted"
          >{{
            isAdmin
              ? t("管理工作台", "Administration")
              : t("客户中心", "Client area")
          }}</span
        >
      </div>
      <div class="topbar-actions">
        <button
          class="locale-trigger"
          :aria-label="t('语言与币种', 'Language & currency')"
          aria-haspopup="dialog"
          :aria-expanded="localeOpen"
          @click="openLocale"
        >
          <Globe2 :size="17" /><span>{{
            locale === "zh-CN" ? "简体中文" : "English"
          }}</span
          ><span class="locale-divider" /><span class="locale-currency">{{
            selectedCurrency
          }}</span
          ><ChevronDown :size="13" /></button
        ><button
          v-if="mode === 'api' && (!sessionVerified || !session?.user)"
          class="btn btn-primary header-login"
          @click="login = true"
        >
          {{ t("登录", "Sign in") }}
        </button>
      </div>
    </header>
    <div class="idc-body">
      <aside class="idc-sidebar desktop-only">
        <div class="sidebar-navigation">
          <p class="nav-section-title">
            {{
              isAdmin
                ? t("管理后台", "Administration")
                : t("客户中心", "Client area")
            }}
          </p>
          <nav
            :aria-label="
              isAdmin
                ? t('管理导航', 'Admin navigation')
                : t('客户导航', 'Client navigation')
            "
          >
            <a
              v-for="n in activeNav"
              :key="n.path"
              :href="`#${n.path}`"
              class="nav-item"
              :class="{
                'is-active':
                  route.path === n.path || route.path.startsWith(n.path + '/'),
              }"
              :aria-current="route.path === n.path ? 'page' : undefined"
              ><span class="nav-label"
                ><component :is="n.icon" :size="18" />{{ n.label }}</span
              ></a
            >
          </nav>
          <div v-if="role === 'admin'" class="mode-link">
            <button
              class="nav-item"
              @click="go(isAdmin ? '/home' : '/admin/catalog')"
            >
              <span class="nav-label"
                ><ShieldCheck :size="18" />{{
                  isAdmin
                    ? t("返回客户中心", "Client area")
                    : t("管理后台", "Administration")
                }}</span
              ><ArrowUpRight :size="15" />
            </button>
          </div>
        </div>
        <div class="sidebar-account">
          <button
            class="account-trigger"
            :aria-label="t('账户', 'Account')"
            aria-haspopup="dialog"
            :aria-expanded="accountOpen"
            @click="openAccount"
          >
            <span class="user-avatar">{{ initials }}</span
            ><span class="account-trigger-text"
              ><strong>{{ session?.user?.name || t("未登录", "Guest") }}</strong
              ><small>{{
                session?.user
                  ? t("账户与外观", "Account & appearance")
                  : t("登录与外观", "Sign in & appearance")
              }}</small></span
            ><ChevronDown :size="15" />
          </button>
        </div>
      </aside>
      <main id="main-content" class="idc-main" tabindex="-1">
        <div class="content-breadcrumb">
          <span>{{
            isAdmin
              ? t("管理控制台", "Admin console")
              : t("客户中心", "Client area")
          }}</span
          ><span>/</span><strong>{{ title }}</strong>
        </div>
        <div v-if="authError" class="error-box" role="alert">
          <p>{{ authError.message }}</p>
          <small v-if="authError.requestId"
            >{{ t("请求编号", "Request ID") }}: {{ authError.requestId }}</small
          ><button
            v-if="authError.uncertain"
            class="btn btn-secondary"
            @click="
              verifySession();
              authError = null;
            "
          >
            {{ t("重新连接", "Reconnect") }}
          </button>
        </div>
        <section
          v-if="mode === 'api' && !publicRoute && !canMountPrivate"
          class="empty-state session-state"
        >
          <UiSpinner v-if="sessionBusy" :size="28" /><ShieldCheck
            v-else
            :size="32"
          />
          <h2>
            {{
              sessionBusy
                ? t("正在登录…", "Signing in…")
                : sessionError
                  ? t("暂时无法连接，请重试", "Unable to connect. Try again")
                  : t("登录账户", "Sign in")
            }}
          </h2>
          <p>
            {{
              sessionError?.message ||
              t(
                "订单、账单和账户信息仅向已登录的本人展示。",
                "Orders, invoices and account information are available only to the signed-in owner.",
              )
            }}
          </p>
          <small v-if="sessionError?.requestId"
            >{{ t("请求编号", "Request ID") }}:
            {{ sessionError.requestId }}</small
          >
          <div class="session-actions">
            <button
              class="btn btn-primary"
              :disabled="sessionBusy"
              @click="login = true"
            >
              {{ t("登录", "Sign in") }}</button
            ><button
              v-if="sessionError"
              class="btn btn-secondary"
              :disabled="sessionBusy"
              @click="verifySession"
              :aria-busy="sessionBusy"
            >
              <UiSpinner v-if="sessionBusy" />{{
                t("重新连接", "Reconnect")
              }}</button
            ><button class="btn btn-secondary" @click="go('/catalog')">
              {{ t("选购云服务器", "Choose a cloud server") }}
            </button>
          </div>
        </section>
        <div
          v-else-if="route.path.startsWith('/admin') && role !== 'admin'"
          class="empty-state"
        >
          <ShieldCheck :size="30" />
          <h2>{{ t("需要管理员权限", "Administrator access required") }}</h2>
          <button class="btn btn-secondary" @click="go('/home')">
            {{ t("返回首页", "Back to home") }}
          </button>
        </div>
        <RouterView v-else v-slot="{ Component }"
          ><component
            :is="Component"
            :key="`${route.path}:${mode}:${role}:${generation}`"
            :locale="locale"
            :currency="selectedCurrency"
            :mode="mode"
            :role="isAdmin ? 'admin' : 'customer'"
            :section="String(route.meta.section || '')"
            :initial-id="String(route.params.id || '')"
            @navigate="go"
            @order-created="orderCreated"
            @request-sign-in="login = true"
        /></RouterView>
        <footer class="workspace-footer">
          <span>{{ companyName || brand }}</span>
        </footer>
      </main>
    </div>
    <nav
      class="mobile-bottom mobile-only"
      :aria-label="t('主导航', 'Primary navigation')"
    >
      <a
        v-for="n in mobileNav"
        :key="n.path"
        :href="`#${n.path}`"
        :aria-current="route.path.startsWith(n.path) ? 'page' : undefined"
        ><component :is="n.icon" :size="20" /><span>{{ n.label }}</span></a
      ><button @click="navigation = true">
        <Menu :size="20" /><span>{{ t("更多", "More") }}</span>
      </button>
    </nav>
  </div>
  <LocaleCurrencyPanel
    :open="localeOpen"
    :locale="locale"
    :currency="selectedCurrency"
    :currencies="displayCurrencies"
    :reporting="isAdmin"
    :anchor="localeAnchor"
    @update:locale="ws.setLocale($event)"
    @update:currency="selectedCurrency = $event"
    @close="localeOpen = false"
  />
  <AccountPanel
    :open="accountOpen"
    :locale="locale"
    :user="session?.user || null"
    :appearance="appearance"
    :busy="signOutBusy"
    :anchor="accountAnchor"
    :real-mode="mode === 'api'"
    @update:appearance="ws.setAppearance($event)"
    @close="accountOpen = false"
    @profile="go('/account')"
    @sign-in="
      accountOpen = false;
      login = true;
    "
    @sign-out="signOut"
  />
  <OverlayPanel
    :close-label="t('关闭', 'Close')"
    :open="navigation"
    :title="t('导航', 'Navigation')"
    :description="
      isAdmin
        ? t(
            '管理全站商品、客户与财务记录',
            'Manage the catalog, accounts and financial records',
          )
        : t(
            '管理服务与账单，挑选适合的套餐',
            'Services, invoices and cloud plans',
          )
    "
    @close="navigation = false"
    ><nav class="sheet-navigation">
      <a
        v-for="n in activeNav"
        :key="n.path"
        :href="`#${n.path}`"
        class="nav-item"
        :aria-current="route.path === n.path ? 'page' : undefined"
        @click.prevent="go(n.path)"
        ><span class="nav-label"
          ><component :is="n.icon" :size="20" />{{ n.label }}</span
        ><ArrowUpRight :size="15" /></a
      ><button
        v-if="role === 'admin'"
        class="nav-item"
        @click="go(isAdmin ? '/home' : '/admin/catalog')"
      >
        <span class="nav-label"
          ><ShieldCheck :size="20" />{{
            isAdmin
              ? t("客户中心", "Client area")
              : t("管理员控制台", "Administration")
          }}</span
        >
      </button>
    </nav>
    <div class="nav-sheet-end">
      <button
        class="account-trigger"
        :aria-label="t('账户', 'Account')"
        aria-haspopup="dialog"
        @click="openAccount"
      >
        <span class="user-avatar">{{ initials }}</span
        ><span class="account-trigger-text"
          ><strong>{{ session?.user?.name || t("未登录", "Guest") }}</strong
          ><small>{{ t("账户与外观", "Account & appearance") }}</small></span
        ><ChevronDown :size="15" />
      </button></div
  ></OverlayPanel>
  <SignInPanel
    :open="login"
    :locale="locale"
    @close="login = false"
    @signed-in="signedIn"
  />
</template>

<style scoped>
.session-state {
  max-width: 680px;
  margin: 64px auto;
  overflow-wrap: anywhere;
}
.session-state p {
  max-width: 48ch;
  line-height: 1.8;
}
.session-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}
</style>

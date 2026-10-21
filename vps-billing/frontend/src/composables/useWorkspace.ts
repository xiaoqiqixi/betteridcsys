import { computed, ref, shallowRef, watch } from "vue";
import type {
  CurrencyRegistry,
  Mode,
  Query,
  Role,
  Session,
} from "../types/idc";
import { ApiError, createApiClient, staleResponse } from "../services/api";
import { createDemoClient } from "../services/demo";
import { currencyRegistry as validCurrencyRegistry } from "../services/settings-input";
import {
  isAppearance,
  isCurrencyCode,
  isLocale,
  readPreferences,
  resolvePurchaseCurrency,
  savePreferences,
} from "../services/preferences";

// Real same-origin requests are the default. A failed backend never selects synthetic data.
const mode = ref<Mode>("api");
const preferences = readPreferences();
const locale = ref(preferences.locale ?? "zh-CN");
const currency = ref("CNY");
const appearance = ref(preferences.appearance ?? "dark");
const reportCurrency = ref("CNY");
let registry: CurrencyRegistry | null = null;
let siteCurrency: string | undefined;

function setLocale(value: unknown): boolean {
  if (!isLocale(value)) return false;
  locale.value = value;
  preferences.locale = value;
  savePreferences(preferences);
  return true;
}
function setAppearance(value: unknown): boolean {
  if (!isAppearance(value)) return false;
  appearance.value = value;
  preferences.appearance = value;
  savePreferences(preferences);
  return true;
}
function setPurchaseCurrency(value: unknown): boolean {
  if (
    !isCurrencyCode(value) ||
    !registry?.currencies.some((item) => item.code === value && item.enabled)
  )
    return false;
  currency.value = value;
  preferences.purchaseCurrency = value;
  savePreferences(preferences);
  return true;
}
function setReportCurrency(value: unknown): boolean {
  if (
    !isCurrencyCode(value) ||
    !registry?.currencies.some((item) => item.code === value)
  )
    return false;
  reportCurrency.value = value;
  return true;
}
function applyCurrencyRegistry(value: unknown): boolean {
  if (
    !validCurrencyRegistry(value) ||
    (registry && value.revision < registry.revision)
  )
    return false;
  const firstLoad = !registry;
  registry = value;
  if (
    preferences.purchaseCurrency &&
    !registry.currencies.some(
      (item) => item.code === preferences.purchaseCurrency && item.enabled,
    )
  ) {
    delete preferences.purchaseCurrency;
    savePreferences(preferences);
  }
  currency.value = resolvePurchaseCurrency(
    preferences.purchaseCurrency,
    registry,
    siteCurrency,
  );
  if (
    firstLoad ||
    !registry.currencies.some((item) => item.code === reportCurrency.value)
  )
    reportCurrency.value = resolvePurchaseCurrency(undefined, registry);
  return true;
}
function applySiteDefaults(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  if (
    !("locale" in preferences) &&
    "default_locale" in value &&
    isLocale(value.default_locale)
  )
    locale.value = value.default_locale;
  if ("default_currency" in value && isCurrencyCode(value.default_currency))
    siteCurrency = value.default_currency;
  currency.value = resolvePurchaseCurrency(
    preferences.purchaseCurrency,
    registry,
    siteCurrency,
  );
}
const demoRole = ref<Role>("customer");
const session = shallowRef<Session | null>(null);
const sessionVerified = ref(false),
  sessionBusy = ref(false);
const sessionError = shallowRef<ApiError | null>(null);
const generation = ref(0);
const role = computed<Role>(() =>
  mode.value === "demo"
    ? demoRole.value
    : (session.value?.user?.role ?? "customer"),
);
let demo = createDemoClient(() => demoRole.value);
const api = createApiClient({
  locale: () => locale.value,
  onSession: (value) => {
    session.value = value;
    sessionVerified.value = true;
    sessionError.value = null;
  },
  onSessionInvalid: (error) => {
    session.value = null;
    sessionVerified.value = false;
    sessionError.value = error;
  },
});

// Every user-ID/role/mode transition invalidates in-flight data and sensitive views.
watch(
  () => `${mode.value}|${session.value?.user?.id ?? ""}|${role.value}`,
  () => {
    generation.value++;
    // A report scope belongs to this identity's current session, never browser purchase preferences.
    reportCurrency.value = resolvePurchaseCurrency(
      undefined,
      registry,
      siteCurrency,
    );
  },
  { flush: "sync" },
);
watch(
  mode,
  (value) => {
    api.reset();
    session.value = value === "demo" ? demo.session() : null;
    sessionVerified.value = value === "demo";
    sessionError.value = null;
    sessionBusy.value = false;
  },
  { flush: "sync" },
);
watch(
  demoRole,
  () => {
    if (mode.value === "demo") session.value = demo.session();
  },
  { flush: "sync" },
);

async function read<T>(path: string, query?: Query): Promise<T> {
  const current = generation.value,
    selectedMode = mode.value;
  const result = await (selectedMode === "demo"
    ? demo.read<T>(path, query)
    : api.read<T>(path, query));
  if (
    selectedMode !== mode.value ||
    (path !== "/session" && current !== generation.value)
  )
    throw staleResponse();
  return result;
}
async function write<T>(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const current = generation.value,
    selectedMode = mode.value;
  const result = await (selectedMode === "demo"
    ? demo.write<T>(path, body, headers)
    : api.write<T>(path, body, headers));
  const identityOperation =
    path === "/auth/login" ||
    path === "/auth/logout" ||
    /^\/admin\/customer-accounts\/[^/]+\/(?:password|revoke-sessions)$/.test(
      path,
    );
  if (
    selectedMode !== mode.value ||
    (!identityOperation && current !== generation.value)
  )
    throw staleResponse(selectedMode === "api");
  if (selectedMode === "demo" && path.startsWith("/admin/customer-accounts"))
    session.value = demo.session();
  return result;
}
let refreshSequence = 0;
async function refreshSession(): Promise<Session> {
  const sequence = ++refreshSequence,
    selectedMode = mode.value;
  sessionBusy.value = true;
  sessionError.value = null;
  try {
    const value =
      selectedMode === "demo" ? demo.session() : await api.refreshSession();
    if (selectedMode !== mode.value || sequence !== refreshSequence)
      throw staleResponse();
    session.value = value;
    sessionVerified.value = true;
    return value;
  } catch (cause) {
    if (selectedMode === mode.value && sequence === refreshSequence) {
      session.value = null;
      sessionVerified.value = false;
      sessionError.value =
        cause instanceof ApiError
          ? cause
          : new ApiError("NETWORK_ERROR", 0, { locale: locale.value });
    }
    throw cause;
  } finally {
    if (selectedMode === mode.value && sequence === refreshSequence)
      sessionBusy.value = false;
  }
}
async function signIn(email: string, password: string) {
  if (mode.value !== "api")
    throw new ApiError("DEMO_AUTH_UNAVAILABLE", 400, { locale: locale.value });
  return write<Session>("/auth/login", {
    email: email.trim().toLowerCase(),
    password,
  });
}
async function signOut() {
  if (mode.value !== "api")
    throw new ApiError("DEMO_AUTH_UNAVAILABLE", 400, { locale: locale.value });
  return write<Session>("/auth/logout", {});
}
function setDemoRole(value: Role) {
  if (mode.value !== "demo") throw new Error("DEMO_ROLE_ONLY");
  demoRole.value = value;
}
function setMode(value: Mode) {
  if (value !== "demo" && value !== "api") throw new Error("INVALID_MODE");
  mode.value = value;
  refreshSequence++;
}
function resetDemo() {
  demo = createDemoClient(() => demoRole.value);
  generation.value++;
  if (mode.value === "demo") session.value = demo.session();
}
export function useWorkspace() {
  return {
    mode,
    locale,
    currency,
    appearance,
    reportCurrency,
    setLocale,
    setAppearance,
    setPurchaseCurrency,
    setReportCurrency,
    applyCurrencyRegistry,
    applySiteDefaults,
    role,
    session,
    sessionVerified,
    sessionBusy,
    sessionError,
    generation,
    read,
    write,
    signIn,
    signOut,
    setDemoRole,
    setMode,
    refreshSession,
    resetDemo,
  };
}

import { computed, ref } from "vue";
import {
  defaultCurrencyRegistry,
  isCurrencyCode,
  readCurrencyRegistry,
  type CurrencyRegistry,
} from "./currencies";
export type { Currency } from "./currencies";

export type Locale = "zh-CN" | "en";
const localeKey = "aster.locale";
const currencyKey = "aster.currency";
export const isLocale = (value: unknown): value is Locale =>
  value === "zh-CN" || value === "en";
export const currencyRegistry = ref<CurrencyRegistry>(
  structuredClone(defaultCurrencyRegistry),
);
export const enabledCurrencies = computed(() =>
  currencyRegistry.value.currencies
    .filter((item) => item.enabled)
    .sort(
      (a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code),
    ),
);
export const isCurrency = (value: unknown): value is string =>
  isCurrencyCode(value) &&
  enabledCurrencies.value.some((item) => item.code === value);
let registryLoaded = false;
let preferredCurrency: string | undefined;
export const locale = ref<Locale>("zh-CN");
export const currency = ref<string>("CNY");
let localeOverride = false;
let currencyOverride = false;
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Session preference still works when storage is blocked. */
  }
}
export function restorePreferences() {
  const storedLocale = read(localeKey);
  const storedCurrency = read(currencyKey);
  localeOverride = isLocale(storedLocale);
  preferredCurrency = isCurrencyCode(storedCurrency)
    ? storedCurrency
    : undefined;
  currencyOverride = preferredCurrency !== undefined;
  currencyRegistry.value = structuredClone(defaultCurrencyRegistry);
  registryLoaded = false;
  locale.value = isLocale(storedLocale) ? storedLocale : "zh-CN";
  currency.value = isCurrency(storedCurrency) ? storedCurrency : "CNY";
}
export function setLocale(value: unknown): boolean {
  if (!isLocale(value)) return false;
  localeOverride = true;
  locale.value = value;
  save(localeKey, value);
  return true;
}
export function setCurrency(value: unknown): boolean {
  if (!isCurrency(value)) return false;
  currencyOverride = true;
  preferredCurrency = value;
  currency.value = value;
  save(currencyKey, value);
  return true;
}
// Registry metadata is authoritative for available purchase currencies. A stale
// response may not re-enable a disabled currency or overwrite a newer default.
export function applyCurrencyRegistry(value: CurrencyRegistry): boolean {
  const next = readCurrencyRegistry(value);
  if (registryLoaded && next.revision < currencyRegistry.value.revision)
    return false;
  currencyRegistry.value = next;
  registryLoaded = true;
  if (currencyOverride && !isCurrency(preferredCurrency)) {
    currencyOverride = false;
    preferredCurrency = undefined;
    try {
      localStorage.removeItem(currencyKey);
    } catch {
      /* Storage is optional. */
    }
  }
  currency.value =
    currencyOverride && preferredCurrency
      ? preferredCurrency
      : next.default_currency;
  return true;
}
// Site language defaults never overwrite a browser choice; currency defaults
// come from the current registry and never change language or convert money.
export function applyDefaults(
  defaultLocale: unknown,
  defaultCurrency: unknown,
) {
  if (!localeOverride && isLocale(defaultLocale)) locale.value = defaultLocale;
  if (!currencyOverride) {
    const selectedDefault = registryLoaded
      ? currencyRegistry.value.default_currency
      : defaultCurrency;
    if (isCurrency(selectedDefault)) currency.value = selectedDefault;
  }
}
export const tr = (zh: string, en: string): string =>
  locale.value === "en" ? en : zh;
export const intlLocale = () => (locale.value === "en" ? "en-US" : "zh-CN");
restorePreferences();

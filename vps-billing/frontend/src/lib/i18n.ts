import { ref } from "vue";

export type Locale = "zh-CN" | "en";
export type Currency = "CNY" | "USD";
const localeKey = "aster.locale";
const currencyKey = "aster.currency";
export const isLocale = (value: unknown): value is Locale =>
  value === "zh-CN" || value === "en";
export const isCurrency = (value: unknown): value is Currency =>
  value === "CNY" || value === "USD";
export const locale = ref<Locale>("zh-CN");
export const currency = ref<Currency>("CNY");
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
  currencyOverride = isCurrency(storedCurrency);
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
  currency.value = value;
  save(currencyKey, value);
  return true;
}
// Site defaults never overwrite an explicit browser preference. No locale/currency coupling.
export function applyDefaults(
  defaultLocale: unknown,
  defaultCurrency: unknown,
) {
  if (!localeOverride && isLocale(defaultLocale)) locale.value = defaultLocale;
  if (!currencyOverride && isCurrency(defaultCurrency))
    currency.value = defaultCurrency;
}
export const tr = (zh: string, en: string): string =>
  locale.value === "en" ? en : zh;
export const intlLocale = () => (locale.value === "en" ? "en-US" : "zh-CN");
restorePreferences();

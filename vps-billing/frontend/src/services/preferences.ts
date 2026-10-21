import type { CurrencyRegistry, Locale } from "../types/idc";

export type Appearance = "light" | "dark";
export interface BrowserPreferences {
  locale?: Locale;
  purchaseCurrency?: string;
  appearance?: Appearance;
}
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
// Only non-sensitive display choices live here. Report currency and authentication never do.
export const PREFERENCE_KEY = "betteridcsys.console.preferences.v1";
export const isLocale = (value: unknown): value is Locale =>
  value === "zh-CN" || value === "en";
export const isAppearance = (value: unknown): value is Appearance =>
  value === "light" || value === "dark";
export const isCurrencyCode = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value);

export function parsePreferences(raw: unknown): BrowserPreferences {
  if (typeof raw !== "string" || raw.length > 512) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !("version" in value) ||
      value.version !== 1
    )
      return {};
    const result: BrowserPreferences = {};
    if ("locale" in value && isLocale(value.locale))
      result.locale = value.locale;
    if ("appearance" in value && isAppearance(value.appearance))
      result.appearance = value.appearance;
    if ("purchaseCurrency" in value && isCurrencyCode(value.purchaseCurrency))
      result.purchaseCurrency = value.purchaseCurrency;
    return result;
  } catch {
    return {};
  }
}

function browserStorage(): PreferenceStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
export function readPreferences(
  storage = browserStorage(),
): BrowserPreferences {
  try {
    return parsePreferences(storage?.getItem(PREFERENCE_KEY));
  } catch {
    return {};
  }
}
export function savePreferences(
  value: BrowserPreferences,
  storage = browserStorage(),
): boolean {
  try {
    if (!storage) return false;
    // Whitelist again at the persistence boundary, even for a malformed caller.
    const safe = parsePreferences(JSON.stringify({ ...value, version: 1 }));
    storage.setItem(PREFERENCE_KEY, JSON.stringify({ version: 1, ...safe }));
    return true;
  } catch {
    return false;
  }
}

export function resolvePurchaseCurrency(
  preferred: string | undefined,
  registry: CurrencyRegistry | null,
  siteDefault?: unknown,
): string {
  if (!registry) return isCurrencyCode(siteDefault) ? siteDefault : "CNY";
  const enabled = registry.currencies.filter((item) => item.enabled);
  if (preferred && enabled.some((item) => item.code === preferred))
    return preferred;
  if (enabled.some((item) => item.code === registry.default_currency))
    return registry.default_currency;
  if (enabled.some((item) => item.code === "CNY")) return "CNY";
  return (
    [...enabled].sort(
      (a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code),
    )[0]?.code ?? "CNY"
  );
}

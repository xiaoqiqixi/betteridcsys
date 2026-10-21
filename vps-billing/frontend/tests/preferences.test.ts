// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PREFERENCE_KEY,
  parsePreferences,
  readPreferences,
  resolvePurchaseCurrency,
  savePreferences,
} from "../src/services/preferences";
import type { CurrencyRegistry } from "../src/types/idc";

const registry = (): CurrencyRegistry => ({
  revision: 1,
  default_currency: "USD",
  currencies: [
    {
      code: "CNY",
      name: "人民币",
      prefix: "¥",
      suffix: "",
      decimal_places: 2,
      enabled: true,
      sort_order: 0,
      precision_locked: false,
    },
    {
      code: "USD",
      name: "美元",
      prefix: "$",
      suffix: "",
      decimal_places: 2,
      enabled: true,
      sort_order: 1,
      precision_locked: false,
    },
    {
      code: "JPY",
      name: "日元",
      prefix: "¥",
      suffix: "",
      decimal_places: 0,
      enabled: false,
      sort_order: 2,
      precision_locked: false,
    },
  ],
});
const stored = (value: object) =>
  localStorage.setItem(
    PREFERENCE_KEY,
    JSON.stringify({ version: 1, ...value }),
  );
async function workspace() {
  vi.resetModules();
  return (await import("../src/composables/useWorkspace")).useWorkspace();
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("browser preference whitelist and unavailable storage", () => {
  it("reads only valid versioned display choices from the independent namespace", () => {
    expect(
      parsePreferences(
        JSON.stringify({
          version: 1,
          locale: "en",
          purchaseCurrency: "CNY",
          appearance: "light",
          reportCurrency: "JPY",
          password: "never persist",
          csrf_token: "never persist",
        }),
      ),
    ).toEqual({ locale: "en", purchaseCurrency: "CNY", appearance: "light" });
    expect(PREFERENCE_KEY).not.toMatch(/^aster\./);
  });
  it.each([
    null,
    undefined,
    "",
    "{",
    "null",
    "[]",
    '{"version":2,"locale":"en"}',
    '{"version":"1","locale":"en"}',
    "x".repeat(513),
  ])("rejects corrupt or unsupported preference storage %s", (raw) => {
    expect(parsePreferences(raw)).toEqual({});
  });
  it("rejects invalid values independently without discarding valid fields", () => {
    expect(
      parsePreferences(
        '{"version":1,"locale":"fr","purchaseCurrency":"usd","appearance":"light"}',
      ),
    ).toEqual({ appearance: "light" });
  });
  it("whitelists again when writing and never persists report scope or secrets", () => {
    const setItem = vi.fn();
    expect(
      savePreferences(
        {
          locale: "en",
          appearance: "light",
          purchaseCurrency: "USD",
          ...{
            reportCurrency: "JPY",
            password: "secret",
            csrf_token: "secret",
          },
        },
        { getItem: () => null, setItem },
      ),
    ).toBe(true);
    expect(setItem).toHaveBeenCalledWith(
      PREFERENCE_KEY,
      '{"version":1,"locale":"en","appearance":"light","purchaseCurrency":"USD"}',
    );
  });
  it("fails safely when reads or writes are denied", () => {
    const blocked = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    };
    expect(readPreferences(blocked)).toEqual({});
    expect(savePreferences({ locale: "en" }, blocked)).toBe(false);
  });
});

describe("purchase currency resolution never changes historical money", () => {
  it.each(["CNY", "USD"])(
    "keeps saved enabled purchase currency %s above operator defaults",
    (preferred) => {
      expect(resolvePurchaseCurrency(preferred, registry(), "JPY")).toBe(
        preferred,
      );
    },
  );
  it.each([undefined, "JPY", "ZZZ"])(
    "falls back from disabled or unknown selection %s to the actual enabled registry default",
    (preferred) => {
      expect(resolvePurchaseCurrency(preferred, registry(), "CNY")).toBe("USD");
    },
  );
  it("prefers enabled CNY when no usable configured default exists, then the first enabled code", () => {
    const value = registry();
    value.default_currency = "JPY";
    expect(resolvePurchaseCurrency(undefined, value)).toBe("CNY");
    value.currencies[0]!.enabled = false;
    expect(resolvePurchaseCurrency(undefined, value)).toBe("USD");
  });
  it("uses a syntactically valid site default only before registry confirmation", () => {
    expect(resolvePurchaseCurrency(undefined, null, "USD")).toBe("USD");
    expect(resolvePurchaseCurrency("JPY", null, "bad")).toBe("CNY");
  });
});

describe("workspace preference and reporting isolation", () => {
  it("applies operator defaults without saving them as explicit user overrides", async () => {
    const ws = await workspace();
    ws.applySiteDefaults({ default_locale: "en", default_currency: "USD" });
    expect(ws.locale.value).toBe("en");
    expect(ws.currency.value).toBe("USD");
    expect(localStorage.getItem(PREFERENCE_KEY)).toBeNull();
    expect(ws.applyCurrencyRegistry(registry())).toBe(true);
    expect(ws.reportCurrency.value).toBe("USD");
    ws.applySiteDefaults({ default_locale: "zh-CN", default_currency: "CNY" });
    expect(ws.locale.value).toBe("zh-CN");
    expect(ws.currency.value).toBe("USD");
  });
  it("restores explicit language, appearance and enabled purchase currency across a fresh module", async () => {
    const ws = await workspace();
    ws.applyCurrencyRegistry(registry());
    expect(ws.setLocale("zh-CN")).toBe(true);
    expect(ws.setAppearance("light")).toBe(true);
    expect(ws.setPurchaseCurrency("CNY")).toBe(true);
    ws.applySiteDefaults({ default_locale: "en", default_currency: "USD" });
    expect(ws.locale.value).toBe("zh-CN");
    expect(ws.currency.value).toBe("CNY");
    const restored = await workspace();
    restored.applyCurrencyRegistry(registry());
    restored.applySiteDefaults({
      default_locale: "en",
      default_currency: "USD",
    });
    expect(restored.locale.value).toBe("zh-CN");
    expect(restored.appearance.value).toBe("light");
    expect(restored.currency.value).toBe("CNY");
    expect(restored.reportCurrency.value).toBe("USD");
  });
  it.each(["JPY", "ZZZ"])(
    "clears stale saved purchase %s after a confirmed registry, while retaining other choices",
    async (code) => {
      stored({ locale: "en", appearance: "light", purchaseCurrency: code });
      const ws = await workspace();
      ws.applyCurrencyRegistry(registry());
      expect(ws.currency.value).toBe("USD");
      expect(readPreferences()).toEqual({ locale: "en", appearance: "light" });
    },
  );
  it("rejects noncanonical values and disabled purchases without writing storage", async () => {
    const ws = await workspace();
    ws.applyCurrencyRegistry(registry());
    expect(ws.setLocale("fr")).toBe(false);
    expect(ws.setAppearance("system")).toBe(false);
    expect(ws.setPurchaseCurrency("JPY")).toBe(false);
    expect(ws.setPurchaseCurrency("ZZZ")).toBe(false);
    expect(ws.setReportCurrency("ZZZ")).toBe(false);
    expect(localStorage.getItem(PREFERENCE_KEY)).toBeNull();
  });
  it("allows disabled registered reporting currencies without changing or persisting purchase scope", async () => {
    const ws = await workspace();
    ws.applyCurrencyRegistry(registry());
    ws.setPurchaseCurrency("CNY");
    const snapshot = localStorage.getItem(PREFERENCE_KEY);
    expect(ws.setReportCurrency("JPY")).toBe(true);
    expect(ws.reportCurrency.value).toBe("JPY");
    expect(ws.currency.value).toBe("CNY");
    expect(localStorage.getItem(PREFERENCE_KEY)).toBe(snapshot);
    const fresh = await workspace();
    fresh.applyCurrencyRegistry(registry());
    expect(fresh.currency.value).toBe("CNY");
    expect(fresh.reportCurrency.value).toBe("USD");
  });
  it("rejects a malformed or older registry rather than enabling a stale purchase", async () => {
    const ws = await workspace();
    const current = registry();
    current.revision = 2;
    ws.applyCurrencyRegistry(current);
    ws.setPurchaseCurrency("CNY");
    expect(
      ws.applyCurrencyRegistry({ ...registry(), default_currency: "JPY" }),
    ).toBe(false);
    expect(ws.applyCurrencyRegistry(registry())).toBe(false);
    expect(ws.currency.value).toBe("CNY");
  });
  it("invalidates a disabled preference on a newer registry without changing the original metadata", async () => {
    const ws = await workspace();
    const value = registry();
    ws.applyCurrencyRegistry(value);
    ws.setPurchaseCurrency("CNY");
    const original = JSON.stringify(value);
    const next = registry();
    next.revision = 2;
    next.currencies[0]!.enabled = false;
    ws.applyCurrencyRegistry(next);
    expect(ws.currency.value).toBe("USD");
    expect(readPreferences().purchaseCurrency).toBeUndefined();
    expect(JSON.stringify(value)).toBe(original);
  });
  it("keeps choices usable in memory when storage is blocked", async () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
      clear() {},
    });
    const ws = await workspace();
    ws.applyCurrencyRegistry(registry());
    expect(ws.setLocale("en")).toBe(true);
    expect(ws.setAppearance("light")).toBe(true);
    expect(ws.setPurchaseCurrency("CNY")).toBe(true);
    expect(ws.locale.value).toBe("en");
    expect(ws.appearance.value).toBe("light");
    expect(ws.currency.value).toBe("CNY");
  });
});

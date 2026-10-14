// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { money } from "../src/lib/api";
import {
  canonicalAmount,
  currencyWritePayload,
  defaultCurrencyRegistry,
  readCurrencyBlocker,
  readCurrencyRegistry,
  readPlanPrices,
  type CurrencyFormat,
} from "../src/lib/currencies";
import {
  applyCurrencyRegistry,
  applyDefaults,
  currency,
  enabledCurrencies,
  locale,
  restorePreferences,
  setCurrency,
  setLocale,
} from "../src/lib/i18n";

const jpy: CurrencyFormat = {
  code: "JPY",
  name: "日本円",
  prefix: "¥",
  suffix: "",
  decimal_places: 0,
};
const kwd: CurrencyFormat = {
  code: "KWD",
  name: "Kuwaiti dinar",
  prefix: "",
  suffix: " د.ك",
  decimal_places: 3,
};
const expanded = () => ({
  revision: 2,
  default_currency: "CNY",
  currencies: [
    ...structuredClone(defaultCurrencyRegistry.currencies),
    ...[jpy, kwd].map((format, i) => ({
      ...format,
      enabled: true,
      precision_locked: true,
      sort_order: i + 1,
    })),
  ],
});
beforeEach(() => {
  localStorage.clear();
  restorePreferences();
});

describe("exact configurable money", () => {
  it("formats zero, three and six decimal places without changing the recorded units", () => {
    expect(money(1234, "JPY", jpy)).toBe("JPY ¥1,234");
    expect(money(1234, "KWD", kwd)).toBe("KWD 1.234 د.ك");
    expect(money(-1, "KWD", kwd)).toBe("-KWD 0.001 د.ك");
    expect(money(0, "JPY", jpy)).toBe("JPY ¥0");
    expect(money(Number.MAX_SAFE_INTEGER, "KWD", kwd)).toBe(
      "KWD 9,007,199,254,740.991 د.ك",
    );
    expect(money(Number.MAX_SAFE_INTEGER, "JPY", jpy)).toBe(
      "JPY ¥9,007,199,254,740,991",
    );
    expect(
      money(Number.MAX_SAFE_INTEGER, "KWD", { ...kwd, decimal_places: 6 }),
    ).toBe("KWD 9,007,199,254.740991 د.ك");
  });
  it("never replaces historic precision or presentation with current registry settings", () => {
    const old = {
      code: "USD",
      name: "Old dollar",
      prefix: "OLD $",
      suffix: "",
      decimal_places: 2,
    };
    applyCurrencyRegistry({
      ...expanded(),
      currencies: [
        ...expanded().currencies,
        {
          ...old,
          prefix: "NEW $",
          enabled: false,
          precision_locked: true,
          sort_order: 9,
        },
      ],
    });
    setCurrency("KWD");
    setLocale("en");
    expect(money(1201, "USD", old)).toBe("USD OLD $12.01");
    expect(money(1201, "USD")).toBe("USD 12.01");
    expect(money(1201, "JPY")).toBe("—");
  });
  it("rejects mismatched, malformed and unsafe amounts instead of guessing", () => {
    expect(money(1234, "CNY", jpy)).toBe("—");
    expect(money(Number.MAX_SAFE_INTEGER + 1, "JPY", jpy)).toBe("—");
    expect(money(1.5, "JPY", jpy)).toBe("—");
    expect(money(1234, "JPY", { ...jpy, decimal_places: 7 })).toBe("—");
    expect(money(1234, "JPY", { ...jpy, prefix: "\u202e" })).toBe("—");
  });
  it("canonicalizes exact price strings and enforces precision and integer bounds", () => {
    expect(canonicalAmount("1.2", 3)).toBe("1.200");
    expect(canonicalAmount("1", 0)).toBe("1");
    expect(canonicalAmount("9007199254740.991", 3)).toBe("9007199254740.991");
    for (const value of [
      "1.0001",
      "9007199254740.992",
      "1e3",
      "+1",
      "-1",
      "1,000",
      " 1",
      "01",
      "0",
      ".1",
      "1.",
    ])
      expect(() => canonicalAmount(value, 3)).toThrow();
    expect(() => canonicalAmount("1.0", 0)).toThrow();
  });
});

describe("registry and price responses", () => {
  it("keeps only declared metadata and excludes usage from the revisioned write payload", () => {
    const registry = readCurrencyRegistry({
      ...expanded(),
      secret: "ignore",
      currencies: expanded().currencies.map((c) => ({
        ...c,
        secret: "ignore",
      })),
    });
    expect(registry).not.toHaveProperty("secret");
    expect(registry.currencies[0]).not.toHaveProperty("secret");
    expect(currencyWritePayload(registry).currencies[0]).not.toHaveProperty(
      "precision_locked",
    );
    expect(currencyWritePayload(registry).revision).toBe(2);
  });
  it("rejects duplicate codes, disabled defaults, invalid precision and unsafe revisions", () => {
    for (const registry of [
      { ...expanded(), revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...expanded(), default_currency: "USD" },
      {
        ...expanded(),
        currencies: [...expanded().currencies, expanded().currencies[0]],
      },
      {
        ...expanded(),
        currencies: [{ ...expanded().currencies[0], enabled: false }],
      },
      {
        ...expanded(),
        currencies: [{ ...expanded().currencies[0], decimal_places: -1 }],
      },
      {
        ...expanded(),
        currencies: [{ ...expanded().currencies[0], name: "中".repeat(27) }],
      },
    ])
      expect(() => readCurrencyRegistry(registry)).toThrow();
  });
  it("validates independent exact price strings against their minor values and requested currency", () => {
    const response = {
      revision: 3,
      currency: "KWD",
      currency_format: kwd,
      plans: [
        {
          plan_id: "p1",
          plan_name: "Test",
          plan_available: true,
          amount: "1.2",
          amount_minor: 1200,
          available: true,
        },
      ],
    };
    expect(readPlanPrices(response, "KWD").plans[0]!.amount).toBe("1.200");
    expect(() => readPlanPrices(response, "JPY")).toThrow();
    expect(() =>
      readPlanPrices({
        ...response,
        plans: [{ ...response.plans[0], amount_minor: 1201 }],
      }),
    ).toThrow();
    expect(() =>
      readPlanPrices({
        ...response,
        plans: [{ ...response.plans[0], amount: "", amount_minor: 0 }],
      }),
    ).toThrow();
    expect(
      readPlanPrices({
        ...response,
        plans: [
          {
            ...response.plans[0],
            amount: "",
            amount_minor: 0,
            available: false,
          },
        ],
      }).plans[0]!.amount,
    ).toBe("");
  });
  it("accepts only bounded numeric obligation details", () => {
    const usage = {
      plan_prices: 1,
      orders: 2,
      invoices: 3,
      services: 4,
      pending_orders: 1,
      unpaid_invoices: 2,
      ongoing_services: 3,
    };
    expect(
      readCurrencyBlocker({ currency: "USD", usage, secret: "hidden" }),
    ).toEqual({ currency: "USD", usage });
    expect(
      readCurrencyBlocker({
        currency: "USD",
        usage: { ...usage, pending_orders: -1 },
      }),
    ).toBeUndefined();
  });
});

describe("registry-driven independent preferences", () => {
  it("starts with CNY only and discards a saved code absent from the installation", () => {
    localStorage.setItem("aster.currency", "USD");
    localStorage.setItem("aster.locale", "en");
    restorePreferences();
    applyCurrencyRegistry(structuredClone(defaultCurrencyRegistry));
    expect(enabledCurrencies.value.map((c) => c.code)).toEqual(["CNY"]);
    expect(currency.value).toBe("CNY");
    expect(locale.value).toBe("en");
    expect(setCurrency("USD")).toBe(false);
    expect(localStorage.getItem("aster.currency")).toBeNull();
  });
  it("restores a registered code only after the registry arrives and ignores stale registry responses", () => {
    localStorage.setItem("aster.currency", "JPY");
    restorePreferences();
    applyCurrencyRegistry(expanded());
    expect(currency.value).toBe("JPY");
    applyCurrencyRegistry(structuredClone(defaultCurrencyRegistry));
    expect(currency.value).toBe("JPY");
    setLocale("en");
    expect(currency.value).toBe("JPY");
    setCurrency("KWD");
    expect(locale.value).toBe("en");
  });
  it("uses changed defaults only without an override and falls back when the chosen currency is disabled", () => {
    applyCurrencyRegistry({ ...expanded(), default_currency: "JPY" });
    expect(currency.value).toBe("JPY");
    setCurrency("CNY");
    applyCurrencyRegistry({
      ...expanded(),
      revision: 3,
      default_currency: "KWD",
    });
    applyDefaults("en", "JPY");
    expect([currency.value, locale.value]).toEqual(["CNY", "en"]);
    applyCurrencyRegistry({
      ...expanded(),
      revision: 4,
      default_currency: "KWD",
      currencies: expanded().currencies.map((c) => ({
        ...c,
        enabled: c.code !== "CNY",
      })),
    });
    expect(currency.value).toBe("KWD");
    expect(enabledCurrencies.value.map((c) => c.code)).toEqual(["JPY", "KWD"]);
  });
});

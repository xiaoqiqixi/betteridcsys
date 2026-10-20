import { previewPlans } from "../src/lib/preview";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  readCheckoutSession,
  readOrderQuote,
  ApiError,
  date,
  money,
  setCsrf,
  statusLabel,
  statusTone,
} from "../src/lib/api";
import { defaultCurrencyRegistry } from "../src/lib/currencies";
const twoCurrencies = () => ({
  ...structuredClone(defaultCurrencyRegistry),
  default_currency: "USD",
  currencies: [
    ...structuredClone(defaultCurrencyRegistry.currencies),
    {
      code: "USD",
      name: "US Dollar",
      prefix: "$",
      suffix: "",
      decimal_places: 2,
      enabled: true,
      sort_order: 1,
      precision_locked: true,
    },
  ],
});
import {
  restorePreferences,
  setLocale,
  setCurrency,
  applyDefaults,
  locale,
  currency,
  applyCurrencyRegistry,
} from "../src/lib/i18n";
beforeEach(() => restorePreferences());
afterEach(() => vi.unstubAllGlobals());
it("builds a complete exact quote and refuses missing precision or unsafe revisions", () => {
  for (const [code, decimal_places] of [
    ["JPY", 0],
    ["KWD", 3],
  ] as const) {
    const plan = {
      ...previewPlans("CNY")[0]!,
      currency: code,
      price_minor: Number.MAX_SAFE_INTEGER,
      price_revision: 7,
      currency_format: {
        code,
        name: code,
        prefix: "",
        suffix: "",
        decimal_places,
      },
    };
    expect(readOrderQuote(plan)).toEqual({
      price_minor: Number.MAX_SAFE_INTEGER,
      decimal_places,
      price_revision: 7,
    });
    expect(() =>
      readOrderQuote({ ...plan, currency_format: undefined }),
    ).toThrow();
    for (const price_revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => readOrderQuote({ ...plan, price_revision })).toThrow();
  }
});

describe("exact money and status presentation", () => {
  it("formats integer cents without inventing precision", () => {
    expect(money(1201, "USD")).toBe("USD\u00a012.01");
    expect(money(0, "CNY")).toBe("CNY\u00a00.00");
    expect(money(Number.MAX_SAFE_INTEGER, "CNY")).toBe(
      "CNY\u00a090,071,992,547,409.91",
    );
    expect(money(-1, "USD")).toBe("-USD\u00a00.01");
    expect(money(12.1, "CNY")).toBe("—");
    expect(money(100, "EUR")).toBe("—");
    expect(money(100)).toBe("—");
  });
  it("uses UTC for billing dates", () => {
    expect(date("2026-11-01T00:30:00Z")).toBe("2026/11/01");
  });
  it("distinguishes unpaid, active and failed", () => {
    expect(statusLabel("unpaid")).toBe("待付款");
    expect(statusTone("active")).toBe("green");
    expect(statusTone("failed")).toBe("red");
  });
});
describe("API integrity", () => {
  it.each(["json", "primitive", "missing-data", "error"])(
    "retains the trusted request header and status for %s failures",
    async (kind) => {
      const requestId = "a".repeat(32);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: kind !== "error",
          status: 502,
          headers: new Headers({ "X-Request-ID": requestId }),
          json: async () => {
            if (kind === "json") throw new Error("not JSON");
            return kind === "primitive"
              ? null
              : kind === "missing-data"
                ? {}
                : {
                    error: {
                      code: "UNAVAILABLE",
                      message: "Safe",
                      request_id: "legacy-body-id",
                    },
                  };
          },
        }),
      );
      await expect(api("/audit-events")).rejects.toMatchObject({
        requestId,
        status: 502,
      });
    },
  );
  it.each([undefined, "invalid header", "A".repeat(32), "a".repeat(33)])(
    "ignores invalid request headers while preserving legacy body IDs (%s)",
    async (header) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 409,
          headers: new Headers(header ? { "X-Request-ID": header } : {}),
          json: async () => ({
            error: { code: "CONFLICT", message: "Safe", request_id: "abc" },
          }),
        }),
      );
      await expect(api("/audit-events")).rejects.toMatchObject({
        requestId: "abc",
        status: 409,
      });
    },
  );
  it.each([403, 409])(
    "retains response request identity and the actual %s status",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status,
          headers: new Headers({ "X-Request-ID": "b".repeat(32) }),
          json: async () => ({
            error: {
              code: "FORBIDDEN_OR_CONFLICT",
              message: "Safe",
              request_id: "abc",
            },
          }),
        }),
      );
      await expect(api("/audit-events")).rejects.toMatchObject({
        requestId: "b".repeat(32),
        status,
      });
    },
  );
  it("never uses an outgoing caller request ID as a response identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        headers: new Headers(),
        json: async () => {
          throw new Error("not JSON");
        },
      }),
    );
    await expect(
      api("/audit-events", "GET", undefined, {
        "X-Request-ID": "c".repeat(32),
      }),
    ).rejects.toMatchObject({ requestId: undefined, status: 502 });
  });
  it("does not invent a request ID for a network error", async () => {
    const failure = new TypeError("network unavailable");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));
    await expect(api("/audit-events")).rejects.toBe(failure);
  });
  it("sends CSRF and idempotency for writes", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "1" } }),
    });
    vi.stubGlobal("fetch", fetcher);
    setCsrf("test-token");
    await api(
      "/orders",
      "POST",
      { plan_id: "p1" },
      { "Idempotency-Key": "stable-key" },
    );
    const args = fetcher.mock.calls[0];
    expect(args[0]).toBe("/api/v1/orders");
    expect(args[1].headers["Accept-Language"]).toBe("zh-CN");
    expect(args[1].headers["X-CSRF-Token"]).toBe("test-token");
    expect(args[1].headers["Idempotency-Key"]).toBe("stable-key");
    expect(args[1].credentials).toBe("same-origin");
  });
  it("requests English errors independently from currency formatting", async () => {
    setLocale("en");
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });
    vi.stubGlobal("fetch", fetcher);
    await api("/session");
    expect(fetcher.mock.calls[0]![1].headers["Accept-Language"]).toBe("en");
    expect(statusLabel("unpaid")).toBe("Unpaid");
    expect(money(1201, "CNY")).toBe("CNY\u00a012.01");
  });
  it("fails closed on unavailable payment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: "PAYMENT_NOT_CONFIGURED", message: "Unavailable" },
        }),
      }),
    );
    await expect(
      api("/invoices/i1/checkout", "POST", {}),
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_CONFIGURED" });
  });
  it("does not treat malformed responses as success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("bad");
        },
      }),
    );
    await expect(api("/overview")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("checkout session integrity", () => {
  it.each(["zh-CN", "en"] as const)(
    "rejects incomplete and expired sessions without claiming a payment outcome in %s",
    (language) => {
      setLocale(language);
      const valid = {
        provider_id: "test",
        session_id: "session",
        checkout_url: "https://example.com/pay",
        expires_at: new Date(Date.now() + 60000).toISOString(),
      };
      for (const value of [
        null,
        {},
        { ...valid, provider_id: "" },
        { ...valid, session_id: "" },
        { ...valid, expires_at: "not-a-date" },
        { ...valid, expires_at: "2020-01-01T00:00:00Z" },
        { ...valid, checkout_url: "/relative" },
        { ...valid, checkout_url: "secret-value" },
      ]) {
        expect(() => readCheckoutSession(value)).toThrow(
          language === "en"
            ? "Check the original provider and refresh the invoice"
            : "请核对原渠道结果并刷新账单，勿重复支付",
        );
      }
      expect(readCheckoutSession(valid)).toEqual(valid);
    },
  );
});

describe("independent validated browser preferences", () => {
  it("rejects unsupported preferences and falls back from invalid saved values", () => {
    const storage = new Map([
      ["aster.locale", "fr"],
      ["aster.currency", "EUR"],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    restorePreferences();
    expect([locale.value, currency.value]).toEqual(["zh-CN", "CNY"]);
    expect(setLocale("fr")).toBe(false);
    expect(setCurrency("JPY")).toBe(false);
    applyCurrencyRegistry(twoCurrencies());
    applyDefaults("en", "USD");
    expect([locale.value, currency.value]).toEqual(["en", "USD"]);
    setLocale("zh-CN");
    expect(currency.value).toBe("USD");
    setCurrency("CNY");
    applyDefaults("en", "USD");
    expect([locale.value, currency.value]).toEqual(["zh-CN", "CNY"]);
  });
  it("keeps working when browser storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => restorePreferences()).not.toThrow();
    expect(setLocale("en")).toBe(true);
    applyCurrencyRegistry(twoCurrencies());
    expect(setCurrency("USD")).toBe(true);
    expect([locale.value, currency.value]).toEqual(["en", "USD"]);
  });
});

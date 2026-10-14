import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  readCheckoutSession,
  ApiError,
  date,
  money,
  setCsrf,
  statusLabel,
  statusTone,
} from "../src/lib/api";
import {
  restorePreferences,
  setLocale,
  setCurrency,
  applyDefaults,
  locale,
  currency,
} from "../src/lib/i18n";
beforeEach(() => restorePreferences());
afterEach(() => vi.unstubAllGlobals());
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
  it("rejects incomplete and expired sessions without exposing their content", () => {
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
      expect(() => readCheckoutSession(value)).toThrow("账单仍为待付款");
    }
    expect(readCheckoutSession(valid)).toEqual(valid);
  });
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
    expect(setCurrency("USD")).toBe(true);
    expect([locale.value, currency.value]).toEqual(["en", "USD"]);
  });
});

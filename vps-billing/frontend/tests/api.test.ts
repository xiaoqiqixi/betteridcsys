import { afterEach, describe, expect, it, vi } from "vitest";
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
afterEach(() => vi.unstubAllGlobals());
describe("exact money and status presentation", () => {
  it("formats integer cents without inventing precision", () => {
    expect(money(1201)).toBe("$12.01");
    expect(money(0)).toBe("$0.00");
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
    expect(args[1].headers["X-CSRF-Token"]).toBe("test-token");
    expect(args[1].headers["Idempotency-Key"]).toBe("stable-key");
    expect(args[1].credentials).toBe("same-origin");
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

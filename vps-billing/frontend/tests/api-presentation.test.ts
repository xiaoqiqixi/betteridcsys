import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "../src/services/api";
import type { Locale } from "../src/types/idc";

const cases = [
  {
    name: "malformed successful JSON",
    code: "INVALID_RESPONSE",
    status: 200,
    response: () => new Response("<html>private-upstream</html>"),
  },
  {
    name: "missing successful response envelope",
    code: "INVALID_RESPONSE",
    status: 200,
    response: () => Response.json({ private_diagnostic: "private-upstream" }),
  },
  {
    name: "gateway error",
    code: "SERVICE_UNAVAILABLE",
    status: 503,
    response: () => new Response("private-upstream", { status: 503 }),
  },
  {
    name: "unknown server failure",
    code: "UNKNOWN_FAILURE",
    status: 500,
    response: () =>
      Response.json(
        { error: { code: "UNKNOWN_FAILURE", message: "private-upstream" } },
        { status: 500 },
      ),
  },
  {
    name: "network interruption",
    code: "NETWORK_ERROR",
    status: 0,
    response: (): Response => {
      throw new Error("private-upstream");
    },
  },
];
describe.each<Locale>(["zh-CN", "en"])(
  "safe API presentation in %s",
  (locale) => {
    it.each(cases)(
      "read: $name offers reload without write-result instructions",
      async (entry) => {
        const fetcher = vi.fn(async () => entry.response());
        const client = createApiClient({
          locale: () => locale,
          onSession: vi.fn(),
          fetcher,
        });
        const error = await client
          .read("/overview")
          .catch((cause: unknown) => cause);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({
          code: entry.code,
          status: entry.status,
          uncertain: false,
        });
        expect((error as ApiError).message).toMatch(
          locale === "en" ? /reload/i : /重新加载/,
        );
        expect((error as ApiError).message).not.toMatch(
          /核对|重复提交|操作结果|unconfirmed|submitting|private-upstream|<html>/,
        );
        expect(fetcher).toHaveBeenCalledTimes(1);
      },
    );
    it.each(cases)(
      "write: $name keeps the outcome uncertain and never retries",
      async (entry) => {
        const fetcher = vi.fn(async (url: RequestInfo | URL) =>
          String(url).endsWith("/session")
            ? Response.json({
                data: { user: null, csrf_token: "synthetic", demo_mode: false },
              })
            : entry.response(),
        );
        const client = createApiClient({
          locale: () => locale,
          onSession: vi.fn(),
          fetcher,
        });
        const error = await client
          .write("/synthetic-command", { value: "synthetic" })
          .catch((cause: unknown) => cause);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({
          code: entry.code,
          status: entry.status,
          uncertain: true,
        });
        expect((error as ApiError).message).toMatch(
          locale === "en" ? /check/i : /核对/,
        );
        expect((error as ApiError).message).not.toMatch(
          /重新加载|reload|private-upstream|<html>/,
        );
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(
          fetcher.mock.calls.filter(([url]) =>
            String(url).endsWith("/synthetic-command"),
          ),
        ).toHaveLength(1);
      },
    );
    it("does not let a read presentation hint hide an explicitly uncertain outcome", () => {
      const error = new ApiError("INVALID_RESPONSE", 200, {
        locale,
        context: "read",
        uncertain: true,
      });
      expect(error.uncertain).toBe(true);
      expect(error.message).toMatch(
        locale === "en" ? /unconfirmed/i : /尚未确认/,
      );
      expect(error.message).not.toMatch(/reload|重新加载/);
    });
    it("retains authentication and permission meaning rather than replacing it with reload", () => {
      expect(
        new ApiError("AUTH_REQUIRED", 401, { locale, context: "read" }).message,
      ).toBe(locale === "en" ? "Please sign in." : "请先登录。");
      expect(
        new ApiError("FORBIDDEN", 403, { locale, context: "read" }).message,
      ).toBe(
        locale === "en"
          ? "This account is not authorized."
          : "当前身份无权执行此操作。",
      );
    });
  },
);

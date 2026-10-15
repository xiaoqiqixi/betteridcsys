import { beforeEach, describe, expect, it } from "vitest";
import { ApiError, type Invoice, type Order } from "../src/lib/api";
import {
  cancellationError,
  cancellationIsUncertain,
  readCancellationReason,
  readCancellationResult,
  type CancellationResult,
} from "../src/lib/cancellation";
import { restorePreferences, setLocale } from "../src/lib/i18n";

const order: Order = {
  id: "a".repeat(32),
  number: "ORD-aaaaaaaaaaaa",
  plan_name: "Cloud monthly",
  status: "pending_payment",
  total_minor: 12345,
  currency: "CNY",
  currency_format: {
    code: "CNY",
    name: "人民币",
    prefix: "¥",
    suffix: "",
    decimal_places: 2,
  },
  plan_snapshot: {
    plan_id: "plan-1",
    name: "Cloud monthly",
    cpu: 2,
    memory_gb: 4,
    disk_gb: 60,
    transfer_tb: 2,
    region: "Hong Kong",
    billing_cycle: "monthly",
  },
  issuer: {
    name: "Original issuer",
    address: "Original address",
    support_email: "support@example.test",
  },
  created_at: "2026-10-15T10:00:00Z",
};
const invoice: Invoice = {
  id: "b".repeat(32),
  number: "INV-aaaaaaaaaaaa",
  order_id: order.id,
  status: "unpaid",
  amount_minor: order.total_minor,
  currency: order.currency,
  currency_format: structuredClone(order.currency_format),
  issuer: structuredClone(order.issuer),
  issued_at: order.created_at,
  due_at: "2026-10-22T10:00:00Z",
};
function cancelledPair(): CancellationResult {
  return {
    order: { ...structuredClone(order), status: "cancelled" },
    invoice: { ...structuredClone(invoice), status: "void" },
  };
}

beforeEach(() => {
  restorePreferences();
  setLocale("zh-CN");
});

describe("cancellation reason validation", () => {
  it.each([
    ["ASCII", "a", 500, 501],
    ["Chinese", "中", 166, 167],
    ["emoji", "😀", 125, 126],
  ] as const)(
    "uses trimmed UTF-8 bytes at the %s boundary",
    (_label, character, validCount, invalidCount) => {
      const valid = character.repeat(validCount);
      expect(readCancellationReason(` \t${valid}\r\n `)).toBe(valid);
      expect(() =>
        readCancellationReason(` ${character.repeat(invalidCount)} `),
      ).toThrowError(ApiError);
    },
  );

  it("keeps ordinary punctuation and single-line Unicode text", () => {
    expect(
      readCancellationReason("  方案调整 / Changed plan — 费用 ¥123.45 😀  "),
    ).toBe("方案调整 / Changed plan — 费用 ¥123.45 😀");
  });

  it.each([
    ["empty", ""],
    ["whitespace", " \r\n\t "],
    ["opening angle", "reason <tag"],
    ["closing angle", "reason >tag"],
    ["newline", "first\nsecond"],
    ["carriage return", "first\rsecond"],
    ["tab", "first\tsecond"],
    ["NUL", "first\u0000second"],
    ["DEL", "first\u007fsecond"],
    ["C1 control", "first\u0085second"],
    ["bidi override", "first\u202esecond"],
    ["zero-width space", "first\u200bsecond"],
    ["zero-width joiner", "first\u200dsecond"],
    ["BOM inside text", "first\ufeffsecond"],
    ["unpaired high surrogate", "first\ud83dsecond"],
    ["unpaired low surrogate", "first\ude00second"],
  ])("rejects %s without returning the submitted content", (_label, value) => {
    expect(() => readCancellationReason(value)).toThrowError(
      expect.objectContaining({ code: "INVALID_CANCELLATION" }),
    );
  });
});

describe("cancellation result integrity", () => {
  it("accepts the same original pair with cancelled and void statuses", () => {
    const result = cancelledPair();
    expect(readCancellationResult(result, order, invoice)).toEqual(result);
    expect(readCancellationResult(result, order)).toEqual(result);
    expect(order.status).toBe("pending_payment");
    expect(invoice.status).toBe("unpaid");
  });

  it("accepts equivalent nested snapshots regardless of JSON key order", () => {
    const reorder = (value: unknown): unknown =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, item]) => [key, reorder(item)]),
          )
        : value;
    const result = reorder(cancelledPair());
    expect(readCancellationResult(result, order, invoice)).toEqual(
      cancelledPair(),
    );
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string", "provider secret body"],
    ["array", []],
    ["empty object", {}],
    ["envelope instead of data", { data: cancelledPair() }],
    ["missing order", { invoice: cancelledPair().invoice }],
    ["missing invoice", { order: cancelledPair().order }],
    ["null order", { ...cancelledPair(), order: null }],
    ["null invoice", { ...cancelledPair(), invoice: null }],
  ])("does not confirm a malformed 200 response: %s", (_label, value) => {
    expect(() => readCancellationResult(value, order, invoice)).toThrowError(
      expect.objectContaining({
        code: "INVALID_RESPONSE",
        message: "Unconfirmed cancellation result",
      }),
    );
  });

  const corruptions: [string, (pair: CancellationResult) => void][] = [
    [
      "other order ID",
      (pair) => {
        pair.order.id = "c".repeat(32);
      },
    ],
    [
      "other order number",
      (pair) => {
        pair.order.number = "ORD-other";
      },
    ],
    [
      "order still pending",
      (pair) => {
        pair.order.status = "pending_payment";
      },
    ],
    [
      "order marked paid",
      (pair) => {
        pair.order.status = "paid";
      },
    ],
    [
      "other invoice ID",
      (pair) => {
        pair.invoice.id = "d".repeat(32);
      },
    ],
    [
      "empty invoice ID",
      (pair) => {
        pair.invoice.id = "";
      },
    ],
    [
      "other invoice number",
      (pair) => {
        pair.invoice.number = "INV-other";
      },
    ],
    [
      "empty invoice number",
      (pair) => {
        pair.invoice.number = "";
      },
    ],
    [
      "invoice belongs to another order",
      (pair) => {
        pair.invoice.order_id = "e".repeat(32);
      },
    ],
    [
      "invoice still unpaid",
      (pair) => {
        pair.invoice.status = "unpaid";
      },
    ],
    [
      "invoice marked paid",
      (pair) => {
        pair.invoice.status = "paid";
      },
    ],
    [
      "order amount",
      (pair) => {
        pair.order.total_minor++;
      },
    ],
    [
      "invoice amount",
      (pair) => {
        pair.invoice.amount_minor++;
      },
    ],
    [
      "both amounts changed together",
      (pair) => {
        pair.order.total_minor++;
        pair.invoice.amount_minor++;
      },
    ],
    [
      "order currency",
      (pair) => {
        pair.order.currency = "JPY";
      },
    ],
    [
      "invoice currency",
      (pair) => {
        pair.invoice.currency = "JPY";
      },
    ],
    [
      "both currencies changed together",
      (pair) => {
        pair.order.currency = "JPY";
        pair.invoice.currency = "JPY";
      },
    ],
    [
      "order precision",
      (pair) => {
        pair.order.currency_format!.decimal_places = 0;
      },
    ],
    [
      "invoice precision",
      (pair) => {
        pair.invoice.currency_format!.decimal_places = 0;
      },
    ],
    [
      "order currency presentation",
      (pair) => {
        pair.order.currency_format!.prefix = "$";
      },
    ],
    [
      "invoice currency presentation",
      (pair) => {
        pair.invoice.currency_format!.suffix = " changed";
      },
    ],
    [
      "missing order currency snapshot",
      (pair) => {
        delete pair.order.currency_format;
      },
    ],
    [
      "missing invoice currency snapshot",
      (pair) => {
        delete pair.invoice.currency_format;
      },
    ],
    [
      "plan ID",
      (pair) => {
        pair.order.plan_snapshot!.plan_id = "other-plan";
      },
    ],
    [
      "plan name snapshot",
      (pair) => {
        pair.order.plan_snapshot!.name = "Other plan";
      },
    ],
    [
      "plan specification",
      (pair) => {
        pair.order.plan_snapshot!.cpu++;
      },
    ],
    [
      "billing cycle",
      (pair) => {
        pair.order.plan_snapshot!.billing_cycle = "annual" as "monthly";
      },
    ],
    [
      "missing plan snapshot",
      (pair) => {
        delete pair.order.plan_snapshot;
      },
    ],
    [
      "order issuer",
      (pair) => {
        pair.order.issuer!.name = "New issuer";
      },
    ],
    [
      "invoice issuer",
      (pair) => {
        pair.invoice.issuer!.address = "New address";
      },
    ],
    [
      "invoice issuer contact",
      (pair) => {
        pair.invoice.issuer!.support_email = "other@example.test";
      },
    ],
    [
      "missing order issuer",
      (pair) => {
        delete pair.order.issuer;
      },
    ],
    [
      "missing invoice issuer",
      (pair) => {
        delete pair.invoice.issuer;
      },
    ],
  ];
  it.each(corruptions)("rejects a changed %s", (_label, corrupt) => {
    const result = cancelledPair();
    corrupt(result);
    expect(() => readCancellationResult(result, order, invoice)).toThrowError(
      expect.objectContaining({ code: "INVALID_RESPONSE" }),
    );
  });
});

describe("safe cancellation errors", () => {
  const labels = [
    ["INVALID_BODY", "取消请求无效", "The cancellation request is invalid"],
    ["INVALID_CANCELLATION", "单行纯文本原因", "single-line plain-text reason"],
    ["NOT_FOUND", "找不到可访问的订单", "No accessible order was found"],
    [
      "CANCELLATION_STATE_CONFLICT",
      "订单当前状态不允许取消",
      "can no longer be cancelled",
    ],
    [
      "CANCELLATION_UNAVAILABLE",
      "当前支付配置不支持此取消操作",
      "current payment configuration",
    ],
    ["AUTH_REQUIRED", "请重新登录后核对订单", "Sign in again"],
    ["UNAUTHORIZED", "请重新登录后核对订单", "Sign in again"],
    ["FORBIDDEN", "你无权取消此订单", "You cannot cancel this order"],
    ["CSRF_FAILED", "会话验证失败", "Session verification failed"],
  ];
  it.each(labels)("maps %s safely in both languages", (code, zh, en) => {
    const error = new ApiError(
      code,
      "<provider-body>password=secret</provider-body>",
      "request-123",
      409,
      { body: "raw-provider-details" },
    );
    for (const [locale, expected, requestLabel] of [
      ["zh-CN", zh, "请求编号"],
      ["en", en, "Request ID"],
    ]) {
      setLocale(locale);
      const message = cancellationError(error);
      expect(message).toContain(expected);
      expect(message).toContain(`${requestLabel} request-123`);
      expect(message).not.toMatch(
        /provider|password|secret|raw-provider-details/,
      );
    }
  });

  it.each([
    new ApiError(
      "UNKNOWN_PROVIDER_ERROR",
      "raw-provider-secret",
      undefined,
      502,
    ),
    new ApiError("INVALID_RESPONSE", "raw-provider-secret", undefined, 200),
    new Error("raw-provider-secret"),
    { message: "raw-provider-secret" },
    null,
  ])("uses a safe unconfirmed fallback without a request ID", (error) => {
    for (const [locale, expected] of [
      ["zh-CN", "无法确认取消结果"],
      ["en", "The cancellation result is unconfirmed"],
    ]) {
      setLocale(locale);
      const message = cancellationError(error);
      expect(message).toContain(expected);
      expect(message).not.toMatch(/raw-provider-secret|请求编号|Request ID/);
    }
  });
});

describe("ambiguous cancellation outcomes", () => {
  it.each([
    ["network failure", new TypeError("fetch failed")],
    ["unknown thrown value", "connection lost"],
    ["null thrown value", null],
    ["API failure without HTTP status", new ApiError("NOT_FOUND", "body")],
    [
      "malformed successful response",
      new ApiError("INVALID_RESPONSE", "body", undefined, 200),
    ],
    [
      "malformed response with 4xx status",
      new ApiError("INVALID_RESPONSE", "body", undefined, 400),
    ],
    ["HTTP 500", new ApiError("INTERNAL", "body", undefined, 500)],
    ["HTTP 503", new ApiError("UNAVAILABLE", "body", undefined, 503)],
    ["HTTP 599", new ApiError("UNKNOWN", "body", undefined, 599)],
  ])("retains the original attempt for %s", (_label, error) => {
    expect(cancellationIsUncertain(error)).toBe(true);
  });

  it.each([
    ["INVALID_BODY", 400],
    ["INVALID_CANCELLATION", 400],
    ["AUTH_REQUIRED", 401],
    ["FORBIDDEN", 403],
    ["CSRF_FAILED", 403],
    ["NOT_FOUND", 404],
    ["CANCELLATION_STATE_CONFLICT", 409],
    ["CANCELLATION_UNAVAILABLE", 409],
    ["RATE_LIMITED", 429],
  ] as const)(
    "treats explicit %s HTTP %i as confirmed failure",
    (code, status) => {
      expect(
        cancellationIsUncertain(new ApiError(code, "body", undefined, status)),
      ).toBe(false);
    },
  );
});

import { ApiError, type Invoice, type Order } from "./api";
import { tr } from "./i18n";

export interface CancellationResult {
  order: Order;
  invoice: Invoice;
}

export function readCancellationReason(value: string): string {
  const reason = value.trim();
  if (
    !reason ||
    new TextEncoder().encode(reason).length > 500 ||
    /[<>\p{Cc}\p{Cf}\p{Cs}]/u.test(reason)
  )
    throw new ApiError(
      "INVALID_CANCELLATION",
      tr(
        "请填写单行纯文本原因，不含尖括号，去除首尾空白后最多 500 个 UTF-8 字节。",
        "Enter a single-line plain-text reason without angle brackets, at most 500 UTF-8 bytes after trimming whitespace.",
      ),
    );
  return reason;
}

function snapshot(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

// A malformed or unrelated 200 response cannot confirm a financial mutation.
export function readCancellationResult(
  value: unknown,
  expected: Order,
  expectedInvoice?: Invoice,
): CancellationResult {
  const result = value as Partial<CancellationResult> | null;
  const order = result?.order;
  const invoice = result?.invoice;
  if (
    !order ||
    !invoice ||
    order.id !== expected.id ||
    order.number !== expected.number ||
    order.status !== "cancelled" ||
    order.total_minor !== expected.total_minor ||
    order.currency !== expected.currency ||
    snapshot(order.currency_format) !== snapshot(expected.currency_format) ||
    snapshot(order.plan_snapshot) !== snapshot(expected.plan_snapshot) ||
    snapshot(order.issuer) !== snapshot(expected.issuer) ||
    typeof invoice.id !== "string" ||
    !invoice.id ||
    typeof invoice.number !== "string" ||
    !invoice.number ||
    invoice.order_id !== expected.id ||
    invoice.status !== "void" ||
    invoice.currency !== expected.currency ||
    invoice.amount_minor !== expected.total_minor ||
    (expectedInvoice &&
      (invoice.id !== expectedInvoice.id ||
        invoice.number !== expectedInvoice.number ||
        snapshot(invoice.currency_format) !==
          snapshot(expectedInvoice.currency_format) ||
        snapshot(invoice.issuer) !== snapshot(expectedInvoice.issuer)))
  )
    throw new ApiError("INVALID_RESPONSE", "Unconfirmed cancellation result");
  return { order, invoice };
}

export function cancellationError(
  error: unknown,
  administrator = false,
): string {
  const labels: Record<string, [string, string]> = {
    INVALID_BODY: [
      "取消请求无效，请重新检查后提交。",
      "The cancellation request is invalid. Review it before submitting.",
    ],
    INVALID_CANCELLATION: [
      "请填写单行纯文本原因，不含尖括号，去除首尾空白后最多 500 个 UTF-8 字节。",
      "Enter a single-line plain-text reason without angle brackets, at most 500 UTF-8 bytes after trimming whitespace.",
    ],
    NOT_FOUND: [
      "找不到可访问的订单，请刷新订单记录。",
      "No accessible order was found. Refresh order history.",
    ],
    CANCELLATION_STATE_CONFLICT: [
      "订单当前状态不允许取消，请刷新订单和账单记录。",
      "The order can no longer be cancelled in its current state. Refresh orders and invoices.",
    ],
    CANCELLATION_UNAVAILABLE: administrator
      ? [
          "无法排除未确认的支付处理，请先核对支付记录；当前不能安全取消。",
          "Unconfirmed payment processing cannot be ruled out. Check payment records before proceeding; this order cannot currently be cancelled safely.",
        ]
      : [
          "当前支付配置不支持此取消操作，请联系运营方。",
          "Cancellation is unavailable with the current payment configuration. Contact the operator.",
        ],
    AUTH_REQUIRED: [
      "请重新登录后核对订单。",
      "Sign in again to check the order.",
    ],
    UNAUTHORIZED: [
      "请重新登录后核对订单。",
      "Sign in again to check the order.",
    ],
    FORBIDDEN: ["你无权取消此订单。", "You cannot cancel this order."],
    CSRF_FAILED: [
      "会话验证失败，请刷新页面后核对订单。",
      "Session verification failed. Refresh the page and check the order.",
    ],
  };
  const label = error instanceof ApiError ? labels[error.code] : undefined;
  const message = label
    ? tr(...label)
    : tr(
        "无法确认取消结果，请核对订单记录后再决定是否重试。",
        "The cancellation result is unconfirmed. Check order history before deciding whether to retry.",
      );
  return (
    message +
    (error instanceof ApiError && error.requestId
      ? tr(" · 请求编号 ", " · Request ID ") + error.requestId
      : "")
  );
}

export function cancellationIsUncertain(error: unknown): boolean {
  return (
    !(error instanceof ApiError) ||
    error.code === "INVALID_RESPONSE" ||
    error.status === undefined ||
    error.status >= 500
  );
}

import { locale, tr, intlLocale, isCurrency } from "./i18n";
export interface User {
  id: string;
  email: string;
  name: string;
  role: "customer" | "admin";
}
export interface Session {
  user: User | null;
  csrf_token: string;
  demo_mode: boolean;
}
export interface Plan {
  id: string;
  name: string;
  description: string;
  cpu: number;
  memory_gb: number;
  disk_gb: number;
  transfer_tb: number;
  region: string;
  price_minor: number;
  currency: string;
  available: boolean;
}
export interface Service {
  id: string;
  name: string;
  plan_name: string;
  region: string;
  ipv4: string;
  status: string;
  next_due_at: string;
  price_minor: number;
  currency: string;
  cpu: number;
  memory_gb: number;
  disk_gb: number;
}
export interface Order {
  issuer?: InvoiceIdentity;
  id: string;
  number: string;
  plan_name: string;
  status: string;
  total_minor: number;
  currency: string;
  created_at: string;
  service_id?: string;
}
export interface InvoiceIdentity {
  name: string;
  address: string;
  support_email: string;
}
export interface Invoice {
  issuer?: InvoiceIdentity;
  id: string;
  number: string;
  order_id: string;
  status: string;
  amount_minor: number;
  currency: string;
  issued_at: string;
  due_at: string;
  paid_at?: string;
  line_items?: {
    description: string;
    amount_minor: number;
    quantity?: number;
  }[];
}
export interface Audit {
  id: string;
  action: string;
  target: string;
  created_at: string;
  actor_email: string;
  detail: string;
}
export interface Overview {
  active_services: number;
  pending_invoices: number;
  unpaid_total_minor: number;
  monthly_total_minor: number;
  currency: string;
  recent_orders: Order[];
}
export interface AdminOverview {
  customers: number;
  total_services: number;
  unpaid_invoices: number;
  unpaid_total_minor: number;
  revenue_minor: number;
  currency: string;
}
let csrf = "";
export function setCsrf(token: string) {
  csrf = token;
}
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public requestId?: string,
    public status?: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Accept-Language": locale.value,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
      ...extraHeaders,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  let result: {
    data?: T;
    error?: { code: string; message: string; request_id?: string };
  };
  try {
    result = await response.json();
  } catch {
    throw new ApiError(
      "INVALID_RESPONSE",
      tr(
        "服务暂时不可用，请稍后重试。",
        "The service is temporarily unavailable. Please try again.",
      ),
    );
  }
  if (!result || typeof result !== "object") {
    throw new ApiError(
      "INVALID_RESPONSE",
      tr(
        "服务响应格式不正确，请稍后重试。",
        "The server returned an invalid response. Please try again.",
      ),
    );
  }
  if (!response.ok || result.error)
    throw new ApiError(
      result.error?.code || "REQUEST_FAILED",
      result.error?.message ||
        tr(
          "请求未完成，请重试。",
          "The request did not complete. Please try again.",
        ),
      result.error?.request_id,
      response.status,
    );
  if (!("data" in result)) {
    throw new ApiError(
      "INVALID_RESPONSE",
      tr(
        "服务响应缺少数据，请稍后重试。",
        "The response is missing data. Please try again.",
      ),
    );
  }
  return result.data as T;
}
// An amount is formatted only in its recorded currency; the preference never relabels it.
export const money = (minor: number, recordedCurrency?: string) => {
  if (!Number.isSafeInteger(minor) || !isCurrency(recordedCurrency)) return "—";
  const amount = BigInt(minor);
  const magnitude = amount < 0n ? -amount : amount;
  const whole = amount / 100n;
  const fraction = String(magnitude % 100n).padStart(2, "0");
  // Dividing a large Number by 100 can round away a valid cent. Format the
  // integer part exactly and substitute the recorded two-digit minor units.
  return new Intl.NumberFormat(intlLocale(), {
    style: "currency",
    currency: recordedCurrency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .formatToParts(amount < 0n && whole === 0n ? -0 : whole)
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("");
};
export const date = (value: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(intlLocale(), {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: "UTC",
      }).format(new Date(value))
    : "—";
const labels: Record<string, [string, string]> = {
  active: ["运行中", "Active"],
  pending: ["待处理", "Pending"],
  pending_payment: ["待付款", "Unpaid"],
  unpaid: ["待付款", "Unpaid"],
  paid: ["已付款", "Paid"],
  open: ["待付款", "Unpaid"],
  provisioning: ["开通中", "Provisioning"],
  completed: ["已完成", "Completed"],
  cancelled: ["已取消", "Cancelled"],
  void: ["已作废", "Void"],
  overdue: ["已逾期", "Overdue"],
  suspended: ["已暂停", "Suspended"],
  failed: ["失败", "Failed"],
  pending_provisioning: ["待开通", "Awaiting provisioning"],
};
export const statusLabel = (status: string) => {
  const label = labels[status];
  return label ? tr(...label) : status;
};
export const statusTone = (status: string) =>
  ["active", "paid", "completed"].includes(status)
    ? "green"
    : ["failed", "overdue", "suspended"].includes(status)
      ? "red"
      : ["cancelled", "void"].includes(status)
        ? "gray"
        : "amber";

export interface CheckoutSession {
  provider_id: string;
  session_id: string;
  checkout_url: string;
  expires_at: string;
}
// Server also enforces its configured provider-host allowlist. The browser
// independently rejects malformed/expired sessions and non-HTTPS destinations.
export function readCheckoutSession(value: unknown): CheckoutSession {
  const invalid = () => {
    throw new ApiError(
      "INVALID_CHECKOUT",
      tr(
        "支付服务未提供有效的结账入口。本次未完成付款，账单仍为待付款。",
        "No valid checkout link was returned. No payment was completed; the invoice remains unpaid.",
      ),
    );
  };
  if (!value || typeof value !== "object") return invalid();
  const v = value as Record<string, unknown>;
  if (
    typeof v.provider_id !== "string" ||
    !v.provider_id.trim() ||
    typeof v.session_id !== "string" ||
    !v.session_id.trim() ||
    typeof v.checkout_url !== "string" ||
    typeof v.expires_at !== "string"
  )
    return invalid();
  let url: URL;
  try {
    url = new URL(v.checkout_url);
  } catch {
    return invalid();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname ||
    !Number.isFinite(Date.parse(v.expires_at)) ||
    Date.parse(v.expires_at) <= Date.now()
  )
    return invalid();
  return {
    provider_id: v.provider_id,
    session_id: v.session_id,
    checkout_url: url.href,
    expires_at: v.expires_at,
  };
}

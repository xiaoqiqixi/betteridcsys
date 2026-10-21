import type { Locale, Query, Session } from "../types/idc";
import { validCurrencyFormat, validMinor } from "../types/idc";
import { validCatalogTaxonomy } from "./catalog-taxonomy";

const REQUEST_ID = /^[a-f0-9]{32}$/;
const SAFE_ERRORS: Record<string, [string, string]> = {
  AUTH_REQUIRED: ["请先登录。", "Please sign in."],
  INVALID_CREDENTIALS: ["邮箱或密码不正确。", "Incorrect email or password."],
  FORBIDDEN: ["当前身份无权执行此操作。", "This account is not authorized."],
  CSRF_INVALID: [
    "会话验证已失效，请重新载入会话；未自动重试。",
    "Session verification expired. Reload the session; no automatic retry.",
  ],
  NOT_FOUND: [
    "记录不存在或不属于当前账户。",
    "Record not found or not accessible.",
  ],
  PRICE_CHANGED: [
    "报价已变化，请重新读取并确认，未自动下单。",
    "The quote changed. Reload and confirm; no order was retried.",
  ],
  IDEMPOTENCY_CONFLICT: [
    "该下单标识已用于不同请求，请先核对原订单。",
    "This order key belongs to another request. Check the original order.",
  ],
  PAYMENT_NOT_CONFIGURED: [
    "支付渠道未配置；未付款，也未开通资源。",
    "Payment is not configured. No payment or provisioning occurred.",
  ],
  RATE_LIMITED: [
    "操作过于频繁，请按等待时间稍后再试。",
    "Too many requests. Respect the waiting time before trying again.",
  ],
  STALE_RESPONSE: [
    "身份或模式已变化，已丢弃旧请求结果。",
    "The account or mode changed; the old response was discarded.",
  ],
  INVALID_RESPONSE: [
    "服务器返回了无法确认的数据，请勿视为成功。",
    "The response could not be verified. Do not treat it as success.",
  ],
  REQUEST_FAILED: [
    "请求未完成，请稍后核对。",
    "The request did not complete. Check its result before trying again.",
  ],
  NETWORK_ERROR: [
    "网络请求未完成；写入结果可能不确定，请先核对。",
    "The network request did not complete; a write may be uncertain. Check first.",
  ],
  DEMO_OPERATION_UNAVAILABLE: [
    "演示模式不执行此操作，请连接真实接口后按权限操作。",
    "This operation is unavailable in demo mode. Use the real API with appropriate permissions.",
  ],
  DEMO_AUTH_UNAVAILABLE: [
    "当前为合成演示，请使用演示身份切换；不会发送登录凭据。",
    "This is a synthetic preview. Use the demo account switch; no credentials are submitted.",
  ],
  SESSION_REFRESH_FAILED: [
    "操作已提交，但未能重新确认会话。请先重新读取会话，不要重复提交。",
    "The operation was submitted, but the session could not be verified. Reload the session before submitting again.",
  ],
  INVALID_REQUEST: [
    "请求路径或请求头不符合接口约束。",
    "The request path or headers do not match the API contract.",
  ],
  INVALID_BODY: [
    "输入不完整或不符合字段约束，请检查后再提交。",
    "The input is incomplete or invalid. Check the fields before submitting.",
  ],
  INVALID_CATALOG: [
    "商品规格、报价或上架条件不完整，请检查。",
    "Check the product specifications, prices, and publishing requirements.",
  ],
  INVALID_ACCOUNT: [
    "账户输入不符合要求，请检查名称、邮箱、角色、密码及原因。",
    "Check the account name, email, role, password, and reason.",
  ],
};
export class ApiError extends Error {
  code: string;
  status: number;
  requestId?: string;
  details?: unknown;
  uncertain: boolean;
  retryAfter?: string;
  constructor(
    code: string,
    status = 0,
    options: {
      locale?: Locale;
      requestId?: string;
      details?: unknown;
      uncertain?: boolean;
      retryAfter?: string;
    } = {},
  ) {
    const locale = options.locale ?? "zh-CN";
    const known = SAFE_ERRORS[code];
    const conflict =
      code.endsWith("_CONFLICT") ||
      [
        "CURRENCY_PRECISION_LOCKED",
        "CURRENCY_DISABLED",
        "CURRENCY_IN_USE",
        "SELF_ACCOUNT_CHANGE",
        "LAST_ACTIVE_ADMIN",
        "INVOICE_NOT_PAYABLE",
        "PAYMENT_PENDING",
        "ORDER_NOT_CANCELLABLE",
      ].includes(code);
    const message =
      known?.[locale === "en" ? 1 : 0] ??
      (conflict
        ? locale === "en"
          ? "The current state conflicts with this operation. Reload and confirm; nothing was automatically retried."
          : "当前状态不允许此操作或版本已变化，请重读并确认；未自动重试。"
        : locale === "en"
          ? "The operation could not be confirmed. Check the current record."
          : "无法确认操作结果，请核对当前记录。");
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.requestId = options.requestId;
    this.details = options.details;
    this.uncertain = options.uncertain ?? false;
    this.retryAfter = options.retryAfter;
  }
}
export function staleResponse(uncertain = false): ApiError {
  return new ApiError("STALE_RESPONSE", 0, { uncertain });
}

function endpoint(path: string, query?: Query): string {
  if (
    !/^\/(?:[A-Za-z0-9_.~!$&'()*+,;=:@%\-]+\/?)*$/.test(path) ||
    path.startsWith("//")
  )
    throw new ApiError("INVALID_REQUEST");
  try {
    for (const segment of path.split("/")) {
      const decoded = decodeURIComponent(segment);
      if (
        decoded === "." ||
        decoded === ".." ||
        /[\\/\u0000-\u001f\u007f]/.test(decoded)
      )
        throw new Error("path");
    }
  } catch {
    throw new ApiError("INVALID_REQUEST");
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {}))
    if (value !== undefined) params.set(key, String(value));
  return `/api/v1${path}${params.size ? `?${params}` : ""}`;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function isSession(value: unknown): value is Session {
  if (
    !object(value) ||
    typeof value.csrf_token !== "string" ||
    !value.csrf_token ||
    typeof value.demo_mode !== "boolean"
  )
    return false;
  const user = value.user;
  return (
    user === null ||
    (object(user) &&
      typeof user.id === "string" &&
      typeof user.name === "string" &&
      typeof user.email === "string" &&
      (user.role === "customer" || user.role === "admin"))
  );
}

const strings = (
  value: unknown,
  keys: string[],
): value is Record<string, unknown> =>
  object(value) && keys.every((key) => typeof value[key] === "string");
const integer = (value: unknown, positive = false) =>
  validMinor(value) && (positive ? value > 0 : value >= 0);
const list = (value: unknown, item: (entry: unknown) => boolean) =>
  Array.isArray(value) && value.every(item);
function moneyRecord(value: unknown, key: string) {
  return (
    object(value) &&
    validMinor(value[key]) &&
    validCurrencyFormat(value.currency_format) &&
    value.currency === value.currency_format.code
  );
}
function validUser(value: unknown): boolean {
  return (
    strings(value, ["id", "name", "email"]) &&
    (value.role === "customer" || value.role === "admin")
  );
}
function validAccount(value: unknown): boolean {
  return (
    validUser(value) &&
    object(value) &&
    typeof value.disabled === "boolean" &&
    integer(value.revision, true)
  );
}
function validOrder(value: unknown): boolean {
  return (
    strings(value, [
      "id",
      "number",
      "plan_name",
      "status",
      "currency",
      "hostname",
      "created_at",
    ]) && moneyRecord(value, "total_minor")
  );
}
function validInvoice(value: unknown): boolean {
  return (
    strings(value, [
      "id",
      "number",
      "order_id",
      "status",
      "currency",
      "issued_at",
      "due_at",
    ]) && moneyRecord(value, "amount_minor")
  );
}
function validService(value: unknown): boolean {
  return (
    strings(value, [
      "id",
      "name",
      "plan_name",
      "region",
      "ipv4",
      "status",
      "currency",
      "next_due_at",
    ]) &&
    moneyRecord(value, "price_minor") &&
    ["cpu", "memory_gb", "disk_gb"].every((key) => integer(value[key], true))
  );
}
function validAudit(value: unknown): boolean {
  return strings(value, [
    "id",
    "action",
    "target",
    "actor_email",
    "detail",
    "created_at",
  ]);
}
function validPage(value: unknown, item: (entry: unknown) => boolean): boolean {
  return (
    object(value) &&
    list(value.items, item) &&
    typeof value.has_more === "boolean" &&
    integer(value.limit, true) &&
    Number(value.limit) <= 100 &&
    (value.next_cursor === undefined ||
      (typeof value.next_cursor === "string" && !!value.next_cursor)) &&
    (!value.has_more || !!value.next_cursor)
  );
}
function validCatalogItem(value: unknown): boolean {
  return (
    strings(value, [
      "id",
      "name",
      "description",
      "region",
      "type_id",
      "region_id",
    ]) &&
    ["cpu", "memory_gb", "disk_gb", "transfer_tb"].every((key) =>
      integer(value[key], true),
    ) &&
    typeof value.available === "boolean" &&
    list(
      value.prices,
      (price) =>
        strings(price, ["currency"]) &&
        /^[A-Z]{3}$/.test(String(price.currency)) &&
        integer(price.amount_minor, true) &&
        typeof price.available === "boolean",
    )
  );
}
/** Validate known core response contracts before pages receive an asserted generic T. */
function validPayload(
  path: string,
  value: unknown,
  method: "GET" | "POST",
): boolean {
  const route = path.startsWith("/admin/") ? path.slice(6) : path;
  if (
    route === "/session" ||
    route === "/auth/login" ||
    route === "/auth/logout"
  )
    return isSession(value);
  if (route === "/orders" && method === "GET") return list(value, validOrder);
  if (route === "/orders" && method === "POST") return validOrder(value);
  if (/^\/orders\/[^/]+\/cancel$/.test(route))
    return (
      object(value) &&
      validOrder(value.order) &&
      validInvoice(value.invoice) &&
      object(value.order) &&
      object(value.invoice) &&
      value.invoice.order_id === value.order.id
    );
  if (/^\/orders\/[^/]+$/.test(route))
    return (
      object(value) &&
      validOrder(value.order) &&
      (value.customer === undefined || validUser(value.customer)) &&
      (value.invoice === null ||
        (validInvoice(value.invoice) &&
          object(value.invoice) &&
          object(value.order) &&
          value.invoice.order_id === value.order.id)) &&
      (value.service === null ||
        (validService(value.service) &&
          object(value.service) &&
          object(value.order) &&
          value.service.id === value.order.service_id)) &&
      list(
        value.payment_attempts,
        (attempt) =>
          strings(attempt, [
            "id",
            "provider_id",
            "currency",
            "state",
            "created_at",
            "updated_at",
          ]) &&
          integer(attempt.amount_minor) &&
          integer(attempt.currency_decimal_places) &&
          Number(attempt.currency_decimal_places) <= 6,
      ) &&
      list(value.audit, validAudit) &&
      typeof value.audit_has_more === "boolean" &&
      typeof value.payment_attempts_has_more === "boolean"
    );
  if (route === "/invoices") return list(value, validInvoice);
  if (/^\/invoices\/[^/]+$/.test(route)) return validInvoice(value);
  if (/^\/invoices\/[^/]+\/checkout$/.test(route))
    return strings(value, [
      "provider_id",
      "session_id",
      "checkout_url",
      "expires_at",
    ]);
  if (route === "/services")
    return list(
      value,
      (item) =>
        validService(item) &&
        (!path.startsWith("/admin/") ||
          (object(item) && typeof item.customer_id === "string")),
    );
  if (route === "/plans")
    return list(
      value,
      (plan) =>
        strings(plan, [
          "id",
          "name",
          "description",
          "region",
          "currency",
          "type_id",
          "region_id",
        ]) &&
        moneyRecord(plan, "price_minor") &&
        integer(plan.price_revision, true) &&
        integer(plan.taxonomy_revision, true) &&
        typeof plan.available === "boolean" &&
        ["cpu", "memory_gb", "disk_gb", "transfer_tb"].every((key) =>
          integer(plan[key], true),
        ) &&
        (plan.available
          ? Number(plan.price_minor) > 0
          : Number(plan.price_minor) >= 0),
    );
  if (route === "/catalog-taxonomy") return validCatalogTaxonomy(value);
  if (route === "/currencies")
    return (
      object(value) &&
      integer(value.revision, true) &&
      typeof value.default_currency === "string" &&
      list(
        value.currencies,
        (currency) =>
          validCurrencyFormat(currency) &&
          object(currency) &&
          typeof currency.enabled === "boolean" &&
          typeof currency.precision_locked === "boolean" &&
          integer(currency.sort_order),
      )
    );
  if (route === "/catalog" && method === "GET")
    return (
      object(value) &&
      integer(value.revision, true) &&
      integer(value.currency_revision, true) &&
      integer(value.taxonomy_revision, true) &&
      list(value.items, validCatalogItem)
    );
  if (/^\/catalog(?:\/[^/]+(?:\/duplicate)?)?$/.test(route))
    return (
      object(value) &&
      integer(value.revision, true) &&
      integer(value.currency_revision, true) &&
      integer(value.taxonomy_revision, true) &&
      validCatalogItem(value.plan)
    );
  if (route === "/customer-accounts" && method === "GET")
    return validPage(value, validAccount);
  if (
    /^\/customer-accounts(?:\/[^/]+(?:\/(?:password|revoke-sessions))?)?$/.test(
      route,
    )
  )
    return validAccount(value);
  if (route === "/customers") return list(value, validUser);
  if (route === "/audit") return list(value, validAudit);
  if (route === "/audit-events")
    return validPage(
      value,
      (event) =>
        validAudit(event) &&
        (!path.startsWith("/admin/") ||
          (object(event) && typeof event.owner_id === "string")),
    );
  if (route === "/overview")
    return (
      object(value) &&
      moneyRecord(value, "unpaid_total_minor") &&
      value.count_scope === "currency" &&
      (path.startsWith("/admin/")
        ? integer(value.customers) &&
          integer(value.total_services) &&
          integer(value.unpaid_invoices) &&
          validMinor(value.revenue_minor) &&
          value.customers_scope === "all"
        : integer(value.active_services) &&
          integer(value.pending_invoices) &&
          validMinor(value.monthly_total_minor) &&
          value.recent_orders_scope === "all" &&
          list(value.recent_orders, validOrder))
    );
  return true; // Peripheral DTOs are explicitly validated by their own page/form before mutation.
}

/** Same-origin transport only. No retries, no local-storage credentials, no demo fallback. */
export function createApiClient(options: {
  locale: () => Locale;
  onSession: (session: Session) => void;
  onSessionInvalid?: (error: ApiError) => void;
  fetcher?: typeof fetch;
}) {
  const fetcher =
    options.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let csrf = "",
    epoch = 0,
    identity = "";
  const controllers = new Set<AbortController>();
  let sessionLoading: Promise<Session> | null = null;

  function advanceEpoch(except?: AbortController) {
    epoch++;
    sessionLoading = null;
    for (const pending of controllers) if (pending !== except) pending.abort();
  }
  function receiveSession(value: Session, controller: AbortController) {
    const nextIdentity = value.user
      ? `${value.user.id}|${value.user.role}`
      : "";
    if (nextIdentity !== identity) advanceEpoch(controller);
    identity = nextIdentity;
    csrf = value.csrf_token;
    options.onSession(value);
  }
  function invalidateSession(error: ApiError, controller: AbortController) {
    advanceEpoch(controller);
    csrf = "";
    identity = "";
    options.onSession({ user: null, csrf_token: "", demo_mode: false });
    options.onSessionInvalid?.(error);
  }

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    query?: Query,
  ): Promise<T> {
    const url = endpoint(path, query);
    // Cookie rotation must fence already-started session/data reads, not merely hide their results.
    if (
      method === "POST" &&
      (path === "/auth/login" || path === "/auth/logout")
    )
      advanceEpoch();
    const captured = epoch;
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      for (const key of Object.keys(headers))
        if (key.toLowerCase() !== "idempotency-key")
          throw new ApiError("INVALID_REQUEST");
      const outgoing: Record<string, string> = {
        Accept: "application/json",
        "Accept-Language": options.locale(),
      };
      if (body !== undefined) outgoing["Content-Type"] = "application/json";
      if (method === "POST") {
        if (!csrf)
          throw new ApiError("CSRF_INVALID", 403, { locale: options.locale() });
        outgoing["X-CSRF-Token"] = csrf;
      }
      Object.assign(outgoing, headers);
      const response = await fetcher(url, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: outgoing,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (captured !== epoch) throw staleResponse(method === "POST");
      const requestHeader = response.headers.get("X-Request-ID");
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new ApiError("INVALID_RESPONSE", response.status, {
          locale: options.locale(),
          requestId:
            requestHeader && REQUEST_ID.test(requestHeader)
              ? requestHeader
              : undefined,
          uncertain:
            method === "POST" && (response.ok || response.status >= 500),
        });
      }
      if (captured !== epoch) throw staleResponse(method === "POST");
      if (!response.ok) {
        const error = object(data) && object(data.error) ? data.error : {};
        const jsonId = error.request_id;
        const requestId =
          requestHeader && REQUEST_ID.test(requestHeader)
            ? requestHeader
            : typeof jsonId === "string" && REQUEST_ID.test(jsonId)
              ? jsonId
              : undefined;
        const code =
          typeof error.code === "string" &&
          /^[A-Z][A-Z0-9_]{0,95}$/.test(error.code)
            ? error.code
            : "REQUEST_FAILED";
        const failure = new ApiError(code, response.status, {
          locale: options.locale(),
          requestId,
          details: error.details,
          uncertain:
            method === "POST" &&
            (response.status >= 500 || code === "SMTP_DELIVERY_UNCERTAIN"),
          retryAfter: response.headers.get("Retry-After") ?? undefined,
        });
        if (
          (response.status === 401 && code !== "INVALID_CREDENTIALS") ||
          code === "AUTH_REQUIRED" ||
          code === "CSRF_INVALID"
        )
          invalidateSession(failure, controller);
        // A forbidden operation is not a logout. Refresh identity (e.g. revoked admin role), never replay the operation.
        if (
          response.status === 403 &&
          code === "FORBIDDEN" &&
          path !== "/session"
        ) {
          try {
            await refreshSession();
          } catch {
            invalidateSession(failure, controller);
          }
        }
        throw failure;
      }
      if (!object(data) || !Object.hasOwn(data, "data"))
        throw new ApiError("INVALID_RESPONSE", response.status, {
          locale: options.locale(),
          uncertain: method === "POST",
        });
      if (
        path === "/session" ||
        path === "/auth/login" ||
        path === "/auth/logout"
      ) {
        if (
          path === "/auth/logout" &&
          object(data.data) &&
          !Object.hasOwn(data.data, "demo_mode")
        )
          data.data.demo_mode = false;
        if (!isSession(data.data))
          throw new ApiError("INVALID_RESPONSE", response.status, {
            locale: options.locale(),
            uncertain: method === "POST",
          });
        receiveSession(data.data, controller);
      }
      if (!validPayload(path, data.data, method))
        throw new ApiError("INVALID_RESPONSE", response.status, {
          locale: options.locale(),
          requestId:
            requestHeader && REQUEST_ID.test(requestHeader)
              ? requestHeader
              : undefined,
          uncertain: method === "POST",
        });
      return data.data as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (captured !== epoch) throw staleResponse(method === "POST");
      throw new ApiError("NETWORK_ERROR", 0, {
        locale: options.locale(),
        uncertain: method === "POST",
      });
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }
  async function refreshSession(): Promise<Session> {
    if (!sessionLoading) {
      const pending = request<Session>("GET", "/session").finally(() => {
        if (sessionLoading === pending) sessionLoading = null;
      });
      sessionLoading = pending;
    }
    return sessionLoading;
  }
  return {
    read<T>(path: string, query?: Query) {
      return request<T>("GET", path, undefined, {}, query);
    },
    async write<T>(
      path: string,
      body: unknown,
      headers: Record<string, string> = {},
    ): Promise<T> {
      if (path === "/orders") {
        const input = object(body) ? body : {},
          quote = object(input.quote) ? input.quote : {};
        const key = Object.entries(headers).find(
          ([name]) => name.toLowerCase() === "idempotency-key",
        )?.[1];
        if (!key || !/^[A-Za-z0-9_.:-]{8,128}$/.test(key))
          throw new ApiError("IDEMPOTENCY_KEY_REQUIRED", 400, {
            locale: options.locale(),
          });
        if (
          typeof input.plan_id !== "string" ||
          !input.plan_id ||
          new TextEncoder().encode(input.plan_id).length > 64 ||
          typeof input.hostname !== "string" ||
          !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(input.hostname) ||
          typeof input.currency !== "string" ||
          !/^[A-Z]{3}$/.test(input.currency) ||
          !validMinor(quote.price_minor) ||
          quote.price_minor <= 0 ||
          !validMinor(quote.price_revision) ||
          quote.price_revision <= 0 ||
          !Number.isInteger(quote.decimal_places) ||
          Number(quote.decimal_places) < 0 ||
          Number(quote.decimal_places) > 6
        )
          throw new ApiError("INVALID_QUOTE", 400, {
            locale: options.locale(),
          });
      }
      if (!csrf) await refreshSession();
      const data = await request<T>("POST", path, body, headers);
      if (
        path === "/auth/login" ||
        path === "/auth/logout" ||
        /^\/admin\/customer-accounts\/[^/]+\/(?:password|revoke-sessions)$/.test(
          path,
        )
      ) {
        try {
          await refreshSession();
        } catch (cause) {
          const error = new ApiError(
            "SESSION_REFRESH_FAILED",
            cause instanceof ApiError ? cause.status : 0,
            {
              locale: options.locale(),
              requestId:
                cause instanceof ApiError ? cause.requestId : undefined,
              uncertain: true,
            },
          );
          options.onSessionInvalid?.(error);
          throw error;
        }
      }
      return data;
    },
    refreshSession,
    reset() {
      advanceEpoch();
      csrf = "";
      identity = "";
      controllers.clear();
    },
  };
}

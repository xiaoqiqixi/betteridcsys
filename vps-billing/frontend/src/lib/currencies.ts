export type Currency = string;
export interface CurrencyFormat {
  code: string;
  name: string;
  prefix: string;
  suffix: string;
  decimal_places: number;
}
export interface CurrencyUsage {
  plan_prices: number;
  orders: number;
  invoices: number;
  services: number;
  pending_orders: number;
  unpaid_invoices: number;
  ongoing_services: number;
}
export interface CurrencyDefinition extends CurrencyFormat {
  enabled: boolean;
  sort_order: number;
  precision_locked: boolean;
  usage?: CurrencyUsage;
}
export interface CurrencyRegistry {
  revision: number;
  default_currency: string;
  currencies: CurrencyDefinition[];
}
export interface PlanPrice {
  plan_id: string;
  plan_name: string;
  plan_available: boolean;
  amount: string;
  amount_minor: number;
  available: boolean;
}
export interface PlanPriceList {
  revision: number;
  currency: string;
  currency_format: CurrencyFormat;
  plans: PlanPrice[];
}
export const defaultCurrencyRegistry: CurrencyRegistry = {
  revision: 1,
  default_currency: "CNY",
  currencies: [
    {
      code: "CNY",
      name: "人民币",
      prefix: "¥",
      suffix: "",
      decimal_places: 2,
      enabled: true,
      sort_order: 0,
      precision_locked: true,
    },
  ],
};
export const isCurrencyCode = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value);
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_CURRENCY_RESPONSE");
  return value as Record<string, unknown>;
};
const validText = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  new TextEncoder().encode(value).length <= max &&
  !/[\p{Cc}\p{Cf}\p{Cs}<>]/u.test(value);
const integer = (
  value: unknown,
  max = Number.MAX_SAFE_INTEGER,
): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= max;
export function readCurrencyFormat(
  value: unknown,
  expectedCode?: string,
): CurrencyFormat {
  const v = record(value);
  if (
    !isCurrencyCode(v.code) ||
    (expectedCode !== undefined && v.code !== expectedCode) ||
    !validText(v.name, 80) ||
    !v.name.trim() ||
    !validText(v.prefix, 24) ||
    !validText(v.suffix, 24) ||
    !integer(v.decimal_places, 6)
  )
    throw new Error("INVALID_CURRENCY_RESPONSE");
  return {
    code: v.code,
    name: v.name,
    prefix: v.prefix,
    suffix: v.suffix,
    decimal_places: v.decimal_places,
  };
}
export function readCurrencyRegistry(value: unknown): CurrencyRegistry {
  const v = record(value);
  if (
    !integer(v.revision) ||
    v.revision < 1 ||
    !isCurrencyCode(v.default_currency) ||
    !Array.isArray(v.currencies) ||
    !v.currencies.length ||
    v.currencies.length > 32
  )
    throw new Error("INVALID_CURRENCY_RESPONSE");
  const codes = new Set<string>();
  const currencies = v.currencies.map((raw) => {
    const c = record(raw);
    const format = readCurrencyFormat(c);
    if (
      codes.has(format.code) ||
      typeof c.enabled !== "boolean" ||
      typeof c.precision_locked !== "boolean" ||
      !integer(c.sort_order, 10000)
    )
      throw new Error("INVALID_CURRENCY_RESPONSE");
    codes.add(format.code);
    let usage: CurrencyUsage | undefined;
    if (c.usage !== undefined) {
      const u = record(c.usage);
      const keys = [
        "plan_prices",
        "orders",
        "invoices",
        "services",
        "pending_orders",
        "unpaid_invoices",
        "ongoing_services",
      ] as const;
      if (keys.some((key) => !integer(u[key])))
        throw new Error("INVALID_CURRENCY_RESPONSE");
      usage = Object.fromEntries(
        keys.map((key) => [key, u[key]]),
      ) as unknown as CurrencyUsage;
    }
    return {
      ...format,
      enabled: c.enabled,
      sort_order: c.sort_order,
      precision_locked: c.precision_locked,
      ...(usage ? { usage } : {}),
    };
  });
  if (!currencies.some((c) => c.code === v.default_currency && c.enabled))
    throw new Error("INVALID_CURRENCY_RESPONSE");
  return {
    revision: v.revision,
    default_currency: v.default_currency,
    currencies,
  };
}
export function readCurrencyBlocker(
  value: unknown,
): { currency: string; usage: CurrencyUsage } | undefined {
  try {
    const v = record(value);
    const usage = record(v.usage);
    const keys = [
      "plan_prices",
      "orders",
      "invoices",
      "services",
      "pending_orders",
      "unpaid_invoices",
      "ongoing_services",
    ] as const;
    if (!isCurrencyCode(v.currency) || keys.some((key) => !integer(usage[key])))
      return undefined;
    return {
      currency: v.currency,
      usage: Object.fromEntries(
        keys.map((key) => [key, usage[key]]),
      ) as unknown as CurrencyUsage,
    };
  } catch {
    return undefined;
  }
}
export function currencyWritePayload(value: CurrencyRegistry) {
  const registry = readCurrencyRegistry(value);
  return {
    revision: registry.revision,
    default_currency: registry.default_currency,
    currencies: registry.currencies.map(
      ({
        code,
        name,
        prefix,
        suffix,
        decimal_places,
        enabled,
        sort_order,
      }) => ({
        code,
        name,
        prefix,
        suffix,
        decimal_places,
        enabled,
        sort_order,
      }),
    ),
  };
}
function amountMinor(value: string, places: number): bigint {
  if (
    !integer(places, 6) ||
    typeof value !== "string" ||
    value.length > 24 ||
    !/^(0|[1-9]\d*)(?:\.\d+)?$/.test(value)
  )
    throw new Error("INVALID_AMOUNT");
  const [whole = "", fraction = ""] = value.split(".");
  if (fraction.length > places) throw new Error("INVALID_AMOUNT_PRECISION");
  const minor = BigInt(whole + fraction.padEnd(places, "0"));
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("INVALID_AMOUNT_RANGE");
  return minor;
}
// Never parse decimal prices through Number: preserve every accepted minor unit.
export function canonicalAmount(value: string, places: number): string {
  const minor = amountMinor(value, places);
  const units = 10n ** BigInt(places);
  return (
    String(minor / units) +
    (places ? "." + String(minor % units).padStart(places, "0") : "")
  );
}
export function readPlanPrices(
  value: unknown,
  expectedCurrency?: string,
): PlanPriceList {
  const v = record(value);
  if (
    !integer(v.revision) ||
    v.revision < 1 ||
    !isCurrencyCode(v.currency) ||
    (expectedCurrency !== undefined && v.currency !== expectedCurrency) ||
    !Array.isArray(v.plans) ||
    v.plans.length > 1000
  )
    throw new Error("INVALID_PRICE_RESPONSE");
  const format = readCurrencyFormat(v.currency_format, v.currency);
  const ids = new Set<string>();
  const plans = v.plans.map((raw) => {
    const p = record(raw);
    if (
      !validText(p.plan_id, 128) ||
      !p.plan_id ||
      ids.has(p.plan_id) ||
      !validText(p.plan_name, 240) ||
      !p.plan_name ||
      typeof p.plan_available !== "boolean" ||
      typeof p.available !== "boolean" ||
      !integer(p.amount_minor) ||
      typeof p.amount !== "string"
    )
      throw new Error("INVALID_PRICE_RESPONSE");
    ids.add(p.plan_id);
    if (p.amount === "") {
      if (p.amount_minor !== 0 || p.available)
        throw new Error("INVALID_PRICE_RESPONSE");
    } else if (
      amountMinor(p.amount, format.decimal_places) !== BigInt(p.amount_minor)
    )
      throw new Error("INVALID_PRICE_RESPONSE");
    return {
      plan_id: p.plan_id,
      plan_name: p.plan_name,
      plan_available: p.plan_available,
      amount:
        p.amount === "" ? "" : canonicalAmount(p.amount, format.decimal_places),
      amount_minor: p.amount_minor,
      available: p.available,
    };
  });
  return {
    revision: v.revision,
    currency: v.currency,
    currency_format: format,
    plans,
  };
}

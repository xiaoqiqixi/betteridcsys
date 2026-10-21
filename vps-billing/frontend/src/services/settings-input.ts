import type {
  CurrencyRegistry,
  CurrencyUpdate,
  EmailSettings,
  EmailSettingsUpdate,
  SiteSettings,
} from "../types/idc";

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const bytes = (s: string) => new TextEncoder().encode(s).length;
const plain = (s: unknown, max: number, multiline = false): s is string =>
  typeof s === "string" &&
  bytes(s) <= max &&
  !/[<>\p{Cf}\p{Cc}]/u.test(multiline ? s.replace(/\n/g, "") : s);
const revision = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const count = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const dns = (s: string) =>
  s.length <= 253 &&
  s
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
/** Same single-recipient grammar as smtpv1.ValidateRecipient; no display names or lists. */
export function smtpRecipient(value: unknown): value is string {
  if (typeof value !== "string" || bytes(value) > 254 || value !== value.trim())
    return false;
  const parts = value.split("@"),
    local = parts[0] || "",
    domain = parts[1] || "";
  return (
    parts.length === 2 &&
    local.length > 0 &&
    local.length <= 64 &&
    !local.startsWith(".") &&
    !local.endsWith(".") &&
    !local.includes("..") &&
    /^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+$/.test(local) &&
    dns(domain)
  );
}
function smtpHost(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 253 || /[\s/@\\]/.test(value))
    return false;
  if (!value) return true; // Disabled drafts may omit a destination.
  if (/^\d+(?:\.\d+){3}$/.test(value)) {
    const octets = value.split(".").map(Number);
    return (
      octets.every((n) => n <= 255) &&
      octets.some(Boolean) &&
      !(octets[0]! >= 224 && octets[0]! <= 239)
    );
  }
  if (value.includes(":")) {
    try {
      const host = new URL(`https://[${value}]/`).hostname;
      return host !== "[::]" && !host.startsWith("[ff");
    } catch {
      return false;
    }
  }
  return dns(value);
}
export function displayLink(value: unknown, originOnly = false): boolean {
  if (value === "") return true;
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !value.startsWith("https://") ||
    /[\\\p{Cc}\p{Cf}]/u.test(value)
  )
    return false;
  const match = /^https:\/\/([^/?#]+)(.*)$/.exec(value);
  if (
    !match ||
    /[:@]/.test(match[1]!) ||
    !dns(match[1]!) ||
    !match[1]!.includes(".") ||
    /^\d+(?:\.\d+){3}$/.test(match[1]!) ||
    /\.(?:localhost|local|internal)$/i.test(match[1]!)
  )
    return false;
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !value.includes("#") &&
      (!originOnly || match[2] === "")
    );
  } catch {
    return false;
  }
}
const siteFields = [
  "revision",
  "default_locale",
  "default_currency",
  "site_name",
  "company_name",
  "logo",
  "theme",
  "support_email",
  "support_url",
  "display_url",
  "email_signature",
  "invoice_issuer",
  "invoice_address",
] as const;
export function siteInput(value: SiteSettings): SiteSettings {
  if (!object(value)) throw new Error("INVALID_SETTINGS");
  const out = Object.fromEntries(
    siteFields.map((k) => [k, value[k]]),
  ) as unknown as SiteSettings;
  if (
    !revision(out.revision) ||
    !["zh-CN", "en"].includes(out.default_locale) ||
    !/^[A-Z]{3}$/.test(out.default_currency) ||
    !["star", "cloud", "server"].includes(out.logo) ||
    !["blue", "teal", "violet"].includes(out.theme)
  )
    throw new Error("INVALID_SETTINGS");
  for (const [key, max, multi] of [
    ["site_name", 120, false],
    ["company_name", 240, false],
    ["support_email", 254, false],
    ["support_url", 500, false],
    ["display_url", 300, false],
    ["email_signature", 1000, true],
    ["invoice_issuer", 240, false],
    ["invoice_address", 1000, true],
  ] as const)
    if (!plain(out[key], max, multi)) throw new Error("INVALID_SETTINGS");
  if (
    !out.site_name.trim() ||
    !out.invoice_issuer.trim() ||
    (out.support_email && !smtpRecipient(out.support_email)) ||
    !displayLink(out.support_url) ||
    !displayLink(out.display_url, true)
  )
    throw new Error("INVALID_SETTINGS");
  return out;
}
export function currencyRegistry(value: unknown): value is CurrencyRegistry {
  if (
    !object(value) ||
    !revision(value.revision) ||
    typeof value.default_currency !== "string" ||
    !Array.isArray(value.currencies) ||
    !value.currencies.length ||
    value.currencies.length > 32
  )
    return false;
  const seen = new Set<string>();
  return (
    value.currencies.every((c) => {
      if (
        !object(c) ||
        typeof c.code !== "string" ||
        !/^[A-Z]{3}$/.test(c.code) ||
        seen.has(c.code) ||
        !plain(c.name, 80) ||
        !c.name.trim() ||
        !plain(c.prefix, 24) ||
        !plain(c.suffix, 24) ||
        !count(c.decimal_places) ||
        c.decimal_places > 6 ||
        !count(c.sort_order) ||
        c.sort_order > 10000 ||
        typeof c.enabled !== "boolean" ||
        typeof c.precision_locked !== "boolean"
      )
        return false;
      seen.add(c.code);
      return (
        c.usage === undefined ||
        (object(c.usage) &&
          [
            "plan_prices",
            "orders",
            "invoices",
            "services",
            "pending_orders",
            "unpaid_invoices",
            "ongoing_services",
          ].every((key) => count((c.usage as Record<string, unknown>)[key])))
      );
    }) &&
    value.currencies.some(
      (c) =>
        object(c) && c.code === value.default_currency && c.enabled === true,
    )
  );
}
export function currencyInput(
  value: CurrencyUpdate,
  original: CurrencyRegistry,
): CurrencyUpdate {
  if (
    !object(value) ||
    !currencyRegistry(original) ||
    !revision(value.revision) ||
    value.revision !== original.revision ||
    !Array.isArray(value.currencies) ||
    value.currencies.length < 1 ||
    value.currencies.length > 32
  )
    throw new Error("INVALID_CURRENCY_CONFIG");
  const seen = new Set<string>();
  const currencies = value.currencies.map((c) => {
    if (
      !object(c) ||
      typeof c.code !== "string" ||
      !/^[A-Z]{3}$/.test(c.code) ||
      seen.has(c.code) ||
      !plain(c.name, 80) ||
      !c.name.trim() ||
      !plain(c.prefix, 24) ||
      !plain(c.suffix, 24) ||
      !count(c.decimal_places) ||
      c.decimal_places > 6 ||
      !count(c.sort_order) ||
      c.sort_order > 10000 ||
      typeof c.enabled !== "boolean"
    )
      throw new Error("INVALID_CURRENCY_CONFIG");
    seen.add(c.code);
    const old = original.currencies.find((x) => x.code === c.code);
    if (old?.precision_locked && c.decimal_places !== old.decimal_places)
      throw new Error("CURRENCY_PRECISION_LOCKED");
    if (
      old?.enabled &&
      !c.enabled &&
      old.usage &&
      [
        old.usage.pending_orders,
        old.usage.unpaid_invoices,
        old.usage.ongoing_services,
      ].some((n) => n > 0)
    )
      throw new Error("CURRENCY_IN_USE");
    return {
      code: c.code,
      name: c.name,
      prefix: c.prefix,
      suffix: c.suffix,
      decimal_places: c.decimal_places,
      enabled: c.enabled,
      sort_order: c.sort_order,
    };
  });
  if (
    original.currencies.some((c) => !seen.has(c.code)) ||
    !currencies.some((c) => c.code === value.default_currency && c.enabled)
  )
    throw new Error("INVALID_CURRENCY_CONFIG");
  return {
    revision: value.revision,
    default_currency: value.default_currency,
    currencies,
  };
}
const emailFields = [
  "revision",
  "enabled",
  "host",
  "port",
  "tls_mode",
  "from_address",
  "from_name",
] as const;
export function emailSettings(value: unknown): value is EmailSettings {
  if (
    !object(value) ||
    ["username", "password", "credentials_ciphertext"].some(
      (key) => key in value,
    ) ||
    !revision(value.revision) ||
    ![
      "enabled",
      "username_configured",
      "password_configured",
      "key_configured",
      "plugin_available",
      "destination_allowed",
    ].every((k) => typeof value[k] === "boolean") ||
    ![
      "host",
      "from_address",
      "from_name",
      "plugin_version",
      "updated_at",
    ].every((k) => typeof value[k] === "string") ||
    !["not_installed", "disabled", "unavailable", "approved"].includes(
      String(value.plugin_status),
    )
  )
    return false;
  if (
    !smtpHost(value.host) ||
    !count(value.port) ||
    value.port < 1 ||
    value.port > 65535 ||
    !["starttls", "implicit_tls"].includes(String(value.tls_mode)) ||
    !plain(value.from_name, 120) ||
    (value.from_address !== "" && !smtpRecipient(value.from_address)) ||
    value.username_configured !== value.password_configured ||
    value.plugin_available !== (value.plugin_status === "approved") ||
    !Number.isFinite(Date.parse(String(value.updated_at)))
  )
    return false;
  // A missing decryption key is a recoverable operator state, not a reason to conceal saved settings.
  return (
    !value.enabled ||
    (!!value.host && !!value.from_address && value.username_configured === true)
  );
}
export function emailInput(
  value: EmailSettingsUpdate,
  original: EmailSettings,
): EmailSettingsUpdate {
  if (!object(value) || !emailSettings(original))
    throw new Error("INVALID_EMAIL_SETTINGS");
  const out = Object.fromEntries(
    emailFields.map((k) => [k, value[k]]),
  ) as unknown as EmailSettingsUpdate;
  if (
    !revision(out.revision) ||
    out.revision !== original.revision ||
    typeof out.enabled !== "boolean" ||
    !count(out.port) ||
    out.port < 1 ||
    out.port > 65535 ||
    !["starttls", "implicit_tls"].includes(out.tls_mode) ||
    !smtpHost(out.host) ||
    !plain(out.from_name, 120) ||
    typeof out.from_address !== "string" ||
    (out.from_address && !smtpRecipient(out.from_address))
  )
    throw new Error("INVALID_EMAIL_SETTINGS");
  if (
    (value.username !== undefined && typeof value.username !== "string") ||
    (value.password !== undefined && typeof value.password !== "string") ||
    (value.clear_username !== undefined &&
      typeof value.clear_username !== "boolean") ||
    (value.clear_password !== undefined &&
      typeof value.clear_password !== "boolean")
  )
    throw new Error("INVALID_EMAIL_SETTINGS");
  const username = value.username || "",
    password = value.password || "",
    clear = value.clear_username === true && value.clear_password === true;
  if (
    !!value.clear_username !== !!value.clear_password ||
    (clear && (out.enabled || !!username || !!password)) ||
    bytes(username) > 254 ||
    bytes(password) > 1024 ||
    /[\p{Cc}\p{Cf}]/u.test(username + password) ||
    username !== username.trim()
  )
    throw new Error("INVALID_EMAIL_SETTINGS");
  const saved = original.username_configured || original.password_configured;
  const destination =
    original.host !== out.host ||
    original.port !== out.port ||
    original.tls_mode !== out.tls_mode;
  if (
    (saved && destination && !clear && !(username && password)) ||
    ((out.enabled || !!username || !!password || clear) &&
      !original.key_configured) ||
    (out.enabled &&
      (!out.host ||
        !out.from_address ||
        !(username || original.username_configured) ||
        !(password || original.password_configured)))
  )
    throw new Error("INVALID_EMAIL_SETTINGS");
  if (!saved && !!username != !!password)
    throw new Error("INVALID_EMAIL_SETTINGS");
  if (username) out.username = username;
  if (password) out.password = password;
  if (clear) {
    out.clear_username = true;
    out.clear_password = true;
  }
  return out;
}
export function integrationList(value: unknown): boolean {
  return (
    object(value) &&
    Array.isArray(value.items) &&
    value.items.every(
      (i) =>
        object(i) &&
        ["id", "name", "description"].every((k) => typeof i[k] === "string") &&
        ["payment", "email"].includes(String(i.kind)) &&
        ["disabled", "ready", "unavailable"].includes(String(i.status)) &&
        ["enabled", "configured"].every((k) => typeof i[k] === "boolean") &&
        ["capabilities", "supported_currencies", "limitations"].every(
          (k) =>
            Array.isArray(i[k]) &&
            (i[k] as unknown[]).every((s) => typeof s === "string"),
        ) &&
        object(i.currency_decimal_places) &&
        Object.entries(i.currency_decimal_places).every(
          ([code, p]) => /^[A-Z]{3}$/.test(code) && count(p) && p <= 6,
        ) &&
        ["environment", "admin_api"].includes(String(i.configuration_mode)) &&
        Array.isArray(i.configuration_fields) &&
        i.configuration_fields.every(
          (f) =>
            object(f) &&
            typeof f.key === "string" &&
            typeof f.label === "string" &&
            ["string", "secret_ref", "url"].includes(String(f.type)) &&
            typeof f.required === "boolean" &&
            typeof f.secret === "boolean" &&
            !("value" in f),
        ),
    )
  );
}
/** Read validation is independent of a write draft; read-only flags must actually exist. */
export function settingsResponse(kind: string, value: unknown): boolean {
  if (kind === "site") {
    try {
      siteInput(value as SiteSettings);
      return true;
    } catch {
      return false;
    }
  }
  if (kind === "currencies") return currencyRegistry(value);
  if (kind === "email") return emailSettings(value);
  if (kind === "integrations") return integrationList(value);
  return false;
}
export function matchesSettingsSave(
  kind: string,
  value: unknown,
  body: SiteSettings | CurrencyUpdate | EmailSettingsUpdate,
  original: unknown,
): boolean {
  if (
    !settingsResponse(kind, value) ||
    !object(value) ||
    !object(original) ||
    value.revision !== body.revision + 1
  )
    return false;
  if (kind === "site")
    return siteFields.every(
      (k) => k === "revision" || value[k] === (body as SiteSettings)[k],
    );
  if (kind === "email") {
    const b = body as EmailSettingsUpdate;
    return (
      emailFields.every((k) => k === "revision" || value[k] === b[k]) &&
      value.username_configured ===
        (!b.clear_username &&
          (!!b.username || original.username_configured === true)) &&
      value.password_configured ===
        (!b.clear_password &&
          (!!b.password || original.password_configured === true))
    );
  }
  if (kind === "currencies") {
    const b = body as CurrencyUpdate,
      result = value as unknown as CurrencyRegistry;
    const canonical = (cs: CurrencyUpdate["currencies"]) =>
      JSON.stringify(
        cs
          .map(
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
          )
          .sort((a, b) => a.code.localeCompare(b.code)),
      );
    return (
      result.default_currency === b.default_currency &&
      canonical(result.currencies) === canonical(b.currencies)
    );
  }
  return false;
}

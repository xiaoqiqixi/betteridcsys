// Only declared display fields cross this boundary. Secrets/provider settings
// never belong in this model, and neither URL causes a server-side fetch.
export interface PublicSiteSettings {
  default_locale: "zh-CN" | "en";
  default_currency: "CNY" | "USD";
  site_name: string;
  company_name: string;
  logo: "star" | "cloud" | "server";
  theme: "blue" | "teal" | "violet";
  support_email: string;
  support_url: string;
  display_url: string;
}
export interface SiteSettings extends PublicSiteSettings {
  revision: number;
  email_signature: string;
  invoice_issuer: string;
  invoice_address: string;
}
export const defaultSiteSettings: Readonly<SiteSettings> = Object.freeze({
  revision: 1,
  default_locale: "zh-CN",
  default_currency: "CNY",
  site_name: "星屿云",
  company_name: "",
  logo: "star",
  theme: "blue",
  support_email: "",
  support_url: "",
  display_url: "",
  email_signature: "",
  invoice_issuer: "星屿云",
  invoice_address: "",
});
export const defaultSettings = defaultSiteSettings;

export type SettingsField = keyof SiteSettings;
export type SettingsIssue = {
  field: SettingsField;
  reason:
    "required" | "text" | "email" | "url" | "origin" | "choice" | "revision";
};
const textFields = {
  site_name: [120, false],
  company_name: [240, false],
  support_email: [254, false],
  support_url: [500, false],
  display_url: [300, false],
  email_signature: [1000, true],
  invoice_issuer: [240, false],
  invoice_address: [1000, true],
} as const;
const publicFields = [
  "default_locale",
  "default_currency",
  "site_name",
  "company_name",
  "logo",
  "theme",
  "support_email",
  "support_url",
  "display_url",
] as const;

function validText(
  value: unknown,
  max: number,
  multiline: boolean,
): value is string {
  if (typeof value !== "string") return false;
  // The Go API limits UTF-8 bytes, not UTF-16 code units or visible characters.
  if (new TextEncoder().encode(value).length > max) return false;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (
      (code < 32 || (code >= 127 && code <= 159)) &&
      !(multiline && code === 10)
    )
      return false;
    if (code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}

export function safeSettingsURL(
  value: string,
  originOnly = false,
): string | undefined {
  // Reject parser normalization of whitespace/backslashes and empty userinfo.
  if (
    !/^https:\/\//.test(value) ||
    /[\s\\#\u0000-\u001f\u007f-\u009f]/u.test(value)
  )
    return undefined;
  const authority = value.slice(8).split(/[/?]/, 1)[0]!;
  if (!authority || authority.includes("@")) return undefined;
  if (originOnly && !/^https:\/\/[^/?#]+$/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function validEmail(value: string): boolean {
  // Conventional mailbox addresses only; display names and header controls are
  // not accepted. The server performs its own full address validation.
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  return (
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) &&
    !local.startsWith(".") &&
    !local.endsWith(".") &&
    !local.includes("..") &&
    domain.length > 0 &&
    domain
      .split(".")
      .every((label) =>
        /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
      )
  );
}
export function safeSettingsEmailHref(value: string): string | undefined {
  return validText(value, 254, false) && validEmail(value)
    ? `mailto:${encodeURIComponent(value)}`
    : undefined;
}

export function validateSiteSettings(value: SiteSettings): SettingsIssue[] {
  const issues: SettingsIssue[] = [];
  for (const [key, [max, multiline]] of Object.entries(textFields)) {
    const field = key as keyof typeof textFields;
    if (!validText(value[field], max, multiline))
      issues.push({ field, reason: "text" });
  }
  for (const field of ["site_name", "invoice_issuer"] as const) {
    if (typeof value[field] === "string" && !value[field].trim())
      issues.push({ field, reason: "required" });
  }
  for (const [field, choices] of [
    ["logo", ["star", "cloud", "server"]],
    ["theme", ["blue", "teal", "violet"]],
    ["default_locale", ["zh-CN", "en"]],
    ["default_currency", ["CNY", "USD"]],
  ] as const) {
    if (!(choices as readonly unknown[]).includes(value[field]))
      issues.push({ field, reason: "choice" });
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1)
    issues.push({ field: "revision", reason: "revision" });
  if (
    typeof value.support_email === "string" &&
    value.support_email !== "" &&
    !validEmail(value.support_email)
  )
    issues.push({ field: "support_email", reason: "email" });
  for (const field of ["support_url", "display_url"] as const) {
    if (
      typeof value[field] === "string" &&
      value[field] !== "" &&
      !safeSettingsURL(value[field], field === "display_url")
    )
      issues.push({
        field,
        reason: field === "display_url" ? "origin" : "url",
      });
  }
  return issues;
}

function invalidResponse(): never {
  throw new Error("INVALID_SETTINGS_RESPONSE");
}
// Preserve server display strings independently from conservative link safety.
export function readPublicSiteSettings(value: unknown): PublicSiteSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalidResponse();
  const raw = value as Record<string, unknown>;
  const result = Object.fromEntries(
    publicFields.map((field) => [field, raw[field]]),
  ) as unknown as PublicSiteSettings;
  if (
    validateSiteSettings({ ...defaultSiteSettings, ...result }).some(
      (issue) => !["email", "url", "origin"].includes(issue.reason),
    )
  )
    return invalidResponse();
  return result;
}
export function readSiteSettings(value: unknown): SiteSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalidResponse();
  const raw = value as Record<string, unknown>;
  const result = {
    ...readPublicSiteSettings(value),
    revision: raw.revision,
    email_signature: raw.email_signature,
    invoice_issuer: raw.invoice_issuer,
    invoice_address: raw.invoice_address,
  } as SiteSettings;
  if (
    validateSiteSettings(result).some(
      (issue) => !["email", "url", "origin"].includes(issue.reason),
    )
  )
    return invalidResponse();
  return result;
}

import { ApiError } from "./api";

export interface EmailSettings {
  revision: number;
  enabled: boolean;
  host: string;
  port: number;
  tls_mode: "starttls" | "implicit_tls";
  from_address: string;
  from_name: string;
  username_configured: boolean;
  password_configured: boolean;
  key_configured: boolean;
  updated_at: string;
}

export type EmailDraft = Pick<
  EmailSettings,
  "enabled" | "host" | "port" | "tls_mode" | "from_address" | "from_name"
>;

export const defaultEmailSettings: EmailSettings = {
  revision: 1,
  enabled: false,
  host: "",
  port: 587,
  tls_mode: "starttls",
  from_address: "",
  from_name: "",
  username_configured: false,
  password_configured: false,
  key_configured: false,
  updated_at: "0001-01-01T00:00:00Z",
};

export function emailDraft(settings: EmailSettings): EmailDraft {
  return {
    enabled: settings.enabled,
    host: settings.host,
    port: settings.port,
    tls_mode: settings.tls_mode,
    from_address: settings.from_address,
    from_name: settings.from_name,
  };
}

// Pick only documented non-secret fields. Even an accidental server credential
// or diagnostic field must never reach component state or rendering.
export function readEmailSettings(value: unknown): EmailSettings {
  const invalid = () => {
    throw new ApiError("INVALID_RESPONSE", "Invalid email settings response");
  };
  if (!value || typeof value !== "object") return invalid();
  const item = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(item.revision) ||
    (item.revision as number) < 1 ||
    !Number.isInteger(item.port) ||
    (item.port as number) < 1 ||
    (item.port as number) > 65535 ||
    !["starttls", "implicit_tls"].includes(item.tls_mode as string) ||
    [
      "enabled",
      "username_configured",
      "password_configured",
      "key_configured",
    ].some((key) => typeof item[key] !== "boolean") ||
    ["host", "from_address", "from_name", "updated_at"].some(
      (key) => typeof item[key] !== "string",
    )
  )
    return invalid();
  for (const [field, max] of [
    ["host", 253],
    ["from_address", 254],
    ["from_name", 120],
    ["updated_at", 64],
  ] as const) {
    const text = item[field] as string;
    if (
      new TextEncoder().encode(text).length > max ||
      /[\u0000-\u001f\u007f]/.test(text)
    )
      return invalid();
  }
  if (!Number.isFinite(Date.parse(item.updated_at as string))) return invalid();
  return {
    revision: item.revision as number,
    enabled: item.enabled as boolean,
    host: item.host as string,
    port: item.port as number,
    tls_mode: item.tls_mode as EmailSettings["tls_mode"],
    from_address: item.from_address as string,
    from_name: item.from_name as string,
    username_configured: item.username_configured as boolean,
    password_configured: item.password_configured as boolean,
    key_configured: item.key_configured as boolean,
    updated_at: item.updated_at as string,
  };
}

export function validEmailAddress(value: string): boolean {
  return (
    /^[^\s@<>\u0000-\u001f\u007f]+@[^\s@<>\u0000-\u001f\u007f]+$/.test(value) &&
    new TextEncoder().encode(value).length <= 254
  );
}

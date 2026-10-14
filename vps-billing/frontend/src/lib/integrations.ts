import { tr } from "./i18n";
import { ApiError } from "./api";

export interface IntegrationSummary {
  id: string;
  kind: "payment" | "email";
  name: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  status: "disabled" | "ready" | "unavailable";
  capabilities: string[];
  supported_currencies: ("CNY" | "USD")[];
  configuration_fields: {
    key: string;
    label: string;
    type: "string" | "secret_ref" | "url";
    required: boolean;
    secret: boolean;
  }[];
  configuration_mode: "environment";
  limitations: string[];
}

// Only expose the manifest's documented, non-secret fields to the view.
// Unknown fields (including accidental configuration values) are never rendered.
export function readIntegrationManifest(data: unknown): IntegrationSummary[] {
  const invalid = () => {
    throw new ApiError(
      "INVALID_RESPONSE",
      tr(
        "扩展清单格式不正确，请稍后重试。",
        "The integration manifest is invalid. Please try again.",
      ),
    );
  };
  if (
    !data ||
    typeof data !== "object" ||
    !("items" in data) ||
    !Array.isArray(data.items)
  )
    return invalid();
  const strings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((v) => typeof v === "string");
  return data.items.map((item: unknown) => {
    if (!item || typeof item !== "object") return invalid();
    const v = item as Record<string, unknown>;
    if (
      typeof v.id !== "string" ||
      typeof v.name !== "string" ||
      typeof v.description !== "string" ||
      !["payment", "email"].includes(v.kind as string) ||
      !["disabled", "ready", "unavailable"].includes(v.status as string) ||
      typeof v.enabled !== "boolean" ||
      typeof v.configured !== "boolean" ||
      v.configuration_mode !== "environment" ||
      !strings(v.capabilities) ||
      !strings(v.supported_currencies) ||
      !v.supported_currencies.every(
        (currency) => currency === "CNY" || currency === "USD",
      ) ||
      !strings(v.limitations) ||
      !Array.isArray(v.configuration_fields)
    )
      return invalid();
    const fields = v.configuration_fields.map((field: unknown) => {
      if (!field || typeof field !== "object") return invalid();
      const f = field as Record<string, unknown>;
      if (
        typeof f.key !== "string" ||
        typeof f.label !== "string" ||
        !["string", "secret_ref", "url"].includes(f.type as string) ||
        typeof f.required !== "boolean" ||
        typeof f.secret !== "boolean"
      )
        return invalid();
      return {
        key: f.key,
        label: f.label,
        type: f.type as IntegrationSummary["configuration_fields"][number]["type"],
        required: f.required,
        secret: f.secret,
      };
    });
    return {
      id: v.id,
      name: v.name,
      description: v.description,
      kind: v.kind as IntegrationSummary["kind"],
      status: v.status as IntegrationSummary["status"],
      enabled: v.enabled,
      configured: v.configured,
      configuration_mode: "environment",
      capabilities: v.capabilities,
      supported_currencies: v.supported_currencies as ("CNY" | "USD")[],
      limitations: v.limitations,
      configuration_fields: fields,
    };
  });
}

export const previewIntegrations: IntegrationSummary[] = [
  {
    id: "payment.disabled",
    kind: "payment",
    name: "支付 · 未接入",
    description: "此样例展示支付适配器的注册位置，不提供真实收款能力。",
    enabled: false,
    configured: false,
    status: "disabled",
    capabilities: [],
    supported_currencies: [],
    configuration_fields: [],
    configuration_mode: "environment",
    limitations: ["只读样例，未连接支付服务。"],
  },
  {
    id: "email.disabled",
    kind: "email",
    name: "邮件 · 未接入",
    description: "此样例展示邮件适配器的注册位置，不提供真实邮件投递。",
    enabled: false,
    configured: false,
    status: "disabled",
    capabilities: [],
    supported_currencies: [],
    configuration_fields: [],
    configuration_mode: "environment",
    limitations: ["只读样例，未连接邮件服务。"],
  },
];

export function localizedPreviewIntegrations(): IntegrationSummary[] {
  return previewIntegrations.map((item) => ({
    ...item,
    name:
      item.kind === "payment"
        ? tr("支付 · 未接入", "Payments · Disabled")
        : tr("邮件 · 未接入", "Email · Disabled"),
    description:
      item.kind === "payment"
        ? tr(
            "此样例展示支付适配器的注册位置，不提供真实收款能力。",
            "Sample payment adapter registration. Real payments are unavailable.",
          )
        : tr(
            "此样例展示邮件适配器的注册位置，不提供真实邮件投递。",
            "Sample email adapter registration. Real email delivery is unavailable.",
          ),
    limitations: [
      tr(
        "只读样例，未连接外部服务。",
        "Read-only sample. No external service is connected.",
      ),
    ],
  }));
}

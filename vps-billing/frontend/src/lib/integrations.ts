import { isCurrencyCode } from "./currencies";
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
  supported_currencies: string[];
  currency_decimal_places: Record<string, number>;
  configuration_fields: {
    key: string;
    label: string;
    type: "string" | "secret_ref" | "url";
    required: boolean;
    secret: boolean;
  }[];
  configuration_mode: "environment" | "admin_api";
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
      !["environment", "admin_api"].includes(v.configuration_mode as string) ||
      !strings(v.capabilities) ||
      !strings(v.supported_currencies) ||
      !v.supported_currencies.every((currency) => isCurrencyCode(currency)) ||
      !strings(v.limitations) ||
      !Array.isArray(v.configuration_fields)
    )
      return invalid();
    const precision = v.currency_decimal_places;
    if (
      !precision ||
      typeof precision !== "object" ||
      Array.isArray(precision) ||
      v.supported_currencies.length > 32 ||
      new Set(v.supported_currencies).size !== v.supported_currencies.length ||
      Object.keys(precision).length !== v.supported_currencies.length ||
      v.supported_currencies.some(
        (code) =>
          !Object.hasOwn(precision, code) ||
          !Number.isInteger((precision as Record<string, unknown>)[code]) ||
          ((precision as Record<string, number>)[code] ?? -1) < 0 ||
          ((precision as Record<string, number>)[code] ?? 7) > 6,
      )
    )
      return invalid();
    const currencyDecimalPlaces = Object.fromEntries(
      v.supported_currencies.map((code) => [
        code,
        (precision as Record<string, number>)[code]!,
      ]),
    ) as Record<string, number>;
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
      configuration_mode:
        v.configuration_mode as IntegrationSummary["configuration_mode"],
      capabilities: v.capabilities,
      supported_currencies: v.supported_currencies as string[],
      currency_decimal_places: currencyDecimalPlaces,
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
    currency_decimal_places: {},
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
    currency_decimal_places: {},
    configuration_fields: [],
    configuration_mode: "environment",
    limitations: ["只读样例，未连接邮件服务。"],
  },
];

export function localizedPreviewIntegrations(): IntegrationSummary[] {
  return [
    ...previewIntegrations.map((item) => ({
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
    })),
    {
      id: "email.smtp",
      kind: "email",
      name: tr("SMTP · 官方邮件插件", "SMTP · Official email plugin"),
      description: tr(
        "配置受 TLS 保护的 SMTP 服务并发送测试邮件。",
        "Configure a TLS-protected SMTP service and send a test message.",
      ),
      enabled: false,
      configured: false,
      status: "disabled",
      capabilities: [],
      supported_currencies: [],
      currency_decimal_places: {},
      configuration_fields: [],
      configuration_mode: "admin_api",
      limitations: [
        tr(
          "样例预览，不连接邮件服务。",
          "Sample preview; no email service is connected.",
        ),
      ],
    },
  ];
}

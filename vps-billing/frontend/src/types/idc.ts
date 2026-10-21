/** Independent DTO contract, derived only from docs/UI_API_REFERENCE.md. */
export type Locale = "zh-CN" | "en";
export type Role = "customer" | "admin";
export type Mode = "demo" | "api";
export type Query = Record<string, string | number | boolean | undefined>;
export type Minor = number;
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}
export interface Session {
  user: User | null;
  csrf_token: string;
  demo_mode: boolean;
}
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
export interface CurrencyUpdate {
  revision: number;
  default_currency: string;
  currencies: Omit<CurrencyDefinition, "precision_locked" | "usage">[];
}
export interface Plan {
  id: string;
  type_id: string;
  region_id: string;
  node_id: string;
  taxonomy_revision: number;
  name: string;
  description: string;
  region: string;
  currency: string;
  cpu: number;
  memory_gb: number;
  disk_gb: number;
  transfer_tb: number;
  price_minor: Minor;
  price_revision: number;
  currency_format: CurrencyFormat;
  available: boolean;
}
export interface PlanSnapshot {
  plan_id: string;
  name: string;
  region: string;
  cpu: number;
  memory_gb: number;
  disk_gb: number;
  transfer_tb: number;
  billing_cycle: "monthly";
}
export interface InvoiceIdentity {
  name: string;
  address: string;
  support_email: string;
}
export interface Order {
  id: string;
  number: string;
  plan_name: string;
  status: string;
  currency: string;
  hostname: string;
  total_minor: Minor;
  currency_format: CurrencyFormat;
  created_at: string;
  service_id?: string;
  issuer?: InvoiceIdentity;
  plan_snapshot?: PlanSnapshot;
}
export interface Invoice {
  id: string;
  number: string;
  order_id: string;
  status: string;
  currency: string;
  amount_minor: Minor;
  currency_format: CurrencyFormat;
  issued_at: string;
  due_at: string;
  paid_at?: string;
  issuer?: InvoiceIdentity;
}
export interface Service {
  id: string;
  name: string;
  plan_name: string;
  region: string;
  ipv4: string;
  status: string;
  currency: string;
  next_due_at: string;
  price_minor: Minor;
  currency_format: CurrencyFormat;
  cpu: number;
  memory_gb: number;
  disk_gb: number;
}
export interface AdminService extends Service {
  customer_id: string;
}
export interface Audit {
  id: string;
  action: string;
  target: string;
  actor_email: string;
  detail: string;
  created_at: string;
}
export interface AdminAuditEvent extends Audit {
  owner_id: string;
}
export interface AuditEventsPage {
  items: (Audit | AdminAuditEvent)[];
  has_more: boolean;
  next_cursor?: string;
  limit: number;
}
export interface AuditQuery {
  limit?: number;
  cursor?: string;
  action?: string;
  actor_email?: string;
  from?: string;
  until?: string;
  owner_id?: string;
}
export interface Overview {
  active_services: number;
  pending_invoices: number;
  unpaid_total_minor: Minor;
  monthly_total_minor: Minor;
  currency: string;
  currency_format: CurrencyFormat;
  recent_orders: Order[];
  count_scope: "currency";
  recent_orders_scope: "all";
}
export interface AdminOverview {
  customers: number;
  total_services: number;
  unpaid_invoices: number;
  unpaid_total_minor: Minor;
  revenue_minor: Minor;
  currency: string;
  currency_format: CurrencyFormat;
  count_scope: "currency";
  customers_scope: "all";
}
export interface CreateOrderInput {
  plan_id: string;
  hostname: string;
  currency: string;
  quote: { price_minor: Minor; decimal_places: number; price_revision: number };
}
export interface CheckoutSession {
  provider_id: string;
  session_id: string;
  checkout_url: string;
  expires_at: string;
}
export interface OrderPaymentAttempt {
  id: string;
  provider_id: string;
  currency: string;
  state: string;
  amount_minor: Minor;
  currency_decimal_places: number;
  created_at: string;
  updated_at: string;
}
export interface OrderDetails {
  order: Order;
  customer?: User;
  invoice: Invoice | null;
  service: Service | null;
  payment_attempts: OrderPaymentAttempt[];
  audit: Audit[];
  audit_has_more: boolean;
  payment_attempts_has_more: boolean;
}
export interface CustomerAccount extends User {
  disabled: boolean;
  revision: number;
}
export interface CustomerAccountsPage {
  items: CustomerAccount[];
  has_more: boolean;
  next_cursor?: string;
  limit: number;
}
export interface AccountCreateInput {
  email: string;
  name: string;
  role: Role;
  password: string;
  reason: string;
}
export interface AccountUpdateInput {
  name: string;
  role: Role;
  disabled: boolean;
  revision: number;
  reason: string;
}
export interface CatalogPrice {
  currency: string;
  amount_minor: Minor;
  available: boolean;
}
export interface CatalogItem {
  id: string;
  type_id: string;
  region_id: string;
  node_id: string;
  name: string;
  description: string;
  region: string;
  cpu: number;
  memory_gb: number;
  disk_gb: number;
  transfer_tb: number;
  available: boolean;
  prices: CatalogPrice[];
}
export interface Catalog {
  revision: number;
  currency_revision: number;
  taxonomy_revision: number;
  items: CatalogItem[];
}
export interface CatalogInput extends Omit<CatalogItem, "id"> {
  revision: number;
  currency_revision: number;
  taxonomy_revision: number;
  reason: string;
}
export interface CatalogResult {
  revision: number;
  currency_revision: number;
  taxonomy_revision: number;
  plan: CatalogItem;
}
export interface PlanPriceList {
  revision: number;
  currency: string;
  currency_format: CurrencyFormat;
  plans: {
    plan_id: string;
    plan_name: string;
    amount: string;
    plan_available: boolean;
    available: boolean;
    amount_minor: Minor;
  }[];
}
export interface PlanPricesUpdate {
  revision: number;
  currency: string;
  prices: {
    plan_id: string;
    amount: string;
    available: boolean;
    plan_available: boolean;
  }[];
}
export interface PublicSiteSettings {
  default_locale: Locale;
  default_currency: string;
  site_name: string;
  company_name: string;
  support_email: string;
  support_url: string;
  display_url: string;
  logo: "star" | "cloud" | "server";
  theme: "blue" | "teal" | "violet";
}
export interface SiteSettings extends PublicSiteSettings {
  revision: number;
  email_signature: string;
  invoice_issuer: string;
  invoice_address: string;
}
export interface EmailSettings {
  revision: number;
  port: number;
  enabled: boolean;
  username_configured: boolean;
  password_configured: boolean;
  key_configured: boolean;
  plugin_available: boolean;
  destination_allowed: boolean;
  host: string;
  from_address: string;
  from_name: string;
  plugin_version: string;
  tls_mode: "starttls" | "implicit_tls";
  plugin_status: "not_installed" | "disabled" | "unavailable" | "approved";
  updated_at: string;
}
export interface EmailSettingsUpdate {
  revision: number;
  enabled: boolean;
  host: string;
  port: number;
  from_address: string;
  from_name: string;
  tls_mode: "starttls" | "implicit_tls";
  username?: string;
  password?: string;
  clear_username?: boolean;
  clear_password?: boolean;
}
export interface IntegrationSummary {
  id: string;
  name: string;
  description: string;
  kind: "payment" | "email";
  enabled: boolean;
  configured: boolean;
  status: "disabled" | "ready" | "unavailable";
  capabilities: string[];
  supported_currencies: string[];
  limitations: string[];
  currency_decimal_places: Record<string, number>;
  configuration_mode: "environment" | "admin_api";
  configuration_fields: {
    key: string;
    label: string;
    type: "string" | "secret_ref" | "url";
    required: boolean;
    secret: boolean;
  }[];
}
export interface UpdateAsset {
  name: string;
  sha256: string;
  id: number;
  size: number;
}
export interface UpdateCandidate {
  distribution_format: "archive-v1" | "raw-binaries-v1";
  component: "core" | "smtp";
  tag: string;
  version: string;
  release_url: string;
  notes: string;
  source_sha: string;
  catalog_sha256: string;
  published_at: string;
  release_id: number;
  run_id: number;
  run_attempt: number;
  compatible: boolean;
  update_available: boolean;
  preconditions: string[];
  assets: UpdateAsset[];
}
export interface UpdateStatus {
  current: {
    core_version: string;
    smtp_version: string;
    smtp_status: "not_installed" | "disabled" | "unavailable" | "approved";
    smtp_protocol?: string;
    smtp_core_min?: string;
    smtp_core_max_exclusive?: string;
    plugin_policy_revision: number;
  };
  source: {
    repository: string;
    status: "not_checked" | "available" | "unavailable";
  };
  checked_at: string;
  items: UpdateCandidate[];
  mode: "manual_host_handoff";
}
export interface UpdateHandoffInput {
  component: "core" | "smtp";
  tag: string;
  source_sha: string;
  catalog_sha256: string;
  release_id: number;
  acknowledge_manual_handoff: true;
}
export type NativeOperationView =
  | { state: "unconfigured" | "absent" | "unavailable" }
  | {
      state: "available";
      operation: {
        schema: 1;
        operation_id: string;
        action: "install" | "upgrade" | "recover";
        status:
          | "checking"
          | "prepared"
          | "executing"
          | "succeeded"
          | "failed"
          | "needs_manual_recovery"
          | "rolled_back";
        phase: string;
        target_core_version: string;
        target_source_sha: string;
        previous_core_version: string;
        previous_source_sha: string;
        maintenance: boolean;
        active_release_changed: boolean;
        https_ready: boolean;
        business_validation_required: boolean;
        database_migration: { started: boolean; completed: boolean };
        service_action: "none" | "stopped" | "started" | "previous_started";
        program_rollback:
          "none" | "verified_old_schema" | "blocked_schema_or_readiness";
        error_code:
          "none" | "operation_failed" | "interrupted_requires_recovery";
        started_at: string;
        updated_at: string;
      };
    };

export function validMinor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
export function validCurrencyFormat(value: unknown): value is CurrencyFormat {
  if (!value || typeof value !== "object") return false;
  const f = value as CurrencyFormat;
  return (
    /^[A-Z]{3}$/.test(f.code) &&
    typeof f.name === "string" &&
    typeof f.prefix === "string" &&
    typeof f.suffix === "string" &&
    Number.isInteger(f.decimal_places) &&
    f.decimal_places >= 0 &&
    f.decimal_places <= 6
  );
}
/** Exact decimal string; no Number division, rounding, or cross-currency conversion. */
export function formatMinor(minor: number, decimalPlaces: number): string {
  if (
    !validMinor(minor) ||
    !Number.isInteger(decimalPlaces) ||
    decimalPlaces < 0 ||
    decimalPlaces > 6
  )
    throw new Error("INVALID_AMOUNT");
  const integer = BigInt(minor),
    negative = integer < 0n;
  const digits = (negative ? -integer : integer)
    .toString()
    .padStart(decimalPlaces + 1, "0");
  return `${negative ? "-" : ""}${decimalPlaces ? `${digits.slice(0, -decimalPlaces)}.${digits.slice(-decimalPlaces)}` : digits}`;
}
export function formatMoney(
  minor: number,
  snapshot: CurrencyFormat | undefined,
  _locale?: Locale,
): string {
  if (!validMinor(minor) || !validCurrencyFormat(snapshot)) return "—";
  return `${snapshot.prefix}${formatMinor(minor, snapshot.decimal_places)}${snapshot.suffix} ${snapshot.code}`;
}
/** Positive canonical decimal only. Return a checked safe minor-unit integer. */
export function parseMinor(text: string, decimalPlaces: number): number {
  if (
    !Number.isInteger(decimalPlaces) ||
    decimalPlaces < 0 ||
    decimalPlaces > 6 ||
    typeof text !== "string" ||
    text.length > 32 ||
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)
  )
    throw new Error("INVALID_AMOUNT");
  const [whole = "", fraction = ""] = text.split(".");
  if (fraction.length > decimalPlaces)
    throw new Error("INVALID_AMOUNT_PRECISION");
  const minor =
    BigInt(whole) * 10n ** BigInt(decimalPlaces) +
    BigInt(fraction.padEnd(decimalPlaces, "0") || "0");
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("INVALID_AMOUNT");
  return Number(minor);
}
/** Validate a checkout result before exposing its link; never mark an invoice paid. */
export function validateCheckout(session: CheckoutSession): URL {
  const url = new URL(session.checkout_url);
  if (
    !session.provider_id.trim() ||
    !session.session_id.trim() ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !Number.isFinite(Date.parse(session.expires_at)) ||
    Date.parse(session.expires_at) <= Date.now()
  )
    throw new Error("INVALID_CHECKOUT");
  return url;
}

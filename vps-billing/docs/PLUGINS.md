# Typed integration adapters (v0.2 foundation)

This release provides an extension boundary, not connected payment or email services. No external credentials, charges, messages, webhook settlement, refunds or provisioning are implemented. Only the disabled payment/email adapters are installed in the server. Test doubles exist exclusively in `_test.go` files and never ship as registered providers.

## Architecture

`backend/internal/integrations` owns the typed interfaces, manifests, configuration validation, immutable registry and bounded provider calls. `billing.NewAppWithIntegrations` accepts a validated registry; the ordinary constructor defaults to the disabled registry. Providers receive typed immutable business data and context, not the billing Store or a database handle. Billing remains responsible for authorization, authoritative monetary values and financial state.

- `PaymentProvider.CreateCheckout(context.Context, CheckoutRequest) (Checkout, error)` creates a hosted checkout. It must honor context cancellation and the invoice-scoped idempotency key. Return session/provider ID, HTTPS checkout URL and expiry. Registry accepts only a compiled, exact host allowlist, no URL credentials, non-default ports or fragments. There are no client-selected return URLs or provider IDs.
- `PaymentProvider.VerifyCallback(context.Context, CallbackRequest) (VerifiedPayment, error)` is the future raw-body signature-verification boundary. No HTTP callback endpoint invokes it in this release.
- `EmailProvider.Send(context.Context, EmailMessage) (EmailReceipt, error)` is the future transactional-template delivery boundary. The disabled implementation returns `ErrUnavailable`, never a fake success. No current account or order flow sends email.

Definitions are registered by trusted Go source in a single composition root (`cmd/server`), then validated and initialized in ID-sorted order. Duplicate IDs (including attempts to override disabled IDs), wrong-kind selections, unknown providers/config fields, malformed manifests, required missing settings and unresolved selected secret references fail startup. Factories must fail on invalid provider-specific configuration, honor context deadlines and return concurrency-safe adapters. Nil and typed-nil factory results fail startup. There is no plugin upload, executable scripting, Go runtime plugin loading, provided SQL handle, generic settings-write endpoint or hot credential reload. These adapters run as trusted compiled application code in the same process: the interface boundary is not a security sandbox for malicious code. Untrusted third-party extensions would require a separately reviewed process/RPC isolation design.

## Selection and secrets

`PAYMENT_PROVIDER=payment.disabled` and `EMAIL_PROVIDER=email.disabled` are defaults when unset. Selecting an uninstalled name is a startup error, not fallback success. Change environment and restart to switch among compiled installed adapters. A new adapter requires source registration, tests and a rebuild/deploy.

Each installed adapter declares `configuration_fields` with `key`, `label`, `type` (`string`, `url`, `secret_ref`), `required` and `secret`. Secret fields must be `secret_ref`, with an `env:UPPER_CASE_NAME` or `file:/absolute/path` reference, not a literal secret. Production secrets should use restricted mounted files or managed environment injection. `ResolveSecret` reads references without exposing source paths or values in errors. Do not put secrets, references, callback bodies or provider error strings in API responses or logs.

`INTEGRATIONS_CONFIG_FILE` optionally selects a local JSON file mapping provider IDs to schema fields. It is capped at 64 KiB and rejects trailing JSON, duplicate provider IDs/field keys, nulls and non-string values. Registry validation rejects unknown providers and fields. For an installed adapter, for example:

```json
{"payment.example":{"api_key":"file:/run/secrets/payment_key","merchant":"example-merchant"}}
```

This example adapter is not installed. Do not set it on the shipped server. New compiled adapters receive the matching map through their factory, so changing their configuration does not require business-code changes. The default server needs no config file or provider secret settings. Configuration URL fields require HTTPS syntactically, but each adapter must independently restrict endpoints to the intended provider and prevent SSRF; do not use a configurable arbitrary upstream endpoint by default. Do not accept credentials through a browser settings form in this release.

## Read-only administrator API

GET `/api/v1/admin/integrations` requires an authenticated admin session and returns:

```json
{
  "data": {
    "items": [{
      "id": "payment.disabled",
      "kind": "payment",
      "name": "支付未接入",
      "description": "安全关闭的默认适配器，不执行外部操作",
      "enabled": false,
      "configured": false,
      "status": "disabled",
      "capabilities": [],
      "configuration_fields": [],
      "configuration_mode": "environment",
      "limitations": ["未安装真实服务商；不会扣款、发送邮件或变更账务状态"]
    }]
  }
}
```

The response also contains `email.disabled`; items are sorted by ID. `enabled` means selected and non-disabled. `configured` means required manifest settings are present (not proof of provider availability or delivery). `ready` means the selected factory initialized successfully; it is not an active remote health check. Unselected/disabled integrations have `status: disabled`; `unavailable` is reserved for future health reporting. Schemas are included in this GET response; no separate schema endpoint is needed. No values or secret-reference strings are serialized. POST is unsupported, customers receive 403, and anonymous callers receive 401.

## Checkout and future settlement obligations

The checkout HTTP handler retains existing session, CSRF, Host and owner checks, verifies invoice state is unpaid with positive amount and no paid timestamp, and passes only server-owned invoice/order/account IDs, amount and currency to the selected adapter. With the shipped registry it returns 503 `PAYMENT_NOT_CONFIGURED`. A test-injected adapter can return a hosted checkout result, but checkout does not change invoice, order, service, ledger or outbox state. Adapter errors are generic 502s; there is no automatic retry of external effects.

Before enabling ANY real provider, implement and independently review the full payment lifecycle. A successful callback signature alone is not settlement authorization:

1. Verify provider signature over the exact raw body, timestamp/replay window, event type and merchant identity; bound callback body size and processing time. Browser CSRF cannot substitute for signature verification. The future callback route must be deliberately separate from cookie-authenticated mutations.
2. Normalize to `VerifiedPayment`: provider/event/transaction/merchant IDs, account/order/invoice IDs, exact minor amount/currency, `settled` status and settlement timestamp.
3. Load expected values from durable core records and trusted merchant configuration; `ValidateSettlement` compares all identities and money. Never construct expectations from callback claims.
4. In one MySQL transaction, lock and revalidate the payable invoice/order, enforce unique `(provider_id,event_id)` AND `(provider_id,transaction_id)`, record payment and balanced ledger entries/audit, change invoice/order exactly once and emit a `payment.settled` outbox event. Retries must acknowledge an identical persisted event without duplicate effects; mismatched replays require rejection/review. This durable deduplication and ledger transaction are NOT implemented here.
5. Implement reconciliation for uncertain responses, refunds, disputes, currency/rounding policy, checkout expiry/recreation and retry budgets. Checkout idempotency currently uses a stable invoice key; each future adapter must specify how expiration is handled without creating duplicate charge opportunities.
6. Only a reviewed settled-payment consumer may provision services. The existing `order.created` outbox remains unconsumed and is not payment authorization.

SMS, object storage and VM/controller integrations are future extension points, not current provider kinds. Add separate typed interfaces and domain-specific permissions/capabilities when their actual use cases are implemented, rather than a catch-all `Execute(map)` API. VM orchestration especially requires its own outbox consumer, idempotency, authenticated controller boundary and lifecycle reconciliation.

## Adding an adapter

1. Create a dedicated internal adapter package implementing only the relevant interface. Use an HTTP client with transport/request timeouts, constrained destinations, no credential logging and cancellation-aware calls.
2. Define a unique manifest, minimal capabilities, explicit config schema and limitations. Payment adapters must declare exact checkout hostnames in trusted registration code.
3. Register a factory at startup, configure its schema fields through the deployment JSON file (with environment/file references for secrets), and validate provider-specific settings before returning.
4. Test using local fakes: timeout/cancellation, signatures and replay, wrong merchant/account/order/amount/currency, URL rejection, idempotency, unavailable states, redaction, duplicate registration and concurrent use. No test may call a live payment/email service by default.
5. Complete the missing settlement/reconciliation or email delivery/retry mechanisms before production enablement. The registry by itself is not production certification.

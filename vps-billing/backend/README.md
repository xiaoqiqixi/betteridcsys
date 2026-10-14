# Aster Billing API

Go HTTP API, MySQL 8.4/InnoDB persistence, and a deliberately isolated in-memory demo. This is a first implementation for test-server acceptance, not a production certification, accounting ledger, tax engine, or ready-to-charge billing service.

## Local demonstration

Requirements: Go 1.24+ (use a supported current patched toolchain for deployment).

```sh
cd backend
go mod download
go test -race ./...
go vet ./...
go build -buildvcs=false -o ./bin/aster-api ./cmd/server
APP_MODE=demo APP_ORIGIN=http://localhost:5173 ./bin/aster-api
```

API listens on `127.0.0.1:8080` by default. Frontend should proxy `/api` same-origin. No CORS wildcard support. In a constrained executor with read-only home, set writable `GOCACHE=/tmp/aster-go-cache GOPATH=/tmp/aster-go-path` first. This development workspace used `/tmp/go/bin/go` because `/usr/bin/go` is an unrelated program.

Public demonstration accounts, usable **only in explicit APP_MODE=demo**:

- Customer: `demo@aster.local` / `DemoCustomer!2026`
- Administrator: `admin@aster.local` / `DemoAdmin!2026`
- Separate customer for ownership tests: `other@aster.local` / `DemoOther!2026`

Demo is empty initially: creating an order creates its unpaid invoice and safe audit event. There are no fabricated paid invoices or active services. Restarting discards all demo data. Demo cookies are not Secure for local HTTP, but remain HttpOnly and SameSite=Strict. Never bind demo to a public interface or expose it through a public tunnel.

## Production-mode configuration

Default mode is production. Startup does not seed demo accounts and refuses missing origin, DSN, short/example session secrets, and invalid proxy CIDRs.

| Environment | Purpose |
| --- | --- |
| `APP_MODE` | `production` (default) or explicit `demo` |
| `LISTEN_ADDR` | default `127.0.0.1:8080`; internal container `0.0.0.0:8080` |
| `APP_ORIGIN` | exact canonical HTTPS origin, no path/trailing slash; e.g. `https://billing.example.com` |
| `SESSION_SECRET` / `SESSION_SECRET_FILE` | independent randomly generated secret, at least 32 bytes; prefer 32 random bytes hex-encoded |
| `MYSQL_DSN` / `MYSQL_DSN_FILE` | Go MySQL driver DSN; e.g. `aster:...@tcp(db:3306)/aster?parseTime=true&tls=true` |
| `MYSQL_ALLOW_INSECURE` | default false. `true` only for an explicitly isolated private database network; never public MySQL |
| `TRUSTED_PROXY_CIDRS` | comma-separated exact trusted reverse-proxy CIDRs. Empty trusts no forwarded addresses |
| `BOOTSTRAP_EMAIL` | email for CLI user creation; demo `@aster.local` blocked |
| `BOOTSTRAP_NAME` | required display name, up to 120 UTF-8 bytes |
| `BOOTSTRAP_ROLE` | customer by default; explicit `admin` for administrator |
| `BOOTSTRAP_PASSWORD` / `BOOTSTRAP_PASSWORD_FILE` | unique 16–72 byte secret, not demonstration/example password |

File forms take precedence. Do not store secrets in source, shell history, images, or DSNs in logs. Use restricted mounted secret files. Production cookies use `__Host-aster_session`, Secure, HttpOnly, SameSite=Strict and `/` path. TLS terminates at the trusted reverse proxy. Backend HTTP port must not be public. Proxy must preserve the canonical Host, and replace X-Real-IP with a verified client address. Forwarded addresses are accepted only from configured direct peer CIDRs; X-Forwarded-For is not trusted. An outer edge proxy requires its own narrowly configured real-IP trust chain. Never trust `0.0.0.0/0` or arbitrary client headers.

## Database setup and user creation

Create a utf8mb4 MySQL 8.4 database using deployment tooling. Run migrations with a dedicated DDL account, then runtime with a lower-privilege DML account. Both must have access to the same database.

```sh
# Supply APP_ORIGIN, SESSION_SECRET_FILE and MYSQL_DSN_FILE first.
./bin/aster-api -migrate
# Switch MYSQL_DSN_FILE to runtime credentials after migration.
BOOTSTRAP_EMAIL=operator@example.com BOOTSTRAP_NAME=Operator \
BOOTSTRAP_ROLE=admin BOOTSTRAP_PASSWORD_FILE=/run/secrets/bootstrap_password \
  ./bin/aster-api -create-user
# To create a customer, use BOOTSTRAP_ROLE=customer and that customer's credentials.
./bin/aster-api
```

No public registration, password reset, MFA, email verification, user editing, catalog editor or role mutation API exists. Do not pretend these features are operational. CLI creation is intended for controlled test-server onboarding only until account lifecycle work is completed.

Migration 1 is embedded, guarded by a MySQL advisory lock, recorded with a SHA-256 checksum in `schema_migrations`, and safe to resume after interrupted initial DDL. MySQL DDL is not transactionally rollbackable. Never modify an applied migration: future schema changes need a new numbered migration and upgrade tests. Current migrator supports version 1 only. `/readyz` validates the version-1 checksum as well as database access. Backup and test restore before schema changes.

Migration seeds three **unavailable** USD example plans. No account is seeded. An operator must review actual product, region, currency, tax treatment, pricing and capacity before enabling any plan. For an isolated acceptance database only, an operator can enable the starter example:

```sql
UPDATE plans SET available = TRUE WHERE id = 'starter';
```

The API never accepts client prices. It reads and locks the plan inside the order transaction and stores immutable price/name snapshots. The `orders`, `invoices`, `order_requests`, `audit_events` and `outbox_events` changes commit atomically. No service or external resource is provisioned by this action.

## Browser flow / security

1. GET `/api/v1/session` to obtain a session cookie and CSRF token.
2. POST `/api/v1/auth/login` with JSON email/password and `X-CSRF-Token`.
3. Use the rotated CSRF token returned by login, or GET session again.
4. POST `/api/v1/orders` with JSON `{ "plan_id": "starter", "hostname": "web-1" }` and a unique `Idempotency-Key` (8–128 ASCII alphanumeric/`_.:-`). Keep the same key and body when retrying an uncertain result.
5. All mutations require the CSRF header. If Origin is supplied it must exactly match APP_ORIGIN. Unknown fields (including price, owner and role) are rejected.
6. Logout deletes the authenticated session and rotates the anonymous cookie/token. Sessions expire after 8 hours; database contains SHA-256 hashes, not bearer tokens.

A repeated identical order returns the original order. Reusing a key with a different body returns 409. Concurrent same-key requests serialize on a unique `(user_id, request_key)` database row. Deadlock/lock-timeout failures have bounded transaction retries. An uncertain network error after commit is recovered by retrying the same idempotency key, never by assuming failure and issuing a new key.

SQL is parameterized. Customer invoice lookup includes ownership in SQL; admin list routes enforce admin role from server-side session identity. Customers cannot choose another owner. Login uses bcrypt, generic invalid-credential responses and dummy hashing for unknown users. Login throttles IP and email within each API process. Request body is capped at 16 KiB, unknown JSON fields rejected, server/header/context timeouts configured. Errors are structured and redact SQL, credentials and internals.

## Explicit payment/provisioning boundaries

POST `/api/v1/invoices/{id}/checkout` verifies owner and payable state, then delegates through the typed integration registry. The shipped disabled provider returns HTTP 503 `PAYMENT_NOT_CONFIGURED`. No real provider has been implemented. There is no environment switch that silently simulates paid status. There is no wallet, saved-card form, payment webhook, balance mutation, refund endpoint, or renewal job.

The transactional outbox records `order.created` but has **no consumer**, deliberately. An unpaid order must never be interpreted as authorization to provision. Future payment integration needs verified signed webhooks, event idempotency, reconciliation, refunds, chargeback and audit flows before a `payment.settled` transition and provisioning worker are enabled.

## Pluggable integrations

Payment and email use compiled typed adapters in `internal/integrations`. The immutable registry is dependency-injected; providers never receive SQL/Store access. `PAYMENT_PROVIDER` defaults to `payment.disabled`; `EMAIL_PROVIDER` defaults to `email.disabled`. Optional `INTEGRATIONS_CONFIG_FILE` loads a local JSON provider-to-field map, capped at 64 KiB, with duplicate keys, unknown fields/providers, trailing JSON and non-string values rejected. Secret fields accept references only. Unknown selections or invalid selected configuration stop startup. These are environment selections applied on restart, not dynamic plugin uploads. Adding a provider requires a registered Go adapter and rebuild. Neither default adapter reports successful payment/email delivery.

GET `/api/v1/admin/integrations` returns `{data:{items:[...]}}` with provider manifests, redacted configuration schemas and status, only to administrators. It never returns configured values or secret-reference strings. No configuration-write route exists. Secrets for future adapters use environment or mounted-file references, not browser-submitted credentials. Checkout result URLs are restricted to provider-specific exact HTTPS hosts and provider calls have bounded context deadlines.

See [plugin architecture and extension guide](../docs/PLUGINS.md) for the precise API, configuration/reference model, callback verification contract and mandatory future durable payment-deduplication/ledger work. Callback normalization and validation contracts exist, but there is no webhook route or settlement implementation. SMS, storage and controller are documented future domains, not installed providers. No schema migration is needed for this iteration.

## Verification

```sh
go test -race -v ./...
go vet ./...
go build -buildvcs=false ./cmd/server
```

Go tests also cover registry validation/redaction, duplicate registration rejection, unavailable defaults, secret references, checkout URL rejection, settlement-field comparison, injected test adapters, admin integration access, ownership/CSRF before provider calls and no automatic paid transition. Go tests cover CSRF/origin rejection, cookie flags/Host validation, session logout, customer ownership, admin bypass, price tampering, exact server pricing, replay mismatch, concurrent same-key requests, and fail-closed checkout. Root `tests/` contains independent HTTP regression tests.

Real MySQL integration is **optional and skipped unless explicitly configured**:

```sh
# Dedicated disposable database name MUST contain _test. Never production.
ASTER_MYSQL_TEST_DSN='tester:...@tcp(127.0.0.1:3306)/aster_test?parseTime=true' \
  go test -race -v ./internal/billing -run TestMySQLTransactionalOrders
```

The test applies migration, verifies repeat migration/readiness, creates isolated fixture user and plan, races 16 duplicate orders, checks one order/invoice/audit/idempotency/outbox record, owner filters and failed-order rollback, then cleans only its fixture records. It requires schema/fixture DDL and DML permission. A live MySQL instance was not available in the development executor, so this test was authored but **not run** there. Container image builds, restore drills, actual TLS deployment and MySQL 8.4 acceptance remain release gates.

## Remaining production release gates

- Complete live MySQL acceptance, migrations/restore/failure injection and security review on test infrastructure.
- Connect and independently verify payment/refund/reconciliation and provisioning systems. No real charges before that review.
- Implement verified registration/account recovery, MFA, credential rotation and account/session lifecycle controls.
- Replace process-local login limiter with shared infrastructure before multiple API replicas; layer trusted-edge rate limiting. Sessions themselves are database-backed.
- Add pagination: current list APIs return at most 1,000 recent records; overview totals use untruncated SQL aggregates, and invoice detail is direct owner-scoped lookup. Do not treat list output as complete financial exports.
- Add approved retention/session-expiry cleanup, append-only/external audit retention, operational monitoring, alerting, backup/restore, secret rotation and disaster recovery procedures.
- Confirm currency, taxation, invoice legal requirements, renewals, cancellation and refund policy. USD values are provisional examples.

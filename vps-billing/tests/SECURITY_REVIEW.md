# Security and production-readiness review

Reviewed 2026-10-14. Scope: the Go API, MySQL schema/store, startup configuration, and local HTTP behavior. This is an engineering review, not a penetration-test certification or an authorization to deploy.

## Verdict

**Not ready to accept real money or host production customer operations.** The implemented order/invoice foundation passes the local security regressions below. Live payment confirmation, a financial ledger/reconciliation workflow, a provisioning consumer, recovery drills, and actual MySQL integration evidence are still absent. The demonstration must remain local and clearly labeled.

## Executed evidence

- `tests/security_smoke.py`: **10 tests passed** against a freshly built Go binary in explicit demo mode on loopback. Results: `tests/http-smoke-results.txt`.
- `tests/config_smoke.py`: **5 tests passed** against that binary. Results: `tests/config-smoke-results.txt`.
- `go test -buildvcs=false -race ./...`: passed independently, including backend package tests (16.112s). No race was reported in the tested paths.
- No MySQL server, container runtime, external deployment, real payment, or actual resource provisioning was exercised by this reviewer. HTTP tests use the in-memory store. In particular, concurrent HTTP idempotency passing does **not** establish MySQL locking behavior.

HTTP tests check unauthenticated data/admin denial; customer/admin separation; positive admin read access without password hashes; login and mutation CSRF; foreign Origin rejection; hostile Host rejection; HttpOnly/SameSite cookies; login token rotation; logout invalidation including replay of the old cookie; server-authoritative pricing and unexpected amount fields; identical idempotency replay; different-body conflict; six simultaneous duplicate submissions yielding one order ID; fail-closed checkout preserving unpaid state; and another customer's denial on invoice detail and checkout.

Configuration tests check that default startup is not demo, example secrets fail, production HTTP origin fails, missing MySQL configuration fails, and an unknown mode fails.

## Findings fixed during review

1. **Invoice detail silently lost records after the newest 1,000.** Replaced capped-list scanning with direct owner-scoped lookup in `backend/internal/billing/http.go` and `mysql.go`.
2. **Financial/admin summary counts could truncate at 1,000.** `Summary` now uses full SQL aggregates in a repeatable-read read-only transaction; list caps no longer define the totals.
3. **Proxy clients shared one login IP budget.** Explicit trusted proxy CIDRs and validated `X-Real-IP` handling added in `http.go`. Deployment must supply the correct narrow trust boundary; arbitrary forwarded headers from untrusted peers are ignored.
4. **Host was not validated.** Production uses the canonical origin host; demo now permits the canonical host or localhost/loopback. Hostile-host HTTP regression passes.
5. **Order transactions lacked transient lock retries.** MySQL deadlock/lock-timeout errors now trigger at most three attempts with rollback and context-aware waits. Actual lock contention remains untested.
6. **Schema migrations had no version/checksum record.** Initial schema now records its checksum under a migration lock and readiness checks the expected record. This is an initial migration foundation, not proof of future upgrade/rollback safety.

## Remaining release blockers and bounded limitations

### Must close before real financial operation

- **No live payment/provider webhook state machine.** Checkout deliberately returns 503. Do not replace this with a client-controlled paid flag. Before release, implement verified signed webhooks, provider-event deduplication, exact amount/currency matching, atomic paid transitions, refund/chargeback handling and reconciliation against immutable journal entries. Current invoice/order fields are not a full accounting ledger.
- **MySQL runtime evidence is missing.** Run migration against the supported MySQL version, test real transaction rollback at each insert, same-key concurrency, conflicting replay, plan availability changes, 1,000+ record summaries and old-invoice lookup, connection interruption/ambiguous commit replay, session revocation after restart, and backup restore. Schema correctness cannot be inferred from demo-memory tests.
- **Outbox is durable storage only.** `CreateOrder` transaction writes `order.created`, but no consumer/claim lease/retry/dead-letter/delivery deduplication implementation exists. This event is pending payment and must never be treated as authorization to provision. Add a separately authorized, idempotent paid-order workflow before any controller integration.
- **Operational security and recovery remain unvalidated.** No deployed TLS/edge verification, backup restoration, alerting, secrets rotation, external dependency-vulnerability assessment, or load/abuse test has been performed.

### Must define before exposing real customer/admin accounts

- Authentication is password/session login only. There is no implemented password recovery/change workflow, administrator MFA, or user-facing revoke-all-sessions/security response flow. Logout correctly revokes the current session; passwords/roles are looked up server-side each request. Add an explicit incident/recovery procedure and tests before exposure.
- Audit events currently cover order creation, not a complete durable authentication/admin change trail. Implement reviewed successful/failed authentication, account-security and administrative events without logging passwords/tokens.
- Login rate counters are in-memory and per-process. A restart resets them and multiple replicas do not share a budget. Configure and validate edge/distributed abuse controls, especially proxy topology and shared-IP users, before public operation.
- List endpoints still return a maximum of 1,000 without a cursor/has-more contract. Full aggregates and direct invoice access are fixed, but large-account browsing/export is incomplete. Add explicit pagination and archival/export policy.
- Expired database sessions and idempotency/outbox/audit retention need bounded, documented operational maintenance. Do not delete financial audit history merely to reduce storage.

## Reproduce local tests

From the repository root, build the backend, start a fresh loopback demo instance, then run:

```sh
cd backend
go build -buildvcs=false -o /tmp/aster-security-server ./cmd/server
cd ..
APP_MODE=demo APP_ORIGIN=http://127.0.0.1:18080 LISTEN_ADDR=127.0.0.1:18080 /tmp/aster-security-server &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
sleep 1
TEST_CUSTOMER_PASSWORD='DemoCustomer!2026' \
TEST_ADMIN_PASSWORD='DemoAdmin!2026' \
TEST_SECOND_EMAIL=other@aster.local \
TEST_SECOND_PASSWORD='DemoOther!2026' \
python3 tests/security_smoke.py --base http://127.0.0.1:18080
python3 tests/config_smoke.py --binary /tmp/aster-security-server
```

These are published local-demo credentials only. Never use them for a production account. Run the suite against a fresh demo process to avoid consuming the login limiter budget across repeated test runs. For a distinct frontend origin pass `--origin` or `TEST_ORIGIN`; no CORS relaxation is required for the same-origin proxy architecture.

## Provider adapter addendum (2026-10-14 03:51 UTC)

Independent final-current checks: Go race/vet/build pass, HTTP 11/11 and production config 5/5 pass, frontend build and 21 component/unit tests pass. New HTTP test verifies integration manifest is administrator-only, read-only, disabled by default, and contains no config values. Payment checkout remains fail-closed with no real providers. The registry introduces trusted compiled adapter boundaries, not isolation of malicious third-party code. No runtime plugin upload, outgoing payment/email execution, real webhook settlement or database evidence was added. Existing production blockers remain.

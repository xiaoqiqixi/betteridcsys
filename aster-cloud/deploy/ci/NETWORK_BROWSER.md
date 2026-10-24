# Network console browser gate

`network-browser` in `.github/workflows/cloud.yml` is a non-skipping
Ubuntu 24.04 acceptance job. It builds the real Vue bundle and starts the real
console HTTP/session/RBAC/CSRF handlers, SQL store and asynchronous overlay
runner against `mysql-native.sh`'s independent MySQL 8.4 Unix-socket fixture.
There is **no live KVM node**: the existing deterministic node RPC test double
records receipts and loses exactly one `program` acknowledgement. Actual Linux
NAT packet flow is checked separately in the Ubuntu 22.04/24.04 `native-nat`
matrix; browser acceptance does not establish physical cross-node reachability.

## Reproduce in a disposable Ubuntu 24.04 runner

Use the workflow's pinned Go 1.27.3, Node 24.19.0 and **Playwright 1.64.0**.
Build `aster-cloud/frontend` with `npm ci --ignore-scripts && npm run build`.
Provision the existing native runner prerequisites; install Firefox through the
pinned Playwright CLI and `libnss3-tools`. Keep browser packages outside product
dependencies in a private scratch directory. Export:

- `RUNNER_TEMP`: a writable, private runner scratch directory;
- `PLAYWRIGHT_MODULE_DIR`: the pinned scratch `node_modules` directory;
- `PLAYWRIGHT_BROWSERS_PATH`: the scratch browser download directory.

Then run from the repository root:

```sh
bash vps-billing/deploy/ci/mysql-native.sh -- \
  bash aster-cloud/deploy/ci/network-browser.sh
```

Do not point this runner at a production database. It deliberately rejects a
missing native fixture, root execution or an existing output directory. It
discards inherited `ASTER_CLOUD_TEST_DSN` values before starting the helper. The `.gotxt` helper is introduced by an explicit Go
`-overlay`; it is absent from ordinary tests and all production binaries.

## TLS and cleanup

All keys and the one-day, localhost-constrained CA are generated inside private
CI scratch. The server listens only on `127.0.0.1:5447`. The real Firefox first
must reject the untrusted CA. `certutil` then trusts that CA **only in the new
private NSS profile**, and Firefox must connect with `ignoreHTTPSErrors: false`.
No system CA store, macOS keychain, global browser policy or certificate warning
is modified/bypassed. The signing key is deleted immediately after signing.

On success and failure the runner signals its owned fixture to stop and waits
for the test result. Passing additionally requires database assertions that
plan, VPC creation, lost-ACK reconciliation and recovery actually persisted,
and that original financial/node request bytes, network snapshot bytes and
initial node receipts stayed unchanged. UI success alone is not sufficient.
The fixture database, credentials, cookies, NSS profile, remaining TLS key,
private logs and package scratch are removed by the owned cleanup routines.

## Evidence

Only `*.png`, `report.json`, `tls.json` and `fixture.json` from
`aster-cloud/artifacts/network-browser` are uploaded (seven-day retention).
Screenshots are taken only on signed-in business pages. Reports contain bounded
check results and synthetic operation paths, not headers, tokens, passwords,
DSNs, raw response bodies, DOM dumps or HAR traces. An incomplete/failed run
cannot produce a passing `fixture.json`. Raw browser/fixture diagnostics remain
private and are removed instead of being published.

The browser covers desktop/mobile, Chinese/English and light/dark presentation,
keyboard focus, Escape, Back/Forward, custom selects, route/NAT editing, VPC
creation, explicit continuation and read-only receipt reconciliation. Each
continuation uses at most one POST followed by bounded GET observation; no write
retry loop hides uncertainty.

The notification regression gate also checks that consecutive information notices
do not accumulate, that a modal excludes background notices from paint/hit/focus,
and that changing locale removes the previous-language notice. Final screenshots
wait for the real five-second information notice expiry, with the pointer moved
away; they never hide DOM, click dismiss, mock clocks or edit application state.
The first measured package provisioning took 21m48s, so the job permits 40 minutes;
the 12-minute fixture lifetime and page-operation deadlines remain unchanged.

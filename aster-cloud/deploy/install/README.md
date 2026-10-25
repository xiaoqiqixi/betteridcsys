# Native installer — development channel only

**There is no published standalone Aster Cloud release/channel yet.** The finance
`v0.5.9` release is not a Cloud installer or bundle. No download URL or successful
remote deployment is implied here. A local development bundle plus its exact,
independently trusted external SHA256 is mandatory. A checksum is integrity,
not publisher authentication; `--allow-development` explicitly trusts this code.

## One command per role

From a reviewed local checkout, on the intended native host:

```sh
sudo bash /absolute/path/to/aster-cloud/deploy/install/controller.sh
sudo bash /absolute/path/to/aster-cloud/deploy/install/node.sh
```

These are **interactive installers**. Existing dependencies are the default;
fixed Ubuntu packages and a new dedicated MySQL server/database are explicit
optional paths, not an already-validated clean-Ubuntu unattended deployment. The controller and KVM node are separate machines and
separate commands. Never run the node installer on the 1GB finance test server.
The wizard asks for the bundle path, independently trusted archive SHA256,
explicit development approval, optional package/database approval, real
configuration inputs, a read-only bundle preflight, and whether to apply/start. `software` deliberately installs only binaries; an empty approval-file
answer enters guided configuration rather than requiring hand-written JSON.
Passwords use `getpass` and the existing `bootstrap-admin -password-stdin` API;
passwords, DSNs, tokens, and private keys are never printed or passed as arguments.

Native apply targets Ubuntu **22.04 / 24.04 / 26.04 amd64**, root and booted
systemd. Those are target checks, **not claims these OS/KVM hosts were tested**.
Python 3.10+ must already exist. There is no Docker dependency or installation.

### Existing controller prerequisites and guided path

- Existing local MySQL (unix socket or loopback TCP), a precreated dedicated
  `aster_controller[_...]` or `aster_cloud[_...]` database, and a dedicated
  **non-root** account restricted to that database. Its permissions must be runtime DML-only in that database. For a fresh schema,
  supply a second root0600 migration DSN for a **different non-root account in
  the exact same database**, with only the needed migration DDL privileges.
  The installer first checks the runtime schema: a current schema needs no DDL
  credential; an incomplete schema without a separate migration identity stops.
  In existing-DB mode it never changes grants or MySQL global configuration.
  Use a private root-owned 0600 DSN file; do not reuse finance DB/accounts.
- A real server certificate chain and matching root0600 private key; SAN must
  cover the exact fixed HTTPS console hostname, valid now and at least another
  24 hours. Supply a real trust CA PEM. The strict authenticated HTTPS health
  check uses this CA, standard SAN/chain validation and no redirect/TLS bypass.
  Keep real DNS and the selected listener/port consistent; the installer does
  not open firewalls, rewrite DNS, add proxying, or silently use port 443.
- The first administrator email; password is privately prompted at bootstrap.
  For a fresh database, choose start in the wizard to reach the bootstrap step.

The guided apply runs the verified binary's existing `init` in a new private
seed directory to create unique tokens. It preserves that seed configuration,
creates a separate approved final config, copies real TLS/runtime-DSN files with
exclusive writes, and runs `check` and `bootstrap-admin` only after
explicit start approval. If migration is needed, `migrate` uses a **separate
private migration config**, never the runtime DSN; prefer keeping the migration
DSN under `/root`, hidden from the service by `ProtectHome`. The native HTTPS server serves the bundled UI using
`serve -console-origin FIXED_ORIGIN -ui-dir VERSION/ui`; no Nginx is required.
Systemd is started, authenticated HTTPS/database health is checked, and only
then is boot enablement performed. A failed new service is stopped, never
reported ready, and the receipt requires explicit recovery.

### Existing KVM node prerequisites and guided path

- A **dedicated** hardware-virtualization Linux host with usable `/dev/kvm`, at
  least 2GiB RAM, distribution-supported libvirt daemon/socket already approved
  and running, and fixed native executables `/usr/bin/virsh`, `qemu-img`,
  `qemu-system-x86_64`, `cloud-localds`.
- A real root-owned flat qcow2 image already under `/var/lib/aster-images`, its
  independently approved complete SHA256, actual node/datacenter/group IDs,
  and explicit CPU/memory/disk ceilings. No image is downloaded or fabricated.
- A real node server certificate/key (pair/SAN/validity checked), and only the
  **public** controller trust CA and approved controller leaf DER SHA256.
  **Never copy any controller client private identity to a KVM node.** Neither
  the schema nor wizard accepts controller client cert/key probe credentials.

Guided configuration stays `maintenance=true`, `network.enabled=false`,
`allow_delete=false`, isolated-no-NIC and storage mutation disabled. Images are
hashed and the Go `LoadConfig`/`--doctor` checks remain unchanged. The installer
creates only private journal/storage directories and installs its fixed native
unit; it does not enable libvirt's default network or modify bridges, netplan,
ufw/nft/iptables, physical uplinks, images, VMs or journals. Optional node APT
installs only fixed client/qemu/image utilities, **not the libvirt daemon stack**.
The existing libvirt service/default-network policy still needs explicit native
host preparation and acceptance; package scripts are not treated as harmless.

A node started after doctor + active unit + local TCP-listener observation is
**`node_started_pending_controller`**, NOT mTLS-admitted, not VM-ready, and not a
completed host-network acceptance test. No unauthenticated HTTP endpoint or
`CERT_NONE` shortcut is used. Complete the existing reviewed controller node
profile (real endpoint/allowlist/CA/client identity/node leaf pin), then FROM the
controller use its normal root-owned identity:

```sh
/opt/aster-cloud/controller/versions/EXACT_INSTALLED_VERSION/bin/aster-controller heartbeat \
  -config /etc/aster-controller/config.json -node APPROVED_NODE_ID
```

Replace the version path and node ID with actual receipt/config values. The
controller retains its private key. Its existing heartbeat performs real pinned
mTLS to `/v1/capabilities`. Node maintenance stays on; operational admission and
network/VM tests are separate explicit operations, not installation side effects.

## Explicit optional dependency and dedicated-DB paths

The same one-command wizard asks whether to approve `apt`; blank retains the
existing-dependencies path. Controller DSN input accepts `new` for a separate
explicit new-database approval. Automation equivalents are
`--install-dependencies --provision-mysql --database-name aster_cloud`
`--runtime-db-user aster_cloud_api --migration-db-user aster_cloud_migrate`, used
with the existing `--wizard` / verified local development-bundle arguments.
These flags never make `--plan` or `--dry-run` perform installation or generate
secrets. They are **implemented and mock-tested, not real-host accepted**.

Package rules:

- Fixed Ubuntu release mapping: 22.04/jammy, 24.04/noble, 26.04/resolute, amd64.
  Only HTTPS `archive.ubuntu.com` and `security.ubuntu.com` suites are used, with
  the preinstalled root-owned Ubuntu archive keyring. A private `APT_CONFIG`
  redirects apt.conf parts/main, sources, preferences and trust before system
  configuration/hooks load; no third-party source, `apt-key`, unsigned package,
  TLS bypass, root sandbox override, upgrade/removal or existing config overwrite.
- Fixed controller packages: `ca-certificates`, `openssl`; new-server mode adds
  `mysql-server`, `mysql-client`. Fixed node tools: `ca-certificates`, `qemu-utils`,
  `qemu-system-x86`, `libvirt-clients`, `cloud-image-utils`. There is no arbitrary
  package-name flag. Simulation refuses upgrades/removals and network-daemon
  packages; native integration remains necessary to validate maintainer behavior.
- A conservative fresh-host gate refuses existing database/virt/finance paths.
  New MySQL package mode additionally refuses any existing MySQL config, data,
  daemon or local service. The installer exclusively creates a nonce-owned
  temporary `/usr/sbin/policy-rc.d` returning 101; an existing policy is **never
  replaced**. Successful installation removes only the exact owned inode/content;
  a failed transaction retains protection for reviewed explicit resume.
- Only the newly installed dedicated MySQL service receives an exclusive owned
  drop-in forcing `--skip-networking --mysqlx=0`. Provisioning explicitly starts
  that socket-only server, even if Cloud API start is declined. Both classic/X
  TCP disablement are queried before use. Existing MySQL units, root passwords,
  global configs, bind policies, unrelated services and firewalls are untouched.

Dedicated-DB rules:

- Only local root Unix-socket authentication is used for bootstrap, with option
  files/login paths/history isolated in a private client HOME. No management
  credential, SQL or application password is placed in process arguments.
- Collision checks run before credentials are written: existing target DB/users,
  other application schemas, foreign server identity, nonstandard grant wildcard
  semantics or mandatory roles are refused. New DB/accounts are never silently
  adopted. No `IF NOT EXISTS`, `ALTER USER`, `DROP`, `REPLACE` or password reset is
  used by the provisioning layer.
- Runtime gets only `SELECT, INSERT, UPDATE, DELETE` on the exact dedicated DB;
  the distinct migrator additionally gets `CREATE, ALTER, INDEX, REFERENCES`. No global/role
  privileges or grant option. `REFERENCES` is required by the real console-session
  foreign key in migration 002 (see [MySQL foreign-key privileges](https://dev.mysql.com/doc/refman/8.0/en/create-table-foreign-keys.html));
  this is still scoped only to the dedicated DB, never runtime/global access.
  Database-name underscores are escaped in grants;
  exact `SHOW GRANTS` is checked. Existing runtime DSN remains DML-only, and the
  separate private migration config is the only `migrate` input.
- MySQL generates the two passwords itself (`caching_sha2_password`, no deprecated
  native-password downgrade). Submitted SQL contains no literal password. The
  one-time result is captured directly into root0600 DSN files and never echoed.
  DB ownership and account attributes pin an operation nonce and server identity.
  Explicit resume can recheck/reuse only those exact owned objects.
- DDL commit ambiguity is not hidden: a crash after DB creation but before its
  ownership marker, or after account creation but before its returned password
  was durably saved, requires operator reconciliation. Objects remain intact;
  no destructive cleanup or credential reset is used to manufacture success.
  Incomplete `.pending` provisioning receipts similarly require private review.

### What was learned from official install documentation

The [IDCsmart documentation center](https://docs.idcsmart.com/) was reachable.
The interaction reference was the search tool's indexed official-document body
titled `1.1安装魔方云KVM加强版`, retrieved on 2026-10-25 (index marked crawled
last month), **not a verified live deep-link fetch**: the indexed installation
URL returned 404 when opened and its current canonical URL was not confirmed.
That indexed content informed only the interaction sequence: choose a role/version,
check prerequisites, confirm, show phase results, and register an independent node
later. No vendor script was copied or executed, and its network/security changes
or credential printing are not adopted.

Canonical documents [APT configuration loading](https://manpages.ubuntu.com/manpages/noble/man5/apt.conf.5.html),
[service policy denial](https://manpages.ubuntu.com/manpages/noble/man8/invoke-rc.d.8.html)
and [MySQL package autostart/default socket administration](https://ubuntu.com/server/docs/how-to/databases/install-mysql/).
[Ubuntu libvirt daemon packages](https://packages.ubuntu.com/en/jammy-updates/amd64/libvirt-daemon-system)
include default-network configuration, so utility installation is not presented
as zero-risk automatic KVM admission. MySQL's
[generated-password behavior](https://dev.mysql.com/doc/refman/8.0/en/password-management.html)
and [account ownership attributes](https://dev.mysql.com/doc/refman/8.0/en/create-user.html)
are the basis for secret-free submitted SQL and conservative resume checks.

## Read-only planning / explicit automation

Plans require neither root nor Ubuntu and do not write, invoke binaries, install
packages, or perform network probes:

```sh
python3 /absolute/path/to/aster-cloud/deploy/install/install.py controller --plan \
  --allow-development --bundle /absolute/path/controller.tar.gz --sha256 REAL_EXTERNAL_SHA256
python3 /absolute/path/to/aster-cloud/deploy/install/install.py node --dry-run \
  --allow-development --bundle /absolute/path/node.tar.gz --sha256 REAL_EXTERNAL_SHA256
```

`REAL_EXTERNAL_SHA256` is documentation notation, not an accepted hash; provide
all 64 lowercase hexadecimal characters from the real trusted checksum. Default
invocation refuses the unpublished official channel rather than downloading
finance artifacts or creating a dummy candidate.

For a pre-reviewed complete configuration, `--approval /root/approval.json`
(root-owned0600) replaces guided input, and `--apply --start` explicitly requests
execution. The final config is fixed at `/etc/aster-controller/config.json` or
`/etc/aster-node/node.json`; all referenced files/ancestors must be canonical,
root-owned, non-group/world-writable and contain no symlink/hardlink aliases.
For certificate automation systems using symlinks, provide independently copied
regular files; the installer never dereferences an untrusted chain.

Controller approval schema:

```json
{
  "schema": 1,
  "component": "aster-cloud-controller",
  "config_file": "/root/reviewed-controller.json",
  "console_origin": "https://cloud.example.test:9443",
  "tls_ca_file": "/etc/aster-controller/health-ca.crt",
  "dedicated_database": true,
  "database_name": "aster_cloud",
  "migration_dsn_file": "/root/aster-cloud-migration-dsn",
  "bootstrap_admin_email": "admin@example.test"
}
```

`migration_dsn_file` can be omitted only if the existing runtime schema check
is already current. It must never be the runtime account or a different DB.
The unit and long-lived config never reference it. Database grants remain an
operator-verified responsibility; the installer does not claim to inspect grants.

For an independently verified existing administrator, omit bootstrap email and
set `"existing_administrator": true`. This is a root approval, not proof of
existing credentials. Go configuration/schema validation and DB checks remain
mandatory before start.

Node approval schema (no controller private-identity fields):

```json
{
  "schema": 1,
  "component": "aster-cloud-node",
  "config_file": "/root/reviewed-node.json",
  "dedicated_kvm_host": true,
  "health_origin": "https://node.example.test:9443"
}
```

`health_origin` identifies the approved node certificate SAN; it does not grant
or perform local HTTP/mTLS admission. Initial imported node config must also use
the fixed unit's `/var/lib/aster-node` and `/var/lib/aster-instances` directories,
real image approvals under `/var/lib/aster-images`, TLS files under
`/etc/aster-node`, fixed artifact/inbox paths `/var/lib/aster-artifacts` and
`/var/lib/aster-inbox` (when specified), and the conservative initial policy above.
The dedicated artifact/inbox leaves are created without changing existing data;
the unit retains all four explicit writable paths and hardening directives.

## Results, persistent recovery and limits

- `software-installed` + `waiting-approval` + `not-started`: only verified software;
  not an installed/working controller or admitted KVM node.
- `configuration-approved` + `not-started`: approved material saved; no service
  readiness claim and no unconditional start.
- Controller `service-ready`: database check, administrator bootstrap (or explicit
  existing-admin approval), active service and authenticated strict HTTPS health.
- Node `node_started_pending_controller` + `active-unadmitted`: host doctor,
  active service and local listener only; controller mTLS heartbeat still needed.
- `failed`: execution stops; no later step is silently marked successful.

Only safe summaries and the private receipt location are printed. Receipts and
generated configuration/approval sources are root0600 under
`/var/lib/aster-cloud-installer/ROLE/`. Software is immutable/version-staged under
`/opt/aster-cloud/ROLE/versions/`; units use absolute version paths, not mutable
symlink aliases. A root-only exclusive lock serializes apply operations.

Read the receipt after any failure, then repeat the original exact bundle and
approval with `--resume` (the wizard also accepts this flag). Changed bundle,
changed approved config, unknown files, differing existing configs/secrets or
custom/old units are refused, not overwritten. Complete matching staging files
can be reused; partial seed/token directories remain untouched. An interrupted
complete `state.new` receipt is promoted only under explicit matching resume;
malformed partial receipts require manual review. A crash during DB bootstrap
can be commit-ambiguous: reconcile the existing administrator/audit evidence
before further attempts; **never drop/reinitialize the database to retry**.

This is deliberately not an automated running-service upgrade/uninstall tool.
It never deletes DB/journal/image/VM/network data, stops unrelated services,
executes user shell commands, disables mTLS/firewalls, silently installs packages,
or claims finance integration/VM boot/public-network acceptance. Existing secret
material referenced outside `/etc` must be reachable under the fixed service
sandbox; protected-home paths are not suitable runtime TLS/DSN locations.

## Tests (host-safe)

```sh
PYTHONDONTWRITEBYTECODE=1 python3 /absolute/path/to/aster-cloud/deploy/ci/test_cloud_installer.py
PYTHONDONTWRITEBYTECODE=1 python3 /absolute/path/to/aster-cloud/deploy/install/test_install.py
```

The tests use synthetic bundles and per-process mocks; no apt/systemctl, remote
host, production database, physical networking or actual VM is exercised. Real
Ubuntu/MySQL/KVM deployment acceptance remains a separate required validation.

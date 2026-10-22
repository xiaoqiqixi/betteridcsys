# Aster native KVM node — development vertical slice

This is a **local libvirt/KVM host executor**, not an SSH/root-command relay. It
is separate from billing and the controller. No VM host, deployment or network
acceptance is claimed. The operator explicitly deferred real-host acceptance.

## Supported boundary

- Native **x86_64 Ubuntu 22.04+** policy target, Go standard library, no Docker,
  Redis, guest password, remote SSH command or shell execution. Ubuntu 24/26
  compatibility is a target, **not tested certification**. Other distributions /
  architectures are not advertised. The doctor reports actual prerequisites.
- Real fixed binaries: `/usr/bin/virsh`, `/usr/bin/qemu-img`,
  `/usr/bin/qemu-system-x86_64`, and, for static networking,
  `/usr/bin/cloud-localds`. Commands have fixed argument structure, bounded
  output/context and no shell. QEMU/libvirt distribution security updates,
  AppArmor storage policy, certificates and host routing remain operator duties.
- Flat SHA-approved qcow2 base image; no backing image/data-file chain; overlay
  virtual size must fit the requested system disk. Bases must remain immutable
  for the full lifetime of all backing overlays, not just during initial hashing.
- CPU, memory (128 MiB steps), system disk, configured image/storage, normal
  network only. No data disks, VPC, IPv6, bandwidth shaping or transfer metering.
  **Every unsupported resource is rejected**, never ignored or downgraded.
- Zero bandwidth/transfer is allowed **only** with `allow_unmetered_default=true`:
  it means an approved unmetered/default network, NOT an enforced quota of zero.
- Network disabled by default. Optional isolated no-NIC profile is separate from
  the real normal-static-ipv4 profile and is never advertised as one allocated IP.
- Positive static network profile: **exactly one IPv4 / zero IPv6**, durable pool
  reservation, approved dedicated preconfigured bridge, deterministic MAC,
  isolated bridge port, pinned self-contained anti-spoof/default-deny nwfilter,
  NoCloud ISO containing static network config and approved Ed25519 public keys.
  No host bridge/routing/firewall/filter is automatically created or changed.

## Security and lifecycle

Only mTLS (TLS >=1.2), verified CA **plus exact approved controller leaf DER
SHA256** can use any endpoint, including health. A certificate issued by the same
CA but not pinned is rejected. Loopback literal IP is default; non-loopback bind
requires explicit approval and operator firewall policy. There is no plaintext
HTTP public endpoint, HTTP proxy, SSH relay or arbitrary command option.

Node JSON configuration is private root-owned `0600`. State is root-owned `0700`;
keys/journal/lock `0600`; approved images and storage must not be group/other
writable. Every existing ancestor must be root/euid owned and non-writable to
others (a root-owned sticky temporary ancestor alone is permitted). Symlinks and
hardlinked ordinary files are refused. Approved file reads use O_NOFOLLOW and
opened-inode checks; certificate/config reads are bounded. Image hashing checks
size/identity, cancellation and root-approved digest; arbitrary root mutation of
approved paths is outside the isolation boundary.

All operations require 32 lowercase hex operation/instance/owner IDs. Domains are
named `aster-<instance_id>` and require namespace ownership metadata and matching
managed disks/NIC/filter. Domain `0` is never a target. Before any create disk or
libvirt define, a **successful full domain inventory** must confirm the derived
name is absent; a pre-existing domain is never adopted/redefined. Libvirt and the
node must not be independently writing the same names/storage concurrently.

POST `/v1/tasks` carries the exact JSON bytes and `X-Request-SHA256`. The journal
fsyncs the operation claim and create reservation **before returning 202 and
before executing any host command**. Power mutations durably quarantine the
instance before execution. Same operation/same raw bytes returns the saved
result without re-execution; any changed raw bytes (including whitespace) gives
HTTP 409. The controller must persist the raw body and, if a response is lost,
**only GET the original operation**. There are no automatic POST retries.

One detached worker runs at a time (10-minute upper bound). A different operation
while busy is durably rejected; there is no queue. HTTP disconnect/cancellation
does not cancel an accepted operation. Graceful shutdown cancels the worker and
waits for a conservative terminal journal update; crash/restart turns accepted
into uncertain and does not replay. This is intentionally a **single-process,
low-throughput node**. Exclusive flock prevents concurrent node processes. The
journal is atomically renamed and fsynced, bounded to 64 MiB on both save/load;
capacity/write failure stops further admission. No pruning/HA replication or
hot-state migration is implemented; retain the journal and alert on growth.

Unknown outcomes retain disk/address reservations, are never automatically
rolled back or retried, and block further mutations on that instance. Successful
create means **libvirt reports the owned domain running**, not that guest boot,
SSH, public networking or a billing-service activation succeeded. Reboot command
acknowledgement remains uncertain because state=running cannot prove a reboot.

Delete is disabled by default, additionally requires the exact confirmation ID,
verified owned live XML and shut-off state. It undefines without libvirt's bulk
storage deletion and removes only registered files; unknown contents are not
recursively deleted. Failure is uncertain; never remove the private journal to
"fix" it, nor release reservations without verifying the original resources.

Safe structured operation metadata (IDs, action/status, request digest, stable
error code and journal-write confirmation) is emitted for journald; full tasks,
certificates, SSH keys, seed content and subprocess output are not logged. The
private journal retains operation status/timestamps/error codes. Production log
shipping, retention, alerting and append-only external audit are **not supplied**.

## Native operator preparation (manual, no installer side effects)

Examples: `deploy/node-config.example.json`, `deploy/node-aster-node.service`,
`deploy/node-static-ipv4-filter.example.xml`. Placeholders deliberately fail
validation. Review and replace every approval; do not deploy the example IP pool
(192.0.2.0/24 is documentation space). Start in maintenance with networking off.
Use real root-owned directories such as `/var/lib/aster-node`,
`/var/lib/aster-instances` and `/var/lib/aster-images` (the state/storage directories
must be separate). Establish certificates out of band. Pin the client certificate
DER SHA256, not its PEM text or CA. Review server SAN and controller endpoint pins.

For networking, first configure and externally validate a **dedicated routed
bridge** with no unrelated/unisolated guests, routing, gateway, upstream return
routes, host access policy and address ownership. Review/define the supplied
filter manually in the host's libvirt system. Pin SHA256 of the **exact stdout** of
`virsh --connect qemu:///system nwfilter-dumpxml aster-static-ipv4`; generated UUID
and whitespace change that digest. The node also compares the parsed policy with
its self-contained required template, allowing only formatting and root UUID.
Every rule uses one protocol element, no transitive filters. Root checked the
current template against the official **libvirt 8.0.0 RelaxNG schema**; this proves
schema syntax only, **not packet filtering behavior**.

Libvirt's isolated bridge port only isolates other similarly isolated ports.
It does not isolate host services or unrelated bridge peers and is **not a tenant
security group**. The template explicitly drops VLAN/QinQ/IPv6, filters outgoing
MAC/IPv4/ARP spoofing, permits ARP/IPv4 and defaults other Ethernet traffic to drop.
Actual enforcement, ebtables/nft backend behavior, encapsulation, routed traffic,
ARP, intra-tenant/host access and upstream anti-spoofing **must still be validated
on a real host with packet captures** before enabling the profile for customers.
See [libvirt filter documentation](https://libvirt.org/formatnwfilter.html) and
[domain interface documentation](https://libvirt.org/formatdomain.html).

Read-only readiness (no package installation, VM or network mutation):

```sh
/usr/local/sbin/aster-node --config /etc/aster-node/node.json --doctor
```

Doctor checks Ubuntu version/architecture, CPU virtualization flags, /dev/kvm
permissions, fixed tools, storage, libvirt read-only inventory, and (if enabled)
bridge/filter/seed tooling. `ready=false` is a real failure, not a successful KVM
test. `/healthz` merely means the authenticated process responds, not host ready.
Capabilities have actual UTC sampling time and host capacity bounded by root
allocation ceilings; incomplete doctor checks advertise maintenance/no actions.

Only after reviewing doctor evidence and maintenance/capabilities, manually
install the reviewed systemd unit and binary. The example unit's filesystem and
libvirt/AppArmor compatibility, restart behavior and all distro variants remain
unverified. No `curl | bash`, automatic apt, Docker or host-network modification
is included.

### Recover an uncertain operation without repeating a write

Stop the node service first (exclusive journal). Back up its private journal.
The root-only command below reads owned XML and state, never defines/starts/
destroys/undefines a domain. It can mark original create/start/shutdown/force_off
succeeded only when ownership and the original target state are proved. It
updates only the original local operation/instance and records a reconciliation
code. On mismatch/missing domain it retains uncertainty; reboot/delete cannot be
proved by this command. Start service again; the controller then GETs the same
operation. No automatic operator command or HTTP reconciliation write is exposed.

```sh
/usr/local/sbin/aster-node --config /etc/aster-node/node.json \
  --reconcile-operation 0123456789abcdef0123456789abcdef
```

## Build / regression

From the `aster-cloud` module with its local `aster/billing` replace present:

```sh
GOCACHE=/private/tmp/aster-node-gocache go test -race -count=1 \
  ./internal/nodeproto ./internal/hypervisor ./cmd/aster-node
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  GOCACHE=/private/tmp/aster-node-gocache go build -trimpath \
  -o /private/tmp/aster-node-linux-amd64 ./cmd/aster-node
```

Tests use synthetic image content and fake libvirt/qemu/seed commands. They cover
real JSON/exact hashing, journal persistence/lock/filesystem guards, async
admission, HTTP cancellation, concurrent duplicate suppression, failures,
unsupported resources, existing domains, owned-XML checks, delete/reconcile
and TLS handshakes over `net.Pipe` (real Go TLS without a listening socket).
`internal/nodeproto/testdata/capabilities-approved-static-ipv4.json` is explicitly
a synthetic controller-contract fixture, never evidence of a measured host.

**Not acceptance-tested:** actual QEMU/libvirt VM creation/boot, qemu file ownership
and AppArmor, cloud-init SSH/static address behavior, bridge/upstream routing,
packet isolation/anti-spoofing, real reboot lifecycle, delete/recovery failure
injection, capacity under load, systemd/TLS deployment, host backup/restore,
upgrade/rollback or a real customer provisioning/billing activation end-to-end.
No production release or production-grade KVM completion is asserted.

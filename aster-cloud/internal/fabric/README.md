# Root-only OVS fabric executor (development)

This module is a native executable dataplane core, **not** an installed service,
UI integration, VM-start gate, complete routed VPC, or a real-host acceptance.
Existing `aster-node` still uses its approved Linux bridge. Never point that
profile at an OVS bridge or start a newly OVS-configured VM through the old path.

## Root approvals

Build `go build ./cmd/aster-network`. Prepare a dedicated, empty `aster-` bridge
and private config using an independent reviewed root procedure. The executable
does not create bridges, add/move interfaces, install packages, set controllers,
change bridge protocols or connect physical uplinks.

The already-prepared bridge must have:

- `fail_mode=secure`, no controller, OpenFlow14 explicitly enabled;
- `external_ids:aster-node-id=<node_id>` and `aster-dedicated=true`;
- no foreign flow cookies or `NORMAL` rules, no foreign meter IDs;
- only Linux TAP interfaces (verified using kernel `tun_flags`).

Every existing guest Interface must be independently root-marked with
`external_ids:iface-id=<fabric.InterfaceID(instance_id)>`, `aster-node-id`,
`aster-owner`, `aster-instance`, and `aster-vpc`. If `iface-status` is present,
it must be `active`. `InterfaceID` is a deterministic SHA-256-derived UUIDv8.
OF port numbers are **not** identities. Exact stable labels and the live ofport
mapping are checked before and after programming. Unknown approved TAPs get no
allow flow. Physical interfaces, tunnels and patch ports are rejected.

Config (root-owned, 0600, no symlink or hardlink; parent directories trusted):

```json
{"schema":1,"node_id":"node-a","bridge":"aster-vpc","state_directory":"/var/lib/aster-network","dedicated_ack":true}
```

The state directory parent must already exist. Its leaf is created 0700 when
needed; pre-existing broad permissions are not repaired automatically. The
topology file is also a private 0600 regular file. `plan` compiles only and emits
a receipt summary, not private flow contents; `status` reads the durable receipt
without probing or changing OVS. Status is not a live isolation observation.

```sh
aster-network plan --config /etc/aster-network/config.json --topology /etc/aster-network/topology.json
aster-network apply --config /etc/aster-network/config.json --topology /etc/aster-network/topology.json --confirm-bridge aster-vpc
aster-network status --config /etc/aster-network/config.json
aster-network verify --config /etc/aster-network/config.json
```

`verify` is a separate **root-only live readback**, accepting only the fixed
private config (no alternate topology, revision, bridge or remote target). It
requires the journal's current final revision to be applied, with no unresolved
history, and compares its compiled plan with the private desired-flow file and
current bridge ownership, TAP/interface UUID mapping, exact flows and meters.
Before/middle/after identity snapshots must agree. All OpenFlow reads use
`--read-only`, backed by a second command/argument allowlist. Missing files,
lost flows/meters after an OVS restart, changed identities, read errors and any
uncertainty return failure with no populated live result. It never creates or
updates journals/files, applies flows, repairs meters or quarantines ports.

The returned `aster.fabric.live/1` observation binds the current revision,
topology digest and hashed identity map to its observation time. It is **not** a
signed attestation, durable lease, atomic cross-system snapshot, permanent VM
start permit, internet-connectivity test or billing success. Another root writer
can change the host after readback. VM start/resume still needs an integrated
quiescent admission gate and a separate network execution contract.

## Model and limits

Topology schema 1 contains `node_id`, positive monotonic int64 `revision`,
`vpcs`, and `ports`. VPC fields are `id`, `owner_ref` (32 lowercase hex), canonical
private IPv4 `cidr`, and globally unique `vlan_id` 1–4094. Each port has
`instance_id`, deterministic `interface_id`, `owner_ref`, `vpc_id`, `ipv4`, `mac`,
`ofport` 1–32767, and positive `inbound_mbps` / `outbound_mbps` (at most 100000).
One private IP per port; 32 VPCs / 128 ports per bridge. IP uniqueness is per VPC;
VPC ownership, unique instance/MAC/ofport and subnet/broadcast checks are strict.

The compiler permits only exact source IPv4/MAC and ARP sender tuples, then
uses a VPC-specific OpenFlow metadata label to direct packets to the same VPC's
exact target IP/MAC. ARP requests are directed to a known peer, never flooded.
Tagged frames, IPv6, unknown protocols, unknown IPs and LOCAL traffic drop.
OVSDB VLAN tags do **not** provide isolation for explicit OpenFlow outputs.

Each guest's source-egress and destination-ingress meter is a drop policer,
`Mbps * 1000` kilobits/second, **not a queued shaper or billing traffic quota**.
No gateway/router, NAT, DHCP, DNS service, IPv6, security-group statefulness,
cross-node overlay or VM NIC attachment is supplied by this module.

## Failure semantics

Exclusive flock and write-ahead intent precede dataplane mutation. Private
temporary file + file fsync + rename + directory fsync are used. The durable lock
inode also prevents silently reinitializing a missing first journal. First
replace the entire exclusive bridge with drop-only flows, then update meters,
then replace desired flows atomically; meters, flow differences and stable
identity maps are read back. Upstream OVS bundles require **OpenFlow14 transport**
even though these match/meter instructions use OpenFlow13 semantics. Bundle
commit acknowledgement supplies its completion barrier; no fictitious standalone
`ovs-ofctl barrier` command is issued.

Any failure is unconfirmed, not success. When a mapping changes after allow flows,
one bounded quarantine operation replaces them with drop-only rules; failed
quarantine is explicitly `isolation_unconfirmed`. That is a safety operation,
not a retry of the requested apply. Foreign rules/controllers are not adopted.
After the bridge's exclusive root approval is proven and flow ownership is
confirmed, `apply` may quarantine the **entire bridge**, including unknown TAP,
physical or tunnel interfaces discovered during later probing. This disrupts
every guest port on that bridge; an unknown port does not promise zero writes.
This disruptive policy is only for the explicitly confirmed dedicated bridge,
never host/public bridges. `verify` does not perform this quarantine.
The same revision/digest returns its original receipt without executing commands;
changed reuse conflicts. Any uncertain/interrupted record blocks new revisions.
There is no automatic retry, bridge cleanup, reset or uncertainty-clearing API.
Keep the state directory and perform independent root investigation before any
manual recovery; never delete its journal as a retry technique.

Receipts retain at most 64 revisions (bounded 8 MiB journal); the limit fails
closed and is not silently pruned. A production archival design and real OVS/KVM
traffic, host reboot, drop/limit accuracy and hostile port-race acceptance remain
required. Probe/readback cannot replace an integrated VM-start network gate.

Official references actually read:

- [OVS VLAN FAQ](https://docs.openvswitch.org/en/latest/faq/vlan/)
- [ovs-ofctl manual](https://www.openvswitch.org/support/dist-docs/ovs-ofctl.8.txt)
- [OVSDB schema / Interface identifiers](https://www.openvswitch.org/support/dist-docs/ovs-vswitchd.conf.db.5.txt)
- [OVS v2.17.0 ofctl implementation: read-only command flag and diff-flows](https://raw.githubusercontent.com/openvswitch/ovs/v2.17.0/utilities/ovs-ofctl.c)
- [Upstream meter formatter](https://github.com/openvswitch/ovs/blob/main/lib/ofp-meter.c) and [older multiline test format](https://mail.openvswitch.org/pipermail/ovs-dev/2023-April/403605.html). The v2.17 meter formatter itself could not be fetched during this review; these source checks do not replace an installed Ubuntu22 package test.

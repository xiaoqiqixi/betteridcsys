# Root-approved namespace NAT

## What is implemented

`Snapshot.nat_policies` is optional and omitted from legacy canonical snapshots.
Each policy binds one VPC/gateway/node and one complete root NAT profile SHA-256.
It enables IPv4 SNAT and explicit TCP/UDP single-port DNAT to **enabled, frozen
members of that VPC**, including members on other overlay participants. NAT does
not alter the financial contract, original node/2 binding or an old snapshot.

This is **approved-prefix egress**, not an unrestricted Internet default route.
The root gateway's destination prefixes cannot overlap VPCs, management,
underlay, loopback, multicast or metadata ranges. A selected route can narrow a
root prefix or be removed. DNAT source prefixes must be contained both in the
root NAT source approval and the selected gateway prefixes (OVS reverse path
protection remains effective). No `0.0.0.0/0`, IPv6 NAT, hairpin NAT, ICMP DNAT,
public address allocation or automatic physical-uplink configuration is claimed.

The administrator uses the controller network UI to select approved gateways,
prefixes and NAT profiles, submit an epoch, inspect node phases and explicitly
recover an uncertain epoch. Root provisioning remains a separate host operation:
HTTP administrators cannot name a host interface, namespace path, arbitrary
command or unapproved public IP.

## Root prerequisites and private profile

Install `iproute2`, `nftables`, `conntrack`, `util-linux`, and OVS 2.17+ on Ubuntu
22.04 or newer. The node does not start a host nftables service or modify its
rules. Prepare one dedicated namespace per approved NAT VPC with exactly:

- `lo`, one inside veth and one outside veth; both up at `guest_mtu`.
- The inside address is the approved gateway IPv4/VPC prefix and its MAC equals
  the gateway MAC. Its host peer is `TAPName(gateway_instance_id)` **but is a
  veth, never represented as a libvirt TAP or VM**.
- The outside address is the sole IPv4 `public_ipv4`; its veth peer is the
  explicitly approved `outside_peer`. An operator connects that peer to an
  isolated external uplink. The service never attaches a physical NIC, changes
  a host default route or enables host forwarding.
- The namespace route table contains the VPC connected route, the public
  connected route and exactly one default via `uplink_gateway_ipv4`, plus the
  kernel local/broadcast routes. Only the standard local/main/default policy
  routing rules are allowed.
- Four link aliases identify the exact node/profile/side:
  `aster-nat:<node_id>:<profile_id>:inside`, `:inside-peer`, `:outside`,
  `:outside-peer`. Both ifindex/iflink directions and veth type are checked.
- The inside OVS Interface has exactly these external IDs:
  `aster-node-id`, `aster-owner`, `aster-gateway-vpc`, `aster-nat-profile`,
  `aster-interface-id`, `aster-gateway-mac`. Its Port must have one Interface,
  no VLAN/trunk/bond and the approved MTU. Old appliance gateways retain their
  separate libvirt/TAP validation.

Add `nat_profiles` to the root-owned overlay approval. Example shape (replace
IDs, namespace identity and address approval with actual operator-owned values):

```json
{
  "id": "nat-a",
  "namespace": "aster-nat-a",
  "namespace_device": 4,
  "namespace_inode": 4026533000,
  "dedicated_ack": true,
  "vpc_id": "22222222222222222222222222222222",
  "vpc_cidr": "10.11.0.0/24",
  "gateway_instance_id": "88888888888888888888888888888888",
  "inside_interface": "inside",
  "outside_interface": "outside",
  "outside_peer": "nat-uplink",
  "public_ipv4": "198.51.100.2",
  "uplink_gateway_ipv4": "198.51.100.1",
  "allow_snat": true,
  "allowed_source_cidrs": ["198.51.100.0/24"],
  "allowed_ports": [{"protocol": "tcp", "start": 10000, "end": 20000}]
}
```

The complete root overlay SHA includes these private approvals. Publish only the
safe policy projection/profile SHA to the controller's `nat_profiles` directory;
namespace names, inode/device numbers and host interface paths are not UI data.
A rebuilt namespace has a different inode and needs a fresh explicit approval.
The implementation opens `/run/netns/NAME` with `O_NOFOLLOW`, checks root
ownership, device/inode and the Linux NSFS type, rejects the process and PID 1
network namespaces, and passes that descriptor to `nsenter` using `ExtraFiles`.
Renaming the namespace after the open cannot redirect the command to the host.

## Commit and recovery

- **prepare:** persist the uncertain phase first, verify root namespace/routes/
  veth/OVS identities, establish durable ownership, set and read back
  namespace-only `net.ipv4.ip_forward=0`; OVS/VM fencing is also retained.
- **program:** validate generated JSON using `nft -j -c -f`, atomically replace
  only owned `inet aster_nat`, flush only that namespace's conntrack, and compare
  every chain/rule/expression against live JSON. Only metainfo, kernel handles
  and immaterial cross-chain output order are normalized. Every input/output/
  forward base chain defaults to drop, including IPv6. No host ruleset flush.
- **release:** verify the complete expected rules, exact root identity and
  forwarding-off state; only after the controller all-participant program
  barrier enable namespace forwarding and release the existing OVS VM gate.
- **failure:** independently disable namespace forwarding; retain unknown
  intent/receipt and require explicit recovery. Exact old operation replay only
  returns its old receipt; it never reprograms NAT.
- **removal:** all root NAT namespaces are processed even if a policy or gateway
  is removed from the new snapshot. They receive a default-drop table, and their
  cached translations are removed. Root gateway ports remain in owned inventory
  but receive no selected gateway flow. They are not silently deleted/adopted.
- **readiness:** CheckOverlay, OverlayCheck and VM lifecycle gates read actual
  namespace identity, routes, nft rules and forwarding state, not cached success.
  A removed/inactive NAT policy keeps namespace forwarding at zero after release.

A NAT/network epoch intentionally **interrupts existing translated connections**.
This is required to revoke first-packet conntrack NAT mappings reliably. Ordinary
VM start/stop does not reset NAT conntrack unless a failure requires isolation.
The full generated ruleset is bounded to 512 KiB; oversized intent is rejected
before any phase mutation rather than truncated.

## Upgrade an existing root profile

Existing full configuration pins are not silently weakened to exclude new NAT
fields. To migrate a deployed cluster, add the previous full SHA as optional
`previous_profile_sha256` in the new root OverlayConfig; the **new** full SHA also
includes this field. The controller root directory separately approves its old
`previous_profiles` and current pins. An explicit recovery epoch must bind the
exact observed old node head and select the current root pins.

Only recovery **prepare** may transition the journal pin. The new unknown intent,
an immutable `overlay-profile-migration-<operation>.json` evidence record, then
the new journal pin are durably written before any host mutation. The evidence
binds node, old/new SHA, operation/request SHA and previous head. Unknown writes
never become success, and old tasks/epoch snapshots are not rewritten. Normal
plan, auto-create or VM lifecycle cannot migrate a pin. Keep the previous field
in the approved file after migration: removing it changes the full config SHA.

### Updating or rebuilding an existing NAT profile

The node keeps the full private approval in `nat-owner-<profile>.json`, with the
exact profile SHA. A root approval change needs both the full overlay migration
above and `nat_profiles[].previous_profile_sha256` equal to that old NAT SHA.
Only recovery prepare may migrate this owner. With the same namespace identity,
the executor first disables forwarding and flushes that old namespace's
conntrack. Migration evidence binds full old/new profiles and exact recovery
operation/request; the new owner is persisted only after this evidence.

For a rebuilt inode the namespace name, VPC/CIDR, gateway and interface names
must remain the same, its newly pinned veth/route identity must pass, and its nft
ruleset must be empty. Root additionally sets
`retired_previous_namespace_ack: true` **after independently confirming that the
old namespace is no longer connected**. This flag is not a connectivity probe:
**an unreachable old namespace is not proof that it is isolated.** HTTP/UI users
cannot set this private root-only assertion. It never overrides host-namespace,
symlink, new-veth, route or foreign-table checks.

Persistent `nat_profile_ids` journal tombstones prevent deleting an owner file
or simply removing a root NAT profile to forget a previously controlled
namespace. To disable NAT use the UI policy removal; retain the root profile in
the owned inventory. Automatic permanent host-profile retirement is not offered.
Old binaries reject the added journal field instead of silently downgrading it.

## Evidence and limitations

`TestNativeNATPacketFlowAndRevocation`, enabled with `ASTER_NATIVE_NAT=1`, is a
mandatory Ubuntu 22/24 CI gate. It provisions only temporary namespaces/veths,
uses actual nftables/conntrack, checks SNAT observed source and DNAT destination,
proves program remains isolated before release, refuses unapproved ports,
keeps an actual TCP connection open during revocation, and asserts the host nft
rules are unchanged. It does **not** test OVS forwarding or KVM: those remain the
separate overlay parser/packet-model and deferred real-host acceptance tracks.

Local fake tests cover three-phase ordering, exact replay, uncertain command
failures, stale namespace/peer/route, foreign tables, root pins, source/port/target
confusion, removal/default-drop, read-only drift and configuration canonicality.
Migration tests inject write/sync/rename/directory-sync failures at each durable
boundary. No real KVM, physical uplink/public reachability or HA failover claim
follows from these isolated tests.

## Primary references actually consulted

- [nftables NAT semantics](https://wiki.nftables.org/wiki-nftables/index.php/Performing_Network_Address_Translation_(NAT)) — first-packet conntrack bindings and SNAT/DNAT.
- [Atomic rule replacement](https://wiki.nftables.org/wiki-nftables/index.php/Atomic_rule_replacement) — whole-file atomic updates, not incremental shell rules.
- [libnftables JSON schema](https://manpages.debian.org/bookworm/libnftables1/libnftables-json.5.en.html) — inet NAT family, match/bitmask operators and object structure.
- [ip-netns manual](https://man7.org/linux/man-pages/man8/ip-netns.8.html) — named namespaces and descriptor lifetime.

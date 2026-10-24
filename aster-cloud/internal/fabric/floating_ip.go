package fabric

import "aster/cloud/internal/overlayproto"

// Whole-address NAT is independently approved and exclusive; it is not a port
// forwarding expansion and never makes the guest claim a public address.
// These chains precede shared NAT so a target's assigned source cannot be
// replaced by the VPC default. The original compiler is byte-identical with no
// floating intent. Protocols other than TCP/UDP/ICMP remain default denied.
func compileFloatingNAT(c OverlayConfig, s overlayproto.Snapshot, root NATProfile) ([]nftObject, error) {
	mappings := []overlayproto.FloatingIP{}
	for _, f := range s.FloatingIPs {
		if f.NodeID == c.Base.NodeID && f.ProfileID == root.ID {
			mappings = append(mappings, f)
		}
	}
	if len(mappings) == 0 {
		return nil, nil
	}
	if !root.AllowFloatingIP || !root.AllowInternetEgress {
		return nil, ErrConflict
	}
	objects := []nftObject{}
	for _, name := range []string{"floating_in", "floating_out"} {
		objects = append(objects, nftObject{"chain": nftObject{"family": "inet", "table": natTable, "name": name}})
	}
	add := func(chain string, expr ...any) {
		objects = append(objects, nftObject{"rule": nftObject{"family": "inet", "table": natTable, "chain": chain, "expr": expr}})
	}
	accept := nftObject{"accept": nil}
	drop := nftObject{"drop": nil}
	// Explicit routes are a separate root grant and retain precedence over
	// the generic public fallback deny list, just as in the legacy compiler.
	for _, f := range mappings {
		for _, g := range s.Gateways {
			if g.InstanceID == f.GatewayInstanceID {
				for _, prefix := range g.AllowedPrefixes {
					add("floating_out", match(payload("ip", "saddr"), f.TargetIPv4), match(payload("ip", "daddr"), prefixExpr(prefix)), accept)
					add("floating_in", match(payload("ip", "daddr"), f.TargetIPv4), match(payload("ip", "saddr"), prefixExpr(prefix)), bitmatch(ct("state"), 2), bitmatch(ct("status"), 16), accept)
				}
			}
		}
	}
	for _, blocked := range internetBlockedCIDRs(c, s) {
		add("floating_out", match(payload("ip", "daddr"), prefixExpr(blocked)), drop)
		add("floating_in", match(payload("ip", "saddr"), prefixExpr(blocked)), drop)
	}
	for _, f := range mappings {
		if !natPublicIPv4Approved(root, f.PublicIPv4) {
			return nil, ErrConflict
		}
		source, dest := match(payload("ip", "saddr"), f.TargetIPv4), match(payload("ip", "daddr"), f.TargetIPv4)
		add("prerouting", match(meta("iifname"), root.OutsideInterface), match(payload("ip", "daddr"), f.PublicIPv4), nftObject{"dnat": nftObject{"addr": f.TargetIPv4, "family": "ip"}})
		// Every incoming initiation must have matched this exact public destination;
		// a peer route to the target's private address grants no access.
		for _, proto := range []int{6, 17} {
			add("floating_in", dest, match(meta("l4proto"), proto), bitmatch(ct("status"), 32), bitmatch(ct("state"), []int{2, 8}), accept)
			add("floating_in", dest, match(meta("l4proto"), proto), bitmatch(ct("status"), 16), bitmatch(ct("state"), 2), accept)
			add("floating_out", source, match(meta("l4proto"), proto), bitmatch(ct("state"), []int{2, 8}), accept)
		}
		add("floating_in", dest, match(payload("icmp", "type"), 8), bitmatch(ct("status"), 32), bitmatch(ct("state"), []int{2, 8}), accept)
		add("floating_in", dest, match(payload("icmp", "type"), 0), bitmatch(ct("status"), 16), bitmatch(ct("state"), 2), accept)
		add("floating_out", source, match(payload("icmp", "type"), 8), bitmatch(ct("state"), []int{2, 8}), accept)
		add("floating_out", source, match(payload("icmp", "type"), 0), bitmatch(ct("status"), 32), bitmatch(ct("state"), 2), accept)
		for _, kind := range []int{3, 11, 12} {
			add("floating_in", dest, match(payload("icmp", "type"), kind), bitmatch(ct("state"), 4), accept)
		}
		add("forward", match(meta("iifname"), root.InsideInterface), match(meta("oifname"), root.OutsideInterface), source, nftObject{"jump": nftObject{"target": "floating_out"}})
		add("forward", match(meta("iifname"), root.OutsideInterface), match(meta("oifname"), root.InsideInterface), dest, nftObject{"jump": nftObject{"target": "floating_in"}})
		add("postrouting", match(meta("iifname"), root.InsideInterface), match(meta("oifname"), root.OutsideInterface), source, nftObject{"snat": nftObject{"addr": f.PublicIPv4, "family": "ip"}})
	}
	return objects, nil
}

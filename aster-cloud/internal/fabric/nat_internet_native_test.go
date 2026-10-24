package fabric

import (
	"aster/cloud/internal/overlayproto"
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Addresses with public syntax are only assigned to loopback/veth interfaces
// inside three temporary namespaces. The host has no link, route or packet path
// to this topology; no public host or external Internet service is contacted.
func TestNativeNATInternetEgressAndRevocation(t *testing.T) {
	if os.Getenv("ASTER_NATIVE_NAT") != "1" {
		t.Skip("native Internet NAT gate runs separately on Ubuntu22/24")
	}
	if runtime.GOOS != "linux" || os.Geteuid() != 0 {
		t.Fatal("ASTER_NATIVE_NAT requires native Linux root")
	}
	hostBefore, err := exec.Command(NATNFT, "-j", "-s", "-n", "list", "ruleset").CombinedOutput()
	if err != nil {
		t.Fatal("host rules inventory", err, string(hostBefore))
	}
	t.Cleanup(func() {
		after, err := exec.Command(NATNFT, "-j", "-s", "-n", "list", "ruleset").CombinedOutput()
		if err != nil || string(after) != string(hostBefore) {
			t.Error("host nft rules changed during isolated Internet test", err)
		}
	})
	e, _, c, s := internetNATFixture(t)
	p := c.NATProfiles[0]
	// Two real source addresses on the same dedicated veth; a third approved
	// reserve stays unconfigured. Selection is controller intent, provisioning
	// and its bounded approval remain independent root operations.
	p.PublicIPv4s = []string{"8.8.4.3", "8.8.4.4"}
	p.AllowedSourceCIDRs = []string{p.UplinkGatewayIPv4 + "/32"}
	p.AllowedPorts = []NATPortRange{{"tcp", 18080, 18080}, {"udp", 18083, 18083}}
	c.Gateways[0].AllowedPrefixes = []string{p.UplinkGatewayIPv4 + "/32"}
	c.GuestNetworks[0].AllowedPrefixes = []string{p.UplinkGatewayIPv4 + "/32"}
	s.Gateways[0].AllowedPrefixes = []string{p.UplinkGatewayIPv4 + "/32"}
	s.NATPolicies[0].PublicIPv4 = p.PublicIPv4s[0]
	s.NATPolicies[0].Forwardings = []overlayproto.NATForwarding{
		{ID: strings.Repeat("a", 32), Protocol: "tcp", PublicPort: 18080, TargetInstanceID: s.Members[0].InstanceID, TargetPort: 80, SourceCIDR: p.UplinkGatewayIPv4 + "/32"},
		{ID: strings.Repeat("b", 32), Protocol: "udp", PublicPort: 18083, TargetInstanceID: s.Members[0].InstanceID, TargetPort: 53, SourceCIDR: p.UplinkGatewayIPv4 + "/32"},
	}
	suffix := fmt.Sprintf("%d", os.Getpid())
	p.Namespace = "aster-pub-" + suffix
	insideNS, outsideNS := "aster-pubin-"+suffix, "aster-pubout-"+suffix
	command := func(binary string, args ...string) []byte {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, binary, args...).CombinedOutput()
		if err != nil {
			t.Fatalf("%s %v: %v %s", binary, args, err, out)
		}
		return out
	}
	for _, ns := range []string{p.Namespace, insideNS, outsideNS} {
		command(NATIP, "netns", "add", ns)
		t.Cleanup(func() { _ = exec.Command(NATIP, "netns", "delete", ns).Run() })
	}
	inPeer := TAPName(p.GatewayInstanceID)
	for _, pair := range []struct{ local, peer, ns, side string }{{p.InsideInterface, inPeer, insideNS, "inside"}, {p.OutsideInterface, p.OutsidePeer, outsideNS, "outside"}} {
		command(NATIP, "-n", p.Namespace, "link", "add", pair.local, "type", "veth", "peer", "name", pair.peer)
		command(NATIP, "-n", p.Namespace, "link", "set", pair.peer, "netns", pair.ns)
		command(NATIP, "-n", p.Namespace, "link", "set", pair.local, "mtu", "1500", "alias", natAlias(c.Base.NodeID, p.ID, pair.side), "up")
		command(NATIP, "-n", pair.ns, "link", "set", pair.peer, "mtu", "1500", "alias", natAlias(c.Base.NodeID, p.ID, pair.side+"-peer"), "up")
	}
	g := s.Gateways[0]
	command(NATIP, "-n", p.Namespace, "link", "set", p.InsideInterface, "address", g.MAC)
	for _, ns := range []string{p.Namespace, insideNS, outsideNS} {
		command(NATIP, "-n", ns, "link", "set", "lo", "up")
	}
	command(NATIP, "-n", p.Namespace, "addr", "add", g.IPv4+"/24", "dev", p.InsideInterface)
	command(NATIP, "-n", p.Namespace, "addr", "add", p.PublicIPv4+"/24", "dev", p.OutsideInterface)
	command(NATIP, "-n", p.Namespace, "addr", "add", p.PublicIPv4s[0]+"/32", "dev", p.OutsideInterface)
	command(NATIP, "-n", p.Namespace, "route", "add", "default", "via", p.UplinkGatewayIPv4, "dev", p.OutsideInterface)
	command(NATIP, "-n", insideNS, "addr", "add", s.Members[0].IPv4+"/24", "dev", inPeer)
	command(NATIP, "-n", insideNS, "route", "add", "default", "via", g.IPv4, "dev", inPeer)
	command(NATIP, "-n", outsideNS, "addr", "add", p.UplinkGatewayIPv4+"/24", "dev", p.OutsidePeer)
	command(NATIP, "-n", outsideNS, "route", "add", "10.11.0.0/24", "via", p.PublicIPv4, "dev", p.OutsidePeer)
	publicRemote := "9.9.9.9"
	blocked := []string{"172.16.9.9", "169.254.169.254", c.LocalIPv4, c.Peers[0].IPv4, "11.0.0.2"}
	for _, addr := range append([]string{publicRemote}, blocked...) {
		command(NATIP, "-n", outsideNS, "addr", "add", addr+"/32", "dev", "lo")
	}
	st, err := os.Stat("/run/netns/" + p.Namespace)
	if err != nil {
		t.Fatal(err)
	}
	stat := st.Sys().(*syscall.Stat_t)
	p.NamespaceDevice, p.NamespaceInode = uint64(stat.Dev), stat.Ino
	c.NATProfiles[0] = p
	sha, err := OverlayConfigSHA256(c)
	if err != nil {
		t.Fatal(err)
	}
	s.Profiles[0].ProfileSHA256 = sha
	s.NATPolicies[0].ProfileSHA256, _ = NATProfileSHA256(p)
	e.Runner = nativeNATRunner{insideNS: insideNS, outsideNS: outsideNS, insidePeer: inPeer, outsidePeer: p.OutsidePeer}
	ctx, cancel := context.WithTimeout(context.Background(), 70*time.Second)
	defer cancel()
	l, err := openLedger(c.Base, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer l.close()
	if err = l.save(); err != nil {
		t.Fatal(err)
	}
	if err = l.pinOverlay(sha); err != nil {
		t.Fatal(err)
	}
	startNativeNATServer(t, outsideNS, publicRemote+":18081")
	startNativeNATServer(t, outsideNS, publicRemote+":18082", "udp4")
	startNativeNATServer(t, insideNS, s.Members[0].IPv4+":80")
	startNativeNATServer(t, insideNS, s.Members[0].IPv4+":53", "udp4")
	for _, addr := range blocked {
		startNativeNATServer(t, outsideNS, addr+":18081")
	}
	missing := s
	missing.NATPolicies = append([]overlayproto.NATPolicy{}, s.NATPolicies...)
	missing.NATPolicies[0].PublicIPv4 = p.PublicIPv4s[1]
	if err := e.probeNAT(ctx, c, missing, p); err == nil {
		t.Fatal("approved but unconfigured public address passed native probe")
	}
	if err = e.prepareNAT(ctx, c, l, s); err != nil {
		t.Fatal("public prepare", err)
	}
	if err = e.programNAT(ctx, c, l, s); err != nil {
		dumpNativeNAT(t, p)
		t.Fatal("public program", err)
	}
	if out, err := nativeNATClient(insideNS, "http://"+publicRemote+":18081"); err == nil {
		t.Fatal("public forwarding released before barrier", string(out))
	}
	if err = e.releaseNAT(ctx, c, l, s); err != nil {
		dumpNativeNAT(t, p)
		t.Fatal("public release", err)
	}
	for _, network := range []string{"tcp4", "udp4"} {
		url := "http://" + publicRemote + ":18081"
		if network == "udp4" {
			url = publicRemote + ":18082"
		}
		out, err := nativeNATClient(insideNS, url, network)
		if err != nil || !strings.Contains(string(out), "NAT_REMOTE="+p.PublicIPv4s[0]+":") {
			dumpNativeNAT(t, p)
			t.Fatalf("public %s source/reply: %v %s", network, err, out)
		}
	}
	if out, err := nativeNATClient(insideNS, publicRemote, "icmp4"); err != nil || !strings.Contains(string(out), "NAT_ICMP_REPLY="+publicRemote) {
		dumpNativeNAT(t, p)
		t.Fatal("public ICMP echo/reply", err, string(out))
	}
	for _, network := range []string{"tcp4", "udp4"} {
		url := "http://" + p.PublicIPv4s[0] + ":18080"
		if network == "udp4" {
			url = p.PublicIPv4s[0] + ":18083"
		}
		if out, err := nativeNATClient(outsideNS, url, network); err != nil || !strings.Contains(string(out), "NAT_REMOTE="+p.UplinkGatewayIPv4+":") {
			t.Fatal("selected-IP DNAT source/target", network, err, string(out))
		}
	}
	// The peer can route directly to the guest; only the actual namespace rules
	// prevent a new inbound connection. A missing port mapping must not become a
	// blanket established/related accept or an implicit Internet DNAT service.
	if out, err := nativeNATClient(outsideNS, "http://"+s.Members[0].IPv4+":80"); err == nil {
		t.Fatal("unsolicited inbound Internet reached guest", string(out))
	}
	for _, addr := range blocked {
		if out, err := nativeNATClient(insideNS, "http://"+addr+":18081"); err == nil {
			t.Fatal("protected/metadata/underlay destination reached", addr, string(out))
		}
	}
	apply := func(label string) {
		t.Helper()
		for _, phase := range []struct {
			name string
			run  func(context.Context, OverlayConfig, *ledger, overlayproto.Snapshot) error
		}{{"prepare", func(ctx context.Context, c OverlayConfig, l *ledger, s overlayproto.Snapshot) error {
			return e.prepareNAT(ctx, c, l, s)
		}}, {"program", e.programNAT}, {"release", e.releaseNAT}} {
			if err := phase.run(ctx, c, l, s); err != nil {
				t.Fatal(label+" "+phase.name, err)
			}
		}
	}
	assertHeldRevoked := func(held, label string) {
		t.Helper()
		if err := os.WriteFile(held+".continue", []byte("continue"), 0600); err != nil {
			t.Fatal(err)
		}
		waitNativeNATFile(t, held+".result")
		result, err := os.ReadFile(held + ".result")
		if err != nil || string(result) != "blocked" {
			t.Fatal(label, err, string(result))
		}
	}
	// Switching a live allocation must revoke old conntrack, not merely update
	// rules while an established flow retains the previous source identity.
	held := startNativeNATHeldClient(t, insideNS, "http://"+publicRemote+":18081")
	s.NATPolicies[0].PublicIPv4 = p.PublicIPv4
	apply("switch selected public IP")
	assertHeldRevoked(held, "existing TCP survived public-IP switch")
	for _, network := range []string{"tcp4", "udp4"} {
		url := "http://" + publicRemote + ":18081"
		if network == "udp4" {
			url = publicRemote + ":18082"
		}
		if out, err := nativeNATClient(insideNS, url, network); err != nil || !strings.Contains(string(out), "NAT_REMOTE="+p.PublicIPv4+":") {
			t.Fatal("switched public source/reply", network, err, string(out))
		}
		url = "http://" + p.PublicIPv4 + ":18080"
		if network == "udp4" {
			url = p.PublicIPv4 + ":18083"
		}
		if out, err := nativeNATClient(outsideNS, url, network); err != nil || !strings.Contains(string(out), "NAT_REMOTE="+p.UplinkGatewayIPv4+":") {
			t.Fatal("switched public DNAT", network, err, string(out))
		}
		old := "http://" + p.PublicIPv4s[0] + ":18080"
		if network == "udp4" {
			old = p.PublicIPv4s[0] + ":18083"
		}
		if out, err := nativeNATClient(outsideNS, old, network); err == nil {
			t.Fatal("old public IP retained DNAT binding", network, string(out))
		}
	}
	held = startNativeNATHeldClient(t, insideNS, "http://"+publicRemote+":18081")
	s.NATPolicies[0].InternetEgressEnabled = false
	apply("disable public egress")
	assertHeldRevoked(held, "existing public TCP survived disable")
	for _, network := range []string{"tcp4", "udp4"} {
		url := "http://" + publicRemote + ":18081"
		if network == "udp4" {
			url = publicRemote + ":18082"
		}
		if out, err := nativeNATClient(insideNS, url, network); err == nil {
			t.Fatal("disabled public egress survived", network, string(out))
		}
	}
	s.NATPolicies = nil
	apply("remove public IP binding")
	for _, address := range []string{p.PublicIPv4, p.PublicIPv4s[0]} {
		if out, err := nativeNATClient(outsideNS, "http://"+address+":18080"); err == nil {
			t.Fatal("released binding retained DNAT", address, string(out))
		}
	}
	if err = e.verifyNAT(ctx, c, l, s, true); err != nil {
		t.Fatal("public final readback", err)
	}
}

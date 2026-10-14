package main

import "testing"

func TestRejectDefaultSessionSecrets(t *testing.T) {
	for _, s := range []string{"", "short", "00000000000000000000000000000000", "change-this-secret-before-production", "replace-this-with-a-strong-random-secret", "demo-session-secret-do-not-use-live"} {
		if validSessionSecret(s) {
			t.Fatalf("accepted weak/example secret %q", s)
		}
	}
	if !validSessionSecret("a928e01f683bc470d2f50911a6e0938745dcefca89b1043452ead5fac7cd3251") {
		t.Fatal("random-format secret rejected")
	}
}

func TestProductionOriginValidation(t *testing.T) {
	for _, origin := range []string{"https://billing.example?", "https://:443", "https://billing.example#", "https://billing.example/", "https://user:pass@billing.example", "http://billing.example", "https:billing.example", "https://billing.example:", "https://billing.example:443", "https://billing.example:0443", "https://Billing.example", "https://billing.example:99999"} {
		if validProductionOrigin(origin) {
			t.Fatal("invalid origin accepted", origin)
		}
	}
	for _, origin := range []string{"https://billing.example", "https://billing.example:8443", "https://[2001:db8::1]"} {
		if !validProductionOrigin(origin) {
			t.Fatal("valid origin rejected", origin)
		}
	}
}

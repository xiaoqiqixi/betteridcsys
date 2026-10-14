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

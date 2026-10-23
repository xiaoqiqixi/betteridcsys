package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestCLIInvalidArgumentsNeverEchoSecrets(t *testing.T) {
	for _, args := range [][]string{{}, {"destroy"}, {"apply", "--password", "secret-token"}, {"apply", "--config", "/private/secret-token"}, {"status", "--config", "/private/secret-token"}} {
		var out, err bytes.Buffer
		code := run(args, &out, &err)
		if code == 0 || strings.Contains(out.String()+err.String(), "secret-token") {
			t.Fatal(code, out.String(), err.String())
		}
	}
}

func TestVerifyAcceptsOnlyFixedPrivateConfigNotTopologyRevisionOrBridge(t *testing.T) {
	for _, args := range [][]string{{"verify", "--config", "/missing", "--topology", "/private/secret-token"}, {"verify", "--config", "/missing", "--topology", ""}, {"verify", "--config", "/missing", "--revision", "1"}, {"verify", "--config", "/missing", "--revision", "0"}, {"verify", "--config", "/missing", "--confirm-bridge", "aster-vpc"}} {
		var out, err bytes.Buffer
		if code := run(args, &out, &err); code != 1 || out.Len() != 0 || !strings.Contains(err.String(), "INVALID_ARGUMENTS") || strings.Contains(err.String(), "secret-token") {
			t.Fatal(code, out.String(), err.String())
		}
	}
	var out, err bytes.Buffer
	if code := run([]string{"verify", "--config", "/private/secret-token"}, &out, &err); code != 1 || out.Len() != 0 || strings.Contains(err.String(), "secret-token") || !strings.Contains(err.String(), "FABRIC_CONFIG_REJECTED") {
		t.Fatal(code, out.String(), err.String())
	}
}

func TestFingerprintAcceptsOnlyPrivateConfigAndDoesNotEchoPaths(t *testing.T) {
	for _, args := range [][]string{{"fingerprint", "--config", "/private/secret-token", "--topology", ""}, {"fingerprint", "--config", "/private/secret-token", "--revision", "0"}, {"fingerprint", "--config", "/private/secret-token", "--confirm-bridge", "aster-vpc"}} {
		var out, stderr bytes.Buffer
		if code := run(args, &out, &stderr); code != 1 || out.Len() != 0 || !strings.Contains(stderr.String(), "INVALID_ARGUMENTS") || strings.Contains(stderr.String(), "secret-token") {
			t.Fatal(code, out.String(), stderr.String())
		}
	}
}

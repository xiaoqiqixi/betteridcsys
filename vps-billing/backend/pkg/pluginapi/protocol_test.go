package pluginapi

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestStrictWireFormat(t *testing.T) {
	valid := `{"protocol":"aster.smtp/1","core_version":"0.5.0","nonce":"` + strings.Repeat("a", 64) + `"}`
	var hello Hello
	if err := DecodeStrict([]byte(valid), MaxRequestBytes, &hello); err != nil {
		t.Fatal(err)
	}
	for name, raw := range map[string]string{
		"duplicate":         `{"protocol":"a","protocol":"b"}`,
		"escaped duplicate": `{"protocol":"a","\u0070rotocol":"b"}`,
		"case alias":        `{"Protocol":"a"}`, "unknown": `{"secret":"x"}`,
		"null": `{"nonce":null}`, "trailing": valid + ` {}`, "invalid utf8": string([]byte{0xff}),
		"deep":       strings.Repeat("[", 10) + "1" + strings.Repeat("]", 10),
		"long array": "[" + strings.Repeat("1,", 64) + "1]", "wrong type": `{"protocol":1}`,
	} {
		t.Run(name, func(t *testing.T) {
			var got Hello
			if DecodeStrict([]byte(raw), MaxRequestBytes, &got) == nil {
				t.Fatal("accepted malformed input")
			}
		})
	}
	if DecodeStrict([]byte(valid), len(valid)-1, &hello) == nil {
		t.Fatal("accepted oversized input")
	}
	raw, _ := json.Marshal(Policy{Schema: 1, Revision: 1})
	var p Policy
	if DecodeStrict(raw, MaxPolicyBytes, &p) != nil || p.SMTP != nil {
		t.Fatal("empty disabled policy must round trip")
	}
}

func TestManifestCompatibility(t *testing.T) {
	manifest := Manifest{Schema: 1, ID: "email.smtp", Version: "1.1.0", Protocol: SMTPProtocol, CoreMin: "0.4.0", CoreMaxExclusive: "0.6.0", Capabilities: []string{SMTPCapability}, Executable: "plugin", SHA256: strings.Repeat("a", 64)}
	for _, core := range []string{"0.4.0", "0.4.999", "0.5.0", "0.5.999"} {
		if manifest.Validate(core) != nil {
			t.Fatal(core)
		}
	}
	for _, core := range []string{"0.3.99", "0.6.0", "0.4.0-rc.1", "v0.4.0", "00.4.0", "1000000.0.0"} {
		if manifest.Validate(core) == nil {
			t.Fatal(core)
		}
	}
	for _, mutate := range []func(*Manifest){func(m *Manifest) { m.Executable = "../plugin" }, func(m *Manifest) { m.ID = "../../x" }, func(m *Manifest) { m.Capabilities = append(m.Capabilities, "database") }, func(m *Manifest) { m.Protocol = "aster.smtp/2" }, func(m *Manifest) { m.SHA256 = strings.Repeat("A", 64) }} {
		m := manifest
		mutate(&m)
		if m.Validate(CoreVersion) == nil {
			t.Fatal("accepted incompatible manifest")
		}
	}
	if got, err := CompareVersion("0.4.10", "0.4.2"); err != nil || got != 1 {
		t.Fatal(got, err)
	}
}

func TestLegacySMTPRangeIsNotGuessedForCurrentCore(t *testing.T) {
	legacy := Manifest{Schema: 1, ID: "email.smtp", Version: "1.0.0", Protocol: SMTPProtocol, CoreMin: "0.4.0", CoreMaxExclusive: "0.5.0", Capabilities: []string{SMTPCapability}, Executable: "plugin", SHA256: strings.Repeat("a", 64)}
	if legacy.Validate("0.4.0") != nil || legacy.Validate(CoreVersion) == nil {
		t.Fatal("legacy SMTP compatibility was broadened without its manifest approval")
	}
}

func TestResponseMustExplicitlyDeclareOutcome(t *testing.T) {
	response := SendResponse{Protocol: SMTPProtocol, RequestID: strings.Repeat("a", 64), Status: "accepted", Code: "", DeliveryUncertain: false}
	raw, _ := json.Marshal(response)
	var decoded SendResponse
	if DecodeStrict(raw, MaxResponseBytes, &decoded) != nil {
		t.Fatal("complete accepted response rejected")
	}
	var fields map[string]json.RawMessage
	json.Unmarshal(raw, &fields)
	for key := range fields {
		copyFields := map[string]json.RawMessage{}
		for k, v := range fields {
			if k != key {
				copyFields[k] = v
			}
		}
		incomplete, _ := json.Marshal(copyFields)
		if DecodeStrict(incomplete, MaxResponseBytes, &decoded) == nil {
			t.Fatal("accepted response missing", key)
		}
	}
}

package main

import (
	"strings"
	"testing"
)

func TestParseArgsRejectsExplicitEmptyOrMalformedReconcileBeforeIO(t *testing.T) {
	for name, args := range map[string][]string{
		"empty_separate":        {"--reconcile-operation", ""},
		"empty_equal":           {"--reconcile-operation="},
		"short":                 {"--reconcile-operation", "0"},
		"traversal":             {"--reconcile-operation", "../../domain"},
		"uppercase":             {"--reconcile-operation", strings.Repeat("A", 32)},
		"whitespace":            {"--reconcile-operation", strings.Repeat("a", 32) + " "},
		"doctor_empty":          {"--doctor", "--reconcile-operation="},
		"doctor_valid":          {"--doctor", "--reconcile-operation", strings.Repeat("a", 32)},
		"explicit_doctor_false": {"--doctor=false", "--reconcile-operation", strings.Repeat("a", 32)},
		"positional":            {"serve"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, e := parseArgs(args); e == nil {
				t.Fatal("unsafe mode parsed as serve", args)
			}
		})
	}
}
func TestParseArgsPreservesExplicitModes(t *testing.T) {
	o, e := parseArgs(nil)
	if e != nil || o.doctor || o.reconcileProvided || o.config != "/etc/aster-node/node.json" {
		t.Fatal(o, e)
	}
	o, e = parseArgs([]string{"--doctor", "--config", "/absolute/config.json"})
	if e != nil || !o.doctor || o.reconcileProvided || o.config != "/absolute/config.json" {
		t.Fatal(o, e)
	}
	id := strings.Repeat("a", 32)
	o, e = parseArgs([]string{"--reconcile-operation", id})
	if e != nil || !o.reconcileProvided || o.reconcile != id || o.doctor {
		t.Fatal(o, e)
	}
}

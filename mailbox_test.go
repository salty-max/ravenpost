package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestWriteLuaRoundTrip(t *testing.T) {
	data := map[string]any{
		"at":      float64(1760300000),
		"counter": float64(3),
		"written": "13 Oct, \"quoted\"\\ and a\nnew line\x01",
		"ok":      true,
		"notes": []any{
			map[string]any{"id": "n1", "m": float64(1426), "x": 0.4123, "y": 0.5521},
			map[string]any{"id": "n2", "m": float64(1429), "x": 0.1, "y": 0.9},
		},
		"empty": map[string]any{},
		"keys":  map[string]any{"end": "a keyword", "two words": float64(2), "_ok1": float64(1)},
	}
	lua, err := WriteLua(map[string]any{"RavenpostSpikeMailbox": data})
	if err != nil {
		t.Fatal(err)
	}
	back, err := ParseSavedVariables(lua)
	if err != nil {
		t.Fatalf("the parser can't read it back: %v\n%s", err, lua)
	}
	got := back["RavenpostSpikeMailbox"].(map[string]any)
	for k, want := range data {
		if k == "empty" {
			continue // ({} reads back as an empty table: either form)
		}
		if !reflect.DeepEqual(got[k], want) {
			t.Errorf("%s: got %#v, want %#v", k, got[k], want)
		}
	}
	again, _ := WriteLua(map[string]any{"RavenpostSpikeMailbox": data})
	if again != lua {
		t.Error("the same data must give the same file")
	}
}

func TestWriteLuaRefuses(t *testing.T) {
	if _, err := WriteLua(map[string]any{"not a name": 1}); err == nil {
		t.Error("a global must be a Lua name")
	}
	if _, err := WriteLua(map[string]any{"X": struct{}{}}); err == nil {
		t.Error("an unknown type must be refused, not written")
	}
}

func TestMailboxWrite(t *testing.T) {
	root := t.TempDir()
	install := Install{Path: root}
	m := Mailbox{Host: "RavenpostSpike", Global: "RavenpostSpikeMailbox"}

	written, err := m.Write(install, map[string]any{"counter": float64(1)})
	if err != nil || written {
		t.Fatalf("no host addon: nothing written (got %v, %v)", written, err)
	}

	host := filepath.Join(root, "Interface", "AddOns", "RavenpostSpike")
	os.MkdirAll(host, 0o755)
	os.WriteFile(filepath.Join(host, "RavenpostSpike_Vanilla.toc"), []byte("## Interface: 11509\n## Title: Spike\nSpike.lua\n"), 0o644)
	os.WriteFile(filepath.Join(host, "RavenpostSpike_Camelot.toc"), []byte("## Interface: 16001\nSpike.lua\n"), 0o644)

	written, err = m.Write(install, map[string]any{"counter": float64(2)})
	if err != nil || !written {
		t.Fatalf("host installed: written (got %v, %v)", written, err)
	}
	box := filepath.Join(root, "Interface", "AddOns", "RavenpostSpike_Mailbox")
	for file, iface := range map[string]string{"RavenpostSpike_Mailbox_Vanilla.toc": "11509", "RavenpostSpike_Mailbox_Camelot.toc": "16001"} {
		raw, err := os.ReadFile(filepath.Join(box, file))
		if err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		if !strings.Contains(string(raw), "## Interface: "+iface+"\n") || !strings.Contains(string(raw), "\nMailbox.lua\n") {
			t.Errorf("%s: the host's interface and the mailbox's file, got:\n%s", file, raw)
		}
	}
	raw, _ := os.ReadFile(filepath.Join(box, "Mailbox.lua"))
	parsed, err := ParseSavedVariables(string(raw))
	if err != nil || parsed["RavenpostSpikeMailbox"].(map[string]any)["counter"] != float64(2) {
		t.Errorf("the mailbox's file: %v\n%s", err, raw)
	}
	leftovers, _ := filepath.Glob(filepath.Join(box, ".*"))
	if len(leftovers) > 0 {
		t.Errorf("no temporary file left behind: %v", leftovers)
	}
}

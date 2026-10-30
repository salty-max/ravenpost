package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMigratesTheWoWLockerCompanion(t *testing.T) {
	t.Setenv("RAVENPOST_CONFIG_DIR", t.TempDir())
	legacy := t.TempDir()
	t.Setenv("RAVENPOST_LEGACY_DIR", legacy)
	cleanLegacyLaunch = func() bool { return false }
	old := `{"server":"https://wow-locker.app","token":"tok","battletag":"Max#1234","folders":["/games/wow"],
		"excludedCharacters":["Player-1-1"],"uploaded":{"/a/WowLocker.lua":"abc"}}`
	if err := os.WriteFile(filepath.Join(legacy, "config.json"), []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := LoadStore()
	if err != nil {
		t.Fatal(err)
	}
	c := s.Get()
	if l := c.LinkFor(WoWLocker); l.Server != "https://wow-locker.app" || l.Token != "tok" || l.BattleTag != "Max#1234" {
		t.Fatalf("WoWLocker link not carried over: %+v", l)
	}
	if l := c.LinkFor(Hearthtale); l.Token != "" || l.Server != hearthtaleServer {
		t.Fatalf("Hearthtale should start unlinked on its default server: %+v", l)
	}
	if len(c.Folders) != 1 || len(c.ExcludedCharacters) != 1 || c.Uploaded["/a/WowLocker.lua"] != "abc" {
		t.Fatalf("settings not carried over: %+v", c)
	}
	// Saved as Ravenpost's own: the next start reads it, not the old one.
	_ = os.Remove(filepath.Join(legacy, "config.json"))
	again, err := LoadStore()
	if err != nil || again.Get().LinkFor(WoWLocker).Token != "tok" {
		t.Fatalf("not saved: %v %+v", err, again.Get())
	}
}

func TestFreshStart(t *testing.T) {
	t.Setenv("RAVENPOST_CONFIG_DIR", t.TempDir())
	t.Setenv("RAVENPOST_LEGACY_DIR", t.TempDir())
	s, err := LoadStore()
	if err != nil {
		t.Fatal(err)
	}
	for _, svc := range services {
		if l := s.Get().LinkFor(svc.ID); l.Token != "" || l.Server == "" {
			t.Fatalf("%s: %+v", svc.ID, l)
		}
	}
}

// A config.json left half-written (a hand edit, a sync tool, an antivirus)
// never stops Ravenpost at start: it's kept aside as it was, and Ravenpost
// starts afresh and says so.
func TestABrokenConfigIsKeptAsideAndRavenpostStarts(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("RAVENPOST_CONFIG_DIR", dir)
	t.Setenv("RAVENPOST_LEGACY_DIR", t.TempDir())
	path := filepath.Join(dir, "config.json")
	broken := `{"installId": "0123456789abcdef0123456789abcdef", "launchAtLogin": true, "links":{"hearthtale":{"token":"tok"`
	if err := os.WriteFile(path, []byte(broken), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := LoadStore()
	if err != nil {
		t.Fatalf("a broken config stopped the start: %v", err)
	}
	aside := s.SetAside()
	if b, err := os.ReadFile(aside); err != nil || string(b) != broken {
		t.Fatalf("the broken file not kept as it was: %q %v", b, err)
	}
	if l := s.Get().LinkFor(Hearthtale); l.Token != "" || l.Server != hearthtaleServer {
		t.Fatalf("not started afresh: %+v", l)
	}
	// (what it can find in the bytes is kept: the install counted once, the login switch true to the machine)
	if c := s.Get(); c.InstallID != "0123456789abcdef0123456789abcdef" || !c.LaunchAtLogin {
		t.Fatalf("install id or launch at login lost: %q %v", c.InstallID, c.LaunchAtLogin)
	}
	if b, err := os.ReadFile(path); err != nil || json.Unmarshal(b, new(Config)) != nil {
		t.Fatalf("no good config.json written: %v", err)
	}
	// (the next start finds a good file and nothing set aside)
	if s2, err := LoadStore(); err != nil || s2.SetAside() != "" {
		t.Fatalf("second start: %v %q", err, s2.SetAside())
	}
}

// The log is set up before the config is read, a first start included, so
// whatever stops a start is written down.
func TestTheLogComesFirst(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "not-yet")
	t.Setenv("RAVENPOST_CONFIG_DIR", dir)
	defer log.SetOutput(os.Stderr)
	setupLog()
	log.Print("hello")
	if b, err := os.ReadFile(filepath.Join(dir, "ravenpost.log")); err != nil || !strings.Contains(string(b), "hello") {
		t.Fatalf("no log on a first start: %v", err)
	}
}

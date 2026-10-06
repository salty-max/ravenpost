package main

import (
	"os"
	"path/filepath"
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
	if len(c.Folders) != 1 || len(c.ExcludedCharacters) != 1 || c.Uploaded["/a/WowLocker.lua"] != "abc" || c.Key == "" {
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

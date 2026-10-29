package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeTOC(t *testing.T, dir, name, version string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := "## Interface: 11508\n## Title: x\n## Version: " + version + "\n"
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestInstalledAddons(t *testing.T) {
	root := t.TempDir()
	install := filepath.Join(root, "_forever_")
	add := filepath.Join(install, "Interface", "AddOns")
	// Yonder: the Forever TOC says 0.14.2 (the Vanilla one is another file); Goodwill has no TOC; the handover is skipped.
	writeTOC(t, filepath.Join(add, "Yonder"), "Yonder_Camelot.toc", "0.14.2")
	writeTOC(t, filepath.Join(add, "Yonder"), "Yonder_Vanilla.toc", "0.0.1")
	writeTOC(t, filepath.Join(add, "FieldJournal"), "FieldJournal_Vanilla.toc", "9")
	if err := os.MkdirAll(filepath.Join(add, "Goodwill"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTOC(t, filepath.Join(add, "WowLocker"), "WowLocker.toc", "0.3.11")
	writeTOC(t, filepath.Join(add, "SomeoneElses"), "SomeoneElses.toc", "1")
	// Yonder wrote its account file; Hearthtale is not installed but left a file.
	sv := filepath.Join(install, "WTF", "Account", "ACC", "SavedVariables")
	if err := os.MkdirAll(sv, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"Yonder.lua", "Hearthtale.lua"} {
		if err := os.WriteFile(filepath.Join(sv, f), []byte("x = {}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got := installedAddons(install, "_forever_")
	want := []InstalledAddon{
		{"Yonder", "Yonder", "0.14.2", true},
		{"Goodwill", "Goodwill", "", false},
		{"WowLocker", "WoWLocker", "0.3.11", false},
	}
	// (the family's order: Yonder, Goodwill, WowLocker)
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%d: got %+v, want %+v", i, got[i], want[i])
		}
	}
	if v := tocVersion(filepath.Join(add, "Yonder"), "Yonder", tocSuffix("_classic_era_")); v != "0.0.1" {
		t.Fatalf("classic era read %q", v)
	}
}

func TestInstalledAddonsPerCharacterFile(t *testing.T) {
	install := filepath.Join(t.TempDir(), "_classic_era_")
	writeTOC(t, filepath.Join(install, "Interface", "AddOns", "Hearthtale"), "Hearthtale_Vanilla.toc", "0.12.8")
	sv := filepath.Join(install, "WTF", "Account", "ACC", "Realm", "Char", "SavedVariables")
	if err := os.MkdirAll(sv, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sv, "Hearthtale.lua"), []byte("x = {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := installedAddons(install, "_classic_era_")
	if len(got) != 1 || !got[0].Data || got[0].Version != "0.12.8" {
		t.Fatalf("got %+v", got)
	}
}

func TestInstalledAddonsSkipsWhatTheClientNeverLoads(t *testing.T) {
	install := filepath.Join(t.TempDir(), "_anniversary_")
	writeTOC(t, filepath.Join(install, "Interface", "AddOns", "Mealbook"), "Mealbook_Vanilla.toc", "0.1.0")
	writeTOC(t, filepath.Join(install, "Interface", "AddOns", "Yonder"), "Yonder_TBC.toc", "0.14.2")
	got := installedAddons(install, "_anniversary_")
	if len(got) != 1 || got[0].Folder != "Yonder" {
		t.Fatalf("got %+v", got)
	}
}

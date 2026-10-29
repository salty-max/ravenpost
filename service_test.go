package main

import (
	"errors"
	"os"
	"strings"
	"testing"
)

func testApp(t *testing.T) *Ravenpost {
	t.Helper()
	t.Setenv("RAVENPOST_CONFIG_DIR", t.TempDir())
	t.Setenv("RAVENPOST_LEGACY_DIR", t.TempDir())
	t.Setenv("RAVENPOST_NO_BROWSER", "1")
	store, err := LoadStore()
	if err != nil {
		t.Fatal(err)
	}
	return &Ravenpost{app: NewApp(store)}
}

func TestTheWindowsSwitches(t *testing.T) {
	r := testApp(t)
	if err := r.SetCharacterSent("Player-1-1", false); err != nil {
		t.Fatal(err)
	}
	if err := r.SetAccountSent("/wow/WTF/Account/MAX", false); err != nil {
		t.Fatal(err)
	}
	st := r.State()
	if len(st.ExcludedCharacters) != 1 || st.ExcludedCharacters[0] != "Player-1-1" || len(st.ExcludedAccounts) != 1 {
		t.Fatalf("left out: %+v %+v", st.ExcludedCharacters, st.ExcludedAccounts)
	}
	// Sent again: off the list, and twice is the same as once.
	_ = r.SetCharacterSent("Player-1-1", true)
	_ = r.SetCharacterSent("Player-1-1", true)
	if st := r.State(); len(st.ExcludedCharacters) != 0 {
		t.Fatalf("still left out: %+v", st.ExcludedCharacters)
	}
}

func TestFoldersByHand(t *testing.T) {
	r := testApp(t)
	_ = r.AddFolder("  /games/wow ")
	_ = r.AddFolder("/games/wow")
	_ = r.AddFolder("")
	if f := r.State().Folders; len(f) != 1 || f[0] != "/games/wow" {
		t.Fatalf("folders: %v", f)
	}
	_ = r.RemoveFolder("/games/wow")
	if f := r.State().Folders; len(f) != 0 {
		t.Fatalf("folders: %v", f)
	}

	// The picker: what it chose is added; cancelled, nothing changes.
	r.chooseFolder = func() (string, error) { return "/Applications/World of Warcraft", nil }
	if err := r.ChooseFolder(); err != nil || len(r.State().Folders) != 1 {
		t.Fatalf("chosen: %v %v", err, r.State().Folders)
	}
	r.chooseFolder = func() (string, error) { return "", nil }
	if err := r.ChooseFolder(); err != nil || len(r.State().Folders) != 1 {
		t.Fatalf("cancelled: %v %v", err, r.State().Folders)
	}
	r.chooseFolder = func() (string, error) { return "", errors.New("no") }
	if err := r.ChooseFolder(); err == nil {
		t.Fatal("the picker's error is lost")
	}
}

func TestOpensOnlyWebPages(t *testing.T) {
	r := testApp(t)
	for _, ok := range []string{"https://hearthtale.app", "http://localhost:5175/pair?code=AB"} {
		if err := r.Open(ok); err != nil {
			t.Errorf("%s: %v", ok, err)
		}
	}
	for _, bad := range []string{"file:///etc/passwd", "javascript:alert(1)", "/Applications/Calculator.app", "smb://host/share", "https://"} {
		if err := r.Open(bad); err == nil {
			t.Errorf("%s was opened", bad)
		}
	}
}

func TestTheStateNamesEachSite(t *testing.T) {
	st := testApp(t).State()
	if st.Version != version || len(st.Sites) != len(services) || st.Sites[1].ID != Hearthtale || st.Sites[1].Linked {
		t.Fatalf("state: %+v", st)
	}
	if st.Activity == nil || st.Characters == nil || st.Installs == nil || st.Folders == nil {
		t.Fatal("the window wants lists, never null")
	}
}

func TestDiagnosticsNamesNobody(t *testing.T) {
	r := testApp(t)
	home, _ := os.UserHomeDir()
	_ = r.app.store.Update(func(c *Config) {
		c.Activity = []Activity{{Kind: "failed", Service: "hearthtale", Name: "SECRETACCOUNT", Detail: "the site didn't answer at " + home}}
		c.Links = map[string]*Link{Hearthtale: {Token: "SECRETTOKEN", BattleTag: "Secret#1234"}}
	})
	_ = r.app.store.Update(func(c *Config) {
		c.Activity = append(c.Activity, Activity{Kind: "failed", Service: "hearthtale", Detail: `open C:\Program Files (x86)\World of Warcraft\_classic_era_\WTF\Account\MYACCOUNT\Realm\Charname\SavedVariables\Hearthtale.lua: denied`})
	})
	out := r.Diagnostics()
	for _, bad := range []string{"MYACCOUNT", "Charname", "Realm"} {
		if strings.Contains(out, bad) {
			t.Fatalf("diagnostics leaks %q:\n%s", bad, out)
		}
	}
	for _, bad := range []string{"SECRETACCOUNT", "SECRETTOKEN", "Secret#1234"} {
		if strings.Contains(out, bad) {
			t.Fatalf("diagnostics leaks %q:\n%s", bad, out)
		}
	}
	if home != "" && strings.Contains(out, home) {
		t.Fatalf("diagnostics leaks the home folder:\n%s", out)
	}
	if !strings.Contains(out, "Hearthtale yes") || !strings.Contains(out, "the site didn't answer at ~") {
		t.Fatalf("unexpected:\n%s", out)
	}
}

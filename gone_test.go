package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

const wowlockerFile = `WowLockerDB = {
	["format"] = 1,
	["characters"] = {
		["Player-4703-0000AAAA"] = { ["name"] = "Aldric", ["realm"] = "Firemaw", ["class"] = "PALADIN", ["state"] = { ["level"] = 60 } },
		["Player-4703-0000BBBB"] = { ["name"] = "Oldalt", ["realm"] = "Firemaw", ["class"] = "MAGE", ["state"] = { ["level"] = 12 } },
	},
}
`

// A character the site says the account no longer has (deleted) leaves the
// list, stays out of it after a restart, and comes back if the site later
// says it's there after all (played again).
func TestGoneCharactersLeaveTheList(t *testing.T) {
	root, _ := fakeWoW(t)
	file := filepath.Join(root, "_classic_era_", "WTF", "Account", "MAX", "SavedVariables", "WowLocker.lua")
	if err := os.WriteFile(file, []byte(wowlockerFile), 0o644); err != nil {
		t.Fatal(err)
	}
	oldalt := "gone"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"characters": []map[string]any{
			{"guid": "Player-4703-0000AAAA", "name": "Aldric", "status": "synced", "events": 0},
			{"guid": "Player-4703-0000BBBB", "name": "Oldalt", "status": oldalt, "events": 0},
		}})
	}))
	defer srv.Close()
	s := syncerFor(t, srv.URL, root)
	_ = s.store.SetLink(WoWLocker, Link{Server: srv.URL, Token: "tok"})

	s.process(context.Background(), file)
	snap := s.Snapshot()
	if len(snap.Characters) != 1 || snap.Characters[0].Name != "Aldric" || snap.Gone != 1 {
		t.Fatalf("listed %+v, %d gone", snap.Characters, snap.Gone)
	}
	if got := s.store.Get().Gone; !reflect.DeepEqual(got, []string{"Player-4703-0000BBBB"}) {
		t.Fatalf("remembered gone: %v", got)
	}

	// A restart: the file unchanged (no upload), the character still left out.
	again := NewSyncer(s.store)
	again.installs, again.files = s.installs, s.files
	again.process(context.Background(), file)
	if snap := again.Snapshot(); len(snap.Characters) != 1 || snap.Gone != 1 {
		t.Fatalf("after a restart: listed %+v, %d gone", snap.Characters, snap.Gone)
	}

	// Played again: the site says so, and it's back.
	oldalt = "synced"
	_ = s.store.Update(func(c *Config) { c.Uploaded = map[string]string{} })
	s.process(context.Background(), file)
	if snap := s.Snapshot(); len(snap.Characters) != 2 || snap.Gone != 0 || len(s.store.Get().Gone) != 0 {
		t.Fatalf("played again: listed %+v, %d gone, remembered %v", snap.Characters, snap.Gone, s.store.Get().Gone)
	}
}

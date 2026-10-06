package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
)

// A character's saved file as the Hearthtale addon writes it: its records
// (moments, firsts) and the book it wrote at logout.
const hearthtaleFile = `
HearthtaleChar = {
	["guid"] = "Player-6113-0B4A2201",
	["name"] = "Brannok",
	["realm"] = "Nightslayer",
	["region"] = 1,
	["race"] = "Dwarf",
	["class"] = "HUNTER",
	["hardcore"] = true,
	["visited"] = {
		["Dun Morogh|"] = true,
	},
	["chapters"] = {
		{
			["log"] = {
				{
					["k"] = "kill",
					["name"] = "Ragged Young Wolf",
				}, -- [1]
			},
		}, -- [1]
	},
	["link"] = {
		["code"] = "K7Q2MX",
		["at"] = 1790900000,
	},
	["book"] = {
		["client"] = "classic",
		["at"] = 1790905640,
		["level"] = 9,
		["chapters"] = {
			{
				["number"] = 1,
				["text"] = "I begin in Coldridge Valley.",
				["from"] = 1,
				["to"] = 4,
			}, -- [1]
		},
	},
}
`

// A WoW folder with one account: WoWLocker's account file, Hearthtale's character file.
func fakeWoW(t *testing.T) (root, character string) {
	t.Helper()
	root = t.TempDir()
	acc := filepath.Join(root, "_classic_era_", "WTF", "Account", "MAX")
	character = filepath.Join(acc, "Nightslayer", "Brannok", "SavedVariables", "Hearthtale.lua")
	for _, f := range []string{filepath.Join(acc, "SavedVariables", "WowLocker.lua"), character} {
		if err := os.MkdirAll(filepath.Dir(f), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(acc, "SavedVariables", "WowLocker.lua"), []byte("WowLockerDB = {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(character, []byte(hearthtaleFile), 0o644); err != nil {
		t.Fatal(err)
	}
	// The account's own Hearthtale file (settings, the Hall) isn't a character's.
	if err := os.WriteFile(filepath.Join(acc, "SavedVariables", "Hearthtale.lua"), []byte("HearthtaleSettings = {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return root, character
}

func TestDiscoversEachSitesFiles(t *testing.T) {
	root, character := fakeWoW(t)
	installs := Discover([]string{root})
	if len(installs) != 1 || len(installs[0].Accounts) != 1 {
		t.Fatalf("installs: %+v", installs)
	}
	files := installs[0].Accounts[0].Files
	if len(files[WoWLocker]) != 1 || len(files[Hearthtale]) != 1 || files[Hearthtale][0] != character {
		t.Fatalf("files: %+v", files)
	}
}

// A Hearthtale site that answers as the real one does.
type fakeSite struct {
	mu       sync.Mutex
	uploads  []map[string]any
	status   string
	httpCode int
}

func (f *fakeSite) server(t *testing.T) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/companion/upload" || r.Header.Get("Authorization") != "Bearer tok" {
			http.Error(w, `{"error":"unknown or revoked companion"}`, http.StatusUnauthorized)
			return
		}
		var body struct {
			Characters []map[string]any `json:"characters"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.httpCode != 0 {
			http.Error(w, `{"error":"no"}`, f.httpCode)
			return
		}
		f.uploads = append(f.uploads, body.Characters...)
		c := body.Characters[0]
		_ = json.NewEncoder(w).Encode(map[string]any{"characters": []map[string]any{{
			"guid": c["guid"], "name": c["name"], "status": f.status, "chapters": 1, "characterId": 7,
		}}})
	}))
}

func syncerFor(t *testing.T, server string, root string) *Syncer {
	t.Helper()
	t.Setenv("RAVENPOST_CONFIG_DIR", t.TempDir())
	t.Setenv("RAVENPOST_LEGACY_DIR", t.TempDir())
	store, err := LoadStore()
	if err != nil {
		t.Fatal(err)
	}
	_ = store.SetLink(Hearthtale, Link{Server: server, Token: "tok", BattleTag: "Max#1234"})
	_ = store.Update(func(c *Config) { c.Folders = []string{root} })
	s := NewSyncer(store)
	s.installs = Discover([]string{root})
	for _, in := range s.installs {
		for _, a := range in.Accounts {
			for svc, paths := range a.Files {
				for _, p := range paths {
					s.files[p] = &fileState{service: svc, install: in, account: a}
				}
			}
		}
	}
	return s
}

func TestUploadsABookAndOnlyWhatTheSiteReads(t *testing.T) {
	root, character := fakeWoW(t)
	site := &fakeSite{status: "saved"}
	srv := site.server(t)
	defer srv.Close()
	s := syncerFor(t, srv.URL, root)

	s.process(context.Background(), character)
	if len(site.uploads) != 1 {
		t.Fatalf("uploads: %d", len(site.uploads))
	}
	sent := site.uploads[0]
	var keys []string
	for k := range sent {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	want := []string{"book", "class", "guid", "hardcore", "link", "name", "race", "realm", "region"}
	if len(keys) != len(want) {
		t.Fatalf("sent %v, want %v (the raw records stay home)", keys, want)
	}
	for i := range want {
		if keys[i] != want[i] {
			t.Fatalf("sent %v, want %v", keys, want)
		}
	}
	ch := s.characters[Hearthtale+"|Player-6113-0B4A2201"]
	if ch == nil || ch.Status != "saved" || ch.Name != "Brannok" || ch.Level != 9 || ch.Chapters != 1 {
		t.Fatalf("character: %+v", ch)
	}

	// The same file again: nothing to send.
	s.files[character].modTime = s.files[character].modTime.Add(-1)
	s.process(context.Background(), character)
	if len(site.uploads) != 1 {
		t.Fatalf("an unchanged file was sent again (%d uploads)", len(site.uploads))
	}
}

func TestUnlinkedAndExcluded(t *testing.T) {
	root, character := fakeWoW(t)
	site := &fakeSite{status: "unlinked"}
	srv := site.server(t)
	defer srv.Close()
	s := syncerFor(t, srv.URL, root)
	s.process(context.Background(), character)
	if ch := s.characters[Hearthtale+"|Player-6113-0B4A2201"]; ch.Status != "unlinked" {
		t.Fatalf("status %q", ch.Status)
	}

	// A character left out is never sent.
	site.uploads = nil
	_ = s.store.Update(func(c *Config) {
		c.ExcludedCharacters = []string{"Player-6113-0B4A2201"}
		c.Uploaded = map[string]string{}
	})
	s.files[character].modTime = s.files[character].modTime.Add(-1)
	s.process(context.Background(), character)
	if len(site.uploads) != 0 {
		t.Fatal("an excluded character was sent")
	}
}

func TestARevokedLinkIsDropped(t *testing.T) {
	root, character := fakeWoW(t)
	site := &fakeSite{status: "saved", httpCode: http.StatusUnauthorized}
	srv := site.server(t)
	defer srv.Close()
	s := syncerFor(t, srv.URL, root)
	s.process(context.Background(), character)
	if l := s.store.Get().LinkFor(Hearthtale); l.Token != "" {
		t.Fatalf("the link should be dropped: %+v", l)
	}
	if l := s.store.Get().LinkFor(WoWLocker); l.Server == "" {
		t.Fatal("the other site is untouched")
	}
}

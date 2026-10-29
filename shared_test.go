package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// An addon's account file as the kit's collector leaves it, for a player who said yes.
const yonderFile = `
YonderSettings = {
	["Maxou - Nightslayer"] = {},
}
YonderCollect = {
	["share"] = true,
	["game"] = "classic",
	["facts"] = {
		["enUS"] = {
			["quest"] = {
				[33] = {
					["title"] = "Wolves Across the Border",
					["details"] = "Hey $N, bring me meat.",
					["giver"] = "npc:197",
					["map"] = 1429,
					["x"] = 46.1,
					["y"] = 25.0,
					["b"] = "70003",
				},
			},
			["npc"] = {
				[299] = {
					["world"] = true,
					["name"] = "Young Wolf",
					["level"] = {
						2, -- [1]
						3, -- [2]
					},
					["type"] = "Beast",
					["typeId"] = 1,
					["familyId"] = 1,
					["b"] = "70003",
				},
			},
		},
	},
}
`

// The inbox, as the real one answers: a signed-in player's uploads.
type factSite struct {
	mu       sync.Mutex
	bodies   []map[string]any
	httpCode int
}

func (f *factSite) server(t *testing.T) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/facts" {
			http.Error(w, `{"error":"no"}`, http.StatusNotFound)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+sharedToken {
			http.Error(w, `{"error":"sign in with Battle.net"}`, http.StatusUnauthorized)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.httpCode != 0 {
			http.Error(w, `{"error":"down"}`, f.httpCode)
			return
		}
		f.bodies = append(f.bodies, body)
		n := 0
		for _, shelves := range body["facts"].(map[string]any) {
			for _, ids := range shelves.(map[string]any) {
				n += len(ids.(map[string]any))
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"facts": n})
	}))
}

// A token as the inbox hands it: its payload ({sub, tag}) and a signature.
const sharedToken = "eyJzdWIiOiJhYmMxMjMiLCJ0YWciOiJNYXgjMTIzNCJ9.c2lnbmVk"

// sharerFor: a syncer whose Ravenpost is linked to the inbox at server.
func sharerFor(t *testing.T, server, root string) *Syncer {
	t.Helper()
	s := syncerFor(t, server, root)
	_ = s.store.SetLink(Shared, Link{Server: server, Token: sharedToken, BattleTag: "Max#1234"})
	return s
}

// A WoW folder whose account has Yonder's account file.
func fakeShared(t *testing.T, flavour, content string) (root, file string) {
	t.Helper()
	root = t.TempDir()
	file = filepath.Join(root, flavour, "WTF", "Account", "MAX", "SavedVariables", "Yonder.lua")
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return root, file
}

// again: the file read anew, as after the game wrote it.
func again(s *Syncer, file string) {
	s.files[file].modTime = s.files[file].modTime.Add(-1)
	s.process(context.Background(), file)
}

func TestSharesTheFactsOnceAnonymously(t *testing.T) {
	root, file := fakeShared(t, "_classic_era_", yonderFile)
	site := &factSite{}
	srv := site.server(t)
	defer srv.Close()
	s := sharerFor(t, srv.URL, root)
	if s.files[file] == nil || s.files[file].service != Shared {
		t.Fatalf("the account file isn't tracked: %+v", s.files)
	}
	if files := s.installs[0].Accounts[0].Files; len(files) != 0 {
		t.Fatalf("the account file is no site's: %+v", files)
	}

	s.process(context.Background(), file)
	if len(site.bodies) != 1 {
		t.Fatalf("requests: %d", len(site.bodies))
	}
	b := site.bodies[0]
	enUS := b["facts"].(map[string]any)["enUS"].(map[string]any)
	q := enUS["quest"].(map[string]any)["33"].(map[string]any)
	w := enUS["npc"].(map[string]any)["299"].(map[string]any)
	level, _ := w["level"].([]any)
	if b["game"] != "classic" || q["details"] != "Hey $N, bring me meat." || len(level) != 2 || level[1] != 3.0 {
		t.Fatalf("body: %+v", b)
	}
	if w["world"] != true || w["typeId"] != 1.0 || w["familyId"] != 1.0 {
		t.Fatalf("world check and creature ids lost in transit: %+v", w)
	}
	if _, ok := b["facts"].(map[string]any)["enUS"].(map[string]any)["say"]; ok {
		t.Fatal("an empty shelf was sent")
	}
	if a := s.store.Get().Activity; len(a) != 1 || a[0].Kind != "shared" || a[0].Events != 2 || a[0].Name != "MAX" {
		t.Fatalf("activity: %+v", a)
	}
	if sh := s.Snapshot().Sharing; len(sh) != 1 || sh[0].Addon != "Yonder" || sh[0].Seen != 2 || sh[0].Waiting != 0 || sh[0].At.IsZero() || s.lastSync.IsZero() {
		t.Fatalf("the window's sharing: %+v", sh)
	}

	// The same file again: nothing. A quest's reward seen since: that quest alone.
	again(s, file)
	if len(site.bodies) != 1 {
		t.Fatalf("unchanged facts sent again (%d requests)", len(site.bodies))
	}
	grown := strings.Replace(yonderFile, `["giver"] = "npc:197",`, `["giver"] = "npc:197", ["reward"] = "Thanks, $N.",`, 1)
	if err := os.WriteFile(file, []byte(grown), 0o644); err != nil {
		t.Fatal(err)
	}
	again(s, file)
	if len(site.bodies) != 2 {
		t.Fatalf("requests: %d", len(site.bodies))
	}
	enUS = site.bodies[1]["facts"].(map[string]any)["enUS"].(map[string]any)
	if _, ok := enUS["npc"]; ok || enUS["quest"].(map[string]any)["33"].(map[string]any)["reward"] != "Thanks, $N." {
		t.Fatalf("second request: %+v", site.bodies[1])
	}

	// Ravenpost started again: what was sent is still known.
	s2 := sharerFor(t, srv.URL, root)
	s2.store = s.store
	s2.sent = loadSharedSent(filepath.Dir(s.store.path))
	s2.process(context.Background(), file)
	if len(site.bodies) != 2 {
		t.Fatalf("a restart sent it all again (%d requests)", len(site.bodies))
	}
}

func TestSharesNothingUnasked(t *testing.T) {
	site := &factSite{}
	srv := site.server(t)
	defer srv.Close()
	for name, c := range map[string]struct{ flavour, content string }{
		"said no":        {"_classic_era_", strings.Replace(yonderFile, `["share"] = true`, `["share"] = false`, 1)},
		"never asked":    {"_classic_era_", "YonderSettings = {}\n"},
		"a test realm":   {"_classic_era_ptr_", yonderFile},
		"no known world": {"_classic_era_", strings.Replace(yonderFile, `["game"] = "classic"`, `["game"] = "tbc"`, 1)},
	} {
		root, file := fakeShared(t, c.flavour, c.content)
		s := sharerFor(t, srv.URL, root)
		s.process(context.Background(), file)
		if len(site.bodies) != 0 || len(s.Snapshot().Sharing) != 0 {
			t.Fatalf("%s: sent %+v, sharing %+v", name, site.bodies, s.Snapshot().Sharing)
		}
	}

	// Forever's beta is no test realm: its facts go.
	broot, bfile := fakeShared(t, "_classic_beta_", strings.Replace(yonderFile, `["game"] = "classic"`, `["game"] = "forever"`, 1))
	bs := sharerFor(t, srv.URL, broot)
	bs.process(context.Background(), bfile)
	if len(site.bodies) == 0 {
		t.Fatal("Forever's beta folder sent nothing")
	}
	site.bodies = nil

	// An account left out sends nothing either.
	root, file := fakeShared(t, "_classic_era_", yonderFile)
	s := sharerFor(t, srv.URL, root)
	_ = s.store.Update(func(c *Config) { c.ExcludedAccounts = []string{s.files[file].account.Dir} })
	s.process(context.Background(), file)
	if len(site.bodies) != 0 {
		t.Fatal("an excluded account's facts were sent")
	}
}

func TestSharesInPiecesAndRetries(t *testing.T) {
	// Some 3 MB of quests: three requests at least, each under the site's limit.
	var quests strings.Builder
	long := strings.Repeat("The road is long and the wolves are many. ", 70)
	for id := 1; id <= 1000; id++ {
		fmt.Fprintf(&quests, "[%d] = { [\"title\"] = \"Quest %d\", [\"details\"] = %q, [\"b\"] = \"70003\" },\n", id+100, id, long)
	}
	content := "YonderCollect = { [\"share\"] = true, [\"game\"] = \"forever\", [\"facts\"] = { [\"deDE\"] = { [\"quest\"] = {\n" + quests.String() + "} } } }\n"
	root, file := fakeShared(t, "_forever_", content)
	site := &factSite{httpCode: http.StatusBadGateway}
	srv := site.server(t)
	defer srv.Close()
	s := sharerFor(t, srv.URL, root)

	s.process(context.Background(), file)
	if s.files[file].err == "" || len(s.sent.of(file)) != 0 {
		t.Fatalf("a failed upload: err %q, %d marked sent", s.files[file].err, len(s.sent.of(file)))
	}
	if sh := s.Snapshot().Sharing; len(sh) != 1 || sh[0].Waiting != 1000 || !sh[0].At.IsZero() {
		t.Fatalf("the window's sharing after a failure: %+v", sh)
	}

	site.httpCode = 0
	s.files[file].nextTry = s.files[file].nextTry.AddDate(-1, 0, 0)
	s.process(context.Background(), file)
	if len(site.bodies) < 3 {
		t.Fatalf("requests: %d", len(site.bodies))
	}
	n := 0
	for _, b := range site.bodies {
		raw, _ := json.Marshal(b)
		if len(raw) > 2*sharedChunk || b["game"] != "forever" {
			t.Fatalf("a request of %d bytes, game %v", len(raw), b["game"])
		}
		n += len(b["facts"].(map[string]any)["deDE"].(map[string]any)["quest"].(map[string]any))
	}
	if n != 1000 || len(s.sent.of(file)) != 1000 {
		t.Fatalf("sent %d quests, %d marked", n, len(s.sent.of(file)))
	}
}

func TestSharesOnlyOnceLinked(t *testing.T) {
	root, file := fakeShared(t, "_classic_era_", yonderFile)
	site := &factSite{}
	srv := site.server(t)
	defer srv.Close()

	// Not linked: kept for later, the window says how much waits.
	s := syncerFor(t, srv.URL, root)
	_ = s.store.SetLink(Shared, Link{Server: srv.URL})
	s.process(context.Background(), file)
	if len(site.bodies) != 0 {
		t.Fatal("sent before the player linked the addons' database")
	}
	if sh := s.Snapshot().Sharing; len(sh) != 1 || sh[0].Waiting != 2 {
		t.Fatalf("sharing: %+v", sh)
	}

	// A token the inbox no longer takes: the link is dropped, nothing marked sent.
	_ = s.store.SetLink(Shared, Link{Server: srv.URL, Token: "revoked.sig", BattleTag: "Max#1234"})
	again(s, file)
	if l := s.store.Get().LinkFor(Shared); l.Token != "" || len(s.sent.of(file)) != 0 {
		t.Fatalf("link %+v, %d marked sent", l, len(s.sent.of(file)))
	}

	// Linked: sent.
	_ = s.store.SetLink(Shared, Link{Server: srv.URL, Token: sharedToken, BattleTag: "Max#1234"})
	s.files[file].nextTry = s.files[file].nextTry.AddDate(-1, 0, 0)
	again(s, file)
	if len(site.bodies) != 1 {
		t.Fatalf("requests: %d", len(site.bodies))
	}
}

func TestAListOfFactsReadsAsKeys(t *testing.T) {
	m := asMap([]any{"a", "b"})
	if m["1"] != "a" || m["2"] != "b" || asMap("x") != nil {
		t.Fatalf("asMap: %+v", m)
	}
}

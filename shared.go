package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// What the game told players of the world, shared: the addons' kit collector
// (for a player who said yes on an addon's welcome page or its options) keeps
// it account-wide in the addon's saved file, and Ravenpost sends it to the
// addons' database through hearthtale.app, with no link and no account: an
// install's random id goes with it, so the site can count who agrees.
//
//	WTF/Account/<account>/SavedVariables/{Hearthtale,LorekeepersCodex,Yonder,SecondWind}.lua
//	<Addon>Collect = { share = true, game = "classic" | "forever",
//	  facts = { [locale] = { quest, npc, say, gossip, loot } } }
//
// Only the entries new or changed since the last upload go (shared.json keeps
// a hash of each one sent, per file), in requests of sharedChunk bytes at most.

const Shared = "shared"

// The addons' account-wide files: the table each keeps the facts in, and the
// addon's name as the window says it.
var sharedTables = map[string]struct{ table, addon string }{
	"Hearthtale.lua":       {"HearthtaleCollect", "Hearthtale"},
	"LorekeepersCodex.lua": {"LorekeepersCodexCollect", "Lorekeeper's Codex"},
	"Yonder.lua":           {"YonderCollect", "Yonder"},
	"SecondWind.lua":       {"SecondWindCollect", "Second Wind"},
}

// Share: one addon of one game account sharing what the game told its
// player, as the window shows it.
type Share struct {
	Addon   string `json:"addon"`
	Account string `json:"account"`
	Install string `json:"install"`
	// The entries the addon kept (a quest, a creature, an NPC's lines…), and
	// how many of them are still to send.
	Seen    int `json:"seen"`
	Waiting int `json:"waiting"`
	// The last upload.
	At time.Time `json:"at,omitzero"`
}

const (
	sharedChunk    = 1 << 20  // (the site takes 4 MB a request)
	maxSharedSize  = 64 << 20 // (an addon's account file holds more than the facts)
	sharedEndpoint = "/api/observations"
)

// sharedFiles: the addons' account-wide files under an account folder.
func sharedFiles(dir string) []string {
	var out []string
	for name := range sharedTables {
		if f := filepath.Join(dir, "SavedVariables", name); isFile(f) {
			out = append(out, f)
		}
	}
	sort.Strings(out)
	return out
}

// sharedGame: the world the facts are of, as the addon says, unless the
// client's folder is a test realm's.
func sharedGame(flavour string, collect map[string]any) string {
	game, _ := collect["game"].(string)
	if (game != "classic" && game != "forever") || strings.Contains(flavour, "ptr") {
		return ""
	}
	return game
}

// asMap: a Lua table of keys (the saved-file parser makes a table whose keys
// are exactly 1..n a list).
func asMap(v any) map[string]any {
	switch t := v.(type) {
	case map[string]any:
		return t
	case []any:
		m := make(map[string]any, len(t))
		for i, x := range t {
			m[strconv.Itoa(i+1)] = x
		}
		return m
	}
	return nil
}

// sharedEntry: one entry of the facts (a quest, a creature, an NPC's lines…).
type sharedEntry struct {
	locale, kind, id string
	value            any
	key, hash        string
	size             int
}

// sharedEntries: the file's entries, in a steady order.
func sharedEntries(facts map[string]any) []sharedEntry {
	var out []sharedEntry
	for _, locale := range sortedKeys(facts) {
		shelves := asMap(facts[locale])
		for _, kind := range sortedKeys(shelves) {
			ids := asMap(shelves[kind])
			for _, id := range sortedKeys(ids) {
				b, err := json.Marshal(ids[id]) // (map keys sorted: the same entry, the same bytes)
				if err != nil {
					continue
				}
				key := locale + "/" + kind + "/" + id
				sum := sha256.Sum256(append([]byte(key+"\x00"), b...))
				out = append(out, sharedEntry{locale, kind, id, ids[id], key, hex.EncodeToString(sum[:8]), len(b) + len(id) + 8})
			}
		}
	}
	return out
}

// sharedSent: the entries sent from each file (shared.json beside the config).
type sharedSent struct {
	mu   sync.Mutex
	path string
	sent map[string]map[string]string // file → entry key → hash
}

func loadSharedSent(dir string) *sharedSent {
	s := &sharedSent{path: filepath.Join(dir, "shared.json"), sent: map[string]map[string]string{}}
	if b, err := os.ReadFile(s.path); err == nil {
		_ = json.Unmarshal(b, &s.sent)
	}
	return s
}

func (s *sharedSent) of(file string) map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]string{}
	for k, v := range s.sent[file] {
		out[k] = v
	}
	return out
}

// mark: these entries of the file are sent; entries no longer in it are let go.
func (s *sharedSent) mark(file string, sent []sharedEntry, live map[string]bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	m := s.sent[file]
	if m == nil {
		m = map[string]string{}
		s.sent[file] = m
	}
	for _, e := range sent {
		m[e.key] = e.hash
	}
	for k := range m {
		if !live[k] {
			delete(m, k)
		}
	}
	b, err := json.Marshal(s.sent)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// installID: this install's random id, made once (the site keeps only its hash).
func (s *Syncer) installID() string {
	if id := s.store.Get().InstallID; id != "" {
		return id
	}
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	id := hex.EncodeToString(b)
	_ = s.store.Update(func(c *Config) {
		if c.InstallID == "" {
			c.InstallID = id
		}
		id = c.InstallID
	})
	return id
}

// share: the window's line for this file (nil: it shares nothing).
func (s *Syncer) share(path string, sh *Share) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if sh == nil {
		delete(s.shares, path)
		return
	}
	if old := s.shares[path]; old != nil && sh.At.IsZero() {
		sh.At = old.At
	}
	s.shares[path] = sh
}

func (s *Syncer) processShared(ctx context.Context, path string, f *fileState) error {
	cfg := s.store.Get()
	s.mu.Lock()
	f.modTime = fileTime(path)
	s.mu.Unlock()
	if contains(cfg.ExcludedAccounts, f.account.Dir) {
		s.share(path, nil)
		return nil
	}
	_, vars, err := readLimit(path, maxSharedSize)
	if err != nil {
		return err
	}
	addon := sharedTables[filepath.Base(path)]
	collect := asMap(vars[addon.table])
	game := sharedGame(f.install.Flavour, collect)
	if collect == nil || collect["share"] != true || game == "" {
		s.share(path, nil) // (the player hasn't said yes in this addon)
		return nil
	}
	entries := sharedEntries(asMap(collect["facts"]))
	sent := s.sent.of(path)
	live := map[string]bool{}
	var due []sharedEntry
	for _, e := range entries {
		live[e.key] = true
		if sent[e.key] != e.hash {
			due = append(due, e)
		}
	}
	line := &Share{Addon: addon.addon, Account: f.account.Name, Install: f.install.Label, Seen: len(entries), Waiting: len(due)}
	s.share(path, line)
	if len(due) == 0 {
		return s.sent.mark(path, nil, live)
	}
	defer s.announce([]string{addon.addon})()

	server := cfg.LinkFor(Hearthtale).Server
	contributor := s.installID()
	total := 0
	for start := 0; start < len(due); {
		end, size := start, 0
		facts := map[string]map[string]map[string]any{}
		for end < len(due) && (end == start || size+due[end].size <= sharedChunk) {
			e := due[end]
			if facts[e.locale] == nil {
				facts[e.locale] = map[string]map[string]any{}
			}
			if facts[e.locale][e.kind] == nil {
				facts[e.locale][e.kind] = map[string]any{}
			}
			facts[e.locale][e.kind][e.id] = e.value
			size += e.size
			end++
		}
		var res struct {
			Facts int `json:"facts"`
		}
		err := callWith(ctx, "POST", server, sharedEndpoint, map[string]string{"X-Contributor": contributor},
			map[string]any{"game": game, "facts": facts}, &res)
		if err != nil {
			if total > 0 {
				s.record(Activity{Kind: "shared", Service: Shared, Name: f.account.Name, Events: total})
			}
			s.mu.Lock()
			f.modTime = time.Time{}
			s.mu.Unlock()
			return fmt.Errorf("sharing: %w", err)
		}
		if err := s.sent.mark(path, due[start:end], live); err != nil {
			return err
		}
		total += res.Facts
		start = end
		s.share(path, &Share{Addon: line.Addon, Account: line.Account, Install: line.Install, Seen: line.Seen, Waiting: len(due) - end, At: time.Now()})
	}
	s.done(nil)
	log.Printf("shared %d facts from %s (%s)", total, path, game)
	s.record(Activity{Kind: "shared", Service: Shared, Name: f.account.Name, Events: total})
	return nil
}

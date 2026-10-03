package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

// The game writes SavedVariables on logout, /reload and disconnect. Polling
// file times every few seconds is cheap, needs no OS-specific watcher and
// survives the game replacing the file (it writes a new one, then renames).
const (
	pollEvery     = 3 * time.Second
	rescanEvery   = 30 * time.Second
	settleFor     = 2 * time.Second // the file must be this old: the game is done writing
	retryAfter    = time.Minute
	maxUploadSize = 8 << 20
)

// A character seen in a SavedVariables file.
type Character struct {
	GUID     string `json:"guid"`
	Name     string `json:"name"`
	Realm    string `json:"realm"`
	Class    string `json:"class"`
	Level    int    `json:"level"`
	Account  string `json:"account"` // the account folder
	Install  string `json:"install"` // the client folder's label
	Excluded bool   `json:"excluded"`
	// From the last upload.
	Status   string    `json:"status,omitempty"` // synced | unknown | invalid
	Events   int       `json:"events"`
	SyncedAt time.Time `json:"syncedAt,omitzero"`
	ID       int       `json:"characterId,omitempty"`
}

type fileState struct {
	modTime   time.Time
	nextTry   time.Time
	err       string
	install   Install
	account   Account
	uploading bool
}

type Syncer struct {
	store *Store

	mu         sync.Mutex
	installs   []Install
	files      map[string]*fileState
	characters map[string]*Character
	lastSync   time.Time
	lastError  string
	scannedAt  time.Time

	kick     chan struct{}
	onChange func()
	// Character names of the upload in progress (tray, settings page).
	uploading []string
	// Called after a successful upload with the characters' names and new events.
	// The characters of the last successful upload: shown in the tray and settings page.
	lastUploaded []UploadedCharacter
}

// UploadedCharacter: one character of a successful upload.
type UploadedCharacter struct {
	Name   string `json:"name"`
	Events int    `json:"events"`
}

func NewSyncer(store *Store) *Syncer {
	return &Syncer{
		store:      store,
		files:      map[string]*fileState{},
		characters: map[string]*Character{},
		kick:       make(chan struct{}, 1),
		onChange:   func() {},
	}
}

// SyncNow rescans the folders and re-reads every file at once. Files are
// uploaded if they changed since their last upload, or all of them with force.
func (s *Syncer) SyncNow(force bool) {
	s.mu.Lock()
	s.scannedAt = time.Time{}
	for _, f := range s.files {
		f.nextTry, f.modTime = time.Time{}, time.Time{}
	}
	s.mu.Unlock()
	if force {
		_ = s.store.Update(func(c *Config) { c.Uploaded = map[string]string{} })
	}
	select {
	case s.kick <- struct{}{}:
	default:
	}
}

func (s *Syncer) Run(ctx context.Context) {
	t := time.NewTicker(pollEvery)
	defer t.Stop()
	for {
		s.tick(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		case <-s.kick:
		}
	}
}

func (s *Syncer) tick(ctx context.Context) {
	cfg := s.store.Get()
	s.mu.Lock()
	if time.Since(s.scannedAt) > rescanEvery {
		s.installs = Discover(append(cfg.Folders, defaultRoots()...))
		s.scannedAt = time.Now()
		live := map[string]bool{}
		for _, in := range s.installs {
			for _, a := range in.Accounts {
				live[a.File] = true
				if s.files[a.File] == nil {
					s.files[a.File] = &fileState{}
				}
				s.files[a.File].install, s.files[a.File].account = in, a
			}
		}
		for p := range s.files {
			if !live[p] {
				delete(s.files, p)
			}
		}
	}
	var due []string
	for path, f := range s.files {
		st, err := os.Stat(path)
		if err != nil || f.uploading || time.Now().Before(f.nextTry) {
			continue
		}
		if !st.ModTime().Equal(f.modTime) && time.Since(st.ModTime()) >= settleFor {
			due = append(due, path)
		}
	}
	s.mu.Unlock()

	sort.Strings(due)
	for _, path := range due {
		s.process(ctx, path)
	}
}

// process reads one SavedVariables file, lists its characters and uploads it
// when its content (or the selection) changed since the last upload.
func (s *Syncer) process(ctx context.Context, path string) {
	s.mu.Lock()
	f := s.files[path]
	if f == nil {
		s.mu.Unlock()
		return
	}
	f.uploading = true
	s.mu.Unlock()

	err := s.processFile(ctx, path, f)

	s.mu.Lock()
	f.uploading = false
	if err != nil {
		f.err = err.Error()
		f.nextTry = time.Now().Add(retryAfter)
		s.lastError = fmt.Sprintf("%s: %s", f.account.Name, err)
		log.Printf("sync %s: %v", path, err)
	} else {
		f.err = ""
	}
	s.mu.Unlock()
	s.onChange()
}

func (s *Syncer) processFile(ctx context.Context, path string, f *fileState) error {
	st, err := os.Stat(path)
	if err != nil {
		return err
	}
	if st.Size() > maxUploadSize {
		return fmt.Errorf("file too large (%d MB)", st.Size()>>20)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	vars, err := ParseSavedVariables(string(raw))
	if err != nil {
		return err
	}
	db, _ := vars["WowLockerDB"].(map[string]any)
	if db == nil {
		return errors.New("no WowLockerDB in the file")
	}
	chars, _ := db["characters"].(map[string]any)

	cfg := s.store.Get()
	accountOff := contains(cfg.ExcludedAccounts, f.account.Dir)
	selected := map[string]any{}
	s.mu.Lock()
	for guid, v := range chars {
		c, _ := v.(map[string]any)
		if c == nil {
			continue
		}
		ch := s.characters[guid]
		if ch == nil {
			ch = &Character{GUID: guid}
			s.characters[guid] = ch
		}
		ch.Name, _ = c["name"].(string)
		ch.Realm, _ = c["realm"].(string)
		ch.Class, _ = c["class"].(string)
		if st, ok := c["state"].(map[string]any); ok {
			if lvl, ok := st["level"].(float64); ok {
				ch.Level = int(lvl)
			}
		}
		ch.Account, ch.Install = f.account.Name, f.install.Label
		ch.Excluded = accountOff || contains(cfg.ExcludedCharacters, guid)
		if !ch.Excluded {
			selected[guid] = c
		}
	}
	s.mu.Unlock()

	// Same content and same selection as the last upload: nothing to do.
	sum := sha256.New()
	sum.Write(raw)
	for _, g := range sortedKeys(selected) {
		sum.Write([]byte("\x00" + g))
	}
	hash := hex.EncodeToString(sum.Sum(nil))
	s.mu.Lock()
	f.modTime = st.ModTime()
	s.mu.Unlock()
	if cfg.Token == "" || len(selected) == 0 || cfg.Uploaded[path] == hash {
		return nil
	}

	format, _ := db["format"].(float64)
	names := []string{}
	for _, g := range sortedKeys(selected) {
		if ch := s.characters[g]; ch != nil && ch.Name != "" {
			names = append(names, ch.Name)
		}
	}
	s.mu.Lock()
	s.uploading = names
	s.mu.Unlock()
	s.onChange()
	defer func() {
		s.mu.Lock()
		s.uploading = nil
		s.mu.Unlock()
		s.onChange()
	}()
	var res uploadResult
	err = call(ctx, "POST", cfg.Server, "/api/companion/upload", cfg.Token,
		map[string]any{"format": format, "characters": selected}, &res)
	if errors.Is(err, errUnauthorized) {
		_ = s.store.Update(func(c *Config) { c.Token, c.BattleTag = "", "" })
	}
	if err != nil {
		s.mu.Lock()
		f.modTime = time.Time{} // try this file again
		s.mu.Unlock()
		return err
	}
	now := time.Now()
	s.mu.Lock()
	var synced []string
	var uploaded []UploadedCharacter
	for _, r := range res.Characters {
		if ch := s.characters[r.GUID]; ch != nil {
			ch.Status, ch.Events, ch.SyncedAt, ch.ID = r.Status, r.Events, now, r.CharacterID
		}
		if r.Status == "synced" {
			synced = append(synced, fmt.Sprintf("%s (+%d)", r.Name, r.Events))
			uploaded = append(uploaded, UploadedCharacter{Name: r.Name, Events: r.Events})
		}
	}
	s.lastSync, s.lastError = now, ""
	if len(uploaded) > 0 {
		s.lastUploaded = uploaded
	}
	s.mu.Unlock()
	log.Printf("uploaded %s: %s", path, strings.Join(synced, ", "))
	return s.store.Update(func(c *Config) { c.Uploaded[path] = hash })
}

// Snapshot is what the settings page and the tray show.
type Snapshot struct {
	Installs   []Install   `json:"installs"`
	Characters []Character `json:"characters"`
	LastSync   time.Time   `json:"lastSync,omitzero"`
	LastError  string      `json:"lastError,omitempty"`
	Errors     []string    `json:"errors"`
	Uploading  []string    `json:"uploading"`
	// What the last upload brought (names and new events).
	LastUploaded []UploadedCharacter `json:"lastUploaded"`
}

func (s *Syncer) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := Snapshot{Installs: s.installs, LastSync: s.lastSync, LastError: s.lastError, Errors: []string{}, Uploading: append([]string{}, s.uploading...), LastUploaded: append([]UploadedCharacter{}, s.lastUploaded...)}
	for _, c := range s.characters {
		out.Characters = append(out.Characters, *c)
	}
	sort.Slice(out.Characters, func(i, j int) bool {
		a, b := out.Characters[i], out.Characters[j]
		if a.Level != b.Level {
			return a.Level > b.Level
		}
		return a.Name < b.Name
	})
	for _, f := range s.files {
		if f.err != "" {
			out.Errors = append(out.Errors, f.account.Name+": "+f.err)
		}
	}
	if out.Installs == nil {
		out.Installs = []Install{}
	}
	if out.Characters == nil {
		out.Characters = []Character{}
	}
	return out
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

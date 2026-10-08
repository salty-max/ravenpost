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

// The game writes saved files on logout, /reload and disconnect. Polling
// file times every few seconds is cheap, needs no OS-specific watcher and
// survives the game replacing the file (it writes a new one, then renames).
const (
	pollEvery     = 3 * time.Second
	rescanEvery   = 30 * time.Second
	settleFor     = 2 * time.Second // the file must be this old: the game is done writing
	retryAfter    = time.Minute
	maxUploadSize = 8 << 20
)

// A character seen in a site's saved file.
type Character struct {
	Service string `json:"service"`
	GUID    string `json:"guid"`
	Name    string `json:"name"`
	Realm   string `json:"realm"`
	Class   string `json:"class"`
	Level   int    `json:"level"`
	Account string `json:"account"` // the account folder
	Install string `json:"install"` // the client folder's label
	// When it was last played, as its addon saved it (the list's order).
	LastSeen time.Time `json:"lastSeen,omitzero"`
	Excluded bool      `json:"excluded"`
	// The site says the account no longer has it (deleted): not listed.
	Gone bool `json:"-"`
	// From the last upload. WoWLocker: synced | unknown | invalid | gone (+ events);
	// Hearthtale: saved | unlinked | invalid | removed (+ chapters).
	Status   string    `json:"status,omitempty"`
	Events   int       `json:"events"`
	Chapters int       `json:"chapters"`
	SyncedAt time.Time `json:"syncedAt,omitzero"`
	ID       int       `json:"characterId,omitempty"`
}

type fileState struct {
	service   string
	guid      string // Hearthtale: the character the file belongs to (a new one may take over a deleted one's file)
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
	characters map[string]*Character // by service + "|" + GUID
	lastSync   time.Time
	lastError  string
	scannedAt  time.Time

	kick     chan struct{}
	onChange func()
	// Character names of the upload in progress (tray, settings page).
	uploading []string
	// The characters of the last successful upload: shown in the tray and settings page.
	lastUploaded []UploadedCharacter
}

// UploadedCharacter: one character of a successful upload.
type UploadedCharacter struct {
	Service string `json:"service"`
	Name    string `json:"name"`
	Events  int    `json:"events"`
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
				for service, paths := range a.Files {
					for _, p := range paths {
						live[p] = true
						if s.files[p] == nil {
							s.files[p] = &fileState{}
						}
						s.files[p].service, s.files[p].install, s.files[p].account = service, in, a
					}
				}
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

// process reads one saved file, lists its characters and uploads it when its
// content (or the selection) changed since the last upload.
func (s *Syncer) process(ctx context.Context, path string) {
	s.mu.Lock()
	f := s.files[path]
	if f == nil {
		s.mu.Unlock()
		return
	}
	f.uploading = true
	s.mu.Unlock()

	var err error
	if f.service == Hearthtale {
		err = s.processHearthtale(ctx, path, f)
	} else {
		err = s.processWoWLocker(ctx, path, f)
	}

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

// read: the file's raw content and its variables.
func read(path string) ([]byte, map[string]any, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, nil, err
	}
	if st.Size() > maxUploadSize {
		return nil, nil, fmt.Errorf("file too large (%d MB)", st.Size()>>20)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	vars, err := ParseSavedVariables(string(raw))
	return raw, vars, err
}

// character: the entry for one character of one site (created on first sight).
func (s *Syncer) character(service, guid string) *Character {
	key := service + "|" + guid
	ch := s.characters[key]
	if ch == nil {
		ch = &Character{Service: service, GUID: guid}
		s.characters[key] = ch
	}
	return ch
}

// uploadHash: the content, and which characters it sends (the selection changes the upload).
func uploadHash(raw []byte, selected []string) string {
	sum := sha256.New()
	sum.Write(raw)
	for _, g := range selected {
		sum.Write([]byte("\x00" + g))
	}
	return hex.EncodeToString(sum.Sum(nil))
}

// announce marks an upload in progress (tray, settings page); the returned func ends it.
func (s *Syncer) announce(names []string) func() {
	s.mu.Lock()
	s.uploading = names
	s.mu.Unlock()
	s.onChange()
	return func() {
		s.mu.Lock()
		s.uploading = nil
		s.mu.Unlock()
		s.onChange()
	}
}

// failed: the site no longer knows this computer (its link is dropped), or try the file again later.
func (s *Syncer) failed(service string, f *fileState, err error) error {
	if errors.Is(err, errUnauthorized) {
		_ = s.store.Update(func(c *Config) {
			if l := c.Links[service]; l != nil {
				l.Token, l.BattleTag = "", ""
			}
		})
	}
	s.mu.Lock()
	f.modTime = time.Time{}
	s.mu.Unlock()
	return err
}

func (s *Syncer) done(uploaded []UploadedCharacter) {
	s.mu.Lock()
	s.lastSync, s.lastError = time.Now(), ""
	if len(uploaded) > 0 {
		s.lastUploaded = uploaded
	}
	s.mu.Unlock()
}

// ── WoWLocker: one file per game account, all its characters in one upload ──

func (s *Syncer) processWoWLocker(ctx context.Context, path string, f *fileState) error {
	raw, vars, err := read(path)
	if err != nil {
		return err
	}
	db, _ := vars["WowLockerDB"].(map[string]any)
	if db == nil {
		return errors.New("no WowLockerDB in the file")
	}
	chars, _ := db["characters"].(map[string]any)

	cfg := s.store.Get()
	link := cfg.LinkFor(WoWLocker)
	accountOff := contains(cfg.ExcludedAccounts, f.account.Dir)
	selected := map[string]any{}
	s.mu.Lock()
	for guid, v := range chars {
		c, _ := v.(map[string]any)
		if c == nil {
			continue
		}
		ch := s.character(WoWLocker, guid)
		ch.Name, _ = c["name"].(string)
		ch.Realm, _ = c["realm"].(string)
		ch.Class, _ = c["class"].(string)
		if st, ok := c["state"].(map[string]any); ok {
			if lvl, ok := st["level"].(float64); ok {
				ch.Level = int(lvl)
			}
			if at, ok := st["updatedAt"].(float64); ok && at > 0 {
				ch.LastSeen = time.Unix(int64(at), 0)
			}
		}
		ch.Account, ch.Install = f.account.Name, f.install.Label
		ch.Excluded = accountOff || contains(cfg.ExcludedCharacters, guid)
		ch.Gone = contains(cfg.Gone, guid)
		if !ch.Excluded {
			selected[guid] = c
		}
	}
	f.modTime = fileTime(path)
	s.mu.Unlock()

	// Same content and same selection as the last upload: nothing to do.
	hash := uploadHash(raw, sortedKeys(selected))
	if link.Token == "" || len(selected) == 0 || cfg.Uploaded[path] == hash {
		return nil
	}

	format, _ := db["format"].(float64)
	names := []string{}
	for _, g := range sortedKeys(selected) {
		if ch := s.characters[WoWLocker+"|"+g]; ch != nil && ch.Name != "" {
			names = append(names, ch.Name)
		}
	}
	defer s.announce(names)()
	var res wowlockerResult
	err = call(ctx, "POST", link.Server, "/api/companion/upload", link.Token,
		map[string]any{"format": format, "characters": selected}, &res)
	if err != nil {
		return s.failed(WoWLocker, f, err)
	}
	now := time.Now()
	s.mu.Lock()
	var synced []string
	var uploaded []UploadedCharacter
	gone := map[string]bool{}
	for _, r := range res.Characters {
		gone[r.GUID] = r.Status == "gone"
		if ch := s.characters[WoWLocker+"|"+r.GUID]; ch != nil {
			ch.Status, ch.Events, ch.SyncedAt, ch.ID = r.Status, r.Events, now, r.CharacterID
			ch.Gone = gone[r.GUID]
		}
		if r.Status == "synced" {
			synced = append(synced, fmt.Sprintf("%s (+%d)", r.Name, r.Events))
			uploaded = append(uploaded, UploadedCharacter{Service: WoWLocker, Name: r.Name, Events: r.Events})
		}
	}
	s.mu.Unlock()
	s.done(uploaded)
	log.Printf("uploaded %s to WoWLocker: %s", path, strings.Join(synced, ", "))
	return s.store.Update(func(c *Config) {
		c.Uploaded[path] = hash
		c.Gone = updateGone(c.Gone, gone)
	})
}

// ── Hearthtale: one file per character, its book as the addon wrote it at logout ──

// hearthtaleFields: what the site reads of a character's record (the rest,
// its raw moments, stays on this computer).
var hearthtaleFields = []string{"guid", "name", "realm", "region", "race", "class", "hardcore", "closed", "book", "link"}

func (s *Syncer) processHearthtale(ctx context.Context, path string, f *fileState) error {
	raw, vars, err := read(path)
	if err != nil {
		return err
	}
	rec, _ := vars["HearthtaleChar"].(map[string]any)
	if rec == nil {
		return errors.New("no HearthtaleChar in the file")
	}
	guid, _ := rec["guid"].(string)
	if guid == "" {
		return errors.New("a journal without its character")
	}
	cfg := s.store.Get()
	link := cfg.LinkFor(Hearthtale)
	s.mu.Lock()
	// The file now another character's (one deleted, a new one of its name
	// in its folder): the old one leaves the list.
	if f.guid != "" && f.guid != guid {
		delete(s.characters, Hearthtale+"|"+f.guid)
	}
	f.guid = guid
	ch := s.character(Hearthtale, guid)
	ch.Name, _ = rec["name"].(string)
	ch.Realm, _ = rec["realm"].(string)
	ch.Class, _ = rec["class"].(string)
	if book, ok := rec["book"].(map[string]any); ok {
		if lvl, ok := book["level"].(float64); ok {
			ch.Level = int(lvl)
		}
	}
	ch.Account, ch.Install = f.account.Name, f.install.Label
	ch.Excluded = contains(cfg.ExcludedAccounts, f.account.Dir) || contains(cfg.ExcludedCharacters, guid)
	excluded := ch.Excluded
	f.modTime = fileTime(path)
	// last played: its logout, else the file's time
	ch.LastSeen = f.modTime
	if out, ok := rec["logout"].(map[string]any); ok {
		if at, ok := out["at"].(float64); ok && at > 0 {
			ch.LastSeen = time.Unix(int64(at), 0)
		}
	}
	s.mu.Unlock()

	if _, ok := rec["book"].(map[string]any); !ok {
		return nil // no logout written by this version of the addon yet
	}
	hash := uploadHash(raw, []string{guid})
	if link.Token == "" || excluded || cfg.Uploaded[path] == hash {
		return nil
	}
	sent := map[string]any{}
	for _, k := range hearthtaleFields {
		if v, ok := rec[k]; ok {
			sent[k] = v
		}
	}
	defer s.announce([]string{ch.Name})()
	var res hearthtaleResult
	if err := call(ctx, "POST", link.Server, "/api/companion/upload", link.Token, map[string]any{"characters": []any{sent}}, &res); err != nil {
		return s.failed(Hearthtale, f, err)
	}
	now := time.Now()
	var uploaded []UploadedCharacter
	s.mu.Lock()
	for _, r := range res.Characters {
		if r.GUID != guid {
			continue
		}
		ch.Status, ch.Chapters, ch.SyncedAt, ch.ID = r.Status, r.Chapters, now, r.CharacterID
		if r.Status == "saved" {
			uploaded = append(uploaded, UploadedCharacter{Service: Hearthtale, Name: r.Name})
		}
	}
	status := ch.Status
	s.mu.Unlock()
	s.done(uploaded)
	log.Printf("uploaded %s to Hearthtale: %s", path, status)
	return s.store.Update(func(c *Config) { c.Uploaded[path] = hash })
}

func fileTime(path string) time.Time {
	st, err := os.Stat(path)
	if err != nil {
		return time.Time{}
	}
	return st.ModTime()
}

// Snapshot is what the settings page and the tray show.
type Snapshot struct {
	Installs   []Install   `json:"installs"`
	Characters []Character `json:"characters"`
	// Characters left out of the list: the site says they were deleted.
	Gone      int       `json:"gone"`
	LastSync  time.Time `json:"lastSync,omitzero"`
	LastError string    `json:"lastError,omitempty"`
	Errors    []string  `json:"errors"`
	Uploading []string  `json:"uploading"`
	// What the last upload brought (names and new events).
	LastUploaded []UploadedCharacter `json:"lastUploaded"`
}

// installsNow: the last scan (every 30 s), except that an account whose files
// were missing then is looked at again: right after an addon's first save, the
// page shouldn't still say it hasn't run. A copy: callers can't race the scan.
func (s *Syncer) installsNow() []Install {
	out := make([]Install, len(s.installs))
	for i, in := range s.installs {
		in.Accounts = append([]Account(nil), in.Accounts...)
		for j, a := range in.Accounts {
			if len(a.Files) < len(services) {
				in.Accounts[j].Files = savedFiles(a.Dir)
			}
		}
		out[i] = in
	}
	return out
}

func (s *Syncer) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := Snapshot{Installs: s.installsNow(), LastSync: s.lastSync, LastError: s.lastError, Errors: []string{}, Uploading: append([]string{}, s.uploading...), LastUploaded: append([]UploadedCharacter{}, s.lastUploaded...)}
	superseded := supersededCharacters(s.characters)
	for key, c := range s.characters {
		if c.Gone || superseded[key] {
			out.Gone++
			continue
		}
		out.Characters = append(out.Characters, *c)
	}
	// the last played first
	sort.Slice(out.Characters, func(i, j int) bool {
		a, b := out.Characters[i], out.Characters[j]
		if !a.LastSeen.Equal(b.LastSeen) {
			return a.LastSeen.After(b.LastSeen)
		}
		if a.Level != b.Level {
			return a.Level > b.Level
		}
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		return a.Service < b.Service
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

// updateGone: the GUIDs a site called gone, with an upload's answers (true:
// gone, false: there after all, played again); the others unchanged. Sorted.
func updateGone(prev []string, answers map[string]bool) []string {
	set := map[string]bool{}
	for _, g := range prev {
		set[g] = true
	}
	for g, isGone := range answers {
		if isGone {
			set[g] = true
		} else {
			delete(set, g)
		}
	}
	if len(set) == 0 {
		return nil
	}
	out := make([]string, 0, len(set))
	for g := range set {
		out = append(out, g)
	}
	sort.Strings(out)
	return out
}

// supersededCharacters: of the characters of one name on one realm of one
// game (a deleted one, and the new one made with its name), all but the one
// played last. Keys of the syncer's map.
func supersededCharacters(chars map[string]*Character) map[string]bool {
	latest := map[string]string{} // service|install|realm|name = key
	for key, c := range chars {
		if c.Name == "" {
			continue
		}
		who := strings.ToLower(c.Service + "|" + c.Install + "|" + c.Realm + "|" + c.Name)
		if prev, ok := latest[who]; !ok || c.LastSeen.After(chars[prev].LastSeen) {
			latest[who] = key
		}
	}
	out := map[string]bool{}
	for key, c := range chars {
		if c.Name == "" {
			continue
		}
		who := strings.ToLower(c.Service + "|" + c.Install + "|" + c.Realm + "|" + c.Name)
		if latest[who] != key {
			out[key] = true
		}
	}
	return out
}

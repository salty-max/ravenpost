package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
)

// Config is everything the companion remembers, in
// <user config dir>/wow-locker/config.json (0600: it holds the upload token).
type Config struct {
	// The WoWLocker server (the web app's origin; the API lives under /api).
	Server string `json:"server"`
	// Upload token from pairing, valid only for Server. Empty: not paired.
	Token     string `json:"token,omitempty"`
	BattleTag string `json:"battletag,omitempty"`
	// WoW folders added by hand, on top of the ones found automatically.
	Folders []string `json:"folders"`
	// Not uploaded: account folders (absolute paths) and character GUIDs.
	ExcludedAccounts   []string `json:"excludedAccounts"`
	ExcludedCharacters []string `json:"excludedCharacters"`
	LaunchAtLogin      bool     `json:"launchAtLogin"`
	// Secret of the local settings page (other web pages can't call it).
	Key string `json:"key"`
	// SavedVariables file → hash of what was last uploaded from it.
	Uploaded map[string]string `json:"uploaded"`
}

// Set at build time for releases: -ldflags "-X main.defaultServer=https://…"
var defaultServer = "http://localhost:5174"

type Store struct {
	mu   sync.Mutex
	path string
	cfg  Config
}

func configDir() (string, error) {
	if dir := os.Getenv("WOWLOCKER_CONFIG_DIR"); dir != "" { // tests, several profiles
		return dir, nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "wow-locker"), nil
}

func LoadStore() (*Store, error) {
	dir, err := configDir()
	if err != nil {
		return nil, err
	}
	s := &Store{path: filepath.Join(dir, "config.json")}
	b, err := os.ReadFile(s.path)
	switch {
	case errors.Is(err, fs.ErrNotExist):
	case err != nil:
		return nil, err
	default:
		if err := json.Unmarshal(b, &s.cfg); err != nil {
			return nil, err
		}
	}
	if s.cfg.Server == "" {
		s.cfg.Server = defaultServer
	}
	if s.cfg.Key == "" {
		k := make([]byte, 24)
		if _, err := rand.Read(k); err != nil {
			return nil, err
		}
		s.cfg.Key = hex.EncodeToString(k)
	}
	if s.cfg.Uploaded == nil {
		s.cfg.Uploaded = map[string]string{}
	}
	return s, s.saveLocked()
}

// Get returns a copy of the config.
func (s *Store) Get() Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.cfg
	c.Folders = append([]string(nil), c.Folders...)
	c.ExcludedAccounts = append([]string(nil), c.ExcludedAccounts...)
	c.ExcludedCharacters = append([]string(nil), c.ExcludedCharacters...)
	c.Uploaded = make(map[string]string, len(s.cfg.Uploaded))
	for k, v := range s.cfg.Uploaded {
		c.Uploaded[k] = v
	}
	return c
}

// Update changes the config and saves it.
func (s *Store) Update(fn func(c *Config)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(&s.cfg)
	return s.saveLocked()
}

func (s *Store) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s.cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

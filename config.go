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

// Link: Ravenpost linked to one site. Empty Token: not linked.
type Link struct {
	// The site (the web app's origin; the API lives under /api).
	Server    string `json:"server"`
	Token     string `json:"token,omitempty"`
	BattleTag string `json:"battletag,omitempty"`
}

// Config is everything Ravenpost remembers, in <user config dir>/ravenpost/config.json
// (0600: it holds the upload tokens).
type Config struct {
	// Per site (services.go), by its id.
	Links map[string]*Link `json:"links"`
	// WoW folders added by hand, on top of the ones found automatically.
	Folders []string `json:"folders"`
	// Not uploaded: account folders (absolute paths) and character GUIDs.
	ExcludedAccounts   []string `json:"excludedAccounts"`
	ExcludedCharacters []string `json:"excludedCharacters"`
	LaunchAtLogin      bool     `json:"launchAtLogin"`
	// Secret of the local settings page (other web pages can't call it).
	Key string `json:"key"`
	// Saved file → hash of what was last uploaded from it.
	Uploaded map[string]string `json:"uploaded"`
}

// LinkFor: the site's link (a copy), its server defaulted.
func (c Config) LinkFor(id string) Link {
	if l := c.Links[id]; l != nil {
		return *l
	}
	return Link{Server: defaultServer(id)}
}

type Store struct {
	mu   sync.Mutex
	path string
	cfg  Config
}

func configDir() (string, error) {
	if dir := os.Getenv("RAVENPOST_CONFIG_DIR"); dir != "" { // tests, several profiles
		return dir, nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "ravenpost"), nil
}

// The WoWLocker companion's config (Ravenpost's former self), carried over once.
func legacyConfigPath() string {
	if dir := os.Getenv("RAVENPOST_LEGACY_DIR"); dir != "" {
		return filepath.Join(dir, "config.json")
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(base, "wow-locker", "config.json")
}

// cleanLegacyLaunch removes the old companion's start at login (tests replace
// it: they must never touch the machine's real login items).
var cleanLegacyLaunch = removeLegacyLaunch

type legacyConfig struct {
	Server             string            `json:"server"`
	Token              string            `json:"token"`
	BattleTag          string            `json:"battletag"`
	Folders            []string          `json:"folders"`
	ExcludedAccounts   []string          `json:"excludedAccounts"`
	ExcludedCharacters []string          `json:"excludedCharacters"`
	LaunchAtLogin      bool              `json:"launchAtLogin"`
	Uploaded           map[string]string `json:"uploaded"`
}

// migrate: a WoWLocker companion's settings and link become Ravenpost's.
func migrate(path string) (Config, bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return Config{}, false
	}
	var old legacyConfig
	if json.Unmarshal(b, &old) != nil {
		return Config{}, false
	}
	return Config{
		Links:              map[string]*Link{WoWLocker: {Server: old.Server, Token: old.Token, BattleTag: old.BattleTag}},
		Folders:            old.Folders,
		ExcludedAccounts:   old.ExcludedAccounts,
		ExcludedCharacters: old.ExcludedCharacters,
		LaunchAtLogin:      old.LaunchAtLogin,
		Uploaded:           old.Uploaded,
	}, true
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
		if cfg, ok := migrate(legacyConfigPath()); ok {
			s.cfg = cfg
			// The old companion stops starting at login; Ravenpost does instead.
			if cleanLegacyLaunch() && cfg.LaunchAtLogin {
				if err := setLaunchAtLogin(true); err != nil {
					s.cfg.LaunchAtLogin = false
				}
			}
		}
	case err != nil:
		return nil, err
	default:
		if err := json.Unmarshal(b, &s.cfg); err != nil {
			return nil, err
		}
	}
	if s.cfg.Links == nil {
		s.cfg.Links = map[string]*Link{}
	}
	for _, svc := range services {
		if l := s.cfg.Links[svc.ID]; l == nil || l.Server == "" {
			s.cfg.Links[svc.ID] = &Link{Server: defaultServer(svc.ID)}
		}
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
	c.Links = make(map[string]*Link, len(s.cfg.Links))
	for k, v := range s.cfg.Links {
		l := *v
		c.Links[k] = &l
	}
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

// SetLink replaces one site's link.
func (s *Store) SetLink(id string, l Link) error {
	return s.Update(func(c *Config) { c.Links[id] = &l })
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

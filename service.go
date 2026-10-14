package main

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// Ravenpost is what the window can ask of the app: its methods are bound by
// Wails (TypeScript in frontend/bindings, `wails3 generate bindings`), and
// every change reaches the window as a "state" event (desktop.go).
type Ravenpost struct {
	app *App
	// The native folder picker (the window's own sheet); nil in tests.
	chooseFolder func() (string, error)
}

// SiteState: one site, as the window shows it.
type SiteState struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Addon     string   `json:"addon"`
	Server    string   `json:"server"`
	Linked    bool     `json:"linked"`
	BattleTag string   `json:"battletag"`
	Pairing   *Pairing `json:"pairing"`
}

// State is everything the window shows, sent whole on each change.
type State struct {
	Version            string      `json:"version"`
	Language           string      `json:"language"`
	Sites              []SiteState `json:"sites"`
	LaunchAtLogin      bool        `json:"launchAtLogin"`
	Folders            []string    `json:"folders"`
	ExcludedAccounts   []string    `json:"excludedAccounts"`
	ExcludedCharacters []string    `json:"excludedCharacters"`

	Installs     []Install           `json:"installs"`
	Characters   []Character         `json:"characters"`
	Gone         int                 `json:"gone"`
	LastSync     time.Time           `json:"lastSync,omitzero"`
	Errors       []string            `json:"errors"`
	Uploading    []string            `json:"uploading"`
	LastUploaded []UploadedCharacter `json:"lastUploaded"`
	Activity     []Activity          `json:"activity"`
	Sharing      []Share             `json:"sharing"`
	// The addons' database: linked with Battle.net or not, its sign-in under way.
	Facts SiteState `json:"facts"`
}

// State: the app as it stands.
func (r *Ravenpost) State() State {
	cfg := r.app.store.Get()
	snap := r.app.syncer.Snapshot()
	st := State{
		Version:            version,
		Language:           systemLanguage(),
		LaunchAtLogin:      cfg.LaunchAtLogin,
		Folders:            orEmpty(cfg.Folders),
		ExcludedAccounts:   orEmpty(cfg.ExcludedAccounts),
		ExcludedCharacters: orEmpty(cfg.ExcludedCharacters),
		Installs:           snap.Installs,
		Characters:         snap.Characters,
		Gone:               snap.Gone,
		LastSync:           snap.LastSync,
		Errors:             snap.Errors,
		Uploading:          snap.Uploading,
		LastUploaded:       snap.LastUploaded,
		Activity:           snap.Activity,
		Sharing:            snap.Sharing,
	}
	fl := cfg.LinkFor(Shared)
	st.Facts = SiteState{ID: Shared, Name: "The addons' database", Server: fl.Server, Linked: fl.Token != "", BattleTag: fl.BattleTag, Pairing: r.app.Pairing(Shared)}
	for _, svc := range services {
		l := cfg.LinkFor(svc.ID)
		st.Sites = append(st.Sites, SiteState{ID: svc.ID, Name: svc.Name, Addon: svc.Addon, Server: l.Server,
			Linked: l.Token != "", BattleTag: l.BattleTag, Pairing: r.app.Pairing(svc.ID)})
	}
	return st
}

// Link starts linking a site: a code, and its page opened in the browser.
func (r *Ravenpost) Link(site string) error { return r.app.StartPairing(site) }

// Unlink forgets a site's link (its server stays).
func (r *Ravenpost) Unlink(site string) error { return r.app.Unpair(site) }

// SyncNow reads every file again and sends them all.
func (r *Ravenpost) SyncNow() { r.app.syncer.SyncNow(true) }

// SetCharacterSent: is this character's file sent (true), or left out?
func (r *Ravenpost) SetCharacterSent(guid string, sent bool) error {
	list := toggled(r.app.store.Get().ExcludedCharacters, guid, !sent)
	return r.app.ApplySettings(SettingsUpdate{ExcludedCharacters: &list})
}

// SetAccountSent: are this game account's files sent (true), or left out?
func (r *Ravenpost) SetAccountSent(dir string, sent bool) error {
	list := toggled(r.app.store.Get().ExcludedAccounts, dir, !sent)
	return r.app.ApplySettings(SettingsUpdate{ExcludedAccounts: &list})
}

// ChooseFolder asks for a World of Warcraft folder (the system's picker) and
// adds it. Cancelled: nothing changes.
func (r *Ravenpost) ChooseFolder() error {
	if r.chooseFolder == nil {
		return errors.New("no folder picker here")
	}
	dir, err := r.chooseFolder()
	if err != nil || dir == "" {
		return err
	}
	return r.AddFolder(dir)
}

// AddFolder adds a World of Warcraft folder by its path.
func (r *Ravenpost) AddFolder(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil
	}
	folders := append(r.app.store.Get().Folders, path)
	return r.app.ApplySettings(SettingsUpdate{Folders: &folders})
}

// RemoveFolder removes a folder added by hand.
func (r *Ravenpost) RemoveFolder(path string) error {
	folders := toggled(r.app.store.Get().Folders, path, false)
	return r.app.ApplySettings(SettingsUpdate{Folders: &folders})
}

// SetLaunchAtLogin: Ravenpost starts with the session, quietly (no window).
func (r *Ravenpost) SetLaunchAtLogin(on bool) error {
	return r.app.ApplySettings(SettingsUpdate{LaunchAtLogin: &on})
}

// SetServer points a site at another server (which unlinks it).
func (r *Ravenpost) SetServer(site, server string) error {
	return r.app.ApplySettings(SettingsUpdate{Servers: map[string]string{site: server}})
}

// Open opens a web page in the browser (a site, the pairing page): http(s) only.
func (r *Ravenpost) Open(link string) error {
	u, err := url.Parse(link)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return fmt.Errorf("not a web address: %q", link)
	}
	return openURL(u.String())
}

// toggled: the list with v in it (on) or without it.
func toggled(list []string, v string, on bool) []string {
	out := []string{}
	for _, x := range list {
		if x != v {
			out = append(out, x)
		}
	}
	if on {
		out = append(out, v)
	}
	return out
}

func orEmpty(list []string) []string {
	if list == nil {
		return []string{}
	}
	return list
}

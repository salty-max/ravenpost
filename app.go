package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"
)

// App ties the config, the syncer and pairing together; the tray and the
// settings page both act through it.
type App struct {
	store  *Store
	syncer *Syncer

	mu      sync.Mutex
	pairing *Pairing
	cancel  context.CancelFunc

	// Signalled on any change the tray should reflect.
	changed chan struct{}
}

type Pairing struct {
	Code   string `json:"code"`
	URL    string `json:"url"`
	Status string `json:"status"` // waiting | paired | expired | failed
	Error  string `json:"error,omitempty"`
}

func NewApp(store *Store) *App {
	a := &App{store: store, syncer: NewSyncer(store), changed: make(chan struct{}, 1)}
	a.syncer.onChange = a.notify
	a.syncer.onUploaded = a.uploadedNotification
	return a
}

func (a *App) notify() {
	select {
	case a.changed <- struct{}{}:
	default:
	}
}

func (a *App) Pairing() *Pairing {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.pairing == nil {
		return nil
	}
	p := *a.pairing
	return &p
}

// StartPairing asks the server for a code, opens the browser on the page
// where the user logs in with Battle.net, and waits for the token.
func (a *App) StartPairing() error {
	cfg := a.store.Get()
	ctx, cancel := context.WithTimeout(context.Background(), 11*time.Minute)
	var start pairStart
	if err := call(ctx, "POST", cfg.Server, "/api/companion/pair/start", "", nil, &start); err != nil {
		cancel()
		return err
	}
	// The page must be on the server we pair with, whatever the server says.
	if !strings.HasPrefix(start.URL, cfg.Server+"/") {
		start.URL = cfg.Server + "/pair?code=" + start.Code
	}
	a.mu.Lock()
	if a.cancel != nil {
		a.cancel()
	}
	a.pairing = &Pairing{Code: start.Code, URL: start.URL, Status: "waiting"}
	a.cancel = cancel
	a.mu.Unlock()
	a.notify()
	_ = openURL(start.URL)

	go func() {
		defer cancel()
		for {
			select {
			case <-ctx.Done():
				a.finishPairing(start.Code, "expired", "")
				return
			case <-time.After(2 * time.Second):
			}
			var poll pairPoll
			err := call(ctx, "POST", cfg.Server, "/api/companion/pair/poll", "",
				map[string]string{"code": start.Code, "pollToken": start.PollToken}, &poll)
			if err != nil {
				if ctx.Err() == nil {
					log.Printf("pair poll: %v", err) // network hiccup: keep polling
				}
				continue
			}
			switch poll.Status {
			case "paired":
				_ = a.store.Update(func(c *Config) {
					c.Server, c.Token, c.BattleTag = cfg.Server, poll.Token, poll.BattleTag
				})
				log.Printf("paired as %s (%d characters)", poll.BattleTag, poll.Characters)
				a.finishPairing(start.Code, "paired", "")
				a.syncer.SyncNow(true)
				return
			case "expired":
				a.finishPairing(start.Code, "expired", "")
				return
			}
		}
	}()
	return nil
}

func (a *App) finishPairing(code, status, msg string) {
	a.mu.Lock()
	if a.pairing != nil && a.pairing.Code == code {
		a.pairing.Status, a.pairing.Error = status, msg
	}
	a.mu.Unlock()
	a.notify()
}

func (a *App) Unpair() error {
	err := a.store.Update(func(c *Config) { c.Token, c.BattleTag = "", "" })
	a.notify()
	return err
}

// SettingsUpdate is what the settings page can change.
type SettingsUpdate struct {
	Server             *string   `json:"server"`
	LaunchAtLogin      *bool     `json:"launchAtLogin"`
	Folders            *[]string `json:"folders"`
	ExcludedAccounts   *[]string `json:"excludedAccounts"`
	ExcludedCharacters *[]string `json:"excludedCharacters"`
	QuietUploads       *bool     `json:"quietUploads"`
}

func (a *App) ApplySettings(u SettingsUpdate) error {
	if u.Server != nil {
		server, err := normalizeServer(*u.Server)
		if err != nil {
			return err
		}
		u.Server = &server
	}
	if u.LaunchAtLogin != nil {
		if err := setLaunchAtLogin(*u.LaunchAtLogin); err != nil {
			return err
		}
	}
	err := a.store.Update(func(c *Config) {
		// The token belongs to the server it was issued by.
		if u.Server != nil && *u.Server != c.Server {
			c.Server, c.Token, c.BattleTag = *u.Server, "", ""
		}
		if u.LaunchAtLogin != nil {
			c.LaunchAtLogin = *u.LaunchAtLogin
		}
		if u.Folders != nil {
			c.Folders = clean(*u.Folders)
		}
		if u.ExcludedAccounts != nil {
			c.ExcludedAccounts = clean(*u.ExcludedAccounts)
		}
		if u.ExcludedCharacters != nil {
			c.ExcludedCharacters = clean(*u.ExcludedCharacters)
		}
		if u.QuietUploads != nil {
			c.QuietUploads = *u.QuietUploads
		}
	})
	if err != nil {
		return err
	}
	a.syncer.SyncNow(false) // the selection is part of each file's upload hash
	a.notify()
	return nil
}

func clean(list []string) []string {
	out := []string{}
	for _, v := range list {
		if v = strings.TrimSpace(v); v != "" && !contains(out, v) {
			out = append(out, v)
		}
	}
	return out
}

// After each upload: a system notification ("Sealinedion synced · +5 events"),
// unless turned off in the settings.
func (a *App) uploadedNotification(chars []UploadedCharacter) {
	if a.store.Get().QuietUploads {
		return
	}
	t := trayStrings()
	parts := make([]string, 0, len(chars))
	for _, c := range chars {
		if c.Events > 0 {
			parts = append(parts, fmt.Sprintf(t.syncedEvents, c.Name, c.Events))
		} else {
			parts = append(parts, fmt.Sprintf(t.synced, c.Name))
		}
	}
	if err := showNotification("WoWLocker", strings.Join(parts, "\n")); err != nil {
		log.Printf("notification: %v", err)
	}
}

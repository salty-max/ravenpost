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

	mu       sync.Mutex
	pairings map[string]*Pairing // by site
	cancels  map[string]context.CancelFunc

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
	a := &App{store: store, syncer: NewSyncer(store), changed: make(chan struct{}, 1),
		pairings: map[string]*Pairing{}, cancels: map[string]context.CancelFunc{}}
	a.syncer.onChange = a.notify
	return a
}

func (a *App) notify() {
	select {
	case a.changed <- struct{}{}:
	default:
	}
}

// Pairing: a site's pairing in progress (or just finished), or nil.
func (a *App) Pairing(service string) *Pairing {
	a.mu.Lock()
	defer a.mu.Unlock()
	p := a.pairings[service]
	if p == nil {
		return nil
	}
	c := *p
	return &c
}

// StartPairing asks the site for a code, opens the browser on the page where
// the user signs in and confirms, and waits for the token.
func (a *App) StartPairing(service string) error {
	if _, ok := serviceByID(service); !ok {
		return fmt.Errorf("unknown site %q", service)
	}
	link := a.store.Get().LinkFor(service)
	ctx, cancel := context.WithTimeout(context.Background(), 11*time.Minute)
	var start pairStart
	if err := call(ctx, "POST", link.Server, "/api/companion/pair/start", "", nil, &start); err != nil {
		cancel()
		return err
	}
	// The page must be on the site we pair with, whatever the site says.
	if !strings.HasPrefix(start.URL, link.Server+"/") {
		start.URL = link.Server + "/pair?code=" + start.Code
	}
	a.mu.Lock()
	if c := a.cancels[service]; c != nil {
		c()
	}
	a.pairings[service] = &Pairing{Code: start.Code, URL: start.URL, Status: "waiting"}
	a.cancels[service] = cancel
	a.mu.Unlock()
	a.notify()
	_ = openURL(start.URL)

	go func() {
		defer cancel()
		for {
			select {
			case <-ctx.Done():
				a.finishPairing(service, start.Code, "expired", "")
				return
			case <-time.After(2 * time.Second):
			}
			var poll pairPoll
			err := call(ctx, "POST", link.Server, "/api/companion/pair/poll", "",
				map[string]string{"code": start.Code, "pollToken": start.PollToken}, &poll)
			if err != nil {
				if ctx.Err() == nil {
					log.Printf("pair poll (%s): %v", service, err) // network hiccup: keep polling
				}
				continue
			}
			switch poll.Status {
			case "paired":
				_ = a.store.SetLink(service, Link{Server: link.Server, Token: poll.Token, BattleTag: poll.BattleTag})
				log.Printf("linked to %s as %s", service, poll.BattleTag)
				a.finishPairing(service, start.Code, "paired", "")
				a.syncer.SyncNow(true)
				return
			case "expired":
				a.finishPairing(service, start.Code, "expired", "")
				return
			}
		}
	}()
	return nil
}

func (a *App) finishPairing(service, code, status, msg string) {
	a.mu.Lock()
	if p := a.pairings[service]; p != nil && p.Code == code {
		p.Status, p.Error = status, msg
	}
	a.mu.Unlock()
	a.notify()
}

func (a *App) Unpair(service string) error {
	link := a.store.Get().LinkFor(service)
	err := a.store.SetLink(service, Link{Server: link.Server})
	a.notify()
	return err
}

// SettingsUpdate is what the settings page can change.
type SettingsUpdate struct {
	// A site's server, by site id (a new server unlinks that site).
	Servers            map[string]string `json:"servers"`
	LaunchAtLogin      *bool             `json:"launchAtLogin"`
	Folders            *[]string         `json:"folders"`
	ExcludedAccounts   *[]string         `json:"excludedAccounts"`
	ExcludedCharacters *[]string         `json:"excludedCharacters"`
}

func (a *App) ApplySettings(u SettingsUpdate) error {
	servers := map[string]string{}
	for id, raw := range u.Servers {
		if _, ok := serviceByID(id); !ok {
			return fmt.Errorf("unknown site %q", id)
		}
		server, err := normalizeServer(raw)
		if err != nil {
			return err
		}
		servers[id] = server
	}
	if u.LaunchAtLogin != nil {
		if err := setLaunchAtLogin(*u.LaunchAtLogin); err != nil {
			return err
		}
	}
	err := a.store.Update(func(c *Config) {
		// A token belongs to the server it was issued by.
		for id, server := range servers {
			if l := c.Links[id]; l == nil || l.Server != server {
				c.Links[id] = &Link{Server: server}
			}
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
	})
	if err != nil {
		return err
	}
	a.syncer.SyncNow(false) // the selection is part of each file's upload hash
	a.notify()
	return nil
}

// linkedAny: is at least one site linked?
func (a *App) linkedAny() bool {
	cfg := a.store.Get()
	for _, svc := range services {
		if cfg.LinkFor(svc.ID).Token != "" {
			return true
		}
	}
	return false
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

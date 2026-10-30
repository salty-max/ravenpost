package main

import (
	"cmp"
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"runtime"
	"time"
)

// Once a day, Ravenpost tells its inbox it's running, for the numbers
// (inbox/src/stats.ts): a random id made for this install (the inbox keeps
// only a hash of it), Ravenpost's version, the system, which links are made
// and how many addons share. Nothing about the player, their characters or
// their files.
//
// It looks every quarter of an hour whether today's went through (the
// inbox's day, UTC): a ping that failed, the network not up yet at login,
// goes again at the next look instead of a day later, and a computer asleep
// most of the day still counts each day it's awake (a 24-hour timer counts
// only the hours awake).
var (
	pingFirst = time.Minute // (the first look a minute after the start)
	pingLook  = 15 * time.Minute
)

func (a *App) pingDaily(ctx context.Context) {
	timer := time.NewTimer(pingFirst)
	defer timer.Stop()
	sent, told := "", "" // (the day the ping went through, the day a failure was logged)
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		if day := time.Now().UTC().Format(time.DateOnly); day != sent {
			if filed, err := a.ping(ctx); err == nil {
				// (the day the inbox filed it under, should this clock be off)
				sent = cmp.Or(filed, day)
				// (once a day too: the sharing token traded for a fresh one once it's a month old)
				a.refreshSharedToken(ctx)
			} else if told != day {
				log.Printf("ping: %v", err)
				told = day
			}
		}
		timer.Reset(pingLook)
	}
}

// installID: this install's random id, made once and kept in the config.
func (a *App) installID() string {
	if id := a.store.Get().InstallID; id != "" {
		return id
	}
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	id := hex.EncodeToString(b)
	_ = a.store.Update(func(c *Config) {
		if c.InstallID == "" {
			c.InstallID = id
		}
		id = c.InstallID
	})
	return id
}

// ping: the day the inbox filed it under (none from an inbox before it said).
func (a *App) ping(ctx context.Context) (string, error) {
	cfg := a.store.Get()
	linked := []string{}
	for _, id := range []string{WoWLocker, Hearthtale, Shared} {
		if cfg.LinkFor(id).Token != "" {
			linked = append(linked, id)
		}
	}
	body := map[string]any{
		"id":      a.installID(),
		"version": version,
		"os":      runtime.GOOS,
		"arch":    runtime.GOARCH,
		"linked":  linked,
		"sharing": len(a.syncer.Snapshot().Sharing),
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var res struct {
		Day string `json:"day"`
	}
	err := call(ctx, "POST", cfg.LinkFor(Shared).Server, "/api/ping", "", body, &res)
	return res.Day, err
}

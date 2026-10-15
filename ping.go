package main

import (
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
const pingEvery = 24 * time.Hour

func (a *App) pingDaily(ctx context.Context) {
	timer := time.NewTimer(time.Minute) // (the first a minute after the start)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		if err := a.ping(ctx); err != nil {
			log.Printf("ping: %v", err)
		}
		timer.Reset(pingEvery)
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

func (a *App) ping(ctx context.Context) error {
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
	return call(ctx, "POST", cfg.LinkFor(Shared).Server, "/api/ping", "", body, nil)
}

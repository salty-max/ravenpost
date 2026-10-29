package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Ravenpost doesn't update itself (its builds are unsigned: a file that
// replaced itself would be one more thing Smart App Control judges). It asks
// GitHub which release is the latest and tells the player, in the window and
// the menu, where to get it. releases/latest skips prereleases: a release
// that Windows blocks is flipped to a prerelease and the nudge stops.
var (
	releasesURL   = "https://api.github.com/repos/salty-max/ravenpost/releases/latest"
	updateFirst   = 2 * time.Minute
	updateEvery   = 6 * time.Hour
	releasesPage  = "https://github.com/salty-max/ravenpost/releases/latest"
	updateTimeout = 20 * time.Second
)

// Update: a release newer than this one.
type Update struct {
	Version string `json:"version"`
	URL     string `json:"url"`
}

// checkUpdates looks at start (a little later: the network may not be up yet
// at login) and every few hours; a failed look is silent, the next one tries again.
func (a *App) checkUpdates(ctx context.Context) {
	timer := time.NewTimer(updateFirst)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		if err := a.checkUpdate(ctx); err != nil {
			log.Printf("update check: %v", err)
		}
		timer.Reset(updateEvery)
	}
}

func (a *App) checkUpdate(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, updateTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", releasesURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Ravenpost/"+version)
	res, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("github answered %d", res.StatusCode)
	}
	var rel struct {
		Tag        string `json:"tag_name"`
		URL        string `json:"html_url"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
	}
	if err := json.NewDecoder(res.Body).Decode(&rel); err != nil {
		return err
	}
	var next *Update
	if !rel.Draft && !rel.Prerelease && newerVersion(rel.Tag, version) {
		// (the link only ever goes to this repository's releases)
		url := releasesPage
		if strings.HasPrefix(rel.URL, "https://github.com/salty-max/ravenpost/") {
			url = rel.URL
		}
		next = &Update{Version: strings.TrimPrefix(rel.Tag, "v"), URL: url}
	}
	a.latest.Store(next)
	a.notify()
	return nil
}

// Update: the newer release waiting, or nil.
func (a *App) Update() *Update { return a.latest.Load() }

// newerVersion: is tag ("v0.5.0") past current ("0.4.0", or "0.4.0-19-g358ec41")?
// Anything it can't read is not newer.
func newerVersion(tag, current string) bool {
	t, ok := versionParts(tag)
	c, ok2 := versionParts(current)
	if !ok || !ok2 {
		return false
	}
	for i := range t {
		if t[i] != c[i] {
			return t[i] > c[i]
		}
	}
	return false
}

func versionParts(v string) ([3]int, bool) {
	var out [3]int
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return out, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return out, false
		}
		out[i] = n
	}
	return out, true
}

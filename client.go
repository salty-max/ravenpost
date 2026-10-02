package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// The wow-locker API, as used by the companion (see apps/api/src/lib/companion.ts).

var httpClient = &http.Client{Timeout: 60 * time.Second}

var errUnauthorized = errors.New("the server no longer knows this companion: pair it again")

type pairStart struct {
	Code      string `json:"code"`
	PollToken string `json:"pollToken"`
	URL       string `json:"url"`
	ExpiresIn int    `json:"expiresIn"`
}

type pairPoll struct {
	Status     string `json:"status"` // pending | paired | expired
	Token      string `json:"token"`
	BattleTag  string `json:"battletag"`
	Characters int    `json:"characters"`
}

type uploadResult struct {
	Characters []struct {
		GUID        string `json:"guid"`
		Name        string `json:"name"`
		Status      string `json:"status"` // synced | unknown | invalid
		Events      int    `json:"events"`
		CharacterID int    `json:"characterId"`
	} `json:"characters"`
}

// normalizeServer checks a server address and returns its origin.
func normalizeServer(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return "", fmt.Errorf("not a server address: %q", raw)
	}
	// Plain http only for this machine (development).
	if u.Scheme == "http" && u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" {
		return "", errors.New("use an https:// address")
	}
	return u.Scheme + "://" + u.Host, nil
}

func call(ctx context.Context, method, server, path, token string, body any, out any) error {
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, server+path, r)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "wow-locker-companion/"+version)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode == http.StatusUnauthorized {
		return errUnauthorized
	}
	if res.StatusCode >= 300 {
		var e struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(data, &e) == nil && e.Error != "" {
			return fmt.Errorf("server: %s (%d)", e.Error, res.StatusCode)
		}
		return fmt.Errorf("server answered %d", res.StatusCode)
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

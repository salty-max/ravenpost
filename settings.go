package main

import (
	"crypto/subtle"
	_ "embed"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"time"
)

// The settings window is a page served on this machine only, opened in the
// browser: one UI for macOS and Windows without a GUI toolkit.
//
// Other web pages can reach 127.0.0.1 too, so every API call needs the
// secret key from the config (sent in a header, which a cross-site request
// can't set without a CORS preflight we never answer), and the Host header
// must be ours (DNS rebinding).

const settingsPort = 47615

//go:embed settings.html
var settingsHTML []byte

// The app icon (apps/web/public/icon.svg at 128 px) for the page's header.
//
//go:embed icon.png
var iconPNG []byte

func settingsURL(cfg Config) string {
	return fmt.Sprintf("http://127.0.0.1:%d/#k=%s", settingsPort, cfg.Key)
}

// listenSettings fails when another companion already holds the port.
func listenSettings() (net.Listener, error) {
	return net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", settingsPort))
}

func (a *App) serveSettings(l net.Listener) error {
	mux := http.NewServeMux()
	host := fmt.Sprintf("127.0.0.1:%d", settingsPort)

	guard := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Host != host {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			key := a.store.Get().Key
			if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Locker-Key")), []byte(key)) != 1 {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			h(w, r)
		}
	}
	reply := func(w http.ResponseWriter, err error) {
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		a.writeState(w)
	}

	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		if r.Host != host {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(settingsHTML)
	})
	mux.HandleFunc("GET /icon.png", func(w http.ResponseWriter, r *http.Request) {
		if r.Host != host {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "max-age=86400")
		_, _ = w.Write(iconPNG)
	})
	mux.HandleFunc("GET /api/state", guard(func(w http.ResponseWriter, r *http.Request) { a.writeState(w) }))
	mux.HandleFunc("POST /api/settings", guard(func(w http.ResponseWriter, r *http.Request) {
		var u SettingsUpdate
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&u); err != nil {
			reply(w, err)
			return
		}
		reply(w, a.ApplySettings(u))
	}))
	mux.HandleFunc("POST /api/pair", guard(func(w http.ResponseWriter, r *http.Request) { reply(w, a.StartPairing()) }))
	mux.HandleFunc("POST /api/unpair", guard(func(w http.ResponseWriter, r *http.Request) { reply(w, a.Unpair()) }))
	mux.HandleFunc("POST /api/sync", guard(func(w http.ResponseWriter, r *http.Request) {
		a.syncer.SyncNow(true)
		time.Sleep(300 * time.Millisecond) // let a quick upload land before answering
		reply(w, nil)
	}))
	mux.HandleFunc("POST /api/browse", guard(func(w http.ResponseWriter, r *http.Request) {
		dir, err := pickFolder()
		if err != nil || dir == "" {
			reply(w, err)
			return
		}
		folders := append(a.store.Get().Folders, dir)
		reply(w, a.ApplySettings(SettingsUpdate{Folders: &folders}))
	}))

	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	return srv.Serve(l)
}

type stateView struct {
	Version            string   `json:"version"`
	Server             string   `json:"server"`
	Paired             bool     `json:"paired"`
	BattleTag          string   `json:"battletag"`
	Pairing            *Pairing `json:"pairing"`
	LaunchAtLogin      bool     `json:"launchAtLogin"`
	Folders            []string `json:"folders"`
	ExcludedAccounts   []string `json:"excludedAccounts"`
	ExcludedCharacters []string `json:"excludedCharacters"`
	Snapshot
}

func (a *App) writeState(w http.ResponseWriter) {
	cfg := a.store.Get()
	v := stateView{
		Version:            version,
		Server:             cfg.Server,
		Paired:             cfg.Token != "",
		BattleTag:          cfg.BattleTag,
		Pairing:            a.Pairing(),
		LaunchAtLogin:      cfg.LaunchAtLogin,
		Folders:            cfg.Folders,
		ExcludedAccounts:   cfg.ExcludedAccounts,
		ExcludedCharacters: cfg.ExcludedCharacters,
		Snapshot:           a.syncer.Snapshot(),
	}
	if v.Folders == nil {
		v.Folders = []string{}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

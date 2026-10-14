package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"math/big"
	"net"
	"net/http"
	"strings"
	"time"
)

// Signing in to the addons' database (the inbox, inbox/)
// with Battle.net, the way desktop apps do: Ravenpost listens on this
// computer, opens the browser on the inbox's /api/login, Battle.net signs the
// player in, and the inbox sends the browser back here with a token
// (http://127.0.0.1:<port>/linked?token=&nonce=). The inbox keeps nothing:
// the token is signed, and names the account by a hash and its BattleTag.

const loginWait = 10 * time.Minute

// startSharedLogin: the browser on the inbox's sign-in, the token awaited here.
func (a *App) startSharedLogin() error {
	link := a.store.Get().LinkFor(Shared)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	port := ln.Addr().(*net.TCPAddr).Port
	nonce := randomWord(32)
	page := fmt.Sprintf("%s/api/login?port=%d&nonce=%s", link.Server, port, nonce)

	ctx, cancel := context.WithTimeout(context.Background(), loginWait)
	a.mu.Lock()
	if c := a.cancels[Shared]; c != nil {
		c()
	}
	a.pairings[Shared] = &Pairing{Code: nonce, URL: page, Status: "waiting"}
	a.cancels[Shared] = cancel
	a.mu.Unlock()
	a.notify()

	done := make(chan struct{}, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/linked", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("nonce") != nonce {
			http.Error(w, "not this sign-in", http.StatusBadRequest)
			return
		}
		t := loginStrings()
		token := q.Get("token")
		tag, ok := tokenTag(token)
		if !ok {
			writePage(w, t.failedTitle, t.failedText)
			a.finishPairing(Shared, nonce, "failed", q.Get("error"))
		} else {
			_ = a.store.SetLink(Shared, Link{Server: link.Server, Token: token, BattleTag: tag})
			log.Printf("sharing with the addons' database as %s", tag)
			a.syncer.record(Activity{Kind: "linked", Service: Shared, Name: tag})
			writePage(w, t.linkedTitle, t.linkedText)
			a.finishPairing(Shared, nonce, "paired", "")
			a.syncer.SyncNow(false)
		}
		select {
		case done <- struct{}{}:
		default:
		}
	})
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = srv.Serve(ln) }()
	go func() {
		defer cancel()
		select {
		case <-done:
		case <-ctx.Done():
			a.finishPairing(Shared, nonce, "expired", "")
		}
		// (the answer's page is written before the server closes)
		time.Sleep(time.Second)
		_ = srv.Close()
	}()
	return openURL(page)
}

// tokenTag: the BattleTag a token names (its signature is the inbox's to check).
func tokenTag(token string) (string, bool) {
	body, _, ok := strings.Cut(token, ".")
	if !ok || body == "" {
		return "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return "", false
	}
	var p struct {
		Sub string `json:"sub"`
		Tag string `json:"tag"`
	}
	if json.Unmarshal(raw, &p) != nil || p.Sub == "" {
		return "", false
	}
	return p.Tag, true
}

func randomWord(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, n)
	for i := range b {
		k, _ := rand.Int(rand.Reader, big.NewInt(int64(len(letters))))
		b[i] = letters[k.Int64()]
	}
	return string(b)
}

type loginText struct{ linkedTitle, linkedText, failedTitle, failedText string }

// The browser's page after signing in, in the system's language.
func loginStrings() loginText {
	if strings.HasPrefix(systemLanguage(), "fr") {
		return loginText{
			"Lié à Ravenpost", "Merci ! Ce que vous voyez aidera les addons à suivre Forever. Vous pouvez fermer cet onglet.",
			"La connexion n'a pas abouti", "Retournez dans Ravenpost et cliquez à nouveau sur « Lier avec Battle.net ».",
		}
	}
	return loginText{
		"Linked to Ravenpost", "Thank you! What you see will help the addons keep up with Forever. You can close this tab.",
		"The sign-in didn't go through", "Go back to Ravenpost and click Link with Battle.net again.",
	}
}

func writePage(w http.ResponseWriter, title, text string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!doctype html><meta charset="utf-8"><title>%[1]s</title><body style="font:16px system-ui;background:#16130f;color:#e8dcc2;display:grid;place-items:center;height:90vh"><div><h1 style="font-size:20px;color:#d4a843">%[1]s</h1><p>%[2]s</p></div>`,
		html.EscapeString(title), html.EscapeString(text))
}

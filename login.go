package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
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

// Signing in with Battle.net, once for everything, through Ravenpost's inbox
// (inbox/), the way desktop apps do: Ravenpost listens on this computer, opens
// the browser on the inbox's /api/login, Battle.net signs the player in, and
// the inbox sends the browser back here
// (http://127.0.0.1:<port>/linked?code=&passport=&nonce=) with a code of two
// minutes bound to a secret this sign-in keeps (PKCE's way), traded at once
// over https with it for the sharing token (the addons'
// database: signed, the account as a hash and its BattleTag, 90 days, traded
// for a fresh one once a month: refreshSharedToken) so the browser's history
// keeps no token (an inbox before the trade sends the token itself,
// still taken), and a passport, handed at once to each site that takes one
// (Hearthtale's /api/companion/signin) for its own upload token. The inbox
// keeps nothing.

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
	// (the code comes back bound to this verifier's hash: only this Ravenpost can trade it)
	verifier := randomWord(48)
	sum := sha256.Sum256([]byte(verifier))
	page := fmt.Sprintf("%s/api/login?port=%d&nonce=%s&v=2&challenge=%s", link.Server, port, nonce, base64.RawURLEncoding.EncodeToString(sum[:]))

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
		if code := q.Get("code"); code != "" {
			token = a.tradeCode(r.Context(), link.Server, code, verifier)
		}
		tag, ok := tokenTag(token)
		if !ok {
			writePage(w, t.failedTitle, t.failedText)
			a.finishPairing(Shared, nonce, "failed", q.Get("error"))
		} else {
			_ = a.store.SetLink(Shared, Link{Server: link.Server, Token: token, BattleTag: tag})
			log.Printf("signed in as %s", tag)
			a.syncer.record(Activity{Kind: "linked", Service: Shared, Name: tag})
			if passport := q.Get("passport"); passport != "" {
				a.signInSites(passport)
			}
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

// The sites that take the inbox's passport for their own upload token.
var passportSites = []string{Hearthtale}

// signInSites: the passport to each site that takes one, its upload token kept.
func (a *App) signInSites(passport string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	for _, site := range passportSites {
		link := a.store.Get().LinkFor(site)
		var res struct {
			Token     string `json:"token"`
			BattleTag string `json:"battletag"`
		}
		err := call(ctx, "POST", link.Server, "/api/companion/signin", "", map[string]string{"passport": passport}, &res)
		if err == nil && res.Token == "" {
			err = fmt.Errorf("no token")
		}
		if err != nil {
			log.Printf("sign-in (%s): %v", site, err)
			a.syncer.record(Activity{Kind: "failed", Service: site, Name: link.BattleTag, Detail: err.Error()})
			continue
		}
		_ = a.store.SetLink(site, Link{Server: link.Server, Token: res.Token, BattleTag: res.BattleTag})
		a.syncer.record(Activity{Kind: "linked", Service: site, Name: res.BattleTag})
	}
	a.refreshWoWLocker(ctx, passport)
}

// refreshWoWLocker: the passport renews the character list WoWLocker trusts
// (it keeps its own device-code link, so no new token): a character made since
// the last login on the site syncs at the next upload. A refusal never drops
// the link, it only says so in the journal.
func (a *App) refreshWoWLocker(ctx context.Context, passport string) {
	link := a.store.Get().LinkFor(WoWLocker)
	if link.Token == "" {
		return
	}
	err := call(ctx, "POST", link.Server, "/api/companion/refresh", link.Token, map[string]string{"passport": passport}, nil)
	if err != nil {
		log.Printf("sign-in (%s): %v", WoWLocker, err)
		a.syncer.record(Activity{Kind: "failed", Service: WoWLocker, Name: link.BattleTag, Detail: err.Error()})
	}
}

// tradeCode: the sign-in's code for the sharing token, over https; none on a refusal.
func (a *App) tradeCode(ctx context.Context, server, code, verifier string) string {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var res struct {
		Token string `json:"token"`
	}
	if err := call(ctx, "POST", server, "/api/login/exchange", "", map[string]string{"code": code, "verifier": verifier}, &res); err != nil {
		log.Printf("sign-in: %v", err)
		return ""
	}
	return res.Token
}

// How old a sharing token gets before it's traded for a fresh one (the inbox's end at 90 days).
const tokenRefreshAge = 30 * 24 * time.Hour

// refreshSharedToken: a sharing token a month old traded for a fresh one, quietly.
// A refusal leaves it as it is: an inbox before the trade, a network down (the
// next day tries again), or a token no longer good (the next upload's 401 says so).
func (a *App) refreshSharedToken(ctx context.Context) {
	link := a.store.Get().LinkFor(Shared)
	c, ok := tokenClaims(link.Token)
	if !ok || c.Iat == 0 || time.Since(time.Unix(c.Iat, 0)) < tokenRefreshAge {
		return
	}
	var res struct {
		Token string `json:"token"`
	}
	if err := call(ctx, "POST", link.Server, "/api/token/refresh", link.Token, nil, &res); err != nil {
		log.Printf("token refresh: %v", err)
		return
	}
	if _, ok := tokenClaims(res.Token); !ok {
		return
	}
	_ = a.store.Update(func(cfg *Config) {
		// (unless it changed meanwhile: signed out, or in again)
		if l := cfg.Links[Shared]; l != nil && l.Token == link.Token {
			l.Token = res.Token
		}
	})
}

type tokenPayload struct {
	Sub string `json:"sub"`
	Tag string `json:"tag"`
	Iat int64  `json:"iat"`
}

// tokenClaims: what a token says (its signature is the inbox's to check).
func tokenClaims(token string) (tokenPayload, bool) {
	var p tokenPayload
	body, _, ok := strings.Cut(token, ".")
	if !ok || body == "" {
		return p, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil || json.Unmarshal(raw, &p) != nil || p.Sub == "" {
		return p, false
	}
	return p, true
}

// tokenTag: the BattleTag a token names.
func tokenTag(token string) (string, bool) {
	p, ok := tokenClaims(token)
	return p.Tag, ok
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
			"Connecté à Ravenpost", "C'est fait : Ravenpost porte vos journaux et ce que vous partagez. Vous pouvez fermer cet onglet.",
			"La connexion n'a pas abouti", "Retournez dans Ravenpost et cliquez à nouveau sur « Se connecter avec Battle.net ».",
		}
	}
	return loginText{
		"Signed in to Ravenpost", "All set: Ravenpost carries your journals and what you share. You can close this tab.",
		"The sign-in didn't go through", "Go back to Ravenpost and click Sign in with Battle.net again.",
	}
}

func writePage(w http.ResponseWriter, title, text string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!doctype html><meta charset="utf-8"><title>%[1]s</title><body style="font:16px system-ui;background:#16130f;color:#e8dcc2;display:grid;place-items:center;height:90vh"><div><h1 style="font-size:20px;color:#d4a843">%[1]s</h1><p>%[2]s</p></div>`,
		html.EscapeString(title), html.EscapeString(text))
}

package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The one sign-in, as the browser goes through it: the inbox sends it back to
// Ravenpost on this computer with the sharing token and a passport (Battle.net
// skipped), which Hearthtale takes for its own upload token.
func TestOneSignInLinksEverything(t *testing.T) {
	r := testApp(t)
	inbox := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		q := req.URL.Query()
		if req.URL.Path != "/api/login" || q.Get("port") == "" || len(q.Get("nonce")) < 16 {
			http.Error(w, "no", http.StatusBadRequest)
			return
		}
		http.Redirect(w, req, "http://127.0.0.1:"+q.Get("port")+"/linked?token="+sharedToken+"&passport=signed.passport&nonce="+q.Get("nonce"), http.StatusFound)
	}))
	defer inbox.Close()
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(req.Body).Decode(&body)
		if req.URL.Path != "/api/companion/signin" || body["passport"] != "signed.passport" {
			http.Error(w, `{"error":"not a passport"}`, http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"token": "ht-token", "battletag": "Max#1234"})
	}))
	defer site.Close()
	_ = r.app.store.SetLink(Shared, Link{Server: inbox.URL})
	_ = r.app.store.SetLink(Hearthtale, Link{Server: site.URL})

	if err := r.Link(Shared); err != nil {
		t.Fatal(err)
	}
	p := r.app.Pairing(Shared)
	if p == nil || p.Status != "waiting" || !strings.HasPrefix(p.URL, inbox.URL+"/api/login?port=") {
		t.Fatalf("pairing: %+v", p)
	}
	// Another page knocking on Ravenpost's door: refused.
	port := strings.Split(strings.Split(p.URL, "port=")[1], "&")[0]
	if res, err := http.Get("http://127.0.0.1:" + port + "/linked?token=" + sharedToken + "&nonce=wrong"); err != nil || res.StatusCode != http.StatusBadRequest {
		t.Fatalf("a wrong nonce: %v %v", res, err)
	}
	// The browser.
	res, err := http.Get(p.URL)
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("the browser: %v %v", res, err)
	}
	l := r.app.store.Get().LinkFor(Shared)
	if l.Token != sharedToken || l.BattleTag != "Max#1234" || r.app.Pairing(Shared).Status != "paired" {
		t.Fatalf("link %+v, pairing %+v", l, r.app.Pairing(Shared))
	}
	if a := r.app.store.Get().Activity; len(a) != 2 || a[0].Service != Hearthtale || a[1].Kind != "linked" || a[1].Service != Shared {
		t.Fatalf("activity: %+v", a)
	}
	if st := r.State(); !st.Facts.Linked || st.Facts.BattleTag != "Max#1234" {
		t.Fatalf("the window: %+v", st.Facts)
	}
	if h := r.app.store.Get().LinkFor(Hearthtale); h.Token != "ht-token" || h.BattleTag != "Max#1234" {
		t.Fatalf("Hearthtale not linked by the same sign-in: %+v", h)
	}
	_ = r.Unlink(Shared)
	if r.app.store.Get().LinkFor(Shared).Token != "" {
		t.Fatal("still linked")
	}
}

func TestATokensBattleTag(t *testing.T) {
	if tag, ok := tokenTag(sharedToken); !ok || tag != "Max#1234" {
		t.Fatalf("tag %q %v", tag, ok)
	}
	if _, ok := tokenTag("garbage"); ok {
		t.Fatal("a token without its payload")
	}
}

// The sign-in's passport also renews WoWLocker's list of the account's
// characters, with the link's own token. A refusal is a line in the journal
// and never takes the link away.
func TestSignInRefreshesWoWLocker(t *testing.T) {
	r := testApp(t)
	var got []string
	status := http.StatusOK
	wl := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(req.Body).Decode(&body)
		got = append(got, req.URL.Path+" "+req.Header.Get("Authorization")+" "+body["passport"])
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"characters":1}`))
	}))
	defer wl.Close()
	ht := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"token": "ht-token", "battletag": "Max#1234"})
	}))
	defer ht.Close()
	_ = r.app.store.SetLink(Hearthtale, Link{Server: ht.URL})

	r.app.signInSites("signed.passport") // (WoWLocker not linked: nothing is called)
	if len(got) != 0 {
		t.Fatalf("called without a link: %v", got)
	}

	_ = r.app.store.SetLink(WoWLocker, Link{Server: wl.URL, Token: "wl-token", BattleTag: "Max#1234"})
	before := len(r.app.store.Get().Activity)
	r.app.signInSites("signed.passport")
	if len(got) != 1 || got[0] != "/api/companion/refresh Bearer wl-token signed.passport" {
		t.Fatalf("calls: %v", got)
	}
	if n := len(r.app.store.Get().Activity); n != before+1 { // (Hearthtale's "linked" only)
		t.Fatalf("a success says nothing: %+v", r.app.store.Get().Activity)
	}

	status = http.StatusUnauthorized
	r.app.signInSites("signed.passport")
	l := r.app.store.Get().LinkFor(WoWLocker)
	a := r.app.store.Get().Activity
	if l.Token != "wl-token" || a[0].Kind != "failed" || a[0].Service != WoWLocker {
		t.Fatalf("link %+v, activity %+v", l, a)
	}
}

// An inbox that hands back a code (0.6 on): the token never rides in the
// address, Ravenpost trades the code for it over https.
func TestTheSignInTradesACodeForItsToken(t *testing.T) {
	r := testApp(t)
	var traded, challenge string
	inbox := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		q := req.URL.Query()
		switch req.URL.Path {
		case "/api/login":
			if q.Get("v") != "2" || len(q.Get("challenge")) != 43 {
				http.Error(w, "an old Ravenpost", http.StatusBadRequest)
				return
			}
			challenge = q.Get("challenge")
			http.Redirect(w, req, "http://127.0.0.1:"+q.Get("port")+"/linked?code=c0de&nonce="+q.Get("nonce"), http.StatusFound)
		case "/api/login/exchange":
			var body map[string]string
			_ = json.NewDecoder(req.Body).Decode(&body)
			traded = body["code"]
			sum := sha256.Sum256([]byte(body["verifier"]))
			if req.Method != http.MethodPost || traded != "c0de" || base64.RawURLEncoding.EncodeToString(sum[:]) != challenge {
				http.Error(w, `{"error":"this sign-in has expired"}`, http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"token": sharedToken})
		default:
			http.NotFound(w, req)
		}
	}))
	defer inbox.Close()
	_ = r.app.store.SetLink(Shared, Link{Server: inbox.URL})
	if err := r.Link(Shared); err != nil {
		t.Fatal(err)
	}
	if res, err := http.Get(r.app.Pairing(Shared).URL); err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("the browser: %v %v", res, err)
	}
	if l := r.app.store.Get().LinkFor(Shared); traded != "c0de" || l.Token != sharedToken || l.BattleTag != "Max#1234" {
		t.Fatalf("traded %q, link %+v", traded, l)
	}
	if p := r.app.Pairing(Shared); p.Status != "paired" {
		t.Fatalf("pairing %+v", p)
	}
}

// A sharing token a month old is traded for a fresh one, quietly; a young
// one, or an inbox that doesn't know the trade yet, leaves it as it is.
func TestAMonthOldTokenIsRefreshed(t *testing.T) {
	token := func(age time.Duration) string {
		body, _ := json.Marshal(map[string]any{"sub": "abc123", "tag": "Max#1234", "iat": time.Now().Add(-age).Unix()})
		return base64.RawURLEncoding.EncodeToString(body) + ".c2lnbmVk"
	}
	fresh := token(0)
	for _, c := range []struct {
		name   string
		has    string
		answer int
		want   string
	}{
		{"a month old", token(31 * 24 * time.Hour), http.StatusOK, fresh},
		{"a week old", token(7 * 24 * time.Hour), http.StatusOK, ""},
		{"an older inbox", token(31 * 24 * time.Hour), http.StatusNotFound, ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			r := testApp(t)
			asked := false
			inbox := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				asked = true
				if req.URL.Path != "/api/token/refresh" || req.Header.Get("Authorization") != "Bearer "+c.has || c.answer != http.StatusOK {
					http.Error(w, `{"error":"no"}`, http.StatusNotFound)
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]string{"token": fresh})
			}))
			defer inbox.Close()
			_ = r.app.store.SetLink(Shared, Link{Server: inbox.URL, Token: c.has, BattleTag: "Max#1234"})
			r.app.refreshSharedToken(context.Background())
			want := c.want
			if want == "" {
				want = c.has
			}
			if got := r.app.store.Get().LinkFor(Shared).Token; got != want {
				t.Fatalf("token %q, want %q", got, want)
			}
			if c.name == "a week old" && asked {
				t.Fatal("asked for a young token")
			}
		})
	}
}

package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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

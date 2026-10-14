package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The inbox's sign-in, as the browser goes through it: the inbox sends it
// back to Ravenpost on this computer with a token (Battle.net skipped).
func TestLinksTheAddonsDatabaseThroughTheBrowser(t *testing.T) {
	r := testApp(t)
	inbox := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		q := req.URL.Query()
		if req.URL.Path != "/api/login" || q.Get("port") == "" || len(q.Get("nonce")) < 16 {
			http.Error(w, "no", http.StatusBadRequest)
			return
		}
		http.Redirect(w, req, "http://127.0.0.1:"+q.Get("port")+"/linked?token="+sharedToken+"&nonce="+q.Get("nonce"), http.StatusFound)
	}))
	defer inbox.Close()
	_ = r.app.store.SetLink(Shared, Link{Server: inbox.URL})

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
	if a := r.app.store.Get().Activity; len(a) == 0 || a[0].Kind != "linked" || a[0].Service != Shared {
		t.Fatalf("activity: %+v", a)
	}
	if st := r.State(); !st.Facts.Linked || st.Facts.BattleTag != "Max#1234" {
		t.Fatalf("the window: %+v", st.Facts)
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

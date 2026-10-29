package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewerVersion(t *testing.T) {
	for _, c := range []struct {
		tag, cur string
		want     bool
	}{
		{"v0.5.0", "0.4.0", true},
		{"v0.4.0", "0.4.0", false},
		{"v0.4.0", "0.4.0-19-g358ec41", false},
		{"v0.4.1", "0.4.0-19-g358ec41", true},
		{"v0.10.0", "0.9.9", true},
		{"v0.3.9", "0.4.0", false},
		{"nightly", "0.4.0", false},
		{"v1.0.0", "dev", false},
	} {
		if got := newerVersion(c.tag, c.cur); got != c.want {
			t.Errorf("newerVersion(%q, %q) = %v", c.tag, c.cur, got)
		}
	}
}

func TestCheckUpdate(t *testing.T) {
	body := `{"tag_name":"v9.0.0","html_url":"https://github.com/salty-max/ravenpost/releases/tag/v9.0.0","draft":false,"prerelease":false}`
	code := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(code)
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()
	old := releasesURL
	releasesURL = srv.URL
	defer func() { releasesURL = old }()
	a := testApp(t).app

	if err := a.checkUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if u := a.Update(); u == nil || u.Version != "9.0.0" || u.URL != "https://github.com/salty-max/ravenpost/releases/tag/v9.0.0" {
		t.Fatalf("update = %+v", u)
	}
	// A release turned into a prerelease takes the nudge away.
	body = `{"tag_name":"v9.0.0","html_url":"https://evil.example/x","prerelease":true}`
	if err := a.checkUpdate(context.Background()); err != nil || a.Update() != nil {
		t.Fatalf("a prerelease nudged: %v %+v", err, a.Update())
	}
	// A foreign link is never followed.
	body = `{"tag_name":"v9.0.0","html_url":"https://evil.example/x"}`
	_ = a.checkUpdate(context.Background())
	if u := a.Update(); u == nil || u.URL != releasesPage {
		t.Fatalf("foreign link: %+v", u)
	}
	// A failed look leaves what was known.
	code = http.StatusForbidden
	if err := a.checkUpdate(context.Background()); err == nil || a.Update() == nil {
		t.Fatal("a failed look should error and keep the nudge")
	}
}

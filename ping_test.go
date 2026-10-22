package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sync"
	"testing"
	"time"
)

func TestTheDailyPingSaysNothingOfThePlayer(t *testing.T) {
	r := testApp(t)
	var got map[string]any
	inbox := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/api/ping" || req.Header.Get("Authorization") != "" {
			http.Error(w, "no", http.StatusNotFound)
			return
		}
		_ = json.NewDecoder(req.Body).Decode(&got)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer inbox.Close()
	_ = r.app.store.SetLink(Shared, Link{Server: inbox.URL, Token: sharedToken, BattleTag: "Max#1234"})
	_ = r.app.store.SetLink(Hearthtale, Link{Server: "http://h", Token: "tok", BattleTag: "Max#1234"})
	if err := r.app.ping(context.Background()); err != nil {
		t.Fatal(err)
	}
	id, _ := got["id"].(string)
	if !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(id) || id != r.app.store.Get().InstallID {
		t.Fatalf("id %q", id)
	}
	if got["version"] != version || got["os"] == "" {
		t.Fatalf("ping: %+v", got)
	}
	linked, _ := got["linked"].([]any)
	if len(linked) != 2 || linked[0] != "hearthtale" || linked[1] != "shared" {
		t.Fatalf("linked: %+v", linked)
	}
	for k := range got {
		switch k {
		case "id", "version", "os", "arch", "linked", "sharing":
		default:
			t.Fatalf("the ping says more than it should: %q", k)
		}
	}
	// The same install, the same id, ping after ping.
	first := id
	_ = r.app.ping(context.Background())
	if got["id"] != first {
		t.Fatal("a new id each ping")
	}
}

func TestAFailedPingGoesAgainAtTheNextLookThenOnceADay(t *testing.T) {
	r := testApp(t)
	var mu sync.Mutex
	calls := 0
	inbox := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		if calls == 1 { // (the network not up yet at login)
			http.Error(w, `{"error":"down"}`, http.StatusBadGateway)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer inbox.Close()
	_ = r.app.store.SetLink(Shared, Link{Server: inbox.URL})
	first, look := pingFirst, pingLook
	pingFirst, pingLook = time.Millisecond, 5*time.Millisecond
	defer func() { pingFirst, pingLook = first, look }()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { r.app.pingDaily(ctx); close(done) }()
	time.Sleep(200 * time.Millisecond) // (forty looks)
	cancel()
	<-done
	mu.Lock()
	defer mu.Unlock()
	if calls != 2 {
		t.Fatalf("%d pings: want the failed one, then one that went through, then none that day", calls)
	}
}

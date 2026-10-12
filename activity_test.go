package main

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"
)

func TestTheJournalTellsWhatEachUploadBrought(t *testing.T) {
	root, character := fakeWoW(t)
	site := &fakeSite{status: "saved"}
	srv := site.server(t)
	defer srv.Close()
	s := syncerFor(t, srv.URL, root)

	s.process(context.Background(), character)
	got := s.Snapshot().Activity
	if len(got) != 1 || got[0].Kind != "sent" || got[0].Service != Hearthtale || got[0].Name != "Brannok" || got[0].Detail != "saved" || got[0].Chapters != 1 {
		t.Fatalf("activity: %+v", got)
	}

	// The site refuses the next one (no link code yet): told as such, the latest first.
	site.status = "unlinked"
	_ = s.store.Update(func(c *Config) { c.Uploaded = map[string]string{} })
	s.files[character].modTime = s.files[character].modTime.Add(-1)
	s.process(context.Background(), character)
	got = s.Snapshot().Activity
	if len(got) != 2 || got[0].Kind != "refused" || got[0].Detail != "unlinked" || got[1].Kind != "sent" {
		t.Fatalf("activity: %+v", got)
	}

	// Kept in the config: the window shows it after a restart.
	if again := s.store.Get().Activity; len(again) != 2 {
		t.Fatalf("not kept: %+v", again)
	}
}

func TestAFailureRetriedIsOneLineThatMoves(t *testing.T) {
	root, character := fakeWoW(t)
	site := &fakeSite{status: "saved", httpCode: http.StatusBadGateway}
	srv := site.server(t)
	defer srv.Close()
	s := syncerFor(t, srv.URL, root)

	s.process(context.Background(), character)
	first := s.Snapshot().Activity
	if len(first) != 1 || first[0].Kind != "failed" || first[0].Name != "MAX" {
		t.Fatalf("activity: %+v", first)
	}
	time.Sleep(5 * time.Millisecond)
	s.files[character].nextTry = time.Time{}
	s.process(context.Background(), character)
	again := s.Snapshot().Activity
	if len(again) != 1 || !again[0].At.After(first[0].At) {
		t.Fatalf("the same failure should only move: %+v", again)
	}
}

func TestTheJournalKeepsTheLatest(t *testing.T) {
	t.Setenv("RAVENPOST_CONFIG_DIR", t.TempDir())
	t.Setenv("RAVENPOST_LEGACY_DIR", t.TempDir())
	store, err := LoadStore()
	if err != nil {
		t.Fatal(err)
	}
	s := NewSyncer(store)
	for i := range keepActivity + 5 {
		s.record(Activity{Kind: "sent", Service: Hearthtale, Name: fmt.Sprint(i)})
	}
	got := store.Get().Activity
	if len(got) != keepActivity || got[0].Name != fmt.Sprint(keepActivity+4) {
		t.Fatalf("%d kept, the latest %q", len(got), got[0].Name)
	}
}

func TestSentOrRefused(t *testing.T) {
	for status, kind := range map[string]string{"saved": "sent", "synced": "sent", "unlinked": "refused", "removed": "refused", "unknown": "refused", "invalid": "refused"} {
		if a := sentOrRefused(Hearthtale, "Brannok", status, 0, 2); a.Kind != kind || a.Detail != status {
			t.Errorf("%s: %+v", status, a)
		}
	}
}

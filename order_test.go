package main

import (
	"testing"
	"time"
)

// The list puts the last played first, whatever the site or the level.
func TestCharactersByLastPlayed(t *testing.T) {
	t.Setenv("RAVENPOST_CONFIG_DIR", t.TempDir())
	t.Setenv("RAVENPOST_LEGACY_DIR", t.TempDir())
	store, err := LoadStore()
	if err != nil {
		t.Fatal(err)
	}
	s := NewSyncer(store)
	now := time.Now()
	s.characters["a"] = &Character{Service: WoWLocker, GUID: "a", Name: "Namzie", Level: 22, LastSeen: now.Add(-48 * time.Hour)}
	s.characters["b"] = &Character{Service: Hearthtale, GUID: "b", Name: "Hellefie", Level: 2, LastSeen: now.Add(-time.Hour)}
	s.characters["c"] = &Character{Service: WoWLocker, GUID: "c", Name: "Broucouille", Level: 18, LastSeen: now.Add(-3 * time.Hour)}
	var got []string
	for _, c := range s.Snapshot().Characters {
		got = append(got, c.Name)
	}
	want := []string{"Hellefie", "Broucouille", "Namzie"}
	for i := range want {
		if i >= len(got) || got[i] != want[i] {
			t.Fatalf("order %v, want %v", got, want)
		}
	}
}

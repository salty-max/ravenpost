package main

import "testing"

func TestUploadedSummary(t *testing.T) {
	got := uploadedSummary(trayEN, []UploadedCharacter{{Name: "Sealinedion", Events: 5}, {Name: "Namzie"}})
	if want := "Sealinedion synced · +5 events, Namzie synced"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

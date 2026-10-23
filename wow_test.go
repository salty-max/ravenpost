package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Forever's folders (the live client's _forever_, its beta's _classic_beta_)
// show the game's name, not the bare folder name.
func TestLabelsForeversFolders(t *testing.T) {
	root := t.TempDir()
	for _, flavour := range []string{"_forever_", "_classic_beta_"} {
		if err := os.MkdirAll(filepath.Join(root, flavour, "WTF", "Account", "MAX"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	labels := map[string]string{}
	for _, in := range Discover([]string{root}) {
		labels[in.Flavour] = in.Label
	}
	if labels["_forever_"] != "World of Warcraft: Forever" || labels["_classic_beta_"] != "World of Warcraft: Forever (beta)" {
		t.Fatalf("labels: %v", labels)
	}
}

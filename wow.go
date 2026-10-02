package main

import (
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// A game client folder (_classic_era_, _anniversary_, …) and its accounts.
type Install struct {
	Path     string    `json:"path"`
	Flavour  string    `json:"flavour"` // the folder name
	Label    string    `json:"label"`
	Accounts []Account `json:"accounts"`
}

type Account struct {
	Name string `json:"name"`
	Dir  string `json:"dir"`
	// The addon's SavedVariables (absent until the addon has run once).
	File    string `json:"file"`
	HasFile bool   `json:"hasFile"`
}

var flavourLabels = map[string]string{
	"_classic_era_":     "Classic Era · Hardcore · Season",
	"_anniversary_":     "Anniversary",
	"_classic_":         "Classic (progression)",
	"_retail_":          "Retail",
	"_classic_era_ptr_": "Classic Era PTR",
	"_classic_ptr_":     "Classic PTR",
}

// The usual install locations, plus where the Battle.net launcher says it put
// the game (Windows).
func defaultRoots() []string {
	switch runtime.GOOS {
	case "darwin":
		home, _ := os.UserHomeDir()
		return []string{
			"/Applications/World of Warcraft",
			"/Applications/Games/World of Warcraft",
			filepath.Join(home, "Applications", "World of Warcraft"),
		}
	case "windows":
		var roots []string
		for _, d := range "CDEFGH" {
			drive := string(d) + `:\`
			roots = append(roots,
				drive+`Program Files (x86)\World of Warcraft`,
				drive+`Program Files\World of Warcraft`,
				drive+`World of Warcraft`,
				drive+`Games\World of Warcraft`,
				drive+`Battle.net\World of Warcraft`,
			)
		}
		return append(registryRoots(), roots...)
	}
	return nil
}

// Discover finds every client folder under the given roots. A root may be the
// "World of Warcraft" folder or a client folder inside it.
func Discover(roots []string) []Install {
	seen := map[string]bool{}
	var out []Install
	add := func(dir string) {
		if abs, err := filepath.Abs(dir); err == nil {
			dir = abs
		}
		if seen[strings.ToLower(dir)] || !isDir(filepath.Join(dir, "WTF", "Account")) {
			return
		}
		seen[strings.ToLower(dir)] = true
		name := filepath.Base(dir)
		label := flavourLabels[name]
		if label == "" {
			label = strings.Trim(name, "_")
		}
		out = append(out, Install{Path: dir, Flavour: name, Label: label, Accounts: accounts(dir)})
	}
	for _, root := range roots {
		root = strings.TrimSpace(root)
		if root == "" || !isDir(root) {
			continue
		}
		add(root)
		entries, _ := os.ReadDir(root)
		for _, e := range entries {
			if e.IsDir() && strings.HasPrefix(e.Name(), "_") {
				add(filepath.Join(root, e.Name()))
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

func accounts(install string) []Account {
	base := filepath.Join(install, "WTF", "Account")
	entries, _ := os.ReadDir(base)
	var out []Account
	for _, e := range entries {
		if !e.IsDir() || e.Name() == "SavedVariables" {
			continue
		}
		dir := filepath.Join(base, e.Name())
		file := filepath.Join(dir, "SavedVariables", "WowLocker.lua")
		_, err := os.Stat(file)
		out = append(out, Account{Name: e.Name(), Dir: dir, File: file, HasFile: err == nil})
	}
	return out
}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

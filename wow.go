package main

import (
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// A game client folder (_classic_era_, _anniversary_, Forever's…) and its accounts.
type Install struct {
	Path     string    `json:"path"`
	Flavour  string    `json:"flavour"` // the folder name
	Label    string    `json:"label"`
	Accounts []Account `json:"accounts"`
}

type Account struct {
	Name string `json:"name"`
	Dir  string `json:"dir"`
	// Each site's saved files under it (none until its addon has run once):
	// WoWLocker's one file, Hearthtale's one per character.
	Files map[string][]string `json:"files"`
}

// HasFiles: has this site's addon run on this account yet?
func (a Account) HasFiles(id string) bool { return len(a.Files[id]) > 0 }

var flavourLabels = map[string]string{
	"_classic_era_":     "Classic Era · Hardcore · Season",
	"_anniversary_":     "Anniversary",
	"_classic_":         "Classic (progression)",
	"_retail_":          "Retail",
	"_classic_era_ptr_": "Classic Era PTR",
	"_classic_ptr_":     "Classic PTR",
	"_classic_beta_":    "World of Warcraft: Forever (beta)",
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
		out = append(out, Account{Name: e.Name(), Dir: dir, Files: savedFiles(dir)})
	}
	return out
}

// savedFiles: the sites' saved files under an account folder.
func savedFiles(dir string) map[string][]string {
	files := map[string][]string{}
	if f := filepath.Join(dir, "SavedVariables", "WowLocker.lua"); isFile(f) {
		files[WoWLocker] = []string{f}
	}
	// <account>/<realm>/<character>/SavedVariables/Hearthtale.lua
	if found, _ := filepath.Glob(filepath.Join(dir, "*", "*", "SavedVariables", "Hearthtale.lua")); len(found) > 0 {
		sort.Strings(found)
		files[Hearthtale] = found
	}
	return files
}

func isFile(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

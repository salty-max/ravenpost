package main

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// The family's addons, as their folders sit in Interface/AddOns. The window's
// Addons page says which of them each game folder holds (installed: a folder
// on disk is no proof the game loads it, AddOns.txt is not read) and whether
// one has ever written its saved file there.
var familyAddons = []struct{ Folder, Name string }{
	{"Hearthtale", "Hearthtale"},
	{"LorekeepersCodex", "Lorekeeper's Codex"},
	{"Yonder", "Yonder"},
	{"SecondWind", "Second Wind"},
	{"Keyring", "Keyring"},
	{"Palaver", "Palaver"},
	{"Mealbook", "Mealbook"},
	{"Goodwill", "Goodwill"},
	{"YoursTruly", "Yours Truly"},
	{"WowLocker", "WoWLocker"},
}

// InstalledAddon: one of the family's addons found in a game folder.
type InstalledAddon struct {
	Folder  string `json:"folder"`
	Name    string `json:"name"`
	Version string `json:"version"` // the TOC's ## Version, "" when unreadable
	// Has the addon written its saved file under any account here?
	Data bool `json:"data"`
}

// tocSuffix: the TOC each client loads (package-lib.ts in addon-kit): Classic
// Era's, TBC Anniversary's, and Forever's and its beta's _Camelot.
func tocSuffix(flavour string) string {
	switch {
	case strings.HasPrefix(flavour, "_classic_era"):
		return "_Vanilla"
	case flavour == "_anniversary_":
		return "_TBC"
	case flavour == "_forever_" || flavour == "_classic_beta_":
		return "_Camelot"
	}
	return ""
}

// installedAddons lists the family's addons under a game folder, in the
// family's order. Yonder's FieldJournal handover folder is not listed: it
// is Yonder's, and in Forever a FieldJournal folder is another addon's.
func installedAddons(install string, flavour string) []InstalledAddon {
	base := filepath.Join(install, "Interface", "AddOns")
	out := []InstalledAddon{}
	for _, a := range familyAddons {
		dir := filepath.Join(base, a.Folder)
		if !isDir(dir) {
			continue
		}
		suffix := tocSuffix(flavour)
		if suffix != "" && !loadsHere(dir, a.Folder, suffix) {
			continue // (TOCs for other clients only: this one never loads it)
		}
		out = append(out, InstalledAddon{
			Folder:  a.Folder,
			Name:    a.Name,
			Version: tocVersion(dir, a.Folder, suffix),
			Data:    hasSavedFile(install, a.Folder),
		})
	}
	return out
}

// tocVersion reads "## Version:" from the TOC the client loads, else from
// any TOC of the addon (a client of a kind we don't know).
func tocVersion(dir, folder, suffix string) string {
	names := []string{folder + suffix + ".toc", folder + ".toc"}
	if all, _ := filepath.Glob(filepath.Join(dir, folder+"*.toc")); suffix == "" && len(all) > 0 {
		for _, p := range all {
			names = append(names, filepath.Base(p))
		}
	}
	for _, n := range names {
		if v := readVersion(filepath.Join(dir, n)); v != "" {
			return v
		}
	}
	return ""
}

// loadsHere: false when the addon's folder holds TOCs, none of them for the
// client's suffix (a folder with no TOC at all stays listed, version unknown).
func loadsHere(dir, folder, suffix string) bool {
	all, _ := filepath.Glob(filepath.Join(dir, folder+"*.toc"))
	if len(all) == 0 {
		return true
	}
	for _, n := range []string{folder + suffix + ".toc", folder + ".toc"} {
		if _, err := os.Stat(filepath.Join(dir, n)); err == nil {
			return true
		}
	}
	return false
}

func readVersion(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for n := 0; sc.Scan() && n < 60; n++ {
		line := strings.TrimPrefix(strings.TrimSpace(sc.Text()), "\ufeff")
		if rest, ok := strings.CutPrefix(line, "##"); ok {
			if k, v, ok := strings.Cut(rest, ":"); ok && strings.EqualFold(strings.TrimSpace(k), "Version") {
				return strings.TrimSpace(v)
			}
		}
	}
	return ""
}

// hasSavedFile: <install>/WTF/Account/*/SavedVariables/<Folder>.lua, or a
// character's, <account>/<realm>/<character>/SavedVariables/<Folder>.lua.
func hasSavedFile(install, folder string) bool {
	acct := filepath.Join(install, "WTF", "Account", "*")
	for _, pat := range []string{
		filepath.Join(acct, "SavedVariables", folder+".lua"),
		filepath.Join(acct, "*", "*", "SavedVariables", folder+".lua"),
	} {
		if found, _ := filepath.Glob(pat); len(found) > 0 {
			return true
		}
	}
	return false
}

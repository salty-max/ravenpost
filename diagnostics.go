package main

import (
	"fmt"
	"os"
	"regexp"
	"runtime"
	"strings"
)

var underAccount = regexp.MustCompile(`WTF[/\\]+Account[/\\]+.*?(\.lua|$)`)

// diagnostics: a text a player can paste into an issue. It names no player:
// no character, no account folder, no token, no journal line (they name
// characters); the home folder is "~" (on Windows it holds the user's name).
func (r *Ravenpost) diagnostics() string {
	cfg := r.app.store.Get()
	snap := r.app.syncer.Snapshot()
	home, _ := os.UserHomeDir()
	hide := func(s string) string {
		if home != "" {
			s = strings.ReplaceAll(s, home, "~")
		}
		// (an account, realm and character are names: nothing past WTF/Account)
		return underAccount.ReplaceAllString(s, "WTF/Account/…")
	}
	yesno := func(b bool) string {
		if b {
			return "yes"
		}
		return "no"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Ravenpost %s (%s/%s), language %s\n", version, runtime.GOOS, runtime.GOARCH, systemLanguage())
	if u := r.app.Update(); u != nil {
		fmt.Fprintf(&b, "Newer release known: %s\n", u.Version)
	}
	fmt.Fprintf(&b, "Open at login: %s\n", yesno(cfg.LaunchAtLogin))
	fmt.Fprintf(&b, "Linked: Battle.net %s", yesno(cfg.LinkFor(Shared).Token != ""))
	for _, svc := range services {
		fmt.Fprintf(&b, ", %s %s", svc.Name, yesno(cfg.LinkFor(svc.ID).Token != ""))
	}
	b.WriteString("\n")
	fmt.Fprintf(&b, "Sharing: %d addon file(s) with the opt-in on\n", len(snap.Sharing))
	if !snap.LastSync.IsZero() {
		fmt.Fprintf(&b, "Last upload: %s\n", snap.LastSync.UTC().Format("2006-01-02 15:04 UTC"))
	}
	fmt.Fprintf(&b, "Folders added by hand: %d\n", len(cfg.Folders))
	if len(snap.Installs) == 0 {
		b.WriteString("\nNo game folder found.\n")
	}
	for _, in := range snap.Installs {
		fmt.Fprintf(&b, "\n%s (%s)\n  %s\n  accounts: %d, left out: %d\n", in.Label, in.Flavour, hide(in.Path), len(in.Accounts), excludedIn(in, cfg.ExcludedAccounts))
		if len(in.Addons) == 0 {
			b.WriteString("  no addon of the family\n")
		}
		for _, a := range in.Addons {
			v := a.Version
			if v == "" {
				v = "version unknown"
			}
			fmt.Fprintf(&b, "  %s %s, file saved: %s\n", a.Name, v, yesno(a.Data))
		}
	}
	var errs []string
	for _, e := range snap.Errors {
		// ("<account folder>: <error>": the account is a name)
		if _, rest, ok := strings.Cut(e, ": "); ok {
			e = rest
		}
		errs = append(errs, hide(e))
	}
	for _, a := range snap.Activity {
		if len(errs) >= 8 {
			break
		}
		if (a.Kind == "failed" || a.Kind == "refused") && a.Detail != "" {
			errs = append(errs, fmt.Sprintf("%s %s: %s", a.Service, a.Kind, hide(a.Detail)))
		}
	}
	if len(errs) > 0 {
		b.WriteString("\nLately:\n")
		for _, e := range errs {
			fmt.Fprintf(&b, "  %s\n", e)
		}
	}
	return b.String()
}

func excludedIn(in Install, excluded []string) int {
	off := map[string]bool{}
	for _, d := range excluded {
		off[d] = true
	}
	n := 0
	for _, a := range in.Accounts {
		if off[a.Dir] {
			n++
		}
	}
	return n
}

// Diagnostics: a text for an issue (what Ravenpost found, what it couldn't
// do), with nothing of the player in it.
func (r *Ravenpost) Diagnostics() string { return r.diagnostics() }

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// A mailbox carries data into the game. The game reads an addon's files at
// login and on /reload, and writes only SavedVariables (which it would
// overwrite at logout), so Ravenpost writes a small addon of its own beside the
// addon it serves: <Host>_Mailbox, its one Lua file setting one global. It is
// never published, so no addon manager tracks it nor "repairs" it back to an
// empty file (the trap TSM's AppHelper falls into). Its TOCs copy the host's,
// interface line and all, so the game never takes it for out of date; the
// host lists it under OptionalDeps, so it loads first.
type Mailbox struct {
	Host   string // the addon it serves: Interface/AddOns/<Host>
	Global string // the Lua global its file sets
}

func (m Mailbox) Name() string { return m.Host + "_Mailbox" }

const mailboxFile = "Mailbox.lua"

var tocInterface = regexp.MustCompile(`(?m)^##\s*Interface:\s*([0-9, ]+)\s*$`)

// Write puts the data in the install's mailbox, making the mailbox if need be.
// Nothing when the host addon isn't installed there (written = false).
func (m Mailbox) Write(install Install, data any) (written bool, err error) {
	addons := filepath.Join(install.Path, "Interface", "AddOns")
	host := filepath.Join(addons, m.Host)
	tocs, _ := filepath.Glob(filepath.Join(host, m.Host+"*.toc"))
	if len(tocs) == 0 {
		return false, nil
	}
	dir := filepath.Join(addons, m.Name())
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return false, err
	}
	// One TOC of the mailbox's per TOC of the host's (Host_Vanilla.toc gives
	// Host_Mailbox_Vanilla.toc), with the host's interface.
	for _, toc := range tocs {
		raw, err := os.ReadFile(toc)
		if err != nil {
			return false, err
		}
		match := tocInterface.FindSubmatch(raw)
		if match == nil {
			continue
		}
		suffix := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(toc), m.Host), ".toc")
		body := fmt.Sprintf(
			"## Interface: %s\n## Title: %s mailbox\n## Notes: Written by Ravenpost: what it carries into the game for %s. Not an addon to install or update.\n## Author: Ravenpost\n## Version: %s\n%s\n",
			strings.TrimSpace(string(match[1])), m.Host, m.Host, version, mailboxFile,
		)
		if err := writeAtomic(filepath.Join(dir, m.Name()+suffix+".toc"), []byte(body)); err != nil {
			return false, err
		}
	}
	lua, err := WriteLua(map[string]any{m.Global: data})
	if err != nil {
		return false, err
	}
	head := fmt.Sprintf("-- Written by Ravenpost %s on %s. Rewritten at each sync: don't edit.\n", version, time.Now().UTC().Format(time.RFC3339))
	return true, writeAtomic(filepath.Join(dir, mailboxFile), []byte(head+lua))
}

// writeAtomic: the whole file or none of it, never half (the game may read it
// at any moment: a /reload mid-write). A temporary file beside it, renamed.
func writeAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	// (a temporary file is the owner's alone: an addon's files are everyone's to read)
	if err := os.Chmod(name, 0o644); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Rename(name, path); err != nil {
		os.Remove(name)
		return err
	}
	return nil
}

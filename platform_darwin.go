package main

import (
	"errors"
	"fmt"
	"html"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const agentLabel = "app.wow-locker.companion"

func agentPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents", agentLabel+".plist"), nil
}

// A LaunchAgent: started by launchd at login, nothing to approve.
func setLaunchAtLogin(on bool) error {
	path, err := agentPath()
	if err != nil {
		return err
	}
	if !on {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	// Opened straight from the download, macOS runs the app from a random
	// read-only copy that is gone after a reboot.
	if strings.Contains(exe, "/AppTranslocation/") {
		return errors.New("move WoWLocker to the Applications folder first, then open it from there")
	}
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>%s</string>
	<key>ProgramArguments</key><array><string>%s</string></array>
	<key>RunAtLoad</key><true/>
	<key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`, agentLabel, html.EscapeString(exe))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(plist), 0o644)
}

func registryRoots() []string { return nil }

// A Notification Center banner. Title and body go in as arguments, never as
// script text, so nothing in them can break out of the AppleScript.
func showNotification(title, body string) error {
	return exec.Command("osascript",
		"-e", "on run argv",
		"-e", "display notification (item 2 of argv) with title (item 1 of argv)",
		"-e", "end run",
		title, body).Run()
}

func openURL(url string) error {
	if os.Getenv("WOWLOCKER_NO_BROWSER") != "" {
		log.Printf("open %s", url)
		return nil
	}
	return exec.Command("open", url).Start()
}

func pickFolder() (string, error) {
	out, err := exec.Command("osascript", "-e",
		`POSIX path of (choose folder with prompt "World of Warcraft folder")`).Output()
	if err != nil {
		return "", nil // cancelled
	}
	return strings.TrimRight(strings.TrimSpace(string(out)), "/"), nil
}

func systemLanguage() string {
	out, _ := exec.Command("defaults", "read", "-g", "AppleLocale").Output()
	return strings.TrimSpace(string(out))
}

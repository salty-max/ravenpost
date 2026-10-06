//go:build !darwin && !windows

package main

import (
	"errors"
	"log"
	"os"
	"os/exec"
)

// Linux and others: enough to build and test; the game runs on macOS and Windows.

func setLaunchAtLogin(bool) error { return errors.New("launch at login isn't supported here") }
func removeLegacyLaunch() bool    { return false }
func registryRoots() []string     { return nil }
func openURL(url string) error {
	if os.Getenv("RAVENPOST_NO_BROWSER") != "" {
		log.Printf("open %s", url)
		return nil
	}
	return exec.Command("xdg-open", url).Start()
}
func pickFolder() (string, error) { return "", errors.New("no folder picker here") }
func systemLanguage() string      { return os.Getenv("LANG") }

// Ravenpost: a menu-bar (macOS) / tray (Windows) app that carries World of
// Warcraft addons' saved files to their sites whenever the game writes them
// (logout, /reload, disconnect): WoWLocker's to wow-locker.app, Hearthtale's
// to hearthtale.app (services.go). Formerly the WoWLocker companion.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

var version = "0.2.1"

func main() {
	headless := flag.Bool("headless", false, "no tray icon: sync until interrupted (settings page still served)")
	once := flag.Bool("once", false, "upload what changed, then exit")
	showVersion := flag.Bool("version", false, "print the version")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}

	store, err := LoadStore()
	if err != nil {
		log.Fatal(err)
	}
	setupLog()
	app := NewApp(store)

	if *once {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		app.syncer.tick(ctx)
		snap := app.syncer.Snapshot()
		for _, c := range snap.Characters {
			fmt.Printf("%-10s %-12s %3d  %-8s %s · %s\n", c.Service, c.Name, c.Level, c.Status, c.Install, c.Account)
		}
		for _, e := range snap.Errors {
			fmt.Println("error:", e)
		}
		return
	}

	l, err := listenSettings()
	if err != nil {
		// Already running: show that instance's settings instead.
		_ = openURL(settingsURL(store.Get()))
		return
	}
	go func() {
		if err := app.serveSettings(l); err != nil {
			log.Printf("settings server: %v", err)
		}
	}()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go app.syncer.Run(ctx)
	log.Printf("Ravenpost %s started", version)

	// Nothing linked yet (first run): open the settings page to get started.
	if !app.linkedAny() {
		_ = openURL(settingsURL(store.Get()))
	}

	if *headless {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		return
	}
	app.runTray(cancel)
}

// Logs go to <config dir>/ravenpost/ravenpost.log (and stderr), kept small.
func setupLog() {
	dir, err := configDir()
	if err != nil {
		return
	}
	path := filepath.Join(dir, "ravenpost.log")
	if st, err := os.Stat(path); err == nil && st.Size() > 1<<20 {
		_ = os.Rename(path, path+".old")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return
	}
	log.SetOutput(io.MultiWriter(os.Stderr, f))
}

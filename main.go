// Ravenpost: a desktop app (a window, and an icon in the macOS menu bar or the
// Windows tray) that carries World of Warcraft addons' saved files to their
// sites whenever the game writes them (logout, /reload, disconnect):
// WoWLocker's to wow-locker.app, Hearthtale's to hearthtale.app (services.go).
// Formerly the WoWLocker companion.
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

var version = "0.3.0"

func main() {
	headless := flag.Bool("headless", false, "no window nor icon: sync until interrupted")
	background := flag.Bool("background", false, "started at login: the window waits for a click on the icon")
	once := flag.Bool("once", false, "upload what changed, then exit")
	showVersion := flag.Bool("version", false, "print the version")
	mailboxSpike := flag.Bool("mailbox-spike", false, "a test: write RavenpostSpike_Mailbox in every game folder, again every 10 s, until interrupted (spike.go)")
	spikeNotes := flag.Int("spike-notes", 0, "with -mailbox-spike: that many made-up notes in the mailbox")
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

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if *mailboxSpike {
		log.Printf("Ravenpost %s: the mailbox spike (Ctrl-C to stop)", version)
		go runMailboxSpike(ctx, store, *spikeNotes)
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		return
	}

	if *headless {
		go app.syncer.Run(ctx)
		log.Printf("Ravenpost %s started (headless)", version)
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		return
	}

	// The login item, written again at each start: it follows the app where it
	// was moved, and asks a login start to stay quiet (-background).
	if store.Get().LaunchAtLogin {
		if err := setLaunchAtLogin(true); err != nil {
			log.Printf("launch at login: %v", err)
		}
	}
	if err := app.runDesktop(ctx, *background, cancel); err != nil {
		log.Fatal(err)
	}
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

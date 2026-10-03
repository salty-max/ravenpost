package main

import (
	"fmt"
	"runtime"
	"strings"
	"time"

	"fyne.io/systray"
)

type trayText struct {
	notLinked, linked, link, lastUpload, never, syncNow, settings, open, quit, waiting string
}

var trayEN = trayText{
	notLinked: "Not linked to Battle.net", linked: "Linked to %s", link: "Link with Battle.net…",
	lastUpload: "Last upload: %s", never: "no upload yet", syncNow: "Sync now", settings: "Settings…",
	open: "Open WoWLocker", quit: "Quit", waiting: "Waiting for the Battle.net login…",
}

var trayFR = trayText{
	notLinked: "Pas lié à Battle.net", linked: "Lié à %s", link: "Lier avec Battle.net…",
	lastUpload: "Dernier envoi : %s", never: "aucun envoi", syncNow: "Synchroniser", settings: "Réglages…",
	open: "Ouvrir WoWLocker", quit: "Quitter", waiting: "En attente de la connexion Battle.net…",
}

func (a *App) runTray(quit func()) {
	t := trayEN
	if strings.HasPrefix(strings.ToLower(systemLanguage()), "fr") {
		t = trayFR
	}
	setIcon := func(linked bool) {
		if runtime.GOOS == "darwin" {
			systray.SetTemplateIcon(chestIcon(true, !linked), chestIcon(true, !linked))
		} else {
			systray.SetIcon(pngToICO(chestIcon(false, !linked)))
		}
	}

	systray.Run(func() {
		setIcon(a.store.Get().Token != "")
		systray.SetTooltip("WoWLocker")

		status := systray.AddMenuItem("", "")
		status.Disable()
		last := systray.AddMenuItem("", "")
		last.Disable()
		systray.AddSeparator()
		link := systray.AddMenuItem(t.link, "")
		syncNow := systray.AddMenuItem(t.syncNow, "")
		settings := systray.AddMenuItem(t.settings, "")
		open := systray.AddMenuItem(t.open, "")
		systray.AddSeparator()
		quitItem := systray.AddMenuItem(t.quit, "")

		refresh := func() {
			cfg := a.store.Get()
			linked := cfg.Token != ""
			setIcon(linked)
			switch p := a.Pairing(); {
			case p != nil && p.Status == "waiting":
				status.SetTitle(t.waiting)
			case linked:
				status.SetTitle(fmt.Sprintf(t.linked, cfg.BattleTag))
			default:
				status.SetTitle(t.notLinked)
			}
			if linked {
				link.Hide()
				syncNow.Enable()
			} else {
				link.Show()
				syncNow.Disable()
			}
			snap := a.syncer.Snapshot()
			when := t.never
			if !snap.LastSync.IsZero() {
				when = snap.LastSync.Local().Format("15:04")
				if time.Since(snap.LastSync) > 20*time.Hour {
					when = snap.LastSync.Local().Format("02/01 15:04")
				}
			}
			last.SetTitle(fmt.Sprintf(t.lastUpload, when))
		}
		refresh()

		go func() {
			tick := time.NewTicker(30 * time.Second) // keeps "last upload" honest
			defer tick.Stop()
			for {
				select {
				case <-a.changed:
					refresh()
				case <-tick.C:
					refresh()
				case <-link.ClickedCh:
					if err := a.StartPairing(); err != nil {
						_ = openURL(settingsURL(a.store.Get())) // the page shows what went wrong
					}
				case <-syncNow.ClickedCh:
					a.syncer.SyncNow(true)
				case <-settings.ClickedCh:
					_ = openURL(settingsURL(a.store.Get()))
				case <-open.ClickedCh:
					_ = openURL(a.store.Get().Server)
				case <-quitItem.ClickedCh:
					systray.Quit()
					return
				}
			}
		}()
	}, quit)
}

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
	uploading, synced, syncedEvents                                                    string
}

func trayStrings() trayText {
	if strings.HasPrefix(strings.ToLower(systemLanguage()), "fr") {
		return trayFR
	}
	return trayEN
}

var trayEN = trayText{
	notLinked: "Not linked to Battle.net", linked: "Linked to %s", link: "Link with Battle.net…",
	lastUpload: "Last upload: %s", never: "no upload yet", syncNow: "Sync now", settings: "Settings…",
	open: "Open WoWLocker", quit: "Quit", waiting: "Waiting for the Battle.net login…",
	uploading: "Uploading %s…", synced: "%s synced", syncedEvents: "%s synced · +%d events",
}

var trayFR = trayText{
	notLinked: "Pas lié à Battle.net", linked: "Lié à %s", link: "Lier avec Battle.net…",
	lastUpload: "Dernier envoi : %s", never: "aucun envoi", syncNow: "Synchroniser", settings: "Réglages…",
	open: "Ouvrir WoWLocker", quit: "Quitter", waiting: "En attente de la connexion Battle.net…",
	uploading: "Envoi de %s…", synced: "%s synchronisé", syncedEvents: "%s synchronisé · +%d événements",
}

func (a *App) runTray(quit func()) {
	t := trayStrings()
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
			// The upload in progress, then for a minute what it brought.
			if len(snap.Uploading) > 0 && linked {
				status.SetTitle(fmt.Sprintf(t.uploading, strings.Join(snap.Uploading, ", ")))
			} else if linked && len(snap.LastUploaded) > 0 && time.Since(snap.LastSync) < time.Minute {
				status.SetTitle("✓ " + uploadedSummary(t, snap.LastUploaded))
			}
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
			tick := time.NewTicker(15 * time.Second) // keeps "last upload" honest, ends the ✓ line
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

// "Sealinedion synced · +5 events, Namzie synced"
func uploadedSummary(t trayText, chars []UploadedCharacter) string {
	parts := make([]string, 0, len(chars))
	for _, c := range chars {
		if c.Events > 0 {
			parts = append(parts, fmt.Sprintf(t.syncedEvents, c.Name, c.Events))
		} else {
			parts = append(parts, fmt.Sprintf(t.synced, c.Name))
		}
	}
	return strings.Join(parts, ", ")
}

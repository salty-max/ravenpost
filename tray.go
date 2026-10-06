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
	notLinked: "%s: not linked", linked: "%s: linked to %s", link: "Link %s…",
	lastUpload: "Last upload: %s", never: "no upload yet", syncNow: "Sync now", settings: "Settings…",
	open: "Open %s", quit: "Quit", waiting: "%s: waiting for you in the browser…",
	uploading: "Uploading %s…", synced: "%s synced", syncedEvents: "%s synced · +%d events",
}

var trayFR = trayText{
	notLinked: "%s : pas lié", linked: "%s : lié à %s", link: "Lier %s…",
	lastUpload: "Dernier envoi : %s", never: "aucun envoi", syncNow: "Synchroniser", settings: "Réglages…",
	open: "Ouvrir %s", quit: "Quitter", waiting: "%s : en attente dans le navigateur…",
	uploading: "Envoi de %s…", synced: "%s synchronisé", syncedEvents: "%s synchronisé · +%d événements",
}

// One site's lines in the menu.
type siteItems struct {
	svc        Service
	info, link *systray.MenuItem
	open       *systray.MenuItem
}

func (a *App) runTray(quit func()) {
	t := trayStrings()
	setIcon := func(linked bool) {
		if runtime.GOOS == "darwin" {
			systray.SetTemplateIcon(envelopeIcon(true, !linked), envelopeIcon(true, !linked))
		} else {
			systray.SetIcon(pngToICO(envelopeIcon(false, !linked)))
		}
	}

	systray.Run(func() {
		setIcon(a.linkedAny())
		systray.SetTooltip("Ravenpost")

		status := systray.AddMenuItem("", "")
		status.Disable()
		last := systray.AddMenuItem("", "")
		last.Disable()
		systray.AddSeparator()
		var sites []*siteItems
		for _, svc := range services {
			it := &siteItems{svc: svc, info: systray.AddMenuItem("", "")}
			it.info.Disable()
			it.link = systray.AddMenuItem(fmt.Sprintf(t.link, svc.Name), "")
			sites = append(sites, it)
		}
		systray.AddSeparator()
		syncNow := systray.AddMenuItem(t.syncNow, "")
		settings := systray.AddMenuItem(t.settings, "")
		for _, it := range sites {
			it.open = systray.AddMenuItem(fmt.Sprintf(t.open, it.svc.Name), "")
		}
		systray.AddSeparator()
		quitItem := systray.AddMenuItem(t.quit, "")

		refresh := func() {
			cfg := a.store.Get()
			linked := a.linkedAny()
			setIcon(linked)
			for _, it := range sites {
				l := cfg.LinkFor(it.svc.ID)
				switch p := a.Pairing(it.svc.ID); {
				case p != nil && p.Status == "waiting":
					it.info.SetTitle(fmt.Sprintf(t.waiting, it.svc.Name))
				case l.Token != "":
					it.info.SetTitle(fmt.Sprintf(t.linked, it.svc.Name, l.BattleTag))
				default:
					it.info.SetTitle(fmt.Sprintf(t.notLinked, it.svc.Name))
				}
				if l.Token != "" {
					it.link.Hide()
				} else {
					it.link.Show()
				}
			}
			if linked {
				syncNow.Enable()
			} else {
				syncNow.Disable()
			}
			snap := a.syncer.Snapshot()
			status.SetTitle("Ravenpost")
			// The upload in progress, then for a minute what it brought.
			if len(snap.Uploading) > 0 {
				status.SetTitle(fmt.Sprintf(t.uploading, strings.Join(snap.Uploading, ", ")))
			} else if len(snap.LastUploaded) > 0 && time.Since(snap.LastSync) < time.Minute {
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

		// One goroutine per site's two items (systray's channels can't be selected in a loop).
		for _, it := range sites {
			go func(it *siteItems) {
				for {
					select {
					case <-it.link.ClickedCh:
						if err := a.StartPairing(it.svc.ID); err != nil {
							_ = openURL(settingsURL(a.store.Get())) // the page shows what went wrong
						}
					case <-it.open.ClickedCh:
						_ = openURL(a.store.Get().LinkFor(it.svc.ID).Server)
					}
				}
			}(it)
		}
		go func() {
			tick := time.NewTicker(15 * time.Second) // keeps "last upload" honest, ends the ✓ line
			defer tick.Stop()
			for {
				select {
				case <-a.changed:
					refresh()
				case <-tick.C:
					refresh()
				case <-syncNow.ClickedCh:
					a.syncer.SyncNow(true)
				case <-settings.ClickedCh:
					_ = openURL(settingsURL(a.store.Get()))
				case <-quitItem.ClickedCh:
					systray.Quit()
					return
				}
			}
		}()
	}, quit)
}

// "Sealinedion synced · +5 events, Brannok synced"
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

package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// The menu-bar (macOS) / tray (Windows) icon's menu: how things stand, the
// window, a sync, Quit. Linking a site and the rest live in the window.

type trayText struct {
	lastUpload, never, syncNow, openApp, quit, chooseFolder string
	uploading, synced, syncedEvents                         string
}

func trayStrings() trayText {
	if strings.HasPrefix(strings.ToLower(systemLanguage()), "fr") {
		return trayFR
	}
	return trayEN
}

var trayEN = trayText{
	lastUpload: "Last upload: %s", never: "no upload yet", syncNow: "Sync now", openApp: "Open Ravenpost",
	quit: "Quit Ravenpost", chooseFolder: "World of Warcraft folder",
	uploading: "Uploading %s…", synced: "%s synced", syncedEvents: "%s synced · +%d events",
}

var trayFR = trayText{
	lastUpload: "Dernier envoi : %s", never: "aucun envoi", syncNow: "Synchroniser", openApp: "Ouvrir Ravenpost",
	quit: "Quitter Ravenpost", chooseFolder: "Dossier World of Warcraft",
	uploading: "Envoi de %s…", synced: "%s synchronisé", syncedEvents: "%s synchronisé · +%d événements",
}

// trayMenu builds the menu, and the func that brings its lines up to date.
func (a *App) trayMenu(app *application.App, show func()) (*application.Menu, func()) {
	t := trayStrings()
	menu := app.NewMenu()
	status := menu.Add("Ravenpost").SetEnabled(false)
	last := menu.Add("").SetEnabled(false)
	menu.AddSeparator()
	menu.Add(t.openApp).OnClick(func(*application.Context) { show() })
	syncNow := menu.Add(t.syncNow).OnClick(func(*application.Context) { a.syncer.SyncNow(true) })
	menu.AddSeparator()
	menu.Add(t.quit).OnClick(func(*application.Context) { app.Quit() })

	refresh := func() {
		snap := a.syncer.Snapshot()
		// The upload in progress, then for a minute what it brought.
		switch {
		case len(snap.Uploading) > 0:
			status.SetLabel(fmt.Sprintf(t.uploading, strings.Join(snap.Uploading, ", ")))
		case len(snap.LastUploaded) > 0 && time.Since(snap.LastSync) < time.Minute:
			status.SetLabel("✓ " + uploadedSummary(t, snap.LastUploaded))
		default:
			status.SetLabel("Ravenpost")
		}
		last.SetLabel(fmt.Sprintf(t.lastUpload, lastUploadWhen(t, snap.LastSync)))
		syncNow.SetEnabled(a.linkedAny() || len(snap.Sharing) > 0)
		menu.Update()
	}
	refresh()
	return menu, refresh
}

func lastUploadWhen(t trayText, at time.Time) string {
	switch {
	case at.IsZero():
		return t.never
	case time.Since(at) > 20*time.Hour:
		return at.Local().Format("02/01 15:04")
	default:
		return at.Local().Format("15:04")
	}
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

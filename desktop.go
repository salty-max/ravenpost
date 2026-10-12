package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"runtime"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// The window's pages (frontend/, built by Vite into frontend/dist). A checkout
// without a build still compiles: dist holds a placeholder (.gitkeep).
//
//go:embed all:frontend/dist
var frontendFS embed.FS

// The painted raven, the app's icon (Windows' taskbar; macOS takes the .app's).
//
//go:embed assets/icon-512.png
var appIconPNG []byte

func init() {
	// The window hears the whole state on every change (typed in the bindings).
	application.RegisterEvent[State]("state")
}

// runDesktop runs the window and the menu-bar (macOS) or tray (Windows) icon
// until Quit. Opened by the user, the window shows at once; started at login
// (background), it waits for a click on the icon. Closing the window only
// hides it: Ravenpost keeps carrying the files from the icon.
func (a *App) runDesktop(ctx context.Context, background bool, stop func()) error {
	dist, err := fs.Sub(frontendFS, "frontend/dist")
	if err != nil {
		return err
	}
	svc := &Ravenpost{app: a}
	var win *application.WebviewWindow
	show := func() {
		if win == nil {
			return
		}
		setDockVisible(true)
		win.Show()
		win.Focus()
	}
	hide := func() {
		if win == nil {
			return
		}
		win.Hide()
		setDockVisible(false)
	}

	app := application.New(application.Options{
		Name:        "Ravenpost",
		Description: "Your addons' saved files, carried to their sites",
		Icon:        appIconPNG,
		Services:    []application.Service{application.NewService(svc)},
		Assets:      application.AssetOptions{Handler: application.AssetFileServerFS(dist)},
		// A menu-bar app: the Dock icon comes and goes with the window (dock_darwin.go).
		Mac:     application.MacOptions{ActivationPolicy: application.ActivationPolicyAccessory},
		Windows: application.WindowsOptions{DisableQuitOnLastWindowClosed: true},
		// Opened again while running: the running one shows its window.
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID:               "app.ravenpost",
			OnSecondInstanceLaunch: func(application.SecondInstanceData) { show() },
		},
		OnShutdown: stop,
	})
	// Only now, past the single-instance check (a second one has exited in
	// New): one syncer at a time.
	go a.syncer.Run(ctx)
	svc.chooseFolder = func() (string, error) {
		return app.Dialog.OpenFile().
			CanChooseDirectories(true).
			CanChooseFiles(false).
			CanCreateDirectories(false).
			SetTitle(trayStrings().chooseFolder).
			AttachToWindow(win).
			PromptForSingleSelection()
	}

	win = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "main",
		Title:            "Ravenpost",
		Width:            980,
		Height:           700,
		MinWidth:         780,
		MinHeight:        560,
		Hidden:           true,
		BackgroundColour: application.NewRGB(11, 12, 16),
		URL:              "/",
		Mac: application.MacWindow{
			TitleBar:                application.MacTitleBarHiddenInset,
			InvisibleTitleBarHeight: 52,
		},
	})
	win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		e.Cancel()
		hide()
	})

	// The menu-bar / tray icon and its menu.
	tray := app.SystemTray.New()
	menu, refreshMenu := a.trayMenu(app, show)
	tray.SetMenu(menu)
	tray.SetTooltip("Ravenpost")
	setIcon := func() {
		dim := !a.linkedAny()
		if runtime.GOOS == "darwin" {
			tray.SetTemplateIcon(envelopeIcon(true, dim))
		} else {
			tray.SetIcon(envelopeIcon(false, dim))
		}
	}
	setIcon()
	if runtime.GOOS != "darwin" {
		tray.OnClick(show) // Windows: a click opens the window, the right click the menu
	}

	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		if !background || !a.linkedAny() {
			show()
		}
	})
	// macOS: the app opened again from Finder or Launchpad while running.
	app.Event.OnApplicationEvent(events.Mac.ApplicationShouldHandleReopen, func(*application.ApplicationEvent) { show() })

	// Every change reaches the window and the menu; a tick keeps "2 minutes
	// ago" and the menu's "✓ … synced" line honest.
	go func() {
		tick := time.NewTicker(15 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-a.changed:
			case <-tick.C:
			}
			app.Event.Emit("state", svc.State())
			setIcon()
			refreshMenu()
		}
	}()

	log.Printf("Ravenpost %s: window and %s icon", version, map[bool]string{true: "menu-bar", false: "tray"}[runtime.GOOS == "darwin"])
	return app.Run()
}

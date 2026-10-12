# Ravenpost

A small desktop app for macOS and Windows that carries your World of Warcraft
addons' saved files to their sites, a few seconds after you log out or
`/reload`:

- **[WoWLocker](https://wow-locker.app)**: your characters, their gear and what
  happens to them (the WowLocker addon).
- **[Hearthtale](https://hearthtale.app)**: your characters' journals, to read on
  your phone (the Hearthtale addon).

Ravenpost opens a window where you link each site (you sign in on the site and
confirm the code Ravenpost shows) and then watch it work: what each logout sent,
the characters it found, the game folders it watches. Close the window and it
keeps working from the menu bar (macOS) or the tray (Windows); started at login,
it stays there quietly until you open it. Formerly the WoWLocker companion: its
link and settings carry over the first time Ravenpost starts.

Built with Go and [Wails](https://v3.wails.io) (the window is React in the
system's own webview: no bundled browser, a small download).

## Download

The [latest release](https://github.com/salty-max/ravenpost/releases/latest):
`ravenpost-vX.Y.Z-macos.zip` (macOS 11 or later, Apple silicon and Intel: move
Ravenpost to Applications) or `ravenpost-vX.Y.Z-windows-x64.exe` /
`ravenpost-vX.Y.Z-windows-arm64.exe` (Windows 10 or 11; the window uses Microsoft Edge WebView2, part of Windows 11 and of an up-to-date Windows 10).

## What it sends

- WoWLocker: the WowLocker addon's file, as it is.
- Hearthtale: each character's name, realm, race and class, its book as the
  addon wrote it at logout, and a link code if you typed one (`/ht link CODE`).
  The addon's raw records stay on your computer.

Nothing else: no other file, no other addon. A character or a whole game account
can be left out in the window. A book you removed from hearthtale.app stays off it: Ravenpost
shows it as removed, and sends it again only once you type a new link code in
the game.

## Development

```bash
cd frontend && bun install && bun run build && cd ..   # the window's pages (embedded)
go run .                          # the app: window and menu-bar/tray icon
go test ./...                     # vet: go vet ./... && GOOS=windows go vet ./...
scripts/bindings.sh               # after changing service.go: the window's TypeScript bindings
scripts/build.sh                  # release build (macOS: needs cgo for the .app)
scripts/release.sh NOTES.md       # tag and push; Actions publish the release
```

Working on the window: `cd frontend && bun run dev`, then either
`FRONTEND_DEVSERVER_URL=http://127.0.0.1:9245 go run .` (the app, hot reloaded)
or `http://127.0.0.1:9245/?mock` in a browser (a made-up state). `go run . -headless`
syncs without a window or an icon.

Local sites: WoWLocker on `http://localhost:5174`, Hearthtale on
`http://localhost:5175` (the defaults outside a release build).

MIT licensed. Not affiliated with Blizzard Entertainment.

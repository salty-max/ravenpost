# Ravenpost

Go menu-bar/tray app (fyne.io/systray; macOS needs cgo, Windows builds from a
Mac with CGO_ENABLED=0) that uploads WoW addons' saved files to their sites.
Moved out of salty-max/wow-locker (`companion/`, history kept) and renamed on
6 October 2026, to serve Hearthtale too.

## Layout

- `services.go`: the sites (WoWLocker, Hearthtale), their addons' files and
  default servers (`-X main.wowlockerServer=… -X main.hearthtaleServer=…` in
  release builds; localhost otherwise).
- `config.go`: `<user config dir>/ravenpost/config.json` (0600): a link per site
  (server, token, BattleTag), folders, exclusions, uploaded hashes. The first
  start migrates the WoWLocker companion's `wow-locker/config.json` and removes
  its launch at login (`cleanLegacyLaunch`, replaced in tests: tests must never
  touch the machine's login items).
- `wow.go`: finds client folders and, per account, each site's saved files
  (WowLocker.lua per account; Hearthtale.lua per character, under
  `<account>/<realm>/<character>/SavedVariables/`).
- `sync.go`: polls file times every 3 s, uploads when a file's hash (+
  selection) changed. WoWLocker: the account's characters in one upload.
  Hearthtale: one character per request (Vercel takes 4.5 MB), only the fields
  the site reads (`hearthtaleFields`); statuses saved / unlinked / invalid.
- `app.go`: pairing per site (device code: `/api/companion/pair/start`, the
  page on the site, `/pair/poll` hands the token over once).
- `settings.go` + `settings.html`: the settings page on 127.0.0.1:47615 (also
  the single-instance lock); every API call needs the config's key in
  `X-Ravenpost-Key` and a matching Host header.
- `tray.go`, `icon.go` (the tray icon, a sealed letter drawn in code: menu-bar
  icons are one-colour silhouettes); the app icon is the painted raven
  (`assets/icon-painted-*`, made by the user with GPT), rounded into
  `assets/icon-512.png` (app) and `icon.png` (settings page): see assets/README.md.
- `luasv.go`: parses SavedVariables as data (never executes it).
  `testdata/sim.{lua,json}` come from WoWLocker's addon sim
  (`WL_SV=… WL_DUMP=… luajit addon/test/sim.lua` in wow-locker).

## Rules

- Windows builds are unsigned: never start PowerShell, rundll32, cmd or any
  script host (Smart App Control blocked 0.1.2 for it). Links and the folder
  picker are direct Win32 calls (`platform_windows.go`).
- Upload feedback stays inside the app (tray status, settings page toast): no
  system notifications.
- Env for tests and dev: `RAVENPOST_CONFIG_DIR`, `RAVENPOST_LEGACY_DIR`,
  `RAVENPOST_NO_BROWSER` (log URLs instead of opening them).
- Conventional Commits, lowercase subjects. Before calling a change done:
  gofmt, `go vet ./...`, `GOOS=windows go vet ./...`, `go test ./...`.
- Release: `scripts/release.sh [--version X.Y.Z] NOTES.md`; Actions build on
  macOS and publish `ravenpost-macos.zip`, `ravenpost-windows-{x64,arm64}.exe`.
  WoWLocker's and Hearthtale's download pages link to the latest release.

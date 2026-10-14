# Ravenpost

A desktop app (Go core, a Wails v3 window in the system's webview with a
React UI, and an icon in the macOS menu bar or the Windows tray) that uploads
WoW addons' saved files to their sites. macOS needs cgo; Windows builds from a
Mac with CGO_ENABLED=0. Moved out of salty-max/wow-locker (`companion/`,
history kept) and renamed on 6 October 2026, to serve Hearthtale too; a tray
app with a settings page in the browser until 0.3.0 (12 October 2026), when it
became an app with its own window.

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
  `<account>/<realm>/<character>/SavedVariables/`) and the addons' account
  files that may hold shared facts (`Account.Shared`, not shown in the window).
- `sync.go`: polls file times every 3 s, uploads when a file's hash (+
  selection) changed. WoWLocker: the account's characters in one upload.
  Hearthtale: one character per request (Vercel takes 4.5 MB), only the fields
  the site reads (`hearthtaleFields`); statuses saved / unlinked / invalid /
  removed (its owner took the book off the site: a new link code brings it back).
  WoWLocker's "gone" (the account no longer has the character: deleted) is
  kept in the config (`Gone`): left out of the lists, still uploaded, back
  when the site says otherwise (played again). A character deleted and made
  again with its name: of a name's characters on one realm of one game, only
  the one played last is listed (`supersededCharacters`), and a file taken
  over by another character (its folder reused) drops the old one.
- `shared.go`: the facts the addons' opt-in collector kept of the world (the
  kit's `K.collect`: quests' texts, creatures, NPCs' lines, loot), in each
  addon's account-wide file (`<account>/SavedVariables/{Hearthtale,
  LorekeepersCodex,Yonder,SecondWind}.lua`, its `<Addon>Collect` table), sent
  when the player said yes there (`share`) and linked the addons' database
  (Ravenpost's inbox, `inboxServer`: `-X main.inboxServer`, the build's
  `INBOX_URL`, required; `POST /api/facts` with the inbox's token). Only
  the entries new or changed since the last upload go (`shared.json` beside
  the config: a hash of each entry sent, per file), in requests of 1 MB at
  most; not linked, they wait; a test realm's (`ptr` in the folder's name)
  never; an account left out sends nothing. The journal says how many facts
  went (`shared`), the Overview's third card ("The addons' database") which
  addons share (`State.sharing`: entries seen, still to send, the last
  upload) and its Battle.net link (`State.facts`). Ravenpost is the addons'
  companion (README): a Yonder or Codex player has a reason to install it.
- `inbox/`: Ravenpost's inbox (its README.md), a TypeScript server of its
  own (Hono on Vercel, https://ravenpost-inbox.vercel.app, a private Blob
  store, no database): the Battle.net sign-in, the facts players share
  (`POST /api/facts`), held until wow-data's daily job merges and removes
  them. Deployed with `vercel deploy --prod` from `inbox/`; `cd inbox && bun
  run check` in CI.
- `login.go`: linking the addons' database with Battle.net the way desktop
  apps sign in: a listener on 127.0.0.1, the browser on the inbox's
  `/api/login?port=&nonce=`, Battle.net, then back here on `/linked` with a
  signed token (the inbox keeps nothing). The window's Link and Unlink with
  the site id `shared`.
- `app.go`: pairing per site (device code: `/api/companion/pair/start`, the
  page on the site, `/pair/poll` hands the token over once) and the settings
  (`ApplySettings`).
- `activity.go`: the journal the window shows (what each upload brought, a
  site's refusal, a failure, a link made or undone), the last 60 kept in the
  config; a failure repeated only moves its line.
- `desktop.go`: the Wails app: the window (shown when the user opens
  Ravenpost; started at login with `-background`, it waits for a click on the
  icon; closing it only hides it), the single instance (a second launch shows
  the running one's window), the icon and its menu, the "state" event (the
  whole `State` on every change). `dock_darwin.go`: in the Dock and ⌘-Tab only
  while the window is open (accessory otherwise, `LSUIElement`).
- `service.go`: `Ravenpost`, the service the window calls (bound by Wails:
  `State`, `Link`, `Unlink`, `SyncNow`, `SetCharacterSent`, `SetAccountSent`,
  `ChooseFolder` (Wails' native dialog), `AddFolder`, `RemoveFolder`,
  `SetLaunchAtLogin`, `SetServer`, `Open` (http(s) only)).
- `frontend/`: the window, React 19 + TypeScript + Vite + Tailwind v4, built
  with Bun into `frontend/dist` (embedded; a `.gitkeep` keeps a checkout
  compiling). `frontend/bindings`: the service's TypeScript, generated by
  `scripts/bindings.sh` (pinned wails3 CLI through `go run`), committed; CI
  fails when out of date. The pages: Overview (status, the two sites, the
  journal), Characters, Game folders, Settings; English and French (the
  system's language, `State.language`). `src/mock.ts`: a made-up state for
  working in a browser (`bun run dev`, `http://127.0.0.1:9245/?mock`, `&fresh`
  for a first run, `&lang=fr_FR`), never in the build. Against the real core
  in a browser: `go build -tags server` (Wails' server mode, localhost:8080).
- `tray.go`, `icon.go` (the menu-bar/tray icon, a sealed letter drawn in code:
  menu-bar icons are one-colour silhouettes; its menu: status, last upload,
  Open Ravenpost, Sync now, Quit); the app icon is the painted raven
  (`assets/icon-painted-*`, made by the user with GPT), rounded into
  `assets/icon-512.png` (the app, embedded for Windows' taskbar) and
  `frontend/public/icon.png` (the window): see assets/README.md.
- `luasv.go`: parses SavedVariables as data (never executes it).
  `testdata/sim.{lua,json}` come from WoWLocker's addon sim
  (`WL_SV=… WL_DUMP=… luajit addon/test/sim.lua` in wow-locker).

## Rules

- Windows builds are unsigned: never start PowerShell, rundll32, cmd or any
  script host (Smart App Control blocked 0.1.2 for it). Links are a direct
  Win32 call (`platform_windows.go`): never Wails' `app.Browser.OpenURL` nor
  `Browser.OpenURL` from the frontend (Wails runs rundll32 for them); the
  window opens links through the service's `Open`. The window needs WebView2
  (part of Windows 11, and of Windows 10 kept up to date).
- Upload feedback stays inside the app (the window's journal and toasts, the
  menu's status line): no system notifications.
- Env for tests and dev: `RAVENPOST_CONFIG_DIR`, `RAVENPOST_LEGACY_DIR`,
  `RAVENPOST_NO_BROWSER` (log URLs instead of opening them).
- Conventional Commits, lowercase subjects. Before calling a change done:
  `cd frontend && bun run build` (typecheck and build), `scripts/bindings.sh`
  after a change to the service, gofmt, `go vet ./...`, `GOOS=windows go vet
  ./...`, `go test ./...`. Tests never call `SetLaunchAtLogin` (it writes the
  machine's login items).
- Release: `scripts/release.sh [--version X.Y.Z] NOTES.md`; Actions build on
  macOS (Go and Bun; `-tags production`) and publish `ravenpost-vX.Y.Z-macos.zip`,
  `ravenpost-vX.Y.Z-windows-{x64,arm64}.exe` (main.go's version). WoWLocker's
  and Hearthtale's download pages find them in the latest release.

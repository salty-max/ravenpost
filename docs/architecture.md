# Ravenpost's architecture

The app file by file (moved from CLAUDE.md on 20 October 2026; the map
stays there). The inbox: `inbox/README.md`. The icons: `assets/README.md`.

## The files

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
- `ping.go`: once a day a ping to the inbox's `/api/ping` for its numbers,
  looking every 15 minutes (the first a minute after the start) whether
  today's went through (the inbox's UTC day, which it answers with, not
  this clock's): a failed one (no network yet at login)
  goes again at the next look, and a computer asleep most of the day still
  counts each day (a 24-hour timer, in 0.4.0, counted only the hours
  awake and waited a day after a failure). The install's random id
  (`InstallID` in the config; the inbox keeps a hash), the version, the
  system, the links made, how many addons share. Nothing of the player.
- `login.go`: the one Battle.net sign-in, the way desktop apps sign in: a
  listener on 127.0.0.1, the browser on the inbox's `/api/login?port=&nonce=`,
  Battle.net, then back here on `/linked` with the sharing token (the addons'
  database, `Links["shared"]`) and a passport, handed at once to each site in
  `passportSites` (Hearthtale's `/api/companion/signin`) for its own upload
  token. The inbox keeps nothing. The window's sign-in is Link("shared"); its
  Sign out unlinks the database and Hearthtale. WoWLocker keeps its own
  device-code link and gets the passport at `/api/companion/refresh` (with that
  link's token) to renew the characters it trusts: a character made since the
  last login on wow-locker.app syncs without one (the passport lists Classic
  Era's characters with realm and name; a refusal is a journal line, the link
  stays).
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
  `SetLaunchAtLogin`, `SetServer`, `Diagnostics`, `Open` (http(s) only)).
- `frontend/`: the window, React 19 + TypeScript + Vite + Tailwind v4, built
  with Bun into `frontend/dist` (embedded; a `.gitkeep` keeps a checkout
  compiling). `frontend/bindings`: the service's TypeScript, generated by
  `scripts/bindings.sh` (pinned wails3 CLI through `go run`), committed; CI
  fails when out of date. The pages: Overview (status, the two sites, the
  journal), Characters, Addons, Game folders, Settings; English and French (the
  system's language, `State.language`). `src/mock.ts`: a made-up state for
  working in a browser (`bun run dev`, `http://127.0.0.1:9245/?mock`, `&fresh`
  for a first run, `&lang=fr_FR`), never in the build. Against the real core
  in a browser: `go build -tags server` (Wails' server mode, localhost:8080).
- `tray.go`, `icon.go` (the menu-bar/tray icon, a sealed letter drawn in code:
  menu-bar icons are one-colour silhouettes; its menu: status, last upload,
  a newer-release line when there is one, Open Ravenpost, Sync now, Quit); the app icon is the painted raven
  (`assets/icon-painted-*`, made by the user with GPT), rounded into
  `assets/icon-512.png` (the app, embedded for Windows' taskbar) and
  `frontend/public/icon.png` (the window): see assets/README.md.
- `addons.go`: the family's ten addons found in a game folder's
  Interface/AddOns (`Install.Addons`: name, the `## Version` of the TOC that
  client loads, `_Vanilla` for Classic Era, `_Camelot` for Forever and its
  beta, and whether the addon's saved file exists under any account). "Installed" only:
  AddOns.txt is not read. The Addons page shows it. A new addon of the family
  goes into `familyAddons` and the page's list.
- `update.go`: every 6 hours GitHub's `releases/latest` (it skips
  prereleases: a release Windows blocks is flipped to prerelease to stop the
  nudge) tells `State.Update`: a banner on the Overview, a line in Settings and in
  the tray's menu. Ravenpost never updates itself (unsigned builds).
- `diagnostics.go`: `Diagnostics()`, a redacted text for an issue (no
  character, account or token names; the home folder as `~`).
  Forever's beta folder (`_classic_beta_`) sends its facts on purpose
  (`sharedGame`): only PTR folders are skipped.
- `luasv.go`: parses SavedVariables as data (never executes it).
  `testdata/sim.{lua,json}` come from WoWLocker's addon sim
  (`WL_SV=… WL_DUMP=… luajit addon/test/sim.lua` in wow-locker).

## Windows builds and Smart App Control

- Windows builds are unsigned: never start PowerShell, rundll32, cmd or any
  script host (Smart App Control blocked 0.1.2 for it). Links are a direct
  Win32 call (`platform_windows.go`): never Wails' `app.Browser.OpenURL` nor
  `Browser.OpenURL` from the frontend (Wails runs rundll32 for them); the
  window opens links through the service's `Open`. The window needs WebView2
  (part of Windows 11, and of Windows 10 kept up to date).
  Even behaving, one unsigned file can be blocked: Smart App Control judges
  each file (its hash) through Microsoft's cloud. On 15 October 2026 a build
  of main (v0.3.0-20) was blocked while the same code built again, twice,
  ran, as did a build at each feature commit since v0.3.0 (sharing, the
  sign-in's listener, the ping): no code was to blame. A blocked build:
  rebuild it (a new file: another version or commit) and try again before
  suspecting the code. A release file blocked for players would need a new
  release. Signing with a certificate of a CA in Microsoft's Trusted Root
  Program is the lasting fix (Azure Artifact Signing takes individuals in the
  US and Canada only; elsewhere an OV certificate), the user's decision.

## Tests, checks and releases

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
  `ravenpost-vX.Y.Z-windows-{x64,arm64}.exe` (main.go's version; a test build from a later commit is named by `git describe --tags`, `v0.4.0-19-g358ec41`). WoWLocker's
  and Hearthtale's download pages find them in the latest release.

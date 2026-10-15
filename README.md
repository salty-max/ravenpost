# Ravenpost

Ravenpost is a small app for macOS and Windows, the companion of the
addons Hearthtale, Lorekeeper's Codex, Yonder, Second Wind and WoWLocker. A
few seconds after you log out or use `/reload`, it carries what they saved:

- **Help the addons keep up with Forever.** Tick **Share what you see** in
  Hearthtale, Lorekeeper's Codex, Yonder or Second Wind, link the addons'
  database here with Battle.net, and the quests, creatures and lines the game
  shows you go to the addons' database. Forever's new content reaches the
  addons weeks before the usual databases catch up, in every language players
  share. Every player who does is a real help, and it's truly appreciated.
- **[Hearthtale](https://hearthtale.app)**: your characters' journals, to
  read on your phone.
- **[WoWLocker](https://wow-locker.app)**: your characters, their gear and
  what happens to them.

**[Download the latest release](https://github.com/salty-max/ravenpost/releases/latest)**
(macOS and Windows, see [Download](#download)).

## Using Ravenpost

To share what you see, click **Link with Battle.net** on the addons'
database card and sign in in your browser: the window then shows which
addons share and how much went. To use a site, link it the same way on its
card, sign in on the site and check that the code matches the one Ravenpost
shows. The window then shows what each logout
sent, the characters Ravenpost found and the game folders it watches.

Closing the window doesn't stop Ravenpost. It keeps working from the menu bar
on macOS or the tray on Windows. With **Open Ravenpost at login** turned on in
its settings, it starts there quietly and sends your files from your first
logout.

Ravenpost finds World of Warcraft by itself. If your game is somewhere else,
add its folder in **Game folders**. The window is in English or French,
following your system's language.

Ravenpost replaces the WoWLocker companion. Your link and settings carry over
the first time it starts.

## Download

Get the [latest release](https://github.com/salty-max/ravenpost/releases/latest):

- **macOS 11 or later**, Apple silicon and Intel: `ravenpost-vX.Y.Z-macos.zip`.
  Move Ravenpost to Applications.
- **Windows 10 or 11**: `ravenpost-vX.Y.Z-windows-x64.exe`, or
  `ravenpost-vX.Y.Z-windows-arm64.exe` on ARM. The window needs Microsoft Edge
  WebView2, which comes with Windows 11 and an up-to-date Windows 10.

Ravenpost isn't code-signed yet, so Windows and macOS warn you the first time
you open it.

## What it sends

- **WoWLocker** gets the WowLocker addon's saved file as it is.
- **Hearthtale** gets each character's name, realm, race and class, its
  journal as the addon wrote it at logout, and a link code if you typed one
  with `/ht link CODE`. The addon's raw records stay on your computer.
- **The addons' database** gets what the game told you of the world, only if
  you ticked "Share what you see" in Hearthtale, Lorekeeper's Codex, Yonder or
  Second Wind and linked it here with Battle.net: quests' texts, creatures,
  what characters say, what a creature dropped. The link counts you as one
  voice when players' games disagree. It keeps a hash of your account, never
  the account itself. Your name, class and race are never in what's sent, nor
  a line naming another player, nor your chat.

- **Once a day**, Ravenpost tells its inbox it's running: a random number
  made for this install (the inbox keeps only a hash of it), its version,
  your system and which links are made. That's how many use it is counted,
  nothing about you or your characters.

Ravenpost sends no other file and reads no other addon. You can leave out a
character or a whole game account in the window. If you remove a book from
hearthtale.app, Ravenpost shows it as removed and only sends it again after
you type a new link code in the game.

## Development

Ravenpost is written in Go with [Wails](https://v3.wails.io). The window is
React in the system's own webview, so there is no bundled browser and the
download stays small.

```bash
cd frontend && bun install && bun run build && cd ..   # the window's pages (embedded)
go run .                          # the app: window and menu-bar/tray icon
go test ./...                     # vet: go vet ./... && GOOS=windows go vet ./...
scripts/bindings.sh               # after changing service.go: the window's TypeScript bindings
scripts/build.sh                  # release build (macOS: needs cgo for the .app)
scripts/release.sh NOTES.md       # tag and push; Actions publish the release
```

To work on the window, run `cd frontend && bun run dev`. Then start the app
with `FRONTEND_DEVSERVER_URL=http://127.0.0.1:9245 go run .` to get hot
reloading, or open `http://127.0.0.1:9245/?mock` in a browser to see it with
made-up data. `go run . -headless` syncs without a window or an icon.

Outside a release build, Ravenpost talks to the local sites: WoWLocker on
`http://localhost:5174` and Hearthtale on `http://localhost:5175`.

MIT licensed. Not affiliated with Blizzard Entertainment.

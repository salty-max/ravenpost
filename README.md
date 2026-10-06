# Ravenpost

A small menu-bar (macOS) and tray (Windows) app that carries your World of
Warcraft addons' saved files to their sites, a few seconds after you log out or
`/reload`:

- **[WoWLocker](https://wow-locker.app)**: your characters, their gear and what
  happens to them (the WowLocker addon).
- **[Hearthtale](https://hearthtale.app)**: your characters' journals, to read on
  your phone (the Hearthtale addon).

Each site is linked on its own, from Ravenpost's settings: you sign in on the
site and confirm the code Ravenpost shows. Formerly the WoWLocker companion: its
link and settings carry over the first time Ravenpost starts.

## Download

The [latest release](https://github.com/salty-max/ravenpost/releases/latest):
`ravenpost-macos.zip` (macOS 11 or later, Apple silicon and Intel: move
Ravenpost to Applications) or `ravenpost-windows-x64.exe` /
`ravenpost-windows-arm64.exe` (Windows 10 or 11).

## What it sends

- WoWLocker: the WowLocker addon's file, as it is.
- Hearthtale: each character's name, realm, race and class, its book as the
  addon wrote it at logout, and a link code if you typed one (`/ht link CODE`).
  The addon's raw records stay on your computer.

Nothing else: no other file, no other addon. A character or a whole game account
can be left out in the settings.

## Development

```bash
go test ./...                     # vet: go vet ./... && GOOS=windows go vet ./...
go run . -headless                # no tray; settings on http://127.0.0.1:47615
scripts/build.sh                  # release build (macOS: needs cgo for the .app)
scripts/release.sh NOTES.md       # tag and push; Actions publish the release
```

Local sites: WoWLocker on `http://localhost:5174`, Hearthtale on
`http://localhost:5175` (the defaults outside a release build).

MIT licensed. Not affiliated with Blizzard Entertainment.

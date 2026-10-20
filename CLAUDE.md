# Ravenpost

A desktop app (Go core, a Wails v3 window in the system's webview with a
React UI, and an icon in the macOS menu bar or the Windows tray) that uploads
WoW addons' saved files to their sites. macOS needs cgo; Windows builds from a
Mac with CGO_ENABLED=0. Moved out of salty-max/wow-locker (`companion/`,
history kept) and renamed on 6 October 2026, to serve Hearthtale too; a tray
app with a settings page in the browser until 0.3.0 (12 October 2026), when it
became an app with its own window. Beside it, `inbox/`: Ravenpost's inbox
(Hono on Vercel, ravenpost-inbox.vercel.app), the Battle.net sign-in and the
facts players share. salty-max/ravenpost. Read the family's CLAUDE.md
(`../CLAUDE.md`) first.

## Where things are

| What | Where |
|---|---|
| The app file by file: sites, config, folders, sync, shared facts, ping, sign-in, pairing, journal, window, service, frontend, tray, parser | `docs/architecture.md` |
| Windows builds and Smart App Control (what happened, what to do) | `docs/architecture.md` |
| The inbox: API, Blob store, cron, events, deploys | `inbox/README.md` |
| The icons | `assets/README.md` |
| What the app is, for a player | `README.md` |

## Commands

```bash
bash scripts/check.sh                                # what CI checks: the window, bindings, gofmt, vet (macOS, Windows), tests, the inbox
bun ../addon-kit/q.ts check -- bash scripts/check.sh # the same, quiet, stamping the tree for the push (harness.check)
scripts/bindings.sh                                  # after a change to the service
cd frontend && bun run dev                           # the window in a browser: http://127.0.0.1:9245/?mock (&fresh, &lang=fr_FR)
go build -tags server                                # the real core in a browser (localhost:8080)
INBOX_URL=… scripts/build.sh                         # a test build (the Windows exe goes to iCloud)
scripts/release.sh [--version X.Y.Z] NOTES.md        # check, tag, push; Actions build and publish
```

`git config harness.check "bash scripts/check.sh"` (local, once per clone):
q stamps only the repository's own check.

## Hard rules

- Windows builds are unsigned: never start PowerShell, rundll32, cmd or any
  script host; links through the service's `Open` (a direct Win32 call),
  never Wails' `OpenURL`. A blocked build: rebuild it and try again before
  blaming the code; signing is the user's decision.
- Upload feedback stays inside the app: no system notifications.
- SavedVariables are parsed as data, never executed. Nothing of the player
  in the ping. A test realm's facts are never sent.
- Tests never call `SetLaunchAtLogin` and never touch the machine's login
  items (`RAVENPOST_CONFIG_DIR`, `RAVENPOST_LEGACY_DIR`,
  `RAVENPOST_NO_BROWSER` for tests and dev).
- The inbox deploys by hand (`vercel deploy --prod` from `inbox/`, the
  user's go each time); `vercel link` writes production tokens to
  `.env.local`, which Bun loads.
- Before calling a change done: `scripts/check.sh` passes, and the window
  is looked at (server mode or the mock), not only built.
- Conventional Commits, lowercase subjects, no AI trailers. Commit locally;
  ask before any push, release or deploy. The pre-push hook wants a check
  stamp on the tree (q), which `release.sh` makes after the version bump.

# Ravenpost's inbox

Ravenpost's server: its Battle.net sign-in, and what the game told the
players who said yes to the addons' opt-in ("Share what you see" in
Hearthtale, Lorekeeper's Codex, Yonder and Second Wind), held here until
wow-data's daily job merges it into its `data/players` (its `bin/players.ts`
and `players.yml`). No database: each upload is a file in a private Vercel
Blob store, and goes once merged.

- `GET /api/login?port=&nonce=` and `/api/login/callback`: Ravenpost's one
  sign-in (`src/auth.ts`, scopes `openid wow.profile`). Battle.net signs the
  player in, and the inbox hands Ravenpost, on `http://127.0.0.1:<port>/linked`:
  - the sharing token (the account's id keyed with `INBOX_SECRET`, its
    BattleTag), checked on each upload;
  - a passport (`src/passport.ts`): the Battle.net id, BattleTag and the
    characters the account owns in each region (Classic Era's profile), signed
    with the Ed25519 key `INBOX_SIGNING_KEY`, ten minutes, once. Ravenpost
    hands it to Hearthtale (`/api/companion/signin`), which checks it with the
    public key in its own code and gives Ravenpost its upload token. WoWLocker
    will take it the same way.
  Nothing is kept. `src/devkey.ts`: a key pair for this computer (INBOX_DEV,
  tests), trusted by a Hearthtale running locally only.
- `POST /api/facts`: an addon's collect table, from a signed-in player
  (`Authorization: Bearer <token>`), flattened and checked (`src/facts.ts`),
  dropped in the inbox (`src/inbox.ts`).
- `GET /api/inbox/list`, `POST /api/inbox/read`, `POST /api/inbox/done`: for
  wow-data's daily job, behind `INBOX_TOKEN`; `POST /api/inbox/stats`: its
  merge's numbers (or days brought by hand: downloads.md's were).

## The numbers

`/stats` (https://ravenpost-inbox.vercel.app/stats): the dashboard
(`src/dashboard.ts`), for the BattleTags in `STATS_BATTLETAGS`, signed in
with Battle.net in the browser (a signed cookie, 30 days). Its history,
`stats/history.json` (`src/stats.ts`), a day at a time:

- downloads: each addon's CurseForge (cfwidget), Wago (its page) and GitHub
  (releases) totals, Ravenpost's releases;
- Ravenpost: the installs that pinged that day (`POST /api/ping`, once a
  day each: a hash of a random install id, the version, system, links);
- sharing: the day's sharers, uploads and facts by game and language
  (counted as they come in, by the sharer's hash);
- merged: the new facts wow-data's merge found;
- curseforge: each addon's rank among every WoW addon by popularity, its
  favorites and thumbs up (CurseForge's official API, `CURSEFORGE_API_KEY`;
  its search is closed to this key);
- traffic: hearthtale.app's and wow-locker.app's page views and visitors
  from Vercel Web Analytics' API (`STATS_SITES`, `VERCEL_TEAM_ID`, and
  `VERCEL_ANALYTICS_TOKEN`: a Vercel token; without it, a link to Vercel).

The daily job (`/api/cron/stats`, Vercel Cron at 05:17 UTC with
`CRON_SECRET`; by hand with `INBOX_TOKEN`) counts yesterday's pings and
uploads, then drops their files: only the sums stay.

## The app on a phone, and its notifications

The dashboard is an app (`public/`: its manifest, its service worker
`sw.js`, Ravenpost's painted raven for its icons and favicon, made from
`../assets/icon-painted-1024.png` and `icon-512.png` with magick). On a
phone: open `/stats`, add it to the Home Screen, open Ravenpost from there
and sign in with Battle.net (it comes back into the app, as Hearthtale's
does). A sign-in lasts 90 days, renewed each week it's used.

Notifications (`src/push.ts`, Web Push from Hearthtale's `webpush.ts`, a
subscription a file in `push/`): turned on per device from the dashboard,
for:

- the GitHub workflows' words (`POST /api/events`, `INBOX_EVENTS_TOKEN`:
  wow-data's `bin/tell.ts`): an addon's game data merged by itself (what
  changed, in words: `bin/describe-data.ts`), the pins moved, a job failed,
  a pull request waiting for a hand (players' facts). Kept in
  `events/recent.json` (60 days), the dashboard's Activity;
- CurseForge every 10 minutes (`/api/cron/curseforge`): a release live
  (`src/curseforge.ts`: the site's own JSON of each addon's public releases,
  `www.curseforge.com/api/v1/mods/<id>/files`; one not seen before passed the
  review), and each addon's downloads read (`downloads/<day>.json`, 14 days:
  the dashboard's last 48 hours, its releases' downloads in
  `releases/latest.json`; the daily totals read there too, cfwidget should it
  refuse);
- the players' comments on CurseForge (the same job; `src/comments.ts`), kept for the dashboard's Comments (`comments/recent.json`: the threads, whether the owner had the last word): the site's own JSON, what its comments page
  reads (`www.curseforge.com/api/v1/mods/<id>/comments`, no key), each new
  comment or reply by someone else than `CURSEFORGE_AUTHOR` (saltymax by
  default) a word with a link to answer it, several at once one word; the
  first look only learns what is there (`comments/seen.json`);
- the morning's digest (`/api/cron/digest`, Vercel Cron at 07:15 UTC, once
  the data jobs are done; `src/digest.ts`): what the jobs did since the
  last one, and yesterday's downloads, installs, sharing and visitors.

## Wowhead's pages, handed over

A Wowhead tab fetching pages for wow-data (its `bin/wowhead-tab.js`) can
reach neither the computer nor a folder: it hands them here
(`POST /api/wowhead/pages`, `WOWHEAD_TOKEN`, CORS for www.wowhead.com only),
files in `wowhead/`, until wow-data's `bin/wowhead-pages.ts pull` takes them
(`/api/wowhead/list`, `read`, `done`, the same token, which reaches nothing
else).

## Running it here

```bash
bun install
bun run dev      # http://localhost:3003, uploads in .inbox/, a test account signs in (INBOX_DEV=1)
bun run check    # typecheck, tests
```

Ravenpost's development build talks to `http://localhost:3003`.

## Where it runs

https://ravenpost-inbox.vercel.app: the Vercel project `ravenpost-inbox`
(team jellycat), its private Blob store `ravenpost-inbox` (fra1), deployed
from this folder with `vercel deploy --prod` (not from git). Its
environment: `BLOB_READ_WRITE_TOKEN` (the store's), `INBOX_ORIGIN`,
`INBOX_SECRET` (keys the accounts and signs the tokens: changing it signs
every player out), `INBOX_SIGNING_KEY` (the passports' Ed25519 private key;
its public half is in Hearthtale's `lib/ravenpost.ts`), `INBOX_TOKEN`
(wow-data's), `INBOX_BLOCKED` (optional:
accounts refused, a token's `sub`, comma-separated), and `BNET_CLIENT_ID` /
`BNET_CLIENT_SECRET`: the Battle.net app "Ravenpost" on develop.battle.net,
its redirect URL `https://ravenpost-inbox.vercel.app/api/login/callback`;
the numbers': `CRON_SECRET`, `STATS_BATTLETAGS`, `STATS_SITES`,
`VERCEL_TEAM_ID` (and `VERCEL_ANALYTICS_TOKEN`, `GITHUB_TOKEN`, `CURSEFORGE_API_KEY` when set);
the notifications': `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
`INBOX_EVENTS_TOKEN` (the workflows'); `WOWHEAD_TOKEN` (the Wowhead tab's).

Elsewhere: wow-data's `INBOX_URL` variable and `INBOX_TOKEN` secret (the same
as here), `INBOX_EVENTS_TOKEN` on wow-data and the four addons with game data
(the same as here), and this repository's `INBOX_URL` variable, which release
builds need (`scripts/build.sh`). This computer: `~/.config/wow-data/wowhead-token`
(the same `WOWHEAD_TOKEN`, for `pull`).

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
- traffic: hearthtale.app's and wow-locker.app's page views and visitors
  from Vercel Web Analytics' API (`STATS_SITES`, `VERCEL_TEAM_ID`, and
  `VERCEL_ANALYTICS_TOKEN`: a Vercel token; without it, a link to Vercel).

The daily job (`/api/cron/stats`, Vercel Cron at 05:17 UTC with
`CRON_SECRET`; by hand with `INBOX_TOKEN`) counts yesterday's pings and
uploads, then drops their files: only the sums stay.

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
`VERCEL_TEAM_ID` (and `VERCEL_ANALYTICS_TOKEN`, `GITHUB_TOKEN` when set).

Elsewhere: wow-data's `INBOX_URL` variable and `INBOX_TOKEN` secret (the same
as here), and this repository's `INBOX_URL` variable, which release builds
need (`scripts/build.sh`).

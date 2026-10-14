# Ravenpost's inbox

Ravenpost's server: its Battle.net sign-in, and what the game told the
players who said yes to the addons' opt-in ("Share what you see" in
Hearthtale, Lorekeeper's Codex, Yonder and Second Wind), held here until
wow-data's daily job merges it into its `data/players` (its `bin/players.ts`
and `players.yml`). No database: each upload is a file in a private Vercel
Blob store, and goes once merged.

- `GET /api/login?port=&nonce=` and `/api/login/callback`: Ravenpost's sign-in
  (`src/auth.ts`). Battle.net signs the player in, the inbox hands Ravenpost a
  signed token (the account's id keyed with `INBOX_SECRET`, its BattleTag) on
  `http://127.0.0.1:<port>/linked`. Nothing is kept: the token is only checked.
- `POST /api/facts`: an addon's collect table, from a signed-in player
  (`Authorization: Bearer <token>`), flattened and checked (`src/facts.ts`),
  dropped in the inbox (`src/inbox.ts`).
- `GET /api/inbox/list`, `POST /api/inbox/read`, `POST /api/inbox/done`: for
  wow-data's daily job, behind `INBOX_TOKEN`.

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
every player out), `INBOX_TOKEN` (wow-data's), `INBOX_BLOCKED` (optional:
accounts refused, a token's `sub`, comma-separated), and `BNET_CLIENT_ID` /
`BNET_CLIENT_SECRET`: the Battle.net app "Ravenpost" on develop.battle.net,
its redirect URL `https://ravenpost-inbox.vercel.app/api/login/callback`.

Elsewhere: wow-data's `INBOX_URL` variable and `INBOX_TOKEN` secret (the same
as here), and this repository's `INBOX_URL` variable, which release builds
need (`scripts/build.sh`).

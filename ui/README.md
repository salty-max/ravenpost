# Ravenpost's shared UI

A package of its own in the Ravenpost repository, begun for the plan in
`../../ideas/watchtower-inbox.md` (a Mac app and a phone PWA drawing the same
pages). So far it holds one file:

- `src/schema.ts`: the owner API's answers (`/api/owner/*`, see
  `../inbox/README.md`) as zod schemas, every object strict. The inbox types
  its answers by them (type imports only: nothing of `ui/` is deployed with
  it) and its tests parse every answer against them; a screen that reads the
  API checks what it gets against the same ones. A new field is a line here
  first, and never one that names a player, an install or a secret
  (`test/schema.test.ts` walks the field names).

```bash
bun install
bun run check    # typecheck, tests
```

# Ravenpost's page

The page players land on before they download Ravenpost: what it is, the
downloads, why Windows and macOS warn about an unsigned app and how to get
past it, what it sends and never does, the addons it works with, questions,
Ko-fi. Astro, TypeScript and Tailwind, built to static HTML. Its own Vercel
project (`ravenpost-site`, scope jellycat, root directory `site`):
https://ravenpost-site.vercel.app.

- `src/data.ts`: the links, the release's file names (release.yml's) and the
  family's addons (addons.go's `familyAddons`). An addon added there goes
  here too.
- `src/scripts/downloads.ts`: the one script. The download links point at
  the latest release's page in the HTML, and at the files themselves once
  GitHub's API answers, the visitor's system first. Nothing breaks without it.
- `src/styles/global.css`: the window's look (`frontend/src/index.css`'s
  tokens, `.panel`, `.title`, `.btn`), dark like the window and the inbox's
  dashboard. A change of the window's tokens comes here too.
- `vercel.json`: the headers. The CSP allows only the site's own files and
  GitHub's API, so nothing is inlined (`astro.config.mjs`) and
  `scripts/csp.ts` checks the build for it.

```bash
bun install
bun run dev      # http://localhost:4321
bun run check    # astro check, the build, the CSP check (scripts/check.sh runs it)
```

The copy follows the app's README ("What it sends", "Download"): a change to
what Ravenpost sends changes both. Deploys are by hand, `vercel deploy
--prod` from `site/`, the user's go each time.

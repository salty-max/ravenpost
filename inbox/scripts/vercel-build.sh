#!/usr/bin/env bash
# Vercel build (Build Output API v3): the inbox as one Node function, every
# path to it.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${OUT:-.vercel/output}
# (the phone app: a stamped copy of Watchtower's build, committed in public/app by
# `bun scripts/ui-sync.ts` in that repository, checked by scripts/check-app.ts. This build only
# copies it, and refuses when it is not there, so a deploy never ships an empty /stats/next)
APP=${APP:-public/app}
[ -f "$APP/index.html" ] || { echo "the phone app is not here: run 'bun scripts/ui-sync.ts' in the watchtower repository first" >&2; exit 1; }
[ "$APP" != public/app ] || bun scripts/check-app.ts || { echo "the phone app here is not the stamped copy: run 'bun scripts/ui-sync.ts' in the watchtower repository" >&2; exit 1; }
rm -rf "$OUT" && mkdir -p "$OUT/functions/api.func" "$OUT/static"
# (the app's files: its manifest, service worker, icons, served as they are)
cp -R public/. "$OUT/static/"
[ "$APP" = public/app ] || { rm -rf "$OUT/static/app" && cp -R "$APP" "$OUT/static/app"; }
bun build src/vercel.ts --target=node --format=esm --minify-syntax --outfile "$OUT/functions/api.func/index.mjs"
cat > "$OUT/functions/api.func/.vc-config.json" <<JSON
{ "runtime": "nodejs22.x", "handler": "index.mjs", "launcherType": "Nodejs", "shouldAddHelpers": false, "maxDuration": 60 }
JSON
# (the daily numbers at 05:17 UTC, the digest at 07:15 once the data jobs are
# done, CurseForge's comments, releases and downloads every 10 minutes: Vercel Cron calls with
# CRON_SECRET; the service worker never cached)
cat > "$OUT/config.json" <<JSON
{ "version": 3,
  "routes": [
    { "src": "^/sw[.]js$", "headers": { "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" }, "continue": true },
    { "src": "^/stats/next/sw[.]js$", "dest": "/app/sw.js", "headers": { "Cache-Control": "no-cache", "Service-Worker-Allowed": "/stats/next/" } },
    { "src": "^/stats/next(/.*)?$", "dest": "/app/index.html", "headers": { "Cache-Control": "no-cache" } },
    { "src": "^/app/assets/(.*)$", "headers": { "Cache-Control": "public, max-age=31536000, immutable" }, "continue": true },
    { "handle": "filesystem" },
    { "src": "^/(.*)$", "dest": "/api" }
  ],
  "crons": [{ "path": "/api/cron/stats", "schedule": "17 5 * * *" }, { "path": "/api/cron/digest", "schedule": "15 7 * * *" }, { "path": "/api/cron/curseforge", "schedule": "*/10 * * * *" }, { "path": "/api/cron/unique", "schedule": "3 * * * *" }] }
JSON
echo "vercel output ready"

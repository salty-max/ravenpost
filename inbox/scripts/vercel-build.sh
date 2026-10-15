#!/usr/bin/env bash
# Vercel build (Build Output API v3): the inbox as one Node function, every
# path to it.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=.vercel/output
rm -rf "$OUT" && mkdir -p "$OUT/functions/api.func"
bun build src/vercel.ts --target=node --format=esm --minify-syntax --outfile "$OUT/functions/api.func/index.mjs"
cat > "$OUT/functions/api.func/.vc-config.json" <<JSON
{ "runtime": "nodejs22.x", "handler": "index.mjs", "launcherType": "Nodejs", "shouldAddHelpers": false, "maxDuration": 60 }
JSON
# (the daily numbers at 05:17 UTC: Vercel Cron calls with CRON_SECRET)
cat > "$OUT/config.json" <<JSON
{ "version": 3, "routes": [{ "src": "^/(.*)$", "dest": "/api" }], "crons": [{ "path": "/api/cron/stats", "schedule": "17 5 * * *" }] }
JSON
echo "vercel output ready"

#!/usr/bin/env bash
# The window's TypeScript bindings to the Go service (service.go's Ravenpost and
# its types, the "state" event): frontend/bindings, committed. Run after
# changing what the service offers; CI fails when they are out of date.
#
#   scripts/bindings.sh
set -euo pipefail
cd "$(dirname "$0")/.."
go run github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.28 generate bindings -ts -i -clean -d frontend/bindings -silent

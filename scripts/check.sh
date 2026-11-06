#!/usr/bin/env bash
# Everything CI checks (.github/workflows/ci.yml), in one command: the
# window's build, the bindings up to date, gofmt, vet for macOS and Windows,
# the tests, the inbox's check, the page's (site/). The repository's check for the family's
# harness (git config harness.check "bash scripts/check.sh"): through
# `bun ../addon-kit/q.ts check -- bash scripts/check.sh` it stamps the tree
# the pre-push hook asks for.
set -euo pipefail
cd "$(dirname "$0")/.."

(cd frontend && bun install --frozen-lockfile && bun run build)
scripts/bindings.sh && git diff --exit-code -- frontend/bindings
test -z "$(gofmt -l .)" || { gofmt -l .; exit 1; }
go vet ./...
GOOS=windows go vet ./...
go test ./...
(cd inbox && bun install --frozen-lockfile && bun run check)
(cd site && bun install --frozen-lockfile && bun run check)

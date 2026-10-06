#!/usr/bin/env bash
# Cut a release: bump the version, check, commit, tag, push. GitHub Actions then
# builds and publishes it (.github/workflows/release.yml).
#
#   scripts/release.sh [--version X.Y.Z] NOTES.md
#
#   NOTES.md         release notes (markdown): the tag's message, then the release's
#   --version X.Y.Z  default: main.go's version, patch + 1
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="" NOTES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) NOTES="$1"; shift ;;
  esac
done
die() { echo "release: $*" >&2; exit 1; }
[ -n "$NOTES" ] && [ -s "$NOTES" ] || die "give a non-empty release notes file"

git fetch -q origin --tags
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "not on main"
[ -z "$(git status --porcelain)" ] || die "the working tree isn't clean"
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main isn't in sync with origin/main"

current=$(sed -n 's/^var version = "\(.*\)"/\1/p' main.go)
if [ -z "$VERSION" ]; then
  IFS=. read -r ma mi pa <<<"$current"
  VERSION="$ma.$mi.$((pa + 1))"
fi
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "not a version: $VERSION"
TAG="v$VERSION"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "$TAG already exists"
echo "release $TAG: $current → $VERSION"

perl -pi -e "s/^var version = \".*\"/var version = \"$VERSION\"/" main.go
test -z "$(gofmt -l .)" || die "gofmt: $(gofmt -l .)"
go vet ./... && GOOS=windows go vet ./... && go test ./...

git add -A
git diff --cached --quiet || git commit -q -m "chore(release): $TAG"
git tag -a "$TAG" --cleanup=verbatim -F "$NOTES"
git push -q origin main "$TAG"
echo "pushed $TAG"

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
FETCHED=$(git rev-parse origin/main)
[ "$(git rev-parse HEAD)" = "$FETCHED" ] || die "main isn't in sync with origin/main"

current=$(sed -n 's/^var version = "\(.*\)"/\1/p' main.go)
if [ -z "$VERSION" ]; then
  IFS=. read -r ma mi pa <<<"$current"
  VERSION="$ma.$mi.$((pa + 1))"
fi
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "not a version: $VERSION"
TAG="v$VERSION"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "$TAG already exists"
echo "release $TAG: $current → $VERSION"

# From here, a stop before the push puts everything back.
pushed=0
restore() {
  local code=$?
  [ "$code" = 0 ] || [ "$pushed" = 1 ] && return
  echo "release: stopped before the push, nothing published: putting the repository back" >&2
  git tag -d "$TAG" >/dev/null 2>&1 || true
  git reset -q --hard "$FETCHED"
  exit "$code"
}
trap restore EXIT

perl -pi -e "s/^var version = \".*\"/var version = \"$VERSION\"/" main.go
# The whole check on the bumped tree, the one pushed: q stamps it, and the
# pre-push hook refuses a tree without a stamp (harness.check: scripts/check.sh).
bun "$(git rev-parse --path-format=absolute --git-common-dir)/../../addon-kit/q.ts" check -- bash scripts/check.sh

git add -A
stamps="$(git rev-parse --path-format=absolute --git-common-dir)/harness"
[ -f "$stamps/check-$(git write-tree)" ] || die "the check didn't stamp the bumped tree (files changed while it ran?): run the release again"
git diff --cached --quiet || git commit -q -m "chore(release): $TAG"
# origin's main still the one checked (an atomic push: main and the tag, or neither)
[ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$FETCHED" ] || die "origin/main moved while the check ran: run the release again"
git tag -a "$TAG" --cleanup=verbatim -F "$NOTES"
git push --atomic -q origin main "$TAG"
pushed=1
echo "pushed $TAG"

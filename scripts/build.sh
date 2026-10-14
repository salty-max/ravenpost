#!/usr/bin/env bash
# Release build of Ravenpost (run on a Mac: the macOS app needs cgo; Bun builds
# the window's pages, embedded in each binary).
#
#   scripts/build.sh
#
# dist/ (each named by its version, main.go's: ravenpost-v0.3.0-macos.zip)
#   ravenpost-vX.Y.Z-macos.zip           Ravenpost.app (universal: a window, and the menu bar)
#   ravenpost-vX.Y.Z-windows-x64.exe     Windows (a window, and the tray), no installer
#   ravenpost-vX.Y.Z-windows-arm64.exe
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(sed -n 's/^var version = "\(.*\)"/\1/p' main.go)
WOWLOCKER=${WOWLOCKER_SERVER:-https://wow-locker.app}
HEARTHTALE=${HEARTHTALE_SERVER:-https://hearthtale.app}
# Ravenpost's inbox (inbox/README.md): its sign-in and the addons' database.
INBOX=${INBOX_URL:-}
if [ -z "$INBOX" ]; then
  echo "INBOX_URL: Ravenpost's inbox's address (https://…), for sharing what players see" >&2
  exit 1
fi
LDFLAGS="-s -w -X main.wowlockerServer=$WOWLOCKER -X main.hearthtaleServer=$HEARTHTALE -X main.inboxServer=$INBOX"
ICON=assets/icon-512.png
rm -rf dist && mkdir -p dist/tmp

# ── The window's pages (frontend/ → frontend/dist, embedded by desktop.go) ──
(cd frontend && bun install --frozen-lockfile && bun run build)

# ── macOS: universal binary in an .app bundle (macOS 11 and later, as Info.plist says) ──
export MACOSX_DEPLOYMENT_TARGET=11.0
for arch in arm64 amd64; do
  CGO_ENABLED=1 GOOS=darwin GOARCH=$arch CGO_CFLAGS="-mmacosx-version-min=11.0" CGO_LDFLAGS="-mmacosx-version-min=11.0" \
    go build -tags production -trimpath -ldflags "$LDFLAGS" -o dist/tmp/ravenpost-$arch .
done
APP=dist/tmp/Ravenpost.app
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
lipo -create -output "$APP/Contents/MacOS/ravenpost" dist/tmp/ravenpost-arm64 dist/tmp/ravenpost-amd64
ICONSET=dist/tmp/AppIcon.iconset && mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size "$ICON" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2)); [ $double -le 512 ] &&
    sips -z $double $double "$ICON" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Ravenpost</string>
  <key>CFBundleDisplayName</key><string>Ravenpost</string>
  <key>CFBundleIdentifier</key><string>app.ravenpost</string>
  <key>CFBundleExecutable</key><string>ravenpost</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <!-- a menu-bar app: in the Dock only while its window is open (dock_darwin.go) -->
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST
codesign --force --deep --sign - "$APP" # ad hoc: not notarized
(cd dist/tmp && ditto -c -k --keepParent Ravenpost.app "../ravenpost-v$VERSION-macos.zip")

# ── Windows: no console window; plain .exe downloads (nothing to unzip) ──
# Embedded resources: icon, version info (publisher, product, version) and a
# GUI manifest. An unsigned .exe without them looks even less trustworthy to
# SmartScreen / Smart App Control.
go run github.com/tc-hib/go-winres@v0.3.3 simply --arch amd64,arm64 --manifest gui \
  --icon "$ICON" \
  --product-name Ravenpost --file-description "Ravenpost: your addons' saved files to their sites" \
  --product-version "$VERSION" --file-version "$VERSION" \
  --copyright "© salty-max, MIT License" --original-filename ravenpost.exe
trap 'rm -f rsrc_windows_*.syso' EXIT
for arch in amd64 arm64; do
  name=$([ $arch = amd64 ] && echo x64 || echo arm64)
  CGO_ENABLED=0 GOOS=windows GOARCH=$arch go build -tags production -trimpath -ldflags "$LDFLAGS -H=windowsgui" -o "dist/ravenpost-v$VERSION-windows-$name.exe" .
done

rm -rf dist/tmp
ls -lh dist

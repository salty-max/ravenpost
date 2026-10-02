#!/usr/bin/env bash
# Release build of the companion (run on a Mac: the macOS app needs cgo).
#
#   WOWLOCKER_SERVER=https://wow-locker.example companion/scripts/build.sh
#
# dist/
#   wow-locker-companion-macos.zip     wow-locker.app (universal, menu bar only)
#   wow-locker-companion-windows-x64.exe / -arm64.exe
#   WowLocker-addon.zip                the addon, to unzip into Interface/AddOns
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(cd .. && pwd)
VERSION=$(sed -n 's/^var version = "\(.*\)"/\1/p' main.go)
SERVER=${WOWLOCKER_SERVER:-}
LDFLAGS="-s -w"
[ -n "$SERVER" ] && LDFLAGS="$LDFLAGS -X main.defaultServer=$SERVER"
[ -z "$SERVER" ] && echo "warning: WOWLOCKER_SERVER not set, the default server stays localhost" >&2
rm -rf dist && mkdir -p dist/tmp

# ── macOS: universal binary in an .app bundle ──
for arch in arm64 amd64; do
  CGO_ENABLED=1 GOOS=darwin GOARCH=$arch go build -trimpath -ldflags "$LDFLAGS" -o dist/tmp/wow-locker-$arch .
done
APP=dist/tmp/wow-locker.app
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
lipo -create -output "$APP/Contents/MacOS/wow-locker" dist/tmp/wow-locker-arm64 dist/tmp/wow-locker-amd64
ICONSET=dist/tmp/AppIcon.iconset && mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size "$ROOT/apps/web/public/pwa-512.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2)); [ $double -le 512 ] &&
    sips -z $double $double "$ROOT/apps/web/public/pwa-512.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>wow-locker</string>
  <key>CFBundleDisplayName</key><string>wow-locker</string>
  <key>CFBundleIdentifier</key><string>app.wow-locker.companion</string>
  <key>CFBundleExecutable</key><string>wow-locker</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST
codesign --force --deep --sign - "$APP" # ad hoc: not notarized
(cd dist/tmp && ditto -c -k --keepParent wow-locker.app ../wow-locker-companion-macos.zip)

# ── Windows: no console window; plain .exe downloads (nothing to unzip) ──
for arch in amd64 arm64; do
  name=$([ $arch = amd64 ] && echo x64 || echo arm64)
  CGO_ENABLED=0 GOOS=windows GOARCH=$arch go build -trimpath -ldflags "$LDFLAGS -H=windowsgui" -o "dist/wow-locker-companion-windows-$name.exe" .
done

# ── the addon ──
(cd "$ROOT/addon" && zip -qr "$OLDPWD/dist/WowLocker-addon.zip" WowLocker)

rm -rf dist/tmp
ls -lh dist

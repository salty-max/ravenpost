# Ravenpost icon

The painted variant matches the fantasy illustration style of WoWLocker and
Hearthtale: a raven courier carrying a parchment envelope sealed with crimson
wax and a gold star.

- `icon-painted-master.png`: original full-resolution generated artwork.
- `icon-painted-1024.png`: 1024px square export.
- `icon-painted-512.png`: 512px square export for app packaging.
- `icon-painted-128.png`: 128px export for the settings header.
- `icon-painted-preview-64.png`: small-size readability preview.
- `icon-painted-prompt.json`: prompt and style references; generated with the
  built-in image generation tool.

In use since 0.2.1: `icon-512.png` (the app icon: macOS .icns, Windows .exe) and
the root `icon.png` (the settings page header) are the painted icon with rounded
corners (22 % radius, transparent), made from `icon-painted-1024.png`:

    magick icon-painted-1024.png -resize 512x512 \( -size 512x512 xc:none -fill white \
      -draw "roundrectangle 0,0,511,511,112,112" \) -alpha set -compose DstIn -composite icon-512.png

The tray icon stays drawn in code (`icon.go`, a sealed letter): macOS menu-bar
icons are one-colour silhouettes, and a painting doesn't read at 16 px.

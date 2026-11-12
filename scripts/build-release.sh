#!/bin/sh
# Builds dist-release/evernote-desktop-<version>-linux-x64.zip: Electron runtime + app + installer.
# Run from anywhere. Needs: node, zip, and `npm install` already done (for the Electron runtime).
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
VER=$(node -p "require('./package.json').version")
NAME="evernote-desktop-$VER-linux-x64"
OUT="dist-release/$NAME"

[ -x node_modules/electron/dist/electron ] || { echo "Electron runtime missing: run npm install first"; exit 1; }

rm -rf "dist-release/$NAME" "dist-release/$NAME.zip"
mkdir -p "$OUT/app"
cp -a node_modules/electron/dist/. "$OUT/app/"
mv "$OUT/app/electron" "$OUT/app/evernote-desktop"
rm -f "$OUT/app/resources/default_app.asar"
# Keep only the English UI strings (Chromium falls back to en-US): saves ~7 MB.
find "$OUT/app/locales" -name '*.pak' ! -name 'en-US.pak' -delete

mkdir -p "$OUT/app/resources/app/assets"
cp main.js "$OUT/app/resources/app/"
cp assets/icon.png assets/tray.png "$OUT/app/resources/app/assets/"
node -e "const p=require('./package.json');require('fs').writeFileSync('$OUT/app/resources/app/package.json',JSON.stringify({name:p.name,version:p.version,main:'main.js',license:p.license},null,2))"

cp release/install.sh release/uninstall.sh release/README.txt LICENSE "$OUT/"
cp assets/icon.png "$OUT/icon.png"

(cd dist-release && zip -qry "$NAME.zip" "$NAME")
echo "Built dist-release/$NAME.zip ($(du -h "dist-release/$NAME.zip" | cut -f1))"

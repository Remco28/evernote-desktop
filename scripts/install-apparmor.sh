#!/bin/sh
# Run this yourself (needs sudo): installs + loads the AppArmor profile for this checkout's Electron.
set -e
DIR=$(cd "$(dirname "$0")/.." && pwd)
ELECTRON="$DIR/node_modules/electron/dist/electron"
[ -x "$ELECTRON" ] || { echo "Electron binary not found at $ELECTRON (run npm install)"; exit 1; }
sed "s|@ELECTRON_PATH@|$ELECTRON|" "$DIR/scripts/apparmor/evernote-desktop.template" | sudo tee /etc/apparmor.d/evernote-desktop >/dev/null
sudo apparmor_parser -r /etc/apparmor.d/evernote-desktop
echo "AppArmor profile loaded for $ELECTRON. Launch Evernote from your app menu."

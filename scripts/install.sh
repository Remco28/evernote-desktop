#!/bin/sh
# Installs a launcher entry (app menu / dock) for this checkout. Pass --autostart to also start at login.
set -e
DIR=$(cd "$(dirname "$0")/.." && pwd)
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor/512x512/apps"
mkdir -p "$APPS" "$ICONS"
cp "$DIR/assets/icon.png" "$ICONS/evernote-desktop.png"

cat > "$APPS/evernote-desktop.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Evernote
Comment=Evernote in a dedicated, always-logged-in window
Exec=$DIR/bin/evernote-desktop %U
Icon=evernote-desktop
Terminal=false
Categories=Office;
StartupWMClass=evernote-desktop
StartupNotify=true
DESK

if [ "$1" = "--autostart" ]; then
  mkdir -p "$HOME/.config/autostart"
  sed "s|^Exec=.*|Exec=$DIR/bin/evernote-desktop --hidden|" "$APPS/evernote-desktop.desktop" > "$HOME/.config/autostart/evernote-desktop.desktop"
  echo "Autostart enabled (starts hidden in the tray at login)."
fi
update-desktop-database "$APPS" 2>/dev/null || true
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" || echo "warning: icon cache refresh failed"
echo "Installed. Find 'Evernote' in your app launcher."

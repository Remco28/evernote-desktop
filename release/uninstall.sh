#!/bin/sh
# Removes Evernote Desktop. Add --purge to also delete your saved login and settings.
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
PROFILE=/etc/apparmor.d/evernote-desktop-app

pkill -f "$DATA/evernote-desktop-app/evernote-desktop" 2>/dev/null || true
rm -rf "$DATA/evernote-desktop-app"
rm -f "$DATA/applications/evernote-desktop.desktop" \
      "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/evernote-desktop.desktop" \
      "$DATA/icons/hicolor/512x512/apps/evernote-desktop.png"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DATA/applications" 2>/dev/null || true

if [ -f "$PROFILE" ]; then
  echo "Removing the sandbox permission (you may be asked for your password)..."
  RM='apparmor_parser -R "$1" 2>/dev/null; rm -f "$1"'
  if [ "$(id -u)" = 0 ]; then sh -c "$RM" sh "$PROFILE"
  elif command -v pkexec >/dev/null 2>&1 && { [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; }; then pkexec sh -c "$RM" sh "$PROFILE"
  else sudo sh -c "$RM" sh "$PROFILE"; fi
fi

if [ "$1" = "--purge" ]; then
  rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/evernote-desktop"
  echo "Removed your saved Evernote login and settings."
else
  echo "Your saved login and settings were kept in ~/.config/evernote-desktop (run with --purge to delete them)."
fi
echo "Evernote Desktop removed."

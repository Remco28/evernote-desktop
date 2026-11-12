#!/bin/sh
rm -f "$HOME/.local/share/applications/evernote-desktop.desktop" \
      "$HOME/.config/autostart/evernote-desktop.desktop" \
      "$HOME/.local/share/icons/hicolor/512x512/apps/evernote-desktop.png"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "Launcher removed. Your login data stays in ~/.config/evernote-desktop (delete it to fully reset)."

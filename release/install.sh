#!/bin/sh
# Evernote Desktop (unofficial) installer. Installs for the current user only.
# It asks for your password at most once, and only if your system needs a one-time sandbox permission.
set -e

HERE=$(cd "$(dirname "$0")" && pwd)
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST="$DATA/evernote-desktop-app"
APPS="$DATA/applications"
ICONS="$DATA/icons/hicolor/512x512/apps"
PROFILE=/etc/apparmor.d/evernote-desktop-app
AUTOSTART=ask
for a in "$@"; do
  case "$a" in
    --autostart) AUTOSTART=yes ;;
    --no-autostart) AUTOSTART=no ;;
  esac
done

say() { printf '%s\n' "$*"; }

[ "$(uname -m)" = "x86_64" ] || { say "Sorry: this download is for 64-bit Intel/AMD computers (x86_64). Yours is $(uname -m)."; exit 1; }
[ -f "$HERE/app/evernote-desktop" ] || { say "Please run this from inside the unzipped folder (it should contain an 'app' folder)."; exit 1; }

say "Installing Evernote Desktop..."
rm -rf "$DEST"
mkdir -p "$DEST" "$APPS" "$ICONS"
cp -a "$HERE/app/." "$DEST/"
chmod +x "$DEST/evernote-desktop" "$DEST/chrome_crashpad_handler" 2>/dev/null || true
cp "$HERE/icon.png" "$ICONS/evernote-desktop.png"

cat > "$APPS/evernote-desktop.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Evernote
Comment=Evernote in its own window that stays logged in (unofficial)
Exec=$DEST/evernote-desktop %U
Icon=evernote-desktop
Terminal=false
Categories=Office;
StartupWMClass=evernote-desktop
StartupNotify=true
DESK
chmod 644 "$APPS/evernote-desktop.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$DATA/icons/hicolor" 2>/dev/null || true

# --- One-time sandbox permission (Ubuntu 24.04+ and derivatives restrict this by default) ---
run_admin() {
  if [ "$(id -u)" = 0 ]; then "$@"
  elif command -v pkexec >/dev/null 2>&1 && { [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; }; then pkexec "$@"
  elif command -v sudo >/dev/null 2>&1; then sudo "$@"
  else return 1
  fi
}

if [ "$EVERNOTE_SKIP_APPARMOR" != "1" ] && [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ]; then
  if [ -f "$PROFILE" ] && grep -q "$DEST/evernote-desktop" "$PROFILE" 2>/dev/null; then
    : # already allowed
  else
    say ""
    say "Your system needs a one-time permission so Evernote's browser engine can use its security sandbox."
    say "You may be asked for your password. This only lets this one app use that feature."
    TMP=$(mktemp)
    cat > "$TMP" <<PROF
# Lets Evernote Desktop use user namespaces (needed for Chromium's sandbox). Confines nothing else.
abi <abi/5.0>,
include <tunables/global>

profile evernote-desktop-app $DEST/evernote-desktop flags=(unconfined) {
  userns,
  @{exec_path} mr,

  include if exists <local/evernote-desktop-app>
}
PROF
    if run_admin sh -c 'cp "$1" "$2" && apparmor_parser -r "$2"' sh "$TMP" "$PROFILE"; then
      say "Permission granted."
    else
      rm -f "$TMP"
      say ""
      say "Could not set up the sandbox permission, so Evernote may not open."
      say "Run this installer again and enter your password when asked, or see README.txt."
      exit 1
    fi
    rm -f "$TMP"
  fi
fi

# --- Optional: start at login ---
if [ "$AUTOSTART" = "ask" ] && [ -t 0 ]; then
  printf 'Start Evernote automatically when you log in (hidden in the tray)? [y/N] '
  read -r ans || ans=n
  case "$ans" in y|Y|yes|YES) AUTOSTART=yes ;; *) AUTOSTART=no ;; esac
fi
if [ "$AUTOSTART" = "yes" ]; then
  mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
  sed "s|^Exec=.*|Exec=$DEST/evernote-desktop --hidden|" "$APPS/evernote-desktop.desktop" > "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/evernote-desktop.desktop"
  say "It will start automatically at login."
fi

say ""
say "Done! Open your app menu and look for \"Evernote\"."
say "The first time, log in as usual. After that it should keep you logged in."

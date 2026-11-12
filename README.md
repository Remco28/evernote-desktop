# evernote-desktop

<img src="assets/icon.png" width="96" align="right" alt="Elephant and penguin icon">

**An unofficial desktop window for Evernote on Linux that stays logged in.**

Evernote has no Linux client. Using the web app in a browser or PWA works, but many people (me included) get
logged out several times a day and have to find the emailed/authenticator 6-digit code again. This is a tiny
[Electron](https://www.electronjs.org/) app that opens `evernote.com` in its own window with a profile dedicated
to Evernote, and keeps the login alive.

> **Unofficial.** Not affiliated with, endorsed by, or supported by Evernote Corporation. "Evernote" is a trademark
> of its owner. This app only loads Evernote's own website; it does not modify it or talk to Evernote's API.

## Why you keep getting logged out (what I found)

Evernote's login cookie, `auth`, is short-lived: it is issued with a ~2 hour lifetime on login, and afterwards the
site silently re-issues it roughly every 40 minutes **as a session-only cookie** ("forget when the browser closes").
Browsers and PWAs discard session-only cookies when they restart, sleep, or are closed, so the next visit finds no
login cookie and sends you through login and a verification code again.

This app watches Evernote's cookies and gives any session-only cookie a 30-day lifetime, so your login survives
restarts, sleep, and logging out of your desktop. It is a small change, but it is the whole trick.

Observed on Ubuntu 26.04 (GNOME, Wayland): after a normal login, logging out of the desktop and back in did not ask
for a code again. See [Status](#status) for what is and isn't proven.

## Features

- Dedicated, permanent profile for Evernote only (`~/.config/evernote-desktop`).
- Session-only Evernote cookies become 30-day cookies (the fix above).
- Background renewal: if the short-lived `auth` cookie has lapsed but the 30-day SSO session is still valid, a hidden
  window re-issues it, and the visible window recovers from the login page by itself. Also runs at startup and after
  suspend/unlock.
- System tray icon; closing the window hides it (toggle in the File menu).
- Metadata-only event log so you can see exactly why a login was ever needed.
- **File > Test: simulate expired login** to check on your own machine that Evernote renews without credentials.
- Single instance, remembers window size, opens external links in your default browser, restricts permissions to
  evernote.com, renderer sandbox on.

## Install

Requirements: Linux, Node.js 20+ (npm). Tested on Ubuntu 26.04.

```sh
git clone https://github.com/Remco28/evernote-desktop.git
cd evernote-desktop
npm install
npm start                          # try it
npm run install-launcher           # add "Evernote" to your app menu
sh scripts/install.sh --autostart  # optional: also start hidden in the tray at login
```

If `npm install` skips Electron's binary download (newer npm gates install scripts), run
`node node_modules/electron/install.js` once.

### Ubuntu 24.04+ / 26.04: one-time AppArmor step

Ubuntu restricts unprivileged user namespaces, which Chromium's sandbox needs. Launched from the desktop, Electron
then dies with `The SUID sandbox helper binary was found, but is not configured correctly`. Fix it once with a tiny
AppArmor profile that allows user namespaces for this one binary (same shape as Ubuntu's own Obsidian profile):

```sh
sh scripts/install-apparmor.sh    # needs sudo; writes /etc/apparmor.d/evernote-desktop
```

Please read the script first. I'd rather you do that than run `--no-sandbox`, which turns off Chromium's sandbox for a
window that renders a remote website.

To remove everything: `npm run uninstall-launcher`, delete `/etc/apparmor.d/evernote-desktop` (then
`sudo apparmor_parser -R` it), and delete `~/.config/evernote-desktop`.

## Using it

Tray icon / File menu: **Renew session now**, **Open log folder**, **Close window to tray**, and
**Test: simulate expired login**. Press Alt to show the menu bar.

If you are ever asked to log in again, open `~/.config/evernote-desktop/events.log`. Look for `LOGIN REQUIRED`,
the `renewal probe` lines before it, and `cookie -auth` / `cookie -evernote-session` with their `cause=`. That
shows whether a cookie expired, was evicted, or Evernote refused the renewal. Issues with that log attached are very
welcome.

## Privacy and security

- **Your password is never stored or read by this app.** You log in on Evernote's own page.
- Your session cookies are stored in the app's profile folder (`~/.config/evernote-desktop`) like any browser stores
  them. Anyone who can read that folder can use your session, so keep your account and disk protected as usual.
- The log records cookie names, domains, expiry times and page paths only. Never cookie values, query strings or
  note content.
- The app makes no network requests of its own: only the Evernote website's, in its window.
- The AppArmor profile confines nothing; it only grants `userns` to this app's Electron binary.

## Status

Works for me. What is **not** proven: how long Evernote's servers accept a cookie that the app has kept for 30 days.
If Evernote changes its login flow, this can stop working. Reports from other setups (other distros, X11, other
Evernote account types, accounts using an authenticator app vs. emailed codes) are the most useful thing you can send.

Not built, and probably not needed if the above holds: credential auto-fill and auto-reading the emailed code.

## Rebuilding the icon

The icon (elephant with a Linux penguin) was generated with ChatGPT; the raster original is
`assets/source/logo-elephant-penguin.png`.

```sh
python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements-tools.txt   # once
.venv/bin/python scripts/vectorize-logo.py assets/source/logo-elephant-penguin.png  # clean + trace -> assets/icon.svg
./node_modules/electron/dist/electron --no-sandbox scripts/render-svg.js            # -> assets/icon.png + tray.png
```

## License

MIT, see [LICENSE](LICENSE). Icon artwork was AI-generated and is included under the same license.

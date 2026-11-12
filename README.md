# Evernote Desktop for Linux

<img src="assets/icon.png" width="96" align="right" alt="Elephant and penguin icon">

**An unofficial desktop window for Evernote that keeps you logged in.**

Evernote has no Linux app, and its website keeps logging you out and asking for a 6-digit code. This opens
Evernote in its own window and fixes that.

> Not affiliated with or endorsed by Evernote. It just opens Evernote's own website; it doesn't modify it or use
> Evernote's API.

## Install

1. Download the latest **evernote-desktop-…-linux-x64.zip** from the
   [Releases page](https://github.com/Remco28/evernote-desktop/releases/latest) (no GitHub account needed).
2. Unzip it, right-click an empty spot in the new folder, choose **Open in Terminal**, and run:

   ```sh
   sh install.sh
   ```

3. Open your app menu, search for **Evernote**, and log in once.

On Ubuntu 24.04 and newer you'll be asked for your password once. That's a permission for the app's security
sandbox, and it applies to this app only. To remove everything later, run `sh uninstall.sh` in the same folder.

Needs a 64-bit Intel/AMD computer. No Node.js or other software required.

## What it does

- Keeps you signed in through restarts, sleep, and logging out of your desktop.
- Lives in the system tray; closing the window hides it (File menu > *Close window to tray* to change).
- Starts at login if you choose (the installer asks).

**Why you were being logged out:** Evernote re-issues its login cookie every ~40 minutes as a *session-only*
cookie, which browsers throw away whenever they restart or sleep. This app keeps your 30-day sign-in cookie,
and gets a fresh login cookie from it whenever the short one lapses. After the computer has been asleep for an
hour or more, it renews the login before the Evernote page wakes up, because Evernote answers an out-of-date
login by signing you out completely.

## If you get logged out anyway

Press **Alt** to show the menu bar, then **File > Open log folder** and open `events.log`. Look for
`LOGIN REQUIRED` and the lines just before it. They show whether a cookie expired or Evernote refused to renew.
Lines starting with `wake` and `http` show what happened after sleep and which Evernote address signed you out.
**File > Test: simulate expired login** and **File > Test: simulate waking from a long sleep** check that renewal
works on your machine.

## Privacy

- Your password is never stored or read by this app. You log in on Evernote's own page.
- Login cookies are kept in `~/.config/evernote-desktop`, the same way a browser keeps them. Anyone who can read
  that folder can use your session.
- The log holds cookie names, expiry times and page paths only: never cookie values or note content.

## Compatibility

Built and tested on Ubuntu 26.04 (GNOME, Wayland). It should work on other mainstream x86_64 distros, but I haven't
tested them. On GNOME without the AppIndicator extension there is no tray icon; closing the window hides the app,
and opening Evernote from the app menu brings it back.

This is a hobby project provided as-is, without support, so GitHub Issues are turned off.

What isn't proven yet: how long Evernote's servers accept a cookie kept for 30 days. If Evernote changes its login,
this could stop working.

## Run from source

```sh
git clone https://github.com/Remco28/evernote-desktop.git && cd evernote-desktop
npm install && npm start
sh scripts/install-apparmor.sh   # Ubuntu 24.04+, once (needs sudo)
sh scripts/build-release.sh      # builds the zip in dist-release/
```

## License

MIT, see [LICENSE](LICENSE). The icon was AI-generated and is included under the same license.

'use strict';

/*
 * evernote-desktop: a dedicated, persistent window for https://www.evernote.com
 *
 * Why it exists: Evernote's web login cookie (`auth`) only lives for ~2 hours and is silently
 * renewed from a 30-day SSO cookie (`evernote-session`). Browsers/PWAs on this machine lose that
 * renewal and fall back to the login + 6-digit-code screen. This app:
 *   1. keeps ONE permanent profile used only for Evernote,
 *   2. turns any session-only Evernote cookie into a persistent one, EXCEPT the 2-hour login cookies,
 *      which are kept only as long as Evernote's server honors them (a stale `auth` sent after a long
 *      sleep is answered by Evernote ending the whole 30-day session: seen 2026-11-12),
 *   3. renews the 2-hour `auth` cookie from the long-lived session in the background, and after a long
 *      sleep renews it BEFORE the page wakes up and talks to Evernote,
 *   4. logs (metadata only, never cookie values) exactly what happened if a login is ever needed.
 */

const { app, BrowserWindow, Tray, Menu, Notification, dialog, session, shell, powerMonitor, nativeImage, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// ---------- config ----------
const APP_URL = 'https://www.evernote.com/client/web';
const PERSIST_DAYS = 30; // lifetime given to cookies that arrive as session-only
const CHECK_EVERY_MS = 2 * 60 * 1000; // how often we look at whether `auth` is still present
const PROBE_TIMEOUT_MS = 25 * 1000; // how long the hidden renewal window gets to produce a fresh `auth`
const PROBE_COOLDOWN_MS = 10 * 60 * 1000; // minimum gap between renewal attempts
// Evernote's login token behind `auth` is good for ~2 hours on the server (a fresh login sets
// exactly 2h; the page re-issues it every ~40 min while awake). These cookies are only kept that long.
const AUTH_COOKIES = new Set(['auth', 'userdata_loggedIn']);
const AUTH_KEEP_MS = 100 * 60 * 1000; // a little under the server's 2 hours
const LONG_SLEEP_MS = 60 * 60 * 1000; // asleep at least this long: renew before letting the page run
const NETWORK_WAIT_MS = 60 * 1000; // after waking, how long to wait for the network to come back
const ALLOWED_POPUP_HOSTS = [/(^|\.)evernote\.com$/, /(^|\.)google\.com$/, /(^|\.)apple\.com$/];
const LOGGED_COOKIES = new Set([
  'auth', 'userdata_loggedIn', 'evernote-session', 'session_info', 'lastAuthentication', 'clipper-sso',
  'evernote-local-storage-id', 'evernote-openid',
]);

const START_HIDDEN = process.argv.includes('--hidden'); // used by the start-at-login entry

// Test hooks (used for smoke testing without touching the real profile).
if (process.env.EVERNOTE_USER_DATA) app.setPath('userData', process.env.EVERNOTE_USER_DATA);

// Look like plain Chrome: drop the "Electron/x" and app-name tokens from the UA.
app.userAgentFallback = app.userAgentFallback
  .replace(/\s+Electron\/\S+/, '')
  .replace(/\s+evernote-desktop\/\S+/, '');
app.setDesktopName('evernote-desktop.desktop');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

// ---------- small helpers ----------
const isEvernoteHost = (h) => /(^|\.)evernote\.com$/.test(h || '');
const userDir = () => app.getPath('userData');
const logPath = () => path.join(userDir(), 'events.log');
const settingsPath = () => path.join(userDir(), 'settings.json');

function log(msg) {
  try {
    fs.mkdirSync(userDir(), { recursive: true });
    fs.appendFileSync(logPath(), `${new Date().toISOString()} ${msg}\n`);
  } catch { /* logging must never break the app */ }
}

function trimLog() {
  try {
    if (fs.statSync(logPath()).size > 1_000_000) {
      const tail = fs.readFileSync(logPath(), 'utf8').split('\n').slice(-3000).join('\n');
      fs.writeFileSync(logPath(), tail);
    }
  } catch { /* no log yet */ }
}

let settings = { closeToTray: true, bounds: { width: 1280, height: 860 } };
function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch { /* defaults */ }
}
function saveSettings() {
  try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch { /* ignore */ }
}

// Strip query/hash: they can hold tokens. We only ever log host + path.
function safeUrl(u) {
  try {
    const p = new URL(u);
    return /^https?:$/.test(p.protocol) ? `${p.host}${p.pathname}` : p.protocol;
  } catch { return '(unparseable)'; }
}

const fmtExp = (c) => (c.session || !c.expirationDate ? 'SESSION' : new Date(c.expirationDate * 1000).toISOString());

// ---------- state ----------
let win = null;
let tray = null;
let quitting = false;
let flushedOnQuit = false;
let probing = false;
let lastProbeAt = 0;
let loginNoticeShown = false;
let firstWindowCreated = false; // only the very first window may start hidden (--hidden)
let suspendedAt = 0; // when powerMonitor said we were going to sleep
let lastTick = Date.now(); // heartbeat: a big gap between ticks means the machine was asleep
let wakeHandling = false;

// ---------- cookie persistence + logging ----------
function watchCookies(ses) {
  ses.cookies.on('changed', (_event, cookie, cause, removed) => {
    if (!isEvernoteHost(cookie.domain.replace(/^\./, ''))) return;

    if (LOGGED_COOKIES.has(cookie.name) || (cookie.session && !removed)) {
      log(`cookie ${removed ? '-' : '+'}${cookie.name} domain=${cookie.domain} exp=${fmtExp(cookie)} cause=${cause}`);
    }

    // Session-only cookie arriving -> give it a real expiry so it survives restarts.
    if (!removed && cookie.session) {
      const host = cookie.domain.replace(/^\./, '');
      const details = {
        url: `https://${host}${cookie.path || '/'}`,
        name: cookie.name,
        value: cookie.value,
        path: cookie.path || '/',
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expirationDate: Math.floor((Date.now() + (AUTH_COOKIES.has(cookie.name) ? AUTH_KEEP_MS : PERSIST_DAYS * 86400_000)) / 1000),
      };
      if (!cookie.hostOnly) details.domain = cookie.domain;
      ses.cookies.set(details).then(
        () => log(`promoted session cookie ${cookie.name} (${cookie.domain}) to ${AUTH_COOKIES.has(cookie.name) ? `${AUTH_KEEP_MS / 60000}min` : `${PERSIST_DAYS}d`}`),
        (err) => log(`promote FAILED for ${cookie.name}: ${err.message}`),
      );
    }
  });
}

async function evernoteCookies(ses, name) {
  const all = await ses.cookies.get({ name });
  return all.filter((c) => isEvernoteHost(c.domain.replace(/^\./, '')));
}

async function removeCookie(ses, c) {
  await ses.cookies.remove(`https://${c.domain.replace(/^\./, '')}${c.path || '/'}`, c.name);
}

// Versions before 2026-11-12 kept `auth` for 30 days. Such a cookie outlives the server's token, so drop it.
async function dropLegacyAuth(ses) {
  const limit = Date.now() / 1000 + 2 * 3600 + 300; // nothing Evernote issues lives longer than 2h
  for (const name of AUTH_COOKIES) {
    for (const c of await evernoteCookies(ses, name)) {
      if (!c.session && c.expirationDate > limit) {
        log(`dropping over-long ${name} cookie (exp=${fmtExp(c)}) left by an older version`);
        await removeCookie(ses, c);
      }
    }
  }
}

// Diagnostics: which Evernote URL set or cleared a login cookie, and any 401/403. Names, status and path
// only: never cookie values or query strings.
function watchResponses(ses) {
  ses.webRequest.onHeadersReceived({ urls: ['https://*.evernote.com/*'] }, (d, cb) => {
    try {
      const setCookies = Object.entries(d.responseHeaders || {})
        .filter(([k]) => k.toLowerCase() === 'set-cookie').flatMap(([, v]) => v);
      const touched = [];
      for (const sc of setCookies) {
        const name = sc.split('=')[0].trim();
        if (!LOGGED_COOKIES.has(name)) continue;
        const exp = /;\s*expires=([^;]+)/i.exec(sc);
        const maxAge = /;\s*max-age=(-?\d+)/i.exec(sc);
        const cleared = (maxAge && Number(maxAge[1]) <= 0) || (exp && Date.parse(exp[1]) < Date.now());
        touched.push(`${cleared ? '-' : '+'}${name}`);
      }
      if (touched.length || d.statusCode === 401 || d.statusCode === 403) {
        log(`http ${d.statusCode} ${d.method} ${safeUrl(d.url)} type=${d.resourceType}${touched.length ? ` cookies=${touched.join(',')}` : ''}`);
      }
    } catch { /* diagnostics must never break requests */ }
    cb({});
  });
}

// ---------- background session renewal ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const onLoginHost = (url) => { try { return /^accounts\./.test(new URL(url).host); } catch { return false; } };

// Returns true (a valid `auth` cookie exists afterwards), false (a real login is needed),
// or null (nothing to do / skipped).
async function renewIfNeeded(reason, { force = false } = {}) {
  if (probing) return null;
  const ses = session.defaultSession;
  const [auth, sso] = await Promise.all([evernoteCookies(ses, 'auth'), evernoteCookies(ses, 'evernote-session')]);

  if (auth.length && !force) { loginNoticeShown = false; return true; } // still logged in
  if (!sso.length && !force) return null; // never logged in / fully logged out: nothing to renew from
  if (!force && Date.now() - lastProbeAt < PROBE_COOLDOWN_MS) return null;

  probing = true;
  lastProbeAt = Date.now();
  log(`renewal probe START reason=${reason} haveAuth=${auth.length > 0} haveSso=${sso.length > 0}`);

  // A hidden window sharing the app's session: visiting the app makes Evernote's own login
  // machinery re-issue `auth` from the long-lived `evernote-session` cookie, if it will.
  const probe = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { backgroundThrottling: false } });
  let ok = false;
  try {
    probe.loadURL(APP_URL).catch(() => {}); // redirects can abort the first load; we judge by cookies
    const deadline = Date.now() + PROBE_TIMEOUT_MS;
    while (Date.now() < deadline && !probe.isDestroyed()) {
      await sleep(500);
      if ((await evernoteCookies(ses, 'auth')).length) { ok = true; break; }
    }
    if (ok) await sleep(1500); // let the companion cookies land
    const finalUrl = probe.isDestroyed() ? '' : probe.webContents.getURL();
    const authAfter = await evernoteCookies(ses, 'auth');
    log(`renewal probe END renewed=${ok} landed=${safeUrl(finalUrl)} authNow=${authAfter.length ? fmtExp(authAfter[0]) : 'none'}`);
    if (ok) {
      loginNoticeShown = false;
      // The visible window may be stuck on the login page from before the renewal: bring it back.
      if (win && !win.isDestroyed() && onLoginHost(win.webContents.getURL())) {
        log('renewed while main window was on the login page: reloading app');
        win.loadURL(APP_URL);
      }
    } else {
      notifyLoginNeeded();
    }
  } catch (err) {
    log(`renewal probe ERROR ${err.message}`);
  } finally {
    if (!probe.isDestroyed()) probe.destroy();
    probing = false;
  }
  return ok;
}

// Test helper (File menu): drop the 2-hour cookies exactly as natural expiry would, then see whether
// Evernote re-issues them from the 30-day session without asking for credentials.
async function simulateExpiry() {
  const ses = session.defaultSession;
  log('TEST simulate expiry: removing auth + userdata_loggedIn');
  for (const name of AUTH_COOKIES) {
    for (const c of await evernoteCookies(ses, name)) await removeCookie(ses, c);
  }
  const ok = await renewIfNeeded('simulate', { force: true });
  log(`TEST simulate expiry RESULT renewed=${ok}`);
  if (win && !win.isDestroyed()) win.loadURL(APP_URL);
  dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
    type: ok ? 'info' : 'warning',
    message: ok ? 'Renewal worked: no sign-in needed.' : 'Renewal failed: Evernote wants you to sign in again.',
    detail: ok ? 'The 2-hour login cookie was re-issued from your 30-day session.' : 'Details are in the log (File > Open log folder).',
  });
}

// ---------- waking from sleep ----------
// After a long sleep the page would immediately send its old login token, and Evernote answers a stale
// token by ending the whole session. So: take the page off Evernote first, drop the 2-hour cookies,
// wait for the network, renew from the 30-day session in a hidden window, and only then reload the page.
const PARKED_PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent(
  '<body style="font:15px system-ui,sans-serif;color:#555;display:grid;place-items:center;height:90vh">Reconnecting to Evernote…</body>');

async function waitForNetwork() {
  const deadline = Date.now() + NETWORK_WAIT_MS;
  while (!net.isOnline() && Date.now() < deadline) await sleep(1000);
  const online = net.isOnline();
  if (online) await sleep(2000); // DNS and Wi-Fi often need a moment more
  return online;
}

async function handleWake(reason, sleptMs) {
  if (wakeHandling) return;
  wakeHandling = true;
  suspendedAt = 0;
  const ses = session.defaultSession;
  let parked = false;
  try {
    const [auth, sso] = await Promise.all([evernoteCookies(ses, 'auth'), evernoteCookies(ses, 'evernote-session')]);
    log(`wake reason=${reason} slept=${Math.round(sleptMs / 60000)}min auth=${auth.length ? fmtExp(auth[0]) : 'none'} session=${sso.length ? fmtExp(sso[0]) : 'none'}`);
    if (sleptMs < LONG_SLEEP_MS) {
      if (await waitForNetwork()) await renewIfNeeded(reason);
      return;
    }
    if (win && !win.isDestroyed() && isEvernoteHost(safeUrl(win.webContents.getURL()).split('/')[0])) {
      win.webContents.stop();
      win.loadURL(PARKED_PAGE);
      parked = true;
    }
    for (const name of AUTH_COOKIES) {
      for (const c of await evernoteCookies(ses, name)) await removeCookie(ses, c);
    }
    const online = await waitForNetwork();
    log(`wake: page ${parked ? 'parked' : 'not open'}, 2h cookies dropped, network ${online ? 'up' : 'still down'}`);
    while (probing) await sleep(500);
    if (online && sso.length) await renewIfNeeded(reason, { force: true });
    else if (!sso.length) log('wake: no 30-day session cookie left to renew from');
  } catch (err) {
    log(`wake ERROR ${err.message}`);
  } finally {
    lastTick = Date.now();
    wakeHandling = false;
    if (parked && win && !win.isDestroyed()) win.loadURL(APP_URL);
  }
}

function notifyLoginNeeded() {
  if (loginNoticeShown) return;
  loginNoticeShown = true;
  log('LOGIN REQUIRED: server did not renew the session');
  if (Notification.isSupported()) {
    const n = new Notification({ title: 'Evernote needs you to sign in', body: 'The session could not be renewed automatically.' });
    n.on('click', showWindow);
    n.show();
  }
}

// ---------- window / tray / menu ----------
function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow({ deferLoad = false } = {}) {
  win = new BrowserWindow({
    ...settings.bounds,
    title: 'Evernote',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    show: !(START_HIDDEN && tray && !firstWindowCreated),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' && ALLOWED_POPUP_HOSTS.some((re) => re.test(u.hostname))) {
        return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, parent: win } };
      }
      if (['http:', 'https:', 'mailto:'].includes(u.protocol)) shell.openExternal(url);
    } catch { /* ignore bad URLs */ }
    return { action: 'deny' };
  });

  wc.on('did-navigate', (_e, url) => log(`nav ${safeUrl(url)}`));
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => { if (isMain) log(`load FAILED ${code} ${desc} ${safeUrl(url)}`); });
  wc.on('render-process-gone', (_e, d) => log(`renderer gone: ${d.reason}`));

  const saveBounds = () => { if (!win.isMaximized() && !win.isMinimized()) { settings.bounds = win.getBounds(); saveSettings(); } };
  win.on('resized', saveBounds);
  win.on('moved', saveBounds);
  win.on('close', (e) => {
    if (!quitting && settings.closeToTray && tray) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });

  firstWindowCreated = true;
  if (!deferLoad) win.loadURL(APP_URL);
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win?.webContents.reload() },
        { label: 'Renew session now', click: () => renewIfNeeded('manual', { force: true }) },
        { label: 'Close window to tray', type: 'checkbox', checked: settings.closeToTray, click: (i) => { settings.closeToTray = i.checked; saveSettings(); } },
        { label: 'Open log folder', click: () => shell.showItemInFolder(logPath()) },
        { label: 'Test: simulate expired login', click: () => simulateExpiry().catch((e) => log(`simulate error ${e.message}`)) },
        { label: 'Test: simulate waking from a long sleep', click: () => handleWake('simulate-sleep', LONG_SLEEP_MS) },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' }, { role: 'toggleDevTools' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')).resize({ width: 22, height: 22 });
    tray = new Tray(img);
    tray.setToolTip('Evernote');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show Evernote', click: showWindow },
      { label: 'Renew session now', click: () => renewIfNeeded('manual', { force: true }) },
      { label: 'Open log folder', click: () => shell.showItemInFolder(logPath()) },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showWindow);
  } catch (err) {
    log(`tray unavailable: ${err.message}`);
    tray = null; // without a tray, closing the window really closes it
  }
}

// ---------- permissions ----------
function setupPermissions(ses) {
  const ok = new Set(['clipboard-read', 'clipboard-sanitized-write', 'notifications', 'media', 'fullscreen', 'persistent-storage']);
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    let host = '';
    try { host = new URL(wc.getURL()).hostname; } catch { /* leave empty */ }
    cb(isEvernoteHost(host) && ok.has(permission));
  });
}

// ---------- lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.on('before-quit', (e) => {
    quitting = true;
    if (flushedOnQuit) return;
    e.preventDefault();
    flushedOnQuit = true;
    log('quit: flushing cookie store');
    session.defaultSession.cookies.flushStore().finally(() => app.quit());
  });

  app.whenReady().then(() => {
    trimLog();
    loadSettings();
    log(`start electron=${process.versions.electron} chrome=${process.versions.chrome}`);

    const ses = session.defaultSession;
    watchCookies(ses);
    watchResponses(ses);
    setupPermissions(ses);
    buildMenu();
    createTray();
    // Renew first if the 2h cookie lapsed while the app was closed, so the page opens logged in.
    createWindow({ deferLoad: true });
    dropLegacyAuth(ses)
      .catch((e) => log(`legacy auth cleanup error ${e.message}`))
      .then(() => renewIfNeeded('startup'))
      .catch((e) => log(`startup renew error ${e.message}`))
      .finally(() => { if (win && !win.isDestroyed() && !win.webContents.getURL()) win.loadURL(APP_URL); });

    setInterval(() => renewIfNeeded('timer').catch((e) => log(`renew error ${e.message}`)), CHECK_EVERY_MS);
    setInterval(() => ses.cookies.flushStore().catch(() => {}), 60 * 1000);
    powerMonitor.on('suspend', () => { suspendedAt = Date.now(); log('suspend'); });
    powerMonitor.on('resume', () => handleWake('resume', Date.now() - (suspendedAt || lastTick)));
    powerMonitor.on('unlock-screen', () => renewIfNeeded('unlock').catch(() => {}));
    // Backup for a missed resume event: timers stop while asleep, so a long gap between ticks means we slept.
    setInterval(() => {
      const now = Date.now();
      const gap = now - lastTick;
      lastTick = now;
      if (gap >= LONG_SLEEP_MS) handleWake('clock-jump', gap);
    }, 15 * 1000);

    // Smoke-test hook: run for N ms, print status, quit.
    if (process.env.EVERNOTE_SMOKE_WAKE_MS) {
      setTimeout(() => handleWake('smoke', LONG_SLEEP_MS), Number(process.env.EVERNOTE_SMOKE_WAKE_MS));
    }
    if (process.env.EVERNOTE_SMOKE_MS) {
      setTimeout(async () => {
        const wc = win?.webContents;
        console.log(`SMOKE url=${wc ? safeUrl(wc.getURL()) : 'none'} ua=${wc?.getUserAgent()}`);
        quitting = true; app.quit();
      }, Number(process.env.EVERNOTE_SMOKE_MS));
    }
  });

  app.on('window-all-closed', () => {
    // Only stay alive when there's a tray icon to bring the window back from.
    if (!tray || !settings.closeToTray) { quitting = true; app.quit(); }
  });
  app.on('activate', showWindow);
}

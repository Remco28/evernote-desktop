// Renders assets/icon.svg -> assets/icon.png (512, transparent) and assets/tray.png (64) using Electron itself.
// Usage: ./node_modules/electron/dist/electron --no-sandbox scripts/render-svg.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'assets');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const size = 512;
  const svg = fs.readFileSync(path.join(root, 'icon.svg'), 'utf8')
    .replace(/<svg ([^>]*?)width="\d+" height="\d+"/, `<svg $1width="${size}" height="${size}"`);
  const w = new BrowserWindow({ show: false, width: size, height: size, useContentSize: true, frame: false, transparent: true,
    webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`;
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));
  const img = await w.webContents.capturePage();
  fs.writeFileSync(path.join(root, 'icon.png'), img.toPNG());
  fs.writeFileSync(path.join(root, 'tray.png'), img.resize({ width: 64, height: 64, quality: 'best' }).toPNG());
  console.log('rendered icon.png + tray.png', img.getSize());
  app.quit();
});

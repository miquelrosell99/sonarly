// Screenshot capture for Sonarly's UI against a throwaway local instance.
// Expects a running server (see run.sh). Captures every screen in both
// color schemes into OUT_DIR/<scheme>/*.jpg (the app's default theme is
// "auto", which follows the browser's prefers-color-scheme). JPEG keeps the
// committed artifacts small; bump deviceScaleFactor for retina crispness.
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4535';
const USER = process.env.SONARLY_USER ?? 'screenshots';
const PASS = process.env.SONARLY_PASSWORD ?? 'screenshots-pass-2026';
const OUT = process.env.OUT_DIR ?? new URL('../../docs/img/screenshots/', import.meta.url).pathname;
const SCHEMES = (process.env.SCHEMES ?? 'light,dark').split(',');
mkdirSync(OUT, { recursive: true });

// --- tiny cookie-jarred API client ---------------------------------------
const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

async function api(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    redirect: 'manual',
    headers: { 'content-type': 'application/json', cookie: cookieHeader() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [pair] = sc.split(';');
    const idx = pair.indexOf('=');
    jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}

function firstArray(data) {
  if (Array.isArray(data)) return data;
  for (const v of Object.values(data ?? {})) if (Array.isArray(v)) return v;
  return [];
}

// --- browser ---------------------------------------------------------------
const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'],
});

// --- pre-auth: first-boot setup wizard (must run before /api/setup) --------
for (const scheme of SCHEMES) {
  const dir = path.join(OUT, scheme);
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
  });
  const page = await context.newPage();
  await page.goto(BASE + '/setup', { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(dir, 'setup-wizard.jpg'), type: 'jpeg', quality: 90 });
  console.log(`captured ${scheme}/setup-wizard.jpg`);
  await context.close();
}

// --- auth: run the setup wizard (or log in) -------------------------------
const setup = await api('/api/setup');
if (setup.data?.needsSetup) {
  const r = await api('/api/setup', { method: 'POST', body: { username: USER, password: PASS, name: 'Capture', surname: 'Bot' } });
  if (r.status !== 201) throw new Error(`setup failed: ${r.status} ${JSON.stringify(r.data)}`);
  console.log('setup: admin created');
} else {
  const r = await api('/api/login', { method: 'POST', body: { username: USER, password: PASS } });
  if (r.status !== 200) throw new Error(`login failed: ${r.status}`);
  console.log('login: ok');
}
if (jar.size === 0) throw new Error('no session cookie captured');

// --- wait for the first scan to finish ------------------------------------
let albums = [];
for (let i = 0; i < 120; i++) {
  const r = await api('/api/albums?limit=50');
  albums = firstArray(r.data);
  if (albums.length >= 12) break;
  await new Promise((s) => setTimeout(s, 1000));
}
if (albums.length < 12) console.warn(`warn: only ${albums.length} albums scanned so far`);
console.log(`catalog: ${albums.length} albums`);

// --- enrich: scrobbles + playlists so history/stats/playlists aren't empty
const songsRes = await api('/api/songs?limit=100');
const songs = firstArray(songsRes.data);
const songIds = songs.map((s) => s.id ?? s.songId).filter(Boolean);
for (const id of songIds.slice(0, 10)) {
  await api(`/api/songs/${id}/scrobble`, { method: 'POST', body: {} });
}
if (songIds.length) {
  await api('/api/playlists', { method: 'POST', body: { name: 'Late Night Drive', description: 'After-hours electronic and ambient picks.', songIds: songIds.slice(0, 8) } });
  await api('/api/playlists', { method: 'POST', body: { name: 'Morning Focus', description: 'Instrumentals for deep work.', songIds: songIds.slice(8, 16) } });
}
console.log(`enriched: ${Math.min(10, songIds.length)} scrobbles, 2 playlists`);

// --- authenticated screens: one pass per color scheme ----------------------
for (const scheme of SCHEMES) {
  const dir = path.join(OUT, scheme);
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
  });
  for (const [name, value] of jar) {
    await context.addCookies([{ name, value, domain: '127.0.0.1', path: '/', sameSite: 'Strict' }]);
  }
  const page = await context.newPage();
  const kb = (f) => `${(statSync(path.join(dir, f)).size / 1024).toFixed(0)} KB`;

  async function settle() {
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('img')).every((i) => i.complete),
      { timeout: 8000 },
    ).catch(() => {});
    await page.waitForTimeout(700);
  }

  async function shot(route, file) {
    await page.goto(BASE + route, { waitUntil: 'load' });
    await page.addStyleTag({ content: '::-webkit-scrollbar { display: none; }' }).catch(() => {});
    await settle();
    await page.screenshot({ path: path.join(dir, file), type: 'jpeg', quality: 90 });
    console.log(`captured ${scheme}/${file} (${kb(file)})`);
  }

  await shot('/home', 'home.jpg');
  await shot('/albums', 'albums.jpg');
  await shot('/tracks', 'tracks.jpg');

  // album detail; start playback via the header Play button so the player bar
  // is live (and /now-playing renders the queue instead of redirecting).
  await page.goto(BASE + `/albums/${albums[0].id}`, { waitUntil: 'load' });
  await settle();
  try {
    await page.locator('button:has-text("Play")').first().click({ timeout: 3000 });
    await page.waitForTimeout(2000);
    await page.mouse.move(2, 2); // park the cursor off the Play button so its tooltip isn't captured
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await page.waitForTimeout(900); // outlast the tooltip's show/hide transition
    console.log(`${scheme}: playback started`);
  } catch {
    console.warn(`warn [${scheme}]: could not start playback`);
  }
  await page.screenshot({ path: path.join(dir, 'album.jpg'), type: 'jpeg', quality: 90 });
  console.log(`captured ${scheme}/album.jpg (${kb('album.jpg')})`);

  await shot('/now-playing', 'now-playing.jpg');
  await shot('/playlists', 'playlists.jpg');

  // smart playlist editor: open Create, flip the type toggle to Smart
  await page.locator('button:has-text("Create")').first().click({ timeout: 3000 });
  await page.waitForTimeout(600);
  try {
    const typeGroup = page.getByRole('group', { name: 'Playlist type' });
    await typeGroup.getByRole('button').nth(1).click();
    await page.waitForTimeout(600);
    // toggling to smart asks for confirmation before swapping the editor
    await page.locator('button:has-text("Convert to smart")').click({ timeout: 2000 });
    await page.waitForTimeout(600);
  } catch {
    console.warn(`warn [${scheme}]: could not switch to smart playlist editor`);
  }
  await page.screenshot({ path: path.join(dir, 'smart-playlist.jpg'), type: 'jpeg', quality: 90 });
  console.log(`captured ${scheme}/smart-playlist.jpg (${kb('smart-playlist.jpg')})`);

  await shot('/statistics', 'statistics.jpg');
  await shot('/admin/libraries', 'admin-libraries.jpg');

  await context.close();
}

await browser.close();
console.log('done ->', OUT);

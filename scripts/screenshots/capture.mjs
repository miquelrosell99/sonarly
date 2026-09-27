// Screenshot capture for Sonarly's UI against a throwaway local instance.
// Expects a running server (see run.sh) and writes PNGs to OUT_DIR.
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4535';
const USER = process.env.SONARLY_USER ?? 'screenshots';
const PASS = process.env.SONARLY_PASSWORD ?? 'screenshots-pass-2026';
const OUT = process.env.OUT_DIR ?? new URL('../../docs/img/screenshots/', import.meta.url).pathname;
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

// --- browser ---------------------------------------------------------------
const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
for (const [name, value] of jar) {
  await context.addCookies([{ name, value, domain: '127.0.0.1', path: '/', sameSite: 'Strict' }]);
}
const page = await context.newPage();

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
  const target = path.join(OUT, file);
  await page.screenshot({ path: target });
  console.log(`captured ${file} (${(statSync(target).size / 1024).toFixed(0)} KB)`);
}

await shot('/home', 'home.png');
await shot('/albums', 'albums.png');

// album detail + try to start playback (best effort — selectors may drift)
await page.goto(BASE + `/albums/${albums[0].id}`, { waitUntil: 'load' });
await settle();
await page.screenshot({ path: path.join(OUT, 'album.png') });
console.log(`captured album.png (${(statSync(path.join(OUT, 'album.png')).size / 1024).toFixed(0)} KB)`);
for (const sel of ['button[title*="lay" i]', '[aria-label*="lay" i]', 'button:has(svg)']) {
  try {
    await page.locator(sel).first().click({ timeout: 1500 });
    await page.waitForTimeout(1500);
    break;
  } catch { /* try next selector */ }
}

await shot('/now-playing', 'now-playing.png');
await shot('/playlists', 'playlists.png');
await shot('/statistics', 'statistics.png');
await shot('/admin/libraries', 'admin-libraries.png');

await browser.close();
console.log('done ->', OUT);

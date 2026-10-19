// Alignment verification capture: login + one authenticated surface at
// 1440/390 against the vite dev server (SONARLY_DEV_API -> throwaway :4535).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5199';
const USER = 'align-capture';
const PASS = 'align-pass-2026';
const OUT = '/root/sonarly-captures-20261019';
mkdirSync(OUT, { recursive: true });

const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
async function api(pathname, { method = 'GET', body } = {}) {
  const res = await fetch('http://127.0.0.1:4535' + pathname, {
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
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const setup = await api('/api/setup');
if (setup.data?.needsSetup) {
  const r = await api('/api/setup', { method: 'POST', body: { username: USER, password: PASS, name: 'Align', surname: 'Capture' } });
  if (r.status !== 201) throw new Error(`setup failed: ${r.status}`);
  console.log('setup: admin created');
} else {
  const r = await api('/api/login', { method: 'POST', body: { username: USER, password: PASS } });
  if (r.status !== 200) throw new Error(`login failed: ${r.status}`);
  console.log('login: ok');
}
if (jar.size === 0) throw new Error('no session cookie');

// wait for the first scan
let albums = [];
for (let i = 0; i < 120; i++) {
  const r = await api('/api/albums?limit=50');
  const d = r.data;
  albums = Array.isArray(d) ? d : Object.values(d ?? {}).find((v) => Array.isArray(v)) ?? [];
  if (albums.length >= 12) break;
  await new Promise((s) => setTimeout(s, 1000));
}
console.log(`catalog: ${albums.length} albums`);

const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
for (const width of [1440, 390]) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
  for (const [name, value] of jar) {
    await context.addCookies([{ name, value, domain: '127.0.0.1', path: '/', sameSite: 'Strict' }]);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/home', { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => Array.from(document.querySelectorAll('img')).every((i) => i.complete), { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  const file = `${OUT}/home-${width}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log(`captured home-${width}.png; console errors: ${errors.length}`);
  for (const e of errors.slice(0, 5)) console.log('  console.error:', e.slice(0, 200));
  await context.close();
}
await browser.close();

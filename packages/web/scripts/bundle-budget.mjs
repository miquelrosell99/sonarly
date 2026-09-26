#!/usr/bin/env node
// Post-build bundle budget gate (FF2). Wired as the final step of
// `pnpm build` — fails the build with a readable report when a limit is
// exceeded so bundle growth can never ship silently.
//
// Limits (raw bytes, KiB = 1024 bytes):
//   entry      — the chunk index.html loads first (app shell + chrome)
//   lazyChunk  — any single non-vendor route/shared chunk
//   total      — every .js asset in dist/assets together
// The vendor chunks (react-*, tanstack-*, dnd-kit-*, wouter-*, zustand-*)
// are excluded from the per-chunk rule: they are bounded by the total.
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LIMITS = {
  entry: 250 * 1024,
  lazyChunk: 350 * 1024,
  total: 900 * 1024,
};

const VENDOR_RE = /^(react|tanstack|dnd-kit|wouter|zustand)-.+\.js$/;
const KIB = 1024;

const fmt = (bytes) => `${(bytes / KIB).toFixed(1)} KiB`;

// The entry chunk is the script index.html executes; Rollup names every
// unnamed chunk `index-*.js`, so the HTML reference is the only reliable
// way to tell the entry apart from the other index chunks.
function findEntryChunk(assetsDir) {
  const htmlPath = join(assetsDir, '..', 'index.html');
  if (!existsSync(htmlPath)) return null;
  const html = readFileSync(htmlPath, 'utf8');
  const match = html.match(/<script[^>]+src="[^"]*assets\/([^"]+\.js)"/);
  return match ? match[1] : null;
}

export function checkBudget(assetsDir, limits = LIMITS) {
  const dir = resolve(assetsDir);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  if (files.length === 0) {
    throw new Error(`bundle-budget: no JS assets found in ${dir}`);
  }

  const entryName = findEntryChunk(dir);
  const chunks = files
    .map((name) => ({ name, bytes: statSync(join(dir, name)).size }))
    .sort((a, b) => b.bytes - a.bytes);

  const offenders = [];
  const entry = chunks.find((c) => c.name === entryName);
  if (!entry) {
    offenders.push({ name: '(entry chunk)', bytes: 0, limit: limits.entry, note: 'not found in index.html' });
  } else if (entry.bytes > limits.entry) {
    offenders.push({ ...entry, limit: limits.entry });
  }

  let total = 0;
  for (const chunk of chunks) {
    total += chunk.bytes;
    if (chunk.name === entryName || VENDOR_RE.test(chunk.name)) continue;
    if (chunk.bytes > limits.lazyChunk) {
      offenders.push({ ...chunk, limit: limits.lazyChunk });
    }
  }
  if (total > limits.total) {
    offenders.push({ name: '(total JS)', bytes: total, limit: limits.total });
  }

  return { ok: offenders.length === 0, chunks, entryName, total, offenders, limits };
}

export function formatReport(result) {
  const lines = [];
  lines.push('Bundle budget:');
  const entryBytes = result.chunks.find((c) => c.name === result.entryName)?.bytes ?? 0;
  lines.push(`  entry ${result.entryName ?? '(none)'} — ${fmt(entryBytes)} / ${fmt(result.limits.entry)}`);
  lines.push(`  total JS — ${fmt(result.total)} / ${fmt(result.limits.total)}`);
  for (const chunk of result.chunks) {
    const tag = chunk.name === result.entryName ? ' [entry]' : VENDOR_RE.test(chunk.name) ? ' [vendor]' : '';
    lines.push(`    ${fmt(chunk.bytes).padStart(10)}  ${chunk.name}${tag}`);
  }
  if (result.offenders.length > 0) {
    lines.push('');
    lines.push('Bundle budget exceeded:');
    for (const o of result.offenders) {
      lines.push(`  ✗ ${o.name}: ${fmt(o.bytes)} over the ${fmt(o.limit)} limit${o.note ? ` (${o.note})` : ''}`);
    }
  }
  return lines.join('\n');
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const assetsDir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets');
  try {
    const result = checkBudget(assetsDir);
    console.log(formatReport(result));
    if (!result.ok) {
      console.error('\nbundle-budget: build rejected.');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`bundle-budget: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

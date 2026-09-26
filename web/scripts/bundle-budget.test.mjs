import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkBudget, formatReport, LIMITS } from './bundle-budget.mjs';

let dir;
let assetsDir;

function writeAsset(name, bytes) {
  writeFileSync(join(assetsDir, name), 'x'.repeat(bytes));
}

function writeHtml(entryName) {
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html><html><body><script type="module" crossorigin src="/assets/${entryName}"></script></body></html>`,
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bundle-budget-'));
  assetsDir = join(dir, 'assets');
  mkdirSync(assetsDir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('bundle-budget', () => {
  it('passes when all chunks are within limits', () => {
    writeHtml('index-AAAA.js');
    writeAsset('index-AAAA.js', 200 * 1024);
    writeAsset('react-BBBB.js', 140 * 1024);
    writeAsset('Tracks-CCCC.js', 30 * 1024);

    const result = checkBudget(assetsDir);
    expect(result.ok).toBe(true);
    expect(result.offenders).toHaveLength(0);
    expect(result.total).toBe(370 * 1024);
    expect(result.entryName).toBe('index-AAAA.js');
  });

  it('fails when the entry chunk exceeds its limit', () => {
    writeHtml('index-AAAA.js');
    writeAsset('index-AAAA.js', LIMITS.entry + 1);
    writeAsset('react-BBBB.js', 140 * 1024);

    const result = checkBudget(assetsDir);
    expect(result.ok).toBe(false);
    const offender = result.offenders.find((o) => o.name === 'index-AAAA.js');
    expect(offender).toBeDefined();
    expect(offender.limit).toBe(LIMITS.entry);
  });

  it('fails when a lazy chunk exceeds the per-chunk limit but not vendors', () => {
    writeHtml('index-AAAA.js');
    writeAsset('index-AAAA.js', 10 * 1024);
    // A vendor chunk over the lazy limit must not trip the per-chunk rule…
    writeAsset('react-BBBB.js', LIMITS.lazyChunk + 1);

    const vendorsOk = checkBudget(assetsDir);
    expect(vendorsOk.ok).toBe(true);

    // …but a non-vendor chunk of the same size does.
    writeAsset('HugeRoute-DDDD.js', LIMITS.lazyChunk + 1);
    const result = checkBudget(assetsDir);
    expect(result.ok).toBe(false);
    expect(result.offenders.some((o) => o.name === 'HugeRoute-DDDD.js')).toBe(true);
  });

  it('fails when total JS exceeds the total limit', () => {
    writeHtml('index-AAAA.js');
    writeAsset('index-AAAA.js', 100 * 1024);
    writeAsset('a-EEEE.js', LIMITS.total); // pushes total over

    const result = checkBudget(assetsDir);
    expect(result.ok).toBe(false);
    expect(result.offenders.some((o) => o.name === '(total JS)')).toBe(true);
  });

  it('flags a missing entry chunk instead of crashing', () => {
    writeAsset('index-AAAA.js', 10 * 1024);
    // no index.html
    const result = checkBudget(assetsDir);
    expect(result.ok).toBe(false);
    expect(result.offenders.some((o) => o.note === 'not found in index.html')).toBe(true);
  });

  it('throws when the assets dir has no JS', () => {
    expect(() => checkBudget(assetsDir)).toThrow(/no JS assets/);
  });

  it('renders a readable report listing offenders', () => {
    writeHtml('index-AAAA.js');
    writeAsset('index-AAAA.js', LIMITS.entry + 1);

    const report = formatReport(checkBudget(assetsDir));
    expect(report).toContain('Bundle budget exceeded');
    expect(report).toContain('index-AAAA.js');
    expect(report).toContain('over the');
  });
});

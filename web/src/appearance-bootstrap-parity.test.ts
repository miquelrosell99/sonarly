/**
 * appearance-bootstrap parity — the appearance-seam gate.
 *
 * The appearance data-* attributes have TWO writers:
 *
 *   1. `useTheme.apply()` (src/stores/themeStore.ts, runtime — boot + every
 *      settings change), which resolves through src/lib/appearance.ts's
 *      resolveAppearanceAttributes;
 *   2. the inline bootstrap script in index.html (pre-paint — it cannot
 *      import the module), which mirrors that function VERBATIM.
 *
 * A drift between them means first paint and post-boot disagree (theme
 * flash, stale OLED, unvalidated accent). This test executes BOTH
 * implementations against a scenario matrix — stored preferences crossed
 * with the system scheme, malformed values, the legacy bare-mode string —
 * and fails the gate on any divergence (constitution ruling 2026-10-15).
 */
import { describe, expect, it } from 'vitest';
import { resolveAppearanceAttributes } from './lib/appearance.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('index.html: inline bootstrap <script> not found');
const BOOTSTRAP_SOURCE = scriptMatch[1]!;

interface Scenario {
  /** Raw localStorage value under the sonarly-theme key (or absent). */
  stored: string | null;
  systemDark: boolean;
}

const STORED_VALUES = [
  null,
  // legacy bare-mode strings
  'light',
  'dark',
  'oled',
  'banana',
  '42',
  // JSON snapshots
  '{"mode":"auto","accent":"auto"}',
  '{"mode":"auto","accent":"copper"}',
  '{"mode":"light","accent":"green"}',
  '{"mode":"dark","accent":"purple"}',
  '{"mode":"oled","accent":"blue"}',
  '{"mode":"oled","accent":"monochrome"}',
  '{"mode":"dark","accent":"magenta"}',
  '{"mode":"rainbow","accent":"cyan"}',
  '{"mode":"dark"}',
  '{"accent":"teal"}',
  '{}',
  '"dark"',
  'not json {',
  '[1,2]',
];

const scenarios: Scenario[] = [];
for (const stored of STORED_VALUES) {
  for (const systemDark of [false, true]) {
    scenarios.push({ stored, systemDark });
  }
}

/** Run the inline bootstrap with mocked globals; returns the dataset it wrote. */
function runBootstrap(stored: string | null, systemDark: boolean): Record<string, string> {
  const dataset: Record<string, string> = {};
  const localStorage = {
    getItem: () => stored,
  };
  const window = {
    matchMedia: () => ({ matches: systemDark }),
    localStorage,
  };
  const document = { documentElement: { dataset } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('window', 'document', 'localStorage', BOOTSTRAP_SOURCE) as (
    window: unknown,
    document: unknown,
    localStorage: unknown,
  ) => void;
  run(window, document, localStorage);
  return dataset;
}

/** Run the shared module with the same storage; returns the same shape. */
function runModule(stored: string | null, systemDark: boolean): Record<string, string> {
  const attrs = resolveAppearanceAttributes(() => stored, systemDark);
  const dataset: Record<string, string> = { theme: attrs.theme, accent: attrs.accent };
  if (attrs.oled) dataset.oled = 'true';
  return dataset;
}

describe('appearance bootstrap parity', () => {
  it(`index.html bootstrap matches resolveAppearanceAttributes across ${scenarios.length} scenarios`, () => {
    for (const { stored, systemDark } of scenarios) {
      expect(
        runBootstrap(stored, systemDark),
        `stored=${JSON.stringify(stored)} systemDark=${systemDark}`,
      ).toEqual(runModule(stored, systemDark));
    }
  });

  it('resolves OLED to dark + the oled flag on both sides', () => {
    const stored = JSON.stringify({ mode: 'oled', accent: 'blue' });
    for (const systemDark of [false, true]) {
      const expected = { theme: 'dark', oled: 'true', accent: 'blue' };
      expect(runBootstrap(stored, systemDark)).toEqual(expected);
      expect(runModule(stored, systemDark)).toEqual(expected);
    }
  });

  it('falls back to the brand defaults for a first visit on both sides', () => {
    for (const systemDark of [false, true]) {
      const expected = { theme: systemDark ? 'dark' : 'light', accent: 'copper' };
      expect(runBootstrap(null, systemDark)).toEqual(expected);
      expect(runModule(null, systemDark)).toEqual(expected);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Audit F10: the semantic error/success text colors must meet WCAG AA
// (>= 4.5:1) for the 14px text they render as, on every surface they appear
// on, in all three themes. The audit's figures were computed from these same
// token HSL values; this test recomputes the ratios from index.css so the
// tokens cannot silently regress. Tokens are canonical Material You roles
// (--md-sys-color-*, law/spec.md §2) since the 2026-10-19 single-track
// migration.

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

type Hsl = [number, number, number];

function themeBlock(name: string): string {
  const start = css.indexOf(`.${name} {`);
  if (start === -1) throw new Error(`theme block .${name} not found in index.css`);
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

// Light rides the shared `:root, .theme-light` block.
function lightBlock(): string {
  const start = css.indexOf('.theme-light {');
  if (start === -1) throw new Error('theme block .theme-light not found in index.css');
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

function token(block: string, name: string): Hsl {
  const match = block.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  if (!match) throw new Error(`token --${name} not found in theme block`);
  return [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100];
}

function channelLuminance(value: number): number {
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function relativeLuminance([h, s, l]: Hsl): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return (
    0.2126 * channelLuminance(r + m) +
    0.7152 * channelLuminance(g + m) +
    0.0722 * channelLuminance(b + m)
  );
}

function contrast(a: Hsl, b: Hsl): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const AA_TEXT = 4.5;

const THEMES: [string, () => string][] = [
  ['light', lightBlock],
  ['dark', () => themeBlock('theme-dark')],
  ['oled', () => themeBlock('theme-oled')],
];

for (const [theme, blockFor] of THEMES) {
  describe(`${theme} semantic token contrast`, () => {
    const block = blockFor();
    const error = token(block, 'md-sys-color-error');
    const success = token(block, 'md-sys-color-success');
    const surface = token(block, 'md-sys-color-surface');
    const background = token(block, 'md-sys-color-background');

    // text-error / text-success bodies: toasts, .btn-danger labels,
    // role="alert" paragraphs, on both card and page backgrounds.
    it.each([
      ['error', error],
      ['success', success],
    ] as const)('%s text on --md-sys-color-surface meets AA for 14px text', (_name, fg) => {
      expect(contrast(fg, surface)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it.each([
      ['error', error],
      ['success', success],
    ] as const)('%s text on --md-sys-color-background meets AA for 14px text', (_name, fg) => {
      expect(contrast(fg, background)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    // The .btn-danger hover inversion paints the button --md-sys-color-error
    // and the label --md-sys-color-on-primary (bound to the background role).
    it('--md-sys-color-background text on --md-sys-color-error (btn-danger hover inversion) meets AA', () => {
      expect(contrast(background, error)).toBeGreaterThanOrEqual(AA_TEXT);
    });
  });
}

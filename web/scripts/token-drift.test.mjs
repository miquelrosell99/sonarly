import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  collectDrift,
  formatReport,
  RAW_RADIUS_RE,
  PALETTE_RE,
  ARBITRARY_FONT_SIZE_RE,
  CANVAS_PAINT_RE,
  HEX_RE,
  VAR_FALLBACK_RE,
  MD_SYS_COLOR_ROLES,
  LEGACY_VAR_RE,
  LEGACY_CLASS_RE,
  LEGACY_THEME_CLASS_RE,
  LEGACY_TOKEN_READ_RE,
} from './token-drift.mjs';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function matches(re, source) {
  return [...source.matchAll(new RegExp(re.source, 'g'))].map((m) => m[0]);
}

describe('token-drift detectors', () => {
  it('flags raw radii, including directional variants and bare rounded', () => {
    expect(matches(RAW_RADIUS_RE, 'rounded-md rounded-t-md rounded-2xl rounded')).toEqual([
      'rounded-md',
      'rounded-t-md',
      'rounded-2xl',
      'rounded',
    ]);
  });

  it('allows the radius token family and full/none', () => {
    expect(
      matches(RAW_RADIUS_RE, 'rounded-card rounded-sheet rounded-button rounded-input rounded-item rounded-popover rounded-full rounded-none sm:rounded-item'),
    ).toEqual([]);
  });

  it('flags default palette hues but not canonical role colors', () => {
    expect(matches(PALETTE_RE, 'bg-slate-900 text-red-500 ring-blue-200')).toEqual([
      'bg-slate-900',
      'text-red-500',
      'ring-blue-200',
    ]);
    expect(
      matches(PALETTE_RE, 'bg-surface text-on-surface border-outline bg-primary text-error'),
    ).toEqual([]);
  });

  it('enforces the canonical md-sys role family', () => {
    expect(MD_SYS_COLOR_ROLES.has('surface-container-high')).toBe(true);
    expect(MD_SYS_COLOR_ROLES.has('hover-overlay')).toBe(true);
    expect(MD_SYS_COLOR_ROLES.has('sidebar-card')).toBe(false);
  });

  it('flags legacy pre-migration names but spares the picker ramp vars', () => {
    expect(matches(LEGACY_VAR_RE, '--bg-primary: 1 2% 3%; --rule: 1 2% 3%; --accent-copper: 1 2% 3%;'))
      .toEqual(['--bg-primary', '--rule']);
    expect(
      matches(LEGACY_CLASS_RE, 'bg-bg-primary text-muted border-rule bg-accent text-danger'),
    ).toEqual(['bg-bg-primary', 'text-muted', 'border-rule', 'bg-accent', 'text-danger']);
    expect(matches(LEGACY_CLASS_RE, 'bg-background text-on-surface border-outline bg-primary')).toEqual(
      [],
    );
    expect(matches(LEGACY_THEME_CLASS_RE, 'theme-dark accent-purple .theme-oled .accent-cyan')).toEqual([
      'theme-dark',
      'accent-purple',
      'theme-oled',
      'accent-cyan',
    ]);
    // The curated picker ramp vars are registered identity values, not classes.
    expect(matches(LEGACY_THEME_CLASS_RE, '--accent-copper hsl(var(--accent-green))')).toEqual([]);
    // Runtime token reads must cite canonical roles.
    expect(
      matches(
        LEGACY_TOKEN_READ_RE,
        "getPropertyValue('--fg-primary') getPropertyValue(\"--rule\") getPropertyValue('--md-sys-color-on-surface')",
      ),
    ).toEqual(["getPropertyValue('--fg-primary')", 'getPropertyValue("--rule")']);
  });

  it('flags arbitrary px/rem/em font sizes', () => {
    expect(matches(ARBITRARY_FONT_SIZE_RE, 'text-[11px] text-[0.65em] text-[0.875rem]')).toHaveLength(3);
    expect(matches(ARBITRARY_FONT_SIZE_RE, 'text-xs text-2xs text-3xs text-badge')).toEqual([]);
  });

  it('allows canvas paint that interpolates token-derived values, flags literals', () => {
    const allowed = [...`ctx.fillStyle = \`hsl(\${fg} / 0.3)\``.matchAll(new RegExp(CANVAS_PAINT_RE.source, 'g'))];
    expect(allowed).toHaveLength(1);
    expect(allowed[0][2].includes('${')).toBe(true);
    const literal = [...`ctx.fillStyle = '#db8243'`.matchAll(new RegExp(CANVAS_PAINT_RE.source, 'g'))];
    expect(literal).toHaveLength(1);
  });

  it('flags color literals in var() fallbacks but not honest unitless defaults', () => {
    const bad = [...'var(--error, #e05252)'.matchAll(VAR_FALLBACK_RE)];
    expect(HEX_RE.test(bad[0][1])).toBe(true);
    const good = [...'var(--slider-fill, 0%)'.matchAll(VAR_FALLBACK_RE)];
    expect(HEX_RE.test(good[0][1])).toBe(false);
  });
});

describe('token-drift on a fixture tree', () => {
  let dir;

  function fixture({ css = '', tsx = {}, register = '' } = {}) {
    dir = mkdtempSync(join(tmpdir(), 'token-drift-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, '.agents'), { recursive: true });
    writeFileSync(join(dir, 'src', 'index.css'), css);
    writeFileSync(join(dir, '.agents', 'design-overrides.md'), register);
    for (const [name, content] of Object.entries(tsx)) {
      writeFileSync(join(dir, 'src', name), content);
    }
    return dir;
  }

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes a clean tree', () => {
    const root = fixture({
      css: ':root { --accent: 25 68% 56%; }\n.btn { color: hsl(var(--accent)); border-radius: 9999px; }\n',
      tsx: {
        'App.tsx': 'export const App = () => <div className="rounded-card bg-surface" />;\n',
        // Minimal stand-ins so the JS-set-var allowlist self-checks pass.
        'MonthlyActivityChart.tsx': "style={{ '--stagger': 0 }} as CSSProperties",
        'StatisticsView.tsx': "return { '--stagger': index } as CSSProperties",
        'Layout.tsx': "({ '--now-playing-color': color } as React.CSSProperties)",
        'AutoDjTunePopover.tsx': "style={{ '--slider-fill': '0%' }} as React.CSSProperties",
        'SettingsPlayback.tsx': "style={{ '--slider-fill': '0%' }} as React.CSSProperties",
        'PlayerControls.tsx': "style={{ '--slider-fill': '0%' }} as React.CSSProperties",
      },
      register: 'min-[420px] min-[640px] min-[1280px]',
    });
    const result = collectDrift(root, { registerPath: join(dir, '.agents', 'design-overrides.md') });
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('collects css and tsx violations with file and line', () => {
    const root = fixture({
      css: [
        ':root { --accent: 25 68% 56%; }',
        '.bad { color: #db8243; font-size: 13px; border-radius: 6px; }',
        '.fallback { color: var(--accent, #fff); }',
        '.unknown { color: var(--does-not-exist); }',
        '.legacy { color: hsl(var(--bg-primary)); }',
        '.legacy-class { color: hsl(var(--accent)); } .legacy-class.border { border-color: hsl(var(--rule)); }',
        '.theme-dark { color: red; } .accent-purple { color: red; }',
        ':root { --md-sys-color-sidebar-card: 1 2% 3%; }',
      ].join('\n'),
      tsx: {
        'App.tsx': [
          'const a = "rounded-md";', // line 1
          'const b = "bg-slate-900";', // line 2
          'const c = "text-[11px]";', // line 3
          'const d = "min-[500px]:";', // line 4 — off-grid, unregistered owner
          'const e = "bg-bg-primary text-muted border-rule";', // line 5 — legacy stems
          'const f = "theme-dark accent-purple";', // line 6 — legacy class seam
          "const g = getPropertyValue('--fg-primary');", // line 7 — legacy runtime read
        ].join('\n'),
      },
    });
    const result = collectDrift(root);
    const rules = result.violations.map((v) => v.rule);
    expect(rules).toContain('css/color-literal');
    expect(rules).toContain('css/px-font-size');
    expect(rules).toContain('css/px-border-radius');
    expect(rules).toContain('css/color-literal-in-fallback');
    expect(rules).toContain('css/unresolved-var');
    expect(rules).toContain('css/legacy-token');
    expect(rules).toContain('css/legacy-class');
    expect(rules).toContain('css/md-sys-namespace');
    expect(rules).toContain('tsx/raw-radius');
    expect(rules).toContain('tsx/default-palette');
    expect(rules).toContain('tsx/arbitrary-font-size');
    expect(rules).toContain('tsx/off-grid-breakpoint');
    expect(rules).toContain('tsx/legacy-class');
    expect(rules).toContain('tsx/legacy-token-read');
    const offGrid = result.violations.find((v) => v.rule === 'tsx/off-grid-breakpoint');
    expect(offGrid.file).toBe('src/App.tsx');
    expect(offGrid.line).toBe(4);
    const mdSys = result.violations.find((v) => v.rule === 'css/md-sys-namespace');
    expect(mdSys.snippet).toBe('--md-sys-color-sidebar-card');
    expect(result.ok).toBe(false);
  });

  it('fails the allowlist self-check when the register loses the boundary', () => {
    const root = fixture({
      css: ':root { --accent: 25 68% 56%; }',
      tsx: { 'TopBar.tsx': 'export const T = () => <span className="min-[420px]:block" />;\n' },
      register: 'nothing registered here',
    });
    const result = collectDrift(root, { registerPath: join(dir, '.agents', 'design-overrides.md') });
    expect(result.violations.some((v) => v.rule === 'allowlist/orphaned-breakpoint')).toBe(true);
  });
});

describe('token-drift on the real tree (zero baseline)', () => {
  it('reports no drift in web/src', () => {
    const result = collectDrift(webRoot);
    const report = formatReport(result);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
    expect(report).toContain('no drift');
  });
});

#!/usr/bin/env node
// Design-token drift gate (RosellRamos DS audit 2026-10-15; namespace
// checks recast for the canonical --md-sys-color-* architecture in the
// 2026-10-19 single-track migration). Zero baseline — any
// drift fails immediately, no grandfathering. The web UI is class-driven
// (Tailwind tokens in tailwind.config.js + web/src/index.css), so the gate
// has two halves:
//
//   CSS (web/src/**/*.css):
//     1. every var(--token) resolves to a custom property defined in a stylesheet
//        (plus a JS-scoped allowlist for properties set via inline style from TS,
//        each entry self-checking that its owner file still sets it);
//     2. no bare color literal (#hex, rgb()/rgba(), hsl() with numeric args) —
//        comments are stripped first, so prose may mention hexes freely;
//     3. no px font-size;
//     4. no px border-radius except the 9999px full pill;
//     5. no color literal inside a var() fallback (var(--x, 0%) is honest;
//        var(--x, #fff) is a hardcoded color);
//     6. every --md-sys-color-* definition is a canonical Material You role
//        (law/spec.md §2 family + the registered fleet semantic trio) —
//        namespace hygiene per law/spec.md §1;
//     7. no legacy pre-migration token names survive (full alignment, no legacy-name aliases): the old role
//        vars (--bg-primary, --fg-primary/--fg-secondary, --surface-hover,
//        --rule, --danger), the old class stems (bg-bg-primary, text-muted,
//        border-rule, bg-accent, …), and the .theme-*/.accent-* class seam.
//        --accent/--muted themselves are canonical now (the shadcn alias
//        layer: hover surface / container).
//
//   TS/TSX (web/src/**/*.{ts,tsx}):
//     8. no raw Tailwind radii (rounded-sm/md/lg/xl/2xl/3xl and bare rounded,
//        directional variants included) — the rounded-* token family owns corners;
//     9. no default Tailwind palette hues (bg-slate-900, text-red-500, …);
//    10. no arbitrary color literals in class values (bg-[#fff]), no arbitrary
//        px/rem/em font sizes (text-[11px]);
//    11. no hardcoded canvas paint: fillStyle/strokeStyle assigned a plain
//        string literal (template literals interpolating token-derived values
//        are allowed — see SyncedLyricsEditor);
//    12. off-grid breakpoint variants (min-[640px]:) only at registered owner
//        files — the register entry must still exist (self-check);
//    13. the legacy class stems and theme/accent class seam from rule 7.
//
// The gate is CSS/class-only by construction: it cannot judge elevation
// (shadow on static vs floating layers) — that stays an audit-checklist duty.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CSS_VAR_DEF_RE = /(--[a-z0-9-]+)\s*:/gi;
export const CSS_VAR_REF_RE = /var\(\s*(--[a-z0-9-]+)/gi;
export const CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

export const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
export const RGB_FN_RE = /\brgba?\(\s*\d/;
export const HSL_LITERAL_RE = /\bhsla?\(\s*\d/;
export const PX_FONT_SIZE_RE = /font-size\s*:\s*-?[\d.]+px\b/i;
export const PX_BORDER_RADIUS_RE = /border-radius\s*:\s*([^;]*?)(-?[\d.]+px)\b/i;
export const VAR_FALLBACK_RE = /var\(([^)]*)\)/g;

// The canonical --md-sys-color-* role family (law/spec.md §2) plus the
// registered fleet semantic trio (success/warning/info — a documented
// namespace extension; the app's register records the decision). Definitions
// outside this set fail the gate (rule 6).
export const MD_SYS_COLOR_ROLES = new Set([
  'background', 'on-background', 'surface', 'on-surface',
  'surface-variant', 'on-surface-variant',
  'surface-dim', 'surface-bright',
  'surface-container-lowest', 'surface-container-low', 'surface-container',
  'surface-container-high', 'surface-container-highest',
  'inverse-surface', 'inverse-on-surface', 'inverse-primary',
  'primary', 'on-primary', 'primary-container', 'on-primary-container',
  'primary-hover', 'primary-pressed', 'primary-fixed', 'primary-fixed-dim',
  'on-primary-fixed', 'on-primary-fixed-variant',
  'secondary', 'on-secondary', 'secondary-container', 'on-secondary-container',
  'tertiary', 'on-tertiary', 'tertiary-container', 'on-tertiary-container',
  'error', 'on-error', 'error-container', 'on-error-container',
  'outline', 'outline-variant', 'scrim', 'shadow', 'surface-tint',
  'hover-overlay', 'focus-overlay', 'pressed-overlay',
  'success', 'warning', 'info',
]);

// Legacy pre-migration names — banned by the 2026-10-19 single-track
// migration (rule 7/13). The old role vars…
export const LEGACY_VAR_RE =
  /--(?:bg-primary|fg-primary|fg-secondary|surface-hover|rule|danger)\b/;
// …the old Tailwind class stems (bg-bg-primary, text-muted, border-rule,
// bg-accent, …)…
export const LEGACY_CLASS_RE =
  /\b(?:bg|text|border|ring|fill|stroke|divide|ring-offset)-(?:bg-primary|fg-primary|fg-secondary|surface-hover|rule|muted|accent|danger)\b/;
// …and the .theme-*/.accent-* class seam. The (?<!-) lookbehind spares the
// curated picker ramp vars (--accent-copper, registered identity values).
export const LEGACY_THEME_CLASS_RE =
  /(?<!-)\b(?:theme-(?:light|dark|oled)|accent-(?:copper|green|purple|blue|monochrome|cyan))\b/g;

// …and runtime token reads via getComputedStyle(...).getPropertyValue():
// the read string must cite a canonical role, not a legacy name.
export const LEGACY_TOKEN_READ_RE =
  /getPropertyValue\(\s*['"]--(?:bg-primary|fg-primary|fg-secondary|surface-hover|rule|danger)\b['"]\)/g;

// Raw Tailwind radii outside the token family (rounded-card/sheet/button/
// input/item/popover/full/none are the allowed vocabulary). Bare `rounded`
// (4px) is forbidden too — the item token is the smallest step.
export const RAW_RADIUS_RE =
  /(?<![\w/-])rounded(?:(?:-(?:t|b|l|r|s|e|tl|tr|bl|br))?-(?:sm|md|lg|xl|2xl|3xl))(?![\w/-])|(?<![\w/-])rounded(?![\w/-])/g;

// Default Tailwind palette hues with a numeric step. Canonical role names
// (background, surface, on-surface, outline, primary, error, …) deliberately
// do not collide with these.
export const PALETTE_RE =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline|decoration|placeholder|caret|accent|shadow)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\.\d)?\b/g;

// Arbitrary class values smuggling a color, or a px/rem/em font size.
export const ARBITRARY_COLOR_CLASS_RE = /\[[^]\s"'`]*(?:#[0-9a-fA-F]{3,8}\b|rgba?\()/g;
export const ARBITRARY_FONT_SIZE_RE = /\btext-\[[\d.]+(?:px|rem|em)\]/g;

// Canvas paint assigned a string. Template literals that interpolate a
// token-derived variable (e.g. `hsl(${fg} / 0.3)`) are allowed.
export const CANVAS_PAINT_RE = /\b(fillStyle|strokeStyle)\s*=\s*(`[^`]*`|'[^']*'|"[^"]*")/g;

// Breakpoint variants outside the spec grid (480/768/1024/1440 in
// tailwind.config.js). Off-grid boundaries survive only at the owner files
// registered in .agents/design-overrides.md (self-checked below).
export const OFFGRID_VARIANT_RE = /(?:^|[\s"'`(])((?:min|max)-\[(\d+)px\]):/g;

// CSS custom properties set from TS via inline style — allowed, but each
// entry self-checks that its owner file still sets the property.
export const JS_SET_VARS = {
  '--stagger': ['MonthlyActivityChart.tsx', 'StatisticsView.tsx'],
  '--now-playing-color': ['Layout.tsx'],
  '--slider-fill': ['AutoDjTunePopover.tsx', 'SettingsPlayback.tsx', 'PlayerControls.tsx'],
};

// Off-grid breakpoint boundary → owner files (mirrors the register entry
// "Off-grid breakpoint usages" in .agents/design-overrides.md).
export const OFFGRID_ALLOWLIST = {
  '420': ['TopBar.tsx', 'StatisticsView.tsx'],
  '640': ['TopBar.tsx', 'StatisticsView.tsx'],
  '1280': ['StatisticsView.tsx'],
};

const GENERATED_DIRS = new Set(['contract']);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!GENERATED_DIRS.has(entry.name)) yield* walk(path);
    } else {
      yield path;
    }
  }
}

export function collectDrift(webRoot, options = {}) {
  const root = resolve(webRoot);
  const srcDir = join(root, 'src');
  const violations = [];
  const stats = { tsFiles: 0, cssFiles: 0, cssVars: 0 };

  const files = [...walk(srcDir)].filter((f) => /\.(ts|tsx|css)$/.test(f) && !f.endsWith('.d.ts'));
  const cssFiles = files.filter((f) => f.endsWith('.css'));
  const tsFiles = files.filter((f) => /\.tsx?$/.test(f));
  stats.tsFiles = tsFiles.length;
  stats.cssFiles = cssFiles.length;

  const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
  const rel = (f) => relative(root, f);

  const eachLine = (file, source, check) => {
    let offset = 0;
    for (const [index, line] of source.split('\n').entries()) {
      check(line, index + 1, offset);
      offset += line.length + 1;
    }
  };

  // ---- CSS half -----------------------------------------------------------

  const definedVars = new Set();
  for (const file of cssFiles) {
    for (const match of sources.get(file).matchAll(CSS_VAR_DEF_RE)) {
      definedVars.add(match[1]);
    }
  }
  stats.cssVars = definedVars.size;

  for (const file of cssFiles) {
    // Comments stripped: prose may document spec hexes freely.
    const source = sources.get(file).replace(CSS_COMMENT_RE, '');
    const fileRel = rel(file);

    for (const match of source.matchAll(CSS_VAR_REF_RE)) {
      const name = match[1];
      if (!definedVars.has(name) && !(name in JS_SET_VARS)) {
        violations.push({
          rule: 'css/unresolved-var',
          file: fileRel,
          line: lineNumberAt(source, match.index),
          snippet: name,
        });
      }
    }

    // Rule 6: --md-sys-color-* definitions must be canonical roles.
    for (const match of source.matchAll(CSS_VAR_DEF_RE)) {
      const name = match[1];
      if (!name.startsWith('--md-sys-color-')) continue;
      const role = name.slice('--md-sys-color-'.length);
      if (!MD_SYS_COLOR_ROLES.has(role)) {
        violations.push({
          rule: 'css/md-sys-namespace',
          file: fileRel,
          line: lineNumberAt(source, match.index),
          snippet: name,
        });
      }
    }

    // Rule 7: legacy pre-migration names must not survive in CSS.
    for (const match of source.matchAll(new RegExp(LEGACY_VAR_RE.source, 'g'))) {
      violations.push({
        rule: 'css/legacy-token',
        file: fileRel,
        line: lineNumberAt(source, match.index),
        snippet: match[0],
      });
    }
    for (const match of source.matchAll(new RegExp(LEGACY_CLASS_RE.source, 'g'))) {
      violations.push({
        rule: 'css/legacy-class',
        file: fileRel,
        line: lineNumberAt(source, match.index),
        snippet: match[0],
      });
    }
    for (const match of source.matchAll(LEGACY_THEME_CLASS_RE)) {
      violations.push({
        rule: 'css/legacy-class',
        file: fileRel,
        line: lineNumberAt(source, match.index),
        snippet: match[0],
      });
    }

    eachLine(file, source, (line, lineNo) => {
      if (HEX_RE.test(line) || RGB_FN_RE.test(line) || HSL_LITERAL_RE.test(line)) {
        violations.push({ rule: 'css/color-literal', file: fileRel, line: lineNo, snippet: line });
      }
      if (PX_FONT_SIZE_RE.test(line)) {
        violations.push({ rule: 'css/px-font-size', file: fileRel, line: lineNo, snippet: line });
      }
      const radius = PX_BORDER_RADIUS_RE.exec(line);
      if (radius && radius[2] !== '9999px' && radius[2] !== '0px') {
        violations.push({ rule: 'css/px-border-radius', file: fileRel, line: lineNo, snippet: line });
      }
      for (const match of line.matchAll(VAR_FALLBACK_RE)) {
        if (HEX_RE.test(match[1]) || RGB_FN_RE.test(match[1]) || HSL_LITERAL_RE.test(match[1])) {
          violations.push({
            rule: 'css/color-literal-in-fallback',
            file: fileRel,
            line: lineNo,
            snippet: match[0],
          });
        }
      }
    });
  }

  // ---- TS/TSX half --------------------------------------------------------

  for (const file of tsFiles) {
    const source = sources.get(file);
    const fileRel = rel(file);
    const base = file.split('/').pop();

    for (const match of source.matchAll(new RegExp(RAW_RADIUS_RE.source, 'g'))) {
      violations.push({ rule: 'tsx/raw-radius', file: fileRel, line: lineNumberAt(source, match.index), snippet: match[0] });
    }
    for (const match of source.matchAll(new RegExp(PALETTE_RE.source, 'g'))) {
      violations.push({ rule: 'tsx/default-palette', file: fileRel, line: lineNumberAt(source, match.index), snippet: match[0] });
    }
    for (const match of source.matchAll(new RegExp(ARBITRARY_COLOR_CLASS_RE.source, 'g'))) {
      violations.push({ rule: 'tsx/arbitrary-color-class', file: fileRel, line: lineNumberAt(source, match.index), snippet: match[0] });
    }
    for (const match of source.matchAll(new RegExp(ARBITRARY_FONT_SIZE_RE.source, 'g'))) {
      violations.push({ rule: 'tsx/arbitrary-font-size', file: fileRel, line: lineNumberAt(source, match.index), snippet: match[0] });
    }
    for (const match of source.matchAll(new RegExp(CANVAS_PAINT_RE.source, 'g'))) {
      const value = match[2];
      if (value.startsWith('`') && value.includes('${')) continue;
      violations.push({ rule: 'tsx/canvas-paint-literal', file: fileRel, line: lineNumberAt(source, match.index), snippet: match[0] });
    }
    for (const match of source.matchAll(new RegExp(OFFGRID_VARIANT_RE.source, 'g'))) {
      const [, variant, boundary] = match;
      const allowed = OFFGRID_ALLOWLIST[boundary]?.some((owner) => base === owner);
      if (!allowed) {
        violations.push({ rule: 'tsx/off-grid-breakpoint', file: fileRel, line: lineNumberAt(source, match.index), snippet: variant });
      }
    }

    // Rule 13: legacy class stems and the .theme-*/.accent-* class seam.
    for (const match of source.matchAll(new RegExp(LEGACY_CLASS_RE.source, 'g'))) {
      violations.push({ rule: 'tsx/legacy-class', file: fileRel, line: lineNumberAt(source, match.index), snippet: match[0] });
    }
    for (const match of source.matchAll(LEGACY_THEME_CLASS_RE)) {
      violations.push({ rule: 'tsx/legacy-class', file: fileRel, line: lineNumberAt(source, match.index), snippet: match[0] });
    }
    // Rule 13: runtime getPropertyValue reads must cite canonical roles.
    for (const match of source.matchAll(LEGACY_TOKEN_READ_RE)) {
      violations.push({ rule: 'tsx/legacy-token-read', file: fileRel, line: lineNumberAt(source, match.index), snippet: match[0] });
    }
  }

  // ---- Allowlist self-checks ----------------------------------------------

  // A JS-set var's owner file must still set the property.
  for (const [prop, owners] of Object.entries(JS_SET_VARS)) {
    for (const owner of owners) {
      const ownerPath = tsFiles.find((f) => f.endsWith(`/${owner}`));
      if (!ownerPath || !sources.get(ownerPath).includes(prop)) {
        violations.push({
          rule: 'allowlist/orphaned-js-var',
          file: `(allowlist) ${prop} → ${owner}`,
          line: 0,
          snippet: 'owner file no longer sets this property — remove the entry from JS_SET_VARS',
        });
      }
    }
  }

  // An off-grid boundary must still be registered.
  const registerPath =
    options.registerPath ?? join(resolve(root, '..'), '.agents', 'design-overrides.md');
  const register = existsSync(registerPath) ? readFileSync(registerPath, 'utf8') : '';
  for (const boundary of Object.keys(OFFGRID_ALLOWLIST)) {
    if (!register.includes(`min-[${boundary}px]`)) {
      violations.push({
        rule: 'allowlist/orphaned-breakpoint',
        file: `(allowlist) min-[${boundary}px]`,
        line: 0,
        snippet: 'boundary missing from .agents/design-overrides.md — re-register or remove from OFFGRID_ALLOWLIST',
      });
    }
  }

  return { ok: violations.length === 0, violations, stats };
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

export function formatReport(result) {
  const lines = ['Design-token drift check:'];
  lines.push(
    `  ${result.stats.tsFiles} TS/TSX files, ${result.stats.cssFiles} CSS files, ${result.stats.cssVars} custom properties scanned`,
  );
  if (result.violations.length === 0) {
    lines.push('  no drift — all checks pass');
    return lines.join('\n');
  }
  lines.push('');
  lines.push(`  ${result.violations.length} violation(s):`);
  for (const v of result.violations) {
    const loc = v.line > 0 ? `${v.file}:${v.line}` : v.file;
    lines.push(`  ✗ [${v.rule}] ${loc} — ${v.snippet.trim().slice(0, 120)}`);
  }
  return lines.join('\n');
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const webRoot = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const result = collectDrift(webRoot);
    console.log(formatReport(result));
    if (!result.ok) {
      console.error('\ntoken-drift: drift detected.');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`token-drift: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

/**
 * appearance — the ONE appearance-resolution module.
 *
 * Both writers of the appearance data-* attributes resolve through here:
 *
 * - `useTheme.apply()` (stores/themeStore.ts) — the runtime writer, called
 *   on boot and on every settings change;
 * - the inline bootstrap in index.html — pre-paint, so it cannot import this
 *   module; it mirrors `resolveAppearanceAttributes` VERBATIM, and
 *   src/appearance-bootstrap-parity.test.ts executes BOTH implementations
 *   against a scenario matrix and fails the gate on any drift between them
 *   (the 2026-10-15 constitution ruling: two writers = drift waiting to
 *   happen; one resolver + a gated mirror is the only acceptable shape).
 *
 * The seam is the canonical data-attribute trio (owner ruling 2026-10-19,
 * constitution default 1): data-theme (light|dark), data-oled (true, only
 * with dark), data-accent. The CSS token file keys its blocks on these —
 * re-theming propagates with zero component edits.
 */

export const THEME_STORAGE_KEY = 'sonarly-theme';

/** The curated accent picker values (the [data-accent] blocks in index.css). */
export const ACCENT_VALUES = ['copper', 'green', 'purple', 'blue', 'monochrome'] as const;
export type AccentValue = (typeof ACCENT_VALUES)[number];

export type ThemeMode = 'auto' | 'light' | 'dark' | 'oled';

export interface AppearanceAttributes {
  /** The concrete theme painted on <html>: OLED resolves to dark + the oled flag. */
  theme: 'light' | 'dark';
  oled: boolean;
  accent: AccentValue;
  /** The persisted mode: the resolved light/dark for auto, else the pinned mode. */
  mode: 'light' | 'dark' | 'oled';
}

export interface StoredTheme {
  mode?: ThemeMode;
  accent?: AccentValue;
}

const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'auto' || value === 'light' || value === 'dark' || value === 'oled';

const isAccentValue = (value: unknown): value is AccentValue =>
  typeof value === 'string' && (ACCENT_VALUES as readonly string[]).includes(value);

/**
 * Parse a raw sonarly-theme snapshot. Accepts the JSON shape
 * ({ "mode": "…", "accent": "…" }) and the legacy bare-mode string
 * ("dark"|"light"|"oled") written by older clients. Anything unrecognized —
 * corrupt JSON, unknown enum values — yields {}, leaving the caller's
 * defaults. index.html's inline bootstrap validates the same values; the
 * parity test gates the two against each other.
 */
export function parseStoredTheme(raw: string | null): StoredTheme {
  if (raw === null) return {};
  if (raw === 'light' || raw === 'dark' || raw === 'oled') {
    return { mode: raw };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const { mode, accent } = parsed as Record<string, unknown>;
  const result: StoredTheme = {};
  if (isThemeMode(mode)) result.mode = mode;
  if (isAccentValue(accent)) result.accent = accent;
  return result;
}

/**
 * Resolve the persisted appearance settings to the concrete data-attribute
 * values. `readRaw` reads a localStorage key verbatim (raw string or null);
 * `systemDark` is the live `prefers-color-scheme` answer. Defaults: Auto
 * (follow system), OLED off, Echo Copper (the Signal Archive brand accent,
 * owner decision 2026-10-07). Stored values are validated — anything
 * unrecognized falls through to the default, never onto the DOM.
 */
export function resolveAppearanceAttributes(
  readRaw: (key: string) => string | null,
  systemDark: boolean,
): AppearanceAttributes {
  const stored = parseStoredTheme(readRaw(THEME_STORAGE_KEY));
  const modePref = stored.mode ?? 'auto';
  const theme: 'light' | 'dark' =
    modePref === 'auto' ? (systemDark ? 'dark' : 'light') : modePref === 'oled' ? 'dark' : modePref;
  return {
    theme,
    oled: modePref === 'oled',
    accent: stored.accent ?? 'copper',
    mode: modePref === 'auto' ? theme : modePref,
  };
}

import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'oled' | 'auto';
export type AccentColor =
  | 'auto'
  | 'copper'
  | 'monochrome'
  | 'brown'
  | 'green'
  | 'orange'
  | 'teal'
  | 'purple'
  | 'yellow'
  | 'cyan'
  | 'blue';

interface ThemeState {
  themeMode: ThemeMode;
  accentColor: AccentColor;
  setThemeMode: (themeMode: ThemeMode) => void;
  setAccentColor: (accentColor: AccentColor) => void;
  /** Seeds themeMode/accentColor from the persisted cold-boot snapshot. */
  loadPersisted: () => void;
  apply: () => void;
}

const THEME_STORAGE_KEY = 'sonarly-theme';

// Accents that can land on the DOM (and in storage). 'auto' is a valid
// preference but never persists: apply() stores the resolved accent, so the
// pre-hydration bootstrap and a cold-booted store read back the same value.
// 'copper' is the Signal Archive brand accent and the default (owner
// decision 2026-10-07, superseding the launch-day monochrome default).
const ACCENT_COLORS: AccentColor[] = [
  'copper',
  'monochrome',
  'brown',
  'green',
  'orange',
  'teal',
  'purple',
  'yellow',
  'cyan',
  'blue',
];

const accentClasses = ACCENT_COLORS.map((accent) => `accent-${accent}`);

const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'auto' || value === 'light' || value === 'dark' || value === 'oled';

const isAccentColor = (value: unknown): value is AccentColor =>
  typeof value === 'string' && (ACCENT_COLORS as string[]).includes(value);

function resolveAccent(accentColor: AccentColor): string {
  if (accentColor !== 'auto') return accentColor;
  // Default accent is Echo Copper, the Signal Archive brand signal
  // (owner decision 2026-10-07, superseding the launch-day monochrome
  // default). Light/dark tones come from the .accent-copper classes.
  return 'copper';
}

interface PersistedTheme {
  themeMode?: ThemeMode;
  accentColor?: AccentColor;
}

// Reads the sonarly-theme snapshot. Accepts the current JSON shape
// ({ "mode": "…", "accent": "…" }) and the legacy bare-mode string
// ("dark"|"light"|"oled") written by older clients. Anything unrecognized —
// corrupt JSON, unknown enum values — yields {}, leaving the store defaults.
// index.html's inline bootstrap validates the same values; keep them in sync.
function readPersistedTheme(): PersistedTheme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!stored) return {};
    if (stored === 'light' || stored === 'dark' || stored === 'oled') {
      return { themeMode: stored };
    }
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const { mode, accent } = parsed as Record<string, unknown>;
    const result: PersistedTheme = {};
    if (isThemeMode(mode)) result.themeMode = mode;
    if (isAccentColor(accent)) result.accentColor = accent;
    return result;
  } catch {
    return {};
  }
}

export const useTheme = create<ThemeState>((set, get) => ({
  themeMode: 'auto',
  accentColor: 'auto',
  setThemeMode: (themeMode) => {
    set({ themeMode });
    get().apply();
  },
  setAccentColor: (accentColor) => {
    set({ accentColor });
    get().apply();
  },
  loadPersisted: () => {
    set(readPersistedTheme());
  },
  apply: () => {
    const { themeMode, accentColor } = get();
    const html = document.documentElement;

    html.classList.remove('theme-light', 'theme-dark', 'theme-oled');
    html.classList.remove(...accentClasses);

    const resolvedMode =
      themeMode === 'auto'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : themeMode;

    const resolvedAccent = resolveAccent(accentColor);

    html.classList.add(`theme-${resolvedMode}`, `accent-${resolvedAccent}`);

    // Persist the RESOLVED values as { mode, accent } so the index.html
    // bootstrap can put the same classes on <html> before hydration — a cold
    // boot and this store then agree, with no first-paint re-theme. While
    // themeMode is 'auto', main.tsx re-applies on system preference changes,
    // keeping the stored snapshot fresh.
    try {
      window.localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ mode: resolvedMode, accent: resolvedAccent }),
      );
    } catch {
      // Ignore storage failures (private mode, disabled storage).
    }
  },
}));

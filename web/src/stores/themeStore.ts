import { create } from 'zustand';
import {
  THEME_STORAGE_KEY,
  parseStoredTheme,
  resolveAppearanceAttributes,
  type AccentValue,
  type ThemeMode,
} from '../lib/appearance.js';

export type { AccentValue, ThemeMode };
/** The store-level accent preference: the curated picker values or 'auto'. */
export type AccentColor = AccentValue | 'auto';

interface ThemeState {
  themeMode: ThemeMode;
  accentColor: AccentColor;
  setThemeMode: (themeMode: ThemeMode) => void;
  setAccentColor: (accentColor: AccentColor) => void;
  /** Seeds themeMode/accentColor from the persisted cold-boot snapshot. */
  loadPersisted: () => void;
  apply: () => void;
}

// 'auto' is a valid preference but never persists: apply() stores the
// resolved accent, so the pre-hydration bootstrap and a cold-booted store
// read back the same value. Five accents only (owner decision 2026-10-08):
// Copper is the Signal Archive brand accent and the default (owner decision
// 2026-10-07, superseding the launch-day monochrome default).

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
    const stored = parseStoredTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
    const patch: Partial<Pick<ThemeState, 'themeMode' | 'accentColor'>> = {};
    if (stored.mode !== undefined) patch.themeMode = stored.mode;
    if (stored.accent !== undefined) patch.accentColor = stored.accent;
    set(patch);
  },
  apply: () => {
    const { themeMode, accentColor } = get();
    const html = document.documentElement;

    // ONE resolution path: the store's current intent is fed to the shared
    // resolver as the snapshot shape, so runtime and pre-paint bootstrap
    // can never disagree (appearance.ts; parity test).
    const snapshot = JSON.stringify({ mode: themeMode, accent: accentColor });
    const resolved = resolveAppearanceAttributes(() => snapshot, window.matchMedia('(prefers-color-scheme: dark)').matches);

    html.dataset.theme = resolved.theme;
    if (resolved.oled) {
      html.dataset.oled = 'true';
    } else {
      delete html.dataset.oled;
    }
    html.dataset.accent = resolved.accent;

    // index.html hardcodes media-scoped <meta name="theme-color"> grounds for
    // light (#EEECE6) and dark (#171513); a media query cannot see the OLED
    // data attribute, so apply() repaints the dark meta for OLED's pure-black
    // ground and restores it when the mode changes back.
    const darkMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"][media*="dark"]',
    );
    if (darkMeta) {
      darkMeta.content = resolved.oled ? '#000000' : '#171513';
    }

    // Persist the RESOLVED values as { mode, accent } so the index.html
    // bootstrap can put the same attributes on <html> before hydration — a
    // cold boot and this store then agree, with no first-paint re-theme.
    // While themeMode is 'auto', main.tsx re-applies on system preference
    // changes, keeping the stored snapshot fresh.
    try {
      window.localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ mode: resolved.mode, accent: resolved.accent }),
      );
    } catch {
      // Ignore storage failures (private mode, disabled storage).
    }
  },
}));

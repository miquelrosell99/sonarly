import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'oled' | 'auto';
export type AccentColor =
  | 'auto'
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
  apply: () => void;
}

const THEME_STORAGE_KEY = 'sonarly-theme';

const accentClasses = [
  'accent-auto',
  'accent-monochrome',
  'accent-brown',
  'accent-green',
  'accent-orange',
  'accent-teal',
  'accent-purple',
  'accent-yellow',
  'accent-cyan',
  'accent-blue',
];

function resolveAccent(accentColor: AccentColor, resolvedMode: 'light' | 'dark' | 'oled'): string {
  if (accentColor !== 'auto') return accentColor;
  return resolvedMode === 'light' ? 'blue' : 'cyan';
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

    const resolvedAccent = resolveAccent(accentColor, resolvedMode);

    html.classList.add(`theme-${resolvedMode}`, `accent-${resolvedAccent}`);

    // Persist the resolved mode so the index.html bootstrap can apply it
    // before hydration. For 'auto' this stores the currently resolved mode;
    // main.tsx re-applies on system preference changes, keeping it fresh.
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, resolvedMode);
    } catch {
      // Ignore storage failures (private mode, disabled storage).
    }
  },
}));

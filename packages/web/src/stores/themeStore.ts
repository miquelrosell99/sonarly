import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'oled' | 'auto';
export type AccentColor = 'monochrome' | 'brown' | 'green' | 'orange' | 'teal' | 'purple' | 'yellow';

interface ThemeState {
  themeMode: ThemeMode;
  accentColor: AccentColor;
  setThemeMode: (themeMode: ThemeMode) => void;
  setAccentColor: (accentColor: AccentColor) => void;
  apply: () => void;
}

const accentClasses = [
  'accent-monochrome',
  'accent-brown',
  'accent-green',
  'accent-orange',
  'accent-teal',
  'accent-purple',
  'accent-yellow',
];

export const useTheme = create<ThemeState>((set, get) => ({
  themeMode: 'auto',
  accentColor: 'monochrome',
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

    html.classList.add(`theme-${resolvedMode}`, `accent-${accentColor}`);
  },
}));

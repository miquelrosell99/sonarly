import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from './themeStore';

const THEME_STORAGE_KEY = 'sonarly-theme';

let darkPreference = false;

function appliedDataset(): Record<string, string> {
  const dataset: Record<string, string> = {};
  for (const [key, value] of Object.entries(document.documentElement.dataset)) {
    if (value !== undefined) dataset[key] = value;
  }
  return dataset;
}

beforeAll(() => {
  // jsdom does not implement matchMedia; the store only queries
  // prefers-color-scheme. darkPreference toggles the result per test.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-color-scheme: dark') ? darkPreference : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  window.localStorage.clear();
  for (const attr of ['theme', 'oled', 'accent']) {
    delete document.documentElement.dataset[attr as 'theme'];
  }
  darkPreference = false;
  useTheme.setState({ themeMode: 'auto', accentColor: 'auto' });
});

describe('themeStore accent resolution', () => {
  it('auto accent resolves to copper in every mode (the brand default)', () => {
    for (const mode of ['light', 'dark', 'oled'] as const) {
      useTheme.setState({ themeMode: mode, accentColor: 'auto' });
      useTheme.getState().apply();
      const applied = appliedDataset();
      expect(applied.accent).toBe('copper');
      expect(applied.theme).toBe(mode === 'oled' ? 'dark' : mode);
      if (mode === 'oled') {
        expect(applied.oled).toBe('true');
      } else {
        expect(applied.oled).toBeUndefined();
      }
    }
  });

  it('an explicit accent choice is applied unchanged', () => {
    useTheme.setState({ themeMode: 'dark' });
    useTheme.getState().setAccentColor('green');
    expect(appliedDataset().accent).toBe('green');
  });
});

describe('themeStore persistence (sonarly-theme)', () => {
  it('round-trips the JSON form: write, cold-boot read, reapply', () => {
    useTheme.setState({ themeMode: 'dark' });
    useTheme.getState().setAccentColor('green');

    expect(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY)!)).toEqual({
      mode: 'dark',
      accent: 'green',
    });

    // Cold boot: fresh store state, then the main.tsx sequence.
    useTheme.setState({ themeMode: 'auto', accentColor: 'auto' });
    useTheme.getState().loadPersisted();
    expect(useTheme.getState().themeMode).toBe('dark');
    expect(useTheme.getState().accentColor).toBe('green');

    useTheme.getState().apply();
    const applied = appliedDataset();
    expect(applied.theme).toBe('dark');
    expect(applied.accent).toBe('green');
  });

  it('accepts the legacy bare-mode string written by older clients', () => {
    // Pre-upgrade storage fixture: apply() used to persist the bare mode.
    window.localStorage.setItem(THEME_STORAGE_KEY, 'oled');

    useTheme.getState().loadPersisted();

    expect(useTheme.getState().themeMode).toBe('oled');
    expect(useTheme.getState().accentColor).toBe('auto');
    useTheme.getState().apply();
    const applied = appliedDataset();
    expect(applied.theme).toBe('dark');
    expect(applied.oled).toBe('true');
    expect(applied.accent).toBe('copper');
    // The read upgrades the snapshot to the JSON form on the next write.
    expect(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY)!)).toEqual({
      mode: 'oled',
      accent: 'copper',
    });
  });

  it('persists the resolved values when the mode is auto', () => {
    darkPreference = true;
    useTheme.getState().apply();
    expect(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY)!)).toEqual({
      mode: 'dark',
      accent: 'copper',
    });
  });

  it('ignores corrupt or unrecognized storage', () => {
    for (const fixture of ['not json {', '"dark"', '42', 'null', 'true']) {
      window.localStorage.setItem(THEME_STORAGE_KEY, fixture);
      useTheme.setState({ themeMode: 'light', accentColor: 'purple' });
      useTheme.getState().loadPersisted();
      expect(useTheme.getState().themeMode).toBe('light');
      expect(useTheme.getState().accentColor).toBe('purple');
    }

    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ mode: 'rainbow', accent: 'magenta' }),
    );
    useTheme.setState({ themeMode: 'light', accentColor: 'purple' });
    useTheme.getState().loadPersisted();
    expect(useTheme.getState().themeMode).toBe('light');
    expect(useTheme.getState().accentColor).toBe('purple');
  });
});

describe('cold boot (inline bootstrap → hydration)', () => {
  it('keeps the attributes the inline bootstrap painted: dark + stored accent, no flip', () => {
    // Previous session persisted dark + purple.
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ mode: 'dark', accent: 'purple' }),
    );
    // index.html ran pre-hydration and painted exactly these attributes.
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.accent = 'purple';

    // main.tsx: seed from the snapshot, then apply.
    useTheme.getState().loadPersisted();
    useTheme.getState().apply();

    const applied = appliedDataset();
    expect(applied.theme).toBe('dark');
    expect(applied.accent).toBe('purple');
    expect(applied.oled).toBeUndefined();
    expect(useTheme.getState().themeMode).toBe('dark');
    expect(useTheme.getState().accentColor).toBe('purple');
  });

  it('agrees with the bootstrap for a legacy stored mode and no stored accent', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.accent = 'copper';

    useTheme.getState().loadPersisted();
    useTheme.getState().apply();

    const applied = appliedDataset();
    expect(applied.theme).toBe('light');
    expect(applied.accent).toBe('copper');
  });

  it('agrees with the bootstrap on a first visit (auto resolves via matchMedia on both sides)', () => {
    darkPreference = true;
    // Nothing stored: index.html resolved matchMedia and fell back to the
    // copper brand default.
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.accent = 'copper';

    useTheme.getState().loadPersisted();
    useTheme.getState().apply();

    const applied = appliedDataset();
    expect(applied.theme).toBe('dark');
    expect(applied.accent).toBe('copper');
    expect(useTheme.getState().themeMode).toBe('auto');
  });

  it('agrees with the bootstrap for OLED: dark theme + the oled flag', () => {
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ mode: 'oled', accent: 'blue' }),
    );
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.oled = 'true';
    document.documentElement.dataset.accent = 'blue';

    useTheme.getState().loadPersisted();
    useTheme.getState().apply();

    const applied = appliedDataset();
    expect(applied.theme).toBe('dark');
    expect(applied.oled).toBe('true');
    expect(applied.accent).toBe('blue');
  });
});

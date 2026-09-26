import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from './themeStore';

const THEME_STORAGE_KEY = 'sonarly-theme';

let darkPreference = false;

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
  document.documentElement.className = '';
  darkPreference = false;
  useTheme.setState({ themeMode: 'auto', accentColor: 'auto' });
});

describe('themeStore accent resolution', () => {
  it('auto accent resolves to monochrome in every mode (black on light, white on dark)', () => {
    for (const mode of ['light', 'dark', 'oled'] as const) {
      useTheme.setState({ themeMode: mode, accentColor: 'auto' });
      useTheme.getState().apply();
      const applied = document.documentElement.className;
      expect(applied).toContain(`theme-${mode}`);
      expect(applied).toContain('accent-monochrome');
      expect(applied).not.toContain('accent-blue');
      expect(applied).not.toContain('accent-cyan');
    }
  });

  it('an explicit accent choice is applied unchanged', () => {
    useTheme.setState({ themeMode: 'dark' });
    useTheme.getState().setAccentColor('green');
    expect(document.documentElement.className).toContain('accent-green');
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
    expect(document.documentElement.className).toContain('theme-dark');
    expect(document.documentElement.className).toContain('accent-green');
  });

  it('accepts the legacy bare-mode string written by older clients', () => {
    // Pre-upgrade storage fixture: apply() used to persist the bare mode.
    window.localStorage.setItem(THEME_STORAGE_KEY, 'oled');

    useTheme.getState().loadPersisted();

    expect(useTheme.getState().themeMode).toBe('oled');
    expect(useTheme.getState().accentColor).toBe('auto');
    useTheme.getState().apply();
    expect(document.documentElement.className).toContain('theme-oled');
    expect(document.documentElement.className).toContain('accent-monochrome');
    // The read upgrades the snapshot to the JSON form on the next write.
    expect(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY)!)).toEqual({
      mode: 'oled',
      accent: 'monochrome',
    });
  });

  it('persists the resolved values when the mode is auto', () => {
    darkPreference = true;
    useTheme.getState().apply();
    expect(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY)!)).toEqual({
      mode: 'dark',
      accent: 'monochrome',
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
  it('keeps the classes the inline bootstrap painted: dark + stored accent, no flip', () => {
    // Previous session persisted dark + purple.
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ mode: 'dark', accent: 'purple' }),
    );
    // index.html ran pre-hydration and painted exactly these classes.
    document.documentElement.className = 'theme-dark accent-purple';

    // main.tsx: seed from the snapshot, then apply.
    useTheme.getState().loadPersisted();
    useTheme.getState().apply();

    const applied = document.documentElement.className;
    expect(applied).toContain('theme-dark');
    expect(applied).toContain('accent-purple');
    expect(applied).not.toContain('accent-monochrome');
    expect(applied).not.toContain('accent-blue');
    expect(applied).not.toContain('accent-cyan');
    expect(useTheme.getState().themeMode).toBe('dark');
    expect(useTheme.getState().accentColor).toBe('purple');
  });

  it('agrees with the bootstrap for a legacy stored mode and no stored accent', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    document.documentElement.className = 'theme-light accent-monochrome';

    useTheme.getState().loadPersisted();
    useTheme.getState().apply();

    const applied = document.documentElement.className;
    expect(applied).toContain('theme-light');
    expect(applied).toContain('accent-monochrome');
  });

  it('agrees with the bootstrap on a first visit (auto resolves via matchMedia on both sides)', () => {
    darkPreference = true;
    // Nothing stored: index.html resolved matchMedia and fell back to the
    // monochrome default.
    document.documentElement.className = 'theme-dark accent-monochrome';

    useTheme.getState().loadPersisted();
    useTheme.getState().apply();

    const applied = document.documentElement.className;
    expect(applied).toContain('theme-dark');
    expect(applied).toContain('accent-monochrome');
    expect(useTheme.getState().themeMode).toBe('auto');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { useTheme } from './themeStore';

describe('themeStore accent resolution', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useTheme.setState({ themeMode: 'auto', accentColor: 'auto' });
  });

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

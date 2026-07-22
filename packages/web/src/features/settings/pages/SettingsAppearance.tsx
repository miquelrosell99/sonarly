import { useEffect } from 'react';
import { Settings } from '../components/Settings.js';
import { useTheme } from '../../../stores/themeStore.js';
import { usePreferences, useUpdatePreferences } from '../../../hooks/usePreferences.js';
import { cn } from '../../../lib/cn.js';
import type { ThemeMode, AccentColor } from '@sonarly/shared';

const themeModes: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'oled', label: 'OLED' },
  { value: 'auto', label: 'Auto' },
];

const accentColors: { value: AccentColor; label: string; className: string }[] = [
  { value: 'monochrome', label: 'Monochrome', className: 'bg-fg-primary' },
  { value: 'brown', label: 'Brown', className: 'bg-[hsl(25,40%,45%)]' },
  { value: 'green', label: 'Green', className: 'bg-[hsl(142,71%,45%)]' },
  { value: 'orange', label: 'Orange', className: 'bg-[hsl(25,95%,53%)]' },
  { value: 'teal', label: 'Teal', className: 'bg-[hsl(174,72%,43%)]' },
  { value: 'purple', label: 'Purple', className: 'bg-[hsl(270,60%,55%)]' },
  { value: 'yellow', label: 'Yellow', className: 'bg-[hsl(45,93%,47%)]' },
];

export function SettingsAppearance() {
  const { themeMode, accentColor, setThemeMode, setAccentColor } = useTheme();
  const { data: preferences } = usePreferences();
  const updatePreferences = useUpdatePreferences();

  useEffect(() => {
    if (!preferences) return;
    if (preferences.themeMode && preferences.themeMode !== themeMode) {
      setThemeMode(preferences.themeMode);
    }
    if (preferences.accentColor && preferences.accentColor !== accentColor) {
      setAccentColor(preferences.accentColor);
    }
  }, [preferences, themeMode, accentColor, setThemeMode, setAccentColor]);

  const handleThemeMode = (mode: ThemeMode) => {
    setThemeMode(mode);
    updatePreferences.mutate({ themeMode: mode });
  };

  const handleAccentColor = (color: AccentColor) => {
    setAccentColor(color);
    updatePreferences.mutate({ accentColor: color });
  };

  return (
    <Settings>
      <div className="max-w-2xl space-y-8">
        <section>
          <h3 className="mb-4 text-base font-medium">Theme</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {themeModes.map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => handleThemeMode(mode.value)}
                className={cn(
                  'rounded-md border px-4 py-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  themeMode === mode.value
                    ? 'border-accent bg-surface-hover text-fg-primary'
                    : 'border-rule bg-surface text-fg-primary hover:bg-surface-hover',
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-4 text-base font-medium">Accent color</h3>
          <div className="flex flex-wrap gap-3">
            {accentColors.map((color) => (
              <button
                key={color.value}
                type="button"
                onClick={() => handleAccentColor(color.value)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-md border p-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  accentColor === color.value
                    ? 'border-accent bg-surface-hover'
                    : 'border-rule bg-surface hover:bg-surface-hover',
                )}
                title={color.label}
              >
                <span className={cn('h-8 w-8 rounded-full border border-rule', color.className)} />
                <span className="text-xs text-muted">{color.label}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </Settings>
  );
}

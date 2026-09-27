import { Settings } from '../components/Settings.js';
import { SettingsCard } from '../components/SettingsCard.js';
import { useTheme } from '../../../stores/themeStore.js';
import { useSettingsDraft, useSettingsSaveBar } from '../hooks/useSettingsDraft.js';
import { cn } from '../../../lib/cn.js';
import type { ThemeMode, AccentColor } from '../../../types';

const themeModes: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'oled', label: 'OLED' },
  { value: 'auto', label: 'Auto' },
];

const accentColors: { value: AccentColor; label: string; className: string }[] = [
  { value: 'auto', label: 'Auto (monochrome)', className: 'bg-gradient-to-br from-black to-white' },
  { value: 'monochrome', label: 'Monochrome', className: 'bg-fg-primary' },
  { value: 'brown', label: 'Brown', className: 'bg-[hsl(var(--accent-brown))]' },
  { value: 'green', label: 'Green', className: 'bg-[hsl(var(--accent-green))]' },
  { value: 'orange', label: 'Orange', className: 'bg-[hsl(var(--accent-orange))]' },
  { value: 'teal', label: 'Teal', className: 'bg-[hsl(var(--accent-teal))]' },
  { value: 'purple', label: 'Purple', className: 'bg-[hsl(var(--accent-purple))]' },
  { value: 'yellow', label: 'Yellow', className: 'bg-[hsl(var(--accent-yellow))]' },
  { value: 'cyan', label: 'Cyan', className: 'bg-[hsl(var(--accent-cyan))]' },
  { value: 'blue', label: 'Blue', className: 'bg-[hsl(var(--accent-blue))]' },
];

export function SettingsAppearance() {
  return (
    <Settings>
      <AppearanceSettings />
    </Settings>
  );
}

function AppearanceSettings() {
  const { values, update } = useSettingsDraft();
  useSettingsSaveBar();

  // The theme store is the pre-hydration snapshot (instant paint); staged
  // edits win over it, and the PATCH response stays the single writer (FF8):
  // the saved theme only takes visual effect once "Save changes" succeeds.
  const themeSnapshot = useTheme();
  const themeMode = values.themeMode ?? themeSnapshot.themeMode;
  const accentColor = values.accentColor ?? themeSnapshot.accentColor;

  return (
    <div className="w-full max-w-3xl space-y-6">
      <SettingsCard
        icon="mdi-weather-night"
        title="Theme"
        description="Choose how Sonarly looks on this device. Auto follows your system."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {themeModes.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => update({ themeMode: mode.value })}
              aria-pressed={themeMode === mode.value}
              className={cn(
                'rounded-md border px-4 py-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                themeMode === mode.value
                  ? 'border-accent bg-surface-hover text-fg-primary'
                  : 'border-rule bg-bg-primary text-fg-primary hover:bg-surface-hover',
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        icon="mdi-palette"
        title="Accent color"
        description="Tint highlights and controls across the app."
      >
        <div className="flex flex-wrap gap-3">
          {accentColors.map((color) => (
            <button
              key={color.value}
              type="button"
              onClick={() => update({ accentColor: color.value })}
              aria-label={color.label}
              aria-pressed={accentColor === color.value}
              title={color.label}
              className={cn(
                'h-11 w-11 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
                color.className,
                accentColor === color.value
                  ? 'ring-2 ring-fg-primary ring-offset-2 ring-offset-bg-primary'
                  : 'hover:scale-105',
              )}
            />
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}

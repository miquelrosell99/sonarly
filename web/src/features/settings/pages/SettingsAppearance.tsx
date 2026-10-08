import { useEffect, useRef } from 'react';
import { Settings } from '../components/Settings.js';
import { SettingsCard } from '../components/SettingsCard.js';
import { useTheme } from '../../../stores/themeStore.js';
import { useSettingsDraft, useSettingsSaveBar } from '../hooks/useSettingsDraft.js';
import { usePreferences } from '../../../hooks/usePreferences.js';
import { cn } from '../../../lib/cn.js';
import type { ThemeMode, AccentColor } from '../../../types';

const themeModes: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'oled', label: 'OLED' },
  { value: 'auto', label: 'Auto' },
];

const accentColors: { value: AccentColor; label: string; className: string }[] = [
  { value: 'copper', label: 'Copper', className: 'bg-[hsl(var(--accent-copper))]' },
  { value: 'green', label: 'Green', className: 'bg-[hsl(var(--accent-green))]' },
  { value: 'purple', label: 'Purple', className: 'bg-[hsl(var(--accent-purple))]' },
  { value: 'blue', label: 'Blue', className: 'bg-[hsl(var(--accent-blue))]' },
  { value: 'monochrome', label: 'Monochrome', className: 'bg-fg-primary' },
];

// Live preview: theme and accent edits repaint the app immediately through
// the theme store while the draft only stages them — the PATCH response
// stays the single writer of what is persisted (FF8). Navigating away with
// unsaved changes settles the store back on the persisted preferences, and
// Discard does the same via the reverted draft values.
function useLiveThemePreview(
  themeMode: ThemeMode | undefined,
  accentColor: AccentColor | undefined,
): void {
  const { data: serverPrefs } = usePreferences();
  const appliedRef = useRef<{ mode?: ThemeMode; accent?: AccentColor }>({});
  // Latest fetched preferences, read by the unmount-only revert below. A ref
  // (not an effect dep): running that revert on every preferences change
  // would undo the live preview each time the query cache updates — e.g.
  // right after a successful save.
  const serverRef = useRef(serverPrefs);
  serverRef.current = serverPrefs;

  useEffect(() => {
    const theme = useTheme.getState();
    const nextMode = themeMode ?? theme.themeMode;
    const nextAccent = accentColor ?? theme.accentColor;
    if (appliedRef.current.mode !== nextMode) theme.setThemeMode(nextMode);
    if (appliedRef.current.accent !== nextAccent) theme.setAccentColor(nextAccent);
    appliedRef.current = { mode: nextMode, accent: nextAccent };
  }, [themeMode, accentColor]);

  useEffect(() => {
    return () => {
      const saved = serverRef.current;
      const theme = useTheme.getState();
      if (saved?.themeMode) theme.setThemeMode(saved.themeMode);
      if (saved?.accentColor) theme.setAccentColor(saved.accentColor);
    };
  }, []);
}

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

  // The theme store is the pre-hydration snapshot (instant paint). Theme and
  // accent edits preview live through it (useLiveThemePreview); the PATCH
  // response stays the single writer (FF8) of what is persisted.
  const themeSnapshot = useTheme();
  const themeMode = values.themeMode ?? themeSnapshot.themeMode;
  const accentColor = values.accentColor ?? themeSnapshot.accentColor;
  useLiveThemePreview(themeMode, accentColor);

  return (
    <div className="w-full space-y-6">
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
        {/* macOS-style accent picker: wrapping swatches, ring on the active
            one. Legacy stored 'auto' accents display as Copper (what auto
            resolves to); picking any option stages a concrete accent. */}
        <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap gap-3">
          {accentColors.map((color) => {
            const selected = color.value === (accentColor === 'auto' ? 'copper' : accentColor);
            return (
              <button
                key={color.value}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={color.label}
                title={color.label}
                onClick={() => update({ accentColor: color.value })}
                className={cn(
                  'h-10 w-10 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
                  color.className,
                  selected
                    ? 'ring-2 ring-fg-primary ring-offset-2 ring-offset-bg-primary'
                    : 'hover:scale-105',
                )}
              />
            );
          })}
        </div>
      </SettingsCard>
    </div>
  );
}


import { useEffect, useRef, useState } from 'react';
import { Settings } from '../components/Settings.js';
import { SettingsCard } from '../components/SettingsCard.js';
import { useTheme } from '../../../stores/themeStore.js';
import { useSettingsDraft, useSettingsSaveBar } from '../hooks/useSettingsDraft.js';
import { usePreferences } from '../../../hooks/usePreferences.js';
import { cn } from '../../../lib/cn.js';
import { Icon } from '../../../components/ui/Icon.js';
import type { ThemeMode, AccentColor } from '../../../types';

const themeModes: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'oled', label: 'OLED' },
  { value: 'auto', label: 'Auto' },
];

const accentColors: { value: AccentColor; label: string; className: string }[] = [
  { value: 'copper', label: 'Copper', className: 'bg-[hsl(var(--accent-copper))]' },
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
        {/* Legacy stored 'auto' accents display as Copper (what auto
            resolves to); picking any option stages a concrete accent. */}
        <AccentDropdown
          value={accentColor === 'auto' ? 'copper' : accentColor}
          onChange={(value) => update({ accentColor: value })}
        />
      </SettingsCard>
    </div>
  );
}

function AccentDropdown({
  value,
  onChange,
}: {
  value: AccentColor;
  onChange: (value: AccentColor) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const selected = accentColors.find((color) => color.value === value) ?? accentColors[0];

  return (
    <div ref={ref} className="relative w-full max-w-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Accent color: ${selected.label}`}
        className="flex w-full items-center gap-2 rounded-lg border border-rule bg-surface px-3 py-2 text-sm font-medium text-fg-primary transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className={cn('h-4 w-4 shrink-0 rounded-full', selected.className)} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">{selected.label}</span>
        <Icon
          name="mdi-chevron-down"
          size={16}
          className={cn('shrink-0 text-fg-secondary transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-40 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-rule bg-surface p-1 shadow-xl"
        >
          {accentColors.map((color) => (
            <button
              key={color.value}
              type="button"
              role="option"
              aria-selected={color.value === value}
              onClick={() => {
                onChange(color.value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition',
                color.value === value
                  ? 'bg-accent/10 text-accent'
                  : 'text-fg-primary hover:bg-surface-hover',
              )}
            >
              <span className={cn('h-4 w-4 shrink-0 rounded-full', color.className)} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{color.label}</span>
              {color.value === value && <Icon name="mdi-check" size={16} className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

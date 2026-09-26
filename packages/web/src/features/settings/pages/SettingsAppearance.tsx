import { Link } from 'wouter';
import { Settings } from '../components/Settings.js';
import { useTheme } from '../../../stores/themeStore.js';
import { useUpdatePreferences } from '../../../hooks/usePreferences.js';
import { cn } from '../../../lib/cn.js';
import type { ThemeMode, AccentColor } from '@sonarly/shared';

const themeModes: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'oled', label: 'OLED' },
  { value: 'auto', label: 'Auto' },
];

const accentColors: { value: AccentColor; label: string; className: string }[] = [
  { value: 'auto', label: 'Auto', className: 'bg-gradient-to-br from-[hsl(var(--accent-blue))] to-[hsl(var(--accent-cyan))]' },
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
  const { themeMode, accentColor } = useTheme();
  const updatePreferences = useUpdatePreferences();

  // FF8: the PATCH mutation is the ONLY writer. The local theme store is
  // updated from the server response in useUpdatePreferences' onSuccess, so
  // a stale preferences refetch can never overwrite a local change.
  const handleThemeMode = (mode: ThemeMode) => {
    updatePreferences.mutate({ themeMode: mode });
  };

  const handleAccentColor = (color: AccentColor) => {
    updatePreferences.mutate({ accentColor: color });
  };

  return (
    <Settings>
      <div className="w-full space-y-8">
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
                aria-label={color.label}
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
        </section>

        <section>
          <h3 className="mb-4 text-base font-medium">Sidebar</h3>
          <p className="text-sm text-muted">
            Sidebar sections and their order are managed on the{' '}
            <Link href="/settings/sidebar" className="text-accent hover:underline">
              Sidebar settings
            </Link>{' '}
            page.
          </p>
        </section>
      </div>
    </Settings>
  );
}

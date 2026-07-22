import { useEffect, useRef } from 'react';
import { Settings } from '../components/Settings.js';
import { useTheme } from '../../../stores/themeStore.js';
import { usePreferences, useUpdatePreferences } from '../../../hooks/usePreferences.js';
import { cn } from '../../../lib/cn.js';
import { Icon } from '../../../components/ui/Icon.js';
import type { ThemeMode, AccentColor, SidebarItem } from '@sonarly/shared';

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

const DEFAULT_SIDEBAR_ITEMS: SidebarItem[] = [
  { id: 'home', type: 'link', visible: true },
  { id: 'albums', type: 'link', visible: true },
  { id: 'tracks', type: 'link', visible: true },
  { id: 'album-artists', type: 'link', visible: true },
  { id: 'artists', type: 'link', visible: true },
  { id: 'genres', type: 'link', visible: true },
  { id: 'playlists', type: 'playlists', visible: true, collapsed: false },
];

const SIDEBAR_LABELS: Record<string, string> = {
  home: 'Home',
  albums: 'Albums',
  tracks: 'Tracks',
  'album-artists': 'Album Artists',
  artists: 'Artists',
  genres: 'Genres',
  playlists: 'Playlists section',
};

export function SettingsAppearance() {
  const { themeMode, accentColor, setThemeMode, setAccentColor } = useTheme();
  const { data: preferences } = usePreferences();
  const updatePreferences = useUpdatePreferences();

  const themeModeRef = useRef(themeMode);
  const accentColorRef = useRef(accentColor);

  useEffect(() => {
    themeModeRef.current = themeMode;
    accentColorRef.current = accentColor;
  });

  useEffect(() => {
    if (!preferences) return;
    if (preferences.themeMode && preferences.themeMode !== themeModeRef.current) {
      setThemeMode(preferences.themeMode);
    }
    if (preferences.accentColor && preferences.accentColor !== accentColorRef.current) {
      setAccentColor(preferences.accentColor);
    }
  }, [preferences, setThemeMode, setAccentColor]);

  const handleThemeMode = (mode: ThemeMode) => {
    setThemeMode(mode);
    updatePreferences.mutate({ themeMode: mode });
  };

  const handleAccentColor = (color: AccentColor) => {
    setAccentColor(color);
    updatePreferences.mutate({ accentColor: color });
  };

  const sidebarItems = preferences?.sidebarConfig?.items ?? DEFAULT_SIDEBAR_ITEMS;

  const updateSidebarItems = (next: SidebarItem[]) => {
    updatePreferences.mutate({ sidebarConfig: { items: next } });
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= sidebarItems.length) return;
    const next = [...sidebarItems];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updateSidebarItems(next);
  };

  const toggleVisible = (index: number) => {
    const next = [...sidebarItems];
    const item = next[index];
    if (!item) return;
    next[index] = { ...item, visible: !item.visible };
    updateSidebarItems(next);
  };

  const togglePlaylistsCollapsed = () => {
    const next = sidebarItems.map((item) =>
      item.type === 'playlists' ? { ...item, collapsed: !item.collapsed } : item,
    );
    updateSidebarItems(next);
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

        <section>
          <h3 className="mb-4 text-base font-medium">Sidebar</h3>
          <p className="mb-4 text-sm text-muted">
            Show, hide, and reorder library navigation items.
          </p>
          <ul className="space-y-2">
            {sidebarItems.map((item, index) => {
              const label = SIDEBAR_LABELS[item.id] ?? item.id;
              const isPlaylists = item.type === 'playlists';
              return (
                <li
                  key={item.id}
                  className="flex items-center justify-between rounded-md border border-rule bg-surface px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={item.visible}
                      onChange={() => toggleVisible(index)}
                      aria-label={`Show ${label}`}
                      className="h-4 w-4 accent-accent"
                    />
                    <span className="text-sm">{label}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {isPlaylists && (
                      <button
                        type="button"
                        onClick={togglePlaylistsCollapsed}
                        title={item.collapsed ? 'Expand playlists section' : 'Collapse playlists section'}
                        className="rounded p-1 text-muted transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <Icon
                          name="mdi-chevron-down"
                          size={18}
                          className={cn('transition-transform', item.collapsed && '-rotate-90')}
                        />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => moveItem(index, -1)}
                      disabled={index === 0}
                      title="Move up"
                      className="rounded p-1 text-muted transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                    >
                      <Icon name="mdi-chevron-up" size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveItem(index, 1)}
                      disabled={index === sidebarItems.length - 1}
                      title="Move down"
                      className="rounded p-1 text-muted transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                    >
                      <Icon name="mdi-chevron-down" size={18} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </Settings>
  );
}

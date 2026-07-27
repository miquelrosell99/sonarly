import { useEffect, useRef, useState } from 'react';
import { Settings } from '../components/Settings.js';
import { useTheme } from '../../../stores/themeStore.js';
import { usePreferences, useUpdatePreferences } from '../../../hooks/usePreferences.js';
import { cn } from '../../../lib/cn.js';
import { Icon } from '../../../components/ui/Icon.js';
import { Button } from '../../../components/ui/Button.js';
import {
  DEFAULT_SIDEBAR_ITEMS,
  SIDEBAR_ITEM_DEFINITIONS,
  SIDEBAR_LABELS,
  mergeSidebarItems,
} from '../../../lib/sidebar.js';
import type { ThemeMode, AccentColor, SidebarItem } from '@sonarly/shared';

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

function createSidebarItem(def: (typeof SIDEBAR_ITEM_DEFINITIONS)[number]): SidebarItem {
  return { id: def.id, type: 'link', visible: true };
}

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

  const sidebarItems = mergeSidebarItems(preferences?.sidebarConfig);

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

  const removeItem = (index: number) => {
    const next = sidebarItems.filter((_, i) => i !== index);
    updateSidebarItems(next);
  };

  const addItem = (def: (typeof SIDEBAR_ITEM_DEFINITIONS)[number]) => {
    const next = [...sidebarItems, createSidebarItem(def)];
    updateSidebarItems(next);
    setAddOpen(false);
  };

  const resetSidebar = () => {
    updateSidebarItems(DEFAULT_SIDEBAR_ITEMS);
  };

  const [addOpen, setAddOpen] = useState(false);
  const addButtonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addOpen) return;
    const handleMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      const inside = addButtonRef.current?.contains(target) ?? false;
      if (!inside) setAddOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAddOpen(false);
    };
    document.addEventListener('mousedown', handleMouse);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouse);
      document.removeEventListener('keydown', handleKey);
    };
  }, [addOpen]);

  const currentIds = new Set(sidebarItems.map((item) => item.id));
  const availableItems = SIDEBAR_ITEM_DEFINITIONS.filter((def) => !currentIds.has(def.id));

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
                  'h-10 w-10 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
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
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-medium">Sidebar</h3>
              <p className="text-sm text-muted">Add, remove, and reorder library navigation sections.</p>
            </div>
            <div className="flex items-center gap-2">
              <div ref={addButtonRef} className="relative">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setAddOpen((open) => !open)}
                  disabled={availableItems.length === 0}
                  className="pl-4 pr-3"
                >
                  <Icon name="mdi-plus" size={18} />
                  Add section
                </Button>
                {addOpen && availableItems.length > 0 && (
                  <div className="absolute right-0 top-full z-50 mt-2 min-w-[12rem] rounded-md border border-rule bg-bg-primary py-1 shadow-lg">
                    {availableItems.map((def) => (
                      <button
                        key={def.id}
                        type="button"
                        onClick={() => addItem(def)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
                      >
                        <Icon name="mdi-plus" size={16} className="text-muted" />
                        {def.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={resetSidebar}
                title="Reset to default"
                className="px-3"
              >
                <Icon name="mdi-refresh" size={18} />
              </Button>
            </div>
          </div>

          <ul className="space-y-2">
            {sidebarItems.map((item, index) => {
              const label = SIDEBAR_LABELS[item.id] ?? item.id;
              return (
                <li
                  key={item.id}
                  className="flex items-center justify-between rounded-md border border-rule bg-surface px-3 py-2"
                >
                  <span className="text-sm">{label}</span>
                  <div className="flex items-center gap-1">
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
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      title="Remove"
                      aria-label={`Remove ${label}`}
                      className="rounded p-1 text-muted transition hover:bg-surface-hover hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Icon name="mdi-delete" size={18} />
                    </button>
                  </div>
                </li>
              );
            })}
            {sidebarItems.length === 0 && (
              <li className="rounded-md border border-dashed border-rule bg-surface px-3 py-6 text-center text-sm text-muted">
                No sections added. Use <strong>Add section</strong> to build your sidebar.
              </li>
            )}
          </ul>
        </section>
      </div>
    </Settings>
  );
}

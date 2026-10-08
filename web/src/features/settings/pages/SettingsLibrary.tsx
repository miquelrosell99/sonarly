import { useCallback, useMemo, useState } from 'react';
import { Settings } from '../components/Settings.js';
import { SettingsCard } from '../components/SettingsCard.js';
import { useSaveBar } from '../../../components/ui/SaveBar.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import {
  readDefaultViewModes,
  writeDefaultViewModes,
  type ViewMode,
} from '../../../hooks/usePersistentViewMode.js';

// Page keys mirror the viewModeKey each LibraryView page passes to
// usePersistentViewMode.
const viewModePages = [
  { key: 'tracks', label: 'Tracks' },
  { key: 'albums', label: 'Albums' },
  { key: 'artists', label: 'Artists' },
  { key: 'genres', label: 'Genres' },
  { key: 'years', label: 'Years' },
  { key: 'playlists', label: 'Playlists' },
];

const viewModeOptions: { value: ViewMode; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
];

function sameDefaults(a: Record<string, ViewMode>, b: Record<string, ViewMode>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export function SettingsLibrary() {
  return (
    <Settings>
      <LibrarySettings />
    </Settings>
  );
}

function LibrarySettings() {
  const { notify } = useNotification();
  const [baseline, setBaseline] = useState<Record<string, ViewMode>>(() => readDefaultViewModes());
  const [draft, setDraft] = useState<Record<string, ViewMode>>(baseline);
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => !sameDefaults(draft, baseline), [draft, baseline]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      writeDefaultViewModes(draft);
      setBaseline(draft);
      notify('Settings saved.', 'success');
    } catch {
      notify('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }, [draft, notify]);

  const discard = useCallback(() => setDraft(baseline), [baseline]);

  const controller = useMemo(
    () => (dirty ? { dirty, saving, onSave: save, onDiscard: discard } : null),
    [dirty, saving, save, discard],
  );
  useSaveBar(controller);

  const setPageMode = (key: string, mode: ViewMode) => {
    setDraft((prev) => ({ ...prev, [key]: mode }));
  };

  return (
    <div className="w-full">
      <SettingsCard
        icon="mdi-view-grid-outline"
        title="Default views"
        description="How each library page opens by default. Picking a view with the list/grid toggle on a page still overrides its default."
      >
        <ul className="divide-y divide-rule">
            {viewModePages.map((page) => {
              const value = draft[page.key] ?? '';
              return (
                <li key={page.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <span className="text-sm font-medium text-fg-primary">{page.label}</span>
                  <div
                    role="group"
                    aria-label={`${page.label} default view`}
                    className="inline-flex overflow-hidden rounded-md border border-rule"
                  >
                    {viewModeOptions.map((option) => {
                      const selected = value === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setPageMode(page.key, option.value)}
                          aria-pressed={selected}
                          className={`min-h-[40px] px-4 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            selected
                              ? 'bg-surface-hover font-medium text-accent'
                              : 'bg-bg-primary text-fg-secondary hover:bg-surface-hover hover:text-fg-primary'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
        </ul>
      </SettingsCard>
    </div>
  );
}

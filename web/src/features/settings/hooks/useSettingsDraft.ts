// Draft-based editing for the Settings pages: controls stage edits into the
// module-level draft store, the SaveBar (next to the Settings title) PATCHes
// them with one request, and the server response remains the single writer of
// truth (FF8): it seeds the preferences cache and the theme store.
//
// Robustness contract: a failed save keeps the draft intact and toasts the
// server message, so user input is never lost; pruning against the server
// value means changing a parameter back to its saved state clears the dirty
// flag without any request.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { UserPreferences } from '../../../types/index.js';
import { DEFAULT_USER_PREFERENCES } from '../../../types/index.js';
import { usePreferences, useUpdatePreferences } from '../../../hooks/usePreferences.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { useSaveBar } from '../../../components/ui/SaveBar.js';
import { useSettingsDraftStore } from '../stores/settingsDraftStore.js';

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  );
}

export interface SettingsDraft {
  /** Effective values: server preferences with the staged draft applied. */
  values: UserPreferences;
  /** Stage an edit; reverting to the saved value clears that key. */
  update: (patch: Partial<UserPreferences>) => void;
  dirty: boolean;
  /** Number of staged parameters (drives the save-bar hint). */
  changes: number;
  saving: boolean;
  save: () => Promise<void>;
  discard: () => void;
}

export function useSettingsDraft(): SettingsDraft {
  const { data: serverPrefs } = usePreferences();
  const updatePreferences = useUpdatePreferences();
  const { notify } = useNotification();
  const draft = useSettingsDraftStore((state) => state.draft);
  const replaceDraft = useSettingsDraftStore((state) => state.replace);
  const clearDraft = useSettingsDraftStore((state) => state.clear);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // The mutation result object is not guaranteed to be referentially stable
  // between renders; its mutateAsync is. Keeping it behind a ref keeps `save`
  // stable so the save-bar controller identity does not churn.
  const mutateAsyncRef = useRef(updatePreferences.mutateAsync);
  mutateAsyncRef.current = updatePreferences.mutateAsync;

  const serverRef = useRef(serverPrefs);
  serverRef.current = serverPrefs;

  const update = useCallback(
    (patch: Partial<UserPreferences>) => {
      const server = serverRef.current ?? {};
      const current = useSettingsDraftStore.getState().draft;
      const next: Partial<UserPreferences> = { ...current };
      for (const [key, value] of Object.entries(patch) as [keyof UserPreferences, unknown][]) {
        if (deepEqual(value, server[key])) {
          delete (next as Record<string, unknown>)[key];
        } else {
          (next as Record<string, unknown>)[key] = value;
        }
      }
      replaceDraft(next);
    },
    [replaceDraft],
  );

  const save = useCallback(async () => {
    const pending = useSettingsDraftStore.getState().draft;
    if (!serverRef.current || savingRef.current || Object.keys(pending).length === 0) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await mutateAsyncRef.current(pending);
      clearDraft();
      notify('Settings saved.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save settings', 'error');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [clearDraft, notify]);

  const discard = useCallback(() => clearDraft(), [clearDraft]);

  const values = useMemo(
    () => ({ ...DEFAULT_USER_PREFERENCES, ...serverPrefs, ...draft }) as UserPreferences,
    [serverPrefs, draft],
  );

  const changes = Object.keys(draft).length;

  return { values, update, dirty: changes > 0, changes, saving, save, discard };
}

/** Registers the settings save bar with the surrounding shell. */
export function useSettingsSaveBar(): void {
  const { dirty, saving, save, discard } = useSettingsDraft();
  const controller = useMemo(
    () => (dirty ? { dirty, saving, onSave: save, onDiscard: discard } : null),
    [dirty, saving, save, discard],
  );
  useSaveBar(controller);
}

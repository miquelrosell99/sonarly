import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserPreferences } from '../types';
import { api } from '../lib/api.js';
import { useTheme } from '../stores/themeStore.js';

export function usePreferences() {
  return useQuery<{ preferences: UserPreferences }, Error, UserPreferences>({
    queryKey: ['me', 'preferences'],
    queryFn: () => api('/me/preferences'),
    select: (data) => data.preferences,
    // Same 30s freshness convention as the library lists (audit F29); the
    // mutation writer (useUpdatePreferences) seeds the cache from its
    // response, so a remount-style refetch can never overwrite local writes.
    staleTime: 30_000,
  });
}

// Boot seeding (F3): the theme store is restored from localStorage before
// first paint (fast, flip-free), and the FIRST /me/preferences response that
// carries theme keys reseeds it from the server — the account's truth wins
// over this browser's snapshot (e.g. prefs changed on another device). After
// that seed, the PATCH response (useUpdatePreferences' onSuccess) is the only
// writer, so a stale refetch can never overwrite a local change (FF8).
// Logged-out visitors never mount the hook (it lives in the authenticated
// shell), so guests keep their localStorage snapshot and never 401 here.
// Flags are module-level because logout/login is a full page reload.
let themeSeededFromServer = false;
let themeWrittenByMutation = false;

/** Resets the boot-seed flags. Test-only. */
export function __resetThemeSyncForTests() {
  themeSeededFromServer = false;
  themeWrittenByMutation = false;
}

export function useSyncThemePreferences() {
  const { data: preferences } = usePreferences();
  useEffect(() => {
    if (themeSeededFromServer || themeWrittenByMutation) return;
    const themeMode = preferences?.themeMode;
    const accentColor = preferences?.accentColor;
    // Fresh accounts have no theme keys server-side; keep the local snapshot.
    if (!themeMode && !accentColor) return;
    themeSeededFromServer = true;
    if (themeMode) useTheme.getState().setThemeMode(themeMode);
    if (accentColor) useTheme.getState().setAccentColor(accentColor);
  }, [preferences?.themeMode, preferences?.accentColor]);
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  return useMutation<{ preferences: UserPreferences }, Error, Partial<UserPreferences>>({
    mutationFn: (body) => api('/me/preferences', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (data) => {
      // Seed the query cache from the server response (no refetch race) and —
      // FF8 single-writer rule — let the SERVER RESPONSE be the path that
      // writes theme preferences into the local theme store. Settings UI
      // must not call setThemeMode/setAccentColor directly; the boot seed
      // (useSyncThemePreferences) yields to any mutation that already wrote.
      themeWrittenByMutation = true;
      queryClient.setQueryData(['me', 'preferences'], data);
      const { themeMode, accentColor } = data.preferences;
      if (themeMode) useTheme.getState().setThemeMode(themeMode);
      if (accentColor) useTheme.getState().setAccentColor(accentColor);
    },
  });
}

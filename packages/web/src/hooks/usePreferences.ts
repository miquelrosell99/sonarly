import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserPreferences } from '@sonarly/shared';
import { api } from '../lib/api.js';
import { useTheme } from '../stores/themeStore.js';

export function usePreferences() {
  return useQuery<{ preferences: UserPreferences }, Error, UserPreferences>({
    queryKey: ['me', 'preferences'],
    queryFn: () => api('/me/preferences'),
    select: (data) => data.preferences,
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  return useMutation<{ preferences: UserPreferences }, Error, Partial<UserPreferences>>({
    mutationFn: (body) => api('/me/preferences', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (data) => {
      // Seed the query cache from the server response (no refetch race) and —
      // FF8 single-writer rule — let the SERVER RESPONSE be the only path
      // that writes theme preferences into the local theme store. Settings UI
      // must not call setThemeMode/setAccentColor directly; Layout no longer
      // pushes preferences into the store either.
      queryClient.setQueryData(['me', 'preferences'], data);
      const { themeMode, accentColor } = data.preferences;
      if (themeMode) useTheme.getState().setThemeMode(themeMode);
      if (accentColor) useTheme.getState().setAccentColor(accentColor);
    },
  });
}

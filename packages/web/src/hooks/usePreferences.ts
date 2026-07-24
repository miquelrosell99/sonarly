import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserPreferences } from '@sonarly/shared';
import { api } from '../api.js';

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me', 'preferences'] });
    },
  });
}

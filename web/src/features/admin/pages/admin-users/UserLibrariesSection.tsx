import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Library } from '../../../../types';
import { api } from '../../../../lib/api.js';
import { Checkbox } from '../../../../components/ui/checkbox.js';
import { useNotification } from '../../../../contexts/NotificationContext.js';

export function UserLibrariesSection({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { notify } = useNotification();

  const { data: libraries } = useQuery({
    queryKey: ['admin-libraries'],
    queryFn: async () => (await api<{ libraries: Library[] }>('/admin/libraries')).libraries,
  });

  const { data: assigned } = useQuery({
    queryKey: ['admin-user-libraries', userId],
    queryFn: async () => (await api<{ libraries: string[] }>(`/admin/users/${userId}/libraries`)).libraries,
    enabled: !!userId,
  });

  const assign = useMutation({
    mutationFn: async (libraryIds: string[]) =>
      api(`/admin/users/${userId}/libraries`, { method: 'POST', body: JSON.stringify({ libraryIds }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-user-libraries', userId] }),
    onError: (err) => notify(err instanceof Error ? err.message : 'Failed to assign library', 'error'),
  });

  const remove = useMutation({
    mutationFn: async (libraryId: string) =>
      api(`/admin/users/${userId}/libraries/${libraryId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-user-libraries', userId] }),
    onError: (err) => notify(err instanceof Error ? err.message : 'Failed to remove library', 'error'),
  });

  const assignedSet = new Set(assigned ?? []);
  const busy = assign.isPending || remove.isPending;

  const toggle = (libraryId: string, checked: boolean) => {
    if (checked) {
      assign.mutate([libraryId]);
    } else {
      remove.mutate(libraryId);
    }
  };

  const sortedLibraries = useMemo(() => {
    return [...(libraries ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  }, [libraries]);

  return (
    <div className="space-y-3 border-t border-outline pt-4">
      <h4 className="text-sm font-medium text-on-surface-variant">Libraries</h4>
      {!libraries || libraries.length === 0 ? (
        <p className="text-sm text-on-surface-variant">No libraries found.</p>
      ) : (
        <ul className="space-y-2">
          {sortedLibraries.map((library) => (
            <li
              key={library.id}
              className="flex items-center justify-between rounded-item border border-outline bg-background px-4 py-3"
            >
              <Checkbox
                id={`edit-user-library-${userId}-${library.id}`}
                label={library.name}
                description={library.path}
                checked={assignedSet.has(library.id)}
                onCheckedChange={(checked) => toggle(library.id, checked)}
                disabled={busy}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

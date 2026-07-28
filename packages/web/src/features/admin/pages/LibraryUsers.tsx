import { useParams, useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { User, Library } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Icon } from '../../../components/ui/Icon.js';
import { Checkbox } from '../../../components/ui/Checkbox.js';
import { Button } from '../../../components/ui/Button.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { AdminShell } from '../components/AdminShell.js';

interface AdminLibraryUsersProps {
  user: User;
}

export function LibraryUsers({ user }: AdminLibraryUsersProps) {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { notify } = useNotification();

  const { data: libraries } = useQuery({
    queryKey: ['admin-libraries'],
    queryFn: async () => (await api<{ libraries: Library[] }>('/admin/libraries')).libraries,
  });

  const library = libraries?.find((l) => l.id === id);

  const { data: users } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => (await api<{ users: User[] }>('/admin/users')).users,
  });

  const { data: assigned } = useQuery({
    queryKey: ['admin-library-users', id],
    queryFn: async () => (await api<{ users: string[] }>(`/admin/libraries/${id}/users`)).users,
    enabled: !!id,
  });

  const assign = useMutation({
    mutationFn: async (userIds: string[]) =>
      api(`/admin/libraries/${id}/users`, { method: 'POST', body: JSON.stringify({ userIds }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-library-users', id] }),
    onError: (err) => notify(err instanceof Error ? err.message : 'Failed to assign users', 'error'),
  });

  const remove = useMutation({
    mutationFn: async (userId: string) =>
      api(`/admin/libraries/${id}/users/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-library-users', id] }),
    onError: (err) => notify(err instanceof Error ? err.message : 'Failed to remove user', 'error'),
  });

  const assignedSet = new Set(assigned ?? []);

  const toggle = (userId: string, checked: boolean) => {
    if (checked) {
      assign.mutate([userId]);
    } else {
      remove.mutate(userId);
    }
  };

  return (
    <AdminShell user={user}>
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setLocation('/admin/libraries')} className="gap-1 px-2">
            <Icon name="mdi-arrow-left" size={18} />
            Back
          </Button>
          <h3 className="text-base font-medium">
            {library ? `Users for ${library.name}` : 'Library users'}
          </h3>
        </div>

        {!users || users.length === 0 ? (
          <p className="text-sm text-muted">No users found.</p>
        ) : (
          <ul className="space-y-2">
            {users.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between rounded-lg border border-rule bg-surface px-4 py-3"
              >
                <Checkbox
                  id={`library-user-${u.id}`}
                  label={u.username}
                  description={u.isAdmin ? 'Administrator' : 'User'}
                  checked={assignedSet.has(u.id)}
                  onChange={(e) => toggle(u.id, e.target.checked)}
                  disabled={assign.isPending || remove.isPending}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminShell>
  );
}

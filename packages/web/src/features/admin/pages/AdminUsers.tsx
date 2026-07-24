import { useEffect, useState } from 'react';
import type { User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { AdminShell } from '../components/AdminShell.js';

interface AdminUsersProps {
  user: User;
}

export function AdminUsers({ user }: AdminUsersProps) {
  const { notify } = useNotification();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ username: '', password: '', isAdmin: false });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateForm = (patch: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const load = async () => {
    try {
      const { users: list } = await api<{ users: User[] }>('/admin/users');
      setUsers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    }
  };

  useEffect(() => {
    if (!user.isAdmin) return;
    load();
  }, [user.isAdmin]);

  const create = async () => {
    if (!form.username.trim() || !form.password) return;
    setCreating(true);
    setError(null);
    try {
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username.trim(),
          password: form.password,
          isAdmin: form.isAdmin,
        }),
      });
      setForm({ username: '', password: '', isAdmin: false });
      notify('User created.', 'success');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  return (
    <AdminShell user={user}>
      <div className="space-y-4">
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <div className="space-y-3 border border-rule p-4">
          <Input
            placeholder="Username"
            value={form.username}
            onChange={(e) => updateForm({ username: e.target.value })}
          />
          <Input
            placeholder="Password"
            type="password"
            value={form.password}
            onChange={(e) => updateForm({ password: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isAdmin}
              onChange={(e) => updateForm({ isAdmin: e.target.checked })}
              className="rounded border-rule"
            />
            Admin
          </label>
          <Button onClick={create} disabled={creating || !form.username.trim() || !form.password}>
            Create User
          </Button>
        </div>

        <div className="border border-rule">
          <table className="w-full text-sm">
            <thead className="bg-surface">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-fg-primary">Username</th>
                <th className="px-4 py-2 text-left font-medium text-fg-primary">Name</th>
                <th className="px-4 py-2 text-left font-medium text-fg-primary">Admin</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-rule">
                  <td className="px-4 py-2">{u.username}</td>
                  <td className="px-4 py-2">{[u.name, u.surname].filter(Boolean).join(' ') || '-'}</td>
                  <td className="px-4 py-2">{u.isAdmin ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}

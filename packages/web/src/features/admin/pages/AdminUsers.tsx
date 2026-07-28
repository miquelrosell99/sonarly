import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Library, User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { Checkbox } from '../../../components/ui/Checkbox.js';
import { Modal } from '../../../components/ui/Modal.js';
import { ConfirmModal } from '../../../components/ui/ConfirmModal.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { AdminShell } from '../components/AdminShell.js';
import { useStatistics, StatisticsView } from '../../statistics/index.js';

interface AdminUsersProps {
  user: User;
}

const TRANSCODE_FORMATS: Array<NonNullable<User['transcodeFormat']>> = ['mp3', 'aac', 'opus'];
type UserRole = 'user' | 'administrator';

interface CreateForm {
  username: string;
  password: string;
  name: string;
  surname: string;
  email: string;
  role: UserRole;
  maxBitrateKbps: string;
  transcodeFormat: User['transcodeFormat'] | '';
}

interface EditForm {
  role: UserRole;
  name: string;
  surname: string;
  email: string;
  password: string;
  maxBitrateKbps: string;
  transcodeFormat: User['transcodeFormat'] | '';
  hideExplicit: boolean;
  blurExplicitTitles: boolean;
  blurExplicitCovers: boolean;
}

function parseBitrate(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = parseInt(trimmed, 10);
  if (Number.isNaN(n)) return undefined;
  return n;
}

function roleFromUser(isAdmin: boolean): UserRole {
  return isAdmin ? 'administrator' : 'user';
}

const emptyCreateForm: CreateForm = {
  username: '',
  password: '',
  name: '',
  surname: '',
  email: '',
  role: 'user',
  maxBitrateKbps: '',
  transcodeFormat: '',
};

const emptyEditForm: EditForm = {
  role: 'user',
  name: '',
  surname: '',
  email: '',
  password: '',
  maxBitrateKbps: '',
  transcodeFormat: '',
  hideExplicit: false,
  blurExplicitTitles: false,
  blurExplicitCovers: false,
};

export function AdminUsers({ user }: AdminUsersProps) {
  const { notify } = useNotification();
  const [users, setUsers] = useState<User[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyCreateForm);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(emptyEditForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [statsUser, setStatsUser] = useState<User | null>(null);
  const [statsRange, setStatsRange] = useState<'7d' | '30d' | '90d' | '1y' | 'all'>('all');
  const { data: statsData, isLoading: statsLoading, error: statsError } = useStatistics(
    'user',
    statsUser?.id,
    statsRange,
    !!statsUser,
  );

  const updateForm = (patch: Partial<CreateForm>) => {
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

  const openCreate = () => {
    setForm(emptyCreateForm);
    setError(null);
    setCreateOpen(true);
  };

  const closeCreate = () => {
    if (creating) return;
    setCreateOpen(false);
  };

  const create = async () => {
    if (!form.username.trim() || !form.password) return;
    setCreating(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        username: form.username.trim(),
        password: form.password,
        isAdmin: form.role === 'administrator',
        name: form.name.trim() || null,
        surname: form.surname.trim() || null,
        email: form.email.trim() || null,
      };
      if (form.transcodeFormat) body.transcodeFormat = form.transcodeFormat;
      const bitrate = parseBitrate(form.maxBitrateKbps);
      if (bitrate !== null) body.maxBitrateKbps = bitrate;

      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setCreateOpen(false);
      notify('User created.', 'success');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (u: User) => {
    setEditingUser(u);
    setEditForm({
      role: roleFromUser(u.isAdmin),
      name: u.name ?? '',
      surname: u.surname ?? '',
      email: u.email ?? '',
      password: '',
      maxBitrateKbps: u.maxBitrateKbps?.toString() ?? '',
      transcodeFormat: u.transcodeFormat ?? '',
      hideExplicit: u.hideExplicit ?? false,
      blurExplicitTitles: u.blurExplicitTitles ?? false,
      blurExplicitCovers: u.blurExplicitCovers ?? false,
    });
    setError(null);
  };

  const closeEdit = () => {
    if (saving) return;
    setEditingUser(null);
    setEditForm(emptyEditForm);
  };

  const saveEdit = async () => {
    if (!editingUser) return;
    const bitrate = parseBitrate(editForm.maxBitrateKbps);
    if (bitrate === undefined) {
      setError('Max bitrate must be a number');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        isAdmin: editForm.role === 'administrator',
        maxBitrateKbps: bitrate,
        transcodeFormat: editForm.transcodeFormat || null,
        name: editForm.name.trim() || null,
        surname: editForm.surname.trim() || null,
        email: editForm.email.trim() || null,
        hideExplicit: editForm.hideExplicit,
        blurExplicitTitles: editForm.blurExplicitTitles,
        blurExplicitCovers: editForm.blurExplicitCovers,
      };
      const password = editForm.password.trim();
      if (password) body.password = password;

      await api(`/admin/users/${editingUser.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      notify('User updated.', 'success');
      setEditingUser(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setSaving(false);
    }
  };

  const promptDelete = (id: string) => {
    if (id === user.id) {
      setError('You cannot delete your own account');
      return;
    }
    const target = users.find((u) => u.id === id);
    if (!target) return;
    const adminCount = users.filter((u) => u.isAdmin).length;
    if (target.isAdmin && adminCount <= 1) {
      setError('Cannot delete the last admin');
      return;
    }
    setUserToDelete(id);
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      await api(`/admin/users/${id}`, { method: 'DELETE' });
      setUserToDelete(null);
      notify('User deleted.', 'success');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeletingId(null);
    }
  };

  const formatLabel = (f?: User['transcodeFormat']) => f?.toUpperCase() ?? 'Original';
  const formatRole = (isAdmin: boolean) => (isAdmin ? 'Administrator' : 'User');

  const canDemoteOrDeleteAdmin = useMemo(() => {
    return users.filter((u) => u.isAdmin).length > 1;
  }, [users]);

  const createFooter = (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={closeCreate} disabled={creating}>
        Cancel
      </Button>
      <Button onClick={create} disabled={creating || !form.username.trim() || !form.password}>
        Create User
      </Button>
    </div>
  );

  const editFooter = (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={closeEdit} disabled={saving}>
        Cancel
      </Button>
      <Button onClick={saveEdit} disabled={saving}>
        Save Changes
      </Button>
    </div>
  );

  return (
    <AdminShell user={user}>
      <div className="space-y-4">
        {error && !createOpen && !editingUser && <p className="text-sm text-danger" role="alert">{error}</p>}

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-fg-secondary">
            {users.length} user{users.length === 1 ? '' : 's'}
          </h3>
          <Button onClick={openCreate}>Add User</Button>
        </div>

        <Modal open={createOpen} onClose={closeCreate} title="Add User" footer={createFooter}>
          <div className="space-y-4">
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <div className="space-y-1">
              <label htmlFor="user-username" className="block text-sm font-medium text-fg-secondary">Username</label>
              <Input
                id="user-username"
                placeholder="Username"
                value={form.username}
                onChange={(e) => updateForm({ username: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="user-password" className="block text-sm font-medium text-fg-secondary">Password</label>
              <Input
                id="user-password"
                placeholder="Password"
                type="password"
                value={form.password}
                onChange={(e) => updateForm({ password: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="user-name" className="block text-sm font-medium text-fg-secondary">Name</label>
                <Input
                  id="user-name"
                  placeholder="Name"
                  value={form.name}
                  onChange={(e) => updateForm({ name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="user-surname" className="block text-sm font-medium text-fg-secondary">Surname</label>
                <Input
                  id="user-surname"
                  placeholder="Surname"
                  value={form.surname}
                  onChange={(e) => updateForm({ surname: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="user-email" className="block text-sm font-medium text-fg-secondary">Email</label>
              <Input
                id="user-email"
                type="email"
                placeholder="Email"
                value={form.email}
                onChange={(e) => updateForm({ email: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="user-role" className="block text-sm font-medium text-fg-secondary">Role</label>
              <select
                id="user-role"
                className="input w-full"
                value={form.role}
                onChange={(e) => updateForm({ role: e.target.value as UserRole })}
              >
                <option value="user">User</option>
                <option value="administrator">Administrator</option>
              </select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="user-format" className="block text-sm font-medium text-fg-secondary">Transcode format</label>
                <select
                  id="user-format"
                  aria-label="Transcode format"
                  className="input w-full"
                  value={form.transcodeFormat}
                  onChange={(e) => updateForm({ transcodeFormat: e.target.value as User['transcodeFormat'] | '' })}
                >
                  <option value="">Original format</option>
                  {TRANSCODE_FORMATS.map((f) => (
                    <option key={f} value={f}>{f.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="user-bitrate" className="block text-sm font-medium text-fg-secondary">Max bitrate</label>
                <Input
                  id="user-bitrate"
                  type="number"
                  min={64}
                  max={320}
                  step={1}
                  placeholder="Max bitrate (kbps) — optional"
                  value={form.maxBitrateKbps}
                  onChange={(e) => updateForm({ maxBitrateKbps: e.target.value })}
                />
              </div>
            </div>
          </div>
        </Modal>

        <Modal
          open={!!editingUser}
          onClose={closeEdit}
          title={editingUser ? `Edit ${editingUser.username}` : 'Edit User'}
          footer={editFooter}
        >
          <div className="space-y-4">
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="edit-name" className="block text-sm font-medium text-fg-secondary">Name</label>
                <Input
                  id="edit-name"
                  placeholder="Name"
                  value={editForm.name}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="edit-surname" className="block text-sm font-medium text-fg-secondary">Surname</label>
                <Input
                  id="edit-surname"
                  placeholder="Surname"
                  value={editForm.surname}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, surname: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="edit-email" className="block text-sm font-medium text-fg-secondary">Email</label>
              <Input
                id="edit-email"
                type="email"
                placeholder="Email"
                value={editForm.email}
                onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="edit-password" className="block text-sm font-medium text-fg-secondary">New password</label>
              <Input
                id="edit-password"
                type="password"
                placeholder="Leave blank to keep current"
                value={editForm.password}
                onChange={(e) => setEditForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="edit-role" className="block text-sm font-medium text-fg-secondary">Role</label>
              <select
                id="edit-role"
                className="input w-full"
                value={editForm.role}
                disabled={editingUser?.id === user.id || (editingUser?.isAdmin === true && !canDemoteOrDeleteAdmin)}
                onChange={(e) => setEditForm((prev) => ({ ...prev, role: e.target.value as UserRole }))}
              >
                <option value="user">User</option>
                <option value="administrator">Administrator</option>
              </select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="edit-format" className="block text-sm font-medium text-fg-secondary">Transcode format</label>
                <select
                  id="edit-format"
                  aria-label="Transcode format"
                  className="input w-full"
                  value={editForm.transcodeFormat}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, transcodeFormat: e.target.value as User['transcodeFormat'] | '' }))}
                >
                  <option value="">Original format</option>
                  {TRANSCODE_FORMATS.map((f) => (
                    <option key={f} value={f}>{f.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="edit-bitrate" className="block text-sm font-medium text-fg-secondary">Max bitrate</label>
                <Input
                  id="edit-bitrate"
                  type="number"
                  min={64}
                  max={320}
                  step={1}
                  placeholder="Max bitrate (kbps) — optional"
                  value={editForm.maxBitrateKbps}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, maxBitrateKbps: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Checkbox
                label="Hide explicit"
                checked={editForm.hideExplicit}
                onChange={(e) => setEditForm((prev) => ({ ...prev, hideExplicit: e.target.checked }))}
              />
              <Checkbox
                label="Blur titles"
                checked={editForm.blurExplicitTitles}
                onChange={(e) => setEditForm((prev) => ({ ...prev, blurExplicitTitles: e.target.checked }))}
              />
              <Checkbox
                label="Blur covers"
                checked={editForm.blurExplicitCovers}
                onChange={(e) => setEditForm((prev) => ({ ...prev, blurExplicitCovers: e.target.checked }))}
              />
            </div>

            {editingUser && <UserLibrariesSection userId={editingUser.id} />}
          </div>
        </Modal>

        <Modal
          open={!!statsUser}
          onClose={() => setStatsUser(null)}
          title={statsUser ? `Statistics for ${statsUser.username}` : 'User Statistics'}
          className="max-w-7xl"
        >
          <StatisticsView
            data={statsData}
            range={statsRange}
            onRangeChange={setStatsRange}
            isLoading={statsLoading}
            error={statsError}
          />
        </Modal>

        <div className="overflow-x-auto rounded-md border border-rule">
          <table className="w-full text-sm">
            <thead className="bg-surface">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-fg-primary">Username</th>
                <th className="px-4 py-2 text-left font-medium text-fg-primary">Name</th>
                <th className="px-4 py-2 text-left font-medium text-fg-primary">Role</th>
                <th className="px-4 py-2 text-left font-medium text-fg-primary">Format</th>
                <th className="px-4 py-2 text-left font-medium text-fg-primary">Max bitrate</th>
                <th className="px-4 py-2 text-left font-medium text-fg-primary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === user.id;
                return (
                  <tr key={u.id} className="border-t border-rule">
                    <td className="px-4 py-2">{u.username}</td>
                    <td className="px-4 py-2">{[u.name, u.surname].filter(Boolean).join(' ') || '-'}</td>
                    <td className="px-4 py-2">{formatRole(u.isAdmin)}</td>
                    <td className="px-4 py-2">{formatLabel(u.transcodeFormat)}</td>
                    <td className="px-4 py-2">{u.maxBitrateKbps ? `${u.maxBitrateKbps} kbps` : 'Unlimited'}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={() => setStatsUser(u)}>
                          Stats
                        </Button>
                        <Button variant="ghost" onClick={() => startEdit(u)}>
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => promptDelete(u.id)}
                          disabled={deletingId === u.id || isSelf || (u.isAdmin && !canDemoteOrDeleteAdmin)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        open={userToDelete !== null}
        onClose={() => setUserToDelete(null)}
        title="Delete user"
        message={`Delete user "${users.find((u) => u.id === userToDelete)?.username ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => userToDelete && remove(userToDelete)}
      />
    </AdminShell>
  );
}

function UserLibrariesSection({ userId }: { userId: string }) {
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
    <div className="space-y-3 border-t border-rule pt-4">
      <h4 className="text-sm font-medium text-fg-secondary">Libraries</h4>
      {!libraries || libraries.length === 0 ? (
        <p className="text-sm text-muted">No libraries found.</p>
      ) : (
        <ul className="space-y-2">
          {sortedLibraries.map((library) => (
            <li
              key={library.id}
              className="flex items-center justify-between rounded-lg border border-rule bg-bg-primary px-4 py-3"
            >
              <Checkbox
                id={`edit-user-library-${userId}-${library.id}`}
                label={library.name}
                description={library.path}
                checked={assignedSet.has(library.id)}
                onChange={(e) => toggle(library.id, e.target.checked)}
                disabled={busy}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

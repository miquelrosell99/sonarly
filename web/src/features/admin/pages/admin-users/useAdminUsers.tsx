import { useEffect, useMemo, useState } from 'react';
import type { OverallStatistics, User, UserStatistics } from '../../../../types';
import { api } from '../../../../lib/api.js';
import { Button } from '../../../../components/ui/button.js';
import { type TableColumn } from '../../../../components/ui/Table.js';
import { useNotification } from '../../../../contexts/NotificationContext.js';
import { useStatistics } from '../../../statistics/index.js';
import {
  emptyCreateForm,
  emptyEditForm,
  formatLabel,
  formatRole,
  parseBitrate,
  roleFromUser,
  type CreateForm,
  type EditForm,
} from './userForms.js';

export interface AdminUsersState {
  user: User;
  users: User[];
  error: string | null;
  columns: TableColumn<User>[];
  canDemoteOrDeleteAdmin: boolean;
  create: {
    open: boolean;
    form: CreateForm;
    creating: boolean;
    openCreate: () => void;
    closeCreate: () => void;
    updateForm: (patch: Partial<CreateForm>) => void;
    submitCreate: () => Promise<void>;
  };
  edit: {
    editingUser: User | null;
    editForm: EditForm;
    saving: boolean;
    startEdit: (u: User) => void;
    closeEdit: () => void;
    setEditForm: React.Dispatch<React.SetStateAction<EditForm>>;
    saveEdit: () => Promise<void>;
  };
  remove: {
    deletingId: string | null;
    userToDelete: string | null;
    promptDelete: (id: string) => void;
    setUserToDelete: React.Dispatch<React.SetStateAction<string | null>>;
    submitRemove: (id: string) => Promise<void>;
  };
  stats: {
    statsUser: User | null;
    setStatsUser: React.Dispatch<React.SetStateAction<User | null>>;
    statsRange: '7d' | '30d' | '90d' | '1y' | 'all';
    setStatsRange: React.Dispatch<React.SetStateAction<'7d' | '30d' | '90d' | '1y' | 'all'>>;
    statsData: UserStatistics | OverallStatistics | undefined;
    statsLoading: boolean;
    statsError: Error | null;
  };
}

export function useAdminUsers(user: User): AdminUsersState {
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

  const submitCreate = async () => {
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

  const submitRemove = async (id: string) => {
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

  const canDemoteOrDeleteAdmin = useMemo(() => {
    return users.filter((u) => u.isAdmin).length > 1;
  }, [users]);

  const columns: TableColumn<User>[] = [
    { key: 'username', header: 'Username', render: (u) => u.username },
    { key: 'name', header: 'Name', render: (u) => [u.name, u.surname].filter(Boolean).join(' ') || '-' },
    { key: 'role', header: 'Role', render: (u) => formatRole(u.isAdmin) },
    { key: 'format', header: 'Format', render: (u) => formatLabel(u.transcodeFormat) },
    {
      key: 'bitrate',
      header: 'Max bitrate',
      render: (u) => (u.maxBitrateKbps ? `${u.maxBitrateKbps} kbps` : 'Unlimited'),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (u) => {
        const isSelf = u.id === user.id;
        return (
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
        );
      },
    },
  ];

  return {
    user,
    users,
    error,
    columns,
    canDemoteOrDeleteAdmin,
    create: { open: createOpen, form, creating, openCreate, closeCreate, updateForm, submitCreate },
    edit: { editingUser, editForm, saving, startEdit, closeEdit, setEditForm, saveEdit },
    remove: { deletingId, userToDelete, promptDelete, setUserToDelete, submitRemove },
    stats: {
      statsUser,
      setStatsUser,
      statsRange,
      setStatsRange,
      statsData,
      statsLoading,
      statsError: statsError as Error | null,
    },
  };
}

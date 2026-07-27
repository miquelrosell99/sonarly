import { useEffect, useState } from 'react';
import type { Library, User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { Modal } from '../../../components/ui/Modal.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { AdminShell } from '../components/AdminShell.js';

interface AdminLibrariesProps {
  user: User;
}

interface CreateForm {
  name: string;
  path: string;
}

interface EditForm {
  name: string;
  path: string;
}

export function AdminLibraries({ user }: AdminLibrariesProps) {
  const { notify } = useNotification();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>({ name: '', path: '' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ name: '', path: '' });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const updateForm = (patch: Partial<CreateForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const load = async () => {
    try {
      const { libraries: list } = await api<{ libraries: Library[] }>('/admin/libraries');
      setLibraries(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load libraries');
    }
  };

  useEffect(() => {
    if (!user.isAdmin) return;
    load();
  }, [user.isAdmin]);

  const openCreate = () => {
    setForm({ name: '', path: '' });
    setError(null);
    setCreateOpen(true);
  };

  const closeCreate = () => {
    if (creating) return;
    setCreateOpen(false);
  };

  const create = async () => {
    if (!form.name.trim() || !form.path.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api('/admin/libraries', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          path: form.path.trim(),
        }),
      });
      setCreateOpen(false);
      setForm({ name: '', path: '' });
      notify('Library created.', 'success');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create library');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (library: Library) => {
    setEditingId(library.id);
    setEditForm({ name: library.name, path: library.path });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ name: '', path: '' });
  };

  const saveEdit = async (id: string) => {
    if (!editForm.name.trim() || !editForm.path.trim()) return;
    setSavingId(id);
    setError(null);
    try {
      await api(`/admin/libraries/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editForm.name.trim(),
          path: editForm.path.trim(),
        }),
      });
      notify('Library updated.', 'success');
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update library');
    } finally {
      setSavingId(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this library? Songs in this library will no longer be scanned.')) return;
    setDeletingId(id);
    setError(null);
    try {
      await api(`/admin/libraries/${id}`, { method: 'DELETE' });
      notify('Library deleted.', 'success');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete library');
    } finally {
      setDeletingId(null);
    }
  };

  const createFooter = (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={closeCreate} disabled={creating}>
        Cancel
      </Button>
      <Button onClick={create} disabled={creating || !form.name.trim() || !form.path.trim()}>
        Create Library
      </Button>
    </div>
  );

  return (
    <AdminShell user={user}>
      <div className="space-y-4">
        {error && !createOpen && <p className="text-sm text-danger" role="alert">{error}</p>}

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-fg-secondary">
            {libraries.length} library{libraries.length === 1 ? '' : 'ies'}
          </h3>
          <Button onClick={openCreate}>Add Library</Button>
        </div>

        <Modal open={createOpen} onClose={closeCreate} title="Add Library" footer={createFooter}>
          <div className="space-y-4">
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <div className="space-y-1">
              <label htmlFor="lib-name" className="block text-sm font-medium text-fg-secondary">Name</label>
              <Input
                id="lib-name"
                placeholder="Library name"
                value={form.name}
                onChange={(e) => updateForm({ name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="lib-path" className="block text-sm font-medium text-fg-secondary">Path</label>
              <Input
                id="lib-path"
                placeholder="Path inside container (e.g. /media/music)"
                value={form.path}
                onChange={(e) => updateForm({ path: e.target.value })}
              />
            </div>
          </div>
        </Modal>

        <div className="overflow-x-auto rounded-md border border-rule">
          <table className="w-full text-sm">
            <thead className="bg-surface">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-fg-primary">Name</th>
                <th className="px-4 py-2 text-left font-medium text-fg-primary">Path</th>
                <th className="px-4 py-2 text-left font-medium text-fg-primary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {libraries.map((library) => {
                const isEditing = editingId === library.id;
                return (
                  <tr key={library.id} className="border-t border-rule">
                    {isEditing ? (
                      <td colSpan={3} className="px-4 py-3">
                        <div className="flex flex-wrap items-end gap-4">
                          <Input
                            placeholder="Name"
                            className="w-48"
                            value={editForm.name}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                          />
                          <Input
                            placeholder="Path"
                            className="w-80"
                            value={editForm.path}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, path: e.target.value }))}
                          />
                          <div className="ml-auto flex items-center gap-2">
                            <Button onClick={() => saveEdit(library.id)} disabled={savingId === library.id}>
                              Save
                            </Button>
                            <Button variant="ghost" onClick={cancelEdit}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td className="px-4 py-2 font-medium text-fg-primary">{library.name}</td>
                        <td className="px-4 py-2 font-mono text-xs text-fg-secondary">{library.path}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <Button variant="ghost" onClick={() => startEdit(library)}>
                              Edit
                            </Button>
                            <Button
                              variant="danger"
                              onClick={() => remove(library.id)}
                              disabled={deletingId === library.id}
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {libraries.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-sm text-fg-secondary">
                    No libraries configured yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}

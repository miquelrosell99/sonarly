import { useEffect, useMemo, useState } from 'react';
import type { Library, User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { Modal } from '../../../components/ui/Modal.js';
import { Icon } from '../../../components/ui/Icon.js';
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
  organizePattern: string;
}

const templates = [
  {
    label: 'Album Artist / (Year) Album / Disc Number Track Number - Title',
    value: '{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}',
  },
  { label: 'Artist / Album / Track - Title', value: '{artist}/{album}/{track:00} - {title}' },
  { label: 'Artist / Album / Track - Title (no zero pad)', value: '{artist}/{album}/{track} - {title}' },
  { label: 'Album Artist / Album / Track - Title', value: '{albumArtist}/{album}/{track:00} - {title}' },
  { label: 'Artist / Year - Album / Track - Title', value: '{artist}/{year} - {album}/{track:00} - {title}' },
  { label: 'Artist / Title', value: '{artist}/{title}' },
];

const sampleTags: Record<string, string> = {
  artist: 'The Beatles',
  albumArtist: 'The Beatles',
  album: 'Abbey Road',
  title: 'Come Together',
  track: '3',
  'track:00': '03',
  disc: '1',
  'disc:00': '01',
  year: '1969',
  genre: 'Rock',
};

function sanitize(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '') || '_';
}

function buildPreviewPath(pattern: string): string {
  const patternWithoutExt = pattern.replace(/\{ext\}/g, '');
  const relativePath = patternWithoutExt.replace(/\{([a-zA-Z0-9:]+)\}/g, (_, token) => {
    return sampleTags[token] ?? '';
  });
  const sanitized = relativePath.split('/').map(sanitize).join('/');
  return `/library/${sanitized}.mp3`;
}

function validatePattern(pattern: string): string | undefined {
  if (!pattern.trim()) return 'Pattern is required';
  if (pattern.startsWith('/')) return 'Pattern must be relative';
  if (pattern.split('/').some((segment) => segment === '..' || segment.includes('\0'))) {
    return 'Pattern contains invalid path segments';
  }
  return undefined;
}

export function AdminLibraries({ user }: AdminLibrariesProps) {
  const { notify } = useNotification();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>({ name: '', path: '' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingLibrary, setEditingLibrary] = useState<Library | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ name: '', path: '', organizePattern: '' });
  const [saving, setSaving] = useState(false);
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

  const openEdit = (library: Library) => {
    setEditingLibrary(library);
    setEditForm({
      name: library.name,
      path: library.path,
      organizePattern: library.organizePattern,
    });
    setError(null);
  };

  const closeEdit = () => {
    if (saving) return;
    setEditingLibrary(null);
  };

  const saveEdit = async () => {
    if (!editingLibrary) return;
    if (!editForm.name.trim() || !editForm.path.trim()) return;
    const patternError = validatePattern(editForm.organizePattern);
    if (patternError) {
      setError(patternError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/admin/libraries/${editingLibrary.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editForm.name.trim(),
          path: editForm.path.trim(),
          organizePattern: editForm.organizePattern.trim(),
        }),
      });
      notify('Library updated.', 'success');
      setEditingLibrary(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update library');
    } finally {
      setSaving(false);
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

  const previewPath = useMemo(() => buildPreviewPath(editForm.organizePattern), [editForm.organizePattern]);
  const selectedTemplate = templates.find((t) => t.value === editForm.organizePattern)?.value ?? '';

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

  const editFooter = (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={closeEdit} disabled={saving}>
        Cancel
      </Button>
      <Button onClick={saveEdit} disabled={saving || !editForm.name.trim() || !editForm.path.trim()}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );

  return (
    <AdminShell user={user}>
      <div className="space-y-4">
        {error && !createOpen && !editingLibrary && <p className="text-sm text-danger" role="alert">{error}</p>}

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

        <Modal open={!!editingLibrary} onClose={closeEdit} title="Library Settings" footer={editFooter}>
          <div className="space-y-4">
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <div className="space-y-1">
              <label htmlFor="edit-lib-name" className="block text-sm font-medium text-fg-secondary">Name</label>
              <Input
                id="edit-lib-name"
                placeholder="Library name"
                value={editForm.name}
                onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="edit-lib-path" className="block text-sm font-medium text-fg-secondary">Path</label>
              <Input
                id="edit-lib-path"
                placeholder="Path inside container (e.g. /media/music)"
                value={editForm.path}
                onChange={(e) => setEditForm((prev) => ({ ...prev, path: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="edit-lib-template" className="block text-sm font-medium text-fg-secondary">
                Organization template
              </label>
              <select
                id="edit-lib-template"
                value={selectedTemplate}
                onChange={(e) => setEditForm((prev) => ({ ...prev, organizePattern: e.target.value }))}
                className="input w-full"
              >
                <option value="">Custom</option>
                {templates.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="edit-lib-pattern" className="block text-sm font-medium text-fg-secondary">
                Organization pattern
              </label>
              <Input
                id="edit-lib-pattern"
                value={editForm.organizePattern}
                onChange={(e) => setEditForm((prev) => ({ ...prev, organizePattern: e.target.value }))}
                placeholder="{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}"
              />
              <p className="text-xs text-muted">
                Available variables: artist, albumArtist, album, title, track, track:00, disc, disc:00, year, genre. The file extension is always appended.
              </p>
            </div>

            <div className="rounded-md border border-rule bg-surface p-3">
              <p className="text-xs font-medium text-muted">Preview</p>
              <code className="mt-1 block break-all text-sm text-fg-primary">{previewPath}</code>
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
              {libraries.map((library) => (
                <tr key={library.id} className="border-t border-rule">
                  <td className="px-4 py-2 font-medium text-fg-primary">{library.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-fg-secondary">{library.path}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" onClick={() => openEdit(library)}>
                        <Icon name="mdi-pencil" size={16} className="mr-1" />
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
                </tr>
              ))}
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

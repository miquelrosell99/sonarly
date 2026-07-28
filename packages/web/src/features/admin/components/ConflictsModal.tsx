import { useEffect, useState } from 'react';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Modal } from '../../../components/ui/Modal.js';
import { ConfirmModal } from '../../../components/ui/ConfirmModal.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { useAdminRefresh } from '../contexts/AdminRefreshContext.js';

interface Conflict {
  id: string;
  filePath: string;
  title: string;
  artistName?: string;
  albumName?: string;
}

interface ConflictsModalProps {
  open: boolean;
  onClose: () => void;
}

export function ConflictsModal({ open, onClose }: ConflictsModalProps) {
  const { refresh } = useAdminRefresh();
  const { notify } = useNotification();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [conflictToDelete, setConflictToDelete] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api<{ conflicts: Conflict[] }>('/conflicts');
      setConflicts(data.conflicts);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load conflicts', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      load();
    }
  }, [open]);

  const remove = async (id: string) => {
    setDeleting(id);
    try {
      await api(`/songs/${id}`, { method: 'DELETE' });
      setConflicts((prev) => prev.filter((c) => c.id !== id));
      refresh();
      notify('File deleted.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete file', 'error');
    } finally {
      setDeleting(null);
      setConflictToDelete(null);
    }
  };

  const removeAll = async () => {
    setDeletingAll(true);
    try {
      const result = await api<{ ok: boolean; deleted: number }>('/conflicts', { method: 'DELETE' });
      setConflicts([]);
      refresh();
      notify(`${result.deleted} conflicting files deleted.`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete all conflicts', 'error');
    } finally {
      setDeletingAll(false);
      setConfirmDeleteAll(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Conflicting files" className="max-w-4xl">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <p className="text-sm text-muted">
              Files that were renamed with a collision suffix such as " (1)" because another file already occupied the target path.
            </p>
            {!loading && conflicts.length > 0 && (
              <Button
                variant="danger"
                onClick={() => setConfirmDeleteAll(true)}
                disabled={deletingAll}
              >
                {deletingAll ? 'Deleting...' : 'Delete all'}
              </Button>
            )}
          </div>

          {loading && <p className="text-sm text-muted">Loading...</p>}

          {!loading && conflicts.length === 0 && (
            <p className="text-sm text-muted">No conflicts found.</p>
          )}

          {conflicts.length > 0 && (
            <div className="overflow-hidden rounded-md border border-rule">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-surface text-fg-primary">
                  <tr>
                    <th className="px-4 py-2 font-medium">File path</th>
                    <th className="px-4 py-2 font-medium">Title</th>
                    <th className="px-4 py-2 font-medium">Artist</th>
                    <th className="px-4 py-2 font-medium">Album</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {conflicts.map((conflict) => (
                    <tr key={conflict.id}>
                      <td className="px-4 py-2 break-all font-mono text-xs text-muted">{conflict.filePath}</td>
                      <td className="px-4 py-2">{conflict.title}</td>
                      <td className="px-4 py-2 text-muted">{conflict.artistName ?? '—'}</td>
                      <td className="px-4 py-2 text-muted">{conflict.albumName ?? '—'}</td>
                      <td className="px-4 py-2">
                        <Button
                          onClick={() => setConflictToDelete(conflict.id)}
                          disabled={deleting === conflict.id || deletingAll}
                          variant="danger"
                        >
                          {deleting === conflict.id ? 'Deleting...' : 'Delete'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={conflictToDelete !== null}
        onClose={() => setConflictToDelete(null)}
        title="Delete conflicting file"
        message="Are you sure you want to delete this file from the library? This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => conflictToDelete && remove(conflictToDelete)}
      />

      <ConfirmModal
        open={confirmDeleteAll}
        onClose={() => setConfirmDeleteAll(false)}
        title="Delete all conflicting files"
        message={`This will permanently delete all ${conflicts.length} conflicting files from the library. This action cannot be undone.`}
        confirmLabel="Delete all"
        danger
        onConfirm={removeAll}
      />
    </>
  );
}

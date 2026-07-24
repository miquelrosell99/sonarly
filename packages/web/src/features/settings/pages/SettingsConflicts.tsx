import { useEffect, useState } from 'react';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Settings } from '../components/Settings.js';
import { useNotification } from '../../../contexts/NotificationContext.js';

interface Conflict {
  id: string;
  filePath: string;
  title: string;
  artistName?: string;
  albumName?: string;
}

export function SettingsConflicts() {
  const { notify } = useNotification();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

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
    load();
  }, []);

  const remove = async (id: string) => {
    if (!confirm('Delete this file from the library? This cannot be undone.')) return;
    setDeleting(id);
    try {
      await api(`/songs/${id}`, { method: 'DELETE' });
      setConflicts((prev) => prev.filter((c) => c.id !== id));
      notify('File deleted.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete file', 'error');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Settings>
      <div className="max-w-4xl space-y-4">
        <h3 className="text-base font-medium">Conflicting files</h3>
        <p className="text-sm text-muted">
          Files that were renamed with a collision suffix such as " (1)" because another file already occupied the target path.
        </p>

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
                        onClick={() => remove(conflict.id)}
                        disabled={deleting === conflict.id}
                        variant="ghost"
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
    </Settings>
  );
}

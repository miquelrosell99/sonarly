import { useEffect, useState } from 'react';
import type { Song, Album, Artist } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Modal } from '../../../components/ui/Modal.js';
import { Table, TableColumn } from '../../../components/ui/Table.js';
import { ConfirmModal } from '../../../components/ui/ConfirmModal.js';
import { useNotification } from '../../../contexts/NotificationContext.js';

interface MissingSong extends Song {
  artistName?: string;
  albumName?: string;
}

interface MissingData {
  songs: MissingSong[];
  albums: Album[];
  artists: Artist[];
}

type Tab = 'songs' | 'albums' | 'artists';
type Kind = keyof MissingData;

interface MissingModalProps {
  open: boolean;
  onClose: () => void;
}

export function MissingModal({ open, onClose }: MissingModalProps) {
  const { notify } = useNotification();
  const [data, setData] = useState<MissingData>({ songs: [], albums: [], artists: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('songs');
  const [purging, setPurging] = useState<Record<string, boolean>>({});
  const [confirmPurgeAll, setConfirmPurgeAll] = useState<Kind | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<MissingData>('/admin/missing');
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load missing items');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      load();
    }
  }, [open]);

  const purge = async (kind: Kind, id: string) => {
    setPurging((prev) => ({ ...prev, [`${kind}-${id}`]: true }));
    try {
      await api(`/admin/missing/${kind}/${id}`, { method: 'DELETE' });
      setData((prev) => ({ ...prev, [kind]: prev[kind].filter((item) => item.id !== id) }));
      notify('Item removed.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to remove item', 'error');
    } finally {
      setPurging((prev) => ({ ...prev, [`${kind}-${id}`]: false }));
    }
  };

  const purgeAll = async (kind: Kind) => {
    setPurging((prev) => ({ ...prev, [`${kind}-all`]: true }));
    try {
      await api(`/admin/missing/${kind}`, { method: 'DELETE' });
      setData((prev) => ({ ...prev, [kind]: [] }));
      notify(`All missing ${kind} removed.`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : `Failed to remove missing ${kind}`, 'error');
    } finally {
      setPurging((prev) => ({ ...prev, [`${kind}-all`]: false }));
      setConfirmPurgeAll(null);
    }
  };

  const songColumns: TableColumn<MissingSong>[] = [
    { key: 'title', header: 'Title', render: (s) => s.title },
    { key: 'artist', header: 'Artist', render: (s) => s.artistName || '-' },
    { key: 'album', header: 'Album', render: (s) => s.albumName || '-' },
    { key: 'path', header: 'Last known path', render: (s) => <code className="text-xs break-all">{s.filePath}</code> },
    {
      key: 'actions',
      header: '',
      className: 'w-24 text-right',
      render: (s) => (
        <Button
          variant="ghost"
          onClick={() => purge('songs', s.id)}
          disabled={purging[`songs-${s.id}`]}
          className="text-danger"
        >
          {purging[`songs-${s.id}`] ? '...' : 'Purge'}
        </Button>
      ),
    },
  ];

  const albumColumns: TableColumn<Album>[] = [
    { key: 'name', header: 'Name', render: (a) => a.name },
    { key: 'artist', header: 'Artist', render: (a) => a.artistName || '-' },
    {
      key: 'actions',
      header: '',
      className: 'w-24 text-right',
      render: (a) => (
        <Button
          variant="ghost"
          onClick={() => purge('albums', a.id)}
          disabled={purging[`albums-${a.id}`]}
          className="text-danger"
        >
          {purging[`albums-${a.id}`] ? '...' : 'Purge'}
        </Button>
      ),
    },
  ];

  const artistColumns: TableColumn<Artist>[] = [
    { key: 'name', header: 'Name', render: (a) => a.name },
    {
      key: 'actions',
      header: '',
      className: 'w-24 text-right',
      render: (a) => (
        <Button
          variant="ghost"
          onClick={() => purge('artists', a.id)}
          disabled={purging[`artists-${a.id}`]}
          className="text-danger"
        >
          {purging[`artists-${a.id}`] ? '...' : 'Purge'}
        </Button>
      ),
    },
  ];

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'songs', label: 'Songs', count: data.songs.length },
    { key: 'albums', label: 'Albums', count: data.albums.length },
    { key: 'artists', label: 'Artists', count: data.artists.length },
  ];

  const purgeAllLabel: Record<Kind, string> = {
    songs: 'Purge all songs',
    albums: 'Purge all albums',
    artists: 'Purge all artists',
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Missing items" className="max-w-5xl">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            These songs, albums, or artists no longer have a matching file on disk. They are hidden from the rest of the app. You can purge them permanently here.
          </p>

          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          {loading && <p className="text-sm text-muted">Loading...</p>}

          {!loading && (
            <>
              <nav className="flex items-center justify-between gap-2 border-b border-rule pb-2">
                <div className="flex gap-2">
                  {tabs.map(({ key, label, count }) => (
                    <button
                      key={key}
                      onClick={() => setTab(key)}
                      className={`rounded px-3 py-1 text-sm ${tab === key ? 'bg-fg-primary text-bg-primary' : 'text-fg-primary hover:bg-surface-hover'}`}
                    >
                      {label} ({count})
                    </button>
                  ))}
                </div>
                <Button
                  variant="danger"
                  onClick={() => setConfirmPurgeAll(tab)}
                  disabled={data[tab].length === 0 || purging[`${tab}-all`]}
                >
                  {purging[`${tab}-all`] ? '...' : purgeAllLabel[tab]}
                </Button>
              </nav>

              {tab === 'songs' && (
                <Table<MissingSong>
                  columns={songColumns}
                  rows={data.songs}
                  rowKey={(s) => s.id}
                  empty="No missing songs."
                />
              )}
              {tab === 'albums' && (
                <Table<Album>
                  columns={albumColumns}
                  rows={data.albums}
                  rowKey={(a) => a.id}
                  empty="No missing albums."
                />
              )}
              {tab === 'artists' && (
                <Table<Artist>
                  columns={artistColumns}
                  rows={data.artists}
                  rowKey={(a) => a.id}
                  empty="No missing artists."
                />
              )}
            </>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={confirmPurgeAll !== null}
        onClose={() => setConfirmPurgeAll(null)}
        title={confirmPurgeAll ? purgeAllLabel[confirmPurgeAll] : 'Purge all'}
        message={`This will permanently delete all missing ${confirmPurgeAll}. This action cannot be undone.`}
        confirmLabel="Purge all"
        danger
        onConfirm={() => confirmPurgeAll && purgeAll(confirmPurgeAll)}
      />
    </>
  );
}

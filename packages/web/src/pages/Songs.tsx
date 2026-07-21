import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Button } from '../components/Button.js';
import { TagEditor } from '../components/TagEditor.js';
import { Table, TableColumn } from '../components/Table.js';

interface Song {
  id: string;
  title: string;
  artistName?: string;
  albumName?: string;
  trackNumber?: number;
  duration?: number;
}

export function Songs() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api<{ songs: Song[] }>('/songs')
      .then((r) => setSongs(r.songs))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load songs'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const columns: TableColumn<Song>[] = [
    { key: 'title', header: 'Title', render: (s) => s.title },
    { key: 'artist', header: 'Artist', render: (s) => s.artistName ?? '-' },
    { key: 'album', header: 'Album', render: (s) => s.albumName ?? '-' },
    {
      key: 'duration',
      header: 'Duration',
      className: 'w-24',
      render: (s) => (s.duration ? formatDuration(s.duration) : '-'),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-24 text-right',
      render: (s) => (
        <Button variant="ghost" className="text-xs" onClick={() => setEditing(s.id)}>
          Edit
        </Button>
      ),
    },
  ];

  if (loading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Songs</h2>
      <Table columns={columns} rows={songs} rowKey={(s) => s.id} empty="No songs." />
      {editing && <TagEditor songId={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

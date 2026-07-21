import { useEffect, useState } from 'react';
import { useParams } from 'wouter';
import { api } from '../api.js';
import { Button } from '../components/Button.js';
import { TagEditor } from '../components/TagEditor.js';
import { Table, TableColumn } from '../components/Table.js';

interface Song {
  id: string;
  title: string;
  trackNumber?: number;
  duration?: number;
  artistName?: string;
}

interface Album {
  id: string;
  name: string;
  artistName?: string;
  year?: number;
  genre?: string;
}

interface AlbumDetail {
  album: Album;
  songs: Song[];
}

export function Album() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<AlbumDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = () => {
    if (!id) return;
    setLoading(true);
    api<AlbumDetail>(`/albums/${id}`)
      .then((r) => setDetail(r))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load album'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [id]);

  const columns: TableColumn<Song>[] = [
    { key: 'track', header: '#', className: 'w-12', render: (s) => s.trackNumber ?? '-' },
    { key: 'title', header: 'Title', render: (s) => s.title },
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
  if (!detail) return <p className="text-sm text-gray-500">Album not found.</p>;

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{detail.album.name}</h2>
        <p className="text-sm text-gray-500">
          {detail.album.artistName}
          {detail.album.year !== undefined && detail.album.year !== null && ` • ${detail.album.year}`}
          {detail.album.genre && ` • ${detail.album.genre}`}
        </p>
      </div>
      <Table columns={columns} rows={detail.songs} rowKey={(s) => s.id} empty="No songs." />
      {editing && <TagEditor songId={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

import { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import { api } from '../api.js';
import { Table, TableColumn } from '../components/Table.js';

interface PlaylistSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration?: number;
}

interface Playlist {
  id: string;
  name: string;
  ownerId: string;
  visibility: string;
  entries: PlaylistSong[];
}

export function PlaylistDetail() {
  const { id } = useParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api<{ playlist: Playlist }>(`/playlists/${id}`)
      .then((r) => setPlaylist(r.playlist))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load playlist'))
      .finally(() => setLoading(false));
  }, [id]);

  const columns: TableColumn<PlaylistSong>[] = [
    { key: 'title', header: 'Title', render: (s) => s.title },
    { key: 'artist', header: 'Artist', render: (s) => s.artist || '-' },
    { key: 'album', header: 'Album', render: (s) => s.album || '-' },
    {
      key: 'duration',
      header: 'Duration',
      className: 'w-24',
      render: (s) => (s.duration ? formatDuration(s.duration) : '-'),
    },
  ];

  if (loading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!playlist) return <p className="text-sm text-gray-500">Playlist not found.</p>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{playlist.name}</h2>
          <p className="text-sm text-gray-500">{playlist.visibility}</p>
        </div>
        <Link href="/playlists" className="btn-ghost text-xs">
          Back
        </Link>
      </div>
      <Table columns={columns} rows={playlist.entries} rowKey={(s) => s.id} empty="No songs in this playlist." />
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

import { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import type { UserPreferences } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { TagEditor } from '../../songs/index.js';
import { Table, TableColumn } from '../../../components/ui/Table.js';

interface Song {
  id: string;
  title: string;
  trackNumber?: number;
  duration?: number;
  artistName?: string;
  explicit?: boolean;
}

interface Album {
  id: string;
  name: string;
  artistId?: string;
  artistName?: string;
  year?: number;
  genre?: string;
  totalSongCount?: number;
  shownSongCount?: number;
}

interface AlbumDetail {
  album: Album;
  songs: Song[];
}

export function Album() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<AlbumDetail | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = () => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api<AlbumDetail>(`/albums/${id}`),
      api<{ preferences: UserPreferences }>('/me/preferences').catch(() => ({ preferences: {} })),
    ])
      .then(([detailRes, prefsRes]) => {
        setDetail(detailRes);
        setPreferences(prefsRes.preferences);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load album'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [id]);

  const blurExplicitTitles = preferences.blurExplicitTitles === true;
  const blurExplicitCovers = preferences.blurExplicitCovers === true;

  const columns: TableColumn<Song>[] = [
    { key: 'track', header: '#', className: 'w-12', render: (s) => s.trackNumber ?? '-' },
    {
      key: 'title',
      header: 'Title',
      render: (s) => (
        <span className={`inline-flex items-center gap-2 ${s.explicit && blurExplicitTitles ? 'blur-sm' : ''}`}>
          <Link href={`/tracks/${s.id}`} className="hover:text-muted">
            {s.title}
          </Link>
          {s.explicit && (
            <span className="rounded bg-red-100 px-1 text-[10px] font-bold text-red-700">E</span>
          )}
        </span>
      ),
    },
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

  const hasFilteredSongs =
    detail.album.totalSongCount !== undefined &&
    detail.album.shownSongCount !== undefined &&
    detail.album.totalSongCount > detail.album.shownSongCount;

  return (
    <div>
      <div className="mb-4">
        <h2 className={`text-lg font-semibold ${blurExplicitCovers && hasFilteredSongs ? 'blur-sm' : ''}`}>
          {detail.album.name}
        </h2>
        <p className="text-sm text-gray-500">
          {detail.album.artistId ? (
            <Link href={`/artists/${detail.album.artistId}`} className="hover:text-muted">
              {detail.album.artistName}
            </Link>
          ) : (
            detail.album.artistName
          )}
          {detail.album.year !== undefined && detail.album.year !== null && ` • ${detail.album.year}`}
          {detail.album.genre && ` • ${detail.album.genre}`}
          {hasFilteredSongs && (
            <span className="ml-2 rounded bg-yellow-100 px-1.5 py-0.5 text-xs text-yellow-800">
              {detail.album.shownSongCount} of {detail.album.totalSongCount} songs shown
            </span>
          )}
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

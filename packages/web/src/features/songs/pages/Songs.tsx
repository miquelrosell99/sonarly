import { useEffect, useState } from 'react';
import type { User, UserPreferences } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { TagEditor } from '../components/TagEditor.js';
import { Table, TableColumn } from '../../../components/ui/Table.js';

interface Song {
  id: string;
  title: string;
  artistName?: string;
  albumName?: string;
  trackNumber?: number;
  duration?: number;
  explicit?: boolean;
}

export function Songs({ user }: { user: User }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api<{ songs: Song[] }>('/songs'),
      api<{ preferences: UserPreferences }>('/me/preferences').catch(() => ({ preferences: {} })),
    ])
      .then(([songsRes, prefsRes]) => {
        setSongs(songsRes.songs);
        setPreferences(prefsRes.preferences);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load songs'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const blurExplicitTitles = preferences.blurExplicitTitles === true;

  const columns: TableColumn<Song>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (s) => (
        <span className={`inline-flex items-center gap-2 ${s.explicit && blurExplicitTitles ? 'blur-sm' : ''}`}>
          {s.title}
          {s.explicit && (
            <span className="rounded bg-red-500/10 px-1 text-[10px] font-bold text-red-500">E</span>
          )}
        </span>
      ),
    },
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
      render: (s) =>
        user.isAdmin ? (
          <Button variant="ghost" className="text-xs" onClick={() => setEditing(s.id)}>
            Edit
          </Button>
        ) : null,
    },
  ];

  if (loading) return <p className="text-sm text-muted">Loading...</p>;
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

import { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import type { SmartPlaylistRules, UserPreferences } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Table, TableColumn } from '../../../components/ui/Table.js';
import { Button } from '../../../components/ui/Button.js';
import { SmartPlaylistEditor } from '../components/SmartPlaylistEditor.js';

interface PlaylistSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration?: number;
  explicit?: boolean;
}

interface Playlist {
  id: string;
  name: string;
  ownerId: string;
  visibility: string;
  isSmart?: boolean;
  rules?: SmartPlaylistRules;
  entries: PlaylistSong[];
}

export function PlaylistDetail() {
  const { id } = useParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api<{ playlist: Playlist }>(`/playlists/${id}`),
      api<{ preferences: UserPreferences }>('/me/preferences').catch(() => ({ preferences: {} })),
    ])
      .then(([playlistRes, prefsRes]) => {
        setPlaylist(playlistRes.playlist);
        setPreferences(prefsRes.preferences);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load playlist'))
      .finally(() => setLoading(false));
  }, [id]);

  const saveRules = async (rules: SmartPlaylistRules) => {
    if (!id || !playlist) return;
    setSaving(true);
    try {
      await api(`/playlists/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ rules }),
      });
      const refreshed = await api<{ playlist: Playlist }>(`/playlists/${id}`);
      setPlaylist(refreshed.playlist);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rules');
    } finally {
      setSaving(false);
    }
  };

  const blurExplicitTitles = preferences.blurExplicitTitles === true;

  const columns: TableColumn<PlaylistSong>[] = [
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
          <p className="text-sm text-gray-500">
            {playlist.visibility}
            {playlist.isSmart && (
              <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">smart</span>
            )}
          </p>
        </div>
        <Link href="/playlists" className="btn-ghost text-xs">
          Back
        </Link>
      </div>

      {playlist.isSmart && (
        <div className="mb-6 rounded border border-gray-200 p-4 dark:border-gray-700">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">Smart rules</h3>
            {saving && <span className="text-xs text-gray-500">Saving...</span>}
          </div>
          <SmartPlaylistEditor initialRules={playlist.rules} onChange={saveRules} />
        </div>
      )}

      <Table columns={columns} rows={playlist.entries} rowKey={(s) => s.id} empty="No songs in this playlist." />
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

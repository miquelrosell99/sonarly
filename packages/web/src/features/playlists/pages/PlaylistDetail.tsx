import { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import type { SmartPlaylistRules, UserPreferences } from '@sonarly/shared';
import { api } from '../../../api.js';
import { cn } from '../../../lib/cn.js';
import { Table, TableColumn } from '../../../components/ui/Table.js';
import { Button } from '../../../components/ui/Button.js';
import { Icon } from '../../../components/ui/Icon.js';
import { SmartPlaylistEditor } from '../components/SmartPlaylistEditor.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';

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
  starred?: boolean;
  rating?: number;
}

export function PlaylistDetail() {
  const { id } = useParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { setFavorite, setRating } = useFavoriteActions();

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

  const handleFavorite = async (starred: boolean) => {
    if (!playlist) return;
    try {
      await setFavorite('playlist', playlist.id, starred);
      setPlaylist((prev) => (prev ? { ...prev, starred } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update favorite');
    }
  };

  const handleRate = async (rating?: number) => {
    if (!playlist) return;
    try {
      await setRating('playlist', playlist.id, rating);
      setPlaylist((prev) => (prev ? { ...prev, rating } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rating');
    }
  };

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
            <span className="rounded bg-red-500/10 px-1 text-[10px] font-bold text-red-500">E</span>
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

  if (loading) return <p className="text-sm text-muted">Loading...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!playlist) return <p className="text-sm text-muted">Playlist not found.</p>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{playlist.name}</h2>
            <button
              type="button"
              onClick={() => handleFavorite(!playlist.starred)}
              aria-label={playlist.starred ? 'Remove favorite' : 'Add favorite'}
              title={playlist.starred ? 'Remove favorite' : 'Add favorite'}
              className={cn(
                'rounded p-1 transition hover:bg-surface-hover',
                playlist.starred ? 'text-accent' : 'text-muted hover:text-accent',
              )}
            >
              <Icon name={playlist.starred ? 'mdi-heart' : 'mdi-heart-outline'} size={20} />
            </button>
            <span className="inline-flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleRate(value === playlist.rating ? undefined : value)}
                  aria-label={`Rate ${value} stars`}
                  className={cn(
                    'rounded p-0.5 transition hover:bg-surface-hover',
                    value <= (playlist.rating ?? 0) ? 'text-accent' : 'text-muted hover:text-accent/70',
                  )}
                >
                  <Icon
                    name={value <= (playlist.rating ?? 0) ? 'mdi-star' : 'mdi-star-outline'}
                    size={18}
                  />
                </button>
              ))}
            </span>
          </div>
          <p className="text-sm text-muted">
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
        <div className="mb-6 rounded border border-rule p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">Smart rules</h3>
            {saving && <span className="text-xs text-muted">Saving...</span>}
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

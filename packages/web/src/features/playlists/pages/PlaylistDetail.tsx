import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useLocation } from 'wouter';
import type { SmartPlaylistRules, Song, User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Icon } from '../../../components/ui/Icon.js';
import { SmartPlaylistEditor } from '../components/SmartPlaylistEditor.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { usePlaylistContextMenu } from '../../../hooks/usePlaylistContextMenu.js';
import { useSongContextMenu } from '../../../hooks/useSongContextMenu.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { EditEntityModal } from '../../../components/EditEntityModal.js';
import { FavoriteRatingGroup } from '../../../components/FavoriteRatingGroup.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { SongTable, type SongListItem } from '../../songs/components/SongTable.js';

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

type DisplaySong = PlaylistSong & {
  artistName?: string;
  albumName?: string;
};

function PlaylistHeaderContextMenu({
  playlist,
  onEdit,
  onConvert,
  children,
}: {
  playlist: Playlist;
  onEdit: () => void;
  onConvert: () => void;
  children: ReactNode;
}) {
  const sections = usePlaylistContextMenu(
    playlist as unknown as import('@sonarly/shared').Playlist,
    onEdit,
    onConvert,
  );
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

function PlaylistSongContextMenu({
  song,
  onEdit,
  children,
}: {
  song: SongListItem;
  onEdit: () => void;
  children: ReactNode;
}) {
  const sections = useSongContextMenu(song as unknown as Song, onEdit, false);
  const visibleSections = sections
    .map((section) => ({ ...section, items: section.items.filter((item) => item.id !== 'edit') }))
    .filter((section) => section.items.length > 0);
  return <ItemContextMenu sections={visibleSections}>{children}</ItemContextMenu>;
}

interface PlaylistDetailProps {
  user: User;
}

export function PlaylistDetail({ user }: PlaylistDetailProps) {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingRules, setSavingRules] = useState(false);
  const { notify } = useNotification();
  const { setFavorite, setRating } = useFavoriteActions();
  const { playSongs, shufflePlay } = usePlayActions();
  const playingId = usePlayer((state) => state.currentSong?.id);

  const load = () => {
    if (!id) return;
    setLoading(true);
    api<{ playlist: Playlist }>(`/playlists/${id}`)
      .then((playlistRes) => {
        setPlaylist(playlistRes.playlist);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load playlist'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [id]);

  const saveRules = async (rules: SmartPlaylistRules) => {
    if (!id || !playlist) return;
    setSavingRules(true);
    try {
      await api(`/playlists/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ rules }),
      });
      const refreshed = await api<{ playlist: Playlist }>(`/playlists/${id}`);
      setPlaylist(refreshed.playlist);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save rules', 'error');
    } finally {
      setSavingRules(false);
    }
  };

  const blurExplicitTitles = user.blurExplicitTitles === true;

  const displayEntries: DisplaySong[] = playlist?.entries.map((entry) => ({
    ...entry,
    artistName: entry.artist,
    albumName: entry.album,
  })) ?? [];

  const handlePlay = (song: SongListItem) => {
    playSongs([song as unknown as Song], 0);
  };

  const handlePlaySelection = (songs: SongListItem[], startIndex: number) => {
    playSongs(songs as unknown as Song[], startIndex);
  };

  const handleShufflePlay = (_song: SongListItem) => {
    shufflePlay(displayEntries as unknown as Song[]);
  };

  const handleFavorite = async (starred: boolean) => {
    if (!playlist) return;
    try {
      await setFavorite('playlist', playlist.id, starred);
      setPlaylist((prev) => (prev ? { ...prev, starred } : prev));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update favorite', 'error');
    }
  };

  const handleRate = async (rating?: number) => {
    if (!playlist) return;
    try {
      await setRating('playlist', playlist.id, rating);
      setPlaylist((prev) => (prev ? { ...prev, rating } : prev));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update rating', 'error');
    }
  };

  const handleSavePlaylist = async (patched: Record<string, unknown>) => {
    if (!id || !playlist) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: patched.name,
        visibility: patched.visibility,
      };
      if (playlist.isSmart) {
        body.rules = patched.rules;
      }
      await api(`/playlists/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setEditing(false);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save playlist', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlaylist = async () => {
    if (!id || !playlist) return;
    setDeleting(true);
    try {
      await api(`/playlists/${id}`, { method: 'DELETE' });
      setLocation('/playlists');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete playlist', 'error');
      setDeleting(false);
    }
  };

  const handleConvert = () => {
    load();
  };

  if (loading) return <p className="text-sm text-muted">Loading...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!playlist) return <p className="text-sm text-muted">Playlist not found.</p>;

  const header = (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{playlist.name}</h2>
          <FavoriteRatingGroup
            starred={playlist.starred}
            onToggleFavorite={() => handleFavorite(!playlist.starred)}
            rating={playlist.rating}
            onRate={(rating) => handleRate(rating || undefined)}
            favoriteLabel={playlist.name}
          />
        </div>
        <p className="text-sm text-muted">
          {playlist.visibility}
          {playlist.isSmart && (
            <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">smart</span>
          )}
        </p>
      </div>
      <Button variant="ghost" onClick={() => setLocation('/playlists')}>
        Back
      </Button>
    </div>
  );

  return (
    <div>
      <PlaylistHeaderContextMenu
        playlist={playlist}
        onEdit={() => setEditing(true)}
        onConvert={handleConvert}
      >
        {header}
      </PlaylistHeaderContextMenu>

      {playlist.isSmart && (
        <div className="mb-6 rounded border border-rule p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">Smart rules</h3>
            {savingRules && <span className="text-xs text-muted">Saving...</span>}
          </div>
          <SmartPlaylistEditor initialRules={playlist.rules} onChange={saveRules} />
        </div>
      )}

      <SongTable
        songs={displayEntries}
        playingId={playingId}
        blurExplicit={blurExplicitTitles}
        onPlay={handlePlay}
        onShufflePlay={handleShufflePlay}
        onPlaySelection={handlePlaySelection}
        renderRow={(song, row) => (
          <PlaylistSongContextMenu song={song} onEdit={() => {}}>
            {row}
          </PlaylistSongContextMenu>
        )}
        empty="No songs in this playlist."
      />

      {editing && (
        <EditEntityModal
          open
          entityType="playlist"
          entity={(playlist as unknown) as Record<string, unknown>}
          onClose={() => setEditing(false)}
          onSave={handleSavePlaylist}
          onDelete={handleDeletePlaylist}
          saving={saving}
          deleting={deleting}
        />
      )}
    </div>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import type { Song as SharedSong, User, UserPreferences } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Table, TableColumn } from '../../../components/ui/Table.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { useSongContextMenu } from '../../../hooks/useSongContextMenu.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { EditEntityModal } from '../../../components/EditEntityModal.js';
import { useNotification } from '../../../contexts/NotificationContext.js';

type Song = SharedSong & {
  artistName?: string;
  albumName?: string;
};

function SongContextMenu({
  song,
  onEdit,
  isAdmin,
  children,
}: {
  song: Song;
  onEdit: () => void;
  isAdmin: boolean;
  children: ReactNode;
}) {
  const sections = useSongContextMenu(song, onEdit);
  const visibleSections = isAdmin
    ? sections
    : sections.map((section) => ({ ...section, items: section.items.filter((item) => item.id !== 'edit') })).filter((section) => section.items.length > 0);
  return <ItemContextMenu sections={visibleSections}>{children}</ItemContextMenu>;
}

export function Songs({ user }: { user: User }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Song | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { notify } = useNotification();
  const { playSongs } = usePlayActions();
  const playingId = usePlayer((state) => state.currentSong?.id);

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

  const handlePlay = (song: Song) => {
    playSongs([song as SharedSong], 0);
  };

  const handlePlaySelection = (songs: Song[], startIndex: number) => {
    playSongs(songs as SharedSong[], startIndex);
  };

  const handleSave = async (patched: Record<string, unknown>) => {
    if (!editing) return;
    setSaving(true);
    try {
      await api(`/songs/${editing.id}/tags`, {
        method: 'PUT',
        body: JSON.stringify(patched),
      });
      setEditing(null);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save song', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    setDeleting(true);
    try {
      await api(`/songs/${editing.id}`, { method: 'DELETE' });
      setEditing(null);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete song', 'error');
    } finally {
      setDeleting(false);
    }
  };

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
  ];

  const editEntity = editing
    ? {
        ...editing,
        artist: editing.artistName,
        album: editing.albumName,
      }
    : null;

  if (loading) return <p className="text-sm text-muted">Loading...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Songs</h2>
      <Table
        columns={columns}
        rows={songs}
        rowKey={(s) => s.id}
        empty="No songs."
        onPlay={handlePlay}
        onPlaySelection={handlePlaySelection}
        playingId={playingId}
        renderRow={(song, row) => (
          <SongContextMenu song={song} onEdit={() => setEditing(song)} isAdmin={user.isAdmin}>
            {row}
          </SongContextMenu>
        )}
      />
      {editEntity && (
        <EditEntityModal
          open
          entityType="song"
          entity={editEntity}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={handleDelete}
          saving={saving}
          deleting={deleting}
        />
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

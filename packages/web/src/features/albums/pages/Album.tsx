import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'wouter';
import type { Song as SharedSong, User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { cn } from '../../../lib/cn.js';
import { Button } from '../../../components/ui/Button.js';
import { CoverArt } from '../../../components/CoverArt.js';
import { EntityHeader } from '../../../components/EntityHeader.js';
import { PlayButton } from '../../../components/PlayButton.js';
import { FavoriteRatingGroup } from '../../../components/FavoriteRatingGroup.js';
import { EditEntityModal } from '../../../components/EditEntityModal.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { useSongContextMenu } from '../../../hooks/useSongContextMenu.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';
import { SyncedLyricsEditor } from '../../songs/index.js';
import { SongTable } from '../../songs/index.js';
import type { SongListItem } from '../../songs/components/SongTable.js';
import type { SongWithNames } from '../../../lib/types.js';

interface Album {
  id: string;
  name: string;
  artistId?: string;
  artistName?: string;
  year?: number;
  genre?: string;
  coverArt?: string;
  totalSongCount?: number;
  shownSongCount?: number;
  starred?: boolean;
  rating?: number;
}

interface AlbumDetail {
  album: Album;
  songs: SongWithNames[];
}

function SongContextMenu({
  song,
  onEdit,
  isAdmin,
  children,
}: {
  song: SongListItem;
  onEdit: () => void;
  isAdmin: boolean;
  children: ReactNode;
}) {
  const sections = useSongContextMenu(song as SharedSong, onEdit, isAdmin);
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

export function Album({ user }: { user: User }) {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<AlbumDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SongWithNames | null>(null);
  const [syncEditing, setSyncEditing] = useState<SongWithNames | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [coverArtBusy, setCoverArtBusy] = useState(false);
  const { notify } = useNotification();
  const coverInputRef = useRef<HTMLInputElement>(null);
  const { setFavorite, setRating } = useFavoriteActions();
  const { playSongs, shufflePlay } = usePlayActions();
  const playingId = usePlayer((state) => state.currentSong?.id);
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);

  useDocumentTitle(detail?.album.name);

  const load = () => {
    if (!id) return;
    setLoading(true);
    api<AlbumDetail>(`/albums/${id}${buildLibraryQuery(selectedLibraryId)}`)
      .then((detailRes) => {
        setDetail(detailRes);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load album'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [id, selectedLibraryId]);

  const blurExplicitTitles = user.blurExplicitTitles === true;
  const blurExplicitCovers = user.blurExplicitCovers === true;

  const handlePlay = (song: SongListItem) => {
    playSongs([song as SharedSong], 0);
  };

  const handlePlaySelection = (songs: SongListItem[], startIndex: number) => {
    playSongs(songs as SharedSong[], startIndex);
  };

  const handlePlayAlbum = () => {
    if (!detail) return;
    playSongs(detail.songs as SharedSong[], 0);
  };

  const handleShuffleAlbumSongs = () => {
    if (!detail) return;
    shufflePlay(detail.songs as SharedSong[]);
  };

  const handleFavorite = async (starred: boolean) => {
    if (!detail) return;
    try {
      await setFavorite('album', detail.album.id, starred);
      setDetail((prev) =>
        prev ? { ...prev, album: { ...prev.album, starred } } : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update favorite');
    }
  };

  const handleRate = async (rating?: number) => {
    if (!detail) return;
    try {
      await setRating('album', detail.album.id, rating);
      setDetail((prev) =>
        prev ? { ...prev, album: { ...prev.album, rating } } : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rating');
    }
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

  const handleEditCoverArt = () => {
    coverInputRef.current?.click();
  };

  const handleCoverArtFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editing) return;
    setCoverArtBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api(`/songs/${editing.id}/cover-art`, {
        method: 'POST',
        body: formData,
      });
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update cover art', 'error');
    } finally {
      setCoverArtBusy(false);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  const handleDeleteCoverArt = async () => {
    if (!editing) return;
    if (!window.confirm('Are you sure you want to remove the cover art?')) return;
    setCoverArtBusy(true);
    try {
      await api(`/songs/${editing.id}/cover-art`, { method: 'DELETE' });
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to remove cover art', 'error');
    } finally {
      setCoverArtBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-muted">Loading...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!detail) return <p className="text-sm text-muted">Album not found.</p>;

  const hasFilteredSongs =
    detail.album.totalSongCount !== undefined &&
    detail.album.shownSongCount !== undefined &&
    detail.album.totalSongCount > detail.album.shownSongCount;

  const metadata = [
    { label: detail.album.artistName ?? 'Unknown artist', href: detail.album.artistId ? `/artists/${detail.album.artistId}` : undefined },
    { label: detail.album.year !== undefined && detail.album.year !== null ? String(detail.album.year) : '', href: detail.album.year !== undefined ? `/years/${detail.album.year}` : undefined },
    { label: detail.album.genre ?? '', href: detail.album.genre ? `/genres/${encodeURIComponent(detail.album.genre)}` : undefined },
  ];

  const editEntity = editing
    ? {
        ...editing,
        artist: editing.artistName,
        album: editing.albumName,
        albumArtist: editing.albumArtistName,
      }
    : null;

  return (
    <div>
      <EntityHeader
        type="Album"
        title={detail.album.name}
        cover={
          <CoverArt
            coverArt={detail.album.coverArt}
            alt={`Cover art for ${detail.album.name}`}
            className={cn('h-48 w-48 sm:h-56 sm:w-56', blurExplicitCovers && hasFilteredSongs && 'blur-sm')}
            iconSize={64}
          />
        }
        metadata={metadata}
        actions={
          <>
            <PlayButton variant="default" onPlay={handlePlayAlbum} onShufflePlay={handleShuffleAlbumSongs}>
              Play
            </PlayButton>
            <FavoriteRatingGroup
              starred={detail.album.starred}
              onToggleFavorite={() => handleFavorite(!detail.album.starred)}
              rating={detail.album.rating}
              onRate={handleRate}
            />
          </>
        }
      />

      <SongTable
        songs={detail.songs}
        playingId={playingId}
        blurExplicit={blurExplicitTitles}
        onPlay={handlePlay}
        onShufflePlay={handleShuffleAlbumSongs}
        onPlaySelection={handlePlaySelection}
        renderRow={(song, row) => (
          <SongContextMenu song={song} onEdit={() => setEditing(song as SongWithNames)} isAdmin={user.isAdmin}>
            {row}
          </SongContextMenu>
        )}
        empty="No songs."
      />

      {editEntity && (
        <EditEntityModal
          open
          entityType="song"
          entity={editEntity}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={handleDelete}
          onEditCoverArt={user.isAdmin ? handleEditCoverArt : undefined}
          onDeleteCoverArt={user.isAdmin ? handleDeleteCoverArt : undefined}
          onEditSyncedLyrics={() => editing && setSyncEditing(editing)}
          saving={saving}
          deleting={deleting}
          coverArtBusy={coverArtBusy}
        />
      )}
      <input
        ref={coverInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleCoverArtFileChange}
      />
      {syncEditing && (
        <SyncedLyricsEditor
          songId={syncEditing.id}
          title={syncEditing.title}
          artistName={syncEditing.artistName}
          duration={syncEditing.duration}
          onClose={() => setSyncEditing(null)}
          onSaved={() => {
            setSyncEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

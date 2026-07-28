import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'wouter';
import type { Song as SharedSong, User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { cn } from '../../../lib/cn.js';
import { Button } from '../../../components/ui/Button.js';
import { Icon } from '../../../components/ui/Icon.js';
import { CoverArt } from '../../../components/CoverArt.js';
import { EntityDetail } from '../../../components/EntityDetail.js';
import { PlayButton } from '../../../components/PlayButton.js';
import { FavoriteRatingGroup } from '../../../components/FavoriteRatingGroup.js';
import { EditEntityModal } from '../../../components/EditEntityModal.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { useSongContextMenu } from '../../../hooks/useSongContextMenu.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
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
  const [songEditing, setSongEditing] = useState<SongWithNames | null>(null);
  const [albumEditing, setAlbumEditing] = useState<Album | null>(null);
  const [syncEditing, setSyncEditing] = useState<SongWithNames | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [coverArtBusy, setCoverArtBusy] = useState(false);
  const { notify } = useNotification();
  const albumCoverInputRef = useRef<HTMLInputElement>(null);
  const { setFavorite, setRating } = useFavoriteActions();
  const { playSongs, shufflePlay } = usePlayActions();
  const playingId = usePlayer((state) => state.currentSong?.id);
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);

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
    playSongs(detail.songs as SharedSong[]);
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

  const handleSongSave = async (patched: Record<string, unknown>) => {
    if (!songEditing) return;
    setSaving(true);
    try {
      await api(`/songs/${songEditing.id}/tags`, {
        method: 'PUT',
        body: JSON.stringify(patched),
      });
      setSongEditing(null);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save song', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSongDelete = async () => {
    if (!songEditing) return;
    setDeleting(true);
    try {
      await api(`/songs/${songEditing.id}`, { method: 'DELETE' });
      setSongEditing(null);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete song', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleAlbumSave = async (patched: Record<string, unknown>) => {
    if (!albumEditing) return;
    setSaving(true);
    try {
      await api(`/albums/${albumEditing.id}/tags`, {
        method: 'PUT',
        body: JSON.stringify(patched),
      });
      setAlbumEditing(null);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save album', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAlbumDelete = async () => {
    if (!albumEditing) return;
    setDeleting(true);
    try {
      await api(`/albums/${albumEditing.id}`, { method: 'DELETE' });
      setAlbumEditing(null);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete album', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleAlbumEditCoverArt = () => {
    albumCoverInputRef.current?.click();
  };

  const handleAlbumCoverArtFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !albumEditing) return;
    setCoverArtBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api(`/albums/${albumEditing.id}/cover-art`, {
        method: 'POST',
        body: formData,
      });
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update cover art', 'error');
    } finally {
      setCoverArtBusy(false);
      if (albumCoverInputRef.current) albumCoverInputRef.current.value = '';
    }
  };

  const handleAlbumDeleteCoverArt = async () => {
    if (!albumEditing) return;
    setCoverArtBusy(true);
    try {
      await api(`/albums/${albumEditing.id}/cover-art`, { method: 'DELETE' });
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to remove cover art', 'error');
    } finally {
      setCoverArtBusy(false);
    }
  };

  const hasFilteredSongs =
    detail !== null &&
    detail.album.totalSongCount !== undefined &&
    detail.album.shownSongCount !== undefined &&
    detail.album.totalSongCount > detail.album.shownSongCount;

  const metadata = detail
    ? [
        { label: detail.album.artistName ?? 'Unknown artist', href: detail.album.artistId ? `/artists/${detail.album.artistId}` : undefined },
        { label: detail.album.year !== undefined && detail.album.year !== null ? String(detail.album.year) : '', href: detail.album.year !== undefined ? `/years/${detail.album.year}` : undefined },
        { label: detail.album.genre ?? '', href: detail.album.genre ? `/genres/${encodeURIComponent(detail.album.genre)}` : undefined },
      ]
    : [];

  const songEditEntity = songEditing
    ? {
        ...songEditing,
        artist: songEditing.artistName,
        album: songEditing.albumName,
        albumArtist: songEditing.albumArtistName,
      }
    : null;

  const albumEditEntity = albumEditing
    ? {
        ...albumEditing,
        title: albumEditing.name,
        albumArtist: albumEditing.artistName,
      }
    : null;

  return (
    <EntityDetail
      isLoading={loading}
      error={error}
      notFound={!detail}
      notFoundMessage="Album not found."
      documentTitle={detail?.album.name}
      type="Album"
      title={detail?.album.name}
      cover={
        detail && (
          <CoverArt
            coverArt={detail.album.coverArt}
            alt={`Cover art for ${detail.album.name}`}
            className={cn('h-48 w-48 sm:h-56 sm:w-56', blurExplicitCovers && hasFilteredSongs && 'blur-sm')}
            iconSize={64}
          />
        )
      }
      metadata={metadata}
      actions={
        detail && (
          <>
            <PlayButton variant="default" onPlay={handlePlayAlbum} onShufflePlay={handleShuffleAlbumSongs}>
              Play
            </PlayButton>
            <Button variant="ghost" onClick={() => setAlbumEditing(detail.album)} className="gap-2">
              <Icon name="mdi-pencil" size={18} />
              Edit
            </Button>
            <FavoriteRatingGroup
              starred={detail.album.starred}
              onToggleFavorite={() => handleFavorite(!detail.album.starred)}
              rating={detail.album.rating}
              onRate={handleRate}
            />
          </>
        )
      }
    >
      <SongTable
        songs={detail?.songs ?? []}
        playingId={playingId}
        blurExplicit={blurExplicitTitles}
        onPlay={handlePlay}
        onShufflePlay={handleShuffleAlbumSongs}
        onPlaySelection={handlePlaySelection}
        renderRow={(song, row) => (
          <SongContextMenu song={song} onEdit={() => setSongEditing(song as SongWithNames)} isAdmin={user.isAdmin}>
            {row}
          </SongContextMenu>
        )}
        empty="No songs."
      />

      {songEditEntity && (
        <EditEntityModal
          open
          entityType="song"
          entity={songEditEntity}
          onClose={() => setSongEditing(null)}
          onSave={handleSongSave}
          onDelete={handleSongDelete}
          onEditSyncedLyrics={() => songEditing && setSyncEditing(songEditing)}
          saving={saving}
          deleting={deleting}
          coverArtBusy={coverArtBusy}
        />
      )}

      {albumEditEntity && (
        <EditEntityModal
          open
          entityType="album"
          entity={albumEditEntity}
          onClose={() => setAlbumEditing(null)}
          onSave={handleAlbumSave}
          onDelete={handleAlbumDelete}
          onEditCoverArt={handleAlbumEditCoverArt}
          onDeleteCoverArt={handleAlbumDeleteCoverArt}
          saving={saving}
          deleting={deleting}
          coverArtBusy={coverArtBusy}
        />
      )}
      <input
        ref={albumCoverInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleAlbumCoverArtFileChange}
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
    </EntityDetail>
  );
}

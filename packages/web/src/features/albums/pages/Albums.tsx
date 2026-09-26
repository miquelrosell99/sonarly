import { useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import type { Album, Song, User } from '@sonarly/shared';
import { api } from '../../../lib/api.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { ExplicitTitle } from '../../../components/ExplicitTitle.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { useFilterParams } from '../../../hooks/useFilterParams.js';
import { useAlbumContextMenu } from '../../../hooks/useAlbumContextMenu.js';
import { useAdminContextMenu } from '../../../hooks/useAdminContextMenu.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { EditEntityModal } from '../../../components/EditEntityModal.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';
import { useAlbumsList } from '../../../hooks/useLibraryLists.js';

interface AlbumDetail {
  album: Album;
  songs: Song[];
}

function AlbumContextMenu({
  album,
  onEdit,
  children,
}: {
  album: Album;
  onEdit: () => void;
  children: ReactNode;
}) {
  const sections = useAlbumContextMenu(album);
  return (
    <ItemContextMenu sections={[...sections, { items: [{ id: 'edit', label: 'Edit', icon: 'mdi-pencil', onClick: onEdit }] }]}>
      {children}
    </ItemContextMenu>
  );
}

export function Albums({ user }: { user: User }) {
  const blurExplicitTitles = user.blurExplicitTitles === true;
  const [editing, setEditing] = useState<Album | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [coverArtBusy, setCoverArtBusy] = useState(false);
  const { notify } = useNotification();
  const coverInputRef = useRef<HTMLInputElement>(null);
  const { playSongs, shufflePlay } = usePlayActions();
  const { setFavorite, setRating } = useFavoriteActions();
  const [, setLocation] = useLocation();
  const currentAlbumId = usePlayer((state) => state.currentSong?.albumId);
  const { get } = useFilterParams();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch, patchItem } = useAlbumsList({ libraryId: selectedLibraryId });
  const albums = data?.albums ?? [];

  // Album edits (tags, delete, cover art) can reshuffle list membership and
  // ordering beyond a single-row patch; drop the domain cache instead.
  const invalidateAlbums = () => queryClient.invalidateQueries({ queryKey: ['albums'] });

  const yearFrom = get('yearFrom');
  const yearTo = get('yearTo');
  const genre = get('genre');
  const favorites = get('favorites');
  const hasActiveFilters = Boolean(yearFrom || yearTo || genre || favorites);

  const filteredAlbums = albums.filter((album) => {
    if (yearFrom !== null && yearFrom !== '') {
      const from = Number(yearFrom);
      if (!Number.isNaN(from) && (album.year === undefined || album.year < from)) return false;
    }
    if (yearTo !== null && yearTo !== '') {
      const to = Number(yearTo);
      if (!Number.isNaN(to) && (album.year === undefined || album.year > to)) return false;
    }
    if (genre && album.genre !== genre) return false;
    if (favorites === 'true' && !album.starred) return false;
    return true;
  });

  const playAlbum = async (album: Album) => {
    try {
      const detail = await api<AlbumDetail>(`/albums/${album.id}${buildLibraryQuery(selectedLibraryId)}`);
      playSongs(detail.songs);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to play album', 'error');
    }
  };

  const shuffleAlbums = async (albums: Album[]) => {
    if (albums.length === 0) return;
    try {
      const details = await Promise.all(
        albums.map((album) => api<AlbumDetail>(`/albums/${album.id}${buildLibraryQuery(selectedLibraryId)}`)),
      );
      shufflePlay(details.flatMap((detail) => detail.songs));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to shuffle albums', 'error');
    }
  };

  const handleFavorite = async (album: Album, starred: boolean) => {
    try {
      await setFavorite('album', album.id, starred);
      patchItem(album.id, { starred });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update favorite', 'error');
    }
  };

  const handleRate = async (album: Album, rating?: number) => {
    try {
      await setRating('album', album.id, rating);
      patchItem(album.id, { rating });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update rating', 'error');
    }
  };

  const handleSave = async (patched: Record<string, unknown>) => {
    if (!editing) return;
    setSaving(true);
    try {
      await api(`/albums/${editing.id}/tags`, {
        method: 'PUT',
        body: JSON.stringify(patched),
      });
      setEditing(null);
      await invalidateAlbums();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save album', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    setDeleting(true);
    try {
      await api(`/albums/${editing.id}`, { method: 'DELETE' });
      setEditing(null);
      await invalidateAlbums();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete album', 'error');
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
      await api(`/albums/${editing.id}/cover-art`, {
        method: 'POST',
        body: formData,
      });
      await invalidateAlbums();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update cover art', 'error');
    } finally {
      setCoverArtBusy(false);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  const handleDeleteCoverArt = async () => {
    if (!editing) return;
    setCoverArtBusy(true);
    try {
      await api(`/albums/${editing.id}/cover-art`, { method: 'DELETE' });
      await invalidateAlbums();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to remove cover art', 'error');
    } finally {
      setCoverArtBusy(false);
    }
  };

  const columns: LibraryViewColumn<Album>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (album) => (
        <ExplicitTitle explicit={album.explicit} blur={blurExplicitTitles}>
          <Link href={`/albums/${album.id}`} className="hover:text-muted">
            {album.name}
          </Link>
        </ExplicitTitle>
      ),
    },
    { key: 'artist', header: 'Artist', render: (album) => album.artistName ?? '-' },
    { key: 'year', header: 'Year', className: 'w-20', render: (album) => album.year ?? '-' },
    { key: 'genre', header: 'Genre', render: (album) => album.genre ?? '-' },
  ];

  const cardFields: LibraryViewCardField<Album>[] = [
    { key: 'title', render: (album) => <ExplicitTitle title={album.name} explicit={album.explicit} blur={blurExplicitTitles} /> },
    {
      key: 'artist-year',
      render: (album) => (
        <span>
          {album.artistId ? (
            <Link href={`/artists/${album.artistId}`} className="hover:text-muted">
              {album.artistName ?? 'Unknown artist'}
            </Link>
          ) : (
            album.artistName ?? '-'
          )}
          {album.year !== undefined && album.year !== null && (
            <>
              {' • '}
              <Link href={`/years/${album.year}`} className="hover:text-muted">
                {album.year}
              </Link>
            </>
          )}
        </span>
      ),
    },
    {
      key: 'genre',
      render: (album) =>
        album.genre ? (
          <Link href={`/genres/${encodeURIComponent(album.genre)}`} className="hover:text-muted">
            {album.genre}
          </Link>
        ) : (
          '-'
        ),
    },
  ];

  const editEntity = editing
    ? {
        ...editing,
        title: editing.name,
        albumArtist: editing.artistName,
      }
    : null;

  return (
    <>
      <LibraryView
        title="Albums"
        data={filteredAlbums}
        isLoading={isLoading}
        error={error?.message ?? null}
        columns={columns}
        cardFields={cardFields}
        getId={(album) => album.id}
        getHref={(album) => `/albums/${album.id}`}
        onPlay={playAlbum}
        onShufflePlay={shuffleAlbums}
        onFavorite={handleFavorite}
        onRate={handleRate}
        getFavorite={(album) => album.starred}
        getRating={(album) => album.rating}
        getCover={(album) => album.coverArt}
        getCoverAlt={(album) => `Cover art for ${album.name}`}
        playingId={currentAlbumId}
        renderContextMenu={(album, children, _selectedItems) => (
          <AlbumContextMenu album={album} onEdit={() => setEditing(album)}>
            {children}
          </AlbumContextMenu>
        )}
        emptyMessage={hasActiveFilters ? 'No albums match the current filters.' : 'Your library has no albums yet.'}
        emptyDescription={!hasActiveFilters && albums.length === 0 && user.isAdmin ? 'Upload music from the top bar to get started.' : undefined}
        emptyAction={hasActiveFilters ? { label: 'Clear filters', onClick: () => setLocation('/albums') } : undefined}
        onRetry={() => void refetch()}
        defaultView="grid"
      />
      {editEntity && (
        <EditEntityModal
          open
          entityType="album"
          entity={editEntity}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={handleDelete}
          onEditCoverArt={handleEditCoverArt}
          onDeleteCoverArt={handleDeleteCoverArt}
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
    </>
  );
}

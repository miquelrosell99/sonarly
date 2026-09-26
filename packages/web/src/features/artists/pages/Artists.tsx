import { useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import type { Artist } from '../../../types';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { ArtistImage } from '../../../components/ArtistImage.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { useFilterParams } from '../../../hooks/useFilterParams.js';
import { useArtistContextMenu } from '../../../hooks/useArtistContextMenu.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { EditEntityModal } from '../../../components/EditEntityModal.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { useLibraryStore } from '../../../stores/libraryStore.js';
import { useArtistsList, useSongsList } from '../../../hooks/useLibraryLists.js';

function ArtistContextMenu({
  artist,
  onEdit,
  children,
}: {
  artist: Artist;
  onEdit: () => void;
  children: ReactNode;
}) {
  const sections = useArtistContextMenu(artist, onEdit);
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

export function Artists() {
  const [editing, setEditing] = useState<Artist | null>(null);
  const { notify } = useNotification();
  const { setFavorite, setRating } = useFavoriteActions();
  const { get } = useFilterParams();
  const [, setLocation] = useLocation();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const { data: artistsData, isLoading, error, refetch, patchItem } = useArtistsList({ libraryId: selectedLibraryId });
  const { data: songsData } = useSongsList({ libraryId: selectedLibraryId });
  const artists = artistsData?.artists ?? [];
  const songs = songsData?.songs ?? [];

  const artistGenres = useMemo(() => {
    const map = new Map<string, Set<string>>();
    songs.forEach((song) => {
      if (!song.artistId || !song.genres) return;
      const set = map.get(song.artistId) ?? new Set<string>();
      for (const g of song.genres) {
        set.add(g);
      }
      map.set(song.artistId, set);
    });
    return map;
  }, [songs]);

  const genre = get('genre');
  const filteredArtists = genre
    ? artists.filter((artist) => artistGenres.get(artist.id)?.has(genre))
    : artists;

  const handleFavorite = async (artist: Artist, starred: boolean) => {
    try {
      await setFavorite('artist', artist.id, starred);
      patchItem(artist.id, { starred });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update favorite', 'error');
    }
  };

  const handleRate = async (artist: Artist, rating?: number) => {
    try {
      await setRating('artist', artist.id, rating);
      patchItem(artist.id, { rating });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update rating', 'error');
    }
  };

  const columns: LibraryViewColumn<Artist>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (artist) => (
        <Link href={`/artists/${artist.id}`} className="hover:text-muted">
          {artist.name}
        </Link>
      ),
    },
  ];

  const cardFields: LibraryViewCardField<Artist>[] = [
    { key: 'name', render: (artist) => artist.name },
  ];

  return (
    <>
      <LibraryView
        title="Artists"
        data={filteredArtists}
        isLoading={isLoading}
        error={error?.message ?? null}
        columns={columns}
        cardFields={cardFields}
        getId={(artist) => artist.id}
        getHref={(artist) => `/artists/${artist.id}`}
        onFavorite={handleFavorite}
        onRate={handleRate}
        getFavorite={(artist) => artist.starred}
        getRating={(artist) => artist.rating}
        renderCover={(artist) => <ArtistImage artistId={artist.id} alt={artist.name} className="h-full w-full" />}
        renderContextMenu={(artist, children, _selectedItems) => (
          <ArtistContextMenu artist={artist} onEdit={() => setEditing(artist)}>
            {children}
          </ArtistContextMenu>
        )}
        emptyMessage={genre ? 'No artists match the current filters.' : 'Your library has no artists yet.'}
        emptyAction={genre ? { label: 'Clear filters', onClick: () => setLocation('/artists') } : undefined}
        onRetry={() => void refetch()}
        defaultView="grid"
      />
      {editing && (
        <EditEntityModal
          open
          entityType="artist"
          entity={(editing as unknown) as Record<string, unknown>}
          onClose={() => setEditing(null)}
          readOnly
        />
      )}
    </>
  );
}

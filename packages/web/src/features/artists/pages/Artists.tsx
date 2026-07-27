import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import type { Artist, Song } from '@sonarly/shared';
import { api } from '../../../api.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { ArtistImage } from '../../../components/ArtistImage.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { useFilterParams } from '../../../hooks/useFilterParams.js';
import { useArtistContextMenu } from '../../../hooks/useArtistContextMenu.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { EditEntityModal } from '../../../components/EditEntityModal.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';

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
  const [artists, setArtists] = useState<Artist[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Artist | null>(null);
  const { notify } = useNotification();
  const { setFavorite, setRating } = useFavoriteActions();
  const { get } = useFilterParams();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);

  const load = () => {
    setLoading(true);
    Promise.all([
      api<{ artists: Artist[] }>(`/artists${buildLibraryQuery(selectedLibraryId)}`),
      api<{ songs: Song[] }>(`/songs${buildLibraryQuery(selectedLibraryId)}`),
    ])
      .then(([artistsRes, songsRes]) => {
        setArtists(artistsRes.artists);
        setSongs(songsRes.songs);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load artists'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [selectedLibraryId]);

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
      setArtists((prev) =>
        prev.map((a) => (a.id === artist.id ? { ...a, starred } : a)),
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update favorite', 'error');
    }
  };

  const handleRate = async (artist: Artist, rating?: number) => {
    try {
      await setRating('artist', artist.id, rating);
      setArtists((prev) =>
        prev.map((a) => (a.id === artist.id ? { ...a, rating } : a)),
      );
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
        isLoading={loading}
        error={error}
        columns={columns}
        cardFields={cardFields}
        getId={(artist) => artist.id}
        getHref={(artist) => `/artists/${artist.id}`}
        onFavorite={handleFavorite}
        onRate={handleRate}
        getFavorite={(artist) => artist.starred}
        getRating={(artist) => artist.rating}
        renderCover={(artist) => <ArtistImage artistId={artist.id} alt={artist.name} className="h-full w-full" />}
        renderContextMenu={(artist, children) => (
          <ArtistContextMenu artist={artist} onEdit={() => setEditing(artist)}>
            {children}
          </ArtistContextMenu>
        )}
        emptyMessage="No artists match the current filters."
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

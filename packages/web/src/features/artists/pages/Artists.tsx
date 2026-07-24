import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import type { Artist, Song } from '@sonarly/shared';
import { api } from '../../../api.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { useFilterParams } from '../../../hooks/useFilterParams.js';

export function Artists() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { setFavorite, setRating } = useFavoriteActions();
  const { get } = useFilterParams();

  const load = () => {
    setLoading(true);
    Promise.all([
      api<{ artists: Artist[] }>('/artists'),
      api<{ songs: Song[] }>('/songs'),
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
  }, []);

  const artistGenres = useMemo(() => {
    const map = new Map<string, Set<string>>();
    songs.forEach((song) => {
      if (!song.artistId || !song.genre) return;
      const set = map.get(song.artistId) ?? new Set<string>();
      set.add(song.genre);
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
      setError(err instanceof Error ? err.message : 'Failed to update favorite');
    }
  };

  const handleRate = async (artist: Artist, rating?: number) => {
    try {
      await setRating('artist', artist.id, rating);
      setArtists((prev) =>
        prev.map((a) => (a.id === artist.id ? { ...a, rating } : a)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rating');
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
      emptyMessage="No artists match the current filters."
    />
  );
}

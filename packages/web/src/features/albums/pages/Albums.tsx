import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { Album, Song } from '@sonarly/shared';
import { api } from '../../../api.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { useFilterParams } from '../../../hooks/useFilterParams.js';

interface AlbumDetail {
  album: Album;
  songs: Song[];
}

export function Albums() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { playSongs, shufflePlay } = usePlayActions();
  const { setFavorite, setRating } = useFavoriteActions();
  const { get } = useFilterParams();

  const load = () => {
    setLoading(true);
    api<{ albums: Album[] }>('/albums')
      .then((res) => setAlbums(res.albums))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load albums'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const yearFrom = get('yearFrom');
  const yearTo = get('yearTo');
  const genre = get('genre');
  const favorites = get('favorites');

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
      const detail = await api<AlbumDetail>(`/albums/${album.id}`);
      playSongs(detail.songs, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to play album');
    }
  };

  const shuffleAlbums = async (albums: Album[]) => {
    if (albums.length === 0) return;
    try {
      const details = await Promise.all(
        albums.map((album) => api<AlbumDetail>(`/albums/${album.id}`)),
      );
      shufflePlay(details.flatMap((detail) => detail.songs));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to shuffle albums');
    }
  };

  const handleFavorite = async (album: Album, starred: boolean) => {
    try {
      await setFavorite('album', album.id, starred);
      setAlbums((prev) =>
        prev.map((a) => (a.id === album.id ? { ...a, starred } : a)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update favorite');
    }
  };

  const handleRate = async (album: Album, rating?: number) => {
    try {
      await setRating('album', album.id, rating);
      setAlbums((prev) =>
        prev.map((a) => (a.id === album.id ? { ...a, rating } : a)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rating');
    }
  };

  const columns: LibraryViewColumn<Album>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (album) => (
        <Link href={`/albums/${album.id}`} className="hover:text-muted">
          {album.name}
        </Link>
      ),
    },
    { key: 'artist', header: 'Artist', render: (album) => album.artistName ?? '-' },
    { key: 'year', header: 'Year', className: 'w-20', render: (album) => album.year ?? '-' },
    { key: 'genre', header: 'Genre', render: (album) => album.genre ?? '-' },
  ];

  const cardFields: LibraryViewCardField<Album>[] = [
    { key: 'title', render: (album) => album.name },
    { key: 'artist', render: (album) => album.artistName ?? '-' },
    { key: 'year', render: (album) => album.year ?? '-' },
  ];

  return (
    <LibraryView
      title="Albums"
      data={filteredAlbums}
      isLoading={loading}
      error={error}
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
      emptyMessage="No albums match the current filters."
    />
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { Album, Song } from '@sonarly/shared';
import { api } from '../../../api.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';

interface AlbumDetail {
  album: Album;
  songs: Song[];
}

export function Albums() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { playSongs, shufflePlay } = usePlayActions();

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
      data={albums}
      isLoading={loading}
      error={error}
      columns={columns}
      cardFields={cardFields}
      getId={(album) => album.id}
      getHref={(album) => `/albums/${album.id}`}
      onPlay={playAlbum}
      onShufflePlay={shuffleAlbums}
      emptyMessage="No albums found."
    />
  );
}

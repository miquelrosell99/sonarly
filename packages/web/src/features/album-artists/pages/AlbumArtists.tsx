import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { Album } from '@sonarly/shared';
import { api } from '../../../lib/api.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { ArtistImage } from '../../../components/ArtistImage.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';

interface AlbumArtist {
  id: string;
  name: string;
}

export function AlbumArtists() {
  const [artists, setArtists] = useState<AlbumArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);

  const load = () => {
    setLoading(true);
    api<{ albums: Album[] }>(`/albums${buildLibraryQuery(selectedLibraryId)}`)
      .then((res) => {
        const map = new Map<string, AlbumArtist>();
        for (const album of res.albums) {
          if (!album.artistId) continue;
          if (!map.has(album.artistId)) {
            map.set(album.artistId, { id: album.artistId, name: album.artistName ?? 'Unknown' });
          }
        }
        const derived = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
        setArtists(derived);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load album artists'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [selectedLibraryId]);

  const columns: LibraryViewColumn<AlbumArtist>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (artist) => (
        <Link href={`/album-artists/${artist.id}`} className="hover:text-muted">
          {artist.name}
        </Link>
      ),
    },
  ];

  const cardFields: LibraryViewCardField<AlbumArtist>[] = [
    { key: 'name', render: (artist) => artist.name },
  ];

  return (
    <LibraryView
      title="Album Artists"
      data={artists}
      isLoading={loading}
      error={error}
      columns={columns}
      cardFields={cardFields}
      getId={(artist) => artist.id}
      getHref={(artist) => `/album-artists/${artist.id}`}
      emptyMessage="No album artists found."
    />
  );
}

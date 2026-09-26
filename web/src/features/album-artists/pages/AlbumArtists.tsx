import { useMemo } from 'react';
import { Link } from 'wouter';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { useLibraryStore } from '../../../stores/libraryStore.js';
import { useAlbumsList } from '../../../hooks/useLibraryLists.js';

interface AlbumArtist {
  id: string;
  name: string;
}

export function AlbumArtists() {
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const { data, isLoading, error, refetch } = useAlbumsList({ libraryId: selectedLibraryId });

  const artists = useMemo<AlbumArtist[]>(() => {
    const map = new Map<string, AlbumArtist>();
    for (const album of data?.albums ?? []) {
      if (!album.artistId) continue;
      if (!map.has(album.artistId)) {
        map.set(album.artistId, { id: album.artistId, name: album.artistName ?? 'Unknown' });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

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
      isLoading={isLoading}
      error={error?.message ?? null}
      columns={columns}
      cardFields={cardFields}
      getId={(artist) => artist.id}
      getHref={(artist) => `/album-artists/${artist.id}`}
      emptyMessage="No album artists found."
      onRetry={() => void refetch()}
    />
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { Album } from '@sonarly/shared';
import { api } from '../../../api.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';

export function Labels() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);

  useEffect(() => {
    setLoading(true);
    api<{ albums: Album[] }>(`/albums${buildLibraryQuery(selectedLibraryId)}`)
      .then((res) => setAlbums(res.albums))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load labels'))
      .finally(() => setLoading(false));
  }, [selectedLibraryId]);

  const labels = Array.from(
    new Set(albums.flatMap((album) => album.labels ?? [])),
  ).sort((a, b) => a.localeCompare(b));

  const columns: LibraryViewColumn<string>[] = [
    {
      key: 'name',
      header: 'Label',
      render: (label) => (
        <Link href={`/labels/${encodeURIComponent(label)}`} className="hover:text-muted">
          {label}
        </Link>
      ),
    },
  ];

  const cardFields: LibraryViewCardField<string>[] = [
    { key: 'name', render: (label) => label },
  ];

  return (
    <LibraryView
      title="Labels"
      data={labels}
      isLoading={loading}
      error={error}
      columns={columns}
      cardFields={cardFields}
      getId={(label) => label}
      getHref={(label) => `/labels/${encodeURIComponent(label)}`}
      emptyMessage="No labels found."
      defaultView="list"
    />
  );
}

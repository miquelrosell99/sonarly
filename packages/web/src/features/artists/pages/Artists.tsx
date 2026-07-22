import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { Artist } from '@sonarly/shared';
import { api } from '../../../api.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';

export function Artists() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api<{ artists: Artist[] }>('/artists')
      .then((res) => setArtists(res.artists))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load artists'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

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
      data={artists}
      isLoading={loading}
      error={error}
      columns={columns}
      cardFields={cardFields}
      getId={(artist) => artist.id}
      getHref={(artist) => `/artists/${artist.id}`}
      emptyMessage="No artists found."
    />
  );
}

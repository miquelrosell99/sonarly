import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { api } from '../../../api.js';

interface Artist {
  id: string;
  name: string;
}

export function Library() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ artists: Artist[] }>('/artists')
      .then((r) => setArtists(r.artists))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load artists'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Artists</h2>
      <ul className="divide-y divide-gray-100">
        {artists.map((a) => (
          <li key={a.id}>
            <Link
              href={`/artists/${a.id}`}
              className="block py-2 text-sm hover:bg-gray-50"
            >
              {a.name}
            </Link>
          </li>
        ))}
      </ul>
      {artists.length === 0 && <p className="py-4 text-sm text-gray-500">No artists found.</p>}
    </div>
  );
}

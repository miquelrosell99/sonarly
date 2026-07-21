import { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import { api } from '../api.js';

interface Album {
  id: string;
  name: string;
  year?: number;
}

interface ArtistDetail {
  id: string;
  name: string;
  albums: Album[];
}

export function Artist() {
  const { id } = useParams<{ id: string }>();
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api<{ artist: ArtistDetail }>(`/artists/${id}`)
      .then((r) => setArtist(r.artist))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load artist'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!artist) return <p className="text-sm text-gray-500">Artist not found.</p>;

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">{artist.name}</h2>
      <h3 className="mb-2 text-sm font-medium text-gray-500">Albums</h3>
      <ul className="divide-y divide-gray-100">
        {artist.albums.map((album) => (
          <li key={album.id}>
            <Link
              href={`/albums/${album.id}`}
              className="flex items-center justify-between py-2 text-sm hover:bg-gray-50"
            >
              <span>{album.name}</span>
              {album.year !== undefined && album.year !== null && <span className="text-gray-400">{album.year}</span>}
            </Link>
          </li>
        ))}
      </ul>
      {artist.albums.length === 0 && <p className="py-4 text-sm text-gray-500">No albums found.</p>}
    </div>
  );
}

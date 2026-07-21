import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { api } from '../api.js';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';

interface Playlist {
  id: string;
  name: string;
  ownerUsername: string;
  songCount: number;
  visibility: string;
}

export function Playlists() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api<{ playlists: Playlist[] }>('/playlists')
      .then((r) => setPlaylists(r.playlists))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load playlists'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api('/playlists', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      setName('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create playlist');
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading...</p>;

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Playlists</h2>
      <div className="mb-6 flex gap-2">
        <Input
          placeholder="New playlist name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <Button onClick={create} disabled={creating || !name.trim()}>
          Create
        </Button>
      </div>
      {error && <p className="mb-4 text-sm text-danger">{error}</p>}
      <ul className="divide-y divide-gray-100">
        {playlists.map((p) => (
          <li key={p.id}>
            <Link
              href={`/playlists/${p.id}`}
              className="flex items-center justify-between py-2 text-sm hover:bg-gray-50"
            >
              <span>{p.name}</span>
              <span className="text-gray-400">
                {p.songCount} {p.songCount === 1 ? 'song' : 'songs'} • {p.ownerUsername} • {p.visibility}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {playlists.length === 0 && <p className="py-4 text-sm text-gray-500">No playlists found.</p>}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import type { SmartPlaylistRules } from '@sonarly/shared';
import { SmartPlaylistEditor } from '../components/SmartPlaylistEditor.js';

interface Playlist {
  id: string;
  name: string;
  ownerUsername: string;
  songCount: number;
  visibility: string;
  isSmart?: boolean;
}

export function Playlists() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [name, setName] = useState('');
  const [isSmart, setIsSmart] = useState(false);
  const [rules, setRules] = useState<SmartPlaylistRules>({ rules: { all: [{ field: 'title', operator: 'contains', value: '' }] } });
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
      const body: Record<string, unknown> = { name: name.trim() };
      if (isSmart) {
        body.isSmart = true;
        body.rules = rules;
      }
      await api('/playlists', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setName('');
      setIsSmart(false);
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
      <div className="mb-6 space-y-3 rounded border border-gray-200 p-4 dark:border-gray-700">
        <div className="flex gap-2">
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
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isSmart}
            onChange={(e) => setIsSmart(e.target.checked)}
          />
          Smart playlist (query-based)
        </label>
        {isSmart && (
          <SmartPlaylistEditor initialRules={rules} onChange={setRules} />
        )}
      </div>
      {error && <p className="mb-4 text-sm text-danger">{error}</p>}
      <ul className="divide-y divide-gray-100">
        {playlists.map((p) => (
          <li key={p.id}>
            <Link
              href={`/playlists/${p.id}`}
              className="flex items-center justify-between py-2 text-sm hover:bg-gray-50"
            >
              <span className="flex items-center gap-2">
                {p.name}
                {p.isSmart && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">smart</span>
                )}
              </span>
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

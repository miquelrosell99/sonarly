import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { api } from '../../../api.js';
import { cn } from '../../../lib/cn.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { Icon } from '../../../components/ui/Icon.js';
import type { SmartPlaylistRules } from '@sonarly/shared';
import { SmartPlaylistEditor } from '../components/SmartPlaylistEditor.js';
import { useFilterParams } from '../../../hooks/useFilterParams.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';

interface Playlist {
  id: string;
  name: string;
  ownerUsername: string;
  songCount: number;
  visibility: string;
  isSmart?: boolean;
  starred?: boolean;
  rating?: number;
}

export function Playlists() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [name, setName] = useState('');
  const [creationMode, setCreationMode] = useState<'normal' | 'smart'>('normal');
  const [menuOpen, setMenuOpen] = useState(false);
  const [rules, setRules] = useState<SmartPlaylistRules>({ rules: { all: [{ field: 'title', operator: 'contains', value: '' }] } });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleMouse = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleMouse);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouse);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);
  const { setFavorite, setRating } = useFavoriteActions();
  const { get } = useFilterParams();

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
      if (creationMode === 'smart') {
        body.isSmart = true;
        body.rules = rules;
      }
      await api('/playlists', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setName('');
      setCreationMode('normal');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create playlist');
    } finally {
      setCreating(false);
    }
  };

  const owner = get('owner');
  const visibility = get('visibility');

  const filteredPlaylists = playlists.filter((p) => {
    if (owner && p.ownerUsername !== owner) return false;
    if (visibility && p.visibility !== visibility) return false;
    return true;
  });

  const handleFavorite = async (playlist: Playlist, starred: boolean) => {
    try {
      await setFavorite('playlist', playlist.id, starred);
      setPlaylists((prev) =>
        prev.map((p) => (p.id === playlist.id ? { ...p, starred } : p)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update favorite');
    }
  };

  const handleRate = async (playlist: Playlist, rating?: number) => {
    try {
      await setRating('playlist', playlist.id, rating);
      setPlaylists((prev) =>
        prev.map((p) => (p.id === playlist.id ? { ...p, rating } : p)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rating');
    }
  };

  if (loading) return <p className="text-sm text-muted">Loading...</p>;

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Playlists</h2>
      <div className="mb-6 space-y-3 rounded border border-rule p-4">
        <div className="flex gap-2">
          <Input
            placeholder="New playlist name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <div ref={menuRef} className="relative flex">
            <Button
              onClick={create}
              disabled={creating || !name.trim()}
              className="rounded-r-none"
            >
              {creationMode === 'smart' ? 'Create smart playlist' : 'Create playlist'}
            </Button>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="More create options"
              className="btn rounded-l-none border-l-0 px-2"
            >
              <Icon name="mdi-chevron-down" size={18} className={cn('transition-transform', menuOpen && 'rotate-180')} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-40 mt-2 w-48 rounded-md border border-rule bg-surface py-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setCreationMode(creationMode === 'normal' ? 'smart' : 'normal');
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-fg-primary transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
                >
                  {creationMode === 'normal' ? 'Create smart playlist' : 'Create playlist'}
                </button>
              </div>
            )}
          </div>
        </div>
        {creationMode === 'smart' && (
          <SmartPlaylistEditor initialRules={rules} onChange={setRules} />
        )}
      </div>
      {error && <p className="mb-4 text-sm text-danger">{error}</p>}
      <ul className="divide-y divide-rule">
        {filteredPlaylists.map((p) => (
          <li key={p.id}>
            <div className="flex items-center justify-between py-2 text-sm hover:bg-surface-hover">
              <Link
                href={`/playlists/${p.id}`}
                className="flex items-center gap-2"
              >
                {p.name}
                {p.isSmart && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">smart</span>
                )}
              </Link>
              <span className="inline-flex items-center gap-2 text-muted">
                {p.songCount} {p.songCount === 1 ? 'song' : 'songs'} • {p.ownerUsername} • {p.visibility}
                <button
                  type="button"
                  onClick={() => handleFavorite(p, !p.starred)}
                  aria-label={p.starred ? 'Remove favorite' : 'Add favorite'}
                  title={p.starred ? 'Remove favorite' : 'Add favorite'}
                  className={cn(
                    'rounded p-1 transition hover:bg-surface-hover',
                    p.starred ? 'text-accent' : 'text-muted hover:text-accent',
                  )}
                >
                  <Icon name={p.starred ? 'mdi-heart' : 'mdi-heart-outline'} size={18} />
                </button>
                <span className="inline-flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleRate(p, value === p.rating ? undefined : value)}
                      aria-label={`Rate ${value} stars`}
                      className={cn(
                        'rounded p-0.5 transition hover:bg-surface-hover',
                        value <= (p.rating ?? 0) ? 'text-accent' : 'text-muted hover:text-accent/70',
                      )}
                    >
                      <Icon
                        name={value <= (p.rating ?? 0) ? 'mdi-star' : 'mdi-star-outline'}
                        size={14}
                      />
                    </button>
                  ))}
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
      {filteredPlaylists.length === 0 && <p className="py-4 text-sm text-muted">No playlists match the current filters.</p>}
    </div>
  );
}

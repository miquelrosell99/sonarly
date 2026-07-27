import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { usePlaylistContextMenu } from '../../../hooks/usePlaylistContextMenu.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { PlaylistCoverGrid } from '../components/PlaylistCoverGrid.js';

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

function PlaylistContextMenu({
  playlist,
  onEdit,
  onConvert,
  children,
}: {
  playlist: Playlist;
  onEdit: () => void;
  onConvert: () => void;
  children: ReactNode;
}) {
  const sections = usePlaylistContextMenu(playlist as any, onEdit, onConvert);
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
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
  const { setFavorite, setRating } = useFavoriteActions();
  const { get } = useFilterParams();

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

  const columns: LibraryViewColumn<Playlist>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (playlist) => (
        <Link href={`/playlists/${playlist.id}`} className="hover:text-muted">
          {playlist.name}
        </Link>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (playlist) => playlist.ownerUsername,
    },
    {
      key: 'visibility',
      header: 'Visibility',
      render: (playlist) => playlist.visibility,
    },
    {
      key: 'songs',
      header: 'Songs',
      render: (playlist) => playlist.songCount,
      className: 'w-20 text-right',
    },
  ];

  const cardFields: LibraryViewCardField<Playlist>[] = [
    { key: 'name', render: (playlist) => playlist.name },
    { key: 'meta', render: (playlist) => `${playlist.ownerUsername} • ${playlist.songCount} songs` },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded border border-rule p-4">
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
      {error && <p className="text-sm text-danger">{error}</p>}
      <LibraryView
        title="Playlists"
        data={filteredPlaylists}
        isLoading={loading}
        columns={columns}
        cardFields={cardFields}
        getId={(playlist) => playlist.id}
        getHref={(playlist) => `/playlists/${playlist.id}`}
        onFavorite={handleFavorite}
        onRate={handleRate}
        getFavorite={(playlist) => playlist.starred}
        getRating={(playlist) => playlist.rating}
        renderCover={(playlist) => <PlaylistCoverGrid playlistId={playlist.id} />}
        renderContextMenu={(playlist, children) => (
          <PlaylistContextMenu
            playlist={playlist}
            onEdit={() => { /* edit happens on the playlist detail page */ }}
            onConvert={() => load()}
          >
            {children}
          </PlaylistContextMenu>
        )}
        emptyMessage="No playlists match the current filters."
        defaultView="list"
      />
    </div>
  );
}

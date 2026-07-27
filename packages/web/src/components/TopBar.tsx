import { useState, useRef, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import type { User, Song as BaseSong, Album } from '@sonarly/shared';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { api } from '../api.js';
import { Avatar } from './Avatar.js';
import { SearchBox } from './SearchBox.js';
import type { FilterDefinition } from './FilterPanel.js';
import type { PlayerInfo } from '@sonarly/shared';

interface TopBarProps {
  user: User;
  onLogout: () => void;
}

interface PlaylistListItem {
  id: string;
  name: string;
  ownerUsername: string;
  visibility: string;
}

interface SongListItem extends BaseSong {
  artistName?: string;
  albumName?: string;
}

function usePlayers() {
  return useQuery<{ players: PlayerInfo[] }, Error, PlayerInfo[]>({
    queryKey: ['players'],
    queryFn: () => api('/players'),
    select: (data) => data.players,
    refetchInterval: 5000,
  });
}

function PlayersDropdown() {
  const { data: players = [] } = usePlayers();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (players.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Connected devices (${players.length})`}
        className={cn(
          'relative flex h-10 w-10 items-center justify-center rounded-full text-fg-secondary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          open ? 'bg-surface-hover text-fg-primary' : 'hover:bg-surface-hover hover:text-fg-primary',
        )}
      >
        <Icon name="mdi-cast-audio" size={20} />
        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-bg-primary">
          {players.length}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-64 rounded-xl border border-rule bg-surface p-1 shadow-xl"
        >
          {players.map((player) => (
            <div key={player.id} className="px-3 py-2 text-sm">
              <p className="font-medium text-fg-primary">{player.clientId}</p>
              <p className="truncate text-xs text-fg-secondary">{player.songTitle}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu({ user, onLogout }: TopBarProps) {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const displayName = [user.name, user.surname].filter(Boolean).join(' ') || user.username;

  const navigate = (to: string) => {
    setOpen(false);
    setLocation(to);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full p-1 pr-3 text-left transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Avatar user={user} className="h-8 w-8" />
        <span className="hidden max-w-[8rem] truncate text-sm font-medium md:block">
          {displayName}
        </span>
        <Icon
          name="mdi-chevron-down"
          size={16}
          className={cn('hidden text-fg-secondary transition-transform md:block', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-52 rounded-xl border border-rule bg-surface p-1 shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => navigate('/statistics')}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-fg-primary transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
          >
            <Icon name="mdi-chart-bar" size={18} className="text-fg-secondary" />
            Statistics
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => navigate('/settings/profile')}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-fg-primary transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
          >
            <Icon name="mdi-cog" size={18} className="text-fg-secondary" />
            Settings
          </button>
          {user.isAdmin && (
            <button
              type="button"
              role="menuitem"
              onClick={() => navigate('/admin')}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-fg-primary transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
            >
              <Icon name="mdi-account-group" size={18} className="text-fg-secondary" />
              Admin
            </button>
          )}
          <div className="my-1 border-t border-rule" />
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onLogout(); }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-fg-primary transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
          >
            <Icon name="mdi-logout" size={18} className="text-fg-secondary" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

function uniqueSortedOptions(values: (string | undefined | null)[]): FilterDefinition['options'] {
  const seen = new Set<string>();
  values.forEach((v) => {
    if (v) seen.add(v);
  });
  return Array.from(seen)
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value }));
}

function useFilterData(location: string) {
  const albumsEnabled = location === '/albums' || location.startsWith('/albums/');
  const tracksEnabled = location === '/tracks' || location.startsWith('/tracks/');
  const artistsEnabled = location === '/artists' || location.startsWith('/artists/');
  const playlistsEnabled = location === '/playlists' || location.startsWith('/playlists/');

  const albumsQuery = useQuery<{ albums: Album[] }, Error, Album[]>({
    queryKey: ['albums'],
    queryFn: () => api('/albums'),
    select: (data) => data.albums,
    enabled: albumsEnabled,
    staleTime: 60_000,
  });

  const songsQuery = useQuery<{ songs: SongListItem[] }, Error, SongListItem[]>({
    queryKey: ['songs'],
    queryFn: () => api('/songs'),
    select: (data) => data.songs,
    enabled: tracksEnabled || artistsEnabled,
    staleTime: 60_000,
  });

  const playlistsQuery = useQuery<{ playlists: PlaylistListItem[] }, Error, PlaylistListItem[]>({
    queryKey: ['playlists'],
    queryFn: () => api('/playlists'),
    select: (data) => data.playlists,
    enabled: playlistsEnabled,
    staleTime: 60_000,
  });

  return {
    albums: albumsQuery.data ?? [],
    songs: songsQuery.data ?? [],
    playlists: playlistsQuery.data ?? [],
  };
}

function useFilterDefinitions(location: string): FilterDefinition[] {
  const { albums, songs, playlists } = useFilterData(location);

  return useMemo(() => {
    if (location === '/albums' || location.startsWith('/albums/')) {
      return [
        { key: 'yearFrom', label: 'Year from', type: 'number' },
        { key: 'yearTo', label: 'Year to', type: 'number' },
        { key: 'genre', label: 'Genre', type: 'select', options: uniqueSortedOptions(albums.map((a) => a.genre)) },
        { key: 'favorites', label: 'Favorites only', type: 'boolean' },
      ];
    }

    if (location === '/tracks' || location.startsWith('/tracks/')) {
      return [
        { key: 'artist', label: 'Artist', type: 'select', options: uniqueSortedOptions(songs.map((s) => s.artistName)) },
        { key: 'album', label: 'Album', type: 'select', options: uniqueSortedOptions(songs.map((s) => s.albumName)) },
        { key: 'genre', label: 'Genre', type: 'select', options: uniqueSortedOptions(songs.map((s) => s.genre)) },
        { key: 'favorites', label: 'Favorites only', type: 'boolean' },
        { key: 'rating', label: 'Rating', type: 'select', options: [
          { value: '1', label: '1 star' },
          { value: '2', label: '2 stars' },
          { value: '3', label: '3 stars' },
          { value: '4', label: '4 stars' },
          { value: '5', label: '5 stars' },
        ]},
      ];
    }

    if (location === '/artists' || location.startsWith('/artists/')) {
      return [
        { key: 'genre', label: 'Genre', type: 'select', options: uniqueSortedOptions(songs.map((s) => s.genre)) },
      ];
    }

    if (location === '/playlists' || location.startsWith('/playlists/')) {
      return [
        { key: 'owner', label: 'Owner', type: 'select', options: uniqueSortedOptions(playlists.map((p) => p.ownerUsername)) },
        { key: 'visibility', label: 'Visibility', type: 'select', options: [
          { value: 'private', label: 'Private' },
          { value: 'shared', label: 'Shared' },
          { value: 'public', label: 'Public' },
          { value: 'link', label: 'Link' },
        ]},
      ];
    }

    return [];
  }, [location, albums, songs, playlists]);
}

export function TopBar({ user, onLogout }: TopBarProps) {
  const [location] = useLocation();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filters = useFilterDefinitions(location);

  return (
    <header className="relative z-50 grid h-16 shrink-0 grid-cols-[1fr_2fr_1fr] items-center gap-4 bg-bg-primary/80 px-6 backdrop-blur-md">
      <Link
        href="/"
        className="flex items-center gap-2 text-xl font-bold tracking-tight text-fg-primary hover:text-fg-primary"
      >
        <span className="font-display">Sonarly</span>
      </Link>

      <div className="relative hidden w-full max-w-xl justify-self-center sm:block">
        <SearchBox
          filters={filters}
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((v) => !v)}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <PlayersDropdown />
        <UserMenu user={user} onLogout={onLogout} />
      </div>
    </header>
  );
}

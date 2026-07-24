import { Link, useLocation } from 'wouter';
import type { Playlist, UserPreferences, SidebarItem } from '@sonarly/shared';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { useUpdatePreferences } from '../hooks/usePreferences.js';

interface SidebarProps {
  config: UserPreferences['sidebarConfig'];
  playlists: Playlist[] | undefined;
}

const DEFAULT_SIDEBAR_CONFIG: NonNullable<UserPreferences['sidebarConfig']> = {
  items: [
    { id: 'home', type: 'link', visible: true },
    { id: 'albums', type: 'link', visible: true },
    { id: 'tracks', type: 'link', visible: true },
    { id: 'album-artists', type: 'link', visible: true },
    { id: 'artists', type: 'link', visible: true },
    { id: 'genres', type: 'link', visible: true },
    { id: 'playlists', type: 'playlists', visible: true, collapsed: false },
  ],
};

const LIBRARY_LINKS = [
  { id: 'home', href: '/', label: 'Home', icon: 'mdi-home' },
  { id: 'albums', href: '/albums', label: 'Albums', icon: 'mdi-album' },
  { id: 'tracks', href: '/tracks', label: 'Tracks', icon: 'mdi-music' },
  { id: 'album-artists', href: '/album-artists', label: 'Album Artists', icon: 'mdi-account-music' },
  { id: 'artists', href: '/artists', label: 'Artists', icon: 'mdi-account-group' },
  { id: 'genres', href: '/genres', label: 'Genres', icon: 'mdi-tag' },
];

function isActive(location: string, href: string): boolean {
  if (location === href) return true;
  if (href !== '/' && location.startsWith(href)) return true;
  return false;
}

function findItem(items: SidebarItem[], id: string): SidebarItem | undefined {
  return items.find((item) => item.id === id);
}

function SidebarNavLink({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition',
        active
          ? 'bg-surface-hover text-accent'
          : 'text-fg-primary hover:bg-surface-hover hover:text-accent',
      )}
    >
      <Icon name={icon} size={20} />
      {label}
    </Link>
  );
}

export function Sidebar({ config, playlists }: SidebarProps) {
  const [location] = useLocation();
  const updatePreferences = useUpdatePreferences();
  const effectiveConfig = config ?? DEFAULT_SIDEBAR_CONFIG;
  const items = effectiveConfig.items;

  const playlistsItem = findItem(items, 'playlists') as
    | Extract<SidebarItem, { type: 'playlists' }>
    | undefined;
  const playlistsVisible = playlistsItem?.visible ?? true;
  const collapsed = playlistsItem?.collapsed ?? false;

  const orderedLibraryLinks = items
    .filter((item): item is SidebarItem & { type: 'link' } => item.type === 'link')
    .map((item) => LIBRARY_LINKS.find((link) => link.id === item.id))
    .filter((link): link is (typeof LIBRARY_LINKS)[number] => link !== undefined && (findItem(items, link.id)?.visible ?? true));

  const toggleCollapsed = () => {
    const next = items.map((item) =>
      item.type === 'playlists' ? { ...item, collapsed: !collapsed } : item,
    );
    updatePreferences.mutate({ sidebarConfig: { items: next } });
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-rule bg-surface">
      <div className="flex-1 overflow-y-auto p-3">
        <nav className="space-y-1">
          {orderedLibraryLinks.map((link) => (
            <SidebarNavLink
              key={link.id}
              href={link.href}
              label={link.label}
              icon={link.icon}
              active={isActive(location, link.href)}
            />
          ))}
        </nav>

        {playlistsVisible && (
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between px-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Playlists</span>
              <div className="flex items-center gap-1">
                <Link
                  href="/playlists"
                  aria-label="All playlists"
                  title="All playlists"
                  className={cn(
                    'rounded p-1 transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    isActive(location, '/playlists')
                      ? 'text-accent'
                      : 'text-muted hover:text-fg-primary',
                  )}
                >
                  <Icon name="mdi-playlist-music" size={18} />
                </Link>
                <button
                  type="button"
                  aria-label="Create playlist"
                  title="Create playlist"
                  className="rounded p-1 text-muted transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Icon name="mdi-playlist-plus" size={18} />
                </button>
                <button
                  type="button"
                  aria-label="Collapse playlists"
                  title="Collapse playlists"
                  onClick={toggleCollapsed}
                  className="rounded p-1 text-muted transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Icon
                    name="mdi-chevron-down"
                    size={18}
                    className={cn('transition-transform', collapsed && '-rotate-90')}
                  />
                </button>
              </div>
            </div>

            {!collapsed && (
              <nav className="space-y-1">
                {playlists?.map((playlist) => {
                  const href = `/playlists/${playlist.id}`;
                  const active = isActive(location, href);
                  return (
                    <Link
                      key={playlist.id}
                      href={href}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition',
                        active
                          ? 'bg-surface-hover text-accent'
                          : 'text-fg-primary hover:bg-surface-hover hover:text-accent',
                      )}
                    >
                      <Icon name="mdi-playlist-play" size={20} />
                      <span className="truncate">{playlist.name}</span>
                    </Link>
                  );
                })}
              </nav>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

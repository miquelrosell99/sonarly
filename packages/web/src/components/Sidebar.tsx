import { Link, useLocation } from 'wouter';
import type { Playlist, UserPreferences, SidebarItem } from '@sonarly/shared';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { usePreferences, useUpdatePreferences } from '../hooks/usePreferences.js';
import { useCreatePlaylistModal } from '../hooks/useCreatePlaylistModal.js';
import { mergeSidebarItems } from '../lib/sidebar.js';

interface SidebarProps {
  config: UserPreferences['sidebarConfig'];
  playlists: Playlist[] | undefined;
}

const LIBRARY_LINKS = [
  { id: 'home', href: '/', label: 'Home', icon: 'mdi-home' },
  { id: 'albums', href: '/albums', label: 'Albums', icon: 'mdi-album' },
  { id: 'tracks', href: '/tracks', label: 'Tracks', icon: 'mdi-music' },
  { id: 'album-artists', href: '/album-artists', label: 'Album Artists', icon: 'mdi-account-music' },
  { id: 'artists', href: '/artists', label: 'Artists', icon: 'mdi-account-group' },
  { id: 'genres', href: '/genres', label: 'Genres', icon: 'mdi-tag' },
  { id: 'years', href: '/years', label: 'Years', icon: 'mdi-calendar-clock' },
  { id: 'composers', href: '/composers', label: 'Composers', icon: 'mdi-music-clef-treble' },
  { id: 'labels', href: '/labels', label: 'Labels', icon: 'mdi-tag-multiple' },
  { id: 'album-types', href: '/album-types', label: 'Album Types', icon: 'mdi-format-list-bulleted-type' },
];

function isActive(location: string, href: string): boolean {
  if (location === href) return true;
  if (href !== '/' && location.startsWith(href)) return true;
  return false;
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
        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
        active
          ? 'bg-surface-hover text-accent'
          : 'text-fg-secondary hover:bg-surface-hover hover:text-fg-primary',
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
      )}
      <Icon
        name={icon}
        size={20}
        className={cn(
          'transition',
          active ? 'text-accent' : 'text-fg-secondary group-hover:text-fg-primary',
        )}
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function Sidebar({ config, playlists }: SidebarProps) {
  const [location] = useLocation();
  const { data: preferences } = usePreferences();
  const updatePreferences = useUpdatePreferences();
  const { open: openCreatePlaylist } = useCreatePlaylistModal();
  const items = mergeSidebarItems(config);
  const collapsed = preferences?.playlistsCollapsed ?? false;

  const orderedLibraryLinks = items
    .filter((item): item is SidebarItem & { type: 'link' } => item.type === 'link')
    .map((item) => LIBRARY_LINKS.find((link) => link.id === item.id))
    .filter((link): link is (typeof LIBRARY_LINKS)[number] => link !== undefined);

  const toggleCollapsed = () => {
    updatePreferences.mutate({ playlistsCollapsed: !collapsed });
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-surface">
      <div className="flex flex-1 flex-col overflow-hidden p-3">
        <nav className="space-y-0.5 overflow-y-auto">
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

        <div className="mt-6 flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex shrink-0 items-center justify-between px-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Collapse playlists"
                title="Collapse playlists"
                onClick={toggleCollapsed}
                className="rounded-md p-1 text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Icon
                  name="mdi-chevron-down"
                  size={16}
                  className={cn('transition-transform', collapsed && '-rotate-90')}
                />
              </button>
              <span className="text-xs font-semibold uppercase tracking-wider text-fg-secondary">
                Playlists
              </span>
              {playlists && playlists.length > 0 && (
                <span className="ml-1 rounded-full bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-fg-secondary">
                  {playlists.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              <Link
                href="/playlists"
                aria-label="All playlists"
                title="All playlists"
                className={cn(
                  'rounded-md p-1.5 transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  isActive(location, '/playlists')
                    ? 'text-accent'
                    : 'text-fg-secondary hover:text-fg-primary',
                )}
              >
                <Icon name="mdi-playlist-music" size={18} />
              </Link>
              <button
                type="button"
                aria-label="Create playlist"
                title="Create playlist"
                onClick={openCreatePlaylist}
                className="rounded-md p-1.5 text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Icon name="mdi-playlist-plus" size={18} />
              </button>
            </div>
          </div>

          {!collapsed && (
            <nav className="space-y-0.5 min-h-0 flex-1 overflow-y-auto">
              {playlists?.map((playlist) => {
                const href = `/playlists/${playlist.id}`;
                const active = isActive(location, href);
                return (
                  <Link
                    key={playlist.id}
                    href={href}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                      active
                        ? 'bg-surface-hover text-accent'
                        : 'text-fg-secondary hover:bg-surface-hover hover:text-fg-primary',
                    )}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                    )}
                    <Icon
                      name="mdi-playlist-play"
                      size={20}
                      className={cn(
                        'transition',
                        active ? 'text-accent' : 'text-fg-secondary group-hover:text-fg-primary',
                      )}
                    />
                    <span className="truncate">{playlist.name}</span>
                  </Link>
                );
              })}
            </nav>
          )}
        </div>
      </div>
    </aside>
  );
}

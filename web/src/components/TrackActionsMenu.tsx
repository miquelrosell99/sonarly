import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { Icon } from './ui/Icon.js';
import { api } from '../lib/api.js';
import { usePlayer, type PlayerSong } from '../stores/playerStore.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { usePopoverMenu } from './ui/usePopoverMenu.js';

interface TrackActionsMenuProps {
  song: PlayerSong | null;
}

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  onSelect: () => void;
}

// "More actions" popover for the currently playing track in the player bar.
// Anchored above the trigger, right-aligned (the player bar sits at the
// bottom of the screen), portaled with viewport clamping via usePopoverMenu.
export function TrackActionsMenu({ song }: TrackActionsMenuProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { notify } = useNotification();
  const menu = usePopoverMenu<HTMLButtonElement>();

  const saveQueueAsPlaylist = async () => {
    const { queue } = usePlayer.getState();
    if (queue.length === 0) return;
    const name = `Queue — ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    try {
      await api('/playlists', {
        method: 'POST',
        body: JSON.stringify({ name, songIds: queue.map((track) => track.id) }),
      });
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      notify(`Saved queue as "${name}"`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save queue', 'error');
    }
  };

  const navigationItems: MenuItem[] = !song
    ? []
    : [
        ...(song.albumId
          ? [{ id: 'album', label: 'Go to album', icon: 'mdi-album', onSelect: () => setLocation(`/albums/${song.albumId}`) }]
          : []),
        ...(song.artistEntries && song.artistEntries.length > 0
          ? song.artistEntries.map((artist) => ({
              id: `artist-${artist.id}`,
              label: `Go to ${artist.name}`,
              icon: 'mdi-account-music',
              onSelect: () => setLocation(`/artists/${artist.id}`),
            }))
          : song.artistId
            ? [{ id: 'artist', label: 'Go to artist', icon: 'mdi-account-music', onSelect: () => setLocation(`/artists/${song.artistId}`) }]
            : []),
      ];

  const items: MenuItem[] = [
    ...navigationItems,
    { id: 'save-queue', label: 'Save queue as playlist', icon: 'mdi-playlist-plus', onSelect: () => { void saveQueueAsPlaylist(); } },
  ];

  const menuEl = menu.open && items.length > 0 ? (
    <div
      ref={menu.menuRef}
      {...menu.menuProps}
      aria-label="Track actions"
      className="fixed z-50 min-w-[12rem] rounded-md border border-rule bg-surface py-1 shadow-lg"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          onClick={() => {
            item.onSelect();
            menu.closeMenu(true);
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-primary transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
        >
          <Icon name={item.icon} size={16} className="text-fg-secondary" />
          {item.label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={menu.triggerRef}
        type="button"
        {...menu.triggerProps}
        aria-label="More actions"
        title="More actions"
        disabled={!song}
        className="-m-1 inline-flex h-11 w-11 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="mdi-dots-horizontal" size={18} />
      </button>
      {menuEl && createPortal(menuEl, document.body)}
    </>
  );
}

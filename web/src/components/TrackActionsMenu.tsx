import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { Icon } from './ui/Icon.js';
import { api } from '../lib/api.js';
import { cn } from '../lib/cn.js';
import { usePlayer, type PlayerSong } from '../stores/playerStore.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { usePopoverMenu } from './ui/usePopoverMenu.js';
import { formatDateShortMonth } from '../lib/formatDate.js';

interface TrackActionsMenuProps {
  song: PlayerSong | null;
}

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  active?: boolean;
  onSelect: () => void;
}

const SLEEP_MINUTE_OPTIONS = [5, 10, 15, 30, 45, 60];

// "More actions" popover for the currently playing track in the player bar:
// track navigation and save-queue live here, and the sleep timer sits one
// level deeper — the bar is too scarce on icon slots for a dedicated timer
// button. While a timer runs, the trigger swaps to a timer icon so the state
// stays visible without spending an extra slot.
export function TrackActionsMenu({ song }: TrackActionsMenuProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { notify } = useNotification();
  const menu = usePopoverMenu<HTMLButtonElement>();
  const sleepTimer = usePlayer((state) => state.sleepTimer);
  const setSleepTimer = usePlayer((state) => state.setSleepTimer);
  const clearSleepTimer = usePlayer((state) => state.clearSleepTimer);
  const [view, setView] = useState<'main' | 'timer'>('main');

  // An outside-click close leaves the stale view behind; always reopen on main.
  useEffect(() => {
    if (!menu.open) setView('main');
  }, [menu.open]);

  const timerActive = sleepTimer.mode !== 'off';

  const saveQueueAsPlaylist = async () => {
    const { queue } = usePlayer.getState();
    if (queue.length === 0) return;
    const name = `Queue — ${formatDateShortMonth(new Date())}`;
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

  const mainItems: MenuItem[] = [
    ...navigationItems,
    { id: 'save-queue', label: 'Save queue as playlist', icon: 'mdi-playlist-plus', onSelect: () => { void saveQueueAsPlaylist(); } },
    { id: 'sleep-timer', label: 'Sleep timer…', icon: 'mdi-timer-outline', onSelect: () => setView('timer') },
  ];

  const timerItems: MenuItem[] = [
    { id: 'off', label: 'Off', icon: 'mdi-close', active: sleepTimer.mode === 'off', onSelect: clearSleepTimer },
    ...SLEEP_MINUTE_OPTIONS.map((minutes): MenuItem => ({
      id: `${minutes}`,
      label: `${minutes} minutes`,
      icon: 'mdi-timer-outline',
      onSelect: () => setSleepTimer(minutes),
    })),
    {
      id: 'endOfTrack',
      label: 'End of track',
      icon: 'mdi-timer-sand',
      active: sleepTimer.mode === 'endOfTrack',
      onSelect: () => setSleepTimer('endOfTrack'),
    },
  ];

  const items = view === 'main' ? mainItems : timerItems;

  const menuEl = menu.open && items.length > 0 ? (
    <div
      ref={menu.menuRef}
      {...menu.menuProps}
      aria-label={view === 'main' ? 'Track actions' : 'Sleep timer'}
      className="fixed z-50 min-w-[12rem] rounded-popover border border-rule bg-surface py-1 shadow-lg"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          onClick={() => {
            if (item.id === 'sleep-timer') {
              setView('timer');
              return;
            }
            item.onSelect();
            setView('main');
            menu.closeMenu(true);
          }}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-primary transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none',
            item.active && 'text-accent',
          )}
        >
          <Icon name={item.icon} size={16} className={cn('text-fg-secondary', item.active && 'text-accent')} />
          {item.label}
          {item.active && <Icon name="mdi-check" size={16} className="ml-auto text-accent" />}
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
        aria-label={timerActive ? 'More actions (sleep timer active)' : 'More actions'}
        title={timerActive ? 'More actions (sleep timer active)' : 'More actions'}
        disabled={!song}
        className={cn(
          '-m-1 inline-flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary disabled:cursor-not-allowed disabled:opacity-40',
          timerActive ? 'text-accent' : 'text-fg-secondary',
        )}
      >
        <Icon name={timerActive ? 'mdi-timer-outline' : 'mdi-dots-horizontal'} size={18} />
      </button>
      {menuEl && createPortal(menuEl, document.body)}
    </>
  );
}

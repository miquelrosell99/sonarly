import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/ui/Icon.js';
import { api } from '../../lib/api.js';
import { cn } from '../../lib/cn.js';
import { usePlayer, type PlayerSong } from '../../stores/playerStore.js';
import { useNotification } from '../../contexts/NotificationContext.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import { formatDateShortMonth } from '../../lib/formatDate.js';

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
// track navigation and save-queue live here, and the sleep timer is a
// catalog submenu (the bar is too scarce on icon slots for a dedicated
// timer button). While a timer runs, the trigger swaps to a timer icon so
// the state stays visible without spending an extra slot. Composed on the
// normalized catalog dropdown-menu (migration 2026-10-19, retiring
// usePopoverMenu).
export function TrackActionsMenu({ song }: TrackActionsMenuProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { notify } = useNotification();
  const sleepTimer = usePlayer((state) => state.sleepTimer);
  const setSleepTimer = usePlayer((state) => state.setSleepTimer);
  const clearSleepTimer = usePlayer((state) => state.clearSleepTimer);

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={timerActive ? 'More actions (sleep timer active)' : 'More actions'}
          title={timerActive ? 'More actions (sleep timer active)' : 'More actions'}
          disabled={!song}
          className={cn(
            '-m-1 inline-flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40',
            timerActive ? 'text-primary' : 'text-on-surface-variant',
          )}
        >
          <Icon name={timerActive ? 'mdi-timer-outline' : 'mdi-dots-horizontal'} size={18} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" aria-label="Track actions">
        {mainItems.map((item) => (
          <DropdownMenuItem key={item.id} onSelect={item.onSelect}>
            <Icon name={item.icon} size={18} className="text-on-surface-variant" />
            {item.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Icon name="mdi-timer-outline" size={18} className="text-on-surface-variant" />
            Sleep timer
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent aria-label="Sleep timer">
            {timerItems.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onSelect={item.onSelect}
                className={cn(item.active && 'text-primary')}
              >
                <Icon name={item.icon} size={18} className={cn('text-on-surface-variant', item.active && 'text-primary')} />
                {item.label}
                {item.active && <Icon name="mdi-check" size={16} className="ml-auto text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

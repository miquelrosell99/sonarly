import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from './ui/Icon.js';
import { api } from '../lib/api.js';
import { usePlayer, type PlayerSong } from '../stores/playerStore.js';
import { useNotification } from '../contexts/NotificationContext.js';

interface TrackActionsMenuProps {
  song: PlayerSong | null;
}

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  onSelect: () => void;
}

const Trigger = forwardRef<
  HTMLButtonElement,
  { open: boolean; disabled: boolean; onToggle: () => void }
>(function Trigger({ open, disabled, onToggle }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-label="More actions"
      aria-haspopup="menu"
      aria-expanded={open}
      title="More actions"
      disabled={disabled}
      className="-m-1 inline-flex h-11 w-11 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon name="mdi-dots-horizontal" size={18} />
    </button>
  );
});

// "More actions" popover for the currently playing track in the player bar.
// Modeled on SleepTimerButton: click-to-open portal menu anchored above the
// trigger, with Escape/click-outside close and arrow-key navigation.
export function TrackActionsMenu({ song }: TrackActionsMenuProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { notify } = useNotification();

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleMouse);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleMouse);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = buttonRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
      Math.max(triggerRect.right - menuRect.width, margin),
      window.innerWidth - menuRect.width - margin,
    );
    const top = Math.max(triggerRect.top - menuRect.height - margin, margin);
    setPos({ x: left, y: top });
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const direction = e.key === 'ArrowDown' ? 1 : -1;
    items[(index + direction + items.length) % items.length].focus();
  };

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

  const menu = open && items.length > 0 ? (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Track actions"
      style={{ top: pos.y, left: pos.x }}
      onKeyDown={handleMenuKeyDown}
      className="fixed z-50 min-w-[12rem] rounded-md border border-rule bg-surface py-1 shadow-lg"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          onClick={() => {
            item.onSelect();
            setOpen(false);
            buttonRef.current?.focus();
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
      <Trigger ref={buttonRef} open={open} disabled={!song} onToggle={() => setOpen((value) => !value)} />
      {menu && createPortal(menu, document.body)}
    </>
  );
}

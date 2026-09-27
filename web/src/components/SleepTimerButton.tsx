import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui/Icon.js';
import { cn } from '../lib/cn.js';
import { usePlayer } from '../stores/playerStore.js';
import { usePopoverMenu } from './ui/usePopoverMenu.js';

const MINUTE_OPTIONS = [5, 10, 15, 30, 45, 60];

function formatRemaining(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

interface SleepTimerItem {
  id: string;
  label: string;
  active: boolean;
  onSelect: () => void;
}

export function SleepTimerButton() {
  const sleepTimer = usePlayer((state) => state.sleepTimer);
  const setSleepTimer = usePlayer((state) => state.setSleepTimer);
  const clearSleepTimer = usePlayer((state) => state.clearSleepTimer);
  const menu = usePopoverMenu<HTMLButtonElement>();

  const [now, setNow] = useState(() => Date.now());

  const active = sleepTimer.mode !== 'off';

  // Tick once a second while a minute-based timer runs so the countdown in
  // the bar stays current.
  useEffect(() => {
    if (sleepTimer.mode !== 'minutes') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [sleepTimer.mode]);

  const remainingSeconds = sleepTimer.mode === 'minutes'
    ? Math.max(0, Math.ceil((sleepTimer.endsAt - now) / 1000))
    : null;

  const label = sleepTimer.mode === 'minutes'
    ? `Sleep timer: ${formatRemaining(remainingSeconds ?? 0)} remaining`
    : sleepTimer.mode === 'endOfTrack'
      ? 'Sleep timer: end of track'
      : 'Sleep timer';

  const select = (item: SleepTimerItem) => {
    item.onSelect();
    menu.closeMenu(true);
  };

  const items: SleepTimerItem[] = [
    { id: 'off', label: 'Off', active: sleepTimer.mode === 'off', onSelect: clearSleepTimer },
    ...MINUTE_OPTIONS.map((minutes): SleepTimerItem => ({
      id: `${minutes}`,
      label: `${minutes} minutes`,
      active: false,
      onSelect: () => setSleepTimer(minutes),
    })),
    {
      id: 'endOfTrack',
      label: 'End of track',
      active: sleepTimer.mode === 'endOfTrack',
      onSelect: () => setSleepTimer('endOfTrack'),
    },
  ];

  const menuEl = menu.open ? (
    <div
      ref={menu.menuRef}
      {...menu.menuProps}
      aria-label="Sleep timer"
      className="fixed z-50 min-w-[10rem] rounded-md border border-rule bg-surface py-1 shadow-lg"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          onClick={() => select(item)}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none',
            item.active && 'text-accent',
          )}
        >
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
        aria-label={label}
        title={label}
        className={cn(
          '-m-1 inline-flex h-11 min-w-[2.75rem] items-center justify-center gap-1 rounded-full px-1 transition',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary',
          active
            ? 'bg-accent/15 text-accent hover:bg-accent/25'
            : 'text-fg-secondary hover:bg-surface-hover hover:text-fg-primary',
        )}
      >
        <Icon
          name={sleepTimer.mode === 'endOfTrack' ? 'mdi-timer-sand' : 'mdi-timer-outline'}
          size={18}
        />
        {remainingSeconds !== null && (
          <span className="font-mono text-xs">{formatRemaining(remainingSeconds)}</span>
        )}
      </button>
      {menuEl && createPortal(menuEl, document.body)}
    </>
  );
}

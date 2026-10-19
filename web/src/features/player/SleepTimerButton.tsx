import { useEffect, useState } from 'react';
import { Icon } from '../../components/ui/Icon.js';
import { cn } from '../../lib/cn.js';
import { usePlayer } from '../../stores/playerStore.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            '-m-1 inline-flex h-11 min-w-[2.75rem] items-center justify-center gap-1 rounded-full px-1 transition',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            active
              ? 'bg-primary/15 text-primary hover:bg-primary/25'
              : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
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
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" aria-label="Sleep timer">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onSelect={item.onSelect}
            className={cn(item.active && 'text-primary')}
          >
            {item.label}
            {item.active && <Icon name="mdi-check" size={16} className="ml-auto text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

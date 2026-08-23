import { useEffect } from 'react';
import { useNotification } from '../contexts/NotificationContext.js';
import { usePlayer } from '../stores/playerStore.js';

export const SLEEP_TIMER_ENDED_MESSAGE = 'Sleep timer ended';

/**
 * Watches the player store's sleep timer and pauses playback when a
 * minute-based timer expires. The end-of-track mode is handled in
 * AudioController's `ended` handler, where the track boundary is known.
 */
export function useSleepTimer() {
  const { notify } = useNotification();
  const sleepTimer = usePlayer((state) => state.sleepTimer);
  const endsAt = sleepTimer.mode === 'minutes' ? sleepTimer.endsAt : null;

  useEffect(() => {
    if (endsAt === null) return;

    const fire = () => {
      const state = usePlayer.getState();
      // The timer may have been cleared or re-armed since this was scheduled.
      if (state.sleepTimer.mode !== 'minutes' || state.sleepTimer.endsAt !== endsAt) return;
      if (state.status === 'playing' || state.status === 'loading') {
        state.pause();
      }
      state.clearSleepTimer();
      notify(SLEEP_TIMER_ENDED_MESSAGE, 'info');
    };

    const remainingMs = endsAt - Date.now();
    if (remainingMs <= 0) {
      fire();
      return;
    }
    const timeoutId = window.setTimeout(fire, remainingMs);
    return () => window.clearTimeout(timeoutId);
  }, [endsAt, notify]);
}

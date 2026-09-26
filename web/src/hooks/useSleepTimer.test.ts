import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { usePlayer, resetPlayer, getNextSong, type PlayerSong } from '../stores/playerStore.js';
import { useSleepTimer, SLEEP_TIMER_ENDED_MESSAGE } from './useSleepTimer.js';

const mockNotify = vi.hoisted(() => vi.fn());

vi.mock('../contexts/NotificationContext.js', () => ({
  useNotification: () => ({ notify: mockNotify }),
}));

function createSong(id: string): PlayerSong {
  return { id, title: `Song ${id}`, duration: 100 } as PlayerSong;
}

beforeEach(() => {
  resetPlayer();
  mockNotify.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('sleep timer store actions', () => {
  it('setSleepTimer(minutes) arms a minute-based timer relative to now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    usePlayer.getState().setSleepTimer(15);

    expect(usePlayer.getState().sleepTimer).toEqual({
      mode: 'minutes',
      endsAt: 1_000_000 + 15 * 60_000,
    });
  });

  it("setSleepTimer('endOfTrack') arms the end-of-track mode", () => {
    usePlayer.getState().setSleepTimer('endOfTrack');
    expect(usePlayer.getState().sleepTimer).toEqual({ mode: 'endOfTrack' });
  });

  it('re-arming replaces the previous timer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    usePlayer.getState().setSleepTimer(5);
    usePlayer.getState().setSleepTimer('endOfTrack');
    expect(usePlayer.getState().sleepTimer).toEqual({ mode: 'endOfTrack' });
  });

  it('clearSleepTimer resets to off', () => {
    usePlayer.getState().setSleepTimer('endOfTrack');
    usePlayer.getState().clearSleepTimer();
    expect(usePlayer.getState().sleepTimer).toEqual({ mode: 'off' });
  });

  it('is not persisted to storage (a stale endsAt must not survive reloads)', () => {
    usePlayer.getState().setSleepTimer(30);

    const raw = window.localStorage.getItem('sonarly-player');
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw!);
    expect(persisted.state).not.toHaveProperty('sleepTimer');
  });
});

describe('getNextSong (preloader next-track peek)', () => {
  it('returns the following queue item in linear order', () => {
    const songs = [createSong('1'), createSong('2'), createSong('3')];
    usePlayer.getState().playQueue(songs, 0);
    expect(getNextSong(usePlayer.getState())?.id).toBe('2');
  });

  it('returns null at the end of the queue with repeat off', () => {
    const songs = [createSong('1'), createSong('2')];
    usePlayer.getState().playQueue(songs, 1);
    expect(getNextSong(usePlayer.getState())).toBeNull();
  });

  it('wraps to the first song with repeat all', () => {
    const songs = [createSong('1'), createSong('2')];
    const store = usePlayer.getState();
    store.playQueue(songs, 1);
    store.cycleRepeat(); // off -> all
    expect(getNextSong(usePlayer.getState())?.id).toBe('1');
  });

  it('returns null with repeat one (replaying needs no preload)', () => {
    const songs = [createSong('1'), createSong('2')];
    const store = usePlayer.getState();
    store.playQueue(songs, 0);
    store.cycleRepeat();
    store.cycleRepeat(); // all -> one
    expect(getNextSong(usePlayer.getState())).toBeNull();
  });

  it('follows the shuffled order when shuffle is enabled', () => {
    const songs = [createSong('1'), createSong('2'), createSong('3'), createSong('4')];
    usePlayer.getState().playQueue(songs, 0, true);
    const state = usePlayer.getState();
    const expected = state.queue[state.shuffledIndices[1]];
    expect(getNextSong(state)?.id).toBe(expected.id);
  });

  it('returns null for an empty queue', () => {
    expect(getNextSong(usePlayer.getState())).toBeNull();
  });
});

describe('useSleepTimer', () => {
  it('pauses, clears, and notifies when a minutes timer expires', () => {
    vi.useFakeTimers();
    usePlayer.getState().playQueue([createSong('1')], 0);

    renderHook(() => useSleepTimer());
    act(() => {
      usePlayer.getState().setSleepTimer(5);
    });

    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });

    const state = usePlayer.getState();
    expect(state.status).toBe('paused');
    expect(state.sleepTimer).toEqual({ mode: 'off' });
    expect(mockNotify).toHaveBeenCalledWith(SLEEP_TIMER_ENDED_MESSAGE, 'info');
  });

  it('does not fire after the timer is cleared', () => {
    vi.useFakeTimers();
    usePlayer.getState().playQueue([createSong('1')], 0);

    renderHook(() => useSleepTimer());
    act(() => {
      usePlayer.getState().setSleepTimer(5);
    });
    act(() => {
      usePlayer.getState().clearSleepTimer();
    });

    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });

    expect(usePlayer.getState().status).toBe('playing');
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('re-arming cancels the previous countdown', () => {
    vi.useFakeTimers();
    usePlayer.getState().playQueue([createSong('1')], 0);

    renderHook(() => useSleepTimer());
    act(() => {
      usePlayer.getState().setSleepTimer(1);
    });
    act(() => {
      usePlayer.getState().setSleepTimer(2);
    });

    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(usePlayer.getState().status).toBe('playing');
    expect(mockNotify).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(usePlayer.getState().status).toBe('paused');
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it('does not pause when playback is already idle', () => {
    vi.useFakeTimers();
    // No track playing: status stays idle.
    renderHook(() => useSleepTimer());
    act(() => {
      usePlayer.getState().setSleepTimer(0.01);
    });

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(usePlayer.getState().status).toBe('idle');
    expect(usePlayer.getState().sleepTimer).toEqual({ mode: 'off' });
    expect(mockNotify).toHaveBeenCalledWith(SLEEP_TIMER_ENDED_MESSAGE, 'info');
  });
});

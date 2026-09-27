import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { useState, useEffect } from 'react';
import { useAutoDj } from './useAutoDj.js';
import { useAutoDjUi } from '../stores/autoDjStore.js';
import type { PlayerSong } from '../stores/playerStore.js';
import type { UserPreferences, AutoDjMode } from '../types';

const mockApi = vi.hoisted(() =>
  vi.fn(((_path: string, _options?: { method?: string; body?: string }) =>
    Promise.resolve({ songs: [] as PlayerSong[] }))),
);
const mockAddToQueue = vi.hoisted(() =>
  vi.fn((songs: PlayerSong[], options?: { addedByAutoDj?: boolean }) => {
    const marked = options?.addedByAutoDj
      ? songs.map((song) => ({ ...song, addedByAutoDj: true as const }))
      : songs;
    mockUsePlayerData.current.queue = [...mockUsePlayerData.current.queue, ...marked];
  }),
);
const mockRemoveAutoDjItems = vi.hoisted(() => vi.fn(() => {
  const { queue, queueIndex } = mockUsePlayerData.current;
  mockUsePlayerData.current.queue = queue.filter(
    (song, index) => !(index > queueIndex && song.addedByAutoDj),
  );
}));
const mockNext = vi.hoisted(() => vi.fn(() => {
  const { queue, queueIndex } = mockUsePlayerData.current;
  const nextIndex = queueIndex + 1;
  if (nextIndex < queue.length) {
    mockUsePlayerData.current.queueIndex = nextIndex;
    mockUsePlayerData.current.currentSong = queue[nextIndex] ?? null;
    mockUsePlayerData.current.status = 'playing';
  }
}));
const mockNotify = vi.hoisted(() => vi.fn());
const mockUsePreferencesData = vi.hoisted(() => ({ current: { preferences: null as UserPreferences | null } }));
const mockUsePlayerData = vi.hoisted(() => ({
  current: {
    currentSong: null as PlayerSong | null,
    queue: [] as PlayerSong[],
    queueIndex: 0,
    status: 'playing' as string,
  },
}));
const usePlayerMock = vi.hoisted(() => {
  const fn = (selector: (state: unknown) => unknown) =>
    selector({
      currentSong: mockUsePlayerData.current.currentSong,
      queue: mockUsePlayerData.current.queue,
      queueIndex: mockUsePlayerData.current.queueIndex,
      status: mockUsePlayerData.current.status,
      addToQueue: mockAddToQueue,
      removeAutoDjItems: mockRemoveAutoDjItems,
      next: mockNext,
    });
  fn.getState = () => ({
    currentSong: mockUsePlayerData.current.currentSong,
    queue: mockUsePlayerData.current.queue,
    queueIndex: mockUsePlayerData.current.queueIndex,
    status: mockUsePlayerData.current.status,
    addToQueue: mockAddToQueue,
    removeAutoDjItems: mockRemoveAutoDjItems,
    next: mockNext,
  });
  return fn;
});

vi.mock('./usePreferences.js', () => ({
  usePreferences: () => ({ data: mockUsePreferencesData.current.preferences }),
}));

vi.mock('../stores/playerStore.js', () => ({
  usePlayer: usePlayerMock,
}));

vi.mock('../lib/api.js', () => ({
  api: mockApi,
}));

vi.mock('../contexts/NotificationContext.js', () => ({
  useNotification: () => ({ notify: mockNotify }),
}));

function TestComponent() {
  useAutoDj();
  return null;
}

// No vitest globals/setup file in this project, so testing-library's
// auto-cleanup never runs — unmount explicitly or components from earlier
// tests stay subscribed to the shared Auto-DJ UI store and re-run their
// effects on every refresh bump.
afterEach(() => {
  cleanup();
});

function ControlledTestComponent({
  preferences,
  currentSong,
  queue,
  queueIndex,
}: {
  preferences: UserPreferences | null;
  currentSong: PlayerSong | null;
  queue: PlayerSong[];
  queueIndex: number;
}) {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    mockUsePreferencesData.current.preferences = preferences;
    mockUsePlayerData.current.currentSong = currentSong;
    mockUsePlayerData.current.queue = queue;
    mockUsePlayerData.current.queueIndex = queueIndex;
    forceUpdate({});
  }, [preferences, currentSong, queue, queueIndex]);

  return <TestComponent />;
}

function song(id: string): PlayerSong {
  return {
    id,
    title: `Song ${id}`,
    mtime: Date.now(),
    active: true,
    explicit: false,
    starred: false,
    coverArtMissing: false,
    gapless: false,
  };
}

function autoDjSong(id: string): PlayerSong {
  return { ...song(id), addedByAutoDj: true };
}

function preferences(partial: Partial<UserPreferences> = {}): UserPreferences {
  return {
    autoDjEnabled: true,
    autoDjMode: 'smart',
    autoDjTopUpThreshold: 5,
    autoDjBatchSize: 10,
    ...partial,
  };
}

describe('useAutoDj', () => {
  beforeEach(() => {
    mockApi.mockResolvedValue({ songs: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockUsePreferencesData.current.preferences = null;
    mockUsePlayerData.current.currentSong = null;
    mockUsePlayerData.current.queue = [];
    mockUsePlayerData.current.queueIndex = 0;
    mockUsePlayerData.current.status = 'playing';
  });

  it('does not fetch when Auto DJ is disabled', async () => {
    render(
      <ControlledTestComponent
        preferences={preferences({ autoDjEnabled: false })}
        currentSong={song('current')}
        queue={[song('q1')]}
        queueIndex={0}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('does not fetch when remaining tracks are above the threshold', async () => {
    render(
      <ControlledTestComponent
        preferences={preferences({ autoDjTopUpThreshold: 3 })}
        currentSong={song('current')}
        queue={[song('q1'), song('q2'), song('q3'), song('q4'), song('q5')]}
        queueIndex={0}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('fetches when remaining tracks are at the threshold', async () => {
    render(
      <ControlledTestComponent
        preferences={preferences({ autoDjTopUpThreshold: 3 })}
        currentSong={song('current')}
        queue={[song('q1'), song('q2'), song('q3')]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
    expect(mockApi).toHaveBeenLastCalledWith(
      '/playback/auto-dj',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('fetches when remaining tracks are below the threshold', async () => {
    render(
      <ControlledTestComponent
        preferences={preferences({ autoDjTopUpThreshold: 3 })}
        currentSong={song('current')}
        queue={[song('q1')]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
  });

  it('uses the correct mode and batch size from preferences', async () => {
    render(
      <ControlledTestComponent
        preferences={preferences({ autoDjMode: 'random' as AutoDjMode, autoDjBatchSize: 7 })}
        currentSong={song('current')}
        queue={[song('q1')]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
    const [, options] = mockApi.mock.calls[0];
    const body = JSON.parse((options as { body: string }).body);
    expect(body.mode).toBe('random');
    expect(body.count).toBe(7);
  });

  it('adds returned songs to the queue via addToQueue', async () => {
    const fetched = [song('new1'), song('new2')];
    mockApi.mockResolvedValueOnce({ songs: fetched });

    render(
      <ControlledTestComponent
        preferences={preferences()}
        currentSong={song('current')}
        queue={[song('q1')]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockAddToQueue).toHaveBeenCalledWith(fetched, { addedByAutoDj: true }));
  });

  it('does not duplicate-add songs already in the queue', async () => {
    const existing = song('existing');
    const fetched = [existing, song('new1')];
    mockApi.mockResolvedValueOnce({ songs: fetched });

    render(
      <ControlledTestComponent
        preferences={preferences()}
        currentSong={song('current')}
        queue={[existing]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
    const [, options] = mockApi.mock.calls[0];
    const body = JSON.parse((options as { body: string }).body);
    expect(body.excludeIds).toContain('current');
    expect(body.excludeIds).toContain('existing');
  });

  it('marks fetched songs as added by Auto DJ', async () => {
    const fetched = [song('new1')];
    mockApi.mockResolvedValueOnce({ songs: fetched });

    render(
      <ControlledTestComponent
        preferences={preferences()}
        currentSong={song('current')}
        queue={[song('q1')]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockAddToQueue).toHaveBeenCalled());
    const [, options] = mockAddToQueue.mock.calls[0];
    expect(options).toEqual({ addedByAutoDj: true });
  });

  it('shows a notification stating how many songs were added', async () => {
    const fetched = [song('new1'), song('new2')];
    mockApi.mockResolvedValueOnce({ songs: fetched });

    render(
      <ControlledTestComponent
        preferences={preferences()}
        currentSong={song('current')}
        queue={[song('q1')]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockNotify).toHaveBeenCalledWith('2 songs added to the queue', 'info'));
  });

  it('notifies when the top-up request fails (F28 Q7: no silent failures)', async () => {
    mockApi.mockRejectedValueOnce(new Error('Auto DJ service down'));

    render(
      <ControlledTestComponent
        preferences={preferences()}
        currentSong={song('current')}
        queue={[song('q1')]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockNotify).toHaveBeenCalledWith('Auto DJ service down', 'error'));
    expect(mockAddToQueue).not.toHaveBeenCalled();
  });

  it('removes pending Auto DJ items when Auto DJ is disabled', async () => {
    const { rerender } = render(
      <ControlledTestComponent
        preferences={preferences()}
        currentSong={song('current')}
        queue={[song('current'), autoDjSong('auto1'), autoDjSong('auto2')]}
        queueIndex={0}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    rerender(
      <ControlledTestComponent
        preferences={preferences({ autoDjEnabled: false })}
        currentSong={song('current')}
        queue={[song('current'), autoDjSong('auto1'), autoDjSong('auto2')]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockRemoveAutoDjItems).toHaveBeenCalled());
  });

  it('removes unplayed Auto DJ items and refills when the DJ mode changes', async () => {
    // A realistic batch fills the queue past the threshold in one fetch.
    mockApi.mockResolvedValue({ songs: Array.from({ length: 10 }, (_, i) => song(`refill${i}`)) });

    const { rerender } = render(
      <ControlledTestComponent
        preferences={preferences({ autoDjMode: 'smart' })}
        currentSong={song('current')}
        queue={[song('current'), autoDjSong('auto1'), autoDjSong('auto2'), song('user1')]}
        queueIndex={0}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    const fetchCountBeforeModeChange = mockApi.mock.calls.length;

    rerender(
      <ControlledTestComponent
        preferences={preferences({ autoDjMode: 'random' as AutoDjMode })}
        currentSong={song('current')}
        queue={[song('current'), autoDjSong('auto1'), autoDjSong('auto2'), song('user1')]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockRemoveAutoDjItems).toHaveBeenCalled());
    await waitFor(() => expect(mockApi.mock.calls.length).toBeGreaterThan(fetchCountBeforeModeChange));
    expect(
      mockApi.mock.calls.some(
        ([, opts]) => JSON.parse((opts as { body: string }).body).mode === 'random',
      ),
    ).toBe(true);
  });

  it('removes unplayed Auto DJ items and refills when the DJ config changes', async () => {
    // A realistic batch fills the queue past the threshold in one fetch.
    mockApi.mockResolvedValue({ songs: Array.from({ length: 10 }, (_, i) => song(`refill${i}`)) });

    const { rerender } = render(
      <ControlledTestComponent
        preferences={preferences({ autoDjExcludeWindow: '24h' })}
        currentSong={song('current')}
        queue={[song('current'), autoDjSong('auto1'), autoDjSong('auto2'), song('user1')]}
        queueIndex={0}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    const fetchCountBeforeConfigChange = mockApi.mock.calls.length;

    rerender(
      <ControlledTestComponent
        preferences={preferences({ autoDjExcludeWindow: '30d' })}
        currentSong={song('current')}
        queue={[song('current'), autoDjSong('auto1'), autoDjSong('auto2'), song('user1')]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockRemoveAutoDjItems).toHaveBeenCalled());
    await waitFor(() => expect(mockApi.mock.calls.length).toBeGreaterThan(fetchCountBeforeConfigChange));
  });
});

describe('useAutoDj queue contract', () => {
  beforeEach(() => {
    mockApi.mockResolvedValue({ songs: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockUsePreferencesData.current.preferences = null;
    mockUsePlayerData.current.currentSong = null;
    mockUsePlayerData.current.queue = [];
    mockUsePlayerData.current.queueIndex = 0;
    mockUsePlayerData.current.status = 'playing';
  });

  it('posts the full queue ids for the hard duplicate guarantee', async () => {
    render(
      <ControlledTestComponent
        preferences={preferences()}
        currentSong={song('current')}
        queue={[song('current'), song('q1'), song('q2')]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
    const [, options] = mockApi.mock.calls[0];
    const body = JSON.parse((options as { body: string }).body);
    expect(body.queueIds).toEqual(['current', 'q1', 'q2']);
    expect(body.excludeIds).toContain('current');
  });

  it('carries the server reason onto the queued songs', async () => {
    const fetched = [
      { ...song('new1'), reason: 'More like Jazz Artist' },
      { ...song('new2'), reason: 'Hidden gem — you haven\'t played this' },
    ];
    mockApi.mockResolvedValueOnce({ songs: fetched });

    render(
      <ControlledTestComponent
        preferences={preferences()}
        currentSong={song('current')}
        queue={[song('q1')]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockAddToQueue).toHaveBeenCalled());
    const [queued] = mockAddToQueue.mock.calls[0];
    expect(queued[0].autoDjReason).toBe('More like Jazz Artist');
    expect(queued[1].autoDjReason).toBe('Hidden gem — you haven\'t played this');
  });

  it('refresh drops pending DJ picks and fetches a disjoint batch', async () => {
    mockApi.mockResolvedValue({ songs: [song('refill1'), song('refill2')] });

    render(
      <ControlledTestComponent
        preferences={preferences()}
        currentSong={song('current')}
        queue={[song('current'), autoDjSong('auto1'), autoDjSong('auto2')]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
    mockApi.mockClear();

    act(() => {
      useAutoDjUi.getState().requestRefresh();
    });

    // The pending picks are dropped and the replacement batch lands.
    await waitFor(() => expect(mockAddToQueue).toHaveBeenCalled());
    expect(mockRemoveAutoDjItems).toHaveBeenCalled();
    const [, options] = mockApi.mock.calls[0];
    const body = JSON.parse((options as { body: string }).body);
    expect(body.excludeIds).toEqual(expect.arrayContaining(['auto1', 'auto2']));
    expect(body.queueIds).not.toContain('auto1');
  });

  it('refresh is a no-op while Auto DJ is disabled', async () => {
    render(
      <ControlledTestComponent
        preferences={preferences({ autoDjEnabled: false })}
        currentSong={song('current')}
        queue={[song('current'), autoDjSong('auto1')]}
        queueIndex={0}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    act(() => {
      useAutoDjUi.getState().requestRefresh();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockApi).not.toHaveBeenCalled();
    expect(mockRemoveAutoDjItems).not.toHaveBeenCalled();
  });
});

describe('useAutoDj consumption-point refill timing', () => {
  beforeEach(() => {
    mockApi.mockResolvedValue({ songs: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockUsePreferencesData.current.preferences = null;
    mockUsePlayerData.current.currentSong = null;
    mockUsePlayerData.current.queue = [];
    mockUsePlayerData.current.queueIndex = 0;
    mockUsePlayerData.current.status = 'playing';
  });

  const shortTracks = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ ...song(`t${i}`), duration: 4 }));

  it('prefetches when the queue drains inside the gapless window even above the count threshold', async () => {
    // 6 tracks × 4s = 24s of music remain — under the 30s gapless preload
    // window — while the count (6) sits above the threshold (5).
    render(
      <ControlledTestComponent
        preferences={preferences({ autoDjTopUpThreshold: 5 })}
        currentSong={{ ...song('current'), duration: 4 }}
        queue={[{ ...song('current'), duration: 4 }, ...shortTracks(6)]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
  });

  it('does not prefetch on duration when the queue outlasts the gapless window', async () => {
    // 6 tracks × 10s = 60s — the gapless transition is safe; only the count
    // threshold may trigger.
    const longTracks = Array.from({ length: 6 }, (_, i) => ({ ...song(`l${i}`), duration: 10 }));
    render(
      <ControlledTestComponent
        preferences={preferences({ autoDjTopUpThreshold: 5 })}
        currentSong={{ ...song('current'), duration: 10 }}
        queue={[{ ...song('current'), duration: 10 }, ...longTracks]}
        queueIndex={0}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('resumes playback when the queue drained to idle while fetching', async () => {
    const fetched = [song('new1'), song('new2')];
    let resolveFetch: ((value: { songs: PlayerSong[] }) => void) | undefined;
    mockApi.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );

    render(
      <ControlledTestComponent
        preferences={preferences()}
        currentSong={song('current')}
        queue={[song('current')]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
    // The queue drains while the request is in flight.
    act(() => {
      mockUsePlayerData.current.status = 'idle';
      resolveFetch?.({ songs: fetched });
    });

    await waitFor(() => expect(mockNext).toHaveBeenCalled());
    expect(mockUsePlayerData.current.status).toBe('playing');
  });

  it('does not resume when the user paused manually', async () => {
    mockApi.mockResolvedValueOnce({ songs: [song('new1')] });

    render(
      <ControlledTestComponent
        preferences={preferences()}
        currentSong={song('current')}
        queue={[song('current')]}
        queueIndex={0}
      />,
    );

    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
    act(() => {
      mockUsePlayerData.current.status = 'paused';
    });

    await waitFor(() => expect(mockAddToQueue).toHaveBeenCalled());
    expect(mockNext).not.toHaveBeenCalled();
  });
});

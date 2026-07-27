import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useState, useEffect } from 'react';
import { useAutoDj } from './useAutoDj.js';
import type { PlayerSong } from '../stores/playerStore.js';
import type { UserPreferences, AutoDjMode } from '@sonarly/shared';

const mockApi = vi.hoisted(() => vi.fn(((_path: string) => Promise.resolve({ songs: [] as PlayerSong[] }))));
const mockAddToQueue = vi.hoisted(() => vi.fn<(songs: PlayerSong[]) => void>());
const mockUsePreferencesData = vi.hoisted(() => ({ current: { preferences: null as UserPreferences | null } }));
const mockUsePlayerData = vi.hoisted(() => ({
  current: {
    currentSong: null as PlayerSong | null,
    queue: [] as PlayerSong[],
    queueIndex: 0,
  },
}));

vi.mock('./usePreferences.js', () => ({
  usePreferences: () => ({ data: mockUsePreferencesData.current.preferences }),
}));

vi.mock('../stores/playerStore.js', () => ({
  usePlayer: (selector: (state: unknown) => unknown) =>
    selector({
      currentSong: mockUsePlayerData.current.currentSong,
      queue: mockUsePlayerData.current.queue,
      queueIndex: mockUsePlayerData.current.queueIndex,
      addToQueue: mockAddToQueue,
    }),
}));

vi.mock('../api.js', () => ({
  api: mockApi,
}));

function TestComponent() {
  useAutoDj();
  return null;
}

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
    filePath: `/music/${id}.mp3`,
    mtime: Date.now(),
    checksum: id,
    active: true,
  };
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
    expect(mockApi).toHaveBeenLastCalledWith(expect.stringContaining('/playback/auto-dj?'));
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
    const [url] = mockApi.mock.calls[0];
    expect(url).toContain('mode=random');
    expect(url).toContain('count=7');
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

    await waitFor(() => expect(mockAddToQueue).toHaveBeenCalledWith(fetched));
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
    const [url] = mockApi.mock.calls[0];
    const params = new URLSearchParams(url.split('?')[1]);
    const excludeIds = params.get('excludeIds')?.split(',') ?? [];
    expect(excludeIds).toContain('current');
    expect(excludeIds).toContain('existing');
  });
});

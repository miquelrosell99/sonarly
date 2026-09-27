import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import type { User } from '../types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlayerBar } from './PlayerBar.js';
import { usePlayer, resetPlayer } from '../stores/playerStore.js';
import { resetNowPlaying } from '../features/now-playing/index.js';
import { NotificationProvider } from '../contexts/NotificationContext.js';

const trackActionsProbe = vi.hoisted(() => vi.fn());
const mockSetFavorite = vi.hoisted(() => vi.fn());
const mockSetRating = vi.hoisted(() => vi.fn());
const mockUpdateCurrentSong = vi.hoisted(() => vi.fn());
const mockUpdatePreferencesMutate = vi.hoisted(() => vi.fn());
const mockPreferences = vi.hoisted(() => ({
  autoDjEnabled: false,
  autoDjMode: 'smart' as const,
  autoDjTopUpThreshold: 5,
  autoDjBatchSize: 10,
}));

const mockUser = { id: 'u1', username: 'test', isAdmin: false } as User;

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

// Render-count probe: TrackActionsMenu sits in the PlayerBar chrome, outside
// the SeekProgress leaf — it only re-renders if the whole footer reconciles.
vi.mock('./TrackActionsMenu.js', () => ({
  TrackActionsMenu: () => {
    trackActionsProbe();
    return null;
  },
}));

vi.mock('../hooks/useSongInteraction.js', () => ({
  useSongInteraction: (songId: string | undefined, fallback: { starred?: boolean; rating?: number }) => ({
    starred: fallback?.starred ?? false,
    rating: fallback?.rating ?? 0,
    setFavorite: mockSetFavorite,
    setRating: mockSetRating,
  }),
}));

vi.mock('../hooks/usePreferences.js', () => ({
  usePreferences: () => ({ data: mockPreferences }),
  useUpdatePreferences: () => ({ mutate: mockUpdatePreferencesMutate }),
}));

function renderPlayerBar(props?: { user?: User }) {
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationProvider>
        <PlayerBar {...props} />
      </NotificationProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetPlayer();
  resetNowPlaying();
  usePlayer.setState({ updateCurrentSong: mockUpdateCurrentSong } as any);
  trackActionsProbe.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PlayerBar per-tick reconciliation (audit F20)', () => {
  it('reconciles only the progress leaf on timeupdate, keeping the time display identical', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'Now Playing', artistName: 'Artist', duration: 180 } as any,
    ], 0);

    renderPlayerBar({ user: mockUser });
    expect(screen.getByText('0:00')).toBeTruthy();
    const rendersAfterMount = trackActionsProbe.mock.calls.length;
    expect(rendersAfterMount).toBeGreaterThan(0);

    // ~4Hz timeupdate tick: the store's currentTime advances.
    act(() => {
      usePlayer.setState({ currentTime: 12.4 });
    });

    // The progress leaf updated with the same displayed value as before the
    // split (floor of the clamped position)…
    expect(screen.getByText('0:12')).toBeTruthy();
    // …while the rest of the footer never reconciled.
    expect(trackActionsProbe.mock.calls.length).toBe(rendersAfterMount);
  });

  it('clamps the displayed time at the track duration', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'Now Playing', artistName: 'Artist', duration: 65 } as any,
    ], 0);

    renderPlayerBar({ user: mockUser });
    act(() => {
      usePlayer.setState({ currentTime: 90 });
    });
    // Both the position readout and the duration readout clamp to 1:05.
    expect(screen.getAllByText('1:05').length).toBeGreaterThanOrEqual(2);
  });
});

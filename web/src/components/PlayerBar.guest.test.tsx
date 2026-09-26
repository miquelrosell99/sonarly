import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlayerBar } from './PlayerBar.js';
import { usePlayer, resetPlayer } from '../stores/playerStore.js';
import { resetNowPlaying } from '../features/now-playing/index.js';
import { NotificationProvider } from '../contexts/NotificationContext.js';

vi.mock('../hooks/useSongInteraction.js', () => ({
  useSongInteraction: () => ({
    starred: false,
    rating: 0,
    setFavorite: vi.fn(),
    setRating: vi.fn(),
  }),
}));

vi.mock('../hooks/usePreferences.js', () => ({
  usePreferences: () => ({
    data: { autoDjEnabled: false, autoDjMode: 'smart', autoDjTopUpThreshold: 5, autoDjBatchSize: 10 },
  }),
  useUpdatePreferences: () => ({ mutate: vi.fn() }),
}));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderPlayerBar() {
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationProvider>
        <PlayerBar />
      </NotificationProvider>
    </QueryClientProvider>,
  );
}

describe('PlayerBar guest share-link mode', () => {
  beforeEach(() => {
    resetPlayer();
    resetNowPlaying();
    window.history.pushState({}, '', '/playlists/p1?shareToken=tok-123');
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('preserves the shareToken through the now-playing navigation', () => {
    usePlayer.getState().playQueue(
      [{ id: 's1', title: 'Track', artistName: 'Artist' } as any],
      0,
      false,
      { type: 'playlist', id: 'p1' },
    );

    renderPlayerBar();
    fireEvent.click(screen.getByRole('button', { name: /open now playing/i }));

    expect(window.location.pathname).toBe('/now-playing/playlist/p1/s1');
    expect(window.location.search).toContain('shareToken=tok-123');
  });

  it('preserves the shareToken on the lone-track navigation shape', () => {
    usePlayer.getState().playQueue([{ id: 's1', title: 'Track', artistName: 'Artist' } as any], 0);

    renderPlayerBar();
    fireEvent.click(screen.getByRole('button', { name: /open now playing/i }));

    expect(window.location.pathname).toBe('/now-playing/s1');
    expect(window.location.search).toContain('shareToken=tok-123');
  });

  it('requests cover art with the playback share param', () => {
    usePlayer.getState().playQueue(
      [{ id: 's1', title: 'Now Playing', artistName: 'Artist', coverArt: 'song-cover' } as any],
      0,
    );

    renderPlayerBar();
    const src = screen.getByAltText('Cover art for Now Playing').getAttribute('src');
    expect(src).toBe('/api/cover-art/song-cover?share=tok-123');
  });

  it('does not append a query when the URL carries no token', () => {
    window.history.pushState({}, '', '/');
    usePlayer.getState().playQueue(
      [{ id: 's1', title: 'Track', artistName: 'Artist' } as any],
      0,
      false,
      { type: 'playlist', id: 'p1' },
    );

    renderPlayerBar();
    fireEvent.click(screen.getByRole('button', { name: /open now playing/i }));

    expect(window.location.pathname).toBe('/now-playing/playlist/p1/s1');
    expect(window.location.search).toBe('');
  });
});

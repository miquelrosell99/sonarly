import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { LyricsPanel } from './LyricsPanel.js';
import { usePlayer, resetPlayer } from '../../../stores/playerStore.js';
import type { User } from '@sonarly/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockApi = vi.fn();
vi.mock('../../../api.js', () => ({
  api: (...args: any[]) => mockApi(...args),
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const mockUser = { id: 'u1', username: 'test', isAdmin: false } as User;
const adminUser = { id: 'u2', username: 'admin', isAdmin: true } as User;

beforeEach(() => {
  resetPlayer();
  mockApi.mockReset();
  queryClient.clear();
});

afterEach(() => {
  cleanup();
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('LyricsPanel', () => {
  it('shows empty state for non-admin when no lyrics exist', async () => {
    usePlayer.getState().playQueue([{ id: 's1', title: 'Song' } as any], 0);
    mockApi.mockResolvedValue({ lyrics: undefined, syncedLyrics: undefined });

    render(<LyricsPanel user={mockUser} />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('No lyrics for this track.')).toBeTruthy());
    expect(screen.queryByText('Add lyrics')).toBeNull();
  });

  it('shows add lyrics link for admin when no lyrics exist', async () => {
    usePlayer.getState().playQueue([{ id: 's1', title: 'Song' } as any], 0);
    mockApi.mockResolvedValue({ lyrics: undefined, syncedLyrics: undefined });

    render(<LyricsPanel user={adminUser} />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Add lyrics')).toBeTruthy());
  });

  it('highlights the current synced lyric line', async () => {
    usePlayer.getState().playQueue([{ id: 's1', title: 'Song', duration: 120 } as any], 0);
    usePlayer.getState().setCurrentTime(15);
    mockApi.mockResolvedValue({
      lyrics: 'Line one\nLine two\nLine three',
      syncedLyrics: [
        { time: 0, text: 'Line one' },
        { time: 10, text: 'Line two' },
        { time: 20, text: 'Line three' },
      ],
    });

    render(<LyricsPanel user={mockUser} />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Line two')).toBeTruthy());
    const active = screen.getByText('Line two');
    expect(active.className).toContain('text-accent');
  });

  it('switches to static mode and shows plain lyrics', async () => {
    usePlayer.getState().playQueue([{ id: 's1', title: 'Song', duration: 120 } as any], 0);
    mockApi.mockResolvedValue({
      lyrics: 'Line one\nLine two\nLine three',
      syncedLyrics: [
        { time: 0, text: 'Line one' },
        { time: 10, text: 'Line two' },
        { time: 20, text: 'Line three' },
      ],
    });

    render(<LyricsPanel user={mockUser} />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Line two')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /static lyrics/i }));
    const plainLyrics = screen.getByText((content) =>
      content.includes('Line one') && content.includes('Line two') && content.includes('Line three')
    );
    expect(plainLyrics).toBeTruthy();
  });
});

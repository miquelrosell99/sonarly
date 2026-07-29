import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { FetchLyricsModal } from './FetchLyricsModal.js';

const originalFetch = global.fetch;

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

describe('FetchLyricsModal', () => {
  it('renders loading state initially', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    render(
      <FetchLyricsModal
        open
        songId="1"
        title="Track"
        artistName="Artist"
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText(/searching lrclib/i)).toBeTruthy();
  });

  it('renders matches and transfers synced lyrics', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          matches: [
            {
              id: 123,
              title: 'Track',
              artistName: 'Artist',
              albumName: 'Album',
              duration: 245,
              instrumental: false,
              lyrics: 'Line one\nLine two',
              syncedLyrics: [
                { time: 12.34, text: 'Line one' },
                { time: 15.67, text: 'Line two' },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const onApply = vi.fn();
    render(
      <FetchLyricsModal
        open
        songId="1"
        title="Track"
        artistName="Artist"
        onClose={vi.fn()}
        onApply={onApply}
      />,
    );

    await waitFor(() => expect(screen.queryByText(/searching lrclib/i)).toBeFalsy());

    const syncedTransfer = screen.getAllByTitle('Transfer value')[1];
    fireEvent.click(syncedTransfer);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        syncedLyrics: [
          { time: 12.34, text: 'Line one' },
          { time: 15.67, text: 'Line two' },
        ],
      }),
    );
  });

  it('shows empty state when no matches', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ matches: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    render(
      <FetchLyricsModal
        open
        songId="1"
        title="Track"
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(/no lrclib matches found/i)).toBeTruthy());
  });
});

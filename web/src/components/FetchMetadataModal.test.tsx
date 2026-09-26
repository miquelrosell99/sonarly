import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { FetchMetadataModal } from './FetchMetadataModal.js';

const originalFetch = global.fetch;

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

describe('FetchMetadataModal', () => {
  it('renders loading state initially', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    render(
      <FetchMetadataModal
        open
        entityType="song"
        entity={{ id: '1', title: 'Track', artist: 'Artist' }}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText(/searching musicbrainz/i)).toBeTruthy();
  });

  it('renders matches and transfers a value', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          matches: [
            {
              id: 'mb-1',
              title: 'Fetched Title',
              artist: 'Fetched Artist',
              album: 'Fetched Album',
              year: 2021,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const onApply = vi.fn();
    render(
      <FetchMetadataModal
        open
        entityType="song"
        entity={{ id: '1', title: 'Track', artist: 'Artist' }}
        onClose={vi.fn()}
        onApply={onApply}
      />,
    );

    await waitFor(() => expect(screen.queryByText(/searching musicbrainz/i)).toBeFalsy());

    const transferButtons = screen.getAllByTitle('Transfer value');
    expect(transferButtons.length).toBeGreaterThan(0);

    fireEvent.click(transferButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ title: 'Fetched Title' }));
  });

  it('shows empty state when no matches', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ matches: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    render(
      <FetchMetadataModal
        open
        entityType="album"
        entity={{ id: '2', title: 'Album' }}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(/no musicbrainz matches found/i)).toBeTruthy());
  });

  it('calls onClose when cancel is clicked', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ matches: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const onClose = vi.fn();
    render(
      <FetchMetadataModal
        open
        entityType="artist"
        entity={{ id: '3', name: 'Artist' }}
        onClose={onClose}
        onApply={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
